/**
 * 浮层开着时不得整页 reload 把用户踢回今天;联网面板须有会话缓存。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const busy = read('lib/portal/app-busy.ts');
assert.match(busy, /holdUiOverlay/, '必须有浮层 hold');
assert.match(busy, /requestDestructiveReload/, '整页刷新必须可推迟');
assert.match(busy, /shouldDeferDestructiveReload/, '忙/浮层时延后刷新');

const portal = read('components/portal/Portal.tsx');
assert.match(portal, /holdUiOverlay/, 'Portal 浮层开着要 hold');
assert.match(portal, /requestDestructiveReload/, '版本检查走可推迟刷新');
assert.match(portal, /insightsMounted/, '洞察首次打开后保持挂载');
assert.match(portal, /familyMounted/, '家务首次打开后保持挂载');

const moduleSync = read('lib/portal/cloud-module-sync.ts');
assert.match(moduleSync, /requestDestructiveReload/, '模块水合 reload 必须可推迟');

const insights = read('components/portal/InsightsSheet.tsx');
assert.match(insights, /keptTabs/, '洞察板块 keep-alive');
assert.match(insights, /keepTab\('tesla'/, '资产/车 keep-alive');
assert.match(insights, /keepTab\('admin'/, '运营 keep-alive');

const tesla = read('components/portal/TeslaPanel.tsx');
assert.match(tesla, /PANEL_CACHE_KEYS\.tesla|session-panel-cache/, 'Tesla 会话缓存');
assert.match(tesla, /silent:\s*hasCache|silent:\s*true|opts\.silent/, '有缓存时静默刷新');

const family = read('components/portal/family/FamilySharingSheet.tsx');
assert.match(family, /PANEL_CACHE_KEYS\.family|session-panel-cache/, '家务会话缓存');
assert.match(family, /silent:\s*has/, '有缓存时静默刷新');

const admin = read('components/portal/insights/AdminOpsPanel.tsx');
assert.match(admin, /PANEL_CACHE_KEYS\.adminMetrics|session-panel-cache/, '运营会话缓存');

const cache = read('lib/portal/session-panel-cache.ts');
assert.match(cache, /export function readPanelCache/, '面板缓存模块');

console.log('ui-overlay-reload-defer: OK');
