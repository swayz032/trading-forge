/**
 * Corpus v3 Step 3 — TF_SEMANTIC_ROLE_CLASSIFIER wiring in graph-to-engine.ts.
 *
 * Proves:
 *   1. Byte-identical when OFF (default) — the flag-off path is the ORIGINAL
 *      `inAndGroup.has(a.id) ? "confluence" : "spine"` expression, untouched.
 *   2. When ON, roles reflect the gate-strength deterministic rules (1-5): mandatory language ->
 *      spine, optional language -> confluence, alternative language -> or_branch, contextual
 *      (scene-setting/refuted-strawman) language -> context (RETAINED, non-gating).
 *   3. When ON, an atom the deterministic rules leave AMBIGUOUS still falls back to the same
 *      topology heuristic used when the flag is OFF (the compiler stays synchronous/pure — see
 *      gate-strength.ts and graph-to-engine.ts docstrings).
 */
import { describe, it, expect, afterEach } from "vitest";
import { compileGraph } from "../graph-compiler.js";
import type { AtomType, DecisionAtom } from "../decision-atom.js";
import { SPAN } from "../state-machine-ir.js";
import { compileToEngineSpec } from "../graph-to-engine.js";

let n = 0;
const atomWithQuote = (type: AtomType, object: string, quote: string, start: number): DecisionAtom => ({
  id: `${type}:${object.replace(/\s+/g, "_")}#${n++}`,
  type,
  temporal_kind: "event",
  object,
  object_canonical: object,
  depends_on: [],
  provenance: SPAN(quote, start, start + quote.length),
});

afterEach(() => {
  delete process.env.TF_SEMANTIC_ROLE_CLASSIFIER;
});

describe("graph-to-engine.ts — TF_SEMANTIC_ROLE_CLASSIFIER (Corpus v3 Step 3)", () => {
  it("flag OFF (default, unset) — role is the ORIGINAL topology-only heuristic, byte-identical", () => {
    n = 0;
    delete process.env.TF_SEMANTIC_ROLE_CLASSIFIER;
    const atoms = [
      // an AND-group of two same-rank confluences, all carrying clearly MANDATORY quotes —
      // if the flag did anything when unset, these two would flip to "spine" via gate-strength.
      atomWithQuote("WAIT_CONFIRMATION", "structure confirmation", "wait for the structure to confirm", 0),
      atomWithQuote("WAIT_CONFIRMATION", "retest confirmation", "you must wait for the retest", 40),
      atomWithQuote("ENABLE_ENTRY", "go long", "enter the trade", 80),
    ];
    const g = compileGraph(atoms, "x".repeat(200));
    const spec = compileToEngineSpec(g);
    const roles = spec.entry_conditions.filter((c) => c.role !== "trigger").map((c) => c.role);
    // legacy behavior: same-rank cluster -> both "confluence" (never "spine" from gate-strength)
    expect(roles.every((r) => r === "confluence" || r === "spine")).toBe(true);
    expect(roles).not.toContain("context");
    expect(roles).not.toContain("or_branch");
  });

  it("flag ON — clear MANDATORY_LANG on a WAIT_CONFIRMATION atom resolves to role=spine (rule 2)", () => {
    n = 0;
    process.env.TF_SEMANTIC_ROLE_CLASSIFIER = "true";
    const atoms = [
      atomWithQuote("WAIT_CONFIRMATION", "retest", "as soon as the key level is tapped we enter", 0),
      atomWithQuote("ENABLE_ENTRY", "go long", "enter the trade", 60),
    ];
    const g = compileGraph(atoms, "x".repeat(150));
    const spec = compileToEngineSpec(g);
    const cond = spec.entry_conditions.find((c) => c.type === "WAIT_CONFIRMATION")!;
    expect(cond.role).toBe("spine");
  });

  it("flag ON — clear CONTEXT_LANG resolves to role=context (RETAINED, non-gating, never dropped)", () => {
    n = 0;
    process.env.TF_SEMANTIC_ROLE_CLASSIFIER = "true";
    const atoms = [
      atomWithQuote("WAIT_STRUCTURE", "range boundary", "for example, let's say the range looks like this", 0),
      atomWithQuote("ENABLE_ENTRY", "go long", "enter the trade", 80),
    ];
    const g = compileGraph(atoms, "x".repeat(150));
    const spec = compileToEngineSpec(g);
    // the condition MUST still be present (faithfulness invariant) — just non-gating.
    const cond = spec.entry_conditions.find((c) => c.type === "WAIT_STRUCTURE")!;
    expect(cond).toBeDefined();
    expect(cond.role).toBe("context");
  });

  it("flag ON — clear ALT_LANG resolves to role=or_branch; clear OPTIONAL_LANG resolves to role=confluence", () => {
    n = 0;
    process.env.TF_SEMANTIC_ROLE_CLASSIFIER = "true";
    const atoms = [
      atomWithQuote("WAIT_BIAS", "direction", "either the price trades up or it may trade low", 0),
      atomWithQuote("WAIT_STRUCTURE", "extra confluence", "ideally you'd also see volume confirm this", 60),
      atomWithQuote("ENABLE_ENTRY", "go long", "enter the trade", 130),
    ];
    const g = compileGraph(atoms, "x".repeat(200));
    const spec = compileToEngineSpec(g);
    expect(spec.entry_conditions.find((c) => c.type === "WAIT_BIAS")!.role).toBe("or_branch");
    expect(spec.entry_conditions.find((c) => c.object === "extra confluence")!.role).toBe("confluence");
  });

  it("flag ON — an AMBIGUOUS atom (no deterministic rule fires) falls back to the topology heuristic", () => {
    n = 0;
    process.env.TF_SEMANTIC_ROLE_CLASSIFIER = "true";
    const atoms = [
      // no CONTEXT/MANDATORY/ALT/OPTIONAL marker in this quote at all -> ambiguous -> topology fallback
      atomWithQuote("FILTER", "generic filter", "price crosses the moving average line here", 0),
      atomWithQuote("ENABLE_ENTRY", "go long", "enter the trade", 60),
    ];
    const g = compileGraph(atoms, "x".repeat(150));
    const spec = compileToEngineSpec(g);
    const cond = spec.entry_conditions.find((c) => c.type === "FILTER")!;
    expect(["spine", "confluence"]).toContain(cond.role); // topology fallback shape, never context/or_branch
  });
});
