/**
 * Evolution Service — LLM-guided strategy mutation + re-backtest.
 *
 * When a strategy enters DECLINING:
 * 1. Load strategy config + last Optuna robust ranges
 * 2. Call Python parameter_evolver (which calls Ollama qwen3)
 * 3. Backtest each mutation (walk-forward)
 * 4. If any mutation beats parent OOS Sharpe by >= 10%, create new strategy (gen+1)
 * 5. If none beat parent, retire the strategy
 *
 * Guardrails:
 * - Max 3 evolution attempts per lineage
 * - 7-day cooldown between attempts
 * - Mutations must pass walk-forward validation
 * - New variant must beat parent OOS Sharpe by >= 10%
 */

import { spawn } from "child_process";
import { resolve as pathResolve } from "path";
import { writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { eq, and, gte, desc } from "drizzle-orm";
import { db } from "../db/index.js";
import { strategies, backtests, auditLog } from "../db/schema.js";
import { runBacktest } from "./backtest-service.js";
import { broadcastSSE } from "../routes/sse.js";
import { logger } from "../index.js";

const PROJECT_ROOT = pathResolve(import.meta.dirname ?? ".", "../../..");

const MAX_GENERATIONS = 3;
const IMPROVEMENT_THRESHOLD = 0.10; // 10% improvement required
const COOLDOWN_DAYS = 7;

interface MutationResult {
  params: Record<string, number>;
  reason: string;
}

interface EvolverOutput {
  mutations: MutationResult[];
  model: string;
  parent_params: Record<string, number>;
  error?: string;
}

function runPythonEvolver(configPath: string): Promise<EvolverOutput> {
  return new Promise((resolve, reject) => {
    const pythonCmd = process.platform === "win32" ? "python" : "python3";
    const args = ["-m", "src.engine.parameter_evolver", "--config", configPath];

    const proc = spawn(pythonCmd, args, {
      env: { ...process.env },
      cwd: PROJECT_ROOT,
    });

    const EVOLVER_TIMEOUT_MS = 300_000;
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        proc.kill("SIGTERM");
        reject(new Error(`Evolution timed out after ${EVOLVER_TIMEOUT_MS / 1000}s`));
      }
    }, EVOLVER_TIMEOUT_MS);

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => (stdout += data.toString()));
    proc.stderr.on("data", (data) => {
      stderr += data.toString();
      logger.info({ component: "evolution-engine" }, data.toString().trim());
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      if (code === 0) {
        try {
          resolve(JSON.parse(stdout.trim()));
        } catch {
          reject(new Error(`Failed to parse evolver output: ${stdout.slice(0, 500)}`));
        }
      } else {
        reject(new Error(`Evolution failed (exit ${code}): ${stderr}`));
      }
    });

    proc.on("error", (err) => reject(err));
  });
}

