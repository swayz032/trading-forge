/**
 * SPINE DENSITY (2026-06-30, operator/GPT) — the metric conservation can't capture.
 *
 * Ledger D answers "did we lose anything?" (translation fidelity). Spine Density answers "does the engine
 * actually REQUIRE the strategy logic the educator intended before enabling entry?" — i.e. how much of the
 * extracted executable structure is on the prerequisite path to the entry terminal, vs floating off-spine.
 *
 * A graph can conserve every node yet under-represent the dependency chain: scattered same-rank confluences that
 * aren't the "nearest prior" of any higher step never get depended-upon, so nothing requires them before entry.
 *
 * `spineDensity()` measures it. `densifySpine()` REFINES THE COMPILER (not the extractor): it attaches orphan
 * confluence nodes to the nearest downstream executable step as a prerequisite — ONLY when grammar-supported
 * (the orphan is a gating/precondition type) and ONLY by adding prerequisite edges (atoms / AND-groups / OR-branches
 * / framework classification untouched → Ledger D stays CONSERVED). Deterministic / pure / standalone.
 */
import type { CompiledGraph, GraphEdge } from "./graph-compiler.js";
import { rankOf } from "./graph-compiler.js";
import type { AtomType, DecisionAtom } from "./decision-atom.js";

const TERMINAL: ReadonlySet<AtomType> = new Set(["ENTER", "ENABLE_ENTRY"]);
const EXCEPTION: ReadonlySet<AtomType> = new Set(["INVALIDATE", "EXCEPTION", "RESET", "EXIT_HINT"]);
// Grammar-supported attach set: a precondition/confluence that legitimately gates entry (NOT an exception/exit).
const PRECONDITION: ReadonlySet<AtomType> = new Set([
  "WAIT_SESSION", "FILTER", "WAIT_BIAS", "WAIT_STRUCTURE", "VERIFY_STRUCTURE",
  "WAIT_RETEST", "WAIT_CONFIRMATION", "CONFIRM_DIRECTION",
]);

const isExecutable = (a: DecisionAtom): boolean => !EXCEPTION.has(a.type);

export interface SpineDensity {
  reachable_pct: number;            // executable nodes on the path to entry / executable nodes
  confluence_in_chain_pct: number;  // AND-group (confluence) members reachable / AND-group members
  orphan_count: number;             // executable non-terminal nodes NOT reachable from entry
  avg_depth: number;                // mean depends_on distance from the entry terminal over reachable nodes
  orphans: string[];
}

export function spineDensity(graph: CompiledGraph): SpineDensity {
  const exec = graph.atoms.filter(isExecutable);
  const reachableExec = exec.filter((a) => graph.reachable.has(a.id));
  const reachable_pct = exec.length ? reachableExec.length / exec.length : 1;

  const confluenceIds = new Set(graph.andGroups.flat());
  const confl = graph.atoms.filter((a) => confluenceIds.has(a.id));
  const confluence_in_chain_pct = confl.length
    ? confl.filter((a) => graph.reachable.has(a.id)).length / confl.length
    : 1;

  const orphans = exec.filter((a) => !graph.reachable.has(a.id) && !TERMINAL.has(a.type)).map((a) => a.id);

  // avg dependency depth — BFS from the entry terminal(s) along depends_on
  const byId = new Map(graph.atoms.map((a) => [a.id, a]));
  const depth = new Map<string, number>();
  const queue: Array<[string, number]> = graph.atoms.filter((a) => TERMINAL.has(a.type)).map((t) => [t.id, 0]);
  while (queue.length) {
    const [id, d] = queue.shift()!;
    if (depth.has(id) && depth.get(id)! <= d) continue;
    depth.set(id, d);
    for (const dep of byId.get(id)?.depends_on ?? []) queue.push([dep, d + 1]);
  }
  const depths = reachableExec.map((a) => depth.get(a.id) ?? 0);
  const avg_depth = depths.length ? depths.reduce((s, x) => s + x, 0) / depths.length : 0;

  return {
    reachable_pct: Math.round(reachable_pct * 1000) / 1000,
    confluence_in_chain_pct: Math.round(confluence_in_chain_pct * 1000) / 1000,
    orphan_count: orphans.length,
    avg_depth: Math.round(avg_depth * 100) / 100,
    orphans,
  };
}

/**
 * COMPILER REFINEMENT — attach orphan confluence nodes to the executable spine.
 *
 * For each orphan (executable, non-terminal, grammar-supported PRECONDITION type, not reachable), add a
 * prerequisite edge from the nearest DOWNSTREAM reachable step of >= rank (procedural order: a precondition stated
 * before a step must hold before it) — or the entry terminal if none. Only prerequisite EDGES are added; atoms,
 * AND-groups, OR-branches and framework classification are untouched, so Ledger D conservation is preserved.
 * Non-mutating (clones atoms); deterministic (transcript order + nearest-downstream).
 */
export function densifySpine(graph: CompiledGraph): CompiledGraph {
  const ordered = graph.atoms.map((a) => ({ ...a, depends_on: [...a.depends_on] }));
  const byId = new Map(ordered.map((a) => [a.id, a]));
  const origReachable = graph.reachable;
  const edges: GraphEdge[] = [...graph.edges];

  const isOrphan = (a: DecisionAtom): boolean =>
    isExecutable(a) && !TERMINAL.has(a.type) && !origReachable.has(a.id) && PRECONDITION.has(a.type);

  for (let i = 0; i < ordered.length; i++) {
    const o = ordered[i];
    if (!isOrphan(o)) continue;
    // nearest later reachable executable step of >= rank
    let target: DecisionAtom | undefined;
    for (let j = i + 1; j < ordered.length; j++) {
      const c = ordered[j];
      if (origReachable.has(c.id) && isExecutable(c) && rankOf(c) >= rankOf(o)) { target = c; break; }
    }
    // fallback: the entry terminal
    if (!target) target = ordered.find((a) => TERMINAL.has(a.type) && origReachable.has(a.id));
    if (target && target.id !== o.id && !target.depends_on.includes(o.id)) {
      target.depends_on.push(o.id);
      edges.push({ from: target.id, to: o.id, role: "prerequisite" });
    }
  }

  // recompute reachability from the entry terminal(s)
  const reachable = new Set<string>();
  const visit = (id: string) => {
    if (reachable.has(id) || !byId.has(id)) return;
    reachable.add(id);
    for (const d of byId.get(id)!.depends_on) visit(d);
  };
  ordered.filter((a) => TERMINAL.has(a.type)).forEach((t) => visit(t.id));

  return { ...graph, atoms: ordered, edges, reachable };
}
