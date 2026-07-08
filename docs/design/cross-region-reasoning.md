# 跨区推理与学习 · 完整设计规格

> 状态:**提案 / 可建规格**(未实现)。把 2026-07 的研究(见文末引用)落成含**计划 / 架构 / 算法 / 模型 / 参数**的一份东西,给在修的 Agent 照着建。
> 参数均为**起点值**,标了依据,上线后按数据调。
> 关联:`system-layers.md`(三层)· `personalization-capacity-proposal.md`(统一底座)· `algorithm-review-findings.md`。

---

## 0. 设计原则(一句话)

不枚举「域对」,把所有源统一进一个事实空间;**检测=统计(防编造相关)、偏好=contextual bandit(可解释、带探索)、训练=point-in-time 的 event-sourcing**。单用户 → 不需要 DP 加噪、不吃跨用户 CF/embedding。

---

## 1. 架构(5 层 + 数据流)

```
┌─ 投递层    软频控 + 可打断性(NB:位置+移动+时段)· 价值感知预算
│  ▲ 排序分
├─ 偏好层    Contextual Bandit(LinUCB)· 特征=跨区洞察特征 + 反馈
│  ▲ 候选(已通过门)
├─ 门控层    BH-FDR 多重检验 · ADF/KPSS 平稳性 · 同意(sensitivity)· 置信 · 新鲜度
│  ▲ 候选关系(N 元)
├─ 检测层    通用关系算子:共现 / 相关(Spearman)/ 实体链接 / 先后(PCMCI)/ 矛盾  —— 纯统计,无 ML
│  ▲ 读
└─ 数据层    事实库(IDB event-sourced,权威)+ 每日快照 journal + API 提供者
             point-in-time:每条 fact 带 occurredAt + recordedAt(生效时刻)
   ▼ 反馈作为 fact 回写 —— event-sourcing 闭环,支撑无泄漏重训
```

**组件接口(草案)**
```ts
// 检测层:通用算子,输入两/多个对齐信号序列,输出候选关系 + 原始统计量
type Relation = { kind:'cooccur'|'corr'|'entity'|'leadlag'|'contradict';
  signals:string[]; strength:number; pValue?:number; lag?:number; evidence:FactRef[] };
detectRelations(space: FactSpace, now: Date): Relation[];

// 门控层:一批候选一起过(多重检验必须批量)
gate(cands: Relation[], consent: ConsentMap): Relation[];   // 返回存活的

// 偏好层:bandit 打分 + 学习
scoreInsight(feats: number[], model: BanditState): number;  // UCB 分
updateBandit(feats: number[], reward: 0|1, model: BanditState): void;

// 投递层
deliverable(scored: ScoredInsight[], ctx: InterruptCtx): ScoredInsight[];
```

---

## 2. 算法(逐组件)

### 2.1 检测层(统计,不用 ML)
- **共现**:两信号事件落在同一窗口 W。
- **相关**:对齐成**每日序列** → 先 **ADF 平稳性检验**,非平稳则一阶差分后重测 → **Spearman ρ**(抗非正态/单调即可)。要求样本 N≥14、|ρ|≥0.3、通过门控的 p。
- **实体链接**:同一 entityRef(人/地 id),确定性,无需统计。
- **先后/因果提示**:**PCMCI**(tigramite),τ_max=7 天,α_pc=0.05,图级 FDR。产「A 领先 B」候选。
- **矛盾**:规则式——A 断言某实体/时间的值,B 否定(如「邮件有账单」vs「日历无此项」)。

### 2.2 门控层(通用门,替代 per-pair policy)
1. **多重检验**:一次运行的所有候选 p 值**一起**做 **Benjamini-Hochberg FDR**(q=0.10)。绝不逐对看 0.05。
2. **平稳性**:相关/因果类候选,底层序列须过 ADF(p<0.05);KPSS 互补。
3. **最小证据**:N≥14 天(时序)/ N≥5 次(计数)否则判 cold,不出。
4. **同意**:sensitivity∈{health,finance,location} 的跨区须有 consent 标记,否则丢弃。
5. **新鲜度/去重**:同一关系 14 天内不重复出,除非强度变化 >1 个量级。

