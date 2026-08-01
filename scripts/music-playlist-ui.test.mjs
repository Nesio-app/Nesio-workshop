/**
 * 行为契约:歌单子 tab / 全屏播放器 / 加到歌单(2026-08-01)。
 *
 * 用户三句话:
 *   「发现没有原来设计好的 UI。播放全屏,歌词。都没有」
 *   「在音乐板面应该有歌单 子tab 才对」
 *   「每一个可以的歌曲要有按钮可以加歌单」
 *
 * 这一条压的是**接线**:数据层和判断层各自的契约已经在
 * music-playlists / music-lyrics / music-auto-advance 里真跑过了,
 * 这里管的是它们有没有真的被界面用上 —— 一个只在库里存在、界面上够不着的
 * 功能,和没做是一回事。
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { stripComments } from './lib/strip-comments.mjs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const panel = stripComments(read('components/portal/music/MusicPanel.tsx'));
const fsp = stripComments(read('components/portal/music/FullScreenPlayer.tsx'));
const atp = stripComments(read('components/portal/music/AddToPlaylistSheet.tsx'));
const tab = stripComments(read('components/portal/music/PlaylistsTab.tsx'));

/* ══ ① 歌单是一个子 tab,而且**跨源** ═════════════════════════════════════ */
{
  assert.match(panel, /role="tablist"/, '音乐面板要有子 tab 行');
  assert.match(panel, /setTab\('playlists'\)/, '要有「歌单」这个 tab');
  assert.match(panel, /<PlaylistsTab\b/, '歌单 tab 要真的渲染出歌单那一屏');

  // 歌单**不跟着上面那排音源走** —— 一个歌单里本地和网易的歌混着是常态。
  // 若写成 `source === 'local' && tab === 'playlists'`,换到网易源歌单就消失了。
  const tabBlock = panel.slice(panel.indexOf("{tab === 'playlists' &&"), panel.indexOf('<PlaylistsTab') + 40);
  assert.doesNotMatch(tabBlock, /source ===/,
    '歌单那一屏不许挂在某个音源下 —— 它是跨源的,挂上去换个源就不见了');

  // 反过来:曲库那几段必须**跟着 tab 走**,否则切到歌单 tab 时曲库还在下面堆着
  for (const src of ['local', 'apple', 'spotify', 'netease']) {
    assert.match(panel, new RegExp(`\\{tab === 'library' && source === '${src}'`),
      `${src} 那一段要跟着 tab 走,不然切到歌单 tab 后曲库还堆在下面`);
  }
}

/* ══ ② 每一首歌都够得着「加歌单」 ═════════════════════════════════════════ */
{
  // 本地曲库那一行
  assert.match(panel, /className="nesio-music-add"[\s\S]{0,300}trackRef\('local', t\.id\)/,
    '本地曲库每一行要有「＋加歌单」—— 歌单是跨源的,本地曲目当然也能进');
  // 网易搜索结果那一行
  assert.match(panel, /className="nesio-music-add"[\s\S]{0,300}trackRef\('netease', h\.id\)/,
    '网易搜索结果每一行也要有「＋加歌单」(用户:「每一个可以的歌曲要有按钮」)');
  assert.match(panel, /<AddToPlaylistSheet\b/, '「＋」要真的能弹出选择器');
}

/* ══ ③ 「已经在里面」和「加好了」是两句话 ════════════════════════════════ */
{
  // 数据层是幂等的 —— 界面若也只说「已加入」,用户永远不知道刚才那一下算不算数
  assert.match(atp, /kind: 'already'/, '「本来就在这个歌单里」要单独说');
  assert.match(atp, /kind: 'added'/, '「加好了」要单独说');
  assert.match(atp, /kind: 'failed'/,
    '写失败必须说话 —— localStorage 满了时写会静默失败,攒了半天的歌单悄悄丢掉是最伤的那一类');
  // 三句话必须真的不一样,不能是同一个字符串复制三遍
  const texts = [...atp.matchAll(/kind: '(added|already|failed)',\s*\n?\s*text: L\(dict, '([^']+)'/g)]
    .map((m) => m[2]);
  assert.equal(new Set(texts).size, texts.length, '这三种结局不许说同一句话');
}

/* ══ ④ 歌词三种状态分开,「没有词」不给重试 ═══════════════════════════════ */
{
  assert.match(fsp, /lyrics\.status === 'loading'/, '「正在找」要有');
  assert.match(fsp, /lyrics\.status === 'none'/, '「这一首没有歌词」要单独一种');
  assert.match(fsp, /lyrics\.status === 'error'/, '「取不到」要单独一种');

  // **none 那一支里不许出现重试** —— 纯音乐重试一万次也还是没有,
  // 挂一个点不好的按钮比不给更伤
  const noneBlock = fsp.slice(fsp.indexOf("lyrics.status === 'none'"), fsp.indexOf("lyrics.status === 'error'"));
  assert.doesNotMatch(noneBlock, /再试|Try again|setReloadKey/,
    '这一首确实没有歌词的时候不许给重试按钮');
  // 而 error 那一支必须有重试 —— 那才是重试真的管用的一种
  const errBlock = fsp.slice(fsp.indexOf("lyrics.status === 'error'"), fsp.indexOf("lyrics.status === 'ok'"));
  assert.match(errBlock, /setReloadKey/, '取不到才是该给重试的那一种');
}

/* ══ ⑤ 歌词逐行高亮 + 点一行跳过去 ═══════════════════════════════════════ */
{
  assert.match(fsp, /activeLineIndex\(lyrics\.lines, posMs\)/,
    '高亮哪一行要走 activeLineIndex —— 那里的前奏判定/二分边界是真跑过的');
  assert.match(fsp, /i === active \? ' is-on' : ''/, '当前行要有高亮样式');
  assert.match(fsp, /onClick=\{\(\) => seek\(line\.at \/ 1000\)\}/,
    '点一行要跳到那儿 —— 想再听一遍那句是全屏歌词最常被用的动作');
  // 滚动**只在行号变了才做**:跟着 timeupdate 每秒滚好几次会把用户
  // 自己往上翻的动作一直拽回来
  assert.match(fsp, /\}, \[active\]\)/, '自动滚动的依赖只能是 active,不许跟着播放位置每秒滚');
}

