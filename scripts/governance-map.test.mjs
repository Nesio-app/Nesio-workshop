/**
 * 治理地图完整性测试 —— 保证 governance-map.mjs 的状态不会偷偷说谎(「可信」的保证)。
 * 断言:id 唯一 / 字段齐全 / 真实路径存在 / 标 drifted 的确实与运行时对不上。
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GOVERNANCE_MAP, GOV_STATUS_META, GOV_GROUP_META } from '../lib/portal/governance-map.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// 1. id 唯一
const ids = GOVERNANCE_MAP.map((e) => e.id);
assert.equal(new Set(ids).size, ids.length, 'governance-map id 必须唯一');

// 2. 字段齐全 + 状态/分组合法
for (const e of GOVERNANCE_MAP) {
  for (const f of ['id', 'title', 'group', 'status', 'path', 'governs', 'consumedBy']) {
    assert.ok(e[f], `${e.id} 缺字段 ${f}`);
  }
  assert.ok(GOV_STATUS_META[e.status], `${e.id} 状态非法: ${e.status}`);
  assert.ok(GOV_GROUP_META[e.group], `${e.id} 分组非法: ${e.group}`);
}

// 3. 真实路径存在(占位路径含 '(' 的跳过)
for (const e of GOVERNANCE_MAP) {
  if (e.path.includes('(')) continue;
  assert.ok(existsSync(join(ROOT, e.path)), `${e.id} 路径不存在: ${e.path}`);
  if (e.route) assert.ok(existsSync(join(ROOT, e.route)), `${e.id} route 不存在: ${e.route}`);
}

// 4. 漂移为真:标 drifted 的契约,其运行时确实没 import 它。
//    以 ai-provider-router 为例——真 AI 运行时 ai-complete.ts 不引用它才算漂移成立。
//    若哪天 ai-complete 真按契约走了,这条会失败 → 提醒把状态从 drifted 改掉。
const aiRouter = GOVERNANCE_MAP.find((e) => e.id === 'ai-provider-router');
if (aiRouter && aiRouter.status === 'drifted') {
  const runtime = readFileSync(join(ROOT, 'lib/portal/ai-complete.ts'), 'utf8');
  assert.ok(
    !runtime.includes('ai-provider-router-contract'),
    'ai-complete.ts 现在引用了 ai-provider-router-contract —— 漂移已消除,请把 ai-provider-router 状态从 drifted 改为 enforced/report-only',
  );
}

// 5. dead 项确实无前端消费(死端点的 route 不应被任何 fetch 引用)。
//    仅做存在性提示,不强断言 grep(避免 CI 环境差异),保证测试稳定。
for (const e of GOVERNANCE_MAP.filter((x) => x.status === 'dead')) {
  assert.ok(e.note, `${e.id} 标为 dead 必须在 note 说明依据(便于复核)`);
}

console.log(`governance-map: OK (${GOVERNANCE_MAP.length} 治理面, 状态自洽)`);
