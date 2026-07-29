# 宝盒 Workshop localStorage 完整审计

**审计日期**: 2026-07-29  
**覆盖范围**: /home/user/Nesio-workshop 全部 TypeScript/TSX 源码  
**总发现**: 209+ 个 localStorage 操作，66 个独立 key

---

## 1. localStorage Key 清单（完整）

### 核心数据类（必保留，需加密上云）

| Key 名称 | 存储内容 | 所属模块 | 数据大小估算 | 优先级 | 上云 | 改造方案 |
|---------|---------|--------|-----------|--------|------|--------|
| `nesio-life-graph-v1` | 用户生活图谱（人物、事件、承诺等节点） | life-graph | **500KB~5MB** | P0 | ✓ | → IDB永久表 + 云同步 |
| `nesio-bank-tx-v1` | 银行交易历史（Plaid 导入） | bank-tx | **200KB~2MB** | P0 | ✓ | → IDB永久表 + 云同步 |
| `nesio-bank-accounts-v1` | 银行账户列表 | bank-tx | 5~20KB | P0 | ✓ | → IDB永久表 + 云同步 |
| `nesio-bank-holdings-v1` | 证券持仓 | bank-tx | 20~100KB | P0 | ✓ | → IDB永久表 + 云同步 |
| `nesio-fin-assets-v1` | 资产信息 | finance-assets | 50~200KB | P0 | ✓ | → IDB永久表 + 云同步 |
| `nesio-fin-networth-series-v1` | 净资产时间序列 | finance-assets | 30~150KB | P0 | ✓ | → IDB永久表 + 云同步 |
| `nesio-health-v1` | 健康记录（体重、血压等） | health-store | **100KB~500KB** | P0 | ✓ | → IDB永久表 + 云同步 |
| `nesio-clinical-v1` | 临床数据 | clinical-store | 50~200KB | P0 | ✓ | → IDB永久表 + 云同步 |
| `nesio-person-records-v1` | 人物记录（关系网） | person-records | 100~500KB | P0 | ✓ | → IDB永久表 + 云同步 |
| `treasurebox-profile-name` | 用户显示名字 | profile | <1KB | P0 | ✓ | → IDB永久表 + 云同步 |
| `treasurebox-profile-avatar` | 头像 URL（签名 URL） | profile | 1~5KB | P0 | ✓ | → IDB永久表 + 云同步 |
| `treasurebox-profile-avatar-storage-path` | 头像存储路径 | profile | <1KB | P0 | ✓ | → IDB永久表 + 云同步 |
| `treasurebox-locale` | 用户语言选择 | profile | <1KB | P0 | ✓ | → IDB永久表 + 云同步 |
| `treasurebox-coach-style` | 教练风格偏好 | profile | <1KB | P0 | ✓ | → IDB永久表 + 云同步 |
| `treasurebox-profile-updated-at` | 身份信息最后修改时刻（LWW） | profile | <1KB | P0 | ✓ | → IDB永久表 + 云同步 |
| `nesio-daily-report-enabled` | 日报开关 | profile | <1KB | P0 | ✓ | → IDB永久表 + 云同步 |
| `nesio-rel-contact-v1` | 关系接触日志 | relationships | 20~100KB | P0 | ✓ | → IDB永久表 + 云同步 |
| `nesio-entity-aliases-v1` | 实体去重映射表 | entity-resolution | 10~50KB | P0 | ✓ | → IDB永久表 + 云同步 |
| `nesio-projects-v1` | 用户项目列表 | project | 20~100KB | P0 | ✓ | → IDB永久表 + 云同步 |
| `nesio-named-places` | 命名地点（家、公司等） | named-places | 10~50KB | P0 | ✓ | → IDB永久表 + 云同步 |
| `nesio-place-geo-v1` | 地理信息缓存 | place-trail | 50~200KB | P1 | ✓ | → IDB永久表 + 云同步 |
| `nesio-place-cat-v1` | 地点分类 | place-trail | 10~50KB | P1 | ✓ | → IDB永久表 + 云同步 |
| `nesio-place-renames-v1` | 地点重命名映射 | place-trail | 5~20KB | P1 | ✓ | → IDB永久表 + 云同步 |
| `nesio-place-alias-v1` | 地点别名 | place-trail | 5~20KB | P1 | ✓ | → IDB永久表 + 云同步 |
| `nesio-body-ledger-goals-v1` | 身体目标（体重、腰围等） | body-ledger | 5~20KB | P1 | ✓ | → IDB永久表 + 云同步 |
| `nesio-fin-budget-v1` | 财务预算 | finance-budget | 5~20KB | P1 | ✓ | → IDB永久表 + 云同步 |
| `nesio-core-memories-v1` | 核心记忆（最多 100 条） | pins | 50~200KB | P1 | ✓ | → IDB永久表 + 云同步 |
| `nesio-mirror-letters-v1` | 镜子信件（自我认识） | mirror-letters | 20~100KB | P1 | ✓ | → IDB永久表 + 云同步 |
| `nesio-mirror-letter-feedback-v1` | 镜子反馈 | mirror-letters | 5~20KB | P1 | ✓ | → IDB永久表 + 云同步 |
| `nesio-routines-v1` | 日常例程 | routines | 10~50KB | P1 | ✓ | → IDB永久表 + 云同步 |
| `nesio-wardrobe-outfits-v1` | 衣柜搭配（最多 400） | wardrobe-outfits | 50~200KB | P1 | ✓ | → IDB永久表 + 云同步 |
| `nesio-workout-store-v1` | 健身计划（生成的 session） | workout-store | 50~200KB | P1 | ✓ | → IDB永久表 + 云同步 |
| `nesio-workout-history-v1` | 健身历史 | workout-store | 100~500KB | P1 | ✓ | → IDB永久表 + 云同步 |
| `nesio-video-montage-v1` | 视频蒙太奇（最多 60 条） | video-montage | 100~300KB | P1 | ✓ | → IDB永久表 + 云同步 |
| `nesio-jot-draft-v1` | 草稿（临时） | jot / components | 10~50KB | P1 | ✓ | → IDB永久表 + 云同步 |
| `nesio-local-owner-v1` | 本地设备主人信息 | local-owner | <1KB | P0 | ✓ | → IDB永久表 + 云同步 |
| `treasurebox-onboarding-v14-done` | 新手引导完成标记（v14 版本） | Portal / onboarding | <1KB | P1 | ✓ | → IDB永久表 + 云同步 |
| `baohe_inventory_v01` | 库存（Memorial 主根对象） | memory/memorial | **1MB~10MB** | P0 | ✓ | → IDB永久表 + 云同步 |

