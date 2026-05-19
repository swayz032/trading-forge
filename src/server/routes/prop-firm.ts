import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { createHash } from "node:crypto";
import { db } from "../db/index.js";
import { backtests, strategies } from "../db/schema.js";
import { eq, desc } from "drizzle-orm";
import {
  FIRMS,
  getBufferAmount,
  getTotalHurdle,
  getAllFirms,
} from "../../shared/firm-config.js";
import {
  simulateSurvivalCurve,
  deriveStrategyProfile,
  type StrategyProfile,
  type SurvivalCurve,
} from "../services/prop-firm-survival-service.js";
import { getCurrentPriors } from "../services/firm-adversarial-event-service.js";
import { refitPriorsForAllFirms } from "../services/firm-priors-fitter.js";
import { isActive as isPipelineActive } from "../services/pipeline-control-service.js";
import { strictRateLimit } from "../middleware/strict-rate-limit.js";
import { logger } from "../lib/logger.js";

export const propFirmRoutes = Router();

// ─── B14 (W20 Pass 3) — survival augmentation types ─────────────────────────

/**
 * Survival augmentation fields added to per-firm rank/simulate rows.
 * All fields are OPTIONAL on the wire (`?: ... | null`) so existing consumers
 * that don't know about survival keep working unchanged.
 *
 * Pass 4 (frontend) imports `SurvivalCurve` from this module rather than
 * re-defining the shape.
 */
export type { SurvivalCurve } from "../services/prop-firm-survival-service.js";

export interface FirmSurvivalAugmentation {
  /** 180-day survival probability (canonical headline horizon). 0..1. null on error / no data. */
  survivalProbability: number | null;
  /** Full survival curve at 30/90/180/365 day horizons. null on error. */
  survivalCurve: SurvivalCurve | null;
  /** Sum of evidence_weight across event types in firm priors. 0 = no priors. */
  evidenceWeight: number;
}

/**
 * Phase 0 advisory marker — frontend uses this to gate "advisory · Phase 0"
 * microcopy near survival KPIs. Hard-coded literal until B14 graduates to
 * Phase 1 via env flag (out of scope for Pass 3 — see W20 plan §Authority).
 */
const SURVIVAL_PHASE: "phase_0_advisory" = "phase_0_advisory";

// SUPPORTED FIRMS: MFFU + Topstep ONLY. Legacy firms removed 2026-05-10 (migration 0097).
const CANONICAL_FIRM_IDS = [
  "topstep",
  "mffu",
] as const;
type CanonicalFirmId = (typeof CANONICAL_FIRM_IDS)[number];

function isCanonicalFirmId(s: string): s is CanonicalFirmId {
  return (CANONICAL_FIRM_IDS as readonly string[]).includes(s);
}

/**
 * Deterministic seed derived from a stable input string. Returns a uint32 the
 * Monte Carlo LCG accepts. SHA-256 → first 4 BE bytes → uint32. Two consecutive
 * calls for the same input produce identical seeds → same survival curve.
 */
function deriveSeed(input: string): number {
  return createHash("sha256").update(input).digest().readUInt32BE(0);
}

/**
 * Augment one firm row with survival data. Wraps every per-firm compute in
 * its own try/catch so a single firm's failure does not cascade. On error,
 * returns `{ survivalProbability: null, survivalCurve: null, evidenceWeight: 0 }`.
 */
async function computeFirmSurvival(
  firmId: string,
  profile: StrategyProfile,
  seedInput: string,
): Promise<FirmSurvivalAugmentation> {
  try {
    const priors = await getCurrentPriors(firmId);
    const curve = simulateSurvivalCurve(priors, profile, {
      numTrials: 1000,
      seed: deriveSeed(seedInput),
    });
    return {
      survivalProbability: curve.p_180d,
      survivalCurve: curve,
      evidenceWeight: priors.evidence_weight ?? 0,
    };
  } catch (err) {
    logger.warn(
      { firmId, err: err instanceof Error ? err.message : String(err) },
      "b14_survival_compute_failed_for_firm",
    );
    return {
      survivalProbability: null,
      survivalCurve: null,
      evidenceWeight: 0,
    };
  }
}

/**
 * Build a sensible default StrategyProfile from the rank-endpoint input metrics.
 * The rank endpoint is metrics-only (no strategy/backtest IDs in scope), so the
 * profile is synthesised from `avgDailyPnl` rather than read from DB.
 *
 * Conservative defaults match the survival service's `deriveStrategyProfile`:
 *   - 20 trading days/month × 0.8 prop firm split
 *   - 12 payout requests/year (monthly)
 *   - Trading Forge runs automated end-to-end → usesAutomation=true
 *   - RTH-only is the safer default (no overnight)
 */
