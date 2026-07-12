/**
 * consistency-scope.ts (CAP-3, deep-scan 2026-07-11) — the pure account/firm scope resolution for
 * the consistency tracker, split out of consistency-tracker-service.ts so it can be unit-tested
 * WITHOUT importing the DB layer (the service throws at import if DATABASE_URL is unset). Depends
 * only on drizzle-orm's `sql` template — no DB connection, no side effects.
 */
import { sql, type SQL } from "drizzle-orm";

/**
 * Firms that enforce the 50% single-day consistency rule at eval/pass-request.
 * Operator-confirmed 2026-06-22: both Topstep and MFFU apply this rule.
 * SQL queries use IN (CONSISTENCY_RULE_FIRMS) — not a hard-coded single firm.
 */
export const CONSISTENCY_RULE_FIRMS: string[] = ["topstep", "mffu"];

const _UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const _PAPER_CLOSE_PREFIX = "paper-close:";

/**
 * CAP-3 fix — build the account/firm scope predicate for the concentration queries.
 *
 * The `accountId` parameter is POLYMORPHIC across the callers:
 *   - paper-signal-service.ts (the live entry gate) passes a `paper_sessions.id` (UUID)
 *   - runConsistencyDailyDigest passes a `broker_accounts.account_id` (UUID)
 *   - paper-execution-service.ts (close path) passes "paper-close:<firmId>"
 *   - the GET /consistency/:accountId route passes an operator-supplied id
 *
 * Previously BOTH concentration queries ignored `accountId` entirely and filtered
 * only on `ps.firm_id IN (CONSISTENCY_RULE_FIRMS)` — i.e. they summed profit days
 * across BOTH firms AND every session. That netted two independent funded accounts'
 * P&L into one `cycleCumulativeProfit` / `highestDayProfit`, so a Topstep account
 * whose own best day is >50% of its own cycle could be diluted below 50% by unrelated
 * MFFU / sibling-account profit (or vice-versa) — a prop-firm single-day-rule
 * miscalculation on a capital-safety surface.
 *
 * Scoping strategy (finest scope the schema allows — `paper_sessions` has no
 * account_id column, so a session is the finest per-account grain):
 *   - "paper-close:<firm>" → that firm only.
 *   - a UUID → in ONE predicate (no extra DB round-trip) either the single session
 *     (`ps.id = <uuid>`, the live-gate path — that session ONLY, excluding siblings)
 *     OR that broker account's own firm (subquery; the digest path). The
 *     broker-account subquery returns NULL for a session id, so `ps.firm_id = NULL`
 *     never widens a session-scoped query back to firm-wide.
 *   - anything else (never a real funded account) → conservative legacy firm-union
 *     fallback. This is a fail-OPEN payout-eligibility gate, never account-fatal.
 *
 * Returns a SQL boolean fragment referencing alias `ps` (paper_sessions).
 */
export function _buildScopeClause(accountId: string): SQL {
  if (accountId.startsWith(_PAPER_CLOSE_PREFIX)) {
    const firmId = accountId.slice(_PAPER_CLOSE_PREFIX.length);
    return sql`ps.firm_id = ${firmId}`;
  }
  if (_UUID_RE.test(accountId)) {
    return sql`(
      ps.id = ${accountId}::uuid
      OR ps.firm_id = (
        SELECT ba.firm_id FROM broker_accounts ba WHERE ba.account_id = ${accountId}::uuid
      )
    )`;
  }
  const firmList = CONSISTENCY_RULE_FIRMS.map((f) => `'${f}'`).join(", ");
  return sql`ps.firm_id IN (${sql.raw(firmList)})`;
}
