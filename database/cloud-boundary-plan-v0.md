# Baohe Cloud Boundary Plan v0

Status: contract-only / no production data.

## Current Local Boundary

- Runtime: Next.js local/dev, Vercel-compatible.
- DB: local SQLite via `BAOHE_DB_PATH`.
- User model: `local_profile`, not real auth user.
- API: frontend must call REST routes, not DB APIs.
- Data: mock/local/demo fixtures only.

## Candidate Cloud Stack

- Vercel: app hosting and serverless API runtime.
- Neon or Supabase Postgres: future managed Postgres, not enabled in v0.
- Supabase Auth/Firebase Auth: future auth candidates, not enabled in v0.
- Cloudflare: optional edge/cache/WAF layer, not required in v0.

## Environment Variables

- `BAOHE_ENV`: `local | staging | production`.
- `BAOHE_DB_PROVIDER`: `sqlite | neon | supabase`.
- `BAOHE_DB_PATH`: local SQLite path.
- `BAOHE_DATABASE_URL`: future cloud DB URL, server-only secret.
- `BAOHE_PUBLIC_API_BASE_URL`: frontend API base URL.
- `BAOHE_DEC_RATE_LIMIT_WINDOW_MS`: local DEC rate-limit window.
- `BAOHE_DEC_RATE_LIMIT_MAX_REQUESTS`: local DEC max requests.
- `BAOHE_AI_PROVIDER_MODE`: `disabled | internal_sandbox | production`.
- `OPENAI_API_KEY`, `GEMINI_API_KEY`: future provider secrets, not required for launch.

## Network Boundary

- Browser may call only app REST APIs.
- Browser must not call DB provider APIs directly.
- Server API routes own DB reads/writes.
- External provider calls require CEO Gate before production.
- Webhooks require CEO Gate and signed verification before enablement.

## Backup And Restore

- Local SQLite: file copy snapshot before migration.
- Staging Postgres future: daily logical backup plus migration rollback dry-run.
- Production future: point-in-time recovery, tested restore runbook, and delete/export audit trail.
- v0 does not migrate real data and does not promise production restore.

## CEO Gate Triggers

- Enabling cloud DB for real users.
- Adding real auth.
- Migrating/importing/exporting real user data.
- Enabling AI provider calls for launch.
- Enabling webhooks, payment, notification, health, or mental/reflection workflows.
