/**
 * wave-a-critic-confluence-fold-contract.test.ts
 *
 * Wave A Critic Fix 5 — Fold-level vs per-trade Spearman contract assertion.
 *
 * Finding MED: All IS trades in a fold share the same `mean_confluence_score`
 * (the fold-level average computed during data loading).  The concern was that
 * if the Spearman library operated at trade level, degrees of freedom would be
 * inflated (500+ trades instead of 5-20 folds), producing false SIGNAL verdicts.
 *
 * After reading `confluence-disagreement.ts`, the library ALREADY groups to
 * fold-level: `evaluateConfluenceDisagreement` runs Spearman on
 *   isScoreVec  = folds.map(f => f.meanIsConfluenceScore)
 *   oosRVec     = folds.map(f => f.meanOosRealizedR)
 *
 * Fix: add a test asserting that multiple IS trades in the same fold
 * contribute exactly ONE data point to the Spearman vector (not N).
 * Document the per-fold-vs-per-trade contract in the docstring (done in main fix).
 *
 * This test suite:
 *   1. Verifies that duplicated IS-trade rows in the same fold produce
 *      one fold-level aggregate, not N trade-level points.
 *   2. Verifies that the Spearman n (validFolds) counts folds, not trades.
 *   3. Verifies that varying IS-trade count per fold doesn't change Spearman rho.
 */

import { describe, it, expect } from "vitest";
import {
  evaluateConfluenceDisagreement,
  type ConfluenceReplayRow,
} from "../lib/replay/confluence-disagreement.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeFoldRows(
  foldId: string,
  isEnd: string,
  oosStart: string,
  params: {
    nIsTrades: number;
    isConfluenceScore: number;  // ALL IS trades share this value
    nOosTrades: number;
    oosRealizedR: number;       // ALL OOS trades share this value
  },
): ConfluenceReplayRow[] {
  const rows: ConfluenceReplayRow[] = [];

  // IS trades (all share same mean_confluence_score — the fold-level avg)
  for (let i = 0; i < params.nIsTrades; i++) {
    rows.push({
      tradeId: `${foldId}-is-${i}`,
      backtestId: "bt-test",
      strategyId: "s-test",
      foldId,
      isStart: "2023-01-01",
      isEnd,
      oosStart,
      oosEnd: "2023-12-31",
      entryTime: new Date("2023-03-01T10:00:00Z"),  // required by ConfluenceReplayRow
      isOos: false,
      confluenceScore: params.isConfluenceScore,   // all IS trades = fold mean
      realizedR: null,
      pnl: 0,  // IS trades do not contribute to OOS Sharpe
    });
  }

  // OOS trades
  for (let i = 0; i < params.nOosTrades; i++) {
    rows.push({
      tradeId: `${foldId}-oos-${i}`,
      backtestId: "bt-test",
      strategyId: "s-test",
      foldId,
      isStart: "2023-01-01",
      isEnd,
      oosStart,
      oosEnd: "2023-12-31",
      entryTime: new Date("2023-09-01T10:00:00Z"),  // required by ConfluenceReplayRow
      isOos: true,
      confluenceScore: null,
      realizedR: params.oosRealizedR,
      pnl: params.oosRealizedR * 50,  // notional pnl for Sharpe computation
    });
  }
  return rows;
}

// Build a minimal multi-fold dataset for Spearman.
// We need ≥ MIN_FOLDS_FOR_FULL_ANALYSIS folds with non-trivial variation.
function buildMultiFoldDataset(
  foldDefs: Array<{
    foldId: string;
    nIsTrades: number;
    isConfluenceScore: number;
    nOosTrades: number;
    oosRealizedR: number;
  }>,
): ConfluenceReplayRow[] {
  const allRows: ConfluenceReplayRow[] = [];
  foldDefs.forEach((def, i) => {
    const isEnd   = `2023-${String(i + 1).padStart(2, "0")}-28`;
    const oosStart = `2023-${String(i + 2).padStart(2, "0")}-01`;
    allRows.push(...makeFoldRows(def.foldId, isEnd, oosStart, def));
  });
  return allRows;
}

