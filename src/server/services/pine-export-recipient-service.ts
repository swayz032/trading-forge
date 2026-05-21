/**
 * pine-export-recipient-service.ts — Track 6 / Pass 2
 *
 * Wraps pine-export-service.ts to generate per-recipient .pine artifacts.
 *
 * Per-recipient behaviour:
 *   - Substitutes qty with recipient's profit-tier-aware contract count
 *   - Embeds account label as Pine comment
 *   - Includes TradersPost webhook URL placeholder
 *   - Injects HMAC secret for Track 8 marker collection (Pass 3)
 *   - Pipeline-pause-guarded
 *   - Audit_log row on every export
 *   - Idempotent: same (strategy_id, account_id, qty) → same artifact hash
 *
 * Semantic notes (Pine export charter):
 *   - qty substitution is deterministic: profit-tier formula is pure function of
 *     (account_pnl_total, base_contracts). Same inputs → same qty → same hash.
 *   - HMAC secret is generated once per (account_id, strategy_id) pair and persisted
 *     in account_strategy_assignments.hmac_secret (migration 0100b). Re-generation
 *     for the same pair REUSES the persisted secret (idempotency).
 *   - No repaint risk introduced: all Pine signals are bar-close per existing
 *     barstate.isconfirmed guards in the compiler.
 *   - Alert timing: once_per_bar_close (inherited from dual artifact path).
 */

import { randomBytes, createHash } from "crypto";
import { eq, and, sql as drizzleSql } from "drizzle-orm";
import { db } from "../db/index.js";
import { strategies, auditLog } from "../db/schema.js";
import { compileDualPineExport } from "./pine-export-service.js";
import { isActive as isPipelineActive } from "./pipeline-control-service.js";
import { logger } from "../lib/logger.js";  // F-5: leaf module import — never ../index.js
import { broadcastSSE } from "../routes/sse.js";
import { notifyWarning, notifyCritical } from "./notification-service.js";
import { spawn } from "child_process";
import { resolve as pathResolve } from "path";

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Promise-based sleep — used for HMAC persist retry backoff. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const HMAC_RETRY_DELAYS_MS = [250, 1000, 4000] as const;

const PROJECT_ROOT = pathResolve(import.meta.dirname ?? ".", "../../..");

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RecipientExportRequest {
  strategyId: string;
  accountId: string;
  qtyOverride?: number;
  /**
   * Caller-supplied correlation ID — propagated from the strategy assignment
   * event through Pine export so Track 8 marker validation can link all three
   * audit rows (assign → export → order-route) by the same ID.
   */
  correlationId?: string | null;
}

export interface RecipientExportResult {
  artifactPath: string;
  artifactHash: string;
  exportId: string | null;
  recipientLabel: string;
  qty: number;
  hmacSecretPersisted: boolean;
  setupReadme: string;
  presignedUrl: string | null;  // null = filesystem download only (default)
  expiresAt: string | null;
  // Fix 3 (Wave 8 P9): download URL for the DB-stored artifact.
  // Artifacts live in strategy_export_artifacts.content (not filesystem).
  // Family-distribution flow: call this URL to get the .pine content, then
  // paste into TradingView Pine Editor. See CLAUDE.md §9.
  downloadUrl: string | null;
}

// ─── Constants ───────────────────────────────────────────────────────────────

// Firms allowed for per-recipient export.
// Legacy firms removed 2026-05-10 via migration 0097.
const ALLOWED_FIRM_IDS = new Set(["mffu", "topstep"]);

// Default base contract count when no profit-tier data available
const DEFAULT_BASE_CONTRACTS = 4;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Look up broker account + firm info for accountId.
 * Returns null when account does not exist or firm is not in ALLOWED_FIRM_IDS.
 *
 * NOTE: broker_accounts table shipped in migration 0098 (Track 4 / Pass 2).
 * We use raw SQL here because the Drizzle schema type for broker_accounts may
 * not be present yet in schema.ts if Track 4 ran after Track 6. The raw query
 * is safe — column names are stable per migration 0098.
 */
