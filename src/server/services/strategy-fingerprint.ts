/**
 * Strategy Fingerprint Helper — Pass 18 + Pass 20 + Pass 20 Track M
 *
 * Provides deterministic fingerprinting of strategy ideas for the
 * cross-source pending-bucket system.
 *
 * Pass 18 (original): fingerprint = sha256(market|entry_archetype|exit_type)
 *   Bucket key: two ideas with same market + archetype + exit → same bucket.
 *
 * Pass 20 (concept fingerprint): NEW secondary fingerprint scheme.
 *   fingerprint = sha256(market|normalized_concept_name)
 *   where normalized_concept_name strips spaces/punctuation/case.
 *   This distinguishes "1-min ORB" from "15-min ORB" on the same market,
 *   which the old scheme collapsed into one bucket (both ORBs share market +
 *   breakout archetype + same exit type). The new scheme keys on the CONCEPT
 *   NAME, preserving nuances between named strategy variants.
 *
 *   Both schemes coexist. Pass 20 introduces computeConceptFingerprintHash()
 *   as the new primary key; computeFingerprintHash() is retained for
 *   backward-compatibility with Pass 18 data.
 *
 * Pass 20 Track M (canonical concept name): NEW canonicalConceptName() export.
 *   Problem: 5R organic runs produced 4 separate buckets for the same ORB
 *   concept because LLMs emit abbreviation variants:
 *     opening_range_breakout, opening_range_breakout_orb,
 *     orb_open_range_breakout, opening_range_breakout_orb_strategy
 *   The normalizeConceptName() pass-through only strips punctuation/case — it
 *   does NOT fold abbreviation synonyms or sort tokens.
 *
 *   canonicalConceptName() applies:
 *     1. Lowercase + underscore normalization
 *     2. Known abbreviation expansion (orb → opening_range_breakout, etc.)
 *     3. Stopword suffix/prefix stripping
 *     4. Token-sort + dedupe (alphabetical) so token ordering never matters
 *     5. 60-char cap
 *   Result: all 4 ORB variants produce "breakout_opening_range", which
 *   means YouTube/Reddit mentions converge on the same bucket for graduation.
 *
 *   computeConceptFingerprintHash() now calls canonicalConceptName()
 *   instead of normalizeConceptName().
 *
 * Design choices:
 *   - SHA-256 hex sliced to 32 chars (128 bits). Collision probability
 *     negligible for the expected bucket count (<10K lifetime strategies).
 *   - Archetype and exit classifiers are regex-based and conservative:
 *     when uncertain they return "unknown" so the fingerprint still works.
 *   - Functions are pure and synchronous — no I/O, no side effects.
 *     Callers can unit-test them without DB or network.
 */

import { createHash } from "crypto";

// ─── Types ──────────────────────────────────────────────────────────────────

export type EntryArchetype =
  | "breakout"
  | "mean_reversion"
  | "trend_follow"
  | "momentum"
  | "volatility_expansion"
  | "session_pattern"
  | "event_driven"
  | "unknown";

export type ExitType =
  | "atr_multiple"
  | "trailing_stop"
  | "fixed_target"
  | "time_exit"
  | "indicator_signal"
  | "unknown";

// ─── Fingerprint compute ─────────────────────────────────────────────────────

/**
 * Compute a 32-hex-char fingerprint from (market, entry_archetype, exit_type).
 * Deterministic: same inputs always produce the same output.
 * Retained for backward-compatibility with Pass 18 bucket data.
 *
 * PREFER computeConceptFingerprintHash() for new buckets (Pass 20+).
 * The old scheme collapses all ORB strategies on the same market into one
 * bucket — concept-based fingerprinting preserves named variants.
 */
export function computeFingerprintHash(input: {
  market: string;
  entry_archetype: string;
  exit_type: string;
}): string {
  const raw = `${input.market}|${input.entry_archetype}|${input.exit_type}`;
  return createHash("sha256").update(raw, "utf8").digest("hex").slice(0, 32);
}

