/**
 * CONFIRMATION-EVENT COMPILER (2026-06-24 Fidelity Phase 1).
 *
 * The 6-video fidelity probe proved the dominant divergence: the educator's entry-validating
 * CONFIRMATION event lives in prose; the engine runs a generic archetype that arms on a passive
 * level-TOUCH instead of the educator's ACTIVE confirmation → over-fires (takes setups the educator
 * rejects). This compiler turns that confirmation into a testable predicate, grounded by a verbatim
 * quote, FAIL-CLOSED (uncertainty → quarantine, never a looser trigger).
 *
 * INVARIANT: this can only ever make a trigger STRICTER (touch → close-through) or quarantine — it
 * never makes a trigger looser, so it cannot introduce a false/over-firing compilation. FALSE
 * COMPILATIONS stay exactly 0 by construction.
 */

import { toWindows } from "./text-windows.js";
import {
  triggerFeaturesFromText,
  triggerSpecificity,
  predicateLevelIsNamed,
  maxFeatures,
  computeScl,
  sclMaxTolerance,
  sclGateEnabled,
  type TriggerFeatures,
} from "./specificity-score.js";

export type ConfirmationKind = "close_through" | "structure_shift" | "retest_reject" | "displacement";

export type ConfirmationQuarantineReason =
  | "no_confirmation_event" // educator stated no confirmation (or extraction lost it)
  | "confirmation_would_overfire" // only a passive touch/tap present — compiling it would over-fire
  | "confirmation_no_level" // active confirmation but no anchor level identifiable
  | "confirmation_unmapped" // confirmation language present but not mappable to a primitive
  | "semantic_compression_loss"; // Phase 2A — compiled predicate dropped too much edge specificity (SCL gate)

export type LevelRef =
  | "opening_range_edge" | "opening_price" | "prior_swing" | "order_block"
  | "overnight_high_low" | "session_level" | "range_edge";

export interface ConfirmationPredicate {
  kind: ConfirmationKind;
  level_ref: LevelRef | null; // null only for displacement (level optional there)
  confluence?: string; // e.g. "fair_value_gap" for retest_reject
  evidence_quote: string; // verbatim grounding (anti-fabrication)
  /**
   * Direction-explicit break rule (fixes the 2u9 mis-mapping where one quote conflated long/short).
   * For a break/shift, LONG = break above the swing high, SHORT = break below the swing low — never
   * collapsed into a single side. Present for structure_shift / close_through.
   */
  directional_rule?: { long?: string; short?: string };
}

export interface ConfirmationResult {
  compiled: ConfirmationPredicate | null;
  quarantine_reason: ConfirmationQuarantineReason | null;
  /** Phase 2A telemetry — populated whenever a candidate was selected (compiled OR SCL-quarantined). */
  scl?: number; // Semantic Compression Loss: triggerSpecificity(edge) − triggerSpecificity(predicate)
  edge_specificity?: number;
  predicate_specificity?: number;
  /** Phase 2B target — ordered legs in the source beyond the single compiled predicate (advisory, not gated in 2A). */
  multi_leg_gap?: number;
}

export interface ConfirmationInput {
  /** Full transcript (ground truth for the confirmation language). */
  transcript?: string | null;
  /** entry_sequence steps (secondary source). */
  entry_sequence?: Array<{ action?: string; rationale?: string | null }> | null;
  /** confluence names (helps resolve retest_reject confluence + level). */
  confluences?: string[] | null;
  /** strategy directionality (Layer 3B class or raw "long"/"short"/"both") — builds the directional_rule. */
  direction_class?: string | null;
}

// ── ACTIVE confirmation language (the strict, correct trigger) ────────────────
const ACTIVE_CLOSE_RE =
  /\b(?:close[sd]?|closing|body\s+close|candle\s+close[sd]?|full\s+body\s+candle)\b[^.!?]{0,40}\b(?:above|below|outside|through|past|beyond)\b|\btrade[sd]?\s+through\b|\bbreaks?\s+(?:and\s+(?:closes?|rebalanc)|above|below|out of|outside)\b/i;
const STRUCTURE_SHIFT_RE =
  /\b(change of character|choch|market structure shift|\bmss\b|break of structure|\bbos\b|shift(?:ed|s)?\s+(?:bullish|bearish|direction)|displac(?:e|ed|ing|ement)|breaks?\s+(?:above|below)\s+(?:the\s+)?(?:swing|previous|prior|protected)\s+(?:high|low))\b/i;
