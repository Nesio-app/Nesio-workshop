# App Store v1 上架看板 · 2026-07(免费 + Pro,iOS)

前提:免费上线 checklist(`free-launch-checklist.md`)全部适用。这里只列**上架这一步新增**的,重点标**会致命 / 长周期**的雷。
图例:🔴 会被拒/封号 · 🟠 高频退回 · 🟡 上线后补 · ☐ 待办。

## v1 功能分层(产品决策)

| 层 | 功能 |
|---|---|
| **免费** | 拍一拍(端上识别)· 说一句(端上 ASR)· 分享 · 问一问(**退语义搜索**)· 洞察 · 未来预测 · 今日聚焦 · 冷冻仓? |
| **Pro** | 拍照 **AI**(云视觉)· 问问 **AI**(RAG 问答)· **AI routine** · **邮件问问直接回复** · 冷冻仓 |
| **v1 隐藏(两层都不给)** | 财务 · 地图/足迹 · 健康 · 实验室 · people · family |
| **已砍** | Family Sharing(不开 → **删 UI**)· 外部支付/Stripe(数字订阅**必须 IAP**) |

## ⚠️ 三颗致命雷(先看)

1. 🔴 **Sign in with Apple 强制**:用了 Google/微信登录 → Guideline 4.8 强制必须**同时**提供「用 Apple 登录」,否则直接拒。
2. 🔴 **Pro 订阅必须走 Apple IAP(StoreKit)**:数字功能订阅不能用 Stripe/外部支付(3.1.1),抽 15–30%。Plaid 是"连银行数据"、与此**无关**,别混。
3. 🔴 **"藏 UI 但功能还能用" = 违规**:审核按**能力**判,不按 UI。见下节。

## 审核安全:为什么"藏 UI"不够(核心)

苹果**不看源码、不要你交 code**,但:像用户一样跑 App + 对**二进制做静态/动态分析**(链了哪些框架/声明了哪些权限/entitlement/访问了哪些数据)+ 核对**行为 vs 隐私标签/权限用途/描述**是否吻合。

两条规则**跟 UI 无关,看"App 能做什么"**:
- **Guideline 2.3.1 禁隐藏/未公开功能**:Lab 那种"藏起来但还能被触达、还在干活"的入口 = 直接违规,过审后远程打开尤其严(可封号)。
- **隐私按能力判**:健康/财务/位置/people 是最高敏感。若代码**仍有能力**访问但 UI 藏了、Info.plist 还留着用途说明 → **不匹配 → 拒**("不显示地图的 App 为何要位置权限?")。隐私营养标签必须反映**实际能访问**的数据,不是 UI 显示的。

| 做法 | 安全吗 |
|---|---|
| 只 `display:none` 藏入口,代码照跑、Lab 还能进 | 🔴 违 2.3.1 + 隐私 |
| **构建期开关真关掉**(编译标志/tree-shake),功能不可达 + **不请求其权限/不链其框架/删对应 Info.plist 用途说明** | 🟢 |
| 纯**不可达死代码**(不带任何权限/框架) | 🟢(不用删每行) |
| 远程配置事后打开隐藏功能 | 🔴 明确违规 |

**这个 app 具体要做**:
- [ ] 🔴 **App Store 构建单独开关**:财务/地图/健康/people/足迹/family/实验室 **构建期彻底关**(不是藏 UI)→ 审核版真进不去、不请求对应权限。
- [ ] 🔴 **Lab 入口从提审包移除**;想内部继续用 → **单独 TestFlight 内测构建**,不在提审二进制里留后门。
- [ ] 🔴 删对应 Info.plist 用途说明 + 不链对应框架(HealthKit 等)+ 去孤儿 entitlement。
- [ ] 隐私标签/描述只写这一版**真能用**的功能。
- [ ] **提审前自查**:审核版里隐藏功能真点不进(非藏 UI)· Info.plist 只剩在用权限 · 没链不用的框架 · 隐私标签=实际数据访问 · 描述=实际能做 · 内部 Lab 走另一个构建。

> 代码机制建议:加 `NEXT_PUBLIC_APPSTORE_BUILD` 构建标志 → 命中时把 v1 隐藏集并入不可达集(类似现有 `RETIRED_MODULE_IDS`,但盖过一切且**开关中心不可强制开**)+ 隐藏 Lab 入口。这是纯 web 代码、无需 Capacitor 就能先做。

## 1. 原生打包(PWA → App Store)🔴

- [ ] Capacitor 包壳 + 原生插件(端上 ASR/Vision/Apple 智能、Web Push、相机、IAP)
- [ ] 云端 CI 出包(Xcode 26;老 Mac 只写代码)
- [ ] Info.plist 用途说明:麦克风/相机/位置/通知每个都写(缺一崩/拒)
- [ ] 出口合规 `ITSAppUsesNonExemptEncryption`
- [ ] 最小功能性:用原生推送/端上 ML/相机/IAP 做**实质集成**,审核说明里讲清(防"纯网页套壳"拒)

