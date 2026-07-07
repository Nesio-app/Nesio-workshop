# 算法层统一 + 学习层升级 —— A 计划(施工图)

> 状态:**规划 / 施工图**(未实现)。2026-07-07。
> 方向 **A**(已定):把散在各处的临时规则收进**统一算法引擎**(按 health 的"引擎+知识分离"范式铺开)
> + **扩展学习层**(personalization-capacity 三原语),让所有输出卡吃同一套算法+学习栈,而不是各自重算。
> **非** B:决策本身仍规则驱动(见 `future-guidance-engine.md §2.1`、`research/proactive-ai-systems-2025.md §2/§4`
> 的 TGL/PRISM 背书:trigger 决策不需要 ML、误报代价 > 漏报代价)。学习只碰"排多前/什么时候/你的常态偏离",
> 不碰"要不要出、是不是红旗"。
> 关联:`system-layers.md`(三层总览)· `personalization-capacity-proposal.md`(学习底座)· `algorithms-explained.md`(普通人版)。

---

## 0. 当前盘子(2026-07-07 重算,修正旧估)

| 维度 | 数 | 旧估 | 备注 |
|---|---|---|---|
| 输入口 | **21** 真实(+2 桩 +2 死) | ~14 | 旧估混淆了摄入层(21)与展示层适配器(6 个 `*ToGuidanceEvents`) |
| 输出口 | **14**(核心 10 + 次级 4) | ~8 | 仅 2 个(Today、问一问)走统一读出口,12 个旁路 |
| 中间层 | **10**(≈8 算法 + 1 ML + 1 底座) | 3 | 旧估只数了 pipeline/signal/life-graph |
| API 路由 | **82** | 82 | ✅ |
| learner | **6**(严格闭环)/ **11**(文档口径,含基线+衰减) | — | 见 §4 重评 |

---

## 1. 数据 → 走哪一层(21 输入按两源模型分类)

`system-layers.md` Layer 0 的两源模型 = **事件流(push)** vs **状态提供者(pull, 时序)**。据此:

| 类别 | 输入 | 路径 |
|---|---|---|
| **事件流 → Signal 事实(权威)** | 语音、拍照识物、手动录入、心情/日记、会议纪要、通用 ingest、Share、flomo、Notion、微信读书、相册批量 | 离散事件 → `createSignal` / `ingestLifeNode` → Signal 事实表 |
| **状态提供者(pull, 时序)** | 健康(Apple Health)、银行(Plaid)、日历、天气、位置足迹 | 当前值+历史,各自存储,引擎按需拉 |
| **⚠️ 绕过 Signal(3 条,待归位)** | ① 邮件信号(只进 localStorage 缓存)② place-trail(直写 IDB)③ bank/health(直写各自 IDB,只以 finding 露头) | 未进事实表 |

**双路径隐患**:健康/银行既被 ingest 成 Signal/LifeNode,又留在自有 store 给看板读——算法层统一时要理顺"事实流 vs 领域存储"的关系(明确谁是权威、谁是投影/缓存)。

---

## 2. 统一设计:3 层,怎么工作

层数 = **3**(数据/算法/学习,文档已定;A 是把散落实现真收进这 3 层)。

```
输入 →(Signal 事件流 | 状态提供者 pull)
   → Layer 1 算法:各域 声明式 RULES + 共享 evaluate 引擎 → finding
   → Cross-Insight Reader(computeDomainFindings)统一判定
   → Layer 2 学习:排序 / 阈值 / 基线偏离(不碰决策)
   → 所有输出卡(今天焦点 / 未来预测 / 问一问 / 各域 tab)读同一份
```

- **Layer 0 数据**:事件流归 Signal;状态提供者按 pull 时序;3 条 bypass 归位(接回事实流,或明确登记为状态源)。
- **Layer 1 算法(A 主战场)**:见 §3。
- **Layer 2 学习**:见 §4。
- **输出**:14 个输出口收口到统一层(现只 2 个)——尤其修 FinanceTab 的真漂移(见 §3)。

---

## 3. Layer 1:health 范式铺开

**范式** = `health-clinical.ts` 的**引擎 + 知识分离**:声明式 `RULES`(知识,按域)插进通用 `evaluate`(引擎),出 finding → `computeDomainFindings`(Cross-Insight Reader)统一判定 → 输出。

铺开顺序与状态(2026-07-07):
- **通用引擎已抽出**:`lib/portal/domain-rules.ts`(evaluateRules:try/catch 隔离 + 严重度排序)。health-clinical 兑现它"有第二个板块再抽"的注,行为逐字不变(契约装真引擎验证)。
- **财务 ✅**:判定层早已存在(finance-insight,引擎/知识分离精神一致);真漂移已收口(Layer1①,financeAlerts 删除)。**不做 RULES 化翻写**——刚收口且被三面消费,声明式改写是纯搅动。
- **地图 ✅**:新建 `place-insight.ts`(声明式 RULES + 通用引擎):活动范围收窄 / 健身习惯断档。
  **数据诚实红线**:没有足迹 ≠ 没出门(可能没开定位)——每条规则带「追踪存活」门,历史不够冷启动沉默;只出 attention(范围/习惯不是安全风险,红色只给真实风险)。已进 Reader(location 域)+ Today 桥 + 问一问投影。
- **认知 ⏳ 下一块**:先做底料评估——候选:情绪漂移 CUSUM(moment-analytics 已有算法,缺判定层接线)、实验显著性结论(welchTTest)。warm-coach 对情绪域尤其严,评估后再动。