function profileFromRankInput(avgDailyPnl: number): StrategyProfile {
  const PAYOUT_SPLIT = 0.8;
  const monthlyPayoutDollars = Math.max(0, avgDailyPnl) * 20 * PAYOUT_SPLIT;
  return {
    monthlyPayoutDollars: monthlyPayoutDollars > 0 ? monthlyPayoutDollars : 5000,
    payoutRequestFrequency: 12,
    usesAutomation: true,
    averagePosition: "rth_only",
  };
}

/** Pipeline pause gate — mirrors `synthetic-black-swan.ts` exactly. */
async function pipelinePauseGate(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!(await isPipelineActive())) {
    res.status(423).json({ error: "pipeline_paused" });
    return;
  }
  next();
}

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
    req.log.warn(`Requested account type "${requestedType}" — only 50K accounts exist. Returning 50K config.`);
  }

  const acct = firmConfig.accountTypes[ACCOUNT_TYPE];
  if (!acct) {
    res.status(404).json({ error: `No 50K config for firm: ${firmConfig.name}` });
    return;
  }
  const buffer = getBufferAmount(firmConfig.name);
  const hurdle = getTotalHurdle(firmConfig.name);
  if (buffer == null || hurdle == null) {
    res.status(500).json({ error: `Missing buffer/hurdle config for firm: ${firmConfig.name}` });
    return;
  }
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

