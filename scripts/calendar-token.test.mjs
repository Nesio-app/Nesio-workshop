/**
 * 行为契约:日历 token 解析不再"精神分裂"(cookie-only)。
 *
 * 修「Token 存储精神分裂 —— 日历 GET 只读本机 cookie,换设备(Supabase 会话、
 * 无 cookie)就静默退回 iCal,显示没连日历,即便账号明明连着」。
 */
import assert from 'node:assert/strict';
import { pickCalendarTokens, shouldUseOAuth } from '../lib/portal/calendar-token.mjs';

// ── Supabase 优先:换设备只有 Supabase token、本机无 cookie → 仍拿到 token ──────
{
  const r = pickCalendarTokens(
    { accessToken: 'sa', refreshToken: 'sr' },
    { accessToken: '', refreshToken: '' }, // 新设备,cookie 空
  );
  assert.deepEqual(r, { accessToken: 'sa', refreshToken: 'sr' }, '跨设备:用 Supabase token,不掉进 iCal。');
}

// ── Supabase 只有 refresh(access 已过期) → 仍认为"连着",走 OAuth 刷新 ────────
{
  const r = pickCalendarTokens({ refreshToken: 'sr' }, null);
  assert.equal(r.refreshToken, 'sr');
  assert.ok(shouldUseOAuth(r), 'access 过期但 refresh 在 → 该走 OAuth 刷新,不降级 iCal。');
}

// ── Supabase 空 → 显式回落本机 cookie(旧的只写 cookie 的授权仍能用) ───────────
{
  const r = pickCalendarTokens(null, { accessToken: 'ca', refreshToken: 'cr' });
  assert.deepEqual(r, { accessToken: 'ca', refreshToken: 'cr' }, 'Supabase 无 → 回落 cookie。');
}
{
  const r = pickCalendarTokens({}, { accessToken: 'ca' });
  assert.equal(r.accessToken, 'ca', '空对象也回落 cookie。');
}

// ── 都没有 → 空,shouldUseOAuth=false(此时才该走 iCal 兜底) ──────────────────
{
  const r = pickCalendarTokens(null, null);
  assert.deepEqual(r, { accessToken: '', refreshToken: '' });
  assert.equal(shouldUseOAuth(r), false, '真没 token 时才降级 iCal。');
}

// ── shouldUseOAuth:核心回归 —— 只有 access、只有 refresh、都无 ────────────────
assert.equal(shouldUseOAuth({ accessToken: 'a' }), true, '只有 access → OAuth。');
assert.equal(shouldUseOAuth({ refreshToken: 'r' }), true, '只有 refresh → OAuth(旧 if(accessToken) 会漏)。');
assert.equal(shouldUseOAuth({}), false);
assert.equal(shouldUseOAuth(null), false);

console.log('calendar-token: OK');
