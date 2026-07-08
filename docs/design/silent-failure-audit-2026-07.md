# 静默失败与错误可观测性审计(2026-07)

> 多 agent 扇出(6 维 finder)+ 3 票对抗验证。**Find 报 67 → 去重 55 → 高/中 43 → 验证。**
> 分析产物,给各代码 owner 修。验证阶段部分 agent 因月度额度中断未跑完 → 见 B 组「待复核」。
> 关联:`algorithm-review-findings.md`、`architecture-issues.md`(如已建)。

## 主题(跨全部 finding 的共性)
这 app 已有全局错误管道(`telemetry.ts` window.onerror + unhandledrejection → 遥测 → /admin clientErrors)。
但**大量失败被 catch 后吞掉、绕过这条管道**,且集中在两类高危模式:
1. **网络/解析失败 → 折叠成空数据**:失败与「无数据」不可区分,下游把故障当空继续算(甚至反向覆盖好数据)。
2. **写失败被吞 + UI 已报成功**:localStorage 配额/云上传失败被静默,但 toast/置灰已显示成功 → 用户以为存了,其实丢了(金融流水、临床记录、分享文件、备份恢复)。

## 计数
| 类别 | 数量 |
|---|---|
| ✅ 已验证(3 票对抗通过) | **17**(HIGH 7 · MED 10) |
| 🔶 待复核(额度中断未验) | 13(HIGH 5 · MED 8) |
| ⚠️ 存疑(1 票驳斥) | 2 |
| ❌ 已否决(对抗验证砍掉的假阳性) | 11 |

## 最该先修的 5 条(数据丢失 + 假成功)
1. `ConnectorsHub.tsx:388/398` — Plaid 流水:本机 blob 坏 / localStorage 满 → 覆盖或丢批,cursor 已推进 → **历史流水永久缺口 + toast「同步完成」**
2. `user-data/delete/route.ts:501` — 会话过期时真删除请求落兜底 → **返回 200 ok:true 但云端一条没删**(用户以为已删)
3. `full-backup.ts:84` — 恢复时备份条目坏 → 静默当空 → **记忆没恢复却报成功**,且覆盖本机坏串失去抢救机会
4. `analyst-runtime.ts:33` — metrics 自调失败不查 ok → **「系统故障」被日报说成「一切平稳」** + 污染学习基线
5. `integrations.ts:166` — token 回写以「读失败→空」为基底覆写 → **静默清掉另一 provider 的 refresh token**,跨设备断连

---
### [HIGH·验证] `components/portal/ConnectorsHub.tsx:388` — silent-amnesia-destructive-overwrite
- **缺陷**：syncPlaid 增量合并的基底 existing 在 JSON.parse 失败时静默置 [](catch { /* ignore */ }),随后 line 398 用「仅本次增量」整体覆盖 nesio-bank-tx-v1,并 toast「同步完成」
- **失败场景**：本机银行流水 blob 损坏 → existing=[];Plaid 增量同步只返回 cursor 之后的几笔 → merged 只剩这几笔并覆盖存储;明细按设计「只存本机」(bank-tx.ts:4),历史流水永久丢失,用户却看到「流水同步完成:新增 N 笔」的成功提示,月度汇总/环比/定期账单全部塌掉
- **修法**：existing 解析失败时不做覆盖式写回:先备份原串 + 上报遥测,或强制走全量重拉(重置 cursor)再写

### [HIGH·验证] `lib/portal/full-backup.ts:84` — silent-amnesia
- **缺陷**：restore merge 模式里 mergeLifeGraphs 对 current 或 incoming 的 JSON.parse 失败静默当 [](catch { return []; }),仍写回并 restoredKeys++,恢复结果报成功
- **失败场景**：备份文件里 nesio-life-graph-v1 条目损坏(半截拷贝/编码问题)→ incoming=[] → 合并结果=仅本机节点,用户以为「换机恢复成功」(RestoreResult 无任何失败信号)其实备份里的记忆一条没进来;对称地,本机 blob 损坏时 current=[],merge 直接用合并结果覆盖原始损坏串,损坏数据失去最后的抢救机会
- **修法**：parse 失败时把该 key 记入 skippedKeys(或新增 corruptKeys)返回给 UI,且不覆盖本机损坏原串

