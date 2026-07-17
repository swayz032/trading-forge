import { Router } from "express";
import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import { db } from "../db/index.js";
import { paperSessions, paperPositions, paperTrades, paperSignalLogs, paperSessionFeedback, strategies, backtests, monteCarloRuns, auditLog } from "../db/schema.js";
import { eq, desc, and, isNull, sql as drizzleSql } from "drizzle-orm";
import { broadcastSSE } from "./sse.js";
import { openPosition, closePosition, updatePositionPrices, getExecutionQuality, getTcaReport, getRollingMetrics } from "../services/paper-execution-service.js";
import { computeAndPersistSessionFeedback } from "../services/paper-session-feedback-service.js";
import { detectDrift } from "../services/drift-detection-service.js";
import { calculateCorrelation, portfolioCorrelationMatrix } from "../services/correlation-service.js";
import { startStream, stopStream, stopAllStreams, getActiveStreams, isStreaming, getBarBuffer, runSerializedPerSession } from "../services/paper-trading-stream.js";
import { logShadowSignal } from "../services/shadow-service.js";
import { cleanupSession } from "../services/paper-signal-service.js";
import { idempotencyMiddleware } from "../middleware/idempotency.js";
import { notifyWarning } from "../services/notification-service.js";
import { appendFamilyGradePostscript } from "../lib/notification-helpers.js";
import { trackG2SilentFailuresTotal } from "../lib/metrics-registry.js";

const router = Router();

/**
 * G7.1 contract — POST /api/paper/start response shape (201 Created).
 * Returns the freshly inserted paperSessions row. Sourced from Drizzle's
 * `$inferSelect` so any schema change auto-propagates here. Frontend imports
 * this type instead of redeclaring PaperSession by hand. See
 * `src/server/lib/api-contracts.ts` for the per-route contract pattern.
 */
export type PaperStartResponse = typeof paperSessions.$inferSelect;

const paperStartSchema = z.object({
  strategyId: z.string().uuid(),
  startingCapital: z.coerce.number().min(1000).max(500000).default(50000).transform(String),
  config: z.object({
    daily_loss_limit: z.number().positive({ message: "daily_loss_limit required to engage kill switch" }),
  }).passthrough().optional(),
  mode: z.enum(["paper", "shadow"]).default("paper"),
  firmId: z.string().optional().nullable(),
});

