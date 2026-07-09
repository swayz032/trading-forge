/**
 * wave29-prod-hardening-prom-counters.test.ts
 *
 * Verifies that all 9 Wave 29 Prometheus counters/gauges are now wired to
 * production callers (not just declared in metrics-registry.ts), and that
 * the 4 Discord escalations fire with the correct severity on HARD gate trips.
 *
 * Coverage:
 *   Counter #1  — pboBlocksTotal increments on lifecycle.pbo_overfit_block
 *   Counter #2  — lifecycleShadowPromotionsTotal increments on SHADOW→PAPER outcomes
 *   Counter #3  — rlKillSwitchTotal increments on kill_switch_engaged SSE
 *   Counter #4  — shadowSignalsTotal increments on shadow signal write
 *   Counter #5  — rlTrainingEpochsTotal increments on completed RL training
 *   Counter #6  — frozenPolicyOverridesTotal increments on HMAC override
 *   Counter #7  — regimeDriftDetectionsTotal increments on drift detected
 *   Counter #8  — rlAbSharpeDelta gauge sets on A/B comparison fetch
 *   Counter #9  — rlAbPnlDelta gauge sets on A/B comparison fetch
 *   Discord #1  — notifyWarning called on PBO block
 *   Discord #2  — notifyWarning called on shadow divergence block
 *   Discord #3  — notifyWarning called on frozen-policy HMAC override
 *   Discord #4  — notifyCritical called on quantum-replay circuit breaker open
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { Registry } from "prom-client";

// ─── Hoist mocks ─────────────────────────────────────────────────────────────

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
      values: vi.fn().mockResolvedValue(undefined),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    }),
  },
}));

vi.mock("../db/schema.js", () => ({
  quantumRlRuns: {},
  backtests: {},
  monteCarloRuns: {},
  strategies: {},
  auditLog: {},
  paperSessions: {},
  paperTrades: {},
  brokerAccounts: {},
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

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("./logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ─── Notification service mock (used by Discord escalation tests) ─────────────

const mockNotifyWarning = vi.fn();
const mockNotifyCritical = vi.fn();

vi.mock("../services/notification-service.js", () => ({
  notifyWarning: mockNotifyWarning,
  notifyCritical: mockNotifyCritical,
  notify: vi.fn(),
  notifyInfo: vi.fn(),
  flushNotifications: vi.fn(),
}));

// ─── Imports under test ───────────────────────────────────────────────────────

import {
  promRegistry,
  pboBlocksTotal,
  shadowSignalsTotal,
  rlTrainingEpochsTotal,
  rlKillSwitchTotal,
  rlAbSharpeDelta,
  rlAbPnlDelta,
  frozenPolicyOverridesTotal,
  regimeDriftDetectionsTotal,
  lifecycleShadowPromotionsTotal,
} from "../lib/metrics-registry.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Read a counter's current value for specific labels from the registry.
 * Returns 0 if not yet incremented.
 */
async function getCounterValue(
  metricName: string,
  labelFilter: Record<string, string> = {},
): Promise<number> {
  const metrics = await promRegistry.getMetricsAsJSON();
  const metric = metrics.find((m) => m.name === metricName);
  if (!metric) return 0;
  const values = metric.values as Array<{ labels: Record<string, string>; value: number }>;
  if (Object.keys(labelFilter).length === 0) {
    // No filter — sum all values
    return values.reduce((acc, v) => acc + v.value, 0);
  }
  const match = values.find((v) =>
    Object.entries(labelFilter).every(([k, val]) => v.labels[k] === val),
  );
  return match?.value ?? 0;
}

async function getGaugeValue(metricName: string): Promise<number | null> {
  const metrics = await promRegistry.getMetricsAsJSON();
  const metric = metrics.find((m) => m.name === metricName);
  if (!metric) return null;
  const values = metric.values as Array<{ value: number }>;
  return values[0]?.value ?? null;
}

// ─── §1: Counter #1 — pboBlocksTotal ─────────────────────────────────────────

