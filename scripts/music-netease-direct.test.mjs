/**
 * 行为契约:直连网易(2026-07-31,用户:「意味着我电脑要一直开着?」)。
 *
 * 背景:原来要 NETEASE_API_BASE 指向一个**常驻的第三方服务**。为两个接口养一整个
 * 服务不划算,协议搬进 lib/platform/music/netease-protocol,跟 Nesio 一起部署。
 *
 * ── 这份契约压不了什么,先说清楚 ────────────────────────────────────────────
 * 写这份代码的环境连不上 music.163.com(出网策略 403),所以**加密协议本身没有
 * 经过真机验证**。密文对不对,只有实测知道 —— 这里不假装能验证它,
 * 也不写一条「看起来在测加密」实则只在测自己的断言。
 *
 * ── 那压什么 ────────────────────────────────────────────────────────────────
 * 压的是**不需要网络就能判错的那部分**,而且每一条都对应一个真实会犯的错:
 *  ① 四态分派。受限 / 风控 / 故障 / 成功,四个不同的下一步动作。
 *     合并任意两个,用户就会对着一堵墙一直撞:
 *     受限说成故障 → 一直点重试;风控说成受限 → 一首一首试到放弃。
 *  ② http→https 改写。Nesio 跑在 https 上,混合内容被浏览器**静默**拦掉,
 *     表现是「点了没声音、一行报错都没有」。
 *  ③ CSP 放行 126.net。不放行的表现一模一样 —— 这就是 Plaid 当年那个坑。
 *  ④ 协议层**绝不能**被客户端 import(它 require node:crypto)。
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const nodeRequire = createRequire(import.meta.url);

/** 带真 require + 可替换 fetch 的加载器 —— 协议层要用 node:crypto。 */
function loadProtocol(fakeFetch) {
  const js = ts.transpileModule(read('lib/platform/music/netease-protocol.ts'), {
    // esModuleInterop 必须开:不开的话 `import crypto from 'node:crypto'` 会转译成
    // `node_crypto_1.default.randomBytes`,而 require('node:crypto') 上没有 .default ——
    // 于是加密整条静默抛异常、被 catch 吞掉,测出来是一句「网络故障」。
    // (生产走 Next 的编译器,那边是对的;错的是这个 loader。)
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports,
    require: (id) => nodeRequire(id),
    fetch: fakeFetch,
    crypto, Buffer, URLSearchParams, URL,
    console, Object, Array, String, Number, Math, JSON, Set, Map, Boolean, Promise, Error, BigInt,
  });
  return mod.exports;
}

/** 造一个只认得几条固定路径的假上游。 */
function fakeUpstream(plan) {
  return async (url, init) => {
    const u = String(url);
    for (const [match, make] of plan) {
      if (u.includes(match)) return make(init);
    }
    throw new Error(`unexpected fetch: ${u}`);
  };
}

const jsonRes = (body) => ({ ok: true, status: 200, json: async () => body, headers: { get: () => null } });
const redirectRes = (loc) => ({ ok: false, status: 302, json: async () => ({}), headers: { get: (k) => (k.toLowerCase() === 'location' ? loc : null) } });
const deadRes = () => ({ ok: false, status: 502, json: async () => ({}), headers: { get: () => null } });

/* ── ① 四态分派 ─────────────────────────────────────────────────────────── */

// 拿到地址 = 能放。
{
  const p = loadProtocol(fakeUpstream([
    ['/weapi/song/enhance/player/url', () => jsonRes({ code: 200, data: [{ url: 'http://m801.music.126.net/x.mp3' }] })],
  ]));
  const r = await p.songUrlDirect('123');
  assert.equal(r.kind, 'ok', '拿到非空 url 就是能放');
  // ② 混合内容:https 页面上放 http 音频会被浏览器静默拦掉。
  assert.equal(r.value, 'https://m801.music.126.net/x.mp3', 'http 必须改写成 https —— 否则表现是「点了没声音、一行报错都没有」');
}

// weapi 给 null + outer/url 302 到死链 = 这一首受限(**不是**故障)。
{
  const p = loadProtocol(fakeUpstream([
    ['/weapi/song/enhance/player/url', () => jsonRes({ code: 200, data: [{ url: null }] })],
    ['/song/media/outer/url', () => redirectRes('https://music.163.com/404')],
  ]));
  const r = await p.songUrlDirect('123');
  assert.equal(r.kind, 'restricted', '两条都没给出地址、且落点是死链 = 这一首受限,不是故障');
}

