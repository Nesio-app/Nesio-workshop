# 板块关联矩阵（Module Link Matrix）

> **这份文档回答一个问题：一个东西在 A 板块被记下，B 板块能不能看见它、用得上它。**
>
> 起因（2026-07-30）：四个 use case 问出了同一个坑——
> ① Plaid 交易上手动关联了人和附件，关系页看不到、记忆库搜不到；
> ② 美食「记一条」拍的小票，不会跟银行流水对账；
> ③ 机票邮件能关联到**已存在**的行程，但不会新建行程；
> ④ 资产上传的发票不触发识别，金额要手打。
>
> 一条一条查都是「这个功能忘了做关联」，合起来看才是一件事：
> **关联的地基只覆盖记忆图内部，而一半的业务对象根本不在记忆图里。**

---

## 一、三套关联机制（现状）

| | 机制 | 存在哪 | 谁看得见 |
|---|---|---|---|
| **A** | `LifeNode.relations` | 记忆图内部，双向可写 | 记忆详情、问一问、图谱、时间线 |
| **B** | 旁挂 overlay（模块自己的表） | 各自的 localStorage / IDB key | **只有写它的那一个屏幕** |
| **C** | 无 | — | — |

A 机制目前只有一处做到了「自动 + 双向 + 可解释」：`lib/portal/plan-links.ts`（行程 ↔ 确认邮件，
三条确定性锚点：航班号 / 机场对+日期 / PNR）。它能成立，正因为**两头都是 LifeNode**。

B 机制的例子：`tx-annotations`（交易↔人/附件）、`finance-sources.linkedBankTxId`（小票↔流水）、
`Expense.assetId` + `CareRecord.expenseId`（资产↔支出）。每一处单看都对，合起来是七八张互不相通的小表。

## 二、四色状态

| 记号 | 含义 |
|---|---|
| 🟢 | 已连，**两头都看得见** |
| 🟡 | 连了，但**只有一头看得见**（或只在某一个屏幕内有效） |
| 🔴 | 该连没连 |
| ⚪ | 有意不连（须写明理由） |
| ❓ | 未核实 |

## 三、每格必答的五问

1. **进什么** —— 这个板块产生的东西是 LifeNode，还是自己的表？
2. **凭什么去重** —— 有稳定 id 吗？重复操作会不会堆？
3. **关联谁** —— 该跟哪些板块连？现在走 A / B / C？
4. **看得见吗** —— 关联建立后，**两头**都能看到吗？
5. **删了会怎样** —— 附件、反向引用、外部 id 墓碑。

## 四、16 个板块

洞察页 14 个 tab + 宫格 2 个（`InsightsSheet.tsx:424-435`）：

`回看(reflection)` · `成长(growth)` · `蒙太奇(montage)` · `健康(health)` · `运动(fitness)` ·
`时间线(timeline，含足迹/旅行)` · `日程(schedule)` · `财务(finance)` · `物品(inventory)` ·
`衣橱(wardrobe)` · `关系(relationships)` · `资产(tesla)` · `生活模型(living)` · `运维(admin)` ·
`家务(chores)` · `美味(cooking)`

---

# 样板 · 财务（finance）

## 五问

### ① 进什么

| 业务对象 | 存储 | 是 LifeNode 吗 |
|---|---|---|
| 银行流水 `BankTx` | `nesio-bank-tx-v1` | ❌ |
| 支出聚合 `Expense`（小票/旅行/手动/Tesla） | `nesio-expenses-v1`（IDB blob） | ❌ |
| 手动资产 `ManualAsset` | `nesio-fin-assets-v1` | ❌ |
| 持仓 `Holding` | `nesio-fin-holdings-v1` | ❌ |
| 定期账单 `RecurringCharge` | `nesio-bank-recur-v1` | ❌ |
| 交易批注（人 / 附件 / 备注） | `nesio-fin-tx-annotations-v1` | ❌（overlay） |
| 资产照料记录 | `nesio-asset-care-v1` | ❌ |
| 对账否决对 | `nesio-receipt-match-rejected-v1` | ❌ |
| **月报** | — | ✅ `finance-report.ts:209`（`type:'event'`，tags `财务`/`月报`） |

