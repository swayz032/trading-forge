import { db } from "../db/index.js";
import { paperSessions, paperPositions, paperTrades, strategies, shadowSignals, auditLog, macroSnapshots, skipDecisions, complianceRulesets, contractRolls } from "../db/schema.js";
import { writeLockoutFromKillEvent } from "./strategy-lockout-service.js";
import { eq, and, isNull, desc, sql } from "drizzle-orm";
import { broadcastSSE } from "../routes/sse.js";
import { logger } from "../lib/logger.js";
import { onPaperTradeClose } from "../scheduler.js";
import { getFirmAccount, CONTRACT_SPECS, getCommissionPerSide } from "../../shared/firm-config.js";
import { toEasternDateString, invalidateDailyLossCache } from "./paper-risk-gate.js";
import { getEtOffsetMinutes } from "../lib/dst-utils.js";
import { tracer } from "../lib/tracing.js";
import { withSessionLock } from "../lib/db-locks.js";
import { paperTrades as paperTradesCounter } from "../lib/metrics-registry.js";
import { isActive as isPipelineActive } from "./pipeline-control-service.js";
import { AlertFactory } from "./alert-service.js";
import { computeRollSpreadCost } from "../lib/roll-calendar-loader.js";
export { CONTRACT_SPECS };

// ─── Kill Switch cache (D6) ─────────────────────────────────────
// Cached per session for 5s. Same session cannot trip kill repeatedly in rapid
// succession (e.g. two signals in the same bar). Cache is intentionally SHORT:
// 5s — stale decisions are better than stale 60s decisions for a kill switch.
//
// Fail-CLOSED: if the Python subprocess fails, the kill switch blocks the order.
// This is the inverse of the C5 compliance gate (fail-open). Rationale:
//   - Compliance gate failure: rules stale → recoverable, proceed with alert.
//   - Kill switch failure: could mean the account is already blown → BLOCK always.
// Operators will see the order block + SSE alert and can manually resume.
interface KillSwitchCacheEntry {
  tripped: boolean;
  reason: string | null;
  force_close: boolean;
  daily_pnl_pct: number;
  cachedAt: number;
}
const KILL_SWITCH_CACHE_TTL_MS = 5_000;
const killSwitchCache = new Map<string, KillSwitchCacheEntry>();

/** Test/admin hook — clear kill switch cache (force re-evaluation). */
export function clearKillSwitchCache(): void {
  killSwitchCache.clear();
}

// ─── Compliance Gate cache (B4.4 / C5) ──────────────────────────
// Cache the full check result per firm for 60s so we don't spawn a
// Python subprocess on every bar / signal.  The cache key is firmId;
// invalidation happens automatically on TTL expiry (no event-bus hook
// because compliance_rulesets are written by a separate service and
// freshness is itself the freshness check).
//
// Each entry stores BOTH the freshness result AND the violation result
// so a single Python call covers both checks.  If freshness fails the
// violation step is skipped (stale rules can't be trusted to evaluate).
interface ComplianceCacheEntry {
  fresh: boolean;
  freshnessStatus: string;
  freshnessMessage: string;
  driftDetected: boolean;
  violation: boolean;
  violationStatus: string;
  violationMessage: string;
  violations: string[];
  cachedAt: number;
}
const COMPLIANCE_CACHE_TTL_MS = 60_000;
const complianceCache = new Map<string, ComplianceCacheEntry>();

/** Test/admin hook — clear the in-memory cache (force re-evaluation). */
export function clearComplianceCache(): void {
  complianceCache.clear();
}

// ─── Calendar Filter Cache (Fix 3) ──────────────────────────────
// The Python calendar_filter subprocess adds 50-150ms per call.
// Calendar status (holiday, economic event blackout) doesn't change within a given
// clock-hour, so we cache results keyed by ET hour string (YYYY-MM-DD-HH).
// Economic event blackout windows are ±30 min, so hour-level granularity is safe:
// at most one stale fetch at the hour boundary, then the cache corrects itself.
// This reduces subprocess spawns from ~O(bars/day) to at most 24/day.
// Cache is process-local (paper engine is single-instance; no Redis needed).

interface CalendarCacheEntry {
  is_holiday: boolean;
  is_triple_witching: boolean;
  holiday_proximity: number;
  is_economic_event: boolean;
  economic_event_name: string;
  event_window_minutes: number;
}

const calendarCache = new Map<string, CalendarCacheEntry>();

/**
 * Test-only: reset the calendar cache between unit tests so mocked Python
 * responses aren't masked by a previously-cached entry from an earlier test
 * within the same hour-key bucket. Production code should never call this.
 */
export function __resetCalendarCacheForTests(): void {
  calendarCache.clear();
}

// ─── FIX 4: Calendar filter failure tracking (B4 MED) ────────────────────────
// Track consecutive subprocess failures within a rolling 10-minute window.
// After 3+ failures in 10 min, emit a systemError alert so operators know the
// calendar guard is persistently down (not just a transient hiccup).
// In-memory: process-local, intentionally non-persistent.
interface CalendarFailureTracker {
  count: number;
  windowStart: number;  // epoch ms
  alertFired: boolean;
}
const CALENDAR_FAILURE_WINDOW_MS = 10 * 60_000; // 10 minutes
const CALENDAR_FAILURE_THRESHOLD = 3;
const calendarFailureTracker: CalendarFailureTracker = {
  count: 0,
  windowStart: Date.now(),
  alertFired: false,
};

/** Test hook — reset calendar failure tracker between tests. */
export function __resetCalendarFailureTrackerForTests(): void {
  calendarFailureTracker.count = 0;
  calendarFailureTracker.windowStart = Date.now();
  calendarFailureTracker.alertFired = false;
}

/**
 * Format a Date as an ET hour key (YYYY-MM-DD-HH) for calendar caching.
 * Uses getEtOffsetMinutes from dst-utils for correct UTC→ET conversion.
 */
