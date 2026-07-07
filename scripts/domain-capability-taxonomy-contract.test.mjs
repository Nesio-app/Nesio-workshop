import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { buildModuleRegistry } from "../lib/portal/module-manager-core.mjs";
import { buildToolManifestRegistryV0 } from "../lib/portal/tool-manifest-v0.mjs";

const repoRoot = process.cwd();
const portalConfigPath = path.join(repoRoot, "public", "portal-config.json");
const portalConfig = JSON.parse(fs.readFileSync(portalConfigPath, "utf8"));

const expectedFrontstageDomains = ["life", "growth", "assets", "health", "energy"];
const expectedDomainLabels = {
  life: "生活",
  growth: "成长",
  assets: "财物",
  health: "健康",
  energy: "能量",
  platform: "平台支撑",
};
const expectedCapabilities = [
  "capture",
  "context_extraction",
  "router",
  "memory_graph",
  "search_retrieval",
  "schedule_daily_plan",
  "reminder",
  "place",
  "ai_assistant",
  "insight",
  "export_delete",
  "sync",
  "entitlement_subscription",
  "approval_gate",
];
const expectedContextFields = [
  "domain",
  "secondaryDomains",
  "labels",
  "people",
  "places",
  "objects",
  "time",
  "role",
  "goal",
  "state",
  "intent",
  "source",
  "sensitivity",
  "permission",
  "confidence",
];
const expectedContextWritebackLoop = [
  "label_or_source_hint_received",
  "derive_context_from_label_and_signal",
  "user_confirms_or_edits_context",
  "write_confirmed_context_to_signal",
  "project_to_memory_search_reminder_insight",
];
const expectedGovernanceOrder = [
  "safety_gate",
  "entitlement_gate",
  "quota_gate",
  "cost_gate",
  "audit_log",
];

const registry = buildToolManifestRegistryV0(portalConfig);
assert.equal(
  registry.domainCapabilityTaxonomy?.version,
  "domain-capability-taxonomy-v1",
  "tool manifest registry should expose Domain Capability Taxonomy v1",
);
assert.deepEqual(
  registry.domainCapabilityTaxonomy.frontstageDomains,
  expectedFrontstageDomains,
  "frontstage domains should be the user-facing product domains only",
);
assert.ok(
  !registry.domainCapabilityTaxonomy.frontstageDomains.includes("platform"),
  "platform is a support domain, not a frontstage user domain",
);
for (const capability of expectedCapabilities) {
  assert.ok(
    registry.domainCapabilityTaxonomy.capabilities.includes(capability),
    `capability vocabulary should include ${capability}`,
  );
}
assert.deepEqual(
  registry.domainCapabilityTaxonomy.governanceResolverOrder,
  expectedGovernanceOrder,
  "governance resolver order should be fixed at the registry level",
);
assert.deepEqual(
  registry.domainCapabilityTaxonomy.contextWritebackLoop,
  expectedContextWritebackLoop,
  "domain capability taxonomy should spell out label -> context -> user confirmation -> Signal writeback loop",
);
assert.equal(
  registry.domainCapabilityTaxonomy.labelContextLoop?.labelCreatesContext,
  true,
  "domain capability taxonomy should make label-to-context behavior explicit",
);
assert.equal(
  registry.domainCapabilityTaxonomy.labelContextLoop?.userConfirmationBeforeSignalWrite,
  true,
  "domain capability taxonomy should require user confirmation before context is written to Signal",
);
assert.equal(
  registry.domainCapabilityTaxonomy.labelContextLoop?.signalIsWriteBoundary,
  true,
  "domain capability taxonomy should treat Signal as the confirmed write boundary",
);
const domainDefinitionsByValue = new Map(
  registry.domainCapabilityTaxonomy.allDomains.map((domain) => [domain.value, domain]),
);
for (const [domain, zhLabel] of Object.entries(expectedDomainLabels)) {
  assert.equal(
    domainDefinitionsByValue.get(domain)?.zhLabel,
    zhLabel,
    `${domain} should expose the Chinese product domain label`,
  );
}
const capabilityDefinitionsByValue = new Map(
  registry.domainCapabilityTaxonomy.capabilityDefinitions.map((capability) => [
    capability.value,
    capability,
  ]),
);
assert.equal(
  capabilityDefinitionsByValue.get("approval_gate")?.zhLabel,
  "审批闸门",
  "approval gate should expose a user/product-readable label",
);
assert.equal(
  capabilityDefinitionsByValue.get("entitlement_subscription")?.label,
  "Entitlement",
  "entitlement capability should be normalized into one capability definition",
);
assert.ok(
  capabilityDefinitionsByValue.get("search_retrieval")?.aliases.includes("search"),
  "search_retrieval should carry a stable search alias",
);

const manifestsById = new Map(registry.manifests.map((manifest) => [manifest.moduleId, manifest]));
assert.equal(manifestsById.size, 10, "current 10 modules should all be represented");

