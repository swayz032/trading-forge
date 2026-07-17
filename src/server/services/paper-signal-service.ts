import { randomUUID } from "crypto";
import { db } from "../db/index.js";
import { paperSessions, paperPositions, paperTrades, strategies, paperSignalLogs, skipDecisions, shadowSignals, preMarketSessions, brokerAccounts, lifecycleShadowSignals, accountStrategyAssignments } from "../db/schema.js";
import { openPosition, closePosition, forceCloseAllPositions } from "./paper-execution-service.js";
import { checkRiskGate } from "./paper-risk-gate.js";
import { evaluateContextGate } from "./context-gate-service.js";
import { checkAntiSetupGate, type AntiSetupGateResult } from "./anti-setup-gate-service.js";
import { broadcastSSE } from "../routes/sse.js";
import { logger } from "../lib/logger.js";
import { toPythonWeekday } from "../lib/python-weekday.js";
import { eq, and, isNull, ne, gte, lte, desc, sql } from "drizzle-orm";
import { tracer } from "../lib/tracing.js";
import { isDSLStrategy, translateDSLToPaperConfig } from "./dsl-translator.js";
import { getActiveLockout } from "./strategy-lockout-service.js";
import { checkCorrelatedPositionGuard, KILL_REASON_CORRELATED_POSITION_OPEN } from "./correlated-position-guard.js";
import { isActive as isPipelineActive } from "./pipeline-control-service.js";
import { isUsDst } from "../lib/dst-utils.js";
import { resolveCrossAssetContext } from "../lib/cross-asset-context.js";
import { styleCTp1RiskPoints } from "../lib/style-c-tp1-risk.js";
import { resolveEffectiveRouting } from "../lib/rl-family-routing-guard.js";
import {
  CONTRACT_SPECS,
  CONTRACT_CAP_MIN,
  CONTRACT_CAP_MAX,
  getFirmLimit,
  getMacroBlackoutMode,
  LIQUIDITY_COMFORT_CAPS,
  LIQUIDITY_COMFORT_CAP_DEFAULT,
  TOPSTEP_TRAILING_DD_BY_SIZE,
} from "../../shared/firm-config.js";
// Wave 23.C: bias engine + A+ gate consumer wiring
import { getOrComputeBiasStateForDay, barTimestampToTradingDay, type BiasStateForSignal } from "./bias-state-service.js";
// Trade-critique data bridge (2026-07-05): entry-time decision context carried
// through pendingEntryQueue to openPosition() -> paper_positions.exit_plan JSONB.
import type { EntryDecisionContext, ExitPlanConfig } from "../db/jsonb-shapes.js";
import { getSessionShapeScore } from "./volume-profile-service.js";
// Wave 23H.D: per-strategy confirming_indicators evaluator
import { evaluateConfirmingIndicators } from "./confirming-indicator-evaluator.js";
// Deep-scan #22 Z6: Path-C/A/B dispatch decision — pure, importable leaf (was inline)
import { resolveConfluenceDispatch } from "../lib/confluence-path-resolver.js";
// W23H.4: confluence-weighted sizing — replaces legacy dynamic_atr block
import { computeRiskDerivedContracts, type RiskSizingInputs } from "../lib/risk-sizing.js";
import { deriveEvidenceBackedConfluenceCount, type FactorSource } from "../lib/confluence-provenance.js";
// W23H.4: audit row writer for sizing.confluence_multiplier_applied
import { insertAuditRow } from "../lib/audit-log-helper.js";
// W3A ratify-packet (2026-07-17) item 3: fallback-visibility for the 6
// risk_derived_pyramid sizing fields that silently fall back to hardcoded
// defaults when a strategy config bypasses framework-overlay.ts.
import { detectPositionSizeFallbacks, POSITION_SIZE_FALLBACK_DEFAULTS } from "../lib/position-size-fallback.js";
// W23H.3: per-strategy allowed_entry_windows time gates
import { parseEntryWindows, isBarInAnyWindow } from "../lib/entry-windows.js";
import { evaluateDailyTradeCap, getDailyTradeCapEnvDefault } from "../lib/daily-trade-cap.js";
import { evaluateLunchBlackoutGate, getLunchBlackoutStartEnvDefault, getLunchBlackoutEndEnvDefault } from "../lib/lunch-blackout-gate.js";
// FIX A (2026-06-22): Wire consistency gate into the entry-gate sequence.
// shouldBlockNewEntry is now called AFTER DLL gate + BEFORE position sizing.
// CONSISTENCY_RULE_FIRMS used to guard the gate to covered firms only.
// Fail-OPEN: payout-eligibility gate (not a loss gate) — consistent with daily-trade-cap precedent.
import { shouldBlockNewEntry as consistencyGateShouldBlock, CONSISTENCY_RULE_FIRMS } from "./consistency-tracker-service.js";
import { resolveConsistencyEnforced } from "../lib/consistency-lane.js";
// FIX B (2026-06-22): In-process Tier-1 event window checker for calendar fallback.
// When the Python calendar_filter subprocess fails, CALENDAR_SAFE_DEFAULT had
// is_economic_event:false — silently opening FOMC/CPI/NFP windows. The in-process
// checker runs without Python and fails CLOSED for known Tier-1 event windows.
export { checkInProcessTier1EventWindow } from "../lib/tier1-event-blackout.js";
import { checkInProcessTier1EventWindow as _checkInProcessTier1EventWindow } from "../lib/tier1-event-blackout.js";
import { computePmSizeFactor } from "../lib/pm-size-factor.js";
// Phase 2 (2026-06-22) — firm-aware Tier-1 news behavior: Topstep (PRIMARY) reduces
// size in the window (caution); MFFU Rapid (restricted) hard-blocks. Product-scoped.
import { resolveNewsAction } from "../lib/news-policy.js";
// Phase 3 (2026-06-23) — authoritative T1 calendar from economic_release_dates (FRED/Fed/EIA
// synced), replacing the hardcoded/projected Python list. Covers FOMC/FOMC_MINUTES/CPI/NFP +
// EIA, product-scoped, hardcoded fail-safe fallback.
import { getT1ReleaseWindow } from "../lib/economic-calendar-loader.js";
// FIX 6 (Track M): in-process CME full-closure date fallback for the outer calendar catch.
// When getCachedSignalCalendarStatus + getT1ReleaseWindow both throw, the Python subprocess
// is unavailable. The Tier-1 event checker (FIX B) handles economic events; this module
// handles holiday detection so CME-closure days are blocked even during outages.
import { checkCmeHolidayFallback } from "../lib/cme-holidays.js";
// M2 (2026-07-17): durability backstop for pendingEntryQueue — persists deferred
// entries so a restart between signal (bar N) and fill (bar N+1) re-hydrates
// instead of silently dropping the trade. See pending-entry-persistence.ts.
import {
  persistPendingEntry,
  deletePendingEntryRow,
  deleteAllPendingEntriesForSession,
  rehydratePendingEntriesForSession,
  type PersistablePendingEntry,
} from "../lib/pending-entry-persistence.js";
// Topstep Prohibited Conduct (2026-06-23): cross-account hedging (opposite positions across
// the operator's multiple accounts) + holding within 2% of a product's price-lock limit.
import { checkCrossAccountHedge, checkIntraAccountHedge, symbolToUnderlying } from "../lib/cross-account-hedge-gate.js";
import { checkPriceLockLimit } from "../lib/price-lock-limit-gate.js";
// W23H.F: cross-symbol DLL coordinator + pre-market blackout consumption
import {
  getAccountSessionCumulativePnL,
  evaluateCrossSymbolDll,
  // HIGH C-1 fix (deep-scan #16 wave-1 track-3): per-account scoping + per-account DLL base.
  // DEFAULT_PERSONAL_DLL_DOLLARS is no longer imported directly here — both DLL call
  // sites now resolve a per-account personal DLL via resolvePersonalDllDollars(), which
  // falls back to that same constant internally for non-Topstep firms.
  resolveAccountKey,
  resolvePersonalDllDollars,
} from "./cross-symbol-pnl.js";
import { toFuturesTradingDayString } from "./paper-risk-gate.js";
// Wave 25 W25.1: weighted confluence scoring (Path C)
import { evaluateWeightedConfluence, type ScoringStrategy, type SignalContext as WeightedSignalContext } from "./confluence-score.js";
import { getDecayTelemetryThreshold } from "../lib/confluence-decay.js";
// Wave 25 W25.6 (Pass 3 P3.A5 architect close-out): liquidity-map injection so
// the liquidity_target_clear factor lights up in production. Fail-soft on any
// error — null result → factor falls back to "liquidity_map_unavailable".
import { getNearestLiquidity } from "./liquidity-map-service.js";
import { notifyCritical } from "./notification-service.js";
import { appendFamilyGradePostscript } from "../lib/notification-helpers.js";
import { shadowSignalsTotal, auditWriteFailuresTotal, dllHaltTotal } from "../lib/metrics-registry.js";
// Wave 26 Group B Task 3: SMT live bridge — wires Python compute_smt_divergence()
// into Path C SignalContext. Fail-soft: returns null snapshot on any error →
// evalSmtConfirmation returns reason="smt_unavailable" (same fail-open as before).
import { getSmtLiveSnapshot } from "./smt-live-service.js";
// H3 (2026-06-23): kill switch needed at pending-entry fill site (bar N+1)
import { killSwitch } from "../production/kill-switch.js";
// M2 (2026-06-23): divergence_vs_backtest inline writer — updates the shadow signal row
// immediately after INSERT so the SHADOW→PAPER gate has a fresh value.
import { writeShadowDivergence } from "../lib/shadow-divergence-writer.js";
// M3 (2026-07-17) PAPER Authority Flip — shared broker-authoritative-states
// source. See paper-authority-states.ts for the full rationale.
import { BROKER_AUTHORITATIVE_STATES } from "../lib/paper-authority-states.js";
const FAIL_CLOSED_EXECUTION = process.env.TF_FAIL_CLOSED_EXECUTION !== "0";

// ─── Wave 23.C: A+ gate constants ────────────────────────────────────────────
// Score threshold for the vp_shape confluence factor.
// Score formula (from volume-profile-service.ts):
//   score = Math.round(shapeConfidence × (|shape_weight| / 10) × 100)
//   weights: D=0, b=5, P=5, Thin=10
// Thin@100%=100, b/P@100%=50 (meets threshold exactly), D=always 0 (never satisfies).
const VP_SHAPE_SCORE_THRESHOLD = 50;

// ─── Pass 5 Track C F-1: Firm Contract Cap from canonical single source ─────
// Was: hardcoded 15 across all firms — paper systematically undersized for
// healthy accounts that exceeded the stale cap.
// Now: reads getFirmLimit().maxContracts from firm-config.ts — Topstep/MFFU
// $50K returns 50 per the canonical FIRMS table.
/**
 * Returns the firm contract cap for a given firmKey + symbol.
 * Resolved via getFirmLimit() (canonical source). Strips `_50k` suffix.
 * Falls back to CONTRACT_CAP_MAX when firmKey is unknown.
 */
function getFirmContractCap(firmKey: string | null | undefined, _symbol: string): number {
  if (!firmKey) return CONTRACT_CAP_MAX;
  const normalized = firmKey.toLowerCase().replace(/_50k$/, "");
  const limit = getFirmLimit(normalized);
  if (!limit) return CONTRACT_CAP_MAX;
  return Math.max(CONTRACT_CAP_MIN, Math.min(limit.maxContracts, CONTRACT_CAP_MAX));
}

// ─── deep-scan #22 fix #8: fail-open `parseFloat(x) || default` sizing bug ──
// `parseFloat("0") || 50_000` evaluates to 50_000 because 0 is falsy — a legitimately
// zeroed-out account balance/starting-capital column (e.g. a session drained to $0, or
// a not-yet-funded test session) was silently replaced with a phantom $50K, which then
// flowed into computeRiskDerivedContracts() and sized live-shaped orders off a balance
// the account does not actually have. Only NaN/undefined/null (a genuinely missing or
// malformed numeric column) should fall back to the default — a real 0 must survive.
export function parseAccountNumericOrDefault(raw: unknown, fallback: number): number {
  if (raw == null) return fallback;
  const n = typeof raw === "number" ? raw : parseFloat(raw as string);
  return Number.isFinite(n) ? n : fallback;
}

// ─── Calendar Filter Cache (Fix 3) ──────────────────────────────
// Caches Python calendar_filter results per ET hour (YYYY-MM-DD-HH).
// Economic event blackout windows are ±30 min, so hourly granularity is safe.
// Reduces subprocess spawns from ~O(bars/day) to at most 24 calls/day.
// Process-local — paper engine is single-instance.

interface SignalCalendarCacheEntry {
  is_holiday: boolean;
  is_triple_witching: boolean;
  holiday_proximity: number;
  is_economic_event: boolean;
  economic_event_name: string;
  event_window_minutes: number;
}

const signalCalendarCache = new Map<string, SignalCalendarCacheEntry>();

// ─── Calendar gate failure tracker (F-2) ────────────────────────
// Counts Python subprocess failures within a rolling 10-minute window.
// If 3+ failures occur → fires a CRITICAL Discord alert.
// Avoids re-spawning a Python process on every bar when the subprocess is down.
interface CalendarFailRecord { ts: number }
const _calendarFailLog: CalendarFailRecord[] = [];
const CALENDAR_FAIL_WINDOW_MS  = 10 * 60 * 1000; // 10 minutes
const CALENDAR_FAIL_ALERT_THRESHOLD = 3;

function _recordCalendarFailure(err: unknown): void {
  const now = Date.now();
  _calendarFailLog.push({ ts: now });
  // Prune records outside the window
  while (_calendarFailLog.length > 0 && now - _calendarFailLog[0].ts > CALENDAR_FAIL_WINDOW_MS) {
    _calendarFailLog.shift();
  }
  if (_calendarFailLog.length >= CALENDAR_FAIL_ALERT_THRESHOLD) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error(
      { failureCount: _calendarFailLog.length, windowMs: CALENDAR_FAIL_WINDOW_MS, err },
      "F-2: calendar-filter Python failures exceeded threshold — CRITICAL alert fired",
    );
    // Fire Discord CRITICAL alert (non-blocking)
    import("../services/alert-service.js")
      .then(({ AlertFactory }) =>
        AlertFactory.systemError(
          "calendar-filter-python-storm",
          new Error(
            `Calendar filter Python subprocess failed ${_calendarFailLog.length}+ times in 10 min. ` +
            `Last error: ${errMsg}. Using safe-default (no blackout). Investigate Python worker.`,
          ),
        )
      )
      .catch(() => {/* non-blocking — swallow alert delivery failure */});
    // Clear the log after alerting so we don't spam on every subsequent failure
    _calendarFailLog.length = 0;
  }
}

/** Test-only: reset the failure log between unit tests. */
export function __resetCalendarFailLogForTests(): void {
  _calendarFailLog.length = 0;
}

/**
 * Test-only: reset the signal calendar cache between unit tests so mocked
 * Python responses aren't masked by a previously-cached entry from an
 * earlier test within the same hour-key bucket.
 * Production code must never call this.
 */
export function __resetSignalCalendarCacheForTests(): void {
  signalCalendarCache.clear();
}

// ─── Skip Classifier Cache (Task 1 / P0-3) ──────────────────────
// Caches Python skip_classifier.classify_session() results per session × ET hour.
// Pre-market signals (VIX, overnight gap, calendar) change at most once per hour;
// bar-level caching would spawn O(bars/day) Python processes — excessive.
// Cache key: `${sessionId}:${etHourKey}` so each session gets its own classification
// (different strategies may have different bad_days / consecutive_losses).
//
// TF_PAPER_SKIP_MODE controls enforcement:
//   "off"     — classifier is never called (use only DB-based pre-market decisions)
//   "shadow"  — classifier runs, decision is logged but NEVER blocks trades
//   "enforce" — SKIP blocks entries, REDUCE halves position size (DEFAULT in production)
//
// Fail policy: classifier errors are always fail-OPEN (logged at error, trading continues).
// The DB-based skip engine above this is the hard gate; the classifier is a second layer.

const PAPER_SKIP_MODE: "off" | "shadow" | "enforce" =
  (process.env.TF_PAPER_SKIP_MODE as "off" | "shadow" | "enforce" | undefined) === "off"   ? "off"
  : (process.env.TF_PAPER_SKIP_MODE as "off" | "shadow" | "enforce" | undefined) === "shadow" ? "shadow"
  : "enforce"; // default: enforce

interface SkipClassifierCacheEntry {
  decision: "TRADE" | "REDUCE" | "SKIP";
  score: number;
  reason: string;
  confidence: number;
  override_allowed: boolean;
}

const skipClassifierCache = new Map<string, SkipClassifierCacheEntry>();

/**
 * Test-only: reset the skip classifier cache between unit tests.
 * Production code must never call this.
 */
export function __resetSkipClassifierCacheForTests(): void {
  skipClassifierCache.clear();
}

/**
 * Call skip_classifier.classify_session() via Python runner and cache per session×hour.
 * The signals dict is populated with lightweight in-process data (session state, calendar)
 * rather than fetching live market data (VIX etc.) — those are populated by the pre-market
 * scheduler job and written to skip_decisions. Here we only pass what is available in-process.
 */
async function getCachedSkipClassification(
  barTimestamp: string,
  sessionId: string,
  strategyId: string,
  governorState: GovernorSessionState,
): Promise<SkipClassifierCacheEntry> {
  const hourKey = formatSignalEtHourKey(barTimestamp);
  const cacheKey = `${sessionId}:${hourKey}`;
  const cached = skipClassifierCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const { runPythonModule } = await import("../lib/python-runner.js");

  // Build signals dict from in-process state.
  // VIX, overnight gap, premarket volume are NOT available here (need live data fetch);
  // those are handled by the pre-market scheduler. We populate what we know in-process:
  //   - consecutive_losses — from the governor state machine
  //   - day_of_week — computed from bar timestamp
  //   - calendar — passed as empty (calendar_filter already covered by the separate check above)
  const barDate = new Date(barTimestamp);
  const dayNames = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const dayOfWeek = dayNames[barDate.getUTCDay() === 0 ? 6 : barDate.getUTCDay() - 1] ?? "Monday";

  const signals: Record<string, unknown> = {
    consecutive_losses: governorState.consecutiveLosses,
    day_of_week: dayOfWeek,
    // calendar signals are handled by the dedicated calendar_filter check above;
    // pass a neutral calendar here so we don't double-block on those conditions.
    calendar: { holiday_proximity: 99, triple_witching: false, roll_week: false },
  };

  const result = await runPythonModule<SkipClassifierCacheEntry>({
    module: "src.engine.skip_engine.skip_classifier",
    config: { signals, strategy_id: strategyId },
    timeoutMs: 5_000,
    componentName: "skip-classifier",
  });

  skipClassifierCache.set(cacheKey, result);
  return result;
}

