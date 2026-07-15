/**
 * 行为契约:关键路径静默失败可观测(批次212,可靠性🔴)。
 * 云同步(记忆/名字头像/学习态)+ 巡查的**外层 catch** 必须过 logDropped,不再哑吞——
 * 这正是 196-205 静默丢数据/吞云写失败的教训。本地读回退/JSON 解析兜底不在此列(合理忽略)。
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');

const cases = [
  ['../lib/portal/cloud-memory-sync.ts', ["logDropped('cloud.memory_sync'"]],
  ['../lib/portal/cloud-profile-sync.ts', ["logDropped('cloud.profile_push'", "logDropped('cloud.profile_sync'"]],
  ['../lib/portal/cloud-learning-sync.ts', ["logDropped('cloud.learning_pull'", "logDropped('cloud.learning_push'"]],
  ['../lib/portal/llm-sweep-auto.ts', ["logDropped('sweep.auto'", "logDropped('sweep.run_now'"]],
];

for (const [path, needles] of cases) {
  const src = read(path);
  assert.match(src, /import \{ logDropped \} from '\.\/storage-health'/, `${path} 引入 logDropped`);
  for (const n of needles) {
    assert.ok(src.includes(n), `${path} 含 ${n}(外层 catch 可观测)`);
  }
}

// logDropped 本体:grep 得到的一行 console.warn 前缀(运维可 grep [nesio:dropped])
const health = read('../lib/portal/storage-health.ts');
assert.match(health, /\[nesio:dropped\]/, 'logDropped 输出可 grep 的 [nesio:dropped] 前缀');

console.log('silent-failure-observability: OK');
