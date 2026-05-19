import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import postgres from "postgres";
import { config as loadDotenv } from "dotenv";
import {
  collectSystemTopology,
  buildStaticReadinessReport,
  type StaticReadinessReport,
  type SystemTopologySnapshot,
  type RegistrySubsystemSummary,
} from "../src/server/lib/system-topology.js";

type Severity = "critical" | "high" | "medium" | "low";
type Lane = "static" | "runtime" | "evidence" | "map";

interface CheckResult {
  ok: boolean;
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}

interface Finding {
  id: string;
  lane: Lane;
  severity: Severity;
  subsystem: string;
  title: string;
  detail: string;
  reproduction?: string;
  remediation?: string;
}

interface RuntimeProbe {
  apiHealth: { ok: boolean; status?: number; error?: string };
  apiHealthDashboard: { ok: boolean; status?: number; error?: string };
  n8nWorkflows: {
    ok: boolean;
    skipped?: boolean;
    activeCount?: number;
    inactiveCount?: number;
    archivedCount?: number;
    lastUpdated?: string | null;
    error?: string;
  };
}

interface TableFreshness {
  table: string;
  exists: boolean;
  rows: number;
  latestAt: string | null;
  ageHours: number | null;
  error?: string;
}

interface DeepScanReport {
  generatedAt: string;
  status: "pass" | "fail";
  scope: string;
  lanes: {
    static: CheckResult[];
    runtime: RuntimeProbe;
    map: {
      topologyStatus: "ready" | "blocked";
      readinessStatus: "ready" | "blocked";
      blockers: string[];
    };
  };
  findings: Finding[];
  summary: {
    totalFindings: number;
    bySeverity: Record<Severity, number>;
    byLane: Record<Lane, number>;
    unresolvedCriticalHigh: number;
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

const DEFAULT_DATABASE_URL = "postgres://postgres:postgres@localhost:5432/trading_forge";
const DEFAULT_API_KEY = "repo-readiness-api-key";
const DEFAULT_N8N_BASE_URL = "http://localhost:5678";
const DEFAULT_N8N_API_KEY = "repo-readiness-n8n-api-key";
const DEFAULT_OTEL_ENDPOINT = "http://localhost:4318/v1/traces";

async function loadEnvironment(rootDir: string): Promise<void> {
  const dotEnvPath = path.join(rootDir, ".env");
  const dotEnvLocalPath = path.join(rootDir, ".env.local");
  if (await fileExists(dotEnvPath)) loadDotenv({ path: dotEnvPath, override: true });
  if (await fileExists(dotEnvLocalPath)) loadDotenv({ path: dotEnvLocalPath, override: true });
}

function ensurePreprodReadinessEnv(): void {
  process.env.TF_RUNTIME_STAGE ??= "preprod";
  process.env.DATABASE_URL ??= DEFAULT_DATABASE_URL;
  process.env.API_KEY ??= DEFAULT_API_KEY;
  process.env.N8N_BASE_URL ??= DEFAULT_N8N_BASE_URL;
  process.env.N8N_API_KEY ??= DEFAULT_N8N_API_KEY;
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT ??= DEFAULT_OTEL_ENDPOINT;
}

function toHoursAge(iso: string | null): number | null {
  if (!iso) return null;
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return null;
  return (Date.now() - ts) / 3_600_000;
}

function hasRecentFailure(lastFailureAt: string | null | undefined, thresholdHours = 24): boolean {
  const ageHours = toHoursAge(lastFailureAt ?? null);
  return ageHours != null && ageHours <= thresholdHours;
}

function commandForPlatform(command: string): { cmd: string; args: string[] } {
  if (process.platform === "win32") return { cmd: "cmd", args: ["/c", command] };
  return { cmd: "sh", args: ["-lc", command] };
}

async function runCommand(command: string, cwd: string, timeoutMs = 180_000): Promise<CheckResult> {
  const start = Date.now();
  const { cmd, args } = commandForPlatform(command);
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, {
      cwd,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGTERM");
    }, timeoutMs);

    proc.stdout.on("data", (buf: Buffer) => {
      stdout += buf.toString();
    });
    proc.stderr.on("data", (buf: Buffer) => {
      stderr += buf.toString();
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) stderr += `\nTimed out after ${timeoutMs}ms`;
      resolve({
        ok: !timedOut && code === 0,
        command,
        exitCode: code,
        stdout,
        stderr,
        durationMs: Date.now() - start,
      });
    });
    proc.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        command,
        exitCode: -1,
        stdout,
        stderr: `${stderr}\n${err.message}`.trim(),
        durationMs: Date.now() - start,
      });
    });
  });
}

