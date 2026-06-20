export const NESIO_DESIGN_SYSTEM_VERSION = "nesio-design-system-v0";

export const nesioDesignSystemSource = Object.freeze({
  version: NESIO_DESIGN_SYSTEM_VERSION,
  sourceName: "Nosio Design System",
  sourcePath: "/Users/jing/Downloads/Nosio Design System",
  productionImportMode: "lift-token-values-not-wholesale-css-import",
  requiredTokenFiles: Object.freeze([
    "tokens/fonts.css",
    "tokens/colors.css",
    "tokens/typography.css",
    "tokens/spacing.css",
    "tokens/effects.css",
  ]),
  referenceOnlyArtifacts: Object.freeze([
    "ui_kits/shell/Home.jsx",
    "ui_kits/shell/index.html",
    "guidelines/*.html",
  ]),
});

export const nesioDesignTokens = Object.freeze({
  anchorPalette: Object.freeze(["#588ce3", "#96c7f3", "#cddefc"]),
  themeModes: Object.freeze(["day", "night"]),
  themeAttribute: "data-portal-theme",
  primarySurfaceTokens: Object.freeze([
    "--portal-bg-gradient",
    "--portal-ink",
    "--portal-muted",
    "--portal-line",
    "--glass-bg",
    "--glass-bg-raised",
    "--glass-bg-solid",
    "--glass-bg-pop",
    "--glass-blur",
    "--glass-border",
    "--shadow-card",
    "--shadow-pop",
  ]),
  modalTokens: Object.freeze([
    "--modal-backdrop-bg",
    "--modal-backdrop-blur",
    "--modal-card-bg",
    "--modal-card-blur",
  ]),
});

export const nesioRuntimeSurfaces = Object.freeze([
  "portal-root",
  "home-shell",
  "bottom-nav",
  "toolbox",
  "ai-friends",
  "settings",
  "modal-layer",
  "crush-task",
  "purchased-tools-sheet",
]);

export const nesioDesignSystemGuardrails = Object.freeze({
  noWholesaleUiReplacement: true,
  shellKitIsReferenceOnly: true,
  allModalsUseSharedGlassTokens: true,
  allTouchTargetsAtLeast44px: true,
  rawHexShouldNotBeIntroducedInComponents: true,
  warmCoachCopyOnly: true,
  redReservedForRealRisk: true,
});

export const nesioDesignSystemContract = Object.freeze({
  version: NESIO_DESIGN_SYSTEM_VERSION,
  source: nesioDesignSystemSource,
  tokens: nesioDesignTokens,
  runtimeSurfaces: nesioRuntimeSurfaces,
  guardrails: nesioDesignSystemGuardrails,
});
