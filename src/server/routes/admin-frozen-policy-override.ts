/**
 * admin-frozen-policy-override.ts — Wave 29 Pass B.2 (backtest-core)
 *
 * HMAC-signed operator override endpoint for the frozen-policy contract.
 *
 * POST /api/admin/frozen-policy-override
 *
 * Body: { strategy_id: string, rationale: string, timestamp: number }
 * Header: X-Override-Signature = HMAC-SHA256(ADMIN_OVERRIDE_HMAC_SECRET, "${timestamp}:${strategy_id}:${rationale}")
 *
 * On valid signature + rationale ≥50 chars:
 *   - Increments frozen_policy_override_count
 *   - Re-stamps frozen_policy_hash (current live config hash)
 *   - Re-stamps frozen_policy_set_at to now
 *   - Writes frozen_policy.override_used audit with full rationale + correlation_id
 *   - Returns 200 { ok: true, ... }
 *
 * Failure modes:
 *   - 503  ADMIN_OVERRIDE_HMAC_SECRET not configured in production
 *   - 401  Timestamp drift > 60s (replay protection)
 *   - 401  Signature mismatch / missing header
 *   - 400  Rationale < 50 chars (writes frozen_policy.override_rationale_too_short audit)
 *   - 400  Missing / invalid body fields
 *   - 404  Strategy not found
 *
 * Pattern mirrors admin.ts "self-restart" HMAC endpoint (Wave 24 Pass 1 Item 8).
 * Import logger from ./logger.js (not ../index.js) per CLAUDE.md feedback rule.
 */

