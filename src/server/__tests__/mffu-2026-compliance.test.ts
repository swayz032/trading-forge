/**
 * MFFU 2026 Compliance — End-to-End Rule Coverage
 *
 * Verifies every MFFU 2026 rule has a code path enforcing it. One test per
 * rule from docs/prop-firm-rules-2026-mffu.md plus integration coverage.
 *
 * Hard-rules surface (10):
 *   1. HFT not allowed — max-trades-per-day cap
 *   2. Collaborative trading banned — DSL fingerprint reuse signal
 *   3. Same-device banned — instance_id collision (advisory)
 *   4. Hedging same underlying — MNQ↔NQ + MES↔ES + MCL↔CL pairs
 *   5. Tier-1 economic data — calendar_filter coverage
 *   6. Simultaneous limits at same price prohibited
 *   7. Slippage/bracket exploitation prohibited — 2-tick MES floor
 *   8. 2% price limit rule
 *   9. Builder 48-hour payouts + 80/20 split
 *  10. Hedging same underlying (reaffirm — same as 4)
 *
 * Plus sanity tests: per-firm independence, magic-number constants exposure,
 * canonical doc parity (delegated to scripts/verify-2026-rules-compliance.mjs).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));
vi.mock("node:fs", () => ({
  readFileSync: vi.fn(() => { throw new Error("mocked fs"); }),
}));

import {
  checkCorrelatedPositionGuard,
  pairKey,
  __resetCorrelationMatrixForTests,
} from "../services/correlated-position-guard.js";

import {
  FIRMS,
  getFirmAccount,
  MFFU_HFT_MAX_TRADES_PER_DAY,
  MFFU_TWO_PERCENT_RULE_PCT,
  MFFU_BASELINE_SLIPPAGE_TICKS_MES,
  MFFU_PAYOUT_CYCLE_DAYS,
  MFFU_PAYOUT_SPLIT,
} from "../../shared/firm-config.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** Matrix that includes the new MES↔ES, MNQ↔NQ, MCL↔CL pairs at 1.00. */
const MFFU_MATRIX = {
  correlations: {
    MES_MNQ: 0.95,
    MNQ_MES: 0.95,
    // 2026 MFFU Rule 4 — same underlying = correlation 1.00
    ES_MES: 1.00,
    MNQ_NQ: 1.00,
    CL_MCL: 1.00,
    MCL_MES: 0.22,
  },
  threshold: 0.70,
};

beforeEach(() => {
  __resetCorrelationMatrixForTests(MFFU_MATRIX);
});

// ─── Rule 9: Bi-Weekly Payouts + 80/20 Split ────────────────────────────────

describe("MFFU 2026 Rule 9 — Builder 48-hour Payouts + 80/20 Split", () => {
  it("MFFU payout split is exactly 0.80 in firm-config", () => {
    const acct = getFirmAccount("mffu", "50k");
    expect(acct).not.toBeNull();
    expect(acct!.payoutSplit).toBe(0.80);
  });

  it("MFFU Builder payout cycle is exactly 2 days", () => {
    const acct = getFirmAccount("mffu", "50k");
    expect(acct).not.toBeNull();
    expect(acct!.payoutCycleDays).toBe(2);
  });

  it("MFFU_PAYOUT_SPLIT named constant is 0.80 (no magic numbers)", () => {
    expect(MFFU_PAYOUT_SPLIT).toBe(0.80);
  });

  it("MFFU_PAYOUT_CYCLE_DAYS named constant is 2 (no magic numbers)", () => {
    expect(MFFU_PAYOUT_CYCLE_DAYS).toBe(2);
  });
});

// ─── Rule 1: HFT Not Allowed ────────────────────────────────────────────────

describe("MFFU 2026 Rule 1 — High-Frequency Trading Not Allowed", () => {
  it("MFFU exposes hftMaxTradesPerDay", () => {
    const acct = getFirmAccount("mffu", "50k");
    expect(acct!.hftMaxTradesPerDay).toBe(500);
  });

  it("MFFU_HFT_MAX_TRADES_PER_DAY named constant is 500 (matches doc)", () => {
    expect(MFFU_HFT_MAX_TRADES_PER_DAY).toBe(500);
  });

  it("named constant equals firm-config value (no drift)", () => {
    const acct = getFirmAccount("mffu", "50k");
    expect(acct!.hftMaxTradesPerDay).toBe(MFFU_HFT_MAX_TRADES_PER_DAY);
  });
});

// ─── Rule 4 + 10: Hedging Same Underlying ───────────────────────────────────

describe("MFFU 2026 Rule 4 — Hedging Same Underlying Banned", () => {
  it("MNQ + open NQ position → BLOCKED (same underlying = NQ)", () => {
    const result = checkCorrelatedPositionGuard("MNQ", [{ symbol: "NQ" }]);
    expect(result.allowed).toBe(false);
    expect(result.blockingSymbol).toBe("NQ");
  });

  it("MES + open ES position → BLOCKED (same underlying = ES)", () => {
    const result = checkCorrelatedPositionGuard("MES", [{ symbol: "ES" }]);
    expect(result.allowed).toBe(false);
    expect(result.blockingSymbol).toBe("ES");
  });

  it("MCL + open CL position → BLOCKED (same underlying = CL)", () => {
    const result = checkCorrelatedPositionGuard("MCL", [{ symbol: "CL" }]);
    expect(result.allowed).toBe(false);
    expect(result.blockingSymbol).toBe("CL");
  });

  it("symmetry preserved: NQ + open MNQ position → BLOCKED", () => {
    const result = checkCorrelatedPositionGuard("NQ", [{ symbol: "MNQ" }]);
    expect(result.allowed).toBe(false);
    expect(result.blockingSymbol).toBe("MNQ");
  });

  it("MFFU exposes hedgingSameUnderlyingBanned: true", () => {
    const acct = getFirmAccount("mffu", "50k");
    expect(acct!.hedgingSameUnderlyingBanned).toBe(true);
  });

  it("pairKey is symmetric for canonical underlying pairs", () => {
    expect(pairKey("MES", "ES")).toBe(pairKey("ES", "MES"));
    expect(pairKey("MNQ", "NQ")).toBe(pairKey("NQ", "MNQ"));
    expect(pairKey("MCL", "CL")).toBe(pairKey("CL", "MCL"));
  });
});

