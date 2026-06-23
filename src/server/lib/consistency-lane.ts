/**
 * consistency-lane.ts — when does the single-day consistency rule actually apply?
 *
 * Topstep's consistency rule ("your biggest day can't exceed 40-50% of total net P&L") is an
 * EVAL / pass-request rule AND the optional XFA "Consistency" PAYOUT LANE — it is NOT required
 * on the Standard payout lane in a funded account. The operator runs the **Standard lane**
 * post-eval (big winning days are fine, no day-size cap), so the consistency entry-gate must
 * NOT throttle funded trading.
 *
 * Because the account's stage (eval vs funded) and payout lane aren't tracked in a column, the
 * gate is OPT-IN: default OFF (Standard lane), enable per-account/session or via env for the
 * eval phase or the Consistency lane. Resolution precedence:
 *   1. session config `consistency_rule_enforced` (explicit boolean) — highest
 *   2. session config `consistency_lane` / `phase` ("eval"|"consistency" → on; "standard"|"funded" → off)
 *   3. env `TOPSTEP_CONSISTENCY_RULE_ENFORCED` ("true"/"1" → on)
 *   4. default → OFF (Standard lane — operator's choice 2026-06-23)
 */

export interface ConsistencyLaneConfig {
  consistency_rule_enforced?: boolean;
  consistency_lane?: string;
  phase?: string;
}

export function resolveConsistencyEnforced(
  config: ConsistencyLaneConfig | null | undefined,
): boolean {
  // 1. explicit per-session boolean override
  if (config?.consistency_rule_enforced === true) return true;
  if (config?.consistency_rule_enforced === false) return false;

  // 2. lane / phase string
  const lane = (config?.consistency_lane ?? config?.phase ?? "").toLowerCase().trim();
  if (lane === "consistency" || lane === "eval") return true;
  if (lane === "standard" || lane === "funded") return false;

  // 3. env default (operator can flip on globally for an eval run)
  const env = (
    process.env.TOPSTEP_CONSISTENCY_RULE_ENFORCED ??
    process.env.CONSISTENCY_RULE_ENFORCED ??
    "false"
  )
    .toLowerCase()
    .trim();
  if (env === "true" || env === "1") return true;

  // 4. default OFF — Standard payout lane (no day-size cap in a funded account)
  return false;
}
