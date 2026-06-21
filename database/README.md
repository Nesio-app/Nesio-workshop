# 宝盒模块数据库（本地骨架）

本目录提供本地 SQLite 数据库 scaffold，用于 module-data-network 的本地数据打通验证。

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

## 环境变量
- `BAOHE_DB_PATH`：SQLite 文件路径（默认 `./database/treasurebox-local.db`）
- `TREASUREBOX_MODULE_DATA_DB`：`true/false` 控制 API 是否读取 DB（默认 true）
- `report:external-bridge` 使用 `DB` 时会回显 `external_connection` 状态，用于确认外部连接桩准备完成。

## Supabase 云数据库准备
- `schema/supabase-profile-settings-v1.sql`：账号设置云同步表。启用 `CLOUD_DB_ENABLED=true` 前，需要先在 Supabase SQL Editor 手动执行。
- `schema/supabase-inventory-items-v1.sql`：Inventory personal 快照表。启用前同样需要手动执行；当前只支持用户显式触发的 cloud snapshot，不做后台自动同步。
- 当前云 profile API 只读写 `public.profile_settings.settings` 的 allowlist 字段；服务端保管 service role key，浏览器不会接触密钥。
- 当前云 inventory API 只读写 `LocalInventoryItem@v1` personal mode 的 allowlist 字段；demo 数据不会写入云端，支付/银行卡/收据导入/财务建议字段会被拒绝。
- RLS 规则限制普通 authenticated 用户只能访问自己的 `user_id` 行；服务端 route 仍会先通过 `baohe_auth_access` 校验当前用户。

## 说明
- 当前只做本地 demo scaffold，不涉及真实用户数据持久化。
- 真实外部服务、Notion 写入与生产数据库需单独审批并单独接入。
