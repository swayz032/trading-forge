// scripts/lib/__tests__/test-lane-coverage.test.mjs
// Self-policing guard for the scripts/ runner split (ops-experience 2026-07-19, OR-009 §3/§4).
//
// WHY: the scripts/ test estate is written in two incompatible styles. Before this guard,
// `ci/vitest.config.mjs` globbed `scripts/rails/**/*.test.mjs` wholesale, so three node:test
// files were swept into vitest and failed as "No test suite found" (CI RED-by-construction),
// while six more under scripts/lib + scripts/soak were collected by NOTHING and had never
// executed in any lane — including tower-idle-guard, the RED-proof for the component that
// gates every heavy job. Silence looked identical to success.
//
// This test fails loudly if any scripts/ test file is claimed by ZERO lanes or by BOTH.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");

const TEST_DIRS = ["scripts/lib/__tests__", "scripts/soak/__tests__", "scripts/rails/__tests__"];

function discoverTestFiles() {
  const found = [];
  for (const dir of TEST_DIRS) {
    const abs = path.join(repoRoot, dir);
    if (!fs.existsSync(abs)) continue;
    for (const f of fs.readdirSync(abs)) {
      if (f.endsWith(".test.mjs")) found.push(`${dir}/${f}`);
    }
  }
  return found.sort();
}

function styleOf(relPath) {
  const src = fs.readFileSync(path.join(repoRoot, relPath), "utf-8");
  if (/from\s+"vitest"/.test(src)) return "vitest";
  if (/from\s+"node:test"/.test(src)) return "node:test";
  return "unknown";
}

// The two lane definitions, read from the REAL config/script rather than restated here — a
// guard that hardcodes its own copy of the thing it guards proves nothing.
function vitestLaneIncludes() {
  const cfg = fs.readFileSync(path.join(repoRoot, "ci/vitest.config.mjs"), "utf-8");
  return [...cfg.matchAll(/"(scripts\/[^"]+\.test\.mjs)"/g)].map((m) => m[1]);
}

function nodeLaneSpec() {
  const pkg = require(path.join(repoRoot, "package.json"));
  const script = pkg.scripts["test:scripts"];
  assert.ok(script, "package.json must define a test:scripts node:test lane");
  return script;
}

function nodeLaneClaims(relPath, script) {
  if (script.includes(relPath)) return true;                        // explicit file
  const dir = path.posix.dirname(relPath);
  return script.includes(`${dir}/*.test.mjs`);                      // directory glob
}

test("every scripts/ test file is discovered", () => {
  const files = discoverTestFiles();
  assert.ok(files.length >= 10, `expected the known estate, found ${files.length}`);
});

test("no scripts/ test file runs in ZERO lanes", () => {
  const script = nodeLaneSpec();
  const vitestFiles = vitestLaneIncludes();
  const orphans = discoverTestFiles().filter(
    (f) => !vitestFiles.includes(f) && !nodeLaneClaims(f, script),
  );
  assert.deepEqual(orphans, [], `these test files run in NO lane (the 2026-07-19 class): ${orphans.join(", ")}`);
});

test("no scripts/ test file runs in BOTH lanes", () => {
  const script = nodeLaneSpec();
  const vitestFiles = vitestLaneIncludes();
  const doubled = discoverTestFiles().filter(
    (f) => vitestFiles.includes(f) && nodeLaneClaims(f, script),
  );
  assert.deepEqual(doubled, [], `claimed by both runners: ${doubled.join(", ")}`);
});

test("each file is routed to the lane matching its import style", () => {
  const script = nodeLaneSpec();
  const vitestFiles = vitestLaneIncludes();
  const misrouted = [];
  for (const f of discoverTestFiles()) {
    const style = styleOf(f);
    if (style === "vitest" && !vitestFiles.includes(f)) misrouted.push(`${f} (vitest-style, not in vitest lane)`);
    if (style === "node:test" && !nodeLaneClaims(f, script)) misrouted.push(`${f} (node:test-style, not in node lane)`);
    if (style === "unknown") misrouted.push(`${f} (imports neither runner)`);
  }
  assert.deepEqual(misrouted, [], `misrouted test files: ${misrouted.join(" | ")}`);
});
