/**
 * Wave 26 Pass I v12 (2026-05-26) — Server-side speaker-vocabulary extractor.
 *
 * Gemma4:e2b's training prior is stronger than any prompt — it falls back to
 * v10 prose shape regardless of v11/v12 prompt mandates. So we don't rely on
 * Gemma to identify proprietary vocabulary; we extract it server-side from the
 * transcript using NLP patterns, then attach to the idea object BEFORE the
 * prose synthesizer runs.
 *
 * Patterns extracted:
 *   1. "I call this/that/it [NAME]" — explicit naming
 *   2. "what I call the [NAME]" / "this is my [NAME]"
 *   3. Capitalized multi-word phrases that recur (≥2 mentions) — proprietary tools
 *   4. Number-prefixed zone names ("25 to 50% optimum zone", "premature zone")
 *   5. Known archetype-family terms (Power of 3, CRT, IRS Model, ICT, SMC, FVG)
 *   6. Quoted/emphasized terms ("the so-called X", "what we call X")
 *
 * Output: an array of speaker_concepts compatible with the v11 graduator path.
 * Each concept has role inferred from context keywords ("zone", "model",
 * "filter", "entry", "stop", "target").
 */

type Concept = {
  term: string;
  role: "indicator" | "zone" | "filter" | "entry_step" | "stop_anchor" | "target" | "model" | "phase";
  verbatim_description: string;
  transcript_quote: string;
  occurrences: number;
};

const KNOWN_ARCHETYPE_TERMS: Array<{ pattern: RegExp; term: string; role: Concept["role"] }> = [
  // Models / frameworks
  { pattern: /\b(?:irs model|impulse[\s,]+range[\s,]+sweep)\b/gi, term: "IRS Model", role: "model" },
  { pattern: /\b(?:power of (?:3|three)|po3)\b/gi, term: "Power of 3", role: "model" },
  { pattern: /\bcrt\b|\bcandle range theory\b/gi, term: "CRT (Candle Range Theory)", role: "model" },
  { pattern: /\bict\b(?:\s+202\d)?/gi, term: "ICT", role: "model" },
  { pattern: /\bsmc\b|\bsmart money concepts?\b/gi, term: "SMC (Smart Money Concepts)", role: "model" },
  { pattern: /\bwyckoff\b/gi, term: "Wyckoff", role: "model" },
  // Zones / levels
  { pattern: /\b(?:fair value gap|fvg)\b/gi, term: "Fair Value Gap (FVG)", role: "zone" },
  { pattern: /\b(?:order block|breaker block)\b/gi, term: "Order Block / Breaker Block", role: "zone" },
  { pattern: /\b(?:premium|discount)\s+zone\b/gi, term: "Premium/Discount Zone", role: "zone" },
  { pattern: /\b(?:premature|optimum|overextended|danger)\s+zone\b/gi, term: "Quartile Zone", role: "zone" },
  { pattern: /\b(?:hidden level)\b/gi, term: "Hidden Level", role: "zone" },
  { pattern: /\b(?:liquidity pool|liquidity (?:zone|level|line))\b/gi, term: "Liquidity Pool", role: "zone" },
  { pattern: /\bequal (?:highs|lows)\b/gi, term: "Equal Highs/Lows", role: "target" },
  { pattern: /\b(?:previous|prior) (?:daily|weekly|monthly|session)\s+(?:high|low)\b/gi, term: "Previous Period High/Low", role: "target" },
  // Phases
  { pattern: /\b(?:accumulation|manipulation|distribution|reversal forming)\b/gi, term: "Phase (A/M/D/R)", role: "phase" },
  { pattern: /\b(?:impulse|range|sweep|displacement)\s+(?:phase|leg)?\b/gi, term: "Market Phase", role: "phase" },
  // Entry steps
  { pattern: /\b(?:change of state|change of character|choch|change of delivery)\b/gi, term: "Change of State / CHoCH", role: "entry_step" },
  { pattern: /\b(?:swing failure pattern|sfp)\b/gi, term: "Swing Failure Pattern (SFP)", role: "entry_step" },
  { pattern: /\b(?:market structure shift|mss|break of structure|bos)\b/gi, term: "Market Structure Shift (MSS/BOS)", role: "entry_step" },
  { pattern: /\b(?:liquidity (?:raid|sweep|grab|hunt))\b/gi, term: "Liquidity Raid", role: "entry_step" },
  { pattern: /\b(?:rebalance|retest|rejection|bounce)\b/gi, term: "Rebalance/Retest", role: "entry_step" },
  // Indicators / tools
  { pattern: /\b(?:gann box|fibonacci|fib\b|retracement)\b/gi, term: "Gann Box / Fibonacci", role: "indicator" },
  { pattern: /\b(?:vwap|anchored vwap|avwap)\b/gi, term: "VWAP", role: "indicator" },
  { pattern: /\b(?:atr|average true range)\b/gi, term: "ATR", role: "indicator" },
  { pattern: /\b\d+\s*(?:hour|h|min|m|day|d|week|w)\s+(?:candle|box|range|chart)\b/gi, term: "Timeframe Candle/Box", role: "indicator" },
  // Filters
  { pattern: /\b(?:skinny candle|wick.{0,8}body|indecisive|indecisiveness)\b/gi, term: "Body-vs-Wick Filter", role: "filter" },
  { pattern: /\b(?:no clear direction|neutral.{0,8}market|ranging.{0,8}market|chop|sideways)\b/gi, term: "Neutral/Ranging Avoid", role: "filter" },
  { pattern: /\b(?:equal liquidity (?:on |both )?sides|coin toss)\b/gi, term: "Equal-Liquidity Avoid", role: "filter" },
  { pattern: /\b(?:fomc|cpi|nfp|news.{0,10}(?:day|event)|high impact news)\b/gi, term: "News Avoid (FOMC/CPI/NFP)", role: "filter" },
  { pattern: /\b(?:minimum\s+(?:risk.?reward|r:?r|2r|3r)|skip.{0,15}(?:risk.reward|too close))\b/gi, term: "Min R:R Filter", role: "filter" },
];

