# iOS 打包计划(老 Mac + 云端 CI)

> 目标:不碰那台跑不动新 Xcode 的老 Mac,用**云端 CI**把 Nesio 出成 iOS 包 → **TestFlight**
> 装到 iPhone 17。这条路同时解锁**上架**和**端上模型测试**(端上模型是原生 App 起来之后的事)。

## 架构决定:hosted webview

Nesio 是带后端 `/api` 路由的 Next.js,**不能静态导出**(会废掉所有 API)。所以原生壳的
webview **直接加载一个远端部署**,而不是把 web 资源打进包里。原生层只加真正需要原生的东西
(端上模型 / 语音 / 视觉 / StoreKit / Apple 登录)——这几样也正好让 App 过 Apple 4.2「别只是
套网页」。

```
iPhone 17 App(Capacitor 壳)
  └─ WKWebView 加载 https://app.nesio.app  ← 合规部署(NEXT_PUBLIC_APPSTORE_BUILD=1)
  └─ 原生插件桥(后续):Foundation Models / Speech / Vision / StoreKit / Sign in with Apple
```

## 已在仓库里(我提交的,可撤、不外发)

| 文件 | 作用 |
|---|---|
| `capacitor.config.ts` | 壳配置:appId、hosted `server.url`、iOS 底色 |
| `ios-shell/index.html` | webDir 离线兜底页(server.url 不可达时显示) |
| `codemagic.yaml` | 云端流水线:装依赖 → `cap add/sync ios` → 写 Info.plist → 签名 → 出 IPA → TestFlight |
| `package.json` | 加了 `@capacitor/core`(dep)+ `@capacitor/cli`/`@capacitor/ios`(devDep) |
| `.gitignore` | 忽略 `ios/`(每次云里现生成,不入库) |

## 只能你点的(外部账号,我碰不了)

1. **Apple Developer Program**($99/年)—— 没有就注册。
2. **App Store Connect 建 App 记录**:bundle id 用 `app.nesio.ios`(与 `capacitor.config.ts` 的 `appId` 一致)。
3. **App Store Connect API Key**(.p8 + Key ID + Issuer ID)—— 给 Codemagic 自动签名 + 传 TestFlight 用。
4. **Codemagic**:注册 → 连这个仓库 → 传上面的 API Key(集成命名 `nesio_asc_key`)→ 建环境变量组 `appstore_credentials`。
5. **合规部署**:在 Vercel 建一个部署(单独 project 或分支),环境变量设 `NEXT_PUBLIC_APPSTORE_BUILD=1`,拿到域名后把 `capacitor.config.ts` 的 `server.url` 换成它(如 `https://app.nesio.app`)。
   - 这个部署会自动:藏掉 财务/健康/地图/people/Lab、显示「通过 Apple 登录」、启用 Pro 分层门控。

## 跑一次的顺序

1. 上面 1–5 备齐。
2. 在 Codemagic 触发 `ios-testflight` workflow(或推一次 commit 自动触发)。
3. 出包成功 → 自动进 TestFlight → 你 iPhone 17 装 TestFlight App 收到 → 先测「App 本身」(等于上架前真机 QA)。

## 之后才接的(原生 App 起来后)

- **StoreKit IAP**(Pro 订阅 + 恢复购买 + 服务端收据校验)→ 接 `entitlement.setProEntitlement`。见 appstore-v1-checklist §2。
- **Sign in with Apple**:web 侧已就绪(`/api/auth/start` apple 分支);提审前配 Apple Services ID + Supabase Apple provider(submission-assets §7.1)。
- **端上模型插件**(Apple Foundation Models):见 `ondevice-llm-routing-spec.md`。iOS 26 + iPhone 17 可跑;这时在真机量质量/延迟,再定路由阈值。
- **邮件写信卡插件**(EmailComposer → MFMailComposeViewController):v1 发邮件路径。
  Nesio 内弹系统写信卡、AI 预填、用户点发送 —— $0 + **免 Google 受限 scope 验证**
  (已从上架关键路径移除)。必查 `canSendMail()`:没配系统邮件账号 → 报 'none',
  web 层回退 mailto:/复制。检测点已备:`platform-capabilities.composeEmail()`。
- **Info.plist 已在 CI 写**相机/麦克风/相册/出口合规;**不加**位置/健康(v1 构建期已关)。

## 注意

- hosted webview + `server.url` 是 Apple 4.2 的审查点;靠上面那些**原生插件的实质集成**兜住,提审说明里要讲清(submission-assets §7)。别在没有任何原生功能时就提审。
- `ios/` 目录不入库,靠 `cap add ios` 每次生成;要长期定制原生工程(改 build settings 等)可改成入库一次。
