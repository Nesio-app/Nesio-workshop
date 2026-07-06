# 契约漂移

**最该优先处理的一类。** 漂移 = 契约声明了一套规则,但运行时代码根本没按它做。
比「没有契约」更糟:它给人「有约束」的**错觉**。

## 漂移项(1)

### ⚠ AI 供应商路由契约
- 契约:`lib/portal/ai-provider-router-contract.mjs`
- 治理什么:AI provider 选择/降级策略
- 问题:⚠ 漂移:真 AI 运行时 ai-complete.ts 完全不按此契约;契约说一套、代码做一套
- 处理:**对齐**(让运行时真按契约走,契约成 single source of truth)**或删**(消除假约束)。


## 死代码(1)

- **数据网络 DB** `lib/portal/module-data-network-db.mjs` + `app/api/portal/module-data-network/route.ts` —— 该 route 无任何前端 fetch —— 死端点,可净删(🔴 死代码,可净删)

## 已有的自动守卫

- `scripts/report-drift.mjs` —— 注册表元数据漂移检测(missingOwner/entry/status/evidence)
- `registryDriftGuard`(见 report:modules)—— 当前 warningCount:0

