# 系统分层架构:数据层 · 算法层 · 学习层

> 工程向。`docs/algorithms-explained.md` 是给普通人看的("会学/大模型/固定规则"三分),这份是给
> 工程/在修 Agent 看的**数据→算法→学习**分层,并把 2026-07 这轮跨域洞察 + 统一学习底座的研究填进来。
> 状态标注:✅ 已实现 · 🟡 部分 · ⏳ 提议(本轮研究) · ❌ 缺。以 `STATE.md` / 代码为准。

---

## Layer 0 · 数据层(Data)

数据有**两种源**,不是一种——这点很关键,大量最有价值的数据是 API/时序型,不走行为 signal。

| 源类型 | 例子 | 形态 | 状态 |
|---|---|---|---|
| **事件流**(push) | 卡片展示/忽略、心情、问一问、到访、反馈 | append-only | 🟡 |
| **状态提供者**(pull) | 健康时序、银行流水、日历、天气、位置、记忆图 | 当前值+历史 | ✅ 各自存在 |

**事实库(event-sourcing)—— PRD 早定,已 cutover(不是缺失)**
`STATE.md`:`Signal 主事实表(IDB)= 权威源,LifeGraph = 可重建投影`,2026-07-04 CEO Gate 批准 cutover;
`rebuildLifeGraphFromSignals` 可整体重建投影。✅ 这是标准 event-sourcing 地基,已完成。

**两个缺件(本轮识别):**
1. **⏳ Daily snapshot journal**:天气/当前位置/日历等是 live/易逝的,取完即弃。想学「下雨天打车支出↑」
   这类跨域相关,**必须当天把上下文采样落盘**——没记就永远学不出。雏形:`analyst_daily`、`place-trail`;
   缺的是统一的「每日上下文横切」journal。
2. **❌ 学习反馈没进事实库**:见 Layer 2。事实库现在只装**内容 Signal**,不装**学习反馈**。

**隐私(硬约束)**:全部 local-first(place-trail 已是)。统一层的**导出/删除必须覆盖 journal + 学习态**——
现在散落 10+ 个 key 时最容易漏,收进来反而是把隐私边界收成一处的机会。

---

## Layer 1 · 算法层(Algorithm — 确定性引擎)

不学习。吃数据层,产候选/分/洞察;学习层只调它们的排序与阈值。

| 引擎 | 职责 | 文件 | 状态 |
|---|---|---|---|
| Attention Engine | 每日聚焦打分(Importance×Urgency,乘性) | `attention-engine.ts` | ✅(见审计 findings) |
| Guidance Pipeline | 7 层:事件→窗口→可行→后果→打断→预算→冷却→去重 | `guidance-engine/*` | ✅ |
| Dormant Engine | 休眠复访选取 | `dormant-engine.ts` | ✅ |
| DEC | 跨域推理中心(belongs to no domain) | `intelligence/dec.ts` | 🟡 |
| **Cross-Insight Reader** | 跨「数据×学习态」三层 JOIN → 洞察 | — | ⏳ 本轮提议 |

**Cross-Insight 是本轮新增的算法层构件**:现有 `personalization-insights.ts` / living-model 只吃**原始节点图**,
完全不读学习器的**蒸馏结果**(基线/权重/拒绝模式)。洞察的富矿在**跨层 JOIN**里,分三层:

- **内容×内容**(DEC 本该做,缺具体相关):财务×日历、邮件×日历。
- **内容×学习态**(全新):健康 sleep→energy 基线、域权重×休眠任务。
- **学习态×学习态**:域×时段交互、碎片拒绝信号聚合。
- 三元组最强:`位置[在健身房附近] × 天气/受纳时段 × 内容[健身目标休眠]→现在推`。

---

## Layer 2 · 机器学习/学习层(Learning)

### 现状:11 个散落学习器,大多"折权重即弃"
三家族:**反馈→权重**(guidance-ranker / mirror / analyst / signal-feedback / cooling)、
**个人基线**(energy-EWMA / analyst-MAD / fitness-HRV)、**时效衰减**(cooling / dormant)。

