/**
 * DETERMINISTIC GRAPH COMPILER (v1.1 Phase B, 2026-06-29) — the assembler that builds the control-flow graph.
 *
 * Core correction (operator/GPT): dependency edges are NOT extraction outputs — they are DERIVED STRUCTURE.
 * The transcript describes procedural ORDER ("wait for sweep, then MSS, then enter on retest"); the EDGES come
 * from strategy grammar, not language. So the compiler builds 80-95% of the graph deterministically; the LLM is
 * NOT asked to emit edges. This is compiler work: build the CFG deterministically, escalate only ambiguity.
 *
 * Rules:
 *   1. STRUCTURAL SPINE — every atom depends on the nearest prior GROUP of strictly-lower lifecycle rank
 *      (S0<S1<...<S8). Guarantees reachability up the lifecycle. Group-aware so a confluence cluster (N atoms at
 *      one state) all become prerequisites of the next higher atom, not a false sequential chain.
 *   2. AND GROUP — contiguous atoms at the SAME state are PARALLEL prerequisites (conjunction text strengthens it).
 *   3. OR BRANCH — atoms separated by or/either/alternatively/aggressive/conservative are ALTERNATIVE routes.
 *   4. EXCEPTION — INVALIDATE/EXCEPTION/RESET atoms, or text with unless/except/avoid/if-news, are exception edges
 *      (do NOT sit on the prerequisite spine).
 * Pure / deterministic / standalone. No LLM.
 */
import type { AtomType, DecisionAtom } from "./decision-atom.js";

// STRATEGY-LOGICAL progression rank (NOT the raw S-number): preconditions(session/filter) are roots; the spine
// climbs session -> bias -> structure -> retest -> confirmation -> ENTER. Invalidation/exception are off-spine.
const ATOM_RANK: Record<AtomType, number> = {
  WAIT_SESSION: 0, FILTER: 0, WAIT_BIAS: 1,
  WAIT_STRUCTURE: 2, VERIFY_STRUCTURE: 2,
  WAIT_RETEST: 3,
  WAIT_CONFIRMATION: 4, CONFIRM_DIRECTION: 4, ENABLE_ENTRY: 4,
  ENTER: 5,
  INVALIDATE: 6, EXCEPTION: 6, RESET: 6, EXIT_HINT: 6,
};
export const rankOf = (a: DecisionAtom): number => ATOM_RANK[a.type];

export type EdgeRole = "prerequisite" | "and" | "or" | "exception";
export interface GraphEdge { from: string; to: string; role: EdgeRole }
export interface CompiledGraph {
  atoms: DecisionAtom[];          // ordered by transcript position; depends_on populated (prerequisite+and edges)
  edges: GraphEdge[];
  andGroups: string[][];          // clusters of parallel prerequisites
  orBranches: string[][];         // alternative-route atom sets
  reachable: Set<string>;         // atoms that reach an ENTER via the spine
}

const AND_MARK = /\b(and|with|plus|also|both|while)\b|,/i;
const OR_MARK = /\b(or|either|alternativ|aggressive entry|conservative entry|another (type of )?entry)\b/i;
const EXC_MARK = /\b(unless|except|avoid (when|trading)|if news|skip the|fails?|invalidat)\b/i;
const EXC_TYPE = new Set(["INVALIDATE", "EXCEPTION", "RESET"]);

