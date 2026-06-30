# Signal main-table switch v1

Status: plan-only, CEO Gate required before execution.

This document defines the future switch from local-first Memory / LifeGraph facts to `public.signals` as the primary fact table. It is not an executable migration and it must not be run as part of normal deploys.

## Current phase

- `public.signals` exists as the cloud Signal table with RLS.
- Runtime remains in dual-write mode: Memory / LifeGraph continue to work, while normalized facts mirror into Signals when the user is signed in.
- Today, Ask Nesio, and DEC may read cloud Signals as a fallback or preferred source only when authenticated.
- Memory / LifeGraph projection stays user-visible and local-first during validation.

## Switch prerequisites

- Dual-write has been stable for signed-in users across voice, photo, calendar, gmail, health, task, weather, ingest, and analyze paths.
- Feedback loop writes back to both the feedback Signal and the related evidence Signals.
- Ask Nesio has a privacy-scoped search path over the user's own Signals.
- No anonymous read or write path can access private Signals.
- A current backup/export exists for every affected user dataset.
- CEO Gate approves production migration, rollback window, user communication, and monitoring owner.

## Target shape

- Signal becomes the primary fact table.
- Memory / LifeGraph projection becomes a derived view or local cache.
- Every write path follows `normalize -> createSignal -> projection`.
- Today cards carry `evidenceSignalIds`.
- DEC engines read Signals and stay silent when required evidence is missing.

## Rollout

1. Keep dual-write enabled and compare Memory / LifeGraph projection against Signals.
2. Enable read-priority for signed-in users only.
3. Monitor failed writes, duplicate Signals, missing projections, and feedback writeback.
4. Switch a small internal cohort to Signal-primary reads.
5. Expand only after QA verifies no data loss, no privacy leakage, and no broken local fallback.

## Rollback

- Disable Signal-primary reads.
- Keep Memory / LifeGraph projection as the user-facing source.
- Stop cloud Signal mirror only if write failures are corrupting projections.
- Do not delete or rewrite existing Signals during rollback.

## Explicit non-goals

- no destructive migration.
- No cross-user Signal search.
- No public or anonymous Signal reads.
- No automatic deletion of Memory / LifeGraph data.
- No production main-table switch without CEO Gate.