## 2. 付费墙 / 订阅(StoreKit)🔴 —— 最大新工作量

- [ ] App Store Connect 配 Pro 商品(月/年 · 分区定价)
- [ ] StoreKit 2 接入 + 购买流程
- [ ] 🔴 **恢复购买**(没有=拒)
- [ ] 🔴 **服务端收据校验 → 同步 entitlements**(Pro 权限别只存 localStorage,防篡改;客户端 + 服务端**双验**)
- [ ] 免费试用/引导优惠
- [ ] 订阅管理入口、升/降级、宽限期
- [ ] Family Sharing **不开 → 删 UI**
- [ ] 所有 Pro 功能门控挂**已验证订阅 entitlement**

## 3. 审核合规(高频被拒)🔴

- [x] 🔴 Sign in with Apple(雷 1)—— **代码侧完成**(663c163):`/api/auth/start` 支持 apple
      provider(Supabase Apple OAuth),登录页仅 App Store 构建显示「通过 Apple 登录」按钮
      (HIG 黑底)。⬜ **提审前**:Apple Services ID + Key + Supabase Apple provider 配置
      (见 `docs/appstore/submission-assets.md` §7.1)。
- [x] 🔴 **App 内账号删除**(5.1.1)—— **完成**(3759cf9):隐私与数据面板「删除账号与云端
      数据」按钮 → `/api/user-data/delete` → 清本机 → 登出。云删失败如实报,不谎称成功。
- [ ] 隐私营养标签(健康/财务/邮件 = 重点审)+ 隐私政策 URL
- [ ] 🟠 给审核员 **Demo 账号 / Pro 解锁**(reviewer 得能测 Pro,否则退回)
- [ ] 年龄分级问卷、内容权利声明
- [ ] 健康:说明是**导入 Apple Health 导出文件**(非 HealthKit API);将来用 HealthKit 有额外规则

## 4. Pro 功能就绪(逐个:能跑 + 正确门控)🔴

- [ ] 拍照 AI(免费端上 / Pro 云,门控正确)
- [ ] 问问 AI(免费语义搜索 / Pro RAG 问答)
- [ ] AI routine(完成 + 门控)
- [ ] 邮件问问直接回复(**依赖 Gmail 发送权限的 Google 验证 → 今天启动**)
- [ ] 冷冻仓(完成 + 门控)
- [ ] 每个 Pro 功能在免费用户点击时有干净的「升级 Pro」引导(**不是报错**)

## 5. 长周期第三方(今天启动,别卡末尾)🔴

- [ ] 🔴 **Gmail 发送权限 Google 验证/OAuth 审核**(否则"邮件直接回复"上不了 · 数周)
- [ ] Apple Developer Program（$99/年,若没注册）
- [ ] Pro 会打付费云 LLM → 确认后端/额度扛得住(成本护栏对**免费**;Pro 是真花钱那侧)

## 6. App Store Connect 资料

- [ ] 截图(含 iPhone 17 等所有必需尺寸)+ 预览视频
- [ ] 描述/关键词/副标题/推广文案（zh-Hans + en 双语)
- [ ] Support / Marketing / 隐私政策 URL
- [ ] "本次更新内容"

## 7. 发布策略

- [ ] TestFlight 外部 beta(iPhone 17 真机 + **IAP 沙盒**测试)
- [ ] 分阶段发布 + 盯 激活/留存/订阅转化 + **收据同步失败率**
- [ ] Kill-switch(已有 launch-safety;线上炸了能关)

## 依赖顺序

```
今天启动:Gmail 发送权限 Google 验证(数周) · Apple Developer 注册
   ↓ 并行
Capacitor 打包 + StoreKit 集成(最大工作量) + Sign in with Apple + 账号删除
+ App Store 构建开关(v1 隐藏集真不可达 + 移除 Lab)  ← 纯 web 可先做
   ↓
Pro 功能门控挂 entitlement(客户端+服务端双验) + Demo 账号
   ↓
ASC 资料 + 隐私标签 + 截图
   ↓
TestFlight(IAP 沙盒 + iPhone 17 真机) → 提审 → 分阶段放量
```

## 一句话

免费版是"面对陌生用户";Pro + 上架是"面对苹果和 Google 的规则"。新增就三大块:① 原生打包(Capacitor + 云 CI)② StoreKit 订阅(最大 + 必须 IAP)③ 强制合规(Sign in with Apple / 账号删除 / 隐私标签 / Demo 账号);外加今天必须启动的长周期项:Gmail 发送权限 Google 验证。**审核红线:那些"隐藏但可达"的功能(尤其 Lab)必须在提审包里真关掉。**
