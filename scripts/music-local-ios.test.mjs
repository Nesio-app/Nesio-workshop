/**
 * 行为契约:导进来的歌在 iPhone 上真的能出声(2026-08-01,用户「我选的 mp3,也无法播放」)。
 *
 * 上一轮我把「本地上传没实现」判成了问一问那边的 file picker,方向对了一半 ——
 * 用户说的是**音乐**。而音乐这条路上导入和播放的接线都在,桌面 Chromium 里
 * 导入成功、点了出声,一切正常。会且只会在 iOS 上断的有两处,都是 WebKit 特有:
 *
 *   ① **往 IndexedDB 里写 File 对象**。File 是一个指向磁盘临时文件的句柄,
 *      WebKit 存进去的也只是这个引用;等 iOS 回收掉那份临时文件,读回来就是
 *      0 字节或者直接失败。Chrome 会老老实实拷一份 —— 所以本地永远测不出来:
 *      导入看着成功、列表里也有,过一会儿点了没声。
 *      正确做法是 arrayBuffer() 拿到自己的字节,存 Blob 副本。
 *
 *   ② **空 MIME 的 blob URL**。Safari 不嗅探内容,`type` 为空的 blob 喂给 audio
 *      元素就是不出声(Chrome 自己认得出来)。而 iOS 的「文件」App / iCloud Drive
 *      交出来的 File,`type` 空着是常态。所以 MIME 必须自己从扩展名兜一个,
 *      而且读回来时要再兜一次(老数据是当初没 type 存进去的)。
 *
 * 这两条和 file-picker-ios 那条是同一类:桌面全绿、手机全黑,而失败还是静默的。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';
import { stripComments } from './lib/strip-comments.mjs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

/**
 * 最小的 IndexedDB 替身。存什么就还什么 —— 用来**真跑** getTrackBlob,
 * 而不是拿正则去源码里找那行 `new Blob([raw])` 在不在。
 * (源码判据在这里压不住:在那行前面插一句 `return raw;`,正则照样匹配得到。
 *  第一版就是这么写的,注入回归当场抓出来。)
 */
function fakeIndexedDB(seed = new Map()) {
  const store = seed;
  const tx = () => ({
    objectStore: () => ({
      put(v, k) { store.set(k, v); queueMicrotask(() => this._tx.oncomplete?.()); return { _tx: this._tx }; },
      get(k) { const r = { result: store.get(k) ?? undefined }; queueMicrotask(() => r.onsuccess?.()); return r; },
      delete(k) { store.delete(k); queueMicrotask(() => this._tx.oncomplete?.()); return {}; },
      clear() { store.clear(); queueMicrotask(() => this._tx.oncomplete?.()); return {}; },
    }),
  });
  return {
    _store: store,
    open() {
      const req = {};
      queueMicrotask(() => {
        req.result = {
          objectStoreNames: { contains: () => true },
          createObjectStore: () => {},
          transaction() { const t = tx(); const os = t.objectStore(); os._tx = t; t.objectStore = () => os; return t; },
        };
        req.onsuccess?.();
      });
      return req;
    },
  };
}

function loadTs(rel, extra = {}) {
  const js = ts.transpileModule(read(rel), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports, console,
    require: () => ({ logDropped: () => {}, reportStorageDropped: () => {} }),
    Date, Math, Number, Array, Object, String, Set, Map, JSON, isNaN, RegExp, Boolean, Blob,
    Promise, queueMicrotask, Number_isFinite: Number.isFinite,
    ...extra,
  });
  return mod.exports;
}

const LT = loadTs('lib/platform/music/local-tracks.ts');

