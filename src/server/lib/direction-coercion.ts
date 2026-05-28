/**
 * Wave 26 Pass L (2026-05-27) — Direction post-validator.
 *
 * Gemma4:e2b consistently picks `direction: "long"` when the speaker's FIRST
 * example is bullish, even when step text explicitly mirrors short-side rules
 * ("or wait on the one opposite end for the middle candle's low for entry").
 * Strict GBNF schema enforcement crashes on RTX 5060 8 GB VRAM, so we can't
 * grammar-constrain the field. This post-validator is the deterministic backstop:
 * if ANY step contains a short-side mirror phrase, force `direction = "both"`.
 *
 * Pure function. No I/O. No throw. Safe to call on any strategies array.
 *
 * Closes Round 1 Video 3 (candle_range_theory) which kept emitting direction=long
 * despite step 5 saying "or wait on the one opposite end for the middle candle's
 * low for entry".
 */

const SHORT_SIDE_MIRROR_PATTERNS: RegExp[] = [
  /\bor\s+short\b/i,
  /\bor\s+(the\s+)?low\b/i,
  /\bopposite\s+(end|side|direction)\b/i,
  /\bfor\s+short\s+entry\b/i,
  /\bfor\s+sell\b/i,
  /\bfor\s+puts\b/i,
  /\bor\s+(take|sell)\s+puts\b/i,
  /\bbreak\s+below\b.*\bbear/i,
  /\bbearish\b.*\bbullish\b|\bbullish\b.*\bbearish\b/i,
  /\bmirror\s+(this|the|on)\b/i,
  /\b(long|buy|call)s?\s+(and|or|\/|\&)\s+(short|sell|put)s?\b/i,
  /\b(short|sell|put)s?\s+(and|or|\/|\&)\s+(long|buy|call)s?\b/i,
  /\bbreak\s+(above|below)\b.*\bbreak\s+(below|above)\b/i,
  /\bif\s+(price\s+)?break(s)?\s+(above|high).*if\s+(price\s+)?break(s)?\s+(below|low)/i,
];

const LONG_SIDE_MIRROR_PATTERNS: RegExp[] = [
  /\bor\s+long\b/i,
  /\bfor\s+long\s+entry\b/i,
  /\bfor\s+buy\b/i,
  /\bor\s+(take|buy)\s+calls\b/i,
];

export interface StrategyWithDirection {
  direction?: string | null;
  entry_sequence?: Array<{ step?: number; action?: string; rationale?: string | null }>;
}

export interface CoercionResult {
  coerced: boolean;
  reason?: string;
  matchedPhrase?: string;
}

/**
 * Inspect a single strategy's entry_sequence text and return whether direction
 * should be coerced. Pure — does NOT mutate the input.
 */
export function inspectDirection(strategy: StrategyWithDirection): CoercionResult {
  const current = (strategy.direction ?? "").toLowerCase();
  if (current === "both") return { coerced: false };

  const stepText = (strategy.entry_sequence ?? [])
    .flatMap((s) => [s.action ?? "", s.rationale ?? ""])
    .join(" ")
    .toLowerCase();

  if (!stepText) return { coerced: false };

  // If currently "long", scan for short-mirror phrases.
  if (current === "long") {
    for (const pattern of SHORT_SIDE_MIRROR_PATTERNS) {
      const match = stepText.match(pattern);
      if (match) {
        return {
          coerced: true,
          reason: "direction=long but short-side mirror phrase found in step text",
          matchedPhrase: match[0],
        };
      }
    }
  }

  // If currently "short", scan for long-mirror phrases.
  if (current === "short") {
    for (const pattern of LONG_SIDE_MIRROR_PATTERNS) {
      const match = stepText.match(pattern);
      if (match) {
        return {
          coerced: true,
          reason: "direction=short but long-side mirror phrase found in step text",
          matchedPhrase: match[0],
        };
      }
    }
  }

  // Wave 26 Pass L (2026-05-27) — Default-both rule (closes Video 6 LOcaRWcc1xI gap).
  // Speakers rarely make explicit "this is long-only" statements. When direction
  // is long/short AND step text has NO explicit one-directional markers, assume
  // chart-mechanic is bidirectional. Institutional default per CLAUDE.md §12
  // (graduation_bidirectional_completeness HARD gate).
  const EXPLICIT_ONE_DIRECTION_MARKERS = [
    /\blong[\s\-]?only\b/i,
    /\bshort[\s\-]?only\b/i,
    /\bonly\s+(take|trade|enter|do)\s+(longs?|buys?|calls?)\b/i,
    /\bonly\s+(take|trade|enter|do)\s+(shorts?|sells?|puts?)\b/i,
    /\bnever\s+(short|sell)\b/i,
    /\bnever\s+(long|buy)\b/i,
    /\bdo\s+not\s+(short|sell)\b/i,
    /\bdo\s+not\s+(long|buy)\b/i,
  ];

  if (current === "long" || current === "short") {
    const hasExplicitOneDirection = EXPLICIT_ONE_DIRECTION_MARKERS.some((p) => p.test(stepText));
    if (!hasExplicitOneDirection) {
      return {
        coerced: true,
        reason: `direction=${current} but no explicit one-direction marker in step text (default-both rule)`,
        matchedPhrase: "<default-both: no 'long-only'/'short-only' markers found>",
      };
    }
  }

  return { coerced: false };
}

/**
 * Apply direction coercion to every strategy in an array. Mutates in place
 * AND returns the coercion log for audit. Safe to call on empty/undefined input.
 */
export function coerceDirectionsInPlace(strategies: StrategyWithDirection[]): Array<{
  index: number;
  originalDirection: string | undefined;
  coerced: boolean;
  reason?: string;
  matchedPhrase?: string;
}> {
  const log: Array<{
    index: number;
    originalDirection: string | undefined;
    coerced: boolean;
    reason?: string;
    matchedPhrase?: string;
  }> = [];

  if (!Array.isArray(strategies)) return log;

  for (let i = 0; i < strategies.length; i++) {
    const s = strategies[i];
    if (!s || typeof s !== "object") continue;
    const original = s.direction ?? undefined;
    const result = inspectDirection(s);
    if (result.coerced) {
      s.direction = "both";
      log.push({
        index: i,
        originalDirection: original,
        coerced: true,
        reason: result.reason,
        matchedPhrase: result.matchedPhrase,
      });
    }
  }

  return log;
}
