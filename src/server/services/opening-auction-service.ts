/**
 * W19 Schema 3 — Opening Auction Service
 *
 * Manages the daily opening auction imbalance pull from Databento (ES + NQ).
 * Surfaces openingAuctionBias ('buy' | 'sell' | 'neutral') to ORB strategies
 * via regime-state-service.ts extension.
 *
 * Cost: ~$5/month at Databento per-message pricing.
 * Cron: weekdays 8:25 AM ET (5 min before auction).
 *
 * Pipeline-gated: honours isActive() pause guard.
 *
 * Consumed by:
 *   - regime-state-service.ts: exposes openingAuctionBias per symbol
 *   - opening_range_breakout_mes.json DSL: use_opening_auction_bias: true field
 */

import { desc, eq, and, gte } from "drizzle-orm";
import { db } from "../db/index.js";
import { openingAuctionImbalance } from "../db/schema.js";
import { logger } from "../lib/logger.js";
import { runPythonModule } from "../lib/python-runner.js";
import { isActive as isPipelineActive } from "./pipeline-control-service.js";

export type AuctionBias = "buy" | "sell" | "neutral";

export interface AuctionImbalanceRecord {
  symbol: string;
  auctionDate: string;
  imbalanceQuantity: number;
  imbalanceSide: AuctionBias | "none";
  pairedQuantity: number | null;
  indicativePrice: number | null;
  auctionTime: string;
}

export interface AuctionPullResult {
  status: "ok" | "error" | "skipped";
  rowsPersisted: number;
  results: Array<{
    symbol: string;
    auctionDate: string;
    status: string;
    imbalanceSide?: string;
    imbalanceQuantity?: number;
    message?: string;
  }>;
  error?: string;
}

// ─── In-memory bias cache (until end of day — bias doesn't change after auction) ──
// Keyed by symbol. Cleared at midnight ET via the daily cron.
const biasCache = new Map<string, { bias: AuctionBias; record: AuctionImbalanceRecord; cachedAt: number }>();
const CACHE_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours — covers the RTH session

export function invalidateAuctionBiasCache(symbol?: string): void {
  if (symbol) {
    biasCache.delete(symbol);
  } else {
    biasCache.clear();
  }
}

/**
 * Get the opening auction bias for a symbol on today (or the given date).
 * Returns 'neutral' if no data available (fail-open — never blocks entries).
 */
export async function getOpeningAuctionBias(
  symbol: string,
  date?: string,
): Promise<{ bias: AuctionBias; record: AuctionImbalanceRecord | null; source: "db" | "cache" | "no_data" }> {
  const targetDate = date ?? new Date().toISOString().slice(0, 10);

  const cacheKey = `${symbol}:${targetDate}`;
  const cached = biasCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return { bias: cached.bias, record: cached.record, source: "cache" };
  }

  try {
    const [row] = await db
      .select()
      .from(openingAuctionImbalance)
      .where(
        and(
          eq(openingAuctionImbalance.symbol, symbol),
          eq(openingAuctionImbalance.auctionDate, targetDate),
        ),
      )
      .orderBy(desc(openingAuctionImbalance.pulledAt))
      .limit(1);

    if (!row) {
      return { bias: "neutral", record: null, source: "no_data" };
    }

    const side = row.imbalanceSide;
    const bias: AuctionBias = side === "buy" ? "buy" : side === "sell" ? "sell" : "neutral";

    const record: AuctionImbalanceRecord = {
      symbol: row.symbol,
      auctionDate: String(row.auctionDate),
      imbalanceQuantity: row.imbalanceQuantity,
      imbalanceSide: side as AuctionImbalanceRecord["imbalanceSide"],
      pairedQuantity: row.pairedQuantity ?? null,
      indicativePrice: row.indicativePrice != null ? Number(row.indicativePrice) : null,
      auctionTime: row.auctionTime.toISOString(),
    };

    biasCache.set(cacheKey, { bias, record, cachedAt: Date.now() });
    return { bias, record, source: "db" };
  } catch (err) {
    logger.warn({ err, symbol, targetDate }, "opening-auction-service: DB read failed — returning neutral");
    return { bias: "neutral", record: null, source: "no_data" };
  }
}

/**
 * Get opening auction biases for ES and NQ (the two symbols we pull).
 * Used by regime-state-service to expose the openingAuctionBias field.
 */
export async function getAllAuctionBiases(date?: string): Promise<Record<string, AuctionBias>> {
  const symbols = ["ES", "NQ"];
  const results: Record<string, AuctionBias> = {};
  for (const symbol of symbols) {
    const { bias } = await getOpeningAuctionBias(symbol, date);
    results[symbol] = bias;
    // MES/MNQ inherit from ES/NQ (same auction book, micro contracts)
    if (symbol === "ES") results["MES"] = bias;
    if (symbol === "NQ") results["MNQ"] = bias;
  }
  return results;
}

