/**
 * Operator-only endpoint to map discord_user_id → broker_account_id.
 *
 * Mounts at /api/admin/slumhouse-users (not under /slumhouse/* because admin
 * surfaces live on the TF admin dashboard, not the friend portal).
 *
 * Auth (FIX 6, deep-scan #12):
 *   This route is mounted after app.use("/api", authMiddleware) in index.ts and
 *   therefore sits behind the API-key gate in production. However, authMiddleware
 *   has a NODE_ENV==="development" && !API_KEY bypass that skips auth entirely in
 *   dev. That bypass would leave this broker-mapping write unprotected in dev.
 *
 *   To close the dev-bypass gap, this file adds an explicit route-level guard:
 *   requireKeyOrAdminSession() checks for a valid API key (same semantics as
 *   authMiddleware) OR a valid Slumhouse Office admin session cookie. Neither
 *   NODE_ENV nor the absence of API_KEY weakens this guard.
 *
 * Why admin session as fallback:
 *   Local dev without a configured API_KEY can still use the admin passcode to
 *   access this endpoint, matching the security posture of the Office switches.
 */
import { Router, type Request, type Response } from "express";
import { db } from "../../db/index.js";
import { slumhouseUsers } from "../../db/schema.js";
import { insertAuditRowSafe } from "../../lib/audit-log-helper.js";
import { adminSessionFromCookie } from "../../lib/slumhouse/admin-session.js";

// ─── Route-level guard (FIX 6) ───────────────────────────────────────────────
// Requires either a valid API key (Authorization: Bearer <API_KEY>) OR a valid
// Slumhouse Office admin session cookie. This guard fires AFTER authMiddleware
// (which handles the normal production case) and adds unconditional coverage for
// the dev-bypass scenario where NODE_ENV==="development" && !API_KEY.
function requireKeyOrAdminSession(req: Request, res: Response): boolean {
  const apiKey = process.env.API_KEY;
  if (apiKey) {
    const auth = req.headers.authorization ?? "";
    if (auth.startsWith("Bearer ") && auth.slice(7) === apiKey) {
      return true;
    }
  }
  // Fall back to Slumhouse Office admin session (passcode-gated).
  if (adminSessionFromCookie(req.headers.cookie)) {
    return true;
  }
  res.status(403).json({ error: "forbidden" });
  return false;
}

export async function postSlumhouseUser(req: Request, res: Response): Promise<void> {
  if (!requireKeyOrAdminSession(req, res)) return;

  const { discord_user_id, display_name, broker_account_id, jersey_number } = req.body ?? {};
  if (!discord_user_id || typeof discord_user_id !== "string") {
    res.status(400).json({ error: "discord_user_id_required" });
    return;
  }
  if (!display_name || typeof display_name !== "string") {
    res.status(400).json({ error: "display_name_required" });
    return;
  }

  await db.insert(slumhouseUsers).values({
    discordUserId: discord_user_id,
    displayName: display_name,
    brokerAccountId: broker_account_id ?? null,
    jerseyNumber: jersey_number ?? null,
  }).onConflictDoUpdate({
    target: slumhouseUsers.discordUserId,
    set: {
      displayName: display_name,
      brokerAccountId: broker_account_id ?? null,
      jerseyNumber: jersey_number ?? null,
    },
  });

  await insertAuditRowSafe({
    action: "slumhouse.user_mapped",
    status: "success",
    input: { discord_user_id, broker_account_id, jersey_number },
  });

  res.json({ ok: true });
}

export async function listSlumhouseUsers(req: Request, res: Response): Promise<void> {
  if (!requireKeyOrAdminSession(req, res)) return;

  const users = await db.select().from(slumhouseUsers);
  res.json({ users });
}

export const adminMappingRouter = Router();
adminMappingRouter.post("/api/admin/slumhouse-users", postSlumhouseUser);
adminMappingRouter.get("/api/admin/slumhouse-users", listSlumhouseUsers);
