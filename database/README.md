# Nesio 产品数据 backend

本目录同时承载本地 SQLite scaffold 与 Supabase 产品 backend v1 schema。SQLite 用于 module-data-network 的本地数据打通验证；Supabase Auth / Postgres / Storage 用于真实账号、Memory、Inventory、头像和图片资产的产品数据承接。

## 目录
- `migrations/`：按顺序执行的 SQLite 建表/变更脚本
- `schema/`：当前 schema 说明参考文件
- `seeds/`：保留，当前未使用，供未来扩展
- `treasurebox-local.db`：本地数据库文件（已加入 .gitignore，不提交）

## 常用命令
- `npm run db:bootstrap`：一键初始化 DB 并入库 demo scaffold
- `npm run db:bootstrap:full`：全量初始化（migrate + seed-demo + sync artifact records + status）
- `npm run db:migrate`：仅执行新增 migration（幂等）
- `npm run db:seed-demo`：将 `public/portal-config.json` 与内置 registry 映射写入 DB
- `npm run report:external-bridge`：输出外部打通清单（contract + DB 状态）
- `npm run db:queue`：输出 CEO / handoff / gate 运营队列快照（用于本地调度）
- `npm run db:sync-artifact-records`：从 `scripts/report-module-registry.mjs` 的 `localDataRecords` 同步 `artifact / handoff / gate` 到本地 SQLite
- `npm run db:status`：打印当前 schema 与记录数
- `npm run db:flow`：打印当前数据连通图（模块 -> 模块 + dataKey），用于核对跨模块数据流
- `npm run db:down`：回滚最近一次 migration
- `npm run db:probe`：与 status 同功能，用于运维检查
- `npm run cloud:supabase:preflight -- --offline`：启用真实 Supabase 产品 backend 前的离线预检，核对 DB/Storage env 与全部 schema 文件但不访问网络
- `npm run cloud:supabase:schema:bundle -- --check`：检查 Supabase Backend v1 canonical schema bundle 是否可生成，不写文件、不访问网络
- `npm run cloud:supabase:schema:bundle -- --write`：生成 `database/schema/supabase-backend-v1-bundle.sql`，供人工在 Supabase SQL Editor 审核/应用
- `npm run cloud:supabase:preflight -- --live --strict`：在 Supabase env 配好后检查云端 REST 表与 Storage bucket 是否可访问；输出会隐藏所有密钥

## 环境变量
- `BAOHE_DB_PATH`：SQLite 文件路径（默认 `./database/treasurebox-local.db`）
- `TREASUREBOX_MODULE_DATA_DB`：`true/false` 控制 API 是否读取 DB（默认 true）
- `report:external-bridge` 使用 `DB` 时会回显 `external_connection` 状态，用于确认外部连接桩准备完成。