### [HIGH·验证] `lib/portal/analyst-runtime.ts:33` — net-failure-as-empty
- **缺陷**：computeDailyReport 对 /api/admin/metrics 与 /api/admin/governance 的自调既不查 res.ok 又 catch(()=>({})),拉取失败被折叠成空指标,日报把「系统故障」说成「一切平稳,无预警」
- **失败场景**：NESIO_ADMIN_SECRET 未配/配错 → metrics 路由返回 401 JSON 或 fetch 超时 → r.json() 解析出错误体或 catch 得 {} → extractSignals 得全 null,且 errTotal/drifted/dead 是 0 而非 null(analyst.mjs:48-52)→ buildDailyReport 零 alerts → headline『一切平稳,无预警』(analyst.mjs:189)照发邮件;同时 run/route.ts:37 saveDaily 把这天 errTotal=0 的假快照 upsert 进 analyst_daily,永久污染 client_errors 学习基线(seriesFrom 不滤 0)。客户端报错正在飙升,管理员每天收到『平稳』日报
- **修法**：两个 fetch 检查 r.ok 并区分「失败」与「空」:失败时 metrics 传 null、报告降级为『数据源不可用』状态且跳过 saveDaily

### [HIGH·验证] `lib/portal/integrations.ts:166` — silent-data-clobber
- **缺陷**：saveIntegrationToken 的 read-modify-write 以 readIntegrations 的『失败→{}』为基底整体覆写 integrations 字段,读失败瞬间会静默清掉另一个 provider 的 refresh token
- **失败场景**：gmail 与 calendar 都已连接;calendar/route.ts:266 或 gmail/route.ts:291 的例行 token 刷新回写触发 saveIntegrationToken → readIntegrations 恰逢 Supabase 超时/5xx 返回 {}(:65,:69 把失败与空混同)→ existing 只剩本次 provider → writeIntegrations 覆写整个 JSON → 另一 provider 的 accessToken/refreshToken 从云端消失,跨设备 Gmail 悄悄断连,用户需重新走 OAuth 才能恢复
- **修法**：readIntegrations 失败时返回哨兵(null)而非 {},saveIntegrationToken 读失败则放弃本次回写(或用 jsonb 局部 patch 只更新单 provider 键)

### [HIGH·验证] `lib/portal/connectors.ts:60` — cache-clobber
- **缺陷**：refreshCalendar 防覆写守卫 `!data?.events?.length && !data?.feeds` 因空数组恒为真值而失效:calendar 路由的失败态(HTTP 200 + events:[])会覆盖缓存里的好日历数据并广播空事件
- **失败场景**：OAuth access+refresh 都过期 → calendar/route.ts OAuth 路径抛错、无 iCal feed → 返回 200 {ok:false, events:[], feeds:[]}(route.ts:300-307,ok:false 但 HTTP 200);feeds 是空数组 → !data.feeds 为 false → 守卫不生效 → writePortalCache 用空 events 覆盖上次成功快照并派发 nesio-calendar-updated → useTodayData.ts:139 读缓存得 [] → Today 聚焦区明早航班卡消失,attention-engine 无事件可置顶,用户以为『今天没安排』
- **修法**：守卫改为 `if (data.ok !== true || !data.events?.length) return`(至少校验 data.ok),失败时保留旧缓存

### [HIGH·验证] `components/portal/ConnectorsHub.tsx:398` — correctness
- **缺陷**：merged 流水写入 localStorage 吞 quota 失败,但服务端已在同一响应里推进 nesio_plaid_cursors cookie → 本批交易永不落盘也永不重发
- **失败场景**：localStorage 接近满(与记忆库共享 5MB)→ setItem 抛 QuotaExceeded 被吞 → 浏览器已应用响应里的新 cursor cookie → 下次同步从新 cursor 续拉,这一批交易形成永久缺口;toast 仍显示「同步完成:新增 N 笔」,月度支出汇总从此系统性偏低且无从发现
- **修法**：写失败时报错 toast+遥测,并调用接口回滚/清除 cursor(或改成客户端 ack 成功后服务端才推进 cursor)

