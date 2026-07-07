import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const output = execFileSync("node", ["scripts/report-module-registry.mjs"], {
  encoding: "utf8",
  maxBuffer: 16 * 1024 * 1024,
});
const report = JSON.parse(output);

const expectedContextWritebackLoop = [
  "label_or_source_hint_received",
  "derive_context_from_label_and_signal",
  "user_confirms_or_edits_context",
  "write_confirmed_context_to_signal",
  "project_to_memory_search_reminder_insight",
];

assert.equal(report.domainCapabilityRegistry.version, "domain-capability-taxonomy-v1");
assert.ok(!report.domainCapabilityRegistry.taxonomy.frontstageDomains.includes("platform"));
assert.equal(report.summary.governanceResolverVersion, "governance-resolver-v1");
assert.equal(report.domainCapabilityRegistry.governanceResolver.version, "governance-resolver-v1");
assert.deepEqual(report.domainCapabilityRegistry.governanceResolver.order, [
  "safety_gate",
  "entitlement_gate",
  "quota_gate",
  "cost_gate",
  "audit_log",
]);
assert.equal(report.domainCapabilityRegistry.governanceResolver.policy.safetyGateFirst, true);
assert.equal(report.domainCapabilityRegistry.governanceResolver.policy.approvalGatePrecedesPaywall, true);
assert.equal(report.domainCapabilityRegistry.governanceResolver.policy.executesActions, false);
assert.equal(report.domainCapabilityRegistry.governanceResolver.policy.reportOnly, true);
assert.deepEqual(
  report.domainCapabilityRegistry.taxonomy.contextWritebackLoop,
  expectedContextWritebackLoop,
  "domain capability report should expose the label/context/Signal writeback loop",
);
assert.equal(
  report.domainCapabilityRegistry.taxonomy.labelContextLoop?.signalIsWriteBoundary,
  true,
  "domain capability report should mark Signal as the write boundary for confirmed context",
);
// inventory 已原生化,不再出现在 moduleIndex
assert.equal("inventory" in report.domainCapabilityRegistry.moduleIndex, false);
assert.equal(report.domainCapabilityRegistry.moduleIndex.finance.gateLevel, "ceo_gate");
assert.equal(report.summary.domainCapabilityTaxonomyVersion, "domain-capability-taxonomy-v1");
assert.ok(report.summary.platformCapabilityMaterialCount >= 0);
assert.ok(report.summary.materialLibraryModuleCount >= 8);
assert.equal(report.domainCapabilityRegistry.materialLibrarySummary.version, "module-material-library-v1");
assert.equal(report.domainCapabilityRegistry.materialLibrarySummary.boundaries.touchesOldRepos, false);
assert.equal(report.domainCapabilityRegistry.materialLibrarySummary.boundaries.touchesOldGithub, false);
assert.equal(report.domainCapabilityRegistry.materialLibrarySummary.boundaries.touchesOldDeployments, false);
const reportMaterialLibraryIds = new Set(
  report.domainCapabilityRegistry.materialLibrarySummary.modules.map((item) => item.moduleId),
);
assert.ok(reportMaterialLibraryIds.has("finance"));
assert.ok(!reportMaterialLibraryIds.has("inventory"));
assert.ok(!reportMaterialLibraryIds.has("plan"));

console.log("domain capability registry report passed");
