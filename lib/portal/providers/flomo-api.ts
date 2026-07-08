import { createHash } from 'crypto';

const FLOMO_SALT = 'dbbc3dd73364b4084c3a69346e0ce2b2';
const FLOMO_UPDATED_URL = 'https://flomoapp.com/api/v1/memo/updated/';

export interface FlomoMemo {
  slug: string;
  content: string;
  created_at: string;
  updated_at: string;
  tags: string[];
}

function webhookEnvUrl(): string | null {
  const raw =
    process.env.FLOMO_WEBHOOK_URL?.trim() || process.env.FLOMO_API_URL?.trim();
  return raw || null;
}

function webhookUserId(): string | null {
  const url = webhookEnvUrl();
  if (!url) return null;
  try {
    const match = new URL(url).pathname.match(/\/iwh\/([^/]+)\//i);
    if (!match) return null;
    try {
      return Buffer.from(match[1], 'base64').toString('utf8');
    } catch {
      return match[1];
    }
  } catch {
    return null;
  }
}

function extractAccessToken(raw: string): string | null {
  let value = raw.replace(/^Bearer\s+/i, '').trim();
  if (!value) return null;

  if (value.startsWith('{')) {
    try {
      const parsed = JSON.parse(value) as { access_token?: unknown };
      if (typeof parsed.access_token === 'string' && parsed.access_token.trim()) {
        value = parsed.access_token.trim();
      }
    } catch {
      return null;
    }
  }

  if (value.includes('|')) return value;

  const userId = webhookUserId();
  if (userId && value.length >= 16) return `${userId}|${value}`;

  return null;
}

/** Session token for read API — not the webhook secret from 设置→API. */
export function flomoReadAuthorization(): string | null {
  const raw = process.env.FLOMO_API_KEY?.trim();
  if (!raw) return null;
  const token = extractAccessToken(raw);
  if (!token) return null;
  return `Bearer ${token}`;
}

function buildSignedParams(limit: number, latestUpdatedAt?: string): Record<string, string> {
  const params: Record<string, string> = {
    limit: String(Math.min(Math.max(limit, 1), 200)),
    tz: '8:0',
    timestamp: String(Math.floor(Date.now() / 1000)),
    api_key: 'flomo_web',
    app_version: '5.25.64',
    platform: 'mac',
    webp: '1',
    // 游标:updated 接口按更新时间升序分页,不带游标 = 从最旧开始
    ...(latestUpdatedAt ? { latest_updated_at: latestUpdatedAt } : {}),
  };

  const paramStr = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&');
  params.sign = createHash('md5')
    .update(paramStr + FLOMO_SALT)
    .digest('hex');

  return params;
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseTags(content: string, rawTags?: unknown): string[] {
  const fromHtml = content.match(/#[\w\u4e00-\u9fff]+/g) || [];
  const fromApi = Array.isArray(rawTags)
    ? rawTags.map((t) => (typeof t === 'string' ? t : String(t)))
    : [];
  return Array.from(new Set([...fromApi, ...fromHtml]));
}

function parseMemo(raw: Record<string, unknown>): FlomoMemo {
  const html = typeof raw.content === 'string' ? raw.content : '';
  return {
    slug: String(raw.slug ?? ''),
    content: stripHtml(html),
    created_at: String(raw.created_at ?? ''),
    updated_at: String(raw.updated_at ?? raw.created_at ?? ''),
    tags: parseTags(html, raw.tags),
  };
}

export function isFlomoWriteConfigured(): boolean {
  return Boolean(webhookEnvUrl());
}

export function isFlomoReadConfigured(): boolean {
  return Boolean(flomoReadAuthorization());
}

export const FLOMO_READ_SETUP_HINT =
  '读取需另配 FLOMO_API_KEY：flomo 网页版 → F12 → Application → Local Storage → v.flomoapp.com → 键名 me → 复制 access_token（不是设置里的 Webhook 地址）';

export async function fetchFlomoMemos(limit = 50): Promise<{
  ok: boolean;
  configured: boolean;
  readConfigured: boolean;
  writeConfigured: boolean;
  memos: FlomoMemo[];
  error?: string;
}> {
  const writeConfigured = isFlomoWriteConfigured();
  const authorization = flomoReadAuthorization();

  if (!authorization) {
    const hasKey = Boolean(process.env.FLOMO_API_KEY?.trim());
    return {
      ok: false,
      configured: writeConfigured,
      readConfigured: false,
      writeConfigured,
      memos: [],
      error: hasKey
        ? 'FLOMO_API_KEY 格式不对：需要 access_token（含 userId|...），不是 Webhook 密钥'
        : writeConfigured
          ? FLOMO_READ_SETUP_HINT
          : '请先配置 FLOMO_WEBHOOK_URL（发送）与 FLOMO_API_KEY（读取）',
    };
  }

  // 根因修复(批次 19):/memo/updated/ 是同步游标接口,升序返回——
  // 不带 latest_updated_at 游标就永远是「最旧的一批」(用户:为什么永远
  // 只出现最早的 20 条)。翻页取全量(封顶 25 页×200),返回最新的 limit 条。
  const toUnix = (v: string): string => {
    if (/^\d+$/.test(v)) return v;
    const t = Date.parse(v.replace(' ', 'T') + '+08:00');
    return Number.isFinite(t) ? String(Math.floor(t / 1000)) : '';
  };

  const collected: FlomoMemo[] = [];
  let cursor = '';
  let pageError: { status: number; message: string; needsLogin: boolean } | null = null;

  for (let page = 0; page < 25; page++) {
    const params = buildSignedParams(200, cursor || undefined);
    const query = new URLSearchParams(params).toString();
    let res: Response;
    let data: { data?: unknown[]; message?: string } = {};
    try {
      res = await fetch(`${FLOMO_UPDATED_URL}?${query}`, {
        method: 'GET',
        headers: { authorization },
        cache: 'no-store',
      });
      data = await res.json().catch(() => ({})) as typeof data;
    } catch {
      break; // 网络断页:用已收集的部分
    }
    if (!res.ok) {
      const message = String((data as { message?: string }).message ?? `flomo_${res.status}`);
      pageError = { status: res.status, message, needsLogin: res.status === 401 || /login|登录/.test(message) };
      break;
    }
    const rows = Array.isArray(data?.data) ? data.data as Array<Record<string, unknown>> : [];
    const memos = rows.map((row) => parseMemo(row)).filter((memo) => memo.slug && memo.content);
    collected.push(...memos);
    if (rows.length < 200) break;
    const last = rows[rows.length - 1] as { updated_at?: unknown };
    cursor = toUnix(String(last.updated_at ?? ''));
    if (!cursor) break;
  }

  if (pageError && collected.length === 0) {
    const { needsLogin, message } = pageError;
    return {
      ok: false,
      configured: true,
      readConfigured: true,
      writeConfigured,
      memos: [],
      error: needsLogin
        ? 'FLOMO_API_KEY 已过期，请重新从 Local Storage → me → access_token 复制'
        : message,
    };
  }

  // collected 是升序(旧→新):取最新的 limit 条,最新在前
  const capped = Math.min(Math.max(limit, 1), 5000); // 连接器全量导入用大 limit;面板仍传 48
  const memos = collected.slice(-capped).reverse();

  return {
    ok: true,
    configured: true,
    readConfigured: true,
    writeConfigured,
    memos,
  };
}
