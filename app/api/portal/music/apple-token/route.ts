/**
 * GET /api/portal/music/apple-token
 *
 * 给 MusicKit JS 签一个 developer token。Apple Music 是四个音源里
 * **唯一** Nesio 自己能当播放器、又不用装第三方 App 的那条路 ——
 * 代价是这枚 token 必须在服务端签(私钥是 .p8,绝不能进前端包)。
 *
 * 走 guardAiRoute:它不花 AI 的钱,但它**签发的是一枚能代表本应用调 Apple API
 * 的凭证** —— 裸奔的话谁都能来领一枚。私密数据路由同一条红线。
 *
 * 没配密钥时返回 200 + configured:false(不是 5xx):
 * 「还没配」是一个**正常的已知状态**,前端要拿它显示「Apple Music 还没配好」,
 * 而不是把它渲染成一次网络故障、让用户以为点了没反应。
 */
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { guardAiRoute } from '@/lib/portal/api-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Apple 允许最长 180 天;取 12 小时 —— 泄露一枚的代价被压到当天。 */
const TTL_SEC = 12 * 60 * 60;

function env(key: string): string {
  const v = process.env[key];
  return typeof v === 'string' ? v.trim() : '';
}

function missingEnv(): string[] {
  return ['APPLE_MUSIC_TEAM_ID', 'APPLE_MUSIC_KEY_ID', 'APPLE_MUSIC_PRIVATE_KEY'].filter((k) => !env(k));
}

const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/**
 * ES256 签名。Node 默认吐 DER,而 JWT 要的是 JOSE 的 r‖s 定长格式 ——
 * 少了 dsaEncoding 这一项,Apple 会一路返回 401,且错误信息里完全看不出是编码问题。
 */
function signDeveloperToken(teamId: string, keyId: string, privateKeyPem: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(Buffer.from(JSON.stringify({ alg: 'ES256', kid: keyId }), 'utf8'));
  const payload = b64url(Buffer.from(JSON.stringify({ iss: teamId, iat: now, exp: now + TTL_SEC }), 'utf8'));
  const sig = crypto.sign(null, Buffer.from(`${header}.${payload}`, 'utf8'), {
    key: privateKeyPem,
    dsaEncoding: 'ieee-p1363',
  });
  return `${header}.${payload}.${b64url(sig)}`;
}

export async function GET(req: NextRequest) {
  const blocked = await guardAiRoute(req, 'music-apple-token', { limit: 10, windowMs: 60_000 });
  if (blocked) return blocked;

  const missing = missingEnv();
  if (missing.length) {
    return NextResponse.json(
      { ok: true, configured: false, missingEnv: missing },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } },
    );
  }

  try {
    // .p8 存进环境变量时换行常被写成字面量 \n —— 还原,否则 PEM 解析失败。
    const pem = env('APPLE_MUSIC_PRIVATE_KEY').replace(/\\n/g, '\n');
    const token = signDeveloperToken(env('APPLE_MUSIC_TEAM_ID'), env('APPLE_MUSIC_KEY_ID'), pem);
    return NextResponse.json(
      { ok: true, configured: true, token, expiresAt: Date.now() + TTL_SEC * 1000 },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } },
    );
  } catch (e) {
    // 密钥配错(格式不对/不是 P-256)也是一个**可说清**的状态,不许静默变成空 token。
    console.info('music_apple_token_sign_failed', { message: (e as Error)?.message });
    return NextResponse.json(
      { ok: false, configured: true, error: 'sign_failed' },
      { status: 500, headers: { 'Cache-Control': 'no-store, max-age=0' } },
    );
  }
}
