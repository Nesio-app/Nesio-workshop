/**
 * 行为契约:每日日报持久化 + 自动预生成(块2)。
 * 纯决策 shouldAutoPersistDailyReport(开关/空/当天已生成)可直测;
 * 源码级钉住全局约束:走 ingestLifeNode(合法写入门)+ externalId 幂等 + kind 标识 +
 * 私据门注释(取材私据,调用方 canUsePrivateData 把关)+ listDailyReports 最近在前。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

const persistSrc = fs.readFileSync(new URL('../lib/portal/daily-report-persist.ts', import.meta.url), 'utf8');

// ── 源码级:全局性约束 ──
assert.ok(/from '@\/lib\/life-domain\/ingest-node'/.test(persistSrc), '存记忆走合法写入门 ingestLifeNode');
assert.ok(/ingestLifeNode\(/.test(persistSrc), '调用 ingestLifeNode');
assert.ok(/externalId: dailyReportExternalId\(/.test(persistSrc), 'externalId 幂等键');
assert.ok(/kind: 'daily-report'/.test(persistSrc), 'kind 标识 daily-report(供历史筛选)');
assert.ok(/canUsePrivateData/.test(persistSrc), '注明私据门由调用方把关');
assert.ok(/if \(report\.empty\) return 'skipped'/.test(persistSrc), '空日报不存');

// ── 纯决策 + listDailyReports 直测(抽出、无 ingest 依赖)──
const js = ts.transpileModule(persistSrc, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
// 只抽两个纯函数体,避开 ingestLifeNode 的顶层 require。
function grab(name) {
  const re = new RegExp(`function ${name}\\b[\\s\\S]*?\\n\\}`, 'm');
  const m = js.match(re);
  assert.ok(m, `抽到 ${name}`);
  return m[0];
}
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext([grab('shouldAutoPersistDailyReport'), grab('listDailyReports'),
  'globalThis.__x = { shouldAutoPersistDailyReport, listDailyReports };'].join('\n'), sandbox);
const { shouldAutoPersistDailyReport, listDailyReports } = sandbox.__x;

const rep = (date, empty = false) => ({ date, empty, title: `每日日报 · ${date}`, headline: 'h', markdown: '#', greeting: '', sections: [] });

assert.equal(shouldAutoPersistDailyReport({ enabled: true, lastAutoDate: null, report: rep('2026-07-09') }), true, '开着+没生成过+非空 → 生成');
assert.equal(shouldAutoPersistDailyReport({ enabled: false, lastAutoDate: null, report: rep('2026-07-09') }), false, '开关关 → 不生成');
assert.equal(shouldAutoPersistDailyReport({ enabled: true, lastAutoDate: '2026-07-09', report: rep('2026-07-09') }), false, '今天已生成 → 跳过(幂等)');
assert.equal(shouldAutoPersistDailyReport({ enabled: true, lastAutoDate: '2026-07-08', report: rep('2026-07-09') }), true, '昨天生成过,今天该生成');
assert.equal(shouldAutoPersistDailyReport({ enabled: true, lastAutoDate: null, report: rep('2026-07-09', true) }), false, '空日报 → 不生成');

// listDailyReports:筛 kind + 最近在前
{
  const nodes = [
    { name: 'a', rawInput: '#a', attributes: { kind: 'daily-report', date: '2026-07-07', headline: 'ha' } },
    { name: 'b', rawInput: '#b', attributes: { kind: 'daily-report', date: '2026-07-09', headline: 'hb' } },
    { name: 'x', rawInput: '#x', attributes: { kind: 'finance-monthly-report', ym: '2026-06' } }, // 非日报,排除
  ];
  const list = listDailyReports(nodes);
  assert.equal(list.length, 2, '只含 daily-report');
  assert.equal(list[0].date, '2026-07-09', '最近在前');
  assert.equal(list[1].date, '2026-07-07', '较早在后');
}

console.log('daily-report-persist: OK');
