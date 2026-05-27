/**
 * Operator-only admin endpoint to map discord_user_id → broker_account_id.
 *
 * Mounts at /api/admin/slumhouse-users (not under /slumhouse/* because admin
 * surfaces live on the TF admin dashboard, not the friend portal).
 *
 * No auth here — relies on the same network/access-control as other admin
 * endpoints (operator-only via Skytech tower local access).
 */
import { Router, type Request, type Response } from "express";
import { db } from "../../db/index.js";
import { slumhouseUsers } from "../../db/schema.js";
import { insertAuditRowSafe } from "../../lib/audit-log-helper.js";

export async function postSlumhouseUser(req: Request, res: Response): Promise<void> {
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

export async function listSlumhouseUsers(_req: Request, res: Response): Promise<void> {
  const users = await db.select().from(slumhouseUsers);
  res.json({ users });
}

export const adminMappingRouter = Router();
adminMappingRouter.post("/api/admin/slumhouse-users", postSlumhouseUser);
adminMappingRouter.get("/api/admin/slumhouse-users", listSlumhouseUsers);
