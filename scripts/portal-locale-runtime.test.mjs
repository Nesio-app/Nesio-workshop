import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const profilePath = join(root, 'lib', 'portal', 'profile.ts');
const accountSettingsPath = join(root, 'components', 'portal', 'AccountSettings.tsx');
const dashboardHomePath = join(root, 'components', 'portal', 'DashboardHome.tsx');
const portalPath = join(root, 'components', 'portal', 'Portal.tsx');
const toolsTreasureSheetPath = join(root, 'components', 'portal', 'ToolsTreasureSheet.tsx');
const i18nPath = join(root, 'lib', 'portal', 'i18n.ts');
const packagePath = join(root, 'package.json');

const profile = readFileSync(profilePath, 'utf8');
const accountSettings = readFileSync(accountSettingsPath, 'utf8');
const dashboardHome = readFileSync(dashboardHomePath, 'utf8');
const portal = readFileSync(portalPath, 'utf8');
const toolsTreasureSheet = readFileSync(toolsTreasureSheetPath, 'utf8');
const i18n = readFileSync(i18nPath, 'utf8');
const pkg = JSON.parse(readFileSync(packagePath, 'utf8'));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const expectedLocales = [
  'zh',
  'en',
  'zh-TW',
  'ja',
  'ko',
  'fr',
  'de',
  'es',
  'it',
  'pt',
  'vi',
  'th',
];

for (const locale of expectedLocales) {
  assert(
    profile.includes(`'${locale}'`) || profile.includes(`"${locale}"`),
    `Portal profile locale contract must include ${locale}.`,
  );
}

