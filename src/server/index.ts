import "./load-env.js";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import pino from "pino";
import { sql, and, eq, lt } from "drizzle-orm";
import { db, client as dbClient } from "./db/index.js";
import { authMiddleware } from "./middleware/auth.js";
import { standardRateLimit } from "./middleware/rate-limit.js";
import { strictRateLimit } from "./middleware/strict-rate-limit.js";
import { gracefullyShutdownPythonSubprocesses, getPythonSubprocessStats } from "./lib/python-runner.js";
import { correlationMiddleware } from "./middleware/correlation.js";
import { strategyRoutes } from "./routes/strategies.js";
import { journalRoutes } from "./routes/journal.js";
import { riskRoutes } from "./routes/risk.js";
import { dataRoutes } from "./routes/data.js";
import { indicatorRoutes } from "./routes/indicators.js";
import { backtestRoutes } from "./routes/backtests.js";
import { agentRoutes } from "./routes/agent.js";
import { monteCarloRoutes } from "./routes/monte-carlo.js";
import complianceRoutes from "./routes/compliance.js";
import { compilerRoutes } from "./routes/compiler.js";
import { survivalRoutes } from "./routes/survival.js";
import { skipRoutes } from "./routes/skip.js";
import { macroRoutes } from "./routes/macro.js";
import { graveyardRoutes } from "./routes/graveyard.js";
import { decayRoutes } from "./routes/decay.js";
import { archetypeRoutes } from "./routes/archetypes.js";
import { tournamentRoutes } from "./routes/tournament.js";
import { antiSetupRoutes } from "./routes/anti-setups.js";
import { governorRoutes } from "./routes/governor.js";
import { paperRoutes } from "./routes/paper.js";
import { alertRoutes as alertCrudRoutes } from "./routes/alerts.js";
import { sseRoutes, broadcastSSE, closeAllSseClients } from "./routes/sse.js";
import { signalRoutes } from "./routes/signals.js";
import { propFirmRoutes } from "./routes/prop-firm.js";
import { portfolioRoutes } from "./routes/portfolio.js";
import { contextRoutes } from "./routes/context.js";
import { validationRoutes } from "./routes/validation.js";
import { pineExportRoutes } from "./routes/pine-export.js";
import { quantumMcRoutes } from "./routes/quantum-mc.js";
import { adversarialStressRoutes } from "./routes/adversarial-stress.js";
import { strategyNameRoutes } from "./routes/strategy-names.js";
import { criticOptimizerRoutes } from "./routes/critic-optimizer.js";
import { deeparRoutes } from "./routes/deepar.js";
import { healthDashboardRoutes } from "./routes/health-dashboard.js";
import { adminRoutes } from "./routes/admin.js";
import { dlqRoutes } from "./routes/dlq.js";
import { metricsRoutes } from "./routes/metrics.js";
import { n8nTrackingRoutes } from "./routes/n8n-tracking.js";
import { openaiProxyRoutes } from "./routes/openai-proxy.js";
import { searchRouterRoutes } from "./routes/search-router.js";
import { prevalidatorRoutes } from "./routes/prevalidator.js";
import { openclawDailyReportRoutes } from "./routes/openclaw-daily-report.js";
import { supadataRoutes } from "./routes/supadata.js";
import { stopAllStreams, getActiveStreams } from "./services/paper-trading-stream.js";
import { OTEL_AVAILABLE } from "./lib/tracing.js";
import { CircuitBreakerRegistry } from "./lib/circuit-breaker.js";
import { AlertFactory } from "./services/alert-service.js";
import { initAgentCoordination } from "./services/agent-coordinator-service.js";
import { auditorRoutes } from "./routes/auditor.js";

// ─── Circuit breaker → alert wiring ─────────────────────────────
// When any circuit breaker trips OPEN, fire a critical alert so the dashboard
// and any future notification channels (SNS/email) are aware immediately.
CircuitBreakerRegistry.setOnStateChange((name, _from, to) => {
  if (to === "OPEN") {
    AlertFactory.circuitOpen(name);
  }
});

const app = express();
export { app };
const port = Number(process.env.PORT) || 4000;

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport:
    process.env.NODE_ENV === "development"
      ? { target: "pino-pretty" }
      : undefined,
});

