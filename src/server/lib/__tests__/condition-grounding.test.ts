import { describe, it, expect } from "vitest";
import { classifyCondition, groundabilityCoverage, ledgerF } from "../condition-grounding.js";
import type { EngineStrategySpec, EngineCondition } from "../graph-to-engine.js";

describe("condition grounding — classifier", () => {
  it("grounds core strategy-domain objects to the real engine primitives", () => {
    expect(classifyCondition("liquidity sweep of the asian high")).toMatchObject({ family: "liquidity", status: "native" });
    expect(classifyCondition("market structure shift")).toMatchObject({ family: "market_structure", status: "native" });
    expect(classifyCondition("9 ema crossing above 21 ema")).toMatchObject({ family: "indicator", status: "native" });
    expect(classifyCondition("new york session open")).toMatchObject({ family: "session_time", status: "native" });
    expect(classifyCondition("discount retracement into the fib")).toMatchObject({ family: "ict_zone", status: "composite" });
    expect(classifyCondition("trade entry")).toMatchObject({ family: "entry_execution", status: "native" });
  });

  it("CCI is needs_new BY POLICY (catalog-rejected) — never silently proxied to RSI", () => {
    const c = classifyCondition("cci crossing zero line upwards");
    expect(c.status).toBe("needs_new");
    expect(c.evaluator).toMatch(/REJECTED by indicator-catalog policy/);
  });

  it("educator-idiolect 'weakness' grounds to the sweep-and-reject detector (built 2026-06-30)", () => {
    const c = classifyCondition("valid high taken with weakness closing lower");
    expect(c).toMatchObject({ family: "price_action", status: "native" });
    expect(c.evaluator).toMatch(/candle_patterns\.detect_weakness/);
  });

  it("vague meta-objects stay honestly ambiguous (no coverage stuffing)", () => {
    for (const o of ["waiting state", "specific pattern", "search bar", "three fast steps"])
      expect(classifyCondition(o).status, o).toBe("ambiguous");
  });

  it("EVERY object classifies exactly once (mandatory fallback — nothing silently dropped)", () => {
    const objs = ["", "xyzzy", "liquidity sweep", "cci", "waiting state"];
    const r = groundabilityCoverage(objs);
    const classified = Object.values(r.by_status).reduce((s, x) => s + x, 0);
    expect(classified).toBe(objs.length);
  });

  it("coverage metric = (native + composite) / total", () => {
    const r = groundabilityCoverage(["liquidity sweep", "discount fib", "cci", "waiting state"]); // native+composite+needs_new+ambiguous
    expect(r.coverage_pct).toBe(50);
    expect(r.ungrounded.length).toBe(2);
  });
});

describe("Ledger F — grounding conservation", () => {
  const c = (id: string, object: string, role: EngineCondition["role"] = "spine"): EngineCondition =>
    ({ id, type: "WAIT_STRUCTURE", object, role });
  const spec = (conds: EngineCondition[], invs: EngineCondition[] = []): EngineStrategySpec => ({
    direction: "long", entry_conditions: conds, and_groups: [], or_branches: [], invalidations: invs,
    entry_trigger_id: conds[0]?.id ?? null,
    framework_overlay: { stop: "framework_owned", take_profit: "framework_owned", sizing: "framework_owned" },
  });

  it("ok on a fully-classified spec with no framework leakage", () => {
    const r = ledgerF(spec([c("a", "liquidity sweep"), c("b", "ema cross")]));
    expect(r.ok).toBe(true);
    expect(r.framework_leaks).toEqual([]);
    expect(r.coverage.coverage_pct).toBe(100);
  });

  it("flags a framework-owned object that leaked into entry conditions (Ledger D inv.5 cross-check)", () => {
    const r = ledgerF(spec([c("a", "liquidity sweep"), c("bad", "stop loss placement")]));
    expect(r.ok).toBe(false);
    expect(r.framework_leaks).toEqual(["bad:stop loss placement"]);
  });

  it("ungroundable conditions are EXPLICITLY reported, never silently ignored (ok stays true — coverage is the metric)", () => {
    const r = ledgerF(spec([c("a", "cci"), c("b", "waiting state")]));
    expect(r.ok).toBe(true); // explicit reporting ≠ failure; coverage_pct carries the signal
    expect(r.coverage.ungrounded.map((u) => u.object).sort()).toEqual(["cci", "waiting state"]);
    expect(r.coverage.coverage_pct).toBe(0);
  });
});
