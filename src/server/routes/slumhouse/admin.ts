/**
 * Slumhouse "The Office" — operator-only passcode-gated admin endpoints.
 *
 * Pass 1 (foundation): passcode auth + session + status. No control actions yet —
 * the floating switch-cards and their toggle endpoints land in later passes once
 * the operator has verified the page shell + background.
 *
 * Routes (all under /slumhouse/admin):
 *   POST /slumhouse/admin/auth    { passcode }  → sets slumhouse_admin_sid cookie
 *   POST /slumhouse/admin/logout                 → clears the cookie
 *   GET  /slumhouse/admin/status                 → { configured, unlocked }
 *
 * Security:
 *   - Passcode compared timing-safe against SLUMHOUSE_ADMIN_PASSCODE (env). Unset
 *     ⇒ Office permanently locked (fail-closed). See admin-session.ts.
 *   - Separate from the friend Discord session — Discord identity grants nothing here.
 *   - Per-IP brute-force throttle (in-memory): lock out after too many failures.
 *   - Every auth attempt audited (slumhouse_admin.auth_*).
 */
import { Router, type Request, type Response } from "express";
import {
  ADMIN_COOKIE_NAME,
  ADMIN_SESSION_TTL_SEC,
  checkPasscode,
  isAdminConfigured,
  signAdminSession,
  adminSessionFromCookie,
} from "../../lib/slumhouse/admin-session.js";
import { insertAuditRowSafe } from "../../lib/audit-log-helper.js";
import { logger } from "../../lib/logger.js";
import { getMode, setMode } from "../../services/pipeline-control-service.js";
import { db } from "../../db/index.js";
import { systemParameters, systemState } from "../../db/schema.js";
import { eq } from "drizzle-orm";
import { clearOperatorAbsenceMarkers } from "../../services/dead-mans-heartbeat-service.js";
import { operatorAbsentModeActive } from "../../services/operator-absent-mode-service.js";
import {
  isLiveExecutionConfigured,
  getExecutionMode,
  setExecutionMode,
} from "../../lib/execution-mode.js";
import {
  parseLearningLoopMode,
  learningLoopModeLabel,
  LEARNING_LOOP_MODE_PARAM,
  MODE_OBSERVE,
  MODE_AUTOPILOT,
  type LearningLoopMode,
} from "../../lib/learning-loop-mode.js";

export const adminOfficeRouter = Router();

// ─── In-memory brute-force throttle ─────────────────────────────────────────
const MAX_FAILS = 5;
const WINDOW_MS = 10 * 60 * 1000; // 10 min
const LOCKOUT_MS = 15 * 60 * 1000; // 15 min after MAX_FAILS
interface Attempt {
  fails: number;
  firstFailTs: number;
  lockedUntil: number;
}
const attempts = new Map<string, Attempt>();

function clientKey(req: Request): string {
  return (
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
    req.socket?.remoteAddress ||
    "unknown"
  );
}

function isLockedOut(key: string, now: number): boolean {
  const a = attempts.get(key);
  if (!a) return false;
  if (a.lockedUntil > now) return true;
  // window expired → reset
  if (now - a.firstFailTs > WINDOW_MS) {
    attempts.delete(key);
    return false;
  }
  return false;
}

function recordFail(key: string, now: number): void {
  const a = attempts.get(key) ?? { fails: 0, firstFailTs: now, lockedUntil: 0 };
  if (now - a.firstFailTs > WINDOW_MS) {
    a.fails = 0;
    a.firstFailTs = now;
  }
  a.fails += 1;
  if (a.fails >= MAX_FAILS) {
    a.lockedUntil = now + LOCKOUT_MS;
  }
  attempts.set(key, a);
}

function clearFails(key: string): void {
  attempts.delete(key);
}

function setAdminCookie(res: Response, token: string): void {
  res.cookie(ADMIN_COOKIE_NAME, token, {
    httpOnly: true,
    // Match the working Discord session cookie (auth.ts) — a hardcoded `secure:true`
    // prevented the browser from persisting the admin session in this tower/relay
    // setup, so the Office re-prompted for the passcode on every return.
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: ADMIN_SESSION_TTL_SEC * 1000,
    path: "/slumhouse",
  });
}

adminOfficeRouter.get("/slumhouse/admin/status", (req: Request, res: Response) => {
  res.json({
    configured: isAdminConfigured(),
    unlocked: adminSessionFromCookie(req.headers.cookie),
  });
});

