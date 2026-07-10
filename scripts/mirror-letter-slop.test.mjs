/**
 * 契约:多面镜月度信的口吻控制(2026-07-10,用户要求:
 * 「除了模型文笔,还需要我们的 prompt 控制,不能完全放开通用大模型」)。
 *
 * 守护意图:
 * 1. 路由必须有确定性出口过滤(SLOP_PATTERNS + isSlop)—— prompt 会失效,过滤器不会;
 *    套话段落是丢弃不是改写。
 * 2. 过滤器行为锁:典型大模型套话必杀,规格级好文案必留(误杀=把信杀哑)。
 * 3. prompt 必须带口吻红线与好坏对照;只回看不预测是硬约束。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(new URL('.', import.meta.url).pathname, '..');
const route = readFileSync(resolve(repoRoot, 'app/api/portal/mirror-letter/route.ts'), 'utf8');

// ── 1. 结构断言:过滤器在、接在出口上、prompt 带红线 ─────────────────────────
assert.match(route, /const SLOP_PATTERNS/, 'route must define the deterministic slop blacklist.');
assert.match(route, /function isSlop/, 'route must define isSlop.');
assert.match(route, /filter\(\(p\) => !isSlop\(p\.text\)\)/, 'slop filter must run on the output path (paragraphs dropped, not rewritten).');
assert.match(route, /口吻红线/, 'prompt must carry the tone red lines.');
assert.match(route, /好坏对照/, 'prompt must carry the good/bad contrast example.');
assert.match(route, /只回看,不预测/, 'letters must look back, never predict (product axiom #2).');
assert.match(route, /guardAiRoute\(req, 'mirror_letter'/, 'route must be guarded (auth + rate limit).');

// ── 2. 行为锁:从源码提取 SLOP_PATTERNS 跑好坏语料 ───────────────────────────
const block = route.slice(route.indexOf('const SLOP_PATTERNS'), route.indexOf('function isSlop'));
const patterns = [...block.matchAll(/^\s+(\/.+?\/i?),/gm)].map((m) => {
  const src = m[1];
  const lastSlash = src.lastIndexOf('/');
  return new RegExp(src.slice(1, lastSlash), src.slice(lastSlash + 1));
});
assert.ok(patterns.length >= 8, `expected >=8 slop patterns, got ${patterns.length}`);
const hit = (t) => patterns.some((re) => re.test(t));

const mustKill = [
  '作为你的老朋友,我注意到你这个月记录了很多搬家的内容,加油!',
  '亲爱的 J,见字如面。',
  '总之,这个月你辛苦了。',
  '希望这封信对你有帮助。',
  '你已经做得很好了,继续保持!',
  '这是你人生的旅程中重要的一站。',
  'As your old friend, I noticed you have been busy.',
  "You're doing great — keep it up!",
];
const mustKeep = [
  '四条都是搬家:看房、联系公司、约验房。事推得很快,可一句关于新家的期待都没有——你是真想搬,还是不得不搬?',
  '你记了 14 条要做的事,记做完之后感受的是 0 条。',
  '「学木工」在角落里躺了两个月,你再没碰过它。是不想要了,还是不敢要?',
  'Fourteen notes about tasks, zero about how finishing them felt.',
];

for (const t of mustKill) assert.ok(hit(t), `slop filter must kill: ${t}`);
for (const t of mustKeep) assert.ok(!hit(t), `slop filter must NOT kill (false positive): ${t}`);

console.log(`mirror-letter slop contract OK (${patterns.length} patterns, ${mustKill.length}+${mustKeep.length} cases)`);
