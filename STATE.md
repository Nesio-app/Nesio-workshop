# STATE.md — 仓库持久状态(会话外记忆)

> Loop-engineering 原则:状态必须活在对话之外。任何 AI 会话或新协作者
> **先读这个文件**,再动手。改动仓库重大状态时,同步更新这里。
> 最后更新:2026-07-25(全量数据跨浏览器同步闭环:服务端按账号找最新备份 +
> 登录/回前台先拉后推 + durability 转免费;见「进行中的迁移 ③」末段)

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
   **全量数据跨浏览器同步闭环(2026-07-25):** 修「换浏览器登录后全量本地大数据(健康/足迹/
   银行流水…)拉不回」的命门。① 服务端 `/api/cloud/assets` GET 加 `?list=backup` 模式:列出登录
   用户 `{identity}/backup/` 下全部对象、回**最新那份**签名 URL(此前 POST 存带时间戳的新路径、
   GET 必须已知路径,新浏览器 localStorage 空 → 永远拉不回)。helper `listStorageObjects`
   (cloud-server-runtime,前缀按已鉴权身份拼,身份隔离)。② `pullBackupFromCloud` 改问服务端
   要最新份,不再依赖本地 last-backup 记录。③ 新增 `autoSyncBackupWithCloud`:Portal 顶层登录/
   回前台**先拉(merge)后防抖推**——空浏览器只被填充绝不用空盖云;**pull 失败不推**(防空/旧数据
   遮盖云端真备份)+ push 侧 `entryCount===0` 保险丝(空数据绝不上云)。④ **付费桩转免费**:
   `hasCloudEntitlement` 由「读本地 flag 默认关」改常开(登录即用),遵循 durability=免费护城河
   (与 cloud-memory-sync/学习态/profile 同口径)。合并逻辑复用 restoreCombinedBackup merge(节点
   id union、已有不覆盖)。契约 `test:cloud-backup`(空保险丝/list=backup pull/先拉后推不变式)+
   `test:cloud-assets-runtime`(list 模式 marker)+ `test:cloud-auto-sync`(全量同步契约)。tsc + next build 绿。
   **⑤ 冷浏览器首刷重新水合(2026-07-25 追加,修「换个网页记录还是不显示」)**:根因是 pull 把数据
   写进 IDB 后**没 reload** —— health/place-trail/inventory 等 store 只在加载时读一次 IDB、缓存在内存,
   restore 直写 IDB 不触发它们的 `*-updated` 事件,于是数据在库里但界面仍是空缓存(记忆图除外——它经
   cloud-memory-sync 事件实时更新)。修:`autoSyncBackupWithCloud` 在**冷浏览器首次**成功拉回且确有数据时
   `location.reload()` 让各 store 重新水合;用 `nesio-backup-first-sync-done-v1` 标志限制为每浏览器仅一次
   (且标志须真持久化才 reload,防隐私模式死循环刷新)。**连接器澄清**(非本次改,已如此):gmail/日历/notion
   令牌存 Supabase 按身份跨端(登录即通);flomo 用服务端 env(`FLOMO_WEBHOOK_URL`,与浏览器无关);
   邮件正文按隐私红线**只存本机 IDB 不上云**,仅 ≤1500 预览节点随记忆图跨端。

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

- **邮件全链路 里程碑 C(付费云深检索,2026-07-18)**:邮件全链路唯一**花钱**的一块——把邮件
  正文纳入**付费**语义 embedding rerank。此前 `semantic-rerank.ts` 的 `nodeEmbeddingText` 只嵌
  `name+rawInput+tags`,付费语义检索也搜不到正文语义。改:邮件节点嵌入**真实内容**(本机全文
  优先,退到 article/summary 预览),更大预算 1600 字;`semanticRerankMeta` 对池内(≤20)邮件
  节点 `await getEmailBody` 预取全文再嵌入。**红线四要件齐全**(复用现成 embed 路由):
  requirePaidCloudAi + 熔断 + reportAiCall + docs 登记;客户端 `canUsePaidCloudAi()` 前置拦下——
  **免费永不把邮件正文送云**(免费走里程碑 B 本机全文索引词法检索)。**注**:workshop 的
  semantic-rerank 此前漂移缺 Phase 2 免费门,本次一并补上(与 nesio 对齐)。两仓 tsc + build 全绿。
  **邮件全链路 A/B/C 三里程碑全部落地。**