const REJECTION_RE =
  /\b(rejection|rejects?|reversal candle|reversal trigger|bullish candle|bearish candle|engulf(?:s|ing|ed)?|hammer|wick(?:s|ed)? (?:off|below|above))\b/i;
const DISPLACEMENT_RE = /\b(displacement|impulse|impulsive|expansion candle|momentum candle)\b/i;
const RETEST_RE = /\b(retest|re-test|rebalanc(?:e|ed|ing)|breaker block)\b/i;
// PASSIVE touch (what causes over-firing) — present WITHOUT any active confirmation → quarantine.
const PASSIVE_TOUCH_RE =
  /\b(tap[s]?|tapp(?:ed|ing)|touch(?:es|ed)?|reach(?:es|ed)?|returns?\s+to|comes?\s+(?:in)?to|trades?\s+into|dips?\s+into|hits?|fall[s]?\s+within|enters?\s+the)\b/i;

// ── Level references ──────────────────────────────────────────────────────────
const LEVEL_RES: Array<{ ref: LevelRef; re: RegExp }> = [
  { ref: "opening_range_edge", re: /\b(opening range|\borb\b|range high|range low|first (?:5|15|30)[\s-]*min|2[\s-]*bar range)\b/i },
  { ref: "opening_price", re: /\b(opening price|open of the (?:candle|order block|range))\b/i },
  { ref: "overnight_high_low", re: /\b(overnight (?:high|low)|pre[\s-]?market (?:high|low)|asian? (?:high|low|range|session low))\b/i },
  { ref: "order_block", re: /\b(order block|\bob\b|breaker)\b/i },
  { ref: "prior_swing", re: /\b(swing (?:high|low)|previous (?:high|low)|protected (?:high|low)|structural (?:high|low))\b/i },
  { ref: "session_level", re: /\b(session (?:high|low)|daily (?:high|low)|\bpdh\b|\bpdl\b|prior day)\b/i },
  { ref: "range_edge", re: /\b(range (?:high|low|edge)|box (?:high|low)|(?:the|our|a)\s+range)\b/i },
];

function findLevel(text: string): LevelRef | null {
  for (const { ref, re } of LEVEL_RES) if (re.test(text)) return ref;
  return null;
}

/** Direction-explicit break rule for a level (fixes long/short conflation). */
function buildDirectionalRule(level: LevelRef | null, directionClass: string | null | undefined): { long?: string; short?: string } | undefined {
  if (!level) return undefined;
  const lvl = level.replace(/_/g, " ");
  const longRule = `break/close ABOVE the ${lvl} (swing high)`;
  const shortRule = `break/close BELOW the ${lvl} (swing low)`;
  const d = (directionClass ?? "").toUpperCase();
  if (d.includes("LONG_ONLY")) return { long: longRule };
  if (d.includes("SHORT_ONLY")) return { short: shortRule };
  // bidirectional / implied / unknown → both sides explicit (the correct general encoding)
  return { long: longRule, short: shortRule };
}

/** True if a text span contains ACTIVE confirmation language (used to count expected legs). */
function hasActiveConfirmation(text: string): boolean {
  return STRUCTURE_SHIFT_RE.test(text) || ACTIVE_CLOSE_RE.test(text) || RETEST_RE.test(text) || DISPLACEMENT_RE.test(text);
}

interface ScanResult {
  best: ConfirmationPredicate | null;
  anyActive: boolean;
  anyPassive: boolean;
  edgeFeatures: TriggerFeatures;
  predFeatures: TriggerFeatures | null;
}

/**
 * Scan one text span (corpus OR a single entry_sequence step) and return the single highest-specificity
 * confirmation candidate. The reusable primitive behind both the single (Phase 2A) and compound (2B) paths.
 */
