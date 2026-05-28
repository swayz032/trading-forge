/**
 * Wave 26 Pass L Fix K (2026-05-27) — Recall-pass extractor.
 *
 * The breakthrough after manual transcript audits surfaced the following
 * silent-drop pattern in single-pass gemma extractions:
 *   - Video 8 (aHLIE_TXjpo): speaker says "had a win rate of 52.63%" → gemma
 *     missed it entirely. Also missed time-window filter (6am/10am/2pm only)
 *     and candle-body filter (no hammers/indecision/heavy-wick candles).
 *   - Video 9 (FqxEKDxemtI): speaker says "this is a Forex specific trading
 *     strategy I have not traded it on the other instruments" → gemma missed
 *     the portability flag. Also missed news-event filter.
 *   - Video 7 (1HFoStW_wsc): teaching-content depth still ~50% of what the
 *     speaker actually taught (probability bands, false-break rule, etc.)
 *
 * Single-pass gemma divides its attention across 8 schema fields. The recall
 * pass asks ONE focused question per topic, sequentially, so attention is
 * undivided. Each question requires an EXACT TRANSCRIPT QUOTE — null when the
 * speaker doesn't say it. No invention.
 *
 * Architecture:
 *   Call 1 (primary):  transcript → minimal 8-field extraction (unchanged)
 *   Call 2 (recall):   transcript + primary JSON → 5 yes/no answers w/ quotes
 *   TS code merges: only fills NULL primary fields; never overwrites.
 *
 * Pure local. No cloud. No tool-calling. Just 2 sequential /api/chat calls.
 */

import { callScoutExtractLlm } from "../services/model-router.js";

export interface RecallField {
  /** The parsed value (number for win_rate/avg_r, string for the others) or null when speaker doesn't say it. */
  value: number | string | null;
  /** Exact transcript quote that the LLM grounded the answer in. Null when value is null. */
  quote: string | null;
}

export interface RecallAnswer {
  win_rate: RecallField;
  avg_r: RecallField;
  time_filter: RecallField;
  candle_filter: RecallField;
  instrument_lock: RecallField;
}

export interface PrimaryStrategyShape {
  name?: string | null;
  direction?: string;
  entry_sequence?: Array<{ step?: number; action?: string; rationale?: string | null }>;
  source_claim_win_rate?: number | null;
  source_claim_avg_r?: number | null;
  confluences?: Array<{ name: string; description: string; canonical_match?: string | null }>;
  [k: string]: unknown;
}

export interface RecallResult {
  patched: PrimaryStrategyShape;
  recall: RecallAnswer;
  appliedChanges: string[];
  failed: boolean;
  failureReason?: string;
}

