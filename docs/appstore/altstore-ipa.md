# AltStore 自签 .ipa（仅 iPhone）

> 目标：本机出 Development / Ad Hoc `.ipa`，用 AltStore 装到自己的 iPhone。  
> **不走** App Store / TestFlight / Codemagic（那些见 `ios-packaging-plan.md`）。

## 前提

- macOS + Xcode（本机已验证可用）
- Apple ID（免费可签约 7 天；付费 Developer 更稳）
- iPhone 上已装 [AltStore](https://altstore.io/)
- 壳加载现网：`https://treasurebox-nu.vercel.app`（`capacitor.config.ts` → `server.url`）

## 出包（一次）

在仓库根目录：

```bash
npm ci   # 或 npm install
npx cap add ios   # 仅首次；ios/ 已在 .gitignore
npx cap sync ios
npx cap open ios
```

在 Xcode：

1. 选中 **App** target → **Signing & Capabilities**
2. Team 选你的 Apple ID（Personal Team 即可）
3. Bundle Identifier 保持 `app.nesio.ios`（若免费账号冲突，临时改成唯一 id，如 `app.nesio.ios.你的名字`）
4. 顶部设备选 **Any iOS Device (arm64)**（或插上的真机）
5. **Product → Archive**
6. Organizer → **Distribute App** → **Development**（或 Ad Hoc）→ 导出 `.ipa`

## 装到手机

1. 把 `.ipa` 拷到装了 AltStore 的电脑/手机
2. AltStore → **My Apps** → **+** → 选该 `.ipa`
3. iPhone：**设置 → 通用 → VPN 与设备管理** → 信任该开发者证书

免费证书约 **7 天**过期；AltStore 连着电脑或开了刷新时可自动续签。

## 改完 Web 要不要重打？

- 只改了线上 Web / API：**不用**重打 IPA（壳仍加载同一 `server.url`）。
- 改了 `capacitor.config.ts`、原生插件、图标、权限文案：再跑 `npx cap sync ios` → Archive。

## 隐私权限（相机闪退必查）

`cap add ios` 生成的 `Info.plist` **默认没有**相机/相册用途说明。缺 `NSCameraUsageDescription` 时，点 📷 调 `getUserMedia` 会被 iOS **直接杀进程（闪退）**。

```bash
npx cap sync ios
node scripts/patch-ios-privacy-plist.mjs
```

然后重新 Archive / Sideloadly 安装。Codemagic 流水线里已有同等 PlistBuddy 写入。

## 不要做

- 不要指望 `npm run build` 静态塞进壳（会废掉 `/api`）。
- 不要为 AltStore 去配 App Store Connect / Codemagic（除非你接下来要上 TestFlight）。