type PythonDependencyHealth = {
  status: "unknown" | "ok" | "error";
  checkedAt: string | null;
  missing: string[];
  error?: string;
};

const REQUIRED_PYTHON_MODULES = ["polars", "numpy", "pandas"] as const;
let pythonDependencyHealth: PythonDependencyHealth = {
  status: "unknown",
  checkedAt: null,
  missing: [],
};

async function checkPythonDependencies(): Promise<void> {
  pythonDependencyHealth = {
    status: "unknown",
    checkedAt: new Date().toISOString(),
    missing: [],
  };

  try {
    const pythonCmd = process.platform === "win32" ? "python" : "python3";
    const script = [
      "import importlib.util, json",
      `mods = ${JSON.stringify([...REQUIRED_PYTHON_MODULES])}`,
      "missing = [m for m in mods if importlib.util.find_spec(m) is None]",
      "print(json.dumps({'missing': missing}))",
    ].join(";");

    const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
      const proc = spawn(pythonCmd, ["-c", script], { env: { ...process.env } });
      let stdout = "";
      let stderr = "";
      proc.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
      proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
      proc.on("close", (code) => resolve({ code, stdout, stderr }));
      proc.on("error", (err) => resolve({ code: 1, stdout: "", stderr: err.message }));
    });

    if (result.code !== 0) {
      pythonDependencyHealth = {
        status: "error",
        checkedAt: new Date().toISOString(),
        missing: [],
        error: result.stderr.trim() || `python exited with code ${result.code}`,
      };
      return;
    }

    const parsed = JSON.parse(result.stdout || "{}") as { missing?: string[] };
    const missing = Array.isArray(parsed.missing) ? parsed.missing : [];
    pythonDependencyHealth = {
      status: missing.length === 0 ? "ok" : "error",
      checkedAt: new Date().toISOString(),
      missing,
      error: missing.length > 0 ? `Missing Python modules: ${missing.join(", ")}` : undefined,
    };
  } catch (err) {
    pythonDependencyHealth = {
      status: "error",
      checkedAt: new Date().toISOString(),
      missing: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// Middleware
app.use(express.json({ limit: "10mb" }));

// Correlation ID — must be first /api middleware so all subsequent handlers have req.log
app.use("/api", correlationMiddleware);

// Rate limiting (before auth gate)
app.use("/api", standardRateLimit);

// Health check (no auth) — enhanced with DB connectivity + system metrics
app.get("/api/health", async (_req, res) => {
  const startMs = Date.now();
  let dbStatus = "ok";
  let dbLatencyMs = 0;

  try {
    const dbStart = Date.now();
    // G5.2: bound the SELECT 1 with a 2s timeout. Without this, an exhausted
    // pool can hang /api/health for 30s+ and cascade into k8s liveness restart
    // loops or load-balancer failover storms.
    await Promise.race([
      db.execute(sql`SELECT 1`),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("db_health_timeout")), 2000),
      ),
    ]);
    dbLatencyMs = Date.now() - dbStart;
  } catch (err) {
    dbStatus = err instanceof Error && err.message === "db_health_timeout" ? "timeout" : "error";
  }

  // Ollama connectivity check
  let ollamaStatus: string;
  try {
    const ollamaUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
    const resp = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
    ollamaStatus = resp.ok ? "ok" : "error";
  } catch { ollamaStatus = "unreachable"; }

  // Python runtime check — spawn python --version with 3s timeout
  const pythonHealth: { status: string; version?: string; error?: string } = await new Promise((resolve) => {
    const pythonCmd = process.platform === "win32" ? "python" : "python3";
    const proc = spawn(pythonCmd, ["--version"], { env: { ...process.env } });
    const TIMEOUT_MS = 3000;
    let settled = false;
    let stdout = "";
    let stderr = "";

    const timer = setTimeout(() => {
      if (!settled) { settled = true; proc.kill("SIGTERM"); resolve({ status: "error", error: "timeout" }); }
    }, TIMEOUT_MS);

    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));  // python --version writes to stderr on older Python

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      const versionLine = (stdout + stderr).trim();
      if (code === 0 && versionLine) {
        resolve({ status: "ok", version: versionLine });
      } else {
        resolve({ status: "error", error: versionLine || `exit code ${code}` });
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      if (!settled) { settled = true; resolve({ status: "error", error: err.message }); }
    });
  });

  // Top-level status: degraded if core dependencies are not fully operational.
  const isHealthy = dbStatus === "ok"
    && ollamaStatus === "ok"
    && pythonDependencyHealth.status !== "error";
  const topLevelStatus = isHealthy ? "ok" : "degraded";

  const memUsage = process.memoryUsage();

  // Scheduler liveness: report last-fired timestamps for each job
  // Returns {} if scheduler hasn't run yet (first startup before first cron tick)
  let schedulerStatus: Record<string, string> = {};
  try {
    const { getSchedulerHealth } = await import("./scheduler.js");
    const health = getSchedulerHealth();
    schedulerStatus = Object.fromEntries(
      Object.entries(health).map(([job, firedAt]) => [job, firedAt.toISOString()]),
    );
  } catch { /* scheduler not yet initialized */ }

  // Python subprocess pool stats — synchronous read of in-process counters.
  // Saturation (active === cap) is the early signal for backpressure before
  // queue depth grows and callers start experiencing latency.
  const rawPool = getPythonSubprocessStats();
  const pythonPool = {
    active: rawPool.active,
    queued: rawPool.queued,
    cap: rawPool.cap,
    saturated: rawPool.active >= rawPool.cap,
  };

  // Massive WebSocket stream status — derives connected state from the live
  // sharedSockets registry. If no sessions are active the feed is "disconnected"
  // (paper engine is idle). "connected" means at least one session has all its
  // symbols with an open socket. "unknown" is the catch-all for read errors.
  let massive: { status: "connected" | "disconnected" | "unknown"; activeStreams: number; lastConnectedAt: null } = {
    status: "unknown",
    activeStreams: 0,
    lastConnectedAt: null,
  };
  try {
    const streams = getActiveStreams();
    const activeStreams = streams.size;
    let anyConnected = false;
    for (const info of streams.values()) {
      if (info.connected) { anyConnected = true; break; }
    }
    massive = {
      status: activeStreams === 0 ? "disconnected" : (anyConnected ? "connected" : "disconnected"),
      activeStreams,
      lastConnectedAt: null, // Ephemeral state — no persistent timestamp tracked yet
    };
  } catch { /* stream registry read failed — leave as unknown */ }

  // n8n reachability — lightweight HTTP probe with 1 s timeout.
  // Returns "disabled" when N8N_BASE_URL is not configured so this check
  // never blocks /api/health on an optional dependency.
  let n8n: { status: "ok" | "unreachable" | "error" | "disabled"; latencyMs: number | null };
  const n8nBaseUrl = process.env.N8N_BASE_URL;
  if (!n8nBaseUrl) {
    n8n = { status: "disabled", latencyMs: null };
  } else {
    const n8nStart = Date.now();
    try {
      const n8nResp = await fetch(`${n8nBaseUrl}/healthz`, {
        signal: AbortSignal.timeout(1000),
      });
      n8n = {
        status: n8nResp.ok ? "ok" : "error",
        latencyMs: Date.now() - n8nStart,
      };
    } catch (err) {
      n8n = {
        status: err instanceof Error && err.name === "TimeoutError" ? "unreachable" : "unreachable",
        latencyMs: Date.now() - n8nStart,
      };
    }
  }

  res.json({
    status: topLevelStatus,
    service: "trading-forge",
    timestamp: new Date().toISOString(),
    uptime: Math.round(process.uptime()),
    version: process.env.npm_package_version ?? "dev",
    database: {
      status: dbStatus,
      latencyMs: dbLatencyMs,
    },
    ollama: {
      status: ollamaStatus,
    },
    python: pythonHealth,
    pythonDependencies: pythonDependencyHealth,
    pythonPool,
    massive,
    n8n,
    circuitBreakers: CircuitBreakerRegistry.statusAll(),
    scheduler: schedulerStatus,
    memory: {
      heapUsedMb: Math.round(memUsage.heapUsed / 1024 / 1024),
      heapTotalMb: Math.round(memUsage.heapTotal / 1024 / 1024),
      rssMb: Math.round(memUsage.rss / 1024 / 1024),
    },
    responseMs: Date.now() - startMs,
  });
});

