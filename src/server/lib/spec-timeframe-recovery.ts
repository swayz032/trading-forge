/**
 * spec-timeframe-recovery.ts — Timeframe Integrity Fix (2026-07-03)
 *
 * PURE recovery of an educator's EXECUTION timeframe (the lower/trigger TF that
 * entries fire on) + the higher/context TF from a compiled `*.spec.json`
 * artifact. The certified compiler drops the structured `higher_timeframe` /
 * `lower_timeframe` fields the transcript extractor captured, so the only
 * surviving signal is the prose inside `spec.entry_conditions[].object`.
 *
 * THE ONE INVIOLABLE PRINCIPLE — NEVER silently default a timeframe to "5m".
 * When no timeframe token can be recovered the result is `recovered:false`
 * (exec_timeframe=null) so the caller QUARANTINES the strategy with a loud
 * audit. A guessed "5m" is the exact bug this module exists to kill.
 *
 * Pure — no DB, no I/O, no Date.now(). Leaf import of logger per repo convention.
 */
import { logger } from "./logger.js";

export interface SpecTimeframeRecovery {
  /** The educator's execution (lower/trigger) timeframe, e.g. "5m" — null when unrecoverable. */
  exec_timeframe: string | null;
  /** The higher/context timeframe, e.g. "4h" — null when single-TF or unrecoverable. */
  higher_timeframe: string | null;
  /** 0..1 confidence in the recovered exec timeframe. 0 when nothing recovered. */
  confidence: number;
  /** true only when an exec timeframe was recovered from real evidence (never a 5m default). */
  recovered: boolean;
  /** Human-readable trail of what tokens were found and where. */
  evidence: string;
}

interface SpecCondition {
  id?: unknown;
  type?: unknown;
  object?: unknown;
  role?: unknown;
}

// The ONLY engine-backtestable timeframes (data_loader.py:683 _TIMEFRAME_S3;
// direct-bucket-graduator.ts:1088 `^(1m|5m|15m|30m|1h|4h|1d)$`). A recovered
// exec TF OUTSIDE this set is NOT assigned and NOT snapped to a neighbor — the
// strategy is QUARANTINED (honest: the educator used a non-standard,
// unbacktestable TF such as 2m/6m/10m/45m/50m/2h/1w/1M). Hardening 2026-07-03.
const SUPPORTED_MINUTES = new Set<number>([1, 5, 15, 30, 60, 240, 1440]);
const SUPPORTED_TO_TOKEN: Record<number, string> = {
  1: "1m", 5: "5m", 15: "15m", 30: "30m", 60: "1h", 240: "4h", 1440: "1d",
};

/** Render ANY minute value for evidence strings (supported or not). */
function minutesToToken(min: number): string {
  if (SUPPORTED_TO_TOKEN[min]) return SUPPORTED_TO_TOKEN[min];
  if (min < 60) return `${min}m`;
  if (min < 1440 && min % 60 === 0) return `${min / 60}h`;
  if (min % 43200 === 0) return `${min / 43200}M`;
  if (min % 10080 === 0) return `${min / 10080}w`;
  if (min % 1440 === 0) return `${min / 1440}d`;
  return `${min}m`;
}

// A chart-context word must be present before a BARE word-form period
// (daily/weekly/monthly/hourly) is treated as a chart timeframe. Without it,
// "daily vwap" / "weekly high" / "daily buy signal" are reference ANCHORS, not
// the execution chart — treating them as the timeframe is the exact silent-guess
// this module refuses to make.
const CHART_CONTEXT_RE = /(time\s*frames?|timeframes?|chart|candles?|\bbars?\b)/;

// Spelled-out number words → digits (F-3). Educators say "five minute" and
// transcript normalization concatenates to "fiveminute" — both were invisible
// to a digit-only parser, which then silently promoted a higher-TF or a stop
// level to exec at the same confidence.
const WORD_NUM: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};
const SPELLED_ALT = Object.keys(WORD_NUM).join("|");

/**
 * Extract RAW chart-timeframe values (in minutes) from a single condition's
 * prose — INCLUDING unsupported ones (6m/10m/50m/1w/…). The supported-set
 * constraint is applied later in recoverSpecTimeframe so that an unsupported
 * EXEC token quarantines the strategy instead of silently promoting a supported
 * higher-TF to exec.
 *
 * Recognizes: digit+unit ("5m", "15 minute", "4 hour", "1d"); spelled-out and
 * concatenated forms ("five minute", "fiveminute", "one day"); letter-first
 * ICT/chart shorthand ("m1", "m5", "m15", "m30", "h1", "h4", "d1"); and
 * chart-context-gated word periods ("daily chart", "hourly candle").
 *
 * Number-vs-timeframe guard (F-1/F-2): a bare number with no time unit is
 * structurally excluded (the regex requires a real unit). Additionally,
 * indicator-period / lookback-level signatures are stripped BEFORE extraction so
 * "200 ma daily time frame" (MA plotted on daily) and "20 day high" (a lookback
 * level) are NOT emitted as chart timeframes.
 */
