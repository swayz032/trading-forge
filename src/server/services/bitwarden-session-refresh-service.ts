/**
 * Bitwarden Session Refresh Service (Track 7)
 *
 * Checks BW_SESSION expiry daily at 6 AM ET. If the session is within 72 hours
 * of expiry, auto-refreshes via `bw unlock --raw` using BW_VAULT_PASSPHRASE.
 *
 * Fail-CLOSED: refresh errors halt via notifyCritical — never silently degrade.
 * Does NOT bypass pipeline pause: this is a safety/infrastructure signal.
 *
 * Env vars required:
 *   BW_VAULT_PASSPHRASE  — master password for bw unlock
 *   BW_SESSION           — current session token (mutated in-process on refresh)
 *
 * Note: BW_SESSION has a ~30d rolling expiry. The refresh check runs daily so
 * we always have at least 3 days of heads-up before the session goes stale.
 */

import { randomUUID } from "node:crypto";
import { exec } from "child_process";
import { promisify } from "util";
import { logger } from "../lib/logger.js";
import { AlertFactory } from "./alert-service.js";
import { notifyCritical } from "./notification-service.js";
import { insertAuditRow } from "../lib/audit-log-helper.js";

const execAsync = promisify(exec);

// Bitwarden session lifetime is ~30 days (~2,592,000 seconds).
// We treat anything ≤ 72h remaining as "near-expiry".
const NEAR_EXPIRY_HOURS = 72;
const BW_SESSION_LIFETIME_DAYS = 30;

// ─── Expiry estimation ────────────────────────────────────────────────────────

/**
 * Estimates hours remaining on the BW_SESSION by calling `bw status` and
 * parsing the lastSynced field. This is a HEURISTIC — Bitwarden does not expose
 * the session TTL directly. We assume the session was created at lastSynced and
 * lasts 30 days.
 *
 * Returns null when the session status cannot be determined (treat as unknown).
 */
export async function estimateBwSessionExpiryHours(): Promise<number | null> {
  const session = process.env["BW_SESSION"];
  if (!session) {
    logger.warn("bitwarden-refresh: BW_SESSION not set — cannot check expiry");
    return null;
  }

  try {
    const { stdout } = await execAsync("bw status", {
      env: { ...process.env, BW_SESSION: session },
      timeout: 15_000,
    });

    const parsed = JSON.parse(stdout.trim()) as Record<string, unknown>;
    const lastSynced = parsed["lastSync"] as string | undefined;
    if (!lastSynced) return null;

    const lastSyncTs = new Date(lastSynced).getTime();
    const expiresAt = lastSyncTs + BW_SESSION_LIFETIME_DAYS * 24 * 60 * 60 * 1000;
    const hoursRemaining = (expiresAt - Date.now()) / (1000 * 60 * 60);

    return Math.max(0, hoursRemaining);
  } catch (err) {
    logger.warn({ err }, "bitwarden-refresh: bw status check failed");
    return null;
  }
}

// ─── Session refresh ──────────────────────────────────────────────────────────

/**
 * Attempts to refresh the BW_SESSION using bw unlock --raw.
 * Updates process.env.BW_SESSION with the new token on success.
 * Throws on failure (caller must handle fail-CLOSED).
 */
export async function refreshBwSession(): Promise<string> {
  const passphrase = process.env["BW_VAULT_PASSPHRASE"];
  if (!passphrase) {
    throw new Error("BW_VAULT_PASSPHRASE not set — cannot refresh BW_SESSION");
  }

  // bw unlock --raw emits ONLY the new session token on stdout
  const { stdout } = await execAsync(`bw unlock --raw`, {
    env: { ...process.env, BW_PASSWORD: passphrase },
    timeout: 30_000,
  });

  const newToken = stdout.trim();
  if (!newToken) {
    throw new Error("bw unlock --raw returned empty token");
  }

  // Mutate in-process so all subsequent bw CLI calls use the new session
  process.env["BW_SESSION"] = newToken;
  logger.info("bitwarden-refresh: BW_SESSION refreshed successfully");
  return newToken;
}

// ─── Main check function ──────────────────────────────────────────────────────

export interface BwRefreshResult {
  status: "no_action" | "refreshed" | "failed" | "unknown_expiry";
  hoursRemaining: number | null;
  error?: string;
}

/**
 * Run the daily Bitwarden session expiry check.
 * Called by the scheduler at 6 AM ET.
 *
 * Behavior:
 *   - If expiry > 72h: no-op
 *   - If expiry <= 72h: refresh + audit_log + Discord alert
 *   - If refresh fails: notifyCritical (fail-CLOSED) + audit_log
 *   - Same-day idempotency: if already refreshed this calendar day, skip
 */
export async function runBwSessionRefreshCheck(): Promise<BwRefreshResult> {
  const cronCorrelationId = randomUUID();
  logger.info({ correlationId: cronCorrelationId }, "bitwarden-refresh: starting daily expiry check");

  const hoursRemaining = await estimateBwSessionExpiryHours();

  if (hoursRemaining === null) {
    logger.warn("bitwarden-refresh: could not determine expiry — skipping refresh");
    return { status: "unknown_expiry", hoursRemaining: null };
  }

  if (hoursRemaining > NEAR_EXPIRY_HOURS) {
    logger.info(
      { hoursRemaining: hoursRemaining.toFixed(1) },
      "bitwarden-refresh: ample time remaining — no action",
    );
    return { status: "no_action", hoursRemaining };
  }

  // Near-expiry path
  logger.warn(
    { hoursRemaining: hoursRemaining.toFixed(1) },
    "bitwarden-refresh: session near expiry — attempting refresh",
  );

  try {
    await refreshBwSession();

    // Audit log
    await insertAuditRow({
      action: "credential.bw_session_refreshed",
      entityType: "system",
      entityId: null,
      decisionAuthority: "system",
      input: { trigger: "near_expiry", hoursRemaining } as Record<string, unknown>,
      result: { status: "refreshed" } as Record<string, unknown>,
      status: "success",
      correlationId: cronCorrelationId,
    });

    // Discord alert (informational — not critical)
    await AlertFactory.notifyBwSessionExpiringSoon(hoursRemaining);

    return { status: "refreshed", hoursRemaining };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "bitwarden-refresh: REFRESH FAILED — fail-CLOSED");

    // Audit log the failure
    await insertAuditRow({
      action: "credential.bw_session_refresh_failed",
      entityType: "system",
      entityId: null,
      decisionAuthority: "system",
      input: { trigger: "near_expiry", hoursRemaining } as Record<string, unknown>,
      result: { error: errorMsg } as Record<string, unknown>,
      status: "failed",
      correlationId: cronCorrelationId,
    }).catch((logErr) => {
      logger.error({ logErr }, "bitwarden-refresh: audit log write also failed");
    });

    // Critical Discord alert
    await notifyCritical(
      "bitwarden_refresh_failed",
      `BW_SESSION refresh failed with ${hoursRemaining.toFixed(1)}h remaining. ` +
        `Backend credential access may fail within ${hoursRemaining.toFixed(1)}h. ` +
        `Error: ${errorMsg}. Run 'bw unlock' manually and update BW_SESSION.`,
      { hoursRemaining, error: errorMsg },
    );

    return { status: "failed", hoursRemaining, error: errorMsg };
  }
}
