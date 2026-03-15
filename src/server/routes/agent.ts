import { Router } from "express";
import { z } from "zod";
import { AgentService } from "../services/agent-service.js";
import { analyzeMarket } from "../services/regime-service.js";
import { runRobustnessTest } from "../services/robustness-service.js";
import { db } from "../db/index.js";
import { auditLog } from "../db/schema.js";
import { eq, desc } from "drizzle-orm";
import { OllamaClient } from "../services/ollama-client.js";
import { logger } from "../index.js";

export const agentRoutes = Router();
const agentService = new AgentService();

// ─── Validation Schemas ──────────────────────────────────────────

const symbolEnum = z.enum(["ES", "NQ", "CL", "YM", "RTY", "GC", "MES", "MNQ"]);

const runStrategySchema = z.object({
  strategy_name: z.string().min(1),
  one_sentence: z.string().min(1),
  python_code: z.string().min(1),
  params: z.record(z.unknown()).refine(
    (obj) => Object.keys(obj).length <= 5,
    { message: "Maximum 5 parameters" }
  ),
  symbol: symbolEnum,
  timeframe: z.string().min(1),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  source: z.enum(["ollama", "openclaw", "manual"]).default("ollama"),
});

const critiqueSchema = z
  .object({
    backtestId: z.string().uuid().optional(),
    results: z.record(z.unknown()).optional(),
    model: z.string().optional().default("llama3:8b"),
  })
  .refine((data) => data.backtestId || data.results, {
    message: "Either backtestId or results must be provided",
  });

const batchSchema = z.object({
  strategies: z.array(runStrategySchema).min(1).max(20),
});

const analyzeMarketSchema = z.object({
  symbol: symbolEnum,
  timeframe: z.string().default("1h"),
  adx_period: z.number().int().min(5).max(50).default(14),
});

const robustnessSchema = z.object({
  strategy_id: z.string().uuid(),
  config: z.record(z.unknown()),
  n_trials: z.number().int().min(10).max(5000).default(800),
});

const findStrategiesSchema = z.object({
  symbol: symbolEnum,
  timeframe: z.string().default("1h"),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  count: z.number().int().min(1).max(10).default(5),
});

const scoutIdeaSchema = z.object({
  source: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  url: z.string().url().optional(),
  summary: z.string().optional(),
  source_quality: z.enum(["high", "medium", "low"]).optional(),
  confidence_score: z.number().min(0).max(1).optional(),
  instruments: z.array(z.string()).optional(),
  indicators_mentioned: z.array(z.string()).optional(),
});

const scoutSchema = z.object({
  ideas: z.array(scoutIdeaSchema).min(1),
});

// ─── POST /api/agent/run-strategy ────────────────────────────────

agentRoutes.post("/run-strategy", async (req, res) => {
  const parsed = runStrategySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  // Fire and forget
  agentService.runStrategy(parsed.data).catch(() => {
    // Error persisted to DB by service
  });

  res.status(202).json({ message: "Strategy submitted" });
});

// ─── POST /api/agent/critique ────────────────────────────────────

