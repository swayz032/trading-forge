import { Router } from "express";
import { eq, desc, sql } from "drizzle-orm";
import { z } from "zod";
import { randomUUID } from "crypto";
import { db } from "../db/index.js";
import { monteCarloRuns, stressTestRuns, backtests, strategies } from "../db/schema.js";
import { runMonteCarlo } from "../services/monte-carlo-service.js";
import { isActive as isPipelineActive } from "../services/pipeline-control-service.js";

export const monteCarloRoutes = Router();

// ─── Validation Schemas ──────────────────────────────────────────

const mcRequestSchema = z.object({
  backtestId: z.string().uuid(),
  numSimulations: z.number().int().min(100).max(100_000).default(10_000),
  method: z.enum(["trade_resample", "return_bootstrap", "block_bootstrap", "both"]).default("both"),
  useGpu: z.boolean().default(true),
  initialCapital: z.number().positive().default(50_000),
  maxPathsToStore: z.number().int().min(10).max(500).default(100),
  ruinThreshold: z.number().min(0).default(0),
  firms: z.array(z.string()).optional(),
  isOosTrades: z.boolean().optional(),
});

// ─── POST /api/monte-carlo — Run MC on a backtest (async) ────────
monteCarloRoutes.post("/", async (req, res) => {
  // FIX 5 — pipeline pause gate. MC spawns a Python subprocess and writes a
  // monte_carlo_runs row; both are pipeline-side-effects that must not run
  // when the pipeline is PAUSED/VACATION. 423 (Locked) signals "the resource
  // is intentionally unavailable" so callers (n8n, dashboard) can distinguish
  // pause from real failure.
  if (!(await isPipelineActive())) {
    res.status(423).json({ error: "pipeline_paused" });
    return;
  }

  const parsed = mcRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  const { backtestId, ...options } = parsed.data;

  // Generate the MC run ID upfront to avoid race condition
  const mcId = randomUUID();

  // Fire and forget — req.log carries the request correlation ID (typed in src/server/types/express.d.ts)
  runMonteCarlo(backtestId, options, mcId).catch((err) => {
    req.log.error({ err, backtestId, mcId }, "Fire-and-forget Monte Carlo simulation failed");
  });

  res.status(202).json({
    message: "Monte Carlo simulation started",
    mcId,
  });
});

// ─── GET /api/monte-carlo/recent — Latest MC runs across ALL backtests ───
monteCarloRoutes.get("/recent", async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 10, 50);

  const rows = await db
    .select({
      id: monteCarloRuns.id,
      backtestId: monteCarloRuns.backtestId,
      numSimulations: monteCarloRuns.numSimulations,
      probabilityOfRuin: monteCarloRuns.probabilityOfRuin,
      maxDrawdownP50: monteCarloRuns.maxDrawdownP50,
      sharpeP50: monteCarloRuns.sharpeP50,
      gpuAccelerated: monteCarloRuns.gpuAccelerated,
      executionTimeMs: monteCarloRuns.executionTimeMs,
      createdAt: monteCarloRuns.createdAt,
      strategyName: strategies.name,
      strategyId: backtests.strategyId,
      backtestSymbol: backtests.symbol,
      backtestTimeframe: backtests.timeframe,
      backtestTotalReturn: backtests.totalReturn,
    })
    .from(monteCarloRuns)
    .leftJoin(backtests, eq(monteCarloRuns.backtestId, backtests.id))
    .leftJoin(strategies, eq(backtests.strategyId, strategies.id))
    .orderBy(desc(monteCarloRuns.createdAt))
    .limit(limit);

  res.json({ data: rows, total: rows.length });
});

// ─── GET /api/stress-test/:id — Stress test results ──────────────
// MUST be before /:id to avoid being shadowed
monteCarloRoutes.get("/stress-test/:id", async (req, res) => {
  const [row] = await db
    .select()
    .from(stressTestRuns)
    .where(eq(stressTestRuns.id, req.params.id))
    .limit(1);

  if (!row) {
    res.status(404).json({ error: "Stress test run not found" });
    return;
  }

  res.json(row);
});

// ─── GET /api/monte-carlo/:id — Full MC results ─────────────────
monteCarloRoutes.get("/:id", async (req, res) => {
  const [row] = await db
    .select()
    .from(monteCarloRuns)
    .where(eq(monteCarloRuns.id, req.params.id))
    .limit(1);

  if (!row) {
    res.status(404).json({ error: "Monte Carlo run not found" });
    return;
  }

  res.json(row);
});

// ─── GET /api/monte-carlo/:id/paths — Simulated equity paths ────
monteCarloRoutes.get("/:id/paths", async (req, res) => {
  const [row] = await db
    .select({ paths: monteCarloRuns.paths })
    .from(monteCarloRuns)
    .where(eq(monteCarloRuns.id, req.params.id))
    .limit(1);

  if (!row) {
    res.status(404).json({ error: "Monte Carlo run not found" });
    return;
  }

  res.json({ paths: row.paths });
});

// ─── GET /api/monte-carlo/:id/risk — Risk metrics summary ───────
monteCarloRoutes.get("/:id/risk", async (req, res) => {
  const [row] = await db
    .select({ riskMetrics: monteCarloRuns.riskMetrics })
    .from(monteCarloRuns)
    .where(eq(monteCarloRuns.id, req.params.id))
    .limit(1);

  if (!row) {
    res.status(404).json({ error: "Monte Carlo run not found" });
    return;
  }

  res.json({ riskMetrics: row.riskMetrics });
});

// ─── GET /api/monte-carlo — List MC runs for a backtest ──────────
monteCarloRoutes.get("/", async (req, res) => {
  const { backtestId, limit = "20", offset = "0" } = req.query;

  const conditions = [];
  if (backtestId) conditions.push(eq(monteCarloRuns.backtestId, String(backtestId)));

  const whereClause = conditions.length > 0 ? conditions[0] : undefined;

  // Get total count
  const [{ count: total }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(monteCarloRuns)
    .where(whereClause);

  const rows = await db
    .select({
      id: monteCarloRuns.id,
      backtestId: monteCarloRuns.backtestId,
      numSimulations: monteCarloRuns.numSimulations,
      probabilityOfRuin: monteCarloRuns.probabilityOfRuin,
      maxDrawdownP50: monteCarloRuns.maxDrawdownP50,
      sharpeP50: monteCarloRuns.sharpeP50,
      gpuAccelerated: monteCarloRuns.gpuAccelerated,
      executionTimeMs: monteCarloRuns.executionTimeMs,
      createdAt: monteCarloRuns.createdAt,
    })
    .from(monteCarloRuns)
    .where(whereClause)
    .orderBy(desc(monteCarloRuns.createdAt))
    .limit(Number(limit))
    .offset(Number(offset));

  res.json({ data: rows, total });
});

