/**
 * 行为契约:镜头页「念念还记得」的回声判据(Bug4 图6「内容逻辑正确吗?」)。
 *
 * 它原来对 tag 一视同仁地取交集 —— 任意两条邮件都共享「邮件」,于是
 * 「你 X/Y 也记过类似的一次」对几乎任何一条记忆都会出现,而两条毫无关系。
 * 和「健身邮件被认成健康打卡」是同一族的错:拿一个不表达语义的标记当语义。
 *
 * 钉死四件事,不钉函数长相:
 *   ① 只认主题标签 —— 来源/采集方式/内部前缀共享不算「记过类似的一次」;
 *   ② 只看更早的(晚于自己的不算,自己不算自己);
 *   ③ 说得出凭哪个标签像 —— 说不出就没法被用户检验;
 *   ④ 只有 ≥2 条更早的同标签记忆才敢叫「模式」。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

function loadTs(rel, extra = {}) {
  const src = fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports, console, require: () => ({}),
    Date, Math, Number, Array, Object, String, Set, Map, JSON, isNaN, RegExp, ...extra,
  });
  return mod.exports;
}

const { lensEcho } = loadTs('../lib/portal/lens.ts');
const { isTopicTag } = loadTs('../lib/portal/topic-tags.ts');

const n = (id, day, tags) => ({ id, createdAt: `2026-07-${String(day).padStart(2, '0')}T10:00:00Z`, tags });

// ── ① 来源 / 采集方式 / 内部前缀:共享它们不算「记过类似的一次」 ──
for (const junk of ['邮件', 'flomo', '日历', 'gmail', '手动记录', 'Voice', '主题', 'domain:health', 'facet:mood']) {
  const self = n('a', 20, [junk]);
  const older = n('b', 10, [junk]);
  assert.equal(
    lensEcho(self, [self, older], isTopicTag), null,
    `共享「${junk}」不是主题相同 —— 这句回声会对几乎每条记忆都出现,等于没说`,
  );
}

// ── ② 真主题标签才算,而且必须是**更早**的那条 ──
{
  const self = n('a', 20, ['水电']);
  const older = n('b', 10, ['水电']);
  const newer = n('c', 25, ['水电']);
  const hit = lensEcho(self, [self, older, newer], isTopicTag);
  assert.ok(hit, '共享真主题标签应该有回声');
  assert.equal(hit.tag, '水电', '必须说得出是凭哪个标签像 —— 说不出就没法被检验');
  assert.equal(hit.at, older.createdAt, '回声只看更早的那条;晚于自己的不是「还记得」');
  assert.equal(hit.count, 1, '更早的只有一条');

  // 自己不能是自己的回声
  assert.equal(lensEcho(self, [self], isTopicTag), null, '图里只有自己时不该有回声');
}

// ── ③ 一条 ≠ 模式:n=1 不许说「模式」,≥2 才许 ──
{
  const self = n('a', 20, ['水电']);
  const one = lensEcho(self, [self, n('b', 10, ['水电'])], isTopicTag);
  assert.equal(one.many, false, '只有一条更早的,不能说成「模式」');

  const two = lensEcho(self, [self, n('b', 10, ['水电']), n('c', 5, ['水电'])], isTopicTag);
  assert.equal(two.many, true, '≥2 条更早的同标签记忆才算模式');
  assert.equal(two.count, 2);
  assert.equal(two.at, n('b', 10, ['水电']).createdAt, '标出的日期取最近的那条');
}

// ── ④ 混着来:主题标签命中、垃圾标签不命中 ──
{
  const self = n('a', 20, ['邮件', '水电', 'domain:home']);
  // 只共享「邮件」的那条不算;共享「水电」的才算
  const mailOnly = n('b', 18, ['邮件']);
  const real = n('c', 12, ['邮件', '水电']);
  const hit = lensEcho(self, [self, mailOnly, real], isTopicTag);
  assert.ok(hit, '有真主题共享就该有回声');
  assert.equal(hit.at, real.createdAt, '只共享来源标记的那条必须被排除,哪怕它更近');
  assert.equal(hit.count, 1, '只共享来源标记的不计入条数');
  assert.equal(hit.tag, '水电');
}

// ── ⑤ 没有任何主题标签 / 时间坏掉:安静返回 null,不猜 ──
{
  assert.equal(lensEcho(n('a', 20, []), [n('b', 10, [])], isTopicTag), null, '没有主题标签就不说话');
  assert.equal(lensEcho(n('a', 20, undefined), [n('b', 10, ['水电'])], isTopicTag), null, '没有 tags 字段也不能崩');
  const bad = { id: 'a', createdAt: 'not-a-date', tags: ['水电'] };
  assert.equal(lensEcho(bad, [n('b', 10, ['水电'])], isTopicTag), null, '时间坏掉时不猜');
}

console.log('lens-echo: OK(只认主题标签 / 只看更早 / 说得出凭哪个标签 / 一条不算模式)');