/**
 * Run the opening auction imbalance pull via Python subprocess.
 * Called by the 8:25 AM ET weekday cron.
 * Pipeline-gated.
 */
export async function runAuctionImbalancePull(
  lookbackDays = 1,
  correlationId?: string,
): Promise<AuctionPullResult> {
  if (!(await isPipelineActive())) {
    logger.debug({ correlationId }, "opening-auction-service: pipeline not ACTIVE — skipping imbalance pull");
    return { status: "skipped", rowsPersisted: 0, results: [] };
  }

  let pythonResult: Record<string, unknown>;
  try {
    pythonResult = await runPythonModule<Record<string, unknown>>({
      module: "src.data.scripts.databento_imbalance_pull",
      config: { lookback_days: lookbackDays, output_json: true },
      timeoutMs: 60_000,
      componentName: "databento-imbalance-pull",
      correlationId,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err, correlationId }, "opening-auction-service: Python imbalance pull failed");
    return { status: "error", rowsPersisted: 0, results: [], error: msg };
  }

  const pyResults = (pythonResult?.results as Array<Record<string, unknown>>) ?? [];
  let rowsPersisted = 0;

  for (const r of pyResults) {
    if (r.status !== "ok") continue;

    const symbol = String(r.symbol ?? "");
    const auctionDate = String(r.auction_date ?? "");
    const auctionTimeStr = String(r.auction_time ?? new Date().toISOString());
    const imbalanceQty = Number(r.imbalance_quantity ?? 0);
    const imbalanceSide = String(r.imbalance_side ?? "none");

    if (!symbol || !auctionDate) continue;

    // Parse auction_time to Date
    let auctionTime: Date;
    try {
      auctionTime = new Date(auctionTimeStr);
      if (isNaN(auctionTime.getTime())) throw new Error("Invalid date");
    } catch {
      auctionTime = new Date();
    }

    try {
      await db.insert(openingAuctionImbalance).values({
        symbol,
        auctionDate,
        imbalanceQuantity: imbalanceQty,
        imbalanceSide,
        pairedQuantity: r.paired_quantity != null ? Number(r.paired_quantity) : null,
        indicativePrice: r.indicative_price != null ? String(r.indicative_price) : null,
        auctionTime,
      }).onConflictDoUpdate({
        target: [openingAuctionImbalance.symbol, openingAuctionImbalance.auctionDate],
        set: {
          imbalanceQuantity: imbalanceQty,
          imbalanceSide,
          pairedQuantity: r.paired_quantity != null ? Number(r.paired_quantity) : null,
          indicativePrice: r.indicative_price != null ? String(r.indicative_price) : null,
          auctionTime,
          pulledAt: new Date(),
        },
      });
      rowsPersisted++;

      // Invalidate cache for this symbol+date so getOpeningAuctionBias() returns fresh data
      invalidateAuctionBiasCache(`${symbol}:${auctionDate}`);
    } catch (dbErr) {
      logger.warn(
        { err: dbErr, symbol, auctionDate, correlationId },
        "opening-auction-service: DB insert failed for record",
      );
    }
  }

  logger.info(
    { rowsPersisted, symbolCount: ["ES", "NQ"].length, correlationId },
    "opening-auction-service: imbalance pull complete",
  );

  return {
    status: "ok",
    rowsPersisted,
    results: pyResults.map((r) => ({
      symbol: String(r.symbol),
      auctionDate: String(r.auction_date ?? ""),
      status: String(r.status),
      imbalanceSide: r.imbalance_side as string | undefined,
      imbalanceQuantity: typeof r.imbalance_quantity === "number" ? r.imbalance_quantity : undefined,
      message: r.message as string | undefined,
    })),
  };
}

/**
 * Get historical imbalance records for a symbol (for backtesting).
 */
export async function getHistoricalImbalance(
  symbol: string,
  startDate: string,
  endDate: string,
): Promise<AuctionImbalanceRecord[]> {
  const rows = await db
    .select()
    .from(openingAuctionImbalance)
    .where(
      and(
        eq(openingAuctionImbalance.symbol, symbol),
        gte(openingAuctionImbalance.auctionDate, startDate),
      ),
    )
    .orderBy(desc(openingAuctionImbalance.auctionDate))
    .limit(300);

  return rows
    .filter((r) => String(r.auctionDate) <= endDate)
    .map((r) => ({
      symbol: r.symbol,
      auctionDate: String(r.auctionDate),
      imbalanceQuantity: r.imbalanceQuantity,
      imbalanceSide: r.imbalanceSide as AuctionImbalanceRecord["imbalanceSide"],
      pairedQuantity: r.pairedQuantity ?? null,
      indicativePrice: r.indicativePrice != null ? Number(r.indicativePrice) : null,
      auctionTime: r.auctionTime.toISOString(),
    }));
}
