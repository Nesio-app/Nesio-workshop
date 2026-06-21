import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (file) => readFileSync(join(root, file), 'utf8');

const launchSafety = read('lib/portal/launch-safety.ts');
const healthRoute = read('app/api/secretary/health/route.ts');
const packageJson = JSON.parse(read('package.json'));

assert.match(
  launchSafety,
  /export function isLaunchIsolationDisabled\(\)/,
  'launch safety must expose a helper for the first-launch isolation switch.',
);
assert.match(
  launchSafety,
  /NEXT_PUBLIC_BAOHE_FIRST_LAUNCH_RISK_ISOLATION/,
  'launch safety must read the first-launch isolation runtime env.',
);
assert.match(
  launchSafety,
  /export function isLiveRuntimeAiEnabled\(\)/,
  'launch safety must expose a live AI runtime gate for real provider keys once isolation is off.',
);
assert.match(
  launchSafety,
  /isSecretaryAiRequestAllowed[\s\S]*isLiveRuntimeAiEnabled\(\)/,
  'secretary AI requests must allow the live runtime gate in addition to personal lab and production mode.',
);
assert.match(
  healthRoute,
  /launchIsolationDisabled:/,
  'secretary health must expose whether first-launch isolation is disabled.',
);
assert.match(
  healthRoute,
  /liveRuntimeEnabled:/,
  'secretary health must expose whether live AI runtime is active from real provider keys.',
);
assert.equal(
  packageJson.scripts['test:secretary-live-runtime-ai'],
  'node scripts/secretary-live-runtime-ai.test.mjs',
  'package.json must expose test:secretary-live-runtime-ai.',
);
assert.match(
  packageJson.scripts['test:contracts'],
  /test:secretary-live-runtime-ai/,
  'test:contracts must include live runtime secretary AI coverage.',
);

console.log('secretary live runtime AI tests passed');
