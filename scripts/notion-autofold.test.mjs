/**
 * 行为契约:Notion「同步」默认走 发现→折叠(N-6,修用户实测「日期垃圾卡 + 选表没反应」)。
 *
 * 两个真凶:
 *  ① loadSource 从不填 titleSamples → looksCalendarDim 只能看表名,日期行标题的表漏判成 log,
 *     每行倒成日期卡。锁死:loadSource 必须采样行标题填 titleSamples。
 *  ② 折叠只在用户成功「选表」时才走;没选表(或选表按钮不响应)就退回盲搜页面倒垃圾。
 *     锁死:没显式 databaseIds 时,路由自动 discoverDatabases 全量折叠;只有一个库都没有才回落页面搜。
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';

const route = fs.readFileSync(new URL('../app/api/portal/notion/route.ts', import.meta.url), 'utf8');
const hub = fs.readFileSync(new URL('../components/portal/ConnectorsHub.tsx', import.meta.url), 'utf8');

// ── ① titleSamples 复活日历维度检测 ──
assert.ok(/titleSamples/.test(route), 'loadSource 填 titleSamples(否则日历维度表漏判)');
assert.ok(/rows\.slice\(0,\s*12\)\.map\(rowTitle\)/.test(route), '从行采样标题作 titleSamples');
assert.ok(/function rowTitle/.test(route), '有抽行标题的 helper');

// ── ② 默认自动发现 + 折叠,不再依赖选表 ──
assert.ok(/discoverDatabases,\s*primaryDataSourceId/.test(route), '路由引入 discovery');
assert.ok(/const explicitIds = Array\.isArray\(body\.databaseIds\)/.test(route), '区分显式选表 vs 自动发现');
assert.ok(/if \(!sourceIds\.length\)[\s\S]{0,160}discoverDatabases\(token\)/.test(route), '没选表 → 自动 discovery');
assert.ok(/foldSourcesToMemories\(schemas, rowsBySource\)/.test(route), '走结构折叠');
assert.ok(/explicitIds\.length \|\| memories\.length/.test(route), '显式选表即使0也返回;自动发现0才回落页面搜');
assert.ok(/folded: true/.test(route), '折叠响应带 folded 标志');

// ── ③ 前端按 folded 标志判断,不再靠「是否选了表」──
assert.ok(/c\.id === 'notion' && data\.folded/.test(hub), '前端按 data.folded 显示折叠结果');
assert.ok(/这些库都是日历\/维度表,已跳过/.test(hub), '折叠为空给准话(全是日历/维度表)');

console.log('notion-autofold: OK');
