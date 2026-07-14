/**
 * Session marker signing (安全审计 #8:防伪造 cookie 白嫖云 AI / denial-of-wallet)。
 *
 * `guardAiRoute` 的登录判定里,`baohe_auth_access` 会过 Supabase 验真;但 access 过期后
 * 的回退分支只看 `baohe_auth_refresh` / `baohe_wechat_openid` 是否**存在** —— cookie 是
 * 客户端可写的,攻击者 `curl` 带一个假 `baohe_auth_refresh=x` 即可通过鉴权门,只剩限流
 * 在挡、换 IP 就能烧配额。
 *
 * 修法:签发这两个标记时,用服务端密钥对其值做 HMAC-SHA256,把签名写进配套 cookie
 * (`baohe_auth_sig` / `baohe_wechat_sig`)。回退分支要求签名与值匹配才放行 —— 只有服务端
 * 能产出合法签名,伪造 cookie 无签名/签名不符即被拒。签名不含机密、可随 cookie 明文放。
 *
 * 密钥:`NESIO_SESSION_SIGNING_SECRET`(优先)→ `SUPABASE_SERVICE_ROLE_KEY`(生产服务端恒有)。
 * 都缺(纯本地无 Supabase 部署)→ 无法签/验,回退分支不放行;此类部署走 guard 里的
 * 「无 Supabase → 同源即放行」分支,不受影响。
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { envValue } from '@/lib/portal/env';

/** 配套签名 cookie 名(与被签 cookie 同属性写入/清除)。 */
export const AUTH_SIG_COOKIE = 'baohe_auth_sig';
export const WECHAT_SIG_COOKIE = 'baohe_wechat_sig';

function sessionSecret(): string {
  return envValue('NESIO_SESSION_SIGNING_SECRET') || envValue('SUPABASE_SERVICE_ROLE_KEY') || '';
}

/** 对一个 session 标记值做 HMAC 签名(base64url)。无密钥或空值 → 返回 ''(调用方据此跳过写签名)。 */
export function signSessionValue(value: string): string {
  const secret = sessionSecret();
  if (!secret || !value) return '';
  return createHmac('sha256', secret).update(value).digest('base64url');
}

/** 常量时间校验 value 的签名是否合法。缺密钥/缺签名/不符一律 false(fail-closed)。 */
export function verifySessionValue(value: string, sig: string | undefined): boolean {
  if (!value || !sig) return false;
  const expected = signSessionValue(value);
  if (!expected) return false;
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * 取「经签名验真」的 wechat openid —— 只有签名匹配才返回该 openid,否则 ''。
 * 数据审计 P0:任何据 openid 生成身份(`wechat_openid:${x}` identityKey / 会话 / 连接器
 * token 查找)的地方都必须走这里,杜绝伪造 openid 越权。用法:
 *   const openid = verifiedWechatOpenid(store.get('baohe_wechat_openid')?.value, store.get(WECHAT_SIG_COOKIE)?.value);
 */
export function verifiedWechatOpenid(openid: string | undefined, sig: string | undefined): string {
  return openid && verifySessionValue(openid, sig) ? openid : '';
}
