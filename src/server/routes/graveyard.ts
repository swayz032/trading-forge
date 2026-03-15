/**
 * Strategy Graveyard Routes — Vector-searchable archive of failed strategies
 *
 * Follows the backtest-service.ts subprocess spawn pattern:
 * - Platform detection (python vs python3)
 * - stdout -> JSON.parse
 * - stderr -> logging
 */

import { Router } from "express";
import { spawn } from "child_process";
import { resolve as pathResolve } from "path";
import { z } from "zod";
import { logger } from "../index.js";

export const graveyardRoutes = Router();

const PROJECT_ROOT = pathResolve(import.meta.dirname ?? ".", "../..");

// ─── Python subprocess helper ──────────────────────────────────

function runPython(module: string, configJson: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const pythonCmd = process.platform === "win32" ? "python" : "python3";
    const args = ["-m", module, "--config", configJson];

    const proc = spawn(pythonCmd, args, {
      env: { ...process.env },
      cwd: PROJECT_ROOT,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => (stdout += data.toString()));
    proc.stderr.on("data", (data) => {
      stderr += data.toString();
      logger.info({ component: "graveyard-engine" }, data.toString().trim());
    });

    proc.on("close", (code) => {
      if (code === 0) {
        try {
          resolve(JSON.parse(stdout.trim()));
        } catch {
          reject(new Error(`Failed to parse graveyard output: ${stdout}`));
        }
      } else {
        reject(new Error(`Graveyard engine failed (exit ${code}): ${stderr}`));
      }
    });

    proc.on("error", (err) => {
      if (pythonCmd === "python") {
        const proc2 = spawn("python3", args, {
          env: { ...process.env },
          cwd: PROJECT_ROOT,
        });
        let stdout2 = "";
        let stderr2 = "";
        proc2.stdout.on("data", (data) => (stdout2 += data.toString()));
        proc2.stderr.on("data", (data) => (stderr2 += data.toString()));
        proc2.on("close", (code) => {
          if (code === 0) {
            try { resolve(JSON.parse(stdout2.trim())); }
            catch { reject(new Error(`Failed to parse: ${stdout2}`)); }
          } else {
            reject(new Error(`Graveyard engine failed: ${stderr2}`));
          }
        });
        proc2.on("error", () => reject(err));
      } else {
        reject(err);
      }
    });
  });
}

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
    const result = await runPython(
      "src.engine.graveyard.graveyard_gate",
      JSON.stringify(parsed.data),
    );
    res.json(result);
  } catch (err) {
    logger.error({ err }, "Corpse check failed");
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
    const result = await runPython(
      "src.engine.graveyard.embedder",
      JSON.stringify({ action: "bury", ...parsed.data }),
    );
    res.json(result);
  } catch (err) {
    logger.error({ err }, "Bury strategy failed");
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
    const result = await runPython(
      "src.engine.graveyard.similarity",
      JSON.stringify({ action: "search", ...parsed.data }),
    );
    res.json(result);
  } catch (err) {
    logger.error({ err }, "Graveyard search failed");
    res.status(500).json({ error: "Graveyard search failed", details: String(err) });
  }
});

// ─── GET /api/graveyard/failures ────────────────────────────────
// List by failure mode
graveyardRoutes.get("/failures", async (req, res) => {
  const mode = (req.query.mode as string) || "";
  const limit = Number(req.query.limit) || 50;

  try {
    const result = await runPython(
      "src.engine.graveyard.failure_tagger",
      JSON.stringify({ action: "list_by_mode", mode, limit }),
    );
    res.json(result);
  } catch (err) {
    logger.error({ err }, "Graveyard failures list failed");
    res.status(500).json({ error: "Failed to list failures", details: String(err) });
  }
});

// ─── GET /api/graveyard/stats ───────────────────────────────────
// Graveyard statistics
graveyardRoutes.get("/stats", async (_req, res) => {
  try {
    const result = await runPython(
      "src.engine.graveyard.failure_tagger",
      JSON.stringify({ action: "stats" }),
    );
    res.json(result);
  } catch (err) {
    logger.error({ err }, "Graveyard stats failed");
    res.status(500).json({ error: "Failed to get graveyard stats", details: String(err) });
  }
});

// ─── GET /api/graveyard/discoveries ─────────────────────────────
// Pattern discoveries — aggregated failure mode insights from graveyard analysis
graveyardRoutes.get("/discoveries", async (_req, res) => {
  try {
    const result = await runPython(
      "src.engine.graveyard.failure_tagger",
      JSON.stringify({ action: "discoveries" }),
    );
    res.json(result);
  } catch (err) {
    logger.error({ err }, "Graveyard discoveries failed");
    res.status(500).json({ error: "Failed to get graveyard discoveries", details: String(err) });
  }
});

// ─── GET /api/graveyard/:id ─────────────────────────────────────
// Get specific graveyard entry
graveyardRoutes.get("/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const result = await runPython(
      "src.engine.graveyard.embedder",
      JSON.stringify({ action: "get", id }),
    );
    res.json(result);
  } catch (err) {
    logger.error({ err }, "Graveyard get failed");
    res.status(500).json({ error: "Failed to get graveyard entry", details: String(err) });
  }
});
