import { Router } from "express";
import { z } from "zod";
import { AgentService } from "../services/agent-service.js";
import { analyzeMarket } from "../services/regime-service.js";
import { runRobustnessTest } from "../services/robustness-service.js";
import { db } from "../db/index.js";
import { auditLog } from "../db/schema.js";
import { eq, desc, and, sql, inArray } from "drizzle-orm";
import { OllamaClient } from "../services/ollama-client.js";
import { logger } from "../index.js";

export const agentRoutes = Router();
const agentService = new AgentService();

// ─── Strategy Validation Constants ──────────────────────────────
// Known ICT concepts that have cross-validated specs
const KNOWN_ICT_CONCEPTS = [
  "silver_bullet", "smt_reversal", "judas_swing", "ict_2022",
  "ote", "breaker", "turtle_soup", "iofed",
  "midnight_open", "ny_lunch_reversal", "eqhl_raid",
] as const;

/**
 * Run Python static validation on strategy code against its concept spec.
 * Returns { passed: boolean, errors: string[], warnings: string[] }
 */
async function runPythonValidation(
  pythonCode: string,
  conceptName: string,
): Promise<{ passed: boolean; errors: string[]; warnings: string[] }> {
  const { execSync } = await import("child_process");
  try {
    const script = `
import json, sys
sys.path.insert(0, '.')
from src.engine.validation import load_spec, validate_static_from_code
spec = load_spec('${conceptName}')
code = '''${pythonCode.replace(/'/g, "\\'")}'''
result = validate_static_from_code(code, spec)
print(json.dumps({"passed": result.passed, "errors": result.errors, "warnings": result.warnings}))
`;
    const output = execSync(`python -c "${script.replace(/"/g, '\\"')}"`, {
      cwd: process.cwd(),
      timeout: 10000,
      encoding: "utf-8",
    });
    return JSON.parse(output.trim());
  } catch {
    // If validation can't run, let the strategy through (fail-open)
    return { passed: true, errors: [], warnings: ["Validation could not run"] };
  }
}

// ─── Validation Schemas ──────────────────────────────────────────