adminOfficeRouter.post("/slumhouse/admin/auth", async (req: Request, res: Response) => {
  const now = Date.now();
  const key = clientKey(req);

  if (!isAdminConfigured()) {
    res.status(503).json({ ok: false, error: "office_not_configured" });
    return;
  }

  if (isLockedOut(key, now)) {
    await insertAuditRowSafe({
      action: "slumhouse_admin.auth_locked_out",
      entityType: "system",
      entityId: null,
      decisionAuthority: "gate",
      input: { ip: key } as Record<string, unknown>,
      result: {} as Record<string, unknown>,
      status: "warning",
      correlationId: null,
    });
    res.status(429).json({ ok: false, error: "too_many_attempts" });
    return;
  }

  const passcode = typeof req.body?.passcode === "string" ? req.body.passcode : "";
  if (checkPasscode(passcode)) {
    clearFails(key);
    setAdminCookie(res, signAdminSession());
    await insertAuditRowSafe({
      action: "slumhouse_admin.auth_success",
      entityType: "system",
      entityId: null,
      decisionAuthority: "human",
      input: { ip: key } as Record<string, unknown>,
      result: {} as Record<string, unknown>,
      status: "success",
      correlationId: null,
    });
    res.json({ ok: true });
    return;
  }

  recordFail(key, now);
  logger.warn({ ip: key }, "slumhouse_admin: passcode auth failed");
  await insertAuditRowSafe({
    action: "slumhouse_admin.auth_failed",
    entityType: "system",
    entityId: null,
    decisionAuthority: "gate",
    input: { ip: key } as Record<string, unknown>,
    result: {} as Record<string, unknown>,
    status: "warning",
    correlationId: null,
  });
  res.status(401).json({ ok: false, error: "invalid_passcode" });
});

adminOfficeRouter.post("/slumhouse/admin/logout", (req: Request, res: Response) => {
  res.clearCookie(ADMIN_COOKIE_NAME, { path: "/slumhouse" });
  res.json({ ok: true });
});

// ─── The Office switches (Pass 4) ───────────────────────────────────────────
// Operator-only (admin session required). Pass 4 wires Bot Power (the master
// pause/resume) to the live pipeline; the others render but are not wired yet.
function requireAdminSession(req: Request, res: Response): boolean {
  if (!adminSessionFromCookie(req.headers.cookie)) {
    res.status(401).json({ ok: false, error: "locked" });
    return false;
  }
  return true;
}

// Named so tests can import the handler directly.
export async function getSwitchStates(req: Request, res: Response): Promise<void> {
  if (!requireAdminSession(req, res)) return;

  // ── bot_power ─────────────────────────────────────────────────────────────
  let mode: string | null = null;
  try { mode = await getMode(); } catch { mode = null; }
  // 3-state: running (green) / paused (blank/neutral) / alert (red — safety auto-pause)
  let botState: "running" | "paused" | "alert" = "paused";
  if (mode === "ACTIVE") botState = "running";
  else if (mode === "AUTOPAUSE_DD_VELOCITY") botState = "alert";
  const botStatus = botState === "running" ? "RUNNING" : botState === "alert" ? "AUTO-PAUSED" : "PAUSED";

  // ── learning_loop: read auto_patch_loop_enabled (3-MODE) ──────────────────
  // current_value is NUMERIC — never store the string "true".
  //   0 = OFF / 1 = OBSERVE (advisory only) / 2 = AUTOPILOT (autonomous).
  // The UI dial needs the exact mode (0/1/2) + a label to show the right
  // position. `on` (legacy boolean) = mode >= 1 (dial not at OFF). Fail-CLOSED
  // to mode 0 on any error. Derived via the shared parseLearningLoopMode().
  let llMode: LearningLoopMode = 0;
  try {
    const llRows = await db
      .select({ val: systemParameters.currentValue })
      .from(systemParameters)
      .where(eq(systemParameters.paramName, LEARNING_LOOP_MODE_PARAM))
      .limit(1);
    llMode = llRows.length > 0 ? parseLearningLoopMode(llRows[0].val) : 0;
  } catch {
    llMode = 0; // fail-closed
  }
  const llLabel = learningLoopModeLabel(llMode);
  const llOn = llMode >= MODE_OBSERVE;

  // ── vacation_mode: TRUE effective state (env override OR operator_absent_since) ──
  // Read via operatorAbsentModeActive() so the switch reflects REALITY: the
  // OPERATOR_ABSENT_AUTOPROMOTE env var forces vacation on regardless of the DB
  // timestamp. Reading operatorAbsentSince alone would show OFF while autopilot
  // is actually firing (audit V-3). Fail-closed to false on error.
  let vmOn = false;
  try {
    vmOn = await operatorAbsentModeActive();
  } catch {
    vmOn = false; // fail-closed
  }

  // ── live_execution: configured only when go-live env prereqs are met ────────
  // getExecutionMode() is fail-closed: returns "paper" on DB error or missing config.
  let liveMode: "paper" | "live" = "paper";
  try { liveMode = await getExecutionMode(); } catch { liveMode = "paper"; }

  // ── recovery: reflects live pipeline halt — never a persistent "on" ───────
  // Reuses `mode` already read for bot_power — no extra DB round-trip needed.
  const recoveryHalted = mode === "AUTOPAUSE_DD_VELOCITY";

  res.json({
    switches: {
      bot_power:     { on: mode === "ACTIVE", state: botState, wired: true, dangerOff: true, status: botStatus },
      learning_loop: {
        on: llOn,
        mode: llMode,
        label: llLabel,
        advisory_on: llMode >= MODE_OBSERVE,
        autonomous_on: llMode >= MODE_AUTOPILOT,
        state: llOn ? "running" : "paused",
        wired: true,
        status: llLabel,
        dangerOn: true,
      },
      vacation_mode: {
        on: vmOn,
        state: vmOn ? "running" : "paused",
        wired: true,
        status: vmOn ? "AWAY" : "HOME",
        dangerOn: true,
      },
      recovery: {
        on: false,
        state: recoveryHalted ? "alert" : "paused",
        wired: true,
        status: recoveryHalted ? "HALTED" : "ALL CLEAR",
        momentary: true,
        ...(recoveryHalted ? { confirmAction: true } : {}),
      },
      live_execution: (() => {
        const configured = isLiveExecutionConfigured();
        const live = liveMode === "live";
        return {
          on: live,
          state: live ? "running" : "paused",
          wired: configured,
          needsSetup: !configured,
          dangerOn: true,
          status: live ? "LIVE" : configured ? "PAPER" : "NEEDS SETUP",
        };
      })(),
    },
  });
}

