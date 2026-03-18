import { db } from "../db/index.js";
import { paperSessions, paperPositions } from "../db/schema.js";
import { eq, and, isNull } from "drizzle-orm";
import { logger } from "../index.js";

export interface RiskGateResult {
  allowed: boolean;
  reason?: string;
  check?: string;
}

// Default max contracts per symbol (prop firm caps)
const DEFAULT_MAX_CONTRACTS: Record<string, number> = {
  ES: 3, NQ: 2, CL: 2, YM: 5, RTY: 3, GC: 2, MES: 10, MNQ: 10,
};

const DEFAULT_SESSION_DRAWDOWN = 2_000;
const DEFAULT_GLOBAL_LOSS_LIMIT = 5_000;
const DEFAULT_MAX_POSITIONS = 1;

export async function checkRiskGate(
  sessionId: string,
  symbol: string,
  contracts: number,
): Promise<RiskGateResult> {
  // ── a) Max concurrent positions ──────────────────────────
  const openPositions = await db
    .select({ id: paperPositions.id })
    .from(paperPositions)
    .where(and(eq(paperPositions.sessionId, sessionId), isNull(paperPositions.closedAt)));

  const session = await db
    .select()
    .from(paperSessions)
    .where(eq(paperSessions.id, sessionId))
    .then((rows) => rows[0]);

  if (!session) {
    return { allowed: false, reason: "Session not found", check: "session_exists" };
  }

  const config = (session.config ?? {}) as Record<string, unknown>;
  const maxPositions = (config.max_positions as number) ?? DEFAULT_MAX_POSITIONS;

  if (openPositions.length >= maxPositions) {
    logger.warn({ sessionId, openPositions: openPositions.length, maxPositions }, "Risk gate: max concurrent positions reached");
    return {
      allowed: false,
      reason: `Max concurrent positions reached (${openPositions.length}/${maxPositions})`,
      check: "max_concurrent_positions",
    };
  }

  // ── b) Session drawdown limit ────────────────────────────
  const startingCapital = Number(session.startingCapital);
  const currentEquity = Number(session.currentEquity);
  const drawdownLimit = (config.daily_loss_limit as number) ?? DEFAULT_SESSION_DRAWDOWN;
  const sessionLoss = startingCapital - currentEquity;

  if (sessionLoss >= drawdownLimit) {
    logger.warn({ sessionId, sessionLoss, drawdownLimit }, "Risk gate: session drawdown limit hit");
    return {
      allowed: false,
      reason: `Session drawdown limit reached ($${sessionLoss.toFixed(2)} loss vs $${drawdownLimit} limit)`,
      check: "session_drawdown",
    };
  }

  // ── c) Max contracts per symbol ──────────────────────────
  const maxContracts = (config.max_contracts as number) ?? DEFAULT_MAX_CONTRACTS[symbol];

  if (maxContracts !== undefined && contracts > maxContracts) {
    logger.warn({ sessionId, symbol, contracts, maxContracts }, "Risk gate: contract cap exceeded");
    return {
      allowed: false,
      reason: `Contracts (${contracts}) exceeds cap for ${symbol} (max ${maxContracts})`,
      check: "max_contracts",
    };
  }

  // ── d) Daily loss limit across all active sessions ───────
  const activeSessions = await db
    .select({
      startingCapital: paperSessions.startingCapital,
      currentEquity: paperSessions.currentEquity,
    })
    .from(paperSessions)
    .where(eq(paperSessions.status, "active"));

  const totalLoss = activeSessions.reduce((sum, s) => {
    return sum + (Number(s.startingCapital) - Number(s.currentEquity));
  }, 0);

  if (totalLoss >= DEFAULT_GLOBAL_LOSS_LIMIT) {
    logger.warn({ totalLoss, limit: DEFAULT_GLOBAL_LOSS_LIMIT }, "Risk gate: global daily loss limit hit");
    return {
      allowed: false,
      reason: `Global loss across all sessions ($${totalLoss.toFixed(2)}) exceeds $${DEFAULT_GLOBAL_LOSS_LIMIT} limit`,
      check: "global_daily_loss",
    };
  }

  return { allowed: true };
}
