import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createSessionToken, hashPassword } from "@/lib/auth";
import { randomBytes } from "crypto";
import {
  exchangeCode,
  fetchWechatUserInfo,
  STATE_COOKIE,
  verifyOAuthState,
  wechatEmail,
  wechatLoginConfigured,
} from "@/lib/wechat-oauth";

export const dynamic = "force-dynamic";

function appHome(extra = "") {
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || "";
  return `${base}/${extra.replace(/^\//, "")}`;
}

export async function GET(request: Request) {
  if (!wechatLoginConfigured()) {
    return NextResponse.redirect(appHome("?auth_error=wechat_not_configured"));
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = request.headers
    .get("cookie")
    ?.split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${STATE_COOKIE}=`))
    ?.split("=")[1];

  if (!code || !state || state !== cookieState || !verifyOAuthState(state)) {
    return NextResponse.redirect(appHome("?auth_error=wechat_state_invalid"));
  }

  try {
    const token = await exchangeCode(code);
    let nickname: string | null = null;
    try {
      const profile = await fetchWechatUserInfo(
        token.access_token,
        token.openid
      );
      nickname = profile.nickname || null;
    } catch {
      /* nickname optional */
    }

    const openid = token.openid;
    const email = wechatEmail(openid);

    let user = await prisma.user.findFirst({
      where: {
        OR: [{ wechatOpenId: openid }, { email }],
      },
    });

    if (!user) {
      const passwordHash = await hashPassword(randomBytes(32).toString("hex"));
      user = await prisma.user.create({
        data: {
          email,
          passwordHash,
          name: nickname,
          wechatOpenId: openid,
        },
      });
    } else if (!user.wechatOpenId) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { wechatOpenId: openid, name: user.name || nickname },
      });
    }

    const sessionToken = await createSessionToken({
      id: user.id,
      email: user.email,
      name: user.name,
    });

    const res = NextResponse.redirect(appHome("?wechat_login=1"));
    res.cookies.set(STATE_COOKIE, "", { path: "/", maxAge: 0 });
    await setSessionCookieOnResponse(res, sessionToken);
    return res;
  } catch (e) {
    console.error("WeChat OAuth error:", e);
    return NextResponse.redirect(appHome("?auth_error=wechat_failed"));
  }
}

/** Set session on redirect response (cookies() from next/headers cannot attach to redirect easily in all versions). */
async function setSessionCookieOnResponse(
  res: NextResponse,
  token: string
) {
  const crossOrigin = process.env.ALLOW_CROSS_ORIGIN === "true";
  res.cookies.set("memorial_session", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: crossOrigin ? "none" : "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 14,
  });
}
