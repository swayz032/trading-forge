/**
 * Validation Engine Routes — /api/validation
 *
 * Wires the Python validation modules (static, runtime, cross-validator)
 * to the API. Used by n8n workflows and the agent pipeline to gate
 * new strategy concepts before execution.
 *
 * Endpoints:
 *   POST /api/validation/static   — AST-based code validation against concept spec
 *   POST /api/validation/runtime  — Signal DataFrame validation against concept spec
 *   POST /api/validation/cross    — Cross-validate a concept (does spec exist?)
 *   GET  /api/validation/specs    — List all available concept specs
 */

import { Router } from "express";
import { z } from "zod";
import { logger } from "../index.js";
import { runPythonModule } from "../lib/python-runner.js";

export const validationRoutes = Router();

// ─── Validation Schemas ──────────────────────────────────────

const staticSchema = z.object({
  concept: z.string(),
  source_path: z.string().optional(),
  code: z.string().optional(),
}).refine(d => d.source_path || d.code, { message: "Either source_path or code required" });

const runtimeSchema = z.object({
  concept: z.string(),
  bars: z.array(z.record(z.unknown())).min(1),
});

const crossSchema = z.object({
  concept: z.string(),
  proposed_rules: z.array(z.string()).optional(),
});

// ─── POST /api/validation/static ─────────────────────────────

validationRoutes.post("/static", async (req, res) => {
  const parsed = staticSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  try {
    const result = await runPythonModule({
      module: "src.engine.validation_runner",
      args: ["--mode", "static"],
      config: parsed.data as unknown as Record<string, unknown>,
      timeoutMs: 30_000,
      componentName: "validation-static",
    });
    res.json({ success: true, ...result });
  } catch (err: any) {
    logger.error({ err, component: "validation" }, "Static validation failed");
    res.status(500).json({ error: "Static validation failed", details: err.message });
  }
});

// ─── POST /api/validation/runtime ────────────────────────────

validationRoutes.post("/runtime", async (req, res) => {
  const parsed = runtimeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  try {
    const result = await runPythonModule({
      module: "src.engine.validation_runner",
      args: ["--mode", "runtime"],
      config: parsed.data as unknown as Record<string, unknown>,
      timeoutMs: 30_000,
      componentName: "validation-runtime",
    });
    res.json({ success: true, ...result });
  } catch (err: any) {
    logger.error({ err, component: "validation" }, "Runtime validation failed");
    res.status(500).json({ error: "Runtime validation failed", details: err.message });
  }
});

// ─── POST /api/validation/cross ──────────────────────────────

validationRoutes.post("/cross", async (req, res) => {
  const parsed = crossSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  try {
    const result = await runPythonModule({
      module: "src.engine.validation_runner",
      args: ["--mode", "cross"],
      config: parsed.data as unknown as Record<string, unknown>,
      timeoutMs: 30_000,
      componentName: "validation-cross",
    });
    res.json({ success: true, ...result });
  } catch (err: any) {
    logger.error({ err, component: "validation" }, "Cross validation failed");
    res.status(500).json({ error: "Cross validation failed", details: err.message });
  }
});

// ─── GET /api/validation/specs ───────────────────────────────

validationRoutes.get("/specs", async (_req, res) => {
  try {
    const result = await runPythonModule({
      module: "src.engine.validation_runner",
      args: ["--mode", "list"],
      config: {},
      timeoutMs: 30_000,
      componentName: "validation-specs",
    });
    res.json({ success: true, ...result });
  } catch (err: any) {
    logger.error({ err, component: "validation" }, "List specs failed");
    res.status(500).json({ error: "List specs failed", details: err.message });
  }
});