adminOfficeRouter.get("/slumhouse/admin/switches", getSwitchStates);

// Named so tests can import the handler directly.
export async function postSwitch(req: Request, res: Response): Promise<void> {
  if (!requireAdminSession(req, res)) return;
  const id = typeof req.body?.id === "string" ? req.body.id : "";
  const on = req.body?.on === true;

  // ── bot_power ─────────────────────────────────────────────────────────────
  // DO NOT modify this block — bot_power wiring is production-verified.
  if (id === "bot_power") {
    const newMode = on ? "ACTIVE" : "PAUSED";
    try {
      await setMode(newMode, "slumhouse Office operator toggle", null);
    } catch (err) {
      logger.error({ err }, "slumhouse Office: bot_power toggle failed");
      res.status(500).json({ ok: false, error: "toggle_failed" });
      return;
    }
    await insertAuditRowSafe({
      action: "slumhouse_admin.switch_toggled",
      entityType: "system",
      entityId: null,
      decisionAuthority: "human",
      input: { switch: id, on } as Record<string, unknown>,
      result: { mode: newMode } as Record<string, unknown>,
      status: "success",
      correlationId: null,
    });
    res.json({ ok: true, id, on, state: on ? "running" : "paused", status: on ? "RUNNING" : "PAUSED" });
    return;
  }

  // ── learning_loop: 3-MODE numeric in system_parameters ────────────────────
  // current_value is a NUMERIC column. 0=OFF / 1=OBSERVE / 2=AUTOPILOT. Never "true".
  // The frontend dial sends `{ mode: 0|1|2 }`. Legacy callers that send only
  // `{ on: bool }` map on:true → 2 (AUTOPILOT, preserves the old "Learning Loop
  // ON = full autonomous" meaning) and on:false → 0. An explicit `mode` always
  // wins over a legacy `on`.
  if (id === "learning_loop") {
    const hasMode =
      req.body?.mode !== undefined && req.body?.mode !== null;
    const targetMode: LearningLoopMode = hasMode
      ? parseLearningLoopMode(req.body.mode)
      : on
        ? MODE_AUTOPILOT // legacy on:true → AUTOPILOT
        : 0; // legacy on:false → OFF
    const newVal = String(targetMode);
    const label = learningLoopModeLabel(targetMode);
    try {
      // Read-then-write mirrors pipeline-control-service.ts pattern.
      const existing = await db
        .select({ id: systemParameters.id })
        .from(systemParameters)
        .where(eq(systemParameters.paramName, LEARNING_LOOP_MODE_PARAM))
        .limit(1);
      if (existing.length > 0) {
        await db
          .update(systemParameters)
          .set({ currentValue: newVal, updatedAt: new Date() })
          .where(eq(systemParameters.paramName, LEARNING_LOOP_MODE_PARAM));
      } else {
        await db.insert(systemParameters).values({
          paramName: LEARNING_LOOP_MODE_PARAM,
          currentValue: newVal,
          domain: "critic",
          description:
            "Autonomous learning-loop mode (0=OFF, 1=OBSERVE advisory-only, " +
            "2=AUTOPILOT autonomous). Shared with quantum-replay-weekly.",
        });
      }
    } catch (err) {
      logger.error({ err }, "slumhouse Office: learning_loop toggle failed");
      res.status(500).json({ ok: false, error: "toggle_failed" });
      return;
    }
    await insertAuditRowSafe({
      action: "slumhouse_admin.switch_toggled",
      entityType: "system",
      entityId: null,
      decisionAuthority: "human",
      input: { switch: id, mode: targetMode, on } as Record<string, unknown>,
      result: { value: newVal, mode: targetMode, label } as Record<string, unknown>,
      status: "success",
      correlationId: null,
    });
    res.json({
      ok: true,
      id,
      mode: targetMode,
      label,
      on: targetMode >= MODE_OBSERVE,
      advisory_on: targetMode >= MODE_OBSERVE,
      autonomous_on: targetMode >= MODE_AUTOPILOT,
      state: targetMode >= MODE_OBSERVE ? "running" : "paused",
      status: label,
    });
    return;
  }

  // ── vacation_mode: operator_absent_since in system_state ──────────────────
  // on=true  → set operator_absent_since = now (mirrors heartbeat-service set-since).
  // on=false → clear both absence columns (mirrors /operator-mark-present route).
  if (id === "vacation_mode") {
    try {
      if (on) {
        await db
          .update(systemState)
          .set({ operatorAbsentSince: new Date() })
          .where(eq(systemState.id, 1));
      } else {
        await clearOperatorAbsenceMarkers();
      }
    } catch (err) {
      logger.error({ err }, "slumhouse Office: vacation_mode toggle failed");
      res.status(500).json({ ok: false, error: "toggle_failed" });
      return;
    }
    await insertAuditRowSafe({
      action: "slumhouse_admin.switch_toggled",
      entityType: "system",
      entityId: null,
      decisionAuthority: "human",
      input: { switch: id, on } as Record<string, unknown>,
      result: { operatorAbsent: on } as Record<string, unknown>,
      status: "success",
      correlationId: null,
    });
    res.json({ ok: true, id, on, state: on ? "running" : "paused", status: on ? "AWAY" : "HOME" });
    return;
  }

  // ── recovery: momentary — clears AUTOPAUSE_DD_VELOCITY pipeline mode ──────
  // Not a persistent toggle.  Fail-soft on all errors — never crash the route.
  if (id === "recovery") {
    const cleared: string[] = [];
    let clearErr: unknown = null;
    try {
      const currentMode = await getMode();
      if (currentMode === "AUTOPAUSE_DD_VELOCITY") {
        await setMode("ACTIVE", "slumhouse Office recovery clear", null);
        cleared.push("AUTOPAUSE_DD_VELOCITY");
      }
    } catch (err) {
      clearErr = err;
      logger.error({ err }, "slumhouse Office: recovery clear failed");
      // Fail-soft: proceed to audit + response regardless.
    }
    await insertAuditRowSafe({
      action: "slumhouse_admin.recovery_triggered",
      entityType: "system",
      entityId: null,
      decisionAuthority: "human",
      input: { switch: id } as Record<string, unknown>,
      result: { cleared, error: clearErr ? String(clearErr) : null } as Record<string, unknown>,
      status: clearErr !== null && cleared.length === 0 ? "warning" : "success",
      correlationId: null,
    });
    res.json({ ok: true, id: "recovery", state: "paused", status: cleared.length > 0 ? "CLEARED" : "ALL CLEAR" });
    return;
  }

  // ── live_execution: fail-closed — 503 until go-live prereqs are met ────────
  if (id === "live_execution") {
    if (!isLiveExecutionConfigured()) {
      res.status(503).json({
        ok: false,
        error: "live_execution_not_configured",
        hint: "Set SERVER_MEDIATED_EXECUTION_ENABLED=true and BROKER_FILL_HMAC_SECRET (≥32 chars) before enabling live execution.",
      });
      return;
    }
    await setExecutionMode(on);
    await insertAuditRowSafe({
      action: "slumhouse_admin.live_execution_toggled",
      entityType: "system",
      entityId: null,
      decisionAuthority: "human",
      input: { switch: id, on } as Record<string, unknown>,
      result: { mode: on ? "live" : "paper" } as Record<string, unknown>,
      status: "success",
      correlationId: null,
    });
    res.json({
      ok: true,
      id: "live_execution",
      on,
      state: on ? "running" : "paused",
      status: on ? "LIVE" : "PAPER",
    });
    return;
  }

  // ── unknown switch id ──────────────────────────────────────────────────────
  res.status(400).json({ ok: false, error: "unknown_switch", id });
}

adminOfficeRouter.post("/slumhouse/admin/switch", postSwitch);
