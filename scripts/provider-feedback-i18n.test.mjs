import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const aiFriendsPath = join(root, 'components', 'portal', 'PortalAiFriendsPreview.tsx');
const i18nPath = join(root, 'lib', 'portal', 'i18n.ts');
const packagePath = join(root, 'package.json');

const aiFriends = readFileSync(aiFriendsPath, 'utf8');
const i18n = readFileSync(i18nPath, 'utf8');
const pkg = JSON.parse(readFileSync(packagePath, 'utf8'));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

for (const key of [
  'providerMissingEnv',
  'providerRuntimeNotReady',
  'providerUnavailableTemplate',
  'providerAiUnavailable',
  'providerAiNotConnectedTemplate',
  'providerAiConnectingTemplate',
  'providerAiConnectedTemplate',
]) {
  assert(i18n.includes(`${key}:`), `Expected i18n key ${key}.`);
}

assert(
  aiFriends.includes("from '@/lib/portal/i18n'") && aiFriends.includes('t(locale,'),
  'PortalAiFriendsPreview must use the shared i18n helper for runtime feedback.',
);

for (const forbidden of [
  '暂不可用：${missing}',
  '生产运行态尚未标记为可用',
  'AI 暂时不可用',
  '暂时没有连上：${errorText}',
  '正在连接 ${getProviderLabel(provider)}...',
  '已连接 ${result.model || provider}。',
]) {
  assert(!aiFriends.includes(forbidden), `PortalAiFriendsPreview still contains hard-coded feedback: ${forbidden}`);
}

// 旧代 AccountSettings.tsx 已删(2026-07 契约迁移);provider 反馈翻译
// 意图由活表面 PortalAiFriendsPreview 承载(上方断言),模板键在字典中钉住。
assert(
  aiFriends.includes("t(locale, 'providerUnavailableTemplate'"),
  'Living provider surface must use providerUnavailableTemplate for provider action feedback.',
);

assert(
  pkg.scripts['test:provider-feedback-i18n'] === 'node scripts/provider-feedback-i18n.test.mjs',
  'package.json must expose test:provider-feedback-i18n.',
);

assert(
  pkg.scripts['test:contracts'].includes('test:provider-feedback-i18n'),
  'test:contracts must include test:provider-feedback-i18n.',
);

console.log('provider-feedback-i18n checks passed');
