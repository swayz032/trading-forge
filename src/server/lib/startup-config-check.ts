/**
 * startup-config-check.ts — Vacation-Survival Finding A-8
 *
 * Boot-time configuration validation for secrets required by the
 * vacation-survival automation layer.
 *
 * Called from index.ts BEFORE app.listen() — after runPendingMigrations()
 * but before the scheduler starts. Emits WARNs + Discord notifications for
 * missing secrets WITHOUT throwing (never fail-boot on a missing secret — only
 * the missing migration runner failure-mode is allowed to fail boot).
 *
 * Currently checked:
 *   ADMIN_RESTART_HMAC_SECRET
 *     Required by:
 *       - POST /api/admin/self-restart  (auto-restart on dead-man heartbeat)
 *       - POST /api/admin/clear-kill-switch-cache  (A-5 recovery endpoint)
 *       - POST /api/admin/clear-stuck-session      (A-5 recovery endpoint)
 *     If unset: auto-restart is silently disabled and the operator has no
 *     phone-tappable recovery path for stuck states during vacation.
 *
 * Import logger from ./logger.js (not ../index.js) per CLAUDE.md §13 feedback rule.
 */

import { logger } from "./logger.js";

/** Minimum recommended secret length (32 chars — same as self-restart docs). */
const MIN_SECRET_LENGTH = 32;

/**
 * Runs boot-time validation of all HMAC/security secrets required by the
 * vacation-survival automation layer.
 *
 * Returns a summary of findings so callers can log or take action.
 * Never throws — all findings are warnings, not hard failures.
 */
export async function checkStartupSecrets(): Promise<{ warnings: string[] }> {
  const warnings: string[] = [];

  // ── ADMIN_RESTART_HMAC_SECRET ─────────────────────────────────────────────
  const secret = process.env.ADMIN_RESTART_HMAC_SECRET;

  if (!secret || secret.trim().length === 0) {
    const msg =
      "ADMIN_RESTART_HMAC_SECRET is NOT SET. " +
      "Vacation-survival auto-restart (dead-man heartbeat), " +
      "clear-kill-switch-cache, and clear-stuck-session recovery endpoints " +
      "will REJECT all calls in production. " +
      "Set ADMIN_RESTART_HMAC_SECRET (≥32 random chars) in .env before going on vacation.";

    logger.warn(
      {
        env_var: "ADMIN_RESTART_HMAC_SECRET",
        affected_endpoints: [
          "POST /api/admin/self-restart",
          "POST /api/admin/clear-kill-switch-cache",
          "POST /api/admin/clear-stuck-session",
        ],
      },
      `[STARTUP WARN] ${msg}`,
    );

    warnings.push("ADMIN_RESTART_HMAC_SECRET_NOT_SET");

    // Non-blocking Discord notify so the operator learns BEFORE leaving.
    // Fire-and-forget: notification failure must never cause boot to fail.
    try {
      const { notifyWarning } = await import("../services/notification-service.js");
      notifyWarning(
        "ADMIN_RESTART_HMAC_SECRET not configured — vacation-survival disabled",
        msg +
          "\n\nTo fix: add `ADMIN_RESTART_HMAC_SECRET=<random-32-char-string>` to your .env and restart the backend.",
        { env_var: "ADMIN_RESTART_HMAC_SECRET" },
      );
    } catch (notifyErr) {
      logger.warn({ err: notifyErr }, "startup-config-check: Discord notify failed (non-blocking)");
    }
  } else if (secret.trim().length < MIN_SECRET_LENGTH) {
    const msg =
      `ADMIN_RESTART_HMAC_SECRET is set but SHORTER THAN RECOMMENDED (${secret.trim().length} chars < ${MIN_SECRET_LENGTH}). ` +
      "Endpoints will still accept calls, but short secrets reduce HMAC security. " +
      "Rotate to a ≥32-char random value before going on vacation.";

    logger.warn({ env_var: "ADMIN_RESTART_HMAC_SECRET", length: secret.trim().length }, `[STARTUP WARN] ${msg}`);
    warnings.push("ADMIN_RESTART_HMAC_SECRET_TOO_SHORT");
  }

  if (warnings.length === 0) {
    logger.info(
      { env_var: "ADMIN_RESTART_HMAC_SECRET", configured: true },
      "startup-config-check: ADMIN_RESTART_HMAC_SECRET configured — vacation-survival endpoints active",
    );
  }

  return { warnings };
}