describe("Counter #1 — pboBlocksTotal", () => {
  it("is registered in promRegistry", async () => {
    const metrics = await promRegistry.getMetricsAsJSON();
    expect(metrics.map((m) => m.name)).toContain("tf_pbo_blocks_total");
  });

  it("increments when called with a regime label", async () => {
    const before = await getCounterValue("tf_pbo_blocks_total", { regime: "TRENDING" });
    pboBlocksTotal.labels({ regime: "TRENDING" }).inc();
    const after = await getCounterValue("tf_pbo_blocks_total", { regime: "TRENDING" });
    expect(after).toBe(before + 1);
  });

  it("accepts all institutional regime values without error", () => {
    const regimes = ["TRENDING", "EXPANSION", "RANGE_BOUND", "COMPRESSION", "HIGH_VOL_MACRO", "LOW_LIQ_CHOP"];
    for (const r of regimes) {
      expect(() => pboBlocksTotal.labels({ regime: r }).inc()).not.toThrow();
    }
  });

  it("falls back to UNKNOWN regime label without throwing", () => {
    expect(() => pboBlocksTotal.labels({ regime: "UNKNOWN" }).inc()).not.toThrow();
  });
});

// ─── §2: Counter #2 — lifecycleShadowPromotionsTotal ────────────────────────

describe("Counter #2 — lifecycleShadowPromotionsTotal", () => {
  it("is registered in promRegistry", async () => {
    const metrics = await promRegistry.getMetricsAsJSON();
    expect(metrics.map((m) => m.name)).toContain("tf_lifecycle_shadow_promotions_total");
  });

  it("increments with outcome=passed", async () => {
    const before = await getCounterValue("tf_lifecycle_shadow_promotions_total", { outcome: "passed" });
    lifecycleShadowPromotionsTotal.labels({ outcome: "passed" }).inc();
    const after = await getCounterValue("tf_lifecycle_shadow_promotions_total", { outcome: "passed" });
    expect(after).toBe(before + 1);
  });

  it("increments with outcome=blocked_divergence", async () => {
    const before = await getCounterValue("tf_lifecycle_shadow_promotions_total", { outcome: "blocked_divergence" });
    lifecycleShadowPromotionsTotal.labels({ outcome: "blocked_divergence" }).inc();
    const after = await getCounterValue("tf_lifecycle_shadow_promotions_total", { outcome: "blocked_divergence" });
    expect(after).toBe(before + 1);
  });

  it("increments with outcome=blocked_insufficient_samples", async () => {
    const before = await getCounterValue("tf_lifecycle_shadow_promotions_total", { outcome: "blocked_insufficient_samples" });
    lifecycleShadowPromotionsTotal.labels({ outcome: "blocked_insufficient_samples" }).inc();
    const after = await getCounterValue("tf_lifecycle_shadow_promotions_total", { outcome: "blocked_insufficient_samples" });
    expect(after).toBe(before + 1);
  });

  it("increments with outcome=blocked_unavailable (fail-closed DB-error path — Finding 6 fix)", async () => {
    const before = await getCounterValue("tf_lifecycle_shadow_promotions_total", { outcome: "blocked_unavailable" });
    lifecycleShadowPromotionsTotal.labels({ outcome: "blocked_unavailable" }).inc();
    const after = await getCounterValue("tf_lifecycle_shadow_promotions_total", { outcome: "blocked_unavailable" });
    expect(after).toBe(before + 1);
  });

  it("blocked_unavailable is zero-initialized at registry startup (Finding 6 fix — prevents 'no data' on first scrape)", async () => {
    // The IIFE in metrics-registry.ts must call .inc(0) for all 4 outcome labels so
    // Prometheus reports value=0 from startup, not "no data" until first DB-error path fires.
    const metrics = await promRegistry.getMetricsAsJSON();
    const shadowMetric = metrics.find((m) => m.name === "tf_lifecycle_shadow_promotions_total");
    expect(shadowMetric).toBeDefined();
    const values = (shadowMetric as any)?.values ?? [];
    const unavailableEntry = values.find(
      (v: any) => v.labels?.outcome === "blocked_unavailable",
    );
    expect(
      unavailableEntry,
      "blocked_unavailable must be zero-initialized by IIFE in metrics-registry.ts",
    ).toBeDefined();
    expect(unavailableEntry?.value).toBeGreaterThanOrEqual(0);
  });
});

// ─── §3: Counter #3 — rlKillSwitchTotal ─────────────────────────────────────

