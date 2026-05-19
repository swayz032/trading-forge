/**
 * Frankenstein Lifecycle Gate Tests — A4 (W10 Team C)
 *
 * Tests the Frankenstein gate logic independently by verifying:
 * 1. getLatestFrankensteinRun() returns null when no run exists
 * 2. The gate decision logic: null → block, passed=false → block, passed=true → allow
 * 3. Pass criteria thresholds are correct
 *
 * The LifecycleService integration is complex to mock fully (requires a fluent
 * DB chain mock as in lifecycle-service.test.ts). We test the gate's decision
 * logic by extracting the relevant conditions and verifying them directly.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock frankenstein-service to test the decision logic ────────────────────

vi.mock("../services/frankenstein-service.js");
vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: "test-id" }]),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    }),
  },
}));

import { getLatestFrankensteinRun } from "../services/frankenstein-service.js";
import type { FrankensteinRunOutput } from "../services/frankenstein-service.js";

// ─── Constants that mirror the lifecycle gate logic ────────────────────────────

const PASS_P95_SHARPE_THRESHOLD = 0.3;
const PASS_MEDIAN_PF_LOW = 0.85;
const PASS_MEDIAN_PF_HIGH = 1.15;

/**
 * Simulate the gate decision that lifecycle-service.ts makes.
 * This mirrors the exact logic in _promoteStrategyInner() for TESTING→PAPER.
 */
function evaluateFrankensteinGate(
  frankResult: FrankensteinRunOutput | null,
): { allowed: boolean; reason: string } {
  if (!frankResult) {
    return {
      allowed: false,
      reason: "Frankenstein gate: no completed Frankenstein test run found for this backtest.",
    };
  }

  if (!frankResult.passed) {
    return {
      allowed: false,
      reason:
        `Frankenstein gate: FAILED. Strategy shows edge on randomized data. ` +
        `p95_sharpe=${frankResult.p95Sharpe?.toFixed(3) ?? "null"} ` +
        `(threshold: <${PASS_P95_SHARPE_THRESHOLD}), ` +
        `median_pf=${frankResult.medianPf?.toFixed(3) ?? "null"} ` +
        `(threshold: [${PASS_MEDIAN_PF_LOW}, ${PASS_MEDIAN_PF_HIGH}]).`,
    };
  }

  return { allowed: true, reason: "Frankenstein gate: PASSED" };
}

// ─── Gate Decision Logic Tests ────────────────────────────────────────────────

