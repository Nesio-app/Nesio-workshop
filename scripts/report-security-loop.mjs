/**
 * L-4 安全循环(report-only)。
 *
 * 曾发生:14 个 AI route 裸露公网无人知、Next.js critical CVE 积压 20+。
 * 本脚本每周报告:①依赖漏洞计数 ②花钱/私据 route 的守卫覆盖
 * ③docs/api-routes.md 登记新鲜度。
 *
 * 用法:node scripts/report-security-loop.mjs [--markdown]
 * 输出末行 SECURITY_TOTAL=<n>(high/critical 漏洞数 + 未守卫 route 数)。
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const root = process.cwd();
const markdown = process.argv.includes('--markdown');
const findings = [];

// ── 1. npm audit(生产依赖)────────────────────────────────────────────────────
let auditCounts = { critical: 0, high: 0, moderate: 0, low: 0 };
try {
  const out = execSync('npm audit --omit=dev --json', { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  auditCounts = JSON.parse(out).metadata?.vulnerabilities ?? auditCounts;
} catch (err) {
  // npm audit 有漏洞时退出码非 0,stdout 仍是 JSON
  try { auditCounts = JSON.parse(err.stdout).metadata?.vulnerabilities ?? auditCounts; }
  catch { findings.push({ kind: 'audit_unavailable', detail: 'npm audit 无法解析' }); }
}
if (auditCounts.critical > 0 || auditCounts.high > 0) {
  findings.push({ kind: 'vuln_high_or_critical', detail: `生产依赖漏洞: critical=${auditCounts.critical} high=${auditCounts.high}(moderate=${auditCounts.moderate})` });
}

// ── 2. Route 守卫覆盖:调 AI/读私据的 route 必须有守卫 ────────────────────────
const AI_MARKERS = ['api.anthropic.com', 'generativelanguage', 'api.openai.com', 'GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY'];
const GUARD_MARKERS = ['guardAiRoute', 'isPortalRequestAuthorized', 'isAnalyzeAiAllowed', 'isIngestAllowed', 'isSecretaryAiRequestAllowed', 'requireAuthenticatedGmailAccess', 'requireAuthenticatedCalendarAccess', 'hasStage5LabAccess', 'INGEST_SHARED_SECRET'];
// OAuth 预授权流程和 lib/health 内部封装:route 侧无守卫是设计使然
const EXEMPT = ['gmail/connect', 'gmail/callback', 'calendar/connect', 'calendar/oauth'];

function walkRoutes(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walkRoutes(p, out);
    else if (entry.name === 'route.ts') out.push(p);
  }
  return out;
}

const routes = walkRoutes(join(root, 'app', 'api'));
const guardedRoutes = [];
for (const routePath of routes) {
  const rel = routePath.slice(root.length + 1);
  if (EXEMPT.some((e) => rel.includes(e))) continue;
  const src = readFileSync(routePath, 'utf8');
  const spendsMoney = AI_MARKERS.some((m) => src.includes(m)) ||
    // 经由 lib 间接调用 AI(如 lib/health/gemini)
    src.includes('geminiGenerate(') || src.includes('embedTextRaw');
  if (!spendsMoney) continue;
  const guarded = GUARD_MARKERS.some((m) => src.includes(m));
  if (guarded) guardedRoutes.push(rel);
  else findings.push({ kind: 'route_unguarded', detail: `${rel} 调用 AI/花钱但没有任何守卫标记 — 需要 guardAiRoute(见 lib/portal/api-auth.ts)` });
}

// ── 3. api-routes.md 新鲜度:守卫过的 route 必须登记 ──────────────────────────
const apiDoc = existsSync(join(root, 'docs', 'api-routes.md')) ? readFileSync(join(root, 'docs', 'api-routes.md'), 'utf8') : '';
for (const rel of guardedRoutes) {
  const urlPath = '/' + rel.replace(/^app/, 'api').replace('app/', '').replace('/route.ts', '').replace(/^api\//, 'api/');
  const simplePath = '/' + rel.replace('app/', '').replace('/route.ts', '');
  if (!apiDoc.includes(simplePath) && !apiDoc.includes(urlPath)) {
    findings.push({ kind: 'route_undocumented', detail: `${simplePath} 有守卫但未登记 docs/api-routes.md` });
  }
}

// ── 输出 ──────────────────────────────────────────────────────────────────────
if (markdown) {
  console.log('## 安全循环报告(L-4,只报告)\n');
  console.log(`依赖漏洞: critical=${auditCounts.critical} high=${auditCounts.high} moderate=${auditCounts.moderate} low=${auditCounts.low}\n`);
  if (findings.length === 0) console.log('✅ 无安全项。\n');
  for (const f of findings) console.log(`- **${f.kind}**: ${f.detail}`);
} else {
  console.log(`依赖漏洞: critical=${auditCounts.critical} high=${auditCounts.high} moderate=${auditCounts.moderate}`);
  for (const f of findings) console.log(`[${f.kind}] ${f.detail}`);
  console.log(`\n安全项合计: ${findings.length}`);
}
const severe = auditCounts.critical + auditCounts.high + findings.filter((f) => f.kind === 'route_unguarded').length;
console.log(`SECURITY_TOTAL=${severe}`);