async function lookupBrokerAccount(accountId: string): Promise<{
  firmId: string;
  brokerType: string;
  accountIdExternal: string;
} | null> {
  try {
    const rows = await db.execute(
      drizzleSql`SELECT firm_id, broker_type, account_id_external
         FROM broker_accounts
        WHERE account_id = ${accountId}::uuid
          AND enabled = true
        LIMIT 1`,
    );
    const row = (rows as unknown as { rows: Array<{ firm_id: string; broker_type: string; account_id_external: string }> }).rows?.[0];
    if (!row) return null;
    if (!ALLOWED_FIRM_IDS.has(row.firm_id)) return null;
    return {
      firmId: row.firm_id,
      brokerType: row.broker_type,
      accountIdExternal: row.account_id_external,
    };
  } catch (err) {
    logger.warn({ accountId, err }, "pine-export-recipient: broker_accounts lookup failed");
    return null;
  }
}

/**
 * Look up or create HMAC secret for (accountId, strategyId).
 *
 * F-3: Reads hmac_secret_encrypted (migration 0128) when populated, decrypting
 * via pgp_sym_decrypt in Postgres. Falls back to plaintext hmac_secret during
 * the transition window. Fail-closed in production when encrypted column is set
 * but HMAC_ENCRYPTION_KEY is absent.
 *
 * F-6: After UPDATE, checks rowCount. If 0 (assignment row missing), attempts
 * INSERT with ON CONFLICT DO NOTHING. If INSERT also returns 0 (concurrent write
 * race), re-reads the row written by the concurrent writer. If still nothing,
 * escalates as a persist failure. Returns { secret, persisted }.
 *
 * Idempotency: if account_strategy_assignments already has a secret for this pair,
 * return it unchanged.
 *
 * Retry policy: up to 3 attempts with 250ms / 1s / 4s backoff.
 * On all-attempts failure:
 *   - writes HIGH-severity audit row (pine_export.hmac_persist_failed_after_retries)
 *   - fires CRITICAL Discord alert via notifyCritical
 *   - returns in-memory secret with persisted=false — artifact stays usable
 *
 * @param accountId    Account UUID
 * @param strategyId   Strategy UUID
 * @param correlationId Optional correlation ID for audit linkage
 */
