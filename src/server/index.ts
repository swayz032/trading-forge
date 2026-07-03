import "./load-env.js";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { spawn, execSync } from "child_process";
import pino from "pino";
import { sql, and, eq, lt } from "drizzle-orm";
import { db, client as dbClient } from "./db/index.js";
import { authMiddleware } from "./middleware/auth.js";
import { standardRateLimit } from "./middleware/rate-limit.js";
import { strictRateLimit } from "./middleware/strict-rate-limit.js";
import { gracefullyShutdownPythonSubprocesses, getPythonSubprocessStats } from "./lib/python-runner.js";
import { getBacktestConcurrencyStats } from "./routes/backtests.js";
import { correlationMiddleware } from "./middleware/correlation.js";

// RUNNING-CODE IDENTITY (freeze-enabler): the exact git commit + dirty state of the code THIS process is
// executing — read once at boot. Lets a hard-freeze evaluation harness verify the backend wasn't stale or
// silently changed mid-run (the W4.2 single-supervisor confound). env GIT_COMMIT overrides (CI/deploy builds).
const RUNNING_COMMIT: { commit: string; dirty: boolean } = (() => {
  if (process.env.GIT_COMMIT) return { commit: process.env.GIT_COMMIT, dirty: false };
  try {
    const commit = execSync("git rev-parse HEAD", { encoding: "utf8", timeout: 4000 }).trim();
    const dirty = execSync("git status --porcelain", { encoding: "utf8", timeout: 4000 }).trim().length > 0;
    return { commit, dirty };
  } catch { return { commit: "unknown", dirty: false }; }
})();
import { strategyRoutes } from "./routes/strategies.js";
import { journalRoutes } from "./routes/journal.js";
import { riskRoutes } from "./routes/risk.js";
import { dataRoutes } from "./routes/data.js";
import { indicatorRoutes } from "./routes/indicators.js";
import { backtestRoutes } from "./routes/backtests.js";
import { agentRoutes } from "./routes/agent.js";
import { carterWebhookRouter } from "./routes/carter-webhook.js";
import { carterToolsRouter } from "./routes/carter-tools.js";
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
import { pineExportRecipientRoutes } from "./routes/pine-export-recipient.js";
import { quantumMcRoutes } from "./routes/quantum-mc.js";
import { quantumPreFlightRoutes } from "./routes/quantum-pre-flight.js";
import { quantumCostRoutes } from "./routes/quantum-cost.js";
import { adversarialStressRoutes } from "./routes/adversarial-stress.js";
import { frankensteinRoutes } from "./routes/frankenstein.js";
import { syntheticBlackSwanRoutes } from "./routes/synthetic-black-swan.js";
import { cloudQmcRoutes } from "./routes/cloud-qmc.js";
import { signalCorrelationRoutes } from "./routes/signal-correlation.js";
import { strategyNameRoutes } from "./routes/strategy-names.js";
import { criticOptimizerRoutes } from "./routes/critic-optimizer.js";
import { deeparRoutes } from "./routes/deepar.js";
import { healthDashboardRoutes } from "./routes/health-dashboard.js";
import { validationCadenceRoutes } from "./routes/validation-cadence.js";
import { adminRoutes } from "./routes/admin.js";
import { adminWorkflowBackupRoutes } from "./routes/admin-workflow-backup.js";
import { adminFrozenPolicyOverrideRoutes } from "./routes/admin-frozen-policy-override.js";
import { adminRecoveryRoutes } from "./routes/admin-recovery.js";
import { slumdawgRoutes } from "./routes/slumdawg.js";
import { slumhouseRouter, adminMappingRouter as slumhouseAdminMappingRouter } from "./routes/slumhouse/index.js";
import { dlqRoutes } from "./routes/dlq.js";
import { metricsRoutes } from "./routes/metrics.js";
import { n8nTrackingRoutes } from "./routes/n8n-tracking.js";
import { openaiProxyRoutes } from "./routes/openai-proxy.js";
import { searchRouterRoutes } from "./routes/search-router.js";
import { prevalidatorRoutes } from "./routes/prevalidator.js";
import { openclawDailyReportRoutes } from "./routes/openclaw-daily-report.js";
import { volumeProfileRoutes } from "./routes/volume-profile.js";
import { productionStatusRoutes } from "./routes/production-status.js";
import { libraryDiversityRoutes } from "./routes/library-diversity.js";
import { biasDecisionsRoutes } from "./routes/bias-decisions.js";
import { biasStateRoutes } from "./routes/bias-state.js";
import { nemoScenarioRoutes } from "./routes/nemo-scenarios.js";
import { strategyAssignmentRoutes } from "./routes/strategy-assignments.js";
import { stopAllStreams, getActiveStreams } from "./services/paper-trading-stream.js";
import { OTEL_AVAILABLE } from "./lib/tracing.js";
import { CircuitBreakerRegistry } from "./lib/circuit-breaker.js";
import { AlertFactory } from "./services/alert-service.js";
import { initAgentCoordination } from "./services/agent-coordinator-service.js";
import { auditorRoutes } from "./routes/auditor.js";
import { shadowRerunRoutes } from "./routes/shadow-rerun.js";
import { scoutHealthRoutes } from "./routes/scout-health.js";
import { tradingViewWebhookRoutes } from "./routes/tradingview-webhook.js";
import { preMarketRoutes } from "./routes/pre-market.js";
import { brokerAccountRoutes } from "./routes/broker-accounts.js";
import { brokerErrorBudgetRoutes } from "./routes/broker-error-budget.js";
import { deployedStrategyStarvationRoutes } from "./routes/deployed-strategy-starvation.js";
import { webhookLatencyRoutes } from "./routes/webhook-latency.js";
import { b15RobustnessRoutes } from "./routes/b15-robustness.js";
import { consistencyRoutes } from "./routes/consistency.js";
import { tradeJournalRoutes } from "./routes/trade-journal.js";
import { compositeHealthRoutes } from "./routes/composite-health.js";
import { abComparisonRoutes } from "./routes/ab-comparison.js";
import { liveOrderRoutes } from "./routes/live-order.js";
import { fillCallbackRoutes } from "./routes/fill-callback.js";
import { leakDetectionRoutes } from "./routes/leak-detection.js";
import { runPendingMigrations } from "./lib/boot-migration-runner.js";
import { checkStartupSecrets } from "./lib/startup-config-check.js";
import { insertAuditRowSafe } from "./lib/audit-log-helper.js";

// ─── Boot correlation (deepscan7 D2 / obs-M5, 2026-07-02) ─────────
// ONE bootCorrelationId minted BEFORE migrations/scheduler/regime-bank so every
// boot-sequence audit row (boot.started, migration.*, track_completed,
// regime-bank self-heal, boot.completed) is traceable as a single group.
// Previously the id was minted inside the app.listen callback (missing the
// migration runner entirely) and ensureRegimeBankPopulated minted its OWN
// second `boot-${epoch}` string — fragmented boot traces.
const bootCorrelationId = `boot-${Date.now()}`;

// boot.started — written before migrations so a migration-blocked boot still
// leaves an attributable trace. insertAuditRowSafe never throws (a DB that is
// down here will fail the migration runner loudly anyway).
await insertAuditRowSafe({
  action: "boot.started",
  entityType: "system",
  entityId: null,
  decisionAuthority: "system",
  input: {
    version: process.env.npm_package_version ?? "dev",
    node_env: process.env.NODE_ENV ?? null,
    port: Number(process.env.PORT) || 4000,
    pid: process.pid,
  } as Record<string, unknown>,
  result: { phase: "pre_migrations" } as Record<string, unknown>,
  status: "info",
  correlationId: bootCorrelationId,
});