// Wave 26 Pass L Fix P (2026-05-27) — Operator correction: win_rate + avg_r are
// OUTPUT metrics measured by the backtester, NOT design targets. CLAUDE.md §1 +
// feedback_win_rate_is_output_not_target.md. Recall pass now focuses ONLY on
// STRATEGY MECHANICS gemma misses (time / candle filters, instrument lock).
// Source-claimed win_rate / avg_r are deliberately not extracted.
const RECALL_PROMPT = `You previously extracted a trading strategy from a YouTube video transcript. The first-pass extraction often misses MECHANIC details — time-of-day filters, candle-quality filters, instrument-lock notes — that are buried mid-transcript. You are now doing a TARGETED RECALL PASS.

## First-pass extraction (already captured)

\`\`\`json
{PRIMARY_JSON}
\`\`\`

## FULL transcript (re-read it carefully)

\`\`\`
{TRANSCRIPT}
\`\`\`

## Why this pass is mechanic-only

Per CLAUDE.md §1: **"Win rate is an OBSERVED output metric — never a target, never a gate."** The backtester measures performance via avg-R / PF / deflated-Sharpe — what the speaker claims doesn't matter. So this recall pass DOES NOT extract win-rate or R-multiple claims; it focuses on the STRATEGY MECHANICS gemma reliably misses.

## YOUR TASK — answer 3 focused questions

For each question: if the SPEAKER says it (even briefly, anywhere in the transcript), capture the value + the EXACT QUOTE. If the speaker does NOT say it, set BOTH to null. NEVER invent. NEVER infer. Only what the speaker explicitly stated.

Return ONLY this JSON shape, nothing else:

\`\`\`json
{
  "win_rate":        { "value": null, "quote": null },
  "avg_r":           { "value": null, "quote": null },
  "time_filter":     { "value": <string description or null>, "quote": <exact transcript quote or null> },
  "candle_filter":   { "value": <string description or null>, "quote": <exact transcript quote or null> },
  "instrument_lock": { "value": <string or null>,             "quote": <exact transcript quote or null> }
}
\`\`\`

**win_rate and avg_r are ALWAYS null in this pass. The backtester measures them — speaker claims don't matter. Leave both null.**

### Q3: TIME-OF-DAY FILTER
Does the speaker restrict trades to specific time windows?
- "only trade the 6am, 10am, and 2pm 4H candles" → value: "6am/10am/2pm 4H candles only"
- "skip lunch 11:30-13:30 ET" → value: "skip lunch 11:30-13:30 ET"
- "London and NY sessions only" → value: "London + NY sessions only"
- "only 10am candle on the 4-hour chart" → value: "10am 4H candle only"
- "avoid news hours" → value: "avoid news hours"

### Q4: CANDLE-QUALITY FILTER
Does the speaker require specific candle quality on the bias candle?
- "big body required, no skinny/indecision candles" → value: "body > wick required; reject skinny/indecision"
- "skip hammers and dojis" → value: "skip hammers / dojis"
- "wick must be at bottom if buying" → value: "wick direction must match trade direction (bottom-wick = buy; top-wick = sell)"
- "no candles with huge top wicks if looking to buy" → value: "reject heavy-top-wick candles for longs"

### Q5: INSTRUMENT LOCK
Does the speaker explicitly say the strategy is INSTRUMENT-SPECIFIC and may not port to futures?
- "this is Forex-specific — I haven't traded it on other instruments" → value: "Forex-specific (speaker note)"
- "this works best on stocks, not futures" → value: "Stocks-specific (speaker preference)"
- "crypto-only setup using on-chain data" → value: "Crypto-only"
- If speaker uses futures examples or says "works on any chart" → value: null

## CRITICAL ANTI-HALLUCINATION RULE

Each \`quote\` field MUST be an EXACT SUBSTRING of the transcript above (case-insensitive). Quotes are programmatically verified against the transcript after you respond — if your quote doesn't match a substring, the entire field is DISCARDED. So:

- Don't paraphrase a quote. Copy it verbatim from the transcript text above.
- Don't reuse the EXAMPLE wording from this prompt as a "quote" — examples are illustrative, not transcript content.
- If the speaker doesn't say something, set BOTH \`value\` AND \`quote\` to null. Empty is honest.
`;

/**
 * Pre-scan transcript for numeric claims (% / R-multiple / out-of-N).
 * Injected into recall prompt so gemma can't miss explicit numeric statements.
 */
export function preScanNumericClaims(transcript: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const text = transcript;

  // Patterns to scan for, with their match groups extracted.
  const patterns: Array<{ rx: RegExp; label: string }> = [
    { rx: /\b\d{1,3}(?:\.\d{1,3})?\s*%\b/gi, label: "PERCENTAGE" },
    { rx: /\b\d{1,3}(?:\.\d{1,3})?\s+(?:percent|percentage)\b/gi, label: "PERCENT-WORD" },
    { rx: /\b(?:win\s+rate|hit\s+rate|accuracy|win\s+pct|winrate)\b[^.]{0,80}/gi, label: "WIN-RATE-CONTEXT" },
    { rx: /\b\d+(?:\.\d+)?\s*[:/-]\s*\d+(?:\.\d+)?\b\s*(?:R(?:\/R)?|risk[\s-]?(?:to|reward))/gi, label: "RR-RATIO" },
    { rx: /\b\d+(?:\.\d+)?\s*R\b\s+(?:per\s+trade|target|reward|profit)/gi, label: "R-MULTIPLE" },
    { rx: /\b(?:risk|risking)\s+\d+(?:\.\d+)?\s+(?:to|for)\s+(?:make|gain|profit)\s+\d+(?:\.\d+)?\b/gi, label: "RISK-FOR-MAKE" },
    { rx: /\b\d+\s+out\s+of\s+\d+\s+(?:trades?|times?|wins?)/gi, label: "OUT-OF-N" },
  ];

  for (const { rx, label } of patterns) {
    const matches = text.matchAll(rx);
    for (const m of matches) {
      const snippet = m[0].trim();
      const key = `${label}::${snippet.toLowerCase()}`;
      if (snippet.length >= 2 && snippet.length <= 200 && !seen.has(key)) {
        seen.add(key);
        // Capture ~40 chars of surrounding context
        const start = Math.max(0, (m.index ?? 0) - 30);
        const end = Math.min(text.length, (m.index ?? 0) + snippet.length + 30);
        const context = text.slice(start, end).replace(/\s+/g, " ").trim();
        found.push(`[${label}] "${snippet}"  (context: "...${context}...")`);
      }
    }
  }

  return found;
}

