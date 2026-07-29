# 财务板块大修审计 · 对标 maybe-finance（2026-07-28）

> 背景：用户判定「现在管理、分析逻辑、UI 都很多问题」。四路并行深查：
> ① maybe 数据管理架构 ② maybe 分析逻辑 ③ maybe UI 模式 ④ 宝盒财务板块诚实体检。
> maybe = maybe-finance/maybe（AGPL-3.0，已停维护）——**只借形不借码**，数据模型与机制不受版权保护，代码一行不抄。
> 本文是施工蓝图的依据；分期见文末。

---

## 一、宝盒财务板块问题清单（体检结论，按严重度）

### P0 级（数据安全 / 口径矛盾，先止血）

1. **存在一条永久删流水的路径**：`runPlaidSync`（lib/portal/providers/connector-sync.ts:35-57）顺序为
   「先 `saveBankAccounts(..., {replace})` → 再 `loadBankTx()`（内含按账户表过滤孤儿）→ 写回」。
   IDB 未水合（全仓无一处 `await store.ready()`）或一次坏快照 → 全部流水被覆盖成空，
   且服务端游标已推进无法重拉。无备份、无撤销。`removeBankAccount` 同理静默物理删交易。
2. **当月未做 month-to-date 归一化**：环比 / 基线 z-score / 预算比率 / 月报全部拿「残月」比
   「完整月」（FinanceTab.tsx:213 · finance-insight.ts:54,76 · finance-budget.ts:104 ·
   finance-report.ts:62）。每月前 20 天整个 L1/L2 统计层系统性失真。
3. **同屏两套数据集**：`financeMonthAggregate`（finance-aggregate.ts:26）自读 `loadBankTx()` 不含
   Tesla；FinanceTab 的 `cats/trend/findings` 用含 Tesla 的 state → 总览「本月支出」与「净支出」
   互相矛盾。`domain-insights.ts:75` 又是第三套入参（不传 ym、不含 Tesla）。
4. **`summarizeMonth` 全程 `Math.abs` 的符号 bug**（bank-tx.ts:274-276）：正数 INCOME 被计进收入；
   手动标 refund 的流出被倒扣两次。用户一用「改类型」就把自己的数算错。
5. **冷启动假空态 + 同步失败零感知**（FinanceTab.tsx:188-209）：IDB 异步水合前必现
   「还没有银行流水」闪屏；relink_required / network 错误只在 ConnectorsHub 显示，财务页
   继续静默展示三个月前的数据。

### P1 级（架构缺失）

6. **净值口径不完整且无历史**：`assetSummary`（bank-tx.ts:491-507）只认 Plaid 四类；无手动资产
   （房/车/加密/借出）、无估值锚点、无余额历史序列 → **净资产不完整且永远画不出趋势曲线**。
   `FinanceTab.tsx:821` 漏传 currency 还静默吞掉全部非 USD 账户。
7. **多币种七处裸加**：finance-budget.ts:87 · finance-features.ts:32,147,207,285 ·
   finance-risk.ts:110 · bank-tx.ts:1007；阈值全是美元硬编码（MIN_BASE=50 等）。
8. **转账对敲缺配对逻辑**：只有名字正则的「调整对折叠」（bank-tx.ts:219）；规则粒度只有商户级
   （无单笔覆盖、无否决记忆）。

### P2 级（分析质量）

9. **基线统计的洞**：`availableMonths` 断档月被当连续月；首月残月拉低 median；MAD=0 静默退回
   粗环比；`detectIncome` 测不到季度/年终收入 → 储蓄率/订阅负担/余额投影三指标连带偏。
   工资被 Plaid 打成 TRANSFER_IN 时储蓄率 finding 永不触发且无解释。
10. **findings 不可操作**：无 action、无关联交易 id、不可点击（finance-insight.ts:36-42）；
    id 用商户名（:146,208）→ Today 去重失效。**L2 判定层价值卡在最后一米。**
11. **缺业界标配检测**：重复扣款/双刷、单笔大额异常、僵尸订阅、免费试用转付费预警、
    资产配置漂移、债务偿还规划、现金流日历（数据已有只输出三个标量）。
12. **guidelines 缺口**：finance-score-credit-utilization 等 4 个主题无语料条目（文档承诺了
    FICO 30%）；`/liabilities`（APR/利息）未接。

### P3 级（UI）

