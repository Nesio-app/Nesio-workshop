/**
 * 行为契约:镜头看记忆(artifact d7bd8990)。锁死纯规则层(不碰 AI/fetch):
 *  1) 镜头库含帮你吵/CBT/五问/事前验尸/逻辑谬误 + 投资类灰锁;
 *  2) lensesForMemory:自责/情绪重 → 推荐帮你吵+CBT;中性 → 无推荐;locked 永在 locked;
 *  3) shouldNudge:情绪重+自责才主动提示。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

function loadTs(path) {
  const src = fs.readFileSync(new URL(path, import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, require: () => ({}), console, Array, Object, JSON, Map, Set, String, Number, Boolean, Date, RegExp, Math });
  return mod.exports;
}
const X = loadTs('../lib/portal/lens.ts');

// 1) 镜头库
{
  const ids = X.MEMORY_LENSES.map((l) => l.id);
  for (const need of ['argue', 'cbt', 'five-whys', 'premortem', 'fallacy', 'capability']) assert.ok(ids.includes(need), `含镜头 ${need}`);
  assert.ok(X.lensById('capability').locked === true, '投资类灰锁');
  assert.ok(X.lensById('cbt') && !X.lensById('nope'), 'lensById 命中/未命中');
}

// 2) lensesForMemory 排序
{
  const blame = X.lensesForMemory('这次汇报又搞砸了,我真是太失败了,都怪我');
  assert.ok(blame.recommended.some((l) => l.id === 'argue') && blame.recommended.some((l) => l.id === 'cbt'), '自责 → 推荐帮你吵+CBT');
  assert.ok(blame.rest.some((l) => l.id === 'five-whys'), '五问在全部里');
  assert.ok(blame.locked.some((l) => l.id === 'capability'), '投资类恒在 locked');
  const neutral = X.lensesForMemory('明天下午三点开会,讨论排期');
  assert.equal(neutral.recommended.length, 0, '中性记忆无推荐');
}

// 3) shouldNudge
{
  assert.ok(X.shouldNudge('周会被当众批,脑子嗡一下,回工位坐了很久,是我没领导好团队'), '情绪重+自责 → 主动提示');
  assert.ok(!X.shouldNudge('今天买了牛奶和面包,顺便取了快递'), '中性记忆不提示');
}

console.log('lens contract tests passed');
