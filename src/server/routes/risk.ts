import { Router } from "express";

export const riskRoutes = Router();

// ─── Contract Specs ─────────────────────────────────────────
const CONTRACT_SPECS: Record<string, { tickSize: number; tickValue: number; pointValue: number }> = {
  ES:  { tickSize: 0.25, tickValue: 12.50, pointValue: 50.00 },
  NQ:  { tickSize: 0.25, tickValue: 5.00,  pointValue: 20.00 },
  CL:  { tickSize: 0.01, tickValue: 10.00, pointValue: 1000.00 },
  YM:  { tickSize: 1.00, tickValue: 5.00,  pointValue: 5.00 },
  RTY: { tickSize: 0.10, tickValue: 5.00,  pointValue: 50.00 },
  GC:  { tickSize: 0.10, tickValue: 10.00, pointValue: 100.00 },
  MES: { tickSize: 0.25, tickValue: 1.25,  pointValue: 5.00 },
  MNQ: { tickSize: 0.25, tickValue: 0.50,  pointValue: 2.00 },
};

// ─── Prop Firm Limits ────────────────────────────────────────
const FIRM_LIMITS: Record<string, Record<string, { maxDrawdown: number; maxContracts: number; dailyLoss: number | null; trailing: string }>> = {
  topstep: {
    "50k":  { maxDrawdown: 2000, maxContracts: 5,  dailyLoss: null, trailing: "eod" },
    "100k": { maxDrawdown: 3000, maxContracts: 10, dailyLoss: null, trailing: "eod" },
    "150k": { maxDrawdown: 4500, maxContracts: 15, dailyLoss: null, trailing: "eod" },
  },
  mffu: {
    "50k":  { maxDrawdown: 2500, maxContracts: 5,  dailyLoss: null, trailing: "eod" },
    "100k": { maxDrawdown: 3500, maxContracts: 10, dailyLoss: null, trailing: "eod" },
    "150k": { maxDrawdown: 5000, maxContracts: 15, dailyLoss: null, trailing: "eod" },
  },
  tpt: {
    "50k":  { maxDrawdown: 3000, maxContracts: 6,  dailyLoss: null, trailing: "eod" },
    "100k": { maxDrawdown: 6000, maxContracts: 12, dailyLoss: null, trailing: "eod" },
  },
  apex: {
    "50k":  { maxDrawdown: 2500, maxContracts: 10, dailyLoss: null, trailing: "eod" },
    "100k": { maxDrawdown: 3000, maxContracts: 14, dailyLoss: null, trailing: "eod" },
  },
  tradeify: {
    "50k":  { maxDrawdown: 2500, maxContracts: 5,  dailyLoss: null, trailing: "realtime" },
    "100k": { maxDrawdown: 5000, maxContracts: 10, dailyLoss: null, trailing: "realtime" },
  },
  alpha_standard: {
    "50k":  { maxDrawdown: 2000, maxContracts: 12, dailyLoss: null, trailing: "eod" },
    "100k": { maxDrawdown: 4000, maxContracts: 20, dailyLoss: null, trailing: "eod" },
  },
  ffn: {
    "50k":  { maxDrawdown: 2500, maxContracts: 5,  dailyLoss: 1250, trailing: "eod" },
    "100k": { maxDrawdown: 3500, maxContracts: 10, dailyLoss: 2000, trailing: "eod" },
  },
  earn2trade: {
    "50k":  { maxDrawdown: 2000, maxContracts: 5,  dailyLoss: null, trailing: "eod" },
    "100k": { maxDrawdown: 3500, maxContracts: 10, dailyLoss: null, trailing: "eod" },
  },
};

