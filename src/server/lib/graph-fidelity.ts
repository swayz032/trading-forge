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

// types = the SET of acceptable atom types (gemma's type labels are noisy — a "break" may be tagged
// WAIT_STRUCTURE / WAIT_CONFIRMATION / VERIFY_STRUCTURE across runs; NodeRecall must measure DECISION capture,
// not label precision). keywords = distinguishing CONCEPT tokens (de-aliased so each gold node is separable).
export interface GoldNode { key: string; types: AtomType[]; keywords: string[] }
export interface GoldEdge { from: string; to: string; role: EdgeRole }
export interface GoldGraph { nodes: GoldNode[]; edges: GoldEdge[]; andGroups?: string[][]; orBranches?: string[][] }
export interface SGF { NR: number; ER: number; RG: number; TF: number; SGF: number; matched: Map<string, string> }

// match the gold node to the FIRST unclaimed atom whose type is acceptable AND whose object carries a concept token
// Numeral<->word normalization (2026-07-02): "15" and "fifteen" are the same concept token — gemma emits either
// across runs. Normalizing both sides prevents false gold misses on timeframe-qualified objects.
const NUM_WORDS: Array<[RegExp, string]> = [
  [/fifteen/g, "15"], [/thirty/g, "30"], [/sixty/g, "60"], [/forty[- ]?five/g, "45"],
  [/twenty/g, "20"], [/ten/g, "10"], [/five/g, "5"], [/four/g, "4"], [/one/g, "1"],
];
const normNums = (t: string): string => NUM_WORDS.reduce((acc, [re, d]) => acc.replace(re, d), t);
const matchAtom = (g: GoldNode, atoms: DecisionAtom[], claimed: Set<string>): DecisionAtom | undefined =>
  atoms.find((a) => !claimed.has(a.id) && g.types.includes(a.type)
    && g.keywords.some((k) => normNums(a.object_canonical).includes(normNums(k))));

/** Atom Purity = gold atoms / extracted atoms. The fraction of extracted atoms that are essential. Low AP = pollution. */
export const atomPurity = (extractedCount: number, gold: GoldGraph): number => gold.nodes.length / Math.max(1, extractedCount);

