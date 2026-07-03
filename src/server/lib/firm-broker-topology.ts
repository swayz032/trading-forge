/**
 * firm-broker-topology.ts — deep-scan #15 FIX M3 (2026-07-03)
 *
 * Single source of truth for the CLAUDE.md §7 firm↔broker_type routing invariant.
 *
 *   normalized firm 'topstep'  ⇒ broker_type MUST be 'topstepx'   (NEVER traderspost)
 *   normalized firm (any other,⇒ broker_type MUST be 'traderspost'
 *     e.g. 'mffu')
 *
 * Topstep uses TopstepX ONLY since the 2026-01-12 Tradovate/NinjaTrader lockdown;
 * routing a Topstep order through TradersPost is a topology + compliance violation.
 *
 * Used by:
 *   - broker-router.ts dispatch-time firm_broker_mismatch guard (F-3) — so the
 *     runtime block and this helper can never drift.
 *   - assertFirmBrokerTopology() — an INSERT/UPDATE-time guard callers wire in
 *     wherever a broker_accounts row is written (defense-in-depth alongside the
 *     DB CHECK constraint from migration 0190).
 *
 * Pure, DB-free, no side effects — directly unit-testable.
 */

/**
 * Normalize a firm id the same way broker-router.ts derives `invariantFirmKey`:
 * strip an account-tier suffix (e.g. "_50k", "_100k") and lowercase.
 */
export function normalizeFirmKey(firmId: string): string {
  return (firmId ?? "").toLowerCase().replace(/_\d+k$/, "");
}

/**
 * The broker_type a given firm MUST route through.
 * topstep ⇒ topstepx; everything else ⇒ traderspost.
 */
export function expectedBrokerTypeForFirm(firmId: string): "topstepx" | "traderspost" {
  return normalizeFirmKey(firmId) === "topstep" ? "topstepx" : "traderspost";
}

export interface FirmBrokerTopologyResult {
  /** True when the firm↔broker_type pairing is valid. */
  valid: boolean;
  /** The broker_type the firm is required to use. */
  expectedBrokerType: "topstepx" | "traderspost";
  /** Normalized firm key used for the decision (suffix-stripped, lowercased). */
  firmKey: string;
  /** Human-readable reason (only meaningful when valid === false). */
  reason: string | null;
}

/**
 * Validate a firm↔broker_type pairing.
 *
 * Empty/missing firmId or brokerType is INVALID (fail-closed) — a topology guard
 * cannot vouch for a row with no firm or no broker.
 */
export function validateFirmBrokerTopology(
  firmId: string | null | undefined,
  brokerType: string | null | undefined,
): FirmBrokerTopologyResult {
  const firmKey = normalizeFirmKey(firmId ?? "");
  const expectedBrokerType = firmKey === "topstep" ? "topstepx" : "traderspost";

  if (!firmId || firmId.trim() === "") {
    return { valid: false, expectedBrokerType, firmKey, reason: "firm_id is null/empty" };
  }
  if (!brokerType || brokerType.trim() === "") {
    return { valid: false, expectedBrokerType, firmKey, reason: "broker_type is null/empty" };
  }
  if (brokerType !== expectedBrokerType) {
    return {
      valid: false,
      expectedBrokerType,
      firmKey,
      reason: `firm '${firmId}' (key '${firmKey}') requires broker_type '${expectedBrokerType}' but got '${brokerType}'`,
    };
  }
  return { valid: true, expectedBrokerType, firmKey, reason: null };
}

/**
 * Error thrown by assertFirmBrokerTopology on an invalid pairing.
 */
export class FirmBrokerTopologyError extends Error {
  readonly firmId: string | null | undefined;
  readonly brokerType: string | null | undefined;
  readonly expectedBrokerType: "topstepx" | "traderspost";
  constructor(result: FirmBrokerTopologyResult, firmId: string | null | undefined, brokerType: string | null | undefined) {
    super(`firm_broker_topology_violation: ${result.reason}`);
    this.name = "FirmBrokerTopologyError";
    this.firmId = firmId;
    this.brokerType = brokerType;
    this.expectedBrokerType = result.expectedBrokerType;
  }
}

/**
 * INSERT/UPDATE-time guard: throws FirmBrokerTopologyError when the pairing is
 * invalid. Wire this wherever a broker_accounts row is written so a mis-seeded
 * row is refused BEFORE it hits the DB (belt-and-suspenders with the migration
 * 0190 CHECK constraint).
 */
export function assertFirmBrokerTopology(
  firmId: string | null | undefined,
  brokerType: string | null | undefined,
): void {
  const result = validateFirmBrokerTopology(firmId, brokerType);
  if (!result.valid) {
    throw new FirmBrokerTopologyError(result, firmId, brokerType);
  }
}
