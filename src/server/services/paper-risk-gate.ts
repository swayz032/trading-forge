import { db } from "../db/index.js";
import { paperSessions, paperPositions } from "../db/schema.js";
import { eq, and, isNull } from "drizzle-orm";
import { logger } from "../lib/logger.js"; // Obs HIGH-1 2026-06-29: leaf import, not ../index.js
import { insertAuditRowSafe } from "../lib/audit-log-helper.js"; // Obs HIGH-1 2026-06-29: durable gate-block audit rows
import { getFirmAccount, getTightestDrawdown, type FirmAccountConfig } from "../../shared/firm-config.js";
import { tracer } from "../lib/tracing.js";
import { isUsDst } from "../lib/dst-utils.js";

// ── F-1 Fix: halt new entries at DLL_HALT_PCT × firmDLL (matching kill-switch Layer 2) ──
// CLAUDE.md §4: "HALT new entries at 67% (env: DLL_HALT_PCT)"
// kill-switch.ts:347 correctly halts at DLL_HALT_PCT * dll.
// paper-risk-gate previously compared todayLoss >= firmDLL (100%) — allowing
// entries between 67% and 100% that kill-switch.ts would block on the same path.
// Fix: use the same DLL_HALT_PCT env var so both gates halt at the same threshold.
const DLL_HALT_PCT = parseFloat(process.env.DLL_HALT_PCT ?? "0.67");
// isUsDst is imported from the shared dst-utils utility.
// The inline implementation has been removed; the canonical version
// lives in src/server/lib/dst-utils.ts and is the same algorithm.

// ─── ET date helpers ─────────────────────────────────────────────────────────
//
// Two distinct date-string functions serve different purposes:
//
//   toEasternDateString — ET calendar midnight boundary.
//     Used for VWAP buffer resets, skipDecisions lookups, and any query
//     that should align with the calendar ET date (Globex reopen at ~18:00 ET).
//
//   toFuturesTradingDayString — CME 5:00 PM ET trading-day boundary.
//     Used for ALL daily P&L aggregation: dailyPnlBreakdown keys, kill-switch
//     day-loss reads, and the global daily-loss cache.
//     CME futures day N starts 18:00 ET on day N-1 and ends 17:00 ET on day N.
//     Formula: shift timestamp +7h before ET date conversion so that
//     17:00 ET maps to midnight-ET of the NEXT calendar day (= correct CME day).
//     Example: 17:05 ET Mon → +7h → 00:05 ET Tue → "Tue" trading day.
//              16:55 ET Mon → +7h → 23:55 ET Mon → "Mon" trading day.

const _ET_FORMATTER = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" });

/**
 * Get the calendar ET date string (YYYY-MM-DD) for a UTC timestamp.
 * Uses ET midnight as the day boundary. Correct for VWAP resets, skipDecisions,
 * and any query whose day boundary is ET calendar midnight.
 * NOT correct for CME daily P&L attribution — use toFuturesTradingDayString.
 */
export function toEasternDateString(date: Date = new Date()): string {
  return _ET_FORMATTER.format(date);
}

/**
 * Get the CME futures trading day string (YYYY-MM-DD) for a UTC timestamp.
 * CME futures day rolls at 17:00 ET: trades closed 17:00–23:59 ET belong
 * to the NEXT calendar day's trading session.
 * Use this for ALL daily P&L aggregation, kill-switch day-loss reads,
 * and dailyPnlBreakdown JSONB keys.
 */
export function toFuturesTradingDayString(date: Date = new Date()): string {
  // Shifting +7 hours aligns the 17:00 ET CME cutoff with ET calendar midnight:
  //   17:00 ET + 7h = 00:00 ET next day  → correct next-day attribution.
  //   16:59 ET + 7h = 23:59 ET same day  → correct same-day attribution.
  const shifted = new Date(date.getTime() + 7 * 3600_000);
  return _ET_FORMATTER.format(shifted);
}

// ─── Fix 3: Global daily loss aggregate cache ────────────────────────────────
//
// Problem: the global-daily-loss check fetches ALL active sessions and reduces
// their dailyPnlBreakdown JSONB in JS on EVERY entry signal.  At 5+ sessions
// this is a full-table scan per signal firing.
//
// Strategy: cache the aggregate (sum of today's losses across all active
// sessions) keyed by ET date.  Cache is invalidated (cleared) whenever any
// paper position closes — the primary update mechanism.  A 30-second TTL
// acts as a safety net for any cache-warming that might slip past the
// invalidation call (e.g. manual DB edits, test isolation).
//
// NOTE: This is an AGGREGATE cache (total across all sessions), not per-session,
// because the check sums across all active sessions.  A per-session approach
// would require fetching and summing every other session on each miss anyway.
// Aggregate is simpler and correct.