// ─── Max Contracts Calculator ────────────────────────────────
// POST /api/risk/max-contracts
// Given a symbol, ATR, and firm+account, returns the safe max contracts
// so you NEVER breach daily loss / drawdown across all accounts.
riskRoutes.post("/max-contracts", (req, res) => {
  const { symbol, currentAtr, firm, accountSize, numAccounts = 1, riskPerTradePercent = 1 } = req.body;

  const spec = CONTRACT_SPECS[symbol?.toUpperCase()];
  if (!spec) {
    res.status(400).json({ error: `Unknown symbol: ${symbol}. Supported: ${Object.keys(CONTRACT_SPECS).join(", ")}` });
    return;
  }

  const firmLimits = FIRM_LIMITS[firm?.toLowerCase()]?.[accountSize?.toLowerCase()];
  if (!firmLimits) {
    res.status(400).json({
      error: `Unknown firm/size: ${firm}/${accountSize}. Supported: ${Object.keys(FIRM_LIMITS).map((f) => `${f} (${Object.keys(FIRM_LIMITS[f]).join(",")})`).join("; ")}`,
    });
    return;
  }

  if (!currentAtr || currentAtr <= 0) {
    res.status(400).json({ error: "currentAtr must be a positive number (e.g., 15.5 for ES)" });
    return;
  }

  // Dollar risk per contract for a 1-ATR stop
  const dollarRiskPerContract = currentAtr * spec.pointValue;

  // Max contracts based on firm drawdown limit
  // Use riskPerTradePercent of the drawdown limit as max risk per trade
  const maxRiskPerTrade = firmLimits.maxDrawdown * (riskPerTradePercent / 100);
  const maxByRisk = Math.floor(maxRiskPerTrade / dollarRiskPerContract);

  // Hard cap from firm rules
  const maxByFirm = firmLimits.maxContracts;

  // Per-account safe max
  const safePerAccount = Math.min(maxByRisk, maxByFirm);

  // Total across all accounts
  const totalContracts = safePerAccount * numAccounts;
  const totalDollarRisk = totalContracts * dollarRiskPerContract;

  res.json({
    symbol: symbol.toUpperCase(),
    firm,
    accountSize,
    currentAtr,
    dollarRiskPerContract: Math.round(dollarRiskPerContract * 100) / 100,
    firmMaxContracts: maxByFirm,
    riskBasedMaxContracts: maxByRisk,
    safeContractsPerAccount: safePerAccount,
    numAccounts,
    totalContractsAllAccounts: totalContracts,
    totalDollarRiskAllAccounts: Math.round(totalDollarRisk * 100) / 100,
    maxDrawdownPerAccount: firmLimits.maxDrawdown,
    trailingType: firmLimits.trailing,
    warning: safePerAccount === 0
      ? "ATR too high — even 1 contract exceeds safe risk. Reduce position or wait for lower volatility."
      : totalDollarRisk > firmLimits.maxDrawdown * numAccounts * 0.5
        ? "Total risk across accounts exceeds 50% of combined drawdown limits. Consider reducing."
        : null,
  });
});

// ─── Portfolio Heat Check ────────────────────────────────────
// POST /api/risk/portfolio-heat
// Given all active positions across accounts, calculate total exposure
riskRoutes.post("/portfolio-heat", (req, res) => {
  const { positions } = req.body;
  // positions: [{ symbol, contracts, entryPrice, currentPrice, firm, accountSize }]

  if (!Array.isArray(positions) || positions.length === 0) {
    res.status(400).json({ error: "positions must be a non-empty array" });
    return;
  }

  let totalUnrealizedPnl = 0;
  let totalDollarExposure = 0;
  let totalMaxDrawdown = 0;
  const details = [];

  for (const pos of positions) {
    const spec = CONTRACT_SPECS[pos.symbol?.toUpperCase()];
    if (!spec) continue;

    const firmLimits = FIRM_LIMITS[pos.firm?.toLowerCase()]?.[pos.accountSize?.toLowerCase()];
    if (!firmLimits) continue;

    const pnl = (pos.currentPrice - pos.entryPrice) * spec.pointValue * pos.contracts;
    const exposure = Math.abs(pos.contracts * pos.currentPrice * spec.pointValue);

    totalUnrealizedPnl += pnl;
    totalDollarExposure += exposure;
    totalMaxDrawdown += firmLimits.maxDrawdown;

    details.push({
      symbol: pos.symbol.toUpperCase(),
      firm: pos.firm,
      contracts: pos.contracts,
      unrealizedPnl: Math.round(pnl * 100) / 100,
      drawdownUsed: pnl < 0 ? Math.round(Math.abs(pnl) * 100) / 100 : 0,
      drawdownRemaining: Math.round((firmLimits.maxDrawdown + Math.min(pnl, 0)) * 100) / 100,
    });
  }

  const heatPercent = totalMaxDrawdown > 0
    ? Math.round((Math.abs(Math.min(totalUnrealizedPnl, 0)) / totalMaxDrawdown) * 10000) / 100
    : 0;

  res.json({
    totalUnrealizedPnl: Math.round(totalUnrealizedPnl * 100) / 100,
    totalDollarExposure: Math.round(totalDollarExposure * 100) / 100,
    totalMaxDrawdownBudget: totalMaxDrawdown,
    portfolioHeatPercent: heatPercent,
    status: heatPercent > 75 ? "DANGER" : heatPercent > 50 ? "WARNING" : "OK",
    positions: details,
  });
});
