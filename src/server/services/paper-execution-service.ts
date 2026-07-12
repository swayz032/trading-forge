import { randomUUID } from "crypto";
import { db } from "../db/index.js";
import { paperSessions, paperPositions, paperTrades, strategies, shadowSignals, auditLog, macroSnapshots, skipDecisions, complianceRulesets, contractRolls, brokerAccounts, accountStrategyAssignments } from "../db/schema.js";
import { writeLockoutFromKillEvent } from "./strategy-lockout-service.js";
import { eq, and, isNull, desc, sql, inArray } from "drizzle-orm";
import { broadcastSSE, PAPER_EXIT_EVENTS } from "../routes/sse.js";
import { logger } from "../lib/logger.js";
// Track A F-6: insertAuditRowSafe migrated here. Remaining db.insert(auditLog)
// call sites in this file retain the raw pattern until incremental migration completes.
// TODO: correlation_id not threaded through most call sites in this file.
import { insertAuditRowSafe } from "../lib/audit-log-helper.js";
import { onPaperTradeClose } from "../scheduler.js";
import { CONTRACT_SPECS } from "../../shared/firm-config.js";
// deep-scan #15 FIX M4: the authoritative single-day consistency rule lives in
// consistency-tracker-service.ts (40% warn / 50% block firm-wide, false-positive
// guard). checkConsistencyRule DEFERS to it so the two can never disagree.
import { CONSISTENCY_RULE_FIRMS, getConsistencyState } from "./consistency-tracker-service.js";
// Wave 27.5 Pass D.2: symbol-aware commission — replaces the legacy symbol-agnostic
// getCommissionPerSide(firmId) for position-close P&L calculations.
import { getCommissionPerSide as getCommissionPerSideBySymbol, getStopCeilingPts } from "../lib/contract-class.js";
import { avwapTypicalPrice, shouldAdvanceRunnerTrail } from "../lib/runner-trail-ratchet.js";
import { toEasternDateString, toFuturesTradingDayString, invalidateDailyLossCache } from "./paper-risk-gate.js";
import { getEtOffsetMinutes } from "../lib/dst-utils.js";
import { tracer } from "../lib/tracing.js";
import { withSessionLock } from "../lib/db-locks.js";
import { paperTrades as paperTradesCounter, dllHaltTotal } from "../lib/metrics-registry.js";
import { isActive as isPipelineActive } from "./pipeline-control-service.js";
// Phase 4C: production kill switch — checked FIRST in openPosition (fail-CLOSED)
import { killSwitch } from "../production/kill-switch.js";
import { AlertFactory } from "./alert-service.js";
import { computeRollSpreadCost } from "../lib/roll-calendar-loader.js";
import {
  isExchangeHalted,
  registerOutageChangeCallback,
} from "./exchange-status-service.js";
// C2: prop-firm suspension gate
import { isFirmSuspended, registerSuspensionChangeCallback } from "./prop-firm-health-service.js";
// C4: network failover connectivity annotation (annotation-only, does not block orders)
import { isConnectivityDegraded } from "../lib/network-failover.js";
// Track 5: strategy assignment check — if accountId is provided, verify an active assignment exists
import { getActiveAssignment } from "./strategy-assignment-service.js";
// Wave 25.5 Track 1: adaptive exit plan wiring
import { computeExitPlan, type ExitPlan } from "./adaptive-exit-engine.js";
import type { ExitPlanWithRuntimeState, EntryDecisionContext } from "../db/jsonb-shapes.js";
// Pass 6 Track D: per-call exit-handler Discord visibility
import { notifyWarning, notifyCritical } from "./notification-service.js";
import { appendFamilyGradePostscript } from "../lib/notification-helpers.js";
// 2026-06-29 Fix 2 (HIGH): TS Style C evaluator — primary path replacing Python subprocess.
// Eliminates per-bar spawn overhead and 1h TP blackout from circuit-breaker open state.
import { evaluateStyleCExit } from "../lib/style-c-exit-evaluator.js";
// deepscan17 (2026-07-05) C-1 fix: forceCloseAllPositions scope resolution reuses the
// SAME account-key resolver cross-symbol-pnl.ts uses for DLL aggregation, so "which
// account does this position belong to" can never disagree between the two subsystems.
import { resolveAccountKey } from "./cross-symbol-pnl.js";
export { CONTRACT_SPECS };

// ─── C1: Register CME outage callback on module init ─────────────────────────
// The exchange-status-service notifies us when CME halts or resumes.
// On halt: cancel pending orders, block new entries, log open positions.
// On resume: lift the block — do NOT auto-reissue queued orders (manual review).
registerOutageChangeCallback(async (exchange: string, isActive: boolean, affectedSymbols: string[]) => {
  if (isActive) {
    // Outage started — log all open positions for auditing
    try {
      const openPositions = await db
        .select({
          id: paperPositions.id,
          sessionId: paperPositions.sessionId,
          symbol: paperPositions.symbol,
          side: paperPositions.side,
          contracts: paperPositions.contracts,
          entryPrice: paperPositions.entryPrice,
        })
        .from(paperPositions)
        .where(and(isNull(paperPositions.closedAt), inArray(paperPositions.symbol, affectedSymbols)));

      logger.error(
        {
          exchange,
          affectedSymbols,
          openPositionCount: openPositions.length,
          openPositions: openPositions.map(p => ({
            id: p.id, sessionId: p.sessionId, symbol: p.symbol,
            side: p.side, contracts: p.contracts,
          })),
        },
        "C1 CME outage: open positions held (NOT closed). New entries BLOCKED. Manual review required on resume.",
      );

      // Write audit log for traceability (Track A F-6: migrated to insertAuditRowSafe)
      await insertAuditRowSafe({
        action: "exchange.outage_positions_logged",
        entityType: "system",
        entityId: null,
        decisionAuthority: "system",
        input: { exchange, affectedSymbols } as Record<string, unknown>,
        result: {
          openPositionCount: openPositions.length,
          openPositionIds: openPositions.map(p => p.id),
          action: "held_no_close",
          entriesBlocked: true,
          autoReissue: false,
        } as Record<string, unknown>,
        status: "success",
        correlationId: randomUUID(), // FINDING #8 FIX: non-null correlationId for 90-day reconstruction
      });
    } catch (err) {
      logger.error({ err, exchange }, "C1 outage callback: failed to log open positions");
    }
  } else {
    // Outage resolved — lift block, but do NOT auto-reissue orders
    logger.info(
      { exchange, affectedSymbols },
      "C1 CME outage resolved: entry block lifted. Orders NOT auto-reissued — manual review required.",
    );
    await db.insert(auditLog).values({
      action: "exchange.outage_resolved_positions_held",
      entityType: "system",
      entityId: null,
      decisionAuthority: "system",
      input: { exchange, affectedSymbols } as Record<string, unknown>,
      result: { action: "entry_block_lifted", autoReissue: false } as Record<string, unknown>,
      status: "success",
      correlationId: randomUUID(), // FINDING #8 FIX: non-null correlationId for 90-day reconstruction
    }).catch((err) => logger.error({ err }, "C1 outage resolved audit log failed (non-blocking)"));
  }
});

// ─── C2: Register prop firm suspension callback on module init ────────────────
registerSuspensionChangeCallback(async (firmId: string, suspended: boolean) => {
  if (suspended) {
    logger.error(
      { firmId },
      "C2 prop firm suspension: new orders BLOCKED for this firm. Alert fired. Open positions logged.",
    );
    // Log open positions for the affected firm
    try {
      const firmSessions = await db
        .select({ id: paperSessions.id, firmId: paperSessions.firmId })
        .from(paperSessions)
        .where(and(eq(paperSessions.firmId, firmId), eq(paperSessions.status, "active")));

      if (firmSessions.length > 0) {
        const sessionIds = firmSessions.map(s => s.id);
        const openPositions = await db
          .select({ id: paperPositions.id, sessionId: paperPositions.sessionId, symbol: paperPositions.symbol })
          .from(paperPositions)
          .where(and(isNull(paperPositions.closedAt), inArray(paperPositions.sessionId, sessionIds)));

        logger.error(
          { firmId, activeSessions: firmSessions.length, openPositions: openPositions.length },
          "C2 suspension: open positions logged for suspended firm",
        );
      }
    } catch (err) {
      logger.error({ err, firmId }, "C2 suspension callback: failed to log open positions");
    }
  } else {
    logger.info({ firmId }, "C2 prop firm suspension lifted: entry block cleared for firm");
  }
});

// ─── DLL Kill Switch Thresholds (Track 3 — funded-trader playbook) ───────────
// HALT_AT_DLL_PCT  (0.67): Block new entries when daily loss reaches 67% of
//   firm DLL. This is the personal DLL = 67% of firm DLL rule. Leaves a next-day
//   trading buffer even on worst days. Previously: 0.95 (no practical buffer).
// FORCE_CLOSE_AT_DLL_PCT (0.95): Force-flatten all positions at 95% of firm DLL.
//   Previously: 1.00 (actual breach — too late to protect remaining capital).
//
// Both values read from environment variables so they can be overridden without
// a code deploy. Defaults: DLL_HALT_PCT=0.67, DLL_FORCE_CLOSE_PCT=0.95.
//
// Audit: on first invocation post-deploy, a kill_switch.threshold_changed audit
// row is written capturing old/new values (derived from the hard-coded pre-Track-3
// defaults vs current effective values). Written once per process lifetime.
const HALT_AT_DLL_PCT        = parseFloat(process.env.DLL_HALT_PCT        ?? "0.67");
const FORCE_CLOSE_AT_DLL_PCT = parseFloat(process.env.DLL_FORCE_CLOSE_PCT ?? "0.95");

// Validate env var values are sensible; fall back to defaults silently.
const _effectiveHaltPct       = (Number.isFinite(HALT_AT_DLL_PCT) && HALT_AT_DLL_PCT > 0 && HALT_AT_DLL_PCT < 1) ? HALT_AT_DLL_PCT : 0.67;
const _effectiveForceClosePct = (Number.isFinite(FORCE_CLOSE_AT_DLL_PCT) && FORCE_CLOSE_AT_DLL_PCT > 0 && FORCE_CLOSE_AT_DLL_PCT <= 1) ? FORCE_CLOSE_AT_DLL_PCT : 0.95;

// Track 3 pre-change defaults (used only for audit row on first invocation).
const _PRE_TRACK3_HALT_PCT        = 0.95;  // was "approaching_daily_loss_limit" at 95%
const _PRE_TRACK3_FORCE_CLOSE_PCT = 1.00;  // was "daily_loss_limit_breached" at 100%

let _thresholdAuditWritten = false;

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
  halt_pct_used: number;
  force_close_pct_used: number;
  cachedAt: number;
}
// Capital-decision staleness gate: how OLD a cached kill-switch verdict may be
// before we re-spawn the Python evaluator. Env-overridable; invalid (NaN / ≤0)
// falls back to the 5_000 ms default (behavior unchanged unless an operator tunes it).
const KILL_SWITCH_CACHE_TTL_MS = ((): number => {
  const v = parseInt(process.env.KILL_SWITCH_CACHE_TTL_MS ?? "5000", 10);
  return Number.isFinite(v) && v > 0 ? v : 5_000;
})();
const killSwitchCache = new Map<string, KillSwitchCacheEntry>();

/** Test/admin hook — clear kill switch cache (force re-evaluation). */
export function clearKillSwitchCache(): void {
  killSwitchCache.clear();
}

// ─── GAP-2 FIX: Session-level stuck-position registry ────────────────────────
// When forceCloseAllPositions cannot close a position (no currentPrice AND no
// entryPrice fallback), the session is added here. Subsequent openPosition calls
// on that session are blocked until the operator resolves the stuck position.
//
// This is an in-memory Set (not persisted to DB) because:
//   (a) stuck positions require immediate manual intervention — they do NOT
//       survive a process restart (restarted service re-reads open positions
//       and will immediately attempt another force-flatten on the next bar).
//   (b) the primary signal is the CRITICAL audit row + alert — this Set is
//       the enforcement mechanism for the current process lifetime only.
//
// sessionId is added on first force-flatten failure; it is NOT automatically
// cleared by this service (operator must resolve + call clearStuckSessionId).
const stuckSessionIds = new Set<string>();

/** Test/admin hook — clear a stuck session so entries can resume. */
export function clearStuckSessionId(sessionId: string): void {
  stuckSessionIds.delete(sessionId);
}

// ─── FINDING #6 FIX: Startup orphan-position recovery sweep ─────────────────
//
// stuckSessionIds is a module-level in-memory Set that is cleared on every
// process restart. paper_positions rows with closedAt=null whose session is
// no longer "active" become PERMANENT ORPHANS — openPosition blocks on them
// indefinitely because stuckSessionIds is empty after the restart and the
// orphan is never re-detected.
//
// This function must be called ONCE at boot (wired in index.ts before listen())
// to re-populate stuckSessionIds with any pre-existing orphaned positions.
//
// Safe to call multiple times (idempotent: stuckSessionIds.add is a no-op for
// already-present IDs; audit rows deduplicate by their own identity).
//
// Do NOT call from scheduler.ts or any hot path — this is a one-shot boot sweep.
//
export async function recoverOrphanedPositionsAtStartup(): Promise<{ orphansFound: number }> {
  let orphansFound = 0;
  try {
    const [allOpen, activeSessions] = await Promise.all([
      db.select({
        id: paperPositions.id,
        sessionId: paperPositions.sessionId,
        symbol: paperPositions.symbol,
        side: paperPositions.side,
      }).from(paperPositions).where(isNull(paperPositions.closedAt)),
      db.select({ id: paperSessions.id })
        .from(paperSessions)
        .where(eq(paperSessions.status, "active")),
    ]);

    const activeSessionIdSet = new Set(activeSessions.map(s => s.id));
    const orphans = allOpen.filter(p => p.sessionId && !activeSessionIdSet.has(p.sessionId));

    for (const orphan of orphans) {
      if (orphan.sessionId) {
        stuckSessionIds.add(orphan.sessionId);
      }
      orphansFound++;
      logger.warn(
        { positionId: orphan.id, sessionId: orphan.sessionId, symbol: orphan.symbol },
        "paper-execution.startup: orphaned position detected (session not active) — session blocked until manual resolution",
      );
      // Write audit row so the orphan is visible in the audit_log for post-restart review.
      db.insert(auditLog).values({
        action: "paper.orphaned_position_detected",
        entityType: "paper_position",
        entityId: orphan.id,
        decisionAuthority: "system",
        input: {
          positionId: orphan.id,
          sessionId: orphan.sessionId,
          symbol: orphan.symbol,
          side: orphan.side,
          reason: "session_not_active_at_startup",
        } as Record<string, unknown>,
        result: {
          sessionBlocked: true,
          resolution: "operator_must_manually_close_or_call_clearStuckSessionId",
        } as Record<string, unknown>,
        status: "error",
      }).catch((err) => logger.error({ err, positionId: orphan.id }, "paper-execution.startup: orphan audit write failed (non-blocking)"));
    }

    if (orphansFound > 0) {
      logger.error(
        { orphansFound, activeSessionCount: activeSessions.length },
        "paper-execution.startup: ORPHANED POSITIONS detected — blocked sessions require manual resolution (use clearStuckSessionId after confirming position is closed)",
      );
    }
  } catch (err) {
    // Fail-open on startup: a DB error should not block the whole boot sequence.
    // Orphans will be re-detected when they next hit the stuckSessionIds guard in openPosition.
    logger.error({ err }, "paper-execution.startup: orphan recovery sweep failed — will not block boot (positions may be orphaned until next open attempt)");
  }
  return { orphansFound };
}

// ─── Compliance Gate cache (B4.4 / C5) ──────────────────────────
// Cache the FRESHNESS check result per firm for 60s so we don't spawn a
// Python subprocess on every bar / signal.  The cache key is firmId;
// invalidation happens automatically on TTL expiry.
//
// IMPORTANT: The VIOLATION check is NOT cached — it depends on dynamic
// per-order state (trades_today, open_positions, account_balance,
// intended_max_loss, proposed_symbol) that changes every call.  Caching
// the violation result would cause the MFFU 2% rule, HFT limit, and
// hedging-ban checks to be evaluated against stale data.
//
// Split: freshness is stable (ruleset changes rarely → safe to cache).
//        violation is dynamic (order-level state → always fresh).
interface ComplianceCacheEntry {
  fresh: boolean;
  freshnessStatus: string;
  freshnessMessage: string;
  driftDetected: boolean;
  rulesetPayload: Record<string, unknown>;
  cachedAt: number;
}
// Capital-decision staleness gate: how OLD a cached compliance-freshness verdict
// may be before re-evaluation. Env-overridable; invalid (NaN / ≤0) falls back to
// the 60_000 ms default (behavior unchanged unless an operator tunes it).
const COMPLIANCE_CACHE_TTL_MS = ((): number => {
  const v = parseInt(process.env.COMPLIANCE_CACHE_TTL_MS ?? "60000", 10);
  return Number.isFinite(v) && v > 0 ? v : 60_000;
})();
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
// Capital-decision staleness gate: rolling window + consecutive-failure count that
// decide when the calendar guard is declared persistently down. Env-overridable;
// invalid (NaN / ≤0) falls back to the 10-minute / 3-failure defaults (behavior
// unchanged unless an operator tunes them).
const CALENDAR_FAILURE_WINDOW_MS = ((): number => {
  const v = parseInt(process.env.CALENDAR_FAILURE_WINDOW_MS ?? "600000", 10);
  return Number.isFinite(v) && v > 0 ? v : 10 * 60_000;
})();
const CALENDAR_FAILURE_THRESHOLD = ((): number => {
  const v = parseInt(process.env.CALENDAR_FAILURE_THRESHOLD ?? "3", 10);
  return Number.isFinite(v) && v > 0 ? v : 3;
})();
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

/**
 * F10: Centralise the ASIA→ASIAN session-name remap that calculateSlippage expects.
 * classifySessionType() emits "ASIA"; calculateSlippage multiplier map uses "ASIAN".
 * Previously each call site had an inline ternary — this helper is the single source.
 * Exported for direct unit testing.
 */
export function toSlippageSession(session: ReturnType<typeof classifySessionType>): string {
  return session === "ASIA" ? "ASIAN" : session;
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
  // deep-scan 2026-07-11 MED fix (#11): optional bar OPEN. When a caller supplies it, updatePositionPrices
  // models gap-through-stop fills — a bar that OPENS beyond the stop fills at the gapped open (matching
  // backtester.py, which counts gap_through_stop). Absent → falls back to filling at the exact stop.
  open?: number;
}

export type PositionPriceUpdate = number | PriceBarUpdate;

