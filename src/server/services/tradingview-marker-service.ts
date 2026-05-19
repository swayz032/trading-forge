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
import { logger } from "../index.js";

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
 * Validate the HMAC-SHA256 signature on a TradingView webhook payload.
 *
 * Algorithm:
 *   1. Serialize payload WITHOUT the `hmac` field (deterministic JSON)
 *   2. Compute HMAC-SHA256(secret, serialized_body) → hex digest
 *   3. Compare using timingSafeEqual to prevent timing oracle attacks
 *
 * SECURITY: uses crypto.timingSafeEqual — mandatory for secrets.
 * A timing difference on string comparison would leak secret characters
 * at ~0.3ns/byte resolution on modern CPUs (timing-side-channel attacks).
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
    // Build canonical body: payload without the hmac field, sorted keys
    const bodyForSigning = { ...payload };
    delete bodyForSigning["hmac"];
    const serialized = JSON.stringify(bodyForSigning, Object.keys(bodyForSigning).sort());

    const expectedHmac = createHmac("sha256", secret)
      .update(serialized, "utf8")
      .digest("hex");

    // Both must be the same length for timingSafeEqual — pad if needed
    // (hex strings from SHA256 are always 64 chars, so this is just safety)
    const expectedBuf = Buffer.from(expectedHmac, "utf8");
    const providedBuf = Buffer.from(providedHmac, "utf8");

    if (expectedBuf.length !== providedBuf.length) {
      // Different lengths → definitely invalid; still takes constant time
      // relative to length of expectedBuf to avoid length oracle
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
 * Raw SQL: account_strategy_assignments may not be in Drizzle snapshot.
 */
export async function lookupHmacSecret(
  accountId: string,
  strategyId: string
): Promise<string | null> {
  try {
    const rows = await db.execute(
      sql`SELECT hmac_secret
            FROM account_strategy_assignments
           WHERE account_id = ${accountId}::uuid
             AND strategy_id = ${strategyId}::uuid
           LIMIT 1`
    );
    const row = (rows as unknown as { rows: Array<{ hmac_secret: string | null }> }).rows?.[0];
    return row?.hmac_secret ?? null;
  } catch (err) {
    logger.warn({ accountId, strategyId, err }, "tradingview-marker: hmac_secret lookup failed");
    return null;
  }
}
