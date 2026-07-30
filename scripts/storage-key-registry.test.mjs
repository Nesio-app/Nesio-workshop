/**
 * 行为契约:本机存储 key 的**分类注册表**(2026-07-29 全量普查后建立)。
 *
 * 为什么需要它 —— 一条系统性漏洞:storage-manifest 的 keyKind() 默认返回 `durable`,
 * 意味着**任何新 key 只要没人主动登记,就自动获得「进备份 + 整键 replace 上云」的待遇**。
 * 这不是理论风险,本次普查真捡出两类事故:
 *   · 凭证被当用户数据:`nesio-connector-tokens-v1`(连接器原始令牌)与 `nesio_admin_secret`
 *     (管理密钥)双双判成 durable —— 明文进备份 JSON、并推到云端 user_module_data。
 *     根因是靠"猜词"识别凭证:正则写 `token([-_]|$)` 认不出复数 `tokens-v1`,更没有 `secret`。
 *   · 按设备簿记被当用户数据:同步水位/日键卡片状态/草稿等 24 个键,每轮 churn 上云,
 *     且整键 replace 会让两台设备互相抹掉对方的状态。
 *
 * 于是把「有哪些 key、各属哪类」钉成清单(同 sheet-primitive-allowlist 的形):
 *   ① 源码里出现的每个存储 key 都必须在册 —— 新键不登记即 CI 红,逼你当场决定它该不该上云;
 *   ② 在册键的**实际**分类必须与声明一致 —— 谁改坏了 AUTH_RE / CACHE_KEYS,这里立刻红;
 *   ③ 凭证键必须是 auth(绝不进备份)、核心用户数据必须是 durable(必须进备份)。
 *
 * 判据(登记新键时问自己):换台设备后这个值「从头开始」是否**正确**?
 *   是 → cache(簿记/缓存/日键状态)  否 → durable(用户数据/设置/裁决)  凭证 → auth
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

const ROOT = new URL('..', import.meta.url).pathname;

// ── 载入真实分类器 ──
function loadManifest() {
  const src = fs.readFileSync(path.join(ROOT, 'lib/portal/storage-manifest.ts'), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, require: () => ({}), console, Set, Map, JSON, Object, Array, String, RegExp });
  return mod.exports;
}
const { keyKind } = loadManifest();

// ── 扫描源码里真实用到的存储 key ──
function scanKeys() {
  const found = new Set();
  const PREFIX = /^(nesio[-_]|treasurebox-|baohe[-_]|analyst_|nianguichu_|first_launch|text-embed|rg-mode)/;
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (!/node_modules|\.next|\.git/.test(p)) walk(p); continue; }
      if (!/\.(ts|tsx)$/.test(e.name) || /\.test\./.test(e.name)) continue;
      const s = fs.readFileSync(p, 'utf8');
      const add = (k) => { if (PREFIX.test(k)) found.add(k); };
      for (const m of s.matchAll(/(?:local|session)Storage\.(?:get|set|remove)Item\(\s*['"`]([^'"`]+)['"`]/g)) add(m[1]);
      for (const m of s.matchAll(/(?:KEY|Key)\s*[:=]\s*['"`]([^'"`]+)['"`]/g)) add(m[1]);
    }
  };
  for (const d of ['lib', 'components', 'app']) walk(path.join(ROOT, d));
  return found;
}

/**
 * 在册清单。新增 key 时把它加到这里并**想清楚归哪类**(判据见文件头)。
 * 顺序即分类,值必须与 keyKind() 的实际判定一致。
 */