/** Build the CFG deterministically from ordered atoms + the transcript (for lexical branch/exception signals). */
export function compileGraph(atoms: DecisionAtom[], transcript: string): CompiledGraph {
  const ordered = [...atoms].sort((a, b) => (a.provenance.transcript_span?.start ?? 0) - (b.provenance.transcript_span?.start ?? 0));
  const edges: GraphEdge[] = [];
  const gapBefore = (i: number): string => {
    if (i === 0) return "";
    const prevEnd = ordered[i - 1].provenance.transcript_span?.end ?? 0;
    const thisStart = ordered[i].provenance.transcript_span?.start ?? prevEnd;
    return transcript.slice(prevEnd, thisStart).toLowerCase();
  };

  // ── runs: maximal contiguous spans of the SAME lifecycle rank (candidate AND groups) ──
  const runs: number[][] = []; // arrays of indices into `ordered`
  for (let i = 0; i < ordered.length; i++) {
    const prev = runs[runs.length - 1];
    if (prev && rankOf(ordered[prev[0]]) === rankOf(ordered[i]) && !EXC_TYPE.has(ordered[i].type) && !EXC_TYPE.has(ordered[prev[0]].type)) prev.push(i);
    else runs.push([i]);
  }
  const runOf = new Map<number, number>(); runs.forEach((r, ri) => r.forEach((i) => runOf.set(i, ri)));

  const andGroups: string[][] = [];
  for (const r of runs) {
    if (r.length >= 2) { andGroups.push(r.map((i) => ordered[i].id)); for (let k = 1; k < r.length; k++) edges.push({ from: ordered[r[k]].id, to: ordered[r[0]].id, role: "and" }); }
  }

  // ── Rule 1: structural spine — each run depends on the nearest PRIOR run of strictly-lower rank (all members) ──
  const reachableEdges: GraphEdge[] = [];
  for (let ri = 0; ri < runs.length; ri++) {
    const r = runs[ri]; const myRank = rankOf(ordered[r[0]]);
    if (EXC_TYPE.has(ordered[r[0]].type)) continue; // exceptions handled below
    let prereqRun: number[] | undefined;
    for (let pj = ri - 1; pj >= 0; pj--) { if (rankOf(ordered[runs[pj][0]]) < myRank) { prereqRun = runs[pj]; break; } }
    if (prereqRun) for (const a of r) for (const p of prereqRun) edges.push({ from: ordered[a].id, to: ordered[p].id, role: "prerequisite" }), reachableEdges.push({ from: ordered[a].id, to: ordered[p].id, role: "prerequisite" });
  }

  // ── Rule 3: OR branches — atoms preceded by an OR marker are ALTERNATIVES to the previous same-type atom ──
  const orBranches: string[][] = [];
  for (let i = 1; i < ordered.length; i++) {
    if (OR_MARK.test(gapBefore(i))) {
      const prevSame = ordered.slice(0, i).reverse().find((p) => p.type === ordered[i].type);
      if (prevSame) { orBranches.push([prevSame.id, ordered[i].id]); edges.push({ from: ordered[i].id, to: prevSame.id, role: "or" }); }
    }
  }

  // ── Rule 4: exceptions — EXCEPTION/INVALIDATE/RESET atoms (or unless/except text) attach as exception edges to the spine ──
  for (let i = 0; i < ordered.length; i++) {
    const a = ordered[i];
    if (EXC_TYPE.has(a.type) || EXC_MARK.test(gapBefore(i))) {
      const anchor = ordered.slice(0, i).reverse().find((p) => !EXC_TYPE.has(p.type) && rankOf(p) <= rankOf(a));
      if (anchor && anchor.id !== a.id) edges.push({ from: a.id, to: anchor.id, role: "exception" });
    }
  }

  // depends_on (for reachability/closure) = prerequisite + and edges only (the spine; exceptions/or are not prereqs)
  const spine = new Map<string, Set<string>>();
  for (const e of edges) if (e.role === "prerequisite" || e.role === "and") (spine.get(e.from) ?? spine.set(e.from, new Set()).get(e.from)!).add(e.to);
  for (const a of ordered) a.depends_on = [...(spine.get(a.id) ?? [])];

  // reachability: atoms in some TERMINAL's spine closure. ENABLE_ENTRY is a valid executable terminal — many
  // ICT/confluence strategies arm entry ("look for the short") without a literal ENTER atom (operator/GPT).
  const byId = new Map(ordered.map((a) => [a.id, a]));
  const reachable = new Set<string>();
  const visit = (id: string) => { if (reachable.has(id) || !byId.has(id)) return; reachable.add(id); for (const d of byId.get(id)!.depends_on) visit(d); };
  ordered.filter((a) => a.type === "ENTER" || a.type === "ENABLE_ENTRY").forEach((e) => visit(e.id));

  return { atoms: ordered, edges, andGroups, orBranches, reachable };
}