propFirmRoutes.post("/rank", async (req, res) => {
  const parsed = rankSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  const { avgDailyPnl, maxDrawdown, winRate, profitFactor, holdsOvernight, bestDayPct, months } = parsed.data;
  const tradingDaysPerMonth = 20;

  // ─── B14 survival augmentation (additive) ─────────────────────────────────
  // One profile per request — survival math depends only on the input metrics,
  // not on the per-firm payout split. Compute survival per firm in parallel
  // with deterministic seeds so two requests with identical inputs return
  // identical survivalCurve values. Cap the entire compute at ~2s wall-clock.
  const survivalProfile = profileFromRankInput(avgDailyPnl);
  const survivalStartMs = Date.now();
  const SURVIVAL_BUDGET_MS = 2000;

  const survivalById = new Map<string, FirmSurvivalAugmentation>();
  try {
    const eligibleFirms = Object.values(FIRMS).filter(
      (firm) => firm.accountTypes[ACCOUNT_TYPE],
    );
    const survivalResults = await Promise.race([
      Promise.all(
        eligibleFirms.map(async (firm) => {
          const seedInput = `rank|${firm.name}|${avgDailyPnl}|${maxDrawdown}`;
          return [
            firm.name,
            await computeFirmSurvival(firm.name, survivalProfile, seedInput),
          ] as const;
        }),
      ),
      new Promise<Array<readonly [string, FirmSurvivalAugmentation]>>((resolve) =>
        setTimeout(() => resolve([]), SURVIVAL_BUDGET_MS),
      ),
    ]);
    for (const [firmId, aug] of survivalResults) {
      survivalById.set(firmId, aug);
    }
  } catch (err) {
    // Defensive — Promise.all should not throw because computeFirmSurvival
    // catches per-firm. If we get here, log and fall through with empty map.
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "b14_survival_rank_unexpected_failure",
    );
  }
  const survivalDurationMs = Date.now() - survivalStartMs;
  logger.debug(
    {
      route: "POST /api/prop-firm/rank",
      survivalDurationMs,
      firmsCovered: survivalById.size,
    },
    "b14_survival_compute_timing",
  );

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
      // Daily loss limit is informational — we don't have worstDailyLoss in the request
      // so we can't check for a breach. Don't count as a violation.

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

      // B14 — survival augmentation. Defaults to nulls when the firm wasn't
      // covered by the survival compute (e.g. timeout) so the response shape
      // is stable for downstream consumers.
      const survivalAug =
        survivalById.get(firm.name) ?? {
          survivalProbability: null,
          survivalCurve: null,
          evidenceWeight: 0,
        };

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
        // ─── B14 survival augmentation (additive — never null-removes) ────
        survivalProbability: survivalAug.survivalProbability,
        survivalCurve: survivalAug.survivalCurve,
        evidenceWeight: survivalAug.evidenceWeight,
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

  // Guard: winRate=0 makes timeline meaningless — return max placeholders
  if (winRate <= 0) {
    res.json({
      firm,
      accountType: ACCOUNT_TYPE,
      daysOptimistic,
      daysRealistic: 999,
      daysConservative: 999,
      bufferDaysOptimistic: Math.ceil(acct.maxDrawdown / avgDailyPnl),
      bufferDaysRealistic: 999,
    });
    return;
  }

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

    // ─── B14 survival profile (per-strategy) ──────────────────────────────
    // Resolve strategy + use the canonical deriveStrategyProfile helper.
    // Strategy lookup failure must not break the existing simulate response —
    // fall back to a metric-derived default profile.
    let survivalProfile: StrategyProfile;
    try {
      const [strategy] = await db
        .select()
        .from(strategies)
        .where(eq(strategies.id, bt.strategyId))
        .limit(1);
      survivalProfile = deriveStrategyProfile(strategy ?? {}, bt);
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        "b14_survival_simulate_strategy_lookup_failed",
      );
      survivalProfile = profileFromRankInput(avgDailyPnl);
    }

    const survivalStartMs = Date.now();
    const SURVIVAL_BUDGET_MS = 2000;
    const survivalById = new Map<string, FirmSurvivalAugmentation>();
    try {
      const eligibleFirms = Object.values(FIRMS).filter(
        (f) => f.accountTypes[ACCOUNT_TYPE],
      );
      const survivalResults = await Promise.race([
        Promise.all(
          eligibleFirms.map(async (firm) => {
            const seedInput = `${bt.strategyId}|${firm.name}`;
            return [
              firm.name,
              await computeFirmSurvival(firm.name, survivalProfile, seedInput),
            ] as const;
          }),
        ),
        new Promise<Array<readonly [string, FirmSurvivalAugmentation]>>(
          (resolve) => setTimeout(() => resolve([]), SURVIVAL_BUDGET_MS),
        ),
      ]);
      for (const [firmId, aug] of survivalResults) {
        survivalById.set(firmId, aug);
      }
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        "b14_survival_simulate_unexpected_failure",
      );
    }
    logger.debug(
      {
        route: "GET /api/prop-firm/simulate/:backtestId",
        backtestId: bt.id,
        survivalDurationMs: Date.now() - survivalStartMs,
        firmsCovered: survivalById.size,
      },
      "b14_survival_compute_timing",
    );

    // Only simulate against 50K accounts (one per firm)
    const results = Object.values(FIRMS)
      .filter(firm => firm.accountTypes[ACCOUNT_TYPE])
      .map(firm => {
        const acct = firm.accountTypes[ACCOUNT_TYPE];

        const violations: string[] = [];
        if (maxDrawdown > acct.maxDrawdown) violations.push(`Drawdown exceeds limit`);

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

        const survivalAug =
          survivalById.get(firm.name) ?? {
            survivalProbability: null,
            survivalCurve: null,
            evidenceWeight: 0,
          };

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
          // ─── B14 survival augmentation ────────────────────────────────
          survivalProbability: survivalAug.survivalProbability,
          survivalCurve: survivalAug.survivalCurve,
          evidenceWeight: survivalAug.evidenceWeight,
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

// ─── GET /api/prop-firm/survival/:firmId — direct survival query (B14) ──────
//
// Read-only diagnostic. NO pipeline pause guard (per W20 plan: survival reads
// must serve regardless of trading state). Returns 404 for unknown firmId.
// Returns sane response (zeroed survival, evidenceWeight=0) when the firm has
// no priors yet — never 500 on missing data.
//
// Accepts optional `?strategyId=<uuid>` to derive a per-strategy profile from
// the latest backtest. When omitted, applies a sensible default profile.
//
// Response shape (Phase 0):
//   { firmId, survivalProbability, survivalCurve, evidenceWeight,
//     automationFriendly, appliedProfile, phase: "phase_0_advisory" }
propFirmRoutes.get("/survival/:firmId", async (req, res) => {
  const firmIdRaw = String(req.params.firmId ?? "").toLowerCase();
  if (!isCanonicalFirmId(firmIdRaw)) {
    res.status(404).json({
      error: `Unknown firm: ${req.params.firmId}. Available: ${CANONICAL_FIRM_IDS.join(", ")}`,
    });
    return;
  }
  const firmId: CanonicalFirmId = firmIdRaw;

  // Cross-check against firm-config.ts as a defensive convergence guard —
  // CANONICAL_FIRM_IDS and FIRMS keys must stay in sync.
  if (!FIRMS[firmId]) {
    logger.error(
      { firmId },
      "b14_survival_route_canonical_firm_missing_in_firm_config",
    );
    res.status(500).json({
      error: `firm-config.ts is missing firm: ${firmId}`,
    });
    return;
  }

  // Derive strategy profile if strategyId provided.
  const strategyIdParam = req.query.strategyId;
  let appliedProfile: StrategyProfile;
  if (typeof strategyIdParam === "string" && strategyIdParam.length > 0) {
    try {
      const [strategy] = await db
        .select()
        .from(strategies)
        .where(eq(strategies.id, strategyIdParam))
        .limit(1);

      if (!strategy) {
        // Strategy not found — fall back to default profile rather than 404,
        // since the firmId is the primary resource here.
        appliedProfile = {
          monthlyPayoutDollars: 5000,
          payoutRequestFrequency: 12,
          usesAutomation: true,
          averagePosition: "rth_only",
        };
      } else {
        const [latestBacktest] = await db
          .select()
          .from(backtests)
          .where(eq(backtests.strategyId, strategyIdParam))
          .orderBy(desc(backtests.createdAt))
          .limit(1);
        appliedProfile = deriveStrategyProfile(strategy, latestBacktest);
      }
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), strategyIdParam },
        "b14_survival_route_strategy_profile_lookup_failed",
      );
      appliedProfile = {
        monthlyPayoutDollars: 5000,
        payoutRequestFrequency: 12,
        usesAutomation: true,
        averagePosition: "rth_only",
      };
    }
  } else {
    appliedProfile = {
      monthlyPayoutDollars: 5000,
      payoutRequestFrequency: 12,
      usesAutomation: true,
      averagePosition: "rth_only",
    };
  }

  // Compute priors + survival curve. Both are wrapped in try/catch — if the
  // firm has no priors yet, getCurrentPriors returns zero priors (not throws),
  // and the survival math returns p_*=1.0. We translate that into "no data"
  // semantics on the wire when evidenceWeight is 0.
  try {
    const priors = await getCurrentPriors(firmId);
    const seedInput = `${strategyIdParam ?? "default"}|${firmId}`;
    const curve = simulateSurvivalCurve(priors, appliedProfile, {
      numTrials: 1000,
      seed: deriveSeed(seedInput),
    });
    const evidenceWeight = priors.evidence_weight ?? 0;

    // No priors yet → return sane zeroed shape rather than 1.0 (which would
    // misleadingly imply perfect safety from the absence of data).
    if (evidenceWeight === 0) {
      res.json({
        firmId,
        survivalProbability: 0,
        survivalCurve: { p_30d: 0, p_90d: 0, p_180d: 0, p_365d: 0 },
        evidenceWeight: 0,
        automationFriendly: priors.automation_friendly,
        appliedProfile,
        phase: SURVIVAL_PHASE,
      });
      return;
    }

    res.json({
      firmId,
      survivalProbability: curve.p_180d,
      survivalCurve: curve,
      evidenceWeight,
      automationFriendly: priors.automation_friendly,
      appliedProfile,
      phase: SURVIVAL_PHASE,
    });
  } catch (err) {
    // Defensive — surface a structured error but don't 500 the diagnostic.
    logger.error(
      { firmId, err: err instanceof Error ? err.message : String(err) },
      "b14_survival_route_compute_failed",
    );
    res.json({
      firmId,
      survivalProbability: null,
      survivalCurve: null,
      evidenceWeight: 0,
      automationFriendly: 0.5,
      appliedProfile,
      phase: SURVIVAL_PHASE,
      error: "survival_compute_failed",
    });
  }
});

