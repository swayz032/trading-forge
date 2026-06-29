/**
 * DIRECTIONAL PARITY — evidence-accumulation classifier (2026-06-24 Layer 3B).
 *
 * The placeability audit found EVERY extraction is direction:both (14/14 DIRECTION_AMBIGUOUS) — the
 * lossy "all strategies are both" assumption. W7nln proved the cost: the speaker taught the short
 * side IN FULL but extraction collapsed it to "vice versa"/both. Direction must be EXTRACTED from
 * what's taught, never inferred from what the instrument permits.
 *
 * Architecture (operator-specified): evidence accumulation, not single-pass classification.
 *   transcript → long-evidence + short-evidence + mirror-language → confidence scoring → 5-class.
 *
 * CRITICAL GUARD (operator): symmetric indicators ≠ bidirectional. "RSI crosses 70 → reversal" does
 * NOT mean both directions were taught. Only explicit directional TRANSCRIPT evidence counts.
 * Deterministic + pure; no prompt change (the lower-risk path before any extractor-prompt edit).
 */

export type DirectionClass =
  | "LONG_ONLY"
  | "SHORT_ONLY"
  | "BIDIRECTIONAL_EXPLICIT"
  | "LONG_WITH_IMPLIED_MIRROR"
  | "SHORT_WITH_IMPLIED_MIRROR"
  | "NO_DIRECTION_EVIDENCE";

export interface DirectionEvidence {
  long_rules_present: boolean;
  long_rule_count: number;
  short_rules_present: boolean;
  short_rule_count: number;
  mirror_language: boolean;
  mirror_strength: number; // 0–1, max strength of any matched mirror phrase
  long_markers: string[];
  short_markers: string[];
  mirror_markers: string[];
}

export interface DirectionMetadata {
  class: DirectionClass;
  confidence: number; // 0–1
  evidence: string[]; // human-readable provenance
}

// Specific long/short directional markers. Deliberately NOT bare "long"/"short" (false-positives:
// "long term", "as long as", "short term"). Plural "longs"/"shorts" + trading-context phrases only.
const LONG_RE =
  /\b(go(?:ing)? long|long (?:entry|setup|trade|position|side|signal|opportunit)|\blongs\b|bullish|to the upside|break(?:s|ing)? (?:above|up|upward|higher)|upside target|buy(?:ing)? (?:setup|entry|signal|the break))\b/i;
const SHORT_RE =
  /\b(go(?:ing)? short|short (?:entry|setup|trade|position|side|signal|opportunit)|\bshorts\b|bearish|to the downside|break(?:s|ing)? (?:below|down|downward|lower)|downside target|sell(?:ing)? (?:setup|entry|signal|the break))\b/i;

// Mirror-language phrases with per-phrase strength. "opposite for shorts" is strong evidence the
// short was only IMPLIED; "vice versa" is weaker.
const MIRROR_PHRASES: Array<{ re: RegExp; strength: number }> = [
  { re: /\b(opposite|inverse|reverse[d]?)\s+(?:for|on)\s+(?:the\s+)?(short|long|downside|upside|sell|buy)/i, strength: 0.8 },
  { re: /\b(same (?:thing|setup|rules?|concept)\s+(?:in reverse|but reversed|but flipped|for (?:the )?(?:short|long|downside|upside)))/i, strength: 0.8 },
  { re: /\bflip (?:it|the (?:script|setup|rules?))\b/i, strength: 0.65 },
  { re: /\b(in reverse|the other way around|opposite direction|mirror (?:image|the))\b/i, strength: 0.6 },
  { re: /\bvice versa\b/i, strength: 0.6 },
  { re: /\b(the )?opposite\b/i, strength: 0.45 },
];

function splitSentences(t: string): string[] {
  return t.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter((s) => s.length > 0);
}

/**
 * Accumulate directional evidence from a transcript. Pure, deterministic.
 */
