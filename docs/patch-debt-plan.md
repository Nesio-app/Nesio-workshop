# 补丁清偿计划(Patch Debt Plan)

> 2026-07-11 立项。源起:外部批评「批次式修复攒出四类同根因多补丁 + 一个假修复」。
> 本文档 = 逐条对码核查结论 + 立项优先级。修 agent 在动相关区域时**必须**先读本表,
> 顺手清偿而不是再打一层补丁。完成一项勾一项并注明批次号。

## 核查结论(2026-07-11,对码验证)

| # | 批评 | 核查结论 |
|---|------|---------|
| 1 | AI 供应链每路由一抄 | **属实**。analyze/chat 各有一套 Claude/Gemini/OpenAI 调用与兜底;ai-provider-chain.mjs 只共享模型清单。批次 45「图片能用问一问不行」正是此结构的产物。 |
| 2 | 「自动重试」文案是假修复 | **部分成立**。banner 统计的是 memory outbox,那套真有重试(retryLifeGraphCloudSync);但 online 监听此前只挂在 MemoryTab(不开记忆页就不重试)——批次 78 已移到 Portal 全局,承诺无条件兑现。signal 上云(cloud_mirror_pending 次要镜像路径)确为 fire-and-forget 无队列,但失败有 logDropped 可观测,非哑吞。三套上云路径并存属实 → P4。 |
| 3 | 去重靠自愈补丁撒遍全场 | **属实**。10+ 文件各自自愈;写入幂等未在 createSignal/ingestLifeNode 两扇门统一强制。 |
| 4 | 标签三层数据层欠账 | **属实**。signal.ts 仍用 `tags.includes('财务')` 自由文本决定敏感度/保留。 |
| 5 | 可见性四套门叠加 | **属实**。功能开关 + APPSTORE_BUILD 清单 + entitlement + Lab,四套各管一摊,「健身漏网」是结构性产物。 |
| 6 | 热区反复回炉 | **属实**。焦点/全天/白边 3 天 7 批次;相机 4 轮;近期「已过期」也回炉 3 次(批次 73/75/76,三个不同根因)。 |

## 立项优先级

- [x] **P1 同步承诺兑现**(批次 78):online 重试监听移到 Portal 全局。文案与机制对齐,不再依赖记忆页恰好开着。
- [ ] **P2 统一 AI provider 执行器**:一个 `runAiTask(task, {messages|image, json})` 带链式兜底/重试/报错分类/reportAiCall 埋点;analyze/chat/decompose/gmail 等 ~35 路由只声明任务。与 ondevice-llm-routing-spec 三级路由合并做。验收:删掉各路由的 callClaude/callGemini/callOpenAI 副本;契约测试锁「路由文件不得直接 fetch api.anthropic.com/generativelanguage/openai」。
- [ ] **P3 写入门幂等**:createSignal/ingestLifeNode 按 externalId(或内容指纹)upsert;验收后逐步删除散装自愈(ConnectorsHub/cross-region/FinanceTab 等 10+ 处),每删一处跑全门禁。
- [ ] **P4 统一同步队列**:signal 云镜像接入 memory outbox 同一套(queue → retry → 状态可见),收口 conflictResolution;三条上云路并一条。
- [ ] **P5 可见性单点裁决**:`resolveVisibility(feature, {build, tier, lab, auth})` + 模块注册表 + 契约测试枚举「提审版可达面」。防下一个健身漏网。
- [ ] **P6 收尾**:sensitivity/retention 切 L1 枚举字段直读(写入时定级,抛弃标签关键词兼职);热区行为契约测试钉死(「全天无关键词事件永不进焦点」「内部时间戳永不当节点日期」「计划日期永不早于创建日」——前两条已有实现,补测试)。

## 规矩

1. 动 P2-P6 涉及区域的批次,先清偿再加功能;清偿本身算批次工作量。
2. 每完成一项,在本表勾选 + 写批次号 + 把被替代的散装补丁列出来删掉。
3. 新增「同类第二个补丁」前必须先在本表登记根因 —— 第三次打同根因补丁视为流程违规。

## 安全附录(2026-07-11 第二轮审计,变现四洞 = 同一根因「信任客户端」)

| # | 洞 | 状态 |
|---|----|------|
| S1 | Pro 门服务端零强制(canUsePaidCloudAi 只在客户端) | **待修 P0**:StoreKit 收据校验落地时,AI/付费路由必须服务端验 tier |
| S2 | guardAiRoute 只验 cookie 存在 | **批次 83 已修**:access token 过 Supabase /auth/v1/user 验真(TTL 缓存);refresh/openid 路径仍宽,随 S1 一并收口 |
| S3 | 21 天试用锚在 localStorage(删重装=重置) | **待修 P0**:锚到服务端账号 created_at;匿名无试用 |
| S4 | Pro 标志 localStorage 桩 | 已知(注释自认),与 S1 同一手术 |
| S5 | 一键腾空间无预览/撤销 | 待确认加确认流 |
| S6 | 忘记密码流缺失 | 待补 |

修法一体:AI/付费路由统一「验真 token + 验 tier」服务端中间层,与 P2
(统一 provider 执行器)合并做 —— 一次手术三个病。