// POST /api/paper/start — start paper trading session + live stream
router.post("/start", idempotencyMiddleware, async (req, res) => {
  try {
    const parsed = paperStartSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten().fieldErrors });
      return;
    }
    const { strategyId, startingCapital, config, mode, firmId } = parsed.data;

    // P1-9: Require daily_loss_limit in config
    const dailyLossLimit = (config as Record<string, unknown> | undefined)?.daily_loss_limit;
    if (!dailyLossLimit || Number(dailyLossLimit) <= 0) {
      res.status(400).json({ error: "daily_loss_limit required to engage kill switch" });
      return;
    }

    // P1-1: Lifecycle guard — only allow paper trading for strategies in appropriate states
    const ALLOWED_LIFECYCLE_STATES = ["TESTING", "PAPER", "DEPLOY_READY", "DEPLOYED"];
    const [stratRow] = await db
      .select({ lifecycleState: strategies.lifecycleState })
      .from(strategies)
      .where(eq(strategies.id, strategyId));

    if (!stratRow) {
      res.status(404).json({ error: "Strategy not found" });
      return;
    }

    if (!ALLOWED_LIFECYCLE_STATES.includes(stratRow.lifecycleState)) {
      const reason = `Strategy lifecycleState '${stratRow.lifecycleState}' is not eligible for paper trading (allowed: ${ALLOWED_LIFECYCLE_STATES.join(", ")})`;
      await db.insert(auditLog).values({
        action: "paper.session_start_blocked",
        entityType: "strategy",
        entityId: strategyId,
        input: { strategyId, mode, lifecycleState: stratRow.lifecycleState },
        result: { reason },
        status: "blocked",
        decisionAuthority: "system",
        correlationId: req.id ?? null,
      });
      res.status(409).json({ error: reason });
      return;
    }

    // Pass 5 Track D.3: PAPER+ strategies must use TradersPost (paper-engine authority)
    // The internal Massive-WS simulator is pre-PAPER only (CANDIDATE/TESTING)
    const PAPER_PLUS_STATES = ["PAPER", "DEPLOY_READY", "PILOT", "DEPLOYED"];
    if (PAPER_PLUS_STATES.includes(stratRow.lifecycleState)) {
      await db.insert(auditLog).values({
        action: "paper.start_refused_paper_state",
        entityType: "strategy",
        entityId: strategyId,
        input: { strategyId, mode, lifecycleState: stratRow.lifecycleState, blocked_at: "POST /api/paper/start" },
        result: { reason: "PAPER+ strategies use TradersPost as canonical journal — internal simulator is pre-PAPER only" },
        status: "warn",
        decisionAuthority: "system",
        correlationId: req.id ?? null,
      });
      res.status(409).json({
        error: "paper_start_refused_paper_state",
        message: `Strategy is in ${stratRow.lifecycleState} state. PAPER+ strategies use TradersPost as the canonical paper journal. The internal simulator is for CANDIDATE/TESTING only.`,
        lifecycleState: stratRow.lifecycleState,
        blocked_at: "POST /api/paper/start",
      });
      return;
    }

    // API-2 (deep-scan 2026-07-11): the prior Track-C.2 advisory lock was keyed on the JUST-inserted
    // session UUID — globally unique, so it could NEVER collide, and two concurrent /start requests each
    // inserted their own session + Massive-WS stream (double-counted signals/metrics). Also
    // pg_try_advisory_lock is SESSION-level and leaks on the pooled connection. Correct pool-safe guard:
    // a TRANSACTION-level advisory lock (pg_advisory_xact_lock — globally exclusive, auto-released at
    // txn end on the SAME connection) keyed on the STABLE identity two concurrent requests SHARE —
    // (strategy_id, mode) — acquired BEFORE an existence check + insert, all in one transaction. At most
    // one active session per (strategy, mode) can be created; the loser gets a 409.
    const startLockKey = BigInt(
      "0x" + createHash("sha256").update(`paper_start:${strategyId}:${mode}`).digest("hex").slice(0, 15),
    );
    const session = await db.transaction(async (tx) => {
      await tx.execute(drizzleSql`SELECT pg_advisory_xact_lock(${startLockKey}::bigint)`);
      const [existing] = await tx
        .select({ id: paperSessions.id })
        .from(paperSessions)
        .where(
          and(
            eq(paperSessions.strategyId, strategyId),
            eq(paperSessions.mode, mode),
            eq(paperSessions.status, "active"),
          ),
        );
      if (existing) return null; // an active session already exists for this strategy+mode
      const [row] = await tx
        .insert(paperSessions)
        .values({ strategyId, startingCapital, currentEquity: startingCapital, config: config as import("../db/jsonb-shapes.js").PaperSessionConfigShape, mode, firmId: firmId ?? null })
        .returning();
      return row;
    });

    if (!session) {
      req.log.warn({ strategyId, mode }, "paper /start: active session already exists for strategy+mode — concurrent/duplicate start rejected (API-2)");
      await db.insert(auditLog).values({
        action: "paper.session_advisory_lock_collision",
        entityType: "paper_session",
        entityId: null,
        input: { strategyId, mode },
        result: { note: "active session already exists for strategy+mode — rejected via pg_advisory_xact_lock + existence check" },
        status: "warning",
        decisionAuthority: "system",
        correlationId: req.id ?? null,
      }).catch((auditErr) => req.log.warn({ auditErr, strategyId }, "paper.session_advisory_lock_collision audit write failed"));
      res.status(409).json({
        error: "paper_session_start_collision",
        message: "An active paper session already exists for this strategy. Stop it before starting a new one.",
        strategyId,
      });
      return;
    }

    // Look up strategy symbol(s) and start the Massive WS stream
    try {
      const [strat] = await db.select().from(strategies).where(eq(strategies.id, strategyId));
      const symbols: string[] = [];
      if (strat?.symbol) symbols.push(strat.symbol);
      // Also check config for additional symbols
      const stratConfig = strat?.config as Record<string, unknown> | undefined;
      if (stratConfig?.symbol && !symbols.includes(String(stratConfig.symbol))) {
        symbols.push(String(stratConfig.symbol));
      }
      if (symbols.length > 0) {
        startStream(session.id, symbols);
        req.log.info({ sessionId: session.id, symbols }, "Paper stream started for session");
      } else {
        req.log.warn({ sessionId: session.id, strategyId }, "No symbols found — stream not started");
      }
    } catch (streamErr) {
      // Track C.2: stream startup failure — write audit + Discord WARN + mark session failed_to_stream.
      const errMsg = streamErr instanceof Error ? streamErr.message : String(streamErr);
      req.log.error(streamErr, "Failed to start paper stream — writing paper.session_stream_failed audit");
      await db.insert(auditLog).values({
        action: "paper.session_stream_failed",
        entityType: "paper_session",
        entityId: session.id,
        input: { strategyId, sessionId: session.id },
        result: { error: errMsg, note: "Stream startup failed; session marked failed_to_stream" },
        status: "failure",
        decisionAuthority: "system",
        correlationId: req.id ?? null,
      }).catch((auditErr) => req.log.warn({ auditErr, sessionId: session.id }, "paper.session_stream_failed audit write failed (deepscan17)"));
      notifyWarning(
        `Paper Stream Failed: session ${session.id.slice(0, 8)} could not start live data`,
        appendFamilyGradePostscript(
          `Paper session \`${session.id.slice(0, 8)}\` for strategy \`${strategyId.slice(0, 8)}\` ` +
          `failed to start stream. Session marked \`failed_to_stream\`. ` +
          `Error: ${errMsg.slice(0, 200)}`,
          "A paper trading session started but live market data feed failed to connect.",
          "Stop and restart the paper session. If this keeps happening, check your MASSIVE_API_KEY in the .env file.",
        ),
      );
      await db
        .update(paperSessions)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .set({ status: "failed_to_stream" as any })
        .where(eq(paperSessions.id, session.id))
        .catch((updateErr) => {
          // Deep-scan #16 Wave 2 Track G2 (#14): if THIS update fails, the session
          // never actually reaches status='failed_to_stream' in the DB — the
          // auto-restart cron (which matches on that status) will never find this
          // session, and the dead stream stays invisible with no operator signal.
          // Log loudly + a distinct audit row + a counter so the gap is discoverable
          // even though we cannot safely retry synchronously from inside this
          // best-effort stream-startup catch block.
          const updateErrMsg = updateErr instanceof Error ? updateErr.message : String(updateErr);
          req.log.error(
            { err: updateErr, sessionId: session.id },
            "paper.session_start: FAILED to mark session failed_to_stream — auto-restart cron will not discover this dead stream",
          );
          db.insert(auditLog).values({
            action: "paper.failed_to_stream_status_update_failed",
            entityType: "paper_session",
            entityId: session.id,
            input: { strategyId, sessionId: session.id },
            result: {
              error: updateErrMsg,
              note: "status UPDATE to failed_to_stream did not persist — auto-restart cron will not match this session",
            },
            status: "failure",
            decisionAuthority: "system",
            correlationId: req.id ?? null,
          }).catch(() => { /* best-effort secondary audit; primary failure already logged above */ });
          try { trackG2SilentFailuresTotal.labels({ site: "paper_session_failed_to_stream_update" }).inc(); } catch { /* non-blocking counter */ }
        });
    }

    // Audit trail — paper session lifecycle
    await db.insert(auditLog).values({
      action: "paper.session_start",
      entityType: "paper_session",
      entityId: session.id,
      input: { strategyId, mode, firmId: firmId ?? null },
      result: { sessionId: session.id, startingCapital },
      status: "success",
      decisionAuthority: "human",
      correlationId: req.id ?? null,
    });

    broadcastSSE("paper:session_start", { sessionId: session.id, strategyId });
    req.log.info({ sessionId: session.id }, "Paper trading session started");
    const response: PaperStartResponse = session;
    res.status(201).json(response);
  } catch (err: any) {
    req.log.error(err, "Failed to start paper session");
    res.status(500).json({ error: err.message });
  }
});