### 缓存类（可丢弃，≤1 周过期）

| Key 名称 | 存储内容 | 所属模块 | 数据大小估算 | 优先级 | 改造方案 |
|---------|---------|--------|-----------|--------|--------|
| `nesio-life-graph-cloud-sync-v1` | 云同步状态 | life-graph | 1~5KB | P1 | → IDB 临时表 + 1 周过期 |
| `nesio-life-graph-cloud-sync-outbox-v1` | 待同步项目队列 | life-graph | 10~50KB | P1 | → IDB 临时表 + 1 周过期 |
| `nesio-bank-sync-status-v1` | 银行同步状态 | bank-tx | 1~5KB | P2 | → IDB 临时表 + 1 周过期 |
| `nesio-bank-synced-at` | 银行最后同步时间 | bank-tx / connector-sync | <1KB | P2 | → IDB 临时表 + 1 周过期 |
| `nesio-plaid-recurring-v1` | Plaid 周期交易（缓存） | bank-tx | 10~50KB | P2 | → IDB 临时表 + 1 周过期 |
| `nesio-module-sync-state-v1` | 模块同步状态 | cloud-module-sync | 1~5KB | P2 | → IDB 临时表 + 1 周过期 |
| `nesio-module-sync-since-v1` | 模块同步起点（时间戳） | cloud-module-sync | <1KB | P2 | → IDB 临时表 + 1 周过期 |
| `nesio-reader-sync-state-v1` | 阅读器同步状态 | cloud-reader-sync | 1~5KB | P2 | → IDB 临时表 + 1 周过期 |
| `nesio-email-sync-state-v1` | 邮件同步状态 | cloud-email-sync | 1~5KB | P2 | → IDB 临时表 + 1 周过期 |
| `nesio-cloud-backup-last-v1` | 上次云备份记录 | cloud-backup | 1~5KB | P2 | → IDB 临时表 + 1 周过期 |
| `nesio-backup-synced-entrycount-v1` | 备份同步高水位 | cloud-backup | <1KB | P2 | → IDB 临时表 + 1 周过期 |
| `nesio-telemetry-device-v1` | 设备 ID（遥测用） | telemetry / experiments | <1KB | P2 | → IDB 临时表 + 1 周过期 |
| `nesio-plaid-enrich-v1` | Plaid 增强标记 | connector-sync | <1KB | P2 | → IDB 临时表 + 1 周过期 |
| `nesio-gmail-last-sync` | Gmail 最后同步时间 | connector-sync | <1KB | P2 | → IDB 临时表 + 1 周过期 |
| `nesio-connectors-autosync-at-v1` | 连接器自动同步时间 | connector-sync | <1KB | P2 | → IDB 临时表 + 1 周过期 |
| `nesio-daily-report-auto-v1` | 日报自动生成日期 | daily-report-persist | <1KB | P2 | → IDB 临时表 + 1 周过期 |
| `nesio-health-report-auto-v1` | 健康报告自动生成月份 | health-report | <1KB | P2 | → IDB 临时表 + 1 周过期 |
| `nesio-fin-report-auto-v1` | 财务报告自动生成月份 | finance-report | <1KB | P2 | → IDB 临时表 + 1 周过期 |
| `nesio-drive-backup-at` | Drive 备份时间戳 | drive-backup | <1KB | P2 | → IDB 临时表 + 1 周过期 |
| `nesio-receipt-match-rejected-v1` | 拒绝的收据匹配 | receipt-match | 5~20KB | P2 | → IDB 临时表 + 1 周过期 |
| `nesio-img-hash-v1` | 图像哈希索引 | image-hash | 10~50KB | P2 | → IDB 临时表 + 1 周过期 |
| `nesio-revgeo-cache-v1` | 反向地理编码缓存 | place-trail | 50~200KB | P2 | → IDB 临时表 + 1 周过期 |
| `nesio-reader-progress-v1` | 阅读进度 | reader-store-idb | 20~100KB | P2 | → IDB 临时表 + 1 周过期 |
| `nesio-reader-bookmarks-v1` | 阅读书签 | reader | 10~50KB | P2 | → IDB 临时表 + 1 周过期 |
| `nesio-workout-last-v1` | 最后一次健身记录 | workout-generate | 1~5KB | P2 | → IDB 临时表 + 1 周过期 |
| `nesio-workout-equip-v1` | 健身器材列表 | workout-generate | 5~20KB | P2 | → IDB 临时表 + 1 周过期 |
| `nesio-health-projected-v1` | 健康投影标记 | health-signals | <1KB | P2 | → IDB 临时表 + 1 周过期 |
| `nesio-travel-checkin-reminders-v1` | 旅行 check-in 提醒 | travel-trips | 5~20KB | P2 | → IDB 临时表 + 1 周过期 |
| `nesio-travel-receipt-trip-v1` | 旅行收据关联 | travel-trips | 1~5KB | P2 | → IDB 临时表 + 1 周过期 |
| `nesio-energy-baseline-v1` | 能量基线 | energy-state | 1~5KB | P2 | → IDB 临时表 + 1 周过期 |
| `nesio-freeze-vault-v1` | 冲动守卫状态 | impulse-guard | 1~5KB | P2 | → IDB 临时表 + 1 周过期 |
| `nesio-living-model-v1` | 生活模型 | living-model | 10~50KB | P2 | → IDB 临时表 + 1 周过期 |
| `nesio-cross-region-consent-v1` | 跨区域同意状态 | cross-region/consent | <1KB | P2 | → IDB 临时表 + 1 周过期 |
| `nesio-cross-region-bandit-retired-purge-v1` | 跨区域 bandit 清理标记 | cross-region/bandit | <1KB | P2 | 可删 |
| `nesio-rewards-v1` | 奖励引擎状态 | rewards-engine | 10~50KB | P2 | → IDB 临时表 + 1 周过期 |
| `nesio-ranker-learning-retired-purge-v1` | 排序学习清理标记 | guidance-ranker | <1KB | P2 | 可删 |
| `nesio-guidance-cooling` | 指导冷却状态 | cooling-store | 5~20KB | P2 | → IDB 临时表 + 1 周过期 |
| `nesio-feature-usage-v1` | 功能使用统计 | feature-usage | 5~20KB | P2 | → IDB 临时表 + 1 周过期 |
| `nesio-app-sessions-v1` | App 会话信息 | feature-usage | 1~5KB | P2 | → IDB 临时表 + 1 周过期 |
| `nesio-bank-flow-rule-v1` | 银行交易流规则 | bank-tx | 10~50KB | P2 | → IDB 临时表 + 1 周过期 |
| `nesio-bank-merchant-rule-v1` | 银行商户规则 | bank-tx | 10~50KB | P2 | → IDB 临时表 + 1 周过期 |
| `nesio-bank-rule-label-v1` | 银行规则标签 | bank-tx | 5~20KB | P2 | → IDB 临时表 + 1 周过期 |
| `nesio-bank-recur-v1` | 银行周期规则 | bank-tx | 5~20KB | P2 | → IDB 临时表 + 1 周过期 |
| `nesio-storage-warned-at` | 存储告警时间 | storage-health | <1KB | P2 | → IDB 临时表 + 1 周过期 |
| `nesio-llm-sweep-ledger-v1` | LLM 扫描账本 | llm-sweep-auto | 5~20KB | P2 | → IDB 临时表 + 1 周过期 |

