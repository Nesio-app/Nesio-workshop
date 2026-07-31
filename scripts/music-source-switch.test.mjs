/**
 * 行为契约:音乐模块的四个音源(2026-07-30)。
 *
 * 压的不是「有没有这个功能」,是**四条会被后来的人顺手改坏的判断**:
 *
 *  ① 跨播放模型换源必须提前说。本地/Apple 是 Nesio 自己出声,Spotify 是遥控 ——
 *     切过去车机屏幕上显示的 App 会变。这句话要在切之前说,不是切完让用户自己发现。
 *  ② 「能不能放」是正向判据。configured / authorized / streamable 三项齐了才算能放;
 *     metadata-only 的源(没有国内出口的网易)恒不能放。反着写的症状很具体:
 *     点播放,静默无声,而界面上一切正常。
 *  ③ Spotify 的 streamable 必须**确认是 Premium**。连上了 ≠ 能放。
 *  ④ 每一条失败路径都要被渲染出来。算出了原因却没写进 DOM,等于没算。
 *
 * 还有一条边角但要命的:一首放完之后,repeat=off 到头必须**停**。
 * 不停的表现是睡前放的歌响了一整夜。
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

function loadTs(rel) {
  const js = ts.transpileModule(read(rel), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports, require: () => ({}),
    console, Object, Array, String, Number, Math, JSON, Set, Map, Boolean,
  });
  return mod.exports;
}

const cat = loadTs('lib/platform/music/source-catalog.ts');
const queue = loadTs('lib/platform/music/queue.ts');

const READY = { configured: true, authorized: true, streamable: true };

/* ── ① 跨播放模型换源必须提前说 ─────────────────────────────────────────── */

// 本地(Nesio 自己出声)→ Spotify(遥控):必须有话说,且那句话要点名车机上显示的是谁。
{
  const notice = cat.switchNotice('local', 'spotify');
  assert.ok(notice, '本地 → Spotify 跨了播放模型,必须提前提示');
  assert.ok(notice.includes('Spotify'), '提示里要点名车机上显示的是 Spotify');
  // 反向也要说:从遥控切回自己播,Spotify 会停。
  assert.ok(cat.switchNotice('spotify', 'local'), 'Spotify → 本地 也跨模型,同样要提示');
}
// 同模型之间(本地 ↔ Apple,两边都是 Nesio 自己出声)不打扰用户。
assert.equal(cat.switchNotice('local', 'apple'), '', '同为 in-app,用户感知不到差别,不该弹提示');
assert.equal(cat.switchNotice('local', 'local'), '', '没换源就没有提示');

// 面板真的把它挡在切换之前 —— 算了不用等于没算。
{
  const panel = read('components/portal/music/MusicPanel.tsx');
  assert.ok(
    /const notice = switchNotice\(source, to, dict\);[\s\S]{0,200}setPendingSwitch\(\{ to, notice \}\)/.test(panel),
    'requestSwitch 必须先算 switchNotice,有话说就转成待确认,而不是直接换过去',
  );
  assert.ok(
    panel.includes('<p>{pendingSwitch.notice}</p>'),
    '那句提示必须真的渲染出来',
  );
}

/* ── ② 能不能放 = 正向判据 ──────────────────────────────────────────────── */

assert.equal(cat.canPlayNow('local', READY), true, '三项齐了的本地源就是能放');
for (const missing of ['configured', 'authorized', 'streamable']) {
  const r = { ...READY, [missing]: false };
  assert.equal(cat.canPlayNow('local', r), false, `缺 ${missing} 就不能算能放`);
}
// metadata-only:哪怕三项全给 true 也不能放 —— 它的限制在播放模型上,不在就绪状态上。
assert.equal(cat.canPlayNow('netease', READY), false, '网易是 metadata-only,恒不可播');
// 不能放时必须给得出一句话。
assert.ok(cat.blockedReason('netease', READY), '不能放就必须说得出为什么');
assert.equal(cat.blockedReason('local', READY), '', '能放的时候不该有多余的话');

/* ── ③ 回退链只收真能放的 ───────────────────────────────────────────────── */

{
  const chain = cat.fallbackChain('netease', { netease: READY, local: READY, spotify: READY });
  assert.ok(!chain.includes('netease'), '放不出声的源绝不能进回退链');
  assert.equal(chain[0], 'local', '首选放不了就顺着目录顺序找下一个真能放的');
}
{
  // 首选能放时它必须在最前 —— 回退链不是「随便挑一个」。
  const chain = cat.fallbackChain('spotify', { spotify: READY, local: READY });
  assert.equal(chain[0], 'spotify', '首选能放就用首选');
}
{
  // 一个都放不了:链是空的,并且必须有一句话交代。
  const chain = cat.fallbackChain('local', {});
  assert.equal(chain.length, 0, '没有能放的源时链就是空的,不许拿链头兜底');
  assert.ok(cat.noSourceLine({}), '一个都放不了时必须有话说');
}