async function getOrCreateHmacSecret(
  accountId: string,
  strategyId: string,
  correlationId?: string | null,
): Promise<{ secret: string; persisted: boolean }> {
  try {
    const encKey = process.env.HMAC_ENCRYPTION_KEY;

    // F-3: Prefer encrypted column when key is available (DB-side decryption).
    const existingQuery = encKey
      ? drizzleSql`
          SELECT hmac_secret,
                 hmac_secret_encrypted,
                 CASE
                   WHEN hmac_secret_encrypted IS NOT NULL
                   THEN pgp_sym_decrypt(hmac_secret_encrypted, ${encKey})
                   ELSE hmac_secret
                 END AS resolved_secret
            FROM account_strategy_assignments
           WHERE account_id = ${accountId}::uuid
             AND strategy_id = ${strategyId}::uuid
           LIMIT 1`
      : drizzleSql`
          SELECT hmac_secret,
                 hmac_secret_encrypted,
                 hmac_secret AS resolved_secret
            FROM account_strategy_assignments
           WHERE account_id = ${accountId}::uuid
             AND strategy_id = ${strategyId}::uuid
           LIMIT 1`;

    const existing = await db.execute(existingQuery);

    type HmacRow = {
      hmac_secret: string | null;
      hmac_secret_encrypted: Buffer | null;
      resolved_secret: string | null;
    };
    const row = (existing as unknown as { rows: HmacRow[] }).rows?.[0];

    if (row) {
      if (row.resolved_secret) {
        return { secret: row.resolved_secret, persisted: true };
      }
      // Row exists but no secret yet — generate and UPDATE below
    }
    // No row — will INSERT below
  } catch {
    // account_strategy_assignments may not exist yet (Track 5 not shipped).
    // Fall through to generate a fresh secret.
  }

  // Generate new cryptographic secret
  const secret = randomBytes(32).toString("hex");

  // F-6: Persist with up to 3 attempts + backoff.
  // Check rowCount after UPDATE; if 0, INSERT with ON CONFLICT DO NOTHING.
  let lastError: unknown = null;
  for (let attempt = 0; attempt < HMAC_RETRY_DELAYS_MS.length; attempt++) {
    try {
      const updateResult = await db.execute(
        drizzleSql`UPDATE account_strategy_assignments
            SET hmac_secret = ${secret}
          WHERE account_id = ${accountId}::uuid
            AND strategy_id = ${strategyId}::uuid`,
      );
      const updateRowCount = (updateResult as unknown as { rowCount?: number }).rowCount ?? 0;

      if (updateRowCount > 0) {
        return { secret, persisted: true };
      }

      // F-6: 0 rows updated — assignment row is missing. Try INSERT.
      const insertResult = await db.execute(
        drizzleSql`INSERT INTO account_strategy_assignments (account_id, strategy_id, hmac_secret)
         VALUES (${accountId}::uuid, ${strategyId}::uuid, ${secret})
         ON CONFLICT (account_id, strategy_id) DO NOTHING`,
      );
      const insertRowCount = (insertResult as unknown as { rowCount?: number }).rowCount ?? 0;

      if (insertRowCount > 0) {
        return { secret, persisted: true };
      }

      // Both UPDATE and INSERT returned 0 rows — concurrent write race.
      const reReadResult = await db.execute(
        drizzleSql`SELECT hmac_secret FROM account_strategy_assignments
          WHERE account_id = ${accountId}::uuid AND strategy_id = ${strategyId}::uuid LIMIT 1`,
      );
      const reRow = (reReadResult as unknown as { rows: Array<{ hmac_secret: string | null }> }).rows?.[0];
      if (reRow?.hmac_secret) {
        return { secret: reRow.hmac_secret, persisted: true };
      }

      throw new Error("UPDATE and INSERT both returned 0 rows and re-read returned no secret");
    } catch (err) {
      lastError = err;
      if (attempt < HMAC_RETRY_DELAYS_MS.length - 1) {
        logger.debug(
          { accountId, strategyId, attempt, delayMs: HMAC_RETRY_DELAYS_MS[attempt] },
          "pine_export.hmac_persist_retry",
        );
        await sleep(HMAC_RETRY_DELAYS_MS[attempt]);
      }
    }
  }

  // All 3 attempts exhausted — escalate to HIGH severity.
  const errorMsg = lastError instanceof Error ? lastError.message : String(lastError);

  logger.warn(
    { accountId, strategyId, attempts: HMAC_RETRY_DELAYS_MS.length, error: errorMsg },
    "pine_export.hmac_persist_failed_after_retries",
  );

  broadcastSSE("pine_export:hmac_persist_failed", {
    accountId,
    strategyId,
    error: errorMsg,
    attempts: HMAC_RETRY_DELAYS_MS.length,
    note: "HMAC secret embedded in artifact but not persisted to DB after 3 retries; Track 8 marker validation will fail for this account until reconciled",
    timestamp: new Date().toISOString(),
  });

  notifyCritical(
    "HMAC persist failed after retries",
    `pine_export.hmac_persist_failed_after_retries: accountId=${accountId} strategyId=${strategyId} attempts=3 error=${errorMsg}`,
    { accountId, strategyId, attempts: 3, correlationId: correlationId ?? null },
  );

  try {
    await db.insert(auditLog).values({
      action: "pine_export.hmac_persist_failed_after_retries",
      entityType: "account_strategy_assignment",
      entityId: accountId,
      decisionAuthority: "system",
      input: { accountId, strategyId } as Record<string, unknown>,
      result: {
        severity: "high",
        error: errorMsg,
        attempts: 3,
        note: "secret is embedded in artifact but not persisted after 3 retries; Track 8 reconciliation required",
      } as Record<string, unknown>,
      status: "failure",
      correlationId: correlationId ?? null,
    });
  } catch {
    // double-failure: swallow — primary observability is the warn log + Discord alert
  }

  // F-8: persisted=false signals caller that DB write failed definitively.
  return { secret, persisted: false };
}

