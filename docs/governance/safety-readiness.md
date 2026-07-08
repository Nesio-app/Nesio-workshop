# 安全与就绪

历史上这组是 8 份「报告型就绪契约」(安全事件/云就绪/生产激活/独立上架/身份升级/
离线冲突/工具数据版本/模块适配)。架构审查 #7(2026-07)认定它们为**空转 report-only**
——算了没人看、自洽测试守护不了任何真实运行时——已整组删除。

活着的对应物:
- 生产激活检查单:`/api/portal/production/activation-checklist`(production-runtime 契约驱动,有 API 消费方)
- 安全门禁:`npm run test:security` 链(fail-closed 审计,按 exit code)
- 云运行时:`test:cloud-*` 运行时探针族