function normalizePriceUpdate(update: PositionPriceUpdate): { close: number; high: number; low: number; volume: number } {
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
  /** FINDING #4 FIX: rolling median ATR (np.nanmedian equivalent) for entry slippage parity.
   *  When provided, replaces the constant 0.85× ATR estimate used before this fix.
   *  Paper-signal-service passes this from evaluateSignals() via the bar ATR series. */
  medianAtr14?: number;
  barVolume?: number;
  medianBarVolume?: number;
  // ── Wave 25.5 Track 1: adaptive exit plan wiring ──────────────────────────
  // When exit_style="adaptive", callers supply these to enable computeExitPlan().
  // All optional — absent → falls back to static_styleC (fail-soft, never blocks).
  /** Strategy metadata needed for computeExitPlan(). Requires id + exit_plan_config. */
  adaptiveExitInput?: {
    strategy: { id: string; exit_plan_config?: import("../db/jsonb-shapes.js").ExitPlanConfig | null };
    entry: { stop: number };  // stop price at entry (structural stop derived before calling openPosition)
    bar: { close: number; high: number; low: number; volume: number };
    marketState: { regime: string; narrativePhase: string | null };
    weightedScore?: import("./confluence-score.js").WeightedScoreResult;
  };
  // Trade-critique data bridge (2026-07-05): entry-time decision context captured by
  // paper-signal-service.ts at signal time (bar N). Merged into paper_positions.exit_plan
  // JSONB at INSERT (alongside the existing F9 entryRegime field) so trade-critique-service.ts
  // can read it at close. Optional — absent when the caller didn't compute it (e.g. manual
  // opens, other automation) or when nothing was known at signal time; never fabricated.
  entryContext?: EntryDecisionContext;
}, context?: {
  correlationId?: string;
  accountId?: string;
  // deepscan18 (2026-07-05) C-C1: OPTIONAL account/firm scope for the kill-
  // switch halt gate below. Threaded through by callers that already know the
  // evaluating session's resolved account key (see cross-symbol-pnl.ts::
  // resolveAccountKey) — today, paper-signal-service.ts's deferred-entry call
  // site. Distinct from `accountId` above (broker-account assignment id, an
  // unrelated concept). Omitting it preserves the exact legacy GLOBAL
  // isHaltedForProduction() behavior byte-for-byte (e.g. the manual
  // /api/paper/execute/open route, which doesn't pass one).
  accountKey?: string;
  firmId?: string | null;
}) {
  // FIX 4: generate a per-call correlationId when caller does not supply one.
  // This ensures every audit row from openPosition has a reconstructable trace root
  // even for callers that don't thread correlationId (manual opens, automation).
  const correlationId = context?.correlationId ?? randomUUID();

  // ─── Phase 4C: Production-mode halt gate (UNCONDITIONALLY FIRST) ─────────
  // FINDING #3 FIX: This gate MUST execute before any early-return path
  // (including the assignment check below). A halted system MUST NOT open
  // positions regardless of assignment state or any other condition.
  // Fail-CLOSED: DB error → isHaltedForProduction() returns true → block order.
  // This gate supersedes every other gate including the pipeline pause guard.
  // production_mode='HALT' means the operator has explicitly halted all
  // paper trading activity — no new positions may be opened until they set
  // production_mode back to 'PAPER' or 'LIVE'.
  //
  // deepscan18 C-C1: pass through context.accountKey/firmId so a breach on a
  // SIBLING account/firm doesn't block this account's entry. Both are
  // undefined for callers that don't supply them, which is the exact legacy
  // (global) evaluation — byte-identical for those callers.
  try {
    if (await killSwitch.isHaltedForProduction({ correlationId, accountKey: context?.accountKey, firmId: context?.firmId })) {
      logger.warn(
        { fn: "openPosition", sessionId, symbol: params.symbol, side: params.side, reason: "production_mode_halt" },
        "paper-execution.production-halted: new entry blocked by production kill switch",
      );
      db.insert(auditLog).values({
        action: "paper.entry_blocked",
        entityType: "paper_session",
        entityId: sessionId,
        decisionAuthority: "system",
        input: { sessionId, symbol: params.symbol, side: params.side } as Record<string, unknown>,
        result: { reason: "production_halt", blocked: true } as Record<string, unknown>,
        status: "success",
        correlationId,
      }).catch((err) => logger.error({ err }, "paper-execution: production-halt audit_log write failed (non-blocking)"));
      broadcastSSE("paper:entry-blocked-production-halt", {
        sessionId,
        symbol: params.symbol,
        side: params.side,
        reason: "production_halt",
        correlationId,
      });
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
  } catch (err) {
    // Kill switch read failed — fail CLOSED (block the order)
    logger.error(
      { err, fn: "openPosition", sessionId, symbol: params.symbol },
      "paper-execution: kill switch read error — failing CLOSED (blocking entry)",
    );
    broadcastSSE("paper:entry-blocked-production-halt", {
      sessionId,
      symbol: params.symbol,
      side: params.side,
      reason: "production_halt_check_error",
      correlationId,
    });
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

  // ─── Track 5: Strategy assignment check ─────────────────────────────────
  // If an accountId is provided, verify an active strategy assignment exists
  // for that account before proceeding. Log debug and skip (return null) if
  // no active assignment is found — this is not an error condition, it means
  // the operator has not yet assigned a strategy to this account.
  // NOTE: This check intentionally runs AFTER the kill-switch gate above,
  // so that a halted system is always blocked first (FINDING #3 fix).
  if (context?.accountId) {
    try {
      const assignment = await getActiveAssignment(context.accountId);
      if (!assignment) {
        logger.debug(
          { fn: "openPosition", sessionId, accountId: context.accountId, symbol: params.symbol },
          "paper-execution.no-assignment: no active strategy assignment for account — skipping signal",
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
    } catch (err) {
      // Assignment check failure is non-fatal — log and continue (fail-open for this optional check)
      logger.warn(
        { err, fn: "openPosition", sessionId, accountId: context.accountId },
        "paper-execution: assignment check failed — proceeding without assignment gate (fail-open)",
      );
    }
  }

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
    // FIX 5: emit audit row so pipeline-blocked entries are traceable.
    db.insert(auditLog).values({
      action: "paper.entry_blocked_pipeline_paused",
      entityType: "paper_session",
      entityId: sessionId,
      decisionAuthority: "system",
      input: { sessionId, symbol: params.symbol, side: params.side } as Record<string, unknown>,
      result: { reason: "pipeline_paused", blocked: true } as Record<string, unknown>,
      status: "success",
      correlationId,
    }).catch((err) => logger.error({ err }, "paper-execution: pipeline-paused audit write failed (non-blocking)"));
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

  // ─── C1: CME exchange outage gate ────────────────────────────
  // Block new entries during a detected exchange outage.
  // Positions held open are NOT closed by this gate — that would lock in a
  // price during a halt when fills are unreliable. Operators review on resume.
  // The CME symbol → exchange mapping: all GLOBEX symbols (MES, MNQ, MCL…) → "CME".
  if (isExchangeHalted("CME")) {
    logger.warn(
      { fn: "openPosition", sessionId, symbol: params.symbol, side: params.side, exchange: "CME" },
      "C1 CME outage gate: blocking new entry — exchange is halted",
    );
    broadcastSSE("paper:order-blocked-outage", {
      sessionId,
      symbol: params.symbol,
      side: params.side,
      exchange: "CME",
      reason: "exchange_halted",
      correlationId,
    });
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

  // ─── C2: Prop firm suspension gate ───────────────────────────
  // Block new entries if this session's firm is suspended.
  // Checked here (last-line defence) as well as upstream in paper-signal-service.
  // We need session firmId — read it outside the lock for early exit.
  {
    const [sessionForFirmCheck] = await db
      .select({ firmId: paperSessions.firmId })
      .from(paperSessions)
      .where(eq(paperSessions.id, sessionId));
    const firmIdForCheck = sessionForFirmCheck?.firmId;

    // C2 null-guard: fail-CLOSED when firmId cannot be resolved.
    // A missing firmId means the session row was not found, which is an integrity
    // failure — we cannot verify firm suspension status, so we must block.
    // (Wave 23H Fix 1: closes silent bypass discovered in gate-strength-audit-2026-05-20)
    if (!firmIdForCheck) {
      logger.error(
        { fn: "openPosition", sessionId, symbol: params.symbol, side: params.side },
        "C2 firm suspension gate: firmId lookup returned null — blocking entry (fail-closed)",
      );
      db.insert(auditLog).values({
        action: "signal.blocked_firm_id_lookup_failed",
        entityType: "paper_session",
        entityId: sessionId,
        decisionAuthority: "system",
        input: { sessionId, symbol: params.symbol, side: params.side } as Record<string, unknown>,
        result: { reason: "firm_id_null", blocked: true } as Record<string, unknown>,
        status: "failure",
        correlationId,
      }).catch((err) => logger.error({ err }, "C2: firm_id_null audit_log write failed"));
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

    if (firmIdForCheck && isFirmSuspended(firmIdForCheck)) {
      logger.warn(
        { fn: "openPosition", sessionId, firmId: firmIdForCheck, symbol: params.symbol },
        "C2 prop firm suspension gate: blocking new entry — firm is suspended",
      );
      broadcastSSE("paper:order-blocked-suspension", {
        sessionId,
        firmId: firmIdForCheck,
        symbol: params.symbol,
        side: params.side,
        reason: "firm_suspended",
        correlationId,
      });
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
  }

  // ─── C4: Network connectivity annotation ─────────────────────
  // When ISP connectivity is degraded (FAILOVER_ALERT or DEGRADED),
  // emit a structured warning. Orders are NOT blocked — blocking orders
  // during network degradation would distort paper session P&L and corrupt
  // promotion-gate inputs. The log annotation enables post-hoc filtering.
  //
  // Server-side order placement (primary C4 defense): paper positions are
  // held in Railway PostgreSQL which remains reachable even when Skytech's
  // ISP is down. Sessions remain active; position management resumes when
  // connectivity restores. Do NOT auto-close on network degradation.
  const connectivityDegraded = isConnectivityDegraded();
  if (connectivityDegraded) {
    logger.warn(
      {
        fn: "openPosition",
        sessionId,
        symbol: params.symbol,
        side: params.side,
        connectivityDegraded: true,
        c4: "network_failover_active",
      },
      "C4 network: connectivity degraded — order proceeding (positions held server-side). Enable USB tethering if not active. See infra/network-redundancy.md.",
    );
  }

  const openSpan = tracer.startSpan("paper.position_open");
  openSpan.setAttribute("symbol", params.symbol);
  openSpan.setAttribute("side", params.side);
  openSpan.setAttribute("contracts", params.contracts);
  openSpan.setAttribute("connectivity_degraded", connectivityDegraded);

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

  // ─── GAP-1 FIX: DLL halt sticky check ───────────────────────────────────────
  // Once a session crosses 67% DLL in a CME trading day, the halt is PERMANENT
  // for that day regardless of subsequent P&L recovery. This prevents a closed
  // profitable position from temporarily pulling P&L back below 67% and allowing
  // fresh entries before the next CME day boundary (17:00 ET).
  //
  // The sticky flag is stored in session.config.dailyLossHaltedAt (CME day key,
  // same format as dailyPnlBreakdown keys). It is cleared automatically when the
  // CME day key changes (5pm ET cutoff). No explicit clear is needed.
  //
  // This check runs BEFORE the Python subprocess call so that:
  //   (a) we save the ~100ms Python invocation on already-halted sessions, and
  //   (b) recovery P&L can never sneak through the 5s cache gap.
  {
    const todayKey = toFuturesTradingDayString();
    const haltedAt = typeof sessionConfig.dailyLossHaltedAt === "string"
      ? sessionConfig.dailyLossHaltedAt
      : null;

    if (haltedAt === todayKey) {
      // Sticky halt is active for today — block immediately, no Python call needed.
      logger.warn(
        { sessionId, symbol: params.symbol, haltedAt, todayKey },
        "Kill switch (GAP-1): DLL halt sticky flag is set for today — blocking entry without Python re-check",
      );
      dbConn.insert(auditLog).values({
        action: "kill_switch.dll_halt_sticky_blocked",
        entityType: "paper_session",
        entityId: sessionId,
        decisionAuthority: "system",
        input: { sessionId, symbol: params.symbol, side: params.side, haltedAt } as Record<string, unknown>,
        result: { reason: "dll_halt_sticky", halted_at: haltedAt, blocked: true } as Record<string, unknown>,
        status: "success",
        correlationId,
      }).catch((err: unknown) => logger.error({ err }, "kill_switch.dll_halt_sticky_blocked audit write failed (non-blocking)"));
      openSpan.setAttribute("kill_switch_tripped", true);
      openSpan.setAttribute("kill_switch_reason", "dll_halt_sticky");
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

  // ─── GAP-2 FIX: Block entry when a stuck position exists for this session ──
  // If forceCloseAllPositions could not close a position (no price at all),
  // that session is added to stuckSessionIds. Subsequent openPosition on that
  // session is blocked until the operator manually resolves the stuck position.
  if (stuckSessionIds.has(sessionId)) {
    logger.error(
      { sessionId, symbol: params.symbol },
      "paper-execution: session has unresolved stuck position from force-flatten — blocking new entry",
    );
    dbConn.insert(auditLog).values({
      action: "paper.entry_blocked",
      entityType: "paper_session",
      entityId: sessionId,
      decisionAuthority: "system",
      input: { sessionId, symbol: params.symbol, side: params.side } as Record<string, unknown>,
      result: { reason: "stuck_position", blocked: true } as Record<string, unknown>,
      status: "error",
      correlationId,
    }).catch((err: unknown) => logger.error({ err }, "paper.entry_blocked (stuck_position) audit write failed (non-blocking)"));
    openSpan.setAttribute("kill_switch_tripped", true);
    openSpan.setAttribute("kill_switch_reason", "stuck_position");
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
  // NOTE: dailyPnlBreakdown is written INSIDE the close transaction (M1 fix, deepscan-6).
  // checkConsistencyRule re-reads it after the tx for the consistency check only.
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
        // Read today's daily P&L from dailyPnlBreakdown JSONB.
        // Use CME futures trading-day key (5pm ET cutoff) so this matches the
        // key written by checkConsistencyRule / the dailyPnlBreakdown update.
        const { toFuturesTradingDayString } = await import("./paper-risk-gate.js");
        const today = toFuturesTradingDayString();
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
        // Use CME futures trading-day key so max_trades_per_day aligns with dailyPnlBreakdown keys.
        // Trades closed 17:00–23:59 ET count toward NEXT day's per-day trade limit.
        const todayEtDateStr = toFuturesTradingDayString();
        const [tradesTodayRow] = await dbConn
          .select({ count: sql<number>`count(*)::int` })
          .from(paperTrades)
          .where(and(
            eq(paperTrades.sessionId, sessionId),
            // F2: use entryTime (same convention as compliance gate ~line 1617 and toFuturesTradingDayString).
            // exitTime caused boundary-straddling trades (entered before 17:00 ET, closed after) to count
            // toward the WRONG trading day, silently undercounting or overcounting against the daily cap.
            sql`to_char(${paperTrades.entryTime} AT TIME ZONE 'America/New_York' + interval '7 hours', 'YYYY-MM-DD') = ${todayEtDateStr}`,
          ));
        const tradesToday = tradesTodayRow?.count ?? 0;

        // FIX 3 (B4 MED): Invoke Python kill switch when EITHER loss limit OR trade cap is set.
        // Previously wrapped in `dailyLossLimit > 0`, which silently bypassed maxTradesPerSession
        // enforcement for sessions configured with only a trade cap (no loss limit).
        if (dailyLossLimit > 0 || (maxTradesPerSession !== undefined && maxTradesPerSession > 0)) {
          // Track 3: write one-time threshold-changed audit row on first invocation post-deploy.
          // This creates an audit trail that shows exactly when the 67%/95% thresholds took effect.
          if (!_thresholdAuditWritten) {
            _thresholdAuditWritten = true;
            db.insert(auditLog).values({
              action: "kill_switch.threshold_changed",
              entityType: "system",
              entityId: null,
              decisionAuthority: "system",
              input: {
                old_halt_pct: _PRE_TRACK3_HALT_PCT,
                old_force_close_pct: _PRE_TRACK3_FORCE_CLOSE_PCT,
              } as Record<string, unknown>,
              result: {
                new_halt_pct: _effectiveHaltPct,
                new_force_close_pct: _effectiveForceClosePct,
                env_DLL_HALT_PCT: process.env.DLL_HALT_PCT ?? null,
                env_DLL_FORCE_CLOSE_PCT: process.env.DLL_FORCE_CLOSE_PCT ?? null,
                track: "Track3_StopTPSizing",
                description: "Personal DLL = 67% of firm DLL. Force-close at 95% instead of 100%.",
              } as Record<string, unknown>,
              status: "success",
              correlationId: randomUUID(), // FINDING #8 FIX: non-null correlationId for incident reconstruction
            }).catch((err) => logger.warn({ err }, "kill_switch.threshold_changed audit write failed (non-blocking)"));
          }

          const { runPythonModule } = await import("../lib/python-runner.js");
          const killResult = await runPythonModule<{
            tripped: boolean;
            reason: string | null;
            force_close: boolean;
            daily_pnl_pct: number;
            halt_pct_used: number;
            force_close_pct_used: number;
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
              // Track 3: pass thresholds explicitly so Python and TypeScript stay in sync.
              haltPct: _effectiveHaltPct,
              forceClosePct: _effectiveForceClosePct,
            },
            timeoutMs: 3_000,
            componentName: "kill-switch",
            lane: "execution", // deepscan5 obs-H1: capital-safety path — reserved subprocess lane.
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
              input: {
                force_close: killResult.force_close,
                daily_pnl_pct: killResult.daily_pnl_pct,
                reason: killResult.reason,
                halt_pct_used: killResult.halt_pct_used ?? _effectiveHaltPct,
                force_close_pct_used: killResult.force_close_pct_used ?? _effectiveForceClosePct,
              } as Record<string, unknown>,
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
                    correlationId,
                  });
                }
              })
              .catch((err) => logger.error({ err }, "kill_switch audit/lockout write failed (non-blocking)"));
            broadcastSSE("paper:kill-switch-tripped", {
              sessionId,
              symbol: params.symbol,
              reason: killResult.reason,
              force_close: killResult.force_close,
              daily_pnl_pct: killResult.daily_pnl_pct,
              halt_pct_used: killResult.halt_pct_used ?? _effectiveHaltPct,
              force_close_pct_used: killResult.force_close_pct_used ?? _effectiveForceClosePct,
              correlationId: correlationId ?? null,
            });
            // Track 3: dedicated SSE event when halt threshold (67%) trips but force-close hasn't.
            // Frontend can distinguish "halt new entries" from "force flatten positions".
            if (!killResult.force_close && killResult.reason === "approaching_daily_loss_limit") {
              broadcastSSE("paper:kill-switch-threshold-tripped", {
                sessionId,
                symbol: params.symbol,
                halt_pct: killResult.halt_pct_used ?? _effectiveHaltPct,
                daily_pnl_pct: killResult.daily_pnl_pct,
                message: `New entries blocked: daily loss reached ${((killResult.halt_pct_used ?? _effectiveHaltPct) * 100).toFixed(0)}% of firm DLL. Existing positions held. Force-close triggers at ${((_effectiveForceClosePct) * 100).toFixed(0)}%.`,
                correlationId: correlationId ?? null,
              });
            }

            // ─── GAP-1 FIX: Persist sticky DLL halt flag to session config ────────
            // When the kill switch trips at the 67% halt threshold (not force-close),
            // write dailyLossHaltedAt = CME trading day key into session.config JSONB.
            // Future openPosition calls check this flag BEFORE calling Python, so
            // any P&L recovery below 67% cannot silently re-enable trading for the day.
            // Force-close (95%) sessions already have positions flattened; the sticky
            // flag provides defense-in-depth but the primary protection is forceClose.
            if (!killResult.force_close) {
              // HIGH E-3 fix (deep-scan #16 wave-1 track-3, 2026-07-04): the 67% halt-only
              // trip previously had ZERO Prometheus visibility — no positions close at
              // halt, so nothing else counts this event. reason mirrors the Python
              // KILL_REASON_* constant that fired (approaching_daily_loss_limit is the
              // 67% band; max_trades_per_session / consecutive_loss_limit are the other
              // halt-only reasons from the same check_kill_switch() gate).
              dllHaltTotal.labels({ reason: killResult.reason ?? "unknown" }).inc();
              const todayKeyForSticky = toFuturesTradingDayString();
              // FIX 5 (Track M): retry sticky DLL halt flag write once. If the retry
              // also fails, treat the current entry as fail-closed (return early with
              // a rejection result + CRITICAL log + audit). Without this, a transient
              // DB hiccup leaves the session without a sticky halt flag — the Python
              // kill-switch 5s cache expiry could silently re-enable trading.
              let stickyWriteOk = false;
              for (let attempt = 1; attempt <= 2; attempt++) {
                try {
                  await dbConn.update(paperSessions).set({
                    config: sql`jsonb_set(
                      COALESCE(${paperSessions.config}, '{}'::jsonb),
                      '{dailyLossHaltedAt}',
                      ${JSON.stringify(todayKeyForSticky)}::jsonb
                    )`,
                  }).where(eq(paperSessions.id, sessionId));
                  dbConn.insert(auditLog).values({
                    action: "kill_switch.dll_halt_sticky_engaged",
                    entityType: "paper_session",
                    entityId: sessionId,
                    decisionAuthority: "system",
                    input: { sessionId, daily_pnl_pct: killResult.daily_pnl_pct, halt_pct: killResult.halt_pct_used ?? _effectiveHaltPct } as Record<string, unknown>,
                    result: { halted_at: todayKeyForSticky, daily_pnl_pct: killResult.daily_pnl_pct } as Record<string, unknown>,
                    status: "success",
                    correlationId,
                  }).catch((err: unknown) => logger.error({ err }, "kill_switch.dll_halt_sticky_engaged audit write failed (non-blocking)"));
                  stickyWriteOk = true;
                  break;
                } catch (stickyErr) {
                  if (attempt === 1) {
                    logger.warn(
                      { sessionId, err: stickyErr, attempt },
                      "Kill switch (GAP-1 FIX 5): sticky halt flag write failed — retrying once",
                    );
                  } else {
                    // Second failure: fail-closed — block this entry and escalate.
                    logger.error(
                      { sessionId, err: stickyErr },
                      "CRITICAL: Kill switch (GAP-1 FIX 5): sticky halt flag write failed on retry — fail-closed, blocking entry",
                    );
                    dbConn.insert(auditLog).values({
                      action: "paper.dll_sticky_flag_write_failed_fail_closed",
                      entityType: "paper_session",
                      entityId: sessionId,
                      decisionAuthority: "system",
                      input: { sessionId, daily_pnl_pct: killResult.daily_pnl_pct } as Record<string, unknown>,
                      result: { attempts: 2, reason: stickyErr instanceof Error ? stickyErr.message : String(stickyErr) } as Record<string, unknown>,
                      status: "error",
                      correlationId,
                    }).catch((auditErr: unknown) => logger.error({ err: auditErr }, "paper.dll_sticky_flag_write_failed_fail_closed audit write also failed"));
                    openSpan.setAttribute("kill_switch_tripped", true);
                    openSpan.setAttribute("kill_switch_sticky_write_failed", true);
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
              if (!stickyWriteOk) {
                // Unreachable after the fail-closed return above, but TypeScript needs it.
                logger.error({ sessionId }, "Kill switch (GAP-1 FIX 5): sticky write loop exited without success or fail-closed — should not happen");
              }
            }

            openSpan.setAttribute("kill_switch_tripped", true);
            openSpan.setAttribute("kill_switch_reason", killResult.reason ?? "");
            openSpan.end();

            // C-1 FIX: When force_close===true (95% DLL threshold), flatten all
            // open positions AFTER logging+SSE and BEFORE returning the rejection.
            // Wrap in try/catch — if forceClose throws, log CRITICAL but still
            // return the rejection (never swallow the close failure silently).
            if (killResult.force_close) {
              try {
                logger.error(
                  { sessionId, firmKey, reason: killResult.reason },
                  "Kill switch (D6): force_close=true — calling forceCloseAllPositions(dll_95_force_close)",
                );
                // deepscan17 E-1 fix: thread the caller's correlationId (was silently
                // dropped — a fresh randomUUID() was minted inside forceCloseAllPositions,
                // breaking the openPosition->force-close audit chain).
                // deepscan17 C-1 fix: scope the flatten to THIS session only. The Python
                // D6 kill-switch result is computed per-session (killResult.daily_pnl_pct
                // is this session's own P&L, not an account aggregate) — scoping by
                // sessionId (rather than a resolved accountKey) is the narrowest correct
                // blast radius for a check that was never account-aware in the first place.
                await forceCloseAllPositions("dll_95_force_close", { correlationId, scope: { sessionIds: [sessionId] } });
              } catch (forceCloseErr) {
                // deepscan14 F1: this is the SECOND force-close site (Python
                // compliance-gate D6 path) — it was failing silently (bare logger.error,
                // no Discord, no audit, no timeout) while kill-switch.ts:126-169
                // (_confirmedForceClose, "Track M") already had the full CRITICAL
                // escalation. Mirror that pattern here so both sites are equally safe.
                // Distinct audit action (paper.force_flatten_d6_failed vs
                // paper.force_flatten_kill_switch_failed) keeps the two sites queryable.
                const forceCloseErrMsg = forceCloseErr instanceof Error ? forceCloseErr.message : String(forceCloseErr);
                logger.error(
                  { sessionId, firmKey, err: forceCloseErr },
                  "CRITICAL: Kill switch (D6) forceCloseAllPositions threw — positions may remain open. Manual flatten required.",
                );
                AlertFactory.systemError(
                  "paper-force-flatten-d6-failed",
                  new Error(
                    `forceCloseAllPositions failed: ${forceCloseErrMsg}. Reason: ${killResult.reason}. ` +
                    `SessionId: ${sessionId}. CorrelationId: ${correlationId}. ` +
                    `IMMEDIATE ACTION REQUIRED — manually close all open positions.`
                  )
                );
                await insertAuditRowSafe({
                  action: "paper.force_flatten_d6_failed",
                  entityType: "paper_session",
                  entityId: sessionId,
                  decisionAuthority: "system",
                  input: { sessionId, firmKey, reason: killResult.reason } as Record<string, unknown>,
                  result: { error: forceCloseErrMsg, positions_may_be_open: true } as Record<string, unknown>,
                  status: "error",
                  correlationId,
                });
              }
            }

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
          correlationId,
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
                correlationId,
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
    // ── Stage 1: freshness (cached per firmKey for 60s) ────────────────────
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
        lane: "execution", // deepscan5 obs-H1: compliance gate on the entry path — reserved lane.
      });

      cached = {
        fresh: freshnessResult.fresh,
        freshnessStatus: freshnessResult.status,
        freshnessMessage: freshnessResult.message,
        driftDetected: !!freshnessResult.drift_detected,
        rulesetPayload,
        cachedAt: Date.now(),
      };
      complianceCache.set(complianceCacheKey, cached);
    }

    // Block on stale / drifted ruleset before running violation check.
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
        correlationId,
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

    // ── Stage 2: violation check — ALWAYS run fresh (never cached) ────────
    // Dynamic per-order fields (trades_today, open_positions, account_balance,
    // intended_max_loss, proposed_symbol) change every call.  Caching these
    // would allow MFFU 2% rule / HFT limit / hedging-ban checks to silently
    // bypass on subsequent orders within the same 60s window.
    if (Object.keys(cached.rulesetPayload).length > 0) {
      // ── Compute strategyState fields ────────────────────────────────────
      // intended_max_loss: stop_distance × contracts × pointValue
      // Use ATR-based stop if ATR is available; fall back to firm ceiling (conservative).
      const specForStop = CONTRACT_SPECS[params.symbol as keyof typeof CONTRACT_SPECS];
      const pointValue = specForStop?.pointValue ?? 5;
      // Firm stop ceiling per CLAUDE.md §4 and framework-overlay conventions.
      // Wave 1 Track 1B: read from canonical getStopCeilingPts() (env-var-backed,
      // mirrors Python _STOP_CEILING_TABLE: MES=14, MNQ=62, MCL=1.00pt).
      const stopCeilingPts = getStopCeilingPts(params.symbol);
      // If ATR is provided: stop distance = 1.5 × ATR (floor per §4), capped at ceiling.
      // If ATR is absent: use ceiling as conservative upper bound.
      const stopDistancePts = params.atr
        ? Math.min(1.5 * params.atr, stopCeilingPts)
        : stopCeilingPts;
      const intendedMaxLoss = stopDistancePts * params.contracts * pointValue;

      // account_balance: current session equity; fall back to startingCapital
      const accountBalance = session.currentEquity != null
        ? Number(session.currentEquity)
        : Number(session.startingCapital ?? 50000);

      // trades_today: trades opened (entryTime) by ANY paper_trades row joined
      // to paper_sessions WHERE firmId matches AND entryTime >= start of CME day (UTC).
      // CME day starts 17:00 ET prior evening = today 21:00 UTC (22:00 UTC during DST).
      // Use toFuturesTradingDayString() + the same +7h shift logic used by the kill switch
      // to count only today's CME-day trades.
      const { toFuturesTradingDayString: getTodayKey } = await import("./paper-risk-gate.js");
      const todayKey = getTodayKey();
      const [tradesTodayFirmRow] = await dbConn
        .select({ count: sql<number>`count(*)::int` })
        .from(paperTrades)
        .innerJoin(paperSessions, eq(paperTrades.sessionId, paperSessions.id))
        .where(and(
          eq(paperSessions.firmId, firmKey),
          sql`to_char(${paperTrades.entryTime} AT TIME ZONE 'America/New_York' + interval '7 hours', 'YYYY-MM-DD') = ${todayKey}`,
        ));
      const tradesToday = tradesTodayFirmRow?.count ?? 0;

      // open_positions: all open positions across all sessions of this firm.
      // Used by hedging-ban check (counterpart instrument detection).
      const openPositionsRaw = await dbConn
        .select({
          symbol: paperPositions.symbol,
          side: paperPositions.side,
          contracts: paperPositions.contracts,
        })
        .from(paperPositions)
        .innerJoin(paperSessions, eq(paperPositions.sessionId, paperSessions.id))
        .where(and(
          eq(paperSessions.firmId, firmKey),
          isNull(paperPositions.closedAt),
        ));
      const openPositionsList = openPositionsRaw.map(p => ({
        symbol: p.symbol,
        side: p.side,
        contracts: p.contracts,
      }));

      const strategyState = {
        automated: true,
        account_phase: (sessionConfigForCompliance?.account_phase as string) ?? "pa",
        host: (sessionConfigForCompliance?.host as string) ?? process.env.TF_HOST_TAG ?? "local",
        pa_account_count: (sessionConfigForCompliance?.pa_account_count as number) ?? 1,
        // MFFU 2% per-trade rule
        intended_max_loss: intendedMaxLoss,
        account_balance: accountBalance,
        // MFFU HFT limit (500 trades/day, firm-level)
        trades_today: tradesToday,
        // MFFU hedging ban
        open_positions: openPositionsList,
        proposed_symbol: params.symbol,
      };

      const { runPythonModule } = await import("../lib/python-runner.js");

      const violationResult = await runPythonModule<{
        violation: boolean;
        status: string;
        message: string;
        violations: string[];
      }>({
        module: "src.engine.compliance.compliance_gate",
        config: {
          action: "check_violation",
          firm: firmKey,
          ruleset: cached.rulesetPayload,
          strategy_state: strategyState,
        },
        timeoutMs: 3_000,
        componentName: "compliance-gate-paper-violation",
        lane: "execution", // deepscan5 obs-H1: compliance gate on the entry path — reserved lane.
      });

      if (violationResult.violation) {
        logger.error(
          { sessionId, symbol: params.symbol, status: violationResult.status, violations: violationResult.violations },
          "Compliance gate (C5): BLOCKING order — hard violation detected",
        );
        broadcastSSE("alert:compliance_gate_blocked", {
          sessionId,
          symbol: params.symbol,
          firm: firmKey,
          stage: "violation",
          status: violationResult.status,
          message: violationResult.message,
          violations: violationResult.violations,
          correlationId,
        });
        db.insert(auditLog).values({
          action: "compliance.gate_blocked",
          entityType: "paper_session",
          entityId: sessionId,
          decisionAuthority: "system",
          input: { firm: firmKey, reason: violationResult.message, symbol: params.symbol } as Record<string, unknown>,
          result: { blocked_at: new Date().toISOString() } as Record<string, unknown>,
          status: "blocked",
          correlationId,
        }).catch((err) => logger.error({ err }, "compliance_gate_blocked audit insert failed (non-blocking)"));
        openSpan.setAttribute("compliance_blocked", true);
        openSpan.setAttribute("compliance_stage", "violation");
        openSpan.setAttribute("compliance_status", violationResult.status);
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
      correlationId,
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
      broadcastSSE("paper:fill-miss", { sessionId, symbol: params.symbol, fillProb, orderType, correlationId });
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
  // FINDING #4 FIX: prefer the rolling medianAtr14 passed by the caller (matches
  // np.nanmedian from the Python slippage model) over the constant 0.85× estimate.
  // When medianAtr14 is absent (legacy callers, tests), fall back to 0.85× (prior behaviour).
  const medianAtrEstimate = params.medianAtr14 ?? (params.atr ? params.atr * 0.85 : undefined);
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

  const slippageSession = toSlippageSession(sessionAtOrder); // F10: centralized remap
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

  // ── Wave 25.5 Track 1 Gap A: compute adaptive exit plan before INSERT ────────
  // If exit_style="adaptive" and adaptiveExitInput is provided, compute and persist
  // the ExitPlan in the exit_plan column at INSERT time. Fail-soft: any error falls
  // back to static_styleC for this position (never blocks the trade).
  let exitPlanForInsert: ExitPlanWithRuntimeState | null = null;
  // F8: defer the signal.exit_plan_persisted audit write until after the position INSERT
  // so entityId can carry the real position.id (prior code wrote entityId: null).
  // Payload is captured here and the write fires immediately after .returning().
  let pendingExitPlanAudit: {
    strategy_id: string;
    tp1_source: string;
    tp1_level_type: string | null;
    runner_trail_method: string;
    scaling: { tp1_pct: number; tp2_pct: number; runner_pct: number };
  } | null = null;
  const adaptiveInput = params.adaptiveExitInput;
  const exitStyle = adaptiveInput?.strategy?.exit_plan_config?.exit_style ?? "static_styleC";

  if (exitStyle === "adaptive" && adaptiveInput != null) {
    try {
      const exitPlanRaw: ExitPlan = await computeExitPlan({
        strategy: {
          id: adaptiveInput.strategy.id,
          // Satisfy ExitPlanInput.strategy.exit_plan_config: ExitPlanConfig | null | undefined
          exit_plan_config: adaptiveInput.strategy.exit_plan_config ?? null,
        },
        entry: {
          price: actualEntry,
          stop: adaptiveInput.entry.stop,
          direction: params.side,
          timestamp: params.barTimestamp ?? new Date(),
        },
        symbol: params.symbol,
        bar: {
          close: adaptiveInput.bar.close,
          high: adaptiveInput.bar.high,
          low: adaptiveInput.bar.low,
          volume: adaptiveInput.bar.volume,
          ts_event: params.barTimestamp ?? new Date(),
        },
        marketState: {
          regime: adaptiveInput.marketState.regime,
          narrativePhase: adaptiveInput.marketState.narrativePhase,
          atr: params.atr ?? 0,
        },
        weightedScore: adaptiveInput.weightedScore,
        correlationId: correlationId ?? undefined,
      });

      // Extend ExitPlan with empty runtime_state for per-bar trail updates (Gap C)
      exitPlanForInsert = {
        ...exitPlanRaw,
        runtime_state: {},
      } as ExitPlanWithRuntimeState;

      // F8: capture audit payload — will fire after position INSERT with the real position.id
      pendingExitPlanAudit = {
        strategy_id: adaptiveInput.strategy.id,
        tp1_source: exitPlanRaw.tp1.source,
        tp1_level_type: exitPlanRaw.tp1.level_type ?? null,
        runner_trail_method: exitPlanRaw.runner.trail_method,
        scaling: {
          tp1_pct: exitPlanRaw.scaling.tp1_pct,
          tp2_pct: exitPlanRaw.scaling.tp2_pct,
          runner_pct: exitPlanRaw.scaling.runner_pct,
        },
      };
    } catch (exitPlanErr) {
      // Fail-soft: computeExitPlan threw (e.g. liquidity service unavailable).
      // Log + fall through to static_styleC for this position.
      const reason = exitPlanErr instanceof Error ? exitPlanErr.message : String(exitPlanErr);
      logger.warn(
        { sessionId, symbol: params.symbol, side: params.side, err: reason },
        "Wave25.5: computeExitPlan threw — falling back to static_styleC for this position (fail-soft)",
      );
      db.insert(auditLog).values({
        action: "signal.exit_plan_fallback_static",
        entityType: "paper_position",
        entityId: null,
        decisionAuthority: "system",
        input: { sessionId, symbol: params.symbol } as Record<string, unknown>,
        result: { reason, fallback: "static_styleC" } as Record<string, unknown>,
        status: "failure",
        correlationId,
      }).catch((err) => logger.warn({ err }, "signal.exit_plan_fallback_static audit write failed (non-blocking)"));
      exitPlanForInsert = null;
    }
  } else if (exitStyle === "static_styleC" && adaptiveInput != null) {
    // ── F-b parity fix: static_styleC TP2 = flat +2.0R ─────────────────────────
    // CLAUDE.md §4 canonical: static Style C TP2 ALWAYS = +2.0R flat.
    // Liquidity-mapped TPs belong exclusively to exit_style="adaptive".
    // Prior code (Wave 1 Track 1B) injected a liquidity-mapped TP2 within [1.4R..2.6R],
    // causing paper TP2 to fire at a different price than Python style_c_handler.py
    // (which always uses TP2_AT_R_C = 2.0), inflating or deflating paper Sharpe
    // vs backtest (paper/backtest parity gap F-b).
    // Storing the flat +2.0R price enables the C2 intrabar TP2 touch-detection
    // path in updatePositionPrices without spawning a Python subprocess.
    try {
      const stopDistance = Math.abs(actualEntry - adaptiveInput.entry.stop);

      if (stopDistance > 0) {
        const tp2Price = params.side === "long"
          ? actualEntry + 2.0 * stopDistance
          : actualEntry - 2.0 * stopDistance;

        exitPlanForInsert = {
          static_styleC_tp2_price: tp2Price,
          static_styleC_tp2_source: "r_multiple",
          static_styleC_tp2_level_type: null,
          static_styleC_tp2_r_multiple: 2.0,
          runtime_state: {},
        } as unknown as import("../db/jsonb-shapes.js").ExitPlanWithRuntimeState;

        db.insert(auditLog).values({
          action: "signal.static_styleC_tp2_flat_2r",
          entityType: "paper_position",
          entityId: null,
          decisionAuthority: "system",
          input: {
            sessionId,
            symbol: params.symbol,
            side: params.side,
            entry_price: actualEntry,
            stop_distance: stopDistance,
          } as Record<string, unknown>,
          result: {
            tp2_price: tp2Price,
            tp2_r_multiple: 2.0,
            tp2_source: "r_multiple",
          } as Record<string, unknown>,
          status: "success",
          correlationId,
        }).catch((err) => logger.warn({ err }, "signal.static_styleC_tp2 audit write failed (non-blocking)"));
      }
    } catch (tp2Err) {
      const reason = tp2Err instanceof Error ? tp2Err.message : String(tp2Err);
      logger.warn(
        { sessionId, symbol: params.symbol, err: reason },
        "static_styleC TP2 flat-2R computation failed — Python +2.0R fallback will apply",
      );
      exitPlanForInsert = null; // no stored TP2 → Python handles TP2 at 2.0R
    }
  }

  // BL-1 / FINDING #7 FIX: compute initial stop price at entry for intrabar stop-breach detection.
  //
  // Precedence:
  //   (1) adaptiveExitInput.entry.stop — structural stop derived by the strategy before calling openPosition
  //   (2) params.atr × 2.0             — ATR-based structural stop (standard BreakerStrategy sl_mult=2.0)
  //   (3) CONTRACT_SPECS[symbol].tickSize × 16 — last-resort structural floor so live positions NEVER
  //       have null initialStopPrice, which would cause updatePositionPrices to skip stop-breach detection
  //       indefinitely. 16-tick fallback is deliberately tight (not permissive) — a loose stop would let
  //       a runaway position escape the intrabar guard. Tight-but-wrong is safer than no stop at all.
  //       This fires only when both ATR and adaptive stop are absent (first bars of a session where the
  //       ATR series has not yet warmed up). Writes a warn log so the operator sees it.
  //
  // INVARIANT: initialStopPriceForInsert must NEVER be null for a live position.
  const initialStopPriceForInsert: number = (() => {
    if (params.adaptiveExitInput?.entry.stop != null) {
      return params.adaptiveExitInput.entry.stop;
    }
    if (params.atr != null && params.atr > 0) {
      const stopPts = params.atr * 2.0;
      return params.side === "long" ? actualEntry - stopPts : actualEntry + stopPts;
    }
    // Fallback: derive stop from contract tick size when ATR is not yet available.
    const specForStop = CONTRACT_SPECS[params.symbol as keyof typeof CONTRACT_SPECS];
    const fallbackStopPts = (specForStop?.tickSize ?? 0.25) * 16;
    const fallbackStop = params.side === "long" ? actualEntry - fallbackStopPts : actualEntry + fallbackStopPts;
    logger.warn(
      { sessionId, symbol: params.symbol, side: params.side, fallbackStop, fallbackStopPts },
      "paper-execution: initialStopPrice derived from tickSize×16 fallback (ATR not yet available at entry). " +
      "Stop breach detection will be conservative until ATR warms up.",
    );
    return fallbackStop;
  })();

  // F9: capture entry-time macroRegime for journal replay-correctness.
  // closePosition reads pos.exitPlan.entryRegime instead of querying the latest snapshot at
  // close time, so the journal reflects the regime at entry (not exit). Fail-soft.
  let entryMacroRegimeCapture: string | null = null;
  try {
    const [macroSnap] = await dbConn
      .select({ macroRegime: macroSnapshots.macroRegime })
      .from(macroSnapshots)
      .orderBy(desc(macroSnapshots.snapshotDate))
      .limit(1);
    entryMacroRegimeCapture = macroSnap?.macroRegime ?? null;
  } catch { /* non-blocking — journal enrichment degrades gracefully */ }

  // Merge entryRegime + entryContext into the exitPlan JSONB blob. JSONB accepts
  // arbitrary JSON; both extra fields sit alongside the typed ExitPlan fields with
  // no migration needed (entryRegime is the pre-existing F9 pattern; entryContext is
  // the trade-critique data bridge added 2026-07-05 — see EntryDecisionContext in
  // jsonb-shapes.ts). Byte-identical to prior behavior when both are absent.
  const exitPlanForDb: ExitPlanWithRuntimeState | undefined =
    (entryMacroRegimeCapture != null || params.entryContext != null)
      ? ({
          ...(exitPlanForInsert ?? {}),
          ...(entryMacroRegimeCapture != null ? { entryRegime: entryMacroRegimeCapture } : {}),
          ...(params.entryContext != null ? { entryContext: params.entryContext } : {}),
        } as unknown as ExitPlanWithRuntimeState)
      : (exitPlanForInsert ?? undefined);

  // HIGH-5 TOCTOU re-check (deep-scan 2026-07-09, ratified): the kill switch was checked
  // ONCE at openPosition entry (~line 752), but ~1400 lines of work run before this fill
  // write — session lock, GAP checks, and the two-stage compliance gate (whose freshness
  // check alone budgets a 3s Python subprocess). Production mode can flip to HALT, or the
  // account can cross a DLL/CME-outage/firm-suspension threshold, inside that window, and
  // the already-in-flight order would fill un-rechecked. Re-check immediately before the
  // transaction commit — cheap (5s in-memory cache, KillSwitch.CACHE_TTL_MS). Fail-CLOSED
  // on read error (block the fill) — a broken kill-switch read must not let an order slip.
  try {
    if (await killSwitch.isHaltedForProduction({ correlationId, accountKey: context?.accountKey, firmId: context?.firmId })) {
      logger.warn(
        { fn: "openPosition", sessionId, symbol: params.symbol, side: params.side, reason: "production_mode_halt_toctou" },
        "paper-execution.production-halted (TOCTOU): kill switch tripped between entry check and fill write — blocking fill",
      );
      db.insert(auditLog).values({
        action: "paper.entry_blocked",
        entityType: "paper_session",
        entityId: sessionId,
        decisionAuthority: "system",
        input: { sessionId, symbol: params.symbol, side: params.side } as Record<string, unknown>,
        result: { reason: "production_halt_toctou", blocked: true, stage: "pre_fill_write" } as Record<string, unknown>,
        status: "success",
        correlationId,
      }).catch((err) => logger.error({ err }, "paper-execution: TOCTOU halt audit_log write failed (non-blocking)"));
      broadcastSSE("paper:entry-blocked-production-halt", { sessionId, symbol: params.symbol, side: params.side, reason: "production_halt_toctou", correlationId });
      return {
        position: null,
        executionResult: {
          positionId: "", entryPrice: 0, contracts: params.contracts, slippage: 0,
          expectedPrice: params.signalPrice, actualPrice: 0, arrivalPrice: params.signalPrice,
          implementationShortfall: 0, fillRatio: 0, filled: false,
        } satisfies ExecutionResult,
      };
    }
  } catch (err) {
    logger.error({ err, fn: "openPosition", sessionId, symbol: params.symbol }, "paper-execution: TOCTOU kill-switch re-check read error — failing CLOSED (blocking fill)");
    broadcastSSE("paper:entry-blocked-production-halt", { sessionId, symbol: params.symbol, side: params.side, reason: "production_halt_toctou_read_error", correlationId });
    return {
      position: null,
      executionResult: {
        positionId: "", entryPrice: 0, contracts: params.contracts, slippage: 0,
        expectedPrice: params.signalPrice, actualPrice: 0, arrivalPrice: params.signalPrice,
        implementationShortfall: 0, fillRatio: 0, filled: false,
      } satisfies ExecutionResult,
    };
  }

  // FIX 3 (Track M): wrap position INSERT + paper.trade_open audit INSERT in a single
  // transaction so they are atomic. Previously a crash between the two writes left an
  // open paper_positions row with no audit trail — the promotion gate has no evidence
  // the trade was actually entered and the journal is incomplete for replay.
  // SHADOW-signal insert and SSE/Discord stay OUTSIDE (observability, fail-soft).
  const [position] = await dbConn.transaction(async (tx) => {
    const [pos] = await tx.insert(paperPositions).values({
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
    // Wave 25.5 Track 1: persist adaptive exit plan when available (exitPlanForDb carries entryRegime via F9)
    exitPlan: exitPlanForDb,
    // BL-1 / H-1 fix (migration 0179): initialise stop and running high/low at entry
    // FINDING #7 FIX: always a number now (never null) — guaranteed by fallback logic above.
    initialStopPrice: String(initialStopPriceForInsert),
    highSinceEntryPrice: String(actualEntry),
    lowSinceEntryPrice: String(actualEntry),
    // BL-9 (migration 0180): persist the entry correlation_id so closePosition() can
    // recover the signal→trade trace when invoked externally (force-close, time-stop).
    correlationId,
  }).returning();
    // Audit trail — paper.trade_open inside the transaction so position row and
    // audit row are atomically consistent. Failure rolls back both writes.
    await tx.insert(auditLog).values({
      action: "paper.trade_open",
      entityType: "paper_position",
      entityId: pos.id,
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
    return [pos];
  });

  // F8: write signal.exit_plan_persisted audit NOW that position.id is known.
  // Prior code wrote entityId: null because the INSERT hadn't run yet at audit time.
  if (pendingExitPlanAudit != null) {
    db.insert(auditLog).values({
      action: "signal.exit_plan_persisted",
      entityType: "paper_position",
      entityId: position.id,
      decisionAuthority: "system",
      input: {
        sessionId,
        strategy_id: pendingExitPlanAudit.strategy_id,
        symbol: params.symbol,
      } as Record<string, unknown>,
      result: {
        tp1_source: pendingExitPlanAudit.tp1_source,
        tp1_level_type: pendingExitPlanAudit.tp1_level_type,
        runner_trail_method: pendingExitPlanAudit.runner_trail_method,
        scaling: pendingExitPlanAudit.scaling,
      } as Record<string, unknown>,
      status: "success",
      correlationId,
    }).catch((err) => logger.warn({ err, positionId: position.id }, "signal.exit_plan_persisted audit write failed (non-blocking)"));
  }

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

  // ds21 (deep-scan #21 Band D): thread correlationId (in scope) onto the highest-value
  // reconstruction event so bar→handler→DB→SSE→audit stays correlatable for a position open.
  broadcastSSE("paper:position-opened", {
    sessionId,
    position,
    executionQuality: executionResult,
    correlationId,
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

  // paper.trade_open audit is now inside the openPosition transaction above (FIX 3).

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
export async function closePosition(positionId: string, exitSignalPrice: number, atr?: number, context?: { correlationId?: string; barTimestamp?: Date; medianAtr?: number; forceClosePriceUnconfirmed?: boolean; outcomeOverride?: string }) {
  // BL-9: declared as let so it can be resolved from the position row after the DB read.
  // Callers that do supply context.correlationId (inline signal processing) use that value;
  // external callers (force-close, time-stop) fall back to pos.correlationId persisted at open.
  // If neither is available (positions predating migration 0180), a fresh UUID is generated
  // so every trade row always has a non-null correlation_id.
  let correlationId: string | null = context?.correlationId ?? null;
  // M-4: when the exit price is an unconfirmed proxy (e.g. emergency force-flatten
  // falling back to entryPrice → zero-PnL), stamp the trade_close audit so the
  // promotion gate can DETECT and exclude/flag sessions whose paper_sessions.finalPnl
  // was contaminated by proxy-priced closes. A future TradersPost fill-confirmation
  // webhook would reconcile the real broker exit price and clear this flag.
  const forceClosePriceUnconfirmed = context?.forceClosePriceUnconfirmed === true;
  // HIGH E-2 fix (deep-scan #16 wave-1 track-3, 2026-07-04): callers that need a more
  // specific outcome label than the default win/loss classification (TIME_STOP_FLATTEN,
  // intrabar stop breach, force-close) pass outcomeOverride instead of incrementing
  // paperTradesCounter a SECOND time themselves — see the single increment site below.
  const outcomeOverride = context?.outcomeOverride;
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

  // BL-9: resolve correlationId now that we have the position row.
  // Priority: context caller → persisted entry id → fresh UUID (positions pre-0180).
  if (correlationId == null) {
    correlationId = pos.correlationId ?? randomUUID();
  }

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
  const exitSlippageSession = toSlippageSession(sessionAtClose); // F10: centralized remap
  // BL-8 fix: use rolling median ATR from context when available (passed from exitBarContext.medianAtr14).
  // Falls back to atr * 0.85 estimate when no rolling median is provided (legacy callers, tests, forceClose).
  // The backtest uses np.nanmedian(atr_values) over the full bar series; rolling median over last 100 bars
  // is a live approximation that removes the constant-ratio distortion of the 0.85 hack.
  const medianAtrEstimate = context?.medianAtr ?? (atr ? atr * 0.85 : undefined);
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
  // Wave 27.5 Pass D.2: symbol-aware lookup via contract-class.ts.
  // Resolves micro ($0.37-$0.62/side) vs mini ($3.70-$6.20/side) per symbol + firm.
  // Falls back to $0.62/side when symbol class or firmId is unknown (conservative —
  // avoids overstating net P&L; same fallback as the legacy helper).
  const commissionPerSide = getCommissionPerSideBySymbol(pos.symbol, sessionForFirm?.firmId ?? null);
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

  // F9: macroRegime — prefer entry-time regime stored in pos.exitPlan.entryRegime.
  // This was stamped at openPosition() so the journal reflects the regime AT ENTRY,
  // not at close time. Falls back to the latest snapshot for positions predating F9.
  let macroRegime: string | null = null;
  try {
    const entryRegime = (pos.exitPlan as unknown as Record<string, unknown> | null)?.entryRegime;
    if (typeof entryRegime === "string" && entryRegime.length > 0) {
      macroRegime = entryRegime;
    } else {
      // Fallback: query latest snapshot (pre-F9 positions or no exitPlan)
      const [snap] = await dbConn.select({ macroRegime: macroSnapshots.macroRegime })
        .from(macroSnapshots)
        .orderBy(desc(macroSnapshots.snapshotDate))
        .limit(1);
      macroRegime = snap?.macroRegime ?? null;
    }
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

  // H5 fix (2026-06-23): audit INSERT moved INSIDE the transaction so the trade
  // close and its audit row commit atomically.  If the audit INSERT fails, the
  // entire transaction rolls back (fail-CLOSED: better to retry the close than
  // to commit a trade with no audit record → orphan).
  //
  // On transaction rollback we emit a SEPARATE out-of-transaction
  // paper.trade_close_audit_failed row + notifyCritical Discord so the operator
  // can identify and manually reconcile the open position.
  let trade: typeof paperTrades.$inferSelect | null;
  try {
    const [tradeRow] = await dbConn.transaction(async (tx) => {
      // 0. IDEMPOTENCY CLAIM (deep-scan CRIT-1, operator-ratified 2026-07-09):
      //    Atomically CLAIM the close, guarded by isNull(closedAt), BEFORE inserting
      //    the trade. This is LOCK-FLAG-INDEPENDENT (works whether or not
      //    TF_POSITION_LOCKING is on — db-locks.ts is a no-op by default). If a
      //    concurrent path already closed this position — the real race being a
      //    per-symbol stop/trail/time-exit and a cross-symbol 95%-DLL
      //    forceCloseAllPositions() both calling closePosition(sameId) in the same
      //    async tick window — the UPDATE matches 0 rows and we abort with NO
      //    duplicate paper_trades row, NO doubled equity/totalTrades, NO second audit.
      const claimed = await tx
        .update(paperPositions)
        .set({
          closedAt,
          currentPrice: String(actualExit),
          unrealizedPnl: "0",
        })
        .where(and(eq(paperPositions.id, positionId), isNull(paperPositions.closedAt)))
        .returning({ id: paperPositions.id });

      if (claimed.length === 0) {
        // Lost the close race — another path already closed this position. Abort the
        // transaction body (nothing inserted yet) and signal a benign idempotent no-op.
        return [null];
      }

      // 1. Insert closed trade — pnl column holds NET P&L; grossPnl and commission stored for audit/analytics
      const [insertedTrade] = await tx.insert(paperTrades).values({
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
        // BL-9 (migration 0180): end-to-end signal→trade trace.
        // Always non-null after migration 0180 (resolved above from context / pos.correlationId / fresh UUID).
        correlationId,
      }).returning();

      // 2. (removed) Position close is now done atomically by the step-0 idempotency
      //    CLAIM above (guarded by isNull(closedAt)) — re-updating here would be
      //    redundant and would defeat the claim's 0-row guard.

      // 3. Update session equity atomically using NET P&L — prevents read-modify-write race on
      //    concurrent closes. totalTrades is incremented here so it always matches trade rows.
      //
      // W12 Bug #2 fix: realizedPeakEquity is the authoritative trailing-DD HWM per
      // Topstep/Apex EOD spec — updated from CLOSED equity only (never from MTM).
      // peakEquity is retained as a UI display column (MTM HWM for the dashboard).
      // Trailing-DD compliance reads realizedPeakEquity, not peakEquity.
      await tx.update(paperSessions).set({
        currentEquity: sql`${paperSessions.currentEquity}::numeric + ${netPnl}`,
        peakEquity: sql`GREATEST(${paperSessions.peakEquity}::numeric, ${paperSessions.currentEquity}::numeric + ${netPnl})`,
        realizedPeakEquity: sql`GREATEST(${paperSessions.realizedPeakEquity}::numeric, ${paperSessions.currentEquity}::numeric + ${netPnl})`,
        totalTrades: sql`COALESCE(${paperSessions.totalTrades}, 0) + 1`,
      }).where(eq(paperSessions.id, pos.sessionId));

      // 4. Audit trail — INSIDE transaction so trade close + audit are atomic.
      //    If this INSERT fails the whole transaction rolls back (fail-CLOSED).
      await tx.insert(auditLog).values({
        action: "paper.trade_close",
        entityType: "paper_trade",
        entityId: insertedTrade.id,
        input: { positionId },
        result: {
          exitPrice: actualExit,
          netPnl,
          grossPnl,
          commission,
          rollSpreadCost: rollCost.estimatedSpreadCost,
          rollDates: rollCost.rollDates,
          // M-4: contamination marker — true when exitPrice is an unconfirmed proxy
          // (emergency force-flatten entryPrice fallback → zero-PnL row). Promotion
          // gate consumers query this to flag/exclude affected sessions' finalPnl.
          ...(forceClosePriceUnconfirmed ? { force_close_price_unconfirmed: true } : {}),
        },
        status: "success",
        decisionAuthority: "agent",
        correlationId,
      });

      // 5. Daily P&L breakdown — inside tx so DLL gates see accurate realized P&L even on crash.
      //    M1 fix (deepscan-6): was written outside the tx via checkConsistencyRule (non-blocking).
      //    checkConsistencyRule now only re-reads the already-committed value for its consistency check.
      {
        const todayKey = toFuturesTradingDayString();
        const jsonPath = `{${todayKey}}`;
        await tx.update(paperSessions).set({
          dailyPnlBreakdown: sql`jsonb_set(
            COALESCE(${paperSessions.dailyPnlBreakdown}, '{}'::jsonb),
            ${jsonPath}::text[],
            (COALESCE((${paperSessions.dailyPnlBreakdown}->>${todayKey})::numeric, 0) + ${netPnl})::text::jsonb
          )`,
        }).where(eq(paperSessions.id, pos.sessionId));
      }

      return [insertedTrade];
    });
    trade = tradeRow ?? null;
  } catch (txErr) {
    // Transaction rolled back — trade close and audit both failed atomically.
    // Emit a SEPARATE observability row (out-of-transaction, best-effort) so the
    // operator can identify the orphaned open position that needs manual reconciliation.
    logger.error(
      { positionId, err: txErr, correlationId },
      "H5: paper.trade_close transaction rolled back (trade close + audit both failed) — position may still be open",
    );
    try {
      await dbConn.insert(auditLog).values({
        action: "paper.trade_close_audit_failed",
        entityType: "paper_position",
        entityId: positionId,
        input: { positionId, correlationId },
        result: { err: txErr instanceof Error ? txErr.message : String(txErr) },
        status: "failure",
        decisionAuthority: "agent",
        correlationId,
      });
    } catch (observabilityErr) {
      logger.error(
        { positionId, err: observabilityErr, correlationId },
        "H5: failed to write paper.trade_close_audit_failed observability row",
      );
    }
    // Fire Discord CRITICAL — operator must manually reconcile the position.
    const discordBody = appendFamilyGradePostscript(
      `Bot tried to close a trade but the audit record failed. Position ${positionId} may still be open. CorrelationId: ${correlationId ?? "none"}.`,
      "Tony needs to check this — the trade may need manual reconciliation.",
      "Check the dashboard for any open paper_trades that should be closed.",
    );
    notifyCritical(
      "paper.trade_close transaction failed — position may be open",
      discordBody,
      { positionId, correlationId: correlationId ?? null, errorType: "trade_close_tx_rollback" },
    );
    throw txErr;
  }

  // ─── CRIT-1 idempotent no-op: position was already closed by a concurrent path ──
  // The step-0 CLAIM matched 0 rows (the double-close race). This is BENIGN — the
  // real close (trade row, equity, audit) already happened exactly once on the winning
  // path. Return a zero-effect result (no error, no Discord, no proven-trades increment)
  // so callers that raced to close see a clean "already closed" outcome, not a duplicate.
  if (trade === null) {
    logger.info(
      { positionId, correlationId },
      "closePosition: position already closed by a concurrent path — idempotent no-op (no duplicate trade/equity)",
    );
    return {
      trade: null,
      pnl: 0,
      grossPnl: 0,
      commission: 0,
      slippage: 0,
      rollSpreadCost: 0,
      alreadyClosed: true as const,
    };
  }

  // ─── Proven-trades counter (fail-soft, never blocks close) ─────────────────
  // Monotonic invariant: only increments, never decrements. Counter survives
  // withdrawals because it is per-session, not per-equity-level.
  // Only winning trades (net realized P&L strictly > 0) are counted.
  // Uses atomic SQL increment to avoid read-modify-write races.
  if (netPnl > 0) {
    try {
      const [updatedSession] = await dbConn
        .update(paperSessions)
        .set({
          provenTradesCount: sql`${paperSessions.provenTradesCount} + 1`,
        })
        .where(eq(paperSessions.id, pos.sessionId))
        .returning({ provenTradesCount: paperSessions.provenTradesCount });

      logger.info(
        {
          sessionId: pos.sessionId,
          positionId,
          netPnl,
          provenTradesCount: updatedSession?.provenTradesCount ?? "unknown",
        },
        "sizing.proven_trade_recorded: winning close incremented proven_trades_count",
      );
    } catch (provenTradeErr) {
      // Fail-soft: counter update failure must NOT block the close.
      // The trade is already committed; this is a best-effort side-effect.
      logger.error(
        { sessionId: pos.sessionId, positionId, netPnl, err: provenTradeErr },
        "proven_trades_count increment failed (non-blocking) — close proceeds",
      );
    }
  }

  // Re-read session after atomic update for downstream logic
  const [session] = await dbConn.select().from(paperSessions).where(eq(paperSessions.id, pos.sessionId));
  if (session) {
    // Gap 4: Consistency rule check + daily P&L tracking (net P&L — matches what the firm sees)
    // Wrapped individually so one failure doesn't block the other or the SSE broadcast.
    try {
      await checkConsistencyRule(session);
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

  // SSE broadcast always fires if the transaction succeeded — not gated on post-close checks.
  // Wave hardening 2026-06-22, correlation_id traceability: include correlationId so the
  // dashboard fill notification can be tied back to the audit row and trade row for
  // post-hoc reconstruction (correlationId is the same value written to the close
  // audit row above — paper.trade_close).
  broadcastSSE("paper:trade", {
    trade,
    pnl: netPnl,
    grossPnl,
    commission,
    rollSpreadCost: rollCost.estimatedSpreadCost,
    correlationId: correlationId ?? null,
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
      correlationId: correlationId ?? null,
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
      correlationId: correlationId ?? null,
    });
  } catch (metricsRecordErr) {
    logger.warn({ err: metricsRecordErr, sessionId: pos.sessionId }, "MetricsAggregator.recordTrade failed (non-blocking)");
  }

  // Prometheus counter — incremented after transaction commits so partial writes don't count.
  // HIGH E-2 fix: this is the ONE canonical increment site for a full/final close.
  // Callers that need a specific reason (time_stop/stop_loss/force_close) pass
  // context.outcomeOverride instead of incrementing again themselves — counting this
  // leg twice with two different outcome labels was the double-count bug.
  paperTradesCounter.labels({
    symbol: pos.symbol,
    side: pos.side,
    outcome: outcomeOverride ?? (netPnl >= 0 ? "win" : "loss"),
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

  // Wave 26 Pass 1: fire-and-forget trade critique autopsy.
  // MUST remain after the audit write above so the position row is fully committed.
  // Dynamic import avoids circular dependency at module load time.
  void import("./trade-critique-service.js").then(({ runTradeCritique }) => {
    void runTradeCritique(pos.id, correlationId ?? undefined).catch((err) => {
      logger.error({ positionId: pos.id, err }, "trade_critique fire-and-forget failed (non-blocking)");
    });
  }).catch((err) => {
    logger.error({ positionId: pos.id, err }, "trade-critique-service dynamic import failed (non-blocking)");
  });

  return { trade, pnl: netPnl, grossPnl, commission, slippage, rollSpreadCost: rollCost.estimatedSpreadCost };
  }); // end withSessionLock
  } finally {
    closeSpan.end();
  }
}

// ─── Gap 4: Consistency Rule Enforcement ─────────────────────

async function checkConsistencyRule(
  session: typeof paperSessions.$inferSelect,
): Promise<void> {
  if (!session.firmId) return;
  // FIX M4 (deep-scan #15): only firms that actually enforce the single-day
  // consistency rule (Topstep + MFFU). Mirrors the tracker's CONSISTENCY_RULE_FIRMS.
  if (!CONSISTENCY_RULE_FIRMS.includes(session.firmId)) return;

  // FIX M4: DEFER to the authoritative consistency tracker (single source of
  // truth) instead of this service's own local single-threshold consistency ratio.
  // The two previously ran parallel, differently-defined calcs (this one:
  // session-local dailyPnlBreakdown vs the firm-config single-threshold ratio; the
  // tracker: firm-wide 40%/50% concentration with a false-positive guard) and could
  // DISAGREE for the same session. Now both read the same computation.
  //
  // dryRun=true suppresses the tracker's OWN audit_log rows + Discord (those are
  // owned by the entry gate `shouldBlockNewEntry` and the daily-digest cron, so we
  // do not double-emit). We only re-broadcast the `paper:consistency-warning` SSE
  // that the Office/dashboard depends on.
  //
  // A distinct, non-UUID cache key ("paper-close:<firm>") keeps this dry-run read
  // from poisoning the tracker's 5s cache shared by the authoritative UUID-keyed
  // callers (a cache hit there would suppress their real non-dry-run audit path).
  let state: Awaited<ReturnType<typeof getConsistencyState>>;
  try {
    state = await getConsistencyState(`paper-close:${session.firmId}`, new Date(), true);
  } catch (err) {
    logger.warn(
      { sessionId: session.id, firmId: session.firmId, err },
      "checkConsistencyRule: authoritative consistency tracker read failed (non-blocking)",
    );
    return;
  }

  if (state.gateState === "ok") return;

  // Backward-compatible SSE payload: keep sessionId/firmId + the legacy
  // maxDayRatio/limit/maxDay fields the dashboard reads, now sourced from the
  // authoritative tracker, plus the richer gateState/concentration fields.
  const limit = state.gateState === "block_50" ? 0.5 : 0.4;
  const maxDayRatio = state.currentConcentrationPct / 100;
  const maxDay = state.highestDayDate ?? "unknown";
  const warning =
    `Consistency ${state.gateState === "block_50" ? "BLOCK" : "WARN"} (authoritative): ` +
    `${state.currentConcentrationPct.toFixed(1)}% single-day concentration ` +
    `(highest $${state.highestDayProfit.toFixed(2)} on ${maxDay} / cumulative ` +
    `$${state.cycleCumulativeProfit.toFixed(2)}) for ${session.firmId}`;

  logger.warn(
    { sessionId: session.id, firmId: session.firmId, gateState: state.gateState, currentConcentrationPct: state.currentConcentrationPct },
    warning,
  );

  broadcastSSE("paper:consistency-warning", {
    sessionId: session.id,
    firmId: session.firmId,
    // Authoritative fields from the single source of truth (consistency-tracker-service).
    gateState: state.gateState,
    currentConcentrationPct: state.currentConcentrationPct,
    highestDayDate: state.highestDayDate,
    falsePositiveSuspected: state.falsePositiveSuspected,
    // Backward-compatible fields the existing dashboard payload carried.
    maxDayRatio,
    limit,
    maxDay,
    message: warning,
  });
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

// ─── Track 3: Exit Handler Circuit Breaker ────────────────────
// Mirrors the SQA circuit breaker pattern (sqa-promise-registry.ts).
// After 3 subprocess failures in 10 min the circuit OPENS and all
// callExitHandler invocations return HOLD immediately (no subprocess spawn).
// Auto-closes after 1 hour — same cooldown as the SQA breaker.
// Audit log entries are written on state transitions.
//
// Fail-CLOSED is preserved: OPEN circuit → HOLD (same as subprocess error).
// This prevents cascading subprocess spawns when Python is down.
const EXIT_HANDLER_CB_THRESHOLD  = 3;
const EXIT_HANDLER_CB_WINDOW_MS  = 10 * 60_000;  // 10 min sliding window
// 2026-06-29 Fix 2b (HIGH): configurable cooldown — default 5 min (was hardcoded 1h).
// 1h blackout silently missed TP1/TP2 for all positions, distorting paper Sharpe/win-rate
// below backtest and corrupting promotion-gate inputs.
const EXIT_HANDLER_CB_COOLDOWN_MS = Number(process.env.EXIT_HANDLER_CB_COOLDOWN_MS ?? 300_000);

interface ExitHandlerCircuitBreaker {
  state: "CLOSED" | "OPEN";
  openedAt: number | null;
  failTimestamps: number[];
  /** Accumulated open-count for session telemetry (promotion gates can flag/exclude distorted periods). */
  openCount: number;
  /** Accumulated total-ms in OPEN state for session telemetry. */
  openTotalMs: number;
}
const exitHandlerCb: ExitHandlerCircuitBreaker = {
  state: "CLOSED",
  openedAt: null,
  failTimestamps: [],
  openCount: 0,
  openTotalMs: 0,
};

function _exitCbPruneWindow(): void {
  const cutoff = Date.now() - EXIT_HANDLER_CB_WINDOW_MS;
  exitHandlerCb.failTimestamps = exitHandlerCb.failTimestamps.filter(t => t >= cutoff);
}

function _exitCbCheckAutoClose(): void {
  if (exitHandlerCb.state === "OPEN" && exitHandlerCb.openedAt !== null) {
    if (Date.now() - exitHandlerCb.openedAt >= EXIT_HANDLER_CB_COOLDOWN_MS) {
      // 2026-06-29 Fix 2b: accumulate total OPEN duration before closing
      exitHandlerCb.openTotalMs += Date.now() - exitHandlerCb.openedAt;
      exitHandlerCb.state = "CLOSED";
      exitHandlerCb.openedAt = null;
      exitHandlerCb.failTimestamps = [];
      logger.info(
        { cooldownMs: EXIT_HANDLER_CB_COOLDOWN_MS, totalOpenMs: exitHandlerCb.openTotalMs },
        "exit-handler circuit breaker: auto-closed after cooldown",
      );
      db.insert(auditLog).values({
        action: "exit_handler.circuit_breaker_closed",
        entityType: "system",
        entityId: null,
        decisionAuthority: "system",
        input: {} as Record<string, unknown>,
        result: { reason: "cooldown_elapsed", cooldownMs: EXIT_HANDLER_CB_COOLDOWN_MS } as Record<string, unknown>,
        status: "success",
        correlationId: randomUUID(), // FINDING #8 FIX: non-null correlationId for incident reconstruction
      }).catch((err) => logger.warn({ err }, "exit_handler CB close audit write failed (non-blocking)"));
    }
  }
}

function _exitCbRecordFailure(): void {
  _exitCbPruneWindow();
  exitHandlerCb.failTimestamps.push(Date.now());
  if (exitHandlerCb.state === "CLOSED" && exitHandlerCb.failTimestamps.length >= EXIT_HANDLER_CB_THRESHOLD) {
    exitHandlerCb.state = "OPEN";
    exitHandlerCb.openedAt = Date.now();
    exitHandlerCb.openCount += 1; // 2026-06-29 Fix 2b: telemetry accumulator
    logger.warn(
      { failures: exitHandlerCb.failTimestamps.length, windowMs: EXIT_HANDLER_CB_WINDOW_MS,
        cooldownMs: EXIT_HANDLER_CB_COOLDOWN_MS, openCount: exitHandlerCb.openCount },
      "exit-handler circuit breaker: OPEN — exit handler calls return HOLD during cooldown",
    );
    AlertFactory.systemError("exit-handler-circuit-open", "Exit handler Python subprocess failed 3× in 10 min — circuit OPEN, HOLD applied to all positions for 1h");
    db.insert(auditLog).values({
      action: "exit_handler.circuit_breaker_open",
      entityType: "system",
      entityId: null,
      decisionAuthority: "system",
      input: { failuresInWindow: exitHandlerCb.failTimestamps.length, windowMs: EXIT_HANDLER_CB_WINDOW_MS } as Record<string, unknown>,
      result: { reason: "failure_threshold_reached", cooldownMs: EXIT_HANDLER_CB_COOLDOWN_MS } as Record<string, unknown>,
      status: "success",
      correlationId: randomUUID(), // FINDING #8 FIX: non-null correlationId for incident reconstruction
    }).catch((err) => logger.warn({ err }, "exit_handler CB open audit write failed (non-blocking)"));
  }
}

/** Test/admin hook — reset exit handler circuit breaker state. */
export function resetExitHandlerCircuitBreaker(): void {
  exitHandlerCb.state = "CLOSED";
  exitHandlerCb.openedAt = null;
  exitHandlerCb.failTimestamps = [];
  exitHandlerCb.openCount = 0;
  exitHandlerCb.openTotalMs = 0;
}

/**
 * Returns CB telemetry accumulators for session diagnostics / promotion-gate distortion analysis.
 * 2026-06-29 Fix 2b: promotion gates can read these to flag sessions with extended CB-OPEN periods.
 */
export function getExitHandlerCbTelemetry(): { openCount: number; openTotalMs: number; currentState: "CLOSED" | "OPEN" } {
  return {
    openCount: exitHandlerCb.openCount,
    openTotalMs: exitHandlerCb.openTotalMs,
    currentState: exitHandlerCb.state,
  };
}

// ─── Track 3: Style D/C Bar Context ──────────────────────────
// Optional bar-level data supplied by callers to enable Style D/C handler dispatch.
// When absent (legacy callers), dispatch is skipped and positions use ATR exits.
// All float fields default to 0 if not provided — handlers return HOLD for 0/NaN inputs.

export interface StyleExitBarContext {
  /** ET time string HH:MM for the current bar (e.g. "15:54") */
  currentTimeEt: string;
  /** Per-symbol ATR-14 in points */
  atr14: Record<string, number>;
  /**
   * Per-symbol bar volume for the current bar.
   * Used by the anchored_vwap runner trail (ΣP·V / ΣV from entry timestamp).
   * When absent or zero, the AVWAP degrades to a price-only average (unit-vol
   * fallback: barVol=1 per bar, equivalent to a simple moving average of mid).
   * Wave 26 wires real volume here from bar.volume at every processSessionBar call.
   */
  barVol?: Record<string, number>;
  /** Per-symbol running high since entry for each open position */
  highSinceEntry?: Record<string, number>;
  /** Per-symbol running low since entry for each open position */
  lowSinceEntry?: Record<string, number>;
  /** Per-symbol last 2-bar 15m swing low (for Style D long trail) */
  last2barSwingLow?: Record<string, number>;
  /** Per-symbol last 2-bar 15m swing high (for Style D short trail) */
  last2barSwingHigh?: Record<string, number>;
  /** Per-symbol developing session POC (for Style C runner) */
  developingSessionPoc?: Record<string, number>;
  /**
   * Defect 4 fix: per-symbol current bar HIGH.
   * Used to pass the intrabar favorable extreme to the Style C handler for TP detection.
   * Longs: TP fires when bar.high >= tp_price (matches backtester.py's bar.high >= tp1).
   * Populated in updatePositionPrices per-position loop.  When absent, falls back to
   * currentPrice (bar close) — preserves pre-fix behaviour for legacy callers.
   */
  barHigh?: Record<string, number>;
  /**
   * Defect 4 fix: per-symbol current bar LOW.
   * Used to pass the intrabar favorable extreme to the Style C handler for TP detection.
   * Shorts: TP fires when bar.low <= tp_price (matches backtester.py's bar.low <= tp1).
   * Populated in updatePositionPrices per-position loop.  When absent, falls back to
   * currentPrice (bar close) — preserves pre-fix behaviour for legacy callers.
   */
  barLow?: Record<string, number>;
  /**
   * BL-8 fix: per-symbol rolling median ATR (14) from the last 100 bars.
   * Replaces the constant medianAtrEstimate = atr * 0.85 hack in exit slippage.
   * The backtest uses np.nanmedian(atr_values) over all bars so the ratio varies
   * per bar (low-vol bars < 1.0×, high-vol bars > 1.5×). With the 0.85 hack, the
   * ratio was always 1/0.85 ≈ 1.176 regardless of regime — optimistic on high-vol days.
   * When absent (legacy callers), falls back to atr * 0.85 (prior behaviour preserved).
   */
  medianAtr14?: Record<string, number>;
  /**
   * C2 fix: per-symbol current bar high/low for intrabar TP touch detection.
   * Populated from bar.high / bar.low in buildExitBarContext (paper-trading-stream.ts).
   * Used by callExitHandler to pass bar_high/bar_low into style_c_handler.py so
   * price_reached() tests the intrabar extreme instead of bar close, matching
   * backtester.py:1248/1260 limit-fill semantics:
   *   long:  bar_high >= tp_price  (touched from below)
   *   short: bar_low  <= tp_price  (touched from above)
   * Also used directly in the "Wave 1 Track 1B" static_styleC TP2 pre-check.
   * When absent (legacy callers), all paths fall back to close-based detection.
   */
  currentBarHigh?: Record<string, number>;
  currentBarLow?: Record<string, number>;
}

interface ExitHandlerResult {
  decision: string;
  new_stop?: number | null;
  evidence: Record<string, unknown>;
  handler_version: string;
}

/**
 * Call the appropriate Style D or C Python handler for a single open position.
 * Fail-CLOSED: any subprocess error returns HOLD and writes an audit log row.
 * Deterministic: same bar state → same ExitDecision (HANDLER_VERSION pinned in evidence).
 * Circuit breaker: after 3 failures in 10 min, all calls return HOLD for 1h (no subprocess spawn).
 */
async function callExitHandler(
  pos: typeof paperPositions.$inferSelect,
  barCtx: StyleExitBarContext,
  strategyId: string | null,
  correlationId?: string | null,
): Promise<ExitHandlerResult> {
  // Wave 24: Style D is DEAD (W23F.N). Default to "C" for null currentExitStyle.
  // Legacy positions that carry currentExitStyle="D" still route to style_d_handler
  // for backward compatibility, but the runtime fallback is now "C".
  const exitStyle = (pos.currentExitStyle ?? "C") as "D" | "C";

  // Runtime guard: any position opened AFTER the Style D deprecation date (2026-05-23)
  // that resolves to Style D should never happen — emit CRITICAL audit row + alert.
  // Positions opened before that date may legitimately carry currentExitStyle="D".
  const STYLE_D_DEPRECATION_DATE = new Date("2026-05-23T00:00:00Z");
  const posEntryTime = pos.entryTime ? new Date(pos.entryTime as unknown as string) : null;
  if (exitStyle === "D" && posEntryTime && posEntryTime >= STYLE_D_DEPRECATION_DATE) {
    const legacyMsg =
      `style_d.legacy_fallback_used: position ${pos.id} (entryTime ${posEntryTime.toISOString()}) ` +
      `routed to Style D after deprecation date — should never fire. ` +
      `Investigate currentExitStyle write path.`;
    logger.error({ positionId: pos.id, entryTime: posEntryTime.toISOString(), strategyId }, legacyMsg);
    insertAuditRowSafe({
      action: "style_d.legacy_fallback_used",
      entityType: "position",
      entityId: pos.id,
      decisionAuthority: "system",
      status: "failure",
      input: { currentExitStyle: pos.currentExitStyle, entryTime: posEntryTime.toISOString() } as Record<string, unknown>,
      result: { message: legacyMsg } as Record<string, unknown>,
      correlationId: correlationId ?? null,
    }).catch((auditErr) => logger.error({ err: auditErr }, "style_d.legacy_fallback_used audit write failed"));
    AlertFactory.systemError("style_d.legacy_fallback_used", new Error(legacyMsg));
  }
  const entryPrice = Number(pos.entryPrice);
  const atr14 = barCtx.atr14[pos.symbol] ?? 0;

  // Defect 3 fix: use the persisted structural stop distance (initialStopPrice, set at
  // openPosition time from ATR×2.0 or adaptive exit input) so TP targets stay fixed
  // at the exact same 1R/2R levels as the backtester.  Dynamic atr14*2.0 caused TP
  // targets to float bar-to-bar as ATR changed, diverging from backtester.py which
  // anchors to the original stop distance.
  // Fallback: dynamic atr14*2.0 for positions opened before migration 0179 added the
  // initialStopPrice column (pre-0179 rows have null; ATR keeps existing behavior).
  const stopPts = pos.initialStopPrice != null
    ? Math.abs(Number(pos.entryPrice) - Number(pos.initialStopPrice))
    : (atr14 > 0 ? atr14 * 2.0 : 1.0);  // floor at 1.0 to avoid div/0 in handler

  const highSinceEntry = barCtx.highSinceEntry?.[pos.symbol] ?? entryPrice;
  const lowSinceEntry  = barCtx.lowSinceEntry?.[pos.symbol]  ?? entryPrice;

  const spec = CONTRACT_SPECS[pos.symbol];
  const tickSize = spec?.tickSize ?? 0.25;

  const module = exitStyle === "C"
    ? "src.engine.exits.style_c_handler"
    : "src.engine.exits.style_d_handler";

  let config: Record<string, unknown>;
  if (exitStyle === "D") {
    config = {
      action: "evaluate_exit",
      state: {
        direction: pos.side,
        entry_price: entryPrice,
        stop_pts: stopPts,
        current_price: Number(pos.currentPrice ?? entryPrice),
        current_high_since_entry: highSinceEntry,
        current_low_since_entry: lowSinceEntry,
        atr_14: atr14,
        last_2bar_swing_low:  barCtx.last2barSwingLow?.[pos.symbol]  ?? null,
        last_2bar_swing_high: barCtx.last2barSwingHigh?.[pos.symbol] ?? null,
        current_time_et: barCtx.currentTimeEt,
        position_pct_open: Number(pos.fillRatio ?? 1.0),
        tick_size: tickSize,
        tp1_filled: pos.tp1Filled ?? false,
        be_stop_applied: pos.beStopApplied ?? false,
      },
    };
  } else {
    // Defect 4 fix: pass the intrabar FAVORABLE extreme (bar.high for longs, bar.low
    // for shorts) as current_price for TP detection.  The backtester checks
    //   bar.high >= tp1_price  (longs)  / bar.low <= tp1_price  (shorts)
    // so using bar.close misses bars where price touched TP then pulled back.
    // Stop detection is NOT affected — stops are handled by the BL-1 intrabar
    // stop-breach block and the checkStopLoss absolute_level mechanism, both of which
    // already use the ADVERSE extreme correctly.
    const favorableExtreme = pos.side === "long"
      ? (barCtx.barHigh?.[pos.symbol] ?? Number(pos.currentPrice ?? entryPrice))
      : (barCtx.barLow?.[pos.symbol]  ?? Number(pos.currentPrice ?? entryPrice));

    config = {
      action: "evaluate_exit",
      state: {
        direction: pos.side,
        entry_price: entryPrice,
        stop_pts: stopPts,
        current_price: favorableExtreme,  // intrabar favorable extreme for TP detection
        current_time_et: barCtx.currentTimeEt,
        position_pct_open: Number(pos.fillRatio ?? 1.0),
        tick_size: tickSize,
        tp1_filled: pos.tp1Filled ?? false,
        tp2_filled: pos.tp2Filled ?? false,
        developing_session_poc: barCtx.developingSessionPoc?.[pos.symbol] ?? null,
        // C2 fix: intrabar bar extremes for limit-touch TP detection.
        // Mirrors backtester.py:1248/1260 — long: bar_high >= tp; short: bar_low <= tp.
        // null when caller is legacy (no exitBarContext.currentBarHigh) → Python falls
        // back to current_price (close-based), preserving backward-compat.
        bar_high: barCtx.currentBarHigh?.[pos.symbol] ?? null,
        bar_low:  barCtx.currentBarLow?.[pos.symbol]  ?? null,
      },
    };
  }

  // ── F-b parity fix: static_styleC TP2 flat +2.0R pre-check ─────────────────
  // If a flat-2R TP2 price was stored at position open (static_styleC only),
  // check if the current bar has reached it BEFORE calling Python. This mirrors
  // Python style_c_handler.py TP2_AT_R_C = 2.0 with C2 intrabar detection.
  // Fully backward-compatible: only fires when stored TP2 exists. When no stored TP2,
  // Python handles it at 2.0R as before.
  if (exitStyle === "C" && !(pos.tp2Filled ?? false) && (pos.tp1Filled ?? false)) {
    const storedPlan = pos.exitPlan as Record<string, unknown> | null;
    const storedTp2Price = typeof storedPlan?.["static_styleC_tp2_price"] === "number"
      ? (storedPlan["static_styleC_tp2_price"] as number)
      : null;
    if (storedTp2Price != null) {
      // C2 fix: use intrabar bar extreme for TP touch detection, matching
      // backtester.py:1248/1260 limit-fill semantics (long: bar_high >= target;
      // short: bar_low <= target). Falls back to close-based detection when
      // currentBarHigh/Low absent (legacy callers or no bar context).
      const currentPriceNum = Number(pos.currentPrice ?? entryPrice);
      const barHighForTp2 = barCtx.currentBarHigh?.[pos.symbol] ?? null;
      const barLowForTp2  = barCtx.currentBarLow?.[pos.symbol]  ?? null;
      const tp2Reached = pos.side === "long"
        ? (barHighForTp2 !== null ? barHighForTp2 : currentPriceNum) >= storedTp2Price
        : (barLowForTp2  !== null ? barLowForTp2  : currentPriceNum) <= storedTp2Price;
      if (tp2Reached) {
        logger.debug(
          { positionId: pos.id, storedTp2Price, currentPriceNum, barHighForTp2, barLowForTp2, side: pos.side },
          "F-b: static_styleC TP2 reached at flat +2.0R (pre-check firing)",
        );
        return {
          decision: "FILL_TP2",
          new_stop: null,
          evidence: {
            trigger: "tp2_fill_flat_2r",
            tp2_price: storedTp2Price,
            tp2_fraction: 0.33,
            tp2_source: (storedPlan?.["static_styleC_tp2_source"] as string | undefined) ?? "r_multiple",
            tp2_level_type: (storedPlan?.["static_styleC_tp2_level_type"] as string | null | undefined) ?? null,
            handler_version: "static_styleC_flat_2r_v1",
          },
          handler_version: "static_styleC_flat_2r_v1",
        };
      }
    }
  }

  // ── 2026-06-29 Fix 2 (HIGH): TS-native Style C exit evaluator — DARK LAUNCH ──
  // Runs synchronously — no subprocess, no circuit-breaker risk, <1ms per call —
  // eliminating the per-bar Python spawn overhead and the 1h TP blackout that
  // occurs when the CB opens after 3 failures in 10 min.
  // SHIPPED OPT-IN / DEFAULT OFF (mirrors BACKTEST_STATIC_C_PARTIALS_ENABLED): the
  // default path remains the audited Python style_c_handler so default exit
  // behavior is byte-identical to today. Flip STYLE_C_EXIT_TS_NATIVE=true only
  // after the evaluator is parity-validated against the Python handler across the
  // regime fixtures. Until then this is a dead-by-default fast path.
  if (exitStyle === "C" && process.env.STYLE_C_EXIT_TS_NATIVE === "true") {
    const cState = (config as { action: string; state: Record<string, unknown> }).state;
    return evaluateStyleCExit({
      direction: cState["direction"] as "long" | "short",
      entry_price: cState["entry_price"] as number,
      stop_pts: cState["stop_pts"] as number,
      current_price: cState["current_price"] as number,
      current_time_et: cState["current_time_et"] as string,
      position_pct_open: (cState["position_pct_open"] as number | undefined) ?? 1.0,
      tick_size: (cState["tick_size"] as number | undefined) ?? 0.25,
      tp1_filled: (cState["tp1_filled"] as boolean | undefined) ?? false,
      tp2_filled: (cState["tp2_filled"] as boolean | undefined) ?? false,
      developing_session_poc: (cState["developing_session_poc"] as number | null | undefined) ?? null,
      bar_high: (cState["bar_high"] as number | null | undefined) ?? null,
      bar_low: (cState["bar_low"] as number | null | undefined) ?? null,
    });
  }

  // ── Circuit breaker check (short-circuit before subprocess spawn) ────────
  _exitCbCheckAutoClose();
  if (exitHandlerCb.state === "OPEN") {
    logger.debug(
      { positionId: pos.id, exitStyle, strategyId },
      "exit-handler circuit OPEN — returning HOLD without subprocess spawn",
    );
    return {
      decision: "HOLD",
      new_stop: null,
      evidence: { circuit_breaker: "OPEN", reason: "exit_handler_circuit_open" },
      handler_version: `style_${exitStyle.toLowerCase()}_cb_open`,
    };
  }

  try {
    const { runPythonModule } = await import("../lib/python-runner.js");
    const result = await runPythonModule<ExitHandlerResult>({
      module,
      config,
      timeoutMs: 3_000,
      componentName: `style-${exitStyle.toLowerCase()}-handler`,
      lane: "execution", // deepscan5 obs-H1: per-bar exit handler — reserved lane so backtest load
                         // can't queue it past its 3 s timeout and trip the circuit breaker.
    });
    return result;
  } catch (err) {
    // Fail-CLOSED: subprocess error → HOLD + audit row + alert SSE
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error(
      { positionId: pos.id, exitStyle, err: errMsg, strategyId, correlationId },
      "Style exit handler subprocess error → fail-CLOSED HOLD",
    );
    // Record failure in circuit breaker sliding window
    _exitCbRecordFailure();
    // Audit row (non-blocking)
    db.insert(auditLog).values({
      action: "paper.exit_handler_error",
      entityType: "paper_position",
      entityId: pos.id,
      decisionAuthority: "system",
      input: { exitStyle, positionId: pos.id, strategyId, module, correlationId } as Record<string, unknown>,
      result: { decision: "HOLD", error: errMsg, reason: "subprocess_error" } as Record<string, unknown>,
      status: "failed",
      correlationId: correlationId ?? null,
    }).catch((dbErr) => logger.warn({ dbErr }, "exit_handler_error audit write failed (non-blocking)"));

    broadcastSSE(PAPER_EXIT_EVENTS.HANDLER_ERROR, {
      position_id: pos.id,
      strategy_id: strategyId,
      decision_type: "HOLD",
      evidence: { error: errMsg, module },
      exit_style: exitStyle,
      correlation_id: correlationId ?? null,
    });

    // Pass 6 Track D: per-call Discord visibility — don't wait until circuit-breaker
    // fires at 3/10-min. Surface every handler error immediately.
    // Escalate to CRITICAL for systemic failure signals (subprocess-died or timeout).
    {
      const isSystemic = errMsg.includes("subprocess-died") || errMsg.includes("timeout");
      const discordBody = appendFamilyGradePostscript(
        `Exit handler subprocess error for position ${pos.id} (style: ${exitStyle}, module: ${module}). ` +
          `Error: ${errMsg}. Decision: HOLD (fail-CLOSED). CorrelationId: ${correlationId ?? "none"}.`,
        "The trading bot's exit logic hit an error and safely chose to hold the position.",
        "This is a single error and the bot is protecting your trade. If you see many of these, tell Tony.",
      );
      if (isSystemic) {
        notifyCritical(
          `Exit handler SYSTEMIC error — style ${exitStyle}`,
          discordBody,
          { positionId: pos.id, strategyId, exitStyle, module, correlationId: correlationId ?? null, errorType: "systemic" },
        );
      } else {
        notifyWarning(
          `Exit handler error — style ${exitStyle}`,
          discordBody,
          { positionId: pos.id, strategyId, exitStyle, module, correlationId: correlationId ?? null },
        );
      }
    }

    return {
      decision: "HOLD",
      new_stop: null,
      evidence: { error: errMsg },
      handler_version: `style_${exitStyle.toLowerCase()}_handler_error`,
    };
  }
}

// ─── Server-Mediated Execution: context resolver (Phase 0) ───────────────────
//
// Resolves LiveExecutionContext from a paper position's sessionId.
// Used by exit injection points in applyExitDecision().
// Fail-soft: returns null when flag is off, state is non-live, or DB lookup fails.
// All errors are swallowed — this must never affect paper simulation.
async function _resolveSmeContextForExit(
  sessionId: string,
  positionId: string,
  // deepscan7 obs-H3 (2026-07-02): entry-time correlation_id persisted on
  // paper_positions (BL-9, migration 0180) — callers pass pos.correlationId so
  // SME exit audit rows join the signal→entry trace. Legacy pre-0180 rows (null)
  // fall back to a fresh UUID below so the exit trace is never null-correlated.
  entryCorrelationId?: string | null,
): Promise<import("./server-mediated-executor.js").LiveExecutionContext | null> {
  try {
    const { isServerMediatedExecutionEnabled } = await import("./server-mediated-executor.js");
    if (!isServerMediatedExecutionEnabled()) return null; // fast-path: flag off

    // sessionId → firmId + strategyId
    const [sess] = await db
      .select({ strategyId: paperSessions.strategyId, firmId: paperSessions.firmId })
      .from(paperSessions)
      .where(eq(paperSessions.id, sessionId))
      .limit(1);
    if (!sess?.strategyId) return null;

    // strategyId → lifecycleState
    const [strat] = await db
      .select({ lifecycleState: strategies.lifecycleState })
      .from(strategies)
      .where(eq(strategies.id, sess.strategyId))
      .limit(1);
    if (!strat) return null;

    // firmId + strategyId → accountId.  DS#20 T-C1 (Band C CRITICAL): resolve the
    // SPECIFIC account assigned to THIS strategy via account_strategy_assignments
    // (strategy→account, active, firm-matched) instead of "first enabled broker account
    // for the firm". The old query silently routed a live modify/flatten (TRAIL, BE+1,
    // partial-close, 15:55 flatten) for a position on account B to account A the moment a
    // firm had 2+ enabled accounts — an explicit APPROVED horizontal-scaling lever
    // (§5 Phase 3 multi-account Topstep, §9 family). FAIL-CLOSED on 0-or-ambiguous: never
    // guess which account holds a live position — suppress the SME route (paper sim
    // unaffected) + loud audit. The definitive fix threads an explicit accountId onto
    // paper_sessions at open time (schema change, deferred); until then this closes the
    // silent-misroute hole by refusing to guess.
    const firmId = sess.firmId ?? "";
    if (!firmId) return null;
    const assignedAccts = await db
      .select({ accountId: accountStrategyAssignments.accountId })
      .from(accountStrategyAssignments)
      .innerJoin(brokerAccounts, eq(accountStrategyAssignments.accountId, brokerAccounts.accountId))
      .where(and(
        eq(accountStrategyAssignments.strategyId, sess.strategyId),
        eq(accountStrategyAssignments.status, "active"),
        eq(brokerAccounts.firmId, firmId),
        eq(brokerAccounts.enabled, true),
      ));
    if (assignedAccts.length !== 1) {
      // 0 = no active assignment for this strategy on this firm; >1 = ambiguous (same
      // strategy on multiple accounts of one firm — the approved Topstep multi-account
      // lever). Either way, do NOT guess which account holds the live position.
      logger.warn(
        { sessionId, positionId, strategyId: sess.strategyId, firmId, candidateCount: assignedAccts.length },
        "SME: could not resolve an unambiguous account for exit routing — suppressing SME route (fail-closed, paper sim unaffected)",
      );
      await insertAuditRowSafe({
        action: "sme.exit_account_unresolved",
        entityType: "strategy",
        entityId: sess.strategyId,
        decisionAuthority: "gate",
        status: "failure",
        input: { sessionId, positionId, firmId } as Record<string, unknown>,
        result: {
          reason: assignedAccts.length === 0 ? "no_active_assignment" : "ambiguous_multi_account",
          candidate_count: assignedAccts.length,
          note: "SME exit routing requires exactly one active account_strategy_assignments match for the strategy+firm; never guess which account holds the live position",
        } as Record<string, unknown>,
        correlationId: entryCorrelationId ?? randomUUID(),
      });
      return null;
    }
    const acct = assignedAccts[0];
    if (!acct?.accountId) return null;

    return {
      accountId: acct.accountId,
      lifecycleState: strat.lifecycleState,
      sessionId,
      strategyId: sess.strategyId,
      correlationId: entryCorrelationId ?? randomUUID(), // deepscan7 obs-H3: entry trace (BL-9) or fresh UUID — never null
    };
  } catch (err) {
    logger.warn(
      { err, sessionId, positionId },
      "SME: context resolution failed for exit routing (fail-soft, paper sim unaffected)",
    );
    return null;
  }
}

/**
 * BL-4 FIX: Book realized P&L for a partial-close event (TP1 or TP2).
 *
 * When Style C/D exits close a fraction of the position (TP1=33%/50%, TP2=33%),
 * the residual contracts remain open and the position is NOT closed. However the
 * realized P&L of the exited contracts must be:
 *   (a) persisted as a paper_trades row (for journal analytics and Sharpe calc)
 *   (b) credited to session currentEquity atomically (same SQL-atomic pattern as
 *       closePosition so there is no race with the per-bar MTM update)
 *
 * This function DOES NOT set closedAt on paper_positions — the position stays open.
 * It DOES insert a paper_trades row with contracts = contractsToClose so the partial
 * exit appears in the journal. The full exit row (runner) is written by closePosition
 * when the residual contracts are eventually closed.
 *
 * Commission is charged on the exiting contracts only (1 round-trip side equivalent —
 * entry commission was already paid at openPosition; only the exit side remains).
 */
async function bookPartialClose(
  pos: typeof paperPositions.$inferSelect,
  contractsToClose: number,
  exitPrice: number,
  exitReason: string,
  atr?: number,
  correlationId?: string | null,
  // FINDING #4 FIX: thread rolling medianAtr14 from the exit-bar context so partial-close
  // slippage matches closePosition's BL-8 path (context.medianAtr). Without this, partial
  // closes always used the 0.85× ATR hack rather than the rolling median, causing
  // systematic slippage understatement on TP1/TP2 partial closes vs the backtest model.
  medianAtr14?: number,
  // Deep-scan #5 MED (2026-06-29): position-state advance (tp1Filled/tp2Filled + decremented
  // contracts) applied INSIDE this function's transaction so the paper_trades row, the equity
  // credit, AND the position-state advance commit atomically. Previously the caller advanced
  // state in a SEPARATE db.update AFTER this returned — a process crash in that sub-ms window
  // left tp1Filled=false with the partial already booked, so the next bar re-fired the partial
  // → DUPLICATE paper_trades row + wrong contract count + distorted promotion-gate inputs.
  positionStateUpdate?: Partial<typeof paperPositions.$inferInsert>,
): Promise<void> {
  try {
    const spec = CONTRACT_SPECS[pos.symbol];
    if (!spec) {
      logger.warn({ positionId: pos.id, symbol: pos.symbol }, "bookPartialClose: unknown contract symbol — skipping P&L booking");
      return;
    }

    const entryPrice = Number(pos.entryPrice);
    const direction = pos.side === "long" ? 1 : -1;

    // Exit slippage on the partial close (same session-aware formula as closePosition)
    const closeTimestamp = new Date();
    const sessionAtClose = classifySessionType(closeTimestamp);
    const exitSlippageSession = toSlippageSession(sessionAtClose); // F10: centralized remap
    // FINDING #4 FIX: prefer the passed-in rolling median (from exitBarContext.medianAtr14)
    // over the constant 0.85× ATR estimate. The 0.85 factor was an approximation that
    // systematically understated slippage vs the backtest np.nanmedian model.
    const medianAtrEstimate = medianAtr14 ?? (atr ? atr * 0.85 : undefined);
    const slippage = calculateSlippage(pos.symbol, 1, atr, medianAtrEstimate, "stop_limit", exitSlippageSession);
    const actualExit = pos.side === "long" ? exitPrice - slippage : exitPrice + slippage;

    const grossPnl = direction * (actualExit - entryPrice) * spec.pointValue * contractsToClose;

    // Only the exit commission side for the partial close contracts
    // (entry side was paid at openPosition across the full position).
    const [sessionForFirm] = await db.select({ firmId: paperSessions.firmId })
      .from(paperSessions).where(eq(paperSessions.id, pos.sessionId));
    const commissionPerSide = getCommissionPerSideBySymbol(pos.symbol, sessionForFirm?.firmId ?? null);
    const exitCommission = commissionPerSide * contractsToClose;   // exit-side only
    const netPnl = grossPnl - exitCommission;

    // Insert partial trade row + atomic equity credit in one transaction
    await db.transaction(async (tx) => {
      await tx.insert(paperTrades).values({
        sessionId: pos.sessionId,
        symbol: pos.symbol,
        side: pos.side,
        entryPrice: pos.entryPrice,
        exitPrice: String(actualExit),
        pnl: String(netPnl),
        grossPnl: String(grossPnl),
        commission: String(exitCommission),
        contracts: contractsToClose,
        entryTime: pos.entryTime,
        exitTime: closeTimestamp,
        slippage: String(slippage),
        mae: pos.mae,
        mfe: pos.mfe,
        fillProbability: pos.fillProbability,
        // BL-9 (migration 0180): partial-close legs carry the same correlationId as the full close
        // so the TP1/TP2 legs and the runner-close are all traceable to the originating signal.
        correlationId: correlationId ?? null,
      });

      // F1 + F12(drizzle): typed ::numeric cast + realizedPeakEquity + totalTrades,
      // matching the closePosition transaction pattern. Prior code used a raw-string
      // column reference ("current_equity") which bypassed Drizzle's schema binding and
      // omitted realizedPeakEquity / totalTrades entirely — causing kill-switch and
      // promotion-gate reads to ignore partial-close equity on the same session.
      await tx
        .update(paperSessions)
        .set({
          currentEquity:      sql`${paperSessions.currentEquity}::numeric + ${netPnl}`,
          peakEquity:         sql`GREATEST(${paperSessions.peakEquity}::numeric, ${paperSessions.currentEquity}::numeric + ${netPnl})`,
          realizedPeakEquity: sql`GREATEST(${paperSessions.realizedPeakEquity}::numeric, ${paperSessions.currentEquity}::numeric + ${netPnl})`,
          totalTrades:        sql`COALESCE(${paperSessions.totalTrades}, 0) + 1`,
        })
        .where(eq(paperSessions.id, pos.sessionId));

      // Deep-scan #5 MED (2026-06-29): advance the position state in the SAME transaction
      // as the trade row + equity credit — atomic, so a crash can never leave a booked
      // partial with tp1Filled/tp2Filled=false (the duplicate-re-fire window).
      if (positionStateUpdate) {
        await tx
          .update(paperPositions)
          .set(positionStateUpdate)
          .where(eq(paperPositions.id, pos.id));
      }

      // M1 (deepscan-6): dailyPnlBreakdown inside tx so kill-switch sees accurate partial-close
      // P&L even on a crash between trade commit and a follow-up update.
      // Was a non-blocking try/catch OUTSIDE the tx — a crash left the DLL gate reading a stale value.
      {
        const todayKey = toFuturesTradingDayString();
        const jsonPath = `{${todayKey}}`;
        await tx.update(paperSessions).set({
          dailyPnlBreakdown: sql`jsonb_set(
            COALESCE(${paperSessions.dailyPnlBreakdown}, '{}'::jsonb),
            ${jsonPath}::text[],
            (COALESCE((${paperSessions.dailyPnlBreakdown}->>${todayKey})::numeric, 0) + ${netPnl})::text::jsonb
          )`,
        }).where(eq(paperSessions.id, pos.sessionId));
      }

      // O7 (deepscan-6): success-path audit inside tx (fail-closed), matching closePosition pattern.
      // Was fire-and-forget .catch() AFTER the tx commit — a crash left no audit record of the partial close.
      await tx.insert(auditLog).values({
        action: `paper.partial_close.${exitReason.toLowerCase()}`,
        entityType: "paper_position",
        entityId: pos.id,
        decisionAuthority: "system",
        input: { positionId: pos.id, contractsToClose, exitPrice, atr, correlationId } as Record<string, unknown>,
        result: { grossPnl, exitCommission, netPnl, actualExit, slippage } as Record<string, unknown>,
        status: "success",
        correlationId: correlationId ?? null,
      });
    });

    // HIGH E-2 fix (deep-scan #16 wave-1 track-3, 2026-07-04): partial closes (TP1/TP2 —
    // the DEFAULT Style C legs and the most common winning-trade path) previously never
    // incremented tf_paper_trades_total at all, systematically undercounting winners
    // opposite to the double-counted stop/time-stop/force-close legs. The counter counts
    // LEGS (one paper_trades row = one increment, see the doc comment on paperTrades in
    // metrics-registry.ts) — each partial is its own paper_trades row (inserted above),
    // so it gets its own increment here, exactly once, after the transaction commits.
    paperTradesCounter.labels({
      symbol: pos.symbol,
      side: pos.side,
      outcome: `partial_${exitReason.toLowerCase()}`,
    }).inc();

    logger.info(
      {
        positionId: pos.id, exitReason, contractsToClose,
        grossPnl, exitCommission, netPnl, actualExit, correlationId,
      },
      "paper.partial_close: P&L booked and equity credited",
    );

  } catch (err) {
    // Deep-scan #5 MED (2026-06-29): RE-THROW on transaction failure. The transaction now
    // covers the trade row + equity credit + position-state advance atomically, so a failed
    // tx means NOTHING committed — re-throwing lets the caller's existing try/catch (the
    // "Fix 1" block at the TP1/TP2 call sites) return false WITHOUT advancing state, so the
    // partial re-evaluates next bar with no journal gap. Previously this catch swallowed the
    // error and returned void, which (a) defeated the caller's Fix-1 protection — it expected
    // a throw that never came — and (b) let the caller advance tp1Filled even though no P&L
    // was booked. The atomic tx + re-throw makes "booked" and "state advanced" inseparable.
    logger.error(
      { err, positionId: pos.id, exitReason, contractsToClose, correlationId },
      "bookPartialClose: transaction FAILED — nothing committed (no trade row, no equity credit, no state advance); re-throwing so caller re-evaluates next bar",
    );
    // M3 (2026-06-29): await + log the booking_failed audit (was .catch(() => undefined) —
    // a silent swallow inside an already-failing path compounded the diagnostic loss).
    await db.insert(auditLog).values({
      action: "paper.partial_close.booking_failed",
      entityType: "paper_position",
      entityId: pos.id,
      decisionAuthority: "system",
      input: { positionId: pos.id, contractsToClose, exitPrice, exitReason, correlationId } as Record<string, unknown>,
      result: { error: String(err) } as Record<string, unknown>,
      status: "error",
      correlationId: correlationId ?? null,
    }).catch((auditErr) => logger.warn({ err: auditErr, positionId: pos.id }, "bookPartialClose: booking_failed audit write dropped (non-blocking)"));
    throw err;
  }
}

/**
 * Apply an ExitDecision to an open position. Mutates DB state.
 * Returns true if the position was fully closed (TIME_STOP_FLATTEN).
 */
async function applyExitDecision(
  pos: typeof paperPositions.$inferSelect,
  result: ExitHandlerResult,
  exitStyle: "D" | "C",
  strategyId: string | null,
  currentPrice: number,
  atr?: number,
  correlationId?: string | null,
  medianAtr?: number,   // BL-8 fix: rolling median ATR for realistic exit slippage
): Promise<boolean> {
  const { decision, new_stop, evidence } = result;

  // Write audit log row for every non-HOLD decision (HOLD is high-frequency; skip for cost).
  if (decision !== "HOLD") {
    db.insert(auditLog).values({
      action: `paper.exit_decision.${decision.toLowerCase()}`,
      entityType: "paper_position",
      entityId: pos.id,
      decisionAuthority: "system",
      input: { exitStyle, positionId: pos.id, strategyId, currentPrice, correlationId } as Record<string, unknown>,
      result: { decision, new_stop, evidence, handler_version: result.handler_version } as Record<string, unknown>,
      status: "success",
      correlationId: correlationId ?? null,
    }).catch((err) => logger.warn({ err, decision }, "exit_decision audit write failed (non-blocking)"));
  }

  const exitPayloadBase = {
    position_id: pos.id,
    strategy_id: strategyId,
    decision_type: decision,
    evidence,
    exit_style: exitStyle,
    correlation_id: correlationId ?? null,
  };

  switch (decision) {
    case "FILL_TP1_50PCT": {
      if (pos.tp1Filled) {
        // Idempotent: already filled — downgrade to HOLD
        logger.debug({ positionId: pos.id }, "style_exit: TP1 already filled — idempotent HOLD");
        return false;
      }
      // Partial close: Style D=50%, Style C=33% of position contracts
      const tp1Fraction = exitStyle === "C" ? 0.33 : 0.50;
      const contractsToClose = Math.max(1, Math.floor(pos.contracts * tp1Fraction));
      const evidenceTyped = evidence as Record<string, unknown>;
      const tp1Price = evidenceTyped.tp1_price as number | undefined;
      const rMultiple = tp1Price != null && pos.entryPrice != null
        ? Math.abs((tp1Price - Number(pos.entryPrice)) / (evidenceTyped.stop_pts as number || 1))
        : undefined;
      // Close partial — if full position closes here, fall through to full close below
      if (contractsToClose < pos.contracts) {
        // 2026-06-29 Fix 1 (CRITICAL): await bookPartialClose BEFORE advancing position state.
        // If the DB write fails while tp1Filled/contracts are already advanced, the next bar
        // closes the wrong number of contracts (double-charges commission + corrupts P&L).
        // On failure: write CRITICAL audit + do NOT advance state → next bar re-evaluates TP1.
        try {
          // Deep-scan #5 MED (2026-06-29): pass the position-state advance so bookPartialClose
          // commits it ATOMICALLY with the trade row + equity (eliminates the crash-window
          // duplicate-re-fire). The separate post-call db.update that used to live here is gone.
          await bookPartialClose(pos, contractsToClose, currentPrice, "tp1", atr, correlationId, medianAtr, {
            tp1Filled: true,
            contracts: pos.contracts - contractsToClose,
            lastHandlerEvalAt: new Date(),
          });
        } catch (bookErr) {
          const bookErrMsg = bookErr instanceof Error ? bookErr.message : String(bookErr);
          logger.error(
            { err: bookErrMsg, positionId: pos.id, strategyId, correlationId },
            "paper.partial_close_booking_failed (TP1): position state NOT advanced; re-evaluates next bar",
          );
          db.insert(auditLog).values({
            action: "paper.partial_close_booking_failed",
            entityType: "paper_position",
            entityId: pos.id,
            decisionAuthority: "system",
            input: { leg: "tp1", positionId: pos.id, strategyId, contractsToClose, currentPrice, correlationId } as Record<string, unknown>,
            result: { error: bookErrMsg, state_advanced: false } as Record<string, unknown>,
            status: "error",
            correlationId: correlationId ?? null,
          }).catch((e) => logger.error({ e }, "TP1 booking_failed audit write failed (non-blocking)"));
          notifyCritical(
            "TP1 partial close journal write failed",
            appendFamilyGradePostscript(
              `TP1 bookPartialClose failed for position ${pos.id} (strategy ${strategyId ?? "unknown"}). ` +
              `Error: ${bookErrMsg}. Position state NOT advanced — trade will re-evaluate on next bar.`,
              "The trading bot hit a database error while recording a partial profit exit.",
              "The position is still open and will try again next bar. Tell Tony if this repeats.",
            ),
            { positionId: pos.id, strategyId, correlationId: correlationId ?? null, error: bookErrMsg },
          );
          return false; // leave tp1Filled=false and contracts unchanged
        }
        // bookPartialClose committed the trade row + equity credit + tp1Filled/contracts
        // advance ATOMICALLY (deep-scan #5 MED) — no separate state write, no crash window.
        logger.info(
          {
            positionId: pos.id, strategyId, exitStyle, currentPrice, tp1Price,
            rMultiple, contractsToClose, correlationId, evidence,
          },
          "style_exit: TP1 filled — partial close executed",
        );
        broadcastSSE(PAPER_EXIT_EVENTS.TP1_FILLED, exitPayloadBase);
        // SME Phase 0: fire live TP1 partial exit (fire-and-forget, isolated)
        _resolveSmeContextForExit(pos.sessionId, pos.id, pos.correlationId).then((smeCtx) => {
          if (!smeCtx) return;
          return import("./server-mediated-executor.js").then(({ routeLiveExitPartial }) =>
            routeLiveExitPartial({
              ctx: smeCtx,
              symbol: pos.symbol,
              side: pos.side as "long" | "short",
              quantity: contractsToClose,
              exitType: "TP1",
            })
          );
        }).catch((err: unknown) =>
          logger.error({ err, positionId: pos.id }, "SME: TP1 exit routing failed (paper sim unaffected)")
        );
      } else {
        // Fully closes (e.g. 1-contract position — close whole thing)
        await closePosition(pos.id, currentPrice, atr, { medianAtr });
        logger.info(
          {
            positionId: pos.id, strategyId, exitStyle, currentPrice, tp1Price,
            rMultiple, contractsToClose, correlationId, evidence,
          },
          "style_exit: TP1 filled — full position closed",
        );
        broadcastSSE(PAPER_EXIT_EVENTS.TP1_FILLED, exitPayloadBase);
        // SME Phase 0: full close = flatten
        _resolveSmeContextForExit(pos.sessionId, pos.id, pos.correlationId).then((smeCtx) => {
          if (!smeCtx) return;
          return import("./server-mediated-executor.js").then(({ routeLiveFlatten }) =>
            routeLiveFlatten({
              ctx: smeCtx,
              symbol: pos.symbol,
              side: pos.side as "long" | "short",
              quantity: contractsToClose,
              flattenReason: "TP1_FULL_CLOSE",
            })
          );
        }).catch((err: unknown) =>
          logger.error({ err, positionId: pos.id }, "SME: TP1 full-close flatten routing failed (paper sim unaffected)")
        );
        return true;
      }
      break;
    }

    case "FILL_TP2": {
      if (pos.tp2Filled) {
        logger.debug({ positionId: pos.id }, "style_exit: TP2 already filled — idempotent HOLD");
        return false;
      }
      const tp2Fraction = 0.33;
      const contractsToClose = Math.max(1, Math.floor(pos.contracts * tp2Fraction));
      const tp2Evidence = evidence as Record<string, unknown>;
      if (contractsToClose < pos.contracts) {
        // 2026-06-29 Fix 1 (CRITICAL): await bookPartialClose BEFORE advancing state (same
        // as TP1 fix). On failure: CRITICAL audit + no state advance → re-evaluate next bar.
        try {
          // Deep-scan #5 MED (2026-06-29): atomic position-state advance (same as TP1).
          await bookPartialClose(pos, contractsToClose, currentPrice, "tp2", atr, correlationId, medianAtr, {
            tp2Filled: true,
            contracts: pos.contracts - contractsToClose,
            lastHandlerEvalAt: new Date(),
          });
        } catch (bookErr) {
          const bookErrMsg = bookErr instanceof Error ? bookErr.message : String(bookErr);
          logger.error(
            { err: bookErrMsg, positionId: pos.id, strategyId, correlationId },
            "paper.partial_close_booking_failed (TP2): position state NOT advanced; re-evaluates next bar",
          );
          db.insert(auditLog).values({
            action: "paper.partial_close_booking_failed",
            entityType: "paper_position",
            entityId: pos.id,
            decisionAuthority: "system",
            input: { leg: "tp2", positionId: pos.id, strategyId, contractsToClose, currentPrice, correlationId } as Record<string, unknown>,
            result: { error: bookErrMsg, state_advanced: false } as Record<string, unknown>,
            status: "error",
            correlationId: correlationId ?? null,
          }).catch((e) => logger.error({ e }, "TP2 booking_failed audit write failed (non-blocking)"));
          notifyCritical(
            "TP2 partial close journal write failed",
            appendFamilyGradePostscript(
              `TP2 bookPartialClose failed for position ${pos.id} (strategy ${strategyId ?? "unknown"}). ` +
              `Error: ${bookErrMsg}. Position state NOT advanced — trade will re-evaluate on next bar.`,
              "The trading bot hit a database error while recording a partial profit exit.",
              "The position is still open and will try again next bar. Tell Tony if this repeats.",
            ),
            { positionId: pos.id, strategyId, correlationId: correlationId ?? null, error: bookErrMsg },
          );
          return false; // leave tp2Filled=false and contracts unchanged
        }
        // bookPartialClose committed the trade row + equity credit + tp2Filled/contracts
        // advance ATOMICALLY (deep-scan #5 MED) — no separate state write, no crash window.
        logger.info(
          {
            positionId: pos.id, strategyId, exitStyle, currentPrice,
            tp2Price: tp2Evidence.tp2_price, contractsToClose, correlationId, evidence,
          },
          "style_exit: TP2 filled — partial close executed (Style C runner remains)",
        );
        broadcastSSE(PAPER_EXIT_EVENTS.TP2_FILLED, exitPayloadBase);
        // SME Phase 0: fire live TP2 partial exit (fire-and-forget, isolated)
        _resolveSmeContextForExit(pos.sessionId, pos.id, pos.correlationId).then((smeCtx) => {
          if (!smeCtx) return;
          return import("./server-mediated-executor.js").then(({ routeLiveExitPartial }) =>
            routeLiveExitPartial({
              ctx: smeCtx,
              symbol: pos.symbol,
              side: pos.side as "long" | "short",
              quantity: contractsToClose,
              exitType: "TP2",
            })
          );
        }).catch((err: unknown) =>
          logger.error({ err, positionId: pos.id }, "SME: TP2 exit routing failed (paper sim unaffected)")
        );
      } else {
        await closePosition(pos.id, currentPrice, atr, { medianAtr });
        logger.info(
          {
            positionId: pos.id, strategyId, exitStyle, currentPrice,
            tp2Price: tp2Evidence.tp2_price, contractsToClose, correlationId, evidence,
          },
          "style_exit: TP2 filled — full position closed",
        );
        broadcastSSE(PAPER_EXIT_EVENTS.TP2_FILLED, exitPayloadBase);
        // SME Phase 0: full close = flatten
        _resolveSmeContextForExit(pos.sessionId, pos.id, pos.correlationId).then((smeCtx) => {
          if (!smeCtx) return;
          return import("./server-mediated-executor.js").then(({ routeLiveFlatten }) =>
            routeLiveFlatten({
              ctx: smeCtx,
              symbol: pos.symbol,
              side: pos.side as "long" | "short",
              quantity: contractsToClose,
              flattenReason: "TP2_FULL_CLOSE",
            })
          );
        }).catch((err: unknown) =>
          logger.error({ err, positionId: pos.id }, "SME: TP2 full-close flatten routing failed (paper sim unaffected)")
        );
        return true;
      }
      break;
    }

    case "MOVE_STOP_TO_BE": {
      if (pos.beStopApplied) {
        logger.debug({ positionId: pos.id }, "style_exit: BE already applied — idempotent HOLD");
        return false;
      }
      const oldStop = pos.trailHwm;
      await db.update(paperPositions).set({
        beStopApplied: true,
        trailHwm: new_stop != null ? String(new_stop) : pos.trailHwm,
        lastHandlerEvalAt: new Date(),
      }).where(eq(paperPositions.id, pos.id));
      logger.info(
        {
          positionId: pos.id, strategyId, exitStyle, oldStop, newStop: new_stop,
          correlationId, evidence,
        },
        "style_exit: BE stop applied — stop moved to break-even",
      );
      broadcastSSE(PAPER_EXIT_EVENTS.BE_STOP_MOVED, exitPayloadBase);
      // SME Phase 0: fire live BE stop move (fire-and-forget, isolated)
      if (new_stop != null) {
        _resolveSmeContextForExit(pos.sessionId, pos.id, pos.correlationId).then((smeCtx) => {
          if (!smeCtx) return;
          return import("./server-mediated-executor.js").then(({ routeLiveExitModify }) =>
            routeLiveExitModify({
              ctx: smeCtx,
              symbol: pos.symbol,
              side: pos.side as "long" | "short",
              newStopPrice: new_stop,
              modifyType: "BE_MOVE",
            })
          );
        }).catch((err: unknown) =>
          logger.error({ err, positionId: pos.id }, "SME: BE_MOVE routing failed (paper sim unaffected)")
        );
      }
      break;
    }

    case "TIGHTEN_TRAIL_TO_X": {
      if (new_stop == null) break;
      // Only update trail if X is tighter than current stop (closer to price)
      const currentTrail = pos.trailHwm != null ? Number(pos.trailHwm) : null;
      const isTighter = currentTrail == null || (
        pos.side === "long"  ? new_stop > currentTrail   // long: higher stop = tighter
                             : new_stop < currentTrail   // short: lower stop = tighter
      );
      if (isTighter) {
        const trailMethod = (evidence as Record<string, unknown>).trail_method as string ?? null;
        await db.update(paperPositions).set({
          trailHwm: String(new_stop),
          currentTrailMethod: trailMethod,
          lastHandlerEvalAt: new Date(),
        }).where(eq(paperPositions.id, pos.id));
        logger.debug(
          {
            positionId: pos.id, strategyId, exitStyle, oldStop: currentTrail, newStop: new_stop,
            trailMethod, correlationId,
          },
          "style_exit: trail tightened",
        );
        broadcastSSE(PAPER_EXIT_EVENTS.TRAIL_TIGHTENED, exitPayloadBase);
        // SME Phase 0: fire live trail update (fire-and-forget, isolated)
        _resolveSmeContextForExit(pos.sessionId, pos.id, pos.correlationId).then((smeCtx) => {
          if (!smeCtx) return;
          return import("./server-mediated-executor.js").then(({ routeLiveExitModify }) =>
            routeLiveExitModify({
              ctx: smeCtx,
              symbol: pos.symbol,
              side: pos.side as "long" | "short",
              newStopPrice: new_stop,
              modifyType: "TRAIL",
            })
          );
        }).catch((err: unknown) =>
          logger.error({ err, positionId: pos.id }, "SME: TRAIL update routing failed (paper sim unaffected)")
        );
      }
      break;
    }

    case "TIME_STOP_FLATTEN": {
      // Compute P&L at flatten for structured log
      const entryPx = Number(pos.entryPrice);
      const direction = pos.side === "long" ? 1 : -1;
      const spec = CONTRACT_SPECS[pos.symbol];
      const pnlAtFlatten = spec
        ? direction * (currentPrice - entryPx) * spec.pointValue * pos.contracts
        : null;
      // HIGH E-2 fix (deep-scan #16 wave-1 track-3): outcomeOverride="time_stop" is
      // now passed INTO closePosition() instead of incrementing paperTradesCounter a
      // second time here — this call site was double-counting every time-stop close.
      await closePosition(pos.id, currentPrice, atr, { medianAtr, outcomeOverride: "time_stop" });
      logger.info(
        {
          positionId: pos.id, strategyId, exitStyle, currentPrice, pnlAtFlatten,
          correlationId, evidence,
        },
        "style_exit: time-stop flatten executed at 15:55 ET",
      );
      broadcastSSE(PAPER_EXIT_EVENTS.TIME_STOP_FLATTENED, exitPayloadBase);
      // SME Phase 0: fire live 15:55 flatten (fire-and-forget; closePosition already ran paper sim)
      {
        const _smeContractsAtFlatten = pos.contracts; // capture before close mutates
        _resolveSmeContextForExit(pos.sessionId, pos.id, pos.correlationId).then((smeCtx) => {
          if (!smeCtx) return;
          return import("./server-mediated-executor.js").then(({ routeLiveFlatten }) =>
            routeLiveFlatten({
              ctx: smeCtx,
              symbol: pos.symbol,
              side: pos.side as "long" | "short",
              quantity: _smeContractsAtFlatten,
              flattenReason: "TIME_STOP_1555",
            })
          );
        }).catch((err: unknown) =>
          logger.error({ err, positionId: pos.id }, "SME: TIME_STOP_FLATTEN routing failed (paper sim unaffected)")
        );
      }
      return true;
    }

    default:
      // HOLD — no action
      break;
  }

  // Update lastHandlerEvalAt for HOLD decisions (throttled — only if not recently updated)
  if (decision === "HOLD") {
    await db.update(paperPositions).set({
      lastHandlerEvalAt: new Date(),
    }).where(eq(paperPositions.id, pos.id));
  }

  return false;
}

// ─── Update Position Prices ──────────────────────────────────

export async function updatePositionPrices(
  sessionId: string,
  prices: Record<string, PositionPriceUpdate>,
  /** Optional bar context for Track 3 Style D/C exit handler dispatch.
   *  When absent (legacy callers), exit handler dispatch is skipped. */
  exitBarContext?: StyleExitBarContext,
  context?: { correlationId?: string },
) {
  const correlationId = context?.correlationId ?? null;
  const openPositions = await db.select().from(paperPositions)
    .where(and(eq(paperPositions.sessionId, sessionId), isNull(paperPositions.closedAt)));

  // ── Track 3: Resolve session strategy_id once (not per-position) for audit rows.
  // Lazy-loaded so legacy callers that skip exitBarContext pay no extra DB cost.
  let sessionStrategyId: string | null | undefined = undefined;
  async function getSessionStrategyId(): Promise<string | null> {
    if (sessionStrategyId !== undefined) return sessionStrategyId;
    const sessions = await db.select({ strategyId: paperSessions.strategyId })
      .from(paperSessions).where(eq(paperSessions.id, sessionId)).limit(1);
    sessionStrategyId = sessions[0]?.strategyId ?? null;
    return sessionStrategyId;
  }

  let totalUnrealizedPnl = 0;
  let totalUnrealizedDelta = 0; // FIX 2 (B1): sum of (newUnrealized - prevUnrealized) across all positions
  let positionsUpdated = 0;
  // Track positions closed by exit handler so we skip their equity update
  const closedByExitHandler = new Set<string>();

  for (const pos of openPositions) {
    const rawUpdate = prices[pos.symbol];
    if (rawUpdate === undefined) continue;
    const { close: currentPrice, high, low } = normalizePriceUpdate(rawUpdate);
    // #11 gap-through-stop: the bar OPEN, only when a caller explicitly provides it (undefined otherwise).
    const barOpen = typeof rawUpdate === "object" && Number.isFinite(rawUpdate.open) ? (rawUpdate.open as number) : undefined;

    // SDL-1 (deep-scan 2026-07-11): a non-finite bar price (NaN/Infinity from a malformed feed) would
    // poison unrealizedPnl below -> corrupt currentEquity to NaN. The cross-symbol DLL / trailing-DD
    // capital-safety gates test `balance <= floor`, and NaN comparisons are ALWAYS false, so a NaN
    // equity silently fails those gates OPEN. Skip this position for this bar (never persist a NaN
    // P&L) and emit a visible audit row so the data-integrity gap is not silent.
    if (!Number.isFinite(currentPrice) || !Number.isFinite(high) || !Number.isFinite(low)) {
      logger.error(
        { sessionId, positionId: pos.id, symbol: pos.symbol, currentPrice, high, low },
        "paper-execution: non-finite bar price — skipping position for this bar (SDL-1 capital-safety guard)",
      );
      void insertAuditRowSafe({
        action: "paper.non_finite_bar_price_skipped",
        entityType: "paper_position",
        entityId: pos.id,
        decisionAuthority: "system",
        input: { session_id: sessionId, symbol: pos.symbol, currentPrice, high, low } as Record<string, unknown>,
        result: { skipped: true, reason: "non_finite_bar_price" } as Record<string, unknown>,
        status: "warning",
      });
      continue;
    }

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

    // H-1 fix: update running high/low since entry from this bar's OHLC extreme.
    // These are used by the chandelier and structure_trail methods so the stop level
    // rises with price (for longs) rather than staying pinned at entry price.
    // Prior: exitBarContext.highSinceEntry was never populated, so callExitHandler
    // always fell back to entryPrice → chandelier = entryPrice - 2*ATR (below BE) →
    // ratchet blocked it → trail permanently stuck at BE.
    const newHighSinceEntry = Math.max(
      pos.highSinceEntryPrice != null ? Number(pos.highSinceEntryPrice) : entryPrice,
      high,
    );
    const newLowSinceEntry = Math.min(
      pos.lowSinceEntryPrice != null ? Number(pos.lowSinceEntryPrice) : entryPrice,
      low,
    );

    // H-1 fix: inject per-position high/low into the shared exitBarContext so
    // callExitHandler's barCtx.highSinceEntry?.[pos.symbol] returns the correct value.
    // Per-symbol keying is safe when positions are one-per-symbol in a session.
    if (exitBarContext) {
      if (!exitBarContext.highSinceEntry) exitBarContext.highSinceEntry = {};
      if (!exitBarContext.lowSinceEntry)  exitBarContext.lowSinceEntry  = {};
      exitBarContext.highSinceEntry[pos.symbol] = newHighSinceEntry;
      exitBarContext.lowSinceEntry[pos.symbol]  = newLowSinceEntry;

      // Defect 4 fix: thread current bar's OHLC extremes so callExitHandler can pass
      // the intrabar favorable extreme to style_c_handler.py for TP detection.
      // This matches backtester.py which checks bar.high/bar.low against TP targets,
      // not bar.close — ensuring TP1 fires on intrabar touch even if price pulls back.
      if (!exitBarContext.barHigh) exitBarContext.barHigh = {};
      if (!exitBarContext.barLow)  exitBarContext.barLow  = {};
      exitBarContext.barHigh[pos.symbol] = high;
      exitBarContext.barLow[pos.symbol]  = low;
    }

    await db.update(paperPositions).set({
      currentPrice: String(currentPrice),
      unrealizedPnl: String(unrealizedPnl),
      previousUnrealizedPnl: String(unrealizedPnl),  // advance the stored baseline
      mae: String(nextMae),
      mfe: String(nextMfe),
      highSinceEntryPrice: String(newHighSinceEntry),
      lowSinceEntryPrice: String(newLowSinceEntry),
    }).where(eq(paperPositions.id, pos.id));

    totalUnrealizedPnl += unrealizedPnl;
    totalUnrealizedDelta += unrealizedDelta;
    positionsUpdated++;

    // ── BL-1 FIX: Intrabar stop-breach detection ─────────────────────────────
    // The backtester checks bar low/high against the stop price within each bar.
    // Without this check, a bar that touches the stop but closes above it (for longs)
    // would NOT be closed — creating an optimistic parity gap vs backtest.
    //
    // Stop level precedence (same as Python handler):
    //   1. trailHwm  — explicit stop after BE move or trail tighten
    //   2. initialStopPrice — initial structural stop set at entry from ATR×2.0
    //   (null → skip; stop breach not detectable without a stored stop level)
    //
    // Closed at the stop PRICE (not the adverse extreme) to match backtester fill model.
    // This block runs BEFORE the adaptive trail and Python handler so a stop-closed
    // position is not processed further.
    {
      const stopLevel =
        pos.trailHwm != null ? Number(pos.trailHwm)
        : pos.initialStopPrice != null ? Number(pos.initialStopPrice)
        : null;

      if (stopLevel != null) {
        const stopBreached = pos.side === "long"
          ? adversePrice <= stopLevel   // bar low breached below stop
          : adversePrice >= stopLevel;  // bar high breached above stop (short)

        if (stopBreached) {
          const atrForClose = exitBarContext?.atr14[pos.symbol];
          const medianAtrForClose = exitBarContext?.medianAtr14?.[pos.symbol];
          try {
            // HIGH E-2 fix (deep-scan #16 wave-1 track-3): outcomeOverride="stop_loss" is
            // now passed INTO closePosition() instead of incrementing paperTradesCounter a
            // second time here — this call site was double-counting every intrabar stop.
            // deep-scan 2026-07-11 MED fix (#11): model gap-through-stop parity with the backtester.
            // backtester.py fills a bar that OPENS beyond the stop at the gapped OPEN (a worse price)
            // and counts gap_through_stop; paper previously filled at `stopLevel` UNCONDITIONALLY,
            // understating losses on gap bars → inflated internal-sim Sharpe/PF vs the backtest the
            // promotion gates trust. When the caller provides the bar open, fill at the WORSE of
            // open/stop; absent an open, fall back to the stop (best available — the legacy behavior).
            const stopFillPrice = barOpen != null
              ? (pos.side === "long" ? Math.min(barOpen, stopLevel) : Math.max(barOpen, stopLevel))
              : stopLevel;
            await closePosition(pos.id, stopFillPrice, atrForClose, { correlationId: correlationId ?? undefined, medianAtr: medianAtrForClose, outcomeOverride: "stop_loss" });
            closedByExitHandler.add(pos.id);
            totalUnrealizedDelta -= unrealizedDelta;
            totalUnrealizedPnl   -= unrealizedPnl;
            logger.info(
              {
                positionId: pos.id, sessionId, symbol: pos.symbol, side: pos.side,
                stopLevel, adversePrice, high, low, currentPrice, correlationId,
              },
              "paper.stop_breach: position closed at stop level (intrabar adverse extreme crossed stop)",
            );
            db.insert(auditLog).values({
              action: "paper.stop_breach",
              entityType: "paper_position",
              entityId: pos.id,
              decisionAuthority: "system",
              input: { stopLevel, adversePrice, high, low, currentPrice, trailHwm: pos.trailHwm, initialStopPrice: pos.initialStopPrice } as Record<string, unknown>,
              result: { closed: true, exitPrice: stopLevel } as Record<string, unknown>,
              status: "success",
              correlationId: correlationId ?? null,
            }).catch((err) => logger.warn({ err }, "stop_breach audit write failed (non-blocking)"));
            broadcastSSE("paper:position-stop-breached", {
              positionId: pos.id, sessionId, symbol: pos.symbol, side: pos.side,
              stopLevel, adversePrice, currentPrice,
              correlationId: correlationId ?? null,
            });
          } catch (stopCloseErr) {
            logger.error(
              { err: stopCloseErr, positionId: pos.id, stopLevel, adversePrice, correlationId },
              "paper.stop_breach: closePosition FAILED — position NOT closed; HOLD until next bar",
            );
          }
          continue; // skip trail + handler for this position regardless of close outcome
        }
      }
    }

    // ── Wave 25.5 Track 1 Gap C: Adaptive runner trail execution ─────────────
    // For positions with exit_plan.runner.trail_method set, compute the
    // adaptive trail stop and tighten trailHwm if the new value is tighter.
    // The Python style_c_handler still handles TP1/TP2/BE/TIME_STOP invariants.
    // This block only updates the TRAIL level — all other exit decisions remain
    // with the Python handler below (unchanged).
    //
    // HARD INVARIANTS (preserved — this block CANNOT override):
    //   - 15:55 ET hard flatten: TIME_STOP_FLATTEN decision made by Python handler
    //   - BE+1 tick on TP1 fill: handled by tp1BeStopMap in paper-signal-service.ts
    //     (TS-side absolute_level stop, NOT a Python MOVE_STOP_TO_BE decision —
    //      style_c_handler.py does NOT emit MOVE_STOP_TO_BE; only style_d_handler does)
    //   - 67% DLL halt: enforced upstream in openPosition (not in trail logic)
    //   - Per-symbol liquidity caps: enforced upstream in openPosition
    //
    // Fallback: any error in adaptive trail computation → skip trail update for
    // this bar (HOLD trail, Python handler still decides TP/BE/TIME_STOP).
    if (exitBarContext && pos.exitPlan != null) {
      try {
        const exitPlanRow = pos.exitPlan as ExitPlanWithRuntimeState;
        const trailMethod = exitPlanRow.runner?.trail_method;
        const atrAtEntry = exitBarContext.atr14[pos.symbol] ?? 0;
        const ATR_TRAIL_CUSHION_MULTIPLIER = 1.0; // named constant per CLAUDE.md §13 no-magic-numbers
        let computedTrail: number | null = null;
        let updatedRuntimeState: ExitPlanWithRuntimeState["runtime_state"] | null = null;

        switch (trailMethod) {
          case "anchored_vwap": {
            // Per-position running ΣP·V / ΣV from entry timestamp.
            // State: exit_plan.runtime_state.{ sum_pv, sum_v }
            // F-a parity fix: trail = anchored VWAP - 1×tickSize for longs
            //                       = anchored VWAP + 1×tickSize for shorts
            // Matches backtester.py lines 1568/1571: avwap_price - tick / avwap_price + tick.
            // Prior cushion (1×ATR14) was too wide, inflating paper Sharpe vs backtest.
            const prevState = exitPlanRow.runtime_state ?? {};
            const prevSumPv = prevState.sum_pv ?? 0;
            const prevSumV  = prevState.sum_v  ?? 0;
            // Wave 26: barVol is now wired from bar.volume at processSessionBar call sites.
            // Fallback to 1 (unit-vol) when the caller omits barVol (legacy callers,
            // test fixtures, or markets with zero/missing volume data).
            // Unit-vol fallback degrades AVWAP to a simple price average — still a valid
            // trailing reference, just not truly volume-weighted.
            const rawBarVol = exitBarContext.barVol?.[pos.symbol];
            const barVol = rawBarVol != null && rawBarVol > 0 ? rawBarVol : 1;
            // F2 (deep-scan 2026-07-11): AVWAP must use the TYPICAL price (high+low+close)/3 to match
            // the backtester oracle (backtester.py:2083 `typical_price = (bar_high+bar_low+close)/3`).
            // Paper previously used close alone, so the anchored VWAP (and its trail stop / exit
            // price) diverged from backtest on any bar whose close skews to one end of the range —
            // violating the TS<->Python Exit Engine Parity contract.
            const barMid = avwapTypicalPrice(high, low, currentPrice);
            const newSumPv = prevSumPv + barMid * barVol;
            const newSumV  = prevSumV  + barVol;
            const avwap = newSumV > 0 ? newSumPv / newSumV : currentPrice;
            // 1×tick cushion per-symbol — mirrors backtester.py avwap_price ± tick.
            const avwapTickCushion = CONTRACT_SPECS[pos.symbol as keyof typeof CONTRACT_SPECS]?.tickSize ?? 0.25;
            computedTrail = pos.side === "long" ? avwap - avwapTickCushion : avwap + avwapTickCushion;
            updatedRuntimeState = { ...prevState, sum_pv: newSumPv, sum_v: newSumV, avwap };
            break;
          }

          case "developing_poc": {
            // Style C legacy behavior — developingSessionPoc from exitBarContext.
            // This is the SAME logic as the Python style_c_handler POC trail.
            // By mapping this case to the existing POC data, we preserve exact parity.
            const poc = exitBarContext.developingSessionPoc?.[pos.symbol] ?? null;
            if (poc != null) {
              const cushion = ATR_TRAIL_CUSHION_MULTIPLIER * atrAtEntry;
              computedTrail = pos.side === "long" ? poc - cushion : poc + cushion;
            }
            // No runtime_state needed for developing_poc (stateless)
            break;
          }

          case "chandelier": {
            // H-1 FIX: Chandelier(14, 2.0) now reads highSinceEntryPrice / lowSinceEntryPrice
            // from the DB row (updated every bar from bar.high/low above).
            // Prior to this fix, exitBarContext.highSinceEntry was never populated so the
            // chandelier was computed from entryPrice — always below the BE stop, so the
            // ratchet blocked it and the trail was permanently stuck at BE.
            //
            // For longs:  trail = highSinceEntryPrice - (2.0 × atrAtEntry)
            // For shorts: trail = lowSinceEntryPrice  + (2.0 × atrAtEntry)
            const CHANDELIER_MULTIPLIER = 2.0;
            const highSince = newHighSinceEntry;   // already computed above from this bar's data
            const lowSince  = newLowSinceEntry;
            computedTrail = pos.side === "long"
              ? highSince - CHANDELIER_MULTIPLIER * atrAtEntry
              : lowSince  + CHANDELIER_MULTIPLIER * atrAtEntry;
            break;
          }

          case "structure_trail": {
            // Per-position swing-low/high tracker.
            // For longs:  trail = current_swing_low - (ATR_TRAIL_CUSHION_MULTIPLIER × atr)
            // For shorts: trail = current_swing_high + cushion
            // State: exit_plan.runtime_state.{ current_swing_low, current_swing_high }
            // We update the swing tracker using last2barSwingLow/High from exitBarContext.
            const prevState = exitPlanRow.runtime_state ?? {};
            const entryPx   = Number(pos.entryPrice);

            if (pos.side === "long") {
              const newSwingLow = exitBarContext.last2barSwingLow?.[pos.symbol] ?? null;
              // Only track swing lows BELOW the entry (otherwise it's not a valid stop level)
              const prevSwingLow = prevState.current_swing_low ?? entryPx;
              const trackedSwingLow = newSwingLow != null && newSwingLow < currentPrice
                ? Math.max(prevSwingLow, newSwingLow) // use highest (most recent) valid swing low
                : prevSwingLow;
              const cushion = ATR_TRAIL_CUSHION_MULTIPLIER * atrAtEntry;
              computedTrail = trackedSwingLow - cushion;
              updatedRuntimeState = { ...prevState, current_swing_low: trackedSwingLow };
            } else {
              const newSwingHigh = exitBarContext.last2barSwingHigh?.[pos.symbol] ?? null;
              const prevSwingHigh = prevState.current_swing_high ?? entryPx;
              const trackedSwingHigh = newSwingHigh != null && newSwingHigh > currentPrice
                ? Math.min(prevSwingHigh, newSwingHigh)
                : prevSwingHigh;
              const cushion = ATR_TRAIL_CUSHION_MULTIPLIER * atrAtEntry;
              computedTrail = trackedSwingHigh + cushion;
              updatedRuntimeState = { ...prevState, current_swing_high: trackedSwingHigh };
            }
            break;
          }

          default:
            // Unknown trail_method → fallback to Style C POC trail (developingSessionPoc)
            {
              const poc = exitBarContext.developingSessionPoc?.[pos.symbol] ?? null;
              if (poc != null) {
                computedTrail = poc - ATR_TRAIL_CUSHION_MULTIPLIER * atrAtEntry;
              }
            }
        }

        // Tighten trailHwm if computedTrail is tighter than current (ratchet-only).
        if (computedTrail != null) {
          const currentTrailHwm = pos.trailHwm != null ? Number(pos.trailHwm) : null;
          // F1 (deep-scan 2026-07-11): mirror the backtester's runner-trail parity —
          // (1) advance the trail ONLY after TP2 fills (backtester.py:2088 `if tp2_filled:`);
          //     before TP2 the stop holds at the structural initial stop. The AVWAP accumulator
          //     (updatedRuntimeState) still persists every bar via the else-if below, matching
          //     backtester.py:2078-2085 ("accumulate every bar from entry so TP2 has AVWAP ready").
          // (2) floor the ratchet at initialStopPrice: treat a null trailHwm as the structural stop
          //     so the FIRST write can never be LOOSER than the stop the trade was sized against
          //     (prior `currentTrailHwm == null` unconditionally accepted the first computedTrail,
          //     which for chandelier/near-entry AVWAP could sit at ~break-even, forcing premature
          //     exits, or wider than the structural stop, over-risking beyond the sized amount).
          const isTighter = shouldAdvanceRunnerTrail({
            side: pos.side,
            computedTrail,
            currentTrailHwm,
            initialStop: pos.initialStopPrice != null ? Number(pos.initialStopPrice) : null,
            tp1Filled: pos.tp1Filled ?? false,
            tp2Filled: pos.tp2Filled ?? false,
          });

          if (isTighter) {
            // Build updated exit_plan with new runtime_state
            const updatedExitPlan: ExitPlanWithRuntimeState = {
              ...exitPlanRow,
              runtime_state: updatedRuntimeState ?? exitPlanRow.runtime_state ?? {},
            };
            await db.update(paperPositions).set({
              trailHwm: String(computedTrail),
              currentTrailMethod: trailMethod ?? "adaptive",
              exitPlan: updatedExitPlan,
            }).where(eq(paperPositions.id, pos.id));

            logger.debug(
              {
                positionId: pos.id, sessionId, trailMethod, computedTrail,
                oldTrail: currentTrailHwm, atrAtEntry, correlationId,
              },
              "wave25.5: adaptive trail tightened",
            );
            broadcastSSE(PAPER_EXIT_EVENTS.TRAIL_TIGHTENED, {
              position_id: pos.id,
              decision_type: "TIGHTEN_TRAIL_TO_X",
              evidence: { trail_method: trailMethod, new_stop: computedTrail, source: "adaptive" },
              correlation_id: correlationId ?? null,
            });
          } else if (updatedRuntimeState != null) {
            // Trail not tighter but runtime_state changed — persist state update only
            const updatedExitPlan: ExitPlanWithRuntimeState = {
              ...exitPlanRow,
              runtime_state: updatedRuntimeState,
            };
            await db.update(paperPositions).set({
              exitPlan: updatedExitPlan,
            }).where(eq(paperPositions.id, pos.id));
          }
        }
      } catch (adaptiveTrailErr) {
        // Fail-soft: adaptive trail error does not block position management.
        // Python handler below still fires TP/BE/TIME_STOP decisions.
        logger.warn(
          { positionId: pos.id, sessionId, err: String(adaptiveTrailErr), correlationId },
          "wave25.5: adaptive trail computation failed — HOLD trail, Python handler proceeds",
        );
      }
    }

    // ── Track 3: Style D/C exit handler dispatch ─────────────────────────────
    // Only dispatched when the caller supplies exitBarContext. Legacy callers
    // that don't supply it continue using ATR-based exits unchanged.
    // Pipeline pause guard: if pipeline is inactive, skip dispatch (positions
    // remain open, no exit decisions are made — safe state).
    if (exitBarContext && (await isPipelineActive())) {
      try {
        const stratId = await getSessionStrategyId();
        const handlerResult = await callExitHandler(pos, exitBarContext, stratId, correlationId);
        const atr14ForClose = exitBarContext.atr14[pos.symbol];
        const medianAtr14ForClose = exitBarContext.medianAtr14?.[pos.symbol]; // BL-8 fix
        let positionClosed = await applyExitDecision(
          pos, handlerResult,
          (pos.currentExitStyle ?? "C") as "D" | "C",  // Wave 24: Style D dead — default C
          stratId, currentPrice, atr14ForClose, correlationId, medianAtr14ForClose,
        );

        // F4: same-bar TP1+TP2 sequential evaluation for Style C within-bar sweeps.
        // When TP1 partially closed (not a full close), re-invoke the handler exactly ONCE
        // with the post-TP1 position state — Style C has 2 TP legs so this caps at 1
        // re-invocation and prevents infinite loops.
        // NOTE: Python re-callable contract (style_c_handler.py with tp1_filled=true) is
        // owned by the Python track. This TS side dispatches a second call when TP1 fills
        // and books FILL_TP2 if the handler returns it. If Python is not yet re-callable,
        // callExitHandler will return HOLD and this block is a no-op (safe default).
        //
        // IMPORTANT: do NOT do a DB round-trip here to re-read the updated position.
        // Deep-scan #5 LOW (2026-06-29): bookPartialClose is now AWAITED and commits the
        // position-state advance inside its own transaction (the prior "fire-and-forget /
        // concurrent select races this re-read" note was obsolete after the 2026-06-29 Fix-1
        // await + the atomic-state-advance fix). We still construct updatedPos in memory rather
        // than re-reading because it is race-free and more efficient — we know exactly what
        // applyExitDecision committed: tp1Filled=true + contracts decremented.
        if (!positionClosed && handlerResult.decision === "FILL_TP1_50PCT") {
          try {
            const tp1ExitStyle   = (pos.currentExitStyle ?? "C") as "D" | "C";
            const tp1Fraction    = tp1ExitStyle === "C" ? 0.33 : 0.50;
            const tp1ClosedCount = Math.max(1, Math.floor(pos.contracts * tp1Fraction));
            // Guard: tp1ClosedCount < pos.contracts is always true here (full close returns
            // positionClosed=true which prevents entering this block). Kept as a safety fence.
            if (tp1ClosedCount < pos.contracts) {
              const updatedPos = {
                ...pos,
                tp1Filled: true,
                contracts: pos.contracts - tp1ClosedCount,
              } as typeof pos;
              const tp2Result = await callExitHandler(updatedPos, exitBarContext, stratId, correlationId);
              if (tp2Result.decision !== "HOLD") {
                const tp2Closed = await applyExitDecision(
                  updatedPos, tp2Result,
                  (updatedPos.currentExitStyle ?? "C") as "D" | "C",
                  stratId, currentPrice, atr14ForClose, correlationId, medianAtr14ForClose,
                );
                if (tp2Closed) positionClosed = true;
              }
            }
          } catch (tp2Err) {
            logger.warn(
              { positionId: pos.id, err: String(tp2Err), correlationId },
              "F4: same-bar TP2 re-invocation failed (non-blocking — position holds current state)",
            );
          }
        }

        if (positionClosed) {
          closedByExitHandler.add(pos.id);
          // Closed positions must NOT contribute to the MTM equity delta below —
          // closePosition already applied the realized P&L atomically.
          totalUnrealizedDelta -= unrealizedDelta;
          totalUnrealizedPnl   -= unrealizedPnl;
          positionsUpdated--;
        }
      } catch (handlerErr) {
        // Fail-CLOSED already handled inside callExitHandler; this catches
        // any unexpected outer error (e.g. applyExitDecision throw).
        logger.error(
          { positionId: pos.id, err: String(handlerErr), correlationId },
          "Outer exit handler dispatch error — HOLD applied, position preserved",
        );
      }
    } else if (exitBarContext) {
      logger.debug(
        { positionId: pos.id, sessionId, correlationId },
        "Style D/C dispatch skipped — pipeline paused. Position held.",
      );
    }
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
  //
  // W12 Bug #2 fix: peakEquity is intentionally NOT updated here from unrealized P&L.
  // Per Topstep/Apex EOD trailing-DD spec, the high-water-mark must update from
  // CLOSED equity only. Updating HWM from MTM over-tightens the trailing floor
  // and triggers false breaches. realizedPeakEquity (updated in closePosition) is
  // the authoritative trailing-DD HWM. peakEquity is a UI-only display column.
  if (positionsUpdated > 0 && totalUnrealizedDelta !== 0) {
    await db.update(paperSessions).set({
      currentEquity: sql`${paperSessions.currentEquity}::numeric + ${totalUnrealizedDelta}`,
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
          // deepscan14 E3: roll-day flatten failure was silent (logger.error + a
          // calendar_error result row only) — a position that MUST flatten before
          // contract expiry can stay open through rollover with no operator signal.
          // Mirror the kill-switch.ts force-flatten-failed pattern: audit + Discord.
          const closeErrMsg = closeErr instanceof Error ? closeErr.message : String(closeErr);
          logger.error(
            { sessionId, positionId: pos.id, symbol: pos.symbol, err: closeErr },
            "Roll handler: closePosition failed — position NOT closed",
          );
          notifyCritical(
            "Roll-day flatten failed",
            appendFamilyGradePostscript(
              `closePosition failed for ${pos.symbol} (position ${pos.id}, session ${sessionId}) ahead of contract roll: ${closeErrMsg}. ` +
              `Position may remain open through rollover — IMMEDIATE MANUAL REVIEW REQUIRED.`,
              "The trading bot hit an error trying to close a position before its futures contract rolls to the next month.",
              "This position may stay open longer than intended. Tell Tony right away.",
            ),
            { sessionId, positionId: pos.id, symbol: pos.symbol, rollDate: info.roll_date, correlationId },
          );
          await insertAuditRowSafe({
            action: "paper.roll_flatten_failed",
            entityType: "paper_position",
            entityId: pos.id,
            decisionAuthority: "system",
            input: { sessionId, symbol: pos.symbol, rollDate: info.roll_date, flattenDate: info.flatten_date } as Record<string, unknown>,
            result: { error: closeErrMsg, position_may_still_be_open: true } as Record<string, unknown>,
            status: "error",
            correlationId,
          });
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
          correlationId,
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
          correlationId,
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

// ─── Phase 4C: Force-flatten all open positions ───────────────────────────────
//
// Called by kill-switch.ts setMode('HALT') via dynamic import to avoid a
// circular module dependency:
//   kill-switch.ts (production/) → paper-execution-service.ts (services/)
//
// Closes every open paper position at the CURRENT MARKET PRICE (mark-to-market).
// Each close writes its own audit_log + SSE via the normal closePosition path.
//
// FINDING #1 FIX: Previously used entryPrice as the exit price, booking $0
// realized P&L on every force-flatten. That silently corrupted session equity,
// Sharpe, realized-DLL checks, and promotion analytics at the worst moment (a
// halt). Fix: select currentPrice from the position row and use it as the close
// price. If currentPrice is null/zero for a position, fail loud with an audit
// row and SKIP that position (do not silently book $0).
//
// FINDING #8 FIX: Generate ONE batch correlationId at the top of this function.
// Use it for the batch audit row AND thread it into every per-position
// closePosition call, so the halt→flatten→per-position chain is linkable in
// the audit_log for 90-day reconstruction.
//
// Callers: kill-switch.ts:setMode('HALT') / kill-switch.ts checkLayer2DailyLoss
// (account-scoped) / openPosition D6 / paper-signal-service.ts cross-symbol
// force-close. Do NOT call from any per-bar hot path — this is a rare,
// halt/breach-triggered emergency action.
//
// deepscan17 (2026-07-05) C-1 fix: this query previously had NO account/firm/
// session filter — `.where(isNull(paperPositions.closedAt))` alone flattened
// EVERY open position system-wide, so a single account's DLL-95% breach force-
// closed every OTHER healthy account/firm sharing the process. `opts.scope`
// narrows the flatten to one account (via resolveAccountKey, the same key
// cross-symbol-pnl.ts uses for DLL aggregation) or an explicit session-id list.
// Omitting scope preserves the original system-wide behavior for the two
// legitimate system-wide callers (operator HALT via setMode, and any future
// deliberate full-flatten path) — no existing caller's behavior changes unless
// it opts in to a scope.
//
// deepscan17 E-1 fix: opts.correlationId lets the caller thread its own root
// correlationId through the whole force-close so the halt->flatten->per-position
// chain is linkable end-to-end in the audit_log. Defaults to a fresh randomUUID()
// when the caller has none (unchanged behavior for callers that don't pass one).
export interface ForceCloseScope {
  /** Resolved account key (see cross-symbol-pnl.ts::resolveAccountKey) — flattens only this account's open positions. */
  accountKey?: string;
  /** Explicit session-id allowlist — takes priority over accountKey when both are set. */
  sessionIds?: string[];
}

export async function forceCloseAllPositions(
  reason: string,
  opts: { correlationId?: string; scope?: ForceCloseScope } = {},
): Promise<{ count: number; closed: number; stuck: number }> {
  // FINDING #8 FIX: generate a single batch correlationId that links the batch
  // audit row to every per-position closePosition call in this flatten sweep.
  // deepscan17 E-1: prefer the caller's correlationId when supplied.
  const batchCorrelationId = opts.correlationId ?? randomUUID();
  const scope = opts.scope;

  const openPositionsRaw = await db
    .select({
      id: paperPositions.id,
      sessionId: paperPositions.sessionId,
      symbol: paperPositions.symbol,
      side: paperPositions.side,
      entryPrice: paperPositions.entryPrice,
      currentPrice: paperPositions.currentPrice,
      // FINDING #5 FIX: fetch initialStopPrice so we can back-derive an ATR estimate
      // for realistic exit slippage on forced closes. Without ATR, closePosition used
      // base-tick slippage (optimistic vs Python which ATR-scales all fills including halts).
      initialStopPrice: paperPositions.initialStopPrice,
    })
    .from(paperPositions)
    .where(isNull(paperPositions.closedAt));

  // deepscan17 C-1 fix: apply scope in application code (not the query) so the
  // unscoped default path's query shape — and every existing test mock for it —
  // is byte-identical to pre-fix behavior. sessionIds takes priority when both
  // scope fields are set (explicit list is unambiguous); accountKey requires a
  // second lightweight query to resolve each open position's owning session to
  // an account key, mirroring cross-symbol-pnl.ts's own resolution pattern.
  let openPositions = openPositionsRaw;
  if (scope?.sessionIds && scope.sessionIds.length > 0) {
    const idSet = new Set(scope.sessionIds);
    openPositions = openPositionsRaw.filter((p) => p.sessionId && idSet.has(p.sessionId));
  } else if (scope?.accountKey) {
    const sessionIds = [...new Set(openPositionsRaw.map((p) => p.sessionId).filter((id): id is string => !!id))];
    if (sessionIds.length === 0) {
      openPositions = [];
    } else {
      const sessionRows = await db
        .select({ id: paperSessions.id, firmId: paperSessions.firmId, config: paperSessions.config })
        .from(paperSessions)
        .where(inArray(paperSessions.id, sessionIds));
      const keyBySession = new Map(sessionRows.map((s) => [s.id, resolveAccountKey(s)]));
      openPositions = openPositionsRaw.filter((p) => p.sessionId && keyBySession.get(p.sessionId) === scope.accountKey);
    }
  }

  const count = openPositions.length;

  if (count === 0) {
    logger.info({ reason, batchCorrelationId }, "paper-execution.force-flatten: no open positions to close");
  } else {
    logger.warn({ reason, count, batchCorrelationId }, "paper-execution.force-flatten: closing all open positions due to production halt");
  }

  const errors: string[] = [];
  const skipped: string[] = [];
  let closedCount = 0;
  let stuckCount = 0;

  for (const pos of openPositions) {
    // FINDING #1 FIX: use currentPrice (mark-to-market), not entryPrice.
    // currentPrice is updated by updatePositionPrices on every bar tick and
    // reflects the last known market price for the position's symbol.
    const rawCurrent = Number(pos.currentPrice ?? 0);

    // FINDING #5 FIX: back-derive an approximate ATR from the stored initialStopPrice so
    // forced-exit slippage is ATR-scaled (matching Python which ATR-scales all fills).
    // Formula mirrors openPosition: stopPrice = entryPrice ± atr×2.0  →  atr = |entry-stop|/2.
    // When initialStopPrice is absent (positions opened before BL-1 fix), atr stays undefined
    // and closePosition falls back to base-tick slippage (prior conservative behaviour).
    const derivedAtr = (() => {
      const stopNum = Number(pos.initialStopPrice ?? 0);
      const entryNum = Number(pos.entryPrice ?? 0);
      if (!stopNum || !entryNum || !isFinite(stopNum) || !isFinite(entryNum)) return undefined;
      const atrEstimate = Math.abs(entryNum - stopNum) / 2.0;
      return atrEstimate > 0 ? atrEstimate : undefined;
    })();

    if (!rawCurrent || !isFinite(rawCurrent)) {
      // GAP-2 FIX: currentPrice is null/zero — attempt entryPrice as fallback before giving up.
      // Using entryPrice closes the position at $0 realized P&L (entry == exit), which is
      // suboptimal for analytics but is FAR better than leaving the position open during a halt.
      // We emit a distinct WARN audit to make the fallback visible for post-incident review.
      const rawEntry = Number(pos.entryPrice ?? 0);

      if (rawEntry && isFinite(rawEntry)) {
        // Fallback: close at entryPrice ($0 realized P&L). Emit WARN audit so analytics
        // pipelines can identify and flag this trade for manual review.
        logger.warn(
          { positionId: pos.id, symbol: pos.symbol, reason, batchCorrelationId,
            entryPrice: pos.entryPrice, currentPrice: pos.currentPrice },
          "paper-execution.force-flatten: currentPrice missing — using entryPrice as fallback (closes at $0 P&L; position is closed)",
        );
        db.insert(auditLog).values({
          action: "paper.force_flatten_fallback_entry_price",
          entityType: "paper_position",
          entityId: pos.id,
          decisionAuthority: "system",
          input: { reason, positionId: pos.id, symbol: pos.symbol, entryPrice: pos.entryPrice, fallbackPrice: rawEntry } as Record<string, unknown>,
          // M-4: flag the zero-PnL proxy close so promotion-gate math can detect the
          // contaminated session (entryPrice == exitPrice → finalPnl understated).
          result: { reason: "no_current_price_fallback_to_entry", batchCorrelationId, pnl_impact: 0, force_close_price_unconfirmed: true } as Record<string, unknown>,
          status: "warning",
          correlationId: batchCorrelationId,
        }).catch((err) => logger.error({ err }, "paper-execution.force-flatten: fallback audit write failed (non-blocking)"));

        try {
          // M-4: thread the unconfirmed-price marker into the trade_close write so
          // the paper_trades close row's audit carries the contamination flag too.
          // HIGH E-2 fix (deep-scan #16 wave-1 track-3): outcomeOverride="force_close" is
          // now passed INTO closePosition() instead of incrementing paperTradesCounter a
          // second time here — this call site was double-counting every force-close.
          await closePosition(pos.id, rawEntry, derivedAtr, { correlationId: batchCorrelationId, forceClosePriceUnconfirmed: true, outcomeOverride: "force_close" });
          closedCount++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`pos:${pos.id} err:${msg}`);
          logger.error({ err, positionId: pos.id, reason, batchCorrelationId }, "paper-execution.force-flatten: closePosition (entryPrice fallback) failed (continuing)");
        }
        continue;
      }

      // GAP-2 FIX: Both currentPrice AND entryPrice are unavailable.
      // This is a CRITICAL failure — the position CANNOT be closed automatically.
      // Escalate: CRITICAL alert + distinct stuck audit + register session in stuckSessionIds.
      stuckCount++;
      const stuckMsg = `pos:${pos.id} symbol:${pos.symbol} — no currentPrice OR entryPrice; position STUCK (manual close required)`;
      skipped.push(stuckMsg);
      logger.error(
        { positionId: pos.id, symbol: pos.symbol, reason, batchCorrelationId,
          entryPrice: pos.entryPrice, currentPrice: pos.currentPrice },
        "paper-execution.force-flatten: CRITICAL — no price available, position STUCK open after halt. Manual close required.",
      );

      // Fire a CRITICAL alert — this is not a soft skip, it is a material breach risk.
      AlertFactory.criticalAlert("force-flatten-stuck-position", {
        positionId: pos.id,
        sessionId: pos.sessionId,
        symbol: pos.symbol,
        reason,
        batchCorrelationId,
        message: `CRITICAL: Force-flatten could not close position ${pos.id} (${pos.symbol}) — no price available. Manual close required immediately.`,
      });

      // Write the CRITICAL stuck audit (distinct from the old soft paper.force_flatten_position_skipped)
      db.insert(auditLog).values({
        action: "paper.force_flatten_stuck",
        entityType: "paper_position",
        entityId: pos.id,
        decisionAuthority: "system",
        input: { reason, positionId: pos.id, symbol: pos.symbol, entryPrice: pos.entryPrice, currentPrice: pos.currentPrice } as Record<string, unknown>,
        result: { reason: "no_price_position_stuck", batchCorrelationId } as Record<string, unknown>,
        status: "error",
        correlationId: batchCorrelationId,
      }).catch((err) => logger.error({ err }, "paper-execution.force-flatten: stuck audit write failed (non-blocking)"));

      // Register this session as having a stuck position so openPosition is blocked
      // until the operator manually resolves it (see stuckSessionIds Set above).
      if (pos.sessionId) {
        stuckSessionIds.add(pos.sessionId);
      }
      continue;
    }

    try {
      // Close at mark-to-market (currentPrice). Thread the batchCorrelationId so
      // this close is linkable to the halt event in the audit_log.
      // HIGH E-2 fix (deep-scan #16 wave-1 track-3): outcomeOverride="force_close" is
      // now passed INTO closePosition() instead of incrementing paperTradesCounter a
      // second time here — this call site was double-counting every force-close.
      await closePosition(pos.id, rawCurrent, derivedAtr, { correlationId: batchCorrelationId, outcomeOverride: "force_close" });
      closedCount++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`pos:${pos.id} err:${msg}`);
      logger.error({ err, positionId: pos.id, reason, batchCorrelationId }, "paper-execution.force-flatten: closePosition failed for one position (continuing)");
    }
  }

  // Audit log the batch flatten event (FINDING #8 FIX: non-null correlationId)
  // deepscan17 C-1: record the scope so an audit reader can see whether this
  // was an account-scoped flatten (breach containment) or a system-wide one
  // (operator HALT) — the two have very different blast radii.
  db.insert(auditLog).values({
    action: "paper.force_flatten_all",
    entityType: "system",
    entityId: null,
    decisionAuthority: "system",
    input: { reason, scope: scope ?? "system_wide" } as Record<string, unknown>,
    result: { reason, count, closed: closedCount, stuck: stuckCount, errors, skipped } as Record<string, unknown>,
    status: errors.length === 0 && stuckCount === 0 ? "success" : "partial_failure",
    correlationId: batchCorrelationId,
  }).catch((err) => logger.error({ err }, "paper-execution.force-flatten: audit_log write failed (non-blocking)"));

  broadcastSSE("paper:force-flatten-all", { reason, count, closed: closedCount, stuck: stuckCount, errors: errors.length, skipped: skipped.length, scope: scope ?? null, correlationId: batchCorrelationId });

  return { count, closed: closedCount, stuck: stuckCount };
}
