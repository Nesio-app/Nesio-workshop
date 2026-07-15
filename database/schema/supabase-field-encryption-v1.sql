-- Nesio 云端敏感字段静态加密 —— 部署侧启用步骤(数据审计 #2)
--
-- 定位:应用层字段加密(非 E2E)。密钥服务端托管,防的是「数据库转储/快照泄露」
-- (拖库拿到密文,无应用密钥读不出敏感原文)。实现见 lib/portal/cloud/field-encryption.ts。
--
-- 默认休眠:不设环境变量则应用层走 passthrough(明文),本文件无需执行。
--
-- ── 启用步骤(三步,缺一不可)────────────────────────────────────────────────
-- 1) 设环境变量:
--      NESIO_FIELD_ENCRYPTION=1
--      NESIO_FIELD_ENCRYPTION_KEY=<强随机串>   # 缺省回退 SUPABASE_SERVICE_ROLE_KEY 派生
--    ⚠ 密钥一旦用于加密就不能变更:换 secret = 换 key,旧密文将无法解密。
--      轮换须先用旧钥全量解密 → 换钥 → 重加密(本版不含在线轮换,后续再做)。
-- 2) 执行本 SQL(放宽 jsonb 内容列的类型约束,使其兼容密文信封字符串)。
-- 3) 部署应用。此后新写入的敏感内容列落密文;历史明文行按「逐值探测」继续可读
--    (混合模式,无需回填)。若要历史行也加密,读出→重写一遍即可。
--
-- ── 为什么要放宽约束 ─────────────────────────────────────────────────────────
-- 原 schema 对内容列有 jsonb_typeof CHECK(payload/evidence/node/asset='object',
-- entities='array')。加密后这些列存的是密文信封(JSON 字符串,jsonb_typeof='string'),
-- 会被原约束拒收。下面把约束放宽为「原类型 OR string」,明文行与密文行都合法。
-- 幂等:先 DROP IF EXISTS 再重建(Postgres 对内联列约束的确定命名为 {表}_{列}_check)。

-- signals:payload / entities / evidence
ALTER TABLE public.signals DROP CONSTRAINT IF EXISTS signals_payload_check;
ALTER TABLE public.signals ADD CONSTRAINT signals_payload_check
  CHECK (jsonb_typeof(payload) IN ('object', 'string'));

ALTER TABLE public.signals DROP CONSTRAINT IF EXISTS signals_entities_check;
ALTER TABLE public.signals ADD CONSTRAINT signals_entities_check
  CHECK (jsonb_typeof(entities) IN ('array', 'string'));

ALTER TABLE public.signals DROP CONSTRAINT IF EXISTS signals_evidence_check;
ALTER TABLE public.signals ADD CONSTRAINT signals_evidence_check
  CHECK (jsonb_typeof(evidence) IN ('object', 'string'));

-- memory_nodes.node
ALTER TABLE public.memory_nodes DROP CONSTRAINT IF EXISTS memory_nodes_node_check;
ALTER TABLE public.memory_nodes ADD CONSTRAINT memory_nodes_node_check
  CHECK (jsonb_typeof(node) IN ('object', 'string'));

-- memory_edges.evidence
ALTER TABLE public.memory_edges DROP CONSTRAINT IF EXISTS memory_edges_evidence_check;
ALTER TABLE public.memory_edges ADD CONSTRAINT memory_edges_evidence_check
  CHECK (jsonb_typeof(evidence) IN ('object', 'string'));

-- memory_assets.asset
ALTER TABLE public.memory_assets DROP CONSTRAINT IF EXISTS memory_assets_asset_check;
ALTER TABLE public.memory_assets ADD CONSTRAINT memory_assets_asset_check
  CHECK (jsonb_typeof(asset) IN ('object', 'string'));

-- 注:title / embedding_text 是 text 列,密文信封字符串天然兼容,无需改约束。
-- embedding_vector 不加密(不可逆数值投影,服务端向量检索必需,不还原原文)。
