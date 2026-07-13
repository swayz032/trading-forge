import rawRuleBook from "./firm-stage-rules.json" with { type: "json" };

export type FirmStage = "evaluation" | "funded" | "payout" | "live";

export interface RiskStageRules {
  account_size?: number;
  monthly_fee?: number;
  activation_fee?: number;
  ongoing_monthly_fee?: number;
  starting_balance?: number;
  profit_target?: number;
  max_drawdown?: number;
  trailing?: "eod" | "realtime";
  locks_at_start?: boolean;
  trailing_lock_floor_offset?: number;
  daily_loss_limit?: number | null;
  daily_loss_behavior?: "hard_limit" | "soft_pause";
  max_contracts?: number;
  min_trading_days?: number;
  overnight_ok?: boolean;
  weekend_ok?: boolean;
  consistency?: {
    mode: "dynamic_profit_target";
    ratio: number;
    best_day_persists_after_loss?: boolean;
  } | null;
}

export interface FirmStageRule {
  firm_id: string;
  name: string;
  display_name: string;
  evaluation_type: "one_step" | "two_step";
  macro_blackout_mode: "strict" | "advisory";
  evaluation: RiskStageRules;
  funded: RiskStageRules;
  payout: Record<string, unknown>;
  live: Record<string, unknown>;
  execution: Record<string, unknown>;
}

export interface FirmStageRuleBook {
  schema_version: number;
  firms: Record<string, FirmStageRule>;
}

/**
 * Canonical stage-aware rule source for both server and engine projections.
 * Legacy config readers may use a projection, but no rule values originate
 * outside this JSON rule book.
 */
export const FIRM_STAGE_RULES = rawRuleBook as unknown as FirmStageRuleBook;

function requireNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Invalid numeric rule: ${label}`);
  }
  return value;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid object rule: ${label}`);
  }
  return value as Record<string, unknown>;
}

export function getFirmStageRules(firmKey: string): FirmStageRule {
  const rule = FIRM_STAGE_RULES.firms[firmKey];
  if (!rule) {
    throw new Error(
      `Unknown firm key '${firmKey}'. Valid: ${Object.keys(FIRM_STAGE_RULES.firms).sort().join(", ")}.`,
    );
  }
  return rule;
}

export function getFirmStageRulesById(firmId: string): FirmStageRule {
  const normalized = firmId.trim().toLowerCase();
  const rule = Object.values(FIRM_STAGE_RULES.firms).find(
    (candidate) => candidate.firm_id === normalized,
  );
  if (!rule) {
    throw new Error(`Unknown firm id '${firmId}'.`);
  }
  return rule;
}

export function getStageRules(firmKey: string, stage: FirmStage): Record<string, unknown> {
  return asRecord(getFirmStageRules(firmKey)[stage], `${firmKey}.${stage}`);
}

export function topstepEffectiveProfitTarget(bestDayProfit: number): number {
  const evaluation = getFirmStageRules("topstep_50k").evaluation;
  const consistency = evaluation.consistency;
  if (!consistency || consistency.mode !== "dynamic_profit_target") {
    throw new Error("Topstep evaluation consistency must use dynamic_profit_target.");
  }
  return Math.max(
    requireNumber(evaluation.profit_target, "topstep_50k.evaluation.profit_target"),
    Math.max(bestDayProfit, 0) / consistency.ratio,
  );
}

export interface TopstepCombineResult {
  passed: boolean;
  reason: "eligible" | "minimum_trading_days_not_met" | "effective_profit_target_not_met";
  recoverable: true;
  trading_days: number;
  total_profit: number;
  best_day_profit: number;
  effective_profit_target: number;
}

/**
 * Evaluate a Topstep Combine only. The 50% condition changes the target; it
 * does not create a breach and losses never erase the recorded best day.
 */
export function evaluateTopstepCombine(dailyPnls: readonly number[]): TopstepCombineResult {
  const evaluation = getFirmStageRules("topstep_50k").evaluation;
  const totalProfit = dailyPnls.reduce((sum, pnl) => sum + pnl, 0);
  const bestDayProfit = Math.max(0, ...dailyPnls);
  const effectiveProfitTarget = topstepEffectiveProfitTarget(bestDayProfit);
  const minTradingDays = requireNumber(
    evaluation.min_trading_days,
    "topstep_50k.evaluation.min_trading_days",
  );
  const reason = dailyPnls.length < minTradingDays
    ? "minimum_trading_days_not_met"
    : totalProfit < effectiveProfitTarget
      ? "effective_profit_target_not_met"
      : "eligible";
  return {
    passed: reason === "eligible",
    reason,
    recoverable: true,
    trading_days: dailyPnls.length,
    total_profit: totalProfit,
    best_day_profit: bestDayProfit,
    effective_profit_target: effectiveProfitTarget,
  };
}

