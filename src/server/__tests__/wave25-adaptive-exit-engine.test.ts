/**
 * wave25-adaptive-exit-engine.test.ts — Wave 25 Pass 7 (W25.12-W25.16)
 *
 * Coverage:
 *
 * Liquidity-Mapped TP (W25.12):
 *  1. Long in TRENDING_UP: tp1 from nearest PDH with R >= 0.8; tp2 from next liquidity
 *  2. Long in TRENDING_UP: tp2 falls back to +2R when no second level found
 *  3. No intraday liquidity within range: tp1 falls back to +1R, tp2 falls back to +2R
 *  4. Liquidity with R < 0.8 excluded from tp1 candidates
 *  5. PWH/PWL excluded from TP candidates (day-trader mandate)
 *  6. PMH/PML excluded from TP candidates (day-trader mandate)
 *
 * Regime Scaling (W25.13):
 *  7. TRENDING_UP → scaling 20/30/50
 *  8. TRENDING_DOWN → scaling 20/30/50
 *  9. EXPANSION → scaling 20/30/50
 * 10. RANGE_BOUND → scaling 50/30/20
 * 11. COMPRESSION → scaling 50/30/20
 * 12. HIGH_VOL_MACRO → scaling 60/30/10
 * 13. LOW_LIQ_CHOP → scaling 50/50/0
 * 14. Unknown regime → UNKNOWN fallback 50/30/20
 * 15. Per-strategy override via exit_plan_config.scaling_overrides
 *
 * Runner Trail Selection (W25.15):
 * 16. TRENDING_UP → anchored_vwap (anchor = entry.timestamp millis)
 * 17. TRENDING_DOWN → anchored_vwap
 * 18. EXPANSION → anchored_vwap
 * 19. RANGE_BOUND → developing_poc (Style C legacy preserved)
 * 20. HIGH_VOL_MACRO → chandelier
 * 21. COMPRESSION → structure_trail
 * 22. LOW_LIQ_CHOP → developing_poc
 * 23. Per-strategy runner trail override respected
 *
 * Pre-Lunch Soft Exit (W25.16):
 * 24. RANGE_BOUND + 11:30 ET + profit 0.4R → shouldFire=true, partial_pct=0.50
 * 25. TRENDING_UP at 11:30 → shouldFire=false (trending regimes exempt)
 * 26. RANGE_BOUND + 11:15 ET + profit 0.4R → shouldFire=false (too early)
 * 27. RANGE_BOUND + 11:30 ET + profit 0.2R → shouldFire=false (below threshold)
 * 28. LOW_LIQ_CHOP + 12:00 ET + profit 0.5R → shouldFire=true
 * 29. COMPRESSION + 13:00 ET + profit 0.3R → shouldFire=true (at threshold)
 * 30. Pre-lunch tightens stop to BE+0.5R
 *
 * Delta-Divergence Early-Exit (W25.14):
 * 31. Position in favor + profit 0.6R + delta_score 0.7 → shouldFire=true, partial_pct=0.25
 * 32. Position NOT in favor → shouldFire=false
 * 33. Profit < 0.5R → shouldFire=false (not enough cushion to lock)
 * 34. TP1 already hit → shouldFire=false
 * 35. delta_score below threshold → shouldFire=false
 * 36. Env var EXIT_DELTA_DIVERGENCE_THRESHOLD override respected
 * 37. Never flips position: direction preserved after partial (net position > 0)
 * 38. Custom delta_div_partial_pct from exit_plan_config respected
 *
 * Hard Invariants:
 * 39. 15:55 ET flatten is in time_stop block — NOT suppressed by adaptive engine
 * 40. exit_style=static_styleC: computeExitPlan NOT called; Style C path is distinct
 * 41. Framework-overlay stamps exit_style=static_styleC by default (backward-compat)
 * 42. Framework-overlay stamps exit_style=adaptive when input.exitStyle="adaptive"
 * 43. Framework-overlay idempotent: second run does NOT overwrite existing exit_style
 *
 * ExitPlan structure:
 * 44. computeExitPlan returns full ExitPlan with tp1/tp2/runner/scaling fields
 * 45. audit_payload contains all required keys for signal.exit_plan_computed
 * 46. Short position: tp1/tp2 prices below entry price
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ─── Module mocks (must precede imports that pull db/schema transitively) ─────
vi.mock("../db/index.js", () => ({ db: {} }));
vi.mock("../db/schema.js", () => ({}));
vi.mock("../lib/audit-log-helper.js", () => ({
  insertAuditRow: vi.fn().mockResolvedValue(undefined),
  insertAuditRowSafe: vi.fn().mockResolvedValue(true),
}));
// framework-overlay.ts imports from ../index.js (legacy pattern — not leaf logger).
// Mock the entire server index so we don't pull in Express routes + complianceRulesets.
vi.mock("../index.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));
// Mock lib/logger.js (used by adaptive-exit-engine.ts + liquidity-map-service.ts)
vi.mock("../lib/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock liquidity-map-service — we test adaptive logic without DB
vi.mock("../services/liquidity-map-service.js", () => ({
  getNearestLiquidity: vi.fn(),
}));

// ─── Imports (after mocks) ─────────────────────────────────────────────────────
import {
  computeExitPlan,
  computePreLunchDecision,
  computeDeltaDivDecision,
  type ExitPlanInput,
} from "../services/adaptive-exit-engine.js";
import { applyFrameworkOverlay } from "../services/framework-overlay.js";
import { getNearestLiquidity } from "../services/liquidity-map-service.js";
import type { RankedLevel, LevelType } from "../services/liquidity-map-service.js";

const mockGetNearestLiquidity = vi.mocked(getNearestLiquidity);

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ENTRY_LONG = {
  price: 5000,
  stop: 4986,    // 14pt stop → 1R = 14pts
  direction: "long" as const,
  timestamp: new Date("2026-05-24T14:00:00Z"),
};

const ENTRY_SHORT = {
  price: 5000,
  stop: 5014,    // 14pt stop → 1R = 14pts short side
  direction: "short" as const,
  timestamp: new Date("2026-05-24T14:00:00Z"),
};

const BAR_NOON = {
  close: 5002,
  high: 5004,
  low: 4999,
  volume: 1200,
  ts_event: new Date("2026-05-24T16:00:00Z"),  // 12:00 ET (16:00 UTC)
};

const BAR_PRE_LUNCH = {
  close: 5002,
  high: 5004,
  low: 4999,
  volume: 1200,
  ts_event: new Date("2026-05-24T15:30:00Z"),  // 11:30 ET (15:30 UTC)
};

const BAR_EARLY = {
  close: 5002,
  high: 5004,
  low: 4999,
  volume: 1200,
  ts_event: new Date("2026-05-24T15:15:00Z"),  // 11:15 ET (15:15 UTC)
};

const MARKET_STATE_TRENDING = {
  regime: "TRENDING_UP",
  narrativePhase: "DISTRIBUTION",
  atr: 14,
};

const MARKET_STATE_RANGE = {
  regime: "RANGE_BOUND",
  narrativePhase: "NEUTRAL",
  atr: 8,
};

const MARKET_STATE_HIGH_VOL = {
  regime: "HIGH_VOL_MACRO",
  narrativePhase: null,
  atr: 20,
};

const MARKET_STATE_COMPRESSION = {
  regime: "COMPRESSION",
  narrativePhase: null,
  atr: 5,
};

const MARKET_STATE_LOW_LIQ = {
  regime: "LOW_LIQ_CHOP",
  narrativePhase: null,
  atr: 6,
};

const MARKET_STATE_EXPANSION = {
  regime: "EXPANSION",
  narrativePhase: "DISTRIBUTION",
  atr: 18,
};

function makeStrategy(overrides?: Record<string, unknown>) {
  return {
    id: "test-strategy-id",
    exit_plan_config: null,
    ...overrides,
  };
}

function makeRankedLevel(
  levelType: LevelType,
  price: number,
  htfSignificance = 3,
): RankedLevel {
  return {
    id: `level-${price}`,
    symbol: "MES",
    level_type: levelType,
    price,
    htf_significance: htfSignificance,
    sweep_probability: 0.7,
    touched_count: 0,
    age_hours: 2,
    source_meta: {},
    distance_points: price - 5000,
  };
}

function makeInput(overrides?: Partial<ExitPlanInput>): ExitPlanInput {
  return {
    strategy: makeStrategy(),
    entry: ENTRY_LONG,
    symbol: "MES",
    bar: BAR_NOON,
    marketState: MARKET_STATE_TRENDING,
    correlationId: "test-corr-001",
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("W25.12 — Liquidity-Mapped TP Engine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("1. Long in TRENDING_UP: tp1 from nearest PDH with R >= 0.8", async () => {
    // 1R = 14pts. PDH at 5013 = 13pts above entry = 0.93R >= 0.8 ✓
    mockGetNearestLiquidity.mockResolvedValueOnce([
      makeRankedLevel("pdh", 5013, 3),
      makeRankedLevel("hod", 5020, 1),
    ]);

    const plan = await computeExitPlan(makeInput());
    expect(plan.tp1.source).toBe("liquidity");
    expect(plan.tp1.level_type).toBe("pdh");
    expect(plan.tp1.price).toBe(5013);
    expect(plan.tp1.r_multiple).toBeCloseTo(13 / 14, 2);
  });

  it("2. Long: tp2 falls back to +2R when no second qualifying level", async () => {
    mockGetNearestLiquidity.mockResolvedValueOnce([
      makeRankedLevel("pdh", 5013, 3),  // only one level
    ]);

    const plan = await computeExitPlan(makeInput());
    expect(plan.tp2.source).toBe("r_multiple");
    expect(plan.tp2.r_multiple).toBe(2.0);
    // +2R from 5000 with 14pt stop = 5028
    expect(plan.tp2.price).toBeCloseTo(5000 + 2 * 14, 2);
  });

  it("3. No intraday liquidity within range: tp1 = +1R, tp2 = +2R", async () => {
    mockGetNearestLiquidity.mockResolvedValueOnce([]);  // no levels

    const plan = await computeExitPlan(makeInput());
    expect(plan.tp1.source).toBe("r_multiple");
    expect(plan.tp1.r_multiple).toBe(1.0);
    expect(plan.tp1.price).toBeCloseTo(5000 + 14, 2);  // 5014
    expect(plan.tp2.source).toBe("r_multiple");
    expect(plan.tp2.r_multiple).toBe(2.0);
  });

  it("4. Liquidity with R < 0.8 excluded from tp1 candidates", async () => {
    // PDH at 5010 = 10pts / 14pt stop = 0.71R < 0.8 → should skip
    // HOD at 5013 = 13pts / 14pt stop = 0.93R >= 0.8 → should use
    mockGetNearestLiquidity.mockResolvedValueOnce([
      makeRankedLevel("pdh", 5010, 3),  // too close (0.71R)
      makeRankedLevel("hod", 5013, 1),  // qualifies (0.93R)
    ]);

    const plan = await computeExitPlan(makeInput());
    expect(plan.tp1.source).toBe("liquidity");
    expect(plan.tp1.price).toBe(5013);
    expect(plan.tp1.level_type).toBe("hod");
  });

  it("5. PWH/PWL excluded from TP candidates (day-trader mandate)", async () => {
    // pwh_iso at 5012 would be 0.86R — qualifies on R but must be EXCLUDED
    // pdh at 5015 = 1.07R — should be selected instead
    mockGetNearestLiquidity.mockResolvedValueOnce([
      makeRankedLevel("pwh_iso" as LevelType, 5012, 4),  // EXCLUDED — multi-day DOL
      makeRankedLevel("pdh", 5015, 3),
    ]);

    const plan = await computeExitPlan(makeInput());
    expect(plan.tp1.level_type).not.toBe("pwh_iso");
    expect(plan.tp1.level_type).toBe("pdh");
  });

  it("6. PMH/PML excluded from TP candidates (day-trader mandate)", async () => {
    mockGetNearestLiquidity.mockResolvedValueOnce([
      makeRankedLevel("pmh" as LevelType, 5012, 5),    // EXCLUDED — monthly
      makeRankedLevel("pml" as LevelType, 4988, 5),    // EXCLUDED — monthly
      makeRankedLevel("naked_poc", 5013, 2),             // allowed
    ]);

    const plan = await computeExitPlan(makeInput());
    expect(plan.tp1.level_type).not.toBe("pmh");
    expect(plan.tp1.level_type).toBe("naked_poc");
  });

  it("46. Short position: tp1/tp2 prices below entry price", async () => {
    // Short from 5000, stop 5014 (14pt). PDL at 4987 = 13pts below = 0.93R ✓
    mockGetNearestLiquidity.mockResolvedValueOnce([
      makeRankedLevel("pdl", 4987, 3),
    ]);

    const plan = await computeExitPlan(makeInput({ entry: ENTRY_SHORT }));
    expect(plan.tp1.price).toBeLessThan(5000);
    expect(plan.tp1.level_type).toBe("pdl");
  });
});

describe("W25.13 — Regime-Dependent Scaling Schedule", () => {
  beforeEach(() => {
    mockGetNearestLiquidity.mockResolvedValue([]);
    vi.clearAllMocks();
    mockGetNearestLiquidity.mockResolvedValue([]);
  });

  it.each([
    ["TRENDING_UP",   { regime: "TRENDING_UP",   narrativePhase: null, atr: 14 }, 0.20, 0.30, 0.50],
    ["TRENDING_DOWN", { regime: "TRENDING_DOWN",  narrativePhase: null, atr: 14 }, 0.20, 0.30, 0.50],
    ["EXPANSION",     { regime: "EXPANSION",      narrativePhase: null, atr: 14 }, 0.20, 0.30, 0.50],
    ["RANGE_BOUND",   { regime: "RANGE_BOUND",    narrativePhase: null, atr: 8  }, 0.50, 0.30, 0.20],
    ["COMPRESSION",   { regime: "COMPRESSION",    narrativePhase: null, atr: 5  }, 0.50, 0.30, 0.20],
    ["HIGH_VOL_MACRO",{ regime: "HIGH_VOL_MACRO", narrativePhase: null, atr: 20 }, 0.60, 0.30, 0.10],
    ["LOW_LIQ_CHOP",  { regime: "LOW_LIQ_CHOP",  narrativePhase: null, atr: 6  }, 0.50, 0.50, 0.00],
  ] as const)("%s → scaling %s/%s/%s", async (regime, marketState, tp1, tp2, runner) => {
    const plan = await computeExitPlan(makeInput({ marketState }));
    expect(plan.scaling.tp1_pct).toBeCloseTo(tp1);
    expect(plan.scaling.tp2_pct).toBeCloseTo(tp2);
    expect(plan.scaling.runner_pct).toBeCloseTo(runner);
    expect(plan.scaling.regime_source).toBe(regime);
  });

  it("14. Unknown regime → UNKNOWN fallback 50/30/20", async () => {
    const plan = await computeExitPlan(makeInput({
      marketState: { regime: "SOME_NEW_REGIME", narrativePhase: null, atr: 10 },
    }));
    expect(plan.scaling.tp1_pct).toBeCloseTo(0.50);
    expect(plan.scaling.tp2_pct).toBeCloseTo(0.30);
    expect(plan.scaling.runner_pct).toBeCloseTo(0.20);
  });

  it("15. Per-strategy override via exit_plan_config.scaling_overrides", async () => {
    const plan = await computeExitPlan(makeInput({
      strategy: makeStrategy({
        exit_plan_config: {
          exit_style: "adaptive",
          scaling_overrides: {
            TRENDING_UP: [0.40, 0.40, 0.20],  // custom override
          },
        },
      }),
    }));
    expect(plan.scaling.tp1_pct).toBeCloseTo(0.40);
    expect(plan.scaling.tp2_pct).toBeCloseTo(0.40);
    expect(plan.scaling.runner_pct).toBeCloseTo(0.20);
    expect(plan.scaling.schedule_source).toBe("strategy_override");
  });
});

describe("W25.15 — Runner Trail Selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetNearestLiquidity.mockResolvedValue([]);
  });

  it.each([
    ["TRENDING_UP",   "TRENDING_UP",   "anchored_vwap"],
    ["TRENDING_DOWN", "TRENDING_DOWN", "anchored_vwap"],
    ["EXPANSION",     "EXPANSION",     "anchored_vwap"],
    ["RANGE_BOUND",   "RANGE_BOUND",   "developing_poc"],
    ["HIGH_VOL_MACRO","HIGH_VOL_MACRO","chandelier"],
    ["COMPRESSION",   "COMPRESSION",  "structure_trail"],
    ["LOW_LIQ_CHOP",  "LOW_LIQ_CHOP", "developing_poc"],
  ] as const)("%s → trail method %s", async (_label, regime, expectedMethod) => {
    const plan = await computeExitPlan(makeInput({
      marketState: { regime, narrativePhase: null, atr: 14 },
    }));
    expect(plan.runner.trail_method).toBe(expectedMethod);
  });

  it("16. TRENDING_UP → anchored_vwap; anchor = entry.timestamp millis", async () => {
    const entry = { ...ENTRY_LONG, timestamp: new Date("2026-05-24T14:00:00Z") };
    const plan = await computeExitPlan(makeInput({
      entry,
      marketState: MARKET_STATE_TRENDING,
    }));
    expect(plan.runner.trail_method).toBe("anchored_vwap");
    expect(plan.runner.trail_anchor_value).toBe(entry.timestamp.getTime());
  });

  it("23. Per-strategy runner trail override respected", async () => {
    const plan = await computeExitPlan(makeInput({
      strategy: makeStrategy({
        exit_plan_config: {
          exit_style: "adaptive",
          runner_trail_overrides: {
            TRENDING_UP: "chandelier",  // override: use chandelier for TRENDING_UP
          },
        },
      }),
    }));
    expect(plan.runner.trail_method).toBe("chandelier");
    expect(plan.runner.method_source).toBe("strategy_override");
  });
});

describe("W25.16 — Pre-Lunch Soft Exit", () => {
  it("24. RANGE_BOUND + 11:30 ET + profit 0.4R → shouldFire=true, partial=50%", () => {
    const result = computePreLunchDecision({
      regime: "RANGE_BOUND",
      bar: BAR_PRE_LUNCH,   // 11:30 ET
      entry: ENTRY_LONG,
      currentPnlR: 0.4,
      thresholdR: 0.3,
    });
    expect(result.shouldFire).toBe(true);
    expect(result.partial_pct).toBe(0.50);
  });

  it("25. TRENDING_UP at 11:30 → shouldFire=false (trending exempt)", () => {
    const result = computePreLunchDecision({
      regime: "TRENDING_UP",
      bar: BAR_PRE_LUNCH,
      entry: ENTRY_LONG,
      currentPnlR: 0.4,
      thresholdR: 0.3,
    });
    expect(result.shouldFire).toBe(false);
  });

  it("26. RANGE_BOUND + 11:15 ET + profit 0.4R → shouldFire=false (too early)", () => {
    const result = computePreLunchDecision({
      regime: "RANGE_BOUND",
      bar: BAR_EARLY,   // 11:15 ET
      entry: ENTRY_LONG,
      currentPnlR: 0.4,
      thresholdR: 0.3,
    });
    expect(result.shouldFire).toBe(false);
  });

  it("27. RANGE_BOUND + 11:30 ET + profit 0.2R → shouldFire=false (below threshold)", () => {
    const result = computePreLunchDecision({
      regime: "RANGE_BOUND",
      bar: BAR_PRE_LUNCH,
      entry: ENTRY_LONG,
      currentPnlR: 0.2,
      thresholdR: 0.3,
    });
    expect(result.shouldFire).toBe(false);
  });

  it("28. LOW_LIQ_CHOP + 12:00 ET + profit 0.5R → shouldFire=true", () => {
    const result = computePreLunchDecision({
      regime: "LOW_LIQ_CHOP",
      bar: BAR_NOON,   // 12:00 ET
      entry: ENTRY_LONG,
      currentPnlR: 0.5,
      thresholdR: 0.3,
    });
    expect(result.shouldFire).toBe(true);
  });

  it("29. COMPRESSION + 13:00 ET + profit 0.3R → shouldFire=true (exactly at threshold)", () => {
    const bar1300 = {
      ...BAR_NOON,
      ts_event: new Date("2026-05-24T17:00:00Z"),  // 13:00 ET
    };
    const result = computePreLunchDecision({
      regime: "COMPRESSION",
      bar: bar1300,
      entry: ENTRY_LONG,
      currentPnlR: 0.3,
      thresholdR: 0.3,
    });
    expect(result.shouldFire).toBe(true);
  });

  it("30. Pre-lunch tightens stop to BE+0.5R", () => {
    // Entry 5000, stop 4986, 1R = 14pts. BE+0.5R = 5000 + 0.5*14 = 5007
    const result = computePreLunchDecision({
      regime: "RANGE_BOUND",
      bar: BAR_PRE_LUNCH,
      entry: ENTRY_LONG,
      currentPnlR: 0.4,
      thresholdR: 0.3,
    });
    expect(result.tightened_stop).toBeCloseTo(5000 + 0.5 * 14, 2);  // 5007
  });
});

describe("W25.14 — Delta-Divergence Early-Exit", () => {
  beforeEach(() => {
    // Reset env var
    delete process.env["EXIT_DELTA_DIVERGENCE_THRESHOLD"];
  });
  afterEach(() => {
    delete process.env["EXIT_DELTA_DIVERGENCE_THRESHOLD"];
  });

  it("31. In favor + 0.6R profit + delta 0.7 → shouldFire=true, partial=0.25", () => {
    const result = computeDeltaDivDecision({
      positionInFavor: true,
      currentPnlR: 0.6,
      deltaDivergenceScore: 0.7,
      tp1AlreadyHit: false,
      config: null,
    });
    expect(result.shouldFire).toBe(true);
    expect(result.partial_pct).toBe(0.25);
  });

  it("32. Position NOT in favor → shouldFire=false", () => {
    const result = computeDeltaDivDecision({
      positionInFavor: false,
      currentPnlR: 0.6,
      deltaDivergenceScore: 0.9,
      tp1AlreadyHit: false,
      config: null,
    });
    expect(result.shouldFire).toBe(false);
  });

  it("33. Profit < 0.5R → shouldFire=false (not enough cushion)", () => {
    const result = computeDeltaDivDecision({
      positionInFavor: true,
      currentPnlR: 0.4,
      deltaDivergenceScore: 0.9,
      tp1AlreadyHit: false,
      config: null,
    });
    expect(result.shouldFire).toBe(false);
  });

  it("34. TP1 already hit → shouldFire=false", () => {
    const result = computeDeltaDivDecision({
      positionInFavor: true,
      currentPnlR: 1.2,
      deltaDivergenceScore: 0.9,
      tp1AlreadyHit: true,  // TP1 already taken
      config: null,
    });
    expect(result.shouldFire).toBe(false);
  });

  it("35. delta_score at threshold boundary → shouldFire=false (strictly greater than)", () => {
    const result = computeDeltaDivDecision({
      positionInFavor: true,
      currentPnlR: 0.6,
      deltaDivergenceScore: 0.6,  // exactly at threshold, NOT strictly greater
      tp1AlreadyHit: false,
      config: null,
    });
    expect(result.shouldFire).toBe(false);
  });

  it("36. Env var EXIT_DELTA_DIVERGENCE_THRESHOLD override respected", () => {
    process.env["EXIT_DELTA_DIVERGENCE_THRESHOLD"] = "0.8";
    const resultBelow = computeDeltaDivDecision({
      positionInFavor: true,
      currentPnlR: 0.6,
      deltaDivergenceScore: 0.75,  // below 0.8 override → no fire
      tp1AlreadyHit: false,
      config: null,
    });
    expect(resultBelow.shouldFire).toBe(false);
    expect(resultBelow.threshold).toBe(0.8);

    const resultAbove = computeDeltaDivDecision({
      positionInFavor: true,
      currentPnlR: 0.6,
      deltaDivergenceScore: 0.85,  // above 0.8 override → fire
      tp1AlreadyHit: false,
      config: null,
    });
    expect(resultAbove.shouldFire).toBe(true);
  });

  it("37. Never flips position: partial_pct < 1.0 (position remains open)", () => {
    const result = computeDeltaDivDecision({
      positionInFavor: true,
      currentPnlR: 0.6,
      deltaDivergenceScore: 0.9,
      tp1AlreadyHit: false,
      config: null,
    });
    expect(result.partial_pct).toBeLessThan(1.0);
    expect(result.partial_pct).toBeGreaterThan(0);
  });

  it("38. Custom delta_div_partial_pct from exit_plan_config respected", () => {
    const result = computeDeltaDivDecision({
      positionInFavor: true,
      currentPnlR: 0.6,
      deltaDivergenceScore: 0.9,
      tp1AlreadyHit: false,
      config: { exit_style: "adaptive", delta_div_partial_pct: 0.15 },
    });
    expect(result.shouldFire).toBe(true);
    expect(result.partial_pct).toBe(0.15);
    expect(result.partial_pct).toBeLessThan(1.0);  // never flips
  });
});

describe("Hard Invariants", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetNearestLiquidity.mockResolvedValue([]);
  });

  it("39. 15:55 ET flatten in time_stop — not modified by adaptive engine", () => {
    // applyFrameworkOverlay always stamps time_stop.flat_at="15:55 ET".
    // Adaptive exit engine computeExitPlan does not touch time_stop.
    const result = applyFrameworkOverlay({
      compiled: {
        exit_type: "trailing_stop",
        strategy: { exit: "high < low", stop_loss: { type: "atr", multiplier: 1.5 } },
        metadata: {},
      },
      source: "manual",
      symbol: "MES",
      exitStyle: "adaptive",  // even with adaptive exit style...
    });
    // ...time_stop is still the hard 15:55 ET flatten
    expect(result.config.time_stop?.flat_at).toBe("15:55 ET");
    expect(result.config.time_stop?.type).toBe("hard_flatten");
  });

  it("40. exit_style=static_styleC: Style C exit params preserved verbatim", () => {
    const result = applyFrameworkOverlay({
      compiled: {
        exit_type: "trailing_stop",
        strategy: { exit: "high < low", stop_loss: { type: "atr", multiplier: 1.5 } },
        metadata: {},
      },
      source: "manual",
      symbol: "MES",
      // No exitStyle → defaults to static_styleC
    });
    // exit_params has Style C partials
    expect(result.config.exit_params?.style).toBe("c");
    const partials = result.config.exit_params?.partials as Array<{ at_r: number; size_pct: number }>;
    expect(partials).toHaveLength(2);
    expect(partials[0].at_r).toBe(1.0);
    expect(partials[0].size_pct).toBeCloseTo(0.33, 2);
    expect(partials[1].at_r).toBe(2.0);
    expect(partials[1].size_pct).toBeCloseTo(0.33, 2);
    // exit_style stamped as static_styleC
    expect(result.config.exit_plan_config?.exit_style).toBe("static_styleC");
  });

  it("41. Framework-overlay stamps static_styleC by default (backward-compat)", () => {
    const result = applyFrameworkOverlay({
      compiled: {
        exit_type: "trailing_stop",
        strategy: { exit: "high < low", stop_loss: { type: "atr", multiplier: 1.5 } },
        metadata: {},
      },
      source: "openclaw",
      symbol: "MNQ",
      // No exitStyle passed → must default to static_styleC
    });
    expect(result.config.exit_plan_config?.exit_style).toBe("static_styleC");
  });

  it("42. Framework-overlay stamps adaptive when exitStyle='adaptive'", () => {
    const result = applyFrameworkOverlay({
      compiled: {
        exit_type: "trailing_stop",
        strategy: { exit: "high < low", stop_loss: { type: "atr", multiplier: 1.5 } },
        metadata: {},
      },
      source: "manual",
      symbol: "MES",
      exitStyle: "adaptive",
    });
    expect(result.config.exit_plan_config?.exit_style).toBe("adaptive");
    expect(result.appliedRules).toContain(
      "exit_plan_config.exit_style=adaptive (Wave 25 Pass 7 stamp)",
    );
  });

  it("43. Framework-overlay idempotent: second run does NOT overwrite existing exit_style", () => {
    // First run stamps adaptive
    const first = applyFrameworkOverlay({
      compiled: {
        exit_type: "trailing_stop",
        strategy: { exit: "high < low", stop_loss: { type: "atr", multiplier: 1.5 } },
        metadata: {},
        exit_plan_config: { exit_style: "adaptive" },  // already stamped
      },
      source: "manual",
      symbol: "MES",
      exitStyle: "static_styleC",  // caller passes different value — but should be ignored
    });
    // Idempotent: existing value preserved
    expect(first.config.exit_plan_config?.exit_style).toBe("adaptive");
  });
});

describe("ExitPlan structure correctness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetNearestLiquidity.mockResolvedValue([]);
  });

  it("44. computeExitPlan returns full ExitPlan with all required fields", async () => {
    const plan = await computeExitPlan(makeInput());
    expect(plan).toMatchObject({
      tp1: expect.objectContaining({ source: expect.any(String), price: expect.any(Number) }),
      tp2: expect.objectContaining({ source: expect.any(String), price: expect.any(Number) }),
      runner: expect.objectContaining({ trail_method: expect.any(String) }),
      scaling: expect.objectContaining({
        tp1_pct: expect.any(Number),
        tp2_pct: expect.any(Number),
        runner_pct: expect.any(Number),
      }),
      early_exit_threshold_delta_div: expect.any(Number),
      early_exit_partial_pct: expect.any(Number),
      pre_lunch_threshold_r: expect.any(Number),
      pre_lunch_partial_pct: 0.50,
      audit_payload: expect.objectContaining({
        strategy_id: "test-strategy-id",
        regime: "TRENDING_UP",
        tp1_source: expect.any(String),
        runner_method: expect.any(String),
      }),
    });
  });

  it("45. audit_payload contains all required keys for signal.exit_plan_computed", async () => {
    const plan = await computeExitPlan(makeInput());
    const audit = plan.audit_payload;
    const requiredKeys = [
      "strategy_id", "symbol", "regime", "narrative_phase",
      "tp1_source", "tp1_level_type", "tp1_r_multiple",
      "tp2_source", "tp2_level_type", "tp2_r_multiple",
      "runner_method", "scaling_tp1_pct", "scaling_tp2_pct", "scaling_runner_pct",
      "pre_lunch_threshold_r", "delta_div_threshold",
      "atr", "entry_price", "entry_stop", "entry_direction",
    ];
    for (const key of requiredKeys) {
      expect(audit).toHaveProperty(key);
    }
  });
});
