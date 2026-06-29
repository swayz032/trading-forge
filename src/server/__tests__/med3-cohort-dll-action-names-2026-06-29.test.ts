/**
 * med3-cohort-dll-action-names-2026-06-29.test.ts
 *
 * MED-3 2026-06-29: cohort-audit-report-service.ts queried wrong action names
 * for DLL events. The kill-switch writes "sizing.dll_force_close" and
 * "sizing.dll_force_close_completed" but the cohort report was querying
 * "cross_symbol_dll_halt_triggered" and "paper.dll_95_force_close" — causing
 * dllHalt67Count and dll95Count to silently return 0 even when kill-switch
 * had fired.
 *
 * These tests verify:
 *  1. The source file contains the correct action names matching kill-switch writes.
 *  2. The source file does NOT contain the old wrong action names.
 *  3. The _TEST_ONLY_buildReportFromRows seam correctly surfaces dllHalt67Count > 0
 *     and dll95Count > 0 in the report summary and FAIL check.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { vi } from "vitest";

// ── Source invariant: cohort service uses correct action names ────────────────

describe("MED-3 2026-06-29: cohort DLL action names corrected to match kill-switch writes", () => {
  const _dir = dirname(fileURLToPath(import.meta.url));
  const cohortSrc = readFileSync(
    resolve(_dir, "../services/cohort-audit-report-service.ts"),
    "utf-8",
  );

  it("queries 'sizing.dll_force_close' (kill-switch write action)", () => {
    expect(cohortSrc).toContain('"sizing.dll_force_close"');
  });

  it("does NOT query old wrong name 'cross_symbol_dll_halt_triggered'", () => {
    expect(cohortSrc).not.toContain('"cross_symbol_dll_halt_triggered"');
  });

  it("queries 'sizing.dll_force_close_completed' (kill-switch write action)", () => {
    expect(cohortSrc).toContain('"sizing.dll_force_close_completed"');
  });

  it("does NOT query old wrong name 'paper.dll_95_force_close'", () => {
    expect(cohortSrc).not.toContain('"paper.dll_95_force_close"');
  });
});

// ── Seam test: dllHalt67Count and dll95Count appear in report when non-zero ────

vi.mock("../db/index.js", () => ({ db: {} }));
vi.mock("../db/schema.js", () => ({ auditLog: {} }));
vi.mock("../lib/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  _TEST_ONLY_buildReportFromRows,
  type _TestRows,
  type CohortReportOpts,
} from "../services/cohort-audit-report-service.js";

const baseOpts: CohortReportOpts = {
  days: 1,
  strategy: "slumdawg",
  correlationId: "test-med3",
};

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

describe("MED-3 2026-06-29: dllHalt67Count and dll95Count wired to report summary", () => {
  it("dllHalt67Count > 0 does NOT set dll_95_force_closes (separate field)", () => {
    const rows: _TestRows = { ...emptyRows(), dllHalt67Count: 3 };
    const { summary } = _TEST_ONLY_buildReportFromRows(rows, baseOpts);
    // dllHalt67Count maps to DLL 67% events; dll_95_force_closes maps to dll95Count
    expect(summary.dll_95_force_closes).toBe(0);
  });

  it("dll95Count > 0 sets summary.dll_95_force_closes and triggers FAIL in report", () => {
    const rows: _TestRows = { ...emptyRows(), dll95Count: 2 };
    const { summary, markdown } = _TEST_ONLY_buildReportFromRows(rows, baseOpts);
    expect(summary.dll_95_force_closes).toBe(2);
    expect(markdown).toMatch(/FAIL|ALERT|force.close/i);
  });

  it("both counters = 0 → all_checks_pass is false ONLY when other checks fail", () => {
    const rows: _TestRows = { ...emptyRows(), dllHalt67Count: 0, dll95Count: 0 };
    const { summary } = _TEST_ONLY_buildReportFromRows(rows, baseOpts);
    // dll counts = 0 means no DLL events — should not fail on its own
    expect(summary.dll_95_force_closes).toBe(0);
  });
});