/**
 * Normalize a concept name for fingerprinting:
 *   - Lowercase
 *   - Strip all non-alphanumeric characters (spaces, hyphens, underscores,
 *     punctuation, parentheses, slashes)
 *
 * "Opening Range Breakout" → "openingrangebreakout"
 * "1-min ORB" → "1minorb"
 * "15-min ORB" → "15minorb"
 * "VWAP_Pullback" → "vwappullback"
 *
 * Pure function — deterministic, no I/O.
 *
 * NOTE: Retained for backward-compatibility. New code should call
 * canonicalConceptName() which additionally expands abbreviations, strips
 * stopwords, and token-sorts so synonym variants collapse to the same form.
 */
export function normalizeConceptName(conceptName: string): string {
  return conceptName.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// ─── Canonical concept name (Pass 20 Track M) ────────────────────────────────

/**
 * Map of single-token abbreviations → canonical expansion tokens.
 * Keys are lowercase, no underscores. Values are the underscore-joined
 * canonical expansion that replaces the abbreviated token.
 *
 * Applied BEFORE token sort so "orb" is always expanded to
 * "opening_range_breakout" and duplicate tokens are deduped away.
 *
 * Entries must be lowercase alphanumeric strings (no underscores in key).
 */
const ABBREVIATION_MAP: Readonly<Record<string, string>> = {
  orb:   "opening_range_breakout",
  open:  "opening",              // "open_range_breakout" → same tokens as "opening_range_breakout"
  sma:   "simple_moving_average",
  ema:   "exponential_moving_average",
  bb:    "bollinger_band",
  fvg:   "fair_value_gap",
  ob:    "order_block",
  ifvg:  "inverse_fair_value_gap",
  poc:   "point_of_control",
  val:   "value_area_low",
  vah:   "value_area_high",
  rth:   "regular_trading_hours",
  eth:   "extended_trading_hours",
  nyo:   "ny_open",
  ldn:   "london_session",
  // These are already canonical — no expansion needed, but list here for documentation.
  // vwap, rsi, macd, atr, ict, fomc, cpi: no entry (key absent = keep as-is)
};

/**
 * Stopword suffixes stripped after abbreviation expansion.
 * Applied as trailing underscore-joined token groups.
 */
const STOPWORD_SUFFIXES = [
  "_strategy",
  "_setup",
  "_pattern",
  "_system",
  "_method",
  "_approach",
  "_technique",
  "_play",
];

/**
 * Stopword prefixes stripped after abbreviation expansion.
 */
const STOPWORD_PREFIXES = [
  "the_",
  "a_",
  "an_",
];

/**
 * Pass 21 (2026-05-16) — noise tokens filtered out anywhere in the token list
 * (not just edges). Covers SEO/URL-slug pollution from scout-extract:
 *   - Article fluff and click-bait words
 *   - Source-site slugs (publishing domain fragments)
 *   - Trader-author surnames (technique > attribution)
 *   - Generic trading-jargon nouns that don't differentiate concepts
 *
 * Result: "linda_raschke_holy_grail_setup_explained_pdf" → "grail_holy"
 *         "rsi_2_larry_connors_stratbase_ai"             → "2_rsi"
 *         "supertrend_indicator_set_up_use_and_create_profita" → "supertrend"
 *
 * Conservative — only strips tokens that NEVER differentiate two real trading
 * setups. Indicator periods (9, 14, 21, 200), timeframes (5m, 15m), market
 * tickers (mes, mnq, es, nq) all SURVIVE so variants stay distinct.
 */
const NOISE_TOKENS: ReadonlySet<string> = new Set([
  // Trader-author surnames (technique > attribution per CLAUDE.md §4)
  "linda", "raschke",
  "larry", "connors",
  "john", "carter",
  "raghee", "horner",
  "alexander", "elder",
  "murphy",
  // (bollinger NOT in noise — `bb` expansion needs it as a token; Bollinger
  //  Bands indicator naming is more important than stripping the surname.)
  "wyckoff",
  "fibonacci", "fib",  // generic fib usage in concept names is rare; specific patterns survive
  "leibovit",
  "tom", "demark",
  // Setup-specific stopword (overlaps STOPWORD_SUFFIXES which only strips edges)
  "setup", "setups",
  // Article-structural fluff
  "types", "type",
  "period", "periods",
  "meaning", "meanings",
  "definition", "definitions",
  "summary", "overview",
  // Single-letter cruft from URL slug splits (e.g., "r_daytrading_on_reddit_i_...")
  "i", "u", "e", "x",
  // Article fluff / click-bait
  "explained", "explanation", "explanations", "explanatory",
  "tested", "testing", "test", "tests",
  "tutorial", "tutorials",
  "guide", "guides", "ultimate", "complete", "beginners", "advanced",
  "exploring", "explore",
  "understanding", "mastering", "master",
  "building", "build", "create", "creating",
  "dangerous", "traps", "trap",
  "secrets", "secret",
  "profitable", "profita", "profit", "profits",
  "winning", "wins", "win",
  "best", "top", "great",
  "proven", "signals", "signal",
  "results", "result",
  "backtest", "backtests", "backtested", "backtesting",
  "cheat", "sheet",
  "pdf",
  "data", "backed",
  "magic", "hours",
  "millionaires",
  "consistently", "consistent",
  "rules", "rule",
  "discovery",
  "v1", "v2", "v3",
  "fr",
  // Article verbs/wh-words
  "why", "what", "how", "when", "where", "who",
  "dont", "don", "people", "more",
  "use", "uses", "using", "used",
  "do", "does", "did",
  "with", "without", "and", "or", "of", "to", "for", "from", "by", "in", "on", "at", "as",
  "is", "are", "was", "were", "be", "been", "being",
  "set", "sets", "setting", "settings",
  "based",
  "still", "works", "work",
  "tight", "big", "small", "reward", "risk",
  "indicator", "indicators",  // generic; specific indicators (rsi, ema, macd, vwap) survive
  "formula", "formulas",
  "capitalizing", "capitalize",
  "confirm", "confirmation",
  "candles", "candle",
  // Source-site slugs (publishing domains leaking into concept names)
  "stratbase",
  "litefinance",
  "metricgate",
  "edgeful", "blog",
  "alchemy", "markets",
  "atas",
  "skyrexio",
  "chartschool", "stockcharts",
  "finveroo", "finwiz",
  "thinkorswim", "tos",
  "trade2win", "forums", "forum", "uk",
  "tradezella",
  "tradingview",
  "tradingrage",
  "investinglive",
  "fluxcharts",
  "luxalgo",
  "optionalpha",
  "fxopen", "ig", "phidias", "prop",
  "trinitytrading",
  "trading", "trader", "traders",   // generic verb — "trading strategy" → just the strategy
  "futures", "stocks", "stock", "crypto", "forex", "options",
  "futurestrading", "daytrading",
  "ai",
  "docs", "doc", "com", "org", "net",
  "alpha", "alphalearning", "learning",
  "global",
  "explanations", "explained",
  "indicators",
  "smart", "money", "brief",
  // Reddit-thread cruft
  "reddit", "subreddit",
  "r", "z",  // leading "r_" prefix (e.g. r_daytrading) hits "r" as single token
  // Misc structural — NOTE: timeframe tokens ("min", "minute", "hour", "hourly",
  // "daily") intentionally NOT in this list (F-6 fix 2026-05-20). These tokens
  // distinguish strategy variants (4h vs 1h vs daily vs 5min are different edges).
  // Stripping them caused "RSI-2 5-min" and "RSI-2 daily" to hash identically.
  "im", "ive", "youve", "didnt",
  "early", "late", "before", "after",
  "easy", "easy_money",
  "old", "new",
  "real", "fake",
]);

/**
 * Tokens that look like NOISE but should be PRESERVED because they're informational.
 * Anything in here is whitelisted from NOISE_TOKENS removal.
 * (Currently empty — but exists as escape hatch for future false-positive cases.)
 */
const NOISE_WHITELIST: ReadonlySet<string> = new Set([]);

/**
 * Produce a canonical, stable form of a concept name suitable for
 * cross-source bucket fingerprinting.
 *
 * Pipeline (applied in order):
 *   1. Lowercase + replace non-alphanumeric runs with single underscore
 *   2. Strip leading/trailing underscores
 *   3. Expand known abbreviations per ABBREVIATION_MAP
 *   4. Strip stopword suffixes (e.g. _strategy, _setup)
 *   5. Strip stopword prefixes (e.g. the_, a_)
 *   6. Split on underscore → dedupe identical tokens → sort alphabetically
 *   7. Rejoin with underscore → cap at 60 chars (trim at last full token ≤60)
 *
 * This ensures that abbreviation variants of the same concept converge:
 *   "opening_range_breakout"          → "breakout_opening_range"
 *   "opening_range_breakout_orb"      → "breakout_opening_range"
 *   "orb_open_range_breakout"         → "breakout_opening_range"
 *   "opening_range_breakout_strategy" → "breakout_opening_range"
 *
 * Pure function — deterministic, no I/O.
 */
export function canonicalConceptName(name: string): string {
  if (!name) return "";

  // Step 1: lowercase, collapse non-alphanumeric runs to single underscore
  let s = name.toLowerCase().replace(/[^a-z0-9]+/g, "_");

  // Step 2: strip leading/trailing underscores
  s = s.replace(/^_+|_+$/g, "");

  // Step 3: expand abbreviations token-by-token
  //   Each token may expand to multiple tokens (e.g. "orb" → "opening_range_breakout" = 3 tokens)
  const rawTokens = s.split("_");
  const expandedTokens: string[] = [];
  for (const token of rawTokens) {
    const expansion = ABBREVIATION_MAP[token];
    if (expansion !== undefined) {
      // Expansion may itself be multi-token (underscore-joined)
      expandedTokens.push(...expansion.split("_"));
    } else {
      expandedTokens.push(token);
    }
  }

  // Step 4 + 5: strip stopword suffixes/prefixes by rebuilding the slug and stripping
  let rejoined = expandedTokens.join("_");

  for (const suffix of STOPWORD_SUFFIXES) {
    if (rejoined.endsWith(suffix)) {
      rejoined = rejoined.slice(0, rejoined.length - suffix.length);
    }
  }
  for (const prefix of STOPWORD_PREFIXES) {
    if (rejoined.startsWith(prefix)) {
      rejoined = rejoined.slice(prefix.length);
    }
  }

  // Step 6: re-split, FILTER NOISE TOKENS (Pass 21), dedupe, sort alphabetically
  const allTokens = rejoined.split("_").filter(Boolean);
  const denoised = allTokens.filter((t) => NOISE_WHITELIST.has(t) || !NOISE_TOKENS.has(t));
  // Edge case: if filtering left nothing, fall back to original tokens (don't return "")
  const finalTokens = denoised.length > 0 ? denoised : allTokens;
  const deduped = [...new Set(finalTokens)].sort();

  // Step 7: rejoin, cap at 60 chars (trim at last full token boundary ≤60)
  let result = deduped.join("_");
  if (result.length > 60) {
    let trimmed = result.slice(0, 60);
    const lastUnderscore = trimmed.lastIndexOf("_");
    if (lastUnderscore > 0) {
      trimmed = trimmed.slice(0, lastUnderscore);
    }
    result = trimmed;
  }

  return result;
}

/**
 * Compute a 32-hex-char fingerprint from (market, concept_name).
 * concept_name is canonicalized (abbreviations expanded, tokens sorted +
 * deduped) before hashing so synonym variants converge to the same bucket.
 *
 * This is the Pass 20 primary fingerprint — it distinguishes "1-min ORB" from
 * "15-min ORB" on the same market, while collapsing abbreviation variants of
 * the SAME concept (orb / opening_range_breakout / orb_strategy) into one bucket.
 *
 * entry_archetype and exit_type columns remain on the bucket row as informational
 * fields, but they no longer determine the bucket key.
 *
 * Deterministic: same (market, concept_name) → same hash every time.
 *
 * Pass 20 Track M: now uses canonicalConceptName() instead of normalizeConceptName().
 * Hash space changes for any concept_name that contained abbreviations or stop-
 * word suffixes. Existing Pass 18 archetype-based hashes are unaffected. Existing
 * Pass 20 concept-based hashes for plain concept names (e.g. "vwap_pullback") are
 * also unaffected because token-sorted "pullback_vwap" produces a different hash
 * than the old "vwappullback" — buckets for such names will be re-created on next
 * 5R run. Fragmented ORB buckets from before Track M will expire via 90-day sweep.
 *
 * W23F.C: market dropped from fingerprint input — see AGENT-LOGS Wave 23F.
 * Pre-W23F.C buckets do not converge with post-W23F.C buckets; this is intentional,
 * graveyard sweep handles legacy.
 *
 * The `market` parameter is retained in the signature so existing call sites do not
 * break, but it is ignored internally. Strategy rows carry `symbols: string[]` for
 * per-symbol routing downstream; the bucket fingerprint is purely for cross-source
 * concept convergence at scout-time.
 */
export function computeConceptFingerprintHash(input: {
  market: string;
  concept_name: string;
}): string {
  const canonical = canonicalConceptName(input.concept_name);
  // W23F.C: market intentionally excluded — cross-symbol convergence (ES+NQ → same concept bucket).
  const raw = canonical;
  return createHash("sha256").update(raw, "utf8").digest("hex").slice(0, 32);
}

/**
 * Pass 21 (2026-05-16) — VARIANT-AWARE fingerprint for graduation-time dedup.
 *
 * Cross-source bucket fingerprint (Pass 20) keys on (market, concept) only,
 * which means 5-min ORB and 15-min ORB land in the same bucket. That's correct
 * for DISCOVERY (cross-source convergence), but wrong for GRADUATION (those
 * are different edges that should both make it to backtest).
 *
 * The wide fingerprint adds the truly-distinguishing parameters:
 *   - timeframe (5m vs 15m ORB are different edges)
 *   - direction (long-only vs both-sides)
 *   - entry_params signature (9-EMA vs 21-EMA pullback are different edges;
 *     RSI<5 vs RSI<30 are different setups)
 *
 * It does NOT include framework-overlay-enforced fields because those are
 * identical across all graduated strategies:
 *   - stop_loss (always ATR 1.5x + 14pt MES ceiling)
 *   - exit_params (always Style D: 50% off at 1R, Chandelier(14,2), BE+1)
 *   - time_stop (always 15:55 ET hard flat)
 *   - position_size (always profit_tier_pyramid base=4 cap=30 dll=0.67)
 *
 * Two strategies with the same wide fingerprint = textual duplicates of the
 * SAME edge. Two strategies with same concept but different wide fingerprint
 * = real variants of the same family (keep both).
 *
 * Pure function. Deterministic. No I/O.
 */
export function computeWideConceptFingerprintHash(input: {
  market: string;
  concept_name: string;
  timeframe?: string | null;
  direction?: string | null;
  entry_params?: Record<string, unknown> | null;
}): string {
  const canonical = canonicalConceptName(input.concept_name);
  const tf = (input.timeframe ?? "").toString().toLowerCase().trim();
  const dir = (input.direction ?? "long").toString().toLowerCase().trim();

  // Normalize entry_params: sort keys alphabetically, stringify with stable JSON.
  // Round numeric values to 4 decimals so floating-point noise doesn't split fingerprints.
  const params = input.entry_params ?? {};
  const sortedKeys = Object.keys(params).sort();
  const paramPairs: string[] = [];
  for (const k of sortedKeys) {
    const v = (params as Record<string, unknown>)[k];
    let serialized: string;
    if (typeof v === "number") {
      serialized = Number.isFinite(v) ? (Math.round(v * 10000) / 10000).toString() : String(v);
    } else if (v == null) {
      serialized = "null";
    } else if (typeof v === "object") {
      serialized = JSON.stringify(v);
    } else {
      serialized = String(v).toLowerCase();
    }
    paramPairs.push(`${k}=${serialized}`);
  }
  const paramsSig = paramPairs.join(";");

  const raw = `v2|${input.market}|${canonical}|${tf}|${dir}|${paramsSig}`;
  return createHash("sha256").update(raw, "utf8").digest("hex").slice(0, 32);
}

/**
 * W3.2 (2026-06-22) — QUARANTINE fingerprint for failed / placeholder extractions.
 *
 * Problem: when gemma fails to name a strategy, it defaults concept_name to
 * "extracted_strategy". canonicalConceptName("extracted_strategy") strips the
 * "_strategy" stopword suffix leaving "extracted", producing the same SHA-256
 * hash for EVERY failed extraction. This lets unrelated failed extractions
 * accumulate in the same pending_strategy_buckets row as a fake "9-source
 * strongly cross-validated concept" — all with null entry signals.
 *
 * Fix: when concept_name is a placeholder sentinel OR the extraction is
 * quarantined (fails the compilability gate), derive a fingerprint that
 * includes the video_id / source_url so two different failed extractions
 * NEVER collide into one shared bucket.
 *
 * Formula: sha256("quarantine:" + sourceId + "|" + canonicalConceptName)
 *   where sourceId = video_id from YouTube URL, or the full sourceUrl if not YouTube.
 *
 * Real named concepts that pass the compilability gate continue to use
 * computeConceptFingerprintHash() so cross-source convergence is preserved.
 *
 * Pure function — deterministic, no I/O.
 */
export function computeQuarantineFingerprintHash(input: {
  concept_name: string;
  source_url?: string | null;
}): string {
  // Extract YouTube video_id when possible for a compact stable identifier.
  // Falls back to the full URL (normalized to lowercase, trimmed).
  const sourceId = extractVideoId(input.source_url) ?? (input.source_url ?? "unknown").toLowerCase().trim();
  const canonical = canonicalConceptName(input.concept_name);
  const raw = `quarantine:${sourceId}|${canonical}`;
  return createHash("sha256").update(raw, "utf8").digest("hex").slice(0, 32);
}

/**
 * Extract the 11-char YouTube video ID from a URL, or null if not YouTube.
 * Pattern covers: youtu.be/<id>, youtube.com/watch?v=<id>, youtube.com/embed/<id>
 */
export function extractVideoId(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/(?:v=|youtu\.be\/|\/embed\/)([A-Za-z0-9_-]{11})/);
  return m?.[1] ?? null;
}

