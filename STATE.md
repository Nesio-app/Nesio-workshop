# STATE.md — 仓库持久状态(会话外记忆)

> Loop-engineering 原则:状态必须活在对话之外。任何 AI 会话或新协作者
> **先读这个文件**,再动手。改动仓库重大状态时,同步更新这里。
> 最后更新:2026-07-10(v1 产品规格批次 27-29:洞察四件套+多面镜 / Today 收据 /
> 标签相对时间;规格 = docs/design/v1-product-spec-2026-07.md)

## 当前纪元:两代产品交接中

本仓库同时存在两代产品,交接未完成:

| 层面 | 旧代(退役中) | 新代(现役) | 交接状态 |
|---|---|---|---|
| 首页 | DashboardHome(已删) | TodayFeed + today/ | ✅ 完成:契约已迁移,i18n 已接 t() 字典(REG-004) |
| 设置 | AccountSettings | NesioProfileCard + SettingsSheets | 已切换;主题/语言入口曾断链(已修) |
| 推荐卡 | DEC(lib/intelligence) | guidance-engine(lib/platform) | **已接线(2026-07-04)**:DEC 卡经 decCardsToGuidanceEvents 汇入 guidance 管线,证据+反馈随卡 |
| 数据模型 | LifeGraph(localStorage) | Signal 主事实表 | ✅ **cutover 完成(signal_source_of_truth)**:IDB 是权威源,LifeGraph 是可重建投影 |
| 工具入口 | 11 工具宫格 | 统一入口 + 五域 | 工具由 bundle-toolbox.mjs 构建时拷入 public/ |

## 进行中的迁移

1. **Signal 主事实表**:两扇合法写入门 — `createSignal()`(Signal 形态)与
   `ingestLifeNode()`(LifeNode 形态,lib/life-domain/ingest-node.ts)。
   - M1-M4 ✅ + **source_of_truth cutover ✅(CEO Gate 2026-07-04 批准)**
   - 实现:signal-read-cache.ts — IDB 事实库独立(不再镜像式对账),
     删除是显式意图(life-graph 广播 'nesio-life-node-deleted' 携带节点,
     缓存/IDB 删对应 Signal);投影可整体重建(rebuildLifeGraphFromSignals
     ← signalToLifeNode 逆向适配器,payload.nodeType/nodeSource 保真字段)
   - 契约相位:signal_source_of_truth(signal-main-fact-contract.ceoGate 记录);
     localStorage LifeGraph 保留为兼容投影(noDestructiveProjectionCleanup)
   - 问一问(ask)候选集接入 signal 语义搜索(searchSignalsSemantically)
2. **契约迁移(2026-07-04 完成)**:13 个契约已全部迁移/退役,15 个旧代死组件已删除。
   - 迁移到活 surface:tool-icons→ToolGridIcon、anonymous-gate→today-view-model、
     locale purchased-tools→ToolsTreasureSheet、color-tokens→MoodSheet EMOTIONS(顺手
     把 12 个情绪色 token 化为 --emotion-*)
   - 退役(纯死表面):baohe-v14-coverage、shell-entry-visibility、
     dashboard-calendar-provider-action、account-settings-*(意图入 regression-backlog)
   - 断言随实现进化更新:相机原生打开、镜像 sheet→InsightsSheet、apex↔www 规则反转
     (代码注释记载了原因:host-only cookie bug)
   - 产出:docs/regression-backlog.json(REG-001~006,report:drift 周检)
3. **云备份推送机制(2026-07-07,输出侧统一在存储上的落点)**:
   `lib/portal/cloud-backup.ts` — 一键把本机全部 durable 数据(localStorage manifest 归类
   + 已迁 IDB 的 blob)推到用户云账户。与本地导出用**同一份枚举**(buildCombinedBackup),
   复用 `/api/cloud/assets`(purpose=backup,text/plain ≤8MB,身份隔离,签名回读)——
   零服务端改动。付费门是**桩**(hasCloudEntitlement 读本地 flag `nesio-cloud-entitlement-v1`,
   默认关);真权益强制层未落地(见权益契约 report-only)。gate 仍在 CLOUD_DB_ENABLED + 已登录。
   **恢复(pull)已补全(2026-07-07):** `restoreCombinedBackup` 按 IDB key 登记
   (`idb-blob-store.isIdbBlobKey`,createBlobStore 时登记)分流——IDB blob 落 idbBackend
   (replace 覆盖 / merge 缺才补)、其余走 restoreFullBackup 落 localStorage;`pullBackupFromCloud`
   走 assets 签名 URL 回读。**顺带修了 #43 迁 IDB 的坑**:旧 restore 全写 localStorage,而 blob store
   仅在「IDB 空」才迁移,故 replace 模式对已有 IDB 数据静默失效——本地「导入备份」也受此影响,已一并改走 restoreCombinedBackup。

