/**
 * Express middleware: requires a valid Slumhouse session cookie and a
 * slumhouse_users row for the Discord user.
 *
 * On success, attaches `req.slumhouseUser` (typed as SlumhouseUser).
 * Returns 401 for missing/invalid sessions and 403 only when the row is absent.
 */
import type { Request, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { slumhouseUsers, type SlumhouseUser } from "../../db/schema.js";
import { verifySession, COOKIE_NAME } from "./session.js";
import { adminSessionFromCookie } from "./admin-session.js";

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
 * This lets the Office mint a Carter token while friends in The Crib (who hold
 * the Discord session but not the admin cookie) keep their existing access.
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