// ─── Fix 5 — fold-level Spearman contract ─────────────────────────────────────

describe("Fix 5 — evaluateConfluenceDisagreement operates at fold-level (Finding MED)", () => {

  const HASHES = ["hash-1", "hash-2", "hash-3", "hash-4", "hash-5"];

  it("multiple IS trades in same fold → exactly 1 fold data point in Spearman, not N trade points", () => {
    // 5 folds, each with varying IS-trade counts (1, 3, 5, 10, 20 trades).
    // Spearman should operate on 5 data points (one per fold), not 1+3+5+10+20=39.
    const foldDefs = [
      { foldId: "f1", nIsTrades: 1,  isConfluenceScore: 0.80, nOosTrades: 2, oosRealizedR: 2.0 },
      { foldId: "f2", nIsTrades: 3,  isConfluenceScore: 0.70, nOosTrades: 2, oosRealizedR: 1.5 },
      { foldId: "f3", nIsTrades: 5,  isConfluenceScore: 0.60, nOosTrades: 2, oosRealizedR: 1.0 },
      { foldId: "f4", nIsTrades: 10, isConfluenceScore: 0.50, nOosTrades: 2, oosRealizedR: 0.5 },
      { foldId: "f5", nIsTrades: 20, isConfluenceScore: 0.40, nOosTrades: 2, oosRealizedR: 0.2 },
    ];
    const rows = buildMultiFoldDataset(foldDefs);
    const result = evaluateConfluenceDisagreement(rows, HASHES);

    // validFolds should be 5, NOT 39 (total IS trade count)
    expect(result.validFolds).toBe(5);
  });

  it("changing IS-trade count per fold (but same per-fold mean) produces same Spearman rho", () => {
    // Two runs with different per-fold IS-trade counts but SAME per-fold scores.
    // If Spearman operated per-trade, the results would DIFFER because the
    // per-trade score vectors would have different shapes.
    // If Spearman operates per-fold (correct), the results are IDENTICAL.

    const baseScores = [0.80, 0.70, 0.60, 0.50, 0.40];
    const baseOosR   = [2.0,  1.5,  1.0,  0.5,  0.2 ];

    // Run 1: 3 IS trades per fold
    const run1Defs = baseScores.map((score, i) => ({
      foldId: `f${i + 1}`,
      nIsTrades: 3,
      isConfluenceScore: score,
      nOosTrades: 2,
      oosRealizedR: baseOosR[i],
    }));
    const run1 = evaluateConfluenceDisagreement(buildMultiFoldDataset(run1Defs), HASHES);

    // Run 2: 10 IS trades per fold
    const run2Defs = baseScores.map((score, i) => ({
      foldId: `f${i + 1}`,
      nIsTrades: 10,
      isConfluenceScore: score,
      nOosTrades: 2,
      oosRealizedR: baseOosR[i],
    }));
    const run2 = evaluateConfluenceDisagreement(buildMultiFoldDataset(run2Defs), HASHES);

    // Spearman rho should be identical — we operate per fold, not per trade
    expect(run1.spearmanRho).toBeCloseTo(run2.spearmanRho, 6);
    expect(run1.validFolds).toBe(run2.validFolds);
  });

  it("validFolds count matches number of distinct folds, not number of trades", () => {
    // 5 folds, 50 IS trades total, 25 OOS trades total → validFolds = 5
    const foldDefs = Array.from({ length: 5 }, (_, i) => ({
      foldId: `fold-${i}`,
      nIsTrades: 10,         // 50 total IS trades
      isConfluenceScore: 0.50 + i * 0.05,
      nOosTrades: 5,          // 25 total OOS trades
      oosRealizedR: 1.0 + i * 0.2,
    }));
    const rows = buildMultiFoldDataset(foldDefs);
    const totalTrades = rows.length;
    const result = evaluateConfluenceDisagreement(rows, HASHES);

    // Total trades in dataset
    expect(totalTrades).toBe(75);  // 50 IS + 25 OOS
    // But validFolds is the number of folds
    expect(result.validFolds).toBe(5);
  });
});
