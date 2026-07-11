/**
 * PLACEABILITY scorer (2026-06-24 Layer 2 — operator metric definitions).
 *
 * Placeability answers: "Could a competent MES/MNQ/MCL trader place the trade from the extraction
 * ALONE?" It is DISTINCT from Coverage (did we capture concepts?), Compilability (can the engine
 * instantiate?), and Fidelity (does compiled behavior match the source?). The blind-reconstruction
 * audit proved high coverage can coexist with zero placeability — so this is scored separately.
 *
 * Deterministic field-completeness scorer = the repeatable regression metric. Weighted per operator:
 *   Trigger 30 (DOMINATES + hard-fail) · Stop/invalidation 20 · Direction 15 · Setup 15 ·
 *   Entry-method 10 · Session 10.
 * Without a deterministic trigger, placeability HARD-FAILS regardless of the other fields.
 *
 * What this scorer CANNOT see (needs the transcript + a semantic grader — the LLM blind pass):
 *   - whether a PRESENT trigger is deterministic vs discretionary (SOURCE_VAGUE, e.g. gdd), and
 *   - the true 5-way direction class (BIDIRECTIONAL_EXPLICIT vs LONG_WITH_IMPLIED_MIRROR), which
 *     requires the long/short RULE SETS, not just the single `direction` field.
 * Those are layered on top by the grader; this scorer flags them for validation.
 */

import { entryIndicatorResolvesToArchetype } from "./archetype-registry-keys.js";
import type { SessionFilter } from "./session-filter.js";
import type { DirectionMetadata, DirectionClass } from "./direction-parity.js";

export const PLACEABILITY_WEIGHTS = {
  trigger: 30,
  stop: 20,
  direction: 15,
  setup: 15,
  entry_method: 10,
  session: 10,
} as const;

/** Default score threshold (in addition to the trigger hard-fail) for `placeable=true`. */
export const PLACEABILITY_PASS_SCORE = Number(process.env.PLACEABILITY_PASS_SCORE) || 70;

export type PlaceabilityFailureReason =
  | "NO_TRIGGER"
  | "UNCATALOGUED_INDICATOR"
  | "PARAMS_REQUIRED"
  | "STOP_MISSING"
  | "SETUP_MISSING"
  | "ENTRY_METHOD_MISSING"
  | "SESSION_MISSING"
  // Layer 3B (replaces the catch-all DIRECTION_AMBIGUOUS):
  | "NO_DIRECTION_EVIDENCE" // no directional language taught at all
  | "INSUFFICIENT_DIRECTIONAL_PARITY"; // direction claimed (esp. "both") but long/short parity unresolved

/**
 * Coarse deterministic direction label. The full 5-class model (LONG_ONLY / SHORT_ONLY /
 * BIDIRECTIONAL_EXPLICIT / LONG_WITH_IMPLIED_MIRROR / SHORT_WITH_IMPLIED_MIRROR) requires the
 * long/short RULE SETS and is assigned by the grader; the scorer returns the field-level label.
 */
export type DirectionLabel = "LONG_ONLY" | "SHORT_ONLY" | "BIDIRECTIONAL_OR_IMPLIED" | "UNSPECIFIED";

export interface PlaceabilityInput {
  direction?: string | null;
  /** Layer 3B evidence-based directionality (from classifyDirectionFromTranscript). Authoritative
   *  when present; falls back to the coarse `direction` string field otherwise. */
  direction_evidence?: DirectionMetadata | null;
  entry_indicator?: string | null;
  archetype?: string | null;
  /** deriveEntryIndicator() output, if the caller computed it (sharpens trigger classification). */
  resolved_entry_indicator?: string | null;
  entry_condition?: string | null;
  entry_type?: string | null;
  entry_params?: Record<string, unknown> | null;
  entry_sequence?: Array<{ action?: string; rationale?: string | null }> | null;
  confluences?: Array<{ name?: string; description?: string }> | null;
  session_filter?: string | null;
  /** Structured session (Layer 3A) — authoritative when present; falls back to session_filter string. */
  session_window?: SessionFilter | null;
  /** Any structural stop/invalidation signal the extraction carries (risk_rules text or a stop field). */
  risk_rules?: string | null;
  stop?: unknown;
}

