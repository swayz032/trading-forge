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

/**
 * Compile the educator's confirmation event into a testable predicate, or a quarantine reason.
 *
 * Phase 2A: selection is SPECIFICITY-RANKED (not fixed kind-rank). The compiler prefers the most
 * SPECIFIC trigger present (named level + confluence + rare pattern + intent), so a retest@OR-low+FVG
 * outranks a generic structure_shift@prior_swing — fixing the dominant SELECTION failure. A final SCL
 * gate quarantines the compile if even the best predicate dropped too much edge specificity. Pure.
 */
export function compileConfirmation(input: ConfirmationInput): ConfirmationResult {
  const parts: string[] = [];
  if (typeof input.transcript === "string") parts.push(input.transcript);
  for (const s of input.entry_sequence ?? []) parts.push(`${s.action ?? ""} ${s.rationale ?? ""}`);
  const corpus = parts.join("\n");
  if (corpus.trim().length === 0) return { compiled: null, quarantine_reason: "no_confirmation_event" };

  const confluence = (input.confluences ?? []).some((c) => /fvg|fair.?value.?gap/i.test(c)) ? "fair_value_gap" : undefined;

  let anyActive = false;
  let anyPassive = false;
  let best: ConfirmationPredicate | null = null;
  let bestScore = -1;
  // Edge ceiling = max specificity among windows that produced a CANDIDATE (the trigger neighborhood),
  // NOT the whole transcript — a long explainer video mentions FVG/OB/displacement as teaching concepts
  // that aren't the trigger; counting them over-quarantines faithful compiles. SCL then measures
  // SELECTION loss (did we pick the most specific available trigger?), not explainer richness.
  let edgeFeatures: TriggerFeatures = { named_level: false, timeframe_specific: false, confluence_count: 0, rare_pattern: false };
  // kind-rank is now only a small TIE-BREAK at equal specificity (was the dominant selector — the bug).
  const rank = (k: ConfirmationKind) => ({ structure_shift: 4, close_through: 3, retest_reject: 2, displacement: 1 }[k]);
  const INTENT_RE = /\b(enter|entry|confirm|confirmation|qualif|trigger|signal|wait for|we (?:go|take)|look to (?:enter|buy|sell|take))\b/i;
  const windows = toWindows(corpus);

  for (const sent of windows) {
    const hasStructure = STRUCTURE_SHIFT_RE.test(sent);
    const hasClose = ACTIVE_CLOSE_RE.test(sent);
    const hasRetest = RETEST_RE.test(sent);
    const hasRejection = REJECTION_RE.test(sent);
    const hasDisplacement = DISPLACEMENT_RE.test(sent);
    const hasPassive = PASSIVE_TOUCH_RE.test(sent);
    if (hasPassive) anyPassive = true;

    const level = findLevel(sent);
    const winFeatures = triggerFeaturesFromText(sent);
    const hasConfluenceHere = winFeatures.confluence_count > 0 || Boolean(confluence);
    // retest_reject carries a confluence — credit FVG named in THIS window (not just input.confluences).
    const windowConfluence = /\b(fair value gap|\bfvg\b)\b/i.test(sent) ? "fair_value_gap" : confluence;
    // Phase 2A: emit EVERY matching kind as a COMPETING candidate (no fixed structure→close→retest
    // precedence). A window mentioning both a structure word AND a retest+FVG must let the more specific
    // retest interpretation compete — the old if-else discarded it before specificity ranking (the yAMaiOI bug).
    const cands: ConfirmationPredicate[] = [];
    if (hasStructure) cands.push({ kind: "structure_shift", level_ref: level ?? "prior_swing", evidence_quote: sent.slice(0, 180), directional_rule: buildDirectionalRule(level ?? "prior_swing", input.direction_class) });
    if (hasClose) cands.push({ kind: "close_through", level_ref: level, evidence_quote: sent.slice(0, 180), directional_rule: buildDirectionalRule(level, input.direction_class) });
    if (hasRetest && (hasRejection || hasConfluenceHere || INTENT_RE.test(sent))) cands.push({ kind: "retest_reject", level_ref: level, confluence: windowConfluence, evidence_quote: sent.slice(0, 180) });
    if (hasDisplacement) cands.push({ kind: "displacement", level_ref: level, evidence_quote: sent.slice(0, 180) });

    for (const cand of cands) {
      anyActive = true;
      // INTRINSIC specificity: score the candidate by what THE PREDICATE encodes (its resolved level,
      // its own confluence, its kind's rarity) — NOT ambient co-located text. A punctuation-less run-on
      // window lumps structure words next to unrelated levels/confluences; crediting that ambient text
      // let a generic structure_shift inherit richness it doesn't encode (the yAMaiOI mis-rank).
      const candFeatures: TriggerFeatures = {
        named_level: predicateLevelIsNamed(cand.level_ref),
        timeframe_specific: winFeatures.timeframe_specific,
        confluence_count: cand.confluence ? 1 : 0,
        rare_pattern: cand.kind === "displacement" || (cand.kind === "retest_reject" && /\bbreaker\b/i.test(sent)),
      };
      edgeFeatures = maxFeatures(edgeFeatures, candFeatures); // ceiling over candidate-bearing windows
      // SPECIFICITY-ranked selection: trigger-specificity dominates; kind-rank is a sub-unit tie-break;
      // entry-intent a final nudge. The most specific trigger present wins.
      const score = triggerSpecificity(candFeatures) * 100 + rank(cand.kind) * 5 + (INTENT_RE.test(sent) ? 1 : 0);
      if (score > bestScore) { best = cand; bestScore = score; }
    }
  }

  // FAIL-CLOSED decision table (design §4).
  if (!best) {
    return { compiled: null, quarantine_reason: anyPassive ? "confirmation_would_overfire" : "no_confirmation_event" };
  }
  if (best.kind !== "structure_shift" && best.kind !== "displacement" && !best.level_ref) {
    return { compiled: null, quarantine_reason: "confirmation_no_level" };
  }
  void anyActive;

  // ── Phase 2A SCL gate ─────────────────────────────────────────────────────
  // edgeFeatures already accumulated over candidate-bearing windows (the trigger neighborhood).
  if (confluence) edgeFeatures.confluence_count = Math.max(edgeFeatures.confluence_count, 1);
  // predicate captured = the chosen predicate's INTRINSIC specificity (consistent with selection).
  const predFeatures: TriggerFeatures = {
    named_level: predicateLevelIsNamed(best.level_ref),
    timeframe_specific: triggerFeaturesFromText(best.evidence_quote).timeframe_specific,
    confluence_count: best.confluence ? 1 : 0,
    rare_pattern: best.kind === "displacement" || (best.kind === "retest_reject" && /\bbreaker\b/i.test(best.evidence_quote)),
  };

  const scl = computeScl(edgeFeatures, predFeatures);
  const edge_specificity = triggerSpecificity(edgeFeatures);
  const predicate_specificity = triggerSpecificity(predFeatures);
  const multi_leg_gap = Math.max(0, (input.entry_sequence?.length ?? 1) - 1);

  if (sclGateEnabled() && scl > sclMaxTolerance()) {
    // Hard gate (opt-in until calibrated): best available compile drops too much specificity.
    return { compiled: null, quarantine_reason: "semantic_compression_loss", scl, edge_specificity, predicate_specificity, multi_leg_gap };
  }
  return { compiled: best, quarantine_reason: null, scl, edge_specificity, predicate_specificity, multi_leg_gap };
}