// POST /api/paper/stop — stop session + tear down stream
router.post("/stop", async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) return res.status(400).json({ error: "sessionId required" });

    // Get symbols before stopping (needed for cache cleanup)
    const streamInfo = getActiveStreams().get(sessionId);
    const symbols = streamInfo?.symbols ?? [];

    // Stop the live stream first
    if (isStreaming(sessionId)) {
      stopStream(sessionId);
      req.log.info({ sessionId }, "Paper stream stopped");
    }

    // Clean up in-memory caches (indicator history, session config)
    cleanupSession(sessionId, symbols);

    // Check session exists and isn't already stopped
    const [current] = await db.select({ status: paperSessions.status }).from(paperSessions).where(eq(paperSessions.id, sessionId));
    if (!current) return res.status(404).json({ error: "Session not found" });
    if (current.status === "stopped") return res.status(409).json({ error: "Session already stopped" });

    const [session] = await db
      .update(paperSessions)
      .set({ status: "stopped", stoppedAt: new Date() })
      .where(eq(paperSessions.id, sessionId))
      .returning();
    req.log.info({ sessionId }, "Paper trading session stopped");

    // Generate post-trade QuantStats analytics report (fire-and-forget).
    // Primary: build per-trade returns series from paperTrades.pnl (trade-level
    // granularity is more accurate than daily aggregation for short sessions).
    // Fallback: use dailyPnlBreakdown if no completed trades exist.
    // Persists Sharpe, Sortino, Calmar, max DD, win rate, profit factor, etc.
    // to paper_sessions.metricsSnapshot for promotion-gate consumption.
    //
    // B8b: analyticsSnapshot is captured for use in the PILOT session recorder below.
    let analyticsSnapshot: Record<string, unknown> | null = null;
    try {
      const { runPythonModule } = await import("../lib/python-runner.js");

      // Query all completed trades for this session
      const sessionTrades = await db
        .select({ pnl: paperTrades.pnl })
        .from(paperTrades)
        .where(eq(paperTrades.sessionId, sessionId))
        .orderBy(paperTrades.exitTime);

      let returnsForAnalytics: number[] | null = null;
      let returnsSource = "none";

      if (sessionTrades.length >= 2) {
        // Per-trade P&L series — preferred: directly reflects each closed trade
        returnsForAnalytics = sessionTrades
          .map((t) => parseFloat(t.pnl ?? "0"))
          .filter((v) => isFinite(v));
        returnsSource = "per_trade";
      } else {
        // Fall back to daily P&L breakdown (daily-aggregated returns)
        const dailyPnl = session.dailyPnlBreakdown as Record<string, number> | null;
        if (dailyPnl && Object.keys(dailyPnl).length >= 1) {
          returnsForAnalytics = Object.values(dailyPnl).filter((v) => isFinite(v));
          returnsSource = "daily_breakdown";
        }
      }

      if (returnsForAnalytics && returnsForAnalytics.length >= 1) {
        const analyticsResult = await runPythonModule({
          module: "src.engine.paper_analytics",
          config: {
            daily_returns: returnsForAnalytics,
            title: `Paper Session ${sessionId.slice(0, 8)}`,
          },
          timeoutMs: 15_000,
          componentName: "paper-analytics",
        });
        // Augment the analytics result with metadata so the promotion gate knows
        // what series type was used and how many data points fed the computation.
        const snapshot = {
          ...(analyticsResult as Record<string, unknown>),
          returns_source: returnsSource,
          n_trades: sessionTrades.length,
        };
        analyticsSnapshot = snapshot;
        await db.update(paperSessions)
          .set({ metricsSnapshot: snapshot as any })
          .where(eq(paperSessions.id, sessionId));
        req.log.info(
          { sessionId, returnsSource, n: returnsForAnalytics.length },
          "Paper analytics report generated",
        );
      } else {
        req.log.info({ sessionId }, "Paper analytics skipped — insufficient trade data");
      }
    } catch (analyticsErr) {
      req.log.warn({ sessionId, err: analyticsErr }, "Paper analytics failed (non-blocking)");
    }

    // Audit trail — paper session lifecycle
    await db.insert(auditLog).values({
      action: "paper.session_stop",
      entityType: "paper_session",
      entityId: sessionId,
      input: { sessionId },
      result: {
        stoppedAt: session.stoppedAt?.toISOString() ?? new Date().toISOString(),
        totalTrades: session.totalTrades,
        currentEquity: session.currentEquity,
      },
      status: "success",
      decisionAuthority: "human",
      correlationId: req.id ?? null,
    });

    broadcastSSE("paper:session_stop", { sessionId });

    // Phase 4.6 — Compute and persist per-session feedback (non-blocking).
    // Failure here must never block the stop response or roll back the status update.
    computeAndPersistSessionFeedback(sessionId)
      .then(() => {
        broadcastSSE("paper:session-feedback-computed", { sessionId });
      })
      .catch((feedbackErr) => {
        req.log.warn({ sessionId, err: feedbackErr }, "Failed to compute/persist session feedback (non-blocking)");
      });

    // B8b: PILOT canary — record completed pilot session.
    // Fire-and-forget: session close is never blocked by pilot_sessions write.
    //
    // Condition: strategy must currently be in PILOT state.
    // Outcome: "passed" for normal manual stop (kill-switch stops close a position,
    //   not the session directly; kill events record "killed" via the kill-switch path
    //   which is handled by the scheduler's checkPilotAutoPromotions sweep).
    // rollingSharpeFinal: extracted from analytics snapshot (may be null if analytics
    //   failed or insufficient data — sweep evaluates null Sharpe as criteria-not-met).
    // compliancePassed: true for a normal manual stop (compliance violations block
    //   signal emission earlier in the stack; a session that completes normally has
    //   not triggered a compliance kill).
    //
    // Idempotency: recordPilotSession inserts a new row each time; duplicate calls
    //   would over-count sessions. The stop route is idempotent at the HTTP level
    //   (409 on re-stop) so this fires at most once per session lifecycle.
    if (session.strategyId) {
      (async () => {
        try {
          const [strategyForPilot] = await db
            .select({ lifecycleState: strategies.lifecycleState })
            .from(strategies)
            .where(eq(strategies.id, session.strategyId!));

          if (strategyForPilot?.lifecycleState === "PILOT") {
            // Extract rolling Sharpe from the analytics snapshot (may be null).
            // paper_analytics module returns a "sharpe" key (annualized Sharpe ratio).
            const sharpeRaw = analyticsSnapshot?.sharpe;
            const rollingSharpeFinal =
              typeof sharpeRaw === "number" && isFinite(sharpeRaw) ? sharpeRaw : null;

            const { LifecycleService } = await import("../services/lifecycle-service.js");
            const lifecycleService = new LifecycleService();
            await lifecycleService.recordPilotSession({
              strategyId: session.strategyId!,
              paperSessionId: sessionId,
              rollingSharpeFinal,
              compliancePassed: true,  // normal stop = no compliance kill; violation kills are handled by kill-switch path
              outcome: "passed",
            });
            req.log.info(
              { sessionId, strategyId: session.strategyId, rollingSharpeFinal },
              "PILOT canary: pilot session recorded (normal stop)",
            );
          }
        } catch (pilotErr) {
          req.log.warn({ sessionId, err: pilotErr }, "PILOT canary: recordPilotSession failed (non-blocking)");
        }
      })();
    }

    res.json(session);
  } catch (err: any) {
    req.log.error(err, "Failed to stop paper session");
    res.status(500).json({ error: err.message });
  }
});

