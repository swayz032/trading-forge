import { Router } from "express";
import { z } from "zod";
import { db } from "../db/index.js";
import { backtests } from "../db/schema.js";
import { eq } from "drizzle-orm";
import {
  FIRMS,
  FirmAccountConfig,
  FirmConfig,
  CONTRACT_SPECS,
  DEFAULT_ACCOUNT_SIZE,
  getFirmAccount,
  getBufferAmount,
  getTotalHurdle,
  getAllFirms,
} from "../../shared/firm-config.js";

export const propFirmRoutes = Router();

// All firms are 50K only. No multi-account-type logic needed.
const ACCOUNT_TYPE = "50k";

// ─── GET /api/prop-firm/firms — List all firms ────────────────
propFirmRoutes.get("/firms", (_req, res) => {
  const firmList = getAllFirms().map(f => ({
    name: f.name,
    displayName: f.displayName,
    evaluationType: f.evaluationType,
    accountTypes: Object.keys(f.accountTypes),
  }));
  res.json(firmList);
});

// ─── GET /api/prop-firm/firms/:firm — Single firm config ──
propFirmRoutes.get("/firms/:firm", (req, res) => {
  const firmConfig = FIRMS[req.params.firm.toLowerCase()];
  if (!firmConfig) {
    res.status(404).json({ error: `Unknown firm: ${req.params.firm}. Available: ${Object.keys(FIRMS).join(", ")}` });
    return;
  }
  res.json(firmConfig);
});

// ─── GET /api/prop-firm/firms/:firm/:accountType — Single firm + account config ──
propFirmRoutes.get("/firms/:firm/:accountType", (req, res) => {
  const firmConfig = FIRMS[req.params.firm.toLowerCase()];
  if (!firmConfig) {
    res.status(404).json({ error: `Unknown firm: ${req.params.firm}. Available: ${Object.keys(FIRMS).join(", ")}` });
    return;
  }

  const requestedType = (req.params.accountType ?? ACCOUNT_TYPE).toLowerCase();
  if (requestedType !== ACCOUNT_TYPE) {
    // Warn but still return 50K config
    console.warn(`[prop-firm] Requested account type "${requestedType}" — only 50K accounts exist. Returning 50K config.`);
  }

  const acct = firmConfig.accountTypes[ACCOUNT_TYPE];
  if (!acct) {
    res.status(404).json({ error: `No 50K config for firm: ${firmConfig.name}` });
    return;
  }
  const buffer = getBufferAmount(firmConfig.name)!;
  const hurdle = getTotalHurdle(firmConfig.name)!;
  res.json({
    firm: firmConfig.name,
    displayName: firmConfig.displayName,
    evaluationType: firmConfig.evaluationType,
    accountType: ACCOUNT_TYPE,
    config: acct,
    bufferAmount: buffer,
    totalHurdle: hurdle,
  });
});

// ─── POST /api/prop-firm/rank — Rank firms by ROI ─────────────
const rankSchema = z.object({
  avgDailyPnl: z.number().positive(),
  maxDrawdown: z.number().positive(),
  winRate: z.number().min(0).max(1),
  profitFactor: z.number().positive(),
  holdsOvernight: z.boolean().default(false),
  bestDayPct: z.number().min(0).max(1).optional(), // % of total profit from best day
  months: z.number().int().min(1).max(24).default(12),
});

