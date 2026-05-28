/**
 * Slumhouse auth routes — Discord OAuth 2.0 login/callback/logout.
 *
 * Flow:
 *   GET /slumhouse/auth/login    → redirects to discord.com authorize
 *   GET /slumhouse/auth/callback → exchanges code, looks up slumhouse_users,
 *                                  ensures a session row exists, sets HMAC-signed
 *                                  session cookie, redirects to /slumhouse
 *   GET /slumhouse/auth/logout   → clears cookie, redirects to /login.html
 *
 * Handler functions are exported individually so tests can call them with
 * mocked req/res (matches the codebase's no-supertest convention).
 */
import { Router, type Request, type Response } from "express";
import { eq, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { slumhouseUsers, auditLog } from "../../db/schema.js";
import { exchangeCodeForToken, fetchDiscordUser } from "../../lib/slumhouse/discord-oauth.js";
import { signSession, verifySession, COOKIE_NAME } from "../../lib/slumhouse/session.js";
import { logger } from "../../lib/logger.js";
import { insertAuditRowSafe } from "../../lib/audit-log-helper.js";

const SESSION_TTL_SEC = 60 * 60 * 24 * 14; // 14 days

export async function handleLogin(_req: Request, res: Response): Promise<void> {
  // Falls back to DISCORD_APPLICATION_ID — same value Discord shows in the dev portal.
  const clientId = process.env.DISCORD_CLIENT_ID ?? process.env.DISCORD_APPLICATION_ID;
  const redirect = process.env.DISCORD_REDIRECT_URI;
  if (!clientId || !redirect) {
    res.status(500).send("slumhouse_misconfigured: DISCORD_CLIENT_ID/APPLICATION_ID or DISCORD_REDIRECT_URI missing");
    return;
  }
  const url =
    `https://discord.com/api/oauth2/authorize` +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(redirect)}` +
    `&response_type=code` +
    `&scope=identify`;
  res.redirect(302, url);
}

export async function handleCallback(req: Request, res: Response): Promise<void> {
  // User cancelled the Discord OAuth prompt — Discord redirects back with
  // `?error=access_denied`. Treat as a graceful return to login, not an error.
  const oauthError = req.query?.error ? String(req.query.error) : "";
  if (oauthError) {
    await insertAuditRowSafe({
      action: "slumhouse.login_cancelled",
      status: "info",
      input: { error: oauthError, error_description: String(req.query?.error_description ?? "") },
    });
    res.redirect(302, "/slumhouse/login.html");
    return;
  }
  const code = String(req.query?.code ?? "");
  if (!code) {
    res.redirect(302, "/slumhouse/login.html");
    return;
  }

  try {
    const accessToken = await exchangeCodeForToken(code);
    const discordUser = await fetchDiscordUser(accessToken);

    const rows = await db
      .select()
      .from(slumhouseUsers)
      .where(eq(slumhouseUsers.discordUserId, discordUser.id));

    const user = rows[0];
    if (!user) {
      await db.insert(slumhouseUsers).values({
        discordUserId: discordUser.id,
        displayName: discordUser.displayName,
        jerseyNumber: null,
        brokerAccountId: null,
        lastSeenAt: sql`NOW()`,
      }).onConflictDoNothing();
    } else {
      // Keep the friendly display name fresh without disturbing manual mapping.
      db.update(slumhouseUsers)
        .set({ displayName: discordUser.displayName, lastSeenAt: sql`NOW()` })
        .where(eq(slumhouseUsers.discordUserId, discordUser.id))
        .then(() => {})
        .catch((e: unknown) => logger.warn({ err: e }, "slumhouse_last_seen_update_failed"));
    }

    const sid = signSession({ discordUserId: discordUser.id, ttlSec: SESSION_TTL_SEC });
    res.cookie(COOKIE_NAME, sid, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: SESSION_TTL_SEC * 1000,
      path: "/slumhouse",
    });

    // One-shot welcome cookie — Crib reads + clears it on load to fire the
    // welcome modal. Fires once per login (sign out + back in = fires again).
    res.cookie("slumhouse_welcome", "1", {
      httpOnly: false,             // frontend JS reads it
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60_000,              // 1 minute — Crib clears it on first read
      path: "/slumhouse",
    });

    await insertAuditRowSafe({
      action: "slumhouse.login_success",
      status: "success",
      input: { discord_user_id: discordUser.id },
    });
    res.redirect(302, "/slumhouse");
  } catch (err: unknown) {
    logger.error({ err }, "slumhouse_callback_failed");
    await insertAuditRowSafe({
      action: "slumhouse.login_failed",
      status: "failure",
      errorMessage: String((err as Error)?.message ?? err),
    });
    res.status(500).send("oauth_failed");
  }
}

export function handleLogout(_req: Request, res: Response): void {
  res.cookie(COOKIE_NAME, "", {
    httpOnly: true,
    expires: new Date(0),
    path: "/slumhouse",
  });
  res.redirect(302, "/slumhouse/login.html");
}

/**
 * GET /slumhouse/launch — server-side redirect used as the PWA start_url.
 * Reads the slumhouse_sid cookie and routes to the Crib (if signed in) or
 * login (if not), so iPhone/Android home-screen taps land cleanly without
 * the brief Crib-then-Login flash that happens when the protected HTML
 * shell renders before the API auth check fires.
 */
export function handleLaunch(req: Request, res: Response): void {
  const raw = req.headers.cookie ?? "";
  const match = raw.match(/(?:^|;\s*)slumhouse_sid=([^;]+)/);
  if (!match) {
    res.redirect(302, "/slumhouse/login.html");
    return;
  }
  try {
    const verified = verifySession(decodeURIComponent(match[1]));
    if (verified?.discordUserId) {
      res.redirect(302, "/slumhouse/crib.html");
      return;
    }
  } catch {
    /* fall through to login */
  }
  res.redirect(302, "/slumhouse/login.html");
}

export const authRouter = Router();
authRouter.get("/login", handleLogin);
authRouter.get("/callback", handleCallback);
authRouter.get("/logout", handleLogout);
