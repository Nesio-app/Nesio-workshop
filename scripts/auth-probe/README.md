# 登录路径本地探针

验的是 `/api/auth/session`、`/api/auth/import`、`/api/auth/callback` 这几条**鉴权路径的时序**
(2026-07-28,标注 图2「登录卡住」/ 图3「登录很慢」那批改动)。

一句话:**不需要任何真凭据**。要验的不是 Supabase 会不会答,是我们的路由等不等它 ——
所以拿一个延迟可控的假 Supabase 顶上,反而能造出真账号里碰运气才遇得到的慢/挂死。

`scripts/auth-product-profile-bootstrap.test.mjs` 那条契约锁的是**代码形状**
(bootstrap 必须在 `after()` 里、不许 await 回热路径)。它测不出响应到底早了多少、
`after()` 里的活儿有没有真的补上、8 秒超时到点会不会断。这套探针补的正是那一段。

## 起环境

```bash
SUPABASE_URL=http://127.0.0.1:54321 \
SUPABASE_ANON_KEY=fake_anon \
SUPABASE_SERVICE_ROLE_KEY=fake_service_role \
BAOHE_AUTH_ENABLED=true \
CLOUD_DB_ENABLED=true \
npx next dev -p 3000
```

⚠️ 三个键缺一不可。少了 `SUPABASE_SERVICE_ROLE_KEY`,`getCloudConfig().configured`
就是 false,bootstrap 一进门就 `cloud_not_configured` 返回 —— 表现是「profile 一次都没建」,
很容易误判成 `after()` 没生效。踩过。

## 跑

```bash
bash scripts/auth-probe/probe-session.sh      # 服务端时序(A/B/C/D 四档)
node scripts/auth-probe/probe-login-button.mjs # 登录按钮的四条退路
```

## 该看到什么

`probe-session.sh`:

| 场景 | 造的情况 | 期望 |
|---|---|---|
| A | profile 后端慢 3 秒 | session **几十毫秒**返回;`user_profiles` 的 GET/POST 落在响应**之后**,最终 201 —— 说明 `after()` 兑现了、活儿没丢 |
| B | profile 后端挂死 20 秒 | session 照样几十毫秒返回;日志里 **+8s 左右客户端主动断开** —— `AbortSignal.timeout(8000)` 生效 |
| C | user 查询慢 2 秒 | 响应用时 ≈2s(只等那一跳);响应后**不再出现第二次 `/auth/v1/user`** —— `knownUser` 生效,省掉了重复查 |
| D | 只带 refresh cookie | `session_refreshed`,几十毫秒返回;profile 同样在响应后补 |

`probe-login-button.mjs` 四档都应该是「按钮恢复可点 + 有一句能看懂的提示」,
一档都不许停在「跳转中…」。

## 两个坑(都踩过,写下来省得再踩)

- **就绪探测别打 `/auth/v1/user`**。第一版拿它探端口,结果时间线里平白多一条 user 查询,
  把我自己骗成「`knownUser` 没生效」。现在探 `/__ready`,那条不记账。
- **`pkill -f fake-supabase` 会连调用它的 shell 一起杀**(命令行里含同样字符串)。用 pid 文件。

## 本地测不到的

- 真实 Google OAuth 往返(要真凭据 + 回调域名)。
- **`after()` 在 Vercel serverless 上的行为**。本地 dev 是常驻进程,`after()` 必然跑得完;
  serverless 上是平台承诺,本地证不了。这条只能上线后查 Supabase 里有没有新 profile 行。
