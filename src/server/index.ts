import "dotenv/config";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import pino from "pino";
import { sql, and, eq, lt } from "drizzle-orm";
import { db, client as dbClient } from "./db/index.js";
import { authMiddleware } from "./middleware/auth.js";
import { standardRateLimit } from "./middleware/rate-limit.js";
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
import { sseRoutes } from "./routes/sse.js";
import { signalRoutes } from "./routes/signals.js";
import { propFirmRoutes } from "./routes/prop-firm.js";
import { portfolioRoutes } from "./routes/portfolio.js";
import { contextRoutes } from "./routes/context.js";
import { validationRoutes } from "./routes/validation.js";
import { pineExportRoutes } from "./routes/pine-export.js";
import { quantumMcRoutes } from "./routes/quantum-mc.js";
import { strategyNameRoutes } from "./routes/strategy-names.js";
import { criticOptimizerRoutes } from "./routes/critic-optimizer.js";
import { deeparRoutes } from "./routes/deepar.js";
import { healthDashboardRoutes } from "./routes/health-dashboard.js";
import { stopAllStreams } from "./services/paper-trading-stream.js";
import { OTEL_AVAILABLE } from "./lib/tracing.js";
import { CircuitBreakerRegistry } from "./lib/circuit-breaker.js";
import { AlertFactory } from "./services/alert-service.js";

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
    await db.execute(sql`SELECT 1`);
    dbLatencyMs = Date.now() - dbStart;
  } catch {
    dbStatus = "error";
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
app.use("/api/backtests", backtestRoutes);
app.use("/api/agent", agentRoutes);
app.use("/api/monte-carlo", monteCarloRoutes);
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
app.use("/api/quantum-mc", quantumMcRoutes);
app.use("/api/strategy-names", strategyNameRoutes);
app.use("/api/critic-optimizer", criticOptimizerRoutes);
app.use("/api/deepar", deeparRoutes);
app.use("/api/health", healthDashboardRoutes);

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
  }).catch(() => {});

  // ─── H2: Initialize paper position state maps from DB ────────
  // Restores trail-stop HWM and bars-held counters for any positions that were
  // open when the server last shut down.  Must run before the first bar arrives.
  import("./services/paper-signal-service.js").then(({ initializePositionStateMaps }) => {
    initializePositionStateMaps().catch((err) => {
      logger.error({ err }, "Startup: position state map initialization failed (non-blocking)");
    });
  }).catch(() => {});

  // Start scheduled jobs (rolling Sharpe, pre-market prep, drift checks)
  import("./scheduler.js").then(({ initScheduler }) => {
    initScheduler();
    logger.info("Scheduler initialized");
  }).catch((err) => {
    logger.warn({ err }, "Scheduler failed to initialize — cron jobs disabled");
  });
});

// Graceful shutdown — tear down all Massive WebSockets
process.on("SIGTERM", () => {
  logger.info("SIGTERM received — stopping all paper streams");
  stopAllStreams();
  dbClient.end({ timeout: 5 }).catch((err) => {
    logger.error({ err }, "Failed to close DB connection pool");
  });
  server.close(() => { process.exit(0); });
  setTimeout(() => { logger.error("Shutdown timeout — forcing exit"); process.exit(1); }, 10_000);
});
process.on("SIGINT", () => {
  logger.info("SIGINT received — stopping all paper streams");
  stopAllStreams();
  dbClient.end({ timeout: 5 }).catch((err) => {
    logger.error({ err }, "Failed to close DB connection pool");
  });
  server.close(() => { process.exit(0); });
  setTimeout(() => { logger.error("Shutdown timeout — forcing exit"); process.exit(1); }, 10_000);
});