export function extractDirectionEvidence(transcript: string | null | undefined): DirectionEvidence {
  const empty: DirectionEvidence = {
    long_rules_present: false, long_rule_count: 0,
    short_rules_present: false, short_rule_count: 0,
    mirror_language: false, mirror_strength: 0,
    long_markers: [], short_markers: [], mirror_markers: [],
  };
  if (typeof transcript !== "string" || transcript.trim().length === 0) return empty;

  const sentences = splitSentences(transcript);
  const longMarkers = new Set<string>();
  const shortMarkers = new Set<string>();
  const mirrorMarkers = new Set<string>();
  let longCount = 0;
  let shortCount = 0;
  let mirrorStrength = 0;

  for (const sent of sentences) {
    const lm = sent.match(LONG_RE);
    if (lm) { longCount++; longMarkers.add(lm[0].toLowerCase()); }
    const sm = sent.match(SHORT_RE);
    if (sm) { shortCount++; shortMarkers.add(sm[0].toLowerCase()); }
    for (const { re, strength } of MIRROR_PHRASES) {
      const mm = sent.match(re);
      if (mm) { mirrorMarkers.add(mm[0].toLowerCase()); mirrorStrength = Math.max(mirrorStrength, strength); }
    }
  }

  return {
    long_rules_present: longCount > 0,
    long_rule_count: longCount,
    short_rules_present: shortCount > 0,
    short_rule_count: shortCount,
    mirror_language: mirrorMarkers.size > 0,
    mirror_strength: mirrorStrength,
    long_markers: [...longMarkers].slice(0, 8),
    short_markers: [...shortMarkers].slice(0, 8),
    mirror_markers: [...mirrorMarkers].slice(0, 8),
  };
}

/**
 * Classify directionality from accumulated evidence (operator's exact logic) + confidence.
 *
 * NOTE on the symmetric-indicator guard: this consumes only the directional TRANSCRIPT evidence
 * above — it never infers bidirectional from an indicator being symmetric. An RSI-reversal video
 * that only says "watch for reversal" produces no long/short markers → NO_DIRECTION_EVIDENCE.
 */
export function classifyDirection(ev: DirectionEvidence): DirectionMetadata {
  const evidence: string[] = [];
  if (ev.long_markers.length) evidence.push(`long: ${ev.long_markers.join(", ")}`);
  if (ev.short_markers.length) evidence.push(`short: ${ev.short_markers.join(", ")}`);
  if (ev.mirror_markers.length) evidence.push(`mirror: ${ev.mirror_markers.join(", ")}`);

  const long = ev.long_rules_present;
  const short = ev.short_rules_present;
  const mirror = ev.mirror_language;

  // both explicit (operator: separate long + short rule blocks → strongest)
  if (long && short) {
    const both2 = ev.long_rule_count >= 2 && ev.short_rule_count >= 2;
    return { class: "BIDIRECTIONAL_EXPLICIT", confidence: both2 ? 0.95 : 0.78, evidence };
  }
  // explicit one side + mirror language for the other → IMPLIED mirror (weaker than explicit-both)
  if (long && mirror) {
    return { class: "LONG_WITH_IMPLIED_MIRROR", confidence: 0.5 + 0.2 * ev.mirror_strength, evidence };
  }
  if (short && mirror) {
    return { class: "SHORT_WITH_IMPLIED_MIRROR", confidence: 0.5 + 0.2 * ev.mirror_strength, evidence };
  }
  // single direction taught, no mirror
  if (long) return { class: "LONG_ONLY", confidence: ev.long_rule_count >= 2 ? 0.85 : 0.7, evidence };
  if (short) return { class: "SHORT_ONLY", confidence: ev.short_rule_count >= 2 ? 0.85 : 0.7, evidence };

  // no directional language at all (symmetric-indicator videos land here — correct)
  return { class: "NO_DIRECTION_EVIDENCE", confidence: 0.3, evidence };
}

/** Convenience: transcript → DirectionMetadata. */
export function classifyDirectionFromTranscript(transcript: string | null | undefined): DirectionMetadata {
  return classifyDirection(extractDirectionEvidence(transcript));
}
