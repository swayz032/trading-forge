/**
 * Governor Routes — First-Loss Governor state machine API
 *
 * Follows the survival.ts subprocess spawn pattern:
 * - Platform detection (python vs python3)
 * - stdout -> JSON.parse
 * - stderr -> logging
 */

import { Router } from "express";
import { spawn } from "child_process";
import { resolve as pathResolve } from "path";
import { z } from "zod";
import { logger } from "../index.js";

export const governorRoutes = Router();

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
      logger.info({ component: "governor-engine" }, data.toString().trim());
    });

    proc.on("close", (code) => {
      if (code === 0) {
        try {
          resolve(JSON.parse(stdout.trim()));
        } catch {
          reject(new Error(`Failed to parse governor output: ${stdout}`));
        }
      } else {
        reject(new Error(`Governor engine failed (exit ${code}): ${stderr}`));
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
            reject(new Error(`Governor engine failed: ${stderr2}`));
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

const tradeSchema = z.object({
  strategy_id: z.string().min(1),
  pnl: z.number(),
  mae: z.number().default(0),
  daily_loss_budget: z.number().positive().default(500),
  current_state: z.string().optional(),
});

const sessionEndSchema = z.object({
  strategy_id: z.string().min(1),
  daily_loss_budget: z.number().positive().default(500),
  current_state: z.string().optional(),
});

const backtestSchema = z.object({
  trades: z.array(z.object({
    pnl: z.number(),
    mae: z.number().optional(),
    contracts: z.number().optional(),
    entry_time: z.string().optional(),
    session: z.string().optional(),
  }).passthrough()).min(1),
  daily_loss_budget: z.number().positive().default(500),
});

// ─── GET /api/governor/status/:strategyId ───────────────────────
// Current governor state for a strategy
governorRoutes.get("/status/:strategyId", async (req, res) => {
  const { strategyId } = req.params;

  // In a full implementation, this would query stored governor state
  res.json({
    strategy_id: strategyId,
    state: "normal",
    size_multiplier: 1.0,
    can_trade: true,
    message: "Governor state tracking. Use POST /api/governor/trade to process trades through the governor.",
  });
});

// ─── POST /api/governor/trade ───────────────────────────────────
// Process a trade through governor
governorRoutes.post("/trade", async (req, res) => {
  const parsed = tradeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  try {
    const result = await runPython(
      "src.engine.governor.state_machine",
      JSON.stringify({ action: "on_trade", ...parsed.data }),
    );
    res.json(result);
  } catch (err) {
    logger.error({ err }, "Governor trade processing failed");
    res.status(500).json({ error: "Governor trade processing failed", details: String(err) });
  }
});

// ─── POST /api/governor/session-end ─────────────────────────────
// End session for a strategy's governor
governorRoutes.post("/session-end", async (req, res) => {
  const parsed = sessionEndSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  try {
    const result = await runPython(
      "src.engine.governor.state_machine",
      JSON.stringify({ action: "on_session_end", ...parsed.data }),
    );
    res.json(result);
  } catch (err) {
    logger.error({ err }, "Governor session end failed");
    res.status(500).json({ error: "Governor session end failed", details: String(err) });
  }
});

// ─── POST /api/governor/backtest ────────────────────────────────
// Backtest governor impact on historical trades
governorRoutes.post("/backtest", async (req, res) => {
  const parsed = backtestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  try {
    const result = await runPython(
      "src.engine.governor.governor_backtest",
      JSON.stringify(parsed.data),
    );
    res.json(result);
  } catch (err) {
    logger.error({ err }, "Governor backtest failed");
    res.status(500).json({ error: "Governor backtest failed", details: String(err) });
  }
});

// ─── GET /api/governor/configs ──────────────────────────────────
// Available governor configurations
governorRoutes.get("/configs", async (_req, res) => {
  try {
    const result = await runPython(
      "src.engine.governor.governor_config",
      JSON.stringify({ action: "list" }),
    );
    res.json(result);
  } catch {
    // Fallback: return config profiles directly
    res.json({
      profiles: ["default", "aggressive", "conservative"],
      default: {
        daily_loss_budget: 500.0,
        consecutive_loss_threshold: { alert: 2, cautious: 3, defensive: 4, lockout: 5 },
        session_loss_pct_threshold: { alert: 0.30, cautious: 0.50, defensive: 0.65, lockout: 0.80 },
        recovery_profitable_sessions: 2,
      },
      aggressive: {
        daily_loss_budget: 750.0,
        consecutive_loss_threshold: { alert: 3, cautious: 4, defensive: 5, lockout: 6 },
      },
      conservative: {
        daily_loss_budget: 300.0,
        consecutive_loss_threshold: { alert: 1, cautious: 2, defensive: 3, lockout: 4 },
      },
    });
  }
});