const KNOWN_KEYS = new Map([
  // ── auth ──
  ["nesio-auth-intent-v1", "auth"],
  ["nesio-connector-tokens-v1", "auth"],
  ["nesio-plaid-link-token", "auth"],
  ["nesio_admin_secret", "auth"],
  // ── cache ──
  ["nesio-a2hs-dismissed-until", "cache"],
  ["nesio-ai-cache-v1", "cache"],
  ["nesio-ask-guide-seen-v1", "cache"],
  ["nesio-backup-synced-entrycount-v1", "cache"],
  ["nesio-bank-synced-at", "cache"],
  ["nesio-calendar-local-v1", "cache"],
  ["nesio-capture-fix-cache-v1", "cache"],
  ["nesio-card-archive-v1", "cache"],
  ["nesio-chunk-reload", "cache"],
  ["nesio-chunk-reload-at", "cache"],
  ["nesio-cloud-backup-last-v1", "cache"],
  ["nesio-connectors-autosync-at-v1", "cache"],
  ["nesio-drive-backup-at", "cache"],
  ["nesio-email-signals-cache", "cache"],
  ["nesio-email-sync-state-v1", "cache"],
  ["nesio-family-strip-fetch-at-v1", "cache"],
  ["nesio-first-memory-receipt-shown-v1", "cache"],
  ["nesio-focus-dismissed-v1", "cache"],
  ["nesio-gmail-last-sync", "cache"],
  ["nesio-guidance-judge-ledger-v1", "cache"],
  ["nesio-heal-earned", "cache"],
  ["nesio-jot-draft-v1", "cache"],
  ["nesio-judge-dismissed-v1", "cache"],
  ["nesio-last-backup-at", "cache"],
  ["nesio-last-location-v1", "cache"],
  ["nesio-life-graph-cloud-sync-outbox-v1", "cache"],
  ["nesio-life-graph-cloud-sync-v1", "cache"],
  ["nesio-module-sync-since-v1", "cache"],
  ["nesio-module-sync-state-v1", "cache"],
  ["nesio-node-embeddings-v1", "cache"],
  ["nesio-pending-ask-image", "cache"],
  ["nesio-pending-ask-text", "cache"],
  ["nesio-place-geocode-enabled", "cache"],
  ["nesio-place-image-sync-state-v1", "cache"],
  ["nesio-plaid-enrich-v1", "cache"],
  ["nesio-pro-entitlement-v1", "cache"],
  ["nesio-proactive-dismissed", "cache"],
  ["nesio-push-enabled-v1", "cache"],
  ["nesio-reader-sync-state-v1", "cache"],
  ["nesio-retro-dismissed-v1", "cache"],
  ["nesio-revgeo-cache-v1", "cache"],
  ["nesio-server-entitlement-v1", "cache"],
  ["nesio-storage-alert-snooze-v1", "cache"],
  ["nesio-storage-warned-at", "cache"],
  ["nesio-telemetry-device-v1", "cache"],
  ["nesio-tips-shown-v1", "cache"],
  ["nesio-today-cards-v1", "cache"],
  ["nesio-today-dismissed-v1", "cache"],
  ["nesio-version-reload", "cache"],
  ["nesio-wrapped-last", "cache"],
  ["nesio-xlib-draft-v1", "cache"],
  ["treasurebox-personalization-insight-shown-day", "cache"],
  // ── durable ──
  ["baohe_lab_mode", "durable"],
  ["baohe_personal_lab", "durable"],
  ["first_launch_high_risk_isolation_v0", "durable"],
  ["nesio-app-sessions-v1", "durable"],
  ["nesio-backup-dest", "durable"],
  ["nesio-bank-accounts-v1", "durable"],
  ["nesio-bank-flow-rule-v1", "durable"],
  ["nesio-bank-merchant-rule-v1", "durable"],
  ["nesio-bank-recur-v1", "durable"],
  ["nesio-bank-rule-label-v1", "durable"],
  ["nesio-bank-sync-status-v1", "durable"],
  ["nesio-bank-tx-v1", "durable"],
  ["nesio-baseline-v1", "durable"],
  ["nesio-body-ledger-goals-v1", "durable"],
  ["nesio-capture-loc-v1", "durable"],
  ["nesio-card-verdict-v1", "durable"],
  ["nesio-clinical-v1", "durable"],
  ["nesio-cloud-restore-receipt-v1", "durable"],
  ["nesio-connectors-v1", "durable"],
  ["nesio-core-memories-v1", "durable"],
  ["nesio-cross-region-bandit-retired-purge-v1", "durable"],
  ["nesio-cross-region-consent-v1", "durable"],
  ["nesio-cross-region-delivery-cooldown-v1", "durable"],
  ["nesio-daily-report-auto-v1", "durable"],
  ["nesio-dormant-store", "durable"],
  ["nesio-energy-baseline-v1", "durable"],
  ["nesio-asset-care-v1", "durable"],
  ["nesio-bank-acct-names-v1", "durable"],
  ["nesio-meal-calendar-v1", "durable"],
  ["nesio-schedule-filters-v1", "durable"],
  // 用户自己敲进去的提醒(家务/账单 due)。换台设备后从头开始**不正确** —— 那是他
  // 亲手写下的东西,丢了就是丢了,所以 durable。
  ["nesio-schedule-reminders-v1", "durable"],
  // 邮件里认出的「安排」我处理过没有(加进日程了 / 不用了)。「不用了」是一个决定 ——
  // 在手机上按掉的建议换到电脑上又冒出来,等于这个决定没被记住,所以 durable。
  ["nesio-mail-suggest-v1", "durable"],
  ["nesio-migration-completed-v1", "cache"],
  ["nesio-migration-log-v1", "cache"],
  ["nesio-entity-aliases-v1", "durable"],
  ["nesio-expenses-v1", "durable"],
  ["nesio-experiments-v2", "durable"],
  ["nesio-fact-journal-v1", "durable"],
  ["nesio-feature-usage-v1", "durable"],
  ["nesio-fin-assets-v1", "durable"],
  ["nesio-fin-budget-v1", "durable"],
  ["nesio-fin-holdings-v1", "durable"],
  ["nesio-fin-networth-series-v1", "durable"],
  ["nesio-fin-report-auto-v1", "durable"],
  ["nesio-font-scale-v1", "durable"],
  ["nesio-freeze-vault-v1", "durable"],
  ["nesio-generated-recipes-v1", "durable"],
  ["nesio-haptic-feedback-enabled-v1", "durable"],
  ["nesio-health-projected-v1", "durable"],
  ["nesio-health-report-auto-v1", "durable"],
  ["nesio-health-picks-v1", "durable"],
  ["nesio-health-v1", "durable"],
  ["nesio-hourly-wage-v1", "durable"],
  ["nesio-hub-order-v1", "durable"],
  ["nesio-img-hash-v1", "durable"],
  ["nesio-life-graph-v1", "durable"],
  ["nesio-living-model-v1", "durable"],
  ["nesio-local-owner-v1", "durable"],
  ["nesio-med-log-v1", "durable"],
  ["nesio-mirror-letter-feedback-v1", "durable"],
  ["nesio-mirror-letters-v1", "durable"],
  ["nesio-mirror-profile-v1", "durable"],
  ["nesio-module-overrides-v1", "durable"],
  ["nesio-named-places", "durable"],
  ["nesio-notion-db-v1", "durable"],
  ["nesio-person-records-v1", "durable"],
  ["nesio-pins-v1", "durable"],
  ["nesio-place-alias-v1", "durable"],
  ["nesio-place-cat-v1", "durable"],
  ["nesio-place-geo-v1", "durable"],
  ["nesio-place-photos-v1", "durable"],
  ["nesio-place-renames-v1", "durable"],
  ["nesio-place-trail-v1", "durable"],
  ["nesio-plaid-liabilities-v1", "durable"],
  ["nesio-plaid-recurring-v1", "durable"],
  ["nesio-plan-notify-optin-v1", "durable"],
  ["nesio-preference-v1", "durable"],
  ["nesio-proactive-level-v1", "durable"],
  ["nesio-proactive-muted-v1", "durable"],
  ["nesio-projects-v1", "durable"],
  ["nesio-quote-cat-pref-v1", "durable"],
  ["nesio-reader-bookmarks-v1", "durable"],
  ["nesio-reader-highlights-v1", "durable"],
  ["nesio-reader-progress-v1", "durable"],
  ["nesio-receipt-match-rejected-v1", "durable"],
  ["nesio-rel-contact-v1", "durable"],
  ["nesio-relationship-overrides-v1", "durable"],
  ["nesio-rewards-v1", "durable"],
  ["nesio-routines-v1", "durable"],
  ["nesio-snoozed-overdue", "durable"],
  ["nesio-theme-lowsat-v1", "durable"],
  ["nesio-theme-palette-v1", "durable"],
  ["nesio-training-overrides-v1", "durable"],
  ["nesio-training-v1", "durable"],
  ["nesio-travel-checkin-reminders-v1", "durable"],
  ["nesio-travel-receipt-trip-v1", "durable"],
  ["nesio-travel-trips-v1", "durable"],
  ["nesio-trial-start-v1", "durable"],
  ["nesio-video-montage-v1", "durable"],
  ["nesio-wardrobe-outfits-v1", "durable"],
  ["nesio-wardrobe-prefs-v1", "durable"],
  ["nesio-weather-last-geo-v1", "durable"],
  ["nesio-workout-equip-v1", "durable"],
  ["nesio-workout-history-v1", "durable"],
  ["nesio-workout-last-v1", "durable"],
  ["nesio-workout-rest-sec-v1", "durable"],
  ["nesio-workout-sound-force-v1", "durable"],
  ["nesio-workouts-v1", "durable"],
  ["text-embed-model", "durable"],
  ["text-embed-tokenizer", "durable"],
  ["treasurebox-personalization-demo-stage", "durable"],
  ["treasurebox-profile-updated-at", "durable"],
  ["treasurebox-theme", "durable"],
  ["treasurebox-toolbox-open", "durable"],
]);