// ─── Boot migration runner ────────────────────────────────────────
// Apply any pending Drizzle migrations BEFORE app.listen() and BEFORE any
// service initialization that reads DB schema. This is the automation-cert
// gate that prevents vacation-mode migration drift from breaking production.
// Throws on failure to block boot (fail-closed). No-ops when all applied.
// Controlled by BOOT_MIGRATION_ENABLED env var (default: true).
await runPendingMigrations(bootCorrelationId);

// ─── Vacation-survival A-8: Boot-time secret validation ──────────
// Emits WARN log + Discord notify when ADMIN_RESTART_HMAC_SECRET is unset
// so the operator learns BEFORE leaving that auto-restart is disabled.
// Never throws — warn-only, never fail boot.
await checkStartupSecrets();

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
    const pythonCmd = process.env.PYTHON_BIN ?? (process.platform === "win32" ? "python" : "python3");
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

// Carter post-call webhook — MOUNTED BEFORE express.json AND before the Bearer
// authMiddleware. ElevenLabs calls this server-to-server with its own HMAC in the
// `ElevenLabs-Signature` header (the HMAC is the auth, like /api/health is exempt).
// It must run before express.json so its own express.raw parser can verify the
// signature over the EXACT raw body bytes (re-serialized JSON would not match).
app.use("/api/carter/webhook", carterWebhookRouter);

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
    const pythonCmd = process.env.PYTHON_BIN ?? (process.platform === "win32" ? "python" : "python3");
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

  // Phase 14: concurrent backtest cap stats — shows how many backtests are in-flight
  // vs the server-side cap. When saturated, new POST /api/backtests return 429.
  const backtestConcurrency = getBacktestConcurrencyStats();

  // Massive WebSocket stream status — derives connected state from the live
  // sharedSockets registry. `reason` disambiguates "disconnected" between
  // expected idle (no paper sessions running), missing credentials, and
  // actual connection failure — so operator dashboards don't confuse paused
  // pipeline with a broken data feed.
  type MassiveReason =
    | "streaming"
    | "idle_no_paper_sessions"
    | "credential_missing"
    | "connection_failed"
    | "read_error";
  let massive: {
    status: "connected" | "disconnected" | "unknown";
    activeStreams: number;
    lastConnectedAt: null;
    reason: MassiveReason;
  } = {
    status: "unknown",
    activeStreams: 0,
    lastConnectedAt: null,
    reason: "read_error",
  };
  try {
    const streams = getActiveStreams();
    const activeStreams = streams.size;
    let anyConnected = false;
    for (const info of streams.values()) {
      if (info.connected) { anyConnected = true; break; }
    }
    let reason: MassiveReason;
    if (activeStreams === 0) {
      reason = process.env.MASSIVE_API_KEY ? "idle_no_paper_sessions" : "credential_missing";
    } else {
      reason = anyConnected ? "streaming" : "connection_failed";
    }
    massive = {
      status: activeStreams === 0 ? "disconnected" : (anyConnected ? "connected" : "disconnected"),
      activeStreams,
      lastConnectedAt: null, // Ephemeral state — no persistent timestamp tracked yet
      reason,
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

  // C4: Network failover status — included in health payload so operator knows
  // ISP connectivity state without a separate API call.
  let networkFailoverStatus: import("./lib/network-failover.js").NetworkFailoverStatus | null = null;
  try {
    const { getNetworkFailoverStatus } = await import("./lib/network-failover.js");
    networkFailoverStatus = getNetworkFailoverStatus();
  } catch { /* monitor not yet started — omit from response */ }

  // Pass 18: external API key presence flags (boolean only — never the value).
  // Wave 9 (2026-05-17): scrapingbeeConfigured removed — ScrapingBee/Supadata/
  // ScrapingDog fallback chains pruned in favor of `youtube-transcript` npm +
  // Google YouTube Data API.
  const externalApiKeys = {
    youtubeDataApiConfigured: Boolean(process.env.YOUTUBE_DATA_API_KEY),
    apifyConfigured:          Boolean(process.env.APIFY_API_KEY),
    apifyUserIdSet:           Boolean(process.env.APIFY_USER_ID),
    carterConfigured:         Boolean(process.env.ELEVENLABS_API_KEY && process.env.CARTER_AGENT_ID),
  };

  res.json({
    status: topLevelStatus,
    service: "trading-forge",
    timestamp: new Date().toISOString(),
    uptime: Math.round(process.uptime()),
    version: process.env.npm_package_version ?? "dev",
    commit: RUNNING_COMMIT.commit,       // running-code identity (freeze-lock); was unobservable before
    code_dirty: RUNNING_COMMIT.dirty,    // true = uncommitted changes in the running checkout (freeze-invalid)
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
    backtestConcurrency,
    massive,
    n8n,
    // C4: Network failover — ISP/broker connectivity state (null if monitor not started)
    networkFailover: networkFailoverStatus,
    circuitBreakers: CircuitBreakerRegistry.statusAll(),
    scheduler: schedulerStatus,
    // Pass 18: external scout API key presence (boolean — never the value)
    externalApiKeys,
    memory: {
      heapUsedMb: Math.round(memUsage.heapUsed / 1024 / 1024),
      heapTotalMb: Math.round(memUsage.heapTotal / 1024 / 1024),
      rssMb: Math.round(memUsage.rss / 1024 / 1024),
    },
    responseMs: Date.now() - startMs,
  });
});

// Carter tools-plane router — own Bearer auth (CARTER_TOOLS_HMAC_SECRET), NOT the
// general authMiddleware. Mounted AFTER express.json (needs JSON body parsing)
// and AFTER the webhook mount (so /api/carter/webhook is not shadowed) but BEFORE
// the general /api authMiddleware so tools-plane auth is self-contained.
app.use("/api/carter", carterToolsRouter);

