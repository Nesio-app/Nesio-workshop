/**
 * GET /api/portal/gmail
 * Fetches the current user's Gmail messages using their OAuth token.
 * Token is read from Supabase (cross-device) or cookies (fallback).
 * Defaults to metadata-only status/preview. Body reads + Gemini extraction
 * require explicit query opt-in: ?includeBody=true&analyze=true.
 */
import { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { createSignal } from '@/lib/life-domain/create-signal';
import { writeCloudSignalsForCurrentUser } from '@/lib/platform/runtime/cloud-signals-server';
import { normalizeGmailToSignal } from '@/lib/life-domain/normalizers';
import { getIntegrationToken, saveIntegrationToken } from '@/lib/portal/integrations';
import { buildEmailExtractionPrompt, parseJsonBlock } from '@/lib/extraction/extraction';
import { extractEmailLocal } from '@/lib/portal/email-extract-local';
import { cookies } from 'next/headers';
import { completeText, aiProviderAvailable } from '@/lib/portal/ai-complete';
import { envValue } from '@/lib/portal/env';
import { hasVerifiedSessionCookie } from '@/lib/portal/api-auth';

export const dynamic = 'force-dynamic';
// 全量同步 = 1 次列表 + 最多 100 封 full 拉取 + 一发大 prompt AI 提取,30s 顶得很紧;
// 超时时 Vercel 回非 JSON 的 504,客户端只能报「网络错误」——给足余量。
export const maxDuration = 60;

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1';

function hasStage5LabAccess(req: NextRequest): boolean {
  const configured = envValue('NESIO_STAGE5_INVOCATION_SECRET');
  const provided = req.headers.get('x-nesio-stage5-secret')?.trim() || '';
  const accessMode = req.headers.get('x-baohe-access-mode')?.trim() || '';
  return Boolean(configured && provided === configured && accessMode === 'personal_lab');
}

async function requireAuthenticatedGmailAccess(req: NextRequest): Promise<NextResponse | null> {
  // 数据审计 P0 同源:session 门改走验签(伪造 refresh/openid 不算「有会话」)。
  const hasNesioSession = await hasVerifiedSessionCookie();
  const noSupabase = !envValue('SUPABASE_URL') || !envValue('SUPABASE_ANON_KEY');
  if (hasNesioSession || hasStage5LabAccess(req) || noSupabase) return null;

  return NextResponse.json(
    {
      ok: false,
      error: 'gmail_auth_required',
      metadataOnly: true,
      includeBody: false,
      analyze: false,
      bodyRead: false,
      aiAnalysisPerformed: false,
      messages: [],
      nodes: [],
      emailCount: 0,
      connectUrl: '/settings',
    },
    { status: 401, headers: { 'Cache-Control': 'no-store, max-age=0' } },
  );
}

// 免费最大化·Gmail:part 可嵌套(multipart/alternative 里再套 multipart);labelIds
// 是消息资源顶层字段(metadata/full 都带),含 Gmail 系统分类 CATEGORY_PROMOTIONS 等。
type GmailPart = { mimeType?: string; body?: { data?: string }; parts?: GmailPart[] };
type GmailMessage = {
  id: string;
  snippet?: string;
  labelIds?: string[];
  payload?: {
    headers?: Array<{ name: string; value: string }>;
    parts?: GmailPart[];
    body?: { data?: string };
  } & GmailPart;
};

function decodeBase64Url(str: string): string {
  try {
    const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(base64, 'base64').toString('utf-8');
  } catch { return ''; }
}

// 递归找第一个指定 mime 的 part 正文(此前只遍历一层 → 嵌套 multipart 的正文取不到)。
function findPartData(part: GmailPart | undefined, mime: string): string {
  if (!part) return '';
  if (part.mimeType === mime && part.body?.data) return decodeBase64Url(part.body.data);
  for (const p of part.parts || []) {
    const found = findPartData(p, mime);
    if (found) return found;
  }
  return '';
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
}

// 修 HTML-only bug:优先递归取 text/plain;没有(大量通知/账单邮件只有 HTML)则取
// text/html 剥标签;都没有再退顶层 body / snippet。maxLen 控截断:卡片预览用短的,
// 全文(存本机、供阅读原文/检索)用大的。
function extractText(msg: GmailMessage, maxLen = 1500): string {
  const root = msg.payload;
  const plain = findPartData(root, 'text/plain');
  if (plain) return plain.slice(0, maxLen);
  const html = findPartData(root, 'text/html');
  if (html) return stripHtml(html).slice(0, maxLen);
  if (root?.body?.data) return decodeBase64Url(root.body.data).slice(0, maxLen);
  return msg.snippet?.slice(0, Math.min(maxLen, 400)) || '';
}

// 邮件全文(≤20k 防极端;附件不含)。用于本机专属存储 —— 不进云同步的 LifeNode.attributes。
const EMAIL_FULLTEXT_MAX = 20_000;
function extractFullBody(msg: GmailMessage): string {
  return extractText(msg, EMAIL_FULLTEXT_MAX);
}
/** 非广告邮件的 emailId → 全文映射。客户端收到后存本机 IndexedDB(local-email-body),不上云。 */
function buildEmailBodies(messages: GmailMessage[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of messages) {
    if (isPromotion(m) || !m.id) continue;
    const body = extractFullBody(m);
    if (body) out[m.id] = body;
  }
  return out;
}

// Gmail 系统分类标签 → 语义。CATEGORY_PROMOTIONS=广告(不进 AI 省钱)、
// CATEGORY_UPDATES=通知类(账单/收据/快递)、IMPORTANT=Google 重要性预测。
function isPromotion(msg: GmailMessage): boolean {
  return (msg.labelIds || []).includes('CATEGORY_PROMOTIONS');
}
function mailCategory(msg: GmailMessage): 'promotions' | 'updates' | 'social' | 'forums' | 'personal' {
  const l = msg.labelIds || [];
  if (l.includes('CATEGORY_PROMOTIONS')) return 'promotions';
  if (l.includes('CATEGORY_UPDATES')) return 'updates';
  if (l.includes('CATEGORY_SOCIAL')) return 'social';
  if (l.includes('CATEGORY_FORUMS')) return 'forums';
  return 'personal';
}

function header(msg: GmailMessage, name: string): string {
  return msg.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';
}

/** 从 From 头(「名字 <a@b.com>」或裸地址)抠出邮箱地址(小写),作分类归并的稳定键。 */
function emailAddrOf(s: string): string {
  const m = /<([^>]+)>/.exec(s) || /([^\s<>@]+@[^\s<>@]+)/.exec(s);
  return (m ? m[1] : '').trim().toLowerCase();
}

/** 按发件人邮箱汇 Gmail 系统分类(供 AI 提取的节点也能带上通知/重要/mailCategory,不再只在兜底打)。 */
function mailClassBySender(msgs: GmailMessage[]): Map<string, { category: ReturnType<typeof mailCategory>; important: boolean }> {
  const map = new Map<string, { category: ReturnType<typeof mailCategory>; important: boolean }>();
  for (const m of msgs) {
    const email = emailAddrOf(header(m, 'from'));
    if (!email) continue;
    const category = mailCategory(m);
    const important = (m.labelIds || []).includes('IMPORTANT');
    const cur = map.get(email);
    map.set(email, {
      // 同发件人多封:保留更有信息量的非 personal 分类;important 任一为真则真
      category: cur && cur.category !== 'personal' ? cur.category : category,
      important: Boolean(cur?.important) || important,
    });
  }
  return map;
}

function parseHeaderDate(value: string): string | undefined {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}

async function refreshToken(refreshTk: string): Promise<string | null> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshTk,
      client_id: envValue('GOOGLE_CLIENT_ID'),
      client_secret: envValue('GOOGLE_CLIENT_SECRET'),
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json() as { access_token?: string };
  return data.access_token || null;
}