/* ══ ① MIME 兜底:iOS 交出来的 File 常常没有 type ═══════════════════════════ */
{
  const { mimeFromName } = LT;
  assert.equal(typeof mimeFromName, 'function', 'mimeFromName 必须导出 —— 判据挂在它身上');

  // 常见格式各自认对。**逐个断言具体值**,不是「返回了个非空串就算过」——
  // 那种断言下 `return "audio/mpeg"` 一行也能全绿,而 flac/wav 在 Safari 上
  // 拿 audio/mpeg 是放不出来的。
  assert.equal(mimeFromName('a.mp3'), 'audio/mpeg');
  assert.equal(mimeFromName('a.m4a'), 'audio/mp4');
  assert.equal(mimeFromName('a.flac'), 'audio/flac');
  assert.equal(mimeFromName('a.wav'), 'audio/wav');
  assert.equal(mimeFromName('a.ogg'), 'audio/ogg');
  assert.equal(mimeFromName('a.aac'), 'audio/aac');
  // 大小写、多点的文件名都要认(iCloud 下来的文件名什么样都有)
  assert.equal(mimeFromName('My Song - Live.FLAC'), 'audio/flac');
  // 认不出来的落到 mp3:绝大多数导入是 mp3,猜错的代价只是这一首放不了。
  assert.equal(mimeFromName('no-extension'), 'audio/mpeg');
  assert.equal(mimeFromName(''), 'audio/mpeg');
  // 返回值永远不许是空串 —— 空 MIME 正是这条契约要防的东西
  for (const n of ['x.mp3', 'x.zzz', '', 'x', 'x.']) {
    assert.ok(mimeFromName(n).length > 0, `mimeFromName(${JSON.stringify(n)}) 返回了空串`);
  }
}

/* ══ ② isAudioFile:iOS 上 type 空 + 无扩展名也必须收 ══════════════════════ */
{
  const { isAudioFile } = LT;
  // iOS 的「文件」App 常见形态:type 空、甚至没有扩展名
  assert.equal(isAudioFile({ name: '未命名', type: '' }), true, 'type 空 + 无扩展名必须让它进来试');
  assert.equal(isAudioFile({ name: 'song.mp3', type: '' }), true);
  assert.equal(isAudioFile({ name: 'song', type: 'audio/mpeg' }), true);
  // 明显不是的才挡
  assert.equal(isAudioFile({ name: 'a.jpg', type: 'image/jpeg' }), false);
  assert.equal(isAudioFile({ name: 'a.pdf', type: '' }), false);
  assert.equal(isAudioFile({ name: 'a.mp4', type: 'video/mp4' }), false);
}

