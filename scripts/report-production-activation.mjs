#!/usr/bin/env node
import { buildProductionActivationContract } from '../lib/portal/production-activation-contract.mjs';

function toMarkdown(report) {
  const lines = [
    '# Baohe Production Activation v0',
    '',
    `- version: ${report.version}`,
    `- implementation: ${report.implementation}`,
    `- CEO Gate: ${report.ceoGate.status} (${report.ceoGate.approvedAt})`,
    `- productionReady: ${report.summary.productionReady}`,
    `- providers: ${report.summary.configuredProviderCount}/${report.summary.providerCount} configured`,
    `- missing env providers: ${report.summary.missingEnvProviderCount}`,
    '',
    '## Provider Matrix',
    '',
    '| Provider | Category | Status | Missing env | Runtime |',
    '| --- | --- | --- | --- | --- |',
  ];

  for (const provider of report.providers) {
    lines.push([
      provider.label,
      provider.category,
      provider.status,
      provider.missingEnv.length ? provider.missingEnv.join(', ') : '-',
      provider.runtimeSurface,
    ].map((cell) => `| ${cell} `).join('') + '|');
  }

  lines.push(
    '',
    '## Runtime Switches',
    '',
    '| Switch | Expected | Enabled | Fail closed |',
    '| --- | --- | --- | --- |',
  );

  for (const sw of report.runtimeSwitches) {
    lines.push(`| ${sw.key} | ${sw.expectedEnabledValue} | ${sw.enabled} | ${sw.failClosed} |`);
  }

  lines.push(
    '',
    '## Boundary',
    '',
    '- This report does not call external providers.',
    '- Secrets must be configured in Vercel/provider consoles, not Git.',
    '- Missing provider config fails closed instead of pretending to be enabled.',
  );

  return lines.join('\n');
}

const report = buildProductionActivationContract();
const markdown = process.argv.includes('--markdown');
console.log(markdown ? toMarkdown(report) : JSON.stringify(report, null, 2));
