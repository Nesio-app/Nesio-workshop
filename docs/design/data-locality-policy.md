# 数据 Locality / 离线政策

> 2026-07-26 · 审计洞 #5  
> 代码：`lib/portal/locality.ts` · 叙事对齐 [SYSTEM-LOGIC.md](./SYSTEM-LOGIC.md) §4

## 1. 四类（勿混称「支持离线」）

| 类 | 含义 | 例子 |
|---|---|---|
| **bundled** | 打进客户端静态包 | `/data/cooking/*`、`/data/travel-poi/*` |
| **precache** | 出行前/登录后拉入本机 | 汇率表、地图切片（预留） |
| **device-authoritative** | 本机权威；云可选备份 | 银行流水、足迹、Expense、行程、Signal |
| **cloud-only** | 必须在线；失败要显式态 | 实时航班、未缓存 POI 富信息 |

另：`cloud-inference` = 本机事实 + 云推理（健康 insight）。

## 2. 硬规则

1. 每个 durable store / ExternalAdapter **必须**在 `LOCALITY_REGISTRY` 登记。  
2. UI 禁止笼统「支持离线」——写清是哪一类。  
3. `cloud-only` 异步动作必须有错误 + 重试（仓库红线）。  
4. 备份/删除收口覆盖该 store（IDB key 登记 / storage-manifest）。

## 3. 域对照

| 域 | locality |
|---|---|
| 做饭/营养 / 离线景点 | bundled |
| 行程 | device-authoritative（附件可 precache） |
| 健康导入 | device-authoritative + cloud-inference |
| 财务 / Expense | device-authoritative |
| 天气 | cloud-only（短缓存可） |
| 足迹 | device-authoritative |
