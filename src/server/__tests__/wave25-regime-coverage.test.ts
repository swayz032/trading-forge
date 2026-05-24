/**
 * wave25-regime-coverage.test.ts — Wave 25 Gap 9
 *
 * Tests for regime-coverage-monitor-service.ts covering:
 *   1. Empty strategy library → all regimes flagged as gaps
 *   2. All regimes covered → no alarm
 *   3. One regime missing → exactly that regime in alarm list
 *   4. NULL preferredRegimes (wildcard) → covers all regimes
 *   5. Dedupe — alarm already fired within 24h → no double-fire
 *   6. evaluateCoverageGaps correctly identifies zero-coverage regimes
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../../server/lib/logger.js", () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../../server/db/index.js", () => ({
  db: {
    execute: vi.fn(),
    insert: vi.fn(),
  },
}));

vi.mock("../../server/db/schema.js", () => ({
  auditLog: { $inferInsert: {} },
}));

vi.mock("../../server/routes/sse.js", () => ({
  broadcastSSE: vi.fn(),
}));

vi.mock("../../server/services/notification-service.js", () => ({
  notifyWarning: vi.fn(),
  notifyCritical: vi.fn(),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getModules() {
  const { db } = await import("../../server/db/index.js");
  const { broadcastSSE } = await import("../../server/routes/sse.js");
  const { notifyWarning } = await import("../../server/services/notification-service.js");
  const {
    computeRegimeCoverage,
    evaluateCoverageGaps,
    runRegimeCoverageCheck,
    DEPLOYED_REGIME_LIST,
    __test__,
  } = await import("../../server/services/regime-coverage-monitor-service.js");
  return {
    db,
    broadcastSSE,
    notifyWarning,
    computeRegimeCoverage,
    evaluateCoverageGaps,
    runRegimeCoverageCheck,
    DEPLOYED_REGIME_LIST,
    __test__,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("evaluateCoverageGaps (unit)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("all regimes covered → empty gaps array", async () => {
    const { evaluateCoverageGaps, DEPLOYED_REGIME_LIST } = await getModules();
    const coverage = Object.fromEntries(
      DEPLOYED_REGIME_LIST.map((r) => [r, { deployedCount: 1, strategyIds: ["abc"] }]),
    );
    const gaps = evaluateCoverageGaps(coverage);
    expect(gaps).toHaveLength(0);
  });

  it("one regime missing → exactly that regime in gaps", async () => {
    const { evaluateCoverageGaps, DEPLOYED_REGIME_LIST } = await getModules();
    const coverage = Object.fromEntries(
      DEPLOYED_REGIME_LIST.map((r) => [r, { deployedCount: 1, strategyIds: ["abc"] }]),
    );
    // Zero out RANGE_BOUND
    coverage["RANGE_BOUND"] = { deployedCount: 0, strategyIds: [] };
    const gaps = evaluateCoverageGaps(coverage);
    expect(gaps).toEqual(["RANGE_BOUND"]);
  });

  it("all regimes uncovered → all in gaps", async () => {
    const { evaluateCoverageGaps, DEPLOYED_REGIME_LIST } = await getModules();
    const coverage = Object.fromEntries(
      DEPLOYED_REGIME_LIST.map((r) => [r, { deployedCount: 0, strategyIds: [] }]),
    );
    const gaps = evaluateCoverageGaps(coverage);
    expect(gaps).toHaveLength(DEPLOYED_REGIME_LIST.length);
    for (const regime of DEPLOYED_REGIME_LIST) {
      expect(gaps).toContain(regime);
    }
  });
});

describe("computeRegimeCoverage", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("empty strategy library → all regimes have deployedCount=0", async () => {
    const { db, computeRegimeCoverage, DEPLOYED_REGIME_LIST } = await getModules();
    (db.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

    const coverage = await computeRegimeCoverage();

    for (const regime of DEPLOYED_REGIME_LIST) {
      expect(coverage[regime].deployedCount).toBe(0);
    }
  });

  it("strategy with specific regime → only that regime covered", async () => {
    const { db, computeRegimeCoverage } = await getModules();
    (db.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: "s1", preferred_regimes: ["TRENDING_UP"] },
    ]);

    const coverage = await computeRegimeCoverage();
    expect(coverage["TRENDING_UP"].deployedCount).toBe(1);
    expect(coverage["TRENDING_DOWN"].deployedCount).toBe(0);
    expect(coverage["RANGE_BOUND"].deployedCount).toBe(0);
  });

  it("NULL preferredRegimes (wildcard) → covers ALL regimes", async () => {
    const { db, computeRegimeCoverage, DEPLOYED_REGIME_LIST } = await getModules();
    (db.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: "wildcard-strat", preferred_regimes: null },
    ]);

    const coverage = await computeRegimeCoverage();
    for (const regime of DEPLOYED_REGIME_LIST) {
      expect(coverage[regime].deployedCount).toBe(1);
      expect(coverage[regime].strategyIds).toContain("wildcard-strat");
    }
  });

  it("multiple strategies covering different regimes", async () => {
    const { db, computeRegimeCoverage } = await getModules();
    (db.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: "s1", preferred_regimes: ["TRENDING_UP"] },
      { id: "s2", preferred_regimes: ["TRENDING_DOWN", "RANGE_BOUND"] },
    ]);

    const coverage = await computeRegimeCoverage();
    expect(coverage["TRENDING_UP"].deployedCount).toBe(1);
    expect(coverage["TRENDING_DOWN"].deployedCount).toBe(1);
    expect(coverage["RANGE_BOUND"].deployedCount).toBe(1);
    expect(coverage["TRENDING_UP"].strategyIds).toContain("s1");
    expect(coverage["TRENDING_DOWN"].strategyIds).toContain("s2");
  });

  it("db failure → fail-open with zero coverage for all regimes", async () => {
    const { db, computeRegimeCoverage, DEPLOYED_REGIME_LIST } = await getModules();
    (db.execute as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("DB down"));

    const coverage = await computeRegimeCoverage();
    for (const regime of DEPLOYED_REGIME_LIST) {
      expect(coverage[regime].deployedCount).toBe(0);
    }
  });
});

describe("runRegimeCoverageCheck", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("all regimes covered → no alert fired", async () => {
    const { db, notifyWarning, runRegimeCoverageCheck, DEPLOYED_REGIME_LIST } = await getModules();
    (db.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      DEPLOYED_REGIME_LIST.map((r) => ({
        id: `strat-${r}`,
        preferred_regimes: [r],
      })),
    );

    const result = await runRegimeCoverageCheck();
    expect(result.anyGap).toBe(false);
    expect(result.alertFired).toBe(false);
    expect(notifyWarning).not.toHaveBeenCalled();
  });

  it("RANGE_BOUND missing → alert fires with that regime in message", async () => {
    const { db, notifyWarning, broadcastSSE, runRegimeCoverageCheck, DEPLOYED_REGIME_LIST } =
      await getModules();
    const mockInsertChain = { values: vi.fn().mockResolvedValue(undefined) };
    (db.insert as ReturnType<typeof vi.fn>).mockReturnValue(mockInsertChain);

    let callN = 0;
    (db.execute as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callN++;
      if (callN === 1) {
        // No strategy covers RANGE_BOUND
        return DEPLOYED_REGIME_LIST.filter((r) => r !== "RANGE_BOUND").map((r) => ({
          id: `strat-${r}`,
          preferred_regimes: [r],
        }));
      }
      if (callN === 2) {
        // No recent dedupe alert
        return [];
      }
      return [];
    });

    const result = await runRegimeCoverageCheck();
    expect(result.anyGap).toBe(true);
    expect(result.gapRegimes).toContain("RANGE_BOUND");
    expect(result.alertFired).toBe(true);
    expect(notifyWarning).toHaveBeenCalledOnce();
    expect(broadcastSSE).toHaveBeenCalledWith(
      "alert:regime_coverage_gap",
      expect.objectContaining({ gapRegimes: expect.arrayContaining(["RANGE_BOUND"]) }),
    );
  });

  it("dedupe — alert already fired within 24h → no double-fire", async () => {
    const { db, notifyWarning, runRegimeCoverageCheck, DEPLOYED_REGIME_LIST } = await getModules();

    let callN = 0;
    (db.execute as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callN++;
      if (callN === 1) {
        // No coverage for any regime
        return [];
      }
      if (callN === 2) {
        // Recent alert EXISTS → suppress
        return [{ "1": 1 }];
      }
      return [];
    });

    const result = await runRegimeCoverageCheck();
    expect(result.anyGap).toBe(true);
    expect(result.alertFired).toBe(false);
    expect(notifyWarning).not.toHaveBeenCalled();
  });

  it("DEPLOYED_REGIME_LIST contains the W23H.A regimes", async () => {
    const { DEPLOYED_REGIME_LIST } = await getModules();
    expect(DEPLOYED_REGIME_LIST).toContain("TRENDING_UP");
    expect(DEPLOYED_REGIME_LIST).toContain("TRENDING_DOWN");
    expect(DEPLOYED_REGIME_LIST).toContain("RANGE_BOUND");
  });
});
