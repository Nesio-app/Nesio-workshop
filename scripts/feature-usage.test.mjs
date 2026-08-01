/**
 * 行为契约:回访再触达(feature-usage)。
 * 锁死:会话累计判「回访用户」· 用过的功能(显式标记 ∪ 图谱推断)不再提醒 ·
 * 稍后=冷却、不再提醒=永久黑名单 · 全局两天冷却 · readyWhen 门(洞察攒够才提)。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

function compile(rel) {
  const src = fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
  return ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
}

// 内存 localStorage + window
const store = {};
const localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};
const win = { dispatchEvent() {}, localStorage };
const mod = { exports: {} };
vm.runInNewContext(compile('../lib/portal/feature-usage.ts'), {
  module: mod, exports: mod.exports, console, JSON, Object, Array, String, Number, Math, Date, Set,
  window: win, localStorage,
  CustomEvent: class { constructor(t) { this.type = t; } },
  require: () => ({}),
});
const fu = mod.exports;

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 1, 9, 0, 0);

// ── 回访判定:三次会话(每次间隔 >30 分钟) ──
let s = fu.recordAppOpen(T0);
assert.equal(s.sessionCount, 1, '第一次打开 = 1 会话');
s = fu.recordAppOpen(T0 + 10 * 60_000); // 10 分钟后 → 同一会话
assert.equal(s.sessionCount, 1, '30 分钟内不算新会话');
s = fu.recordAppOpen(T0 + 2 * DAY);      // 隔天 → 新会话
s = fu.recordAppOpen(T0 + 4 * DAY);      // 又隔天 → 第三会话
assert.equal(s.sessionCount, 3, '三次跨会话');
assert.ok(fu.isReturningUser(s), '≥3 会话 = 回访用户');

// ── 挑一条:回访 + 无数据 → 应给心情(洞察 readyWhen 未满足被跳过) ──
const now = T0 + 4 * DAY;
let n = fu.pickReengagementNudge({ nodes: [], now, zh: true });
assert.ok(n && n.key === 'mood', '空库:洞察需攒够被跳过,落到心情');
assert.ok(n.openEvent === 'nesio-open-mood', '心情走 nesio-open-mood 事件');

// ── 图谱推断:有心情节点 → 心情算用过,跳到物品 ──
const moodNode = { type: 'Mind', tags: ['feeling'], createdAt: '2026-01-01' };
n = fu.pickReengagementNudge({ nodes: [moodNode], now, zh: true });
assert.ok(n && n.key === 'inventory', '有心情节点 → 心情跳过 → 物品');

// ── readyWhen:攒够 8 个节点 → 洞察优先(且未用过) ──
const many = Array.from({ length: 8 }, (_, i) => ({ type: 'note', tags: [], createdAt: '2026-01-01', id: `n${i}` }));
n = fu.pickReengagementNudge({ nodes: many, now, zh: true });
assert.ok(n && n.key === 'insights', '节点够 8 个 → 洞察优先');

// ── 显式标记用过 → 不再提醒该项 ──
fu.markFeatureUsed('insights', now);
n = fu.pickReengagementNudge({ nodes: many, now: now + 3 * DAY, zh: true }); // 跨过全局冷却
assert.ok(!n || n.key !== 'insights', '标记用过后洞察不再提');

// ── 全局冷却:markNudgeShown 后两天内不弹 ──
fu.markNudgeShown(now + 3 * DAY);
n = fu.pickReengagementNudge({ nodes: [], now: now + 3 * DAY + 60_000, zh: true });
assert.equal(n, null, '全局两天冷却内不打扰');

// ── 稍后(冷却)与 不再提醒(永久) ──
const later = now + 10 * DAY; // 越过全局冷却
fu.snoozeNudge('mood', later);
n = fu.pickReengagementNudge({ nodes: [], now: later + 60_000, zh: true });
assert.ok(!n || n.key !== 'mood', '稍后冷却内不提心情');
n = fu.pickReengagementNudge({ nodes: [], now: later + 5 * DAY, zh: true });
assert.ok(n && n.key === 'mood', '冷却过后心情回来');

fu.dismissNudgeForever('mood');
n = fu.pickReengagementNudge({ nodes: [], now: later + 20 * DAY, zh: true });
assert.ok(!n || n.key !== 'mood', '不再提醒 = 永久黑名单');

// ── 非回访用户:不打扰 ──
const fresh = { firstOpenAt: now, lastOpenAt: now, sessionCount: 1, activeDays: ['2026-01-01'] };
assert.equal(fu.pickReengagementNudge({ nodes: [], now, zh: true, session: fresh, usage: { used: {}, snoozedUntil: {}, never: [] } }), null, '新用户不触达');

console.log('feature-usage: OK');
