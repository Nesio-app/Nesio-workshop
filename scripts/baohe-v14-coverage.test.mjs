import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = process.cwd();
const reportPath = join(repoRoot, 'outputs/2026-06-19-baohe-v14-runtime-implementation-qiao.md');
const report = readFileSync(reportPath, 'utf8');

const requiredReportText = [
  '00 Direction / Engineering Handoff',
  '01 Onboarding / Name',
  '02 Onboarding / Coach Style',
  '03 Home / Warm Coach',
  '04 Sheet / Crush Task',
  '05 AI Friends / Stable Hub',
  '06 Tool Packs / Discovery',
  '07 Inventory / Purchase Memory',
  '08 Me / Connections & Safety',
  'Public launch modules remain `plan` and `inventory`',
  'outputs/v14-runtime-screenshots/01-onboarding-name.png',
  'outputs/v14-runtime-screenshots/02-onboarding-coach-style.png',
  'Figma delivery is skipped per user; this report covers V14 source/runtime implementation only',
];

for (const text of requiredReportText) {
  assert.match(report, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
}

const sourceChecks = [
  ['components/portal/PortalOnboarding.tsx', '欢迎来到宝盒'],
  ['components/portal/DashboardHome.tsx', '温馨提醒'],
  ['components/portal/DashboardHome.tsx', '粉碎任务'],
  ['components/portal/DashboardHome.tsx', '物品库'],
  ['components/portal/DashboardHome.tsx', '还是太大？再拆细'],
  ['components/portal/PortalAiFriendsPreview.tsx', '输入框搞定一切'],
  ['components/portal/PortalAiFriendsPreview.tsx', '@Claude'],
  ['components/portal/PortalAiFriendsPreview.tsx', '@Flomo'],
  ['components/portal/PortalAiFriendsPreview.tsx', 'Live 通话'],
  ['components/portal/PortalAiFriendsPreview.tsx', 'AI 虚拟形象视频通话'],
  ['components/portal/PortalAiFriendsPreview.tsx', 'AI_CAPABILITIES'],
  ['components/portal/PortalAiFriendsPreview.tsx', 'activeCapability'],
  ['components/portal/PortalAiFriendsPreview.tsx', 'handleCapabilityAction'],
  ['components/portal/ToolsTreasureSheet.tsx', '工具箱'],
  ['components/portal/ToolsTreasureSheet.tsx', '个性化推荐'],
  ['components/portal/ToolsTreasureSheet.tsx', '我的工具'],
  ['components/portal/ToolsTreasureSheet.tsx', '效率日常包'],
  ['components/portal/ToolsTreasureSheet.tsx', 'selectedToolboxAction'],
  ['components/portal/ToolsTreasureSheet.tsx', 'handleAddTool'],
  ['components/portal/ToolsTreasureSheet.tsx', 'handleSelectPackage'],
  ['lib/portal/personalization-insights.ts', '家居物品'],
  ['lib/portal/personalization-insights.ts', '任务清单'],
  ['lib/portal/personalization-insights.ts', '第 34 天'],
  ['lib/portal/personalization-insights.ts', 'shouldShowBaoheInsight'],
  ['lib/portal/personalization-insights.ts', 'rememberBaoheInsightFeedback'],
  ['components/portal/AccountSettings.tsx', '宝盒学到的'],
  ['components/portal/AccountSettings.tsx', '置信度'],
  ['components/portal/AccountSettings.tsx', '个性化偏好'],
  ['components/portal/AccountSettings.tsx', '软件设置'],
  ['components/portal/AccountSettings.tsx', '连接与安全'],
  ['storage-web/index.html', 'Inventory / purchase-memory'],
  ['e2e/shell-discovery.spec.ts', 'settings exposes V14 connections and safety boundary'],
  ['e2e/storage-local-backup.spec.ts', 'storage PWA exports local data and restores it after clearing'],
];

for (const [relativePath, text] of sourceChecks) {
  const content = readFileSync(join(repoRoot, relativePath), 'utf8');
  assert.match(content, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${relativePath} must contain ${text}`);
}

const toolboxSource = readFileSync(join(repoRoot, 'components/portal/ToolsTreasureSheet.tsx'), 'utf8');
const aiFriendsSource = readFileSync(join(repoRoot, 'components/portal/PortalAiFriendsPreview.tsx'), 'utf8');
assert.match(
  aiFriendsSource,
  /AI_CAPABILITIES\.map[\s\S]{0,1200}onClick=\{\(\) => handleCapabilityAction\(capability\.id\)/,
  'AI Friends capability rail must be metadata-driven and every visible capability button must have a runtime action.',
);
assert.match(
  aiFriendsSource,
  /aria-pressed=\{activeCapability === capability\.id\}/,
  'AI Friends capability buttons must expose active state feedback.',
);
assert.doesNotMatch(
  toolboxSource,
  /portal-treasure-screen-grid[\s\S]{0,900}<button key=\{label\} type="button" disabled>/,
  'Toolbox addable tools must not render disabled buttons; every visible control needs a local action.',
);
assert.doesNotMatch(
  toolboxSource,
  /portal-treasure-data-grid[\s\S]{0,1400}disabled=\{!tool\}/,
  'Toolbox owned/data cards must not disable missing modules; they need an add/purchase/request action.',
);
assert.doesNotMatch(
  toolboxSource,
  /portal-treasure-my-grid[\s\S]{0,1400}disabled=\{!tool\}/,
  'Toolbox popup preview cards must not disable missing modules; they need an add/purchase/request action.',
);
assert.match(
  toolboxSource,
  /handleRequestToolAccess[\s\S]{0,900}kind:\s*'tool'/,
  'Toolbox missing module cards must route to a local access request action.',
);
assert.match(
  toolboxSource,
  /portal-treasure-discovery-hero[\s\S]{0,1000}onClick=\{\(\) => handleAddTool\('gift-concierge'/,
  'Toolbox recommendation CTA must record a real local add action.',
);
assert.match(
  toolboxSource,
  /TOOL_PACKAGES[\s\S]{0,260}'efficiency-daily'/,
  'Toolbox package metadata must include the efficiency daily package.',
);
assert.match(
  toolboxSource,
  /portal-treasure-package-list[\s\S]{0,260}TOOL_PACKAGES\.map/,
  'Toolbox package cards must be sourced from package metadata.',
);
assert.match(
  toolboxSource,
  /onClick=\{\(\) => handleSelectPackage\(pack\.id, pack\.label\)/,
  'Toolbox package cards must update local selection state.',
);

console.log('baohe V14 runtime implementation tests passed');
