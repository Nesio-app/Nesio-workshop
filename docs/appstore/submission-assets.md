# App Store 提交素材 · 待填/草稿(Nesio v1)

上架前**文件准备**。技术项见 `docs/design/appstore-v1-checklist.md`。
草稿可直接用 / 微调;标 ⬜ 的需人工产出(截图/视频等需真机)。

## 1. App 基本信息

| 字段 | 值 |
|---|---|
| App 名称 | Nesio |
| 副标题(zh) | 你的生活百宝箱 · 本地优先 |
| 副标题(en) | Your life toolbox · local-first |
| 主分类 | 效率(Productivity) |
| 次分类 | 健康健美(暂不选 —— v1 隐藏健康,避免隐私审核加码) |
| 年龄分级 | 4+（无成人/暴力/博彩内容;问卷全选无） |

## 2. 描述(zh-Hans)

> Nesio 是你的个人生活百宝箱 —— 拍一张、说一句、分享一条,它就帮你记下、看懂、想起。
>
> · 拍一拍:随手拍照,自动识别打标、可搜。
> · 说一句:开口即记,端上转写成可搜笔记。
> · 今日聚焦:注意力引擎帮你排出今天真正要紧的事。
> · 洞察 & 未来预测:从你的记录里发现节律与趋势。
> · 冷冻仓:想冲动买的先冻起来,给自己一个冷静期。
>
> 本地优先 —— 你的数据存在自己手机上,不登录也能用。
>
> Pro:解锁 AI 拍照理解、对话式问答、AI 日程、邮件直接回复。

## 3. 描述(en)

> Nesio is your personal life toolbox — snap a photo, say a line, share a link, and it captures, understands, and resurfaces it for you.
>
> · Snap: auto-tag and search your photos.
> · Speak: on-device transcription into searchable notes.
> · Today Focus: an attention engine surfaces what actually matters today.
> · Insights & Forecast: find rhythms and trends in your own records.
> · Freeze Vault: freeze impulse buys for a cooling-off period.
>
> Local-first — your data lives on your device; works without an account.
>
> Pro: AI photo understanding, conversational Q&A, AI routines, direct email replies.

## 4. 关键词(100 字符内,逗号分隔)

`zh`: 记录,笔记,生活,日记,效率,拍照记录,语音笔记,本地优先,隐私,洞察
`en`: journal,notes,life,memory,productivity,voice notes,local-first,privacy,insights,capture

## 5. 隐私营养标签(App Privacy)—— 按**这一版实际能访问**填

> 提审构建已 build-flag 隐藏 财务/健康/地图/实验室/people **且不可达** → 隐私标签**不申报**这些数据类型。只申报 v1 真在用的:

| 数据类型 | 是否收集 | 用途 | 关联身份 | 用于追踪 |
|---|---|---|---|---|
| 照片(拍一拍) | 是·**仅本机** | App 功能 | 否 | 否 |
| 音频(说一句) | 是·**仅本机/端上转写** | App 功能 | 否 | 否 |
| 用户内容(笔记) | 是·**仅本机** | App 功能 | 否 | 否 |
| 粗略/精确位置 | **否**(v1 地图隐藏且不可达 → 不请求权限) | — | — | — |
| 健康 | **否**(v1 健康隐藏且不可达) | — | — | — |
| 邮箱地址(登录) | 是 | App 功能/账号 | 是 | 否 |
| 诊断/使用数据 | 是·匿名聚合 | 分析 | 否 | 否 |

⚠️ 关键:Info.plist **不得**留位置/健康的用途说明(功能已构建期关掉);隐私标签必须 = 实际能访问,否则不匹配被拒。

## 6. Info.plist 用途说明(仅 v1 在用的)

```
NSCameraUsageDescription = 用于「拍一拍」记录物品与场景。
NSMicrophoneUsageDescription = 用于「说一句」语音记录。
NSPhotoLibraryUsageDescription = 用于从相册选取照片记录。
NSUserNotificationsUsageDescription = 用于每日回顾与提醒推送。
ITSAppUsesNonExemptEncryption = false   # 仅用标准 HTTPS,无自研加密
# ❌ 不加:NSLocationWhenInUseUsageDescription / NSHealthShareUsageDescription
#    —— v1 地图/健康已构建期关闭,留了会「有权限没功能」被质疑
```

