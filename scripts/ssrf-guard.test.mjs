/**
 * 行为契约:SSRF 守卫(直接执行 ssrf-guard)。
 *
 * parse-url 此前无鉴权、无 SSRF 过滤 → 可让服务器代抓 http://169.254.169.254/(云元数据)
 * 或内网地址。守护:内网/环回/链路本地/元数据一律拦,公网放行。
 */
import assert from 'node:assert/strict';
import { isPrivateOrReservedIp, isBlockedHostname, isBlockedUrl } from '../lib/portal/ssrf-guard.mjs';

// ── 私有/保留 IP ───────────────────────────────────────────────────────────
for (const ip of ['169.254.169.254', '127.0.0.1', '10.0.0.5', '192.168.1.1', '172.16.0.1', '172.31.255.255', '100.64.0.1', '0.0.0.0', '::1', 'fc00::1', 'fd12::1', 'fe80::1', '::ffff:127.0.0.1']) {
  assert.equal(isPrivateOrReservedIp(ip), true, `${ip} 应判为私有/保留(SSRF 目标)。`);
}
for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111']) {
  assert.equal(isPrivateOrReservedIp(ip), false, `${ip} 是公网,应放行。`);
}
// 172.15/172.32 不在私有段
assert.equal(isPrivateOrReservedIp('172.15.0.1'), false, '172.15 不在私有段。');
assert.equal(isPrivateOrReservedIp('172.32.0.1'), false, '172.32 不在私有段。');

// ── 主机名 ─────────────────────────────────────────────────────────────────
for (const h of ['localhost', 'foo.localhost', 'db.local', 'svc.internal', 'metadata.google.internal', '169.254.169.254', '127.0.0.1', '[::1]']) {
  assert.equal(isBlockedHostname(h), true, `${h} 应被拦。`);
}
for (const h of ['example.com', 'api.github.com', 'weread.qq.com']) {
  assert.equal(isBlockedHostname(h), false, `${h} 是公网主机,应放行。`);
}

// ── URL ────────────────────────────────────────────────────────────────────
for (const u of ['http://169.254.169.254/latest/meta-data/', 'http://localhost:3000/admin', 'https://192.168.1.1/', 'file:///etc/passwd', 'ftp://example.com/x', 'gopher://x', 'not a url']) {
  assert.equal(isBlockedUrl(u), true, `${u} 应被拦。`);
}
for (const u of ['https://example.com/product/123', 'http://weread.qq.com/x']) {
  assert.equal(isBlockedUrl(u), false, `${u} 应放行。`);
}

console.log('ssrf-guard: OK');
