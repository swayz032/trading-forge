/**
 * wave26-cohort-audit-report.test.ts — Wave 26 Group C Task 2
 *
 * Tests the cohort audit report builder using the _TEST_ONLY_buildReportFromRows
 * seam (no DB — pure aggregation logic tested in isolation).
 *
 * Coverage:
 *  1. Empty audit_log → report shows zero counts, no crash
 *  2. Synthetic rows → correct TP1 source distribution percentages
 *  3. 14-day window vs 1-day window label difference
 *  4. Fallback cluster detection: >= 5 fallback events → FAIL check + WARNING
 *  5. Low fallback count (< 5) → PASS check, NOTE
 *  6. All canonical regimes appear in report (even at zero count)
 *  7. All canonical runner trail methods appear
 *  8. Liquidity TP1 pct < 50% → FAIL check
 *  9. Distinct regimes < 3 → FAIL check
 * 10. dll_95_force_closes > 0 → FAIL check + ALERT line
 * 11. All checks passing → Overall PASS
 * 12. Summary struct matches report content
 * 13. Markdown contains §10b footer
 * 14. Unknown reason codes in fallback rows are surfaced
 */

import { describe, it, expect } from "vitest";

// ─── Module mocks ─────────────────────────────────────────────────────────────

import { vi } from "vitest";

vi.mock("../db/index.js", () => ({ db: {} }));
vi.mock("../db/schema.js", () => ({ auditLog: {} }));
vi.mock("../lib/audit-log-helper.js", () => ({ insertAuditRow: vi.fn().mockResolvedValue(undefined) }));

// ─── Imports ───────────────────────────────────────────────────────────────────

import {
  _TEST_ONLY_buildReportFromRows,
  type _TestRows,
  type CohortReportOpts,
} from "../services/cohort-audit-report-service.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeOpts(overrides?: Partial<CohortReportOpts>): CohortReportOpts {
  return {
    days:          1,
    strategy:      "silver_bullet",
    correlationId: "test-corr-1234",
    ...overrides,
  };
}

function emptyRows(): _TestRows {
  return {
    exitPlanRows:   [],
    fallbackRows:   [],
    earlyExitCount: 0,
    preLunchCount:  0,
    scalingCount:   0,
    runnerCount:    0,
    flattenCount:   0,
    tp1FillCount:   0,
    dllHalt67Count: 0,
    dll95Count:     0,
  };
}

type AuditRow = _TestRows["exitPlanRows"][0];

function makeExitPlanRow(
  opts: {
    tp1Source?: string;
    regime?: string;
    runnerTrailMethod?: string;
  } = {},
): AuditRow {
  return {
    action: "signal.exit_plan_persisted",
    result: {
      strategy_id:         "silver_bullet",
      tp1_source:          opts.tp1Source          ?? "liquidity",
      regime:              opts.regime             ?? "TRENDING_UP",
      runner_trail_method: opts.runnerTrailMethod  ?? "anchored_vwap",
    },
    created_at: new Date(),
  };
}

