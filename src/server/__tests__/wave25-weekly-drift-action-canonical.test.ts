/**
 * Wave 25 Pass 2 — R-3: Weekly drift HALT audit action canonical name tests.
 *
 * Verifies:
 * 1. weekly-drift-halt-service.ts writes action='drift.weekly_2sigma_halt' exactly
 *    (source-level assertion — the string is structurally present in the insertAuditRow call).
 * 2. grep across src/ finds zero NON-COMMENT occurrences of the wrong consumer
 *    name 'auto_halt.weekly_drift_2sigma' (i.e. no actual code queries the wrong string).
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// ─── Test 1: action name is exactly 'drift.weekly_2sigma_halt' ────────────────

describe("Wave 25 Pass 2 R-3 — Weekly drift action canonical name", () => {
  it("weekly-drift-halt-service.ts calls insertAuditRow with action='drift.weekly_2sigma_halt'", () => {
    const src = readFileSync(
      join(process.cwd(), "src/server/services/weekly-drift-halt-service.ts"),
      "utf-8",
    );

    // The insertAuditRow call must have action: "drift.weekly_2sigma_halt"
    // We check that the string appears in a non-comment context (inside an action: field).
    expect(src).toContain('action: "drift.weekly_2sigma_halt"');

    // Also confirm the insertAuditRow call site exists near it
    const auditSection = src.slice(
      src.indexOf('action: "drift.weekly_2sigma_halt"') - 200,
      src.indexOf('action: "drift.weekly_2sigma_halt"') + 200,
    );
    expect(auditSection).toContain("insertAuditRow");
  });
});

// ─── Test 2: zero NON-COMMENT occurrences of deprecated name in src/ ──────────

/**
 * Static file-scan test. Reads all .ts files under src/ and verifies that the
 * deprecated consumer name 'auto_halt.weekly_drift_2sigma' does not appear in
 * any non-comment, non-test-file line.
 *
 * Exclusion rules:
 * - Lines that are pure comments (starting with // or * after whitespace) are excluded.
 * - This test file itself is excluded (it necessarily references the string in assertions).
 * - The weekly-drift-halt-service.ts comment explaining the canonical name is excluded.
 *
 * This test catches the case where a dashboard query, reconciliation script, or
 * service starts filtering audit_log by the wrong action name.
 */

function walkFiles(dir: string, ext: string[]): string[] {
  const results: string[] = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== ".git") {
        results.push(...walkFiles(full, ext));
      } else if (entry.isFile() && ext.some((e) => entry.name.endsWith(e))) {
        results.push(full);
      }
    }
  } catch {
    // Non-traversable dir — skip
  }
  return results;
}

function isCommentLine(line: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed.startsWith("//") ||
    trimmed.startsWith("*") ||
    trimmed.startsWith("/*") ||
    trimmed.startsWith("#")
  );
}

describe("Wave 25 Pass 2 R-3 — No non-comment code uses the deprecated action name", () => {
  it("finds zero non-comment occurrences of 'auto_halt.weekly_drift_2sigma' across src/", () => {
    const srcRoot = join(process.cwd(), "src");
    const files = walkFiles(srcRoot, [".ts", ".js", ".mjs", ".cjs"]);

    const DEPRECATED_NAME = "auto_halt.weekly_drift_2sigma";
    // This test file canonically must reference the string — exclude it
    const THIS_FILE = join(process.cwd(), "src/server/__tests__/wave25-weekly-drift-action-canonical.test.ts");
    const violations: Array<{ file: string; lineNo: number; line: string }> = [];

    for (const file of files) {
      // Skip this test file (it necessarily references the string)
      if (file === THIS_FILE) continue;

      try {
        const content = readFileSync(file, "utf-8");
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (line.includes(DEPRECATED_NAME) && !isCommentLine(line)) {
            violations.push({ file, lineNo: i + 1, line: line.trim() });
          }
        }
      } catch {
        // Unreadable file — skip
      }
    }

    if (violations.length > 0) {
      const report = violations
        .map((v) => `  ${v.file}:${v.lineNo}: ${v.line}`)
        .join("\n");
      throw new Error(
        `Found ${violations.length} non-comment occurrence(s) of deprecated action name '${DEPRECATED_NAME}':\n${report}\n` +
          `Canonical name is 'drift.weekly_2sigma_halt'. Update all consumers.`,
      );
    }

    expect(violations).toHaveLength(0);
  });
});
