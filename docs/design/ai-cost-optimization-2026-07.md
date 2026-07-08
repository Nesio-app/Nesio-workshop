# AI 成本经济学分析(2026-07)

> 视角:现有 AI 使用设计,从**成本经济**角度的优化。结合本 session AI 质量审计的现状 + 全网最佳实践/理论。
> **核心判断:通用「上 prompt caching 省 90%」的建议对本 app 部分不适用**——因为 local-first + 单用户低频,官方 prompt cache 的 5min/1h TTL 跨 session 命不中。对你划算的杠杆顺序不一样,见下。

---

## 1. 现状成本模型(审计所得)

| 维度 | 现状 | 问题 |
|---|---|---|
| 模型选择 | ~35 路由全走 Claude 主 / Gemini 备 | 简单抽取也用贵模型 |
| 缓存 | `ai-cache` 存在但**路由零使用**;无 prompt cache | 相同输入每次重收费 |
| 异步任务 | analyst cron(日/周报)走同步实时 API | 错过 Batch 50% off |
| 输出上限 | gmail/health/ingest/meeting-notes/notion = **2048** | 输出 token 是贵的一侧(3-5x 输入) |
| 成本核算 | 拍平 `COST_PER_CALL` 常数 × 调用数,**不记 token** | 数字不可靠,无法度量优化效果 |
| 兜底 | 多路由已有确定性 fallback,但 **AI 是默认、fallback 是异常** | 该反过来 |

## 2. 理论 / 行业杠杆(全网搜)

| 杠杆 | 机制 | 幅度 | 出处 |
|---|---|---|---|
| Prompt caching(官方) | 稳定前缀缓存,命中读 **0.1x 输入价** | 长稳定前缀省 ~90% | Anthropic docs |
| 语义缓存 | 按语义相似度复用回复 | 命中 42% vs 精确 14%;31% 查询语义相似 | truefoundry/redis |
| 精确缓存 | 相同输入直接复用 | 视重复率 | — |
| 模型路由/级联 | 易任务→便宜模型(Haiku $1/M),难的才 Sonnet/Opus | **40-85%** | LMSYS/RouteLLM |
| Batch API | 异步 ≤24h,**输入输出各 50% off**,无门槛 | 50%,且可叠加 caching | Anthropic Batches |
| 分层叠加 | exact→semantic→prompt cache + 路由 + batch | **70-85%**,叠加可到原价 ~5% | 多篇 |

关键数字(Claude,2026):cache 命中读 0.1x 输入;cache 写 1.25x(5min)/2x(1h);Batch 输入输出各 50%;`usage` 返回 `input_tokens / cache_read_input_tokens / cache_creation_input_tokens` → **可按 token 真算**。

## 3. 映射到本 app:哪些杠杆真划算(按性价比排序)

**⚠️ 先纠偏**:单用户低频 → 官方 prompt cache(5min/1h TTL)**跨 session 命不中**,只在单次多轮 chat 内有用。所以对你,**持久自有缓存 + 模型分档 + Batch + 确定性优先** 比官方 prompt cache 更重要。

### L0 · Token 级成本核算(地基,先做)
`callClaude`/`callGemini` 拿 provider 返回的 `usage`,`persistAiEvent` 记 input/output/cache token;成本按 token×单价算,替掉拍平常数。
- **为什么第一**:不记 token 就**度量不了任何优化效果**,admin/analyst 成本数字也不可信。零省钱但是前提。

### L1 · 「确定性优先,AI 仅增强」(这 app 最大杠杆,几乎免费)
你已经有 `fallbackNarrative` / `local-decompose` / `fallbackHealthInsight` —— **把默认反过来**:先出确定性结果,**只在它明显不够好 / 用户主动要「更聪明」时才调 AI**。
- 命中的路由:insights narrative、guidance-language、decompose、部分 daily-brief。
- **最便宜的调用是不调用**。单用户低频下,这条比任何缓存都省,而且延迟归零、离线可用。省幅取决于你愿意让多少默认走模板(可能砍掉 30-60% 调用)。

