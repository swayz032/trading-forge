/**
 * office-test-server.mts — Playwright E2E harness for the Slumhouse Office.
 *
 * WHAT IS REAL vs STUBBED (no silent stubs — read this before trusting green):
 *
 *   REAL (the product under test):
 *     - public/slumhouse/office.html + office-risk.js + office-approvals.js
 *       (the actual Office UI, served from the actual files)
 *     - src/server/lib/slumhouse/admin-session.ts — the REAL passcode check
 *       (SHA-256 timing-safe), REAL HMAC session token sign/verify, REAL
 *       httpOnly cookie contract
 *     - the 5-fail / 15-min brute-force lockout policy (same constants as
 *       src/server/routes/slumhouse/admin.ts — MAX_FAILS=5, and the endpoint
 *       response contract 429 too_many_attempts)
 *
 *   STUBBED (documented test doubles — the production Express app needs a live
 *   Postgres via src/server/db/index.ts, which this harness intentionally
 *   avoids; contract shapes mirror the real routers 1:1):
 *     - the switch state store (in-memory instead of system_parameters /
 *       system_state rows; response shape copied from computeSwitchStates())
 *     - audit rows (in-memory array exposed at GET /__test__/audit instead of
 *       the audit_log table)
 *     - /api/production/status (controllable healthy/failing double via
 *       POST /__test__/production-status so specs can force the degraded card)
 *     - /slumhouse/admin/deploy-approvals* (fixture strategies — one clean,
 *       one with missing evidence; approve/reject record audit entries instead
 *       of calling lifecycleService.promoteStrategy). The REAL promotion-path
 *       behavior is covered by src/server/__tests__/
 *       layer4-office-deploy-approvals.test.ts (vitest, mocked DB).
 *
 * Env (set by playwright.office.config.ts webServer):
 *   OFFICE_E2E_PORT              (default 4790)
 *   SLUMHOUSE_ADMIN_PASSCODE     (default "1974test")
 *   SLUMHOUSE_SESSION_SECRET     (≥32 chars)
 */
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ADMIN_COOKIE_NAME,
  ADMIN_SESSION_TTL_SEC,
  checkPasscode,
  isAdminConfigured,
  signAdminSession,
  adminSessionFromCookie,
} from "../src/server/lib/slumhouse/admin-session.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.OFFICE_E2E_PORT ?? 4790);

const app = express();
app.use(express.json());

// ─── In-memory audit log (double for audit_log table) ───────────────────────
interface AuditEntry {
  action: string;
  input?: Record<string, unknown>;
  result?: Record<string, unknown>;
  status: string;
  correlationId?: string | null;
  at: string;
}
let auditRows: AuditEntry[] = [];
function audit(e: Omit<AuditEntry, "at">): void {
  auditRows.push({ ...e, at: new Date().toISOString() });
}

// ─── Brute-force lockout (same policy as routes/slumhouse/admin.ts) ─────────
const MAX_FAILS = 5;
let failCount = 0;
let lockedUntil = 0;

// ─── Switch state store (double for system_parameters/system_state) ─────────
interface HarnessState {
  pipelineMode: "ACTIVE" | "PAUSED" | "AUTOPAUSE_DD_VELOCITY";
  learningLoopMode: 0 | 1 | 2;
  vacationOn: boolean;
  liveExecution: boolean;
}
const defaultState = (): HarnessState => ({
  pipelineMode: "PAUSED",
  learningLoopMode: 0,
  vacationOn: false,
  liveExecution: false,
});
let state = defaultState();

function switchStates() {
  const botState =
    state.pipelineMode === "ACTIVE" ? "running" : state.pipelineMode === "AUTOPAUSE_DD_VELOCITY" ? "alert" : "paused";
  const llMode = state.learningLoopMode;
  const llLabel = llMode === 2 ? "AUTOPILOT" : llMode === 1 ? "OBSERVE" : "OFF";
  const recoveryHalted = state.pipelineMode === "AUTOPAUSE_DD_VELOCITY";
  return {
    bot_power: {
      on: state.pipelineMode === "ACTIVE", state: botState, wired: true, dangerOff: true,
      status: botState === "running" ? "RUNNING" : botState === "alert" ? "AUTO-PAUSED" : "PAUSED",
    },
    learning_loop: {
      on: llMode >= 1, mode: llMode, label: llLabel, advisory_on: llMode >= 1,
      autonomous_on: llMode >= 2, state: llMode >= 1 ? "running" : "paused",
      wired: true, status: llLabel, dangerOn: true,
    },
    vacation_mode: {
      on: state.vacationOn, state: state.vacationOn ? "running" : "paused", wired: true,
      status: state.vacationOn ? "AWAY" : "HOME", dangerOn: true,
    },
    recovery: {
      on: false, state: recoveryHalted ? "alert" : "paused", wired: true,
      status: recoveryHalted ? "HALTED" : "ALL CLEAR", momentary: true,
      ...(recoveryHalted ? { confirmAction: true } : {}),
    },
    live_execution: {
      // Harness divergence (documented): wired=true so the toggle is exercisable
      // in E2E; production reports needsSetup until go-live env prereqs exist.
      on: state.liveExecution, state: state.liveExecution ? "running" : "paused",
      wired: true, needsSetup: false, dangerOn: true,
      status: state.liveExecution ? "LIVE" : "PAPER",
    },
  };
}

