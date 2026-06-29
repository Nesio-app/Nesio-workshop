import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const domains = readFileSync(join(root, 'lib', 'intelligence', 'domains.ts'), 'utf8');
const dec = readFileSync(join(root, 'lib', 'intelligence', 'dec.ts'), 'utf8');
const policy = readFileSync(join(root, 'lib', 'intelligence', 'dec-policy.ts'), 'utf8');
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

assert.match(
  policy,
  /\['health', 'calendar'\]/,
  'DEC sandbox allowlist must keep Health + Calendar as an explicit Stage 3 pair.',
);
assert.match(
  dec,
  /canRunDomain/,
  'DEC runtime must consume the shared evidence policy gate.',
);
assert.match(
  domains,
  /const energyCalendarDomain: DomainEngine = \{/,
  'Stage 3 must have a named Health x Calendar domain engine.',
);
assert.match(
  domains,
  /domain: 'energy-calendar'/,
  'Stage 3 engine must be registered under a stable energy-calendar domain id.',
);
assert.match(
  domains,
  /sandboxPair: \['health', 'calendar'\]/,
  'Stage 3 engine must declare the bounded Health + Calendar sandbox pair.',
);
assert.match(
  domains,
  /function isSleepOrEnergySignal\(sig: Signal\): boolean/,
  'Stage 3 must identify health sleep/energy signals instead of reading raw connector payloads.',
);
assert.match(
  domains,
  /function isCalendarEventToday\(sig: Signal/,
  'Stage 3 must identify calendar density from normalized Signal objects.',
);
assert.match(
  domains,
  /if \(!healthSignal \|\| calendarEvents\.length < 2\) return \[\];/,
  'Stage 3 must design-silence unless both Health and Calendar domains have real signal evidence.',
);
assert.match(
  domains,
  /if \(!lowSleep && !lowEnergy && !denseCalendar\) return \[\];/,
  'Stage 3 must silence when both domains exist but do not support a useful energy allocation recommendation.',
);
assert.match(
  domains,
  /id: 'dec-energy-calendar-allocation'/,
  'Stage 3 recommendation must use a stable id for traceable evidence and feedback.',
);
assert.match(
  domains,
  /Health × Calendar/,
  'Stage 3 output must make the bounded dual-domain sandbox visible in tags/evidence.',
);
assert.doesNotMatch(
  domains,
  /registerAgent|AgentRuntime|tool call|prompt injection/i,
  'Stage 3 must not introduce Stage 4 Agent Native runtime concepts.',
);

assert.equal(
  packageJson.scripts['test:dec-stage3-sandbox'],
  'node scripts/dec-stage3-sandbox.test.mjs',
  'package.json must expose the Stage 3 sandbox regression test.',
);
assert.ok(
  packageJson.scripts['test:contracts'].includes('test:dec-stage3-sandbox'),
  'test:contracts must include the Stage 3 sandbox regression test.',
);

console.log('DEC Stage 3 sandbox test passed');