// Auth gate
app.use("/api", authMiddleware);

// Routes
app.use("/api/strategies", strategyRoutes);
app.use("/api/journal", journalRoutes);
app.use("/api/risk", riskRoutes);
app.use("/api/data", dataRoutes);
app.use("/api/indicators", indicatorRoutes);
// Strict rate limit (30 req/min) applied before mutation-heavy route handlers.
// These routes spawn Python subprocesses or trigger expensive DB writes — a
// runaway agent loop or misconfigured n8n workflow must not exhaust the pool.
// strictRateLimit fires BEFORE the route handler but AFTER standardRateLimit
// (which is mounted at /api globally above), so a burst caller will hit 200/min
// first and then the 30/min cap on these paths.
app.use("/api/backtests", strictRateLimit, backtestRoutes);
app.use("/api/agent", strictRateLimit, agentRoutes);
app.use("/api/monte-carlo", strictRateLimit, monteCarloRoutes);
app.use("/api/compliance", complianceRoutes);
app.use("/api/compiler", compilerRoutes);
app.use("/api/survival", survivalRoutes);
app.use("/api/skip", skipRoutes);
app.use("/api/macro", macroRoutes);
app.use("/api/graveyard", graveyardRoutes);
app.use("/api/decay", decayRoutes);
app.use("/api/archetypes", archetypeRoutes);
app.use("/api/tournament", tournamentRoutes);
app.use("/api/anti-setups", antiSetupRoutes);
app.use("/api/governor", governorRoutes);
app.use("/api/paper", paperRoutes);
app.use("/api/alerts", alertCrudRoutes);
app.use("/api/sse", sseRoutes);
app.use("/api/signals", signalRoutes);
app.use("/api/prop-firm", propFirmRoutes);
app.use("/api/portfolio", portfolioRoutes);
app.use("/api/context", contextRoutes);
app.use("/api/validation", validationRoutes);
app.use("/api/pine-export", pineExportRoutes);
app.use("/api/quantum-mc", strictRateLimit, quantumMcRoutes);
app.use("/api/adversarial-stress", strictRateLimit, adversarialStressRoutes);
app.use("/api/strategy-names", strategyNameRoutes);
app.use("/api/critic-optimizer", strictRateLimit, criticOptimizerRoutes);
app.use("/api/deepar", deeparRoutes);
// Tier 3.3: A+ Market Auditor — challenger_only, advisory output
app.use("/api/auditor", strictRateLimit, auditorRoutes);
app.use("/api/health", healthDashboardRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/dlq", dlqRoutes);
app.use("/api/metrics", metricsRoutes);
app.use("/api/n8n", n8nTrackingRoutes);
app.use("/api/openai-proxy", openaiProxyRoutes);
app.use("/api/search", searchRouterRoutes);
app.use("/api/prevalidate", prevalidatorRoutes);
app.use("/api/openclaw/daily-report", openclawDailyReportRoutes);
app.use("/api/supadata", supadataRoutes);

// 404 handler for API routes — returns JSON instead of Express default HTML
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Global error handler for API routes
app.use("/api", (err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ err }, "Unhandled error");
  res.status(500).json({ error: "Internal server error" });
});

