# STATE.md — 仓库持久状态(会话外记忆)

> Loop-engineering 原则:状态必须活在对话之外。任何 AI 会话或新协作者
> **先读这个文件**,再动手。改动仓库重大状态时,同步更新这里。
> 最后更新:2026-07-04

## 当前纪元:两代产品交接中

本仓库同时存在两代产品,交接未完成:

| 层面 | 旧代(退役中) | 新代(现役) | 交接状态 |
|---|---|---|---|
| 首页 | DashboardHome | TodayFeed | UI 已切换;**i18n/契约未迁移** |
| 设置 | AccountSettings | NesioProfileCard + SettingsSheets | 已切换;主题/语言入口曾断链(已修) |
| 推荐卡 | DEC(lib/intelligence) | guidance-engine(lib/platform) | **DEC 每次页面加载仍在运行,输出被丢弃**;其证据门控体系是 PRD TODAY-002 的现成实现 |
| 数据模型 | LifeGraph(localStorage) | Signal 主事实表 | **双写过渡中**(见 lib/life-domain/create-signal.ts 头注释) |
| 工具入口 | 11 工具宫格 | 统一入口 + 五域 | 工具由 bundle-toolbox.mjs 构建时拷入 public/ |

## 进行中的迁移

1. **Signal 主事实表**:createSignal() 是唯一合法写入口;LifeGraph/Memory 是兼容投影
2. **契约迁移**(未开始):~11 个 scripts/*.test.mjs 契约测试钉在旧代组件上
   (AccountSettings/DashboardHome/LifeStateCard/ToolCard/ToolSidebar)。
   这些组件已从页面不可达,但**不能删**——删除会弄红 CI(2026-07-03 已发生并 revert,
   见 commit ae05ccd)。正确顺序:先迁契约到新代 surface,再删组件。
   迁移过程会自动产出新代回归清单(TodayFeed 缺 i18n 键、缺 providerActionMatrix 等)。

## 红线(动之前必读)

- **CI 每次 push 跑 `test:security`(18 套安全契约)**,见 .github/workflows/deploy.yml。
  本地验证命令:`npm run test:security`。改动 integrations.ts / DailyBriefCard /
  MemoryNodeDetail / TodayFeed / Portal 前先看 scripts/anonymous-private-data-gate.test.mjs
  对它们的字面断言(契约喜欢正形式门控 `if (canUsePrivateData) {`)。
- **新增花钱/碰私据的 API route 必须过 `guardAiRoute`**(lib/portal/api-auth.ts)
  并登记 docs/api-routes.md。
- **设计规则**:每个异步动作必有可见失败态;每个 modal 必有退出;红色只给真实风险;
  文案遵循设计系统"温暖教练"语音(禁感叹号/禁"逾期失败")。
- 兄弟目录不是全是垃圾:adhd-flow-ios/web、health-web、storage-web、fitness/web、
  tools/secretary 是 bundle-toolbox 的**构建输入**。

## 已知欠账(按优先级)

1. 契约迁移工程(见上)→ 迁完再删 15 个死组件
2. DEC 接线:让 Today 卡消费 runDEC() 证据卡,或移植证据机制进 guidance(PRD TODAY-002/003/004)
3. Demo 模式补完:portal 级种子数据(`demo_example` 字段已预留;参考
   lib/portal/inventory-first-launch-contract.mjs 的完整 demo 契约);
   未登录点听简报应播 demo 而非无解释跳登录
4. Onboarding 激活化:FirstUseTips 第三张卡改实操(存第一条记忆+当场找回)
5. 隐私遮罩:情绪/日记节点首屏默认摘要化
6. 情绪轮盘缺退出(违反 Always an exit);404 页缺返回链接
7. 设计 adherence lint(设计系统 zip 内 _adherence.oxlintrc.json)未接入 eslint
8. TodayFeed 1408 行(工程 PRD 阈值 <300);语音合规巡检;新代 i18n 补课
9. 深水区:LifeGraph→IndexedDB、DEC/dec-data 命名分离、Next 16、lab 模式管理 UI

## 已安装的循环(L1 = 只报告)

| 循环 | 位置 | 节奏 |
|---|---|---|
| CI 失败开 issue | .github/workflows/deploy.yml | 每次 push |
| 漂移检测(契约可达性/PRD 对账/文档过时) | `npm run report:drift` + loops.yml | 每周 |
| 断链巡检(modal 退出/能力入口) | `npm run report:broken-links` + loops.yml | 每周 |
| 安全循环(audit/route 守卫/文档新鲜度) | `npm run report:security-loop` + loops.yml | 每周 |
| AI 成本(telemetry 汇总) | `npm run report:ai-cost` | 每月/手动 |

## 模式速查

- Lab 模式:URL `?baohePersonal=1` 进入,`?baohePublic=1` 退出;viewerRole
  四级 public/tester/personal_lab/local(lib/portal/launch-surface.mjs)
- Demo/personal/market 三模式矩阵:components/portal/tool-state.ts(ShellMode)
- Stage5 代理动作:CEO 双 env 门禁 + invocation secret
  (lib/intelligence/tool-invocation-runtime.mjs)
