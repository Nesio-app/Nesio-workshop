# 宝盒 / Nesio 软件评测(2026-07)

> 范围:对实际应用代码库(`/workspace/treasurebox`,Next.js 16 本地优先 PWA)做一次整体评测,覆盖数据、架构、安全、UI、算法、逻辑六个维度,并给出上线成熟度判断。
> **基准:`origin/main`(tip `e73f8ca`,批次 87)。** 首版评测误用了落后 289 个提交的旧分支,已按 main 重新核验并订正——最显眼的"AI 路由鉴权"一条,在 main 上其实已基本修好。

---

## 一句话结论

**产品与工程主体是成熟的,真正卡上线的只有一类问题:付费门禁"信任客户端"。** 数据同步、账户、架构、UI、算法都可判绿或接近绿;安全判黄——**云数据路径和主令牌校验都已做对**(access token 已服务端验真),剩下的是**付费/Pro 在服务端零强制**、以及一张表簇缺 RLS。修掉这一类(约 2–4 周),就具备公开上线条件。TestFlight 内测则只差你手上那 5 个外部账号任务。

---

## 分维度评测

### 数据 — 🟢 绿
- Signal 事实表切换已完成(IndexedDB 事实库为准 + LifeGraph 投影),读写路径统一。
- 云端 9 条数据路由(`/api/cloud/*`、`/api/user-data/*`)**服务端校验 Supabase token**(`getSignedInUser` / `deriveCloudIdentity`),用户隔离到位,账户删除/导出也验证 token。
- 遗留隐患一处:`lib/life-domain/create-signal.ts:178` 云写是 `void writeCloudSignal` **发射即忘,无重试队列**——弱网/离线时静默丢同步。同步文案却宣称"自动重试",属于**假修复**(文案兑现不了行为)。

### 架构 — 🟢 绿
- 本地优先 + 云投影分层清晰;`APPSTORE_BUILD` 一仓两构建,提交版能屏蔽 Lab / v1-cut 功能,合规隔离思路正确。
- Capacitor 原生壳 + Codemagic 云 CI,绕开老 Mac 的 Xcode 限制,可行。
- 端上 LLM 三级路由规格(确定性→端上→云)已成文,是降本+富免费层的正确方向,尚未落地(不阻塞上线)。

### 安全 — 🟡 黄(**唯一真正的上线卡点**)
根因一句话:**主令牌路径已经"服务端为准",但付费门禁和部分数据表仍"信任客户端"。**
1. **AI/门禁路由鉴权——access token 已真验(已修)。** `isPortalRequestAuthorized`(`lib/portal/auth/api-auth.ts`)对 `baohe_auth_access` 调用 `verifySupabaseAccessToken` → 打 Supabase `/auth/v1/user` 校验,带缓存。伪造 access token 走 401。**残留两处**:① `refresh`/`wechat_openid` cookie 仍只看存在性(代码内已标 P0 清偿);② token 校验网络异常时 **fail-open 放行**(有意为之,避免抖动锁死真用户,但被诱导断网时是个窄口子)。
2. **付费门禁无服务端强制(仍在)。** `/api/entitlements` 只是 `buildEntitlementsResponse()` 返回一份计算结果,**不在付费 AI 调用边界做校验**。Pro 档本质仍是**客户端强制**——localStorage 的 Pro 标志/试用起始可被重置 → **收入零保护**。
3. **RLS 覆盖不全(仍在)。** 主后端 bundle(37 条策略)和 signals 表有 RLS,但 `database/schema/module-data-network-v1.sql` 的 **15 张表零 RLS**。若这些表暴露给 anon key,即跨用户可读。

> 修复次序:① 付费能力在服务端(调用云模型/写 Pro 数据处)加 entitlement 校验——**收入与 AI 成本的护栏,必做**;② module-data-network 补 RLS;③ 收口 refresh/openid cookie 的存在性信任(已在清偿计划里)。第 1 项是当前最实的钱袋子漏洞。

### UI — 🟢 绿(有细节欠账)
- 视觉体系(冷/暖、衬线嗓音、去 emoji 图标)方向成立,今日页 / 洞察页原型已定稿。
- 已知 P0/P1 欠账(来自实机 QA):洞察页文字挤压、健身功能未在提交版隐藏、"1000+ 待同步"吓人文案、注册与登录页无区别、设置缺账号管理入口。均为局部修复,不涉架构。

### 算法 — 🟢 绿
- 引导排序(在线逻辑回归)、注意力引擎、DEC 跨域、语义搜索(signal-embedding)构成"回溯而非预测"的底座,与产品定位("外置大脑/记忆减负")一致。
- "今日聚焦/未来预测"曾不符预期——已确立**回溯优先**原则纠偏,方向正确。

### 逻辑 — 🟢 绿
- 保存优先(save-first)采集管线、三层标签("标签=门")模型自洽。
- 主要逻辑欠账来自上面的"假修复"文案层——把宣称对齐到真实行为即可。

---

## 上线成熟度

| 里程碑 | 状态 | 卡点 |
|---|---|---|
| TestFlight 内测 | ✅ 就绪 | 仅差你手上的 5 个外部账号任务(Apple Developer / ASC / API Key / Codemagic / 合规部署) |
| 公开上线 | ⏳ ~2–4 周 | IAP 接入 + 服务端 entitlement/鉴权加固 + Notion 撤权闭环 + module-data-network RLS + 多设备冲突合并 |

---

## 补丁 vs 系统化(给"别再打局部补丁"的回答)

现存问题里,**真正需要系统化改一次的只有一件:把付费/数据的"信任客户端"改成"服务端为准"**——它解释了付费绕过和部分数据越权(主令牌鉴权已在 main 上做成服务端为准)。其余(UI 欠账、同步文案、发射即忘的云写)都是**收敛的局部修复**,逐条清即可,不需要重写。之前评估过换语言(含 Java)重写——**不划算,当前架构没有需要重写才能解决的结构性缺陷**。

**建议动作:先做安全那一类系统化修复,再按清单逐条还 UI/文案/同步的局部欠账,同时推进你的 5 个外部账号任务开 TestFlight。**
