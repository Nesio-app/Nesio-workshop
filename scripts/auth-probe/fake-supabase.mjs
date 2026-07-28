/**
 * 假 Supabase —— 只为在本地把「登录路径上的时序」量出来。
 * 真凭据一个都不需要:我们要验的不是 Supabase 会不会答,是**我们的路由等不等它**。
 * 延迟可控,所以能造出「profile 那几跳很慢」这种真账号里碰运气才遇得到的情况。
 *
 * 每一跳都打时间戳(相对启动),客户端断开也记 —— AbortSignal.timeout 到点时
 * 服务端会看到 aborted,这正是要验的第三条。
 */
import http from 'node:http';
import fs from 'node:fs';

const PORT = Number(process.env.FAKE_PORT || 54321);
// profile 相关的跳要慢多少毫秒(用来验 after() 有没有把它挪出热路径 / 8s 超时)
const PROFILE_DELAY = Number(process.env.PROFILE_DELAY_MS || 0);
const USER_DELAY = Number(process.env.USER_DELAY_MS || 0);

const T0 = Date.now();
const log = [];
const LOG = process.env.FAKE_LOG || '/tmp/fake-supabase.log';
fs.writeFileSync(LOG, '');
const stamp = (msg) => { const line = `[+${String(Date.now() - T0).padStart(6)}ms] ${msg}`; log.push(line); fs.appendFileSync(LOG, line + '\n'); };

const USER = { id: 'u_local_test', email: 'tester@example.com', app_metadata: { provider: 'google', providers: ['google'] }, user_metadata: {} };

const sleep = (ms, req) => new Promise((res) => {
  if (!ms) return res('done');
  const t = setTimeout(() => res('done'), ms);
  req.on('aborted', () => { clearTimeout(t); res('aborted'); });
  req.on('close', () => { clearTimeout(t); res('aborted'); });
});

http.createServer(async (req, res) => {
  const path = req.url.split('?')[0];
  // 就绪探测走独立路径,别混进时间线 —— 之前用 /auth/v1/user 探,结果日志里
  // 平白多一条 user 查询,把我自己骗成「knownUser 没生效」。
  if (path === '/__ready') { res.end('ok'); return; }
  const isProfile = path.includes('user_profiles');
  stamp(`→ ${req.method} ${req.url.slice(0, 80)}`);

  const outcome = await sleep(isProfile ? PROFILE_DELAY : USER_DELAY, req);
  if (outcome === 'aborted') { stamp(`✂ 客户端提前断开: ${req.method} ${path}`); return; }

  res.setHeader('Content-Type', 'application/json');
  if (path === '/auth/v1/user') { res.end(JSON.stringify(USER)); stamp(`← 200 user`); return; }
  // 续期:access 过期、只剩 refresh 时走这里(session 路由的第二条分支)
  if (path === '/auth/v1/token') {
    res.end(JSON.stringify({ access_token: 'refreshed_access', refresh_token: 'refreshed_refresh', expires_in: 3600 }));
    stamp('← 200 token(续期成功)'); return;
  }
  if (isProfile) {
    if (req.method === 'GET') { res.end('[]'); stamp('← 200 user_profiles(空,触发新建)'); return; }
    res.statusCode = 201; res.end(JSON.stringify([{ user_id: USER.id }])); stamp('← 201 user_profiles 建好了'); return;
  }
  res.statusCode = 404; res.end('{}'); stamp(`← 404 ${path}`);
}).listen(PORT, '127.0.0.1', () => stamp(`假 Supabase 起在 :${PORT}(profile 延迟 ${PROFILE_DELAY}ms / user 延迟 ${USER_DELAY}ms)`));

process.on('SIGTERM', () => { console.log('--- 请求时间线 ---\n' + log.join('\n')); process.exit(0); });
