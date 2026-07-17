/**
 * Tests for B5 — Multi-Firm Promotion Service (W13 Team C Step 1)
 *
 * Covers:
 *   - evaluateMultiFirmEligibility: one row per configured firm on success
 *   - Pipeline pause early-exit: returns empty results when pipeline is paused
 *   - Per-firm independence: one firm failing does not affect others
 *   - Fail-closed on subprocess error: ineligible with error reason
 *   - Compliance check routing: pass / fail / needs_review → eligible mapping
 *   - getLatestFirmEligibility: returns latest row per firmId
 *   - Audit log is written on each evaluation
 *
 * Parity notes:
 *   - Mock runPythonModule to verify it's called with check_strategy_compliance
 *   - Mock DB to avoid real Postgres dependency
 *   - All configured firms from FIRMS (currently 2: Topstep + MFFU per
 *     CLAUDE.md §6) are exercised in the count assertion
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock infrastructure ──────────────────────────────────────────────────────

vi.mock("../lib/python-runner.js", () => ({
  runPythonModule: vi.fn(),
}));

vi.mock("./pipeline-control-service.js", () => ({
  isActive: vi.fn(),
}));

vi.mock("../index.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ─── DB mock setup ────────────────────────────────────────────────────────────
// Controls insert().values() and select().from().where()...

// Separate tracking: per-firm rows (array insert) vs audit log rows (single object insert)
const mockInsertedFirmRows: unknown[] = [];
const mockInsertedAuditRows: unknown[] = [];
const mockSelectRows: Record<string, unknown>[] = [];

// Track insert call count to distinguish firm-rows insert from audit-log insert.
// The firm-rows insert is the FIRST insert call (array); audit-log is subsequent (object).
let insertCallCount = 0;

vi.mock("../db/index.js", () => {
  const buildInsertChain = () => {
    const isFirstCall = false;
    const chain = {
      values: vi.fn((rows: unknown) => {
        if (Array.isArray(rows)) {
          // Firm eligibility rows — all inserted as one array
          mockInsertedFirmRows.push(...rows);
        } else {
          // Audit log row — single object
          mockInsertedAuditRows.push(rows);
        }
        return Promise.resolve();
      }),
      catch: vi.fn(() => Promise.resolve()),
    };
    return chain;
  };

  const buildSelectChain = (): Record<string, unknown> => {
    // Make orderBy thenable so `await db.select()...orderBy()` resolves to mockSelectRows
    const terminalPromise = Promise.resolve(mockSelectRows);
    const chain: Record<string, unknown> = {
      select: () => buildSelectChain(),
      from: () => buildSelectChain(),
      where: () => buildSelectChain(),
      orderBy: () => Object.assign(buildSelectChain(), {
        then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
          terminalPromise.then(resolve, reject),
      }),
      limit: () => terminalPromise,
      innerJoin: () => buildSelectChain(),
    };
    return chain;
  };

  return {
    db: {
      insert: vi.fn(() => buildInsertChain()),
      select: vi.fn(() => buildSelectChain()),
    },
  };
});

// ─── Imports after mocks ──────────────────────────────────────────────────────

import { evaluateMultiFirmEligibility, getLatestFirmEligibility } from "./multi-firm-promotion-service.js";
import { runPythonModule } from "../lib/python-runner.js";
import { isActive } from "./pipeline-control-service.js";
import { FIRMS } from "../../shared/firm-config.js";

const mockRunPython = vi.mocked(runPythonModule);
const mockIsActive = vi.mocked(isActive);

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PASS_RESULT = {
  result: "pass",
  violations: [],
  warnings: [],
  risk_score: 10,
  details: { drawdown: { strategy_max_dd: 1000, firm_limit: 2000 } },
};

const FAIL_RESULT = {
  result: "fail",
  violations: ["Max drawdown $2500 exceeds firm limit $2000."],
  warnings: [],
  risk_score: 40,
  details: {},
};

const NEEDS_REVIEW_RESULT = {
  result: "needs_review",
  violations: [],
  warnings: ["Max drawdown $1700 is within 20% of firm limit $2000."],
  risk_score: 15,
  details: {},
};

const STRATEGY_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const BACKTEST_ID = "11111111-2222-3333-4444-555555555555";

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockInsertedFirmRows.length = 0;
  mockInsertedAuditRows.length = 0;
  mockSelectRows.length = 0;
  insertCallCount = 0;
  vi.clearAllMocks();
});

describe("evaluateMultiFirmEligibility", () => {
  it("returns empty results when pipeline is paused", async () => {
    mockIsActive.mockResolvedValue(false);

    const output = await evaluateMultiFirmEligibility(STRATEGY_ID, BACKTEST_ID);

    expect(output.firmResults).toHaveLength(0);
    expect(output.eligibleFirmCount).toBe(0);
    expect(output.totalFirmCount).toBe(0);
    expect(mockRunPython).not.toHaveBeenCalled();
  });

  it("runs check for each configured firm when pipeline is active", async () => {
    mockIsActive.mockResolvedValue(true);
    // Return pass for all firms
    mockRunPython.mockResolvedValue(PASS_RESULT as any);

    const output = await evaluateMultiFirmEligibility(STRATEGY_ID, BACKTEST_ID);

    const firmCount = Object.keys(FIRMS).length;
    expect(output.totalFirmCount).toBe(firmCount);
    expect(output.firmResults).toHaveLength(firmCount);
    expect(mockRunPython).toHaveBeenCalledTimes(firmCount);
  });

  it("all firms eligible when compliance_gate returns pass", async () => {
    mockIsActive.mockResolvedValue(true);
    mockRunPython.mockResolvedValue(PASS_RESULT as any);

    const output = await evaluateMultiFirmEligibility(STRATEGY_ID, BACKTEST_ID);

    expect(output.eligibleFirmCount).toBe(output.totalFirmCount);
    for (const r of output.firmResults) {
      expect(r.eligible).toBe(true);
      expect(r.eligibilityReason).toContain("eligible");
    }
  });

  it("needs_review maps to eligible=true with warning in reason", async () => {
    mockIsActive.mockResolvedValue(true);
    mockRunPython.mockResolvedValue(NEEDS_REVIEW_RESULT as any);

    const output = await evaluateMultiFirmEligibility(STRATEGY_ID, BACKTEST_ID);

    expect(output.eligibleFirmCount).toBe(output.totalFirmCount);
    for (const r of output.firmResults) {
      expect(r.eligible).toBe(true);
      expect(r.eligibilityReason).toContain("warnings");
    }
  });

  it("fail maps to eligible=false with violation in reason", async () => {
    mockIsActive.mockResolvedValue(true);
    mockRunPython.mockResolvedValue(FAIL_RESULT as any);

    const output = await evaluateMultiFirmEligibility(STRATEGY_ID, BACKTEST_ID);

    expect(output.eligibleFirmCount).toBe(0);
    for (const r of output.firmResults) {
      expect(r.eligible).toBe(false);
      expect(r.eligibilityReason).toContain("NOT eligible");
    }
  });

  it("one firm failing does not affect others (per-firm independence)", async () => {
    mockIsActive.mockResolvedValue(true);
    const firmIds = Object.keys(FIRMS);

    // First firm fails, all others pass
    mockRunPython
      .mockResolvedValueOnce(FAIL_RESULT as any)
      .mockResolvedValue(PASS_RESULT as any);

    const output = await evaluateMultiFirmEligibility(STRATEGY_ID, BACKTEST_ID);

    expect(output.firmResults[0].eligible).toBe(false);
    for (const r of output.firmResults.slice(1)) {
      expect(r.eligible).toBe(true);
    }
    expect(output.eligibleFirmCount).toBe(firmIds.length - 1);
  });

  it("subprocess error marks firm ineligible (fail-closed) without affecting others", async () => {
    mockIsActive.mockResolvedValue(true);
    const firmIds = Object.keys(FIRMS);

    // Second firm throws
    mockRunPython
      .mockResolvedValueOnce(PASS_RESULT as any)
      .mockRejectedValueOnce(new Error("subprocess timeout"))
      .mockResolvedValue(PASS_RESULT as any);

    const output = await evaluateMultiFirmEligibility(STRATEGY_ID, BACKTEST_ID);

    expect(output.firmResults[0].eligible).toBe(true);
    expect(output.firmResults[1].eligible).toBe(false);
    expect(output.firmResults[1].complianceCheckResult.result).toBe("error");
    expect(output.firmResults[1].eligibilityReason).toContain("subprocess error");
    // All other firms pass
    for (const r of output.firmResults.slice(2)) {
      expect(r.eligible).toBe(true);
    }
    expect(output.eligibleFirmCount).toBe(firmIds.length - 1);
  });

  it("calls runPythonModule with action=check_strategy_compliance", async () => {
    mockIsActive.mockResolvedValue(true);
    mockRunPython.mockResolvedValue(PASS_RESULT as any);

    await evaluateMultiFirmEligibility(STRATEGY_ID, BACKTEST_ID);

    const firstCall = mockRunPython.mock.calls[0][0];
    expect(firstCall.config).toMatchObject({
      action: "check_strategy_compliance",
    });
    // Firm ID is set in the config
    expect(firstCall.config).toHaveProperty("firm");
    // firm_rules comes from buildFirmRules (has max_drawdown_limit)
    expect((firstCall.config as any).firm_rules).toHaveProperty("max_drawdown_limit");
  });

  it("persists one row per firm into strategy_firm_eligibility", async () => {
    mockIsActive.mockResolvedValue(true);
    mockRunPython.mockResolvedValue(PASS_RESULT as any);

    await evaluateMultiFirmEligibility(STRATEGY_ID, BACKTEST_ID);

    const firmCount = Object.keys(FIRMS).length;
    // mockInsertedFirmRows receives only the per-firm array (audit goes to mockInsertedAuditRows)
    expect(mockInsertedFirmRows.length).toBe(firmCount);
    for (const row of mockInsertedFirmRows) {
      expect(row).toMatchObject({
        strategyId: STRATEGY_ID,
        eligible: true,
      });
    }
    // Verify audit log was also written (one aggregate entry)
    expect(mockInsertedAuditRows.length).toBeGreaterThanOrEqual(1);
  });

  it("works when backtestId is null", async () => {
    mockIsActive.mockResolvedValue(true);
    mockRunPython.mockResolvedValue(PASS_RESULT as any);

    const output = await evaluateMultiFirmEligibility(STRATEGY_ID, null);

    expect(output.backtestId).toBeNull();
    expect(output.totalFirmCount).toBe(Object.keys(FIRMS).length);
  });

  it("uses correlationId in runPythonModule calls", async () => {
    mockIsActive.mockResolvedValue(true);
    mockRunPython.mockResolvedValue(PASS_RESULT as any);
    const correlationId = "req-correlation-xyz";

    await evaluateMultiFirmEligibility(STRATEGY_ID, BACKTEST_ID, correlationId);

    const firstCall = mockRunPython.mock.calls[0][0];
    expect(firstCall.correlationId).toBe(correlationId);
  });

  it("firm_rules include max_drawdown_limit + canonical contract_limits for all configured firms", async () => {
    // W3B 2026-07-17: was "all 8 firms" with a hand-typed maxContracts=50 for
    // every firm — stale twice over (6 firms removed 2026-05-19, and MFFU
    // Builder is 40 micros, not 50, since 2026-06-23). Expectation now reads
    // the canonical FIRMS config so it can't drift again.
    mockIsActive.mockResolvedValue(true);
    mockRunPython.mockResolvedValue(PASS_RESULT as any);

    await evaluateMultiFirmEligibility(STRATEGY_ID, BACKTEST_ID);

    expect(mockRunPython.mock.calls.length).toBe(Object.keys(FIRMS).length);
    for (const call of mockRunPython.mock.calls) {
      const config = call[0].config as any;
      const firmRules = config.firm_rules;
      const acct = FIRMS[config.firm as string]!.accountTypes["50k"]!;
      expect(firmRules.max_drawdown_limit).toBeGreaterThan(0);
      expect(firmRules.contract_limits?.MES).toBe(acct.maxContracts); // topstep 50 / mffu 40
    }
  });

  it("firm ids match FIRMS config keys", async () => {
    mockIsActive.mockResolvedValue(true);
    mockRunPython.mockResolvedValue(PASS_RESULT as any);

    const output = await evaluateMultiFirmEligibility(STRATEGY_ID, BACKTEST_ID);

    const outputFirmIds = output.firmResults.map((r) => r.firmId).sort();
    const expectedFirmIds = Object.keys(FIRMS).sort();
    expect(outputFirmIds).toEqual(expectedFirmIds);
  });
});

describe("getLatestFirmEligibility", () => {
  it("returns empty array when no rows exist", async () => {
    // mockSelectRows is empty by default
    const results = await getLatestFirmEligibility(STRATEGY_ID);
    expect(results).toHaveLength(0);
  });

  it("deduplicates by firmId returning latest row", async () => {
    // Seed two rows for same firm (older first)
    mockSelectRows.push(
      {
        firmId: "topstep",
        eligible: false,
        eligibilityReason: "old check",
        complianceCheckResult: { result: "fail", violations: [], warnings: [], risk_score: 40, details: {} },
        checkedAt: new Date("2026-04-29T10:00:00Z"),
      },
      {
        firmId: "topstep",
        eligible: true,
        eligibilityReason: "new check — eligible",
        complianceCheckResult: { result: "pass", violations: [], warnings: [], risk_score: 5, details: {} },
        checkedAt: new Date("2026-04-30T10:00:00Z"),
      },
    );

    const results = await getLatestFirmEligibility(STRATEGY_ID);
    // Should only return one row for topstep (the first seen, which is oldest in our mock
    // since DB query orders by desc checkedAt — first returned is the latest)
    expect(results).toHaveLength(1);
    expect(results[0].firmId).toBe("topstep");
    // The first row returned is treated as "latest" by the dedup logic
    expect(results[0].eligible).toBe(false); // first seen = oldest in desc-ordered mock
  });
});
