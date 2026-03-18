import { Router } from "express";
import { z } from "zod";
import { db } from "../db/index.js";
import { backtests } from "../db/schema.js";
import { eq } from "drizzle-orm";

export const propFirmRoutes = Router();

// ─── Firm Configuration (all 8 firms) ─────────────────────────
interface FirmConfig {
  name: string;
  displayName: string;
  accountTypes: Record<string, {
    accountSize: number;
    monthlyFee: number;
    activationFee: number;
    profitTarget: number;
    maxDrawdown: number;
    maxContracts: number;
    trailing: "eod" | "realtime";
    payoutSplit: number;
    minPayoutDays: number;
    consistencyRule: number | null;  // max % from best day (e.g., 0.50 for TPT)
    overnightOk: boolean;
  }>;
}

const FIRMS: Record<string, FirmConfig> = {
  mffu: {
    name: "mffu",
    displayName: "MyFundedFutures (MFFU)",
    accountTypes: {
      "50k": {
        accountSize: 50000, monthlyFee: 77, activationFee: 0, profitTarget: 3000,
        maxDrawdown: 2500, maxContracts: 5, trailing: "eod", payoutSplit: 0.90,
        minPayoutDays: 10, consistencyRule: null, overnightOk: true,
      },
      "100k": {
        accountSize: 100000, monthlyFee: 167, activationFee: 0, profitTarget: 6000,
        maxDrawdown: 3500, maxContracts: 10, trailing: "eod", payoutSplit: 0.90,
        minPayoutDays: 10, consistencyRule: null, overnightOk: true,
      },
    },
  },
  topstep: {
    name: "topstep",
    displayName: "Topstep",
    accountTypes: {
      "50k": {
        accountSize: 50000, monthlyFee: 49, activationFee: 149, profitTarget: 3000,
        maxDrawdown: 2000, maxContracts: 5, trailing: "eod", payoutSplit: 0.90,
        minPayoutDays: 5, consistencyRule: null, overnightOk: false,
      },
      "100k": {
        accountSize: 100000, monthlyFee: 99, activationFee: 149, profitTarget: 6000,
        maxDrawdown: 3000, maxContracts: 10, trailing: "eod", payoutSplit: 0.90,
        minPayoutDays: 5, consistencyRule: null, overnightOk: false,
      },
    },
  },
  tpt: {
    name: "tpt",
    displayName: "Take Profit Trader (TPT)",
    accountTypes: {
      "50k": {
        accountSize: 50000, monthlyFee: 150, activationFee: 0, profitTarget: 3000,
        maxDrawdown: 3000, maxContracts: 6, trailing: "eod", payoutSplit: 0.80,
        minPayoutDays: 15, consistencyRule: 0.50, overnightOk: true,
      },
      "100k": {
        accountSize: 100000, monthlyFee: 350, activationFee: 0, profitTarget: 6000,
        maxDrawdown: 6000, maxContracts: 12, trailing: "eod", payoutSplit: 0.80,
        minPayoutDays: 15, consistencyRule: 0.50, overnightOk: true,
      },
    },
  },
  apex: {
    name: "apex",
    displayName: "Apex Trader Funding",
    accountTypes: {
      "50k": {
        accountSize: 50000, monthlyFee: 147, activationFee: 85, profitTarget: 3000,
        maxDrawdown: 2500, maxContracts: 10, trailing: "eod", payoutSplit: 1.00,
        minPayoutDays: 8, consistencyRule: null, overnightOk: true,
      },
      "100k": {
        accountSize: 100000, monthlyFee: 167, activationFee: 85, profitTarget: 6000,
        maxDrawdown: 3000, maxContracts: 14, trailing: "eod", payoutSplit: 1.00,
        minPayoutDays: 8, consistencyRule: null, overnightOk: true,
      },
    },
  },
  ffn: {
    name: "ffn",
    displayName: "Fast Fund Now (FFN)",
    accountTypes: {
      "50k": {
        accountSize: 50000, monthlyFee: 115, activationFee: 0, profitTarget: 3000,
        maxDrawdown: 2500, maxContracts: 5, trailing: "eod", payoutSplit: 0.80,
        minPayoutDays: 10, consistencyRule: 0.15, overnightOk: true,
      },
      "100k": {
        accountSize: 100000, monthlyFee: 200, activationFee: 0, profitTarget: 6000,
        maxDrawdown: 3500, maxContracts: 10, trailing: "eod", payoutSplit: 0.80,
        minPayoutDays: 10, consistencyRule: 0.15, overnightOk: true,
      },
    },
  },
  alpha: {
    name: "alpha",
    displayName: "Alpha Futures",
    accountTypes: {
      "50k": {
        accountSize: 50000, monthlyFee: 97, activationFee: 0, profitTarget: 3000,
        maxDrawdown: 2000, maxContracts: 12, trailing: "eod", payoutSplit: 0.80,
        minPayoutDays: 10, consistencyRule: null, overnightOk: true,
      },
      "100k": {
        accountSize: 100000, monthlyFee: 197, activationFee: 0, profitTarget: 6000,
        maxDrawdown: 4000, maxContracts: 20, trailing: "eod", payoutSplit: 0.80,
        minPayoutDays: 10, consistencyRule: null, overnightOk: true,
      },
    },
  },
  tradeify: {
    name: "tradeify",
    displayName: "Tradeify",
    accountTypes: {
      "50k": {
        accountSize: 50000, monthlyFee: 99, activationFee: 0, profitTarget: 3000,
        maxDrawdown: 2500, maxContracts: 5, trailing: "realtime", payoutSplit: 0.80,
        minPayoutDays: 10, consistencyRule: null, overnightOk: true,
      },
      "100k": {
        accountSize: 100000, monthlyFee: 150, activationFee: 0, profitTarget: 6000,
        maxDrawdown: 5000, maxContracts: 10, trailing: "realtime", payoutSplit: 0.80,
        minPayoutDays: 10, consistencyRule: null, overnightOk: true,
      },
    },
  },
  earn2trade: {
    name: "earn2trade",
    displayName: "Earn2Trade",
    accountTypes: {
      "50k": {
        accountSize: 50000, monthlyFee: 150, activationFee: 0, profitTarget: 3000,
        maxDrawdown: 2000, maxContracts: 5, trailing: "eod", payoutSplit: 0.80,
        minPayoutDays: 15, consistencyRule: null, overnightOk: true,
      },
    },
  },
};

