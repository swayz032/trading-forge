/**
 * cross-asset-context.test.ts — Confluence HIGH-1 (deep-scan 2026-07-09, ratified)
 *
 * RED-proof for the cross_asset_aligned live-wiring fix. Before the fix,
 * paper-signal-service.ts never populated dxyDirection / us10yDirection /
 * cross_asset_age_hours on the Path C weightedCtx, so evalCrossAssetAligned
 * returned "cross_asset_data_unavailable" (satisfied=false) on EVERY live/paper
 * signal — the factor was documented-active but permanently dead.
 *
 * This locks the pure seam (`resolveCrossAssetContext`) that paper-signal-service
 * now calls, PLUS an end-to-end assertion that feeding a real pre-market row
 * through the resolver into evaluateWeightedConfluence actually lights up the
 * factor (satisfied=true) — the behavior that was impossible pre-fix.
 *
 * DB / audit / internals are mocked identically to wave25-vwap-smt-wiring.test.ts
 * so the confluence-score import graph stays pure.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../../db/index.js", () => ({ db: {} }));
vi.mock("../../db/schema.js", () => ({}));
vi.mock("../audit-log-helper.js", () => ({
  insertAuditRow: vi.fn().mockResolvedValue(undefined),
  insertAuditRowSafe: vi.fn().mockResolvedValue(true),
}));
vi.mock("../../services/market-internals-service.js", () => ({
  getInternalsSnapshot: vi.fn().mockReturnValue({
    tick: null, add: null, vold: null, trin: null, asOf: new Date(), stale: true,
  }),
}));

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { resolveCrossAssetContext } from "../cross-asset-context.js";
import {
  evaluateWeightedConfluence,
  FACTOR_CROSS_ASSET_ALIGNED,
  type ScoringStrategy,
  type SignalContext,
} from "../../services/confluence-score.js";

const BAR_MS = new Date("2026-05-24T15:00:00Z").getTime(); // 11:00 ET

describe("resolveCrossAssetContext — pure resolver", () => {
  it("maps a valid pre-market row to the 3 ctx fields + computes age in hours", () => {
    const computedAt = new Date(BAR_MS - 2 * 3_600_000); // 2h before the bar
    const r = resolveCrossAssetContext(
      { dxyDirection: "down", us10yDirection: "up", computedAt },
      BAR_MS,
    );
    expect(r.dxyDirection).toBe("down");
    expect(r.us10yDirection).toBe("up");
    expect(r.cross_asset_age_hours).toBeCloseTo(2, 5);
  });

  it("null row (no pre-market row today) → all-null (factor stays unavailable)", () => {
    const r = resolveCrossAssetContext(null, BAR_MS);
    expect(r).toEqual({ dxyDirection: null, us10yDirection: null, cross_asset_age_hours: null });
  });

  it("out-of-domain stored direction → null (garbage row can never satisfy the factor)", () => {
    const r = resolveCrossAssetContext(
      { dxyDirection: "sideways", us10yDirection: "", computedAt: null },
      BAR_MS,
    );
    expect(r.dxyDirection).toBeNull();
    expect(r.us10yDirection).toBeNull();
    expect(r.cross_asset_age_hours).toBeNull();
  });

  it("computed_at in the future relative to the bar → age null (never negative)", () => {
    const r = resolveCrossAssetContext(
      { dxyDirection: "up", us10yDirection: null, computedAt: new Date(BAR_MS + 3_600_000) },
      BAR_MS,
    );
    expect(r.dxyDirection).toBe("up");
    expect(r.cross_asset_age_hours).toBeNull();
  });

  it("accepts an ISO string computed_at (drizzle may hand back a string)", () => {
    const r = resolveCrossAssetContext(
      { dxyDirection: "down", us10yDirection: "down", computedAt: new Date(BAR_MS - 3_600_000).toISOString() },
      BAR_MS,
    );
    expect(r.cross_asset_age_hours).toBeCloseTo(1, 5);
  });
});

// ─── End-to-end: resolver output → evaluateWeightedConfluence lights the factor ──

function makeStrategy(): ScoringStrategy {
  return { id: "xa-e2e", symbol: "MCL", confluence_score_weights: null, confluence_score_threshold: null, entry_quality: null };
}

function makeCtx(over: Partial<SignalContext>): SignalContext {
  return {
    strategyId: "xa-e2e",
    bar: { open: 70, high: 70.5, low: 69.5, close: 70.1, volume: 4000 },
    indicators: { atr: 0.5 },
    direction: "long",
    symbol: "MCL",
    bias_active_strategy_id: null,
    structureState: null,
    calendarBlocked: false,
    timestampUTC: new Date(BAR_MS),
    ...over,
  };
}

describe("cross_asset_aligned lights up end-to-end once the resolver feeds ctx (HIGH-1)", () => {
  it("PRE-FIX BASELINE: no cross-asset fields → factor unavailable (the bug)", () => {
    const result = evaluateWeightedConfluence(makeStrategy(), makeCtx({}));
    const fc = result.factorContributions.find((f) => f.factor === FACTOR_CROSS_ASSET_ALIGNED)!;
    expect(fc.satisfied).toBe(false);
    expect(fc.reason).toBe("cross_asset_data_unavailable");
    expect(fc.contribution).toBe(0);
  });

  it("POST-FIX: resolver-populated MCL-long + DXY down → factor satisfied + contributes weight", () => {
    // MCL long is bullish when the dollar is weak (DXY down) — evalCrossAssetAligned's isMCL branch.
    const resolved = resolveCrossAssetContext(
      { dxyDirection: "down", us10yDirection: null, computedAt: new Date(BAR_MS - 3_600_000) },
      BAR_MS,
    );
    const result = evaluateWeightedConfluence(
      makeStrategy(),
      makeCtx({
        direction: "long",
        dxyDirection: resolved.dxyDirection,
        us10yDirection: resolved.us10yDirection,
        cross_asset_age_hours: resolved.cross_asset_age_hours,
      }),
    );
    const fc = result.factorContributions.find((f) => f.factor === FACTOR_CROSS_ASSET_ALIGNED)!;
    expect(fc.satisfied).toBe(true);
    expect(fc.reason).toContain("mcl_long_dxy_down");
    expect(fc.contribution).toBeGreaterThan(0);
  });
});

// ─── Wiring contract: paper-signal-service actually threads the resolver output ──
// The full paper-signal evaluation method is a ~5000-line stateful integration path
// with dozens of live dependencies, so a source-contract guard is the tractable way
// to lock the wiring against a silent regression (someone deleting the 3 threaded
// lines). tsc already type-checks the field names against SignalContext; this catches
// deletion. If paper-signal-service ever gets a true integration harness, replace this.
describe("wiring contract — paper-signal-service threads cross-asset into weightedCtx (HIGH-1)", () => {
  const src = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../../services/paper-signal-service.ts"),
    "utf-8",
  );

  it("imports and calls resolveCrossAssetContext", () => {
    expect(src).toContain('from "../lib/cross-asset-context.js"');
    expect(src).toMatch(/resolveCrossAssetContext\s*\(/);
  });

  it("selects the cross-asset columns from preMarketSessions", () => {
    expect(src).toContain("preMarketSessions.dxyDirection");
    expect(src).toContain("preMarketSessions.us10yDirection");
    expect(src).toContain("preMarketSessions.computedAt");
  });

  it("threads dxyDirection / us10yDirection / cross_asset_age_hours into the weightedCtx literal", () => {
    const ctxStart = src.indexOf("const weightedCtx");
    expect(ctxStart).toBeGreaterThan(-1);
    const ctxBlock = src.slice(ctxStart, ctxStart + 2600);
    expect(ctxBlock).toContain("dxyDirection:");
    expect(ctxBlock).toContain("us10yDirection:");
    expect(ctxBlock).toContain("cross_asset_age_hours:");
  });
});
