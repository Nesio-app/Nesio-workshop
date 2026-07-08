import { NextResponse } from 'next/server';
import { buildModulesResponse } from '@/lib/portal/contracts/app-api-contract-v0.mjs';

export async function GET() {
  return NextResponse.json(buildModulesResponse());
}
