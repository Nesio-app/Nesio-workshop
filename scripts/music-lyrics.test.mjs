/**
 * 行为契约:歌词(2026-08-01,用户「歌词从哪来 —— 和网易一起。
 * 本地没歌词的,都用网易歌词,即使是本地歌曲」)。
 *
 * 这一条压的东西全都是**静默错**:没有一处会报错,全都表现为
 * 「歌词好像不太对」,而用户唯一能得出的结论是这个 App 的歌词是乱的。
 *
 *   · 一行挂多个时间戳只认第一个 → 第二遍副歌整段不亮
 *   · 元数据行当歌词             → 正片开始前先滚三行 [ti:…]
 *   · 翻译按行号配对             → 整段错位(比没有翻译更糟)
 *   · 前奏时高亮第一行           → 用户以为词已经跟丢了
 *   · ID3 帧长用错版本的读法     → 「有些 mp3 读得到词,有些读不到」
 *   · 搜来的第一条直接用         → 拿到翻唱/同名另一首的词
 *
 * 全部**真跑**。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

function loadTs(rel, extra = {}) {
  const js = ts.transpileModule(read(rel), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports, console,
    require: (spec) => extra.__require?.(String(spec)) ?? {},
    Date, Math, Number, Array, Object, String, Set, Map, JSON, Boolean, RegExp,
    TextDecoder, Uint8Array, Promise,
    ...extra,
  });
  return mod.exports;
}

const L = loadTs('lib/platform/music/lyrics.ts');

/* ══ ① 一行挂多个时间戳:两遍副歌都要亮 ═══════════════════════════════════ */
{
  const lines = L.parseLrc('[00:10.00][01:30.00]副歌\n[00:20.00]第二句');
  assert.equal(lines.length, 3,
    '`[00:10][01:30]副歌` 是 LRC 里省重复的常规写法 —— 只认第一个的话第二遍副歌整段不亮');
  assert.equal(lines.map((l) => l.at).join(','), '10000,20000,90000',
    '展开出来必须排好序 —— LRC 不保证有序,而乱序的表现是高亮乱跳');
  assert.equal(lines[0].text, '副歌');
  assert.equal(lines[2].text, '副歌');
}

/* ══ ② 元数据行不是歌词,但 offset 要用上 ══════════════════════════════════ */
{
  const lines = L.parseLrc('[ti:晴天]\n[ar:周杰伦]\n[by:某某]\n[00:10.00]第一句');
  assert.equal(lines.length, 1, '[ti:]/[ar:]/[by:] 不许当歌词滚出来');
  assert.equal(lines[0].text, '第一句');

  // offset 是**要用**的那一个:整体早/晚半拍的词靠它校正
  const shifted = L.parseLrc('[offset:-500]\n[00:10.00]第一句');
  assert.equal(shifted[0].at, 9500, 'offset 必须应用到每一行');
  const late = L.parseLrc('[offset:+800]\n[00:10.00]第一句');
  assert.equal(late[0].at, 10800);
  // 负得过头不许出负数(界面拿负数去比会一直亮着第一行)
  assert.equal(L.parseLrc('[offset:-99000]\n[00:10.00]x')[0].at, 0);
}

/* ══ ③ 时间戳的几种写法都要认 ═════════════════════════════════════════════ */
{
  // `.5` / `.50` / `.500` 都是 500 毫秒 —— 不补齐的话 `.5` 会被读成 5 毫秒
  assert.equal(L.parseLrc('[00:01.5]x')[0].at, 1500);
  assert.equal(L.parseLrc('[00:01.50]x')[0].at, 1500);
  assert.equal(L.parseLrc('[00:01.500]x')[0].at, 1500);
  assert.equal(L.parseLrc('[00:01]x')[0].at, 1000, '没有小数部分也要认');
  assert.equal(L.parseLrc('[01:00.00]x')[0].at, 60_000);
  assert.equal(L.parseLrc('[100:00.00]x')[0].at, 6_000_000, '超过 99 分的长音频也要认');
  // 冒号做分隔的老写法
  assert.equal(L.parseLrc('[00:01:50]x')[0].at, 1500);

  // 只有时间戳的空行留着 —— 那是间奏,删掉的话上一句会一直亮到下一句,看着像卡住
  const withGap = L.parseLrc('[00:10.00]一句\n[00:20.00]\n[00:30.00]二句');
  assert.equal(withGap.length, 3, '间奏空行要留着');
  assert.equal(withGap[1].text, '');

  // 空输入/垃圾输入给空数组,不许抛 —— 「这一首没有歌词」是常态不是异常
  for (const bad of ['', '   ', null, undefined, '没有任何时间戳的一段话']) {
    assert.doesNotThrow(() => L.parseLrc(bad));
    assert.equal(L.parseLrc(bad).length, 0, `parseLrc(${JSON.stringify(bad)}) 应给空数组`);
  }
}

