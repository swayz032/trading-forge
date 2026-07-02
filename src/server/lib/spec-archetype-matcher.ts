/**
 * spec-archetype-matcher.ts — Band B (spec-onboarding-bridge, 2026-07-02)
 *
 * Maps a compiled-spec artifact's entry-condition graph onto an EXISTING
 * audited archetype in `ARCHETYPE_REGISTRY` (direct-bucket-graduator.ts) via
 * a keyword heuristic over the condition `object` text. This is deliberately
 * conservative: honesty (route to needs_archetype_queue) beats a false-positive
 * archetype dispatch that silently trades the wrong logic.
 *
 * WHY NOT IMPORT ARCHETYPE_REGISTRY DIRECTLY:
 * `ARCHETYPE_REGISTRY` in direct-bucket-graduator.ts is a module-local `const`
 * (not exported) — `scripts/check-archetype-lockstep.ts` parses it via regex
 * rather than importing it, and this module follows the same non-invasive
 * pattern. `KNOWN_ARCHETYPE_KEYS` below is a hand-verified copy of the 39
 * registry keys (verified 2026-07-02 against direct-bucket-graduator.ts
 * lines 72-151). If the registry gains a new key, add it here too — the
 * `npm run check:archetype-lockstep` gate will not catch drift in THIS file
 * since it never imports the registry; this module's own test file asserts
 * every key here is also present in the registry source text.
 *
 * MAPPING POLICY (Band C explicitly defers per-condition evaluators — this is
 * a best-effort KEYWORD match against EXISTING archetypes only; it never
 * invents new engine dispatch logic):
 *   1. Concatenate every entry_conditions[].object string (all roles).
 *   2. For each known archetype key, score = count of its keyword phrases
 *      found as substrings in the concatenated, normalized text.
 *   3. If exactly one archetype has the strictly-highest nonzero score →
 *      MAPPED. Ties or all-zero → UNMAPPED (route to needs_archetype_queue).
 */

export const KNOWN_ARCHETYPE_KEYS = [
  "ict_silver_bullet_ny_am",
  "ict_silver_bullet_london",
  "ict_silver_bullet_ny_pm",
  "ict_judas_swing",
  "ict_ny_lunch_reversal",
  "ict_midnight_open",
  "ict_london_raid",
  "ict_turtle_soup",
  "ict_ote",
  "ict_power_of_3",
  "ict_unicorn",
  "ict_breaker",
  "ict_mitigation",
  "ict_iofed",
  "smt_reversal",
  "ict_quarterly_swing",
  "ict_propulsion",
  "ict_eqhl_raid",
  "ict_scalp",
  "ict_swing",
  "ict_2022",
  "break_of_structure",
  "change_of_character",
  "market_structure_shift",
  "cisd",
  "fvg_retrace",
  "fvg",
  "judas_swing",
  "silver_bullet",
  "breaker_block",
  "order_block",
  "liquidity_sweep",
  "wyckoff_spring",
  "wyckoff_upthrust",
  "wyckoff_accumulation",
  "wyckoff_distribution",
  "bounce_off_level",
  "ict_bias_aligned_continuation",
  "gann_box_4h_continuation",
] as const;

export type KnownArchetypeKey = (typeof KNOWN_ARCHETYPE_KEYS)[number];

/**
 * Keyword phrases (lowercase, normalized) that indicate a given archetype.
 * Deliberately narrow — a miss routes to needs_archetype_queue (honest),
 * a false-positive silently dispatches the WRONG engine class (dangerous).
 * Only archetypes with unambiguous, ICT/SMC-specific vocabulary get entries;
 * archetypes with generic-sounding names (e.g. "ict_swing", "ict_2022") are
 * intentionally left without keyword entries — the spec corpus's plain
 * "bullish"/"bearish"/"swing" vocabulary would produce false-positive noise.
 */
