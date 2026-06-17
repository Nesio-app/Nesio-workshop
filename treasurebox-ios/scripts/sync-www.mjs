import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const iosRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(iosRoot, '..');
const wwwDir = join(iosRoot, 'www');

const portalConfigPath = join(repoRoot, 'public', 'portal-config.json');
const portalConfig = JSON.parse(readFileSync(portalConfigPath, 'utf8'));

const launchReadyIds = new Set(['inventory']);
const launchPrimaryIds = new Set(['inventory']);

const iosPortalConfig = {
  ...portalConfig,
  tools: portalConfig.tools.map((tool) => {
    if (tool.id === 'inventory') {
      return { ...tool, url: 'storage/index.html', ready: true, status: 'ready', integrationMode: 'local' };
    }
    return {
      ...tool,
      url: '#',
      ready: false,
      featured: false,
      status: 'gated',
      integrationMode: 'contract-only',
    };
  }),
};

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function localHref(tool) {
  if (tool.id === 'inventory') return 'storage/index.html';
  if (tool.id === 'plan') return 'adhd-flow/index.html';
  if (tool.id === 'reading') return 'reading/index.html';
  if (tool.id === 'fitness') return 'fitness/index.html';
  return '#';
}

function statusLabel(tool) {
  if (tool.id === 'inventory') return '首发可用';
  if (launchReadyIds.has(tool.id)) return '本地可用';
  return '未来 / gated';
}

function card(tool) {
  const ready = launchReadyIds.has(tool.id) && tool.ready !== false;
  const primary = launchPrimaryIds.has(tool.id);
  const href = ready ? localHref(tool) : '#';
  const classes = ['tool-card', ready ? 'is-ready' : 'is-gated', primary ? 'is-primary' : ''].filter(Boolean).join(' ');
  const action = ready ? '打开' : '不可用';
  return `
      <a class="${classes}" href="${href}" data-module-id="${escapeHtml(tool.id)}" data-status="${ready ? 'ready' : 'gated'}" aria-disabled="${ready ? 'false' : 'true'}">
        <span class="tool-icon">${escapeHtml(tool.icon || '□')}</span>
        <span class="tool-body">
          <strong>${escapeHtml(tool.name)}</strong>
          <small>${escapeHtml(tool.nameEn || '')}</small>
          <span>${escapeHtml(tool.description || '')}</span>
        </span>
        <em>${escapeHtml(statusLabel(tool))}</em>
        <b>${action}</b>
      </a>`;
}

