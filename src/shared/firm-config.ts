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
  minPayoutDays: number;
  consistencyRule: number | null;
  dailyLossLimit: number | null;
  overnightOk: boolean;
  weekendOk: boolean;             // All firms = false
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
        profitTarget: 3000, maxDrawdown: 2500, maxContracts: 15, trailing: "eod",
        payoutSplit: 0.90, minPayoutDays: 1, consistencyRule: null,
        dailyLossLimit: null, overnightOk: true, weekendOk: false,
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
        dailyLossLimit: null, overnightOk: true, weekendOk: false,
      },
    },
  },

  tpt: {
    name: "tpt",
    displayName: "Take Profit Trader (TPT)",
    evaluationType: "one_step",
    accountTypes: {
      "50k": {
        accountSize: 50_000, monthlyFee: 150, activationFee: 0, ongoingMonthlyFee: 0,
        profitTarget: 3000, maxDrawdown: 3000, maxContracts: 15, trailing: "eod",
        payoutSplit: 0.80,
        payoutSplitTiers: [{ threshold: 5000, split: 0.90 }],
        minPayoutDays: 5, consistencyRule: 0.50,
        dailyLossLimit: null, overnightOk: true, weekendOk: false,
      },
    },
  },

  apex: {
    name: "apex",
    displayName: "Apex Trader Funding",
    evaluationType: "one_step",
    accountTypes: {
      "50k": {
        accountSize: 50_000, monthlyFee: 167, activationFee: 0, ongoingMonthlyFee: 85,
        profitTarget: 3000, maxDrawdown: 2500, maxContracts: 15, trailing: "eod",  // base 10, scales to 15→20
        payoutSplit: 1.00,
        payoutSplitTiers: [{ threshold: 25000, split: 0.90 }],
        minPayoutDays: 7, consistencyRule: null,
        dailyLossLimit: null, overnightOk: true, weekendOk: false,
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
        profitTarget: 3000, maxDrawdown: 2500, maxContracts: 15, trailing: "eod",
        payoutSplit: 0.80,
        payoutSplitTiers: [{ threshold: 5000, split: 0.90 }],
        minPayoutDays: 3, consistencyRule: null,
        dailyLossLimit: 1250, overnightOk: false, weekendOk: false,
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
        payoutSplitTiers: [
          { threshold: 1, split: 0.70 },   // 1st payout
          { threshold: 2, split: 0.75 },   // 2nd payout
          { threshold: 3, split: 0.80 },   // 3rd payout
          { threshold: 4, split: 0.90 },   // 4th+ payout
        ],
        minPayoutDays: 2, consistencyRule: 0.50,
        dailyLossLimit: null, overnightOk: false, weekendOk: false,
      },
    },
  },

  tradeify: {
    name: "tradeify",
    displayName: "Tradeify",
    evaluationType: "one_step",
    accountTypes: {
      "50k": {
        accountSize: 50_000, monthlyFee: 99, activationFee: 0, ongoingMonthlyFee: 0,
        profitTarget: 3000, maxDrawdown: 2500, maxContracts: 15, trailing: "realtime",
        payoutSplit: 0.80, minPayoutDays: 10, consistencyRule: null,
        dailyLossLimit: null, overnightOk: true, weekendOk: false,
      },
    },
  },

  earn2trade: {
    name: "earn2trade",
    displayName: "Earn2Trade",
    evaluationType: "one_step",
    accountTypes: {
      "50k": {
        accountSize: 50_000, monthlyFee: 150, activationFee: 0, ongoingMonthlyFee: 0,
        profitTarget: 3000, maxDrawdown: 2000, maxContracts: 15, trailing: "eod",
        payoutSplit: 0.80, minPayoutDays: 15, consistencyRule: null,
        dailyLossLimit: null, overnightOk: true, weekendOk: false,
      },
    },
  },
};

// ─── Contract Specs ─────────────────────────────────────────────────────────

export const CONTRACT_SPECS: Record<string, { tickSize: number; tickValue: number; pointValue: number }> = {
  ES:  { tickSize: 0.25, tickValue: 12.50, pointValue: 50.00 },
  NQ:  { tickSize: 0.25, tickValue: 5.00,  pointValue: 20.00 },
  CL:  { tickSize: 0.01, tickValue: 10.00, pointValue: 1000.00 },
  YM:  { tickSize: 1.00, tickValue: 5.00,  pointValue: 5.00 },
  RTY: { tickSize: 0.10, tickValue: 5.00,  pointValue: 50.00 },
  GC:  { tickSize: 0.10, tickValue: 10.00, pointValue: 100.00 },
  MES: { tickSize: 0.25, tickValue: 1.25,  pointValue: 5.00 },
  MNQ: { tickSize: 0.25, tickValue: 0.50,  pointValue: 2.00 },
};

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
