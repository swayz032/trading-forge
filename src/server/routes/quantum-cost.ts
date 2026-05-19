/**
 * Quantum Cost Route — POST /api/quantum/cost
 *
 * Telemetry sink for Python-side quantum modules that have no TS wrapper.
 * Specifically: quantum_entropy_filter.collect_quantum_noise() calls this
 * endpoint after each run (fire-and-forget, 1s timeout in Python).
 *
 * Contract:
 *   - Accepts a completed cost record in one shot (Python already measured
 *     wall-clock and knows the status before it POSTs here).
 *   - Calls recordCost() then completeCost() synchronously.
 *   - ALWAYS returns 200. Cost telemetry MUST NOT break the Python caller.
 *     Errors are logged and swallowed; response body indicates {recorded: false}.
 *   - Pipeline pause → recordCost returns sentinel → completeCost is no-op →
 *     200 returned (paused-pipeline cost rows are noise at Tier 7).
 *
 * Authority: advisory / challenger_only. This route writes evidence rows only.
 * It does NOT spawn quantum compute, modify strategy lifecycle, or signal execution.
 *
 * Valid module names are enumerated to prevent typo pollution in quantum_run_costs.
 */

import { Router } from "express";
import {
  recordCost,
  completeCost,
} from "../lib/quantum-cost-tracker.js";
import { logger } from "../index.js";

export const quantumCostRoutes = Router();

// ─── Valid module names (must match quantum_run_costs.module_name values) ────
const VALID_MODULE_NAMES = new Set([
  "quantum_mc",
  "sqa",
  "rl_agent",
  "entropy_filter",
  "adversarial_stress",
  "cloud_qmc",
  "ising_decoder",
  "a_plus_auditor",
]);

// ─── POST /api/quantum/cost ───────────────────────────────────────────────────
quantumCostRoutes.post("/", async (req, res) => {
  const {
    moduleName,
    wallClockMs,
    status,
    qpuSeconds,
    costDollars,
    cacheHit,
    errorMessage,
  } = req.body as {
    moduleName?: unknown;
    wallClockMs?: unknown;
    status?: unknown;
    qpuSeconds?: unknown;
    costDollars?: unknown;
    cacheHit?: unknown;
    errorMessage?: unknown;
  };

  // ── Input validation ──────────────────────────────────────────────────────
  if (typeof moduleName !== "string" || !moduleName) {
    res.status(400).json({ error: "moduleName is required (string)" });
    return;
  }

  if (!VALID_MODULE_NAMES.has(moduleName)) {
    res.status(400).json({
      error: `Unknown moduleName: "${moduleName}". Valid values: ${[...VALID_MODULE_NAMES].join(", ")}`,
    });
    return;
  }

  if (typeof wallClockMs !== "number") {
    res.status(400).json({ error: "wallClockMs is required (number)" });
    return;
  }

  if (status !== "completed" && status !== "failed") {
    res.status(400).json({ error: 'status is required: "completed" | "failed"' });
    return;
  }

  // ── Record + complete cost row ────────────────────────────────────────────
  try {
    const { id } = await recordCost({
      moduleName,
      qpuSeconds: typeof qpuSeconds === "number" ? qpuSeconds : null,
      costDollars: typeof costDollars === "number" ? costDollars : null,
      cacheHit: typeof cacheHit === "boolean" ? cacheHit : false,
    });

    await completeCost(id, {
      wallClockMs,
      status: status as "completed" | "failed",
      errorMessage: typeof errorMessage === "string" ? errorMessage : null,
      qpuSeconds: typeof qpuSeconds === "number" ? qpuSeconds : null,
      costDollars: typeof costDollars === "number" ? costDollars : null,
      cacheHit: typeof cacheHit === "boolean" ? cacheHit : null,
    });

    logger.debug(
      { moduleName, wallClockMs, status, costRowId: id },
      "quantum-cost-route: cost row recorded",
    );

    res.status(200).json({ recorded: true, costRowId: id });
  } catch (err) {
    // Cost telemetry MUST NOT break the Python caller. Swallow all errors.
    logger.warn(
      { err, moduleName, wallClockMs },
      "quantum-cost-route: failed to record cost row — telemetry error swallowed",
    );
    res.status(200).json({ recorded: false });
  }
});
