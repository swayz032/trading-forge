// ─── SINGLE SOURCE OF TRUTH for all prop firm data ──────────────────────────
// Every TS file that needs firm rules imports from here. No duplicates.
// ALL firms are 50K accounts only. No other account sizes.

export interface FirmAccountConfig {
  accountSize: number;
  monthlyFee: number;
  activationFee: 0;              // ALWAYS $0 — all firms
  ongoingMonthlyFee: number;     // Apex $85/mo, FFN $126/mo, others $0
  profitTarget: number;
  maxDrawdown: number;            // Also serves as buffer amount
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
        profitTarget: 3000, maxDrawdown: 2000, maxContracts: 15, trailing: "eod",
        payoutSplit: 0.80, minPayoutDays: 5, consistencyRule: 0.50, // Python: "mffu_50pct"
        dailyLossLimit: null, overnightOk: false, weekendOk: false, commissionPerSide: 0.62,
        minTradingDays: 5,
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
        profitTarget: 3000, maxDrawdown: 2000, maxContracts: 15, trailing: "eod",
        payoutSplit: 0.90, minPayoutDays: 5, consistencyRule: null,
        dailyLossLimit: 1000, overnightOk: false, weekendOk: false, commissionPerSide: 0.37,
        minTradingDays: 5,
      },
    },
  },

  tpt: {
    name: "tpt",
    displayName: "Take Profit Trader (TPT)",
    evaluationType: "one_step",
    accountTypes: {
      "50k": {
        accountSize: 50_000, monthlyFee: 170, activationFee: 0, ongoingMonthlyFee: 0,
        profitTarget: 3000, maxDrawdown: 2000, maxContracts: 15, trailing: "eod",
        payoutSplit: 0.80,
        payoutSplitTiers: [{ threshold: 5000, split: 0.90 }],
        minPayoutDays: 5, consistencyRule: 0.50, // Python: "tpt_50pct"
        dailyLossLimit: null, overnightOk: false, weekendOk: false, commissionPerSide: 0.62,
        minTradingDays: 5,
      },
    },
  },

  apex: {
    name: "apex",
    displayName: "Apex Trader Funding",
    evaluationType: "one_step",
    accountTypes: {
      "50k": {
        accountSize: 50_000, monthlyFee: 99, activationFee: 0, ongoingMonthlyFee: 85,
        profitTarget: 3000, maxDrawdown: 2000, maxContracts: 15, trailing: "eod",
        payoutSplit: 1.00,
        payoutSplitTiers: [{ threshold: 25000, split: 0.90 }],
        minPayoutDays: 1, consistencyRule: 0.50, // Python: "apex_50pct_funded"
        dailyLossLimit: 1000, overnightOk: false, weekendOk: false, commissionPerSide: 0.62,
        minTradingDays: 1,
      },
    },
  },

  ffn: {
    name: "ffn",
    displayName: "Funded Futures Network (FFN)",
    evaluationType: "two_step",
    accountTypes: {
      "50k": {
        accountSize: 50_000, monthlyFee: 150, activationFee: 0, ongoingMonthlyFee: 126,
        profitTarget: 3000, maxDrawdown: 2000, maxContracts: 15, trailing: "eod",
        payoutSplit: 0.80,
        payoutSplitTiers: [{ threshold: 5000, split: 0.90 }],
        minPayoutDays: 3, consistencyRule: 0.40, // Python: "ffn_40pct"
        dailyLossLimit: null, overnightOk: false, weekendOk: false, commissionPerSide: 0.62,
        minTradingDays: 3,
      },
    },
  },

  alpha: {
    name: "alpha",
    displayName: "Alpha Futures",
    evaluationType: "one_step",
    accountTypes: {
      "50k": {
        accountSize: 50_000, monthlyFee: 99, activationFee: 0, ongoingMonthlyFee: 0,
        profitTarget: 3000, maxDrawdown: 2000, maxContracts: 15, trailing: "eod",
        payoutSplit: 0.70,
        payoutSplitTiers: undefined,
        payoutCountTiers: [
          { payoutNumber: 1, split: 0.70 },
          { payoutNumber: 2, split: 0.80 },
          { payoutNumber: 3, split: 0.90 },  // 3rd+ payout
        ],
        minPayoutDays: 2, consistencyRule: 0.50, // Python: "alpha_50pct"
        dailyLossLimit: null, overnightOk: false, weekendOk: false, commissionPerSide: 0.00,
        minTradingDays: 2,
      },
    },
  },

  tradeify: {
    name: "tradeify",
    displayName: "Tradeify",
    evaluationType: "one_step",
    accountTypes: {
      "50k": {
        accountSize: 50_000, monthlyFee: 159, activationFee: 0, ongoingMonthlyFee: 0,
        profitTarget: 2500, maxDrawdown: 2000, maxContracts: 15, trailing: "eod",
        payoutSplit: 0.90, minPayoutDays: 3, consistencyRule: 0.40, // Python: "tradeify_40pct"
        dailyLossLimit: null, overnightOk: false, weekendOk: false, commissionPerSide: 1.29,
        minTradingDays: 3,
      },
    },
  },

  earn2trade: {
    name: "earn2trade",
    displayName: "Earn2Trade",
    evaluationType: "one_step",
    accountTypes: {
      "50k": {
        accountSize: 50_000, monthlyFee: 170, activationFee: 0, ongoingMonthlyFee: 0,
        profitTarget: 3000, maxDrawdown: 2000, maxContracts: 15, trailing: "eod",
        payoutSplit: 0.80, minPayoutDays: 10, consistencyRule: 0.50, // Python: "earn2trade_consistency"
        dailyLossLimit: 1100, overnightOk: false, weekendOk: false, commissionPerSide: 0.62,
        minTradingDays: 10,
      },
    },
  },
};

// ─── Contract Specs ─────────────────────────────────────────────────────────

export const CONTRACT_SPECS: Record<string, { tickSize: number; tickValue: number; pointValue: number }> = {
  MES: { tickSize: 0.25, tickValue: 1.25,  pointValue: 5.00 },
  MNQ: { tickSize: 0.25, tickValue: 0.50,  pointValue: 2.00 },
  MCL: { tickSize: 0.01, tickValue: 1.00,  pointValue: 100.00 },
};

// ─── Contract Cap Bounds (mirrors Python firm_config.py) ────────────────────

export const CONTRACT_CAP_MIN = 10;
export const CONTRACT_CAP_MAX = 20;

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

/** Default commission per side when firmId is null/unknown. $0.62 = MFFU/TPT/Apex/FFN/Earn2Trade default. */
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