function formatSignalEtHourKey(ts: string): string {
  const d = new Date(ts);
  const etOffsetMs = (isUsDst(d) ? -4 : -5) * 3_600_000;
  const et = new Date(d.getTime() + etOffsetMs);
  const yyyy = et.getUTCFullYear();
  const mm   = String(et.getUTCMonth() + 1).padStart(2, "0");
  const dd   = String(et.getUTCDate()).padStart(2, "0");
  const hh   = String(et.getUTCHours()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}-${hh}`;
}

// Safe-default sentinel returned when the Python subprocess is unavailable.
// Fail-open: "no blackout" is the correct behaviour on infrastructure failure.
// The operator is alerted via _recordCalendarFailure() → CRITICAL Discord alert.
const CALENDAR_SAFE_DEFAULT: SignalCalendarCacheEntry = {
  is_holiday: false,
  is_triple_witching: false,
  holiday_proximity: 999,
  is_economic_event: false,
  economic_event_name: "",
  event_window_minutes: 0,
};

async function getCachedSignalCalendarStatus(
  barTimestamp: string,
): Promise<SignalCalendarCacheEntry> {
  const key = formatSignalEtHourKey(barTimestamp);
  const cached = signalCalendarCache.get(key);
  if (cached !== undefined) return cached;

  try {
    const { runPythonModule } = await import("../lib/python-runner.js");
    const result = await runPythonModule<SignalCalendarCacheEntry>({
      module: "src.engine.skip_engine.calendar_filter",
      config: {
        date: barTimestamp.split("T")[0],
        datetime: barTimestamp,
      },
      timeoutMs: 5_000,
      componentName: "calendar-filter",
    });
    signalCalendarCache.set(key, result);
    return result;
  } catch (err) {
    // FIX B (2026-06-22): Python subprocess failed.
    // PREVIOUS BEHAVIOR: always returned CALENDAR_SAFE_DEFAULT (is_economic_event:false)
    //   → FOMC/CPI/NFP windows silently open during outage → MFFU compliance ban.
    // NEW BEHAVIOR: run the in-process Tier-1 event checker (pure TS, no I/O).
    //   If bar is inside a known Tier-1 window → fail CLOSED (return blocked entry).
    //   If bar is outside all known Tier-1 windows → fail OPEN (CALENDAR_SAFE_DEFAULT).
    //   bypass_news_blackout is NOT passed here; it is handled at the call site
    //   (evaluateSignals calendar gate block) where per-strategy config is available.
    const inProcessCheck = _checkInProcessTier1EventWindow(barTimestamp);
    // LOW#17 (fresh-scan 2026-07-12): this inner catch handles the Python calendar_filter subprocess
    // failure WITHOUT rethrowing, so calResult.is_holiday flows out as false and the OUTER catch's
    // checkCmeHolidayFallback (evaluateSignals) — the documented guard for "is_holiday never consulted"
    // — NEVER runs. Consult the static CME-closure table HERE too so a full market-closure day during a
    // Python outage still reports is_holiday=true (holidays always fail-CLOSED / block, even for
    // event-driven strategies).
    const cmeHoliday = checkCmeHolidayFallback(barTimestamp);
    const entryToCache: SignalCalendarCacheEntry = inProcessCheck.blocked
      ? {
          is_holiday: cmeHoliday.isHoliday,
          is_triple_witching: false,
          holiday_proximity: cmeHoliday.isHoliday ? 0 : 999,
          is_economic_event: true,
          economic_event_name: inProcessCheck.eventName,
          event_window_minutes: inProcessCheck.windowMinutes,
        }
      : {
          ...CALENDAR_SAFE_DEFAULT,
          is_holiday: cmeHoliday.isHoliday,
          holiday_proximity: cmeHoliday.isHoliday ? 0 : CALENDAR_SAFE_DEFAULT.holiday_proximity,
        };

    logger.error(
      { err, barTimestamp, key, inProcessBlocked: inProcessCheck.blocked, eventType: inProcessCheck.eventType },
      inProcessCheck.blocked
        ? "FIX B: calendar-filter Python subprocess failed — in-process Tier-1 check BLOCKED (fail-CLOSED for known economic event window)"
        : "F-2: calendar-filter Python subprocess failed — no Tier-1 window active, caching safe-default",
    );
    _recordCalendarFailure(err);
    signalCalendarCache.set(key, entryToCache);
    return entryToCache;
  }
}

// ─── Types ──────────────────────────────────────────────────

export interface Bar {
  symbol: string;
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface StrategyConfig {
  entry_rules: string[];       // e.g. ["close > sma_20", "rsi_14 < 30"]
  exit_rules: string[];        // e.g. ["close < sma_20", "rsi_14 > 70"]
  side: "long" | "short";
  contracts: number;
  stop_loss?: StopLossConfig;
  trail_stop?: TrailStopConfig;    // 2.3: trailing stop (ATR-based)
  max_hold_bars?: number;          // 2.4: force-close after N bars
  preferred_sessions?: string[];   // ["NY_RTH", "London", "Asia"]
  cooldown_bars?: number;          // bars to wait after closing before re-entry
  indicators?: Record<string, unknown>; // optional indicator overrides
}

interface StopLossConfig {
  type: "atr" | "fixed" | "absolute_level";
  multiplier?: number;   // for ATR stop
  amount?: number;        // for fixed stop (distance from entry)
  level?: number;         // for absolute_level stop (exact stop PRICE, not distance)
  atr_period?: number;    // default 14
}

export interface TrailStopConfig {
  atr_multiple: number;   // e.g. 2.0 → trail distance = 2 × ATR
  atr_period?: number;    // ATR period, default 14
  // W5b Tier 5.1 — break-even + time-decay extensions (all optional; null/undefined = no change to existing behavior)
  break_even_at_r?: number;        // trigger at 1.0 = 1:1 profit (1R). null = disabled.
  time_decay_minutes?: number;     // minutes after open at which trail tightens. null = disabled.
  time_decay_multiplier?: number;  // factor to multiply atr_multiple after time_decay_minutes (e.g. 0.75 → 2x→1.5x). null = disabled.
}

// ─── Tick Sizes by Symbol ───────────────────────────────────────
// Used by break-even leg to set SL at entry ± 1 tick.
// Only micro futures listed here; unknown symbols default to 0.25.
export const TICK_SIZES: Record<string, number> = {
  MES:  0.25,  // S&P micro
  MNQ:  0.25,  // Nasdaq micro
  MCL:  0.01,  // Crude oil micro (0.01 per contract = $1)
  M2K:  0.10,  // Russell 2000 micro
  MYM:  1.00,  // Dow Jones micro
  MGC:  0.10,  // Gold micro
  M6E:  0.0001, // Euro micro FX
  // Add additional symbols here as needed
};

export interface TrailStopExtendedInput {
  positionId: string;
  side: "long" | "short";
  entryPrice: number;
  initialRiskPoints: number;  // |entry - hard SL| in price points
  atrValue: number;
  currentHigh: number;        // bar.high
  currentLow: number;         // bar.low
  minutesOpen: number;        // minutes elapsed since position opened
  currentHWM: number | null;  // existing HWM from trailStopHWM map (null if first bar)
  symbol: string;
}

interface TrailStopExtendedResult {
  hit: boolean;
  stopPrice: number;
  newHWM: number;
  breakEvenActive: boolean;
  timeDecayActive: boolean;
  effectiveMultiple: number;
}

/**
 * Extended trail stop evaluation (Tier 5.1).
 *
 * Evaluates break-even leg and time-decay tightening ON TOP of the existing
 * ATR-based HWM trail.  When break_even_at_r and time_decay_minutes are both
 * null/undefined, output is identical to the pre-W5b checkTrailStop() —
 * backwards-compatible by design.
 *
 * Break-even leg:
 *   If profit ≥ break_even_at_r × initial_risk_points → SL advances to
 *   entry ± 1 tick (long: entry + tick, short: entry - tick), whichever is
 *   more favourable than the current ATR trail.
 *
 * Time-decay tightening:
 *   If minutes_open ≥ time_decay_minutes → effective atr_multiple is
 *   multiplied by time_decay_multiplier before computing the ATR trail.
 *   This makes the trail tighter after the position has been held "too long",
 *   encouraging exit before the move fades.
 *
 * Priority: stop level = max(ATR trail, break-even SL) for longs;
 *           min(ATR trail, break-even SL) for shorts.
 */
export function checkTrailStopExtended(
  config: TrailStopConfig,
  input: TrailStopExtendedInput,
): TrailStopExtendedResult {
  const {
    positionId: _positionId, side, entryPrice, initialRiskPoints,
    atrValue, currentHigh, currentLow, minutesOpen, currentHWM, symbol,
  } = input;

  // 1. Update HWM
  let newHWM: number;
  if (side === "long") {
    newHWM = currentHWM === null ? currentHigh : Math.max(currentHWM, currentHigh);
  } else {
    newHWM = currentHWM === null ? currentLow : Math.min(currentHWM, currentLow);
  }

  // 2. Resolve effective ATR multiple (time-decay tightening)
  const timeDecayActive =
    config.time_decay_minutes != null &&
    config.time_decay_multiplier != null &&
    minutesOpen >= config.time_decay_minutes;

  const effectiveMultiple = timeDecayActive
    ? config.atr_multiple * config.time_decay_multiplier!
    : config.atr_multiple;

  // 3. Compute ATR-based trail level
  let atrTrailLevel: number;
  if (side === "long") {
    atrTrailLevel = newHWM - effectiveMultiple * atrValue;
  } else {
    atrTrailLevel = newHWM + effectiveMultiple * atrValue;
  }

  // 4. Break-even leg
  const tickSize = TICK_SIZES[symbol] ?? 0.25;
  let breakEvenActive = false;
  let breakEvenLevel: number | null = null;

  if (config.break_even_at_r != null && initialRiskPoints > 0) {
    const profitThreshold = config.break_even_at_r * initialRiskPoints;
    let currentProfit: number;
    if (side === "long") {
      currentProfit = newHWM - entryPrice;
    } else {
      currentProfit = entryPrice - newHWM;
    }

    if (currentProfit >= profitThreshold) {
      breakEvenActive = true;
      if (side === "long") {
        breakEvenLevel = entryPrice + tickSize;
      } else {
        breakEvenLevel = entryPrice - tickSize;
      }
    }
  }

  // 5. Final stop level = most favourable of ATR trail and break-even
  let stopPrice: number;
  if (side === "long") {
    stopPrice = breakEvenLevel !== null
      ? Math.max(atrTrailLevel, breakEvenLevel)
      : atrTrailLevel;
    const hit = currentLow <= stopPrice;
    return { hit, stopPrice, newHWM, breakEvenActive, timeDecayActive, effectiveMultiple };
  } else {
    stopPrice = breakEvenLevel !== null
      ? Math.min(atrTrailLevel, breakEvenLevel)
      : atrTrailLevel;
    const hit = currentHigh >= stopPrice;
    return { hit, stopPrice, newHWM, breakEvenActive, timeDecayActive, effectiveMultiple };
  }
}

interface CachedSession {
  config: StrategyConfig;
  strategyId: string;
  // deep-scan C-1: the strategy's CONCEPT name (not the UUID). The context/eligibility
  // gate matches on the concept name; passing strategyId (a UUID) made every live signal
  // SKIP on any non-NO_TRADE playbook. Backtest passes strategy.name — this restores parity.
  name: string;
  symbol: string;
  timeframe: string;             // e.g. "1m", "5m", "15m", "1h"
  cooldownRemaining: number;     // bars remaining in cooldown
  // B8b: PILOT canary state — read from strategy.lifecycleState at session cache load.
  // Used to enforce the 1-contract ceiling during PILOT canary window.
  lifecycleState: string;
  // Wave 29 Pass A.1: SHADOW stage flag. When true, signals are intercepted before
  // openPosition() — logged to lifecycle_shadow_signals but TradersPost webhook NOT called.
  // Pine alerts still fire on TradingView (operator sees signal on chart).
  shadowModeEnabled: boolean;
  // #2 (2026-07-11): the strategy's exit_plan_config (separate `strategies.exit_plan_config` column,
  // NOT inside strategy.config JSONB). Forwarded to openPosition's adaptiveExitInput so an opted-in
  // `exit_style="adaptive"` strategy actually runs the adaptive exit plan on paper (was dormant — the
  // deferred-fill path never carried it, so every strategy silently fell back to static_styleC). null
  // for the vast majority (default static_styleC) → byte-identical legacy behavior.
  exitPlanConfig: ExitPlanConfig | null;
}

// ─── B4.3: In-memory Governor State (per session) ──────────────
// Mirrors Python Governor state machine — tracked in-process to avoid
// subprocess overhead on the hot signal evaluation path (every bar).
// State transitions match src/engine/governor/state_machine.py exactly.
//
// Parity guarantee: same state + same thresholds as the Python Governor
// used in backtest_governor replay. Drift would require changing both.

type GovernorStateName =
  | "normal" | "alert" | "cautious" | "defensive" | "lockout" | "recovery";

interface GovernorSessionState {
  state: GovernorStateName;
  consecutiveLosses: number;
  consecutiveWins: number;
  sessionPnl: number;
  sessionTrades: number;
  profitableSessions: number;
  dailyLossBudget: number;
}

const SIZE_MULTIPLIERS_TS: Record<GovernorStateName, number> = {
  normal: 1.0,
  alert: 1.0,
  cautious: 0.75,
  defensive: 0.50,
  lockout: 0.0,
  recovery: 0.50,
};

// Per-session governor state cache. Keyed by sessionId.
// Evicted when session stops (cleanupSession).
const governorStateCache = new Map<string, GovernorSessionState>();

// ─── FIX 1 (B2 PARITY CRITICAL): Pending-entry queue — next-bar fill ─────────
// Backtest convention (backtester.py:1305): entry signal on bar N fires at the
// OPEN of bar N+1 (implemented via np.roll(entries_np, 1)).  Paper was executing
// fills at bar N's close — 1 bar early, systematically better entry prices.
//
// Fix: when an entry signal fires on bar N, store the pending params in this map.
// On bar N+1 arrival, the deferred entry executes at bar N+1's close.
//
// Key: `${sessionId}:${symbol}` — one pending entry per session+symbol.
// Evicted: on execution, on position-open failure, or on session cleanup.
// Signal-exits (exitSignal) are NOT deferred — they remain same-bar.
// Stop-loss / trail-stop / time-exits are already intra-bar in both backtest
// and paper (hit-price logic, not bar-close of signal bar), so no deferral needed.

interface PendingEntry {
  sessionId: string;
  symbol: string;
  side: "long" | "short";
  contracts: number;
  orderType: "stop_limit";
  stopLimitOffset: number | undefined;
  rsi: number | undefined;
  atr: number | undefined;
  barVolume: number | undefined;
  medianBarVolume: number | undefined;
  signalBarTimestamp: string; // bar N timestamp (for audit trail)
  correlationId: string | undefined;
  // Wave 2 (2026-07-16): config stop-ATR multiple (config.stop_loss?.multiplier ?? 1.5),
  // threaded to openPosition so the paper managed stop = managedStopPts(symbol, atr, stopMultiplier)
  // = min(ceiling, mult×atr) — the SAME multiplier the sizer used at signal time.
  stopMultiplier: number;
  // Trade-critique data bridge (2026-07-05): entry-time decision context captured
  // at signal time (bar N), carried across the deferred fill to bar N+1's
  // openPosition() call. Absent/undefined when nothing was known at signal time —
  // never fabricated. See EntryDecisionContext in jsonb-shapes.ts.
  entryContext: EntryDecisionContext | undefined;
  // deep-scan 2026-07-11 MED fix (#9): true when the signal-time sizing ALREADY applied the Tier-1
  // news reduce_size factor (signal fired inside the T1 window). The fill-time Gate 4 must NOT reduce
  // again (double ×0.5 → 0.25×, or a silent drop to 0 for small base sizes). Absent/false = the signal
  // was queued OUTSIDE the window, so Gate 4 legitimately applies the reduction when the fill crosses in.
  newsReducedAtSignalTime?: boolean;
}

const pendingEntryQueue = new Map<string, PendingEntry>();

/**
 * Test hook — clear pending entry queue between tests.
 * Production code must never call this.
 */
export function __clearPendingEntryQueueForTests(): void {
  pendingEntryQueue.clear();
}

/**
 * Test hook — read a pending entry back out of the in-memory queue by
 * session+symbol key, without exposing the Map itself.
 */
export function __peekPendingEntryForTests(sessionId: string, symbol: string): PendingEntry | undefined {
  return pendingEntryQueue.get(`${sessionId}:${symbol}`);
}

/**
 * M2 (2026-07-17): boot re-hydration entry point. Called by
 * scheduler.ts::resumeActivePaperSessions() after a restart, for every
 * session whose internal simulator stream resumes (pre-PAPER sessions only —
 * PAPER+ strategies never populate this Map, TradersPost is their canonical
 * journal, so there is nothing to re-hydrate for them).
 *
 * Re-hydrates the in-memory pendingEntryQueue from persisted
 * paper_pending_entries rows so a restart landing between a deferred entry's
 * signal (bar N) and its fill (bar N+1) does not silently drop the trade —
 * the next evaluateSignals() call for that session+symbol will see the
 * re-hydrated entry exactly as if the process had never restarted.
 */
export async function rehydratePendingEntryQueueForSession(
  sessionId: string,
): Promise<{ rehydrated: number; droppedStale: number }> {
  return rehydratePendingEntriesForSession(sessionId, (entry: PersistablePendingEntry) => {
    pendingEntryQueue.set(`${entry.sessionId}:${entry.symbol}`, entry as PendingEntry);
  });
}

// ─── Fix 4: Parity divergence warning — logged once per session start ──────
// Paper enforces skip engine + anti-setup gates ALWAYS.
// Backtest defaults: TF_BACKTEST_SKIP_MODE=off, TF_BACKTEST_ANTI_SETUP_MODE=off.
// This means the DEPLOY_READY gate compares filtered paper Sharpe against
// unfiltered backtest Sharpe — apples to oranges.  We surface this as a
// structured WARNING once per session so operators can act on it.
// Resolution: set TF_BACKTEST_SKIP_MODE=enforce to align both sides.
const parityWarnedSessions = new Set<string>();

// FIX 4 (Track M): dedup set for signal.entry_eval_skipped_halted audit rows.
// Prevents flooding the audit_log on every bar when the system is halted.
// Key: `${sessionId}:${YYYY-MM-DD}` — resets naturally at midnight when the key changes.
const _haltedEntryAuditDedup = new Set<string>();

/**
 * Return the current governor state for a session.
 * Initialises to NORMAL if not yet tracked.
 */
function getGovernorState(
  sessionId: string,
  dailyLossBudget: number = 500,
): GovernorSessionState {
  let state = governorStateCache.get(sessionId);
  if (!state) {
    state = {
      state: "normal",
      consecutiveLosses: 0,
      consecutiveWins: 0,
      sessionPnl: 0,
      sessionTrades: 0,
      profitableSessions: 0,
      dailyLossBudget,
    };
    governorStateCache.set(sessionId, state);
  }
  return state;
}

/**
 * Update governor state after a trade closes.
 * Call this from the position-close path so the state stays current.
 * Returns new state name for logging.
 */
export function updateGovernorOnTrade(
  sessionId: string,
  pnl: number,
  dailyLossBudget: number = 500,
): GovernorStateName {
  const gov = getGovernorState(sessionId, dailyLossBudget);
  gov.sessionPnl += pnl;
  gov.sessionTrades += 1;

  if (pnl < 0) {
    gov.consecutiveLosses += 1;
    gov.consecutiveWins = 0;
  } else {
    gov.consecutiveWins += 1;
    gov.consecutiveLosses = 0;
  }

  const sessionLossPct =
    gov.dailyLossBudget > 0 && gov.sessionPnl < 0
      ? Math.abs(gov.sessionPnl) / gov.dailyLossBudget
      : 0;

  const prev = gov.state;

  switch (gov.state) {
    case "normal":
      if (gov.consecutiveLosses >= 2 || sessionLossPct >= 0.30) gov.state = "alert";
      break;
    case "alert":
      if (gov.consecutiveLosses >= 3 || sessionLossPct >= 0.50) gov.state = "cautious";
      else if (gov.consecutiveWins >= 2) gov.state = "normal";
      break;
    case "cautious":
      if (gov.consecutiveLosses >= 4 || sessionLossPct >= 0.65) gov.state = "defensive";
      else if (gov.consecutiveWins >= 2) gov.state = "alert";
      break;
    case "defensive":
      if (gov.consecutiveLosses >= 5 || sessionLossPct >= 0.80) gov.state = "lockout";
      else if (gov.consecutiveWins >= 3) gov.state = "cautious";
      break;
    case "lockout":
      break; // only session_end transitions out of lockout
    case "recovery":
      if (pnl < 0) {
        gov.state = "lockout";
        gov.profitableSessions = 0;
      }
      break;
  }

  if (prev !== gov.state) {
    logger.info(
      { sessionId, prevState: prev, newState: gov.state, consecutiveLosses: gov.consecutiveLosses, sessionLossPct: sessionLossPct.toFixed(2) },
      "Governor B4.3: state transition",
    );
  }

  // P0-4: Persist governor state to DB on every update (async, non-blocking).
  // This ensures the state survives a server restart — resumeActivePaperSessions()
  // reads this column and restores the in-memory cache entry.
  // Do NOT await — must not block the trade-close path.
  const governorSnapshot = {
    state: gov.state,
    consecutiveLosses: gov.consecutiveLosses,
    consecutiveWins: gov.consecutiveWins,
    sessionLossPct: parseFloat(sessionLossPct.toFixed(4)),
    lastUpdatedAt: new Date().toISOString(),
  };
  db.update(paperSessions)
    .set({ governorState: governorSnapshot as unknown as import("../db/jsonb-shapes.js").PaperSessionGovernorStateShape })
    .where(eq(paperSessions.id, sessionId))
    .catch((err: unknown) =>
      logger.warn({ err, sessionId, governorState: gov.state }, "Failed to persist governor state to DB (non-blocking)"),
    );

  return gov.state;
}

/**
 * Check whether the governor allows a new entry.
 * Returns { allowed, adjustedContracts, reason }.
 */
function checkGovernor(
  sessionId: string,
  requestedContracts: number,
  dailyLossBudget: number = 500,
): { allowed: boolean; adjustedContracts: number; reason: string; governorState: GovernorStateName } {
  const gov = getGovernorState(sessionId, dailyLossBudget);
  const mult = SIZE_MULTIPLIERS_TS[gov.state];

  if (gov.state === "lockout" || mult === 0.0) {
    return {
      allowed: false,
      adjustedContracts: 0,
      reason: `governor_lockout: state=${gov.state}`,
      governorState: gov.state,
    };
  }

  const adjusted = Math.max(0, Math.floor(requestedContracts * mult));
  if (adjusted === 0) {
    return {
      allowed: false,
      adjustedContracts: 0,
      reason: `governor_size_zero: state=${gov.state}, mult=${mult}, requested=${requestedContracts}`,
      governorState: gov.state,
    };
  }
  return {
    allowed: true,
    adjustedContracts: adjusted,
    reason: adjusted < requestedContracts
      ? `governor_reduced: state=${gov.state}, mult=${mult}`
      : `governor_allowed: state=${gov.state}`,
    governorState: gov.state,
  };
}

/**
 * P0-4: Restore governor state from a persisted DB snapshot into the in-memory cache.
 * Called by resumeActivePaperSessions() after server restart.
 * Returns the restored state name for logging, or null if the snapshot was invalid.
 *
 * Only restores fields the governor state machine actually uses; ignores unknown keys.
 * Snapshots persisted before the "alert" state was added will have partial fields —
 * those are safely defaulted.
 */
export function restoreGovernorState(
  sessionId: string,
  snapshot: Record<string, unknown>,
): GovernorStateName | null {
  const validStates: ReadonlySet<string> = new Set([
    "normal", "alert", "cautious", "defensive", "lockout", "recovery",
  ]);

  const rawState = snapshot.state;
  if (typeof rawState !== "string" || !validStates.has(rawState)) {
    logger.warn(
      { sessionId, rawState },
      "P0-4: Governor state snapshot has invalid state field — not restoring",
    );
    return null;
  }

  const restoredState: GovernorSessionState = {
    state: rawState as GovernorStateName,
    consecutiveLosses: typeof snapshot.consecutiveLosses === "number" ? snapshot.consecutiveLosses : 0,
    consecutiveWins: typeof snapshot.consecutiveWins === "number" ? snapshot.consecutiveWins : 0,
    sessionPnl: 0, // reset session-level P&L on restart (new trading day)
    sessionTrades: 0,
    profitableSessions: 0,
    dailyLossBudget: typeof snapshot.dailyLossBudget === "number" ? snapshot.dailyLossBudget : 500,
  };

  governorStateCache.set(sessionId, restoredState);
  return restoredState.state;
}

/**
 * Reset per-session state at end of trading day (mirrors Python on_session_end).
 * Call from session-stop or end-of-day scheduler.
 */
export function governorOnSessionEnd(sessionId: string): void {
  const gov = governorStateCache.get(sessionId);
  if (!gov) return;

  if (gov.state === "lockout") {
    gov.state = "recovery";
    gov.profitableSessions = 0;
  } else if (gov.state === "recovery") {
    if (gov.sessionPnl > 0) {
      gov.profitableSessions += 1;
      if (gov.profitableSessions >= 2) gov.state = "normal";
    } else {
      gov.state = "lockout";
      gov.profitableSessions = 0;
    }
  }
  // Reset session-level counters
  gov.sessionPnl = 0;
  gov.sessionTrades = 0;
  // NOTE: consecutiveLosses/consecutiveWins persist across sessions (cross-session streaks)
}

interface SignalLogEntry {
  sessionId: string;
  symbol: string;
  timestamp: string;
  entrySignal: boolean;
  exitSignal: boolean;
  stopHit: boolean;
  sessionFiltered: boolean;
  /** W23H.3: true when bar is outside allowed_entry_windows (and list is non-empty). */
  windowFiltered?: boolean;
  cooldownActive: boolean;
  riskGatePassed: boolean | null;
  action: "none" | "open" | "close_signal" | "close_stop" | "close_trail" | "close_time";
  indicators: Record<string, number>;
  barClose: number;
  strategySide: "long" | "short";   // actual strategy side for correct signal logging
  fillMiss?: boolean;               // true when fill probability model rejected the order
}

// deepscan14 D2: rate-limit price-lock gate-inactive telemetry to once per
// session per day (not per-signal). The gate is evaluated on every signal, but
// "the settlement feed is missing" is a slow-moving fact — flooding audit_log
// once per signal would bury the one row that matters. Keyed by sessionId,
// value is the last UTC day-string (YYYY-MM-DD) telemetry fired for that session.
const priceLockGateInactiveTelemetryLastFired = new Map<string, string>();

// ─── Session Config Cache ───────────────────────────────────

const sessionCache = new Map<string, CachedSession>();

async function getSessionConfig(sessionId: string): Promise<CachedSession | null> {
  const cached = sessionCache.get(sessionId);
  if (cached) return cached;

  const [session] = await db
    .select()
    .from(paperSessions)
    .where(eq(paperSessions.id, sessionId));
  if (!session || !session.strategyId) return null;

  const [strategy] = await db
    .select()
    .from(strategies)
    .where(eq(strategies.id, session.strategyId));
  if (!strategy) return null;

  // Auto-detect and translate strategy format
  let paperConfig = strategy.config as Record<string, any>;
  if (isDSLStrategy(paperConfig)) {
    paperConfig = translateDSLToPaperConfig(paperConfig as any);
  }
  const config = paperConfig as StrategyConfig;

  // Warn if no exit mechanism exists — positions will be trapped open forever
  if ((!config.exit_rules || config.exit_rules.length === 0) && !config.stop_loss) {
    logger.warn(
      { sessionId, strategyId: strategy.id, name: strategy.name },
      "Strategy has no exit rules AND no stop loss — positions can only be closed manually",
    );
  }

  const entry: CachedSession = {
    config,
    strategyId: strategy.id,
    name: strategy.name,
    symbol: strategy.symbol,
    timeframe: strategy.timeframe ?? "1m",
    cooldownRemaining: 0,
    // B8b: capture lifecycle state at cache-load time for PILOT contract clamp.
    // Cache miss on state change is acceptable — the 6h cron ensures PILOT strategies
    // are only in PILOT during the narrow canary window. Callers that need the
    // latest state will see it on the next cache miss (session restart or invalidation).
    lifecycleState: strategy.lifecycleState,
    // Wave 29 Pass A.1: capture shadow_mode_enabled at cache-load time.
    // Fail-soft: if column is absent (legacy DB / schema drift), default to false.
    shadowModeEnabled: (strategy as unknown as Record<string, unknown>).shadowModeEnabled === true,
    // #2 (2026-07-11): separate strategies.exit_plan_config column. Fail-soft to null if absent
    // (legacy DB / schema drift) → openPosition treats it as static_styleC (no behavior change).
    exitPlanConfig: (strategy.exitPlanConfig as ExitPlanConfig | null | undefined) ?? null,
  };

  sessionCache.set(sessionId, entry);
  return entry;
}

export function invalidateSessionCache(sessionId: string): void {
  sessionCache.delete(sessionId);
}

/**
 * F-1 Capital Safety Fix — shadow_mode_enabled cache invalidation by strategy.
 *
 * When lifecycle-service.ts atomically sets shadow_mode_enabled in the DB
 * (entering or leaving SHADOW), the in-memory sessionCache may hold a stale
 * CachedSession.shadowModeEnabled value for any active session belonging to
 * this strategy.  A stale false → signals execute as real broker orders instead
 * of being shadow-intercepted.  A stale true → signals are shadow-intercepted
 * after the strategy exits SHADOW.
 *
 * This function evicts ALL sessionCache entries whose .strategyId matches the
 * given strategyId.  The next signal for the affected session(s) will reload
 * the fresh shadowModeEnabled flag from the DB.
 *
 * Safe by design:
 *   - The cache is keyed by sessionId (not strategyId); we must iterate.
 *   - Map.delete() on a missing key is always a no-op (never throws).
 *   - An empty cache or zero-match case is fully safe.
 *   - Called from lifecycle-service.ts post-commit, wrapped in try/catch
 *     there, so any unexpected error here is absorbed and logged — it NEVER
 *     blocks or aborts the lifecycle transition itself.
 */
export function invalidateSessionCacheForStrategy(strategyId: string): void {
  for (const [sessionId, entry] of sessionCache.entries()) {
    if (entry.strategyId === strategyId) {
      sessionCache.delete(sessionId);
    }
  }
}

export function clearSessionCache(): void {
  sessionCache.clear();
}

/**
 * Clean up all in-memory state for a session (call on stop/kill).
 * Prevents memory leaks from indicator cache and session config cache.
 */
export function cleanupSession(sessionId: string, symbols: string[]): void {
  sessionCache.delete(sessionId);
  governorStateCache.delete(sessionId);   // B4.3: evict governor state on session stop
  for (const symbol of symbols) {
    previousIndicators.delete(`${sessionId}:${symbol}`);
    // FIX 1 (B2): evict any pending deferred entry for this session+symbol on stop
    pendingEntryQueue.delete(`${sessionId}:${symbol}`);
  }
  // M2 (2026-07-17): durability backstop — delete all persisted pending-entry
  // rows for this session on stop (session-scoped, not per-symbol). Fire-and-
  // forget: cleanupSession is synchronous by contract; this never throws.
  void deleteAllPendingEntriesForSession(sessionId);
  // Trail stop HWM and bars-held are keyed by position UUID — we can't filter
  // by sessionId without an extra DB lookup.  Accept the small leak; positions
  // should all be closed before session stop, so in practice the maps are empty.
  // ICT indicator cache: prune entries for this session
  for (const key of ictIndicatorCache.keys()) {
    if (key.startsWith(`${sessionId}:`)) {
      ictIndicatorCache.delete(key);
    }
  }
}

// ─── Indicator Functions (exported for testing) ─────────────

export function SMA(closes: number[], period: number): number {
  if (closes.length < period) return NaN;
  const slice = closes.slice(-period);
  return slice.reduce((sum, v) => sum + v, 0) / period;
}

export function EMA(closes: number[], period: number): number {
  if (closes.length < period) return NaN;
  const k = 2 / (period + 1);
  // Seed with SMA of first `period` values
  let ema = closes.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
  }
  return ema;
}

export function RSI(closes: number[], period: number): number {
  if (closes.length < period + 1) return NaN;
  let avgGain = 0;
  let avgLoss = 0;

  // Initial average over first `period` changes
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) avgGain += change;
    else avgLoss += Math.abs(change);
  }
  avgGain /= period;
  avgLoss /= period;

  // Smoothed (Wilder's) for remaining bars
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) {
      avgGain = (avgGain * (period - 1) + change) / period;
      avgLoss = (avgLoss * (period - 1)) / period;
    } else {
      avgGain = (avgGain * (period - 1)) / period;
      avgLoss = (avgLoss * (period - 1) + Math.abs(change)) / period;
    }
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function ATR(bars: Bar[], period: number): number {
  if (bars.length < period + 1) return NaN;
  const trueRanges: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const high = bars[i].high;
    const low = bars[i].low;
    const prevClose = bars[i - 1].close;
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    trueRanges.push(tr);
  }

  if (trueRanges.length < period) return NaN;

  // Wilder's smoothed ATR
  let atr = trueRanges.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < trueRanges.length; i++) {
    atr = (atr * (period - 1) + trueRanges[i]) / period;
  }
  return atr;
}

export function VWAP(bars: Bar[]): number {
  if (bars.length === 0) return NaN;
  let cumulativeTPV = 0;
  let cumulativeVolume = 0;
  for (const bar of bars) {
    const tp = (bar.high + bar.low + bar.close) / 3;
    cumulativeTPV += tp * bar.volume;
    cumulativeVolume += bar.volume;
  }
  if (cumulativeVolume === 0) return NaN;
  return cumulativeTPV / cumulativeVolume;
}

/**
 * post-m3-paper-execution-lifecycle wave (2026-07-17) HIGH fix — session VWAP + 1σ/2σ bands,
 * ported bit-for-bit from the running-population-variance formula in
 * src/engine/indicators/core.py::compute_vwap_with_bands() (institutional formula, documented
 * there verbatim):
 *   cum_pv[i]  = Σ_{j<=i} tp[j]·vol[j]
 *   cum_v[i]   = Σ_{j<=i} vol[j]
 *   vwap[i]    = cum_pv[i] / cum_v[i]                     (running VWAP AT bar i)
 *   cum_pv2[i] = Σ_{j<=i} (tp[j] - vwap[j])² · vol[j]      (uses the RUNNING vwap at EACH prior
 *                                                            bar j, not the final bar's vwap —
 *                                                            this is what makes it a running/
 *                                                            population variance, not a static one)
 *   sigma[i]   = sqrt(cum_pv2[i] / cum_v[i])
 *   bands[i]   = vwap[i] ± 1·sigma[i], vwap[i] ± 2·sigma[i]
 *
 * We only need the values at the LAST bar (the caller always passes a session-filtered buffer
 * ending at "now"), so this returns a single point rather than a per-bar series — the loop is the
 * same O(N) single pass compute_vwap_with_bands() does per-session, just scalar instead of a
 * Polars column. `vwap` here will equal VWAP(bars) bit-for-bit (same tp/vol math); callers that
 * already have `vals["vwap"]` computed separately may ignore this function's `vwap` field and use
 * only the band deltas — kept for completeness / standalone testability.
 *
 * Zero-cum-volume guard mirrors core.py's `fill_null(strategy="forward").fill_null(0.0)`: while
 * cumulative volume is still 0 (leading zero-volume bars at session open), the running vwap holds
 * at its last known value (0 before any volume has printed) instead of propagating NaN/Infinity
 * into the variance accumulator.
 */
export function computeVwapWithBands(bars: Bar[]): {
  vwap: number;
  band1sUpper: number;
  band1sLower: number;
  band2sUpper: number;
  band2sLower: number;
} {
  const NA = { vwap: NaN, band1sUpper: NaN, band1sLower: NaN, band2sUpper: NaN, band2sLower: NaN };
  if (bars.length === 0) return NA;

  let cumPv = 0;
  let cumV = 0;
  let cumPv2 = 0;
  let runningVwap = 0;

  for (const bar of bars) {
    const tp = (bar.high + bar.low + bar.close) / 3;
    cumPv += tp * bar.volume;
    cumV += bar.volume;
    runningVwap = cumV > 0 ? cumPv / cumV : runningVwap; // forward-fill-then-0.0 guard
    cumPv2 += (tp - runningVwap) ** 2 * bar.volume;
  }

  if (cumV === 0) return NA;

  const vwap = cumPv / cumV;
  const sigma = Math.sqrt(cumPv2 / cumV);
  return {
    vwap,
    band1sUpper: vwap + sigma,
    band1sLower: vwap - sigma,
    band2sUpper: vwap + 2.0 * sigma,
    band2sLower: vwap - 2.0 * sigma,
  };
}

/**
 * Filter a bar buffer to bars belonging to the SAME CME Globex trading session
 * as the last bar in the buffer.
 *
 * CME Globex session rule: trading day N runs from 18:00 ET on day N-1 through
 * 17:00 ET on day N. This mirrors the backtester's _assign_globex_session_id()
 * in core.py (bars at ET hour >= 18 belong to the NEXT calendar day's session_id).
 *
 * Uses toFuturesTradingDayString (CME +7h shift: 17:00 ET → midnight next day)
 * to assign each bar to a Globex day key. Bars sharing the same key as the last
 * bar are in the current session.
 *
 * Parity: closes the VWAP reset gap vs backtester. The paper-trading-stream bar
 * buffer resets at ET midnight (toEasternDateString), NOT at the 18:00 ET Globex
 * boundary. Filtering here ensures VWAP only spans the current Globex session,
 * matching core.py::compute_vwap_with_bands().
 *
 * Exported for unit testing.
 */
export function filterToGlobexSession(bars: Bar[]): Bar[] {
  if (bars.length === 0) return bars;
  const currentSessionKey = toFuturesTradingDayString(
    new Date(bars[bars.length - 1].timestamp),
  );
  return bars.filter(
    (b) => toFuturesTradingDayString(new Date(b.timestamp)) === currentSessionKey,
  );
}

export function BollingerBands(
  closes: number[],
  period: number,
  stddev: number = 2
): { upper: number; middle: number; lower: number } {
  const middle = SMA(closes, period);
  if (isNaN(middle)) return { upper: NaN, middle: NaN, lower: NaN };

  const slice = closes.slice(-period);
  const variance = period > 1
    ? slice.reduce((sum, v) => sum + (v - middle) ** 2, 0) / (period - 1)
    : 0;
  const sd = Math.sqrt(variance);
  return {
    upper: middle + stddev * sd,
    middle,
    lower: middle - stddev * sd,
  };
}

// ─── Compute All Indicators from Bar Buffer ─────────────────

interface IndicatorValues {
  [key: string]: number;
}

interface ICTBridgeResult {
  values: IndicatorValues;
  bridgeHealthy: boolean;
  error?: string;
}

export function computeIndicators(barBuffer: Bar[]): IndicatorValues {
  const closes = barBuffer.map((b) => b.close);
  const vals: IndicatorValues = {};

  // SMA at common periods
  for (const p of [5, 10, 20, 50, 100, 200]) {
    vals[`sma_${p}`] = SMA(closes, p);
  }

  // EMA at common periods
  for (const p of [5, 9, 12, 20, 26, 50]) {
    vals[`ema_${p}`] = EMA(closes, p);
  }

  // RSI
  for (const p of [7, 14, 21]) {
    vals[`rsi_${p}`] = RSI(closes, p);
  }

  // ATR
  for (const p of [7, 14, 21]) {
    vals[`atr_${p}`] = ATR(barBuffer, p);
  }

  // VWAP: session-resetting at 18:00 ET Globex boundary (parity with backtester
  // compute_vwap_with_bands/_assign_globex_session_id in core.py). The bar buffer
  // resets at ET midnight (toEasternDateString), NOT 18:00 ET —
  // filterToGlobexSession() corrects this so VWAP spans only the current CME
  // trading session, eliminating pre-session bars from contaminating the anchor.
  const sessionBarsForVwap = filterToGlobexSession(barBuffer);
  vals["vwap"] = sessionBarsForVwap.length > 0 ? VWAP(sessionBarsForVwap) : NaN;

  // post-m3-paper-execution-lifecycle wave (2026-07-17) HIGH fix: this function's own comment
  // above (and the "Order Flow Layer" doc, CLAUDE.md §2b) referenced compute_vwap_with_bands()
  // as the parity target for VWAP itself, but the 1σ/2σ BAND columns it also produces were never
  // actually computed or attached here — confluence-score.ts's evalVwapAlignment() reads
  // vwap_band_1s_upper/lower (the "1-sigma band reject" branch) and scans for any key matching
  // /^anchored_vwap_/ (the anchored-retest bonus branch), and both were permanently unreachable
  // in live paper trading as a direct consequence. Wired via the new computeVwapWithBands()
  // (bit-for-bit port of core.py's running-population-variance formula) over the SAME
  // session-filtered bar set VWAP() already uses above, so vwap_band_* always agrees with vals.vwap.
  if (sessionBarsForVwap.length > 0) {
    const bands = computeVwapWithBands(sessionBarsForVwap);
    vals["vwap_band_1s_upper"] = bands.band1sUpper;
    vals["vwap_band_1s_lower"] = bands.band1sLower;
    vals["vwap_band_2s_upper"] = bands.band2sUpper;
    vals["vwap_band_2s_lower"] = bands.band2sLower;

    // Anchored VWAP: the backtester's compute_anchored_vwap() takes an arbitrary
    // caller-supplied anchor_ts (e.g. a specific ICT swing point) — that per-strategy DSL
    // config is not available inside this pure indicator function, which only receives the raw
    // bar buffer. The one anchor point this function CAN derive honestly (not fabricated) is the
    // current CME Globex session's own open — by definition, session VWAP (computed above from
    // sessionBarsForVwap, which already starts at the session's first bar) IS a VWAP anchored at
    // session open. Exposing it under the documented anchored_vwap_<iso> key convention makes
    // evalVwapAlignment's retest-scan branch genuinely reachable for the session-anchor case;
    // a full arbitrary-swing-point anchor (matching the backtester's per-strategy anchor_ts) is a
    // separate, larger DSL-wiring change and is NOT claimed here — see the wave's completion
    // report for this scoping decision.
    const sessionOpenTs = sessionBarsForVwap[0]?.timestamp;
    if (sessionOpenTs) {
      const iso = new Date(sessionOpenTs).toISOString().replace(/[:.]/g, "_");
      vals[`anchored_vwap_${iso}`] = bands.vwap;
    }
  }

  // Companion fix: confluence-score.ts's evalVwapAlignment() reads ctx.indicators["atr"] (a
  // single unscoped key) to gate the anchored-VWAP retest bonus (0.5×ATR proximity check) — this
  // function has only ever emitted atr_7/atr_14/atr_21 (period-suffixed), so that gate was ALSO
  // permanently unreachable (atrHalf stayed null) independent of the vwap_band_*/anchored_vwap_*
  // fix above. Alias the canonical 14-period ATR (the period used everywhere else in this
  // codebase as "the" ATR — see CLAUDE.md §4 stop-geometry, all default to ATR-14) so the retest
  // branch's ATR gate is finally satisfiable. Purely additive — no existing atr_* key is touched.
  vals["atr"] = vals["atr_14"];

  // Bollinger Bands at common periods
  for (const p of [20]) {
    for (const sd of [2]) {
      const bb = BollingerBands(closes, p, sd);
      vals[`bbands_${p}_upper`] = bb.upper;
      vals[`bbands_${p}_middle`] = bb.middle;
      vals[`bbands_${p}_lower`] = bb.lower;
    }
  }

  // Current bar values for expression evaluation
  const currentBar = barBuffer[barBuffer.length - 1];
  if (currentBar) {
    vals["open"] = currentBar.open;
    vals["high"] = currentBar.high;
    vals["low"] = currentBar.low;
    vals["close"] = currentBar.close;
    vals["volume"] = currentBar.volume;
  }

  // volume_rolling_mean_20: 20-bar rolling mean of bar volume.
  // Enables evalDeltaOrVolumeSignature (delta_or_volume_signature factor, weight 0.08)
  // to evaluate the volume spike condition rather than falling through to
  // "volume_rolling_mean_unavailable_pending_accumulation".
  // Parity: matches backtester rolling mean over the last 20 bars.
  // Absent for the first 19 bars of any session — that is expected and handled by
  // evalDeltaOrVolumeSignature's existing fallback path.
  const volSeries = barBuffer
    .map((b) => b.volume)
    .filter((v) => Number.isFinite(v));
  if (volSeries.length >= 20) {
    vals["volume_rolling_mean_20"] =
      volSeries.slice(-20).reduce((s, v) => s + v, 0) / 20;
  }

  return vals;
}

// ─── Signal Expression Evaluation ───────────────────────────

/**
 * Evaluate a signal expression against computed indicator values.
 * Supports:
 *   - "close > sma_20"
 *   - "rsi_14 < 30"
 *   - "cross_above(sma_10, sma_20)"
 *   - "cross_below(ema_12, ema_26)"
 *   - Operators: >, <, >=, <=
 */
export function evaluateExpression(
  expr: string,
  current: IndicatorValues,
  previous: IndicatorValues | null
): boolean {
  const trimmed = expr.trim();

  // Handle cross_above(a, b) and cross_below(a, b)
  const crossMatch = trimmed.match(/^(cross_above|cross_below)\(\s*(\w+)\s*,\s*(\w+)\s*\)$/);
  if (crossMatch) {
    if (!previous) return false; // Need previous bar for crossover
    const [, crossType, leftKey, rightKey] = crossMatch;
    const curLeft = current[leftKey];
    const curRight = current[rightKey];
    const prevLeft = previous[leftKey];
    const prevRight = previous[rightKey];
    if ([curLeft, curRight, prevLeft, prevRight].some((v) => v === undefined || isNaN(v))) {
      return false;
    }
    if (crossType === "cross_above") {
      return prevLeft <= prevRight && curLeft > curRight;
    } else {
      return prevLeft >= prevRight && curLeft < curRight;
    }
  }

  // Handle comparison operators: >=, <=, >, <
  const compMatch = trimmed.match(/^(\w+)\s*(>=|<=|>|<)\s*(.+)$/);
  if (!compMatch) {
    logger.warn({ expr }, "Unable to parse signal expression");
    return false;
  }

  const [, leftToken, operator, rightToken] = compMatch;
  const leftVal = resolveToken(leftToken.trim(), current);
  const rightVal = resolveToken(rightToken.trim(), current);

  if (isNaN(leftVal) || isNaN(rightVal)) return false;

  switch (operator) {
    case ">":
      return leftVal > rightVal;
    case "<":
      return leftVal < rightVal;
    case ">=":
      return leftVal >= rightVal;
    case "<=":
      return leftVal <= rightVal;
    default:
      return false;
  }
}

function resolveToken(token: string, indicators: IndicatorValues): number {
  // Try as indicator key
  if (token in indicators) return indicators[token];
  // Try as numeric literal
  const num = parseFloat(token);
  if (!isNaN(num)) return num;
  return NaN;
}

function evaluateRules(
  rules: string[],
  current: IndicatorValues,
  previous: IndicatorValues | null
): boolean {
  if (rules.length === 0) return false;
  // All rules must pass (AND logic)
  return rules.every((rule) => evaluateExpression(rule, current, previous));
}

// ─── Session Time Filters ───────────────────────────────────

interface SessionWindow {
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
  crossesMidnight: boolean;
}

// isUsDst is imported from src/server/lib/dst-utils.ts (shared utility).
// Removed duplicate inline implementation — see Fix 1 consolidation.

function getSessionWindows(date: Date): Record<string, SessionWindow> {
  const dst = isUsDst(date);
  // NY RTH: 9:30-16:00 ET → EDT=UTC-4, EST=UTC-5
  const nyOffset = dst ? 4 : 5;
  return {
    NY_RTH: { startHour: 9 + nyOffset, startMinute: 30, endHour: 16 + nyOffset, endMinute: 0, crossesMidnight: false },
    London: { startHour: 8, startMinute: 0, endHour: 16, endMinute: 30, crossesMidnight: false },
    Asia: { startHour: 23, startMinute: 0, endHour: 6, endMinute: 0, crossesMidnight: true },
  };
}

function isWithinSession(timestamp: string, preferredSessions?: string[]): boolean {
  const sessions = preferredSessions?.length ? preferredSessions : ["NY_RTH"];
  const date = new Date(timestamp);
  const sessionWindows = getSessionWindows(date);
  const utcHour = date.getUTCHours();
  const utcMinute = date.getUTCMinutes();
  const timeVal = utcHour * 60 + utcMinute;

  for (const sessionName of sessions) {
    const window = sessionWindows[sessionName];
    if (!window) continue;

    const startVal = window.startHour * 60 + window.startMinute;
    const endVal = window.endHour * 60 + window.endMinute;

    if (window.crossesMidnight) {
      // e.g. Asia: 23:00-06:00 — in-session if >= start OR < end
      if (timeVal >= startVal || timeVal < endVal) return true;
    } else {
      if (timeVal >= startVal && timeVal < endVal) return true;
    }
  }

  return false;
}

// ─── 2.7: TS Indicator Name Set ─────────────────────────────
// These are all indicator names that `computeIndicators()` produces.
// Any indicator name referenced in strategy rules that is NOT in this set
// will be delegated to the Python ICT bridge.

const TS_INDICATOR_NAMES: ReadonlySet<string> = new Set([
  // SMA
  "sma_5", "sma_10", "sma_20", "sma_50", "sma_100", "sma_200",
  // EMA
  "ema_5", "ema_9", "ema_12", "ema_20", "ema_26", "ema_50",
  // RSI
  "rsi_7", "rsi_14", "rsi_21",
  // ATR
  "atr_7", "atr_14", "atr_21",
  // post-m3-paper-execution-lifecycle wave (2026-07-17): bare "atr" alias (= atr_14) — see
  // computeIndicators()'s companion fix comment for why confluence-score.ts needs this key.
  "atr",
  // VWAP
  "vwap",
  // post-m3-paper-execution-lifecycle wave (2026-07-17) HIGH fix: computeIndicators() now
  // actually emits these (previously dead per confluence-score.ts's evalVwapAlignment finding) —
  // listed here too so a strategy DSL rule literally referencing one of them resolves locally
  // instead of being incorrectly flagged "unknown" and delegated to the Python ICT bridge.
  // anchored_vwap_<iso> is intentionally excluded — its suffix is a dynamic per-session
  // timestamp, not a static name this Set can enumerate.
  "vwap_band_1s_upper", "vwap_band_1s_lower", "vwap_band_2s_upper", "vwap_band_2s_lower",
  // Bollinger Bands
  "bbands_20_upper", "bbands_20_middle", "bbands_20_lower",
  // Current bar OHLCV
  "open", "high", "low", "close", "volume",
]);

/**
 * Extract all indicator token names referenced in a set of rule expressions.
 * Returns only tokens that are not numeric literals.
 */
function extractIndicatorNames(rules: string[]): Set<string> {
  const names = new Set<string>();
  for (const rule of rules) {
    // Match cross functions: cross_above(a, b), cross_below(a, b)
    const crossMatch = rule.trim().match(/^(?:cross_above|cross_below)\(\s*(\w+)\s*,\s*(\w+)\s*\)$/);
    if (crossMatch) {
      names.add(crossMatch[1]);
      names.add(crossMatch[2]);
      continue;
    }
    // Match comparison: left_token OP right_token_or_literal
    const compMatch = rule.trim().match(/^(\w+)\s*(?:>=|<=|>|<)\s*(.+)$/);
    if (compMatch) {
      const leftToken = compMatch[1].trim();
      const rightToken = compMatch[2].trim();
      if (isNaN(parseFloat(leftToken))) names.add(leftToken);
      if (isNaN(parseFloat(rightToken))) names.add(rightToken);
    }
  }
  return names;
}

/**
 * Check if a strategy config references any ICT indicators not in the TS set.
 * Returns the set of unknown indicator names.
 */
function findUnknownIndicators(config: StrategyConfig): Set<string> {
  const allRules = [...(config.entry_rules ?? []), ...(config.exit_rules ?? [])];
  const referenced = extractIndicatorNames(allRules);
  const unknown = new Set<string>();
  for (const name of referenced) {
    if (!TS_INDICATOR_NAMES.has(name)) {
      unknown.add(name);
    }
  }
  return unknown;
}

/**
 * Fetch ICT indicator values for a bar from the Python engine.
 * Results are cached per (sessionId, symbol, barTimestamp) to avoid redundant subprocess calls.
 *
 * The Python bridge accepts a bar buffer as JSON, computes the requested indicators,
 * and returns a flat dict of { indicator_name: float }.
 *
 * Returns an empty object if the Python call fails — fail-open: strategy evaluation
 * continues with NaN for missing indicators (which causes rules to return false, not crash).
 */
async function fetchICTIndicators(
  sessionId: string,
  symbol: string,
  barTimestamp: string,
  barBuffer: Bar[],
  unknownNames: Set<string>,
): Promise<ICTBridgeResult> {
  const cacheKey = `${sessionId}:${symbol}:${barTimestamp}`;
  const cached = ictIndicatorCache.get(cacheKey);
  if (cached) return { values: cached, bridgeHealthy: true };

  try {
    const { runPythonModule } = await import("../lib/python-runner.js");
    // Pass the last 200 bars (sufficient for all ICT indicators) and the list
    // of requested indicator names.  The Python bridge selects which functions
    // to run based on the name list.
    const barsToSend = barBuffer.slice(-200);
    const result = await runPythonModule<Record<string, number>>({
      module: "src.engine.indicators.paper_bridge",
      config: {
        bars: barsToSend,
        requested: Array.from(unknownNames),
        symbol,
      },
      timeoutMs: 8_000,
      componentName: "ict-indicator-bridge",
    });

    // Validate: only accept numeric values, discard nulls/NaN strings
    const validated: IndicatorValues = {};
    for (const [k, v] of Object.entries(result)) {
      if (typeof v === "number" && isFinite(v)) {
        validated[k] = v;
      }
    }

    // Fix 4.5: Detect bridge-succeeded-but-returned-all-NaN case.
    // If every requested indicator came back non-finite, treat it as a bridge failure:
    // the bridge ran but produced no usable values (e.g. Python returned NaN for all
    // requested names).  Emit alert + log entry so the outage is visible.
    const requestedNames = Array.from(unknownNames);
    const allNaN = requestedNames.length > 0 && requestedNames.every(name => !(name in validated));
    if (allNaN) {
      const nanError = "ICT bridge returned NaN/null for all requested indicators — possible bridge outage";
      logger.error({ sessionId, symbol, barTimestamp, requestedNames }, nanError);
      broadcastSSE("alert:ict_bridge_down", { sessionId, symbol, error: nanError });
      try {
        await db.insert(paperSignalLogs).values({
          sessionId,
          symbol,
          direction: "long",   // placeholder — not a real signal direction
          signalType: "ict_bridge_failure",
          price: "0",
          indicatorSnapshot: { requested: requestedNames.join(","), bridgeResult: "all_nan" } as Record<string, unknown>,
          acted: false,
          reason: nanError,
        });
      } catch (logErr) {
        logger.error({ logErr, sessionId }, "Failed to persist ict_bridge_failure signal log");
      }
      ictIndicatorCache.set(cacheKey, validated);
      return { values: validated, bridgeHealthy: false, error: nanError };
    }

    ictIndicatorCache.set(cacheKey, validated);
    return { values: validated, bridgeHealthy: true };
  } catch (err) {
    // Fix 4.5: Bridge subprocess failed entirely (timeout, crash, spawn error).
    // Emit SSE alert and persist a paper_signal_logs entry so the outage is
    // visible in the dashboard and queryable for post-session diagnosis.
    // Continue with fail-open behaviour (return empty — rules evaluate to false).
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error({ sessionId, symbol, barTimestamp, err }, "ICT indicator bridge failed — unknown indicators will be NaN");
    broadcastSSE("alert:ict_bridge_down", { sessionId, symbol, error: errMsg });
    try {
      await db.insert(paperSignalLogs).values({
        sessionId,
        symbol,
        direction: "long",   // placeholder — not a real signal direction
        signalType: "ict_bridge_failure",
        price: "0",
        indicatorSnapshot: { error: errMsg } as Record<string, unknown>,
        acted: false,
        reason: errMsg,
      });
    } catch (logErr) {
      logger.error({ logErr, sessionId }, "Failed to persist ict_bridge_failure signal log");
    }
    const empty: IndicatorValues = {};
    ictIndicatorCache.set(cacheKey, empty);
    return { values: empty, bridgeHealthy: false, error: errMsg };
  }
}

// ─── Stop-Loss Check ────────────────────────────────────────

/**
 * Evaluate whether a stop-loss has been hit for an open position.
 *
 * Exported for unit testing only — callers outside this module should not
 * import this function directly.
 *
 * Stop types:
 *   "atr"            — dynamic: stop DISTANCE = multiplier × ATR
 *   "fixed"          — static: stop DISTANCE = config.amount (subtracted from entryPrice)
 *   "absolute_level" — static: stop LEVEL = config.level (exact price, not a distance)
 *
 * The "absolute_level" type is used for the BE+1tick override after TP1 fills
 * (Style C). It carries the exact stop PRICE rather than a distance from entry,
 * preventing the sign inversion that the "fixed"/"atr" types produce when the
 * stop is ABOVE entry (i.e., BE+1tick for a long is entry+1tick, not entry-1tick).
 */
export function checkStopLoss(
  position: { side: string; entryPrice: string },
  bar: Bar,
  stopConfig: StopLossConfig | undefined,
  indicators: IndicatorValues
): { hit: boolean; stopPrice: number } {
  if (!stopConfig) return { hit: false, stopPrice: 0 };

  const entryPrice = Number(position.entryPrice);

  // Defect 1 fix: absolute_level carries the exact stop PRICE — no arithmetic needed.
  // Used for BE+1tick override after Style C TP1 fills (tp1BeStopMap mechanism).
  if (stopConfig.type === "absolute_level") {
    const level = stopConfig.level ?? 0;
    if (level === 0) return { hit: false, stopPrice: 0 };
    if (position.side === "long") {
      return { hit: bar.low <= level, stopPrice: level };
    } else {
      return { hit: bar.high >= level, stopPrice: level };
    }
  }

  let stopDistance: number;

  if (stopConfig.type === "atr") {
    const atrPeriod = stopConfig.atr_period ?? 14;
    // Try exact period first, then nearest precomputed period
    let atrVal = indicators[`atr_${atrPeriod}`];
    if (atrVal === undefined || isNaN(atrVal)) {
      // Fallback to nearest precomputed ATR period (7, 14, 21)
      const available = [7, 14, 21];
      const nearest = available.reduce((a, b) => Math.abs(b - atrPeriod) < Math.abs(a - atrPeriod) ? b : a);
      atrVal = indicators[`atr_${nearest}`];
      if (atrVal === undefined || isNaN(atrVal)) return { hit: false, stopPrice: 0 };
    }
    stopDistance = atrVal * (stopConfig.multiplier ?? 2);
  } else {
    // "fixed" type: amount is the distance from entry price
    stopDistance = stopConfig.amount ?? 0;
    if (stopDistance === 0) return { hit: false, stopPrice: 0 };
  }

  if (position.side === "long") {
    const stopLevel = entryPrice - stopDistance;
    return { hit: bar.low <= stopLevel, stopPrice: stopLevel };
  } else {
    const stopLevel = entryPrice + stopDistance;
    return { hit: bar.high >= stopLevel, stopPrice: stopLevel };
  }
}

// ─── 2.3: Trail Stop Check ──────────────────────────────────

/**
 * Check trailing stop for an open position.
 * Updates the high-water mark map and returns hit status + trail stop price.
 *
 * For longs:  HWM = max(high) seen since open.  Trail level = HWM - (atr_mult × ATR).
 *             Hit when bar.low <= trail level.
 * For shorts: HWM = min(low)  seen since open.  Trail level = HWM + (atr_mult × ATR).
 *             Hit when bar.high >= trail level.
 */
function checkTrailStop(
  position: { id: string; side: string; entryPrice: string; entryTime: Date; symbol?: string },
  bar: Bar,
  trailConfig: TrailStopConfig,
  indicators: IndicatorValues,
  stopLossConfig?: StopLossConfig,
): { hit: boolean; stopPrice: number; newHWM: number | null } {
  const atrPeriod = trailConfig.atr_period ?? 14;
  let atrVal = indicators[`atr_${atrPeriod}`];
  if (atrVal === undefined || isNaN(atrVal)) {
    const available = [7, 14, 21];
    const nearest = available.reduce((a, b) => Math.abs(b - atrPeriod) < Math.abs(a - atrPeriod) ? b : a);
    atrVal = indicators[`atr_${nearest}`];
    if (atrVal === undefined || isNaN(atrVal)) return { hit: false, stopPrice: 0, newHWM: null };
  }

  const posId = position.id;

  // W5b Tier 5.1: delegate to extended function when break_even or time_decay fields are set
  if (
    trailConfig.break_even_at_r != null ||
    trailConfig.time_decay_minutes != null
  ) {
    // Compute initial risk points from stopLossConfig if available, else fall back to 1x ATR
    let initialRiskPoints: number;
    const entryPrice = Number(position.entryPrice);
    if (stopLossConfig) {
      if (stopLossConfig.type === "fixed" && stopLossConfig.amount != null) {
        initialRiskPoints = stopLossConfig.amount;
      } else {
        // ATR-based stop: risk = multiplier * ATR
        initialRiskPoints = atrVal * (stopLossConfig.multiplier ?? 2);
      }
    } else {
      // No stop config → use 1x ATR as fallback risk measure
      initialRiskPoints = atrVal;
    }

    const minutesOpen = (bar.timestamp
      ? (new Date(bar.timestamp).getTime() - position.entryTime.getTime()) / 60000
      : 0);

    const currentHWM = trailStopHWM.get(posId) ?? null;
    const symbol = position.symbol ?? "MES";

    const result = checkTrailStopExtended(trailConfig, {
      positionId: posId,
      side: position.side as "long" | "short",
      entryPrice,
      initialRiskPoints,
      atrValue: atrVal,
      currentHigh: bar.high,
      currentLow: bar.low,
      minutesOpen,
      currentHWM,
      symbol,
    });

    trailStopHWM.set(posId, result.newHWM);
    return { hit: result.hit, stopPrice: result.stopPrice, newHWM: result.newHWM };
  }

  // ─── Legacy path (no W5b fields) — behavior identical to pre-W5b ─────────
  const mult = trailConfig.atr_multiple;

  if (position.side === "long") {
    // Update HWM: track highest high seen
    const prevHWM = trailStopHWM.get(posId);
    const newHWM = prevHWM === undefined ? bar.high : Math.max(prevHWM, bar.high);
    trailStopHWM.set(posId, newHWM);
    const trailLevel = newHWM - mult * atrVal;
    return { hit: bar.low <= trailLevel, stopPrice: trailLevel, newHWM };
  } else {
    // For shorts: track lowest low seen
    const prevHWM = trailStopHWM.get(posId);
    const newHWM = prevHWM === undefined ? bar.low : Math.min(prevHWM, bar.low);
    trailStopHWM.set(posId, newHWM);
    const trailLevel = newHWM + mult * atrVal;
    return { hit: bar.high >= trailLevel, stopPrice: trailLevel, newHWM };
  }
}

// ─── Previous Indicator Cache (for crossover detection) ─────

const previousIndicators = new Map<string, IndicatorValues>();

// ─── 2.3: Trail Stop High-Water Mark ────────────────────────
// Keyed by position ID.  Tracks the most favourable price seen since open.
// For longs: HWM = max(high) since entry.  For shorts: HWM = min(low) since entry.
// Cleaned up on position close.

const trailStopHWM = new Map<string, number>();

// ─── 2.4: Bars-Held Counter ──────────────────────────────────
// Keyed by position ID.  Incremented on each bar tick while the position is open.
// Cleaned up on position close.

const positionBarsHeld = new Map<string, number>();

// ─── C-3: Style C TP1 BE-stop tracking ──────────────────────
// When price crosses TP1 (+1R), the stop is moved to break-even + 1 tick.
// This map stores the BE+1tick stop LEVEL (not distance) per position ID.
// NULL = TP1 not yet crossed. Populated on TP1 cross, cleared on position close.
// Persisted to DB via paper_positions.tp1_filled_at (migration 0130).
// Contract reduction (33% partial close) is carry-forward:
// see docs/style-c-partials-carry-forward.md for TP2+runner implementation plan.
const tp1BeStopMap = new Map<string, number>();

/**
 * Restore in-memory position state after a server restart.
 * Called by the scheduler during paper session resume.
 */
export function restorePositionState(
  positions: { id: string; trailHwm: string | null; barsHeld: number; tp1FilledAt?: Date | null }[],
): void {
  for (const pos of positions) {
    if (pos.trailHwm != null) {
      trailStopHWM.set(pos.id, Number(pos.trailHwm));
    }
    if (pos.barsHeld > 0) {
      positionBarsHeld.set(pos.id, pos.barsHeld);
    }
    // C-3: tp1_filled_at in DB signals TP1 was already crossed before restart.
    // We cannot reconstruct the exact BE stop level without the entry price here,
    // so we leave tp1BeStopMap unset; the next bar's TP1 check will re-detect it
    // from tp1FilledAt on the position row. See evaluateSignals TP1 logic.
  }
}

// ─── 2.7: Python ICT Indicator Cache ────────────────────────
// Keyed by "<sessionId>:<symbol>:<barTimestamp>".
// Avoids spawning a new Python subprocess for every bar when the same bar is
// processed by multiple evaluation paths.

const ictIndicatorCache = new Map<string, IndicatorValues>();

// ─── H2: Initialize position state maps from DB ──────────────
// Called at server startup (or when a session resumes) so that trail-stop HWM
// and bars-held counters survive process restarts.  Both maps are the hot path
// (read every bar), but are persisted to DB on every update.
//
// Only open positions (closedAt IS NULL) are loaded — closed positions no longer
// need their counters and are excluded to keep the maps lean.

export async function initializePositionStateMaps(): Promise<void> {
  try {
    const openPositions = await db
      .select({
        id: paperPositions.id,
        trailHwm: paperPositions.trailHwm,
        barsHeld: paperPositions.barsHeld,
      })
      .from(paperPositions)
      .where(isNull(paperPositions.closedAt));

    let loaded = 0;
    for (const pos of openPositions) {
      if (pos.trailHwm !== null && pos.trailHwm !== undefined) {
        trailStopHWM.set(pos.id, Number(pos.trailHwm));
        loaded++;
      }
      if (pos.barsHeld !== null && pos.barsHeld !== undefined) {
        positionBarsHeld.set(pos.id, pos.barsHeld);
      }
    }
    logger.info(
      { openPositions: openPositions.length, hwmLoaded: loaded },
      "Position state maps initialized from DB",
    );
  } catch (err) {
    logger.error({ err }, "Failed to initialize position state maps from DB — in-memory state starts empty");
  }
}

// ─── Signal Log (persisted to DB + broadcast via SSE) ────────

async function logSignal(entry: SignalLogEntry): Promise<void> {
  logger.debug({ signalLog: entry }, "Signal evaluated");
  broadcastSSE("paper:signal", entry);

  // Persist to paper_signal_logs for post-session analysis
  if (entry.entrySignal || entry.exitSignal || entry.stopHit) {
    try {
      const direction = entry.strategySide; // actual strategy side, not hardcoded
      const acted = entry.action !== "none";
      let reason: string | null = null;
      if (!acted) {
        if (entry.fillMiss) reason = "fill_probability_miss";
        else if (entry.cooldownActive) reason = "cooldown";
        else if (entry.sessionFiltered) reason = "session_filter";
        else if (entry.windowFiltered) reason = "window_filter";  // W23H.3
        else if (entry.riskGatePassed === false) reason = "risk_gate_rejected";
      }
      if (entry.action === "close_stop") reason = "stop_loss";
      if (entry.action === "close_trail") reason = "trail_stop";
      if (entry.action === "close_time") reason = "max_hold_bars";

      // Map action to signalType enum
      let signalType: string;
      if (entry.action === "close_stop" || entry.action === "close_trail") {
        signalType = "stop_loss";
      } else if (entry.action === "close_signal" || entry.action === "close_time") {
        signalType = "exit";
      } else if (entry.action === "open") {
        signalType = "entry";
      } else {
        signalType = entry.exitSignal ? "exit" : "entry";
      }

      await db.insert(paperSignalLogs).values({
        sessionId: entry.sessionId,
        symbol: entry.symbol,
        direction,
        signalType,
        price: String(entry.barClose),
        indicatorSnapshot: entry.indicators,
        acted,
        reason,
      });
    } catch (err) {
      logger.error({ err, sessionId: entry.sessionId }, "Failed to persist signal log");
    }
  }
}

// ─── Bar Duration Helper ─────────────────────────────────────

function getBarDurationMs(session: CachedSession): number {
  const tf = session.timeframe.toLowerCase();
  const match = tf.match(/^(\d+)(m|h|d)$/);
  if (!match) return 60_000; // default 1 min
  const [, numStr, unit] = match;
  const num = parseInt(numStr, 10);
  switch (unit) {
    case "m": return num * 60_000;
    case "h": return num * 3_600_000;
    case "d": return num * 86_400_000;
    default: return 60_000;
  }
}

// ─── Cooldown Persistence Helper ─────────────────────────────

async function setCooldown(sessionId: string, sessionConfig: CachedSession, cooldownBars: number): Promise<void> {
  sessionConfig.cooldownRemaining = cooldownBars;
  // Estimate bar duration from strategy timeframe (fallback to 1 min if unknown)
  const barDurationMs = getBarDurationMs(sessionConfig);
  const cooldownUntil = new Date(Date.now() + cooldownBars * barDurationMs);
  try {
    await db.update(paperSessions).set({
      lastSignalTime: new Date(),
      cooldownUntil,
    }).where(eq(paperSessions.id, sessionId));
  } catch (err) {
    logger.error({ err, sessionId }, "Failed to persist cooldown");
  }
}

// ─── Main Entry Point ───────────────────────────────────────

/**
 * Called on each new bar for an active paper session.
 * Evaluates strategy signals and auto-executes via paper engine.
 */
export async function evaluateSignals(
  sessionId: string,
  symbol: string,
  bar: Bar,
  barBuffer: Bar[],
  context?: { correlationId?: string },
): Promise<void> {
  // FIX MED-2 (2026-06-29): self-generate correlationId when caller omits it.
  // Previously: context?.correlationId was always undefined → paper_trades.correlation_id
  // was always NULL (migration 0180 column never populated). Now every bar cycle
  // threads a real UUID through all downstream audit rows + closePosition + paper_trades.
  const correlationId = context?.correlationId ?? randomUUID();
  const span = tracer.startSpan("paper.signal_evaluation");
  span.setAttribute("symbol", symbol);
  span.setAttribute("session_id", sessionId);

  try {
  // Single DB query for pause + cooldown + mode check
  // P1-6: also fetch firmId for firm contract cap enforcement
  const [sessionRow] = await db.select({
    status: paperSessions.status,
    cooldownUntil: paperSessions.cooldownUntil,
    mode: paperSessions.mode,
    firmId: paperSessions.firmId,
    config: paperSessions.config,
    // Wave 23.C C.6: HWM for risk-derived pyramid sizing
    // Pass 5 Track C F-2: read realizedPeakEquity — kept current atomically
    // by closePosition; highWaterBalance is MTM-stale and oscillates.
    highWaterBalance: paperSessions.highWaterBalance,
    realizedPeakEquity: paperSessions.realizedPeakEquity,
    currentEquity: paperSessions.currentEquity,
    // W23H.4: needed for cumulativeProfit and accountStartingFloor
    startingCapital: paperSessions.startingCapital,
    // Balanced scaling plan: monotonic winning-trade count for proven-trades ramp.
    // Read here so live sizing reflects the ramp while backtests (which don't pass it)
    // keep the dollar-profit fallback in computeRiskDerivedContracts.
    provenTradesCount: paperSessions.provenTradesCount,
  }).from(paperSessions).where(eq(paperSessions.id, sessionId));

  // Skip if session doesn't exist or is paused/stopped
  if (!sessionRow || sessionRow.status !== "active") return;

  const sessionConfig = await getSessionConfig(sessionId);
  if (!sessionConfig) {
    logger.warn({ sessionId }, "No strategy config found for paper session");
    return;
  }

  // ─── Fix 4: Parity divergence warning (once per session) ────────────────
  // Paper enforces skip engine + anti-setup gates unconditionally.
  // Backtest defaults TF_BACKTEST_SKIP_MODE=off, TF_BACKTEST_ANTI_SETUP_MODE=off.
  // The DEPLOY_READY gate compares paper Sharpe (filtered) vs backtest Sharpe
  // (unfiltered) — apples-to-oranges; paper quality is systematically
  // underestimated relative to what backtest reports.
  // ACTION: set TF_BACKTEST_SKIP_MODE=enforce to align backtest filters with paper.
  if (!parityWarnedSessions.has(sessionId)) {
    parityWarnedSessions.add(sessionId);
    logger.warn(
      {
        sessionId,
        strategyId: sessionConfig.strategyId,
        parity_gap: "skip_and_anti_setup_gates",
        resolution: "set TF_BACKTEST_SKIP_MODE=enforce to align",
      },
      "PARITY WARNING: Paper engine enforces skip + anti-setup gates that backtest does NOT enforce by default. " +
      "DEPLOY_READY Sharpe comparison may underestimate strategy quality. " +
      "Set TF_BACKTEST_SKIP_MODE=enforce to align.",
    );
  }

  // ─── Wave 23.C C.1: Session-start bias engine invocation ─────────────────
  // Fire-and-forget cache prime: on the first bar seen for this session × day,
  // ensure the bias_state row exists in DB for today's session date × symbol.
  // The result is cached in-process so subsequent bars are sub-millisecond reads.
  // Fail-open: a bias engine failure never blocks signal evaluation.
  // Not pipeline-gated: bias computation is an observability/promotion-gate input
  // that must run even when the trading pipeline is paused (same pattern as crons).
  let biasState: BiasStateForSignal | null = null;

  // ─── Trade-critique data bridge (2026-07-05) ─────────────────────────────
  // Captures whichever entry-time decision-context fields the deciding signal
  // actually knows during Stage 2 evaluation below, so a passing signal can carry
  // them into pendingEntryQueue -> openPosition() -> paper_positions.exit_plan.
  // Declared at the same top-of-function scope as `biasState` (not inside the
  // Stage 2 if/else nesting) so they remain readable at the pendingEntryQueue.set()
  // call site several hundred lines below. Populated only on the path that
  // actually computed them (Path C sets score + liquidity; Path A/B only sets the
  // satisfied-factor list). Never fabricated — stays null when the evaluating
  // path doesn't compute that field.
  let entryCtxConfluenceScore: number | null = null;
  let entryCtxConfluenceFactorsActive: string[] | null = null;
  let entryCtxNearestLiquidityLevel: EntryDecisionContext["nearestLiquidityLevel"] = null;
  try {
    biasState = await getOrComputeBiasStateForDay(
      bar.timestamp,
      correlationId,
      symbol,
    );
    span.setAttribute("bias_regime", biasState.regimeLabel);
    span.setAttribute("bias_playbook", biasState.playbook);
    span.setAttribute("bias_active_strategy_id", biasState.activeStrategyId ?? "none");
  } catch (biasEngineErr) {
    // Fail-open: bias state unavailable → legacy bypass path
    logger.warn(
      { err: biasEngineErr, sessionId, symbol, correlationId },
      "Wave 23.C: bias engine call failed — legacy bypass path active (fail-open)",
    );
    span.setAttribute("bias_engine_error", true);
  }

  let skipBlocked = false;   // SKIP/SIT_OUT blocks new entries
  let skipReduce = false;    // REDUCE halves position size

  // ─── Pipeline pause guard: block new entries when paused ───
  // PAUSED/VACATION mode prevents NEW orders but does NOT close open
  // positions — they continue to be managed (stop-loss, trailing stop,
  // exit signals, max-hold). This matches the user's mental model:
  // "press pause = no new orders, not kill switch."
  // Treated symmetrically with skipBlocked so all the existing entry
  // gating logic applies. Position management continues unaffected.
  const pipelinePaused = !(await isPipelineActive());
  if (pipelinePaused) {
    skipBlocked = true;
    span.setAttribute("pipeline_paused", true);
    // Persist pipeline-paused signal so the block is visible in post-session
    // analysis (matches the skip_engine_blocked log pattern).
    db.insert(paperSignalLogs).values({
      sessionId,
      symbol,
      direction: sessionConfig.config.side,
      signalType: "pipeline_paused",
      price: String(bar.close),
      indicatorSnapshot: {},
      acted: false,
      reason: "pipeline_paused: new entries blocked, open positions still managed",
    }).catch((err: unknown) => logger.error({ err, sessionId }, "Failed to persist pipeline_paused signal log"));
    logger.info({ sessionId, symbol, fn: "evaluateSignals" }, "Skipped new entries: pipeline paused");
  }

  // ─── Skip Engine Gate: respect pre-market skip decisions ───
  // If today's skip decision is SKIP or SIT_OUT, block all new entries.
  // Existing positions can still be managed (stop-loss, exit signals).
  // P1-8: Use bar timestamp for date boundary (not wall-clock) so the skip
  // decision is anchored to the bar's trading session, not server wall-clock.
  try {
    const barDate = new Date(bar.timestamp);
    const today = new Date(barDate);
    today.setUTCHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

    const [skipDecision] = await db
      .select({ decision: skipDecisions.decision, override: skipDecisions.override, reason: skipDecisions.reason })
      .from(skipDecisions)
      .where(
        and(
          eq(skipDecisions.strategyId, sessionConfig.strategyId),
          gte(skipDecisions.decisionDate, today),
          lte(skipDecisions.decisionDate, tomorrow),
        ),
      )
      .orderBy(desc(skipDecisions.createdAt))
      .limit(1);

    // Also check portfolio-wide skip decisions (strategyId is null)
    const [portfolioSkip] = await db
      .select({ decision: skipDecisions.decision, override: skipDecisions.override, reason: skipDecisions.reason })
      .from(skipDecisions)
      .where(
        and(
          isNull(skipDecisions.strategyId),
          gte(skipDecisions.decisionDate, today),
          lte(skipDecisions.decisionDate, tomorrow),
        ),
      )
      .orderBy(desc(skipDecisions.createdAt))
      .limit(1);

    const effectiveSkip = skipDecision ?? portfolioSkip;
    if (effectiveSkip && !effectiveSkip.override) {
      if (effectiveSkip.decision === "SKIP" || effectiveSkip.decision === "SIT_OUT") {
        skipBlocked = true;
        span.setAttribute("skip_decision", effectiveSkip.decision);
        logger.info(
          { sessionId, symbol, decision: effectiveSkip.decision },
          "Skip engine: blocking new entries — existing positions still managed",
        );
        // Persist skip engine block unconditionally — regardless of whether an entry
        // signal also fired on this bar.  Without this, a blocked session looks
        // identical to an idle session in the signal log and the block is invisible
        // in post-session analysis.  Use .catch() so a DB failure never stops evaluation.
        db.insert(paperSignalLogs).values({
          sessionId,
          symbol,
          direction: sessionConfig.config.side,
          signalType: "skip_engine_blocked",
          price: String(bar.close),
          indicatorSnapshot: {
            _skip_decision: effectiveSkip.decision,
            _skip_reason: effectiveSkip.reason ?? null,
          },
          acted: false,
          reason: `skip_engine_blocked: ${effectiveSkip.decision}${effectiveSkip.reason ? ` — ${effectiveSkip.reason}` : ""}`,
        }).catch((err: unknown) => logger.error({ err, sessionId }, "Failed to persist skip engine block log"));
      } else if (effectiveSkip.decision === "REDUCE") {
        skipReduce = true;
        span.setAttribute("skip_decision", "REDUCE");
      }
    }
  } catch (err) {
    // Skip check is non-blocking — proceed if DB query fails
    logger.debug({ err, sessionId }, "Skip decision check failed — proceeding");
  }

  // ─── P0-3: Skip Classifier Gate (real-time, per-bar) ─────────────────────
  // Calls skip_classifier.py classify_session() if TF_PAPER_SKIP_MODE != "off".
  // This is a second, complementary layer to the pre-market DB-based skip decisions
  // above. It uses in-process state (governor consecutive_losses, day_of_week) to
  // catch situations where the pre-market classifier didn't run (e.g. weekend restart,
  // new session started mid-day).
  //
  // Fail policy: ALWAYS fail-open. A classifier error never blocks trades — the DB-based
  // skip gate above is the hard gate. Log at error so the operator can see the issue.
  //
  // Cache: results are cached per session × ET hour to avoid per-bar Python spawns.
  if (PAPER_SKIP_MODE !== "off" && !skipBlocked) {
    try {
      const govState = getGovernorState(sessionId);
      const classifierResult = await getCachedSkipClassification(
        bar.timestamp,
        sessionId,
        sessionConfig.strategyId,
        govState,
      );

      if (PAPER_SKIP_MODE === "enforce") {
        if (classifierResult.decision === "SKIP") {
          skipBlocked = true;
          span.setAttribute("skip_classifier_decision", "SKIP");
          span.setAttribute("skip_classifier_score", classifierResult.score);
          logger.info(
            {
              sessionId, symbol,
              decision: classifierResult.decision,
              score: classifierResult.score,
              reason: classifierResult.reason,
              confidence: classifierResult.confidence,
              mode: "enforce",
            },
            "Skip classifier (P0-3): SKIP — blocking new entries",
          );
          db.insert(paperSignalLogs).values({
            sessionId,
            symbol,
            direction: sessionConfig.config.side,
            signalType: "skip_classifier_blocked",
            price: String(bar.close),
            indicatorSnapshot: {
              _skip_classifier_decision: classifierResult.decision,
              _skip_classifier_score: classifierResult.score,
              _skip_classifier_reason: classifierResult.reason,
              _skip_classifier_confidence: classifierResult.confidence,
              _skip_classifier_mode: "enforce",
            },
            acted: false,
            reason: `skip_classifier_blocked: ${classifierResult.reason}`,
          }).catch((err: unknown) => logger.error({ err, sessionId }, "Failed to persist skip_classifier block log"));
        } else if (classifierResult.decision === "REDUCE") {
          skipReduce = true;
          span.setAttribute("skip_classifier_decision", "REDUCE");
          span.setAttribute("skip_classifier_score", classifierResult.score);
          logger.info(
            {
              sessionId, symbol,
              decision: classifierResult.decision,
              score: classifierResult.score,
              reason: classifierResult.reason,
              mode: "enforce",
            },
            "Skip classifier (P0-3): REDUCE — position size will be halved",
          );
        } else {
          span.setAttribute("skip_classifier_decision", "TRADE");
        }
      } else {
        // shadow mode: log but never block
        span.setAttribute("skip_classifier_decision", classifierResult.decision);
        span.setAttribute("skip_classifier_score", classifierResult.score);
        if (classifierResult.decision !== "TRADE") {
          logger.info(
            {
              sessionId, symbol,
              decision: classifierResult.decision,
              score: classifierResult.score,
              reason: classifierResult.reason,
              confidence: classifierResult.confidence,
              mode: "shadow",
            },
            "Skip classifier (P0-3): shadow mode — would have blocked/reduced but not enforcing",
          );
          // Persist shadow decision for analysis
          db.insert(paperSignalLogs).values({
            sessionId,
            symbol,
            direction: sessionConfig.config.side,
            signalType: "skip_classifier_shadow",
            price: String(bar.close),
            indicatorSnapshot: {
              _skip_classifier_decision: classifierResult.decision,
              _skip_classifier_score: classifierResult.score,
              _skip_classifier_reason: classifierResult.reason,
              _skip_classifier_confidence: classifierResult.confidence,
              _skip_classifier_mode: "shadow",
            },
            acted: true, // trade proceeds — shadow only
            reason: `skip_classifier_shadow: ${classifierResult.reason}`,
          }).catch((err: unknown) => logger.warn({ err, sessionId }, "Failed to persist skip_classifier shadow log"));
        }
      }
    } catch (skipClassErr) {
      // Fail-open: classifier error never blocks trades
      logger.error(
        { sessionId, symbol, err: skipClassErr, mode: PAPER_SKIP_MODE },
        "Skip classifier (P0-3) error — fail-open, trading continues",
      );
      span.setAttribute("skip_classifier_error", true);
    }
  }

  const config = sessionConfig.config;
  const indicators = computeIndicators(barBuffer);
  const prevKey = `${sessionId}:${symbol}`;
  const prevIndicators = previousIndicators.get(prevKey) ?? null;

  // ─── 2.7: ICT Indicator Bridge ──────────────────────────────
  // If strategy references indicators not in the TS set, fetch them from Python
  // before evaluating rules.  Merged into the indicator map so expressions resolve.
  const unknownInds = findUnknownIndicators(config);
  let ictBridgeBlocked = false;
  if (unknownInds.size > 0) {
    const ictBridge = await fetchICTIndicators(sessionId, symbol, bar.timestamp, barBuffer, unknownInds);
    Object.assign(indicators, ictBridge.values);
    if (!ictBridge.bridgeHealthy && FAIL_CLOSED_EXECUTION) {
      ictBridgeBlocked = true;
      skipBlocked = true;
      logger.error(
        { sessionId, symbol, unknownIndicators: Array.from(unknownInds), error: ictBridge.error },
        "ICT bridge unavailable — fail-closed blocks new entries",
      );
    }
    span.setAttribute("ict_bridge_indicators", Array.from(unknownInds).join(","));
    span.setAttribute("ict_bridge_blocked", ictBridgeBlocked);
  }

  // Evaluate entry and exit rules
  const entrySignal = evaluateRules(config.entry_rules ?? [], indicators, prevIndicators);
  const exitSignal = evaluateRules(config.exit_rules ?? [], indicators, prevIndicators);

  // Session time filter
  const sessionFiltered = !isWithinSession(bar.timestamp, config.preferred_sessions);

  // ─── W23H.3: Allowed entry windows gate ──────────────────────
  // Checked before Stage 1 (same tier as session_filter — a signal outside the window
  // is a non-event, not a gate rejection). Empty list = no restriction (backward compat).
  // Fail-open: if window parsing throws at signal time, log warning and allow the signal.
  // Note: malformed specs should be caught at config-extraction time — this is defense-in-depth.
  let windowFiltered = false;
  try {
    const rawWindowSpecs = (sessionConfig.config as unknown as Record<string, unknown>).allowed_entry_windows;
    const windowSpecs = Array.isArray(rawWindowSpecs) ? (rawWindowSpecs as string[]) : [];
    if (windowSpecs.length > 0) {
      const parsedWindows = parseEntryWindows(windowSpecs);
      const barTsUtc = new Date(bar.timestamp);
      const inAnyWindow = isBarInAnyWindow(barTsUtc, parsedWindows);
      if (!inAnyWindow) {
        windowFiltered = true;
        span.setAttribute("entry_window_filtered", true);
        span.setAttribute("entry_window_specs", windowSpecs.join("|"));
        logger.info(
          { sessionId, symbol, barTimestamp: bar.timestamp, windowsConfigured: windowSpecs },
          "W23H.3: entry blocked — bar outside allowed_entry_windows",
        );
        // Emit audit event (aggregated per signal: one row per blocked bar)
        db.insert(paperSignalLogs).values({
          sessionId,
          symbol,
          direction: config.side,
          signalType: "skipped_outside_window",
          price: String(bar.close),
          indicatorSnapshot: {
            ...indicators,
            _windows_configured: windowSpecs,
            _bar_timestamp: bar.timestamp,
          },
          acted: false,
          reason: `signal.skipped_outside_window: bar at ${bar.timestamp} not in windows [${windowSpecs.join(", ")}]`,
        }).catch((err: unknown) => logger.error({ err, sessionId }, "Failed to persist window-filtered signal log"));
        // W24P1 Item 5: mirror skip to audit_log so drift detectors + Discord pipelines
        // querying `audit_log WHERE action LIKE 'signal.skipped%'` return real rows.
        insertAuditRow({
          action: "signal.skipped_outside_window",
          entityType: "signal",
          entityId: sessionId,
          decisionAuthority: "system",
          input: { sessionId, symbol, barTimestamp: bar.timestamp, windowsConfigured: windowSpecs } as Record<string, unknown>,
          result: { blocked: true, reason: "outside_allowed_entry_windows" } as Record<string, unknown>,
          status: "success",
          correlationId: correlationId ?? null,
        }).catch((err: unknown) => logger.warn({ err, sessionId }, "audit_log insert failed for signal.skipped_outside_window"));
      }
    }
  } catch (windowErr) {
    logger.warn({ err: windowErr, sessionId, symbol }, "W23H.3: entry window check error — fail-open, proceeding");
  }

  // ─── 2.5: Calendar filter ────────────────────────────────────
  // Check holidays AND FOMC/CPI/NFP ±30min blackout.
  // Fix 3: results are cached per ET hour — at most 24 Python spawns/day instead of
  // one per bar (~390 bars/day for 1m bars). Hour granularity is safe given ±30min
  // blackout windows: at most one stale hit at the hour boundary, then corrects.
  //
  // B11: bypass_news_blackout opt-in — event-driven strategies (e.g., news_fade_mcl)
  // that MUST trade during macro release windows can set bypass_news_blackout=true
  // in their DSL fixture. This bypasses the is_economic_event check ONLY (holidays
  // still block — no strategy should trade on CME-closed holidays). The bypass is
  // explicit opt-in; default is the full blackout (fail-safe for all other strategies).
  //
  // Authority: CLAUDE.md "Don't trade through FOMC/CPI/NFP without explicit event handling
  // — default is SIT_OUT ±30 min". bypass_news_blackout IS the explicit event handling.
  const bypassNewsBlackout =
    (sessionConfig.config as unknown as Record<string, unknown>).bypass_news_blackout === true;

  let calendarBlocked = false;
  let calendarBlockReason = "";
  // Phase 2 (2026-06-22) — firm-aware news caution. When a T1 event affects this product
  // and the firm is Topstep (PRIMARY, caution-not-block), we DON'T block; we carry a
  // size-reduction factor down to the sizing call instead. 1 = no reduction. Applied
  // multiplicatively alongside the PM size factor at computeRiskDerivedContracts.
  let newsReduceSizeFactor = 1;
  let newsReduceEvent = "";
  // deep-scan 2026-07-11 LOW fix (#22): C11 FOMC ±1-day advisory size-halving was computed
  // into a local `fomcReducedContracts` that was ONLY logged/span-tagged and NEVER applied to
  // the real contract count — so the FOMC taper was inert. Carry it as a factor and fold it
  // into the size chain via min() with newsReduceSizeFactor (NOT product) so a Topstep signal
  // inside the tight FOMC T1 window — which already reduces via newsReduceSizeFactor — is not
  // double-tapered. 1 = no reduction. The ±1-day-but-outside-the-tight-T1-window case (where
  // newsReduceSizeFactor stays 1) is exactly the gap this now covers.
  let fomcSizeFactor = 1;
  try {
    const calResult = await getCachedSignalCalendarStatus(bar.timestamp);

    if (calResult.is_holiday === true) {
      // Holidays always block — even bypass_news_blackout strategies cannot trade
      // when CME is closed. This is not an override path.
      calendarBlocked = true;
      calendarBlockReason = "holiday";
      logger.info({ sessionId, symbol, date: bar.timestamp }, "Calendar filter: holiday — skipping signals");
    } else {
      // AUTHORITATIVE T1 window check (Phase 3, 2026-06-23). Reads economic_release_dates
      // (FRED/Fed/EIA-synced; hardcoded fail-safe fallback) instead of the Python hardcoded
      // list, which had projected/WRONG dates (FOMC 2026 May 6/Nov 4/Dec 16 vs the Fed's
      // Apr 29/Oct 28/Dec 9; CPI off by days). Covers FOMC/FOMC_MINUTES/CPI/NFP (all/index)
      // + EIA (crude), product-scoped, T−5/+2 window. Holidays handled above (Python is
      // authoritative for CME closures). calResult.is_economic_event is intentionally NOT
      // used anymore — its dates were unreliable.
      const t1 = await getT1ReleaseWindow(symbol, bar.timestamp);
      if (t1.inWindow) {
        if (bypassNewsBlackout) {
          logger.info(
            { sessionId, symbol, event: t1.eventType, source: t1.source, timestamp: bar.timestamp, bypass: true },
            `Calendar filter: ${t1.eventType} T1 window — BYPASSED (bypass_news_blackout=true, event-driven strategy)`,
          );
          span.setAttribute("calendar_news_bypass", true);
          span.setAttribute("calendar_block_event", t1.eventType);
        } else {
          // Firm-aware: Topstep (PRIMARY) trades with caution (reduce size, never block);
          // MFFU Rapid (restricted) + unknown firm → hard-block.
          const { action, sizeFactor } = resolveNewsAction(sessionRow.firmId, true, false);
          if (action === "reduce_size") {
            newsReduceSizeFactor = sizeFactor;
            newsReduceEvent = t1.eventType;
            logger.info(
              { sessionId, symbol, firm: sessionRow.firmId, event: t1.eventType, sizeFactor, source: t1.source, timestamp: bar.timestamp },
              `Calendar filter: ${t1.eventType} T1 window — Topstep CAUTION, reducing size ×${sizeFactor} (not blocking)`,
            );
            span.setAttribute("news_reduce_size_factor", sizeFactor);
            span.setAttribute("news_reduce_event", t1.eventType);
          } else {
            calendarBlocked = true;
            calendarBlockReason = t1.eventType;
            logger.info(
              { sessionId, symbol, firm: sessionRow.firmId, event: t1.eventType, source: t1.source, timestamp: bar.timestamp },
              `Calendar filter: ${t1.eventType} T1 window — ${sessionRow.firmId ?? "unknown-firm"} HARD-BLOCK, skipping signals`,
            );
            span.setAttribute("calendar_block_event", t1.eventType);
            span.setAttribute("calendar_block_source", t1.source);
          }
        }
      }
    }
  } catch (calErr) {
    // Calendar check failed. The failure must be VISIBLE — log at error level.
    logger.error(
      { sessionId, symbol, err: calErr },
      "Calendar guard DOWN — Python calendar_filter failed",
    );
    // FIX 6 (Track M): in-process CME holiday fallback. The Python subprocess is
    // unavailable. The Tier-1 event checker already runs inside
    // getCachedSignalCalendarStatus's inner catch (FIX B) — but that inner handler
    // only fires when the Python call itself fails. The OUTER catch here fires when
    // is_holiday was never consulted (entire cal block threw). Check the static
    // CME closure table so we never trade on a full market-closure day.
    const holidayCheck = checkCmeHolidayFallback(bar.timestamp);
    if (holidayCheck.isHoliday) {
      calendarBlocked = true;
      calendarBlockReason = `holiday_fallback:${holidayCheck.holidayName ?? "unknown"}`;
      logger.warn(
        { sessionId, symbol, date: holidayCheck.date, holiday: holidayCheck.holidayName },
        "FIX 6: calendar guard DOWN — in-process CME holiday table BLOCKED (fail-CLOSED for known market closure)",
      );
      insertAuditRow({
        action: "signal.holiday_blocked_fallback",
        entityType: "signal",
        entityId: sessionId,
        decisionAuthority: "system",
        input: { sessionId, symbol, date: holidayCheck.date, holiday: holidayCheck.holidayName } as Record<string, unknown>,
        result: { blocked: true, reason: "cme_holiday_in_process_fallback", calendar_guard_down: true } as Record<string, unknown>,
        status: "success",
        correlationId: correlationId ?? null,
      }).catch((err: unknown) =>
        logger.warn({ err, sessionId }, "audit insert failed for signal.holiday_blocked_fallback"),
      );
    }
    // Broadcast SSE so the dashboard can surface a warning banner immediately.
    broadcastSSE("alert:calendar_guard_down", {
      sessionId,
      symbol,
      holidayBlocked: holidayCheck.isHoliday,
      holidayName: holidayCheck.holidayName,
      error: calErr instanceof Error ? calErr.message : String(calErr),
      timestamp: bar.timestamp,
    });
    span.setAttribute("calendar_guard_down", true);
    if (holidayCheck.isHoliday) {
      span.setAttribute("calendar_guard_down_holiday_blocked", true);
    }
    // Non-holiday: trading continues (fail-open), consistent with prior behavior.
  }

  // (Phase 3: EIA is now handled inside getT1ReleaseWindow above — product-scoped to crude
  // from the same authoritative economic_release_dates source. The standalone EIA block was
  // removed to avoid a second, divergent calendar check.)

  if (calendarBlocked) {
    // M5: Log calendar block to DB so it leaves a traceable record for post-session
    // analysis.  Without this, a blocked session looks identical to an idle session
    // in the signal logs — no way to distinguish "no signals fired" from "signals were
    // blocked by calendar".  Use .catch() so a DB failure never stops the early return.
    db.insert(paperSignalLogs).values({
      sessionId,
      symbol,
      direction: sessionConfig.config.side,
      signalType: "calendar_blocked",
      price: String(bar.close),
      indicatorSnapshot: {},
      acted: false,
      reason: `Calendar blocked: ${calendarBlockReason}`,
    }).catch((err: unknown) => logger.warn({ err }, "Failed to log calendar block to DB"));

    // ICT cache cleanup for this timestamp (no longer needed)
    ictIndicatorCache.delete(`${sessionId}:${symbol}:${bar.timestamp}`);
    span.setAttribute("calendar_blocked", true);
    span.setAttribute("calendar_block_reason", calendarBlockReason);
    span.end();
    return;
  }

  // Check for open position FIRST — needed for cooldown logic
  const [openPos] = await db
    .select()
    .from(paperPositions)
    .where(
      and(
        eq(paperPositions.sessionId, sessionId),
        eq(paperPositions.symbol, symbol),
        isNull(paperPositions.closedAt)
      )
    );

  // Cooldown check — DB-backed with in-memory fast path
  // Only decrement when no position is open (cooldown gates RE-ENTRY, not holding)
  const now = new Date();
  let cooldownActive = sessionConfig.cooldownRemaining > 0;
  if (cooldownActive && !openPos) {
    sessionConfig.cooldownRemaining--;
  } else if (!cooldownActive && sessionRow?.cooldownUntil && sessionRow.cooldownUntil > now) {
    // DB cooldown survives server restart (using already-fetched data, not extra query)
    cooldownActive = true;
  }

  let action: SignalLogEntry["action"] = "none";
  let riskGatePassed: boolean | null = null;
  let stopHit = false;
  let fillMiss = false;

  // Convenience: current ATR for passing to closePosition (2.6 exit slippage)
  const currentAtr = indicators["atr_14"];

  // Shadow mode: log signals only, never execute trades
  const isShadow = sessionRow.mode === "shadow";

  // ─── FIX 1 (B2 PARITY CRITICAL): Execute deferred entry from previous bar ──
  // backtester.py:1305 rolls signals forward 1 bar (np.roll); fills happen at
  // the open of bar N+1.  Paper fills at bar N's close — 1 bar early.
  // Fix: a signal fired on bar N stores a pending entry.  On bar N+1 we execute
  // it here, before any position-management checks, using bar N+1's close price.
  //
  // This block only fires when no position is open AND the session is not in shadow
  // mode AND no position was just opened (openPos check above is fresh).
  const pendingKey = `${sessionId}:${symbol}`;
  const pendingEntry = pendingEntryQueue.get(pendingKey);
  if (pendingEntry && !openPos && !isShadow) {
    pendingEntryQueue.delete(pendingKey); // consume the pending entry
    // M2 (2026-07-17): mirror the consume in the durability backstop — covers
    // BOTH the fill path and every drop path below (H3 gate re-check failures),
    // since this delete runs before either outcome is decided. Fire-and-forget.
    void deletePendingEntryRow(sessionId, symbol);

    // ─── H3 (2026-06-23): Re-evaluate all entry gates at fill time (bar N+1) ──
    //
    // Signal-time gates (kill-switch, lunch-blackout, FOMC/CPI/NFP, DLL, daily-
    // trade-cap, news-policy) were only evaluated at bar N when the signal was
    // QUEUED.  Conditions can change between queue and fill:
    //   • Kill switch can flip to HALT (operator action, DLL breach, CME outage)
    //   • Lunch blackout can begin (signal at 11:28 → fill at 11:30:01 ET)
    //   • FOMC/CPI/NFP window can open (signal at 09:59:58 → fill at 10:00:01)
    //   • DLL can flip over 67% (held position took heat between bars N and N+1)
    //   • Daily trade cap can reset (queued on day N, fill arrives on day N+1)
    //
    // On any drop: dequeue is already done; emit pending_entry.dropped_<reason>
    // audit row with the original correlationId and skip openPosition.
    {
      const fillTs = new Date(bar.timestamp);
      const fillCorrelationId = pendingEntry.correlationId ?? null;
      let pendingDropReason: string | null = null;

      // Gate 1: Kill switch (H6 layered, fail-CLOSED)
      // deepscan18 (2026-07-05) C-C1: pass this session's resolved account/firm
      // scope so a sibling account's breach doesn't drop THIS account's
      // already-queued fill. See kill-switch.ts::evaluateAllKillSwitchLayers.
      if (!pendingDropReason) {
        try {
          const halted = await killSwitch.isHaltedForProduction({
            correlationId: pendingEntry.correlationId,
            accountKey: resolveAccountKey(sessionRow),
            firmId: sessionRow.firmId,
          });
          if (halted) {
            pendingDropReason = "kill_switch";
          }
        } catch (_ksErr) {
          // isHaltedForProduction is already fail-CLOSED internally; belt-and-suspenders
          pendingDropReason = "kill_switch";
        }
      }

      // Gate 2: Session-day boundary check — if the fill bar is on a DIFFERENT CME
      // trading day than the signal bar, the daily-trade-cap counter has reset and
      // the signal's context is stale. Drop the queued entry unconditionally.
      if (!pendingDropReason) {
        const signalDay = toFuturesTradingDayString(new Date(pendingEntry.signalBarTimestamp));
        const fillDay = toFuturesTradingDayString(fillTs);
        if (signalDay !== fillDay) {
          pendingDropReason = "session_boundary_crossed";
        }
      }

      // Gate 3: Lunch blackout (11:30–13:30 ET) — use FILL timestamp, not queue timestamp
      if (!pendingDropReason) {
        try {
          const perStrategyDisabled =
            ((config as { entry_quality?: { lunch_blackout_disabled?: boolean } }).entry_quality
              ?.lunch_blackout_disabled) === true;
          const lunchCheck = evaluateLunchBlackoutGate({
            barTsUtc: fillTs,
            startEt: getLunchBlackoutStartEnvDefault(),
            endEt: getLunchBlackoutEndEnvDefault(),
            perStrategyDisabled,
          });
          if (lunchCheck.block) {
            pendingDropReason = "lunch_blackout";
          }
        } catch (_lunchErr) {
          // Fail-CLOSED — lunch blackout gate error means we cannot confirm the window
          // is clear. Drop the entry (consistent with signal-time fail-CLOSED policy).
          pendingDropReason = "lunch_blackout";
        }
      }

      // Gate 4: FOMC/CPI/NFP macro blackout — use FILL timestamp
      //
      // CF4 (2026-06-24): When action === "reduce_size" (Topstep/MFFU caution), multiply
      // pendingEntry.contracts by the sizeFactor (default 0.5). If the result rounds down
      // to 0 contracts, DROP the entry with audit pending_entry.dropped_news_size_reduced_to_zero
      // (info severity — correct capital-safety behavior). Otherwise emit
      // pending_entry.contracts_reduced_news_window info audit with original + reduced counts.
      //
      // NOTE: we modify pendingEntry.contracts in-place here so the subsequent openPosition
      // call uses the reduced count transparently. The original count is captured first for
      // the audit trail.
      if (!pendingDropReason) {
        try {
          const bypassNewsBlackout =
            (sessionConfig.config as unknown as Record<string, unknown>).bypass_news_blackout === true;
          if (!bypassNewsBlackout) {
            const t1Check = await getT1ReleaseWindow(symbol, bar.timestamp);
            if (t1Check.inWindow) {
              const { action: newsAction, sizeFactor } = resolveNewsAction(sessionRow.firmId, true, false);
              if (newsAction === "block") {
                pendingDropReason = "macro_blackout";
              } else if (newsAction === "reduce_size" && !pendingEntry.newsReducedAtSignalTime) {
                // CF4: Apply NEWS_REDUCE_SIZE_FACTOR at fill time ONLY when the signal was queued
                // OUTSIDE the T1 window (signal-time sizing did NOT already reduce). deep-scan
                // 2026-07-11 MED fix (#9): the `&& !pendingEntry.newsReducedAtSignalTime` guard prevents
                // the double ×0.5 (→ 0.25× base, or a silent drop to 0 for small base sizes) when BOTH
                // the signal and the fill fall inside the same window. If already reduced at signal
                // time, the entry proceeds with its already-reduced contracts (no fill-time change).
                const originalContracts = pendingEntry.contracts;
                const reducedContracts = Math.floor(originalContracts * sizeFactor);
                if (reducedContracts <= 0) {
                  // Sizing reduced to zero — drop the entry (correct capital-safety behavior).
                  // The generic pendingDropReason handler below emits pending_entry.dropped_news_size_reduced_to_zero.
                  pendingDropReason = "news_size_reduced_to_zero";
                } else {
                  // Apply the reduction and allow through.
                  pendingEntry.contracts = reducedContracts;
                  span.setAttribute("news_reduce_size_factor_at_fill", sizeFactor);
                  span.setAttribute("news_reduced_contracts_original", originalContracts);
                  span.setAttribute("news_reduced_contracts_fill", reducedContracts);
                  insertAuditRow({
                    action: "pending_entry.contracts_reduced_news_window",
                    entityType: "paper_session",
                    entityId: sessionId,
                    decisionAuthority: "system",
                    status: "info",
                    input: {
                      sessionId,
                      symbol,
                      side: pendingEntry.side,
                      originalContracts,
                      sizeFactor,
                    } as Record<string, unknown>,
                    result: { reducedContracts } as Record<string, unknown>,
                    correlationId: fillCorrelationId,
                  }).catch((e: unknown) => {
                    logger.warn({ e, action: "pending_entry.contracts_reduced_news_window" }, "audit write failed — non-blocking");
                    auditWriteFailuresTotal.labels({ action: "pending_entry.contracts_reduced_news_window" }).inc();
                  });
                  logger.info(
                    {
                      sessionId,
                      symbol,
                      originalContracts,
                      reducedContracts,
                      sizeFactor,
                      correlationId: fillCorrelationId,
                    },
                    "CF4: Pending entry contracts reduced at fill time due to T1 news window (reduce_size action)",
                  );
                }
              }
              // action === "allow": fill proceeds unchanged — no modification.
            }
          }
        } catch (_macroErr) {
          // Fail-CLOSED: calendar/news check failure — cannot confirm the T1 window is clear.
          // Drop the pending entry (consistent with Gate 3 lunch-blackout fail-CLOSED policy
          // and the institutional rule that unknown macro risk = block, not allow).
          pendingDropReason = "macro_news_check_error";
          logger.warn(
            { sessionId, symbol, correlationId: fillCorrelationId },
            "H3 Gate 4: T1 news check error at fill time — dropping pending entry (fail-CLOSED)",
          );
          insertAuditRow({
            action: "paper.fill_blocked_news_check_error",
            entityType: "paper_session",
            entityId: sessionId,
            decisionAuthority: "system",
            status: "warning",
            input: { sessionId, symbol, side: pendingEntry.side } as Record<string, unknown>,
            result: { reason: "macro_news_check_error", failClosed: true } as Record<string, unknown>,
            correlationId: fillCorrelationId,
          }).catch((e: unknown) => {
            logger.warn({ e, action: "paper.fill_blocked_news_check_error" }, "audit write failed — non-blocking");
            auditWriteFailuresTotal.labels({ action: "paper.fill_blocked_news_check_error" }).inc();
          });
        }
      }

      // Gate 5: DLL re-check at fill time — current combined P&L may have shifted
      if (!pendingDropReason) {
        try {
          // HIGH C-1 fix (deep-scan #16 wave-1 track-3): scope by the resolved
          // per-account key (config.account_key, falling back to firmId) instead
          // of the raw firmId string, and derive this account's OWN personal DLL
          // dollar base instead of the single global DEFAULT_PERSONAL_DLL_DOLLARS
          // constant — so two Topstep accounts on the same firm never net together.
          const accountKey = resolveAccountKey(sessionRow);
          const sessionDate = toFuturesTradingDayString(fillTs);
          const cumPnL = await getAccountSessionCumulativePnL(accountKey, sessionDate);
          const trailingDdOverride = (sessionRow.config as { trailing_dd_amount?: number } | null)?.trailing_dd_amount ?? null;
          const accountStartingFloor = parseAccountNumericOrDefault(sessionRow.startingCapital, 50_000);
          const personalDllDollars = resolvePersonalDllDollars({
            firmId: sessionRow.firmId,
            trailingDdOverride,
            accountStartingFloor,
          });
          const dllResult = evaluateCrossSymbolDll(cumPnL, personalDllDollars);
          // deep-scan 2026-07-11 HIGH fix: `|| dllResult.degraded` — a DB fault inside
          // getAccountSessionCumulativePnL is SWALLOWED (returns a degraded zero, does not throw), so
          // the catch below never fires and action="none" let the fill through. Block fail-closed on
          // the degraded signal, matching the documented fail-CLOSED DLL policy.
          if (dllResult.action === "halt" || dllResult.action === "force_close" || dllResult.degraded) {
            pendingDropReason = "dll_halt";
          }
        } catch (_dllErr) {
          // Fail-CLOSED for DLL gate (same as signal-time policy)
          pendingDropReason = "dll_halt";
        }
      }

      // Gate 6: Daily trade cap re-check using FILL-time CME day
      // (session_boundary_crossed gate above already handles cross-day; this gate
      // catches the within-day count crossing the cap between queue and fill.)
      if (!pendingDropReason) {
        try {
          const capTodayEt = toFuturesTradingDayString(fillTs);
          const [capRow] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(paperTrades)
            .where(and(
              eq(paperTrades.sessionId, sessionId),
              sql`to_char(${paperTrades.exitTime} AT TIME ZONE 'America/New_York' + interval '7 hours', 'YYYY-MM-DD') = ${capTodayEt}`,
            ));
          const tradesTodayAtFill = capRow?.count ?? 0;
          const sessionCfgRaw = (sessionRow as { config?: { max_trades_per_day?: number | null } }).config;
          const perSessionCap = sessionCfgRaw?.max_trades_per_day != null
            ? Number(sessionCfgRaw.max_trades_per_day)
            : null;
          const capCheck = evaluateDailyTradeCap({
            tradesToday: tradesTodayAtFill,
            perSessionCap,
            envDefault: getDailyTradeCapEnvDefault(),
          });
          if (!capCheck.allow) {
            pendingDropReason = "daily_trade_cap";
          }
        } catch (_capErr) {
          // Fail-OPEN (same as signal-time daily-trade-cap policy): let a borderline
          // trade through rather than silently halt on infrastructure failure.
        }
      }

      if (pendingDropReason !== null) {
        // A gate failed at fill time — emit audit + skip openPosition.
        // Severity: "info" for expected temporal crossings (lunch/session-boundary/
        // daily-cap reset); "warning" for unexpected state flips (kill-switch/DLL).
        const dropSeverity: "info" | "warning" =
          (pendingDropReason === "lunch_blackout" ||
           pendingDropReason === "session_boundary_crossed" ||
           pendingDropReason === "daily_trade_cap" ||
           pendingDropReason === "news_size_reduced_to_zero")
            ? "info" : "warning";

        const logPayload = {
          sessionId,
          symbol,
          side: pendingEntry.side,
          reason: pendingDropReason,
          signalBarTimestamp: pendingEntry.signalBarTimestamp,
          fillBarTimestamp: bar.timestamp,
          correlationId: fillCorrelationId,
        };
        const dropMsg = `H3: Pending entry DROPPED at fill time — gate re-check failed: ${pendingDropReason}`;
        if (dropSeverity === "warning") {
          logger.warn(logPayload, dropMsg);
        } else {
          logger.info(logPayload, dropMsg);
        }
        insertAuditRow({
          action: `pending_entry.dropped_${pendingDropReason}`,
          entityType: "paper_session",
          entityId: sessionId,
          decisionAuthority: "system",
          status: dropSeverity === "warning" ? "warning" : "info",
          input: {
            sessionId,
            symbol,
            side: pendingEntry.side,
            signalBarTimestamp: pendingEntry.signalBarTimestamp,
            fillBarTimestamp: bar.timestamp,
          } as Record<string, unknown>,
          result: { dropped: true, reason: pendingDropReason } as Record<string, unknown>,
          correlationId: fillCorrelationId,
        }).catch((e: unknown) => {
          const _dropAct = `pending_entry.dropped_${pendingDropReason}`;
          logger.warn({ e, action: _dropAct }, "audit write failed — non-blocking");
          auditWriteFailuresTotal.labels({ action: "pending_entry.dropped" }).inc();
        });

        // Propagate span attribute then short-circuit — skip to next bar
        span.setAttribute("pending_entry_dropped", true);
        span.setAttribute("pending_entry_drop_reason", pendingDropReason);
        previousIndicators.set(prevKey, indicators);
        span.end();
        return;
      }
    }
    // ─── End H3 pending-entry fill-gate re-check ─────────────────────────────

    logger.info(
      {
        sessionId, symbol,
        side: pendingEntry.side,
        contracts: pendingEntry.contracts,
        executionPrice: bar.close,
        signalBarTimestamp: pendingEntry.signalBarTimestamp,
        executionBarTimestamp: bar.timestamp,
      },
      "FIX 1: Executing deferred entry from previous bar (next-bar fill parity)",
    );

    const deferredResult = await openPosition(sessionId, {
      symbol,
      side: pendingEntry.side,
      signalPrice: bar.close,          // bar N+1's close — matching backtest convention
      contracts: pendingEntry.contracts,
      orderType: pendingEntry.orderType,
      stopLimitOffset: pendingEntry.stopLimitOffset,
      barTimestamp: new Date(bar.timestamp), // bar N+1 timestamp for session classification
      rsi: pendingEntry.rsi,
      atr: pendingEntry.atr,
      // Wave 2 (2026-07-16): thread the config stop multiplier into the managed-stop geometry.
      stopMultiplier: pendingEntry.stopMultiplier,
      barVolume: bar.volume,            // use bar N+1's volume for fill probability
      medianBarVolume: pendingEntry.medianBarVolume,
      // Trade-critique data bridge (2026-07-05): entry-time decision context captured
      // at signal time (bar N) — see PendingEntry.entryContext.
      entryContext: pendingEntry.entryContext,
      // #2 (2026-07-11): wire the adaptive exit plan into the paper deferred-fill path. It was
      // DORMANT — openPosition only computes the adaptive plan when adaptiveExitInput is passed, and
      // this (the sole paper entry path) never passed it, so every `exit_style="adaptive"` strategy
      // silently ran static_styleC on paper while the backtester ran adaptive (a paper/backtest parity
      // gap). Gated to adaptive-opted strategies only (default static_styleC → this is undefined →
      // byte-identical legacy behavior). entry.stop is OMITTED: openPosition derives it from the fill
      // price ∓ atr×2.0 (== the position's own managed stop) with zero drift. narrativePhase=null is
      // parity-faithful — the backtester's compute_exit_plan_python passes no narrative_phase either,
      // and check:ts-python-exit-parity locks the TS null-narrative behavior to that Python oracle.
      // Fail-soft throughout: any computeExitPlan error inside openPosition → static_styleC fallback.
      adaptiveExitInput:
        sessionConfig.exitPlanConfig?.exit_style === "adaptive"
          ? {
              strategy: { id: sessionConfig.strategyId, exit_plan_config: sessionConfig.exitPlanConfig },
              bar: { close: bar.close, high: bar.high, low: bar.low, volume: bar.volume },
              marketState: {
                regime: pendingEntry.entryContext?.regimeAtEntry ?? "UNKNOWN",
                narrativePhase: null,
              },
            }
          : undefined,
    }, {
      correlationId: pendingEntry.correlationId,
      // deepscan18 C-C1: forward this session's account/firm scope into
      // openPosition()'s own kill-switch gate (paper-execution-service.ts
      // ~734) so a sibling account's breach doesn't block THIS fill.
      accountKey: resolveAccountKey(sessionRow),
      firmId: sessionRow.firmId,
    });

    if (deferredResult.position) {
      action = "open";
      positionBarsHeld.set(deferredResult.position.id, 0);
      span.setAttribute("deferred_fill", true);
      span.setAttribute("signal_bar", pendingEntry.signalBarTimestamp);
      logger.info(
        { sessionId, symbol, side: pendingEntry.side, executionPrice: bar.close, contracts: pendingEntry.contracts },
        "FIX 1: Deferred entry filled — position opened at bar N+1 close",
      );

      // ─── Server-Mediated Execution: Phase 0 entry routing ────────────────────
      // Fire live order when SERVER_MEDIATED_EXECUTION_ENABLED=true and strategy
      // is DEPLOYED or PILOT. Fire-and-forget: routing failure NEVER prevents
      // paper position from persisting. Fill reconciliation = Phase 1.
      // SHADOW guard enforced inside routeLiveEntry — this call is safe for all states.
      {
        const _smeLifecycleState = sessionConfig.lifecycleState ?? "";
        const _smeFirmId = sessionRow.firmId ?? "";
        const _smeContracts = deferredResult.position.contracts;
        const _smeBarTs = typeof pendingEntry.signalBarTimestamp === "number"
          ? new Date(pendingEntry.signalBarTimestamp).toISOString()
          : typeof pendingEntry.signalBarTimestamp === "string"
            ? pendingEntry.signalBarTimestamp
            : undefined;
        const _smeCorrelationId = pendingEntry.correlationId ?? null;
        const _smeStrategyId = sessionConfig.strategyId ?? "";

        import("./server-mediated-executor.js").then(async ({ routeLiveEntry, isServerMediatedExecutionEnabled }) => {
          if (!isServerMediatedExecutionEnabled()) return; // fast-path: flag off

          // Resolve broker accountId from firmId (first enabled account for this firm)
          let _smeAccountId = "";
          try {
            const [_acct] = await db
              .select({ accountId: brokerAccounts.accountId })
              .from(brokerAccounts)
              .where(and(eq(brokerAccounts.firmId, _smeFirmId), eq(brokerAccounts.enabled, true)))
              .limit(1);
            _smeAccountId = _acct?.accountId ?? "";
          } catch (acctErr) {
            logger.warn({ acctErr, sessionId, firmId: _smeFirmId }, "SME: broker account lookup failed (routing skipped)");
            return;
          }
          if (!_smeAccountId) {
            logger.warn({ sessionId, firmId: _smeFirmId }, "SME: no enabled broker account for firm (routing skipped)");
            return;
          }

          return routeLiveEntry({
            ctx: {
              accountId: _smeAccountId,
              lifecycleState: _smeLifecycleState,
              sessionId,
              strategyId: _smeStrategyId,
              correlationId: _smeCorrelationId,
            },
            symbol,
            side: pendingEntry.side as "long" | "short",
            quantity: _smeContracts,
            barTimestamp: _smeBarTs,
          });
        }).catch((smeErr: unknown) => {
          logger.error(
            { err: smeErr, sessionId, symbol, lifecycleState: sessionConfig.lifecycleState },
            "SME: routeLiveEntry threw — paper position already open (isolated failure, no action required)",
          );
        });
      }
      // ─── End SME entry routing ────────────────────────────────────────────────
    } else {
      fillMiss = true;
      db.insert(paperSignalLogs).values({
        sessionId,
        symbol,
        direction: pendingEntry.side,
        signalType: "fill_miss",
        price: String(bar.close),
        indicatorSnapshot: { _deferred_fill: true, _signal_bar: pendingEntry.signalBarTimestamp },
        acted: false,
        reason: `Deferred fill miss (bar N+1 fill, fillRatio: ${deferredResult.executionResult.fillRatio ?? 0})`,
      }).catch((err: unknown) => logger.warn({ err }, "Failed to log deferred fill miss to DB"));
    }

    // After a deferred fill (success or miss), skip the rest of this bar's signal
    // evaluation to avoid double-processing entry logic on the same bar.
    previousIndicators.set(prevKey, indicators);
    span.end();
    return;
  }

  if (openPos && !isShadow) {
    // ─── Position open: check for exit signal or stop-loss ──

    // ─── C-2 FIX: 15:55 ET hard time-stop (Style C canonical, CLAUDE.md §4) ──
    // Flatten any open position when wall-clock ET reaches 15:55 or RTH is closed
    // (etHour>=16). Idempotent — position closedAt guard ensures double-close is
    // impossible. Uses bar.timestamp as the clock source so replay/backfill works
    // identically to live. Falls back to wall-clock new Date() when bar.timestamp
    // is unavailable (should never happen in normal flow).
    //
    // NOTE: we check BEFORE stop/trail/max-hold so that time-stop is the highest
    // priority forced exit — matches backtester.py convention (time exits first).
    {
      const barDate = bar.timestamp ? new Date(bar.timestamp) : new Date();
      const etFmt = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        hour: "numeric",
        minute: "numeric",
        hour12: false,
      });
      const etParts = etFmt.formatToParts(barDate);
      const etHour = parseInt(etParts.find(p => p.type === "hour")?.value ?? "0", 10);
      const etMin  = parseInt(etParts.find(p => p.type === "minute")?.value ?? "0", 10);
      const isAfterTimeStop = etHour > 15 || (etHour === 15 && etMin >= 55);

      if (isAfterTimeStop) {
        positionBarsHeld.delete(openPos.id);
        trailStopHWM.delete(openPos.id);
        const barTs = new Date(bar.timestamp);
        await closePosition(openPos.id, bar.close, currentAtr, { correlationId, barTimestamp: barTs });
        await setCooldown(sessionId, sessionConfig, config.cooldown_bars ?? 4);
        logger.info(
          { sessionId, symbol, reason: "time_stop_1555_et", etHour, etMin, barTimestamp: bar.timestamp },
          "Paper position closed — 15:55 ET hard time-stop (Style C canonical)",
        );
        span.setAttribute("time_stop_1555_et", true);
        action = "close_time";
        // Log to signal journal before early return so the close is fully auditable
        await logSignal({
          sessionId,
          symbol,
          timestamp: bar.timestamp,
          entrySignal,
          exitSignal,
          stopHit,
          sessionFiltered,
          windowFiltered,
          cooldownActive,
          riskGatePassed,
          action,
          indicators,
          barClose: bar.close,
          strategySide: config.side,
          fillMiss,
        }).catch((err: unknown) => logger.warn({ err }, "Failed to log time-stop signal entry"));
        span.end();
        return;
      }
    }

    // ─── C-3: Style C TP1 detection — BE+1 tick stop move ──────────────────
    // Canonical per CLAUDE.md §4: when price crosses +1R (TP1), move stop to
    // BE+1 tick. Contract reduction (33% partial close) is carry-forward —
    // see docs/style-c-partials-carry-forward.md for TP2+runner implementation.
    //
    // TP1 check runs AFTER time-stop and BEFORE trail/fixed stop so that a
    // position that hits TP1 and the time-stop in the same bar gets time-stopped
    // (already returned above). The BE-stop only activates for the NEXT bar.
    //
    // We only apply this for positions where exit_params.style === "c" (i.e.,
    // strategies that have been processed by framework-overlay).
    {
      const rawCfg = config as unknown as Record<string, unknown>;
      const exitParams = rawCfg.exit_params as Record<string, unknown> | undefined;
      const isStyleC = exitParams?.style === "c";

      if (isStyleC && !tp1BeStopMap.has(openPos.id)) {
        // TP1 not yet triggered — check if price has crossed +1R this bar.
        const tp1AtR = (exitParams?.tp1_at_r as number | undefined) ?? 1.0;
        const entryPrice = Number(openPos.entryPrice);
        const side = openPos.side;

        // F-1 (re-scan 2026-07-10, HIGH): anchor the TP1 R-unit to the STATIC entry-time
        // stop (openPos.initialStopPrice) — IDENTICAL to the actual TP1 partial-close
        // computation in paper-execution-service.ts callExitHandler ("Defect 3 fix",
        // ~line 3293, `stopPts = |entryPrice - initialStopPrice|`). PREVIOUS BUG: this
        // BE+1 tracker (the ONLY site that moves the stop to break-even on TP1) recomputed
        // R from the LIVE current-bar ATR every bar. Framework-overlay sets Style C stops as
        // {type:"atr"} with no persisted ATR, so this tracker's TP1 target FLOATED with ATR
        // while the real 33% partial-close fired on the fixed entry-time target. When ATR
        // drifted UP, price hit the real TP1 (partial booked, contracts reduced) but this
        // tracker's higher floating target hadn't triggered → the stop stayed at the ORIGINAL
        // WIDE stop instead of moving to BE+1, silently widening runner risk for an unbounded
        // duration and contradicting the documented "BE+1 on TP1 fill" invariant. Falling ATR
        // moved the stop to BE+1 EARLY (non-backtest-matching exit). Both TP1 computations now
        // read the same static entry-time R so the BE+1 move fires exactly when the real TP1 does.
        // Legacy ATR fallback (consulted ONLY for pre-0179 null-initialStopPrice rows).
        let atrFallbackPoints = 0;
        const stopCfg = config.stop_loss;
        if (stopCfg) {
          if (stopCfg.type === "atr") {
            const atrPeriod = stopCfg.atr_period ?? 14;
            const atrVal = indicators[`atr_${atrPeriod}`] ?? indicators["atr_14"] ?? 0;
            atrFallbackPoints = atrVal * (stopCfg.multiplier ?? 1.5);
          } else {
            atrFallbackPoints = stopCfg.amount ?? 0;
          }
        }
        // F-1: single source of truth — static entry-time R (matches the real TP1
        // partial-close), ATR only for the pre-0179 grandfather edge. See style-c-tp1-risk.ts.
        const initialRiskPoints = styleCTp1RiskPoints({
          entryPrice,
          initialStopPrice: openPos.initialStopPrice,
          atrFallbackPoints,
        });

        if (initialRiskPoints > 0) {
          const tp1Target = side === "long"
            ? entryPrice + tp1AtR * initialRiskPoints
            : entryPrice - tp1AtR * initialRiskPoints;

          const tp1Crossed = side === "long"
            ? bar.high >= tp1Target
            : bar.low <= tp1Target;

          if (tp1Crossed) {
            // Move stop to BE + 1 tick (conservative: 1 tick ABOVE entry for long,
            // BELOW for short, so a reversal to entry doesn't trigger BE flush).
            const tickSize = TICK_SIZES[symbol] ?? 0.25;
            const beStop = side === "long"
              ? entryPrice + tickSize
              : entryPrice - tickSize;

            tp1BeStopMap.set(openPos.id, beStop);

            // Persist tp1_filled_at to DB so restart correctly identifies TP1-filled positions.
            const nowTs = new Date();
            db.update(paperPositions)
              .set({ tp1FilledAt: nowTs })
              .where(eq(paperPositions.id, openPos.id))
              .catch((err: unknown) => logger.warn({ err, positionId: openPos.id }, "C-3: Failed to persist tp1_filled_at to DB"));

            logger.info(
              {
                sessionId,
                symbol,
                positionId: openPos.id,
                side,
                entryPrice,
                tp1Target,
                beStop,
                tp1AtR,
                initialRiskPoints,
              },
              "Style C TP1 crossed — stop moved to BE+1 tick. Partial contract close (33%) is carry-forward (see docs/style-c-partials-carry-forward.md).",
            );
            span.setAttribute("style_c_tp1_crossed", true);
            span.setAttribute("style_c_be_stop", beStop);
          }
        }
      }

      // If TP1 has been crossed (either this bar or a prior bar), override the
      // fixed stop with the BE+1tick level so checkStopLoss uses it correctly.
      // We do this by checking the DB tp1_filled_at if memory state was lost on restart.
      if (isStyleC) {
        const beStop = tp1BeStopMap.get(openPos.id);
        if (beStop === undefined && openPos.tp1FilledAt != null) {
          // Restart scenario: tp1_filled_at is in DB but memory was cleared.
          // Reconstruct BE stop from entryPrice + 1 tick (same logic as above).
          const tickSize = TICK_SIZES[symbol] ?? 0.25;
          const beStopRestored = openPos.side === "long"
            ? Number(openPos.entryPrice) + tickSize
            : Number(openPos.entryPrice) - tickSize;
          tp1BeStopMap.set(openPos.id, beStopRestored);
          logger.info(
            { sessionId, positionId: openPos.id, beStop: beStopRestored },
            "C-3: Restored tp1BeStopMap from DB tp1_filled_at after restart",
          );
        }
      }
    }

    // ─── 2.4: Time-based exit — max hold bars ───────────────
    // Increment bars-held counter.  Force-close when limit reached.
    // H2: persist the new value to DB so restarts don't reset the counter.
    let timeExit = false;
    if (config.max_hold_bars !== undefined && config.max_hold_bars > 0) {
      const prevBarsHeld = positionBarsHeld.get(openPos.id) ?? 0;
      const newBarsHeld = prevBarsHeld + 1;
      positionBarsHeld.set(openPos.id, newBarsHeld);
      // Persist to DB (non-blocking — a missed write just means the counter
      // reverts to the last persisted value after a restart, not a hard failure)
      db.update(paperPositions)
        .set({ barsHeld: newBarsHeld })
        .where(eq(paperPositions.id, openPos.id))
        .catch((err: unknown) => logger.warn({ err, positionId: openPos.id }, "Failed to persist barsHeld to DB"));
      if (newBarsHeld >= config.max_hold_bars) {
        timeExit = true;
        span.setAttribute("time_exit_bars", newBarsHeld);
      }
    }

    // ─── 2.3: Trail stop check ───────────────────────────────
    let trailResult: { hit: boolean; stopPrice: number; newHWM: number | null } = { hit: false, stopPrice: 0, newHWM: null };
    if (config.trail_stop) {
      trailResult = checkTrailStop(openPos, bar, config.trail_stop, indicators, config.stop_loss);
      // H2: persist HWM to DB so restarts don't reset the trailing stop level.
      // Fire-and-forget — a missed write reverts to the last persisted HWM after
      // a restart (slightly less aggressive stop), not a hard failure.
      if (trailResult.newHWM !== null) {
        db.update(paperPositions)
          .set({ trailHwm: String(trailResult.newHWM) })
          .where(eq(paperPositions.id, openPos.id))
          .catch((err: unknown) => logger.warn({ err, positionId: openPos.id }, "Failed to persist trailHwm to DB"));
      }
    }

    // Fixed stop-loss check.
    // C-3: When Style C TP1 has been crossed, override the stop config with the
    // BE+1tick level stored in tp1BeStopMap. This ensures the risk guarantee
    // (stop moves to break-even after TP1 fills) is honored every bar.
    //
    // Defect 1 fix: use type:"absolute_level" (not type:"fixed") so checkStopLoss
    // receives the EXACT stop PRICE rather than a distance.  The old type:"fixed"
    // path computed stopLevel = entryPrice - distance = entryPrice - 1tick, which
    // is BELOW entry for a long — 2 ticks wrong.  type:"absolute_level" evaluates
    // bar.low <= level directly, which is the correct parity with backtester.py
    // (be_stop = entry_p + tick; hit when bar.low <= be_stop).
    const tp1BeStop = tp1BeStopMap.get(openPos.id);
    const effectiveStopConfig: StopLossConfig | undefined = tp1BeStop != null
      ? { type: "absolute_level", level: tp1BeStop }
      : config.stop_loss;
    const stopResult = checkStopLoss(openPos, bar, effectiveStopConfig, indicators);
    stopHit = stopResult.hit;

    // Priority order: fixed stop > trail stop > time exit > exit signal
    // Fixed stop is checked first because it is the firm risk limit.
    // P1-8: Pass bar timestamp to closePosition so session classification uses bar time, not wall-clock.
    const barTs = new Date(bar.timestamp);
    if (stopHit) {
      action = "close_stop";
      positionBarsHeld.delete(openPos.id);
      trailStopHWM.delete(openPos.id);
      tp1BeStopMap.delete(openPos.id);
      await closePosition(openPos.id, stopResult.stopPrice, currentAtr, { correlationId, barTimestamp: barTs });
      await setCooldown(sessionId, sessionConfig, config.cooldown_bars ?? 4);
      logger.info(
        { sessionId, symbol, reason: "stop_loss", stopPrice: stopResult.stopPrice },
        "Paper position closed — stop-loss hit",
      );
    } else if (trailResult.hit) {
      action = "close_trail";
      positionBarsHeld.delete(openPos.id);
      trailStopHWM.delete(openPos.id);
      tp1BeStopMap.delete(openPos.id);  // C-3: clear BE stop state on close
      await closePosition(openPos.id, trailResult.stopPrice, currentAtr, { correlationId, barTimestamp: barTs });
      await setCooldown(sessionId, sessionConfig, config.cooldown_bars ?? 4);
      logger.info(
        { sessionId, symbol, reason: "trail_stop", stopPrice: trailResult.stopPrice },
        "Paper position closed — trailing stop hit",
      );
    } else if (timeExit) {
      action = "close_time";
      positionBarsHeld.delete(openPos.id);
      trailStopHWM.delete(openPos.id);
      tp1BeStopMap.delete(openPos.id);  // C-3: clear BE stop state on close
      await closePosition(openPos.id, bar.close, currentAtr, { correlationId, barTimestamp: barTs });
      await setCooldown(sessionId, sessionConfig, config.cooldown_bars ?? 4);
      logger.info(
        { sessionId, symbol, reason: "max_hold_bars", barsHeld: config.max_hold_bars },
        "Paper position closed — max hold duration reached",
      );
    } else if (exitSignal) {
      action = "close_signal";
      positionBarsHeld.delete(openPos.id);
      trailStopHWM.delete(openPos.id);
      tp1BeStopMap.delete(openPos.id);  // C-3: clear BE stop state on close
      await closePosition(openPos.id, bar.close, currentAtr, { correlationId, barTimestamp: barTs });
      await setCooldown(sessionId, sessionConfig, config.cooldown_bars ?? 4);
      logger.info(
        { sessionId, symbol, reason: "exit_signal" },
        "Paper position closed — exit signal",
      );
    }
    // Position still open: bars-held counter updated above; HWM updated inside checkTrailStop.
  } else if (entrySignal && !sessionFiltered && !windowFiltered && !cooldownActive && !isShadow && !skipBlocked && !ictBridgeBlocked) {
    // ─── No position: check for entry ────────────────────────

    // ─── FIX 4 (Track M): Kill-switch halt check at bar-N signal time ────────
    // Management paths (position close, trail-stop, bar-to-bar price updates)
    // run in the `if (openPos)` branch ABOVE and must continue unaffected.
    // Only new-entry evaluation is blocked here.
    // isHaltedForProduction() has a 5s internal cache — cheap per-bar call.
    // deepscan18 (2026-07-05) C-C1: scope to this session's resolved account/
    // firm so a sibling account's breach doesn't block THIS account's new
    // entries. See kill-switch.ts::evaluateAllKillSwitchLayers.
    {
      const haltedAtEntry = await killSwitch.isHaltedForProduction({
        correlationId: correlationId ?? undefined,
        accountKey: resolveAccountKey(sessionRow),
        firmId: sessionRow.firmId,
      });
      if (haltedAtEntry) {
        logger.debug(
          { sessionId, symbol },
          "kill-switch: system halted — skipping new-entry evaluation (FIX 4, management paths unaffected)",
        );
        // Per-session-per-day dedup: write audit once per session per day to avoid
        // flooding on every bar when halted. Key resets when the date changes.
        const haltAuditKey = `${sessionId}:${new Date().toISOString().slice(0, 10)}`;
        if (!_haltedEntryAuditDedup.has(haltAuditKey)) {
          _haltedEntryAuditDedup.add(haltAuditKey);
          insertAuditRow({
            action: "signal.entry_eval_skipped_halted",
            entityType: "signal",
            entityId: sessionId,
            decisionAuthority: "system",
            input: { sessionId, symbol } as Record<string, unknown>,
            result: { skipped: true, reason: "kill_switch_halted" } as Record<string, unknown>,
            status: "success",
            correlationId: correlationId ?? null,
          }).catch((err: unknown) =>
            logger.warn({ err, sessionId }, "audit insert failed for signal.entry_eval_skipped_halted"),
          );
        }
        span.setAttribute("entry_skipped_kill_switch_halted", true);
        span.end();
        return;
      }
    }

    // ─── W23H.H Stage 0: Per-account symbol whitelist ────────────────────────
    // Block entry if the symbol is not in broker_accounts.enabled_symbols for
    // this session's firmId. Default is ['MES'] — operator must opt-in to add
    // MNQ or MCL per account (Combine safety: prevents correlated equity drawdown).
    //
    // Strategy: check ALL active accounts for this firmId. If ANY enabled account
    // includes the symbol → allow. If no accounts found → fail-open.
    // Fail-open: DB errors → no block (don't prevent trading on query failure).
    let symbolWhitelistBlocked = false;
    try {
      const firmId = sessionRow.firmId;
      if (firmId) {
        const accounts = await db
          .select({ enabledSymbols: brokerAccounts.enabledSymbols })
          .from(brokerAccounts)
          .where(and(
            eq(brokerAccounts.firmId, firmId),
            eq(brokerAccounts.enabled, true),
          ));

        if (accounts.length > 0) {
          // Check if any account for this firm enables the symbol
          const symbolEnabled = accounts.some(
            (acct) => Array.isArray(acct.enabledSymbols) && (acct.enabledSymbols as string[]).includes(symbol),
          );
          if (!symbolEnabled) {
            symbolWhitelistBlocked = true;
            span.setAttribute("symbol_whitelist_blocked", true);
            span.setAttribute("symbol_whitelist_firm", firmId);
            logger.info(
              { sessionId, symbol, firmId, accounts: accounts.map((a) => a.enabledSymbols) },
              "W23H.H: entry blocked — symbol not in enabled_symbols for this account",
            );
            db.insert(paperSignalLogs).values({
              sessionId,
              symbol,
              direction: config.side,
              signalType: "symbol_not_enabled_for_account",
              price: String(bar.close),
              indicatorSnapshot: {
                ...indicators,
                _firm_id: firmId,
                _enabled_symbols: JSON.stringify(accounts.map((a) => a.enabledSymbols)),
                _blocked_symbol: symbol,
              },
              acted: false,
              reason: `signal.blocked_symbol_not_enabled_for_account: symbol=${symbol} firmId=${firmId}`,
            }).catch((err: unknown) => logger.error({ err, sessionId }, "Failed to persist symbol whitelist block log"));
            // W24P1 Item 5: mirror skip to audit_log
            insertAuditRow({
              action: "signal.blocked_symbol_not_enabled_for_account",
              entityType: "signal",
              entityId: sessionId,
              decisionAuthority: "system",
              input: { sessionId, symbol, firmId } as Record<string, unknown>,
              result: { blocked: true, reason: "symbol_not_in_firm_account_whitelist" } as Record<string, unknown>,
              status: "success",
              correlationId: correlationId ?? null,
            }).catch((err: unknown) => logger.warn({ err, sessionId }, "audit_log insert failed for signal.blocked_symbol_not_enabled_for_account"));
          }
        }
        // If no accounts found → fail-open (no block)
      }
      // If no firmId on session → fail-open (legacy sessions without firm context)
    } catch (whitelistErr) {
      // Fail-open: DB errors never block trading
      logger.warn({ err: whitelistErr, sessionId, symbol }, "W23H.H: symbol whitelist gate error — fail-open, proceeding");
    }

    // ─── W23H.F Stage 0.5a: Pre-market blackout window gate ──────────────────
    // If today's pre_market_sessions row has blackout_windows JSONB and the
    // current bar falls within any blackout window, block the entry signal.
    // [start_utc, end_utc) boundary semantics — matching W23H.3 entry window convention.
    // Fail-open: if no pre_market_sessions row exists, or query errors → no block.
    // Confluence HIGH-1 (deep-scan 2026-07-09, ratified): thread the cross-asset
    // direction reading (DXY / 10Y) from today's pre_market_sessions row into the
    // Path C weightedCtx so `cross_asset_aligned` can actually evaluate. PREVIOUS BUG —
    // the factor read ctx.dxyDirection / ctx.us10yDirection but paper-signal-service
    // never populated them, so evalCrossAssetAligned returned
    // "cross_asset_data_unavailable" (satisfied=false) on EVERY live/paper signal. For
    // MCL that silently capped the achievable score at 0.90 (cross_asset carries 0.10
    // weight after the MCL internals→cross_asset redistribution).
    //
    // STRUCTURAL WIRING GUARANTEE (cert-hardened, 4 passes): the ENTIRE DB-read → row →
    // ctx chain is `const`-bound from single expressions, so there is NO mutable
    // intermediate a future edit could silently break. `pmRow` is a const from one
    // fail-open IIFE (the only throwable part); both the blackout gate AND the
    // cross-asset resolver read that same const; `crossAssetCtx` is a const from
    // resolveCrossAssetContext(pmRow) whose output is Object.frozen. A reassignment or a
    // conditional-gated re-bind of either const is a COMPILE error (TS2588); an
    // Object.assign clobber of crossAssetCtx throws at runtime (frozen).
    const today = toFuturesTradingDayString(new Date(bar.timestamp));
    const pmRow = await (async () => {
      try {
        const [row] = await db
          .select({
            blackoutWindows: preMarketSessions.blackoutWindows,
            // Gap 3 (observable): read first_30min_volume_ratio so we can surface
            // the null → tells operator the DAL is not yet wired.
            first30minVolumeRatio: preMarketSessions.first30minVolumeRatio,
            // Confluence HIGH-1: cross-asset direction + freshness for Path C.
            dxyDirection: preMarketSessions.dxyDirection,
            us10yDirection: preMarketSessions.us10yDirection,
            computedAt: preMarketSessions.computedAt,
          })
          .from(preMarketSessions)
          .where(and(
            eq(preMarketSessions.sessionDate, today),
            eq(preMarketSessions.symbol, symbol),
          ))
          .limit(1);
        return row ?? null;
      } catch (blackoutErr) {
        // Fail-open: query/parse errors → no block, no cross-asset data.
        logger.warn({ err: blackoutErr, sessionId, symbol }, "W23H.F: pre-market blackout gate error — fail-open, proceeding");
        return null;
      }
    })();

    // ─── W23H.F Stage 0.5a: Pre-market blackout window gate (reads the const pmRow) ──
    let blackoutBlocked = false;
    if (pmRow?.blackoutWindows) {
      const windows = pmRow.blackoutWindows as Array<{ event_type: string; start_utc: string; end_utc: string; severity: string }>;
      if (Array.isArray(windows) && windows.length > 0) {
        const barTs = new Date(bar.timestamp).getTime();
        const matched = windows.find(
          (w) => w.start_utc && w.end_utc &&
            barTs >= new Date(w.start_utc).getTime() &&
            barTs < new Date(w.end_utc).getTime(),
        );
        if (matched) {
          blackoutBlocked = true;
          span.setAttribute("pre_market_blackout_blocked", true);
          span.setAttribute("pre_market_blackout_event", matched.event_type);
          logger.info(
            { sessionId, symbol, eventType: matched.event_type, severity: matched.severity, barTimestamp: bar.timestamp },
            "W23H.F: entry blocked — bar falls within pre-market blackout window",
          );
          db.insert(paperSignalLogs).values({
            sessionId,
            symbol,
            direction: config.side,
            signalType: "skipped_pre_market_blackout",
            price: String(bar.close),
            indicatorSnapshot: {
              ...indicators,
              _blackout_event_type: matched.event_type,
              _blackout_start_utc: matched.start_utc,
              _blackout_end_utc: matched.end_utc,
              _blackout_severity: matched.severity,
            },
            acted: false,
            reason: `signal.skipped_pre_market_blackout: event=${matched.event_type} severity=${matched.severity} window=[${matched.start_utc},${matched.end_utc})`,
          }).catch((err: unknown) => logger.error({ err, sessionId }, "Failed to persist pre-market blackout block log"));
          // W24P1 Item 5: mirror skip to audit_log
          insertAuditRow({
            action: "signal.skipped_pre_market_blackout",
            entityType: "signal",
            entityId: sessionId,
            decisionAuthority: "system",
            input: {
              sessionId,
              symbol,
              event_type: matched.event_type,
              severity: matched.severity,
              start_utc: matched.start_utc,
              end_utc: matched.end_utc,
            } as Record<string, unknown>,
            result: { blocked: true, reason: "pre_market_blackout_window" } as Record<string, unknown>,
            status: "success",
            correlationId: correlationId ?? null,
          }).catch((err: unknown) => logger.warn({ err, sessionId }, "audit_log insert failed for signal.skipped_pre_market_blackout"));
        }
      }
    }

    // ── Parity Gap 3 (observable): first_30min_volume_ratio null diagnostics ──
    // first_30min_volume_ratio is structurally null until priorSessionVolume is
    // wired in pre-market-routine.ts. Log at debug so the paper/backtest
    // divergence is discoverable in telemetry without blocking trading.
    // delta_or_volume_signature uses volume_rolling_mean_20 from the bar buffer
    // as the operative volume reference when this ratio is unavailable.
    if (pmRow && pmRow.first30minVolumeRatio === null) {
      logger.debug(
        { sessionId, symbol, correlationId, sessionDate: today },
        "paper-parity: first_30min_volume_ratio null (priorSessionVolume DAL not wired); delta_or_volume_signature uses bar-derived volume_rolling_mean_20",
      );
    }

    // Confluence HIGH-1: resolve the cross-asset SignalContext slice from the SAME const
    // row (domain-validated direction + reading age in hours). Missing row → all-null
    // FROZEN object (factor stays cross_asset_data_unavailable — unchanged conservative).
    const crossAssetCtx = resolveCrossAssetContext(
      pmRow,
      new Date(bar.timestamp).getTime(),
    );

    // ─── W23H.F Stage 0.5b: Cross-symbol DLL coordinator ─────────────────────
    // Aggregate realized + open MTM P&L across ALL symbols on this firmId.
    // HALT new entries at 67% of personal DLL; FORCE-CLOSE all at 95%.
    // Fail-open: query errors return zero P&L so trading is never blocked.
    //
    // goalscan-crit-20260716 CAPITAL-SAFETY FIX: this evaluator (including the
    // 95%-DLL force_close branch) previously ran INSIDE `if (!blackoutBlocked)`,
    // which meant the entire cross-symbol DLL check — force-close included —
    // never ran during the 60-minute FOMC/CPI/NFP news-blackout window. No other
    // mechanism compensates: dd-velocity-cron only autopauses new entries, and
    // kill-switch.ts's L2/L3 force-close only fires from inside openPosition(),
    // which is never reached during a blackout (no new entries are attempted).
    // Net effect: during the highest-volatility window of the day, the one
    // mechanism that flattens an account already past 95% DLL was disabled by
    // an optimization that conflated "block a new entry" with "force-close a
    // bleeding position." The evaluator (and its force_close action) now runs
    // UNCONDITIONALLY. Only the entry-gating semantics inherit the blackout
    // short-circuit: `dllHaltBlocked` still initializes to `blackoutBlocked`
    // (so a blackout alone still blocks new entries via `lockoutBlocked` at the
    // signal-time gate below, independent of the DLL result), and — since
    // `blackoutBlocked` already ORs directly into `lockoutBlocked` — a "halt" or
    // "reduce_size" DLL verdict computed during a blackout changes nothing about
    // whether a new entry is allowed; it can ONLY ever make dllHaltBlocked MORE
    // restrictive, never less. force_close, uniquely, has a real effect during a
    // blackout: it closes ALREADY-OPEN positions, which no other gate does here.
    let dllHaltBlocked = blackoutBlocked;   // still gates new-entry blocking-side default
    let dllForceCloseTriggered = false;
    // 60%-DLL reduce-size band: when in the soft band (below the 67% halt), new entries are
    // sized DOWN by this factor (NOT blocked). 1 = no reduction. Applied at the sizing site.
    let dllReduceSizeFactor = 1;
    {
      try {
        // HIGH C-1 fix (deep-scan #16 wave-1 track-3): scope by the resolved
        // per-account key (config.account_key, falling back to firmId) instead
        // of the raw firmId string, and derive this account's OWN personal DLL
        // dollar base instead of the single global DEFAULT_PERSONAL_DLL_DOLLARS
        // constant — so two Topstep accounts on the same firm never net together
        // (A's real breach hidden behind B's gains) and a healthy account is
        // never falsely halted by a sibling account's losses.
        const firmId = sessionRow.firmId ?? "default";
        const accountKey = resolveAccountKey(sessionRow);
        const sessionDate = toFuturesTradingDayString(new Date(bar.timestamp));
        const cumPnL = await getAccountSessionCumulativePnL(accountKey, sessionDate);
        const trailingDdOverride = (sessionRow.config as { trailing_dd_amount?: number } | null)?.trailing_dd_amount ?? null;
        const accountStartingFloorForDll = parseAccountNumericOrDefault(sessionRow.startingCapital, 50_000);
        const personalDllDollars = resolvePersonalDllDollars({
          firmId: sessionRow.firmId,
          trailingDdOverride,
          accountStartingFloor: accountStartingFloorForDll,
        });
        const dllResult = evaluateCrossSymbolDll(cumPnL, personalDllDollars);

        if (dllResult.action === "force_close") {
          dllForceCloseTriggered = true;
          dllHaltBlocked = true;
          span.setAttribute("cross_symbol_dll_force_close", true);
          span.setAttribute("cross_symbol_dll_pct", dllResult.dllPct);
          logger.warn(
            { sessionId, symbol, firmId, combinedPnL: dllResult.combinedPnL, dllPct: dllResult.dllPct, bySymbol: dllResult.pnLBySymbol },
            "W23H.F: cross-symbol DLL 95% threshold — FORCE-CLOSE all positions",
          );
          insertAuditRow({
            action: "cross_symbol_force_close_triggered",
            entityType: "paper_session",
            entityId: sessionId,
            decisionAuthority: "system",
            status: "warning",
            input: { firmId, sessionDate, combinedPnL: dllResult.combinedPnL },
            result: { dll_pct: dllResult.dllPct, by_symbol: dllResult.pnLBySymbol, threshold: dllResult.forceCloseThreshold },
            correlationId: correlationId ?? null,
          }).catch((e: unknown) => {
            logger.warn({ e, action: "cross_symbol_force_close_triggered" }, "audit write failed — non-blocking");
            auditWriteFailuresTotal.labels({ action: "cross_symbol_force_close_triggered" }).inc();
          });
          // Force-close path: await forceCloseAllPositions (static import — no circular
          // dependency: paper-signal-service already imports paper-execution-service at
          // the top; paper-execution-service only dynamically imports paper-signal-service
          // for updateGovernorOnTrade which runs on a DIFFERENT code path).
          // FINDING #2 FIX: prior fire-and-forget dynamic import meant a module-load
          // failure or thrown exception silently swallowed — positions stayed open past
          // the firm DLL breach with no audit row and no operator alert.
          // deepscan17 (2026-07-05): E-1 threads the root correlationId (was minted fresh
          // inside forceCloseAllPositions, breaking the audit chain); C-1 scopes the
          // flatten to THIS account (accountKey, resolved above) so a breach on one
          // funded account cannot flatten a healthy sibling account/firm.
          try {
            await forceCloseAllPositions(
              `cross_symbol_dll_force_close:${firmId}:${dllResult.dllPct.toFixed(3)}`,
              { correlationId: correlationId ?? undefined, scope: { accountKey } },
            );
          } catch (fcErr: unknown) {
            const fcMsg = fcErr instanceof Error ? fcErr.message : String(fcErr);
            logger.error(
              { err: fcErr, sessionId, firmId, dllPct: dllResult.dllPct },
              "W23H.F: forceCloseAllPositions FAILED — positions may still be open past firm DLL; manual close required",
            );
            insertAuditRow({
              action: "cross_symbol_force_close_failed",
              entityType: "paper_session",
              entityId: sessionId,
              decisionAuthority: "system",
              status: "error",
              input: { firmId, dllPct: dllResult.dllPct, combinedPnL: dllResult.combinedPnL } as Record<string, unknown>,
              result: { error: fcMsg, requiresManualClose: true } as Record<string, unknown>,
              correlationId: correlationId ?? null,
            }).catch((e: unknown) => {
              logger.warn({ e, action: "cross_symbol_force_close_failed" }, "audit write failed — non-blocking");
              auditWriteFailuresTotal.labels({ action: "cross_symbol_force_close_failed" }).inc();
            });
            notifyCritical(
              "CRITICAL: Cross-symbol DLL force-close FAILED",
              // Deep-scan #5 (2026-06-29): family-grade postscript (was the unwrapped
              // notifyCritical the postscript lint flagged — pre-existing at HEAD).
              appendFamilyGradePostscript(
                `firm: ${firmId} dllPct: ${dllResult.dllPct.toFixed(3)} — Positions may still be open past the breach threshold. Manual close required immediately. err: ${fcMsg}`,
                "The bot tried to auto-close all positions after hitting the daily loss limit but the close FAILED.",
                "URGENT: open positions may still be live past the safety limit. Call Tony now and/or flatten manually in the broker.",
              ),
              { firmId, dllPct: dllResult.dllPct, sessionId, error: fcMsg },
            );
          }
        } else if (dllResult.action === "halt") {
          dllHaltBlocked = true;
          span.setAttribute("cross_symbol_dll_halt", true);
          span.setAttribute("cross_symbol_dll_pct", dllResult.dllPct);
          // HIGH E-3 fix (deep-scan #16 wave-1 track-3): the 67% DLL halt previously
          // had zero Prometheus visibility — no positions close at halt, so nothing
          // else counts it. This is the cross-symbol coordinator's halt path (the
          // per-session kill-switch halt in paper-execution-service.ts is counted
          // separately with its own KILL_REASON_* label).
          dllHaltTotal.labels({ reason: "cross_symbol_dll_halt" }).inc();
          logger.warn(
            { sessionId, symbol, firmId, combinedPnL: dllResult.combinedPnL, dllPct: dllResult.dllPct, bySymbol: dllResult.pnLBySymbol },
            "W23H.F: cross-symbol DLL 67% threshold — HALTING new entries for this account",
          );
          insertAuditRow({
            action: "cross_symbol_dll_halt_triggered",
            entityType: "paper_session",
            entityId: sessionId,
            decisionAuthority: "system",
            status: "warning",
            input: { firmId, sessionDate, combinedPnL: dllResult.combinedPnL },
            result: { dll_pct: dllResult.dllPct, by_symbol: dllResult.pnLBySymbol, threshold: dllResult.haltThreshold },
            correlationId: correlationId ?? null,
          }).catch((e: unknown) => {
            logger.warn({ e, action: "cross_symbol_dll_halt_triggered" }, "audit write failed — non-blocking");
            auditWriteFailuresTotal.labels({ action: "cross_symbol_dll_halt_triggered" }).inc();
          });
          db.insert(paperSignalLogs).values({
            sessionId,
            symbol,
            direction: config.side,
            signalType: "cross_symbol_dll_halt_blocked",
            price: String(bar.close),
            indicatorSnapshot: {
              ...indicators,
              _combined_pnl: dllResult.combinedPnL,
              _dll_pct: dllResult.dllPct,
              _halt_threshold: dllResult.haltThreshold,
              _by_symbol: JSON.stringify(dllResult.pnLBySymbol),
            },
            acted: false,
            reason: `cross_symbol_dll_halt_triggered: combined_pnl=${dllResult.combinedPnL.toFixed(2)} dll_pct=${(dllResult.dllPct * 100).toFixed(1)}%`,
          }).catch((err: unknown) => logger.error({ err, sessionId }, "Failed to persist DLL halt log"));
        } else if (dllResult.action === "reduce_size") {
          // SOFT 60% band — do NOT block; size the new entry DOWN to absorb the losing streak
          // before the hard 67% halt. Applied at the sizing site via dllReduceSizeFactor.
          dllReduceSizeFactor = dllResult.reduceSizeFactor;
          span.setAttribute("dll_reduce_size_band", true);
          span.setAttribute("dll_reduce_size_factor", dllResult.reduceSizeFactor);
          span.setAttribute("cross_symbol_dll_pct", dllResult.dllPct);
          logger.warn(
            { sessionId, symbol, firmId, combinedPnL: dllResult.combinedPnL, dllPct: dllResult.dllPct, reduceFactor: dllResult.reduceSizeFactor },
            "60%-DLL band — sizing new entry DOWN (soft throttle before the 67% halt)",
          );
          insertAuditRow({
            action: "sizing.dll_reduce_size_band_entered",
            entityType: "paper_session",
            entityId: sessionId,
            decisionAuthority: "system",
            status: "warning",
            input: { firmId, sessionDate, combinedPnL: dllResult.combinedPnL } as Record<string, unknown>,
            result: { dll_pct: dllResult.dllPct, reduce_factor: dllResult.reduceSizeFactor, reduce_threshold: dllResult.reduceThreshold } as Record<string, unknown>,
            correlationId: correlationId ?? null,
          }).catch((e: unknown) => {
            logger.warn({ e, action: "sizing.dll_reduce_size_band_entered" }, "audit write failed — non-blocking");
            auditWriteFailuresTotal.labels({ action: "sizing.dll_reduce_size_band_entered" }).inc();
          });
        }
      } catch (dllErr) {
        // Fail-CLOSED: loss-throttling gate must not allow entry when data is unavailable.
        // Institutional standard: unknown combined P&L = assume worst case and block.
        dllHaltBlocked = true;
        logger.error({ err: dllErr, sessionId, symbol }, "W23H.F: cross-symbol DLL gate error — fail-CLOSED, blocking entry");
        insertAuditRow({
          action: "consistency.cross_symbol_dll_failclosed",
          entityType: "paper_session",
          entityId: sessionId,
          decisionAuthority: "system",
          status: "warning",
          input: { sessionId, symbol, error: String(dllErr) } as Record<string, unknown>,
          result: { blocked: true, reason: "cross_symbol_dll_gate_error" } as Record<string, unknown>,
          correlationId: correlationId ?? null,
        }).catch((e: unknown) => {
          logger.warn({ e, action: "consistency.cross_symbol_dll_failclosed" }, "audit write failed — non-blocking");
          auditWriteFailuresTotal.labels({ action: "consistency.cross_symbol_dll_failclosed" }).inc();
        });
      }
    }

    // ─── Wave 26 Pass K Phase 1 (2026-05-26) — Daily Trade Cap (1-2 A+ trades/day) ──
    // Hard signal-time gate enforcing operator's "1-2 A+ trades/day per account"
    // mandate (CLAUDE.md §4 / memory pin project_one_aplus_trade_per_day). The
    // post-fill Python kill switch already enforces sessionCfg.max_trades_per_day
    // but only when that per-session field is set — and most sessions don't set
    // it. This gate enforces the framework default (TF_MAX_TRADES_PER_DAY=2)
    // at SIGNAL TIME so the 3rd signal of the day never reaches openPosition.
    //
    // Counting: paper_trades rows CLOSED on the current CME futures trading day
    // (same date convention as paper-execution-service.ts:925). Per-session
    // scope — each prop-firm account has its own quota.
    //
    // Precedence: sessionRow.max_trades_per_day (if set + positive) > env default.
    // Fail-OPEN: DB error → allow the trade through + warn audit (better to let
    // a 3rd trade slip on rare infra failure than silently halt trading).
    let dailyTradeCapBlocked = false;
    try {
      const capTodayEt = toFuturesTradingDayString(new Date(bar.timestamp));
      const [capRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(paperTrades)
        .where(and(
          eq(paperTrades.sessionId, sessionId),
          sql`to_char(${paperTrades.exitTime} AT TIME ZONE 'America/New_York' + interval '7 hours', 'YYYY-MM-DD') = ${capTodayEt}`,
        ));
      const tradesToday = capRow?.count ?? 0;
      // Per-session cap lives inside paper_sessions.config JSONB (max_trades_per_day),
      // matching paper-execution-service.ts:913 conventions. Null → fall through to env default.
      const sessionCfgRaw = (sessionRow as { config?: { max_trades_per_day?: number | null } }).config;
      const perSessionCap = sessionCfgRaw?.max_trades_per_day != null
        ? Number(sessionCfgRaw.max_trades_per_day)
        : null;
      const capResult = evaluateDailyTradeCap({
        tradesToday,
        perSessionCap,
        envDefault: getDailyTradeCapEnvDefault(),
      });
      if (!capResult.allow) {
        dailyTradeCapBlocked = true;
        span.setAttribute("daily_trade_cap_blocked", true);
        span.setAttribute("daily_trade_cap_effective", capResult.effectiveCap);
        span.setAttribute("daily_trade_cap_trades_today", capResult.tradesToday);
        logger.info(
          { sessionId, symbol, tradesToday, effectiveCap: capResult.effectiveCap, reason: capResult.reason },
          "Wave 26 Pass K: daily trade cap reached — blocking new entry signal",
        );
        insertAuditRow({
          action: "consistency.daily_trade_cap_blocked",
          entityType: "paper_session",
          entityId: sessionId,
          decisionAuthority: "system",
          status: "info",
          input: { symbol, perSessionCap, envDefault: getDailyTradeCapEnvDefault(), trades_today: tradesToday },
          result: { effective_cap: capResult.effectiveCap, reason: capResult.reason },
          correlationId: correlationId ?? null,
        }).catch((e: unknown) => {
          logger.warn({ e, action: "consistency.daily_trade_cap_blocked" }, "audit write failed — non-blocking");
          auditWriteFailuresTotal.labels({ action: "consistency.daily_trade_cap_blocked" }).inc();
        });
      }
    } catch (capErr) {
      // Fail-OPEN per CLAUDE.md §4 documented policy: let trade slip rather than
      // silently halt. Emit a visible warn audit so the fail-open is observable.
      logger.warn({ err: capErr, sessionId, symbol }, "Wave 26 Pass K: daily trade cap query error — fail-open, proceeding");
      insertAuditRow({
        action: "consistency.daily_trade_cap_failopen",
        entityType: "paper_session",
        entityId: sessionId,
        decisionAuthority: "system",
        status: "warning",
        input: { sessionId, symbol, error: String(capErr) } as Record<string, unknown>,
        result: { allowed: true, reason: "daily_trade_cap_db_error_fail_open" } as Record<string, unknown>,
        correlationId: correlationId ?? null,
      }).catch((e: unknown) => {
        logger.warn({ e, action: "consistency.daily_trade_cap_failopen" }, "audit write failed — non-blocking");
        auditWriteFailuresTotal.labels({ action: "consistency.daily_trade_cap_failopen" }).inc();
      });
    }

    // ─── Wave 26 Pass K Phase 2 (2026-05-26) — Lunch Blackout Gate (11:30-13:30 ET) ──
    // Hard signal-time gate rejecting all entries inside the institutional 2026
    // lunch dead zone. Backed by Tradeify 13-yr prop firm dataset (>60% false-
    // breakout rate from 11:30 ET), Tradecovex hour-by-hour ("the worst hours
    // of the day, do not trade at all"), TradingStats.net 12,095-day study
    // (lunch only 4.5% of NQ HODs vs PM 35%). Default 11:30-13:30 ET; configurable
    // via LUNCH_BLACKOUT_START_ET / LUNCH_BLACKOUT_END_ET env vars.
    //
    // Per-strategy override: entry_quality.lunch_blackout_disabled=true bypasses
    // the gate. Reserved for mean-reversion archetypes targeting compressed-vol
    // lunch (QUANTUITION 2026-05 SPX scalp study). NEVER enable on trend-following
    // or structural-setup strategies.
    //
    // Fail-CLOSED on malformed window config (opposite of daily trade cap fail-OPEN
    // policy — better to halt trading on misconfig than silently re-enable a known-bad
    // time window). Config-error reason captured in audit row.
    let lunchBlackoutBlocked = false;
    try {
      const perStrategyDisabled =
        ((config as { entry_quality?: { lunch_blackout_disabled?: boolean } }).entry_quality
          ?.lunch_blackout_disabled) === true;
      const lunchResult = evaluateLunchBlackoutGate({
        barTsUtc: new Date(bar.timestamp),
        startEt: getLunchBlackoutStartEnvDefault(),
        endEt: getLunchBlackoutEndEnvDefault(),
        perStrategyDisabled,
      });
      if (lunchResult.block) {
        lunchBlackoutBlocked = true;
        span.setAttribute("lunch_blackout_blocked", true);
        span.setAttribute("lunch_blackout_window", lunchResult.windowSpec);
        logger.info(
          { sessionId, symbol, windowSpec: lunchResult.windowSpec, reason: lunchResult.reason },
          "Wave 26 Pass K: lunch blackout (11:30-13:30 ET institutional dead zone) — blocking new entry signal",
        );
        insertAuditRow({
          action: "consistency.lunch_blackout_blocked",
          entityType: "paper_session",
          entityId: sessionId,
          decisionAuthority: "system",
          status: "info",
          input: { symbol, window_spec: lunchResult.windowSpec, bar_timestamp: bar.timestamp, per_strategy_disabled: perStrategyDisabled },
          result: { reason: lunchResult.reason, per_strategy_override_applied: lunchResult.perStrategyOverrideApplied },
        }).catch((e: unknown) => {
          logger.warn({ e, action: "consistency.lunch_blackout_blocked" }, "audit write failed — non-blocking");
          auditWriteFailuresTotal.labels({ action: "consistency.lunch_blackout_blocked" }).inc();
        });
      } else if (lunchResult.perStrategyOverrideApplied) {
        // Per-strategy override fired — emit info audit for observability (operator
        // can monitor which strategies are bypassing the institutional default).
        insertAuditRow({
          action: "consistency.lunch_blackout_per_strategy_override",
          entityType: "paper_session",
          entityId: sessionId,
          decisionAuthority: "system",
          status: "info",
          input: { symbol, strategy_id: sessionConfig.strategyId, window_spec: lunchResult.windowSpec },
          result: { reason: lunchResult.reason },
        }).catch((e: unknown) => {
          logger.warn({ e, action: "consistency.lunch_blackout_per_strategy_override" }, "audit write failed — non-blocking");
          auditWriteFailuresTotal.labels({ action: "consistency.lunch_blackout_per_strategy_override" }).inc();
        });
      }
    } catch (lunchErr) {
      // Fail-CLOSED: the lunch blackout gate guards a known-bad time window. An
      // unexpected JS error means we cannot verify the window is clear — treat it
      // as "inside blackout" per institutional standard for loss-throttling gates.
      lunchBlackoutBlocked = true;
      logger.error({ err: lunchErr, sessionId, symbol }, "Wave 26 Pass K: lunch blackout gate unexpected error — fail-CLOSED, blocking entry");
      insertAuditRow({
        action: "consistency.lunch_blackout_failclosed",
        entityType: "paper_session",
        entityId: sessionId,
        decisionAuthority: "system",
        status: "warning",
        input: { sessionId, symbol, error: String(lunchErr) } as Record<string, unknown>,
        result: { blocked: true, reason: "lunch_blackout_gate_unexpected_error" } as Record<string, unknown>,
        correlationId: correlationId ?? null,
      }).catch((e: unknown) => {
        logger.warn({ e, action: "consistency.lunch_blackout_failclosed" }, "audit write failed — non-blocking");
        auditWriteFailuresTotal.labels({ action: "consistency.lunch_blackout_failclosed" }).inc();
      });
    }

    // ─── FIX A (2026-06-22): Consistency gate — Topstep + MFFU 50% single-day rule ──
    // Placed AFTER DLL gate, BEFORE position sizing. Checks whether the highest single-day
    // profit / cycle cumulative profit >= 50% (which would cause payout denial at eval).
    // Emits warn at 40% and blocks at 50%.
    //
    // Scope: only fires for sessions whose firmId is in CONSISTENCY_RULE_FIRMS
    //   (topstep, mffu). Sessions from unknown/unrelated firms pass through.
    //
    // Fail-OPEN policy (consistent with daily-trade-cap precedent): this is a
    //   payout-eligibility gate, NOT a loss gate. A DB error → emit warn audit but
    //   do NOT block the entry. Missing a block is not account-fatal.
    let consistencyBlocked = false;
    const sessionFirmId = sessionRow.firmId ?? "";
    // 2026-06-23: the single-day consistency rule is an EVAL / Consistency-payout-lane rule —
    // NOT the funded Standard lane (operator's choice). Default OFF; opt-in per-account/env for
    // the eval phase or the Consistency lane. See consistency-lane.ts.
    const consistencyEnforced = resolveConsistencyEnforced(
      sessionConfig.config as unknown as Record<string, unknown>,
    );
    if (CONSISTENCY_RULE_FIRMS.includes(sessionFirmId) && consistencyEnforced) {
      try {
        const consistencyResult = await consistencyGateShouldBlock(
          sessionId,                    // used as cache key and audit entityId
          1.0,                          // projectedTradeProfitR (conservative: 1R)
          0,                            // currentRiskUsd: 0 at gate time (sizing runs later);
          //                              the critical check is state.gateState === "block_50"
          //                              (already blocked at 50%); projected math needs risk $
          //                              which is not yet computed. Using 0 means wouldTriggerBlock
          //                              only fires if today's existing profit already >= 50%.
        );
        if (consistencyResult.block) {
          consistencyBlocked = true;
          span.setAttribute("consistency_gate_blocked", true);
          span.setAttribute("consistency_gate_reason", consistencyResult.reason);
          logger.info(
            { sessionId, symbol, firmId: sessionFirmId, reason: consistencyResult.reason },
            "FIX A: consistency gate BLOCKED — 50% single-day concentration limit reached",
          );
          insertAuditRow({
            action: "consistency.50pct_blocked",
            entityType: "paper_session",
            entityId: sessionId,
            decisionAuthority: "system",
            status: "failure",
            input: { sessionId, symbol, firmId: sessionFirmId } as Record<string, unknown>,
            result: { blocked: true, reason: consistencyResult.reason } as Record<string, unknown>,
            correlationId: correlationId ?? null,
          }).catch((e: unknown) => {
            logger.warn({ e, action: "consistency.50pct_blocked" }, "audit write failed — non-blocking");
            auditWriteFailuresTotal.labels({ action: "consistency.50pct_blocked" }).inc();
          });
        } else {
          // Emit gate_cleared or 40pct_warned depending on gate state
          const auditAction = consistencyResult.reason === "ok"
            ? "consistency.gate_cleared"
            : "consistency.40pct_warned";
          if (auditAction === "consistency.40pct_warned") {
            logger.warn(
              { sessionId, symbol, firmId: sessionFirmId, reason: consistencyResult.reason },
              "FIX A: consistency gate WARN — approaching 40% single-day concentration",
            );
          }
          insertAuditRow({
            action: auditAction,
            entityType: "paper_session",
            entityId: sessionId,
            decisionAuthority: "system",
            status: "info",
            input: { sessionId, symbol, firmId: sessionFirmId } as Record<string, unknown>,
            result: { blocked: false, reason: consistencyResult.reason } as Record<string, unknown>,
            correlationId: correlationId ?? null,
          }).catch((e: unknown) => {
            logger.warn({ e, action: auditAction }, "audit write failed — non-blocking");
            auditWriteFailuresTotal.labels({ action: auditAction }).inc();
          });
        }
      } catch (consistencyErr) {
        // Fail-OPEN: payout-eligibility gate — a DB error does NOT block entry.
        // Emit visible warn audit so operator can investigate DB issues separately.
        consistencyBlocked = false;
        logger.warn(
          { err: consistencyErr, sessionId, symbol, firmId: sessionFirmId },
          "FIX A: consistency gate DB error — fail-OPEN, proceeding (payout-eligibility gate, not loss gate)",
        );
        insertAuditRow({
          action: "consistency.gate_failopen",
          entityType: "paper_session",
          entityId: sessionId,
          decisionAuthority: "system",
          status: "warning",
          input: { sessionId, symbol, firmId: sessionFirmId, error: String(consistencyErr) } as Record<string, unknown>,
          result: { blocked: false, reason: "consistency_gate_db_error_fail_open" } as Record<string, unknown>,
          correlationId: correlationId ?? null,
        }).catch((e: unknown) => {
          logger.warn({ e, action: "consistency.gate_failopen" }, "audit write failed — non-blocking");
          auditWriteFailuresTotal.labels({ action: "consistency.gate_failopen" }).inc();
        });
      }
    }

    // ─── Tier 5.3: 24-hour lockout gate ─────────────────────────────────
    // Runs BEFORE anti-setup and risk gate. If a strategy lockout is active
    // (written by writeLockoutFromKillEvent on daily_loss_kill), block all
    // new entry signals until the lockout expires.
    // Fail-OPEN: lockout query errors return null so trading is not blocked.
    // W23H.H/F: symbol whitelist, pre-market blackout, and DLL halt are treated as
    // early lockouts (same short-circuit pattern — downstream gates all check lockoutBlocked).
    let lockoutBlocked = symbolWhitelistBlocked || blackoutBlocked || dllHaltBlocked || dailyTradeCapBlocked || lunchBlackoutBlocked || consistencyBlocked;
    try {
      const activeLockout = await getActiveLockout(sessionConfig.strategyId);
      if (activeLockout) {
        lockoutBlocked = true;
        span.setAttribute("lockout_blocked", true);
        span.setAttribute("lockout_reason", activeLockout.reason);
        span.setAttribute("lockout_until", activeLockout.lockedUntil.toISOString());
        logger.info(
          {
            sessionId,
            symbol,
            strategyId: sessionConfig.strategyId,
            lockoutId: activeLockout.id,
            lockedUntil: activeLockout.lockedUntil.toISOString(),
            reason: activeLockout.reason,
          },
          "Tier 5.3: entry blocked — active strategy lockout (24h compliance pause)",
        );
        db.insert(paperSignalLogs).values({
          sessionId,
          symbol,
          direction: config.side,
          signalType: "lockout_blocked",
          price: String(bar.close),
          indicatorSnapshot: {
            ...indicators,
            _lockout_id: activeLockout.id,
            _lockout_reason: activeLockout.reason,
            _lockout_until: activeLockout.lockedUntil.toISOString(),
          },
          acted: false,
          reason: `lockout_blocked: ${activeLockout.reason} (expires ${activeLockout.lockedUntil.toISOString()})`,
        }).catch((err: unknown) => logger.error({ err, sessionId }, "Failed to persist lockout block log"));
      }
    } catch (lockoutErr) {
      logger.warn({ err: lockoutErr, sessionId, symbol }, "Tier 5.3: lockout gate error — fail-open, proceeding");
    }

    // ─── Tier 5.3.1: Correlated Position Guard ──────────────
    // Blocks new entry if any open position (cross-session) is correlated
    // > threshold with the proposed symbol. Closes the Tier 3.3 lead-lag
    // compliance gap: cross-market signals are legal; CONCURRENT correlated
    // positions are a prop firm violation (position-limit bypass).
    // Fail-OPEN: query errors do not block trading.
    let correlatedBlocked = lockoutBlocked; // short-circuit if already blocked
    if (!lockoutBlocked) {
      try {
        // Query ALL open positions across sessions for cross-symbol guard.
        // deep-scan long-tail F-4: also fetch firmId + strategyId per open position (via the session join)
        // and pass the proposed entry's firmId/strategyId, so the Topstep same-operator multi-account
        // exception (correlated-position-guard §F-3) can actually fire — previously the call passed only
        // (symbol, positions) with no firm/strategy context, making the exception unreachable dead code and
        // wrongly blocking the operator's own Topstep multi-account copy (allowed per CLAUDE.md §6/§9).
        const allOpenPositions = await db
          .select({
            symbol: paperPositions.symbol,
            firmId: paperSessions.firmId,
            strategyId: paperSessions.strategyId,
          })
          .from(paperPositions)
          .innerJoin(paperSessions, eq(paperPositions.sessionId, paperSessions.id))
          .where(isNull(paperPositions.closedAt));

        const correlGuard = checkCorrelatedPositionGuard(
          symbol,
          allOpenPositions,
          null,                     // matrixOverride — use the loaded correlation matrix
          sessionFirmId,            // proposedFirmId
          undefined,                // proposedUserId — single-operator deployment (§9: family = separate deployments); not tracked
          sessionConfig.strategyId, // proposedStrategyId
        );
        if (!correlGuard.allowed) {
          correlatedBlocked = true;
          span.setAttribute("correlated_position_blocked", true);
          span.setAttribute("correlated_blocking_symbol", correlGuard.blockingSymbol ?? "");
          span.setAttribute("correlated_correlation", correlGuard.blockingCorrelation ?? 0);
          logger.info(
            {
              sessionId,
              symbol,
              blockingSymbol: correlGuard.blockingSymbol,
              blockingCorrelation: correlGuard.blockingCorrelation,
              threshold: correlGuard.threshold,
              reason: KILL_REASON_CORRELATED_POSITION_OPEN,
            },
            "Tier 5.3.1: entry blocked — correlated position open (compliance.correlated_position_blocked)",
          );
          db.insert(paperSignalLogs).values({
            sessionId,
            symbol,
            direction: config.side,
            signalType: "correlated_position_blocked",
            price: String(bar.close),
            indicatorSnapshot: {
              ...indicators,
              _blocking_symbol: correlGuard.blockingSymbol,
              _blocking_correlation: correlGuard.blockingCorrelation,
              _correlation_threshold: correlGuard.threshold,
            },
            acted: false,
            reason: `correlated_position_blocked: open ${correlGuard.blockingSymbol} (corr=${correlGuard.blockingCorrelation?.toFixed(3)})`,
          }).catch((err: unknown) => logger.error({ err, sessionId }, "Failed to persist correlated position block log"));
        }
      } catch (correlErr) {
        logger.warn({ err: correlErr, sessionId, symbol }, "Tier 5.3.1: guard query error — fail-open, proceeding");
      }
    }

    // ─���─ Anti-setup gate: check if known bad pattern blocks entry ──
    // Anti-setup gate short-circuits if lockout or correlated position guard is already active
    // ─── Tier 5.3.2: Cross-account hedge gate (Topstep Prohibited Conduct) ──
    // Topstep bans holding OPPOSITE positions across your multiple accounts (single-user
    // cross-account hedging). Block a new entry that would be opposite to an open position on
    // the SAME UNDERLYING in another account of this firm. Fail-OPEN on DB error.
    let crossAccountHedgeBlocked = lockoutBlocked || correlatedBlocked;
    if (!crossAccountHedgeBlocked) {
      const hedge = await checkCrossAccountHedge(sessionRow.firmId, symbol, config.side, sessionId);
      if (hedge.blocked) {
        crossAccountHedgeBlocked = true;
        span.setAttribute("cross_account_hedge_blocked", true);
        span.setAttribute("cross_account_hedge_underlying", hedge.conflictUnderlying ?? "");
        logger.info(
          { sessionId, symbol, firmId: sessionRow.firmId, conflictUnderlying: hedge.conflictUnderlying, conflictSide: hedge.conflictSide, conflictSessionId: hedge.conflictSessionId },
          "Tier 5.3.2: entry blocked — cross-account hedge (Topstep prohibited conduct: opposite positions across accounts)",
        );
        db.insert(paperSignalLogs).values({
          sessionId, symbol, direction: config.side, signalType: "cross_account_hedge_blocked",
          price: String(bar.close),
          indicatorSnapshot: { ...indicators, _hedge_underlying: hedge.conflictUnderlying, _hedge_conflict_side: hedge.conflictSide, _hedge_conflict_session: hedge.conflictSessionId },
          acted: false,
          reason: `cross_account_hedge_blocked: open ${hedge.conflictSide} on ${hedge.conflictUnderlying} in another account`,
          correlationId: correlationId ?? null,  // ds21-w2: trace linkage
        }).catch((err: unknown) => logger.error({ err, sessionId }, "Failed to persist cross-account hedge block log"));
        insertAuditRow({
          action: "compliance.cross_account_hedge_blocked",
          entityType: "paper_session", entityId: sessionId, decisionAuthority: "system", status: "blocked",
          input: { sessionId, symbol, firmId: sessionRow.firmId, side: config.side } as Record<string, unknown>,
          result: { blocked: true, conflictUnderlying: hedge.conflictUnderlying, conflictSide: hedge.conflictSide } as Record<string, unknown>,
          correlationId: correlationId ?? null,
        }).catch((e: unknown) => {
          logger.warn({ e, action: "compliance.cross_account_hedge_blocked" }, "audit write failed — non-blocking");
          auditWriteFailuresTotal.labels({ action: "compliance.cross_account_hedge_blocked" }).inc();
        });
      }
    }

    // ─── Tier 5.3.2b: Intra-account hedge gate (MFFU Fair Play §5 / hedgingSameUnderlyingBanned) ──
    // MFFU bans hedging = buy + sell on the SAME UNDERLYING at the same time within ONE account
    // (their example: MNQ + NQ share underlying NQ). The cross-account gate above excludes the
    // current session; this catches an opposite-side open position on the same underlying in the
    // SAME account (e.g. one strategy long MNQ while another is short NQ). Firm-agnostic defense —
    // a same-underlying opposite-side pair is never a real position for our day-trade bot. Fail-OPEN.
    if (!crossAccountHedgeBlocked) {
      const intra = await checkIntraAccountHedge(sessionId, symbol, config.side);
      if (intra.blocked) {
        crossAccountHedgeBlocked = true;
        span.setAttribute("intra_account_hedge_blocked", true);
        span.setAttribute("intra_account_hedge_underlying", intra.conflictUnderlying ?? "");
        logger.info(
          { sessionId, symbol, firmId: sessionRow.firmId, conflictUnderlying: intra.conflictUnderlying, conflictSide: intra.conflictSide },
          "Tier 5.3.2b: entry blocked — intra-account hedge (MFFU §5: buy+sell same underlying, one account)",
        );
        db.insert(paperSignalLogs).values({
          sessionId, symbol, direction: config.side, signalType: "intra_account_hedge_blocked",
          price: String(bar.close),
          indicatorSnapshot: { ...indicators, _hedge_underlying: intra.conflictUnderlying, _hedge_conflict_side: intra.conflictSide },
          acted: false,
          reason: `intra_account_hedge_blocked: open ${intra.conflictSide} on ${intra.conflictUnderlying} in same account`,
        }).catch((err: unknown) => logger.error({ err, sessionId }, "Failed to persist intra-account hedge block log"));
        insertAuditRow({
          action: "compliance.intra_account_hedge_blocked",
          entityType: "paper_session", entityId: sessionId, decisionAuthority: "system", status: "blocked",
          input: { sessionId, symbol, firmId: sessionRow.firmId, side: config.side } as Record<string, unknown>,
          result: { blocked: true, conflictUnderlying: intra.conflictUnderlying, conflictSide: intra.conflictSide } as Record<string, unknown>,
          correlationId: correlationId ?? null,
        }).catch((e: unknown) => {
          logger.warn({ e, action: "compliance.intra_account_hedge_blocked" }, "audit write failed — non-blocking");
          auditWriteFailuresTotal.labels({ action: "compliance.intra_account_hedge_blocked" }).inc();
        });
      }
    }

    // ─── Tier 5.3.3: Price-lock limit gate (Topstep Prohibited Conduct) ──────
    // Topstep bans holding a position within 2% of a product's daily price-lock limit. The
    // reference (prior settlement) is best-effort; FAIL-OPEN when unavailable — intraday
    // structural trades are essentially never within 2% of a ±7% limit, so a missing reference
    // must not halt trading. TODO: wire the daily settlement feed for full enforcement.
    let priceLockBlocked = lockoutBlocked || correlatedBlocked || crossAccountHedgeBlocked;
    if (!priceLockBlocked) {
      const refSettlement = (indicators["prior_settlement"] ?? indicators["daily_reference"] ?? null) as number | null;
      const lock = checkPriceLockLimit(symbolToUnderlying(symbol), bar.close, refSettlement);

      // deepscan14 D2: `lock.inactive` means "no settlement feed — nothing was
      // checked", distinct from `lock.blocked=false` meaning "checked, price is
      // clear." Surface it as rate-limited (once/session/day) telemetry so the
      // operator can see the gate is dark instead of reading it as a clean pass.
      if (lock.inactive) {
        const todayKey = new Date().toISOString().slice(0, 10);
        if (priceLockGateInactiveTelemetryLastFired.get(sessionId) !== todayKey) {
          priceLockGateInactiveTelemetryLastFired.set(sessionId, todayKey);
          insertAuditRow({
            action: "price_lock.gate_inactive_no_feed",
            entityType: "paper_session", entityId: sessionId, decisionAuthority: "system", status: "success",
            input: { sessionId, symbol } as Record<string, unknown>,
            result: { inactive: true, reason: lock.reason ?? "no_reference" } as Record<string, unknown>,
            correlationId: correlationId ?? null,
          }).catch((e: unknown) => {
            logger.warn({ e, action: "price_lock.gate_inactive_no_feed" }, "audit write failed — non-blocking");
            auditWriteFailuresTotal.labels({ action: "price_lock.gate_inactive_no_feed" }).inc();
          });
        }
      }

      if (lock.blocked) {
        priceLockBlocked = true;
        span.setAttribute("price_lock_limit_blocked", true);
        span.setAttribute("price_lock_reason", lock.reason ?? "");
        logger.info(
          { sessionId, symbol, price: bar.close, reason: lock.reason, limitUp: lock.limitUp, limitDown: lock.limitDown },
          "Tier 5.3.3: entry blocked — within 2% of price-lock limit (Topstep prohibited conduct)",
        );
        db.insert(paperSignalLogs).values({
          sessionId, symbol, direction: config.side, signalType: "price_lock_limit_blocked",
          price: String(bar.close),
          indicatorSnapshot: { ...indicators, _price_lock_reason: lock.reason, _limit_up: lock.limitUp, _limit_down: lock.limitDown },
          acted: false,
          reason: `price_lock_limit_blocked: ${lock.reason} (price ${bar.close})`,
        }).catch((err: unknown) => logger.error({ err, sessionId }, "Failed to persist price-lock block log"));
        insertAuditRow({
          action: "compliance.price_lock_limit_blocked",
          entityType: "paper_session", entityId: sessionId, decisionAuthority: "system", status: "blocked",
          input: { sessionId, symbol, price: bar.close } as Record<string, unknown>,
          result: { blocked: true, reason: lock.reason } as Record<string, unknown>,
          correlationId: correlationId ?? null,
        }).catch((e: unknown) => {
          logger.warn({ e, action: "compliance.price_lock_limit_blocked" }, "audit write failed — non-blocking");
          auditWriteFailuresTotal.labels({ action: "compliance.price_lock_limit_blocked" }).inc();
        });
      }
    }

    // ─── Anti-setup gate: check if known bad pattern blocks entry ──
    let antiSetupBlocked = lockoutBlocked || correlatedBlocked || crossAccountHedgeBlocked || priceLockBlocked;
    let antiSetupResult: AntiSetupGateResult | null = null;
    try {
      antiSetupResult = await checkAntiSetupGate(
        sessionConfig.strategyId,
        {
          time: bar.timestamp,
          hour: new Date(bar.timestamp).getHours(),
          atr: indicators["atr_14"],
          volume: bar.volume,
          regime: indicators["regime"] as unknown as string | undefined,
          // FG-3: anti-setup day_of_week rules are mined under Python's
          // datetime.weekday() convention (Mon=0..Sun=6, see
          // src/engine/anti_setups/miner.py:_get_day_of_week). JS Date.getDay()
          // is Sun=0..Sat=6, which shifted every day-of-week rule by one weekday.
          // Convert to the Python weekday convention (matching the sibling skip
          // path at ~line 286 which already uses getUTCDay()).
          day_of_week: toPythonWeekday(bar.timestamp),
        },
      );
      if (antiSetupResult.blocked) {
        antiSetupBlocked = true;
        span.setAttribute("anti_setup_blocked", true);
        span.setAttribute("anti_setup_rule", antiSetupResult.matchedRule ?? "unknown");
        logger.info(
          { sessionId, symbol, rule: antiSetupResult.matchedRule, confidence: antiSetupResult.confidence },
          "Anti-setup gate BLOCKED entry — logging shadow signal for effectiveness tracking",
        );
        // Log to paper_signal_logs for auditability
        db.insert(paperSignalLogs).values({
          sessionId,
          symbol,
          direction: config.side,
          signalType: "anti_setup_blocked",
          price: String(bar.close),
          indicatorSnapshot: {
            ...indicators,
            _anti_setup_rule: antiSetupResult.matchedRule,
            _anti_setup_confidence: antiSetupResult.confidence,
            _anti_setup_condition: antiSetupResult.matchedCondition,
            _anti_setup_filter: antiSetupResult.matchedFilter,
          },
          acted: false,
          reason: `anti_setup_blocked: ${antiSetupResult.matchedRule ?? "unknown"} (confidence: ${antiSetupResult.confidence?.toFixed(2) ?? "?"})`,
        }).catch((err: unknown) => logger.error({ err, sessionId }, "Failed to persist anti-setup block log"));

        // Log to shadow_signals for hypothetical P&L tracking
        // theoreticalPnl will be computed by the weekly effectiveness job
        db.insert(shadowSignals).values({
          sessionId,
          signalTime: new Date(bar.timestamp),
          direction: config.side,
          expectedEntry: String(bar.close),
          actualMarketPrice: String(bar.close),
          wouldHaveFilled: true, // assume market order would fill
        }).catch((err: unknown) => logger.error({ err, sessionId }, "Failed to persist anti-setup shadow signal"));

        broadcastSSE("anti-setup:blocked", {
          sessionId,
          symbol,
          rule: antiSetupResult.matchedRule,
          confidence: antiSetupResult.confidence,
          price: bar.close,
          timestamp: bar.timestamp,
        });
      }
    } catch (antiSetupErr) {
      // Anti-setup gate is fail-open: if it errors, do NOT block the trade.
      logger.error({ err: antiSetupErr, sessionId, symbol }, "Anti-setup gate error — fail-open, proceeding with entry");
      span.setAttribute("anti_setup_gate_error", true);
    }

    if (antiSetupBlocked) {
      // Signal was blocked by anti-setup — skip downstream gates.
      // Shadow signal is already persisted for effectiveness analysis.
      riskGatePassed = false;
    } else {

      // ─── Wave 23.C Stage 1: Active-strategy gate ───────────────────────────
      // Block entry if today's bias engine selected a DIFFERENT strategy as active
      // for this symbol+regime.  Legacy strategies (legacy_no_confluence provenance
      // or no entry_quality block) bypass this gate — they are regime-agnostic.
      //
      // Fail-open: if biasState is null (engine failed earlier) → no block.
      // Audit: signal.not_active_strategy_for_regime on block.
      const rawConfig = config as unknown as Record<string, unknown>;
      // Deep-scan #22 Z6 (2026-07-09): entryQuality/isLegacyStrategy/useWeightedScoring/
      // usePerStrategy/customIndicators are all computed once here via the extracted pure
      // resolveConfluenceDispatch() leaf (src/server/lib/confluence-path-resolver.ts) —
      // BEHAVIOR-PRESERVING extraction of what was previously three separate inline
      // computations (entryQuality read + isLegacyStrategy here; useWeightedScoring at the
      // former :4363; customIndicators/usePerStrategy at the former :4767-4768). Nothing
      // mutates rawConfig/entryQuality between here and those original call sites, so
      // hoisting the computation is byte-identical — the values are read, not recomputed,
      // at their original use sites below.
      const { entryQuality, isLegacyStrategy, useWeightedScoring, usePerStrategy, customIndicators } =
        resolveConfluenceDispatch(rawConfig);

      let stage1Blocked = false;
      if (!isLegacyStrategy && biasState && biasState.activeStrategyId !== null) {
        if (biasState.activeStrategyId !== sessionConfig.strategyId) {
          stage1Blocked = true;
          span.setAttribute("bias_gate_stage1_blocked", true);
          span.setAttribute("bias_active_strategy_id", biasState.activeStrategyId);
          logger.info(
            {
              sessionId,
              symbol,
              thisStrategyId: sessionConfig.strategyId,
              activeStrategyId: biasState.activeStrategyId,
              regimeLabel: biasState.regimeLabel,
              playbook: biasState.playbook,
            },
            "Wave 23.C Stage 1: entry blocked — not active strategy for regime",
          );
          db.insert(paperSignalLogs).values({
            sessionId,
            symbol,
            direction: config.side,
            signalType: "bias_gate_blocked_not_active_strategy",
            price: String(bar.close),
            indicatorSnapshot: {
              ...indicators,
              _bias_active_strategy_id: biasState.activeStrategyId,
              _bias_regime: biasState.regimeLabel,
              _bias_playbook: biasState.playbook,
              _this_strategy_id: sessionConfig.strategyId,
            },
            acted: false,
            reason: `signal.not_active_strategy_for_regime: active=${biasState.activeStrategyId} this=${sessionConfig.strategyId} regime=${biasState.regimeLabel}`,
          }).catch((err: unknown) => logger.error({ err, sessionId }, "Failed to persist bias stage1 block log"));
        }
      }

      // ─── W23H.E: Position-lock gate (10am regime-flip policy) ────────────
      // When the 10am refresh changed the active strategy (positionLockActive=true),
      // AND this session IS running the NEW active strategy, AND a position on the
      // PRIOR strategy is still open somewhere — block new entries on this session.
      //
      // The prior strategy's session continues to manage its open position normally
      // (stop-loss, trailing stop, exit signals — managed in the position block above).
      // Kill-switch override always supersedes this gate (kill switch fires first).
      //
      // Fail-open: DB query failure → no block (don't prevent trading on query errors).
      if (!stage1Blocked && biasState?.positionLockActive && biasState.activeStrategyId === sessionConfig.strategyId) {
        try {
          // Check if any OTHER session has an open position on the prior strategy
          // (prior strategy = any session NOT matching the new active strategy)
          const openPositionsOnPriorStrategy = await db
            .select({ id: paperPositions.id, symbol: paperPositions.symbol, sessionId: paperPositions.sessionId })
            .from(paperPositions)
            .innerJoin(paperSessions, eq(paperSessions.id, paperPositions.sessionId))
            .where(
              and(
                isNull(paperPositions.closedAt),
                // Session is running a strategy OTHER than the new active strategy
                ne(paperSessions.strategyId, sessionConfig.strategyId),
              ),
            )
            .limit(1);

          if (openPositionsOnPriorStrategy.length > 0) {
            const priorPosition = openPositionsOnPriorStrategy[0];
            stage1Blocked = true;
            span.setAttribute("position_lock_blocked", true);
            span.setAttribute("position_lock_prior_position_id", priorPosition.id);
            logger.info(
              {
                sessionId,
                symbol,
                strategyId: sessionConfig.strategyId,
                priorPositionId: priorPosition.id,
                priorPositionSessionId: priorPosition.sessionId,
                newActiveStrategyId: biasState.activeStrategyId,
              },
              "W23H.E: entry blocked — position_lock_active: prior strategy has open position; blocking new entries until prior position closes",
            );
            db.insert(paperSignalLogs).values({
              sessionId,
              symbol,
              direction: config.side,
              signalType: "position_lock_blocked",
              price: String(bar.close),
              indicatorSnapshot: {
                ...indicators,
                _prior_position_id: priorPosition.id,
                _prior_session_id: priorPosition.sessionId,
                _new_active_strategy_id: biasState.activeStrategyId,
                _position_lock_active: true,
              },
              acted: false,
              reason: `signal.blocked_position_lock_active: prior_position=${priorPosition.id} new_strategy=${biasState.activeStrategyId}`,
            }).catch((err: unknown) => logger.error({ err, sessionId }, "Failed to persist position_lock block log"));
            // W24P1 Item 5: mirror skip to audit_log
            insertAuditRow({
              action: "signal.blocked_position_lock_active",
              entityType: "signal",
              entityId: sessionId,
              decisionAuthority: "system",
              input: {
                sessionId,
                symbol,
                prior_position_id: priorPosition.id,
                prior_session_id: priorPosition.sessionId,
                new_active_strategy_id: biasState.activeStrategyId,
              } as Record<string, unknown>,
              result: { blocked: true, reason: "prior_strategy_has_open_position" } as Record<string, unknown>,
              status: "success",
              correlationId: correlationId ?? null,
            }).catch((err: unknown) => logger.warn({ err, sessionId }, "audit_log insert failed for signal.blocked_position_lock_active"));
          }
          // else: no open positions on prior strategy → lock condition already cleared;
          // standard Stage 1 behavior continues (no block from this gate).
        } catch (lockGateErr) {
          // Fail-open: never block trading due to query errors
          logger.warn({ err: lockGateErr, sessionId, symbol }, "W23H.E: position_lock gate query failed — fail-open, proceeding");
        }
      }

      // ─── Wave 23.C Stage 2 / Wave 23H.D: A+ confluence gate ───────────────
      // W23H.D: when entry_quality.confirming_indicators[] is non-empty, evaluate
      // THOSE per-strategy indicators (pure function, no DB/network).
      // When confirming_indicators is absent/empty, fall back to canonical 5 factors
      // (existing behavior preserved verbatim).
      //
      // Legacy bypass: legacy_no_confluence provenance → no gate (unchanged).
      // Missing entry_quality → treat as legacy, bypass (unchanged).
      //
      // factor_source audit tag:
      //   'per_strategy'  — when confirming_indicators[] evaluated
      //   'canonical_5'   — when canonical 5-factor list evaluated (fallback)
      //
      // Canonical 5 factors:
      //   regime_match        — activeStrategyId === null OR === thisStrategyId
      //   structural_setup    — always true (entry expression already satisfied)
      //   volume_confirmation — bar.volume > rolling_mean(volume,20) × 1.2
      //   macro_alignment     — not in economic event blackout
      //   vp_shape            — getSessionShapeScore() >= VP_SHAPE_SCORE_THRESHOLD (50)
      //
      // Audit: signal.a_plus_passed / signal.a_plus_rejected / signal.a_plus_bypassed_legacy
      //        signal.a_plus_factor_evaluated (per-factor, with factor_source)
      // SSE: signal:a_plus_rejected on block
      let stage2Blocked = false;
      // Trade-critique data bridge (2026-07-05): entryCtx* captures declared at
      // function top-of-scope (alongside `biasState`) — populated below, read at
      // the pendingEntryQueue.set() call site further down this function.
      if (!stage1Blocked) {
        if (isLegacyStrategy) {
          // Bypass: legacy strategy has no confluence factors defined
          logger.debug(
            { sessionId, symbol, strategyId: sessionConfig.strategyId },
            "Wave 23.C Stage 2: A+ gate bypassed — legacy_no_confluence strategy",
          );
          db.insert(paperSignalLogs).values({
            sessionId,
            symbol,
            direction: config.side,
            signalType: "a_plus_bypassed_legacy",
            price: String(bar.close),
            indicatorSnapshot: { ...indicators, _bypass_reason: "legacy_no_confluence" },
            acted: true,
            reason: "signal.a_plus_bypassed_legacy: no entry_quality block or legacy_no_confluence provenance",
          }).catch((err: unknown) => logger.warn({ err, sessionId }, "Failed to persist A+ bypass log"));
        } else if (entryQuality) {
          // ── Wave 25 W25.1 + W23H.D dispatcher ─────────────────────────────
          // Three paths, evaluated in priority order:
          //
          //   Path C (Wave 25): entry_quality.use_weighted_scoring === true
          //     → evaluateWeightedConfluence() — 9-factor weighted probabilistic model
          //     → Hard-block on macro_alignment failure (score forced to 0)
          //     → Opt-in only; default false = backward-compat for all pre-W25 strategies
          //
          //   Path A (W23H.D): confirming_indicators[] is non-empty
          //     → per-strategy boolean: satisfiedCount >= minRequired
          //
          //   Path B (Wave 23.C): confirming_indicators is absent/empty
          //     → canonical-5 factor boolean: satisfiedCount >= minRequired
          //
          // useWeightedScoring already resolved above via resolveConfluenceDispatch()
          // (deep-scan #22 Z6) — same value as entryQuality.use_weighted_scoring === true
          // && !isLegacyStrategy, computed once instead of recomputed here.

          // A-1 (Wave 25 Pass 2): pathCFailed flag — set in catch block when Path C
          // (evaluateWeightedConfluence) throws. When true, execution falls through to
          // Path B (boolean counting) as if useWeightedScoring were false.
          // This preserves bar processing on malformed weights JSON, NaN propagation,
          // or missing factor evaluator — conditions that would otherwise silently skip
          // the bar or crash the entire session.
          let pathCFailed = false;

          if (useWeightedScoring) {
            // ── Path C: Wave 25 weighted confluence scoring ───────────────────
            // Build SignalContext from available signal-time data.
            // structureState will be null until W25.2 (structure_engine.py) ships —
            // market_structure_aligned factor returns satisfied=false with reason
            // "structure_engine_unavailable" in that case (expected for Pass 1).
            //
            // A-1: ENTIRE Path C block is wrapped in try/catch. Any uncaught error
            // (malformed weights JSON, NaN propagation, missing evaluator) falls back
            // to Path B. Audit row + SSE + Discord fire on catch. (Wave 25 Pass 2)
            try {
            const signalDir = (config.side === "short" ? "short" : "long") as "long" | "short";

            // R-1 (Wave 25 Pass 2): structureState is now typed on BiasStateForSignal —
            // read directly without unsafe cast. biasState.structureState is StructureState | null,
            // which is compatible with WeightedSignalContext["structureState"].
            const structureStateRaw: WeightedSignalContext["structureState"] =
              biasState?.structureState ?? null;

            // ── Wave 25 W25.6 (Pass 3 P3.A5): liquidity-map injection ──────────
            // Fetch nearest ranked levels above + below the current bar close so
            // confluence-score.ts::evalLiquidityTargetClear() can light up the
            // liquidity_target_clear factor. Fail-soft: any error → null →
            // factor returns "liquidity_map_unavailable" (fail-open preserved).
            //
            // ── Wave 26 Group B Task 3: SMT live bridge ──────────────────────────
            // Fetch the SMT divergence snapshot from the live Python bridge.
            // Fail-soft: null snapshot → evalSmtConfirmation returns "smt_unavailable"
            // (same fail-open as pre-Wave-26 — no regression in the live paper path).
            // Parallelized alongside liquidity fetch to keep per-bar latency minimal.
            const [liquidityNearestAbove, liquidityNearestBelow, smtSnapshot] = await Promise.all([
              getNearestLiquidity(symbol, bar.close, "above").catch(() => null),
              getNearestLiquidity(symbol, bar.close, "below").catch(() => null),
              getSmtLiveSnapshot(
                new Date(bar.timestamp),
                correlationId ?? undefined,
              ).catch(() => null),
            ]);

            // ── Parity Gap 1 (observable): SMT snapshot availability diagnostics ──────
            // When smtSnapshot is null (Python threw, caught by .catch(() => null)), or
            // when all fields are null (insufficient bars / no divergence detected), log
            // so the gap is visible in telemetry without blocking the stream.
            // evalSmtConfirmation will return satisfied=false, reason="smt_unavailable".
            // ── Deep-Scan H12: SMT null-fallback contamination marker ────────────
            // When the live bridge yields no usable divergence the smt_confirmation
            // factor fail-OPENS (entry allowed as if no bearish divergence exists).
            // That overstates edge and silently contaminates PAPER → DEPLOY_READY
            // gate inputs. Stamp a data-source provenance flag on the journal entry
            // and emit a parity-diagnostic SSE so the contamination is measurable
            // without requiring the live bridge to be built.
            const smtNullFallback =
              smtSnapshot === null ||
              (smtSnapshot.score === null && smtSnapshot.direction === null);
            const smtDataSource: "live_bridge" | "null_fallback" =
              smtNullFallback ? "null_fallback" : "live_bridge";

            if (smtSnapshot === null) {
              logger.info(
                { sessionId, symbol, correlationId },
                "paper-parity: smt_confirmation unavailable — smtSnapshot null (Python error or bar buffer miss); smt_confirmation factor scores 0 this bar",
              );
            } else if (smtSnapshot.score === null && smtSnapshot.direction === null) {
              logger.debug(
                { sessionId, symbol, correlationId, stale: smtSnapshot.stale },
                "paper-parity: smt_score null (insufficient bars or no divergence detected); evalSmtConfirmation returns smt_unavailable",
              );
            }

            if (smtNullFallback) {
              broadcastSSE("PAPER_PARITY_DEGRADED", {
                source: "smt_live_bridge",
                sessionId,
                strategyId: sessionConfig.strategyId,
                symbol,
                smt_data_source: smtDataSource,
                smt_snapshot_null: smtSnapshot === null,
                stale: smtSnapshot?.stale ?? false,
                price: bar.close,
                timestamp: bar.timestamp,
                correlationId: correlationId ?? null,
              });
            }

            const weightedCtx: WeightedSignalContext = {
              strategyId: sessionConfig.strategyId,
              bar: {
                open: bar.open,
                high: bar.high,
                low: bar.low,
                close: bar.close,
                volume: bar.volume ?? 0,
                timestamp: typeof bar.timestamp === "number" ? bar.timestamp : undefined,
              },
              indicators: indicators as Record<string, number | undefined>,
              direction: signalDir,
              symbol,
              bias_active_strategy_id: biasState?.activeStrategyId ?? null,
              structureState: structureStateRaw,
              calendarBlocked,
              liquidityNearestAbove,
              liquidityNearestBelow,
              // Wave 26: SMT live bridge — populate from Python compute_smt_divergence()
              // Null when bridge unavailable → evalSmtConfirmation returns "smt_unavailable"
              smt_score:     smtSnapshot?.score     ?? undefined,
              smt_direction: smtSnapshot?.direction ?? undefined,
              smt_age_bars:  smtSnapshot?.age_bars  ?? undefined,
              // Confluence HIGH-1 (deep-scan 2026-07-09, ratified): cross-asset direction
              // from today's pre_market_sessions row (loaded above at the blackout gate).
              // SPREAD (not per-field copy) so the field names come straight from the
              // resolver's ResolvedCrossAssetContext type — {dxyDirection, us10yDirection,
              // cross_asset_age_hours}. All-null when no pre-market row exists yet →
              // evalCrossAssetAligned falls back to "cross_asset_data_unavailable".
              // MUST STAY THE LAST ENTRY IN THIS LITERAL (a cert-enforced guard asserts
              // nothing follows it) — object-literal last-wins semantics then make it
              // impossible for any later key OR spread to silently null these fields.
              ...crossAssetCtx,
            };

            // Build minimal ScoringStrategy shape for evaluator.
            // Top-level DB columns read from rawConfig (merged with defaults).
            const scoringStrategy: ScoringStrategy = {
              id: sessionConfig.strategyId,
              symbol: (config as unknown as Record<string, unknown>).symbol as string ?? "",
              confluence_score_weights: (entryQuality as unknown as Record<string, unknown>).confluence_score_weights as Record<string, number> | null ?? null,
              confluence_score_threshold: (entryQuality as unknown as Record<string, unknown>).confluence_score_threshold as number | null ?? null,
              entry_quality: entryQuality as Record<string, unknown>,
            };

            const weightedResult = evaluateWeightedConfluence(scoringStrategy, weightedCtx);

            // Trade-critique data bridge (2026-07-05): capture Path C's numeric score,
            // satisfied-factor list, and the directional liquidity target (mirrors
            // evalLiquidityTargetClear()'s own direction -> above/below selection) so a
            // passing signal carries real confluence context through to the position.
            entryCtxConfluenceScore = weightedResult.score;
            entryCtxConfluenceFactorsActive = weightedResult.factorContributions
              .filter((fc) => fc.satisfied)
              .map((fc) => fc.factor);
            {
              const _directionalLevels = signalDir === "long" ? liquidityNearestAbove : liquidityNearestBelow;
              const _nearestLevel = _directionalLevels?.[0] ?? null;
              entryCtxNearestLiquidityLevel = _nearestLevel
                ? {
                    price: _nearestLevel.price,
                    levelType: _nearestLevel.level_type,
                    distancePoints: _nearestLevel.distance_points,
                  }
                : null;
            }

            // Per-factor audit rows (fire-and-forget)
            for (const fc of weightedResult.factorContributions) {
              db.insert(paperSignalLogs).values({
                sessionId,
                symbol,
                direction: config.side,
                signalType: "a_plus_factor_evaluated",
                price: String(bar.close),
                indicatorSnapshot: {
                  ...indicators,
                  _factor: fc.factor,
                  _factor_weight: fc.weight,
                  _factor_satisfied: fc.satisfied,
                  _factor_contribution: fc.contribution,
                  _factor_reason: fc.reason,
                  _factor_source: "weighted",
                  _factor_is_hard_block: fc.is_hard_block,
                },
                acted: fc.satisfied,
                reason: `signal.a_plus_factor_evaluated: factor=${fc.factor} weight=${fc.weight} satisfied=${fc.satisfied} source=weighted reason=${fc.reason}`,
              }).catch((err: unknown) => logger.warn({ err, sessionId }, "Failed to persist Path C factor audit log"));
            }

            // Decision audit row — §10b mandate: correlationId must propagate for 90-day reconstruction
            insertAuditRow({
              action: weightedResult.passed
                ? "signal.confluence_score_evaluated"
                : weightedResult.hardBlockTriggered
                  ? "signal.confluence_hard_blocked"
                  : "signal.weighted_score_rejected",
              entityType: "strategy",
              entityId: sessionConfig.strategyId,
              decisionAuthority: "system",
              result: {
                score: weightedResult.score,
                threshold: weightedResult.threshold,
                passed: weightedResult.passed,
                hard_block: weightedResult.hardBlockTriggered,
                factor_contributions: weightedResult.factorContributions.map((fc) => ({
                  factor: fc.factor,
                  weight: fc.weight,
                  satisfied: fc.satisfied,
                  contribution: fc.contribution,
                  reason: fc.reason,
                })),
                weights_source: weightedResult.weightsSource,
                session_id: sessionId,
                symbol,
              } as Record<string, unknown>,
              status: "success",
              correlationId: correlationId ?? null,
            }).catch((err: unknown) => logger.warn({ err, sessionId }, "audit_log insert failed for weighted confluence decision"));

            // Informational audit rows for stub factors (pending_passX) — one row per unavailable factor.
            // These are NOT errors; they document which factors deferred to a future pass so operators
            // can see coverage gaps without querying individual paperSignalLogs rows.
            for (const fc of weightedResult.factorContributions) {
              if (
                !fc.satisfied &&
                (fc.reason.includes("pending_pass") ||
                 fc.reason.includes("unavailable") ||
                 fc.reason.includes("absent"))
              ) {
                insertAuditRow({
                  action: "signal.confluence_score_factor_unavailable",
                  entityType: "strategy",
                  entityId: sessionConfig.strategyId,
                  decisionAuthority: "system",
                  result: {
                    factor: fc.factor,
                    reason: fc.reason,
                    weight: fc.weight,
                    session_id: sessionId,
                    symbol,
                  } as Record<string, unknown>,
                  status: "info",
                  correlationId: correlationId ?? null,
                }).catch((err: unknown) => logger.warn({ err, sessionId }, "audit_log insert failed for factor_unavailable row"));
              }
            }

            // ── Wave 25 W25.7 (Pass 4 P4.A2): signal.confluence_factor_decayed ──
            // For every satisfied factor whose decay_confidence dropped below
            // DECAY_TELEMETRY_THRESHOLD (default 0.7), emit an INFO audit row so
            // operators can see staleness pressure on signal quality without
            // pulling per-factor rows. decayedFactors is pre-filtered in
            // evaluateWeightedConfluence() to exclude NO_DECAY_FACTORS (anti-
            // double-decay guard) and unsatisfied factors. Guard: skip emission
            // when the array is empty (no allocation for boring bars).
            if (weightedResult.decayedFactors.length > 0) {
              const decayThreshold = getDecayTelemetryThreshold();
              for (const dec of weightedResult.decayedFactors) {
                insertAuditRow({
                  action: "signal.confluence_factor_decayed",
                  entityType: "strategy",
                  entityId: sessionConfig.strategyId,
                  decisionAuthority: "system",
                  result: {
                    factor: dec.factor,
                    weight: dec.weight,
                    satisfied: dec.satisfied,
                    decay_confidence: dec.decay_confidence,
                    decay_reason: dec.decay_reason,
                    hard_killed: dec.hard_killed,
                    weighted_contribution: dec.contribution,
                    decay_telemetry_threshold: decayThreshold,
                    session_id: sessionId,
                    symbol,
                  } as Record<string, unknown>,
                  status: "info",
                  correlationId: correlationId ?? null,
                }).catch((err: unknown) => logger.warn({ err, sessionId }, "audit_log insert failed for confluence_factor_decayed row"));
              }
            }

            span.setAttribute("a_plus_weighted_score", weightedResult.score);
            span.setAttribute("a_plus_threshold", weightedResult.threshold);
            span.setAttribute("a_plus_passed", weightedResult.passed);
            span.setAttribute("a_plus_hard_block", weightedResult.hardBlockTriggered);
            span.setAttribute("a_plus_weights_source", weightedResult.weightsSource);
            span.setAttribute("a_plus_factor_source", "weighted");

            if (!weightedResult.passed) {
              stage2Blocked = true;
              logger.info(
                {
                  sessionId,
                  symbol,
                  score: weightedResult.score,
                  threshold: weightedResult.threshold,
                  hardBlock: weightedResult.hardBlockTriggered,
                  weightsSource: weightedResult.weightsSource,
                  strategyId: sessionConfig.strategyId,
                },
                "Wave 25 W25.1 Stage 2: A+ gate REJECTED — weighted confluence score below threshold",
              );
              broadcastSSE("signal:weighted_score_rejected", {
                sessionId,
                strategyId: sessionConfig.strategyId,
                symbol,
                score: weightedResult.score,
                threshold: weightedResult.threshold,
                hardBlock: weightedResult.hardBlockTriggered,
                weightsSource: weightedResult.weightsSource,
                // Top-3 unsatisfied factors by weight — enough for dashboard to show "why"
                // without sending all 9 (keeps SSE payload compact)
                topUnsatisfiedFactors: weightedResult.factorContributions
                  .filter((fc) => !fc.satisfied)
                  .sort((a, b) => b.weight - a.weight)
                  .slice(0, 3)
                  .map((fc) => ({ factor: fc.factor, weight: fc.weight, reason: fc.reason })),
                price: bar.close,
                timestamp: bar.timestamp,
                correlationId: correlationId ?? null,
              });
              db.insert(paperSignalLogs).values({
                sessionId,
                symbol,
                direction: config.side,
                signalType: "a_plus_rejected",
                price: String(bar.close),
                indicatorSnapshot: {
                  ...indicators,
                  _weighted_score: weightedResult.score,
                  _weighted_threshold: weightedResult.threshold,
                  _hard_block: weightedResult.hardBlockTriggered,
                  _weights_source: weightedResult.weightsSource,
                  _a_plus_factor_source: "weighted",
                  _smt_data_source: smtDataSource,
                  _smt_null_fallback: smtNullFallback,
                },
                acted: false,
                reason: `signal.weighted_score_rejected: score=${weightedResult.score.toFixed(4)} threshold=${weightedResult.threshold} hard_block=${weightedResult.hardBlockTriggered} weights_source=${weightedResult.weightsSource}`,
              }).catch((err: unknown) => logger.error({ err, sessionId }, "Failed to persist weighted score rejected log"));
            } else {
              logger.debug(
                {
                  sessionId,
                  symbol,
                  score: weightedResult.score,
                  threshold: weightedResult.threshold,
                  weightsSource: weightedResult.weightsSource,
                },
                "Wave 25 W25.1 Stage 2: A+ gate PASSED — weighted confluence",
              );
              db.insert(paperSignalLogs).values({
                sessionId,
                symbol,
                direction: config.side,
                signalType: "a_plus_passed",
                price: String(bar.close),
                indicatorSnapshot: {
                  ...indicators,
                  _weighted_score: weightedResult.score,
                  _weighted_threshold: weightedResult.threshold,
                  _weights_source: weightedResult.weightsSource,
                  _a_plus_factor_source: "weighted",
                  _smt_data_source: smtDataSource,
                  _smt_null_fallback: smtNullFallback,
                },
                acted: true,
                reason: `signal.confluence_score_evaluated: score=${weightedResult.score.toFixed(4)} threshold=${weightedResult.threshold} weights_source=${weightedResult.weightsSource}`,
              }).catch((err: unknown) => logger.warn({ err, sessionId }, "Failed to persist weighted score passed log"));
            }
            } catch (pathCErr: unknown) {
              // A-1 (Wave 25 Pass 2): Path C evaluation error — emit audit + SSE + Discord + fall back to Path B.
              // Conservative: treat as if useWeightedScoring=false so Path B runs on this bar.
              pathCFailed = true;
              const pathCErrMsg = pathCErr instanceof Error ? pathCErr.message : String(pathCErr);
              logger.error(
                { err: pathCErr, strategyId: sessionConfig.strategyId, correlationId },
                "path_c_evaluation_failed",
              );
              insertAuditRow({
                action: "weighted_confluence.evaluation_error",
                entityType: "strategy",
                entityId: sessionConfig.strategyId,
                decisionAuthority: "system",
                result: {
                  strategyId: sessionConfig.strategyId,
                  error: pathCErrMsg,
                  correlationId: correlationId ?? null,
                  fallback: "path_b",
                  session_id: sessionId,
                  symbol,
                } as Record<string, unknown>,
                status: "failure",
                correlationId: correlationId ?? null,
              }).catch((auditErr: unknown) => logger.warn({ err: auditErr, sessionId }, "path_c_error audit write failed"));
              notifyCritical(
                "Path C evaluation failed",
                appendFamilyGradePostscript(
                  `evaluateWeightedConfluence threw for strategy ${sessionConfig.strategyId}: ${pathCErrMsg}. Falling back to Path B.`,
                  "The bot's signal-scoring engine had an internal error and switched to a simpler backup method.",
                  "No action needed — the bot is still trading safely using a backup signal check.",
                ),
                { strategyId: sessionConfig.strategyId, sessionId, correlationId: correlationId ?? null },
              );
              broadcastSSE("alert:path_c_error", {
                sessionId,
                strategyId: sessionConfig.strategyId,
                symbol,
                error: pathCErrMsg,
                fallback: "path_b",
                correlationId: correlationId ?? null,
              });
            }
          }

          if (!useWeightedScoring || pathCFailed) {
          // ── W23H.D dispatcher: per-strategy vs canonical 5 (Path B fallback) ──
          // Runs when: (a) strategy does not opt into Path C, OR
          //            (b) Path C threw an error (A-1 fallback — pathCFailed=true)
          // customIndicators/usePerStrategy already resolved above via
          // resolveConfluenceDispatch() (deep-scan #22 Z6) — same values as
          // entryQuality.confirming_indicators ?? [] / customIndicators.length > 0.

          // Determine signal direction from config.side for directional evaluation
          const signalDir = (config.side === "short" ? "short" : "long") as "long" | "short";

          // factorSource used in audit rows — callers can verify which path fired
          const factorSource: "per_strategy" | "canonical_5" = usePerStrategy ? "per_strategy" : "canonical_5";

          // Evaluate each factor
          const factorResults: Array<{ factor: string; satisfied: boolean; reason: string }> = [];

          if (usePerStrategy) {
            // ── Path A: per-strategy confirming_indicators[] ─────────────────
            // Pure function — never throws. Unknown indicators → satisfied=false.
            const minRequired = entryQuality.min_factors_satisfied ?? customIndicators.length;

            const rawResults = evaluateConfirmingIndicators(
              customIndicators,
              { open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume ?? 0 },
              indicators as Record<string, number | undefined>,
              signalDir,
            );

            for (const r of rawResults) {
              factorResults.push(r);
              // Per-factor audit row (W23H.D requirement)
              db.insert(paperSignalLogs).values({
                sessionId,
                symbol,
                direction: config.side,
                signalType: "a_plus_factor_evaluated",
                price: String(bar.close),
                indicatorSnapshot: {
                  ...indicators,
                  _factor: r.factor,
                  _factor_satisfied: r.satisfied,
                  _factor_reason: r.reason,
                  _factor_source: factorSource,
                },
                acted: r.satisfied,
                reason: `signal.a_plus_factor_evaluated: factor=${r.factor} satisfied=${r.satisfied} source=${factorSource} reason=${r.reason}`,
              }).catch((err: unknown) => logger.warn({ err, sessionId }, "Failed to persist per-factor audit log"));
            }

            const satisfiedCount = factorResults.filter((r) => r.satisfied).length;
            const passed = satisfiedCount >= minRequired;

            span.setAttribute("a_plus_satisfied_count", satisfiedCount);
            span.setAttribute("a_plus_min_required", minRequired);
            span.setAttribute("a_plus_passed", passed);
            span.setAttribute("a_plus_factor_source", factorSource);

            if (!passed) {
              stage2Blocked = true;
              logger.info(
                { sessionId, symbol, satisfiedCount, minRequired, factorResults, factorSource, strategyId: sessionConfig.strategyId },
                "Wave 23H.D Stage 2: A+ gate REJECTED — per-strategy indicators insufficient",
              );
              // ds21 (deep-scan #21 Band D): include correlationId like the sibling
              // signal:weighted_score_rejected event, for consistent per-bar trace coverage.
              broadcastSSE("signal:a_plus_rejected", {
                sessionId,
                symbol,
                satisfiedCount,
                minRequired,
                factorResults,
                factorSource,
                price: bar.close,
                timestamp: bar.timestamp,
                correlationId: correlationId ?? null,
              });
              db.insert(paperSignalLogs).values({
                sessionId,
                symbol,
                direction: config.side,
                signalType: "a_plus_rejected",
                price: String(bar.close),
                indicatorSnapshot: {
                  ...indicators,
                  _a_plus_satisfied_count: satisfiedCount,
                  _a_plus_min_required: minRequired,
                  _a_plus_factor_results: factorResults,
                  _a_plus_factor_source: factorSource,
                },
                acted: false,
                reason: `signal.a_plus_rejected: source=${factorSource} ${satisfiedCount}/${minRequired} factors satisfied (${factorResults.filter((r) => !r.satisfied).map((r) => r.factor).join(", ")} failed)`,
                correlationId: correlationId ?? null,  // ds21-w2: trace linkage (pairs with signal:a_plus_rejected SSE)
              }).catch((err: unknown) => logger.error({ err, sessionId }, "Failed to persist A+ rejected log"));
            } else {
              logger.debug(
                { sessionId, symbol, satisfiedCount, minRequired, factorResults, factorSource },
                "Wave 23H.D Stage 2: A+ gate PASSED — per-strategy indicators",
              );
              db.insert(paperSignalLogs).values({
                sessionId,
                symbol,
                direction: config.side,
                signalType: "a_plus_passed",
                price: String(bar.close),
                indicatorSnapshot: {
                  ...indicators,
                  _a_plus_satisfied_count: satisfiedCount,
                  _a_plus_min_required: minRequired,
                  _a_plus_factor_results: factorResults,
                  _a_plus_factor_source: factorSource,
                },
                acted: true,
                reason: `signal.a_plus_passed: source=${factorSource} ${satisfiedCount}/${minRequired} factors satisfied`,
              }).catch((err: unknown) => logger.warn({ err, sessionId }, "Failed to persist A+ passed log"));
            }
          } else {
            // ── Path B: canonical 5-factor list (existing behavior, verbatim) ─
            const factors = entryQuality.confluence_factors ?? [];
            const minRequired = entryQuality.min_factors_satisfied ?? factors.length;

            for (const factor of factors) {
              try {
                // deep-scan signal-gen F-1 (CRITICAL): Path B factors now fail CLOSED (satisfied=false)
                // on missing/unknown/error data — matching Path A (confirming-indicator-evaluator) + Path C
                // (confluence-score). Failing OPEN to satisfied=true dishonestly INFLATED the confluence count
                // (e.g. first ~20 bars after any session reset / process restart, volume_confirmation auto-passed).
                let satisfied = false;
                let reason = "unknown_factor_fail_closed";

                if (factor === "regime_match") {
                  satisfied = biasState === null || biasState.activeStrategyId === null || biasState.activeStrategyId === sessionConfig.strategyId;
                  reason = satisfied ? "regime_matched" : "regime_mismatch";
                } else if (factor === "structural_setup") {
                  satisfied = true;
                  reason = "entry_expression_true";
                } else if (factor === "volume_confirmation") {
                  const volumeSeries = barBuffer.map((b) => b.volume).filter((v): v is number => Number.isFinite(v));
                  if (volumeSeries.length >= 20) {
                    const rollingMean = volumeSeries.slice(-20).reduce((s, v) => s + v, 0) / 20;
                    satisfied = bar.volume !== undefined && bar.volume > rollingMean * 1.2;
                    reason = satisfied ? "volume_above_threshold" : "volume_insufficient";
                  } else {
                    satisfied = false; // fail-CLOSED when insufficient history (cannot verify volume → not confirmed)
                    reason = "insufficient_history_fail_closed";
                  }
                } else if (factor === "macro_alignment") {
                  // Reuse calendarBlocked result (already computed above)
                  satisfied = !calendarBlocked;
                  reason = satisfied ? "no_event_blackout" : "event_blackout_active";
                } else if (factor === "vp_shape") {
                  // Wave 23.C Gap A.1: real VP shape score from volume-profile-service
                  try {
                    const sessionDateStr = barTimestampToTradingDay(bar.timestamp);
                    const vpData = await getSessionShapeScore(symbol, sessionDateStr);
                    if (!vpData.available) {
                      satisfied = false; // fail-CLOSED when VP data unavailable (cannot verify shape → not confirmed)
                      reason = "vp_not_available_fail_closed";
                      logger.warn(
                        { sessionId, symbol, sessionDate: sessionDateStr },
                        "Wave 23.C vp_shape: VP shape data unavailable — fail-CLOSED (satisfied=false)",
                      );
                    } else {
                      satisfied = vpData.score >= VP_SHAPE_SCORE_THRESHOLD;
                      reason = satisfied
                        ? `vp_shape_score_${vpData.score}_shape_${vpData.shape}`
                        : `vp_shape_insufficient_${vpData.score}_lt_${VP_SHAPE_SCORE_THRESHOLD}`;
                      logger.debug(
                        { sessionId, symbol, score: vpData.score, shape: vpData.shape, confidence: vpData.confidence, satisfied },
                        "Wave 23.C vp_shape factor evaluated",
                      );
                    }
                  } catch {
                    satisfied = false; // fail-CLOSED on any VP error
                    reason = "vp_shape_error_fail_closed";
                  }
                }

                factorResults.push({ factor, satisfied, reason });

                // Per-factor audit row — canonical_5 source tag
                db.insert(paperSignalLogs).values({
                  sessionId,
                  symbol,
                  direction: config.side,
                  signalType: "a_plus_factor_evaluated",
                  price: String(bar.close),
                  indicatorSnapshot: {
                    ...indicators,
                    _factor: factor,
                    _factor_satisfied: satisfied,
                    _factor_reason: reason,
                    _factor_source: factorSource,
                  },
                  acted: satisfied,
                  reason: `signal.a_plus_factor_evaluated: factor=${factor} satisfied=${satisfied} source=${factorSource} reason=${reason}`,
                }).catch((err: unknown) => logger.warn({ err, sessionId }, "Failed to persist canonical factor audit log"));
              } catch {
                // Per-factor fail-CLOSED: any evaluation error marks it NOT satisfied (cannot verify → not confirmed)
                factorResults.push({ factor, satisfied: false, reason: "factor_eval_error_fail_closed" });
              }
            }

            const satisfiedCount = factorResults.filter((r) => r.satisfied).length;
            const passed = satisfiedCount >= minRequired;

            span.setAttribute("a_plus_satisfied_count", satisfiedCount);
            span.setAttribute("a_plus_min_required", minRequired);
            span.setAttribute("a_plus_passed", passed);
            span.setAttribute("a_plus_factor_source", factorSource);

            if (!passed) {
              stage2Blocked = true;
              logger.info(
                { sessionId, symbol, satisfiedCount, minRequired, factorResults, factorSource, strategyId: sessionConfig.strategyId },
                "Wave 23.C Stage 2: A+ gate REJECTED — insufficient confluence factors",
              );
              // ds21 (deep-scan #21 Band D): include correlationId like the sibling
              // signal:weighted_score_rejected event, for consistent per-bar trace coverage.
              broadcastSSE("signal:a_plus_rejected", {
                sessionId,
                symbol,
                satisfiedCount,
                minRequired,
                factorResults,
                factorSource,
                price: bar.close,
                timestamp: bar.timestamp,
                correlationId: correlationId ?? null,
              });
              db.insert(paperSignalLogs).values({
                sessionId,
                symbol,
                direction: config.side,
                signalType: "a_plus_rejected",
                price: String(bar.close),
                indicatorSnapshot: {
                  ...indicators,
                  _a_plus_satisfied_count: satisfiedCount,
                  _a_plus_min_required: minRequired,
                  _a_plus_factor_results: factorResults,
                  _a_plus_factor_source: factorSource,
                },
                acted: false,
                reason: `signal.a_plus_rejected: source=${factorSource} ${satisfiedCount}/${minRequired} factors satisfied (${factorResults.filter((r) => !r.satisfied).map((r) => r.factor).join(", ")} failed)`,
                correlationId: correlationId ?? null,  // ds21-w2: trace linkage (pairs with signal:a_plus_rejected SSE)
              }).catch((err: unknown) => logger.error({ err, sessionId }, "Failed to persist A+ rejected log"));
            } else {
              logger.debug(
                { sessionId, symbol, satisfiedCount, minRequired, factorResults, factorSource },
                "Wave 23.C Stage 2: A+ gate PASSED",
              );
              db.insert(paperSignalLogs).values({
                sessionId,
                symbol,
                direction: config.side,
                signalType: "a_plus_passed",
                price: String(bar.close),
                indicatorSnapshot: {
                  ...indicators,
                  _a_plus_satisfied_count: satisfiedCount,
                  _a_plus_min_required: minRequired,
                  _a_plus_factor_results: factorResults,
                  _a_plus_factor_source: factorSource,
                },
                acted: true,
                reason: `signal.a_plus_passed: source=${factorSource} ${satisfiedCount}/${minRequired} factors satisfied`,
              }).catch((err: unknown) => logger.warn({ err, sessionId }, "Failed to persist A+ passed log"));
            }
          }

          // Trade-critique data bridge (2026-07-05): Path A/B never computes a numeric
          // score or fetches liquidity, but it does know which factors were satisfied —
          // capture that list so the critique isn't limited to Path-C-only strategies.
          entryCtxConfluenceFactorsActive = factorResults.filter((r) => r.satisfied).map((r) => r.factor);
          } // end if (!useWeightedScoring || pathCFailed) — Path B (Path A / canonical 5)
        }
      }

      // If either Stage 1 or Stage 2 blocked — treat as gate rejected (no entry)
      if (stage1Blocked || stage2Blocked) {
        riskGatePassed = false;
        // Skip to end of else branch — no OI / macro / risk gate needed
      } else {

      // ─── W19: OI liquidity soft-gate check (ADVISORY) ─────────────
      // checkOiLiquidity() inspects 5-day open-interest trend on the contract
      // and flags rolls/expiry where liquidity is drying up. Authority is
      // ADVISORY — we never block on this signal, we just persist a paper
      // signal log row (signalType="oi_decline_advisory") so the operator can
      // see that an entry fired into a thinning book. Fail-open on any error.
      // Wired 2026-04-30 in the integration audit (file existed but was an
      // orphan — its own header doc claimed it was wired here).
      try {
        const { checkOiLiquidity } = await import("./oi-liquidity-filter.js");
        const oiResult = await checkOiLiquidity(symbol.toUpperCase());
        if (oiResult.shouldBlock) {
          span.setAttribute("oi_decline_advisory", true);
          span.setAttribute("oi_decline_pct", oiResult.declinePct ?? 0);
          logger.warn(
            { sessionId, symbol, declinePct: oiResult.declinePct, latestOi: oiResult.latestOi, earliestOi: oiResult.earliestOi },
            "W19 OI liquidity advisory: declining open interest detected (entry NOT blocked — advisory only)",
          );
          db.insert(paperSignalLogs).values({
            sessionId,
            symbol,
            direction: config.side,
            signalType: "oi_decline_advisory",
            price: String(bar.close),
            indicatorSnapshot: {
              ...indicators,
              _oi_decline_pct: oiResult.declinePct,
              _oi_latest: oiResult.latestOi,
              _oi_earliest: oiResult.earliestOi,
              _oi_data_points: oiResult.dataPoints,
              _oi_threshold: oiResult.threshold,
            },
            acted: true, // entry WILL fire — this is advisory only
            reason: `oi_decline_advisory: ${oiResult.reason}`,
          }).catch((err: unknown) => logger.error({ err, sessionId }, "Failed to persist OI advisory log"));
        }
      } catch (oiErr) {
        logger.debug({ err: oiErr, sessionId, symbol }, "W19 OI liquidity check failed — fail-open, proceeding");
      }

      // ─── C11: Macro hard gate check (BEFORE risk gate) ─────────────
      // Fail-open: if evaluateMacroGates throws or macro data unavailable,
      // trading continues unblocked. Same fail-open pattern as calendar_filter.
      let macroGateBlocked = false;
      try {
        const { evaluateMacroGates } = await import("./macro-gate-service.js");
        const macroGate = await evaluateMacroGates(
          symbol.toUpperCase(),
          config.side as "long" | "short",
          sessionConfig.strategyId,
        );
        if (!macroGate.allowed) {
          // Wave 24 Item 17: firm-conditional macro blackout.
          // MFFU=strict (block), Topstep=advisory (warn + allow through).
          // Unknown firms default to "strict" (fail-closed).
          const blackoutMode = getMacroBlackoutMode(sessionRow.firmId);
          if (blackoutMode === "advisory") {
            // Topstep: log WARN + audit, but DO NOT block the entry.
            span.setAttribute("macro_gate_advisory", true);
            span.setAttribute("macro_gate_reason", macroGate.gateReason);
            logger.warn(
              { sessionId, symbol, firmId: sessionRow.firmId, direction: config.side, reason: macroGate.gateReason, mode: "advisory" },
              "C11 macro gate ADVISORY WARN (Topstep: no hard blackout) — entry allowed",
            );
            db.insert(paperSignalLogs).values({
              sessionId,
              symbol,
              direction: config.side,
              signalType: "c11_macro_gate_advisory_warn",
              price: String(bar.close),
              indicatorSnapshot: {
                ...indicators,
                _macro_gate_reason: macroGate.gateReason,
                _macro_crisis_prob: macroGate.macroContext.probCrisis,
                _macro_dominant_state: macroGate.macroContext.dominantState,
                _macro_severity: macroGate.severity,
                _firm_blackout_mode: "advisory",
                _firm_id: sessionRow.firmId,
              },
              acted: true,  // advisory — entry proceeds
              reason: `c11_macro_gate.advisory_warn: firmId=${sessionRow.firmId ?? "unknown"} mode=advisory — ${macroGate.gateReason}`,
            }).catch((err: unknown) => logger.error({ err, sessionId }, "Failed to persist C11 advisory warn log"));
          } else {
            // MFFU or unknown firm: strict block (existing behavior).
            macroGateBlocked = true;
            span.setAttribute("macro_gate_blocked", true);
            span.setAttribute("macro_gate_reason", macroGate.gateReason);
            logger.info(
              { sessionId, symbol, firmId: sessionRow.firmId, direction: config.side, reason: macroGate.gateReason, severity: macroGate.severity, mode: "strict" },
              "C11 macro gate BLOCKED entry signal (strict mode)",
            );
            db.insert(paperSignalLogs).values({
              sessionId,
              symbol,
              direction: config.side,
              signalType: "macro_gate_blocked",
              price: String(bar.close),
              indicatorSnapshot: {
                ...indicators,
                _macro_gate_reason: macroGate.gateReason,
                _macro_crisis_prob: macroGate.macroContext.probCrisis,
                _macro_dominant_state: macroGate.macroContext.dominantState,
                _macro_severity: macroGate.severity,
                _firm_blackout_mode: "strict",
                _firm_id: sessionRow.firmId,
              },
              acted: false,
              reason: `macro_gate_blocked: ${macroGate.gateReason}`,
            }).catch((err: unknown) => logger.error({ err, sessionId }, "Failed to persist macro gate block log"));
          }
        }
        // C11: FOMC proximity → halve size (advisory, not a block). #22 (deep-scan 2026-07-11):
        // carry the halving as `fomcSizeFactor = 0.5` folded into the size chain via min() at the
        // computeRiskDerivedContracts call below — previously this only computed a local
        // `fomcReducedContracts` that was logged but never applied, so the taper was inert.
        if (macroGate.fomcSizeReduction && !macroGateBlocked) {
          fomcSizeFactor = 0.5;
          span.setAttribute("fomc_size_reduction", true);
          span.setAttribute("fomc_size_factor", fomcSizeFactor);
          logger.info(
            { sessionId, symbol, originalContracts: config.contracts, fomcSizeFactor },
            "C11 FOMC ±1 day: size advisory ×0.5 (folded into size chain via min with news factor)",
          );
        }
      } catch (macroGateErr) {
        // C11 fail-CLOSED: any infrastructure failure (DB down, import error, parse error)
        // must block the entry — not silently allow it through.
        // (Wave 23H Fix 2: closes silent fail-open discovered in gate-strength-audit-2026-05-20)
        macroGateBlocked = true;
        const errMsg = macroGateErr instanceof Error ? macroGateErr.message : String(macroGateErr);
        logger.error(
          { err: macroGateErr, sessionId, symbol },
          "C11 macro gate evaluation FAILED — blocking entry (fail-closed)",
        );
        span.setAttribute("macro_gate_error", true);
        span.setAttribute("macro_gate_fail_closed", true);
        // Audit row for every infrastructure failure
        db.insert(paperSignalLogs).values({
          sessionId,
          symbol,
          direction: "long", // direction may be unknown at this point; log best-effort
          signalType: "c11_macro_gate_eval_failed",
          price: String(bar.close),
          indicatorSnapshot: { _macro_gate_error: errMsg } as Record<string, unknown>,
          acted: false,
          reason: `c11_macro_gate.evaluation_failed_fail_closed: ${errMsg}`,
        }).catch((e: unknown) => logger.error({ err: e, sessionId }, "C11: eval_failed audit log write failed"));
        // SSE so operator sees this on dashboard
        broadcastSSE("signal:macro_gate_eval_failed", {
          sessionId,
          symbol,
          error_message: errMsg,
        });
      }

      if (macroGateBlocked) {
        riskGatePassed = false;
      } else {
        try {
          const gateResult = await checkRiskGate(sessionId, symbol, config.contracts);
          riskGatePassed = gateResult.allowed;
          if (!riskGatePassed) {
            logger.info({ sessionId, symbol, reason: gateResult.reason }, "Risk gate rejected entry");
          }
        } catch (err) {
          logger.error({ err, sessionId }, "Risk gate check failed — skipping entry");
          riskGatePassed = false;
        }
      }
      } // close inner else { (stage1Blocked || stage2Blocked guard)
    } // close outer else { (antiSetupBlocked guard)

    if (riskGatePassed) {
      // ─── Context Gate: TAKE/REDUCE/SKIP ───────────────────

      // W23H.4: Risk-derived sizing — replaces legacy dynamic_atr block.
      // Calls computeRiskDerivedContracts() with full account + confluence context.
      // Firm cap and liquidity cap are enforced INSIDE the helper (not duplicated here).
      // Backward compat: strategies with no entry_quality (legacy) get confluence_count=1
      // → multiplier 1.0 → identical sizing to the prior dynamic_atr behavior when
      // position_size.type === "risk_derived_pyramid".
      // Strategies with old "dynamic_atr" type fall through to config.contracts (no change).
      const rawPositionSize = (config as unknown as Record<string, unknown>).position_size as Record<string, unknown> | undefined;

      // Parse account state from session row (numeric columns arrive as strings from Postgres/Drizzle)
      const accountBalance = parseAccountNumericOrDefault(sessionRow.currentEquity, 50_000);
      const accountStartingFloor = parseAccountNumericOrDefault(sessionRow.startingCapital, 50_000);
      // Pass 5 Track C F-2: prefer realizedPeakEquity (atomic close-time HWM)
      // over highWaterBalance (MTM-oscillating). Fall back to legacy column then to balance.
      // FIX A4 (deep-scan #22 fix-wave-2, 2026-07-07): `parseFloat(x) || parseFloat(y) || z`
      // has the same falsy-zero bug wave-1 fixed at the other 4 call sites (deepscan22-fix8)
      // — a legitimately-zeroed realizedPeakEquity (e.g. a session that gave back its entire
      // HWM) or highWaterBalance would be silently discarded because `0` is falsy, replacing
      // a real "you have zero cushion left" HWM with a phantom nonzero one. Use the existing
      // parseAccountNumericOrDefault() helper (only NaN/null/undefined trigger the fallback).
      const highWaterBalance = parseAccountNumericOrDefault(
        sessionRow.realizedPeakEquity,
        parseAccountNumericOrDefault(sessionRow.highWaterBalance, accountBalance),
      );
      // Pass 5 Track C F-4: cumulativeProfit must be REALIZED-only for pyramid tier math.
      // Using currentEquity (MTM) inflates tier mid-trade when winners are open.
      // Backtester uses realized P&L (sizing.py:846); paper must match.
      //
      // F-10 (Pass 6 / Track A — VERIFIED FALSE POSITIVE 2026-05-20):
      // The Pass 5 audit flagged this query for missing a `exitTime IS NOT NULL`
      // filter, claiming partial-fill / open-position rows would contaminate the
      // realized total. We re-verified the schema (src/server/db/schema.ts
      // paperTrades, lines 743-752): both `entryPrice`/`exitPrice`/`entryTime`/
      // `exitTime`/`pnl` are declared `.notNull()`. A paperTrades row CANNOT be
      // inserted without both entry and exit set — every row is, by construction,
      // a closed round-trip. Style C 33/33/33 partials produce MULTIPLE closed
      // rows (one per partial), each a finished slice with its own pnl.
      // Conclusion: no `isNotNull(exitTime)` filter is needed. The query is
      // correct as-is. Do NOT add a redundant filter — it would silently mask
      // a future schema regression (if exitTime ever becomes nullable, the
      // missing rows would vanish from the realized sum without an error).
      let realizedProfit = 0;
      try {
        const realizedRow = await db
          .select({ total: sql<string>`COALESCE(SUM(${paperTrades.pnl}), 0)` })
          .from(paperTrades)
          .where(eq(paperTrades.sessionId, sessionId));
        realizedProfit = parseFloat(realizedRow[0]?.total ?? "0") || 0;
      } catch {
        // Fail-open: fall back to balance-based estimate if the query fails
        realizedProfit = accountBalance - accountStartingFloor;
      }
      const cumulativeProfit = realizedProfit;

      // ATR from indicators (same source as the legacy block)
      const atrPoints = typeof indicators["atr_14"] === "number" ? indicators["atr_14"] : 0;
      const spec = CONTRACT_SPECS[symbol];
      const pointDollarValue = spec?.pointValue ?? 5; // MES default; unknown symbol → $5

      // Stop multiplier from strategy stop_loss config; CLAUDE.md §4 floor = 1.5
      const stopMultiplier = typeof config.stop_loss?.multiplier === "number"
        ? config.stop_loss.multiplier
        : 1.5;

      // Firm contract cap from firm_config lookup (same as prior P1-6(a))
      const firmCap = getFirmContractCap(sessionRow.firmId, symbol);

      // W23H.4: confluence_count = evidence-backed confluence_factors + 1 (primary always counts).
      // Re-read entry_quality from config here because entryQuality is scoped inside the
      // antiSetupBlocked else-block and not visible at this level. Same derivation as Stage 2.
      const rawConfigForSizing = config as unknown as Record<string, unknown>;
      const entryQualityForSizing = (
        rawConfigForSizing.entry_quality ??
        (rawConfigForSizing.strategy as Record<string, unknown> | undefined)?.entry_quality
      ) as { confluence_factors?: string[]; factor_sources?: Record<string, FactorSource> } | undefined;
      // HARDENING 2026-06-30 (confluence→sizing), FIXED deep-scan #22 FIX F-1 (2026-07-09): size
      // only on EVIDENCE-BACKED confluence_factors. Auto-floor confluences (graduator-injected
      // regime_match / structural_setup — AUTO_FLOOR_FACTORS, or anything tagged "auto_floor" in
      // the per-factor factor_sources provenance map) are Trading Forge overlay, NOT the
      // YouTube-extracted edge, and must NEVER justify the 1.5×/2× size upsize.
      //
      // FIX F-1: the prior derivation read `entry_quality.confirming_indicators` — an array of
      // `{indicator, params, direction}` OBJECTS (deep-scan #22 FIX A1) — into a function typed
      // for `string[]`. AUTO_FLOOR_FACTORS.has(object) is always false, so the exclusion never
      // fired and every confluence strategy was credited fully evidence-backed. The CORRECT field
      // is `entry_quality.confluence_factors` (the string[] Stage 2 already reads at :4880) +
      // `entry_quality.factor_sources` (the graduation-time provenance map) — see
      // `deriveEvidenceBackedConfluenceCount()` in confluence-provenance.ts.
      //
      // Excluding auto_floor factors only ever REDUCES the COUNT relative to the immediate
      // pre-fix (buggy) value (fail-safe on the count derivation itself). NOTE: this gates on
      // PROVENANCE (evidence-backed); gating additionally on per-bar SATISFACTION is a tracked
      // follow-up (needs Stage-2 result threading).
      //
      // Deep-scan #22 loop-3 (2026-07-09) — honest behavior statement: this F-1 fix, landed
      // alone, would have a SIDE EFFECT of silently ACTIVATING the confluence-weighted upsize
      // for most strategies (confluence_factors is near-universally populated by the graduator,
      // unlike the old buggy confirming_indicators read which was usually empty). To avoid a
      // silent size-INCREASE shipping by accident, resolveConfluenceMultiplier() in
      // risk-sizing.ts now gates the ACTUAL multiplier application behind
      // CONFLUENCE_SIZE_UPSIZE_ENABLED (env, default false):
      //   - flag OFF (default): multiplier is pinned to 1.0 — size is UNCHANGED from historical
      //     (pre-ds22) behavior, a size no-op, regardless of confluenceCount computed below.
      //   - flag ON: the evidence-backed, auto_floor-excluded confluenceCount drives the
      //     1.0x/1.5x/2.0x upsize as W23H.4 originally intended.
      // confluenceCount itself is still computed and threaded into sizingInputs/confluenceAudit
      // below regardless of the flag — it stays correct and observable either way; the flag only
      // gates whether it is ALLOWED to move finalContracts.
      const confluenceCount = deriveEvidenceBackedConfluenceCount(entryQualityForSizing);

      // Per-strategy confluence_size_multiplier_map from config (set by framework-overlay W23H.4)
      const confluenceSizeMultiplierMap = (rawPositionSize?.confluence_size_multiplier as Record<number, number> | undefined) ?? undefined;

      let baseContracts: number = 1; // initialized; each branch below overwrites this
      // LOW (freshscan8 2026-07-12): tracks whether the Tier-1 news/FOMC reduce factor was already
      // folded into the size (true only on the pyramid path, via pmSizeFactor). The non-pyramid
      // (dynamic_atr / fixed) branches apply it after the dispatch, gated on this flag.
      let _newsReduceAppliedInSizing = false;

      if (rawPositionSize?.type === "risk_derived_pyramid") {
        // Full risk-derived path: build positionSizeConfig from the compiled strategy config.
        // Fields that may be absent on older strategy rows use framework-canonical defaults
        // (see CLAUDE.md §4 sizing spec and framework-overlay.ts).
        //
        // W3A ratify-packet (2026-07-17) item 3: detect BEFORE construction which of the
        // 6 fields below are about to silently fall back, so a fallback-visibility audit
        // row can fire when ANY of them engage (see insertAuditRow call just below this
        // object). detectPositionSizeFallbacks() uses the SAME POSITION_SIZE_FALLBACK_DEFAULTS
        // constants referenced here — detection and construction can never drift apart.
        const positionSizeFallbacks = detectPositionSizeFallbacks(rawPositionSize, symbol);
        const positionSizeConfig: RiskSizingInputs["positionSizeConfig"] = {
          type: "risk_derived_pyramid",
          base_contracts: typeof rawPositionSize.base_contracts === "number" ? rawPositionSize.base_contracts : POSITION_SIZE_FALLBACK_DEFAULTS.base_contracts,
          tier_increment: typeof rawPositionSize.tier_increment === "number" ? rawPositionSize.tier_increment : POSITION_SIZE_FALLBACK_DEFAULTS.tier_increment,
          tier_threshold_dollars: typeof rawPositionSize.tier_threshold_dollars === "number" ? rawPositionSize.tier_threshold_dollars : POSITION_SIZE_FALLBACK_DEFAULTS.tier_threshold_dollars,
          personal_dll_pct: typeof rawPositionSize.personal_dll_pct === "number" ? rawPositionSize.personal_dll_pct : POSITION_SIZE_FALLBACK_DEFAULTS.personal_dll_pct,
          max_risk_pct_per_trade: typeof rawPositionSize.max_risk_pct_per_trade === "number" ? rawPositionSize.max_risk_pct_per_trade : POSITION_SIZE_FALLBACK_DEFAULTS.max_risk_pct_per_trade,
          liquidity_comfort_cap: typeof rawPositionSize.liquidity_comfort_cap === "number"
            ? rawPositionSize.liquidity_comfort_cap
            : (LIQUIDITY_COMFORT_CAPS[symbol.toUpperCase()] ?? LIQUIDITY_COMFORT_CAP_DEFAULT),
          topstep_account_cap_override: typeof rawPositionSize.topstep_account_cap_override === "number" ? rawPositionSize.topstep_account_cap_override : null,
          computed_at_signal_time: true,
        };

        // W3A ratify-packet (2026-07-17) item 3: fallback-visibility audit. Fires ONLY
        // when at least one of the 6 fields above fell back to its hardcoded default —
        // a fully-overlaid config (the normal graduation path; framework-overlay.ts
        // always stamps these fields) produces an empty positionSizeFallbacks array and
        // this block is a no-op, so there is no false-positive noise on the expected
        // path. When it DOES fire, it means a strategy/session config bypassed the
        // overlay entirely (hand-created row, pre-overlay legacy row, corrupted
        // config) — previously invisible. This is visibility only: none of the 6
        // fallback VALUES are changed here.
        if (positionSizeFallbacks.length > 0) {
          insertAuditRow({
            action: "sizing.position_size_fallback_applied",
            entityType: "strategy",
            entityId: sessionConfig.strategyId ?? "unknown",
            decisionAuthority: "system",
            status: "info",
            input: { sessionId, symbol } as Record<string, unknown>,
            result: {
              fallbackFields: positionSizeFallbacks.map((f) => f.field),
              fallbacks: positionSizeFallbacks,
            } as Record<string, unknown>,
            correlationId: correlationId ?? null,
          }).catch((err: unknown) => {
            logger.warn({ err, sessionId, action: "sizing.position_size_fallback_applied" }, "sizing.position_size_fallback_applied audit write failed — non-blocking");
          });
        }

        const sizingInputs: RiskSizingInputs = {
          positionSizeConfig,
          accountBalance,
          cumulativeProfit,
          atrPoints,
          stopMultiplier,
          pointDollarValue,
          firmContractCap: firmCap,
          // Wave 22 firm-aware fields
          firm: (sessionRow.firmId ?? "topstep") as "topstep" | "mffu",
          // Topstep trailing-DD: resolution order per Pass 5 Track C F-5.
          // 1. session.config.trailing_dd_amount (operator override)
          // 2. TOPSTEP_TRAILING_DD_BY_SIZE[accountStartingFloor] (firm tier)
          // 3. fallback 2000 ($50K combine default)
          trailingDD: (() => {
            const cfg = sessionRow.config as { trailing_dd_amount?: number } | null;
            if (cfg && typeof cfg.trailing_dd_amount === "number") return cfg.trailing_dd_amount;
            return TOPSTEP_TRAILING_DD_BY_SIZE[accountStartingFloor] ?? 2000;
          })(),
          highWaterBalance,
          accountStartingFloor,
          // W23H.4: confluence-weighted sizing
          confluence_count: confluenceCount,
          confluence_size_multiplier_map: confluenceSizeMultiplierMap,
          // Wave 25 Pass 2 Inst-10: Drawdown-room cap (Topstep only).
          // currentDrawdownRoom = max(0, balance - trailingFloor)
          // trailingFloor = min(highWaterBalance - trailingDD, accountStartingFloor)
          // Only passed for firm="topstep" — MFFU uses static 2% rule.
          currentDrawdownRoom: (() => {
            const firmId = (sessionRow.firmId ?? "topstep") as string;
            if (firmId !== "topstep") return undefined;
            const trailingDDForRoom = (() => {
              const cfg = sessionRow.config as { trailing_dd_amount?: number } | null;
              if (cfg && typeof cfg.trailing_dd_amount === "number") return cfg.trailing_dd_amount;
              return TOPSTEP_TRAILING_DD_BY_SIZE[accountStartingFloor] ?? 2000;
            })();
            const trailingFloorForRoom = Math.min(highWaterBalance - trailingDDForRoom, accountStartingFloor);
            return Math.max(0, accountBalance - trailingFloorForRoom);
          })(),
          // Wave 26 Pass K Phase 2 (2026-05-26) — PM session size factor.
          // EOD-DD-aware multiplier per TTT Markets 2026-04 + SurgeFunded 2026-02.
          // Default: 1.0 AM, 0.50 at 13:30 ET decaying linearly to 0.25 by 15:00 ET,
          // 0.0 after 15:30 ET (no new entries). Configurable via PM_SIZE_FACTOR_AT_13_30
          // / PM_SIZE_FACTOR_AT_15_00 env vars.
          // Phase 2 (2026-06-22): PM session factor × firm-aware news-caution factor.
          // newsReduceSizeFactor is < 1 only when a Topstep account fires a signal inside a
          // T1 news window (caution = cut size; MFFU would have hard-blocked above instead).
          // #22 (2026-07-11): × the STRONGER of {news-caution, C11 FOMC ±1-day} taper via
          // min() — never the product — so a signal inside the tight FOMC window (both < 1)
          // is not double-halved, while the ±1-day-outside-window case still gets the FOMC cut.
          pmSizeFactor:
            computePmSizeFactor({ barTsUtc: new Date(bar.timestamp) }).factor *
            Math.min(newsReduceSizeFactor, fomcSizeFactor),
          // Balanced scaling plan: pass proven-trades count so live sizing can apply
          // the proven-trades ramp gate. Backtests do not pass this field and keep
          // the dollar-profit fallback inside computeRiskDerivedContracts.
          provenTrades: typeof sessionRow.provenTradesCount === "number"
            ? sessionRow.provenTradesCount
            : (sessionRow.provenTradesCount != null ? Number(sessionRow.provenTradesCount) : 0),
        };
        if (newsReduceSizeFactor < 1) {
          span.setAttribute("news_caution_size_applied", newsReduceSizeFactor);
          span.setAttribute("news_caution_event", newsReduceEvent);
        }

        const sizingResult = computeRiskDerivedContracts(sizingInputs);
        // Finding #10 fix (2026-06-22): when sizing returns 0, the backtest engine
        // SKIPS the trade entirely (zero-buffer rejection, trailing-floor binding,
        // drawdown-room cap at zero). Paper MUST match — placing 1 contract here
        // makes paper MORE active than backtest exactly when the account is most
        // stressed and poisons promotion-gate inputs.
        // Legitimate positive fractional results (e.g. 0.7 → 1 via floor) are still
        // floored to 1 by computeRiskDerivedContracts itself — only a true 0 means skip.
        if (sizingResult.finalContracts === 0) {
          riskGatePassed = false;
          span.setAttribute("signal_skipped_zero_size", true);
          span.setAttribute("sizing_rejection_reason", sizingResult.rejectionReason ?? "zero_contracts");
          logger.info(
            { sessionId, symbol, rejectionReason: sizingResult.rejectionReason },
            "Finding #10: sizing returned 0 contracts — skipping entry (matches backtest skip behavior)",
          );
          insertAuditRow({
            action: "signal.skipped_zero_size",
            entityType: "strategy",
            entityId: sessionConfig.strategyId ?? "unknown",
            decisionAuthority: "system",
            status: "info",
            input: { sessionId, symbol, accountBalance, drawdownRoom: sizingInputs.currentDrawdownRoom } as Record<string, unknown>,
            result: { finalContracts: 0, rejectionReason: sizingResult.rejectionReason ?? "zero_contracts" } as Record<string, unknown>,
            correlationId: correlationId ?? null,
          }).catch((e: unknown) => {
            logger.warn({ e, action: "signal.skipped_zero_size" }, "audit write failed — non-blocking");
            auditWriteFailuresTotal.labels({ action: "signal.skipped_zero_size" }).inc();
          });
        } else {
          baseContracts = sizingResult.finalContracts;
        }
        // LOW (freshscan8 2026-07-12): the pyramid path already applied the Tier-1 news / FOMC reduce
        // factor via pmSizeFactor inside computeRiskDerivedContracts — flag it so the non-pyramid block
        // below does NOT double-reduce.
        _newsReduceAppliedInSizing = true;

        // W23H.4: emit confluence multiplier audit row (best-effort, non-blocking)
        if (sizingResult.confluenceAudit) {
          insertAuditRow({
            action: "sizing.confluence_multiplier_applied",
            entityType: "strategy",
            entityId: sessionConfig.strategyId ?? "unknown",
            input: { sessionId, symbol, signal_direction: config.side } as Record<string, unknown>,
            result: sizingResult.confluenceAudit as unknown as Record<string, unknown>,
            status: "success",
            decisionAuthority: "system",
            correlationId: correlationId ?? null,
          }).catch((err: unknown) => logger.warn({ err, sessionId }, "sizing.confluence_multiplier_applied audit write failed"));
        }

        // Wave 25 Pass 2 Inst-10: emit audit row when drawdownRoomCap is binding.
        if (sizingResult.drawdownRoomCapBinding) {
          insertAuditRow({
            action: "sizing.drawdown_room_cap_binding",
            entityType: "strategy",
            entityId: sessionConfig.strategyId ?? "unknown",
            decisionAuthority: "system",
            result: {
              sessionId,
              symbol,
              drawdownRoomCap: sizingResult.drawdownRoomCap,
              finalContracts: sizingResult.finalContracts,
              bindingConstraint: "drawdown_room",
              accountBalance,
              highWaterBalance,
            } as Record<string, unknown>,
            status: "success",
            correlationId: correlationId ?? null,
          }).catch((err: unknown) => logger.warn({ err, sessionId }, "sizing.drawdown_room_cap_binding audit write failed"));
        }

        logger.debug(
          {
            sessionId,
            symbol,
            confluenceCount,
            multiplier: sizingResult.confluenceAudit?.multiplier,
            finalContracts: sizingResult.finalContracts,
            bindingConstraint: sizingResult.confluenceAudit?.binding_constraint,
            rejectionReason: sizingResult.rejectionReason,
          },
          "W23H.4: risk-derived sizing computed",
        );
      } else if (rawPositionSize?.type === "dynamic_atr") {
        // Legacy dynamic_atr path — preserve prior behavior for strategies not yet overlaid.
        // This branch is expected to be rare; framework-overlay normalizes to risk_derived_pyramid.
        if (atrPoints > 0 && spec) {
          const targetRisk = typeof rawPositionSize.target_risk === "number" ? rawPositionSize.target_risk : 200;
          const riskPerContract = atrPoints * spec.pointValue;
          baseContracts = riskPerContract > 0
            ? Math.min(Math.max(1, Math.floor(targetRisk / riskPerContract)), firmCap)
            : Math.min(config.contracts, firmCap);
        } else {
          baseContracts = Math.min(config.contracts, firmCap);
        }
      } else {
        // Fixed contracts or unknown position_size type — clamp to firm cap
        baseContracts = Math.min(config.contracts, firmCap);
      }

      // LOW (freshscan8 2026-07-12): apply the Tier-1 news / FOMC reduce factor to the NON-pyramid
      // (dynamic_atr / fixed) paths — the pyramid path folds it into pmSizeFactor inside
      // computeRiskDerivedContracts, but these legacy branches dropped it entirely, so a signal firing
      // inside a T1 news window on a dynamic_atr/fixed strategy traded FULL size while newsReducedAtSignalTime
      // was set true (and fill-time Gate 4 then skipped its own reduce, trusting the flag). Same min(news,fomc)
      // taper as the pyramid path; floored ≥1 (caution reduces, never zeroes — the T1 hard-block is separate).
      if (!_newsReduceAppliedInSizing) {
        const _nonPyramidNewsFactor = Math.min(newsReduceSizeFactor, fomcSizeFactor);
        if (_nonPyramidNewsFactor < 1) {
          const _preNews = baseContracts;
          baseContracts = Math.max(1, Math.floor(baseContracts * _nonPyramidNewsFactor));
          if (baseContracts < _preNews) {
            span.setAttribute("news_caution_size_applied", _nonPyramidNewsFactor);
            span.setAttribute("news_caution_event", newsReduceEvent);
          }
        }
      }

      // 60%-DLL reduce-size band (soft throttle BELOW the 67% halt): when the cross-symbol DLL
      // evaluation above put us in the reduce_size band, shrink whatever size the sizing path
      // produced. Floored to ≥1 — the reduce band sizes DOWN, it never zeroes (the 67% halt does).
      if (dllReduceSizeFactor < 1) {
        const preReduceContracts = baseContracts;
        baseContracts = Math.max(1, Math.floor(baseContracts * dllReduceSizeFactor));
        if (baseContracts < preReduceContracts) {
          span.setAttribute("dll_reduce_size_applied", true);
          insertAuditRow({
            action: "sizing.dll_reduce_size_applied",
            entityType: "paper_session", entityId: sessionId, decisionAuthority: "system", status: "warning",
            input: { sessionId, symbol, preReduceContracts, factor: dllReduceSizeFactor } as Record<string, unknown>,
            result: { contracts: baseContracts } as Record<string, unknown>,
          }).catch((e: unknown) => {
            logger.warn({ e, action: "sizing.dll_reduce_size_applied" }, "audit write failed — non-blocking");
            auditWriteFailuresTotal.labels({ action: "sizing.dll_reduce_size_applied" }).inc();
          });
        }
      }

      let contextContracts = skipReduce
        ? Math.max(1, Math.round(baseContracts / 2))
        : baseContracts;
      try {
        const ctxGate = await evaluateContextGate(
          // deep-scan C-1: pass the concept name, NOT strategyId (UUID) — the gate
          // name-matches against playbook allowed_strategies; a UUID never matches → SKIP.
          symbol, config.side, bar.close,
          sessionConfig.name, barBuffer, indicators,
        );
        if (ctxGate.action === "SKIP") {
          riskGatePassed = false;
          logger.info(
            { sessionId, symbol, action: "SKIP", reasons: ctxGate.reasoning },
            "Context gate SKIP — signal rejected",
          );
          // Persist SKIP decision to paper_signal_logs so it is auditable and
          // visible in post-session analysis.  The logSignal() path only fires
          // for entrySignal/exitSignal/stopHit; context gate SKIP bypasses that
          // condition and would otherwise leave no DB trace.
          try {
            const skipReason = `context_gate_skip: ${ctxGate.reasoning ?? "no reason"}`;
            await db.insert(paperSignalLogs).values({
              sessionId,
              symbol,
              direction: config.side,
              signalType: "context_gate_skip",
              price: String(bar.close),
              indicatorSnapshot: indicators,
              acted: false,
              reason: skipReason,
            });
          } catch (skipLogErr) {
            logger.error({ skipLogErr, sessionId }, "Failed to persist context gate SKIP log");
          }
        } else if (ctxGate.action === "REDUCE") {
          contextContracts = Math.max(1, Math.round(baseContracts * ctxGate.positionSizeAdjustment));
          logger.info(
            { sessionId, symbol, action: "REDUCE", from: baseContracts, to: contextContracts },
            "Context gate REDUCE — position size halved",
          );
          // Persist REDUCE decision to paper_signal_logs for auditable post-session
          // analysis.  Without this, a REDUCE is invisible — the trade fires at the
          // reduced size but the journal never explains why.
          try {
            const reduceReason = `context_gate_reduce: ${(ctxGate.reasoning ?? []).join("; ") || "no reason"}`;
            await db.insert(paperSignalLogs).values({
              sessionId,
              symbol,
              direction: config.side,
              signalType: "context_gate_reduce",
              price: String(bar.close),
              indicatorSnapshot: {
                ...indicators,
                _contracts_original: baseContracts,
                _contracts_adjusted: contextContracts,
                _context_gate_confidence: ctxGate.confidence,
                _position_size_adjustment: ctxGate.positionSizeAdjustment,
              },
              acted: true,
              reason: reduceReason,
            });
          } catch (reduceLogErr) {
            logger.error({ reduceLogErr, sessionId }, "Failed to persist context gate REDUCE log");
          }
        }
        // TAKE → proceed with full size
      } catch (err) {
        if (FAIL_CLOSED_EXECUTION) {
          riskGatePassed = false;
          logger.error({ err, sessionId }, "Context gate error — fail-closed blocks entry");
        } else {
          // Explicit fail-open mode: context gate error does NOT block the trade
          logger.debug({ err, sessionId }, "Context gate error — proceeding with TAKE");
        }
      }

      if (riskGatePassed) {
        // ─── B4.3: Governor gate — check state machine before entry ───
        // Governor mirrors Python's first-loss state machine used in
        // backtest_governor replay. State transitions fire via
        // updateGovernorOnTrade() when positions close.
        // Fail-open: if config.daily_loss_budget is missing, default to $500.
        const dailyBudget = (sessionConfig.config as unknown as Record<string, unknown>).daily_loss_budget as number | undefined ?? 500;
        const govResult = checkGovernor(sessionId, contextContracts, dailyBudget);
        if (!govResult.allowed) {
          riskGatePassed = false;
          span.setAttribute("governor_blocked", true);
          span.setAttribute("governor_state", govResult.governorState);
          logger.info(
            { sessionId, symbol, governorState: govResult.governorState, reason: govResult.reason },
            "Governor (B4.3): entry blocked — lockout state",
          );
          db.insert(paperSignalLogs).values({
            sessionId,
            symbol,
            direction: config.side,
            signalType: "governor_blocked",
            price: String(bar.close),
            indicatorSnapshot: { ...indicators, _governor_state: govResult.governorState },
            acted: false,
            reason: govResult.reason,
          }).catch((err: unknown) => logger.error({ err, sessionId }, "Failed to persist governor block log"));
        } else if (govResult.adjustedContracts < contextContracts) {
          // Governor reduced size — apply adjustment
          const prevContracts = contextContracts;
          contextContracts = govResult.adjustedContracts;
          span.setAttribute("governor_reduced", true);
          span.setAttribute("governor_state", govResult.governorState);
          logger.info(
            { sessionId, symbol, from: prevContracts, to: contextContracts, governorState: govResult.governorState },
            "Governor (B4.3): position size reduced",
          );
          db.insert(paperSignalLogs).values({
            sessionId,
            symbol,
            direction: config.side,
            signalType: "governor_reduced",
            price: String(bar.close),
            indicatorSnapshot: {
              ...indicators,
              _governor_state: govResult.governorState,
              _contracts_original: prevContracts,
              _contracts_adjusted: contextContracts,
            },
            acted: true,
            reason: govResult.reason,
          }).catch((err: unknown) => logger.error({ err, sessionId }, "Failed to persist governor reduce log"));
        }
      }

      // ─── B8b: PILOT canary — hard 1-contract ceiling ──────────────────────
      // This clamp runs AFTER all other sizing logic (ATR sizing, firm cap,
      // context gate REDUCE, Kelly/profit-tier, governor REDUCE) so no earlier
      // gate can inadvertently bypass it.
      //
      // PILOT strategies must run exactly 1 contract per the canary contract:
      //   "Exactly 1 contract is enforced by paper-signal-service during PILOT"
      //   (see checkPilotAutoPromotions() comment in lifecycle-service.ts).
      //
      // The clamp is HARD — no config, no env var, no override.  If the strategy
      // is in PILOT, it trades 1 contract.  Always.
      if (sessionConfig.lifecycleState === "PILOT" && riskGatePassed && contextContracts !== 1) {
        const dslMax = contextContracts;
        contextContracts = 1;
        logger.info(
          { sessionId, symbol, dslMax, pilotContracts: 1 },
          "PILOT canary: contracts clamped to 1 (DSL max=" + dslMax + ")",
        );
        span.setAttribute("pilot_canary_clamp", true);
        span.setAttribute("pilot_contracts_before_clamp", dslMax);
      }

      if (riskGatePassed) {
        // ─── FIX 1 (B2 PARITY CRITICAL): Defer entry to next bar ─────────────
        // backtester.py rolls signals +1 bar (np.roll) so fills happen at bar N+1.
        // Paper was executing at bar N's close — 1 bar early, systematically better
        // entry prices.  We enqueue the entry here and execute on the NEXT bar's close.
        action = "open"; // log as "open" pending — the actual fill happens on bar N+1
        const volumeSeries = barBuffer
          .map((bufferBar) => bufferBar.volume)
          .filter((volume): volume is number => Number.isFinite(volume));
        const sortedVolumes = [...volumeSeries].sort((left, right) => left - right);
        const medianBarVolume =
          sortedVolumes.length === 0
            ? undefined
            : sortedVolumes.length % 2 === 1
              ? sortedVolumes[Math.floor(sortedVolumes.length / 2)]
              : (sortedVolumes[sortedVolumes.length / 2 - 1] + sortedVolumes[sortedVolumes.length / 2]) / 2;
        const currentAtrForEntry = indicators["atr_14"];
        const stopLimitOffset = currentAtrForEntry ? 0.5 * currentAtrForEntry : undefined;

        // ─── Wave 29 Pass A.1: SHADOW stage intercept ───────────────────────────
        // When shadow_mode_enabled=true, the signal has passed all gates and
        // WOULD be queued for execution — but MUST NOT be.  Pine alerts already
        // fired upstream (TradingView chart shows the signal).  We log the signal
        // to lifecycle_shadow_signals and return early, NEVER calling TradersPost.
        //
        // Fail-soft on shadow INSERT failure: log error + STILL skip the pending
        // queue.  The shadow invariant (never route to TradersPost) is inviolable.
        //
        // Special case: strategy with shadow_mode_enabled=true AND
        // lifecycleState='PAPER' → operator override. Log inconsistency warn +
        // fall through to the normal PAPER path below (internal-engine fill —
        // see M3 note).
        //
        // M3 (2026-07-17) re-disposition: pre-M3 this comment (and the log
        // message / audit "decision" field below) said "routing to TradersPost" —
        // that phrasing described the OLD doctrine's intent, not what this code
        // ever literally did: "falling through" here has ALWAYS meant "reach the
        // normal pendingEntryQueue → openPosition() internal-fill path a few
        // lines below" (paper-execution-service.ts never calls routeOrder() /
        // TradersPost). Under the old doctrine the only way this fallthrough
        // could ALSO reach a real broker order was via the A/B rl-challenger
        // branch further down (paper_account_routing='rl-challenger'), which
        // gated on the OLD PAPER_PLUS_STATES set that included PAPER. Now that
        // PAPER is removed from BROKER_AUTHORITATIVE_STATES (item 3's shared
        // constant), that branch structurally can no longer reach routeOrder()
        // for a PAPER-state strategy either — so "falls through" now means
        // "internal fill, unconditionally" with no exception. The warn-audit for
        // the inconsistency itself (shadow flag set on an already-PAPER strategy)
        // is still worth surfacing — that part is preserved verbatim below.
        if (sessionConfig.shadowModeEnabled) {
          if (sessionConfig.lifecycleState === "PAPER") {
            // Operator override: shadow flag set but strategy already in PAPER.
            // Log the inconsistency and allow normal (internal-engine) execution.
            logger.warn(
              { sessionId, symbol, strategyId: sessionConfig.strategyId },
              "Wave 29 Pass A.1: shadow_mode_enabled=true but lifecycle_state=PAPER — operator override, routing to internal engine fill path (M3: PAPER is internal-engine-only)",
            );
            insertAuditRow({
              action: "lifecycle.shadow_mode_inconsistency_warn",
              entityType: "strategy",
              entityId: sessionConfig.strategyId,
              decisionAuthority: "system",
              result: {
                shadow_mode_enabled: true,
                lifecycle_state: "PAPER",
                decision: "override_route_to_internal_engine",
                symbol,
                direction: config.side,
                bar_timestamp: bar.timestamp,
                correlation_id: correlationId ?? null,
              } as Record<string, unknown>,
              status: "warning",
              correlationId: correlationId ?? null,
            }).catch((err: unknown) =>
              logger.warn({ err, sessionId }, "audit_log insert failed for lifecycle.shadow_mode_inconsistency_warn"),
            );
            // Fall through to normal pendingEntryQueue path below
          } else {
            // Normal SHADOW stage: intercept signal, log, skip TradersPost.
            span.setAttribute("shadow_mode_intercepted", true);
            logger.info(
              { sessionId, symbol, strategyId: sessionConfig.strategyId, side: config.side, contracts: contextContracts, price: bar.close },
              "Wave 29 Pass A.1: SHADOW stage signal intercepted — logging to lifecycle_shadow_signals, skipping TradersPost",
            );

            // Derive killzone from bar timestamp for shadow signal context.
            // Inline detection: London 03-08 ET, NY AM 08-12 ET, NY PM 12-16 ET.
            // Fail-soft: null on any error.
            let detectedKillzone: string | null = null;
            try {
              const barDate = bar.timestamp ? new Date(bar.timestamp) : new Date();
              const etHour = Number(
                barDate.toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false })
              );
              if (etHour >= 3 && etHour < 8) detectedKillzone = "london";
              else if (etHour >= 8 && etHour < 12) detectedKillzone = "ny_am";
              else if (etHour >= 12 && etHour < 16) detectedKillzone = "ny_pm";
            } catch {
              detectedKillzone = null;
            }

            // Derive weighted confluence score from current bar indicators (Path C) or null.
            const rawWeightedScore = (bar as unknown as Record<string, unknown>).__weightedScore as number | undefined;
            const shadowConfluenceScore: number | null =
              rawWeightedScore != null && Number.isFinite(rawWeightedScore) ? rawWeightedScore : null;

            // INSERT lifecycle_shadow_signals row.
            // traderspost_webhook_called MUST be false — invariant enforced here.
            // M2 (2026-06-23): use .returning({ id }) so we can immediately compute and
            // UPDATE divergence_vs_backtest on the same row (inline write — no cron needed).
            const shadowCorrelationId = correlationId ?? randomUUID();
            db.insert(lifecycleShadowSignals)
              .values({
                strategyId: sessionConfig.strategyId,
                signalTs: bar.timestamp ? new Date(bar.timestamp) : new Date(),
                direction: config.side,
                entryPrice: bar.close,
                intendedSize: contextContracts,
                killzone: detectedKillzone,
                regime: (biasState as Record<string, unknown> | null)?.regimeLabel as string | undefined ?? null,
                confluenceScore: shadowConfluenceScore,
                lifecycleState: "SHADOW",
                divergenceVsBacktest: null,  // set by writeShadowDivergence below
                sourceCorrelationId: shadowCorrelationId,
                traderspostWebhookCalled: false,  // INVARIANT: always false
              })
              .returning({ id: lifecycleShadowSignals.id })
              .then(([row]) => {
                if (!row?.id) return;
                // M2: compute + persist divergence_vs_backtest inline.
                // Fire-and-forget — shadow invariant (never route to TradersPost) must
                // not be blocked by a slow divergence computation.
                writeShadowDivergence(row.id as bigint, sessionConfig.strategyId, shadowCorrelationId)
                  .catch((err: unknown) =>
                    logger.warn(
                      { err, sessionId, strategyId: sessionConfig.strategyId },
                      "M2: writeShadowDivergence failed (non-blocking — shadow invariant preserved)",
                    ),
                  );
              })
              .catch((err: unknown) => {
                // Fail-soft: shadow INSERT failure logs error but STILL skips TradersPost.
                // The shadow invariant (never route) takes precedence over observability.
                logger.error(
                  { err, sessionId, strategyId: sessionConfig.strategyId, symbol },
                  "Wave 29 Pass A.1: lifecycle_shadow_signals INSERT failed — still skipping TradersPost (invariant preserved)",
                );
              });

            // Emit audit row: lifecycle.shadow_signal_logged
            insertAuditRow({
              action: "lifecycle.shadow_signal_logged",
              entityType: "strategy",
              entityId: sessionConfig.strategyId,
              decisionAuthority: "system",
              result: {
                direction: config.side,
                entry_price: bar.close,
                intended_size: contextContracts,
                killzone: detectedKillzone,
                regime: (biasState as Record<string, unknown> | null)?.regimeLabel ?? null,
                confluence_score: shadowConfluenceScore,
                lifecycle_state: "SHADOW",
                traderspost_webhook_called: false,
                symbol,
                bar_timestamp: bar.timestamp,
                correlation_id: shadowCorrelationId,
              } as Record<string, unknown>,
              status: "info",
              correlationId: shadowCorrelationId,
            }).catch((err: unknown) =>
              logger.warn({ err, sessionId }, "audit_log insert failed for lifecycle.shadow_signal_logged"),
            );

            // Emit SSE: signal:shadow_logged (per §10b — links bar → DB → SSE → audit)
            broadcastSSE("signal:shadow_logged", {
              sessionId,
              strategyId: sessionConfig.strategyId,
              symbol,
              direction: config.side,
              entryPrice: bar.close,
              intendedSize: contextContracts,
              killzone: detectedKillzone,
              regime: (biasState as Record<string, unknown> | null)?.regimeLabel ?? null,
              lifecycleState: "SHADOW",
              traderspostWebhookCalled: false,
              barTimestamp: bar.timestamp,
              correlationId: shadowCorrelationId,
            });

            // Wave 29 prod hardening: increment Prom counter #4 (shadow signals)
            try {
              const direction = config.side as string | undefined;
              // strategy_id must be numeric string; divergence_bucket defaults to
              // "pre_check" at shadow signal time (full divergence computed separately).
              shadowSignalsTotal.labels({
                strategy_id: String(sessionConfig.strategyId),
                divergence_bucket: "pre_check",
              }).inc();
            } catch (_promErr) { /* non-blocking */ }

            // RETURN EARLY — do NOT add to pendingEntryQueue, do NOT call TradersPost.
            previousIndicators.set(prevKey, indicators);
            span.setAttribute("shadow_signal_logged", true);
            span.end();
            return;
          }
        }
        // ─── End Wave 29 Pass A.1 SHADOW intercept ───────────────────────────

        // Store the pending entry — execution deferred to bar N+1 in the next evaluateSignals call
        const newPendingEntry: PendingEntry = {
          sessionId,
          symbol,
          side: config.side,
          contracts: contextContracts,
          orderType: "stop_limit",
          stopLimitOffset,
          rsi: indicators["rsi_14"],
          atr: currentAtrForEntry,
          barVolume: bar.volume,        // bar N's volume — used as fallback medianBarVolume context
          medianBarVolume,
          signalBarTimestamp: bar.timestamp,
          correlationId,
          // Wave 2 (2026-07-16): thread the config stop multiplier (default 1.5) so the deferred
          // fill's managed stop uses the SAME multiplier the sizer budgeted against at signal time.
          stopMultiplier: typeof config.stop_loss?.multiplier === "number" ? config.stop_loss.multiplier : 1.5,
          // deep-scan 2026-07-11 MED fix (#9): record whether signal-time sizing already applied the
          // Tier-1 news reduce factor (newsReduceSizeFactor < 1 ⟺ signal fired inside the T1 window) so
          // fill-time Gate 4 does not double-reduce.
          newsReducedAtSignalTime: newsReduceSizeFactor < 1,
          // Trade-critique data bridge (2026-07-05): whatever this signal actually knew
          // at bar N, carried to bar N+1's openPosition() call. `biasState` may be null
          // (legacy bypass strategy) — every field below degrades to null gracefully,
          // never throws, never fabricates.
          entryContext: {
            regimeAtEntry: biasState?.regimeLabel ?? null,
            structureState: biasState?.structureState ?? null,
            confluenceScore: entryCtxConfluenceScore,
            confluenceFactorsActive: entryCtxConfluenceFactorsActive,
            nearestLiquidityLevel: entryCtxNearestLiquidityLevel,
            atrAtEntry: currentAtrForEntry ?? null,
          },
        };
        pendingEntryQueue.set(pendingKey, newPendingEntry);
        // M2 (2026-07-17): durability backstop — persist so a restart between this
        // signal (bar N) and its fill (bar N+1) re-hydrates instead of dropping.
        // Fire-and-forget: never blocks the in-memory fast path; never throws.
        void persistPendingEntry(newPendingEntry);

        // ─── Wave 26 Pass G A.4: Archetype signal-fire audit hook ────────────
        // Fire-and-forget — never blocks the entry path.
        // Fires for bounce_off_level and ict_bias_aligned_continuation only when
        // an entry signal has passed all gates (riskGatePassed === true).
        // entry_indicator is "archetype:<name>" on graduated archetype strategies.
        try {
          const rawConfigForArchetype = config as unknown as Record<string, unknown>;
          const entryIndicatorForAudit = rawConfigForArchetype.entry_indicator as string | undefined;
          if (typeof entryIndicatorForAudit === "string" && entryIndicatorForAudit.startsWith("archetype:")) {
            const archetypeName = entryIndicatorForAudit.slice("archetype:".length);
            const entryParamsForAudit = (rawConfigForArchetype.entry_params ?? {}) as Record<string, unknown>;
            const barTs = typeof bar.timestamp === "number"
              ? new Date(bar.timestamp).toISOString()
              : typeof bar.timestamp === "string" ? bar.timestamp : new Date().toISOString();
            const signalDirection = (config.side === "short" ? "short" : "long") as "long" | "short";

            if (archetypeName === "bounce_off_level") {
              const { emitBounceOffLevelSignal } = await import("../lib/archetype-signal-audit.js");
              emitBounceOffLevelSignal({
                strategy_id:       sessionConfig.strategyId,
                correlation_id:    correlationId ?? null,
                direction:         signalDirection,
                ma_type:           typeof entryParamsForAudit.ma_type === "string" ? entryParamsForAudit.ma_type : "sma",
                ma_period:         typeof entryParamsForAudit.ma_period === "number" ? entryParamsForAudit.ma_period : 200,
                rejection_pattern: typeof entryParamsForAudit.rejection_pattern === "string" ? entryParamsForAudit.rejection_pattern : "any_close_back_through",
                bar_timestamp:     barTs,
              });
            } else if (archetypeName === "ict_bias_aligned_continuation") {
              const { emitIctBiasAlignedContinuationSignal } = await import("../lib/archetype-signal-audit.js");
              // htf_bias: derived from signal direction (ICT archetype ONLY fires when
              // HTF bias aligns with trade direction — this is the core archetype invariant).
              // structure_break_type, fvg_age_bars, killzone: bar-time Python values not
              // available in TS signal service. Emit best-effort defaults; Python compute()
              // has already validated these conditions before setting entry_long/entry_short.
              emitIctBiasAlignedContinuationSignal({
                strategy_id:          sessionConfig.strategyId,
                correlation_id:       correlationId ?? null,
                direction:            signalDirection,
                htf_bias:             signalDirection === "long" ? "bullish" : "bearish",
                structure_break_type: (entryParamsForAudit.structure_break_type as "BOS" | "CHoCH" | undefined) ?? "BOS",
                fvg_age_bars:         typeof entryParamsForAudit.fvg_age_bars === "number" ? entryParamsForAudit.fvg_age_bars : 0,
                killzone:             typeof entryParamsForAudit.killzone === "string" ? entryParamsForAudit.killzone : "unknown",
                bar_timestamp:        barTs,
              });
            }
          }
        } catch (archetypeAuditErr: unknown) {
          // Fire-and-forget — never rethrows; audit failure MUST NOT reach the entry path
          logger.warn(
            { err: String(archetypeAuditErr), sessionId, symbol },
            "paper-signal-service: archetype signal audit hook failed (non-blocking)",
          );
        }

        // ─── Wave 29 Pass C.3: A/B paper routing audit ───────────────────────
        // Emit quantum_rl.signal_routed audit + signal:rl_ab_routed SSE for every
        // signal that passes all gates, identifying which sub-account it maps to.
        //
        // Routing decision:
        //   strategies.paper_account_routing = 'rl-challenger'
        //     → Sub-Account 2 (slumdawg-rl-challenger)
        //   strategies.paper_account_routing = 'baseline' (default)
        //     → Sub-Account 1 (slumdawg-baseline)
        //
        // Fail-soft: if paper_account_routing column missing (legacy DB / schema drift),
        //   defaults to 'baseline' behavior — no routing change, no crash.
        //
        // Family constraint (CLAUDE.md feedback_family_not_part_of_operator_scaling):
        //   A/B routing is operator-only. Family accounts always go to 'baseline'.
        //   The routing field MUST NOT be set to 'rl-challenger' for family strategy IDs.
        //   This is enforced by only setting paper_account_routing='rl-challenger'
        //   via operator-controlled tooling, never auto-assigning it.
        try {
          const strategyForRouting = await db
            .select({ paperAccountRouting: strategies.paperAccountRouting })
            .from(strategies)
            .where(eq(strategies.id, sessionConfig.strategyId))
            .limit(1);

          const routingDecision = strategyForRouting[0]?.paperAccountRouting ?? "baseline";

          // ── Family invariant assertion (Fix LOW-5, 2026-06-28) ───────────────────
          // A/B rl-challenger routing is OPERATOR-ONLY (CLAUDE.md §13 + feedback
          // family_not_part_of_operator_scaling). account_strategy_assignments.
          // released_to_family=true marks a strategy distributed to a family member;
          // if such a strategy somehow has paper_account_routing='rl-challenger'
          // (operator tooling error), we refuse the routing and fall back to baseline.
          // This is a code-level assertion: normal flows never set rl-challenger on a
          // family strategy, but the DB column is mutable, so we verify here.
          let effectiveRoutingDecision = routingDecision;
          if (routingDecision === "rl-challenger") {
            const familyAssignment = await db
              .select({ releasedToFamily: accountStrategyAssignments.releasedToFamily })
              .from(accountStrategyAssignments)
              .where(eq(accountStrategyAssignments.strategyId, sessionConfig.strategyId))
              .limit(1);
            const isFamilyStrategy = familyAssignment[0]?.releasedToFamily === true;
            // MED-2: the override decision is isolated in a pure, unit-tested helper.
            const familyGuard = resolveEffectiveRouting(routingDecision, isFamilyStrategy);
            if (familyGuard.overridden) {
              logger.warn(
                {
                  strategyId: sessionConfig.strategyId,
                  paperAccountRouting: routingDecision,
                  correlationId: correlationId ?? null,
                },
                "paper-signal-service: FAMILY INVARIANT VIOLATION — strategy has paper_account_routing=rl-challenger but is released to family; overriding to baseline (family strategies must never route to rl-challenger)",
              );
              insertAuditRow({
                action: "quantum_rl.family_routing_override",
                entityType: "strategy",
                entityId: sessionConfig.strategyId,
                decisionAuthority: "system",
                result: {
                  db_routing: routingDecision,
                  effective_routing: "baseline",
                  reason: "family_strategy_must_not_route_to_rl_challenger",
                  correlation_id: correlationId ?? null,
                } as Record<string, unknown>,
                status: "warning",
                correlationId: correlationId ?? null,
              }).catch((err: unknown) =>
                logger.warn({ err }, "audit_log insert failed for quantum_rl.family_routing_override"),
              );
              effectiveRoutingDecision = familyGuard.effectiveRouting;
            }
          }
          // ── End family invariant assertion ────────────────────────────────────────

          const targetSubAccount = effectiveRoutingDecision === "rl-challenger"
            ? "slumdawg-rl-challenger"
            : "slumdawg-baseline";

          // ── Pass 6 Track B: resolve broker_account_id for the target sub-account ──
          // Look up the UUID assigned by migration 0159 to the paper sub-account row.
          // This UUID is required by routeOrder() — it's the broker_accounts PK.
          let resolvedAccountId: string | null = null;
          let routingCalled = false;
          let routingSuccess: boolean | null = null;

          const subAccountRows = await db
            .select({ accountId: brokerAccounts.accountId })
            .from(brokerAccounts)
            .where(
              and(
                eq(brokerAccounts.accountIdExternal, targetSubAccount),
                eq(brokerAccounts.firmId, "paper"),
              ),
            )
            .limit(1);
          resolvedAccountId = subAccountRows[0]?.accountId ?? null;

          // Only call routeOrder when explicitly set to rl-challenger
          // (baseline is the default — observability-only for most strategies).
          // The canonical path for PAPER+ strategies is:
          //   Pine alert → /api/live-order → routeOrder() (wired in Pass 4 Track B)
          // SHADOW strategies are gated out earlier (SHADOW intercept block above).
          //
          // B1 capital-safety guard (2026-06-23; M3 2026-07-17 re-disposition): routeOrder()
          // places an EXTERNAL broker order (TradersPost). Per §8 paper-engine authority,
          // ONLY broker-authoritative strategies (DEPLOY_READY / PILOT / DEPLOYED — PAPER
          // moved OUT of this set as of M3, see paper-authority-states.ts) interact with the
          // broker — CANDIDATE / TESTING / PAPER all use the internal simulator ONLY. Before
          // the original B1 guard, the A/B rl-challenger branch fired routeOrder() for
          // pre-PAPER states (the old comment here even said "For CANDIDATE/TESTING ... we
          // call routeOrder() directly here"), publishing a real broker order from a wrong
          // lifecycle state. Skip (not throw) so the bar-eval loop + audit row continue.
          // M3 note: this is the SAME literal PAPER_PLUS_STATES the packet's item 3 flags as
          // one of 3 independent duplicated-constant sites — now a shared import so it can
          // never drift from routes/paper.ts or scheduler.ts's copies again. Because PAPER no
          // longer satisfies this check, this is also what structurally closes item 4's
          // shadow-override branch: even when that branch "falls through" to the normal path
          // below, a PAPER-state strategy routed to rl-challenger can no longer reach
          // routeOrder() here — it only ever reaches the internal fill path (pendingEntryQueue).
          const lcStateForRouting = sessionConfig.lifecycleState ?? "";
          if (effectiveRoutingDecision === "rl-challenger" && resolvedAccountId !== null) {
            if (!BROKER_AUTHORITATIVE_STATES.includes(lcStateForRouting as typeof BROKER_AUTHORITATIVE_STATES[number])) {
              logger.warn(
                {
                  strategyId: sessionConfig.strategyId,
                  lifecycleState: lcStateForRouting,
                  symbol,
                  correlationId: correlationId ?? null,
                },
                "B1: routeOrder skipped — non-broker-authoritative lifecycle state may not place external broker orders (capital safety)",
              );
            } else {
              routingCalled = true;
              const { routeOrder } = await import("./broker-router.js");
              const signal = {
                action: (config.side === "short" ? "enter_short" : "enter_long") as
                  "enter_long" | "enter_short" | "exit_long" | "exit_short" | "exit",
                ticker: symbol,
                quantity: contextContracts,
                strategyId: sessionConfig.strategyId,
                barTimestamp: typeof bar.timestamp === "number"
                  ? new Date(bar.timestamp).toISOString()
                  : typeof bar.timestamp === "string" ? bar.timestamp : undefined,
              };
              const routeResult = await routeOrder(resolvedAccountId, signal, correlationId ?? null);
              routingSuccess = routeResult.success;
            }
          }

          // ── Audit row fires AFTER routing (not before — closes observability illusion) ──
          insertAuditRow({
            action: "quantum_rl.signal_routed",
            entityType: "strategy",
            entityId: sessionConfig.strategyId,
            decisionAuthority: "system",
            result: {
              paper_account_routing: routingDecision,          // raw DB value
              effective_routing: effectiveRoutingDecision,     // after family-invariant override
              target_sub_account: targetSubAccount,
              resolved_account_id: resolvedAccountId,
              routing_called: routingCalled,
              routing_success: routingSuccess,
              symbol,
              side: config.side,
              contracts: contextContracts,
              signal_bar: bar.timestamp,
              session_id: sessionId,
              correlation_id: correlationId ?? null,
            } as Record<string, unknown>,
            status: "info",
            correlationId: correlationId ?? null,
          }).catch((err: unknown) =>
            logger.warn({ err, sessionId }, "audit_log insert failed for quantum_rl.signal_routed"),
          );

          broadcastSSE("signal:rl_ab_routed", {
            sessionId,
            strategyId: sessionConfig.strategyId,
            symbol,
            routing: routingDecision,
            targetSubAccount,
            resolvedAccountId,
            routingCalled,
            routingSuccess,
            side: config.side,
            contracts: contextContracts,
            signalBar: bar.timestamp,
          });
        } catch (abRoutingErr: unknown) {
          // Fail-soft: A/B routing audit failure MUST NOT block the entry path
          logger.warn(
            { err: String(abRoutingErr), sessionId, symbol },
            "paper-signal-service: A/B routing audit failed (non-blocking)",
          );
        }
        // ─── End Wave 29 Pass C.3 A/B routing ────────────────────────────────

        span.setAttribute("pending_entry_queued", true);
        span.setAttribute("signal_bar", bar.timestamp);
        logger.info(
          { sessionId, symbol, side: config.side, signalPrice: bar.close, contracts: contextContracts },
          "FIX 1: Entry signal queued — will execute at next bar's close (next-bar fill parity with backtest)",
        );
      }
    }
  }

  // Store current indicators for next bar's crossover detection
  previousIndicators.set(prevKey, indicators);

  // Log the signal evaluation
  await logSignal({
    sessionId,
    symbol,
    timestamp: bar.timestamp,
    entrySignal,
    exitSignal,
    stopHit,
    sessionFiltered,
    windowFiltered,  // W23H.3
    cooldownActive,
    riskGatePassed,
    action,
    indicators,
    barClose: bar.close,
    strategySide: config.side,  // BUG 1 fix: pass actual strategy side
    fillMiss,
  });
  } finally {
    span.end();
  }
}

/**
 * Backfill state for a bar without executing trades or logging signals.
 * Used to repair indicator state after a connection drop.
 */
export async function updateStateOnly(
  sessionId: string,
  symbol: string,
  bar: Bar,
  barBuffer: Bar[]
): Promise<void> {
  const sessionConfig = await getSessionConfig(sessionId);
  if (!sessionConfig) return;

  const indicators = computeIndicators(barBuffer);
  const prevKey = `${sessionId}:${symbol}`;
  
  // Just update the previous indicators so the NEXT real-time bar has correct context
  previousIndicators.set(prevKey, indicators);
}
