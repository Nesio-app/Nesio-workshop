-- Nesio 保留期与被遗忘权 GC v1(数据审计 #5/#6)
--
-- 解决两件事:
--  1) 软删不物删:云端单节点删除是软删(打 deleted_at 墓碑),从不物理清理 ——
--     "已删除"的记忆/信号在库里永久留存。本文件提供 GC 函数,把过了宽限期的
--     墓碑行真正删掉。宽限期(默认 30 天)给多端同步传播删除意图留窗口。
--  2) 遥测无 TTL:telemetry_events 匿名累积无上限。本文件提供 TTL 清理
--     (默认 180 天)。
--
-- 幂等,须在 Supabase SQL editor 手动执行一次(创建函数)。默认不自动运行 ——
-- 末尾给了 pg_cron 定时示例(pg_cron 需在项目里启用;不启用则手动/外部调度调用)。

-- ── 软删墓碑物理清理 ─────────────────────────────────────────────────────────
-- 把 deleted_at 早于 (now - grace) 的行从各表物理删除。返回删除总行数。
CREATE OR REPLACE FUNCTION public.nesio_gc_soft_deleted(grace interval DEFAULT interval '30 days')
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cutoff timestamptz := now() - grace;
  total bigint := 0;
  n bigint;
BEGIN
  DELETE FROM public.signals       WHERE deleted_at IS NOT NULL AND deleted_at < cutoff;
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n;
  DELETE FROM public.memory_nodes  WHERE deleted_at IS NOT NULL AND deleted_at < cutoff;
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n;
  DELETE FROM public.memory_edges  WHERE deleted_at IS NOT NULL AND deleted_at < cutoff;
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n;
  DELETE FROM public.memory_assets WHERE deleted_at IS NOT NULL AND deleted_at < cutoff;
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n;
  RETURN total;
END;
$$;

-- ── 遥测 TTL ─────────────────────────────────────────────────────────────────
-- 删除早于 (now - keep) 的匿名遥测。返回删除行数。
CREATE OR REPLACE FUNCTION public.nesio_gc_telemetry(keep interval DEFAULT interval '180 days')
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n bigint;
BEGIN
  DELETE FROM public.telemetry_events WHERE at < now() - keep;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.nesio_gc_soft_deleted(interval) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.nesio_gc_telemetry(interval) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nesio_gc_soft_deleted(interval) TO service_role;
GRANT EXECUTE ON FUNCTION public.nesio_gc_telemetry(interval) TO service_role;

-- ── 定时(可选,需启用 pg_cron 扩展)─────────────────────────────────────────
-- 每日 03:00 UTC 跑一遍。启用后取消注释执行:
--   CREATE EXTENSION IF NOT EXISTS pg_cron;
--   SELECT cron.schedule('nesio-gc-soft-deleted', '0 3 * * *', $$SELECT public.nesio_gc_soft_deleted();$$);
--   SELECT cron.schedule('nesio-gc-telemetry',    '0 3 * * *', $$SELECT public.nesio_gc_telemetry();$$);
-- 不启用 pg_cron 时,可由外部调度(如每日 job)以 service_role 调
--   POST /rest/v1/rpc/nesio_gc_soft_deleted  与  /rest/v1/rpc/nesio_gc_telemetry。
