# API Routes — Auth Matrix

Generated from the 2026-07 security audit. **Every new route that spends
money (AI calls) or touches private data MUST call `guardAiRoute` from
`lib/portal/api-auth.ts`** (or implement the equivalent triple check) and
appear in this table. The audit that produced this doc found 14 AI routes
with no auth at all — keep the table current so that can't recur silently.

Auth legend:
- **guard** — `guardAiRoute`: session cookie / stage5 secret / no-Supabase
  local mode (+ same-origin check) + per-IP rate limit
- **session** — route-local check of `baohe_auth_*` cookies (+ stage5/lab)
- **secret** — shared secret (`INGEST_SHARED_SECRET` etc.)
- **state** — OAuth state-cookie validation (pre-auth flows)
- **open** — intentionally public

## AI-spending routes (all guarded)

| Route | Auth | Rate limit |
|---|---|---|
| POST /api/portal/chat | guard | 20/min |
| POST /api/portal/inventory-extract | guard | 20/min |
| POST /api/portal/person-extract | guard | 20/min |
| POST /api/portal/tts | guard | 10/min |
| POST /api/portal/daily-brief | guard | 15/min |
| POST /api/portal/guidance-language | guard | 20/min |
| POST /api/portal/living-model | guard | 10/min |
| POST /api/portal/mirror-letter | guard | 6/min |
| POST /api/portal/insights | guard | 15/min |
| POST /api/portal/proactive | guard | 20/min |
| POST /api/portal/decompose-task | guard | 20/min |
| POST /api/portal/meeting-notes | guard | 15/min |
| POST /api/portal/life-state | guard | 15/min |
| POST /api/portal/health-insight | guard | 10/min |
| POST /api/portal/notion | guard | 15/min |
| POST /api/portal/notion/classify | guard | 20/min |
| GET /api/version | 公开只读(构建号,无数据) | — |
| POST /api/portal/health | guard | 10/min |
| POST /api/health/analyze | guard | 20/min |
| POST /api/health/chat | guard | 20/min |
| POST /api/health/narrative | guard (allowCrossOrigin) | 15/min |
| GET/POST /api/secretary/health, /api/secretary/chat | session / lab(route 内建) | — |
| POST /api/portal/analyze | verified session (Supabase) / env-lab | — | isAnalyzeAiAllowed→isPortalRequestAuthorized(验真 access token,不再只看 cookie 存在);衣橱:mode='clothing' 用专属 prompt 抽结构化衣物属性(付费云;客户端 canUsePaidCloudAi 前置门,免费手填兜底) |
| POST /api/portal/wardrobe-stylist | guardAiRoute + requirePaidCloudAi | 20/min | 衣橱·Pro 云造型师:从现有单品挑一套协调搭配 + 理由 + 贴士;免费/失败回落规则版 suggestOutfit |
| POST /api/portal/wardrobe-tryon | guardAiRoute + requirePaidCloudAi | 10/min | 衣橱·Pro 上身试穿:全身照 + 单品照 → Gemini 图像模型合成上身效果;隐私:照片不落库、仅请求时发送;reportAiCall 上账 |
| POST /api/portal/ingest | shared-secret / verified session (Supabase) / env-lab | — | isIngestAllowed→isPortalRequestAuthorized(验真会话;body secret 走 safeEqual 常量时间比较) |
| POST /api/alexa | applicationId(ALEXA_SKILL_ID)+ 时间戳新鲜度 | — | 智能家居·Alexa 语音入口:capture→转发 /api/portal/ingest 入档(诚实态:仅真落库才回 saved);ask→服务端读 owner 云记忆→文本评分排序→云 LLM 一句话念回(LLM 挂了确定性兜底念回命中记忆)。英文 only(Alexa 无中文)。归属:账号关联 accessToken 或 NESIO_OWNER_ID(owner Supabase user id)。GET 自检并回显登录 owner 的 identityKey/userId 方便配 NESIO_OWNER_ID。详见 docs/alexa-skill-setup.md |
| POST /api/portal/embed | session / no-Supabase + requirePaidCloudAi(付费门)+ 熔断 + reportAiCall | — | 里程碑 C:付费语义检索会把记忆文本(含邮件正文,本机全文优先)嵌入化过云;仅付费层(canUsePaidCloudAi)到达,免费前置拦下不出网 |
| POST /api/secretary/chat | session / lab | — |

## Private-data routes

| Route | Auth |
|---|---|
| GET /api/portal/gmail | session / no-Supabase + OAuth token |
| GET /api/portal/gmail-quick | session / no-Supabase + OAuth token |
| GET /api/portal/calendar | verified session (hasVerifiedSessionCookie) / no-Supabase (cloud mode fails closed) |
| POST /api/portal/calendar | session / no-Supabase + OAuth token (calendar.events) — 建日程(结构化 or 自然语言 LLM 解析,写 primary) |
| POST /api/portal/drive | guardAiRoute (20/min) + Google OAuth token (drive.appdata) — 免费云备份到用户 Drive |
| GET /api/portal/drive | guardAiRoute (20/min) + Google OAuth token (drive.appdata) — 拉回云备份 |
| GET /api/portal/tasks | guardAiRoute (20/min) + Google OAuth token (tasks) — 读 Google Tasks 待办 |
| GET /api/portal/people | guardAiRoute (20/min) + Google OAuth token (contacts.readonly) — 读通讯录→person 节点(人缘管理);runPeopleSync 消费 |
| GET /api/auth/session | open (reports session state) |

