import { describe, it } from "vitest";

// NOTE: This test file targets an aspirational firm-config schema that the
// current `firm-config.ts` does not implement. None of the following symbols
// are exported from `./firm-config`:
//   - evaluateFirstAccountProof
//   - getFirmPolicySummary
//   - getFirmStageAccount  (only `getFirmAccount` exists)
//   - getProductionEligibleFirms
// And `FirmAccountConfig` has no `personalSizingProfile` or `firmRuleCaps`
// fields, nor stage-keyed accounts ("live" vs "evaluation"). The current
// schema is a flat `{accountSize, profitTarget, maxDrawdown, maxContracts: 15, ...}`.
//
// All cases are skipped (not deleted) so the intent is preserved for the
// future schema upgrade that introduces stage accounts, policy summaries,
// first-account-proof gating, and personal-vs-firm sizing profiles.
describe.skip("firm-config", () => {
  it("keeps the 50k operating profile at 10 min / 15 default / 20 max micros", () => {
    // Pending: FirmAccountConfig.personalSizingProfile not yet implemented.
  });

  it("separates Topstep official rule caps from the operating size", () => {
    // Pending: getFirmStageAccount and FirmAccountConfig.firmRuleCaps not yet implemented.
  });

  it("marks Topstep as the only production-eligible firm", () => {
    // Pending: getProductionEligibleFirms not yet implemented.
  });

  it("surfaces verified Topstep policy metadata", () => {
    // Pending: getFirmPolicySummary not yet implemented.
  });

  it("requires paper, evaluation, funded proof, and payout eligibility before the first account is proven", () => {
    // Pending: evaluateFirstAccountProof not yet implemented.
  });
});
