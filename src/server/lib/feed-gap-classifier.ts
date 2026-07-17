/**
 * feed-gap-classifier.ts — Wave M1b (2026-07-17, "$250-1K/day Readiness" campaign)
 *
 * PURPOSE: classify the missing interval whenever the live Massive/Polygon.io
 * WebSocket feed (src/data/fetchers/massive.ts, 1-minute AM aggregate bars only,
 * NO second-aggregate reconciliation) produces a gap larger than the expected
 * 1-minute cadence for a symbol. This is PURE OBSERVABILITY — see the "Never
 * gates" contract below.
 *
 * WHY THIS EXISTS: before this module, `getStreamHealth()` in
 * paper-trading-stream.ts (~line 723) was the only "health" surface and
 * returned just `{connected, symbols}` — zero gap/staleness classification.
 * An operator watching a strategy go quiet had no way to distinguish "market
 * is legitimately closed" from "the feed silently died" from "genuinely zero
 * volume traded this minute" without manually cross-referencing a calendar
 * and the WS connection logs by hand.
 *
 * CLASSIFICATION CONTRACT — exactly one of:
 *   - MARKET_CLOSED       — the ENTIRE gap window falls inside a period CME
 *                            Globex futures are definitely closed (weekend or
 *                            the daily maintenance halt — see the window
 *                            discrepancy note below).
 *   - PROVIDER_GAP        — the WS connection was NOT continuously "connected"
 *                            for the entire gap window, OR the gap exceeds a
 *                            hard fail-safe ceiling even if the connection
 *                            LOOKED continuously connected (a silently-stuck
 *                            socket is a known failure mode — see below).
 *   - EXPECTED_NO_TRADE   — market open, connection continuously connected,
 *                            gap under the fail-safe ceiling. Massive/Polygon
 *                            only emits an AM aggregate when real volume
 *                            traded in that minute; thin/quiet periods (e.g.
 *                            deep overnight Asia-session hours) can genuinely
 *                            have zero-volume minutes.
 *
 * ★ THIS IS A PROBABILISTIC BEST-EFFORT LABEL, NOT A PROOF. There is no
 *   independent third data source confirming zero-volume vs a silent failure
 *   for the EXPECTED_NO_TRADE case — it is the best inference available from
 *   (a) the exchange calendar and (b) the WS connection-state transitions this
 *   process itself observed. Treat it as an operator hint, never as a verified
 *   fact downstream.
 *
 * ── Chosen constants + reasoning ──────────────────────────────────────────
 *
 * GAP_THRESHOLD_MINUTES = 1.5 (90s):
 *   Massive emits one AM aggregate bar per minute. A threshold of exactly 1.0
 *   would false-positive on completely normal per-bar delivery jitter (a bar
 *   for HH:MM can legitimately arrive a few seconds after HH:MM:00 of the
 *   NEXT minute due to aggregation + network latency). 1.5x the expected
 *   cadence gives a 50% jitter allowance before anything is even considered a
 *   "gap" worth classifying — below this, we don't classify at all (the
 *   `classified: false` branch).
 *
 * DAILY_HALT window = 17:00–18:00 ET (NOT 16:00–17:00 ET):
 *   `classifySessionType()` in paper-execution-service.ts (~line 773-780)
 *   labels 16:00–17:00 ET as `"CME_HALT"` — but that is a DIFFERENT concept
 *   used for a slippage-multiplier / new-entry-block purpose around the
 *   16:00 ET settlement print, not "no bars can physically exist here."
 *   The real CME Globex daily maintenance pause — during which NO bars of any
 *   kind are produced — is 17:00–18:00 ET. This is independently corroborated
 *   by THIS FILE'S OWN SIBLING MODULE, paper-trading-stream.ts, which already
 *   documents (and tests, via m2-globex-session-buffer-key.test.ts) that "CME
 *   has no bars in the 17:00–18:00 ET maintenance pause" as the basis for its
 *   Globex-session-boundary buffer-reset logic (toGlobexSessionDateString).
 *   Reusing classifySessionType's 16:00-17:00 window here would have been
 *   silently wrong — it would falsely call 16:00-17:00 ET "market closed" (bars
 *   DO exist then) and would falsely call 17:00-18:00 ET "not market closed"
 *   (bars do NOT exist then). Documenting the discrepancy explicitly here so
 *   a future reader doesn't "fix" this file to match classifySessionType.
 *
 * FAIL_SAFE_CEILING_MINUTES = 15:
 *   A silently-stuck WebSocket (transport-level TCP half-open, or an upstream
 *   bug that stops emitting bars without ever firing a "disconnected" event)
 *   is a known failure mode that the "connected" boolean alone cannot catch.
 *   15 minutes is 10x the cadence-jitter tolerance above and far beyond any
 *   realistic single-minute AM-aggregate delivery delay; during real market
 *   hours even the thinnest overnight Asia-session window on MES/MNQ/MCL
 *   rarely goes a full 15 minutes with zero traded volume. Exceeding this
 *   ceiling is classified PROVIDER_GAP regardless of what the connection
 *   tracker reports.
 *
 * ── KNOWN, EXPLICITLY OUT-OF-SCOPE LIMITATION ─────────────────────────────
 * There is NO CME/Globex HOLIDAY calendar anywhere in this codebase today
 * (confirmed by searching src/server/lib/economic-calendar-loader.ts and
 * elsewhere — it covers economic-EVENT calendars like EIA/FOMC/CPI/NFP, not
 * market-CLOSURE holidays). This means a full-day exchange holiday (e.g.
 * Thanksgiving, Christmas half-day, Good Friday) will currently be
 * misclassified as EXPECTED_NO_TRADE or PROVIDER_GAP rather than
 * MARKET_CLOSED, because this module only knows about the WEEKLY weekend +
 * daily-maintenance closure pattern, not the exchange's annual holiday
 * calendar. Building a real CME holiday calendar is a separate, nontrivial
 * undertaking explicitly OUT OF SCOPE for this wave — do not silently paper
 * over this by guessing holiday dates. This mirrors how the M1a wave
 * explicitly flagged its own unconfirmed WS-URL gap rather than guessing.
 *
 * ── Never gates / blocks / pauses anything ────────────────────────────────
 * This module has ZERO side effects and touches NO gate, no kill switch, no
 * position lifecycle, no signal evaluation. It is called from
 * paper-trading-stream.ts purely to produce an audit row + (for PROVIDER_GAP
 * only) an SSE broadcast for operator visibility. The caller MUST treat any
 * thrown error here as fail-OPEN (catch, warn-audit, continue bar processing
 * unaffected) — see paper-trading-stream.ts's `evaluateFeedGap()` wrapper.
 * Per Topstep's news-event policy ("reduce size, don't block" — see CLAUDE.md
 * §4 macro_alignment discussion), NO feed-classification signal may ever be
 * wired into a blocking gate without a separate, explicit ratification —
 * this module doesn't even expose a boolean an accidental future caller could
 * misuse as a gate input; it only returns a classification label + reason.
 */

