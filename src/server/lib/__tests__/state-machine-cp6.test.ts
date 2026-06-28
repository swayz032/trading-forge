/**
 * Checkpoint 6 — consensus protocol (the final architecture checkpoint).
 * Proven offline with deterministic pass fixtures (live Gemma needs the stable supervisor, W4.2).
 * Covers: agreement graph, disagreement report, semantic entropy, the SKEPTIC's adversarial checks
 * (silent invention / dropped explicit / OR-collapse), semantic diff, and stability.
 */
import { describe, it, expect } from "vitest";
import {
  buildAgreement, disagreementReport, semanticEntropy, skepticFindings, semanticDiff, semanticStability,
  type PassOutput,
} from "../consensus-protocol.js";
import { lowerToStateMachineIR } from "../state-machine-lowering.js";
import type { CompoundConfirmation } from "../confirmation-compiler.js";

const seq = (...actions: string[]) => actions.map((action, i) => ({ step: i + 1, action }));
const u = (key: string, node: string, status: "extracted" | "inferred" | "unknown" = "extracted") => ({ key, node, status });
const pass = (role: PassOutput["role"], units: PassOutput["units"], ir?: PassOutput["ir"]): PassOutput => ({ role, units, ir });

describe("CP6 — consensus protocol (agreement / disagreement / entropy)", () => {
  const literal = pass("literal", [u("break of structure", "event"), u("order block", "zone"), u("engulfing", "confirmation"), u("retest", "wait", "unknown")]);
  const decision = pass("decision_process", [u("break of structure", "event"), u("order block", "zone"), u("engulfing", "confirmation"), u("retest", "wait"), u("market entry", "entry", "inferred")]);

  it("★ agreement graph: shared units are unanimous; one-pass-only units are single", () => {
    const byKey = Object.fromEntries(buildAgreement([literal, decision]).map((a) => [a.key, a.level]));
    expect(byKey["break of structure"]).toBe("unanimous");
    expect(byKey["retest"]).toBe("single");        // literal marked it UNKNOWN → only decision extracted it
    expect(byKey["market entry"]).toBe("single");  // decision-only (inferred)
  });

  it("disagreement report buckets units by agreement level", () => {
    const r = disagreementReport([literal, decision]);
    expect(r.unanimous).toEqual(expect.arrayContaining(["break of structure", "order block", "engulfing"]));
    expect(r.single).toEqual(expect.arrayContaining(["retest", "market entry"]));
  });

  it("★ semantic entropy locates WHERE uncertainty lives (unanimous / disputed / missing)", () => {
    const e = semanticEntropy(["break of structure", "order block", "engulfing", "retest", "asia session filter"], [literal, decision]);
    expect(e.total).toBe(5);
    expect(e.unanimous).toBe(3); // bos/ob/engulfing
    expect(e.disputed).toBe(1);  // retest (single)
    expect(e.missing).toBe(1);   // asia session filter — no pass extracted it
  });
});

describe("CP6 — the SKEPTIC (Pass 3 attacks Pass 2)", () => {
  it("★ SILENT_INVENTION: DP extracted (as fact) a unit the literal pass never saw", () => {
    const literal = pass("literal", [u("break of structure", "event")]);
    const dp = pass("decision_process", [u("break of structure", "event"), u("hidden invalidation rule", "invalidation", "extracted")]);
    expect(skepticFindings(literal, dp).some((x) => x.type === "SILENT_INVENTION" && /invalidation/.test(x.key))).toBe(true);
  });

  it("★ an INFERRED-marked DP unit is HONEST — NOT flagged as silent invention (the invariant respected)", () => {
    const literal = pass("literal", [u("break of structure", "event")]);
    const dp = pass("decision_process", [u("break of structure", "event"), u("market entry", "entry", "inferred")]);
    // inferred = openly compiler-filled → the skeptic does NOT cry invention (only `extracted`-as-fact unseen units do)
    expect(skepticFindings(literal, dp).some((x) => x.type === "SILENT_INVENTION" && x.key === "market entry")).toBe(false);
  });

  it("★ DROPPED_EXPLICIT: DP dropped something the literal pass extracted explicitly", () => {
    const literal = pass("literal", [u("break of structure", "event"), u("volume spike", "confirmation")]);
    const dp = pass("decision_process", [u("break of structure", "event")]);
    expect(skepticFindings(literal, dp).some((x) => x.type === "DROPPED_EXPLICIT" && x.key === "volume spike")).toBe(true);
  });

  it("★ OR_COLLAPSE: literal saw alternatives but DP forced all_required", () => {
    const literal = pass("literal", [u("breakout", "alternative"), u("retest", "alternative")]);
    const compound: CompoundConfirmation = {
      predicate_type: "sequence", operator: "AND", enforcement: "all_required", primary_order: 1,
      legs: [{ kind: "close_through", level_ref: "range_edge", evidence_quote: "x", order: 1, role: "primary" }],
    };
    const ir = lowerToStateMachineIR({ entry_sequence: seq("break of structure", "enter on confirmation") });
    ir.wait_state.confirmation = { ...ir.wait_state.confirmation, compound };
    const dp = pass("decision_process", [u("breakout", "event")], ir);
    expect(skepticFindings(literal, dp).some((x) => x.type === "OR_COLLAPSE")).toBe(true);
  });
});

describe("CP6 — semantic diff + stability (compare GRAPHS, not text)", () => {
  const irA = lowerToStateMachineIR({ entry_sequence: seq("break of structure", "wait for the retest of the order block", "enter on confirmation"), direction: "long" });

  it("identical graphs → diff all same, stability 1.0", () => {
    const irB = lowerToStateMachineIR({ entry_sequence: seq("break of structure", "wait for the retest of the order block", "enter on confirmation"), direction: "long" });
    expect(semanticDiff(irA, irB).every((d) => d.same)).toBe(true);
    expect(semanticStability([irA, irB]).score).toBe(1);
  });

  it("★ a differing zone shows in the diff and lowers stability", () => {
    const irC = lowerToStateMachineIR({ entry_sequence: seq("break of structure", "wait for the retest of the fair value gap", "enter on confirmation"), direction: "long" });
    const diff = semanticDiff(irA, irC);
    expect(diff.some((d) => d.node === "execution_context" && !d.same)).toBe(true); // OB vs FVG
    const stab = semanticStability([irA, irC]);
    expect(stab.score).toBeLessThan(1);
    expect(stab.unstable_nodes).toContain("execution_context");
  });
});
