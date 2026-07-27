# SYSTEM-LOGIC — Trip / Place / Expense / ExternalAdapter / 数据落点

> 工程焊点。改跨域行为前先读本文件。分层总览见 [system-layers.md](./system-layers.md)。
> 状态:2026-07-26 落地(原语 + 聚合口 + locality + 契约)。
>
> 配套 spec:[finance-aggregator-spec](./finance-aggregator-spec.md) · [shared-primitives](./shared-primitives.md) · [entity-schema-2026-07](./entity-schema-2026-07.md) · [data-locality-policy](./data-locality-policy.md) · [capture-adapters](./capture-adapters.md)

---

## 1. 核心实体(焊点)

| Kind | 权威存储 | 稳定 id | 跨域入口 |
|---|---|---|---|
| **Place** | named-places + place-trail | `placeId` 或 `placeKey(label,lat,lon)` | `lib/portal/entity-schema.ts` → `resolvePlaceKey` |
| **Trip** | `nesio-travel-trips-v1` (IDB) | `trip.id` | `travel-trips.ts` |
| **Expense** | 银行=`nesio-bank-tx-v1`;域内=`nesio-expenses-v1` | `bank:*` / `exp-*` | `finance-sources.ts` → `listExpenses` |
| **Meal / Dish** | cooking meals / recipes | meal id / recipe id | 身体账本只读 `getMeals()` |
| **Item** | inventory / life nodes | inventory id / node id | capture → ingestLifeNode |
| **Person** | person-records + entity-resolution | personKey | 关系域 |

禁止:在财务写一份「假银行流水」塞旅行小票(Plaid replace 会冲掉)。域内支出走 `addExpense` / `addReceiptExpense`。

家务零花钱 = play money,**永不**进 `finance-sources`。

---

## 2. 共享原语

| 原语 | 文件 | 用途 |
|---|---|---|
| Geo | `lib/portal/geo.ts` | 唯一 `haversineKm` / `placeKey` / `geoBucketKey` |
| PeriodLedger | `lib/portal/period-ledger.ts` | Σ实际 vs 预算进度(身体/旅行/预算条) |
| Expense 聚合 | `lib/portal/finance-sources.ts` + `finance-aggregate.ts` | 银行 ∪ 同币种域内;KPI 读口 |
| EntityRef / PlaceRef | `lib/portal/entity-schema.ts` | kind+id · `resolvePlace` |
| ExternalAdapter | `lib/portal/external-data-adapter.ts` | pull 源统一注册表 |
| CaptureAdapter | `lib/portal/capture-adapters.ts` | 按内容类型分流入库 |
| Locality | `lib/portal/locality.ts` | bundled / precache / device / cloud |

---

## 3. Trip ↔ Place ↔ Expense

```
Trip.nodes (hotel/shopping/poi)
  ├─ shopping 小票 → appendShoppingReceipt → 刷新 budget 节点
  │                 └─ addReceiptExpense(source=travel) → Finance 旁条
  └─ poi → travel-poi 离线库 + geo 距离

Place
  ├─ live/import → place-trail
  ├─ named → named-places.matchNearestPlace(haversineMeters)
  └─ resolvePlaceKey → 跨模块稳定键
```

相机小票(非行程):多数条目带价 → `addReceiptExpense(source=receipt)`。

---

## 4. 数据落点政策(A/B/C/D)

| 类 | 含义 | 例子 | 同步 |
|---|---|---|---|
| **A 本机权威** | 隐私敏感 / 大体量 | 银行流水、足迹原始段、邮件全文 | 记录级模块同步(身份内)或本机-only 明示 |
| **B 本机+云镜像** | 可重建或用户明确上云 | 行程、物品、身体目标、域内 expenses | `cloud-module-sync` |
| **C 派生只读** | 可随时重算 | PeriodLedger 进度、Finance KPI、POI 推荐 | 不单独持久 |
| **D 随包静态** | 离线资产 | `/data/travel-poi/*.json` | SW cache-first |

Offline 默认:UI 必须能在无网时读 A/B/D;花钱 AI 走 `guardAiRoute` + 可见失败态。

---

## 5. ExternalDataAdapter

连接器实现 `ExternalDataAdapter` 并 `registerExternalAdapter`。同步结果写各自权威 store,不经 Expense 伪造。
Tesla 充电花费:显示层并进 FinanceTab(见 `tesla-finance.ts`),不写 bank-tx。

---

## 6. Capture

见 [capture-adapters.md](./capture-adapters.md)。相机 Sheet 仍是主路径;适配器表是收敛方向。
