# Context Briefing Engine — 设计规格 + 算法架构

> 核心重定义：不是"每日早报"，而是**此刻播客**。
> 用户任何时候点开，听到的是：此刻这个时间、地点、状态下，我需要知道什么？

---

## 一、产品定位

### 旧定位（废弃）
听简报 = 每天一次固定早报。固定时间，固定结构，固定内容。

### 新定位：Context Briefing

```
用户点击"听简报"
↓
读取当前上下文（时间 + 地点 + 日历状态 + 情绪/精力 + 已有卡片）
↓
过滤已完成 / 过期 / 已展示信息
↓
更新事件时态（未来→进行中→刚结束→已结束）
↓
生成 30-90 秒音频脚本 → TTS 播出
```

它回答：**现在这个时间、地点、状态下，我需要知道什么？**

---

## 二、核心引擎规则

### 2.1 时间状态机（Allen's Interval Algebra, 1983）

同一个事件在不同时间点产生完全不同的话术：

```
┌────────────────┬─────────────────────────────────────────────┐
│ 状态           │ 话术策略                                     │
├────────────────┼─────────────────────────────────────────────┤
│ 未开始（遥远）  │ 今日结构提示，不占当前注意力                  │
│ 会前 2h-30m   │ "下午有场 Review，上午别被打散"               │
│ 会前 30m-0    │ "还有半小时，准备一下"                        │
│ 进行中         │ 默认不打扰（用户主动打开时：一句当下）          │
│ 会后 0-60m    │ "刚开完会，先缓一下，做件轻松的事"             │
│ 会后 60m+     │ 默认不提（可选：跟进提醒）                     │
│ 已完成         │ 不播                                         │
│ 错过           │ 补救建议                                     │
└────────────────┴─────────────────────────────────────────────┘
```

```typescript
type EventState =
  | 'future_distant'  // > 4h
  | 'future_today'    // 今天，> 2h
  | 'upcoming'        // 30–120 分钟内
  | 'imminent'        // < 30 分钟
  | 'in_progress'     // [start, end] 内
  | 'just_ended'      // 结束后 0–60 分钟
  | 'ended'           // 结束后 60 分钟+
  | 'missed'          // 过了开始未参与
  | 'completed';      // 明确标记完成

function getEventState(event: CalendarEvent, now: Date): EventState {
  const minsToStart = (event.start.getTime() - now.getTime()) / 60000;
  const minsFromEnd = (now.getTime() - event.end.getTime()) / 60000;
  if (minsFromEnd > 60)   return 'ended';
  if (minsFromEnd >= 0)   return 'just_ended';
  if (minsToStart <= 0)   return 'in_progress';
  if (minsToStart <= 30)  return 'imminent';
  if (minsToStart <= 120) return 'upcoming';
  if (minsToStart <= 240) return 'future_today';
  return 'future_distant';
}
```

---

### 2.2 当前地点规则

```
在家         → 家庭 / 准备 / 健康 / 收纳 / 休息
在公司        → 工作 / 会议 / 任务 / 邮件
在路上        → 行程 / 天气 / 交通 / 到达后事项
在机场/车站   → 登机 / 证件 / 行李 / 时间节点
在商店        → 购物清单 / 库存 / 顺路事项
在健身房      → 运动 / 恢复 / 健康记录
未知          → 不使用地点判断，回退时间规则
```

---

### 2.3 时间段规则

```
早晨  06-09  → 今日结构 + 重要安排 + 天气 + 出门准备
上午  09-12  → 工作启动 + 会议准备 + 高优任务
中午  12-14  → 能量恢复 + 下午安排 + 轻提醒
下午  14-18  → 截止事项 + 接送 + 会议后续
晚上  18-21  → 收尾 + 家庭 + 健康 + 明日准备
睡前  21-24  → 明天准备 + 情绪记录 + 轻复盘
```

---

### 2.4 内容优先级（最多 3 个信息点）

```
1. 正在发生 / 马上发生（< 30 分钟）
2. 刚结束后的恢复或后续（< 60 分钟前）
3. 今天剩余重要事项（含截止）
4. 未来准备事项（今天内）
5. 当前地点相关事项
6. 个人状态反馈（来自 Moment Capture）
7. 外部信息（天气、交通）
```

评分公式：
```
score = urgency×0.5 + importance×0.3 + freshness×0.2
// 已在卡片上显示 → ×0.5（降权但不删除，改用不同角度补充）
```

---

### 2.5 去重与重诠释（MMR, Carbonell & Goldstein 1998）

**不重读卡片，而是重新诠释**：

