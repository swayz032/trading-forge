/**
 * INFERENCE TAXONOMY — permanent (non-linguistic) vs fixable (extraction gap).
 *
 * The distribution-level measurement (n=38 videos, grounding rate per edge primitive) settled a question the
 * per-video data could not: WHY is a node inferred?
 *   execution_context 100% · structural_event 96% · until 87% · confirmation 13%
 * Three primitives ground near-universally → they are LINGUISTIC (named in words). Confirmation grounds at
 * 13% ACROSS instructors → it is NON-LINGUISTIC BY NATURE (demonstrated on the chart, not described). That is
 * a representational property of trading pedagogy, not a parser bug and not instructor-specific.
 *
 * Consequence for prioritization (operator's correction): do NOT chase verbatim capture on confirmation — it
 * has a representational floor. Mark it a PERMANENT inference layer (uncertainty-propagation already isolates
 * its financial impact). DO fix the rare inference on event/zone/until — those are real EXTRACTION GAPS.
 *
 * Pure / deterministic. Priors are empirical (this corpus) and overridable as the corpus grows.
 */

import type { TradeGrounding } from "./uncertainty-propagation.js";

/** Empirical per-role grounding rate (n=38, 2026-06-28). Update as the corpus expands. */
export const CORPUS_GROUNDING_PRIORS: Record<string, number> = {
  structural_event: 0.96,
  execution_context: 1.0,
  "wait_state.until": 0.87,
  "wait_state.confirmation": 0.13,
};

export type InferenceClass = "PERMANENT_NON_LINGUISTIC" | "FIXABLE_EXTRACTION_GAP";

/**
 * Classify WHY a node is inferred. A role that grounds rarely across the whole corpus is non-linguistic by
 * nature (permanent); a role that usually grounds but didn't HERE is a fixable extraction gap.
 */
export function classifyInference(role: string, priors: Record<string, number> = CORPUS_GROUNDING_PRIORS, threshold = 0.4): InferenceClass {
  const prior = priors[role] ?? 0.5;
  return prior < threshold ? "PERMANENT_NON_LINGUISTIC" : "FIXABLE_EXTRACTION_GAP";
}

export interface InferenceAnalysis {
  permanent: string[];        // inferred because the primitive is non-linguistic (don't chase verbatim)
  fixable: string[];          // inferred but the primitive usually grounds → real extraction gap (worth fixing)
  inference_density: number;  // inferred edge nodes / total edge nodes (the operator's optimization target)
  fixable_density: number;    // FIXABLE inference / total edge nodes — the part actually worth reducing
}

/** Decompose a trade's inference into permanent vs fixable — directs effort at what can actually be reduced. */
export function analyzeInference(g: TradeGrounding, priors: Record<string, number> = CORPUS_GROUNDING_PRIORS): InferenceAnalysis {
  const permanent = g.inference_dependencies.filter((r) => classifyInference(r, priors) === "PERMANENT_NON_LINGUISTIC");
  const fixable = g.inference_dependencies.filter((r) => classifyInference(r, priors) === "FIXABLE_EXTRACTION_GAP");
  const totalEdge = g.inference_dependencies.length + g.span_bound.length;
  return {
    permanent,
    fixable,
    inference_density: totalEdge ? g.inference_dependencies.length / totalEdge : 0,
    fixable_density: totalEdge ? fixable.length / totalEdge : 0,
  };
}
