/**
 * 日历 OAuth token 的解析与"该不该走 OAuth 路径"的纯判定。
 *
 * 修「Token 存储精神分裂」—— 日历 GET 此前只读本机 cookie,换设备(Supabase
 * 会话、无 cookie)就静默退回 iCal,显示"没连日历"。这里把两个纯决策抽出来:
 *   1. pickCalendarTokens:Supabase 优先(跨设备),再回落 cookie。
 *   2. shouldUseOAuth:只要有 access 或 refresh 任一,就走 OAuth 而不是掉进 iCal
 *      —— access 过期但 refresh 还在时,以前 `if (accessToken)` 会漏掉、直接降级。
 */

/**
 * @param {{ accessToken?: string; refreshToken?: string } | null} supabase  Supabase 里的 token
 * @param {{ accessToken?: string; refreshToken?: string } | null} cookie    本机 cookie 里的 token
 * @returns {{ accessToken: string; refreshToken: string }}
 */
export function pickCalendarTokens(supabase, cookie) {
  const s = supabase || {};
  if (s.accessToken || s.refreshToken) {
    return { accessToken: s.accessToken || '', refreshToken: s.refreshToken || '' };
  }
  const c = cookie || {};
  return { accessToken: c.accessToken || '', refreshToken: c.refreshToken || '' };
}

/**
 * 只要还有 access 或 refresh,就该走 OAuth(refresh 能换新 access),不该降级到 iCal。
 * @param {{ accessToken?: string; refreshToken?: string }} tokens
 * @returns {boolean}
 */
export function shouldUseOAuth(tokens) {
  const t = tokens || {};
  return Boolean(t.accessToken || t.refreshToken);
}