**九个对象里只有月报进了记忆图。** 这一条决定了后面所有 🔴。

### ② 凭什么去重

| 对象 | 幂等键 | 状态 |
|---|---|---|
| BankTx | Plaid transaction_id | ✅ |
| Expense（小票） | `camera:日期:指纹`（`CameraSheet.tsx:824`） | ⚠️ 是自造键，跟 `externalKey()` 无关，也不是 node id |
| 定期账单 | `merchantKey` | ✅ |
| 交易批注 | `tx.id` | ✅ |
| 资产照料 | 自增 id | ⚠️ 同一张发票传两次会有两条 |

### ③④ 关联谁 / 看得见吗

| 财务 ↔ | 状态 | 现状与锚点 |
|---|---|---|
| **关系（人）** | 🟡 | `tx-annotations.people` 存的是人名 key（`tx-annotations.ts:25`），**全仓只有 `FinanceTab.tsx` 读它**。Linda 的关系页看不到这笔钱 |
| **附件** | 🟡 | 附件本体在 `local-file-store`，批注里只留 assetId。**不在 `node.assets` 体系**，问一问/记忆详情都取不到 |
| **记忆 / 时间线 / 问一问** | 🔴 | 交易、支出、资产全不在图里。`MemoryTab` 从不读 `loadBankTx`（grep 零命中）→ **记忆库搜不到任何一笔消费** |
| **物品（相机小票）** | 🟡 | 拍小票 → 既落 `object` 节点又落 Expense（`CameraSheet.tsx:817`），但 `sourceRef` 是指纹不是 node id → **两者之间没有可导航的链接** |
| **资产** | 🟡 | `addManualEntry({assetId, assetCostKind})` + `expenseId` 回写照料记录（`AssetsPanel.tsx:311/325`）——**双向、删不留孤儿账，做得对**。但财务页点开这笔税费看不到发票 |
| **行程（旅行）** | 🟡 | `travel-trips.ts:651` → `addReceiptExpense({includeInFinance:true})`，旅行小票进财务 ✅ 单向；财务侧看不到「这是哪次旅行」 |
| **健康（就诊费用）** | 🔴 | `HealthRecordSheet` 已有 `price`/`currency` 字段（bug3 p41），**那笔钱不进财务** —— 医疗支出在月度汇总里是隐形的 |
| **日程** | 🔴 | 定期账单有续费日，日历里没有它；账单邮件也不对账 |
| **家务（零花钱）** | ⚪ | `finance-sources.ts:4` 明写「家务零花钱（play money）故意不进这里」——**有意，理由已记录** |
| **衣橱** | ❓ | 衣物有无价格字段、是否该进支出，待核 |
| **美味** | 🔴 | `addMeal()`（`meals.ts:35`）只存营养，**无金额字段** → 永远进不了 `receiptMatchCandidates` |
| **成长 / 回看 / 洞察** | 🟢 | 月报进图，可搜、可引用 |

### ⑤ 删了会怎样

- 删交易批注 → `deleteLocalFile` 有调（`tx-annotations.ts:14`）✅
- 删照料记录 → `expenseId` 回写让账能一起清 ✅
- 删记忆节点 → `deleteLifeNode`（`life-graph.ts:1137`）**不清附件、不清 dHash 索引、不清反向引用** ❌
- 导入类记忆删掉 → **无墓碑，下次同步复活** ❌

## 财务这一格的结论

对账、资产持有成本、旅行小票并账——**确定性的钱路都通了，而且写得扎实**
（`receipt-match.ts` 的 ±1% + ±3 天 + 否决记忆是好设计）。

断的全是**同一类**：钱与「人 / 附件 / 记忆」之间。因为那三样活在记忆图里，而钱不在。

---

# 其余 15 格

> 按同一份五问推进，逐格补齐后在文末汇总成 16×16 矩阵。
> **未完成的格子保持空白，不许拿猜测填。**

- [ ] 关系（relationships）
- [ ] 健康（health）
- [ ] 物品（inventory）
- [ ] 衣橱（wardrobe）
- [ ] 时间线 / 足迹 / 旅行（timeline）
- [ ] 日程（schedule）
- [ ] 资产（tesla）
- [ ] 美味（cooking）
- [ ] 家务（chores）
- [ ] 运动（fitness）
- [ ] 成长（growth）
- [ ] 回看（reflection）
- [ ] 蒙太奇（montage）
- [ ] 生活模型（living）
- [ ] 运维（admin）

