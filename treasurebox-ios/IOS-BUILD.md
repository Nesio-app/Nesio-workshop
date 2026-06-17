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

`sync` 会生成 iOS 首发本地静态 bundle 到 `treasurebox-ios/www/`：

- `index.html`：宝盒 Shell
- `storage/`：首发 Inventory 本地流程
- `portal-config.json`：首发工具状态
- `icons/`：本地图标资源

首发 bundle 默认不注入线上 API，不连接 StoreKit，不触发真实通知，不调用真实 AI/财务/健康/心理外部服务。

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

## 本地验证

```bash
npm run sync
npm run test:ios-shell
npm run cap:sync
xcodebuild -list -project ios/App/App.xcodeproj
```

## 说明

- 首页为宝盒 Shell；高风险能力只显示为未来 / gated / 不可用。
- 首发主路径为 `收纳 Inventory`，在 App 内本地打开。
- 修改门户或秘书后：根目录改代码 → `treasurebox-ios` 里再 `npm run sync`。
