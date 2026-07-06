/**
 * broker-accounts.ts — W23H.H Per-Account Symbol Whitelist Admin Route
 *
 * PATCH /api/broker-accounts/:id/symbols
 *   Update the enabled_symbols list for a broker account.
 *   Validates symbols against canonical set (MES / MNQ / MCL).
 *   Emits audit row: broker_account.symbols_updated.
 *
 * GET  /api/broker-accounts
 *   List all broker accounts with their enabled_symbols.
 *
 * GET  /api/broker-accounts/:id
 *   Get a single broker account.
 */

import { Router, Request, Response } from "express";
import { z } from "zod";
import { db } from "../db/index.js";
import { brokerAccounts } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { insertAuditRow } from "../lib/audit-log-helper.js";

export const brokerAccountRoutes = Router();

// ─── Canonical symbol set (operator-sanctioned futures micros) ────────────────
const CANONICAL_SYMBOLS = new Set(["MES", "MNQ", "MCL"]);

const updateSymbolsBodySchema = z.object({
  enabled_symbols: z
    .array(z.string())
    .min(1, "enabled_symbols must contain at least one symbol")
    .refine(
      (syms) => syms.every((s) => CANONICAL_SYMBOLS.has(s)),
      {
        message: `enabled_symbols may only contain canonical symbols: ${[...CANONICAL_SYMBOLS].join(", ")}`,
      },
    ),
});

// ─── GET /api/broker-accounts ─────────────────────────────────────────────────
brokerAccountRoutes.get("/", async (_req: Request, res: Response) => {
  try {
    const accounts = await db
      .select({
        accountId: brokerAccounts.accountId,
        firmId: brokerAccounts.firmId,
        brokerType: brokerAccounts.brokerType,
        accountIdExternal: brokerAccounts.accountIdExternal,
        enabled: brokerAccounts.enabled,
        enabledSymbols: brokerAccounts.enabledSymbols,
        createdAt: brokerAccounts.createdAt,
      })
      .from(brokerAccounts)
      .orderBy(brokerAccounts.createdAt);

    res.json({ accounts });
  } catch (err) {
    logger.error({ err }, "GET /broker-accounts: failed to fetch accounts");
    res.status(500).json({ error: "Failed to fetch broker accounts" });
  }
});

// ─── GET /api/broker-accounts/:id ────────────────────────────────────────────
brokerAccountRoutes.get("/:id", async (req: Request, res: Response) => {
  const id = req.params["id"] as string;
  try {
    const [account] = await db
      .select()
      .from(brokerAccounts)
      .where(eq(brokerAccounts.accountId, id))
      .limit(1);

    if (!account) {
      res.status(404).json({ error: "Broker account not found" });
      return;
    }
    res.json({ account });
  } catch (err) {
    logger.error({ err, accountId: id }, "GET /broker-accounts/:id: failed");
    res.status(500).json({ error: "Failed to fetch broker account" });
  }
});

// ─── PATCH /api/broker-accounts/:id/symbols ───────────────────────────────────
brokerAccountRoutes.patch("/:id/symbols", async (req: Request, res: Response) => {
  const id = req.params["id"] as string;

  const parsed = updateSymbolsBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "Validation failed",
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const { enabled_symbols } = parsed.data;

  try {
    // Fetch prior state for audit
    const [existing] = await db
      .select({ enabledSymbols: brokerAccounts.enabledSymbols, firmId: brokerAccounts.firmId })
      .from(brokerAccounts)
      .where(eq(brokerAccounts.accountId, id))
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: "Broker account not found" });
      return;
    }

    // Update
    const [updated] = await db
      .update(brokerAccounts)
      .set({ enabledSymbols: enabled_symbols })
      .where(eq(brokerAccounts.accountId, id))
      .returning();

    if (!updated) {
      res.status(500).json({ error: "Update failed — no row returned" });
      return;
    }

    // Audit — deep-scan routes F-3 (2026-07-06): decisionAuthority MUST be a trusted server value, NOT a
    // client-supplied header. The x-operator-id header is caller-controlled and any authenticated caller could
    // set it to attribute this change to an arbitrary name in the audit trail. This route is auth-gated in a
    // single-operator system, so the authority is "operator"; the client hint is retained only as clearly
    // labeled informational metadata (client_supplied_operator_hint), never as the authoritative attribution.
    const operatorHint = (req.headers["x-operator-id"] as string | undefined) ?? null;
    insertAuditRow({
      action: "broker_account.symbols_updated",
      entityType: "broker_account",
      entityId: id,
      decisionAuthority: "operator",
      status: "success",
      input: { accountId: id, prior_symbols: existing.enabledSymbols, new_symbols: enabled_symbols },
      result: { updated_enabled_symbols: enabled_symbols, client_supplied_operator_hint: operatorHint },
    }).catch((err: unknown) => logger.warn({ err, accountId: id }, "Failed to write broker_account.symbols_updated audit row"));

    logger.info(
      { accountId: id, firmId: existing.firmId, priorSymbols: existing.enabledSymbols, newSymbols: enabled_symbols, clientOperatorHint: operatorHint },
      "W23H.H: broker account enabled_symbols updated",
    );

    res.json({
      accountId: id,
      firmId: existing.firmId,
      prior_symbols: existing.enabledSymbols,
      enabled_symbols: updated.enabledSymbols,
      updated_by: operatorHint,
    });
  } catch (err) {
    logger.error({ err, accountId: id }, "PATCH /broker-accounts/:id/symbols: failed");
    res.status(500).json({ error: "Failed to update enabled symbols" });
  }
});
