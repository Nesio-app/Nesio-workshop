# 生产 QA 发现(2026-07-04,www.nesio.app)

> /qa-only 模式:只报告不修。每项含复现路径,可直接作为修复会话的输入。
> 修复后把状态改为 fixed 并注 commit。

## P1 — 匿名遥测全军覆没(决策盲区)

- **现象**:匿名访客的所有 `POST /api/telemetry` 返回 401。
- **影响**:demo 模式、onboarding 漏斗(brief_play demo、tips 完成率、激活步转化)
  的数据一条都收不到——恰恰是最需要看的增长数据。
- **根因**:app/api/telemetry/route.ts 用 isPortalRequestAuthorized 门(要求登录态),
  但路由头注释自述设计是「anonymous per-device id」——实现与意图矛盾。
- **需要决策**:A)放开匿名遥测(保留限流+同源检查,事件本身无内容只有计数,隐私安全);
  B)维持登录后才收集,那客户端 track() 应在未登录时不发(消 401 噪音)。
- **状态**:open

## P2 — 匿名写入触发云镜像 401 噪音

- **现象**:匿名用户每次记录(快速添加/激活步)触发 `POST /api/cloud/signals` 401×2。
- **影响**:console 报错噪音 + 无效请求;本地写入不受影响(fail-closed 正确)。
- **根因**:create-signal.ts signalWriteMode() 只判 `typeof window`,不判登录态;
  writeCloudSignal 对匿名用户注定失败却照发。
- **修法**:writeCloudSignal 前检查 baohe_auth_access cookie 存在(document.cookie 不可读
  httpOnly——改为读 auth-client 的会话缓存状态,或 401 一次后本会话降级不再发)。
- **状态**:open

## P2 — 听简报无 watchdog,引擎哑火时 UI 无失败态

- **现象**:DailyBriefCard.playWithBrowserTTS 的 Promise 依赖 utterance 回调
  (onstart/onend/onerror);speechSynthesis 引擎不可用时(部分 Android WebView、
  无语音包设备、headless)回调永不触发,UI 停在无反馈状态。
- **证据**:headless Chromium 上点击听简报 100% 挂起渲染器(QA 中 3/3 复现)。
  真机概率低但存在。违反设计红线「每个异步动作必有可见失败态」。
- **修法**:speak() 后起 8s watchdog,onstart 未触发则 cancel + setErrorMsg + error 态。
- **状态**:open

## P3 — 中文语音选取时序问题

- **现象**:getVoices() 在 Chrome 首次调用常返回空数组(语音列表异步加载,
  需监听 voiceschanged),cnVoice 选不上 → 可能用默认英文音读中文脚本。
- **修法**:voices 为空时等 voiceschanged(带超时)再 speak。
- **状态**:open

## P3 — 顶部双按钮视觉不对称

- **现象**:移动端 375px 下「听简报」是圆钮,「此刻」被 flex 拉伸成通栏长条,
  与「双圆按钮」设计意图不符(nesio-mood-circle 类名 vs 实际矩形)。
- **确认**:是否有意为之;若否,给 nesio-mood-circle 定宽或 flex:none。
- **状态**:open(先确认设计意图)

## P3 — manifest 路径确认

- **现象**:/manifest.webmanifest 404,/manifest.json 200。
- **确认**:HTML `<link rel=manifest>` 指向哪个;若指 manifest.json 则无事,
  PWA 安装流程真机验证一次即闭环。
- **状态**:open(仅需确认)

## 全绿项(不需要动)

- Onboarding 全流程:欢迎(zh/en 切换)→ 称呼(模板问候)→ 登录跳过 →
  tips → 激活步「存首条记忆→找回」;激活写入同时落 LifeGraph + IDB 事实库
  (**cutover 在生产端到端验证通过**)
- Today:今日焦点、快速添加即时上屏、折叠区、此刻 sheet 开/关
- Memory:页面、搜索框、卡片渲染
- 设置:表达方式 sheet(语气/主题/语言)、我的数据 sheet(导出/导入/删除/Lab/主权)、
  日↔夜主题切换即时生效(--portal-bg #f4f8fd ↔ #0e1626)、zh↔en 即时切换
- 安全:/secretary 对公众 403、AI 路由匿名 401、跨域 Origin 拒、
  CSP/HSTS/X-Frame-Options/nosniff/Referrer-Policy 全套在
- 移动端 375px:无横向溢出、底部导航贴底、布局正常
- 零 JS 运行时错误(除上述两类 401 网络噪音)
