import { Router } from "express";
import { z } from "zod";
import { AgentService } from "../services/agent-service.js";

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

const scoutIdeaSchema = z.object({
  source: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  url: z.string().url().optional(),
  summary: z.string().optional(),
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
