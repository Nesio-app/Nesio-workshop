# Proactive AI Systems — 研究参考文献

> 本文档收录了在设计 Future Guidance Engine 和 Dormant Task Engine 过程中参考的真实研究成果。
> 这些研究是设计决策的权威依据，引用时直接指向本文档对应章节。
> 最后更新：2026-07

---

## 1. Google Now（2012-2014）— 主动卡片的最早成功案例

**核心设计原则：**
- "Right time, right place" — 由真实事件触发（邮件、日历、位置），不是用户主动查询
- 数据源：Gmail + Calendar + 位置历史 + 搜索模式
- 30+ 种卡片类型，全部情境驱动，不是规则模板

**最关键的设计：**
- **卡片有生命周期**。登机牌在飞机起飞后消失；"回家时间"卡在你到家后消失；包裹卡在签收后消失。
- **"Time to Home" 卡**：不是"你有一个行程"，而是"为了准时到，你现在应该出发了"。倒推时间，不是正推事件。
- **学习重复模式**：识别你的家/公司位置、通勤路线、常用地点，不是手动配置。

**对 Nesio 的启发：**
- `GuidanceCard.expiresAt`（已实现）：当行动窗口关闭时卡片自动消失
- 未来可实现：出行前"该出发了"的时间倒推逻辑

---

## 2. PRISM（2025）— 决策理论介入框架

**来源：** 2025 年学术论文，主动 AI 系统决策理论框架

**核心结论：**
```
只有当 P(用户接受) > threshold(误报代价 / 漏报代价) 时，才介入
```

**关键发现：**
- **误报的代价远大于漏报**。过度推送会侵蚀信任；漏报一次只是错过机会。
- 双进程架构：快速模式（默认）+ 慢速模式（仅在接近决策边界时触发）
- 结果：误报率降低 22.78%，F1 提升 20.14%

**对 Nesio 的启发：**
- `SHOW_THRESHOLD` 保守设置（宁漏勿扰）
- `dismissCount ≥ 3` → 冷却时间翻倍（已实现）
- 会议卡片窗口收紧到 4h 内（已实现）：更远的会议用户已经知道了

---

## 3. ProActor（2025）— RL 驱动的时机优化

**来源：** 2025 年强化学习 + 主动 AI 研究论文

**核心结论：**
- 行动窗口应该是**连续时间段**，不是精确时间点
- 时机质量通过 RL 学习，不是手动设置
- 阶段感知复合奖励：理解用户处于什么阶段（准备 / 执行 / 收尾）

**关键洞察：**
- "Opportunity time window" 概念：窗口是范围，紧迫度在窗口内非线性增加
- 传统"提前 X 小时提醒"的设计是错的，应该是"在行动机会最大化的窗口内提醒"

**对 Nesio 的启发：**
- `action-window.ts` 按类型分阶段 urgency（已实现）
- 飞机分三段：light prep (26-48h) → check-in (4-26h) → leave now (<4h)

---

## 4. TGL 论文（2025）— Trigger 决策不需要 LLM

**来源：** "Do Proactive Agents Need LLM for Trigger Decisions?" arXiv 2025

**核心结论：**
- 用于判断"要不要唤醒"的 trigger 决策，**根本不需要 LLM**
- Temporal Graph Learning（TGL）模型处理 `(actor, verb, object, timestamp)` 元组
- 一次前向传播同时得到 trigger 概率 + 路由分数
- 只有 trigger 触发后才调用 LLM 生成回复
- 结果：F1 提升 16.7 分，速度快 4-83 倍

**对 Nesio 的启发（已实现）：**
- Rule engine 决定是否触发（不用 AI），AI 只负责最后的语言生成
- 分层架构：规则层（快）→ AI 语言层（只在通过后才调用）

---

## 5. FSRS 算法（2025，Anki 默认调度器）

**来源：** Free Spaced Repetition Scheduler，2025 年成为 Anki 默认算法

**三个核心维度：**
- **Stability（稳定性）**：多少天后遗忘率降到目标（默认 90%）
- **Difficulty（难度）**：对特定用户的固有难度（使用均值回归，不永久偏移）
- **Retrievability（可提取性）**：当前记住的概率

**调度原理：**
- 每次成功复习后，Stability 指数增长（不是线性加法）
- 参数可针对个人优化（FSRS v6 增加了第 21 个个性化参数）

**对 Nesio 的启发（已实现于 dormant-engine.ts）：**

| Dormant Engine | FSRS 对应 |
|----------------|----------|
| 任务衰减 30 天进入休眠 | Retrievability 降到阈值 |
| 打盹间隔指数增长（7→14→30→60→90d） | Stability 随复习增长 |
| snoozeCount 驱动升级提示 | Difficulty 影响调度密度 |
| "还属于你吗？" | "还记得吗？" |

**学习系统应用（记录于 BACKLOG.md）：**
这套逻辑可以直接复用到未来的学习系统，适配 LearningNode 类型。

---

## 6. GTD 方法论（David Allen）— Someday/Maybe 处理原则

**来源：** Getting Things Done，David Allen；GTD 官方 Weekly Review Checklist

**核心原则：**
- Someday/Maybe 列表每周审查，问两个问题：
  1. "这件事还重要吗？"
  2. "这还是我的承诺吗？"
- **如果反复跳过某个下一步行动，这本身就是信号：你在投票反对它**
- 放弃一个项目不是失败，是诚实的优先级判断

