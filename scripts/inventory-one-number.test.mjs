/**
 * 行为契约:「收纳」这个入口报的件数,必须和点进去看到的清单是同一批东西
 * (2026-07-29 QA #12/#13)。
 *
 * 用户实测:记忆页那个「收纳」球标 22 件,点进去顶上写 18 件 · 18 未归位。
 * 差的 4 件是食材 —— 收纳页早就把它们滤掉了(归「做饭 · 库存」那张脸,免得护照清单里混进
 * 菠菜),而外面那个球直接读了 listInventoryItems() 的全长度。**同一件事两处各写各的口径**,
 * 于是「点进去东西变少了」。这和记忆总数 2534/2541 是一模一样的病(见 memory-visibility.ts)。
 *
 * 这条测试钉两件事:
 *   ① 判据只有一处(lib/portal/inventory-visibility.ts),别的地方不许再手写一遍过滤;
 *   ② 每个把「收纳」摆给用户看的组件都读那一处。
 * 新加一张显示收纳件数的脸时,把它加进 SURFACES —— 漏了就是下一个 22 vs 18。
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { stripComments } from './lib/strip-comments.mjs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const code = stripComments;

// ── ① 判据存在,而且真的是「全量减食材」 ────────────────────────────────────
{
  const src = code(read('lib/portal/inventory-visibility.ts'));
  assert.ok(/export function listStorageItems\(\)/.test(src), 'listStorageItems 不见了');
  // 2026-07-29 标注(Bug4 P10)后口径扩为「全量减食材**减衣物**」——
  // 收纳页三个统计(物品/衣橱/食材)必须互斥,否则三个数加起来大于总数。
  assert.ok(
    /listInventoryItems\(\)\.filter\(\(i\) => !isFoodItem\(i\) && !isGarment\(i\)\)/.test(src),
    'listStorageItems 不再是「全量减食材减衣物」—— 收纳页显示的和它报的数就会重新分家',
  );
  assert.ok(
    /export function countWardrobeItems\(\)/.test(src),
    'countWardrobeItems 不见了 —— 收纳页三个统计的第二个靠它',
  );
  assert.ok(
    /export function countPantryItems\(\)/.test(src),
    'countPantryItems 不见了 —— 收纳页那句「另有 N 件食材在做饭 · 库存」靠它把 18 + 4 = 22 圆回来',
  );
}

// ── ② 每张显示收纳件数的脸都读同一处 ───────────────────────────────────────
const SURFACES = [
  ['components/portal/InventorySheet.tsx', '收纳面板本身'],
  ['components/portal/MemoryTab.tsx', '记忆页那个「收纳」球(就是标 22 件的那个)'],
  ['components/portal/insights/InventoryStatsPanel.tsx', '洞察 → 物品统计'],
];
for (const [file, what] of SURFACES) {
  const src = code(read(file));
  assert.ok(
    /listStorageItems\(\)/.test(src),
    `${what}(${file})没读 listStorageItems —— 它报的数会和收纳页里的清单对不上`,
  );
  // 自己再滤一遍 = 又开了第二个口径。判据变了(比如以后药品也分出去)只会改一处,漏掉的那处就成了下一个 22。
  assert.ok(
    !/isFoodItem/.test(src),
    `${what}(${file})自己又写了一遍食材过滤 —— 判据必须只有 inventory-visibility 一处`,
  );
}

// ── ③ 差额必须在屏幕上有个交代 ─────────────────────────────────────────────
// 光把外面的数改小,用户在记忆里数出 22 条物品、收纳里只有 18 件,差的 4 件仍然像丢了。
// 所以收纳页要说一句「另有 N 件食材在做饭 · 库存」,而且那句话得能点过去。
{
  const src = code(read('components/portal/InventorySheet.tsx'));
  assert.ok(/countPantryItems\(\)/.test(src), '收纳页没数食材件数');
  assert.ok(
    /pantryCount > 0 && \(/.test(src),
    '收纳页没有「另有 N 件食材」那一行 —— 差额没交代,用户还是会觉得东西丢了',
  );
  const at = src.indexOf('pantryCount > 0');
  const block = src.slice(at, at + 600);
  assert.ok(
    /nesio-open-cooking/.test(block),
    '「另有 N 件食材」不能点过去 —— 说了在别处却不给路,等于没说',
  );
}

console.log('inventory-one-number: OK(判据一处 · 三张脸同源 · 差额有交代且能点过去)');