// ─── Serve Frontend (production) ──────────────────────────────
// Vite builds to Trading_forge_frontend/amber-vision-main/dist/
// In prod (Railway), serve the built SPA from Express directly.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDist = path.resolve(__dirname, "../../Trading_forge_frontend/amber-vision-main/dist");

app.use(express.static(frontendDist));

// SPA catch-all: any non-API route serves index.html (Express 5 syntax)
app.get("/{*splat}", (_req, res) => {
  res.sendFile(path.join(frontendDist, "index.html"));
});

process.on("unhandledRejection", (reason, _promise) => {
  logger.error({ reason }, "Unhandled promise rejection");
});

process.on("uncaughtException", (err) => {
  logger.error({ err }, "Uncaught exception — shutting down");
  process.exit(1);
});

const server = app.listen(port, () => {
  logger.info(`Trading Forge running on http://localhost:${port}`);

  // ─── Production HTTP server timeouts ─────────────────────────
  // Without these, a single slow/stuck client can hold a connection open
  // indefinitely, eventually exhausting the Node.js connection pool or causing
  // upstream ALB/proxy to accumulate dangling sockets.
  //
  // server.timeout        — max time for a complete request cycle (5 min covers
  //                         the longest backtest serialization we produce).
  // server.keepAliveTimeout — how long to keep an idle keep-alive socket open.
  //                         65 s > the Railway/ALB default of 60 s to prevent
  //                         the proxy dropping connections before Node does,
  //                         which would cause sporadic ECONNRESET on clients.
  // server.headersTimeout — must be > keepAliveTimeout so Node doesn't abort
  //                         a new pipelined request before headers arrive.
  // server.requestTimeout — per-request hard timeout matching server.timeout.
  //                         Sends 408 if the client is too slow to send the body.
  //
  // SSE connections (/api/sse) are long-lived by design (res.write without
  // res.end). The SSE route calls req.setTimeout(0) to opt them out, which
  // overrides server.timeout for those sockets only.
  server.timeout = 5 * 60 * 1000;         // 5 min
  server.keepAliveTimeout = 65 * 1000;    // 65 s
  server.headersTimeout = 70 * 1000;      // 70 s — must be > keepAliveTimeout
  server.requestTimeout = 5 * 60 * 1000;  // 5 min — matches server.timeout
  if (OTEL_AVAILABLE) {
    logger.info("OpenTelemetry tracing active");
  } else {
    logger.warn("OpenTelemetry tracing disabled — set OTEL_EXPORTER_OTLP_ENDPOINT to enable");
  }

  checkPythonDependencies().then(() => {
    if (pythonDependencyHealth.status === "error") {
      logger.error(
        {
          missing: pythonDependencyHealth.missing,
          error: pythonDependencyHealth.error,
        },
        "Python dependency preflight failed",
      );
    } else {
      logger.info({ modules: REQUIRED_PYTHON_MODULES }, "Python dependency preflight passed");
    }
  }).catch((err) => {
    logger.error({ err }, "Python dependency preflight failed");
  });

  // ─── Orphaned backtest cleanup ────────────────────────────────
  // On every restart, mark backtests that have been stuck in "running" for more
  // than 10 minutes as failed. These are process-killed survivors from prior
  // restarts — they will never complete and must not block subsequent runs.
  import("./db/schema.js").then(async ({ backtests }) => {
    try {
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
      const orphaned = await db
        .update(backtests)
        .set({ status: "failed", errorMessage: "Server restart — orphaned running backtest" })
        .where(and(eq(backtests.status, "running"), lt(backtests.createdAt, tenMinutesAgo)))
        .returning({ id: backtests.id });
      if (orphaned.length > 0) {
        logger.warn({ count: orphaned.length, ids: orphaned.map((r) => r.id) }, "Startup: cleaned up orphaned running backtests");
      }
    } catch (err) {
      logger.error({ err }, "Startup: orphaned backtest cleanup failed (non-blocking)");
    }
  }).catch((err) => {
    logger.warn({ err }, "startup-import-failed: db/schema module load error during orphan cleanup");
  });

  // ─── H2: Initialize paper position state maps from DB ────────
  // Restores trail-stop HWM and bars-held counters for any positions that were
  // open when the server last shut down.  Must run before the first bar arrives.
  import("./services/paper-signal-service.js").then(({ initializePositionStateMaps }) => {
    initializePositionStateMaps().catch((err) => {
      logger.error({ err }, "Startup: position state map initialization failed (non-blocking)");
    });
  }).catch((err) => {
    // This import failing means paper signal service is unavailable — paper sessions won't
    // have restored HWM/bars-held state. Log at error (not warn) since this is safety-critical
    // for paper trading correctness on restart.
    logger.error({ err }, "startup-import-failed: paper-signal-service failed to load — position state maps NOT restored");
  });

  // Paper session recovery is handled by the scheduler `resumeActivePaperSessions`
  // job (scheduler.ts — see the resumeActivePaperSessions function), which runs
  // on scheduler boot and writes the canonical `session.recovered` audit rows.
  // The duplicate recovery that used to live here was removed to prevent double
  // audit rows per restart (FIX 5 — 2026-04-29).
  logger.info("Paper session recovery handled by scheduler.");

  // Warm up MetricsAggregator from DB (replays last 50 trades per active session)
  // Must run AFTER DB is ready and BEFORE first scheduler tick so dashboard sees
  // populated rolling metrics immediately on restart.
  import("./services/metrics-aggregator.js").then(({ metricsAggregator }) => {
    metricsAggregator.warmUp().then(({ sessionsRecovered, tradesReplayed }) => {
      logger.info({ sessionsRecovered, tradesReplayed }, "MetricsAggregator warm-up complete");
    }).catch((err) => {
      logger.warn({ err }, "MetricsAggregator warm-up failed (non-blocking)");
    });
  }).catch((err) => {
    logger.warn({ err }, "MetricsAggregator import failed during warm-up (non-blocking)");
  });

  // Start scheduled jobs (rolling Sharpe, pre-market prep, drift checks)
  import("./scheduler.js").then(({ initScheduler }) => {
    initScheduler();
    logger.info("Scheduler initialized");
    // Wire typed agent event bus AFTER scheduler so cross-domain handlers
    // can subscribe to lifecycle/risk/compliance/health events.
    initAgentCoordination();
  }).catch((err) => {
    logger.warn({ err }, "Scheduler failed to initialize — cron jobs disabled");
  });
});