> **口径注(2026-07-07)**:"11" 是含基线+衰减的宽口径;若按"反馈→更新持久态→有读出口"严格闭环,
> 是 **6** 个(ranker / mirror / bank 商户 / card-feedback / living-model / analyst)。重评发现真够格
> "变聪明"的只有 3 个(ranker / bank / mirror);card-feedback 疑似与 ranker+cooling 冗余;
> living-model 是 LLM-bound;analyst 是运维異类。详见 `algorithm-layer-plan.md §4`。
> **B pilot(#48)已落但偏离本蓝图**(落位/schema/原语/多迁了 ranker 存储),返工点见 plan §6。

**关键问题(本轮审计):变聪明的知识大多没被采集。**
guidance-ranker `learnInto` 折进权重后 `delete pending`;cooling 只留计数;energy 只留 EWMA 均值/方差——
**原始反馈用完即弃,只剩压缩权重,且几乎全在会蒸发的 localStorage。** 唯一可回放的是 `signal-feedback`(有界+云)
和 `analyst_feedback/analyst_daily`。后果:**不可重训 / 易碎 / 不可迁移 / 不可审计。**

### PRD 定位(Layer 7)与 doc 对账
`future-guidance-engine.md §17` 定义 Layer 7 学习(逐步实现)。**批次 52 的 `guidance-ranker`(在线逻辑回归学
点击/反馈)已实现 Completion/Click Learning**——该文档原标 ⏳ 已过时,本次一并订正。

### 目标架构(本轮研究)
1. **统一 Personalization Capacity**:三原语 **Baseline / Preference / Recency** + 一个 Cross-Insight Reader。
   不是"一个大模型"——基线/排序/衰减是不同 estimand,硬塞是类别错误。
2. **Event-sourcing 反馈(前置必做)**:把反馈接进**已存在**的 Signal 事实库——反馈=一条 fact,
   学习器权重=可回放**投影**(和 LifeGraph 是 Signal 投影同一模式)。**collect first, derive second。**
   复用已 cutover 的基础设施,不绿地新建。
3. **输入 = 事件流 + 状态提供者 + snapshot journal**,不是"只从 signal 学"。
4. **11 学习器 → 薄 head**:每个域从 bespoke 系统降为「在某原语上注册信号+消费口」的声明式配置。
5. **何时上共享表征(真"一个模型")**:成对 JOIN 抓不住高阶交互、且愿用解释性/local-first 换时,
   在**同一条流**上加 embedding + 任务头——证据驱动的后期可选进化,不是 day-1 重写。
6. **透明**:`analyst` 学习状态面板是雏形,扩成全局「app 学到了什么」+ 统一导出/删除。

---

## 三层如何咬合(闭环)

```
数据层(事实库 + 状态提供者 + snapshot journal)
   │  提供 signals / 时序 / 上下文
   ▼
算法层(attention / guidance / dormant / DEC / cross-insight) —— 确定性候选·分·洞察
   │  候选 + 特征
   ▼
学习层(3 原语:baseline/preference/recency) —— 个性化排序·阈值·基线偏离
   │  展示 → 用户反馈
   └──────────────►  反馈作为 fact 写回数据层事实库(event-sourcing)——闭环
```

**当前断点**:最后那根箭头没接——反馈没回写事实库,而是折进 localStorage 权重丢弃。补上它是整个闭环能否
持久/可迁移的前提。

---

## 落地顺序(前置 → 后续)

| # | 动作 | 为什么在这个位置 |
|---|---|---|
| 0 | **反馈进事实库(event-sourcing)** | 前置。没有可回放日志,后面统一/迁移/审计都做不了 |
| 1 | Daily snapshot journal(采样易逝上下文) | 跨域相关的燃料 |
| 2 | 统一底座三原语(mirror 当规范 Preference) | 收敛散落学习器的存储/更新 |
| 3 | Cross-Insight Reader(三层 JOIN) | 富矿洞察,坐在①②之上 |
| 4 | 11 学习器 → 薄 head 迁移 | 有①才迁得动 |
| 5 | 全局透明面板 + 统一导出/删除 | 信任 + 隐私收口 |

---

## 状态对账(doc ⇄ code,2026-07)

| 能力 | 状态 | 依据 |
|---|---|---|
| Signal 主事实表 / 投影重建 | ✅ | `STATE.md`(cutover 2026-07-04) |
| guidance-ranker(点击/完成学习) | ✅ | 批次 52;`future-guidance-engine.md` 原标 ⏳ 已订正 |
| energy/mirror/cooling/dormant 自适应 | ✅ 各自实现(localStorage) | 代码 |
| 反馈 event-sourcing(反馈=fact) | ❌ | 本轮审计 |
| Daily snapshot journal(统一) | 🟡 部分(analyst_daily / place-trail) | 代码 |
| 统一 Capacity / 三原语 | ⏳ 提议 | `personalization-capacity-proposal.md` |
| Cross-Insight Reader(三层 JOIN) | ⏳ 提议 | 本文档 |

_关联:`algorithm-layer-plan.md`(A 施工图:输入→层映射 / health 范式铺开 / learner 重评 / 落地顺序)·
`personalization-capacity-proposal.md`(学习底座迁移蓝图)· `future-guidance-engine.md`(guidance 七层)·
`algorithms-explained.md`(普通人版)· `governance/`(可见性同思路)。_

## 当前盘子(2026-07-07 重算)

21 输入 · 14 输出(仅 2 走统一读出口)· 10 中间层(≈8 算法 + 1 ML + 1 底座)· 82 API · learner 6 严格 / 11 宽口径。
详见 `algorithm-layer-plan.md §0-§1`(含 21 输入按事件流/状态提供者/绕过 三类的逐条归层)。