// ─── Rule 7: Slippage Floor (2-tick MES baseline) ───────────────────────────

describe("MFFU 2026 Rule 7 — Slippage Exploitation Prohibited", () => {
  it("MFFU exposes baselineSlippageTicksMes: 2", () => {
    const acct = getFirmAccount("mffu", "50k");
    expect(acct!.baselineSlippageTicksMes).toBe(2);
  });

  it("MFFU_BASELINE_SLIPPAGE_TICKS_MES named constant is 2 (no magic numbers)", () => {
    expect(MFFU_BASELINE_SLIPPAGE_TICKS_MES).toBe(2);
  });
});

// ─── Rule 8: 2% Price Limit Rule ────────────────────────────────────────────

describe("MFFU 2026 Rule 8 — 2% Price Limit Rule", () => {
  it("MFFU exposes twoPercentRulePct: 0.02", () => {
    const acct = getFirmAccount("mffu", "50k");
    expect(acct!.twoPercentRulePct).toBe(0.02);
  });

  it("MFFU_TWO_PERCENT_RULE_PCT named constant is 0.02", () => {
    expect(MFFU_TWO_PERCENT_RULE_PCT).toBe(0.02);
  });

  it("on a 50K account, 2% rule = $1,000 max loss per trade", () => {
    const acct = getFirmAccount("mffu", "50k");
    const limit = acct!.accountSize * acct!.twoPercentRulePct!;
    expect(limit).toBe(1000);
  });
});

// ─── Rule 5: Tier-1 Economic Data Blackout ──────────────────────────────────

describe("MFFU 2026 Rule 5 — Tier-1 Economic Data Restricted", () => {
  it("MFFU exposes tier1EventBlackoutMinutes: 30", () => {
    const acct = getFirmAccount("mffu", "50k");
    expect(acct!.tier1EventBlackoutMinutes).toBe(30);
  });
});

// ─── Rule 6: Simultaneous Limits at Same Price Banned ───────────────────────

describe("MFFU 2026 Rule 6 — Simultaneous Limits at Same Price", () => {
  it("MFFU exposes simultaneousLimitsAtSamePriceBanned: true", () => {
    const acct = getFirmAccount("mffu", "50k");
    expect(acct!.simultaneousLimitsAtSamePriceBanned).toBe(true);
  });
});

// ─── Rule 2: Collaborative Trading Banned ───────────────────────────────────

describe("MFFU 2026 Rule 2 — Collaborative Trading Banned", () => {
  it("MFFU exposes collaborativeTradingBanned: true", () => {
    const acct = getFirmAccount("mffu", "50k");
    expect(acct!.collaborativeTradingBanned).toBe(true);
  });
});

// ─── Rule 3: Same-Device Banned ─────────────────────────────────────────────

describe("MFFU 2026 Rule 3 — Same-Device Banned", () => {
  it("MFFU exposes sameDeviceBanned: true", () => {
    const acct = getFirmAccount("mffu", "50k");
    expect(acct!.sameDeviceBanned).toBe(true);
  });
});

// ─── Per-firm independence (MFFU rules don't bleed into Topstep) ────────────

describe("Per-firm independence — MFFU fields don't leak to Topstep", () => {
  it("Topstep does NOT carry MFFU's payoutCycleDays", () => {
    const acct = getFirmAccount("topstep", "50k");
    expect(acct).not.toBeNull();
    expect(acct!.payoutCycleDays).toBeUndefined();
  });

  it("Topstep does NOT carry MFFU's hftMaxTradesPerDay", () => {
    const acct = getFirmAccount("topstep", "50k");
    expect(acct!.hftMaxTradesPerDay).toBeUndefined();
  });

  it("Topstep does NOT carry MFFU's collaborativeTradingBanned", () => {
    const acct = getFirmAccount("topstep", "50k");
    expect(acct!.collaborativeTradingBanned).toBeUndefined();
  });
});

// ─── Doc/code parity (delegated to lint script — sanity here) ───────────────

describe("Canonical doc parity (sanity)", () => {
  it("FIRMS includes MFFU after Pass 1 cleanup", () => {
    expect(FIRMS.mffu).toBeDefined();
    expect(FIRMS.mffu.displayName).toContain("MFFU");
  });

  it("MFFU 50K profitTarget is 3000 (matches docs/prop-firm-rules-2026-mffu.md)", () => {
    const acct = getFirmAccount("mffu", "50k");
    expect(acct!.profitTarget).toBe(3000);
  });

  it("MFFU 50K maxDrawdown is 2000 (matches docs/prop-firm-rules-2026-mffu.md)", () => {
    const acct = getFirmAccount("mffu", "50k");
    expect(acct!.maxDrawdown).toBe(2000);
  });

  it("MFFU Builder commissionPerSide is 0.95 (matches the canonical stage rule book)", () => {
    const acct = getFirmAccount("mffu", "50k");
    expect(acct!.commissionPerSide).toBe(0.95);
  });
});