### L2 · 模型分档 / 级联(省 40-85%,中等工作量)
`completeText` 加 `tier` 参数:
- **cheap(Haiku)**:inventory-extract、decompose、barcode、ingest 分类、meeting-notes 摘要 —— 结构抽取/分类,便宜模型够用。
- **standard(Sonnet)**:chat、daily-brief、health risk 叙述 —— 需要推理/语气。
- 级联:先 Haiku,置信低/校验不过再升 Sonnet。

### L3 · Batch API 给异步任务(50% off,低工作量)
**analyst 日报/周报 cron 是纯异步 ≤24h** → 完美 Batch 候选,直接砍一半。将来的批量回填(重分类日历事件、embedding 补算)同理。Batch 还能叠 caching。

### L4 · 持久自有缓存(exact + 语义,替代官方 prompt cache)
让 `ai-cache` 真用起来,**长 TTL**(跨 session),按 prompt 哈希做 exact + 可选语义(embedding 已有基建)。适合低温、可重复的路由(insights/guidance-language/decompose)。这是**替代**官方 prompt cache 的、更适合低频 app 的做法。

### L5 · 输出右尺寸(maxTokens)
2048 的路由逐个核:输出 token 是贵的一侧。抽取类改结构化输出 + 按输入规模动态设上限。

### L6(单次 chat 内)· 官方 prompt caching
**只在多轮 chat 这种「一次 session 内反复带同一大前缀」的场景**加 `cache_control`(系统提示 + 稳定数据前缀)。对其余低频路由收益小,别铺开。

## 4. 预期综合影响 & 优先级

| 优先 | 杠杆 | 省幅(本 app 估) | 工作量 |
|---|---|---|---|
| 1 | L0 token 核算 | 0(前提·让后续可度量) | 低 |
| 2 | L1 确定性优先 | 高(砍 30-60% 调用) | 低-中 |
| 3 | L2 模型分档 | 中-高(便宜档省 40-70%) | 中 |
| 4 | L3 Batch 给 cron | cron 部分 -50% | 低 |
| 5 | L4 自有持久缓存 | 视重复率 | 中 |
| 6 | L5 输出右尺寸 | 低-中 | 低 |
| 7 | L6 官方 prompt cache(仅 chat) | chat session 内高 | 低 |

**理性预期**:L0+L1+L2+L3 做完,AI 月度花费**砍 50-70% 完全现实**,且延迟同步改善(缓存/便宜模型都更快)。别指望通用文章的 90%——那是高频跨用户场景的数。

## 5. 「性能」角度(顺带)
成本与延迟同向:缓存命中省 up to 85% 延迟、便宜模型更快、确定性优先延迟归零。所以这套优化**同时是性能优化**——尤其 L1(默认走本地确定性)让常见路径**零网络往返、离线可用**,契合 local-first。

---

## 引用
- Prompt caching:[Anthropic docs](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) · [TianPan](https://tianpan.co/blog/2025-10-13-prompt-caching-cut-llm-costs) · [Redis](https://redis.io/blog/what-is-prompt-caching/)
- 语义缓存:[TrueFoundry](https://www.truefoundry.com/blog/semantic-caching)
- 模型路由/级联:[Burnwise](https://www.burnwise.io/blog/llm-model-routing-guide) · [TianPan cascades](https://tianpan.co/blog/2025-11-03-llm-routing-model-cascades) · [Morph 5 levers](https://www.morphllm.com/llm-cost-optimization)
- Batch API:[Anthropic Batches 指南](https://pristren.com/blog/anthropic-batch-api-guide/) · [Claude Batch+caching 叠加](https://claudeapi.com/en/blog/dev-guides/claude-batch-api-cost-optimization/)
- 关联:`ai-quality-audit-2026-07.md`(C1-C4 现状)· `system-layers.md`
