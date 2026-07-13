import { describe, expect, it } from "vitest";
import {
  evaluatePayoutEligibility,
  evaluateTopstepCombine,
  evaluateTopstepCombineUntilPass,
  topstepEffectiveProfitTarget,
} from "./firm-stage-rules.js";

describe("canonical firm stage rules", () => {
  it("requires two Topstep Combine days even when the base target is reached", () => {
    const result = evaluateTopstepCombine([3000]);
    expect(result.passed).toBe(false);
    expect(result.reason).toBe("minimum_trading_days_not_met");
    expect(result.effective_profit_target).toBe(6000);
  });

  it("passes two balanced Topstep Combine days", () => {
    const result = evaluateTopstepCombine([1500, 1500]);
    expect(result.passed).toBe(true);
    expect(result.effective_profit_target).toBe(3000);
  });

  it("raises, rather than breaches, the Topstep effective target after a spike", () => {
    expect(topstepEffectiveProfitTarget(2000)).toBe(4000);
    const result = evaluateTopstepCombine([2000, 1000, 1000]);
    expect(result.passed).toBe(true);
    expect(result.recoverable).toBe(true);
  });

  it("freezes the Topstep evaluation window at its first pass", () => {
    const result = evaluateTopstepCombineUntilPass([1500, 1500, 5000, -1000]);
    expect(result.passed).toBe(true);
    expect(result.passed_day).toBe(2);
    expect(result.best_day_profit).toBe(1500);
    expect(result.effective_profit_target).toBe(3000);
  });

  it("keeps Topstep XFA Consistency payout eligibility separate and recoverable", () => {
    const result = evaluatePayoutEligibility(
      "topstep_50k",
      [900, 500, 600],
      {
        payoutPath: "consistency",
        tradedDays: [true, true, true],
        accountState: { accountBalance: 3000 },
      },
    );
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("consistency_target_not_met");
    expect(result.recoverable).toBe(true);
  });

  it("requires trade-day evidence for Topstep XFA Consistency eligibility", () => {
    const result = evaluatePayoutEligibility(
      "topstep_50k",
      [100, 100, 100],
      { payoutPath: "consistency", accountState: { accountBalance: 3000 } },
    );
    expect(result.reason).toBe("traded_days_required");
  });

  it("evaluates MFFU Builder payout rules only in its sim-funded payout stage", () => {
    const result = evaluatePayoutEligibility(
      "mffu_50k",
      [1300, 1300],
      {
        requestedAmount: 500,
        tradedDays: [true, true],
        accountState: { accountBalance: 2600, cycleElapsedHours: 48 },
      },
    );
    expect(result.eligible).toBe(true);
    expect(result.recoverable).toBe(true);
  });

  it("exempts a first Topstep Standard payout from the since-last-profit test", () => {
    const result = evaluatePayoutEligibility(
      "topstep_50k",
      [150, 150, 150, 150, 150, -1000],
      { payoutPath: "standard", accountState: { accountBalance: 2500 } },
    );
    expect(result.eligible).toBe(true);
  });

  it("uses voluntary DLL account context for Topstep payout caps", () => {
    const dailyPnls = [1000, 1000, 1000, 1000, 1000];
    const base = evaluatePayoutEligibility(
      "topstep_50k",
      dailyPnls,
      {
        payoutPath: "standard",
        requestedAmount: 3000,
        accountState: { accountBalance: 8000 },
      },
    );
    const dllOptedIn = evaluatePayoutEligibility(
      "topstep_50k",
      dailyPnls,
      {
        payoutPath: "standard",
        requestedAmount: 3000,
        dllOptedIn: true,
        accountState: { accountBalance: 8000 },
      },
    );

    expect(base.reason).toBe("payout_cap_exceeded");
    expect(dllOptedIn.eligible).toBe(true);
  });

  it("keeps the MFFU Builder buffer after the requested payout", () => {
    const result = evaluatePayoutEligibility(
      "mffu_50k",
      [1300, 1300],
      {
        requestedAmount: 600,
        tradedDays: [true, true],
        accountState: { accountBalance: 2600, cycleElapsedHours: 48 },
      },
    );
    expect(result.reason).toBe("payout_buffer_must_remain_after_request");
  });

  it("fails closed when the payout account state is unavailable", () => {
    const result = evaluatePayoutEligibility(
      "topstep_50k",
      [150, 150, 150, 150, 150],
      { payoutPath: "standard" },
    );
    expect(result.reason).toBe("account_state_required");
  });

  it("caps Topstep at half the current account balance", () => {
    const result = evaluatePayoutEligibility(
      "topstep_50k",
      [500, 500, 500, 500, 500],
      {
        payoutPath: "standard",
        requestedAmount: 2000,
        accountState: { accountBalance: 2500 },
      },
    );
    expect(result.reason).toBe("payout_balance_cap_exceeded");
    expect(result.permitted_request_max).toBe(1250);
  });

  it("supports MFFU subsequent cycles from the approved-payout state", () => {
    const result = evaluatePayoutEligibility(
      "mffu_50k",
      [250, 250],
      {
        requestedAmount: 500,
        tradedDays: [true, true],
        accountState: {
          accountBalance: 2600,
          balanceAfterLastPayout: 2100,
          approvedPayoutCount: 1,
          cycleElapsedHours: 48,
        },
      },
    );
    expect(result.eligible).toBe(true);
  });

  it("fails closed when an MFFU payout-cycle P&L slice disagrees with account state", () => {
    const result = evaluatePayoutEligibility(
      "mffu_50k",
      [250, 250],
      {
        requestedAmount: 500,
        tradedDays: [true, true],
        accountState: { accountBalance: 2600, cycleElapsedHours: 48 },
      },
    );
    expect(result.reason).toBe("payout_cycle_profit_state_mismatch");
  });

  it("requires MFFU payout-cycle timing evidence", () => {
    const result = evaluatePayoutEligibility("mffu_50k", [1300, 1300], {
      tradedDays: [true, true], accountState: { accountBalance: 2600 },
    });
    expect(result.reason).toBe("payout_cycle_time_evidence_required");
    expect(result.permitted_request_max).toBe(500);
  });

  it("enforces the MFFU 48-hour payout-cycle wait", () => {
    const result = evaluatePayoutEligibility("mffu_50k", [1300, 1300], {
      tradedDays: [true, true], accountState: { accountBalance: 2600, cycleElapsedHours: 47.99 },
    });
    expect(result.reason).toBe("payout_cycle_wait_not_met");
    expect(result.permitted_request_max).toBe(500);
  });
});