/* ══ ⑥ 投放:只在真能用的设备上出现 ═══════════════════════════════════════ */
{
  assert.match(fsp, /canAirPlay\(\)/, '要先问这台设备能不能投');
  assert.match(fsp, /airplay \?/,
    '投放键必须**条件渲染** —— 一个点了什么都不发生的投放键,比没有投放键更让人以为是坏了');
  assert.match(fsp, /showAirPlayPicker\(\)/, '点了要真弹系统选择器');

  const engine = stripComments(read('lib/platform/music/player-engine.ts'));
  assert.match(engine, /webkitShowPlaybackTargetPicker/, 'AirPlay 走的是 audio 元素上那个方法');
  // 蓝牙/Cast 不许在这里长出一个假按钮
  assert.doesNotMatch(fsp, /蓝牙|Bluetooth/,
    '蓝牙是系统层的连接,网页既没有 API 也不需要有 —— 给它做按钮就是一个点了什么都不发生的键');
}

/* ══ ⑦ 停止要连正在跑的自动往下找一起停 ══════════════════════════════════ */
{
  assert.match(panel, /cancelAutoAdvance\(\); player\.stop\(\)/,
    '按了停止,几秒后自动续播又把下一首放起来 —— 这是「按了没反应」的反面:按了反着来');
  assert.match(panel, /cancelAutoAdvance\(\);[\s\S]{0,60}setQueueMsg\(''\)/,
    '用户明确点了某一首时,也要作废掉正在跑的那趟自动往下找');
}

/* ══ ⑧ 自动续播换了歌,界面要跟上 ═════════════════════════════════════════ */
{
  // 不跟的话播放条/全屏播放器停在**上一首**的名字上,而声音已经是下一首了 ——
  // 同一屏两个说法打架
  assert.match(panel, /const hit = neteaseHits\.find\(\(h\) => h\.id === id\);\s*\n\s*if \(hit\) setNowRemote\(hit\)/,
    '自动往下找换了一首之后,「正在放的远端曲目」要跟上');
  assert.match(panel, /setEntryQueue\(/,
    '搜索结果要交给引擎当队列 —— 这是「自动播放下一个」的接线,不接就还是一首放完就停');
  assert.match(panel, /onQueueStop/,
    '自动往下找停在哪儿必须说出来,不许静默什么都不发生');
}

/* ══ ⑨ 歌单里能播、能删、能进详情 ════════════════════════════════════════ */
{
  assert.match(tab, /setEntryQueue\(entries, probeRemote, onQueueStop\)/,
    '播放歌单要走引擎的统一队列 —— 本地和网易混着是常态,分成两条队列的话' +
    '「下一首」会在两种源的交界处莫名其妙停住');
  assert.match(tab, /playlistHeadline\(/, '「42 首 · 3.2 小时」那一行要显示出来');
  assert.match(tab, /removeFromPlaylist\(/, '歌单里要能把一首移出去');
  // 「我喜欢的音乐」删不掉这一条在数据层已经钉死了;界面上也不该给那个按钮 ——
  // 一个点了什么都不发生的删除键会让人以为坏了
  assert.match(tab, /open\.id !== LIKED_ID && \(/,
    '「我喜欢的音乐」不该显示删除按钮 —— 数据层挡得住,但界面给了这个键就是骗人');
  assert.match(tab, /playlistName\(p, lang\)/,
    '歌单名要走 playlistName —— 「我喜欢的音乐」这个名字是界面上的字,不从数据里读');
}

console.log('music-playlist-ui: OK(歌单跨源子 tab / 每行都能加 / 三种结局三句话 / 没有词不给重试 / 点行跳过去 / 投放只在能用时出现 / 停止连自动续播一起停)');