---

# 扩张协议 · 新板块 / 新功能接入清单

> **目的：下一个功能不用再进这份审计。**
> 新写一个板块、一个连接器、一个 AI 能力时，逐条过。任何一条答不上来，就是在制造下一个 🟡。

### 1. 你的东西是 LifeNode 还是自己的表？

**默认应该是 LifeNode。** 只有满足以下之一才可以自建表：

- 数据量级会压垮记忆图（如银行流水几千条）；
- 它是纯派生视图（可从别处重算）；
- 它是凭证/密钥类（绝不该进记忆）。

自建表的，**必须同时**在记忆图里留一个「代表节点」（像月报那样），否则这个板块的东西
在记忆库、问一问、时间线里全部隐形——这是所有 🔴 的共同成因。

### 2. 幂等键

写节点必须带 `emailId` / `notionPageId` / `externalId` 之一
（`lib/life-domain/ingest-node.ts` 的 `externalKey()` 只认这三个）。
**自造去重逻辑要在 `scripts/connector-idempotency.test.mjs` 里登记**，否则下次重构会静默失效。

格式约定：`externalId: '<源>:<该源的稳定 id>'`，例如 `weread:12345`、`toggl:weekly:2026-07-30`。

### 3. 关联走 A，不走 B

要跟别的板块连，**优先把两头都变成 LifeNode，然后写 `relations`**。

- `targetId` **必须是节点 id**，不许是人名/邮箱/任何业务键
  （现存反例：`life-graph.ts:1260` 的 `owned_by` 存了人名，导致该关联永远渲染不出来）；
- 关系名要**双向成对**写（`part_of_plan` ↔ `plan_item`，`confirmed_by_email` ↔ `confirms_plan`）；
- 新关系名必须加进 `MemoryNodeDetail.tsx` 的 `REL_LABEL`——**不在表里的关系会被静默吞掉**，
  不报错、不显示（现存反例：`owned_by` / `family` / `producer_to_consumer`）。

确实必须用 overlay（B）时，**必须回答：另一头在哪里看？** 答不上来就不要写。

### 4. 自动关联要「可辩护」，不要 AI 猜

模板是 `lib/portal/plan-links.ts`：只认确定性锚点（id 交集 / 编号一致 / 日期吻合），
命中才连，幂等可重跑，无 key 也能工作。

不确定的一律**建议 + 人确认**（模板：`receipt-match.ts` + `FinanceTab.tsx:759-771` 的
「关联 / 不是」两颗按钮，「不是」进否决记忆永不重复推荐）。

### 5. 云 AI 的输出必须过校验

`/api/portal/analyze` 的 `result.nodes` 目前**零校验**直接透传给客户端 `ingestLifeNode`
（`analyze/route.ts:524` → `CameraSheet.tsx:861` 的 `as LifeNode['type']` 强转）。
新增任何「AI 产出记忆」的路径，type 必须过白名单，认不出的落 `note` 并把原值留在 `rawType`。

### 6. 附件

一张照片派生多条记忆时，附件/指纹/地名/云资源要给**全部**节点，不能只给第 0 条
（现存反例：`CameraSheet.tsx:907/911/928/960`）。

### 7. 删除

新表要回答：删记忆时它清不清？删它时附件清不清？外部导入的删了会不会被下次同步复活？

### 8. 内部机制信号不进记忆

反馈、埋点、缓存这类内部信号走 `createSignal` 会**变成用户可见的记忆**
（现存反例：`retrieval-feedback.ts:57`、`signal-feedback.ts:76`、`feedback-log.ts:95`
——点一次「不是这个」就多一条叫「检索反馈:不是这个」的笔记）。
新增内部信号必须标记为内部并在 `memory-visibility.ts` 拦掉。

---

## 变更记录

| 日期 | 内容 |
|---|---|
| 2026-07-30 | 建档。三套机制 + 四色 + 五问 + 财务样板 + 扩张协议 |
