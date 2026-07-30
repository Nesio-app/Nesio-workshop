/**
 * 行为契约:安全审计 #2/#3/#5 —— 付费云 AI 面补门(免费成本泄漏)。
 * 锁死:
 *  - entitlement 导出 guardPaidCloudAi(拦截时派发 nesio-pro-gate、返回 false)。
 *  - 此前「连名义门都没有」的云 AI 用户入口都接上 guardPaidCloudAi(分层启用后免费被拦)。
 *  - 后台被动增强(引导语)用 canUsePaidCloudAi 静默跳过(无弹窗)。
 *  - #3 email_reply / #5 简报旁路 接上 canUse 门(死门/旁路补齐)。
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');

// ── 闸函数存在且拦截时派发升级引导 ──
{
  const ent = read('lib/portal/entitlement.ts');
  assert.ok(/export function guardPaidCloudAi/.test(ent), 'entitlement 导出 guardPaidCloudAi');
  assert.ok(ent.includes("'nesio-pro-gate'"), 'guardPaidCloudAi 派发 nesio-pro-gate');
  assert.ok(/if \(canUsePaidCloudAi\(\)\) return true/.test(ent), '放行走 canUsePaidCloudAi');
}

// ── 用户触发的云 AI 入口:接 guardPaidCloudAi ──
// (bug3 起 HangNoteSheet 不在此列 —— 记一条改成纯手动输入,不再有云调用)
const GATED = [
  ['components/portal/today/MeetingRecorderSheet.tsx', 'meeting_notes'],
  ['components/portal/NesioProfileCard.tsx', 'avatar_ai'],
  ['components/portal/InventorySheet.tsx', 'inventory_extract'],
  ['components/portal/NesioChatSheet.tsx', 'inventory_extract'],
  ['components/portal/health/HealthDashboard.tsx', 'health_insight'],
];
for (const [file, feature] of GATED) {
  const src = read(file);
  assert.ok(src.includes('guardPaidCloudAi'), `${file} 引入 guardPaidCloudAi`);
  assert.ok(src.includes(`guardPaidCloudAi('${feature}')`), `${file} 用 feature=${feature} 接门`);
}

// ── living_model 已退役(410);API 仍保留 guard,客户端入口已删 ──
{
  const route = read('app/api/portal/living-model/route.ts');
  assert.ok(route.includes('guardAiRoute'), 'living-model API 仍 guardAiRoute(410 不花 token)');
  const sheet = read('components/portal/InsightsSheet.tsx');
  assert.doesNotMatch(sheet, /guardPaidCloudAi\('living_model'\)/, 'InsightsSheet 不再调 living_model 云 AI');
}

{
  const today = read('components/portal/today/useTodayData.ts');
  assert.ok(/!cachedCopy && canUsePaidCloudAi\(\)/.test(today), '引导语润色分层启用后静默跳过');
}

// ── #3 email_reply 死门接线 ──
{
  const email = read('components/portal/EmailComposeSheet.tsx');
  assert.ok(email.includes("canUse('email_reply')"), 'EmailComposeSheet.aiDraft 接 email_reply 门');
}

// ── #5 简报旁路补门 ──
{
  const settings = read('components/portal/SettingsSheets.tsx');
  assert.ok(settings.includes("canUse('ai_routine')"), 'Lab 简报 demo 接 ai_routine 门(不旁路)');
}

console.log('paid-cloud-gate: OK');