/* ══ ④ 前奏不许高亮第一行 ════════════════════════════════════════════════ */
{
  const lines = L.parseLrc('[00:10.00]一\n[00:20.00]二\n[00:30.00]三');
  assert.equal(L.activeLineIndex(lines, 0), -1,
    '前奏时返回 -1 —— 高亮第一行的话用户会以为词已经跟丢了');
  assert.equal(L.activeLineIndex(lines, 9999), -1, '差 1 毫秒也还没到');
  assert.equal(L.activeLineIndex(lines, 10_000), 0, '正好踩上算亮');
  assert.equal(L.activeLineIndex(lines, 15_000), 0);
  assert.equal(L.activeLineIndex(lines, 20_000), 1);
  assert.equal(L.activeLineIndex(lines, 999_999), 2, '最后一句之后一直亮着它');
  assert.equal(L.activeLineIndex([], 5000), -1, '没有歌词时不许抛');
  assert.equal(L.activeLineIndex(lines, NaN), -1, '拿不到播放位置时不许乱亮');

  // 二分写错的经典症状是「中间某几行跳过去了」—— 逐毫秒扫一遍边界
  for (let t = 0; t < 40_000; t += 137) {
    const i = L.activeLineIndex(lines, t);
    const expect = t < 10_000 ? -1 : t < 20_000 ? 0 : t < 30_000 ? 1 : 2;
    assert.equal(i, expect, `t=${t} 时该亮第 ${expect} 行,实际 ${i}`);
  }
}

/* ══ ⑤ 翻译按时间戳配对,不按行号 ═════════════════════════════════════════ */
{
  const main = L.parseLrc('[00:10.00]Hello\n[00:20.00]\n[00:30.00]World');
  // 翻译那份**少了间奏行** —— 这是常态,按行号配就整段错位
  const merged = L.mergeTranslation(main, '[00:10.00]你好\n[00:30.00]世界');
  assert.equal(merged[0].translated, '你好');
  assert.equal(merged[1].translated, '', '间奏行没有翻译');
  assert.equal(merged[2].translated, '世界',
    '翻译必须按时间戳配对 —— 按行号的话这里会拿到空串或者上一句');

  // 没有翻译时原样返回,不许把 translated 弄丢
  const noTr = L.mergeTranslation(main, '');
  assert.equal(noTr.length, 3);
  assert.equal(noTr[0].text, 'Hello');
}

