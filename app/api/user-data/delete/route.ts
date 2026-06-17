import { NextResponse } from 'next/server';
import { buildUserDataDeleteResponse } from '@/lib/portal/app-api-contract-v0.mjs';

export async function POST() {
  return NextResponse.json(buildUserDataDeleteResponse({ dryRun: true }));
}
