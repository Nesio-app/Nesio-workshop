import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const component = fs.readFileSync(path.join(root, 'components', 'portal', 'NotePanelEnhanced.tsx'), 'utf8');
const basicComponent = fs.readFileSync(path.join(root, 'components', 'portal', 'NotePanel.tsx'), 'utf8');
const runtime = fs.readFileSync(path.join(root, 'lib', 'portal', 'production-runtime.ts'), 'utf8');
const i18n = fs.readFileSync(path.join(root, 'lib', 'portal', 'i18n.ts'), 'utf8');
const flomoRoute = fs.readFileSync(path.join(root, 'app', 'api', 'portal', 'flomo', 'route.ts'), 'utf8');
const providerCopyCatalogPath = path.join(root, 'lib', 'portal', 'provider-action-copy-catalog.mjs');
const flomoErrorClassifierPath = path.join(root, 'lib', 'portal', 'flomo-error-classifier.mjs');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

for (const marker of [
  'createAppApiClient',
  'ProductionRuntimeProviderAction',
  'fetchProductionRuntimeHealth',
  'providerActionMatrix',
  'flomoProviderAction',
  'flomoRuntimeReady',
]) {
  assert.ok(component.includes(marker), `NotePanelEnhanced must consume Flomo provider action marker: ${marker}`);
}

assert.match(
  runtime,
  /flomo[\s\S]*startEndpoint:\s*'\/api\/portal\/flomo'/,
  'Flomo provider action must point to the local server-side Flomo API route.',
);

assert.match(
  runtime,
  /flomo[\s\S]*alternateGroups:\s*\[\['FLOMO_WEBHOOK_URL', 'FLOMO_API_URL'\]\]/,
  'Flomo send readiness must be based on webhook/API URL send config, not the read-only FLOMO_API_KEY.',
);

assert.match(
  runtime,
  /flomo[\s\S]*serverOnly:\s*true/,
  'Flomo provider action must remain server-only so secrets never move to the browser.',
);

assert.ok(
  fs.existsSync(providerCopyCatalogPath),
  'provider action copy catalog must centralize provider response copy',
);

const providerCopyCatalog = fs.existsSync(providerCopyCatalogPath)
  ? fs.readFileSync(providerCopyCatalogPath, 'utf8')
  : '';

assert.match(
  flomoRoute,
  /provider-action-copy-catalog\.mjs/,
  'Flomo route must import provider response copy from a shared catalog.',
);

assert.doesNotMatch(
  flomoRoute,
  /'已记录'/,
  'Flomo route must not own localized success copy directly.',
);

assert.match(
  providerCopyCatalog,
  /flomoRecorded/,
  'provider action copy catalog must expose the Flomo recorded fallback message.',
);

assert.match(
  component,
  /providerActionMatrix[\s\S]*provider\.id === 'flomo'/,
  'NotePanelEnhanced must derive Flomo readiness from providerActionMatrix.',
);

assert.match(
  component,
  /flomoProviderAction\?\.actionStatus === 'server_ready'/,
  'NotePanelEnhanced must treat server_ready Flomo as a usable send route.',
);

assert.match(
  component,
  /flomoProviderAction\?\.startEndpoint === '\/api\/portal\/flomo'/,
  'NotePanelEnhanced must require Flomo sends to go through the local API endpoint.',
);

assert.ok(
  fs.existsSync(flomoErrorClassifierPath),
  'Flomo read error classifier must keep provider-specific auth phrases outside NotePanelEnhanced.',
);

assert.match(
  component,
  /flomo-error-classifier\.mjs/,
  'NotePanelEnhanced must import the shared Flomo error classifier.',
);

assert.doesNotMatch(
  component,
  /登录\|login\|过期\|无效\/i/,
  'NotePanelEnhanced must not own provider-specific token error keyword rules directly.',
);

assert.match(
  component,
  /if \(!flomoRuntimeReady\)[\s\S]*setStatus\('err'\)/,
  'NotePanelEnhanced must fail closed with visible status when Flomo is not runtime-ready.',
);

assert.doesNotMatch(
  component,
  /className="flomo-memo-menu"[\s\S]{0,180}tabIndex=\{-1\}/,
  'Memo more button must stay reachable and focusable.',
);

assert.match(
  component,
  /className="flomo-memo-menu"[\s\S]{0,260}onClick=\{\(\) => setMenuOpen\(\(open\) => !open\)\}/,
  'Memo more button must toggle a real local action menu.',
);

assert.match(
  component,
  /role="menu"[\s\S]*flomoCopyMemo/,
  'Memo action menu must expose a localized copy action.',
);

assert.match(
  component,
  /navigator\.clipboard\.writeText\(content\)/,
  'Memo copy action must write the memo content through navigator.clipboard.',
);

for (const key of ['flomoCopyMemo', 'flomoMemoCopied', 'flomoMemoCopyFailed']) {
  assert.match(component, new RegExp(key), `NotePanelEnhanced must use i18n key ${key}.`);
  assert.match(i18n, new RegExp(`${key}:`), `i18n dictionary must define key ${key}.`);
}

for (const [name, source] of [
  ['NotePanelEnhanced', component],
  ['NotePanel', basicComponent],
]) {
  assert.doesNotMatch(
    source,
    /disabled=\{!canSend\}/,
    `${name} send button must remain clickable so empty drafts can show local feedback.`,
  );
  assert.doesNotMatch(
    source,
    /disabled=\{sending\}/,
    `${name} send button must stay clickable while sending so repeat taps can explain the in-flight state.`,
  );
  assert.match(
    source,
    /t\(locale, 'flomoSendInFlight'\)/,
    `${name} must explain repeat send taps while a note is already sending.`,
  );
  assert.match(
    source,
    /if \(!text && images\.length === 0\)[\s\S]*flomoNeedContent/,
    `${name} must show local feedback when send is tapped with no content.`,
  );
}

assert.equal(
  packageJson.scripts['test:note-panel-flomo-provider-action'],
  'node scripts/note-panel-flomo-provider-action.test.mjs',
  'package.json must expose NotePanel Flomo provider action test',
);

assert.ok(
  packageJson.scripts['test:contracts'].includes('test:note-panel-flomo-provider-action'),
  'test:contracts must include NotePanel Flomo provider action test',
);

console.log('NotePanel Flomo provider action test passed');
