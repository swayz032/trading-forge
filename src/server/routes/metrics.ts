import { Router } from "express";
import { CircuitBreakerRegistry } from "../lib/circuit-breaker.js";
import { getPythonSubprocessStats } from "../lib/python-runner.js";
import {
  promRegistry,
  circuitBreakerState,
  circuitBreakerFailures,
  pythonSubprocessActive,
  pythonSubprocessQueued,
} from "../lib/metrics-registry.js";

export const metricsRoutes = Router();

// ─── GET /api/metrics/dashboard — Aggregated view ─────────────
metricsRoutes.get("/dashboard", async (_req, res) => {
  const { getDashboardMetrics } = await import("../services/subsystem-metrics-service.js");
  const metrics = await getDashboardMetrics();
  res.json({ data: metrics });
});

// ─── GET /api/metrics/funnel — Scout pipeline funnel ──────────
metricsRoutes.get("/funnel", async (req, res) => {
  const { computeFunnelMetrics } = await import("../services/funnel-metrics-service.js");
  const since = req.query.since ? new Date(req.query.since as string) : undefined;
  const metrics = await computeFunnelMetrics(since);
  res.json(metrics);
});

// ─── GET /api/metrics/costs — Cost tracking dashboard ──────────
metricsRoutes.get("/costs", async (req, res) => {
  const { computeCosts } = await import("../services/cost-tracker.js");
  const since = req.query.since ? new Date(req.query.since as string) : undefined;
  const costs = await computeCosts(since);
  res.json(costs);
});

// ─── GET /api/metrics/prometheus — Prometheus text-format scrape endpoint ──────
//
// Emits all Trading Forge metrics via prom-client's registry, which handles
// correct Prometheus exposition format (histogram buckets, TYPE/HELP headers,
// label escaping, etc.) automatically.
//
// Metric families emitted (via promRegistry):
//   tf_http_request_duration_ms    — latency histogram (buckets + _count + _sum)
//   tf_circuit_breaker_state       — 0=CLOSED, 1=OPEN, 2=HALF_OPEN per breaker
//   tf_circuit_breaker_failures    — consecutive failure count per breaker
//   tf_python_subprocess_active    — live subprocess count
//   tf_python_subprocess_queued    — requests waiting for a concurrency slot
//   tf_strategy_promotions_total   — lifecycle transition counter
//   tf_backtest_runs_total         — backtest run counter by tier
//   tf_paper_trades_total          — paper trade counter by symbol/side/outcome
//   tf_process_*                   — default Node.js metrics (heap, GC, event loop)
//
// Gauge metrics (circuit breakers, subprocess pool) are refreshed immediately
// before the scrape so Prometheus always sees current state.
//
metricsRoutes.get("/prometheus", async (_req, res) => {
  // ── Refresh gauges from current runtime state ─────────────────
  const breakerStatuses = CircuitBreakerRegistry.statusAll();
  for (const s of breakerStatuses) {
    const stateVal = s.state === "OPEN" ? 1 : s.state === "HALF_OPEN" ? 2 : 0;
    circuitBreakerState.labels({ breaker: s.endpoint }).set(stateVal);
    circuitBreakerFailures.labels({ breaker: s.endpoint }).set(s.consecutiveFailures);
  }

  const pyStats = getPythonSubprocessStats();
  pythonSubprocessActive.set(pyStats.active);
  pythonSubprocessQueued.set(pyStats.queued);

  // ── Emit via prom-client (handles format, escaping, histogram buckets) ────
  res.set("Content-Type", promRegistry.contentType);
  res.send(await promRegistry.metrics());
});

// ─── GET /api/metrics/:subsystem — Query metrics for a subsystem ──
metricsRoutes.get("/:subsystem", async (req, res) => {
  const { queryMetrics } = await import("../services/subsystem-metrics-service.js");
  const since = req.query.since ? new Date(req.query.since as string) : undefined;
  const limit = req.query.limit ? parseInt(req.query.limit as string) : 100;
  const metrics = await queryMetrics(req.params.subsystem, since, limit);
  res.json({ data: metrics });
});