function scanBestCandidate(text: string, confluence: string | undefined, directionClass: string | null | undefined): ScanResult {
  let anyActive = false;
  let anyPassive = false;
  let best: ConfirmationPredicate | null = null;
  let predFeatures: TriggerFeatures | null = null;
  let bestScore = -1;
  let edgeFeatures: TriggerFeatures = { named_level: false, timeframe_specific: false, confluence_count: 0, rare_pattern: false };
  const rank = (k: ConfirmationKind) => ({ structure_shift: 4, close_through: 3, retest_reject: 2, displacement: 1 }[k]);
  const INTENT_RE = /\b(enter|entry|confirm|confirmation|qualif|trigger|signal|wait for|we (?:go|take)|look to (?:enter|buy|sell|take))\b/i;

  for (const sent of toWindows(text)) {
    const hasStructure = STRUCTURE_SHIFT_RE.test(sent);
    const hasClose = ACTIVE_CLOSE_RE.test(sent);
    const hasRetest = RETEST_RE.test(sent);
    const hasRejection = REJECTION_RE.test(sent);
    const hasDisplacement = DISPLACEMENT_RE.test(sent);
    if (PASSIVE_TOUCH_RE.test(sent)) anyPassive = true;

    const level = findLevel(sent);
    const winFeatures = triggerFeaturesFromText(sent);
    const hasConfluenceHere = winFeatures.confluence_count > 0 || Boolean(confluence);
    const windowConfluence = /\b(fair value gap|\bfvg\b)\b/i.test(sent) ? "fair_value_gap" : confluence;
    const cands: ConfirmationPredicate[] = [];
    if (hasStructure) cands.push({ kind: "structure_shift", level_ref: level ?? "prior_swing", evidence_quote: sent.slice(0, 180), directional_rule: buildDirectionalRule(level ?? "prior_swing", directionClass) });
    if (hasClose) cands.push({ kind: "close_through", level_ref: level, evidence_quote: sent.slice(0, 180), directional_rule: buildDirectionalRule(level, directionClass) });
    if (hasRetest && (hasRejection || hasConfluenceHere || INTENT_RE.test(sent))) cands.push({ kind: "retest_reject", level_ref: level, confluence: windowConfluence, evidence_quote: sent.slice(0, 180) });
    if (hasDisplacement) cands.push({ kind: "displacement", level_ref: level, evidence_quote: sent.slice(0, 180) });

    for (const cand of cands) {
      anyActive = true;
      // INTRINSIC specificity (Phase 2A): score by what the predicate encodes, not ambient run-on text.
      const candFeatures: TriggerFeatures = {
        named_level: predicateLevelIsNamed(cand.level_ref),
        timeframe_specific: winFeatures.timeframe_specific,
        confluence_count: cand.confluence ? 1 : 0,
        rare_pattern: cand.kind === "displacement" || (cand.kind === "retest_reject" && /\bbreaker\b/i.test(sent)),
      };
      edgeFeatures = maxFeatures(edgeFeatures, candFeatures);
      const score = triggerSpecificity(candFeatures) * 100 + rank(cand.kind) * 5 + (INTENT_RE.test(sent) ? 1 : 0);
      if (score > bestScore) { best = cand; bestScore = score; predFeatures = candFeatures; }
    }
  }
  return { best, anyActive, anyPassive, edgeFeatures, predFeatures };
}

/**
 * Compile the educator's confirmation event into a SINGLE testable predicate, or a quarantine reason.
 * Phase 2A: specificity-ranked selection + SCL telemetry. (Compound/multi-leg → compileConfirmationCompound.)
 */
export function compileConfirmation(input: ConfirmationInput): ConfirmationResult {
  const parts: string[] = [];
  if (typeof input.transcript === "string") parts.push(input.transcript);
  for (const s of input.entry_sequence ?? []) parts.push(`${s.action ?? ""} ${s.rationale ?? ""}`);
  const corpus = parts.join("\n");
  if (corpus.trim().length === 0) return { compiled: null, quarantine_reason: "no_confirmation_event" };

  const confluence = (input.confluences ?? []).some((c) => /fvg|fair.?value.?gap/i.test(c)) ? "fair_value_gap" : undefined;
  const { best, anyPassive, edgeFeatures, predFeatures } = scanBestCandidate(corpus, confluence, input.direction_class);

  if (!best) {
    return { compiled: null, quarantine_reason: anyPassive ? "confirmation_would_overfire" : "no_confirmation_event" };
  }
  if (best.kind !== "structure_shift" && best.kind !== "displacement" && !best.level_ref) {
    return { compiled: null, quarantine_reason: "confirmation_no_level" };
  }

  if (confluence) edgeFeatures.confluence_count = Math.max(edgeFeatures.confluence_count, 1);
  const pf = predFeatures ?? { named_level: false, timeframe_specific: false, confluence_count: 0, rare_pattern: false };
  const scl = computeScl(edgeFeatures, pf);
  const edge_specificity = triggerSpecificity(edgeFeatures);
  const predicate_specificity = triggerSpecificity(pf);
  const multi_leg_gap = Math.max(0, (input.entry_sequence?.length ?? 1) - 1);

  if (sclGateEnabled() && scl > sclMaxTolerance()) {
    return { compiled: null, quarantine_reason: "semantic_compression_loss", scl, edge_specificity, predicate_specificity, multi_leg_gap };
  }
  return { compiled: best, quarantine_reason: null, scl, edge_specificity, predicate_specificity, multi_leg_gap };
}

