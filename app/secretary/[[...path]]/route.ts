import { readFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import {
  isSecretaryPageRequestAllowed,
  launchUnavailablePayload,
} from '@/lib/portal/launch-safety';

export const dynamic = 'force-dynamic';

const SECRETARY_SOURCE_ROOT = join(process.cwd(), 'tools', 'secretary');

const CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
};

function contentTypeFor(pathname: string): string {
  const match = pathname.match(/\.[^.]+$/);
  return match ? CONTENT_TYPES[match[0]] || 'application/octet-stream' : 'text/html; charset=utf-8';
}

function sourcePathFor(parts: string[] = []): string | null {
  const routePath = parts.join('/');
  const normalizedRoutePath = normalize(routePath || 'index.html').replace(/^(\.\.(\/|\\|$))+/, '');
  if (normalizedRoutePath.includes('..')) return null;

  const withExtension = normalizedRoutePath.includes('.')
    ? normalizedRoutePath
    : `${normalizedRoutePath || 'index'}.html`;
  const targetPath = join(SECRETARY_SOURCE_ROOT, withExtension);
  const normalizedTarget = normalize(targetPath);

  if (!normalizedTarget.startsWith(SECRETARY_SOURCE_ROOT)) return null;
  return normalizedTarget;
}

export async function GET(
  request: NextRequest,
  context: { params: { path?: string[] } },
) {
  if (!isSecretaryPageRequestAllowed(request)) {
    return new NextResponse(
      JSON.stringify(launchUnavailablePayload('page:secretary', 'secretary')),
      {
        status: 403,
        headers: {
          'Cache-Control': 'no-store',
          'Content-Type': 'application/json; charset=utf-8',
        },
      },
    );
  }

  const sourcePath = sourcePathFor(context.params.path);
  if (!sourcePath) {
    return NextResponse.json({ ok: false, reason: 'invalid_secretary_path' }, { status: 404 });
  }

  try {
    const body = await readFile(sourcePath);
    return new NextResponse(body, {
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Type': contentTypeFor(sourcePath),
      },
    });
  } catch {
    return NextResponse.json({ ok: false, reason: 'secretary_asset_not_found' }, { status: 404 });
  }
}