const globalDailyLossCache = new Map<string, { value: number; updatedAt: number }>();
const GLOBAL_DAILY_LOSS_CACHE_TTL_MS = 30_000;

function getCachedGlobalDailyLoss(etDate: string): number | null {
  const cached = globalDailyLossCache.get(etDate);
  if (cached === undefined) return null;
  if (Date.now() - cached.updatedAt > GLOBAL_DAILY_LOSS_CACHE_TTL_MS) {
    globalDailyLossCache.delete(etDate);
    return null;
  }
  return cached.value;
}

function setCachedGlobalDailyLoss(etDate: string, value: number): void {
  globalDailyLossCache.set(etDate, { value, updatedAt: Date.now() });
}

/**
 * Evict the global daily loss aggregate cache for any date keyed to the given
 * session. Called by closePosition() after a trade commits — at that point
 * the session's dailyPnlBreakdown has changed and the cached aggregate is stale.
 *
 * The sessionId argument is accepted (but unused) to keep the call-site
 * semantically clear ("invalidate for this session") and to allow a
 * per-session strategy in future without changing callers.
 */
export function invalidateDailyLossCache(_sessionId: string): void {
  // We cache by etDate only. A close might affect today's or (rarely) yesterday's
  // date if called right at midnight ET. Clearing all entries is safe and cheap
  // (at most 1–2 entries in practice — one per trading day).
  globalDailyLossCache.clear();
}

/**
 * Test-only: clear the global daily loss cache between unit tests.
 * Production code must never call this.
 */
export function __resetDailyLossCacheForTests(): void {
  globalDailyLossCache.clear();
}

export interface RiskGateResult {
  allowed: boolean;
  reason?: string;
  check?: string;
}

// Per-symbol contract defaults (used when no firm config or firm doesn't specify per-symbol)
const DEFAULT_MAX_CONTRACTS: Record<string, number> = {
  MES: 150, MNQ: 150, MCL: 150,
};

const DEFAULT_SESSION_DRAWDOWN = getTightestDrawdown()?.maxDrawdown ?? 2_000;
const DEFAULT_GLOBAL_LOSS_LIMIT = 5_000;
const DEFAULT_MAX_POSITIONS = 1;

/**
 * Resolve firm config from session's firmId. Returns null if no firmId
 * (callers should fall back to defaults).
 */
function resolveFirmConfig(firmId: string | null | undefined): FirmAccountConfig | null {
  if (!firmId) return null;
  return getFirmAccount(firmId);
}

