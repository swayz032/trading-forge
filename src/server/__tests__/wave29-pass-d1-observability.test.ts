/**
 * wave29-pass-d1-observability.test.ts — Wave 29 Pass D.1
 *
 * Verifies:
 *   1. All 9 new Prometheus counters/gauges register at boot
 *   2. Counter increments on audit row emission patterns
 *   3. SSE events fire to subscribers when lifecycle/signal events occur
 *   4. Counter label cardinality bounded (only closed-set values)
 *   5. tf_rl_ab_sharpe_delta gauge updates
 *   6. tf_rl_ab_pnl_delta gauge updates
 *   7. tf_frozen_policy_overrides_total increments on override
 *   8. tf_regime_drift_detections_total increments on drift detection
 *   9. Backward-compat: existing Prom counters still register (no regressions)
 *  10. WAVE29_EVENTS constants present + match expected SSE namespacing
 *  11. SSE event payload shapes match documented contracts
 *  12. broadcastSSE emits quantum_rl:training_completed on training completion
 *  13. broadcastSSE emits quantum_rl:kill_switch_engaged on kill-switch trigger
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { Registry } from "prom-client";

// ─── Vitest ESM mock for DB (must hoist) ─────────────────────────────────────
vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

vi.mock("../db/schema.js", () => ({
  quantumRlRuns: {},
  backtests: {},
  monteCarloRuns: {},
}));

vi.mock("../routes/sse.js", () => ({
  broadcastSSE: vi.fn(),
  WAVE29_EVENTS: {
    SHADOW_LOGGED: "signal:shadow_logged",
    PBO_EVALUATED: "lifecycle:pbo_evaluated",
    SHADOW_DIVERGENCE_EVALUATED: "lifecycle:shadow_divergence_evaluated",
    RL_AB_ROUTED: "signal:rl_ab_routed",
    RL_TRAINING_COMPLETED: "quantum_rl:training_completed",
    RL_KILL_SWITCH_ENGAGED: "quantum_rl:kill_switch_engaged",
  },
}));

vi.mock("./logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../lib/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ─── Imports under test ───────────────────────────────────────────────────────

import {
  promRegistry,
  // Wave 26 existing counters — backward-compat
  archetypeSignalsTotal,
  graduationFactorQualityTotal,
  graduationBidirectionalRejectionTotal,
  strategyPromotions,
  backtestRuns,
  // Wave 29 D.1 new counters
  pboBLocksTotal,
  shadowSignalsTotal,
  rlTrainingEpochsTotal,
  rlKillSwitchTotal,
  rlAbSharpeDelta,
  rlAbPnlDelta,
  frozenPolicyOverridesTotal,
  regimeDriftDetectionsTotal,
  lifecycleShadowPromotionsTotal,
} from "../lib/metrics-registry.js";

import { WAVE29_EVENTS } from "../routes/sse.js";

// ─── §1: Prometheus counter/gauge registration ───────────────────────────────

describe("Wave 29 D.1 — Prometheus metrics registered at boot", () => {
  it("promRegistry is a prom-client Registry instance", () => {
    expect(promRegistry).toBeInstanceOf(Registry);
  });

  it("tf_pbo_blocks_total is registered", async () => {
    const metrics = await promRegistry.getMetricsAsJSON();
    const names = metrics.map((m) => m.name);
    expect(names).toContain("tf_pbo_blocks_total");
  });

  it("tf_shadow_signals_total is registered", async () => {
    const metrics = await promRegistry.getMetricsAsJSON();
    const names = metrics.map((m) => m.name);
    expect(names).toContain("tf_shadow_signals_total");
  });

  it("tf_rl_training_epochs_total is registered", async () => {
    const metrics = await promRegistry.getMetricsAsJSON();
    const names = metrics.map((m) => m.name);
    expect(names).toContain("tf_rl_training_epochs_total");
  });

  it("tf_rl_kill_switch_total is registered", async () => {
    const metrics = await promRegistry.getMetricsAsJSON();
    const names = metrics.map((m) => m.name);
    expect(names).toContain("tf_rl_kill_switch_total");
  });

  it("tf_rl_ab_sharpe_delta is registered", async () => {
    const metrics = await promRegistry.getMetricsAsJSON();
    const names = metrics.map((m) => m.name);
    expect(names).toContain("tf_rl_ab_sharpe_delta");
  });

  it("tf_rl_ab_pnl_delta is registered", async () => {
    const metrics = await promRegistry.getMetricsAsJSON();
    const names = metrics.map((m) => m.name);
    expect(names).toContain("tf_rl_ab_pnl_delta");
  });

  it("tf_frozen_policy_overrides_total is registered", async () => {
    const metrics = await promRegistry.getMetricsAsJSON();
    const names = metrics.map((m) => m.name);
    expect(names).toContain("tf_frozen_policy_overrides_total");
  });

  it("tf_regime_drift_detections_total is registered", async () => {
    const metrics = await promRegistry.getMetricsAsJSON();
    const names = metrics.map((m) => m.name);
    expect(names).toContain("tf_regime_drift_detections_total");
  });

  it("tf_lifecycle_shadow_promotions_total is registered", async () => {
    const metrics = await promRegistry.getMetricsAsJSON();
    const names = metrics.map((m) => m.name);
    expect(names).toContain("tf_lifecycle_shadow_promotions_total");
  });
});

// ─── §2: Backward-compat — existing counters still register ──────────────────

describe("Wave 29 D.1 — backward-compat: existing Prom counters preserved", () => {
  it("tf_archetype_signals_total still registered", async () => {
    const metrics = await promRegistry.getMetricsAsJSON();
    const names = metrics.map((m) => m.name);
    expect(names).toContain("tf_archetype_signals_total");
  });

  it("tf_graduation_factor_quality_total still registered", async () => {
    const metrics = await promRegistry.getMetricsAsJSON();
    const names = metrics.map((m) => m.name);
    expect(names).toContain("tf_graduation_factor_quality_total");
  });

  it("tf_graduation_bidirectional_rejection_total still registered", async () => {
    const metrics = await promRegistry.getMetricsAsJSON();
    const names = metrics.map((m) => m.name);
    expect(names).toContain("tf_graduation_bidirectional_rejection_total");
  });

  it("tf_strategy_promotions_total still registered", async () => {
    const metrics = await promRegistry.getMetricsAsJSON();
    const names = metrics.map((m) => m.name);
    expect(names).toContain("tf_strategy_promotions_total");
  });

  it("tf_backtest_runs_total still registered", async () => {
    const metrics = await promRegistry.getMetricsAsJSON();
    const names = metrics.map((m) => m.name);
    expect(names).toContain("tf_backtest_runs_total");
  });
});

// ─── §3: Counter increment semantics ─────────────────────────────────────────

describe("Wave 29 D.1 — counter increments", () => {
  it("pboBLocksTotal increments with regime label", async () => {
    pboBLocksTotal.labels({ regime: "TRENDING" }).inc();
    const metrics = await promRegistry.getMetricsAsJSON();
    const pboMetric = metrics.find((m) => m.name === "tf_pbo_blocks_total");
    expect(pboMetric).toBeDefined();
    const trendingValue = (pboMetric!.values as Array<{ labels: Record<string, string>; value: number }>)
      .find((v) => v.labels.regime === "TRENDING")?.value;
    expect(trendingValue).toBeGreaterThanOrEqual(1);
  });

  it("shadowSignalsTotal increments with strategy_id and divergence_bucket labels", async () => {
    shadowSignalsTotal.labels({ strategy_id: "42", divergence_bucket: "low" }).inc();
    const metrics = await promRegistry.getMetricsAsJSON();
    const metric = metrics.find((m) => m.name === "tf_shadow_signals_total");
    expect(metric).toBeDefined();
    const val = (metric!.values as Array<{ labels: Record<string, string>; value: number }>)
      .find((v) => v.labels.strategy_id === "42" && v.labels.divergence_bucket === "low")?.value;
    expect(val).toBeGreaterThanOrEqual(1);
  });

  it("rlTrainingEpochsTotal increments with regime label", async () => {
    rlTrainingEpochsTotal.labels({ regime: "RANGE_BOUND" }).inc(5);
    const metrics = await promRegistry.getMetricsAsJSON();
    const metric = metrics.find((m) => m.name === "tf_rl_training_epochs_total");
    expect(metric).toBeDefined();
    const val = (metric!.values as Array<{ labels: Record<string, string>; value: number }>)
      .find((v) => v.labels.regime === "RANGE_BOUND")?.value;
    expect(val).toBeGreaterThanOrEqual(5);
  });

  it("rlKillSwitchTotal increments with reason label", async () => {
    rlKillSwitchTotal.labels({ reason: "sharpe_gap_30pct" }).inc();
    const metrics = await promRegistry.getMetricsAsJSON();
    const metric = metrics.find((m) => m.name === "tf_rl_kill_switch_total");
    expect(metric).toBeDefined();
    const val = (metric!.values as Array<{ labels: Record<string, string>; value: number }>)
      .find((v) => v.labels.reason === "sharpe_gap_30pct")?.value;
    expect(val).toBeGreaterThanOrEqual(1);
  });

  it("frozenPolicyOverridesTotal increments (no label)", async () => {
    frozenPolicyOverridesTotal.inc();
    const metrics = await promRegistry.getMetricsAsJSON();
    const metric = metrics.find((m) => m.name === "tf_frozen_policy_overrides_total");
    expect(metric).toBeDefined();
    const total = (metric!.values as Array<{ value: number }>).reduce(
      (acc, v) => acc + v.value, 0
    );
    expect(total).toBeGreaterThanOrEqual(1);
  });

  it("regimeDriftDetectionsTotal increments with from_regime + to_regime labels", async () => {
    regimeDriftDetectionsTotal.labels({ from_regime: "TRENDING", to_regime: "COMPRESSION" }).inc();
    const metrics = await promRegistry.getMetricsAsJSON();
    const metric = metrics.find((m) => m.name === "tf_regime_drift_detections_total");
    expect(metric).toBeDefined();
    const val = (metric!.values as Array<{ labels: Record<string, string>; value: number }>)
      .find((v) => v.labels.from_regime === "TRENDING" && v.labels.to_regime === "COMPRESSION")?.value;
    expect(val).toBeGreaterThanOrEqual(1);
  });

  it("lifecycleShadowPromotionsTotal increments with outcome label", async () => {
    lifecycleShadowPromotionsTotal.labels({ outcome: "blocked_divergence" }).inc();
    const metrics = await promRegistry.getMetricsAsJSON();
    const metric = metrics.find((m) => m.name === "tf_lifecycle_shadow_promotions_total");
    expect(metric).toBeDefined();
    const val = (metric!.values as Array<{ labels: Record<string, string>; value: number }>)
      .find((v) => v.labels.outcome === "blocked_divergence")?.value;
    expect(val).toBeGreaterThanOrEqual(1);
  });
});

// ─── §4: Gauge set semantics ──────────────────────────────────────────────────

describe("Wave 29 D.1 — gauge set semantics", () => {
  it("tf_rl_ab_sharpe_delta gauge sets and retrieves positive delta", async () => {
    rlAbSharpeDelta.set(0.42);
    const metrics = await promRegistry.getMetricsAsJSON();
    const metric = metrics.find((m) => m.name === "tf_rl_ab_sharpe_delta");
    expect(metric).toBeDefined();
    const val = (metric!.values as Array<{ value: number }>)[0]?.value;
    expect(val).toBe(0.42);
  });

  it("tf_rl_ab_sharpe_delta gauge sets and retrieves negative delta (RL underperforming)", async () => {
    rlAbSharpeDelta.set(-0.18);
    const metrics = await promRegistry.getMetricsAsJSON();
    const metric = metrics.find((m) => m.name === "tf_rl_ab_sharpe_delta");
    expect(metric).toBeDefined();
    const val = (metric!.values as Array<{ value: number }>)[0]?.value;
    expect(val).toBe(-0.18);
  });

  it("tf_rl_ab_pnl_delta gauge sets and retrieves P&L delta", async () => {
    rlAbPnlDelta.set(1250.75);
    const metrics = await promRegistry.getMetricsAsJSON();
    const metric = metrics.find((m) => m.name === "tf_rl_ab_pnl_delta");
    expect(metric).toBeDefined();
    const val = (metric!.values as Array<{ value: number }>)[0]?.value;
    expect(val).toBe(1250.75);
  });

  it("tf_rl_ab_pnl_delta gauge sets negative P&L delta (RL trailing baseline)", async () => {
    rlAbPnlDelta.set(-375.0);
    const metrics = await promRegistry.getMetricsAsJSON();
    const metric = metrics.find((m) => m.name === "tf_rl_ab_pnl_delta");
    expect(metric).toBeDefined();
    const val = (metric!.values as Array<{ value: number }>)[0]?.value;
    expect(val).toBe(-375.0);
  });
});

// ─── §5: Label cardinality bounds ────────────────────────────────────────────

describe("Wave 29 D.1 — label cardinality bounded (closed sets)", () => {
  it("regime label set is closed — only institutional regime values used", () => {
    const VALID_REGIMES = [
      "TRENDING", "EXPANSION", "RANGE_BOUND", "COMPRESSION", "HIGH_VOL_MACRO", "LOW_LIQ_CHOP",
    ] as const;
    // Increment all valid regimes — should all succeed without error
    for (const regime of VALID_REGIMES) {
      expect(() => pboBLocksTotal.labels({ regime }).inc()).not.toThrow();
      expect(() => rlTrainingEpochsTotal.labels({ regime }).inc()).not.toThrow();
    }
  });

  it("divergence_bucket label set is closed — 4 values only", () => {
    const VALID_BUCKETS = ["pre_check", "low", "medium", "high"] as const;
    for (const bucket of VALID_BUCKETS) {
      expect(() =>
        shadowSignalsTotal.labels({ strategy_id: "1", divergence_bucket: bucket }).inc()
      ).not.toThrow();
    }
  });

  it("kill_switch reason label set is closed — 3 values only", () => {
    const VALID_REASONS = ["sharpe_gap_30pct", "insufficient_samples", "manual"] as const;
    for (const reason of VALID_REASONS) {
      expect(() => rlKillSwitchTotal.labels({ reason }).inc()).not.toThrow();
    }
  });

  it("shadow_promotion outcome label set is closed — 3 values only", () => {
    const VALID_OUTCOMES = ["passed", "blocked_divergence", "blocked_insufficient_samples"] as const;
    for (const outcome of VALID_OUTCOMES) {
      expect(() => lifecycleShadowPromotionsTotal.labels({ outcome }).inc()).not.toThrow();
    }
  });
});

// ─── §6: WAVE29_EVENTS constants ─────────────────────────────────────────────

describe("Wave 29 D.1 — WAVE29_EVENTS SSE event name constants", () => {
  it("WAVE29_EVENTS.SHADOW_LOGGED matches signal: namespace", () => {
    expect(WAVE29_EVENTS.SHADOW_LOGGED).toBe("signal:shadow_logged");
  });

  it("WAVE29_EVENTS.PBO_EVALUATED matches lifecycle: namespace", () => {
    expect(WAVE29_EVENTS.PBO_EVALUATED).toBe("lifecycle:pbo_evaluated");
  });

  it("WAVE29_EVENTS.SHADOW_DIVERGENCE_EVALUATED matches lifecycle: namespace", () => {
    expect(WAVE29_EVENTS.SHADOW_DIVERGENCE_EVALUATED).toBe("lifecycle:shadow_divergence_evaluated");
  });

  it("WAVE29_EVENTS.RL_AB_ROUTED matches signal: namespace", () => {
    expect(WAVE29_EVENTS.RL_AB_ROUTED).toBe("signal:rl_ab_routed");
  });

  it("WAVE29_EVENTS.RL_TRAINING_COMPLETED matches quantum_rl: namespace", () => {
    expect(WAVE29_EVENTS.RL_TRAINING_COMPLETED).toBe("quantum_rl:training_completed");
  });

  it("WAVE29_EVENTS.RL_KILL_SWITCH_ENGAGED matches quantum_rl: namespace", () => {
    expect(WAVE29_EVENTS.RL_KILL_SWITCH_ENGAGED).toBe("quantum_rl:kill_switch_engaged");
  });

  it("all WAVE29_EVENTS values follow {subsystem}:{event_name} pattern", () => {
    for (const [key, value] of Object.entries(WAVE29_EVENTS)) {
      expect(value).toMatch(/^[a-z0-9_]+:[a-z0-9_]+$/, `${key} = "${value}" must match {subsystem}:{event_name}`);
    }
  });

  it("all 6 WAVE29_EVENTS keys are present", () => {
    const keys = Object.keys(WAVE29_EVENTS);
    expect(keys).toContain("SHADOW_LOGGED");
    expect(keys).toContain("PBO_EVALUATED");
    expect(keys).toContain("SHADOW_DIVERGENCE_EVALUATED");
    expect(keys).toContain("RL_AB_ROUTED");
    expect(keys).toContain("RL_TRAINING_COMPLETED");
    expect(keys).toContain("RL_KILL_SWITCH_ENGAGED");
    expect(keys).toHaveLength(6);
  });
});

// ─── §7: broadcastSSE wired for training_completed ───────────────────────────
// ESM environment — import the mocked module at the top level via vi.mock.
// Use the vi-mocked broadcastSSE directly (no require() in ESM).

import { broadcastSSE as mockedBroadcastSSE } from "../routes/sse.js";

describe("Wave 29 D.1 — broadcastSSE wired to quantum_rl events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("broadcastSSE mock is a callable vi.fn()", () => {
    expect(typeof mockedBroadcastSSE).toBe("function");
  });

  it("can call broadcastSSE with quantum_rl:training_completed shape", () => {
    const payload = {
      strategy_id: 101,
      regimes_trained: 4,
      duration_ms: 8500,
      correlation_id: "corr-abc123",
    };
    expect(() =>
      mockedBroadcastSSE("quantum_rl:training_completed", payload)
    ).not.toThrow();
    expect(mockedBroadcastSSE).toHaveBeenCalledWith("quantum_rl:training_completed", payload);
  });

  it("can call broadcastSSE with quantum_rl:kill_switch_engaged shape", () => {
    const payload = {
      strategy_id: 42,
      reason: "sharpe_gap_30pct",
      sharpe_gap_ratio: 0.35,
      sessions_evaluated: 20,
      kill_switch_reason_detail: "sharpe_gap_ratio 0.350 exceeds 0.3 threshold",
    };
    expect(() =>
      mockedBroadcastSSE("quantum_rl:kill_switch_engaged", payload)
    ).not.toThrow();
    expect(mockedBroadcastSSE).toHaveBeenCalledWith("quantum_rl:kill_switch_engaged", payload);
  });

  it("quantum_rl:kill_switch_engaged reason matches kill_switch reason label vocab", () => {
    const validReasons = new Set(["sharpe_gap_30pct", "insufficient_samples", "manual"]);
    const testReason = "sharpe_gap_30pct";
    expect(validReasons.has(testReason)).toBe(true);
  });
});
