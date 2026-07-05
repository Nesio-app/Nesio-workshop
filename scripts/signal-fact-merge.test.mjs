/**
 * 行为契约:Signal 事实库启动合并 —— IDB 是权威源(直接执行 mergeFactStore)。
 *
 * 修复的隐患:旧逻辑同 id 时投影胜出、且 hydrate 把投影写回 IDB,导致未来
 * 跨设备/云端拉取写进 IDB 的编辑,被下次 hydrate 的陈旧 localStorage 冲掉并持久化。
 */
import assert from 'node:assert/strict';
import { mergeFactStore } from '../lib/life-domain/signal-fact-merge.mjs';

// ── 跨设备回归:IDB 有更新的 X_v3,投影有陈旧的 X_v2 ─────────────────────────
{
  const idb = [{ id: 'x', title: 'X_v3_from_cloud' }];
  const projection = [{ id: 'x', title: 'X_v2_stale_local' }];
  const { merged, backfill } = mergeFactStore(idb, projection);

  const x = merged.find((s) => s.id === 'x');
  assert.equal(x.title, 'X_v3_from_cloud', '同 id 时 IDB 版本必须胜出,不能被陈旧投影覆盖。');
  assert.equal(backfill.length, 0, 'IDB 已有该 id → 不回写,避免持久化覆盖(数据完整性)。');
}

// ── 投影独有的 id → 回填(事实库独立 / 首次迁移)────────────────────────────
{
  const idb = [{ id: 'a', title: 'A' }];
  const projection = [{ id: 'a', title: 'A_local' }, { id: 'b', title: 'B_only_local' }];
  const { merged, backfill } = mergeFactStore(idb, projection);

  assert.deepEqual(merged.map((s) => s.id).sort(), ['a', 'b'], '合并含双方全部 id。');
  assert.equal(merged.find((s) => s.id === 'a').title, 'A', 'a 冲突 → 保留 IDB 版本。');
  assert.deepEqual(backfill.map((s) => s.id), ['b'], '只有投影独有的 b 需要回填写入 IDB。');
}

// ── IDB 独有的 id → 保留、不进 backfill(事实库可保留投影之外的事实)─────────
{
  const idb = [{ id: 'onlyIdb', title: 'kept' }];
  const projection = [];
  const { merged, backfill } = mergeFactStore(idb, projection);
  assert.deepEqual(merged.map((s) => s.id), ['onlyIdb'], 'IDB 独有的信号保留。');
  assert.equal(backfill.length, 0, 'IDB 独有的不需要回填。');
}

// ── 空投影不清空 IDB;空 IDB 时投影全回填 ──────────────────────────────────
{
  assert.equal(mergeFactStore([{ id: 'a' }, { id: 'b' }], []).merged.length, 2, '空投影不删 IDB。');
  const fresh = mergeFactStore([], [{ id: 'a' }, { id: 'b' }]);
  assert.equal(fresh.merged.length, 2, '空 IDB → 投影全进 merged。');
  assert.equal(fresh.backfill.length, 2, '空 IDB → 投影全部回填写入。');
}

console.log('signal-fact-merge: OK');
