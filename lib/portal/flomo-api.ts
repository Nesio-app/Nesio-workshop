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

function buildSignedParams(limit: number): Record<string, string> {
  const params: Record<string, string> = {
    limit: String(Math.min(Math.max(limit, 1), 200)),
    tz: '8:0',
    timestamp: String(Math.floor(Date.now() / 1000)),
    api_key: 'flomo_web',
    app_version: '5.25.64',
    platform: 'mac',
    webp: '1',
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

  const params = buildSignedParams(limit);
  const query = new URLSearchParams(params).toString();

  try {
    const res = await fetch(`${FLOMO_UPDATED_URL}?${query}`, {
      method: 'GET',
      headers: { authorization },
      cache: 'no-store',
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        configured: true,
        readConfigured: true,
        writeConfigured,
        memos: [],
        error: data?.message || `flomo ${res.status}`,
      };
    }

    if (data?.code !== 0 && data?.code !== undefined) {
      const message = data?.message || 'flomo rejected request';
      const needsLogin =
        data?.code === -10 || /登录|login/i.test(String(message));
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

    const rows = Array.isArray(data?.data) ? data.data : [];
    const memos = rows
      .slice(0, limit)
      .map((row: Record<string, unknown>) => parseMemo(row))
      .filter((memo: FlomoMemo) => memo.slug && memo.content);

    return {
      ok: true,
      configured: true,
      readConfigured: true,
      writeConfigured,
      memos,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'network error';
    return {
      ok: false,
      configured: true,
      readConfigured: true,
      writeConfigured,
      memos: [],
      error: msg,
    };
  }
}
