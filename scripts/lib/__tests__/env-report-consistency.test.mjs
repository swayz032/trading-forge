// scripts/lib/__tests__/env-report-consistency.test.mjs
//
// ★ OR-086 (A): the resolver returns its chosen path SPECIFICALLY so a cold-recovery check
// can assert which .env a rail loaded. The grader found that affordance consumed in exactly
// ONE of five call sites — "fixed the instance, not the class" a second time, inside the
// commit that introduced the affordance.
//
// This is the class guard: EVERY loadEnvironment/loadEnvFile call site must either report
// its result, or carry a documented ENTRYPOINT-EXEMPT marker saying why it does not. It
// self-discovers the sites, so a new rail cannot quietly join the silent majority.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOTS = ["scripts/rails", "scripts/soak", "scripts/lib"];

function callSites() {
  const out = [];
  for (const r of ROOTS) {
    const dir = path.resolve(process.cwd(), r);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".cjs")) continue;
      const file = path.join(r, f);
      const src = fs.readFileSync(path.resolve(process.cwd(), file), "utf8");
      src.split("\n").forEach((line, i) => {
        // the DEFINITIONS live in env-resolve/rail-runtime; we want CALLS
        if (/^\s*(?:function|const)\s/.test(line)) return;
        // `return loadEnvFile(...)` is a PASSTHROUGH — handing the result to the caller IS
        // delivering it. The obligation to report belongs to whoever consumes it, not to a
        // wrapper that forwards it intact.
        if (/^\s*return\s+(loadEnvironment|loadEnvFile)\s*\(/.test(line)) return;
        if (/\b(loadEnvironment|loadEnvFile)\s*\(/.test(line)) out.push({ file, line: i + 1, text: line.trim(), src });
      });
    }
  }
  return out;
}

test("every env call site either REPORTS its result or is documented EXEMPT", () => {
  const sites = callSites();
  assert.ok(sites.length >= 4, `expected the rail entrypoints, found ${sites.length}`);

  const bad = sites.filter(({ text, src, line }) => {
    if (/reportEnvLoad\s*\(/.test(text)) return false;              // reports inline
    const lines = src.split("\n");
    const near = lines.slice(Math.max(0, line - 4), line + 6).join("\n");
    if (/ENTRYPOINT-EXEMPT\(env-report\)/.test(near)) return false; // documented exemption
    if (/reportEnvLoad\s*\(/.test(near)) return false;              // result captured then reported
    return true;
  });

  assert.deepEqual(
    bad.map((b) => `${b.file}:${b.line}`),
    [],
    "these env call sites neither report loadedFrom nor carry a documented ENTRYPOINT-EXEMPT reason",
  );
});

test("an exemption must state a REASON, not just carry the marker", () => {
  for (const r of ROOTS) {
    const dir = path.resolve(process.cwd(), r);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".cjs")) continue;
      const src = fs.readFileSync(path.join(dir, f), "utf8");
      src.split("\n").forEach((line, i) => {
        if (!/ENTRYPOINT-EXEMPT\(env-report\)/.test(line)) return;
        const rest = line.split("ENTRYPOINT-EXEMPT(env-report):")[1] || "";
        assert.ok(rest.trim().length > 10, `${r}/${f}:${i + 1} exemption has no stated reason`);
      });
    }
  }
});
