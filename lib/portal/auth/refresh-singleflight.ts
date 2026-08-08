/**
 * Supabase refresh token 旋转的**进程内单飞**。
 *
 * access 过期后，`/api/auth/session` 与各云 API（cloud-server-runtime）都会
 * `grant_type=refresh_token`。若各写各的 Map，同进程两路并行会把刚旋转出的
 * refresh token 互踢失效 —— 前端表现为「隔几分钟掉登录 / 同步开始就 session_unverified」。
 *
 * 跨 Vercel 实例仍可能互踢（无分布式锁）；本模块至少堵住同实例那条最常见路径。
 * 客户端仍应在重云同步前先单路刷 `/api/auth/session`。
 */

export type RefreshedSession = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
};

type RefreshFn = () => Promise<RefreshedSession | null>;

const inflight = new Map<string, Promise<RefreshedSession | null>>();

/**
 * 同一 refreshToken 在本进程只跑一次；并发调用共享同一 Promise。
 */
export function singleflightRefresh(
  refreshToken: string,
  run: RefreshFn,
): Promise<RefreshedSession | null> {
  if (!refreshToken) return Promise.resolve(null);
  const existing = inflight.get(refreshToken);
  if (existing) return existing;

  const p = (async () => {
    try {
      return await run();
    } finally {
      inflight.delete(refreshToken);
    }
  })();

  inflight.set(refreshToken, p);
  return p;
}
