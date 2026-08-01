/**
 * 行为契约:歌单这一层(2026-08-01,用户「歌单要新建数据层 —— 本地存 + 走通用云同步」)。
 *
 * 在这之前音乐模块只有一张平铺的曲库列表。这一层补「歌单」和「我喜欢的音乐」,
 * 而它一上来就是跨设备的(durable → 通用云同步),于是有三件事必须钉死:
 *
 *   ① **曲目引用带源前缀**。本地曲库自己发 `lt-<时间戳>`,网易用它那边的数字 id ——
 *      两个 id 空间各发各的,裸 id 存进歌单迟早撞。撞了的表现是点一首放出另一首,
 *      没人会往「id 撞了」上想。
 *   ② **条目自带名字**。歌单落到另一台设备时,那台机器的本地曲库是空的
 *      (音频本体在 IndexedDB、不进备份 —— 见 storage-manifest 里
 *      nesio-music-local-tracks-v1 判 cache 那段)。只存 ref 的话新设备上
 *      是一串认不出来的 id。
 *   ③ **加同一首两次只有一条**。「加歌单」这个按钮必然被重复点。
 *
 * 判据全部**真跑**(vm + localStorage 替身)。源码判据在这里压不住:
 * 「幂等」写成 `if (!exists)`,把它改成 `if (true)` 正则照样匹配得到。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

/** 最小 localStorage 替身 + window(dispatchEvent 只记不发)。 */
function fakeEnv() {
  const store = new Map();
  const events = [];
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
  };
  const window = {
    localStorage,
    dispatchEvent: (e) => { events.push(e?.type); return true; },
  };
  return { store, events, window, localStorage };
}

function loadPlaylistsModule(env) {
  const js = ts.transpileModule(read('lib/platform/music/playlists.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports, console,
    require: () => ({ logDropped: () => {}, reportStorageDropped: () => { env.dropped = true; } }),
    window: env.window, localStorage: env.localStorage,
    CustomEvent: class { constructor(type) { this.type = type; } },
    Date, Math, Number, Array, Object, String, Set, Map, JSON, Boolean,
  });
  return mod.exports;
}

/* ══ ① ref:两个源的 id 撞不上,拆不动的不猜 ═══════════════════════════════ */
{
  const env = fakeEnv();
  const P = loadPlaylistsModule(env);

  // 同一个数字 id,两个源必须得到不同的 ref —— 这一条就是 ① 的全部意义
  assert.notEqual(P.trackRef('local', '123'), P.trackRef('netease', '123'),
    '本地和网易的同号曲目必须是两个不同的 ref,否则歌单里点一首放出另一首');
  assert.equal(P.trackRef('local', 'lt-abc'), 'local:lt-abc');
  assert.equal(P.trackRef('netease', '1974443814'), 'netease:1974443814');

  // 拆得回来。逐字段断言 —— vm 里的对象原型和这里不是同一个,deepEqual 会因为
  // 「结构一样但不是同一个 Object」而挂,那不是我们要压的东西。
  const parsed = (r) => { const v = P.parseTrackRef(r); return v && `${v.source}|${v.id}`; };
  assert.equal(parsed('local:lt-abc'), 'local|lt-abc');
  assert.equal(parsed('netease:1974443814'), 'netease|1974443814');
  // 网易的 id 里真出现冒号也不该被截断(只切第一个冒号)
  assert.equal(parsed('netease:a:b'), 'netease|a:b');

  // **拆不动就返回 null,不猜**。当成 local 去 IndexedDB 里找只会得到一首
  // 放不出声的歌,而症状是「点了没反应」——比直接不显示贵得多。
  for (const bad of ['lt-abc', '', ':x', 'local:', 'spotify:5', null, undefined, 'LOCAL:x']) {
    assert.equal(P.parseTrackRef(bad), null, `parseTrackRef(${JSON.stringify(bad)}) 不许猜出一个源`);
  }
}

