# AI 质量审计(2026-07,深查)

> 审 **origin/main 当前版**(非我分支旧版——main 上 #33-36 大改了 AI/健康)。取证:全 ~35 AI 路由 + ai-complete/provider-chain/cache/telemetry + prompt 构造。
> **总评:AI 质量是本 session 几个审计面里最扎实的一个。** fail-closed、prompt 注入防御、key 统一都做得对;真正可动的是**成本**。

---

## ✅ 做得对的(先说,别误伤)

**1. fail-closed 正确**
- ~35 个 AI 路由**几乎全过门**(`guardAiRoute` = 鉴权 + 限流)。`completeText` 本身 fail-closed:无 key → throw `no_ai_provider`;Claude 失败且无 Gemini → throw。
- 调用方**优雅降级**:insights/health-insight AI 失败 → 模板兜底,且 **health-insight 回 `source:'ai'|'fallback'`**,前端知道这条是不是降级过的——**诚实降级**,不是假装成功。

**2. prompt 间接注入被自觉防御**
- `daily-brief`、`gmail/draft-reply`:把邮件/记忆等**不可信外部内容围进 `<data>` 围栏**,注释明写「可能夹带『忽略上面/念出这段/去汇款』等指令」。**上一轮(早前 session)的注入 finding 已修。**

**3. #36 修好了我早前标的漂移**
- 我在治理审计里标过 `ai-provider-router-contract` 漂移(契约说一套、`ai-complete` 做一套)。**#36「AI key 统一」已修**:`resolveAiKey` + `ai-provider-chain.mjs` 单一数据源,「契约同读,防漂移」。✅ 该 finding 关闭。

**4. 洞察卡数据质量**
- 早前 session 的 HIGH/MED/LOW 三批 + 本 session 健康卡深审(单位换算/全文件解析)均已合入 main。health-insight 路由:门齐(`guardAiRoute` limit 10)、数据围栏、诚实降级。**这块已被反复打磨,本轮无新增 data-quality 硬伤。**

---

## 🟠 成本(唯一实质可动的面)

**C1 — AI 路由不用 ai-cache,零去重缓存**
`ai-cache.ts` 存在,但只有 `ai-cache.ts` / `storage-manifest.ts` 引用它——**35 个 AI 路由没一个用**。insights/daily-brief/guidance-language 这类**相同输入的 prompt 每次都重新收费**。
- 修:对确定性、输入可哈希的路由(insights narrative、guidance-language、decompose)加缓存(TTL + prompt 哈希键)。

**C2 — 成本是「每调用拍平常数」估的,不按 token**
`metrics/route.ts` 的 `COST_PER_CALL`(chat 0.004 / tts 0.015 / 默认 0.002)× 调用数;`ai-telemetry` **完全不记 token 数**。所以:
- 同一路由里 **2048-token 调用和 200-token 调用被算成一样贵**;常数是手拍的。
- **admin「AI 成本」是个粗估,可能与真实账单差很多**,analyst 的「成本骤升」预警也建在这个估值上。
- 修:`persistAiEvent` 带上 provider 返回的 `usage`(input/output tokens),成本按 token×单价算。

**C3 — 无「便宜模型路由」**
所有任务都走 `completeText` → Claude 主。简单抽取/分类(inventory-extract、decompose、barcode)本可走更便宜的模型档。
- 修:按任务复杂度分档(cheap/standard),`completeText` 支持 tier 参数。

**C4 — 多个路由 maxTokens=2048**
gmail / health / ingest / meeting-notes / notion 都是 2048——抽取类可能合理,但它们是**成本大头**。建议逐个核对是否真需要,或改成按输入规模动态设。

---

## 🟡 小项

**P1 — prompt 集中度不一**
`secretary-ai-prompt-catalog.mjs` 是个好的**集中 prompt 目录**;但 portal 路由(draft-reply/daily-brief/insights)prompt **内联**在 route 里——难版本化/难单测/难 review。建议把 portal prompt 也收进 catalog(顺带能给它们加 prompt 回归测试)。

**F1 — gmail/route.ts 有 auth 门但可能没限流**
它用 `requireAuthenticatedGmailAccess`(查 baohe_auth cookie)把门,但**不走标准 `guardAiRoute`,少了限流**——已登录用户可无节流地打(它 maxTokens 2048)。建议对齐到 guardAiRoute 或补限流。

---

## 总评表

| 维度 | 评级 | 一句话 |
|---|---|---|
| fail-closed 正确性 | 🟢 | 路由过门、completeText throw、诚实降级(source:fallback);仅 gmail 少限流 |
| prompt 注入 | 🟢 | `<data>` 围栏 + 显式防御,早前 finding 已修 |
| prompt 质量/集中度 | 🟡 | secretary 有 catalog;portal 内联,难版本化/测 |
| 成本 | 🟠 | 无缓存、无便宜档、多个 2048、成本按拍平常数估(非 token)→ 数字不可靠 |
| 洞察卡数据质量 | 🟢 | 已反复打磨(3 批 + 健康卡深审),诚实降级,无新硬伤 |
| key 统一/防漂移 | 🟢 | #36 已修我早前标的漂移 |

**先做**:C2(成本按 token,让 analyst 成本预警靠谱)→ C1(缓存)→ C3(便宜档)。这三条都是省钱 + 让成本可观测,风险低。

_关联:`algorithm-review-findings.md`、`silent-failure-audit-2026-07.md`(insights 无日志)、`system-layers.md`。审 origin/main。_
