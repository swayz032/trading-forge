import { db } from "../db/index.js";
import { paperSessions, paperPositions, strategies, paperSignalLogs, skipDecisions, shadowSignals } from "../db/schema.js";
import { openPosition, closePosition } from "./paper-execution-service.js";
import { checkRiskGate } from "./paper-risk-gate.js";
import { evaluateContextGate } from "./context-gate-service.js";
import { checkAntiSetupGate, type AntiSetupGateResult } from "./anti-setup-gate-service.js";
import { broadcastSSE } from "../routes/sse.js";
import { logger } from "../lib/logger.js";
import { eq, and, isNull, gte, lte, desc } from "drizzle-orm";
import { tracer } from "../lib/tracing.js";
import { isDSLStrategy, translateDSLToPaperConfig } from "./dsl-translator.js";
import { getActiveLockout } from "./strategy-lockout-service.js";
import { isActive as isPipelineActive } from "./pipeline-control-service.js";
import { isUsDst } from "../lib/dst-utils.js";
import { CONTRACT_SPECS, CONTRACT_CAP_MIN, CONTRACT_CAP_MAX } from "../../shared/firm-config.js";
const FAIL_CLOSED_EXECUTION = process.env.TF_FAIL_CLOSED_EXECUTION !== "0";

// ─── P1-6: Firm Contract Cap Lookup ─────────────────────────────────────────
// TS mirror of firm_config.py::FIRM_CONTRACT_CAPS.
// All firms allow the same per-symbol caps (10 min, 15 default, 20 max).
// getFirmContractCap() is a pure lookup — no Python subprocess needed.

const FIRM_CONTRACT_CAPS_TS: Record<string, Record<string, number>> = {
  topstep_50k:    { MES: 15, MNQ: 15, MCL: 15 },
  mffu_50k:       { MES: 15, MNQ: 15, MCL: 15 },
  tpt_50k:        { MES: 15, MNQ: 15, MCL: 15 },
  apex_50k:       { MES: 15, MNQ: 15, MCL: 15 },
  tradeify_50k:   { MES: 15, MNQ: 15, MCL: 15 },
  alpha_50k:      { MES: 15, MNQ: 15, MCL: 15 },
  ffn_50k:        { MES: 15, MNQ: 15, MCL: 15 },
  earn2trade_50k: { MES: 15, MNQ: 15, MCL: 15 },
  // Aliases for firmIds without _50k suffix (matches session.firmId values)
  topstep:    { MES: 15, MNQ: 15, MCL: 15 },
  mffu:       { MES: 15, MNQ: 15, MCL: 15 },
  tpt:        { MES: 15, MNQ: 15, MCL: 15 },
  apex:       { MES: 15, MNQ: 15, MCL: 15 },
  tradeify:   { MES: 15, MNQ: 15, MCL: 15 },
  alpha:      { MES: 15, MNQ: 15, MCL: 15 },
  ffn:        { MES: 15, MNQ: 15, MCL: 15 },
  earn2trade: { MES: 15, MNQ: 15, MCL: 15 },
};

/**
 * Returns the firm contract cap for a given firmKey + symbol.
 * Clamped to [CONTRACT_CAP_MIN, CONTRACT_CAP_MAX] per firm_config.py.
 * Falls back to CONTRACT_CAP_MAX (15) when firmKey or symbol is unknown.
 */
function getFirmContractCap(firmKey: string | null | undefined, symbol: string): number {
  if (!firmKey) return CONTRACT_CAP_MAX;
  const caps = FIRM_CONTRACT_CAPS_TS[firmKey.toLowerCase()];
  if (!caps) return CONTRACT_CAP_MAX;
  const raw = caps[symbol.toUpperCase()] ?? CONTRACT_CAP_MAX;
  return Math.max(CONTRACT_CAP_MIN, Math.min(raw, CONTRACT_CAP_MAX));
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

async function getCachedSignalCalendarStatus(
  barTimestamp: string,
): Promise<SignalCalendarCacheEntry> {
  const key = formatSignalEtHourKey(barTimestamp);
  const cached = signalCalendarCache.get(key);
  if (cached !== undefined) return cached;

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
  type: "atr" | "fixed";
  multiplier?: number;   // for ATR stop
  amount?: number;        // for fixed stop
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
  symbol: string;
  timeframe: string;             // e.g. "1m", "5m", "15m", "1h"
  cooldownRemaining: number;     // bars remaining in cooldown
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
}

const pendingEntryQueue = new Map<string, PendingEntry>();

/**
 * Test hook — clear pending entry queue between tests.
 * Production code must never call this.
 */
export function __clearPendingEntryQueueForTests(): void {
  pendingEntryQueue.clear();
}

// ─── Fix 4: Parity divergence warning — logged once per session start ──────
// Paper enforces skip engine + anti-setup gates ALWAYS.
// Backtest defaults: TF_BACKTEST_SKIP_MODE=off, TF_BACKTEST_ANTI_SETUP_MODE=off.
// This means the DEPLOY_READY gate compares filtered paper Sharpe against
// unfiltered backtest Sharpe — apples to oranges.  We surface this as a
// structured WARNING once per session so operators can act on it.
// Resolution: set TF_BACKTEST_SKIP_MODE=enforce to align both sides.
const parityWarnedSessions = new Set<string>();

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
    .set({ governorState: governorSnapshot })
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

  const adjusted = Math.max(1, Math.floor(requestedContracts * mult));
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
  cooldownActive: boolean;
  riskGatePassed: boolean | null;
  action: "none" | "open" | "close_signal" | "close_stop" | "close_trail" | "close_time";
  indicators: Record<string, number>;
  barClose: number;
  strategySide: "long" | "short";   // actual strategy side for correct signal logging
  fillMiss?: boolean;               // true when fill probability model rejected the order
}

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
    symbol: strategy.symbol,
    timeframe: strategy.timeframe ?? "1m",
    cooldownRemaining: 0,
  };

  sessionCache.set(sessionId, entry);
  return entry;
}