export interface PlaceabilityVerdict {
  placeable: boolean;
  placeability_score: number; // 0–100
  field_scores: Record<keyof typeof PLACEABILITY_WEIGHTS, number>;
  failure_reasons: PlaceabilityFailureReason[];
  missing_fields: string[];
  /** Coarse field-derived label (kept for backward-compat). */
  direction_label: DirectionLabel;
  /** Layer 3B evidence-based 5-class directionality when direction_evidence was supplied. */
  direction_class?: DirectionClass;
}

function nonEmptyStr(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/** Trigger classification mirrors the compilability gate so the two metrics never disagree. */
function classifyTrigger(input: PlaceabilityInput): {
  present: boolean;
  reason: Extract<PlaceabilityFailureReason, "NO_TRIGGER" | "UNCATALOGUED_INDICATOR" | "PARAMS_REQUIRED"> | null;
} {
  const hasParams =
    input.entry_params != null &&
    typeof input.entry_params === "object" &&
    Object.keys(input.entry_params).length > 0;
  const hasCondition = nonEmptyStr(input.entry_condition);
  const resolved = nonEmptyStr(input.resolved_entry_indicator) ? input.resolved_entry_indicator!.trim().toLowerCase() : "";
  const isStructural = resolved
    ? resolved.startsWith("archetype:") && entryIndicatorResolvesToArchetype(resolved)
    : entryIndicatorResolvesToArchetype(input.entry_indicator) || entryIndicatorResolvesToArchetype(input.archetype);

  if (isStructural || hasParams || hasCondition) return { present: true, reason: null };

  const isUncatalogued = resolved.startsWith("uncatalogued:");
  const resolvedIsParametric = resolved.length > 0 && !resolved.startsWith("archetype:") && !isUncatalogued;
  const hasNamedIndicator = nonEmptyStr(input.entry_indicator) || nonEmptyStr(input.archetype) || resolvedIsParametric;
  if (isUncatalogued) return { present: false, reason: "UNCATALOGUED_INDICATOR" };
  if (hasNamedIndicator) return { present: false, reason: "PARAMS_REQUIRED" };
  return { present: false, reason: "NO_TRIGGER" };
}

function directionLabel(direction: string | null | undefined): DirectionLabel {
  if (!nonEmptyStr(direction)) return "UNSPECIFIED";
  const d = direction.trim().toLowerCase();
  if (d === "long") return "LONG_ONLY";
  if (d === "short") return "SHORT_ONLY";
  if (d === "both" || d === "bidirectional") return "BIDIRECTIONAL_OR_IMPLIED";
  return "UNSPECIFIED";
}

/** Heuristic: does the entry_sequence text carry a structural stop/invalidation anchor? */
const STOP_ANCHOR_RE = /\b(stop|invalidat|below the|above the|beyond the|order block|swing (low|high)|structure)\b/i;

/**
 * Pure deterministic placeability score. No I/O, no throw.
 */
export function scorePlaceability(input: PlaceabilityInput): PlaceabilityVerdict {
  const failure_reasons: PlaceabilityFailureReason[] = [];
  const missing_fields: string[] = [];
  const field_scores = { trigger: 0, stop: 0, direction: 0, setup: 0, entry_method: 0, session: 0 } as Record<
    keyof typeof PLACEABILITY_WEIGHTS,
    number
  >;

  // TRIGGER (30, dominant, hard-fail)
  const trig = classifyTrigger(input);
  if (trig.present) {
    field_scores.trigger = PLACEABILITY_WEIGHTS.trigger;
  } else {
    missing_fields.push("entry_trigger");
    if (trig.reason) failure_reasons.push(trig.reason);
  }

  // DIRECTION (15) — Layer 3B evidence-based when direction_evidence supplied, else field fallback.
  const dirLabel = directionLabel(input.direction);
  let direction_class: DirectionClass | undefined;
  const ev = input.direction_evidence;
  if (ev) {
    direction_class = ev.class;
    if (ev.class === "NO_DIRECTION_EVIDENCE") {
      missing_fields.push("direction");
      failure_reasons.push("NO_DIRECTION_EVIDENCE");
    } else {
      field_scores.direction = PLACEABILITY_WEIGHTS.direction;
      // The extraction claims "both" but transcript evidence does NOT show explicit both-sides →
      // parity unresolved (the "both" is an assumption, possibly a dropped explicit short — W7nln).
      const claimsBoth = nonEmptyStr(input.direction) && input.direction.trim().toLowerCase() === "both";
      if (claimsBoth && ev.class !== "BIDIRECTIONAL_EXPLICIT") {
        failure_reasons.push("INSUFFICIENT_DIRECTIONAL_PARITY");
      }
    }
  } else {
    // Fallback (no transcript evidence): coarse field-based label.
    if (dirLabel === "UNSPECIFIED") {
      missing_fields.push("direction");
      failure_reasons.push("NO_DIRECTION_EVIDENCE");
    } else {
      field_scores.direction = PLACEABILITY_WEIGHTS.direction;
      if (dirLabel === "BIDIRECTIONAL_OR_IMPLIED") failure_reasons.push("INSUFFICIENT_DIRECTIONAL_PARITY");
    }
  }

  // SETUP (15) — market-structure / setup construction described
  const seqLen = Array.isArray(input.entry_sequence) ? input.entry_sequence.length : 0;
  const conflLen = Array.isArray(input.confluences) ? input.confluences.length : 0;
  if (seqLen >= 2 || conflLen >= 1) {
    field_scores.setup = PLACEABILITY_WEIGHTS.setup;
  } else {
    missing_fields.push("setup");
    failure_reasons.push("SETUP_MISSING");
  }

  // STOP / INVALIDATION (20)
  const seqText = Array.isArray(input.entry_sequence)
    ? input.entry_sequence.map((s) => `${s.action ?? ""} ${s.rationale ?? ""}`).join(" ")
    : "";
  const hasStop = nonEmptyStr(input.risk_rules) || input.stop != null || STOP_ANCHOR_RE.test(seqText);
  if (hasStop) {
    field_scores.stop = PLACEABILITY_WEIGHTS.stop;
  } else {
    missing_fields.push("stop_invalidation");
    failure_reasons.push("STOP_MISSING");
  }

  // ENTRY METHOD (10)
  if (nonEmptyStr(input.entry_type) || seqLen >= 1) {
    field_scores.entry_method = PLACEABILITY_WEIGHTS.entry_method;
  } else {
    missing_fields.push("entry_method");
    failure_reasons.push("ENTRY_METHOD_MISSING");
  }

  // SESSION (10) — structured session_window (Layer 3A) is authoritative; a non-empty session_filter
  // string also satisfies it (backward-compat). A structured window needs a region OR a start time.
  const hasStructuredSession =
    input.session_window != null &&
    (nonEmptyStr(input.session_window.region) || nonEmptyStr(input.session_window.start));
  if (hasStructuredSession || nonEmptyStr(input.session_filter)) {
    field_scores.session = PLACEABILITY_WEIGHTS.session;
  } else {
    missing_fields.push("session_filter");
    failure_reasons.push("SESSION_MISSING");
  }

  const placeability_score =
    field_scores.trigger +
    field_scores.stop +
    field_scores.direction +
    field_scores.setup +
    field_scores.entry_method +
    field_scores.session;

  // Hard-fail without a trigger, regardless of score.
  const placeable = trig.present && placeability_score >= PLACEABILITY_PASS_SCORE;

  return { placeable, placeability_score, field_scores, failure_reasons, missing_fields, direction_label: dirLabel, direction_class };
}