/* ══ ⑥ mp3 自带的词(ID3v2 USLT)══════════════════════════════════════════ */
{
  const enc = new TextEncoder();

  /** 造一个 ID3v2 tag。major=3 帧长普通 32 位,major=4 帧长 synchsafe。 */
  function makeTag(major, frames) {
    const body = [];
    for (const f of frames) {
      const size = f.data.length;
      const sz = major === 4
        ? [(size >> 21) & 0x7f, (size >> 14) & 0x7f, (size >> 7) & 0x7f, size & 0x7f]
        : [(size >> 24) & 0xff, (size >> 16) & 0xff, (size >> 8) & 0xff, size & 0xff];
      body.push(...enc.encode(f.id), ...sz, 0, 0, ...f.data);
    }
    const total = body.length;
    return Uint8Array.from([
      0x49, 0x44, 0x33, major, 0,  0,
      (total >> 21) & 0x7f, (total >> 14) & 0x7f, (total >> 7) & 0x7f, total & 0x7f,
      ...body,
    ]);
  }

  /** USLT: encoding(1) + language(3) + 描述(null 结尾) + 正文 */
  function uslt(text, { encoding = 3, desc = '' } = {}) {
    if (encoding === 3) return { id: 'USLT', data: Uint8Array.from([3, ...enc.encode('eng'), ...enc.encode(desc), 0, ...enc.encode(text)]) };
    // UTF-16LE + BOM
    const u16 = (s) => { const o = []; for (const c of s) { const v = c.codePointAt(0); o.push(v & 0xff, (v >> 8) & 0xff); } return o; };
    return { id: 'USLT', data: Uint8Array.from([1, ...enc.encode('eng'), 0xff, 0xfe, ...u16(desc), 0, 0, 0xff, 0xfe, ...u16(text)]) };
  }

  // **必须长过 127 字节**:synchsafe 和普通 32 位在小数值上编码完全一样,
  // 拿一句短词去测,两种读法都对 —— 于是「帧长不分版本」这个真 bug 照样全绿。
  // (第一版正是这么写的,注入回归当场抓出来。)
  const LRC = ['[00:10.00]自己带的词'].concat(
    Array.from({ length: 12 }, (_, i) => `[00:${String(20 + i).padStart(2, '0')}.00]这是第 ${i} 句歌词`),
  ).join('\n');
  assert.ok(new TextEncoder().encode(LRC).length > 200, '判据本身要够长,否则测不出帧长读法的分岔');

  // v2.3 和 v2.4 **都要读得到**。帧长读法用错版本的会走出 tag 外面,
  // 症状正是「有些 mp3 读得到词,有些读不到」。
  assert.equal(L.readEmbeddedLyrics(makeTag(3, [uslt(LRC)])), LRC, 'ID3v2.3 要读得到');
  assert.equal(L.readEmbeddedLyrics(makeTag(4, [uslt(LRC)])), LRC, 'ID3v2.4 要读得到');

  // 前面隔着别的帧也要找得到(USLT 极少排第一)
  const withOthers = makeTag(3, [
    { id: 'TIT2', data: Uint8Array.from([3, ...enc.encode('晴天')]) },
    { id: 'TPE1', data: Uint8Array.from([3, ...enc.encode('周杰伦')]) },
    uslt(LRC),
  ]);
  assert.equal(L.readEmbeddedLyrics(withOthers), LRC, 'USLT 排在别的帧后面也要找到');

  // 描述字段非空时要跳过它 —— 不跳的话正文前面会多出一段描述文字
  assert.equal(L.readEmbeddedLyrics(makeTag(3, [uslt(LRC, { desc: 'Lyrics' })])), LRC,
    '描述字段要跳过,不许混进正文');

  // UTF-16
  assert.equal(L.readEmbeddedLyrics(makeTag(3, [uslt(LRC, { encoding: 1 })])), LRC, 'UTF-16 编码的词也要读得出');

  // 没有 USLT 帧 = 没有内嵌词
  assert.equal(L.readEmbeddedLyrics(makeTag(3, [{ id: 'TIT2', data: Uint8Array.from([3, ...enc.encode('x')]) }])), '');

  // 坏数据一律空串,**绝不抛** —— 解析 tag 失败不该把这首歌的播放一起打翻
  for (const bad of [null, undefined, new Uint8Array(0), new Uint8Array(5),
    Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),          // 不是 ID3
    Uint8Array.from([0x49, 0x44, 0x33, 2, 0, 0, 0, 0, 0, 10, 1, 2])]) { // v2.2 不支持
    assert.doesNotThrow(() => L.readEmbeddedLyrics(bad), `readEmbeddedLyrics 对坏输入抛了`);
    assert.equal(L.readEmbeddedLyrics(bad), '');
  }
  // 帧长撒谎(声称比 tag 还长)也不许炸、不许读出界
  const lying = makeTag(3, [uslt(LRC)]);
  lying[10 + 4] = 0x7f; lying[10 + 5] = 0xff;
  assert.doesNotThrow(() => L.readEmbeddedLyrics(lying));
  assert.equal(L.readEmbeddedLyrics(lying), '', '帧长撒谎时宁可读不到,不许把别的字节当歌词');
}

