# Render 部署 · 环境变量清单

适用于 [Render](https://render.com) 上的 **Web Service** + **PostgreSQL**（`render.yaml` Blueprint）。

生产站点示例：`https://nianguichu.onrender.com`  
GitHub Pages 静态站需额外配置 `NEXT_PUBLIC_API_URL` 指向该地址。

---

## 一、在 Render 控制台填写

路径：**Dashboard → 你的 Web Service → Environment**

### 必填（没有则无法启动 / 登录）

| 变量 | 说明 | 如何生成 |
|------|------|----------|
| `DATABASE_URL` | Postgres 连接串 | Blueprint 从数据库自动注入；手动部署时在 Render Postgres → **Connections** 复制 **Internal Database URL** |
| `AUTH_SECRET` | 会话 JWT 密钥，≥16 字符 | `openssl rand -base64 32` |
| `NEXT_PUBLIC_APP_URL` | 站点对外根 URL，**不要**末尾 `/` | `https://nianguichu.onrender.com` |

### 强烈建议

| 变量 | 说明 |
|------|------|
| `ALLOW_CROSS_ORIGIN` | 设为 `true` 时，Cookie 使用 `SameSite=None`，允许 GitHub Pages 等跨域前端带登录态调用 API |
| `CRON_SECRET` | 纪念日邮件 Cron 鉴权：`openssl rand -hex 32` |

### 支付（会员 / 商城）

| 变量 | 说明 |
|------|------|
| `STRIPE_SECRET_KEY` | 可选。配置后结算可选 Stripe（银行卡 / 支付宝 / 微信，视 Stripe 账户开通情况） |
| `PAYMENT_ALIPAY_QR_URL` | 支付宝收款码图片 HTTPS 地址（用户选「支付宝」后展示） |
| `PAYMENT_WECHAT_QR_URL` | 微信收款码图片 HTTPS 地址 |
| `PAYMENT_BANK_NAME` | 银行名称，默认「中国工商银行」 |
| `PAYMENT_BANK_ACCOUNT` | 对公账号 |
| `PAYMENT_BANK_HOLDER` | 户名 |

### 图片持久化（推荐 Render 必配）

Render 免费实例**磁盘不持久**，重启/部署后 `public/uploads` 会丢失。请使用 **Cloudflare R2** 或任意 S3 兼容存储：

| 变量 | 说明 |
|------|------|
| `S3_BUCKET` | 桶名 |
| `S3_ACCESS_KEY_ID` | Access Key |
| `S3_SECRET_ACCESS_KEY` | Secret Key |
| `S3_ENDPOINT` | R2 示例：`https://<account_id>.r2.cloudflarestorage.com` |
| `S3_REGION` | R2 可填 `auto` 或 `us-east-1` |
| `S3_PUBLIC_URL` | 桶的**公开访问**根 URL，无末尾 `/`，例如 `https://pub-xxxx.r2.dev` 或自定义 CDN 域名 |

配置后上传照片会写入对象存储，相册 URL 为公网 HTTPS，GitHub Pages 也能显示。

### 微信网站应用登录（可选）

在微信开放平台创建 **网站应用**，配置授权回调域名为你的 API 域名（仅域名，无路径）。

| 变量 | 说明 |
|------|------|
| `WECHAT_APP_ID` | 应用 AppID |
| `WECHAT_APP_SECRET` | 应用 AppSecret |

授权回调 URL（填到微信后台）：

```text
https://nianguichu.onrender.com/api/auth/wechat/callback
```

### Composio（邮件 + Notion，可选）

| 变量 | 说明 |
|------|------|
| `COMPOSIO_API_KEY` | Composio API Key |
| `COMPOSIO_GMAIL_CONNECTED_ACCOUNT_ID` | Gmail 已连接账号 ID |
| `COMPOSIO_NOTION_CONNECTED_ACCOUNT_ID` | Notion 已连接账号 ID |
| `NOTION_DATABASE_ID` | Notion 数据库 ID |
| `MEMORIAL_EMAIL_FROM` | 发件人显示名 |

### GitHub Pages 静态镜像（仓库 Secrets，非 Render）

在 GitHub **Settings → Secrets → Actions**：

| Secret | 说明 |
|--------|------|
| `NEXT_PUBLIC_API_URL` | 与 `NEXT_PUBLIC_APP_URL` 相同，指向 Render API |

或在 `public/js/config.js` 部署前写入 Render 地址。

---

## 二、Blueprint 自动项（`render.yaml`）

| 变量 | 来源 |
|------|------|
| `DATABASE_URL` | 关联数据库 `connectionString` |
| `AUTH_SECRET` | Render **Generate** 随机值 |
| `CRON_SECRET` | Render **Generate** 随机值 |
| `ALLOW_CROSS_ORIGIN` | 默认 `true`（GitHub Pages 跨域登录） |
| `PAYMENT_BANK_NAME` | 默认「中国工商银行」 |
| `S3_REGION` | 默认 `auto` |

Blueprint 会在控制台**预置键名**（`sync: false` 的空占位）：`NEXT_PUBLIC_APP_URL`、支付收款码、S3/R2、微信、Composio 等——部署后逐项填入即可。详见仓库 [`render.yaml`](./render.yaml)。

---

## 三、部署后检查清单

```bash
# 1. 健康检查
curl -s https://nianguichu.onrender.com/api/integrations/status | jq

# 应看到 database: true，以及 payments / storage / wechatLogin 等字段

# 2. 版本（确认新代码已上线）
curl -s https://nianguichu.onrender.com/api/version

# 3. 会员商品
curl -s https://nianguichu.onrender.com/api/products | jq '.data.products[] | select(.category=="plan")'
```

浏览器验证：

1. 登录 → 会员页 → 升级高级版 → 结算金额 **¥399**（非 0）
2. 选支付宝/微信 → 进入支付指引页
3. 纪念馆上传照片 → 刷新后图片仍可打开（需已配置 S3）
4. 注册 → 获取验证码 → 完成注册
5. 若配置微信：登录页「微信」可跳转扫码

---

## 四、数据库迁移与种子

每次 schema 变更后，构建命令已包含 `prisma migrate deploy`。首次或新增会员商品后可在 Render **Shell** 执行：

```bash
npx prisma db seed
```

演示账号：`demo@nianguichu.local` / `demo-demo-demo`

---

## 五、Cron（纪念日提醒）

```bash
# 外部 cron 或 Render Cron Job（若升级付费计划）
curl -s -X POST \
  -H "Authorization: Bearer YOUR_CRON_SECRET" \
  https://nianguichu.onrender.com/api/cron/reminders
```

---

## 六、最小可运行 `.env` 示例（Render）

```env
DATABASE_URL=postgresql://...
AUTH_SECRET=your-32-byte-secret-here-minimum
NEXT_PUBLIC_APP_URL=https://nianguichu.onrender.com
ALLOW_CROSS_ORIGIN=true

# 支付收款码（至少配一种）
PAYMENT_ALIPAY_QR_URL=https://your-cdn.com/alipay-qr.png
PAYMENT_WECHAT_QR_URL=https://your-cdn.com/wechat-qr.png

# 照片持久化（R2）
S3_BUCKET=nianguichu
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_ENDPOINT=https://xxxx.r2.cloudflarestorage.com
S3_REGION=auto
S3_PUBLIC_URL=https://pub-xxxx.r2.dev
```

完整模板见仓库根目录 [`.env.example`](./.env.example)。
