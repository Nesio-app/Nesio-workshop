# Baohe V14 Runtime Implementation - Qiao

Source spec: `/Users/jing/Downloads/treasureboxredesign 14.html`
Tech logic reference: `/Users/jing/Downloads/treasureboxtechspec (1).md`

Status: implementation-ready for Ming QA. Figma delivery is skipped per user; this report covers V14 source/runtime implementation only.

## Scope

- Mobile-first Shell homepage redesign.
- Onboarding, warm coach, Todo/crush task, AI Friends preview hub, tool-pack discovery, Inventory/purchase-memory first-launch surface, and settings safety surface.
- Local/mock personalization contract for V14 data depth, memory cards, insight slots, and insight feedback.
- No real AI runtime, external authorization, cloud sync, payment, health/finance/psych execution, App Store submission, or deploy.

## Frame Coverage

| V14 frame | Runtime evidence | QA evidence |
| --- | --- | --- |
| `00 Direction / Engineering Handoff` | Launch/public boundary remains `plan + inventory`; high-risk tools stay gated or hidden. Notes are an entry, not a bottom tab. | `e2e/shell-discovery.spec.ts`; `npm run report:launch-readiness`; `npm run test:precheck` |
| `01 Onboarding / Name` | `components/portal/PortalOnboarding.tsx` asks display name and shows no-registration copy. | `V14 first launch onboarding saves local name and coach style` |
| `02 Onboarding / Coach Style` | `PortalOnboarding` shows coach style as the second onboarding step, offers 极简清透 / 温暖陪伴 / 专业高效, and stores local coach style. | `V14 first launch onboarding saves local name and coach style` |
| `03 Home / Warm Coach` | `DashboardHome` adds identity/status card, one primary CTA, defer reminder, and Today Tool Pack. | `V14 warm coach home exposes one primary next action and inventory pack` |
| `04 Sheet / Crush Task` | `DashboardHome` renders the crush-task bottom sheet with 完成这一步 / 再拆小一点 / 打开待办. | `V14 warm coach home exposes one primary next action and inventory pack` |
| `05 AI Friends / Stable Hub` | `PortalAiFriendsPreview` opens from bottom nav as a gated stable hub with group/single/record modes and provider/tool chips. | `V14 bottom nav opens AI Friends as gated stable hub preview` |
| `06 Tool Packs / Discovery` | `ToolsTreasureSheet` adds the 轻启动包 surface plus 我的工具 entries: 物品库可打开; 支出记录 / 重要日期 / 稍后处理 stay preview-disabled; future health/finance/psych/automation stays gated. | `shell toolbox opens, keeps its open state after refresh, and closes` |
| `07 Inventory / Purchase Memory` | `storage-web/index.html` adds the Inventory/purchase-memory first-launch surface; storage PWA already supports search, add, edit, export/delete, restore, and offline. | `storage PWA exports local data and restores it after clearing` |
| `08 Me / Connections & Safety` | `AccountSettings` adds a connection/safety surface for Calendar, AI, health/finance/psych, automation/external auth. | `settings exposes V14 connections and safety boundary` |

## V14 Personalization Logic

- `lib/portal/personalization-insights.ts` now carries local/mock equivalents for profile depth, memory insight rows, pending insight, personalization slots, and feedback state.
- The runtime intentionally does not call `/api/v1/*` or require tokens. Those API shapes remain future architecture only.
- Insight display is fail-closed: first-use profiles and profiles under 7 days do not show insight cards; confidence under 75 is hidden; normal-priority insights only show between 08:00 and 22:00; each user gets at most one insight card per day.
- Feedback is local-only: positive feedback is remembered as an acknowledgement; negative feedback suppresses the same insight for 30 days.

## Verified Commands

- `npm run test:e2e:v14-screenshots -- --reporter=line`
- `npm run test:qa:static`
- `npm run test:v14-coverage`
- `node scripts/report-module-registry-launch-sku.test.mjs`
- `node scripts/web-surface-contract-v0.test.mjs`
- `npx playwright test e2e/shell-discovery.spec.ts --reporter=line`
- `npx playwright test e2e/storage-local-backup.spec.ts --reporter=line`
- `npx tsc --noEmit --incremental false`
- `npm run lint`
- `npm run build`
- `git diff --check`

## Runtime Screenshot Pack

Latest regenerated pack verifies two-step onboarding, confirms the crush-task sheet uses a solid readable bottom-sheet surface that is not affected by the homepage `portalRise` opacity animation, and captures the Tool Packs popup as an element-level screenshot with 轻启动包 plus 我的工具.

- `outputs/v14-runtime-screenshots/manifest.json`
- `outputs/v14-runtime-screenshots/01-onboarding-name.png`
- `outputs/v14-runtime-screenshots/02-onboarding-coach-style.png`
- `outputs/v14-runtime-screenshots/03-home-warm-coach.png`
- `outputs/v14-runtime-screenshots/04-crush-task-sheet.png`
- `outputs/v14-runtime-screenshots/05-ai-friends-stable-hub.png`
- `outputs/v14-runtime-screenshots/06-tool-packs-discovery.png`
- `outputs/v14-runtime-screenshots/07-inventory-purchase-memory.png`
- `outputs/v14-runtime-screenshots/08-me-connections-safety.png`

## Boundaries Preserved

- Public launch modules remain `plan` and `inventory`; Todo is launch support for homepage crush-task/reminder flows, not a broad automation promise.
- `secretary` is not exposed in the toolbox and `/secretary` remains gated outside launch scope.
- AI Friends is a preview hub only; it does not claim active external AI automation.
- Google Calendar only stores/opens a user-provided link; private event sync remains off.
- Finance, health, psychoanalysis, automation, payment, cloud, StoreKit, and external authorization remain CEO-gated.

```handoff
status: ready
from: Qiao
to: Ming
reason: Baohe V14 runtime implementation coverage is documented and ready for QA verification
needs_ceo_gate: no
resume_action: Ming QA validates the 9-frame coverage against mobile runtime and screenshots; CEO only gates external AI/auth, high-risk modules, or release
artifact: outputs/2026-06-19-baohe-v14-runtime-implementation-qiao.md
blocker: 无
```
