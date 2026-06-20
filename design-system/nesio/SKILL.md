---
name: nesio-design
description: Use this skill to generate well-branded interfaces and assets for Nesio (宝盒 / Treasure Box), either for production or throwaway prototypes/mocks. Contains the calm liquid-glass design language, day + night palettes, multilingual type, warm-coach copy voice, tokens, assets, and UI-kit components.
user-invocable: true
---

Read `readme.md` first, then explore the token CSS in `tokens/`, the components in `components/`, and the shell recreation in `ui_kits/shell/`.

Core rules to honor:
- **Anchor palette** `#588ce3 · #96c7f3 · #cddefc`; two themes via `<html data-portal-theme="day|night">`. Don't invent new hues.
- **Liquid glass** is the signature surface — subtle frosted panels over the fixed gradient. Use `.nesio-glass` / `GlassCard`.
- **Warm-coach voice** — never judge, rush, or guilt. "陪你看见", one small step, always an exit (跳过/稍后). Red only for real expiry/safety.
- **Multilingual** — 简体中文 / English / 日本語 / 한국어. Use `lib/i18n.js`.

If creating visual artifacts (slides, mocks, throwaway prototypes), copy assets out of `assets/` and write static HTML that links `styles.css`. If working on production code, lift the exact token values and copy voice from here.

If invoked with no other guidance, ask what the user wants to build, ask a few focused questions, and act as an expert designer who outputs HTML artifacts or production code as needed.
