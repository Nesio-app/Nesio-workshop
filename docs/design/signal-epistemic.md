# Signal 可信度分层(epistemic)

> 学 claude-obsidian 哲学,不引进其库。可清数据前提下的**硬方案**(2026-07-27 激进审计收口版)。

## 原则

1. **事实唯一入口**:`createSignal` / `ingestLifeNode`(禁止业务旁路 `addLifeNode`)
2. **epistemic 必盖章**:写入时 stamp;检索只答地面事实
3. **反馈不双写**:无 `nesio-signal-feedback-v1` / 无 `nesio-feedback-log-v1` / 无 `nesio-card-feedback-v1`;总线事件落 `feedback.reaction` Signal,DEC 压制读 `readFeedbackLog` 投影
4. **学习投影可留**:Preference / Baseline / cooling / dormant —— 不是第二真相源
5. **已退役伪智能**:`guidance-ranker` 在线学习接线、cross-region bandit 更新、living-model Lab、demo personalization stage、Recency 原语

## 分层

| epistemic | 检索答问 | 例子 |
|---|---|---|
| observation / user_asserted / extraction | ✅ | 连接器、用户回看、待确认抽取 |
| derived / system_summary / feedback | ❌ | 镜像、月报、反馈 |

字段:`generator` · `derivedFrom`

**信任缺口**:`derived` / `system_summary` / `extraction` 缺 `derivedFrom` 时 `stampEpistemic` 控制台弱标 + `hasWeakEvidenceChain`(契约钉死)。

## 反馈职责

| type | 职责 |
|---|---|
| `feedback.reaction` | 总线瘦事实(surface/dimension/key/reaction) |
| `feedback.today_card` | Today 富反馈(含 evidence ids);投影进同一 `readFeedbackLog` |

一次点击 → `emitFeedback` → Signal;禁止操作类动作(pin/add)冒充 `useful`。

## 代码

- `lib/life-domain/signal-epistemic.ts`
- `lib/platform/personalization/feedback-log.ts`(Signal 投影)
- `lib/life-domain/signal-feedback.ts`(只写 Signal)
- `lib/portal/reasoning-engine.ts`(DEC 读投影)
- 契约:`test:signal-epistemic` · `test:personalization` · `test:write-gate` · `test:runtime-data-plane`

## 刻意保留(非事实)

- Preference / cooling / dormant —— 展示与排序原子记录
- 成长页大面(home/lens/practice/healing)—— 教练气质,允许派生启发
- 多面镜月度信 —— 主认知面(living-model 已退役)
