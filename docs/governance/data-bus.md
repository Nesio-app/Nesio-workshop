# 模块数据总线

模块之间「谁产出、谁消费」哪些数据。**注意**:当前这层是**契约/元数据校验**(`module-data-bus.mjs` 自声明 `writesRealData:false`),
不是运行时消息总线 —— 它描述连接关系,不搬运真实数据。

## 数字

| 指标 | 值 | 说明 |
|---|---|---|
| 模块 | 11 | 参与数据网络的模块 |
| data-key | 34 | 声明的数据键总数 |
| 已连接 | 7 | 有生产方↔消费方的键 |
| **孤立** | **27** | 声明了但没接线的键 —— 空转量化 |
| 连接边 | 23 | 生产→消费 的边 |
| 告警 | 0 | 缺依赖/越界告警 |

> 27/34 个 data-key 是孤立的——说明数据网络画得比实际接线大得多。这不是 bug,是「契约先行」的正常状态;但它量化了「要瘦身/要接线」的空间。

## 连接边(前 25)

| 生产模块 | | 消费模块 | data-key | 关系 | 风险 |
|---|---|---|---|---|---|
| secretary | → | finance | `approval_gate` | producer_to_consumer | local_contract |
| secretary | → | health | `approval_gate` | producer_to_consumer | local_contract |
| secretary | → | psychoanalysis | `approval_gate` | producer_to_consumer | local_contract |
| secretary | → | finance | `interaction_log` | producer_to_consumer | local_contract |
| secretary | → | plan | `interaction_log` | producer_to_consumer | local_contract |
| secretary | → | finance | `launch_context` | producer_to_consumer | local_contract |
| secretary | → | health | `launch_context` | producer_to_consumer | local_contract |
| secretary | → | lifesim | `launch_context` | producer_to_consumer | local_contract |
| secretary | → | psychoanalysis | `launch_context` | producer_to_consumer | local_contract |
| secretary | → | quiz | `launch_context` | producer_to_consumer | local_contract |
| secretary | → | fitness | `notification_gate` | producer_to_consumer | local_contract |
| secretary | → | finance | `preferences` | producer_to_consumer | local_contract |
| secretary | → | fitness | `preferences` | producer_to_consumer | local_contract |
| secretary | → | inventory | `preferences` | producer_to_consumer | local_contract |
| secretary | → | plan | `preferences` | producer_to_consumer | local_contract |
| secretary | → | reading | `preferences` | producer_to_consumer | local_contract |
| secretary | → | sanctuary | `preferences` | producer_to_consumer | local_contract |
| secretary | → | inventory | `profile` | producer_to_consumer | local_contract |
| secretary | → | plan | `profile` | producer_to_consumer | local_contract |
| secretary | → | finance | `session_mode` | producer_to_consumer | local_contract |
| secretary | → | fitness | `session_mode` | producer_to_consumer | local_contract |
| secretary | → | reading | `session_mode` | producer_to_consumer | local_contract |
| secretary | → | sanctuary | `session_mode` | producer_to_consumer | local_contract |

