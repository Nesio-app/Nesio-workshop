# API Routes — Auth Matrix

Generated from the 2026-07 security audit. **Every new route that spends
money (AI calls) or touches private data MUST call `guardAiRoute` from
`lib/portal/api-auth.ts`** (or implement the equivalent triple check) and
appear in this table. The audit that produced this doc found 14 AI routes
with no auth at all — keep the table current so that can't recur silently.

Auth legend:
- **guard** — `guardAiRoute`: session cookie / stage5 secret / no-Supabase
  local mode (+ same-origin check) + per-IP rate limit
- **session** — route-local check of `baohe_auth_*` cookies (+ stage5/lab)
- **secret** — shared secret (`INGEST_SHARED_SECRET` etc.)
- **state** — OAuth state-cookie validation (pre-auth flows)
- **open** — intentionally public

## AI-spending routes (all guarded)

| Route | Auth | Rate limit |
|---|---|---|
| POST /api/portal/chat | guard | 20/min |
| POST /api/portal/tts | guard | 10/min |
| POST /api/portal/daily-brief | guard | 15/min |
| POST /api/portal/guidance-language | guard | 20/min |
| POST /api/portal/living-model | guard | 10/min |
| POST /api/portal/insights | guard | 15/min |
| POST /api/portal/proactive | guard | 20/min |
| POST /api/portal/decompose-task | guard | 20/min |
| POST /api/portal/meeting-notes | guard | 15/min |
| POST /api/portal/life-state | guard | 15/min |
| POST /api/portal/notion | guard | 15/min |
| POST /api/portal/health | guard | 10/min |
| POST /api/health/analyze | guard | 20/min |
| POST /api/health/chat | guard | 20/min |
| POST /api/portal/analyze | session (route-local) | — |
| POST /api/portal/ingest | secret / session | — |
| POST /api/portal/embed | session / no-Supabase | — |
| POST /api/secretary/chat | session / lab | — |

## Private-data routes

| Route | Auth |
|---|---|
| GET /api/portal/gmail | session / no-Supabase + OAuth token |
| GET /api/portal/gmail-quick | session / no-Supabase + OAuth token |
| GET /api/portal/calendar | session / no-Supabase (cloud mode fails closed) |
| GET /api/auth/session | open (reports session state) |

## OAuth flows (pre-auth by design)

| Route | Protection |
|---|---|
| GET /api/portal/gmail/connect | redirects to Google consent |
| GET /api/portal/gmail/callback | state cookie validation |
| GET /api/portal/calendar/connect | redirects to Google consent |
| GET /api/portal/calendar/oauth/callback | state cookie validation |

## Telemetry

| Route | Auth |
|---|---|
| POST /api/telemetry | guard-style (auth + 60/min) — event names/props whitelisted & truncated |

## Known-open routes

`/api/portal/quote`, `/api/portal/production/health`, `/api/modules`,
`/api/entitlements` and similar read-only/config routes are intentionally
open. If one of these starts touching AI or private data, move it up a table.
