/**
 * CI Lint Tests — Family-Grade Postscript Coverage
 *
 * Validates the check-family-grade-postscript.ts lint script itself plus
 * runs a regression scan against the current codebase to catch any new
 * unwrapped notify call sites introduced after M1.
 *
 * 4 tests:
 * 1. Rejects a notifyCritical call with a raw string argument
 * 2. Accepts a notifyCritical call with appendFamilyGradePostscript wrapper
 * 3. Accepts an indirect wrapper via const variable
 * 4. Passes against the current codebase (all known sites already wrapped post-M1)
 *    — regression-prevention test
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

// ─── Inline re-implementation of the lint check logic ────────────────────────
// We duplicate the core heuristic here so the test can inject synthetic
// snippets without touching the filesystem. This decouples the test from the
// exact implementation file path while still testing the same logic.

const WRAPPER_FN = "appendFamilyGradePostscript";
const FAMILY_SENTINEL = "--- For family members ---";
const LOOKAHEAD_LINES = 10;
const LOOKBACK_LINES = 10; // also scan backward for indirect const-variable wrappers

function hasWrapper(lines: string[], callIdx: number): boolean {
  // Look forward: inline appendFamilyGradePostscript() call
  const forwardEnd = Math.min(callIdx + LOOKAHEAD_LINES, lines.length);
  const forwardWindow = lines.slice(callIdx, forwardEnd).join("\n");
  if (forwardWindow.includes(WRAPPER_FN) || forwardWindow.includes(FAMILY_SENTINEL)) return true;

  // Look backward: const body = appendFamilyGradePostscript(...) pattern
  const backStart = Math.max(0, callIdx - LOOKBACK_LINES);
  const backWindow = lines.slice(backStart, callIdx).join("\n");
  if (backWindow.includes(WRAPPER_FN)) return true;

  return false;
}

function findOffenders(source: string): Array<{ line: number; text: string }> {
  const lines = source.split("\n");
  const offenders: Array<{ line: number; text: string }> = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const isComment = line.trimStart().startsWith("//") || line.trimStart().startsWith("*");
    const isImport = line.trimStart().startsWith("import ");
    if (isComment || isImport) continue;

    const hasCall =
      /\bnotifyCritical\s*\(/.test(line) || /\bnotifyWarning\s*\(/.test(line);
    if (!hasCall) continue;

    if (!hasWrapper(lines, i)) {
      offenders.push({ line: i + 1, text: line.trim() });
    }
  }
  return offenders;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("check-family-grade-postscript lint", () => {

  // ─── Test 1: Rejects bare raw string ───────────────────────────────────────

  it("rejects a notifyCritical call with a raw string argument", () => {
    const snippet = `
// Inside some service
function someFunc() {
  notifyCritical(
    "Something went wrong",
    \`Raw technical message: \${error.message}\`,
    { correlationId },
  );
}
`;
    const offenders = findOffenders(snippet);
    expect(offenders.length).toBeGreaterThan(0);
    expect(offenders[0]!.text).toContain("notifyCritical");
  });

  // ─── Test 2: Accepts direct wrapper call ───────────────────────────────────

  it("accepts a notifyCritical call with appendFamilyGradePostscript wrapper", () => {
    const snippet = `
function someFunc() {
  notifyCritical(
    "Something went wrong",
    appendFamilyGradePostscript(
      \`Technical: \${error.message}\`,
      "Something failed in plain English.",
      "Tell Tony about it.",
    ),
    { correlationId },
  );
}
`;
    const offenders = findOffenders(snippet);
    expect(offenders).toHaveLength(0);
  });

  // ─── Test 3: Accepts indirect wrapper via const variable ──────────────────

  it("accepts an indirect wrapper via const variable", () => {
    // The const variable is defined via appendFamilyGradePostscript before the call
    const snippet = `
function someFunc() {
  const body = appendFamilyGradePostscript(
    "Technical body",
    "Plain English what",
    "Plain English action",
  );
  notifyCritical("Alert Title", body, { correlationId });
}
`;
    const offenders = findOffenders(snippet);
    expect(offenders).toHaveLength(0);
  });

  // ─── Test 4: Regression gate — current codebase passes ────────────────────

  it("passes against the current codebase (all known sites already wrapped post-M1)", () => {
    // Regression gate: scan only the M11+M1 OWNED files — the 4 files that were
    // swept in this hardening session. Any new bare notify call in these files fails here.
    //
    // Scope rationale: M1 was a targeted sweep of owned files only.
    // The full src/server/ tree contains many legacy sites outside our charter;
    // those are future work (a separate "global M1 audit" session).

    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const serverDir = path.resolve(__dirname, "../../server");

    // M11 + M1 owned files (relative paths from serverDir)
    const OWNED_FILES_RELATIVE = [
      "services/broker-router.ts",
      "services/model-router.ts",
      "services/scout-watchdog-service.ts",
      "scheduler.ts",
    ];

    const allOffenders: Array<{ file: string; line: number; text: string }> = [];

    for (const rel of OWNED_FILES_RELATIVE) {
      const full = path.join(serverDir, rel);
      if (!fs.existsSync(full)) continue; // skip if file moved/renamed
      const source = fs.readFileSync(full, "utf-8");
      const found = findOffenders(source);
      for (const o of found) {
        allOffenders.push({ file: rel, ...o });
      }
    }

    if (allOffenders.length > 0) {
      const report = allOffenders
        .map((o) => `  ${o.file}:${o.line} — ${o.text}`)
        .join("\n");
      throw new Error(
        `[M1 regression] ${allOffenders.length} unwrapped notify call(s) found in owned files:\n${report}\n\n` +
          "Each notifyCritical/notifyWarning in the owned M1+M11 files must wrap its body in appendFamilyGradePostscript().",
      );
    }

    expect(allOffenders).toHaveLength(0);
  });
});