// ── Tunable constants (exported for tests + documentation) ────────────────

/** Minimum gap (in minutes) before we classify anything at all. Accounts for
 *  normal per-bar delivery jitter — see docstring above. */
export const GAP_THRESHOLD_MINUTES = 1.5;

/** Daily CME Globex maintenance halt window, in ET minutes-of-day. 17:00 ET. */
export const DAILY_HALT_START_ET_MINUTES = 17 * 60; // 1020

/** Daily CME Globex maintenance halt window end, in ET minutes-of-day. 18:00 ET. */
export const DAILY_HALT_END_ET_MINUTES = 18 * 60; // 1080

/** Hard fail-safe ceiling (minutes) — gap beyond this is ALWAYS PROVIDER_GAP,
 *  even with a nominally continuous "connected" state. See docstring above. */
export const FAIL_SAFE_CEILING_MINUTES = 15;

/** Safety cap on how far the minute-by-minute MARKET_CLOSED scan will walk
 *  forward before giving up. 7 days is far beyond any legitimate weekend gap
 *  (~66h Fri 17:00 ET → Mon first bar); a gap bigger than this cannot be
 *  verified as fully market-closed by this module's weekly-cycle-only model
 *  (see the holiday-calendar limitation above) and conservatively returns
 *  false rather than guessing. */
const MAX_SCAN_MINUTES = 7 * 24 * 60;

// ── Types ──────────────────────────────────────────────────────────────────