// ── Phase 2B — compound (multi-leg) confirmation ───────────────────────────────
/**
 * Leg role (Phase 2B refinement): every leg is one of —
 *  - "primary"   — the actual firing trigger; absent → no trade.
 *  - "confluence"— improves quality; missing does NOT invalidate (the demonstrated-variant case).
 *  - "hard_gate" — no trade unless true (educator used explicit gating language on this leg).
 * Roles are the per-leg refinement of the compound `enforcement` summary.
 */
export type LegRole = "primary" | "confluence" | "hard_gate";
export interface ConfirmationLeg extends ConfirmationPredicate { order: number; role: LegRole }
export interface CompoundConfirmation {
  predicate_type: "single" | "sequence" | "and";
  operator: "SEQUENCE" | "AND"; // SEQUENCE = ordered (sweep→displacement→retest); AND = parallel confluence (FVG+OB+discount)
  legs: ConfirmationLeg[];
  /**
   * How the legs gate entry:
   *  - "primary_plus_confluence" (DEFAULT) — the PRIMARY (entry) leg fires; preceding legs are recorded
   *    confluence/context, NOT hard gates. Educators state a canonical sequence but demonstrate variants;
   *    hard-requiring every leg drops demonstrated winners (the yAMaiOI regression).
   *  - "all_required" — every leg is mandatory (only when the educator uses gating language: only/must/
   *    no-trade-unless/need-to-see-X-before). This is the no-trade-discrimination case (e.g. 2u9 CHoCH gate).
   */
  enforcement: "primary_plus_confluence" | "all_required";
  primary_order: number; // which leg (1-based) is the actual entry trigger (highest-specificity leg)
}
export type ContradictionType = "MISSING_LEG" | "ORDER_COLLAPSE" | "GENERIC_REPLACEMENT" | "LEVEL_LOSS" | "SESSION_LOSS";
export interface Contradiction { type: ContradictionType; expected?: number; compiled?: number; detail?: string }
export interface CompoundResult {
  compound: CompoundConfirmation | null;
  quarantine_reason: ConfirmationQuarantineReason | null;
  contradictions: Contradiction[];
  leg_count: number;
  expected_legs: number;
}

const PARALLEL_RE = /\b(combined with|overlap|overlapping|plus|along with|together with|confluence of)\b/i;
const SEQUENCE_RE = /\b(then|next|after|once|first|second|third|step \d|followed by)\b/i;
// Explicit gating language → every leg is mandatory (no-trade-unless). Otherwise legs are confluence.
const GATING_RE = /\b(only (?:if|when|enter|take)|must (?:see|have|be)|no trade (?:unless|without)|need to see[^.]{0,40}\bbefore\b|required|do not (?:enter|trade) (?:unless|until)|we have no trade)\b/i;

/**
 * Phase 2B — compile the educator's confirmation as a COMPOUND (multi-leg) predicate.
 *
 * The single-predicate compiler (above) collapses `A AND B AND C` → argmax(candidate) — no ranking can
 * represent a conjoined sequence. This compiles ONE leg per confirmation-bearing entry_sequence step,
 * preserving order + count, detects the operator (SEQUENCE vs parallel AND), and surfaces contradictions
 * (MISSING_LEG / GENERIC_REPLACEMENT / LEVEL_LOSS). Falls back to the single corpus scan when there is
 * no usable step structure. Pure / deterministic.
 */