for (const manifest of manifestsById.values()) {
  assert.equal(manifest.domainCapabilityVersion, "domain-capability-taxonomy-v1");
  assert.ok(manifest.primaryDomain, `${manifest.moduleId} should have a primary domain`);
  assert.equal(
    manifest.primaryDomainZhLabel,
    expectedDomainLabels[manifest.primaryDomain],
    `${manifest.moduleId} should expose the Chinese label for its primary domain`,
  );
  assert.ok(
    manifest.primaryDomainEnglishLabel,
    `${manifest.moduleId} should expose the English label for its primary domain`,
  );
  assert.ok(Array.isArray(manifest.providedCapabilities), `${manifest.moduleId} should provide capabilities`);
  assert.equal(
    manifest.providedCapabilityDefinitions.length,
    manifest.providedCapabilities.length,
    `${manifest.moduleId} should expose definitions for every provided capability`,
  );
  assert.ok(Array.isArray(manifest.requiredCapabilities), `${manifest.moduleId} should require capabilities`);
  assert.ok(manifest.contextSchema, `${manifest.moduleId} should expose signal context schema`);
  assert.deepEqual(
    manifest.contextSchema.fields,
    expectedContextFields,
    `${manifest.moduleId} should use the shared Signal context fields`,
  );
  assert.deepEqual(
    manifest.contextSchema.writebackLoop,
    expectedContextWritebackLoop,
    `${manifest.moduleId} should use the shared label-to-context Signal writeback loop`,
  );
  assert.equal(
    manifest.contextSchema.labelContextLoop?.labelCreatesContext,
    true,
    `${manifest.moduleId} should derive context from labels/source hints`,
  );
  assert.equal(
    manifest.contextSchema.labelContextLoop?.userConfirmationBeforeSignalWrite,
    true,
    `${manifest.moduleId} should require user confirmation before writing context to Signal`,
  );
  assert.equal(
    manifest.contextSchema.labelContextLoop?.signalIsWriteBoundary,
    true,
    `${manifest.moduleId} should treat Signal as the confirmed context write boundary`,
  );
  assert.ok(manifest.salvageStatus, `${manifest.moduleId} should declare salvage status`);
  assert.ok(manifest.visibility, `${manifest.moduleId} should declare product visibility`);
  assert.ok(manifest.gateLevel, `${manifest.moduleId} should declare gate level`);
  assert.deepEqual(
    manifest.governanceResolverOrder,
    expectedGovernanceOrder,
    `${manifest.moduleId} should inherit governance resolver order`,
  );
}

const inventory = manifestsById.get("inventory");
assert.equal(inventory.primaryDomain, "assets");
assert.ok(inventory.providedCapabilities.includes("memory_graph"));
assert.ok(inventory.providedCapabilities.includes("search_retrieval"));
assert.equal(inventory.visibility, "frontstage");

assert.equal(manifestsById.get("reading").primaryDomain, "growth");
assert.equal(manifestsById.get("quiz").primaryDomain, "growth");
assert.equal(manifestsById.get("fitness").primaryDomain, "health");

const health = manifestsById.get("health");
assert.equal(health.primaryDomain, "health");
assert.equal(health.gateLevel, "ceo_gate");

assert.equal(manifestsById.get("sanctuary").primaryDomain, "energy");

const psychoanalysis = manifestsById.get("psychoanalysis");
assert.equal(psychoanalysis.primaryDomain, "energy");
assert.equal(psychoanalysis.gateLevel, "ceo_gate");

const finance = manifestsById.get("finance");
assert.equal(finance.primaryDomain, "assets");
assert.equal(finance.launchStatus, "hidden");
assert.equal(finance.gateLevel, "ceo_gate");

const secretary = manifestsById.get("secretary");
assert.equal(secretary.primaryDomain, "platform");
assert.ok(secretary.providedCapabilities.includes("ai_assistant"));
assert.equal(secretary.salvageStatus, "capability_material");

assert.ok(
  registry.summary.ceoGateModuleCount >= 4,
  "high-trust modules should be visible in the contract summary",
);
assert.ok(
  registry.summary.capabilityMaterialModuleCount >= 1,
  "old tool salvage material should be counted separately from frontstage modules",
);
assert.ok(registry.materialLibrarySummary, "tool manifest registry should expose a module material library");
assert.equal(registry.materialLibrarySummary.version, "module-material-library-v1");
assert.equal(registry.materialLibrarySummary.implementation, "static-contract-report-only");
assert.equal(registry.materialLibrarySummary.boundaries.touchesOldRepos, false);
assert.equal(registry.materialLibrarySummary.boundaries.touchesOldGithub, false);
assert.equal(registry.materialLibrarySummary.boundaries.touchesOldDeployments, false);
assert.equal(registry.materialLibrarySummary.boundaries.changesRuntimeBehavior, false);
assert.equal(registry.materialLibrarySummary.boundaries.changesLaunchPromise, false);
assert.ok(
  registry.materialLibrarySummary.moduleCount >= 9,
  "non-frontstage/old tools should be retained as material library",
);
const materialLibraryIds = new Set(registry.materialLibrarySummary.modules.map((item) => item.moduleId));
for (const moduleId of ["secretary", "finance", "reading", "fitness", "psychoanalysis"]) {
  assert.ok(materialLibraryIds.has(moduleId), `material library should retain ${moduleId}`);
}
assert.ok(!materialLibraryIds.has("inventory"), "launchable Inventory should remain a frontstage engine, not old-tool material");
assert.ok(!materialLibraryIds.has("plan"), "launchable Plan should remain a frontstage engine, not old-tool material");
assert.ok(
  registry.materialLibrarySummary.modules.every((item) => item.useAs === "capability_material_library"),
  "material library modules should be explicitly classified as reusable capability material",
);
assert.equal(registry.summary.materialLibraryModuleCount, registry.materialLibrarySummary.moduleCount);