### [HIGH·验证] `lib/portal/life-graph.ts:782` — dual-write-divergence
- **缺陷**：deleteLifeNode 只把删除传导到本地 IDB 与云 Memory 表,云 Signal 镜像永远收不到删除(/api/cloud/signals 路由根本没有 DELETE handler),而 Today 读路径已经在消费云 signals。
- **失败场景**：已登录用户左滑删除一条记忆(MemoryTab.tsx:559)或「删除全部」(SettingsSheets.tsx:330):本地 localStorage、本地 IDB(signal-read-cache.ts:57)、云 memory 表都删了,但云 signals 表的对应行永久保留(signal-store-idb.ts 注释明说「云镜像不受影响」)。useTodayData.ts:62 拉 /api/cloud/signals?limit=80,today-view-model.ts:242-266 用它生成 memoryNotes 和推荐卡 → 被删除的内容(标题、payload、rawInput 全文)继续出现在今日页,且用户没有任何途径把它从云端删掉——「可以随时删除」的隐私承诺在双写的另一半上是断的。
- **修法**：给 /api/cloud/signals 加 DELETE(按 identity_key+signal_id 置 deleted_at),deleteLifeNode/prune 在广播 nesio-life-node-deleted 的同时走 outbox 发云端 signal 删除。

### [MED·验证] `lib/portal/bank-tx.ts:516` — inconsistent-aggregation
- **缺陷**：financeAlerts 的「购物超均值」预警用 t.amount > 0 裸判并跨币种直接求和,绕过同文件其它聚合(summarizeMonth:157)的主币种过滤和 txFlow 用户纠正规则
- **失败场景**：账户里同月有 $ 和 ¥ 的购物交易($200 + ¥1400 被加成 1600),或用户已把某商户手动改为 transfer(flow rule)但 amount>0 仍被计入 → 弹出「购物支出高于往月 85%」这类基于任何币种下都不存在的数字的 warn 预警,与 KPI 卡的数字对不上,用户无从排查
- **修法**：monthShopping/avg 改用与 sumByCategory 相同口径:monthCurrency(txs, ym) 过滤 + txFlow(t, flowRules) === 'expense'

### [MED·验证] `lib/life-domain/create-signal.ts:173` — dual-write-fork
- **缺陷**：createSignal 的云镜像 `void writeCloudSignal(signal)` 丢弃返回值、无 outbox 无重试(对比 memory 节点管道 life-graph.ts:386-404 有 outbox+状态标记),失败的 Signal 永久缺席云端事实表;life-graph.ts:173-180 同型且连 response.ok 都不看
- **失败场景**：用户离线/云端 5xx 时记录一条事实 → 本地 LifeGraph+IDB 有、云 signals 表永远没有 → /api/cloud/signals 的向量/文本检索与 useTodayData 跨设备信号静默缺行,双写分叉无任何标记;只有用户恰好打开 MemoryTab 触发 backfill(限最近 200 节点)才部分自愈
- **修法**：复用 memory 管道的 outbox 模式:writeCloudSignal 失败(含 !res.ok)入队,online/定时重放

### [MED·验证] `app/api/cloud/signals/route.ts:229` — silent-degradation
- **缺陷**：写入 Signal 时 embedding 调用失败即以 embedding_vector=null 落库(cloud-signals-server.ts:60 同),全仓库无 embedding backfill,这些行永远不会命中向量检索
- **失败场景**：embedding 服务限流/网络抖动的时段内写入的所有 signal 均无向量 → match_own_signals RPC 永远检索不到它们 → 用户语义搜索『上次体检报告』找不到确实存在的记录,且无任何指标记录哪些行缺向量、缺了多少
- **修法**：写入时对 embedding.ok=false 计数埋点,并加定时任务对 embedding_vector is null 的行补算

### [MED·验证] `lib/portal/analyst-store.ts:50` — net-failure-as-empty
- **缺陷**：loadHistory/loadHistoryWithDates/loadFeedback 把 Supabase 网络失败/非 200 一律折叠成 [],「库挂了」与「冷启动无数据」不可区分
- **失败场景**：Supabase 短暂故障当天:日报的学习基线整体退回冷启动固定阈值、反馈静音名单清空(被静音的噪音预警突然全部回归),报告不带任何『数据源不可用』标记;周报则显示『本周数据不足(仅 0 天)』(analyst-weekly.mjs:33),把运维故障误导成没攒够数据
- **修法**：返回 {rows, ok:false, error} 形态,buildDailyReport/buildWeeklyReport 在 keyPoints 里注明数据源故障

### [MED·验证] `lib/portal/flomo-api.ts:189` — partial-as-success
- **缺陷**：flomo 翻页同步中途网络断直接 break 用已收集的部分,且 collected>0 时 pageError 也被丢弃(:205 只在零收集时报错)——返回 ok:true 但实际是被截断的『最旧一批』
- **失败场景**：游标翻页(升序,旧→新)第 3/25 页超时 → break → 只收集到最早的 400 条 → slice(-limit) 取的『最新 48 条』其实是几个月前的旧 memo → 路由 202 行按 ok:true 返回 200,NotePanelEnhanced 展示旧 memo 当最新同步结果,用户以为 flomo 最近的笔记没写进去
- **修法**：网络断页与 pageError 时在响应中带 partial:true/error 字段,UI 提示『同步不完整』

