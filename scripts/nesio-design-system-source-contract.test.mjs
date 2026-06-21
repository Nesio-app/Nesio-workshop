import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const contractPath = path.join(repoRoot, "lib", "portal", "nesio-design-system-contract.mjs");
const packagePath = path.join(repoRoot, "package.json");

const contract = await import(`file://${contractPath}`);
const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));

assert.equal(
  contract.NESIO_DESIGN_SYSTEM_VERSION,
  "nesio-design-system-v0",
  "Expected a versioned Nesio design system contract",
);

assert.equal(
  contract.nesioDesignSystemSource.sourcePath,
  "design-system/nesio",
  "Expected the source design system to live inside the repo, not in Downloads.",
);

assert.equal(
  contract.nesioDesignSystemSource.sourceName,
  "Nesio Design System",
  "Expected the canonical product/design-system name to be Nesio, not Nosio.",
);

assert.equal(
  contract.nesioDesignSystemSource.namespace,
  "NesioDesignSystem_d76dec",
  "Expected the repo-local design-system namespace to use canonical Nesio naming.",
);

assert.equal(
  contract.nesioDesignSystemSource.importedFrom,
  "/Users/jing/Downloads/Nosio Design System",
  "Expected the original imported design-system path to be preserved as provenance only.",
);

const designSystemRoot = path.join(repoRoot, contract.nesioDesignSystemSource.sourcePath);
assert.ok(fs.existsSync(designSystemRoot), "Expected repo-local design-system/nesio directory.");
assert.ok(
  fs.existsSync(path.join(designSystemRoot, "readme.md")),
  "Expected repo-local design-system readme.",
);
assert.ok(
  fs.existsSync(path.join(designSystemRoot, "_ds_manifest.json")),
  "Expected repo-local design-system manifest.",
);
assert.ok(
  fs.existsSync(path.join(designSystemRoot, "_ds_bundle.js")),
  "Expected repo-local design-system bundle for reference provenance.",
);

assert.deepEqual(
  contract.nesioDesignSystemSource.requiredTokenFiles,
  [
    "tokens/fonts.css",
    "tokens/colors.css",
    "tokens/typography.css",
    "tokens/spacing.css",
    "tokens/effects.css",
  ],
  "Expected production contract to keep the downloadable design system token order",
);

assert.deepEqual(
  contract.nesioDesignSystemSource.requiredComponentFiles,
  [
    "components/core/Button.jsx",
    "components/core/FloatingButton.jsx",
    "components/core/GlassCard.jsx",
    "components/core/Input.jsx",
    "components/core/StatusBadge.jsx",
    "components/portal/QuoteCard.jsx",
    "components/portal/ReminderCard.jsx",
    "components/portal/ToolModuleCard.jsx",
    "components/portal/WeatherTime.jsx",
  ],
  "Expected production contract to track the design-system component source files",
);

for (const tokenFile of contract.nesioDesignSystemSource.requiredTokenFiles) {
  assert.ok(
    fs.existsSync(path.join(designSystemRoot, tokenFile)),
    `Expected repo-local design-system token file ${tokenFile}`,
  );
}

for (const componentFile of contract.nesioDesignSystemSource.requiredComponentFiles) {
  assert.ok(
    fs.existsSync(path.join(designSystemRoot, componentFile)),
    `Expected repo-local design-system component file ${componentFile}`,
  );
}

assert.equal(
  contract.nesioDesignSystemSource.productionImportMode,
  "lift-token-values-not-wholesale-css-import",
  "Expected production code to lift reviewed token values instead of importing Downloads directly",
);

const requiredAnchors = ["#588ce3", "#96c7f3", "#cddefc"];
for (const anchor of requiredAnchors) {
  assert.ok(
    contract.nesioDesignTokens.anchorPalette.includes(anchor),
    `Expected anchor palette to include ${anchor}`,
  );
}

for (const theme of ["day", "night"]) {
  assert.ok(contract.nesioDesignTokens.themeModes.includes(theme), `Expected theme mode ${theme}`);
}

for (const surface of [
  "portal-root",
  "home-shell",
  "bottom-nav",
  "toolbox",
  "ai-friends",
  "ai-conversation",
  "ai-call",
  "settings",
  "modal-layer",
  "mood-sheet",
  "reminder-sheet",
  "crush-task",
  "quote-settings",
  "purchased-tools-sheet",
]) {
  assert.ok(
    contract.nesioRuntimeSurfaces.includes(surface),
    `Expected ${surface} to be a governed Nesio runtime surface`,
  );
}

assert.equal(
  contract.nesioDesignSystemGuardrails.noWholesaleUiReplacement,
  true,
  "Expected V14 UI not to be wholesale replaced by the design-system sample shell",
);
assert.equal(
  contract.nesioDesignSystemGuardrails.shellKitIsReferenceOnly,
  true,
  "Expected ui_kits/shell to be treated as reference only",
);
assert.equal(
  contract.nesioDesignSystemGuardrails.allModalsUseSharedGlassTokens,
  true,
  "Expected all modal/sheet surfaces to share glass tokens",
);
assert.equal(
  contract.nesioDesignSystemGuardrails.allTouchTargetsAtLeast44px,
  true,
  "Expected design-system touch target invariant",
);

assert.match(
  pkg.scripts["test:nesio-design-system-source"],
  /nesio-design-system-source-contract\.test\.mjs/,
  "Expected a package script for the source design-system contract",
);
assert.match(
  pkg.scripts["test:contracts"],
  /test:nesio-design-system-source/,
  "Expected test:contracts to include source design-system contract",
);

console.log("Nesio design system source contract OK");