/* ══ ② 我喜欢的音乐:永远在、删不掉、改不了名 ══════════════════════════════ */
{
  const env = fakeEnv();
  const P = loadPlaylistsModule(env);

  // 一次都没写过的机器上也得有 —— 界面上那一栏不该「今天有明天没有」
  const first = P.loadPlaylists();
  assert.ok(Array.isArray(first) && first.length >= 1, '空存储也要给出「我喜欢的音乐」');
  assert.equal(first[0].id, P.LIKED_ID, '「我喜欢的音乐」必须排第一');

  // 删不掉。判据钉在**里面的歌还在不在**上 —— 「歌单壳子还在」压不住任何东西:
  // loadPlaylists 空存储也会补一个空壳出来,于是「删光了」和「没删」长得一模一样。
  P.toggleLiked({ ref: P.trackRef('netease', '9'), title: '一首', artist: '', durationSec: 100 });
  P.deletePlaylist(P.LIKED_ID);
  assert.equal(P.loadPlaylists().find((p) => p.id === P.LIKED_ID).entries.length, 1,
    '「我喜欢的音乐」删不掉 —— 连里面攒的歌一起没了是这条要防的事');

  P.renamePlaylist(P.LIKED_ID, '随便什么');
  assert.equal(P.loadPlaylists().find((p) => p.id === P.LIKED_ID).name, '',
    '「我喜欢的音乐」改不了名');

  // 它的名字是**界面上的字**,不从数据里读 —— 这份要上云,存中文的话
  // 英文那台设备会读到一行中文,两台还会互相覆盖
  assert.equal(P.playlistName({ id: P.LIKED_ID, name: '' }), '我喜欢的音乐');
  assert.equal(P.playlistName({ id: P.LIKED_ID, name: '' }, 'en'), 'Liked songs');
  assert.equal(P.playlistName({ id: 'x', name: '开车听' }, 'en'), '开车听', '用户起的名字不许翻译');
  assert.equal(P.playlistName({ id: 'x', name: '' }, 'en'), 'Untitled', '没名字的兜一个');

  // 普通歌单该删得掉、改得了名 —— 不然上面两条用「谁都删不掉」也能过
  const p = P.createPlaylist('开车听');
  assert.ok(P.loadPlaylists().some((x) => x.id === p.id), '新建的歌单要存下来');
  P.renamePlaylist(p.id, '通勤');
  assert.equal(P.loadPlaylists().find((x) => x.id === p.id).name, '通勤', '普通歌单要能改名');
  P.deletePlaylist(p.id);
  assert.equal(P.loadPlaylists().some((x) => x.id === p.id), false, '普通歌单要能删');
}

/* ══ ③ 加同一首两次只有一条 ═══════════════════════════════════════════════ */
{
  const env = fakeEnv();
  const P = loadPlaylistsModule(env);
  const pl = P.createPlaylist('测试');
  const entry = { ref: P.trackRef('local', 'lt-1'), title: '晴天', artist: '周杰伦', durationSec: 269 };

  assert.equal(P.addToPlaylist(pl.id, entry), true, '第一次要真加进去');
  assert.equal(P.addToPlaylist(pl.id, entry), false,
    '第二次要返回 false —— 界面据此说「已经在这个歌单里了」,而不是假装又加了一次');
  const after = P.loadPlaylists().find((x) => x.id === pl.id);
  assert.equal(after.entries.length, 1, '重复点「加歌单」不许在列表里多出一行');

  // 不同的歌当然要能各占一行(否则「只加得进一首」也能让上面全绿)
  P.addToPlaylist(pl.id, { ref: P.trackRef('local', 'lt-2'), title: '稻香', artist: '', durationSec: 0 });
  P.addToPlaylist(pl.id, { ref: P.trackRef('netease', 'lt-2'), title: '稻香(网易)', artist: '', durationSec: 223 });
  assert.equal(P.loadPlaylists().find((x) => x.id === pl.id).entries.length, 3,
    '本地 lt-2 和网易 lt-2 是两首不同的歌,必须各占一行');

  // 删得掉
  P.removeFromPlaylist(pl.id, P.trackRef('local', 'lt-1'));
  const refs = P.loadPlaylists().find((x) => x.id === pl.id).entries.map((e) => e.ref).join(',');
  assert.equal(refs, 'local:lt-2,netease:lt-2', '只删指定那一条');
}

/* ══ ④ 条目自带名字:换台设备至少知道这首叫什么 ═══════════════════════════ */
{
  const env = fakeEnv();
  const P = loadPlaylistsModule(env);
  const pl = P.createPlaylist('x');
  P.addToPlaylist(pl.id, { ref: P.trackRef('local', 'lt-9'), title: '夜空中最亮的星', artist: '逃跑计划', durationSec: 252 });

  // 模拟「云端那份落到另一台设备」:换一个全新环境,只把存储内容搬过去,
  // 本地曲库(IndexedDB)什么都没有。
  const other = fakeEnv();
  other.store.set('nesio-music-playlists-v1', env.store.get('nesio-music-playlists-v1'));
  const P2 = loadPlaylistsModule(other);
  const moved = P2.loadPlaylists().find((x) => x.id === pl.id);
  assert.ok(moved, '歌单本身要跟过去');
  assert.equal(moved.entries[0].title, '夜空中最亮的星',
    '换台设备后歌单里必须还看得见歌名 —— 只存 ref 的话这里是一串认不出来的 id');
  assert.equal(moved.entries[0].artist, '逃跑计划');
  assert.equal(moved.entries[0].durationSec, 252);
}