export async function checkRiskGate(
  sessionId: string,
  symbol: string,
  contracts: number,
): Promise<RiskGateResult> {
  const span = tracer.startSpan("paper.risk_gate");
  span.setAttribute("symbol", symbol);
  span.setAttribute("contracts", contracts);

  try {
  // ── Load session ───────────────────────────────────────────
  const [openPositions, session] = await Promise.all([
    db.select({ id: paperPositions.id })
      .from(paperPositions)
      .where(and(eq(paperPositions.sessionId, sessionId), isNull(paperPositions.closedAt))),
    db.select()
      .from(paperSessions)
      .where(eq(paperSessions.id, sessionId))
      .then((rows) => rows[0]),
  ]);

  if (!session) {
    return { allowed: false, reason: "Session not found", check: "session_exists" };
  }

  const config = (session.config ?? {}) as Record<string, unknown>;
  const firmConfig = resolveFirmConfig(session.firmId);

  // If session is tied to a firm but the firm config is missing, reject — don't silently fall back to defaults
  if (session.firmId && !firmConfig) {
    return {
      allowed: false,
      reason: `Firm "${session.firmId}" not found in config — cannot apply risk limits`,
      check: "firm_config_missing",
    };
  }

  // ── a) Max concurrent positions ────────────────────────────
  const maxPositions = (config.max_positions as number) ?? DEFAULT_MAX_POSITIONS;

  if (openPositions.length >= maxPositions) {
    logger.warn({ sessionId, openPositions: openPositions.length, maxPositions }, "Risk gate: max concurrent positions reached");
    // Obs HIGH-1 2026-06-29: durable audit row so post-incident "why did it stop trading?" is answerable
    await insertAuditRowSafe({
      action: "paper_risk_gate.blocked",
      entityType: "paper_session",
      entityId: sessionId,
      status: "rejected",
      input: { sessionId, symbol, contracts },
      result: { check: "max_concurrent_positions", openPositions: openPositions.length, maxPositions },
      decisionAuthority: "paper_risk_gate",
    });
    return {
      allowed: false,
      reason: `Max concurrent positions reached (${openPositions.length}/${maxPositions})`,
      check: "max_concurrent_positions",
    };
  }

  // ── b) Session drawdown limit (trailing peak-to-trough, firm-specific or default) ───
  // W12 Bug #2: use realizedPeakEquity (closed-equity HWM) for trailing-DD compliance.
  // peakEquity is the MTM HWM (updated every tick) — over-tightens the floor.
  // realizedPeakEquity is updated only on trade close, matching Topstep/Apex EOD spec.
  // Fall back to peakEquity for sessions that predate migration 0075 (column = 50000).
  const rawRealizedPeak = Number((session as Record<string, unknown>).realizedPeakEquity ?? 0);
  const peakEquity = rawRealizedPeak > 0
    ? rawRealizedPeak
    : Number(session.peakEquity ?? session.startingCapital);
  const currentEquity = Number(session.currentEquity);
  const drawdownLimit = firmConfig?.maxDrawdown
    ?? (config.daily_loss_limit as number)
    ?? DEFAULT_SESSION_DRAWDOWN;
  // Trailing drawdown: how far we've fallen from peak (prop firm standard)
  const sessionLoss = peakEquity - currentEquity;

  if (sessionLoss >= drawdownLimit) {
    logger.warn({ sessionId, sessionLoss, drawdownLimit, firmId: session.firmId }, "Risk gate: session drawdown limit hit");
    // Obs HIGH-1 2026-06-29: durable audit row so post-incident "why did it stop trading?" is answerable
    await insertAuditRowSafe({
      action: "paper_risk_gate.blocked",
      entityType: "paper_session",
      entityId: sessionId,
      status: "rejected",
      input: { sessionId, symbol, contracts },
      result: { check: "session_drawdown", sessionLoss, drawdownLimit, firmId: session.firmId },
      decisionAuthority: "paper_risk_gate",
    });
    return {
      allowed: false,
      reason: `Session drawdown limit reached ($${sessionLoss.toFixed(2)} loss vs $${drawdownLimit} limit)`,
      check: "session_drawdown",
    };
  }

  // ── c) Max contracts per symbol (firm cap + per-symbol defaults) ──
  const firmMaxContracts = firmConfig?.maxContracts;
  const symbolDefault = DEFAULT_MAX_CONTRACTS[symbol];
  // Use the more restrictive of: firm cap, symbol default, or session config override
  const configMax = config.max_contracts as number | undefined;
  const maxContracts = configMax != null
    ? configMax
    : (firmMaxContracts != null && symbolDefault != null ? Math.min(firmMaxContracts, symbolDefault) : firmMaxContracts ?? symbolDefault);

  if (maxContracts !== undefined && contracts > maxContracts) {
    logger.warn({ sessionId, symbol, contracts, maxContracts, firmId: session.firmId }, "Risk gate: contract cap exceeded");
    // Obs HIGH-1 2026-06-29: durable audit row so post-incident "why did it stop trading?" is answerable
    await insertAuditRowSafe({
      action: "paper_risk_gate.blocked",
      entityType: "paper_session",
      entityId: sessionId,
      status: "rejected",
      input: { sessionId, symbol, contracts },
      result: { check: "max_contracts", contracts, maxContracts, firmId: session.firmId },
      decisionAuthority: "paper_risk_gate",
    });
    return {
      allowed: false,
      reason: `Contracts (${contracts}) exceeds cap for ${symbol} (max ${maxContracts})`,
      check: "max_contracts",
    };
  }

  // ── d) Daily loss limit (firm-specific) ────────────────────
  // F-1 Fix: halt at DLL_HALT_PCT × firmDLL (default 67%), not at 100% of firmDLL.
  // kill-switch.ts Layer 2 already halts at DLL_HALT_PCT * dll; this gate must match.
  // Firms with dailyLossLimit=null (MFFU has NO daily loss limit) skip this gate.
  if (firmConfig?.dailyLossLimit) {
    // Use CME futures trading-day key to match dailyPnlBreakdown entries.
    // Trades closed 17:00–23:59 ET belong to the NEXT trading day (5pm ET cutoff).
    const today = toFuturesTradingDayString();
    const breakdown = (session.dailyPnlBreakdown as Record<string, number> | null) ?? {};
    const todayPnl = breakdown[today] ?? 0;
    const todayLoss = todayPnl < 0 ? Math.abs(todayPnl) : 0;

    // Halt threshold = DLL_HALT_PCT × firm DLL (e.g. 0.67 × $1000 = $670 for Topstep)
    const dllHaltThreshold = firmConfig.dailyLossLimit * DLL_HALT_PCT;

    if (todayLoss >= dllHaltThreshold) {
      logger.warn(
        { sessionId, todayLoss, dllHaltThreshold, dailyLossLimit: firmConfig.dailyLossLimit, DLL_HALT_PCT },
        "Risk gate: daily loss halt threshold hit",
      );
      // Obs HIGH-1 2026-06-29: durable audit row so post-incident "why did it stop trading?" is answerable
      await insertAuditRowSafe({
        action: "paper_risk_gate.blocked",
        entityType: "paper_session",
        entityId: sessionId,
        status: "rejected",
        input: { sessionId, symbol, contracts },
        result: { check: "daily_loss_limit", todayLoss, dllHaltThreshold, dailyLossLimit: firmConfig.dailyLossLimit, DLL_HALT_PCT, firmId: session.firmId },
        decisionAuthority: "paper_risk_gate",
      });
      return {
        allowed: false,
        reason: `Daily loss halt threshold reached ($${todayLoss.toFixed(2)} today vs $${dllHaltThreshold.toFixed(2)} halt limit [${Math.round(DLL_HALT_PCT * 100)}% of $${firmConfig.dailyLossLimit} for ${session.firmId}])`,
        check: "daily_loss_limit",
      };
    }
  }

  // ── e) Overnight position check ───────────────────────────
  if (firmConfig && !firmConfig.overnightOk) {
    const now = new Date();
    const utcHour = now.getUTCHours();
    const utcMinute = now.getUTCMinutes();
    const utcTime = utcHour * 60 + utcMinute;

    // RTH is 9:30 AM – 4:00 PM Eastern Time
    // EST (Nov–Mar): 14:30–21:00 UTC   EDT (Mar–Nov): 13:30–20:00 UTC
    const isDST = isUsDst(now);
    const rthStartUTC = isDST ? 13 * 60 + 30 : 14 * 60 + 30; // 13:30 or 14:30
    const rthEndUTC = isDST ? 20 * 60 : 21 * 60;               // 20:00 or 21:00

    if (utcTime < rthStartUTC || utcTime >= rthEndUTC) {
      logger.warn({ sessionId, firmId: session.firmId, utcTime, rthStartUTC, rthEndUTC }, "Risk gate: overnight positions not allowed for this firm");
      // Obs HIGH-1 2026-06-29: durable audit row so post-incident "why did it stop trading?" is answerable
      await insertAuditRowSafe({
        action: "paper_risk_gate.blocked",
        entityType: "paper_session",
        entityId: sessionId,
        status: "rejected",
        input: { sessionId, symbol, contracts },
        result: { check: "overnight_restriction", firmId: session.firmId, utcTime, rthStartUTC, rthEndUTC },
        decisionAuthority: "paper_risk_gate",
      });
      return {
        allowed: false,
        reason: `Overnight positions not allowed for ${session.firmId} — outside RTH`,
        check: "overnight_restriction",
      };
    }
  }

  // ── f) Global daily loss limit across all active sessions ──
  // Use CME futures trading-day key so the aggregate matches dailyPnlBreakdown entries.
  // Trades closed 17:00–23:59 ET are attributed to the NEXT trading day (5pm ET cutoff).
  const today = toFuturesTradingDayString();

  // Fix 3: try aggregate cache before issuing the full-table DB query.
  // Cache is invalidated by invalidateDailyLossCache() on every trade close.
  // 30-second TTL is a safety net only.
  let totalTodayLoss = getCachedGlobalDailyLoss(today);
  if (totalTodayLoss === null) {
    const activeSessions = await db
      .select({
        dailyPnlBreakdown: paperSessions.dailyPnlBreakdown,
      })
      .from(paperSessions)
      .where(eq(paperSessions.status, "active"));

    totalTodayLoss = activeSessions.reduce((sum, s) => {
      const breakdown = (s.dailyPnlBreakdown as Record<string, number> | null) ?? {};
      const todayPnl = breakdown[today] ?? 0;
      return sum + (todayPnl < 0 ? Math.abs(todayPnl) : 0);
    }, 0);

    setCachedGlobalDailyLoss(today, totalTodayLoss);
  }

  if (totalTodayLoss >= DEFAULT_GLOBAL_LOSS_LIMIT) {
    logger.warn({ totalTodayLoss, limit: DEFAULT_GLOBAL_LOSS_LIMIT }, "Risk gate: global daily loss limit hit");
    // Obs HIGH-1 2026-06-29: durable audit row so post-incident "why did it stop trading?" is answerable
    await insertAuditRowSafe({
      action: "paper_risk_gate.blocked",
      entityType: "paper_session",
      entityId: sessionId,
      status: "rejected",
      input: { sessionId, symbol, contracts },
      result: { check: "global_daily_loss", totalTodayLoss, limit: DEFAULT_GLOBAL_LOSS_LIMIT },
      decisionAuthority: "paper_risk_gate",
    });
    return {
      allowed: false,
      reason: `Global daily loss across all sessions ($${totalTodayLoss.toFixed(2)} today) exceeds $${DEFAULT_GLOBAL_LOSS_LIMIT} limit`,
      check: "global_daily_loss",
    };
  }

  return { allowed: true };
  } finally {
    span.end();
  }
}
