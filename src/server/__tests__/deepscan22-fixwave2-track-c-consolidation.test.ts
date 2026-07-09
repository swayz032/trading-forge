/**
 * deepscan22-fixwave2-track-c-consolidation.test.ts
 *
 * Deep-Scan #22 Fix-Wave 2, Track C (quantum dead-code / doc-drift consolidation).
 *
 * FIX C2 — normalizeRLConfidence() was a dead duplicate of the live
 * kill-switch + DSR gating logic inlined in rl-signal-fetcher.ts::fetchRlSignal.
 * Two unshared copies of the same safety-critical two-gate contract is a
 * silent-divergence risk (a future edit to one copy's tolerance/logic would not
 * propagate to the other). This suite pins that fetchRlSignal now DELEGATES to
 * the shared normalizeRLConfidence() as the single source of truth for the
 * final gate-and-clamp decision, rather than re-implementing it inline.
 *
 * Unlike wave29-pass-c3-composite-13th-subsystem.test.ts (which tests
 * normalizeRLConfidence in isolation) this suite drives fetchRlSignal
 * end-to-end through a mocked DB and asserts the shared function is actually
 * invoked with the gate booleans fetchRlSignal computed — proving the
 * consolidation is real call-through wiring, not two implementations that
 * merely happen to agree.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── DB mock (queue-controlled via exported __mockLimit handle) ──────────────
vi.mock("../db/index.js", () => {
  const mockLimit = vi.fn();
  const mockOrderBy = vi.fn().mockReturnValue({ limit: mockLimit });
  const mockWhere = vi.fn().mockReturnValue({ orderBy: mockOrderBy });
  const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
  const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });
  return {
    db: { select: mockSelect },
    __mockLimit: mockLimit,
  };
});

vi.mock("../db/schema.js", () => ({
  quantumRlRuns: {},
  backtests: {},
  monteCarloRuns: {},
}));

vi.mock("../routes/sse.js", () => ({
  broadcastSSE: vi.fn(),
}));

vi.mock("../lib/metrics-registry.js", () => ({
  rlKillSwitchTotal: { labels: vi.fn().mockReturnValue({ inc: vi.fn() }) },
}));

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, _val: unknown) => ({ eq: true })),
  desc: vi.fn((col: unknown) => col),
  and: vi.fn((...args: unknown[]) => args),
  sql: vi.fn(),
}));

// Wrap the REAL normalizeRLConfidence in a vi.fn spy so we can assert
// call-through (args + count) while still exercising its real gate logic.
vi.mock("../lib/score-normalization.js", async () => {
  const actual = await vi.importActual<typeof import("../lib/score-normalization.js")>(
    "../lib/score-normalization.js",
  );
  return {
    ...actual,
    normalizeRLConfidence: vi.fn(actual.normalizeRLConfidence),
  };
});

import * as dbIndexMock from "../db/index.js";
import { broadcastSSE } from "../routes/sse.js";
import { normalizeRLConfidence } from "../lib/score-normalization.js";
import { fetchRlSignal } from "../lib/rl-signal-fetcher.js";

// __mockLimit is a test-only handle injected by the vi.mock("../db/index.js")
// factory above; it has no type in the real db/index.js module.
const __mockLimit = (dbIndexMock as unknown as { __mockLimit: ReturnType<typeof vi.fn> }).__mockLimit;

function killSwitchRow(reward: number, effectiveConfidence: number) {
  return {
    reward,
    confidenceScore: effectiveConfidence,
    effectiveConfidence,
    ciHighAtEvaluation: 0.1,
    evaluatedAt: new Date("2026-07-01T00:00:00Z"),
  };
}

const STRATEGY_ID = "11111111-1111-1111-1111-111111111111";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("FIX C2 — fetchRlSignal delegates to shared normalizeRLConfidence (single source of truth)", () => {
  it("both gates pass: confidence returned equals normalizeRLConfidence's own output, and the spy was called with the gate booleans fetchRlSignal computed", async () => {
    const latestRun = {
      effectiveConfidence: 0.8,
      confidenceScore: 0.8,
      governanceLabels: { dsr_passed: true },
      evaluatedAt: new Date("2026-07-01T00:00:00Z"),
      reward: 5,
      regime: "TRENDING",
    };
    // Constant rewards across the kill-switch lookback → stddev=0 →
    // rolling_sharpe_oos=null → gap_ratio=null → dormant=true (untriggered).
    const killSwitchRows = [
      killSwitchRow(5, 0.8),
      killSwitchRow(5, 0.8),
      killSwitchRow(5, 0.8),
    ];

    __mockLimit
      .mockResolvedValueOnce([latestRun])   // Step 1: latest quantum_rl_runs row
      .mockResolvedValueOnce(killSwitchRows); // Step 2: kill-switch lookback rows

    const result = await fetchRlSignal(STRATEGY_ID);

    expect(result.available).toBe(true);
    expect(result.confidence).toBe(0.8);

    // Pin the call-through: fetchRlSignal must invoke the SHARED function
    // with (rawConfidence, dsrGatePassed, killSwitchDormant) rather than
    // computing max(0,min(1,x)) + gate booleans itself.
    expect(normalizeRLConfidence).toHaveBeenCalledTimes(1);
    expect(normalizeRLConfidence).toHaveBeenCalledWith(0.8, true, true);

    // And the returned confidence must be EXACTLY what the shared function
    // produced for these inputs (not an independently-computed value).
    const spyResult = (normalizeRLConfidence as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(result.confidence).toBe(spyResult);
  });

  it("DSR gate fails: fetchRlSignal returns unavailable via the shared function's null, not an inline re-check", async () => {
    const latestRun = {
      effectiveConfidence: 0.8,
      confidenceScore: 0.8,
      governanceLabels: { dsr_passed: false }, // fallback path (no sr_is/sr_oos/n_iterations)
      evaluatedAt: new Date("2026-07-01T00:00:00Z"),
      reward: 5,
      regime: "TRENDING",
    };
    const killSwitchRows = [killSwitchRow(5, 0.8), killSwitchRow(5, 0.8)];

    __mockLimit
      .mockResolvedValueOnce([latestRun])
      .mockResolvedValueOnce(killSwitchRows);

    const result = await fetchRlSignal(STRATEGY_ID);

    expect(result.available).toBe(false);
    expect(result.confidence).toBeNull();
    expect(result.unavailable_reason).toBe("dsr_not_passed");

    expect(normalizeRLConfidence).toHaveBeenCalledTimes(1);
    expect(normalizeRLConfidence).toHaveBeenCalledWith(0.8, false, true);
  });

  it("kill switch trips: fetchRlSignal returns unavailable via the shared function's null and still fires the SSE + Prometheus side-effects", async () => {
    const latestRun = {
      effectiveConfidence: 0.9,
      confidenceScore: 0.9,
      governanceLabels: { dsr_passed: true },
      evaluatedAt: new Date("2026-07-01T00:00:00Z"),
      reward: 10,
      regime: "TRENDING",
    };
    // mean(reward)=0, stddev>0 → rolling_sharpe_oos=0.
    // avgEffectiveConf=0.9 → is_sharpe_reference=1.8 (no governance sr_is supplied).
    // gap_ratio = |1.8-0|/1.8 = 1.0 > 0.30 threshold → kill switch triggers.
    const killSwitchRows = [
      killSwitchRow(10, 0.9),
      killSwitchRow(-10, 0.9),
      killSwitchRow(10, 0.9),
      killSwitchRow(-10, 0.9),
    ];

    __mockLimit
      .mockResolvedValueOnce([latestRun])
      .mockResolvedValueOnce(killSwitchRows);

    const result = await fetchRlSignal(STRATEGY_ID);

    expect(result.available).toBe(false);
    expect(result.confidence).toBeNull();
    expect(result.unavailable_reason).toMatch(/^kill_switch_active:/);

    // Gate booleans passed to the shared function: dsr passed=true, dormant=false.
    expect(normalizeRLConfidence).toHaveBeenCalledTimes(1);
    expect(normalizeRLConfidence).toHaveBeenCalledWith(0.9, true, false);

    expect(broadcastSSE).toHaveBeenCalledWith(
      "quantum_rl:kill_switch_engaged",
      expect.objectContaining({ strategy_id: STRATEGY_ID }),
    );
  });
});
