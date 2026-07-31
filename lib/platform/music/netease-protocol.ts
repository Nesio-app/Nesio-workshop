/**
 * 直连网易云的协议层(2026-07-31,用户:「意味着我电脑要一直开着?」)。
 *
 * 不用。这个文件存在就是为了让答案是「不用」——
 * 原来 NETEASE_API_BASE 指向的是一个**要常驻的第三方服务**(NeteaseCloudMusicApi),
 * 那台机器得一直开着。而 Nesio 只用它两个接口:搜索、取播放地址。
 * 为两个接口养一整个服务,重得不成比例,还多一处会坏、要维护、要防裸奔的东西。
 *
 * 所以搬进来:这里自己说网易那套请求协议,跟 Nesio 一起部署,不多任何常驻进程。
 *
 * ── 只在服务端 ──────────────────────────────────────────────────────────────
 * 用 node:crypto,且**绝不能**被客户端 bundle 进去。调用方只有 app/api 下那两条路由。
 *
 * ── 这是逆向出来的协议,会坏 ────────────────────────────────────────────────
 * 所以每一处失败都要**说得出是哪一种**,不许合并:
 *   · 这一首受限          → 换一首(重试永远不会成功)
 *   · 整台服务器被风控    → 换出口 / 指一个自己的实例(换歌没用)
 *   · 网络/上游挂         → 重试
 * 合成一句「播放失败」的代价,就是用户对着一堵墙一直撞 —— 而三堵墙的出口完全不同。
 *
 * ── 没有实测过 ──────────────────────────────────────────────────────────────
 * 写这份代码的环境连不上 music.163.com(出网策略 403),所以协议本身**未经真机验证**。
 * 因此:凡是拿不准的地方一律**如实报失败**,不做「大概成功了」的推断;
 * 并且保留 NETEASE_API_BASE 作为逃生口 —— 直连坏掉时,指一个自己的实例还能用。
 */

import crypto from 'node:crypto';

/* ── weapi 请求加密 ──────────────────────────────────────────────────────── */

const PRESET_KEY = '0CoJUm6Qyw8W8jud';
const AES_IV = '0102030405060708';
const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/**
 * 公钥用**模数 + 指数**直接给,不走 PEM。
 *
 * 两个理由,后一个是实测出来的:
 *  · no-padding 的 RSA 就是一次模幂(m^e mod n),没有任何 padding 逻辑要 OpenSSL 代劳;
 *  · `crypto.publicEncrypt` 要一份合法的 SPKI DER,而这套协议流传的形式本来就是
 *    modulus/exponent —— 我第一版凭记忆拼了个 PEM,OpenSSL 当场 `asn1 too long` 拒收。
 *    自己算反而少一层会拼错的东西。
 * 1024 位 = 128 字节 = 256 个 hex 字符,长度自检见下面的 assert 式 padStart。
 */
export const RSA_N = BigInt(
  '0x00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725'
  + '152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312'
  + 'ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424'
  + 'd813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7',
);
export const RSA_E = BigInt('0x010001');

// 字面量写法(1n)要 target ≥ ES2020,而这个项目的 target 更低 ——
// 为一个文件抬全局 target 不值当,用构造函数形式即可,行为完全一样。
const ZERO = BigInt(0);
const ONE = BigInt(1);
const TWO = BigInt(2);

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = ONE;
  let b = base % mod;
  let e = exp;
  while (e > ZERO) {
    if (e % TWO === ONE) result = (result * b) % mod;
    b = (b * b) % mod;
    e /= TWO;
  }
  return result;
}

function aesCbcBase64(text: string, key: string): string {
  const c = crypto.createCipheriv('aes-128-cbc', Buffer.from(key, 'utf8'), Buffer.from(AES_IV, 'utf8'));
  return Buffer.concat([c.update(Buffer.from(text, 'utf8')), c.final()]).toString('base64');
}

/**
 * RSA no-padding。明文左侧补零到 128 字节 —— 补零在数值上是无操作,
 * 所以直接把原文当大整数即可;要紧的是**输出**必须补足 256 个 hex 字符。
 * 不补的话,首字节为 0 的那些结果会短两位,上游直接判成密文非法。
 */
export function rsaNoPadHex(text: string): string {
  const m = BigInt(`0x${Buffer.from(text, 'utf8').toString('hex')}`);
  return modPow(m, RSA_E, RSA_N).toString(16).padStart(256, '0');
}

