/**
 * memory-event-at 契约:空格分隔时间可解析;回填把同步日纠正为源创建/事件日。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../lib/portal/memory-event-at.ts', import.meta.url), 'utf8');
assert.match(src, /\[ T\]/, '必须处理空格分隔日期');
assert.match(src, /backfillMemoryCreatedAtFromAttrs/, '必须有回填');
assert.match(src, /EVENT_DATE_KEYS/, '事件字段表');

function parseMemoryDate(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s) return null;
  const spaced = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)/);
  if (spaced) {
    const d = new Date(`${spaced[1]}T${spaced[2]}`);
    if (!Number.isNaN(d.getTime())) return d;
  }
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d;
  return null;
}

const flomo = parseMemoryDate('2025-12-10 23:47:10');
assert.ok(flomo, 'flomo 空格时间要能解析');
assert.equal(flomo.getFullYear(), 2025);
assert.equal(flomo.getMonth(), 11);
assert.equal(flomo.getDate(), 10);

const cal = parseMemoryDate('2026-08-21T10:00:00-04:00');
assert.ok(cal);
assert.equal(cal.getMonth(), 7);

const updates = [];
const nodes = [{
  id: 'n1',
  createdAt: '2026-08-09T15:00:00.000Z',
  attributes: { created: '2025-12-10 23:47:10' },
}];
for (const node of nodes) {
  const event = parseMemoryDate(node.attributes.created);
  const stored = parseMemoryDate(node.createdAt);
  if (event && stored && Math.abs(stored.getTime() - event.getTime()) >= 86_400_000) {
    updates.push({ id: node.id, createdAt: event.toISOString() });
  }
}
assert.equal(updates.length, 1);
assert.equal(new Date(updates[0].createdAt).getFullYear(), 2025);
assert.equal(new Date(updates[0].createdAt).getMonth(), 11);

console.log('memory-event-at: OK');