// deep-scan #13: inbound webhooks from EXTERNAL senders (TradingView Pine alerts,
// broker fill callbacks) carry their OWN HMAC auth and cannot send the /api Bearer.
// Mount them BEFORE the general authMiddleware — same pattern as /api/carter/webhook
// — so activating the Bearer gate does not 401 broker execution. Each router
// validates its own HMAC (TRADINGVIEW webhook secret / BROKER_FILL_HMAC_SECRET).
app.use("/api/tradingview", tradingViewWebhookRoutes);
app.use("/api/broker/fill-callback", fillCallbackRoutes);

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
// Pass 16 — strictRateLimit (30/min) applied EXCEPT for /scout-extract which is
// called per-item by 5L/5M/5J n8n scouts. GPT-5-mini cost is already token-
// budgeted at the model layer; the 30/min API cap was tripping legitimate
// burst batches. Bypass strict cap only for that path; standardRateLimit
// (200/min) at /api still applies.
app.use("/api/agent", (req, res, next) => {
  if (req.path === "/scout-extract") return next();
  return strictRateLimit(req, res, next);
}, agentRoutes);
// Backward-compat alias: live n8n `Monthly_Robustness_Check` workflow uses
// `/api/agents/robustness` and `/api/agents/jobs/:id` (plural). The canonical
// mount is `/api/agent/...` (singular). Aliasing here avoids editing live n8n
// workflows out-of-band. Fixed 2026-04-30 in the integration audit.
app.use("/api/agents", strictRateLimit, agentRoutes);
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
// F-4: /api/pine-export/recipient MUST be mounted BEFORE /api/pine-export
// so Express does not shadow the more-specific path with the /:id wildcard.
app.use("/api/pine-export/recipient", pineExportRecipientRoutes);
app.use("/api/pine-export", pineExportRoutes);
app.use("/api/quantum-mc", strictRateLimit, quantumMcRoutes);
// Tier 6: Quantum pre-flight — cache-READ-ONLY lookup for n8n workflows.
// NOT rate-limited at strict tier because it is read-only and called per
// generated strategy in burst from n8n; standardRateLimit at /api covers it.
app.use("/api/quantum/pre-flight", quantumPreFlightRoutes);
// Tier 3.1 W3a: Quantum cost telemetry sink for Python-side modules (entropy_filter).
// Python calls this after collect_quantum_noise() to write quantum_run_costs rows.
// No strict rate limit — Python only calls after an actual circuit run (~6ms each).
app.use("/api/quantum/cost", quantumCostRoutes);
app.use("/api/adversarial-stress", strictRateLimit, adversarialStressRoutes);
// A4 Frankenstein: hard TESTING→PAPER gate — blocks promotion if strategy shows edge on random data
app.use("/api/frankenstein", strictRateLimit, frankensteinRoutes);
// A14 Synthetic Black Swan: Phase 0 advisory at PAPER → DEPLOY_READY (challenger_only)
app.use("/api/synthetic-black-swan", strictRateLimit, syntheticBlackSwanRoutes);
// Track 1 NeMo Scenario Designer: Phase 0 challenger_only — macro-narrative conditioning for A14
app.use("/api/nemo-scenarios", strictRateLimit, nemoScenarioRoutes);
app.use("/api/cloud-qmc", strictRateLimit, cloudQmcRoutes);
app.use("/api/signal-correlation", signalCorrelationRoutes);
app.use("/api/strategy-names", strategyNameRoutes);
app.use("/api/critic-optimizer", strictRateLimit, criticOptimizerRoutes);
app.use("/api/deepar", deeparRoutes);
// Tier 3.3: A+ Market Auditor — challenger_only, advisory output
app.use("/api/auditor", strictRateLimit, auditorRoutes);
app.use("/api/health", healthDashboardRoutes);
app.use("/api/validation-cadence", validationCadenceRoutes);
app.use("/api/production", productionStatusRoutes);
app.use("/api/admin", adminRoutes);
// Wave 29 Pass B.2: Frozen-policy HMAC override endpoint.
app.use("/api/admin", adminFrozenPolicyOverrideRoutes);
// Vacation-survival A-5: HMAC-gated recovery endpoints (clear cache / clear stuck session).
app.use("/api/admin", adminRecoveryRoutes);
// Deep-scan #4 backend-DR: durable sink for the n8n 3A-workflow-backup (workflow_backups table).
app.use("/api/admin", adminWorkflowBackupRoutes);
// Wave 26 Pass G — Slumdawg Analyst (Anam.ai) read-only API surface.
app.use("/api/admin/slumdawg", slumdawgRoutes);
// 2026-05-27 — Slumhouse portal (friend-facing read-only, Discord OAuth).
app.use(slumhouseRouter);
app.use(slumhouseAdminMappingRouter);
app.use("/api/dlq", dlqRoutes);
app.use("/api/metrics", metricsRoutes);
app.use("/api/n8n", n8nTrackingRoutes);
app.use("/api/openai-proxy", openaiProxyRoutes);
app.use("/api/search", searchRouterRoutes);
app.use("/api/prevalidate", prevalidatorRoutes);
app.use("/api/openclaw/daily-report", openclawDailyReportRoutes);
// A11: Shadow Re-Run Pattern — observation only, no lifecycle gate authority
app.use("/api/shadow-rerun", strictRateLimit, shadowRerunRoutes);
app.use("/api/scout", scoutHealthRoutes);
// Track 2: Volume Profile EXPANDED — daily VP levels, operator morning glance
app.use("/api/volume-profile", volumeProfileRoutes);
app.use("/api/library-diversity", libraryDiversityRoutes);
app.use("/api/bias-decisions", biasDecisionsRoutes);
// Wave 23.C: Bias state per-session operator visibility
app.use("/api/bias-state", biasStateRoutes);
// Track 5 Pass 2: Strategy Selection UI + Publish-to-Family Gate
app.use("/api/strategy-assignments", strategyAssignmentRoutes);

// Track 8 Pass 3: TradingView Marker Collector — HMAC-validated Pine alert webhooks.
// deep-scan #13: mounted ABOVE the auth gate (see near authMiddleware) so external
// Pine alerts (own HMAC, no Bearer) are not 401'd by the API_KEY gate.

// W23H.2: Pre-market routine state — daily 8:30 AM ET pre-market context per symbol
app.use("/api/pre-market", preMarketRoutes);

// W23H.H: Per-account symbol whitelist — GET list + PATCH enabled_symbols
app.use("/api/broker-accounts", brokerAccountRoutes);

// W25 Gap 8: Broker error budget — rejection-class aggregation + alarm
app.use("/api/broker-error-budget", brokerErrorBudgetRoutes);

// W25 Gap 3: Deployed strategy signal starvation watchdog
app.use("/api/deployed-strategy-starvation", deployedStrategyStarvationRoutes);

// W25 Gap 4: Webhook latency monitor + regime coverage status
app.use("/api/webhook-latency", webhookLatencyRoutes);
app.use("/api/b15-robustness", b15RobustnessRoutes);

// W26 Pass 6: Topstep consistency concentration tracker — GET /api/consistency/:accountId
app.use("/api/consistency", consistencyRoutes);
app.use("/api/trade-journal", tradeJournalRoutes);

// W28 Pass A.5: Composite health tile — READ-ONLY observability, no gate authority
app.use("/api/composite-health", compositeHealthRoutes);

// W29 Pass D.2: A/B paper sub-account Sharpe comparison — READ-ONLY observability
app.use("/api/ab-comparison", abComparisonRoutes);

// W1 CORE: TF Order Gateway — the in-process kill-switch + gate layer before every live order.
// Pine alert → POST /api/live-order → routeOrder() (full gate stack) → TradersPost/broker.
// Requires LIVE_ORDER_HMAC_SECRET env var (≥32 chars). Fail-CLOSED 503 when unconfigured.
app.use("/api/live-order", liveOrderRoutes);

// Phase 1 Fill Reconciliation: broker fill callback + admin reconcile-clear.
// POST /api/broker/fill-callback — HMAC-gated; requires BROKER_FILL_HMAC_SECRET.
// deep-scan #13: mounted ABOVE the auth gate (see near authMiddleware) so external
// broker fill callbacks (own HMAC, no Bearer) are not 401'd by the API_KEY gate.
// Flag-gated: SERVER_MEDIATED_EXECUTION_ENABLED=true (default OFF).

// Wave 4 Track 4B: Layer 15 Leak Detection — ADVISORY-ONLY, no lifecycle gate authority.
// POST /api/leak-detection/run — called by 3AM orchestrator (Track 4A).
app.use("/api/leak-detection", leakDetectionRoutes);

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

