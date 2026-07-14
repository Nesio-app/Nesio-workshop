/**
 * 行为契约:安全审计 #8 —— session 标记 HMAC 签名防伪造(denial-of-wallet)。
 * 锁死:
 *  - signSessionValue 有密钥+值 → 出稳定签名;无密钥或空值 → ''(调用方跳过写签名)。
 *  - verifySessionValue 只在「值+合法签名」时 true;伪造/无签名/篡改值一律 false(fail-closed)。
 *  - guardAiRoute 的登录回退分支源码级已改为「验签名」而非「看 cookie 是否存在」。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

function loadTs(path, requireImpl) {
  const src = fs.readFileSync(new URL(path, import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports, require: requireImpl,
    Buffer, console, process: { env: {} },
    // node:crypto 走真实实现
    ...{},
  }, { });
  return mod.exports;
}

// crypto 的 require 需返回真 node:crypto;env 桩成可切换密钥。
let SECRET = 'unit-test-secret-key';
const sig = loadTs('../lib/portal/auth/session-sig.ts', (p) =>
  p === 'node:crypto' ? crypto
  : p.includes('/env') ? { envValue: (k) => (k === 'NESIO_SESSION_SIGNING_SECRET' ? SECRET : '') }
  : ({}));

// ── 有密钥:签名 + 验真闭环 ──
{
  const token = 'refresh-token-abc123';
  const s = sig.signSessionValue(token);
  assert.ok(s && typeof s === 'string', '有密钥+值 → 出签名');
  assert.equal(sig.verifySessionValue(token, s), true, '值+合法签名 → 通过');
  assert.equal(sig.verifySessionValue(token, s + 'x'), false, '签名被篡改 → 拒');
  assert.equal(sig.verifySessionValue('other-token', s), false, '换个值配旧签名 → 拒(伪造 refresh)');
  assert.equal(sig.verifySessionValue(token, undefined), false, '无签名(伪造 cookie)→ 拒');
  assert.equal(sig.verifySessionValue('', s), false, '空值 → 拒');
}

// ── 无密钥:不能签、不能验(纯本地无 Supabase 部署走同源分支,不受影响) ──
{
  SECRET = '';
  assert.equal(sig.signSessionValue('t'), '', '无密钥 → 空签名');
  assert.equal(sig.verifySessionValue('t', 'anything'), false, '无密钥 → 一律拒');
  SECRET = 'unit-test-secret-key';
}

// ── verifiedWechatOpenid:只有签名匹配才返回 openid,否则 ''(数据审计 P0) ──
{
  const openid = 'oABC123';
  const s = sig.signSessionValue(openid);
  assert.equal(sig.verifiedWechatOpenid(openid, s), openid, '签名匹配 → 返回 openid');
  assert.equal(sig.verifiedWechatOpenid(openid, undefined), '', '无签名(伪造)→ ""');
  assert.equal(sig.verifiedWechatOpenid('oEVIL', s), '', '换个 openid 配旧签名 → ""(伪造越权被拒)');
  assert.equal(sig.verifiedWechatOpenid(undefined, s), '', '无 openid → ""');
}

// ── 数据审计 P0:据 openid 生成身份的服务端路径都必须走验签 ──
{
  const runtime = fs.readFileSync(new URL('../lib/portal/cloud-server-runtime.ts', import.meta.url), 'utf8');
  assert.ok(runtime.includes('verifiedWechatOpenid'), 'cloud-server-runtime 用 verifiedWechatOpenid(不再裸信 openid cookie)');
  const sessionRoute = fs.readFileSync(new URL('../app/api/auth/session/route.ts', import.meta.url), 'utf8');
  assert.ok(sessionRoute.includes('verifiedWechatOpenid'), '/api/auth/session 用 verifiedWechatOpenid');
  // gmail 等自有 session 门改走验签 helper,不再裸 Boolean(access||refresh||openid)
  for (const f of ['lib/portal/providers/gmail-access.ts', 'app/api/portal/gmail/route.ts', 'app/api/portal/gmail-quick/route.ts']) {
    const src = fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
    assert.ok(src.includes('hasVerifiedSessionCookie'), `${f} 走 hasVerifiedSessionCookie`);
    assert.ok(!/Boolean\(\s*[\s\S]*?baohe_wechat_openid'\)\?\.value,?\s*\)/.test(src), `${f} 不再裸信 openid presence`);
  }
}

// ── 源码级:guard 回退分支已用验签,不再「看 cookie 存在即放行」 ──
{
  const guard = fs.readFileSync(new URL('../lib/portal/auth/api-auth.ts', import.meta.url), 'utf8');
  assert.ok(guard.includes('verifySessionValue'), 'guard 回退分支调用 verifySessionValue');
  assert.ok(!/const hasSession = Boolean\([\s\S]*?baohe_auth_refresh/.test(guard), '旧的「存在即放行」已删除');
  assert.ok(/refresh && verifySessionValue\(refresh/.test(guard), 'refresh 走验签');
  assert.ok(/wechatOpenid && verifySessionValue\(wechatOpenid/.test(guard), 'wechat openid 走验签');
}

// ── 源码级:签发处配套写签名 cookie(否则真用户回退分支验签失败) ──
{
  const callback = fs.readFileSync(new URL('../app/api/auth/callback/route.ts', import.meta.url), 'utf8');
  assert.ok(callback.includes('AUTH_SIG_COOKIE') && callback.includes('signSessionValue(session.refresh_token)'), 'callback 写 refresh 签名');
  assert.ok(callback.includes('WECHAT_SIG_COOKIE') && callback.includes('signSessionValue(session.openid)'), 'callback 写 wechat 签名');
  const session = fs.readFileSync(new URL('../app/api/auth/session/route.ts', import.meta.url), 'utf8');
  assert.ok(session.includes('AUTH_SIG_COOKIE'), 'session 刷新处也写签名');
  const logout = fs.readFileSync(new URL('../app/api/auth/logout/route.ts', import.meta.url), 'utf8');
  assert.ok(logout.includes("'baohe_auth_sig'") && logout.includes("'baohe_wechat_sig'"), 'logout 清签名 cookie');
}

console.log('session-sig: OK');
