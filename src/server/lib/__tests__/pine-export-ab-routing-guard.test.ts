/**
 * pine-export-ab-routing-guard.test.ts
 *
 * post-m3-paper-execution-lifecycle wave (2026-07-17) HIGH — re-verified against current
 * (post-M3, un-touched-by-M3) pine-export-service.ts and confirmed STILL PRESENT: the
 * "Pass 6 Track B: A/B routing account_id injection" block was UNCONDITIONAL for any strategy
 * where `!config.account_id`. Since strategies.paper_account_routing is NOT NULL DEFAULT
 * 'baseline' at the schema level (src/server/db/schema.ts:119), every strategy that never
 * explicitly opted into the operator's own slumdawg A/B-test cohort still read "baseline" here —
 * and the block treated that schema DEFAULT identically to a deliberate opt-in, resolving and
 * injecting the OPERATOR's own slumdawg-baseline paper-account UUID into config.account_id for
 * ANY strategy's Pine compile, unconditionally.
 *
 * Confirmed by direct read of src/engine/pine_compiler.py that this UUID reaches the actual
 * compiled artifact text via the "marker alertcondition" block (line ~2753:
 * `if account_id and hmac_secret:`) whenever BOTH are present — REGARDLESS of gateway_mode —
 * exactly the shape of a per-recipient FAMILY HMAC export. So an unrelated family-distributed
 * strategy's Pine artifact could silently carry the operator's own paper-trading account UUID.
 *
 * THE FIX: shouldInjectAbRoutingAccountId() — the pure decision point pine-export-service.ts now
 * routes through — skips injection whenever the strategy is released to a family member,
 * mirroring the SAME family invariant already established for the identical concern in
 * rl-family-routing-guard.ts (paper-signal-service.ts's sibling).
 */

import { describe, it, expect } from "vitest";
import { shouldInjectAbRoutingAccountId } from "../pine-export-ab-routing-guard.js";

describe("shouldInjectAbRoutingAccountId — A/B routing account_id injection scoping (post-m3 HIGH fix)", () => {
  it("returns false when the caller already supplied an explicit accountId (caller always wins, regardless of family status)", () => {
    expect(shouldInjectAbRoutingAccountId({ hasExplicitAccountId: true, isFamilyStrategy: false })).toBe(false);
    expect(shouldInjectAbRoutingAccountId({ hasExplicitAccountId: true, isFamilyStrategy: true })).toBe(false);
  });

  it("THE FIX: returns false for a family-distributed strategy — closes the 'unrelated strategies' leak", () => {
    // This is the exact scenario the finding describes: a strategy released to a family member
    // (an "unrelated strategy" w.r.t. the operator's own slumdawg A/B cohort) that never
    // explicitly set an accountId — pre-fix this returned true unconditionally.
    expect(shouldInjectAbRoutingAccountId({ hasExplicitAccountId: false, isFamilyStrategy: true })).toBe(false);
  });

  it("returns true for a genuinely unassigned, non-family strategy — the schema default legitimately applies", () => {
    // The operator's own slumdawg strategy (or any non-family strategy) with no explicit
    // accountId and no family assignment — this is the ONLY case that should still inject.
    expect(shouldInjectAbRoutingAccountId({ hasExplicitAccountId: false, isFamilyStrategy: false })).toBe(true);
  });

  it("family status takes priority over the schema-default 'baseline' — the whole point of the fix", () => {
    // Both a family strategy and a non-family strategy read paper_account_routing="baseline" by
    // schema default (NOT NULL DEFAULT 'baseline') — the family flag is the ONLY signal that
    // distinguishes "genuinely part of the operator's A/B cohort" from "just inherited the
    // column default". Pre-fix, this distinction did not exist at all.
    const familyResult = shouldInjectAbRoutingAccountId({ hasExplicitAccountId: false, isFamilyStrategy: true });
    const nonFamilyResult = shouldInjectAbRoutingAccountId({ hasExplicitAccountId: false, isFamilyStrategy: false });
    expect(familyResult).not.toBe(nonFamilyResult);
    expect(familyResult).toBe(false);
    expect(nonFamilyResult).toBe(true);
  });
});