agentRoutes.post("/critique", async (req, res) => {
  const parsed = critiqueSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  try {
    const result = await agentService.critiqueResults(parsed.data);
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// ─── POST /api/agent/batch ───────────────────────────────────────

agentRoutes.post("/batch", async (req, res) => {
  const parsed = batchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  // Fire and forget
  agentService.batchSubmit(parsed.data.strategies).catch(() => {
    // Errors persisted per-strategy
  });

  res.status(202).json({ count: parsed.data.strategies.length, message: "Batch submitted" });
});

// ─── POST /api/agent/scout-ideas ─────────────────────────────────

agentRoutes.post("/scout-ideas", async (req, res) => {
  const parsed = scoutSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  try {
    const result = await agentService.scoutIdeas(parsed.data.ideas);
    res.status(201).json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// ─── POST /api/agent/analyze-market ────────────────────────────────
// Synchronous — returns regime detection result

agentRoutes.post("/analyze-market", async (req, res) => {
  const parsed = analyzeMarketSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  try {
    const result = await analyzeMarket(
      parsed.data.symbol,
      parsed.data.timeframe,
      parsed.data.adx_period,
    );
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// ─── POST /api/agent/robustness ────────────────────────────────────
// Fire-and-forget — returns job ID

agentRoutes.post("/robustness", async (req, res) => {
  const parsed = robustnessSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  // Create audit log entry as job tracker
  const [job] = await db.insert(auditLog).values({
    action: "agent.robustness",
    entityType: "strategy",
    entityId: parsed.data.strategy_id,
    input: parsed.data as unknown as Record<string, unknown>,
    status: "pending",
  }).returning();

  // Fire and forget
  const configJson = JSON.stringify(parsed.data.config);
  runRobustnessTest(parsed.data.strategy_id, configJson).catch(() => {
    // Error persisted by service
  });

  res.status(202).json({ job_id: job.id, message: "Robustness test submitted" });
});

// ─── POST /api/agent/find-strategies ───────────────────────────────
// Fire-and-forget — calls Ollama trading-quant model to generate DSL strategies,
// validates each, then submits valid ones for backtest via agentService.runStrategy.

agentRoutes.post("/find-strategies", async (req, res) => {
  const parsed = findStrategiesSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  // Create audit log entry as job tracker
  const [job] = await db.insert(auditLog).values({
    action: "agent.find-strategies",
    entityType: "strategy",
    input: parsed.data as unknown as Record<string, unknown>,
    status: "pending",
  }).returning();

  const { symbol, timeframe, start_date, end_date, count } = parsed.data;

  // Fire and forget — generate strategies via Ollama, validate, backtest
  (async () => {
    const ollama = new OllamaClient();
    const results: Array<{ name: string; status: string; error?: string }> = [];

    for (let i = 0; i < count; i++) {
      try {
        const prompt = `Generate a unique ${symbol} futures trading strategy for the ${timeframe} timeframe.
Strategy #${i + 1} of ${count}. Each strategy must be different.
Focus on proven edges: trend following, mean reversion, volatility expansion, or session patterns.
Target: $250+/day avg P&L, 60%+ win days, profit factor >= 1.75, max drawdown <= $2,000.
Output ONLY the DSL JSON object, nothing else.`;

        const response = await ollama.generate("trading-quant", prompt, {
          temperature: 0.7 + (i * 0.05), // Vary temperature for diversity
          num_ctx: 8192,
        });

        // Extract JSON from response (handle possible markdown fences)
        let jsonStr = response.response.trim();
        const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (fenceMatch) jsonStr = fenceMatch[1].trim();

        let dsl: Record<string, unknown>;
        try {
          dsl = JSON.parse(jsonStr);
        } catch {
          results.push({ name: `strategy_${i + 1}`, status: "failed", error: "Invalid JSON from Ollama" });
          continue;
        }

        // Validate required DSL fields
        const requiredFields = ["name", "description", "symbol", "timeframe", "direction",
          "entry_type", "entry_indicator", "entry_params", "entry_condition",
          "exit_type", "exit_params", "stop_loss_atr_multiple"];
        const missing = requiredFields.filter((f) => !(f in dsl));
        if (missing.length > 0) {
          results.push({ name: String(dsl.name ?? `strategy_${i + 1}`), status: "failed", error: `Missing DSL fields: ${missing.join(", ")}` });
          continue;
        }

        // Validate entry_params has <= 5 keys
        const entryParams = dsl.entry_params as Record<string, unknown> | undefined;
        if (entryParams && Object.keys(entryParams).length > 5) {
          results.push({ name: String(dsl.name), status: "failed", error: "entry_params exceeds 5 parameter limit" });
          continue;
        }

        // If python_code is present, submit for backtest via runStrategy
        const pythonCode = dsl.python_code as string | undefined;
        if (pythonCode && pythonCode.length > 0) {
          const strategyResult = await agentService.runStrategy({
            strategy_name: String(dsl.name),
            one_sentence: String(dsl.description),
            python_code: pythonCode,
            params: (entryParams ?? {}) as Record<string, unknown>,
            symbol: symbol as "ES" | "NQ" | "CL" | "YM" | "RTY" | "GC" | "MES" | "MNQ",
            timeframe,
            start_date,
            end_date,
            source: "ollama",
          });
          results.push({ name: String(dsl.name), status: strategyResult.status });
        } else {
          // No python_code — save DSL-only strategy (compiler-validated, no backtest yet)
          results.push({ name: String(dsl.name), status: "validated", error: "No python_code — saved DSL only, backtest skipped" });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        results.push({ name: `strategy_${i + 1}`, status: "failed", error: msg });
      }
    }

    // Update audit log with results
    await db.update(auditLog).set({
      status: results.some((r) => r.status === "completed") ? "success" : "failure",
      result: { strategies: results } as unknown as Record<string, unknown>,
    }).where(eq(auditLog.id, job.id));

    logger.info({ jobId: job.id, results }, "find-strategies completed");
  })().catch((err) => {
    logger.error({ err, jobId: job.id }, "find-strategies failed");
    db.update(auditLog).set({
      status: "failure",
      result: { error: err instanceof Error ? err.message : String(err) } as unknown as Record<string, unknown>,
    }).where(eq(auditLog.id, job.id)).catch(() => {});
  });

  res.status(202).json({ job_id: job.id, message: "Strategy search submitted" });
});

// ─── GET /api/agent/jobs ───────────────────────────────────────────
// List recent agent jobs from audit_log

agentRoutes.get("/jobs", async (_req, res) => {
  const jobs = await db
    .select()
    .from(auditLog)
    .where(
      eq(auditLog.entityType, "strategy"),
    )
    .orderBy(desc(auditLog.createdAt))
    .limit(50);

  const filtered = jobs.filter((j) =>
    j.action.startsWith("agent."),
  );

  res.json(filtered);
});

// ─── GET /api/agent/jobs/:id ───────────────────────────────────────
// Get single job status + results

agentRoutes.get("/jobs/:id", async (req, res) => {
  const [job] = await db
    .select()
    .from(auditLog)
    .where(eq(auditLog.id, req.params.id));

  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  res.json(job);
});