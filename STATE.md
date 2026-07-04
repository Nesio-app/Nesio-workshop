# STATE.md — 仓库持久状态(会话外记忆)

> Loop-engineering 原则:状态必须活在对话之外。任何 AI 会话或新协作者
> **先读这个文件**,再动手。改动仓库重大状态时,同步更新这里。
> 最后更新:2026-07-04(深水区批次完成:Signal M1+M2 / TodayFeed 拆分 /
> lab UI / DEC 消歧 / Next 16;PRD 偏差见 docs/prd-deltas-2026-07.md)

## 当前纪元:两代产品交接中

本仓库同时存在两代产品,交接未完成:

| 层面 | 旧代(退役中) | 新代(现役) | 交接状态 |
|---|---|---|---|
| 首页 | DashboardHome | TodayFeed | UI 已切换;**i18n/契约未迁移** |
| 设置 | AccountSettings | NesioProfileCard + SettingsSheets | 已切换;主题/语言入口曾断链(已修) |
| 推荐卡 | DEC(lib/intelligence) | guidance-engine(lib/platform) | **已接线(2026-07-04)**:DEC 卡经 decCardsToGuidanceEvents 汇入 guidance 管线,证据+反馈随卡 |
| 数据模型 | LifeGraph(localStorage) | Signal 主事实表 | **双写过渡中**(见 lib/life-domain/create-signal.ts 头注释) |
| 工具入口 | 11 工具宫格 | 统一入口 + 五域 | 工具由 bundle-toolbox.mjs 构建时拷入 public/ |

## 进行中的迁移

1. **Signal 主事实表**:两扇合法写入门 — `createSignal()`(Signal 形态)与
   `ingestLifeNode()`(LifeNode 形态,lib/life-domain/ingest-node.ts)。
   - M1 堵旁路写入 ✅ + M2 IDB 信号库(signal-store-idb.ts,只写积累)✅(2026-07-04)
   - M3 读切换 / M4 LifeGraph 降级为投影:未排期
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

1. Signal M3/M4:读切换 + LifeGraph 降级为投影(M1/M2 已完成)
2. 新代 i18n 完整包(REG-004 TodayFeed + REG-006 剩余 onboarding 步)— adherence lint 已上线(57 处存量 hex warn 待清)
3. FocusSection 676 行进一步拆分(DormantReviewCard / NightTimeline)
4. 组件阈值修订为:容器 ≤500 / 展示 ≤300(见 docs/prd-deltas-2026-07.md §2)

已清偿(2026-07-04):TodayFeed 拆分(1408→容器 164 + today/ 7 文件)、
lab 模式管理 UI(设置→隐私 sheet 开关)、DEC/dec-data 注释消歧、
Next 16.2.10(async cookies 转正)、Signal M1+M2。

## 已安装的循环(L1 = 只报告)

| 循环 | 位置 | 节奏 |
|---|---|---|
| CI 失败开 issue | .github/workflows/deploy.yml | 每次 push |
| 漂移检测(契约可达性/PRD 对账/文档过时) | `npm run report:drift` + loops.yml | 每周 |
| 断链巡检(modal 退出/能力入口) | `npm run report:broken-links` + loops.yml | 每周 |
| 安全循环(audit/route 守卫/文档新鲜度) | `npm run report:security-loop` + loops.yml | 每周 |
| AI 成本(telemetry 汇总) | `npm run report:ai-cost` | 每月/手动 |

## 命名词典(易混项)

- **DEC(两个,互不相关)**:lib/intelligence/dec.ts = Decision Engine
  (跨域推荐引擎,PRD Ch.36);lib/portal/dec-data-* = 运营数据目录
  (只读 reporting API,/api/data/v1/dec)。物理改名被否决:URL 是公开
  契约、2 个契约测试钉文件名,注释消歧成本更低。
- **guidance vs DEC**:guidance-engine 是渲染管线(7 层仲裁),DEC 卡
  经 decCardsToGuidanceEvents 作为一个来源汇入它。

## 模式速查

- Lab 模式:URL `?baohePersonal=1` 进入,`?baohePublic=1` 退出;viewerRole
  四级 public/tester/personal_lab/local(lib/portal/launch-surface.mjs)
- Demo/personal/market 三模式矩阵:components/portal/tool-state.ts(ShellMode)
- Stage5 代理动作:CEO 双 env 门禁 + invocation secret
  (lib/intelligence/tool-invocation-runtime.mjs)
