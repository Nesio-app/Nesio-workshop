/**
 * 行为契约:记忆详情页的按钮只剩必要的那几个(2026-08-01,用户点名整理)。
 *
 * 用户原话:「目前通用按钮有阅读原文,回复,添加照片,分派家人,下面有,关联,
 * 用镜头看看,阅读,编辑,删除。整理意见。把添加照片改为添加附件包括照片,
 * 删除,分派家人,关联记忆都放进点击编辑后的页面。把按钮都放到最下面,
 * 样子一样,缩小。详情页就阅读和编辑 2 个按钮。镜头看看改为镜头 2 个字,
 * 只出现在,手记,note,flomo,阅读笔记,心情类这些详情页」。
 *
 * 在这之前这一屏上散着七八个按钮,而且「阅读」上下各有一份。
 * 分界线是**看 vs 改**:看这条记忆(阅读)留在详情页,
 * 改这条记忆(加附件/分派/关联/删除)全在编辑态。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';
import { stripComments } from './lib/strip-comments.mjs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

/* ══ ① 「镜头」给谁看:真跑判据 ═══════════════════════════════════════════ */
{
  const js = ts.transpileModule(read('lib/portal/lens-eligible.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, String, Array, Object, console });
  const { isLensEligible } = mod.exports;

  // 用户点名的五类都要有
  assert.equal(isLensEligible({ source: 'manual', type: 'collection' }), true, '手记');
  assert.equal(isLensEligible({ source: 'voice', type: 'collection' }), true, '说一句记下来的也是手记');
  // 手记那一支要**单独**成立:去掉它之后,一条 type 不是 note 的手记就没有镜头了。
  // (第一版所有手记用例都同时带 type:'collection',于是删掉 source 分支照样绿 —— 注入抓出来的。)
  assert.equal(isLensEligible({ source: 'manual', type: 'task' }), true,
    '首页输入条记下的一笔是 commitment,它也是自己写的字');
  // 但手动登记的**物品/地点/人**不算 —— 那些的详情页是一张表,不是一段话
  assert.equal(isLensEligible({ source: 'manual', type: 'Thing' }), false,
    '手动登记的一件物品仍然是物品,镜头对着它没有话可看');
  assert.equal(isLensEligible({ source: 'manual', type: 'place' }), false);
  assert.equal(isLensEligible({ source: 'manual', type: 'person' }), false);
  assert.equal(isLensEligible({ type: 'collection', source: 'import' }), true, 'note 类型');
  assert.equal(isLensEligible({ type: 'Thing', source: 'import', tags: ['flomo'] }), true, 'flomo');
  assert.equal(isLensEligible({ type: 'Thing', source: 'import', tags: ['微信读书'] }), true, '阅读笔记');
  assert.equal(isLensEligible({ type: 'Thing', source: 'import', tags: ['阅读'] }), true, '阅读');
  assert.equal(isLensEligible({ type: 'Thing', source: 'import', tags: ['心情'] }), true, '心情');
  assert.equal(isLensEligible({ type: 'Thing', source: 'import', tags: ['mood'] }), true, '心情(英文 tag)');
  assert.equal(isLensEligible({ type: 'Thing', source: 'import', tags: ['MOOD'] }), true, 'tag 大小写不该影响判定');

  // 底下没有话可看的,不该出现镜头 —— 那是一条点了之后发现无话可说的路
  assert.equal(isLensEligible({ type: 'event', source: 'calendar' }), false, '日历事件底下没有话可看');
  assert.equal(isLensEligible({ type: 'Thing', source: 'email', tags: ['邮件'] }), false, '一封对账单不需要镜头');
  assert.equal(isLensEligible({ type: 'Thing', source: 'import', tags: ['衣橱'] }), false, '衣柜里的物品');
  assert.equal(isLensEligible({ type: 'place', source: 'location' }), false, '位置');
  assert.equal(isLensEligible(null), false, '空节点不许抛');
  assert.equal(isLensEligible(undefined), false);
  assert.equal(isLensEligible({}), false, '什么都没有的不许瞎给');
}

/* ══ ② 详情页(非编辑态)只剩「看」这一类按钮 ══════════════════════════════ */
{
  const src = stripComments(read('components/portal/MemoryNodeDetail.tsx'));

  // 底部那一排的非编辑分支
  // 用 saveEdit 锚定 —— `{editing ? (` 在这个文件里不止一处,取第一个会切错块
  // (第一版正是这么写的,断言当场对着一段无关的 JSX 报「删除还在」)。
  const anchor = src.lastIndexOf('onClick={saveEdit}');
  assert.ok(anchor > 0, '找不到底部按钮排的锚点(saveEdit)');
  const bottom = src.slice(src.lastIndexOf('{editing ? (', anchor), src.indexOf('</NesioSheet>', anchor));
  assert.ok(bottom.length > 400, '找不到底部按钮排 —— 判据挂在这一段上,比错块就会假绿');
  const viewSide = bottom.slice(bottom.indexOf(') : ('));
  assert.ok(viewSide.length > 200, '找不到非编辑分支');

  assert.match(viewSide, /'阅读', 'Read'/, '详情页要有「阅读」');
  assert.match(viewSide, /'编辑', 'Edit'/, '详情页要有「编辑」');
  // 「删除」不许留在详情页 —— 它是不可逆的,和「看」不该在同一屏
  assert.doesNotMatch(viewSide, /'删除', 'Delete'/,
    '删除必须收进编辑态(用户点名)—— 它在这一排里是唯一不可逆的那个');
  // 「用镜头看看 ✦」改名成两个字
  assert.doesNotMatch(src, /用镜头看看/, '「用镜头看看 ✦」要改成「镜头」两个字');
  assert.match(viewSide, /'镜头', 'Lens'/, '镜头按钮的文案');
  assert.match(viewSide, /isLensEligible\(n\)/,
    '镜头要过 lens-eligible 那道判据 —— 不然对账单/日历事件上也会长出一个无话可说的按钮');

  // 缩小:这一排统一 size="sm"(用户「样子一样,缩小」)
  const sizes = [...bottom.matchAll(/<Button\b[^>]*?size="(\w+)"/g)].map((m) => m[1]);
  assert.ok(sizes.length >= 6, `底部按钮应有 6 个以上,实际 ${sizes.length}`);
  assert.deepEqual([...new Set(sizes)], ['sm'],
    `这一排的按钮尺寸不一致(${[...new Set(sizes)].join('/')})—— 用户要的是「样子一样,缩小」`);
}

/* ══ ③ 「改」这一类全在编辑态 ═════════════════════════════════════════════ */
{
  const src = stripComments(read('components/portal/MemoryNodeDetail.tsx'));

  // 加附件
  assert.match(src, /\{editing && \(\s*<div className="nesio-nd-photo-add">/,
    '加附件那块要收进编辑态 —— 用户点名「都放进点击编辑后的页面」');
  assert.match(src, /'＋ 添加附件', '＋ Add files'/,
    '「添加照片」要改叫「添加附件」—— 它本来就能收任意文件,叫「照片」是自己把自己讲窄了');
  // 分派给家人
  assert.match(src, /\{editing && \(n\.type === 'event' \|\| n\.type === 'task'\)/,
    '分派给家人要收进编辑态');
  // 加关联(只读的「相关记忆」列表仍留在详情页 —— 那是要看的信息)
  assert.match(src, /\{editing && !linkPicking && \(/, '「＋关联」按钮要收进编辑态');
  assert.match(src, /'相关记忆', 'Related memories'/,
    '只读的相关记忆列表要留在详情页 —— 「这条和什么有关」是要看的,不是要改的');

  // 顶部那一排整个撤掉(阅读原文 / 回复 都不再在标题下面)
  assert.doesNotMatch(src, /className="nesio-node-action-row"/,
    '顶部的「阅读原文/回复」一排要撤 —— 阅读上下各一份是这次整理的起点');
  assert.doesNotMatch(src, /'阅读原文', 'Read original'/, '「阅读原文」并进底部的「阅读」');
}

/* ══ ④ 附件入口不许设 accept 白名单 ═══════════════════════════════════════ */
{
  const src = read('components/portal/MemoryNodeDetail.tsx');
  const inputs = [...src.matchAll(/<input\b[\s\S]*?\/>/g)].map((m) => m[0]).filter((t) => /type="file"/.test(t));
  assert.ok(inputs.length >= 1, '详情页应当有附件 picker');
  for (const tag of inputs) {
    assert.doesNotMatch(tag, /\baccept=/,
      '附件入口不许设 accept —— 原来是 image/*,于是 PDF/docx 在 iOS 的文件选择器里' +
      '直接是灰的(这个坑仓里栽过两次,见 file-picker-ios)');
    assert.match(tag, /nesio-visually-hidden/, 'file input 必须参与布局,否则 iOS 上程序化 click 不响应');
  }
}

console.log('node-detail-actions: OK(镜头只给写下来的字 / 详情页只剩看 / 改的全在编辑态 / 附件不设白名单 / 一排同尺寸)');
