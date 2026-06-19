# Repository Boundary Cleanup

Baohe is now a modular toolbox platform. The repo should behave like product
infrastructure, not a personal experiment bucket.

This plan is intentionally non-destructive. It documents the cleanup order before
moving, deleting, or migrating anything.

## Current Findings

- `lib/portal/` has 53 top-level files and now has an architecture boundary doc.
- `.gitmodules` has 5 submodules:
  - `storage-ios` -> `https://github.com/hanbing6228/storage.git`
  - `psych-tool-ios` -> `https://github.com/hanbing6228/consult.git`
  - `questionbank-ios` -> `https://github.com/hanbing6228/questionbank.git`
  - `reading-ios` -> `https://github.com/hanbing6228/reading.git`
  - `weaver-ai` -> `https://github.com/hanbing6228/Weaver.git`
- `memory/` contains an independent app shape:
  - `package.json`
  - `next.config.js`
  - `middleware.ts`
  - `prisma/`
  - `DEPLOY.md`
  - `render.yaml`
  - app/lib/scripts/public directories

## Priority Order

1. Clean `memory/` boundary.
2. Stabilize `lib/portal/` architecture and ownership.
3. Document submodule policy.
4. Then revisit homepage information hierarchy / quiet UX.

## A. Memory Boundary

Goal: stop `memory/` from polluting Baohe product boundaries.

Current scan command:

```bash
npm run report:repository-boundaries
```

Current state:

- No Baohe runtime dependency should import `memory/`.
- `memory/` still has an independent app shape.
- Legacy GitHub Pages deployment currently references `memory/public` and
  sandbox tool bundles; treat this as `needs_decision`, not as a runtime import.

Recommended safe sequence:

1. Mark `memory/` as an external or archived app in docs.
2. Inventory whether anything in Baohe imports or references `memory/`.
3. If no runtime dependency exists, choose one path:
   - move it to a separate repository;
   - convert it to a submodule;
   - archive it outside the Baohe repo;
   - keep it temporarily but exclude it from release/build/package checks.
4. Only after backup and owner confirmation, remove it from the main repo.

Do not do automatically:

- delete `memory/`;
- migrate its database;
- change its deployment;
- expose or sync its data;
- merge its Prisma/Auth/Deploy model into Baohe.

CEO Gate needed if cleanup touches real user data, production deploys, external
auth, database migration, or public service availability.

Important: changing `.github/workflows/deploy.yml` can alter a public GitHub
Pages surface. Do not remove the `memory` bundle from that workflow until the
desired public availability is confirmed.

## B. Lib Portal Boundary

Goal: make the platform layer understandable and change-safe.

Done:

- Added `lib/portal/ARCHITECTURE.md`.

Next small slices:

1. Add file ownership comments only where ambiguity causes mistakes.
2. Split large files only after tests protect current behavior.
3. Keep report scripts as consumers of `lib/portal`, not alternate truth sources.
4. Add a small architecture drift test later if file groups start drifting.

## C. Submodule Strategy

Goal: keep external tool code visible without turning every tool into a release
blocker.

Doctor command:

```bash
npm run doctor:submodules
```

Expected remediation when a checkout is missing submodule contents:

```bash
git submodule update --init --recursive
```

Policy:

- Baohe main app owns Shell, registry, launch surface, local Inventory, and
  platform contracts.
- Submodules are external tool source mirrors or integration references.
- A submodule is not automatically part of the public launch surface.
- Submodule updates should be intentional, reviewed, and paired with a short
  reason: "source refresh", "bug fix needed by Baohe", or "contract review".
- Do not update all submodules casually before release QA.
- Do not migrate all submodules to npm workspaces or Turborepo as a default
  cleanup step.

Suggested states:

- `active_launch_dependency`: required for current public path.
- `sandbox_reference`: useful for testers, not public.
- `contract_reference`: registry/report only.
- `archive_candidate`: keep until explicitly archived.

Current recommended classification:

- `storage-ios`: `active_launch_dependency` / Inventory lineage.
- `psych-tool-ios`: `contract_reference` / high-trust gated.
- `questionbank-ios`: `sandbox_reference` / future paid or learning path.
- `reading-ios`: `sandbox_reference` / future paid or learning path.
- `weaver-ai`: `contract_reference` / gated strategy-risk module.

Why not Turborepo now:

- The current submodules are mostly iOS or standalone app references, not shared
  TypeScript packages with a common build graph.
- Baohe's immediate release risk is launch surface clarity, local data safety,
  and PWA/iOS wrapper stability, not monorepo build orchestration.
- Moving every tool now would create a large file/history migration before the
  product surface is stable.
- A future monorepo can still happen selectively when a tool becomes
  `launchable`, has shared runtime contracts, or needs a single release train
  with Baohe.

Selective migration trigger:

- The tool is launchable or monetized.
- The tool shares code with Shell, local data adapters, entitlement, or E2E
  tests.
- Keeping it as a submodule causes repeated build, QA, or release failures.
- The tool has a clear owner and rollback plan.

Until then, the supported near-term pattern is:

1. keep submodules classified;
2. run the doctor check during handoff or release prep;
3. update only the submodule required by the current task;
4. document the reason for any submodule pointer change.

## D. Homepage Quieting

Goal: reduce visual and cognitive noise without redoing the product.

Not the current highest priority.

Later UX slices:

- reduce duplicated entry labels;
- keep time/weather on one mobile row;
- remove bright night-theme glare;
- keep quote and calendar calm;
- preserve Inventory-first launch clarity;
- keep high-risk tools hidden from public users.

## Definition Of Done

For this cleanup phase:

- `lib/portal/ARCHITECTURE.md` exists and describes allowed responsibilities.
- `memory/` has a documented decision path before any destructive change.
- submodule policy is documented.
- worktree is clean after documentation changes.
- no UI, runtime data, external auth, cloud, payment, or production behavior is
  changed.