// 风控码 = blocked。**不能**说成受限:换歌一点用都没有。
{
  const p = loadProtocol(fakeUpstream([
    ['/weapi/song/enhance/player/url', () => jsonRes({ code: -460, data: [] })],
    ['/song/media/outer/url', () => deadRes()],
  ]));
  const r = await p.songUrlDirect('123');
  assert.equal(r.kind, 'blocked', '被风控要单独报 —— 说成「这首受限」会让用户一首一首试到放弃');
}

// 两条都挂 = 故障,这时候重试才是对的动作。
{
  const p = loadProtocol(fakeUpstream([
    ['/weapi/song/enhance/player/url', () => { throw new Error('boom'); }],
    ['/song/media/outer/url', () => { throw new Error('boom'); }],
  ]));
  const r = await p.songUrlDirect('123');
  assert.equal(r.kind, 'failed', '两条路都挂了才叫故障');
}

// 回退真的会被走到:第一条给 null,第二条给真地址。
{
  const p = loadProtocol(fakeUpstream([
    ['/weapi/song/enhance/player/url', () => jsonRes({ code: 200, data: [{ url: null }] })],
    ['/song/media/outer/url', () => redirectRes('http://m701.music.126.net/y.mp3')],
  ]));
  const r = await p.songUrlDirect('123');
  assert.equal(r.kind, 'ok', '第一条拿不到时必须真的去试第二条 —— 否则「两条都试」只是注释里的话');
  assert.equal(r.value, 'https://m701.music.126.net/y.mp3', '回退路径同样要改写成 https');
}

/* ── 搜索:风控与故障分开 ────────────────────────────────────────────────── */

{
  const p = loadProtocol(fakeUpstream([['/weapi/search/get', () => jsonRes({ code: 200, result: { songs: [
    { id: 1, name: '晴天', artists: [{ name: '周杰伦' }], album: { name: '叶惠美' }, duration: 269000 },
  ] } })]]));
  const r = await p.searchDirect('晴天');
  assert.equal(r.kind, 'ok');
  assert.equal(r.value.length, 1);
  assert.equal(r.value[0].title, '晴天');
  assert.equal(r.value[0].artist, '周杰伦');
  assert.equal(r.value[0].durationSec, 269, '时长上游给毫秒,这里必须换算成秒 —— 不换算的话界面上每首歌都是几万分钟');
}
{
  const p = loadProtocol(fakeUpstream([['/weapi/search/get', () => jsonRes({ code: -460 })]]));
  assert.equal((await p.searchDirect('x')).kind, 'blocked', '搜索被风控也要单独报 —— 换个词再搜一遍没用');
}
{
  const p = loadProtocol(fakeUpstream([['/weapi/search/get', () => { throw new Error('boom'); }]]));
  assert.equal((await p.searchDirect('x')).kind, 'failed');
}

/* ── 字段映射:两套字段名都要认 ─────────────────────────────────────────── */

{
  const p = loadProtocol(fakeUpstream([]));
  // 新接口给 ar/al/dt,老接口给 artists/album/duration。只认一套的话,
  // 哪天上游换了形状,界面上会是一列没有歌手、没有时长的空壳。
  const h = p.toHit({ id: 9, name: 'A', ar: [{ name: 'X' }, { name: 'Y' }], al: { name: 'Z' }, dt: 61000 });
  assert.equal(h.artist, 'X / Y', '多个歌手要拼起来');
  assert.equal(h.album, 'Z');
  assert.equal(h.durationSec, 61);
}

/* ── RSA:自己写的模幂必须跟 OpenSSL 一模一样 ───────────────────────────── */

