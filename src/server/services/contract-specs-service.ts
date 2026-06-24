/**
 * W19 Schema 1 — Contract Specs Service
 *
 * Reads authoritative CME contract specs from contract_specs_authoritative table
 * (populated by weekly Databento Definition pull). Falls back to hardcoded
 * firm-config.ts values if the DB table is empty or a symbol is missing.
 *
 * Also runs the weekly Definition pull via Python subprocess and persists
 * results to the DB. Alerts if any spec changed vs hardcoded reference.
 *
 * isActive() guard: honours pipeline pause — Definition pulls are research
 * data, not a safety signal.
 */

import { desc, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { contractSpecsAuthoritative } from "../db/schema.js";
import { logger } from "../lib/logger.js";
import { runPythonModule } from "../lib/python-runner.js";
import { notifyWarning } from "./notification-service.js";
import { appendFamilyGradePostscript } from "../lib/notification-helpers.js";
import { isActive as isPipelineActive } from "./pipeline-control-service.js";

// ─── Hardcoded fallback values (from firm-config.ts CONTRACT_SPECS) ─────
// These are the reference values. If Databento returns different values,
// an alert fires and the operator must review.
//
// F-5 fix (2026-05-20): MCL pointValue corrected from 10.0 → 100.0.
// MCL = Micro Crude Light; 1 tick = $0.01/bbl × 100 bbl = $1.00/tick.
// 1 point = 100 ticks × $1.00 = $100/point. CLAUDE.md §4 is authoritative.
// firm-config.ts CONTRACT_SPECS (the TRUE single source of truth) already had 100.0.
export const CONTRACT_SPECS_HARDCODED: Record<string, {
  multiplier: number;
  tickSize: number;
  pointValue: number;
}> = {
  ES:  { multiplier: 50.0,  tickSize: 0.25, pointValue: 50.0  },
  NQ:  { multiplier: 20.0,  tickSize: 0.25, pointValue: 20.0  },
  MES: { multiplier: 5.0,   tickSize: 0.25, pointValue: 5.0   },
  MNQ: { multiplier: 2.0,   tickSize: 0.25, pointValue: 2.0   },
  MCL: { multiplier: 100.0, tickSize: 0.01, pointValue: 100.0 },
};

export interface ContractSpec {
  symbol: string;
  multiplier: number;
  tickSize: number;
  pointValue: number;
  expiryDate: string | null;
  source: "databento_definition" | "hardcoded_fallback";
  pulledAt: Date | null;
}

// ─── In-memory cache (1 hour TTL — specs change weekly at most) ──────────
const CACHE_TTL_MS = 60 * 60 * 1000;
const specsCache: Map<string, { spec: ContractSpec; cachedAt: number }> = new Map();

function invalidateCache(): void {
  specsCache.clear();
}

/** Get the latest authoritative spec for a symbol, with hardcoded fallback. */
export async function getContractSpec(symbol: string): Promise<ContractSpec> {
  const cached = specsCache.get(symbol);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.spec;
  }

  try {
    const [row] = await db
      .select()
      .from(contractSpecsAuthoritative)
      .where(eq(contractSpecsAuthoritative.symbol, symbol))
      .orderBy(desc(contractSpecsAuthoritative.pulledAt))
      .limit(1);

    if (row) {
      const spec: ContractSpec = {
        symbol,
        multiplier: Number(row.multiplier),
        tickSize: Number(row.tickSize),
        pointValue: Number(row.pointValue),
        expiryDate: row.expiryDate ?? null,
        source: "databento_definition",
        pulledAt: row.pulledAt,
      };
      specsCache.set(symbol, { spec, cachedAt: Date.now() });
      return spec;
    }
  } catch (err) {
    logger.warn({ err, symbol }, "contract-specs-service: DB read failed — using hardcoded fallback");
  }

  // Fallback to hardcoded values
  const hardcoded = CONTRACT_SPECS_HARDCODED[symbol];
  if (!hardcoded) {
    throw new Error(`Unknown symbol: ${symbol}. No spec in DB or hardcoded reference.`);
  }

  const fallback: ContractSpec = {
    symbol,
    multiplier: hardcoded.multiplier,
    tickSize: hardcoded.tickSize,
    pointValue: hardcoded.pointValue,
    expiryDate: null,
    source: "hardcoded_fallback",
    pulledAt: null,
  };
  specsCache.set(symbol, { spec: fallback, cachedAt: Date.now() });
  return fallback;
}

/** Get specs for all tracked symbols. */
export async function getAllContractSpecs(): Promise<ContractSpec[]> {
  const symbols = Object.keys(CONTRACT_SPECS_HARDCODED);
  return Promise.all(symbols.map(getContractSpec));
}

export interface DefinitionPullResult {
  status: "ok" | "error" | "skipped";
  specChanged: boolean;
  changedSymbols: string[];
  results: Array<{
    symbol: string;
    status: string;
    multiplier?: number;
    tickSize?: number;
    pointValue?: number;
    expiryDate?: string | null;
    alert?: { specChanged: boolean; changes: Array<{ field: string; expected: number; actual: number }> };
    message?: string;
  }>;
  error?: string;
}