export interface TopstepCombineUntilPassResult extends TopstepCombineResult {
  passed_day: number | null;
}

export function evaluateTopstepCombineUntilPass(
  dailyPnls: readonly number[],
): TopstepCombineUntilPassResult {
  let result = evaluateTopstepCombine([]);
  for (let passedDay = 1; passedDay <= dailyPnls.length; passedDay += 1) {
    result = evaluateTopstepCombine(dailyPnls.slice(0, passedDay));
    if (result.passed) {
      return { ...result, passed_day: passedDay };
    }
  }
  return { ...result, passed_day: null };
}

export interface PayoutEligibilityResult {
  eligible: boolean;
  reason: string;
  recoverable: true;
  total_profit: number;
  best_day_profit: number;
  qualifying_days: number;
  consistency_ratio: number | null;
  account_balance: number | null;
  approved_payout_count: number | null;
  requested_amount: number | null;
  permitted_request_max: number | null;
  next_account_state: PayoutAccountState | null;
  eligible_for_live_transition: boolean;
}

export interface PayoutAccountState {
  accountBalance: number;
  balanceAfterLastPayout?: number | null;
  approvedPayoutCount?: number;
  accountStage?: "funded" | "live";
  cycleElapsedHours?: number;
}

interface NormalizedPayoutAccountState {
  accountBalance: number;
  balanceAfterLastPayout: number | null;
  approvedPayoutCount: number;
  accountStage: "funded" | "live";
  cycleElapsedHours: number | null;
}

interface PayoutResultContext {
  accountState?: NormalizedPayoutAccountState;
  requestedAmount?: number | null;
  permittedRequestMax?: number | null;
  nextAccountState?: PayoutAccountState | null;
  eligibleForLiveTransition?: boolean;
}

function payoutResult(
  eligible: boolean,
  reason: string,
  totalProfit: number,
  bestDayProfit: number,
  qualifyingDays: number,
  context: PayoutResultContext = {},
): PayoutEligibilityResult {
  return {
    eligible,
    reason,
    recoverable: true,
    total_profit: totalProfit,
    best_day_profit: bestDayProfit,
    qualifying_days: qualifyingDays,
    consistency_ratio: totalProfit > 0 ? bestDayProfit / totalProfit : null,
    account_balance: context.accountState?.accountBalance ?? null,
    approved_payout_count: context.accountState?.approvedPayoutCount ?? null,
    requested_amount: context.requestedAmount ?? null,
    permitted_request_max: context.permittedRequestMax ?? null,
    next_account_state: context.nextAccountState ?? null,
    eligible_for_live_transition: context.eligibleForLiveTransition ?? false,
  };
}

function normalizePayoutAccountState(
  accountState: PayoutAccountState | undefined,
): { state?: NormalizedPayoutAccountState; reason?: string } {
  if (!accountState) return { reason: "account_state_required" };
  if (!Number.isFinite(accountState.accountBalance) || accountState.accountBalance < 0) {
    return { reason: "invalid_account_state" };
  }
  const approvedPayoutCount = accountState.approvedPayoutCount ?? 0;
  if (!Number.isInteger(approvedPayoutCount) || approvedPayoutCount < 0) {
    return { reason: "invalid_account_state" };
  }
  const balanceAfterLastPayout = accountState.balanceAfterLastPayout ?? null;
  if (
    (balanceAfterLastPayout !== null && (!Number.isFinite(balanceAfterLastPayout) || balanceAfterLastPayout < 0))
    || (approvedPayoutCount > 0 && balanceAfterLastPayout === null)
  ) {
    return { reason: approvedPayoutCount > 0 ? "previous_payout_balance_required" : "invalid_account_state" };
  }
  const accountStage = accountState.accountStage ?? "funded";
  if (accountStage !== "funded" && accountStage !== "live") {
    return { reason: "invalid_account_stage" };
  }
  const cycleElapsedHours = accountState.cycleElapsedHours ?? null;
  if (cycleElapsedHours !== null && (!Number.isFinite(cycleElapsedHours) || cycleElapsedHours < 0)) {
    return { reason: "invalid_account_state" };
  }
  return {
    state: {
      accountBalance: accountState.accountBalance,
      balanceAfterLastPayout,
      approvedPayoutCount,
      accountStage,
      cycleElapsedHours,
    },
  };
}