// ─── Archetype classifier ────────────────────────────────────────────────────

/**
 * Classify the entry archetype from entry_rules prose.
 * Returns one of 7 named archetypes or "unknown".
 * Order matters: more specific patterns are checked before general ones.
 *
 * Matching is case-insensitive and uses word-boundary anchors where possible.
 */
export function extractEntryArchetype(entryRules: string): EntryArchetype {
  const s = entryRules.toLowerCase();

  // Session pattern checked FIRST because "initial balance breakout" is a session
  // concept even though the word "breakout" appears in it.
  if (/(session|opening\s+auction|open\s+drive|initial\s+balance|ib\s+break|london\s+session|new\s+york\s+session|ny\s+session|asian\s+session|overnight|rth\b|globex|pre.?market|post.?market|time.?of.?day|\btod\b|market\s+open\s+at)/.test(s)) {
    return "session_pattern";
  }

  // Breakout — price breaks a level (ORB, range, key level, high/low)
  // "resistance level" + "break" anywhere counts; "orb" and "breakout" are direct hits.
  if (/(breakout|break\s*out|\borb\b|opening\s*range\s*(high|low|break)|breaks?\s+above|breaks?\s+below|break\s+through|level\s*break|key\s*level|new\s+high|new\s+low|resistance.*break|support.*break|break.*resistance)/.test(s)) {
    return "breakout";
  }

  // Mean reversion — price returns to average/VWAP/band
  // VWAP is a mean-reversion anchor — any mention of VWAP with touch/pull/reversal
  // counts. Also covers explicit "mean reversion" label, Bollinger, oversold/overbought.
  if (/(mean\s*reversion|mean[\s_]reverting|revert(?:ing)?|touch.*vwap|vwap.*touch|pull.*vwap|vwap.*pull|vwap.*reversal|overextended|fade\b|oversold|overbought|bollinger|deviation\b|z.?score|regression\s+to\s+mean)/.test(s)) {
    return "mean_reversion";
  }

  // Trend following — follows established directional trend
  if (/(trend\s*follow|trend\s*continuation|ema\s*cross|ma\s*cross|moving\s+average\s+cross|golden\s+cross|death\s+cross|higher\s+high|lower\s+low|uptrend|downtrend|trending\b|adx\s+filter|macd\s+cross)/.test(s)) {
    return "trend_follow";
  }

  // Momentum — rate of change / velocity signal
  if (/(\bmomentum\b|\brsi\b|\broc\b|rate\s+of\s+change|relative\s+strength|stochastic|williams|cci\b|acceleration\b|surge\b|thrust\b|breadth\b)/.test(s)) {
    return "momentum";
  }

  // Volatility expansion — trade expansion of range/ATR
  if (/(volatility\s*expansion|atr\s*expand|range\s*expand|\bsqueeze\b|keltner\s*break|\bvix\b|volatility\s*break|vol\s*spike|implied\s*vol|realized\s*vol|vol\s*regime)/.test(s)) {
    return "volatility_expansion";
  }

  // Event-driven — news, economic releases, earnings
  if (/(event.driven|\bfomc\b|\bcpi\b|\bnfp\b|\bjobs\s+report\b|earnings\s+release|economic\s+release|economic\s+event|data\s+release|\bfed\b\s+announcement|powell|macro\s+event|catalyst\b)/.test(s)) {
    return "event_driven";
  }

  return "unknown";
}