```
卡片显示：下午 2 点 Sprint Review
音频应该说：今天真正需要卡住时间的是下午那场 Review，上午别被其它小事打散。

卡片显示：今晚降温，拿外套
音频应该说：出门前别忘了外套，这是今天最值得提前做的小动作。
```

---

### 2.6 已发生事项处理

```
已完成     → 不播
刚结束     → 恢复 / 复盘 / 下一步
错过       → 补救建议
过期低价值  → 不播
```

会后语言示例：
```
✅ "刚开完一小时会，先缓一下。现在适合处理一件轻一点的事。"
❌ "你今天有一个会议。"（机械读日程，绝不出现）
```

---

## 三、音频脚本规格

### 3.1 动态结构

```
[一句当前状态]      此刻是什么时间/地点/情绪
[一个最重要提醒]    最高优先级内容，重新诠释而非复读
[一个下一步建议]    具体可执行的一步
[一句结束]         轻收尾，不制造压力
```

**长度**：30–90 秒 ｜ **最多** 3 个信息点

### 3.2 语言风格

| 要 | 不要 |
|---|---|
| 短句，自然口语 | 长从句，书面语 |
| 当下感（"现在""刚刚""马上"）| 机械读日程（"14:00 Sprint Review"）|
| 重新诠释卡片 | 照读卡片 |
| 一个建议 | 列清单 |
| 私人助理语气 | 新闻播报语气 |

### 3.3 TTS 优化规范（150-160 WPM）

- 30 秒 ≈ 75 词；90 秒 ≈ 225 词
- 短句优先（≤20 词/句），避免嵌套从句
- 数字展开："3:00 PM" → "三点钟"；"¥1200" → "一千两百"
- 避免缩写

### 3.4 示例脚本

**工作日下午 13:50，在公司**：
```
现在快两点了，下午有场 Sprint Review。
上午你已经处理了主要的东西——下午这场是今天最需要专注的时间。
准备一下你想在 Review 里说的一两点，其他事之后再说。
```

**晚上 22:30，在家**：
```
现在快十一点了，可以开始收尾了。
明天上午有个十点的电话，今晚睡前把需要准备的东西想一下。
今天的事基本结束了，好好休息。
```

---

## 四、Context Engine 算法架构

### 4.1 信号输入

```typescript
interface BriefingContext {
  now: Date;
  timeOfDay: 'morning' | 'forenoon' | 'noon' | 'afternoon' | 'evening' | 'bedtime';
  location?: 'home' | 'work' | 'transit' | 'airport' | 'store' | 'gym' | 'unknown';
  calendarEvents: CalendarEvent[];   // 今天全天 + 明天前 2h
  todayTasks: Task[];
  shownCards: GuidanceCard[];        // 当前已显示的卡片
  lastMoment?: {
    emotion: string;
    energyLevel: 'high' | 'mid' | 'low';
    recordedAt: string;
  };
  weather?: { temp: number; condition: string };
}
```

### 4.2 Pipeline

```typescript
async function generateContextBriefing(ctx: BriefingContext): Promise<string> {
  // Step 1: 对每个事件计算时态状态
  const eventStates = ctx.calendarEvents.map((e) => ({ event: e, state: getEventState(e, ctx.now) }));

  // Step 2: 过滤 ended / completed
  const active = eventStates.filter((es) => !['ended', 'completed'].includes(es.state));

  // Step 3: 构建候选内容池 + 优先级评分
  const candidates = buildCandidates(active, ctx);
  const top3 = selectTop3WithMMR(candidates, ctx.shownCards);

  // Step 4: LLM 生成脚本（规则决定"说什么"，LLM 决定"怎么说"）
  return await generateScript(top3, ctx);
}
```

### 4.3 LLM 分工原则

```
规则引擎（TypeScript） → 决定"说什么"（top 3 内容点）
LLM（Claude Haiku）   → 决定"怎么说"（叙事风格、30-90秒）
```

---

## 五、竞品调研（2025-07）

### 5.1 HUXE 深度分析

**背景**：前 NotebookLM 团队（Raiza Martin 等），2025 年 6 月上线，**2026 年 5 月 28 日关闭**。关闭原因：Spotify 推出 Personal Podcast（5/21）+ Google I/O 2026 发布 Gemini Daily Brief（5/22）。

**核心功能**：Daily Briefing（5分钟，整合邮件+日历）/ Live Stations（24/7 音频电台）/ DeepCasts（按需播客）/ Join（语音打断）。

**关键差距**：HUXE 的情境感知停留在"今天"粒度，**无法做到"此刻"粒度**——同一个会议在会前/会中/会后不会产生不同内容。是时间轴上的静态快照，不是动态状态机。

