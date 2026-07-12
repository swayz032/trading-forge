import { describe, it, expect } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { _buildScopeClause, CONSISTENCY_RULE_FIRMS } from "./consistency-scope.js";

/**
 * CAP-3 regression (deep-scan 2026-07-11). `_buildScopeClause` is the SQL fragment that scopes the
 * consistency-tracker realized/open-position queries to the RIGHT account(s). The fix broadened it
 * from a hard-coded single 'topstep' firm to three account-identity shapes; this pins each branch and
 * its bound params so a revert to firm-agnostic / wrong-scope SQL fails here. Rendered via the real
 * Postgres dialect so the assertions are on the exact emitted SQL + parameter list.
 */
const dialect = new PgDialect();
const render = (accountId: string) => dialect.sqlToQuery(_buildScopeClause(accountId));

describe("_buildScopeClause (CAP-3 consistency-tracker account scoping)", () => {
  it("paper-close:<firm> scopes to that single firm as a bound param (no injection)", () => {
    const q = render("paper-close:topstep");
    expect(q.sql.replace(/\s+/g, " ").trim()).toBe("ps.firm_id = $1");
    expect(q.params).toEqual(["topstep"]);
  });

  it("a UUID account scopes to that session OR (its broker-account firm AND its assigned strategy)", () => {
    const uuid = "1b4e28ba-2fa1-4d3b-8f2e-0a1b2c3d4e5f";
    const q = render(uuid);
    const flat = q.sql.replace(/\s+/g, " ").trim();
    expect(flat).toContain("ps.id = $1::uuid");
    expect(flat).toContain("ps.firm_id = (");
    expect(flat).toContain("broker_accounts ba");
    expect(flat).toContain("ba.account_id = $2::uuid");
    // deep-scan #27 (2026-07-11): the broker-account branch now ALSO narrows to the account's
    // assigned strategy (account_strategy_assignments) so two different-strategy same-firm accounts
    // no longer net into one concentration %. That adds a THIRD bind of the same uuid.
    expect(flat).toContain("account_strategy_assignments asa");
    expect(flat).toContain("asa.account_id = $3::uuid");
    // The uuid is bound THREE times (session id + broker-account firm lookup + assigned-strategy
    // lookup) — never string-interpolated.
    expect(q.params).toEqual([uuid, uuid, uuid]);
  });

  it("a legacy firm-name scopes to the full CONSISTENCY_RULE_FIRMS set (Topstep + MFFU, not just Topstep)", () => {
    const q = render("topstep");
    const flat = q.sql.replace(/\s+/g, " ").trim().toLowerCase();
    expect(flat).toBe("ps.firm_id in ('topstep', 'mffu')");
    // Regression guard: the fix's whole point was NOT collapsing to a single firm.
    for (const firm of CONSISTENCY_RULE_FIRMS) expect(flat).toContain(`'${firm}'`);
    expect(CONSISTENCY_RULE_FIRMS.length).toBeGreaterThanOrEqual(2);
  });

  it("the three account shapes produce DISTINCT scope SQL (no branch collapse)", () => {
    const a = render("paper-close:topstep").sql;
    const b = render("1b4e28ba-2fa1-4d3b-8f2e-0a1b2c3d4e5f").sql;
    const c = render("topstep").sql;
    expect(new Set([a, b, c]).size).toBe(3);
  });
});
