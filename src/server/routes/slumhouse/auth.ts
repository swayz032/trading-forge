/**
 * Slumhouse auth routes — Discord OAuth 2.0 login/callback/logout.
 *
 * Flow:
 *   GET /slumhouse/auth/login    → redirects to discord.com authorize
 *   GET /slumhouse/auth/callback → exchanges code, looks up slumhouse_users
 *                                  mapping, sets HMAC-signed session cookie,
 *                                  redirects to /slumhouse (or /not-mapped.html)
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
import { signSession, COOKIE_NAME } from "../../lib/slumhouse/session.js";
import { logger } from "../../lib/logger.js";
import { insertAuditRowSafe } from "../../lib/audit-log-helper.js";

const SESSION_TTL_SEC = 60 * 60 * 24 * 14; // 14 days

export async function handleLogin(_req: Request, res: Response): Promise<void> {
  const clientId = process.env.DISCORD_CLIENT_ID;
  const redirect = process.env.DISCORD_REDIRECT_URI;
  if (!clientId || !redirect) {
    res.status(500).send("slumhouse_misconfigured: DISCORD_CLIENT_ID or DISCORD_REDIRECT_URI missing");
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
  const code = String(req.query?.code ?? "");
  if (!code) {
    res.status(400).send("missing_code");
    return;
  }

  try {
    const accessToken = await exchangeCodeForToken(code);
    const discordUser = await fetchDiscordUser(accessToken);

    const rows = await db
      .select()
      .from(slumhouseUsers)
      .where(eq(slumhouseUsers.discordUserId, discordUser.id));

    if (rows.length === 0) {
      await insertAuditRowSafe({
        action: "slumhouse.login_unmapped_user",
        status: "warning",
        input: { discord_user_id: discordUser.id, username: discordUser.username },
      });
      res.redirect(302, "/slumhouse/not-mapped.html");
      return;
    }

    // Stamp last_seen (best-effort — never blocks login on a DB hiccup)
    db.update(slumhouseUsers)
      .set({ lastSeenAt: sql`NOW()` })
      .where(eq(slumhouseUsers.discordUserId, discordUser.id))
      .then(() => {})
      .catch((e: unknown) => logger.warn({ err: e }, "slumhouse_last_seen_update_failed"));

    const sid = signSession({ discordUserId: discordUser.id, ttlSec: SESSION_TTL_SEC });
    res.cookie(COOKIE_NAME, sid, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: SESSION_TTL_SEC * 1000,
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

export const authRouter = Router();
authRouter.get("/login", handleLogin);
authRouter.get("/callback", handleCallback);
authRouter.get("/logout", handleLogout);