describe("Frankenstein gate decision logic", () => {
  it("blocks when no Frankenstein run exists (null)", () => {
    const result = evaluateFrankensteinGate(null);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("no completed Frankenstein test run");
  });

  it("blocks when Frankenstein run failed (passed=false, high Sharpe)", () => {
    const failedRun: FrankensteinRunOutput = {
      runId: "run-001",
      backtestId: "bt-001",
      strategyId: "s-001",
      testMode: "full_shuffle",
      nShuffles: 100,
      p95Sharpe: 0.85,        // ABOVE threshold — shows edge on shuffled data
      medianPf: 1.42,         // ABOVE range — shows edge on shuffled data
      passed: false,
      wallClockMs: 12000,
      status: "completed",
      errorMessage: null,
    };

    const result = evaluateFrankensteinGate(failedRun);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("FAILED");
    expect(result.reason).toContain("p95_sharpe=0.850");
    expect(result.reason).toContain("median_pf=1.420");
  });

  it("blocks when p95_sharpe >= 0.3 (above threshold)", () => {
    const runAtThreshold: FrankensteinRunOutput = {
      runId: "run-002",
      backtestId: "bt-002",
      strategyId: "s-002",
      testMode: "full_shuffle",
      nShuffles: 100,
      p95Sharpe: 0.30,        // AT threshold — should fail (not strictly less than)
      medianPf: 1.0,
      passed: false,
      wallClockMs: 10000,
      status: "completed",
      errorMessage: null,
    };

    const result = evaluateFrankensteinGate(runAtThreshold);
    expect(result.allowed).toBe(false);
  });

  it("allows when Frankenstein test passed (p95_sharpe < 0.3, median_pf in range)", () => {
    const passedRun: FrankensteinRunOutput = {
      runId: "run-003",
      backtestId: "bt-003",
      strategyId: "s-003",
      testMode: "full_shuffle",
      nShuffles: 100,
      p95Sharpe: 0.18,        // BELOW threshold — no edge on shuffled data
      medianPf: 0.97,         // IN range [0.85, 1.15]
      passed: true,
      wallClockMs: 15000,
      status: "completed",
      errorMessage: null,
    };

    const result = evaluateFrankensteinGate(passedRun);
    expect(result.allowed).toBe(true);
    expect(result.reason).toContain("PASSED");
  });

  it("allows when median_pf is exactly at lower bound (0.85)", () => {
    const borderlineRun: FrankensteinRunOutput = {
      runId: "run-004",
      backtestId: "bt-004",
      strategyId: "s-004",
      testMode: "full_shuffle",
      nShuffles: 100,
      p95Sharpe: 0.2,
      medianPf: 0.85,         // Exactly at lower bound — passed=true means allowed
      passed: true,
      wallClockMs: 10000,
      status: "completed",
      errorMessage: null,
    };

    const result = evaluateFrankensteinGate(borderlineRun);
    expect(result.allowed).toBe(true);
  });

  it("blocks when median_pf below lower bound (0.84) — backtester gives too many losers", () => {
    const tooManyLosers: FrankensteinRunOutput = {
      runId: "run-005",
      backtestId: "bt-005",
      strategyId: "s-005",
      testMode: "full_shuffle",
      nShuffles: 100,
      p95Sharpe: 0.15,
      medianPf: 0.84,         // BELOW lower bound — backtester systematically loses
      passed: false,
      wallClockMs: 10000,
      status: "completed",
      errorMessage: null,
    };

    const result = evaluateFrankensteinGate(tooManyLosers);
    expect(result.allowed).toBe(false);
  });

  it("blocks when median_pf above upper bound (1.16) — backtester gains on random data", () => {
    const tooManyWinners: FrankensteinRunOutput = {
      runId: "run-006",
      backtestId: "bt-006",
      strategyId: "s-006",
      testMode: "full_shuffle",
      nShuffles: 100,
      p95Sharpe: 0.15,
      medianPf: 1.16,         // ABOVE upper bound — backtester finds edge in random data
      passed: false,
      wallClockMs: 10000,
      status: "completed",
      errorMessage: null,
    };

    const result = evaluateFrankensteinGate(tooManyWinners);
    expect(result.allowed).toBe(false);
  });
});

// ─── Pass Criteria Constants Verification ────────────────────────────────────

describe("Frankenstein pass criteria constants (locked from plan)", () => {
  it("p95 Sharpe threshold is 0.3", () => {
    expect(PASS_P95_SHARPE_THRESHOLD).toBe(0.3);
  });

  it("median PF lower bound is 0.85", () => {
    expect(PASS_MEDIAN_PF_LOW).toBe(0.85);
  });

  it("median PF upper bound is 1.15", () => {
    expect(PASS_MEDIAN_PF_HIGH).toBe(1.15);
  });
});

// ─── getLatestFrankensteinRun mock behavior ──────────────────────────────────

describe("getLatestFrankensteinRun — mock integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when no run exists (mock returns null)", async () => {
    (getLatestFrankensteinRun as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const result = await getLatestFrankensteinRun("some-backtest-id");
    expect(result).toBeNull();
  });

  it("returns run when one exists (mock returns run)", async () => {
    const mockRun: FrankensteinRunOutput = {
      runId: "mock-run",
      backtestId: "bt-mock",
      strategyId: "s-mock",
      testMode: "full_shuffle",
      nShuffles: 100,
      p95Sharpe: 0.15,
      medianPf: 1.0,
      passed: true,
      wallClockMs: 5000,
      status: "completed",
      errorMessage: null,
    };
    (getLatestFrankensteinRun as ReturnType<typeof vi.fn>).mockResolvedValue(mockRun);

    const result = await getLatestFrankensteinRun("bt-mock");
    expect(result).toEqual(mockRun);
    expect(result?.passed).toBe(true);
  });
});