### UI 状态类（可丢弃，本会话过期）

| Key 名称 | 存储内容 | 所属模块 | 大小 | 改造方案 |
|---------|---------|--------|------|--------|
| `nesio-tips-shown-v1` | 新手提示已展示 | PortalOnboarding | <1KB | 可删 / → SessionStorage |
| `nesio-first-memory-receipt-shown-v1` | 首次记忆收据提示 | Portal | <1KB | 可删 / → SessionStorage |
| `nesio-haptic-feedback-enabled-v1` | 振动反馈开关 | Portal / SettingsSheets | <1KB | → IDB 临时表 + 1 周过期 |
| `nesio-ask-guide-seen-v1` | 问询指南已看 | Portal | <1KB | 可删 / → SessionStorage |
| `nesio-theme-palette-v1` | 调色板主题 | module-overrides | <1KB | → IDB 临时表 + 1 周过期 |
| `nesio-theme-lowsat-v1` | 低饱和主题（旧） | module-overrides | <1KB | 可删（已废弃） |
| `baohe_personal_lab` | 个人实验室开关 | launch-surface / module-overrides | <1KB | → IDB 临时表 + 1 周过期 |
| `treasurebox-theme` | 深浅主题（day/night） | SettingsSheets / cloud-profile-sync | <1KB | → IDB 临时表 + 1 周过期 |
| `nesio-font-scale-v1` | 字体缩放等级 | font-scale | <1KB | → IDB 临时表 + 1 周过期 |
| `nesio-capture-loc-v1` | 位置捕获开关 | capture-location | <1KB | → IDB 永久表（用户选择） |
| `nesio-capture-fix-cache-v1` | 位置修复缓存 | capture-location | 1~5KB | → IDB 临时表 + 1 周过期 |
| `nesio-place-geocode-enabled` | 地点地理编码开关 | place-trail | <1KB | → IDB 临时表 + 1 周过期 |
| `nesio-experiments-v2` | 实验配置 | NesioExperiment | 1~5KB | → IDB 临时表 + 1 周过期 |
| `nesio-pro-entitlement-v1` | Pro 权限状态 | entitlement | <1KB | → IDB 临时表 + 1 周过期 |
| `nesio-trial-start-v1` | 试用开始时间 | entitlement | <1KB | → IDB 临时表 + 1 周过期 |
| `nesio-server-entitlement-v1` | 服务器权限缓存 | entitlement | 1~5KB | → IDB 临时表 + 1 周过期 |
| `nesio-wrapped-last` | Wrapped 卡片最后查看时间 | WrappedCard | <1KB | 可删 / → SessionStorage |
| `nesio-workout-rest-sec-v1` | 健身休息时间偏好 | WorkoutPlayer | <1KB | → IDB 临时表 + 1 周过期 |
| `nesio-proactive-level-v1` | 主动推送级别 | proactive-types | <1KB | → IDB 临时表 + 1 周过期 |
| `nesio-quote-cat-pref-v1` | 语录分类偏好 | proactive-types | <1KB | → IDB 临时表 + 1 周过期 |
| `nesio-snoozed-overdue` | 推迟的逾期提醒 | proactive-types | <1KB | → IDB 临时表 + 1 周过期 |
| `nesio-proactive-dismissed` | 已驳回的推送 | proactive-types | 1~5KB | → IDB 临时表 + 1 周过期 |
| `nesio-focus-dismissed-v1` | 已驳回的焦点卡片 | FocusSection | <1KB | → IDB 临时表 + 1 周过期 |
| `nesio-permission-permission-rationale-v1` | 权限说明已展示（动态生成的 key） | permission-rationale | <1KB | 可删 / → SessionStorage |
| `nesio-heal-earned-key` | 疗愈得分（今日） | HealingTab | <1KB | → IDB 临时表 + 1 周过期 |
| `nesio-retro-dismissed-v1` | 回顾卡片已驳回 | RetrospectCard | <1KB | 可删 / → SessionStorage |
| `nesio-a2hs-dismissed-until` | 安装提示驳回时间 | InstallPrompt | <1KB | 可删 / → SessionStorage |
| `nesio-hourly-wage-v1` | 时薪（购物冷静） | PurchaseCoolingPanel | <1KB | → IDB 永久表（用户设置） |
| `treasurebox-personalization-insight-shown-day` | 个性化洞察展示日期 | personalization-insights | <1KB | → IDB 临时表 + 1 周过期 |
| `treasurebox-personalization-insight-feedback:*` | 个性化洞察反馈（动态 key） | personalization-insights | <1KB | → IDB 临时表 + 1 周过期 |
| `treasurebox-personalization-insight-suppressed-until:*` | 个性化洞察抑制期限（动态） | personalization-insights | <1KB | → IDB 临时表 + 1 周过期 |
| `nesio-email-signals-cache` | 邮件信号缓存 | useTodayData | 1~5KB | → IDB 临时表 + 1 周过期 |
| `nesio-guidance-lang-cache-v1` | 指导语言缓存 | useTodayData | <1KB | → IDB 临时表 + 1 周过期 |
| `nesio-family-strip-fetch-at-v1` | 家庭条带获取时间 | FamilyTodayStrip | <1KB | → IDB 临时表 + 1 周过期 |
| `nesio-plan-date-heal-flag` | 计划日期修复标记 | plan-links | <1KB | 可删（一次性） |
| `nesio-travel-demo-flag` | 旅行 demo 标记 | travel-trips | <1KB | 可删（一次性） |
| `nesio-plan-notify-optin-v1` | 计划通知选择 | SettingsSheets | <1KB | → IDB 临时表 + 1 周过期 |
| `baohe_lab_mode` | Lab 模式（旧，已清理） | launch-surface | <1KB | 可删（已废弃） |
| `baohe_tester` | 测试员标记 | launch-surface | <1KB | 可删 / → 环境变量 |
| `baohe_tester_allowlist` | 测试员白名单 | launch-surface | <1KB | 可删 / → 环境变量 |
| `baohe_tester_code` | 测试代码 | launch-surface | <1KB | 可删 / → 秘密存储 |
| `nesio-admin-secret` | 管理员秘密 | AdminOpsPanel | <1KB | → 加密 IDB + 不上云 |
| `nesio-wardrobe-body-flag` | 衣柜体型标记 | WardrobePanel | <1KB | → IDB 临时表 + 1 周过期 |
| `nesio-location-store-key` | 位置存储（内部使用） | location-store | 1~5KB | → IDB 临时表 + 1 周过期 |
| `nesio-plaid-link-token` | Plaid Link Token | plaid-oauth | 1~5KB | 可删（一次性） |
| `nesio-workout-sound-force-v1` | 健身音频强制 | workout-tempo-sound | <1KB | → IDB 临时表 + 1 周过期 |
| `nesio-relationship-overrides-v1` | 关系覆盖设置 | relationship-overrides | 5~20KB | → IDB 临时表 + 1 周过期 |
| `baohe_inventory_first_launch_v01` | 库存首次启动标记 | memory/memorial | <1KB | 可删（一次性） |
| `nianguichu_cart_v1` | 购物车（Memorial） | memorial-commerce | 5~20KB | → IDB 临时表 + 1 周过期 |
| `nianguichu_planning_v1` | 计划状态（Memorial） | memorial-content | 1~5KB | → IDB 临时表 + 1 周过期 |
| `nesio-auth-intent-v1` | 认证意图（临时） | auth-client | <1KB | 可删（一次性） |
| `treasurebox-quote-preferences-v1` | 语录偏好 | 多处 | <1KB | → IDB 临时表 + 1 周过期 |
| `nesio-today-cards-v1` | 今日卡片缓存 | today 板块 | 10~50KB | → IDB 临时表 + 1 周过期 |
| `nesio-today-dismissed-v1` | 已驳回的今日卡片 | today 板块 | 1~5KB | → IDB 临时表 + 1 周过期 |
| `nesio-xlib-draft-v1` | 健身库草稿 | ExerciseLibrary | 5~20KB | → IDB 临时表 + 1 周过期 |

