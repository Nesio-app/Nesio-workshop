/**
 * SSRF 守卫(纯函数,供服务端 route 与 node 行为测试共用)。
 *
 * 用于任何"拿用户给的 URL 去 fetch"的路由(如 parse-url)。挡住指向内网/环回/
 * 链路本地/云元数据(169.254.169.254)的目标,防服务端请求伪造。
 * 注:主机名同步检查 + 路由里再做一次 DNS 解析复查(见调用点),仍有 DNS rebinding
 * 的 TOCTOU 残余,但已挡住绝大多数(IP 直连/内网主机名/元数据)。
 */

/** IPv4/IPv6 是否属于私有/保留/环回/链路本地范围。 */
export function isPrivateOrReservedIp(ip) {
  const s = String(ip || '').toLowerCase().replace(/^\[|\]$/g, '');
  const v4 = s.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const a = Number(v4[1]), b = Number(v4[2]);
    if (a === 0 || a === 127 || a === 10) return true;              // 本网络 / 环回 / 私有
    if (a === 169 && b === 254) return true;                        // 链路本地 + 云元数据 169.254.169.254
    if (a === 172 && b >= 16 && b <= 31) return true;               // 私有
    if (a === 192 && b === 168) return true;                        // 私有
    if (a === 100 && b >= 64 && b <= 127) return true;              // CGNAT
    if (a >= 224) return true;                                      // 组播/保留
    return false;
  }
  if (s === '::1' || s === '::') return true;                       // 环回 / 未指定
  if (s.startsWith('fe80')) return true;                           // 链路本地
  if (s.startsWith('fc') || s.startsWith('fd')) return true;       // ULA fc00::/7
  if (s.startsWith('::ffff:')) return isPrivateOrReservedIp(s.slice(7)); // v4-mapped
  return false;
}

/** 主机名是否应被拦(localhost/内网后缀/元数据/私有 IP 直连)。 */
export function isBlockedHostname(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.lan')) return true;
  if (h === 'metadata.google.internal') return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(':')) return isPrivateOrReservedIp(h);
  return false;
}

/** URL 是否应被拦(协议非 http(s) / 主机被拦)。 */
export function isBlockedUrl(url) {
  let u;
  try { u = new URL(String(url)); } catch { return true; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return true;
  return isBlockedHostname(u.hostname);
}
