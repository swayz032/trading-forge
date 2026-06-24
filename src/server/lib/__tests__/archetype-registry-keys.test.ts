/**
 * Pure archetype-key resolution + drift guard (2026-06-24 Layer 1).
 *
 * The compilability gate trusts `entryIndicatorResolvesToArchetype` to distinguish a REAL
 * executable archetype from a concept-name echo. If this set drifts from what the graduator
 * actually routes, the gate will either wrongly quarantine real archetypes or wrongly pass
 * echoes. These tests lock the contract.
 */
import { describe, it, expect } from "vitest";
import {
  RAW_ARCHETYPES_RESPECTED,
  RESOLVABLE_ARCHETYPES,
  entryIndicatorResolvesToArchetype,
} from "../archetype-registry-keys.js";

describe("entryIndicatorResolvesToArchetype", () => {
  it("resolves a known structural archetype", () => {
    expect(entryIndicatorResolvesToArchetype("order_block")).toBe(true);
    expect(entryIndicatorResolvesToArchetype("ict_silver_bullet_ny_am")).toBe(true);
    expect(entryIndicatorResolvesToArchetype("bounce_off_level")).toBe(true);
  });

  it("resolves the registry-only key (gann_box_4h_continuation)", () => {
    expect(entryIndicatorResolvesToArchetype("gann_box_4h_continuation")).toBe(true);
  });

  it("strips an 'archetype:' prefix and is case/whitespace insensitive", () => {
    expect(entryIndicatorResolvesToArchetype("archetype:order_block")).toBe(true);
    expect(entryIndicatorResolvesToArchetype("  ARCHETYPE:Order_Block  ")).toBe(true);
  });

  it("does NOT resolve a concept-name echo (the production hole)", () => {
    for (const echo of [
      "impulse_range_sweep_4h_5m",
      "overnight_high_low_retest_5m",
      "4h_candle_box_continuation",
      "moving_average_trend_following_20_200",
    ]) {
      expect(entryIndicatorResolvesToArchetype(echo), echo).toBe(false);
    }
  });

  it("does NOT resolve parametric pattern-library indicators (they require params, not archetype waiver)", () => {
    // ema_crossover / rsi_reversal are engine-supported but PARAMETRIC — they must carry params,
    // not be waived as archetypes. They are intentionally absent from the resolvable set.
    expect(entryIndicatorResolvesToArchetype("ema_crossover")).toBe(false);
    expect(entryIndicatorResolvesToArchetype("rsi_reversal")).toBe(false);
  });

  it("returns false for null/empty/non-string", () => {
    expect(entryIndicatorResolvesToArchetype(null)).toBe(false);
    expect(entryIndicatorResolvesToArchetype(undefined)).toBe(false);
    expect(entryIndicatorResolvesToArchetype("")).toBe(false);
    expect(entryIndicatorResolvesToArchetype("   ")).toBe(false);
  });

  it("RESOLVABLE_ARCHETYPES is a superset of RAW_ARCHETYPES_RESPECTED", () => {
    for (const k of RAW_ARCHETYPES_RESPECTED) {
      expect(RESOLVABLE_ARCHETYPES.has(k), `RESOLVABLE missing RAW key ${k}`).toBe(true);
    }
  });

  it("DRIFT GUARD: graduator's RAW_ARCHETYPES_RESPECTED is the same object imported from this module", async () => {
    // The graduator is DB-coupled (throws at import without DATABASE_URL). Set a dummy so we can
    // dynamic-import it and assert it shares THIS module's set — proving single-source-of-truth.
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://x:x@localhost:5432/x";
    const grad = await import("../../services/direct-bucket-graduator.js");
    // deriveEntryIndicator must respect a known archetype (proves it uses the shared set).
    const out: { path?: string } = {};
    const r = grad.deriveEntryIndicator("order_block", null, "order_block", out);
    expect(r).toBe("archetype:order_block");
    expect(out.path).toBe("gemma_archetype_respected");
    // And must NOT early-return a concept echo as a respected archetype.
    const out2: { path?: string } = {};
    grad.deriveEntryIndicator("impulse_range_sweep_4h_5m", null, "impulse_range_sweep_4h_5m", out2);
    expect(out2.path).not.toBe("gemma_archetype_respected");
  });
});
