/**
 * GET /api/portal/gmail-quick
 * HTTP adapter for the Email Signal Engine (lib/platform/email-signals).
 * Fetches Gmail metadata only (no body). Three-stage recommendation gate:
 *   ① 正则粗筛(email-signals):主题匹配「可能需行动」的关键词
 *   ② Gmail 标签门(批次 152):广告/社交/论坛不推荐
 *   ③ AI 可执行性判定(批次 153):对已过粗筛的候选逐条判「值不值得今天打扰你」
 * Designed for 20-min polling; AI 只看已过①②的几封(≤8),一次调用批量判。
 * Output: { ok, signals: EmailSignal[] }
 */
import { NextRequest, NextResponse } from 'next/server';
import { getIntegrationToken } from '@/lib/portal/integrations';
import { hasVerifiedSessionCookie } from '@/lib/portal/api-auth';
import { buildEmailSignal, type EmailSignal } from '@/lib/platform/email-signals';
import { completeText, aiProviderAvailable } from '@/lib/portal/ai-complete';
import { parseJsonBlock } from '@/lib/extraction/extraction';
import { envValue } from '@/lib/portal/env';

export const dynamic = 'force-dynamic';

// Re-export so TodayFeed.tsx can import EmailSignal from one place
export type { EmailSignal };

function hasLabAccess(req: NextRequest): boolean {
  const configured = envValue('NESIO_STAGE5_INVOCATION_SECRET');
  const provided = req.headers.get('x-nesio-stage5-secret')?.trim() || '';
  return Boolean(configured && provided === configured && req.headers.get('x-baohe-access-mode') === 'personal_lab');
}

// ── Gmail metadata fetch ──────────────────────────────────────────────────────

type GmailListItem = { id: string };
type GmailMeta = {
  id: string;
  // 批次 152:Gmail 系统分类标签(format=metadata 顶层字段)—— 据此决定「要不要推荐」。
  labelIds?: string[];
  payload?: { headers?: Array<{ name: string; value: string }> };
};

// 批次 152(用户定案):邮件都进记忆(走 gmail 同步路由),但推荐门只放行值得打扰你的类别。
// 广告/社交/论坛 = 不推荐(不出今天页引导卡);账单/收据/快递(UPDATES)与个人邮件 = 可推荐。
const NO_RECOMMEND_CATEGORIES = new Set(['CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL', 'CATEGORY_FORUMS']);
function isRecommendable(msg: GmailMeta): boolean {
  const labels = msg.labelIds || [];
  return !labels.some((l) => NO_RECOMMEND_CATEGORIES.has(l));
}

