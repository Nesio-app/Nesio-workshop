-- Nesio cloud Signals — 冲突解决守卫 v1(数据审计 #3:云同步 last-write-wins 丢数据)
--
-- 问题:writeCloudSignalsForCurrentUser 用 PostgREST upsert
--   (on_conflict=identity_key,signal_id, Prefer: resolution=merge-duplicates),
--   冲突分支是无条件 UPDATE。两端并发编辑同一 signal 时,谁最后同步谁覆盖 ——
--   即使后同步的一方拿的是更旧的本地副本(典型场景:设备 B 全量重新同步一批
--   陈旧信号,盖掉设备 A 刚写入的新编辑)。
--
-- 修复分两半:
--   1) 应用层(已合入 cloud-signals-server.ts):updated_at 改成盖「逻辑修改时间」
--      (signal.modifiedAt = 节点最近编辑时刻),不再是「同步时刻 new Date()」。
--      于是陈旧副本天生带更旧的 updated_at。
--   2) 本文件(DB 端,幂等,须在 Supabase SQL editor 手动执行一次):BEFORE UPDATE
--      触发器,拒绝严格更旧的写入 —— 从根上做到 race-free,永不丢新编辑。
--
-- 语义:仅当传入 updated_at 严格早于库中现值时拒绝(返回 OLD = 该行不变)。
--   相等则放行(无法区分,取传入值,幂等 upsert 友好)。deleted_at(墓碑)一旦
--   落地也不被更旧的写入复活。NULL updated_at 视为「未知」,一律放行(保守,
--   宁可覆盖也不阻塞;应用层已保证总是带 updated_at)。

CREATE OR REPLACE FUNCTION public.signals_reject_stale_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- 更旧的写入(严格早于库中现值)→ 保持旧行不变,丢弃这次陈旧覆盖。
  IF NEW.updated_at IS NOT NULL
     AND OLD.updated_at IS NOT NULL
     AND NEW.updated_at < OLD.updated_at THEN
    RETURN OLD;
  END IF;

  -- 已软删除(墓碑)不被更旧或同刻的写入复活。
  IF OLD.deleted_at IS NOT NULL
     AND NEW.deleted_at IS NULL
     AND NEW.updated_at IS NOT NULL
     AND OLD.updated_at IS NOT NULL
     AND NEW.updated_at <= OLD.updated_at THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_signals_reject_stale_write ON public.signals;

CREATE TRIGGER trg_signals_reject_stale_write
  BEFORE UPDATE ON public.signals
  FOR EACH ROW
  EXECUTE FUNCTION public.signals_reject_stale_write();
