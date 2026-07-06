# 安全与就绪

这些是**报告型**治理(🟡 仅报告聚合):已聚合进 `report:modules`,量化了就绪度,但还没在任何界面上给人看——
这本书 + admin 面板就是补上这个可见性缺口。

## 安全事件就绪

- 契约:`lib/portal/security-incident-readiness-contract.mjs`
- 事件类型:5 · 严重度档:4
- 告警:0

## 云就绪

- 契约:`lib/portal/cloud-readiness-contract.mjs`
- provider 候选:5
- 告警:0
- 默认运行时仍 local-first;云为「就绪度描述」,非已接线。

## 生产激活 / 独立上架

- `production-activation-contract.mjs` · `standalone-app-readiness-contract.mjs`
- 状态:🟡 仅报告聚合 —— 就绪度报告,发布前用来核对。

