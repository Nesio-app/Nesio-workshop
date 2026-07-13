/**
 * GET /api/portal/granola/connect  (批次 157)
 * Granola OAuth 2.0 起点 —— MCP 授权用「动态客户端注册(DCR)」,不需要预置 client id/secret。
 * 流程:发现受保护资源元数据 → 发现授权服务器 → DCR 注册 → 建授权 URL(带 PKCE)→ 跳浏览器登录。
 * 回调要用的 state/codeVerifier/client 存进短时 httpOnly cookie(SameSite=Lax 以随重定向回传)。
 */
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  discoverOAuthProtectedResourceMetadata,
  discoverAuthorizationServerMetadata,
  registerClient,
  startAuthorization,
} from '@modelcontextprotocol/sdk/client/auth.js';
import { GRANOLA_MCP_URL } from '@/lib/portal/granola-mcp';

export const dynamic = 'force-dynamic';

export const GRANOLA_OAUTH_COOKIE = 'nesio_granola_oauth';

export async function GET(req: NextRequest) {
  // 必须已登录 Nesio —— 回调要把 token 存到该用户名下。
  const cookieStore = await cookies();
  const signedIn = Boolean(
    cookieStore.get('baohe_auth_access')?.value || cookieStore.get('baohe_auth_refresh')?.value,
  );
  if (!signedIn) {
    return NextResponse.redirect(new URL('/?granola=login_required', req.nextUrl.origin));
  }

  const redirectUri = `${req.nextUrl.origin}/api/portal/granola/callback`;

  try {
    // ① 受保护资源元数据 → 授权服务器 + 规范 resource(RFC 8707)
    const prm = await discoverOAuthProtectedResourceMetadata(GRANOLA_MCP_URL);
    const authServerUrl = prm?.authorization_servers?.[0];
    if (!authServerUrl) throw new Error('no_authorization_server');
    const resource = new URL(prm.resource || GRANOLA_MCP_URL);

    // ② 授权服务器元数据(authorize/token/registration 端点)
    const metadata = await discoverAuthorizationServerMetadata(authServerUrl);

    // ③ 动态客户端注册(公共客户端 + PKCE,无 client secret)
    const clientInfo = await registerClient(authServerUrl, {
      metadata,
      clientMetadata: {
        client_name: 'Nesio',
        redirect_uris: [redirectUri],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      },
    });

    // ④ 授权 URL + PKCE code_verifier
    const state = crypto.randomUUID();
    const { authorizationUrl, codeVerifier } = await startAuthorization(authServerUrl, {
      metadata,
      clientInformation: clientInfo,
      redirectUrl: redirectUri,
      state,
      resource,
    });

    // ⑤ 回调所需最小上下文存 cookie(state 防 CSRF;codeVerifier 是 PKCE 单次用)
    const stash = JSON.stringify({
      state,
      codeVerifier,
      clientId: clientInfo.client_id,
      clientSecret: clientInfo.client_secret ?? null,
      authServerUrl: String(authServerUrl),
      resource: String(resource),
      redirectUri,
    });
    const res = NextResponse.redirect(authorizationUrl.toString());
    res.cookies.set(GRANOLA_OAUTH_COOKIE, Buffer.from(stash).toString('base64'), {
      httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 600,
    });
    return res;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.redirect(
      new URL(`/?granola=connect_failed&reason=${encodeURIComponent(msg.slice(0, 80))}`, req.nextUrl.origin),
    );
  }
}