### [MED·验证] `components/portal/today/useTodayData.ts:66` — net-failure-as-empty
- **缺陷**：loadCloudSignals 把 /api/cloud/signals 的 401/5xx/网络失败一律返回 [],下游 buildTodayViewModel 把「云端拉取失败」当「云端没信号」继续算
- **失败场景**：登录态 cookie 过期(接口 401)→ cloudSignals=[] → Today 视图只用本机 LifeGraph 生成卡片,另一台设备录入的事实(如体检预约)不出现,20 分钟轮询每次都静默失败,用户与开发者均无从察觉是会话问题
- **修法**：区分失败与空:失败返回 null 并 track('cloud_signals_fetch_failed'),UI 可在设置里露出同步状态

### [MED·验证] `lib/portal/clinical-store.ts:21` — silent-failure
- **缺陷**：saveClinical(化验/用药/诊断,敏感数据仅存本机无云备份)吞写失败,ConnectorsHub.tsx:889 已先按解析结果 toast 条数
- **失败场景**：lab 模式导入 export_cda.xml → parseCda 成功、toast「临床记录:N 项化验 · M 用药…」 → setItem quota 失败被吞 → 临床面板空;该数据被设计为不上云,本机写失败即唯一副本丢失,用户却收到了成功回执
- **修法**：saveClinical 返回写入结果,失败时用报错 toast 替换成功 toast(唯一副本的写失败必须可见)

### [MED·验证] `components/portal/MemoryTab.tsx:820` — silent-degradation
- **缺陷**：云记忆水合 hydrateCloud 整体 catch{/* best-effort */},失败无重试、无状态提示、无遥测
- **失败场景**：用户在新设备登录打开 Memory → fetchCloudMemorySnapshot 因瞬时 5xx/网络失败 → catch 吞掉且本 mount 不再重试 → 页面只显示本地(空)记忆,用户以为云端数据丢了;同时 retryLifeGraphCloudSync/backfill 也被跳过,双向同步停摆
- **修法**：失败置可见状态条(「云同步暂不可用,点此重试」)+遥测计数,并在可见性恢复时自动重试

### [MED·验证] `app/admin/AnalystCard.tsx:54` — silent-degradation
- **缺陷**：预警反馈投票乐观置灰后,POST /api/admin/analyst/feedback 返回的 { ok:true, saved:false }(route.ts:28,未配 Supabase 或 REST insert 失败时)被完全忽略,按钮永久 disabled,反馈实际没存。
- **失败场景**：管理员对资金/健康预警点「有用/误报」:setVoted 先置灰按钮,fetch 的 json 从不读取。analyst-store.saveFeedback 返回 false(Supabase 未配 / analyst_feedback 表写失败)→ 接口 200 + saved:false → UI 呈现「已投票」,反馈学习(loadFeedback 驱动的降权)永远收不到这条输入,预警质量不收敛且无从排查——这正是路由头注里自认的「不报错,只是学不了」被 UI 放大成假成功。
- **修法**：vote() 读取 json.saved,false 时回滚 voted 状态并提示「反馈未保存(云端未配置)」。

### [MED·验证] `components/portal/ConnectorsHub.tsx:910` — false-success
- **缺陷**：Apple 健康导入:saveHealthMetrics(health-store.ts:14)把 localStorage 配额失败静默吞掉,但调用方照样置 connected、写 counts、弹「已接入健康数据:N 项指标」成功 toast。
- **失败场景**：健康导出文件大、且 localStorage 已被 life-graph+outbox 占满时:流式解析成功 → setItem(HEALTH_KEY) 抛 QuotaExceeded 被 catch 吞掉 → toast 报「已接入健康数据:N 项指标」、连接器标记为已连接。用户去「洞察→健康」看板是空的,刷新后 counts 也归零,没有任何错误可循——不是良性 best-effort,因为成功文案基于解析结果而非持久化结果。
- **修法**：saveHealthMetrics 返回 boolean,失败时 toast 改报「存储空间不足,导入未保存」并 track 计数。

