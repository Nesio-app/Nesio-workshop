# Nesio · 宝盒 Design System

> 把复杂的部分放到后台，把极简流畅的体验留给用户。
> Complex work happens in the background; what reaches the user is calm and effortless.

Nesio (宝盒 / "Treasure Box") gathers small but important personal workflows into **one calm system** — purchase memory, inventory, notes, records, and the tools that make daily life feel organized. It is highly customizable like Notion, but friendlier: a complex back-end is integrated for you, and a personal, highly-curated front-end is presented. The home is a **quiet digital courtyard** (数字静谧庭院), not a dashboard.

This design system codifies the colors, type, spacing, glass, motion, components, and copy voice so engineers can embed every module into one coherent shell — and new modules launch already on-brand and fully localized.

---

## Sources (the live product this system is lifted from)

- **Shell / 宝盒 portal:** https://treasurebox-nu.vercel.app · repo `github.com/hanbing6228/treasurebox` (Next.js; `app/globals.css`, `components/portal/*`, `public/portal-config.json`)
- **The 11 modules:** 待办 `lifeflow` · 收纳 `storage` · 阅读 `reading` · 健身 `fitness` · 智友 (AI) · 刷题 `questionbank` · 咨询 `consult` · 冥想 `inner-space` · 溯/健康 `health` · 财务 `finance` · 人生 `Weaver`
- Day palette anchor (huemint gradient-3): `#588ce3 · #96c7f3 · #cddefc`

The day **and** night palettes here are taken directly from the shipped shell — the UI is final; this system documents it, it does not redesign it.

---

## CONTENT FUNDAMENTALS — the warm-coach voice

宝盒 speaks like a **warm coach, not a sweeter taskmaster**. The warmth comes from *not judging, not rushing, not manufacturing guilt* — not from cuter words.

Principles (apply to every string):
- **"提醒" → "陪你看见"** ("I'll help you see"). Avoid 逾期 / 失败 / 未完成 / 风险很高. Prefer "还有一件事可以轻轻处理" / "这个可以稍后再看".
- **Big goal → one small action.** Push a single next step: "记录这件物品", "先保存想法", "稍后决定是否购买".
- **No moral judgment.** Impulse spending is never "你又想买了" — it's "先放进冷静区，明天再决定也可以".
- **No red-anxiety system.** Red is reserved for genuine safety / expiry. Everyday to-dos use amber (`gentle`), blue-gray (`calm`), or green (`go`).
- **Always an exit.** Every suggestion offers 跳过 / 稍后 / 不再提醒 / 改成更轻提醒.

Voice samples (from the shell's `energyQuotes`): "把大事拆小，把今天过好就够了。" · "你已经做得很好了，休息也是前进。" · "允许自己不确定，答案会在路上长出来。"

Casing/tone: lowercase, gentle, present-tense, second-person but never imperative. No exclamation marks, no hype. Emoji appear only as tool/app icons, not in body copy.

---

## VISUAL FOUNDATIONS

- **Palette.** Three cool blues over a soft sky. `blue-deep #588ce3` is the only primary accent. Everything else is tint, ink, or muted blue-gray. See `tokens/colors.css`.
- **Two themes.** `<html data-portal-theme="day|night">`. Day = pale sky gradient + airy white frost glass. Night = deep blue-night gradient (`#17233a→#0a1322`) + faint luminous glass (`white 5.5%`). Both ship in `colors.css` + `effects.css`.
- **Liquid glass.** The signature surface. Frosted panels (`backdrop-filter: blur(12px)`) float over a fixed background gradient, with hairline blue borders (`--portal-line`) and a soft inner highlight. Use `.nesio-glass` or the `GlassCard` component. Intensity is **subtle** — barely-there frost, never heavy.
- **Background.** A fixed radial+linear gradient (light→mid→deep), plus a faint fractal **grain** overlay (`.portal-grain`) for the "courtyard" texture. Content scrolls over it.
- **Type.** Body = Noto Sans (SC/JP/KR cascade) — humanist, multilingual. Display & quotes = Noto Serif SC, quiet and literary. Generous line-height (1.7 for quotes/reading). See `tokens/typography.css`.
- **Corners.** Generous: cards 16–20px, sheets/modals 28px, chips/buttons/fabs/avatars are pills. See `tokens/spacing.css`.
- **Shadows.** Tinted blue and soft (`0 10px 28px rgba(88,140,227,.08)` day; black at higher alpha night). Cards lift ~3px on hover.
- **Motion.** Soft and short — `--ease-soft` / `--ease-out`, 0.2–0.6s. Buttons press with a 0.96 scale; cards lift; a gentle tap **ripple** (`.om-ripple`) and a `nesio-fade-in` entrance. No bounces, no infinite loops.
- **Zones (three cabins).** Tools belong to one of three tones: `cool` 秩序与跃迁 · `warm` 觉察与锚定 · `neutral` 体现与投射. Tone tints the card background and accent.
- **Status colors.** `go` (green) · `gentle` (amber) · `calm` (blue-gray) · `risk` (muted red, real risk only). Always soft-tinted backgrounds.

---

## ICONOGRAPHY

- **Tool marks** (`assets/icons/tools/*.svg`): 48×48 app-style **squircles** (rx 12), flat, 2-color blue/orange accent. One per module. These are the brand's own icons — copy them in, never redraw.
- **AI marks** (`assets/icons/ai/*.svg`): Claude, ChatGPT, Gemini, DeepSeek, 豆包, Grok — used inside 智友 (the AI group-chat entry).
- **Brand mark** (`assets/logo/treasurebox*.{svg,png}`): the faceted glass **crystal** — the treasure-box facet. Works on both day and night gradients.
- **UI glyphs**: simple unicode / inline marks (✎ note, 💬 AI, ⊕ more, ◷ todo). Keep them minimal. No icon font is required; emoji are acceptable only as tool/affordance icons.

---

## Index

| Path | What |
|---|---|
| `styles.css` | Global entry — link this one file. |
| `tokens/fonts.css` | Multilingual webfont loading (zh/en/ja/ko). |
| `tokens/colors.css` | Day + night palettes, zones, warm-coach status. |
| `tokens/typography.css` | Families, weights, type scale. |
| `tokens/spacing.css` | Spacing grid, radii, layout. |
| `tokens/effects.css` | Liquid glass, shadows, motion, grain, ripple. |
| `lib/i18n.js` | zh / en / ja / ko strings + `t(locale, key)`. |
| `components/core/` | Button, GlassCard, Input, StatusBadge, FloatingButton. |
| `components/portal/` | ToolModuleCard, ReminderCard, QuoteCard, WeatherTime. |
| `ui_kits/shell/` | The interactive 宝盒 home (day/night, 4 languages). |
| `guidelines/` | Foundation specimen cards (Design System tab). |
| `assets/` | Tool icons, AI icons, brand crystal. |

**Namespace:** components are exposed at `window.NesioDesignSystem_d76dec.<Name>`.

> Set the file type to **Design System** in the Share menu so your org can use it.
