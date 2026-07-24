/**
 * 行为契约:自动调工作流 —— 活跃时段采集 + reengage 按就绪度选卡。
 * 锁死:topActiveHours 取活跃次数最高的时段;pickReengagementNudge 在合格候选里
 * 按 readiness(你的数据深度)排序选,而非静态目录序;已用/黑名单/未就绪被过滤。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

function load() {
  const src = fs.readFileSync(new URL('../lib/portal/feature-usage.ts', import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports, console, JSON, Array, Object, Set, Number, String, Boolean, Date, Math,
    require: () => ({}),
  });
  return mod.exports;
}

const M = load();
const NOW = 1_800_000_000_000;
const session = (over = {}) => ({ firstOpenAt: NOW - 9e8, lastOpenAt: NOW - 8e7, sessionCount: 3, activeDays: [], openHours: new Array(24).fill(0), ...over });
const usage = (over = {}) => ({ used: {}, snoozedUntil: {}, never: [], ...over });

// ── topActiveHours:取活跃最高的时段 ──
{
  const oh = new Array(24).fill(0); oh[9] = 5; oh[21] = 8; oh[13] = 2;
  const top = M.topActiveHours(2, oh);
  assert.equal(top.join(','), '21,9', '按次数取 top2:21 点最多、9 点次之');
  assert.equal(M.topActiveHours(4, new Array(24).fill(0)).length, 0, '无活跃数据 → 空(调用方回落既有 goodHours)');
}

// ── reengage:多条记忆 → 优先推洞察(readiness 最高) ──
{
  const nodes = Array.from({ length: 12 }, () => ({ type: 'note' }));
  const n = M.pickReengagementNudge({ nodes, now: NOW, zh: true, session: session(), usage: usage() });
  assert.equal(n?.key, 'insights', '攒够记忆 → 洞察就绪度最高,优先推');
}

// ── reengage:洞察已用 → 顺到下一个合格项 ──
{
  const nodes = Array.from({ length: 12 }, () => ({ type: 'note' }));
  const n = M.pickReengagementNudge({ nodes, now: NOW, zh: true, session: session(), usage: usage({ used: { insights: NOW } }) });
  assert.ok(n && n.key !== 'insights', '洞察已用被过滤,推别的');
}

// ── reengage:有物品 → 收纳被推断为「用过」而过滤,不会推收纳 ──
{
  const nodes = [...Array.from({ length: 6 }, () => ({ type: 'object' })), ...Array.from({ length: 6 }, () => ({ type: 'note' }))];
  const n = M.pickReengagementNudge({ nodes, now: NOW, zh: true, session: session(), usage: usage() });
  assert.notEqual(n?.key, 'inventory', '有物品节点 → 收纳算用过,不再推');
  assert.equal(n?.key, 'insights', '12 节点 → 洞察就绪度最高');
}

// ── 非回访用户 → 不打扰 ──
{
  const n = M.pickReengagementNudge({ nodes: [], now: NOW, zh: true, session: session({ sessionCount: 1, activeDays: [] }), usage: usage() });
  assert.equal(n, null, '新用户不弹再触达');
}

console.log('✓ reengage-behavior 契约通过');