export function extractTimeframeMinutes(objectText: string): number[] {
  if (typeof objectText !== "string" || objectText.length === 0) return [];
  let text = objectText.toLowerCase();

  // ── F-1/F-2: strip indicator-period / lookback-level signatures so they are
  // never mistaken for a chart timeframe. Order matters: the "ma daily" form
  // (day-word qualifies the indicator, not the chart) is removed before the
  // bare "ma" form.
  text = text
    // F-2: clock time "9 30 m eastern" = 9:30 a.m. (ASR dropped the "a."); the
    // "30 m" is a wall-clock minute, NOT a 30-minute chart. "HH MM m" → strip.
    .replace(/\b\d{1,2}\s+\d{2}\s+m\b/g, " ")
    .replace(/\b\d{1,3}\s*(?:ema|sma|ma|moving\s+average)\s+(?:daily|hourly|weekly|monthly)\b/g, " ")
    .replace(/\b\d{1,3}\s*(?:ema|sma|ma|moving\s+average)\b/g, " ")
    .replace(/\b\d{1,3}\s*(?:days?|d|hours?|h|weeks?|w)\s+(?:high|low|ma|ema|sma|average|moving\s+average|range|breakout|lookback)\b/g, " ");

  // ── F-3: normalize spelled-out + concatenated number-words to digits
  // ("five minute"/"fiveminute"/"five-minute" → "5 minute"; "one day" → "1 day").
  text = text.replace(
    new RegExp(`\\b(${SPELLED_ALT})\\s*-?\\s*(minutes?|mins?|hours?|hrs?|days?)\\b`, "g"),
    (_match, w: string, unit: string) => `${WORD_NUM[w]} ${unit}`,
  );

  const found = new Set<number>();

  // Digit + unit (also covers the normalized spelled forms above).
  // F-2b: "hourly" is an hour unit so "4 hourly candle" → 4×60 (240), not a flat 1h.
  const re = /\b(\d{1,3})\s*-?\s*(minutes?|mins?|m|hours?|hrs?|hourly|h|days?|d)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const n = parseInt(m[1], 10);
    if (!Number.isFinite(n) || n <= 0) continue;
    const u = m[2][0]; // m | h | d
    if (u === "m") found.add(n);
    else if (u === "h") found.add(n * 60);
    else if (u === "d") found.add(n * 1440);
  }

  // ── F-3: letter-first ICT/chart shorthand — "m1", "m5", "m15", "m30", "h1",
  // "h4", "d1" (case-insensitive already via lowercase, word-boundaried).
  const reShort = /\b(m|h|d)(\d{1,3})\b/g;
  let ms: RegExpExecArray | null;
  while ((ms = reShort.exec(text)) !== null) {
    const n = parseInt(ms[2], 10);
    if (!Number.isFinite(n) || n <= 0) continue;
    const u = ms[1];
    if (u === "m") found.add(n);
    else if (u === "h") found.add(n * 60);
    else found.add(n * 1440);
  }

  // Bare word-form periods — chart-context-gated to avoid VWAP/anchor false
  // positives. weekly/monthly are emitted raw (so exec detection sees them and
  // QUARANTINES) but will never be assigned — they are not in the supported set.
  // F-2b: a BARE "hourly" (no preceding number) is 1h; "N hourly" is handled above.
  if (CHART_CONTEXT_RE.test(text)) {
    if (/\bhourly\b/.test(text) && !/\d\s*-?\s*hourly/.test(text)) found.add(60);
    if (/\bdaily\b/.test(text)) found.add(1440);
    if (/\bweekly\b/.test(text)) found.add(10080);
    if (/\bmonthly\b/.test(text)) found.add(43200);
  }

  return [...found];
}

function isTriggerCondition(c: SpecCondition, entryTriggerId: string): boolean {
  if (typeof c.id === "string" && c.id === entryTriggerId) return true;
  if (typeof c.role === "string" && c.role === "trigger") return true;
  if (typeof c.type === "string" && c.type.toUpperCase() === "ENABLE_ENTRY") return true;
  return false;
}

function normType(c: SpecCondition): string {
  return typeof c.type === "string" ? c.type.toUpperCase() : "";
}