- **邮件全链路 里程碑 B(检索接全平台,2026-07-18)**:让**本机邮件全文**(里程碑 A 存进
  `nesio-email-bodies` IndexedDB 的 ≤20k 正文)可被全平台检索/RAG 命中——**全免费、零云**。
  难点:搜索路径(`smartSearch`/`searchLifeGraphFuzzy`)是**同步线性扫内存图谱**,拿不到需
  await 的 IndexedDB;此前邮件只有 ≤1500 的 `article` 预览能被搜到。方案两块:
  ① **本机全文索引** `lib/portal/email-fulltext-index.ts`——内存 `Map<emailId,全文>`(受控容量
  1500 封 × ≤6k 字),`emailFulltextScore` 同步补分(整句 +6、每 token +2 封顶 6 个,≤+18);
  惰性水合 + gmail 同步增量并入(刚同步立即可搜);接入 `smart-search.ts` 与 `life-graph.ts`。
  ② **RAG 喂全文** `memory-retrieval.ts`——`buildMemoryContext` 对入选邮件节点 `await getEmailBody`
  预取全文,`fmtNode` query-aware 取窗 500 字替代原 140 字预览。tsx 单测 7/7;两仓 tsc + build 全绿。
  **待办**:里程碑 C(付费云深检索:embedding rerank 纳入邮件正文,付费路径)。
- **邮件全链路 里程碑 A(抓全存全 + 本地深抽取,2026-07-18)**:邮件内容抓取/分析落地第一步,
  **全免费、零云成本、隐私优先**。**Phase 1(抓全存全)**:gmail 路由 `extractText` 加 `maxLen`
  参数,新增 `extractFullBody`(≤20k)+ `buildEmailBodies`,响应带 `emailBodies`(emailId→全文)
  **仅回本设备**;客户端 connector-sync 收到后存**本机专属 IndexedDB**(`lib/portal/local-email-body.ts`,
  DB=`nesio-email-bodies`)——**隐私红线:全文不进云同步的 LifeNode.attributes**,记忆节点只留
  ≤1500 `article` 预览 + `emailId` 指针;详情「阅读原文」按 emailId 取全文。清空本地数据
  (SettingsSheets/local-owner)一并 `purgeEmailBodies()`。**Phase 2(本地深抽取)**:新增
  `lib/portal/email-extract-local.ts` 纯正则抽取(金额/预计到货/订单号/快递单号/商家/待办信号),
  gmail 免费兜底分支把命中项挂 attributes + 待办标「待回复」tag;MemoryNodeDetail 加
  amount/orderNo/trackingNo 属性标签,eta/store/merchant/subtype 由 EventSection 渲染故隐藏去重。
  **待办**:里程碑 B(检索接全平台)、里程碑 C(付费云深检索/embedding rerank)。
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
  **批③已迁**:MemoryNodeDetail(决策=统一丢 expand-to-full;image-viewer/EmailCompose createPortal
  到 body + z-950 + pointer-events:auto 绕 Vaul body 锁)。**批④已迁(收尾)**:DailyBrief/TodayFeed
  洞察 sheet + MirrorLetterTab 往期抽屉 portal 修复。**叠放组清空。批⑤**:Settings 已迁(共享 SheetWrap
  一迁全迁);Mood **改判豁免**(情绪轮 touch-drag canvas 与 Vaul 手势冲突,同 Camera)。**批⑥(收尾)已迁**:
  RelationshipDetail/EmailCompose/VoiceInput/Freeze/Inventory——嵌套 modal(HangNote/DateTimePicker/
  BarcodeScan)createPortal 到 body + pointer-events:auto;撤 MND 给 EmailCompose 加的 z-950 wrapper。
  **sheet 迁移主体完成。豁免**:Camera/Barcode/Mood(手势面)。剩余仅小件(VoiceInput 内 DateTimePicker,
  已 portal 兜住)/非 sheet(引导/装机/聊天/lab 实验面板)。清单即 ALLOWLIST。两仓(nesio + workshop)同步。