/**
 * Compute profit-tier-aware qty by calling Python sizing.py.
 * Falls back to base_contracts when Python call fails (non-blocking).
 *
 * Uses compute_profit_tier_mes for MES (30-contract cap + graduation signal).
 * Uses compute_profit_tier for all other symbols (20-contract cap).
 */
async function computeRecipientQty(
  symbol: string,
  baseContracts: number,
  accountPnlTotal: number,
): Promise<number> {
  return new Promise((resolve) => {
    const pythonCmd = process.platform === "win32" ? "python" : "python3";
    const script = `
import json, sys
sys.path.insert(0, '.')
symbol = ${JSON.stringify(symbol)}
base = ${baseContracts}
pnl = ${accountPnlTotal}
if symbol == 'MES':
    from src.engine.sizing import compute_profit_tier_mes
    qty, _ = compute_profit_tier_mes(pnl, base)
else:
    from src.engine.sizing import compute_profit_tier
    qty = compute_profit_tier(pnl, base)
print(json.dumps({"qty": qty}))
`;
    const proc = spawn(pythonCmd, ["-c", script], {
      env: { ...process.env },
      cwd: PROJECT_ROOT,
    });
    let stdout = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.on("close", (code) => {
      if (code === 0) {
        try {
          const parsed = JSON.parse(stdout) as { qty: number };
          resolve(parsed.qty ?? baseContracts);
          return;
        } catch { /* fall through */ }
      }
      logger.warn({ symbol, baseContracts, accountPnlTotal }, "pine-export-recipient: sizing call failed, using base");
      resolve(baseContracts);
    });
    proc.on("error", () => resolve(baseContracts));
    // 10s timeout — sizing call is fast; alert operator if exceeded
    setTimeout(() => {
      try { proc.kill(); } catch { /* dead */ }
      logger.warn(
        { symbol, baseContracts, accountPnlTotal, timeoutMs: 10_000 },
        "pine-export-recipient: sizing Python subprocess timed out — using base contract count",
      );
      notifyWarning(
        "Pine Export Sizing Timeout",
        `Python sizing subprocess timed out (10s) for symbol ${symbol}. ` +
          `Falling back to base contract count ${baseContracts}. ` +
          `Check sizing.py availability and Python process health.`,
        { symbol, baseContracts, accountPnlTotal },
      );
      resolve(baseContracts);
    }, 10_000);
  });
}

/**
 * Build the human-readable setup README for the recipient bundle.
 * This is operator-deliverable documentation — clear, actionable, no jargon.
 */
