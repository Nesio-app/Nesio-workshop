import { NextResponse } from "next/server";
import {
  buildAuthorizeUrl,
  createOAuthState,
  STATE_COOKIE,
  wechatLoginConfigured,
} from "@/lib/wechat-oauth";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!wechatLoginConfigured()) {
    return NextResponse.json(
      { ok: false, error: "微信登录未配置" },
      { status: 503 }
    );
  }

  const state = createOAuthState();
  const url = buildAuthorizeUrl(state);
  const res = NextResponse.redirect(url);
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return res;
}
