import { NextRequest, NextResponse } from "next/server";

const ALLOWED_ORIGINS = [
  "https://hanbing6228.github.io",
  "https://nianguichu.onrender.com",
  process.env.NEXT_PUBLIC_APP_URL,
].filter(Boolean) as string[];

function isAllowedOrigin(origin: string) {
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  if (/^https:\/\/[\w-]+\.github\.io$/i.test(origin)) return true;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) return true;
  return false;
}

function corsHeaders(origin: string | null) {
  if (!origin || !isAllowedOrigin(origin)) return null;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname === "/") {
    return NextResponse.rewrite(new URL("/index.html", request.url));
  }

  if (!pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  const origin = request.headers.get("origin");
  const headers = corsHeaders(origin);

  if (request.method === "OPTIONS") {
    return new NextResponse(null, {
      status: 204,
      headers: headers ?? undefined,
    });
  }

  const response = NextResponse.next();
  if (headers) {
    Object.entries(headers).forEach(([key, value]) => {
      response.headers.set(key, value);
    });
  }
  return response;
}

export const config = {
  matcher: ["/", "/api/:path*"],
};
