# 端上 LLM 路由实现规格(2026-07)

> 目标:用端上 LLM(优先 Apple Foundation Models)把 AI 任务从付费云搬到免费/端上,**降 AI 成本 + 富免费层**,落地"脱离付费 AI"。
> 原则:**确定性优先 → 端上其次 → 云端只接硬尾巴**;免费用户永不打云;端上输出必过校验。

---

## 1. 三级路由(核心机制)

改造 `lib/portal/ai-complete.ts` 的 `completeText`:从"直接打云"变成级联。

```
Tier 0  确定性(模板/规则/统计)   已有:fallbackNarrative / local-decompose / fallbackHealthInsight
   ↓ 不够好
Tier 1  端上 LLM(Foundation Models / llama.cpp 3B)   免费、私密   ← 新增
   ↓ 不够好 且 isPro
Tier 2  云端前沿(Claude/Gemini)   付费,仅 Pro
```

伪码:
```ts
async function completeText(opts: {
  task: TaskKind; prompt: string; schema?: JSONSchema;
  isPro: boolean; allowCloud?: boolean;
}): Promise<{ text: string; tier: 'deterministic'|'ondevice'|'cloud' }> {
  // Tier 0 — 确定性
  const det = deterministic(opts.task, opts.prompt);
  if (det?.goodEnough) return { text: det.text, tier: 'deterministic' };

  // Tier 1 — 端上(有则用)
  if (await onDeviceAvailable()) {
    const local = await ondevice.generate(opts.prompt, { task: opts.task, schema: opts.schema });
    if (validate(local, opts)) return { text: local, tier: 'ondevice' };
  }

  // Tier 2 — 云端(仅 Pro 且允许)
  if (!opts.isPro || opts.allowCloud === false) {
    return { text: det?.text ?? '', tier: 'deterministic' }; // 免费:回退,不烧钱
  }
  const cloud = await callCloud(opts.prompt, { model: pickModel(opts.task), schema: opts.schema });
  return { text: cloud, tier: 'cloud' };
}
```

- 免费用户 = Tier 0/1 封顶(端上,$0)。付费 = 可升 Tier 2。
- 门控挂 entitlement(复用 `entitlements` 路由):免费传 `allowCloud:false`。

---

## 2. 任务 → 档位映射

端上 3B 擅长**分类/抽取/短摘要/意图/短问答**;不擅长**长推理/深理解/新颖综合**。

| 任务 | Tier 0 确定性 | Tier 1 端上(免费) | Tier 2 云(Pro) |
|---|---|---|---|
| 问问(ask) | 语义搜索 | ✅ 端上 RAG 简答 | 深度对话/综合 |
| 说一句→意图 | 关键词规则 | ✅ 意图解析成任务 | — |
| 洞察叙述 | 模板 | ✅ 把统计结果润色成话 | 新颖跨域综合 |
| decompose / routine | local-decompose | ✅ 端上拆解 | 复杂多步 |
| gmail 抽取 / 会议摘要 | 正则 | ✅ 短文本 | 长文/复杂 |
| 拍照 | 端上视觉标签 | 标签→描述 | ✅ 深度场景理解 |
| 邮件直接回复 | — | 草拟短句 | ✅ 长回复 |

**红利**:原本 Pro-云 的"问问",现在**免费就能端上给简答**,Pro=云端深答 → 免费层立刻有 AI 味。

---

## 3. 端上栈选型

**首选 Apple Foundation Models(iOS 26+)** —— **不打包模型、不用 ODR、不用 R2**,Apple 提供 3B,免费。
- 只在需要**专有 LoRA 行为(垂直微调)** 或 **覆盖老 iOS/安卓** 时,才上自有模型:**llama.cpp+Metal(GGUF,广覆盖)** 或 **Core AI(.aimodel,新机)** + INT4 量化 + ODR/R2 分发 + LoRA 热更。
- 纯 PWA(无原生壳):`transformers.js`(WebGPU)兜底,再不行退确定性。

---

## 4. Foundation Models 插件接口(Capacitor)

原生 Swift 侧包成插件,暴露给 web:

```ts
interface OnDeviceLLM {
  availability(): Promise<'available'|'unavailable'>;   // 必查:机型/AI开关/下载中
  generate(prompt: string, opts?: {
    instructions?: string;
    schema?: JSONSchema;      // → 映射到 @Generable 结构化输出
    tools?: ToolSpec[];       // → 端上 RAG:模型调"搜本地笔记"
    stream?: boolean;
  }): Promise<string>;
}
```

Swift 要点:
- **先查 `SystemLanguageModel.default.availability`**,`.unavailable` → 让 web 回退。
- **结构化**:`schema` → `@Generable` struct,模型直接产出类型(抽取成字段极顺,免解析)。
- **端上 RAG**:注册一个 tool 让模型调用本地检索(签名到 `signal-search`),把命中片段喂回模型生成简答。
- 会话:`LanguageModelSession(instructions:)` + `respond` / `streamResponse`。

---

## 5. 平台分叉

| 环境 | 端上 provider |
|---|---|
| Capacitor 原生 iOS 26+ | Foundation Models 插件 |
| Capacitor 老 iOS / 安卓 | llama.cpp 插件(可选)或退确定性 |
| 纯 PWA(Safari) | transformers.js WebGPU,或退确定性 |

→ 端上红利在**原生 iOS 上最强**。

---

## 6. 校验器(防小模型胡说,必做)

端上输出必须过校验才采纳:
- 有 schema → JSON 结构/必填字段校验。
- 无 schema → 长度下限、关键 token 存在、无明显拒答/复读。
- 不过 且 isPro → 升 Tier 2;不过 且免费 → 退 Tier 0 确定性。

---

## 7. 埋点 & 度量(接 L0 + 预测器)

- `persistAiEvent` 记录本次 `tier`('deterministic'|'ondevice'|'cloud')+ token。
- 度量:**端上分担率**、**云调用降幅**、每付费用户 AI 成本。
- 直接喂 GTM 利润预测器的"AI 成本/付费用户"与"端上分担率"滑块,看毛利变化。

---

## 8. 分发(仅自有模型才需要)

- 用 Foundation Models → **无需分发**(Apple 内置)。
- 自有模型 → 空壳冷启动(<50MB)+ 首次"激活 AI"时 ODR 或 Cloudflare R2(免出站费)异步下载 INT4 量化 3B(1.5–3GB),SW/文件系统缓存;LoRA 权重可云端热更。

---

## 9. 落地顺序

1. `completeText` 加端上档 + 任务→档位路由表 + 校验器 + 埋点。
2. 写 Foundation Models Capacitor 插件(`availability` + `generate` + 结构化 + RAG tool)。
3. 先搬三个最稳:**问问简答、说一句意图、洞察润色** → 免费走端上。
4. 埋点测降本;喂预测器看毛利。
5. 之后按需上自有 LoRA 模型(垂直行为)+ ODR/R2。

---

## 10. 限制 & 风险

- 端上 3B 质量 < 前沿:靠 Pro 升云 + 免费诚实降级兜住。
- Foundation Models 仅 iOS 26+ 且 Apple Intelligence 机型;安全护栏会拒答;上下文窗口有限。
- 端上生成慢(~10-30 tok/s):只用于短任务,不生成长文。
- 纯 PWA / 老设备拿不到 → 必须有确定性兜底,不能崩。

_关联:`ai-cost-optimization-2026-07.md`(L0/L1/L2)· `ios-ondevice-perception-spec`(待建,ASR/视觉)· `ai-quality-audit-2026-07.md`(fail-closed/校验)。_
