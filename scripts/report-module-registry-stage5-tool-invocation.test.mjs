import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, '..');
const output = execFileSync('node', [join(scriptDir, 'report-module-registry.mjs')], {
  cwd: repoRoot,
  encoding: 'utf8',
  maxBuffer: 1024 * 1024 * 20,
  env: {
    ...process.env,
    NESIO_STAGE5_CEO_APPROVED: 'true',
    NESIO_STAGE5_EXECUTION_ENABLED: 'true',
    GOOGLE_CLIENT_ID: 'client',
    GOOGLE_CLIENT_SECRET: 'secret',
    NESIO_NOTIFICATION_WEBHOOK_URL: 'https://example.com/hook',
    GEMINI_API_KEY: 'gemini-key',
  },
});
const report = JSON.parse(output);

assert.equal(report.stage5ToolInvocation.version, 'stage5-tool-invocation-v0');
assert.equal(report.stage5ToolInvocation.summary.ceoApproved, true);
assert.equal(report.stage5ToolInvocation.summary.executionEnabled, true);
assert.ok(report.stage5ToolInvocation.summary.executableActionCount >= 2);
assert.ok(report.stage5ToolInvocation.summary.realExternalActionCount >= 3);
assert.equal(report.stage5ToolInvocation.boundaries.auditEnvelopeRequired, true);
assert.equal(report.stage5ToolInvocation.boundaries.agentDirectToolExecutionAllowed, false);

assert.equal(report.summary.stage5ToolInvocationVersion, 'stage5-tool-invocation-v0');
assert.equal(report.summary.stage5ToolInvocationCeoApproved, true);
assert.equal(report.summary.stage5ToolInvocationExecutionEnabled, true);
assert.ok(report.summary.stage5ToolInvocationExecutableActionCount >= 2);
assert.ok(report.stage5ToolInvocation.actions.some((action) => action.actionKey === 'calendar.event.create'));
assert.ok(report.stage5ToolInvocation.actions.some((action) => action.actionKey === 'notification.webhook.send'));
assert.ok(report.stage5ToolInvocation.actions.some((action) => action.actionKey === 'ai.provider.chat'));

console.log('report-module-registry Stage 5 tool invocation checks passed');
