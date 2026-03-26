import { Router } from "express";
import { CONTRACT_SPECS, FIRMS, getFirmLimit } from "../../shared/firm-config.js";

export const riskRoutes = Router();

// ─── Max Contracts Calculator ────────────────────────────────
// POST /api/risk/max-contracts
// Given a symbol, ATR, and firm+account, returns the safe max contracts
// so you NEVER breach daily loss / drawdown across all accounts.
riskRoutes.post("/max-contracts", (req, res) => {
  const { symbol, currentAtr, firm, accountSize = "50k", numAccounts = 1, riskPerTradePercent = 1 } = req.body;

  const spec = CONTRACT_SPECS[symbol?.toUpperCase()];
  if (!spec) {
    res.status(400).json({ error: `Unknown symbol: ${symbol}. Supported: ${Object.keys(CONTRACT_SPECS).join(", ")}` });
    return;
  }

  // Always use 50K — accountSize param kept for backward compat
  const firmLimits = getFirmLimit(firm, "50k");
  if (!firmLimits) {
    const available = Object.entries(FIRMS)
      .map(([k, v]) => `${k} (${Object.keys(v.accountTypes).join(",")})`)
      .join("; ");
    res.status(400).json({
      error: `Unknown firm/size: ${firm}/${accountSize}. Supported: ${available}`,
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

  // Daily loss limit cap (if applicable)
  let maxByDailyLoss = Infinity;
  if (firmLimits.dailyLossLimit !== null) {
    maxByDailyLoss = Math.floor(firmLimits.dailyLossLimit / dollarRiskPerContract);
  }

  // Per-account safe max
  const safePerAccount = Math.min(maxByRisk, maxByFirm, maxByDailyLoss);

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
    dailyLossLimit: firmLimits.dailyLossLimit,
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

    // Always use 50K accounts
    const firmLimits = getFirmLimit(pos.firm, "50k");
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
      dailyLossLimit: firmLimits.dailyLossLimit,
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
