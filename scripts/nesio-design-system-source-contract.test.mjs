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