**Someday/Maybe vs Active Project 的区分标准：**
- 没有当前 next action → 应转为 Someday/Maybe
- 没有明确截止或承诺 → 可以搁置
- 多次不做 → 重新谈判这个承诺

**对 Nesio 的启发（已实现于 dormant-engine.ts）：**
- `snoozeCount ≥ 3` → 升级提示"已搁置 3 次，这件事还是你的吗？"
- `snoozeCount ≥ 5` → "放下"变主按钮，主动引导告别
- 软归档 + 90 天复活（P2 已实现）

---

## 7. OmniFocus — Defer vs On Hold 设计

**来源：** OmniFocus 官方文档 + 用户社区讨论（omnigroup.com/omnifocus）

**两个不同的状态：**
- **Defer（延期）**= 某个时间点之前做不了，等时间（时间约束）
- **On Hold（暂停）**= 主动暂停，不确定是否继续（意图约束）

**Review 机制：**
- 每个项目有独立的 Review Interval（不是全局统一）
- Review Perspective 一次显示一个项目，强制专注判断
- 项目可设置月度/季度 review 频率

**对 Nesio 的启发（BACKLOG P3）：**
- `DormantStatus` 增加 `'on-hold'` 显式状态（详见 BACKLOG.md）
- 区分"被动遗忘变 dormant" vs "主动暂停变 on-hold"

---

## 8. Atlassian 僵尸项目研究 — 任务放弃的心理障碍

**来源：** Atlassian "Brain drain: Are Zombie Projects eating your team's productivity?" + Forbes 2024

**关键数据：**
- **超过 1/3 的员工害怕取消项目**，担心被认为"失败"
- **60% 的员工希望 AI 来帮助决定"继续还是放弃"**
- 43% 想要 AI 提供完整上下文回顾
- 37% 想要 AI 基于实际可用时间提供估算

**核心洞察：**
- 人们选择无限打盹而不是直接取消：心理成本（承认放弃）> 实际成本（继续占着位置）
- 沉没成本谬误：已经投入越多，越难放手
- AI 可以作为"中立的声音"降低放弃的心理成本

**对 Nesio 的启发（已实现）：**
- 软归档（archive → 90天后复活 → finalize）：降低放手的心理门槛
- 升级提示不强迫，而是提供信息（"你已经搁置了 3 次了"）
- "放下"用温和语言而非"删除/取消"

---

## 9. BDI 框架（Belief-Desire-Intention）— 主动 AI 的意图建模

**来源：** Satori 系统，BDI 主动 AI 代理框架

**三个维度：**
- **Belief（信念）**：系统对世界状态的理解（日历、邮件、位置、健康）
- **Desire（愿望）**：用户的长期目标和价值偏好
- **Intention（意图）**：用户当前正在做什么，打算做什么

**核心洞察：**
- 只有当环境变化威胁到用户的 Intention 时，才主动介入
- 不是"什么重要就推什么"，而是"什么会打断用户正在追求的东西"

**对 Nesio 的启发（记录于 BACKLOG.md）：**
- 未来学习用户的 intention 模式（任务偏好、时间模式）
- 基于 intention 调整 guidance 类型和频率（专注模式 vs 规划模式）

---

## 10. PROBE / ProAgentBench — 主动 AI 基准测试

**来源：** PROBE 论文（Proactive Retrieval and Offering Before Event），2025

**关键结论：**
- 主动 AI 的三个必要阶段：Search（检索）→ Bottleneck ID（瓶颈识别）→ Task Execution
- **"因为正确理由做出正确决定" vs "因为错误理由做出正确决定"**：两者在执行层完全不同
- 人类完成 proactive retrieval 任务的成功率只有 30%（说明任务本身很难）

**对 Nesio 的启发：**
- 规则引擎的作用：正确地识别瓶颈（Bottleneck ID），而不只是推送"看起来重要"的事
- Confidence 字段（已实现）：防止"因为错误理由"产生的误判

---

## 参考文献汇总

| 来源 | 类型 | 关键贡献 | 对应 Nesio 模块 |
|------|------|---------|----------------|
| Google Now（2012-2014）| 产品案例 | 卡片生命周期、情境驱动 | `expiresAt`，source-adapters |
| PRISM（2025）| 学术论文 | 非对称误报代价，阈值设计 | `SHOW_THRESHOLD`，dismissCount 冷却 |
| ProActor（2025）| 学术论文 | 机会时间窗口，RL 时机优化 | action-window.ts |
| TGL Paper（2025）| 学术论文 | Trigger 不需要 LLM | 规则引擎 + AI 语言分层 |
| FSRS（2025，Anki）| 算法 | 指数间隔，稳定性建模 | dormant-engine 指数打盹 |
| GTD（David Allen）| 方法论 | Someday/Maybe 处理，投票反对原则 | dormant 升级提示 |
| OmniFocus | 产品案例 | Defer vs On Hold 区分 | BACKLOG P3 |
| Atlassian 研究 | 产品研究 | 放弃任务的心理成本 | 软归档 + 90天复活 |
| BDI / Satori | 理论框架 | Belief/Desire/Intention 建模 | BACKLOG 意图推断层 |
| PROBE / ProAgentBench | 学术论文 | 正确理由 vs 错误理由决策 | Confidence 字段 |
