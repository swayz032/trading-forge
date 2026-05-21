/**
 * tradingview-marker-service.ts — Track 8 / Pass 3
 *
 * Helper functions for the TradingView Marker Collector:
 *   - validateHmac()         : constant-time HMAC-SHA256 validation
 *   - getRecentMarkers()     : fetch markers for an account in a time window
 *   - getMarkerCountForDate(): count markers for a specific trading date
 *   - reconcileMarkersVsFills(): compare marker count vs TradersPost log count
 *
 * SECURITY: HMAC validation uses crypto.timingSafeEqual to prevent timing attacks.
 * A 1-byte timing difference could reveal secret characters — constant-time is mandatory.
 *
 * NOTE: This service has NO pipeline pause gate — the marker receiver is a
 * safety-signal intake endpoint (analogous to C1/C2 health probes).
 * The pipeline pause applies to TRADING decisions, not to event capture.
 */

import { createHmac, timingSafeEqual } from "crypto";
import { db } from "../db/index.js";
import { tradingviewMarkers } from "../db/schema.js";
import { and, gte, lt, count, eq, sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";
// F-10: canonical marker HMAC strings — single source of truth shared with
// the Python emitter (src/engine/marker_contract.py).
import { buildWebhookCanonical } from "../../shared/marker-contract.js";

// Re-export the export-time canonical helper so test fixtures and audit tools
// can verify producer/consumer agreement without inlining the format.
export { buildExportCanonical } from "../../shared/marker-contract.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MarkerRow {
  id: number;
  strategyId: string;
  accountId: string;
  barTimestamp: Date;
  signal: number;
  pineAlertPayload: Record<string, unknown>;
  hmacValidated: boolean;
  receivedAt: Date;
  correlationId: string | null;
}

export interface MarkerMismatch {
  type: "tradingview_marker_vs_traderspost_log";
  markerCount: number;
  traderspostCount: number;
  delta: number;
  severity: "critical" | "warning";
  interpretation: string;
}

// ─── HMAC Validation ─────────────────────────────────────────────────────────

/**
 * Build the canonical HMAC signing string (F-7).
 *
 * Canonical form: "<strategy_id>|<account_id>|<bar_timestamp>|<signal>"
 *
 * This replaces the previous JSON.stringify(sortedKeys) approach which was
 * ambiguous — extra passthrough fields in the payload changed the signing body.
 *
 * CARRY-FORWARD (CARRY-FORWARD-F7-PINE-SIGNER): Pine alertcondition() embeds
 * HMAC via input.string() pasted by the user at chart load. The user must
 * pre-compute the HMAC from this canonical form before pasting. A future helper
 * script would compute it automatically.
 *
 * Feature flag: HMAC_CANONICAL_V2=false reverts to legacy JSON.stringify during
 * emergency rollback. Default: new canonical form is active.
 */
export function buildHmacCanonical(
  strategyId: string,
  accountId: string,
  barTimestamp: string,
  signal: number,
): string {
  // F-10: delegate to shared/marker-contract — Python mirror at
  // src/engine/marker_contract.py uses the byte-identical formatter.
  return buildWebhookCanonical(strategyId, accountId, barTimestamp, signal);
}

/**
 * Validate the HMAC-SHA256 signature on a TradingView webhook payload.
 *
 * F-7: Uses explicit fixed-field canonical form instead of JSON.stringify.
 * Canonical string: "<strategy_id>|<account_id>|<bar_timestamp>|<signal>"
 *
 * SECURITY: uses crypto.timingSafeEqual — mandatory for secrets.
 *
 * @param payload - full webhook body as parsed object
 * @param providedHmac - hex string from the `hmac` field of the payload
 * @param secret - hex string from account_strategy_assignments.hmac_secret
 * @returns true iff HMAC is valid
 */