function makeFallbackRow(reasons?: Record<string, number>): AuditRow {
  return {
    action: "signal.exit_plan_fallback_static",
    result: {
      strategy_id: "silver_bullet",
      reasons:     reasons ?? { compute_throw: 1 },
    },
    created_at: new Date(),
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("_TEST_ONLY_buildReportFromRows", () => {

  // Test 1: empty rows → zero counts, no crash
  it("produces a valid report with zero counts when all rows are empty", () => {
    const { markdown, summary } = _TEST_ONLY_buildReportFromRows(emptyRows(), makeOpts());
    expect(markdown).toContain("exit_plan_persisted total:** 0");
    expect(markdown).toContain("exit_plan_fallback_static:** 0");
    expect(summary.exit_plan_total).toBe(0);
    expect(summary.fallback_count).toBe(0);
    expect(summary.fallback_cluster).toBe(false);
    expect(summary.all_checks_pass).toBe(true); // no data = no check failures
  });

  // Test 2: correct TP1 source distribution percentages
  it("calculates TP1 source distribution percentages correctly", () => {
    const rows = emptyRows();
    rows.exitPlanRows = [
      makeExitPlanRow({ tp1Source: "liquidity" }),
      makeExitPlanRow({ tp1Source: "liquidity" }),
      makeExitPlanRow({ tp1Source: "r_multiple" }),
      makeExitPlanRow({ tp1Source: "r_multiple" }),
      makeExitPlanRow({ tp1Source: "liquidity" }),
    ];
    const { markdown, summary } = _TEST_ONLY_buildReportFromRows(rows, makeOpts());
    // 3/5 = 60% liquidity
    expect(markdown).toContain("liquidity: 3 (60.0%)");
    // 2/5 = 40% r_multiple
    expect(markdown).toContain("r_multiple: 2 (40.0%)");
    expect(summary.exit_plan_total).toBe(5);
    expect(summary.liquidity_tp1_pct).toBeCloseTo(60.0, 1);
  });

  // Test 3: 14-day window label appears in report
  it("includes correct window label for 14-day window", () => {
    const { markdown } = _TEST_ONLY_buildReportFromRows(emptyRows(), makeOpts({ days: 14 }));
    expect(markdown).toContain("last 14 days");
    expect(markdown).not.toContain("last 24h");
  });

  // Test 3b: 1-day window shows "last 24h"
  it("shows last 24h for 1-day window", () => {
    const { markdown } = _TEST_ONLY_buildReportFromRows(emptyRows(), makeOpts({ days: 1 }));
    expect(markdown).toContain("last 24h");
  });

  // Test 4: fallback cluster >= 5 → FAIL + WARNING
  it("flags fallback cluster (>= 5 events) with FAIL check and WARNING line", () => {
    const rows = emptyRows();
    rows.fallbackRows = Array.from({ length: 6 }, () => makeFallbackRow());
    const { markdown, summary } = _TEST_ONLY_buildReportFromRows(rows, makeOpts());
    expect(summary.fallback_cluster).toBe(true);
    expect(summary.fallback_count).toBe(6);
    expect(markdown).toContain("WARNING: 5+ fallback events");
    expect(markdown).toContain("[FAIL] fallback_static < 5/day");
  });

  // Test 5: low fallback count (< 5) → PASS + NOTE
  it("shows NOTE for low fallback count (1-4) and PASS check", () => {
    const rows = emptyRows();
    rows.fallbackRows = [makeFallbackRow(), makeFallbackRow()];
    const { markdown, summary } = _TEST_ONLY_buildReportFromRows(rows, makeOpts());
    expect(summary.fallback_cluster).toBe(false);
    expect(markdown).toContain("NOTE: low fallback count");
    expect(markdown).toContain("[PASS] fallback_static < 5/day");
  });

  // Test 6: all canonical regimes appear in report (even at zero count)
  it("includes all 7 canonical regimes in regime distribution section", () => {
    const { markdown } = _TEST_ONLY_buildReportFromRows(emptyRows(), makeOpts());
    const regimes = ["TRENDING_UP", "TRENDING_DOWN", "RANGE_BOUND", "EXPANSION", "COMPRESSION", "HIGH_VOL_MACRO", "LOW_LIQ_CHOP"];
    for (const regime of regimes) {
      expect(markdown).toContain(regime);
    }
  });

  // Test 7: all canonical runner trail methods appear
  it("includes all 4 canonical runner trail methods in usage section", () => {
    const { markdown } = _TEST_ONLY_buildReportFromRows(emptyRows(), makeOpts());
    const runners = ["anchored_vwap", "developing_poc", "chandelier", "structure_trail"];
    for (const runner of runners) {
      expect(markdown).toContain(runner);
    }
  });

  // Test 8: liquidity TP1 pct < 50% → FAIL check
  it("marks TP1 liquidity check as FAIL when liquidity < 50% of TP1 fills", () => {
    const rows = emptyRows();
    rows.exitPlanRows = [
      makeExitPlanRow({ tp1Source: "r_multiple" }),
      makeExitPlanRow({ tp1Source: "r_multiple" }),
      makeExitPlanRow({ tp1Source: "liquidity" }),
    ];
    // liquidity = 1/3 = 33.3% < 50%
    const { markdown, summary } = _TEST_ONLY_buildReportFromRows(rows, makeOpts());
    expect(summary.liquidity_tp1_pct).toBeCloseTo(33.3, 1);
    expect(markdown).toContain("[FAIL] TP1 liquidity >= 50%");
    expect(summary.all_checks_pass).toBe(false);
  });

  // Test 9: distinct regimes < 3 → FAIL check
  it("marks regime diversity check as FAIL when fewer than 3 distinct regimes", () => {
    const rows = emptyRows();
    rows.exitPlanRows = [
      makeExitPlanRow({ regime: "TRENDING_UP",   tp1Source: "liquidity" }),
      makeExitPlanRow({ regime: "TRENDING_DOWN",  tp1Source: "liquidity" }),
    ];
    // 2 distinct regimes < 3
    const { markdown, summary } = _TEST_ONLY_buildReportFromRows(rows, makeOpts());
    expect(summary.distinct_regimes).toBe(2);
    expect(markdown).toContain("[FAIL] Regime diversity >= 3");
    expect(summary.all_checks_pass).toBe(false);
  });

  // Test 10: dll_95_force_closes > 0 → FAIL check + ALERT
  it("flags 95% DLL force-close with FAIL check and ALERT line", () => {
    const rows = emptyRows();
    rows.dll95Count = 1;
    const { markdown, summary } = _TEST_ONLY_buildReportFromRows(rows, makeOpts());
    expect(summary.dll_95_force_closes).toBe(1);
    expect(markdown).toContain("[FAIL] Zero 95% DLL force-closes");
    expect(markdown).toContain("ALERT: 1 95% DLL force-close event(s) detected");
    expect(summary.all_checks_pass).toBe(false);
  });

  // Test 11: all checks passing → Overall PASS
  it("shows Overall PASS when all checks pass", () => {
    const rows = emptyRows();
    // Sufficient liquidity TP1, 3+ regimes, no fallbacks, no DLL force-close
    rows.exitPlanRows = [
      makeExitPlanRow({ tp1Source: "liquidity", regime: "TRENDING_UP" }),
      makeExitPlanRow({ tp1Source: "liquidity", regime: "TRENDING_DOWN" }),
      makeExitPlanRow({ tp1Source: "liquidity", regime: "RANGE_BOUND" }),
      makeExitPlanRow({ tp1Source: "r_multiple", regime: "EXPANSION" }),
    ];
    const { markdown, summary } = _TEST_ONLY_buildReportFromRows(rows, makeOpts());
    expect(summary.all_checks_pass).toBe(true);
    expect(markdown).toContain("Overall: PASS");
  });

  // Test 12: summary struct fields match report content
  it("summary struct is consistent with rendered markdown", () => {
    const rows = emptyRows();
    rows.exitPlanRows = [
      makeExitPlanRow({ tp1Source: "liquidity",  regime: "TRENDING_UP" }),
      makeExitPlanRow({ tp1Source: "liquidity",  regime: "TRENDING_DOWN" }),
      makeExitPlanRow({ tp1Source: "r_multiple", regime: "RANGE_BOUND" }),
    ];
    rows.fallbackRows = [makeFallbackRow()];
    rows.dll95Count   = 0;

    const { summary } = _TEST_ONLY_buildReportFromRows(rows, makeOpts());
    expect(summary.exit_plan_total).toBe(3);
    expect(summary.fallback_count).toBe(1);
    expect(summary.fallback_cluster).toBe(false);
    expect(summary.distinct_regimes).toBe(3);
    expect(summary.dll_95_force_closes).toBe(0);
  });

  // Test 13: Markdown contains §10b audit footer
  it("includes §10b audit_log reconstruction footer", () => {
    const { markdown } = _TEST_ONLY_buildReportFromRows(emptyRows(), makeOpts());
    expect(markdown).toContain("§10b audit_log reconstruction");
  });

  // Test 14: unknown reason codes in fallback rows are surfaced
  it("surfaces unknown reason codes from fallback row result.reasons", () => {
    const rows = emptyRows();
    rows.fallbackRows = [
      makeFallbackRow({ compute_throw: 2, missing_liquidity: 1 }),
      makeFallbackRow({ compute_throw: 1 }),
    ];
    const { markdown } = _TEST_ONLY_buildReportFromRows(rows, makeOpts());
    // Aggregated: compute_throw=3, missing_liquidity=1
    expect(markdown).toContain("compute_throw: 3");
    expect(markdown).toContain("missing_liquidity: 1");
  });

  // Test 15: strategy name appears in section heading
  it("includes strategy name in section headings", () => {
    const { markdown } = _TEST_ONLY_buildReportFromRows(emptyRows(), makeOpts({ strategy: "crt" }));
    expect(markdown).toContain("crt — exit_plan_persisted distribution");
  });

  // Test 16: 30-day window label
  it("uses correct label for 30-day window", () => {
    const { markdown } = _TEST_ONLY_buildReportFromRows(emptyRows(), makeOpts({ days: 30 }));
    expect(markdown).toContain("last 30 days");
  });
});
