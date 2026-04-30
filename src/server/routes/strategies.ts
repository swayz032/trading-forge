import { Router } from "express";
import { eq, sql, desc, and, ilike } from "drizzle-orm";
import { db } from "../db/index.js";
import { strategies, backtests, backtestTrades, monteCarloRuns, stressTestRuns, backtestMatrix, systemJournal, complianceReviews, paperSessions, skipDecisions, strategyGraveyard, auditLog, strategyExports, strategyExportArtifacts } from "../db/schema.js";
import { inArray } from "drizzle-orm";
import { logger } from "../index.js";
import { broadcastSSE } from "./sse.js";
import { LifecycleService } from "../services/lifecycle-service.js";
import { isActive as isPipelineActive } from "../services/pipeline-control-service.js";

export const strategyRoutes = Router();
const lifecycleService = new LifecycleService();

/**
 * G7.1 contract — POST /api/strategies/:id/deploy response shape.
 * Frontend must import this type instead of redeclaring it. See
 * `src/server/lib/api-contracts.ts` for the per-route contract pattern.
 */
export interface DeployStrategyResponse {
  success: true;
  id: string;
  newState: "DEPLOYED";
  message: string;
}

function asNumericOrNull(value: unknown): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getMcSummary(latestMc: typeof monteCarloRuns.$inferSelect | undefined) {
  if (!latestMc) return null;

  const riskMetrics =
    latestMc.riskMetrics && typeof latestMc.riskMetrics === "object"
      ? (latestMc.riskMetrics as Record<string, unknown>)
      : null;

  const medianReturn =
    asNumericOrNull(riskMetrics?.medianReturn) ??
    asNumericOrNull(riskMetrics?.p50Return) ??
    asNumericOrNull(riskMetrics?.returnP50);

  const probabilityOfRuin = asNumericOrNull(latestMc.probabilityOfRuin);
  const survivalRate =
    probabilityOfRuin == null ? null : Math.max(0, Math.min(1, 1 - probabilityOfRuin));

  return {
    survivalRate,
    medianReturn,
    worstDrawdown: asNumericOrNull(latestMc.maxDrawdownP95),
  };
}

function getPaperWinRate(paperSession: typeof paperSessions.$inferSelect | undefined) {
  if (!paperSession?.metricsSnapshot || typeof paperSession.metricsSnapshot !== "object") {
    return null;
  }

  return asNumericOrNull((paperSession.metricsSnapshot as Record<string, unknown>).winRate);
}

// List all strategies (with optional pagination + filters)
strategyRoutes.get("/", async (req, res) => {
  const { limit, offset, name, lifecycleState, symbol } = req.query;

  // Build filter conditions
  const conditions = [];
  if (name) conditions.push(ilike(strategies.name, `%${String(name)}%`));
  if (lifecycleState) conditions.push(eq(strategies.lifecycleState, String(lifecycleState)));
  if (symbol) conditions.push(eq(strategies.symbol, String(symbol)));
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  if (limit) {
    // Paginated mode
    const countQuery = where
      ? db.select({ count: sql<number>`count(*)::int` }).from(strategies).where(where)
      : db.select({ count: sql<number>`count(*)::int` }).from(strategies);
    const [{ count: total }] = await countQuery;

    let query = db.select().from(strategies).where(where).orderBy(desc(strategies.createdAt));
    query = query.limit(Number(limit)) as typeof query;
    if (offset) {
      query = query.offset(Number(offset)) as typeof query;
    }
    const rows = await query;
    res.json({ data: rows, total });
  } else {
    // Non-paginated (backward compatible)
    const rows = await db.select().from(strategies).where(where).orderBy(strategies.createdAt);
    res.json(rows);
  }
});

// Pipeline health
strategyRoutes.get("/pipeline", async (_req, res) => {
  const health = await lifecycleService.getPipelineHealth();
  res.json(health);
});

