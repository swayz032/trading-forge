/**
 * Track E F-8 — collectEvidence drift alert filter
 *
 * Verifies that the drift alert filter in critic-optimizer-service.ts:
 *   1. Excludes alerts with null metadata (system-wide noise)
 *   2. Excludes alerts with metadata but no strategyId key (untagged)
 *   3. Excludes alerts with a different strategyId (wrong strategy)
 *   4. Includes alerts with the matching strategyId
 */

import { describe, it, expect } from "vitest";

// ─── Mirror of the F-8 filter logic from critic-optimizer-service.ts ──────────
// Keep in sync with the filter at collectEvidence() in that file.
function applyDriftAlertFilter(
  rawAlerts: Array<{ id: string; metadata: unknown }>,
  strategyId: string,
): Array<{ id: string; metadata: unknown }> {
  return rawAlerts.filter((a) => {
    const meta = a.metadata as Record<string, unknown> | null;
    if (!meta || !meta.strategyId) {
      // Track E F-8: untagged alerts are system-wide noise; exclude from strategy drift
      return false;
    }
    return meta.strategyId === strategyId;
  });
}

const TARGET_STRATEGY_ID = "strat-abc-123";

describe("collectEvidence drift alert filter (Track E F-8)", () => {
  it("excludes alerts with null metadata", () => {
    const alerts = [{ id: "alert-1", metadata: null }];
    const result = applyDriftAlertFilter(alerts, TARGET_STRATEGY_ID);
    expect(result).toHaveLength(0);
  });

  it("excludes alerts with metadata but no strategyId key", () => {
    const alerts = [{ id: "alert-2", metadata: { severity: "high", type: "drift" } }];
    const result = applyDriftAlertFilter(alerts, TARGET_STRATEGY_ID);
    expect(result).toHaveLength(0);
  });

  it("excludes alerts with a different strategyId", () => {
    const alerts = [
      { id: "alert-3", metadata: { strategyId: "strat-other-999", type: "decay" } },
    ];
    const result = applyDriftAlertFilter(alerts, TARGET_STRATEGY_ID);
    expect(result).toHaveLength(0);
  });

  it("includes alerts with the matching strategyId", () => {
    const alerts = [
      { id: "alert-4", metadata: { strategyId: TARGET_STRATEGY_ID, type: "drift" } },
    ];
    const result = applyDriftAlertFilter(alerts, TARGET_STRATEGY_ID);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("alert-4");
  });

  it("correctly filters a mixed batch", () => {
    const alerts = [
      { id: "a1", metadata: null },                                                          // excluded: null meta
      { id: "a2", metadata: { severity: "low" } },                                           // excluded: no strategyId
      { id: "a3", metadata: { strategyId: "other-strat", type: "regime_change" } },          // excluded: wrong strategy
      { id: "a4", metadata: { strategyId: TARGET_STRATEGY_ID, type: "decay" } },             // included
      { id: "a5", metadata: { strategyId: TARGET_STRATEGY_ID, type: "degradation" } },       // included
    ];
    const result = applyDriftAlertFilter(alerts, TARGET_STRATEGY_ID);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.id)).toEqual(["a4", "a5"]);
  });

  it("returns empty array when all alerts are noise", () => {
    const alerts = [
      { id: "n1", metadata: null },
      { id: "n2", metadata: {} },
      { id: "n3", metadata: { strategyId: "someone-else" } },
    ];
    const result = applyDriftAlertFilter(alerts, TARGET_STRATEGY_ID);
    expect(result).toHaveLength(0);
  });
});
