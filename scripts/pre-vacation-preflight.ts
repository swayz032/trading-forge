/**
 * Wave 24 Pass 2 Item #22 — Pre-vacation preflight orchestrator.
 *
 * Single-shot CLI that runs every check the operator used to do mentally
 * before leaving (CLAUDE.md §3 Vacation Mode), reports PASS/FAIL/WARN, and
 * — when invoked with --confirm and all checks pass — engages vacation mode
 * by stamping system_state.operator_absent_since = NOW(), writing the
 * `operator_absence.preflight_engaged` audit row, and firing a Discord info
 * notification.
 *
 * Usage:
 *   npx tsx scripts/pre-vacation-preflight.ts
 *   npx tsx scripts/pre-vacation-preflight.ts --confirm
 *
 * Exit codes:
 *   0 = ALL-PASS (with or without --confirm)
 *   1 = at least one FAIL (does NOT engage even with --confirm)
 *
 * Pre-vacation engagement is normally automatic via Pass 1.5's auto-flip
 * (`runOperatorAbsenceAutoDetect`). This preflight is the operator's
 * single-button override for departures when they want vacation mode to
 * latch immediately rather than waiting 24h + 24h of detected silence.
 *
 * Design notes:
 *   - Every check is READ-ONLY in the report phase. Only the engagement step
 *     mutates state, and only when --confirm AND all checks pass.
 *   - Each check returns {name, status, detail, remediation?} — never throws.
 *   - Dependency-injected (PreflightDeps) so the test suite never needs DB,
 *     HTTP, n8n, sc.exe, pm2, or filesystem.
 */

import "dotenv/config";

// ─── Types ────────────────────────────────────────────────────────────────────

export type CheckStatus = "PASS" | "FAIL" | "WARN";

export interface CheckResult {
  name: string;
  status: CheckStatus;
  detail: string;
  /** Operator-actionable remediation. Only shown on FAIL. */
  remediation?: string;
}

export interface PreflightReport {
  results: CheckResult[];
  hasFail: boolean;
  allPass: boolean;
  engaged: boolean;
  /** Reason engagement was skipped (already engaged, no --confirm, fail). */
  engagementSkippedReason?: string;
}

export interface PreflightDeps {
  // ── Heartbeat / cron freshness ─────────────────────────────────────────────
  getLastAuditAt(action: string): Promise<Date | null>;
  /** Read CookieStatus map from prop-firm-cookie-refresh-service. */
  getCookieLastRefreshedAt(): Promise<Record<string, Date | null>>;

  // ── n8n integrity ──────────────────────────────────────────────────────────
  /** Returns array of {id, active, errorWorkflowId} for every workflow. */
  listN8nWorkflows(): Promise<
    Array<{ id: string; active: boolean; errorWorkflowId: string | null; name?: string }>
  >;

  // ── DB state ───────────────────────────────────────────────────────────────
  /** Latest weekly drift report (if any). Returns null if none. */
  getLatestDriftReport(): Promise<{ reportWeek: string | Date; severity: string } | null>;
  /** Number of rows currently in __drizzle_migrations. */
  countAppliedMigrations(): Promise<number>;
  /** Number of entries in meta/_journal.json. */
  countJournalMigrations(): Promise<number>;
  /** Read system_state row. */
  getSystemState(): Promise<{
    productionMode: string;
    operatorAbsentSince: Date | null;
    operatorAbsentPending: Date | null;
  } | null>;

  // ── Process / OS health ────────────────────────────────────────────────────
  /** Result of `sc query TradingForgeAPI`. Null on non-Windows. */
  queryNssmService(): Promise<{ available: boolean; running: boolean; raw: string } | null>;
  /** True if pm2 reports an entry occupying port 4000. */
  pm2ListenerOn4000(): Promise<boolean>;
  /** Health endpoint sample. */
  fetchHealth(): Promise<{ ok: boolean; backtestConcurrency?: unknown } | null>;
  /** Tower relay client log mtime (Date) or null if unreadable. */
  getTowerRelayLogMtime(): Promise<Date | null>;
  /** Kill switch state. */
  isKillSwitchHaltedForProduction(): Promise<boolean>;
  /** Env var lookup (test-injectable). */
  getEnv(name: string): string | undefined;

