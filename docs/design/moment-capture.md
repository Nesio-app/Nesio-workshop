# Moment Capture — 设计规格

> 核心哲学：不是记录心情，而是**留住这一刻**。
> 情绪只是那一刻的一个维度。

---

## 研究基础

### 情绪科学权威模型对比

| 模型 | 提出者 | 情绪数量 | 结构 | 适用场景 |
|---|---|---|---|---|
| Ekman 基本情绪 | Paul Ekman, 1972 | 6 | 离散、普遍、跨文化 | 面部表情识别 |
| Plutchik 情绪轮 | Robert Plutchik, 1980 | 8 基础 + 混合 | 锥形轮，强度+相似度 | 心理治疗、当前 MoodSheet |
| Russell 环状模型 | James Russell, 1980 | 连续维度 | 2D: 效价(正负) × 唤醒(高低) | **产品设计最优框架，14k+ 引用** |
| Geneva Emotion Wheel | Klaus Scherer, 2005 | 20 | 维度型，效价 × 力量 | 研究量表 |
| Cowen et al. | Cowen, 2017 | 27 | 语义空间 | AI情绪识别 |

### 结论：转盘应该有多少选项？

**研究共识：8 太少（缺少重要状态如"疲惫""感激"），20 太多（认知负荷过高，手机 30° 扇区太窄）。**

**推荐：12 个情绪，基于 Russell 环状模型按象限分布。**

原因：
1. 12 个选项每个 30°，在 300px SVG 上足够手指点击/滑动
2. 覆盖所有 4 个情绪象限（正向高能/正向低能/负向低能/负向高能）
3. 涵盖 Ekman 6 基础情绪 + 最重要的 6 个日常状态（疲惫、满足、感激、空洞、兴奋、烦躁）
4. 跨文化验证充分

### 12 情绪定义（Russell 4象限分布）

| 象限 | 情绪 | Emoji | 颜色 | 心理学依据 |
|---|---|---|---|---|
| 正向高能 (HV-HA) | 开心 | 😄 | #FFD166 | Ekman joy |
| 正向高能 | 兴奋 | 🤩 | #FFB347 | Elation/Excitement |
| 正向高能 | 感动 | 🥰 | #FF8FAB | Moved/Touched |
| 正向低能 (HV-LA) | 平静 | 😌 | #74C69D | Serenity |
| 正向低能 | 满足 | 😊 | #52B788 | Contentment |
| 正向低能 | 感激 | 🤗 | #95D5B2 | Gratitude（高预测幸福感的关键指标）|
| 负向低能 (LV-LA) | 疲惫 | 😪 | #90CAF9 | Fatigue |
| 负向低能 | 空洞 | 😶 | #B0C4DE | Emptiness/Numb |
| 负向低能 | 难过 | 😢 | #7B9CCC | Sadness - Ekman |
| 负向高能 (LV-HA) | 焦虑 | 😰 | #CE93D8 | Anxiety |
| 负向高能 | 烦躁 | 😤 | #FF8A65 | Frustration/Irritation |
| 负向高能 | 生气 | 😠 | #EF5350 | Anger - Ekman |

### 身体感知与情绪的联系（Interoception 研究）

- 情绪不是单纯的心理事件，而是从身体感觉中被**构建**（Lisa Feldman Barrett，2017 《How Emotions Are Made》）
- 内感受（interoception）= 大脑对身体内部状态的感知，是情绪的基础
- 应用：Energy 维度（⚡ 高/中/低）比"精力"更接近真实的身体感知
- 未来：可选"身体在哪里感受到" body map（层 3+ 交互，非 P0）

---

## 产品定义：Moment Capture

### 核心目标

> **5 秒完成一次记录。所有设计围绕这个。**

### 五个维度

| 维度 | 必须 | 说明 |
|---|---|---|
| Feeling（感觉） | ✅ Level 1 | 12-emotion wheel，滑动选择 |
| Energy（精力） | ⚡ Level 2 | ⚡⚡⚡高 / ⚡⚡中 / ⚡低，默认中 |
| Focus（专注） | 未来 | 暂缓，P2 |
| Moment（此刻发生） | 🤖 自动 | 后台 AI Context Tag |
| Thought（一句话） | Optional | 3秒无输入自动关闭 |

### 四级记录路径

