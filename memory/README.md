# 念归处 · 数字纪念堂

华人数字纪念馆 — 可交互产品 + 全栈 API。

## 线上地址

| 地址 | 说明 |
|------|------|
| https://hanbing6228.github.io/DS_Profolio/memory/ | **静态演示**（中英文切换、样本纪念册；API 连 Render） |
| Render / Vercel 部署后 | **完整产品**（账号、数据库、跨设备同步） |

> GitHub Pages 曾误发布 README，已改为 workflow 部署 `public/` 目录，现已恢复完整网页。

### 一键部署完整产品（Render，免费 PostgreSQL）

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/hanbing6228/memory)

部署后在 Render 控制台设置 `NEXT_PUBLIC_APP_URL` 为你的 Render 域名，并运行一次 Seed（见 DEPLOY.md）。

### Vercel 部署

1. [导入 GitHub 仓库](https://vercel.com/new) → 选择 `hanbing6228/memory`
2. 添加 **Neon Postgres** 集成（Marketplace → Neon）
3. 环境变量：`AUTH_SECRET`（随机 32 字节）、`DATABASE_URL`（Neon 自动注入）
4. 部署完成后访问 `https://你的项目.vercel.app`

或在 GitHub Secrets 配置 `VERCEL_TOKEN`、`VERCEL_ORG_ID`、`VERCEL_PROJECT_ID` 后运行 workflow **Deploy to Vercel**。

## 本地开发（全栈）

```bash
cd memory
cp .env.example .env
# 编辑 AUTH_SECRET（至少 16 字符）
npm install
mkdir -p data
npm run db:push
npm run seed
npm run dev
# http://localhost:3000
```

演示账号：`demo@nianguichu.local` / `demo-demo-demo`  
演示纪念馆 slug：`li-mingde`

## 目录结构

```
memory/
├── app/api/           # Next.js API 路由
├── lib/               # auth、Prisma、Composio、权限隔离
├── prisma/            # SQLite schema + seed
├── public/            # 原 MVP 静态页 + P0 JS/CSS
├── scripts/           # 部署与 cron 脚本
├── .github/workflows/ # Pages + VPS CI/CD
├── DEPLOY.md          # Hostinger / Composio / Snyk 详细步骤
└── README.md
```

## P0 情感功能

1. **私人哀伤场域** — 家族/公开/仅自己 + 静默模式
2. **追思节律** — 头七、七七、周年、清明 + 邮件提醒（VPS + Composio）
3. **共建记忆** — 亲友碎片 + 家人审核
4. **祭奠心意** — 点烛/献花前写一句，汇入共祭时光
5. **创建纪念馆** — 三步向导（API 或 localStorage 回退）

## 部署

- **GitHub Pages**：`deploy-pages.yml` 仅发布 `public/`（无 API）
- **Hostinger VPS**：见 [DEPLOY.md](./DEPLOY.md)

## 环境变量

见 `.env.example`：`AUTH_SECRET`、`CRON_SECRET`、`COMPOSIO_*`、`NOTION_DATABASE_ID`

## 安全

```bash
npm audit
# 可选：snyk test && snyk code test（需 SNYK_TOKEN）
```

CI 在 `deploy-vps.yml` 中可选运行 Snyk。

## 产品文档

Notion 灵感库：[数字纪念堂产品矩阵与灵感库](https://www.notion.so/370a5a0b442e817aaaa3cbb879c90f93)