## OAuth flows (pre-auth by design)

| Route | Protection |
|---|---|
| GET /api/portal/gmail/connect | redirects to Google consent |
| GET /api/portal/gmail/callback | state cookie validation |
| GET /api/portal/calendar/connect | redirects to Google consent |
| GET /api/portal/calendar/oauth/callback | state cookie validation |

## Telemetry

| Route | Auth |
|---|---|
| POST /api/telemetry | anonymous-by-design (same-origin + 60/min) — event names/props whitelisted & truncated; 匿名设备级计数,QA P1 修复 2026-07-04 |
| GET /api/admin/metrics | same-origin + NESIO_ADMIN_SECRET header + 30/min — 管理面板聚合只读(telemetry_events/product_events),只回统计不回原始行 |
| GET/PATCH /api/admin/users | requireAdmin(同 metrics 门)— 用户权限管理:列用户/改 access_role/feature_flags |
| GET /api/portal/access | same-origin + 30/min,匿名回 public — 登录用户领取服务器授予的角色;personal_lab 顺带下发 secretary lab cookie |
| GET/POST /api/portal/feature-vote | same-origin + 限流,匿名合法(遥测 deviceId)— Roadmap 功能 1-5 星评分,feature id 白名单在 lib/portal/roadmap.ts |

## Known-open routes

`/api/portal/quote`, `/api/portal/production/health`, `/api/modules`,
`/api/entitlements` and similar read-only/config routes are intentionally
open. If one of these starts touching AI or private data, move it up a table.

## Family sharing (workshop 域实验, 2026-07)

家务 + 零花钱账本(信任模型 A:服务端授权)。每条都 `resolveActor`(= `getSignedInUser`,
未登录 401)+ `requireMember`(非该家庭成员 403)+ 受控写再过 `lib/family/chores-core`
的能力门(无 `can_approve` 审核 / 无 `can_record_payout` 记付款 → 403)。**永不碰钱**:
payout 仅记账。数据经 service-role 落 family 表,RLS(`is_family_member`)纵深防御。

| Route | Auth | Rate limit |
|---|---|---|
| `GET/POST /api/portal/family` | session + membership | —(workshop) |
| `POST /api/portal/family/join` | session | —(workshop) |
| `GET /api/portal/family/board` | session + membership | — |
| `GET /api/portal/family/ledger` | session + membership | — |
| `POST /api/portal/family/chore` | session + membership + `can_approve` | — |
| `POST /api/portal/family/chore/action` | session + membership + 能力(核心判) | — |
| `GET /api/portal/family/members` | session + membership | — |
| `POST /api/portal/family/assign` | session + membership(互相分派,任一成员可派) | — |
| `GET /api/portal/family/assignment` | session(查某事件已分派给谁/状态) | — |
| `POST /api/portal/family/profile` | session(同步我的账号名字/头像到成员行) | — |
| `POST /api/portal/family/goal` | session + membership(设我自己的攒钱目标) | — |
| `POST /api/portal/family/cancel` | session + membership + `can_approve`(停掉/删家务) | — |
| `POST /api/portal/family/payout` | session + membership + `can_record_payout` | — |

注:非 AI 花费路由,未挂 `guardAiRoute`(无云成本);走等价的 session+成员+能力三重判。
workshop 实验暂未加 per-IP 限流,转正前应补(join 尤其)。

## OAuth (2026-07 审查)

- **2026-07 免费最大化扩展**: 联合授权新增 `drive.appdata`(非敏感,免费云备份到用户
  自己 Drive 的隐藏 App 文件夹)+ `tasks` + `contacts.readonly`(敏感 scope,生产需
  Google OAuth 验证审核;验证前有未验证警告与 100 用户上限)。加 scope 后老用户重授权一次。
- **Scopes ✓**: `gmail.readonly` + `calendar.readonly` + `calendar.events`(建日程写权限,
  2026-07 加;联合授权一次 consent 覆盖)+ `gmail.send`/`tasks`/`drive.appdata`。
  加 `calendar.events` 后老用户需重授权一次(断开重连 Google)。无 profile 写权限。
- **撤销路径 ✓**: `POST /api/portal/oauth/disconnect` 调 Google revoke
  端点作废整个 grant 并清除全部 4 个 token cookie。由于共用授权,断开
  任一连接器会同时断开另一个(UI 已同步提示)。
- Token 存储: HTTP-only cookies(access 1h / refresh 90d),无 Supabase
  时不落库。

## 移动端走查 (2026-07)

通过:viewportFit cover + 74 处 safe-area-inset + dvh/svh 全覆盖(唯一
100vh 为渐进增强回退)。图标按钮均有 aria-label。已知缺口:无
visualViewport 键盘监听(Capacitor 壳内实测键盘正常,暂不投机修补)。
