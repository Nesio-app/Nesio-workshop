# PRD 修订 delta(2026-07)

> 原 PRD(Nesio_工程团队PRD.docx,2026-06 中旬)距今约半个月,期间大量设计已演进。
> 本文档记录 **实现与 PRD 的偏差及新决策**,是下一版 PRD 的修订输入。
> 对账机制:docs/prd-acceptance-map.json(报表:`npm run report:drift`)。

## 1. §6.2 Today 模块整改 — 验收状态

| 验收项 | PRD 要求 | 实现状态 | 证据位置 |
|---|---|---|---|
| TODAY-001 | 数据源统一走 Guidance Service | ✅ 完成 | `runGuidancePipeline({` @ components/portal/today/useTodayData.ts |
| TODAY-002 | 卡片显示 Recommendation+Reason+Evidence 可展开 | ✅ 完成 | GuidanceCard.evidence/reason;卡片「依据 ▸」展开 |
| TODAY-003 | 默认最多 3-5 张核心卡统一仲裁 | ✅ 完成 | TODAY_CARD_BUDGET=3 由管线导出,渲染层同一常量 |
| TODAY-004 | 有用/不准/不再提醒 反馈写回 | ✅ 完成 | recordCardFeedback @ ProactiveGuidanceCard.tsx |
| TODAY-005 | 卡片过期策略,过期自动消失 | ✅ 完成 | computeExpiry + 渲染层过滤;dec_insight 过期检查先于 scheduledAt 门 |

## 2. 组件行数阈值 — 措辞修订(替代原「<300 行」)

原 PRD 一刀切「组件 <300 行」。实践发现该阈值混淆了两类组件,修订为**按职责分级**:

- **容器组件(编排数据/组合子组件)≤ 500 行**
- **展示组件(纯渲染)≤ 300 行**
- 超阈值需在文件头注释说明原因(临时豁免),并列入拆分欠账

当前状态(TodayFeed 拆分后,原 1408 行 → 8 个文件):

| 文件 | 行数 | 类型 | 状态 |
|---|---|---|---|
| TodayFeed.tsx | 165 | 容器 | ✅ |
| today/useTodayData.ts | 291 | 数据编排 hook | ✅ |
| today/FocusSection.tsx | 298 | 编排 | ✅(2026-07-04 二次拆分) |
| today/CalendarCards.tsx | 137 | 展示 | ✅ |
| today/DormantReviewCard.tsx | 105 | 展示 | ✅ |
| today/NightTimeline.tsx | 39 | 展示 | ✅ |
| today/FocusModeSheet.tsx | 328 | 展示 | ⚠️ 轻微超标 |
| today/FocusCardDetail.tsx | 242 | 展示 | ✅ |
| today/ProactiveGuidanceCard.tsx | 119 | 展示 | ✅ |

二次拆分时顺带删除了两个死组件(CalendarItemCard/TomorrowEventsGroup,
被 attention-engine 折叠列表取代后无引用)。

## 3. 契约测试迁移/退役表(2026-07-04 完成)

13 个钉在旧代组件上的契约已全部处理,15 个旧代死组件删除:

| 契约 | 处置 | 去向 |
|---|---|---|
| tool-icons | 迁移 | ToolGridIcon |
| anonymous-gate(Today 部分) | 迁移 | today-view-model + today/ 聚合读取 |
| locale purchased-tools | 迁移 | ToolsTreasureSheet |
| color-tokens | 迁移 | MoodSheet EMOTIONS(12 情绪色 token 化 --emotion-*) |
| baohe-v14-coverage | 退役 | 意图存 docs/regression-backlog.json |
| shell-entry-visibility | 退役 | 同上 |
| dashboard-calendar-provider-action | 退役 | 同上 |
| account-settings-*(多条) | 退役 | REG-001~006 回归欠账 |

注意:契约测试用**字面断言**(正形式门控如 `if (allowCookieIntegrationFallback()) {`),
重构涉及 integrations.ts / TodayFeed / Portal / DailyBriefCard / MemoryNodeDetail 前
先读 scripts/anonymous-private-data-gate.test.mjs。

## 4. 两代产品交接状态(PRD 应按新代重写)

| 层面 | 旧代 | 新代 | 状态 |
|---|---|---|---|
| 首页 | DashboardHome(已删) | TodayFeed + today/ | ✅ 交接完成 |
| 设置 | AccountSettings(已删) | NesioProfileCard + SettingsSheets | ✅ 完成(主题/语言/隐私/Lab 入口齐) |
| 推荐卡 | DEC 直渲染 | guidance-engine 7 层管线 | ✅ DEC 作为来源汇入(decCardsToGuidanceEvents) |
| 数据模型 | LifeGraph(localStorage) | Signal 主事实表 | ✅ 读优先切换完成(signal_read_preferred 相位,见 §5) |
| 工具入口 | 11 工具宫格 | 统一入口 + 五域 | ✅ |

## 5. Signal 主事实表迁移里程碑

- **M1(✅ 2026-07-04)堵旁路写入**:`ingestLifeNode`(lib/life-domain/ingest-node.ts)
  成为 LifeNode 形态的唯一写入口,11 个直写点已切换;与 `createSignal` 并列为两扇合法门
- **M2(✅ 2026-07-04)IDB 信号库**:lib/life-domain/signal-store-idb.ts,
  IndexedDB 'nesio-signals' 只写积累(appendSignalIdb),双写不读
- **M3(✅ 2026-07-04)读切换**:signal-read-cache.ts 启动水合
  (LifeGraph 全量回填 IDB + 删除传导对账),getSignals() 优先读事实缓存,
  未水合回退投影;LifeGraph 变更事件同步刷新缓存(读新鲜度不降)
- **M4(✅ 基础,2026-07-04)删除传导**:用户删除/剪枝引擎的意图传导到
  IDB 事实缓存,IDB 与投影保持一致;localStorage LifeGraph 保留为兼容投影
- **剩余**:source_of_truth cutover(事实库独立保留)+ 投影退役,
  契约 gates 要求 CEO Gate,不在自主工作范围

## 6. 平台与运行时

- **Next 16.2.10**(2026-07-04 升级):同步 `cookies()` 全面转正 async
  (guardAiRoute/isPortalRequestAuthorized/readTokensFromCookies 及 calendar/gmail/
  tool-invocation 辅助函数);tsconfig jsx→react-jsx(Next 16 强制)
- **Lab 模式管理 UI**(✅):设置 → 隐私 sheet 内 Lab 模式开关
  (localStorage baohe_personal_lab),与 URL `?baohePersonal=1` 等价
- **命名消歧**:两个 DEC(lib/intelligence/dec.ts 决策引擎 vs lib/portal/dec-data-*
  运营数据目录)物理改名被否决(公开 URL + 契约钉文件名),以头注释 + STATE.md 词典消歧

## 7. 遗留欠账(下版 PRD 应吸收)

1. ~~Signal M3/M4 读切换~~(✅ 2026-07-04,见 §5;剩余 cutover 需 CEO Gate)
2. ~~新代 i18n 完整包~~(✅ 2026-07-04:today*/night*/dormant*/guidance*/onboarding* 键组入字典,usePortalLocale hook 即时切换;REG-004/006 关闭)
3. ~~57 处存量 raw hex token 化~~(✅ 2026-07-04:chip/avatar/accent 三组 token 入 globals.css;canvas 兜底与 Google 品牌色为合法保留,带说明 disable)
4. ~~FocusSection 进一步拆分~~(✅ 2026-07-04,见 §2)
