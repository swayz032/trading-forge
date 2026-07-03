/**
 * Candidate Backtest Conveyor Service
 *
 * Pipeline-gated worker that automatically enqueues walk-forward backtests for
 * CANDIDATE strategies when "Bot Power" is ON (pipeline mode = ACTIVE).
 *
 * HARD CONSTRAINTS (paper-engine-authority contract):
 *  - ONLY enqueues backtests. NEVER touches paper streams, TradersPost, or
 *    any broker path.
 *  - SHADOW invariant traderspost_webhook_called=false is table-enforced —
 *    this service stays entirely out of the paper/live execution path.
 *  - A DB error logs and returns; it never throws to the scheduler.
 *  - A single strategy failure does NOT abort the rest of the tick.
 *
 * Idempotency guards (correlated SQL subqueries):
 *  1. NOT EXISTS completed backtest (no re-run of already-finished strategies)
 *  2. NOT EXISTS running backtest   (no concurrent double-enqueue)
 *  3. NOT EXISTS failed backtest in the last 24h (cooling-off period)
 *
 * Slot math:
 *  slots = (MAX_CONCURRENT_BACKTESTS env, default 3) − count(backtests WHERE status='running')
 *  Tick is a no-op when slots ≤ 0.
 *
 * Phase 3b: fire-and-forget checkAutoPromotions() after enqueue loop so any
 * TESTING-eligible strategy gates are re-evaluated without blocking the tick.
 *
 * Added: 2026-06-28 (auto-backtest conveyor)
 */

import { randomUUID } from "crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { auditLog, backtests, strategies } from "../db/schema.js";
import { logger } from "../lib/logger.js";
import { candidateConveyorEnqueuedTotal } from "../lib/metrics-registry.js";
import { broadcastSSE } from "../routes/sse.js";
import { notifyWarning } from "./notification-service.js";
import { getMode as getPipelineMode } from "./pipeline-control-service.js";

// FIX 3 (deepscan11 Track P, 2026-07-02): skip-cooldown map.
//
// A CANDIDATE that returns "skipped" from runBacktest (e.g. mid-tick pipeline
// pause, resource constraint) would otherwise be re-selected every tick and
// monopolise conveyor slots while making no progress. The 24-hour cooldown
// ensures a perpetually-skipped strategy backs off so other CANDIDATES can run.
//
// Key: strategy UUID. Value: epoch-ms timestamp when the cooldown started.
// Process-local and deliberately NOT persisted — a process restart is a valid
// reset. The cooldown is purely a throughput guard, not a correctness gate.
const _skipCooldown = new Map<string, number>();
const SKIP_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours

