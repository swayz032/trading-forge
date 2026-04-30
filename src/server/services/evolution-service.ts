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

import { eq, and, gte, desc, ne, isNotNull } from "drizzle-orm";
import { db } from "../db/index.js";
import { strategies, backtests, auditLog, mutationOutcomes } from "../db/schema.js";
import { runBacktest } from "./backtest-service.js";
import { broadcastSSE } from "../routes/sse.js";
import { logger } from "../lib/logger.js";
import { runPythonModule } from "../lib/python-runner.js";
import { CircuitBreakerRegistry, CircuitOpenError } from "../lib/circuit-breaker.js";
import { isActive as isPipelineActive } from "./pipeline-control-service.js";
// Dynamic import to avoid circular dependency (lifecycle-service imports evolution-service)
async function getLifecycleService() {
  const { LifecycleService } = await import("./lifecycle-service.js");
  return new LifecycleService();
}

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

export async function evolveStrategy(
  strategyId: string,
  context?: { correlationId?: string },
): Promise<{
  status: string;
  evolved?: string[];
  error?: string;
}> {
  const correlationId = context?.correlationId;
  // ─── Pipeline pause guard ─────────────────────────────────────
  // Block evolution mutations when pipeline is PAUSED/VACATION. Evolution
  // spawns LLM calls + backtests, neither of which should fire while paused.
  // The strategy stays in its current lifecycle state; lifecycle scheduler
  // (also gated) will retry once the pipeline resumes.
  if (!(await isPipelineActive())) {
    logger.info({ fn: "evolveStrategy", strategyId }, "Skipped: pipeline paused");
    return { status: "skipped", error: "pipeline_paused" };
  }

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
    const lifecycle = await getLifecycleService();
    const retireResult = await lifecycle.promoteStrategy(strategyId, strategy.lifecycleState as any, "RETIRED", { correlationId });
    if (!retireResult.success) {
      logger.error({ strategyId, error: retireResult.error }, "Evolution: failed to retire via lifecycle service (max generations)");
    }

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

  const currentArchetype = (strategy.tags ?? []).find((t) => t !== "evolved") ?? null;

  // Load prior mutation outcomes for this strategy lineage to feed the LLM
  // context. We use the root lineage ID so outcomes from parent generations
  // inform child generation mutations.
  const lineageRootId = strategy.parentStrategyId ?? strategyId;
  const priorMutationOutcomes = await db
    .select({
      paramName: mutationOutcomes.paramName,
      direction: mutationOutcomes.direction,
      magnitude: mutationOutcomes.magnitude,
      improvement: mutationOutcomes.improvement,
      success: mutationOutcomes.success,
      regime: mutationOutcomes.regime,
    })
    .from(mutationOutcomes)
    .where(eq(mutationOutcomes.strategyId, lineageRootId))
    .orderBy(desc(mutationOutcomes.createdAt))
    .limit(50);

  const crossArchetypeSuccesses = currentArchetype
    ? await db
      .select({
        paramName: mutationOutcomes.paramName,
        direction: mutationOutcomes.direction,
        magnitude: mutationOutcomes.magnitude,
        improvement: mutationOutcomes.improvement,
        success: mutationOutcomes.success,
        regime: mutationOutcomes.regime,
      })
      .from(mutationOutcomes)
      .where(and(
        isNotNull(mutationOutcomes.parentArchetype),
        eq(mutationOutcomes.parentArchetype, currentArchetype),
        ne(mutationOutcomes.strategyId, lineageRootId),
        eq(mutationOutcomes.success, true),
      ))
      .orderBy(desc(mutationOutcomes.createdAt))
      .limit(20)
    : [];

  const crossArchetypeFailures = currentArchetype
    ? await db
      .select({
        paramName: mutationOutcomes.paramName,
        direction: mutationOutcomes.direction,
        magnitude: mutationOutcomes.magnitude,
        improvement: mutationOutcomes.improvement,
        success: mutationOutcomes.success,
        regime: mutationOutcomes.regime,
      })
      .from(mutationOutcomes)
      .where(and(
        isNotNull(mutationOutcomes.parentArchetype),
        eq(mutationOutcomes.parentArchetype, currentArchetype),
        ne(mutationOutcomes.strategyId, lineageRootId),
        eq(mutationOutcomes.success, false),
      ))
      .orderBy(desc(mutationOutcomes.createdAt))
      .limit(20)
    : [];

  const crossArchetypeOutcomes = [
    ...crossArchetypeSuccesses,
    ...crossArchetypeFailures,
  ];

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
    mutation_history: priorMutationOutcomes.length > 0
      ? priorMutationOutcomes.map((m) => ({
          param_name: m.paramName,
          direction: m.direction,
          magnitude: m.magnitude !== null ? parseFloat(m.magnitude) : null,
          improvement: m.improvement !== null ? parseFloat(m.improvement) : null,
          success: m.success,
          regime: m.regime,
        }))
      : null,
    cross_archetype_history: crossArchetypeOutcomes.length > 0
      ? crossArchetypeOutcomes.map((m) => ({
          param_name: m.paramName,
          direction: m.direction,
          magnitude: m.magnitude !== null ? parseFloat(m.magnitude) : null,
          improvement: m.improvement !== null ? parseFloat(m.improvement) : null,
          success: m.success,
          regime: m.regime,
        }))
      : null,
  };

  // H12: Two breakers wrap the evolver call — outer "python-evolution" tracks
  // Python-bridge health, inner "ollama" tracks Ollama health. parameter_evolver
  // calls Ollama qwen3 internally; if Ollama is down every evolution call would
  // crash raw, so the dedicated breaker fast-fails further calls instead. On
  // circuit-open we mark the run as DEFERRED (not failed) — the strategy stays
  // in its current lifecycle state and the next scheduler tick will retry once
  // the breaker re-closes.
  let evolverOutput: EvolverOutput;
  try {
    evolverOutput = await CircuitBreakerRegistry.get("python-evolution").call(() =>
      CircuitBreakerRegistry.get("ollama").call(() =>
        runPythonModule<EvolverOutput>({
          module: "src.engine.parameter_evolver",
          config: evolverConfig as unknown as Record<string, unknown>,
          timeoutMs: 300_000,
          componentName: "evolution-engine",
          correlationId,
        }),
      ),
    );
  } catch (err) {
    if (err instanceof CircuitOpenError) {
      logger.warn({
        strategyId,
        endpoint: err.endpoint,
        reopensAt: err.reopensAt.toISOString(),
      }, "Evolution deferred — circuit open (will retry on next scheduler tick)");
      await db.insert(auditLog).values({
        action: "strategy.evolution-deferred",
        entityType: "strategy",
        entityId: strategyId,
        input: { reason: "circuit_open", endpoint: err.endpoint },
        result: { reopensAt: err.reopensAt.toISOString(), retryStrategy: "next_scheduler_tick" },
        status: "warning",
        decisionAuthority: "agent",
        errorMessage: `circuit_open: ${err.endpoint}`,
        correlationId: correlationId ?? null,
      }).catch((auditErr) => logger.error({ auditErr }, "deferred audit insert failed (non-blocking)"));
      return { status: "deferred", error: `Circuit open for ${err.endpoint}` };
    }
    logger.error({ strategyId, err }, "Evolution engine failed");
    return { status: "failed", error: String(err) };
  }

  if (!evolverOutput.mutations || evolverOutput.mutations.length === 0) {
    logger.info({ strategyId }, "Evolution: no valid mutations generated, retiring");
    const lifecycle = await getLifecycleService();
    const retireResult = await lifecycle.promoteStrategy(strategyId, strategy.lifecycleState as any, "RETIRED", { correlationId });
    if (!retireResult.success) {
      logger.error({ strategyId, error: retireResult.error }, "Evolution: failed to retire via lifecycle service (no mutations)");
    }

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

      const result = await runBacktest(strategyId, backtestConfig as any, undefined, undefined, correlationId) as any;
      const mutSharpe = result.sharpe_ratio ?? 0;
      const mutPf = result.profit_factor ?? null;
      const mutDd = result.max_drawdown ?? null;
      const improvement = parentSharpe > 0
        ? (mutSharpe - parentSharpe) / parentSharpe
        : mutSharpe > 0 ? 1 : 0;

      results.push({
        mutation,
        sharpe: mutSharpe,
        backtestId: result.id,
        improvement,
      });

      // ─── Phase 2.2: Record mutation impact ──────────────────────────
      // Derive mutation metadata from the first changed param for type/direction.
      const changedParamEntries = Object.entries(mutation.params);
      const firstParam = changedParamEntries[0];
      const firstParamName = firstParam?.[0] ?? "unknown";
      const firstParamNewVal = Number(firstParam?.[1] ?? 0);
      const firstParamOldVal = Number(
        (evolverOutput.parent_params ?? {})[firstParamName] ?? 0,
      );
      const paramDelta = firstParamNewVal - firstParamOldVal;

      // Classify mutation type based on whether a single param or multiple changed
      const mutationType = changedParamEntries.length === 1
        ? (paramDelta > 0 ? "period_expand" : "period_contract")
        : "mixed";

      const mutationDirection = paramDelta >= 0 ? "increase" : "decrease";
      const mutationMagnitude = Math.abs(paramDelta);

      // Parent metrics from the most recent completed backtest (already loaded above)
      const parentMetrics = {
        sharpe: parentSharpe,
        profitFactor: parentBacktest?.profitFactor ? Number(parentBacktest.profitFactor) : null,
        maxDrawdown: parentBacktest?.maxDrawdown ? Number(parentBacktest.maxDrawdown) : null,
      };
      const childMetrics = {
        sharpe: mutSharpe,
        profitFactor: mutPf !== null ? Number(mutPf) : null,
        maxDrawdown: mutDd !== null ? Number(mutDd) : null,
      };

      await db.insert(mutationOutcomes).values({
        strategyId,
        parentArchetype: (strategy.tags ?? []).find((t) => t !== "evolved") ?? null,
        mutationType,
        paramName: firstParamName,
        direction: mutationDirection,
        magnitude: mutationMagnitude.toString(),
        parentMetrics,
        childMetrics,
        improvement: (mutSharpe - parentSharpe).toFixed(4),
        regime: strategy.preferredRegime ?? null,
        success: mutSharpe > parentSharpe,
      }).catch((err) => {
        // Non-blocking — impact tracking must never abort an evolution run
        logger.error({ err, strategyId }, "Evolution: failed to persist mutation outcome");
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

  // Captured inside the transaction, consumed AFTER commit for SSE/log emission.
  // Keeping these out of the tx body prevents partial-state SSE on rollback.
  // P1-2: promotionError is no longer carried here — promotion failures throw
  // out of the tx and emit `evolution:abort` from the catch handler instead.
  let postCommit: {
    kind: "evolved";
    parentId: string;
    evolvedId: string;
    generation: number;
    improvementPct: string;
    reason: string;
    sharpe: number;
  } | { kind: "retired"; mutations: number };

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
    const lifecycle = await getLifecycleService();

    // H1 + atomicity: insert child strategy, run lifecycle promotion, and write
    // the strategy.evolved audit row inside a single db.transaction() so a
    // partial failure (e.g. audit insert fails after the child row landed)
    // rolls back the entire unit and leaves no orphan child + no missing audit.
    // SSE/logging fire only after commit.
    //
    // P1-2: When promoteStrategy() returns success=false (gate refusal, race,
    // invalid transition) we MUST throw inside the tx so the child insert
    // rolls back. Otherwise the tx commits a CANDIDATE child whose intended
    // TESTING promotion silently failed — an orphan that scout/critic will
    // then re-evaluate without context. The throw surfaces below and we audit
    // the abort + emit `evolution:abort` so the loop is observable.
    class PromotionFailedError extends Error {
      constructor(public reason: string, public childIdAttempted: string) {
        super(`Evolution child promotion failed: ${reason}`);
        this.name = "PromotionFailedError";
      }
    }

    let evolvedId: string;
    try {
      evolvedId = await db.transaction(async (tx) => {
        // Insert evolved strategy as CANDIDATE — proper gate via promoteStrategy() below.
        const [evolved] = await (tx as unknown as typeof db)
          .insert(strategies)
          .values({
            name: newName,
            description: `Evolved from ${strategy.name}: ${best.mutation.reason}`,
            symbol: strategy.symbol,
            timeframe: strategy.timeframe,
            config: newConfig,
            lifecycleState: "CANDIDATE",
            preferredRegime: strategy.preferredRegime,
            parentStrategyId: strategyId,
            generation: strategy.generation + 1,
            tags: [...(strategy.tags ?? []), "evolved"],
          })
          .returning();

        // Promote CANDIDATE → TESTING through the lifecycle service, sharing
        // our tx so all writes (lifecycle update + audit rows) commit together
        // with the strategy insert.
        const promoteResult = await lifecycle.promoteStrategy(
          evolved.id,
          "CANDIDATE",
          "TESTING",
          { reason: "evolution_promotion", parentStrategyId: strategyId, correlationId },
          tx as unknown as typeof db,
        );
        if (!promoteResult.success) {
          // P1-2: Throw to roll back the child insert. The catch below records
          // the abort + emits SSE; nothing inside the tx persists.
          throw new PromotionFailedError(promoteResult.error ?? "unknown", evolved.id);
        }

        // Strategy.evolved audit row — fully atomic with the child insert.
        await (tx as unknown as typeof db).insert(auditLog).values({
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
          decisionAuthority: "agent",
          correlationId: correlationId ?? null,
        });

        return evolved.id;
      });
    } catch (txErr) {
      // P1-2: Promotion failure path — child insert was rolled back. We still
      // want a durable record of the attempt + a dashboard-visible signal so
      // the loop is observable. Audit row is written OUTSIDE the rolled-back
      // tx (so it actually lands), then SSE.
      if (txErr instanceof PromotionFailedError) {
        logger.error(
          {
            parentStrategyId: strategyId,
            attemptedChildId: txErr.childIdAttempted,
            reason: txErr.reason,
          },
          "Evolution: CANDIDATE → TESTING promotion failed inside tx; child rolled back",
        );

        await db.insert(auditLog).values({
          action: "evolution.child_creation_aborted",
          entityType: "strategy",
          entityId: strategyId,
          input: {
            parentStrategyId: strategyId,
            parentGeneration: strategy.generation,
            attemptedMutation: best.mutation,
            attemptedChildId: txErr.childIdAttempted,
          },
          result: {
            reason: txErr.reason,
            note: "Promotion gate refused CANDIDATE→TESTING; child insert rolled back to avoid orphan",
          },
          status: "failure",
          decisionAuthority: "gate",
          correlationId: correlationId ?? null,
        }).catch((auditErr) => {
          logger.warn(
            { strategyId, err: auditErr },
            "evolution.child_creation_aborted audit insert failed (non-blocking)",
          );
        });

        broadcastSSE("evolution:abort", {
          parentStrategyId: strategyId,
          parentGeneration: strategy.generation,
          reason: txErr.reason,
          stage: "child_promotion",
        });

        return { status: "aborted", error: `Evolution aborted: ${txErr.reason}` };
      }

      logger.error({ strategyId, err: txErr }, "Evolution: child-strategy commit transaction failed");
      return { status: "failed", error: `Evolution commit failed: ${String(txErr)}` };
    }

    evolvedIds.push(evolvedId);

    postCommit = {
      kind: "evolved",
      parentId: strategyId,
      evolvedId,
      generation: strategy.generation + 1,
      improvementPct: `${(best.improvement * 100).toFixed(1)}%`,
      reason: best.mutation.reason,
      sharpe: best.sharpe,
    };
  } else {
    // Loser path — retire via lifecycle service + write evolution-exhausted audit row.
    // Wrap both writes in a tx so the audit row never lands without a successful
    // lifecycle transition (and vice-versa).
    const lifecycle = await getLifecycleService();
    let retireError: string | undefined;
    try {
      await db.transaction(async (tx) => {
        const retireResult = await lifecycle.promoteStrategy(
          strategyId,
          strategy.lifecycleState as any,
          "RETIRED",
          { correlationId },
          tx as unknown as typeof db,
        );
        if (!retireResult.success) {
          // Capture but don't throw — failed retirements are still worth auditing.
          retireError = retireResult.error;
        }

        await (tx as unknown as typeof db).insert(auditLog).values({
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
          result: { retired: !retireError, retireError: retireError ?? null },
          status: "success",
          decisionAuthority: "agent",
          correlationId: correlationId ?? null,
        });
      });
    } catch (txErr) {
      logger.error({ strategyId, err: txErr }, "Evolution: retire transaction failed");
      return { status: "failed", error: `Evolution retire commit failed: ${String(txErr)}` };
    }

    if (retireError) {
      logger.error({ strategyId, error: retireError }, "Evolution: failed to retire via lifecycle service (threshold not met)");
    }

    postCommit = { kind: "retired", mutations: results.length };
  }

  // ── Post-commit side effects (SSE + logger) ────────────────────────────────
  // Run only after the relevant transaction commits successfully. Never inside
  // the tx; never on a rolled-back path.
  if (postCommit.kind === "evolved") {
    broadcastSSE("strategy:evolved", {
      parentId: postCommit.parentId,
      evolvedId: postCommit.evolvedId,
      generation: postCommit.generation,
      improvement: postCommit.improvementPct,
      reason: postCommit.reason,
    });
    logger.info({
      parentId: postCommit.parentId,
      evolvedId: postCommit.evolvedId,
      generation: postCommit.generation,
      sharpe: postCommit.sharpe,
      improvement: postCommit.improvementPct,
    }, "Strategy evolved successfully");
  } else if (postCommit.kind === "retired") {
    logger.info({ strategyId, mutations: postCommit.mutations }, "Evolution exhausted — strategy retired");
  }

  return {
    status: evolvedIds.length > 0 ? "evolved" : "retired",
    evolved: evolvedIds.length > 0 ? evolvedIds : undefined,
  };
}
