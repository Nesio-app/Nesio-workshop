/**
 * 财务 bug3 契约(用户标注 p30–p35 的防回潮锁)。
 *
 * 最容易被下一次改动悄悄弄回去的三类:
 *   ① 「待确认」确认后不消失 —— 病根是 detectRecurring 的 status 只看样本数(<3 就是
 *      predicted),setRecurRule(key,'yes') 只让它进列表、清不掉徽标。修法是把「证据够不够」
 *      (status)和「人确认过」(confirmed)拆成两件事。这里用真数据跑 detectRecurring。
 *   ② 每一笔流水的「修改」(关联人/附件/备注)必须存覆盖层(按 tx.id),不能往 BankTx 上写 ——
 *      Plaid 每次同步整体合并,写在流水上会被冲掉。附件写失败必须出可见错误(红线)。
 *   ③ 页面结构:支出 tab 改名「分类」、饼图 big、商户/收入来源改成左右滑动的交互饼图、
 *      组合结构点开看持仓、四张卡 + 念念/＋记在卡片下面、预算挪到最下面。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(rel, extraRequire = {}) {
  const src = fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports, console, JSON, Array, Object, Set, Map, Number, Math, Date, String, RegExp, Boolean,
    require: (id) => extraRequire[id] || {
      reportStorageDropped: () => {}, logDropped: () => {}, deleteLocalFile: async () => {},
      createBlobStore: () => ({ load: () => [], save: () => {} }),
      normalizeCategory: (c) => c, categoryLabel: (c) => c,
      // tx-graph-bridge:批注现在是**两写**(覆盖层 + 图)。这里 stub 掉图那一侧,
      // 本文件只验覆盖层的行为;图那一侧由 spend-claim.test.mjs 真跑。
      linkTxToPerson: () => ({ graphOk: true }), unlinkTxFromPerson: () => ({ graphOk: true }),
      attachAssetToTx: () => ({ graphOk: true }), detachAssetFromTx: () => ({ graphOk: true }),
    },
  });
  return mod.exports;
}

// ── ① 「待确认」确认后消失:confirmed 与 status 是两个概念 ──
const src = fs.readFileSync(new URL('../lib/portal/providers/bank-tx.ts', import.meta.url), 'utf8');
assert.ok(/confirmed\?: boolean/.test(src), 'RecurringCharge 必须有 confirmed 字段(人确认过),不能靠改 status 清徽标');
assert.ok(/confirmed: ruleFor\(recurRules, last\) === 'yes'/.test(src),
  'predicted 分支必须把「人已确认」写进 confirmed —— 否则确认了徽标还在');
// status 不许被确认动作改写:recurringPriceHikes 拿 status 当「样本够不够」的门,
// 2 笔的中位数当基准会造出假涨价(bug2 数值审计修过同一类问题)。
assert.ok(/if \(r\.status !== 'mature'\) continue/.test(
  fs.readFileSync(new URL('../lib/portal/finance-features.ts', import.meta.url), 'utf8'),
), '涨价检测仍必须只看 mature —— 说明 status 不能被「人确认」污染');

const tab = fs.readFileSync(new URL('../components/portal/finance/FinanceTab.tsx', import.meta.url), 'utf8');
// 剥注释再查「已删/条件」—— 本仓踩过多次「注释里写了一句就把断言喂饱」。
const code = tab.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const badgeGates = code.match(/r\.status === 'predicted' && !r\.confirmed/g) || [];
assert.ok(badgeGates.length >= 3,
  `「待确认」三处(列表行/详情头/确认按钮)都要看 confirmed,现在只有 ${badgeGates.length} 处`);

// ── ② 交易批注覆盖层 ──
const ann = load('../lib/portal/tx-annotations.ts');
for (const fn of ['loadTxAnnotations', 'txAnnotationOf', 'hasTxAnnotation', 'setTxPeople', 'toggleTxPerson', 'setTxNote', 'addTxAttachment', 'removeTxAttachment']) {
  assert.strictEqual(typeof ann[fn], 'function', `tx-annotations 必须导出 ${fn}`);
}
assert.strictEqual(ann.hasTxAnnotation(undefined), false, '没有批注就是 false');
assert.strictEqual(ann.hasTxAnnotation({ people: [] }), false, '空数组不算有批注(否则空键会攒垃圾)');
assert.strictEqual(ann.hasTxAnnotation({ people: ['linda'] }), true);
assert.strictEqual(ann.hasTxAnnotation({ attachments: [{ assetId: 'a', name: 'n', mimeType: 'image/png', size: 1 }] }), true);
// 无 window(SSR / 存不进)时写操作返回 false —— 调用方据此出可见错误,不许假成功
// 返回值是 { ok, graphOk }:ok = 财务页存下了吗,graphOk = 别处看得到吗。
// 没有 window 时覆盖层写不进 → ok 必须是 false,不许假成功。
assert.strictEqual(ann.setTxPeople('tx1', ['linda']).ok, false, '没有 window 时写入必须返回 ok:false,不许假成功');

const annSrc = fs.readFileSync(new URL('../lib/portal/tx-annotations.ts', import.meta.url), 'utf8');
assert.ok(/reportStorageDropped\(\)/.test(annSrc), '写失败必须 reportStorageDropped(红线:不许吞掉存储失败)');
assert.ok(/deleteLocalFile\(assetId\)/.test(annSrc), '删附件要连 IndexedDB 里的本体一起删,不留孤儿占配额');

assert.ok(/function TxEditPanel/.test(tab), '交易行下面必须有「修改」面板(TxEditPanel)');
assert.ok(code.includes("'修改'"), '每一笔流水要有「修改」入口');
assert.ok(code.includes("'关联人'"), '「修改」里要能手动关联人');
assert.ok(code.includes("'传附件'"), '「修改」里要能传附件');
assert.ok(/putLocalFile\(assetId, f, meta\)/.test(tab), '附件本体进 local-file-store(IndexedDB),不塞 localStorage');
assert.ok(/if \(!stored \|\| !added\?\.ok\)/.test(tab), '本体或元信息任一没写进,都要报错,不许挂指向空气的附件');
// 关联只落在财务页 = 这一层要修的毛病本身。它必须被说出来,不许静默。
assert.ok(/!r\.graphOk/.test(code) && /no_person_node/.test(code),
  '关联写进了财务页但没连上图时,UI 必须说清楚(「TA 还不是联系人,所以 TA 的页面看不到这笔钱」)—— 静默 = 用户以为关联上了,其实别处还是看不到');
assert.ok(/!added\.graphOk/.test(code), '附件存下了但没挂进记忆节点,也要说 —— 否则这张发票只有财务页看得到');
assert.ok(/role="alert"/.test(tab), '「修改」里的失败必须有可见错误(红线)');
assert.ok(/buildRelationships\(getLifeGraph\(\)/.test(tab), '关联人的候选要和关系页同一套联系人');

// ── ③ 页面结构 ──
assert.ok(/\['spending', '分类', 'Categories'\]/.test(tab), '「支出」tab 必须改名「分类」');
const donutBig = tab.match(/<FinanceDonut big/g) || [];
assert.ok(donutBig.length >= 2, `主视图饼图要调大(big):分类页 + 组合结构,现在只有 ${donutBig.length} 处`);
// 分类页双饼合一:只留分类环;点扇区出走势 + 商户 Top + 每笔明细(不再左右滑第二张饼)
assert.ok(!/function SpendChartPager/.test(tab), '分类页不应再有第二张商户/收入滑动饼图');
assert.ok(/该分类 · 商户 Top|In this category · Top merchants/.test(tab), '点分类后要有该分类的商户分析');
assert.ok(/明细 · \$\{catTxs\.length\}|Details · \$\{catTxs\.length\}/.test(tab), '点分类后要有每笔明细列表');
assert.ok(/setSpendFocus/.test(tab) && /onSlice=/.test(tab), '分类饼图要可点');
assert.ok(/setAllocPick/.test(tab), '组合结构环形图要能点开看这一类的持仓');
// 四张卡 + 念念在卡片下面;手记银行流水入口已撤(资产更新走 CardsPane.onQuickAddAsset)
const kpiAt = tab.indexOf("'收入', 'Income'");
const nessaAt = tab.indexOf('nesio-fin-nessa');
assert.ok(kpiAt > 0 && nessaAt > kpiAt, '念念那句话要在四张卡下面');
assert.ok(!tab.includes("'＋ 记一笔'"), '总览不再手记银行流水');
assert.ok(/onQuickAddAsset/.test(tab), '资产更新仍走 CardsPane');
for (const card of ["'收入', 'Income'", "'支出', 'Spending'", "'总资产', 'Total assets'", "'投资', 'Investing'"]) {
  assert.ok(tab.includes(card), `总览必须有这张卡:${card}`);
}
assert.ok(!code.includes("['spending', '支出'"), '「支出」不再是 tab 名');
// 「+记」不再是 sub-tab
assert.ok(!/\['add',/.test(code), '「＋记」不许再占一个 tab 位');
// 预算:「手动添加」改名「预算」,与「生成」一起在分类页最下面
assert.ok(!code.includes('＋ 手动添加'), '「＋手动添加」已改名「预算」');
const budgetAt = tab.indexOf("{L(dict, '预算', 'Budget')}");
const investSplitAt = tab.indexOf('P2 投资');
assert.ok(budgetAt > 0 && investSplitAt > budgetAt, '预算块要落在分类页最下面(投资拆分之前)');

// 投资页 bug3
const invest = fs.readFileSync(new URL('../components/portal/finance/InvestPane.tsx', import.meta.url), 'utf8');
const investCode = invest.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
assert.ok(!investCode.includes('今年到现在'), '「今年到现在:股利/利息」已按标注删除');
assert.ok(/h\.ticker \|\| h\.name/.test(invest), '持仓只显示代码,不显示基金全名');
assert.ok(investCode.includes('持有至今') || investCode.includes('since buy'), '绿色收益要标出是哪一段时间的');
assert.ok(/nesio-fin-group-h--plain/.test(invest), '账户名用正文黑体,不用小型大写标签样式');

// 卡片页 bug3
const cards = fs.readFileSync(new URL('../components/portal/finance/CardsPane.tsx', import.meta.url), 'utf8');
assert.ok(/IconCheck/.test(cards), '「保存」改成对勾图标');
assert.ok(/改好了|Saved/.test(cards), '保存后要有成功反馈(不许点了没反应)');
assert.ok(/var\(--status-risk\)/.test(cards), '「移除此账户」用风险色');

console.log('finance-bug3: OK');