| 维度 | HUXE | Context Briefing |
|---|---|---|
| 时间粒度 | 每天一次 | 任意时刻 |
| 时态状态机 | ❌ 无 | ✅ 9 种状态 |
| 内容长度 | 5 分钟 | **30–90 秒** |
| 去重机制 | ❌ 无 | ✅ MMR + 重诠释 |

### 5.2 竞品全景矩阵

| 产品 | 情境感知深度 | 内容去重 | 时态转换 | 地点感知 | 核心差距 |
|---|---|---|---|---|---|
| HUXE（已关闭） | ⚡ 今天粒度 | ❌ | ❌ | ❌ | 每日静态快照 |
| Gemini Daily Brief | ⚡ 今天粒度 | ⚡ | ❌ | ❌ | Google 生态锁定 |
| Google Now（已停止） | 🔵 历史最强 | ✅ | ✅ | ✅ | 已停止，无心理状态 |
| Apple Intelligence Notif. | ⚡ 通知权重 | ⚡ | ❌ | ❌ | 被动触发 |
| Alexa Flash Briefing | ❌ 无 | ❌ | ❌ | ❌ | 纯媒体内容 |
| Spotify Personal Podcast | ❌ 无 | ❌ | ❌ | ❌ | 内容推荐，非情境 |
| Superhuman AI Brief | ⚡ 邮件专用 | ✅ | ❌ | ❌ | 无日历感知 |
| **Nesio Context Briefing** | ✅ **此刻粒度** | ✅ MMR | ✅ **时态机** | ✅（授权后）| **唯一整合心理状态** |

### 5.3 核心算法文献

| 算法 | 来源 | 应用 |
|---|---|---|
| Allen's Interval Algebra | Allen 1983 | 时态状态机（9 种事件状态）|
| MMR 去重 | Carbonell & Goldstein 1998 | 卡片重诠释而非重读 |
| Learning to Rank + BPR | — | P1 个性化权重学习 |
| IA-RAG | 2026 | 时间感知知识检索 |
| Calendar-Aware Stress Msg | CHI 2025 | 高压日历语气调整 |
| DiscoSum 话语结构 | 2026 | 叙事型摘要（非列表）|
| Schilit & Theimer | 1994 | 四维情境模型（Location/Identity/Time/Activity）|

### 5.4 战略结论

1. **HUXE 验证了市场，输在粒度**：Gemini Daily Brief 替代了"每日"用例，但没有人在做"此刻时态状态机"。
2. **Allen's Interval Algebra 是被低估的利器**：日历 API 给时间戳，用户需要的是状态（会前/中/后）。没有竞品认真做这一层。
3. **"重诠释"不是"去重"**：最好的实践是把卡片内容用语音语境重新解读，而不是跳过。
4. **30–90 秒是护城河**：大公司的长格式（5分钟）无法服务"走廊30秒"场景。
5. **护城河 = 个人心理状态整合**：Moment Capture 的 emotion + energyValue 是所有竞品都没有的输入，是最难复制的差异化。

---

## 六、分阶段实现路线图

### P0 — 纯规则层

| 功能 | 算法 | 状态 |
|---|---|---|
| Allen's Algebra 时态状态机（9 种状态）| Allen 1983 | 📋 `lib/portal/briefing-engine.ts` |
| 时间段规则（6 段）| 产品定义 | 📋 |
| 固定权重优先级评分 | LTR Pointwise | 📋 |
| 已完成/过期过滤 | 产品定义 | 📋 |
| 卡片 ID 集合去重 + 模板重诠释 | MMR 简化 | 📋 |
| LLM 脚本生成（Claude Haiku）| DiscoSum 叙事原则 | 📋 `/api/portal/briefing` |
| TTS 播放（Web Speech API）| TTS 优化规范 | 📋 |

### P1 — LLM 辅助层（有数据后）

| 功能 | 算法 |
|---|---|
| 地点感知（Geolocation API + 地理围栏）| Schilit & Theimer 1994 |
| Moment Capture 状态整合（energyLevel → 语气）| Barrett Interoception |
| 日历压力感知（高压日历调整语气）| CHI 2025 |
| 动态 MMR 去重（embedding 语义相似度）| Carbonell & Goldstein 1998 |
| 用户反馈收集（跳过/重听）| BPR 输入 |

### P2 — 个性化学习层

| 功能 | 算法 |
|---|---|
| 个人权重向量学习 | BPR（Bayesian Personalized Ranking）|
| 用户打开习惯学习 | 行为时间分布 |
| 跨会话长期记忆 | Perplexity Memory 模式 |
