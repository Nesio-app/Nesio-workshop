# Future Guidance Engine — 设计规则文档

> 本文档是 Future Guidance 引导卡的权威设计规格。
> 代码实现路径：`lib/platform/guidance-engine/`
> 最后更新：2026-07

---

## 1. 产品定位

Future Guidance 是首页最上方的独立引导卡。
它不属于今日焦点，不属于普通提醒，不属于任务列表。

**目标：** 根据未来可能发生的事情，提前引导用户做一个现在最值得做的小动作，从而预防遗忘、降低风险、减少焦虑、养成习惯。

**与 Today Focus 的区别：**

| | Today Focus | Future Guidance |
|--|-------------|-----------------|
| 内容 | 今天和明天必须关注的安排、提醒、重要日子 | 为了未来更顺利，现在值得提前做的一件事 |
| 时间 | 今日/明日 | 未来任意时间窗口 |
| 位置 | 首页中部 | 首页最上方，独立于 Today Focus |
| 数量 | 多个 | 最多 1 张 |

两者完全独立。

---

## 2. 核心原则

### 2.1 Rule-based Selection + AI Language
- 规则决定是否进入 Future Guidance
- AI 只负责组织语言
- AI 不直接决定什么重要
- AI 不直接扫描全部数据后自由判断
- AI 只接收已经通过规则筛选的候选事件，并把它转成自然、温和、可执行的卡片语言

### 2.2 一句话原则
Future Guidance 不是提醒用户更多事情，而是只在未来真的会变得更麻烦之前，提前给用户一个最小、最值得做的动作。

---

## 3. 数据流

```
Data Sources
↓
Event Normalization
↓
Rule Engine (Layer 1-4)
  ├─ Action Window (Layer 3)
  ├─ Actionability Gate (hard gate)
  ├─ Consequence Severity (Layer 2)
  └─ Interrupt Evaluator (Layer 4)
↓
Candidate Pool
↓
Priority Engine (5维加权)
↓
Attention Budget (Layer 5)
↓
Cooldown / Frequency Filter (Layer 6)
↓
AI Language Generation (Layer 7)
↓
Future Guidance Card
```

---

## 4. 数据源

```
Calendar
Email
Memory
Weather
Reminder / Task
Inventory
Health / Habit
Location
School
Travel
Relationship
Finance
Device / App Signals
```

---

## 5. Event 标准化格式

所有来源必须先转成统一 Event 格式：

```json
{
  "id": "",
  "type": "",
  "source": "",
  "title": "",
  "scheduledAt": "",
  "createdTime": "",
  "expireTime": "",
  "status": "",
  "triggerType": "",
  "importance": 0,
  "urgency": 0,
  "confidence": 0,
  "actionability": 0,
  "metadata": {}
}
```

**Confidence 来源规则：**

| 数据源 | Confidence |
|--------|-----------|
| Calendar confirmed | 90 |
| Email confirmed | 85 |
| User-created reminder | 90 |
| Memory explicit date | 90 |
| Weather forecast | 65 |
| Health trend | 60 |
| Habit pattern | 60 |
| Location inference | 45 |
| AI inference only | 30 |

低置信度（< 50）事件只能进折叠区或不显示，不能直接进 Future Guidance。

---

## 6. Trigger Types

所有事件必须归入以下触发类型之一：

```
Deadline / Preparation / Prevention / Opportunity
Habit / Relationship / Context / Health
Travel / School / Inventory / Weather / Finance
```

---

## 7. 进入候选池的硬规则（全部为真才能进入）

1. 有明确未来影响
2. 有明确行动窗口
3. 有可执行动作（1 分钟内能开始）
4. 当前提醒有实际收益
5. 置信度足够高（≥ 50）
6. 不属于低价值泛提醒

---

## 8. 未来影响规则

系统必须判断：如果用户现在不处理，未来是否可能产生**损失、错过、压力、延误、浪费、健康风险、关系损耗或习惯中断**。

没有未来影响的事件不能进入 Future Guidance。

---

## 9. 行动窗口规则

```
过早：不提醒
正合适：进入候选池
过晚：转为补救提醒或不提醒
已失效：移除（expiresAt）
```

**各类型行动窗口（代码实现：action-window.ts）：**

| 类型 | 窗口开始 | 最佳时机 | 关闭 |
|------|---------|---------|------|
| Flight | 48h 前 | 4-26h 前（值机） | 2h 前（已出发） |
| Meeting/Medical | 4h 前 | 1-2h 前 | 30min 前 |
| Deadline | 2 天前 | 当天 | 过期时 |
| Birthday/Anniversary | 7 天前 | 1-3 天前 | 当天结束 |
| Weather | 出门前早晨 | 06:00-10:00 | 10:00 后 |

---

## 10. 可执行性规则

每张 Future Guidance 必须对应一个用户可以立刻开始的动作：

1. 用户看到后 1 分钟内能开始
2. 动作具体
3. 动作单一
4. 不需要复杂思考
5. 不使用抽象建议
6. 不显示长期计划

---

## 11. 收益阈值规则

至少满足一个：

```
降低风险 / 节省时间 / 节省成本 / 减少焦虑 / 提高成功率
避免遗忘 / 维持习惯 / 保护健康 / 维护关系 / 减少未来决策负担
```

