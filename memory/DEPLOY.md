# 部署指南 · 念归处

**Render 用户**：环境变量完整清单见 **[DEPLOY-RENDER.md](./DEPLOY-RENDER.md)**（支付、S3/R2 图片、微信登录）。

## 双轨部署

| 环境 | 用途 | 方式 |
|------|------|------|
| GitHub Pages | 静态演示 UI | `.github/workflows/deploy-pages.yml` → `public/` |
| Hostinger VPS | 全栈 API + 数据库 | `.github/workflows/deploy-vps.yml` |

GitHub Pages **不含** 后端 API；完整功能需在 VPS 运行 Next.js。

---

## 1. Hostinger VPS

### 1.1 在 Hostinger 面板完成

1. 购买/启用 **VPS**（建议 Ubuntu 22.04+，1GB RAM 起）
2. 绑定域名（如 `memory.yourdomain.com`）→ DNS A 记录指向 VPS IP
3. 可选：在域名列表查看已有域名，选购含 `memory` / `care` 关键词的域名

### 1.2 服务器初始化（SSH 登录后）

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs git nginx
sudo mkdir -p /var/www/nianguichu/data
sudo chown -R $USER:$USER /var/www/nianguichu
```

### 1.3 环境变量 `/var/www/nianguichu/.env`

复制 `.env.example` 并填写：

- `DATABASE_URL=file:/var/www/nianguichu/data/memorial.db`
- `AUTH_SECRET` — `openssl rand -base64 32`
- `CRON_SECRET` — `openssl rand -hex 32`
- `NEXT_PUBLIC_APP_URL=https://memory.yourdomain.com`
- Composio：`COMPOSIO_API_KEY`、Gmail/Notion connected account IDs

### 1.4 systemd 服务 `/etc/systemd/system/nianguichu.service`

```ini
[Unit]
Description=NianGuiChu Memorial
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/nianguichu
EnvironmentFile=/var/www/nianguichu/.env
ExecStart=/usr/bin/npm run start
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable nianguichu
sudo systemctl start nianguichu
```

### 1.5 Nginx 反向代理

```nginx
server {
  listen 80;
  server_name memory.yourdomain.com;
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
  }
}
```

### 1.6 GitHub Actions Secrets

| Secret | 说明 |
|--------|------|
| `DEPLOY_HOST` | VPS IP 或主机名 |
| `DEPLOY_USER` | SSH 用户 |
| `DEPLOY_SSH_KEY` | 私钥 |
| `DEPLOY_PATH` | `/var/www/nianguichu` |
| `AUTH_SECRET` | 与服务器 .env 一致 |
| `CRON_SECRET` | 定时任务鉴权 |
| `DEPLOY_URL` | `https://memory.yourdomain.com` |
| `SNYK_TOKEN` | 可选，CI 安全扫描 |

---

## 2. Composio（Gmail + Notion）

1. 注册 [Composio](https://app.composio.dev)
2. 连接 **Gmail** 与 **Notion** 集成
3. 复制 Connected Account ID 到 `.env`
4. 在 Notion 创建数据库（列：纪念馆 title、留言者、关系、年份、内容、状态、链接）
5. 将 Database ID 填入 `NOTION_DATABASE_ID`

验证：`curl http://localhost:3000/api/integrations/status`

---

## 3. 纪念日 Cron

```bash
# crontab -e
0 8 * * * curl -s -X POST -H "Authorization: Bearer YOUR_CRON_SECRET" https://memory.yourdomain.com/api/cron/reminders
```

---

## 4. Snyk 安全扫描

```bash
npm install -g snyk
snyk auth
cd /path/to/memory
snyk test
snyk code test
```

CI 已在 `deploy-vps.yml` 中集成（需 `SNYK_TOKEN` secret）。

---

## 5. 本地开发

```bash
cp .env.example .env
npm install
mkdir -p data
npm run db:push
npm run seed
npm run dev
```

演示账号：`demo@nianguichu.local` / `demo-demo-demo`
