/**
 * 行为契约:N-5 AI 辅助结构映射路由 + 放开逐行同步。
 * 锁死:notion/classify 路由 guardAiRoute + 进 docs/api-routes.md + AI 不可用/失败回落纯启发式;
 * ConnectorsHub 撤销 N-0 的逐行倒暂停(恢复走 N-3 折叠同步)。
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';

const route = fs.readFileSync(new URL('../app/api/portal/notion/classify/route.ts', import.meta.url), 'utf8');
const docs = fs.readFileSync(new URL('../docs/api-routes.md', import.meta.url), 'utf8');
const hub = fs.readFileSync(new URL('../components/portal/ConnectorsHub.tsx', import.meta.url), 'utf8');

// ── AI 路由:红线(guardAiRoute + docs)──
assert.ok(/guardAiRoute\(req,\s*['"]notion-classify['"]/.test(route), 'classify 路由必须 guardAiRoute');
assert.ok(/POST \/api\/portal\/notion\/classify\s*\|\s*guard/.test(docs), 'classify 路由必须进 docs/api-routes.md');

// ── AI 辅助 + 启发式回落(拿不到 AI 不降级)──
assert.ok(/classifyDatabase/.test(route), '回落用纯启发式 classifyDatabase');
assert.ok(/aiProviderAvailable\(\)/.test(route) && /source:\s*['"]heuristic['"]/.test(route), 'AI 不可用 → 回落启发式');
assert.ok(/completeText/.test(route), '有 AI 时用 completeText 猜角色');
assert.ok(/catch/.test(route) && (route.match(/source:\s*['"]heuristic['"]/g) || []).length >= 2, '解析/网络失败也回落启发式(≥2 处 heuristic 出口)');
assert.ok(/ROLES\.includes/.test(route), 'AI 返回的角色需在合法集合内才采用(否则逐表回落)');

// ── ConnectorsHub:撤销 N-0 暂停,恢复折叠同步 ──
assert.ok(!/已暂停/.test(hub) && !/正在升级重建/.test(hub), 'N-0 的逐行倒暂停文案已移除');
assert.ok(/databaseIds:\s*notionDbs/.test(hub), '选定数据源时把 databaseIds 发给 notion 路由(走 N-3 折叠)');
assert.ok(/已按结构折叠成/.test(hub), '同步成功提示反映「按结构折叠」');

console.log('notion-classify-route: OK');
