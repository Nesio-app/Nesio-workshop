# 核心算法审计 findings(2026-07)

> 逐个核心算法的正确性/健壮性审计,给在修的 Agent 用。按「用户可感知影响」排序。
> 已审:Guidance/DEC 管道 · Attention Engine · Dormant Engine。均无数据损坏级硬伤。
> 待审:DEC 深层 · bank-tx(财务)· keyword-lexicon。

---

## Guidance / DEC 管道

**已验证「不是 bug」**:在线学习闭环是通的(`normKey` 双剥让 dec/普通卡两边 key 对得上,
`recordCardFeedback` 原样回派 cardId)。别动。

| # | 严重度 | 文件:行 | 问题 | 修法 |
|---|---|---|---|---|
| G1 | 🟠 MED | `guidance-pipeline.ts:47-52,231-234` | dec_insight 的 `expiresAt` 坏串 → `Invalid Date` → 整卡被当过期**静默丢弃** | `new Date` 后 `isNaN(getTime())?undefined:d`,坏值退化为无过期 |
| G2 | 🟠 MED | `cooling-store.ts:52,79` | `dismissCount` 永不衰减 → 双倍冷却惩罚永久不愈 | 加时间窗(近 14 天)或按天衰减 |
| G3 | 🟡 LOW | `cooling-store.ts:56-68` | `recordShown` 用真实钟,`isOnCooldown` 用注入 `now` → 回放/测试算错 | `recordShown(type,store,now=new Date())` |
| G4 | 🟡 LOW | `guidance-ranker.ts:83`+`pipeline:275` | `rankerScore` 每候选重读一次 localStorage | 循环外 load 一次传入 |
| G5 | 🔵 潜伏 | `guidance-pipeline.ts:39-45` | `event.id` 为空时多实例 dedup 塌缩(id/cardId/pending 一起撞) | dedupKey 兜底加索引;入口断言 id 非空 |
| G6 | 🟡 LOW | `guidance-pipeline.ts:5` vs `192` | 头注「up to 2」实际预算 3 | 改头注 |

## Attention Engine(每日聚焦打分)

| # | 严重度 | 文件:行 | 问题 | 修法 |
|---|---|---|---|---|
| A1 | 🟠 MED | `attention-engine.ts:149` | 明早航班当晚不进「置顶必看」(pinnable 要求 isToday) | pinnable 放宽:今天 或(明天且 <18h 且 always-pinnable) |
| A2 | 🟡 LOW-MED | `attention-engine.ts:72-75` | 今天的过去事件整天停在 urgency 65,不消失,挂折叠区 | 过去事件更快衰减或完成即隐 |
| A3 | 🟡 LOW | `attention-engine.ts:6` vs `88-94` | 头注「Importance×55%+Urgency×45%(加性)」与实现(乘性)矛盾 | 删/改头注为乘性 |
| A4 | 🔵 观察 | `attention-engine.ts:55-61` | 关键词首个命中即赢 → 误分类(「flight review meeting」判成 flight) | 语义分类(见 system-layers Seam 2) |
| A5 | 🔵 健壮 | `attention-engine.ts:68,133-138` | 坏 `start` 日期 → urgency 落 42 / 事件被静默排除 | 埋点计数,别静默 |

## Dormant Engine(休眠复访)

| # | 严重度 | 文件:行 | 问题 | 修法 |
|---|---|---|---|---|
| D1 | 🟠 MED | `dormant-engine.ts:288-289`+`92-98` | 逾期任务入池头 ~7 天复访概率 **0%**(共用为休眠标定的概率表) | overdue 用独立更陡的概率表 |
| D2 | 🟠 MED | `dormant-engine.ts:100-110` | `MIN_PROB=0.15` 盖过低档(0.08 死档)+ ~3 次 snooze 后封顶,压平概率曲线 | 调低 MIN_PROB 或明确它是防饿死地板并删死档 |
| D3 | 🟡 LOW-MED | `dormant-engine.ts:261-268` | 软归档复访每天弹(无 roll、"once only"未实现),与休眠/逾期概率化不一致 | 走一次 roll 或真正做成仅一次 |
| D4 | 🟡 LOW-MED | `today-view-model.ts:252`+`FocusSection.tsx:136` | 无防重出现守卫:休眠节点可**同时**出现在折叠任务列表 + 复访卡 | `taskNodes/focusNodes` 过滤 dormant 状态 |
| D5 | 🔵 增强 | `dormant-engine.ts:288-301` | 选取纯按时间,不看 domain 价值 → 低价值便签与高价值承诺同等对待 | 传入 mirror domain 权重(cross-insight JOIN 2) |
| D6 | 🔵 观察 | `dormant-engine.ts:82-88` | `ageScore` 让越久没碰的 active 任务在聚焦里越沉(重要 active 反被埋) | 复议衰减方向 |

---

## 跨审计的共性模式(值得系统性修)
1. **坏时间戳静默吞数据**:G1(dec expiresAt)、A5(start)——都是坏值 → NaN → 被当过期/排除,无日志。应统一:坏值退化 + 埋点,别静默。
2. **概率/衰减地板压平意图**:D1/D2——floor 与表档、衰减律不自洽。
3. **分类靠关键词的准确度天花板**:A4——见 `system-layers.md` Seam 2(语义分类,离线缓存门控)。
4. **纯时间选取忽略价值**:D5——接 domain 权重即同时提升选取 + 产洞察。

_关联:`system-layers.md`(三层架构)· `personalization-capacity-proposal.md`(统一学习底座)。_
