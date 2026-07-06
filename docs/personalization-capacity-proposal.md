# Personalization Capacity —— 统一学习底座提案

> 状态:**提案 / 蓝图**(未实现)。给在修的 Agent 当改造地图。
> 目标:把散落全仓的 ~11 处「学习/自适应」收敛到一个共享底座,让**一个反馈训练所有面**、
> 冷启动共享、并有一个统一的「app 学到了关于我什么」出口(隐私/导出/删除也随之收成一处)。

---

## 1. 问题:11 处各学各的

每处都是自己的存储 key、自己的更新律、自己的反馈接线。三种数学并存(SGD / EWMA / MAD /
log-toward-target / 计数),一个「没用」信号只教会其中一个系统。

### 家族 ①:反馈 → 权重(supervised)
| 文件 | 学什么 | 更新律 | 存储 |
|---|---|---|---|
| `lib/portal/mirror-profile.ts` | 每 domain 采纳权重 + hourEngagement | log-toward-target | localStorage |
| `lib/platform/guidance-engine/guidance-ranker.ts` | 引导卡排序 | 在线逻辑回归 SGD | `nesio-guidance-ranker-v1` |
| `lib/portal/analyst.mjs` | 每类预警有用率/静音 | 计数比率 | `analyst_feedback`(Supabase) |
| `lib/life-domain/signal-feedback.ts` | DEC 下轮过滤 | 反馈记录 | localStorage |
| `lib/platform/guidance-engine/cooling-store.ts` | dismiss≥3 → 冷却×2 | 计数阈值 | `nesio-guidance-cooling` |

### 家族 ②:个人基线(unsupervised)
| 文件 | 基线 | 数学 | 存储 |
|---|---|---|---|
| `lib/portal/moment-analytics.ts` + `lib/platform/energy-state.ts` | 精力基线 + 疲劳分 | EWMA α=0.15 | `nesio-energy-baseline-v1` |
| `lib/portal/analyst-baseline.mjs` | 指标水位 | 中位数 + MAD | `analyst_daily` 历史 |
| `lib/platform/fitness-integrator.ts` | HRV 基线对比 | ad-hoc | 派生自 health metrics |

### 家族 ③:时效 / 衰减
| 文件 | 状态 | 存储 |
|---|---|---|
| `lib/platform/guidance-engine/cooling-store.ts` | 冷却计时 | `nesio-guidance-cooling` |
| `lib/platform/dormant-engine.ts` | touch/snooze 时钟 + 休眠天数弹出概率 | DormantStore |

### 反馈信号今天怎么流
`reasoning-engine.recordCardFeedback` → 派发 `nesio-feedback-recorded` → 只有 `useTodayData`
一个监听者接给 guidance-ranker。**其余 surface 各自 addEventListener 各接各的,或根本不接。**

---

## 2. 目标架构:一个 Personalization Capacity,三原语 + 一总线

不把 11 处塞成一个模型(粒度不同会错)。共享的是**存储 + 反馈总线 + 冷启动**,数学可插。

建议落位:`lib/platform/personalization/`

```
personalization/
  feedback-bus.ts       # 统一反馈事件 schema + 单一消费入口
  preference-store.ts   # 原语①:反馈→权重(mirror 升级为规范实现)
  baseline-store.ts     # 原语②:EWMA/鲁棒 个人常态(可插估计器)
  recency-store.ts      # 原语③:时效/衰减
  learned-state.ts      # 「app 学到了什么」聚合(喂面板 + 导出/删除)
  index.ts
```

### 原语 1 · Preference Store
```ts
// 反馈→权重。mirror-profile 升级为它的规范实现;其余变客户端。
recordPreference(dimension: string, key: string, reaction: Reaction): void;
getWeight(dimension: string, key: string): number;      // [0,1],冷启动 0.5
getWeights(dimension: string): Record<string, number>;
```
- `dimension` 例:`'domain'`(mirror)、`'alert_type'`(analyst)、`'card_type'`(cooling/signal)。
- guidance-ranker **保留**(它是特征组合器),但其 domainFit/hourFit 特征**读这个 store**(已经在读 mirror,改成读规范 store 即可)。