import { Router } from "express";
import { randomUUID, createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { strategies, auditLog } from "../db/schema.js";
import { computeFrozenPolicyHash } from "../lib/frozen-policy-contract.js";
import { logger } from "../lib/logger.js";
import { frozenPolicyOverridesTotal } from "../lib/metrics-registry.js";
import { notifyWarning } from "../services/notification-service.js";
import { appendFamilyGradePostscript } from "../lib/notification-helpers.js";

export const adminFrozenPolicyOverrideRoutes = Router();

// ─── Constants ────────────────────────────────────────────────────────────────

const OVERRIDE_TIMESTAMP_DRIFT_MS = 60_000; // 60-second replay window
const RATIONALE_MIN_CHARS = 50;

// ─── HMAC helper ──────────────────────────────────────────────────────────────

/**
 * Verify the X-Override-Signature HMAC header.
 *
 * HMAC payload: "${timestamp}:${strategy_id}:${rationale}"
 * Algorithm: HMAC-SHA256 with ADMIN_OVERRIDE_HMAC_SECRET
 *
 * Returns { ok: true } or { ok: false, reason_code: string }
 */
function verifyOverrideHmac(
  headerValue: string | undefined,
  timestamp: number,
  strategyId: string,
  rationale: string,
): { ok: true } | { ok: false; reason_code: string } {
  const secret = process.env.ADMIN_OVERRIDE_HMAC_SECRET;

  if (!secret || secret.length === 0) {
    // Unconfigured secret in production is a hard 503 — caller checks separately.
    return { ok: false, reason_code: "secret_not_configured" };
  }

  if (!headerValue || typeof headerValue !== "string" || headerValue.length === 0) {
    return { ok: false, reason_code: "missing_header" };
  }

  const payload = `${timestamp}:${strategyId}:${rationale}`;
  const expected = createHmac("sha256", secret).update(payload, "utf8").digest("hex");

  if (headerValue.length !== expected.length) {
    return { ok: false, reason_code: "signature_mismatch" };
  }

  try {
    const ok = timingSafeEqual(
      Buffer.from(headerValue, "hex"),
      Buffer.from(expected, "hex"),
    );
    return ok ? { ok: true } : { ok: false, reason_code: "signature_mismatch" };
  } catch {
    return { ok: false, reason_code: "signature_mismatch" };
  }
}

// ─── Route handler ────────────────────────────────────────────────────────────

adminFrozenPolicyOverrideRoutes.post("/frozen-policy-override", async (req, res) => {
  const correlationId = randomUUID();

  // ── 503: Secret not configured in production ─────────────────────────────
  const secret = process.env.ADMIN_OVERRIDE_HMAC_SECRET;
  if ((!secret || secret.length === 0) && process.env.NODE_ENV === "production") {
    logger.error({ correlationId }, "frozen-policy-override: ADMIN_OVERRIDE_HMAC_SECRET not set in production");
    res.status(503).json({
      error: "admin_override_not_configured",
      message: "ADMIN_OVERRIDE_HMAC_SECRET env var is required in production",
      correlationId,
    });
    return;
  }

  // ── Body validation ──────────────────────────────────────────────────────
  const body = (req.body ?? {}) as {
    strategy_id?: unknown;
    rationale?: unknown;
    timestamp?: unknown;
  };

  if (typeof body.strategy_id !== "string" || body.strategy_id.trim().length === 0) {
    res.status(400).json({ error: "missing_or_invalid_field", field: "strategy_id", correlationId });
    return;
  }
  if (typeof body.rationale !== "string") {
    res.status(400).json({ error: "missing_or_invalid_field", field: "rationale", correlationId });
    return;
  }
  if (typeof body.timestamp !== "number") {
    res.status(400).json({ error: "missing_or_invalid_field", field: "timestamp", correlationId });
    return;
  }

  const strategyId = body.strategy_id.trim();
  const rationale = body.rationale;
  const timestamp = body.timestamp;

  // ── Replay protection: timestamp drift > 60s ─────────────────────────────
  const nowMs = Date.now();
  const tsMs = timestamp * 1000; // Unix seconds → ms
  const drift = Math.abs(nowMs - tsMs);
  if (drift > OVERRIDE_TIMESTAMP_DRIFT_MS) {
    logger.warn({ drift, strategyId, correlationId }, "frozen-policy-override: timestamp drift exceeded — replay protection");
    res.status(401).json({
      error: "timestamp_drift_exceeded",
      drift_ms: drift,
      max_drift_ms: OVERRIDE_TIMESTAMP_DRIFT_MS,
      correlationId,
    });
    return;
  }

  // ── HMAC verification ────────────────────────────────────────────────────
  const sig = req.header("x-override-signature");
  const verified = verifyOverrideHmac(sig, timestamp, strategyId, rationale);
  if (!verified.ok) {
    logger.warn(
      { reason_code: verified.reason_code, strategyId, correlationId },
      "frozen-policy-override: HMAC verification failed",
    );
    res.status(401).json({
      error: "hmac_verification_failed",
      reason_code: verified.reason_code,
      correlationId,
    });
    return;
  }

  // ── Rationale length gate (≥50 chars required) ───────────────────────────
  if (rationale.trim().length < RATIONALE_MIN_CHARS) {
    // Write audit row for the too-short rationale attempt (observability signal).
    await db
      .insert(auditLog)
      .values({
        action: "frozen_policy.override_rationale_too_short",
        entityId: strategyId,
        entityType: "strategy",
        status: "warning",
        decisionAuthority: "operator",
        result: {
          rationale_length: rationale.trim().length,
          required_min: RATIONALE_MIN_CHARS,
          correlation_id: correlationId,
        },
        correlationId,
      })
      .catch((auditErr) => {
        logger.warn({ err: auditErr, correlationId }, "frozen-policy-override: rationale_too_short audit failed (non-blocking)");
      });

    logger.warn({ strategyId, rationale_length: rationale.trim().length, correlationId }, "frozen-policy-override: rationale too short");
    res.status(400).json({
      error: "rationale_too_short",
      required_min_chars: RATIONALE_MIN_CHARS,
      provided_chars: rationale.trim().length,
      correlationId,
    });
    return;
  }

  // ── Load strategy ────────────────────────────────────────────────────────
  const [strategy] = await db
    .select({
      id: strategies.id,
      name: strategies.name,
      config: strategies.config,
      frozenPolicyHash: strategies.frozenPolicyHash,
      frozenPolicyOverrideCount: strategies.frozenPolicyOverrideCount,
    })
    .from(strategies)
    .where(eq(strategies.id, strategyId));

  if (!strategy) {
    res.status(404).json({ error: "strategy_not_found", strategy_id: strategyId, correlationId });
    return;
  }

  // ── Compute new hash from current config ─────────────────────────────────
  const newHash = computeFrozenPolicyHash({ config: strategy.config });
  const now = new Date();
  const newOverrideCount = (strategy.frozenPolicyOverrideCount ?? 0) + 1;

  // ── Atomic DB update + audit in a single transaction ─────────────────────
  // The UPDATE (policy hash) and the audit INSERT must commit or rollback
  // together.  A commit-then-fail-to-audit leaves the hash mutated but
  // invisible — the exact gap this fix closes.
  try {
    await db.transaction(async (tx) => {
      await tx
        .update(strategies)
        .set({
          frozenPolicyHash: newHash,
          frozenPolicySetAt: now,
          frozenPolicyOverrideCount: newOverrideCount,
          updatedAt: now,
        })
        .where(eq(strategies.id, strategyId));

      await tx
        .insert(auditLog)
        .values({
          action: "frozen_policy.override_used",
          entityId: strategyId,
          entityType: "strategy",
          status: "success",
          decisionAuthority: "operator",
          result: {
            strategy_name: strategy.name,
            rationale,
            previous_hash: strategy.frozenPolicyHash ?? null,
            new_hash: newHash,
            override_count: newOverrideCount,
            frozen_at: now.toISOString(),
            correlation_id: correlationId,
          },
          correlationId,
        });
    });
  } catch (txErr) {
    logger.error(
      { err: txErr, strategyId, correlationId },
      "frozen-policy-override: transaction (UPDATE + audit) failed — neither committed",
    );
    res.status(500).json({
      error: "override_transaction_failed",
      message: "Policy update and audit could not be committed atomically. No change was made.",
      correlationId,
    });
    return;
  }

  logger.info(
    {
      strategyId,
      strategyName: strategy.name,
      newHash: newHash.slice(0, 16) + "...",
      overrideCount: newOverrideCount,
      correlationId,
    },
    "frozen-policy-override: override applied successfully",
  );

  // Wave 29 prod hardening: Prom counter #6 + Discord escalation
  // Note: frozenPolicyOverridesTotal has no labelNames in registry (cardinality=1 by design).
  // Rationale-length bucketing is recorded in audit_log result payload only.
  try {
    frozenPolicyOverridesTotal.inc();
  } catch (_promErr) { /* non-blocking */ }
  try {
    const discordBody = appendFamilyGradePostscript(
      `Frozen-policy HMAC override exercised for strategy ${strategyId} (${strategy.name}); rationale=${rationale.slice(0, 200)}`,
      "An operator manually bypassed a strategy protection gate. This is an audited action.",
      "No action needed for family members — the bot will continue operating.",
    );
    notifyWarning(`Frozen-Policy Override: strategy ${strategyId}`, discordBody, { strategyId, overrideCount: newOverrideCount });
  } catch (_discordErr) { /* non-blocking */ }

  res.json({
    ok: true,
    strategy_id: strategyId,
    strategy_name: strategy.name,
    new_hash: newHash,
    override_count: newOverrideCount,
    frozen_at: now.toISOString(),
    correlation_id: correlationId,
  });
});
