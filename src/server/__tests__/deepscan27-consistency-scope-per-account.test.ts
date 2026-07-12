/**
 * deep-scan #27 (2026-07-11) — consistency daily-digest per-account scoping.
 *
 * The digest iterates broker accounts and calls getConsistencyState(account_id). Before this fix
 * the scope clause for a broker-account UUID resolved to `ps.firm_id = <firm>` ONLY, so two
 * different-strategy accounts on the SAME firm (two family members on MFFU, or the operator's two
 * Topstep accounts running different strategies) were netted into one concentration % — a prop-firm
 * single-day-rule miscalculation on a capital-safety surface. paper_sessions has no account_id, but
 * account_strategy_assignments maps account_id → strategy_id, so the broker-account branch now scopes
 * to firm AND the account's assigned strategy.
 *
 * consistency-scope.ts is DB-free (pure drizzle `sql` template), so we serialize the emitted fragment
 * with PgDialect and assert on the SQL text — no DB connection required.
 */
import { describe, it, expect } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { _buildScopeClause, CONSISTENCY_RULE_FIRMS } from "../services/consistency-scope.js";

const dialect = new PgDialect();
const toSql = (accountId: string): string =>
  dialect.sqlToQuery(_buildScopeClause(accountId)).sql;

const UUID = "11111111-2222-4333-8444-555555555555";

describe("deep-scan #27 — consistency scope clause per-account grain", () => {
  it("broker-account UUID branch scopes to firm AND the account's assigned strategy", () => {
    const s = toSql(UUID);
    // still keys off the account's own firm...
    expect(s).toContain("broker_accounts");
    expect(s).toContain("firm_id");
    // ...but ALSO narrows to the strategy assigned to THIS account (the #27 fix)
    expect(s).toContain("account_strategy_assignments");
    expect(s).toContain("strategy_id");
  });

  it("keeps the live-gate session-id branch (ps.id = <uuid>) so a session stays session-scoped", () => {
    const s = toSql(UUID);
    expect(s).toMatch(/ps\.id\s*=/);
    // the two branches are OR'd — session-id path OR the (firm AND strategy) broker-account path
    expect(s.toLowerCase()).toContain(" or ");
    expect(s.toLowerCase()).toContain(" and ");
  });

  it('"paper-close:<firm>" prefix scopes to that firm only (close path — unchanged)', () => {
    const s = toSql("paper-close:topstep");
    expect(s).toContain("firm_id");
    // close path is intentionally firm-scoped; must NOT drag in the per-strategy sub-filter
    expect(s).not.toContain("account_strategy_assignments");
  });

  it("non-UUID / non-prefixed input falls back to the conservative firm-union (fail-open)", () => {
    const s = toSql("not-a-real-account");
    expect(s).toContain("firm_id");
    for (const firm of CONSISTENCY_RULE_FIRMS) {
      expect(s).toContain(firm);
    }
    expect(s).not.toContain("account_strategy_assignments");
  });
});
