import { NextResponse, type NextRequest } from 'next/server';
import {
  isFirstLaunchBlockedPath,
  isSecretaryAiRequestAllowed,
  launchUnavailablePayload,
} from './lib/portal/launch-safety';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname === '/storage') {
    const url = request.nextUrl.clone();
    url.pathname = '/storage/index.html';
    return NextResponse.rewrite(url);
  }

  if (!isFirstLaunchBlockedPath(pathname)) {
    return NextResponse.next();
  }

  if (
    (pathname.startsWith('/api/secretary') || pathname.startsWith('/secretary')) &&
    isSecretaryAiRequestAllowed(request)
  ) {
    return NextResponse.next();
  }

  const payload = launchUnavailablePayload(pathname.startsWith('/api/') ? 'api' : 'page', pathname);

  if (pathname.startsWith('/api/')) {
    return NextResponse.json(payload, {
      status: 403,
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  }

  return new NextResponse(
    `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>能力暂未开放</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f7f9fc;color:#14213d"><main style="max-width:520px;padding:32px"><h1 style="font-size:24px;margin:0 0 12px">能力暂未开放</h1><p style="line-height:1.7;margin:0">该能力已从首发 App 的运行路径隔离，当前仅作为未来 / gated / 不可用状态保留。</p><p style="margin:20px 0 0"><a href="/" style="color:#2563eb">返回宝盒</a></p></main></body></html>`,
    {
      status: 403,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    },
  );
}

export const config = {
  matcher: [
    '/storage',
    '/secretary',
    '/secretary/chat',
    '/secretary/group',
    '/secretary/:path*',
    '/inner-shelter/:path*',
    '/health/:path*',
    '/api/secretary/:path*',
    '/api/inner-shelter/:path*',
    '/api/adhd-flow/:path*',
    '/api/fitness/:path*',
    '/api/identify/:path*',
    '/api/payments/:path*',
    '/api/storekit/:path*',
    '/api/subscriptions/:path*',
  ],
};
