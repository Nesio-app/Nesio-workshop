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
});
const report = JSON.parse(output);

assert.equal(report.agentRuntime.version, 'agent-runtime-v0');
assert.equal(report.agentRuntime.implementation, 'bounded-local-agent-runtime');
assert.equal(report.agentRuntime.summary.agentCount, 1);
assert.equal(report.agentRuntime.summary.activeAgentCount, 1);
assert.equal(report.agentRuntime.summary.blockedAgentCount, 0);
assert.equal(report.agentRuntime.boundaries.agentToAgentDirectCallsAllowed, false);
assert.equal(report.agentRuntime.boundaries.externalToolExecutionAllowed, false);
assert.equal(report.agentRuntime.boundaries.promptInjectionAllowed, false);
assert.equal(report.agentRuntime.boundaries.rawMemoryInjectionAllowed, false);
assert.equal(report.agentRuntime.boundaries.unauditedProviderCallsAllowed, false);
assert.equal(report.agentRuntime.boundaries.stage5Enabled, false);
assert.equal(report.agentRuntime.agents[0].agentId, 'energy-calendar-agent');
assert.deepEqual(report.agentRuntime.agents[0].sandboxPair, ['health', 'calendar']);
assert.ok(report.agentRuntime.stage5Prerequisites.length >= 4);

assert.equal(report.summary.agentRuntimeVersion, 'agent-runtime-v0');
assert.equal(report.summary.agentRuntimeAgentCount, 1);
assert.equal(report.summary.agentRuntimeActiveAgentCount, 1);
assert.equal(report.summary.agentRuntimeBlockedAgentCount, 0);
assert.equal(report.summary.agentRuntimeStage5Enabled, false);

console.log('report-module-registry Agent Runtime checks passed');
