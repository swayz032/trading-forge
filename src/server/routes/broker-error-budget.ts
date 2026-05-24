/**
 * Broker Error Budget — HTTP routes (Wave 25 Gap 8)
 *
 * GET /api/broker-error-budget          — full budget (all brokers)
 * GET /api/broker-error-budget/alarms   — only alarmed brokers
 *
 * Both endpoints accept `?windowHours=N` (default 24).
 * Read-only. No mutations.
 */

import { Router } from "express";

export const brokerErrorBudgetRoutes = Router();

// ─── GET /api/broker-error-budget ─────────────────────────────────────────────
brokerErrorBudgetRoutes.get("/", async (req, res) => {
  const windowHours = req.query.windowHours
    ? Number(req.query.windowHours)
    : 24;
  if (isNaN(windowHours) || windowHours < 1 || windowHours > 720) {
    return res.status(400).json({ error: "windowHours must be between 1 and 720" });
  }
  const { computeBrokerErrorBudget } = await import(
    "../services/broker-error-budget-service.js"
  );
  const result = await computeBrokerErrorBudget(windowHours);
  return res.json(result);
});

// ─── GET /api/broker-error-budget/alarms ──────────────────────────────────────
brokerErrorBudgetRoutes.get("/alarms", async (req, res) => {
  const windowHours = req.query.windowHours
    ? Number(req.query.windowHours)
    : 24;
  if (isNaN(windowHours) || windowHours < 1 || windowHours > 720) {
    return res.status(400).json({ error: "windowHours must be between 1 and 720" });
  }
  const { computeAlarmedBrokers } = await import(
    "../services/broker-error-budget-service.js"
  );
  const result = await computeAlarmedBrokers(windowHours);
  return res.json(result);
});
