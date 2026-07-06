/**
 * 行为契约:重同步幂等去重的外部 id 逻辑(直接执行 external-id)。
 *
 * 修「去重散落在各 ConnectorsHub 循环、Gmail/Notion/捕获没去 → 同步 100 行 Notion
 * 三次 = 300 个节点」。ingestLifeNode 现按 (source + 稳定外部 id) 幂等。
 */
import assert from 'node:assert/strict';
import { externalIdOf, findByExternalId } from '../lib/portal/external-id.mjs';

// ── externalIdOf:各连接器的稳定 id 键都能取到,带键名前缀 ────────────────────
assert.equal(externalIdOf({ emailId: 'm123' }), 'emailId:m123', 'Gmail 用 emailId。');
assert.equal(externalIdOf({ notionPageId: 'p-abc' }), 'notionPageId:p-abc', 'Notion 用 notionPageId。');
assert.equal(externalIdOf({ calendarId: 'c1' }), 'calendarId:c1');
assert.equal(externalIdOf({ flomoSlug: 's1' }), 'flomoSlug:s1');
assert.equal(externalIdOf({ externalId: 'x1' }), 'externalId:x1', '通用 externalId。');
assert.equal(externalIdOf({}), '', '无外部 id → 空(照常新建)。');
assert.equal(externalIdOf(null), '', 'null 安全。');
assert.equal(externalIdOf({ emailId: '  ' }), '', '空白 id 不算。');

// ── 不同来源/不同键的裸 id 不撞车 ───────────────────────────────────────────
assert.notEqual(externalIdOf({ emailId: 'X' }), externalIdOf({ notionPageId: 'X' }), '同值不同键不相等。');

// ── findByExternalId:同 source + 同 id → 命中(重同步更新而非新建)──────────
{
  const nodes = [
    { source: 'email', attributes: { emailId: 'm1' }, name: 'v1' },
    { source: 'notion', attributes: { notionPageId: 'p1' }, name: 'n1' },
  ];
  const hit = findByExternalId(nodes, 'email', externalIdOf({ emailId: 'm1' }));
  assert.ok(hit && hit.name === 'v1', '同 source + 同 emailId → 命中已存在节点。');

  // 不同 source 同 id 值 → 不命中(邮件 m1 不会命中 notion 的 m1)
  assert.equal(findByExternalId(nodes, 'notion', externalIdOf({ emailId: 'm1' })), null, '跨 source 不误命中。');
  // 新条目(m2)→ 不命中 → 会走新建
  assert.equal(findByExternalId(nodes, 'email', externalIdOf({ emailId: 'm2' })), null, '新条目不命中 → 新建。');
  // 无外部 id → 不命中(手动/语音照常新建)
  assert.equal(findByExternalId(nodes, 'email', ''), null, '无外部 id → 不去重。');
}

// ── 幂等语义:同一条目"取 id → 查已存在"三次都命中同一个 → 不会造 3 个 ──────────
{
  const store = [{ source: 'notion', attributes: { notionPageId: 'row-7' }, name: 'r' }];
  for (let i = 0; i < 3; i++) {
    const hit = findByExternalId(store, 'notion', externalIdOf({ notionPageId: 'row-7' }));
    assert.ok(hit, `第 ${i + 1} 次重同步都命中已存在节点(不新建)。`);
  }
}

console.log('external-id-dedup: OK');
