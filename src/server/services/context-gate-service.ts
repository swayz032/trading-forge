/**
 * Context Gate Service — pre-trade eligibility check via Python context engine.
 *
 * Caches daily bars per symbol (refreshed once per day).
 * Returns TAKE/REDUCE/SKIP decision for each entry signal.
 *
 * Integration: called from paper-signal-service before opening a position.
 */

import { spawn } from "child_process";
import { resolve as pathResolve } from "path";
import { queryOhlcv, type OhlcvBar } from "../../data/loaders/duckdb-service.js";
import { logger } from "../index.js";
import type { Bar } from "./paper-signal-service.js";
import { parsePythonJson } from "../../shared/utils.js";

const PROJECT_ROOT = pathResolve(import.meta.dirname ?? ".", "../../..");

// ─── Types ───────────────────────────────────────────────────

export interface ContextGateResult {
  action: "TAKE" | "REDUCE" | "SKIP";
  confidence: number;
  reasoning: string[];
  positionSizeAdjustment: number;  // 1.0 for TAKE, 0.5 for REDUCE, 0 for SKIP
  netBias: number;
  playbook: string;
  locationScore: number;
  tensorSignalProbability: number | null;  // MPS P(profitable), null if unavailable
}

interface DailyBarCache {
  symbol: string;
  bars: OhlcvBar[];
  fetchedDate: string;  // YYYY-MM-DD
}

// ─── Daily Bar Cache (one fetch per symbol per day) ──────────

const dailyCache = new Map<string, DailyBarCache>();

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

async function getDailyBars(symbol: string): Promise<OhlcvBar[]> {
  const today = todayStr();
  const cached = dailyCache.get(symbol);
  if (cached && cached.fetchedDate === today) {
    return cached.bars;
  }

  try {
    // Fetch 250 trading days (~1 year) of daily bars
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const fromStr = oneYearAgo.toISOString().slice(0, 10);

    const bars = await queryOhlcv({
      symbol,
      timeframe: "daily",
      from: fromStr,
      to: today,
      adjusted: true,
    });

    dailyCache.set(symbol, { symbol, bars, fetchedDate: today });
    logger.info(
      { symbol, barCount: bars.length },
      `Context gate: cached ${bars.length} daily bars for ${symbol}`,
    );
    return bars;
  } catch (err) {
    logger.warn({ err, symbol }, "Context gate: failed to fetch daily bars — skipping context check");
    return [];
  }
}

// ─── Python Context Engine Call ──────────────────────────────

function callContextEngine(config: Record<string, unknown>): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const pythonCmd = process.platform === "win32" ? "python" : "python3";
    const configJson = JSON.stringify(config);

    // Pass config via stdin to avoid command-line length limits (especially on Windows)
    const proc = spawn(pythonCmd, [
      "-m", "src.engine.context_runner",
      "--mode", "evaluate",
    ], {
      env: { ...process.env },
      cwd: PROJECT_ROOT,
    });

    let settled = false;
    const TIMEOUT_MS = 10_000; // 10s — fast for per-signal checks
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        proc.kill("SIGTERM");
        reject(new Error("Context gate timeout"));
      }
    }, TIMEOUT_MS);

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;

      if (code === 0) {
        try {
          const result = parsePythonJson<Record<string, unknown>>(stdout);
          if (result.error) reject(new Error(result.error as string));
          else resolve(result);
        } catch {
          reject(new Error(`Parse error: ${stdout.slice(0, 200)}`));
        }
      } else {
        reject(new Error(`Context engine exit ${code}: ${stderr.slice(0, 300)}`));
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      reject(err);
    });

    // Write config to stdin
    try {
      proc.stdin.write(configJson);
      proc.stdin.end();
    } catch (err) {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error(`Failed to write to stdin: ${err}`));
      }
    }
  });
}

// ─── Tensor Signal (MPS) — optional P(profitable) ────────────

async function evaluateTensorSignal(
  features: number[],
  modelPath?: string,
): Promise<number | null> {
  if (!modelPath) return null;

  try {
    const { writeFileSync, unlinkSync, existsSync } = await import("fs");
    const { resolve: pathResolve } = await import("path");
    const { tmpdir } = await import("os");
    const { randomUUID } = await import("crypto");

    if (!existsSync(modelPath)) return null;

    const config = { features: [features] };
    const tmpPath = pathResolve(tmpdir(), `tensor-predict-${randomUUID()}.json`);
    writeFileSync(tmpPath, JSON.stringify(config));

    return new Promise<number | null>((resolve) => {
      const pythonCmd = process.platform === "win32" ? "python" : "python3";
      const proc = spawn(pythonCmd, [
        "-m", "src.engine.tensor_signal_model",
        "--mode", "predict",
        "--input-json", tmpPath,
        "--model-path", modelPath,
      ], { env: { ...process.env }, cwd: PROJECT_ROOT });

      const TIMEOUT_MS = 5_000;
      const timer = setTimeout(() => { proc.kill("SIGTERM"); resolve(null); }, TIMEOUT_MS);

      let stdout = "";
      proc.stdout.on("data", (d) => (stdout += d.toString()));
      proc.stderr.on("data", () => {}); // Suppress

      proc.on("close", (code) => {
        clearTimeout(timer);
        try { unlinkSync(tmpPath); } catch { /* cleanup */ }
        if (code === 0) {
          try {
            const result = parsePythonJson<{ predictions: Array<{ probability: number }> }>(stdout);
            const predictions = result.predictions;
            if (Array.isArray(predictions) && predictions.length > 0) {
              resolve(predictions[0].probability ?? null);
            } else {
              resolve(null);
            }
          } catch { resolve(null); }
        } else {
          resolve(null);
        }
      });

      proc.on("error", () => { clearTimeout(timer); resolve(null); });
    });
  } catch {
    return null;
  }
}

