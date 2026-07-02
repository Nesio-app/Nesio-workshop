# Moment Capture — 设计规格 + 算法架构

> 核心哲学：不是记录心情，而是**留住这一刻**。
> 情绪只是那一刻的一个维度。

---

## 一、情绪科学研究基础

### 主流情绪模型对比

| 模型 | 提出者 | 情绪数量 | 结构 | 移动端适用性 |
|---|---|---|---|---|
| Ekman 基本情绪 | Paul Ekman, 1972 | 6 | 离散、普遍、跨文化 | 太少，缺疲惫/感激等日常状态 |
| Plutchik 情绪轮 | Robert Plutchik, 1980 | 8 基础 + 混合 | 锥形轮，强度+相似度 | 中等，缺高频日常状态 |
| **Russell 环状模型** | James Russell, 1980 | 连续维度 | **2D: 效价(正负) × 唤醒(高低)** | **最优，14k+ 引用，4象限框架** |
| Geneva Emotion Wheel | Klaus Scherer, 2005 | 20 | 维度型 | 太多，手机扇区过窄 |
| Cowen et al. | Cowen, 2017 | 27 | 语义空间 | 适合 AI，不适合用户选择 |

### 权威结论：转盘 12 个情绪

**Apple iOS 17 State of Mind（2023）完全采用了 Russell Circumplex 的 2D 框架**——工业界规模最大的验证案例。我们的理论基础选择正确。

**12 = 甜点**：每个 30° 扇区在 300px SVG 上可点击/滑动，覆盖 Russell 4 象限各 3 个情绪，涵盖 Ekman 6 基础情绪 + 6 个最重要日常状态。

### 12 情绪定义（Russell 4象限）

| 象限 | 情绪 | Emoji | 颜色 | 研究依据 |
|---|---|---|---|---|
| 正向高能 (HV-HA) | 开心 | 😄 | #FFD166 | Ekman joy |
| 正向高能 | 兴奋 | 🤩 | #FFB347 | Elation/Excitement |
| 正向高能 | 感动 | 🥰 | #FF8FAB | Moved/Touched |
| 正向低能 (HV-LA) | 平静 | 😌 | #74C69D | Serenity |
| 正向低能 | 满足 | 😊 | #52B788 | Contentment |
| 正向低能 | 感激 | 🤗 | #95D5B2 | Gratitude（Fredrickson：预测主观幸福感最强指标）|
| 负向低能 (LV-LA) | 疲惫 | 😪 | #90CAF9 | Fatigue（hypoarousal）|
| 负向低能 | 空洞 | 😶 | #B0C4DE | Emptiness/Numb |
| 负向低能 | 难过 | 😢 | #7B9CCC | Sadness — Ekman |
| 负向高能 (LV-HA) | 焦虑 | 😰 | #CE93D8 | Anxiety（hyperarousal）|
| 负向高能 | 烦躁 | 😤 | #FF8A65 | Frustration/Irritation |
| 负向高能 | 生气 | 😠 | #EF5350 | Anger — Ekman |

### Russell 2D 坐标（算法用，Posner 2005 标准映射）

```
emotion      valence  arousal
joy          +0.9     +0.4
excited      +0.8     +0.9
moved        +0.6     +0.5
calm         +0.4     -0.6
content      +0.7     -0.3
grateful     +0.6     -0.2
tired        -0.6     -0.8
empty        -0.8     -0.5
sad          -0.7     -0.4
anxious      -0.5     +0.8
frustrated   -0.6     +0.6
angry        -0.7     +0.8
```

### Energy 维度的科学依据

**Interoception 内感受理论**（Barrett, 2017《How Emotions Are Made》）：
情绪由大脑从身体信号主动构建，最基础两个维度是效价（好/坏）和**唤醒度**（高/低）。

**Oura Ring 验证**（Kinnunen et al. 2020）：主观精力自报与客观 HRV 指标相关系数 r=0.6-0.7。无传感器场景下，用户自报 energyValue 是可靠的唤醒度代理。

---

## 二、产品定义：Moment Capture

### 核心目标

> **5 秒完成 Level 1 记录。所有设计围绕这个。**

### 五个维度

| 维度 | 用户操作 | 采集方式 | 数据价值 |
|---|---|---|---|
| Feeling（情绪） | ✅ Level 1 | 12-emotion wheel，滑动 | 情绪基线、模式分析 |
| Energy（精力） | ⚡ Level 2 | 水平拖动把手，蓝→紫→金 | 疲劳预警、健康关联 |
| Thought（一句话） | Optional L3 | 文字输入，AI 提取主题 | Living Model 驱动力层 |
| Journal（展开） | Optional L4 | 长按中心 / L3 展开 | 深度自我觉察 |
| Context（发生什么）| 🤖 自动 | AI 后台推断 + 时间规则 | Analytics 关联分析 |

