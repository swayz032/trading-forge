/**
 * Checkpoint 2 — lowering (representation) + semantic conservation. NO execution change.
 * Proves: immediate→zero-wait parity, delayed→wait_state representation, every node has provenance+origin,
 * compiler-generated nodes labeled, and silent loss is a HARD failure.
 */
import { describe, it, expect } from "vitest";
import { lowerToStateMachineIR } from "../state-machine-lowering.js";
import { compileConfirmationCompound } from "../confirmation-compiler.js";
import { isZeroWait, compilerGeneratedNodes } from "../state-machine-ir.js";
import { checkSemanticConservation, conserveOrThrow, classifyIgnoreReason } from "../semantic-conservation.js";

const seq = (...actions: string[]) => actions.map((action, i) => ({ step: i + 1, action }));

describe("CP2 lowering — representation preserved, execution unchanged", () => {
  it("★ immediate strategy → zero-wait; confirmation.compound is byte-identical to the baseline compiler (parity)", () => {
    const input = { entry_sequence: seq("enter on a close through the opening range edge"), direction: "long" as const };
    const baseline = compileConfirmationCompound(input);
    const ir = lowerToStateMachineIR(input);
    expect(isZeroWait(ir)).toBe(true);
    expect(JSON.stringify(ir.wait_state.confirmation.compound)).toBe(JSON.stringify(baseline.compound)); // PARITY
  });

  it("★ delayed (zone-return) strategy → populated wait_state (representation only, not executed differently)", () => {
    const ir = lowerToStateMachineIR({
      entry_sequence: seq(
        "mark the order block after the break of structure",
        "wait for price to come back and retest the order block",
        "enter on the bullish confirmation inside the zone",
      ),
      direction: "long",
    });
    expect(isZeroWait(ir)).toBe(false);
    expect(["retest", "price_reenters"]).toContain(ir.wait_state.until.kind);
    expect(ir.structural_event?.event).toBe("bos");
    expect(ir.execution_context?.zone).toBe("order_block");
  });

  it("★ every node carries provenance+origin; compiler-filled defaults labeled compiler_generated", () => {
    const ir = lowerToStateMachineIR({ entry_sequence: seq("enter on a close through the range edge") });
    const cg = compilerGeneratedNodes(ir).map((n) => n.at);
    expect(cg).toContain("entry");          // market default never stated
    expect(cg).toContain("wait_state.until"); // zero-wait inferred
    // the confirmation IS real (from extraction) → NOT a compiler default (span-native: explicit if transcript-bound, else derived)
    expect(ir.wait_state.confirmation.provenance.origin).not.toBe("compiler_generated");
  });
});

describe("CP2 semantic conservation — every unit has a disposition, silent loss fails hard", () => {
  const items = [
    { name: "order block", verbatim_quote: "mark the order block" },         // executed (covered)
    { name: "order block zone", verbatim_quote: "tap the order block zone" }, // normalized (umbrella of order block)
    { name: "join my discord", verbatim_quote: "link in the description, join my course" }, // ignored: promotion
    { name: "accept the risk", verbatim_quote: "you must accept the risk before entering" }, // ignored: psychology
    { name: "trade the NASDAQ", verbatim_quote: "I trade the nasdaq" },       // ignored: instrument
  ];

  it("assigns each unit exactly one disposition; nothing vanishes", () => {
    const r = checkSemanticConservation(items, ["order block"]);
    expect(r.executed).toBe(1);
    expect(r.ignored).toBe(3);
    expect(r.normalized).toBe(1);
    expect(r.silent_loss).toEqual([]);
    expect(r.coverage_pct).toBe(1);
    expect(() => conserveOrThrow(r)).not.toThrow();
  });

  it("★ a unit that fits NO disposition is SILENT LOSS → conserveOrThrow throws", () => {
    const withOrphan = [...items, { name: "secret entry trick", verbatim_quote: "the special move that makes it all work" }];
    const r = checkSemanticConservation(withOrphan, ["order block"]);
    expect(r.silent_loss.map((s) => s.name)).toContain("secret entry trick");
    expect(() => conserveOrThrow(r)).toThrow(/semantic_conservation_violation/);
  });

  it("ignore-reason matchers classify the role-taxonomy buckets", () => {
    expect(classifyIgnoreReason("win rate is 70%")).toBe("output_stat");
    expect(classifyIgnoreReason("add the VWAP indicator")).toBe("tool");
    expect(classifyIgnoreReason("risk 2% per trade")).toBe("risk_overlay_owned");
    expect(classifyIgnoreReason("a clean break of structure")).toBeNull(); // a real mechanic is NOT ignorable
  });
});