/* ── ④ Spotify:连上了 ≠ 能放 ───────────────────────────────────────────── */

{
  const route = read('app/api/portal/music/spotify/route.ts');
  assert.ok(
    /streamable:\s*product === 'premium'/.test(route),
    "streamable 必须以 product === 'premium' 为准 —— 免费账号连得上但放不出声",
  );
  assert.ok(
    /authorized: false, streamable: false, error: 'reauth_needed'/.test(route),
    '刷新不动时必须如实报 authorized:false,不能继续显示「已连接」却每次播放都失败',
  );
}

/* ── ⑤ 网易:不去取播放地址 ─────────────────────────────────────────────── */

{
  const route = read('app/api/portal/music/netease/search/route.ts');
  assert.ok(!/song\/url/.test(route), '这条路由刻意只做元数据;取播放地址那一步正是被锁的那步');
  const catalog = read('lib/platform/music/source-catalog.ts');
  assert.ok(
    /id: 'netease',[\s\S]{0,400}?model: 'metadata-only'/.test(catalog),
    '网易在目录里必须是 metadata-only —— 哪天真有了国内出口再改这一处',
  );
}

/* ── ⑥ 失败路径要被渲染 ─────────────────────────────────────────────────── */

{
  const panel = read('components/portal/music/MusicPanel.tsx');
  assert.ok(
    panel.includes('<span>{player.state.error}</span>'),
    '播放失败的原因必须渲染出来,不能只 setState',
  );
  assert.ok(
    /\{importMsg && <p className="nesio-music-msg">\{importMsg\}<\/p>\}/.test(panel),
    '导入结果(含失败的那几首)必须显示',
  );
  assert.ok(
    /\{connectMsg && <p className="nesio-music-msg">\{connectMsg\}<\/p>\}/.test(panel),
    '连接 Apple Music 的结果必须显示 —— 成功和失败都要',
  );
  assert.ok(
    /probed && !playable && blocked &&[^\n]*<p className="nesio-music-blocked">\{blocked\}<\/p>/.test(panel),
    '当前源不能放时,那句原因必须显示在屏幕上',
  );
  // 但未登录时要让位给真原因:三个远端源的探测都走 guard,401 会被翻译成
  // 「还没配好」——把用户支去改一个没坏的东西。
  assert.ok(
    /signedOut && source !== 'local' &&[\s\S]{0,200}要先登录 Nesio/.test(panel),
    '未登录时必须先说「要先登录」,而不是让「还没配好」去背这口锅',
  );
  assert.ok(
    /!\(signedOut && source !== 'local'\)/.test(panel),
    '未登录时那句会误导的原因要让位,不能两句同屏',
  );
  assert.ok(
    /probed && !chain\.length && <p className="nesio-music-blocked">\{noSourceLine\(readiness, dict\)\}/.test(panel),
    '一个源都放不了时的空态必须渲染 —— 这是「按了没反应」那一类 bug 的根',
  );
  const player = read('components/portal/music/use-local-player.ts');
  // 浏览器挡下自动播放 ≠ 格式放不了:前者**再点一次就能出声**,后者只能换歌。
  // 两句合并成一句「放不出来」等于把唯一有效的动作藏了起来 —— 所以压的是那个出口。
  assert.ok(
    /name === 'NotAllowedError' \? c\.blocked : c\.badFormat/.test(player),
    '自动播放被挡下与格式不支持必须分成两条路 —— 需要的下一步动作不一样',
  );
  assert.ok(
    /blocked: '[^']*再点一次[^']*'/.test(player) && /blocked: '[^']*once more[^']*'/.test(player),
    '被挡下时那句话必须写出「再点一次」这个真实出口(中英各一份),不能只说放不出来',
  );
}

/* ── ⑦ 放完到头要停 ─────────────────────────────────────────────────────── */