### 四级记录路径

```
Level 1 (2s):  [情绪转盘] ──────────────────────────── ✓ 自动保存
Level 2 (5s):  [情绪] + [Energy 滑杆 蓝→紫→金] ─────── ✓ 留住这一刻
Level 3 (15s): [情绪] + [Energy] + [一句话] ─────────── ✓ + AI 后台丰富
Level 4 (30s): [情绪] + [Energy] + [Journal 展开] ───── ✓ + 深度写作
```

### 交互流程

```
点击"此刻"
↓
[Level 1] 转盘滑过情绪 → 松手即记录，进入 Level 2
（或：长按转盘中心 500ms → 直接进入 Journal）
↓
[Level 2] Energy 拖动把手（默认中间=紫色）
         ← 😴 没电 ──────●────── ⚡ 充沛 →
         颜色随位置变化（蓝→紫→金）
         点"留住这一刻"保存 / 点"再说一句 →"继续
↓
[Level 3] 思考输入框，动态 Prompt（轮转7条）
         4 秒无输入自动保存
         底部："✍️ 展开为 Journal"
↓
[Level 4/Journal] 全屏写作，轮转 Prompt，保存
```

---

## 三、算法研究综述（2025-07）

### 3.1 算法分层与数据量要求

| 算法 | 最低数据量 | 建议数据量 | 前端可行性 | 阶段 |
|---|---|---|---|---|
| EWMA 精力基线（α=0.15）| 5 条 | 30 条 | ✅ 纯 TS，15 行 | P0 |
| 个人基线标准差（Oura 式）| 10 条 | 30 条 | ✅ 纯 TS | P0 |
| CUSUM 突变检测 | 14 天 | 30 天 | ✅ 纯 TS，20 行 | P0 |
| 规则引擎（50 条）| 1 条 | — | ✅ JSON + 匹配函数 | P0 |
| Russell 情绪距离 | 2 条 | — | ✅ JSON + 公式 | P0 |
| FP-Growth 关联规则 | 30 条 | 100 条 | ⚡ npm: node-fpgrowth | P1 |
| K-means 情绪聚类 | 20 条 | 80 条 | ⚡ npm: ml-kmeans | P1 |
| FFT 周期检测 | 30 天等间距 | 90 天 | ⚡ npm: fft.js | P1 |
| LLM 序列推断（每周 1 次）| 10 条 | 30 条 | ⚡ Claude Haiku API | P1 |
| Changepoint BOCPD | 14 天 | 60 天 | ⚡ 需简化 | P1-P2 |
| Bayesian 因果推断 | 60 条 | 200 条 | ❌ 需后端 | P3 |

> **关键结论**：数据 < 30 天时，精良规则 > 任何 ML 模型。P0 阶段把规则做到极致。

### 3.2 P0 核心算法规格（已实现于 lib/portal/moment-analytics.ts）

#### A. EWMA 精力基线

```typescript
const EWMA_ALPHA = 0.15;
// 新均值 = α × 新值 + (1-α) × 旧均值
// 方差用 Welford online 算法近似
```

#### B. 疲劳评分（Oura 式个人基线比较）

```typescript
fatigueScore = (baseline.mean - currentEWMA) / std(baseline)
// > 1.5 → 轻度预警；> 2.5 → 中度（触发 GuidanceCard）
// 低基线用户（习惯性低能量）不会被误报
```

#### C. CUSUM 情绪突变（Page 1954）

```typescript
sum = max(0, sum + (0 - valence) - slack)
// sum > 4 → 检测到持续负向趋势，每天最多触发一次
```

#### D. Russell 情绪欧氏距离

```typescript
distance(a, b) = sqrt((v_a - v_b)² + (ar_a - ar_b)²)
// 距离 > 1.5 = 大幅情绪跳变，标记为 notable event
```

#### E. Barnes 下午时段规则（Barnes et al. 2012）

```
14:00-16:00 工作日 + energyValue < baseline×0.8
→ "现在可能不是做重要决策的好时机"（轻提示）
```

### 3.3 与 Living Model 的输入映射

| Living Model 层 | 数据输入 | 算法 | 数据门槛 |
|---|---|---|---|
| 预测层 | energyValue 时序 | EWMA + CUSUM | 5 条即可 |
| 模式层 | emotion × context 对 | FP-Growth 关联规则 | 30 条 |
| 演化层 | 模式频率时序 | Changepoint Detection | 60 天 |
| 盲区层 | 统计摘要 + thought | LLM 反事实推理 | 10 条 + API |
| 原则层 | thought 语义簇 | K-means + LLM | 30 条 |
| 驱动力层 | 高频情境×情绪模式 | FP-Growth 高置信规则 | 30 条 |
| 身份认同层 | 全部历史 | 纵向叙事合成 + LLM | 60 天 |