/* ══ ⑤ 存坏的数据不许炸,脏条目丢掉 ═══════════════════════════════════════ */
{
  const env = fakeEnv();
  // 手改过/老版本/半截写入 —— 这一层是要上云的,坏数据从别的端来是常态
  env.store.set('nesio-music-playlists-v1', JSON.stringify([
    { id: 'ok', name: '好的', entries: [
      { ref: 'local:lt-1', title: 'a', artist: '', durationSec: 10, addedAt: 1 },
      { ref: 'lt-2', title: '没有前缀的老数据', artist: '', durationSec: 10, addedAt: 2 },
      { ref: 'local:lt-1', title: '重复的', artist: '', durationSec: 10, addedAt: 3 },
      null,
      'not an object',
    ] },
    null,
    { name: '没有 id 的' },
  ]));
  const P = loadPlaylistsModule(env);
  const list = P.loadPlaylists();
  const ok = list.find((p) => p.id === 'ok');
  assert.ok(ok, '好的那份要留下');
  assert.equal(ok.entries.map((e) => e.ref).join(','), 'local:lt-1',
    '没有前缀的老条目和重复条目都要丢 —— 前者点了放不出声,后者会让「播放全部」听两次');
  assert.equal(list.some((p) => p.name === '没有 id 的'), false, '没有 id 的歌单留不得');

  // 整个存储是一坨垃圾时也只能是「什么都没有」,不许抛
  const bad = fakeEnv();
  bad.store.set('nesio-music-playlists-v1', '{{{');
  const P3 = loadPlaylistsModule(bad);
  assert.doesNotThrow(() => P3.loadPlaylists(), '存储坏了不许把整个音乐面板打翻');
  assert.equal(P3.loadPlaylists()[0].id, P3.LIKED_ID);
}

/* ══ ⑥ ♥ 是开关 ══════════════════════════════════════════════════════════ */
{
  const env = fakeEnv();
  const P = loadPlaylistsModule(env);
  const e = { ref: P.trackRef('netease', '111'), title: '海阔天空', artist: 'Beyond', durationSec: 326 };

  assert.equal(P.isLiked(e.ref), false, '一开始不是喜欢的');
  assert.equal(P.toggleLiked(e), true, '点一下变成喜欢的');
  assert.equal(P.isLiked(e.ref), true);
  assert.equal(P.toggleLiked(e), false, '再点一下取消');
  assert.equal(P.isLiked(e.ref), false);
  assert.equal(P.loadPlaylists().find((p) => p.id === P.LIKED_ID).entries.length, 0,
    '取消之后不该在列表里留一条');
}

/* ══ ⑦ 「42 首 · 3.2 小时」那一行 ════════════════════════════════════════ */
{
  const env = fakeEnv();
  const P = loadPlaylistsModule(env);
  const mk = (n, sec) => ({ entries: Array.from({ length: n }, (_, i) => ({ ref: `local:${i}`, durationSec: sec })) });

  assert.equal(P.playlistHeadline({ entries: [] }), '还没有歌曲');
  assert.equal(P.playlistHeadline({ entries: [] }, 'en'), 'No tracks yet');
  assert.match(P.playlistHeadline(mk(42, 274)), /^42 首 · 3\.2 小时$/);
  assert.match(P.playlistHeadline(mk(3, 200)), /^3 首 · 10 分钟$/, '不到一小时用分钟');

  // 时长未知的曲目**只是不计入总时长**,不该把整行变成「未知」——
  // 一首刚导入还没读出时长的歌不该让另外 41 首失去意义
  const mixed = { entries: [
    { ref: 'local:1', durationSec: 0 },
    { ref: 'local:2', durationSec: 3600 },
  ] };
  assert.match(P.playlistHeadline(mixed), /^2 首 · 1 小时$/,
    '有一首时长未知,另一首的时长仍要算进去');
  // 全都未知时只报数量,不报一个假的 0
  assert.equal(P.playlistHeadline(mk(5, 0)), '5 首');
}

/* ══ ⑧ 存储分类:durable(换台手机我的歌单该还在) ═════════════════════════ */
{
  const registry = read('scripts/storage-key-registry.test.mjs');
  assert.match(registry, /\["nesio-music-playlists-v1", "durable"\]/,
    '歌单 key 必须在册且判 durable —— 未登记默认 durable 看着一样,但那是「碰巧对」,' +
    '下次有人扫表时无从判断它是不是想清楚过');

  // 而且不能被专属同步引擎接管 —— 用户要的是「走通用云同步」
  const js = ts.transpileModule(read('lib/portal/sync-ownership.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports, console,
    // 它只从 cloud-email-sync 里取一个前缀常量;stub 成一个真前缀,
    // 免得 undefined 让 startsWith 把所有 key 都算成专属(那会让下面这条假绿)。
    require: () => ({ EMAIL_BODY_MODULE_PREFIX: 'email-body:' }),
    String, Array, Object, Set, Boolean,
  });
  assert.equal(mod.exports.isDedicatedSyncKey('nesio-music-playlists-v1'), false,
    '歌单走通用 cloud-module-sync,不该落进任何专属引擎的地盘');
}

console.log('music-playlists: OK(ref 带源前缀 / 喜欢的删不掉 / 加两次只有一条 / 换设备还看得见歌名 / 坏数据不炸 / durable 走通用同步)');