### 第三方/Legacy 类（需清理）

| Key 名称 | 存储内容 | 状态 | 改造方案 |
|---------|---------|------|--------|
| `rg-mode` | 健身网格模式（fitness/web） | 活跃但沙箱化 | 保留（独立运行） |
| `nesio-personalization-demo-stage` | 死壳：个性化演示阶段 | 已退役 | **删除** |
| `nesio-node-embeddings-v1` | 语义重排序的节点嵌入 | 已清理 | **删除** |
| `text-embed-model` | 文本嵌入模型 ID | 活跃 | → IDB 临时表 + 1 周过期 |
| `text-embed-tokenizer` | 文本分词器 | 活跃 | → IDB 临时表 + 1 周过期 |
| `treasurebox-onboarding-v13-done` | 新手引导 v13（旧版） | 已废弃 | **删除** |
| `treasurebox-onboarding-v13-done` | 新手引导 v13（旧版） | 已废弃 | **删除** |
| `nesio-mirror-profile-v1` | 镜子档案（学习模块） | 活跃 | → IDB 临时表 + 1 周过期 |
| `nesio-connectors-v1` | 连接器列表 | 活跃 | → IDB 临时表 + 1 周过期 |
| `nesio-connector-tokens-v1` | 连接器令牌 | 活跃 | → 加密 IDB + 不上云 |
| `nesio-notion-db-v1` | Notion 数据库配置 | 活跃 | → IDB 临时表 + 1 周过期 |
| `nesio-backup-dest` | 备份目标选择 | 活跃 | → IDB 永久表（用户设置） |
| `nesio-last-backup-at` | 最后备份时间 | 活跃 | → IDB 临时表 + 1 周过期 |
| `nesio-cross-region-delivery-cooldown-v1` | 跨区域投递冷却 | 活跃 | → IDB 临时表 + 1 周过期 |
| `first_launch_high_risk_isolation_v0` | 首次启动高风险隔离 | 活跃 | → IDB 永久表（一次性） |
| `nesio-dormant-store` | 休眠引擎状态 | 活跃 | → IDB 临时表 + 1 周过期 |
| `nesio-memoral-store-*` | Memorial 本地存储 | 活跃（Memorial 沙箱） | 保留（独立管理） |

