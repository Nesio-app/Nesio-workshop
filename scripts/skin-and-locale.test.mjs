/**
 * 行为契约:换肤要换全,动态文案要跟着语言走(2026-07-30,bug #23 / #24 / #10 / #26)。
 *
 *   #23 「换肤只在设置页生效,首页还是粉的」。
 *       查下来四套色卡对 `--portal-*` / `--status-*` 那整组 token **一个不漏都覆盖了**,
 *       找不到能解释那一屏的机制;最可能是那台设备还在跑旧构建(iOS PWA 后台驻留
 *       的页面从不重新加载)。所以这条契约做两件事:
 *         · 把「覆盖面」钉住 —— 以后新加的 token 不许悄悄漏出换肤;
 *         · 盯住那行**看得见的版本标**(原来的版本比对是静默自愈的,
 *           而静默的自愈机制在「它有没有生效」这种问题上等于不存在)。
 *
 *   #24 「动态生成的提醒卡片完全没跟着翻译」。兜底卡的模板词是写死的中文,
 *       函数连 locale 参数都没有。注意分清两种东西:**用户自己的数据不该被翻译**
 *       (把他记的「牛奶」翻成 Milk 是另一种失真),要跟着走的是我们加的那几个词。
 *
 *   #10 「JingBell」(接口)和「Model Y」($0 手动空壳)是同一辆车的两半。
 *   #26 「Jing / Jing Duan / DUAN JING」是同一个人被拆成三条 —— 规范化对**词序**无能为力。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

function loadTs(rel) {
  const js = ts.transpileModule(read(rel), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports, console, require: () => ({}),
    Date, Math, Number, Array, Object, String, Set, Map, JSON, isNaN, RegExp, Boolean,
  });
  return mod.exports;
}

/* ══ #23 换肤覆盖面:表面色和文字色也得跟着换 ══════════════════════ */
{
  const css = read('app/globals.css');
  const PALETTES = ['bluegray-rose', 'milktea', 'haze-blue', 'sage'];

  const blockTokens = (startIdx) => {
    const open = css.indexOf('{', startIdx);
    const close = css.indexOf('\n}', open);
    return new Set([...css.slice(open + 1, close).matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
  };
  const unionFor = (needle) => {
    const out = new Set();
    let i = css.indexOf(needle);
    while (i >= 0) { for (const t of blockTokens(i)) out.add(t); i = css.indexOf(needle, i + needle.length); }
    return out;
  };

  // 日间默认声明在 `.portal-root`(112 个),**不是** `:root, .portal-root`(那只有 8 个 --viz-*)。
  // 第一次查这条 bug 我比错了块,于是得出「都覆盖了」的错结论。判据钉在正确的块上。
  const baseAt = css.search(/\n\.portal-root \{/);
  assert.ok(baseAt >= 0, '日间默认块 `.portal-root` 还在');
  const base = blockTokens(baseAt);
  assert.ok(base.size > 50, `日间默认块应有上百个 token,实际 ${base.size} —— 比错块了就会得出错结论`);

  // 有意不换的两类,各有理由:
  //   ① 非颜色(间距/圆角/字号/字重/动效/层级/容器)—— 皮肤不改尺寸;
  //   ② 语义红 —— 红是「真实风险」的语义色(CLAUDE.md),跟着皮肤走会让风险提示
  //      在某些配色下和强调色分不开。和情绪色/地表色同一类:被描绘的含义,不是 UI 皮肤。
  const NON_COLOR = /^--(space|radius|text|weight|leading|tracking|dur|ease|shadow|glass-blur|modal-backdrop-blur|modal-backdrop-saturate|modal-card-blur|modal-card-saturate|tap-min|container|portal-bottom-nav-clearance|font)/;
  const SEMANTIC_RED = new Set(['--status-risk', '--status-risk-soft', '--status-stop', '--status-warn']);
  const skinnable = [...base].filter((t) => !NON_COLOR.test(t) && !SEMANTIC_RED.has(t));

  for (const p of PALETTES) {
    const covered = new Set([
      ...unionFor(`html[data-palette="${p}"]:not([data-portal-theme="night"])`),
      // 四套共用的那条表面色规则
      ...unionFor('html[data-palette]:not([data-portal-theme="night"])'),
    ]);
    const missing = skinnable.filter((t) => !covered.has(t));
    assert.deepEqual(missing, [],
      `色卡「${p}」没盖住这些颜色 token:${missing.join(', ')} —— ` +
      '漏掉的那些页面就还是原来的色调。' +
      '「--glass-bg-solid 全站用了 100 多次却不跟着换肤」正是用户看到的' +
      '「只有设置页变了、首页还是原来的色调」');
  }

  // 四套色卡覆盖的集合必须一致 —— 只给一套加 token 是下一个「只有一部分变了」
  const sets = PALETTES.map((p) => unionFor(`html[data-palette="${p}"]:not([data-portal-theme="night"])`));
  for (let i = 1; i < sets.length; i++) {
    const a = [...sets[0]].sort().join(',');
    const b = [...sets[i]].sort().join(',');
    assert.equal(b, a, `色卡「${PALETTES[i]}」和「${PALETTES[0]}」覆盖的 token 不一样`);
  }

  // 语义红是**有意**不换的,不是漏的 —— 把这句话也钉住,免得下次有人当 bug「修」回去
  for (const p of PALETTES) {
    assert.ok(!unionFor(`html[data-palette="${p}"]:not([data-portal-theme="night"])`).has('--status-risk'),
      '红是真实风险的语义色,不跟皮肤走(和情绪色/地表色同一类)');
  }
}

/* ══ #23 这台设备跑的是哪一版,必须看得见 ══════════════════════════ */
{
  const s = read('components/portal/SettingsSheets.tsx');
  assert.match(s, /const localBuild = \(process\.env\.NEXT_PUBLIC_BUILD_SHA \|\| 'dev'\)/,
    '版本比对早就有(Portal 回前台自动刷),但它是静默的 —— ' +
    '一个静默的自愈机制在「它到底有没有生效」这种问题上等于不存在');
  assert.match(s, /fetch\('\/api\/version'/, '要和线上那一版比,不能只报自己');
  assert.match(s, /\{buildStale && \(/, '不一样的时候要说出来');
  assert.match(s, /取新版|Get the new build/, '说完还得给一条出路');
}

/* ══ #24 兜底卡:模板词跟着语言,用户的数据原样 ═══════════════════ */
{
  const { buildFallbackCards } = loadTs('lib/platform/guidance-engine/fallback-cards.ts');
  const now = new Date(2026, 6, 30, 9, 0);
  const input = {
    expiryItems: [{ id: 'x', name: '牛奶', expiry: '2026-07-30' }],
    dueBills: [{ id: 'b', account: 'Chase', dueDate: '2026-07-31', minPayment: 35 }],
  };

  const zh = buildFallbackCards(input, now, 'zh');
  const en = buildFallbackCards(input, now, 'en');

  const enText = en.map((c) => `${c.title} ${c.body}`).join(' | ');
  assert.doesNotMatch(enText, /今天|明天|到效期|还款|最低/,
    '英文界面下今天页的卡片原来是中文的 —— 这几个词是**我们加的**,必须跟着语言走');
  assert.match(enText, /today|due|min/, '英文界面要真的出英文');

  const zhText = zh.map((c) => `${c.title} ${c.body}`).join(' | ');
  assert.match(zhText, /今天|到效期/, '中文界面照旧');

  // 用户自己的数据在两种语言下都原样
  for (const text of [zhText, enText]) {
    assert.match(text, /牛奶/, '物品名是用户记的,不许翻译 —— 把「牛奶」翻成 Milk 是另一种失真');
    assert.match(text, /Chase/, '账户名同理');
  }

  assert.match(read('components/portal/today/useTodayData.ts'), /\}, now, uiLocale\)/,
    '调用点要真的把界面语言传下去 —— 加了参数没人传就是白加');
}

/* ══ #26 「Jing / Jing Duan / DUAN JING」是同一个人 ═══════════════ */
{
  const { suggestPersonMerges, nameTokens } = loadTs('lib/portal/person-merge-suggest.ts');

  const hints = suggestPersonMerges(['Jing', 'Jing Duan', 'DUAN JING']);
  const high = hints.filter((h) => h.confidence === 'high');
  assert.equal(high.length, 1, '「Jing Duan」和「DUAN JING」是同样几个字、顺序不同 —— 这一对几乎不可能是两个人');
  assert.equal([high[0].canonical, high[0].alias].sort().join('|'), 'DUAN JING|Jing Duan');
  assert.equal(high[0].reason, 'same-words');

  const low = hints.filter((h) => h.confidence === 'low');
  assert.ok(low.length >= 1, '单个词的「Jing」也要提出来 —— 用户手动并了两条,第三条就是这么留下的');
  for (const h of low) {
    assert.ok(nameTokens(h.canonical).length >= 2, '词多的那条当 canonical(信息更全)');
    assert.equal(h.reason, 'one-word-subset');
  }
  assert.equal(hints[0].confidence, 'high', '高置信排前面');

  // 不许乱点鸳鸯谱
  assert.equal(suggestPersonMerges(['Linda', 'Peter']).length, 0, '毫不相干的两个人不该被凑一对');
  assert.equal(suggestPersonMerges(['Jing Duan']).length, 0, '只有一条时没什么可建议的');
  assert.equal(suggestPersonMerges(['Li Wei', 'Li Ming']).length, 0,
    '同姓不同名是两个人 —— 只共享一个词、而两边都不是单个词,不算候选');

  // 两台设备算出的建议要一致(否则一台说合、一台不说,又是同屏两个事实)
  const a = JSON.stringify(suggestPersonMerges(['DUAN JING', 'Jing', 'Jing Duan']));
  const b = JSON.stringify(suggestPersonMerges(['Jing Duan', 'DUAN JING', 'Jing']));
  assert.equal(a, b, '建议顺序/内容不许依赖输入顺序');

  // 界面:只建议,不自动合并 —— 合并不可撤销
  const panel = read('components/portal/relationships/RelationshipsPanel.tsx');
  assert.match(panel, /suggestPersonMerges\(contacts\.map\(\(c\) => c\.name\)\)/,
    '关系页要拿**真的联系人名单**去问 —— 传个空数组照样能骗过「用了这个函数」的断言');
  assert.match(panel, /onClick=\{\(\) => \{ mergeEntity\(h\.alias, h\.canonical\); rebuild\(\); \}\}/,
    '合并这一下必须由用户点 —— 系统替人做这个决定,错一次两个人的记录就再也分不开');
  assert.match(panel, /不可撤销/, '得把「不可撤销」写在按钮旁边');
  assert.match(panel, /'不是', 'Not the same'/, '也得能说「不是同一个人」');
  // 2026-07-30 自查:最初「不是」只放在组件 state 里,刷新一次就又问一遍 ——
  // 那正是用户这一轮报的「说过的话不算数」那一类毛病,在这儿犯同一个就说不过去。
  assert.match(panel, /setDismissedMerges\(dismissMerge\(h\.canonical, h\.alias\)\)/,
    '说过「不是」要落盘,不能只活在这次会话里');
  assert.match(panel, /setDismissedMerges\(loadDismissedMerges\(\)\)/, '下次打开要读回来');
  const lib = read('lib/portal/person-merge-suggest.ts');
  assert.match(lib, /const pairKey = \(canonical: string, alias: string\): string => \[canonical, alias\]\.sort\(\)/,
    '(A,B) 和 (B,A) 是同一对 —— 不排序的话换个方向又会问一遍');
  assert.match(read('scripts/storage-key-registry.test.mjs'), /\["nesio-person-merge-dismissed-v1", "durable"\]/,
    '这是用户的判断,不是缓存 —— 换台设备重新问一遍是错的,所以 durable;' +
    '不登记的话默认也是 durable,但登记才有人守着');
}

/* ══ #10 手动录的车能认到接口那辆上 ═══════════════════════════════ */
{
  const fin = read('lib/portal/finance-assets.ts');
  assert.match(fin, /teslaVehicleId\?: string;/, '资产上要能记「这是哪辆车」');
  assert.match(fin, /export function bindAssetToTesla/, '绑定/解绑');
  assert.match(fin, /if \(v\) for \(let i = 0; i < all\.length; i\+\+\) if \(i !== idx && all\[i\]\.teslaVehicleId === v\)/,
    '一辆车只能绑一件资产 —— 否则两张卡都说「这是 JingBell」,又是同屏两个事实');

  const panel = read('components/portal/AssetsPanel.tsx');
  assert.match(panel, /bindAssetToTesla\(asset\.id, e\.target\.value\)/, '车资产卡上要有这个入口');
  assert.match(panel, /\{boundVehicle && ` · \$\{L\(dict, `就是上面那辆/,
    '绑上之后卡头要写明(条件挂在 boundVehicle 上)—— ' +
    '包一层 {false && …} 照样能骗过只找文案的断言,变异测试抓到过');
  assert.match(panel, /teslaVehicles=\{tab === 'vehicle' \? teslaVehicles : \[\]\}/,
    '只有车 tab 才谈得上绑车 —— 房产卡上不该冒出一个「这是哪辆车」');

  const tesla = read('components/portal/TeslaPanel.tsx');
  assert.match(tesla, /if \(onVehicles\) \{[\s\S]{0,600}?onVehicles\(\[\.\.\.seen\.entries\(\)\]/,
    '实时那块要把认到的车**真的**报上去 —— 包一层 if (false) 照样能骗过只找调用文本的断言');
  assert.match(tesla, /\(boundIds \|\| \[\]\)\.includes\(vid\)/, '已经认亲的车,上面那块也要说一句');
}

console.log('skin-and-locale: OK(换肤不漏 token / 版本看得见 / 兜底卡跟着语言 / 人名候选不自动合 / 车能认亲)');
