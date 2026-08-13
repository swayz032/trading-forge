/**
 * B3 REPAIR guards — AR-1133 §3.4.
 *
 * The old rule was `stop_loss.type !== "atr" -> B3_FIXED_POINT_STOP`, message "must be
 * 'atr' — NO fixed-point stops per CLAUDE.md §13". That INVERTED the policy: CLAUDE.md §4
 * is titled "Stop Loss — structural, NEVER fixed-point". It stayed hidden because
 * `source_risk` was dropped by the onboarding parser, so `resolveSpecStopLoss()` always
 * returned ATR and this branch never saw a structural stop.
 *
 *   `A FEATURE KEPT DEAD BY A SEPARATE BUG NEVER MEETS THE GUARD THAT WOULD HAVE
 *    REJECTED IT — SO A STALE GUARD READS AS CORRECT UNTIL SOMEONE FIXES THE FEATURE.`
 *
 * 🛑 THE STAMPS ARE NOT THE AUTHORITY. `ownership:"source"` / `source_exact:true` can be
 * hand-written into a config, so the canonical resolver is the authority and the audited
 * stop must equal its output on the full semantic payload.
 */
import { describe, it, expect } from "vitest";
import { auditGraduatedConfig } from "../graduated-strategy-auditor.js";
import { resolveSpecStopLoss } from "../source-risk-contract.js";

const SOURCE_RISK = {
  mode: "SOURCE_FAITHFUL",
  stop: { anchor: "sweep_wick_below_entry", include_wick: true, span: { start: 120, end: 260 } },
  target: { type: "FIXED_R", r_multiple: 2, span: { start: 300, end: 440 } },
};

const SPEC = { direction: "long", entry_conditions: [], entry_trigger_id: "T1", source_risk: SOURCE_RISK };

/** The CANONICAL stop for that contract — computed, never hand-copied. */
const CANONICAL = resolveSpecStopLoss(SPEC as any);

function cfg(stopLoss: unknown, spec: unknown = SPEC) {
  return {
    entry_type: "breakout",
    time_stop: { enabled: true, bars: 20 },
    compiled_spec: { spec },
    strategy: {
      stop_loss: stopLoss,
      position_size: { type: "risk_derived_pyramid", base_contracts: 6 },
      indicators: [{ type: "fvg" }],
    },
  };
}

const b3 = (config: unknown) =>
  auditGraduatedConfig({ conceptName: "order_block_entry", symbol: "MES", config })
    .defects.filter((d) => d.code === "B3_FIXED_POINT_STOP");

describe("B3 — the canonical source-owned stop is ACCEPTED", () => {
  it("canonical resolveSpecStopLoss output passes", () => {
    expect(CANONICAL.type).toBe("source_structural"); // positive witness
    expect(b3(cfg(CANONICAL))).toHaveLength(0);
  });

  it("a compliant ATR stop still passes (legacy byte-preserved)", () => {
    expect(b3(cfg({ type: "atr", multiplier: 1.5 }))).toHaveLength(0);
  });
});

describe("B3 — genuine fixed-point stops still FAIL", () => {
  it.each(["points", "fixed_point", "ticks", "percent"])("type=%s is a defect", (t) => {
    expect(b3(cfg({ type: t, value: 10 })).length).toBeGreaterThan(0);
  });
});

describe("B3 — COUNTERFEIT source stops FAIL", () => {
  it("no compiled_spec.spec.source_risk at all", () => {
    expect(b3(cfg(CANONICAL, { direction: "long", entry_conditions: [], entry_trigger_id: "T1" })).length)
      .toBeGreaterThan(0);
  });

  it("mode is not SOURCE_FAITHFUL", () => {
    const spec = { ...SPEC, source_risk: { ...SOURCE_RISK, mode: "TF_OVERLAY_VARIANT" } };
    expect(b3(cfg(CANONICAL, spec)).length).toBeGreaterThan(0);
  });

  it("FAKE ownership stamp with no contract behind it", () => {
    const fake = { type: "source_structural", ownership: "source", source_exact: true };
    expect(b3(cfg(fake, { direction: "long", entry_conditions: [], entry_trigger_id: "T1" })).length)
      .toBeGreaterThan(0);
  });

  it("ALTERED anchor", () => {
    expect(b3(cfg({ ...CANONICAL, anchor: "ob_low" })).length).toBeGreaterThan(0);
  });

  it("ALTERED required_anchor", () => {
    expect(b3(cfg({ ...CANONICAL, required_anchor: "order_block" })).length).toBeGreaterThan(0);
  });

  it("ALTERED span — a moved quote is a different taught stop", () => {
    expect(b3(cfg({ ...CANONICAL, span: { start: 0, end: 9 } })).length).toBeGreaterThan(0);
  });

  it("FLIPPED include_wick", () => {
    expect(b3(cfg({ ...CANONICAL, include_wick: false })).length).toBeGreaterThan(0);
  });

  it("FLIPPED source_exact", () => {
    expect(b3(cfg({ ...CANONICAL, source_exact: false })).length).toBeGreaterThan(0);
  });
});
