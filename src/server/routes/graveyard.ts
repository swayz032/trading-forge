/**
 * Strategy Graveyard Routes — Vector-searchable archive of failed strategies
 *
 * Follows the backtest-service.ts subprocess spawn pattern:
 * - Platform detection (python vs python3)
 * - stdout -> JSON.parse
 * - stderr -> logging
 */

import { Router } from "express";
import { z } from "zod";
import { runPythonModule } from "../lib/python-runner.js";

export const graveyardRoutes = Router();

// ─── Validation Schemas ──────────────────────────────────────────

const corpseCheckSchema = z.object({
  candidate_dsl: z.record(z.unknown()),
  similarity_threshold: z.number().min(0).max(1).default(0.85),
});

const burySchema = z.object({
  strategy_id: z.string().uuid().optional(),
  name: z.string().min(1),
  dsl_snapshot: z.record(z.unknown()),
  failure_modes: z.array(z.string()).min(1),
  failure_details: z.record(z.unknown()).optional(),
  backtest_summary: z.record(z.unknown()).optional(),
  death_reason: z.string().optional(),
  source: z.enum(["auto", "manual", "decay"]).default("auto"),
});

const searchSchema = z.object({
  query: z.string().min(1),
  top_k: z.number().int().min(1).max(50).default(10),
  threshold: z.number().min(0).max(1).default(0.80),
});

// ─── POST /api/graveyard/check ──────────────────────────────────
// Corpse check before backtest
graveyardRoutes.post("/check", async (req, res) => {
  const parsed = corpseCheckSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  try {
    const result = await runPythonModule({
      module: "src.engine.graveyard.graveyard_gate",
      config: parsed.data as unknown as Record<string, unknown>,
      componentName: "graveyard-check",
    });
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Corpse check failed");
    res.status(500).json({ error: "Corpse check failed", details: String(err) });
  }
});

// ─── POST /api/graveyard/bury ───────────────────────────────────
// Add strategy to graveyard
graveyardRoutes.post("/bury", async (req, res) => {
  const parsed = burySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  try {
    const result = await runPythonModule({
      module: "src.engine.graveyard.embedder",
      config: { action: "bury", ...parsed.data } as unknown as Record<string, unknown>,
      componentName: "graveyard-bury",
    });
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Bury strategy failed");
    res.status(500).json({ error: "Failed to bury strategy", details: String(err) });
  }
});

// ─── GET /api/graveyard/search ──────────────────────────────────
// Search graveyard by text query
graveyardRoutes.get("/search", async (req, res) => {
  const parsed = searchSchema.safeParse({
    query: req.query.query,
    top_k: req.query.top_k ? Number(req.query.top_k) : undefined,
    threshold: req.query.threshold ? Number(req.query.threshold) : undefined,
  });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  try {
    const result = await runPythonModule({
      module: "src.engine.graveyard.similarity",
      config: { action: "search", ...parsed.data } as unknown as Record<string, unknown>,
      componentName: "graveyard-search",
    });
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Graveyard search failed");
    res.status(500).json({ error: "Graveyard search failed", details: String(err) });
  }
});

// ─── GET /api/graveyard/failures ────────────────────────────────
// List by failure mode
graveyardRoutes.get("/failures", async (req, res) => {
  const mode = (req.query.mode as string) || "";
  const limit = Number(req.query.limit) || 50;

  try {
    const result = await runPythonModule({
      module: "src.engine.graveyard.failure_tagger",
      config: { action: "list_by_mode", mode, limit },
      componentName: "graveyard-failures",
    });
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Graveyard failures list failed");
    res.status(500).json({ error: "Failed to list failures", details: String(err) });
  }
});

// ─── GET /api/graveyard/stats ───────────────────────────────────
// Graveyard statistics
graveyardRoutes.get("/stats", async (req, res) => {
  try {
    const result = await runPythonModule({
      module: "src.engine.graveyard.failure_tagger",
      config: { action: "stats" },
      componentName: "graveyard-stats",
    });
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Graveyard stats failed");
    res.status(500).json({ error: "Failed to get graveyard stats", details: String(err) });
  }
});

// ─── GET /api/graveyard/discoveries ─────────────────────────────
// Pattern discoveries — aggregated failure mode insights from graveyard analysis
graveyardRoutes.get("/discoveries", async (req, res) => {
  try {
    const result = await runPythonModule({
      module: "src.engine.graveyard.failure_tagger",
      config: { action: "discoveries" },
      componentName: "graveyard-discoveries",
    });
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Graveyard discoveries failed");
    res.status(500).json({ error: "Failed to get graveyard discoveries", details: String(err) });
  }
});

// ─── GET /api/graveyard/:id ─────────────────────────────────────
// Get specific graveyard entry
graveyardRoutes.get("/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const result = await runPythonModule({
      module: "src.engine.graveyard.embedder",
      config: { action: "get", id },
      componentName: "graveyard-get",
    });
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Graveyard get failed");
    res.status(500).json({ error: "Failed to get graveyard entry", details: String(err) });
  }
});
