/**
 * STRATEGY GRAPH FIDELITY (SGF) — v1.1 north-star metric (2026-06-29, operator/GPT).
 *
 * DRR is local instrumentation. The SCIENTIFIC metric is "does the compiled graph preserve the executable
 * strategy?" — scored against a hand-built GOLD graph (the manual audit) across four dimensions:
 *   NR (Node Recall)        — gold atoms we extracted / gold atoms
 *   ER (Edge Recall)        — gold edges we built / gold edges
 *   RG (Reachability)       — is ENTER reachable (1/0)
 *   TF (Topology Fidelity)  — did we preserve AND-groups / OR-branches / exceptions
 * SGF = mean(NR, ER, RG, TF). Pure / deterministic / standalone.
 */
import type { DecisionAtom, AtomType } from "./decision-atom.js";
import type { CompiledGraph, EdgeRole } from "./graph-compiler.js";

export interface GoldNode { key: string; type: AtomType; keywords: string[] } // keywords: any-one match against object_canonical
export interface GoldEdge { from: string; to: string; role: EdgeRole }
export interface GoldGraph { nodes: GoldNode[]; edges: GoldEdge[]; andGroups?: string[][]; orBranches?: string[][] }
export interface SGF { NR: number; ER: number; RG: number; TF: number; SGF: number; matched: Map<string, string> }

const matchAtom = (g: GoldNode, atoms: DecisionAtom[]): DecisionAtom | undefined =>
  atoms.find((a) => a.type === g.type && g.keywords.some((k) => a.object_canonical.includes(k)));

export function scoreSGF(compiled: CompiledGraph, gold: GoldGraph): SGF {
  // NODE RECALL — map each gold node to a compiled atom by type + keyword
  const matched = new Map<string, string>(); // goldKey -> atomId
  for (const g of gold.nodes) { const a = matchAtom(g, compiled.atoms); if (a) matched.set(g.key, a.id); }
  const NR = gold.nodes.length ? matched.size / gold.nodes.length : 1;

  // EDGE RECALL — a gold edge is satisfied if both endpoints matched AND a compiled spine edge connects them
  const spine = new Set(compiled.edges.filter((e) => e.role === "prerequisite" || e.role === "and").map((e) => `${e.from}->${e.to}`));
  let edgeHit = 0;
  for (const e of gold.edges) {
    const f = matched.get(e.from), t = matched.get(e.to);
    if (f && t && (spine.has(`${f}->${t}`) || spine.has(`${t}->${f}`))) edgeHit++;
  }
  const ER = gold.edges.length ? edgeHit / gold.edges.length : 1;

  // REACHABILITY — is some ENTER reachable in the compiled spine
  const RG = compiled.atoms.some((a) => a.type === "ENTER" && compiled.reachable.has(a.id)) ? 1 : 0;

  // TOPOLOGY FIDELITY — fraction of gold AND-groups / OR-branches preserved (+1 free if gold has none)
  const features = (gold.andGroups ?? []).length + (gold.orBranches ?? []).length;
  let topoHit = 0;
  for (const grp of gold.andGroups ?? []) { const ids = grp.map((k) => matched.get(k)).filter(Boolean) as string[]; if (ids.length >= 2 && compiled.andGroups.some((cg) => ids.every((id) => cg.includes(id)))) topoHit++; }
  for (const br of gold.orBranches ?? []) { const ids = br.map((k) => matched.get(k)).filter(Boolean) as string[]; if (ids.length >= 2 && compiled.orBranches.some((cb) => ids.every((id) => cb.includes(id)))) topoHit++; }
  const TF = features ? topoHit / features : 1;

  return { NR, ER, RG, TF, SGF: (NR + ER + RG + TF) / 4, matched };
}

// ── GOLD GRAPHS (hand-built from manual audit; the yardstick) ────────────────────────────────────────────────
export const GOLD: Record<string, GoldGraph> = {
  // psH — price-action opening-range breakout (NY 15m). Largely LINEAR + one bidirectional exception.
  "psH--oXkD8M": {
    nodes: [
      { key: "session", type: "WAIT_SESSION", keywords: ["new york", "york", "session"] },
      { key: "range", type: "WAIT_STRUCTURE", keywords: ["15", "fifteen", "minute", "candle", "mark", "high", "low", "range"] },
      { key: "break", type: "WAIT_STRUCTURE", keywords: ["5", "five", "break", "above", "direction"] },
      { key: "verify", type: "VERIFY_STRUCTURE", keywords: ["strong", "candle", "wick", "engulf"] },
      { key: "retest", type: "WAIT_RETEST", keywords: ["retest", "pullback", "high", "15"] },
      { key: "confirm", type: "WAIT_CONFIRMATION", keywords: ["engulf", "signal", "buyer", "confirm"] },
      { key: "enter", type: "ENTER", keywords: ["enter", "long", "entry", "trade"] },
      { key: "fail", type: "EXCEPTION", keywords: ["fail", "downside", "reject", "indecision", "short", "low"] },
    ],
    edges: [
      { from: "range", to: "session", role: "prerequisite" },
      { from: "break", to: "range", role: "prerequisite" },
      { from: "verify", to: "break", role: "prerequisite" },
      { from: "retest", to: "break", role: "prerequisite" },
      { from: "confirm", to: "retest", role: "prerequisite" },
      { from: "enter", to: "confirm", role: "prerequisite" },
    ],
  },
};