export const server = app.listen(port, () => {
  logger.info(`Trading Forge running on http://localhost:${port}`);

  // deepscan7 D2 (2026-07-02): bootCorrelationId is now the SINGLE module-level id
  // minted before migrations (top of this file) — the local re-mint that used to
  // live here fragmented the boot trace. boot.completed closes the trace group.
  void insertAuditRowSafe({
    action: "boot.completed",
    entityType: "system",
    entityId: null,
    decisionAuthority: "system",
    input: {
      version: process.env.npm_package_version ?? "dev",
      node_env: process.env.NODE_ENV ?? null,
      port,
      pid: process.pid,
    } as Record<string, unknown>,
    result: { phase: "listening", uptime_seconds: Math.round(process.uptime()) } as Record<string, unknown>,
    status: "info",
    correlationId: bootCorrelationId,
  });

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
  // Phase 14 fix: only sweep rows that have been "running" for more than 60
  // minutes. A backtest created 60s before the server restarted is NOT an
  // orphan — its Python subprocess died with the parent process, but the row
  // is "freshly started", not a zombie from a prior crashed session.
  //
  // The old threshold was 10 minutes, which was shorter than actual walkforward
  // execution time under load (6 concurrent × 4 parallel workers). That caused
  // legitimate mid-run backtests to be swept on pm2 restart.
  //
  // True orphan = status='running' for more than 60 minutes. Anything younger
  // than 60 minutes is presumed to have been live when the server restarted —
  // it should be left for the operator to observe and manually retry if needed.
  //
  // The error message is intentionally different from a process crash message so
  // operators can distinguish "this row was abandoned too long" from "server died".
  import("./db/schema.js").then(async ({ backtests }) => {
    try {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const orphaned = await db
        .update(backtests)
        .set({ status: "failed", errorMessage: "Backtest exceeded 1h+ runtime; swept as orphan on server restart." })
        .where(and(eq(backtests.status, "running"), lt(backtests.createdAt, oneHourAgo)))
        .returning({ id: backtests.id });
      if (orphaned.length > 0) {
        logger.warn({ count: orphaned.length, ids: orphaned.map((r) => r.id) }, "Startup: cleaned up orphaned running backtests (> 1h old)");
      } else {
        logger.info("Startup: no orphaned running backtests found (all running rows < 1h old — left as-is)");
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

  // ─── Fix 2 (2026-06-29): Orphaned paper-position startup recovery ───────────
  // Covers a DIFFERENT failure mode from H2 above: positions OPEN in DB with NO
  // active session (session was stopped or server crashed between session end and
  // position close). Must run AFTER initializePositionStateMaps (H2) so HWM state
  // is restored before orphan detection, and BEFORE initScheduler so audit rows
  // are visible on the first scheduler pass. Fail-open: DB errors never block boot.
  import("./services/paper-execution-service.js").then(({ recoverOrphanedPositionsAtStartup }) => {
    recoverOrphanedPositionsAtStartup().then(({ orphansFound }) => {
      if (orphansFound > 0) {
        import("./services/notification-service.js").then(({ notifyCritical }) => {
          notifyCritical(
            `[CRITICAL] ${orphansFound} orphaned paper position(s) detected at startup`,
            `What happened: ${orphansFound} position(s) were open in the database with no active session when the server restarted.\nAuto-remediation attempted: yes — stuckSessionIds populated; blocked sessions prevent duplicate opens.\nWhy it failed: sessions were not active at restart; positions require manual review.\nYour action: Review audit_log for paper.orphaned_position_detected entries and close positions via the dashboard or call clearStuckSessionId() after confirming each is closed.`,
          );
        }).catch((notifyErr: unknown) => {
          logger.error({ err: notifyErr }, "Startup: notification-service import failed during orphan CRITICAL alert (non-blocking)");
        });
        // Write consolidated CRITICAL audit row (individual orphan rows already written
        // inside recoverOrphanedPositionsAtStartup).
        import("./db/schema.js").then(({ auditLog: auditLogTable }) => {
          void db.insert(auditLogTable).values({
            action: "paper.orphaned_positions_startup_critical",
            entityType: "paper_position",
            entityId: null,
            decisionAuthority: "system",
            input: { orphansFound } as Record<string, unknown>,
            result: { autoRemediationAttempted: true, stuckSessionIdsPopulated: true } as Record<string, unknown>,
            status: "error",
          }).catch((dbErr: unknown) => {
            logger.error({ err: dbErr }, "Startup: orphan CRITICAL audit row write failed (non-blocking)");
          });
        }).catch((schemaErr: unknown) => {
          logger.error({ err: schemaErr }, "Startup: db/schema import failed during orphan audit write (non-blocking)");
        });
      } else {
        logger.info("Startup: no orphaned paper positions detected");
      }
    }).catch((err: unknown) => {
      logger.error({ err }, "Startup: recoverOrphanedPositionsAtStartup failed (non-blocking — orphans will be re-detected on next open attempt)");
    });
  }).catch((err: unknown) => {
    logger.error({ err }, "startup-import-failed: paper-execution-service import failed during orphan recovery (non-blocking)");
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

  // ─── W26 Pass 4: Warm appendix cache before scheduler fires ─────────────────
  // Populates the module-level _appendixCache in model-router.ts from any active
  // prompt_versions rows. buildPromptSync() reads this cache synchronously — no
  // async in the hot path. Fail-open: cache starts empty if DB read fails.
  import("./services/model-router.js").then(({ warmAppendixCache, checkTranscriptExtractorOllamaHealth }) => {
    warmAppendixCache().catch((err) => {
      logger.info({ err }, "Appendix cache warm failed at boot — starting empty (non-blocking)");
    });
    // ─── Wave 26: Ollama health check for transcript_extractor gemma4:e4b-it-qat ─────
    // Sets OLLAMA_HEALTHY module flag. If Ollama is down or model is missing,
    // transcript_extractor routes to cloud fallback. Fail-open: any error is
    // swallowed here; the check itself logs WARN.
    checkTranscriptExtractorOllamaHealth().catch((err) => {
      logger.info({ err }, "Ollama health check failed at boot — transcript_extractor routing to cloud (non-blocking)");
    });
  }).catch((err) => {
    logger.info({ err }, "model-router import failed during appendix warm — non-blocking");
  });

  // ─── H5: 60s post-boot Ollama recheck ────────────────────────────────────────
  // The boot-time probe runs at T+0 when gemma4:e4b-it-qat (7GB) may still be cold-
  // loading into VRAM, leaving OLLAMA_HEALTHY stuck false and routing all
  // extraction to cloud. This one-shot re-probe fires after the cold-load
  // window and corrects the flag before the first extraction cron fires.
  setTimeout(() => {
    import("./services/model-router.js").then(({ recheckOllamaHealth }) => {
      recheckOllamaHealth().then((r) => {
        logger.info(
          { healthy: r.healthy, reason: r.reason },
          "model-router: 60s post-boot Ollama recheck complete",
        );
      }).catch((err: unknown) => {
        logger.warn({ err }, "model-router: 60s post-boot Ollama recheck threw");
      });
    }).catch((err: unknown) => {
      logger.warn({ err }, "model-router: 60s post-boot Ollama recheck import failed");
    });
  }, 60_000);

  // ─── Discord fanout audit boot probe (Pass 1 Track D) ────────────────────────
  // Probes all configured Discord webhooks so production-status.ts reads
  // "discord_webhook_health: healthy" instead of the false "not_configured"
  // that appears when this function is never called. Fire-and-forget: any
  // failure is logged as WARN but never blocks boot.
  import("./services/discord-fanout-audit-service.js").then(({ runDiscordFanoutAudit }) => {
    runDiscordFanoutAudit().catch((err) => {
      logger.warn({ err }, "discord_fanout_audit_boot_failed");
    });
  }).catch((err) => {
    logger.warn({ err }, "discord-fanout-audit import failed at boot (non-blocking)");
  });

  // ─── A14: Regime-bank self-heal (boot-time, fire-and-forget) ────────────────
  // Ensures the synthetic_regime_bank has rows so backtests run at ANY time
  // (not just after the weekly Sunday cron) get real B14 survival verdicts
  // instead of null. If bank is empty → triggers populate run async (20 min max).
  // If bank is populated → logs + emits skipped audit. Never blocks app.listen.
  // Governance: CHALLENGER-ONLY / ADVISORY — populate output is advisory only.
  import("./services/synthetic-regime-bank-service.js").then(({ ensureRegimeBankPopulated }) => {
    // deepscan7 D2 (2026-07-02): reuse the single boot id (was a second self-minted
    // `boot-${Date.now()}` that split the boot trace into two correlation groups).
    ensureRegimeBankPopulated(bootCorrelationId).catch((err: unknown) => {
      logger.warn({ err }, "synthetic_regime_bank: boot self-heal failed (non-blocking)");
    });
  }).catch((err: unknown) => {
    logger.warn({ err }, "synthetic-regime-bank-service import failed at boot (non-blocking)");
  });

  // Start scheduled jobs (rolling Sharpe, pre-market prep, drift checks).
  // TF_DISABLE_SCHEDULER=true runs an API-only instance with NO crons — for an isolated
  // second instance (e.g. extraction validation on a throwaway port) that must not
  // double-fire the primary tower's scheduled jobs.
  if (process.env.TF_DISABLE_SCHEDULER === "true") {
    logger.warn("TF_DISABLE_SCHEDULER=true — scheduler NOT started (crons run on the primary instance only)");
    initAgentCoordination();
  } else {
    import("./scheduler.js").then(({ initScheduler }) => {
      initScheduler(bootCorrelationId);
      logger.info({ correlationId: bootCorrelationId }, "Scheduler initialized");
      // Wire typed agent event bus AFTER scheduler so cross-domain handlers
      // can subscribe to lifecycle/risk/compliance/health events.
      initAgentCoordination();
    }).catch((err) => {
      logger.warn({ err }, "Scheduler failed to initialize — cron jobs disabled");
    });
  }

  // ─── Carter proactive issue watcher (Wave 4 backend, 2026-06-28) ────────────
  // PIPELINE-GATE EXEMPT: starts unconditionally — NOT gated behind isActive().
  // FAIL-SOFT: any startup error is caught here so it never crashes the API.
  import("./services/carter-issue-watcher.js").then(({ startCarterIssueWatcher }) => {
    startCarterIssueWatcher().catch((err: unknown) => {
      logger.warn({ err }, "carter-issue-watcher: startup failed (non-fatal — watcher disabled for this session)");
    });
  }).catch((err: unknown) => {
    logger.warn({ err }, "carter-issue-watcher: import failed at boot (non-fatal)");
  });

  // ─── Track 3 completion audit record (written once, idempotent guard) ────────
  // trading-forge-architect signed off Track 3 — Stop/TP/Sizing Framework as
  // complete. This is the canonical persistence record for that sign-off.
  // Guard: only write if no prior row with action="track_completed" AND
  //        result->>'track' = 'Track 3 — Stop/TP/Sizing Framework' exists.
  // Non-blocking: failure logs but never prevents server startup.
  import("./db/schema.js").then(async ({ auditLog: auditLogTable }) => {
    try {
      const { eq, and, sql: drizzleSql } = await import("drizzle-orm");
      const existing = await db
        .select({ id: auditLogTable.id })
        .from(auditLogTable)
        .where(
          and(
            eq(auditLogTable.action, "track_completed"),
            drizzleSql`${auditLogTable.result}->>'track' = 'Track 3 — Stop/TP/Sizing Framework'`,
          ),
        )
        .limit(1);
      if (existing.length === 0) {
        await db.insert(auditLogTable).values({
          action: "track_completed",
          entityType: "system",
          entityId: null,
          decisionAuthority: "gate",
          input: { signed_off_by: "trading-forge-architect", date: "2026-05-09" } as Record<string, unknown>,
          result: {
            track: "Track 3 — Stop/TP/Sizing Framework",
            subagents_dispatched: 4,
            files_changed: 12,
            tests_added: 105,
            integration_audits: 2,
            follow_ups: ["highSinceEntry/lowSinceEntry watermarks", "Track 2 developingSessionPoc"],
          } as Record<string, unknown>,
          status: "success",
          correlationId: bootCorrelationId,
        });
        logger.info("Track 3 completion audit_log row written (benchmark persistence)");
      } else {
        logger.debug("Track 3 completion audit_log row already exists — skipping duplicate write");
      }
    } catch (err) {
      logger.warn({ err }, "Track 3 completion audit_log write failed (non-blocking)");
    }
  }).catch((err) => {
    logger.warn({ err }, "Track 3 completion audit_log: schema import failed (non-blocking)");
  });

  // ─── Track 2 completion audit record (written once, idempotent guard) ────────
  // trading-forge-architect signed off Track 2 — Volume Profile EXPANDED as
  // complete on 2026-05-09 after closing four follow-up items: CLI smoke,
  // open-classification prior-session filter, naked_pocs source_date population,
  // and System Map sync. Same idempotency / non-blocking pattern as Track 3.
  import("./db/schema.js").then(async ({ auditLog: auditLogTable }) => {
    try {
      const { eq, and, sql: drizzleSql } = await import("drizzle-orm");
      const existing = await db
        .select({ id: auditLogTable.id })
        .from(auditLogTable)
        .where(
          and(
            eq(auditLogTable.action, "track_completed"),
            drizzleSql`${auditLogTable.result}->>'track' = 'Track 2 — Volume Profile EXPANDED'`,
          ),
        )
        .limit(1);
      if (existing.length === 0) {
        await db.insert(auditLogTable).values({
          action: "track_completed",
          entityType: "system",
          entityId: null,
          decisionAuthority: "gate",
          input: { signed_off_by: "trading-forge-architect", date: "2026-05-09" } as Record<string, unknown>,
          result: {
            track: "Track 2 — Volume Profile EXPANDED",
            subagents_dispatched: 2,
            files_changed: 18,
            tests_added: 101,
            integration_audits: 2,
            follow_ups_closed: ["Track 3 #1 developingSessionPoc"],
            fixes_in_audit: [
              "volume_profile CLI entrypoint",
              "open classification prior-session filter",
              "naked_pocs source_date population",
            ],
          } as Record<string, unknown>,
          status: "success",
          correlationId: bootCorrelationId,
        });
        logger.info("Track 2 completion audit_log row written (benchmark persistence)");
      } else {
        logger.debug("Track 2 completion audit_log row already exists — skipping duplicate write");
      }
    } catch (err) {
      logger.warn({ err }, "Track 2 completion audit_log write failed (non-blocking)");
    }
  }).catch((err) => {
    logger.warn({ err }, "Track 2 completion audit_log: schema import failed (non-blocking)");
  });

  // ─── Track 1 completion audit record (written once, idempotent guard) ────────
  // trading-forge-architect signed off Track 1 — NeMo Data Designer Integration
  // as complete on 2026-05-09. Phase 0 challenger_only: scenarios feed A14
  // advisory regimes; survival_rate is advisory; no promotion authority.
  // Same idempotency / non-blocking pattern as Tracks 2 and 3.
  import("./db/schema.js").then(async ({ auditLog: auditLogTable }) => {
    try {
      const { eq, and, sql: drizzleSql } = await import("drizzle-orm");
      const existing = await db
        .select({ id: auditLogTable.id })
        .from(auditLogTable)
        .where(
          and(
            eq(auditLogTable.action, "track_completed"),
            drizzleSql`${auditLogTable.result}->>'track' = 'Track 1 — NeMo Data Designer Integration'`,
          ),
        )
        .limit(1);
      if (existing.length === 0) {
        await db.insert(auditLogTable).values({
          action: "track_completed",
          entityType: "system",
          entityId: null,
          decisionAuthority: "gate",
          input: { signed_off_by: "trading-forge-architect", date: "2026-05-09" } as Record<string, unknown>,
          result: {
            track: "Track 1 — NeMo Data Designer Integration",
            subagents_dispatched: 1,
            files_changed: 13,
            tests_added: 35,
            integration_audits: 1,
            governance: "challenger_only Phase 0",
            follow_ups: [
              "LLM-conditioned upgrade path (NeMo nlp 7B model) deferred until template generation proves predictive value",
              "target_gap_profile passed through bridge but ignored by A14 SyntheticSimulatorConfig (Pydantic extra=ignore); A14 conditioning currently driven by regime_label/target_vol/target_trend only",
            ],
          } as Record<string, unknown>,
          status: "success",
          correlationId: bootCorrelationId,
        });
        logger.info("Track 1 completion audit_log row written (benchmark persistence)");
      } else {
        logger.debug("Track 1 completion audit_log row already exists — skipping duplicate write");
      }
    } catch (err) {
      logger.warn({ err }, "Track 1 completion audit_log write failed (non-blocking)");
    }
  }).catch((err) => {
    logger.warn({ err }, "Track 1 completion audit_log: schema import failed (non-blocking)");
  });

  // ─── Track 5 completion audit record (written once, idempotent guard) ────────
  // trading-forge-architect signed off Track 5 — Phase D Readiness Instrumentation
  // on 2026-05-09 after final cross-cutting integrity audit:
  //   - SHADOW writes verified zero-impact on compute_bias() return value
  //     (state constructed first, then fire-and-forget Popen, wrapped in try/except)
  //   - ROUTER_HASH verified reproducible (sha256 of file bytes computed once at
  //     module import; 16-char hex; deterministic across re-imports)
  //   - Hysteresis verified correct (HYSTERESIS_THRESHOLD=0.7, MIN_DWELL_MINUTES=60
  //     from env, no magic numbers; safety: NO_TRADE proposals always pass through)
  //   - Track 2 VP routing preserved (hysteresis layer wraps _compute_proposed_playbook
  //     which calls _route_vp_conditional unchanged)
  //   - 9th GPT-5-mini role registered (bias_engine_evaluator, 25k tokens/day,
  //     gemma4:e4b-it-qat fallback, anti-pattern-catalog KB + 4 few-shot examples)
  // Same idempotency / non-blocking pattern as Tracks 1, 2, and 3.
  import("./db/schema.js").then(async ({ auditLog: auditLogTable }) => {
    try {
      const { eq, and, sql: drizzleSql } = await import("drizzle-orm");
      const existing = await db
        .select({ id: auditLogTable.id })
        .from(auditLogTable)
        .where(
          and(
            eq(auditLogTable.action, "track_completed"),
            drizzleSql`${auditLogTable.result}->>'track' = 'Track 5 — Phase D Readiness Instrumentation'`,
          ),
        )
        .limit(1);
      if (existing.length === 0) {
        await db.insert(auditLogTable).values({
          action: "track_completed",
          entityType: "system",
          entityId: null,
          decisionAuthority: "gate",
          input: { signed_off_by: "trading-forge-architect", date: "2026-05-09" } as Record<string, unknown>,
          result: {
            track: "Track 5 — Phase D Readiness Instrumentation",
            subagents_dispatched: 1,
            files_changed: 18,
            tests_added: 37,
            integration_audits: 1,
            governance: "Phase 0 SHADOW (zero behavioral change)",
            next_phase: "Day 60 calibration testing → graduation decision",
            follow_ups: [],
          } as Record<string, unknown>,
          status: "success",
          correlationId: bootCorrelationId,
        });
        logger.info("Track 5 completion audit_log row written (benchmark persistence)");
      } else {
        logger.debug("Track 5 completion audit_log row already exists — skipping duplicate write");
      }
    } catch (err) {
      logger.warn({ err }, "Track 5 completion audit_log write failed (non-blocking)");
    }
  }).catch((err) => {
    logger.warn({ err }, "Track 5 completion audit_log: schema import failed (non-blocking)");
  });

  // ─── Pass 1 Wave 1 — Track 1 (Mini Safety Guard) audit record ────────────────
  // trading-forge-architect signed off Pass 1 / Track 1 — Mini Safety Guard on
  // 2026-05-10. Closes the ES/NQ/CL silent-failure trap in config.py by adding
  // contract_class field + pattern_library validation. Same idempotency pattern
  // as Tracks 1-5 above.
  import("./db/schema.js").then(async ({ auditLog: auditLogTable }) => {
    try {
      const { eq, and, sql: drizzleSql } = await import("drizzle-orm");
      const existing = await db
        .select({ id: auditLogTable.id })
        .from(auditLogTable)
        .where(
          and(
            eq(auditLogTable.action, "track_completed"),
            drizzleSql`${auditLogTable.result}->>'track' = 'Pass 1 Track 1 — Mini Safety Guard'`,
          ),
        )
        .limit(1);
      if (existing.length === 0) {
        await db.insert(auditLogTable).values({
          action: "track_completed",
          entityType: "system",
          entityId: null,
          decisionAuthority: "gate",
          input: { signed_off_by: "trading-forge-architect", date: "2026-05-10", pass: 1 } as Record<string, unknown>,
          result: {
            pass: 1,
            track: "Pass 1 Track 1 — Mini Safety Guard",
            files_changed: 4,
            files_created: 1,
            tests_added: 22,
            guard_closes: "ES/NQ/CL silent-failure trap in config.py",
            follow_ups: [],
          } as Record<string, unknown>,
          status: "success",
          correlationId: bootCorrelationId,
        });
        logger.info("Pass 1 Track 1 completion audit_log row written (benchmark persistence)");
      } else {
        logger.debug("Pass 1 Track 1 completion audit_log row already exists — skipping duplicate write");
      }
    } catch (err) {
      logger.warn({ err }, "Pass 1 Track 1 completion audit_log write failed (non-blocking)");
    }
  }).catch((err) => {
    logger.warn({ err }, "Pass 1 Track 1 completion audit_log: schema import failed (non-blocking)");
  });

  // ─── Pass 1 Wave 1 — Track 2 (Prop Firm Cleanup) audit record ────────────────
  // trading-forge-architect signed off Pass 1 / Track 2 — Prop Firm Cleanup
  // (MFFU + Topstep ONLY) on 2026-05-10. Removed 9 legacy firms across Python
  // engine + TS server + 5 test files; migration 0097 reversible DOWN; golden
  // fixture cleanup applied in Pass 1 closing audit. Same idempotency pattern.
  import("./db/schema.js").then(async ({ auditLog: auditLogTable }) => {
    try {
      const { eq, and, sql: drizzleSql } = await import("drizzle-orm");
      const existing = await db
        .select({ id: auditLogTable.id })
        .from(auditLogTable)
        .where(
          and(
            eq(auditLogTable.action, "track_completed"),
            drizzleSql`${auditLogTable.result}->>'track' = 'Pass 1 Track 2 — Prop Firm Cleanup (MFFU + Topstep ONLY)'`,
          ),
        )
        .limit(1);
      if (existing.length === 0) {
        await db.insert(auditLogTable).values({
          action: "track_completed",
          entityType: "system",
          entityId: null,
          decisionAuthority: "gate",
          input: { signed_off_by: "trading-forge-architect", date: "2026-05-10", pass: 1 } as Record<string, unknown>,
          result: {
            pass: 1,
            track: "Pass 1 Track 2 — Prop Firm Cleanup (MFFU + Topstep ONLY)",
            subagents: ["backtest-core (Python)", "paper-parity (TS)"],
            files_changed: 25,
            files_created: 1,
            tests_changed: 270,
            legacy_firms_removed: ["apex", "tradeify", "ffn", "alpha_futures", "tpt", "earn2trade", "fundingpips", "top_one", "yrm_prop"],
            migration: "0097 (reversible DOWN)",
            golden_fixture_cleanup: "fixed in Pass 1 closing audit",
          } as Record<string, unknown>,
          status: "success",
          correlationId: bootCorrelationId,
        });
        logger.info("Pass 1 Track 2 completion audit_log row written (benchmark persistence)");
      } else {
        logger.debug("Pass 1 Track 2 completion audit_log row already exists — skipping duplicate write");
      }
    } catch (err) {
      logger.warn({ err }, "Pass 1 Track 2 completion audit_log write failed (non-blocking)");
    }
  }).catch((err) => {
    logger.warn({ err }, "Pass 1 Track 2 completion audit_log: schema import failed (non-blocking)");
  });

  // ─── Pass 1 Wave 1 — Track 3 (2026 Rules Compliance Audit) audit record ──────
  // trading-forge-architect signed off Pass 1 / Track 3 — 2026 Rules Compliance
  // Audit on 2026-05-10. Two canonical docs (MFFU + Topstep), CI lint script,
  // 73 new compliance tests, defense-in-depth correlation pairs, 2026 fields
  // wired into firm_config.py + firm-config.ts. Same idempotency pattern.
  import("./db/schema.js").then(async ({ auditLog: auditLogTable }) => {
    try {
      const { eq, and, sql: drizzleSql } = await import("drizzle-orm");
      const existing = await db
        .select({ id: auditLogTable.id })
        .from(auditLogTable)
        .where(
          and(
            eq(auditLogTable.action, "track_completed"),
            drizzleSql`${auditLogTable.result}->>'track' = 'Pass 1 Track 3 — 2026 Rules Compliance Audit'`,
          ),
        )
        .limit(1);
      if (existing.length === 0) {
        await db.insert(auditLogTable).values({
          action: "track_completed",
          entityType: "system",
          entityId: null,
          decisionAuthority: "gate",
          input: { signed_off_by: "trading-forge-architect", date: "2026-05-10", pass: 1 } as Record<string, unknown>,
          result: {
            pass: 1,
            track: "Pass 1 Track 3 — 2026 Rules Compliance Audit",
            files_created: 5,
            tests_added: 73,
            rules_enforced: { mffu: 9, topstep: 7 },
            defense_in_depth: ["correlation pairs MES↔ES, MNQ↔NQ, MCL↔CL"],
            ci_lint: "scripts/verify-2026-rules-compliance.mjs",
          } as Record<string, unknown>,
          status: "success",
          correlationId: bootCorrelationId,
        });
        logger.info("Pass 1 Track 3 completion audit_log row written (benchmark persistence)");
      } else {
        logger.debug("Pass 1 Track 3 completion audit_log row already exists — skipping duplicate write");
      }
    } catch (err) {
      logger.warn({ err }, "Pass 1 Track 3 completion audit_log write failed (non-blocking)");
    }
  }).catch((err) => {
    logger.warn({ err }, "Pass 1 Track 3 completion audit_log: schema import failed (non-blocking)");
  });

  // ─── Track 4 completion audit record (written once, idempotent guard) ────────
  // trading-forge-architect signed off Track 4 — Production Hardening on
  // 2026-05-09 after final cross-cutting integrity audit:
  //   - Production isolation lint CLEAN (4 files, 0 violations)
  //   - killSwitch.isHaltedForProduction() is FIRST gate in openPosition() (paper-execution-service.ts:549, fail-CLOSED)
  //   - Auto-HALT on drift severity=red wired (drift-detector.ts → killSwitch.setMode('HALT'))
  //   - forceCloseAllPositions wired via static import in paper-signal-service.ts, awaited with notifyCritical on failure
  //   - All 4 reconciliation source comparisons present; fail-CLOSED on any data fetch error
  //   - 2 new crons in scheduler: daily-reconciliation (4:15 PM ET), weekly-drift-detection
  //     (Sunday 6 PM ET); both bypass pipelineGate (safety signals)
  // Phases: 4A foundation, 4B reconciliation+drift, 4C kill switch wiring.
  import("./db/schema.js").then(async ({ auditLog: auditLogTable }) => {
    try {
      const { eq, and, sql: drizzleSql } = await import("drizzle-orm");
      const existing = await db
        .select({ id: auditLogTable.id })
        .from(auditLogTable)
        .where(
          and(
            eq(auditLogTable.action, "track_completed"),
            drizzleSql`${auditLogTable.result}->>'track' = 'Track 4 — Production Hardening'`,
          ),
        )
        .limit(1);
      if (existing.length === 0) {
        await db.insert(auditLogTable).values({
          action: "track_completed",
          entityType: "system",
          entityId: null,
          decisionAuthority: "gate",
          input: { signed_off_by: "trading-forge-architect", date: "2026-05-09" } as Record<string, unknown>,
          result: {
            track: "Track 4 — Production Hardening",
            subagents_dispatched: 3,
            phases: ["4A foundation", "4B reconciliation+drift", "4C kill switch wiring"],
            files_changed: 22,
            tests_added: 74,
            integration_audits: 1,
            isolation_enforcement: "CI lint via scripts/check-production-isolation.mjs",
            follow_ups_closed: 0,
            follow_ups_deferred: 2,
            follow_ups_deferred_detail: [
              "forceCloseAllPositions uses entryPrice as exit proxy — acceptable for emergency path (conservative zero-PnL on force-flatten; operator manual review post-halt)",
              "kill-switch layers 2 (daily_loss) + 3 (trailing_drawdown) report phase_4c_pending in getKillSwitchStatus() — status panel is DISPLAY-only; actual DLL gate is enforced inline in openPosition() per-session at paper-execution-service.ts:781+ (live and blocking). Cross-session aggregation for top-level display deferred until multi-session production promotion.",
            ],
          } as Record<string, unknown>,
          status: "success",
          correlationId: bootCorrelationId,
        });
        logger.info("Track 4 completion audit_log row written (benchmark persistence)");
      } else {
        logger.debug("Track 4 completion audit_log row already exists — skipping duplicate write");
      }
    } catch (err) {
      logger.warn({ err }, "Track 4 completion audit_log write failed (non-blocking)");
    }
  }).catch((err) => {
    logger.warn({ err }, "Track 4 completion audit_log: schema import failed (non-blocking)");
  });

  // ─── Pass 2 Track 4 (Broker Abstraction Layer) audit record ─────────────────
  // trading-forge-architect signed off Pass 2 / Track 4 — Broker Abstraction Layer
  // on 2026-05-10. broker-router service, broker_accounts table (migration 0098),
  // instance_config singleton (migration 0099), TradersPost active path + TopstepX
  // deferred stub. Same idempotency pattern as Pass 1 tracks above.
  import("./db/schema.js").then(async ({ auditLog: auditLogTable }) => {
    try {
      const { eq, and, sql: drizzleSql } = await import("drizzle-orm");
      const existing = await db
        .select({ id: auditLogTable.id })
        .from(auditLogTable)
        .where(
          and(
            eq(auditLogTable.action, "track_completed"),
            drizzleSql`${auditLogTable.result}->>'track' = 'Pass 2 Track 4 — Broker Abstraction Layer'`,
          ),
        )
        .limit(1);
      if (existing.length === 0) {
        await db.insert(auditLogTable).values({
          action: "track_completed",
          entityType: "system",
          entityId: null,
          decisionAuthority: "gate",
          input: { signed_off_by: "trading-forge-architect", date: "2026-05-10", pass: 2 } as Record<string, unknown>,
          result: {
            pass: 2,
            track: "Pass 2 Track 4 — Broker Abstraction Layer",
            tests_added: 8,
            migrations: ["0098_broker_accounts", "0099_instance_config"],
            broker_paths: { traderspost: "active", topstepx: "deferred_stub" },
            fail_closed_reasons: [
              "account_not_found",
              "unknown_broker_type",
              "credential_load_error",
              "pipeline_paused",
              "topstepx_not_configured",
            ],
            sse_event: "broker:order_routed",
            follow_ups: [
              "instance_config.enabled_firms not yet read by strategy-assignment-service (hardcoded ['mffu','topstep'])",
            ],
          } as Record<string, unknown>,
          status: "success",
          correlationId: bootCorrelationId,
        });
        logger.info("Pass 2 Track 4 completion audit_log row written (benchmark persistence)");
      }
    } catch (err) {
      logger.warn({ err }, "Pass 2 Track 4 completion audit_log write failed (non-blocking)");
    }
  }).catch((err) => {
    logger.warn({ err }, "Pass 2 Track 4 completion audit_log: schema import failed (non-blocking)");
  });

  // ─── Pass 2 Track 5 (Strategy Selection UI) audit record ────────────────────
  import("./db/schema.js").then(async ({ auditLog: auditLogTable }) => {
    try {
      const { eq, and, sql: drizzleSql } = await import("drizzle-orm");
      const existing = await db
        .select({ id: auditLogTable.id })
        .from(auditLogTable)
        .where(
          and(
            eq(auditLogTable.action, "track_completed"),
            drizzleSql`${auditLogTable.result}->>'track' = 'Pass 2 Track 5 — Strategy Selection UI'`,
          ),
        )
        .limit(1);
      if (existing.length === 0) {
        await db.insert(auditLogTable).values({
          action: "track_completed",
          entityType: "system",
          entityId: null,
          decisionAuthority: "gate",
          input: { signed_off_by: "trading-forge-architect", date: "2026-05-10", pass: 2 } as Record<string, unknown>,
          result: {
            pass: 2,
            track: "Pass 2 Track 5 — Strategy Selection UI",
            tests_added: 12,
            migrations: ["0100_account_strategy_assignments"],
            collab_trading_rule: "mffu_no_collaborative_trading (warning, not block)",
            topstep_exception: "multi-account same-strategy explicitly allowed",
            sse_events: [
              "strategy:assigned",
              "strategy:unassigned",
              "strategy:released_to_family",
              "strategy:retracted_from_family",
              "strategy:assignment_collision",
              "compliance:collaborative_trading_warning",
            ],
            pipeline_pause_guarded: true,
            follow_ups: ["enabled_firms read from instance_config not yet wired"],
          } as Record<string, unknown>,
          status: "success",
          correlationId: bootCorrelationId,
        });
        logger.info("Pass 2 Track 5 completion audit_log row written (benchmark persistence)");
      }
    } catch (err) {
      logger.warn({ err }, "Pass 2 Track 5 completion audit_log write failed (non-blocking)");
    }
  }).catch((err) => {
    logger.warn({ err }, "Pass 2 Track 5 completion audit_log: schema import failed (non-blocking)");
  });

  // ─── Pass 2 Track 6 (Per-Recipient Pine Export) audit record ────────────────
  import("./db/schema.js").then(async ({ auditLog: auditLogTable }) => {
    try {
      const { eq, and, sql: drizzleSql } = await import("drizzle-orm");
      const existing = await db
        .select({ id: auditLogTable.id })
        .from(auditLogTable)
        .where(
          and(
            eq(auditLogTable.action, "track_completed"),
            drizzleSql`${auditLogTable.result}->>'track' = 'Pass 2 Track 6 — Per-Recipient Pine Export'`,
          ),
        )
        .limit(1);
      if (existing.length === 0) {
        await db.insert(auditLogTable).values({
          action: "track_completed",
          entityType: "system",
          entityId: null,
          decisionAuthority: "gate",
          input: { signed_off_by: "trading-forge-architect", date: "2026-05-10", pass: 2 } as Record<string, unknown>,
          result: {
            pass: 2,
            track: "Pass 2 Track 6 — Per-Recipient Pine Export",
            tests_added: 6,
            migrations: ["0100b_assignment_hmac_secret"],
            pine_compiler_extensions: ["recipient_qty", "recipient_label", "hmac_secret"],
            broker_routing: { traderspost: "webhook_json", topstepx: "pine_comment_stub" },
            idempotency: "(strategy_id, account_id) → reused hmac_secret + deterministic artifact hash",
            pipeline_pause_guarded: true,
            follow_ups: [
              "Track 8 marker collection (Pass 3) consumes embedded HMAC secret for inbound alert validation",
            ],
          } as Record<string, unknown>,
          status: "success",
          correlationId: bootCorrelationId,
        });
        logger.info("Pass 2 Track 6 completion audit_log row written (benchmark persistence)");
      }
    } catch (err) {
      logger.warn({ err }, "Pass 2 Track 6 completion audit_log write failed (non-blocking)");
    }
  }).catch((err) => {
    logger.warn({ err }, "Pass 2 Track 6 completion audit_log: schema import failed (non-blocking)");
  });

  // ─── Pass 3 Track 7 (Operator-Absent Autopilot Hardening) audit record ──────
  import("./db/schema.js").then(async ({ auditLog: auditLogTable }) => {
    try {
      const { eq, and, sql: drizzleSql } = await import("drizzle-orm");
      const existing = await db
        .select({ id: auditLogTable.id })
        .from(auditLogTable)
        .where(
          and(
            eq(auditLogTable.action, "track_completed"),
            drizzleSql`${auditLogTable.result}->>'track' = 'Pass 3 Track 7 — Operator-Absent Autopilot Hardening'`,
          ),
        )
        .limit(1);
      if (existing.length === 0) {
        await db.insert(auditLogTable).values({
          action: "track_completed",
          entityType: "system",
          entityId: null,
          decisionAuthority: "gate",
          input: { signed_off_by: "trading-forge-architect", date: "2026-05-10", pass: 3 } as Record<string, unknown>,
          result: {
            pass: 3,
            track: "Pass 3 Track 7 — Operator-Absent Autopilot Hardening",
            tests_added: 42,
            services: 6,
            crons: 4,
            migrations: ["0101_autopilot_tables"],
            tables: ["operator_absent_periods", "system_health_heartbeat"],
            sse_events: ["lifecycle:operator_absent_autopromoted"],
            tier1_only: true,
            pipeline_pause_guarded: true,
          } as Record<string, unknown>,
          status: "success",
          correlationId: bootCorrelationId,
        });
        logger.info("Pass 3 Track 7 completion audit_log row written (benchmark persistence)");
      }
    } catch (err) {
      logger.warn({ err }, "Pass 3 Track 7 completion audit_log write failed (non-blocking)");
    }
  }).catch((err) => {
    logger.warn({ err }, "Pass 3 Track 7 completion audit_log: schema import failed (non-blocking)");
  });

  // ─── Pass 3 Track 8 (TradingView Marker Collector + 5-Source Reconciliation) ──
  import("./db/schema.js").then(async ({ auditLog: auditLogTable }) => {
    try {
      const { eq, and, sql: drizzleSql } = await import("drizzle-orm");
      const existing = await db
        .select({ id: auditLogTable.id })
        .from(auditLogTable)
        .where(
          and(
            eq(auditLogTable.action, "track_completed"),
            drizzleSql`${auditLogTable.result}->>'track' = 'Pass 3 Track 8 — TradingView Marker Collector + 5-Source Reconciliation'`,
          ),
        )
        .limit(1);
      if (existing.length === 0) {
        await db.insert(auditLogTable).values({
          action: "track_completed",
          entityType: "system",
          entityId: null,
          decisionAuthority: "gate",
          input: { signed_off_by: "trading-forge-architect", date: "2026-05-10", pass: 3 } as Record<string, unknown>,
          result: {
            pass: 3,
            track: "Pass 3 Track 8 — TradingView Marker Collector + 5-Source Reconciliation",
            tests_added: 28,
            migrations: ["0102_tradingview_markers"],
            tables: ["tradingview_markers"],
            routes: ["/api/tradingview"],
            sse_events: ["tradingview:marker-received"],
            reconciliation_sources: 5,
            hmac_validation: "account_strategy_assignments.hmac_secret",
            extends_pass_2_4_source: true,
            pipeline_pause_guarded: true,
          } as Record<string, unknown>,
          status: "success",
          correlationId: bootCorrelationId,
        });
        logger.info("Pass 3 Track 8 completion audit_log row written (benchmark persistence)");
      }
    } catch (err) {
      logger.warn({ err }, "Pass 3 Track 8 completion audit_log write failed (non-blocking)");
    }
  }).catch((err) => {
    logger.warn({ err }, "Pass 3 Track 8 completion audit_log: schema import failed (non-blocking)");
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
