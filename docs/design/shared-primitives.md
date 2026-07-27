# 共享原语 Spec · Ledger / Place / Geo / ExternalAdapter

> 2026-07-26 · 审计洞 #2  
> 实现：`period-ledger.ts` · `geo.ts` · `entity-schema.ts` · `external-data-adapter.ts`  
> 索引见 [SYSTEM-LOGIC.md](./SYSTEM-LOGIC.md)

## 1. 为什么提成原语

派生账本进度、地点距离键、外部实时数据被多域口头复用 → 漂移。  
「一个东西只有一份」落成代码入口。

## 2. PeriodLedger（进度账本）

**文件：** `lib/portal/period-ledger.ts`

用于身体目标 / 旅行预算 / 预算条：`actual` vs `budget` → `ledgerProgressPct` / `ledgerRemaining` / `ledgerShortfall`。

钱的 Σ 进−Σ 出读侧走 `finance-aggregate`（银行适配 + 域内 Expense），不另造第四套。

## 3. Geo + Place

| 入口 | 用途 |
|---|---|
| `lib/portal/geo.ts` | 唯一 `haversineKm` / `placeKey` / `geoBucketKey` |
| `resolvePlaceKey` / `resolvePlace` | `entity-schema.ts` — 稳定键 + PlaceRef |

旅行 POI、足迹、命名地点、分享图一律 import `geo`，禁止再抄一份 haversine。

## 4. ExternalDataAdapter

**文件：** `lib/portal/external-data-adapter.ts`

`registerExternalAdapter` / `listExternalAdapters`。天气等 pull 源登记于此；同步结果写各自权威 store。

预留 id：`flight-status` · `fx-rate` · `poi-enrich` · `cgm-stream`（空壳合法，禁止业务旁路同职责 fetch）。

## 5. Capture

按内容类型见 [capture-adapters.md](./capture-adapters.md) / `capture-adapters.ts`。
