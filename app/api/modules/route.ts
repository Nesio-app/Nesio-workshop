import { NextResponse } from 'next/server';
import { buildModulesResponse } from '@/lib/portal/app-api-contract-v0.mjs';

export async function GET() {
  return NextResponse.json(buildModulesResponse());
}