13. **FinanceTab.tsx 939 行 God Component**：7 个 Sub 只渲染 4 个（3 个死枚举）；总览一屏 13 个
    语义区块；预算编辑模块错位在「下载月报」之下；交易页无分页把定期账单顶出视野。
14. **图表两套口径 + 主动误导**：屏幕环形图丢弃第 9 类以后（月报版却正确做了「其他」）；
    趋势图断档月画成连续相邻；小值抬高破坏比例；进度条超支封顶（超 10% 和超 300% 一样长）；
    全部是死图（无点击下钻）。
15. **纠错闭环三处同坏**：规则审核一次只出 1 笔；「排除」按钮实为归类 OTHER（文案骗人）；
    「已学规则」显示原始 `mch_xxxxx` id（label 映射已加载但从未使用，FinanceTab.tsx:155,665）。
16. 次级：saveHoldings 空数组早退 → 断开券商后幽灵持仓永存（bank-tx.ts:437）；交易列表无虚拟化
    且每行同步读 localStorage；繁体「約」混入（finance-risk.ts:80）；「重复副本可移除」文案不告知
    交易会被永久删。

---

## 二、maybe 可借鉴机制（按宝盒问题映射）

### 数据管理（治 #1 #6 #7 #8）

| maybe 机制 | 要点 | 治宝盒哪个问题 |
|---|---|---|
| **三层正交分类学** | `classification`(asset/liability，决定符号) × `balance_type`(cash/non_cash/investment，决定算法) × `subtype`(纯展示) 三维互不混淆；一套计算器覆盖九种账户 | #6 手动资产的数据模型底座 |
| **锚点体系（事件溯源）** | 无「当前余额」真值字段；余额 = 锚点+流水重算。`opening_anchor` / `current_anchor` / `reconciliation` 三种角色共用一张 Valuation 表 | #6 手动估值 = Valuation 事实，与 Signal 主事实表范式同构 |
| **双向计算器** | 手动账户信起点（forward）、联接账户信终点（reverse，Plaid 今日余额为真值倒推）——**数据可信方向决定计算方向** | #6 净值历史序列的重建算法 |
| **稠密余额物化 + 读侧 LOCF** | 写入时逐日补齐序列（upsert + 清理窗口外旧行），读侧 LOCF 取「≤该日最近一条」 | #6 净值曲线；宝盒可简化为**月末快照粒度** |
| **rejected_transfers 负样本表** | 「否决」是配对关系的属性而非交易的属性；唯一索引天然幂等，否决后永不再推荐 | #8 转账对敲 + 规则审核的否决记忆 |
| **字段级来源锁（locked_attributes）** | Plaid/规则/AI/用户四路写同一字段：用户改过即锁，自动化写入跳过已锁 + 审计表留痕。「用户编辑永远最高优先级」 | #8/#15 分类纠错的正确模型（宝盒商户级规则会覆盖用户单笔更正） |
| **sync 空结果保险丝思想** | （宝盒自己 cloud-backup 已有 entryCount===0 保险丝先例） | #1 流水写回前置「疑似清空」闸 |
| **原始载荷留痕 + fetch/process 分离** | Plaid 响应原样存 JSONB，解析 bug 可离线重放修复 | #1 的长期保险：坏解析不再等于坏数据 |

### 分析逻辑（治 #2 #9 #10 #11）

| maybe 机制 | 要点 | 治宝盒哪个问题 |
|---|---|---|
| **先按月分桶再取中位数** | CTE 月分桶 SUM → PERCENTILE_CONT(0.5)；对年费/一次性大额免疫；median 与 avg 双口径并示 | #9 基线质量；预算 autofill（宝盒 suggestBudget 已同思路，补月度分桶+完整月过滤） |
| **全局统一分析口径** | `kind NOT IN (funds_movement, one_time, cc_payment) AND excluded=false` 三处 SQL 逐字一致；loan_payment 算支出、cc_payment 排除（防双计）的语义写进枚举注释 | #3 #4 一处定义口径，全端引用 |
| **favorable_direction 真值表** | direction(up/down/flat) 与「好坏」解耦；颜色 = 两者真值表；previous=0 → ∞ 显示「＋∞」不崩 | 环比文案/配色的通用模型（负债降=绿） |
| **Period 常量表** | 9 个预设区间各自带 label_short + **comparison_label**（"vs. last month"文案建模进去）| #2 的配套：残月对比必须换文案「同进度对比」 |
| **AI 工具面 enum 注入** | 真实账户名/分类名注入 JSON Schema enum + strict → 模型物理上无法编造实体；置信度阈值写进 prompt（60%/80%），"favor null over false positive" | 问一问财务工具面 + 自动分类的防幻觉 |
| **服务端算好 insights 再喂 LLM** | savings_rate/debt_to_asset 都算完格式化成串再给模型；单轮工具调用防递归烧钱 | 与宝盒「确定性判定 + LLM 只叙事」公理完全同路，可对表补齐 |

