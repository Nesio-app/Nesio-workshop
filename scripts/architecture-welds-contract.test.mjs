/**
 * 架构焊点契约:geo / period-ledger / finance / entity / capture / locality / SYSTEM-LOGIC。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(root, p));

// ── docs ──
for (const f of [
  'docs/design/SYSTEM-LOGIC.md',
  'docs/design/capture-adapters.md',
  'docs/design/finance-aggregator-spec.md',
  'docs/design/shared-primitives.md',
  'docs/design/data-locality-policy.md',
  'docs/design/entity-schema-2026-07.md',
]) {
  assert.ok(exists(f), `missing ${f}`);
}

// ── geo 单源 ──
const geo = read('lib/portal/geo.ts');
assert.match(geo, /export function haversineKm/);
assert.match(geo, /export function placeKey/);
assert.match(geo, /export function haversineMeters/);

for (const f of [
  'lib/portal/place-trail.ts',
  'lib/portal/travel-poi.ts',
  'lib/portal/places-share.ts',
  'lib/portal/place-photos.ts',
  'lib/portal/named-places.ts',
]) {
  const src = read(f);
  assert.match(src, /from ['\"].*geo['\"]|from ['\"]@\/lib\/portal\/geo['\"]/, `${f} 应 import geo`);
  assert.doesNotMatch(src, /function haversineKm\s*\(/, `${f} 不应再定义 haversineKm`);
  assert.doesNotMatch(src, /function haversine\s*\(/, `${f} 不应再定义 haversine`);
}

assert.match(read('lib/portal/place-trail.ts'), /export \{ haversineKm \} from/);

// ── period-ledger ──
const pl = read('lib/portal/period-ledger.ts');
assert.match(pl, /ledgerProgressPct/);
assert.match(pl, /ledgerShortfall/);
assert.match(read('lib/portal/body-ledger.ts'), /ledgerShortfall/);
assert.match(read('lib/portal/travel-trips.ts'), /ledgerProgressPct/);

// ── finance ──
const fin = read('lib/portal/finance-sources.ts');
assert.match(fin, /listExpenses/);
assert.match(fin, /addReceiptExpense/);
assert.match(fin, /domainExpenseTotal/);
assert.match(fin, /nesio-expenses-v1/);
assert.match(fin, /sourceRef/, '幂等键');
assert.doesNotMatch(fin, /source:\s*['"]chores['"]|ExpenseSource.*chores|playMoney|allowance/i, '家务零花钱不得进财务聚合');
assert.match(read('lib/portal/travel-trips.ts'), /addReceiptExpense/);
assert.match(read('components/portal/CameraSheet.tsx'), /addReceiptExpense/);
assert.match(read('lib/portal/finance-aggregate.ts'), /financeMonthAggregate/);
assert.match(read('components/portal/finance/FinanceTab.tsx'), /financeMonthAggregate/);

// ── entity / capture / external / locality ──
assert.match(read('lib/portal/entity-schema.ts'), /resolvePlaceKey/);
assert.match(read('lib/portal/entity-schema.ts'), /export function resolvePlace/);
assert.match(read('lib/portal/capture-adapters.ts'), /ingestCapture/);
assert.match(read('lib/portal/capture-adapters.ts'), /booking-confirm/);
assert.match(read('lib/portal/external-data-adapter.ts'), /registerExternalAdapter/);
assert.match(read('lib/portal/external-data-adapter.ts'), /weather/);
const locality = read('lib/portal/locality.ts');
for (const id of ['bank-tx', 'expense-store', 'place-trail', 'weather', 'trip-itinerary', 'travel-poi-pack']) {
  assert.match(locality, new RegExp(`id: '${id}'`), `LOCALITY_REGISTRY 缺 ${id}`);
}

assert.match(read('docs/design/SYSTEM-LOGIC.md'), /数据落点政策/);
assert.match(read('docs/design/SYSTEM-LOGIC.md'), /finance-sources/);
assert.match(read('STATE.md'), /共享承重|finance-aggregator|architecture-welds/);

console.log('architecture-welds-contract: OK');