export function validateHmac(
  payload: Record<string, unknown>,
  providedHmac: string,
  secret: string
): boolean {
  try {
    let serialized: string;

    const useNewCanonical = process.env.HMAC_CANONICAL_V2 !== "false";

    if (useNewCanonical) {
      // F-7: Explicit fixed-field canonical form — unambiguous, immune to extra fields.
      const strategyId = String(payload["strategy_id"] ?? "");
      const accountId  = String(payload["account_id"] ?? "");
      const barTimestamp = String(payload["bar_timestamp"] ?? "");
      const signal     = Number(payload["signal"] ?? 0);
      serialized = buildHmacCanonical(strategyId, accountId, barTimestamp, signal);
    } else {
      // Legacy: JSON.stringify sorted keys (emergency rollback path).
      const bodyForSigning = { ...payload };
      delete bodyForSigning["hmac"];
      serialized = JSON.stringify(bodyForSigning, Object.keys(bodyForSigning).sort());
    }

    const expectedHmac = createHmac("sha256", secret)
      .update(serialized, "utf8")
      .digest("hex");

    const expectedBuf = Buffer.from(expectedHmac, "utf8");
    const providedBuf = Buffer.from(providedHmac, "utf8");

    if (expectedBuf.length !== providedBuf.length) {
      return false;
    }

    return timingSafeEqual(expectedBuf, providedBuf);
  } catch (err) {
    logger.warn({ err }, "tradingview-marker: HMAC validation threw — returning false");
    return false;
  }
}

// ─── DB Reads ─────────────────────────────────────────────────────────────────

/**
 * Fetch recent markers for an account.
 *
 * @param accountId - broker_accounts.account_id (UUID)
 * @param hours - look-back window in hours (default 24)
 */
export async function getRecentMarkers(
  accountId: string,
  hours: number = 24
): Promise<MarkerRow[]> {
  const since = new Date(Date.now() - hours * 3_600_000);

  const rows = await db
    .select()
    .from(tradingviewMarkers)
    .where(
      and(
        eq(tradingviewMarkers.accountId, accountId),
        gte(tradingviewMarkers.receivedAt, since)
      )
    )
    .orderBy(tradingviewMarkers.barTimestamp);

  return rows.map((r) => ({
    id: r.id,
    strategyId: r.strategyId,
    accountId: r.accountId,
    barTimestamp: r.barTimestamp,
    signal: r.signal,
    pineAlertPayload: r.pineAlertPayload as Record<string, unknown>,
    hmacValidated: r.hmacValidated,
    receivedAt: r.receivedAt,
    correlationId: r.correlationId ?? null,
  }));
}

/**
 * Count tradingview_markers rows for a specific trading date (UTC boundaries).
 * Used by 5-source reconciliation.
 *
 * @param accountId - broker_accounts.account_id (UUID string)
 * @param date - ISO date string ("YYYY-MM-DD") or Date for day boundaries
 */
export async function getMarkerCountForDate(
  accountId: string,
  date: Date | string
): Promise<number> {
  const d = typeof date === "string" ? new Date(date + "T00:00:00Z") : date;
  const dayStart = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayEnd   = new Date(dayStart.getTime() + 86_400_000);

  const rows = await db
    .select({ cnt: count() })
    .from(tradingviewMarkers)
    .where(
      and(
        eq(tradingviewMarkers.accountId, accountId),
        gte(tradingviewMarkers.barTimestamp, dayStart),
        lt(tradingviewMarkers.barTimestamp, dayEnd)
      )
    );

  return Number(rows[0]?.cnt ?? 0);
}

/**
 * Compare TradingView marker count vs TradersPost log count for a given date.
 *
 * Mismatch interpretation:
 *   markerCount > traderspostCount → Pine fired but TradersPost has no record
 *                                    (webhook delivery failure)
 *   markerCount < traderspostCount → TradersPost has order without Pine marker
 *                                    (manual override or duplicate send)
 *
 * Severity:
 *   |delta| > 1 → critical
 *   |delta| === 1 → warning
 *
 * @param accountId - broker_accounts.account_id
 * @param date - trading date (YYYY-MM-DD)
 * @param traderspostLogCount - count already fetched from production source 2
 */
export async function reconcileMarkersVsFills(
  accountId: string,
  date: Date | string,
  traderspostLogCount: number
): Promise<MarkerMismatch | null> {
  const markerCount = await getMarkerCountForDate(accountId, date);

  if (markerCount === traderspostLogCount) {
    return null;
  }

  const delta = markerCount - traderspostLogCount;
  const absDelta = Math.abs(delta);
  const severity: "critical" | "warning" = absDelta > 1 ? "critical" : "warning";

  let interpretation: string;
  if (delta > 0) {
    interpretation =
      `Pine fired ${markerCount} alerts but TradersPost only shows ${traderspostLogCount} ` +
      `— webhook delivery failure likely (${delta} alert(s) not delivered)`;
  } else {
    interpretation =
      `TradersPost shows ${traderspostLogCount} orders but only ${markerCount} Pine alert(s) ` +
      `— possible manual override or duplicate delivery (${Math.abs(delta)} extra order(s))`;
  }

  logger.warn(
    { accountId, date: typeof date === "string" ? date : date.toISOString().slice(0, 10),
      markerCount, traderspostLogCount, delta, severity },
    "tradingview-marker: marker vs traderspost mismatch"
  );

  return {
    type: "tradingview_marker_vs_traderspost_log",
    markerCount,
    traderspostCount: traderspostLogCount,
    delta,
    severity,
    interpretation,
  };
}