function nextPayoutAccountState(
  accountState: NormalizedPayoutAccountState,
  requestedAmount: number,
): PayoutAccountState {
  const accountBalance = Number((accountState.accountBalance - requestedAmount).toFixed(2));
  return {
    accountBalance,
    balanceAfterLastPayout: accountBalance,
    approvedPayoutCount: accountState.approvedPayoutCount + 1,
    accountStage: accountState.accountStage,
    cycleElapsedHours: 0,
  };
}

/**
 * Evaluate a funded payout window against the account state at request time.
 * Payout requirements are recoverable and never change account survival.
 * Daily P&L is intentionally insufficient on its own: balance caps and reset
 * rules require the account/cycle state supplied by the caller.
 */
export function evaluatePayoutEligibility(
  firmKey: string,
  dailyPnls: readonly number[],
  options: {
    payoutPath?: string;
    requestedAmount?: number;
    tradedDays?: readonly boolean[];
    dllOptedIn?: boolean;
    accountState?: PayoutAccountState;
  } = {},
): PayoutEligibilityResult {
  const totalProfit = dailyPnls.reduce((sum, pnl) => sum + pnl, 0);
  const bestDayProfit = Math.max(0, ...dailyPnls);
  const consistencyRatio = totalProfit > 0 ? bestDayProfit / totalProfit : null;
  if (options.tradedDays && options.tradedDays.length !== dailyPnls.length) {
    throw new Error("tradedDays must have one entry per daily P&L value.");
  }

  const normalized = normalizePayoutAccountState(options.accountState);
  if (!normalized.state) {
    return payoutResult(false, normalized.reason ?? "invalid_account_state", totalProfit, bestDayProfit, 0);
  }
  const accountState = normalized.state;
  const context = (
    requestedAmount: number | null = options.requestedAmount ?? null,
    permittedRequestMax: number | null = null,
    nextAccountState: PayoutAccountState | null = null,
    eligibleForLiveTransition = false,
  ): PayoutResultContext => ({
    accountState,
    requestedAmount,
    permittedRequestMax,
    nextAccountState,
    eligibleForLiveTransition,
  });

  if (firmKey === "topstep_50k") {
    if (accountState.accountStage !== "funded") {
      return payoutResult(false, "unsupported_payout_stage", totalProfit, bestDayProfit, 0, context());
    }
    const payout = getFirmStageRules(firmKey).payout;
    const selectedPath = options.payoutPath ?? String(payout["default_path"]);
    const paths = asRecord(payout["paths"], "topstep_50k.payout.paths");
    const path = asRecord(paths[selectedPath], `topstep_50k.payout.paths.${selectedPath}`);
    const cap = asRecord(path["payout_cap"], `${selectedPath}.payout_cap`);
    const payoutCap = requireNumber(
      cap[options.dllOptedIn ? "with_dll" : "base"],
      `${selectedPath}.payout_cap.${options.dllOptedIn ? "with_dll" : "base"}`,
    );
    const minimumRequest = requireNumber(payout["minimum_request"], "topstep_50k.payout.minimum_request");
    const balanceCap = accountState.accountBalance * requireNumber(
      payout["account_balance_fraction"],
      "topstep_50k.payout.account_balance_fraction",
    );
    const permittedRequestMax = Math.max(0, Math.min(payoutCap, balanceCap));
    const requestedAmount = options.requestedAmount;
    if (requestedAmount !== undefined && requestedAmount < minimumRequest) {
      return payoutResult(false, "minimum_payout_not_met", totalProfit, bestDayProfit, 0, context(requestedAmount, permittedRequestMax));
    }
    if (requestedAmount !== undefined && requestedAmount > payoutCap) {
      return payoutResult(false, "payout_cap_exceeded", totalProfit, bestDayProfit, 0, context(requestedAmount, permittedRequestMax));
    }
    if (requestedAmount !== undefined && requestedAmount > balanceCap) {
      return payoutResult(false, "payout_balance_cap_exceeded", totalProfit, bestDayProfit, 0, context(requestedAmount, permittedRequestMax));
    }

    const minimumWinningDays = path["minimum_winning_days"];
    if (typeof minimumWinningDays === "number") {
      const minimumWinningDayProfit = requireNumber(
        path["minimum_winning_day_profit"],
        `${selectedPath}.minimum_winning_day_profit`,
      );
      const qualifyingDays = dailyPnls.filter((pnl) => pnl >= minimumWinningDayProfit).length;
      if (qualifyingDays < minimumWinningDays) {
        return payoutResult(false, "minimum_winning_days_not_met", totalProfit, bestDayProfit, qualifyingDays, context(requestedAmount, permittedRequestMax));
      }
      if (
        path["positive_net_profit_since_last_payout_required"] === true
        && accountState.approvedPayoutCount > 0
        && accountState.accountBalance <= (accountState.balanceAfterLastPayout as number)
      ) {
        return payoutResult(false, "positive_net_profit_since_last_payout_required", totalProfit, bestDayProfit, qualifyingDays, context(requestedAmount, permittedRequestMax));
      }
      if (permittedRequestMax < minimumRequest) {
        return payoutResult(false, "payout_balance_cap_below_minimum", totalProfit, bestDayProfit, qualifyingDays, context(requestedAmount, permittedRequestMax));
      }
      return payoutResult(
        true,
        "eligible",
        totalProfit,
        bestDayProfit,
        qualifyingDays,
        context(
          requestedAmount,
          permittedRequestMax,
          requestedAmount === undefined ? null : nextPayoutAccountState(accountState, requestedAmount),
        ),
      );
    }

    if (!options.tradedDays) {
      return payoutResult(false, "traded_days_required", totalProfit, bestDayProfit, 0, context(requestedAmount, permittedRequestMax));
    }
    const qualifyingDays = options.tradedDays.filter(Boolean).length;
    if (qualifyingDays < requireNumber(path["minimum_trading_days"], `${selectedPath}.minimum_trading_days`)) {
      return payoutResult(false, "minimum_trading_days_not_met", totalProfit, bestDayProfit, qualifyingDays, context(requestedAmount, permittedRequestMax));
    }
    if (totalProfit <= 0) {
      return payoutResult(false, "positive_net_profit_required", totalProfit, bestDayProfit, qualifyingDays, context(requestedAmount, permittedRequestMax));
    }
    if (permittedRequestMax < minimumRequest) {
      return payoutResult(false, "payout_balance_cap_below_minimum", totalProfit, bestDayProfit, qualifyingDays, context(requestedAmount, permittedRequestMax));
    }
    if (consistencyRatio !== null && consistencyRatio > requireNumber(path["maximum_consistency_ratio"], `${selectedPath}.maximum_consistency_ratio`)) {
      return payoutResult(false, "consistency_target_not_met", totalProfit, bestDayProfit, qualifyingDays, context(requestedAmount, permittedRequestMax));
    }
    return payoutResult(
      true,
      "eligible",
      totalProfit,
      bestDayProfit,
      qualifyingDays,
      context(
        requestedAmount,
        permittedRequestMax,
        requestedAmount === undefined ? null : nextPayoutAccountState(accountState, requestedAmount),
      ),
    );
  }

  if (firmKey === "mffu_50k") {
    if (accountState.accountStage !== "funded") {
      return payoutResult(false, "unsupported_payout_stage", totalProfit, bestDayProfit, 0, context());
    }
    const payout = getFirmStageRules(firmKey).payout;
    const minimumRequest = requireNumber(payout["minimum_request"], "mffu_50k.payout.minimum_request");
    const maximumRequest = requireNumber(payout["maximum_request"], "mffu_50k.payout.maximum_request");
    const payoutBuffer = requireNumber(payout["payout_buffer"], "mffu_50k.payout.payout_buffer");
    const permittedRequestMax = Math.max(0, Math.min(maximumRequest, accountState.accountBalance - payoutBuffer));
    const requestedAmount = options.requestedAmount;
    if (accountState.cycleElapsedHours === null) {
      return payoutResult(false, "payout_cycle_time_evidence_required", totalProfit, bestDayProfit, 0, context(requestedAmount, permittedRequestMax));
    }
    if (accountState.cycleElapsedHours < requireNumber(
      payout["minimum_hours_since_cycle_start"],
      "mffu_50k.payout.minimum_hours_since_cycle_start",
    )) {
      return payoutResult(false, "payout_cycle_wait_not_met", totalProfit, bestDayProfit, 0, context(requestedAmount, permittedRequestMax));
    }
    if (accountState.approvedPayoutCount >= requireNumber(payout["sim_payouts_to_live"], "mffu_50k.payout.sim_payouts_to_live")) {
      return payoutResult(false, "sim_payout_limit_reached", totalProfit, bestDayProfit, 0, context(requestedAmount, permittedRequestMax));
    }
    if (!options.tradedDays) {
      return payoutResult(false, "traded_days_required", totalProfit, bestDayProfit, 0, context(requestedAmount, permittedRequestMax));
    }
    const qualifyingDays = dailyPnls.filter(
      (pnl, index) => pnl > requireNumber(payout["qualifying_day_minimum_profit"], "mffu_50k.payout.qualifying_day_minimum_profit") && options.tradedDays![index],
    ).length;
    const cycleProfitFromState = accountState.approvedPayoutCount === 0
      ? accountState.accountBalance
      : accountState.accountBalance - (accountState.balanceAfterLastPayout as number);
    if (Math.abs(totalProfit - cycleProfitFromState) > 0.01) {
      return payoutResult(false, "payout_cycle_profit_state_mismatch", totalProfit, bestDayProfit, qualifyingDays, context(requestedAmount, permittedRequestMax));
    }
    if (accountState.accountBalance < payoutBuffer) {
      return payoutResult(false, "payout_buffer_not_met", totalProfit, bestDayProfit, qualifyingDays, context(requestedAmount, permittedRequestMax));
    }
    if (accountState.approvedPayoutCount === 0) {
      const firstRequiredBalance = payoutBuffer + requireNumber(
        payout["first_payout_profit_above_buffer"],
        "mffu_50k.payout.first_payout_profit_above_buffer",
      );
      if (accountState.accountBalance < firstRequiredBalance) {
        return payoutResult(false, "first_payout_profit_requirement_not_met", totalProfit, bestDayProfit, qualifyingDays, context(requestedAmount, permittedRequestMax));
      }
    } else if (
      accountState.accountBalance - (accountState.balanceAfterLastPayout as number)
      < requireNumber(
        payout["subsequent_payout_minimum_profit_since_last_payout"],
        "mffu_50k.payout.subsequent_payout_minimum_profit_since_last_payout",
      )
    ) {
      return payoutResult(false, "subsequent_payout_profit_requirement_not_met", totalProfit, bestDayProfit, qualifyingDays, context(requestedAmount, permittedRequestMax));
    }
    if (requestedAmount !== undefined && requestedAmount < minimumRequest) {
      return payoutResult(false, "minimum_payout_not_met", totalProfit, bestDayProfit, qualifyingDays, context(requestedAmount, permittedRequestMax));
    }
    if (requestedAmount !== undefined && requestedAmount > maximumRequest) {
      return payoutResult(false, "payout_cap_exceeded", totalProfit, bestDayProfit, qualifyingDays, context(requestedAmount, permittedRequestMax));
    }
    if (requestedAmount !== undefined && requestedAmount > permittedRequestMax) {
      return payoutResult(false, "payout_buffer_must_remain_after_request", totalProfit, bestDayProfit, qualifyingDays, context(requestedAmount, permittedRequestMax));
    }
    if (qualifyingDays < requireNumber(payout["minimum_qualifying_days"], "mffu_50k.payout.minimum_qualifying_days")) {
      return payoutResult(false, "minimum_qualifying_days_not_met", totalProfit, bestDayProfit, qualifyingDays, context(requestedAmount, permittedRequestMax));
    }
    if (consistencyRatio !== null && consistencyRatio > requireNumber(payout["maximum_consistency_ratio"], "mffu_50k.payout.maximum_consistency_ratio")) {
      return payoutResult(false, "consistency_target_not_met", totalProfit, bestDayProfit, qualifyingDays, context(requestedAmount, permittedRequestMax));
    }
    if (permittedRequestMax < minimumRequest) {
      return payoutResult(false, "payout_buffer_must_remain_after_request", totalProfit, bestDayProfit, qualifyingDays, context(requestedAmount, permittedRequestMax));
    }
    return payoutResult(
      true,
      "eligible",
      totalProfit,
      bestDayProfit,
      qualifyingDays,
      context(
        requestedAmount,
        permittedRequestMax,
        requestedAmount === undefined ? null : nextPayoutAccountState(accountState, requestedAmount),
        accountState.approvedPayoutCount + 1 >= requireNumber(payout["sim_payouts_to_live"], "mffu_50k.payout.sim_payouts_to_live"),
      ),
    );
  }

  throw new Error(`Unknown firm key '${firmKey}'.`);
}
