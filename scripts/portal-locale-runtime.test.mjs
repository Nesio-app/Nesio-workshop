import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const profilePath = join(root, 'lib', 'portal', 'profile.ts');
const accountSettingsPath = join(root, 'components', 'portal', 'AccountSettings.tsx');
const dashboardHomePath = join(root, 'components', 'portal', 'DashboardHome.tsx');
const i18nPath = join(root, 'lib', 'portal', 'i18n.ts');
const packagePath = join(root, 'package.json');

const profile = readFileSync(profilePath, 'utf8');
const accountSettings = readFileSync(accountSettingsPath, 'utf8');
const dashboardHome = readFileSync(dashboardHomePath, 'utf8');
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
assert(
  pkg.scripts['test:portal-locale-runtime'] === 'node scripts/portal-locale-runtime.test.mjs',
  'package.json must expose test:portal-locale-runtime.',
);
assert(
  pkg.scripts['test:contracts'].includes('test:portal-locale-runtime'),
  'test:contracts must include portal locale runtime coverage.',
);

console.log('portal locale runtime checks passed');
