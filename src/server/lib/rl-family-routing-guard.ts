/**
 * rl-family-routing-guard.ts — MED-2 (quantum re-scan 2026-07-10)
 *
 * Pure decision for the family A/B-routing invariant: rl-challenger paper routing is
 * OPERATOR-ONLY (CLAUDE.md §13 + memory feedback_family_not_part_of_operator_scaling). A
 * strategy released to a family member must NEVER route to the slumdawg-rl-challenger
 * sub-account — if `paper_account_routing` somehow reads "rl-challenger" on a family
 * strategy (operator tooling error; the DB column is mutable), we FORCE it back to baseline.
 *
 * paper-signal-service.ts does the DB read (is-this-strategy-released-to-family?) and the
 * audit write inline; this helper isolates the branch-free DECISION so it is unit-testable
 * without driving the ~6000-line evaluateSignals path (the family-governance path had zero
 * behavioral coverage before this).
 */

export type PaperAccountRouting = "baseline" | "rl-challenger" | string;

export interface EffectiveRoutingResult {
  /** The routing that will actually be used. */
  effectiveRouting: PaperAccountRouting;
  /** True iff the family invariant forced an rl-challenger → baseline override. */
  overridden: boolean;
}

/**
 * Resolve the effective paper-account routing under the family invariant.
 * ONLY rl-challenger on a family strategy is overridden; every other combination passes
 * through unchanged (baseline stays baseline; rl-challenger on a NON-family/operator
 * strategy stays rl-challenger; unknown values pass through).
 */
export function resolveEffectiveRouting(
  routingDecision: PaperAccountRouting,
  isFamilyStrategy: boolean,
): EffectiveRoutingResult {
  if (routingDecision === "rl-challenger" && isFamilyStrategy) {
    return { effectiveRouting: "baseline", overridden: true };
  }
  return { effectiveRouting: routingDecision, overridden: false };
}
