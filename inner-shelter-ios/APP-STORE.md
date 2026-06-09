# App Store 上架资料包

复制以下内容到 [App Store Connect](https://appstoreconnect.apple.com)。

## 基本信息

| 字段 | 内容 |
|------|------|
| **App 名称** | 内在家园 |
| **副标题** | 神经友好的疗愈空间 |
| **Bundle ID** | `com.innershelter.app` |
| **SKU** | `inner-shelter-2026` |
| **主要语言** | 简体中文 |
| **类别** | 健康健美 (Health & Fitness) |
| **次要类别** | 生活方式 (Lifestyle) |
| **价格** | 免费 |
| **年龄分级** | 17+（涉及心理健康主题） |

## 推广文本（170 字以内，可随时更新）

```
专为高压下存活的你设计。闪回着陆、IFS 整合、情感画布、CBT 日记、血糖日志、夜间仪式——没有打卡催促，只有温柔陪伴。内在家园的门，永远为你敞开。
```

## 描述（4000 字以内）

```
内在家园（Inner Shelter）是一个神经友好（neuro-friendly）的个人疗愈空间，专为长期慢性压力与复杂性创伤（C-PTSD）相关体验而设计。

这不是又一个打卡应用。没有催促，没有评判，没有「你必须好起来」的压力。你可以碎掉，也可以慢慢复原。

【核心功能】

🛡️ 一键安全着陆
陷入情感闪回或情绪崩溃时，立刻进入保护模式：呼吸引导、皮特·沃克闪回管理步骤、TIPP 物理急救。

🛡️ IFS 阴影整合
识别内在挑剔者，将批判转化为理解，支持保护者去极化与清醒自我接管。

🫙 情感倾倒画布
零结构宣泄空间，AI 帮你细化情绪颗粒度。

🐾 物理锚点导航
5-4-3-2-1 接地、微动作盲盒，用身体接管解离时刻。

📓 CBT 情绪日记
六段式认知重构，每次 5 分钟。

📊 血糖日志
记录餐后血糖，10 分钟步行计时器。

🌙 夜间断电仪式
22:00 神经系统修复清单。

✨ 多巴胺商店
用自我关怀积分兑换真实身体奖励。

【隐私承诺】
• 数据默认仅存于你的设备
• 不使用广告或行为追踪
• AI 功能通过加密连接处理你主动输入的文字
• 详见隐私政策

【免责声明】
本应用是自我关怀工具，不能替代专业心理咨询或医疗诊断。如果你正处于危机中，请拨打当地心理援助热线或前往急诊。
```

## 关键词（100 字符以内，逗号分隔）

```
疗愈,心理健康,焦虑,创伤,日记,正念,血糖,睡眠,情绪,自我关怀
```

## 隐私政策 URL

部署 GitHub Pages 后使用：

```
https://hanbing6228.github.io/DS_Profolio/inner-shelter/privacy.html
```

（若仓库名不同，替换 `DS_Profolio` 为你的仓库名）

## App 隐私问卷（Privacy Nutrition Labels）

在 App Store Connect → App Privacy 中按以下填写：

| 数据类型 | 是否收集 | 用途 | 是否与用户关联 | 是否用于追踪 |
|----------|----------|------|----------------|--------------|
| 健康与健身（用户输入的血糖等） | 否（仅本地） | — | — | 否 |
| 用户内容（日记文字） | 是 | App 功能（AI 回应） | 否 | 否 |
| 标识符 | 否 | — | — | 否 |
| 使用数据 / 诊断 | 否 | — | — | 否 |

**说明**：日记与画布文字仅在用户主动触发 AI 功能时发送至服务器，不用于广告或跨应用追踪。

## 审核备注（Review Notes）

```
Inner Shelter is a personal mental wellness journal and grounding toolkit.

How to test AI features:
1. Open the app → skip onboarding
2. Tap 整合 (IFS) → type any text → tap "解构我的内在声音"
3. AI response appears below (requires network + configured API)

The app does NOT require login. All data is stored locally on device.
No camera, location, or HealthKit permissions are requested.

Test account: Not applicable (no accounts).

Contact: hanbing6228@gmail.com
```

## 截图规格

在 Xcode 模拟器或真机截图，需要以下尺寸：

| 设备 | 尺寸 | 建议截取的页面 |
|------|------|----------------|
| iPhone 6.7" | 1290 × 2796 | 首页、闪回着陆、IFS、设置 |
| iPhone 6.5" | 1242 × 2688 | 同上（可用 6.7" 缩放） |
| iPhone 5.5" | 1242 × 2208 | 首页 + 画布 |

**截图脚本（模拟器）**：

```bash
# 在 Xcode 选择 iPhone 16 Pro Max 模拟器运行后
xcrun simctl io booted screenshot ~/Desktop/is-home.png
```

建议 4–5 张：欢迎页、首页模块、闪回呼吸、情感画布、夜间仪式。

## 版本发布

| 字段 | 值 |
|------|-----|
| Version | 1.0.0 |
| Build | 1 |
| 版权 | © 2026 Jennifer Duan |
