# Alexa 技能接入 Nesio（语音入口）

把满屋的 Echo / Alexa 设备变成 Nesio 的**语音前端**：随口说一句就入档（capture），随口问一句找东西（ask，v2）。

> ⚠️ **Alexa 不支持中文。** 自定义技能只能选 en-US / en-GB 等英文 locale——没有中文 NLU。
> 这条通道天然是**英文**的。要中文语音，得走小爱同学 / 天猫精灵（另做，见 STATE.md 欠账）。
> ⚠️ **隐私：** 走这条通道 = 语音先到 Amazon 云做识别，再到 Nesio。和「本地优先」相悖，
> 属于**便利性换隐私**的可选入口，默认不开；开之前想清楚。

---

## 架构（复用现成管道，零新表）

```
Echo 设备 → Alexa 云(ASR+NLU) → POST https://<你的域名>/api/alexa
                                      │  routeAlexa() 解析意图
                                      ├─ CaptureMemoryIntent → 转发 /api/portal/ingest
                                      │     {source:'alexa', content, secret}
                                      │     → extractNodes → 写云记忆(和其他外部捕获同管道)
                                      └─ AskMemoryIntent → v2 占位(先引导回 App，不假装)
```

- 端点实现：`app/api/alexa/route.ts`（`routeAlexa` 纯函数可单测 + POST 处理 + GET 自检）。
- 捕获复用 `/api/portal/ingest`（`{source, content, secret}` 通用外部捕获口）——**不新增落库逻辑**。
- 交互模型：`docs/alexa/interaction-model.json`（en-US，唤醒词 `nesio`）。

---

## 环境变量

| 变量 | 作用 | 必填 |
|------|------|------|
| `ALEXA_SKILL_ID` | 你的技能 ID（`amzn1.ask.skill.xxxx`）；端点用它校验 `applicationId`，挡别人的技能乱打 | ✅ |
| `INGEST_SHARED_SECRET` | 个人单用户「随口记」凭证：捕获直接落到 owner 的记忆（无账号关联时用） | 个人版必填 |
| `NESIO_OWNER_ID` | owner 的 **Supabase user id（UUID）**；让「随口记 / 随口问」都落在、读自「和 App 同一片记忆」 | 个人版必填（问一问需要） |

> 多用户 / 上架版应改用**账号关联（Account Linking）**：Alexa 带 `accessToken` 过来，
> 端点用它归属用户，不再依赖共享密钥 / owner id。个人自用配 `INGEST_SHARED_SECRET` + `NESIO_OWNER_ID` 即可。

### 怎么找到我的 `NESIO_OWNER_ID`

在**登录了 Nesio App 的浏览器**里,直接打开 `https://<你的域名>/api/alexa`(GET)。
返回 JSON 里的 `signedInOwner.userId` 就是你的 Supabase user id —— 复制它填到
`NESIO_OWNER_ID`。没登录会显示 `signedInOwner: null` 并提示先登录。

---

## 亚马逊开发者后台步骤（一次性）

1. 登 [developer.amazon.com](https://developer.amazon.com) → **Alexa** → **Alexa Skills Kit** → *Create Skill*。
2. 名称随意；**Model = Custom**；**Host = Provision your own**（我们用自己的 HTTPS 端点，不用 Lambda）。
3. **Invocation Name** 填 `nessa`（唤醒后说 "Alexa, open nessa" 或直接 "Alexa, tell nessa to remember …"）。
4. **JSON Editor** → 粘贴 `docs/alexa/interaction-model.json` 的内容 → *Save* → *Build Model*。
5. **Endpoint** → 选 **HTTPS** → Default region 填 `https://<你的生产域名>/api/alexa`
   → 证书类型选「My development endpoint is a sub-domain of a domain that has a wildcard certificate…」
   （Vercel 域名有有效 TLS，选带受信证书那项即可）。
6. 复制页面顶部的 **Skill ID**（`amzn1.ask.skill.…`）→ 填到 Vercel 环境变量 `ALEXA_SKILL_ID`。
7. 生产环境再配 `INGEST_SHARED_SECRET`（和 App 里外部捕获用的同一个）。
8. **Test** 页开 *Development*，输入 "ask nessa to remember the spare key is under the mat" 验证。

---

## 校验（当前实现）

端点 `verify()` 做两层（个人 / 开发版够用）：
1. `applicationId === ALEXA_SKILL_ID`——挡掉不是你这个技能的请求。
2. 请求 `timestamp` 新鲜（≤150s）——防重放。

> **上架前还需补：** Alexa 官方要求校验 `SignatureCertChainUrl` + `Signature` 证书链
> （证明请求真来自 Amazon）。个人自用可先只跑上面两层；公开上架必须补齐——见
> [ASK 文档 · Host a custom skill as a web service](https://developer.amazon.com/docs/custom-skills/host-a-custom-skill-as-a-web-service.html)。

---

## 说法示例（英文）

| 说 | 结果 |
|----|------|
| "Alexa, tell nessa to remember the passport is in the top drawer" | 入档一条记忆 |
| "Alexa, ask nessa to note the wifi password is sunflower42" | 入档一条记忆 |
| "Alexa, open nessa" | 欢迎语 + 引导 |
| "Alexa, ask nessa where my passport is" | 读你的记忆 → 一句话念回答案（查不到会诚实说没找到） |

---

## 路线（诚实标注）

- ✅ **v1：** 随口说入档（capture → ingest，诚实态:仅真落库才回 saved）。
- ✅ **v2（本次）：** 语音召回（ask → 服务端读 owner 云记忆 → 评分排序 → 云 LLM 一句话念回；
  LLM 挂了确定性兜底把命中记忆原样念回，不静默变哑）。
- 🔜 账号关联多用户；证书链完整校验（上架必需）。
- ❌ **不做：** 中文语音（Alexa 无中文 NLU，架构性限制，不是没写）。

## 隐私 / 成本说明（owner 自用）

问一问会把命中的记忆片段发给云 LLM 组织答案 —— 这是 owner 自用、已明示不计成本/隐私的
取舍。它**不**改变产品对普通付费/免费用户的边界(那条线仍由 `guardAiRoute` +
`requirePaidCloudAi` 把守);Alexa 端点走的是 owner 身份的私有通道。