// ── ① 源码里每个 key 都必须在册 ──
const scanned = scanKeys();
const unregistered = [...scanned].filter((k) => !KNOWN_KEYS.has(k)).sort();
assert.deepEqual(
  unregistered, [],
  `发现未登记的存储 key:${unregistered.join(', ')}\n` +
  '  → 新 key 默认会被当用户数据(进备份 + 整键 replace 上云)。请在 KNOWN_KEYS 里登记,\n' +
  '    并按判据决定归类:换设备后「从头开始」是否正确?是→cache,否→durable,凭证→auth。\n' +
  '    cache 与 auth 需同时写进 lib/portal/storage-manifest.ts 的 CACHE_KEYS / AUTH_KEYS。',
);

// ── ② 在册键的实际分类必须与声明一致(防有人改坏 AUTH_RE / CACHE_KEYS 而不自知) ──
const drifted = [];
for (const [key, declared] of KNOWN_KEYS) {
  const actual = keyKind(key);
  if (actual !== declared) drifted.push(`${key}: 声明 ${declared} / 实际 ${actual}`);
}
assert.deepEqual(drifted, [], `分类漂移:\n  ${drifted.join('\n  ')}`);

// ── ③ 凭证绝不进备份 ──
for (const cred of ['nesio-connector-tokens-v1', 'nesio_admin_secret', 'nesio-plaid-link-token']) {
  assert.equal(keyKind(cred), 'auth', `${cred} 是凭证,必须 auth —— durable 会让它明文进备份 JSON 并推上云`);
}
// 复数/同义词也得认得出(这正是两个事故的根因)
for (const shape of ['nesio-foo-tokens-v1', 'nesio-bar-secret', 'nesio-baz-credentials-v1', 'nesio-x-apikey']) {
  assert.equal(keyKind(shape), 'auth', `凭证识别要认复数/同义词:${shape}`);
}

// ── ④ 核心用户数据必须进备份(反向红线:别把真数据误判成缓存) ──
for (const durable of [
  'nesio-life-graph-v1', 'nesio-bank-tx-v1', 'nesio-health-v1', 'nesio-place-trail-v1',
  'nesio-person-records-v1', 'nesio-card-verdict-v1', 'nesio-workout-history-v1', 'nesio-fin-assets-v1',
]) {
  assert.equal(keyKind(durable), 'durable', `${durable} 是核心用户数据,必须 durable(进备份 + 跨端)`);
}

console.log(`storage-key-registry: OK(在册 ${KNOWN_KEYS.size} 个 / 扫到 ${scanned.size} 个 / 凭证归位 / 核心数据不误判)`);
