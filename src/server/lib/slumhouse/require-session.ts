/**
 * Express middleware: requires a valid Slumhouse session cookie + a mapped
 * slumhouse_users row with a non-null broker_account_id.
 *
 * On success, attaches `req.slumhouseUser` (typed as SlumhouseUser).
 * Returns 401 (invalid/missing session) or 403 (Discord OK but no mapping yet).
 */
import type { Request, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { slumhouseUsers, type SlumhouseUser } from "../../db/schema.js";
import { verifySession, COOKIE_NAME } from "./session.js";

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
  if (!user || !user.brokerAccountId) {
    res.status(403).json({ error: "user_not_mapped" });
    return;
  }
  req.slumhouseUser = user;
  next();
}