## Supabase 产品 backend 准备
- 当前产品 backend v1 的身份源是 Supabase Auth；产品数据层由 Supabase Postgres + Supabase Storage 承接。
- 打开真实云端前，必须先手动应用 schema bundle；bundle 会创建/收敛私有 `nesio-product-assets` Storage bucket 合同与 `storage.objects` owner-prefix policies。preflight 只读检查，不会创建表、bucket 或迁移真实数据。
- 必需 DB env：`CLOUD_DB_ENABLED=true`、`SUPABASE_URL`、`SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY`。
- 必需 Storage env：`CLOUD_STORAGE_ENABLED=true`、`SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`、`SUPABASE_STORAGE_BUCKET=nesio-product-assets`。
- `npm run cloud:supabase:schema:bundle -- --check` 会只读取 canonical schema 文件并报告 `ignoredDuplicatePaths`，用于确认 Finder 复制出来的 `* 2.sql` 旧文件不会进入 Backend v1 bundle。
- `npm run cloud:supabase:schema:bundle -- --write` 会生成 `database/schema/supabase-backend-v1-bundle.sql`，但不会创建表、bucket 或迁移真实数据；真实云端应用仍需人工审核并走 CEO Gate。
- `npm run cloud:supabase:preflight -- --offline --json` 会输出 `schemaFiles`、`storage`、`summary.readyForProductBackend`，用于本地和 CI 静态检查。
- `npm run cloud:supabase:preflight -- --live --strict` 会用 service role 只读探测 `user_profiles / profile_settings / inventory_items / memory_nodes / memory_edges / memory_assets / product_events / signals` 以及 Storage bucket；失败时退出非 0。
- `schema/supabase-user-profiles-v1.sql`：Nesio 产品账号资料表。启用前需要手动执行；当前用于把 Supabase Auth 用户镜像成产品可读的 `displayName / avatarUrl / provider / onboarding` 等资料，不保存密钥，不给匿名用户创建云端资料。
- `schema/supabase-profile-settings-v1.sql`：账号设置云同步表。启用 `CLOUD_DB_ENABLED=true` 前，需要先在 Supabase SQL Editor 手动执行。
- `schema/supabase-inventory-items-v1.sql`：Inventory personal 快照表。启用前同样需要手动执行；当前只支持用户显式触发的 cloud snapshot，不做后台自动同步。
- `schema/supabase-memory-v1.sql`：Memory / Life Graph 云同步表，包含 `memory_nodes`、`memory_edges`、`memory_assets`。启用前需要手动执行；当前 API 支持登录用户读写、导出读取和显式全量软删除，不做匿名写入，也不自动迁移本地历史数据。
- `schema/supabase-storage-v1.sql`：Supabase Storage 私有资产 bucket 与 owner-prefix policies。启用前需要手动执行；bucket 固定为 `nesio-product-assets`，不得公开读取。头像、Memory 图片、音频、PDF 和附件通过服务端 route 上传，读取只返回短期 signed URL。
- `schema/supabase-product-events-v1.sql`：产品反馈 / 交互事件表，当前用于 Today 卡片反馈等轻量学习信号。启用前需要手动执行；当前只记录登录用户显式交互，不记录匿名事件，不自动触发通知、外部动作或 Agent 执行。
- `schema/supabase-signals-v1.sql`：Signal 数据原子表，当前用于双写期 mirror voice / photo / calendar / gmail / health / task / weather 的标准化事实。启用前需要手动执行；当前不改变 Memory / LifeGraph / Today 的读路径，不做主表切换。
- 云表都使用 `identity_key` 作为服务端写入主键：Supabase 邮件 / Google / 电话用户映射为 `supabase:<uuid>`，已授权的第三方身份可映射为对应 provider key；`user_id` 仍保留为 Supabase `auth.users` 关联字段。
- 当前云 account API 读写 `public.user_profiles`，用于产品层账号资料；Supabase Auth 仍是身份源，`user_profiles` 是产品可展示/可同步资料源。
- 当前云 profile API 只读写 `public.profile_settings.settings` 的 allowlist 字段；服务端保管 service role key，浏览器不会接触密钥。
- 当前云 inventory API 只读写 `LocalInventoryItem@v1` personal mode 的 allowlist 字段；demo 数据不会写入云端，支付/银行卡/收据导入/财务建议字段会被拒绝。
- 当前云 memory API 只读写 `LifeNode@v1` 的 allowlist 字段和图片/文件等 asset metadata；正文、标签、来源和关系边会被清洗后写入云端。
- `/api/cloud/assets` 提供头像、Memory 图片、附件等文件的 Supabase Storage 上传入口；启用前需要设置 `CLOUD_STORAGE_ENABLED=true`、`SUPABASE_STORAGE_BUCKET=nesio-product-assets`，并应用 `schema/supabase-storage-v1.sql`。上传只返回 `storagePath` 与 `requiresSignedUrl=true`；读取时使用同一路由的 GET signed URL，不要求 bucket 公开。GET 会校验登录用户只能读取自己 `identity_key` 前缀下的对象，并返回短期 `signedUrl`。
- `/api/cloud/events` 提供产品事件写入/读取入口；启用前需要 `CLOUD_DB_ENABLED=true` 和 Supabase env。Today 卡片反馈会在本地学习后 best-effort 写入该接口，云端失败不会阻塞本地使用。
- `/api/user-data/export` 在未登录或云未配置时保持本地 mock contract；登录且云 DB 可用时会导出 `user_profiles / profile_settings / memory_nodes / memory_edges / memory_assets / inventory_items / product_events`，并显式标记 `includesRealUserData=true`。导出会附带当前用户 `identity_key` 前缀下的 Storage object 引用清单，但不会把私有文件转成长期公开 URL；文件读取仍走 `/api/cloud/assets` 短期 signed URL。
- `/api/user-data/delete` 在未登录或云未配置时保持本地 dry-run contract；登录且云 DB 可用时会先 dry-run 统计 User Profiles + Profile Settings + Memory + Inventory + Product Events 云数据，并读取 `memory_assets.asset.storagePath` 与 `profile_settings.settings.avatarStoragePath` 对应的 Supabase Storage object 清单。真实删除必须传入 `confirmation: "DELETE_CLOUD_PRODUCT_DATA"`，避免误删；旧的 memory-only 确认词不适用于完整产品数据删除。
- 真实删除云数据时会先删除当前 `identity_key` 前缀下的 Storage object，再删除 Postgres 行，避免留下头像/图片/附件孤儿文件。若存在待删 Storage object 但缺少 `SUPABASE_STORAGE_BUCKET` 或 `CLOUD_STORAGE_ENABLED=true`，接口会 fail-closed 返回 `storage_bucket_required`，不会只删表行。
- RLS 规则限制普通 authenticated 用户只能访问自己的 `user_id` 行；服务端 route 会先校验登录 cookie，再用 service role 按 `identity_key` 读写，避免外部 provider 身份直接暴露给浏览器。

## 说明
- 当前只做本地 demo scaffold，不涉及真实用户数据持久化。
- 真实外部服务、Notion 写入与生产数据库需单独审批并单独接入。
