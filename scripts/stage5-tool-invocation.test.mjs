import assert from 'node:assert/strict';

import {
  STAGE5_TOOL_INVOCATION_VERSION,
  buildStage5ToolInvocationReport,
  evaluateStage5ToolInvocationPolicy,
} from '../lib/intelligence/tool-invocation-runtime.mjs';

const disabledEnv = {
  NESIO_STAGE5_CEO_APPROVED: 'true',
  GOOGLE_CLIENT_ID: 'client',
  GOOGLE_CLIENT_SECRET: 'secret',
};
const enabledEnv = {
  NESIO_STAGE5_CEO_APPROVED: 'true',
  NESIO_STAGE5_EXECUTION_ENABLED: 'true',
  GOOGLE_CLIENT_ID: 'client',
  GOOGLE_CLIENT_SECRET: 'secret',
  NESIO_NOTIFICATION_WEBHOOK_URL: 'https://example.com/hook',
  GEMINI_API_KEY: 'gemini-key',
};

const dryRunDecision = evaluateStage5ToolInvocationPolicy({
  actionKey: 'calendar.event.create',
  executionMode: 'dry_run',
  env: disabledEnv,
});
assert.equal(dryRunDecision.allowed, true);
assert.equal(dryRunDecision.mode, 'dry_run');
assert.equal(dryRunDecision.wouldExecuteWithRuntimeEnabled, true);

const disabledExecuteDecision = evaluateStage5ToolInvocationPolicy({
  actionKey: 'calendar.event.create',
  executionMode: 'execute',
  env: disabledEnv,
});
assert.equal(disabledExecuteDecision.allowed, false);
assert.equal(disabledExecuteDecision.blockedReason, 'stage5_execution_disabled');

const enabledExecuteDecision = evaluateStage5ToolInvocationPolicy({
  actionKey: 'calendar.event.create',
  executionMode: 'execute',
  env: enabledEnv,
  runtimeContext: { hasGoogleCalendarAccessToken: true },
});
assert.equal(enabledExecuteDecision.allowed, true);
assert.equal(enabledExecuteDecision.mode, 'execute');
assert.equal(enabledExecuteDecision.provider, 'google_calendar');
assert.equal(enabledExecuteDecision.sideEffectKind, 'external_write');

const missingTokenDecision = evaluateStage5ToolInvocationPolicy({
  actionKey: 'calendar.event.create',
  executionMode: 'execute',
  env: enabledEnv,
  runtimeContext: { hasGoogleCalendarAccessToken: false },
});
assert.equal(missingTokenDecision.allowed, false);
assert.equal(missingTokenDecision.blockedReason, 'missing_google_calendar_access_token');

const unknownDecision = evaluateStage5ToolInvocationPolicy({
  actionKey: 'calendar.event.delete_everything',
  executionMode: 'dry_run',
  env: enabledEnv,
});
assert.equal(unknownDecision.allowed, false);
assert.equal(unknownDecision.blockedReason, 'unknown_action');

const report = buildStage5ToolInvocationReport({ env: enabledEnv });
assert.equal(report.version, STAGE5_TOOL_INVOCATION_VERSION);
assert.equal(report.summary.ceoApproved, true);
assert.equal(report.summary.executionEnabled, true);
assert.ok(report.summary.realExternalActionCount >= 2);
assert.ok(report.summary.executableActionCount >= 2);
assert.ok(report.actions.some((action) => action.actionKey === 'calendar.event.create'));
assert.ok(report.actions.some((action) => action.actionKey === 'notification.webhook.send'));
assert.ok(report.actions.some((action) => action.actionKey === 'ai.provider.chat'));
assert.equal(report.boundaries.agentDirectToolExecutionAllowed, false);
assert.equal(report.boundaries.rawMemoryInjectionAllowed, false);
assert.equal(report.boundaries.auditEnvelopeRequired, true);

console.log('Stage 5 tool invocation policy checks passed');