function requireAdmin(req: express.Request, res: express.Response): boolean {
  if (!adminSessionFromCookie(req.headers.cookie)) {
    res.status(401).json({ ok: false, error: "locked" });
    return false;
  }
  return true;
}

// ─── Office auth endpoints (REAL crypto, real cookie contract) ───────────────
app.get("/slumhouse/admin/status", (req, res) => {
  res.json({ configured: isAdminConfigured(), unlocked: adminSessionFromCookie(req.headers.cookie) });
});

app.post("/slumhouse/admin/auth", (req, res) => {
  const now = Date.now();
  if (!isAdminConfigured()) { res.status(503).json({ ok: false, error: "office_not_configured" }); return; }
  if (lockedUntil > now) {
    audit({ action: "slumhouse_admin.auth_locked_out", status: "warning" });
    res.status(429).json({ ok: false, error: "too_many_attempts" });
    return;
  }
  const passcode = typeof req.body?.passcode === "string" ? req.body.passcode : "";
  if (checkPasscode(passcode)) {
    failCount = 0;
    res.cookie(ADMIN_COOKIE_NAME, signAdminSession(), {
      httpOnly: true, sameSite: "lax", maxAge: ADMIN_SESSION_TTL_SEC * 1000, path: "/slumhouse",
    });
    audit({ action: "slumhouse_admin.auth_success", status: "success" });
    res.json({ ok: true });
    return;
  }
  failCount += 1;
  if (failCount >= MAX_FAILS) lockedUntil = now + 15 * 60 * 1000;
  audit({ action: "slumhouse_admin.auth_failed", status: "warning" });
  res.status(401).json({ ok: false, error: "invalid_passcode" });
});

app.post("/slumhouse/admin/logout", (_req, res) => {
  res.clearCookie(ADMIN_COOKIE_NAME, { path: "/slumhouse" });
  res.json({ ok: true });
});

// ─── Switches (contract mirror of computeSwitchStates/postSwitch) ────────────
app.get("/slumhouse/admin/switches", (req, res) => {
  if (!requireAdmin(req, res)) return;
  res.json({ switches: switchStates() });
});

app.post("/slumhouse/admin/switch", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const id = String(req.body?.id ?? "");
  const on = req.body?.on === true;

  if (id === "bot_power") {
    state.pipelineMode = on ? "ACTIVE" : "PAUSED";
    audit({ action: "slumhouse_admin.switch_toggled", input: { switch: id, on }, status: "success" });
    res.json({ ok: true, id, on, state: on ? "running" : "paused", status: on ? "RUNNING" : "PAUSED" });
    return;
  }
  if (id === "learning_loop") {
    const hasMode = req.body?.mode !== undefined && req.body?.mode !== null;
    const mode = (hasMode ? Math.max(0, Math.min(2, Number(req.body.mode) | 0)) : on ? 2 : 0) as 0 | 1 | 2;
    state.learningLoopMode = mode;
    const label = mode === 2 ? "AUTOPILOT" : mode === 1 ? "OBSERVE" : "OFF";
    audit({ action: "slumhouse_admin.switch_toggled", input: { switch: id, mode }, status: "success" });
    res.json({
      ok: true, id, mode, label, on: mode >= 1, advisory_on: mode >= 1, autonomous_on: mode >= 2,
      state: mode >= 1 ? "running" : "paused", status: label,
    });
    return;
  }
  if (id === "vacation_mode") {
    state.vacationOn = on;
    audit({ action: "slumhouse_admin.switch_toggled", input: { switch: id, on }, status: "success" });
    res.json({ ok: true, id, on, state: on ? "running" : "paused", status: on ? "AWAY" : "HOME" });
    return;
  }
  if (id === "recovery") {
    const cleared: string[] = [];
    if (state.pipelineMode === "AUTOPAUSE_DD_VELOCITY") {
      state.pipelineMode = "ACTIVE";
      cleared.push("AUTOPAUSE_DD_VELOCITY");
    }
    audit({ action: "slumhouse_admin.recovery_triggered", result: { cleared }, status: "success" });
    res.json({ ok: true, id: "recovery", state: "paused", status: cleared.length > 0 ? "CLEARED" : "ALL CLEAR" });
    return;
  }
  if (id === "live_execution") {
    state.liveExecution = on;
    audit({ action: "slumhouse_admin.live_execution_toggled", input: { switch: id, on }, status: "success" });
    res.json({ ok: true, id, on, state: on ? "running" : "paused", status: on ? "LIVE" : "PAPER" });
    return;
  }
  res.status(400).json({ ok: false, error: "unknown_switch", id });
});