// 批次 37:窗口从 7 天/10 封放宽到 30 天/50 封 —— 之前太窄,同步了也「问一问看不到几封」。
// 连接器批②:准实时 —— afterTs(unix 秒)存在时用 Gmail 原生 after: 查询,只拉这个时刻
// 之后的新邮件(高频轮询只分析增量,AI 成本不随频率线性涨;emailId 去重兜底重叠窗)。
async function fetchMessages(accessToken: string, max = 50, metadataOnly = true, afterTs?: number): Promise<GmailMessage[]> {
  const q = afterTs && afterTs > 0 ? `after:${Math.floor(afterTs)}` : 'newer_than:30d';
  const listRes = await fetch(
    `${GMAIL_API}/users/me/messages?maxResults=${max}&q=${q}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!listRes.ok) {
    // 403 有两种截然不同的病因,把 Google 的 reason 带出来一锤定音:
    // accessNotConfigured = GCP 项目没启用 Gmail API;insufficientPermissions = token 缺 scope
    let reason = '';
    try {
      const body = await listRes.json() as { error?: { errors?: Array<{ reason?: string }>; status?: string; message?: string } };
      reason = body.error?.errors?.[0]?.reason || body.error?.status || '';
    } catch { /* body 不是 JSON 就算了 */ }
    throw new Error(`gmail_list_${listRes.status}${reason ? `:${reason}` : ''}`);
  }

  const listData = await listRes.json() as { messages?: Array<{ id: string }> };
  const ids = listData.messages || [];
  if (!ids.length) return [];

  const messages = await Promise.all(
    ids.slice(0, max).map(async ({ id }) => {
      const res = await fetch(
        `${GMAIL_API}/users/me/messages/${id}?format=${metadataOnly ? 'metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date' : 'full'}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (!res.ok) return null;
      return res.json() as Promise<GmailMessage>;
    }),
  );
  return messages.filter((m): m is GmailMessage => m !== null);
}

