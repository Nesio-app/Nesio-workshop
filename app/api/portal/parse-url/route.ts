/**
 * POST /api/portal/parse-url
 *
 * Fetches a URL and extracts product metadata (og:title, og:image, price).
 * Used by the 冷冻仓 flow to identify what the user wants to buy.
 */
import { NextRequest, NextResponse } from 'next/server';
import { lookup } from 'node:dns/promises';
import { guardAiRoute } from '@/lib/portal/api-auth';
import { isBlockedUrl, isPrivateOrReservedIp } from '@/lib/portal/ssrf-guard.mjs';

export const dynamic = 'force-dynamic';
export const maxDuration = 15;

const MAX_FETCH_BYTES = 6_000_000; // 抓取正文上限,避免无界读取

interface ParseResult {
  ok: boolean;
  title?: string;
  price?: string;
  article?: string;
  image?: string;
  store?: string;
  description?: string;
  error?: string;
}

function extractMeta(html: string, property: string): string {
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${property}["']`, 'i'),
    new RegExp(`<meta[^>]+name=["']${property}["'][^>]+content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${property}["']`, 'i'),
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m?.[1]) return m[1].trim();
  }
  return '';
}

function extractTitle(html: string): string {
  const og = extractMeta(html, 'og:title');
  if (og) return og;
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return m?.[1]?.trim() ?? '';
}

function extractPrice(html: string, url: string): string {
  // Common price patterns in Chinese shopping sites
  const pricePatterns = [
    /["']price["']\s*[:=]\s*["']?(\d+\.?\d*)["']?/i,
    /class=["'][^"']*price[^"']*["'][^>]*>[\s¥￥$]*(\d+[\d,.]*)/i,
    /<span[^>]*itemprop=["']price["'][^>]*content=["']([^"']+)["']/i,
    /content=["'][^"']*["'][^>]*itemprop=["']price["']/i,
  ];
  for (const p of pricePatterns) {
    const m = html.match(p);
    if (m?.[1]) return `¥${m[1]}`;
  }
  return '';
}

function inferStore(url: string): string {
  if (/taobao\.com|tmall\.com/i.test(url)) return '淘宝/天猫';
  if (/jd\.com/i.test(url)) return '京东';
  if (/amazon\./i.test(url)) return 'Amazon';
  if (/pinduoduo\.com/i.test(url)) return '拼多多';
  if (/suning\.com/i.test(url)) return '苏宁';
  try { return new URL(url).hostname.replace('www.', ''); } catch { return ''; }
}

/**
 * 提取文章正文(批次 24)。优先微信公众号 js_content / rich_media_content,
 * 再退到 <article>,最后取最大文本块。去标签、压空白,封顶 12000 字。
 */
function extractArticleText(html: string): string {
  const pick = (re: RegExp): string => {
    const m = html.match(re);
    return m ? m[1] : '';
  };
  let body =
    pick(/<div[^>]*id=["']js_content["'][^>]*>([\s\S]*?)<\/div>\s*(?:<script|<div[^>]*id=["']js_)/i) ||
    pick(/<div[^>]*class=["'][^"']*rich_media_content[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*(?:<script|<div[^>]*id=)/i) ||
    pick(/<article[^>]*>([\s\S]*?)<\/article>/i);

  if (!body) {
    // 兜底:所有 <p> 拼起来
    const paras = html.match(/<p[^>]*>([\s\S]*?)<\/p>/gi) || [];
    body = paras.join('\n');
  }

  const text = body
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return text.length >= 40 ? text.slice(0, 12000) : '';
}

export async function POST(req: NextRequest): Promise<NextResponse<ParseResult>> {
  // 鉴权 + 限流(此前无任何鉴权 → 未登录者可让服务器代抓任意 URL)。
  const guard = await guardAiRoute(req, 'parse-url');
  if (guard) return guard as NextResponse<ParseResult>;

  let url: string;
  try {
    const body = await req.json() as { url?: string };
    url = (body.url ?? '').trim();
    if (!url) throw new Error('missing url');
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    new URL(url); // validate
  } catch (e) {
    return NextResponse.json({ ok: false, error: 'invalid_url' });
  }

  // SSRF 防护:挡内网/环回/链路本地/云元数据(169.254.169.254)。
  // ① 主机名同步检查;② DNS 解析复查(主机名指向私有 IP 也挡)。
  if (isBlockedUrl(url)) {
    return NextResponse.json({ ok: false, error: 'blocked_host' });
  }
  try {
    const host = new URL(url).hostname;
    const addrs = await lookup(host, { all: true });
    if (addrs.some((a) => isPrivateOrReservedIp(a.address))) {
      return NextResponse.json({ ok: false, error: 'blocked_host' });
    }
  } catch {
    return NextResponse.json({ ok: false, error: 'dns_error' });
  }

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; NesioBot/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
      redirect: 'manual', // 不自动跟随跳转,避免绕过 SSRF 检查跳到内网
      signal: AbortSignal.timeout(8000),
    });

    if (res.status >= 300 && res.status < 400) {
      return NextResponse.json({ ok: false, error: 'redirect_blocked' });
    }
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: `fetch_error_${res.status}` });
    }
    const contentLength = Number(res.headers.get('content-length') || 0);
    if (contentLength > MAX_FETCH_BYTES) {
      return NextResponse.json({ ok: false, error: 'too_large' });
    }

    const html = (await res.text()).slice(0, MAX_FETCH_BYTES);

    const title = extractTitle(html) || url;
    const image = extractMeta(html, 'og:image') || extractMeta(html, 'twitter:image');
    const description = extractMeta(html, 'og:description') || extractMeta(html, 'description');
    const price = extractPrice(html, url);
    const store = inferStore(url);
    // 批次 24:文章正文提取(微信公众号 / 通用),供 Memory 存文 + ADHD 阅读器
    const article = extractArticleText(html);

    return NextResponse.json({ ok: true, title, image, price, store, description, article });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg.includes('timeout') ? 'timeout' : 'fetch_failed' });
  }
}
