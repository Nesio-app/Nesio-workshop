/**
 * 邀请制(2026-07-31 用户:「应用层邀请制做」)。
 *
 * 用户的原话是「我给 access,别人才能用」。所以这一层管的是**谁能登录**,
 * 不是「谁能打开网址」——后者他明确不要:「不登录可以本地用」是 Nesio 的
 * 本地优先设计(不登录也能记笔记、听本地歌)。两件事别混:
 *   · 搜不到       → X-Robots-Tag noindex(已做)
 *   · 页面照常打开 → 不做平台级密码保护
 *   · **登录要邀请** → 就是这个文件
 *
 * ── 为什么没配 = 不启用(fail-open)────────────────────────────────────────
 * 访问控制通常该 fail-closed,但这一处反过来,理由很具体:
 * 这段代码一上线,如果「没配名单 = 谁都不许登录」,那么**部署完成的那一刻
 * 你自己也进不去了** —— 而你要登录才能去改环境变量的地方通常也在这套账号里。
 * 一个把管理员锁在门外的安全措施,现实中只会被慌乱地 revert 掉。
 *
 * 所以:没配 = 这道门不存在(和之前完全一样);配了 = 立刻生效。
 * 代价是「忘了配」不会有任何提示,所以 gateReason() 会把「没启用」如实说出来,
 * 让 /admin 和日志能看见它到底开没开,而不是靠人记得。
 *
 * ── 判据故意做得笨 ──────────────────────────────────────────────────────────
 * 精确邮箱匹配,大小写不敏感,不支持整域通配(`@example.com`)。
 * 通配看着方便,但它把「我认识的几个人」悄悄变成「任何拿到该域邮箱的人」——
 * 而这道门的全部意义就是那份名单是你一个一个点头的。
 * 要加人就加一行,一秒钟的事;要省这一秒的代价是整道门形同虚设。
 */

export const INVITE_ALLOWLIST_ENV = 'NESIO_INVITE_ALLOWLIST';

type EnvLike = Record<string, string | undefined>;

/** 名单。逗号 / 分号 / 换行 / 空格都能当分隔符 —— 人手填的东西不该挑剔格式。 */
export function inviteList(env: EnvLike = process.env): string[] {
  const raw = (env[INVITE_ALLOWLIST_ENV] ?? '').trim();
  if (!raw) return [];
  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.includes('@'));
}

/** 这道门开着吗。名单为空 = 不启用(理由见文件头)。 */
export function inviteGateEnabled(env: EnvLike = process.env): boolean {
  return inviteList(env).length > 0;
}

/**
 * 这个邮箱能不能登录。
 *
 * 门没开 → 一律 true(行为和加这层之前一模一样)。
 * 门开着 → **必须在名单里**。拿不到邮箱(解不出 token / 第三方登录没给)也算不通过 ——
 * 这一处必须 fail-closed:门既然开着,「不知道你是谁」就不能放进来,
 * 否则只要让邮箱读取失败就能绕过整道门。
 */
export function isInvited(email: string, env: EnvLike = process.env): boolean {
  const list = inviteList(env);
  if (!list.length) return true;
  const e = String(email || '').trim().toLowerCase();
  if (!e) return false;
  return list.includes(e);
}

/**
 * 给日志/admin 看的一句话。**不给用户看** —— 用户那句在路由里,是人话。
 * 存在的理由:fail-open 意味着「忘了配」毫无症状,得有个地方能看出门到底开没开。
 */
export function gateReason(email: string, env: EnvLike = process.env): string {
  if (!inviteGateEnabled(env)) return 'invite_gate_disabled';
  if (!String(email || '').trim()) return 'invite_gate_no_email';
  return isInvited(email, env) ? 'invite_ok' : 'invite_not_listed';
}

/**
 * 从 Supabase 的 access_token(JWT)里读 email。
 *
 * 只解 payload、**不验签** —— 这里是安全的,因为这个 token 是我们自己刚通过
 * HTTPS 从 Supabase 换回来的,不是用户递过来的。签名已经由 Supabase 保证。
 * (如果哪天改成读用户请求里带的 token,这个函数就不能这么用了。)
 *
 * 解不出来返回空串,由调用方按「不知道你是谁」处理 —— 见 isInvited 的 fail-closed。
 */
export function emailFromAccessToken(accessToken: string): string {
  const parts = String(accessToken || '').split('.');
  if (parts.length < 2) return '';
  try {
    // JWT 用 base64url:补齐 padding 并换回标准 base64 字母表。
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const json = typeof atob === 'function'
      ? atob(padded)
      : Buffer.from(padded, 'base64').toString('utf8');
    const claims = JSON.parse(json) as { email?: unknown; user_metadata?: { email?: unknown } };
    const e = typeof claims.email === 'string' ? claims.email
      : typeof claims.user_metadata?.email === 'string' ? claims.user_metadata.email
        : '';
    return e.trim().toLowerCase();
  } catch {
    return '';
  }
}
