import { NextResponse } from 'next/server';
import { buildProductionRuntimeStatus } from '@/lib/portal/production-runtime';

export async function GET() {
  const safeStatus = buildProductionRuntimeStatus();

  return NextResponse.json(
    {
      ok: true,
      service: 'portal-production-runtime',
      ...safeStatus,
    },
    {
      status: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
    },
  );
}