### [HIGH·待复核] `app/api/portal/plaid/transactions/route.ts:79` — silent-failure
- **缺陷**：Plaid 返回除 ITEM_LOGIN_REQUIRED 外的任何 error_code(INVALID_ACCESS_TOKEN/RATE_LIMIT/ITEM_ERROR 等)时静默 break,路由仍回 ok:true,无 console.error、无 relink 标记、无遥测
- **失败场景**：某家银行 token 失效返回 INVALID_ACCESS_TOKEN → 该 token 分页循环第一页即 break,transactions 为空但响应 ok:true → 客户端照常写入 BANK_SYNCED_AT_KEY,财务卡显示『数据截至今天』,而这家银行的交易/余额从此静默停更;Vercel 日志和 admin 面板均零信号,用户以为资金数据是新的
- **修法**：非 relink 的 error_code 走 console.error('[plaid]', error_code) + reportAiCall 式计数,并在响应里按 token 回 errors[] 让客户端提示,而不是裸 ok:true

### [HIGH·待复核] `app/api/portal/notion/route.ts:136` — silent-failure
- **缺陷**：Notion 数据库导入中 queryDatabaseRows/fetchDbTitle 对非 2xx(含 401 token 失效)和网络异常一律吞成空数组/占位名,路由回 ok:true『从 N 个表导入 X 行』
- **失败场景**：用户 Notion 授权被撤销后点『导入』→ 每个 db query 返回 401 → catch/!res.ok 都退化为 [](:130,136)→ 响应 ok:true + summary『从 2 个表导入 0 行』(:168) → 用户以为表是空的或导入成功,实际是授权失败;3 个表里 1 个失败时更隐蔽,只是行数变少,无任何错误码或日志
- **修法**：queryDatabaseRows 把 !res.ok/异常上抛或返回 {rows, error},路由聚合 failedDbs 回给前端并 console.error 一行 [notion] status

### [HIGH·待复核] `components/portal/ConnectorsHub.tsx:918` — fake-success
- **缺陷**：Notion「断开」只清 localStorage,不撤销 OAuth:nesio_notion_access HTTP-only cookie 原样保留,且仓库里根本没有 notion/disconnect 端点
- **失败场景**：用户在接入中心点 Notion「断开」→ 按钮翻回「接入」,以为已撤权;实际 cookie token 仍在,重开面板时 useEffect(ConnectorsHub.tsx:130-133)调 /api/portal/notion/status(status/route.ts:13 只看 cookie)又把状态翻回「已连接」,同步继续能拉 Notion 页面。用户以为断了,数据访问从未停止(隐私预期被静默违背);对比 Google 系 disconnect 有 /api/portal/oauth/disconnect 真撤销
- **修法**：新增 /api/portal/notion/disconnect 清 nesio_notion_access/refresh cookie(可选调 Notion revoke),disconnect('notion') 时调用并等结果再翻 UI

### [HIGH·待复核] `app/api/user-data/delete/route.ts:501` — fake-success
- **缺陷**：云已配置但会话过期/未登录时,真删除请求(dryRun=0+confirmation)落到兜底分支,返回 200 + ok:true 的 mock 信封(dryRun 被硬编码回 true),云端数据一行未删
- **失败场景**：用户发起「删除我的云端数据」时 baohe_auth 刷新 token 恰好过期 → buildCloudUserDataDeleteResponse 返回 null(delete/route.ts:280-289)→ 兜底 return ok:true/mock-local-delete/HTTP 200;只检查 ok 的调用方(app-api-client.deleteUserData 的消费者)报告删除成功,Supabase 里 7 张表+存储对象全部保留。合规级『以为删了其实没删』,且对调用方与过期会话的区分完全静默
- **修法**：云已配置(getCloudConfig().configured)且请求为真删除时,not_signed_in 应返回 401 ok:false auth_required,而不是落进 mock 兜底

### [HIGH·待复核] `components/portal/ShareSheet.tsx:240` — silent-data-loss
- **缺陷**：分享入库的图片/文件只走云上传:未登录或 uploadCloudAsset 失败(catch 吞掉、upload.ok=false 也不处理)时原件被整个丢弃,没有 CameraSheet 那样的 putLocalImage 本地兜底,UI 仍显示「已存入」
- **失败场景**：未登录用户(本 local-first app 的常态)通过分享面板存一张照片 → AI 提取的文字节点入库,saveToMemory 里 uploadCloudAsset 返回 401/upload.ok=false → cloudAssets 为空、节点无 assets,line 253 setSaved(true) 显示已存入;用户日后打开这条记忆想看图,图片不存在——原件已随 sheet 关闭永久丢失(CameraSheet.tsx:521-527 有本地 IDB 兜底,这里没有)
- **修法**：与 CameraSheet 对齐:上传失败或未登录时 compressToDataUrl+putLocalImage 存本地并挂 local asset 到节点

