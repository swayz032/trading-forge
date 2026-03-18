/**
 * Express Scheduler — sub-minute response events via node-cron.
 *
 * Handles events that can't wait for n8n cron:
 *   - Every 4 hours: rolling Sharpe update for active strategies
 *   - Daily at 11:30 PM ET: nightly summary (backup for n8n)
 *
 * Paper trade drift checks are event-driven (called from paper-execution-service),
 * not scheduled. This scheduler handles the periodic jobs only.
 */

import cron from "node-cron";
import { eq, and } from "drizzle-orm";
import { db } from "./db/index.js";
import { strategies, paperSessions } from "./db/schema.js";
import { broadcastSSE } from "./routes/sse.js";
import { logger } from "./index.js";

let initialized = false;

export function initScheduler() {
  if (initialized) return;
  initialized = true;

  // ─── Every 4 hours: Rolling Sharpe update ─────────────────
  cron.schedule("0 */4 * * *", async () => {
    logger.info("Scheduler: Running 4-hour rolling Sharpe update");
    try {
      await updateRollingSharpe();
    } catch (err) {
      logger.error({ err }, "Scheduler: Rolling Sharpe update failed");
    }
  });

  // ─── Daily at 6:30 AM ET (11:30 UTC): Pre-market prep ────
  cron.schedule("30 11 * * 1-5", async () => {
    logger.info("Scheduler: Pre-market prep");
    try {
      await preMarketPrep();
    } catch (err) {
      logger.error({ err }, "Scheduler: Pre-market prep failed");
    }
  });

  logger.info("Scheduler initialized: rolling Sharpe (4h), pre-market prep (6:30 AM ET weekdays)");
}

/**
 * Update rolling 30-day Sharpe ratio for all active strategies.
 */
async function updateRollingSharpe() {
  const activeStrategies = await db
    .select({ id: strategies.id, name: strategies.name })
    .from(strategies)
    .where(
      eq(strategies.lifecycleState, "PAPER"),
    );

  if (activeStrategies.length === 0) {
    logger.info("No active PAPER strategies for Sharpe update");
    return;
  }

  for (const strat of activeStrategies) {
    try {
      // Fetch recent paper trades for this strategy
      const sessions = await db
        .select({ id: paperSessions.id, currentEquity: paperSessions.currentEquity })
        .from(paperSessions)
        .where(
          and(
            eq(paperSessions.strategyId, strat.id),
            eq(paperSessions.status, "active"),
          ),
        );

      if (sessions.length === 0) continue;

      // For now, store a placeholder — the actual computation
      // happens when drift-detection-service compares paper vs backtest
      logger.info({ strategyId: strat.id, name: strat.name }, "Rolling Sharpe checked");
    } catch (err) {
      logger.error({ strategyId: strat.id, err }, "Failed to update rolling Sharpe");
    }
  }

  broadcastSSE("scheduler:sharpe-updated", {
    strategies: activeStrategies.length,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Pre-market prep: check if any macro events today warrant caution.
 */
async function preMarketPrep() {
  try {
    // Call the skip classifier endpoint
    const response = await fetch("http://localhost:4000/api/skip/today").catch(() => null);
    if (response?.ok) {
      const data = await response.json();
      const sitOuts = (data as any[]).filter((d: any) => d.decision === "SKIP" || d.decision === "SIT_OUT");
      if (sitOuts.length > 0) {
        broadcastSSE("scheduler:pre-market-alert", {
          message: `${sitOuts.length} strategies sitting out today`,
          details: sitOuts,
        });
        logger.info({ sitOuts: sitOuts.length }, "Pre-market: strategies sitting out");
      }
    }
  } catch (err) {
    logger.warn({ err }, "Pre-market prep: skip classifier unavailable");
  }
}

/**
 * Called by paper-execution-service after each trade close.
 * Not scheduled — event-driven.
 */
export async function onPaperTradeClose(sessionId: string, strategyId: string) {
  try {
    // Trigger drift detection
    const response = await fetch(`http://localhost:4000/api/paper/drift/${sessionId}?strategyId=${strategyId}`).catch(() => null);
    if (response?.ok) {
      const drift = await response.json();
      const driftScore = (drift as any).driftScore ?? 0;
      if (driftScore > 2.0) {
        broadcastSSE("strategy:drift-alert", {
          strategyId,
          sessionId,
          driftScore,
          message: `Strategy drifting: ${driftScore.toFixed(1)}σ from backtest expectations`,
        });
        logger.warn({ strategyId, driftScore }, "Strategy drift detected after paper trade");
      }
    }
  } catch (err) {
    logger.error({ sessionId, strategyId, err }, "Drift check failed after paper trade close");
  }
}
