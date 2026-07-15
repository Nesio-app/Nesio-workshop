# 隐私审计 2026-07(Nesio / 宝盒)

范围:健康 / 财务 / 位置等敏感数据流向哪些外部;导出是否全覆盖、删除是否真删干净;
PII 进 AI / 遥测的围栏。扫描对象为 origin/main 当前部署版,不开重型 workflow。

结论:发现并修复一处**真缺口**——记忆照片游离在导出与删除之外(用户「删除全部」
后照片仍留在本机、「导出全部数据」漏图)。其余数据流的围栏经核查基本到位;剩两处
低危欠账登记在案(Notion 断连不撤销、Gmail 无限流),不阻断本次。

---

## 1. 数据流地图(敏感数据去哪了)

| 数据类 | 本机存储 | 云端 | 出网到第三方 |
|---|---|---|---|
| 健康 / 财务 / 位置 | IndexedDB `nesio-blobs`(blob store) | Supabase 对应表,**RLS 保护** | 不主动出网 |
| 记忆照片 | IndexedDB **`nesio-images`(独立 DB)**,压缩 JPEG dataURL | 仅当拍照时上传原图到云资产;本机备份需显式带图 | 问一问图片问答时 base64 进 Claude/Gemini(用户主动触发) |
| 生命图谱 / 节点 | IndexedDB `nesio-life-graph-v1` | 云备份(付费)/ Google Drive(免费) | 抽取 & 聊天时节点文本进 AI(带围栏) |
| Notion token | 内部集成 token 存 localStorage(老用法) | OAuth access_token 存 httpOnly cookie + Supabase integrations | 查询时 Bearer 发 api.notion.com |
| 遥测 | — | `/api/telemetry` | prop 值 `slice(0, MAX_PROP_CHARS=80)` 截断,不带长文本 |

关键事实:**记忆照片存在独立 IDB(`nesio-images`),不在 `nesio-blobs` 里**。备份的
`collectIdbBlobs` 和清空的 `purgeIdbBlobs` 都只读 `nesio-blobs`——照片因此两头漏。

---

## 2. 修复:记忆照片纳入导出 + 删除(本次)

**缺口**:
- 删除:`clearAllLocalData()`(「清空本地数据」)只清 `nesio-blobs` + localStorage,
  照片留在设备上——用户要求删除却没删干净。
- 导出:`exportFullBackup()` / Drive 全量备份只打包 `nesio-blobs`,照片不在包里——
  换机 / 恢复后照片丢失,「导出你的全部数据」名不副实。

**修复**(`lib/portal/local-image-store.ts` 新增三个收口函数):
- `purgeLocalImages()` — 清空 `nesio-images`,返回删除条数。
- `collectLocalImages()` — 收集 assetId → dataUrl,供备份带走。
- `restoreLocalImages(map)` — 恢复时按 assetId 写回。

接线:
- `SettingsSheets.clearAllLocalData` → `void purgeLocalImages()`(删除全覆盖)。
- `cloud-backup.buildCombinedBackup({ includeImages })` → 照片以 `local-image:` 前缀
  进 entries;`SettingsSheets.exportFullBackup` 与 `drive-backup` 传 `includeImages: true`。
  默认导出(如云周期备份)**不带图**,避免体积撑爆。
- `restoreCombinedBackup` 按 `local-image:` 前缀分流回 `restoreLocalImages`,
  不落 localStorage / blob IDB;`CombinedRestoreResult.imagesRestored` 如实计数,
  恢复提示里显示「含 N 张照片」。

**契约锁**:`scripts/cloud-backup.test.mjs` 加两例——
(11)`includeImages` 才带图、默认不带;(12)`local-image:` 路由到 `restoreLocalImages`、
不落 localStorage/blob、`imagesRestored` 计数正确。四门全绿(tsc/build/contracts/security)。

---

## 3. 核查通过(围栏到位,无需改动)

- **遥测截断**:`MAX_PROP_CHARS = 80`,`v.slice(0, MAX_PROP_CHARS)` 强制执行,
  不会把健康 / 财务长文本带进遥测。
- **聊天注入围栏**:portal/chat 对外部内容有 fencing,PII 进 AI 是用户主动触发且加围栏。
- **Notion cookie**:`httpOnly` + `sameSite: lax` + `secure`(生产)——不可被 JS 读、
  不随跨站请求泄漏。此前「secure 未确认」经查已确认为真。
- **核心云表 RLS**:健康 / 财务 / 位置对应表有 RLS;anon key 是公开设计,RLS 是唯一防线。
  上一轮已补 `analyst_daily` / `analyst_feedback` 的 RLS(待用户在 Supabase 重跑 SQL)。

---

## 4. 剩余欠账(登记,不阻断)

- **S2 · Notion 断连不撤销** —— ✅ 已修(批次213)。ConnectorsHub `disconnect('notion')` 调
  `DELETE /api/portal/integrations?provider=notion` 清 httpOnly `nesio_notion_access` cookie +
  Supabase 集成行 + 本机选中的 DB。根因是 DELETE 路由的 cookie 名硬编码 gmail/calendar(notion/
  tesla/granola 全误删日历 cookie、真 cookie 留活),已改用规范 `integrationCookieNames(provider)`。
  注:Notion 无公开 token 撤销端点,彻底移除仍需用户在 Notion 集成设置删授权(UI 文案已点明)。
- **Gmail 无限流**(可用性 > 隐私):Gmail 拉取路由缺限流,非隐私缺口,顺带记一笔。
- **澄清**:`module-data-network-v1.sql` 是**本机 SQLite 治理注册表**(dev 工具),
  非 Supabase 云用户数据——不构成云端 RLS 暴露。此前误记为「15 表缺 RLS」,更正。

---

## 5. 待用户侧动作

- Supabase 重跑 analyst 表 RLS:`ALTER TABLE analyst_daily ENABLE ROW LEVEL SECURITY;`
  同 `analyst_feedback`(见 `docs/governance/analyst-schema.sql`)。
- 与本次隐私修复无关但仍挂着:Vercel 替换泄漏的 `NOTION_CLIENT_SECRET` /
  `ANTHROPIC_API_KEY` 后 Redeploy(见 `docs/design/security-audit-2026-07.md`)。
