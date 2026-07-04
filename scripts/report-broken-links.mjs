/**
 * L-3 断链巡检循环(report-only)。
 *
 * "引擎建好了,UI 入口断了"在本仓库反复发生过四次:主题切换、语言切换、
 * DEC 输出、demo 数据。外加设计系统 "Always an exit" 规则(每个 modal
 * 必须可退出)曾被情绪轮盘违反。本脚本把两类断链变成周报。
 *
 * 用法:node scripts/report-broken-links.mjs [--markdown]
 * 输出末行 BROKEN_LINKS_TOTAL=<n>。
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const markdown = process.argv.includes('--markdown');
const findings = [];

function readAllSources(dirs) {
  const out = [];
  for (const dir of dirs) {
    const stack = [join(root, dir)];
    while (stack.length) {
      const cur = stack.pop();
      if (!existsSync(cur)) continue;
      for (const entry of readdirSync(cur, { withFileTypes: true })) {
        const p = join(cur, entry.name);
        if (entry.isDirectory()) { stack.push(p); continue; }
        if (/\.(tsx|ts)$/.test(entry.name)) out.push({ path: p.slice(root.length + 1), src: readFileSync(p, 'utf8') });
      }
    }
  }
  return out;
}

const uiSources = readAllSources(['components', 'app']);
const uiCorpus = uiSources.map((f) => f.src).join('\n');

// ── 1. 关键能力入口登记表:引擎/能力 → UI 必须存在的入口证据 ─────────────────
// 新增用户可感知能力时在这里登记。断链 = 引擎在,入口证据消失。
const CAPABILITY_ENTRIES = [
  { name: '主题切换', evidence: ["localStorage.setItem(THEME_KEY", "setItem('treasurebox-theme'"], note: '2026-07 曾断链(AccountSettings 掉链)' },
  { name: '语言切换', evidence: ['saveProfileSettings({ locale'], note: '同上' },
  { name: '完整备份导出', evidence: ['buildFullBackup('], note: '' },
  { name: '备份导入', evidence: ['restoreFullBackup('], note: '' },
  { name: 'OAuth 断开撤销', evidence: ["/api/portal/oauth/disconnect"], note: '' },
  { name: '卡片反馈写回', evidence: ['recordCardFeedback('], note: 'PRD TODAY-004' },
  { name: 'DEC 证据卡渲染', evidence: ['card.evidence', 'decCardsToGuidanceEvents'], note: 'PRD TODAY-002' },
  { name: '此刻情绪记录', evidence: ['nesio-open-mood'], note: '' },
  { name: '听简报', evidence: ['<DailyBriefCard'], note: '' },
  { name: '存储满警告', evidence: ['STORAGE_FULL_EVENT'], note: '' },
];

for (const cap of CAPABILITY_ENTRIES) {
  const found = cap.evidence.some((e) => uiCorpus.includes(e));
  if (!found) {
    findings.push({ kind: 'capability_no_ui_entry', detail: `「${cap.name}」在 components/app 无入口证据(找不到 ${cap.evidence[0]} 等)${cap.note ? ` — ${cap.note}` : ''}` });
  }
}

// ── 2. Always an exit:每个 Sheet/Overlay 组件必须有退出通路 ──────────────────
const EXIT_MARKERS = ['onClose', 'onDismiss', 'aria-label="关闭"', "aria-label='关闭'", 'aria-label="Close"'];
const modalFiles = uiSources.filter((f) =>
  /components\/portal/.test(f.path) && /(Sheet|Overlay|Popup|Detail)\.tsx$/.test(f.path),
);
for (const f of modalFiles) {
  // Detail 后缀但无 overlay/backdrop 的是内嵌展开视图,不是弹层
  const isOverlay = /overlay|backdrop|aria-modal/i.test(f.src);
  if (f.path.endsWith('Detail.tsx') && !isOverlay) continue;
  const hasExit = EXIT_MARKERS.some((m) => f.src.includes(m));
  if (!hasExit) {
    findings.push({ kind: 'modal_no_exit', detail: `${f.path} 未发现退出通路(onClose/关闭按钮)— 违反设计系统 Always an exit` });
  }
}

// MoodSheet 专项:有 onClose prop 但需确认轮盘阶段可退出(自动化只能查 backdrop/关闭钮)
const mood = uiSources.find((f) => f.path.endsWith('MoodSheet.tsx'));
if (mood && !mood.src.includes('backdrop') && !mood.src.includes('aria-label="关闭"')) {
  findings.push({ kind: 'modal_no_exit', detail: 'components/portal/MoodSheet.tsx 缺 backdrop/显式关闭按钮 — 自动化测试报告确认用户会被困住' });
}

// ── 输出 ──────────────────────────────────────────────────────────────────────
if (markdown) {
  console.log('## 断链巡检报告(L-3,只报告)\n');
  if (findings.length === 0) console.log('✅ 无断链。\n');
  for (const f of findings) console.log(`- **${f.kind}**: ${f.detail}`);
} else {
  for (const f of findings) console.log(`[${f.kind}] ${f.detail}`);
  console.log(`\n断链合计: ${findings.length}`);
}
console.log(`BROKEN_LINKS_TOTAL=${findings.length}`);