const ARCHETYPE_KEYWORDS: Partial<Record<KnownArchetypeKey, string[]>> = {
  ict_silver_bullet_ny_am: ["silver bullet"],
  ict_silver_bullet_london: ["silver bullet london", "london silver bullet"],
  ict_silver_bullet_ny_pm: ["pm silver bullet", "silver bullet pm"],
  silver_bullet: ["silver bullet"],
  ict_judas_swing: ["judas swing", "judas"],
  judas_swing: ["judas swing", "judas"],
  ict_ny_lunch_reversal: ["lunch reversal", "ny lunch"],
  ict_midnight_open: ["midnight open", "ndog", "nwog"],
  ict_london_raid: ["london raid", "asia sweep"],
  ict_turtle_soup: ["turtle soup"],
  wyckoff_spring: ["wyckoff spring", "spring"],
  wyckoff_upthrust: ["wyckoff upthrust", "upthrust"],
  wyckoff_accumulation: ["wyckoff accumulation", "accumulation phase"],
  wyckoff_distribution: ["wyckoff distribution", "distribution phase"],
  ict_ote: ["optimal trade entry", "ote zone", " ote "],
  ict_power_of_3: ["power of 3", "power of three", "po3"],
  ict_unicorn: ["unicorn"],
  ict_breaker: ["breaker block", "breaker"],
  breaker_block: ["breaker block", "breaker"],
  order_block: ["order block"],
  ict_mitigation: ["mitigation block", "mitigation"],
  ict_iofed: ["institutional order flow", "iofed"],
  smt_reversal: ["smt divergence", "smt reversal", "correlation divergence"],
  ict_quarterly_swing: ["quarterly theory", "quarterly swing"],
  ict_propulsion: ["propulsion candle", "propulsion"],
  ict_eqhl_raid: ["equal high", "equal low", "eqhl"],
  liquidity_sweep: ["liquidity sweep", "liquidity raid", "stop hunt"],
  fvg: ["fair value gap", "fvg"],
  fvg_retrace: ["fvg retrace", "fair value gap retrace"],
  cisd: ["change in state of delivery", "cisd"],
  break_of_structure: ["break of structure", " bos "],
  change_of_character: ["change of character", "choch"],
  market_structure_shift: ["market structure shift", " mss "],
  bounce_off_level: ["moving average bounce", "ma bounce", "bounce off"],
  ict_bias_aligned_continuation: ["bias aligned continuation"],
  gann_box_4h_continuation: ["gann box"],
};

export interface SpecEntryConditionLike {
  object?: string | null;
  type?: string | null;
  role?: string | null;
}

export interface ArchetypeMatchResult {
  matched: boolean;
  archetypeKey: KnownArchetypeKey | null;
  score: number;
  /** All nonzero scores, for diagnostics/reporting (e.g. "was a near-tie"). */
  candidateScores: Array<{ key: KnownArchetypeKey; score: number }>;
}

function normalize(text: string): string {
  return ` ${text.toLowerCase().replace(/[_\-]+/g, " ").replace(/\s+/g, " ").trim()} `;
}

/**
 * Best-effort keyword match. Never throws. Returns matched=false on any
 * ambiguity (tie) or zero-hit — the honest default is "queue it".
 */
export function matchArchetype(entryConditions: SpecEntryConditionLike[]): ArchetypeMatchResult {
  const haystack = normalize(
    entryConditions
      .map((c) => (typeof c.object === "string" ? c.object : ""))
      .filter(Boolean)
      .join(" | "),
  );

  const scores: Array<{ key: KnownArchetypeKey; score: number }> = [];
  for (const key of KNOWN_ARCHETYPE_KEYS) {
    const keywords = ARCHETYPE_KEYWORDS[key];
    if (!keywords || keywords.length === 0) continue;
    let score = 0;
    for (const kw of keywords) {
      if (haystack.includes(normalize(kw).trim())) score += 1;
    }
    if (score > 0) scores.push({ key, score });
  }

  if (scores.length === 0) {
    return { matched: false, archetypeKey: null, score: 0, candidateScores: [] };
  }

  scores.sort((a, b) => b.score - a.score);
  const top = scores[0];
  const runnerUp = scores[1];

  if (runnerUp && runnerUp.score === top.score) {
    // Ambiguous tie — do not guess.
    return { matched: false, archetypeKey: null, score: top.score, candidateScores: scores };
  }

  return { matched: true, archetypeKey: top.key, score: top.score, candidateScores: scores };
}
