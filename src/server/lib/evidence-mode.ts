/**
 * EVIDENCE MODE — replay-attribution instrumentation (NOT a fidelity improver).
 *
 * The predicted next failure boundary after confirmation-compiler (operator/GPT 2026-06-28): VISUAL GROUNDING
 * DEBT. Many educators teach decisions that live only on the chart — "short THIS sweep", "valid order block",
 * "nice rejection". The transcript gives the words; the *referent* is visual. When such a strategy fails
 * replay, the cause may be "the strategy is bad" OR "the source required visual data the transcript can't
 * carry." Those are different, and conflating them poisons the replay verdict.
 *
 * This classifier labels a compiled IR by how much of its decisive logic is VISUAL vs LEXICAL (transcript-
 * sufficient / computable), so replay failures can be SEGREGATED before they're interpreted:
 *   - TRANSCRIPT_ONLY  → replay-trustworthy candidate (logic is computable from words)
 *   - VISUAL_REQUIRED  → dangerous candidate (a replay miss may be visual-data debt, not a bad strategy)
 *   - MIXED            → partial; interpret per-node
 *
 * HEURISTIC by construction — the VISUAL/LEXICAL partition is a hypothesis about which concepts are
 * chart-referential, not a proof. Pure / deterministic / standalone (zero production wiring).
 */

import type { StrategyIR } from "./state-machine-ir.js";

export type EvidenceMode = "TRANSCRIPT_ONLY" | "VISUAL_REQUIRED" | "MIXED";

// chart-referential concepts: the referent ("this sweep", "valid OB", "the rejection") is VISUAL, not lexical
const VISUAL_EVENTS = new Set(["sweep", "displacement", "mss", "choch", "bos", "reclaim"]);
const VISUAL_ZONES = new Set(["order_block", "fair_value_gap", "supply_demand"]);
const VISUAL_CONFIRMATION = new Set(["structure_shift", "retest_reject", "displacement"]);
const VISUAL_WAIT = new Set(["sweep", "reclaim"]);
// everything else is LEXICAL/computable: breakout, range_edge, fib_zone, named_level, close_through,
// retest, price_reenters, close_back_inside, tap, now — resolvable from words + price data.

export interface EvidenceModeReport {
  mode: EvidenceMode;
  visual_concepts: string[];   // the chart-referential decisions this IR depends on
  lexical_concepts: string[];  // the computable decisions
  note: string;
}

/** Classify how chart-dependent the compiled IR's decisive logic is (replay-attribution, heuristic). */
export function classifyEvidenceMode(ir: StrategyIR): EvidenceModeReport {
  const visual: string[] = [];
  const lexical: string[] = [];
  const bucket = (label: string, isVisual: boolean) => (isVisual ? visual : lexical).push(label);

  if (ir.structural_event) bucket(`event:${ir.structural_event.event}`, VISUAL_EVENTS.has(ir.structural_event.event));
  if (ir.execution_context) bucket(`zone:${ir.execution_context.zone}`, VISUAL_ZONES.has(ir.execution_context.zone));
  if (ir.wait_state.until.kind !== "now") bucket(`until:${ir.wait_state.until.kind}`, VISUAL_WAIT.has(ir.wait_state.until.kind));
  for (const leg of ir.wait_state.confirmation.compound?.legs ?? []) {
    const k = (leg as { kind?: string }).kind;
    if (k) bucket(`confirm:${k}`, VISUAL_CONFIRMATION.has(k));
  }

  let mode: EvidenceMode;
  if (visual.length === 0) mode = "TRANSCRIPT_ONLY";
  else if (lexical.length === 0) mode = "VISUAL_REQUIRED";
  else mode = "MIXED";

  const note = mode === "VISUAL_REQUIRED"
    ? "all decisive logic is chart-referential — a replay miss may be visual-data debt, NOT a bad strategy"
    : mode === "TRANSCRIPT_ONLY"
      ? "logic is computable from words — replay-trustworthy candidate"
      : "partial visual dependence — interpret replay misses per-node";
  return { mode, visual_concepts: visual, lexical_concepts: lexical, note };
}