## 7. 审核员备注(App Review Notes)· 草稿

> - Demo 账号:reviewer@nesio.app / (密码待建);已解锁 Pro,可测试 AI 拍照/问答/routine/邮件回复/冷冻仓。
> - 健康数据:本 App **不使用 HealthKit**;健康相关为用户手动导入 Apple Health 导出文件(v1 该功能已隐藏)。
> - 订阅:Pro 走 App 内购(StoreKit);无外部支付。含「恢复购买」。
> - 本地优先:核心数据存设备本机,不登录可用;登录仅用于可选云备份 + 邮件功能。
> - Sign in with Apple 已提供(与 Google 登录并列)。

### 7.1 Sign in with Apple —— 提交前必做的服务端配置(⬜)

代码侧已完成:App Store 构建(`NEXT_PUBLIC_APPSTORE_BUILD=1`)的登录页顶部渲染
「Sign in with Apple」按钮(HIG 黑底 + Apple logo),走 `/api/auth/start` 的 `apple`
分支 → Supabase Apple OAuth authorize 端点(与 Google 同一路径)。Web PWA 构建不显示,
避免暴露未配置的 provider。

**上架前必须在 Apple + Supabase 两侧配置,否则点按钮会落到 Supabase 报错页:**
- [ ] Apple Developer:建 **Services ID**(如 `app.nesio.signin`),开 Sign in with Apple,
      Return URL 填 `https://<你的-supabase-ref>.supabase.co/auth/v1/callback`。
- [ ] Apple Developer:建 **Key**(Sign in with Apple),下载 `.p8`,记 Key ID + Team ID。
- [ ] Supabase Dashboard → Authentication → Providers → **Apple**:填 Services ID(client id)
      + 用 .p8/Key ID/Team ID 生成的 client secret(JWT),启用。
- [ ] 原生壳(Capacitor)内跑通 Apple OAuth 回跳(webview 内 redirect 流可用;若走原生
      ASAuthorization 需另接插件,当前用 web-redirect 流即满足 4.8)。

## 8. URL

| 字段 | 值 |
|---|---|
| Support URL | https://www.nesio.app/support ✅(`app/support/page.tsx`,双语 FAQ + 联系) |
| Marketing URL | https://www.nesio.app |
| Privacy Policy URL | https://www.nesio.app/privacy ✅(`app/privacy/page.tsx`,双语完整政策,与 §5 标签一致) |

> ⬜ 提审前:`support@nesio.app` 需真实可收信箱(政策与支持页均用它);部署后确认
> `/privacy` 与 `/support` 在 www.nesio.app 可公开打开(苹果/Google 会抓取)。

## 9. 需真机/人工产出(⬜)

- ⬜ 截图:iPhone 6.9"(iPhone 17 Pro Max 等)+ 6.5" 必需尺寸,每语言 3–10 张。**Shot list**:①今日聚焦首屏 ②拍一拍→自动打标 ③洞察卡 ④问一问 ⑤Pro 升级页。
- ⬜ App 预览视频(可选,15–30s)。
- ✅ App 图标 1024×1024:`public/appstore/nesio-icon-1024.png`(**不透明**无 alpha,深蓝渐变底 +
  发光立方,草稿可替换)。由 `node scripts/gen-appstore-icons.mjs` 从 `nesio-mark.svg` 生成,
  同时刷新 PWA 图标(`/icons/nesio-pwa-{192,512,512-maskable}.png`、`nesio-apple-touch-180.png`)
  与 manifest/layout 引用(此前仍指向旧 `treasurebox-*`)。
- ⬜ "本次更新内容"文案(首发写产品简介)。

## 10. 提审前最终自查(与 appstore-v1-checklist 对齐)

- [ ] 提审构建 `NEXT_PUBLIC_APPSTORE_BUILD=1`:Lab / 财务/健康/地图/实验室/people **真点不进**(已由构建开关保证,发版前跑一遍确认)
- [ ] Info.plist 只剩上面 6 条(无位置/健康)
- [ ] 隐私标签 = 第 5 节(无位置/健康)
- [ ] 描述 = App 实际能做(不含隐藏功能)
- [ ] Demo 账号能测所有 Pro 功能
- [ ] Sign in with Apple + IAP 恢复购买 + App 内账号删除 都在