function formatEtHourKey(now: Date): string {
  const offsetMs = getEtOffsetMinutes(now) * 60_000;
  const etDate = new Date(now.getTime() + offsetMs);
  const yyyy = etDate.getUTCFullYear();
  const mm   = String(etDate.getUTCMonth() + 1).padStart(2, "0");
  const dd   = String(etDate.getUTCDate()).padStart(2, "0");
  const hh   = String(etDate.getUTCHours()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}-${hh}`;
}

/**
 * Run the Python calendar_filter with hour-level caching.
 * Falls back to a safe null result if the subprocess fails; callers
 * must handle null (same fail-open / fail-closed semantics as before).
 */
async function getCachedCalendarStatus(now: Date): Promise<CalendarCacheEntry | null> {
  const key = formatEtHourKey(now);
  const cached = calendarCache.get(key);
  if (cached !== undefined) return cached;

  try {
    const { runPythonModule } = await import("../lib/python-runner.js");
    const result = await runPythonModule<CalendarCacheEntry>({
      module: "src.engine.skip_engine.calendar_filter",
      config: {
        date: now.toISOString().split("T")[0],
        datetime: now.toISOString(),
      },
      timeoutMs: 5_000,
      componentName: "calendar-filter",
    });
    calendarCache.set(key, result);
    return result;
  } catch (err) {
    // FIX 4 (B4 MED): Structured warn log — visible in ops dashboards.
    // Do NOT cache failures so the next bar retries automatically.
    // Keep fail-open: return null, callers treat null as "no block".
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.warn(
      { fn: "getCachedCalendarStatus", date: now.toISOString(), component: "calendar-filter", err: errMsg },
      "Calendar filter subprocess failed — proceeding without calendar gate",
    );

    // Repeat-alert: fire a systemError if 3+ failures occur within 10 minutes.
    const nowMs = Date.now();
    if (nowMs - calendarFailureTracker.windowStart > CALENDAR_FAILURE_WINDOW_MS) {
      // Reset window
      calendarFailureTracker.count = 1;
      calendarFailureTracker.windowStart = nowMs;
      calendarFailureTracker.alertFired = false;
    } else {
      calendarFailureTracker.count++;
    }

    if (
      calendarFailureTracker.count >= CALENDAR_FAILURE_THRESHOLD &&
      !calendarFailureTracker.alertFired
    ) {
      calendarFailureTracker.alertFired = true;
      AlertFactory.systemError(
        "calendar-filter-repeated-failure",
        new Error(`Calendar filter subprocess failed ${calendarFailureTracker.count}+ times in 10 min: ${errMsg}`),
      );
    }

    return null;
  }
}

export interface ExecutionResult {
  positionId: string;
  entryPrice: number;
  contracts: number;
  slippage: number;
  expectedPrice: number;
  actualPrice: number;
  arrivalPrice: number;
  implementationShortfall: number;
  fillRatio: number;
  filled: boolean;
}

// ─── Slippage Calculation ────────────────────────────────────

function calculateSlippage(
  symbol: string,
  baseSlippageTicks: number = 1,
  atr?: number,
  medianAtr?: number,
  orderType?: string,
  session?: string,
): number {
  const spec = CONTRACT_SPECS[symbol];
  if (!spec) return 0;

  // Variable slippage: scale with ATR (matches backtester's slippage.py)
  let slippageTicks = baseSlippageTicks;
  if (atr && medianAtr && medianAtr > 0) {
    slippageTicks = baseSlippageTicks * (atr / medianAtr);
  }

  // Order-type modifier (matches slippage.py)
  let orderMod = 1.0;
  if (orderType === "stop_market") orderMod = 2.0;
  else if (orderType === "limit") orderMod = 0.5;
  else if (orderType === "stop_limit") orderMod = 1.0;

  // Session multiplier (overnight = 3x, London = 1.5x, RTH = 1x, CME_HALT = 100x for exits)
  // P1-7: CME_HALT uses 100x multiplier matching backtest's liquidity.py settlement model.
  // P1-1 (Task 3): OVERNIGHT/ASIAN changed from 2.0x to 3.0x to align with
  //   src/engine/liquidity.py:22 ("overnight": 3.0).
  //   2.0x was systematically understating overnight slippage, causing paper P&L to
  //   be overstated for strategies that hold through session transitions.
  let sessionMult = 1.0;
  if (session === "CME_HALT") sessionMult = 100.0;
  else if (session === "OVERNIGHT" || session === "ASIAN") sessionMult = 3.0;
  else if (session === "LONDON") sessionMult = 1.5;

  return slippageTicks * orderMod * sessionMult * spec.tickSize;
}

// ─── Gap 7: Latency Simulation ───────────────────────────────

function applyLatency(signalPrice: number, symbol: string, latencyMs: number, atr?: number): number {
  if (latencyMs <= 0 || !atr || atr <= 0) return signalPrice;
  // Random walk estimate: price drifts by ATR * latency_factor during latency window
  const latencyFactor = (latencyMs / 1000) * 0.1; // 10% of ATR per second of delay
  const drift = (Math.random() * 2 - 1) * atr * latencyFactor;
  return signalPrice + drift;
}

// ─── Gap 6: Fill Probability Model ───────────────────────────

interface FillProbabilityParams {
  orderType: "market" | "limit" | "stop_limit";
  rsi?: number;
  atr?: number;
  symbol: string;
  barVolume?: number;
  medianBarVolume?: number;
}

export function computeFillProbabilityByVolume(
  barVolume?: number,
  medianVolume?: number,
): number {
  if (barVolume == null || medianVolume == null || barVolume <= 0 || medianVolume <= 0) {
    return 1.0;
  }

  const ratio = barVolume / medianVolume;
  if (ratio >= 1.0) return 1.0;
  if (ratio >= 0.5) return 0.85 + (0.15 * (ratio - 0.5)) / 0.5;
  if (ratio >= 0.2) return 0.60 + (0.25 * (ratio - 0.2)) / 0.3;
  return Math.max(0.30, ratio * 3);
}

function computeFillProbability(params: FillProbabilityParams): number {
  let baseProbability = params.orderType === "market" ? 1.0 : 0.75;

  // RSI-based fill probability for limit orders
  // At extreme RSI (oversold/overbought), fill probability is lower
  // because price may reverse before filling
  if (params.orderType !== "market" && params.rsi !== undefined && !isNaN(params.rsi)) {
    if (params.rsi < 20) baseProbability = 0.50;       // extreme oversold — hard to fill long limit
    else if (params.rsi < 30) baseProbability = 0.60;
    else if (params.rsi < 40) baseProbability = 0.70;
    else if (params.rsi > 80) baseProbability = 0.50;   // extreme overbought — hard to fill short limit
    else if (params.rsi > 70) baseProbability = 0.60;
    else baseProbability = 0.85;                         // normal range — likely to fill
  }

  // ATR adjustment: higher volatility = slightly better fills (more price movement)
  if (params.atr && params.atr > 0) {
    const spec = CONTRACT_SPECS[params.symbol];
    if (spec) {
      const atrTicks = params.atr / spec.tickSize;
      if (atrTicks > 40) baseProbability = Math.min(baseProbability + 0.10, 0.95);
    }
  }

  // Stop-limit: multiply by 0.85 (gap risk)
  if (params.orderType === "stop_limit") {
    baseProbability *= 0.85;
  }

  const volumeFactor = computeFillProbabilityByVolume(params.barVolume, params.medianBarVolume);
  const upperBound = params.orderType === "market" ? 1.0 : 0.95;
  return Math.max(0.30, Math.min(upperBound, baseProbability * volumeFactor));
}

export interface PriceBarUpdate {
  close: number;
  high?: number;
  low?: number;
  volume?: number;
}

export type PositionPriceUpdate = number | PriceBarUpdate;

function normalizePriceUpdate(update: PositionPriceUpdate): Required<PriceBarUpdate> {
  if (typeof update === "number") {
    return { close: update, high: update, low: update, volume: 0 };
  }

  const close = update.close;
  return {
    close,
    high: update.high ?? close,
    low: update.low ?? close,
    volume: update.volume ?? 0,
  };
}

// ─── Session Classification ───────────────────────────────────
// getEtOffsetMinutes is imported from src/server/lib/dst-utils.ts (shared utility).
// The previous inline implementation had a DST-end bug: when Nov 1 is a Sunday
// the ternary `novSunday1 === 0 ? 7 : novSunday1` forced the end date to Nov 8
// instead of Nov 1.  The canonical formula `1 + (7 - nov1Day) % 7` needs no guard.

/**
 * Classify trading session from a UTC timestamp.
 * Buckets (ET windows):
 *   ASIA       00:00–03:00 ET
 *   LONDON     03:00–09:30 ET
 *   NY_OPEN    09:30–10:30 ET
 *   NY_CORE    10:30–14:30 ET
 *   NY_CLOSE   14:30–16:00 ET
 *   OVERNIGHT  16:00–00:00 ET
 */
export function classifySessionType(utcDate: Date): string {
  const offsetMin = getEtOffsetMinutes(utcDate);
  const utcMinutes = utcDate.getUTCHours() * 60 + utcDate.getUTCMinutes();
  // Map to ET minutes-since-midnight, keeping result in [0, 1440)
  const etMinutes = ((utcMinutes + offsetMin) % 1440 + 1440) % 1440;

  // P1-7: CME settlement halt 16:00–17:00 ET — block new entries, high slippage on exits
  if (etMinutes >= 960 && etMinutes < 1020) return "CME_HALT"; // 16:00–17:00 ET
  if (etMinutes >= 570 && etMinutes < 630)  return "NY_OPEN";  // 09:30–10:30 ET
  if (etMinutes >= 630 && etMinutes < 870)  return "NY_CORE";  // 10:30–14:30 ET
  if (etMinutes >= 870 && etMinutes < 960)  return "NY_CLOSE"; // 14:30–16:00 ET
  if (etMinutes >= 180 && etMinutes < 570)  return "LONDON";   // 03:00–09:30 ET
  if (etMinutes >= 0   && etMinutes < 180)  return "ASIA";     // 00:00–03:00 ET
  return "OVERNIGHT";                                          // 17:00–00:00 ET
}

// ─── Open Position ───────────────────────────────────────────

export async function openPosition(sessionId: string, params: {
  symbol: string;
  side: "long" | "short";
  signalPrice: number;
  contracts: number;
  orderType?: "market" | "limit" | "stop_limit";
  /** For stop_limit orders: offset in price points from the stop trigger to the limit price.
   *  Defaults to 0.5 * ATR when not provided. Used in fill probability and slippage
   *  but does not change signalPrice — limit price is computed internally. */
  stopLimitOffset?: number;
  /** P1-8: Bar timestamp for session classification. Defaults to wall-clock if absent. */
  barTimestamp?: Date;
  rsi?: number;
  atr?: number;
  barVolume?: number;
  medianBarVolume?: number;
}, context?: { correlationId?: string }) {
  const correlationId = context?.correlationId ?? null;
  // ─── Pipeline pause guard ─────────────────────────────────────
  // Last-line defence: paper-signal-service.ts gates entries upstream, but
  // any other caller (manual open, future automation) still gets blocked
  // here when the pipeline is PAUSED/VACATION. Open positions are NOT closed
  // by this guard — that is handled by stops/targets/exit signals only.
  if (!(await isPipelineActive())) {
    logger.info(
      { fn: "openPosition", sessionId, symbol: params.symbol, side: params.side },
      "Skipped: pipeline paused",
    );
    return {
      position: null,
      executionResult: {
        positionId: "",
        entryPrice: 0,
        contracts: params.contracts,
        slippage: 0,
        expectedPrice: params.signalPrice,
        actualPrice: 0,
        arrivalPrice: params.signalPrice,
        implementationShortfall: 0,
        fillRatio: 0,
        filled: false,
      } satisfies ExecutionResult,
    };
  }

  const openSpan = tracer.startSpan("paper.position_open");
  openSpan.setAttribute("symbol", params.symbol);
  openSpan.setAttribute("side", params.side);
  openSpan.setAttribute("contracts", params.contracts);

  try {
    return await withSessionLock(sessionId, async (dbConn) => {
  // Get session config for latency/fill model settings
  const [session] = await dbConn.select().from(paperSessions).where(eq(paperSessions.id, sessionId));
  if (!session) throw new Error(`Session ${sessionId} not found`);
  if (session.status !== "active") throw new Error(`Cannot open position on ${session.status} session`);
  const sessionConfig = (session.config ?? {}) as Record<string, unknown>;
  const fillModelEnabled = sessionConfig.fillModelEnabled !== false; // default: true
  const latencyMs = (sessionConfig.latencyMs as number) ?? 150;     // default: 150ms

  const arrivalPrice = params.signalPrice; // price when signal was generated

  // firmKey is shared by both the kill switch (D6) and the compliance gate (C5).
  // Derived here so both blocks can reference it without duplication.
  const sessionConfigForCompliance = session.config as Record<string, unknown> | null;
  const firmKey =
    (typeof sessionConfigForCompliance?.firm_key === "string" && sessionConfigForCompliance.firm_key)
    || session.firmId
    || "unknown";

  // ─── D6: Kill switch — runs BEFORE every order, before compliance gate ──
  // Fail-CLOSED: subprocess failure → block order + alert (see cache comment above).
  // Cache TTL is 5s (not 60s like compliance) because P&L state changes every bar.
  //
  // Inputs sourced directly from DB to avoid stale in-memory state after restart:
  //   currentEquity / startingCapital → dailyPnl proxy (no per-day P&L column yet;
  //   dailyPnlBreakdown JSONB is used for consistency rule but not available as a
  //   single scalar — derive from today's breakdown key instead).
  //   consecutiveLosses is computed from the last N trades.
  //
  // NOTE: dailyPnlBreakdown is updated AFTER trade close (checkConsistencyRule).
  // For the kill switch, read today's value from the JSONB column directly.
  {
    const killCacheKey = `session:${sessionId}`;
    let killCached = killSwitchCache.get(killCacheKey);
    if (killCached && Date.now() - killCached.cachedAt > KILL_SWITCH_CACHE_TTL_MS) {
      killSwitchCache.delete(killCacheKey);
      killCached = undefined;
    }

    if (!killCached) {
      try {
        // Read today's daily P&L from dailyPnlBreakdown JSONB
        const { toEasternDateString } = await import("./paper-risk-gate.js");
        const today = toEasternDateString();
        const todayPnl = ((session.dailyPnlBreakdown ?? {}) as Record<string, number>)[today] ?? 0;

        // Read daily loss limit from session config (set when session created)
        const sessionCfg = session.config as Record<string, unknown> | null;
        const dailyLossLimit = Number(sessionCfg?.daily_loss_limit ?? 0);

        // Consecutive losses: count trailing losing trades for this session
        const recentTrades = await dbConn
          .select({ pnl: paperTrades.pnl })
          .from(paperTrades)
          .where(eq(paperTrades.sessionId, sessionId))
          .orderBy(desc(paperTrades.exitTime))
          .limit(10);

        let consecutiveLosses = 0;
        for (const t of recentTrades) {
          if (Number(t.pnl) < 0) consecutiveLosses++;
          else break; // streak broken
        }

        // Max trades per day from session config
        const maxTradesPerSession = sessionCfg?.max_trades_per_day != null
          ? Number(sessionCfg.max_trades_per_day)
          : undefined;

        // Trades taken today — separate COUNT query so sessions with >10 trades are not undercounted.
        // recentTrades (limit 10) is only used for consecutive-loss detection above.
        const todayEtDateStr = toEasternDateString();
        const [tradesTodayRow] = await dbConn
          .select({ count: sql<number>`count(*)::int` })
          .from(paperTrades)
          .where(and(
            eq(paperTrades.sessionId, sessionId),
            sql`to_char(${paperTrades.exitTime} AT TIME ZONE 'America/New_York', 'YYYY-MM-DD') = ${todayEtDateStr}`,
          ));
        const tradesToday = tradesTodayRow?.count ?? 0;

        // FIX 3 (B4 MED): Invoke Python kill switch when EITHER loss limit OR trade cap is set.
        // Previously wrapped in `dailyLossLimit > 0`, which silently bypassed maxTradesPerSession
        // enforcement for sessions configured with only a trade cap (no loss limit).
        if (dailyLossLimit > 0 || (maxTradesPerSession !== undefined && maxTradesPerSession > 0)) {
          const { runPythonModule } = await import("../lib/python-runner.js");
          const killResult = await runPythonModule<{
            tripped: boolean;
            reason: string | null;
            force_close: boolean;
            daily_pnl_pct: number;
          }>({
            module: "src.engine.compliance.compliance_gate",
            config: {
              action: "check_kill_switch",
              sessionId,
              firmKey: firmKey,
              currentDailyPnl: todayPnl,
              dailyLossLimit: dailyLossLimit,
              maxTradesPerSession: maxTradesPerSession ?? null,
              tradesToday,
              consecutiveLosses,
            },
            timeoutMs: 3_000,
            componentName: "kill-switch",
          });

          killCached = { ...killResult, cachedAt: Date.now() };
          killSwitchCache.set(killCacheKey, killCached);

          if (killResult.tripped) {
            logger.error(
              {
                sessionId,
                symbol: params.symbol,
                reason: killResult.reason,
                force_close: killResult.force_close,
                daily_pnl_pct: killResult.daily_pnl_pct,
                firmKey,
              },
              "Kill switch (D6): BLOCKING order",
            );
            AlertFactory.criticalAlert("kill-switch-tripped", {
              sessionId,
              reason: killResult.reason,
              force_close: killResult.force_close,
              daily_pnl_pct: killResult.daily_pnl_pct,
              firm: firmKey,
            });
            const killAuditInsert = db.insert(auditLog).values({
              action: "kill_switch.tripped",
              entityType: "paper_session",
              entityId: sessionId,
              decisionAuthority: "system",
              input: { force_close: killResult.force_close, daily_pnl_pct: killResult.daily_pnl_pct, reason: killResult.reason } as Record<string, unknown>,
              result: { trip_time: new Date().toISOString() } as Record<string, unknown>,
              status: "success",
              correlationId,
            }).returning({ id: auditLog.id });
            killAuditInsert
              .then(async (rows) => {
                // Tier 5.3 wire-up: write 24h strategy lockout so next session
                // is gated by paper-signal-service.ts lockout check.
                if (session.strategyId) {
                  await writeLockoutFromKillEvent({
                    strategyId: session.strategyId,
                    killAuditId: rows[0]?.id ?? null,
                    reason: killResult.reason ?? "daily_loss_kill",
                  });
                }
              })
              .catch((err) => logger.error({ err }, "kill_switch audit/lockout write failed (non-blocking)"));
            broadcastSSE("paper:kill-switch-tripped", {
              sessionId,
              symbol: params.symbol,
              reason: killResult.reason,
              force_close: killResult.force_close,
            });
            openSpan.setAttribute("kill_switch_tripped", true);
            openSpan.setAttribute("kill_switch_reason", killResult.reason ?? "");
            openSpan.end();
            return {
              position: null,
              executionResult: {
                positionId: "",
                entryPrice: 0,
                contracts: params.contracts,
                slippage: 0,
                expectedPrice: arrivalPrice,
                actualPrice: 0,
                arrivalPrice,
                implementationShortfall: 0,
                fillRatio: 0,
                filled: false,
              } satisfies ExecutionResult,
            };
          }
        }
      } catch (killErr) {
        // Kill switch DOWN — fail CLOSED (block order, fire alert).
        // DIFFERENT from compliance gate which fails open.
        // Reason: a missed kill switch = potential account blow-up.
        // A false block = annoying but recoverable. clearKillSwitchCache() resumes.
        logger.error(
          { sessionId, symbol: params.symbol, err: killErr },
          "Kill switch (D6) DOWN — Python subprocess failed; order BLOCKED (fail-closed). Call clearKillSwitchCache() to resume.",
        );
        broadcastSSE("alert:kill_switch_down", {
          sessionId,
          symbol: params.symbol,
          error: killErr instanceof Error ? killErr.message : String(killErr),
        });
        AlertFactory.systemError("kill-switch-down", killErr instanceof Error ? killErr : String(killErr));
        const killDownAuditInsert = db.insert(auditLog).values({
          action: "kill_switch.down",
          entityType: "paper_session",
          entityId: sessionId,
          decisionAuthority: "system",
          input: { symbol: params.symbol, error: killErr instanceof Error ? killErr.message : String(killErr) } as Record<string, unknown>,
          result: { trip_time: new Date().toISOString() } as Record<string, unknown>,
          status: "success",
          correlationId,
        }).returning({ id: auditLog.id });
        killDownAuditInsert
          .then(async (rows) => {
            // Tier 5.3 wire-up: kill switch DOWN is fail-closed; treat as a
            // lockout signal so next session is gated until ops clears the cache.
            if (session.strategyId) {
              await writeLockoutFromKillEvent({
                strategyId: session.strategyId,
                killAuditId: rows[0]?.id ?? null,
                reason: "kill_switch_down",
              });
            }
          })
          .catch((err) => logger.error({ err }, "kill_switch_down audit/lockout write failed (non-blocking)"));
        openSpan.setAttribute("kill_switch_tripped", true);
        openSpan.setAttribute("kill_switch_reason", "subprocess_failure");
        openSpan.end();
        return {
          position: null,
          executionResult: {
            positionId: "",
            entryPrice: 0,
            contracts: params.contracts,
            slippage: 0,
            expectedPrice: arrivalPrice,
            actualPrice: 0,
            arrivalPrice,
            implementationShortfall: 0,
            fillRatio: 0,
            filled: false,
          } satisfies ExecutionResult,
        };
      }
    }
  }

  // ─── B4.4 / C5: Compliance gate — pre-order freshness + violation ──
  // Two-stage check, mirroring the Python compliance_gate:
  //   1. check_freshness — is the firm's ruleset still trustworthy?
  //      (>24h stale for active_trading, OR drift_detected → BLOCK)
  //   2. check_violation — given fresh rules, is the strategy in
  //      hard-violation territory (automation banned on PA, VPS host,
  //      household account cap, …) → BLOCK
  //
  // Latency budget: subprocess adds ~50–150ms.  Cached per firmId for
  // COMPLIANCE_CACHE_TTL_MS so we don't spawn Python on every bar when
  // multiple signals fire in a session.  Cache is opt-out via
  // clearComplianceCache() (used by tests / admin endpoints).
  //
  // Fail-open: if subprocess fails, order proceeds with a SSE alert so
  // the operator knows the guard is DOWN.  Failing closed on a flaky
  // Python subprocess would create more incidents than it prevents.
  // (firmKey and sessionConfigForCompliance are derived above before the kill switch.)

  const complianceCacheKey = `firm:${firmKey}`;
  let cached = complianceCache.get(complianceCacheKey);
  if (cached && Date.now() - cached.cachedAt > COMPLIANCE_CACHE_TTL_MS) {
    complianceCache.delete(complianceCacheKey);
    cached = undefined;
  }

  try {
    if (!cached) {
      // Fetch latest ruleset row for this firm so the Python module can
      // evaluate against actual rule data (not a synthetic stale stub).
      let rulesetPayload: Record<string, unknown> = {};
      if (firmKey && firmKey !== "unknown") {
        const [rs] = await dbConn.select({
          firm: complianceRulesets.firm,
          parsedRules: complianceRulesets.parsedRules,
          retrievedAt: complianceRulesets.retrievedAt,
          driftDetected: complianceRulesets.driftDetected,
          contentHash: complianceRulesets.contentHash,
          status: complianceRulesets.status,
        })
          .from(complianceRulesets)
          .where(eq(complianceRulesets.firm, firmKey))
          .orderBy(desc(complianceRulesets.retrievedAt))
          .limit(1);

        if (rs) {
          rulesetPayload = {
            firm: rs.firm,
            retrieved_at: rs.retrievedAt instanceof Date
              ? rs.retrievedAt.toISOString()
              : new Date(rs.retrievedAt as unknown as string).toISOString(),
            drift_detected: !!rs.driftDetected,
            status: rs.status,
            parsed_rules: rs.parsedRules ?? {},
            content_hash: rs.contentHash ?? null,
          };
        }
      }

      const { runPythonModule } = await import("../lib/python-runner.js");

      // Stage 1: freshness
      const freshnessResult = await runPythonModule<{
        fresh: boolean;
        status: string;
        message: string;
        drift_detected?: boolean;
      }>({
        module: "src.engine.compliance.compliance_gate",
        config: {
          action: "check_freshness",
          firm: firmKey,
          ruleset: rulesetPayload,
          context: "active_trading",
        },
        timeoutMs: 3_000,
        componentName: "compliance-gate-paper-freshness",
      });

      let violationResult: {
        violation: boolean;
        status: string;
        message: string;
        violations: string[];
      } = {
        violation: false,
        status: "skipped_stale",
        message: "skipped — freshness failed",
        violations: [],
      };

      // Stage 2: only run violation check if rules are fresh AND we have data
      if (freshnessResult.fresh && Object.keys(rulesetPayload).length > 0) {
        const strategyState = {
          automated: true, // paper executor is autonomous
          account_phase: (sessionConfigForCompliance?.account_phase as string) ?? "pa",
          host: (sessionConfigForCompliance?.host as string) ?? process.env.TF_HOST_TAG ?? "local",
          pa_account_count: (sessionConfigForCompliance?.pa_account_count as number) ?? 1,
        };

        violationResult = await runPythonModule<{
          violation: boolean;
          status: string;
          message: string;
          violations: string[];
        }>({
          module: "src.engine.compliance.compliance_gate",
          config: {
            action: "check_violation",
            firm: firmKey,
            ruleset: rulesetPayload,
            strategy_state: strategyState,
          },
          timeoutMs: 3_000,
          componentName: "compliance-gate-paper-violation",
        });
      }

      cached = {
        fresh: freshnessResult.fresh,
        freshnessStatus: freshnessResult.status,
        freshnessMessage: freshnessResult.message,
        driftDetected: !!freshnessResult.drift_detected,
        violation: violationResult.violation,
        violationStatus: violationResult.status,
        violationMessage: violationResult.message,
        violations: violationResult.violations ?? [],
        cachedAt: Date.now(),
      };
      complianceCache.set(complianceCacheKey, cached);
    }

    // Block on freshness OR violation
    if (!cached.fresh) {
      logger.error(
        { sessionId, symbol: params.symbol, status: cached.freshnessStatus, message: cached.freshnessMessage },
        "Compliance gate (B4.4): BLOCKING order — ruleset not fresh or drift detected",
      );
      broadcastSSE("alert:compliance_gate_blocked", {
        sessionId,
        symbol: params.symbol,
        firm: firmKey,
        stage: "freshness",
        status: cached.freshnessStatus,
        message: cached.freshnessMessage,
      });
      db.insert(auditLog).values({
        action: "compliance.gate_blocked",
        entityType: "paper_session",
        entityId: sessionId,
        decisionAuthority: "system",
        input: { firm: firmKey, reason: cached.freshnessMessage, symbol: params.symbol } as Record<string, unknown>,
        result: { blocked_at: new Date().toISOString() } as Record<string, unknown>,
        status: "blocked",
        correlationId,
      }).catch((err) => logger.error({ err }, "compliance_gate_blocked audit insert failed (non-blocking)"));
      openSpan.setAttribute("compliance_blocked", true);
      openSpan.setAttribute("compliance_stage", "freshness");
      openSpan.setAttribute("compliance_status", cached.freshnessStatus);
      openSpan.end();
      return {
        position: null,
        executionResult: {
          positionId: "",
          entryPrice: 0,
          contracts: params.contracts,
          slippage: 0,
          expectedPrice: arrivalPrice,
          actualPrice: 0,
          arrivalPrice,
          implementationShortfall: 0,
          fillRatio: 0,
          filled: false,
        } satisfies ExecutionResult,
      };
    }

    if (cached.violation) {
      logger.error(
        { sessionId, symbol: params.symbol, status: cached.violationStatus, violations: cached.violations },
        "Compliance gate (C5): BLOCKING order — hard violation detected",
      );
      broadcastSSE("alert:compliance_gate_blocked", {
        sessionId,
        symbol: params.symbol,
        firm: firmKey,
        stage: "violation",
        status: cached.violationStatus,
        message: cached.violationMessage,
        violations: cached.violations,
      });
      db.insert(auditLog).values({
        action: "compliance.gate_blocked",
        entityType: "paper_session",
        entityId: sessionId,
        decisionAuthority: "system",
        input: { firm: firmKey, reason: cached.violationMessage, symbol: params.symbol } as Record<string, unknown>,
        result: { blocked_at: new Date().toISOString() } as Record<string, unknown>,
        status: "blocked",
        correlationId,
      }).catch((err) => logger.error({ err }, "compliance_gate_blocked audit insert failed (non-blocking)"));
      openSpan.setAttribute("compliance_blocked", true);
      openSpan.setAttribute("compliance_stage", "violation");
      openSpan.setAttribute("compliance_status", cached.violationStatus);
      openSpan.end();
      return {
        position: null,
        executionResult: {
          positionId: "",
          entryPrice: 0,
          contracts: params.contracts,
          slippage: 0,
          expectedPrice: arrivalPrice,
          actualPrice: 0,
          arrivalPrice,
          implementationShortfall: 0,
          fillRatio: 0,
          filled: false,
        } satisfies ExecutionResult,
      };
    }
  } catch (complianceErr) {
    // Compliance guard DOWN — log at error so operator sees it; proceed fail-open.
    logger.error(
      { sessionId, symbol: params.symbol, firm: firmKey, err: complianceErr },
      "Compliance gate (B4.4 / C5) DOWN — Python compliance_gate failed; order proceeds unblocked",
    );
    broadcastSSE("alert:compliance_guard_down", {
      sessionId,
      symbol: params.symbol,
      firm: firmKey,
      error: complianceErr instanceof Error ? complianceErr.message : String(complianceErr),
    });
  }

  // Gap 6: Fill probability check
  // capturedFillProbability is persisted on the position row so closePosition() can copy it to the trade journal.
  // Market orders bypass the model entirely and are recorded as 1.0.
  const orderType = params.orderType ?? "market";
  let capturedFillProbability: number | null = fillModelEnabled ? null : 1.0;
  const fillSpan = tracer.startSpan("paper.fill_check");
  if (fillModelEnabled) {
    const fillProb = computeFillProbability({
      orderType,
      rsi: params.rsi,
      atr: params.atr,
      symbol: params.symbol,
      barVolume: params.barVolume,
      medianBarVolume: params.medianBarVolume,
    });
    capturedFillProbability = fillProb;
    if (Math.random() > fillProb) {
      logger.info({ sessionId, symbol: params.symbol, fillProb, orderType }, "Fill probability miss — order not filled");
      broadcastSSE("paper:fill-miss", { sessionId, symbol: params.symbol, fillProb, orderType });
      fillSpan.setAttribute("filled", false);
      fillSpan.end();
      return {
        position: null,
        executionResult: {
          positionId: "",
          entryPrice: 0,
          contracts: params.contracts,
          slippage: 0,
          expectedPrice: arrivalPrice,
          actualPrice: 0,
          arrivalPrice,
          implementationShortfall: 0,
          fillRatio: 0,
          filled: false,
        } satisfies ExecutionResult,
      };
    }
  }
  fillSpan.setAttribute("filled", true);
  fillSpan.end();

  // Gap 7: Apply latency to price
  const priceAfterLatency = applyLatency(params.signalPrice, params.symbol, latencyMs, params.atr);

  // Apply variable slippage (ATR-scaled, session-aware, order-type-aware)
  // Use median ATR estimate: assume current ATR is near median unless extreme
  // This gives ~1x slippage normally, 1.5-2x during high vol, 0.5-0.7x during low vol
  const medianAtrEstimate = params.atr ? params.atr * 0.85 : undefined; // Slight underestimate to bias conservatively
  // P1-8: Use bar timestamp for session classification (not wall-clock new Date()).
  // Bar timestamp is passed via params; fall back to wall-clock only as last resort.
  // Fix 2: derive session at order time so calculateSlippage applies the correct
  // session multiplier (OVERNIGHT=2x, LONDON=1.5x, RTH=1x, CME_HALT=100x).
  // classifySessionType returns "ASIA"; calculateSlippage expects "ASIAN" — map it.
  const orderTimestamp = params.barTimestamp ?? new Date();
  const sessionAtOrder = classifySessionType(orderTimestamp);

  // P1-7: Reject new entries during CME settlement halt (16:00–17:00 ET)
  if (sessionAtOrder === "CME_HALT") {
    logger.info(
      { sessionId, symbol: params.symbol, sessionAtOrder },
      "P1-7: Entry rejected during CME settlement halt (16:00–17:00 ET)",
    );
    db.insert(auditLog).values({
      action: "paper.entry_rejected_cme_halt",
      entityType: "paper_session",
      entityId: sessionId,
      decisionAuthority: "system",
      input: { symbol: params.symbol, reason: "settlement_halt", sessionAtOrder } as Record<string, unknown>,
      result: { blocked_at: new Date().toISOString() } as Record<string, unknown>,
      status: "blocked",
      correlationId,
    }).catch((err) => logger.error({ err }, "CME halt audit insert failed (non-blocking)"));
    openSpan.setAttribute("cme_halt_blocked", true);
    openSpan.end();
    return {
      position: null,
      executionResult: {
        positionId: "",
        entryPrice: 0,
        contracts: params.contracts,
        slippage: 0,
        expectedPrice: arrivalPrice,
        actualPrice: 0,
        arrivalPrice,
        implementationShortfall: 0,
        fillRatio: 0,
        filled: false,
      } satisfies ExecutionResult,
    };
  }

  const slippageSession = sessionAtOrder === "ASIA" ? "ASIAN" : sessionAtOrder;
  const slippage = calculateSlippage(params.symbol, 1, params.atr, medianAtrEstimate, orderType, slippageSession);
  const actualEntry = params.side === "long"
    ? priceAfterLatency + slippage
    : priceAfterLatency - slippage;

  // Gap 8: TCA — implementation shortfall
  const spec = CONTRACT_SPECS[params.symbol];
  if (!spec) {
    throw new Error(`Unknown symbol "${params.symbol}" — no CONTRACT_SPECS entry. Cannot open position.`);
  }
  const implementationShortfall = Math.abs(actualEntry - arrivalPrice) * spec.pointValue * params.contracts;

  const [position] = await dbConn.insert(paperPositions).values({
    sessionId,
    symbol: params.symbol,
    side: params.side,
    entryPrice: String(actualEntry),
    currentPrice: String(actualEntry),
    contracts: params.contracts,
    unrealizedPnl: "0",
    arrivalPrice: String(arrivalPrice),
    implementationShortfall: String(implementationShortfall),
    fillRatio: "1.0",
    fillProbability: capturedFillProbability !== null ? String(capturedFillProbability) : null,
  }).returning();

  const executionResult: ExecutionResult = {
    positionId: position.id,
    entryPrice: actualEntry,
    contracts: params.contracts,
    slippage,
    expectedPrice: params.signalPrice,
    actualPrice: actualEntry,
    arrivalPrice,
    implementationShortfall,
    fillRatio: 1.0,
    filled: true,
  };

  broadcastSSE("paper:position-opened", {
    sessionId,
    position,
    executionQuality: executionResult,
  });

  logger.info({ sessionId, executionResult }, "Paper position opened");

  // Auto-shadow: write shadow signal entry for every position open
  try {
    await dbConn.insert(shadowSignals).values({
      sessionId,
      signalTime: new Date(),
      direction: params.side,
      expectedEntry: String(arrivalPrice),
      actualMarketPrice: String(params.signalPrice),
      wouldHaveFilled: true,
      modelSlippage: String(slippage),
    });
  } catch (shadowErr) {
    logger.warn({ sessionId, err: shadowErr }, "Shadow signal write failed (non-blocking)");
  }

  // Audit trail — paper trade open
  try {
    await dbConn.insert(auditLog).values({
      action: "paper.trade_open",
      entityType: "paper_position",
      entityId: position.id,
      input: {
        sessionId,
        symbol: params.symbol,
        direction: params.side,
        contracts: params.contracts,
        entryPrice: params.signalPrice,
      },
      result: {
        fillPrice: actualEntry,
        slippage,
        implementationShortfall,
      },
      status: "success",
      decisionAuthority: "agent",
      correlationId,
    });
  } catch (auditErr) {
    logger.warn({ sessionId, positionId: position.id, err: auditErr }, "Audit log write failed for paper.trade_open (non-blocking)");
  }

  return { position, executionResult };
    }); // end withSessionLock
  } finally {
    openSpan.end();
  }
}

// ─── Close Position ──────────────────────────────────────────

/**
 * Close an open paper position.
 *
 * @param positionId       UUID of the open position record.
 * @param exitSignalPrice  Signal/reference price at close time.
 * @param atr              Current ATR from the bar context.  When provided, exit
 *                         slippage is ATR-scaled (matching entry slippage model).
 *                         Omit for manual/force-close — falls back to base-tick
 *                         slippage (prior behaviour).
 */
export async function closePosition(positionId: string, exitSignalPrice: number, atr?: number, context?: { correlationId?: string; barTimestamp?: Date }) {
  const correlationId = context?.correlationId ?? null;
  const closeSpan = tracer.startSpan("paper.position_close");
  try {
  // Read position outside the lock to get the sessionId for the lock key
  const [posForLock] = await db.select({ sessionId: paperPositions.sessionId })
    .from(paperPositions).where(eq(paperPositions.id, positionId));
  if (!posForLock) throw new Error(`Position ${positionId} not found`);

  return await withSessionLock(posForLock.sessionId, async (dbConn) => {
  // Re-read position inside lock to get fresh state
  const [pos] = await dbConn.select().from(paperPositions).where(eq(paperPositions.id, positionId));
  if (!pos) throw new Error(`Position ${positionId} not found`);

  // Fetch session early to get firmId for commission lookup
  // (session is re-read after the equity update below for downstream logic)
  const [sessionForFirm] = await dbConn.select({ firmId: paperSessions.firmId })
    .from(paperSessions).where(eq(paperSessions.id, pos.sessionId));

  // 2.6: ATR-scaled exit slippage — mirrors entry slippage model so paper P&L is
  // not systematically overstated by using base-tick slippage on exits.
  // medianAtrEstimate mirrors the entry convention: current ATR × 0.85.
  // Falls back to base-tick slippage when ATR is unavailable (prior behaviour).
  // Fix 2.6b: pass session multiplier at exit to match the entry path (Fix 2).
  // Without this, exits always used sessionMult=1.0, understating slippage during
  // OVERNIGHT (2x) and LONDON (1.5x) sessions — symmetric parity gap vs backtest.
  // P1-8: Use bar timestamp for session classification (not wall-clock new Date()).
  // P1-10: Use stop_limit as default exit order type to match CLAUDE.md prohibition on stop-market.
  const closeTimestamp = context?.barTimestamp ?? new Date();
  const sessionAtClose = classifySessionType(closeTimestamp);
  const exitSlippageSession = sessionAtClose === "ASIA" ? "ASIAN"
    : sessionAtClose === "CME_HALT" ? "CME_HALT"
    : sessionAtClose;
  const medianAtrEstimate = atr ? atr * 0.85 : undefined;
  const slippage = calculateSlippage(pos.symbol, 1, atr, medianAtrEstimate, "stop_limit", exitSlippageSession);
  closeSpan.setAttribute("exitSlippage", slippage);
  closeSpan.setAttribute("atrProvided", atr !== undefined);
  const actualExit = pos.side === "long"
    ? exitSignalPrice - slippage
    : exitSignalPrice + slippage;

  const spec = CONTRACT_SPECS[pos.symbol];
  if (!spec) throw new Error(`Unknown contract symbol: ${pos.symbol} — not in CONTRACT_SPECS`);
  const entryPrice = Number(pos.entryPrice);
  const direction = pos.side === "long" ? 1 : -1;
  const grossPnl = direction * (actualExit - entryPrice) * spec.pointValue * pos.contracts;

  // Commission: round-trip (entry + exit sides) × contracts
  // Per-side rate comes from the firm's commissionPerSide in firm-config.ts.
  // Falls back to $0.62/side when firmId is null/unknown (conservative — avoids overstating net P&L).
  const commissionPerSide = getCommissionPerSide(sessionForFirm?.firmId);
  const commission = commissionPerSide * 2 * pos.contracts;

  // closedAt is declared here (before roll cost and enrichment) so it serves as the
  // authoritative close timestamp for both the roll window check and the DB writes.
  const closedAt = new Date();

  // Roll spread cost — if the position held across one or more CME contract
  // roll dates, deduct the estimated calendar spread cost (front→back-month
  // bid/ask spread). Backtest uses ratio-adjusted continuous contracts so it
  // never sees this discontinuity; this deduction closes that parity gap.
  // computeRollSpreadCost is a pure in-process function (no subprocess) using
  // the TypeScript mirror of roll_calendar.py in roll-calendar-data.ts.
  const entryTimeForRoll = pos.entryTime instanceof Date ? pos.entryTime : new Date(pos.entryTime);
  const rollCost = computeRollSpreadCost(pos.symbol, pos.contracts, entryTimeForRoll, closedAt);
  const netPnl = grossPnl - commission - rollCost.estimatedSpreadCost;

  closeSpan.setAttribute("grossPnl", grossPnl);
  closeSpan.setAttribute("commission", commission);
  closeSpan.setAttribute("rollSpreadCost", rollCost.estimatedSpreadCost);
  closeSpan.setAttribute("netPnl", netPnl);
  closeSpan.setAttribute("firmId", sessionForFirm?.firmId ?? "unknown");

  // Wrap the 3 writes (trade insert, position close, session equity update) in a single
  // transaction so a crash or connection loss mid-close cannot leave partial state:
  //   - trade row missing but position still open
  //   - position closed but session equity not updated
  // totalTrades is incremented here as well (H3) so it stays in sync with the trade row.
  // SSE broadcast and metrics/drift detection run OUTSIDE the transaction — they are
  // non-critical and must not block or roll back the core writes.

  // ─── Phase 1.1: Journal Enrichment ──────────────────────────────────────────
  // All enrichment is gathered BEFORE the transaction.
  // Each field is independently try/caught — any failure produces null, never blocks the close.

  // Pure computation — cannot fail
  const entryDate = pos.entryTime instanceof Date ? pos.entryTime : new Date(pos.entryTime);
  const holdDurationMs = closedAt.getTime() - entryDate.getTime();
  const hourOfDay = entryDate.getUTCHours();
  const dayOfWeek = entryDate.getUTCDay(); // 0=Sun JS standard
  const sessionType = classifySessionType(entryDate);

  // macroRegime — query latest snapshot (non-blocking)
  let macroRegime: string | null = null;
  try {
    const [snap] = await dbConn.select({ macroRegime: macroSnapshots.macroRegime })
      .from(macroSnapshots)
      .orderBy(desc(macroSnapshots.snapshotDate))
      .limit(1);
    macroRegime = snap?.macroRegime ?? null;
  } catch (err) {
    logger.warn({ positionId, err }, "Journal enrichment: macroRegime query failed (non-blocking)");
  }

  // eventActive — Python calendar_filter (cached per ET hour; non-blocking)
  // Fix 3: use getCachedCalendarStatus to avoid spawning a subprocess on every close.
  let eventActive: boolean | null = null;
  try {
    const calResult = await getCachedCalendarStatus(entryDate);
    eventActive = calResult !== null ? calResult.is_economic_event === true : null;
  } catch (err) {
    logger.warn({ positionId, err }, "Journal enrichment: eventActive calendar_filter call failed (non-blocking)");
  }

  // skipSignal — most recent skipDecisions row for today's ET trading date (non-blocking)
  let skipSignal: string | null = null;
  try {
    const today = toEasternDateString();
    const [skipRow] = await dbConn.select({ decision: skipDecisions.decision })
      .from(skipDecisions)
      .where(sql`DATE(${skipDecisions.decisionDate} AT TIME ZONE 'America/New_York') = ${today}::date`)
      .orderBy(desc(skipDecisions.decisionDate))
      .limit(1);
    skipSignal = skipRow?.decision ?? null;
  } catch (err) {
    logger.warn({ positionId, err }, "Journal enrichment: skipSignal query failed (non-blocking)");
  }

  // fillProbability — read from position row (written at open time)
  const fillProbabilityStr = pos.fillProbability ?? null;

  const [trade] = await dbConn.transaction(async (tx) => {
    // 1. Insert closed trade — pnl column holds NET P&L; grossPnl and commission stored for audit/analytics
    const [tradeRow] = await tx.insert(paperTrades).values({
      sessionId: pos.sessionId,
      symbol: pos.symbol,
      side: pos.side,
      entryPrice: pos.entryPrice,
      exitPrice: String(actualExit),
      pnl: String(netPnl),
      grossPnl: String(grossPnl),
      commission: String(commission),
      contracts: pos.contracts,
      entryTime: pos.entryTime,
      exitTime: closedAt,
      slippage: String(slippage),
      // Phase 1.1 enrichment columns
      mae: pos.mae,           // Accumulated per-bar watermark from paper_positions row
      mfe: pos.mfe,           // Accumulated per-bar watermark from paper_positions row
      holdDurationMs,
      hourOfDay,
      dayOfWeek,
      sessionType,
      macroRegime,
      eventActive,
      skipSignal,
      fillProbability: fillProbabilityStr,
      // Roll spread cost: non-null when cost > 0 (roll crossed), null when no roll crossed.
      // Persisted even when cost is 0 (distinguishes "evaluated, no roll" from "pre-migration null").
      rollSpreadCost: String(rollCost.estimatedSpreadCost),
    }).returning();

    // 2. Mark position as closed — unrealizedPnl resets to 0 (realized P&L lives in paperTrades)
    await tx.update(paperPositions).set({
      closedAt,
      currentPrice: String(actualExit),
      unrealizedPnl: "0",
    }).where(eq(paperPositions.id, positionId));

    // 3. Update session equity atomically using NET P&L — prevents read-modify-write race on
    //    concurrent closes.  Also update peak equity (high-water mark) for trailing drawdown.
    //    totalTrades is incremented here so it always matches the number of trade rows.
    await tx.update(paperSessions).set({
      currentEquity: sql`${paperSessions.currentEquity}::numeric + ${netPnl}`,
      peakEquity: sql`GREATEST(${paperSessions.peakEquity}::numeric, ${paperSessions.currentEquity}::numeric + ${netPnl})`,
      totalTrades: sql`COALESCE(${paperSessions.totalTrades}, 0) + 1`,
    }).where(eq(paperSessions.id, pos.sessionId));

    return [tradeRow];
  });

  // Audit trail — paper trade close (written immediately after the transaction commits)
  try {
    await dbConn.insert(auditLog).values({
      action: "paper.trade_close",
      entityType: "paper_trade",
      entityId: trade.id,
      input: { positionId },
      result: {
        exitPrice: actualExit,
        netPnl,
        grossPnl,
        commission,
        rollSpreadCost: rollCost.estimatedSpreadCost,
        rollDates: rollCost.rollDates,
      },
      status: "success",
      decisionAuthority: "agent",
      correlationId,
    });
  } catch (auditErr) {
    logger.warn({ positionId, tradeId: trade.id, err: auditErr }, "Audit log write failed for paper.trade_close (non-blocking)");
  }

  // Re-read session after atomic update for downstream logic
  const [session] = await dbConn.select().from(paperSessions).where(eq(paperSessions.id, pos.sessionId));
  if (session) {
    // Gap 4: Consistency rule check + daily P&L tracking (net P&L — matches what the firm sees)
    // Wrapped individually so one failure doesn't block the other or the SSE broadcast.
    try {
      await checkConsistencyRule(session, netPnl);
    } catch (consistencyErr) {
      logger.error({ positionId, sessionId: pos.sessionId, err: consistencyErr }, "checkConsistencyRule failed (non-blocking)");
    }

    // Gap 5: Rolling Sharpe + decay detection (net P&L — promotion inputs must be net)
    try {
      await updateRollingMetrics(pos.sessionId, session.strategyId);
    } catch (metricsErr) {
      logger.error({ positionId, sessionId: pos.sessionId, err: metricsErr }, "updateRollingMetrics failed (non-blocking)");
    }
  }

  // SSE broadcast always fires if the transaction succeeded — not gated on post-close checks
  broadcastSSE("paper:trade", {
    trade,
    pnl: netPnl,
    grossPnl,
    commission,
    rollSpreadCost: rollCost.estimatedSpreadCost,
  });
  logger.info(
    { positionId, grossPnl, commission, rollSpreadCost: rollCost.estimatedSpreadCost, netPnl, slippage, firmId: sessionForFirm?.firmId },
    "Paper position closed",
  );

  // Roll spread cost journal entry — only emitted when a roll was actually crossed
  // so log volume is not inflated for the common case of no roll in the hold window.
  if (rollCost.estimatedSpreadCost > 0) {
    logger.info(
      {
        symbol: pos.symbol,
        contracts: pos.contracts,
        rollDates: rollCost.rollDates,
        costUsd: rollCost.estimatedSpreadCost,
        positionId,
        tradeId: trade.id,
      },
      "Roll spread cost applied to paper trade close",
    );
    broadcastSSE("paper:roll-spread-applied", {
      positionId,
      tradeId: trade.id,
      symbol: pos.symbol,
      contracts: pos.contracts,
      rollDates: rollCost.rollDates,
      costUsd: rollCost.estimatedSpreadCost,
    });
  }

  // Fix 3 (cache invalidation): the daily P&L for this session changed — evict the
  // global-daily-loss aggregate cache so the next entry signal reads a fresh DB value.
  // Synchronous (no await) — cache is in-process; failure is impossible.
  invalidateDailyLossCache(pos.sessionId);

  // C1: Update governor state after every close so NORMAL/CAUTION/HALT tracks real session P&L.
  // Runs outside the transaction — a governor failure must never roll back or block the close.
  // dailyLossBudget comes from the session's config.daily_loss_budget; falls back to $500.
  try {
    const { updateGovernorOnTrade } = await import("./paper-signal-service.js");
    const dailyBudget = (session as any)?.config?.daily_loss_budget ?? 500;
    updateGovernorOnTrade(pos.sessionId, netPnl, dailyBudget);
  } catch (govErr) {
    logger.warn({ err: govErr, sessionId: pos.sessionId }, "updateGovernorOnTrade failed (non-blocking)");
  }

  // Phase 1.4: Record trade into rolling metrics window and broadcast live metrics.
  // Runs after the SSE broadcast so a metrics failure never delays the trade event.
  // Dynamic import keeps the module boundary clean (avoids circular dep at load time).
  try {
    const { metricsAggregator } = await import("./metrics-aggregator.js");
    const metrics = metricsAggregator.recordTrade(pos.sessionId, { pnl: netPnl, closedAt });
    broadcastSSE("metrics:trade-close", {
      ...metrics,          // includes sessionId from computeMetrics
      strategyId: session?.strategyId ?? null,
      tradeId: trade.id,
    });
  } catch (metricsRecordErr) {
    logger.warn({ err: metricsRecordErr, sessionId: pos.sessionId }, "MetricsAggregator.recordTrade failed (non-blocking)");
  }

  // Prometheus counter — incremented after transaction commits so partial writes don't count.
  paperTradesCounter.labels({
    symbol: pos.symbol,
    side: pos.side,
    outcome: netPnl >= 0 ? "win" : "loss",
  }).inc();

  // Fix 4.6: Drift detection is independently try/caught and awaited.
  // A failure here must not suppress the trade close event or leave the
  // caller hanging if onPaperTradeClose throws synchronously.
  if (session?.strategyId) {
    try {
      await onPaperTradeClose(pos.sessionId, session.strategyId);
    } catch (err) {
      logger.error({ sessionId: pos.sessionId, err }, "onPaperTradeClose drift check failed (non-blocking)");
    }
  }

  return { trade, pnl: netPnl, grossPnl, commission, slippage, rollSpreadCost: rollCost.estimatedSpreadCost };
  }); // end withSessionLock
  } finally {
    closeSpan.end();
  }
}

// ─── Gap 4: Consistency Rule Enforcement ─────────────────────

async function checkConsistencyRule(
  session: typeof paperSessions.$inferSelect,
  tradePnl: number,
): Promise<void> {
  if (!session.firmId) return;
  const firmConfig = getFirmAccount(session.firmId);
  if (!firmConfig?.consistencyRule) return;

  // Update daily P&L breakdown atomically — increment today's value in SQL
  // Use Eastern Time date (futures trading day is ET-based)
  const today = toEasternDateString();

  const jsonPath = `{${today}}`;
  await db.update(paperSessions).set({
    dailyPnlBreakdown: sql`jsonb_set(
      COALESCE(${paperSessions.dailyPnlBreakdown}, '{}'::jsonb),
      ${jsonPath}::text[],
      (COALESCE((${paperSessions.dailyPnlBreakdown}->>${today})::numeric, 0) + ${tradePnl})::text::jsonb
    )`,
  }).where(eq(paperSessions.id, session.id));

  // Re-read breakdown for consistency check (reflects atomic update)
  const [updated] = await db.select({ dailyPnlBreakdown: paperSessions.dailyPnlBreakdown })
    .from(paperSessions).where(eq(paperSessions.id, session.id));
  const breakdown = (updated?.dailyPnlBreakdown ?? {}) as Record<string, number>;

  // Check consistency: no single day > X% of total profit
  const breakdownValues = Object.values(breakdown);
  if (breakdownValues.length === 0) return; // no data yet
  const totalPnl = breakdownValues.reduce((sum, v) => sum + v, 0);
  if (totalPnl <= 0) return; // only applies when profitable

  const maxDayPnl = Math.max(...breakdownValues);
  const maxDayRatio = maxDayPnl / totalPnl;

  if (maxDayRatio > firmConfig.consistencyRule) {
    const maxDay = Object.entries(breakdown).find(([, v]) => v === maxDayPnl)?.[0] ?? "unknown";
    const pctStr = (maxDayRatio * 100).toFixed(1);
    const limitPct = (firmConfig.consistencyRule * 100).toFixed(0);
    const warning = `Consistency rule: ${pctStr}% from single day (${maxDay}) exceeds ${limitPct}% limit for ${session.firmId}`;
    logger.warn({ sessionId: session.id, maxDayRatio, limit: firmConfig.consistencyRule }, warning);
    broadcastSSE("paper:consistency-warning", {
      sessionId: session.id,
      firmId: session.firmId,
      maxDayRatio,
      limit: firmConfig.consistencyRule,
      maxDay,
      message: warning,
    });
  }
}

// ─── Gap 5: Rolling Sharpe + Decay Detection ─────────────────

async function updateRollingMetrics(sessionId: string, strategyId: string | null): Promise<void> {
  // FIX 5 (B3): Bucket trades by UTC date, compute Sharpe on daily P&L sums.
  // Matches the scheduler.ts rolling Sharpe job (scheduler.ts:~L1651) which uses
  // the same daily-bucketing approach.  Per-trade Sharpe (old code) annualised at
  // sqrt(252) produced materially different values from the daily basis used by the
  // promotion gate — apples-to-oranges comparison on the DEPLOY_READY gate.
  const recentTrades = await db.select({ pnl: paperTrades.pnl, exitTime: paperTrades.exitTime })
    .from(paperTrades)
    .where(eq(paperTrades.sessionId, sessionId))
    .orderBy(desc(paperTrades.exitTime))
    .limit(90); // fetch up to 90 trades (~30 trading days of data for daily bucketing)

  if (recentTrades.length < 5) return; // need minimum trades for meaningful Sharpe

  // Group into daily P&L buckets using UTC date (matches scheduler.ts convention)
  const dailyPnlMap = new Map<string, number>();
  for (const t of recentTrades) {
    const day = (t.exitTime instanceof Date ? t.exitTime : new Date(t.exitTime)).toISOString().slice(0, 10);
    dailyPnlMap.set(day, (dailyPnlMap.get(day) ?? 0) + Number(t.pnl ?? 0));
  }
  const dailyReturns = [...dailyPnlMap.values()];

  if (dailyReturns.length < 3) return; // need at least 3 trading days

  const mean = dailyReturns.reduce((s, v) => s + v, 0) / dailyReturns.length;
  const variance = dailyReturns.length > 1
    ? dailyReturns.reduce((s, v) => s + (v - mean) ** 2, 0) / (dailyReturns.length - 1)
    : 0;
  const stdDev = Math.sqrt(variance);
  // Annualise from daily P&L — matches scheduler.ts exactly: mean/std * sqrt(252)
  const rollingSharpe = stdDev > 0 ? (mean / stdDev) * Math.sqrt(252) : 0;

  // Store metrics snapshot
  const metricsSnapshot = {
    rollingSharpe: Math.round(rollingSharpe * 100) / 100,
    tradeCount: recentTrades.length,
    tradingDays: dailyReturns.length,
    avgPnl: Math.round(mean * 100) / 100,
    stdPnl: Math.round(stdDev * 100) / 100,
    basis: "per_day",   // FIX 5: basis label so frontend can display correctly
    updatedAt: new Date().toISOString(),
  };

  await db.update(paperSessions).set({
    metricsSnapshot,
  }).where(eq(paperSessions.id, sessionId));

  // Compare to backtest Sharpe if we have a linked strategy
  if (strategyId) {
    const [strategy] = await db.select({ rollingSharpe30d: strategies.rollingSharpe30d })
      .from(strategies).where(eq(strategies.id, strategyId));

    if (strategy?.rollingSharpe30d) {
      const backtestSharpe = Number(strategy.rollingSharpe30d);
      const deviation = Math.abs(rollingSharpe - backtestSharpe);
      // Rough std dev of Sharpe estimates ~ 0.5 for small samples
      const sharpeStdErr = 0.5;

      if (deviation > 2 * sharpeStdErr) {
        broadcastSSE("paper:decay-alert", {
          sessionId,
          level: "alert",
          rollingSharpe,
          backtestSharpe,
          deviation: Math.round(deviation * 100) / 100,
          message: `ALERT: Rolling Sharpe (${rollingSharpe.toFixed(2)}) deviates >2σ from backtest (${backtestSharpe.toFixed(2)})`,
        });
        logger.warn({ sessionId, rollingSharpe, backtestSharpe }, "Decay ALERT: >2σ deviation");
      } else if (deviation > 1 * sharpeStdErr) {
        broadcastSSE("paper:decay-warning", {
          sessionId,
          level: "warning",
          rollingSharpe,
          backtestSharpe,
          deviation: Math.round(deviation * 100) / 100,
          message: `Warning: Rolling Sharpe (${rollingSharpe.toFixed(2)}) deviates >1σ from backtest (${backtestSharpe.toFixed(2)})`,
        });
      }
    }
  }
}

// ─── Update Position Prices ──────────────────────────────────

export async function updatePositionPrices(
  sessionId: string,
  prices: Record<string, PositionPriceUpdate>,
) {
  const openPositions = await db.select().from(paperPositions)
    .where(and(eq(paperPositions.sessionId, sessionId), isNull(paperPositions.closedAt)));

  let totalUnrealizedPnl = 0;
  let totalUnrealizedDelta = 0; // FIX 2 (B1): sum of (newUnrealized - prevUnrealized) across all positions
  let positionsUpdated = 0;

  for (const pos of openPositions) {
    const rawUpdate = prices[pos.symbol];
    if (rawUpdate === undefined) continue;
    const { close: currentPrice, high, low } = normalizePriceUpdate(rawUpdate);

    const spec = CONTRACT_SPECS[pos.symbol];
    if (!spec) {
      logger.warn({ symbol: pos.symbol, positionId: pos.id }, "Missing CONTRACT_SPECS — skipping unrealized P&L update");
      continue;
    }
    const entryPrice = Number(pos.entryPrice);
    const direction = pos.side === "long" ? 1 : -1;
    const unrealizedPnl = direction * (currentPrice - entryPrice) * spec.pointValue * pos.contracts;
    const adversePrice = pos.side === "long" ? low : high;
    const favorablePrice = pos.side === "long" ? high : low;
    const adverseUnrealizedPnl = direction * (adversePrice - entryPrice) * spec.pointValue * pos.contracts;
    const favorableUnrealizedPnl = direction * (favorablePrice - entryPrice) * spec.pointValue * pos.contracts;
    const currentMae = pos.mae != null ? Number(pos.mae) : 0;
    const currentMfe = pos.mfe != null ? Number(pos.mfe) : 0;
    const nextMae = Math.min(currentMae, adverseUnrealizedPnl);
    const nextMfe = Math.max(currentMfe, favorableUnrealizedPnl);

    // FIX 2 (B1 MED-HIGH): Store new unrealizedPnl AND update previousUnrealizedPnl
    // in the same row write so the delta is always coherent.
    // previousUnrealizedPnl tracks the last committed unrealized value for this position,
    // enabling a delta-only atomic equity update below (no full scan needed).
    const prevUnrealized = Number(pos.previousUnrealizedPnl ?? 0);
    const unrealizedDelta = unrealizedPnl - prevUnrealized;

    await db.update(paperPositions).set({
      currentPrice: String(currentPrice),
      unrealizedPnl: String(unrealizedPnl),
      previousUnrealizedPnl: String(unrealizedPnl),  // advance the stored baseline
      mae: String(nextMae),
      mfe: String(nextMfe),
    }).where(eq(paperPositions.id, pos.id));

    totalUnrealizedPnl += unrealizedPnl;
    totalUnrealizedDelta += unrealizedDelta;
    positionsUpdated++;
  }

  // FIX 2 (B1 MED-HIGH): Delta-only SQL-atomic equity update.
  // Old code did a full-recompute (startingCapital + realizedPnl + unrealizedPnl)
  // which raced with closePosition's atomic `currentEquity + netPnl` UPDATE:
  // a concurrent close would be overwritten by a stale full-recompute.
  //
  // New approach: apply only the change in unrealizedPnl since the last price update.
  // closePosition uses `currentEquity + netPnl` (atomic).
  // updatePositionPrices uses `currentEquity + unrealizedDelta` (atomic, no scan).
  // Both are now additive-atomic — no race is possible.
  if (positionsUpdated > 0 && totalUnrealizedDelta !== 0) {
    await db.update(paperSessions).set({
      currentEquity: sql`${paperSessions.currentEquity}::numeric + ${totalUnrealizedDelta}`,
      peakEquity: sql`GREATEST(${paperSessions.peakEquity}::numeric, ${paperSessions.currentEquity}::numeric + ${totalUnrealizedDelta})`,
    }).where(eq(paperSessions.id, sessionId));
  }

  broadcastSSE("paper:pnl", { sessionId, unrealizedPnl: totalUnrealizedPnl });
  return { sessionId, unrealizedPnl: totalUnrealizedPnl, positionsUpdated };
}

// ─── Execution Quality Stats ─────────────────────────────────

export async function getExecutionQuality(sessionId: string) {
  const trades = await db.select().from(paperTrades)
    .where(eq(paperTrades.sessionId, sessionId));

  if (trades.length === 0) return { totalTrades: 0, avgSlippage: 0, totalSlippageCost: 0 };

  const slippages = trades.map(t => Number(t.slippage ?? 0));
  const avgSlippage = slippages.reduce((a, b) => a + b, 0) / slippages.length;
  const totalSlippageCost = slippages.reduce((sum, s, i) => {
    const spec = CONTRACT_SPECS[trades[i].symbol];
    return sum + s * (spec?.pointValue ?? 1) * trades[i].contracts;
  }, 0);

  return {
    totalTrades: trades.length,
    avgSlippage: Math.round(avgSlippage * 1000) / 1000,
    totalSlippageCost: Math.round(totalSlippageCost * 100) / 100,
  };
}

// ─── Gap 8: TCA Report ──────────────────────────────────────

export async function getTcaReport(sessionId: string) {
  const positions = await db.select().from(paperPositions)
    .where(eq(paperPositions.sessionId, sessionId));

  if (positions.length === 0) {
    return { totalPositions: 0, avgShortfall: 0, totalExecutionCost: 0, avgFillRatio: 1.0, worstFills: [] };
  }

  const closedPositions = positions.filter(p => p.closedAt);
  const shortfalls = closedPositions
    .map(p => Number(p.implementationShortfall ?? 0))
    .filter(v => v > 0);
  const fillRatios = closedPositions.map(p => Number(p.fillRatio ?? 1));

  const avgShortfall = shortfalls.length > 0
    ? shortfalls.reduce((s, v) => s + v, 0) / shortfalls.length
    : 0;
  const totalExecutionCost = shortfalls.reduce((s, v) => s + v, 0);
  const avgFillRatio = fillRatios.length > 0
    ? fillRatios.reduce((s, v) => s + v, 0) / fillRatios.length
    : 1.0;

  // Worst fills: top 5 by implementation shortfall
  const worstFills = closedPositions
    .filter(p => Number(p.implementationShortfall ?? 0) > 0)
    .sort((a, b) => Number(b.implementationShortfall ?? 0) - Number(a.implementationShortfall ?? 0))
    .slice(0, 5)
    .map(p => ({
      positionId: p.id,
      symbol: p.symbol,
      arrivalPrice: Number(p.arrivalPrice ?? 0),
      entryPrice: Number(p.entryPrice),
      shortfall: Number(p.implementationShortfall ?? 0),
      fillRatio: Number(p.fillRatio ?? 1),
    }));

  return {
    totalPositions: closedPositions.length,
    avgShortfall: Math.round(avgShortfall * 100) / 100,
    totalExecutionCost: Math.round(totalExecutionCost * 100) / 100,
    avgFillRatio: Math.round(avgFillRatio * 1000) / 1000,
    worstFills,
  };
}

// ─── Rolling Metrics (public getter for route) ───────────────

export async function getRollingMetrics(sessionId: string) {
  const [session] = await db.select({
    metricsSnapshot: paperSessions.metricsSnapshot,
    dailyPnlBreakdown: paperSessions.dailyPnlBreakdown,
    firmId: paperSessions.firmId,
  }).from(paperSessions).where(eq(paperSessions.id, sessionId));

  if (!session) return null;
  return {
    metrics: session.metricsSnapshot,
    dailyPnl: session.dailyPnlBreakdown,
    firmId: session.firmId,
  };
}

// ─── Wave D3: Contract Roll Handler ──────────────────────────
//
// Rationale: CME futures contracts expire quarterly (equity index) or monthly
// (crude, gold).  A position held past the roll date trades against a stale
// symbol — prices gap at expiry and P&L becomes meaningless garbage.
//
// Design:
//   - Runs regardless of pipeline pause state: "kill a position before contract
//     expires" is a safety operation, not a trading decision.
//   - flatten_day = business day BEFORE roll_day (1-day buffer for slippage).
//   - warn_window = 2 calendar days before roll: emit SSE + audit, no close yet.
//   - Fail-safe: if the Python roll calendar is unavailable, log warning and
//     DO NOT close positions.  Better to hold a stale position than to auto-close
//     every position because of a bug in roll detection.
//   - Unknown symbol: treated identically to roll-calendar unavailable (no close).
//
// Roll info is fetched from src.engine.roll_calendar via runPythonModule().
// Cached by (symbol, today_date) so repeated calls within the same day are cheap.

/** Per-symbol-day roll info cache. */
interface RollCacheEntry {
  rollInfo: {
    known: boolean;
    is_flatten_day: boolean;
    roll_date: string | null;
    flatten_date: string | null;
    days_to_roll: number | null;
    active_contract: string | null;
    warn_window: boolean;
  };
  dateKey: string; // "YYYY-MM-DD" ET — invalidated when the day advances
}
const rollCalendarCache = new Map<string, RollCacheEntry>();

/** Test hook — clear roll info cache. */
export function clearRollCalendarCache(): void {
  rollCalendarCache.clear();
}

export interface RollCheckResult {
  positionId: string;
  symbol: string;
  action: "flatten" | "warn" | "none" | "unknown_symbol" | "calendar_error";
  daysToRoll: number | null;
  rollDate: string | null;
  pnlAtClose?: number;
}

/**
 * Check all open positions in a session for contract roll proximity.
 * Flatten on the flatten day; emit warning 2 days before.
 *
 * This function ALWAYS runs, even when the pipeline is PAUSED/VACATION,
 * because contract expiry is a safety event, not a trading decision.
 *
 * @param sessionId   Active paper session UUID.
 * @param exitPrices  Optional map of symbol → current market price for flattens.
 *                    Falls back to position's currentPrice when not provided.
 */
export async function checkRollAndFlatten(
  sessionId: string,
  exitPrices?: Record<string, number>,
  context?: { correlationId?: string },
): Promise<RollCheckResult[]> {
  const correlationId = context?.correlationId ?? null;
  const rollSpan = tracer.startSpan("paper.roll_check");
  try {
    const openPositions = await db
      .select({
        id: paperPositions.id,
        symbol: paperPositions.symbol,
        unrealizedPnl: paperPositions.unrealizedPnl,
        currentPrice: paperPositions.currentPrice,
        contracts: paperPositions.contracts,
      })
      .from(paperPositions)
      .where(and(
        eq(paperPositions.sessionId, sessionId),
        isNull(paperPositions.closedAt),
      ));

    if (openPositions.length === 0) return [];

    const today = toEasternDateString(); // "YYYY-MM-DD"
    const { runPythonModule } = await import("../lib/python-runner.js");
    const results: RollCheckResult[] = [];

    // Deduplicate symbols — one Python call per symbol per day.
    const symbolSet = new Set(openPositions.map(p => p.symbol));
    const rollInfoBySymbol = new Map<string, RollCacheEntry["rollInfo"]>();

    for (const symbol of symbolSet) {
      const cacheKey = `${symbol}::${today}`;
      let cached = rollCalendarCache.get(cacheKey);
      if (!cached || cached.dateKey !== today) {
        try {
          const info = await runPythonModule<RollCacheEntry["rollInfo"]>({
            module: "src.engine.roll_calendar",
            config: { action: "get_roll_info", symbol, date: today },
            timeoutMs: 5_000,
            componentName: "roll-calendar",
          });
          cached = { rollInfo: info, dateKey: today };
          rollCalendarCache.set(cacheKey, cached);
        } catch (rollErr) {
          // Fail-safe: calendar unavailable → no auto-close
          logger.warn(
            { sessionId, symbol, err: rollErr },
            "Roll calendar unavailable — skipping roll check (fail-safe: positions NOT auto-closed)",
          );
          rollInfoBySymbol.set(symbol, {
            known: false, is_flatten_day: false, roll_date: null,
            flatten_date: null, days_to_roll: null, active_contract: null,
            warn_window: false,
          });
          continue;
        }
      }
      rollInfoBySymbol.set(symbol, cached.rollInfo);
    }

    for (const pos of openPositions) {
      const info = rollInfoBySymbol.get(pos.symbol);

      if (!info) {
        results.push({
          positionId: pos.id, symbol: pos.symbol, action: "calendar_error",
          daysToRoll: null, rollDate: null,
        });
        continue;
      }

      if (!info.known) {
        logger.debug(
          { sessionId, positionId: pos.id, symbol: pos.symbol },
          "Roll calendar: symbol not in schedule — no action",
        );
        results.push({
          positionId: pos.id, symbol: pos.symbol, action: "unknown_symbol",
          daysToRoll: null, rollDate: null,
        });
        continue;
      }

      if (info.is_flatten_day) {
        // FLATTEN — close the position at market before roll
        const exitPrice = exitPrices?.[pos.symbol] ?? Number(pos.currentPrice ?? 0);
        let pnlAtClose: number | undefined;

        try {
          const closeResult = await closePosition(pos.id, exitPrice, undefined, { correlationId: correlationId ?? undefined });
          pnlAtClose = closeResult.pnl;
        } catch (closeErr) {
          logger.error(
            { sessionId, positionId: pos.id, symbol: pos.symbol, err: closeErr },
            "Roll handler: closePosition failed — position NOT closed",
          );
          results.push({
            positionId: pos.id, symbol: pos.symbol, action: "calendar_error",
            daysToRoll: info.days_to_roll, rollDate: info.roll_date,
          });
          continue;
        }

        // Persist roll event
        try {
          await db.insert(contractRolls).values({
            positionId: pos.id,
            sessionId,
            symbol: pos.symbol,
            action: "flatten",
            rollDate: info.roll_date!,
            flattenDate: info.flatten_date!,
            contracts: pos.contracts,
            preRollPnl: String(Number(pos.unrealizedPnl ?? 0)),
            activeContract: info.active_contract ?? null,
            reason: "contract_rollover",
          });
        } catch (dbErr) {
          logger.warn({ sessionId, positionId: pos.id, err: dbErr }, "Roll handler: contract_rolls insert failed (non-blocking)");
        }

        // Audit trail
        try {
          await db.insert(auditLog).values({
            action: "position.roll-flatten",
            entityType: "paper_position",
            entityId: pos.id,
            input: {
              sessionId, symbol: pos.symbol,
              rollDate: info.roll_date, flattenDate: info.flatten_date,
              daysToRoll: info.days_to_roll, activeContract: info.active_contract,
            },
            result: { pnlAtClose, action: "flatten", reason: "contract_rollover" },
            status: "success",
            decisionAuthority: "system",
            correlationId,
          });
        } catch (auditErr) {
          logger.warn({ positionId: pos.id, err: auditErr }, "Roll handler: audit log write failed (non-blocking)");
        }

        broadcastSSE("paper:roll-flatten", {
          sessionId, positionId: pos.id, symbol: pos.symbol,
          rollDate: info.roll_date, flattenDate: info.flatten_date,
          pnlAtClose, activeContract: info.active_contract,
        });

        logger.info(
          { sessionId, positionId: pos.id, symbol: pos.symbol, rollDate: info.roll_date, pnlAtClose },
          "Roll handler: position flattened before contract rollover",
        );

        results.push({
          positionId: pos.id, symbol: pos.symbol, action: "flatten",
          daysToRoll: info.days_to_roll, rollDate: info.roll_date, pnlAtClose,
        });

      } else if (info.warn_window) {
        // WARN — 2-day advance warning, no position close
        broadcastSSE("paper:roll-warning", {
          sessionId, positionId: pos.id, symbol: pos.symbol,
          daysToRoll: info.days_to_roll, rollDate: info.roll_date,
          flattenDate: info.flatten_date, activeContract: info.active_contract,
        });

        // Persist warn event (once per day per position is acceptable — duplicate
        // warn rows are harmless since the position is not altered)
        try {
          await db.insert(contractRolls).values({
            positionId: pos.id,
            sessionId,
            symbol: pos.symbol,
            action: "warn",
            rollDate: info.roll_date!,
            flattenDate: info.flatten_date!,
            contracts: pos.contracts,
            preRollPnl: String(Number(pos.unrealizedPnl ?? 0)),
            activeContract: info.active_contract ?? null,
            reason: "contract_rollover_warning",
          });
        } catch (dbErr) {
          logger.warn({ sessionId, positionId: pos.id, err: dbErr }, "Roll handler: contract_rolls warn insert failed (non-blocking)");
        }

        logger.warn(
          { sessionId, positionId: pos.id, symbol: pos.symbol, daysToRoll: info.days_to_roll, rollDate: info.roll_date },
          "Roll handler: contract rollover approaching — flatten day is within 2 days",
        );

        results.push({
          positionId: pos.id, symbol: pos.symbol, action: "warn",
          daysToRoll: info.days_to_roll, rollDate: info.roll_date,
        });

      } else {
        results.push({
          positionId: pos.id, symbol: pos.symbol, action: "none",
          daysToRoll: info.days_to_roll, rollDate: info.roll_date,
        });
      }
    }

    rollSpan.setAttribute("positionsChecked", openPositions.length);
    rollSpan.setAttribute("flattenCount", results.filter(r => r.action === "flatten").length);
    rollSpan.setAttribute("warnCount", results.filter(r => r.action === "warn").length);

    return results;
  } finally {
    rollSpan.end();
  }
}

/**
 * Session-end roll sweep: run checkRollAndFlatten for ALL active sessions.
 * Called by the scheduler at 4:30 PM ET on CME trading days.
 *
 * Runs regardless of pipeline pause state — roll handler is a safety operation.
 */
export async function runSessionEndRollSweep(context?: { correlationId?: string }): Promise<{
  sessionsChecked: number;
  totalActions: RollCheckResult[];
}> {
  const correlationId = context?.correlationId;
  const activeSessions = await db
    .select({ id: paperSessions.id })
    .from(paperSessions)
    .where(eq(paperSessions.status, "active"));

  const allActions: RollCheckResult[] = [];
  for (const session of activeSessions) {
    try {
      const actions = await checkRollAndFlatten(session.id, undefined, { correlationId });
      allActions.push(...actions);
    } catch (err) {
      logger.error({ sessionId: session.id, err }, "Roll sweep: checkRollAndFlatten failed for session (non-blocking)");
    }
  }

  const flattenCount = allActions.filter(a => a.action === "flatten").length;
  const warnCount = allActions.filter(a => a.action === "warn").length;
  if (flattenCount > 0 || warnCount > 0) {
    logger.info(
      { sessionsChecked: activeSessions.length, flattenCount, warnCount },
      "Roll sweep complete",
    );
  }

  return { sessionsChecked: activeSessions.length, totalActions: allActions };
}