### [MED·待复核] `app/global-error.tsx:8` — observability
- **缺陷**：根布局崩溃的 GlobalError 边界只渲染恢复 UI,完全不上报遥测(对比 app/error.tsx:19 会 track('client_error',{kind:'boundary'}))——最严重的一类崩溃恰好是唯一不进管道的
- **失败场景**：app/layout.tsx 或 AuthHashImportBridge 渲染抛错 → React 边界捕获(不触发 window.onerror)→ 用户看到『应用出了点问题』整屏 → admin clientErrors 永远为零;若某次发版让根布局对某类设备必崩,你只能靠用户口头反馈发现
- **修法**：GlobalError 里 useEffect 直接 fetch('/api/telemetry',{keepalive:true}) 上报 kind:'global_boundary'+digest(不依赖 track 的 buffer,立即发)

### [MED·待复核] `components/portal/Portal.tsx:456` — observability
- **缺陷**：installErrorTracking 只在 Portal 组件 useEffect 里安装:/share、/settings、/login、/admin 四棵页面树从不安装;/secretary 是 tools/secretary 静态 JS app(经 route.ts 直出),连 React 边界都没有;且 Portal 是 ssr:false 动态加载,首屏 chunk 加载失败(ChunkLoadError)发生在钩子安装之前
- **失败场景**：用户从系统分享菜单进 /share,SharePageClient 的保存 handler 抛异常 → 无 window.onerror 钩子(handler 异常不走 React 边界)→ 分享静默失败且管道零记录;或 tools/secretary/chat.js 任何未捕获错误 → 秘书页面白屏,admin 看不到
- **修法**：把 installErrorTracking 挪进 app/layout.tsx 的一个极小 'use client' 组件(或 THEME_BOOT 式内联脚本),tools/secretary/common.js 加同款 window.onerror → sendBeacon('/api/telemetry')

### [MED·待复核] `app/api/telemetry/route.ts:47` — observability
- **缺陷**：writeToSupabase 不检查 res.ok(fetch 对 4xx/5xx 不抛),ai-telemetry.ts:23 persistAiEvent 同病:Supabase 拒写(RLS/约束/429/密钥错)时行静默消失,路由仍回 accepted:n,且 catch 也不 console.error
- **失败场景**：telemetry_events 表加了约束或 service key 换了权限 → 每次插入 401/403 静默丢 → console.log 的 [telemetry] 行还在(看起来管道正常),但 admin 面板数据逐渐失真;间歇性 429 丢行时连『数据静默 24h』死人开关(metrics:252)都不会触发,无从察觉
- **修法**：两处都改为 const res = await fetch(...); if (!res.ok) console.error('[telemetry] supabase_write_failed', res.status)——日志即最小可观测

### [MED·待复核] `lib/portal/telemetry.ts:52` — observability
- **缺陷**：客户端 flush 先清空 buffer 再 send,fetch 失败(.catch(()=>undefined))或 sendBeacon 返回 false(:44,返回值被忽略)时整批永久丢弃——无重试、无 localStorage 离线队列;/api/telemetry 限流 429 同样导致丢批
- **失败场景**：local-first app 离线使用是常态:地铁上触发 client_error → flush 时 fetch 失败 → 批次丢弃 → 恢复联网后也不补发;或错误风暴触发 60/min 限流 → 429 → 恰恰在事故发生时管道主动丢数据。离线会话里的崩溃对 admin 永远不存在
- **修法**：send 失败时把批次写回 localStorage 队列(封顶如 50 条),下次 track/页面加载时先重放;sendBeacon 返回 false 时退回 fetch

### [MED·待复核] `app/api/portal/insights/route.ts:82` — observability
- **缺陷**：insights 路由 AI 失败 catch { /* fall through */ } 后回 ok:true + 模板 fallbackNarrative,既无 console.error 也无 reportAiCall——同类 AI 路由中 proactive/health-insight/decompose 有 console.error 但也没接 reportAiCall,admin 的『AI 成功率』只统计 chat/daily_brief 两条路由
- **失败场景**：Gemini key 配额耗尽一周 → 洞察卡每天都是模板句,用户体验降级但无感知差异 → Vercel 日志零记录、admin ai_route 成功率仍显示 100%(它根本看不到这条路由),没有任何排查入口;portal/chat 的 quota 分支(chat/route.ts:253)也绕过 reportAiCall,失败率恰好漏掉最常见的失败原因
- **修法**：所有带 AI fallback 的路由统一在 catch 里调 reportAiCall(route,false,startedAt,{error:code}),insights 至少补 console.error