export async function runCandidateBacktestConveyor(): Promise<void> {
  // ── 1. Pipeline gate ──────────────────────────────────────────────────────
  // Use getPipelineMode() directly (not pipelineGate()) to match the
  // pipeline-resume-drain pattern. actor="automated" inside runBacktest also
  // re-checks isPipelineActive() — belt-and-suspenders.
  let currentMode: string;
  try {
    currentMode = await getPipelineMode();
  } catch (err) {
    logger.error({ err }, "candidate-backtest-conveyor: failed to read pipeline mode — aborting tick");
    return;
  }
  if (currentMode !== "ACTIVE") {
    logger.debug({ currentMode }, "candidate-backtest-conveyor: pipeline not ACTIVE, skipping tick");
    return;
  }

  // ── 2. Slot math ──────────────────────────────────────────────────────────
  const cap = parseInt(process.env.MAX_CONCURRENT_BACKTESTS ?? "3", 10);
  let running: number;
  try {
    const [runningRow] = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(backtests)
      .where(eq(backtests.status, "running"));
    running = runningRow?.c ?? 0;
  } catch (err) {
    logger.error({ err }, "candidate-backtest-conveyor: failed to count running backtests — aborting tick");
    return;
  }
  const slots = cap - running;
  if (slots <= 0) {
    logger.debug({ running, cap, slots }, "candidate-backtest-conveyor: no slots available, skipping tick");
    return;
  }

  // ── 3. Find eligible CANDIDATE strategies ─────────────────────────────────
  // Correlated NOT EXISTS subqueries filter out:
  //   (a) strategies that already have a completed backtest
  //   (b) strategies with a currently-running backtest (idempotency guard)
  //   (c) strategies whose last backtest failed within the past 24 hours
  //
  // CF-6 rule: NEVER use sql`col = ANY(${jsArray})`. This uses correlated
  // subqueries instead — ${strategies.id} serialises as "strategies"."id"
  // in the outer query context, giving a valid correlated reference.
  let candidates: Array<typeof strategies.$inferSelect>;
  try {
    candidates = await db
      .select()
      .from(strategies)
      .where(
        and(
          eq(strategies.lifecycleState, "CANDIDATE"),
          sql`NOT EXISTS (
            SELECT 1 FROM backtests b
            WHERE b.strategy_id = ${strategies.id}
              AND b.status = 'completed'
          )`,
          sql`NOT EXISTS (
            SELECT 1 FROM backtests b
            WHERE b.strategy_id = ${strategies.id}
              AND b.status = 'running'
          )`,
          sql`NOT EXISTS (
            SELECT 1 FROM backtests b
            WHERE b.strategy_id = ${strategies.id}
              AND b.status = 'failed'
              AND b.created_at >= now() - interval '24 hours'
          )`,
        ),
      )
      // FIX 3: FIFO ordering — oldest CANDIDATE strategies are backtest-promoted
      // first. Without this, Postgres returns candidates in undefined heap order,
      // so newly-graduated strategies can starve older ones.
      .orderBy(asc(strategies.createdAt))
      .limit(slots);
  } catch (err) {
    logger.error({ err }, "candidate-backtest-conveyor: failed to query eligible strategies — aborting tick");
    return;
  }

  if (candidates.length === 0) {
    logger.debug({ slots }, "candidate-backtest-conveyor: no eligible CANDIDATE strategies found");
    return;
  }

  // ── 4. Enqueue backtests ──────────────────────────────────────────────────
  const correlationId = randomUUID();

  // Lazy imports: avoids eager module construction at scheduler load time and
  // keeps this service out of the paper/live execution import graph.
  const { runBacktest } = await import("./backtest-service.js");

  // Process up to `slots` candidates CONCURRENTLY (was a serial for-await loop —
  // one slow ~15-30 min walk-forward backtest blocked the entire queue, so only
  // ONE ran at a time regardless of the cap). Promise.allSettled holds the tick
  // (and its job lock) until this batch finishes, so the next tick can't start
  // more until these complete — the cap (slots = MAX_CONCURRENT_BACKTESTS −
  // running) is never exceeded. The next tick then picks up the next batch.
  const outcomes = await Promise.allSettled(
    candidates.map(async (s) => {
      // FIX 3: prune expired cooldown entries and check per-strategy cooldown.
      // A strategy in cooldown was skipped on a recent tick; skip it again and
      // let the slot go to the next eligible candidate.
      const cooldownStart = _skipCooldown.get(s.id);
      if (cooldownStart !== undefined) {
        if (Date.now() - cooldownStart < SKIP_COOLDOWN_MS) {
          logger.debug(
            { strategyId: s.id, strategyName: s.name, cooldownStart },
            "candidate-backtest-conveyor: strategy in skip-cooldown, bypassing slot",
          );
          return 0;
        }
        // Cooldown expired — remove it and allow re-try
        _skipCooldown.delete(s.id);
      }

      // Spread REAL strategy config + force walkforward mode.
      // MUST NOT use a stub config like lifecycle-service.ts FIX-3 (line 4284).
      // dates auto-resolve inside runBacktest via resolveDataRange(symbol).
      const cfg = {
        ...(s.config as Record<string, unknown>),
        mode: "walkforward",
      };

      const result = await runBacktest(
        s.id,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        cfg as any,
        undefined,
        undefined,
        randomUUID(),
        "automated",
      );

      if (!result || result.status === "skipped") {
        // FIX 3: record skip-cooldown so this strategy backs off for 24 hours.
        // This prevents a perpetually-skipped strategy from monopolising conveyor
        // slots every tick while making no progress.
        const now = Date.now();
        _skipCooldown.set(s.id, now);
        logger.debug(
          { strategyId: s.id, strategyName: s.name, reason: result?.error ?? "unknown" },
          "candidate-backtest-conveyor: runBacktest returned skipped — pipeline may have just paused; skip-cooldown set",
        );
        // Non-blocking info audit — skip-cooldown entry queryable via audit_log.
        db.insert(auditLog)
          .values({
            action: "conveyor.candidate_skip_cooldown",
            entityType: "strategy",
            entityId: s.id,
            status: "info",
            decisionAuthority: "scheduler",
            input: { strategyName: s.name, symbol: s.symbol } as Record<string, unknown>,
            result: {
              skip_reason: result?.error ?? "unknown",
              cooldown_until: new Date(now + SKIP_COOLDOWN_MS).toISOString(),
            } as Record<string, unknown>,
            correlationId,
          })
          .catch((auditErr: unknown) => {
            logger.warn(
              { auditErr, strategyId: s.id },
              "candidate-backtest-conveyor: conveyor.candidate_skip_cooldown audit write failed (non-blocking)",
            );
          });
        return 0;
      }

      candidateConveyorEnqueuedTotal.inc();

      broadcastSSE("factory:candidate_backtest_enqueued", {
        strategyId: s.id,
        strategyName: s.name,
        backtestId: result.id,
        correlationId,
      });

      // Non-blocking audit write — failure must not abort the other strategies.
      db.insert(auditLog)
        .values({
          action: "lifecycle.candidate_conveyor_enqueued",
          entityType: "strategy",
          entityId: s.id,
          status: "success",
          decisionAuthority: "scheduler",
          input: { strategyName: s.name, symbol: s.symbol } as Record<string, unknown>,
          result: { backtestId: result.id } as Record<string, unknown>,
          correlationId,
        })
        .catch((auditErr: unknown) => {
          logger.warn(
            { auditErr, strategyId: s.id },
            "candidate-backtest-conveyor: audit write failed (non-blocking)",
          );
        });

      return 1;
    }),
  );

  // allSettled: one failed backtest must not abort the rest of the batch.
  let enqueued = 0;
  outcomes.forEach((o, i) => {
    if (o.status === "fulfilled") {
      enqueued += o.value;
    } else {
      logger.error(
        { err: o.reason, strategyId: candidates[i].id },
        "candidate-backtest-conveyor: per-strategy error (non-blocking)",
      );
    }
  });

  logger.info(
    { enqueued, evaluated: candidates.length, correlationId },
    "candidate-backtest-conveyor: tick complete",
  );

  // ── 5. Phase 3b: awaited checkAutoPromotions inside job-locked body ─────────
  // FINDING #4 FIX: was fire-and-forget (void (async()=>{})()) racing the 6h
  // lifecycle-auto-check cron with errors swallowed to logger.warn only.
  // Now awaited so the scheduler sees failures and can escalate via notifyWarning.
  if (enqueued > 0) {
    try {
      const { LifecycleService } = await import("./lifecycle-service.js");
      const lifecycle = new LifecycleService();
      await lifecycle.checkAutoPromotions({ correlationId });
    } catch (promotionErr) {
      logger.warn(
        { promotionErr, correlationId },
        "candidate-backtest-conveyor: checkAutoPromotions error",
      );
      notifyWarning(
        "[candidate-backtest-conveyor] checkAutoPromotions failed",
        `Auto-promotion check failed after enqueuing ${enqueued} backtest(s). ` +
        `Strategies may be delayed reaching TESTING stage. ` +
        `Error: ${promotionErr instanceof Error ? promotionErr.message : String(promotionErr)}`,
        { enqueued, correlationId },
      );
    }
  }
}