function hdr(msg: GmailMeta, name: string): string {
  return msg.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';
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

async function fetchMetadata(accessToken: string): Promise<GmailMeta[]> {
  const GMAIL = 'https://gmail.googleapis.com/gmail/v1';
  const listRes = await fetch(
    `${GMAIL}/users/me/messages?maxResults=20&q=newer_than:1d`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!listRes.ok) throw new Error(`gmail_list_${listRes.status}`);
  const listData = await listRes.json() as { messages?: GmailListItem[] };
  const ids = (listData.messages || []).slice(0, 20);
  if (!ids.length) return [];

  const msgs = await Promise.all(ids.map(async ({ id }) => {
    const res = await fetch(
      `${GMAIL}/users/me/messages/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) return null;
    return res.json() as Promise<GmailMeta>;
  }));
  return msgs.filter((m): m is GmailMeta => m !== null);
}

// ── AI 可执行性门(批次 153,用户定案「正则之上加 AI 可执行性判定」)──────────────
// 正则+标签门只是粗筛;再让模型对候选逐条判「值不值得今天打扰你」—— 不是每封
// UPDATES 都该出卡(『账单已生成』不必扰,『账单明天到期』要)。只看已过粗筛的
// 几封(≤8),一次调用批量判;仅用主题+发件人(不读正文,保持隐私与低成本)。
// 降级原则:AI 无 key / 超时 / 解析失败 → 全放行(退回纯规则,不因 AI 抽风漏提醒)。
const AI_JUDGE_TIMEOUT_MS = 6000;

async function filterByAiActionability(candidates: EmailSignal[]): Promise<EmailSignal[]> {
  if (candidates.length === 0 || !aiProviderAvailable()) return candidates;

  const list = candidates
    .map((s, i) => `${i}. [${s.type}] 主题：${s.subject}　发件人：${s.from}`)
    .join('\n');
  const prompt = `下面是几封已初步匹配「可能需要行动」的邮件(仅主题与发件人)。判断每封是否真的值得今天作为一张待办卡片提醒用户。
只保留需要用户去做或决定某件事、且有时效的:要赶的航班、要确认的预约、要付且临近的账单、要签收的快递、真正的截止日期。
排除:纯通知/回执/自动确认、账户或账单「已生成/已出账」这类无需动作的摘要、营销、社交、验证码之外无需处理的系统邮件。
邮件:
${list}

只返回 JSON 数组,元素为值得出卡的邮件序号(从 0 开始),如 [0,2]。都不值得则返回 []。`;

  try {
    const judged = await Promise.race([
      completeText({ prompt, maxTokens: 200, responseFormat: 'json', route: 'gmail-quick-actionability' }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), AI_JUDGE_TIMEOUT_MS)),
    ]);
    if (!judged) return candidates; // 超时 → 降级全放行
    const keep = parseJsonBlock<number[]>(judged.text || '[]');
    if (!Array.isArray(keep)) return candidates; // 解析失败 → 降级全放行
    const keepSet = new Set(keep.map(Number));
    return candidates.filter((_, i) => keepSet.has(i)); // AI 返回 [] = 都不值得,尊重它
  } catch {
    return candidates; // AI 出错 → 降级全放行
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  // 数据审计 P0 同源:session 门改走验签(伪造 refresh/openid 不算「有会话」)。
  const hasSession = await hasVerifiedSessionCookie();
  if (!hasSession && !hasLabAccess(req)) {
    return NextResponse.json({ ok: false, error: 'auth_required', signals: [] }, { status: 401 });
  }

  const tokens = await getIntegrationToken('gmail');
  if (!tokens) {
    return NextResponse.json({ ok: false, error: 'not_connected', signals: [] }, { status: 200 });
  }

  let messages: GmailMeta[];
  try {
    messages = await fetchMetadata(tokens.accessToken);
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (msg.includes('401') && tokens.refreshToken) {
      const newToken = await refreshToken(tokens.refreshToken);
      if (!newToken) return NextResponse.json({ ok: false, error: 'token_expired', signals: [] });
      try { messages = await fetchMetadata(newToken); }
      catch { return NextResponse.json({ ok: false, error: 'fetch_failed', signals: [] }); }
    } else {
      return NextResponse.json({ ok: false, error: msg || 'fetch_failed', signals: [] });
    }
  }

  const signals: EmailSignal[] = [];
  const seen = new Set<string>();

  for (const msg of messages) {
    const subject = hdr(msg, 'subject');
    const from = hdr(msg, 'from');
    const date = hdr(msg, 'date');
    if (!subject) continue;
    // 批次 152:Gmail 分类门 —— 广告/社交/论坛类邮件仍入库,但不打扰你(不出今天页推荐卡)。
    if (!isRecommendable(msg)) continue;

    const signal = buildEmailSignal(msg.id, subject, from, date);
    if (!signal || seen.has(signal.type)) continue;
    seen.add(signal.type);
    signals.push(signal);
  }

  // ③ AI 可执行性门:对已过正则+标签的候选逐条判「值不值得今天出卡」(降级见 helper)。
  const surfaced = await filterByAiActionability(signals);
  surfaced.sort((a, b) => b.priority - a.priority);
  return NextResponse.json({ ok: true, signals: surfaced });
}