**HealthDashboard 判定(census 建议的纠正)**:它是**明细面,故意渲染全谱**(含 info 达标项绿点,`HealthDashboard.tsx FindingsCard`)——统一层只筛 flag/attention,切过去会丢达标项;且它调的就是 Reader 包裹的同批引擎函数,不可能漂移。**不是旁路,保留**。至此"已建统一层域内的真漂移" 全部收口(Today/问一问/FinanceTab 同读,HealthDashboard=合法明细面)。

---

## 4. Layer 2:两 phase(先统一,后变聪明)+ learner 重评

`personalization-capacity-proposal.md §6` 硬约束:统一时**不统一数学、不推翻现有模型**——只收存储/总线/冷启动。所以拆两 phase:

### Phase 2a —— 统一(不动算法)
统一反馈总线(schema 见 proposal §2)+ 三原语(Preference/Baseline/Recency);**mirror = 规范 Preference Store**(✅ 2026-07-07);**energy = Baseline 原语**(✅ 2026-07-07,轨迹逐字等价、先验 {50,100} 起步);guidance-ranker 权重自存、特征改读规范 store。**评估并掉 card-feedback**(见下)。

**⚠️ 原子记录原则(2a续② 评估产出,修订 proposal §3 的两行)**:cooling 与 dormant **不拆存储**。
- cooling(`nesio-guidance-cooling`):`showCount 当日重置`派生自 `lastShownAt`(cooling-store.ts:57-59),时间戳与计数是一条原子记录,拆进 Recency = 再造双源(本轮已连修三处双源:FinanceTab/restore/mirror,不再新造)。
- dormant(`nesio-dormant-store`):`snoozedUntil`×`snoozeCount` 配对、`archivedAt` 驱动 90 天复活,时钟即生命周期业务态,同理不拆。
- card-feedback 的 `not_now→4h` 同判:`fb.at` 是反馈事实自带的时间戳,拆出去两库存一实。
- **Recency 原语的定位据此收窄**:服务**新增**的时效需求 + 简单独立时钟;既有原子生命周期记录保留原状。

### Phase 2b —— 变聪明(轮到改算法)
证据驱动、逐个上。**重评发现真够格升级的只有 3 个**:

| learner | 现算法 | 更聪明 | 判断 |
|---|---|---|---|
| **guidance-ranker** | 7 维在线逻辑回归 | 加特征(位置/天气/近期连拒)、分情境子模型;**event-sourcing 反馈后可回放重训** | ⭐ 最该升;先要 event-sourced 反馈垫底 |
| **bank 商户** | token 计数投票 | 语义/模糊商户匹配(接已有 embedding 路径),泛化更准 | ⭐ 值得,接现成嵌入 |
| **mirror-profile** | EWMA 逼近目标 | 情境化偏好(按时段/精力/星期条件化) | ⭐ 值得,升级面较小 |
| **card-feedback** | 覆盖 + 类型过滤 | —— | ✅ **已评估(2026-07-07):不并**。`dec.ts:96-102` 的 `useful/too_much→永久压制` 是**卡片生命周期业务态**,ranker(只排序)/cooling(只时间冷却)都无此语义;且 `recordCardFeedback` 是反馈流事件源头。可迁的只有 `not_now→4h` 时间窗 → 归 Recency(2a续② 与 cooling 一起收) |
| **living-model** | 存 userVerified,学在 LLM 端 | LLM-bound,非本地算法 | 不算本地 learner 升级 |
| **analyst** | 中位数/MAD robust + 计数静音 | 季节性/突变检测 | 运维異类,独立轨 |

**结论:"让 learner 更聪明"实际是 3 个目标(ranker/bank/mirror),不是 6 个。**

---

## 5. 落地顺序

| # | 动作 | 层 | 依赖 |
|---|---|---|---|
| 0 | 反馈 event-sourcing 前置(反馈=fact,权重=可回放投影)—— 见 `system-layers.md` #0 与 proposal 的张力,先定 | 0/2 | 前置(2b 回放重训要它) |
| 1 | 统一反馈总线 + 三原语,mirror=规范 Preference,评估并掉 card-feedback | 2a | ①0 定调后 |
| 2 | FinanceTab 漂移收口(financeAlerts→financeFindings) | 1 | 独立可先做 |
| 3 | health 范式铺到财务 → 地图 → 认知,Cross-Insight Reader 扩域 | 1 | ②后 |
| 4 | 3 个 learner 智能升级(ranker 特征+重训 / bank 语义 / mirror 情境化) | 2b | ①0 + ①1 |
| 5 | 全局透明面板 + 统一导出/删除收口 | 2 | 贯穿 |

---

## 6. 对现有文档 / 已落代码的订正

- `system-layers.md`:输入/输出/中间层 stale 数已在本文 §0 修正;learner "11" 是含基线+衰减的口径,严格闭环是 6。
- `personalization-capacity-proposal.md`:**B pilot(#48)已落但偏离蓝图**——落位 `lib/portal/learning/`(应 `lib/platform/personalization/`)、schema `{verdict,cardId}`(应 `{surface,dimension,key,reaction}`)、建了泛型 `createLearnerStore`(应三原语)、且迁了 ranker 存储(proposal 说 ranker 无需迁)。2a 开工时先返工对齐。
- card-feedback 冗余存疑:2a 评估留/并,别给待删项建底座。
