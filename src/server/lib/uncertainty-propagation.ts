/**
 * UNCERTAINTY PROPAGATION — honest under simulation (the capstone of the honesty thread).
 *
 * The honesty stack so far: conserveOrThrow (no silent loss) → explicit-XOR-inferred (no third category) →
 * grounding (no ungrounded claim executes) → span-native (evidence IS a transcript slice). The last gap:
 * a backtest that FLATTENS inferred and grounded nodes into one P&L number is DISHONEST — it can't tell you
 * whether your measured edge came from what the educator TAUGHT or from what the compiler ASSUMED.
 *
 * This layer propagates each node's certainty into the trade, then SEGREGATES backtest results:
 *   - FULLY_GROUNDED      — every EDGE node (event/zone/until/confirmation) is transcript-span-bound
 *   - INFERENCE_DEPENDENT — ≥1 edge node was compiler-inferred (not in the transcript)
 *
 * So the backtest answers the only question that matters for faithful reproduction: "is the edge real, or did
 * the compiler invent it?" If the edge lives only in inference-dependent trades → the edge is NOT the
 * educator's strategy. (Entry order-type is excluded from the edge — it's framework-overlay-owned, legitimately
 * inferred; the EDGE is WHAT/WHEN/WHERE, not the risk mechanics.)
 *
 * Pure / deterministic. Builds on CP5 `confidenceOf` + the span-native provenance.
 */

import type { StrategyIR, Provenance } from "./state-machine-ir.js";
import { confidenceOf } from "./decision-provenance.js";

export type GroundingClass = "FULLY_GROUNDED" | "INFERENCE_DEPENDENT";

export interface TradeGrounding {
  grounding_class: GroundingClass;
  trade_confidence: number;          // weakest-link confidence across edge nodes (uncertainty, propagated)
  inference_dependencies: string[];  // which edge nodes were inferred (the trade leaned on these assumptions)
  span_bound: string[];              // edge nodes that ARE transcript-bound
}

// The EDGE = WHAT/WHEN/WHERE the educator taught. NOT entry order-type (framework-overlay owns risk mechanics).
const EDGE_NODES: Array<[string, (ir: StrategyIR) => { provenance: Provenance } | null | undefined]> = [
  ["structural_event", (ir) => ir.structural_event],
  ["execution_context", (ir) => ir.execution_context],
  ["wait_state.until", (ir) => ir.wait_state.until],
  ["wait_state.confirmation", (ir) => ir.wait_state.confirmation],
];

const isSpanBound = (p: Provenance) => (p.origin === "explicit" || p.origin === "normalized") && !!p.transcript_span;

/** Classify a strategy's edge as fully-grounded vs inference-dependent, and propagate the weakest-link confidence. */
export function tradeGrounding(ir: StrategyIR): TradeGrounding {
  const inference_dependencies: string[] = [];
  const span_bound: string[] = [];
  let minConf = 1;
  for (const [name, get] of EDGE_NODES) {
    const node = get(ir);
    if (!node) continue; // absent edge node — not part of this strategy's edge
    minConf = Math.min(minConf, confidenceOf(node.provenance));
    if (isSpanBound(node.provenance)) span_bound.push(name);
    else inference_dependencies.push(name);
  }
  return {
    grounding_class: inference_dependencies.length === 0 ? "FULLY_GROUNDED" : "INFERENCE_DEPENDENT",
    trade_confidence: Number(minConf.toFixed(3)),
    inference_dependencies,
    span_bound,
  };
}

// ── Backtest honesty: segregate edge by grounding class (the "is the edge real?" report) ──
export interface ClassStats { n: number; total_pnl: number; avg_pnl: number; win_rate: number }
export type EdgeVerdict = "GROUNDED_EDGE" | "INFERENCE_EDGE_SUSPECT" | "MIXED" | "NO_EDGE" | "INSUFFICIENT_DATA";
export interface SegregatedBacktest { fully_grounded: ClassStats; inference_dependent: ClassStats; verdict: EdgeVerdict; note: string }

const stats = (pnls: number[]): ClassStats => {
  const n = pnls.length;
  const total = pnls.reduce((a, b) => a + b, 0);
  return { n, total_pnl: Number(total.toFixed(2)), avg_pnl: n ? Number((total / n).toFixed(3)) : 0, win_rate: n ? Number((pnls.filter((p) => p > 0).length / n).toFixed(3)) : 0 };
};

/**
 * Split a backtest's trades by grounding class and verdict the edge. The dishonest baseline pools them; this
 * exposes whether the edge survives when you keep ONLY the trades the educator actually grounded.
 *  - GROUNDED_EDGE          — fully-grounded trades are profitable (edge is REAL, taught by the educator)
 *  - INFERENCE_EDGE_SUSPECT — edge exists only in inference-dependent trades (the compiler invented the edge)
 *  - MIXED                  — both profitable
 *  - NO_EDGE                — neither profitable
 */