// ─── Deploy approvals (fixture double — see header) ──────────────────────────
interface FixtureStrategy {
  id: string; name: string; symbol: string; timeframe: string; lifecycleState: string;
  backtestId: string | null; backtestAgeDays: number | null;
  evidenceState: "ok" | "stale" | "missing";
  evidence: Array<Record<string, unknown>>;
  approvable: boolean; blockers: string[];
}
const fixtureApprovals = (): FixtureStrategy[] => ([
  {
    id: "e2e-strat-clean", name: "orb_mnq_15m", symbol: "MNQ", timeframe: "15m",
    lifecycleState: "DEPLOY_READY", backtestId: "bt-1", backtestAgeDays: 3, evidenceState: "ok",
    evidence: [
      { key: "regime_tests", headline: "Survived 34 market-regime tests", detail: "K_eff 34", value: 34, ok: true, missing: false, hard: false },
      { key: "pbo", headline: "2% chance the results are luck", detail: "PBO 0.020 · limit 0.15", value: 0.02, ok: true, missing: false, hard: true },
      { key: "b14", headline: "97% chance of surviving the firm's rules", detail: "ruin ci_high 0.030 · limit 0.2", value: 0.03, ok: true, missing: false, hard: true },
      { key: "wfe", headline: "Kept 85% of its edge on data it never saw", detail: "WFE 0.85 · floor 0.7", value: 0.85, ok: true, missing: false, hard: true },
      { key: "dsr", headline: "Skill score after honesty adjustment: 1.80", detail: "deflated Sharpe 1.80", value: 1.8, ok: null, missing: false, hard: false },
    ],
    approvable: true, blockers: [],
  },
  {
    id: "e2e-strat-stale", name: "vwap_mes_5m", symbol: "MES", timeframe: "5m",
    lifecycleState: "DEPLOY_READY", backtestId: "bt-2", backtestAgeDays: 44, evidenceState: "stale",
    evidence: [
      { key: "regime_tests", headline: "Market-regime test count unavailable", detail: "k_eff / windows missing", value: null, ok: null, missing: true, hard: false },
      { key: "pbo", headline: "Luck check missing — cannot rule out a lucky backtest", detail: "pbo_overall missing", value: null, ok: null, missing: true, hard: true },
      { key: "b14", headline: "88% chance of surviving the firm's rules", detail: "ruin ci_high 0.120 · limit 0.2", value: 0.12, ok: true, missing: false, hard: true },
      { key: "wfe", headline: "Kept 74% of its edge on data it never saw", detail: "WFE 0.74 · floor 0.7", value: 0.74, ok: true, missing: false, hard: true },
      { key: "dsr", headline: "Honesty-adjusted skill score unavailable", detail: "deflated_sharpe missing", value: null, ok: null, missing: true, hard: false },
    ],
    approvable: false,
    blockers: [
      "Test results are 44 days old (limit 30) — run a fresh backtest first.",
      "Luck check (PBO) is missing from the latest test.",
    ],
  },
]);
let approvals = fixtureApprovals();

