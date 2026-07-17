# Nesio Backlog — 想法与延迟需求

> 这个文件是活的想法仓库。不是 TODO list，是"还没到时候但不想忘"的东西。
> 随时添加，随时查阅。格式：想法 + 背景 + 为什么值得做。

---

## 平台层

### [DEFERRED] P3 — On-Hold 显式状态 (dormant-engine)

**背景：** 2026-07 升级 dormant engine 时（P0-P2 已落地），P3 因工程量较大延后。

**要做什么：**
- `DormantStatus` 新增 `'on-hold'` 状态
- 用户可主动标记"等某个条件，不是忘了"，附带可选原因和可选恢复时间
- 区别于 dormant（被动衰减）：on-hold 是主动的、有意图的暂停
- UI 层需要新增一个"搁置"动作入口（比如在任务详情页加按钮）
- 恢复时间到了时，guidance-engine 推一张"条件来了，可以继续了"卡片

**参考：** OmniFocus 的 Defer vs On Hold 区分设计，见本次升级的研究笔记。

---

## 跨域应用

### [IDEA] 休眠引擎逻辑 → 学习系统

**背景：** 2026-07 与用户讨论 dormant engine 时提出。

**核心洞察：**
这一套衰减 + 间隔重复 + 判断弹出的逻辑，和 FSRS / Anki 的记忆调度算法高度同构：

| Dormant Engine | 学习系统 |
|----------------|---------|
| 任务衰减 30 天进入休眠 | 知识点遗忘曲线触底 |
| 打盹间隔指数增长 | 复习间隔随稳定性增长 |
| "还属于你吗？" | "还记得这个吗？" |
| 放下 / 搁置 / 现在做 | 忘了 / 模糊 / 记得 |
| snoozeCount 驱动升级提示 | difficulty 驱动调度密度 |

**可能的应用：**
- 学过的概念、单词、技能 → 用同一个引擎管理"该复习了"
- 放下的学习目标 → 定期问"还想学吗"
- 未完成的课程 → 90 天软归档 + 最终确认

**下一步：** 等学习系统有了基础骨架，可以直接复用 `dormant-engine.ts` 的核心逻辑，适配 `LearningNode` 类型。

---

## 引导引擎

### [IDEA] 用户意图推断层 (BDI Framework)

**背景：** 2026-07 研究 guidance engine 升级时发现，Satori 系统用 BDI（Belief/Desire/Intention）框架主动推断用户当前意图。

**要做什么：**
- 从最近 activity（打开了哪些任务、触碰了哪些节点）推断用户当前处于什么"模式"
- 模式影响引导卡片的类型和频率（专注模式 → 不打扰；规划模式 → 多推提醒）
- 目前没有足够的行为数据，等 event tracking 完善后再考虑

---

_最后更新：2026-07-02_

## 连接器 · iOS PWA OAuth(2026-07-17 记)

- **Granola 的 PWA 跨环境授权还没修**:gmail/tesla 已用「签名 state 带 uid,回调直写
  Supabase」闭环(公众仓 d8d5da1 / 本仓同批),但 Granola 的回调依赖 PKCE stash
  cookie(state+codeVerifier+DCR client 全在 `nesio_granola_oauth` cookie 里),
  iOS 应用内浏览器的回调拿不到 → 必挂。修法方向:发起侧把 uid 签进 state,
  stash 存 Supabase 用户行(临时键),回调凭 state 里的 uid 取回 stash 换 token,
  用后即清。在此之前的绕法:在桌面浏览器(或 iPhone Safari 直开,非主屏图标)
  连一次,server 真源合并会让手机端显示已连接。
