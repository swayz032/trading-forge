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

adminOfficeRouter.get("/slumhouse/admin/switches", async (req: Request, res: Response) => {
  if (!requireAdminSession(req, res)) return;
  let mode: string | null = null;
  try { mode = await getMode(); } catch { mode = null; }
  // 3-state: running (green) / paused (blank/neutral) / alert (red — safety auto-pause)
  let botState: "running" | "paused" | "alert" = "paused";
  if (mode === "ACTIVE") botState = "running";
  else if (mode === "AUTOPAUSE_DD_VELOCITY") botState = "alert";
  const botStatus = botState === "running" ? "RUNNING" : botState === "alert" ? "AUTO-PAUSED" : "PAUSED";
  res.json({
    switches: {
      bot_power:      { on: mode === "ACTIVE", state: botState, wired: true, dangerOff: true, status: botStatus },
      learning_loop:  { on: false, state: "paused", wired: false, status: "COMING SOON" },
      vacation_mode:  { on: false, state: "paused", wired: false, status: "COMING SOON" },
      recovery:       { on: false, state: "paused", wired: false, status: "COMING SOON" },
      live_execution: { on: false, state: "paused", wired: false, needsSetup: true, status: "NEEDS SETUP" },
    },
  });
});

adminOfficeRouter.post("/slumhouse/admin/switch", async (req: Request, res: Response) => {
  if (!requireAdminSession(req, res)) return;
  const id = typeof req.body?.id === "string" ? req.body.id : "";
  const on = req.body?.on === true;

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
    res.json({ ok: true, id, on, status: on ? "RUNNING" : "PAUSED" });
    return;
  }

  res.status(501).json({ ok: false, error: "not_wired_yet", id });
});