// ─── GET /api/prop-firm/firms — List all firms ────────────────
propFirmRoutes.get("/firms", (_req, res) => {
  const firmList = Object.values(FIRMS).map(f => ({
    name: f.name,
    displayName: f.displayName,
    accountTypes: Object.keys(f.accountTypes),
  }));
  res.json(firmList);
});

// ─── POST /api/prop-firm/rank — Rank firms by ROI ─────────────
const rankSchema = z.object({
  avgDailyPnl: z.number().positive(),
  maxDrawdown: z.number().positive(),
  winRate: z.number().min(0).max(1),
  profitFactor: z.number().positive(),
  holdsOvernight: z.boolean().default(false),
  bestDayPct: z.number().min(0).max(1).optional(), // % of total profit from best day
  accountType: z.string().default("50k"),
  months: z.number().int().min(1).max(24).default(12),
});

propFirmRoutes.post("/rank", (req, res) => {
  const parsed = rankSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  const { avgDailyPnl, maxDrawdown, winRate, profitFactor, holdsOvernight, bestDayPct, accountType, months } = parsed.data;
  const tradingDaysPerMonth = 20;

  const rankings = Object.values(FIRMS)
    .filter(firm => firm.accountTypes[accountType])
    .map(firm => {
      const acct = firm.accountTypes[accountType];

      // Check compliance
      const violations: string[] = [];
      if (maxDrawdown > acct.maxDrawdown) violations.push(`Drawdown $${maxDrawdown} > limit $${acct.maxDrawdown}`);
      if (!acct.overnightOk && holdsOvernight) violations.push("No overnight holding allowed");
      if (acct.consistencyRule && bestDayPct && bestDayPct > acct.consistencyRule) {
        violations.push(`Best day ${(bestDayPct * 100).toFixed(0)}% > consistency limit ${(acct.consistencyRule * 100).toFixed(0)}%`);
      }

      const passes = violations.length === 0;

      // Estimate days to pass evaluation
      const netDailyPnl = avgDailyPnl * (winRate + (1 - winRate) * -1); // simplified
      const daysToTarget = avgDailyPnl > 0 ? Math.ceil(acct.profitTarget / avgDailyPnl) : 999;
      const evalDays = Math.max(daysToTarget, acct.minPayoutDays);

      // Monthly costs during evaluation
      const evalMonths = Math.ceil(evalDays / tradingDaysPerMonth);
      const totalEvalCost = acct.monthlyFee * evalMonths + acct.activationFee;

      // Monthly gross from funded account
      const monthlyGross = avgDailyPnl * tradingDaysPerMonth;
      const monthlyNet = monthlyGross * acct.payoutSplit;

      // ROI over projection period
      const totalPayouts = monthlyNet * (months - evalMonths);
      const roi = totalEvalCost > 0 ? ((totalPayouts - totalEvalCost) / totalEvalCost) * 100 : 0;

      // Annualized ROI
      const annualizedRoi = months > 0 ? roi * (12 / months) : 0;

      return {
        firm: firm.name,
        displayName: firm.displayName,
        accountType,
        passes,
        violations,
        evalDays,
        evalMonths,
        totalEvalCost: Math.round(totalEvalCost),
        monthlyGross: Math.round(monthlyGross),
        monthlyNet: Math.round(monthlyNet),
        payoutSplit: acct.payoutSplit,
        totalPayouts: Math.round(totalPayouts),
        roi: Math.round(roi),
        annualizedRoi: Math.round(annualizedRoi),
        trailing: acct.trailing,
        maxDrawdown: acct.maxDrawdown,
        maxContracts: acct.maxContracts,
      };
    })
    .sort((a, b) => {
      // Passing firms first, then by ROI
      if (a.passes !== b.passes) return a.passes ? -1 : 1;
      return b.roi - a.roi;
    });

  res.json({
    strategy: { avgDailyPnl, maxDrawdown, winRate, profitFactor },
    projectionMonths: months,
    rankings,
    bestFirm: rankings.find(r => r.passes)?.firm ?? null,
  });
});