export type FeedGapClassification = "MARKET_CLOSED" | "PROVIDER_GAP" | "EXPECTED_NO_TRADE";

export interface FeedGapClassifierInput {
  /** Timestamp of the bar immediately BEFORE the gap. */
  previousBarTimestamp: Date;
  /** Timestamp of the bar that just arrived (end of the gap). */
  currentBarTimestamp: Date;
  /**
   * True iff the caller's per-symbol WS connection-state tracker shows the
   * connection was in "connected" state for the ENTIRE gap window (no
   * "disconnected" / "reconnecting" transition observed since the previous
   * bar was processed). Computed by paper-trading-stream.ts — this module
   * has no knowledge of WebSocket state itself (kept pure/testable).
   */
  continuouslyConnected: boolean;
  /** Override for tests. Defaults to GAP_THRESHOLD_MINUTES. */
  gapThresholdMinutes?: number;
  /** Override for tests. Defaults to FAIL_SAFE_CEILING_MINUTES. */
  failSafeCeilingMinutes?: number;
}

export interface FeedGapClassifierResult {
  /** False when the gap does not exceed the threshold — nothing to classify. */
  classified: boolean;
  /** Gap size in minutes (bar-timestamp basis, not wall-clock). */
  gapMinutes: number;
  /** Null when `classified` is false. */
  classification: FeedGapClassification | null;
  /** Short machine-readable reason code, used in the audit row + SSE payload. */
  reason: string;
}

// ── ET calendar helpers (pure) ──────────────────────────────────────────────

const ET_PARTS_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  hour: "numeric",
  minute: "numeric",
  hour12: false,
});

/**
 * Extract {dayOfWeek (0=Sun..6=Sat), minutesOfDay} for a Date, in America/New_York
 * local time, DST-correct via Intl (mirrors the pattern used in
 * feed-silence-service.ts::isEtRth and paper-trading-stream.ts's etFormatter).
 */
function getEtDayAndMinute(date: Date): { dayOfWeek: number; minutesOfDay: number } {
  const parts = ET_PARTS_FORMATTER.formatToParts(date);
  const weekdayStr = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
  let hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  // Some ICU builds return "24" for midnight hour in hour12:false mode.
  hour = hour % 24;

  const DAY_MAP: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const dayOfWeek = DAY_MAP[weekdayStr] ?? 1;

  return { dayOfWeek, minutesOfDay: hour * 60 + minute };
}

/**
 * True iff CME Globex futures are definitely closed at this instant.
 *
 * Weekly cycle only (see the holiday-calendar limitation in the module
 * docstring — this function has NO knowledge of exchange holidays):
 *   - Saturday: closed all day (part of the weekend).
 *   - Sunday before 18:00 ET: closed (weekend extends until Globex reopens).
 *   - Friday from 17:00 ET onward: closed (the weekend begins — Friday's
 *     daily halt never reopens same-day; next open is Sunday 18:00 ET).
 *   - Monday–Thursday: closed only during the 17:00–18:00 ET daily
 *     maintenance halt.
 */
export function isCmeGlobexClosedAt(date: Date): boolean {
  const { dayOfWeek, minutesOfDay } = getEtDayAndMinute(date);

  if (dayOfWeek === 6) return true; // Saturday
  if (dayOfWeek === 0) return minutesOfDay < DAILY_HALT_END_ET_MINUTES; // Sunday before 18:00 ET
  if (dayOfWeek === 5) return minutesOfDay >= DAILY_HALT_START_ET_MINUTES; // Friday from 17:00 ET

  // Monday-Thursday: only the daily maintenance halt
  return minutesOfDay >= DAILY_HALT_START_ET_MINUTES && minutesOfDay < DAILY_HALT_END_ET_MINUTES;
}

