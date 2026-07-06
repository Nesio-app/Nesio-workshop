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
| today/FocusModeSheet.tsx | 141 | 展示 | ✅(2026-07-04 拆分) |
| today/MeetingRecorderSheet.tsx | 163 | 展示 | ✅ |
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
| 数据模型 | LifeGraph(localStorage) | Signal 主事实表 | ✅ cutover 完成(signal_source_of_truth,见 §5) |
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
- **cutover(✅ 2026-07-04,CEO Gate 会话批准)**:事实库独立
  (不再镜像式对账,删除走显式事件传导)、signalToLifeNode 逆向适配器 +
  rebuildLifeGraphFromSignals 投影重建(「Signal 是权威源」的可执行证明)、
  契约相位翻转 signal_source_of_truth;顺带把 Today 反馈接回 signal 反馈环
  (recordSignalFeedback,evidenceSignalIds 随完整卡回写)+ 云端产品事件,
  ask 候选集接入 signal 语义搜索

## 6. 平台与运行时

- **Next 16.2.10**(2026-07-04 升级):同步 `cookies()` 全面转正 async
  (guardAiRoute/isPortalRequestAuthorized/readTokensFromCookies 及 calendar/gmail/
  tool-invocation 辅助函数);tsconfig jsx→react-jsx(Next 16 强制)
- **Lab 模式管理 UI**(✅):设置 → 隐私 sheet 内 Lab 模式开关
  (localStorage baohe_personal_lab),与 URL `?baohePersonal=1` 等价
- **命名消歧**:两个 DEC(lib/intelligence/dec.ts 决策引擎 vs lib/portal/dec-data-*
  运营数据目录)物理改名被否决(公开 URL + 契约钉文件名),以头注释 + STATE.md 词典消歧

## 8. 健康洞察系统(原 PRD 未覆盖,2026-07 新增 —— 下版 PRD 应吸收)

原 PRD 只有健康数据的浅层展示。2026-07 把「洞察 → 健康」升级为完整的挖掘 + 分析系统,
验收项 HEALTH-001~006(见 prd-acceptance-map.json)。走「医疗级」四层路线:
**已发表共识/指南编码成确定性规则,大模型只做沟通**(不训练自有模型、不靠通用大模型的记忆)。

| 层 | 做什么 | 实现 |
|---|---|---|
| ① 标准指标 | 用领域已定的指标+阈值 | 血糖 TIR/GMI/CV(GlucoseAnalysis)、睡眠分期(AASM 参考) |
| ② 模式识别 | 专科医生一眼看出来的模式(确定性算法,非 ML) | health-clinical.ts:黎明现象、TBR 低血糖红旗、深睡偏低、静息心率/HRV 偏离基线 |
| ③ 风险分层 | 已验证的临床评分 | 待做(ASCVD/FINDRISC 等,数据齐才算) |
| ④ 指南接地叙事 | LLM 只沟通,数据围栏、引用、不诊断 | health-insight 路由(guardAiRoute);RAG 语料库待做 |

- **每日事实表**(DailyFact)是跨板块分析地基;跨域相关(mineRelationships)+ AI 叙事在其上。
- **引擎/知识分离**:health-clinical.ts 用声明式 RULES(知识)+ 通用 evaluate(引擎)。
  换板块(财务等)只换 RULES;公共引擎抽取等有第二个板块再做(避免过早抽象)。
- **边界**:达到「指南级/专家共识级」(有出处、确定性、不诊断、红旗转诊),
  非监管意义的「医疗级(SaMD)」——后者需临床验证+认证,单独决策。
- **交接踩坑修复**:睡眠总时长虚高(分期段与概况段重叠被重复求和)、
  mmol/L 血糖被摩尔单位 `mmol<...>/L` 里字面 `>` 截断而整类丢失 —— 均已修+回归测试。

## 7. 遗留欠账(下版 PRD 应吸收)

1. ~~Signal M3/M4 读切换~~(✅ 2026-07-04,见 §5;剩余 cutover 需 CEO Gate)
2. ~~新代 i18n 完整包~~(✅ 2026-07-04:today*/night*/dormant*/guidance*/onboarding* 键组入字典,usePortalLocale hook 即时切换;REG-004/006 关闭)
3. ~~57 处存量 raw hex token 化~~(✅ 2026-07-04:chip/avatar/accent 三组 token 入 globals.css;canvas 兜底与 Google 品牌色为合法保留,带说明 disable)
4. ~~FocusSection 进一步拆分~~(✅ 2026-07-04,见 §2)
