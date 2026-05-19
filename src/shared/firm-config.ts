// ─── SINGLE SOURCE OF TRUTH for all prop firm data ──────────────────────────
// Every TS file that needs firm rules imports from here. No duplicates.
// Only Topstep (PRIMARY) + MFFU (secondary) per CLAUDE.md §6.
// Legacy firms (TPT, Apex, FFN, Alpha, Tradeify, Earn2Trade) removed 2026-05-19.
// ALL firms are 50K accounts. We trade MICROS only (MES/MNQ/MCL).

export interface FirmAccountConfig {
  accountSize: number;
  monthlyFee: number;
  activationFee: 0;              // ALWAYS $0 — all firms
  ongoingMonthlyFee: number;
  profitTarget: number;
  maxDrawdown: number;            // Also serves as buffer amount
  /** Max MICRO contracts at $50K (50 = 5 minis × 10:1 ratio). */
  maxContracts: number;
  trailing: "eod" | "realtime";
  payoutSplit: number;            // Initial split
  payoutSplitTiers?: { threshold: number; split: number }[];
  payoutCountTiers?: { payoutNumber: number; split: number }[];  // Alpha: count-based tiers
  minPayoutDays: number;
  consistencyRule: number | null;
  dailyLossLimit: number | null;
  overnightOk: boolean;
  weekendOk: boolean;             // All firms = false
  commissionPerSide: number;      // Per-side commission in dollars
  minTradingDays: number;         // Min trading days required to pass eval
  // ── MFFU 2026 compliance fields ──────────────────────────────────────────
  payoutCycleDays?: number;       // MFFU: 14 (bi-weekly)
  hftMaxTradesPerDay?: number;    // MFFU: 500 (trades/day ceiling before HFT classification)
  // ── Topstep 2026 compliance fields ───────────────────────────────────────
  platformLockdownDate?: string;  // Topstep: "2026-01-12" (TopstepX-only since this date)
  requiredPlatform?: string;      // Topstep: "topstepx"
  allowsVps?: boolean;            // Topstep: false (personal device only)
  allowsVpn?: boolean;            // Topstep: false
  allowsRemoteDesktop?: boolean;  // Topstep: false
  multiAccountWithinUserAllowed?: boolean;  // Topstep: true
  copyTradesWithinUserAllowed?: boolean;    // Topstep: true
}

export interface FirmConfig {
  name: string;
  displayName: string;
  evaluationType: "one_step" | "two_step";
  accountTypes: Record<string, FirmAccountConfig>;
}

// ─── Firm Data (50K accounts only) ──────────────────────────────────────────

export const FIRMS: Record<string, FirmConfig> = {
  mffu: {
    name: "mffu",
    displayName: "MyFundedFutures (MFFU)",
    evaluationType: "one_step",
    accountTypes: {
      "50k": {
        accountSize: 50_000, monthlyFee: 77, activationFee: 0, ongoingMonthlyFee: 0,
        profitTarget: 3000, maxDrawdown: 2000, maxContracts: 50, trailing: "eod",
        payoutSplit: 0.80, minPayoutDays: 5, consistencyRule: 0.50, // Python: "mffu_50pct"
        dailyLossLimit: null, overnightOk: false, weekendOk: false, commissionPerSide: 0.62,
        minTradingDays: 5,
        // 2026-compliance fields (canonical: docs/prop-firm-rules-2026-mffu.md)
        payoutCycleDays: 14,
        hftMaxTradesPerDay: 500,
      },
    },
  },

  topstep: {
    name: "topstep",
    displayName: "Topstep",
    evaluationType: "one_step",
    accountTypes: {
      "50k": {
        accountSize: 50_000, monthlyFee: 49, activationFee: 0, ongoingMonthlyFee: 0,
        profitTarget: 3000, maxDrawdown: 2000, maxContracts: 50, trailing: "eod",
        payoutSplit: 0.90, minPayoutDays: 5, consistencyRule: null,
        dailyLossLimit: 1000, overnightOk: false, weekendOk: false, commissionPerSide: 0.37,
        minTradingDays: 5,
        // 2026-compliance fields (canonical: docs/prop-firm-rules-2026-topstep.md)
        platformLockdownDate: "2026-01-12",
        requiredPlatform: "topstepx",
        allowsVps: false,
        allowsVpn: false,
        allowsRemoteDesktop: false,
        multiAccountWithinUserAllowed: true,
        copyTradesWithinUserAllowed: true,
      },
    },
  },

  // 6 legacy firms (TPT, Apex, FFN, Alpha, Tradeify, Earn2Trade) removed
  // 2026-05-19 per CLAUDE.md §6 — Topstep + MFFU only.
};

// ─── Contract Specs ─────────────────────────────────────────────────────────

export const CONTRACT_SPECS: Record<string, { tickSize: number; tickValue: number; pointValue: number }> = {
  MES: { tickSize: 0.25, tickValue: 1.25,  pointValue: 5.00 },
  MNQ: { tickSize: 0.25, tickValue: 0.50,  pointValue: 2.00 },
  MCL: { tickSize: 0.01, tickValue: 1.00,  pointValue: 100.00 },
};

// ─── Contract Cap Bounds (mirrors Python firm_config.py) ────────────────────
// Micros at $50K Combine/Funded:
//   Topstep:       50 micros (5 minis × 10:1 ratio) per scaling plan max tier
//   MFFU Core:     50 micros (5 minis × 10:1)
//   MFFU Pro:      60 micros (6 minis × 10:1)

export const CONTRACT_CAP_MIN = 0;
export const CONTRACT_CAP_MAX = 60;

