/**
 * Express middleware: requires a valid Slumhouse session cookie and a
 * slumhouse_users row for the Discord user.
 *
 * On success, attaches `req.slumhouseUser` (typed as SlumhouseUser).
 * Returns 401 for missing/invalid sessions and 403 only when the row is absent.
 *
 * FIX 1 (deep-scan #12): requireAdminSession is now a proper Express NextFunction
 * middleware exported from here, replacing the local bool-returning helper in
 * admin.ts for use in routes that mount guards via app.use() / router.use().
 *
 * FIX 4 (deep-scan #12): requireSlumhouseUser now verifies the session epoch
 * against slumhouse_users.session_epoch in the DB. A mismatch means the session
 * was revoked via POST /slumhouse/admin/revoke-sessions.
 *
 * FIX 5 (deep-scan #12): checkSlumhouseOrigin is a shared helper that enforces
 * Origin allowlisting on state-mutating Slumhouse POSTs. Import and call it at
 * the top of any mutation handler that changes pipeline state.
 */
import type { Request, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { slumhouseUsers, type SlumhouseUser } from "../../db/schema.js";
import { verifySession, COOKIE_NAME } from "./session.js";
import { adminSessionFromCookie } from "./admin-session.js";
import { insertAuditRowSafe } from "../audit-log-helper.js";

export interface SlumhouseRequest extends Request {
  slumhouseUser?: SlumhouseUser;
}

export async function requireSlumhouseUser(
  req: SlumhouseRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const cookieHeader = req.headers.cookie ?? "";
  const match = cookieHeader.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  if (!match) {
    res.status(401).json({ error: "no_session" });
    return;
  }
  // Express's res.cookie() URL-encodes the value by default; decode before
  // verifying the HMAC-signed token (which uses colons as separators).
  const rawCookie = decodeURIComponent(match[1]);
  const ver = verifySession(rawCookie);
  if (!ver.ok) {
    res.status(401).json({ error: "invalid_session", reason: ver.reason });
    return;
  }
  const rows = await db
    .select()
    .from(slumhouseUsers)
    .where(eq(slumhouseUsers.discordUserId, ver.discordUserId))
    .catch(() => [] as SlumhouseUser[]);

  const user = rows[0];
  if (!user) {
    res.status(403).json({ error: "user_not_mapped" });
    return;
  }

  // FIX 4: reject tokens signed under a revoked epoch.
  // ver.epoch = 0 for v1 legacy tokens; user.sessionEpoch = 0 by default.
  // After POST /slumhouse/admin/revoke-sessions, user.sessionEpoch is incremented,
  // so v1 tokens (epoch=0) are also rejected once the DB epoch exceeds 0.
  if (ver.epoch !== user.sessionEpoch) {
    res.status(401).json({ error: "session_revoked" });
    return;
  }

  req.slumhouseUser = user;
  next();
}

/**
 * Express middleware: accepts EITHER a valid Slumhouse Discord session
 * (slumhouse_sid + slumhouse_users row) OR a valid Office admin/passcode
 * session (slumhouse_admin_sid).
 *
 * The Carter connect page lives inside the operator-only Office (gated by the
 * admin passcode), so an operator there may not also hold a Discord session.
 * NOTE: as of FIX 1 (deep-scan #12), the Carter *token mint* endpoint is
 * admin-ONLY (requireAdminSession below). This middleware is kept for other
 * endpoints that intentionally allow both sessions.
 *
 * FAIL-CLOSED: one of the two valid sessions is required. When the admin
 * session is absent/invalid we delegate to requireSlumhouseUser, which emits
 * the standard 401/403 for a missing/invalid Discord session.
 */
export async function requireSlumhouseUserOrAdmin(
  req: SlumhouseRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  // adminSessionFromCookie is self-contained and fail-closed (returns false on
  // any error, including an unset SLUMHOUSE_SESSION_SECRET).
  if (adminSessionFromCookie(req.headers.cookie)) {
    next();
    return;
  }
  await requireSlumhouseUser(req, res, next);
}

/**
 * FIX 1 (deep-scan #12): Express middleware that requires a valid Office admin
 * session cookie (slumhouse_admin_sid). Returns 401 when the cookie is absent
 * or the HMAC is invalid/expired.
 *
 * Use this instead of requireSlumhouseUserOrAdmin for endpoints that must be
 * restricted to the operator (Carter token mint, revoke-sessions, etc.). A
 * plain Discord friend session is NOT sufficient.
 */
export async function requireAdminSession(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (adminSessionFromCookie(req.headers.cookie)) {
    next();
    return;
  }
  res.status(401).json({ error: "admin_session_required" });
}

/**
 * FIX 5 (deep-scan #12): Synchronous Origin allowlist check for state-mutating
 * Slumhouse POSTs. Returns true (allowed) or false after sending 403.
 *
 * Logic:
 *   - No Origin header → same-origin browser navigation or non-browser client.
 *     Allow: sameSite:lax is the primary CSRF defense; this is defense-in-depth.
 *   - Origin header present → compare against SLUMHOUSE_ALLOWED_ORIGINS (comma-sep
 *     env var). If the env is unset, derives allowed origins from the request host
 *     so local/dev setups are not broken.
 *   - Mismatch → 403 + async audit row (non-blocking).
 *
 * Callers: admin.ts postAuth, postSwitch, postRevokeSessions;
 *          carter-session.ts postCarterSession.
 */
export function checkSlumhouseOrigin(req: Request, res: Response): boolean {
  const origin = req.headers.origin;
  if (!origin) {
    // No Origin header — not a cross-origin request.
    return true;
  }

  const allowedRaw = process.env.SLUMHOUSE_ALLOWED_ORIGINS ?? "";
  let allowed: string[];
  if (allowedRaw.trim()) {
    allowed = allowedRaw.split(",").map((s) => s.trim()).filter(Boolean);
  } else {
    // Derive from request host so no env config is needed in local/dev.
    const host = req.headers.host ?? "";
    allowed = [
      `https://${host}`,
      `http://${host}`,
    ];
  }

  if (allowed.includes(origin)) {
    return true;
  }

  // Non-blocking audit row — don't await inside a sync guard.
  void insertAuditRowSafe({
    action: "slumhouse_admin.csrf_blocked",
    status: "warning",
    input: { origin, allowed } as Record<string, unknown>,
    correlationId: null,
  });

  res.status(403).json({ ok: false, error: "forbidden_origin" });
  return false;
}