/* ══ ⑦ 搜来的第一条不许直接用 ═════════════════════════════════════════════ */
{
  const S = loadTs('lib/platform/music/lyrics-source.ts', {
    __require: (spec) => {
      if (spec.includes('./lyrics')) return L;
      if (spec.includes('local-tracks')) return { getTrackBlob: async () => null };
      if (spec.includes('playlists')) return {
        parseTrackRef: (r) => {
          const i = String(r || '').indexOf(':');
          if (i <= 0) return null;
          const s = String(r).slice(0, i), id = String(r).slice(i + 1);
          return id && (s === 'local' || s === 'netease') ? { source: s, id } : null;
        },
      };
      return {};
    },
  });

  const hits = [
    { id: '1', title: '晴天 (Live)', artist: '周杰伦', durationSec: 320 },
    { id: '2', title: '晴天', artist: '某翻唱歌手', durationSec: 200 },
    { id: '3', title: '晴天', artist: '周杰伦', durationSec: 269 },
    // 干扰项:**曲名完全不相干,时长却恰好一样**。没有它的话「曲名对不上就出局」
    // 这条被拿掉也全绿 —— 因为剩下的用例里时长那一道正好也把它们挡住了。
    { id: '9', title: '一首完全不相干的歌', artist: '另一个人', durationSec: 269 },
  ];
  assert.equal(S.pickMatch(hits, { title: '晴天', artist: '周杰伦', durationSec: 269 }), '3',
    '要挑时长对得上的那一首 —— 拿到翻唱/现场版的词比没有词更让人不信任');

  // 时长差太多的全是别的版本 → 挑不出就当没有词,**宁可空着**
  assert.equal(S.pickMatch(hits, { title: '晴天', artist: '周杰伦', durationSec: 500 }), '',
    '一条都对不上时必须返回空,不许退而求其次拿个差不多的');

  // 曲名对不上直接出局,不做模糊 —— 哪怕时长一模一样
  assert.equal(S.pickMatch(hits, { title: '稻香', artist: '周杰伦', durationSec: 223 }), '');
  assert.equal(S.pickMatch(hits, { title: '稻香', artist: '周杰伦', durationSec: 269 }), '',
    '时长撞上了也不算 —— 时长只是旁证,曲名才是主证据');

  // 括号后缀要能对上(「晴天 (Live)」和「晴天」是同一个名字的两个版本,
  // 靠时长而不是靠名字区分)
  assert.equal(S.pickMatch(hits, { title: '晴天(纯音乐版)', artist: '周杰伦', durationSec: 320 }), '1');

  // 不知道时长(0)时不卡这一道,但仍要按艺人挑 —— 否则会拿到翻唱那条
  assert.equal(S.pickMatch(hits, { title: '晴天', artist: '周杰伦', durationSec: 0 }), '3');

  // 空/脏输入不许抛
  assert.equal(S.pickMatch([], { title: '晴天', artist: '', durationSec: 0 }), '');
  assert.equal(S.pickMatch(hits, { title: '', artist: '', durationSec: 0 }), '',
    '连曲名都没有就别猜了');
}

/* ══ ⑧ 「没有词」和「取不到」不许合并 ════════════════════════════════════ */
{
  const route = read('app/api/portal/music/netease/lyric/route.ts');
  // 有响应但空词 → ok:true —— 界面据此说「这一首没有歌词」而不是挂一个点不好的重试
  assert.match(route, /ok: true, lrc: r\.value\.lrc/,
    '取到了(哪怕是空词)就是 ok —— 纯音乐不该被说成故障');
  assert.match(route, /reason: 'blocked'/, '风控要单独报 —— 它意味着换一首没用');
  assert.match(route, /status: 502/, '真故障要 502,那才是该重试的');
  assert.match(route, /guardAiRoute\(req, 'music-netease-lyric'/,
    '读私密数据/花钱的路由必须过 guardAiRoute(CLAUDE.md 红线)');

  const docs = read('docs/api-routes.md');
  assert.match(docs, /GET \/api\/portal\/music\/netease\/lyric/,
    '新 API 路由必须写进 docs/api-routes.md(CLAUDE.md 红线)');
}

console.log('music-lyrics: OK(多戳展开 / 元数据不进正片 / offset 生效 / 前奏不乱亮 / 翻译按时间配 / ID3 两个版本 / 挑不出宁可空着)');
