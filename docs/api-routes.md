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
| POST /api/portal/guidance-judge | guardAiRoute + requirePaidCloudAi | 6/min | AI 判决层(实弹,8 层规则管线已拆):结构化信号批量判卡;sev3 判决出卡即 Web Push;completeText 真实 token+cost_usd 上账,/admin 汇总 |
| POST/DELETE /api/portal/push-subscribe | guard | 10/min | Web Push 订阅登记/退订(user_push_subscriptions,service-role 写,RLS 拒直连;发送端在 guidance-judge) |
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
| POST /api/portal/analyze | verified session (Supabase) / env-lab | — | isAnalyzeAiAllowed→isPortalRequestAuthorized(验真 access token,不再只看 cookie 存在);衣橱:mode='clothing' 用专属 prompt 抽结构化衣物属性(付费云;客户端 canUsePaidCloudAi 前置门,免费手填兜底)。**mode='ocr'**(2026-07-31):只逐字转写、返回 { ok, text },不做理解也不出 nodes —— 给化验单当端上认不了字时的兜底,由用户在 LabScanSheet 里**逐张点头**才发;判定仍留在本机 parseLabReport。往产品仓搬时这条要挂 requirePaidCloudAi。 |
| POST /api/portal/wardrobe-stylist | guardAiRoute + requirePaidCloudAi | 20/min | 衣橱·Pro 云造型师:从现有单品挑一套协调搭配 + 理由 + 贴士;免费/失败回落规则版 suggestOutfit |
| POST /api/portal/avatarify | guardAiRoute + requirePaidCloudAi | 10/min | 图像重绘,一个 style 参数两种用途:style='avatar'(默认)照片→app 主题色卡通头像;style='garment'(2026-07-28,标注 图16)衣服照片→白底干净单品图(prompt 里明令不许改颜色/图案/版型)。Gemini 图像模型优先、OpenAI gpt-image-1 兜底;无 key/失败诚实报错,客户端保留原图可一键换回 |
| POST /api/portal/wardrobe-tryon | guardAiRoute + requirePaidCloudAi | 10/min | 衣橱·Pro 上身试穿:全身照 + 单品照 → Gemini 图像模型合成上身效果;隐私:照片不落库、仅请求时发送;reportAiCall 上账 |
| POST /api/portal/cooking-recipe | guardAiRoute + requirePaidCloudAi | 12/min | 美食·Pro 云生成菜谱:食材+菜系(+可选要求)→ 步骤/贴士 JSON,钳成 Recipe;客户端存本机 generated-recipes + 想做清单 |
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
| GET /api/portal/tesla | isPortalRequestAuthorized + rate limit (20/min) + Tesla OAuth token — 只读快照:车辆(drive/charge/vehicle_state)+ **能源产品**(2026-07-30 补:`/api/1/products` → `energy_sites/{id}/live_status` 与 `history?kind=energy&period=day`)。能源与车辆**分开失败**:没有能源产品或 token 缺 `energy_device_data` 时只让 energy 为空,不影响车辆数据 |
| GET /api/portal/music/apple-token | guardAiRoute (10/min) — 服务端签 MusicKit developer token(ES256,.p8 私钥只在服务端)。没配密钥时 200 + `configured:false`,让界面照实说「还没配好」而不是渲染成网络故障 |
| GET /api/portal/music/spotify | guardAiRoute (20/min) — 读该账号的 Spotify 状态。`streamable` **只在 product 确认为 premium 时**为 true(正向判据);刷新失败即清 cookie 并如实报 `authorized:false` |
| DELETE /api/portal/music/spotify | guardAiRoute (10/min) — 断开(清 httpOnly cookie) |
| GET /api/portal/music/netease/search | guardAiRoute (20/min) — 网易云搜索。**默认直连**(weapi,协议在 `lib/platform/music/netease-protocol`),配了 `NETEASE_API_BASE` 才转发给自建实例。风控回 `{ok:false,reason:'blocked'}` 而非 502 —— 换个词再搜没用,这不是故障 |
| GET /api/portal/music/netease/song-url | guardAiRoute (30/min) — 逐曲问播放地址,默认直连(weapi → 回退 `song/media/outer/url`,两条都拿不到才算受限)。**四态分开,四个不同的下一步**:`{ok:true,url}`;`{ok:true,url:'',reason:'restricted'}`(这一首受限 → 换一首,**不给重试**);`{ok:false,reason:'blocked'}`(整台被风控 → 换歌没用);502(真故障 → 重试)。拿到的地址一律改写成 https,否则 https 页面上的混合内容会被浏览器静默拦掉。2026-07-31 新增 |
| GET /api/portal/music/netease/lyric | guardAiRoute (40/min) — 一首歌的歌词(LRC + 翻译),默认直连 weapi,配了 `NETEASE_API_BASE` 才转发。**服务的不只是网易的歌**:本地导入的 mp3 自己没带词时,拿曲名搜一首同名的再来这里取词(用户:「本地没歌词的,都用网易歌词」)。「没有词」`{ok:true,lrc:''}` 与「取不到」502/blocked 分开 —— 纯音乐不该挂一个点不好的重试。2026-08-01 新增 |
| GET /api/auth/session | open (reports session state) |

## OAuth flows (pre-auth by design)

| Route | Protection |
|---|---|
| GET /api/portal/gmail/connect | redirects to Google consent |
| GET /api/portal/gmail/callback | state cookie validation |
| GET /api/portal/calendar/connect | redirects to Google consent |
| GET /api/portal/calendar/oauth/callback | state cookie validation |
| GET /api/portal/music/spotify/connect | redirects to Spotify consent(缺 env 时 503 + missingEnv) |
| GET /api/portal/music/spotify/callback | state cookie validation;令牌只写 httpOnly cookie(不落 localStorage/不进备份/不上云),失败一律带原因跳回 `/?music=1&spotify=…` |

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
| `POST /api/portal/family/member` | session + membership(改角色/踢人需 `can_approve`;退出自己可) | — |
| `POST /api/portal/family/payout` | session + membership + `can_record_payout` | —(默认记一笔;`action:'reverse'`+`payoutId` 软删冲正,账本自动回加) |

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
