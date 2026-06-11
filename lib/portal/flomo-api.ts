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

function flomoToken(): string | null {
  const raw = process.env.FLOMO_API_TOKEN?.trim();
  if (!raw) return null;
  return raw.startsWith('Bearer ') ? raw : `Bearer ${raw}`;
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

export function isFlomoReadConfigured(): boolean {
  return Boolean(process.env.FLOMO_API_TOKEN?.trim());
}

export async function fetchFlomoMemos(limit = 50): Promise<{
  ok: boolean;
  configured: boolean;
  memos: FlomoMemo[];
  error?: string;
}> {
  const token = flomoToken();
  if (!token) {
    return {
      ok: false,
      configured: false,
      memos: [],
      error: 'FLOMO_API_TOKEN not configured',
    };
  }

  const params = buildSignedParams(limit);
  const query = new URLSearchParams(params).toString();

  try {
    const res = await fetch(`${FLOMO_UPDATED_URL}?${query}`, {
      method: 'GET',
      headers: { authorization: token },
      cache: 'no-store',
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        configured: true,
        memos: [],
        error: data?.message || `flomo ${res.status}`,
      };
    }

    if (data?.code !== 0 && data?.code !== undefined) {
      return {
        ok: false,
        configured: true,
        memos: [],
        error: data?.message || 'flomo rejected request',
      };
    }

    const rows = Array.isArray(data?.data) ? data.data : [];
    const memos = rows
      .slice(0, limit)
      .map((row: Record<string, unknown>) => parseMemo(row))
      .filter((memo: FlomoMemo) => memo.slug && memo.content);

    return { ok: true, configured: true, memos };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'network error';
    return { ok: false, configured: true, memos: [], error: msg };
  }
}