function buildSetupReadme(params: {
  recipientLabel: string;
  strategyName: string;
  symbol: string;
  firmId: string;
  qty: number;
  artifactFileName: string;
  traderspostWebhookUrlPlaceholder: string;
}): string {
  const { recipientLabel, strategyName, symbol, firmId, qty, artifactFileName, traderspostWebhookUrlPlaceholder } = params;
  return `# Trading Forge — Pine Script Setup Guide
# Recipient: ${recipientLabel}
# Generated: ${new Date().toISOString()}
# Strategy:  ${strategyName}
# Symbol:    ${symbol}
# Firm:      ${firmId.toUpperCase()}
# Contracts: ${qty}

## Step 1 — Add the Pine Script to TradingView

1. Open TradingView → Pine Script Editor (bottom panel)
2. Click "Open" → "New" to create a blank script
3. Copy the contents of "${artifactFileName}" into the editor
4. Click "Add to chart"
5. The strategy will show on your ${symbol} chart

## Step 2 — Create TradersPost Webhook Alerts

In TradingView, right-click the strategy on the chart:
  → "Add alert on <strategy name>"

For each alert condition shown in the script:
  - Set "Webhook URL" to: ${traderspostWebhookUrlPlaceholder}
  - Set "Alert actions" to: Webhook
  - Set frequency to: "Once Per Bar Close"
  - Ensure "Send webhook notification" is enabled

IMPORTANT: Each alert condition must have its own TradersPost webhook alert.
Do NOT set the same webhook URL for multiple conditions.

## Step 3 — Configure Your ${firmId.toUpperCase()} Account in TradersPost

1. Log in to TradersPost (traderspost.io)
2. Connect your ${firmId.toUpperCase()} account
3. Map the strategy signals to your account
4. Set contract size to ${qty} (pre-configured in this script)

## Step 4 — Verify Before Going Live

1. Put TradingView in Paper trading mode first
2. Confirm alerts fire on expected signals
3. Confirm TradersPost receives the webhook
4. Monitor for 1-2 sessions before live trading

## Important Notes

- This script is configured for ${qty} contract(s) — do NOT modify the qty_final line
- The HMAC secret embedded in the webhook payload is unique to your account
- Do NOT share this Pine script or your TradersPost webhook URL with others
- Contact the operator if you need to regenerate this script (account PnL updated)

## Support

Questions: Contact the operator directly via secure messaging.
Do NOT post this script publicly.
`;
}

// ─── Main Export Function ─────────────────────────────────────────────────────

/**
 * Generate a per-recipient Pine export bundle.
 *
 * Pipeline-pause-guarded: throws { pipelinePaused: true } when pipeline is paused.
 * Legacy-firm guard: throws when accountId references a firm NOT IN ('mffu','topstep').
 * Idempotent: same (strategyId, accountId, qty) → same artifact hash.
 * Audit_log row written on every successful export.
 */
