/**
 * Wave 24 Pass 2 Item #22 — Pre-vacation preflight orchestrator tests.
 *
 * Dependency-injected (PreflightDeps) — no DB / HTTP / sc.exe / pm2 / FS.
 *
 * Coverage:
 *   1. All-pass without --confirm exits 0, does NOT engage.
 *   2. All-pass with --confirm engages: writes system_state + audit row + Discord.
 *   3. Single-check FAIL exits 1, includes remediation in formatted report,
 *      does NOT engage even with --confirm.
 *   4. Already-engaged --confirm is idempotent no-op.
 *   5. WARN does not block engagement.
 *   6. n8n: a single offending workflow flips the check to FAIL.
 *   7. Per-firm cookie freshness — only one stale firm triggers FAIL.
 *   8. Migration drift (applied < journal) → FAIL.
 *   9. /api/health missing backtestConcurrency → FAIL (stale binary signal).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  runPreflight,
  formatReport,
  PREFLIGHT_CHECKS,
  N8N_GLOBAL_ERROR_WORKFLOW,
  type PreflightDeps,
  type CheckResult,
} from "../../../scripts/pre-vacation-preflight.js";

const NOW = new Date("2026-05-23T18:00:00.000Z").getTime();
const HOURS = (n: number) => n * 60 * 60 * 1000;
const MINUTES = (n: number) => n * 60 * 1000;

interface DepsOverrides {
  bwLastAt?: Date | null;
  cookieLastAt?: Record<string, Date | null>;
  n8nWorkflows?: Array<{ id: string; active: boolean; errorWorkflowId: string | null; name?: string }>;
  reconciliationLastAt?: Date | null;
  driftHaltLastAt?: Date | null;
  latestDriftReport?: { reportWeek: string | Date; severity: string } | null;
  appliedMigrations?: number;
  journalMigrations?: number;
  systemState?: {
    productionMode: string;
    operatorAbsentSince: Date | null;
    operatorAbsentPending: Date | null;
  } | null;
  nssm?: { available: boolean; running: boolean; raw: string } | null;
  pm24000?: boolean | Error;
  health?: { ok: boolean; backtestConcurrency?: unknown } | null;
  towerRelayMtime?: Date | null;
  killSwitchHalted?: boolean;
  env?: Record<string, string | undefined>;
}

interface CallTracker {
  engageCalls: Array<{ reason: string }>;
  notifyCalls: Array<{ message: string; metadata: Record<string, unknown> }>;
}

function makeDeps(o: DepsOverrides = {}): { deps: PreflightDeps; track: CallTracker } {
  const ssRef: { current: DepsOverrides["systemState"] } = {
    current:
      o.systemState ?? {
        productionMode: "ACTIVE",
        operatorAbsentSince: null,
        operatorAbsentPending: null,
      },
  };
  const track: CallTracker = { engageCalls: [], notifyCalls: [] };

  const deps: PreflightDeps = {
    async getLastAuditAt(action: string) {
      if (action === "bw_refresh.heartbeat") return o.bwLastAt ?? new Date(NOW - HOURS(3));
      if (action === "reconciliation.critical_mismatch") return o.reconciliationLastAt ?? null;
      if (action === "drift.weekly_2sigma_halt") return o.driftHaltLastAt ?? null;
      return null;
    },
    async getCookieLastRefreshedAt() {
      return (
        o.cookieLastAt ?? {
          mffu: new Date(NOW - MINUTES(30)),
          topstep: new Date(NOW - MINUTES(30)),
        }
      );
    },
    async listN8nWorkflows() {
      return (
        o.n8nWorkflows ?? [
          { id: "w1", active: true, errorWorkflowId: N8N_GLOBAL_ERROR_WORKFLOW, name: "wf-1" },
          { id: "w2", active: true, errorWorkflowId: N8N_GLOBAL_ERROR_WORKFLOW, name: "wf-2" },
        ]
      );
    },
    async getLatestDriftReport() {
      return (
        o.latestDriftReport ?? { reportWeek: new Date(NOW - HOURS(48)).toISOString(), severity: "green" }
      );
    },
    async countAppliedMigrations() {
      return o.appliedMigrations ?? 132;
    },
    async countJournalMigrations() {
      return o.journalMigrations ?? 132;
    },
    async getSystemState() {
      return ssRef.current ?? null;
    },
    async queryNssmService() {
      // Note: use `in` check, not nullish coalescing, because `null` is a meaningful value
      // (non-Windows host signal). `?? default` would clobber an explicit null.
      return "nssm" in o
        ? (o.nssm ?? null)
        : { available: true, running: true, raw: "STATE              : 4  RUNNING" };
    },
    async pm2ListenerOn4000() {
      if (o.pm24000 instanceof Error) throw o.pm24000;
      return o.pm24000 ?? false;
    },
    async fetchHealth() {
      return o.health ?? { ok: true, backtestConcurrency: { active: 0, cap: 3, saturated: false } };
    },
    async getTowerRelayLogMtime() {
      return o.towerRelayMtime ?? new Date(NOW - 30_000);
    },
    async isKillSwitchHaltedForProduction() {
      return o.killSwitchHalted ?? false;
    },
    getEnv(name: string) {
      const env = o.env ?? { ADMIN_RESTART_HMAC_SECRET: "a".repeat(40) };
      return env[name];
    },
    async engageVacationMode(reason: string) {
      track.engageCalls.push({ reason });
      // mutate the simulated system_state so subsequent reads see it engaged
      if (ssRef.current) ssRef.current.operatorAbsentSince = new Date(NOW);
    },
    async notifyVacationEngaged(message: string, metadata: Record<string, unknown>) {
      track.notifyCalls.push({ message, metadata });
    },
  };
  return { deps, track };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

describe("Wave 24 Pass 2 Item #22 — pre-vacation preflight", () => {
  it("PREFLIGHT_CHECKS includes all 14 mandatory checks", () => {
    expect(PREFLIGHT_CHECKS.length).toBeGreaterThanOrEqual(14);
  });

  it("happy path without --confirm: all PASS, hasFail=false, no engagement", async () => {
    const { deps, track } = makeDeps();
    const report = await runPreflight(deps, { confirm: false });

    expect(report.hasFail).toBe(false);
    expect(report.allPass).toBe(true);
    expect(report.engaged).toBe(false);
    expect(report.engagementSkippedReason).toBe("confirm_flag_not_set");
    expect(track.engageCalls.length).toBe(0);
    expect(track.notifyCalls.length).toBe(0);

    const nonWarnFails = report.results.filter((r) => r.status === "FAIL");
    expect(nonWarnFails).toEqual([]);

    const formatted = formatReport(report);
    expect(formatted).toMatch(/Run with --confirm/);
  });

  it("happy path with --confirm: engages + Discord + audit", async () => {
    const { deps, track } = makeDeps();
    const report = await runPreflight(deps, { confirm: true });

    expect(report.hasFail).toBe(false);
    expect(report.engaged).toBe(true);
    expect(track.engageCalls).toEqual([{ reason: "preflight_engaged" }]);
    expect(track.notifyCalls.length).toBe(1);
    expect(track.notifyCalls[0].message).toMatch(/Operator engaged vacation mode/i);
    expect(track.notifyCalls[0].metadata.via).toBe("scripts/pre-vacation-preflight.ts");

    const formatted = formatReport(report);
    expect(formatted).toMatch(/Vacation mode ENGAGED/);
  });

  it("single FAIL: kill switch halted → report.hasFail=true, no engagement even with --confirm", async () => {
    const { deps, track } = makeDeps({ killSwitchHalted: true });
    const report = await runPreflight(deps, { confirm: true });

    expect(report.hasFail).toBe(true);
    expect(report.allPass).toBe(false);
    expect(report.engaged).toBe(false);
    expect(report.engagementSkippedReason).toBe("one_or_more_checks_failed");
    expect(track.engageCalls.length).toBe(0);

    const ks = report.results.find((r) => r.name === "kill_switch_not_halted");
    expect(ks?.status).toBe("FAIL");
    expect(ks?.remediation).toBeTruthy();

    const formatted = formatReport(report);
    expect(formatted).toMatch(/SOME-FAILED/);
    expect(formatted).toMatch(/remediation:/);
  });

  it("already-engaged --confirm is idempotent: no second engage", async () => {
    const { deps, track } = makeDeps({
      systemState: {
        productionMode: "ACTIVE",
        operatorAbsentSince: new Date(NOW - HOURS(48)),
        operatorAbsentPending: null,
      },
    });
    const report = await runPreflight(deps, { confirm: true });

    // operator_absent_since check WARNs (not FAILs) when already set
    const absent = report.results.find((r) => r.name === "operator_absent_since_currently_null");
    expect(absent?.status).toBe("WARN");

    expect(report.hasFail).toBe(false);
    expect(report.engaged).toBe(false);
    expect(report.engagementSkippedReason).toBe("already_engaged");
    expect(track.engageCalls.length).toBe(0);

    const formatted = formatReport(report);
    expect(formatted).toMatch(/already engaged/i);
  });

  it("WARN does not block engagement (no pm2 + non-Windows)", async () => {
    const { deps, track } = makeDeps({
      pm24000: new Error("pm2 not installed"),
      nssm: null, // non-Windows path
    });
    const report = await runPreflight(deps, { confirm: true });

    // Both should WARN, not FAIL
    expect(report.results.find((r) => r.name === "pm2_not_running_on_4000")?.status).toBe("WARN");
    expect(report.results.find((r) => r.name === "nssm_service_running")?.status).toBe("WARN");

    expect(report.hasFail).toBe(false);
    expect(report.engaged).toBe(true);
    expect(track.engageCalls.length).toBe(1);
  });

  it("n8n workflow missing errorWorkflow → FAIL", async () => {
    const { deps } = makeDeps({
      n8nWorkflows: [
        { id: "w1", active: true, errorWorkflowId: N8N_GLOBAL_ERROR_WORKFLOW, name: "good" },
        { id: "w2", active: true, errorWorkflowId: null, name: "naked-workflow" },
      ],
    });
    const report = await runPreflight(deps, { confirm: false });
    const n8n = report.results.find((r) => r.name === "n8n_error_workflow_attached");
    expect(n8n?.status).toBe("FAIL");
    expect(n8n?.detail).toMatch(/naked-workflow/);
    expect(report.hasFail).toBe(true);
  });

  it("per-firm cookie freshness: one stale firm flips check to FAIL", async () => {
    const { deps } = makeDeps({
      cookieLastAt: {
        mffu: new Date(NOW - MINUTES(20)), // fresh
        topstep: new Date(NOW - HOURS(5)), // stale (>2.5h)
      },
    });
    const report = await runPreflight(deps, { confirm: false });
    const cookie = report.results.find((r) => r.name === "cookie_refresh_heartbeat_fresh_per_firm");
    expect(cookie?.status).toBe("FAIL");
    expect(cookie?.detail).toMatch(/topstep/);
    expect(cookie?.detail).not.toMatch(/mffu \(\d/); // mffu not in stale list
  });

  it("migration drift: applied < journal → FAIL", async () => {
    const { deps } = makeDeps({ appliedMigrations: 130, journalMigrations: 132 });
    const report = await runPreflight(deps, { confirm: false });
    const mig = report.results.find((r) => r.name === "no_pending_migrations");
    expect(mig?.status).toBe("FAIL");
    expect(mig?.detail).toMatch(/Pending=2/);
  });

  it("/api/health missing backtestConcurrency → FAIL (stale binary)", async () => {
    const { deps } = makeDeps({ health: { ok: true } });
    const report = await runPreflight(deps, { confirm: false });
    const h = report.results.find((r) => r.name === "phase14_concurrency_alive");
    expect(h?.status).toBe("FAIL");
    expect(h?.detail).toMatch(/stale binary/i);
  });

  it("BW heartbeat stale (>13h) → FAIL with remediation", async () => {
    const { deps } = makeDeps({ bwLastAt: new Date(NOW - HOURS(14)) });
    const report = await runPreflight(deps, { confirm: false });
    const bw = report.results.find((r) => r.name === "bw_refresh_heartbeat_fresh");
    expect(bw?.status).toBe("FAIL");
    expect(bw?.remediation).toMatch(/bw-session-refresh/);
  });

  it("ADMIN_RESTART_HMAC_SECRET unset → FAIL", async () => {
    const { deps } = makeDeps({ env: {} });
    const report = await runPreflight(deps, { confirm: false });
    const hmac = report.results.find((r) => r.name === "admin_restart_hmac_configured");
    expect(hmac?.status).toBe("FAIL");
  });

  it("each check returns a structured CheckResult (no throws cross over)", async () => {
    const { deps } = makeDeps();
    const report = await runPreflight(deps, { confirm: false });
    for (const r of report.results) {
      const v: CheckResult = r;
      expect(typeof v.name).toBe("string");
      expect(["PASS", "FAIL", "WARN"]).toContain(v.status);
      expect(typeof v.detail).toBe("string");
    }
  });

  it("formatReport renders all results with status tags", () => {
    const fake = {
      results: [
        { name: "check_a", status: "PASS" as const, detail: "ok" },
        { name: "check_b", status: "FAIL" as const, detail: "bad", remediation: "do X" },
        { name: "check_c", status: "WARN" as const, detail: "meh" },
      ],
      hasFail: true,
      allPass: false,
      engaged: false,
    };
    const s = formatReport(fake);
    expect(s).toMatch(/\[PASS\] check_a/);
    expect(s).toMatch(/\[FAIL\] check_b/);
    expect(s).toMatch(/\[WARN\] check_c/);
    expect(s).toMatch(/remediation: do X/);
    expect(s).toMatch(/SOME-FAILED/);
  });
});
