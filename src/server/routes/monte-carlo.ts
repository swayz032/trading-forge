import { Router } from "express";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { monteCarloRuns, stressTestRuns } from "../db/schema.js";
import { runMonteCarlo } from "../services/monte-carlo-service.js";

export const monteCarloRoutes = Router();

// ─── Validation Schemas ──────────────────────────────────────────

const mcRequestSchema = z.object({
  backtestId: z.string().uuid(),
  numSimulations: z.number().int().min(100).max(100_000).default(10_000),
  method: z.enum(["trade_resample", "return_bootstrap", "both"]).default("both"),
  useGpu: z.boolean().default(true),
  initialCapital: z.number().positive().default(100_000),
  maxPathsToStore: z.number().int().min(10).max(500).default(100),
  ruinThreshold: z.number().min(0).default(0),
});

// ─── POST /api/monte-carlo — Run MC on a backtest (async) ────────
monteCarloRoutes.post("/", async (req, res) => {
  const parsed = mcRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  const { backtestId, ...options } = parsed.data;

  // Fire and forget
  runMonteCarlo(backtestId, options).catch(() => {
    // Error already persisted to audit log
  });

  // Return immediately with 202
  const [latest] = await db
    .select({ id: monteCarloRuns.id })
    .from(monteCarloRuns)
    .where(eq(monteCarloRuns.backtestId, backtestId))
    .orderBy(desc(monteCarloRuns.createdAt))
    .limit(1);

  res.status(202).json({
    message: "Monte Carlo simulation started",
    mcId: latest?.id,
  });
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
  const { backtestId, limit = "20" } = req.query;

  const conditions = [];
  if (backtestId) conditions.push(eq(monteCarloRuns.backtestId, String(backtestId)));

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
    .where(conditions.length > 0 ? conditions[0] : undefined)
    .orderBy(desc(monteCarloRuns.createdAt))
    .limit(Number(limit));

  res.json(rows);
});

// ─── GET /api/stress-test/:id — Stress test results ──────────────
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