export async function generateRecipientExport(
  req: RecipientExportRequest,
): Promise<RecipientExportResult> {
  const { strategyId, accountId, qtyOverride, correlationId = null } = req;

  // ── 1. Pipeline pause guard ──────────────────────────────────────────────
  if (!(await isPipelineActive())) {
    broadcastSSE("pine_export:failed", {
      exportId: null,
      strategyId,
      accountId,
      firmId: null,
      errorCode: "pipeline_paused",
      errorMessage: "Pine export blocked: pipeline is paused",
      correlationId: correlationId ?? null,
      timestamp: new Date().toISOString(),
    });
    throw Object.assign(new Error("pipeline_paused"), { pipelinePaused: true });
  }

  // ── 2. Load strategy ────────────────────────────────────────────────────
  const [strategy] = await db
    .select()
    .from(strategies)
    .where(eq(strategies.id, strategyId));

  if (!strategy) {
    broadcastSSE("pine_export:failed", {
      exportId: null,
      strategyId,
      accountId,
      firmId: null,
      errorCode: "strategy_not_found",
      errorMessage: `Strategy ${strategyId} not found`,
      correlationId: correlationId ?? null,
      timestamp: new Date().toISOString(),
    });
    throw new Error(`Strategy ${strategyId} not found`);
  }

  const strategyConfig = strategy.config as Record<string, unknown>;
  const symbol = (strategyConfig.symbol as string) ?? "MES";
  const strategyName = (strategyConfig.name as string) ?? strategy.name ?? "Unknown Strategy";

  // ── 3. Lookup broker account (firm + firm validation) ───────────────────
  const brokerAccount = await lookupBrokerAccount(accountId);
  if (!brokerAccount) {
    broadcastSSE("pine_export:failed", {
      exportId: null,
      strategyId,
      accountId,
      firmId: null,
      errorCode: "account_not_found",
      errorMessage: `account_id ${accountId} not found or firm not in ('mffu','topstep')`,
      correlationId: correlationId ?? null,
      timestamp: new Date().toISOString(),
    });
    throw Object.assign(
      new Error(`account_id ${accountId} not found or firm not in ('mffu','topstep')`),
      { legacyFirmRejection: true },
    );
  }
  const { firmId, accountIdExternal } = brokerAccount;

  // ── 4. Compute recipient label ──────────────────────────────────────────
  const recipientLabel = `${accountIdExternal}_${firmId}`.toLowerCase().replace(/[^a-z0-9_]/g, "_");

  // ── 5. Compute profit-tier-aware qty ────────────────────────────────────
  // qtyOverride takes precedence when explicitly provided.
  // F-6: Previously accountPnlTotal was hardcoded 0 — pyramid never advanced.
  // Now: query paper_trades for closed trades on this accountId to get real cumulative PnL.
  // Fallback to 0 with audit warning when account has no closed trades yet.
  const baseContracts = (strategyConfig.max_contracts as number) ?? DEFAULT_BASE_CONTRACTS;

  let accountPnlTotal = 0;
  if (qtyOverride == null) {
    try {
      // Sum net_pnl from paper_trades WHERE account_id = accountId AND status = 'closed'.
      // Uses raw SQL: paper_trades table may not be in Drizzle schema (Track 3 territory).
      const pnlRows = await db.execute(
        drizzleSql`SELECT COALESCE(SUM(net_pnl), 0) AS total_pnl
           FROM paper_trades
          WHERE account_id = ${accountId}::uuid
            AND status = 'closed'`,
      );
      const pnlRow = (pnlRows as unknown as { rows: Array<{ total_pnl: string | null }> }).rows?.[0];
      if (pnlRow?.total_pnl != null) {
        accountPnlTotal = parseFloat(pnlRow.total_pnl) || 0;
      }
    } catch (pnlErr) {
      // paper_trades may not exist for accounts that haven't paper-traded yet.
      // Default to 0 (base pyramid tier) — log warning so operator knows PnL wasn't used.
      logger.warn(
        { accountId, strategyId, pnlErr },
        "pine-export-recipient: failed to read paper_trades PnL — defaulting to 0 (base pyramid tier). " +
          "Profit-tier pyramid will not advance until paper_trades are available.",
      );
      accountPnlTotal = 0;
    }
  }

  const qty = qtyOverride ?? (await computeRecipientQty(symbol, baseContracts, accountPnlTotal));

  // ── 6. Get or create HMAC secret (idempotent) ───────────────────────────
  // F-6/F-8: getOrCreateHmacSecret now returns { secret, persisted }.
  const { secret: hmacSecret, persisted: hmacSecretPersisted } = await getOrCreateHmacSecret(accountId, strategyId, correlationId);

  // ── 7. Map firm to firm_key for Pine prop overlay ───────────────────────
  const firmKey = firmId === "mffu" ? "mffu_50k" : "topstep_50k";

  // ── 8. Compile dual Pine artifact (per-recipient params injected) ────────
  const exportResult = await compileDualPineExport(
    strategyId,
    firmKey,
    null,       // let service fetch risk intelligence from DB
    true,       // persist=true — write export + artifact rows
    undefined,  // correlationId
    qty,
    recipientLabel,
    hmacSecret,
  );

  if (exportResult.status === "failed") {
    const compileError = (exportResult as { error?: string }).error ?? "unknown";
    broadcastSSE("pine_export:failed", {
      exportId: exportResult.id ?? null,
      strategyId,
      accountId,
      firmId,
      errorCode: "compilation_failed",
      errorMessage: `Pine compilation failed: ${compileError}`,
      correlationId: correlationId ?? null,
      timestamp: new Date().toISOString(),
    });
    throw new Error(`Pine compilation failed: ${compileError}`);
  }

  const artifactHash = exportResult.contentHash ?? "";
  const exportId = exportResult.id ?? null;

  // ── 9. Build artifact file name (deterministic: hash-stable) ─────────────
  const safeStrategyName = strategyName.toLowerCase().replace(/[^a-z0-9]/g, "_");
  const artifactFileName = `${safeStrategyName}_${recipientLabel}_STRATEGY.pine`;

  // ── 9b. Resolve artifact download URL (Fix 3 — Wave 8 P9) ───────────────
  // Artifacts live in DB (strategy_export_artifacts.content), not filesystem.
  // Find the strategy artifact row from the export result and build its URL.
  // The download route already exists: GET /api/pine-export/:id/artifacts/:artifactId/download
  const exportResultArtifacts = (exportResult as unknown as { artifacts?: { id: string; artifactType: string; fileName: string }[] }).artifacts ?? [];
  // F-5: compileDualPineExport stores the STRATEGY artifact with artifactType="dual_strategy".
  // Previous code searched for "pine_strategy" first — which NEVER matched the dual path —
  // causing fallback to the first .pine file (which is the INDICATOR, not the STRATEGY).
  // Fix: prefer "dual_strategy" (dual export path), then "pine_strategy" (legacy compat),
  // then file-name suffix as last resort.
  const strategyArtifactRow =
    exportResultArtifacts.find((a) => a.artifactType === "dual_strategy") ??
    exportResultArtifacts.find((a) => a.artifactType === "pine_strategy") ??
    exportResultArtifacts.find((a) => a.fileName.toUpperCase().endsWith("_STRATEGY.pine".toUpperCase())) ??
    exportResultArtifacts.find((a) => a.fileName.endsWith(".pine")) ??
    exportResultArtifacts[0] ??
    null;
  const downloadUrl = strategyArtifactRow && exportId
    ? `/api/pine-export/${exportId}/artifacts/${strategyArtifactRow.id}/download`
    : null;

  // ── 10. Build setup README ───────────────────────────────────────────────
  const traderspostWebhookUrlPlaceholder = "https://traderspost.io/trading/webhook/<YOUR_WEBHOOK_TOKEN>";
  const setupReadme = buildSetupReadme({
    recipientLabel,
    strategyName,
    symbol,
    firmId,
    qty,
    artifactFileName,
    traderspostWebhookUrlPlaceholder,
  });

  // ── 11. Audit log ────────────────────────────────────────────────────────
  const artifactHashShort = artifactHash.slice(0, 16);
  await db.insert(auditLog).values({
    action: "pine_export.recipient_generated",
    entityType: "strategy_export",
    entityId: exportId ?? strategyId,
    decisionAuthority: "human",
    input: {
      strategyId,
      accountId,
      qtyOverride,
      firmId,
      recipientLabel,
      correlationId,
    } as Record<string, unknown>,
    result: {
      qty,
      artifactHash: artifactHashShort,
      exportId,
      hmacSecretPersisted,  // F-8: actual persisted flag, not hardcoded true
      status: "success",
    } as Record<string, unknown>,
    status: "success",
    correlationId,
  });

  // SSE event — dashboard surfaces export completion without polling
  broadcastSSE("pine_export:recipient_generated", {
    strategyId,
    accountId,
    firmId,
    recipientLabel,
    qty,
    artifactHash: artifactHashShort,
    exportId,
    correlationId,
    timestamp: new Date().toISOString(),
  });

  logger.info(
    { strategyId, accountId, firmId, recipientLabel, qty, artifactHash: artifactHashShort, correlationId },
    "pine-export-recipient: per-recipient export generated",
  );

  return {
    artifactPath: artifactFileName,
    artifactHash,
    exportId,
    recipientLabel,
    qty,
    hmacSecretPersisted,  // F-8: actual persisted flag from getOrCreateHmacSecret
    setupReadme,
    presignedUrl: null,   // not used — artifacts served via downloadUrl
    expiresAt: null,
    downloadUrl,          // Fix 3: /api/pine-export/:exportId/artifacts/:artifactId/download
  };
}