---

## 12. Priority Engine（5 维加权）

代码实现：`interrupt-evaluator.ts`

| 维度 | 权重 | 说明 |
|------|------|------|
| Risk Severity | 30% | 不处理的后果严重性（0-3 级，归一化） |
| Time Sensitivity | 25% | 当前行动窗口紧迫度（WindowUrgency） |
| Preparation Value | 20% | 现在做 vs 以后做的收益差（按类型定义） |
| Confidence | 15% | 数据来源可靠性（0-100） |
| Personal Relevance | 10% | 对用户的个人相关性（来源类型代理） |

**最终分数 = 各维度加权均值 / 10，输出 0-10**

**显示阈值：≥ 4 才生成卡片**

### 各类型默认优先级参考

```
Safety / Health Critical：100
Travel / Flight：95
Deadline / Bill / School Due：90
Important Calendar Preparation：85
Important Relationship Date：80
Inventory Loss Prevention：65
Weather Preparation：60
Habit Continuity：50
General Opportunity：40
Low-value Reminder：0
```

---

## 13. Conflict Filter（高优先级压制低优先级）

```
高风险事件压制低风险事件
强时间敏感事件压制弱时间敏感事件
当天重大事件压制普通习惯事件
旅行事件压制普通家庭任务
健康关键事件压制普通机会提醒
重要关系日压制低价值待办
```

---

## 14. Attention Budget

- 默认只显示 **1 张**
- 不轮播、不堆叠、不连续刷屏
- 多个候选事件 → 只显示最高优先级
- 其余进入：折叠区 / 候选池 / 稍后提醒

---

## 15. Frequency Rules（事件驱动，非固定频率）

```
Calendar 变化后重新评估
Email 新增后重新评估
Weather 显著变化后重新评估
Location 变化后重新评估
Health 趋势变化后重新评估
Habit 状态变化后重新评估
Memory 日期窗口变化后重新评估
```

---

## 16. Cooldown Rules

| 用户行为 | 冷却策略 |
|---------|---------|
| 完成 | 立即移除 |
| 关闭 | 长冷却（按 urgency 级别） |
| 忽略 | 当天不重复 |
| 延后 | 按用户选择重新安排 |
| 多次忽略（3+次） | 冷却时间翻倍（dismissCount 机制） |

---

## 17. Learning Rules（Layer 7，逐步实现）

```
经常点击的类型 → 提高权重
经常完成的类型 → 提高权重
经常忽略的类型 → 降低权重
经常关闭的类型 → 增加冷却
经常延后的类型 → 减少打扰
用户主动创建的类型 → 提高可信度
用户明确删除的类型 → 停止出现
```

**当前实现状态：** 已实现 dismiss 计数 → 冷却倍增；完成率追踪待实现。

---

## 18. AI Language Generation（Section 20）

AI 只接收结构化候选事件，不参与决策。

**AI 输入结构：**
```json
{
  "triggerType": "",
  "title": "",
  "futureImpact": "",
  "recommendedAction": "",
  "timeWindow": "",
  "tone": "温和，具体，可执行",
  "maxLength": "标题≤12字，正文1句话"
}
```

**AI 输出约束：**
- 一句主文案
- 一个明确动作
- 不解释规则，不展示评分，不展示复杂推理
- 不制造焦虑，不使用命令式压力语言

**API 路径：** `POST /api/portal/guidance-language`（有 fallback，Claude 不可用时用规则生成文案）

---

## 19. 卡片内容结构

```
Icon
Title（≤12字）
One-line guidance（1句话）
Primary action（CTA按钮）
Dismiss / Later
```

---

## 20. 语言原则

```
短 / 准 / 温和 / 具体 / 可执行
不说教 / 不焦虑 / 不泛泛而谈
```

---

## 21. 禁止内容

```
泛健康建议 / 泛情绪建议 / 泛效率建议
无上下文提醒 / 无行动窗口提醒
低置信度猜测 / 重复提醒
无法立刻行动的建议 / 长期计划型建议 / 纯信息展示
```

---

## 22. 最终判断公式（全部为真才显示）

```
Has Future Impact       = true
Has Action Window       = true
Has Immediate Action    = true
Benefit Threshold Passed = true
Confidence ≥ 50         = true
Not Blocked By Higher Priority Event = true
Cooldown Passed         = true
User Preference Allows  = true
```

---

## 实现状态（2026-07）

| 层级 | 规则 | 代码文件 | 状态 |
|------|------|---------|------|
| Layer 1 | Event Detection | `source-adapters.ts` | ✅ |
| Layer 2 | Consequence Severity | `consequence-rules.ts` | ✅ |
| Layer 3 | Action Window + Expiry | `action-window.ts` | ✅ |
| Hard Gate | Actionability | `actionability.ts` | ✅ |
| Layer 4 | Priority Engine（5维） | `interrupt-evaluator.ts` | ✅（本次升级） |
| Layer 5 | Attention Budget | `attention-budget.ts` | ✅ |
| Layer 6 | Cooling + Dismiss Learning | `cooling-store.ts` | ✅ |
| Layer 7 | AI Language Generation | `guidance-language/route.ts` | ✅（本次升级） |
| Layer 7 | Completion/Click Learning | — | ⏳ 待实现 |
