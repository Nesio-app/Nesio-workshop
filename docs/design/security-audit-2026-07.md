# 安全审计(2026-07)

> 审 **origin/main 当前部署版**(scouting + 手查)。覆盖 OAuth / 鉴权 / 注入·SSRF / 密钥 / RLS / AI 边界。
> **总评:安全基线比预期扎实**——OAuth、SSRF、核心表 RLS、AI 边界都做对了。真缺口集中在 RLS 覆盖不全 + OAuth 撤销。

---

## ✅ 做得对的(强项,别误伤)

| 面 | 证据 |
|---|---|
| **OAuth CSRF** | connect 设 state cookie,callback 比对 `returnedState`,`calendar_oauth_state_mismatch` 拒绝;有 `calendar-oauth-state-audit` 测试(在 test:security) |
| **OAuth token 存储** | httpOnly + sameSite:lax(JS 取不到,防 XSS 窃取) |
| **SSRF(parse-url)** | DNS 解析 + 私网/链路本地拦截 + **云元数据 169.254.169.254 拦** + undici Agent 防 DNS-rebind |
| **核心云表 RLS** | `supabase-backend-v1-bundle`(9 表/33 策略)、`memory`(3/12)、`product-events`(1/3)、`profile-settings`(1/4)、`feature-votes`(1/1) 都启了 RLS |
| **客户端不直连数据** | 浏览器只走服务端路由(service role);anon key 只用于 Auth → RLS 是纵深防御非唯一防线 |
| **AI 边界** | 路由过 guardAiRoute、completeText fail-closed、不可信内容 `<data>` 围栏(详见 ai-quality-audit) |
| **密钥** | `NEXT_PUBLIC_*` 只暴露 URL + Supabase anon key(设计即公开),未见私钥进 bundle |

---

## 🔴 真缺口

**S1 — RLS 覆盖不全:两处 anon 可读写的表**
`NEXT_PUBLIC_SUPABASE_ANON_KEY` 公开 → 任何人可拿它直连 `/rest/v1`。核心表有 RLS 兜底,但:
- **`database/schema/module-data-network-v1.sql`:15 张表,0 RLS** → anon 可读写。
- **`analyst_daily` / `analyst_feedback`(我建的):0 RLS** → anon 可读产品指标、可写污染学习基线。
- **本次已修 analyst 两表**(`analyst-schema.sql` 加 `enable row level security` + 不建 anon 策略 = 默认拒绝,service role 照常)。**需你在 Supabase 重跑该 SQL 的 RLS 段生效。**
- module-data-network 15 表待各 owner 补 RLS(或确认这些表根本没在生产 Supabase 建)。

**S2 — Notion「断开」不撤销 OAuth**(与静默失败审计交叉)
`ConnectorsHub:918` 断开只清 localStorage,`nesio_notion_access` httpOnly cookie 原样保留,仓库无 notion/disconnect 路由。**用户以为断了,token 还在、还能用。** 撤销缺失 = 隐私/安全双缺口。

**S3 — 跨 provider token 互踩**(与静默失败审计交叉,availability)
`integrations.ts:166` token 回写以「读失败→{}」为基底整体覆写 → 一次读失败静默清掉另一 provider 的 refresh token。虽是可用性问题,但表现为「莫名被登出/断连」,难排查。

---

## 🟡 待确认 / 加固

- **cookie `secure` 标志**:OAuth cookie 见到 httpOnly + sameSite,未确认 `secure:true`。生产 Vercel 全 HTTPS 通常无碍,但应显式设 secure(防降级到 HTTP 泄露)。
- **gmail/route.ts 限流**:有 auth 门但没走 guardAiRoute → 缺限流(AI 审计已标),已登录用户可无节流打(maxTokens 2048)。
- **PKCE**:OAuth 用了 state(防 CSRF),confidential client 有 client_secret 故 PKCE 非必需;若将来做纯前端/移动端流程需补 PKCE。
- **PII 进 AI/遥测**:AI prompt 把健康/邮件内容发给 Claude/Gemini(功能必需,已围栏);属**隐私**范畴(下一轮隐私审计细看:发了什么、能否最小化、用户是否知情同意)。

---

## 总评表

| 面 | 评级 |
|---|---|
| OAuth(CSRF/token 存储) | 🟢 state 校验 + httpOnly;缺 notion 撤销(S2) |
| 注入 / SSRF | 🟢 parse-url 防御齐;AI `<data>` 围栏 |
| RLS / 数据访问 | 🟠 核心表有,**module-data-network + analyst 缺**(S1,analyst 已修) |
| 鉴权深度 | 🟢🟡 大多 guardAiRoute;gmail 缺限流 |
| 密钥 | 🟢 未见私钥外泄 |
| 撤销 / 可用性 | 🟠 notion 不撤销(S2)、token 互踩(S3) |

**先做**:S1(补 RLS——analyst 已修,module-data-network 待补 / 确认)→ S2(notion 撤销)→ S3(token 回写用 read-modify-write 前先确认读成功)。
隐私(PII 进 AI/遥测、导出删除完整性)建议单开一轮——那是这个健康+财务 app 的真命门。

_关联:`ai-quality-audit`(AI 边界)、`silent-failure-audit`(S2/S3 也在其中)、`architecture-issues`(lib/portal/auth 已拆)。审 origin/main。_
