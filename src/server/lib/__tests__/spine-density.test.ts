import { describe, it, expect } from "vitest";
import type { CompiledGraph } from "../graph-compiler.js";
import type { AtomType, DecisionAtom } from "../decision-atom.js";
import { SPAN } from "../state-machine-ir.js";
import { spineDensity, densifySpine } from "../spine-density.js";
import { ledgerD } from "../handoff-conservation.js";

const a = (id: string, type: AtomType, obj: string, pos: number, deps: string[] = []): DecisionAtom => ({
  id, type, temporal_kind: "event", object: obj, object_canonical: obj, depends_on: [...deps],
  provenance: SPAN(obj, pos, pos + 1),
});

// session → break → ENABLE_ENTRY spine, with a FILTER confluence floating OFF the spine (orphan).
const buildGraphWithOrphan = (): CompiledGraph => {
  const atoms = [
    a("WAIT_SESSION:session#0", "WAIT_SESSION", "new york session", 0),
    a("WAIT_STRUCTURE:break#1", "WAIT_STRUCTURE", "structure break", 10, ["WAIT_SESSION:session#0"]),
    a("FILTER:liq#2", "FILTER", "liquidity confluence", 20),                 // ORPHAN — nothing depends on it
    a("ENABLE_ENTRY:short#3", "ENABLE_ENTRY", "short position", 30, ["WAIT_STRUCTURE:break#1"]),
  ];
  return {
    atoms,
    edges: [
      { from: "WAIT_STRUCTURE:break#1", to: "WAIT_SESSION:session#0", role: "prerequisite" },
      { from: "ENABLE_ENTRY:short#3", to: "WAIT_STRUCTURE:break#1", role: "prerequisite" },
    ],
    andGroups: [],
    orBranches: [],
    reachable: new Set(["ENABLE_ENTRY:short#3", "WAIT_STRUCTURE:break#1", "WAIT_SESSION:session#0"]),
  };
};

describe("Spine Density — metric + compiler densification", () => {
  it("measures an off-spine confluence as an orphan (reachable < 100%)", () => {
    const sd = spineDensity(buildGraphWithOrphan());
    expect(sd.orphan_count).toBe(1);
    expect(sd.orphans).toContain("FILTER:liq#2");
    expect(sd.reachable_pct).toBeLessThan(1); // 3 of 4 executable nodes reachable
  });

  it("densifySpine attaches the orphan to the executable spine → reachability rises to 100%", () => {
    const g = buildGraphWithOrphan();
    const before = spineDensity(g);
    const densified = densifySpine(g);
    const after = spineDensity(densified);
    expect(after.reachable_pct).toBeGreaterThan(before.reachable_pct);
    expect(after.orphan_count).toBe(0);
    expect(densified.reachable.has("FILTER:liq#2")).toBe(true);
  });

  it("densification preserves ALL FIVE Ledger D conservation invariants (CONSERVED, not artificially inflated)", () => {
    const densified = densifySpine(buildGraphWithOrphan());
    const r = ledgerD(densified);
    expect(r.ok).toBe(true);
    for (const inv of r.invariants) expect(inv.ok, inv.name).toBe(true);
  });

  it("is non-mutating: the original graph's reachable set is unchanged", () => {
    const g = buildGraphWithOrphan();
    densifySpine(g);
    expect(g.reachable.has("FILTER:liq#2")).toBe(false); // original untouched
  });

  it("does NOT attach exception/exit atoms (those legitimately stay off-spine)", () => {
    const atoms = [
      a("WAIT_STRUCTURE:break#0", "WAIT_STRUCTURE", "break", 0),
      a("ENTER:long#1", "ENTER", "go long", 10, ["WAIT_STRUCTURE:break#0"]),
      a("INVALIDATE:fail#2", "INVALIDATE", "setup invalidated", 20),  // exception — must remain orphan
    ];
    const g: CompiledGraph = {
      atoms,
      edges: [{ from: "ENTER:long#1", to: "WAIT_STRUCTURE:break#0", role: "prerequisite" }],
      andGroups: [], orBranches: [],
      reachable: new Set(["ENTER:long#1", "WAIT_STRUCTURE:break#0"]),
    };
    const densified = densifySpine(g);
    expect(densified.reachable.has("INVALIDATE:fail#2")).toBe(false); // invalidation stays off-spine
  });
});
