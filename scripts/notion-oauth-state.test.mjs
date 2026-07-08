import assert from 'node:assert/strict';
import { buildSignedState, verifySignedState } from '../lib/portal/providers/notion-oauth-state.mjs';

const SECRET = 'test-secret';
const NOW = 1_800_000_000_000;

// 往返:带 userId
{
  const state = buildSignedState({ userId: 'user-abc-123', secret: SECRET, now: NOW });
  const v = verifySignedState(state, SECRET, NOW + 60_000);
  assert.equal(v.ok, true, 'valid state must verify');
  assert.equal(v.ok && v.userId, 'user-abc-123', 'userId must roundtrip');
}

// 往返:匿名(空 userId)
{
  const state = buildSignedState({ userId: '', secret: SECRET, now: NOW });
  const v = verifySignedState(state, SECRET, NOW);
  assert.equal(v.ok, true);
  assert.equal(v.ok && v.userId, '', 'empty userId must roundtrip');
}

// 篡改签名 → 拒
{
  const state = buildSignedState({ userId: 'u', secret: SECRET, now: NOW });
  const tampered = state.slice(0, -4) + (state.endsWith('aaaa') ? 'bbbb' : 'aaaa');
  const v = verifySignedState(tampered, SECRET, NOW);
  assert.equal(v.ok, false);
  assert.equal(!v.ok && v.reason, 'bad_signature');
}

// 篡改 userId → 拒(签名覆盖 payload)
{
  const state = buildSignedState({ userId: 'victim', secret: SECRET, now: NOW });
  const parts = state.split('.');
  parts[1] = Buffer.from('attacker', 'utf8').toString('base64url');
  const v = verifySignedState(parts.join('.'), SECRET, NOW);
  assert.equal(v.ok, false, 'userId swap must fail signature');
}

// 错误 secret → 拒
{
  const state = buildSignedState({ userId: 'u', secret: SECRET, now: NOW });
  const v = verifySignedState(state, 'other-secret', NOW);
  assert.equal(v.ok, false);
  assert.equal(!v.ok && v.reason, 'bad_signature');
}

// 过期(>15 分钟)→ expired
{
  const state = buildSignedState({ userId: 'u', secret: SECRET, now: NOW });
  const v = verifySignedState(state, SECRET, NOW + 16 * 60 * 1000);
  assert.equal(v.ok, false);
  assert.equal(!v.ok && v.reason, 'expired');
}

// 未来时间戳(时钟倒挂容忍 60s)→ expired
{
  const state = buildSignedState({ userId: 'u', secret: SECRET, now: NOW + 5 * 60 * 1000 });
  const v = verifySignedState(state, SECRET, NOW);
  assert.equal(v.ok, false);
  assert.equal(!v.ok && v.reason, 'expired');
}

// 老格式随机 state → legacy(调用方回落 cookie 对比)
{
  for (const legacy of ['nesio-random-uuid', '', 'a.b.c', 'v2.x.y.z.w']) {
    const v = verifySignedState(legacy, SECRET, NOW);
    assert.equal(v.ok, false, `legacy ${legacy}`);
    assert.equal(!v.ok && v.reason, 'legacy', `legacy reason for ${legacy}`);
  }
}

// 15 分钟窗口内可用
{
  const state = buildSignedState({ userId: 'u', secret: SECRET, now: NOW });
  const v = verifySignedState(state, SECRET, NOW + 14 * 60 * 1000);
  assert.equal(v.ok, true, 'within window must verify');
}

console.log('notion oauth state tests passed');
