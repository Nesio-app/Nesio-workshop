/**
 * GET /api/admin/governance — 管理员治理面板的只读 API。
 *
 * 数据源(全静态,无需数据库):
 *   - lib/portal/contracts/governance-map.mjs:29 个治理面的单一来源(status/path/治理什么/消费方)
 *   - lib/portal/contracts/governance-snapshot.json:report:modules 的实时数字快照
 *     (serverless 里不能直接跑 report:modules —— 它要用 node:fs 读源文件,生产 bundle 里没有;
 *      所以用构建期生成、提交进仓的快照。跑 `npm run report:governance-docs` 刷新。)
 *
 * 门禁:同源 + x-nesio-admin-secret 匹配 NESIO_ADMIN_SECRET + 限流(与 /api/admin/metrics 同宽)。
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/portal/admin-gate';
import { GOVERNANCE_MAP, GOV_STATUS_META, GOV_GROUP_META, summarizeGovernance } from '@/lib/portal/contracts/governance-map.mjs';
import snapshot from '@/lib/portal/contracts/governance-snapshot.json';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const blocked = requireAdmin(req, 'admin-governance');
  if (blocked) return blocked;

  return NextResponse.json({
    ok: true,
    generatedAt: snapshot.generatedAt,
    snapshot,
    summary: summarizeGovernance(),
    statusMeta: GOV_STATUS_META,
    groupMeta: GOV_GROUP_META,
    map: GOVERNANCE_MAP,
  });
}