### 原语 2 · Baseline Store
```ts
// 学个人常态,今天算偏离。收敛 EWMA/MAD/HRV 三处数学。
foldSample(signal: string, value: number, at?: string): void;
baseline(signal: string): { center: number|null; spread: number|null; z(today: number): number|null; cold: boolean };
```
- 估计器可插:`'ewma'`(energy)、`'robust'`(analyst MAD)。默认 robust。
- attention engine 接进来学「你的正常日历负载」(见 attention 的 Seam 1)。

### 原语 3 · Recency Store
```ts
markSeen(key: string, at?: string): void;
sinceSeen(key: string, now?: Date): number|null;      // ms
cooldownRemaining(key: string, policy: CooldownPolicy, now?: Date): number;
```
- 收敛 cooling-store 冷却 + dormant 的 touch/snooze 时钟。

### 反馈总线
```ts
type Reaction = 'useful' | 'dismiss' | 'wrong' | 'done' | 'snooze' | 'too_much';
interface FeedbackEvent { surface: string; dimension: string; key: string; reaction: Reaction; at: string }
emitFeedback(e: FeedbackEvent): void;   // 各 surface 只调这一个
onFeedback(handler): void;              // 学习层集中消费,分发给三原语
```
统一 schema。今天的 `nesio-feedback-recorded` 是它的前身,升级即可,不推翻。

---

## 3. 每处的适配点(改造清单)

| 现状 surface | 归到 | 改造动作 | 迁移 |
|---|---|---|---|
| mirror-profile domain weights | Preference | **升级为规范实现**,对外暴露 `getWeight/recordPreference` | 保留现 key,加读写垫片 |
| guidance-ranker | 保留 + Preference | 特征改读规范 store;权重仍自存 | 无需迁数据 |
| analyst 反馈静音 | Preference(dimension=`alert_type`) | `summarizeFeedback` 改查 store | analyst_feedback → 灌入 store |
| signal-feedback(DEC) | Preference(dimension=`card_type`) | DEC 过滤查 store | 一次性回填 |
| cooling dismissCount | Preference + Recency | dismiss 自适应查 Preference;冷却计时进 Recency | 拆 store |
| energy-state / moment-analytics | Baseline(estimator=ewma) | 折样/取基线走 baseline-store | 现 key → baseline signal `energy` |
| analyst-baseline | Baseline(estimator=robust) | 直接是它的 robust 实现 | 无 |
| fitness HRV 基线 | Baseline | 走 baseline-store signal `hrv` | 派生,无迁移 |
| dormant touch/snooze | Recency | 时钟走 recency-store | DormantStore 保留业务态 |
| 反馈派发(reasoning-engine 等) | Feedback Bus | 各 surface 改调 `emitFeedback` | 事件名兼容旧 `nesio-feedback-recorded` |

---

## 4. 收益(不是「文件更少」)

1. **一个反馈训练所有面**:健康卡点「没用」→ guidance / attention / analyst / DEC 同时学到。
2. **冷启动共享**:精力基线一处学好,同时喂 guidance 预算 + attention 打分 + 疲劳分。
3. **一个「app 学到了什么」出口**:把 analyst 的「学习状态」面板扩成全局透明页;
   顺带把 local-first 的**导出/删除收成一处**——现在 11 个散落 key,导出和「删除我的数据」都会漏。

---

## 5. 落地顺序(先接线,再收敛,别一次重写)

1. **反馈总线统一**:定 schema + 一个消费者,升级 `nesio-feedback-recorded`。最便宜,立刻「一个信号教所有面」。
2. **mirror = 规范 Preference Store**:cooling/analyst/signal 改成客户端。
3. **Baseline Store** 收敛 EWMA/MAD/HRV;attention engine 接进来(Seam 1)。
4. **Recency Store** 收 cooling + dormant 时钟。
5. **学习状态面板**扩成全局「app 学到了什么」+ 统一导出/删除。

## 6. 非目标 / 边界
- **不统一数学**:逻辑回归、EWMA、MAD、log-toward 各有其用;统一的是存储+总线+冷启动。
- **不推翻现有模型**:guidance-ranker、mirror 的模型保留,只换存储/接线。
- **迁移而非重写**:11 处都有活的持久化态,每步带垫片 + 回填,灰度可回退。
- **隐私**:统一层必须同时统一「导出/删除」——这是 local-first 的硬要求,不是附赠。

---

_关联:`docs/governance/` 治理地图(可见性同思路)· attention engine 的 Seam 1/2/3(AI-behind 提案)· analyst 学习状态面板(全局透明页的雏形)。_