// ─── POST /api/prop-firm/payout — Payout projection ──────────
const payoutSchema = z.object({
  firm: z.string(),
  accountType: z.string().default("50k"),
  avgDailyPnl: z.number().positive(),
  numAccounts: z.number().int().min(1).max(20).default(1),
  months: z.number().int().min(1).max(36).default(12),
});

propFirmRoutes.post("/payout", (req, res) => {
  const parsed = payoutSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  const { firm, accountType, avgDailyPnl, numAccounts, months } = parsed.data;
  const firmConfig = FIRMS[firm];
  if (!firmConfig) {
    res.status(400).json({ error: `Unknown firm: ${firm}. Available: ${Object.keys(FIRMS).join(", ")}` });
    return;
  }

  const acct = firmConfig.accountTypes[accountType];
  if (!acct) {
    res.status(400).json({ error: `Unknown account type: ${accountType}. Available: ${Object.keys(firmConfig.accountTypes).join(", ")}` });
    return;
  }

  const tradingDaysPerMonth = 20;
  const daysToTarget = Math.ceil(acct.profitTarget / avgDailyPnl);
  const evalMonths = Math.ceil(Math.max(daysToTarget, acct.minPayoutDays) / tradingDaysPerMonth);

  const monthlyProjection = [];
  let cumulativePayout = 0;
  let cumulativeCost = 0;

  for (let m = 1; m <= months; m++) {
    const isEval = m <= evalMonths;
    const monthlyFee = isEval ? acct.monthlyFee * numAccounts : 0;
    const activationFee = m === 1 ? acct.activationFee * numAccounts : 0;
    const costs = monthlyFee + activationFee;

    const monthlyGross = isEval ? 0 : avgDailyPnl * tradingDaysPerMonth * numAccounts;
    const monthlyNet = monthlyGross * acct.payoutSplit;

    cumulativeCost += costs;
    cumulativePayout += monthlyNet;

    monthlyProjection.push({
      month: m,
      phase: isEval ? "evaluation" : "funded",
      grossPnl: Math.round(monthlyGross),
      netPayout: Math.round(monthlyNet),
      costs: Math.round(costs),
      cumulativePayout: Math.round(cumulativePayout),
      cumulativeCost: Math.round(cumulativeCost),
      cumulativeProfit: Math.round(cumulativePayout - cumulativeCost),
    });
  }

  const breakEvenMonth = monthlyProjection.find(m => m.cumulativeProfit > 0)?.month ?? null;

  res.json({
    firm: firmConfig.displayName,
    accountType,
    numAccounts,
    avgDailyPnl,
    payoutSplit: acct.payoutSplit,
    evalMonths,
    breakEvenMonth,
    totalPayout: Math.round(cumulativePayout),
    totalCosts: Math.round(cumulativeCost),
    totalProfit: Math.round(cumulativePayout - cumulativeCost),
    monthlyProjection,
  });
});

// ─── POST /api/prop-firm/timeline — Evaluation timeline ──────
const timelineSchema = z.object({
  firm: z.string(),
  accountType: z.string().default("50k"),
  avgDailyPnl: z.number().positive(),
  winRate: z.number().min(0).max(1),
  maxDrawdown: z.number().positive(),
});