function findQuote(transcript: string, pattern: RegExp, maxLen: number = 150): string {
  pattern.lastIndex = 0;
  const m = pattern.exec(transcript);
  if (!m) return "";
  const start = Math.max(0, m.index - 30);
  const end = Math.min(transcript.length, m.index + m[0].length + 90);
  return transcript.slice(start, end).replace(/\s+/g, " ").trim().slice(0, maxLen);
}

function countOccurrences(transcript: string, pattern: RegExp): number {
  pattern.lastIndex = 0;
  let count = 0;
  while (pattern.exec(transcript) !== null) {
    count++;
    if (count > 50) break;
  }
  return count;
}

/**
 * Extract proprietary speaker concepts from a transcript using NLP heuristics.
 * Returns up to 20 concepts ranked by occurrence count + role priority.
 */
export function extractSpeakerConceptsFromTranscript(transcript: string): Concept[] {
  if (!transcript || transcript.length < 200) return [];
  const concepts: Concept[] = [];
  const seen = new Set<string>();

  // 1. Known archetype-family terms
  for (const { pattern, term, role } of KNOWN_ARCHETYPE_TERMS) {
    const count = countOccurrences(transcript, pattern);
    if (count === 0) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const quote = findQuote(transcript, new RegExp(pattern.source, pattern.flags));
    concepts.push({
      term,
      role,
      verbatim_description: `${term} (mentioned ${count}× in transcript)`,
      transcript_quote: quote,
      occurrences: count,
    });
  }

  // 2. "I call this/that/it X" — explicit speaker naming
  const callPattern = /\b(?:I|we)\s+(?:call|name|term)\s+(?:this|that|it|them)\s+(?:the|a|an)?\s*([A-Z][\w\s\-]{2,40}?)(?:\.|,|\s+(?:because|so|that|which|and|but|or)|\s*$)/gi;
  let match: RegExpExecArray | null;
  while ((match = callPattern.exec(transcript)) !== null && concepts.length < 20) {
    const term = match[1]?.trim();
    if (!term || term.length < 3) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    concepts.push({
      term,
      role: inferRoleFromTerm(term),
      verbatim_description: `Speaker explicitly names: "${term}"`,
      transcript_quote: match[0].slice(0, 150),
      occurrences: 1,
    });
  }

  // 3. "what I call the X" / "this is my X"
  const myPattern = /\b(?:my|the|our)\s+([A-Z][\w]+(?:\s+[A-Z][\w]+){1,4})\b/g;
  while ((match = myPattern.exec(transcript)) !== null && concepts.length < 20) {
    const term = match[1]?.trim();
    if (!term || term.length < 6) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    // Require ≥2 mentions to filter out incidental capitalization
    const cnt = countOccurrences(transcript, new RegExp(`\\b${term.replace(/[-\\^$*+?.()|[\]{}]/g, "\\$&")}\\b`, "g"));
    if (cnt < 2) continue;
    seen.add(key);
    concepts.push({
      term,
      role: inferRoleFromTerm(term),
      verbatim_description: `Speaker uses term: "${term}" (mentioned ${cnt}× in transcript)`,
      transcript_quote: match[0].slice(0, 150),
      occurrences: cnt,
    });
  }

  // 4. Number-zone names ("25 to 50% optimum", "0.25 to 0.5 zone")
  const zonePattern = /\b(?:0?\.?\d{1,3}(?:\s*to\s*|\s*-\s*)0?\.?\d{1,3}\s*%?\s*(?:optimum|premature|overextended|danger|premium|discount|equilibrium)?\s*(?:zone|level|area|retracement)?)\b/gi;
  while ((match = zonePattern.exec(transcript)) !== null && concepts.length < 20) {
    const term = match[0].trim();
    if (!term || term.length < 5) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    concepts.push({
      term,
      role: "zone",
      verbatim_description: `Numerical zone reference: "${term}"`,
      transcript_quote: match[0].slice(0, 150),
      occurrences: 1,
    });
  }

  // Rank: occurrences DESC, then explicit-named > inferred
  concepts.sort((a, b) => b.occurrences - a.occurrences);
  return concepts.slice(0, 20);
}

function inferRoleFromTerm(term: string): Concept["role"] {
  const t = term.toLowerCase();
  if (/(zone|level|range|area|pool)/i.test(t)) return "zone";
  if (/(model|framework|system|pattern|theory)/i.test(t)) return "model";
  if (/(filter|avoid|skip|exclude|never)/i.test(t)) return "filter";
  if (/(stop|invalidation|invalidat)/i.test(t)) return "stop_anchor";
  if (/(target|tp|take profit|goal)/i.test(t)) return "target";
  if (/(entry|trigger|signal|setup)/i.test(t)) return "entry_step";
  if (/(phase|stage|step|leg)/i.test(t)) return "phase";
  return "indicator";
}