  // ── Mutations (engagement only) ────────────────────────────────────────────
  engageVacationMode(reason: string): Promise<void>;
  notifyVacationEngaged(message: string, metadata: Record<string, unknown>): Promise<void>;
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const BW_REFRESH_STALE_MS = 13 * 60 * 60 * 1000; // 13h
export const COOKIE_REFRESH_STALE_MS = 2.5 * 60 * 60 * 1000; // 2.5h per firm
export const RECONCILIATION_LOOKBACK_MS = 24 * 60 * 60 * 1000; // 24h
export const DRIFT_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000; // 7d
export const TOWER_RELAY_STALE_MS = 5 * 60 * 1000; // 5 min
export const N8N_GLOBAL_ERROR_WORKFLOW = "DGEk1D478xWJClKD";
export const SUPPORTED_FIRMS = ["mffu", "topstep"] as const;

// ─── Check helpers (each returns CheckResult; never throws) ──────────────────

function ageHours(ms: number): string {
  return (ms / (60 * 60 * 1000)).toFixed(2);
}

async function checkBwRefreshHeartbeatFresh(deps: PreflightDeps): Promise<CheckResult> {
  const name = "bw_refresh_heartbeat_fresh";
  try {
    const last = await deps.getLastAuditAt("bw_refresh.heartbeat");
    if (!last) {
      return {
        name,
        status: "FAIL",
        detail: "No bw_refresh.heartbeat audit row found.",
        remediation:
          "Verify bw-session-refresh scheduler job is registered + enabled: " +
          "POST /api/admin/scheduler/jobs/bw-session-refresh/enable",
      };
    }
    const age = Date.now() - last.getTime();
    if (age > BW_REFRESH_STALE_MS) {
      return {
        name,
        status: "FAIL",
        detail: `Last bw_refresh.heartbeat ${ageHours(age)}h ago (threshold 13h).`,
        remediation:
          "Run BW refresh manually then re-trigger preflight: " +
          "POST /api/admin/scheduler/jobs/bw-session-refresh/run",
      };
    }
    return { name, status: "PASS", detail: `Last refresh ${ageHours(age)}h ago.` };
  } catch (err) {
    return {
      name,
      status: "FAIL",
      detail: `Check threw: ${err instanceof Error ? err.message : String(err)}`,
      remediation: "Inspect logs; audit_log query failed.",
    };
  }
}

async function checkCookieRefreshHeartbeatFreshPerFirm(deps: PreflightDeps): Promise<CheckResult> {
  const name = "cookie_refresh_heartbeat_fresh_per_firm";
  try {
    const lastByFirm = await deps.getCookieLastRefreshedAt();
    const stale: string[] = [];
    const fresh: string[] = [];
    const unknown: string[] = [];
    for (const firm of SUPPORTED_FIRMS) {
      const ts = lastByFirm[firm];
      if (!ts) {
        unknown.push(firm);
        continue;
      }
      const age = Date.now() - ts.getTime();
      if (age > COOKIE_REFRESH_STALE_MS) {
        stale.push(`${firm} (${ageHours(age)}h)`);
      } else {
        fresh.push(`${firm} (${ageHours(age)}h)`);
      }
    }
    if (stale.length > 0 || unknown.length > 0) {
      const parts: string[] = [];
      if (stale.length > 0) parts.push(`stale: ${stale.join(", ")}`);
      if (unknown.length > 0) parts.push(`unknown: ${unknown.join(", ")}`);
      return {
        name,
        status: "FAIL",
        detail: parts.join("; "),
        remediation:
          "Trigger prop-firm cookie refresh manually: " +
          "POST /api/admin/scheduler/jobs/prop-firm-cookie-refresh/run; " +
          "verify Playwright is installed + per-firm credentials are set in .env.",
      };
    }
    return { name, status: "PASS", detail: `Fresh: ${fresh.join(", ")}.` };
  } catch (err) {
    return {
      name,
      status: "FAIL",
      detail: `Check threw: ${err instanceof Error ? err.message : String(err)}`,
      remediation: "Inspect cookie service.",
    };
  }
}

async function checkN8nErrorWorkflowAttached(deps: PreflightDeps): Promise<CheckResult> {
  const name = "n8n_error_workflow_attached";
  try {
    const wfs = await deps.listN8nWorkflows();
    const offenders = wfs.filter(
      (w) => w.active && w.errorWorkflowId !== N8N_GLOBAL_ERROR_WORKFLOW,
    );
    if (offenders.length === 0) {
      const activeCount = wfs.filter((w) => w.active).length;
      return {
        name,
        status: "PASS",
        detail: `${activeCount}/${activeCount} active workflows attach to ${N8N_GLOBAL_ERROR_WORKFLOW}.`,
      };
    }
    return {
      name,
      status: "FAIL",
      detail:
        `${offenders.length} active workflow(s) missing errorWorkflow=${N8N_GLOBAL_ERROR_WORKFLOW}: ` +
        offenders.slice(0, 5).map((w) => w.name ?? w.id).join(", "),
      remediation: "Run `npm run audit:n8n` and apply the suggested fixes (CLAUDE.md §2).",
    };
  } catch (err) {
    return {
      name,
      status: "FAIL",
      detail: `n8n REST query failed: ${err instanceof Error ? err.message : String(err)}`,
      remediation: "Verify N8N_BASE_URL + TF_N8N_API_KEY env vars.",
    };
  }
}

async function checkReconciliationClean24h(deps: PreflightDeps): Promise<CheckResult> {
  const name = "reconciliation_clean_24h";
  try {
    const last = await deps.getLastAuditAt("reconciliation.critical_mismatch");
    if (!last) {
      return { name, status: "PASS", detail: "No reconciliation.critical_mismatch in audit history." };
    }
    const age = Date.now() - last.getTime();
    if (age <= RECONCILIATION_LOOKBACK_MS) {
      return {
        name,
        status: "FAIL",
        detail: `Critical reconciliation mismatch ${ageHours(age)}h ago.`,
        remediation:
          "Investigate the most recent reconciliation.critical_mismatch audit row before leaving. " +
          "Forensic correlation_id lookup recommended.",
      };
    }
    return { name, status: "PASS", detail: `Last critical mismatch ${ageHours(age)}h ago (>24h).` };
  } catch (err) {
    return {
      name,
      status: "FAIL",
      detail: `Check threw: ${err instanceof Error ? err.message : String(err)}`,
      remediation: "Inspect logs.",
    };
  }
}

async function checkWeeklyDriftPass(deps: PreflightDeps): Promise<CheckResult> {
  const name = "weekly_drift_pass";
  try {
    const halt = await deps.getLastAuditAt("drift.weekly_2sigma_halt");
    if (halt) {
      const age = Date.now() - halt.getTime();
      if (age <= DRIFT_LOOKBACK_MS) {
        return {
          name,
          status: "FAIL",
          detail: `Drift weekly 2σ HALT fired ${ageHours(age)}h ago.`,
          remediation:
            "Resolve the 2σ drift breach before leaving. Review weekly_drift_reports table " +
            "and consider running `npm run forge -- drift:investigate`.",
        };
      }
    }
    const latest = await deps.getLatestDriftReport();
    if (!latest) {
      return {
        name,
        status: "WARN",
        detail: "No weekly_drift_reports row found yet (system may be < 7 days old).",
      };
    }
    const sev = (latest.severity ?? "").toLowerCase();
    if (sev === "halt" || sev === "critical" || sev === "red") {
      return {
        name,
        status: "FAIL",
        detail: `Latest drift report severity=${latest.severity}.`,
        remediation: "Investigate weekly_drift_reports latest row before vacation engagement.",
      };
    }
    return { name, status: "PASS", detail: `Latest drift report severity=${latest.severity}.` };
  } catch (err) {
    return {
      name,
      status: "FAIL",
      detail: `Check threw: ${err instanceof Error ? err.message : String(err)}`,
      remediation: "Inspect logs.",
    };
  }
}

async function checkNoPendingMigrations(deps: PreflightDeps): Promise<CheckResult> {
  const name = "no_pending_migrations";
  try {
    const applied = await deps.countAppliedMigrations();
    const journal = await deps.countJournalMigrations();
    if (applied === journal) {
      return { name, status: "PASS", detail: `${applied}/${journal} migrations applied.` };
    }
    return {
      name,
      status: "FAIL",
      detail: `Applied=${applied}, journal=${journal}. Pending=${journal - applied}.`,
      remediation:
        "Apply pending migrations: `npm run db:migrate` (verify .env DATABASE_URL points at the right instance first).",
    };
  } catch (err) {
    return {
      name,
      status: "FAIL",
      detail: `Check threw: ${err instanceof Error ? err.message : String(err)}`,
      remediation: "Inspect logs.",
    };
  }
}

async function checkNssmServiceRunning(deps: PreflightDeps): Promise<CheckResult> {
  const name = "nssm_service_running";
  try {
    const res = await deps.queryNssmService();
    if (res === null) {
      return { name, status: "WARN", detail: "Non-Windows host — sc.exe unavailable, skipping check." };
    }
    if (!res.available) {
      return {
        name,
        status: "FAIL",
        detail: "sc.exe query failed (service not installed or permission denied).",
        remediation:
          "Install / reinstall the NSSM TradingForgeAPI service (see bin/nssm/win64/nssm.exe — run nssm install TradingForgeAPI from admin shell).",
      };
    }
    if (!res.running) {
      return {
        name,
        status: "FAIL",
        detail: `Service state from sc query: ${res.raw.slice(0, 200)}`,
        remediation:
          "Start the service: `sc start TradingForgeAPI` (admin shell) or trigger /api/admin/self-restart with HMAC.",
      };
    }
    return { name, status: "PASS", detail: "TradingForgeAPI service is RUNNING." };
  } catch (err) {
    return {
      name,
      status: "FAIL",
      detail: `Check threw: ${err instanceof Error ? err.message : String(err)}`,
      remediation: "Inspect logs.",
    };
  }
}

async function checkPm2NotRunningOn4000(deps: PreflightDeps): Promise<CheckResult> {
  const name = "pm2_not_running_on_4000";
  try {
    const present = await deps.pm2ListenerOn4000();
    if (present) {
      return {
        name,
        status: "FAIL",
        detail: "pm2 reports a listener on port 4000 — conflicts with NSSM TradingForgeAPI.",
        remediation: "Stop the pm2 process: `pm2 delete trading-forge-api` (or rename); NSSM owns port 4000.",
      };
    }
    return { name, status: "PASS", detail: "No pm2 listener on port 4000." };
  } catch (err) {
    return {
      name,
      status: "WARN",
      detail: `pm2 query failed (likely pm2 not installed): ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function checkProductionModeActive(deps: PreflightDeps): Promise<CheckResult> {
  const name = "production_mode_active";
  try {
    const ss = await deps.getSystemState();
    if (!ss) {
      return {
        name,
        status: "FAIL",
        detail: "system_state row missing.",
        remediation: "Insert system_state row (id=1) with productionMode='ACTIVE'.",
      };
    }
    if (ss.productionMode !== "ACTIVE") {
      return {
        name,
        status: "FAIL",
        detail: `production_mode=${ss.productionMode}.`,
        remediation: "Flip to ACTIVE via UI ProductionStatusPanel or `POST /api/admin/production-mode {mode:'ACTIVE'}`.",
      };
    }
    return { name, status: "PASS", detail: "production_mode = ACTIVE." };
  } catch (err) {
    return {
      name,
      status: "FAIL",
      detail: `Check threw: ${err instanceof Error ? err.message : String(err)}`,
      remediation: "Inspect logs.",
    };
  }
}

async function checkTowerRelayRecent(deps: PreflightDeps): Promise<CheckResult> {
  const name = "tower_relay_recent";
  try {
    const mtime = await deps.getTowerRelayLogMtime();
    if (!mtime) {
      return {
        name,
        status: "FAIL",
        detail: "Tower relay log file not found at C:\\Users\\tonio\\bin\\tower-relay-client.log.",
        remediation:
          "Verify ecosystem-relay-client.cjs is running (`pm2 status` should show tower-relay-client).",
      };
    }
    const age = Date.now() - mtime.getTime();
    if (age > TOWER_RELAY_STALE_MS) {
      return {
        name,
        status: "FAIL",
        detail: `Tower relay log idle ${(age / 60_000).toFixed(1)} min (threshold 5 min).`,
        remediation:
          "Restart tower relay: `pm2 restart tower-relay-client`. Check RELAY_TOKEN matches Railway env.",
      };
    }
    return { name, status: "PASS", detail: `Tower relay active (last write ${(age / 1000).toFixed(0)}s ago).` };
  } catch (err) {
    return {
      name,
      status: "WARN",
      detail: `Tower relay log stat failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function checkOperatorAbsentSinceCurrentlyNull(deps: PreflightDeps): Promise<CheckResult> {
  const name = "operator_absent_since_currently_null";
  try {
    const ss = await deps.getSystemState();
    if (!ss) {
      return { name, status: "FAIL", detail: "system_state row missing." };
    }
    if (ss.operatorAbsentSince) {
      return {
        name,
        status: "WARN",
        detail: `operator_absent_since already set to ${ss.operatorAbsentSince.toISOString()} — vacation mode is already engaged.`,
        remediation:
          "If you have returned, clear via `POST /api/admin/operator-mark-present`. If already on vacation, ignore — preflight is idempotent.",
      };
    }
    return { name, status: "PASS", detail: "operator_absent_since is NULL (operator present)." };
  } catch (err) {
    return {
      name,
      status: "FAIL",
      detail: `Check threw: ${err instanceof Error ? err.message : String(err)}`,
      remediation: "Inspect logs.",
    };
  }
}

async function checkKillSwitchNotHalted(deps: PreflightDeps): Promise<CheckResult> {
  const name = "kill_switch_not_halted";
  try {
    const halted = await deps.isKillSwitchHaltedForProduction();
    if (halted) {
      return {
        name,
        status: "FAIL",
        detail: "killSwitch.isHaltedForProduction() === true — no new entries will fire.",
        remediation:
          "Resolve the underlying halt cause (kill switch UI / pipeline pause). Do not leave on vacation with a HALT active.",
      };
    }
    return { name, status: "PASS", detail: "Kill switch is not halted." };
  } catch (err) {
    return {
      name,
      status: "FAIL",
      detail: `Check threw: ${err instanceof Error ? err.message : String(err)}`,
      remediation: "Inspect logs.",
    };
  }
}

async function checkPhase14ConcurrencyAlive(deps: PreflightDeps): Promise<CheckResult> {
  const name = "phase14_concurrency_alive";
  try {
    const h = await deps.fetchHealth();
    if (!h || !h.ok) {
      return {
        name,
        status: "FAIL",
        detail: "GET /api/health returned non-OK.",
        remediation: "Verify backend is reachable on port 4000.",
      };
    }
    if (typeof h.backtestConcurrency === "undefined") {
      return {
        name,
        status: "FAIL",
        detail: "/api/health response missing backtestConcurrency field — stale binary running.",
        remediation:
          "Self-restart via HMAC: see CLAUDE.md §15a self-restart endpoint snippet.",
      };
    }
    return { name, status: "PASS", detail: "backtestConcurrency field present — Phase 14 code is live." };
  } catch (err) {
    return {
      name,
      status: "FAIL",
      detail: `Health fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      remediation: "Verify backend reachable; check tower relay if remote.",
    };
  }
}

async function checkAdminRestartHmacConfigured(deps: PreflightDeps): Promise<CheckResult> {
  const name = "admin_restart_hmac_configured";
  const v = deps.getEnv("ADMIN_RESTART_HMAC_SECRET");
  if (!v || v.length === 0) {
    return {
      name,
      status: "FAIL",
      detail: "ADMIN_RESTART_HMAC_SECRET is unset.",
      remediation:
        "Set a 32+ char random secret in .env and on the relay (CLAUDE.md §15a). Without it, you cannot self-restart while away.",
    };
  }
  if (v.length < 32) {
    return {
      name,
      status: "WARN",
      detail: `ADMIN_RESTART_HMAC_SECRET length=${v.length} (recommend ≥32).`,
    };
  }
  return { name, status: "PASS", detail: "ADMIN_RESTART_HMAC_SECRET configured." };
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

export const PREFLIGHT_CHECKS: ReadonlyArray<(deps: PreflightDeps) => Promise<CheckResult>> = [
  checkBwRefreshHeartbeatFresh,
  checkCookieRefreshHeartbeatFreshPerFirm,
  checkN8nErrorWorkflowAttached,
  checkReconciliationClean24h,
  checkWeeklyDriftPass,
  checkNoPendingMigrations,
  checkNssmServiceRunning,
  checkPm2NotRunningOn4000,
  checkProductionModeActive,
  checkTowerRelayRecent,
  checkOperatorAbsentSinceCurrentlyNull,
  checkKillSwitchNotHalted,
  checkPhase14ConcurrencyAlive,
  checkAdminRestartHmacConfigured,
];

export interface RunOptions {
  confirm: boolean;
}

export async function runPreflight(deps: PreflightDeps, opts: RunOptions): Promise<PreflightReport> {
  const results: CheckResult[] = [];
  for (const check of PREFLIGHT_CHECKS) {
    // Each check is isolated — never let one bad check abort the others.
    let r: CheckResult;
    try {
      r = await check(deps);
    } catch (err) {
      r = {
        name: check.name || "unknown_check",
        status: "FAIL",
        detail: `Unhandled throw: ${err instanceof Error ? err.message : String(err)}`,
        remediation: "Inspect logs.",
      };
    }
    results.push(r);
  }

  const hasFail = results.some((r) => r.status === "FAIL");
  const allPass = !hasFail; // WARN does not block engagement

  const report: PreflightReport = {
    results,
    hasFail,
    allPass,
    engaged: false,
  };

  if (hasFail) {
    report.engagementSkippedReason = "one_or_more_checks_failed";
    return report;
  }

  // Idempotency: if operator_absent_since already set, do not re-engage.
  const ss = await deps.getSystemState().catch(() => null);
  if (ss?.operatorAbsentSince) {
    report.engagementSkippedReason = "already_engaged";
    return report;
  }

  if (!opts.confirm) {
    report.engagementSkippedReason = "confirm_flag_not_set";
    return report;
  }

  await deps.engageVacationMode("preflight_engaged");
  await deps.notifyVacationEngaged(
    `Operator engaged vacation mode via preflight at ${new Date().toISOString()}`,
    {
      via: "scripts/pre-vacation-preflight.ts",
      checks_passed: results.length,
      timestamp: new Date().toISOString(),
    },
  );
  report.engaged = true;
  return report;
}

// ─── Pretty printer ───────────────────────────────────────────────────────────

export function formatReport(report: PreflightReport): string {
  const lines: string[] = [];
  lines.push("");
  lines.push("=== Pre-Vacation Preflight ===");
  lines.push("");
  const maxName = Math.max(...report.results.map((r) => r.name.length));
  for (const r of report.results) {
    const status = r.status.padEnd(4, " ");
    const name = r.name.padEnd(maxName, " ");
    lines.push(`  [${status}] ${name}  ${r.detail}`);
    if (r.status === "FAIL" && r.remediation) {
      lines.push(`         ↳ remediation: ${r.remediation}`);
    }
  }
  lines.push("");
  if (report.hasFail) {
    const failCount = report.results.filter((r) => r.status === "FAIL").length;
    lines.push(`RESULT: SOME-FAILED (${failCount} fail). Vacation mode NOT engaged.`);
  } else if (report.engaged) {
    lines.push("RESULT: ALL-PASS. Vacation mode ENGAGED.");
  } else if (report.engagementSkippedReason === "already_engaged") {
    lines.push("RESULT: ALL-PASS. Vacation mode was already engaged (no-op).");
  } else if (report.engagementSkippedReason === "confirm_flag_not_set") {
    lines.push("RESULT: ALL-PASS. Run with --confirm to engage vacation mode.");
  } else {
    lines.push("RESULT: ALL-PASS.");
  }
  lines.push("");
  return lines.join("\n");
}

// ─── Production deps factory ──────────────────────────────────────────────────

export async function makeProductionDeps(): Promise<PreflightDeps> {
  const { db } = await import("../src/server/db/index.js");
  const { auditLog, systemState, weeklyDriftReports } = await import("../src/server/db/schema.js");
  const { eq, desc, sql: drizzleSql } = await import("drizzle-orm");
  const { getCookieLastRefreshedAt } = await import(
    "../src/server/services/prop-firm-cookie-refresh-service.js"
  );
  const { killSwitch } = await import("../src/server/production/kill-switch.js");
  const { insertAuditRow } = await import("../src/server/lib/audit-log-helper.js");
  const { notifyInfo } = await import("../src/server/services/notification-service.js");
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileP = promisify(execFile);

  return {
    async getLastAuditAt(action: string) {
      const rows = await db
        .select({ createdAt: auditLog.createdAt })
        .from(auditLog)
        .where(eq(auditLog.action, action))
        .orderBy(desc(auditLog.createdAt))
        .limit(1);
      return rows.length > 0 ? new Date(rows[0].createdAt as unknown as string) : null;
    },

    async getCookieLastRefreshedAt() {
      return getCookieLastRefreshedAt();
    },

    async listN8nWorkflows() {
      const baseUrl = process.env["N8N_BASE_URL"];
      const apiKey = process.env["TF_N8N_API_KEY"];
      if (!baseUrl || !apiKey) {
        throw new Error("N8N_BASE_URL or TF_N8N_API_KEY missing from env.");
      }
      const out: Array<{ id: string; active: boolean; errorWorkflowId: string | null; name?: string }> = [];
      let cursor: string | undefined;
      do {
        const url = new URL(`${baseUrl.replace(/\/$/, "")}/api/v1/workflows`);
        url.searchParams.set("limit", "100");
        if (cursor) url.searchParams.set("cursor", cursor);
        const res = await fetch(url.toString(), { headers: { "X-N8N-API-KEY": apiKey } });
        if (!res.ok) throw new Error(`n8n API ${res.status}`);
        const body = (await res.json()) as { data?: Array<Record<string, unknown>>; nextCursor?: string };
        for (const w of body.data ?? []) {
          const settings = (w["settings"] as { errorWorkflow?: string } | undefined) ?? {};
          out.push({
            id: String(w["id"]),
            active: Boolean(w["active"]),
            name: typeof w["name"] === "string" ? (w["name"] as string) : undefined,
            errorWorkflowId: typeof settings.errorWorkflow === "string" ? settings.errorWorkflow : null,
          });
        }
        cursor = body.nextCursor;
      } while (cursor);
      return out;
    },

    async getLatestDriftReport() {
      const rows = await db
        .select({ reportWeek: weeklyDriftReports.reportWeek, severity: weeklyDriftReports.severity })
        .from(weeklyDriftReports)
        .orderBy(desc(weeklyDriftReports.reportWeek))
        .limit(1);
      return rows.length > 0 ? { reportWeek: rows[0].reportWeek, severity: rows[0].severity } : null;
    },

    async countAppliedMigrations() {
      const result = await db.execute(drizzleSql`SELECT COUNT(*)::int AS n FROM __drizzle_migrations`);
      // drizzle's pg execute returns array-of-rows
      const rows = (result as unknown as Array<{ n: number }>) ?? [];
      return rows[0]?.n ?? 0;
    },

    async countJournalMigrations() {
      const journalPath = path.resolve(process.cwd(), "src/server/db/migrations/meta/_journal.json");
      const buf = await fs.readFile(journalPath, "utf8");
      const j = JSON.parse(buf) as { entries?: unknown[] };
      return Array.isArray(j.entries) ? j.entries.length : 0;
    },

    async getSystemState() {
      const rows = await db
        .select({
          productionMode: systemState.productionMode,
          operatorAbsentSince: systemState.operatorAbsentSince,
          operatorAbsentPending: systemState.operatorAbsentPending,
        })
        .from(systemState)
        .limit(1);
      if (rows.length === 0) return null;
      const r = rows[0];
      return {
        productionMode: r.productionMode,
        operatorAbsentSince: r.operatorAbsentSince ? new Date(r.operatorAbsentSince as unknown as string) : null,
        operatorAbsentPending: r.operatorAbsentPending ? new Date(r.operatorAbsentPending as unknown as string) : null,
      };
    },

    async queryNssmService() {
      if (process.platform !== "win32") return null;
      try {
        const { stdout } = await execFileP("sc", ["query", "TradingForgeAPI"]);
        return { available: true, running: /STATE\s+:\s+\d+\s+RUNNING/i.test(stdout), raw: stdout };
      } catch (err) {
        return { available: false, running: false, raw: err instanceof Error ? err.message : String(err) };
      }
    },

    async pm2ListenerOn4000() {
      try {
        const { stdout } = await execFileP("pm2", ["jlist"]);
        const list = JSON.parse(stdout) as Array<{ pm2_env?: { env?: Record<string, string> }; pm_id?: number }>;
        // Heuristic: any pm2 entry with PORT=4000 or running on default backend.
        for (const e of list) {
          const port = e.pm2_env?.env?.["PORT"];
          if (port === "4000") return true;
        }
        return false;
      } catch {
        // pm2 likely not installed — propagate as not present.
        throw new Error("pm2 not available");
      }
    },

    async fetchHealth() {
      const url = process.env["TRADING_FORGE_API_URL"] ?? "http://localhost:4000";
      try {
        const res = await fetch(`${url.replace(/\/$/, "")}/api/health`);
        if (!res.ok) return { ok: false };
        const body = (await res.json()) as { backtestConcurrency?: unknown };
        return { ok: true, backtestConcurrency: body.backtestConcurrency };
      } catch {
        return null;
      }
    },

    async getTowerRelayLogMtime() {
      const candidates = [
        process.env["TOWER_RELAY_LOG_PATH"],
        "C:\\Users\\tonio\\bin\\tower-relay-client.log",
      ].filter((s): s is string => Boolean(s));
      for (const p of candidates) {
        try {
          const stat = await fs.stat(p);
          return stat.mtime;
        } catch {
          // try next
        }
      }
      return null;
    },

    async isKillSwitchHaltedForProduction() {
      return killSwitch.isHaltedForProduction();
    },

    getEnv(name: string) {
      return process.env[name];
    },

    async engageVacationMode(reason: string) {
      await db
        .update(systemState)
        .set({ operatorAbsentSince: new Date() })
        .where(eq(systemState.id, 1));
      await insertAuditRow({
        action: "operator_absence.preflight_engaged",
        entityType: "system",
        entityId: null,
        decisionAuthority: "human",
        input: { reason, source: "scripts/pre-vacation-preflight.ts" } as Record<string, unknown>,
        result: { engaged_at: new Date().toISOString() } as Record<string, unknown>,
        status: "success",
        correlationId: null,
      });
    },

    async notifyVacationEngaged(message: string, metadata: Record<string, unknown>) {
      notifyInfo("Vacation mode engaged via preflight", message, metadata);
    },
  };
}

// ─── CLI entrypoint ───────────────────────────────────────────────────────────

async function main(): Promise<number> {
  const confirm = process.argv.includes("--confirm");
  const deps = await makeProductionDeps();
  const report = await runPreflight(deps, { confirm });
  console.log(formatReport(report));
  return report.hasFail ? 1 : 0;
}

// Run only when invoked directly (not when imported by tests)
// import.meta.url comparison works under tsx ESM.
const isDirectInvocation = (() => {
  try {
    const argvHref = new URL(`file://${process.argv[1]?.replace(/\\/g, "/")}`).href;
    return import.meta.url === argvHref;
  } catch {
    return false;
  }
})();

if (isDirectInvocation) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error("Preflight crashed:", err);
      process.exit(1);
    });
}
