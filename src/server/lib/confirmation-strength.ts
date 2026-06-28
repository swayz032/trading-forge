/**
 * CONFIRMATION-STRENGTH SCORER (Fidelity Phase 3B — the HOW axis).
 *
 * The last frozen-6 residual (2u9): two CHoCH events can both satisfy the STRUCTURAL definition ("price
 * breaks the prior swing") yet the educator treats one as valid and one as a NO-TRADE ("slight reaction…
 * not the confirmation we wanted"). That is not a compiler-correctness problem — it's signal QUALITY
 * discrimination. This is a continuous scorer, NOT binary logic:
 *
 *   Layer A  feature extraction (deterministic market math)
 *   Layer B  weighted aggregation → [0,1] score
 *   Layer C  thresholding → weak | medium | strong
 *
 * Two sides, mirroring context gates:
 *   - EXTRACTION: detect whether the educator REQUIRES strength ("clean/decisive/with displacement",
 *     or rejects weak "we don't want a wick / slight reaction") → emit a strength_requirement on the leg.
 *   - SIGNAL-TIME: score the actual confirmation candle's features; if a required-strong confirmation
 *     scores weak → it's the educator's NO-TRADE tap → don't fire.
 *
 * Pure / deterministic — start interpretable (NOT ML); one residual is not enough to learn a model.
 */

export type StrengthClass = "weak" | "medium" | "strong";

/** Layer A — measurable features of the confirmation candle/break (engine-provided from bars). */
export interface StrengthFeatures {
  range_atr_ratio?: number;     // candle range / ATR — impulse/aggression
  body_ratio?: number;          // |close − open| / (high − low) ∈ [0,1] — conviction (low = wicky/weak)
  break_distance_atr?: number;  // how far close cleared the broken level, in ATR — decisiveness
  follow_through?: number;      // continuation candles after the break (0,1,2,…)
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Layer A normalizers → each sub-score ∈ [0,1]. Conservative caps (institutional "decisive" ≈ 1 ATR break). */
function subScores(f: StrengthFeatures) {
  return {
    impulse: clamp01((f.range_atr_ratio ?? 0) / 2.0),        // 2×ATR range = max impulse
    break_quality: clamp01((f.break_distance_atr ?? 0) / 1.0), // 1 ATR beyond the level = decisive
    candle_quality: clamp01(f.body_ratio ?? 0),               // full body = conviction; long wick = weak
    follow_through: clamp01((f.follow_through ?? 0) / 2.0),    // 2 continuation candles = full
  };
}

/** Layer B weights (operator spec) — break + impulse dominate; candle high; follow-through medium. */
const WEIGHTS = { impulse: 0.3, break_quality: 0.3, candle_quality: 0.25, follow_through: 0.15 };

export interface StrengthResult {
  score: number;            // [0,1]
  classification: StrengthClass;
  rationale: string[];
}

/** Layer B + C — weighted aggregation → score → class, with a human-readable rationale. */
export function scoreConfirmationStrength(features: StrengthFeatures): StrengthResult {
  const s = subScores(features);
  const score =
    s.impulse * WEIGHTS.impulse +
    s.break_quality * WEIGHTS.break_quality +
    s.candle_quality * WEIGHTS.candle_quality +
    s.follow_through * WEIGHTS.follow_through;
  const classification: StrengthClass = score >= 0.75 ? "strong" : score >= 0.45 ? "medium" : "weak";
  const rationale: string[] = [];
  if (s.break_quality >= 0.7) rationale.push("decisive break beyond the level"); else if (s.break_quality < 0.3) rationale.push("barely cleared the level");
  if (s.candle_quality >= 0.7) rationale.push("full-bodied close"); else if (s.candle_quality < 0.3) rationale.push("wicky / small body");
  if (s.impulse >= 0.7) rationale.push("large displacement"); else if (s.impulse < 0.3) rationale.push("low impulse");
  if (s.follow_through >= 0.5) rationale.push("strong continuation"); else if (s.follow_through < 0.25) rationale.push("no follow-through / quick reclaim");
  return { score: Number(score.toFixed(3)), classification, rationale };
}

export const STRENGTH_RANK: Record<StrengthClass, number> = { weak: 0, medium: 1, strong: 2 };

export interface StrengthRequirement {
  required: boolean;
  min: StrengthClass;     // minimum acceptable classification (medium | strong)
  evidence: string;
}

// EXTRACTION — does the educator DEMAND a strong/clean confirmation (vs accepting any structural break)?
const STRONG_REQ_RE =
  /\b(clean (?:change|break|choch|shift)|clear change of character|decisive|strong (?:break|move|displacement|reaction|push)|with displacement|displac\w*|full[- ]body|we don'?t want a wick|no wick|sharp (?:break|move)|aggressive|conviction)\b/i;
// Rejecting a weak confirmation (the no-trade tap) is ALSO a strength requirement.
const WEAK_REJECT_RE =
  /\b(slight reaction|without (?:a )?(?:clear|displacement|conviction)|not (?:the )?confirmation we wanted|weak (?:break|reaction|choch)|no trade|did not get the confirmation)\b/i;
const SOFT_CONFIRM_RE = /\b(confirmation|confirm|qualif|valid)\b/i;

/** Detect a strength requirement from the educator's words around the confirmation. */
export function detectStrengthRequirement(text: string | null | undefined): StrengthRequirement {
  const t = typeof text === "string" ? text : "";
  if (STRONG_REQ_RE.test(t) || WEAK_REJECT_RE.test(t)) {
    const m = t.match(STRONG_REQ_RE) ?? t.match(WEAK_REJECT_RE);
    return { required: true, min: "strong", evidence: m ? t.slice(Math.max(0, (m.index ?? 0) - 20), (m.index ?? 0) + 70).trim() : "" };
  }
  if (SOFT_CONFIRM_RE.test(t)) return { required: true, min: "medium", evidence: "" }; // a stated confirmation ≥ medium
  return { required: false, min: "weak", evidence: "" };
}

/** SIGNAL-TIME — does the actual confirmation meet the educator's strength requirement? */
export function meetsStrengthRequirement(req: StrengthRequirement | undefined, features: StrengthFeatures): boolean {
  if (!req || !req.required) return true;
  return STRENGTH_RANK[scoreConfirmationStrength(features).classification] >= STRENGTH_RANK[req.min];
}