export function scoreSGF(compiled: CompiledGraph, gold: GoldGraph): SGF {
  // NODE RECALL — map each gold node to a DISTINCT compiled atom (claimed-set prevents one atom satisfying two)
  const matched = new Map<string, string>(); const claimed = new Set<string>();
  for (const g of gold.nodes) { const a = matchAtom(g, compiled.atoms, claimed); if (a) { matched.set(g.key, a.id); claimed.add(a.id); } }
  const NR = gold.nodes.length ? matched.size / gold.nodes.length : 1;

  // EDGE RECALL — a gold edge is satisfied if both endpoints matched AND a compiled edge (any role) connects them
  const edgeSet = new Set(compiled.edges.map((e) => `${e.from}->${e.to}`));
  let edgeHit = 0;
  for (const e of gold.edges) {
    const f = matched.get(e.from), t = matched.get(e.to);
    if (f && t && (edgeSet.has(`${f}->${t}`) || edgeSet.has(`${t}->${f}`))) edgeHit++;
  }
  const ER = gold.edges.length ? edgeHit / gold.edges.length : 1;

  // REACHABILITY — is some executable TERMINAL (ENTER or ENABLE_ENTRY) reachable in the compiled spine
  const RG = compiled.atoms.some((a) => (a.type === "ENTER" || a.type === "ENABLE_ENTRY") && compiled.reachable.has(a.id)) ? 1 : 0;

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
  // psH — price-action opening-range breakout (NY 15m). NODE granularity: 7 executable decisions; "strong candle /
  // engulfing / no-wick" are PREDICATES of the break/confirm nodes, NOT separate gold nodes. Types are SETS
  // (gemma labels the break as STRUCTURE or CONFIRMATION across runs); keywords are de-aliased CONCEPT tokens.
  "psH--oXkD8M": {
    nodes: [
      { key: "session", types: ["WAIT_SESSION", "FILTER", "WAIT_BIAS"], keywords: ["new york", "york", "session"] },
      { key: "range", types: ["WAIT_STRUCTURE", "VERIFY_STRUCTURE"], keywords: ["range", "opening", "first", "mark", "fifteen", "low and high"] },
      { key: "break", types: ["WAIT_STRUCTURE", "WAIT_CONFIRMATION", "VERIFY_STRUCTURE", "CONFIRM_DIRECTION"], keywords: ["break", "breakout", "broke", "move away", "displacement", "strong move", "above"] },
      { key: "retest", types: ["WAIT_RETEST", "WAIT_STRUCTURE"], keywords: ["retest", "pullback", "rejection", "reject"] },
      { key: "confirm", types: ["WAIT_CONFIRMATION", "CONFIRM_DIRECTION", "ENABLE_ENTRY", "VERIFY_STRUCTURE"], keywords: ["engulf", "buyer", "buying", "confirm", "signal", "closed candle", "closing at highs"] },
      { key: "enter", types: ["ENTER", "ENABLE_ENTRY"], keywords: ["enter", "long", "take trade", "trade entry", "entry"] },
      { key: "downside", types: ["EXCEPTION", "INVALIDATE", "RESET", "ENTER"], keywords: ["downside", "short", "fail", "reverse", "towards downside"] },
    ],
    edges: [
      { from: "range", to: "session", role: "prerequisite" },
      { from: "break", to: "range", role: "prerequisite" },
      { from: "retest", to: "break", role: "prerequisite" },
      { from: "confirm", to: "retest", role: "prerequisite" },
      { from: "enter", to: "confirm", role: "prerequisite" },
      { from: "downside", to: "range", role: "exception" },
    ],
  },

  // l-2 — ICT FOUR-CONFLUENCE (daily/4h, shorts): structure + premium/discount fib + supply/demand + liquidity -> short.
  "l-2iKbcm5UI": {
    nodes: [
      { key: "structure", types: ["WAIT_BIAS", "WAIT_STRUCTURE", "FILTER"], keywords: ["market structure", "swing", "bearish", "lower high", "lower low", "structure break", "range"] },
      { key: "discount", types: ["WAIT_RETEST", "FILTER", "WAIT_STRUCTURE"], keywords: ["premium", "discount", "fib", "retrace", "fifty", "0.5", "half"] },
      { key: "supply", types: ["VERIFY_STRUCTURE", "WAIT_STRUCTURE", "FILTER"], keywords: ["supply", "demand", "reversal", "zone"] },
      { key: "liquidity", types: ["FILTER", "WAIT_STRUCTURE", "WAIT_RETEST"], keywords: ["liquidity", "bump", "taken out", "sweep"] },
      { key: "enter", types: ["ENTER", "ENABLE_ENTRY"], keywords: ["short", "sell", "enter", "trade", "position"] },
    ],
    edges: [
      { from: "discount", to: "structure", role: "prerequisite" },
      { from: "supply", to: "discount", role: "prerequisite" },
      { from: "liquidity", to: "supply", role: "prerequisite" },
      { from: "enter", to: "liquidity", role: "prerequisite" },
    ],
  },

  // h6T — EMA10/20 CROSSOVER + CCI CONFIRMATION (both directions): cross + CCI-confirm (+ optional pullback) -> enter.
  "h6TnE7QClJg": {
    nodes: [
      { key: "ema_cross", types: ["WAIT_STRUCTURE", "WAIT_CONFIRMATION", "CONFIRM_DIRECTION", "FILTER"], keywords: ["ema", "cross", "moving average", "10", "20", "momentum"] },
      { key: "cci_confirm", types: ["WAIT_CONFIRMATION", "VERIFY_STRUCTURE", "CONFIRM_DIRECTION", "FILTER"], keywords: ["cci", "zero", "commodity", "confirm", "hundred", "strength"] },
      { key: "retest", types: ["WAIT_RETEST", "WAIT_STRUCTURE"], keywords: ["pullback", "pull back", "retest", "back to"] },
      { key: "enter", types: ["ENTER", "ENABLE_ENTRY"], keywords: ["enter", "buy", "sell", "trade", "close of", "confirmation candle"] },
    ],
    edges: [
      { from: "cci_confirm", to: "ema_cross", role: "prerequisite" },
      { from: "retest", to: "ema_cross", role: "prerequisite" },
      { from: "enter", to: "cci_confirm", role: "prerequisite" },
    ],
  },

  // MKsj — TWO-LINE 15m reversal (Forex vs USD): session+TF / two lines (17:00 + midnight open) / above-or-below bias /
  // Asia-sweep / weakness-reversal -> enter. Denser strategy (~6 executable decisions).
  "MKsjbL0WNjg": {
    nodes: [
      { key: "session", types: ["WAIT_SESSION", "FILTER"], keywords: ["session", "asia", "london", "new york", "time", "15 minute", "forex", "dollar"] },
      { key: "lines", types: ["WAIT_STRUCTURE", "FILTER"], keywords: ["line", "level", "open", "midnight", "17", "two lines"] },
      { key: "bias", types: ["WAIT_BIAS", "FILTER", "WAIT_STRUCTURE"], keywords: ["bias", "above both", "below both", "direction", "sell", "buy"] },
      { key: "sweep", types: ["WAIT_STRUCTURE", "VERIFY_STRUCTURE"], keywords: ["sweep", "liquidity", "higher low", "breakout", "asia"] },
      { key: "weakness", types: ["WAIT_CONFIRMATION", "VERIFY_STRUCTURE", "CONFIRM_DIRECTION"], keywords: ["weakness", "reversal", "overextended", "engulf", "wick", "reverse"] },
      { key: "enter", types: ["ENTER", "ENABLE_ENTRY"], keywords: ["enter", "trade", "entry", "position", "catch"] },
    ],
    edges: [
      { from: "lines", to: "session", role: "prerequisite" },
      { from: "bias", to: "lines", role: "prerequisite" },
      { from: "sweep", to: "bias", role: "prerequisite" },
      { from: "weakness", to: "sweep", role: "prerequisite" },
      { from: "enter", to: "weakness", role: "prerequisite" },
    ],
  },
};
