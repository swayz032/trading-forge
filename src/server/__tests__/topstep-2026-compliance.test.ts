/**
 * Topstep 2026 Compliance — End-to-End Rule Coverage
 *
 * Verifies every Topstep 2026 rule has a code path enforcing it. One test
 * per rule from docs/prop-firm-rules-2026-topstep.md.
 *
 * Hard-rules surface (7):
 *   1. TopstepX API single allowed platform (Pass 2 Track 4 wires the broker;
 *      this file verifies the firm-config rule contract)
 *   2. January 12, 2026 platform lockdown
 *   3. Personal device only — no VPS/VPN/remote desktop
 *   4. Multi-account within one user allowed
 *   5. Copy trades across user's own Topstep accounts allowed
 *   6. Trailing drawdown — EOD, locks at starting balance
 *   7. Daily loss limit — opt-in but Trading Forge always opts in
 */

import { describe, it, expect } from "vitest";

import {
  FIRMS,
  getFirmAccount,
  TOPSTEP_PLATFORM_LOCKDOWN_DATE,
  TOPSTEP_REQUIRED_PLATFORM,
  TOPSTEP_ALLOWS_CLOUD_FAILOVER,
  TOPSTEPX_API_MONTHLY_FEE_USD,
  TOPSTEPX_PROMO_CODE,
  TOPSTEP_XFA_PAYOUT_CAPS,
  TOPSTEP_LFA_PAYOUT_CAP,
  MFFU_PAYOUT_CAP,
  getPayoutCap,
} from "../../shared/firm-config.js";

// ─── Rule 1: TopstepX API Single Allowed Platform ───────────────────────────

describe("Topstep 2026 Rule 1 — TopstepX API Single Allowed Platform", () => {
  it("requiredPlatform is 'topstepx'", () => {
    const acct = getFirmAccount("topstep", "50k");
    expect(acct).not.toBeNull();
    expect(acct!.requiredPlatform).toBe("topstepx");
  });

  it("TOPSTEP_REQUIRED_PLATFORM named constant is 'topstepx' (no magic strings)", () => {
    expect(TOPSTEP_REQUIRED_PLATFORM).toBe("topstepx");
  });

  it("TopstepX API monthly fee constant is documented at $14.50", () => {
    expect(TOPSTEPX_API_MONTHLY_FEE_USD).toBe(14.50);
  });

  it("TopstepX promo code constant is 'topstep'", () => {
    expect(TOPSTEPX_PROMO_CODE).toBe("topstep");
  });
});

// ─── Rule 2: January 12, 2026 Platform Lockdown ─────────────────────────────

describe("Topstep 2026 Rule 2 — Platform Lockdown 2026-01-12", () => {
  it("Topstep exposes platformLockdownDate: '2026-01-12'", () => {
    const acct = getFirmAccount("topstep", "50k");
    expect(acct!.platformLockdownDate).toBe("2026-01-12");
  });

  it("TOPSTEP_PLATFORM_LOCKDOWN_DATE constant matches 2026-01-12", () => {
    expect(TOPSTEP_PLATFORM_LOCKDOWN_DATE).toBe("2026-01-12");
  });
});

// ─── Rule 3: Personal Device Only ───────────────────────────────────────────

describe("Topstep 2026 Rule 3 — Personal Device Only (no VPS/VPN/remote)", () => {
  it("Topstep exposes allowsVps: false", () => {
    const acct = getFirmAccount("topstep", "50k");
    expect(acct!.allowsVps).toBe(false);
  });

  it("Topstep exposes allowsVpn: false", () => {
    const acct = getFirmAccount("topstep", "50k");
    expect(acct!.allowsVpn).toBe(false);
  });

  it("Topstep exposes allowsRemoteDesktop: false", () => {
    const acct = getFirmAccount("topstep", "50k");
    expect(acct!.allowsRemoteDesktop).toBe(false);
  });

  it("Topstep exposes allowsCloudFailover: false (no Railway B6 for Topstep)", () => {
    const acct = getFirmAccount("topstep", "50k");
    expect(acct!.allowsCloudFailover).toBe(false);
  });

  it("TOPSTEP_ALLOWS_CLOUD_FAILOVER named constant is false", () => {
    expect(TOPSTEP_ALLOWS_CLOUD_FAILOVER).toBe(false);
  });
});

// ─── Rule 4: Multi-Account Within One User Allowed ──────────────────────────

describe("Topstep 2026 Rule 4 — Multi-Account Within One User Allowed", () => {
  it("Topstep exposes multiAccountWithinUserAllowed: true", () => {
    const acct = getFirmAccount("topstep", "50k");
    expect(acct!.multiAccountWithinUserAllowed).toBe(true);
  });
});