// GET /api/strategies/library — browse DEPLOY_READY strategies (your deployment shelf)
// MUST be before /:id to avoid Express matching "library" as a UUID
strategyRoutes.get("/library", async (_req, res) => {
  try {
    const readyStrategies = await db
      .select()
      .from(strategies)
      .where(eq(strategies.lifecycleState, "DEPLOY_READY"))
      .orderBy(desc(strategies.updatedAt));

    const library = await Promise.all(
      readyStrategies.map(async (s) => {
        const [latestBt] = await db
          .select()
          .from(backtests)
          .where(and(eq(backtests.strategyId, s.id), eq(backtests.status, "completed")))
          .orderBy(desc(backtests.createdAt))
          .limit(1);

        const [latestMc] = await db
          .select()
          .from(monteCarloRuns)
          .where(latestBt ? eq(monteCarloRuns.backtestId, latestBt.id) : sql`false`)
          .orderBy(desc(monteCarloRuns.createdAt))
          .limit(1);

        const [paperSession] = await db
          .select()
          .from(paperSessions)
          .where(eq(paperSessions.strategyId, s.id))
          .orderBy(desc(paperSessions.createdAt))
          .limit(1);

        return {
          id: s.id,
          name: s.name,
          symbol: s.symbol,
          timeframe: s.timeframe,
          tags: s.tags,
          rollingSharpe30d: s.rollingSharpe30d,
          lifecycleChangedAt: s.lifecycleChangedAt,
          backtest: latestBt
            ? {
                tier: latestBt.tier,
                sharpe: latestBt.sharpeRatio,
                profitFactor: latestBt.profitFactor,
                winRate: latestBt.winRate,
                maxDrawdown: latestBt.maxDrawdown,
                avgDailyPnl: latestBt.avgDailyPnl,
                totalTrades: latestBt.totalTrades,
              }
            : null,
          monteCarlo: latestMc
            ? getMcSummary(latestMc)
            : null,
          paperTrading: paperSession
            ? {
                startedAt: paperSession.createdAt,
                currentEquity: paperSession.currentEquity,
                peakEquity: paperSession.peakEquity,
                totalTrades: paperSession.totalTrades,
                winRate: getPaperWinRate(paperSession),
              }
            : null,
        };
      }),
    );

    res.json({ total: library.length, strategies: library });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get single strategy
strategyRoutes.get("/:id", async (req, res) => {
  const [row] = await db
    .select()
    .from(strategies)
    .where(eq(strategies.id, req.params.id));
  if (!row) {
    res.status(404).json({ error: "Strategy not found" });
    return;
  }
  res.json(row);
});

/**
 * GET /api/strategies/:id/dsl
 * Returns the strategy as a human-readable YAML representation of its DSL.
 * The DSL schema is defined in src/engine/compiler/strategy_schema.py (StrategyDSL).
 */
strategyRoutes.get("/:id/dsl", async (req, res) => {
  const [row] = await db
    .select()
    .from(strategies)
    .where(eq(strategies.id, req.params.id));
  if (!row) {
    res.status(404).json({ error: "Strategy not found" });
    return;
  }

  // Render the strategy as YAML — preserves the DSL shape from strategy_schema.py
  // without pulling in a YAML parser dependency. Manual emission keeps key order
  // deterministic for diffing across versions.
  const cfg = (row.config ?? {}) as Record<string, unknown>;
  const lines: string[] = [];
  const indent = (s: string) => `  ${s}`;

  const yamlScalar = (v: unknown): string => {
    if (v === null || v === undefined) return "null";
    if (typeof v === "boolean" || typeof v === "number") return String(v);
    if (Array.isArray(v)) {
      if (v.length === 0) return "[]";
      return "\n" + v.map((item) => indent(`- ${yamlScalar(item)}`)).join("\n");
    }
    if (typeof v === "object") {
      const entries = Object.entries(v as Record<string, unknown>);
      if (entries.length === 0) return "{}";
      return "\n" + entries.map(([k, val]) => indent(`${k}: ${yamlScalar(val)}`)).join("\n");
    }
    const s = String(v);
    // quote if contains special chars
    return /[:#&*!|>'"%@`,\[\]{}]/.test(s) || s.includes("\n") ? JSON.stringify(s) : s;
  };

  lines.push(`# Trading Forge — Strategy DSL`);
  lines.push(`# schema: src/engine/compiler/strategy_schema.py`);
  lines.push("");
  lines.push(`name: ${yamlScalar(row.name)}`);
  if (row.description) lines.push(`description: ${yamlScalar(row.description)}`);
  lines.push(`symbol: ${yamlScalar(row.symbol)}`);
  if (row.timeframe) lines.push(`timeframe: ${yamlScalar(row.timeframe)}`);
  if (cfg.direction) lines.push(`direction: ${yamlScalar(cfg.direction)}`);
  if (cfg.chart_construction) lines.push(`chart_construction: ${yamlScalar(cfg.chart_construction)}`);
  lines.push("");
  lines.push("# Entry");
  if (cfg.entry_type) lines.push(`entry_type: ${yamlScalar(cfg.entry_type)}`);
  if (cfg.entry_indicator) lines.push(`entry_indicator: ${yamlScalar(cfg.entry_indicator)}`);
  if (cfg.entry_params) lines.push(`entry_params:${yamlScalar(cfg.entry_params)}`);
  if (cfg.entry_condition) lines.push(`entry_condition: ${yamlScalar(cfg.entry_condition)}`);
  lines.push("");
  lines.push("# Exit & Risk");
  if (cfg.exit_type) lines.push(`exit_type: ${yamlScalar(cfg.exit_type)}`);
  if (cfg.exit_params) lines.push(`exit_params:${yamlScalar(cfg.exit_params)}`);
  if (cfg.stop_loss_atr_multiple !== undefined)
    lines.push(`stop_loss_atr_multiple: ${yamlScalar(cfg.stop_loss_atr_multiple)}`);
  if (cfg.take_profit_atr_multiple !== undefined)
    lines.push(`take_profit_atr_multiple: ${yamlScalar(cfg.take_profit_atr_multiple)}`);
  if (cfg.max_contracts !== undefined)
    lines.push(`max_contracts: ${yamlScalar(cfg.max_contracts)}`);
  lines.push("");
  lines.push("# Filters");
  if (cfg.preferred_regime) lines.push(`preferred_regime: ${yamlScalar(cfg.preferred_regime)}`);
  if (cfg.session_filter) lines.push(`session_filter: ${yamlScalar(cfg.session_filter)}`);
  lines.push("");
  lines.push("# Metadata");
  if (cfg.source) lines.push(`source: ${yamlScalar(cfg.source)}`);
  if (Array.isArray(row.tags) && row.tags.length > 0) {
    lines.push(`tags:${yamlScalar(row.tags)}`);
  }

  const yaml = lines.join("\n").replace(/\n{3,}/g, "\n\n");
  res.type("application/yaml").send(yaml);
});

/**
 * GET /api/strategies/:id/pine
 * Returns the most recent compiled Pine Script artifact for the strategy.
 * Falls back to a fresh compile if no export artifact exists.
 */
strategyRoutes.get("/:id/pine", async (req, res) => {
  const [row] = await db
    .select()
    .from(strategies)
    .where(eq(strategies.id, req.params.id));
  if (!row) {
    res.status(404).json({ error: "Strategy not found" });
    return;
  }

  const variant =
    (req.query.variant as string) === "indicator" ? "pine_indicator" : "pine_strategy";

  // Look for the most recent export artifact for this strategy + variant.
  // Artifact text is stored in strategy_export_artifacts.content; the export
  // table only holds metadata (status, pineVersion, exportabilityScore).
  try {
    const [latest] = await db
      .select({
        exportId: strategyExports.id,
        content: strategyExportArtifacts.content,
        artifactType: strategyExportArtifacts.artifactType,
        createdAt: strategyExports.createdAt,
      })
      .from(strategyExports)
      .innerJoin(
        strategyExportArtifacts,
        eq(strategyExportArtifacts.exportId, strategyExports.id),
      )
      .where(
        and(
          eq(strategyExports.strategyId, row.id),
          eq(strategyExports.exportType, variant),
          eq(strategyExports.status, "completed"),
        ),
      )
      .orderBy(desc(strategyExports.createdAt))
      .limit(1);

    if (latest?.content) {
      res.type("text/plain").send(latest.content);
      return;
    }
  } catch (err) {
    logger.warn({ err, strategyId: row.id }, "Pine artifact lookup failed; falling back to compile");
  }

  // Fall back: trigger a fresh compile and return a placeholder.
  res.status(202).json({
    status: "not_yet_compiled",
    message:
      "No Pine artifact found for this strategy. Run a backtest then deploy to trigger Pine compilation, or use POST /api/exports to compile on-demand.",
    strategyId: row.id,
    variant,
  });
});

/**
 * GET /api/strategies/:id/python
 * Returns the strategy's vectorbt-compatible Python code.
 * Currently emits a deterministic skeleton from the DSL config; the full Python
 * compiler lives in src/engine/compiler/compiler.py (Python-side) and will be
 * wired into a service in Wave 4.4.
 */
strategyRoutes.get("/:id/python", async (req, res) => {
  const [row] = await db
    .select()
    .from(strategies)
    .where(eq(strategies.id, req.params.id));
  if (!row) {
    res.status(404).json({ error: "Strategy not found" });
    return;
  }

  const cfg = (row.config ?? {}) as Record<string, unknown>;
  const py = `"""Trading Forge — Python skeleton for ${row.name}
Auto-generated from DSL config. This is a vectorbt-compatible signal sketch.
For the full executable backtest, see src/engine/backtester.py + DSL config.
"""

import polars as pl
import vectorbt as vbt
import numpy as np

# ─── Strategy Definition ──────────────────────────────────────────
NAME = ${JSON.stringify(row.name)}
SYMBOL = ${JSON.stringify(row.symbol)}
TIMEFRAME = ${JSON.stringify(row.timeframe ?? "5m")}
DIRECTION = ${JSON.stringify(cfg.direction ?? "both")}

ENTRY_TYPE = ${JSON.stringify(cfg.entry_type ?? "breakout")}
ENTRY_INDICATOR = ${JSON.stringify(cfg.entry_indicator ?? "")}
ENTRY_PARAMS = ${JSON.stringify(cfg.entry_params ?? {}, null, 4)}

STOP_LOSS_ATR = ${cfg.stop_loss_atr_multiple ?? 1.5}
TAKE_PROFIT_ATR = ${cfg.take_profit_atr_multiple ?? "None"}

PREFERRED_REGIME = ${JSON.stringify(cfg.preferred_regime ?? "ALL")}
SESSION_FILTER = ${JSON.stringify(cfg.session_filter ?? "RTH_ONLY")}


def compute_signals(df: pl.DataFrame) -> pl.DataFrame:
    """Compute long_entry / short_entry boolean columns from indicator + params.

    df must have columns: timestamp (datetime), open, high, low, close, volume.
    Returns df with added boolean columns: long_entry, short_entry, long_exit, short_exit.
    """
    # TODO: Implement indicator '${cfg.entry_indicator ?? "TBD"}' here.
    # See src/engine/indicators/ for the canonical implementations.
    raise NotImplementedError(
        "This is a DSL skeleton — wire to src/engine/indicators/ to execute."
    )


if __name__ == "__main__":
    print(f"Strategy: {NAME} on {SYMBOL} {TIMEFRAME}")
    print(f"Run via: python -m src.engine.backtester --strategy-id <uuid>")
`;

  res.type("text/plain").send(py);
});

// Create strategy
strategyRoutes.post("/", async (req, res) => {
  const { name, description, symbol, timeframe, config, tags } = req.body;
  const [row] = await db
    .insert(strategies)
    .values({ name, description, symbol, timeframe, config, tags })
    .returning();
  broadcastSSE("strategy:created", { strategyId: row.id, name: row.name });
  res.status(201).json(row);
});

// Update strategy
strategyRoutes.patch("/:id", async (req, res) => {
  // C2: lifecycleState mutations MUST go through the dedicated lifecycle endpoint
  // so VALID_TRANSITIONS, audit_log, graveyard burial, and SSE events all fire.
  // Reject any attempt to bypass that path via the generic PATCH.
  if (req.body.lifecycleState !== undefined) {
    res.status(400).json({
      error: "lifecycle_state_must_use_dedicated_endpoint",
      message: "Use PATCH /api/strategies/:id/lifecycle to change state. This endpoint cannot mutate lifecycleState.",
    });
    return;
  }

  const { name, description, symbol, timeframe, config, tags } = req.body;
  const [row] = await db
    .update(strategies)
    .set({
      ...(name && { name }),
      ...(description && { description }),
      ...(symbol && { symbol }),
      ...(timeframe && { timeframe }),
      ...(config && { config }),
      ...(tags && { tags }),
      updatedAt: new Date(),
    })
    .where(eq(strategies.id, req.params.id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Strategy not found" });
    return;
  }

  // Mark existing completed exports as stale when strategy config changes
  if (config) {
    try {
      await db.update(strategyExports)
        .set({ status: "stale" })
        .where(and(
          eq(strategyExports.strategyId, req.params.id),
          eq(strategyExports.status, "completed")
        ));
    } catch (staleErr) {
      logger.warn({ strategyId: req.params.id, err: staleErr }, "Failed to mark exports as stale");
    }
  }

  res.json(row);
});

// Transition lifecycle state
strategyRoutes.patch("/:id/lifecycle", async (req, res) => {
  const { fromState, toState } = req.body;
  if (!fromState || !toState) {
    res.status(400).json({ error: "fromState and toState required" });
    return;
  }

  if (fromState === "DEPLOY_READY" && toState === "DEPLOYED") {
    res.status(400).json({
      error: "Use /api/strategies/:id/deploy for manual TradingView deployment approval.",
    });
    return;
  }

  const result = await lifecycleService.promoteStrategy(req.params.id, fromState, toState);
  if (!result.success) {
    res.status(400).json({ error: result.error });
    return;
  }

  res.json({ success: true, id: req.params.id, newState: toState });
});

// POST /api/strategies/:id/deploy — Human approves deployment (DEPLOY_READY → DEPLOYED)
strategyRoutes.post("/:id/deploy", async (req, res) => {
  const strategyId = req.params.id;

  // Capture pre-deploy metrics snapshot for the audit record before the transition
  let metricsSnapshot: Record<string, unknown> = {};
  try {
    const [strat] = await db.select().from(strategies).where(eq(strategies.id, strategyId));
    const [latestBt] = await db
      .select()
      .from(backtests)
      .where(and(eq(backtests.strategyId, strategyId), eq(backtests.status, "completed")))
      .orderBy(desc(backtests.createdAt))
      .limit(1);

    const [latestMc] = latestBt
      ? await db
          .select()
          .from(monteCarloRuns)
          .where(eq(monteCarloRuns.backtestId, latestBt.id))
          .orderBy(desc(monteCarloRuns.createdAt))
          .limit(1)
      : [undefined];

    metricsSnapshot = {
      strategyName: strat?.name ?? null,
      symbol: strat?.symbol ?? null,
      timeframe: strat?.timeframe ?? null,
      rollingSharpe30d: strat?.rollingSharpe30d ?? null,
      forgeScore: strat?.forgeScore ?? null,
      backtest: latestBt
        ? {
            id: latestBt.id,
            tier: latestBt.tier,
            sharpe: latestBt.sharpeRatio,
            profitFactor: latestBt.profitFactor,
            winRate: latestBt.winRate,
            maxDrawdown: latestBt.maxDrawdown,
            avgDailyPnl: latestBt.avgDailyPnl,
            totalTrades: latestBt.totalTrades,
          }
        : null,
      monteCarlo: latestMc
        ? {
            id: latestMc.id,
            ...getMcSummary(latestMc),
            sharpeP5: latestMc.sharpeP5,
            sharpeP50: latestMc.sharpeP50,
            sharpeP95: latestMc.sharpeP95,
          }
        : null,
    };
  } catch (snapshotErr) {
    // Non-fatal — deploy proceeds even if snapshot fails; log so we can investigate
    logger.warn({ strategyId, err: snapshotErr }, "deploy: metrics snapshot failed (non-blocking)");
  }

  const result = await lifecycleService.promoteStrategy(
    strategyId,
    "DEPLOY_READY",
    "DEPLOYED",
    {
      actor: "human_release",
      reason: "manual_tradingview_deployment_approval",
    },
  );
  if (!result.success) {
    res.status(400).json({ error: result.error });
    return;
  }

  // Dedicated audit record for human deploy approval — separate from the lifecycle entry
  // so it is always queryable by action="strategy.deploy_approved"
  try {
    await db.insert(auditLog).values({
      action: "strategy.deploy_approved",
      entityType: "strategy",
      entityId: strategyId,
      input: {
        approvedBy: "swayz032", // single-user system — identity is fixed
        approvedAt: new Date().toISOString(),
        fromState: "DEPLOY_READY",
        toState: "DEPLOYED",
      },
      result: metricsSnapshot,
      status: "success",
      decisionAuthority: "human",
    });
  } catch (auditErr) {
    // Audit failure must not roll back an approved deploy — log it for investigation
    logger.error({ strategyId, err: auditErr }, "deploy: audit_log insert failed (deploy committed)");
  }

  // Fire-and-forget Pine export for the newly deployed strategy.
  // Resolve firmKey from the latest backtest's propCompliance (first passing firm),
  // mirroring lifecycle-service.triggerPineCompile so a manual deploy targets the
  // same firm the strategy actually qualified for. Falls back to topstep_50k only
  // if no passing firm is found or propCompliance data is missing.
  import("../services/pine-export-service.js").then(async ({ compilePineExport }) => {
    let firmKey = "topstep_50k";
    try {
      const [latestBt] = await db
        .select({ propCompliance: backtests.propCompliance })
        .from(backtests)
        .where(and(eq(backtests.strategyId, strategyId), eq(backtests.status, "completed")))
        .orderBy(desc(backtests.createdAt))
        .limit(1);

      if (latestBt?.propCompliance) {
        const propResults = latestBt.propCompliance as Record<string, { passed?: boolean; pass?: boolean }>;
        const passingFirm = Object.entries(propResults).find(
          ([, r]) => r.passed === true || r.pass === true,
        );
        if (passingFirm) {
          firmKey = passingFirm[0];
        }
      }
    } catch (firmResolveErr) {
      logger.warn(
        { strategyId, err: firmResolveErr },
        "deploy: firmKey resolution from propCompliance failed (defaulting to topstep_50k)",
      );
    }

    compilePineExport(strategyId, firmKey, "pine_indicator").catch((err: unknown) =>
      logger.error({ err, strategyId, firmKey }, "Post-deploy Pine export failed"),
    );
  }).catch(() => {});

  // Broadcast deploy SSE so dashboard and any listeners know immediately
  broadcastSSE("strategy:deployed", {
    strategyId,
    name: metricsSnapshot.strategyName ?? null,
  });

  const response: DeployStrategyResponse = {
    success: true,
    id: strategyId,
    newState: "DEPLOYED",
    message: "Strategy deployed — you approved this.",
  };
  res.json(response);
});

// POST /api/strategies/:id/reject-deploy — Send strategy back to paper (DEPLOY_READY → PAPER)
strategyRoutes.post("/:id/reject-deploy", async (req, res) => {
  const result = await lifecycleService.promoteStrategy(req.params.id, "DEPLOY_READY", "PAPER", {
    actor: "human_release",
    reason: "manual_deploy_rejection",
  });
  if (!result.success) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json({ success: true, id: req.params.id, newState: "PAPER", message: "Strategy sent back to paper trading." });
});

// POST /api/strategies/lifecycle/check — trigger auto-promotion and demotion checks
strategyRoutes.post("/lifecycle/check", async (_req, res) => {
  // FIX 5 — pipeline pause gate. checkAutoPromotions/checkAutoDemotions write
  // lifecycle state changes, audit rows, and broadcast SSE. These are automated
  // pipeline actions and must short-circuit when pipeline is PAUSED/VACATION.
  // Human deploy approval (/:id/deploy) is intentionally NOT gated — pipeline
  // pause gates *automation*, not human decision authority.
  if (!(await isPipelineActive())) {
    res.status(423).json({ error: "pipeline_paused" });
    return;
  }
  try {
    const [promotions, demotions] = await Promise.all([
      lifecycleService.checkAutoPromotions(),
      lifecycleService.checkAutoDemotions(),
    ]);
    res.json({ promotions, demotions });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Delete strategy (cascades to all dependent records).
//
// P1-1: This endpoint MUST NOT bypass the lifecycle. Live/deploy-track
// strategies are blocked here so they can only be retired through the
// lifecycle service (which writes audit + buries to the graveyard). For
// deletable states we still write a `strategy.delete` audit row BEFORE the
// cascade so the action is replayable, and we optionally bury RETIRED/
// DECLINING rows in the graveyard so duplicate-detection memory survives.
//
// Query params:
//   ?bury=false   skip pre-delete graveyard burial for RETIRED/DECLINING
//                 (default behaviour: bury before delete so failure modes
//                 stay queryable for future scout/critic comparisons)
const PROTECTED_LIFECYCLE_STATES: ReadonlyArray<string> = ["DEPLOYED", "PAPER", "DEPLOY_READY"];
const BURY_BEFORE_DELETE_STATES: ReadonlyArray<string> = ["RETIRED", "DECLINING"];

strategyRoutes.delete("/:id", async (req, res) => {
  const strategyId = req.params.id;
  const buryQuery = String(req.query.bury ?? "true").toLowerCase();
  const buryBeforeDelete = buryQuery !== "false";

  // 1) Load the strategy first — both for the protected-state guard and so
  //    we can snapshot it into the audit row before the cascade.
  const [strategyRow] = await db
    .select()
    .from(strategies)
    .where(eq(strategies.id, strategyId))
    .limit(1);

  if (!strategyRow) {
    res.status(404).json({ error: "Strategy not found" });
    return;
  }

  const currentState = strategyRow.lifecycleState;

  // 2) Protected-state guard: live/deploy-track strategies cannot be silently
  //    deleted. Direct them at the lifecycle endpoint so the transition is
  //    audited, the graveyard is updated, and any downstream consumers see
  //    the demotion via SSE.
  if (PROTECTED_LIFECYCLE_STATES.includes(currentState)) {
    logger.warn(
      { strategyId, lifecycleState: currentState },
      "DELETE /api/strategies/:id rejected — strategy in protected lifecycle state",
    );
    res.status(409).json({
      error: `Cannot delete strategy in lifecycle state '${currentState}'. Use the lifecycle endpoint to retire to GRAVEYARD instead.`,
      lifecycleState: currentState,
    });
    return;
  }

  // 3) Optional pre-delete burial for retired / declining strategies so the
  //    failure-mode memory survives the cascade. Best-effort only; if burial
  //    fails we still write the delete audit and proceed (so a corrupt
  //    graveyard table cannot block cleanup of real garbage).
  if (buryBeforeDelete && BURY_BEFORE_DELETE_STATES.includes(currentState)) {
    try {
      // Reuse the lifecycle service's burial path by transitioning to GRAVEYARD.
      // This writes the graveyard row + audit log inside the lifecycle service.
      const buryResult = await lifecycleService.promoteStrategy(
        strategyId,
        currentState as Parameters<LifecycleService["promoteStrategy"]>[1],
        "GRAVEYARD",
        { actor: "system", reason: "pre_delete_burial" },
      );
      if (!buryResult.success) {
        logger.warn(
          { strategyId, currentState, error: buryResult.error },
          "Pre-delete burial failed (non-blocking) — proceeding with cascade",
        );
      }
    } catch (buryErr) {
      logger.warn(
        { strategyId, currentState, err: buryErr },
        "Pre-delete burial threw (non-blocking) — proceeding with cascade",
      );
    }
  }

  // 4) Audit BEFORE the cascade so the snapshot is recoverable even if the
  //    cascade fails halfway. The audit row itself does not reference the
  //    strategy via FK (entityId is a free uuid) so it survives the delete.
  await db.insert(auditLog).values({
    action: "strategy.delete",
    entityType: "strategy",
    entityId: strategyId,
    input: {
      lifecycleState: currentState,
      buryBeforeDelete,
    },
    result: {
      snapshot: {
        id: strategyRow.id,
        name: strategyRow.name,
        symbol: strategyRow.symbol,
        timeframe: strategyRow.timeframe,
        lifecycleState: currentState,
        forgeScore: strategyRow.forgeScore,
        rollingSharpe30d: strategyRow.rollingSharpe30d,
        generation: strategyRow.generation,
        parentStrategyId: strategyRow.parentStrategyId,
        source: strategyRow.source,
        tags: strategyRow.tags,
        config: strategyRow.config,
        createdAt: strategyRow.createdAt,
        updatedAt: strategyRow.updatedAt,
      },
    },
    status: "pending",
    decisionAuthority: "human",
  });

  // 5) Cascade. Mirrors the original ordering (children before parents).
  const btRows = await db.select({ id: backtests.id }).from(backtests).where(eq(backtests.strategyId, strategyId));
  const btIds = btRows.map((r) => r.id);

  // Delete backtest-dependent records
  if (btIds.length > 0) {
    await db.delete(backtestTrades).where(inArray(backtestTrades.backtestId, btIds));
    await db.delete(monteCarloRuns).where(inArray(monteCarloRuns.backtestId, btIds));
    await db.delete(stressTestRuns).where(inArray(stressTestRuns.backtestId, btIds));
  }

  // Delete strategy-dependent records
  await db.delete(backtests).where(eq(backtests.strategyId, strategyId));
  await db.delete(backtestMatrix).where(eq(backtestMatrix.strategyId, strategyId));
  await db.delete(systemJournal).where(eq(systemJournal.strategyId, strategyId));
  await db.delete(complianceReviews).where(eq(complianceReviews.strategyId, strategyId));
  await db.delete(paperSessions).where(eq(paperSessions.strategyId, strategyId));
  await db.delete(skipDecisions).where(eq(skipDecisions.strategyId, strategyId));
  await db.delete(strategyGraveyard).where(eq(strategyGraveyard.strategyId, strategyId));

  // Delete the strategy itself
  const [row] = await db.delete(strategies).where(eq(strategies.id, strategyId)).returning();
  if (!row) {
    // Race: another caller deleted between our load and cascade. Audit row
    // already records the snapshot; treat as 404 for the caller.
    res.status(404).json({ error: "Strategy not found" });
    return;
  }

  // Flip the audit row to success once the cascade lands. Best-effort —
  // if the update fails, the pending row remains as a recoverable trace.
  res.json({ deleted: true, lifecycleState: currentState, buryBeforeDelete });
});