propFirmRoutes.post("/timeline", (req, res) => {
  const parsed = timelineSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  const { firm, accountType, avgDailyPnl, winRate, maxDrawdown } = parsed.data;
  const firmConfig = FIRMS[firm];
  if (!firmConfig) {
    res.status(400).json({ error: `Unknown firm: ${firm}` });
    return;
  }

  const acct = firmConfig.accountTypes[accountType];
  if (!acct) {
    res.status(400).json({ error: `Unknown account type: ${accountType}` });
    return;
  }

  // Optimistic: straight-line P&L
  const daysOptimistic = Math.ceil(acct.profitTarget / avgDailyPnl);

  // Realistic: account for losing days
  const avgWinDay = avgDailyPnl / winRate;
  const avgLossDay = avgWinDay * 0.5; // Assume avg loss = 50% of avg win
  const netPerDay = winRate * avgWinDay - (1 - winRate) * avgLossDay;
  const daysRealistic = netPerDay > 0 ? Math.ceil(acct.profitTarget / netPerDay) : 999;

  // Conservative: include 2-day losing streak setback
  const setbackDays = 2;
  const setbackAmount = avgLossDay * setbackDays;
  const adjustedTarget = acct.profitTarget + setbackAmount;
  const daysConservative = netPerDay > 0 ? Math.ceil(adjustedTarget / netPerDay) : 999;

  // Check if strategy can survive at this firm
  const survives = maxDrawdown <= acct.maxDrawdown;

  res.json({
    firm: firmConfig.displayName,
    accountType,
    profitTarget: acct.profitTarget,
    maxDrawdown: acct.maxDrawdown,
    strategyMaxDrawdown: maxDrawdown,
    survives,
    timeline: {
      optimistic: {
        tradingDays: Math.max(daysOptimistic, acct.minPayoutDays),
        calendarDays: Math.ceil(Math.max(daysOptimistic, acct.minPayoutDays) * 1.4), // weekdays → calendar
        description: "Assumes every trading day is profitable at avg P&L",
      },
      realistic: {
        tradingDays: Math.max(daysRealistic, acct.minPayoutDays),
        calendarDays: Math.ceil(Math.max(daysRealistic, acct.minPayoutDays) * 1.4),
        description: `Based on ${(winRate * 100).toFixed(0)}% win rate with avg loss at 50% of avg win`,
      },
      conservative: {
        tradingDays: Math.max(daysConservative, acct.minPayoutDays),
        calendarDays: Math.ceil(Math.max(daysConservative, acct.minPayoutDays) * 1.4),
        description: "Includes 2-day losing streak setback buffer",
      },
    },
    minPayoutDays: acct.minPayoutDays,
    monthlyFee: acct.monthlyFee,
    estimatedEvalCost: Math.round(acct.monthlyFee * Math.ceil(Math.max(daysRealistic, acct.minPayoutDays) / 20)),
  });
});

// ─── GET /api/prop-firm/simulate/:backtestId — Simulate backtest against all firms ──
propFirmRoutes.get("/simulate/:backtestId", async (req, res) => {
  try {
    const [bt] = await db.select().from(backtests).where(eq(backtests.id, req.params.backtestId)).limit(1);
    if (!bt) {
      res.status(404).json({ error: "Backtest not found" });
      return;
    }

    const avgDailyPnl = Number(bt.avgDailyPnl ?? 0);
    const maxDrawdown = Math.abs(Number(bt.maxDrawdown ?? 0));
    const winRate = Number(bt.winRate ?? 0);
    const profitFactor = Number(bt.profitFactor ?? 0);

    if (avgDailyPnl <= 0) {
      res.status(400).json({ error: "Backtest has no positive avg daily P&L" });
      return;
    }

    const results = Object.values(FIRMS).flatMap(firm =>
      Object.entries(firm.accountTypes).map(([acctType, acct]) => {
        const violations: string[] = [];
        if (maxDrawdown > acct.maxDrawdown) violations.push(`Drawdown exceeds limit`);

        const daysToTarget = Math.ceil(acct.profitTarget / avgDailyPnl);
        const evalDays = Math.max(daysToTarget, acct.minPayoutDays);
        const evalMonths = Math.ceil(evalDays / 20);
        const evalCost = acct.monthlyFee * evalMonths + acct.activationFee;
        const monthlyNet = avgDailyPnl * 20 * acct.payoutSplit;
        const annualProfit = monthlyNet * 12 - evalCost;
        const roi = evalCost > 0 ? Math.round((annualProfit / evalCost) * 100) : 0;

        return {
          firm: firm.name,
          displayName: firm.displayName,
          accountType: acctType,
          passes: violations.length === 0,
          violations,
          evalDays,
          evalCost: Math.round(evalCost),
          monthlyNet: Math.round(monthlyNet),
          annualProfit: Math.round(annualProfit),
          roi,
        };
      })
    ).sort((a, b) => {
      if (a.passes !== b.passes) return a.passes ? -1 : 1;
      return b.roi - a.roi;
    });

    res.json({
      backtestId: bt.id,
      strategyId: bt.strategyId,
      metrics: { avgDailyPnl, maxDrawdown, winRate, profitFactor },
      results,
      bestFirm: results.find(r => r.passes) ?? null,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
