# STATE.md — 仓库持久状态(会话外记忆)

> Loop-engineering 原则:状态必须活在对话之外。任何 AI 会话或新协作者
> **先读这个文件**,再动手。改动仓库重大状态时,同步更新这里。
> 最后更新:2026-07-27(激进审计落地:Kill 伪智能/反馈双轨/认知双轨 + 成长教练收口 +
> Finance/Health 可视化与品味旁注;见「已知欠账」首条与 signal-epistemic.md)

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
   令牌存 Supabase 按身份跨端(登录即通);flomo 用服务端 env(`FLOMO_WEBHOOK_URL`,与浏览器无关)。
   ~~邮件正文只存本机 IDB 不上云~~ **已改(2026-07-25,workshop 全数据云端化)**:邮件正文改为
   **逐封记录级同步**(`lib/portal/cloud-email-sync.ts`,`email-body:<id>` 行进 `user_module_data`),
   换端补齐正文并即刻喂全文索引;**仅本人账号内、RLS 只本人可读、不进 AI**。见下「⑦」。

   **⑥ 记录级模块同步(2026-07-25,根治 · 对齐「Google Contacts 式」)** —— ①~⑤ 都是「整包 blob
   备份」这个**错误模型**的症状(8MB/4.5MB 上限、压缩兼容、遮盖、刷新)。根因:健康/足迹/财务/物品
   等本机模块**只能靠整包备份大文件**跨端(全有或全无);而记忆/头像名字/学习态早已走**记录级同步**
   (signals/profile_settings 表,逐条 upsert、`updated_at` 定胜负、增量、自动)—— 那套一直很稳,就是
   Google Contacts 的做法。新增把这些模块也搬上记录级同步:
   - 表 `user_module_data`(identity_key+module_key 主键,`database/schema/supabase-user-module-data-v1.sql`,
     **需在 Supabase 手动 apply**);路由 `/api/cloud/module-data`(GET 拉全部行 / POST upsert)。
   - 引擎 `lib/portal/cloud-module-sync.ts`:**复用**备份的枚举(buildCombinedBackup)+落地(restoreCombinedBackup
     replace),但**按 key 逐行**传输(gz-b64 压缩块,单模块 <4MB 不触 Vercel 上限);记忆图排除(它另有
     signals 同步)。模块级 LWW:本机缺→填充、本机自上次同步未改→云端更新胜、本机改过→本机胜。新设备首拉
     到本机没有的模块 → `newlyAdded>0` → reload 水合。Portal 顶层 mount+visibility 触发 `autoSyncModulesWithCloud`。
   - 整包备份(cloud-backup)降级为**手动导出/恢复**用途(设置页按钮),不再是自动跨端主路。
   - **压缩统一 fflate**(纯 JS,全浏览器兼容;此前 `CompressionStream` 需 iOS16.4+,旧环境压不上/解不开→
     「双向都失败」);blob 上传预检降到 4MB(对齐 Vercel 4.5MB 函数体上限)。
   - 契约 `test:cloud-module-sync`(引擎:逐行/排除记忆图/增量/双向 LWW/新设备 reload)+
     `test:cloud-module-data-runtime`(路由+表+Portal 接线)。**部署侧欠账:apply 上面那张表的 SQL 后才生效。**

   **⑦ workshop 全数据云端化(2026-07-25,#217/#218/#219)** —— 目标:workshop 版**一切数据跨端一致**,
   不再有「换端就没了」的纯本地数据。逐类收编此前的 local-only:
   - **积分/地点照片/阅读高亮**(#217):曾因「被空浏览器状态跨端盖掉」临时 local-only(#216 止血),现
     移出 `LOCAL_ONLY_KEYS` → 走记录级模块同步,安全靠 `cloud-module-sync` 的**反遮盖闸**(云端明显更空
     的值绝不覆盖本机非空值)。
   - **按人数据 `nesio-person-records-v1`**(#218,含**医疗/药物/健康**,原隐私红线):用户显式拍板上云 →
     移出 `LOCAL_ONLY_KEYS`(该集合现为空)→ durable 进备份+模块同步(**仅本人账号内、RLS 只本人可读、
     不进 AI**)。关系/人缘 UI 文案「只存本机」统一改「仅你可见 · 不进 AI」,兑现真实行为不说假话。
   - **邮件全文 `nesio-email-bodies`**(#219):独立 IDB、量级数十 MB 远超 4MB 单模块上限 →**逐封记录级同步**
     `lib/portal/cloud-email-sync.ts`(`email-body:<id>` 行进 `user_module_data`,gz-b64 压缩,并集合并只补缺、
     不覆盖不删除,落地即喂全文索引 `indexEmailBodies` 无需 reload)。路由 `/api/cloud/module-data` 加
     `keyPrefix`/`excludePrefix` 分流:模块同步 20s 轮询用 `excludePrefix=email-body:` **绝不下载海量邮件行**,
     邮件同步用 `keyPrefix=email-body:` 只取邮件行。Portal mount+visibility 触发 `autoSyncEmailBodiesWithCloud`。
   - 契约 `test:cloud-email-sync`(引擎:逐封前缀行/增量/并集补缺/喂索引)+ `test:cloud-module-data-runtime`
     扩(路由前缀过滤 + 模块同步 excludePrefix)。**复用现成 user_module_data 表,无需新 SQL apply。**

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
   (event-sourcing #0,反馈事实并入 `feedback.*` Signal,`readFeedbackLog` 投影回放)**+ 三原语
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
- **每次上 prod,先把别的 agent 分支上「今天的」提交一起带上**(用户 2026-07-30 定的规矩)。
  这个仓不止一个 agent 在写:机器人分支(`claude/home-desktop-robot-setup-*`)每天都在推,
  它的活如果不合进来就一直停在分支上,用户在生产上根本看不到 —— 反复发生过。
  开工前跑一遍:
  ```
  git fetch origin
  for b in $(git for-each-ref --format='%(refname:short)' refs/remotes/origin | grep -v 'origin/main$\|origin/HEAD'); do
    n=$(git rev-list --count origin/main..$b); [ "$n" = 0 ] && continue
    echo "$(git log -1 --format=%cs $b)  $n 条  $b"
  done | sort -r
  ```
  **只合日期是今天的**(老分支多半是已废弃的实验,合进来是引回归)。合完照常跑
  tsc + test:security + test:contracts + build,再连同自己的改动一起进 PR。
  已知会冲突的一处:`database/schema/supabase-backend-v1-bundle.sql` 头部的生成时间戳,
  取较新的那份即可。
- **每一轮改动都要开 PR、然后合进 main**(用户 2026-08-01 定的规矩:「你把所有的都开 PR
  然后合并吧,以后每次都这样」)。此前的做法是只推分支、等用户自己去合,结果是
  分支上堆了十几个提交、prod 上一个都看不到 —— 用户在 Vercel 部署列表里发现的。
  **不是「推完就算完」**:推分支 → 开 PR → 合并,一轮里全做完。
  合之前必须先把 main 合进分支并把冲突解干净:带着冲突开 PR 等于把活推回给用户。
  验证四件套照旧:tsc + `test:security` + `test:contracts` + `next build`。
- **`<input type="file">` 不许 display:none**(2026-08-01,已栽三次)。iOS 的 WKWebView
  对**不参与布局**的 file input 会忽略程序化 `click()` —— 桌面 Chrome 照开,所以本地
  怎么测都是好的,装到手机上就是「点了完全没反应、也不报错」,用户看到的就是「没实现」。
  用 `nesio-visually-hidden`(留 1×1 盒子),更不许 `document.createElement('input')` 后
  直接 click(那个元素连 DOM 都没进)。守卫:`scripts/file-picker-ios.test.mjs`。
  同一条契约还钉住:**通用**文件入口不设 accept 白名单(白名单永远漏掉 PDF/docx/xlsx,
  在 iOS 选择器里直接是灰的);**读不懂 ≠ 收不下**,解析不了正文的文件也要先 putLocalFile
  + ingestLifeNode 存下来,不许回一句「暂不支持」。
- **`test:contracts` 目前跑不到头,而且这件事本身是个洞**:
  `test:vision-plugin-wiring` 读 `treasurebox-ios/ios/App/App/NesioVisionPlugin.swift`,
  该文件只存在于**没合进 main** 的 `claude/new-session-r1kcgy` 分支,且被 .gitignore 的
  `ios/` 规则挡着 —— 在 pristine origin/main 上一样红。因为它排在链条中间,
  **排在它后面的契约在 main 上从来没跑过**;CI 门是 `test:security` 所以一直没暴露。
  在它修好之前,验收 `test:contracts` 要逐条跑(把 package.json 里那串 `npm run` 拆开
  一条条执行并收集退出码),不能只看那一条串行命令的结果。

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

- **VoiceInputSheet 的 `intent='ask'` 那一支已不可达,但还没删(2026-07-31)**。
  用户两次指同一件事(「点击问问符号,进入真的问问界面」),这一轮把**所有**问念念入口
  (底部中间键 / 首次引导页的「开始」/ 首页输入条的晶体)统一切到 `NesioChatSheet`;
  Portal 里的 `voiceIntent` / `voiceSeed` 已删,类型上再没人能传 `'ask'` 进去。
  那张 sheet 从此只做「说一句」。
  **没顺手删掉 ask 支的理由**:它内部有一套自己的取材(语义 + 云端 RAG 回溯),
  而对话页当时只有本地字面模糊 —— 直接删等于**悄悄弄丢一档检索质量**,
  而那种损失没有症状,几周后才会表现成「念念变笨了」。
  所以先把取材抽成 `lib/portal/ask-retrieval.ts` 两边共用、并让对话页真的用上
  (`open-world-rag` 契约钉死了这一条),ask 支那 18 处分支 + `askResults` /
  `askAnswer` / `askAggregations` / `webSearchUsed` / `askError` 这几个 state
  留待单独一轮清理 —— 那是纯删除,该在没有别的改动混进来的时候做。

- **音乐模块 · 四音源(2026-07-30,本轮新增)**:用户定的范围是「本地歌曲 + 网易 +
  歌曲自由切换 + Spotify + Apple Music」。落地时把「自由切换」拆成它真实的样子 ——
  **四个源不是一个播放器的四个开关,是两种播放模型**:
  ● `in-app`(本地文件 / Apple Music):声音走 **Nesio 自己的音频会话**,车机蓝牙上
    显示 Nesio,MediaSession 接了上一首/下一首;
  ● `remote`(Spotify):Nesio 只是遥控器,声音与车机界面都在 Spotify 那边,要 Premium;
  ● `metadata-only`:**目前没有源属于这一类**。这个模型留着,因为它描述的状态真实存在。
  ● 网易(2026-07-31 更正):上一版把它判成 `metadata-only`(恒不可播),理由是
    「没有国内出口就拿不到播放地址」——**那是过度概括**,用户当场指出:「不是所有歌
    都锁着的,为什么 github 的就可以」。他是对的。真实情况是**逐曲**的:非独家、非 VIP
    的曲子照样返回可播 URL。所以它现在是普通的 `in-app` 源 + `perTrack: true`:
    源级别只说「接得上、多数能放」,**哪一首行不行点下去问 `song-url` 才知道**。
    那条路由把三态**分开**报:`{ok:true,url}` / `{ok:true,url:'',reason:'restricted'}` / 502。
    界面据此给两个**不同的动作**:受限 → 「换一首」(不给重试键,重试永远不会成功);
    故障 → 「再试一次」。合成一句「播放失败」的代价就是用户对着一堵墙一直撞。
    教训归档:**一个源不能因为「有一部分不行」就被整个关掉** —— 那是把判据从
    「拿到东西才算数」偷换成「有风险就一刀切」,后者的代价是一整个能用的源消失。
  ● 网易**改直连**(同日,用户:「意味着我电脑要一直开着?」——不用)。原来
    `NETEASE_API_BASE` 指向一个要常驻的第三方服务(NeteaseCloudMusicApi);
    Nesio 统共只用它两个接口,为此养一整个服务不划算。协议搬进
    `lib/platform/music/netease-protocol.ts`(weapi 加密:AES-128-CBC 两层 +
    RSA no-padding;RSA 用模数/指数自己做模幂,**不走 PEM** —— 凭记忆拼的 PEM
    被 OpenSSL 当场 `asn1 too long` 拒收,自己算反而少一层会拼错的东西)。
    `NETEASE_API_BASE` 降级为**可选逃生口**:直连是逆向协议,坏了指一个自建实例还能用。
    取地址两条路都试(weapi → `song/media/outer/url`),**两条都拿不到才敢说受限**。
    拿到的地址一律 http→https:混合内容会被浏览器**静默**拦掉,表现是「点了没声音、
    一行报错都没有」;同理 CSP 的 media-src 补了 `*.126.net`(Plaid 那个坑的同款)。
    **未实测**:这个开发环境连不上 music.163.com(出网策略 403),所以密文对不对
    只有真机知道。契约压的是能压的:四态分派、回退真走到、混合内容改写、
    模幂与 OpenSSL 逐位对照(200 次 + 一个专门找出来的「裸输出不足 256 位」样本)、
    公钥常量指纹、协议层不许被客户端 import。**压不了的**也写在测试注释里:
    模数改一位不会红 —— 测试用的 n 就是从生产读的,两边一起改仍自洽。
  跨模型换源**必须先说**(`switchNotice`),否则用户在车里会突然看到车机换了个 App。
  「能不能放」是**正向判据**(`canPlayNow`:configured ∧ authorized ∧ streamable ∧ 非 metadata-only);
  逐曲源(`perTrack`)在这条判据之上多一层:源过了不代表某一首过得了,那一层在点击时才结算。
  回退链只收真能放的,一个都没有时有专门的空态(`noSourceLine`),并把能放的摆出来一键切。
  ● **不配任何东西就能出声的只有本地歌曲**:不要账号、不要订阅、离线可听。
    配了 `NETEASE_API_BASE` 之后网易也能出声(多数曲子);Apple / Spotify 仍缺密钥。
    本地导入 2026-07-31 翻过判据方向:原来是白名单(accept + 扩展名表),在 iOS 上
    必然踩空 —— 「文件」App 交出来的 File 常常 `type` 空串、iCloud 同步的甚至没扩展名,
    实测症状就是用户说的「无法识别任何格式,无法上传」。现在**只挡明显不是的**
    (图片/视频/文档),能不能解码交给 audio 元素。猜错代价不对称:误收删掉就是了,
    误拒则是用户根本不知道为什么、也没有别的路可走。
    Apple Music 的接线是完整的(服务端 ES256 签 developer token + MusicKit JS 授权),
    但**没有 `APPLE_MUSIC_*` 密钥就跑不通**,界面照实说「还没配好」。
    Spotify 的 OAuth / 状态 / 权益判定完整(`product === 'premium'` 才算能放),
    **但没接 Web Playback SDK 的播放** —— 用户没有 Premium,这条路径无法验证,
    不写无法验证的成功路径;要接时在 spotify 那一段里补。
  ● **新 key**:`nesio-music-local-tracks-v1`(cache)、`nesio-music-last-played-v1`(cache)、
    `nesio-music-prefs-v1`(durable)。前两个判 cache 的理由:音频 Blob 在独立 IDB
    (`nesio-music`)、**不进备份**,元数据同步过去只会得到一份点了放不出声的假曲库。
    Spotify 令牌只放 **httpOnly cookie**,不落 localStorage(音乐模块红线:凭证仅本机私有)。
  ● **新路由**(均已写进 docs/api-routes.md):`GET /api/portal/music/apple-token`、
    `GET|DELETE /api/portal/music/spotify`、`GET /api/portal/music/spotify/{connect,callback}`、
    `GET /api/portal/music/netease/search`、`GET /api/portal/music/netease/song-url`。
    除 OAuth 两条外全走 `guardAiRoute`。
  ● **CSP 补了 MusicKit**(`js-cdn.music.apple.com` / `api.music.apple.com` / media-src apple)——
    不补的表现跟当年 Plaid 一模一样:脚本被静默拦掉,按钮点了没反应,页面上没有任何线索。
  ● **收口**:`purgeLocalTracks` 已接进 local-owner 的删除/登出两处 + SettingsSheets 的
    清空/删除账号两处。漏一处就是「用户以为删了、歌还在设备上」。
  ● 契约 `test:music-source-switch`(16 组判断),三轮共 41 条注入回归全部被抓、0 漏网。

- **日程页重排 · 提醒与日历同级(2026-07-31 续)**:用户定案「在日程里的提醒功能也可以
  删了,首页输入框应该可以完成,问一问也可以」+「提醒项目混入日程列表,和日历同级别」。
  ● `Row.node` 从必填改成**可选**,新增 `reminder?: Reminder` —— 这是「混进去」的前提。
    上一版契约禁止这么做,理由是「硬塞就得造假节点、删除会去删一个不存在的 id」;
    那个坏结果没有发生:提醒行有自己的删除路径(`rem:` 前缀 → removeReminder + 收身影)、
    自己的完成动作,点开那条路在 node 缺省时**不画按钮**而不是画一个点了没反应的。
    `test:schedule-reminders` 那条断言随之更新(前提反转写进注释)。
  ● 提醒行右滑 = **做好了**(不是打星 —— 给提醒打星没有意义),图标换成勾。
    没有这个入口,「已完成」那一面永远是空的:整条链断在这里。
  ● 删掉日程页那套新建/管理提醒的 UI(表单 + 待办列表),只留一个只读的
    `CompletedReminders`。**CHORE_RE 绝不能碰到提醒**那条老保护保留并收紧到
    「提醒推进列表的那个循环体里一个都不许有」。
  ● 语音/说一句那侧补上同样的「设成提醒」按钮 —— 用户:「首页输入框和问问设置的提醒
    是要进记忆的」。ask 侧**不给**这个按钮:那边是问问题,不是安排事情。
  ● 契约里加了一条最结实的:**凡是 addReminder 的地方都要跟一条 createReminderShadow**
    (按调用计数比对)。逐个入口点名的写法挡不住「明天有人加了第四个入口忘了建身影」——
    那时「设好的提醒进时间线」只对一部分提醒成立,而症状是随机的。
  ● 自查里三条**断言太宽**被注入抓出来:在整份文件里搜 `if (r.doneAt) continue;`
    (查重那段也有一份)、搜 `IconCheck`(改成 `false ? IconCheck` 照样匹配)、
    以及一条三元两边写成一样的废断言。全部收紧到「只看那段代码本身」。

- **提醒收成一处 · 例行提醒模块删除(2026-07-31)**:用户定案「输入框可以设置提醒,
  智能提醒,我可以语言设置时间,频率然后进入记忆。就不需要例行提醒和日程里的提醒项目了」。
  ● 合并的**前提**是留下的那份先长出被删那份的能力,否则搬过去就是丢功能。
    `schedule-reminders` 因此补了 **weekdays**(每周一三五 —— 等间隔的 everyDays 表达不了)
    与 **doneLog**(重复提醒做完是往后滚,在这之前**不留任何痕迹**,所以「这个月到底交没交
    房租」根本没有数据能回答 —— 用户原话「应该有已完成提醒查询地方」)。
    日程页加「已完成」切换;`repeatLabel` 统一重复措辞(原来那行只认「每月」和
    everyDays===7,「每周一三五」显示成空白、看着像只此一次)。
  ● `when-parse` 认频率:每天 / 每周三 / 每周一三五 / 工作日 / 每月N号 / 每两天。
    **没说频率就不是重复的** —— 把一次性的事默认成天天响,是最快让人关掉整个功能的做法。
    首次落点绝不允许一建就过期。
  ● **提醒进时间线**(用户原话):新增 `lib/portal/reminder-shadow.ts` —— 提醒的真源仍是
    schedule-reminders,记忆里放一条带 dueDate/dueTime 的**身影**,靠 `reminderId` 认亲。
    收在一个文件里是因为它有**三个**调用点(首页输入条、日程页加一条、邮件确认),
    各写一份必然有一处忘了建、或删提醒时忘了收身影。身影**不存**完成状态/下一次时刻 ——
    存了两处立刻开始漂移。
  ● 删掉 `lib/portal/routines.ts` / `RoutineSheet` / `RoutineDueCards` 与个人页入口。
    用户确认那台设备上的例行提醒是测试数据,**不做迁移**。`nesio-routines-v1` 留在
    CACHE_KEYS(同 daily-brief-v2 的先例):老设备上还躺着这个值,不在册就默认 durable,
    会开始进备份、上云。
  ● **连带代价(已如实记下)**:「每日 AI 简报」原本挂在例行提醒上到点出卡,那张卡随模块
    一起没了;简报功能本身仍在(设置里有独立入口派 `nesio-open-brief`),失去的是
    「到点提醒你看」。要恢复自动触发得单独给它一个开关。
  ● 「问」改成**一步到位**:从首页带过去的问题直接开始回答,不停在一个填好了还等着
    再点一次发送的框上;只在 ask 侧自动跑(「说一句」是往记忆里写,自动提交等于替人
    按保存键),且一次打开只发一次(不挡会连发两遍、白花一次 AI 的钱)。
  ● 契约 `test:reminder-unify`(9 组判断),22 条注入回归全部被抓、0 漏网。
  ● **还没做**:提醒混进日程主列表、与日历项同级(现在仍是「我设的提醒」独立一段)。
    那需要给 Row 松绑 `node: LifeNode` 这个必填,是一次单独的重排。

- **首页输入条三合一 · 记一笔/找/问(2026-07-31)**:起因是一条**许诺了没做**的路 ——
  用户在首页打「设一个明天下午 3 点医生提醒」,`intent-router` 认出了意图、屏幕上显示了
  「设置提醒」四个字,然后那句话落成一条普通记录:明天下午三点什么都不会发生,而他以为设上了。
  ● **不做自动意图分流**。猜错的代价不对称:把「问」猜成「记」只是多一条垃圾记录,
    把「记」猜成「问」是**你要存的东西没存下来而你以为存了**。所以默认(回车/↑)永远是
    记一笔、一个字没改;另外两条摆在输入框下面,**点了才走**。
  ● 新 `lib/portal/when-parse.ts`(纯函数,now 注入):认「明天下午 3 点 / 今晚 8 点 /
    下周二 15:00 / 8月1日 / 三点半 / tomorrow 3pm」等。三条自律写死在文件头:
    **认不出返回 null 绝不硬凑**;**猜了什么必须说出来**(`hasExplicitTime=false` 时界面
    写明「你没说几点,先按早上 9:00」);输出**墙上时钟**(与 schedule-reminders 同格式)。
    12 小时歧义**不猜**(「3 点」就是 3 点),但解析结果原样显示、当场能改。
  ● 「设成提醒」落到 `schedule-reminders`(日程页那份),不新开存储;回执**带撤销**
    (自动识别总有认错的时候),并点明「在日程里」——不说的话回执一消失那条提醒就等于不存在。
  ● 「找」派 `nesio-memory-search` 把词带到记忆页(那套是完整的:语义理解+筛选+详情),
    **不在输入条下面再造一个小结果列表**;「问」派**专用事件 `nesio-open-ask`** 带上原文,
    VoiceInputSheet 加 `seedText` 预填 —— 刻意不复用 `nesio-open-voice`:那个名字被
    `test:today-settings-bug3` 明令禁止出现在 TodayFeed 里(用户标注过「点话筒不该跳说一说」),
    那条保护是对的,不为省一个事件名去放宽它。
  ● 契约 `test:capture-trio`(8 组判断),27 条注入回归全部被抓、0 漏网。

- **悬浮播放球(2026-07-31,用户:「开始播放后可以变成一个圆形的悬浮按钮么」)**:
  连带做了一次**结构改造** —— 播放器从 MusicPanel 里的一个 `<audio>` JSX 节点,
  搬到 `lib/platform/music/player-engine.ts` 的**模块级单例**(audio 挂 document.body)。
  原因很硬:React 元素随组件卸载被销毁,切走音乐页那一刻歌就断了,
  而球的全部意义正是「人走了、歌还在放」。形制照 session-state:单一真源 + 订阅。
  ● 交互:开始播放**默认展开**(曲名 + 播放/暂停 + 下一首 + 关闭),6 秒后自己收成
    一个圆球(带进度环);收起态点球重新展开。**刻意不做「点球直接暂停」** ——
    球贴在屏幕边上,滑动误触的代价是音乐莫名其妙停了而用户不知道碰到了什么。
    **关闭不藏进长按**:找不到怎么关掉的用户会去清后台。
  ● 关闭 = **真停**(pause + 断源 + revoke objectURL + 清 currentId,并清掉车机/锁屏
    残留),不是把球藏起来 —— 藏起来而声音还在,用户会满屋子找是谁在唱歌。
  ● 层级 z=935,夹在洞察浮层(929/930)与 elevated(940)之间;位置抬到底部导航之上
    (安全区 + 4.6rem),不拿一个新功能挡掉四个旧入口。
  ● MediaSession 收归引擎自管(跟着正在放的东西走,不跟着哪个组件还挂着)——
    交给组件的话,人离开音乐页后车机上会一直停在上一首。
  ● 音乐页开着时球让位(那一页底部已有完整播放条,同屏两套控制是矛盾)。
  ● 顺手把 `seek` 接到界面(可拖进度条,时长未知时不给拖);删掉没人用的
    `resetEngineForTest`;登出/清空/删账号四处在清曲库**之前**先停播。
  ● 契约 `test:music-floating-player`(11 组判断),29 条注入回归全部被抓、0 漏网。

- **Bug4 图文对照 30 页(2026-07-30,已做完)**:一份逐页标注的截图 PDF,页 N 的文字说的是
  页 N+1 的那张图。分四批落地(`5fdef9b3` / `28efa1c1` / `a4343477` / `24cc43fc` + 自查回补)。
  改动集中在**删多余文案**与**把说明改成能用的功能**两类,几处涉及数据正确性:
  ● **admin 面板的数字会说谎**(图18):延迟均值把没报耗时的调用按 0 计入(漏报越多显示越快);
  总计的成功率/延迟拿各路由**已取整**的百分比再加权;成本只给一个 ≈$X,看不出几成是真
  token 价。三处全修,面板直说实测覆盖率、估算行标 ≈。
  ● **时区**(图19):活跃时段按服务端 `getHours()` 分桶 —— 那是「部署在哪就是哪个时区」,
  换 region 数据会悄悄挪位。改 `getUTCHours()` 明确分桶,前端按看的人的时区旋转。
  ● **治理面板混了两种数据**(图14):治理面总数是请求时现算的,就绪模块/数据总线来自
  构建期快照,三张卡长得一样。现各自注明并在快照超 14 天时标出;`聚合状态` 此前不论
  ok/warn 一律染红;五个写死十六进制改 token;路由注释里写死的「29 个治理面」实际是 21。
  ● **新功能**(原来只是壳):剧场按钮从「弹 toast」变成真的本机记忆短片(挑记忆里的照片,
  按点选顺序播,字幕只用用户自己写的原话,不上传不调 AI);「车」页扩成**资产页**
  (房产 tab + 车 tab),估值走手动锚点(用户拍板方案 1,零外部依赖),税费/维修/保养的钱
  进财务(`addManualEntry` 带 assetId),不花钱的那半(谁做的/多久一次/下次)进新的
  `lib/portal/asset-care.ts`,附件压过存本机 IDB;「做饭计划」重做成**美食日历**
  (一天三顿、只显示排过的、点进详情页编辑),新增 `lib/cooking/meal-calendar.ts`。
  ● **新 key**:`nesio-asset-care-v1`、`nesio-meal-calendar-v1`(均 durable,已登记)。
  ● **自查复盘发现的漏项**(图6「念念还记得的内容逻辑正确吗?」我一开始只改了按钮名、
  没回答那个问题):它对 tag **一视同仁**地取交集,而记忆上的标签一大半不是主题 ——
  来源(邮件/flomo/日历)、采集方式(手记/Voice)、内部维度(domain:/facet:)。
  任意两条邮件都共享「邮件」,于是「你 X/Y 也记过类似的一次」对**几乎任何一条记忆**
  都会出现而两条毫无关系 —— 和「健身邮件被认成健康打卡」是同一族的错。
  改:抽成纯函数 `lensEcho`(lib/portal/lens.ts),只认 `isTopicTag`、把共享的那个标签
  印出来让用户能检验、≥2 条更早的才敢叫「模式」。契约 `test:lens-echo`。
  ● 顺带修 `test:ui-consistency` 回归:引导卡分组图标此前直接写 emoji,改走 icons.tsx 具名键。

- **本机存储 key 全量普查(2026-07-29;161 个 key)**:根因是
  `storage-manifest.keyKind()` 默认返回 `durable` —— **新 key 不登记就自动获得
  「进备份 + 整键 replace 上云」**。捡出两类真事故:
  ● **凭证泄露(安全)**:`nesio-connector-tokens-v1`(Notion/Tesla 原始令牌)与
  `nesio_admin_secret`(/admin 管理密钥)双双判成 durable → 明文进备份 JSON 并推到
  云端 user_module_data。根因是靠猜词识别:正则写 `token([-_]|$)` 认不出复数
  `tokens-v1`,更没有 `secret`。修:扩正则(`tokens?`/`secrets?`/`credentials?`/`apikey`)
  + 明确的 `AUTH_KEYS` 名单兜底。
  ● **按设备簿记被当用户数据**:同步水位/云同步 outbox/今天页日键卡片状态/草稿等
  **24 个键**改判 cache(此前每轮 churn 上云,且整键 replace 两端互抹)。
  ● **系统性修复**:新增契约 `test:storage-key-registry`(**已进 CI 安全链**)——
  在册 161 个 key,源码里出现未登记的 key、或在册键分类漂移、或凭证误判、或核心
  用户数据被误判成缓存,四者任一即红。判据写进 CLAUDE.md 与 `docs/storage-keys.md`:
  「换台设备后这个值从头开始是否正确?」是→cache,否→durable,凭证→auth。
  ● **一次性自愈** `lib/portal/storage-heal.ts`(Portal whenIdle,幂等):清历史邮件
  重复节点(同 emailId 保最早;无 emailId 的**仅当**有同名正主时才删 —— 没正主的是
  老同步真数据,宁可冗余不误删)+ 清 11 个已拆模块的孤儿 key。契约 `test:storage-heal`。

- **日程页重复与日期(2026-07-29,真机截图实锤)**:三个病灶。
  ● **富化抹字段(核心,影响面远超日程页)**:`ingestLifeNode` 的 externalKey upsert 走
  `updateLifeNode`,而后者是**顶层浅合并** → `patch.attributes` 整块盖掉旧的。Gmail 先用
  本地抽取落节点(带 date/summary/article/store/eta/amount/orderNo/trackingNo),随后云 AI
  富化只带 AI 那几个字段 → 上述**全被抹掉**,邮件日期退回 createdAt(看起来"所有邮件
  都是今天")。修:upsert 合并 attributes(新值优先、旧值补位)—— 同时修好判决层邮件
  信号与记忆详情的字段缺失。
  ● **无主富化节点**:AI 认不出源邮件时没有 emailId → externalKey 为 null → 每轮富化新建
  一个去重不掉的重复。修:认不出就丢弃这条富化;能认出的补上邮件头 date/from。
  ● **跨日历同一场会**:多日历订阅同一场会,start 时区写法不同(Z / +08:00),同步侧按
  原文比对认不出。修:展示层按「标题|绝对时刻」再收一次。
  ● 另:日程页此前**完全没用 Gmail 的分类字段**(路由早已把 labelIds 归一成 `mailCategory`
  存进节点,下游却在用本地正则猜广告)。改为 promotions/social 用 Google 判定直接毙、
  IMPORTANT 直接留,本地正则降级为无官方分类时的兜底;邮件排序改按绝对时刻
  (RFC2822 头字符串比大小是错的)。契约 `test:schedule-panel-dedup`。

- **Guidance 全 AI 化(设计定稿 2026-07-29;Step 0-3 已落地,影子模式运行中)**:
  用户拍板把 8 层规则管线(severity 表/窗口/打分/预算/冷却/排序/AI 润色)换成
  **1 个 AI 判决层 + 3 道承诺门 + 1 个档案**。规则从「判断内容」退到「执行承诺」。
  设计要点(都是审计换来的,别回退):① 指纹 = hash(决策相关字段白名单),算在**源信号**上,
  AI 输出不参与(v1 静音失效尸检);② 判决与时间无关({showFrom,showUntil} 绝对日期,
  本地日键每日免费重算),缓存键=指纹 → 判过永不重判(稳定性,措辞一变静音就失效);
  ③ 跨批归并:prompt 带活跃卡清单,mergeInto 只认真活跃卡,归并不改文案不解封不复活;
  ④ 严格解析在服务端:幻觉指纹丢弃/6 分组封闭/窗口钳制≤14天/纯文本源(email/memory)
  severity 封顶 1(结构化字段才配 ≥2 —— 也是邮件注入的爆炸半径钳制);⑤ 三门:静音
  (永不再出,severity 3 也无上诉)/当日 dismiss(cooling 的全部合法遗产)/配额(定序:
  sev 降序→showUntil 近→结构化优先;**sev3 豁免** —— 承诺管噪音不管安全);⑥ 兜底
  **零分类零正则**(今明全部日历事件+物品今明效期+账单≤3天 —— 家长会不再因不认得而漏);
  ⑦ 档案双清单(洞察·回望):「说了的」(规则/影子双轨+whyNow+证据+门记录+改判,改判率
  >15% 亮琥珀)+「没说的」(AI declined+理由+「该提醒我」——**漏报的唯一监测面**);
  ⑧ 跳转 resolver 从指纹前缀确定性推导(AI 的 target 字段废弃;解析不出=不渲染按钮);
  ⑨ 影子模式:判决只进档案不上屏,老管线继续出卡,攒对照;影子改判桥进 card-verdict,
  实弹切换那天直接生效;⑩ 成本 admin 全捕捉:/api/portal/guidance-judge 走 completeText
  (真实 token+cost_usd 进 telemetry_events),/admin AI 成本面板改为**优先真实 cost_usd**
  (原为拍平常数)。文件:lib/platform/guidance-engine/{ai-judge,guidance-gates,fallback-cards}.ts ·
  lib/portal/{card-archive,card-target,guidance-judge-auto}.ts · app/api/portal/guidance-judge ·
  components/portal/insights/CardArchivePanel.tsx(挂洞察·回望「我的实验」槽位旁)。
  契约:test:guidance-judge / test:guidance-gates / test:card-archive(均可注入 now)。
  **数据缺口补齐(2026-07-29 第二批,影子判决的输入面拉满)**:
  ● **Plaid /liabilities/get 接入**(用户定的最高优先缺口 —— 9 张卡的还款日/最低还款
  此前没有任何来源):transactions 路由与 recurring 同款容错(单 token 失败不阻断、
  产品未开通静默跳过、全挂字段缺席保留旧数据),归一 {accountId,kind,dueDate,minPayment,
  statementBalance,isOverdue};客户端 `nesio-plaid-liabilities-v1`(bank-tx save/load);
  judge 信号窗口 [过去7天(逾期仍要说), +14天],月度账期 dueDate 变 → 新指纹 → 自动重判。
  ● **邮件正文喂判决**:批内 email 信号从本机 IDB(getEmailBody,里程碑 A)取全文 ≤4k
  附进 fields —— 指纹只认白名单字段,附正文不改指纹(静音/去重稳定)。
  ● **天气告警接线**:WeatherSnapshot.alert(NWS 字符串,取了一直没用过)+ 日常天气
  (温度取整防指纹抖动)走 domain 源进判决。
  ● **隐私清除确认免做**:档案/judge ledger/verdict 全是 `nesio-` 前缀 localStorage,
  storage-manifest 的 purgeLocalData 自动覆盖;只有独立 IDB 才需手工挂 purge。
  **Step 4-6 硬拆到底(2026-07-29 同日,用户拍板「硬拆到底」跳过影子对照周)**:
  ● **实弹**:出卡源 = loadLiveJudgedCards(ledger 窗口重算+三门+临近保底,同步免费);
  文案即判决文案(润色层删除);卡轻点走 resolver;「知道了」= dismissJudgedCard 当日日键;
  severity 3 豁免展示配额(TodayFeed urgent 通道);AI 不可用 → 结构化兜底 + 可见提示行。
  免费档 canUsePaidCloudAi 前置拦下不出网(paid-cloud-gate 契约改钉这里)。
  ● **物理删除 13 文件**:guidance-pipeline / source-adapters / interrupt-evaluator /
  cooling-store / consequence-rules / action-window / actionability / attention-budget /
  guidance-ranker / llm-sweep(+auto+route)/ guidance-language 路由。types.ts 瘦身只剩
  DomainInsightItem(衣橱/跨区仍引)。**正则病灶真机实锤后拆**:GitHub PR 邮件标题的「健身」
  被 LEXICON.health 抓成「今天的健康打卡」+打卡按钮 —— specialDays/healthItems 两条正则路径
  刻意不喂判决(生日走 relationship person 节点,健康走 health 域判定)。keyword-lexicon 保留
  但降级为邮件候选粗筛(召回),不再决定卡类型。attention-engine 保留(FOCUS 区日历排序,
  不属出卡管线)。DEC 卡/穿搭折成 extras domain 信号进判决(面不丢,出不出归 AI)。
  cloud-learning-sync 剥离 ranker(学习态只剩偏好,旧 blob trainLog 读时忽略)。
  ● **契约随拆重写**:删 test:llm-sweep/guidance-ranker/guidance-holiday-fallback;
  card-verdict 改钉三门消费(isMuted→isCardSuppressed / dismissJudgedCard);
  sync-dedup-mute 的「改写前定死指纹」改钉「factKey=源信号首指纹」;finance-insight/
  health-guidance-bridge/node-provenance/relationship-insight 改钉 gatherDomainInsights→判决批
  新链路;cloud-learning-sync/paid-cloud-gate/server-entitlement/ai-route-provider-parity/
  context-adapters/silent-failure-observability 同步更新。
  ● **Step 6 推送(用户拍板:设置页开关、sev3 才推)**:web-push 依赖 + 
  supabase-push-subscriptions-v1.sql(**需部署侧 apply**)+ /api/portal/push-subscribe
  (登记/退订,service-role 写)+ push-send(判决路由 after() 里对 sev3 新卡发推,
  410/404 清死端点)+ 设置页「重要提醒推送」开关(权限只在开关处要,失败态可见)。
  **部署侧动作**:apply 上述 SQL + 配 NEXT_PUBLIC_VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY /
  VAPID_SUBJECT(未配则推送整体 inert)。
  **风险如实记录**:AI 判决在真机零次运行的状态下上了实弹(用户明示拍板)——
  AI 挂/无 key 时 Today 只有结构化兜底;档案(洞察·回望)是唯一监测面,上线头几天盯改判率。
  继承债:ledger/档案/verdict 三个 key 跨端要 union 语义,暂不进 module-sync 整键 replace。

- **反馈学习环曾经整段空转(2026-07-29 修;用户实锤「我点了稍后、不要再出现、或者
  喜欢,不管点哪个他都会出现」)**。审计结论:不是某个动作坏了,是 per-card 这一维
  **没有任何消费者** ——
  ① `guidance-ranker` 在线学习 2026-07-27 已退役(`RANKER_LEARNING_ENABLED=false`),不再订总线;
  ② `preference-store` 只认可复用维度 `{domain, card_type, alert_type, merchant}`,
     Today 发的是 `dimension:'card'` → 直接丢弃;
  ③ `feedback-log` 对 `today/card` 直接 `return`(指望 DEC 富路径落事实),而财务/域洞察卡
     从不登记 `getRegisteredDecCard` → 连事实都没落;
  ④ 「稍后」只走 `snoozeOverdue(card.nodeId)`,而这些卡根本没有 nodeId → 纯空转;
  ⑤ 唯一残留的记忆是 cooling-store 的 2~24 小时冷却,而且渲染层 `recordDismissed(card.cardType)`
     写的键与管线读的 `dedupKey`(多实例类型是 `type:id`)**对不上**,自适应加倍冷却从未生效。
  **修法**:新增 `lib/portal/card-verdict.ts` —— 用户的裁决要比数据活得久。
  稍后=3 天到期(不看内容,不依赖 nodeId)/ 不要再出现=按**事实指纹**永久静音(内容变了才放行)/
  太多了=整类静音 30 天 / 喜欢=只改排序(补发 `dimension:'card_type'`,管线打分读
  `getWeight('card_type', …)`)。指纹必须在 **Layer 7 AI 改写之前**算定(`ProactiveCardData.factKey`),
  否则每天一次新改写就是一个新指纹,静音永远命中不了 —— 第一版就栽在这。
  静音必须可反悔:`readCardVerdicts`/`clearCardVerdict`,已在「Nesio 记得的偏好」面板列出 +「重新接收」。
  契约:`scripts/card-verdict.test.mjs`。
  **剩余欠账**:`nesio-card-verdict-v1` 走通用 module-sync(整键 replace / LWW),
  两端各自静音会互相覆盖;真正对的语义是 union(静音只增不减)。等跨端备份问题收敛后再看。

- **API 导入源取数窗口普查(2026-07-29,用户问「健康/足迹/Granola 是不是也这样」)**:
  逐个源查代码,结论是**一类系统性问题**,不是四个孤立 bug。事实表已固化为
  `IMPORT_WINDOWS`(lib/portal/backup-inventory.ts,契约钉住)并在「数据接入」页
  折叠展示 —— 用户看到某板块内容少时先对表,别再误判成同步坏了。
  ● **日历:只拉未来 90 天,一条过去的都不拉**(calendar/route.ts:238 `timeMin = now`,
  maxResults 80/50)。这条最反直觉:一个把「回溯>预测」写进公理的 App,日历里只有未来。
  QA 报告的「202 条日历项」不是同步不全,是设计如此。
  ● **Gmail:首次仅 `newer_than:30d`**,之后增量(gmail/route.ts:193)。181 封同理。
  ● **Granola:接口只接受 this_week/last_week/last_30_days**,最多 30 天,无更宽选项。
  ● Plaid:分页正确(50 页 × 100,`has_more` 为真就继续,上限 5000),**是唯一有
  真全量回填的源**;但 `/transactions/sync` 产品**不覆盖投资账户**,券商流水另走
  `/investments/transactions`(近 24 个月)—— 这解释了 24 账户仅 127 笔:
  多为投资账户碎账,消费卡可能压根没连。
  ● 健康:Apple Health 导出文件里有多少是多少(全历史),瓶颈在用户导不导。
  ● 足迹:上限 20000(非瓶颈);历史靠手动导 Google 时间轴 JSON,实时点靠后台定位。
  **结论与欠账**:三个源(日历/Gmail/Granola)结构上拿不到更早数据,而 App 的立身之本
  是回溯 —— 这是**产品级缺口**,不是修个参数的事(日历可加历史回填参数;Gmail 可加
  一次性深挖;Granola 受上游 API 限制)。已如实呈现给用户,**是否补回填待用户拍板**。

- **预测功能(实验版;2026-07-29 用户批「先离线回测」)**:评估 MiroFish(多 Agent 模拟
  预测,AGPL + Zep 云记忆)**核心不借** —— 方向与「回溯>预测」公理相反、要把生命图谱
  送第三方云。改为自研,立场三条:① 预测必须可证伪(每条记录做出时间/区间/依据,
  到期与真实值对账);② **区间只能来自回测残差,不许拍脑袋**(拍出来的区间 = 编数字,
  踩红线);③ **先赢过笨基线再上线**(技能分 = 1 − MAE/笨基线MAE,≤0 直接删)。
  定位改过一轮:不做「预测页」(无人主动打开),做**问的答案 + 到期回执**
  (「上月我说 2800,你花了 3050,偏 9%」——预测最终被回溯吃掉);记分卡留 Lab 当审计。
  砍掉 LLM 叙述层(收益只是措辞好听,代价是成本+胡说风险)与不改变决策的预测项。
  **已落(离线回测台,无 UI)**:`lib/portal/forecast-core.ts`(纯核,零 import)——
  visibleAt 防泄漏唯一入口 / 候选预测器 / 两条笨基线(上月即本月、近3月中位数)/
  技能分 + 残差 p80 区间 + 三档裁决(采纳≥5%且样本≥8、否决、存疑);
  `scripts/forecast-backtest.mjs` 读 App 导出备份(nesio-bank-tx-v1)或内置合成样例,
  离线出表。契约 test:forecast-core(**防未来泄漏是第一断言** —— 假准确率比没预测更危险)。
  关键发现:仓库 42 个导出函数本就接受可注入 `now`,天然可回测,无需改造。
  合成样例首轮即淘汰「日均外推」(技能分 −301%:月初房租被摊到全月 → 系统性高估),
  「已发生+同期尾段中位数」+22.6% 达标、p80 带宽 ±6.9%。
  **首轮真实回测(18 个月 / 94 笔)与后续修正**:结果不是「能不能做」,而是暴露了
  三件事。① [我的 bug] 不同开口率的预测器被并排排序(日均外推 6 个月、尾段中位数
  16 个月,MAE 算的不是同一批月份)→ 新增 backtestPaired,横向比较只在共同月份;
  ② [我的漏洞] 裁决只比相对好坏 → 首轮四个候选全「采纳」,其中技能分 +60% 的那个
  区间是 ±107%(「大概花 1000,上下浮动一千」)→ 补 MAX_P80_PCT=25 与
  MIN_COVERAGE=0.8,verdict 增 unusable/sparse,最佳候选改按可用性排序;
  ③ [目标选错] 每月约 5 笔的密度下,「月底总支出」被单笔消费落在月末还是月初主宰,
  **是预测目标本身不可预测**,不是方法不好 → 增开「定期账单」候选线
  (下次扣款日/金额,间隔与金额均取中位数抗跳票与一次性异常)。
  合成样例上:日期线判「否决」——**不是不准,是「上次+30天」一样准**(技能分 +0.0%,
  平均误差 0.56 天),即回测台在说「别写复杂算法」;金额线赢 21% 但区间 ±58% 判不可用。
  口径修正:回测此前只读 nesio-bank-tx-v1,比 App 的 loadCombinedFinanceTx 还窄 →
  已补读 nesio-expenses-v1(手动记账/现金红包渠道)。
  **数据悬案(待用户确认)**:导出备份里流水 127 笔,用户称 App 内应有 3000+。
  已查证导出链路无结构性缺陷(collectIdbBlobs 直接枚举 IDB 全部键、IDB 值覆盖
  localStorage、键名与 createBlobStore 一致),故加「备份清单体检」把答案摊开:
  若清单显示流水 3000+ 则是读取问题、显示 127 但记忆 2000+ 则是该设备未同步完、
  几乎全缺则是导出 bug。**此悬案未清前,前述所有裁决不作数。**
  **顺带产出(独立价值)**:`lib/portal/backup-inventory.ts` + 导出装箱单回执 ——
  「随时导出你的全部数据」此前无从验证,现在导完就地报清各主数据条数与体积,
  主数据缺失或 0 条时琥珀提醒(空数组比缺键更迷惑人)。契约 test:backup-inventory。
  **下一步(等用户跑真实数据)**:`npm run forecast:backtest -- --data <导出备份>`,
  按真实技能分决定做哪几个;通过的才接 UI。候选池待扩:现金流最低点/转负日
  (balanceProjection 已在,但缺历史每日余额,回测可行性待评)、下一笔定期账单日期与
  金额、订阅涨价。口径说明:回测用 `amount>0` 近似支出、未跑完整 txFlow,
  绝对误差略糙但模型与基线同口径,**技能分仍可信**。

- **UI QA 报告修复第一批(2026-07-29;报告约 50 条,先修阻断与误导)**:
  **已修** —— ① 致命:清数据/新用户「归入账号」对话框被自己的不透明遮罩(929)盖死
  (opaqueOverlay 非全屏面板抬到 930,.nesio-sheet--over-opaque);② /admin 鉴权 fail-open
  (未配 Supabase 整段跳过密钥校验 → 改为无条件要 NESIO_ADMIN_SECRET,没配即 503);
  ③ 记忆搜索乱串返回 1473 条(classifyDomain 零命中兜底 'life' 域被当真域给全域 +6 →
  置信 ≥0.5 才让域参与加分);④ 财务净资产 -$1,294 漏 23.5 万投资(assetSummaryWithHoldings:
  投资账户无 balance 用持仓市值兜底;卡片/总览 hero、combinedNetWorth/快照同步换口径,
  卡片 hero 并入手动资产与负债明细);⑤ 「成功率 10000%」(analyst 与 metrics 路由
  小数/百分数口径打架 → okRateFrac 归一);⑥ 日期错位一天(UTC 日键):衣橱穿搭/健康
  月报生成于/记账锚点/训练记录改本地日键;⑦ 车页三条指路死链 → 真跳板块
  (nesio-open-insights 深链扩到全部 MainTab + 洞察已开时就地切板块;记忆搜索跳转
  自动关洞察浮层 —— 也修「问念念被弹窗盖住」同类);⑧ 会员页「试用剩 21 天」vs
  「已是 Pro」打架(isPaidPro 优先);⑨ 换计划无确认 → 二次确认(说明打卡保留);
  ⑩ 今天列表底部被悬浮导航压住(5.5→6.5rem);⑪ 记忆筛选后头部计数不更新
  (命中/总数);⑫ 详情页泄露 epistemic/generator 等内部字段(列表预览同步藏);
  ⑬ 详情弹窗加可见 ✕;⑭ 静息心率 62→77 标「平稳」(判向叠加相对水平口径)。
  **第二批(2026-07-29,三路诊断 agent 后全修)**:
  ● **死按钮群总根因**:洞察是 fullscreen sheet(930),从它里面开的 bottom/center 还是
  901 → 全被压在下面,看不见还吃掉下一次点击(=「点两次才生效」)。修:原语三态 +
  遮罩全部同层 930,层叠交给 DOM 顺序(后开永远盖先开,两个方向都对);
  visitmem/imgzoom 陪同抬 935/940。一次性复活:物品页按钮、关系联系人详情/记给某人、
  剧场播放器、足迹地点卡。另修:物品分类行/标签变真入口;衣橱卡片图片区=打开编辑;
  👎 落盘 dislikedItemIds + 免费档规则版真换一套(避开刚否决的单品);镜子下拉 Esc
  capture 只关自己;足迹「标记当前位置」点击即出「正在取定位…」;日程行经搜索跳转链路
  本就通(双击修复后可用)。
  ● **性能**(速记提交/切页 10-45s 冻结):nesio-life-graph-updated 风暴 → useTodayData
  合并窗 400ms 拖尾一次;addCommitmentNode 去掉重复 broadcast(整条管线跑两遍);
  全图 JSON.stringify 落盘改 400ms 合并窗 + pagehide 冲刷;MemoryTab:typeCounts/facet/
  pinned/core 全 memo + Map 索引、搜索/显示全部改增量渲染上限(+100)、搜索按键防抖
  250ms;whenIdle 兜底 3s→10s(不再在手势中间开跑)。
  ● **状态污染**:jot 草稿乱码 = 语音 interim 半句实时落盘 + 键被云同步复活 →
  只落最终稿、卸载停识别器、读入验长度、键入 CACHE_KEYS(不再跨设备回灌);
  rose 主题 = 缺省键硬编码 bluegray-rose → 缺省回品牌蓝(THEME_BOOT + getPalette 同改);
  积分 0→150 = 云端恢复(按设计,存疑留观察);Lab「Pro 解锁(测试)」构建旗标才渲染
  (NEXT_PUBLIC_ENABLE_PRO_OVERRIDE,产线摇树掉)+ 覆盖位键入 CACHE_KEYS 不同步;
  cloud_mirror 断网 60s 熔断、learning_pull 补单飞+20s 节流+离线跳过(控制台不再刷屏)。
  ● **数据质量**:donut 小扇形也标数(可见加总=中心总数);库存 addPantry 同名 upsert
  (并数量/取更早效期)+ 菜谱食材去重;衣橱视觉识别加 not_clothing 出口 + 建议器
  非穿戴正则兜底(毯/枕/帘…);睡眠区间合并防重叠重计 + 有分期来源优先 + 16h 生理帽
  (修 21.5h/97.3h);身高/体重/BMI 月值改中位数(修 7 个月 ±6cm);指标区间标「月均」
  (修 672 超 400–492);血糖 min/max/TIR 统一 90 天窗 + 「峰值」改「90 天最高」;
  足迹月卡锚定真实当前月 + live ping 带本地时区偏移;flomo markdown 剥离
  (stripMarkdownInline:导入层 + 标题/预览/详情引文/走走看/线头五处显示层,
  2191 条旧数据显示层即净);问候语「最近的一件今天到期」。UTC 日键清理:
  「现在→日键」语义 26 处全改本地(lib 层内联防 vm 测试壳,组件层用
  lib/portal/local-day);历史时间戳分桶口径不动(移动已有数据归属日风险大)。
  **小尾巴已清(2026-07-29)**:① 回填记账 O(N²) → 批量(200 节点 × 四阶段 ≈ 800 次
  全表读写,是打开记忆页卡顿的真实来源;诊断报告说的「200 次顺序 POST」不确 ——
  请求本就是一次批量 POST,贵在记账);② outbox 重试补指数退避(30s×2^n,封顶 6h)
  + 单轮 25 条上限,且**网络错改判 transient** —— 此前断网一次就被标永久失败、
  踢出重试队列,还顺序发几百个注定失败的请求;③ 一轮同步内 buildCombinedBackup
  读两遍 → pull 未落地任何改动时复用快照(落地了就必须重读,否则会用 pull 前的旧值
  把刚拉下来的新值顶回去);④ 云端填数留一次性回执(lib/portal/cloud-restore-receipt.ts,
  今天页读一次即清)—— 积分 0→150 查证是按设计的跨设备恢复,但**数据被悄悄改变
  而用户不知道本身就是问题**;⑤ 日程行改为直接打开节点详情(r.id 本就是真实节点 id,
  此前一律跳关键词搜索、标题拿去全库搜多半零命中 = 像死按钮),洞察内挂
  MemoryNodeDetail(层叠统一后从洞察开不再被盖);⑥ VoiceInputSheet chunk 空闲预取。
  契约 test:cloud-retry-backoff。顺带更新一条既有钉子:catch 里落账失败改用批量函数,
  钉子放宽为「认两种写法」——钉的是行为不是函数名。
  **仍欠**:健身「练过的/身体数据」卡在源码中不存在(疑 QA 构建不一致,待对版本);
  剂量编辑器;跑步长计时无 wake-lock;contentHash 不让步(微优化)。
  **全程待真机复验 —— 本会话 20+ commit 一次真机都没验过,尤其 sheet 层叠统一
  影响全 App 每一个弹窗。**
- **健身板块:「今天练什么」生成入口 + 假功能修复批(2026-07-29,用户批)**:
  评估 workout.lol —— 视频库**不借**(639 条系 MuscleWiki 抓取转存自家 S3,版权不净、
  外链不可控;本地 1324 GIF 已全量),只借「器械先行 → 选部位 → 一键成套」的入口形。
  **新增**:workout-generate(纯规则槽位抽样,主 4 辅 2,rng 可注入;器械偏好
  nesio-workout-equip-v1;回溯 nesio-workout-last-v1 + suggestNextFocus 推→拉→腿轮换)·
  WorkoutGenSheet(两屏 NesioSheet:两问 → 草稿逐行「换一个」,失败态+重试)·
  健身 tab 入口卡(回溯小签「上次练了 X · N 天前」)。契约 test:workout-generate。
  **假功能修复(三路审计 16 条,全部核实后修)**:① 完成历史 nesio-workout-history-v1
  (自定义/生成/计划跟练完成都记;健康页负荷判断改取 max(计划打卡, 完成历史),
  「最近打卡」含全部来源 —— 修「自定义练完哪儿都不记、负荷永远说偏少」);
  ② 健身 routine 卡恢复出卡(批次 175 静默隐藏但 RoutineSheet 一直在承诺);
  ③ 计划动作 SKILL_TO_CATALOG 手选映射 15 个 → 跟练有演示图+中文要点(原纯文字);
  ④ base-path 修复(exerciseAnimDir / 节拍 WAV,子路径部署 404);⑤ 壳内静音策略如实
  显示 🔇 + 解锁联动;⑥ 打卡回执(对勾描线,不再无声消失)+ 当天防重复(积分不可刷);
  ⑦ 长计时 mm:ss(修「计时 1800s」);⑧ 扩展库剂量按性质(静态 3×30s/腹 3×12);
  ⑨ 动作库草稿落盘(误关不丢);⑩ 精选卡展开渲染已有帧;⑪ 播放器 GIF 失败态可见;
  ⑫ 计划周期走完如实提示。
  **仍欠**:剂量编辑器(存的训练不可改组数次数)、跑步长计时无 wake-lock/后台处理、
  计划单阶段无真进阶内容、row_erg/bike 无演示映射、catalog/ 126MB Gym visual GIF
  版权 tripwire(公开部署须清,见 public/exercise-anim/.gitignore)、全程待真机验收。
- **财务板块大修(施工中;P0 止血已落 2026-07-28)**:P0 全清 —— ① 数据销毁路径钉死
  (bankDataReady 水合前置 + 先读后替换 + 疑似清空保险丝 bankTxWriteAllowed,合并抽纯函数
  mergeBankTxForSync);② summarizeMonth/accountMonth 符号化(正数 INCOME 冲减收入、
  refund 流出不再倒扣两次);③ 统一数据集 loadCombinedFinanceTx(FinanceTab/aggregate/
  domain-insights 同源,修同屏两套数);④ 残月环比改「与上月同进度相比」(throughDay);
  ⑤ 冷启动区分加载中/未连接 + 同步失败态落盘透传(loadBankSyncStatus);
  ⑥ Fidelity 定投分流(investmentAccountIds + 券商描述符兜底 → transfer,股利仍收入)。
  契约 test:finance-p0;现有 10 套财务契约全存活;tsc+build 绿。
  **用户拍板**:币种不考虑;UI 按 v3.3 稿(artifact fb540e24,8 屏);接 Plaid recurring API(P2)。
  **P1 已落(2026-07-28,数据层+UI 全接完)**:finance-assets(手动资产/锚点即值/净值日快照,
  createBlobStore 自动进备份+云同步)· receipt-match(小票↔银行候选+否决负样本)·
  finance-sources 扩 income/channelId/linkedBankTxId + addManualEntry ·
  聚合并入 domainIncome。UI:QuickAddSheet(全局「+ 记一笔」三段合一,NesioSheet bottom)·
  总览净值 hero(Plaid+手动+快照曲线)· 卡片页手动资产列表(该盘点了琥珀提示/更新/移除)·
  小票旁条「可能是同一笔 → 关联/不是」。契约 test:finance-assets;
  sheet-allowlist/i18n/inert-buttons/颜色 token 全过;tsc+build 绿。**待真机验手感。**
  **P2 已落(2026-07-28,分析升级)**:① 投资收益:investIncomeYTD(当年股利/利息+按月,
  数据现成 INCOME_DIVIDENDS 标注)· portfolioCheckup(集中度/配置/买卖回顾,借 ai-hedge-fund
  确定性因子形)· 投资页(死枚举转真页:今日变化/收益/持仓/体检,快照口径如实);
  ② 订阅监控页(死枚举转真页:7 天将至/变化置顶(涨价/新增/疑似停了=两周期没扣款,信息蓝)
  /稳定收起;负担率与列表同一份数据);③ 基线剔除数据集最老残月;④ finding id 稳定化
  (r.key,Today 去重不再失效);⑤ guidelines 补 4 条(FICO 30%/JPMC 6 周缓冲/CFPB×2);
  ⑥ **折旧与持有成本(用户拍板)**:assetDepreciation(锚点差)+ assetHoldingCosts
  (Expense 扩 assetId/assetCostKind:税金/维修/保险,「+」支出段可关联资产,
  卡片页资产行显示「折旧/今年持有(税金·维修)」);⑦ 繁体「約」修正。
  契约:finance-assets 扩 P2 断言;insight/features 两处旧钉按新行为更新;全套财务契约+build 绿。
  **尾巴已收 + P3 第一批(2026-07-28)**:① Plaid /transactions/recurring/get 接入
  (服务端逐 token 拉、失败静默跳过;客户端存 nesio-plaid-recurring-v1;订阅页
  「Plaid 识别的补充」区 —— 并集展示,本地为准);② findings 可点(kind→子页映射,
  死文字变入口);③ 图表统一:环形图前 6+其他(对齐月报)、趋势图去双重编码只留柱
  +断档月虚线标记+去小值抬高、预算超支比例如实文字;④ 纠错闭环:批量「全部按建议」、
  「排除」改真语义「不计收支」(原为归 OTHER 仍计支出的骗人文案)、已学规则显示
  label(mch_xxx 死代码复活)、月报自动生成失败可见。plaid-multi-item 钉子按新架构更新。
  **全面自查 + 修复(2026-07-29,三路审计:UI 按钮/逻辑链路/全量契约链)**:
  P0 修 —— ① 空态死锁(没连银行永远点不到「+」,手动记账链路不可达 → 空态加入口);
  ② 手动/小票默认币种写死 ¥ → defaultFinanceCurrency(银行主币种同源;USD 用户手动账
  此前被 KPI 静默排除,CameraSheet 同修);③ domainExpenseTotal 把收入当支出 → kind 过滤;
  ④ Plaid 游标推进+客户端拒写=交易永久丢失 → 失败路径清 enrich 标记解锁 full 重拉。
  P1 修 —— txFlow 投资参数改**默认**(引用恒等 memo;一次修掉 needsReview/detectRecurring/
  categoryBaseline/budget/交易行/fact-journal 六处「列表说支出、KPI 不算」分裂);
  connector-sync 失败早退提前+孤儿复活兜底收窄(仅账户表空);finding kind 拼写
  (upcoming_bill);「+」挪子 tab 行首(小屏行尾溢出);「更新」带资产上下文;
  小票 taken 集+关联唯一性+悬空自愈;investIncomeYTD 限投资账户;recurringStreams
  「全挂≠没订阅」语义;切段清分类;渠道互斥;幽灵渠道过滤;formatMoney 币种补传;
  InvestPane/RecurringPane 空态;死代码清理(12 个 import/废 memo/死枚举)。
  全量契约链 3 处过期钉修复(2 处主干 e331fd8 漂移 + 1 处本次拆分)。
  **三件挂账已清(2026-07-29,用户批)**:① 现金渠道余额按 maybe 语义推算
  (channelBalance = 最新盘点锚点 + 其后该渠道收支累加;净值/卡片页/幽灵过滤同步切换);
  ② portfolioCheckup 买卖次数按 invSubtype 语义判(route 透传 subtype,入金/费用不再
  冒充交易,老数据退回符号判);③ 口径统一:趋势柱/预算 spent/风险预警 net-surge/
  月报净支出+环比+预算块 全部与 KPI 同含域内支出(opts.domainNet 通道,默认 0 兼容;
  FinanceTab 统一传入,自动月报按上月聚合传)。契约:channelBalance 断言入 finance-assets。
  **微动效借形(2026-07-29,用户批)**:评估 pqoqubbw/icons —— 不引库(motion 依赖
  + 第二套图标系统 = 孤岛,否决),只借「关键时刻一次描线」的形:纯 CSS 落两处 ——
  ① 连接器「同步」忙碌态由文字省略号改小圆弧旋转(.nesio-sync-spin,复用 nesioSpin);
  ② QuickAddSheet 保存成功一拍(对勾描线 .nesio-check-draw + status-go 底,700ms 后关)。
  均守 prefers-reduced-motion;不碰 icons.tsx 与图标契约。
  **P3 拆分完成(2026-07-28,财务大修四期收官)**:FinanceTab 1300→949 行,拆出
  RecurringPane / InvestPane / CardsPane / AcctLogo / QuickAddSheet 五个组件(纯展示,
  数据经 props;对齐 TodayFeed 拆分先例)。顺手修:卡片页 brokerage 归投资组
  (原被列进存款组,审计 A1)。**大修全清单收口;对账小票(需按账户快照)与
  overview/tx 段进一步拆分列为后续可选。全程待真机验收。**
- **财务板块大修(2026-07-28 审计完成,施工待批)**:四路深查(maybe 数据/分析/UI × 宝盒体检)
  收敛为 `docs/design/finance-maybe-audit-2026-07.md`。**P0 止血项含一条不可逆数据销毁路径**
  (connector-sync 先 replace 账户再按新表过滤流水写回 + 全仓无 `await store.ready()`,
  水合前同步可把全部流水覆盖成空且游标已推进)、summarizeMonth 符号 bug、同屏两套数据集、
  残月比完整月、冷启动假空态。P1 手动资产+估值锚点(UI 稿 artifact fb540e24)、净值序列、
  转账对敲负样本表、字段级规则锁。P2 基线统一口径/可操作 findings/新检测。P3 FinanceTab
  拆分/图表统一/对账小票。maybe 是 AGPL——只借形不借码。

- **美食语料扩容(2026-07-28)**:HowToCook(Anduin2017,Unlicense)368 道家常菜并入
  `public/data/cooking/recipes.json`(总 704 道,双语料 source 标注)——导入器
  `scripts/import-howtocook.mjs`(确定性解析,幂等可重跑),每份**家庭份量**补上
  老乡鸡出餐量缩放的缺口,难度星级/卡路里/封面图随行;工具词(烤箱/打蛋器…)不进
  ingredients 以免匹配管线「缺烤箱」。契约 `test:cooking-howtocook`。
  **UI 对齐已做(2026-07-28)**:①「餐厅出餐量,缩着来」两处文案按 `recipe.source` 分支
  (howtocook 是家庭每份量,原文案对它说的是错话);② 难度星级/卡路里进联想行 + 详情页;
  ③ 修营养估算单位坑:件数单位(个/根/片)曾被当克算(「青椒 3 个」= 3g,营养系统性偏低),
  `nutrition-core.massGrams` 白名单换算、件数不计,契约断言随行。
  **封面图已上(2026-07-28)**:`RecipeThumb`(无图/加载失败回退菜名首字占位,不出破图)——
  做饭首页自选列表 44px、两处联想行 32px、详情页 180px 头图(`recipeImageUrl` 首次真正被调用)。
  周计划是「星期+输入框」编辑行,不适合挂图,不加。
  **想做清单改成封面卡网格(2026-07-28)**:两列 4:3 大图卡(`RecipeCover`)。只改这一屏 ——
  它是「挑今天做哪道」,照片帮得上;自选列表那屏是状态列表(材料齐 / 缺 3 样),行式更好扫,
  搜索联想是按名字找,都保持行式。库里 354/704 有图,无图态放一枚线性餐具图标,
  名字只由卡脚讲一次(第一版在封面里排菜名,截图一看同名出现两次,像 bug,已弃)。
  **tips + 器具维度已收口(2026-07-28,本线欠账清零)**:
  ① tips 技法文 18 篇 → `tips.json`(importer 顺产,基础/技法/进阶三组)——双用途:
  「新手技法」屏(做饭首页入口,分组手风琴,轻 md 渲染,载入失败显式重试)+
  AI 生成菜谱 grounding(`pickRecipeTips` 确定性选摘 ≤2 篇×700 字进 prompt:标题钥匙词
  命中特殊要求/食材、荤料自动带去腥;选不中不带,不为凑数花 token)。
  ② 器具/技法维度:importer 对两语料从步骤文本确定性推导 `tools`/`methods`
  (704 道全量,161 道有明确器具;借鉴 cook.zhangjc.tech 数据形态,通用「锅」不算)——
  选菜联想加器具 chips(「家里只有电饭煲能做什么」:只选器具不打字时按库存命中率推 6 道,
  空结果显式提示)。契约:`test:cooking-howtocook`(tips/推导/语料形状)+
  `test:cooking-recipe-ai`(grounding 接线钉子)。**美食线无挂账;真机观感待看。**

- **激进审计落地(2026-07-27)**:Kill `nesio-card-feedback-v1`(DEC 改读 Signal 投影);
  停用 `guidance-ranker` / cross-region bandit **学习接线**(Today 回规则分+Preference+cooling);
  退役 living-model API(410)+Lab UI+`nesio-lm-feedback`;demo personalization stage 停写;
  Recency 已退役。成长大面保留并教练化(主路径「今天这一件」、弱化 POINTS)。
  信任缺口:`hasWeakEvidenceChain` + pin/add 不再冒充 useful。写入门契约 `test:write-gate`。
  可视化:Finance 面积+柱+启发句;BodyLedger 面积填充。品味旁注 `docs/design/taste-notes.md`。
  文档 `docs/design/signal-epistemic.md`。契约绿:`signal-epistemic` / `personalization` /
  `guidance-ranker` / `living-model-robust` / `growth-*` / `retrieval-feedback` / `write-gate`。
  **仍欠**:capture 确认升格;真删 ranker/bandit 文件(现为开关退役+一次性清 LS,便于回滚)。
  InsightsSheet living-model 死代码已物理删(2026-07-27);feedback today/card 不再双写瘦 reaction。
- **成长引擎升级(2026-07-27)**:融合 ljg-read 伴读三岔 / dbskill 行动卡点 / 张丽心智方程
  (`心智经营=(触达+内容+触动)×人机协同`)。新镜头 `action-stall` · `collision-read` · `biz-equation`;
  协议 `lib/portal/growth-protocols.ts`(L0–L3 回看分级、假成功 AI 拒收);框架书架扩容;
  GrowthTab 显式失败+重试 · 教练主路径收口。契约 `test:growth-engine` / `test:growth-guide`。dbskill 仅借流程不抄文。
- **共享承重件焊点(2026-07-26)**:`SYSTEM-LOGIC.md` + finance-aggregator / shared-primitives /
  entity-schema / data-locality / capture-adapters。代码:`geo` · `period-ledger` · `finance-sources` ·
  `finance-aggregate`(KPI 同币种并入) · `entity-schema.resolvePlace` · `locality` · external/capture 注册表。
  旅行/相机小票已写汇口;家务零花钱隔离。契约 `test:architecture-welds`。
  **待办**:capture 真适配器迁入 CameraSheet;ExternalAdapter 与 connector 调度合并;实体 L1 确认卡。
- **~~Signal 可信度分层~~ → 已并入上方「激进审计落地」**。
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
  已接进 `guardAiRoute({ requirePaidCloudAi:true })`,六路付费云 AI 路由(meeting-notes /
  avatarify / person-extract / inventory-extract / living-model / health-insight)
  已挂。(daily-brief 2026-07-30 随语音简报一并删除。)**默认 inert**(真源未接 → fail-open 放行,线上行为不变)。**接真源(部署侧)**:
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