/**
 * True iff EVERY minute STRICTLY BETWEEN `previousBarTimestamp` and
 * `currentBarTimestamp` (both endpoints EXCLUSIVE) falls inside a period CME
 * Globex is closed (per isCmeGlobexClosedAt's weekly-cycle-only model).
 *
 * Endpoints are deliberately excluded: `previousBarTimestamp` is the last bar
 * that DID arrive and `currentBarTimestamp` is the new bar that DID just
 * arrive — both are inherently instants when the market was open (or at
 * least trading), by construction of "a bar exists there." Only the
 * INTERVENING missing minutes are what need to be verified as closed. This
 * matters at the exact reopen boundary: if `currentBarTimestamp` lands a few
 * minutes into a reopened session, those few minutes are genuinely open (even
 * though no bar covers them) and must NOT be silently absorbed into a
 * MARKET_CLOSED verdict — the RED-proof test "a gap that spans the reopen
 * with genuine open time in between" locks this.
 *
 * Implementation: minute-resolution scan. Transitions only ever occur on the
 * hour (17:00 / 18:00 ET boundaries), so a 1-minute step cannot skip past a
 * transition; this is deliberately simple/obviously-correct over a cleverer
 * analytic short-circuit, since this path runs rarely (only when an actual
 * gap is detected, never per-bar in the steady state) and even a multi-day
 * weekend gap is at most ~4000 iterations of trivial arithmetic.
 *
 * Capped at MAX_SCAN_MINUTES — see that constant's docstring.
 */
export function isEntireGapWindowMarketClosed(previousBarTimestamp: Date, currentBarTimestamp: Date): boolean {
  const startMs = previousBarTimestamp.getTime();
  const endMs = currentBarTimestamp.getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return false;

  const gapMinutes = (endMs - startMs) / 60_000;
  if (gapMinutes > MAX_SCAN_MINUTES) return false; // cannot verify — conservative false

  for (let sampleMs = startMs + 60_000; sampleMs < endMs; sampleMs += 60_000) {
    if (!isCmeGlobexClosedAt(new Date(sampleMs))) return false;
  }
  return true;
}

// ── Core pure evaluator ─────────────────────────────────────────────────────

/**
 * Classify a detected feed gap. Pure function — no DB, no Date.now(), no I/O.
 * Caller (paper-trading-stream.ts) computes `continuouslyConnected` from its
 * own per-symbol WS connection-state tracker and supplies bar timestamps.
 *
 * Contract:
 *   - gapMinutes <= gapThresholdMinutes → `classified: false` (not a gap worth
 *     classifying — ordinary per-bar jitter).
 *   - entire window market-closed → MARKET_CLOSED (checked FIRST — a market
 *     closure classification is more informative than PROVIDER_GAP even if
 *     the connection also happened to drop during the closed window; there
 *     would have been no bars regardless of connection state).
 *   - not continuously connected → PROVIDER_GAP.
 *   - gap exceeds the fail-safe ceiling (even if nominally connected) →
 *     PROVIDER_GAP.
 *   - otherwise → EXPECTED_NO_TRADE (best-effort inference — see module
 *     docstring's probabilistic-label caveat).
 */
export function classifyFeedGap(input: FeedGapClassifierInput): FeedGapClassifierResult {
  const gapThresholdMinutes = input.gapThresholdMinutes ?? GAP_THRESHOLD_MINUTES;
  const failSafeCeilingMinutes = input.failSafeCeilingMinutes ?? FAIL_SAFE_CEILING_MINUTES;

  const gapMs = input.currentBarTimestamp.getTime() - input.previousBarTimestamp.getTime();
  const gapMinutes = gapMs / 60_000;

  if (!Number.isFinite(gapMinutes) || gapMinutes <= gapThresholdMinutes) {
    return { classified: false, gapMinutes, classification: null, reason: "within_expected_cadence" };
  }

  if (isEntireGapWindowMarketClosed(input.previousBarTimestamp, input.currentBarTimestamp)) {
    return {
      classified: true,
      gapMinutes,
      classification: "MARKET_CLOSED",
      reason: "entire_gap_window_cme_globex_closed",
    };
  }

  if (!input.continuouslyConnected) {
    return {
      classified: true,
      gapMinutes,
      classification: "PROVIDER_GAP",
      reason: "ws_connection_not_continuous_during_gap",
    };
  }

  if (gapMinutes > failSafeCeilingMinutes) {
    return {
      classified: true,
      gapMinutes,
      classification: "PROVIDER_GAP",
      reason: `gap_exceeded_fail_safe_ceiling_${failSafeCeilingMinutes}m_despite_connected_state`,
    };
  }

  return {
    classified: true,
    gapMinutes,
    classification: "EXPECTED_NO_TRADE",
    reason: "market_open_connected_zero_volume_inference",
  };
}
