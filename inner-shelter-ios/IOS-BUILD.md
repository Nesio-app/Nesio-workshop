# Inner Shelter · iOS App 构建指南

将 `内在家园` 打包为可上架 App Store 的 iOS 原生应用（Capacitor）。

## 前置要求

- macOS + **Xcode 15+**
- **Apple Developer** 账号（真机测试 / 上架）
- Node.js 20+
- 已部署的 AI API（Vercel，见下文）

## 1. 部署 AI 后端（Vercel）

iOS 应用内嵌静态页面，AI 需走远程 API。

```bash
cd inner-shelter-ios
npm install
npx vercel login          # 首次
npx vercel --prod
```

在 Vercel 项目设置中添加环境变量：

| 变量 | 值 |
|------|-----|
| `GEMINI_API_KEY` | **推荐** — [Google AI Studio](https://aistudio.google.com/apikey) 密钥 |
| `OPENAI_API_KEY` | 可选 — 未设置 Gemini 时使用 |

部署完成后记下 URL，例如：`https://inner-shelter-api.vercel.app`

验证：

```bash
curl -X POST https://YOUR_URL.vercel.app/api/inner-shelter/chat \
  -H "Content-Type: application/json" \
  -d '{"system":"test","user":"hi"}'
```

## 2. 配置 API 地址

```bash
cp config.example.js config.local.js
```

编辑 `config.local.js`：

```javascript
window.INNER_SHELTER_API = 'https://YOUR_URL.vercel.app';
```

## 3. 同步并打开 Xcode

```bash
npm run sync          # 复制 Web 资源到 www/
npx cap add ios       # 首次：生成 ios/ 工程
npm run ios           # sync + 打开 Xcode
```

在 Xcode 中：

1. 选择 **App** target → **Signing & Capabilities**
2. 设置你的 **Team** 和 **Bundle Identifier**（默认 `com.innershelter.app`）
3. 选择模拟器或真机 → **▶ Run**

## 4. 生成应用图标（可选）

```bash
# 需要 1024×1024 icon.png，可从 resources/icon.svg 导出
npm run assets
```

## 5. App Store 上架

详细资料见同目录文档：

| 文档 | 内容 |
|------|------|
| [APP-STORE.md](./APP-STORE.md) | 描述、关键词、隐私问卷、截图、审核备注 |
| [SIGNING.md](./SIGNING.md) | Apple Developer 证书与 Xcode 签名 |
| [privacy.html](../public/inner-shelter/privacy.html) | 隐私政策页面 |

快速清单：

- [ ] `npm run deploy:api` 部署 AI 后端
- [ ] [SIGNING.md](./SIGNING.md) 配置签名
- [ ] [APP-STORE.md](./APP-STORE.md) 填写 App Store Connect
- [ ] 隐私政策 URL 指向 GitHub Pages 上的 `inner-shelter/privacy.html`
- [ ] Archive → Distribute App → App Store Connect

## 常用命令

| 命令 | 说明 |
|------|------|
| `npm run sync` | 从 `public/inner-shelter/` 同步到 `www/` |
| `npm run cap:sync` | sync + 更新 iOS 原生工程 |
| `npm run ios` | 打开 Xcode |
| `npx cap run ios` | 命令行构建并运行 |

## 更新 Web 内容后

修改 `public/inner-shelter/` 后执行：

```bash
cd inner-shelter-ios
npm run cap:sync
```

再在 Xcode 中重新 Run / Archive。

## 架构说明

```
public/inner-shelter/     ← Web 源码（PWA + iOS 共用）
inner-shelter-ios/www/    ← Capacitor 打包目录（自动生成）
inner-shelter-ios/ios/    ← Xcode 工程（cap add ios 生成）
inner-shelter-ios/api/    ← Vercel Serverless AI 代理
```

AI 无网络或 API 未配置时，应用自动使用内置温柔 fallback 文案，核心功能不受影响。