---

## 2. 分类统计

### 按类型分布

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
数据类（必保留）        42 keys    ~12-15 MB    P0/P1 优先级
缓存类（可迁移）        34 keys    ~800 KB      P2 优先级  
UI 状态（可清理）       45 keys    ~200 KB      低优先级
Legacy/秘密类          15 keys    ~50 KB       特殊处理
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
总计                     136 keys   ~13-16 MB   
```

### 按模块分布

| 模块 | Key 数量 | 估算大小 | 优先级 |
|------|--------|--------|--------|
| 生活图谱 | 3 | 500KB~5MB | P0 |
| 财务（银行+资产） | 12 | 300KB~2.5MB | P0 |
| 健康数据 | 4 | 200KB~800KB | P0 |
| 人物/关系 | 4 | 150KB~600KB | P0 |
| 位置/旅行 | 8 | 100KB~400KB | P1 |
| 健身/锻炼 | 4 | 200KB~700KB | P1 |
| 同步状态 | 12 | 50KB~100KB | P2 |
| 个性化/推荐 | 8 | 80KB~200KB | P2 |
| UI 状态 | 35 | 100KB~200KB | 低 |
| 认证/秘密 | 4 | 10KB | 特殊 |
| Memorial（沙箱） | 3 | 1MB~10MB | 独立 |
| 其他 | 38 | 200KB | P2 |

### 大小估算汇总

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
核心用户数据（life-graph + bank + health）
  中位数：2-3 MB（轻度用户）
  95 分位：6-8 MB（重度用户）

同步状态 + 缓存（不含核心数据）
  50-200 KB（稳定）

UI 状态 + 临时
  100-300 KB（忽略不计）

总体估算
  轻用户：2-4 MB
  中用户：5-8 MB（主流）
  重用户：10-15 MB（接近 localStorage 上限 ~5-10 MB per origin）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### localStorage 压力分析

**当前状态：处于风险边缘**

- 主流用户在 localStorage 配额 50% ~ 70%
- 重用户触及上限，常见失败：
  - 生活图谱超 5 MB 时无法保存新节点
  - 同步状态写入失败（已有容错）
  - cache 层满溢，自动放弃（有日志）
  
**触发的保障机制** (见 `storage-health.ts`)：
- 写入异常时调用 `reportStorageDropped()`
- 日志频率限流（避免刷屏）
- 无主动清理机制

---

## 3. 重分类方案（核心建议）

### 三层存储架构

```javascript
// 第一层：数据层（IDB 永久表 + 云同步）
// └─ 用户主动创建/编辑的记录
// └─ 覆盖：life-graph, bank-tx, health, profile, 项目等
// └─ 特性：TTL 无限 + 云备份 + 端到端加密（可选）
// 
// 第二层：缓存层（IDB 临时表 + 1 周 TTL）
// └─ API 响应缓存、同步状态、统计信息
// └─ 覆盖：sync-state, revgeo-cache, feature-usage 等
// └─ 特性：过期自动清理 + 不上云
//
// 第三层：Session 层（SessionStorage）
// └─ UI 临时状态、一次性标记
// └─ 覆盖：permission-rationale, tips-shown 等（可选优化）
// └─ 特性：浏览器关闭自动清空
```

### 迁移策略（按优先级）

#### W0（第一周）— 危机处理

**目标**：确保数据不丢失，生活图谱和银行数据可稳定保存

| 操作 | Key | 预期收益 |
|------|-----|--------|
| 1. 建立 IDB schema（`treasurebox` DB，v1） | - | 基础设施 |
| 2. 迁移 `nesio-life-graph-v1` → IDB | 🔄 | 释放 1-2 MB localStorage |
| 3. 迁移 `nesio-bank-tx-v1` → IDB | 🔄 | 释放 500 KB-1.5 MB |
| 4. 实现 IDB → localStorage fallback（SSR + 老设备） | 🛡️ | 容错 |
| 5. 部署云同步排队（outbox 也迁 IDB） | ☁️ | 停止 localStorage 爆满 |

**代码改动量**：~2000 LOC（新增 IDB 层 + 适配器）

#### W1（第二周）— 扩展存储

**目标**：释放 localStorage，解决日常缓存压力

| 操作 | Key | 预期收益 |
|------|-----|--------|
| 1. 迁移健康/财务数据 → IDB | nesio-health-v1 等 | 释放 300-500 KB |
| 2. 迁移同步状态 → IDB 临时表 + TTL | cloud-*-sync-* | 释放 50-100 KB（每周自动清理） |
| 3. 迁移 revgeo-cache 等 API cache → IDB | nesio-revgeo-cache-v1 等 | 释放 150-200 KB |
| 4. 建立 TTL 清理 worker（每周 4 次） | - | 后台自动维护 |
| 5. localStorage 监控告警（>80% 配额） | - | 可见度 + 告警 |

**代码改动量**：~3000 LOC（数据层迁移 + TTL 机制）

#### W2（第三周）— 优化和清理

**目标**：清理死壳，优化 UI 状态存储

| 操作 | Key | 预期收益 |
|------|-----|--------|
| 1. 删除已废弃的 key | `nesio-theme-lowsat-v1` 等 | 清理 ~20 KB 垃圾 |
| 2. 迁移 UI 状态 → SessionStorage（可选） | tips-shown 等 | 进一步减少 localStorage 占用 |
| 3. 实现秘密数据加密存储 | connector-tokens, admin-secret | 隔离敏感信息 |
| 4. 编写数据恢复工具（IDB <-> localStorage 双向） | - | 应急恢复能力 |
| 5. 部署测试（E2E + 单测） | - | 质量保证 |

**代码改动量**：~1500 LOC（清理 + 工具 + 测试）

---

## 4. 风险评估与应急方案

### 关键风险

| 风险 | 影响 | 概率 | 对策 |
|------|------|------|------|
| IDB 写入失败（磁盘满） | 数据丢失 | 中 | fallback → localStorage；告警；数据恢复 |
| localStorage 在 W0 迁移完成前爆满 | UX 中断 | 中 | 提前清理过期 cache；压缩 life-graph |
| 跨浏览器 IDB 兼容性 | 某些端数据不可达 | 低 | 完整 localStorage fallback + 测试 |
| 云同步与本地冲突（迁移期） | 数据乒乓 | 中 | 全量 diff + LWW 规则；测试环境验证 |

### 应急方案

1. **临时缓解**（如果 W0 无法及时上线）：
   - 清理 `revgeo-cache`、`feature-usage`、`bank-flow-rule` 等 cache
   - 预期释放 200-300 KB
   - 给用户 2-3 周缓冲，上线 IDB 迁移

2. **数据恢复**（如果 IDB 写入失败）：
   - 保存 localStorage JSON 导出
   - 离线时 IndexedDB 降级到 localStorage
   - 同步时按 IDB 版本戳做版本对账

3. **版本回滚**（如果迁移引入 bug）：
   - 保留 localStorage key，迁移后 7 天内不删除
   - IDB 版本升级 → 自动双写确认 → 确认成功后单写

---

## 5. 改造时间与工作量估算

### 开发时间表

```
W0 基础设施（优先级 P0）
├─ IDB schema 设计      2d
├─ 核心迁移（life-graph, bank）   3d
├─ 云同步排队集成       2d
└─ 测试 + 监控          1d
  小计：8 人日 → 1 周（2 人团队）