/**
 * Run the weekly Definition pull via Python subprocess.
 * Persists results to contract_specs_authoritative.
 * Alerts if any spec changed vs hardcoded reference.
 * Pipeline-gated: honours isActive() pause guard.
 */
export async function runDefinitionPull(correlationId?: string): Promise<DefinitionPullResult> {
  if (!(await isPipelineActive())) {
    logger.debug({ correlationId }, "contract-specs-service: pipeline not ACTIVE — skipping definition pull");
    return { status: "skipped", specChanged: false, changedSymbols: [], results: [] };
  }

  let pythonResult: Record<string, unknown>;
  try {
    pythonResult = await runPythonModule<Record<string, unknown>>({
      module: "src.data.scripts.databento_definition_pull",
      config: { output_json: true },
      timeoutMs: 120_000,
      componentName: "databento-definition-pull",
      correlationId,
      // Pass --output-json flag via argv simulation in runPythonModule
      // The Python script reads sys.argv, not config; we use environment-var passthrough
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err, correlationId }, "contract-specs-service: Python definition pull failed");
    return { status: "error", specChanged: false, changedSymbols: [], results: [], error: msg };
  }

  const pyStatus = String(pythonResult?.status ?? "error");
  const pyResults = (pythonResult?.results as Array<Record<string, unknown>>) ?? [];
  const specChanged = Boolean(pythonResult?.spec_changed);
  const changedSymbols: string[] = [];

  // Persist each result to DB
  for (const r of pyResults) {
    if (r.status !== "ok" && r.status !== "dry_run") continue;
    const symbol = String(r.symbol);
    const alert = r.alert as { specChanged: boolean; changes: unknown[] } | undefined;

    if (alert?.specChanged) {
      changedSymbols.push(symbol);
    }

    try {
      await db.insert(contractSpecsAuthoritative).values({
        symbol,
        multiplier: String(r.multiplier ?? 0),
        tickSize: String(r.tick_size ?? 0),
        pointValue: String(r.point_value ?? 0),
        expiryDate: (r.expiry_date as string) ?? null,
        source: "databento_definition",
        rawDefinition: r.raw_definition as Record<string, unknown>,
      }).onConflictDoUpdate({
        target: [contractSpecsAuthoritative.symbol],  // latest per symbol
        set: {
          multiplier: String(r.multiplier ?? 0),
          tickSize: String(r.tick_size ?? 0),
          pointValue: String(r.point_value ?? 0),
          expiryDate: (r.expiry_date as string) ?? null,
          rawDefinition: r.raw_definition as Record<string, unknown>,
          pulledAt: new Date(),
        },
      });
    } catch (dbErr) {
      logger.warn({ err: dbErr, symbol, correlationId }, "contract-specs-service: DB insert failed for symbol");
    }
  }

  // Invalidate in-memory cache so next getContractSpec() reads fresh DB values
  invalidateCache();

  // Alert if any spec changed
  if (specChanged && changedSymbols.length > 0) {
    const changedDetails = pyResults
      .filter((r) => (r.alert as { specChanged: boolean } | undefined)?.specChanged)
      .map((r) => `${r.symbol}: ${JSON.stringify((r.alert as { changes: unknown[] })?.changes)}`)
      .join("; ");

    await notifyWarning(
      "CME contract spec changed vs hardcoded reference",
      appendFamilyGradePostscript(
        `W19 Definition pull detected spec change. Review firm-config.ts CONTRACT_SPECS. Changed: ${changedDetails}`,
        "A trading contract's specifications changed from what was hardcoded — the bot detected a difference.",
        "No action needed — the bot will use backup specifications. Call Tony to review the change.",
      ),
      { changedSymbols, details: changedDetails, correlationId },
    );

    logger.warn({ changedSymbols, correlationId }, "contract-specs-service: CME spec change detected");
  }

  logger.info(
    { status: pyStatus, specChanged, changedSymbols, resultsCount: pyResults.length, correlationId },
    "contract-specs-service: definition pull complete",
  );

  return {
    status: pyStatus === "ok" ? "ok" : "error",
    specChanged,
    changedSymbols,
    results: pyResults.map((r) => ({
      symbol: String(r.symbol),
      status: String(r.status),
      multiplier: typeof r.multiplier === "number" ? r.multiplier : undefined,
      tickSize: typeof r.tick_size === "number" ? r.tick_size : undefined,
      pointValue: typeof r.point_value === "number" ? r.point_value : undefined,
      expiryDate: r.expiry_date as string | null | undefined,
      alert: r.alert as DefinitionPullResult["results"][0]["alert"],
      message: r.message as string | undefined,
    })),
    error: pyStatus !== "ok" ? String(pythonResult?.message ?? "unknown error") : undefined,
  };
}
