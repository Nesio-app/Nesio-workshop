/**
 * 行为契约:音乐模块的四个音源(2026-07-30)。
 *
 * 压的不是「有没有这个功能」,是**四条会被后来的人顺手改坏的判断**:
 *
 *  ① 跨播放模型换源必须提前说。本地/Apple 是 Nesio 自己出声,Spotify 是遥控 ——
 *     切过去车机屏幕上显示的 App 会变。这句话要在切之前说,不是切完让用户自己发现。
 *  ② 「能不能放」是正向判据。configured / authorized / streamable 三项齐了才算能放。
 *     反着写的症状很具体:点播放,静默无声,而界面上一切正常。
 *     2026-07-31 补:网易是**逐曲**的 —— 源级别接得上就算能放,哪一首取不到
 *     要点下去问过 song-url 才知道。把它整个判成「放不出声」是过度概括(用户当场
 *     指出「不是所有歌都锁着的」),那一版的代价是一整个源被白白关掉。
 *     所以这里现在压的是**受限 ≠ 故障**:两者必须给两句不同的话、两个不同的动作。
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
// 网易:接得上就算**源级别**能放。前一版把它写成恒不可播,等于把一整个源关掉 ——
// 而事实是多数非独家曲子照样出得了声。
assert.equal(cat.canPlayNow('netease', READY), true, '网易接得上就算源级别能放,不许一刀切成不可播');
assert.equal(cat.sourceInfo('netease').perTrack, true, '但它必须标成逐曲的 —— 界面据此把话说成「多数能放」而不是「都能放」');
assert.equal(cat.sourceInfo('netease').model, 'in-app', '网易的音频是普通 URL,由 Nesio 自己播');
assert.equal(cat.canPlayNow('netease', { ...READY, configured: false }), false, '没配 API base 就是接不上,那才是源级别不能放');
// 不能放时必须给得出一句话。
assert.ok(cat.blockedReason('netease', { ...READY, configured: false }), '不能放就必须说得出为什么');
assert.equal(cat.blockedReason('netease', READY), '', '源级别能放时不许再说一句「放不出声」');
assert.equal(cat.blockedReason('local', READY), '', '能放的时候不该有多余的话');
// 逐曲的那句说明必须存在,而且说的是「点下去才知道」,不是「不能放」。
{
  const note = cat.perTrackNote('netease');
  assert.ok(note, '逐曲源必须有一句自己的说明');
  assert.ok(!/放不出声/.test(note), '逐曲 ≠ 放不出声 —— 这正是上一版判错的那句话');
  assert.equal(cat.perTrackNote('local'), '', '本地不是逐曲源,不该有这句');
}

/* ── ③ 回退链只收真能放的 ───────────────────────────────────────────────── */