### UI（治 #5 #13 #14 #15）

| maybe 模式 | 要点 | bottom-sheet 适配 |
|---|---|---|
| **「对账小票」组件** | 起始余额→各项流水→调整→期末，虚线 leader 连接，按账户类型换措辞。「让用户信任数字」的最高性价比 UI | 纯 dl 竖排，天生适配窄屏；tooltip 改点按 |
| **筛选弹层 + 可删胶囊回显** | 多维筛选收进一个按钮，已选条件平铺成可单删胶囊（按维度换图标） | maybe 自己的移动端形态就是 50vh 上下结构 |
| **预算「不吓唬人」色彩** | 剩余=中性色（非绿）、归零=橙、真超支才红且只染超出段；文案 "$120 over" 无警告语 | 与 warm-coach 红线天然一致，直接抄语义 |
| **折线 scrubbing** | hover/触摸劈开渐变（光标右侧变灰）+ Y 轴动态基线（小波动不从 0 起） | touchmove 驱动；tooltip 改图上方固定摘要行 |
| **改分类后的「做成规则?」CTA** | 不是 undo，是「教学+自动化」toast，带 Don't show again + 服务端节流 | 直接对上宝盒规则审核闭环的重建 |
| **懒加载 sparkline + 超时兜底** | 账户行右侧迷你趋势线，lazy turbo frame + 10s 超时占位 | 账户卡片页可用 |
| 反例：Sankey 窄屏不可读 | maybe 的 Sankey 是桌面形态 | 宝盒已出稿的简化版（单色梯度+结余绿）是对的 |

---

## 三、施工分期（每期独立可验收）

**P0 · 止血（不依赖新模型，先修 bug）**
1. 流水写入安全：`await store.ready()` 前置；`runPlaidSync` 改「先读后替换」；
   写回前「疑似清空」保险丝（现存量 >0 且写入量 =0 → 拒绝并显式报错，对齐 cloud-backup 先例）；
   removeBankAccount 文案如实告知。
2. `summarizeMonth` 符号修正（去 Math.abs 一刀切，按 flow 语义分路）。
3. 数据集统一：FinanceTab / financeMonthAggregate / domain-insights 同一入参源（含 Tesla、含 ym）。
4. month-to-date 归一化：残月环比改「同进度对比」（Period.comparison_label 思想），
   基线 z-score 月初不触发改为按日累计口径。
5. 冷启动区分「加载中/未连接」；同步错误态透传到财务页。

**P1 · 数据模型升级（借 maybe 的形）**
6. 手动资产 + Valuation 锚点：`finance-sources.ts` 加 Asset 事实
   （type × classification × balance_type 三维 + 锚点数组含依据）；净值 = Plaid ∪ 手动。
   UI 稿已出（artifact fb540e24：屏 1-3）。
7. 净值月末快照序列（写入时物化 + 读侧 LOCF），净值曲线（锚点空心圈）。
8. 转账对敲：金额相反 + ±4 天窗口 + 已配对/已否决排除的候选生成；否决进负样本表。
9. 规则升级：单笔覆盖粒度 + 「用户改过即锁」字段级优先级 + 否决记忆；
   「已学规则」显示 label（修死代码）。

**P2 · 分析升级**
10. 基线统一重修：完整月过滤 + 月度分桶中位数 + 币种过滤下沉到一个共享口径函数
    （对齐 maybe 的「三处 SQL 逐字一致」纪律）。
11. findings 加 `action`（跳转 target + 关联交易 id）；id 改稳定 key。
12. 新检测：重复扣款、单笔大额异常、试用转付费预警、现金流日历（数据已备）。
13. guidelines 补 4 个主题条目；問一問财务工具面 enum 注入。

**P3 · UI 重构**
14. FinanceTab 拆分（对齐 TodayFeed 拆分先例）；死枚举清理；预算移出总览。
15. 图表统一（屏幕=月报同一套 finance-report-visual）；断档月留白；进度条超支段独立染色；
    折线加触摸 scrubbing。