export function segregateBacktest(trades: Array<{ grounding_class: GroundingClass; pnl: number }>, opts?: { minTrades?: number }): SegregatedBacktest {
  const minTrades = opts?.minTrades ?? 5;
  const fg = stats(trades.filter((t) => t.grounding_class === "FULLY_GROUNDED").map((t) => t.pnl));
  const id = stats(trades.filter((t) => t.grounding_class === "INFERENCE_DEPENDENT").map((t) => t.pnl));
  let verdict: EdgeVerdict, note: string;
  if (fg.n < minTrades && id.n < minTrades) { verdict = "INSUFFICIENT_DATA"; note = `need ≥${minTrades} trades per class`; }
  else {
    const fgEdge = fg.n >= minTrades && fg.avg_pnl > 0;
    const idEdge = id.n >= minTrades && id.avg_pnl > 0;
    if (fgEdge && idEdge) { verdict = "MIXED"; note = "edge in both grounded and inferred trades"; }
    else if (fgEdge) { verdict = "GROUNDED_EDGE"; note = "edge survives on transcript-grounded setups — faithful to the educator"; }
    else if (idEdge) { verdict = "INFERENCE_EDGE_SUSPECT"; note = "edge ONLY in inference-dependent trades — the compiler invented the edge, NOT the educator"; }
    else { verdict = "NO_EDGE"; note = "no positive edge in either class"; }
  }
  return { fully_grounded: fg, inference_dependent: id, verdict, note };
}

// ── The scientific-closure experiment: is inference SIGNAL or NOISE, by modality? ──
export type ModalityClass = "FULLY_GROUNDED" | "PERCEPTUAL" | "STRUCTURAL";
export type ModalityVerdict =
  | "GROUNDED_SIGNAL"            // the educator's transcript-grounded edge is real (best case)
  | "PERCEPTUAL_SIGNAL_REAL"    // the inferred PERCEPTUAL operator (confirmation) carries real alpha → inference is faithful signal
  | "STRUCTURAL_SIGNAL_SUSPECT" // edge only from imposed STRUCTURAL rules → likely compiler-invented
  | "MIXED_INFERENCE_SIGNAL"
  | "INFERENCE_NOISE"           // no inference class is profitable → inference is noise
  | "NO_EDGE" | "INSUFFICIENT_DATA";
export interface ModalitySegregation { fully_grounded: ClassStats; perceptual: ClassStats; structural: ClassStats; verdict: ModalityVerdict; note: string }

/**
 * Answer the only remaining scientific axis (operator): "which kinds of inference survive segregation as TRUE
 * predictive signal?" Splits P&L into grounded / perceptual-inference / structural-inference and verdicts
 * whether the inferred edge is faithful (perceptual confirmation captures real alpha) or invented (structural
 * rules the compiler imposed). The real verdict needs real backtest P&L (engine-gated); this is the mechanism.
 */
export function segregateByInferenceModality(trades: Array<{ modality_class: ModalityClass; pnl: number }>, opts?: { minTrades?: number }): ModalitySegregation {
  const minTrades = opts?.minTrades ?? 5;
  const fg = stats(trades.filter((t) => t.modality_class === "FULLY_GROUNDED").map((t) => t.pnl));
  const pc = stats(trades.filter((t) => t.modality_class === "PERCEPTUAL").map((t) => t.pnl));
  const st = stats(trades.filter((t) => t.modality_class === "STRUCTURAL").map((t) => t.pnl));
  const edge = (x: ClassStats) => x.n >= minTrades && x.avg_pnl > 0;
  let verdict: ModalityVerdict, note: string;
  if (fg.n < minTrades && pc.n < minTrades && st.n < minTrades) { verdict = "INSUFFICIENT_DATA"; note = `need ≥${minTrades} trades in a class`; }
  else if (edge(fg)) { verdict = "GROUNDED_SIGNAL"; note = "grounded edge is real — faithful to the educator"; }
  else if (edge(pc) && edge(st)) { verdict = "MIXED_INFERENCE_SIGNAL"; note = "both inference modalities profitable"; }
  else if (edge(pc)) { verdict = "PERCEPTUAL_SIGNAL_REAL"; note = "the inferred perceptual operator (confirmation) carries real alpha — inference is faithful signal, not noise"; }
  else if (edge(st)) { verdict = "STRUCTURAL_SIGNAL_SUSPECT"; note = "edge only from imposed structural rules — likely compiler-invented, not the educator's strategy"; }
  else { verdict = (pc.n >= minTrades || st.n >= minTrades) ? "INFERENCE_NOISE" : "NO_EDGE"; note = "no inference class is profitable"; }
  return { fully_grounded: fg, perceptual: pc, structural: st, verdict, note };
}
