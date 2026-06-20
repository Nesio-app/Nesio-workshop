import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const globalsPath = path.join(repoRoot, "app", "globals.css");
const packagePath = path.join(repoRoot, "package.json");

const globals = fs.readFileSync(globalsPath, "utf8");
const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));

function includesToken(name, value) {
  assert.match(
    globals,
    new RegExp(`${name}\\s*:\\s*${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i"),
    `Expected ${name}: ${value} in app/globals.css`,
  );
}

assert.match(globals, /Nesio Design System v0/, "Expected globals.css to mark the Nesio Design System v0 contract");

includesToken("--portal-blue-deep", "#588ce3");
includesToken("--portal-blue-mid", "#96c7f3");
includesToken("--portal-blue-light", "#cddefc");
includesToken("--glass-blur", "12px");
includesToken("--glass-bg", "rgba(255, 255, 255, 0.42)");
includesToken("--glass-bg-raised", "rgba(255, 255, 255, 0.62)");
includesToken("--glass-bg-solid", "rgba(255, 255, 255, 0.82)");
includesToken("--glass-bg-pop", "rgba(252, 251, 248, 0.96)");
includesToken("--glass-border", "var(--portal-line)");
includesToken("--shadow-card", "0 10px 28px rgba(88, 140, 227, 0.08)");
includesToken("--shadow-raise", "0 12px 32px rgba(88, 140, 227, 0.14)");
includesToken("--shadow-pop", "0 24px 60px rgba(30, 30, 28, 0.12)");
includesToken("--tap-min", "44px");
includesToken("--modal-backdrop-blur", "2.5px");
includesToken("--modal-backdrop-bg", "rgba(16, 28, 54, 0.18)");
includesToken("--modal-card-blur", "16px");
includesToken("--modal-card-bg", "rgba(248, 251, 255, 0.9)");
includesToken("--radius-md", "1rem");
includesToken("--radius-lg", "1.25rem");
includesToken("--radius-xl", "1.75rem");
includesToken("--radius-pill", "999px");
includesToken("--ease-soft", "cubic-bezier(0.22, 0.61, 0.36, 1)");
includesToken("--dur", "0.3s");

assert.match(
  globals,
  /html\[data-portal-theme="night"\][\s\S]*--portal-bg-gradient\s*:/,
  "Expected night theme to define --portal-bg-gradient",
);
assert.match(globals, /\.nesio-glass\b/, "Expected .nesio-glass utility");
assert.match(globals, /\.nesio-glass-pop\b/, "Expected .nesio-glass-pop utility");
assert.match(globals, /\.nesio-tap-target\b/, "Expected .nesio-tap-target utility");
assert.match(
  globals,
  /\.nesio-glass\s*\{[\s\S]*background:\s*var\(--glass-bg-solid\)/,
  "Expected .nesio-glass to use the design-system solid glass surface",
);
assert.match(
  globals,
  /\.nesio-glass\s*\{[\s\S]*box-shadow:\s*var\(--shadow-card\),\s*var\(--glass-highlight\)/,
  "Expected .nesio-glass to include the design-system inner highlight",
);
assert.match(
  globals,
  /portal-ai-modal-layer[\s\S]*backdrop-filter:\s*blur\(var\(--modal-backdrop-blur\)\) saturate\(var\(--modal-backdrop-saturate\)\)/,
  "Expected shared modal layers to use Nesio modal backdrop tokens",
);
assert.match(
  globals,
  /portal-ai-call-sheet[\s\S]*background:\s*var\(--modal-card-bg\)/,
  "Expected shared modal cards to use the Nesio modal card background token",
);
assert.match(
  globals,
  /portal-ai-call-sheet[\s\S]*backdrop-filter:\s*blur\(var\(--modal-card-blur\)\) saturate\(var\(--modal-card-saturate\)\)/,
  "Expected shared modal cards to use the Nesio modal card blur tokens",
);

assert.equal(
  pkg.scripts["test:nesio-design-system"],
  "node scripts/nesio-design-system-integration.test.mjs",
  "Expected package script test:nesio-design-system",
);
assert.match(
  pkg.scripts["test:contracts"],
  /test:nesio-design-system/,
  "Expected test:contracts to include test:nesio-design-system",
);

console.log("Nesio design system integration contract OK");
