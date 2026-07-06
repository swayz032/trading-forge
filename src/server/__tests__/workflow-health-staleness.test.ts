import { describe, expect, it } from "vitest";

import {
  buildWorkflowInventoryFromStems,
  normalizeWorkflowHealth,
  resolveWorkflowStaleMaxAgeHours,
} from "../lib/system-topology.js";

/**
 * Deep-scan #21 (2026-07-05, certified finding #1): `normalizeWorkflowHealth()`
 * previously checked only `lastSuccessAt == null` and never AGE, so a workflow whose
 * last recorded success was 91-106 days old reported `healthStatus: "healthy"` —
 * identical to one that ran 6 minutes ago. `docs/trading-forge-live-workflows.json`
 * had a `generatedAt` 93+ days stale as a direct symptom.
 *
 * These tests pin the fix: a workflow with an old-but-present `lastSuccessAt` must
 * report "stale", not "healthy", while a fresh one still reports "healthy". `nowMs`
 * is passed in explicitly (never `Date.now()` inside the pure core) so this stays
 * deterministic and replay-safe.
 */
describe("workflow health staleness ceiling", () => {
  const HOUR_MS = 60 * 60 * 1000;
  const DAY_MS = 24 * HOUR_MS;
  const NOW = Date.parse("2026-07-05T12:00:00.000Z");

  it("reports a fresh success as healthy", () => {
    const result = normalizeWorkflowHealth(
      { lastSuccessAt: new Date(NOW - 6 * 60 * 1000).toISOString(), lastFailureAt: null },
      true,
      NOW,
    );

    expect(result.healthStatus).toBe("healthy");
  });

  it("reports a 6-minute-old success as healthy under the default 192h ceiling", () => {
    const result = normalizeWorkflowHealth(
      { lastSuccessAt: new Date(NOW - 6 * 60 * 1000).toISOString(), lastFailureAt: null },
      true,
      NOW,
    );

    expect(result.healthStatus).toBe("healthy");
    expect(result.notes.some((note) => note.includes("staleness ceiling"))).toBe(false);
  });

  it("reports a 93-day-old success as stale, not healthy (the certified deep-scan #21 bug)", () => {
    const ninetyThreeDaysAgo = new Date(NOW - 93 * DAY_MS).toISOString();

    const result = normalizeWorkflowHealth(
      { lastSuccessAt: ninetyThreeDaysAgo, lastFailureAt: null },
      true,
      NOW,
    );

    expect(result.healthStatus).toBe("stale");
    expect(result.healthStatus).not.toBe("healthy");
    expect(result.notes.some((note) => note.includes("staleness ceiling"))).toBe(true);
  });

  it("uses the default 192h (8-day) ceiling when no override is supplied", () => {
    const justUnderCeiling = normalizeWorkflowHealth(
      { lastSuccessAt: new Date(NOW - (192 * HOUR_MS - HOUR_MS)).toISOString(), lastFailureAt: null },
      true,
      NOW,
    );
    const justOverCeiling = normalizeWorkflowHealth(
      { lastSuccessAt: new Date(NOW - (192 * HOUR_MS + HOUR_MS)).toISOString(), lastFailureAt: null },
      true,
      NOW,
    );

    expect(justUnderCeiling.healthStatus).toBe("healthy");
    expect(justOverCeiling.healthStatus).toBe("stale");
  });

  it("honors a per-workflow staleAfterHours override (monthly-cadence workflows)", () => {
    // 20 days old — would be "stale" under the 192h/8d default, but this workflow
    // declares an 840h (35-day) override to match its monthly cron cadence.
    const twentyDaysAgo = new Date(NOW - 20 * DAY_MS).toISOString();

    const withoutOverride = normalizeWorkflowHealth(
      { lastSuccessAt: twentyDaysAgo, lastFailureAt: null },
      true,
      NOW,
    );
    const withOverride = normalizeWorkflowHealth(
      { lastSuccessAt: twentyDaysAgo, lastFailureAt: null, staleAfterHours: 840 },
      true,
      NOW,
    );

    expect(withoutOverride.healthStatus).toBe("stale");
    expect(withOverride.healthStatus).toBe("healthy");
  });

  it("still reports unknown for active workflows with no success timestamp (regression guard)", () => {
    const result = normalizeWorkflowHealth({ lastSuccessAt: null, lastFailureAt: null }, true, NOW);

    expect(result.healthStatus).toBe("unknown");
  });

  it("still reports failing when explicitly marked failing, even if fresh", () => {
    const result = normalizeWorkflowHealth(
      {
        healthStatus: "failing",
        lastSuccessAt: new Date(NOW - 6 * 60 * 1000).toISOString(),
        lastFailureAt: new Date(NOW - 60 * 1000).toISOString(),
      },
      true,
      NOW,
    );

    expect(result.healthStatus).toBe("failing");
  });

  it("does not classify inactive (built-inactive) workflows as stale", () => {
    const result = normalizeWorkflowHealth(
      { lastSuccessAt: new Date(NOW - 200 * DAY_MS).toISOString(), lastFailureAt: null },
      false,
      NOW,
    );

    expect(result.healthStatus).toBe("healthy");
  });

  it("resolveWorkflowStaleMaxAgeHours defaults to 192 and respects env override", () => {
    expect(resolveWorkflowStaleMaxAgeHours({})).toBe(192);
    expect(resolveWorkflowStaleMaxAgeHours({ WORKFLOW_STALE_MAX_AGE_HOURS: "48" })).toBe(48);
    expect(resolveWorkflowStaleMaxAgeHours({ WORKFLOW_STALE_MAX_AGE_HOURS: "not-a-number" })).toBe(192);
    expect(resolveWorkflowStaleMaxAgeHours({ WORKFLOW_STALE_MAX_AGE_HOURS: "-5" })).toBe(192);
  });

  it("end-to-end via buildWorkflowInventoryFromStems: a 100-day-stale manifest entry surfaces as stale in the workflow inventory", () => {
    const canonicalStem = "0A_health_monitor_DGEk1D478xWJClKD";
    const hundredDaysAgo = new Date(NOW - 100 * DAY_MS).toISOString();

    const summary = buildWorkflowInventoryFromStems(
      [canonicalStem],
      new Set([canonicalStem]),
      new Map([[canonicalStem, { lastSuccessAt: hundredDaysAgo, lastFailureAt: null }]]),
      new Map(),
      NOW,
    );

    expect(summary.items).toHaveLength(1);
    expect(summary.items[0]!.healthStatus).toBe("stale");
    expect(summary.items[0]!.healthStatus).not.toBe("healthy");
  });
});
