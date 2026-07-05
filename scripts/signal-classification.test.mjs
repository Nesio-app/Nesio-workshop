/**
 * 行为契约:保留期/敏感度分类"持久化优先"(直接执行 signal-classification)。
 *
 * 修复的隐患:写入时按 source 定分类并存进 attributes,读取时却按 tag 重推,
 * 两处可能不一致;而 retentionPolicy 驱动物理删除(pruneDisposableSignals),
 * 于是"写成 Normal、读成 Disposable"= 数据丢失向量。
 */
import assert from 'node:assert/strict';
import { resolveRetention, resolveSensitivity } from '../lib/life-domain/signal-classification.mjs';

// ── 数据丢失回归:持久化 Normal 必须压过"会判 Disposable"的推断 ──────────────
{
  // source=voice、无 relations、无 rawInput → 推断会判 Disposable(24h 内可被剪枝删除)。
  const node = {
    type: 'observation', source: 'voice', tags: [], relations: [], rawInput: '',
    attributes: { retentionPolicy: 'Normal' },
  };
  assert.equal(
    resolveRetention(node), 'Normal',
    '持久化 Normal 必须胜出,不能被推断降级成 Disposable 而被物理删除。',
  );
}

// ── 持久化敏感度胜过 tag 推断 ───────────────────────────────────────────────
{
  const node = { type: 'health_state', source: 'manual', tags: ['健康'], attributes: { sensitivity: 'private' } };
  assert.equal(resolveSensitivity(node), 'private', '持久化 sensitivity 优先于 health tag 推断。');
}

// ── 无持久化值 → 走推断兜底(旧数据/非 createSignal 路径)───────────────────
{
  const weather = { type: 'observation', source: 'weather', tags: ['天气'], relations: [], rawInput: '', attributes: {} };
  assert.equal(resolveRetention(weather), 'Disposable', '天气类无持久化值 → 推断 Disposable。');

  const person = { type: 'person', source: 'manual', tags: [], relations: [], attributes: {} };
  assert.equal(resolveRetention(person), 'AlwaysAlive', 'person 节点 → AlwaysAlive(保命方向)。');

  const family = { type: 'observation', source: 'manual', tags: ['family'], relations: [], attributes: {} };
  assert.equal(resolveRetention(family), 'AlwaysAlive', 'family tag → AlwaysAlive。');

  const health = { type: 'health_state', source: 'manual', tags: [], attributes: {} };
  assert.equal(resolveSensitivity(health), 'health', 'health_state 无持久化值 → 推断 health。');
}

// ── 非法持久化值被忽略,回退推断 ────────────────────────────────────────────
{
  const node = { type: 'person', source: 'manual', tags: [], relations: [], attributes: { retentionPolicy: 'Bogus' } };
  assert.equal(resolveRetention(node), 'AlwaysAlive', '非法持久化值忽略,回退推断(person→AlwaysAlive)。');
}

console.log('signal-classification: OK');
