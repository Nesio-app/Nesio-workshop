# 财务聚合模块 Spec · 跨域开销唯一账口

> 2026-07-26 · 审计洞 #1  
> 实现：`lib/portal/finance-sources.ts` + `lib/portal/finance-aggregate.ts`  
> 索引见 [SYSTEM-LOGIC.md](./SYSTEM-LOGIC.md)

## 1. 一句话

财务模块 = **各域开销的唯一汇入口 + 银行专家层看板**。  
银行 Plaid 流水是 Expense 的一种来源，不是唯一来源。旅行/小票只准走 `addExpense` / `addReceiptExpense`，禁止私建第二套钱账。

## 2. 角色澄清

| 已有 | 角色 |
|---|---|
| `bank-tx` + Finance L1–L3 | 银行流水专家体系（保留） |
| `nesio-expenses-v1` | 域内开销事实（小票 / 旅行） |
| `financeMonthAggregate` | 读侧：银行 ∪ 同币种域内支出 |

## 3. Expense 事实

见 `finance-sources.ts`：`amount` / `currency` / `occurredAt` / `source` / `sourceRef`(幂等) / `includeInFinance` / `placeId`。

**硬禁：**

- 不把旅行小票写进 `nesio-bank-tx-v1`（Plaid replace 会冲掉）
- **家务零花钱永不进本汇口**（play money，见 `lib/family/chores-core.ts`）
- Tesla 充电花费只在 FinanceTab 显示层并进，不经本 store 双计

## 4. 写入门

| 场景 | 调用 |
|---|---|
| 相机小票（非行程） | `addReceiptExpense({ source:'receipt' })` |
| 行程购物 | `appendShoppingReceipt` → 内部 `addReceiptExpense({ source:'travel', sourceRef })` |
| 手工 | `addExpense({ source:'manual' })` |

`sourceRef` 命中则 upsert，避免同小票重复入账。

## 5. 读侧

- KPI：`financeMonthAggregate(ym)`（同币种域内并入 gross/net）
- 旁条：异币种 / 仅浏览仍用 `domainExpenseTotal`
