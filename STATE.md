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

(暂无 — 2026-07-04 批次全部清偿;新欠账请记录在此)

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
| **修复闭环(待激活)** | .github/workflows/claude-autofix.yml:issue(ci-failure/loop-report/prod-down/claude-fix)或 @claude 评论 → 自动开修复 PR | 事件触发;激活 = repo secrets 加 ANTHROPIC_API_KEY |
| AI 成本(telemetry 汇总) | `npm run report:ai-cost` | 每月/手动 |

## 命名词典(易混项)

- **DEC(两个,互不相关)**:lib/intelligence/dec.ts = Decision Engine
  (跨域推荐引擎,PRD Ch.36);lib/portal/dec-data-* = 运营数据目录
  (只读 reporting API,/api/data/v1/dec)。物理改名被否决:URL 是公开
  契约、2 个契约测试钉文件名,注释消歧成本更低。
- **guidance vs DEC**:guidance-engine 是渲染管线(7 层仲裁),DEC 卡
  经 decCardsToGuidanceEvents 作为一个来源汇入它。

## 数据面板

- `/admin` — 自有管理面板(不依赖第三方):事件趋势/独立设备/漏斗/今日卡反馈,
  数据源 = 自己 Supabase 的 telemetry_events + product_events,服务端聚合只回统计。
- 生产激活两步:① Vercel 环境变量加 `NESIO_ADMIN_SECRET`(自定强密码);
  ② Supabase SQL Editor 执行一次 database/schema/supabase-backend-v1-bundle.sql
  (2026-07-04 起含 telemetry_events 表——此前该表缺失,遥测落库一直静默失败)。

## 模式速查

- Lab 模式:URL `?baohePersonal=1` 进入,`?baohePublic=1` 退出;viewerRole
  四级 public/tester/personal_lab/local(lib/portal/launch-surface.mjs)
- Demo/personal/market 三模式矩阵:components/portal/tool-state.ts(ShellMode)
- Stage5 代理动作:CEO 双 env 门禁 + invocation secret
  (lib/intelligence/tool-invocation-runtime.mjs)