// ─── Defaults ───────────────────────────────────────────────────────────────

export const DEFAULT_ACCOUNT_SIZE = 50_000;
export const DEFAULT_ACCOUNT_TYPE = "50k";

// ─── Helper Functions (simplified — all firms are 50K only) ─────────────────

/** Get a firm's 50K account config. accountType param kept for backward compat but defaults to "50k". */
export function getFirmAccount(firmName: string, accountType: string = "50k"): FirmAccountConfig | null {
  const firm = FIRMS[firmName.toLowerCase()];
  if (!firm) return null;
  return firm.accountTypes[accountType.toLowerCase()] ?? firm.accountTypes["50k"] ?? null;
}

/** Get risk-relevant limits for a firm (always 50K) */
export function getFirmLimit(
  firmName: string,
  _accountType: string = "50k",
): { maxDrawdown: number; maxContracts: number; dailyLossLimit: number | null; trailing: "eod" | "realtime" } | null {
  const acct = getFirmAccount(firmName, "50k");
  if (!acct) return null;
  return {
    maxDrawdown: acct.maxDrawdown,
    maxContracts: acct.maxContracts,
    dailyLossLimit: acct.dailyLossLimit,
    trailing: acct.trailing,
  };
}

/** Return all FirmConfig values */
export function getAllFirms(): FirmConfig[] {
  return Object.values(FIRMS);
}

/** Find which firm has the tightest (smallest) drawdown */
export function getTightestDrawdown(): { firm: string; maxDrawdown: number } | null {
  let tightest: { firm: string; maxDrawdown: number } | null = null;
  for (const firm of Object.values(FIRMS)) {
    const acct = firm.accountTypes["50k"];
    if (!acct) continue;
    if (!tightest || acct.maxDrawdown < tightest.maxDrawdown) {
      tightest = { firm: firm.name, maxDrawdown: acct.maxDrawdown };
    }
  }
  return tightest;
}

// ─── Commission Helpers ──────────────────────────────────────────────────────

/** Default commission per side when firmId is null/unknown. $0.62 = MFFU baseline (Topstep is lower at $0.37). */
export const DEFAULT_COMMISSION_PER_SIDE = 0.62;

/**
 * Returns the per-side commission in dollars for a given firmId.
 * Reads directly from FIRMS (the single source of truth).
 * Falls back to DEFAULT_COMMISSION_PER_SIDE when firmId is null/unknown —
 * conservative choice that avoids overstating net P&L.
 */
export function getCommissionPerSide(firmId: string | null | undefined): number {
  if (!firmId) return DEFAULT_COMMISSION_PER_SIDE;
  const firm = FIRMS[firmId.toLowerCase()];
  if (!firm) return DEFAULT_COMMISSION_PER_SIDE;
  const acct = firm.accountTypes["50k"];
  if (!acct) return DEFAULT_COMMISSION_PER_SIDE;
  return acct.commissionPerSide;
}

/** Buffer amount = maxDrawdown. After passing eval, trader must build this buffer before payouts. */
export function getBufferAmount(firmName: string, _accountType: string = "50k"): number | null {
  const acct = getFirmAccount(firmName, "50k");
  if (!acct) return null;
  return acct.maxDrawdown;
}

/** Total hurdle = profitTarget (to pass eval) + maxDrawdown (buffer phase). Total P&L before first payout. */
export function getTotalHurdle(firmName: string, _accountType: string = "50k"): number | null {
  const acct = getFirmAccount(firmName, "50k");
  if (!acct) return null;
  return acct.profitTarget + acct.maxDrawdown;
}

// ─── MFFU 2026 named constants (no magic numbers in compliance code) ─────────
// Canonical source: docs/prop-firm-rules-2026-mffu.md §§1,7,8,9
// These must stay in sync with the `mffu["50k"]` entry in FIRMS above.
// If a value changes in FIRMS it must change here too — test mffu-2026-compliance
// asserts equality between constants and firm-config values.

/** Max trades per day before MFFU classifies the account as HFT (Rule 1). */
export const MFFU_HFT_MAX_TRADES_PER_DAY = 500;

/** Max fraction of account balance that a single trade's intended loss may represent (Rule 8). */
export const MFFU_TWO_PERCENT_RULE_PCT = 0.02;

/** Minimum slippage tick floor for MES on MFFU paths — enforced in slippage.py (Rule 7). */
export const MFFU_BASELINE_SLIPPAGE_TICKS_MES = 2;

/** Payout cycle in calendar days (bi-weekly, Rule 9). */
export const MFFU_PAYOUT_CYCLE_DAYS = 14;

/** Initial trader payout split (Rule 9). */
export const MFFU_PAYOUT_SPLIT = 0.80;

// ─── Topstep 2026 named constants (no magic numbers in compliance code) ───────
// Canonical source: docs/prop-firm-rules-2026-topstep.md §Platform §API

/** Date Topstep locked trading exclusively to TopstepX platform. */
export const TOPSTEP_PLATFORM_LOCKDOWN_DATE = "2026-01-12";

/** Required platform identifier after lockdown. */
export const TOPSTEP_REQUIRED_PLATFORM = "topstepx";

/** Topstep does NOT allow cloud failover (VPS/VPN/remote desktop banned). */
export const TOPSTEP_ALLOWS_CLOUD_FAILOVER = false;

/** TopstepX API monthly subscription fee in USD (with promo code). */
export const TOPSTEPX_API_MONTHLY_FEE_USD = 14.50;

/** Promo code for TopstepX API subscription discount. */
export const TOPSTEPX_PROMO_CODE = "topstep";