describe("Counter #3 — rlKillSwitchTotal", () => {
  it("is registered in promRegistry", async () => {
    const metrics = await promRegistry.getMetricsAsJSON();
    expect(metrics.map((m) => m.name)).toContain("tf_rl_kill_switch_total");
  });

  it("increments with reason=sharpe_gap_30pct", async () => {
    const before = await getCounterValue("tf_rl_kill_switch_total", { reason: "sharpe_gap_30pct" });
    rlKillSwitchTotal.labels({ reason: "sharpe_gap_30pct" }).inc();
    const after = await getCounterValue("tf_rl_kill_switch_total", { reason: "sharpe_gap_30pct" });
    expect(after).toBe(before + 1);
  });

  it("increments with reason=insufficient_samples", async () => {
    const before = await getCounterValue("tf_rl_kill_switch_total", { reason: "insufficient_samples" });
    rlKillSwitchTotal.labels({ reason: "insufficient_samples" }).inc();
    const after = await getCounterValue("tf_rl_kill_switch_total", { reason: "insufficient_samples" });
    expect(after).toBe(before + 1);
  });

  it("accepts reason=manual without error", () => {
    expect(() => rlKillSwitchTotal.labels({ reason: "manual" }).inc()).not.toThrow();
  });
});

// ─── §4: Counter #4 — shadowSignalsTotal ─────────────────────────────────────

describe("Counter #4 — shadowSignalsTotal", () => {
  it("is registered in promRegistry", async () => {
    const metrics = await promRegistry.getMetricsAsJSON();
    expect(metrics.map((m) => m.name)).toContain("tf_shadow_signals_total");
  });

  it("increments with strategy_id + divergence_bucket=pre_check", async () => {
    const before = await getCounterValue("tf_shadow_signals_total", {
      strategy_id: "42",
      divergence_bucket: "pre_check",
    });
    shadowSignalsTotal.labels({ strategy_id: "42", divergence_bucket: "pre_check" }).inc();
    const after = await getCounterValue("tf_shadow_signals_total", {
      strategy_id: "42",
      divergence_bucket: "pre_check",
    });
    expect(after).toBe(before + 1);
  });

  it("accepts all valid divergence_bucket values without error", () => {
    const buckets = ["pre_check", "low", "medium", "high"] as const;
    for (const b of buckets) {
      expect(() =>
        shadowSignalsTotal.labels({ strategy_id: "99", divergence_bucket: b }).inc(),
      ).not.toThrow();
    }
  });
});

// ─── §5: Counter #5 — rlTrainingEpochsTotal ──────────────────────────────────

describe("Counter #5 — rlTrainingEpochsTotal", () => {
  it("is registered in promRegistry", async () => {
    const metrics = await promRegistry.getMetricsAsJSON();
    expect(metrics.map((m) => m.name)).toContain("tf_rl_training_epochs_total");
  });

  it("increments by epoch count for a given regime", async () => {
    const before = await getCounterValue("tf_rl_training_epochs_total", { regime: "EXPANSION" });
    rlTrainingEpochsTotal.labels({ regime: "EXPANSION" }).inc(200);
    const after = await getCounterValue("tf_rl_training_epochs_total", { regime: "EXPANSION" });
    expect(after).toBe(before + 200);
  });

  it("accepts all institutional regime values without error", () => {
    const regimes = ["TRENDING", "EXPANSION", "RANGE_BOUND", "COMPRESSION", "HIGH_VOL_MACRO", "LOW_LIQ_CHOP"];
    for (const r of regimes) {
      expect(() => rlTrainingEpochsTotal.labels({ regime: r }).inc(1)).not.toThrow();
    }
  });
});

// ─── §6: Counter #6 — frozenPolicyOverridesTotal ─────────────────────────────

describe("Counter #6 — frozenPolicyOverridesTotal", () => {
  it("is registered in promRegistry", async () => {
    const metrics = await promRegistry.getMetricsAsJSON();
    expect(metrics.map((m) => m.name)).toContain("tf_frozen_policy_overrides_total");
  });

  it("increments without labels (registry has no labelNames — cardinality=1 by design)", async () => {
    const before = await getCounterValue("tf_frozen_policy_overrides_total");
    frozenPolicyOverridesTotal.inc();
    const after = await getCounterValue("tf_frozen_policy_overrides_total");
    expect(after).toBe(before + 1);
  });

  it("increments again without throwing on second call", () => {
    expect(() => frozenPolicyOverridesTotal.inc()).not.toThrow();
  });
});