async function extractNodes(messages: GmailMessage[]): Promise<object[]> {
  // 免费最大化·Gmail:广告(CATEGORY_PROMOTIONS)不喂 AI —— 占普通邮箱大头,
  // 这一刀直接省掉一大块 completeText 成本,且广告本就不该进记忆。
  const worth = messages.filter((m) => !isPromotion(m));
  if (!aiProviderAvailable() || !worth.length) return [];

  const emailTexts = worth.map((m) => {
    const subject = header(m, 'subject');
    const from = header(m, 'from');
    const date = header(m, 'date');
    const body = extractText(m);
    return `主题：${subject}\n发件人：${from}\n日期：${date}\n内容：${body}`;
  }).join('\n\n───\n\n');

  const prompt = buildEmailExtractionPrompt(emailTexts);

  const raw = (await completeText({ prompt, maxTokens: 2048 })).text || '[]';
  const parsed = parseJsonBlock<Array<Record<string, unknown>>>(raw) ?? [];

  // 免费最大化·Gmail:把 Gmail 系统分类叠加到 AI 提取的节点(此前只在兜底路径打,AI 正常出结果时丢了)。
  // 按发件人邮箱归并 —— schema 要求节点 attributes 保留 source(发件人),据此可靠回填通知/重要/mailCategory。
  const byEmail = mailClassBySender(worth);
  // 邮件全链路 join key(P0 修复):AI 抽取的节点必须带 emailId,否则全文索引/语义检索/RAG/
  // 「阅读原文」全部拿不到 key、静默失效。按「发件人唯一 → 主题精确」回关源邮件注入 m.id。
  const bySender = new Map<string, GmailMessage[]>();
  for (const m of worth) {
    const addr = emailAddrOf(header(m, 'from'));
    if (!addr) continue;
    const arr = bySender.get(addr) || [];
    arr.push(m);
    bySender.set(addr, arr);
  }
  const findSourceId = (attrs: Record<string, unknown>, name: unknown): string | undefined => {
    const addr = emailAddrOf(String(attrs.source ?? attrs.from ?? ''));
    const cands = addr ? bySender.get(addr) : undefined;
    if (!cands || !cands.length) return undefined;
    if (cands.length === 1) return cands[0].id || undefined;
    const subj = String(attrs.subject ?? name ?? '').trim();
    if (subj) {
      const hit = cands.find((m) => header(m, 'subject').trim() === subj);
      if (hit) return hit.id || undefined;
    }
    return undefined;
  };
  return parsed.map((n) => {
    const attrs = (n.attributes && typeof n.attributes === 'object') ? { ...(n.attributes as Record<string, unknown>) } : {};
    const emailId = findSourceId(attrs, n.name);
    const cls = byEmail.get(emailAddrOf(String(attrs.source ?? attrs.from ?? '')));
    const tags = Array.isArray(n.tags) ? [...n.tags] : [];
    if (cls?.category === 'updates' && !tags.includes('通知')) tags.push('通知');
    if (cls?.important && !tags.includes('重要')) tags.push('重要');
    return {
      ...n,
      tags,
      attributes: { ...attrs, ...(emailId ? { emailId } : {}), ...(cls ? { mailCategory: cls.category } : {}) },
    };
  });
}

