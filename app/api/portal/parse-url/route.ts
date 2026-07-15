/**
 * POST /api/portal/parse-url
 *
 * Fetches a URL and extracts product metadata (og:title, og:image, price).
 * Used by the 冷冻仓 flow to identify what the user wants to buy.
 */
import { NextRequest, NextResponse } from 'next/server';
import dns from 'node:dns/promises';
import { Agent } from 'undici';
import { guardAiRoute } from '@/lib/portal/api-auth';
import { extractArticleText } from '@/lib/portal/readability';

export const dynamic = 'force-dynamic';

// ── SSRF 防护:阻止服务端被诱导去 fetch 内网/云元数据端点 ──
function ipv4Private(ip: string): boolean {
  const p = ip.split('.').map((n) => Number(n));
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true; // 畸形当不安全
  const [a, b] = p;
  if (a === 0 || a === 10 || a === 127) return true;         // 本机/私网
  if (a === 169 && b === 254) return true;                    // 链路本地 + 云元数据 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && (b === 168 || b === 0)) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;          // CGNAT
  if (a >= 224) return true;                                  // 组播/保留
  return false;
}
function ipPrivate(ip: string): boolean {
  const low = ip.toLowerCase();
  if (low === '::1' || low === '::') return true;
  const mapped = low.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return ipv4Private(mapped[1]);
  if (low.startsWith('fe80') || low.startsWith('fc') || low.startsWith('fd')) return true; // 链路本地 / ULA
  if (low.includes(':')) return false;                        // 其它 IPv6 全局单播放行
  return ipv4Private(low);
}
/** 校验 URL 指向公网可解析主机;返回"校验通过的 IP 列表"(IP 字面量主机返回空 = 无需 pin)。
 *  不安全则抛错。 */
async function assertSafeUrl(raw: string): Promise<string[]> {
  const u = new URL(raw);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('blocked_scheme');
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) throw new Error('blocked_host');
  if (/^[\d.]+$/.test(host) || host.includes(':')) {
    if (ipPrivate(host)) throw new Error('blocked_ip');
    return []; // IP 字面量:无 DNS,fetch 直连该 IP,不存在重绑定
  }
  const addrs = await dns.lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => ipPrivate(a.address))) throw new Error('blocked_dns');
  return addrs.map((a) => a.address);
}
/** 逐跳校验的安全 fetch(手动跟随重定向,防重定向绕过 SSRF)。
 *  防 DNS 重绑定 TOCTOU:把连接 pin 到刚校验过的 IP(而不是让 fetch 再独立解析一次同名主机,
 *  否则校验解析到公网 IP、fetch 解析到 169.254.169.254 就读到了云元数据)。 */
async function safeFetch(raw: string, maxHops = 3): Promise<Response> {
  let current = raw;
  for (let hop = 0; hop <= maxHops; hop++) {
    const safeIps = await assertSafeUrl(current);
    const dispatcher = safeIps.length
      ? new Agent({
          connect: {
            // 只连校验通过的那个 IP;主机名仍用于 TLS SNI / Host 头,证书照常校验。
            lookup: (_hostname, _opts, cb: (err: Error | null, address: string, family: number) => void) => {
              const ip = safeIps[0];
              cb(null, ip, ip.includes(':') ? 6 : 4);
            },
          },
        })
      : undefined;
    const opts: RequestInit & { dispatcher?: Agent } = {
      redirect: 'manual',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; NesioBot/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
      signal: AbortSignal.timeout(8000),
    };
    if (dispatcher) opts.dispatcher = dispatcher;
    try {
      const res = await fetch(current, opts as RequestInit);
      const loc = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
      if (loc) {
        current = new URL(loc, current).toString();
        await dispatcher?.close().catch(() => {}); // 该跳只读了头,可安全关闭
        continue;
      }
      return res; // 成功返回:body 还要被读,dispatcher 随请求结束回收
    } catch (err) {
      await dispatcher?.close().catch(() => {});
      throw err;
    }
  }
  throw new Error('too_many_redirects');
}

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
    if (m?.[1]) return `$${m[1]}`;
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


export async function POST(req: NextRequest): Promise<NextResponse<ParseResult>> {
  const guard = await guardAiRoute(req, 'parse-url', { limit: 30 });
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

  try {
    const res = await safeFetch(url); // 逐跳 SSRF 校验 + 重定向再校验

    if (!res.ok) {
      return NextResponse.json({ ok: false, error: `fetch_error_${res.status}` });
    }

    const html = await res.text();

    const title = extractTitle(html) || url;
    const image = extractMeta(html, 'og:image') || extractMeta(html, 'twitter:image');
    const description = extractMeta(html, 'og:description') || extractMeta(html, 'description');
    const price = extractPrice(html, url);
    const store = inferStore(url);
    // 批次 24/193:文章正文提取(Readability-lite:去广告去无关,留正文 + 关键图片行内 marker)
    const article = extractArticleText(html, url);

    return NextResponse.json({ ok: true, title, image, price, store, description, article });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg.includes('timeout') ? 'timeout' : 'fetch_failed' });
  }
}