// ─── POST /api/prop-firm/refit-priors — admin recalibration (B14) ───────────
//
// Behind `pipelinePauseGate` (returns 423 when paused — matches the gate-route
// pattern from `synthetic-black-swan.ts`). Strict rate limit (1/min) — this is
// expensive and should never be hammered.
//
// Body MUST include `{ confirm: true }` (defensive — reject without it).
const refitPriorsSchema = z.object({
  confirm: z.literal(true),
});

propFirmRoutes.post(
  "/refit-priors",
  pipelinePauseGate,
  strictRateLimit,
  async (req, res) => {
    const parsed = refitPriorsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid request — `confirm: true` required",
        details: parsed.error.issues,
      });
      return;
    }

    logger.info(
      { route: "POST /api/prop-firm/refit-priors" },
      "b14_refit_priors_entry",
    );
    const startMs = Date.now();

    try {
      const result = await refitPriorsForAllFirms();
      const durationMs = Date.now() - startMs;
      logger.info(
        {
          firmsProcessed: result.firmsProcessed,
          priorsUpdated: result.priorsUpdated,
          errorCount: result.errors.length,
          durationMs,
        },
        "b14_refit_priors_complete",
      );
      res.json({
        firmsProcessed: result.firmsProcessed,
        priorsUpdated: result.priorsUpdated,
        errors: result.errors,
        durationMs,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error(
        { err: errMsg },
        "b14_refit_priors_failed",
      );
      res.status(500).json({ error: errMsg });
    }
  },
);
