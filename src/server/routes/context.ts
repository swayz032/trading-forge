/**
 * Context Engine Routes — /api/context
 *
 * Wires the 8 Python context modules (HTF, Session, Bias, Playbook,
 * Location, Stops, Targets, Eligibility) to the API.
 *
 * Endpoints:
 *   POST /api/context/bias     — compute market context + bias + playbook (pre-signal)
 *   POST /api/context/evaluate — full signal evaluation through all 4 layers
 */

import { Router } from "express";
import { z } from "zod";
import { spawn } from "child_process";
import { resolve as pathResolve } from "path";
import { logger } from "../index.js";

export const contextRoutes = Router();

const PROJECT_ROOT = pathResolve(import.meta.dirname ?? ".", "../../..");

// ─── Validation Schemas ──────────────────────────────────────

const barSchema = z.object({
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number().default(0),
  ts_event: z.string().optional(),
});

const structuralLevelsSchema = z.object({
  at_order_block: z.boolean().default(false),
  at_fvg: z.boolean().default(false),
  after_sweep: z.boolean().default(false),
  at_value_area_edge: z.boolean().default(false),
  has_mss: z.boolean().default(false),
  nearest_ob_below: z.number().nullable().optional(),
  nearest_ob_above: z.number().nullable().optional(),
  nearest_fvg_below: z.number().nullable().optional(),
  nearest_fvg_above: z.number().nullable().optional(),
  nearest_swing_low: z.number().nullable().optional(),
  nearest_swing_high: z.number().nullable().optional(),
  sweep_wick_low: z.number().nullable().optional(),
  sweep_wick_high: z.number().nullable().optional(),
  nearest_bsl: z.number().nullable().optional(),
  nearest_ssl: z.number().nullable().optional(),
  nearest_old_high: z.number().nullable().optional(),
  nearest_old_low: z.number().nullable().optional(),
  nearest_untested_ob: z.number().nullable().optional(),
  nearest_unfilled_fvg: z.number().nullable().optional(),
  session_transition: z.boolean().default(false),
}).default({});

const biasRequestSchema = z.object({
  current_price: z.number(),
  vwap: z.number().default(0),
  event_active: z.boolean().default(false),
  event_minutes: z.number().default(999),
  daily_loss_cap_near: z.boolean().default(false),
  max_trades_hit: z.boolean().default(false),
  daily_bars: z.array(barSchema).min(1),
  four_h_bars: z.array(barSchema).optional(),
  one_h_bars: z.array(barSchema).optional(),
  intraday_bars: z.array(barSchema).default([]),
  bar_idx: z.number().optional(),
});

const evaluateRequestSchema = biasRequestSchema.extend({
  signal: z.object({
    direction: z.enum(["long", "short"]),
    entry_price: z.number(),
    strategy_name: z.string(),
  }),
  structural_levels: structuralLevelsSchema,
  atr: z.number().default(2.0),
  point_value: z.number().default(5.0),
  tick_size: z.number().default(0.25),
  vwap_std: z.number().default(0),
  regime: z.enum(["normal", "trending", "ranging", "high_vol", "pre_event"]).default("normal"),
  daily_loss_used_pct: z.number().default(0),
});

// ─── Python Runner ───────────────────────────────────────────

function runContextEngine(mode: string, config: Record<string, unknown>): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const pythonCmd = process.platform === "win32" ? "python" : "python3";
    const configJson = JSON.stringify(config);

    const proc = spawn(pythonCmd, [
      "-m", "src.engine.context_runner",
      "--mode", mode,
      "--config", configJson,
    ], {
      env: { ...process.env },
      cwd: PROJECT_ROOT,
    });

    let settled = false;
    const TIMEOUT_MS = 30_000; // 30s — context is fast, not backtest-level
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        proc.kill("SIGTERM");
        reject(new Error(`Context engine timeout after ${TIMEOUT_MS / 1000}s`));
      }
    }, TIMEOUT_MS);

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => (stdout += data.toString()));
    proc.stderr.on("data", (data) => {
      stderr += data.toString();
      // Log Python stderr as debug (import warnings, etc.)
      const trimmed = data.toString().trim();
      if (trimmed) logger.debug({ component: "context-engine" }, trimmed);
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;

      if (code === 0) {
        try {
          const result = JSON.parse(stdout.trim());
          if (result.error) {
            reject(new Error(result.error));
          } else {
            resolve(result);
          }
        } catch {
          reject(new Error(`Failed to parse context output: ${stdout.slice(0, 300)}`));
        }
      } else {
        reject(new Error(`Context engine failed (exit ${code}): ${stderr.slice(0, 500)}`));
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;

      // Retry with python3 on Windows
      if (pythonCmd === "python") {
        const proc2 = spawn("python3", [
          "-m", "src.engine.context_runner",
          "--mode", mode,
          "--config", configJson,
        ], { env: { ...process.env }, cwd: PROJECT_ROOT });

        const timer2 = setTimeout(() => { proc2.kill("SIGTERM"); reject(new Error("Retry timeout")); }, TIMEOUT_MS);
        let stdout2 = "";
        let stderr2 = "";
        proc2.stdout.on("data", (data) => (stdout2 += data.toString()));
        proc2.stderr.on("data", (data) => (stderr2 += data.toString()));
        proc2.on("close", (code) => {
          clearTimeout(timer2);
          if (code === 0) {
            try { resolve(JSON.parse(stdout2.trim())); }
            catch { reject(new Error("Parse error on retry")); }
          } else {
            reject(new Error(`Retry failed: ${stderr2.slice(0, 500)}`));
          }
        });
        proc2.on("error", () => { clearTimeout(timer2); reject(err); });
      } else {
        reject(err);
      }
    });
  });
}

// ─── POST /api/context/bias ──────────────────────────────────

contextRoutes.post("/bias", async (req, res) => {
  const parsed = biasRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  try {
    const startMs = Date.now();
    const result = await runContextEngine("bias", parsed.data);
    const durationMs = Date.now() - startMs;

    logger.info(
      { component: "context", mode: "bias", durationMs },
      `Bias computed in ${durationMs}ms`,
    );

    res.json({ success: true, durationMs, ...result });
  } catch (err: any) {
    logger.error({ err, component: "context" }, "Bias computation failed");
    res.status(500).json({ error: "Bias computation failed", details: err.message });
  }
});

// ─── POST /api/context/evaluate ──────────────────────────────

contextRoutes.post("/evaluate", async (req, res) => {
  const parsed = evaluateRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  try {
    const startMs = Date.now();
    const result = await runContextEngine("evaluate", parsed.data);
    const durationMs = Date.now() - startMs;

    logger.info(
      { component: "context", mode: "evaluate", durationMs, action: (result as any).eligibility?.action },
      `Signal evaluated in ${durationMs}ms → ${(result as any).eligibility?.action}`,
    );

    res.json({ success: true, durationMs, ...result });
  } catch (err: any) {
    logger.error({ err, component: "context" }, "Signal evaluation failed");
    res.status(500).json({ error: "Signal evaluation failed", details: err.message });
  }
});
