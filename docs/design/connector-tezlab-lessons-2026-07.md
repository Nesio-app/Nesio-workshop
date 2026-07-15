# Connector 层:从 TezLab 学什么(2026-07)

> 起因:「让 Nesio 也有 TezLab 的一些功能」。TezLab 是第三方 Tesla 数据 app。
> 分析产物,给在修的 Agent。审 `origin/main` + `claude/fix-upload-autoreload`。

## TezLab 怎么拿 Tesla 数据(事实)

1. OAuth 授权码:弹 `auth.tesla.com`,用户在**特斯拉页面**输密码,TezLab 看不到密码;拿 authorization code。
2. 设备端 code 换 `access_token` + `refresh_token`,加密存服务器。
3. access token 过期用 refresh token 轮换。
4. Fleet API(2023 后):发命令给车要**私钥签名**,车端存 "virtual key" 验签,用户可随时删。
5. 轮询(TezLab / TeslaMate 同款):**sleep-aware** —— 车 ~3min 没动就暂停轮询,间隔 ≥20min,避免耗光车电池 + 撞 Tesla 限流。

来源:blog.tezlabapp.com/2023/12/27、support.tezlabapp.com/article/71、/article/103。

## Nesio 现状(核过代码)

| 维度 | Nesio | 证据 |
|---|---|---|
| OAuth 取 token | ✅ 已同级 | `app/api/auth/callback` + `lib/portal/integrations.ts`(httpOnly + Supabase 跨设备 + cookie fallback) |
| Google 撤销 | ✅ 真撤销 | `app/api/portal/oauth/disconnect/route.ts` 调 Google `oauth2/revoke` 后清 cookie |
| Notion 撤销 | 🔴 缺 | `ConnectorsHub` Notion 是 `method:'token'`,无 disconnect 路由(安全审计 **S2**) |
| 轮询 | 🔴 挂载即全拉一次 | `connectors.ts:runConnectors()` 在 `Portal.tsx:441` mount 时 `Promise.allSettled([refreshWeather, refreshCalendar])`,无退避/无变化检测(天气有个 cache 挡重复,日历每次硬拉) |
| 命令签名/车控 | N/A | Nesio 只读取信号、不回写设备,签名机制不适用 |

## 建议(按性价比)

### R1 · 自适应轮询(最值,惠及所有 connector)
`runConnectors` 现在是"挂载即全拉"。搬 TezLab 的 sleep-aware 思路:
- 每个源存 `{ lastFetched, lastChanged, backoffMs }`(复用 `prefetch-cache`)。
- 拉到的数据和上次比:**变了 → 收紧间隔;没变 → 指数退避**(封顶,如 20min–数小时)。
- 页面可见性驱动(`visibilitychange`),后台不空转。
- **收益三合一**:省 Gmail/Calendar API 配额 · 省 `ai-cost-optimization.md` L1 的调用量(「最便宜的调用是不调用」)· 降静默失败面。
- 落点:`lib/portal/connectors.ts`(加 backoff 状态 + 变化哈希);不动 UI。

### R2 · Notion 撤销闭环(补 S2)
照 `oauth/disconnect` 的形抄一个 token 式 provider 的断开:
- Notion internal token **没有** OAuth revoke 端点 → 做法是"**服务端删除存储的 token + 清 cookie/Supabase 记录**",而非只翻 localStorage 标志。
- 至少要有 `POST /api/portal/notion/disconnect`,`ConnectorsHub:918 disconnect()` 对 notion 走它。
- 关联安全审计 S2:「用户以为断了,token 还在还能用」。

### R3(可选,较重)· Tesla/车作为新数据源
若要真的"有 TezLab 功能"而非只学模式:
- `IntegrationProvider` 加 `'tesla'`;走 **Fleet API** OAuth(需开发者 app 注册 + 用户加 virtual key,有门槛)。
- normalizer 把 行程/充电/位置/能耗 → signal(`normalizeXToSignal` 同 calendar/weather 套路)。
- 价值:车是高质量 life 数据(通勤节律、能耗、位置足迹);但注册 + virtual key 门槛使工作量 > R1/R2。
- 若只想验证价值,可先支持 **手动导入**(TeslaMate/CSV 导出)再谈 OAuth 直连。

## 不做
- **命令签名 / 远程车控**:Nesio 定位是只读洞察,不回写设备;Fleet API 的签名/virtual key 那套不引入。

_关联:`security-audit-2026-07.md`(S2 Notion 撤销)· `ai-cost-optimization-2026-07.md`(L1 不调用最省)· `silent-failure-audit-2026-07.md`。_