/**
 * Wave 26 Pass L Fix N (2026-05-27) — Deterministic numeric-claim parser.
 * For win_rate and avg_r, gemma fails to convert prescan candidates to values
 * even when given the exact text. Skip gemma entirely for these two fields.
 *
 * Returns { win_rate, avg_r } parsed from regex matches against transcript.
 * Each field includes the value + the exact quote span used.
 */
export interface DeterministicClaims {
  win_rate: { value: number | null; quote: string | null };
  avg_r: { value: number | null; quote: string | null };
}

export function extractClaimsDeterministically(transcript: string): DeterministicClaims {
  const result: DeterministicClaims = {
    win_rate: { value: null, quote: null },
    avg_r: { value: null, quote: null },
  };

  // ── WIN RATE ──────────────────────────────────────────────────────────────
  // Match patterns like:
  //   "win rate of 52.63%"
  //   "had a win rate of 80%"
  //   "82% win rate"
  //   "hits 70-80% of the time"
  //   "70 to 80 percent of the time"
  const winRatePatterns: Array<{ rx: RegExp; extract: (m: RegExpMatchArray) => number | null }> = [
    // "win rate of N(.N)?%" / "win rate of N percent"
    { rx: /\bwin\s+rate\s+of\s+(\d+(?:\.\d+)?)\s*%/i, extract: (m) => parseFloat(m[1]) / 100 },
    { rx: /\bwin\s+rate\s+of\s+(\d+(?:\.\d+)?)\s+percent\b/i, extract: (m) => parseFloat(m[1]) / 100 },
    // "N(.N)?% win rate" / "N(.N)?% accuracy"
    { rx: /\b(\d+(?:\.\d+)?)\s*%\s+(?:win\s+rate|accuracy|winrate)\b/i, extract: (m) => parseFloat(m[1]) / 100 },
    // "hits N(-M)?% of the time" (range → midpoint)
    { rx: /\bhits?\s+(\d+)(?:[-\s]+(?:to\s+)?(\d+))?\s*%\s+of\s+the\s+time\b/i, extract: (m) => {
      const lo = parseFloat(m[1]);
      const hi = m[2] ? parseFloat(m[2]) : lo;
      return ((lo + hi) / 2) / 100;
    }},
    // "N out of M trades"
    { rx: /\b(\d+)\s+out\s+of\s+(\d+)\s+(?:trades?|times?|wins?)/i, extract: (m) => {
      const n = parseFloat(m[1]);
      const d = parseFloat(m[2]);
      return d > 0 ? n / d : null;
    }},
  ];

  for (const p of winRatePatterns) {
    // Use matchAll so we can scan all candidates and skip negated ones.
    const allMatches = [...transcript.matchAll(new RegExp(p.rx.source, "gi"))];
    for (const m of allMatches) {
      if (m.index === undefined) continue;
      // Wave 26 Pass L Fix O (2026-05-27) — negation detector.
      // Look back ~40 chars for "not a 100% win rate" / "isn't" / "never" / "no"
      // → REJECT match. Speaker is negating the claim, not making it.
      const lookback = transcript.slice(Math.max(0, m.index - 40), m.index).toLowerCase();
      if (/\b(?:not(?:\s+a)?|isn'?t|wasn'?t|never|hardly|barely|no(?:t)?\s+(?:a\s+)?(?:guaranteed|claim))\b\s*$/.test(lookback)) {
        continue; // negated — try next match
      }
      const val = p.extract(m);
      if (val !== null && val >= 0 && val <= 1) {
        const start = Math.max(0, m.index - 20);
        const end = Math.min(transcript.length, m.index + m[0].length + 20);
        result.win_rate = { value: val, quote: transcript.slice(start, end).replace(/\s+/g, " ").trim() };
        return result;
      }
    }
  }

  // ── AVG R ────────────────────────────────────────────────────────────────
  // "1:2 risk to reward" / "1:2 R/R" / "going for 1:2" → R = 2/1 = 2.0
  const rrRatioMatch = transcript.match(/(\d+(?:\.\d+)?)\s*[:/-]\s*(\d+(?:\.\d+)?)\s*(?:R(?:\/R)?\b|risk[\s-]?(?:to|reward))/i);
  if (rrRatioMatch && rrRatioMatch.index !== undefined) {
    const risk = parseFloat(rrRatioMatch[1]);
    const reward = parseFloat(rrRatioMatch[2]);
    if (risk > 0 && reward > 0) {
      const avgR = reward / risk;
      if (avgR > 0 && avgR <= 10) {
        const start = Math.max(0, rrRatioMatch.index - 20);
        const end = Math.min(transcript.length, rrRatioMatch.index + rrRatioMatch[0].length + 20);
        result.avg_r = { value: avgR, quote: transcript.slice(start, end).replace(/\s+/g, " ").trim() };
      }
    }
  }

  // Single-R patterns: "minimum 1.5R" / "aim for 2R" / "average 1.5R per trade"
  if (result.avg_r.value === null) {
    const rPattern = transcript.match(/\b(?:minimum|target|aim(?:ing)?\s+(?:for|at)|average|going\s+for|seek)\s+(\d+(?:\.\d+)?)\s*R\b/i);
    if (rPattern && rPattern.index !== undefined) {
      const val = parseFloat(rPattern[1]);
      if (val > 0 && val <= 10) {
        const start = Math.max(0, rPattern.index - 20);
        const end = Math.min(transcript.length, rPattern.index + rPattern[0].length + 20);
        result.avg_r = { value: val, quote: transcript.slice(start, end).replace(/\s+/g, " ").trim() };
      }
    }
  }

  return result;
}