function buildShellHtml() {
  const cards = iosPortalConfig.tools.map(card).join('\n');
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="theme-color" content="#588ce3">
  <title>宝盒</title>
  <link rel="manifest" href="manifest.json">
  <style>
    :root{color-scheme:light;--bg:#eef4fd;--ink:#14213d;--muted:#64748b;--line:rgba(40,80,140,.14);--blue:#588ce3;--blue2:#2f67c8;--card:rgba(255,255,255,.86);font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Segoe UI",sans-serif}
    *{box-sizing:border-box}body{margin:0;min-height:100vh;background:linear-gradient(180deg,#f8fbff 0%,var(--bg) 42%,#e8f0fb 100%);color:var(--ink);-webkit-font-smoothing:antialiased}
    .shell{min-height:100vh;padding:calc(env(safe-area-inset-top) + 18px) 18px calc(env(safe-area-inset-bottom) + 22px);max-width:760px;margin:0 auto}
    header{display:flex;align-items:center;justify-content:space-between;gap:16px;margin:6px 0 18px}
    .brand h1{margin:0;font-size:30px;letter-spacing:0;font-weight:800}.brand p{margin:5px 0 0;color:var(--muted);font-size:14px}
    .badge{border:1px solid var(--line);background:rgba(255,255,255,.72);border-radius:999px;padding:8px 11px;color:var(--blue2);font-size:12px;font-weight:750;white-space:nowrap}
    .hero{border:1px solid var(--line);background:linear-gradient(135deg,rgba(255,255,255,.9),rgba(223,235,253,.86));border-radius:24px;padding:18px;box-shadow:0 18px 50px rgba(49,96,160,.13);margin-bottom:16px}
    .hero strong{display:block;font-size:18px;margin-bottom:7px}.hero span{display:block;color:var(--muted);font-size:14px;line-height:1.55}
    .primary-flow{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:14px;padding:13px 14px;border-radius:16px;background:#fff;color:var(--blue2);text-decoration:none;border:1px solid rgba(88,140,227,.2);font-weight:800}
    .grid{display:grid;grid-template-columns:1fr;gap:10px}.tool-card{display:grid;grid-template-columns:42px 1fr auto;grid-template-areas:"icon body meta" "icon body action";gap:6px 12px;align-items:center;text-decoration:none;color:inherit;background:var(--card);border:1px solid var(--line);border-radius:18px;padding:13px;min-height:86px}
    .tool-card.is-primary{border-color:rgba(88,140,227,.42);box-shadow:0 14px 34px rgba(49,96,160,.13)}.tool-card.is-gated{opacity:.58}
    .tool-icon{grid-area:icon;width:42px;height:42px;border-radius:13px;display:grid;place-items:center;background:#edf4ff;font-size:23px}
    .tool-body{grid-area:body;min-width:0}.tool-body strong{display:block;font-size:16px}.tool-body small{display:block;margin-top:1px;color:var(--blue2);font-size:11px;font-weight:800}.tool-body span{display:block;margin-top:4px;color:var(--muted);font-size:12px;line-height:1.4}
    .tool-card em{grid-area:meta;font-style:normal;color:var(--muted);font-size:11px;white-space:nowrap}.tool-card b{grid-area:action;justify-self:end;border-radius:999px;background:var(--blue);color:#fff;font-size:12px;padding:6px 10px}.tool-card.is-gated b{background:#d6deeb;color:#667085}
    footer{margin:18px 0 0;color:var(--muted);font-size:12px;line-height:1.5;text-align:center}
    @media(min-width:680px){.grid{grid-template-columns:1fr 1fr}.tool-card.is-primary{grid-column:1/-1}}
  </style>
</head>
<body>
  <main class="shell">
    <header>
      <div class="brand"><h1>宝盒</h1><p>首发 iOS 本地壳 · Shell</p></div>
      <div class="badge">本地运行</div>
    </header>
    <section class="hero">
      <strong>首发路径已收敛到本地可用能力。</strong>
      <span>高风险 AI、财务、健康、心理、支付、外部授权和通知能力保持未来 / gated 状态。当前主流程是进入收纳，完成 Inventory 本地体验。</span>
      <a class="primary-flow" href="storage/index.html">进入收纳 Inventory <span>→</span></a>
    </section>
    <section class="grid" aria-label="宝盒工具">
${cards}
    </section>
    <footer>Capacitor 本地 bundle · 不签名发布 · 不连接真实外部服务</footer>
  </main>
</body>
</html>
`;
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

if (existsSync(wwwDir)) rmSync(wwwDir, { recursive: true, force: true });
mkdirSync(wwwDir, { recursive: true });

writeFileSync(join(wwwDir, 'index.html'), buildShellHtml());
writeJson(join(wwwDir, 'portal-config.json'), iosPortalConfig);
writeJson(join(wwwDir, 'manifest.json'), {
  name: '宝盒',
  short_name: '宝盒',
  start_url: '.',
  display: 'standalone',
  background_color: '#eef4fd',
  theme_color: '#588ce3',
  orientation: 'portrait',
  icons: [
    { src: 'icons/treasurebox-pwa-192.png', sizes: '192x192', type: 'image/png' },
    { src: 'icons/treasurebox-pwa-512.png', sizes: '512x512', type: 'image/png' },
  ],
});

cpSync(join(repoRoot, 'public', 'icons'), join(wwwDir, 'icons'), { recursive: true });
cpSync(join(repoRoot, 'storage-web'), join(wwwDir, 'storage'), { recursive: true });
cpSync(join(repoRoot, 'storage-web', 'portal-back.css'), join(wwwDir, 'portal-back.css'));

writeFileSync(join(wwwDir, 'config.js'), "// iOS first-launch bundle: no remote API by default.\nwindow.TREASUREBOX_API = '';\n");

console.log('Synced Treasurebox iOS first-launch bundle:', wwwDir);
console.log('Launch-ready path: storage/index.html');
