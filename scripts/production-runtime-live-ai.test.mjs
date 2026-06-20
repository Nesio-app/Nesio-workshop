import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const runtime = readFileSync(join(root, 'lib', 'portal', 'production-runtime.ts'), 'utf8');
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

assert.match(
  runtime,
  /NEXT_PUBLIC_BAOHE_FIRST_LAUNCH_RISK_ISOLATION/,
  'production runtime must observe the first-launch isolation env for live AI enablement.',
);
assert.match(
  runtime,
  /const launchIsolationDisabled = envValue\(env, 'NEXT_PUBLIC_BAOHE_FIRST_LAUNCH_RISK_ISOLATION'\)\.toLowerCase\(\) === 'off';/,
  'production runtime must compute launchIsolationDisabled from runtime env.',
);
assert.match(
  runtime,
  /const aiModeEnabled = envValue\(env, 'BAOHE_AI_PROVIDER_MODE'\)\.toLowerCase\(\) === 'production';/,
  'production runtime must keep the explicit production AI mode check.',
);
assert.match(
  runtime,
  /const aiEnabled = aiProviderConfigured && \(aiModeEnabled \|\| launchIsolationDisabled\);/,
  'production runtime must also enable AI when real keys exist and launch isolation is explicitly off.',
);
assert.doesNotMatch(
  runtime,
  /requiredEnv:\s*\['BAOHE_AI_PROVIDER_MODE'\]/,
  'AI provider readiness must not mark BAOHE_AI_PROVIDER_MODE as missing when live isolation-off mode is allowed.',
);
assert.equal(
  packageJson.scripts['test:production-runtime-live-ai'],
  'node scripts/production-runtime-live-ai.test.mjs',
  'package.json must expose test:production-runtime-live-ai.',
);
assert.match(
  packageJson.scripts['test:contracts'],
  /test:production-runtime-live-ai/,
  'test:contracts must include live AI production runtime coverage.',
);

console.log('production runtime live AI tests passed');