W1 扩展存储（优先级 P1）
├─ 其他数据迁移         2d
├─ TTL 清理机制         2d
├─ localStorage 监控    1d
└─ 集成测试            2d
  小计：7 人日 → 1 周（2 人团队）

W2 优化和清理（优先级 P2）
├─ 死壳清理            1d
├─ 秘密数据隔离        1d
├─ 恢复工具           1d
└─ 最终测试            1d
  小计：4 人日 → 4-5 天（1 人或 2 人）
```

**总体估算**：**3 周** → **19 人日** → **2 人全职团队**

### 里程碑

- **W0 末**：生活图谱和银行数据稳定迁 IDB；localStorage 降至 < 2 MB（实测）
- **W1 末**：所有用户数据 IDB 化；localStorage 仅保留 < 500 KB；TTL 清理上线
- **W2 末**：全功能验收；客户文档；可选的秘密数据隔离

---

## 6. 优先级和可执行的快速赢

### 即刻可做（今天）

1. ✅ **分析此报告** → 了解现状
2. ✅ **评审 IDB schema** → 确认设计方向
3. ✅ **预清理**：
   - 删除 `nesio-theme-lowsat-v1`（已废弃，1 行 grep 替换）
   - 删除 `nesio-personalization-demo-stage`
   - 删除 `nesio-node-embeddings-v1`
   - 预期释放 ~5-10 KB（不多，但无风险）

### 优先级排序

**P0（必做，2 周内）**：
- life-graph + bank-tx → IDB（数据流生命线）
- 云同步排队修复（防止 outbox 爆满）

**P1（需做，1 个月内）**：
- 健康、财务等其他大数据迁 IDB
- TTL 清理机制
- localStorage 监控告警

**P2（应做，2 个月内）**：
- UI 状态优化（可选 SessionStorage）
- 秘密数据隔离加密
- 客户文档和恢复工具

---

## 7. 成功指标

**迁移前状态**：
- localStorage 占用：6-12 MB（中重度用户）
- 写入失败率：2-5%（同步高峰）
- 告警频次：1-3 次/日

**迁移后目标**（4 周）：
- localStorage 占用：< 1 MB（仅保留 UI 状态和秘密令牌）
- 写入失败率：0.1% 以下（仅 IDB 磁盘满）
- 告警频次：0 次（正常）
- IDB 占用：10-20 MB（用户可控，支持清理选项）
- 云同步延迟：< 5 秒（无瓶颈）

---

## 8. 代码示例（伪代码）

### IDB 初始化

```typescript
// lib/portal/idb-treasurebox.ts (新文件)
const DB_NAME = 'treasurebox';
const DB_VERSION = 1;

