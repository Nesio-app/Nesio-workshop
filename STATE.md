# STATE.md — 仓库持久状态(会话外记忆)

> Loop-engineering 原则:状态必须活在对话之外。任何 AI 会话或新协作者
> **先读这个文件**,再动手。改动仓库重大状态时,同步更新这里。
> 最后更新:2026-07-04(欠账清偿批次:Signal M1-M4 / FocusSection 二次拆分 /
> hex token 化 / REG-004/006 i18n;PRD 偏差见 docs/prd-deltas-2026-07.md)

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

## 已知欠账(按优先级)

- ~~restore-from-cloud~~ **已做**(2026-07-07):见上「进行中的迁移 ③」——推 + 拉都通了,云备份端到端闭环。
- **云备份付费桩转真**:hasCloudEntitlement 现读本地 flag;支付/StoreKit/账户 plan 字段
  接上后换成真权益读取(推送机制本身不用动)。(2026-07-07 记)

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

- Lab 模式:URL `?baohePersonal=1` 进入,`?baohePublic=1` 退出;viewerRole
  四级 public/tester/personal_lab/local(lib/portal/launch-surface.mjs)
- Demo/personal/market 三模式矩阵:components/portal/tool-state.ts(ShellMode)
- Stage5 代理动作:CEO 双 env 门禁 + invocation secret
  (lib/intelligence/tool-invocation-runtime.mjs)
