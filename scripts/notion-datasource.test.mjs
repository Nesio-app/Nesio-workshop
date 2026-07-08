/**
 * 行为契约:N-1 Notion 迁 2025-09-03 data source 模型。
 * 锁死:版本统一 2025-09-03、查询走 /v1/data_sources/{id}/query、有 discovery 展开 data_sources[]、
 * data source 404 回落 /v1/databases/{id}/query;两个 route 都经共享客户端(不再各自硬编码老版本)。
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';

const api = fs.readFileSync(new URL('../lib/portal/notion-api.ts', import.meta.url), 'utf8');
const dbRoute = fs.readFileSync(new URL('../app/api/portal/notion/databases/route.ts', import.meta.url), 'utf8');
const notionRoute = fs.readFileSync(new URL('../app/api/portal/notion/route.ts', import.meta.url), 'utf8');

// ── 共享客户端:版本 + 端点 + discovery + 兜底 ──
assert.ok(/NOTION_VERSION\s*=\s*['"]2025-09-03['"]/.test(api), '版本升到 2025-09-03');
assert.ok(/data_sources\/\$\{sourceId\}\/query/.test(api), '查询走 /v1/data_sources/{id}/query');
assert.ok(/databases\/\$\{sourceId\}\/query/.test(api), '404 回落 /v1/databases/{id}/query(老库兜底)');
assert.ok(/dsRes\.status === 404/.test(api), '仅在 data source 404 时回落老端点');
assert.ok(/export\s+(async\s+)?function\s+discoverDatabases/.test(api), '有 discovery(discoverDatabases)');
assert.ok(/data_sources/.test(api) && /db\.data_sources/.test(api), 'discovery 展开库的 data_sources[]');
assert.ok(/export function primaryDataSourceId/.test(api), '有主数据源解析 primaryDataSourceId');
assert.ok(/dataSources\[0\]\?\.id \|\| db\.databaseId/.test(api), '单源取唯一、老库回落 databaseId');

// ── 老硬编码版本清除:共享客户端是唯一版本源 ──
assert.ok(!/2022-06-28/.test(api), '共享客户端不残留老版本号');
assert.ok(!/2022-06-28/.test(dbRoute), 'databases route 不再硬编码老版本');
assert.ok(!/2022-06-28/.test(notionRoute), 'notion route 不再硬编码老版本');

// ── 两个 route 都经共享客户端 ──
assert.ok(/from ['"]@\/lib\/portal\/notion-api['"]/.test(dbRoute), 'databases route 引共享客户端');
assert.ok(/discoverDatabases/.test(dbRoute) && /primaryDataSourceId/.test(dbRoute), 'databases route 用 discovery + 主数据源');
assert.ok(/id:\s*primaryDataSourceId\(db\)/.test(dbRoute), 'databases route 返回的 id 是主数据源 id(查询用它)');
assert.ok(/from ['"]@\/lib\/portal\/notion-api['"]/.test(notionRoute), 'notion route 引共享客户端');
assert.ok(/queryDataSourceRows/.test(notionRoute), 'notion route 查询走 data source');
assert.ok(/getSourceTitle/.test(notionRoute), 'notion route 用 getSourceTitle 取标题');

console.log('notion-datasource: OK');
