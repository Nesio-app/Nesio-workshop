# 安全说明

## 已做

- API 路由：`sanitize-html` 过滤用户输入；JWT httpOnly cookie；纪念馆按 privacy + member 隔离
- 订单：`POST /api/orders` 按商品 `slug` 从数据库取价，忽略客户端传入的价格
- API 响应头：`X-Content-Type-Options`、`X-Frame-Options`、`Referrer-Policy`
- Cron：`CRON_SECRET` Bearer 鉴权
- Next.js 已升级至 **14.2.35**（修复 14.2.5 已知 CVE）
- CI 可选 Snyk（`SNYK_TOKEN`）

## 本地审计（2026-05-30）

```bash
npm audit --audit-level=high
```

升级 Next 后剩余 **5 项**（多为 dev 依赖 `glob` / `minimatch`，来自 eslint 工具链，不影响生产 runtime）。

## 建议你在上线前完成

1. 生产环境设置强随机 `AUTH_SECRET`、`CRON_SECRET`
2. 在 GitHub Secrets 配置 `SNYK_TOKEN` 并查看 CI 报告
3. VPS 启用 HTTPS（Let's Encrypt + Nginx）
4. 勿将 `.env` 提交到仓库

## Snyk CLI（可选）

```bash
npm install -g snyk
snyk auth
snyk test
snyk code test
```