function metadataPreview(messages: GmailMessage[]) {
  return messages.map((m) => ({
    id: m.id,
    subject: header(m, 'subject'),
    from: header(m, 'from'),
    date: header(m, 'date'),
    snippetPreview: m.snippet ? `${m.snippet.slice(0, 80)}${m.snippet.length > 80 ? '…' : ''}` : '',
  }));
}

export async function GET(req: NextRequest) {
  const authFailure = await requireAuthenticatedGmailAccess(req);
  if (authFailure) return authFailure;

  const url = new URL(req.url);
  const includeBody = url.searchParams.get('includeBody') === 'true';
  const shouldAnalyze = url.searchParams.get('analyze') === 'true';
  // 连接器批②:增量游标(unix 秒)。带 afterTs 只拉该时刻之后的新邮件;不带 = 全量窗口(30 天)。
  const afterTs = Number(url.searchParams.get('afterTs') || 0) || undefined;
  // 全量窗口放宽到 100 封(增量轮询通常只有零星几封,同一上限不碍事)
  const fetchMax = afterTs ? 50 : 100;
  const metadataOnly = !includeBody;
  // Get token for current user (Supabase → cookies fallback)
  let tokens = await getIntegrationToken('gmail');

  // Gmail and Calendar consent share one Google authorization; if only the
  // calendar cookies survived, borrow its refresh token to mint a gmail one.
  if (!tokens?.refreshToken) {
    const calendarTokens = await getIntegrationToken('calendar');
    if (calendarTokens?.refreshToken) {
      tokens = { accessToken: tokens?.accessToken || '', refreshToken: calendarTokens.refreshToken };
    }
  }

  // 根因修复(批次 10):日历 route 一直是「会话门之后直接读 cookie」,而这里
  // 只走 getIntegrationToken——生产环境(配了 Supabase)默认禁用 cookie 回退,
  // 只读 Supabase;但 calendar/oauth 回调只写 cookie。结果就是用户看到的
  // 「日历 19 条正常、邮件永远授权失效」。requireAuthenticatedGmailAccess
  // 已在上面挡掉匿名请求,这里与日历 route 同构地把本设备 cookie 也列为
  // 候选;跨设备仍靠 Supabase。
  const cookieStore = await cookies();
  const cookieAccess = cookieStore.get('nesio_gmail_access')?.value
    || cookieStore.get('nesio_google_calendar_access')?.value || '';
  const cookieRefresh = cookieStore.get('nesio_gmail_refresh')?.value
    || cookieStore.get('nesio_google_calendar_refresh')?.value || '';
  const candidates: Array<{ accessToken: string; refreshToken?: string }> = [];
  if (tokens) candidates.push(tokens);
  if ((cookieAccess || cookieRefresh)
    && (cookieAccess !== tokens?.accessToken || cookieRefresh !== (tokens?.refreshToken || ''))) {
    candidates.push({ accessToken: cookieAccess, refreshToken: cookieRefresh || undefined });
  }

  if (candidates.length === 0) {
    return NextResponse.json(
      { ok: false, error: 'not_connected', connectUrl: '/api/portal/gmail/connect' },
      { status: 401 },
    );
  }

  let messages: GmailMessage[] = [];
  let refreshedAccessToken: string | null = null;
  let winner: { accessToken: string; refreshToken?: string } | null = null;
  let sawAuthFailure = false;
  let lastError = '';

  // Supabase 里的 token 可能是陈旧的(旧授权残留),cookie 里的是最近一次
  // 授权写入的——逐个候选试:直接拉 → 401 就刷新再拉 → 都不行换下一个。
  for (const cand of candidates) {
    try {
      // accessToken may be '' when only a refresh token survives — 401s into the refresh path
      if (!cand.accessToken) throw new Error('gmail_list_401');
      messages = await fetchMessages(cand.accessToken, fetchMax, metadataOnly, afterTs);
      winner = cand;
      break;
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (!msg.includes('401')) { lastError = msg || 'gmail_fetch_failed'; continue; }
      if (!cand.refreshToken) { sawAuthFailure = true; continue; }
      const newToken = await refreshToken(cand.refreshToken);
      if (!newToken) { sawAuthFailure = true; continue; }
      try {
        messages = await fetchMessages(newToken, fetchMax, metadataOnly, afterTs);
        refreshedAccessToken = newToken;
        winner = cand;
        break;
      } catch (retryErr) {
        lastError = retryErr instanceof Error ? retryErr.message : 'gmail_fetch_failed';
      }
    }
  }

  if (!winner) {
    // 403 = token 有效但没有 gmail scope(旧的日历授权借来的 token)——
    // 唯一出路是走 /api/portal/gmail/connect 重新同意(带双 scope + prompt=consent)
    if (lastError.includes('403')) {
      // API 未启用是管理台问题,重新授权解决不了——分开报
      const apiDisabled = lastError.includes('accessNotConfigured') || lastError.includes('SERVICE_DISABLED');
      return NextResponse.json(
        {
          ok: false,
          error: apiDisabled ? 'gmail_api_disabled' : 'insufficient_scope',
          detail: lastError,
          connectUrl: '/api/portal/gmail/connect',
        },
        { status: 403 },
      );
    }
    if (sawAuthFailure || !lastError) {
      return NextResponse.json(
        { ok: false, error: 'token_expired', connectUrl: '/api/portal/gmail/connect' },
        { status: 401 },
      );
    }
    return NextResponse.json({ ok: false, error: lastError }, { status: 500 });
  }

  // 成功后把可用 token 回写 Supabase(登录会话有效时才真正写入),
  // 治愈「Supabase 存着旧 token、cookie 里才是新授权」的循环。
  await saveIntegrationToken('gmail', {
    accessToken: refreshedAccessToken || winner.accessToken,
    refreshToken: winner.refreshToken,
  }, req);

  const shouldCreateSignals = includeBody && shouldAnalyze;
  // AI 提取失败(配额 429/超时)不许炸掉整次同步 —— 未捕获会让路由回非 JSON 的
  // 500,客户端只能报「网络错误」(间歇性:配额窗口偶尔放行)。捕获后走下面的
  // 元数据兜底,邮件照样进记忆,AI 只是这一轮没帮上忙。
  let nodes: object[] = [];
  let aiExtractionFailed = false;
  if (shouldCreateSignals) {
    try {
      nodes = await extractNodes(messages);
    } catch (err) {
      aiExtractionFailed = true;
      console.error('[gmail] AI extraction failed, using metadata fallback:', err instanceof Error ? err.message : err);
    }
  }

  // Fallback: if AI extraction returned nothing (no Gemini key or all filtered),
  // create basic nodes directly from email metadata so LifeGraph always has data.
  // 免费最大化·Gmail:兜底也跳过广告(和 AI 分支一致,不把促销塞进记忆)。
  if (includeBody && nodes.length === 0 && messages.length > 0) {
    nodes = messages.filter((m) => !isPromotion(m)).map((m) => {
      const body = extractText(m); // 批次 25:邮件正文预览(≤1500,供友好阅读器/搜索;全文另存本机)
      const cat = mailCategory(m);
      const important = (m.labelIds || []).includes('IMPORTANT');
      // 邮件全链路 Phase 2:本地深抽取(金额/预计到货/订单号/快递单号/商家/待办),零云成本。
      const subject = header(m, 'subject');
      const from = header(m, 'from');
      const local = extractEmailLocal(subject, from, extractFullBody(m));
      return {
        type: 'event' as const,
        name: subject || 'Gmail 邮件',
        source: 'email' as const,
        confidence: important ? 0.8 : 0.7,
        rawInput: `来自 ${from || '未知'}: ${m.snippet?.slice(0, 120) || ''}`,
        // 通知类(账单/收据/快递)标 tag,供 Today 卡按类挑；重要标记透传；本地抽到待办信号标「待回复」
        tags: ['邮件', 'Gmail', ...(cat === 'updates' ? ['通知'] : []), ...(important ? ['重要'] : []), ...(local.todoHint ? ['待回复'] : [])],
        attributes: {
          date: header(m, 'date'),
          from,
          emailId: m.id,
          mailCategory: cat,
          // CARD SPEC:列表卡第二行优先读 summary(干净摘要)—— 兜底路径用 Gmail 自带
          // snippet(正文首句预览,无邮件头),不再靠渲染层从「来自 X: …」rawInput 里现剥。
          ...(m.snippet ? { summary: m.snippet.slice(0, 120) } : {}),
          ...(body ? { article: body } : {}),
          // 本地抽取的结构化线索(命中才给)
          ...(local.store ? { store: local.store } : {}),
          ...(local.eta ? { eta: local.eta } : {}),
          ...(local.amount ? { amount: local.amount } : {}),
          ...(local.orderNo ? { orderNo: local.orderNo } : {}),
          ...(local.trackingNo ? { trackingNo: local.trackingNo } : {}),
        },
        relations: [] as Array<{ targetId: string; relation: string }>,
      };
    });
  }

  // Ensure all nodes have source: 'email' so LifeGraph can filter by source
  nodes = nodes.map((n) => ({ source: 'email' as const, ...n }));
  const signals = shouldCreateSignals
    ? messages.map((message) => createSignal(normalizeGmailToSignal({
        id: message.id,
        subject: header(message, 'subject') || 'Gmail message',
        from: header(message, 'from'),
        snippet: extractText(message).slice(0, 240) || message.snippet || '',
        occurredAt: parseHeaderDate(header(message, 'date')),
      })))
    : [];
  const cloudSignalWrite = signals.length
    ? await writeCloudSignalsForCurrentUser(signals)
    : { ok: true, writesCloud: false, savedCount: 0 };

  const response = NextResponse.json({
    ok: true,
    metadataOnly,
    includeBody,
    analyze: shouldAnalyze,
    bodyRead: includeBody,
    aiAnalysisPerformed: includeBody && shouldAnalyze && !aiExtractionFailed,
    messages: metadataPreview(messages),
    nodes,
    signalIds: signals.map((signal) => signal.id),
    signalCount: signals.length,
    cloudSignalWrite,
    count: nodes.length,
    emailCount: messages.length,
    // 邮件全文(emailId → 正文,≤20k)。仅回给本设备,客户端存本机 IndexedDB;
    // 隐私红线:不进云同步的记忆节点 attributes。免费/付费都本机可读。
    emailBodies: includeBody ? buildEmailBodies(messages) : undefined,
  });

  // Persist refreshed access token as cookie so the next request doesn't need to re-refresh
  if (refreshedAccessToken) {
    const secure = process.env.NODE_ENV === 'production';
    response.cookies.set('nesio_gmail_access', refreshedAccessToken, {
      httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: 3600,
    });
  }

  return response;
}