// ─── Graceful Shutdown ────────────────────────────────────────
// Shared handler for SIGTERM / SIGINT. Sequenced teardown:
//   1. Broadcast system:shutdown SSE so dashboard clients can react immediately.
//   2. Close all SSE connections (prevents server.close() from hanging on them).
//   3. Stop all Massive WebSocket streams.
//   4. Close the HTTP server (drain in-flight requests).
//   5. Close the DB pool.
//   6. Flush pino's async transport so buffered log lines are written.
// Hard-kill timer ensures we never hang longer than 10s regardless of step failures.
let _shuttingDown = false;

function gracefulShutdown(signal: string): void {
  if (_shuttingDown) return; // Prevent double-fire
  _shuttingDown = true;

  logger.info({ signal }, "Shutdown signal received — beginning graceful teardown");

  // Hard-kill timer (unref'd — won't prevent exit if everything finishes cleanly)
  const forceKill = setTimeout(() => {
    logger.error("Shutdown timeout — forcing exit");
    process.exit(1);
  }, 10_000).unref();

  // Step 1: Notify SSE clients of impending shutdown
  try {
    broadcastSSE("system:shutdown", { reason: "server_shutdown", signal });
  } catch { /* non-critical */ }

  // Step 2: End all SSE connections so they don't keep server.close() waiting
  try {
    closeAllSseClients();
  } catch { /* non-critical */ }

  // Step 3: Tear down Massive WebSocket streams
  stopAllStreams();

  // Step 4: Drain Python subprocesses before closing HTTP (they may be serving
  // in-flight requests). We fire-and-forget this with a 5s window, then proceed
  // regardless — the hard-kill timer in the shutdown function handles stragglers.
  gracefullyShutdownPythonSubprocesses(5_000).catch((err) => {
    logger.error({ err }, "Python subprocess shutdown error (non-blocking)");
  });

  // Step 5: Stop accepting new HTTP connections; drain in-flight ones
  server.close(async () => {
    logger.info("HTTP server closed — draining DB pool and flushing logs");

    // Step 6: Close DB pool
    try {
      await dbClient.end({ timeout: 5 });
      logger.info("DB pool closed");
    } catch (err) {
      logger.error({ err }, "Failed to close DB connection pool");
    }

    // Step 6: Flush pino so async-mode transports (pino-pretty, file transport) drain
    // pino's flush() is only present when the logger uses an async transport.
    const pinoAny = logger as unknown as { flush?: (cb?: () => void) => void };
    if (typeof pinoAny.flush === "function") {
      pinoAny.flush(() => {
        clearTimeout(forceKill);
        process.exit(0);
      });
    } else {
      clearTimeout(forceKill);
      process.exit(0);
    }
  });
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