{
  const chain = cat.fallbackChain('netease', { netease: { ...READY, configured: false }, local: READY, spotify: READY });
  assert.ok(!chain.includes('netease'), '放不出声的源绝不能进回退链');
  assert.equal(chain[0], 'local', '首选放不了就顺着目录顺序找下一个真能放的');
}
{
  // 反过来同样要压:网易接上了它就是**真能放**的源,不许因为「以为它锁着」被挡在链外。
  const chain = cat.fallbackChain('local', { netease: READY, local: { ...READY, streamable: false } });
  assert.equal(chain.join(','), 'netease', '网易接上了就该进回退链 —— 把它排除掉等于凭空少一个能用的源');
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

/* ── ⑤ 网易:受限 ≠ 故障 ───────────────────────────────────────────────── */

{
  const route = read('app/api/portal/music/netease/song-url/route.ts');
  // 三态必须分开。合成一句「播放失败」的下场很具体:用户对着一首**永远**放不了的歌
  // 一直点重试 —— 而重试是这条路上唯一无效的动作。
  assert.ok(
    /ok: true, configured: true, url: '', reason: 'restricted'/.test(route),
    "取不到 url 要回 200 + reason:'restricted' —— 它不是故障,不许混进错误分支",
  );
  assert.ok(
    /error: 'upstream_failed'[\s\S]{0,120}status: 502/.test(route),
    '上游挂了才是 502 —— 只有这一类才谈得上重试',
  );
  assert.ok(
    /guardAiRoute\(req, 'music-netease-song-url'/.test(route),
    '这条路由要走 guardAiRoute —— 它替用户去打外部接口',
  );

  const rd = read('lib/platform/music/readiness.ts');
  assert.ok(
    /netease: \{ configured: neteaseOk, authorized: neteaseOk, streamable: neteaseOk \}/.test(rd),
    '网易的 streamable 跟着「接没接上」走,不许写死成 false —— 写死一次就把整个源关掉了',
  );

  const panel = read('components/portal/music/MusicPanel.tsx');
  // 上一版这里是一块 is-static 的死文本:搜到了、点不动。那正是错判的产物。
  assert.ok(
    /className="nesio-music-row"[\s\S]{0,200}onClick=\{\(\) => \{ void onPlayNetease\(h\); \}\}/.test(panel),
    '网易搜索结果每一行必须可点 —— 搜得到点不动等于把能放的那部分也一起关掉了',
  );
  assert.ok(
    /playRemote\(j\.url, \{ id: h\.id, title: h\.title, artist: h\.artist \}\)/.test(panel),
    '拿到播放地址要真的放出来,而不是只把它存进 state',
  );

  // 受限那句里**不许**出现「重试」这个动作。
  const restricted = panel.match(/kind: 'restricted',\s*\n\s*text: L\(dict,\s*\n\s*'([^']+)',\s*\n\s*'([^']+)'/);
  assert.ok(restricted, '受限必须有自己的一句话(中英各一份)');
  assert.ok(/换一首/.test(restricted[1]), '受限那句要给出真出口:换一首 / 换个源 / 导本地');
  assert.ok(!/再试|重试|Try again/.test(restricted[1] + restricted[2]), '受限那一首重试一万次也是同一个答案,不许劝人重试');
  assert.ok(!/[一-龥]/.test(restricted[2]), '英文版里不该混中文');

  // 按钮怎么分(故障→再试一次 / 受限→换一首 / 风控→知道了),压在
  // scripts/music-netease-direct.test.mjs 里 —— 那边连「风控」这一支一起压,更完整。
  // 同一件事只压一处,两处各写一半会各自漂移。

  // 放起来之后必须有地方能暂停/停掉。悬浮球在音乐页是让位的,所以这一条播放条
  // 是唯一的出口 —— 它不能跟着搜索结果走:再搜一次别的,歌还在响而暂停键没了。
  assert.ok(
    /\{nowRemote && player\.state\.currentId === nowRemote\.id && \([\s\S]{0,400}player\.toggle\(\)/.test(panel),
    '网易播放条要认 nowRemote(独立记住正在放的那一首),不许从当前这批搜索结果里现找',
  );
  assert.ok(
    /onClick=\{\(\) => \{ player\.stop\(\); setNowRemote\(null\); \}\}/.test(panel),
    '停止要真停,并且把「正在放」这份记录一起清掉',
  );

  // 源级别那句说明也要换掉:不能再写「搜到了但放不出声」。
  assert.ok(
    !/搜到了,但这里放不出声/.test(panel),
    '「搜到了但放不出声」这句已被事实推翻,不许留在界面上',
  );
  assert.ok(
    /perTrackNote\('netease', dict\)/.test(panel),
    '搜到结果之后要说的是逐曲那句(多数能放、点下去才知道)',
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
    /probed && !playable && blocked[\s\S]{0,300}<p className="nesio-music-blocked">\{blocked\}<\/p>/.test(panel),
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
  const player = read('lib/platform/music/player-engine.ts');
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
  const engine = read('lib/platform/music/player-engine.ts');
  assert.ok(
    /export function stop\(\): void \{[\s\S]{0,320}revoke\(\);/.test(engine),
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
  const NO_CONF = { ...READY, configured: false };
  const en = cat.blockedReason('netease', NO_CONF, 'en');
  const zh = cat.blockedReason('netease', NO_CONF, 'zh');
  assert.ok(en && zh && en !== zh, '不能放的原因必须有英文版');
  assert.ok(!/[一-龥]/.test(en), '英文版里不该混中文');
  const enNote = cat.perTrackNote('netease', 'en');
  assert.ok(enNote && !/[一-龥]/.test(enNote), '逐曲那句说明必须有英文版');
  const enNotice = cat.switchNotice('local', 'spotify', 'en');
  assert.ok(enNotice && !/[一-龥]/.test(enNotice), '换源提示必须有英文版');
  const enNone = cat.noSourceLine({}, 'en');
  assert.ok(enNone && !/[一-龥]/.test(enNone), '一个都放不了的那句话必须有英文版');
  assert.equal(cat.sourceName('local', 'en'), 'Local files', '源名要按语言给');

  // 播放器与导入的失败话术同样两份 —— 它们是用户最可能撞上的两处。
  const hook = read('lib/platform/music/player-engine.ts');
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

/* ── ⑮b 进度可拖,但拖得动才给 ──────────────────────────────────────────── */

{
  const panel = read('components/portal/music/MusicPanel.tsx');
  assert.ok(
    /player\.seek\(Number\(e\.target\.value\)\)/.test(panel),
    'seek 必须接到界面上 —— 引擎透出来却没人调,等于没做',
  );
  assert.ok(
    /player\.state\.durationSec > 0 && \([\s\S]{0,400}type="range"/.test(panel),
    '时长还没读出来时不给拖:一个拖了不动的滑块比没有滑块更让人以为坏了',
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

/* ── ⑰ 没配好的源不许留一个点了就出事的入口 ───────────────────────────── */

{
  const panel = read('components/portal/music/MusicPanel.tsx');
  // 实测:Spotify 那颗「连接」是个 <a href="/api/portal/music/spotify/connect">。
  // 服务端没配 client id/secret 时那条路由回 503 + 一段 JSON,浏览器把它原样
  // 铺满整屏 —— 用户看到的是一屏黑底白字的 {"ok":false,"error":"provider_not_configured"…}。
  // 内部错误码不该出现在用户眼前(红线:内部文案泄露)。
  assert.ok(
    /\) : readiness\.spotify\?\.configured \? \([\s\S]{0,200}href="\/api\/portal\/music\/spotify\/connect"/.test(panel),
    '没配好 Spotify 时不许放出那个跳转链接 —— 那条路由会回一屏裸 JSON',
  );
  // 中英**各一句**都要在:只搜一次的话,改掉中文那句、英文那句照样让断言过
  // (同一个环境变量名在两句里都出现)。
  assert.ok(
    /要用它得先在服务端配上 SPOTIFY_CLIENT_ID \/ SPOTIFY_CLIENT_SECRET/.test(panel)
    && /This needs SPOTIFY_CLIENT_ID \/ SPOTIFY_CLIENT_SECRET on the server/.test(panel),
    '没配好时要说清楚缺什么、去哪配(中英各一句),而不是让人点一下撞一屏 JSON',
  );
  // Apple 同理:没配密钥时那颗按钮点了必然失败,而失败那句跟顶上那句是同一件事。
  assert.ok(
    /\{readiness\.apple\?\.configured \? \(/.test(panel),
    '没配好 Apple 的开发者密钥时不该给「连接」按钮 —— 点了必然失败',
  );
  // 同一件事不许在一屏里说两遍。
  assert.ok(
    /&& !\(source !== 'local' && ready && !ready\.configured\)/.test(panel),
    '这一段自己会说明时,顶上那句就该让位 —— 否则屏幕上两句「还没配好」',
  );
  // 四个源长得一模一样、点进去才发现三个用不了 = 让人一个个去撞墙。
  assert.ok(
    /probed && !signedOut && s\.id !== 'local' && r && !r\.configured/.test(panel),
    '没配好的源要在 chip 上标出来(但未登录时不标 —— 那时真原因是没登录)',
  );
}

/* ── ⑱ 本地歌曲的话术不许套远端那一套 ─────────────────────────────────── */

{
  // 实测截图:当前源是 Apple Music,屏幕上却写着
  // 「本地歌曲还差一步就能放了 —— 连上账号或换成本地歌曲都行」。
  // 本地歌曲不需要账号,也不该建议「换成本地歌曲」——它说的就是本地歌曲。
  const line = cat.noSourceLine({ local: { configured: true, authorized: true, streamable: false } });
  assert.ok(/导几首/.test(line), '本地歌曲差的是导歌,不是连账号');
  assert.ok(!/连上账号/.test(line) && !/换成本地歌曲/.test(line), '不许拿远端那套话去说本地歌曲');

  // blockedReason 同理:本地源走通用话术时 requires 是空串,
  // 句子会变成「连上了,但这首现在取不到 —— 通常是的关系」,读都读不通。
  const b = cat.blockedReason('local', { configured: true, authorized: true, streamable: false });
  assert.ok(/导几首/.test(b), '本地歌曲放不出声只有一个原因:曲库空着');
  assert.ok(!/通常是的关系/.test(b), '本地源不许套用远端那句带 requires 的模板');
}

/* ── ⑲ 本地导入:宁可误收,不许误拒 ─────────────────────────────────────── */

{
  // 实测:「本地音乐无法识别任何格式,无法上传」——一首都选不中、选中了也进不来。
  // 根因是两处**白名单**:input 的 accept,和 isAudioFile 的扩展名表。
  // iOS「文件」App 交出来的 File 常常 type 是空串,iCloud 同步下来的甚至没有扩展名,
  // 白名单在那儿必然踩空。判据方向要反过来:只挡明显不是的。
  const lib = loadTs('lib/platform/music/local-tracks.ts');
  assert.equal(lib.isAudioFile({ name: 'song', type: '' }), true, '没扩展名、没 MIME 的也要收 —— iOS 常态,拒了就是一首都进不来');
  assert.equal(lib.isAudioFile({ name: '未命名 2', type: '' }), true, '中文名 + 无扩展名同样要收');
  assert.equal(lib.isAudioFile({ name: 'a.flac', type: '' }), true, '认得出的扩展名当然收');
  assert.equal(lib.isAudioFile({ name: 'a.mp3', type: 'application/octet-stream' }), true, 'MIME 报成八位流也要收 —— 这是最常见的一种');
  // 但明显不是音频的照旧挡掉:误收一张 200MB 的视频对谁都没好处。
  assert.equal(lib.isAudioFile({ name: 'IMG_1.HEIC', type: 'image/heic' }), false, '图片不收');
  assert.equal(lib.isAudioFile({ name: 'clip.mp4', type: 'video/mp4' }), false, '视频不收');
  assert.equal(lib.isAudioFile({ name: 'note.pdf', type: 'application/pdf' }), false, '文档不收');

  const panel = read('components/portal/music/MusicPanel.tsx');
  // accept 会在 iOS 的文件选择器里把一大片本来能选的文件灰掉 —— 仓里已为这件事
  // 栽过一次(CaptureBar 的 CAPTURE_ACCEPT='')。这条压的就是别再加回来。
  const input = panel.match(/<input\s*\n\s*ref=\{fileRef\}[\s\S]{0,900}?\/>/);
  assert.ok(input, '导入用的 file input 必须在');
  assert.ok(!/accept=/.test(input[0]), 'file input 不许设 accept —— iOS 上它会把没有 MIME 的音频整片灰掉,表现就是「一首都选不中」');
  assert.ok(/className="nesio-visually-hidden"/.test(input[0]), 'iOS 的 WKWebView 会忽略 display:none 的 input 的 click(),只能视觉隐藏');
}

console.log('music-source-switch: OK(换源提前说 / 正向可播 / 网易逐曲且受限≠故障 / 回退链只收真能放的 / Premium 才算能放 / 失败路径可见 / 到头会停 / 清除已收口 / 回调落在音乐页 / CSP 与 locale 不静默坑人 / 本地导入宁可误收不许误拒)');
