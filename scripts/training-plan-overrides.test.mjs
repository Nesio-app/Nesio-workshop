/**
 * 行为契约:凡是要「拿训练内容去练」的地方,必须读**用户改写后**的计划,不能直接吃种子。
 *
 * 背景 —— 图8 把训练计划做成可编辑(种子 PROTOCOL_LIBRARY 只读 + 本机 override 叠加层)。
 * 但当时只有健身页接了叠加层,今天页的「开始练」还是 protocolById 拿种子直接丢进跟练播放器:
 * 用户改过的组数/次数不生效、删掉的动作照样练 —— 编辑功能等于只改了个显示。
 *
 * 这条锁的就是那个缺口:任何**既读种子计划、又启动跟练**的文件,都必须经过
 * activeProtocol / mergeProtocol 这道门。
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = new URL('..', import.meta.url).pathname;
const walk = (dir) => fs.readdirSync(path.join(root, dir), { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]));

const files = walk('components').filter((f) => f.endsWith('.tsx'));
const offenders = [];
for (const f of files) {
  const src = fs.readFileSync(path.join(root, f), 'utf8');
  const readsSeed = /\bprotocolById\s*\(/.test(src) || /\bPROTOCOL_LIBRARY\b/.test(src);
  const startsWorkout = /nesio-start-workout/.test(src);
  if (!readsSeed || !startsWorkout) continue;
  if (/\bactiveProtocol\s*\(|\bmergeProtocol\s*\(/.test(src)) continue;
  offenders.push(f);
}

assert.deepEqual(offenders, [], [
  '',
  '这些文件拿种子计划直接开练,没过用户改写层:',
  ...offenders.map((f) => `  · ${f}`),
  '',
  '修法:seed → activeProtocol(seed)(一次性读取)或 mergeProtocol(seed, ov)(需要响应式重渲染时)。',
].join('\n'));

// 门本身还在:activeProtocol 必须真的把 override 叠上去
const mod = fs.readFileSync(path.join(root, 'lib/platform/training-overrides.ts'), 'utf8');
assert.match(mod, /export function activeProtocol/, 'activeProtocol 这道门不能删');
assert.match(mod, /activeProtocol[\s\S]{0,200}mergeProtocol\(seed, loadOverrides\(\)\)/,
  'activeProtocol 必须 = 种子 + loadOverrides(),否则这道门是空的');

console.log(`training-plan-overrides: OK(扫了 ${files.length} 个组件)`);