### [MED·待复核] `components/portal/NotePanelEnhanced.tsx:333` — silent-data-loss
- **缺陷**：flomo 笔记的图片逐张上传,失败的直接被跳过(只 push 成功的 url),笔记照发且状态显示「已发送」,缺图零提示
- **失败场景**：用户写笔记附 5 张图,其中 3 张上传 /api/portal/flomo/upload 返回 500 → uploadImages 静默返回 2 个 url → 笔记带 2 个图片链接发出,UI 弹「已发送」;用户以为 5 张图都进了 flomo,3 张图随 preview 释放永久丢失(全部失败但有文字时同样纯文字发出并报成功)
- **修法**：统计失败张数,>0 时把状态/文案改为部分失败(如「已发送,N 张图片上传失败」)并保留未发图片

### [MED·待复核] `app/api/user-data/export/route.ts:331` — fake-success
- **缺陷**：云已配置但会话过期/未登录时,导出请求兜底返回 200 + ok:true 的 fixture 数据(demo 库存/mock profile),而非报错
- **失败场景**：用户会话过期后请求导出云端数据 → buildCloudUserDataExportResponse 返回 null → 200 ok:true + LOCAL_PROFILE_FIXTURE/DEMO_INVENTORY_ITEMS;只看 ok 的调用方把 fixture 当真实备份保存,用户以为手里有全量备份,实际一条真实数据都没有(includesRealUserData:false 标志存在但 ok:true+200 是主信号,过期会话与匿名不可区分)
- **修法**：cloud configured 且未认证时返回 401 ok:false auth_required,mock 信封仅留给未配置云的本地部署

### [MED·待复核] `components/portal/ConnectorsHub.tsx:230` — misattributed-error
- **缺陷**：批量照片导入把所有失败(HTTP 500、AI 未配置、网络异常)统一 catch{failed++} 后在 toast 里报成「N 张没识别出内容」,且全失败也把连接器标记为已连接
- **失败场景**：/api/portal/analyze 因 AI key 未配置持续 500 → 用户导入 10 张照片得到「批量导入完成:10 张照片,入库 0 条,10 张没识别出内容」→ 用户归因于照片质量放弃功能;实际是服务端配置问题,但错误已被吞、遥测无记录,无法排查;line 234 还把 photos 标为 connected
- **修法**：区分 res.ok/data.error 与真正的空识别,失败文案带原因(如 AI 未配置/网络),全失败不置 connected

### [MED·存疑] `lib/portal/life-graph.ts:379` — fire-and-forget-write
- **缺陷**：未登录用户每写一条记忆都无条件入云同步 outbox(完整节点副本存 localStorage)且 401 被判 transient 永不出队,outbox 无上限增长;同时 syncLifeNodeSignalToCloud(:171)没有 cloudMirrorAuthBlocked 守卫,匿名 401 降噪修复只覆盖了 writeCloudSignal 一半。
- **失败场景**：从不登录的 local-first 用户:每条记忆在 nesio-life-graph-v1 和 nesio-life-graph-cloud-sync-outbox-v1 各存一份全量副本(queueCloudSyncOutboxItem:213-233 无 cap、无登录门槛,cloudMemorySyncEnabled 只查 window+fetch),localStorage 消耗直接翻倍,提前撞上 saveAll 的配额悬崖(:498-504,新记忆被丢)。每次写还照发注定 401 的 memory POST + signal POST 各一次(后者无任何会话级熔断),控制台/网络面板持续报错噪音。
- **修法**：未登录时不入 outbox 不发请求(有会话再补 backfill),outbox 加条数上限;给 syncLifeNodeSignalToCloud 复用 cloudMirrorAuthBlocked。

