# 前端质量 + 测试真实度审计(2026-07)

> 直接取证(grep/静态)+ 分析。分析产物,给在修的 Agent。结论有好有坏,分别标注。

---

## 1. 测试真实度 —— CI 绿 ≠ 产品能用

**154 个测试文件,但只有 ~30 个真跑行为,~120 个在验元数据/配置/结构。**

| 类型 | 数量 | 测什么 |
|---|---|---|
| report-*(报告) | 26 | 断言 module registry 报告结构、版本号 |
| *-contract(契约) | 15 | 断言契约 shape/版本 |
| *-schema / supabase | 13 | 断言 SQL schema 快照 |
| *-runtime-env(环境断言) | 33 | 断言「某功能需要哪些 env」 |
| *-audit / precheck | 6 | 边界/隔离预检 |
| **真行为**(VM 转译跑真 .ts 11 + 直接 import lib 断言 19) | **~30** | 真跑逻辑、断结果 |

**含义**:`test:contracts`(push 门跑近百个)**主要在验「契约/manifest/schema 自洽」,不是「产品行为对」**。这和治理审计发现的「43% 契约层 report-only」完全对称——**有一层空转的契约,就配了一套验它自洽的测试**。所以 CI 全绿只说明「元数据一致」,不说明「上传/同步/学习/删除真的对」。本 session 审出的静默失败(金融丢数据、删除假成功、日报把故障说成平稳)**全都在 CI 绿的情况下存在**——因为没有行为测试覆盖它们。

**建议**:把测试预算从「再加契约测试」转向「行为测试覆盖数据完整性关键路径」:Plaid 合并、备份恢复、云同步失败降级、删除/导出、analyst 数据源失败——这些正是静默失败审计点名的地方。

---

## 2. i18n 覆盖真实度 —— 🟢 真接、真门(这块是好的)

- 组件里 **1524 处** `L(dict, zh, en)` / `t(locale)` 调用——i18n 真的接进去了,不是摆设。
- `i18n-hardcode-scan.test.mjs` 是**真扫描器**:allowlist 只有一个测试 fixture(`ignored.test.tsx`),**没有大范围豁免/白名单**,不是走过场。硬编码 UI 文案会被 push 门挡。
- **唯一开放问题**:扫描器保证「没硬编码」,但**保证不了英文翻译的质量/完整**(zh 是主、en 可能是随手补的)。这是「翻译质量」问题,不是「覆盖」问题——需人工抽样,不是自动能测的。

---

## 3. a11y —— 🟠 有 ARIA 属性,但键盘/焦点是化妆的

| 指标 | 数 | 评 |
|---|---|---|
| aria-* 属性 | 336 | 广泛,看着无障碍 |
| aria-modal="true" | 28 /(37 overlay) | 大多数弹层声明了 modal |
| **键盘处理** onKeyDown/Up | **17** | 极少 |
| **Escape 关闭** | **3** | 28 个 modal 里只有 3 处能 Esc 关 |
| **真焦点陷阱**(focus-trap/inert) | **0** | 无库、无 inert 背景,只有零散 `.focus()` |

**问题**:**28 个组件声明 `aria-modal="true"` 却没有焦点陷阱、大多不能 Esc 关闭。** 这是典型的「aria-modal 撒谎」——屏幕阅读器/键盘用户打开弹层后,**Tab 会跑到背后本该 inert 的页面**,也**关不掉**。ARIA 属性齐全让它看着无障碍,但**键盘可用性是空的**。和治理层「看着做完实际没接线」是同一种病。

**建议**:给弹层加一个统一的 focus-trap + Escape + 背景 inert 的 hook(一处,所有 Sheet 复用),比逐个补 aria 属性有用得多。

---

## 4. offline / PWA —— 🟢 PWA 真实,🟠 离线持久化分裂 + 冲突未解

**好的:**
- 主 app **真注册 SW**(`Portal.tsx` → `/sw.js`),`public/sw.js` 是**真离线壳**:导航 network-first + 缓存壳兜底(在线绝不给旧部署)、静态 cache-first、`/api/*` 不碰(数据流保持实时)。**可安装、离线能开**。

**问题(与静默失败审计交叉):**
- **离线写持久化分裂**:Memory 节点有 outbox(`nesio-life-graph-cloud-sync-outbox`,失败重试);而 **Signal 云镜像 `void writeCloudSignal(signal)` 是 fire-and-forget、无 outbox**(create-signal:173)。离线记一条事实 → memory 会补传、signal 永久缺席云端。**同一"离线可用"承诺,一半兑现一半漏。**
- **冲突解决未做**:云同步靠 Supabase `on_conflict + merge-duplicates`(**last-write-wins**);`cloud-snapshot-contract` 里 `conflictResolution: 'not_started'`。**多设备并发编辑 → 后写覆盖先写,静默丢**。对一个多设备 local-first app,这是真数据丢失面。
- **读路径 cutover 仍未切**(`create-signal.ts:171` 「读路径未切」):号称权威的 IDB 事实库**只对写权威,读还走 LifeGraph 投影**——双存储风险持续(架构审计 #1)。

**建议**:①把 Signal 云镜像也接上 outbox(复用 memory 那套);②冲突至少上「带版本/时间戳的合并 or 冲突标记」,别裸 LWW;③把读路径切到事实库,兑现「权威源」。

---

## 总评

| 面 | 评级 | 一句话 |
|---|---|---|
| 测试真实度 | 🔴 | 154 测试 ~120 在验契约/schema,行为覆盖 ~30;CI 绿测的是元数据自洽,不是产品对 |
| i18n | 🟢 | 真接(1524)真门(严扫描);只剩 en 翻译质量需人工抽样 |
| a11y | 🟠 | ARIA 属性齐(336)但焦点陷阱 0、Esc 仅 3、键盘 17 → 无障碍是化妆的 |
| offline/PWA | 🟢🟠 | PWA 离线壳真实;但离线写持久化分裂(signal 无 outbox)、冲突裸 LWW、读路径未切 |

**共同主题**(贯穿本 session 三份审计):**「声明/属性/契约齐全,但运行时接线缺失」**——治理契约 report-only、aria-modal 无焦点陷阱、事实库权威却读路径未切、学习反馈折权重即弃。**看着做完,实际半接。** 修的方向都一致:补上那"最后一根接线",而不是再加一层声明。

_关联:`silent-failure-audit-2026-07.md`、`architecture-issues.md`、`algorithm-review-findings.md`。_