// EXEC-vs-BIAS by CONDITION TYPE, not role (F-1, 2026-07-03). The compiler's
// role="spine" means "narrative backbone", NOT "execution layer" — a
// WAIT_BIAS:daily step is frequently tagged spine, so a role-based floor
// promoted a DAILY bias frame to exec while the real intraday exec (tagged
// role=confluence) was excluded. Classification must therefore be by type:
//   - WAIT_BIAS                → BIAS (context) always.
//   - WAIT_SESSION             → EXECUTION when intraday (<1d), BIAS when daily+.
//   - everything else          → EXECUTION-grade (WAIT_STRUCTURE, WAIT_CONFIRMATION,
//                                ENABLE_ENTRY/ENTER, FILTER, WAIT_RETEST/RETEST, INVALIDATE).
function isExecutionGradeToken(c: SpecCondition, tfMinutes: number): boolean {
  // F-2a: a daily/weekly/monthly (≥1d) TF is NEVER the execution chart — even a
  // WAIT_STRUCTURE / FILTER "major structure level daily chart" is CONTEXT the
  // entry references, not the chart entries fire on. ≥1d only populates higher_tf.
  if (tfMinutes >= 1440) return false;
  const t = normType(c);
  if (t === "WAIT_BIAS") return false;
  if (t === "WAIT_SESSION") return true; // intraday (tfMinutes < 1440 guaranteed here)
  return true; // WAIT_STRUCTURE/WAIT_CONFIRMATION/ENABLE_ENTRY/ENTER/FILTER/WAIT_RETEST/INVALIDATE
}

const TF_KEYWORD_RE = /(time\s*frame|timeframe)/;

// Higher/context-frame eligible: ANY daily+ TF (regardless of condition type —
// F-2a), an explicit WAIT_BIAS condition, or an intraday WAIT_SESSION that
// literally names a "time frame" (e.g. "4 hour time frame"). Execution-structure
// tokens ("first 30 minutes high", a 30m ORB) are excluded so they never surface
// as a spurious higher-TF.
function isHigherContextToken(c: SpecCondition, tfMinutes: number): boolean {
  if (tfMinutes >= 1440) return true;
  const t = normType(c);
  if (t === "WAIT_BIAS") return true;
  if (t === "WAIT_SESSION") {
    const obj = typeof c.object === "string" ? c.object.toLowerCase() : "";
    return TF_KEYWORD_RE.test(obj);
  }
  return false;
}

const EMPTY: SpecTimeframeRecovery = {
  exec_timeframe: null,
  higher_timeframe: null,
  confidence: 0,
  recovered: false,
  evidence: "no timeframe token found in spec prose",
};

/**
 * Recover exec + higher timeframe from a compiled spec artifact. PURE.
 * Accepts the full artifact ({ spec: { entry_conditions, entry_trigger_id } })
 * or a bare spec body. Never throws, never returns a silent "5m".
 */