/**
 * Fetch HMAC secret for (accountId, strategyId) from account_strategy_assignments.
 * Returns null when no assignment row exists or secret is unset.
 *
 * F-3: Prefers hmac_secret_encrypted (migration 0128) when populated and
 * HMAC_ENCRYPTION_KEY is set. Falls back to plaintext hmac_secret during the
 * transition window. Fail-closed in production when encrypted column is set
 * but key is absent.
 *
 * Raw SQL via sql tagged template — account_strategy_assignments may not be
 * in Drizzle snapshot.
 */
export async function lookupHmacSecret(
  accountId: string,
  strategyId: string
): Promise<string | null> {
  try {
    const encKey = process.env.HMAC_ENCRYPTION_KEY;

    // F-3: Prefer DB-decrypted value when key is available.
    const query = encKey
      ? sql`
          SELECT
            CASE
              WHEN hmac_secret_encrypted IS NOT NULL
              THEN pgp_sym_decrypt(hmac_secret_encrypted, ${encKey}::text)
              ELSE hmac_secret
            END AS resolved_secret
          FROM account_strategy_assignments
          WHERE account_id = ${accountId}::uuid
            AND strategy_id = ${strategyId}::uuid
          LIMIT 1`
      : sql`
          SELECT
            hmac_secret AS resolved_secret,
            (hmac_secret_encrypted IS NOT NULL) AS has_encrypted
          FROM account_strategy_assignments
          WHERE account_id = ${accountId}::uuid
            AND strategy_id = ${strategyId}::uuid
          LIMIT 1`;

    const rows = await db.execute(query);
    const row = (rows as unknown as {
      rows: Array<{ resolved_secret: string | null; has_encrypted?: boolean }>;
    }).rows?.[0];

    if (!row) return null;

    // F-3: fail-closed in production if encrypted column is set but no key.
    if (!encKey && row.has_encrypted && process.env.NODE_ENV === "production") {
      logger.error(
        { accountId, strategyId },
        "tradingview-marker: hmac_secret_encrypted is set but HMAC_ENCRYPTION_KEY is missing — " +
        "refusing to fall back to plaintext in production. Set HMAC_ENCRYPTION_KEY and restart.",
      );
      return null;
    }

    return row.resolved_secret ?? null;
  } catch (err) {
    // F-3 (Pass 6 / Track A 2026-05-20): the previous catch returned the plaintext
    // hmac_secret unconditionally — including in production. That defeats migration
    // 0128 (HMAC encryption-at-rest) on every transient pgcrypto error. Now we
    // FAIL CLOSED in production: log at ERROR and return null so the marker route
    // emits 401 and the operator is alerted. Plaintext fallback is permitted only
    // when NODE_ENV is dev/test AND the explicit feature flag HMAC_PLAINTEXT_FALLBACK
    // is set to "true" (e.g. local debugging before migration 0128 is applied).
    const isProd = process.env.NODE_ENV === "production";
    const plaintextFallbackAllowed =
      !isProd && process.env.HMAC_PLAINTEXT_FALLBACK === "true";

    logger.error(
      { accountId, strategyId, err, isProd, plaintextFallbackAllowed },
      "tradingview-marker: encrypted hmac lookup failed — " +
      (plaintextFallbackAllowed
        ? "falling back to plaintext (DEV ONLY)"
        : "refusing plaintext fallback (fail-closed)"),
    );

    if (!plaintextFallbackAllowed) {
      return null;
    }

    try {
      const fallback = await db.execute(
        sql`SELECT hmac_secret FROM account_strategy_assignments
            WHERE account_id = ${accountId}::uuid AND strategy_id = ${strategyId}::uuid LIMIT 1`
      );
      const fallbackRow = (fallback as unknown as { rows: Array<{ hmac_secret: string | null }> }).rows?.[0];
      return fallbackRow?.hmac_secret ?? null;
    } catch (fallbackErr) {
      logger.warn({ accountId, strategyId, fallbackErr }, "tradingview-marker: hmac_secret fallback lookup also failed");
      return null;
    }
  }
}
