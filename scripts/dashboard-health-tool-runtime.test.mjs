import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = process.cwd();
const dashboardSource = readFileSync(join(repoRoot, 'components', 'portal', 'DashboardHome.tsx'), 'utf8');
const packageJson = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));

assert.match(
  dashboardSource,
  /const healthTool = useMemo\(/,
  'DashboardHome must derive a health tool from the active tool registry.',
);
assert.match(
  dashboardSource,
  /const openHealthRuntime = useCallback\(/,
  'DashboardHome must expose a runtime handler for the health energy card.',
);
assert.match(
  dashboardSource,
  /healthTool[\s\S]{0,260}onOpenTool\(healthTool\)/,
  'DashboardHome health energy card must open the health tool when it is available.',
);
assert.match(
  dashboardSource,
  /setHealthGateOpen\(true\)/,
  'DashboardHome health energy card must keep a purchase/join fallback when the health tool is unavailable.',
);
assert.match(
  dashboardSource,
  /onClick=\{openHealthRuntime\}/,
  'DashboardHome energy card must call the shared health runtime handler instead of opening a static sheet directly.',
);
assert.match(
  dashboardSource,
  /data-runtime-action="open-health-dashboard"/,
  'DashboardHome energy card must expose a traceable runtime action marker.',
);

assert.equal(
  packageJson.scripts['test:dashboard-health-tool-runtime'],
  'node scripts/dashboard-health-tool-runtime.test.mjs',
  'package.json must expose dashboard health runtime test.',
);
assert.match(
  packageJson.scripts['test:contracts'],
  /test:dashboard-health-tool-runtime/,
  'test:contracts must include dashboard health runtime test.',
);

console.log('DashboardHome health tool runtime test passed');
