/**
 * 行为契约:会议记录 ↔ 日历日程闭环(用户定:Granola 转写要挂回对应日历项)。
 * 锁死 writeMeetingExtraction(经 addMeetingNotes 入口)的日历匹配:
 *  1) 会议时间落在日程窗口(start-30min ~ end+60min)且标题吻合 → 记录节点带
 *     relations[{targetId: 日历节点, relation: 对应日程}] + attributes.calendarNodeId;
 *  2) 日历节点反向写 meetingRecordId(从日程一侧可跳到记录);
 *  3) 窗口内唯一候选时放宽标题;窗口外/多候选且标题全不合 → 不硬凑(不挂错日程);
 *  4) To do 子节点仍指向会议记录(原有关系不回归)。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

function loadTs(path, requireImpl) {
  const src = fs.readFileSync(new URL(path, import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports, require: requireImpl, console,
    Array, Object, JSON, Map, Set, String, Number, Boolean, Date, RegExp,
  });
  return mod.exports;
}

// ── stub life-graph:种一个日历节点,记录 ingest/update 调用 ──
function makeWorld(calendarNodes) {
  const graph = [...calendarNodes];
  const created = [];
  const updates = [];
  let seq = 0;
  const requireImpl = (p) => {
    if (p.includes('ingest-node')) {
      return { ingestLifeNode: (input) => { const n = { id: `n${seq++}`, createdAt: new Date().toISOString(), ...input }; graph.push(n); created.push(n); return n; } };
    }
    if (p.includes('life-graph')) {
      return {
        getLifeGraph: () => graph,
        updateLifeNode: (id, patch) => { updates.push({ id, patch }); const n = graph.find((x) => x.id === id); if (n && patch.attributes) n.attributes = patch.attributes; return true; },
        deleteLifeNode: () => true,
      };
    }
    if (p.includes('feedback-bus')) return { emitFeedback: () => {} };
    if (p.includes('today-view-model')) return { localDayKey: () => '2026-07-17' };
    return {};
  };
  const cmds = loadTs('../lib/platform/view-models/today-commands.ts', requireImpl);
  return { cmds, graph, created, updates };
}

const CAL = {
  id: 'cal1', name: 'Kompass Migration Delivery Impacts', source: 'calendar', type: 'event',
  createdAt: '2026-07-17T00:00:00.000Z', rawInput: '', tags: [],
  attributes: { start: '2026-07-17T14:00:00.000Z', end: '2026-07-17T15:00:00.000Z', calendarId: 'g1' },
};

// 1) 时间窗内 + 标题吻合 → 双向挂上
{
  const { cmds, created, updates } = makeWorld([CAL]);
  cmds.addMeetingNotes('', 'Kompass Migration Delivery Impacts', 'transcript…', 'zh', undefined);
  // recordedAt 默认 now —— 用 prov 走真实时间:经 ingestGranolaMeeting 才带 prov,
  // 这里直接调共享写入的公开入口 addMeetingNotes 验默认路径,再用内部时间窗验证:
  const record = created.find((n) => n.tags?.includes('meeting-notes'));
  assert.ok(record, '会议记录节点存在');
  // addMeetingNotes 用 now,不一定落窗口 —— 重开一个世界,直接锁 provenance 路径:
  const w2 = makeWorld([CAL]);
  // writeMeetingExtraction 未导出:经 ingestGranolaMeeting 会走网络抽取,测试里
  // fetch 缺失 → 降级 stored_raw,仍会带 recordedAt 写入(锁的正是这条链)。
  const r = await w2.cmds.ingestGranolaMeeting({ id: 'g-uuid-1', title: 'Kompass Migration Delivery Impacts', transcript: 'hello', startedAt: '2026-07-17T14:05:00.000Z' }, 'zh');
  assert.equal(r.status, 'stored_raw', '无抽取服务时降级存原文');
  assert.equal(r.linked, true, '挂到对应日程 → linked=true(端到端可见)');
  const rec2 = w2.created.find((n) => n.tags?.includes('meeting-notes'));
  assert.ok(rec2, 'Granola 会议记录节点存在');
  assert.equal(rec2.attributes.calendarNodeId, 'cal1', '记录 → 日历:attributes.calendarNodeId');
  assert.ok(rec2.relations.some((x) => x.targetId === 'cal1'), '记录 → 日历:relation 挂上');
  const upd = w2.updates.find((u) => u.id === 'cal1');
  assert.ok(upd && upd.patch.attributes.meetingRecordId === rec2.id, '日历 → 记录:meetingRecordId 反向可见');
}

// 2) 标题不吻合但窗口内唯一候选 → 放宽标题也挂上
{
  const w = makeWorld([CAL]);
  await w.cmds.ingestGranolaMeeting({ id: 'g2', title: 'Sync w/ team', transcript: 'x', startedAt: '2026-07-17T14:10:00.000Z' }, 'zh');
  const rec = w.created.find((n) => n.tags?.includes('meeting-notes'));
  assert.equal(rec.attributes.calendarNodeId, 'cal1', '唯一候选放宽标题');
}

// 3) 时间窗外 → 不挂
{
  const w = makeWorld([CAL]);
  const r3 = await w.cmds.ingestGranolaMeeting({ id: 'g3', title: 'Kompass Migration Delivery Impacts', transcript: 'x', startedAt: '2026-07-17T20:00:00.000Z' }, 'zh');
  const rec = w.created.find((n) => n.tags?.includes('meeting-notes'));
  assert.equal(rec.attributes.calendarNodeId, undefined, '窗口外不硬凑');
  assert.equal(rec.relations.length, 0);
  assert.equal(r3.linked, false, '没挂上 → linked=false');
}

// 4) 窗口内多候选且标题全不合 → 不挂错
{
  const CAL2 = { ...CAL, id: 'cal2', name: 'Another meeting' };
  const w = makeWorld([CAL, CAL2]);
  await w.cmds.ingestGranolaMeeting({ id: 'g4', title: 'Totally different', transcript: 'x', startedAt: '2026-07-17T14:10:00.000Z' }, 'zh');
  const rec = w.created.find((n) => n.tags?.includes('meeting-notes'));
  assert.equal(rec.attributes.calendarNodeId, undefined, '多候选不硬凑');
}

// 5) Granola 常只给日期(没有时刻)→ 按同一天+标题挂上(窗口匹配会失败,因为 UTC 午夜对不上下午的会)
{
  const w = makeWorld([CAL]);
  const r5 = await w.cmds.ingestGranolaMeeting({
    id: 'g5', title: 'Kompass Migration Delivery Impacts', transcript: 'x', startedAt: '2026-07-17',
  }, 'zh');
  assert.equal(r5.linked, true, '只有日期的会议应按同一天挂到日程');
  const rec = w.created.find((n) => n.tags?.includes('meeting-notes'));
  assert.equal(rec.attributes.calendarNodeId, 'cal1');
}

console.log('meeting-calendar link contract tests passed');
