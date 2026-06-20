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
includesToken("--tap-min", "44px");
includesToken("--radius-pill", "999px");
includesToken("--ease-soft", "cubic-bezier(0.22, 1, 0.36, 1)");

assert.match(
  globals,
  /html\[data-portal-theme="night"\][\s\S]*--portal-bg-gradient\s*:/,
  "Expected night theme to define --portal-bg-gradient",
);
assert.match(globals, /\.nesio-glass\b/, "Expected .nesio-glass utility");
assert.match(globals, /\.nesio-glass-pop\b/, "Expected .nesio-glass-pop utility");
assert.match(globals, /\.nesio-tap-target\b/, "Expected .nesio-tap-target utility");

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