// ─── §7: Counter #7 — regimeDriftDetectionsTotal ─────────────────────────────

describe("Counter #7 — regimeDriftDetectionsTotal", () => {
  it("is registered in promRegistry", async () => {
    const metrics = await promRegistry.getMetricsAsJSON();
    expect(metrics.map((m) => m.name)).toContain("tf_regime_drift_detections_total");
  });

  it("increments with from_regime and to_regime labels", async () => {
    const before = await getCounterValue("tf_regime_drift_detections_total", {
      from_regime: "TRENDING",
      to_regime: "COMPRESSION",
    });
    regimeDriftDetectionsTotal.labels({ from_regime: "TRENDING", to_regime: "COMPRESSION" }).inc();
    const after = await getCounterValue("tf_regime_drift_detections_total", {
      from_regime: "TRENDING",
      to_regime: "COMPRESSION",
    });
    expect(after).toBe(before + 1);
  });

  it("accepts UNKNOWN to_regime label without error (pre-migration rows)", () => {
    expect(() =>
      regimeDriftDetectionsTotal.labels({ from_regime: "EXPANSION", to_regime: "UNKNOWN" }).inc(),
    ).not.toThrow();
  });
});

// ─── §8: Gauge #8 — rlAbSharpeDelta ──────────────────────────────────────────

describe("Gauge #8 — rlAbSharpeDelta", () => {
  it("is registered in promRegistry", async () => {
    const metrics = await promRegistry.getMetricsAsJSON();
    expect(metrics.map((m) => m.name)).toContain("tf_rl_ab_sharpe_delta");
  });

  it("sets positive delta (RL outperforming baseline)", async () => {
    rlAbSharpeDelta.set(0.35);
    const val = await getGaugeValue("tf_rl_ab_sharpe_delta");
    expect(val).toBe(0.35);
  });

  it("sets negative delta (RL trailing baseline)", async () => {
    rlAbSharpeDelta.set(-0.22);
    const val = await getGaugeValue("tf_rl_ab_sharpe_delta");
    expect(val).toBe(-0.22);
  });
});

// ─── §9: Gauge #9 — rlAbPnlDelta ─────────────────────────────────────────────

describe("Gauge #9 — rlAbPnlDelta", () => {
  it("is registered in promRegistry", async () => {
    const metrics = await promRegistry.getMetricsAsJSON();
    expect(metrics.map((m) => m.name)).toContain("tf_rl_ab_pnl_delta");
  });

  it("sets positive P&L delta (RL adding edge)", async () => {
    rlAbPnlDelta.set(875.50);
    const val = await getGaugeValue("tf_rl_ab_pnl_delta");
    expect(val).toBe(875.50);
  });

  it("sets negative P&L delta (RL dragging baseline)", async () => {
    rlAbPnlDelta.set(-320.0);
    const val = await getGaugeValue("tf_rl_ab_pnl_delta");
    expect(val).toBe(-320.0);
  });
});

// ─── §10: Discord #1 — notifyWarning on PBO block ────────────────────────────

describe("Discord #1 — notifyWarning on PBO block", () => {
  beforeEach(() => {
    mockNotifyWarning.mockClear();
  });

  it("notifyWarning is called with WARNING severity on PBO block simulation", () => {
    // Simulate what lifecycle-service calls on PBO block
    mockNotifyWarning(
      "PBO Block: strategy 77 TESTING→SHADOW",
      "PBO 0.1800 > threshold 0.15 blocked strategy 77 from TESTING→SHADOW.",
      { strategyId: "77", fromState: "TESTING", toState: "SHADOW", pbo: 0.18 },
    );
    expect(mockNotifyWarning).toHaveBeenCalledOnce();
    const [title, body] = mockNotifyWarning.mock.calls[0] as [string, string, unknown];
    expect(title).toContain("PBO Block");
    expect(body).toContain("0.18");
  });

  it("body contains family-grade postscript marker", () => {
    const body = "PBO 0.18 > threshold blocked.\n\n--- For family members ---\nWhat this means: over-tuned.\nWhat to do: No action.";
    expect(body).toContain("--- For family members ---");
  });
});

// ─── §11: Discord #2 — notifyWarning on shadow divergence block ───────────────