// GET /api/paper/sessions — list sessions (optional ?status=active|stopped)
router.get("/sessions", async (req, res) => {
  try {
    const statusFilter = req.query.status ? String(req.query.status) : undefined;
    const conditions = statusFilter
      ? eq(paperSessions.status, statusFilter)
      : undefined;
    const sessions = await db
      .select()
      .from(paperSessions)
      .where(conditions)
      .orderBy(desc(paperSessions.startedAt));
    res.json(sessions);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/paper/sessions/:id — session detail
router.get("/sessions/:id", async (req, res) => {
  try {
    const [session] = await db
      .select()
      .from(paperSessions)
      .where(eq(paperSessions.id, req.params.id));
    if (!session) return res.status(404).json({ error: "Session not found" });
    res.json(session);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/paper/positions — open positions
router.get("/positions", async (_req, res) => {
  try {
    const positions = await db
      .select()
      .from(paperPositions)
      .orderBy(desc(paperPositions.entryTime));
    res.json(positions);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/paper/trades — trade history
router.get("/trades", async (_req, res) => {
  try {
    const trades = await db
      .select()
      .from(paperTrades)
      .orderBy(desc(paperTrades.exitTime));
    res.json(trades);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/paper/execute/open — open a position with realistic fills
router.post("/execute/open", idempotencyMiddleware, async (req, res) => {  // deep-scan routes F-2: dedupe double-POST
  try {
    const { sessionId, symbol, side, signalPrice, contracts = 1 } = req.body;
    if (!sessionId || !symbol || !side || !signalPrice) {
      return res.status(400).json({ error: "sessionId, symbol, side, signalPrice required" });
    }
    const result = await openPosition(sessionId, {
      symbol,
      side,
      signalPrice: Number(signalPrice),
      contracts: Number(contracts),
    });

    // Fill probability miss — return 422 so callers know no position was opened
    if (!result.executionResult.filled) {
      return res.status(422).json(result);
    }

    // Log shadow signal if session is in shadow mode
    const [sessionRow] = await db
      .select({ mode: paperSessions.mode })
      .from(paperSessions)
      .where(eq(paperSessions.id, sessionId));

    if (sessionRow?.mode === "shadow" && result.executionResult.actualPrice != null) {
      const actualPrice = result.executionResult.actualPrice;
      // Propagate a per-request correlationId so the shadow signal is
      // linkable end-to-end: HTTP request → shadow_signals row → audit_log.
      const shadowCorrelationId = (req as unknown as Record<string, unknown>).correlationId as string | undefined
        ?? randomUUID();
      await logShadowSignal({
        sessionId,
        signalTime: new Date(),
        direction: side as "long" | "short",
        expectedEntry: parseFloat(signalPrice),
        actualMarketPrice: actualPrice,
        modelSlippage: Math.abs(parseFloat(signalPrice) - actualPrice),
        correlationId: shadowCorrelationId,
      });
    }

    res.status(201).json(result);
  } catch (err: any) {
    req.log.error(err, "Failed to open paper position");
    res.status(500).json({ error: err.message });
  }
});

// POST /api/paper/execute/close — close a position with realistic fills
router.post("/execute/close", idempotencyMiddleware, async (req, res) => {  // deep-scan routes F-2: dedupe double-POST
  try {
    const { positionId, exitSignalPrice } = req.body;
    if (!positionId || !exitSignalPrice) {
      return res.status(400).json({ error: "positionId, exitSignalPrice required" });
    }
    // F-3: wall-clock CORRECT here (manual close via external signal — genuinely real-time,
    // no bar being replayed).
    const result = await closePosition(positionId, Number(exitSignalPrice));
    res.json(result);
  } catch (err: any) {
    req.log.error(err, "Failed to close paper position");
    res.status(500).json({ error: err.message });
  }
});

// POST /api/paper/prices — update live prices for open positions
router.post("/prices", async (req, res) => {
  try {
    const { sessionId, prices } = req.body;
    if (!sessionId || !prices) {
      return res.status(400).json({ error: "sessionId, prices required" });
    }
    // deepscan14 E2: this is the external-reachable twin of the E1 WS-bar drop —
    // mint a correlationId when the caller doesn't supply one so exit-handler
    // audit rows fired from this route aren't stuck at correlation_id:null.
    const correlationId = req.body.correlationId ?? randomUUID();
    // F-2 (re-scan 2026-07-10): serialize against the live WS bar loop on this session so
    // this external price update can't race the stream's updatePositionPrices (lost-update
    // on unrealized equity / MAE / MFE that feed the cross-symbol DLL ladder). Chains on the
    // same per-session lock the stream uses.
    const result = await runSerializedPerSession(sessionId, () =>
      updatePositionPrices(sessionId, prices, undefined, { correlationId }),
    );
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/paper/execution-quality/:sessionId — execution quality stats
router.get("/execution-quality/:sessionId", async (req, res) => {
  try {
    const result = await getExecutionQuality(req.params.sessionId);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/paper/drift/:sessionId — drift detection for a session
router.get("/drift/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { strategyId } = req.query;
    if (!strategyId) {
      return res.status(400).json({ error: "strategyId query param required" });
    }
    const report = await detectDrift(String(strategyId), sessionId);
    res.json(report);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/paper/correlation — correlation between two sessions
router.post("/correlation", async (req, res) => {
  try {
    const { sessionId1, sessionId2 } = req.body;
    if (!sessionId1 || !sessionId2) {
      return res.status(400).json({ error: "sessionId1, sessionId2 required" });
    }
    const result = await calculateCorrelation(sessionId1, sessionId2);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/paper/correlation/matrix — portfolio correlation matrix
router.post("/correlation/matrix", async (req, res) => {
  try {
    const { sessionIds } = req.body;
    if (!Array.isArray(sessionIds) || sessionIds.length < 2) {
      return res.status(400).json({ error: "sessionIds must be array with 2+ IDs" });
    }
    const results = await portfolioCorrelationMatrix(sessionIds);
    res.json(results);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/paper/signals/:sessionId — signal log for a session
router.get("/signals/:sessionId", async (req, res) => {
  try {
    const limitNum = Math.min(Math.max(Number(req.query.limit) || 100, 1), 1000);
    const offsetNum = Math.max(Number(req.query.offset) || 0, 0);
    const signals = await db
      .select()
      .from(paperSignalLogs)
      .where(eq(paperSignalLogs.sessionId, req.params.sessionId))
      .orderBy(desc(paperSignalLogs.createdAt))
      .limit(limitNum)
      .offset(offsetNum);
    res.json(signals);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/paper/signals/:sessionId/stats — signal stats summary
router.get("/signals/:sessionId/stats", async (req, res) => {
  try {
    const signals = await db
      .select()
      .from(paperSignalLogs)
      .where(eq(paperSignalLogs.sessionId, req.params.sessionId));
    const total = signals.length;
    const acted = signals.filter(s => s.acted).length;
    const notActed = total - acted;
    // Break down non-acted by reason
    const cooldown = signals.filter(s => s.reason === "cooldown").length;
    const riskGate = signals.filter(s => s.reason === "risk_gate_rejected").length;
    const sessionFilter = signals.filter(s => s.reason === "session_filter").length;
    const stopLoss = signals.filter(s => s.signalType === "stop_loss").length;
    res.json({ total, acted, notActed, cooldown, riskGate, sessionFilter, stopLoss });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/paper/streams — active stream status
router.get("/streams", async (_req, res) => {
  try {
    const streams = getActiveStreams();
    const result: Record<string, { symbols: string[]; connected: boolean }> = {};
    for (const [sessionId, info] of streams) {
      result[sessionId] = info;
    }
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/paper/streams/stop-all — emergency stop all streams
router.post("/streams/stop-all", async (_req, res) => {
  try {
    stopAllStreams();
    res.json({ status: "ok", message: "All streams stopped" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/paper/bars/:symbol — rolling bar buffer for live chart
router.get("/bars/:symbol", async (req, res) => {
  try {
    const bars = getBarBuffer(req.params.symbol);
    // Transform to LightweightCharts format
    const chartData = bars.map((b) => ({
      time: Math.floor(new Date(b.timestamp).getTime() / 1000),
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: b.volume,
    }));
    res.json(chartData);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/paper/mc-compare/:sessionId — compare paper session P&L against MC distribution
router.get("/mc-compare/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;

    // Load the paper session
    const [session] = await db
      .select()
      .from(paperSessions)
      .where(eq(paperSessions.id, sessionId));
    if (!session) return res.status(404).json({ error: "Session not found" });

    const strategyId = session.strategyId;
    if (!strategyId) return res.status(400).json({ error: "Session has no linked strategy" });

    // Sum up paper trades P&L for this session
    const trades = await db
      .select({ pnl: paperTrades.pnl })
      .from(paperTrades)
      .where(eq(paperTrades.sessionId, sessionId));
    const paperPnl = trades.reduce((sum, t) => {
      const val = parseFloat(t.pnl);
      return sum + (isNaN(val) ? 0 : val);
    }, 0);

    // Get latest completed backtest for this strategy
    const [latestBacktest] = await db
      .select()
      .from(backtests)
      .where(and(eq(backtests.strategyId, strategyId), eq(backtests.status, "completed")))
      .orderBy(desc(backtests.createdAt))
      .limit(1);

    if (!latestBacktest) {
      return res.json({
        sessionId,
        strategyId,
        paperPnl,
        mc_percentile: null,
        driftFromMedian: null,
        warning: "No completed backtest found for this strategy",
      });
    }

    // Get MC run for that backtest
    const [mcRun] = await db
      .select()
      .from(monteCarloRuns)
      .where(eq(monteCarloRuns.backtestId, latestBacktest.id))
      .orderBy(desc(monteCarloRuns.createdAt))
      .limit(1);

    if (!mcRun) {
      return res.json({
        sessionId,
        strategyId,
        paperPnl,
        mc_percentile: null,
        driftFromMedian: null,
        warning: "No MC run found for the latest backtest",
      });
    }

    // Compare paper P&L against MC percentiles (using max drawdown distribution as proxy)
    // MC stores p5, p50, p95 for Sharpe — use total return from backtest + MC risk metrics
    const p5 = parseFloat(mcRun.sharpeP5 ?? "0");
    const p50 = parseFloat(mcRun.sharpeP50 ?? "0");
    const p95 = parseFloat(mcRun.sharpeP95 ?? "0");

    // Estimate percentile of paper P&L using linear interpolation between MC bounds
    // Use backtest total return as the MC median outcome reference
    const backtestReturn = parseFloat(latestBacktest.totalReturn ?? "0");
    const driftFromMedian = backtestReturn !== 0
      ? ((paperPnl - backtestReturn) / Math.abs(backtestReturn)) * 100
      : 0;

    // Rough percentile estimation: map paper P&L into the MC distribution
    // Use absolute distance from backtest median, works for both positive and negative returns
    let mc_percentile: number;
    if (backtestReturn <= 0) {
      // Can't estimate percentile without a positive baseline (negative-return strategies are rejected by gates)
      mc_percentile = 50;
    } else {
      const ratio = paperPnl / backtestReturn; // >1 = outperforming, <1 = underperforming
      if (ratio <= 0.5) mc_percentile = 5;
      else if (ratio <= 0.75) mc_percentile = 25;
      else if (ratio <= 1.0) mc_percentile = 50;
      else if (ratio <= 1.25) mc_percentile = 75;
      else mc_percentile = 95;
    }

    const warning = Math.abs(driftFromMedian) > 100
      ? `Paper P&L drifts ${driftFromMedian.toFixed(1)}% from backtest median — investigate`
      : undefined;

    res.json({
      sessionId,
      strategyId,
      paperPnl,
      backtestReturn,
      mc_percentile,
      driftFromMedian: parseFloat(driftFromMedian.toFixed(2)),
      mcSharpe: { p5, p50, p95 },
      warning,
    });
  } catch (err: any) {
    req.log.error(err, "MC compare failed");
    res.status(500).json({ error: err.message });
  }
});

// POST /api/paper/kill/:sessionId — Immediate stop
router.post("/kill/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;

    // Get symbols before stopping (needed for cache cleanup)
    const streamInfo = getActiveStreams().get(sessionId);
    const symbols = streamInfo?.symbols ?? [];

    // Stop the live stream if active
    if (isStreaming(sessionId)) {
      stopStream(sessionId);
      req.log.info({ sessionId }, "Paper stream killed");
    }

    // Clean up in-memory caches
    cleanupSession(sessionId, symbols);

    // Read before-status and strategyId for audit trail (P1-2)
    const [sessionBefore] = await db
      .select({ status: paperSessions.status, strategyId: paperSessions.strategyId })
      .from(paperSessions)
      .where(eq(paperSessions.id, sessionId));

    // BL-5 FIX: Close orphan positions before marking session stopped.
    // Without this, positions remain with closedAt=NULL after a kill, making them
    // unreconcilable and corrupting session P&L and promotion-gate inputs.
    // Closed at last-known mark-to-market price (currentPrice).
    // Fail-soft: a single position close failure logs and continues (best-effort flatten).
    {
      const openPositions = await db.select().from(paperPositions)
        .where(and(eq(paperPositions.sessionId, sessionId), isNull(paperPositions.closedAt)));
      for (const pos of openPositions) {
        const exitPrice = pos.currentPrice != null ? Number(pos.currentPrice) : Number(pos.entryPrice);
        try {
          // F-3: wall-clock CORRECT here (manual/kill-switch close via the kill route —
          // genuinely real-time, no bar being replayed).
          await closePosition(pos.id, exitPrice, undefined, { correlationId: req.id ?? undefined });
          req.log.info({ sessionId, positionId: pos.id, exitPrice }, "kill: position closed at last-known MtM price");
        } catch (posCloseErr) {
          req.log.error({ sessionId, positionId: pos.id, exitPrice, err: posCloseErr }, "kill: position close FAILED — orphan position may remain");
          // Write audit row so the gap is visible in reconciliation
          await db.insert(auditLog).values({
            action: "paper.kill_position_close_failed",
            entityType: "paper_position",
            entityId: pos.id,
            decisionAuthority: "human",
            input: { sessionId, exitPrice, killReason: req.body?.reason ?? "operator_kill" },
            result: { error: String(posCloseErr), positionId: pos.id },
            status: "error",
            correlationId: req.id ?? null,
          }).catch(() => undefined);
        }
      }
    }

    await db
      .update(paperSessions)
      .set({ status: "stopped", stoppedAt: new Date() })
      .where(eq(paperSessions.id, sessionId));

    // Phase 4.6 — Compute and persist per-session feedback from the kill path so emergency
    // stops also produce a feedback row. Non-blocking: must never delay the kill response.
    computeAndPersistSessionFeedback(sessionId)
      .then(() => {
        broadcastSSE("paper:session-feedback-computed", { sessionId, source: "kill" });
      })
      .catch((feedbackErr) => {
        req.log.warn({ sessionId, err: feedbackErr }, "Failed to compute/persist session feedback from kill path (non-blocking)");
      });

    // P1-2: Audit trail for kill
    const killReason = req.body?.reason ?? "operator_kill";
    await db.insert(auditLog).values({
      action: "paper.session_kill",
      entityType: "paper_session",
      entityId: sessionId,
      input: { sessionId, strategyId: sessionBefore?.strategyId ?? null, reason: killReason },
      result: {
        before: { status: sessionBefore?.status ?? "unknown" },
        after: { status: "stopped" },
      },
      status: "success",
      decisionAuthority: "human",
      correlationId: req.id ?? null,
    });

    res.json({ killed: true, session_id: sessionId });
  } catch (err) {
    req.log.error({ err }, "Kill switch failed");
    res.status(500).json({ error: "Kill switch failed", details: String(err) });
  }
});

// GET /api/paper/sessions/:id/feedback — fetch the persisted session feedback row
router.get("/sessions/:id/feedback", async (req, res) => {
  try {
    const [row] = await db
      .select()
      .from(paperSessionFeedback)
      .where(eq(paperSessionFeedback.sessionId, req.params.id));
    if (!row) return res.status(404).json({ error: "No feedback computed for this session yet" });
    res.json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/paper/strategies/:strategyId/feedback — list all session feedback for a strategy
router.get("/strategies/:strategyId/feedback", async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(paperSessionFeedback)
      .where(eq(paperSessionFeedback.strategyId, req.params.strategyId))
      .orderBy(desc(paperSessionFeedback.computedAt));
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/paper/shadow/:sessionId/report
router.get("/shadow/:sessionId/report", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { getShadowReport } = await import("../services/shadow-service.js");
    const report = await getShadowReport(sessionId);
    res.json(report);
  } catch (err) {
    req.log.error({ err }, "Shadow report failed");
    res.status(500).json({ error: "Shadow report failed", details: String(err) });
  }
});

// GET /api/paper/metrics/:sessionId — rolling Sharpe + daily P&L breakdown
router.get("/metrics/:sessionId", async (req, res) => {
  try {
    const result = await getRollingMetrics(req.params.sessionId);
    if (!result) return res.status(404).json({ error: "Session not found" });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/paper/tca/:sessionId — Transaction Cost Analysis report
router.get("/tca/:sessionId", async (req, res) => {
  try {
    const result = await getTcaReport(req.params.sessionId);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/paper/pause/:sessionId — pause signal evaluation (stream stays alive)
router.post("/pause/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;
    // Only active sessions can be paused
    const [current] = await db.select({ status: paperSessions.status }).from(paperSessions).where(eq(paperSessions.id, sessionId));
    if (!current) return res.status(404).json({ error: "Session not found" });
    if (current.status !== "active") return res.status(409).json({ error: `Cannot pause session in '${current.status}' state` });

    const [session] = await db
      .update(paperSessions)
      .set({ status: "paused", pausedAt: new Date() })
      .where(eq(paperSessions.id, sessionId))
      .returning();
    req.log.info({ sessionId }, "Paper session paused");

    // P1-3: Audit trail for pause
    await db.insert(auditLog).values({
      action: "paper.session_pause",
      entityType: "paper_session",
      entityId: sessionId,
      input: { sessionId },
      result: {
        before: { status: current.status },
        after: { status: "paused" },
      },
      status: "success",
      decisionAuthority: "human",
      correlationId: req.id ?? null,
    });

    res.json(session);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/paper/resume/:sessionId — resume signal evaluation
router.post("/resume/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;
    // Only paused sessions can be resumed
    const [current] = await db.select({ status: paperSessions.status }).from(paperSessions).where(eq(paperSessions.id, sessionId));
    if (!current) return res.status(404).json({ error: "Session not found" });
    if (current.status !== "paused") return res.status(409).json({ error: `Cannot resume session in '${current.status}' state` });

    const [session] = await db
      .update(paperSessions)
      .set({ status: "active", pausedAt: null })
      .where(eq(paperSessions.id, sessionId))
      .returning();
    req.log.info({ sessionId }, "Paper session resumed");

    // P1-3: Audit trail for resume
    await db.insert(auditLog).values({
      action: "paper.session_resume",
      entityType: "paper_session",
      entityId: sessionId,
      input: { sessionId },
      result: {
        before: { status: current.status },
        after: { status: "active" },
      },
      status: "success",
      decisionAuthority: "human",
      correlationId: req.id ?? null,
    });

    res.json(session);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// H8: GET /api/paper/parity-mode — expose skip/anti-setup gate modes for external inspection.
// These env vars are read by Python gate modules; Node reads them directly here since
// Node inherits the process environment (which Python subprocesses also inherit).
// Returns one of: "off" | "shadow" | "enforce" for each mode.
router.get("/parity-mode", (_req, res) => {
  res.json({
    skip_mode: process.env.TF_BACKTEST_SKIP_MODE ?? "off",
    anti_setup_mode: process.env.TF_BACKTEST_ANTI_SETUP_MODE ?? "off",
  });
});

export { router as paperRoutes };