propFirmRoutes.post("/rank", (req, res) => {
  const parsed = rankSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  const { avgDailyPnl, maxDrawdown, winRate, profitFactor, holdsOvernight, bestDayPct, months } = parsed.data;
  const tradingDaysPerMonth = 20;

  const rankings = Object.values(FIRMS)
    .filter(firm => firm.accountTypes[ACCOUNT_TYPE])
    .map(firm => {
      const acct = firm.accountTypes[ACCOUNT_TYPE];

      // Check compliance
      const violations: string[] = [];
      if (maxDrawdown > acct.maxDrawdown) violations.push(`Drawdown $${maxDrawdown} > limit $${acct.maxDrawdown}`);
      if (!acct.overnightOk && holdsOvernight) violations.push("No overnight holding allowed");
      if (acct.consistencyRule && bestDayPct && bestDayPct > acct.consistencyRule) {
        violations.push(`Best day ${(bestDayPct * 100).toFixed(0)}% > consistency limit ${(acct.consistencyRule * 100).toFixed(0)}%`);
      }
      if (acct.dailyLossLimit !== null) {
        violations.push(`Daily loss limit: $${acct.dailyLossLimit}`);
      }

      const passes = violations.length === 0;

      // Estimate days to pass evaluation
      const daysToTarget = avgDailyPnl > 0 ? Math.ceil(acct.profitTarget / avgDailyPnl) : 999;
      const evalDays = Math.max(daysToTarget, acct.minPayoutDays);

      // Buffer phase: after passing eval, must build buffer = maxDrawdown before payouts
      const bufferDays = avgDailyPnl > 0 ? Math.ceil(acct.maxDrawdown / avgDailyPnl) : 999;
      const totalDaysToFirstPayout = evalDays + bufferDays;

      // Monthly costs during evaluation
      const evalMonths = Math.ceil(evalDays / tradingDaysPerMonth);
      const bufferMonths = Math.ceil(bufferDays / tradingDaysPerMonth);
      const totalEvalCost = acct.monthlyFee * evalMonths;

      // Monthly gross from funded account (after buffer phase)
      const monthlyGross = avgDailyPnl * tradingDaysPerMonth;
      // monthlyNet = true take-home after split AND ongoing fees
      const monthlyNet = (monthlyGross * acct.payoutSplit) - acct.ongoingMonthlyFee;

      // Funded months available for payouts (subtract eval + buffer months)
      const totalPrePayoutMonths = evalMonths + bufferMonths;
      const fundedPayoutMonths = Math.max(0, months - totalPrePayoutMonths);

      // Ongoing fees during buffer months (funded but no payouts yet)
      const bufferOngoingFees = acct.ongoingMonthlyFee * bufferMonths;

      // ROI over projection period
      const totalPayouts = monthlyNet * fundedPayoutMonths;
      const totalCosts = totalEvalCost + bufferOngoingFees;
      const roi = totalCosts > 0 ? ((totalPayouts - totalCosts) / totalCosts) * 100 : 0;

      // Annualized ROI
      const annualizedRoi = months > 0 ? roi * (12 / months) : 0;

      return {
        firm: firm.name,
        displayName: firm.displayName,
        accountType: ACCOUNT_TYPE,
        passes,
        violations,
        evalDays,
        bufferDays,
        totalDaysToFirstPayout,
        evalMonths,
        bufferMonths,
        totalEvalCost: Math.round(totalEvalCost),
        ongoingMonthlyFee: acct.ongoingMonthlyFee,
        bufferOngoingFees: Math.round(bufferOngoingFees),
        monthlyGross: Math.round(monthlyGross),
        monthlyNet: Math.round(monthlyNet),
        payoutSplit: acct.payoutSplit,
        fundedPayoutMonths,
        totalPayouts: Math.round(totalPayouts),
        totalCosts: Math.round(totalCosts),
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

  const { firm, avgDailyPnl, numAccounts, months } = parsed.data;
  const firmConfig = FIRMS[firm];
  if (!firmConfig) {
    res.status(400).json({ error: `Unknown firm: ${firm}. Available: ${Object.keys(FIRMS).join(", ")}` });
    return;
  }

  const acct = firmConfig.accountTypes[ACCOUNT_TYPE];
  if (!acct) {
    res.status(400).json({ error: `No 50K config for firm: ${firm}` });
    return;
  }

  const tradingDaysPerMonth = 20;
  const daysToTarget = Math.ceil(acct.profitTarget / avgDailyPnl);
  const evalMonths = Math.ceil(Math.max(daysToTarget, acct.minPayoutDays) / tradingDaysPerMonth);

  // Buffer phase: after eval, must earn maxDrawdown before payouts
  const bufferDays = Math.ceil(acct.maxDrawdown / avgDailyPnl);
  const bufferMonths = Math.ceil(bufferDays / tradingDaysPerMonth);
  const totalPrePayoutMonths = evalMonths + bufferMonths;

  const monthlyProjection = [];
  let cumulativePayout = 0;
  let cumulativeCost = 0;

  for (let m = 1; m <= months; m++) {
    const isEval = m <= evalMonths;
    const isBuffer = !isEval && m <= totalPrePayoutMonths;
    const isFunded = m > totalPrePayoutMonths;

    const evalFee = isEval ? acct.monthlyFee * numAccounts : 0;
    const ongoingFee = !isEval ? acct.ongoingMonthlyFee * numAccounts : 0;
    const costs = evalFee + ongoingFee;

    const monthlyGross = isEval ? 0 : avgDailyPnl * tradingDaysPerMonth * numAccounts;
    const monthlyNet = isFunded ? monthlyGross * acct.payoutSplit : 0;

    cumulativeCost += costs;
    cumulativePayout += monthlyNet;

    let phase: string;
    if (isEval) phase = "evaluation";
    else if (isBuffer) phase = "buffer";
    else phase = "funded";

    monthlyProjection.push({
      month: m,
      phase,
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
    accountType: ACCOUNT_TYPE,
    numAccounts,
    avgDailyPnl,
    payoutSplit: acct.payoutSplit,
    ongoingMonthlyFee: acct.ongoingMonthlyFee,
    evalMonths,
    bufferMonths,
    totalPrePayoutMonths,
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

  const { firm, avgDailyPnl, winRate, maxDrawdown } = parsed.data;
  const firmConfig = FIRMS[firm];
  if (!firmConfig) {
    res.status(400).json({ error: `Unknown firm: ${firm}` });
    return;
  }

  const acct = firmConfig.accountTypes[ACCOUNT_TYPE];
  if (!acct) {
    res.status(400).json({ error: `No 50K config for firm: ${firm}` });
    return;
  }

  // Optimistic: straight-line P&L
  const daysOptimistic = Math.ceil(acct.profitTarget / avgDailyPnl);

  // Realistic: account for losing days
  const avgWinDay = avgDailyPnl / winRate;
  const avgLossDay = avgWinDay * 0.5;
  const netPerDay = winRate * avgWinDay - (1 - winRate) * avgLossDay;
  const daysRealistic = netPerDay > 0 ? Math.ceil(acct.profitTarget / netPerDay) : 999;

  // Conservative: include 2-day losing streak setback
  const setbackDays = 2;
  const setbackAmount = avgLossDay * setbackDays;
  const adjustedTarget = acct.profitTarget + setbackAmount;
  const daysConservative = netPerDay > 0 ? Math.ceil(adjustedTarget / netPerDay) : 999;

  // Buffer phase days (after passing eval)
  const bufferDaysOptimistic = Math.ceil(acct.maxDrawdown / avgDailyPnl);
  const bufferDaysRealistic = netPerDay > 0 ? Math.ceil(acct.maxDrawdown / netPerDay) : 999;

  // Check if strategy can survive at this firm
  const survives = maxDrawdown <= acct.maxDrawdown;

  res.json({
    firm: firmConfig.displayName,
    accountType: ACCOUNT_TYPE,
    profitTarget: acct.profitTarget,
    maxDrawdown: acct.maxDrawdown,
    strategyMaxDrawdown: maxDrawdown,
    survives,
    bufferAmount: acct.maxDrawdown,
    totalHurdle: acct.profitTarget + acct.maxDrawdown,
    timeline: {
      optimistic: {
        evalDays: Math.max(daysOptimistic, acct.minPayoutDays),
        bufferDays: bufferDaysOptimistic,
        totalDays: Math.max(daysOptimistic, acct.minPayoutDays) + bufferDaysOptimistic,
        calendarDays: Math.ceil((Math.max(daysOptimistic, acct.minPayoutDays) + bufferDaysOptimistic) * 1.4),
        description: "Assumes every trading day is profitable at avg P&L",
      },
      realistic: {
        evalDays: Math.max(daysRealistic, acct.minPayoutDays),
        bufferDays: bufferDaysRealistic,
        totalDays: Math.max(daysRealistic, acct.minPayoutDays) + bufferDaysRealistic,
        calendarDays: Math.ceil((Math.max(daysRealistic, acct.minPayoutDays) + bufferDaysRealistic) * 1.4),
        description: `Based on ${(winRate * 100).toFixed(0)}% win rate with avg loss at 50% of avg win`,
      },
      conservative: {
        evalDays: Math.max(daysConservative, acct.minPayoutDays),
        bufferDays: bufferDaysRealistic,
        totalDays: Math.max(daysConservative, acct.minPayoutDays) + bufferDaysRealistic,
        calendarDays: Math.ceil((Math.max(daysConservative, acct.minPayoutDays) + bufferDaysRealistic) * 1.4),
        description: "Includes 2-day losing streak setback buffer",
      },
    },
    minPayoutDays: acct.minPayoutDays,
    monthlyFee: acct.monthlyFee,
    ongoingMonthlyFee: acct.ongoingMonthlyFee,
    estimatedEvalCost: Math.round(acct.monthlyFee * Math.ceil(Math.max(daysRealistic, acct.minPayoutDays) / 20)),
  });
});

// ─── GET /api/prop-firm/simulate/:backtestId — Simulate backtest against all 50K firms ──
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

    // Only simulate against 50K accounts (one per firm)
    const results = Object.values(FIRMS)
      .filter(firm => firm.accountTypes[ACCOUNT_TYPE])
      .map(firm => {
        const acct = firm.accountTypes[ACCOUNT_TYPE];

        const violations: string[] = [];
        if (maxDrawdown > acct.maxDrawdown) violations.push(`Drawdown exceeds limit`);
        if (acct.dailyLossLimit !== null) {
          violations.push(`Daily loss limit: $${acct.dailyLossLimit}`);
        }

        const daysToTarget = Math.ceil(acct.profitTarget / avgDailyPnl);
        const evalDays = Math.max(daysToTarget, acct.minPayoutDays);
        const evalMonths = Math.ceil(evalDays / 20);
        const evalCost = acct.monthlyFee * evalMonths;

        // Buffer phase
        const bufferDays = Math.ceil(acct.maxDrawdown / avgDailyPnl);
        const bufferMonths = Math.ceil(bufferDays / 20);

        // monthlyNet = true take-home after split AND ongoing fees
        const monthlyNet = (avgDailyPnl * 20 * acct.payoutSplit) - acct.ongoingMonthlyFee;
        const fundedPayoutMonths = Math.max(0, 12 - evalMonths - bufferMonths);
        const bufferOngoingFees = acct.ongoingMonthlyFee * bufferMonths;
        const annualPayouts = monthlyNet * fundedPayoutMonths;
        const annualCosts = evalCost + bufferOngoingFees;
        const annualProfit = annualPayouts - annualCosts;
        const roi = annualCosts > 0 ? Math.round((annualProfit / annualCosts) * 100) : 0;

        return {
          firm: firm.name,
          displayName: firm.displayName,
          accountType: ACCOUNT_TYPE,
          passes: violations.length === 0,
          violations,
          evalDays,
          bufferDays,
          evalCost: Math.round(evalCost),
          ongoingMonthlyFee: acct.ongoingMonthlyFee,
          monthlyNet: Math.round(monthlyNet),
          fundedPayoutMonths,
          annualProfit: Math.round(annualProfit),
          roi,
        };
      })
      .sort((a, b) => {
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