| 级别 | 时长 | 触发 | 内容 |
|---|---|---|---|
| Level 1 | 2s | 滑动选情绪 → 松手 | 情绪（自动保存） |
| Level 2 | 5s | Level 1 完成 → 自动弹出 | + 精力滑杆 |
| Level 3 | 15s | 用户主动输入 | + 一句话 |
| Level 4 | 30s | 未来 | + 照片/语音 |

### 交互流程（Level 1 Path）

```
用户点击"此刻"按钮
→ 弹出 Moment Capture Sheet
→ 展示 12-emotion 转盘
→ 手指在扇区上滑动 → 扇区高亮
→ 松手 → 该情绪选中
→ 自动记录（无需点击保存）
→ 精力选项自动弹出（Level 2，可直接关闭）
→ 思考提示出现（动态文案，3s 超时自动关闭）
→ 成功状态：🌟 "留住了这一刻"
```

### 后台自动补全（Context Auto-Fill）

系统自动记录以下内容，用户不用输入：

```
时间         → createdAt (ISO)
工作时间     → 09:00-18:00 weekdays
是否晚间     → after 22:00
日历状态     → 会议刚结束 / 旅行中 / 运动后
天气         → 调用 weather API（已有）
Context Tag  → AI 自动分类: Work/Home/Travel/Learning/Health/Family
```

### Context-Triggered Prompts（AI 判断何时弹）

不是随机。基于行为触发：

| 触发条件 | 弹出文案 |
|---|---|
| 连续工作 4h（日历判断）| "工作了好一会儿，现在感觉怎么样？" |
| 运动记录后（健康数据/日历）| "练完了，身体感觉如何？" |
| 旅行结束（日历/位置变化）| "今天印象最深的是什么？" |
| 重要截止日完成 | "完成了，此刻什么感觉？" |
| 晚间 21:00-22:00 | "今天最值得记住的一件事？" |
| 生日/纪念日当天 | "今天心情怎么样？" |

每日最多触发 1 次 prompt（避免骚扰）。

### 动态 Thought Prompt（占位文字）

输入框占位文字每次随机，来自轮转队列：

```
今天最开心的一件事？
今天最感谢什么？
今天什么最消耗你？
今天发现了什么？
一句话描述此刻。
此刻你想对自己说什么？
今天最让你意外的是？
```

### AI 自动生成 Memory

用户输入情绪 + 一句话后，AI 后台推断：

```
用户输入:  😄 开心  "今天终于完成了 Blueprint"
↓
AI 推断:
  emotion: joy
  topic: Blueprint
  category: Growth  
  context: Work/Project
  significance: achievement
↓
自动创建 LifeNode:
  type: health_state
  tags: [mood, joy, work, growth, achievement]
  attributes: { emotion, energy, thought, context, auto_topic, auto_category }
```

### 与 Living Model 的连接

Moment Capture 数据是 Living Model 最高质量的输入：

- **模式层**：焦虑→整理，开心→运动后，空洞→深夜工作
- **驱动力层**：开心来自成长 vs 娱乐 vs 关系
- **预测层**：连续焦虑 3 天 → 提醒注意休息

---

## 文案设计

### 按钮文案（替换"转盘点一个感受"）

| 场景 | 旧文案 | 新文案 |
|---|---|---|
| 触发按钮 | 此刻 | 此刻（保持，简洁） |
| 保存按钮（未选）| 转盘点一个感受 | 滑过一种感觉… |
| 保存按钮（已选）| 记住这刻 ✦ | 留住这一刻 |
| 成功状态 | 已记下这一刻 | 留住了这一刻 |
| 思考输入框 | 一个词也好… | [动态 prompt，轮转] |

---

## 实现状态

| 功能 | 状态 |
|---|---|
| 8-emotion 转盘 | ✅ 已实现（Plutchik）|
| 扩展到 12 情绪（Russell 象限）| 🚧 P0 |
| Energy 滑杆 | 🚧 P0 |
| 滑动选择手势（touchmove）| 🚧 P0 |
| 自动保存（Level 1 无需按钮）| 🚧 P0 |
| 3s 超时自动关闭思考输入 | 🚧 P0 |
| 动态 Thought Prompt（轮转占位）| 🚧 P0 |
| 更新按钮文案 | 🚧 P0 |
| Context Auto-Fill (time/work) | 🚧 P0 |
| AI Context Tag（后台分类）| 📋 P1 |
| Context-Triggered Prompts | 📋 P1（需 guidance engine 接入）|
| AI Memory 自动生成 | 📋 P1 |
| Body Map / Somatic layer | 📋 P3 |
| 照片/语音（Level 4）| 📋 P3 |