export function recoverSpecTimeframe(specArtifact: unknown): SpecTimeframeRecovery {
  const root =
    specArtifact && typeof specArtifact === "object" ? (specArtifact as Record<string, unknown>) : null;
  if (!root) return { ...EMPTY, evidence: "artifact not an object" };

  // Unwrap: artifact.spec is the body; but a bare body may be passed directly.
  const body = (root.spec && typeof root.spec === "object" ? root.spec : root) as Record<string, unknown>;
  const conditions = Array.isArray(body.entry_conditions) ? (body.entry_conditions as SpecCondition[]) : [];
  const entryTriggerId = typeof body.entry_trigger_id === "string" ? body.entry_trigger_id : "";

  if (conditions.length === 0) {
    return { ...EMPTY, evidence: "spec has no entry_conditions" };
  }

  // Classify EVERY (condition, token) by TYPE, not role (F-1). exec-grade tokens
  // are candidates for the execution chart; bias/daily-session tokens are context.
  const execTfs = new Set<number>();         // execution-grade tokens (any role)
  const higherCtxTfs = new Set<number>();    // bias / higher-context frame tokens
  const allTfs = new Set<number>();
  // Provenance buckets (exec-grade only) — used for confidence tiering.
  const execExactTrigger = new Set<number>();
  const execTrigger = new Set<number>();
  const execSpine = new Set<number>();
  const evidenceParts: string[] = [];

  for (const c of conditions) {
    const objText = typeof c.object === "string" ? c.object : "";
    const tfs = extractTimeframeMinutes(objText);
    if (tfs.length === 0) continue;
    for (const t of tfs) {
      allTfs.add(t);
      if (isExecutionGradeToken(c, t)) {
        execTfs.add(t);
        if (typeof c.id === "string" && c.id === entryTriggerId) execExactTrigger.add(t);
        if (isTriggerCondition(c, entryTriggerId)) execTrigger.add(t);
        if (typeof c.role === "string" && c.role === "spine") execSpine.add(t);
      }
      if (isHigherContextToken(c, t)) higherCtxTfs.add(t);
    }
  }

  if (allTfs.size === 0) {
    logger.debug({ entryTriggerId }, "spec_timeframe_recovery.unrecoverable_no_tokens");
    return { ...EMPTY };
  }

  const allSorted = [...allTfs].sort((a, b) => a - b);

  // F-1: if EVERY stated TF is bias / daily-session context (no execution-grade
  // token), there is no execution chart — pure top-down analysis. QUARANTINE
  // (this is the price_break case: only monthly/daily WAIT_SESSION bias frames).
  if (execTfs.size === 0) {
    logger.debug({ allTfs: [...allTfs] }, "spec_timeframe_recovery.bias_only_quarantine");
    return {
      exec_timeframe: null,
      higher_timeframe: null,
      confidence: 0,
      recovered: false,
      evidence:
        `all stated TFs are pure higher-timeframe/analysis context ` +
        `(WAIT_BIAS / daily-session only, no execution-grade condition) — quarantined, not guessed. ` +
        `all stated TFs [${allSorted.map(minutesToToken).join(", ")}]`,
    };
  }

  // Exec selection by PROVENANCE TIER (F-1). A strong-provenance trigger TF must
  // NOT be undercut by a numerically-smaller weak-provenance token — e.g. a spine
  // "1 minute" (a passing comparison to a different strategy) beating a role=trigger
  // "5 minute entry filter". Tier order: exact-entry-trigger > trigger-role >
  // (spine + confluence pooled). Only fall to a lower tier when the higher tier has
  // NO execution-grade TF. When trigger and spine disagree, the trigger tier wins.
  //
  // Spine is POOLED with confluence at the bottom (NOT elevated above it): the
  // compiler's "spine" is a narrative backbone, and the true entry TF is frequently
  // a confluence WAIT_CONFIRMATION ("break the 15 minute range") while spine holds
  // structural context (a 30m ORB). Within the bottom tier the lowest execution-
  // grade TF across ALL roles is the entry chart. The RAW-space Math.min pin is
  // preserved inside each tier so an unsupported true-lowest exec still quarantines.
  let execCandidate: number;
  let confidence: number;
  if (execExactTrigger.size > 0) {
    execCandidate = Math.min(...execExactTrigger);
    confidence = 0.9;
    evidenceParts.push(`exec from entry-trigger prose → ${minutesToToken(execCandidate)}`);
  } else if (execTrigger.size > 0) {
    execCandidate = Math.min(...execTrigger);
    confidence = 0.8;
    evidenceParts.push(`exec from trigger condition → ${minutesToToken(execCandidate)}`);
  } else {
    execCandidate = Math.min(...execTfs);
    confidence = execSpine.has(execCandidate) ? (execTfs.size >= 2 ? 0.6 : 0.5) : 0.4;
    evidenceParts.push(`exec = lowest execution-grade TF across roles → ${minutesToToken(execCandidate)}`);
  }

  // FAIL-LOUD: the educator's exec TF is not engine-backtestable → QUARANTINE.
  // Never snap to a nearby supported TF; never promote a supported context TF.
  if (!SUPPORTED_MINUTES.has(execCandidate)) {
    logger.debug({ execCandidate }, "spec_timeframe_recovery.exec_unsupported_quarantine");
    return {
      exec_timeframe: null,
      higher_timeframe: null,
      confidence: 0,
      recovered: false,
      evidence:
        `exec timeframe ${minutesToToken(execCandidate)} is NOT engine-backtestable ` +
        `(supported: 1m/5m/15m/30m/1h/4h/1d) — quarantined, not snapped. ` +
        `all stated TFs [${allSorted.map(minutesToToken).join(", ")}]`,
    };
  }

  // Higher timeframe = highest SUPPORTED higher-context frame strictly greater
  // than exec (WAIT_BIAS / daily-session / "N hour time frame"). Execution-
  // structure tokens (an ORB "first 30 minutes high") are NOT eligible, so they
  // never surface as a spurious higher-TF. Unsupported higher (1w/1M) → dropped.
  const higherCandidates = [...higherCtxTfs].filter((t) => t > execCandidate && SUPPORTED_MINUTES.has(t));
  const higherMinutes = higherCandidates.length > 0 ? Math.max(...higherCandidates) : null;
  if (higherMinutes != null) {
    evidenceParts.push(`higher/context → ${minutesToToken(higherMinutes)}`);
  } else {
    evidenceParts.push("no supported higher context frame");
  }

  return {
    exec_timeframe: minutesToToken(execCandidate),
    higher_timeframe: higherMinutes != null ? minutesToToken(higherMinutes) : null,
    confidence,
    recovered: true,
    evidence: `all stated TFs [${allSorted.map(minutesToToken).join(", ")}]; ${evidenceParts.join("; ")}`,
  };
}