export async function evolveStrategy(strategyId: string): Promise<{
  status: string;
  evolved?: string[];
  error?: string;
}> {
  // Load strategy
  const [strategy] = await db
    .select()
    .from(strategies)
    .where(eq(strategies.id, strategyId));

  if (!strategy) {
    return { status: "failed", error: "Strategy not found" };
  }

  // Guardrail: max generations
  if (strategy.generation >= MAX_GENERATIONS) {
    logger.info({ strategyId, generation: strategy.generation }, "Evolution: max generations reached, retiring");
    await db.update(strategies).set({
      lifecycleState: "RETIRED",
      lifecycleChangedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(strategies.id, strategyId));

    return { status: "retired", error: "Max evolution generations reached" };
  }

  // Guardrail: cooldown — check if we evolved this lineage within 7 days
  const rootId = strategy.parentStrategyId ?? strategyId;
  const recentEvolutions = await db
    .select()
    .from(strategies)
    .where(
      and(
        eq(strategies.parentStrategyId, rootId),
        gte(strategies.createdAt, new Date(Date.now() - COOLDOWN_DAYS * 24 * 60 * 60 * 1000)),
      ),
    );

  if (recentEvolutions.length > 0) {
    return { status: "cooldown", error: `Evolution cooldown: ${COOLDOWN_DAYS} days between attempts` };
  }

  // Get latest completed backtest for parent Sharpe baseline
  const [parentBacktest] = await db
    .select()
    .from(backtests)
    .where(
      and(
        eq(backtests.strategyId, strategyId),
        eq(backtests.status, "completed"),
      ),
    )
    .orderBy(desc(backtests.createdAt))
    .limit(1);

  const parentSharpe = parentBacktest
    ? parseFloat(parentBacktest.sharpeRatio ?? "0")
    : 0;

  // Extract current params and robust ranges from walk-forward results
  const config = strategy.config as Record<string, unknown>;
  const strategyConfig = (config as any).strategy ?? config;
  const wfResults = parentBacktest?.walkForwardResults as Record<string, unknown> | null;

  const currentParams: Record<string, number> = {};
  const robustRanges: Record<string, number[]> = {};

  // Extract indicator periods as params
  const indicators = (strategyConfig.indicators ?? []) as Array<{ type: string; period: number }>;
  indicators.forEach((ind, i) => {
    currentParams[`ind_${i}_period`] = ind.period;
  });

  // Extract robust ranges from walk-forward param stability if available
  if (wfResults?.param_stability) {
    const stability = (wfResults.param_stability as any)?.params ?? {};
    for (const [pname, info] of Object.entries(stability)) {
      const pinfo = info as { mean: number; std: number; values: number[] };
      const mean = pinfo.mean;
      const std = pinfo.std;
      robustRanges[pname] = [Math.round(mean - 2 * std), Math.round(mean + 2 * std)];
    }
  }

  // If no robust ranges from walk-forward, build defaults from indicator types
  if (Object.keys(robustRanges).length === 0) {
    indicators.forEach((ind, i) => {
      const key = `ind_${i}_period`;
      robustRanges[key] = [Math.max(3, ind.period - 10), ind.period + 10];
    });
  }

  // Build evolution config and call Python evolver
  const evolverConfig = {
    name: strategy.name,
    symbol: strategy.symbol,
    timeframe: strategy.timeframe,
    current_params: currentParams,
    robust_ranges: robustRanges,
    current_sharpe: parseFloat(strategy.rollingSharpe30d ?? "0"),
    baseline_sharpe: parentSharpe,
    window_sharpes: wfResults?.windows
      ? (wfResults.windows as any[]).map((w: any) => w.oos_metrics?.sharpe_ratio ?? 0)
      : [],
  };

  const tmpPath = pathResolve(tmpdir(), `evolution-config-${randomUUID()}.json`);
  writeFileSync(tmpPath, JSON.stringify(evolverConfig));

  let evolverOutput: EvolverOutput;
  try {
    evolverOutput = await runPythonEvolver(tmpPath);
  } finally {
    try { unlinkSync(tmpPath); } catch { /* ignore */ }
  }

  if (!evolverOutput.mutations || evolverOutput.mutations.length === 0) {
    logger.info({ strategyId }, "Evolution: no valid mutations generated, retiring");
    await db.update(strategies).set({
      lifecycleState: "RETIRED",
      lifecycleChangedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(strategies.id, strategyId));

    return { status: "exhausted", error: "No valid mutations generated" };
  }

  // Backtest each mutation
  const results: Array<{
    mutation: MutationResult;
    sharpe: number;
    backtestId: string;
    improvement: number;
  }> = [];

  for (const mutation of evolverOutput.mutations) {
    try {
      // Apply mutation params to strategy config
      const mutatedConfig = JSON.parse(JSON.stringify(config));
      const mutatedStrategy = mutatedConfig.strategy ?? mutatedConfig;
      const mutatedIndicators = [...(mutatedStrategy.indicators ?? [])];

      for (const [paramName, paramValue] of Object.entries(mutation.params)) {
        const match = paramName.match(/^ind_(\d+)_period$/);
        if (match) {
          const idx = parseInt(match[1]);
          if (idx < mutatedIndicators.length) {
            mutatedIndicators[idx] = { ...mutatedIndicators[idx], period: paramValue };
          }
        }
      }
      mutatedStrategy.indicators = mutatedIndicators;
      mutatedStrategy.name = `${strategy.name} (gen${strategy.generation + 1})`;

      const backtestConfig = {
        strategy: mutatedStrategy,
        mode: "walkforward" as const,
      };

      const result = await runBacktest(strategyId, backtestConfig as any) as any;
      const mutSharpe = result.sharpe_ratio ?? 0;
      const improvement = parentSharpe > 0
        ? (mutSharpe - parentSharpe) / parentSharpe
        : mutSharpe > 0 ? 1 : 0;

      results.push({
        mutation,
        sharpe: mutSharpe,
        backtestId: result.id,
        improvement,
      });

      logger.info({
        strategyId,
        mutation: mutation.reason,
        sharpe: mutSharpe,
        parentSharpe,
        improvement: `${(improvement * 100).toFixed(1)}%`,
      }, "Evolution: mutation backtested");
    } catch (err) {
      logger.error({ strategyId, mutation: mutation.reason, err }, "Evolution: mutation backtest failed");
    }
  }

  // Find the best mutation that beats parent by >= 10%
  const winners = results
    .filter((r) => r.improvement >= IMPROVEMENT_THRESHOLD)
    .sort((a, b) => b.sharpe - a.sharpe);

  const evolvedIds: string[] = [];

  if (winners.length > 0) {
    const best = winners[0];

    // Create new strategy as gen+1
    const newConfig = JSON.parse(JSON.stringify(config));
    const newStrategy = newConfig.strategy ?? newConfig;
    const newIndicators = [...(newStrategy.indicators ?? [])];

    for (const [paramName, paramValue] of Object.entries(best.mutation.params)) {
      const match = paramName.match(/^ind_(\d+)_period$/);
      if (match) {
        const idx = parseInt(match[1]);
        if (idx < newIndicators.length) {
          newIndicators[idx] = { ...newIndicators[idx], period: paramValue };
        }
      }
    }
    newStrategy.indicators = newIndicators;

    const newName = `${strategy.name.replace(/ \(gen\d+\)$/, "")} (gen${strategy.generation + 1})`;

    const [evolved] = await db.insert(strategies).values({
      name: newName,
      description: `Evolved from ${strategy.name}: ${best.mutation.reason}`,
      symbol: strategy.symbol,
      timeframe: strategy.timeframe,
      config: newConfig,
      lifecycleState: "TESTING",
      preferredRegime: strategy.preferredRegime,
      parentStrategyId: strategyId,
      generation: strategy.generation + 1,
      tags: [...(strategy.tags ?? []), "evolved"],
    }).returning();

    evolvedIds.push(evolved.id);

    // Audit log
    await db.insert(auditLog).values({
      action: "strategy.evolved",
      entityType: "strategy",
      entityId: evolved.id,
      input: {
        parentId: strategyId,
        parentGeneration: strategy.generation,
        mutation: best.mutation,
        parentSharpe,
        evolvedSharpe: best.sharpe,
        improvement: `${(best.improvement * 100).toFixed(1)}%`,
      },
      result: { evolvedId: evolved.id, generation: strategy.generation + 1 },
      status: "success",
    });

    broadcastSSE("strategy:evolved", {
      parentId: strategyId,
      evolvedId: evolved.id,
      generation: strategy.generation + 1,
      improvement: `${(best.improvement * 100).toFixed(1)}%`,
      reason: best.mutation.reason,
    });

    logger.info({
      parentId: strategyId,
      evolvedId: evolved.id,
      generation: strategy.generation + 1,
      sharpe: best.sharpe,
      improvement: `${(best.improvement * 100).toFixed(1)}%`,
    }, "Strategy evolved successfully");
  } else {
    // No mutation beat the threshold — retire
    await db.update(strategies).set({
      lifecycleState: "RETIRED",
      lifecycleChangedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(strategies.id, strategyId));

    await db.insert(auditLog).values({
      action: "strategy.evolution-exhausted",
      entityType: "strategy",
      entityId: strategyId,
      input: {
        mutations: results.map((r) => ({
          reason: r.mutation.reason,
          sharpe: r.sharpe,
          improvement: `${(r.improvement * 100).toFixed(1)}%`,
        })),
        threshold: `${IMPROVEMENT_THRESHOLD * 100}%`,
      },
      result: { retired: true },
      status: "success",
    });

    logger.info({ strategyId, mutations: results.length }, "Evolution exhausted — strategy retired");
  }

  return {
    status: evolvedIds.length > 0 ? "evolved" : "retired",
    evolved: evolvedIds.length > 0 ? evolvedIds : undefined,
  };
}