/** 把一个 JSON 负载包成 weapi 的 { params, encSecKey }。 */
export function weapiBody(payload: unknown): URLSearchParams {
  const text = JSON.stringify(payload);
  // 16 位随机密钥。必须每次重掷 —— 固定下来就成了一个可被识别的指纹。
  const rnd = crypto.randomBytes(16);
  let secret = '';
  for (let i = 0; i < 16; i += 1) secret += BASE62[(rnd[i] as number) % 62];
  const body = new URLSearchParams();
  body.set('params', aesCbcBase64(aesCbcBase64(text, PRESET_KEY), secret));
  body.set('encSecKey', rsaNoPadHex(secret.split('').reverse().join('')));
  return body;
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function headers(): Record<string, string> {
  return {
    'Content-Type': 'application/x-www-form-urlencoded',
    'User-Agent': UA,
    Referer: 'https://music.163.com',
    Origin: 'https://music.163.com',
    Cookie: 'os=pc; appver=8.9.70',
  };
}

/* ── 上游结果的三种形状 ──────────────────────────────────────────────────── */

/**
 * `blocked` 与 `failed` 分开,是这一层最要紧的区分。
 * 被风控时**每一首**都取不到 —— 界面若把它说成「这首受限」,用户会一首一首试到放弃,
 * 而真相是这台服务器暂时不被接受,换歌一点用都没有。
 */
export type UpstreamOutcome<T> =
  | { kind: 'ok'; value: T }
  | { kind: 'restricted' }
  | { kind: 'blocked' }
  | { kind: 'failed' };

/** 网易用 -460/-462 这类码表示「这个请求方被挡了」,不是这一首的问题。 */
function isRiskControl(code: unknown): boolean {
  const n = Number(code);
  return n === -460 || n === -462 || n === 250;
}

async function postWeapi(url: string, payload: unknown): Promise<Record<string, unknown> | null> {
  const res = await fetch(url, {
    method: 'POST',
    headers: headers(),
    body: weapiBody(payload).toString(),
    cache: 'no-store',
  });
  if (!res.ok) return null;
  return (await res.json()) as Record<string, unknown>;
}

/* ── 搜索 ────────────────────────────────────────────────────────────────── */

export interface NeteaseHit {
  id: string;
  title: string;
  artist: string;
  album: string;
  durationSec: number;
}

export async function searchDirect(q: string, limit = 20): Promise<UpstreamOutcome<NeteaseHit[]>> {
  try {
    const j = await postWeapi('https://music.163.com/weapi/search/get', {
      s: q, type: 1, limit, offset: 0, csrf_token: '',
    });
    if (!j) return { kind: 'failed' };
    if (isRiskControl(j['code'])) return { kind: 'blocked' };
    const songs = ((j['result'] as { songs?: Array<Record<string, unknown>> } | undefined)?.songs) || [];
    return { kind: 'ok', value: songs.map(toHit).filter((h) => h.id && h.title) };
  } catch {
    return { kind: 'failed' };
  }
}

export function toHit(s: Record<string, unknown>): NeteaseHit {
  // 两套字段名都认:weapi 老接口给 artists/album/duration,新接口给 ar/al/dt。
  const artists = (Array.isArray(s['artists']) ? s['artists'] : Array.isArray(s['ar']) ? s['ar'] : []) as Array<{ name?: string }>;
  const album = (s['album'] || s['al']) as { name?: string } | undefined;
  const ms = Number(s['duration'] ?? s['dt']) || 0;
  return {
    id: String(s['id'] ?? ''),
    title: String(s['name'] ?? ''),
    artist: artists.map((a) => String(a?.name || '')).filter(Boolean).join(' / '),
    album: String(album?.name || ''),
    durationSec: Math.round(ms / 1000),
  };
}

/* ── 取播放地址 ──────────────────────────────────────────────────────────── */

/**
 * 拿到的地址常常是 `http://`。Nesio 跑在 https 上,
 * 混合内容会被浏览器**静默**拦掉 —— 表现正是「点了没声音、控制台一行报错都没有」。
 * 126.net 支持 https,直接改写协议头。
 */
function toHttps(u: string): string {
  return u.startsWith('http://') ? `https://${u.slice(7)}` : u;
}

/** 受限时 outer/url 会 302 到这里(或到一个空文件)。 */
function isDeadRedirect(loc: string): boolean {
  return !loc || /music\.163\.com\/404/.test(loc) || /\/404($|\?)/.test(loc);
}

/**
 * 两条路都试。**不是「猜不准就都塞进来」**:这两条上游的行为确实不同 ——
 * weapi 那条给得出码率和明确的 code,outer/url 那条不需要任何账号态。
 * 两条都拿不到,才敢说这一首受限 —— 这比单条的结论硬,也正是这个仓的判据方向:
 * 说「不能放」要有证据,而不是「没拿到就算了」。
 */
export async function songUrlDirect(id: string): Promise<UpstreamOutcome<string>> {
  let sawBlocked = false;
  let sawFailure = false;

  try {
    const j = await postWeapi('https://music.163.com/weapi/song/enhance/player/url', {
      ids: JSON.stringify([Number(id)]), br: 320000, csrf_token: '',
    });
    if (!j) sawFailure = true;
    else if (isRiskControl(j['code'])) sawBlocked = true;
    else {
      const first = (j['data'] as Array<{ url?: string | null; code?: number }> | undefined)?.[0];
      const url = String(first?.url || '');
      if (url) return { kind: 'ok', value: toHttps(url) };
    }
  } catch { sawFailure = true; }

  // 回退:不需要账号态的老接口。302 的落点就是答案。
  try {
    const res = await fetch(`https://music.163.com/song/media/outer/url?id=${encodeURIComponent(id)}.mp3`, {
      method: 'GET', headers: { 'User-Agent': UA, Referer: 'https://music.163.com' },
      redirect: 'manual', cache: 'no-store',
    });
    const loc = res.headers.get('location') || '';
    if (loc && !isDeadRedirect(loc)) return { kind: 'ok', value: toHttps(loc) };
    // 有 Location 且是死链 = 这一首确实取不到,不是故障。
    if (loc) return { kind: 'restricted' };
    sawFailure = true;
  } catch { sawFailure = true; }

  // 到这儿两条都没给出地址。风控优先说 —— 它意味着换歌没用。
  if (sawBlocked) return { kind: 'blocked' };
  if (sawFailure) return { kind: 'failed' };
  return { kind: 'restricted' };
}
