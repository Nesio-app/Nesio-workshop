import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const accountSettingsPath = join(root, 'components', 'portal', 'AccountSettings.tsx');
const i18nPath = join(root, 'lib', 'portal', 'i18n.ts');
const packagePath = join(root, 'package.json');

const accountSettings = readFileSync(accountSettingsPath, 'utf8');
const i18n = readFileSync(i18nPath, 'utf8');
const pkg = JSON.parse(readFileSync(packagePath, 'utf8'));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const requiredKeys = [
  'authLoginTitle',
  'authLoginLoading',
  'authLoggedInTemplate',
  'authLoginHelp',
  'authStatusLoggedIn',
  'authStatusEnabled',
  'authStatusPendingConfig',
  'authSignOut',
  'authNeedEmail',
  'authNeedPhone',
  'authConnecting',
  'authUseSignInForm',
  'authRedirecting',
  'authOtpSent',
  'authProviderNotConfiguredTemplate',
  'authMissingEnvFallback',
  'authStartFailed',
  'authServiceFailed',
  'authNotLoggedIn',
  'authSigningOut',
  'authSignedOut',
  'authLogoutFailed',
  'authLogoutServiceFailed',
  'providerStatusChecking',
  'providerStatusNotConnected',
  'providerStatusReady',
  'providerStatusServerReady',
  'providerStatusPendingEnable',
  'providerStatusMissingConfig',
  'providerStatusSynced',
  'providerStatusSyncing',
  'providerStatusNotSignedIn',
  'providerStatusSyncFailed',
  'providerStatusLocalSaved',
  'providerDetailLoadingRuntime',
  'providerDetailReadyWithEndpointTemplate',
  'providerDetailReadyTemplate',
  'providerDetailServerReadyTemplate',
  'providerDetailMissingEnvTemplate',
  'providerDetailConfiguredButDisabled',
  'providerServerReadyFeedbackTemplate',
  'providerStillMissingConfigTemplate',
  'providerConfiguredButRuntimeOffTemplate',
  'providerActionChecking',
  'providerActionInspect',
  'providerActionOpen',
  'providerActionPendingConfig',
  'providerReadStateLater',
  'profileSettingsSyncedDetail',
  'profileSettingsLocalDetail',
  'googleCalendarConnectedDetail',
  'googleCalendarLocalLinkDetail',
  'trustModulesProtectedLabel',
  'trustModulesProtectedStatus',
  'trustModulesProtectedDetail',
  'automationExternalAuthLabel',
  'automationExternalAuthStatus',
  'automationExternalAuthDetail',
  'accountSettingsBack',
  'accountSettingsTitle',
  'accountSettingsAppearanceTitle',
  'accountSettingsAppearanceHint',
  'accountSettingsLanguage',
  'accountSettingsConnections',
  'accountSettingsConnectionsHint',
  'accountSettingsLocalFirst',
  'accountSettingsAvatarChange',
  'accountSettingsHomepage',
  'accountSettingsHomepageAriaLabel',
  'accountSettingsUsageDaysTemplate',
  'accountSettingsOpenSoftwareSettings',
  'accountSettingsLearnedTitle',
  'accountSettingsMemoryCountTemplate',
  'accountSettingsMemoryConfidenceTemplate',
  'accountSettingsMemoryStrengthTemplate',
  'accountSettingsMemoryEmpty',
  'accountSettingsProgressTitle',
  'accountSettingsMemoryEvidenceTemplate',
  'accountSettingsPreferenceSummaryTemplate',
  'accountSettingsCollapseProgress',
  'accountSettingsViewAllProgress',
  'accountSettingsPreferencesTitle',
  'accountSettingsPacePreference',
  'accountSettingsPaceEfficient',
  'accountSettingsPushTime',
  'accountSettingsObservationPush',
  'accountSettingsLanguageAriaLabel',
];

for (const key of requiredKeys) {
  assert(i18n.includes(`${key}:`), `Expected i18n key ${key}.`);
}