### 2.3 偏好层(Contextual Bandit)
- **LinUCB**:每条候选特征向量 x → 分 = θᵀx + α·√(xᵀA⁻¹x)(利用 + 探索)。
- 特征 x:[关系类型 one-hot,strength/|ρ|,涉及域,recency,confidence,hourFit,domainFit]。
- **奖励**:useful=1;dismiss/wrong=0(展示未反馈=不更新,或作弱负例,见参数)。
- **冷启动**:θ 初值 = 手设先验(重要域/高置信起步高),复刻「冷启动=旧公式,第一天不更差」。
- 更新:A ← A + xxᵀ;b ← b + reward·x;θ = A⁻¹b(岭回归 λ)。

### 2.4 投递层
- **软频控**:score ×= exp(−recentShows/τ)(渐变抑制,非硬砍)。
- **可打断性**:每用户 **Naïve Bayes** P(受纳 | 位置簇, 移动态, 时段)。非 critical 洞察须 P≥0.5 才出。
- **价值感知预算**:critical 永远出;其余按 P(受纳)×软频控×bandit 分排序取前 K。**预算不看「日历忙不忙」**(修 findings 里那条治反了的)。

### 2.5 基线(检测偏离用)
- **鲁棒**:median + MAD,σ=1.4826·MAD,|z|≥3 判异常,N≥10(与 analyst 一致)。
- **连续/精力类**:EWMA α=0.15。

---

## 3. 模型选型(都轻、可解释、端上)

| 用途 | 模型 | 为什么不是别的 |
|---|---|---|
| 关系检测 | Spearman + ADF/KPSS + PCMCI | 统计防编造;ML 会从少数据学伪相关→上线崩 |
| 偏好排序 | **LinUCB**(线性 contextual bandit) | 可解释、带探索(能试探新洞察类)、端上便宜;比纯在线逻辑回归多「探索」 |
| 可打断性 | Naïve Bayes | 极轻、每用户可训、可解释 |
| 异常/基线 | 中位数+MAD / EWMA | 鲁棒、无需训练 |
| 共享表征 | (远期)对比学习解耦「域不变/域特有」 | 重训练管线;单用户无 CF,收益不确定,证据驱动才上 |

**不用**:深度网络、跨用户 CF、DP 加噪(单用户不需要)。

---

## 4. 参数(起点值,带依据)

| 参数 | 值 | 依据 |
|---|---|---|
| 相关最小样本 N | 14 天 | 两周足够过 ADF + 稳定 ρ |
| 相关效应量门 | \|ρ\| ≥ 0.3 | 弱于此对个人无行动价值 |
| 多重检验 FDR q | 0.10 | 洞察容忍度高于科研,但控假阳 |
| ADF 显著性 | p < 0.05 | 标准 |
| PCMCI τ_max / α_pc | 7 天 / 0.05 | 日级滞后 1 周;标准 α |
| 基线异常阈 | \|z\| ≥ 3σ (MAD) | 与 analyst 一致 |
| 基线最小样本 | 10 天 | 与 analyst 一致 |
| Bandit 探索 α | 0.3 | 中等探索,避免过度打扰 |
| Bandit 岭 λ | 1.0 | 标准正则 |
| 软频控 τ | 3 | ~3 次近期展示后显著衰减 |
| 可打断性阈 | P(受纳) ≥ 0.5 | 非 critical 的门 |
| 关系去重冷却 | 14 天 | 同一洞察不刷屏 |
| 每日投递上限 K | 3(critical 不计入) | 反疲劳;软预算而非硬砍 |
| 同意必需域 | health/finance/location | 高敏感 |

---

## 5. 设计计划(分阶段,前置在先)