export function compileConfirmationCompound(input: ConfirmationInput): CompoundResult {
  const confluence = (input.confluences ?? []).some((c) => /fvg|fair.?value.?gap/i.test(c)) ? "fair_value_gap" : undefined;
  const steps = input.entry_sequence ?? [];
  const legs: ConfirmationLeg[] = [];
  const contradictions: Contradiction[] = [];
  const seen = new Set<string>(); // global dedup (not just consecutive) — entry_sequence dumps repeat legs
  let specificMisses = 0; // a SPECIFIC (named-level) confirmation step that couldn't compile = a real lost leg

  for (const s of steps) {
    const stepText = `${s.action ?? ""} ${s.rationale ?? ""}`;
    if (!hasActiveConfirmation(stepText)) continue; // pure-context step (e.g. "identify the trend") — not a leg
    const { best } = scanBestCandidate(stepText, confluence, input.direction_class);
    const usable = best && (best.kind === "structure_shift" || best.kind === "displacement" || Boolean(best.level_ref));
    const stepNamesLevel = triggerFeaturesFromText(stepText).named_level;
    if (!usable || !best) {
      // confirmation language present but uncompilable. Only a SPECIFIC (named-level) step is a real miss;
      // generic narration ("price shifts") that can't compile is not a lost leg (avoids dump over-counting).
      if (stepNamesLevel) specificMisses++;
      continue;
    }
    const key = `${best.kind}:${best.level_ref}`;
    if (seen.has(key)) continue; // global dedup — same leg restated elsewhere in the dump
    seen.add(key);
    // LEVEL_LOSS: this step named a specific level the LevelRef enum couldn't represent → generic leg.
    if (!predicateLevelIsNamed(best.level_ref) && stepNamesLevel) {
      contradictions.push({ type: "LEVEL_LOSS", detail: `step "${(s.action ?? "").slice(0, 60)}" named a specific level but compiled to ${best.level_ref ?? "null"}` });
    }
    // role: hard_gate when THIS step used explicit gating language ("only/must/no-trade-unless");
    // primary is assigned after the loop (the highest-specificity entry leg); else confluence.
    legs.push({ ...best, order: legs.length + 1, role: GATING_RE.test(stepText) ? "hard_gate" : "confluence" });
  }
  const expected_legs = legs.length + specificMisses;

  // Fallback: no step-derived legs → single corpus scan (preserves Phase 2A behavior for thin entry_sequence).
  if (legs.length === 0) {
    const single = compileConfirmation(input);
    if (!single.compiled) return { compound: null, quarantine_reason: single.quarantine_reason, contradictions, leg_count: 0, expected_legs };
    return {
      compound: { predicate_type: "single", operator: "SEQUENCE", legs: [{ ...single.compiled, order: 1, role: "primary" }], enforcement: "primary_plus_confluence", primary_order: 1 },
      quarantine_reason: null, contradictions, leg_count: 1, expected_legs: Math.max(1, expected_legs),
    };
  }

  // Invariant 1 — conjoined legs cannot collapse: a confirmation step that produced no leg = MISSING_LEG.
  if (legs.length < expected_legs) {
    contradictions.push({ type: "MISSING_LEG", expected: expected_legs, compiled: legs.length });
  }
  // Invariant 2 — preserve operator: parallel-confluence language (no ordering words) → AND, else SEQUENCE.
  const corpus = steps.map((s) => `${s.action ?? ""} ${s.rationale ?? ""}`).join(" ");
  const operator: "SEQUENCE" | "AND" = legs.length >= 2 && PARALLEL_RE.test(corpus) && !SEQUENCE_RE.test(corpus) ? "AND" : "SEQUENCE";
  const predicate_type = legs.length === 1 ? "single" : operator === "AND" ? "and" : "sequence";
  // Enforcement: default PRIMARY-fires (legs are confluence, not hard gates) to avoid dropping demonstrated
  // variants; switch to all_required ONLY when the educator uses explicit gating language.
  const enforcement: "primary_plus_confluence" | "all_required" = GATING_RE.test(corpus) ? "all_required" : "primary_plus_confluence";
  // Primary = the highest-specificity (entry) leg; tie → the LAST leg (the entry usually comes last).
  let primary_order = legs[0].order;
  let bestPrimarySpec = -1;
  for (const leg of legs) {
    const spec = triggerSpecificity({ named_level: predicateLevelIsNamed(leg.level_ref), timeframe_specific: false, confluence_count: leg.confluence ? 1 : 0, rare_pattern: leg.kind === "displacement" });
    if (spec >= bestPrimarySpec) { bestPrimarySpec = spec; primary_order = leg.order; }
  }
  for (const leg of legs) if (leg.order === primary_order) leg.role = "primary"; // primary overrides

  return { compound: { predicate_type, operator, legs, enforcement, primary_order }, quarantine_reason: null, contradictions, leg_count: legs.length, expected_legs };
}
