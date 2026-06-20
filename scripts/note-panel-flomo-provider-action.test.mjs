import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const component = fs.readFileSync(path.join(root, 'components', 'portal', 'NotePanelEnhanced.tsx'), 'utf8');
const basicComponent = fs.readFileSync(path.join(root, 'components', 'portal', 'NotePanel.tsx'), 'utf8');
const runtime = fs.readFileSync(path.join(root, 'lib', 'portal', 'production-runtime.ts'), 'utf8');
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

assert.match(
  component,
  /if \(!flomoRuntimeReady\)[\s\S]*setStatus\('err'\)/,
  'NotePanelEnhanced must fail closed with visible status when Flomo is not runtime-ready.',
);

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
