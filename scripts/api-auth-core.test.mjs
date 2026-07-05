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

// ── 限流:达到 key 上限时清空(粗粒度内存上限,不崩)────────────────────────
{
  const rl = createRateLimiter({ maxTrackedKeys: 2 });
  assert.equal(rl.check('a', 0, { limit: 1, windowMs: 1000 }), false);
  assert.equal(rl.check('b', 0, { limit: 1, windowMs: 1000 }), false);
  assert.equal(rl.size(), 2, '已跟踪 2 个 key(达上限)。');
  rl.check('c', 0, { limit: 1, windowMs: 1000 }); // 触发 clear + 记新
  assert.ok(rl.size() <= 2, '达上限后清空,内存有界。');
}

console.log('api-auth-core: OK');