// ─── Rule 5: Copy Trades Across User's Topstep Accounts Allowed ─────────────

describe("Topstep 2026 Rule 5 — Copy Trades Allowed (within Topstep)", () => {
  it("Topstep exposes copyTradesWithinUserAllowed: true", () => {
    const acct = getFirmAccount("topstep", "50k");
    expect(acct!.copyTradesWithinUserAllowed).toBe(true);
  });
});

// ─── Rule 6: Trailing Drawdown ──────────────────────────────────────────────

describe("Topstep 2026 Rule 6 — Trailing Drawdown EOD, locks at starting balance", () => {
  it("Topstep trailing is EOD", () => {
    const acct = getFirmAccount("topstep", "50k");
    expect(acct!.trailing).toBe("eod");
  });

  it("Topstep maxDrawdown is 2000 ($48K floor on 50K)", () => {
    const acct = getFirmAccount("topstep", "50k");
    expect(acct!.maxDrawdown).toBe(2000);
  });
});

// ─── Rule 7: Daily Loss Limit ───────────────────────────────────────────────

describe("Topstep 2026 Rule 7 — Daily Loss Limit (always-on TF default)", () => {
  it("Topstep dailyLossLimit is 1000 (always-on Trading Forge default)", () => {
    const acct = getFirmAccount("topstep", "50k");
    expect(acct!.dailyLossLimit).toBe(1000);
  });
});

// ─── Per-Firm Independence — Topstep fields don't leak to MFFU ──────────────

describe("Per-firm independence — Topstep fields don't leak to MFFU", () => {
  it("MFFU does NOT carry Topstep's platformLockdownDate", () => {
    const acct = getFirmAccount("mffu", "50k");
    expect(acct!.platformLockdownDate).toBeUndefined();
  });

  it("MFFU does NOT carry Topstep's requiredPlatform", () => {
    const acct = getFirmAccount("mffu", "50k");
    expect(acct!.requiredPlatform).toBeUndefined();
  });

  it("MFFU does NOT carry Topstep's allowsCloudFailover", () => {
    const acct = getFirmAccount("mffu", "50k");
    expect(acct!.allowsCloudFailover).toBeUndefined();
  });
});

// ─── Rule 10 / Payout Cap Model (2026-07-19 refresh — size × election × DLL) ──