assert(
  profile.includes('SUPPORTED_PORTAL_LOCALES'),
  'Profile settings should expose a single supported locale list.',
);
assert(
  profile.includes('PORTAL_LOCALE_OPTIONS'),
  'Profile settings should expose display labels from the same locale contract.',
);
assert(
  profile.includes('normalizePortalLocale'),
  'Profile settings should normalize saved/cloud locale values instead of ad hoc checks.',
);
assert(
  profile.includes('portalLocaleToHtmlLang'),
  'Profile settings should map portal locales to document.documentElement.lang.',
);
assert(
  !profile.includes("localeRaw === 'en' ? 'en' : 'zh'"),
  'Profile settings must not collapse every non-English locale to zh.',
);
assert(
  !profile.includes("patch.locale === 'en' ? 'en' : 'zh-CN'"),
  'Profile settings must set document language from the full locale map.',
);
assert(
  accountSettings.includes('normalizePortalLocale'),
  'AccountSettings should use the shared locale normalizer.',
);
assert(
  accountSettings.includes('portalLocaleToHtmlLang'),
  'AccountSettings should use the shared HTML lang mapper.',
);
assert(
  accountSettings.includes('PORTAL_LOCALE_OPTIONS'),
  'AccountSettings language dropdown should render from the shared locale contract.',
);
assert(
  !accountSettings.includes('const LANGUAGE_OPTIONS'),
  'AccountSettings must not keep a duplicate language option list.',
);
assert(
  !accountSettings.includes('document.documentElement.lang = next.displayLanguage'),
  'Cloud display language sync must use portalLocaleToHtmlLang instead of raw portal locale codes.',
);
assert(
  !accountSettings.includes("next === 'en' ? 'en' : 'zh'"),
  'AccountSettings language selector must preserve every supported language code.',
);
assert(
  dashboardHome.includes('portalLocaleToHtmlLang'),
  'DashboardHome should use the shared HTML lang mapper.',
);
assert(
  !dashboardHome.includes("s.locale === 'en' ? 'en' : 'zh-CN'"),
  'DashboardHome must not collapse every non-English locale to zh-CN.',
);
assert(
  i18n.includes('portalLocaleToDictionaryLocale'),
  'i18n should use an explicit dictionary fallback for locales without full translations yet.',
);
for (const key of [
  'toolboxTitle',
  'toolboxSubtitle',
  'toolboxMyTools',
  'toolboxAddable',
  'toolboxPackageSection',
  'toolboxTrustBoundary',
  'dashboardMoodCalm',
  'dashboardMoodSafe',
  'dashboardMoodRestored',
  'dashboardMoodFocused',
  'dashboardMoodHopeful',
  'dashboardMoodCreative',
  'dashboardMoodTender',
  'dashboardMoodAnxious',
  'dashboardMoodAlert',
  'dashboardMoodBright',
  'dashboardMoodGrounded',
  'dashboardMoodLow',
  'dashboardInsightPositiveFeedback',
  'dashboardInsightNegativeFeedback',
  'dashboardInsightNeutralFeedback',
  'dashboardCrushStepRememberGiftHints',
  'dashboardCrushStepAskAiOptions',
  'dashboardCrushStepConfirmDelivery',
  'dashboardCrushStepKeywordTemplate',
  'dashboardCrushStepNarrowOptionsTemplate',
  'dashboardCrushStepOneMinuteAction',
  'dashboardCrushStepDecideTomorrow',
  'dashboardReminderKicker',
  'dashboardAskAiNextStep',
  'dashboardCrushTaskButton',
  'dashboardCrushTaskClose',
  'dashboardReminderDeferred',
  'dashboardReminderNext',
  'dashboardInventoryTitle',
  'dashboardInventoryWeeklyList',
  'dashboardInventoryWeeklyRestockTitle',
  'dashboardInventoryMilkLine',
  'dashboardInventoryVitaminLine',
  'dashboardInventorySkincareLine',
  'dashboardInventoryRestockAction',
  'dashboardInventoryWatchAction',
  'dashboardInventoryAiHint',
  'dashboardInventoryAddItem',
  'dashboardInventoryViewAll',
  'dashboardQuoteOpenSettingsLabel',
  'dashboardCrushGiftTitle',
  'dashboardCrushStepListLabel',
  'dashboardCrushStepDoneLabel',
  'dashboardCrushFirstStepLabel',
  'dashboardCrushSecondStepLabel',
  'dashboardCrushThirdStepLabel',
  'dashboardCrushSplitMore',
  'dashboardCrushFinishStep',
  'dashboardCrushLater',
  'dashboardCrushOpenTodo',
  'dashboardMoodClose',
  'dashboardMoodTitle',
  'dashboardMoodWheelLabel',
  'dashboardMoodInstruction',
  'dashboardMoodDone',
  'dashboardHealthGateClose',
  'dashboardHealthGateTitle',
  'dashboardHealthGateHeading',
  'dashboardHealthGateBuy',
  'dashboardHealthGateLater',
  'dashboardScheduleClose',
  'dashboardScheduleTitle',
  'dashboardScheduleFirstLabel',
  'dashboardScheduleTaskEmail',
  'dashboardScheduleStart1430',
  'dashboardScheduleSuggestedToday',
  'dashboardScheduleTodayLabel',
  'dashboardScheduleMeetingTitle',
  'dashboardScheduleStart1500',
  'dashboardScheduleRemaining4Hours',
  'dashboardScheduleLaterLabel',
  'dashboardScheduleQuarterlyReport',
  'dashboardScheduleStartFriday',
  'dashboardScheduleThisWeek',
  'dashboardReminderDetailClose',
  'dashboardReminderMeetingLabel',
  'dashboardReminderDetailLabel',
  'dashboardMeetingDescription',
  'dashboardMeetingTimeRemaining',
  'dashboardMeetingJoin',
  'dashboardMeetingConnectCalendar',
  'dashboardMeetingRecordingStarted',
  'dashboardMeetingRecordingStart',
  'dashboardTaskDetailBody',
  'dashboardTaskTimeSuggested',
  'dashboardTaskHandleInAiFriends',
  'dashboardReminderClose',
  'purchasedToolsClose',
  'purchasedToolsTitle',
  'purchasedToolsInventoryTitle',
  'purchasedToolsInventoryStatus',
  'purchasedToolsSpendingTitle',
  'purchasedToolsSpendingStatus',
  'purchasedToolsTodoTitle',
  'purchasedToolsTodoStatus',
  'purchasedToolsAddMoreTitle',
  'purchasedToolsAddMoreStatus',
  'dashboardHeaderTimeWeatherAriaLabel',
  'dashboardQuoteSettingsTitle',
  'dashboardQuoteSettingsClose',
  'dashboardQuoteSettingsHint',
  'dashboardQuoteSettingsCategories',
  'dashboardQuoteSettingsFrequency',
  'dashboardQuoteSettingsExternal',
  'dashboardCoachActionAriaLabel',
  'dashboardCoachEventSummaryTemplate',
  'dashboardImportantDate',
  'dashboardMomBirthday',
  'dashboardNextHolidayFallback',
  'dashboardEnergyAriaLabel',
  'dashboardEnergyTitle',
  'dashboardEnergyBody',
  'dashboardInsightTitle',
  'dashboardInsightClose',
  'dashboardInsightAccurate',
  'dashboardInsightNotQuite',
]) {
  assert(
    i18n.includes(`${key}:`),
    `i18n must define ${key} for portal runtime copy.`,
  );
}
for (const key of [
  'dashboardCrushStepRememberGiftHints',
  'dashboardCrushStepAskAiOptions',
  'dashboardCrushStepConfirmDelivery',
  'dashboardCrushStepKeywordTemplate',
  'dashboardCrushStepNarrowOptionsTemplate',
  'dashboardCrushStepOneMinuteAction',
  'dashboardCrushStepDecideTomorrow',
  'dashboardReminderKicker',
  'dashboardAskAiNextStep',
  'dashboardCrushTaskButton',
  'dashboardCrushTaskClose',
  'dashboardReminderDeferred',
  'dashboardReminderNext',
  'dashboardInventoryTitle',
  'dashboardInventoryWeeklyList',
  'dashboardInventoryWeeklyRestockTitle',
  'dashboardInventoryMilkLine',
  'dashboardInventoryVitaminLine',
  'dashboardInventorySkincareLine',
  'dashboardInventoryRestockAction',
  'dashboardInventoryWatchAction',
  'dashboardInventoryAiHint',
  'dashboardInventoryAddItem',
  'dashboardInventoryViewAll',
  'dashboardQuoteOpenSettingsLabel',
  'dashboardCrushGiftTitle',
  'dashboardCrushStepListLabel',
  'dashboardCrushStepDoneLabel',
  'dashboardCrushFirstStepLabel',
  'dashboardCrushSecondStepLabel',
  'dashboardCrushThirdStepLabel',
  'dashboardCrushSplitMore',
  'dashboardCrushFinishStep',
  'dashboardCrushLater',
  'dashboardCrushOpenTodo',
  'dashboardMoodClose',
  'dashboardMoodTitle',
  'dashboardMoodWheelLabel',
  'dashboardMoodInstruction',
  'dashboardMoodDone',
  'dashboardHealthGateClose',
  'dashboardHealthGateTitle',
  'dashboardHealthGateHeading',
  'dashboardHealthGateBuy',
  'dashboardHealthGateLater',
  'dashboardScheduleClose',
  'dashboardScheduleTitle',
  'dashboardScheduleFirstLabel',
  'dashboardScheduleTaskEmail',
  'dashboardScheduleStart1430',
  'dashboardScheduleSuggestedToday',
  'dashboardScheduleTodayLabel',
  'dashboardScheduleMeetingTitle',
  'dashboardScheduleStart1500',
  'dashboardScheduleRemaining4Hours',
  'dashboardScheduleLaterLabel',
  'dashboardScheduleQuarterlyReport',
  'dashboardScheduleStartFriday',
  'dashboardScheduleThisWeek',
  'dashboardReminderDetailClose',
  'dashboardReminderMeetingLabel',
  'dashboardReminderDetailLabel',
  'dashboardMeetingDescription',
  'dashboardMeetingTimeRemaining',
  'dashboardMeetingJoin',
  'dashboardMeetingConnectCalendar',
  'dashboardMeetingRecordingStarted',
  'dashboardMeetingRecordingStart',
  'dashboardTaskDetailBody',
  'dashboardTaskTimeSuggested',
  'dashboardTaskHandleInAiFriends',
  'dashboardReminderClose',
  'dashboardHeaderTimeWeatherAriaLabel',
  'dashboardQuoteSettingsTitle',
  'dashboardQuoteSettingsClose',
  'dashboardQuoteSettingsHint',
  'dashboardQuoteSettingsCategories',
  'dashboardQuoteSettingsFrequency',
  'dashboardQuoteSettingsExternal',
  'dashboardCoachActionAriaLabel',
  'dashboardCoachEventSummaryTemplate',
  'dashboardImportantDate',
  'dashboardMomBirthday',
  'dashboardNextHolidayFallback',
  'dashboardEnergyAriaLabel',
  'dashboardEnergyTitle',
  'dashboardEnergyBody',
  'dashboardInsightTitle',
  'dashboardInsightClose',
  'dashboardInsightAccurate',
  'dashboardInsightNotQuite',
]) {
  assert(
    dashboardHome.includes(`t(locale, '${key}'`),
    `DashboardHome must render ${key} through the shared i18n dictionary.`,
  );
}
for (const key of [
  'purchasedToolsClose',
  'purchasedToolsTitle',
  'purchasedToolsInventoryTitle',
  'purchasedToolsInventoryStatus',
  'purchasedToolsSpendingTitle',
  'purchasedToolsSpendingStatus',
  'purchasedToolsTodoTitle',
  'purchasedToolsTodoStatus',
  'purchasedToolsAddMoreTitle',
  'purchasedToolsAddMoreStatus',
]) {
  assert(
    portal.includes(`t(locale, '${key}'`),
    `Portal must render ${key} through the shared i18n dictionary.`,
  );
}
for (const key of [
  'dashboardMoodCalm',
  'dashboardMoodSafe',
  'dashboardMoodRestored',
  'dashboardMoodFocused',
  'dashboardMoodHopeful',
  'dashboardMoodCreative',
  'dashboardMoodTender',
  'dashboardMoodAnxious',
  'dashboardMoodAlert',
  'dashboardMoodBright',
  'dashboardMoodGrounded',
  'dashboardMoodLow',
  'dashboardInsightPositiveFeedback',
  'dashboardInsightNegativeFeedback',
  'dashboardInsightNeutralFeedback',
]) {
  assert(
    dashboardHome.includes(key),
    `DashboardHome must keep ${key} as an i18n key, not raw visible copy.`,
  );
}
assert(
  dashboardHome.includes('t(locale, selectedMood.labelKey)'),
  'DashboardHome selected mood copy must render through the shared i18n dictionary.',
);
assert(
  dashboardHome.includes('t(locale, hoveredMood.labelKey)'),
  'DashboardHome mood wheel hover copy must render through the shared i18n dictionary.',
);
assert(
  dashboardHome.includes('t(locale, insightFeedbackKey)'),
  'DashboardHome insight feedback copy must render through the shared i18n dictionary.',
);
for (const key of [
  'toolboxTitle',
  'toolboxSubtitle',
  'toolboxMyTools',
  'toolboxAddable',
  'toolboxPackageSection',
  'toolboxTrustBoundary',
]) {
  assert(
    toolsTreasureSheet.includes(`t(locale, '${key}'`),
    `ToolsTreasureSheet must render ${key} through the shared i18n dictionary.`,
  );
}
for (const phrase of [
  '>工具箱<',
  '>我的工具<',
  '>可添加<',
  '>工具包<',
  '健康 / 金融 / 心理 / 自动化仍需确认后开放。',
  '发现适合你的工具，一键加入工作台',
]) {
  assert(
    !toolsTreasureSheet.includes(phrase),
    `ToolsTreasureSheet must not hard-code toolbox phrase: ${phrase}`,
  );
}
for (const phrase of [
  '慢慢来',
  '安心',
  '回暖',
  '专注',
  '有希望',
  '想象力',
  '需要照顾',
  '有点焦虑',
  '警觉',
  '轻快',
  '稳住',
  '低能量',
  '收到，我会越来越懂你的节奏。',
  '记下来了，下一次提醒会更贴近你。',
  '谢谢你校准我，Nesio 会慢慢变聪明。',
  '想想妈妈最近提过、喜欢的东西',
  '在智友里看看 AI 推荐的几个方案',
  '选一个，确认 5 天内能到货',
  '只做下一分钟能完成的小动作',
  '决定一个，或者明天再定也行',
  '当前时间与天气',
  '金句设置',
  '关闭金句设置',
  '选择想看到的金句类型和刷新频率。设置只保存在本机浏览器。',
  '切换频率',
  '允许公共外部金句补充',
  '今日教练行动',
  '重要日期',
  '妈妈生日',
  '下一个节假日 · 可在设置中切换国家',
  '今日能量，打开健康工具',
  '今日能量',
  '昨晚睡得好，身体在慢慢回升',
  '发现了一件关于你的事',
  '关闭洞察',
  '这很准确',
  '不太对',
  '温馨提醒',
  '问智友下一步',
  '粉碎任务',
  '已换一条',
  '下一条',
  '物品库',
  '本周清单',
  '可整理本周补货清单',
  '全脂牛奶 · 冰箱',
  '维生素 C · 药柜',
  '保湿护肤霜 · 梳妆台',
  '补货',
  '关注',
  '提前备好，生活从容 · 可让智友帮你处理',
  '记录物品',
  '查看全部',
  '点击设置',
  '给妈妈准备生日礼物',
  '粉碎步骤',
  '已拆成更小的 3 步',
  '第一步',
  '第二步',
  '第三步',
  '还是太大？再拆细',
  '完成这一步',
  '稍后',
  '打开待办',
  '关闭心情选择',
  '此刻心情',
  '心情轮',
  '按住滑动选择，松手后保留在这里；点背景返回主页',
  '健康工具',
  '健康 Dashboard 尚未加入工作台',
  '去工具箱购买',
  '关闭健康工具提示',
  '关闭今日安排',
  '今日安排',
  '陪你看见 · 今天可以做的事',
  '先做这一件就好',
  '回复王总邮件',
  '开始 14:30',
  '建议今天',
  '产品会议',
  '开始 15:00',
  '还剩 4 小时',
  '不急，有空再看',
  '准备季度报告',
  '开始 周五',
  '本周内',
  '关闭提醒详情',
  '会议提醒',
  '提醒详情',
  '产品团队周会，15:00 @ 会议室 B',
  '时间 / 还剩 4 小时',
  '加入会议',
  '连接日历查看会议',
  '会议记录已开始，结束后生成纪要',
  '开始 AI 会议记录',
  '关于 Q3 预算调整方案，回一句也算往前走了一步。',
  '时间 / 建议今天',
  '在智友里处理',
]) {
  assert(
    !dashboardHome.includes(phrase),
    `DashboardHome must not hard-code visible phrase: ${phrase}`,
  );
}
for (const phrase of [
  '关闭已购买工具',
  '已购买工具',
  '物品库',
  '3 件即将到期',
  '支出记录',
  '本周 ¥949',
  '待办清单',
  '3 项待处理',
  '添加更多工具',
  '去工具箱发现',
]) {
  assert(
    !portal.includes(phrase),
    `Portal must not hard-code purchased-tools phrase: ${phrase}`,
  );
}
assert(
  pkg.scripts['test:portal-locale-runtime'] === 'node scripts/portal-locale-runtime.test.mjs',
  'package.json must expose test:portal-locale-runtime.',
);
assert(
  pkg.scripts['test:contracts'].includes('test:portal-locale-runtime'),
  'test:contracts must include portal locale runtime coverage.',
);

console.log('portal locale runtime checks passed');
