import type { Request, Response, NextFunction } from "express";
import { timingSafeEqual } from "node:crypto";
import { verifySession, COOKIE_NAME } from "../lib/slumhouse/session.js";
import { adminSessionFromCookie } from "../lib/slumhouse/admin-session.js";

/**
 * /api auth — deep-scan #13 Track A.
 *
 * Accepts, in priority order:
 *   1. Authorization: Bearer <API_KEY>            (n8n, scripts, crons — all methods)
 *   2. Office admin session cookie                (operator browser — all methods)
 *   3. Slumhouse Discord session cookie           (friend browser — GET/HEAD only)
 *   4. AUTH_DEV_BYPASS=true                       (explicit local dev — never in prod .env)
 *
 * There is deliberately NO implicit NODE_ENV bypass: the Railway relay forwards
 * public internet traffic to localhost:4000, so "dev mode" is not a trust signal.
 * With API_KEY unset and no bypass flag, requests get 503 auth_not_configured —
 * fail-closed and loud rather than silently open.
 */

// 60s cache of discordUserId -> sessionEpoch so the revocation check
// (deep-scan #12 FIX 4) doesn't hit the DB on every /api request.
const _epochCache = new Map<string, { epoch: number; expiresAt: number }>();
const EPOCH_CACHE_TTL_MS = 60_000;

export function _clearEpochCacheForTests(): void {
  _epochCache.clear();
}

async function sessionEpochFor(discordUserId: string): Promise<number> {
  const cached = _epochCache.get(discordUserId);
  if (cached && Date.now() < cached.expiresAt) return cached.epoch;
  try {
    // Lazy import keeps this module loadable in unit tests without a DB.
    const { db } = await import("../db/index.js");
    const { slumhouseUsers } = await import("../db/schema.js");
    const { eq } = await import("drizzle-orm");
    const rows = await db
      .select({ sessionEpoch: slumhouseUsers.sessionEpoch })
      .from(slumhouseUsers)
      .where(eq(slumhouseUsers.discordUserId, discordUserId))
      .limit(1);
    const epoch = rows[0]?.sessionEpoch ?? 0;
    _epochCache.set(discordUserId, { epoch, expiresAt: Date.now() + EPOCH_CACHE_TTL_MS });
    return epoch;
  } catch {
    // DB unreachable: fall back to token epoch (fail-open for READ surface only —
    // this path is only reachable for GET/HEAD).
    return -1;
  }
}

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  // 0. Self-authenticating admin routes — deep-scan #17 CRITICAL, extended deep-scan #18 G-1.
  //    /api/admin/self-restart and /ollama-health-recheck carry their OWN
  //    ADMIN_RESTART_HMAC_SECRET HMAC (verifyRestartHmac, 60s replay window) and are
  //    mounted AFTER this gate. When API_KEY is unset the gate returns 503
  //    auth_not_configured BEFORE the route's HMAC runs — which silently kills the
  //    dead-man's-heartbeat self-restart AND the n8n TF Health Watchdog restart (the
  //    flagship vacation-safety path: on a 14-day absence a soft-hang could never
  //    self-heal). The Bearer gate adds only a failure mode, never security, for these
  //    HMAC-signed routes — the same rationale that mounts the tradingview/broker-fill
  //    webhooks BEFORE this gate in index.ts. suffix-match is robust to base-path
  //    stripping (req.path is "/admin/..." here; originalUrl is "/api/admin/...").
  //
  //    deep-scan #18 G-1: the SAME bug existed on three sibling self-HMAC routes that
  //    e75f337 (deep-scan #17) missed — /clear-kill-switch-cache + /clear-stuck-session
  //    (admin-recovery.ts, self-authenticate via ADMIN_RESTART_HMAC_SECRET, same
  //    verifyRestartHmac payload shape "${timestamp}:${reason}") and
  //    /frozen-policy-override (admin-frozen-policy-override.ts, self-authenticates via
  //    ADMIN_OVERRIDE_HMAC_SECRET, payload "${timestamp}:${strategy_id}:${rationale}",
  //    and additionally hard-503s itself when the secret is unset in production). All
  //    three are vacation-mode recovery paths a phone-only operator must be able to
  //    curl without a distributed API_KEY — bypassing the Bearer gate here is safe
  //    because each route's own HMAC + replay-window check is the real gate.
  if (
    req.method === "POST" &&
    typeof req.path === "string" &&
    (req.path.endsWith("/admin/self-restart") ||
      req.path.endsWith("/admin/ollama-health-recheck") ||
      req.path.endsWith("/admin/clear-kill-switch-cache") ||
      req.path.endsWith("/admin/clear-stuck-session") ||
      req.path.endsWith("/admin/frozen-policy-override"))
  ) {
    next();
    return;
  }

  // 1. Bearer API key
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    // deep-scan libs/discord F-2 (2026-07-06): constant-time compare (was plain ===), matching the codebase's
    // timingSafeEqual bar (slumhouse/session, admin-session, carter-auth) — no timing oracle on the primary key.
    const provided = authHeader.slice(7);
    const expected = process.env.API_KEY;
    if (
      expected &&
      provided.length === expected.length &&
      timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
    ) {
      next();
      return;
    }
    res.status(403).json({ error: "Invalid API key" });
    return;
  }

  // 2. Office admin cookie — full access (operator)
  if (adminSessionFromCookie(req.headers.cookie)) {
    next();
    return;
  }

  // 3. Discord Slumhouse cookie — read-only surface
  if (req.method === "GET" || req.method === "HEAD") {
    const cookieHeader = req.headers.cookie ?? "";
    // Anchor to a cookie boundary (deep-scan 2026-07-09, LOW): without (?:^|;\s*) a
    // cookie whose name merely ENDS WITH COOKIE_NAME (e.g. `xslumhouse_sid=…`)
    // substring-matches and gets decoded as the session value. Not privilege-escalation
    // (still must pass verifySession HMAC) but a defense-in-depth gap — align to the
    // already-hardened siblings require-session.ts:43 + this file's slumhouse parser.
    const m = cookieHeader.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
    if (m) {
      const ver = verifySession(decodeURIComponent(m[1]));
      if (ver.ok) {
        const dbEpoch = await sessionEpochFor(ver.discordUserId);
        if (dbEpoch === -1 || (ver.epoch ?? 0) === dbEpoch) {
          next();
          return;
        }
        res.status(401).json({ error: "session_revoked" });
        return;
      }
    }
  }

  // 4. Explicit dev bypass only
  if (process.env.AUTH_DEV_BYPASS === "true") {
    next();
    return;
  }

  if (!process.env.API_KEY) {
    res.status(503).json({
      error: "auth_not_configured",
      hint: "Set API_KEY in .env (and AUTH_DEV_BYPASS=true for local dev only).",
    });
    return;
  }

  res.status(401).json({ error: "Missing authorization" });
}