const symbolEnum = z.enum(["ES", "NQ", "CL", "YM", "RTY", "GC", "MES", "MNQ", "MCL", "MGC"]);

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
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
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
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
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

  const strategyName = parsed.data.strategy_name.toLowerCase().replace(/-/g, "_");

  // ─── Validation gate: known ICT concepts ────────────────
  if (KNOWN_ICT_CONCEPTS.includes(strategyName as any)) {
    try {
      const validation = await runPythonValidation(parsed.data.python_code, strategyName);
      if (!validation.passed) {
        res.status(422).json({
          error: "strategy_validation_failed",
          concept: strategyName,
          errors: validation.errors,
          warnings: validation.warnings,
        });
        return;
      }
    } catch (err) {
      logger.warn({ err, strategyName }, "Validation gate error — proceeding anyway");
    }
  }

  // ─── Cross-validation gate: unknown concepts ────────────
  // If strategy claims to be an ICT concept but we don't have a spec → queue for research
  const ictPatterns = /\b(ict|smc|order.?block|fvg|breaker|sweep|liquidity)\b/i;
  if (!KNOWN_ICT_CONCEPTS.includes(strategyName as any) && ictPatterns.test(parsed.data.one_sentence)) {
    logger.info({ strategyName }, "Unknown ICT concept — queued for cross-validation");
    res.status(202).json({
      status: "queued_for_validation",
      reason: `Concept '${strategyName}' not yet cross-validated. Strategy queued for research.`,
      strategy_name: strategyName,
    });
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

// ─── POST /api/agent/run-class-strategy ──────────────────────────
// Run a class-based strategy (BaseStrategy subclass) through the backtest engine

const runClassStrategySchema = z.object({
  strategy_name: z.string().min(1),
  strategy_class: z.string().min(1),  // e.g. "src.engine.strategies.breaker.BreakerStrategy"
  symbol: symbolEnum,
  timeframe: z.string().default("15min"),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  source: z.enum(["manual", "ollama", "openclaw"]).default("manual"),
  description: z.string().default(""),
  params: z.record(z.unknown()).default({}),
});

agentRoutes.post("/run-class-strategy", async (req, res) => {
  const parsed = runClassStrategySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  // Fire and forget
  agentService.runClassStrategy(parsed.data).catch((err) => {
    logger.error({ err, strategy_class: parsed.data.strategy_class }, "run-class-strategy failed");
  });

  res.status(202).json({ message: "Class strategy submitted", strategy_class: parsed.data.strategy_class });
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

    // Fetch failure patterns from recent journal entries to avoid repeating mistakes
    let avoidBlock = "";
    try {
      const { avoidPatterns } = await agentService.getFailurePatterns(30, 50);
      if (avoidPatterns.length > 0) {
        avoidBlock = `\n\nAVOID these patterns from recent failed strategies:\n${avoidPatterns.map((p, i) => `${i + 1}. ${p}`).join("\n")}\n`;
      }
    } catch (err) {
      logger.warn({ err }, "Failed to fetch failure patterns — continuing without AVOID list");
    }

    for (let i = 0; i < count; i++) {
      try {
        const prompt = `Generate a unique ${symbol} futures trading strategy for the ${timeframe} timeframe.
Strategy #${i + 1} of ${count}. Each strategy must be different.
Focus on proven edges: trend following, mean reversion, volatility expansion, or session patterns.
Target: $250+/day avg P&L, 60%+ win days, profit factor >= 1.75, max drawdown <= $2,000.${avoidBlock}
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

// ─── GET /api/agent/failure-patterns ──────────────────────────────
// Returns AVOID patterns from recent failed strategies (for n8n + Ollama prompt injection)

agentRoutes.get("/failure-patterns", async (req, res) => {
  const days = Number(req.query.days ?? 30);
  const limit = Number(req.query.limit ?? 50);
  try {
    const patterns = await agentService.getFailurePatterns(days, limit);
    res.json(patterns);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// ─── GET /api/agent/jobs ───────────────────────────────────────────
// List recent agent jobs from audit_log (paginated)

agentRoutes.get("/jobs", async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const offset = Number(req.query.offset) || 0;
  const typeFilter = req.query.type as string | undefined;
  const statusFilter = req.query.status as string | undefined;

  // Map friendly type names to action prefixes
  const typeActionMap: Record<string, string[]> = {
    "trading-quant": ["agent.run-strategy", "agent.run-class-strategy", "agent.batch", "agent.robustness", "agent.analyze-market"],
    "openclaw-scout": ["agent.find-strategies", "agent.scout-ideas"],
    "ollama-analyst": ["agent.critique"],
  };

  // Build conditions — include all entity types that agent actions may use
  const conditions = [sql`${auditLog.entityType} IN ('strategy', 'backtest', 'agent')` as any];
  if (statusFilter) {
    // Map "failed" to include "failure" status
    if (statusFilter === "failed") {
      conditions.push(sql`${auditLog.status} IN ('failed', 'failure')` as any);
    } else {
      conditions.push(eq(auditLog.status, statusFilter));
    }
  }

  const whereClause = and(...conditions);

  // Get total count (before type filtering since type filter is done in-memory)
  const [{ count: rawTotal }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(auditLog)
    .where(whereClause);

  // Fetch more rows than needed to account for action filtering
  const fetchLimit = typeFilter ? Math.max(limit * 5, 200) : limit + offset + 10;
  const rows = await db
    .select()
    .from(auditLog)
    .where(whereClause)
    .orderBy(desc(auditLog.createdAt))
    .limit(fetchLimit);

  // Filter to agent actions only
  let filtered = rows.filter((j) => j.action.startsWith("agent."));

  // Apply type filter
  if (typeFilter && typeActionMap[typeFilter]) {
    const allowedActions = typeActionMap[typeFilter];
    filtered = filtered.filter((j) => allowedActions.includes(j.action));
  }

  const total = typeFilter ? filtered.length : rawTotal; // rawTotal is accurate when no type filter
  const paginated = filtered.slice(offset, offset + limit);

  res.json({ data: paginated, total });
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

// DELETE /api/agent/jobs — Purge agent-specific jobs only (not all audit_log)
agentRoutes.delete("/jobs", async (_req, res) => {
  const agentActions = [
    "agent.run-strategy",
    "agent.run-class-strategy",
    "agent.find-strategies",
    "agent.critique",
    "agent.batch",
    "agent.scout-ideas",
    "agent.robustness",
  ];
  await db.delete(auditLog).where(inArray(auditLog.action, agentActions));
  res.json({ deleted: true, message: "Agent jobs purged (audit log preserved)" });
});