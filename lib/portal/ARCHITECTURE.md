# Portal Architecture

`lib/portal` is the Baohe platform boundary layer. It is not one feature module.
It owns the contracts and resolvers that let Shell, tools, local data, launch
readiness, and reports share one vocabulary.

Current top-level file count: 136 (2026-07 audit; was 53 when this doc was
first written — growth is mostly algorithm-layer extractions and contracts,
incl. the 2026-07 health-insight pack: apple-health / health-correlations /
health-insight-prompt / health-clinical / cda-parse / clinical-store.
See docs/api-routes.md for the API surface and its auth matrix).

## Responsibilities

`lib/portal` should contain only these categories:

- Shell runtime resolvers: what the user can see, open, or must be gated from.
- Module registry contracts: manifest, product, launch, route, entitlement, and
  approval metadata.
- Local-first data contracts: Inventory first-launch data, local export/delete,
  offline/conflict readiness, and future cloud readiness.
- Report-only platform contracts: security incident, standalone readiness,
  web surface, data bus, data network, and artifact/status visibility.
- Portal adapters: API client, open-tool helpers, paths, profile/settings,
  calendar/quote/weather utilities, and small UX data helpers.

It should not contain:

- Tool-specific product UI beyond thin shared helpers.
- Real cloud, payment, AI, health, finance, or external authorization runtime.
- One-off release reports or sprint artifacts.
- App Store copy drafts.
- Personal portfolio, notebooks, or unrelated project files.

## File Groups

### Runtime Shell

- `shell-runtime-resolver.mjs`
- `shell-runtime-resolver.d.ts`
- `launch-surface.mjs`
- `launch-surface.d.ts`
- `open-tool.ts`
- `open-tool.mjs`
- `module-routes.mjs`
- `module-routes.d.ts`
- `paths.ts`
- `launch-safety.ts`

Rule: Shell visibility and entry behavior must go through these resolvers. Avoid
scattered component-level checks for launch/gate/paywall state.

### Module Registry And Product Contracts

- `module-manager-core.mjs`
- `module-manager-core.d.ts`
- `module-manager.ts`
- `module-manifest.ts`
- `tool-manifest-v0.mjs`
- `module-product-contract-v0.mjs`
- `module-adapter-contract.mjs`
- `tool-data-versioning-contract.mjs`
- `standalone-app-readiness-contract.mjs`

Rule: new module-level fields should start in the manifest/product contract layer
and then be consumed by reports and Shell. Do not create a second status schema
inside components or scripts.

### Data And Integration Contracts

- `module-data-bus.mjs`
- `module-data-bus.d.ts`
- `module-data-network-db.mjs`
- `local-data-records.mjs`
- `local-data-records.d.ts`
- `inventory-first-launch-contract.mjs`
- `offline-sync-conflict-contract.mjs`
- `cloud-readiness-contract.mjs`
- `external-bridge-contract.mjs`
- `app-api-contract-v0.mjs`
- `app-api-client.ts`
- `dec-data-api.mjs`
- `dec-data-client.ts`
- `dec-access-boundary.ts`

Rule: this layer may describe future account/cloud/sync behavior, but default
runtime must remain local-first and fail-closed unless a CEO-approved gate enables
real external behavior.

### Risk, Governance, And Reports

- `security-incident-readiness-contract.mjs`
- `hardcode-remediation-classifier.mjs`
- `ai-provider-router-contract.mjs`
- `web-surface-contract-v0.mjs`

Rule: report-only contracts must say so explicitly. If a file changes runtime
behavior, its name and tests should make that boundary clear.

### Portal Utilities

- `defaults.ts`
- `types.ts`
- `i18n.ts`
- `profile.ts`
- `calendar-links.ts`
- `calendar-filters.ts`
- `ics.ts`
- `weather.ts`
- `quotes.ts`
- `almanac.ts`
- `greeting.ts`
- `notes.ts`
- `flomo-api.ts`
- `flomo-demo.ts`
- `prefetch-cache.ts`

Rule: these helpers can support the Shell experience, but should stay small. If a
helper becomes a platform contract or a tool implementation, move it into the
right category and add a test.

## Change Rules

1. New tool metadata belongs in Tool Manifest / Module Product Contract first.
2. Public visibility must be resolved by Shell runtime resolver, not by ad hoc UI
   conditions.
3. Approval Gate overrides Paywall Gate.
4. Finance, health, psychoanalysis, AI runtime, external auth, payment, cloud DB,
   and notifications stay fail-closed unless explicitly gated.
5. Report-only fields must not be described as runtime enforcement.
6. Any change that touches real data, real external services, production launch,
   StoreKit, or public claims requires CEO Gate.

## Near-Term Cleanup

- Split `module-manager-core.mjs` if it continues to grow: registry seeds,
  vocabularies, and report projections should become separate files only when
  tests make the split safe.
- Add a `lib/portal/index` export only after consumers are stable. Do not add a
  barrel file that hides ownership too early.
- Keep `scripts/report-module-registry.mjs` as a consumer of contracts, not the
  place where new module truth is invented.
- Keep `components/portal` as a runtime consumer of resolved state, not a second
  registry.
