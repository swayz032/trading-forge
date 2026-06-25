/**
 * INDICATOR PARAM SCANNER + DEFAULTS POLICY (2026-06-24 Layer 3C.1 + 3C.2).
 *
 * The placeability audit's now-dominant gap is PARAMS_REQUIRED: a parametric indicator (MACD,
 * Bollinger, VWAP, moving averages) is named but carries no concrete params → indicator ≠ executable.
 * This recovers EXPLICIT numeric params from the transcript (deterministic, no prompt change), and
 * encodes the operator's defaults policy: NO silent defaults for fidelity — assumed defaults are
 * tagged source=DEFAULT_ASSUMPTION @ confidence 0.25 and must FAIL benchmark fidelity mode (they may
 * be allowed-with-warning in backtest mode). Defaults are not source truth; many traders customize.
 *
 * 4-stage deterministic parser (operator architecture):
 *   1. indicator detection (alias normalization)
 *   2. numeric window extraction (hyphen-tuple / period-form / stddev-form)
 *   3. context binding (LOCALITY — bind only numbers near the indicator token, not blindly)
 *   4. confidence + source
 */

export type ParamSource = "TRANSCRIPT_EXPLICIT" | "DEFAULT_ASSUMPTION" | "NONE";

export interface IndicatorParams {
  indicator: string | null; // canonical key
  params: Record<string, number> | null;
  confidence: number; // 0–1
  source: ParamSource;
}

// ── Stage 1: indicator detection + alias normalization ────────────────────────
const INDICATOR_ALIASES: Array<{ key: string; re: RegExp }> = [
  { key: "macd", re: /\b(macd|moving average convergence(?:[\s/-]*divergence)?)\b/i },
  { key: "bollinger", re: /\b(bollinger(?:\s+bands?)?|b\.?bands?)\b/i },
  { key: "keltner", re: /\bkeltner\b/i },
  { key: "donchian", re: /\bdonchian\b/i },
  { key: "vwap", re: /\b(vwap|volume[\s-]*weighted average price)\b/i },
  { key: "rsi", re: /\b(rsi|relative strength index)\b/i },
  { key: "stochastic", re: /\b(stochastic|stoch)\b/i },
  { key: "atr", re: /\b(atr|average true range)\b/i },
  { key: "supertrend", re: /\bsupertrend\b/i },
  // moving averages last (broadest)
  { key: "ema", re: /\b(ema|exponential moving average)\b/i },
  { key: "sma", re: /\b(sma|simple moving average|moving average|\bma\b)\b/i },
];

/** Detect the canonical indicator from a hint (concept/entry_indicator) or free text.
 *  Normalizes snake_case/slash/hyphen separators to spaces so `\b` boundaries fire on
 *  concept names like "bollinger_band_15m" / "macd_200d_support_entry". */
export function detectIndicator(text: string | null | undefined): string | null {
  if (typeof text !== "string" || text.trim().length === 0) return null;
  const norm = text.replace(/[_/-]+/g, " ");
  for (const { key, re } of INDICATOR_ALIASES) {
    if (re.test(norm)) return key;
  }
  return null;
}

/** Standard (NON-AUTHORITATIVE) defaults — used ONLY under the explicit defaults policy. */
const STANDARD_DEFAULTS: Record<string, Record<string, number>> = {
  macd: { fast: 12, slow: 26, signal: 9 },
  bollinger: { period: 20, stddev: 2 },
  ema: { period: 20 },
  sma: { period: 20 },
  rsi: { period: 14, oversold: 30, overbought: 70 },
  atr: { period: 14 },
  keltner: { period: 20, multiplier: 2 },
  donchian: { period: 20 },
};

// ── Stage 2: numeric window patterns ──────────────────────────────────────────
const TUPLE3_RE = /(\d{1,3})\s*[-/,]\s*(\d{1,3})\s*[-/,]\s*(\d{1,3})/;
const TUPLE2_RE = /(\d{1,3})\s*[-/,]\s*(\d{1,3})/;
const PERIOD_RE = /(?:(\d{1,3})[\s-]*(?:period|periods|day|bar|bars|length|ema|sma|ma)\b)|(?:(?:period|length)[\s:=-]*(\d{1,3}))/i;
const STDDEV_RE = /(\d+(?:\.\d+)?)\s*(?:standard deviations?|std[\s.-]*devs?|sigma|sd\b)/i;

