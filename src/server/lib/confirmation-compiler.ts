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

export type ConfirmationKind = "close_through" | "structure_shift" | "retest_reject" | "displacement";

export type ConfirmationQuarantineReason =
  | "no_confirmation_event" // educator stated no confirmation (or extraction lost it)
  | "confirmation_would_overfire" // only a passive touch/tap present — compiling it would over-fire
  | "confirmation_no_level" // active confirmation but no anchor level identifiable
  | "confirmation_unmapped"; // confirmation language present but not mappable to a primitive

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
 * Priority: structure_shift > close_through > retest_reject > displacement. Pure, deterministic.
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
  // Scan sentence-by-sentence so the level binds LOCALLY to the confirmation (avoids the cross-sentence
  // mis-binding the param scanner had to guard against).
  let best: ConfirmationPredicate | null = null;
  let bestScore = -1;
  const rank = (k: ConfirmationKind) => ({ structure_shift: 4, close_through: 3, retest_reject: 2, displacement: 1 }[k]);
  // Prefer the sentence that actually STATES the entry confirmation (has entry-intent + a level),
  // not an intro/context sentence that merely mentions the keyword.
  const INTENT_RE = /\b(enter|entry|confirm|confirmation|qualif|trigger|signal|wait for|we (?:go|take)|look to (?:enter|buy|sell|take))\b/i;

  for (const sent of toWindows(corpus)) {
    const hasStructure = STRUCTURE_SHIFT_RE.test(sent);
    const hasClose = ACTIVE_CLOSE_RE.test(sent);
    const hasRetest = RETEST_RE.test(sent);
    const hasRejection = REJECTION_RE.test(sent);
    const hasDisplacement = DISPLACEMENT_RE.test(sent);
    const hasPassive = PASSIVE_TOUCH_RE.test(sent);
    if (hasPassive) anyPassive = true;

    const level = findLevel(sent);
    let cand: ConfirmationPredicate | null = null;
    if (hasStructure) cand = { kind: "structure_shift", level_ref: level ?? "prior_swing", evidence_quote: sent.slice(0, 180), directional_rule: buildDirectionalRule(level ?? "prior_swing", input.direction_class) };
    else if (hasClose) cand = { kind: "close_through", level_ref: level, evidence_quote: sent.slice(0, 180), directional_rule: buildDirectionalRule(level, input.direction_class) };
    else if (hasRetest && hasRejection) cand = { kind: "retest_reject", level_ref: level, confluence, evidence_quote: sent.slice(0, 180) };
    else if (hasDisplacement) cand = { kind: "displacement", level_ref: level, evidence_quote: sent.slice(0, 180) };

    if (cand) {
      anyActive = true;
      // Quote-quality score: kind rank dominates, then prefer a sentence with an explicit level +
      // entry-intent (the canonical confirmation sentence over a keyword-only intro).
      const score = rank(cand.kind) * 10 + (level ? 3 : 0) + (INTENT_RE.test(sent) ? 2 : 0);
      if (score > bestScore) { best = cand; bestScore = score; }
    }
  }

  // FAIL-CLOSED decision table (design §4).
  if (!best) {
    // No active confirmation. If only passive touches were present → compiling would over-fire.
    return { compiled: null, quarantine_reason: anyPassive ? "confirmation_would_overfire" : "no_confirmation_event" };
  }
  // structure_shift defaults its level to prior_swing; the others REQUIRE an explicit level (no level → quarantine).
  if (best.kind !== "structure_shift" && best.kind !== "displacement" && !best.level_ref) {
    return { compiled: null, quarantine_reason: "confirmation_no_level" };
  }
  void anyActive;
  return { compiled: best, quarantine_reason: null };
}
