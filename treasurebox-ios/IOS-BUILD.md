# 宝盒 iOS 构建

## 前置

- macOS + Xcode
- Node.js 20+
- 仓库根目录已 `npm install`

## 同步 Web 资源

```bash
cd treasurebox-ios
npm install
npm run sync
```

`sync` 会在父目录生成 `out/`（静态导出），复制到 `www/`，并注入 API 地址：

- `https://treasurebox-nu.vercel.app`（秘书与线上 API）

## 打开 Xcode

```bash
npm run ios
```

首次需先添加 iOS 平台（若 `ios/` 不存在）：

```bash
npx cap add ios
npm run cap:sync
```

## 真机 / 模拟器

```bash
npm run ios:run
```

## 说明

- 首页为宝盒庭院，各工具链接到独立 Vercel 部署（Safari 内打开）。
- AI 秘书在 App 内走线上 `/api/secretary/chat`。
- 修改门户或秘书后：根目录改代码 → `treasurebox-ios` 里再 `npm run sync`。
