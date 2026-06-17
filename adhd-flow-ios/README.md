# LifeFlow · ADHD Flow Planner

轻推任务系统 — ADHD 友好计划 App（Capacitor iOS + PWA）

| 服务 | 地址 |
|------|------|
| **GitHub** | https://github.com/hanbing6228/lifeflow |
| **线上 PWA** | https://adhd-flow-ios.vercel.app |
| **Vercel 项目** | [adhd-flow-ios](https://vercel.com/hanbing6228-3362s-projects/adhd-flow-ios) |
| **API 健康检查** | https://adhd-flow-ios.vercel.app/api/adhd-flow/health |

`main` 分支 push 到 GitHub 后，Vercel 会自动构建并部署。

## 快速开始

```bash
git clone https://github.com/hanbing6228/lifeflow.git
cd lifeflow
npm install
cp config.example.js config.local.js   # iOS 本地包需填 API 地址
npm run sync
npm run ios                              # 打开 Xcode
```

## 环境变量（Vercel）

在 [项目 Environment Variables](https://vercel.com/hanbing6228-3362s-projects/adhd-flow-ios/settings/environment-variables) 添加：

| 变量 | 说明 |
|------|------|
| `GEMINI_API_KEY` | 可选；与 `inner-shelter-ios` 相同即可（[Google AI Studio](https://aistudio.google.com/apikey)） |
| `INNER_SHELTER_API_URL` | 可选；未设置 `GEMINI_API_KEY` 时默认走 `https://inner-shelter-ios.vercel.app` 共享 AI 代理 |

未配置 `GEMINI_API_KEY` 时会自动使用 inner-shelter 代理。验证：`curl https://adhd-flow-ios.vercel.app/api/adhd-flow/health` 应显示 `"gemini":true`。

## iOS 本地 API 地址

`config.local.js`（已 gitignore）：

```javascript
window.ADHD_FLOW_API = 'https://adhd-flow-ios.vercel.app';
```

然后 `npm run cap:sync`。

## 部署方式

**推荐（已连通）**：push 到 `main` → Vercel 自动部署。

**手动**：

```bash
npm run deploy:api
```

## 文档

- [IOS-BUILD.md](./IOS-BUILD.md) — iOS 构建与 App Store 上架

## 结构

```
web/       Web 源码（PWA + iOS WebView）
api/       Vercel Serverless AI 代理
ios/       Capacitor Xcode 工程
scripts/   sync / deploy 脚本
```
