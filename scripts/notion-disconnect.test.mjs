/**
 * 行为契约:Notion 断连撤销(S2 收尾,批次213)。
 * - integrationCookieNames(provider) 用规范 COOKIE_PREFIX 映射(notion→nesio_notion_access/refresh)。
 * - integrations DELETE 路由用它清 cookie(不再硬编码 gmail/calendar → notion/tesla/granola 误删日历 cookie)。
 * - ConnectorsHub disconnect('notion') 调 DELETE?provider=notion + 清本机选中的 DB。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');

// ── 纯逻辑:integrationCookieNames ──
const src = read('../lib/portal/integrations.ts');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const mod = { exports: {} };
vm.runInNewContext(js, { module: mod, exports: mod.exports, require: () => ({}), console, Date, JSON, Object, String, Boolean, Array });
const { integrationCookieNames } = mod.exports;

assert.deepEqual(
  [...integrationCookieNames('notion')],
  ['nesio_notion_access', 'nesio_notion_refresh'],
  'notion → nesio_notion_* cookie 名',
);
assert.deepEqual([...integrationCookieNames('gmail')], ['nesio_gmail_access', 'nesio_gmail_refresh'], 'gmail 不回归');
assert.deepEqual([...integrationCookieNames('tesla')], ['nesio_tesla_access', 'nesio_tesla_refresh'], 'tesla 也覆盖');

// ── DELETE 路由用规范映射 ──
const route = read('../app/api/portal/integrations/route.ts');
assert.match(route, /integrationCookieNames\(provider\)/, 'DELETE 用 integrationCookieNames(provider) 清 cookie');
assert.ok(!/provider === 'gmail' \? 'nesio_gmail' : 'nesio_google_calendar'/.test(route), '旧硬编码 gmail/calendar 三元已移除');

// ── ConnectorsHub 有 notion 断连分支 ──
const hub = read('../components/portal/ConnectorsHub.tsx');
assert.match(hub, /if \(id === 'notion'\)/, 'disconnect 有 notion 分支');
assert.match(hub, /\/api\/portal\/integrations\?provider=notion['"],\s*\{\s*method:\s*'DELETE'/, 'notion 断连调 DELETE?provider=notion');
assert.match(hub, /removeItem\(NOTION_DB_KEY\)/, 'notion 断连清本机选中的 DB');

console.log('notion-disconnect: OK');