/**
 * Verify a recall-pass quote against the transcript via fuzzy substring match.
 * Normalizes whitespace, ellipses, smart quotes. Case-insensitive.
 * Returns true if the quote is grounded in the transcript.
 */
export function verifyQuoteInTranscript(quote: string | null, transcript: string): boolean {
  if (!quote || typeof quote !== "string") return false;

  const normalize = (s: string): string =>
    s
      .toLowerCase()
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/\.{3,}|…/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const normQuote = normalize(quote);
  const normTranscript = normalize(transcript);

  if (normQuote.length < 6) return false; // too short to verify reliably

  // Direct substring
  if (normTranscript.includes(normQuote)) return true;

  // Try first ~50 chars (catches truncated/ellipsis quotes)
  if (normQuote.length > 50) {
    const head = normQuote.slice(0, 50);
    if (normTranscript.includes(head)) return true;
  }

  // Try first ~30 chars as last resort
  if (normQuote.length > 30) {
    const head = normQuote.slice(0, 30);
    if (normTranscript.includes(head)) return true;
  }

  return false;
}

export async function runRecallPass(
  transcript: string,
  primary: PrimaryStrategyShape,
): Promise<RecallResult> {
  // Pre-scan transcript for numeric claims so gemma can't miss them
  const prescan = preScanNumericClaims(transcript);
  const prescanBlock = prescan.length === 0
    ? "(no percentage / R-multiple phrases found by pre-scan — speaker likely makes no numeric claim)"
    : prescan.map((s) => `- ${s}`).join("\n");

  const userPayload = RECALL_PROMPT
    .replace("{PRIMARY_JSON}", JSON.stringify(primary, null, 2))
    .replace("{PRESCAN_CANDIDATES}", prescanBlock)
    .replace("{TRANSCRIPT}", transcript.slice(0, 16_000));

  let raw: string | null = null;
  try {
    raw = await callScoutExtractLlm([{ role: "user", content: userPayload }]);
  } catch (e) {
    return {
      patched: primary,
      recall: emptyRecall(),
      appliedChanges: [],
      failed: true,
      failureReason: `recall_call_threw: ${(e as Error).message}`,
    };
  }
  if (!raw) {
    return {
      patched: primary,
      recall: emptyRecall(),
      appliedChanges: [],
      failed: true,
      failureReason: "recall_call_null",
    };
  }

  let recall: RecallAnswer;
  try {
    const parsed = JSON.parse(raw) as Partial<RecallAnswer>;
    recall = {
      win_rate: normalizeField(parsed.win_rate),
      avg_r: normalizeField(parsed.avg_r),
      time_filter: normalizeField(parsed.time_filter),
      candle_filter: normalizeField(parsed.candle_filter),
      instrument_lock: normalizeField(parsed.instrument_lock),
    };

    // Wave 26 Pass L Fix O (2026-05-27) — value/quote alignment check on win_rate.
    // Quote MUST contain a numeric value (digit + % OR "of the time" OR "X out of Y").
    // Catches the fabrication case where gemma pastes a real-but-unrelated quote
    // (e.g. "I promise you this video can change your life") with an invented value.
    if (recall.win_rate.value !== null && typeof recall.win_rate.quote === "string") {
      const q = recall.win_rate.quote.toLowerCase();
      const hasNumericClaim =
        /\d+(?:\.\d+)?\s*%/.test(q) ||                       // "70%"
        /\d+(?:\.\d+)?\s+(?:percent|percentage)\b/.test(q) ||// "70 percent"
        /\d+\s+out\s+of\s+\d+/.test(q) ||                    // "7 out of 10"
        /\b(?:win\s+rate|hit\s+rate|accuracy)\b/.test(q);    // explicit win-rate phrase
      if (!hasNumericClaim) {
        (recall as Record<string, unknown>)._rejected = (recall as Record<string, unknown>)._rejected ?? {};
        ((recall as Record<string, unknown>)._rejected as Record<string, unknown>)["win_rate"] =
          `quote_has_no_numeric_claim: "${q.slice(0, 80)}" (value ${recall.win_rate.value} not derivable from quote)`;
        recall.win_rate = { value: null, quote: null };
      }
    }

    // Wave 26 Pass L Fix M (2026-05-27) — value-sanity check on avg_r.
    // The quote MUST contain explicit R-syntax. "20 pips" is a pip distance, NOT 2R.
    if (recall.avg_r.value !== null && typeof recall.avg_r.quote === "string") {
      const q = recall.avg_r.quote.toLowerCase();
      const hasRSyntax =
        /\b\d+\s*[:/-]\s*\d+\b/.test(q) ||         // 1:2, 1/2, 1-2
        /\b\d+(?:\.\d+)?\s*r\b/i.test(q) ||         // 2R, 1.5R
        /\brisk[\s-]?(?:to|reward|\/)/i.test(q) ||  // risk to reward / risk/reward
        /\brisking?\s+\d+.+(?:make|gain|profit)\s+\d+/i.test(q);
      if (!hasRSyntax) {
        recall.avg_r = { value: null, quote: null };
        (recall as Record<string, unknown>)._rejected = (recall as Record<string, unknown>)._rejected ?? {};
        ((recall as Record<string, unknown>)._rejected as Record<string, unknown>)["avg_r"] =
          `quote_lacks_R_syntax: "${q.slice(0, 80)}" (pip distances are not R-multiples)`;
      }
    }

    // Wave 26 Pass L Fix L (2026-05-27) — verify every quote against the transcript.
    // Catches both hallucinations AND prompt-example leakage (gemma copying
    // example text from the prompt as if it were a real quote). Bulletproof:
    // any field whose quote substring isn't in the transcript is DISCARDED.
    const fields: Array<keyof RecallAnswer> = ["win_rate", "avg_r", "time_filter", "candle_filter", "instrument_lock"];
    for (const f of fields) {
      const field = recall[f];
      if (field.value !== null && field.quote !== null) {
        const grounded = verifyQuoteInTranscript(field.quote, transcript);
        if (!grounded) {
          // Discard the unverified field — it's hallucinated or example-leaked.
          recall[f] = { value: null, quote: null };
          // Push an audit-style change entry so caller can log the rejection.
          (recall as Record<string, unknown>)._rejected = (recall as Record<string, unknown>)._rejected ?? {};
          ((recall as Record<string, unknown>)._rejected as Record<string, unknown>)[f] =
            `quote_not_in_transcript: "${field.quote.slice(0, 80)}"`;
        }
      }
    }
  } catch (e) {
    return {
      patched: primary,
      recall: emptyRecall(),
      appliedChanges: [],
      failed: true,
      failureReason: `recall_parse_failed: ${(e as Error).message}`,
    };
  }

  // Wave 26 Pass L Fix P (2026-05-27) — operator correction: win_rate + avg_r
  // are OUTPUT metrics measured by the backtester, not extraction targets.
  // Hard-null both fields regardless of what gemma or the deterministic
  // extractor produced. See feedback_win_rate_is_output_not_target.md +
  // CLAUDE.md §1. Fix N's extractClaimsDeterministically is kept exported for
  // backward-compat callers but its output is ignored here.
  recall.win_rate = { value: null, quote: null };
  recall.avg_r = { value: null, quote: null };

  // Apply patches. ONLY fill NULL primary fields. NEVER overwrite real values.
  const patched: PrimaryStrategyShape = { ...primary };
  const appliedChanges: string[] = [];

  if (
    recall.win_rate.value !== null &&
    typeof recall.win_rate.value === "number" &&
    (primary.source_claim_win_rate == null)
  ) {
    patched.source_claim_win_rate = recall.win_rate.value;
    appliedChanges.push(
      `source_claim_win_rate ← ${recall.win_rate.value} ("${(recall.win_rate.quote ?? "").slice(0, 80)}")`,
    );
  }

  if (
    recall.avg_r.value !== null &&
    typeof recall.avg_r.value === "number" &&
    (primary.source_claim_avg_r == null)
  ) {
    patched.source_claim_avg_r = recall.avg_r.value;
    appliedChanges.push(
      `source_claim_avg_r ← ${recall.avg_r.value} ("${(recall.avg_r.quote ?? "").slice(0, 80)}")`,
    );
  }

  // Time/candle filters add to confluences[] (operator's existing 11-factor model
  // maps time_window → killzone_active; candle_quality has no canonical match yet).
  const newConfluences: Array<{ name: string; description: string; canonical_match?: string | null }> = [];

  if (recall.time_filter.value && typeof recall.time_filter.value === "string") {
    newConfluences.push({
      name: "time_window_filter",
      description: recall.time_filter.value,
      canonical_match: "killzone_active",
    });
    appliedChanges.push(`+confluence time_window_filter ("${(recall.time_filter.quote ?? "").slice(0, 60)}")`);
  }

  if (recall.candle_filter.value && typeof recall.candle_filter.value === "string") {
    newConfluences.push({
      name: "candle_quality_filter",
      description: recall.candle_filter.value,
      canonical_match: null,
    });
    appliedChanges.push(`+confluence candle_quality_filter ("${(recall.candle_filter.quote ?? "").slice(0, 60)}")`);
  }

  if (newConfluences.length > 0) {
    const existing = Array.isArray(primary.confluences) ? primary.confluences : [];
    // Dedupe by name in case primary already has time_window_filter / candle_quality_filter
    const existingNames = new Set(existing.map((c) => c.name));
    const toAdd = newConfluences.filter((c) => !existingNames.has(c.name));
    if (toAdd.length > 0) {
      patched.confluences = [...existing, ...toAdd];
    }
  }

  // Instrument lock — log to appliedChanges; downstream (graduator) consumes via patched._instrument_lock annotation
  if (recall.instrument_lock.value && typeof recall.instrument_lock.value === "string") {
    (patched as Record<string, unknown>)._instrument_lock_note = {
      value: recall.instrument_lock.value,
      quote: recall.instrument_lock.quote,
    };
    appliedChanges.push(`+annotation _instrument_lock_note: ${recall.instrument_lock.value} ("${(recall.instrument_lock.quote ?? "").slice(0, 60)}")`);
  }

  return { patched, recall, appliedChanges, failed: false };
}

function emptyRecall(): RecallAnswer {
  return {
    win_rate: { value: null, quote: null },
    avg_r: { value: null, quote: null },
    time_filter: { value: null, quote: null },
    candle_filter: { value: null, quote: null },
    instrument_lock: { value: null, quote: null },
  };
}

function normalizeField(raw: unknown): RecallField {
  if (raw === null || raw === undefined) return { value: null, quote: null };
  if (typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    const value = (o.value === undefined || o.value === null) ? null : (o.value as number | string);
    const quote = (o.quote === undefined || o.quote === null) ? null : String(o.quote);
    return { value, quote };
  }
  return { value: null, quote: null };
}

export async function runRecallPassOnStrategies(
  transcript: string,
  strategies: PrimaryStrategyShape[],
): Promise<RecallResult[]> {
  const results: RecallResult[] = [];
  // SEQUENTIAL — single GPU, no parallel gemma calls.
  for (const s of strategies) {
    const r = await runRecallPass(transcript, s);
    results.push(r);
  }
  return results;
}