async function probeJson(url: string, headers: Record<string, string> = {}): Promise<{ ok: boolean; status?: number; body?: unknown; error?: string }> {
  try {
    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(5_000),
    });
    const status = res.status;
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = undefined;
    }
    return { ok: res.ok, status, body, error: res.ok ? undefined : `HTTP ${status}` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function probeRuntime(): Promise<RuntimeProbe> {
  const apiBase = process.env.TF_API_BASE_URL ?? "http://127.0.0.1:4000";
  const apiKey = process.env.API_KEY;
  const apiHeaders: Record<string, string> = {};
  if (apiKey) apiHeaders.authorization = `Bearer ${apiKey}`;

  const [health, dashboard] = await Promise.all([
    probeJson(`${apiBase}/api/health`, apiHeaders),
    probeJson(`${apiBase}/api/health/dashboard`, apiHeaders),
  ]);

  const n8nBase = process.env.N8N_BASE_URL;
  const n8nKey = process.env.N8N_API_KEY;
  const hasN8nConfig = Boolean(n8nBase && n8nKey && n8nKey !== DEFAULT_N8N_API_KEY);
  if (!hasN8nConfig) {
    return {
      apiHealth: { ok: health.ok, status: health.status, error: health.error },
      apiHealthDashboard: { ok: dashboard.ok, status: dashboard.status, error: dashboard.error },
      n8nWorkflows: { ok: false, skipped: true, error: "N8N workflow probe skipped: N8N_BASE_URL/N8N_API_KEY not configured." },
    };
  }

  const wf = await probeJson(`${n8nBase}/api/v1/workflows?limit=250`, {
    "X-N8N-API-KEY": n8nKey,
    "Content-Type": "application/json",
  });
  if (!wf.ok) {
    const authError = wf.status === 401 || wf.status === 403;
    return {
      apiHealth: { ok: health.ok, status: health.status, error: health.error },
      apiHealthDashboard: { ok: dashboard.ok, status: dashboard.status, error: dashboard.error },
      n8nWorkflows: {
        ok: false,
        skipped: authError,
        error: authError
          ? "N8N workflow probe skipped: credentials rejected by n8n API."
          : (wf.error ?? "n8n workflows probe failed"),
      },
    };
  }

  const rows = Array.isArray((wf.body as { data?: unknown[] } | undefined)?.data)
    ? ((wf.body as { data?: Array<{ active?: boolean; isArchived?: boolean; updatedAt?: string }> }).data ?? [])
    : [];
  const activeCount = rows.filter((row) => row.active && !row.isArchived).length;
  const archivedCount = rows.filter((row) => row.isArchived).length;
  const inactiveCount = rows.length - activeCount - archivedCount;
  const lastUpdated = rows
    .map((row) => row.updatedAt ?? null)
    .filter((val): val is string => Boolean(val))
    .sort()
    .at(-1) ?? null;

  return {
    apiHealth: { ok: health.ok, status: health.status, error: health.error },
    apiHealthDashboard: { ok: dashboard.ok, status: dashboard.status, error: dashboard.error },
    n8nWorkflows: { ok: true, activeCount, inactiveCount, archivedCount, lastUpdated },
  };
}

async function loadJson<T>(filePath: string): Promise<T> {
  const content = await readFile(filePath, "utf8");
  return JSON.parse(content) as T;
}

async function getTableFreshness(client: postgres.Sql, table: string): Promise<TableFreshness> {
  try {
    const existsRows = await client<{ exists: string }[]>`
      SELECT to_regclass(${`public.${table}`})::text AS exists
    `;
    const exists = Boolean(existsRows[0]?.exists);
    if (!exists) {
      return { table, exists: false, rows: 0, latestAt: null, ageHours: null, error: "table missing" };
    }

    const rowCountRows = await client.unsafe<{ count: string }[]>(`SELECT COUNT(*)::text AS count FROM "${table}"`);
    const rows = Number.parseInt(rowCountRows[0]?.count ?? "0", 10);

    const columnRows = await client<{ column_name: string }[]>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ${table}
    `;
    const columns = new Set(columnRows.map((row) => row.column_name));
    const candidates = ["created_at", "updated_at", "retrieved_at", "last_checked_at", "generated_at", "forecast_date", "trained_at", "createdAt", "updatedAt"];
    const usable = candidates.filter((name) => columns.has(name));

    if (rows === 0 || usable.length === 0) {
      return { table, exists: true, rows, latestAt: null, ageHours: null };
    }

    const expr = usable.map((name) => `MAX("${name}")`).join(", ");
    const latestRows = await client.unsafe<Record<string, string | null>[]>(
      `SELECT GREATEST(${expr})::timestamptz AS latest FROM "${table}"`,
    );
    const latestAt = latestRows[0]?.latest ?? null;
    return {
      table,
      exists: true,
      rows,
      latestAt,
      ageHours: toHoursAge(latestAt),
    };
  } catch (error) {
    return {
      table,
      exists: false,
      rows: 0,
      latestAt: null,
      ageHours: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function addFinding(findings: Finding[], finding: Finding): void {
  findings.push(finding);
}

function isCriticalOrHigh(severity: Severity): boolean {
  return severity === "critical" || severity === "high";
}

function summarizeFindings(findings: Finding[]): DeepScanReport["summary"] {
  const bySeverity: Record<Severity, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
  };
  const byLane: Record<Lane, number> = {
    static: 0,
    runtime: 0,
    evidence: 0,
    map: 0,
  };
  for (const finding of findings) {
    bySeverity[finding.severity] += 1;
    byLane[finding.lane] += 1;
  }
  return {
    totalFindings: findings.length,
    bySeverity,
    byLane,
    unresolvedCriticalHigh: findings.filter((finding) => isCriticalOrHigh(finding.severity)).length,
  };
}

function markdownReport(report: DeepScanReport): string {
  const lines: string[] = [];
  lines.push(`# Trading Forge Deep Scan Report`);
  lines.push("");
  lines.push(`- Generated at: \`${report.generatedAt}\``);
  lines.push(`- Scope: \`${report.scope}\``);
  lines.push(`- Status: \`${report.status}\``);
  lines.push("");
  lines.push(`## Summary`);
  lines.push(`- Total findings: \`${report.summary.totalFindings}\``);
  lines.push(`- Critical: \`${report.summary.bySeverity.critical}\``);
  lines.push(`- High: \`${report.summary.bySeverity.high}\``);
  lines.push(`- Medium: \`${report.summary.bySeverity.medium}\``);
  lines.push(`- Low: \`${report.summary.bySeverity.low}\``);
  lines.push(`- Unresolved critical/high: \`${report.summary.unresolvedCriticalHigh}\``);
  lines.push("");
  lines.push(`## Static Lane`);
  for (const check of report.lanes.static) {
    lines.push(`- \`${check.command}\`: \`${check.ok ? "ok" : "fail"}\` (${check.durationMs}ms)`);
  }
  lines.push("");
  lines.push(`## Runtime Lane`);
  lines.push(`- /api/health: \`${report.lanes.runtime.apiHealth.ok ? "ok" : "fail"}\`${report.lanes.runtime.apiHealth.status ? ` (HTTP ${report.lanes.runtime.apiHealth.status})` : ""}`);
  lines.push(`- /api/health/dashboard: \`${report.lanes.runtime.apiHealthDashboard.ok ? "ok" : "fail"}\`${report.lanes.runtime.apiHealthDashboard.status ? ` (HTTP ${report.lanes.runtime.apiHealthDashboard.status})` : ""}`);
  lines.push(`- n8n workflows probe: \`${report.lanes.runtime.n8nWorkflows.ok ? "ok" : "fail"}\`${report.lanes.runtime.n8nWorkflows.lastUpdated ? ` (lastUpdated=${report.lanes.runtime.n8nWorkflows.lastUpdated})` : ""}`);
  lines.push("");
  lines.push(`## Map Lane`);
  lines.push(`- Topology status: \`${report.lanes.map.topologyStatus}\``);
  lines.push(`- Readiness status: \`${report.lanes.map.readinessStatus}\``);
  lines.push(`- Blockers: \`${report.lanes.map.blockers.length}\``);
  lines.push("");
  lines.push(`## Findings`);
  if (report.findings.length === 0) {
    lines.push(`- None`);
  } else {
    for (const finding of report.findings) {
      lines.push(`- [${finding.severity.toUpperCase()}][${finding.lane}] \`${finding.subsystem}\` ${finding.title}`);
      lines.push(`  - Detail: ${finding.detail}`);
      if (finding.reproduction) lines.push(`  - Repro: \`${finding.reproduction}\``);
      if (finding.remediation) lines.push(`  - Remediation: ${finding.remediation}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

function extractTableFromEvidence(evidence: string, knownTables: Set<string>): string | null {
  const match = evidence.match(/^([a-zA-Z0-9_]+):/);
  if (!match) return null;
  const candidate = match[1] ?? null;
  if (!candidate) return null;
  return knownTables.has(candidate) ? candidate : null;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function routeEvidenceCovered(registeredRoutes: string[], evidenceRoute: string): boolean {
  if (registeredRoutes.includes(evidenceRoute)) return true;
  return registeredRoutes.some((base) => evidenceRoute.startsWith(`${base}/`));
}

function splitWorkflowEvidenceBlockers(blockers: string[]): { unknownEvidence: string[]; remaining: string[] } {
  const unknownEvidence = blockers.filter((item) => item.startsWith("workflow-missing-evidence:"));
  const remaining = blockers.filter((item) => !item.startsWith("workflow-missing-evidence:"));
  return { unknownEvidence, remaining };
}

function expectedEvidenceFreshnessHours(evidence: string): number {
  if (evidence.includes("recent-entry")) return 24;
  if (evidence.includes("recent-run")) return 24;
  if (evidence.includes("recent-update")) return 24;
  return 72;
}

async function run(): Promise<number> {
  const rootDir = process.cwd();
  await loadEnvironment(rootDir);
  ensurePreprodReadinessEnv();
  const generatedAt = nowIso();
  const findings: Finding[] = [];

  const staticCommands = [
    "npx tsc --noEmit",
    "npm run lint",
    "python -m compileall -q src/engine",
    "npm run system-map:check",
  ];

  const staticResults: CheckResult[] = [];
  for (const command of staticCommands) {
    const result = await runCommand(command, rootDir);
    staticResults.push(result);
    if (!result.ok) {
      addFinding(findings, {
        id: `static-${command}`,
        lane: "static",
        severity: "critical",
        subsystem: "global",
        title: "Static gate failed",
        detail: `${command} failed with exit code ${result.exitCode}`,
        reproduction: command,
        remediation: "Fix compile/lint/system-map failures before runtime hardening.",
      });
    }
  }

  const snapshot: SystemTopologySnapshot = await collectSystemTopology(rootDir);
  const readiness: StaticReadinessReport = buildStaticReadinessReport(snapshot);

  const convergenceBlockers = snapshot.registryCoverage.productionConvergence.blockers;
  const { unknownEvidence: convergenceUnknownEvidence, remaining: convergenceRemaining } =
    splitWorkflowEvidenceBlockers(convergenceBlockers);
  const convergenceBlockedByUnknownEvidenceOnly =
    convergenceUnknownEvidence.length > 0 && convergenceRemaining.length === 0;

  if (snapshot.registryCoverage.productionConvergence.status === "blocked" && !convergenceBlockedByUnknownEvidenceOnly) {
    addFinding(findings, {
      id: "map-production-convergence",
      lane: "map",
      severity: "critical",
      subsystem: "workflow_orchestration",
      title: "Production convergence is blocked",
      detail: snapshot.registryCoverage.productionConvergence.blockers.join(", "),
      reproduction: "npm run system-map:check",
      remediation: "Resolve production convergence blockers and rerun deep scan.",
    });
  }

  if (readiness.overallStatus === "blocked" && !convergenceBlockedByUnknownEvidenceOnly) {
    addFinding(findings, {
      id: "map-readiness-blocked",
      lane: "map",
      severity: "high",
      subsystem: "global",
      title: "Readiness report is blocked",
      detail: readiness.blockers.join(", "),
      reproduction: "npm run system-map:check",
      remediation: "Clear readiness blockers from subsystem required evidence.",
    });
  }

  const runtime = await probeRuntime();
  if (!runtime.apiHealth.ok) {
    addFinding(findings, {
      id: "runtime-api-health",
      lane: "runtime",
      severity: "high",
      subsystem: "observability_reliability",
      title: "Runtime /api/health probe failed",
      detail: runtime.apiHealth.error ?? "health endpoint unavailable",
      reproduction: "curl http://127.0.0.1:4000/api/health",
      remediation: "Start API service and verify health route/auth wiring.",
    });
  }
  if (!runtime.apiHealthDashboard.ok) {
    addFinding(findings, {
      id: "runtime-api-health-dashboard",
      lane: "runtime",
      severity: "high",
      subsystem: "observability_reliability",
      title: "Runtime /api/health/dashboard probe failed",
      detail: runtime.apiHealthDashboard.error ?? "health dashboard endpoint unavailable",
      reproduction: "curl http://127.0.0.1:4000/api/health/dashboard",
      remediation: "Start API service and ensure scheduler/topology dependencies are healthy.",
    });
  }
  if (!runtime.n8nWorkflows.ok && !runtime.n8nWorkflows.skipped) {
    addFinding(findings, {
      id: "runtime-n8n-workflows",
      lane: "runtime",
      severity: "high",
      subsystem: "workflow_orchestration",
      title: "n8n workflow runtime probe failed",
      detail: runtime.n8nWorkflows.error ?? "n8n workflows endpoint unavailable",
      reproduction: "curl $N8N_BASE_URL/api/v1/workflows?limit=250",
      remediation: "Ensure n8n is reachable and N8N_API_KEY is configured.",
    });
  }
  if (!runtime.n8nWorkflows.ok && runtime.n8nWorkflows.skipped) {
    addFinding(findings, {
      id: "runtime-n8n-workflows-skipped",
      lane: "runtime",
      severity: "medium",
      subsystem: "workflow_orchestration",
      title: "n8n workflow runtime probe skipped",
      detail: runtime.n8nWorkflows.error ?? "n8n settings are not configured for live probe",
      remediation: "Set N8N_BASE_URL and N8N_API_KEY to enable live n8n evidence validation.",
    });
  }

  const unknownWorkflows = snapshot.workflowSummary.items.filter((item) => item.state === "production-active" && item.healthStatus === "unknown");
  const unresolvedUnknownWorkflows = unknownWorkflows.filter((item) =>
    hasRecentFailure(item.lastFailureAt, 24) || (item.failureCount ?? 0) >= 3,
  );
  if (unresolvedUnknownWorkflows.length > 0) {
    addFinding(findings, {
      id: "runtime-workflow-unknown-health",
      lane: "runtime",
      severity: "medium",
      subsystem: "workflow_orchestration",
      title: "Active workflows missing success evidence",
      detail: `${unresolvedUnknownWorkflows.length} active workflows have unknown health with recent/repeated failures`,
      remediation: runtime.n8nWorkflows.ok
        ? "Capture recent successful execution timestamps from live n8n and refresh workflow evidence."
        : "Enable live n8n connectivity to validate workflow success evidence.",
    });
  }

  const staleOrFailingWorkflows = snapshot.workflowSummary.items.filter(
    (item) => item.state === "production-active" && (item.healthStatus === "stale" || item.healthStatus === "failing"),
  );
  if (staleOrFailingWorkflows.length > 0) {
    addFinding(findings, {
      id: "runtime-workflow-stale-failing",
      lane: "runtime",
      severity: "critical",
      subsystem: "workflow_orchestration",
      title: "Active workflows are stale/failing",
      detail: staleOrFailingWorkflows.map((item) => `${item.canonicalName}:${item.healthStatus}`).join(", "),
      remediation: "Repair failing workflows and recover fresh successful runs.",
    });
  }

  const dbUrl = process.env.DATABASE_URL;
  const tableFreshness = new Map<string, TableFreshness>();
  const knownTables = new Set(snapshot.databaseTables);
  let dbAvailable = false;
  if (dbUrl) {
    const sql = postgres(dbUrl, {
      max: 2,
      connect_timeout: 10,
      idle_timeout: 10,
    });
    try {
      try {
        await sql`SELECT 1`;
        dbAvailable = true;
      } catch (error) {
        const usingFallbackDbUrl = dbUrl === DEFAULT_DATABASE_URL;
        addFinding(findings, {
          id: "runtime-db-connect-failed",
          lane: "runtime",
          severity: usingFallbackDbUrl ? "medium" : "high",
          subsystem: "global",
          title: "Database connectivity probe failed",
          detail: error instanceof Error ? error.message : String(error),
          remediation: "Set DATABASE_URL to a reachable Trading Forge database and rerun deep scan.",
        });
      }

      if (dbAvailable) {
        const tableNames = new Set<string>();
        for (const subsystem of readiness.subsystems) {
          for (const evidence of subsystem.requiredEvidence) {
            const tableName = extractTableFromEvidence(evidence, knownTables);
            if (tableName) tableNames.add(tableName);
          }
        }
        for (const table of tableNames) {
          const freshness = await getTableFreshness(sql, table);
          tableFreshness.set(table, freshness);
        }
      }
    } finally {
      await sql.end({ timeout: 5 });
    }
  } else {
    addFinding(findings, {
      id: "runtime-db-url-missing",
      lane: "runtime",
      severity: "high",
      subsystem: "global",
      title: "DATABASE_URL missing for evidence freshness checks",
      detail: "Cannot validate persistence freshness without database connectivity.",
      remediation: "Set DATABASE_URL and rerun deep scan.",
    });
  }

  const subsystemIndex = new Map<string, RegistrySubsystemSummary>(
    snapshot.subsystemSummaries.map((entry) => [entry.id, entry]),
  );
  for (const subsystem of readiness.subsystems) {
    for (const evidence of subsystem.requiredEvidence) {
      if (evidence.startsWith("/api/")) {
        if (!routeEvidenceCovered(snapshot.routes, evidence)) {
          addFinding(findings, {
            id: `evidence-route-${subsystem.id}-${evidence}`,
            lane: "evidence",
            severity: "critical",
            subsystem: subsystem.id,
            title: "Required route missing from topology",
            detail: evidence,
            remediation: "Restore route wiring or update registry requirements.",
          });
        } else if (evidence === "/api/health" && !runtime.apiHealth.ok) {
          addFinding(findings, {
            id: `evidence-health-${subsystem.id}`,
            lane: "evidence",
            severity: "high",
            subsystem: subsystem.id,
            title: "Health route not runtime-reachable",
            detail: evidence,
            remediation: "Recover API runtime and re-probe health route.",
          });
        } else if (evidence === "/api/health/dashboard" && !runtime.apiHealthDashboard.ok) {
          addFinding(findings, {
            id: `evidence-health-dashboard-${subsystem.id}`,
            lane: "evidence",
            severity: "high",
            subsystem: subsystem.id,
            title: "Health dashboard not runtime-reachable",
            detail: evidence,
            remediation: "Recover API runtime and re-probe health dashboard.",
          });
        }
      } else if (evidence.startsWith("n8n:/api/v1/workflows")) {
        if (!runtime.n8nWorkflows.ok) {
          addFinding(findings, {
            id: `evidence-n8n-${subsystem.id}-${evidence}`,
            lane: "evidence",
            severity: runtime.n8nWorkflows.skipped ? "medium" : "high",
            subsystem: subsystem.id,
            title: "n8n required evidence missing",
            detail: evidence,
            remediation: "Recover n8n API visibility and workflow inventory probes.",
          });
        }
      } else if (evidence.startsWith("docs/system-topology.generated.json")) {
        const exists = await fileExists(path.join(rootDir, "docs", "system-topology.generated.json"));
        if (!exists) {
          addFinding(findings, {
            id: `evidence-topology-file-${subsystem.id}`,
            lane: "evidence",
            severity: "critical",
            subsystem: subsystem.id,
            title: "Generated topology file missing",
            detail: evidence,
            remediation: "Run `npm run system-map:sync` to regenerate topology artifacts.",
          });
        }
      } else {
        const table = extractTableFromEvidence(evidence, knownTables);
        if (table) {
          if (!dbAvailable) continue;
          const freshness = tableFreshness.get(table);
          if (!freshness) continue;
          if (!freshness.exists || freshness.error) {
            addFinding(findings, {
              id: `evidence-table-missing-${subsystem.id}-${table}`,
              lane: "evidence",
              severity: "medium",
              subsystem: subsystem.id,
              title: "Required evidence table missing/unreadable",
              detail: `${table} (${freshness.error ?? "missing"})`,
              remediation: "Apply schema/migration fixes and restore database connectivity.",
            });
            continue;
          }
          if (freshness.rows === 0) {
            addFinding(findings, {
              id: `evidence-table-empty-${subsystem.id}-${table}`,
              lane: "evidence",
              severity: "medium",
              subsystem: subsystem.id,
              title: "Required evidence table has no rows",
              detail: table,
              remediation: "Run the owning subsystem flow and verify persistence writes.",
            });
            continue;
          }
          const maxHours = expectedEvidenceFreshnessHours(evidence);
          if (freshness.ageHours != null && freshness.ageHours > maxHours) {
            addFinding(findings, {
              id: `evidence-table-stale-${subsystem.id}-${table}`,
              lane: "evidence",
              severity: "medium",
              subsystem: subsystem.id,
              title: "Required evidence is stale",
              detail: `${table} latest=${freshness.latestAt} ageHours=${freshness.ageHours.toFixed(2)} threshold=${maxHours}`,
              remediation: "Trigger subsystem jobs/workflows and verify fresh writes.",
            });
          }
        } else if (
          evidence === "n8n-workflow-activation-health"
          && unresolvedUnknownWorkflows.length > 0
        ) {
          addFinding(findings, {
            id: `evidence-n8n-activation-${subsystem.id}`,
            lane: "evidence",
            severity: "medium",
            subsystem: subsystem.id,
            title: "Workflow activation health unresolved",
            detail: `${unresolvedUnknownWorkflows.length} active workflows lack success evidence with recent/repeated failures`,
            remediation: "Collect live success timestamps and refresh workflow health metadata.",
          });
        } else if (evidence === "production-workflow-activation-boundary" && !snapshot.manualTradingViewDeployOnly) {
          addFinding(findings, {
            id: `evidence-manual-gate-${subsystem.id}`,
            lane: "evidence",
            severity: "critical",
            subsystem: subsystem.id,
            title: "Manual deployment boundary drifted",
            detail: "manualTradingViewDeployOnly=false",
            remediation: "Restore manual TradingView deploy boundary.",
          });
        } else if (evidence === "research-topology-health") {
          const summary = subsystemIndex.get("research_orchestration");
          if (!summary || !summary.launchReady) {
            addFinding(findings, {
              id: `evidence-research-topology-${subsystem.id}`,
              lane: "evidence",
              severity: "high",
              subsystem: subsystem.id,
              title: "Research topology health not launch-ready",
              detail: "research_orchestration launchReady=false",
              remediation: "Resolve research orchestration coverage gaps.",
            });
          }
        }
      }
    }
  }

  const report: DeepScanReport = {
    generatedAt,
    status: "pass",
    scope: "trading-forge",
    lanes: {
      static: staticResults,
      runtime,
      map: {
        topologyStatus: snapshot.registryCoverage.productionConvergence.status,
        readinessStatus: readiness.overallStatus,
        blockers: readiness.blockers,
      },
    },
    findings,
    summary: summarizeFindings(findings),
  };

  report.status = report.summary.unresolvedCriticalHigh > 0 ? "fail" : "pass";

  const stamp = generatedAt.replace(/[:.]/g, "-");
  const outDir = path.join(rootDir, "reports", "deep-scan");
  await mkdir(outDir, { recursive: true });
  const jsonPath = path.join(outDir, `${stamp}.json`);
  const mdPath = path.join(outDir, `${stamp}.md`);
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(mdPath, markdownReport(report), "utf8");

  console.log(JSON.stringify({
    status: report.status,
    generatedAt: report.generatedAt,
    reportJson: path.relative(rootDir, jsonPath).replace(/\\/g, "/"),
    reportMarkdown: path.relative(rootDir, mdPath).replace(/\\/g, "/"),
    summary: report.summary,
  }, null, 2));

  return report.status === "pass" ? 0 : 1;
}

run()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exit(1);
  });