const domainSummaryByValue = new Map(registry.domainSummary.map((domain) => [domain.domain, domain]));
for (const domain of expectedFrontstageDomains) {
  assert.ok(domainSummaryByValue.has(domain), `domain summary should include ${domain}`);
  assert.equal(
    domainSummaryByValue.get(domain).zhLabel,
    expectedDomainLabels[domain],
    `${domain} summary should keep its Chinese product label`,
  );
}
assert.ok(
  domainSummaryByValue.get("assets").moduleIds.includes("inventory"),
  "assets domain should include inventory",
);
assert.ok(
  domainSummaryByValue.get("assets").moduleIds.includes("finance"),
  "assets domain should include finance as gated/hidden material",
);
assert.ok(
  domainSummaryByValue.get("platform").capabilityMaterialModuleIds.includes("secretary"),
  "secretary should be tracked as platform capability material, not as a frontstage domain",
);

const capabilitySummaryByValue = new Map(
  registry.capabilitySummary.map((capability) => [capability.capability, capability]),
);
for (const capability of ["capture", "search_retrieval", "approval_gate", "entitlement_subscription"]) {
  assert.ok(capabilitySummaryByValue.has(capability), `capability summary should include ${capability}`);
}
assert.ok(
  capabilitySummaryByValue.get("search_retrieval").providerModuleIds.includes("inventory"),
  "inventory should provide the Search capability",
);
assert.ok(
  capabilitySummaryByValue.get("approval_gate").providerModuleIds.includes("finance"),
  "finance should remain visible in approval-gated capability tracking",
);
assert.ok(
  registry.capabilityMaterialSummary.some((item) => item.moduleId === "secretary"),
  "capability material summary should include secretary",
);

const moduleRegistry = buildModuleRegistry(portalConfig);
assert.equal(
  moduleRegistry.domainCapabilityTaxonomy?.version,
  "domain-capability-taxonomy-v1",
  "module registry should expose domain capability taxonomy as a first-class registry field",
);
assert.deepEqual(
  moduleRegistry.domainCapabilityTaxonomy.frontstageDomains,
  expectedFrontstageDomains,
  "module registry should carry frontstage domains without relying on toolManifest internals",
);
assert.deepEqual(
  moduleRegistry.domainCapabilityTaxonomy.contextWritebackLoop,
  expectedContextWritebackLoop,
  "module registry should expose the same context writeback loop",
);
assert.ok(
  moduleRegistry.domainSummary.some((domain) => domain.domain === "platform" && !domain.frontstage),
  "module registry should expose platform as support domain summary",
);
assert.ok(
  moduleRegistry.capabilitySummary.some((capability) => capability.capability === "search_retrieval"),
  "module registry should expose capability summary as first-class registry field",
);
assert.ok(
  moduleRegistry.capabilityMaterialSummary.some((item) => item.moduleId === "secretary"),
  "module registry should expose old/capability material summary separately",
);
assert.equal(
  moduleRegistry.materialLibrarySummary.version,
  "module-material-library-v1",
  "module registry should expose old-tool material library summary",
);
assert.equal(
  moduleRegistry.materialLibrarySummary.boundaries.touchesOldRepos,
  false,
  "material library contract should not touch old repositories",
);
assert.equal(
  moduleRegistry.materialLibrarySummary.boundaries.touchesOldGithub,
  false,
  "material library contract should not touch old GitHub repositories",
);
assert.equal(
  moduleRegistry.materialLibrarySummary.boundaries.touchesOldDeployments,
  false,
  "material library contract should not touch old deployments",
);
assert.ok(
  moduleRegistry.materialLibrarySummary.modules.some((item) => item.moduleId === "finance"),
  "module registry material library should retain hidden/gated old modules as reusable material",
);

const modulesById = new Map(moduleRegistry.modules.map((module) => [module.id, module]));
for (const id of ["inventory", "finance", "secretary"]) {
  const module = modulesById.get(id);
  const manifest = manifestsById.get(id);
  assert.equal(module.primaryDomain, manifest.primaryDomain, `${id} should carry primaryDomain`);
  assert.equal(module.primaryDomainZhLabel, manifest.primaryDomainZhLabel, `${id} should carry primaryDomainZhLabel`);
  assert.deepEqual(module.providedCapabilities, manifest.providedCapabilities, `${id} should carry providedCapabilities`);
  assert.equal(module.gateLevel, manifest.gateLevel, `${id} should carry gateLevel`);
}

console.log("domain capability taxonomy contract passed");