{
  const order = [0, 1, 2];
  assert.equal(queue.nextIndex(2, order, 'off', true), null, 'repeat=off 放到最后一首就该停');
  assert.equal(queue.nextIndex(2, order, 'all', true), 0, 'repeat=all 才回到第一首');
  assert.equal(queue.nextIndex(1, order, 'one', true), 1, '单曲循环:自动续播原地重来');
  // 手动按「下一首」必须真的换歌,否则用户按十次都在听同一首,像按键坏了。
  assert.equal(queue.nextIndex(1, order, 'one', false), 2, '单曲循环下手动下一首要真的换歌');
  assert.equal(queue.prevIndex(0, order), 2, '在第一首按上一首回到最后一首(通行做法)');
  // 随机是确定性洗牌:同一个种子两次结果一样,否则「上一首」回不到刚才那首。
  assert.equal(
    queue.shuffleOrder(8, 42).join(','),
    queue.shuffleOrder(8, 42).join(','),
    '同种子的随机序列必须一致',
  );
  assert.equal(queue.shuffleOrder(8, 42).slice().sort((a, b) => a - b).join(','), '0,1,2,3,4,5,6,7', '洗牌不能丢曲目');
}

/* ── ⑧ 清曲库要接进三处收口 ─────────────────────────────────────────────── */

{
  const owner = read('lib/portal/local-owner.ts');
  assert.ok(
    (owner.match(/purgeLocalTracks\(\)/g) || []).length >= 2,
    '「删除全部数据」和「登出」两处都要清曲库 —— 漏了就把歌留在这台设备上',
  );
  const settings = read('components/portal/SettingsSheets.tsx');
  assert.ok(
    (settings.match(/purgeLocalTracks\(\)/g) || []).length >= 2,
    '设置里的「清空本机数据」和「删除账号」两处都要清曲库',
  );
}

/* ── ⑨ 授权回来要落在音乐页,而不是首页 ─────────────────────────────────── */