16. 「对账小票」进账户详情；筛选胶囊；规则审核批量化 +「做成规则?」CTA。

---

*四路探查原始报告很长，本文是收敛后的单一事实源；改动落地时逐条销号并更新 STATE.md。*

---

## 四、施工自查（2026-07-28,开工前;UI 稿 = artifact fb540e24 v3.3 八屏）

### 改动量盘点

| 期 | 涉及文件 | 规模估计 |
|---|---|---|
| P0 止血 | providers/bank-tx.ts(符号化/txFlow 投资参数/ready/保险丝/throughDay ~115 行) · providers/connector-sync.ts(重排+保险丝+状态落盘) · finance-aggregate.ts(opts) · tesla-finance.ts(combined loader) · FinanceTab.tsx(hydrated/错误横幅/同进度) · domain-insights.ts | ~400 行改动 + 新契约;fin-display / finance-report / finance-recurring / finance-rule-keys 四套现有契约钉着 txFlow/summarizeMonth,逐条核对(正常路径符号不变,预期多数断言存活) |
| P1 数据模型 | **新** finance-assets.ts(手动资产+锚点+净值/投资日快照序列,IDB store ~250) · finance-sources.ts(Expense 扩 kind:'income' + channelId ~40) · **新** receipt-match.ts(小票↔银行候选+负样本 ~120) · connector-sync(落日快照) · **新** QuickAddSheet.tsx(~250) | ~800 行新增 + 契约×3 |
| P2 分析 | finance-features(股利利息 YTD/组合体检因子 ~150) · finance-insight(findings 加 action/稳定 id ~80) · 统一口径共享函数 · 订阅监控数据拼装(算法全现成) · guidelines 补 4 条 | ~350 行 |
| P3 UI | FinanceTab 939 行拆 ~8 个子组件(Overview/Spending/Tx/Accounts/Checkup/Recurring/InvestDetail/QuickAdd),图表统一到 finance-report-visual | ~2000 行重排(多为搬运) |

### 自查修正(三处方案更正)

1. **手动流水不伪造 BankTx**:「+」记的收支走 finance-sources(Expense 扩展),不写 bank-tx 存储
   (绕开 Plaid replace 冲掉 + 孤儿过滤两个坑)——与 Tesla 显示层合并同一模式;financeMonthAggregate
   的 domainNet 通道扩成 domainNet+domainIncome。交易列表显示层 union。
2. **小票不双计的实现点**:关联后 Expense 记 linkedBankTxId,`listExpenses(financeOnly)` 聚合时
   排除已关联行 —— 一行过滤,银行流水为记账层。
3. ~~多币种净值分列~~ **用户拍板(2026-07-28):不考虑币种** —— 净值简单相加,不分列不折算;
   P0 的「七函数多币种加固」不做,现有主币种过滤原样保留。

### 用户拍板与追加决策(2026-07-28)

- **币种**:不考虑(上条)。
- **Plaid `/transactions/recurring/get` 接入(P2,订阅监控)**:PFC 分类已在用;专门的定期流 API
  未接 —— 同 token 零额外授权,策略「Plaid 流 ∪ 本地 detectRecurring,冲突本地为准」。
- **该删/该改清单(并进各期)**:删「排除」按钮(实为归 OTHER,骗人;真排除用 excluded 标志)、
  删屏幕版环形图(统一到月报那套)、删趋势图双重编码(留面积)、删 Sub 三个死枚举(订阅/投资
  变真页面)、删单笔审核限制与原始 id 显示、置信度改用 suggestCategory 真值、
  autoPersistLastMonthReport 补可见失败态、统一 includePredicted 口径、修繁体「約」。

### 继续挖掘项(开工中带着做)

- **新 IDB store 必须进备份/云同步枚举**(buildCombinedBackup + cloud-module-sync)——手动资产
  换端就丢 = 违反 workshop 全数据云端化;此前方案漏了这条,P1 验收标准里补上。
- **已实现盈亏比预想可行**:24 个月投资流水有买卖价与数量,简化 FIFO 可算「今年卖出实现盈亏」
  ——从「诚实缺席」升级为 P2 候选。
- Plaid /investments 的 fees 字段是否已拉(费用拖累因子)——路由里待查。
- 家务虚拟账本隔离:P1 契约加断言(chores play money 不进任何新汇总)。
- FinanceTab 拆分时 hooks 顺序陷阱(空态早退注释已警告),拆分批次要保 hooks 全量在早退前。
