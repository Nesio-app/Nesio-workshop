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
  ['components/portal/DashboardHome.tsx', '再拆小一点'],
  ['components/portal/PortalAiFriendsPreview.tsx', '一个输入框，后台自动调度 AI 与工具'],
  ['components/portal/PortalAiFriendsPreview.tsx', '@Claude'],
  ['components/portal/PortalAiFriendsPreview.tsx', '@Flomo'],
  ['components/portal/PortalAiFriendsPreview.tsx', 'Live 通话'],
  ['components/portal/PortalAiFriendsPreview.tsx', 'AI 虚拟形象视频通话'],
  ['components/portal/ToolsTreasureSheet.tsx', '工具箱'],
  ['components/portal/ToolsTreasureSheet.tsx', '个性化推荐'],
  ['components/portal/ToolsTreasureSheet.tsx', '我的工具'],
  ['components/portal/ToolsTreasureSheet.tsx', '效率日常包'],
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

console.log('baohe V14 runtime implementation tests passed');
