import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { buildEntitlementsResponse } from '@/lib/portal/contracts/app-api-contract-v0.mjs';
import {
  ensureServerEntitlementRow,
  readServerEntitlementDetail,
  serverEntitlementEnforced,
} from '@/lib/portal/auth/server-entitlement';

/**
 * 安全审计 #1:此前只返回 mock fixture。现附上服务端权益真档 —— serverTier 来自真源
 * (未接源时为 'unknown',骨架 inert);serverEntitlementEnforced 表明服务端强制是否已开。
 * 真源接上后,客户端不必再只信本地 localStorage 标志。
 *
 * 首登兜底:ensureServerEntitlementRow 确保账号在真源表有一行并落试用起点(账号级,防清缓存/
 * 重装重置试用 —— 报告 #6);随后回传账号级试用剩余天数,客户端据以缓存、按账号统一收权。
 */
export async function GET() {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get('baohe_auth_access')?.value || null;
  await ensureServerEntitlementRow(accessToken);
  const detail = await readServerEntitlementDetail(accessToken);
  return NextResponse.json({
    ...buildEntitlementsResponse(),
    serverTier: detail.tier,
    serverPlan: detail.plan,
    serverTrialDaysLeft: detail.trialDaysLeft,
    serverEntitlementEnforced: serverEntitlementEnforced(),
  });
}
