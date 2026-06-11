# ADHD Flow Planner · iOS 构建与发布

将「轻推任务系统」打包为可上架 App Store 的 iOS 应用（Capacitor）。

## 前置要求

- macOS + **Xcode 15+**
- **Apple Developer** 账号
- Node.js 20+

## 1. 安装依赖

```bash
cd adhd-flow-ios
npm install
```

## 2. 部署 AI 后端（Vercel）

```bash
npm run deploy:api
```

或在 Vercel 控制台为项目设置 `GEMINI_API_KEY`，然后 Redeploy。

验证：

```bash
curl https://YOUR_URL.vercel.app/api/adhd-flow/health
```

## 3. 配置 API 地址（本地 / iOS 包）

```bash
cp config.example.js config.local.js
# 编辑：window.ADHD_FLOW_API = 'https://YOUR_URL.vercel.app';
```

## 4. 生成 iOS 工程并打开 Xcode

```bash
npx cap add ios    # 仅首次
npm run ios
```

在 Xcode 中设置 **Team** 与 **Bundle Identifier**（默认 `com.adhdflow.planner`），然后 Run / Archive。

## 5. 更新 Web 后

```bash
npm run cap:sync
```

## 架构

```
adhd-flow-ios/web/     ← Web 源码（PWA + iOS 共用）
adhd-flow-ios/www/     ← Capacitor 打包目录（自动生成）
adhd-flow-ios/ios/     ← Xcode 工程
adhd-flow-ios/api/     ← Vercel Serverless AI 代理
```

AI 不可用时，任务整理等功能会自动降级为本地规则，核心离线功能仍可用。