### 3.4 Guidance Engine 触发规则（P0，纯规则引擎）

```
IF 连续 3 天 energyValue < baseline×0.8 AND isWorkHours
→ GuidanceCard: "这几天好像有点累，今天早点休息？"

IF emotion in [anxious, frustrated, angry] 连续 2 天
→ GuidanceCard: "最近感到有压力，要不要回顾一下当前承诺？"

IF 近 30 天 grateful 出现 < 2 次
→ Thought Prompt 注入: "今天最感谢什么？"

IF 前后两次情绪 Russell 距离 > 1.5
→ 标记 notable_event，优先进入 Living Model 分析

IF 连续 5 天无 Moment 记录
→ GuidanceCard: "好久没见你了，最近怎么样？"
```

---

## 四、Journal 功能设计

### 进入路径

**路径 A：长按转盘中心 500ms** → 触觉反馈（vibration API）→ 跳过情绪，直接写
**路径 B：Level 3 → "✍️ 展开为 Journal"** → 全屏写作，情绪+精力已有

### Journal 模式

```
头部：[情绪 emoji 标签] [日期]
轮转 Prompt（6条，不强制）
多行 textarea，无字数限制
[💾 保存这一刻]
```

### Journal 存储结构

```typescript
{
  name: `Journal · ${date} · ${em?.emoji}${em?.label}`,
  type: 'health_state',
  tags: ['moment', 'journal', 'feeling', em.id, em.quadrant, 'energy-high'],
  attributes: {
    isJournal: true,
    journalText: '...',
    energyValue: 72,      // 0-100 连续值
    energyLevel: 'high',  // 派生
    emotion?: '...',
    ...autoContext(),
  }
}
```

---

## 五、竞品差距分析

| 产品 | 情绪记录 | 趋势展示 | 模式挖掘 | 主动认知建模 | 差距方向 |
|---|---|---|---|---|---|
| Daylio | ✅ 基础 | ✅ 基础 | ❌ | ❌ | 反应式，无推断 |
| Bearable | ✅ 详细 | ✅ 详细 | 部分 | ❌ | 医疗向，不够日常 |
| Reflectly | ✅ AI 引导 | ✅ | ❌ | ❌ | AI 问问题，非构建模型 |
| Apple State of Mind | ✅ Russell 框架 | ✅ 月度 | ❌ | ❌ | 只记录展示，无推断 |
| Oura Ring | 🔵 生物指标 | ✅ HRV/睡眠 | ✅ 个人基线 | ❌ | 有传感器，无心理建模 |
| **Nesio** | ✅ 12 Russell | ✅ | ✅ P1 | ✅ **7层认知模型** | **唯一真正构建心理模型** |

---

## 六、实现状态

### P0 — 已完成

| 功能 | 状态 |
|---|---|
| 12 情绪转盘（Russell 象限色彩） | ✅ |
| 滑动手势（touchmove → 自动保存） | ✅ |
| Energy 水平拖动把手（蓝→紫→金） | ✅ |
| 长按转盘中心 500ms → Journal | ✅ |
| Level 3 → 「展开为 Journal」 | ✅ |
| Journal 全屏写作模式 | ✅ |
| 4s 超时自动保存 | ✅ |
| 动态 Thought Prompt（轮转） | ✅ |
| Context Auto-Fill（时间/工作） | ✅ |
| energyValue 0-100 连续值 + LifeNode | ✅ |
| EWMA / CUSUM / Russell 距离算法库 | ✅ `lib/portal/moment-analytics.ts` |

### P1 — 需要 30+ 条数据

| 功能 | 算法 | 实现位置 |
|---|---|---|
| EWMA 精力基线 + 疲劳评分 | Oura / Kinnunen 2020 | `moment-analytics.ts` 扩展 |
| Guidance Engine 50 条规则 | Rule engine | `lib/portal/moment-rules.ts` |
| AI Context Tag（Work/Home/...） | — | `/api/portal/moment-enrich` |
| FP-Growth 情绪×情境关联 | FP-Growth, Han 2000 | npm: node-fpgrowth |
| LLM 序列推断（每周 1 次） | Sparse data best practice | `/api/portal/living-model` |

### P2 — 需要 60 天+ 数据

| 功能 | 算法 |
|---|---|
| K-means 情绪聚类 | — |
| FFT 情绪周期检测 | 傅里叶变换 |
| Changepoint 趋势演化 | BOCPD |

### P3 — 未来（gated）

| 功能 |
|---|
| Bayesian 因果推断（运动→情绪提升）|
| 健康模块相关性接口（HRV 等）|
| Somatic Body Map（内感受定位）|
| 照片/语音记录 |
