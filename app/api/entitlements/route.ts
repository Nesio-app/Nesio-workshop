import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { buildEntitlementsResponse } from '@/lib/portal/contracts/app-api-contract-v0.mjs';
import { readServerTier, serverEntitlementEnforced } from '@/lib/portal/auth/server-entitlement';

/**
 * 安全审计 #1:此前只返回 mock fixture。现附上服务端权益真档 —— serverTier 来自真源
 * (未接源时为 'unknown',骨架 inert);serverEntitlementEnforced 表明服务端强制是否已开。
 * 真源接上后,客户端不必再只信本地 localStorage 标志。
 */
export async function GET() {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get('baohe_auth_access')?.value || null;
  const serverTier = await readServerTier(accessToken);
  return NextResponse.json({
    ...buildEntitlementsResponse(),
    serverTier,
    serverEntitlementEnforced: serverEntitlementEnforced(),
  });
}
