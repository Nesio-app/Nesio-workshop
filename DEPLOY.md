# Deploy — Nesio / 宝盒

生产部署在 **Vercel**(`vercel.json`, `framework: nextjs`)。不是 GitHub Pages。

## 部署方式

Vercel 通过 Git 集成自动部署:

- 推到 `main` → 生产部署;推到其他分支 / 开 PR → 预览部署。
- 构建命令:`npm run build`(= `check:leak` + `bundle:toolbox` + `next build`,见 `package.json`)。
- 安装命令:`npm ci`。
- 兄弟 web 子应用(adhd-flow / fitness / storage / health)由 `bundle:toolbox` 构建时拷进 `public/`,并在 `vercel.json` 里 rewrite 到各自的 `index.html`。

GitHub Actions 的 `.github/workflows/deploy.yml`("Release Verification")在每次 push
跑 `test:security` + `next build` 做**验证**(失败开 ci-failure issue),部署本身由 Vercel Git 集成完成。

## 环境变量(在 Vercel 项目设置里配,切勿提交真实密钥)

按需配置(全缺 = 纯本地/个人模式,UI 开放、云功能关闭):

| 用途 | 变量 |
|---|---|
| AI 供应商 | `ANTHROPIC_API_KEY`(优先)/ `GEMINI_API_KEY` / `OPENAI_API_KEY` |
| 后端/云(Supabase) | `SUPABASE_URL`、`SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY`、`SUPABASE_STORAGE_BUCKET`、`CLOUD_DB_ENABLED`、`CLOUD_STORAGE_ENABLED` |
| 登录 | `BAOHE_AUTH_ENABLED`、`BAOHE_AUTH_REDIRECT_URL`、`GOOGLE_CLIENT_ID/SECRET`、`WECHAT_*` |
| 连接器 | Google(日历/Gmail/Drive)、`NOTION_CLIENT_ID/SECRET`、Plaid、`FLOMO_API_KEY`、`GOOGLE_MAPS_API_KEY` |
| 管理面板 | `NESIO_ADMIN_SECRET` |
| Stage-5 代理动作 | `NESIO_STAGE5_INVOCATION_SECRET`(+ CEO 双 env 门) |

完整占位见 `.env.example`(仅本地/内部沙盒用途,不放真实密钥)。

## Supabase schema

云功能激活需在 Supabase SQL Editor 跑 schema bundle:
`node scripts/supabase-schema-bundle.mjs`(生成物,勿手改;加表 = 新建 canonical 源再生成)。

## 监控

`.github/workflows/uptime.yml` 每 15 分钟探生产端点(含负向安全断言 `/secretary` 必须 403),
异常自动开/关 `prod-down` issue。

## 本地预览生产构建

```bash
BASE_PATH=/treasurebox npm run build   # basePath 见 next.config.js
npm run start
```
