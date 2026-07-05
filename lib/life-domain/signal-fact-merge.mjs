/**
 * Signal 事实库合并规则(纯函数,供 signal-read-cache.ts 与 node 行为测试共用)。
 *
 * 契约:IDB 事实库是权威源,localStorage LifeGraph 是可重建的派生投影。
 * 启动水合时的冲突规则必须与该契约一致:
 *   - 同 id:IDB 版本胜出(不让陈旧投影覆盖 IDB;修「跨设备/云端拉取的
 *     IDB-only 编辑被下次 hydrate 的旧投影冲掉并持久化」的数据完整性隐患)。
 *   - 投影独有的 id:回填(事实库独立 + 首次迁移),并需要写入 IDB。
 *
 * 注:实时编辑路径(onGraphUpdated)另行处理 —— 本机刚编辑的投影就是最新,
 * 那里投影胜出并写 IDB,与这里的启动合并规则互不矛盾。
 */

/**
 * @param {Array<{id: string}>} idbSignals        权威事实库(IDB 全量)
 * @param {Array<{id: string}>} projectionSignals  localStorage 投影派生的信号
 * @returns {{ merged: Array<{id:string}>, backfill: Array<{id:string}> }}
 *   merged   —— 合并后的完整集合(IDB 胜出 + 投影独有回填)
 *   backfill —— 投影独有、需要写入 IDB 的信号(只写这些,不回写已存在的)
 */
export function mergeFactStore(idbSignals, projectionSignals) {
  const byId = new Map(idbSignals.map((s) => [s.id, s]));
  const backfill = [];
  for (const s of projectionSignals) {
    if (!byId.has(s.id)) {
      byId.set(s.id, s);
      backfill.push(s);
    }
  }
  return { merged: Array.from(byId.values()), backfill };
}