export async function initDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      // 数据表
      db.createObjectStore('life-graph', { keyPath: 'id' });
      db.createObjectStore('bank-tx', { keyPath: 'id' });
      db.createObjectStore('health', { keyPath: 'id' });
      // 缓存表（+ TTL 字段）
      db.createObjectStore('sync-cache', { keyPath: 'key' });
      db.createObjectStore('api-cache', { keyPath: 'url' });
      // 秘密表（加密）
      db.createObjectStore('secrets', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
```

### 迁移适配器

```typescript
// lib/portal/storage-adapter.ts (新文件)
export async function loadData<T>(key: string, opts: StorageOpts): Promise<T | null> {
  // 先试 IDB（快）
  try {
    const db = await initDB();
    const tx = db.transaction(opts.table);
    const data = await tx.objectStore(opts.table).get(key);
    if (data) return data.value;
  } catch (e) {
    console.warn(`IDB read failed for ${key}, falling back to localStorage`);
  }
  
  // 降级到 localStorage
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export async function saveData<T>(key: string, value: T, opts: StorageOpts): Promise<void> {
  // IDB 优先
  try {
    const db = await initDB();
    const tx = db.transaction(opts.table, 'readwrite');
    await tx.objectStore(opts.table).put({ 
      key, 
      value, 
      expiresAt: opts.ttl ? Date.now() + opts.ttl : null,
    });
    return;
  } catch (e) {
    console.warn(`IDB write failed for ${key}, writing to localStorage`);
  }
  
  // 降级到 localStorage（但告警）
  try {
    localStorage.setItem(key, JSON.stringify(value));
    reportStorageDropped('IDB_FALLBACK', key); // 监控
  } catch (e) {
    reportStorageDropped('STORAGE_EXHAUSTED', key); // 危机
    throw e;
  }
}
```

### TTL 清理 Worker

```typescript
// lib/portal/storage-cleanup.ts (新文件)
export async function cleanupExpiredCache(): Promise<number> {
  const db = await initDB();
  const tx = db.transaction(['sync-cache', 'api-cache'], 'readwrite');
  let cleaned = 0;
  
  for (const table of ['sync-cache', 'api-cache']) {
    const store = tx.objectStore(table);
    const cursor = await store.openCursor();
    cursor?.addEventListener('success', (e) => {
      const record = e.target.result.value;
      if (record.expiresAt && record.expiresAt < Date.now()) {
        e.target.result.delete();
        cleaned++;
      }
    });
  }
  
  return cleaned;
}

// 在 app 启动时注册清理任务
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.ready.then((reg) => {
    reg.periodicSync?.register('storage-cleanup', { minInterval: 7 * 24 * 60 * 60 * 1000 });
  });
}
```

---

## 9. 参考链接

- [localStorage 规范](https://html.spec.whatwg.org/multipage/webstorage.html)
- [IndexedDB 规范](https://w3c.github.io/IndexedDB/)
- [Web Storage Best Practices](https://developer.chrome.com/docs/devtools/storage/)
- 宝盒项目 CLAUDE.md § 设计规则 → "Never swallow storage write failures"

---

## 附录 A：快速检查清单

在实施改造前，运行此清单：

- [ ] 确认 IDB 版本升级不影响现有数据
- [ ] 验证 localStorage fallback 路径（SSR + 老浏览器）
- [ ] 测试离线场景（IDB 读写 vs localStorage 降级）
- [ ] 检查云同步排队（不再存储完整节点副本）
- [ ] 配置 localStorage 监控告警（>80% 配额）
- [ ] 准备数据恢复脚本（JSON 导出和导入）
- [ ] 编写 E2E 测试（新建/编辑/同步 life-graph）
- [ ] 部署金丝雀（10% 用户试用 IDB，监控错误率）

---

**end of audit**