for (const forbidden of [
  '请先输入邮箱。',
  '请先输入手机号。',
  '正在连接…',
  '正在跳转授权页面…',
  '验证码已发送，请检查邮箱或手机。',
  '登录尚未配置',
  '缺少环境变量',
  '暂时无法开始登录。',
  '连接登录服务失败，请稍后再试。',
  '当前未登录，无需退出。',
  '正在退出…',
  '已退出登录。',
  '退出登录失败，请稍后再试。',
  '连接退出服务失败，请稍后再试。',
  '账户登录',
  '正在读取登录状态。',
  '邮件、Google、微信、电话都会走生产授权入口；未配置时会明确失败原因。',
  '退出登录',
  '已登录',
  '已开启',
  '待配置',
  '检查中',
  '未连接',
  '可使用',
  '服务端可用',
  '待开启',
  '缺配置',
  '正在读取生产运行状态。',
  '已配置，但生产开关尚未启用。',
  '正在读取连接状态，请稍后再试。',
  '高信任模块不进入首发公开承诺，不提供建议、诊断、交易或真实账户动作。',
  '付费或连接不等于可以安全执行；外部授权和自动执行仍需 CEO Gate。',
  'const SETTINGS_COPY',
  'settingsTitle: \'软件设置\'',
  'appearanceTitle: \'外观\'',
  'connections: \'连接与安全\'',
  'localFirst: \'本地优先\'',
  'aria-label="更换头像"',
  'aria-label="进入个人主页"',
  'aria-label={`强度 ${memory.strength}`}',
  '已使用第 {personalization.daysSinceStart} 天',
  '宝盒学到的',
  '置信度 {memory.confidence}%',
  '再用几天，宝盒就会有新发现。',
  '全部学习进展',
  '证据 {memory.evidenceCount} 条 · 置信度 {memory.confidence}%',
  '偏好：{personalization.preferences.pace}节奏 · 推送时间 {personalization.preferences.pushTime}',
  '收起学习进展 ↑',
  '查看全部学习进展 →',
  '个性化偏好',
  '节奏偏好',
  '推送时间',
  '允许洞察推送',
  'aria-label="语言"',
]) {
  assert(!accountSettings.includes(forbidden), `AccountSettings still contains hard-coded auth/runtime text: ${forbidden}`);
}

assert(
  accountSettings.includes("t(locale, 'authNeedEmail')"),
  'AccountSettings must use shared i18n for missing email feedback.',
);

assert(
  accountSettings.includes("t(locale, 'providerStatusReady')"),
  'AccountSettings must use shared i18n for provider status labels.',
);

assert(
  accountSettings.includes("t(locale, 'accountSettingsTitle')"),
  'AccountSettings app settings title must use shared i18n.',
);

assert(
  accountSettings.includes("t(locale, 'accountSettingsConnectionsHint')"),
  'AccountSettings connection hint must use shared i18n.',
);

assert(
  accountSettings.includes("formatAccountSettingsUsageDays(locale, personalization.daysSinceStart)"),
  'AccountSettings usage days text must use shared i18n formatter.',
);

assert(
  accountSettings.includes("formatAccountSettingsMemoryConfidence(locale, memory.confidence)"),
  'AccountSettings memory confidence text must use shared i18n formatter.',
);

assert(
  accountSettings.includes("formatAccountSettingsMemoryStrength(locale, memory.strength)"),
  'AccountSettings memory strength aria text must use shared i18n formatter.',
);

assert(
  accountSettings.includes("formatAccountSettingsPreferenceSummary(locale, personalization.preferences.pace, personalization.preferences.pushTime)"),
  'AccountSettings preference summary must use shared i18n formatter.',
);

assert(
  pkg.scripts['test:account-settings-auth-i18n'] === 'node scripts/account-settings-auth-i18n.test.mjs',
  'package.json must expose test:account-settings-auth-i18n.',
);

assert(
  pkg.scripts['test:contracts'].includes('test:account-settings-auth-i18n'),
  'test:contracts must include test:account-settings-auth-i18n.',
);

console.log('account-settings-auth-i18n checks passed');