{
  // 这是这份契约里**唯一**能真正验证密码学正确性的一条,所以它值得存在:
  // no-padding 的 RSA 就是 m^e mod n,而 OpenSSL 也能做同一件事,于是逐位对照。
  //
  // 关键:对照的是**生产的 rsaNoPadHex**,不是测试自己重写的一份模幂。
  // 第一版正是那么写的 —— 结果把 padStart 从生产代码里删掉,这条照样绿:
  // 它压的是测试自己。断言错了对象,等于没有断言。
  //
  // 用的是生产里那个真实的公钥常量(从 n/e 拼一份 JWK 交给 OpenSSL,
  // 绕开 PEM/DER —— 我第一版凭记忆拼的 PEM 就是在这儿被 OpenSSL 拒收的)。
  // 顺带多验证一件事:那个模数得是一把**合法的 RSA 公钥**,拼不出 key 这里就红。
  //
  // 这条**压不了**什么,说清楚:模数改掉一位它不会红 —— 测试用的 n 就是从生产读的,
  // 两边一起改仍然自洽,而改完照样是一把合法公钥。常量对不对只有实测知道。
  // 能做的是钉住「不许被无意改动」:见下面的指纹。
  const p = loadProtocol(fakeUpstream([]));
  const nHex = p.RSA_N.toString(16).padStart(256, '0');
  const eHex = p.RSA_E.toString(16).padStart(6, '0');
  const publicKey = crypto.createPublicKey({
    format: 'jwk',
    key: {
      kty: 'RSA',
      n: Buffer.from(nHex, 'hex').toString('base64url'),
      e: Buffer.from(eHex, 'hex').toString('base64url'),
    },
  });
  const osslHex = (secret) => {
    const raw = Buffer.from(secret, 'utf8');
    const padded = Buffer.concat([Buffer.alloc(128 - raw.length), raw]);
    return crypto.publicEncrypt({ key: publicKey, padding: crypto.constants.RSA_NO_PADDING }, padded).toString('hex');
  };
  const randomSecret = () => crypto.randomBytes(16).toString('hex').slice(0, 16);

  for (let i = 0; i < 200; i += 1) {
    const s = randomSecret();
    assert.equal(p.rsaNoPadHex(s), osslHex(s), '模幂实现必须与 OpenSSL 的 RSA_NO_PADDING 逐位一致');
  }

  // 「忘了补齐」只在**裸输出不足 256 位**的样本上才暴露(约 1/256 概率)。
  // 靠随机撞是碰运气,会写出一条时红时绿的契约 —— 所以主动找一个这样的样本,
  // 找到了再断言。找不到才是真出问题(那说明这条对照根本考验不到补齐)。
  const ZERO = BigInt(0); const ONE = BigInt(1); const TWO = BigInt(2);
  const bareModPow = (base, exp, mod) => {
    let r = ONE; let b = base % mod; let x = exp;
    while (x > ZERO) { if (x % TWO === ONE) r = (r * b) % mod; b = (b * b) % mod; x /= TWO; }
    return r;
  };
  let shortSample = '';
  for (let i = 0; i < 20000 && !shortSample; i += 1) {
    const s = randomSecret();
    const bare = bareModPow(BigInt(`0x${Buffer.from(s, 'utf8').toString('hex')}`), p.RSA_E, p.RSA_N).toString(16);
    if (bare.length < 256) shortSample = s;
  }
  assert.ok(shortSample, '没找到裸输出不足 256 位的样本 —— 这条对照就考验不到补齐那一步了');
  assert.equal(p.rsaNoPadHex(shortSample).length, 256, '密文必须补齐到 128 字节;短两位上游直接判非法');
  assert.equal(p.rsaNoPadHex(shortSample), osslHex(shortSample), '短输出那一支同样要跟 OpenSSL 一致');

  // 公钥指纹。它**不能**证明这把公钥是对的(证明不了 —— 见上面那段),
  // 它能做的是让改动必须是**有意的**:顺手改一位、复制粘贴掉一段,这里当场红。
  // 哪天实测发现要换公钥,连这一行一起改,并在 commit 里说清为什么。
  assert.equal(
    crypto.createHash('sha256').update(`${nHex}:${p.RSA_E.toString(16)}`).digest('hex'),
    '16ec367454543456714d63a81d31e74e886f7cb0684a13e41eb601a45b9d9221',
    '网易公钥常量被改动了 —— 若是有意为之(实测发现要换),连同这一行指纹一起更新',
  );
}

/* ── weapi 包体的结构不变量 ─────────────────────────────────────────────── */