// ─── Public API ──────────────────────────────────────────────

/**
 * Evaluate a signal through the full context pipeline.
 *
 * Returns TAKE/REDUCE/SKIP with position sizing adjustment.
 * If context engine fails or no daily data, returns TAKE (fail-open).
 */
export async function evaluateContextGate(
  symbol: string,
  direction: "long" | "short",
  entryPrice: number,
  strategyName: string,
  barBuffer: Bar[],
  indicators: Record<string, number>,
): Promise<ContextGateResult> {
  // Default: fail-open (TAKE) so context gate doesn't block trading if data unavailable
  const defaultResult: ContextGateResult = {
    action: "TAKE",
    confidence: 0,
    reasoning: ["Context gate bypassed — no daily data or engine error"],
    positionSizeAdjustment: 1.0,
    netBias: 0,
    playbook: "UNKNOWN",
    locationScore: 0,
    tensorSignalProbability: null,
  };

  try {
    const dailyBars = await getDailyBars(symbol);
    if (dailyBars.length < 20) {
      logger.debug({ symbol, barCount: dailyBars.length }, "Context gate: insufficient daily data, bypassing");
      return defaultResult;
    }

    // Build config for context engine
    const config: Record<string, unknown> = {
      current_price: entryPrice,
      vwap: indicators["vwap"] ?? 0,
      daily_bars: dailyBars.map((b) => ({
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: b.volume,
      })),
      // Intraday bars with timestamps for session context
      intraday_bars: barBuffer.map((b) => ({
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: b.volume,
        ts_event: b.timestamp,
      })),
      signal: {
        direction,
        entry_price: entryPrice,
        strategy_name: strategyName,
      },
      atr: indicators["atr_14"] ?? 2.0,
      point_value: getPointValue(symbol),
      tick_size: getTickSize(symbol),
    };

    // Fire context engine and tensor signal in parallel (tensor is optional/non-blocking)
    const tensorModelPath = pathResolve(PROJECT_ROOT, "models", "tensor_signal.pt");
    const tensorFeatures = [
      entryPrice,
      indicators["atr_14"] ?? 2.0,
      indicators["vwap"] ?? 0,
      dailyBars.length > 0 ? dailyBars[dailyBars.length - 1].close : entryPrice,
    ];
    const [result, tensorProb] = await Promise.all([
      callContextEngine(config),
      evaluateTensorSignal(tensorFeatures, tensorModelPath),
    ]);
    const eligibility = result.eligibility as Record<string, unknown> | undefined;

    if (!eligibility) {
      logger.warn({ symbol }, "Context gate: no eligibility in result, bypassing");
      return defaultResult;
    }

    const action = (eligibility.action as string) ?? "TAKE";
    const gateResult: ContextGateResult = {
      action: action as "TAKE" | "REDUCE" | "SKIP",
      confidence: (eligibility.confidence as number) ?? 0,
      reasoning: (eligibility.reasoning as string[]) ?? [],
      positionSizeAdjustment: (eligibility.position_size_adjustment as number) ?? 1.0,
      netBias: ((result.bias as Record<string, unknown>)?.net_bias as number) ?? 0,
      playbook: (eligibility.playbook as string) ?? "UNKNOWN",
      locationScore: (eligibility.location_score as number) ?? 0,
      tensorSignalProbability: tensorProb,
    };

    if (tensorProb !== null) {
      logger.info({ symbol, tensorProb }, `Tensor signal: P(profitable)=${tensorProb.toFixed(3)}`);
    }

    logger.info(
      {
        symbol,
        direction,
        strategy: strategyName,
        action: gateResult.action,
        bias: gateResult.netBias,
        location: gateResult.locationScore,
        playbook: gateResult.playbook,
      },
      `Context gate: ${gateResult.action} (bias=${gateResult.netBias}, location=${gateResult.locationScore})`,
    );

    return gateResult;
  } catch (err) {
    logger.warn({ err, symbol }, "Context gate failed — fail-open (TAKE)");
    return defaultResult;
  }
}

// ─── Contract Specs ──────────────────────────────────────────

function getPointValue(symbol: string): number {
  const specs: Record<string, number> = {
    ES: 50, NQ: 20, CL: 1000,
    MES: 5, MNQ: 2, MCL: 100,
  };
  return specs[symbol] ?? 5;
}

function getTickSize(symbol: string): number {
  const specs: Record<string, number> = {
    ES: 0.25, NQ: 0.25, CL: 0.01,
    MES: 0.25, MNQ: 0.25, MCL: 0.01,
  };
  return specs[symbol] ?? 0.25;
}

/** Clear daily bar cache (for testing or manual refresh). */
export function clearDailyCache(): void {
  dailyCache.clear();
}
