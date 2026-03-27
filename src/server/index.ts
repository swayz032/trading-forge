import "dotenv/config";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import pino from "pino";
import { sql } from "drizzle-orm";
import { db, client as dbClient } from "./db/index.js";
import { authMiddleware } from "./middleware/auth.js";
import { standardRateLimit } from "./middleware/rate-limit.js";
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
import { stopAllStreams } from "./services/paper-trading-stream.js";

const app = express();
const port = Number(process.env.PORT) || 4000;

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport:
    process.env.NODE_ENV === "development"
      ? { target: "pino-pretty" }
      : undefined,
});

// Middleware
app.use(express.json({ limit: "10mb" }));

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

  const memUsage = process.memoryUsage();

  res.json({
    status: dbStatus === "ok" ? "ok" : "degraded",
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