function splitSentences(t: string): string[] {
  return t.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
}

// Per-indicator param-context cues (Stage 3 locality): a sentence with one of these is in the
// indicator's param context even if the canonical alias word is absent.
const PARAM_CONTEXT_CUES: Record<string, RegExp | undefined> = {
  macd: /\b(signal line|histogram|convergence|fast (?:line|length)|slow (?:line|length))\b/i,
  bollinger: /\b(standard deviations?|sigma|std[\s.-]*devs?|\bsd\b|upper band|lower band)\b/i,
  keltner: /\b(standard deviations?|multiplier|atr)\b/i,
  rsi: /\b(overbought|oversold|relative strength)\b/i,
  ema: /\b(moving average|crossover)\b/i,
  sma: /\b(moving average|crossover)\b/i,
  atr: /\b(true range)\b/i,
  donchian: /\b(channel)\b/i,
  stochastic: /\b(%k|%d|stoch)\b/i,
  vwap: undefined,
  supertrend: undefined,
};

// ── Stage 3+4: context-bound extraction per indicator ─────────────────────────
function extractForIndicator(indicator: string, sentence: string): Record<string, number> | null {
  switch (indicator) {
    case "macd": {
      const m = sentence.match(TUPLE3_RE);
      if (m) return { fast: +m[1], slow: +m[2], signal: +m[3] };
      return null;
    }
    case "bollinger":
    case "keltner": {
      const sd = sentence.match(STDDEV_RE);
      const per = sentence.match(PERIOD_RE);
      const period = per ? +(per[1] ?? per[2]) : null;
      const stddev = sd ? +sd[1] : null;
      if (period != null && stddev != null) return { period, stddev };
      if (period != null) return { period }; // partial — period only
      // "20, 2" tuple form ("20 period 2 sd" already handled; bare "Bollinger 20 2")
      const t2 = sentence.match(TUPLE2_RE);
      if (t2) return { period: +t2[1], stddev: +t2[2] };
      return null;
    }
    case "ema":
    case "sma": {
      // CONSERVATIVE (wrong param worse than none): only bind a two-MA pair in unambiguous forms —
      // slash "20/200" or "20 and 200 (MA|EMA|SMA)" with the MA word attached. A loose "15 to 20"
      // (often non-param prose, e.g. "15 to 20 minutes") must NOT bind.
      const slash = sentence.match(/\b(\d{1,3})\s*\/\s*(\d{1,3})\b/);
      if (slash) return { fast: +slash[1], slow: +slash[2] };
      const twoAnd = sentence.match(/\b(\d{1,3})\s*(?:and|&)\s*(\d{1,3})\s*(?:period[\s-]*)?(?:ema|sma|ma|moving average)/i);
      if (twoAnd) return { fast: +twoAnd[1], slow: +twoAnd[2] };
      const per = sentence.match(PERIOD_RE);
      if (per) return { period: +(per[1] ?? per[2]) };
      return null;
    }
    case "rsi": {
      const per = sentence.match(PERIOD_RE);
      const ob = sentence.match(/\b(\d{2})\s*(?:overbought|over bought)|overbought[\s:=-]*(\d{2})/i);
      const os = sentence.match(/\b(\d{2})\s*(?:oversold|over sold)|oversold[\s:=-]*(\d{2})/i);
      const out: Record<string, number> = {};
      if (per) out.period = +(per[1] ?? per[2]);
      if (ob) out.overbought = +(ob[1] ?? ob[2]);
      if (os) out.oversold = +(os[1] ?? os[2]);
      return Object.keys(out).length ? out : null;
    }
    case "atr":
    case "donchian": {
      const per = sentence.match(PERIOD_RE);
      return per ? { period: +(per[1] ?? per[2]) } : null;
    }
    case "vwap":
    default:
      // VWAP is typically session-anchored (no numeric params) — no explicit numbers to bind.
      return null;
  }
}