describe("Topstep 2026 Rule 10 — XFA payout caps (by size; base + voluntary-DLL)", () => {
  // Governing (operator live-page): withDll caps Standard $4K/$6K/$10K,
  // Consistency $6K/$8K/$12K. base caps (no DLL toggle) per Topstep help-center.

  it("Topstep 50K XFA Standard cap is $2,000 base / $4,000 withDll", () => {
    expect(getPayoutCap("topstep", "xfa", "standard", false)).toBe(2000);
    expect(getPayoutCap("topstep", "xfa", "standard", true)).toBe(4000);
  });

  it("Topstep 50K XFA Consistency cap is $3,000 base / $6,000 withDll", () => {
    expect(getPayoutCap("topstep", "xfa", "consistency", false)).toBe(3000);
    expect(getPayoutCap("topstep", "xfa", "consistency", true)).toBe(6000);
  });

  it("Topstep 100K XFA caps: Standard $3K/$6K, Consistency $4K/$8K", () => {
    expect(getPayoutCap("topstep", "xfa", "standard", false, "100k")).toBe(3000);
    expect(getPayoutCap("topstep", "xfa", "standard", true, "100k")).toBe(6000);
    expect(getPayoutCap("topstep", "xfa", "consistency", false, "100k")).toBe(4000);
    expect(getPayoutCap("topstep", "xfa", "consistency", true, "100k")).toBe(8000);
  });

  it("Topstep 150K XFA caps (governing): Standard withDll $10K, Consistency withDll $12K", () => {
    expect(getPayoutCap("topstep", "xfa", "standard", false, "150k")).toBe(5000);
    expect(getPayoutCap("topstep", "xfa", "standard", true, "150k")).toBe(10000);
    expect(getPayoutCap("topstep", "xfa", "consistency", false, "150k")).toBe(6000);
    expect(getPayoutCap("topstep", "xfa", "consistency", true, "150k")).toBe(12000);
  });

  it("Topstep LFA is uncapped (null) regardless of dll_opted_in", () => {
    expect(getPayoutCap("topstep", "lfa", "standard", false)).toBeNull();
    expect(getPayoutCap("topstep", "lfa", "standard", true)).toBeNull();
    expect(getPayoutCap("topstep", "lfa", "consistency", true)).toBeNull();
  });

  it("MFFU payout cap is $2,000 regardless of dll_opted_in (promo is Topstep-only)", () => {
    expect(getPayoutCap("mffu", "xfa", "standard", false)).toBe(2000);
    expect(getPayoutCap("mffu", "xfa", "standard", true)).toBe(2000);
    expect(getPayoutCap("mffu", "xfa", "consistency", true)).toBe(2000);
    expect(getPayoutCap("mffu", "lfa", "standard", true)).toBe(2000);
  });

  it("TOPSTEP_XFA_PAYOUT_CAPS constant has correct base + withDll values (by size)", () => {
    expect(TOPSTEP_XFA_PAYOUT_CAPS["50k"]!.standard.base).toBe(2000);
    expect(TOPSTEP_XFA_PAYOUT_CAPS["50k"]!.standard.withDll).toBe(4000);
    expect(TOPSTEP_XFA_PAYOUT_CAPS["50k"]!.consistency.base).toBe(3000);
    expect(TOPSTEP_XFA_PAYOUT_CAPS["50k"]!.consistency.withDll).toBe(6000);
    expect(TOPSTEP_XFA_PAYOUT_CAPS["150k"]!.standard.withDll).toBe(10000);
    expect(TOPSTEP_XFA_PAYOUT_CAPS["150k"]!.consistency.withDll).toBe(12000);
  });

  it("TOPSTEP_LFA_PAYOUT_CAP constant is null (uncapped)", () => {
    expect(TOPSTEP_LFA_PAYOUT_CAP).toBeNull();
  });

  it("MFFU_PAYOUT_CAP constant is $2,000 (flat, no doubling)", () => {
    expect(MFFU_PAYOUT_CAP).toBe(2000);
  });

  it("getPayoutCap defaults to standard path, 50k, dll_opted_in=false (conservative)", () => {
    // Called with only firmId + accountStage — must not assume doubled cap
    expect(getPayoutCap("topstep", "xfa")).toBe(2000);
  });

  it("Topstep firm-config xfaPayoutCaps field matches canonical constants", () => {
    const acct = getFirmAccount("topstep", "50k");
    expect(acct!.xfaPayoutCaps).toBeDefined();
    expect(acct!.xfaPayoutCaps!["50k"]!["standard"]!.base).toBe(TOPSTEP_XFA_PAYOUT_CAPS["50k"]!.standard.base);
    expect(acct!.xfaPayoutCaps!["50k"]!["standard"]!.withDll).toBe(TOPSTEP_XFA_PAYOUT_CAPS["50k"]!.standard.withDll);
    expect(acct!.xfaPayoutCaps!["150k"]!["consistency"]!.withDll).toBe(TOPSTEP_XFA_PAYOUT_CAPS["150k"]!.consistency.withDll);
  });

  it("MFFU firm-config does NOT carry xfaPayoutCaps (promo is Topstep-only)", () => {
    const acct = getFirmAccount("mffu", "50k");
    expect(acct!.xfaPayoutCaps).toBeUndefined();
  });

  it("getPayoutCap throws on unknown firmId", () => {
    expect(() => getPayoutCap("unknown_firm" as "topstep", "xfa")).toThrow();
  });

  it("getPayoutCap throws on unknown payoutPath for Topstep XFA", () => {
    expect(() => getPayoutCap("topstep", "xfa", "invalid_path" as "standard")).toThrow();
  });
});

// ─── Sanity: Topstep registered in FIRMS dictionary ─────────────────────────

describe("Topstep — canonical doc parity (sanity)", () => {
  it("FIRMS contains Topstep", () => {
    expect(FIRMS.topstep).toBeDefined();
    expect(FIRMS.topstep.displayName).toBe("Topstep");
  });

  it("Topstep 50K profitTarget is 3000 (matches docs/prop-firm-rules-2026-topstep.md)", () => {
    const acct = getFirmAccount("topstep", "50k");
    expect(acct!.profitTarget).toBe(3000);
  });

  it("Topstep 50K commissionPerSide is 0.37 (matches docs/prop-firm-rules-2026-topstep.md)", () => {
    const acct = getFirmAccount("topstep", "50k");
    expect(acct!.commissionPerSide).toBe(0.37);
  });

  it("Topstep 50K payoutSplit is 0.90 (matches docs/prop-firm-rules-2026-topstep.md)", () => {
    const acct = getFirmAccount("topstep", "50k");
    expect(acct!.payoutSplit).toBe(0.90);
  });

  it("Topstep 50K monthlyFee is 85 (matches docs/prop-firm-rules-2026-topstep.md)", () => {
    const acct = getFirmAccount("topstep", "50k");
    expect(acct!.monthlyFee).toBe(85);
  });
});
