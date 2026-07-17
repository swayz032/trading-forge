/**
 * pine-export-ab-routing-guard.ts
 *
 * post-m3-paper-execution-lifecycle wave (2026-07-17) HIGH fix — the decision point for
 * pine-export-service.ts's "Pass 6 Track B: A/B routing account_id injection" block.
 *
 * THE BUG: strategies.paper_account_routing is NOT NULL DEFAULT 'baseline' at the schema level
 * (src/server/db/schema.ts). So EVERY strategy that never explicitly opted into the operator's
 * own slumdawg A/B-test cohort still reads "baseline" — and the pre-fix injection block treated
 * that schema DEFAULT identically to a deliberate opt-in, unconditionally resolving and injecting
 * the operator's OWN slumdawg-baseline paper-account UUID into config.account_id for any
 * strategy's Pine compile where the caller had not already supplied one. Confirmed by direct
 * read of src/engine/pine_compiler.py, that UUID is consumed in TWO places: the tf_gateway
 * archetype alertcondition embed (gated on gateway_mode) AND the "marker alertcondition" block
 * (~pine_compiler.py:2753 `if account_id and hmac_secret:`), which fires REGARDLESS of
 * gateway_mode whenever both account_id and hmac_secret are present — exactly the shape of a
 * per-recipient FAMILY HMAC export. So an unrelated family-distributed strategy's Pine artifact
 * could silently carry the operator's own paper-trading account UUID baked into its marker block.
 *
 * THE FIX: skip the injection whenever the strategy is released to a family member — mirrors the
 * SAME family invariant already established + tested for the identical "A/B routing is
 * operator-only" concern in paper-signal-service.ts's rl-family-routing-guard.ts (MED-2,
 * quantum re-scan 2026-07-10). This module is that guard's sibling for the Pine-export surface.
 *
 * Isolated as a pure, branch-free decision (same pattern as resolveEffectiveRouting) so the
 * scoping logic is unit-testable without driving pine-export-service.ts's full compileDualPineExport
 * (DB writes, Python subprocess compile, artifact persistence — a very large integration surface
 * with zero cheap way to reach this one decision point end-to-end).
 */

export interface AbRoutingInjectionDecisionInput {
  /** True when the caller already supplied an explicit accountId — caller always wins. */
  hasExplicitAccountId: boolean;
  /**
   * True when strategies.id has an account_strategy_assignments row with released_to_family=true.
   * A/B routing (baseline or rl-challenger) is operator-only — family strategies are, by
   * definition, "unrelated strategies" with respect to the operator's own slumdawg A/B cohort.
   */
  isFamilyStrategy: boolean;
}

/**
 * Decide whether pine-export-service.ts's A/B-routing account_id auto-injection should run.
 *
 * Truth table:
 *   hasExplicitAccountId=true  -> false, always (caller's explicit value must never be overridden)
 *   isFamilyStrategy=true      -> false (operator-only invariant — closes the "unrelated
 *                                  strategies" leak this wave's finding reported)
 *   otherwise                  -> true (genuinely unassigned + non-family strategy — the schema
 *                                  default legitimately applies)
 */
export function shouldInjectAbRoutingAccountId(input: AbRoutingInjectionDecisionInput): boolean {
  if (input.hasExplicitAccountId) return false;
  if (input.isFamilyStrategy) return false;
  return true;
}