4a. **A 计划施工线 ✅ 完整闭环(2026-07-07,#50-#59)**:见 `docs/design/algorithm-layer-plan.md`。
   Layer2 2a(总线+事实日志+三原语,mirror/energy 收编,card-feedback/cooling/dormant 有据保留)→
   Layer1(通用规则引擎 domain-rules + 判定域铺开:健康/财务/地图/心情,+并行会话的收纳=五域;
   FinanceTab 真漂移收口;Reader 统一判定源)→ 2b(ranker 回放重训·权重=可回放投影+蒸发自愈;
   bank 本地模糊匹配;mirror 情境化走证据门 rankerContextEvidence)→ 收尾(LearningStatusPanel
   全局化「app 学到了什么」;学习态 key 导出/删除收口契约钉死)。
   后续开口:情境化分桶(等证据灯亮)、ranker 加特征、实验显著性 finding(需组件→lib 抽取)、
   认知(living-model)域 LLM-bound 不设确定性判定层。
4. **Personalization 底座地基(2026-07-07,A 计划 Layer 2 起步)**:
   `lib/platform/personalization/` — 统一反馈总线(schema `{surface,dimension,key,reaction}`)+ **事实日志
   (event-sourcing #0,`nesio-feedback-log-v1`,追加式可回放,修"折权重即弃")**+ 三原语
   Preference/Baseline/Recency。guidance-ranker 接线改走统一总线(权重仍自存);#48 放错位的
   `lib/portal/learning/learner.ts` 已删、schema/落位对齐蓝图。**下一步(2a 续)**:mirror→规范 Preference、
   评估并掉 card-feedback、energy→Baseline、cooling/dormant→Recency。见 `docs/design/algorithm-layer-plan.md`。

## 红线(动之前必读)

- **CI 每次 push 跑 `test:security`(18 套安全契约)**,见 .github/workflows/deploy.yml。
  本地验证命令:`npm run test:security`。改动 integrations.ts / DailyBriefCard /
  MemoryNodeDetail / TodayFeed / Portal 前先看 scripts/anonymous-private-data-gate.test.mjs
  对它们的字面断言(契约喜欢正形式门控 `if (canUsePrivateData) {`)。
- **新增花钱/碰私据的 API route 必须过 `guardAiRoute`**(lib/portal/api-auth.ts)
  并登记 docs/api-routes.md。Next 16 起为 async:`const guard = await guardAiRoute(...)`。
- **设计规则**:每个异步动作必有可见失败态;每个 modal 必有退出;红色只给真实风险;
  文案遵循设计系统"温暖教练"语音(禁感叹号/禁"逾期失败")。
- 兄弟目录不是全是垃圾:adhd-flow-ios/web、health-web、storage-web、fitness/web、
  tools/secretary 是 bundle-toolbox 的**构建输入**。

## v1 产品规格执行状态(2026-07-10)

规格 = `docs/design/v1-product-spec-2026-07.md`(三公理:记→问→回溯 / 回溯>预测 / Calm≠Dead)。

**已按规格落地(批次 27-29,commit e435b9a/cacae7e/7e76e64):**
- §1 Today:收据首行(TodayViewModel.receipt,时段三态,绝不显示同步计数)、
  FOCUS 空态一行收掉、回忆卡日 1/晚 2、轮播兜底废除(buildRotatingFallback 弃用待删)、
  底部捕获输入框撤除(FAB 唯一英雄动作)、捕获提示行。
- §2 洞察:免费四件套(主题门/线头/走走看/一行节律)、生命版图唯一图(90 天门槛、
  示例地形废除、证据行)、认知=多面镜月度信(/api/portal/mirror-letter,5 镜,
  老友免费试读,mirror_letter 入 PRO_ONLY_FEATURES,只回看不预测)、
  旧 7 层模型+节点图移 Lab、批量导入不计入(life-graph.isBulkImported)。
- §3 标签:L1 单图标(核对通过)、L2 tags 指令 retrieval-only、L3 主题门(详情页+洞察)、
  相对时间(列表卡+详情)。
- 契约同步:guidance-holiday-fallback §3 改守新公理(无兜底/收据必渲染/预算帽)。

**规格内仍挂账:**列表卡照片缩略图、L3 真聚类(embedding 同义合并)、
§4 冷暖进 token/宋体子集化/动效清单、§5 端上化(iOS 端上转写/视觉标签,依赖原生壳)、
sensitivity/retention 枚举化(中期)。

## 已知欠账(按优先级)

- **NesioSheet 原语迁移(进行中,2026-07-18)**:模态语义(aria-modal/role="dialog")统一到
  单源原语 `components/portal/ui/NesioSheet.tsx`(Vaul bottom + Radix center/fullscreen,
  自持 useFocusTrap——库的焦点管理在 React19+Next16+Turbopack 本栈不可靠)。**决策**:
  安静模式=B(跟随系统 reduced-motion)、CameraSheet=B(豁免)、路线 A。**已迁**:PlacePicker、
  W1 全部 center-modal、W2 全部 fullscreen(含地图/地球 `modal={false}` 绕开 react-remove-scroll
  阻断手势)、W3 底部 8 件(Roadmap/Routine/Connectors/Share/ShareTo/MeetingRecorder/FocusMode/
  HangNote/PersonExtract)+ MoodTrend。底部统一 Vaul 拖拽(去自写 useSheetDrag,失去
  expand-to-full,待真机验手感)。**契约锁 `scripts/sheet-primitive-allowlist.test.mjs` 已挂
  test:security 链尾**:原语外每一处手写模态标记登记进 ALLOWLIST,新面板不走原语即 CI 红;
  迁完降数/摘除。workshop(lab)比 nesio 多若干实验面板(Tesla/Wechat/fitness/Montage/NotePanel/
  PreviewGuides/ConnectorsHub),ALLOWLIST 更长属预期漂移。**待迁(高风险,留整块真机验证时间)**:
  **叠放组批①②已迁(2026-07-18,nesio 侧 prod 隔离验双层 Vaul 通过)**:批① LongPress/Projects/
  CreateProject;批② Favorites/ProjectDetail(workshop 里都在单体 MemoryTab.tsx 内联)。① 叠放组
  剩余——MemoryNodeDetail(需 fragment 抽 3 个嵌套 modal + 丢 expand-to-full 决策)、DailyBrief/
  TodayFeed(嵌套 MemoryNodeDetail);② 多子 sheet——Settings/
  Mood;③ 嵌套子 sheet——EmailCompose/RelationshipDetail;④ 特殊结构——Voice(双 backdrop);
  ⑤ 豁免——Camera/Barcode(实时相机)。清单即 ALLOWLIST,以测试为准。两仓(nesio + workshop)同步。

- ~~restore-from-cloud~~ **已做**(2026-07-07):见上「进行中的迁移 ③」——推 + 拉都通了,云备份**往返闭环**
  (注:是「往返打通」,**非端到端加密 E2E**;云端为应用层明文 + service-role,别用「端到端」措辞误导。数据审计 §4)。
- **云备份付费桩转真**:hasCloudEntitlement 现读本地 flag;支付/StoreKit/账户 plan 字段
  接上后换成真权益读取(推送机制本身不用动)。(2026-07-07 记)
- **服务端权益强制:骨架已落、待接真源**(2026-07-14 记,安全审计 #1):
  `lib/portal/auth/server-entitlement.ts` 提供 `readServerTier` / `guardServerEntitlement`,
  已接进 `guardAiRoute({ requirePaidCloudAi:true })`,七路付费云 AI 路由(meeting-notes /
  avatarify / person-extract / inventory-extract / living-model / health-insight / daily-brief)
  已挂。**默认 inert**(真源未接 → fail-open 放行,线上行为不变)。**接真源(部署侧)**:
  ① Supabase 建 `user_entitlements(user_id, plan)` + RLS(仅本人读 / service_role 写);
  ② StoreKit/支付回调服务端校验收据 → upsert plan;
  ③ 置环境变量 `NESIO_SERVER_ENTITLEMENT=1`、`NESIO_ENTITLEMENT_TABLE=user_entitlements`。
  无需改代码,骨架即从 inert 转强制。`/api/entitlements` 已附 `serverTier`/`serverEntitlementEnforced`。
- **客户端 getTier 优先信 serverTier(待做)**(2026-07-14 记):真源接上后,`entitlement.getTier()`
  应优先读 `/api/entitlements` 的 `serverTier`、localStorage 只作离线兜底,消除「本地置 1 即 Pro」。
  当前仍是本地桩(服务端强制已能兜底,这步是把客户端展示也对齐)。
- **数据全维度审计遗留(2026-07-14 记)**:已修 P0 越权(伪造 openid 跨用户读写云记忆 —— 所有
  据 openid 生成身份/会话的路径改走 `verifiedWechatOpenid`/`hasVerifiedSessionCookie` 验签)。
  已修:③ 实体解析(`entity-resolution.ts` 规范化 + 别名归一,读时收敛,接进 buildRelationships)、
  ⑤ 导出到本地文件(设置页 handleExportLocal 下载 combined backup JSON)、
  **② 云同步 last-write-wins**(2026-07-14 做):根因是 `signalRow.updated_at` 盖同步时刻
  `new Date()` 而非编辑时刻 —— 陈旧副本批量回传反而更新,盖掉新编辑。修法两半:
  (a) 给编辑记逻辑修改时间——`life-graph.addLifeNode/updateLifeNode` stamp `attributes.updatedAt`,
  经 `Signal.modifiedAt` 投影(不进 payload,避免误触重嵌入),`signalRow.updated_at` 改盖
  `signal.modifiedAt`;(b) DB 端 `supabase-signals-conflict-guard-v1.sql` BEFORE UPDATE 触发器
  拒绝严格更旧的写入(RETURN OLD),race-free 永不丢新编辑 —— **须在 Supabase 手动执行一次**(inert until applied)。
  契约 `test:cloud-conflict`。
  **① 云端敏感字段静态加密**(2026-07-14 做):选型「应用层字段加密」而非真 E2E ——
  服务端语义检索(pgvector)需要明文嵌入,和真 E2E 冲突(需整体搬客户端重写,风险大)。
  密钥服务端托管,服务端仍能解密 → 检索不受影响;防的是 DB 转储/快照泄露(拖库拿密文,
  无应用密钥读不出原文),**不防**服务端自身攻陷。实现 `lib/portal/cloud/field-encryption.ts`
  (AES-256-GCM 信封,休眠 passthrough,逐值探测混合模式,篡改/错钥 fail-closed)。接线:
  signals 内容列(title/payload/entities/evidence/embedding_text 写加密/读解密,元数据列与
  embedding_vector 保持明文可检索)+ memory 路由(node/asset/edge.evidence 整块)+ 导出路由
  (取回还原明文)。默认休眠现网零变化;部署侧置 `NESIO_FIELD_ENCRYPTION=1`+
  `NESIO_FIELD_ENCRYPTION_KEY` 并执行 `supabase-field-encryption-v1.sql`(放宽 jsonb 内容列
  CHECK 兼容密文)即启用。契约 `test:field-encryption`。隐私文案已如实(未虚假宣称 E2E),不改。
  **④ 被遗忘权**(2026-07-14 做):(a) 账号删除漏了 `signals`(主数据原子!)—— 补进物理
  删除集合;(b) 匿名 telemetry 按 device_id 存、无账号关联 → 客户端删除时上报本机
  telemetry device_id(`getTelemetryDeviceId` 只读不创建),服务端按 `device_id in.()` 设备级
  擦除;(c) 删账号本体 `auth.users`(仅 supabase 真实 userId,FK cascade 兜残留),
  wechat/external 伪身份无本体可删;(d) 软删墓碑不 GC + telemetry 无 TTL →
  `supabase-retention-gc-v1.sql`:`nesio_gc_soft_deleted`(过 30d 宽限期物理清 signals/
  memory_* 墓碑)+ `nesio_gc_telemetry`(180d TTL),仅 service_role 可执行,pg_cron 定时示例
  (inert until applied)。契约 `test:forgotten-right`。**数据审计全部落地。**

**契约测试提示**:`test:contracts`(100+ 套,CI 只跑 test:security 的 18 套)
在 2026-07-04 全量修复过一轮——历史重构造成的 15 处 marker 漂移已对齐,
并已挂进每周 loops.yml(失败进 loop-report issue)。重构后请顺手本地跑一遍。

已清偿(2026-07-04):TodayFeed 拆分、FocusSection 二次拆分(298 行)、
FocusModeSheet 拆分(141 + MeetingRecorderSheet 163)、
lab 模式管理 UI、DEC/dec-data 注释消歧、Next 16.2.10(async cookies)、
Signal M1-M4(读切换 + 删除传导)、REG-004/006 i18n 闭环
(usePortalLocale + t() 字典)、57 处 hex token 化(chip/avatar/accent)。

## 已安装的循环(L1 = 只报告)

| 循环 | 位置 | 节奏 |
|---|---|---|
| CI 失败开 issue | .github/workflows/deploy.yml | 每次 push |
| 漂移检测(契约可达性/PRD 对账/文档过时) | `npm run report:drift` + loops.yml | 每周 |
| 断链巡检(modal 退出/能力入口) | `npm run report:broken-links` + loops.yml | 每周 |
| 安全循环(audit/route 守卫/文档新鲜度) | `npm run report:security-loop` + loops.yml | 每周 |
| 全量契约链(100+ 套) | `npm run test:contracts` + loops.yml | 每周 |
| 生产合成监控(uptime + 安全门) | .github/workflows/uptime.yml → prod-down issue | 每 15 分钟 |
| **修复闭环(待激活)** | .github/workflows/claude-autofix.yml:issue(ci-failure/loop-report/prod-down/claude-fix)或 @claude 评论 → 自动开修复 PR | 事件触发;激活二选一:`claude setup-token` → CLAUDE_CODE_OAUTH_TOKEN secret(包月订阅,推荐)或 ANTHROPIC_API_KEY(按量) |
| AI 成本(telemetry 汇总) | `npm run report:ai-cost` | 每月/手动 |

## 命名词典(易混项)

- **DEC(两个,互不相关)**:lib/intelligence/dec.ts = Decision Engine
  (跨域推荐引擎,PRD Ch.36);lib/portal/dec-data-* = 运营数据目录
  (只读 reporting API,/api/data/v1/dec)。物理改名被否决:URL 是公开
  契约、2 个契约测试钉文件名,注释消歧成本更低。
- **guidance vs DEC**:guidance-engine 是渲染管线(7 层仲裁),DEC 卡
  经 decCardsToGuidanceEvents 作为一个来源汇入它。

## 数据面板与权限管理

- `/admin` — 自有管理面板(不依赖第三方,recharts 图表层):
  洞察引擎(环比涨跌/数据静默告警/漏斗瓶颈/推荐质量,每条带建议)、
  KPI 环比箭头、趋势图叠上一周期虚线、漏斗瓶颈自动高亮、反馈环形图、
  **用户权限管理**(见下)。数据源 = 自己 Supabase 的 telemetry_events +
  product_events,服务端聚合只回统计。
- **权限体系(2026-07-04)**:服务器权威角色在 user_profiles.access_role
  (public/tester/personal_lab)+ feature_flags(模块开关)。
  管理员在 /admin 设置 → 用户登录后经 GET /api/portal/access 领取,
  只增不减地并入浏览器侧 launchSurfaceContext;personal_lab 顺带下发
  secretary lab cookie。本机 URL/localStorage lab 开关保留(所有者工具)。
- **v4(2026-07-04)**:聪明度雷达(推荐有用率/AI 可用性/响应速度/功能走通率/
  反馈参与度五维)、AI 调用与成本估算表(server ai_route 经 next after()
  落库)、功能许愿榜(用户在 设置→投票给未来功能 打星,清单单一事实源
  lib/portal/roadmap.ts,表 feature_votes)、A/B 实验区(基建
  lib/portal/experiments.ts:注册即用,稳定设备分桶 + exp_exposure 曝光)。
- **schema 管道纪律**:bundle 是生成物(scripts/supabase-schema-bundle.mjs
  拼接 canonical 源)——加表 = 新建 database/schema/supabase-*-v1.sql 源文件
  并登记生成器与契约,**不要手改 bundle**(会被生成器覆盖,已踩过)。
- 生产激活:① Vercel 环境变量 `NESIO_ADMIN_SECRET`;② Supabase SQL Editor
  跑 schema bundle(2026-07-04 起含 telemetry_events/feature_votes 表 +
  Access control 列)。

## 模式速查

- Lab 模式(**2026-07-16 起默认开**,用户定:本仓=个人全功能版,双前端分家后
  公众版已在 Nesio-app/Nesio 仓):非提审构建默认 personal_lab / isLabModeOn()=true;
  显式退出才收起 —— `?baohePublic=1` 或 设置→Lab 关(写 localStorage
  `baohe_personal_lab='0'`,删 key = 回默认开);`?baohePersonal=1` 从退出态一键回全开。
  提审构建(NEXT_PUBLIC_APPSTORE_BUILD=1)恒 public 不变。viewerRole
  四级 public/tester/personal_lab/local(lib/portal/launch-surface.mjs)
- Demo/personal/market 三模式矩阵:components/portal/tool-state.ts(ShellMode)
- Stage5 代理动作:CEO 双 env 门禁 + invocation secret
  (lib/intelligence/tool-invocation-runtime.mjs)