{
  const p = loadProtocol(fakeUpstream([]));
  const a = p.weapiBody({ s: 'x' });
  const b = p.weapiBody({ s: 'x' });
  assert.ok(a.get('params') && a.get('encSecKey'), '两个字段都要有');
  // RSA no-padding 出来正好 128 字节 = 256 个 hex 字符。长度不对说明 padding 用错了。
  assert.equal(a.get('encSecKey').length, 256, 'encSecKey 必须是 128 字节的 hex');
  assert.ok(/^[0-9a-f]+$/.test(a.get('encSecKey')), 'encSecKey 是小写 hex');
  // 密钥每次重掷 —— 固定下来就成了一个可被识别的指纹。
  assert.notEqual(a.get('params'), b.get('params'), '同样的负载两次结果必须不同(随机密钥)');
}

/* ── ③ CSP:音频域放行了才听得到 ────────────────────────────────────────── */

{
  const cfg = read('next.config.js');
  assert.ok(
    /media-src[^"]*126\.net/.test(cfg),
    '网易的音频落在 126.net,不在 media-src 里放行的表现就是「点了没声音、控制台之外没有任何线索」——Plaid 当年那个坑',
  );
}

/* ── ④ 协议层不许进客户端 ───────────────────────────────────────────────── */

{
  // 它 require('node:crypto'),被客户端组件 import 会当场炸 bundle。
  const offenders = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(rel); continue; }
      if (!/\.(ts|tsx)$/.test(e.name)) continue;
      const src = read(rel);
      if (/from '@\/lib\/platform\/music\/netease-protocol'/.test(src) && !rel.startsWith('app/api/')) {
        offenders.push(rel);
      }
    }
  };
  walk('components');
  walk('lib');
  assert.equal(offenders.join(','), '', `协议层只许服务端路由 import(它要 node:crypto);越界的:${offenders.join(', ')}`);
}

/* ── 路由:四态如实转述,不合并 ─────────────────────────────────────────── */

{
  const route = read('app/api/portal/music/netease/song-url/route.ts');
  assert.ok(/r\.kind === 'restricted'[\s\S]{0,300}reason: 'restricted'/.test(route), '受限要原样转述成 reason:restricted');
  assert.ok(/r\.kind === 'blocked'[\s\S]{0,300}reason: 'blocked'/.test(route), '风控要单独转述成 reason:blocked,不许并进 restricted');
  assert.ok(/status: 502/.test(route), '只有真故障才是 502');

  const search = read('app/api/portal/music/netease/search/route.ts');
  assert.ok(/r\.kind === 'blocked'[\s\S]{0,300}reason: 'blocked'/.test(search), '搜索的风控同样要单独报');

  const panel = read('components/portal/music/MusicPanel.tsx');
  // 界面上三种结局给三个**不同**的按钮。顺序被压死,调换即红。
  assert.ok(
    /kind === 'failed' \? \([\s\S]{0,260}再试一次[\s\S]{0,200}\) : neteaseTrackMsg\.kind === 'restricted' \? \([\s\S]{0,260}换一首[\s\S]{0,240}\) : \([\s\S]{0,260}知道了/.test(panel),
    '故障→再试一次;受限→换一首;风控→知道了。三个动作各不相同,共用一个按钮就是给错指引',
  );
  // 风控那句必须说明「换歌没用」,否则用户照旧会一首一首试。
  const blockedMsg = panel.match(/kind: 'blocked',\s*\n\s*text: L\(dict,\s*\n\s*'([^']+)',\s*\n\s*'([^']+)'/);
  assert.ok(blockedMsg, '风控必须有自己的一句话(中英各一份)');
  assert.ok(/换歌也一样|跟这一首没关系/.test(blockedMsg[1]), '风控那句要点明「跟这一首没关系」——否则用户会一首一首试到放弃');
  assert.ok(!/[一-龥]/.test(blockedMsg[2]), '英文版里不该混中文');

  // 界面上不该再出现环境变量名:直连之后网易**不需要配任何东西**。
  assert.ok(!/NETEASE_API_BASE/.test(panel), '直连之后用户无需配置,内部环境变量名不该出现在界面上');
}

console.log('music-netease-direct: OK(四态分派 / 回退真走到 / 混合内容改写 / 风控不冒充受限 / CSP 放行音频域 / 协议层不进客户端 / 界面三个动作各不相同)');