// ─── Exit type normalizer ────────────────────────────────────────────────────

/**
 * Normalize the exit type from exit_rules prose.
 * Returns one of 5 named types or "unknown".
 */
export function normalizeExitType(exitRules: string): ExitType {
  const s = exitRules.toLowerCase();

  // ATR multiple — explicit atr-based take-profit or stop
  if (/\b(atr\s*multiple|atr\s*target|atr_multiple|take\s*profit.*\batr\b|atr.*take\s*profit|\d+\.?\d*[xX]\s*atr|\batr\b.*[xX]\s*\d+\.?\d*|r\s*multiple.*atr|atr.*r\s*multiple)\b/.test(s)) {
    return "atr_multiple";
  }

  // Trailing stop — dynamic stop that follows price
  if (/\b(trail|trailing\s*stop|chandelier|parabolic\s*sar|sar\b|swing\s*low\s*trail|highest\s*high\s*trail|trail.*stop|dynamic\s*stop)\b/.test(s)) {
    return "trailing_stop";
  }

  // Fixed target — explicit point or dollar target
  if (/\b(fixed\s*target|fixed\s*tp|fixed\s*take\s*profit|\btp\d+\b|\d+\s*pt\s*target|\d+\s*point\s*target|dollar\s*target|tick\s*target|flat\s*target|hard\s*target|set\s*target)\b/.test(s)) {
    return "fixed_target";
  }

  // Time exit — time-based close
  if (/\b(time\s*exit|time.?stop|eod\b|end\s*of\s*day|eot\b|15:?55|15:?45|close\s*at|flatten\s*at|session\s*close|market\s*close|time.?based)\b/.test(s)) {
    return "time_exit";
  }

  // Indicator signal — exit on an indicator crossing or signal
  if (/\b(indicator\s*signal|cross\s*back|ema\s*cross.*exit|rsi.*exit|macd.*exit|exit.*cross|signal\s*exit|opposite\s*signal|counter\s*signal|reversal\s*signal|close.*below|close.*above)\b/.test(s)) {
    return "indicator_signal";
  }

  return "unknown";
}
