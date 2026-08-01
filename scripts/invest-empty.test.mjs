/**
 * 行为契约:投资页的空态(2026-08-01,用户实测截图:这一页一片白,
 * 底下只孤零零一句「价格是上次同步的快照」)。
 *
 * 用户看到的整个页面就是那一句免责声明。它既没说为什么空、也没说下一步做什么,
 * 而且那句话本身在没有任何价格的时候是纯噪音 —— 它谈的是一个不存在的东西的口径。
 *
 * 三种空因,三个不同的下一步。最要小心的是中间那种:
 * 「没同步到」和「账户里真的没有持仓」我们**分不出来**,
 * 那就如实说分不出来,不替券商断言。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';
import { stripComments } from './lib/strip-comments.mjs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const js = ts.transpileModule(read('lib/portal/invest-empty.ts'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mod = { exports: {} };
vm.runInNewContext(js, { module: mod, exports: mod.exports, console, Math, Number, Object });
const { investEmptyReason } = mod.exports;

/* ══ ① 三种空因分得开 ═════════════════════════════════════════════════════ */
{
  assert.equal(investEmptyReason({ holdingCount: 0, investAccountCount: 0 }), 'no-account',
    '一个投资账户都没连 → 该说的是「去连一个券商」');
  assert.equal(investEmptyReason({ holdingCount: 0, investAccountCount: 2 }), 'no-holdings',
    '连了账户但没取到持仓 → 该说的是「去同步一次」,和上一种不是同一句话');
  assert.equal(investEmptyReason({ holdingCount: 5, investAccountCount: 1 }), 'none');
  // 有持仓但账户数为 0(账户表没同步下来)—— 仍然不是空态,别把有数据的页面判成空
  assert.equal(investEmptyReason({ holdingCount: 5, investAccountCount: 0 }), 'none',
    '手上有持仓就不是空态,哪怕账户表这次没下来');

  // 脏输入不许抛,也不许算出第四种
  for (const bad of [
    { holdingCount: NaN, investAccountCount: NaN },
    { holdingCount: -3, investAccountCount: -1 },
    {},
  ]) {
    assert.doesNotThrow(() => investEmptyReason(bad));
    assert.ok(['no-account', 'no-holdings', 'none'].includes(investEmptyReason(bad)));
  }
}

/* ══ ② 界面:三种空因说三种话,且都给下一步 ═══════════════════════════════ */
{
  const pane = stripComments(read('components/portal/finance/InvestPane.tsx'));

  assert.match(pane, /investEmptyReason\(\{/, '空因要走这个判据,不许在组件里再写一份');
  assert.match(pane, /emptyReason === 'no-account'/, '「没连账户」要单独一支');
  assert.match(pane, /emptyReason === 'no-holdings'/, '「连了但没持仓」要单独一支');

  // 每一支都要有**下一步**,不能只报告状态。
  // 中英**分别**断言 —— 写成 `/中文|English/` 的话,把中文那半换成「暂无数据」
  // 照样全绿(英文那半还在)。这就是「断言太宽 = 断言不存在」。
  assert.match(pane, /数据接入里连一个券商/, '没连账户时要指路去连(中文)');
  assert.match(pane, /Connect a brokerage/, '没连账户时要指路去连(英文)');
  assert.match(pane, /同步一次财务/, '没持仓时要指路去同步(中文)');
  assert.match(pane, /Run a finance sync/, '没持仓时要指路去同步(英文)');

  // **不许替券商断言账户是空的**。「没同步到」和「真的没有」分不出来,
  // 分不出来就说分不出来 —— 一句「你的账户是空的」在它其实只是没同步时是错话。
  const holdingsBlock = pane.slice(pane.indexOf("emptyReason === 'no-holdings'"), pane.indexOf('</div>', pane.indexOf("emptyReason === 'no-holdings'")) + 2000);
  assert.match(holdingsBlock, /同步过还是空的话/,
    '要把「同步过之后还是空」作为前提,才敢说账户确实没有持仓(中文)');
  assert.match(holdingsBlock, /If it is still empty after that/,
    '同上(英文)—— 两边分开断言,不然改掉一边照样全绿');
}

/* ══ ③ 空的时候不许再说那句免责声明 ═══════════════════════════════════════ */
{
  const pane = stripComments(read('components/portal/finance/InvestPane.tsx'));
  // 用户实测时看到的**整个页面**就是这一句。没有价格的时候谈价格的口径,
  // 是噪音,不是诚实。
  assert.match(pane, /emptyReason === 'none' && \(\s*\n?\s*<p className="nesio-fin-alert-note"[\s\S]{0,200}价格是上次同步的快照/,
    '那句「价格是上次同步的快照」只在真有持仓时说 —— 一屏空白配一句它,正是用户截图上的样子');
}

console.log('invest-empty: OK(三种空因分得开 / 各自给下一步 / 不替券商断言 / 空的时候不谈价格口径)');