- ~~restore-from-cloud~~ **已做**(2026-07-07):见上「进行中的迁移 ③」——推 + 拉都通了,云备份**往返闭环**
  (注:是「往返打通」,**非端到端加密 E2E**;云端为应用层明文 + service-role,别用「端到端」措辞误导。数据审计 §4)。
  **跨浏览器全量同步已闭环(2026-07-25)**:命门(新浏览器 localStorage 空、GET 需已知路径 → 拉不回)
  已修 —— 服务端 `?list=backup` 按账号找最新份 + 登录/回前台自动先拉后推,见「进行中的迁移 ③」末段。
- ~~**云备份付费桩转真**~~ **改判:durability 转免费(2026-07-25)**:hasCloudEntitlement 由「读本地 flag
  默认关」改常开(登录即用,不锁付费墙)—— 跨端不丢是护城河基本盘,与记忆/学习态/profile 同口径。
  重资产付费(整包手动备份/图片深检索)另论;云备份/恢复本身对登录用户免费。
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

## Alexa 语音入口(2026-07-25 上线,真机验证通过)

把满屋 Echo 变成 Nesio 的语音前端:随口记(CaptureMemoryIntent)、随口问
(AskMemoryIntent)。路由 `app/api/alexa/route.ts`(纯函数 `routeAlexa` 可单测)、
召回纯函数层 `lib/portal/alexa-answer.ts`、共用评分排序 `lib/portal/cloud/signal-search.ts`。

**数据归属(重要):** Alexa 记的东西 → `/api/portal/ingest` → `createSignal(source='alexa')`
→ `writeCloudSignalsForCurrentUser` → 云 `signals` 表,`identity_key = supabase:<NESIO_OWNER_ID>`。
**与 owner 登录 App 写云用的是同一 identity_key,即 Alexa 与 App 共用同一片云记忆池**,
不是隔离两套。召回读同一池(`readCloudSignalRowsForIdentity`);App 今天页
(`useTodayData` → `GET /api/cloud/signals`)登录后也拉得到。无 cookie 会话时
(Alexa secret 路径)`writeCloudSignalsForCurrentUser` 回落 owner 身份
(`resolveOwnerIdentity` 读 `NESIO_OWNER_ID`),否则捕获静默丢失。

**生产配置清单(treasurebox 项目 / 部署自本仓 workshop):**
- Alexa 后台 Endpoint = HTTPS `https://treasurebox-nu.vercel.app/api/alexa`
- **SSL 证书类型必须选「wildcard 子域」那项**(第 2 项)—— vercel.app 是
  `*.vercel.app` 通配符证书;选第 1 项「trusted CA」会被 Alexa 在发请求前拒掉
  (报 `Certificate ... contains wildcard '*.vercel.app'`,请求根本到不了函数)。
- Vercel 环境变量(改后**必须 redeploy** 才生效):`ALEXA_SKILL_ID`(applicationId 校验)、
  `INGEST_SHARED_SECRET`(capture→ingest 鉴权)、`NESIO_OWNER_ID`(= owner Supabase user id,
  归属捕获/召回;GET /api/alexa 会回显登录 owner 的 userId 便于配)。
- 交互模型 invocationName = **my box**(初版 nesio/nessa 与显示名 Nassa 易混,已换)。
  改唤醒名必须重 build 模型。

**踩坑史(定位链,供后人少走弯路):** 唤醒名混淆(nessa/nassa/显示名 Nassa)→
endpoint 未保存/未 build → **SSL 证书类型选错(通配符,真凶之一)** →
`NESIO_OWNER_ID` 未配致云写 not_signed_in → env 改后未 redeploy。逐层排除靠
Vercel 运行日志(POST 是否到达函数 + `cloudSignalWrite.ok`)+ Alexa Manual JSON
(直连 endpoint 看原始 SSL 错误)。

**限制 & 欠账:** ① Alexa 无中文 NLU,交互语言 en-US(中文内容能存、识别率低);
② 个人/开发版校验仅 applicationId + 时间戳新鲜度,上架需补完整 SignatureCertChainUrl
证书链;③ 服务端 ingest 每次刷一行 `[nesio:dropped] signal.idb_write — put returned false`
(服务端无 IndexedDB,本地写必然失败在如实报告,云写成功不受影响)——噪音,待清;
④ 可选:capture/ask 双意图未来可合成单一 TalkIntent + `classifyUtterance` 由服务端判记/问。

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