export function invalidateSessionCache(sessionId: string): void {
  sessionCache.delete(sessionId);
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

function computeIndicators(barBuffer: Bar[]): IndicatorValues {
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

  // VWAP (full buffer = intraday assumption; caller resets buffer daily)
  vals["vwap"] = VWAP(barBuffer);

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
  // VWAP
  "vwap",
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

function checkStopLoss(
  position: { side: string; entryPrice: string },
  bar: Bar,
  stopConfig: StopLossConfig | undefined,
  indicators: IndicatorValues
): { hit: boolean; stopPrice: number } {
  if (!stopConfig) return { hit: false, stopPrice: 0 };

  const entryPrice = Number(position.entryPrice);
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

/**
 * Restore in-memory position state after a server restart.
 * Called by the scheduler during paper session resume.
 */
export function restorePositionState(
  positions: { id: string; trailHwm: string | null; barsHeld: number }[],
): void {
  for (const pos of positions) {
    if (pos.trailHwm != null) {
      trailStopHWM.set(pos.id, Number(pos.trailHwm));
    }
    if (pos.barsHeld > 0) {
      positionBarsHeld.set(pos.id, pos.barsHeld);
    }
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
  const correlationId = context?.correlationId;
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

  // ─── 2.5: Calendar filter ────────────────────────────────────
  // Check holidays AND FOMC/CPI/NFP ±30min blackout.
  // Fix 3: results are cached per ET hour — at most 24 Python spawns/day instead of
  // one per bar (~390 bars/day for 1m bars). Hour granularity is safe given ±30min
  // blackout windows: at most one stale hit at the hour boundary, then corrects.
  let calendarBlocked = false;
  let calendarBlockReason = "";
  try {
    const calResult = await getCachedSignalCalendarStatus(bar.timestamp);

    if (calResult.is_holiday === true) {
      calendarBlocked = true;
      calendarBlockReason = "holiday";
      logger.info({ sessionId, symbol, date: bar.timestamp }, "Calendar filter: holiday — skipping signals");
    } else if (calResult.is_economic_event === true) {
      calendarBlocked = true;
      calendarBlockReason = calResult.economic_event_name;
      logger.info(
        {
          sessionId, symbol, event: calResult.economic_event_name,
          windowMinutes: calResult.event_window_minutes, timestamp: bar.timestamp,
        },
        `Calendar filter: ${calResult.economic_event_name} ±${calResult.event_window_minutes}min blackout — skipping signals`,
      );
      span.setAttribute("calendar_block_event", calResult.economic_event_name);
    }
  } catch (calErr) {
    // Calendar check is non-blocking — trading continues (fail-open).
    // BUT the failure must be VISIBLE: a silent swallow hides a broken risk guard.
    // Log at error level so the operator can see the guard is down.
    logger.error(
      { sessionId, symbol, err: calErr },
      "Calendar guard DOWN — Python calendar_filter failed; trading continues unblocked",
    );
    // Broadcast SSE so the dashboard can surface a warning banner immediately.
    broadcastSSE("alert:calendar_guard_down", {
      sessionId,
      symbol,
      error: calErr instanceof Error ? calErr.message : String(calErr),
      timestamp: bar.timestamp,
    });
    span.setAttribute("calendar_guard_down", true);
  }

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
      barVolume: bar.volume,            // use bar N+1's volume for fill probability
      medianBarVolume: pendingEntry.medianBarVolume,
    }, { correlationId: pendingEntry.correlationId });

    if (deferredResult.position) {
      action = "open";
      positionBarsHeld.set(deferredResult.position.id, 0);
      span.setAttribute("deferred_fill", true);
      span.setAttribute("signal_bar", pendingEntry.signalBarTimestamp);
      logger.info(
        { sessionId, symbol, side: pendingEntry.side, executionPrice: bar.close, contracts: pendingEntry.contracts },
        "FIX 1: Deferred entry filled — position opened at bar N+1 close",
      );
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

    // Fixed stop-loss check
    const stopResult = checkStopLoss(openPos, bar, config.stop_loss, indicators);
    stopHit = stopResult.hit;

    // Priority order: fixed stop > trail stop > time exit > exit signal
    // Fixed stop is checked first because it is the firm risk limit.
    // P1-8: Pass bar timestamp to closePosition so session classification uses bar time, not wall-clock.
    const barTs = new Date(bar.timestamp);
    if (stopHit) {
      action = "close_stop";
      positionBarsHeld.delete(openPos.id);
      trailStopHWM.delete(openPos.id);
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
      await closePosition(openPos.id, bar.close, currentAtr, { correlationId, barTimestamp: barTs });
      await setCooldown(sessionId, sessionConfig, config.cooldown_bars ?? 4);
      logger.info(
        { sessionId, symbol, reason: "exit_signal" },
        "Paper position closed — exit signal",
      );
    }
    // Position still open: bars-held counter updated above; HWM updated inside checkTrailStop.
  } else if (entrySignal && !sessionFiltered && !cooldownActive && !isShadow && !skipBlocked && !ictBridgeBlocked) {
    // ─── No position: check for entry ───────────────��───────

    // ─── Tier 5.3: 24-hour lockout gate ─────────────────────────────────
    // Runs BEFORE anti-setup and risk gate. If a strategy lockout is active
    // (written by writeLockoutFromKillEvent on daily_loss_kill), block all
    // new entry signals until the lockout expires.
    // Fail-OPEN: lockout query errors return null so trading is not blocked.
    let lockoutBlocked = false;
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

    // ─���─ Anti-setup gate: check if known bad pattern blocks entry ──
    // Anti-setup gate short-circuits if lockout is already active
    let antiSetupBlocked = lockoutBlocked;
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
          day_of_week: new Date(bar.timestamp).getDay(),
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

    if (riskGatePassed) {
      // ─── Context Gate: TAKE/REDUCE/SKIP ───────────────────

      // P1-6(b): Dynamic ATR sizing — mirrors backtester's compute_position_sizes().
      // When config.position_size.type === "dynamic_atr", compute contracts as:
      //   floor(target_risk_dollars / (atr * tick_value)), minimum 1.
      // Falls back to config.contracts for fixed sizing or missing ATR.
      const positionSizeCfg = (config as unknown as Record<string, unknown>).position_size as
        | { type?: string; target_risk?: number; fixed_contracts?: number }
        | undefined;
      let baseContracts = config.contracts;
      if (positionSizeCfg?.type === "dynamic_atr") {
        const currentAtrForSizing = indicators["atr_14"];
        const spec = CONTRACT_SPECS[symbol];
        if (currentAtrForSizing && currentAtrForSizing > 0 && spec) {
          const targetRisk = positionSizeCfg.target_risk ?? 200;
          const _tickValue = spec.tickValue; // retained for reference; pointValue used below
          const atrInPoints = currentAtrForSizing; // ATR is already in price points
          // dollar risk per contract = atr_points * point_value = atr_ticks * tick_value
          // Using tick_value matches sizing.py: raw = target_risk / (atr * point_value)
          // but atr here is in points so: risk = atr * point_value
          const riskPerContract = atrInPoints * spec.pointValue;
          if (riskPerContract > 0) {
            baseContracts = Math.max(1, Math.floor(targetRisk / riskPerContract));
          }
        }
      }

      // P1-6(a): Apply firm contract cap (clamped to [CONTRACT_CAP_MIN, CONTRACT_CAP_MAX])
      const firmCap = getFirmContractCap(sessionRow.firmId, symbol);
      baseContracts = Math.min(baseContracts, firmCap);

      let contextContracts = skipReduce
        ? Math.max(1, Math.round(baseContracts / 2))
        : baseContracts;
      try {
        const ctxGate = await evaluateContextGate(
          symbol, config.side, bar.close,
          sessionConfig.strategyId, barBuffer, indicators,
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

        // Store the pending entry — execution deferred to bar N+1 in the next evaluateSignals call
        pendingEntryQueue.set(pendingKey, {
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
        });

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