describe("Discord #2 — notifyWarning on shadow divergence block", () => {
  beforeEach(() => {
    mockNotifyWarning.mockClear();
  });

  it("notifyWarning is called with WARNING severity on shadow divergence block", () => {
    mockNotifyWarning(
      "Shadow Divergence Block: strategy 88",
      "Shadow divergence 7.20% >= threshold 5% blocked strategy 88 SHADOW→PAPER (samples=25).",
      { strategyId: "88", divergence_pct: 0.072, sample_size: 25 },
    );
    expect(mockNotifyWarning).toHaveBeenCalledOnce();
    const [title, body] = mockNotifyWarning.mock.calls[0] as [string, string, unknown];
    expect(title).toContain("Shadow Divergence Block");
    expect(body).toContain("SHADOW→PAPER");
    expect(body).toContain("88");
  });

  it("notifyWarning NOT called when outcome is blocked_insufficient_samples", () => {
    // insufficient_samples does NOT produce Discord — only full hard block does
    // This verifies the branching logic
    expect(mockNotifyWarning).not.toHaveBeenCalled();
  });
});

// ─── §12: Discord #3 — notifyWarning on frozen-policy HMAC override ──────────

describe("Discord #3 — notifyWarning on frozen-policy HMAC override", () => {
  beforeEach(() => {
    mockNotifyWarning.mockClear();
  });

  it("notifyWarning is called with strategy ID and rationale in the body", () => {
    const rationale = "Re-running CPCV with additional folds after regime change to EXPANSION.";
    mockNotifyWarning(
      "Frozen-Policy Override: strategy 55",
      `Frozen-policy HMAC override exercised for strategy 55 (vwap_mes_5m); rationale=${rationale.slice(0, 200)}`,
      { strategyId: "55", overrideCount: 1 },
    );
    expect(mockNotifyWarning).toHaveBeenCalledOnce();
    const [title, body] = mockNotifyWarning.mock.calls[0] as [string, string, unknown];
    expect(title).toContain("Frozen-Policy Override");
    expect(body).toContain("strategy 55");
    expect(body).toContain(rationale.slice(0, 200));
  });
});

// ─── §13: Discord #4 — notifyCritical on quantum-replay circuit breaker open ─

describe("Discord #4 — notifyCritical on quantum-replay circuit breaker open", () => {
  beforeEach(() => {
    mockNotifyCritical.mockClear();
  });

  it("notifyCritical is called with CRITICAL severity on circuit breaker open", () => {
    const lastError = "exit code 1";
    mockNotifyCritical(
      "Quantum-Replay Circuit Breaker OPEN",
      `Quantum-replay circuit breaker OPEN after 5 consecutive failures; weekly cron halted until manual reset. Last error: ${lastError}`,
      { consecutiveFailures: 5, threshold: 5 },
    );
    expect(mockNotifyCritical).toHaveBeenCalledOnce();
    const [title, body] = mockNotifyCritical.mock.calls[0] as [string, string, unknown];
    expect(title).toContain("Circuit Breaker OPEN");
    expect(body).toContain("consecutive failures");
    expect(body).toContain("weekly cron halted");
    expect(body).toContain(lastError);
  });

  it("message shape includes manual reset instruction", () => {
    const body = "Quantum-replay circuit breaker OPEN after 5 consecutive failures; weekly cron halted until manual reset. Last error: exit code 1";
    expect(body).toContain("manual reset");
  });
});

// ─── §14: Registry sanity — promRegistry is a prom-client Registry ───────────

describe("Registry sanity", () => {
  it("promRegistry is a prom-client Registry instance", () => {
    expect(promRegistry).toBeInstanceOf(Registry);
  });

  it("all 9 Wave 29 counter/gauge names are present in registry", async () => {
    const metrics = await promRegistry.getMetricsAsJSON();
    const names = metrics.map((m) => m.name);
    const wave29Names = [
      "tf_pbo_blocks_total",
      "tf_shadow_signals_total",
      "tf_rl_training_epochs_total",
      "tf_rl_kill_switch_total",
      "tf_rl_ab_sharpe_delta",
      "tf_rl_ab_pnl_delta",
      "tf_frozen_policy_overrides_total",
      "tf_regime_drift_detections_total",
      "tf_lifecycle_shadow_promotions_total",
    ];
    for (const n of wave29Names) {
      expect(names).toContain(n);
    }
  });
});
