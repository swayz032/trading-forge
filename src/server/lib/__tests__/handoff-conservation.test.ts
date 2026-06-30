import { describe, it, expect } from "vitest";
import { compileGraph } from "../graph-compiler.js";
import type { AtomType, DecisionAtom } from "../decision-atom.js";
import { SPAN } from "../state-machine-ir.js";
import { compileToEngineSpec } from "../graph-to-engine.js";
import { ledgerD } from "../handoff-conservation.js";

let n = 0;
const atom = (type: AtomType, object: string, start: number): DecisionAtom => ({
  id: `${type}:${object.replace(/\s+/g, "_")}#${n++}`,
  type,
  temporal_kind: "event",
  object,
  object_canonical: object,
  depends_on: [],
  provenance: SPAN(object, start, start + object.length),
});

// An l-2-style confluence strategy: session/bias → 3 parallel confluences (AND) → ENABLE_ENTRY.
const buildGraph = () => {
  n = 0;
  const atoms = [
    atom("WAIT_SESSION", "new york session", 0),
    atom("WAIT_BIAS", "bearish market structure", 30),
    atom("WAIT_STRUCTURE", "discount premium fib", 70),     // confluence cluster (same rank → AND)
    atom("VERIFY_STRUCTURE", "supply demand zone", 110),
    atom("FILTER", "liquidity sweep", 150),
    atom("ENABLE_ENTRY", "short position", 190),
  ];
  return compileGraph(atoms, "x".repeat(400));
};

describe("Ledger D — graph→engine handoff conservation", () => {
  it("conserves a validated confluence graph end-to-end (all 5 invariants pass)", () => {
    const r = ledgerD(buildGraph());
    expect(r.ok).toBe(true);
    for (const inv of r.invariants) expect(inv.ok, `${inv.name}: ${inv.offenders.join(",")}`).toBe(true);
  });

  it("every source-owned atom becomes exactly one engine condition (no loss, no add)", () => {
    const g = buildGraph();
    const spec = compileToEngineSpec(g);
    const condIds = new Set([...spec.entry_conditions, ...spec.invalidations].map((c) => c.id));
    // all 6 source atoms present, nothing invented
    expect(condIds.size).toBe(g.atoms.length);
    for (const a of g.atoms) expect(condIds.has(a.id)).toBe(true);
  });

  it("AND-group survives as an engine and_group with the same ids", () => {
    const g = buildGraph();
    const spec = compileToEngineSpec(g);
    expect(g.andGroups.length).toBeGreaterThan(0);
    for (const grp of g.andGroups) {
      const survived = spec.and_groups.some((sg) => grp.every((id) => sg.includes(id)));
      expect(survived, `AND group ${grp.join("+")} not preserved`).toBe(true);
    }
  });

  it("the reachable ENABLE_ENTRY terminal becomes the entry trigger", () => {
    const spec = compileToEngineSpec(buildGraph());
    expect(spec.entry_trigger_id).not.toBeNull();
    expect(spec.direction).toBe("short");
  });

  it("framework-owned risk objects never become required entry conditions", () => {
    n = 0;
    // inject a framework-owned atom (stop loss) alongside source atoms
    const atoms = [
      atom("WAIT_STRUCTURE", "liquidity sweep", 0),
      atom("ENTER", "go long", 40),
      atom("EXIT_HINT", "take profit at target", 80),   // framework-owned object
    ];
    const g = compileGraph(atoms, "x".repeat(200));
    const spec = compileToEngineSpec(g);
    // the take-profit/framework atom must NOT appear as a source entry condition
    const objs = spec.entry_conditions.map((c) => c.object).join(" ");
    expect(/take ?profit|target/i.test(objs)).toBe(false);
    expect(spec.framework_overlay.take_profit).toBe("framework_owned");
    // and Ledger D still conserves (the framework atom is legitimately excluded, not "lost")
    expect(ledgerD(g).ok).toBe(true);
  });
});