app.get("/slumhouse/admin/deploy-approvals", (req, res) => {
  if (!requireAdmin(req, res)) return;
  res.json({ ok: true, strategies: approvals });
});
app.post("/slumhouse/admin/deploy-approvals/:id/approve", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const id = String(req.params.id);
  const s = approvals.find((x) => x.id === id);
  if (!s) { res.status(403).json({ ok: false, error: "Strategy not found" }); return; }
  if (!s.approvable) {
    audit({ action: "slumhouse_admin.deploy_approve_refused", input: { strategyId: id }, result: { blockers: s.blockers }, status: "warning", correlationId: "e2e" });
    res.status(409).json({ ok: false, error: "evidence_not_approvable", blockers: s.blockers });
    return;
  }
  approvals = approvals.filter((x) => x.id !== id);
  audit({ action: "slumhouse_admin.deploy_approved", input: { strategyId: id, via: "office_approval_card" }, status: "success", correlationId: "e2e" });
  res.json({ ok: true, id, newState: "DEPLOYED", correlationId: "e2e" });
});
app.post("/slumhouse/admin/deploy-approvals/:id/reject", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const id = String(req.params.id);
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  if (reason.length < 3) { res.status(400).json({ ok: false, error: "reason_required" }); return; }
  approvals = approvals.filter((x) => x.id !== id);
  audit({ action: "slumhouse_admin.deploy_rejected", input: { strategyId: id, reason }, status: "success", correlationId: "e2e" });
  res.json({ ok: true, id, newState: "PAPER", correlationId: "e2e" });
});

// ─── /api/production/status double (controllable) ────────────────────────────
let productionStatusMode: "ok" | "fail" = "ok";
function healthyProductionStatus() {
  return {
    overall: "green",
    productionMode: "NORMAL",
    sixQuestions: {
      areWeTrading: { answer: "Yes — production mode is NORMAL", halted: false, reason: null, severity: "green" },
      pnlToday: { todayPnl: 120, expectedPnl: 118, delta: 2, severity: "green" },
      drawdownDistance: { bufferRemaining: 812.5, firmLimit: 1000, usedPct: 0.1875, severity: "green" },
      lastCleanReconciliation: { lastCleanDate: "2026-07-01", ageHours: 6.2, severity: "green" },
      killSwitchLayers: {
        overall_halted: false, production_mode: "NORMAL", checked_at: new Date().toISOString(),
        layers: Array.from({ length: 9 }, (_, i) => ({ name: `L${i + 1}`, halted: false, reason: null })),
      },
      alertingStatus: { lastAlertFiredAt: null, minutesSinceLastAlert: null, webhookConfigured: true },
    },
    autopilot_status: {
      operator_absent_mode_active: false, last_heartbeat_at: new Date().toISOString(),
      bw_session_expires_at: null, cookie_refresh_status: { mffu: "fresh", topstep: "fresh" },
      discord_webhook_health: "healthy",
    },
    generatedAt: new Date().toISOString(),
    cacheHit: false,
  };
}
app.get("/api/production/status", (_req, res) => {
  if (productionStatusMode === "fail") { res.status(503).json({ error: "tower_down" }); return; }
  res.json(healthyProductionStatus());
});

// ─── Test control endpoints ───────────────────────────────────────────────────
app.get("/__test__/audit", (_req, res) => { res.json({ rows: auditRows }); });
app.post("/__test__/reset", (_req, res) => {
  auditRows = []; failCount = 0; lockedUntil = 0;
  state = defaultState(); approvals = fixtureApprovals(); productionStatusMode = "ok";
  res.json({ ok: true });
});
app.post("/__test__/production-status", (req, res) => {
  productionStatusMode = req.body?.mode === "fail" ? "fail" : "ok";
  res.json({ ok: true, mode: productionStatusMode });
});
app.post("/__test__/set-pipeline-mode", (req, res) => {
  const m = String(req.body?.mode ?? "");
  if (m === "ACTIVE" || m === "PAUSED" || m === "AUTOPAUSE_DD_VELOCITY") {
    state.pipelineMode = m;
    res.json({ ok: true, mode: m });
    return;
  }
  res.status(400).json({ ok: false });
});

// Quiet 200s for Office side-calls that don't matter to these specs.
app.get("/slumhouse/api/carter-inbox", (_req, res) => { res.json({ items: [] }); });
app.post("/slumhouse/api/carter-session", (_req, res) => { res.status(503).json({ error: "not_in_harness" }); });

// ─── Static Office assets (the REAL files under test) ────────────────────────
const STATIC_DIR = path.resolve(__dirname, "../public/slumhouse");
app.use("/slumhouse", express.static(STATIC_DIR, { index: "office.html", extensions: ["html"] }));

app.listen(PORT, "127.0.0.1", () => {
  // eslint-disable-next-line no-console
  console.log(`office-test-server listening on http://127.0.0.1:${PORT} (office at /slumhouse/office.html)`);
});