| 阶段 | 交付 | 依赖 | 说明 |
|---|---|---|---|
| **P0** | 反馈进事实库(event-sourcing)+ 每日快照 journal | 复用已 cutover 的 Signal 事实库 | 地基。没它后面全空转;不做 as-of join → AUC 虚高 5-20% |
| **P1** ✅已实现(2026-07-08) | 检测层:Spearman + DF 平稳性 + 共现 + BH-FDR | P0 的 journal | **纯统计,零 ML**。`lib/platform/cross-region/detect-core.mjs`(引擎,单测 `cross-region-detect.test.mjs`)+ `detect.ts`(列元数据/接线)→ 洞察 tab `CrossRegionCard`。只配跨域列、\|ρ\|≥0.3、N≥14、非平稳先一阶差分、批量 BH-FDR(q=0.10);每条带样本天数 + p 值可复核。PCMCI 先后/因果推迟到 P1.5 |
| **P2** ✅已实现(2026-07-08) | 门控 + 投递:同意门 + 软频控 + 可打断性 NB | P1 | 让洞察"该出才出、不刷屏"。同意门 `cross-region/consent.ts`(敏感域默认不主动推)+ 可打断性 NB `interruptibility-core.mjs`/`interruptibility.ts`(从 today 反馈学 P(受纳))+ 新鲜度去重/预算 `deliver-core.mjs` + 编排 `deliver.ts` → `crossRegionToGuidanceEvents` 进既有七层管线(软频控/时段门/预算细排复用)。单测 `cross-region-deliver.test.mjs` |
| **P3** | 偏好层:LinUCB bandit + 反馈闭环 | P0 反馈日志 | 学"你在乎哪类跨区" |
| **P4** | (远期可选)共享 embedding | 有证据说手写特征触顶 | 拿解释性换,加法不推倒 |

**里程碑判据**:P1 出的相关必须能人工复核(带证据+p 值);P3 上线前用 point-in-time 回放做离线评估(as-of join,防泄漏)。

---

## 6. 取舍与风险

- **门的质量是生死线**:FDR/平稳性/剪枝弱一点就是噪声洪水。宁可漏报不可乱报(个人助理错一次伤信任)。
- **单用户红利**:免 DP、免 CF、免重 embedding → 该更轻更可解释,别抄多用户 CDR 论文的重架构。
- **隐私面变大**:跨 health×finance×location,**同意门必须一等公民**,统一导出/删除覆盖 journal + 反馈日志。
- **PCMCI 偏重**:P1 可先只上「相关 + 共现 + 实体链接」,先后/因果留 P1.5。
  - **P1.5 ✅已实现(2026-07-08)**:未上完整 PCMCI(tigramite 的条件独立检验在端上单用户日级数据不可行、收益存疑),改用**滞后互相关 lead-lag**(`detectLeadLag`,单测 `cross-region-leadlag.test.mjs`):先平稳化 → 扫滞后 1..τ_max 的 Spearman → **滞后关联须显著强于同期**(lagDominanceMargin,PCMCI 条件化的务实替身,挡同期相关拖影)→ 批量 BH-FDR。产出「先后线索」,`CrossRegionCard` 第二区块渲染,文案明示**先后≠因果**。真 PCMCI(多变量条件独立)若日后有证据触顶再上。
- **冷启动**:前 2 周多数信号 cold,系统应诚实说「还在学你的水位」,不硬造洞察。

---

## 引用(2026-07 研究)
- 多重检验/伪相关:Certisured《Spurious Correlation》· Airbyte · Genome Biology 2025(强内相关下的假发现)
- 时序:Medium/Causality《Causal Discovery with MTS》· PCMCI/tigramite(arXiv 2507.12257)
- Point-in-time:eventsourcing.ai《Ensuring PIT Correctness》· apxml《PIT for Training Data》(未做 as-of join → AUC 虚高 5-20%)
- Bandit/端上:企业级 contextual bandit(USPTO 11797891)· LTR bandit(arXiv 2004.13106)· FOLtR(SIGIR 2021)
- 投递:Soft Frequency Capping(Yahoo Gemini, CIKM 2019, +7.3%)· 可打断性(How Busy Are You)· Intelligent Notif Survey(arXiv 1711.10171)· User Fatigue(arXiv 2405.11764)
- 隐私:Apple《Learning with Privacy at Scale》(LDP 为跨用户聚合;单用户不需要)
- 跨域融合(远期):CDR Survey(arXiv 2503.14110)· LLM-EMF(arXiv 2506.17966)