### [MED·存疑] `lib/life-domain/signal-read-cache.ts:57` — fire-and-forget-write
- **缺陷**：Cutover 后号称权威源的 IDB 事实库,所有写/删失败一律 resolve(false|0) 后被 void/.catch(()=>{}) 吞掉(appendSignalIdb create-signal.ts:171、bulkPut :48、deleteSignalIdb :57),零计数零遥测。
- **失败场景**：两个方向都能坏且都不可见:(a) deleteSignalIdb 事务失败 → 用户已删除的记忆的 Signal 留在 IDB,下次 hydrate 时按「事实库独立、投影没有的 id 保留」规则(:20-21)回灌 byId,被删内容在所有 getSignals() 消费面复活——删除权红线被静默突破;(b) IDB 写持续失败(配额/损坏)而用户在数据主权面板触发 rebuildLifeGraphFromSignals(:89-98),hydrate 曾失败时直接从残缺 IDB 全量重建投影,缺失的记忆被无声抹掉。绕过了 telemetry 管道,/admin clientErrors 里什么都看不到。
- **修法**：appendSignalIdb/deleteSignalIdb 返回 false 时 track('signal_idb_write_failed', {op}) 计数;rebuild 前比对 IDB 条数 < 投影条数则拒绝执行并提示。


---

## D. 已否决(对抗验证砍掉,**不要再报**)—— 11
这些 finder 报了但 3 票中 ≥2 驳回(多因有上游守卫/其实会 throw 进管道):
- `lib/portal/life-graph.ts:486` — 核心记忆库 loadAll() JSON.parse 失败静默返回 [],而所有写路径(addLifeNode:734/updateLifeNode:751/m…（3驳）
- `lib/portal/integrations.ts:69` — readIntegrations 网络失败/非 200/解析失败一律静默返回 {},saveIntegrationToken(166-168) 以它为基底整体回…（3驳）
- `lib/portal/mirror-profile.ts:50` — getMirrorProfile 解析失败静默回 defaultMirror()(feedbackCount=0),下一次 learnFromFeedback …（2驳）
- `lib/portal/bank-tx.ts:30` — loadBankTx 解析失败静默返回 [],且 line 29 的 filter 把 amount 非有限数/date 非字符串的行静默剔除,均无计数遥测…（3驳）
- `lib/portal/notes.ts:49` — saveStoredNotes 无条件 slice(0, 200):新增第 201 条笔记时最旧一条被静默删除,无提示无计数…（3驳）
- `lib/portal/connectors.ts:73` — refreshCalendar 用 new Date(e.start).getTime() > now-1h 过滤,start 缺失/坏串产 NaN → 比较为…（3驳）
- `lib/portal/integrations.ts:75` — writeIntegrations 不查 res.ok 且 catch 全静默,而仓库内 user_profiles schema(database/schem…（3驳）
- `lib/life-domain/signal-feedback.ts:82` — 云端反馈回写(POST 反馈 Signal :60 与 PATCH preferencePatch :66-84)双双 fire-and-forget,不查 r…（3驳）
- `lib/portal/health-store.ts:14` — saveHealthMetrics 吞 localStorage 写失败,ConnectorsHub.tsx:910 仍 toast「已接入健康数据:N 项指标…（2驳）
- `lib/portal/connectors.ts:89` — refreshCalendar 整函数级 catch{/* offline */} 把 res.json 解析错、normalizeCalendarToSign…（3驳）
- `lib/portal/life-graph.ts:743` — 每次 createSignal/ingestLifeNode 有两个互不知情的 fire-and-forget 写者并发 POST 同一条云 signal 行(…（3驳）

## E. 建议:最小「可见失败」模式
针对「写失败被吞 + UI 报成功」这类,统一一个轻量 reporter,挂在**唯一副本写路径**和**同步成功回执前**:
```ts
// lib/portal/report-error.ts
export function reportError(kind: string, detail: string) {
  try { track('client_error', { kind, message: detail.slice(0,200) }); } catch {}
  if (process.env.NODE_ENV !== 'production') console.error('[nesio]', kind, detail);
}
```
落点(按本次 finding):
- **写唯一副本**(clinical-store / health-store / bank-tx localStorage / full-backup):setItem 失败 → reportError + 用报错 toast 替换成功 toast。
- **同步成功回执前**(Plaid/flomo/notion/calendar):区分「失败」与「空」;失败不推进 cursor、不覆盖缓存、响应带 partial/error。
- **服务端写**(telemetry / ai-telemetry / cloud writes):检查 `res.ok`,拒写要 console.error(进 Vercel 日志)。
- **错误边界覆盖**:`global-error.tsx` 补 track;`installErrorTracking` 从 Portal 挪到根布局,覆盖 /share /settings /login /admin /secretary。
