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

  it("returns a FROZEN object (mutation guard — Object.assign clobber throws, cert variant d)", () => {
    const r = resolveCrossAssetContext(
      { dxyDirection: "down", us10yDirection: "up", computedAt: new Date(BAR_MS) },
      BAR_MS,
    );
    expect(Object.isFrozen(r)).toBe(true);
    // A silent post-resolution clobber (Object.assign(ctx, {...nulls})) throws in strict
    // mode rather than quietly reverting the factor to cross_asset_data_unavailable.
    expect(() => Object.assign(r as unknown as Record<string, unknown>, { dxyDirection: null })).toThrow();
    expect(r.dxyDirection).toBe("down"); // unchanged
  });

  it("the all-null (missing row) result is ALSO frozen", () => {
    expect(Object.isFrozen(resolveCrossAssetContext(null, BAR_MS))).toBe(true);
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

  it("binds crossAssetCtx as a `const` from the resolver (compile-time single-assignment guard)", () => {
    expect(src).toContain('from "../lib/cross-asset-context.js"');
    // `const` (not `let`) → reassignment or dead/conditional-gated assignment is a
    // COMPILE error, not a silent runtime regression. This is the structural close for
    // cert variants (a) post-assign clobber and (f) conditional-gated assignment.
    expect(src).toMatch(/const\s+crossAssetCtx\s*=\s*resolveCrossAssetContext\s*\(/);
    expect(src).not.toMatch(/let\s+crossAssetCtx\b/);
  });

  it("selects the cross-asset columns from preMarketSessions", () => {
    expect(src).toContain("preMarketSessions.dxyDirection");
    expect(src).toContain("preMarketSessions.us10yDirection");
    expect(src).toContain("preMarketSessions.computedAt");
  });

  // F-3 (cert pass 4): the ROW that feeds the resolver must also be `const` from a single
  // expression — no mutable `pmRow`/`pmCrossAssetRow` intermediate a future edit could
  // null out (variant g). The read happens inside a fail-open IIFE; the resolver reads
  // that same const. Guard: pmRow is const, and there is no mutable row var to reassign.
  it("the pre-market row feeding the resolver is `const` (no mutable intermediate — blocks variant g)", () => {
    expect(src).toMatch(/const\s+pmRow\s*=\s*await\s*\(/);
    expect(src).not.toMatch(/let\s+pmCrossAssetRow\b/);
    expect(src).not.toMatch(/let\s+pmRow\b/);
    // The resolver must read that exact const row (not a re-derived/nulled value).
    expect(src).toMatch(/resolveCrossAssetContext\s*\(\s*pmRow\s*,/);
  });

  it("SPREADS crossAssetCtx into the weightedCtx literal (field names come from the typed resolver output)", () => {
    const ctxStart = src.indexOf("const weightedCtx");
    expect(ctxStart).toBeGreaterThan(-1);
    const ctxBlock = src.slice(ctxStart, ctxStart + 2600);
    // Spread (not per-field copy) → a typo'd field name can't compile, and the
    // exact keys are pinned by ResolvedCrossAssetContext, not repeated by hand.
    expect(ctxBlock).toContain("...crossAssetCtx");
  });

  // F-1 variant (a): reassigning crossAssetCtx to nulls AFTER the real resolver call
  // reproduces the bug (resolver runs, result clobbered). Guard: crossAssetCtx is
  // ASSIGNED exactly once, and that single assignment is the resolver call.
  it("assigns crossAssetCtx exactly once, and only from the resolver (blocks post-assign null-clobber)", () => {
    // Assignments: `crossAssetCtx = ...` (excludes the `let crossAssetCtx: … =` declaration,
    // which is `crossAssetCtx:` in TS — the regex below requires whitespace before `=`).
    const assigns = src.match(/[^:]\bcrossAssetCtx\s*=\s*[^=]/g) ?? [];
    expect(assigns.length, `crossAssetCtx reassigned ${assigns.length}× (expected exactly 1, from the resolver)`).toBe(1);
    expect(src).toMatch(/\bcrossAssetCtx\s*=\s*resolveCrossAssetContext\s*\(/);
  });

  // F-4 (cert pass 5): a direct property clobber `crossAssetCtx.dxyDirection = null` after
  // the resolver call is the same silent-drop class as (d) but was uncaught by the
  // reassign regex + tsc (fields weren't readonly). Now: ResolvedCrossAssetContext fields
  // are `readonly` (tsc TS2540 on any field write) AND frozen at runtime (throws) — this
  // guard rejects the source shape too, as defense-in-depth.
  it("never writes a crossAssetCtx property directly (blocks post-resolution field clobber)", () => {
    expect(src, "crossAssetCtx.<field> = … is a silent frozen-object clobber — forbidden")
      .not.toMatch(/\bcrossAssetCtx\.\w+\s*=[^=]/);
  });

  // F-1 variant (b): `...crossAssetCtx, dxyDirection: null` inside the literal overrides
  // the spread. Guard: the weightedCtx literal must NOT restate any of the 3 spread keys.
  it("weightedCtx literal does NOT override any spread cross-asset key (blocks post-spread null override)", () => {
    const ctxStart = src.indexOf("const weightedCtx");
    const ctxEnd = src.indexOf("};", ctxStart);
    const ctxBlock = src.slice(ctxStart, ctxEnd);
    for (const key of ["dxyDirection", "us10yDirection", "cross_asset_age_hours"]) {
      // An explicit `key:` inside the literal after the spread would clobber it.
      expect(ctxBlock, `weightedCtx literal restates "${key}:" — that overrides ...crossAssetCtx`)
        .not.toMatch(new RegExp(`\\b${key}\\s*:`));
    }
  });
});

// ─── Data-flow: resolver output spreads to the exact ctx keys the factor reads ───
// Mirrors the codebase's "replicate the wiring expression" pattern
// (paper-parity-vwap-smt-volume.test.ts T1/T2). Because paper-signal-service spreads
// the resolver's typed return straight into weightedCtx, proving the resolver emits
// {dxyDirection, us10yDirection, cross_asset_age_hours} — and ONLY those — proves the
// spread lands the same keys evalCrossAssetAligned + deriveFactorDecay read.
describe("resolver output shape == the ctx keys the factor consumes (HIGH-1)", () => {
  it("returns exactly the 3 SignalContext keys the cross_asset factor + its decay read", () => {
    const out = resolveCrossAssetContext(
      { dxyDirection: "down", us10yDirection: "up", computedAt: new Date(BAR_MS - 3_600_000) },
      BAR_MS,
    );
    // Exact key set — a spread of this object can only ever set these 3 ctx fields.
    expect(Object.keys(out).sort()).toEqual(
      ["cross_asset_age_hours", "dxyDirection", "us10yDirection"],
    );
  });

  it("spreading the resolver output into a ctx object populates the factor inputs", () => {
    const resolved = resolveCrossAssetContext(
      { dxyDirection: "down", us10yDirection: "up", computedAt: new Date(BAR_MS) },
      BAR_MS,
    );
    // Simulate the exact weightedCtx spread the service performs.
    const ctx: Partial<SignalContext> = { ...resolved };
    expect(ctx.dxyDirection).toBe("down");
    expect(ctx.us10yDirection).toBe("up");
    expect(ctx.cross_asset_age_hours).toBe(0);
  });
});
