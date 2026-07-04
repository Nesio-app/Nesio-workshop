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
- **状态**:fixed(2026-07-04,方案 A:isSameOriginRequest + 限流,不要求会话;扫描器与 api-routes.md 同步)

## P2 — 匿名写入触发云镜像 401 噪音

- **现象**:匿名用户每次记录(快速添加/激活步)触发 `POST /api/cloud/signals` 401×2。
- **影响**:console 报错噪音 + 无效请求;本地写入不受影响(fail-closed 正确)。
- **根因**:create-signal.ts signalWriteMode() 只判 `typeof window`,不判登录态;
  writeCloudSignal 对匿名用户注定失败却照发。
- **修法**:writeCloudSignal 前检查 baohe_auth_access cookie 存在(document.cookie 不可读
  httpOnly——改为读 auth-client 的会话缓存状态,或 401 一次后本会话降级不再发)。
- **状态**:fixed(2026-07-04,writeCloudSignal 收到 401 后本会话降级不再发)

## P2 — 听简报无 watchdog,引擎哑火时 UI 无失败态

- **现象**:DailyBriefCard.playWithBrowserTTS 的 Promise 依赖 utterance 回调
  (onstart/onend/onerror);speechSynthesis 引擎不可用时(部分 Android WebView、
  无语音包设备、headless)回调永不触发,UI 停在无反馈状态。
- **证据**:headless Chromium 上点击听简报 100% 挂起渲染器(QA 中 3/3 复现)。
  真机概率低但存在。违反设计红线「每个异步动作必有可见失败态」。
- **修法**:speak() 后起 8s watchdog,onstart 未触发则 cancel + setErrorMsg + error 态。
- **状态**:fixed(2026-07-04,speak 后 8s watchdog → cancel + 可见错误态)

## P3 — 中文语音选取时序问题

- **现象**:getVoices() 在 Chrome 首次调用常返回空数组(语音列表异步加载,
  需监听 voiceschanged),cnVoice 选不上 → 可能用默认英文音读中文脚本。
- **修法**:voices 为空时等 voiceschanged(带超时)再 speak。
- **状态**:fixed(2026-07-04,voicesReady 等 voiceschanged 带 1.5s 超时)

## P3 — 顶部双按钮视觉不对称

- **现象**:移动端 375px 下「听简报」是圆钮,「此刻」被 flex 拉伸成通栏长条,
  与「双圆按钮」设计意图不符(nesio-mood-circle 类名 vs 实际矩形)。
- **确认**:是否有意为之;若否,给 nesio-mood-circle 定宽或 flex:none。
- **状态**:fixed(2026-07-04,简报包装 div 补 flex:1 + 按钮撑满;行 align-items:flex-start 防止播放态把此刻垂直拉高)

## P3 — manifest 路径确认

- **现象**:/manifest.webmanifest 404,/manifest.json 200。
- **确认**:HTML `<link rel=manifest>` 指向哪个;若指 manifest.json 则无事,
  PWA 安装流程真机验证一次即闭环。
- **状态**:confirmed(HTML link 指向 /manifest.json 且 200,无需改动)

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

---

# 面板功能专项 QA(2026-07-04 第二轮,SQL 全就位后)

## P3 — RoadmapSheet 文案未进 i18n 字典

- **现象**:「投票给未来功能」sheet 的界面文案与 6 个候选功能的标题/描述
  均为硬编码中文(components/portal/RoadmapSheet.tsx + lib/portal/roadmap.ts),
  英文用户看到中文。
- **修法**:sheet 框架文案入 t() 字典;候选功能标题/描述在 roadmap.ts
  改为 { zh, en } 双语结构。属 REG-004 家族的新增欠账。
- **状态**:open

## 全绿项(生产实测)

- **门禁矩阵**:admin metrics/users 无密钥 401、错密钥 401、跨域 403;
  /admin 页密钥态不泄露任何数据,错密钥有明确提示;noindex 生效
- **投票全链路**:投 5 星 → 查(avg/count/mine 正确)→ 改 3 星覆盖不加票 →
  伪造 featureId/越界分数/缺 deviceId 全部 400、跨域 403
- **App 内 sheet**:设置入口 → sheet 打开(候选+已有均分显示)→ 点星 →
  服务端落库确认 → 星星高亮/票数刷新,零 console 错误
- **access 匿名** → public;事件名 exp_exposure/feature_vote 过 sanitize
- **移动端** 375px 面板无横向溢出
- **循环自证**:uptime 工作流已按 15 分钟节奏自跑(10s 成功),
  CI Release Verification 近 5 次推送全绿

## 留给你验证的(需要你的密钥/登录态)

1. /admin 输入正确密钥 → 各区出数;点 ⤓ CSV 下载打开看格式
2. 用户权限区:给自己设 Lab → 重新打开 App → /secretary 应直接可进
3. 登录态用一次 听简报/问一问 → 几分钟后 AI 成本表应出现该路由行

## QA 测试数据清理(可选)

本轮在 feature_votes 写了 2 条测试票(week_review ★3、voice_diary ★4)。
想清零就在 Supabase SQL Editor 跑:
`DELETE FROM public.feature_votes;`(现在表里只有这两条 QA 票,放心清)

---

# 移动端专项审计(2026-07-04 第三轮,375px)

## 修复 3 处

1. 面板范围 chips 竖排折行("7 天"变两行)→ nowrap + 行可换行,无溢出
2. AI 成本五列表格窄屏必挤 → 卡内横向滚动(minWidth 420)
3. **投票星星触控目标 26px,低于 --tap-min 44px 红线(用户面)**
   → 44×44 触控区 + 星星放大,截图验证达标

## 移动端全绿项

- 面板:KPI 双列、趋势/雷达/漏斗/环形图全部自适应,无横向溢出
- 投票 sheet:375px 布局干净,星星好点
- 主 App 早前已验证(345px 内容宽无溢出、底部导航贴底)