/**
 * Scan a transcript for EXPLICIT params for the given indicator. Locality-bound: only numbers in a
 * sentence that mentions the indicator are bound (Stage 3 — prevents "wait 5 min, then 20 Bollinger"
 * binding period=5). Pure, deterministic.
 *
 * @param indicatorHint concept_name / entry_indicator to identify the indicator (falls back to
 *   detecting it in the transcript).
 */
export function scanIndicatorParams(
  transcript: string | null | undefined,
  indicatorHint?: string | null,
): IndicatorParams {
  const indicator = detectIndicator(indicatorHint) ?? detectIndicator(transcript ?? "");
  if (!indicator) return { indicator: null, params: null, confidence: 0, source: "NONE" };
  if (typeof transcript !== "string" || transcript.trim().length === 0) {
    return { indicator, params: null, confidence: 0, source: "NONE" };
  }

  const aliasRe = INDICATOR_ALIASES.find((a) => a.key === indicator)!.re;
  // LOCALITY (Stage 3): bind params only in sentences that confirm the indicator's CONTEXT — either
  // the canonical alias OR an indicator-specific param cue. Educators often state params without the
  // canonical word (Fqx says "2 standard deviations"/"bands", never "Bollinger") — the cue is the
  // strong tell. Cues are deliberately specific so a distant unrelated number can't bind.
  const cueRe = PARAM_CONTEXT_CUES[indicator];
  let best: Record<string, number> | null = null;
  for (const sent of splitSentences(transcript)) {
    if (!aliasRe.test(sent) && !(cueRe && cueRe.test(sent))) continue;
    // Stage 3 guard: strip TIMEFRAME-qualified numbers ("15-minute", "5m", "4 hour") so they can't
    // bind as indicator params (the "wait 5 minutes / 20 Bollinger" + "15-minute / 20 MA" traps).
    const deTimed = sent.replace(
      /\b\d+\s*-?\s*(?:m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|wk|week|weeks|sec|second|seconds)\b/gi,
      " ",
    );
    const p = extractForIndicator(indicator, deTimed);
    if (p && (!best || Object.keys(p).length > Object.keys(best).length)) best = p;
  }

  if (best) {
    // Confidence: a full param set (macd 3-tuple, bollinger period+stddev) is near-certain.
    const full =
      (indicator === "macd" && "signal" in best) ||
      ((indicator === "bollinger" || indicator === "keltner") && "stddev" in best) ||
      ((indicator === "ema" || indicator === "sma") && "slow" in best);
    return { indicator, params: best, confidence: full ? 0.95 : 0.8, source: "TRANSCRIPT_EXPLICIT" };
  }
  return { indicator, params: null, confidence: 0, source: "NONE" };
}

// ── 3C.2 — Param defaults policy ──────────────────────────────────────────────

export type ParamMode = "fidelity" | "backtest";

/**
 * Apply standard defaults ONLY as an explicit, low-confidence assumption. Never silent: returns
 * source=DEFAULT_ASSUMPTION @ 0.25. Defaults are not source truth.
 */
export function applyParamDefaults(indicator: string | null): IndicatorParams {
  if (!indicator || !(indicator in STANDARD_DEFAULTS)) {
    return { indicator, params: null, confidence: 0, source: "NONE" };
  }
  return { indicator, params: { ...STANDARD_DEFAULTS[indicator] }, confidence: 0.25, source: "DEFAULT_ASSUMPTION" };
}

/**
 * Does this param result satisfy the trigger for the given mode?
 *   fidelity mode  → ONLY TRANSCRIPT_EXPLICIT params count (a DEFAULT_ASSUMPTION is hallucinated
 *                    executability and FAILS — the benchmark must not credit guessed params).
 *   backtest mode  → TRANSCRIPT_EXPLICIT or DEFAULT_ASSUMPTION (allowed-with-warning) count.
 */
export function paramsSatisfyTrigger(ip: IndicatorParams, mode: ParamMode = "fidelity"): boolean {
  if (!ip.params || Object.keys(ip.params).length === 0) return false;
  if (ip.source === "TRANSCRIPT_EXPLICIT") return true;
  if (ip.source === "DEFAULT_ASSUMPTION") return mode === "backtest";
  return false;
}
