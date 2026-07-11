/**
 * INFERENCE TAXONOMY — permanent (non-linguistic) vs fixable (extraction gap).
 *
 * The distribution-level measurement (n=38 videos, grounding rate per edge primitive) — WHY is a node inferred?
 *   execution_context 100% · structural_event 96% · until 87% · confirmation 13%
 * Three primitives ground near-universally → LINGUISTIC (named objects). Confirmation grounds at 13%.
 *
 * SCOPED CLAIM (not over-generalized): confirmation is SYSTEMATICALLY UNDER-LINGUIFIED across THIS observed
 * corpus (n=38, instructor-weighted, teaching-modality-uncontrolled). This is a STRONG signal, NOT yet a
 * universal law — purely-verbal / quant / checklist educators may linguify confirmation; the priors must stay
 * overridable as the corpus grows. (Over-generalization is now the main failure mode, not under-extraction.)
 *
 * WHY confirmation under-linguifies (the real insight): it is a PERCEPTUAL DECISION OPERATOR — a visual
 * classification over price action ("you see it react") — NOT a lexical primitive like BOS/FVG (named objects).
 * So inference there is CORRECT; forcing verbatim capture would DEGRADE fidelity. Inference is first-class
 * epistemic structure here, not loss. The system is RIGHT to leave it inferred.
 *
 * Consequence for prioritization: do NOT chase verbatim capture on confirmation (representational floor) —
 * keep it a PERMANENT inference layer (uncertainty-propagation isolates its financial impact). DO fix the rare
 * inference on event/zone/until — those are real EXTRACTION GAPS.
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

/**
 * Inference MODALITY (the one split justified BECAUSE it is economically measurable, per the operator —
 * NOT worldview taxonomy). PERCEPTUAL = a perception/judgment over price action (confirmation, reaction,
 * hesitation) — correctly inference-encoded. STRUCTURAL = an implied rule / missing condition (timing,
 * invalidation, entry mechanics) — a reconstruction the compiler imposes. The open scientific question:
 * which modality survives segregation as TRUE PREDICTIVE SIGNAL (is inference signal or noise?).
 */
export type InferenceModality = "PERCEPTUAL" | "STRUCTURAL";
const PERCEPTUAL_ROLES = new Set(["wait_state.confirmation"]); // perception over price; the rest are structural rules
export function classifyInferenceModality(role: string): InferenceModality {
  return PERCEPTUAL_ROLES.has(role) ? "PERCEPTUAL" : "STRUCTURAL";
}

export interface InferenceAnalysis {
  permanent: string[];        // inferred because the primitive is non-linguistic (don't chase verbatim)
  fixable: string[];          // inferred but the primitive usually grounds → real extraction gap (worth fixing)
  perceptual: string[];       // inferred perceptual operators (confirmation/reaction) — correctly inference-encoded
  structural: string[];       // inferred structural rules — compiler reconstruction
  inference_density: number;  // inferred edge nodes / total edge nodes
  fixable_density: number;    // FIXABLE inference / total edge nodes — the part actually worth reducing
  /** The trade's DOMINANT inference modality (for the economic-reality segregation), or null if grounded. */
  dominant_modality: InferenceModality | null;
}

/** Decompose a trade's inference into permanent/fixable AND perceptual/structural — for prioritization + the P&L experiment. */
export function analyzeInference(g: TradeGrounding, priors: Record<string, number> = CORPUS_GROUNDING_PRIORS): InferenceAnalysis {
  const permanent = g.inference_dependencies.filter((r) => classifyInference(r, priors) === "PERMANENT_NON_LINGUISTIC");
  const fixable = g.inference_dependencies.filter((r) => classifyInference(r, priors) === "FIXABLE_EXTRACTION_GAP");
  const perceptual = g.inference_dependencies.filter((r) => classifyInferenceModality(r) === "PERCEPTUAL");
  const structural = g.inference_dependencies.filter((r) => classifyInferenceModality(r) === "STRUCTURAL");
  const totalEdge = g.inference_dependencies.length + g.span_bound.length;
  // dominant modality: structural inference (an imposed rule) is the higher-attribution-risk class → it wins ties
  const dominant_modality: InferenceModality | null =
    g.inference_dependencies.length === 0 ? null : structural.length >= perceptual.length ? (structural.length ? "STRUCTURAL" : "PERCEPTUAL") : "PERCEPTUAL";
  return {
    permanent, fixable, perceptual, structural,
    inference_density: totalEdge ? g.inference_dependencies.length / totalEdge : 0,
    fixable_density: totalEdge ? fixable.length / totalEdge : 0,
    dominant_modality,
  };
}
