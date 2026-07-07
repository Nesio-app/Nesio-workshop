/**
 * Notion OAuth state 的签名与校验(纯函数,可单测)。
 *
 * 修「iOS PWA 连不上 Notion」的结构性断点之一:旧实现把随机 state 存在发起
 * 浏览器的 cookie 里,回调若落在另一个浏览器上下文(iOS 上 Notion App 劫持
 * 授权后把 redirect_uri 交给 Safari,而不是发起的 PWA),cookie 不在 →
 * state_mismatch,授权永远失败。
 *
 * 改为自携带签名 state:HMAC 签名 + 时间窗校验,不依赖任何 cookie;
 * 同时把发起时的 Supabase userId 编进 state,回调在陌生上下文里也知道
 * 该把 token 存到谁的 Supabase integrations 里(跨上下文/跨设备可见)。
 */
import { createHmac } from 'node:crypto';

const VERSION = 'v1';
const MAX_AGE_MS = 15 * 60 * 1000; // 授权流程给 15 分钟

function b64url(input) {
  return Buffer.from(input, 'utf8').toString('base64url');
}

function fromB64url(input) {
  try {
    return Buffer.from(input, 'base64url').toString('utf8');
  } catch {
    return '';
  }
}

function sign(payload, secret) {
  return createHmac('sha256', String(secret || '')).update(payload).digest('hex').slice(0, 32);
}

/**
 * @param {{ userId?: string; secret: string; now?: number; nonce?: string }} opts
 * @returns {string} `v1.<uid_b64url>.<ts36>.<nonce>.<sig>`
 */
export function buildSignedState({ userId = '', secret, now = Date.now(), nonce }) {
  const n = nonce || Math.random().toString(36).slice(2, 12);
  const payload = `${VERSION}.${b64url(userId)}.${now.toString(36)}.${n}`;
  return `${payload}.${sign(payload, secret)}`;
}

/**
 * @param {string} state
 * @param {string} secret
 * @param {number} [now]
 * @returns {{ ok: true; userId: string } | { ok: false; reason: 'legacy'|'bad_signature'|'expired' }}
 *   `legacy` = 不是 v1 签名格式(老的随机 state)→ 调用方回落到 cookie 对比。
 */
export function verifySignedState(state, secret, now = Date.now()) {
  const parts = String(state || '').split('.');
  if (parts.length !== 5 || parts[0] !== VERSION) {
    return { ok: false, reason: 'legacy' };
  }
  const [version, uid, ts36, nonce, sig] = parts;
  const payload = `${version}.${uid}.${ts36}.${nonce}`;
  if (sign(payload, secret) !== sig) {
    return { ok: false, reason: 'bad_signature' };
  }
  const issuedAt = parseInt(ts36, 36);
  if (!Number.isFinite(issuedAt) || now - issuedAt > MAX_AGE_MS || issuedAt - now > 60 * 1000) {
    return { ok: false, reason: 'expired' };
  }
  return { ok: true, userId: fromB64url(uid) };
}