/* ══ ③ 存进 IDB 的必须是字节副本,不是 File 句柄 ═══════════════════════════ */
{
  const src = stripComments(read('lib/platform/music/local-tracks.ts'));
  const imp = src.slice(src.indexOf('export async function importLocalTrack'));
  assert.ok(imp.length > 200, '找不到 importLocalTrack —— 判据挂在这一段上,比错块就会假绿');

  assert.match(imp, /await file\.arrayBuffer\(\)/,
    '导入必须 arrayBuffer() 真读一遍 —— 直接把 File 存进 IDB,WebKit 存的只是一个' +
    '指向磁盘临时文件的引用,iOS 回收掉那份临时文件之后读回来就是空的');
  assert.match(imp, /\.put\(\s*new Blob\(/,
    'put 进去的必须是 new Blob(字节) —— 不是那个 File 对象本身');
  // 反过来也钉住:不许再出现 put(file)
  assert.doesNotMatch(imp, /\.put\(\s*file\s*,/,
    '又把 File 直接 put 进 IDB 了 —— 这正是 iOS 上「导进来了、点了没声」的根');
  // 红线:读失败要有可见失败态,不许静默
  assert.match(imp, /readFailed/, 'arrayBuffer() 失败必须有一句人话');
  assert.match(imp, /mimeFromName\(/,
    'MIME 必须从扩展名兜底 —— file.type 在 iOS 上空着是常态,而空 MIME 放不出声');
}

/* ══ ④ 读回来时:0 字节当「不在了」,空 MIME 要重新包 ═══════════════════════ */
{
  const src = stripComments(read('lib/platform/music/local-tracks.ts'));
  const get = src.slice(src.indexOf('export async function getTrackBlob'), src.indexOf('export async function deleteLocalTrack'));
  assert.ok(get.length > 200, '找不到 getTrackBlob —— 比错块就会假绿');

  assert.match(get, /mimeType\?:\s*string/, 'getTrackBlob 要能接调用方记着的 MIME');

  // ── 真跑一遍。源码判据在这里压不住:在 `new Blob([raw])` 前面插一句 `return raw;`,
  //    正则照样匹配得到、照样绿。所以喂真 blob 进去,看拿回来的是什么。
  const seed = new Map();
  const withDb = loadTs('lib/platform/music/local-tracks.ts', {
    indexedDB: fakeIndexedDB(seed),
    window: { addEventListener() {}, removeEventListener() {}, dispatchEvent() {} },
    localStorage: (() => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }; })(),
    CustomEvent: class { constructor(t) { this.type = t; } },
  });

  // (a) 存进去的没有 type(iOS 上的常态)→ 读回来必须带上 MIME,否则 Safari 不出声
  seed.set('t1', new Blob([new Uint8Array([1, 2, 3, 4])]));
  const got = await withDb.getTrackBlob('t1', 'audio/flac');
  assert.ok(got, 'getTrackBlob 不该在这里返回 null');
  assert.equal(got.type, 'audio/flac',
    `读回来的 blob 还是空 MIME(拿到 ${JSON.stringify(got.type)}) —— ` +
    'Safari 不嗅内容,空 MIME 的 blob URL 就是不出声,而 Chrome 会自己认出来');
  assert.equal(got.size, 4, '重包的时候把字节弄丢了');

  // (b) 已经有 type 的原样返回,别多包一层
  seed.set('t2', new Blob([new Uint8Array([9])], { type: 'audio/mpeg' }));
  const got2 = await withDb.getTrackBlob('t2', 'audio/flac');
  assert.equal(got2.type, 'audio/mpeg', '本来就有 type 的不该被调用方传的 MIME 覆盖掉');

  // (c) 0 字节 = 那份 File 引用已经废了 → 当「文件不在了」,不是「格式放不了」
  seed.set('t3', new Blob([]));
  assert.equal(await withDb.getTrackBlob('t3', 'audio/mpeg'), null,
    '0 字节必须当成「文件不在了」—— 把空 blob 喂给 audio 换来的是一句「这个格式放不了」,那是误诊');

  // (d) 压根没有的 → null
  assert.equal(await withDb.getTrackBlob('nope', 'audio/mpeg'), null);

  // 播放侧真的把 MIME 传过去了(不传的话上面那层白做)
  const eng = stripComments(read('lib/platform/music/player-engine.ts'));
  assert.match(eng, /getTrackBlob\(id,\s*track\.mimeType\)/,
    'playId 必须把 track.mimeType 传给 getTrackBlob —— 不传就退回到「空 MIME 放不出声」');
}

/* ══ ⑤ 时长回填要让列表看得见 ════════════════════════════════════════════ */
{
  const src = read('lib/platform/music/local-tracks.ts');
  assert.match(src, /export const LOCAL_TRACKS_CHANGED/, '曲库变更事件名要导出,两边共用同一个常量');
  const setDur = src.slice(src.indexOf('export function setTrackDuration'));
  assert.match(setDur.slice(0, 800), /dispatchEvent\(new CustomEvent\(LOCAL_TRACKS_CHANGED\)/,
    '时长写回后要派事件 —— 面板那份 tracks 是导入那一刻的快照,不通知它,' +
    '列表上的时长会永远停在「--:--」,而秒数其实早就存下来了');

  const panel = read('components/portal/music/MusicPanel.tsx');
  assert.match(panel, /addEventListener\(LOCAL_TRACKS_CHANGED/, '面板必须订阅曲库变更');
  assert.match(panel, /removeEventListener\(LOCAL_TRACKS_CHANGED/, '订阅要撤销,否则卸载后还在 setState');
}

/* ══ ⑥ 幂等:值没变不许反复写 + 反复派事件 ═══════════════════════════════ */
{
  const src = stripComments(read('lib/platform/music/local-tracks.ts'));
  const setDur = src.slice(src.indexOf('export function setTrackDuration'), src.indexOf('export function renameLocalTrack'));
  assert.match(setDur, /durationSec === Math\.round\(durationSec\)\) return/,
    'setTrackDuration 挂在 loadedmetadata 上,值没变必须直接回 —— 否则每次播放都写一遍 localStorage 并派一次事件');
}

console.log('music-local-ios: OK(MIME 逐格式认对 / 存字节副本不存 File 句柄 / 空 MIME 重包 / 0 字节当丢失 / 时长回填看得见)');
