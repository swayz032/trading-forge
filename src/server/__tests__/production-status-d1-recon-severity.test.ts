/**
 * production-status-d1-recon-severity.test.ts
 *
 * Deep-scan D.1 regression: ProductionStatusPanel's "last clean reconciliation"
 * must NOT show GREEN off `mismatch_count = 0` alone.
 *
 * A reconciliation run with NO verifiable data (production_trades / traderspost_log
 * / tradovate_fills all empty) trivially has 0 mismatches, but the ds21 write path
 * persists it as severity='yellow' (degraded/unverifiable). buildLastCleanRecon —
 * the query GET /api/production/status (the operator's daily panel) polls — must
 * require the persisted authoritative severity='green', falling back to
 * mismatch-only ONLY for legacy pre-ds21 rows where severity IS NULL.
 *
 * Source-structural assertion (the query is a DB-coupled route path; the unit
 * mock's .where() ignores its argument, so the filter can only be verified against
 * the source — same convention as paper-signal-service-deepscan-findings.test.ts).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(
  resolve(__dirname, "../routes/production-status.ts"),
  "utf-8",
);

function buildLastCleanReconBody(): string {
  const start = SRC.indexOf("async function buildLastCleanRecon");
  expect(start).toBeGreaterThan(-1);
  const end = SRC.indexOf(".orderBy(", start);
  expect(end).toBeGreaterThan(start);
  return SRC.slice(start, end);
}

describe("deep-scan D.1 — last-clean-recon must gate on persisted severity, not mismatch alone", () => {
  it("requires severity = 'green' in the last-clean query", () => {
    expect(buildLastCleanReconBody()).toContain(
      'eq(dailyReconciliation.severity, "green")',
    );
  });

  it("falls back to legacy rows via isNull(severity)", () => {
    expect(buildLastCleanReconBody()).toContain(
      "isNull(dailyReconciliation.severity)",
    );
  });

  it("still requires mismatchCount = 0 (severity gate is additive, not a replacement)", () => {
    expect(buildLastCleanReconBody()).toContain(
      "eq(dailyReconciliation.mismatchCount, 0)",
    );
  });

  it("REGRESSION GUARD: mismatchCount=0 is not the sole clean-filter (severity is combined via and())", () => {
    const body = buildLastCleanReconBody();
    // the mismatch predicate must be wrapped in an and(...) alongside the severity gate,
    // never a bare `.where(eq(dailyReconciliation.mismatchCount, 0))`
    expect(body).not.toMatch(/\.where\(\s*eq\(dailyReconciliation\.mismatchCount,\s*0\)\s*\)/);
    expect(body).toContain("and(");
  });
});