{
  const portal = read('components/portal/Portal.tsx');
  assert.ok(
    /INSIGHTS_TABS[\s\S]{0,400}'music'/.test(portal),
    "深链白名单必须含 'music' —— 漏了它,派出去的事件会落回默认页,看着像死链",
  );
  assert.ok(
    /params\.get\('music'\) === '1'[\s\S]{0,200}setInsightsTab\('music'\)/.test(portal),
    'Spotify 授权跳回的 ?music=1 必须真的把音乐页打开,否则用户从 Spotify 回来只看到首页',
  );

  const panel = read('components/portal/music/MusicPanel.tsx');
  // 六种回调状态需要的下一步动作各不相同,合成一句「连接失败」等于什么都没说。
  for (const st of ['connected', 'denied', 'state_mismatch', 'exchange_failed', 'unconfigured', 'network']) {
    assert.ok(new RegExp(`${st}:`).test(panel), `Spotify 回调的 ${st} 要有自己的一句话`);
  }
  const msgs = [...panel.matchAll(/^\s{6}(connected|denied|state_mismatch|exchange_failed|unconfigured|network): L\(dict, '([^']+)'/gm)]
    .map((m) => m[2]);
  assert.equal(new Set(msgs).size, msgs.length, '六种回调状态的文案必须各不相同 —— 一样就等于没区分');
  assert.ok(
    panel.includes('{callbackMsg && <p className="nesio-music-msg">{callbackMsg}</p>}'),
    '回调结果必须渲染,且不能藏在某个源的分支里(用户回来时停在哪个源都得看见)',
  );
}

/* ── ⑩ 两个静默杀手:CSP 与 locale ───────────────────────────────────────── */

{
  const cfg = read('next.config.js');
  // 当年 Plaid 就栽在这:脚本被 CSP 静默拦掉,表现是「点了没反应」,页面上没有任何线索。
  assert.ok(
    /script-src[^"]*js-cdn\.music\.apple\.com/.test(cfg),
    'MusicKit 的 CDN 必须在 script-src 里放行,否则连接 Apple Music 会静默失败',
  );
  assert.ok(
    /connect-src[^"]*api\.music\.apple\.com/.test(cfg),
    'MusicKit 的 API 域必须在 connect-src 里放行',
  );

  const panel = read('components/portal/music/MusicPanel.tsx');
  // PortalLocale 有 12 种(ja/fr/de/…),而 L() 只认 'en' —— 直接把 locale 丢进去,
  // 法语用户会看到中文。必须过转换。
  assert.ok(
    /const dict = portalLocaleToDictionaryLocale\(usePortalLocale\(\)\)/.test(panel),
    'dict 必须过 portalLocaleToDictionaryLocale,不能把 PortalLocale 直接当 L() 的第一个参数',
  );
}

/* ── ⑪ 回退链要有真出口,不能算完就扔 ───────────────────────────────────── */

{
  const panel = read('components/portal/music/MusicPanel.tsx');
  assert.ok(
    /probed && !playable && !!chain\.length[\s\S]{0,400}chain\.map\(\(id\) => \([\s\S]{0,200}requestSwitch\(id\)/.test(panel),
    '当前源放不了时必须把真能放的那几个摆出来、可一键切 —— 只说「放不了」是把人留在死路上',
  );
  assert.ok(
    /chain\.map[\s\S]{0,240}requestSwitch\(id\)/.test(panel),
    '一键切必须走 requestSwitch,否则跨播放模型的提示被绕过去了',
  );
}

/* ── ⑫ 删了正在放的那首要停 ─────────────────────────────────────────────── */

{
  const panel = read('components/portal/music/MusicPanel.tsx');
  assert.ok(
    /if \(t\.id === player\.state\.currentId\) player\.stop\(\);[\s\S]{0,120}deleteLocalTrack\(t\.id\)/.test(panel),
    '曲库里删掉的歌还在响,是同屏自相矛盾 —— 删之前要停',
  );
  const hook = read('components/portal/music/use-local-player.ts');
  assert.ok(
    /stop: \(\) => \{[\s\S]{0,200}revoke\(\);/.test(hook),
    'stop 要把 objectURL 也放掉,不然一首无损几十 MB 一直占着',
  );
}

/* ── ⑬ 猜错的曲名要改得了 ───────────────────────────────────────────────── */

{
  const panel = read('components/portal/music/MusicPanel.tsx');
  // parseTrackName 是从文件名**猜**的,注释里承诺了「用户可以自己改」——
  // 承诺写在注释里、入口不存在,就是同屏矛盾的一种。
  assert.ok(
    /renameLocalTrack\(current\.id, parsed\.title, parsed\.artist\)/.test(panel),
    '曲名是猜的,必须给得起改 —— 否则 parseTrackName 的注释在骗人',
  );
}

/* ── ⑭ 系统说的话要跟着语言走 ───────────────────────────────────────────── */

{
  // 上一轮 #24 修的就是「动态生成的文案只有中文」。这一轮四个源的每一句都要过。
  const en = cat.blockedReason('netease', READY, 'en');
  const zh = cat.blockedReason('netease', READY, 'zh');
  assert.ok(en && zh && en !== zh, '不能放的原因必须有英文版');
  assert.ok(!/[一-龥]/.test(en), '英文版里不该混中文');
  const enNotice = cat.switchNotice('local', 'spotify', 'en');
  assert.ok(enNotice && !/[一-龥]/.test(enNotice), '换源提示必须有英文版');
  const enNone = cat.noSourceLine({}, 'en');
  assert.ok(enNone && !/[一-龥]/.test(enNone), '一个都放不了的那句话必须有英文版');
  assert.equal(cat.sourceName('local', 'en'), 'Local files', '源名要按语言给');

  // 播放器与导入的失败话术同样两份 —— 它们是用户最可能撞上的两处。
  const hook = read('components/portal/music/use-local-player.ts');
  assert.ok(/const COPY = \{[\s\S]{0,1200}\n  en: \{/.test(hook), '播放器的失败话术必须中英各一份');
  const tracks = read('lib/platform/music/local-tracks.ts');
  assert.ok(/const IMPORT_COPY = \{[\s\S]{0,1200}\n  en: \{/.test(tracks), '导入的失败话术必须中英各一份');
  assert.ok(
    /importLocalTrack\(f, dict\)/.test(read('components/portal/music/MusicPanel.tsx')),
    '面板调导入时必须把语言传下去 —— 写了两份却不传,等于只有中文',
  );
}

/* ── ⑮ 0 秒是有效位置 ──────────────────────────────────────────────────── */

{
  const panel = read('components/portal/music/MusicPanel.tsx');
  assert.ok(
    /\{clockTime\(player\.state\.positionSec\)\} \/ \{prettyDuration\(player\.state\.durationSec\)\}/.test(panel),
    '进度要用 clockTime(0 秒 = 0:00);--:-- 表示的是「不知道多长」,刚开始放不该显示成那样',
  );
}

/* ── ⑯ 免费账号照实说 ──────────────────────────────────────────────────── */

{
  const panel = read('components/portal/music/MusicPanel.tsx');
  assert.ok(
    /spotifyInfo\.product === 'premium'[\s\S]{0,240}免费版,搜得到但放不了/.test(panel),
    '连上的是免费账号就直说「搜得到但放不了」—— 比一句泛泛的「放不了」有用得多',
  );
}

console.log('music-source-switch: OK(换源提前说 / 正向可播 / 回退链只收真能放的 / Premium 才算能放 / 失败路径可见 / 到头会停 / 清除已收口 / 回调落在音乐页 / CSP 与 locale 不静默坑人)');
