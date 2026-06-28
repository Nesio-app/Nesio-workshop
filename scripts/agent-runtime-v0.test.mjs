import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const contracts = readFileSync(join(root, 'lib', 'intelligence', 'agent-contracts.ts'), 'utf8');
const registry = readFileSync(join(root, 'lib', 'intelligence', 'agent-registry.ts'), 'utf8');
const runtime = readFileSync(join(root, 'lib', 'intelligence', 'agent-runtime.ts'), 'utf8');
const agents = readFileSync(join(root, 'lib', 'intelligence', 'agents.ts'), 'utf8');
const core = readFileSync(join(root, 'lib', 'intelligence', 'energy-calendar-agent-core.mjs'), 'utf8');
const report = readFileSync(join(root, 'lib', 'intelligence', 'agent-runtime-report.mjs'), 'utf8');
const reportScript = readFileSync(join(root, 'scripts', 'report-module-registry.mjs'), 'utf8');
const index = readFileSync(join(root, 'lib', 'intelligence', 'index.ts'), 'utf8');
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

assert.match(contracts, /export interface DomainAgent/, 'Stage 4 must define a DomainAgent contract.');
assert.match(contracts, /AgentPromptPolicy/, 'Stage 4 must define prompt policy boundaries.');
assert.match(contracts, /promptInjectionAllowed: false/, 'Prompt injection must be impossible by type contract.');
assert.match(contracts, /rawUserDataAllowed: false/, 'Raw user data must be excluded from Stage 4 agent prompt policy.');
assert.match(contracts, /externalToolCallsAllowed: false/, 'External tool calls must stay off for Agent Runtime v0.');
assert.match(registry, /const agentRegistry = new Map<string, DomainAgent>\(\)/, 'Agent Registry must be explicit and local.');
assert.match(runtime, /function validateAgent\(agent: DomainAgent\)/, 'Agent Runtime must validate agents before running.');
assert.match(runtime, /sandbox_pair_not_allowed/, 'Agent Runtime must block agents outside DEC sandbox pairs.');
assert.match(runtime, /platform_degraded/, 'Agent Runtime must stand down when platform health is degraded.');
assert.match(runtime, /agentToAgentDirectCallsAllowed: false/, 'Runtime report must declare no agent-to-agent direct calls.');
assert.match(runtime, /promptInjectionAllowed: false/, 'Runtime report must declare prompt injection blocked.');
assert.match(runtime, /externalToolCallsAllowed: false/, 'Runtime report must declare external tool calls blocked.');
assert.match(agents, /id: 'energy-calendar-agent'/, 'Stage 4 must register the first bounded Health x Calendar agent.');
assert.match(agents, /sandboxPair: \['health', 'calendar'\]/, 'First Stage 4 agent must use Stage 3 Health x Calendar sandbox.');
assert.match(agents, /STAGE4_DEFAULT_PROMPT_POLICY/, 'Agent must use the shared bounded prompt policy.');
assert.doesNotMatch(agents, /fetch\(|OpenAI|Gemini|Anthropic|Claude|Doubao|api\.openai|generativelanguage/i, 'Stage 4 foundation agent must not call external LLM providers directly.');
assert.match(core, /if \(!healthSignal \|\| calendarEvents\.length < 2\) return silent\('missing_dual_domain_evidence'\);/, 'Agent must design-silence without both domains.');
assert.doesNotMatch(core, /fetch\(|OpenAI|Gemini|Anthropic|Claude|Doubao|api\.openai|generativelanguage/i, 'Shared Stage 4 agent core must not call external LLM providers directly.');
assert.match(report, /buildAgentRuntimeReportV0/, 'Stage 4 must expose report-layer visibility.');
assert.match(report, /stage5Enabled: false/, 'Stage 4 report must clearly mark Stage 5 as not enabled.');
assert.match(report, /agentToAgentDirectCallsAllowed: false/, 'Stage 4 report must state agent-to-agent direct calls remain forbidden.');
assert.match(reportScript, /buildAgentRuntimeReportV0/, 'report:modules must include Agent Runtime v0.');
assert.match(reportScript, /agentRuntime: agentRuntimeReport/, 'report:modules must emit the Agent Runtime section.');
assert.match(index, /import '\.\/agents';/, 'Intelligence index must register Stage 4 agents.');
assert.match(index, /export \* from '\.\/agent-runtime';/, 'Intelligence index must export Agent Runtime.');
assert.equal(
  packageJson.scripts['test:agent-runtime'],
  'node scripts/agent-runtime-v0.test.mjs',
  'package.json must expose Agent Runtime v0 test.',
);
assert.equal(
  packageJson.scripts['test:agent-runtime-smoke'],
  'node scripts/agent-runtime-smoke.test.mjs',
  'package.json must expose executable Agent Runtime smoke test.',
);
assert.ok(
  packageJson.scripts['test:contracts'].includes('test:agent-runtime'),
  'test:contracts must include Agent Runtime v0 coverage.',
);
assert.ok(
  packageJson.scripts['test:contracts'].includes('test:agent-runtime-smoke'),
  'test:contracts must include executable Agent Runtime smoke coverage.',
);

console.log('Agent Runtime v0 checks passed');
