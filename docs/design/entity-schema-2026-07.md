# 统一实体 Schema · 跨域焊点

> 2026-07-26 · 审计洞 #3  
> 承接 [entity-resolution-2026-07.md](./entity-resolution-2026-07.md)；代码契约 `lib/portal/entity-schema.ts`

## 1. EntityKind

| Kind | 权威存哪 | 规范键 |
|---|---|---|
| `person` | person-records + 别名 | entity-resolution |
| `item` | inventory / life object | inventory id |
| `place` | named-places + place-trail | `resolvePlace` / `resolvePlaceKey` |
| `dish` | cooking recipes | recipe id |
| `meal` | cooking meals | meal id |
| `trip` | travel-trips | trip.id |
| `expense` | bank-tx ∪ expenses store | `bank:*` / `exp-*` / sourceRef |

## 2. 最小字段

- **Person** `id, displayName, aliases[]`
- **Item** `id, name, placeId?, price?`
- **Place** PlaceRef：`id, label, lat?, lon?, kind`
- **Dish / Meal** 见 cooking 模块
- **Trip** `id, title, destination, nodes[], expenseIds?`
- **Expense** 见 [finance-aggregator-spec.md](./finance-aggregator-spec.md)

## 3. 焊点

| 场景 | 焊法 |
|---|---|
| 超市小票 | 1 Place + N Item + 1 Expense（同 placeId） |
| 机票确认 | 1 Trip + flight 节点 + 可选 Expense |
| 在外吃饭 | Meal + Place + 可选 Expense |
| 家务零花 | **不进** Expense 汇口（family ledger 隔离） |
| 足迹 ↔ POI | PlaceRef 合并 visit / named / poi |

合并：**只建议、确认才 merge**（entity-resolution L1）。

## 4. 护城河

抄不走的是**已解析图 + 用户确认的合并史**，不是认亲算法本身。
