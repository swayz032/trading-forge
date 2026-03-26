import { db } from "../db/index.js";
import { paperSessions, paperPositions } from "../db/schema.js";
import { eq, and, isNull } from "drizzle-orm";
import { logger } from "../index.js";
import { getFirmAccount, getTightestDrawdown, type FirmAccountConfig } from "../../shared/firm-config.js";

/**
 * Precise US DST detection: second Sunday of March through first Sunday of November.
 */
function isUsDst(date: Date): boolean {
  const year = date.getUTCFullYear();
  // Second Sunday of March: find first Sunday in March, add 7 days
  const mar1 = new Date(Date.UTC(year, 2, 1)); // March 1
  const mar1Day = mar1.getUTCDay(); // 0=Sun
  const secondSunMar = 1 + (7 - mar1Day) % 7 + 7; // day of month
  const dstStart = new Date(Date.UTC(year, 2, secondSunMar, 7, 0)); // 2AM ET = 7AM UTC (still EST)

  // First Sunday of November
  const nov1 = new Date(Date.UTC(year, 10, 1)); // Nov 1
  const nov1Day = nov1.getUTCDay();
  const firstSunNov = 1 + (7 - nov1Day) % 7;
  const dstEnd = new Date(Date.UTC(year, 10, firstSunNov, 6, 0)); // 2AM ET = 6AM UTC (still EDT)

  return date >= dstStart && date < dstEnd;
}

/**
 * Get today's date string in Eastern Time (for daily P&L tracking).
 * Futures trading day is defined in ET, not UTC.
 */
export function toEasternDateString(date: Date = new Date()): string {
  const utcMs = date.getTime();
  const etOffsetMs = isUsDst(date) ? -4 * 3600_000 : -5 * 3600_000;
  const etDate = new Date(utcMs + etOffsetMs);
  return etDate.toISOString().split("T")[0];
}

export interface RiskGateResult {
  allowed: boolean;
  reason?: string;
  check?: string;
}

// Per-symbol contract defaults (used when no firm config or firm doesn't specify per-symbol)
const DEFAULT_MAX_CONTRACTS: Record<string, number> = {
  ES: 15, NQ: 15, CL: 15, YM: 15, RTY: 15, GC: 15, MES: 150, MNQ: 150,
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

  // ── a) Max concurrent positions ────────────────────────────
  const maxPositions = (config.max_positions as number) ?? DEFAULT_MAX_POSITIONS;

  if (openPositions.length >= maxPositions) {
    logger.warn({ sessionId, openPositions: openPositions.length, maxPositions }, "Risk gate: max concurrent positions reached");
    return {
      allowed: false,
      reason: `Max concurrent positions reached (${openPositions.length}/${maxPositions})`,
      check: "max_concurrent_positions",
    };
  }

  // ── b) Session drawdown limit (trailing peak-to-trough, firm-specific or default) ───
  const peakEquity = Number(session.peakEquity ?? session.startingCapital);
  const currentEquity = Number(session.currentEquity);
  const drawdownLimit = firmConfig?.maxDrawdown
    ?? (config.daily_loss_limit as number)
    ?? DEFAULT_SESSION_DRAWDOWN;
  // Trailing drawdown: how far we've fallen from peak (prop firm standard)
  const sessionLoss = peakEquity - currentEquity;

  if (sessionLoss >= drawdownLimit) {
    logger.warn({ sessionId, sessionLoss, drawdownLimit, firmId: session.firmId }, "Risk gate: session drawdown limit hit");
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
    return {
      allowed: false,
      reason: `Contracts (${contracts}) exceeds cap for ${symbol} (max ${maxContracts})`,
      check: "max_contracts",
    };
  }

  // ── d) Daily loss limit (firm-specific) ────────────────────
  if (firmConfig?.dailyLossLimit) {
    // Use today's loss from dailyPnlBreakdown (tracks actual daily P&L, not session cumulative)
    const today = toEasternDateString();
    const breakdown = (session.dailyPnlBreakdown as Record<string, number> | null) ?? {};
    const todayPnl = breakdown[today] ?? 0;
    const todayLoss = todayPnl < 0 ? Math.abs(todayPnl) : 0;

    if (todayLoss >= firmConfig.dailyLossLimit) {
      logger.warn({ sessionId, todayLoss, dailyLossLimit: firmConfig.dailyLossLimit }, "Risk gate: daily loss limit hit");
      return {
        allowed: false,
        reason: `Daily loss limit reached ($${todayLoss.toFixed(2)} today vs $${firmConfig.dailyLossLimit} limit for ${session.firmId})`,
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
      return {
        allowed: false,
        reason: `Overnight positions not allowed for ${session.firmId} — outside RTH`,
        check: "overnight_restriction",
      };
    }
  }

  // ── f) Global daily loss limit across all active sessions ──
  // Use today's loss from dailyPnlBreakdown (not cumulative lifetime loss)
  // Must use Eastern Time date to match dailyPnlBreakdown keys (futures trading day = ET)
  const today = toEasternDateString();
  const activeSessions = await db
    .select({
      dailyPnlBreakdown: paperSessions.dailyPnlBreakdown,
    })
    .from(paperSessions)
    .where(eq(paperSessions.status, "active"));

  const totalTodayLoss = activeSessions.reduce((sum, s) => {
    const breakdown = (s.dailyPnlBreakdown as Record<string, number> | null) ?? {};
    const todayPnl = breakdown[today] ?? 0;
    return sum + (todayPnl < 0 ? Math.abs(todayPnl) : 0);
  }, 0);

  if (totalTodayLoss >= DEFAULT_GLOBAL_LOSS_LIMIT) {
    logger.warn({ totalTodayLoss, limit: DEFAULT_GLOBAL_LOSS_LIMIT }, "Risk gate: global daily loss limit hit");
    return {
      allowed: false,
      reason: `Global daily loss across all sessions ($${totalTodayLoss.toFixed(2)} today) exceeds $${DEFAULT_GLOBAL_LOSS_LIMIT} limit`,
      check: "global_daily_loss",
    };
  }

  return { allowed: true };
}
