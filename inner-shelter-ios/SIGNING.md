# Apple Developer 签名与证书配置

## 1. 注册 Bundle ID

1. 登录 [Apple Developer](https://developer.apple.com/account)
2. **Certificates, Identifiers & Profiles** → **Identifiers** → **+**
3. 选择 **App IDs** → **App**
4. 填写：
   - Description: `Inner Shelter`
   - Bundle ID: `com.innershelter.app`（Explicit）
5. 不需要勾选额外 Capabilities（本应用无推送、HealthKit 等）
6. **Register**

## 2. 在 App Store Connect 创建 App

1. [App Store Connect](https://appstoreconnect.apple.com) → **我的 App** → **+**
2. 平台：iOS
3. 名称：内在家园
4. 主要语言：简体中文
5. Bundle ID：选择 `com.innershelter.app`
6. SKU：`inner-shelter-2026`

## 3. Xcode 签名（Automatic Signing 推荐）

1. 打开工程：
   ```bash
   cd inner-shelter-ios
   npm run ios
   ```
2. 左侧选中 **App** 工程 → **App** target → **Signing & Capabilities**
3. 勾选 **Automatically manage signing**
4. **Team**：选择你的 Apple Developer Team
5. **Bundle Identifier**：`com.innershelter.app`
6. 若提示 "Register Device"，点 **Register**

### 真机调试

- 用 USB 连接 iPhone → 在 Xcode 顶部选择你的设备 → **▶ Run**
- 首次需在 iPhone **设置 → 通用 → VPN与设备管理** 信任开发者证书

## 4. 打包上传 App Store

1. Xcode 顶部设备选 **Any iOS Device (arm64)**
2. **Product → Archive**
3. Archive 完成后 → **Distribute App**
4. 选择 **App Store Connect** → **Upload**
5. 保持默认选项（含符号上传、Bitcode 关闭）
6. 上传成功后，在 App Store Connect → **TestFlight** 或 **App Store** 标签提交审核

### 命令行打包（可选）

```bash
cd inner-shelter-ios/ios/App
xcodebuild -scheme App \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath build/InnerShelter.xcarchive \
  archive

xcodebuild -exportArchive \
  -archivePath build/InnerShelter.xcarchive \
  -exportPath build/export \
  -exportOptionsPlist ../../ExportOptions.plist
```

## 5. 常见问题

| 问题 | 解决 |
|------|------|
| No signing certificate | Xcode → Settings → Accounts → 下载 Manual Profiles |
| Bundle ID 已被占用 | 改为 `com.yourname.innershelter` 并同步改 `capacitor.config.ts` 的 `appId` |
| Archive 灰色 | 设备选 "Any iOS Device"，不要选模拟器 |
| 上传后缺少合规 | App Store Connect → 出口合规 → 选「否」加密（已在 Info.plist 声明） |

## 6. 修改 Bundle ID（若需要）

若 `com.innershelter.app` 不可用：

1. 编辑 `inner-shelter-ios/capacitor.config.ts` → `appId`
2. 运行 `npx cap sync ios`
3. 在 Xcode 中更新 Signing 的 Bundle Identifier
4. 在 Apple Developer 注册新 Bundle ID
