/**
 * 行为契约:guardAiRoute 的授权判定 + 限流(直接执行 api-auth-core,非钉字符串)。
 *
 * 背景:guardAiRoute 是最关键的安全原语(Denial-of-Wallet 防线),此前零运行时测试
 * —— 契约只断言路由文件"提到了 guardAiRoute",证明不了它真的放行/拦截/限流。
 */
import assert from 'node:assert/strict';
import { authorizeDecision, createRateLimiter } from '../lib/portal/api-auth-core.mjs';

const base = {
  hasSession: false,
  stage5Secret: '',
  providedStage5: '',
  noSupabase: false,
  allowCrossOrigin: false,
  host: 'nesio.app',
  originValues: [],
};

// ── 授权:三条放行路径 ──────────────────────────────────────────────────────
assert.equal(authorizeDecision({ ...base, hasSession: true }), true, '有会话 cookie → 放行。');
assert.equal(
  authorizeDecision({ ...base, stage5Secret: 's3cr3t', providedStage5: 's3cr3t' }), true,
  'Stage-5 密钥匹配 → 放行。',
);
assert.equal(
  authorizeDecision({ ...base, noSupabase: true, originValues: ['https://nesio.app/x'] }), true,
  '未配 Supabase 的本地部署 + 同源 → 放行。',
);

// ── 授权:拦截路径 ──────────────────────────────────────────────────────────
assert.equal(
  authorizeDecision(base), false,
  '配了 Supabase 却无会话/密钥 → 拒绝(默认 fail-closed)。',
);
assert.equal(
  authorizeDecision({ ...base, stage5Secret: 's3cr3t', providedStage5: 'wrong' }), false,
  'Stage-5 密钥不匹配 → 拒绝。',
);
assert.equal(
  authorizeDecision({ ...base, stage5Secret: '', providedStage5: '' }), false,
  '未配 Stage-5 密钥时,空密钥不能意外放行。',
);
assert.equal(
  authorizeDecision({ ...base, noSupabase: true, originValues: ['https://evil.com/x'] }), false,
  '本地部署但跨源(Origin 不匹配 host)→ 拒绝。',
);
assert.equal(
  authorizeDecision({ ...base, noSupabase: true, originValues: ['not a url'] }), false,
  '本地部署但 Origin 无法解析 → 拒绝。',
);
assert.equal(
  authorizeDecision({ ...base, noSupabase: true, allowCrossOrigin: true, originValues: ['capacitor://x'] }), true,
  'allowCrossOrigin(iOS 壳)→ 跳过同源检查放行。',
);
assert.equal(
  authorizeDecision({ ...base, noSupabase: true, originValues: [] }), true,
  '本地部署且无 Origin/Referer(如 curl)→ 授权放行,滥用交给限流。',
);

// ── 限流:窗口内超过 limit 才拦截 ───────────────────────────────────────────
{
  const rl = createRateLimiter();
  const t0 = 1_000_000;
  const opts = { limit: 3, windowMs: 60_000 };
  const results = [];
  for (let i = 0; i < 5; i++) results.push(rl.check('chat:1.2.3.4', t0, opts));
  assert.deepEqual(results, [false, false, false, true, true], '前 3 次放行,第 4 次起限流。');

  // 窗口重置后恢复放行
  assert.equal(rl.check('chat:1.2.3.4', t0 + 60_001, opts), false, '窗口过期后重新放行。');

  // 不同 key(IP/路由)互不影响
  assert.equal(rl.check('chat:9.9.9.9', t0, opts), false, '不同 IP 独立计窗。');
  assert.equal(rl.check('tts:1.2.3.4', t0, opts), false, '不同路由独立计窗。');
}

// ── 限流:达上限时优先删过期、不清空所有人(修「刷唯一 key 重置全体限流」杠杆)──
{
  // 达上限时:过期条目先删,活跃条目保留 —— 攻击者刷唯一 key 不能清掉受害者的限流窗。
  const rl = createRateLimiter({ maxTrackedKeys: 3 });
  rl.check('expired', 0, { limit: 1, windowMs: 100 });   // resetAt=100
  rl.check('victim-b', 0, { limit: 1, windowMs: 10_000 }); // resetAt=10000(活跃)
  rl.check('victim-c', 0, { limit: 1, windowMs: 10_000 }); // resetAt=10000(活跃)
  assert.equal(rl.size(), 3, '已跟踪 3 个 key(达上限)。');
  // now=200:'expired' 已过期;新增 'attacker' 触发回收 —— 只应删过期的那个。
  rl.check('attacker', 200, { limit: 1, windowMs: 10_000 });
  assert.ok(rl.size() <= 3, '内存仍有界。');
  // 受害者的限流窗必须还在(count 已达 limit)→ 仍被拦截,没被攻击者的洪泛重置。
  assert.equal(rl.check('victim-b', 200, { limit: 1, windowMs: 10_000 }), true, '活跃受害者限流窗未被清空,仍拦截。');
  assert.equal(rl.check('victim-c', 200, { limit: 1, windowMs: 10_000 }), true, '活跃受害者限流窗未被清空,仍拦截。');
}

// ── 限流:纯洪泛(无过期)时增量 LRU 淘汰,而非一次清空 ────────────────────────
{
  const rl = createRateLimiter({ maxTrackedKeys: 4 });
  for (let i = 0; i < 10; i++) rl.check(`flood-${i}`, 0, { limit: 1, windowMs: 10_000 });
  assert.ok(rl.size() <= 4, '洪泛下内存有界。');
  assert.ok(rl.size() >= 1, '不是一次清空到 0 —— 增量淘汰保留部分窗口。');
}

console.log('api-auth-core: OK');
