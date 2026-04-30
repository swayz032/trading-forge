import { createHash } from "crypto";
import { eq, and, gte, sql, desc, isNull } from "drizzle-orm";
import { db } from "../db/index.js";
import { strategies, systemJournal, auditLog, backtests } from "../db/schema.js";
import { runBacktest } from "./backtest-service.js";
import { OllamaClient } from "./ollama-client.js";
import { GraveyardGate } from "./graveyard-gate.js";
import { logger } from "../lib/logger.js";
import { callOpenAI } from "./model-router.js";
import { isActive as isPipelineActive } from "./pipeline-control-service.js";
import { captureToDLQ } from "../lib/dlq-service.js";
import { runPythonModule } from "../lib/python-runner.js";

const _SYMBOLS = ["MES", "MNQ", "MCL"] as const;
type Symbol = (typeof _SYMBOLS)[number];

export interface RunStrategyInput {
  strategy_name: string;
  one_sentence: string;
  python_code: string;
  params: Record<string, unknown>;
  symbol: Symbol;
  timeframe: string;
  start_date?: string;
  end_date?: string;
  source: "ollama" | "openclaw" | "manual";
}

export interface CritiqueInput {
  backtestId?: string;
  results?: Record<string, unknown>;
  model?: string;
}

export interface ScoutIdea {
  source: string;
  title: string;
  description: string;
  url?: string;
  summary?: string;
  source_quality?: "high" | "medium" | "low";
  confidence_score?: number;
  instruments?: string[];
  indicators_mentioned?: string[];
}

export class AgentService {
  private ollama: OllamaClient;
  private graveyardGate: GraveyardGate;

  constructor(ollamaClient?: OllamaClient) {
    this.ollama = ollamaClient ?? new OllamaClient();
    this.graveyardGate = new GraveyardGate(this.ollama);
  }

  /**
   * Compile + backtest a strategy candidate end-to-end.
   *
   * NOTE on tournament gating: the 4-role adversarial tournament
   * (Proposer → Critic → Prosecutor → Promoter) runs UPSTREAM in the n8n
   * Strategy_Generation_Loop workflow and is NOT invoked here. n8n is the
   * canonical orchestrator for the tournament; this Node loop only runs
   * the graveyard gate (cosine similarity) before proceeding to backtest.
   *
   * If POST /api/agent/run-strategy is called directly (bypassing n8n),
   * the tournament gate is BYPASSED. See CLAUDE.md
   * "Tournament Gating (n8n-canonical)" for context.
   */
  async runStrategy(input: RunStrategyInput, context?: { correlationId?: string }) {
    const correlationId = context?.correlationId;
    try {
    // ─── Pipeline pause guard ─────────────────────────────────────
    // Block strategy compile→backtest when pipeline is PAUSED/VACATION.
    // n8n keeps scouting (writes to system_journal); those entries are
    // drained by drainScoutedIdeas() once the pipeline resumes.
    if (!(await isPipelineActive())) {
      logger.info(
        { fn: "runStrategy", strategyName: input.strategy_name, source: input.source },
        "Skipped: pipeline paused",
      );
      return { skipped: true, reason: "pipeline_paused", strategyId: null, backtestId: null, status: "skipped", tier: null, forgeScore: null };
    }

    // 0. Graveyard gate — reject if too similar to a dead strategy
    const graveyardCheck = await this.graveyardGate.check(
      `${input.strategy_name}: ${input.one_sentence}`,
    );
    if (graveyardCheck.blocked) {
      logger.info({ graveyardCheck }, "Strategy blocked by graveyard gate");
      return {
        strategyId: null,
        backtestId: null,
        status: "blocked",
        tier: null,
        forgeScore: null,
        graveyardCheck,
      };
    }

    // 0a. Strategy prevalidator — fingerprint match (graveyard journal),
    // correlation guard (DEPLOYED on same market+tf), and regime fit.
    // FIX 4: previously the prevalidator service was orphan-in-process —
    // n8n called it but direct API hits via POST /api/agent/run-strategy
    // bypassed it entirely. Wire it here so all paths are gated.
    //
    // Concept name derivation: lowercase the strategy_name + one_sentence
    // and pick the first archetype keyword that matches. Falls back to a
    // sanitized strategy_name slug if no archetype matches — that gives the
    // prevalidator something deterministic to fingerprint while not silently
    // mapping every untagged candidate to a single bucket.
    {
      const archetypeKeywords: Array<{ keyword: string; concept: string }> = [
        { keyword: "mean revert", concept: "mean_revert" },
        { keyword: "trend follow", concept: "trend_follow" },
        { keyword: "breakout", concept: "breakout" },
        { keyword: "scalp", concept: "scalp" },
        { keyword: "orb", concept: "orb" },
        { keyword: "vwap", concept: "vwap" },
        { keyword: "momentum", concept: "momentum" },
        { keyword: "range", concept: "range" },
        { keyword: "trend", concept: "trend_follow" },
      ];
      const descLowerForPrevalidator = `${input.strategy_name} ${input.one_sentence}`.toLowerCase();
      const matched = archetypeKeywords.find((a) => descLowerForPrevalidator.includes(a.keyword));
      const conceptNameSlug = input.strategy_name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 64);
      const conceptName = matched?.concept ?? (conceptNameSlug || "uncategorized");

      try {
        const { prevalidateCandidate } = await import("./strategy-prevalidator.js");
        const prevalidation = await prevalidateCandidate({
          conceptName,
          market: input.symbol,
          timeframe: input.timeframe,
          entryRules: input.one_sentence,
        });
        if (!prevalidation.passed) {
          logger.info(
            {
              strategyName: input.strategy_name,
              conceptName,
              fingerprint: prevalidation.fingerprint,
              reasons: prevalidation.reasons,
            },
            "Strategy blocked by prevalidator",
          );
          // Audit row mirroring graveyard-gate rejection pattern. No strategy
          // row is written — we reject at the gate, not after persistence.
          await db
            .insert(auditLog)
            .values({
              action: "strategy.prevalidator-rejected",
              entityType: "strategy",
              input: {
                strategy_name: input.strategy_name,
                source: input.source,
                symbol: input.symbol,
                timeframe: input.timeframe,
                conceptName,
              },
              result: {
                fingerprint: prevalidation.fingerprint,
                reasons: prevalidation.reasons,
                checks: prevalidation.checks,
              },
              status: "failure",
              decisionAuthority: "gate",
              correlationId: correlationId ?? null,
            })
            .catch((auditErr) => {
              logger.warn({ err: auditErr }, "prevalidator-rejected audit insert failed (non-blocking)");
            });
          return {
            strategyId: null,
            backtestId: null,
            status: "blocked_prevalidator",
            tier: null,
            forgeScore: null,
            prevalidation,
          };
        }
      } catch (preErr) {
        // Prevalidator infra failure (DB error, missing table) — log and proceed.
        // We treat infra failure as fail-open so the agent loop never deadlocks
        // on a transient prevalidator outage. The graveyard gate above is the
        // primary defense; this is a secondary correlation/regime guard.
        logger.warn({ err: preErr }, "Prevalidator threw — proceeding (fail-open)");
      }
    }

    // 0b. Query graveyard for relevant past failures — inject warnings but don't block.
    // Even if the candidate wasn't blocked by embedding similarity, there may be
    // relevant failure patterns from strategies with the same archetype. These
    // warnings flow into the return value and system journal for audit.
    let graveyardWarnings: string[] = [];
    try {
      // Heuristic: derive archetype from the strategy description keywords
      const descLower = `${input.strategy_name} ${input.one_sentence}`.toLowerCase();
      const archetypeHints: Array<{ keyword: string; category: string }> = [
        { keyword: "mean revert", category: "regime" },
        { keyword: "trend", category: "regime" },
        { keyword: "breakout", category: "robustness" },
        { keyword: "scalp", category: "execution" },
        { keyword: "orb", category: "robustness" },
        { keyword: "vwap", category: "robustness" },
        { keyword: "momentum", category: "regime" },
        { keyword: "range", category: "regime" },
      ];
      const matchedCategory = archetypeHints.find((h) => descLower.includes(h.keyword))?.category;

      if (matchedCategory) {
        const failures = await this.graveyardGate.getRelevantFailures(matchedCategory, 5);
        if (failures.length > 0) {
          graveyardWarnings = failures.map(
            (f) => `[${f.name}] ${f.deathReason ?? "unknown cause"}`
          );
          logger.info(
            { strategyName: input.strategy_name, category: matchedCategory, warningCount: graveyardWarnings.length },
            "Graveyard warnings attached — similar failure patterns found",
          );
        }
      }
    } catch (err) {
      logger.warn({ err }, "Graveyard failure lookup failed (non-blocking)");
    }

    // 1. Deduplicate strategy name — auto-version if name already exists
    let finalName = input.strategy_name;
    const existingNames = await db
      .select({ name: strategies.name })
      .from(strategies)
      .where(sql`lower(${strategies.name}) = lower(${input.strategy_name})`);
    if (existingNames.length > 0) {
      // Find highest existing version
      const versionPattern = new RegExp(`^${input.strategy_name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?: v(\\d+))?$`, "i");
      const allVersions = await db
        .select({ name: strategies.name })
        .from(strategies)
        .where(sql`lower(${strategies.name}) LIKE lower(${input.strategy_name + "%"})`);
      let maxVersion = 1;
      for (const row of allVersions) {
        const match = row.name.match(versionPattern);
        if (match) maxVersion = Math.max(maxVersion, match[1] ? Number(match[1]) : 1);
      }
      finalName = `${input.strategy_name} v${maxVersion + 1}`;
      logger.info({ original: input.strategy_name, deduped: finalName }, "Strategy name deduplicated");
    }

    // 2. Insert strategy into DB
    const [strategy] = await db
      .insert(strategies)
      .values({
        name: finalName,
        description: input.one_sentence,
        symbol: input.symbol,
        timeframe: input.timeframe,
        source: input.source,
        config: {
          python_code: input.python_code,
          params: input.params,
          source: input.source,
          one_sentence: input.one_sentence,
        },
        tags: [input.source, "agent-generated"],
      })
      .returning();

    const strategyId = strategy.id;

    // 2. Build backtest config with python_code path
    const backtestConfig = {
      strategy: {
        name: input.strategy_name,
        symbol: input.symbol,
        timeframe: input.timeframe,
        python_code: input.python_code,
        params: input.params,
        indicators: [],
        entry_long: "",
        entry_short: "",
        exit: "",
        stop_loss: { type: "atr" as const, multiplier: 2.0 },
        position_size: { type: "dynamic_atr" as const, target_risk_dollars: 500 },
      },
      start_date: input.start_date,
      end_date: input.end_date,
      mode: "walkforward" as const,
    };

    // 3. Run backtest (reuses existing Python bridge)
    const result = await runBacktest(strategyId, backtestConfig, undefined, undefined, correlationId);

    const tier = "tier" in result ? result.tier : null;
    const forgeScore = "forge_score" in result ? result.forge_score : null;

    // 4. Log to systemJournal (include graveyard warnings if any)
    await db.insert(systemJournal).values({
      strategyId,
      backtestId: result.id,
      source: input.source,
      generationPrompt: input.one_sentence,
      strategyCode: input.python_code,
      strategyParams: {
        ...input.params,
        ...(graveyardWarnings.length > 0 ? { graveyardWarnings } : {}),
      },
      forgeScore: forgeScore != null ? String(forgeScore) : null,
      tier: tier ?? null,
      status: result.status === "completed" ? "tested" : "failed",
    });

    // 5. Audit log
    await db.insert(auditLog).values({
      action: "agent.run-strategy",
      entityType: "strategy",
      entityId: strategyId,
      input: { strategy_name: input.strategy_name, source: input.source },
      result: {
        backtestId: result.id,
        status: result.status,
        tier,
        forge_score: forgeScore,
        graveyardWarnings: graveyardWarnings.length > 0 ? graveyardWarnings : undefined,
      },
      status: result.status === "completed" ? "success" : "failure",
      decisionAuthority: "agent",
      errorMessage: result.status !== "completed" ? (result as any).error ?? "backtest failed" : undefined,
      correlationId: correlationId ?? null,
    });

    logger.info({ strategyId, backtestId: result.id, tier, graveyardWarnings: graveyardWarnings.length }, "Agent strategy run complete");

    return {
      strategyId,
      backtestId: result.id,
      status: result.status,
      tier,
      forgeScore,
      graveyardWarnings: graveyardWarnings.length > 0 ? graveyardWarnings : undefined,
    };
    } catch (err) {
      // C4: Capture top-level runStrategy failures to DLQ — they are otherwise
      // absorbed by the route layer's fire-and-forget .catch() with only a log.
      const errorMsg = err instanceof Error ? err.message : String(err);
      await captureToDLQ({
        operationType: "agent:run_strategy_failure",
        entityType: "strategy",
        errorMessage: errorMsg,
        metadata: {
          strategy_name: input.strategy_name,
          source: input.source,
          symbol: input.symbol,
          timeframe: input.timeframe,
        },
      }).catch((dlqErr) => logger.error({ dlqErr }, "DLQ capture failed (runStrategy)"));
      throw err;
    }
  }

  /**
   * M3 FIX — Run a strategy from a full StrategyDSL via the Python compiler.
   *
   * This is the canonical path for n8n + scout pipeline. The legacy runStrategy()
   * passes python_code which the engine never executes (it reads entry_long
   * strings instead). This method:
   *   1. POSTs the DSL to the Python compiler (validates + compiles to engine config)
   *   2. Persists the strategy with the compiled config
   *   3. Runs the backtest with proper entry_long/exit/indicators populated
   *
   * Replaces the broken pipeline path: scout → ollama python_code → empty engine config → no backtest.
   */
  async runStrategyFromDSL(
    dsl: Record<string, unknown>,
    options: { source: "ollama" | "openclaw" | "manual"; start_date?: string; end_date?: string } = { source: "openclaw" },
    context?: { correlationId?: string },
  ): Promise<{
    strategyId: string | null;
    backtestId: string | null;
    status: string;
    tier: string | null;
    forgeScore: number | null;
    skipped?: boolean;
    reason?: string;
    compileErrors?: string[];
  }> {
    const correlationId = context?.correlationId;

    // Pipeline pause guard — same as runStrategy
    if (!(await isPipelineActive())) {
      logger.info({ fn: "runStrategyFromDSL", strategyName: String(dsl.name ?? "unknown") }, "Skipped: pipeline paused");
      return { skipped: true, reason: "pipeline_paused", strategyId: null, backtestId: null, status: "skipped", tier: null, forgeScore: null };
    }

    // 1. Compile DSL → backtest config via Python
    let compiled: any;
    try {
      compiled = await runPythonModule({
        module: "src.engine.compiler.compiler",
        args: ["--action", "compile"],
        config: dsl,
        componentName: "agent-runStrategyFromDSL-compile",
      });
    } catch (err: any) {
      const errors = Array.isArray(err?.errors) ? err.errors.map(String) : [err?.message ?? String(err)];
      logger.warn({ errors, dsl_name: dsl.name }, "runStrategyFromDSL: compile failed");
      return { strategyId: null, backtestId: null, status: "compile_failed", tier: null, forgeScore: null, compileErrors: errors };
    }
    if (!compiled || (typeof compiled === "object" && "error" in compiled)) {
      const errMsg = (compiled as any)?.error ?? "compiler returned no config";
      return { strategyId: null, backtestId: null, status: "compile_failed", tier: null, forgeScore: null, compileErrors: [String(errMsg)] };
    }

    // 2. Graveyard gate on the DSL one-sentence
    const dslName = String(dsl.name ?? `dsl_${Date.now()}`);
    const dslDescription = String(dsl.description ?? dslName);
    const graveyardCheck = await this.graveyardGate.check(`${dslName}: ${dslDescription}`);
    if (graveyardCheck.blocked) {
      logger.info({ graveyardCheck, dslName }, "DSL strategy blocked by graveyard gate");
      return { strategyId: null, backtestId: null, status: "blocked", tier: null, forgeScore: null };
    }

    // 3. Persist strategy with the COMPILED config (not python_code)
    const symbol = String(dsl.symbol);
    const timeframe = String(dsl.timeframe);
    const [strategy] = await db
      .insert(strategies)
      .values({
        name: dslName,
        description: dslDescription,
        symbol,
        timeframe,
        config: compiled as Record<string, unknown>,
        preferredRegime: (dsl.preferred_regime ?? null) as string | null,
        tags: [options.source, "dsl-compiled"],
      })
      .returning();
    const strategyId = strategy.id;

    // 4. Run backtest with the compiled config
    const backtestConfig = {
      ...compiled,
      start_date: options.start_date,
      end_date: options.end_date,
      mode: "walkforward" as const,
    };
    const result = await runBacktest(strategyId, backtestConfig, undefined, undefined, correlationId);

    const tier = "tier" in result ? result.tier : null;
    const forgeScore = "forge_score" in result ? result.forge_score : null;

    // 5. Journal entry
    await db.insert(systemJournal).values({
      strategyId,
      backtestId: result.id,
      source: options.source,
      generationPrompt: dslDescription,
      strategyParams: dsl as Record<string, unknown>,
      forgeScore: forgeScore != null ? String(forgeScore) : null,
      tier: tier ?? null,
      status: result.status === "completed" ? "tested" : "failed",
    });

    // 6. Audit log
    await db.insert(auditLog).values({
      action: "agent.run-strategy-from-dsl",
      entityType: "strategy",
      entityId: strategyId,
      input: { dsl_name: dslName, source: options.source, symbol, timeframe },
      result: { backtestId: result.id, status: result.status, tier, forge_score: forgeScore },
      status: result.status === "completed" ? "success" : "failure",
      decisionAuthority: "agent",
      errorMessage: result.status !== "completed" ? (result as any).error ?? "backtest failed" : undefined,
      correlationId: correlationId ?? null,
    });

    logger.info({ strategyId, backtestId: result.id, tier, dslName }, "runStrategyFromDSL complete");

    return { strategyId, backtestId: result.id, status: result.status, tier: tier ?? null, forgeScore: forgeScore ?? null };
  }

  async runClassStrategy(input: {
    strategy_name: string;
    strategy_class: string;
    symbol: string;
    timeframe: string;
    start_date?: string;
    end_date?: string;
    source: "manual" | "ollama" | "openclaw";
    description: string;
    params: Record<string, unknown>;
  }, context?: { correlationId?: string }) {
    const correlationId = context?.correlationId;
    try {
    // ─── Pipeline pause guard ─────────────────────────────────────
    // Block class-based strategy run when pipeline is PAUSED/VACATION.
    if (!(await isPipelineActive())) {
      logger.info(
        { fn: "runClassStrategy", strategyName: input.strategy_name, strategyClass: input.strategy_class },
        "Skipped: pipeline paused",
      );
      return { skipped: true, reason: "pipeline_paused", strategyId: null, backtestId: null, status: "skipped", tier: null, forgeScore: null };
    }

    // 1. Insert strategy into DB
    const [strategy] = await db
      .insert(strategies)
      .values({
        name: input.strategy_name,
        description: input.description,
        symbol: input.symbol,
        timeframe: input.timeframe,
        config: {
          strategy_class: input.strategy_class,
          params: input.params,
          source: input.source,
        },
        tags: [input.source, "class-based"],
      })
      .returning();

    const strategyId = strategy.id;

    // 2. Build minimal config (class-based path only needs dates + fees)
    const backtestConfig = {
      strategy: {
        name: input.strategy_name,
        symbol: input.symbol,
        timeframe: input.timeframe,
        indicators: [],
        entry_long: "",
        entry_short: "",
        exit: "",
        stop_loss: { type: "atr" as const, multiplier: 2.0 },
        position_size: { type: "dynamic_atr" as const, target_risk_dollars: 500 },
      },
      start_date: input.start_date,
      end_date: input.end_date,
      mode: "walkforward" as const,
    };

    // 3. Run backtest with strategy class path
    const result = await runBacktest(strategyId, backtestConfig, input.strategy_class, undefined, correlationId);

    const tier = "tier" in result ? result.tier : null;
    const forgeScore = "forge_score" in result ? result.forge_score : null;

    // 4. Log to systemJournal
    await db.insert(systemJournal).values({
      strategyId,
      backtestId: result.id,
      source: input.source,
      generationPrompt: input.description,
      strategyParams: input.params,
      forgeScore: forgeScore != null ? String(forgeScore) : null,
      tier: tier ?? null,
      status: result.status === "completed" ? "tested" : "failed",
    });

    // 5. Audit log
    await db.insert(auditLog).values({
      action: "agent.run-class-strategy",
      entityType: "strategy",
      entityId: strategyId,
      input: { strategy_name: input.strategy_name, strategy_class: input.strategy_class, source: input.source },
      result: {
        backtestId: result.id,
        status: result.status,
        tier,
        forge_score: forgeScore,
      },
      status: result.status === "completed" ? "success" : "failure",
      decisionAuthority: "agent",
      errorMessage: result.status !== "completed" ? (result as any).error ?? "backtest failed" : undefined,
    });

    logger.info({ strategyId, backtestId: result.id, tier, strategyClass: input.strategy_class }, "Class strategy run complete");

    return {
      strategyId,
      backtestId: result.id,
      status: result.status,
      tier,
      forgeScore,
    };
    } catch (err) {
      // C4: Capture top-level runClassStrategy failures to DLQ — they are otherwise
      // absorbed by the route layer's fire-and-forget .catch() with only a log.
      const errorMsg = err instanceof Error ? err.message : String(err);
      await captureToDLQ({
        operationType: "agent:run_class_strategy_failure",
        entityType: "strategy",
        errorMessage: errorMsg,
        metadata: {
          strategy_name: input.strategy_name,
          strategy_class: input.strategy_class,
          source: input.source,
          symbol: input.symbol,
          timeframe: input.timeframe,
        },
      }).catch((dlqErr) => logger.error({ dlqErr }, "DLQ capture failed (runClassStrategy)"));
      throw err;
    }
  }

  async critiqueResults(input: CritiqueInput) {
    const model = input.model ?? "fast";
    let metricsText: string;

    if (input.results) {
      metricsText = JSON.stringify(input.results, null, 2);
    } else if (input.backtestId) {
      const [bt] = await db.select().from(backtests).where(eq(backtests.id, input.backtestId));
      if (!bt) throw new Error(`Backtest ${input.backtestId} not found`);
      metricsText = JSON.stringify({
        sharpeRatio: bt.sharpeRatio,
        profitFactor: bt.profitFactor,
        winRate: bt.winRate,
        maxDrawdown: bt.maxDrawdown,
        avgDailyPnl: bt.avgDailyPnl,
        totalTrades: bt.totalTrades,
        totalReturn: bt.totalReturn,
        tier: bt.tier,
        forgeScore: bt.forgeScore,
      }, null, 2);
    } else {
      throw new Error("Either backtestId or results must be provided");
    }

    const prompt = `You are a quantitative analyst reviewing backtest results for a futures trading strategy.

RESULTS:
${metricsText}

SCORING CRITERIA:
- Avg daily P&L >= $250, Win rate >= 60%, Profit factor >= 1.75
- Max drawdown <= $2,000 (Topstep 50K limit)
- Sharpe ratio >= 1.5

Respond in strict JSON:
{
  "strengths": ["string", ...],
  "weaknesses": ["string", ...],
  "suggestions": ["string", ...],
  "overall_assessment": "string"
}`;

    let critique: { strengths: string[]; weaknesses: string[]; suggestions: string[]; overall_assessment: string };

    // Try cloud model first (GPT-5-mini for critic evaluation)
    const cloudResult = await callOpenAI("critic_evaluator", [
      { role: "user", content: prompt }
    ]);

    if (cloudResult) {
      // Parse cloud response
      try {
        critique = JSON.parse(cloudResult);
      } catch {
        critique = { strengths: [], weaknesses: [], suggestions: [], overall_assessment: cloudResult };
      }
    } else {
      // Fallback to Ollama
      const response = await this.ollama.generate(model, prompt, undefined, true);
      try {
        critique = JSON.parse(response.response);
      } catch {
        critique = {
          strengths: [],
          weaknesses: [],
          suggestions: [],
          overall_assessment: response.response,
        };
      }
    }

    if (input.backtestId) {
      await db
        .update(systemJournal)
        .set({ analystNotes: JSON.stringify(critique) })
        .where(eq(systemJournal.backtestId, input.backtestId));
    }

    return { critique };
  }

  async batchSubmit(strategyInputs: RunStrategyInput[]) {
    if (strategyInputs.length > 20) {
      throw new Error("Maximum 20 strategies per batch");
    }

    // ─── Pipeline pause guard ─────────────────────────────────────
    // Block the whole batch when pipeline is PAUSED/VACATION. Individual
    // runStrategy() calls also guard, but failing fast here avoids the
    // per-strategy DB writes a no-op batch would otherwise produce.
    if (!(await isPipelineActive())) {
      logger.info(
        { fn: "batchSubmit", count: strategyInputs.length },
        "Skipped: pipeline paused",
      );
      return { skipped: true, reason: "pipeline_paused", count: 0, results: [] };
    }

    const results: Array<{ strategy_name: string; status: string; strategyId?: string | null; backtestId?: string | null; error?: string }> = [];

    for (const input of strategyInputs) {
      try {
        const result = await this.runStrategy(input);
        results.push({
          strategy_name: input.strategy_name,
          status: result.status,
          strategyId: result.strategyId,
          backtestId: result.backtestId,
        });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        results.push({
          strategy_name: input.strategy_name,
          status: "failed",
          error: errorMsg,
        });
        // Capture individual batch strategy failures to DLQ — they are otherwise absorbed silently
        captureToDLQ({
          operationType: "agent:batch_strategy_failure",
          entityType: "strategy",
          errorMessage: errorMsg,
          metadata: {
            strategy_name: input.strategy_name,
            source: input.source,
            symbol: input.symbol,
          },
        }).catch((dlqErr) => {
          logger.warn({ err: dlqErr, strategy_name: input.strategy_name }, "Failed to capture batch failure to DLQ");
        });
      }
    }

    return { count: results.length, results };
  }

  async scoutIdeas(ideas: ScoutIdea[]) {
    const receivedCount = ideas.length;

    // Phase 0: Preprocessing — filter, clean, extract metadata
    const htmlEntityMap: Record<string, string> = {
      "&amp;": "&", "&lt;": "<", "&gt;": ">",
      "&quot;": '"', "&#39;": "'", "&apos;": "'",
      "&#x2F;": "/", "&#x27;": "'",
    };
    const stripHtmlEntities = (s: string) =>
      s.replace(/&[#\w]+;/g, (match) => htmlEntityMap[match] || match);

    const titleSuffixPattern = /\s*[-|]\s*(Reddit|YouTube|TradingView)|\[[^\]]*\]/gi;
    const instrumentPattern = /(MES|MNQ|MCL|ES|NQ|CL)\b/gi;
    const indicatorPattern = /(VWAP|RSI|SMA|EMA|MACD|ATR|Bollinger|ORB|Order Block|FVG|ICT|SMC)\b/gi;

    ideas = ideas
      .filter((idea) => (idea.confidence_score ?? 1) >= 0.3)
      .map((idea) => {
        // Strip HTML entities
        const title = stripHtmlEntities(idea.title || "");
        const rawDescription = stripHtmlEntities(idea.description || "");

        // Clean title suffixes
        const cleanTitle = title.replace(titleSuffixPattern, "").trim();

        // Empty description fallback
        const description = rawDescription || idea.summary || cleanTitle || "No description";

        // Extract instruments from title + description (only if not already populated)
        const combined = `${cleanTitle} ${description}`;
        let instruments = idea.instruments;
        if (!instruments || instruments.length === 0) {
          const instrumentMatches = combined.match(instrumentPattern) || [];
          const extracted = [
            ...new Set(instrumentMatches.map((m) => m.toUpperCase())),
          ];
          if (extracted.length > 0) instruments = extracted;
        }

        // Extract indicators from title + description (only if not already populated)
        let indicators_mentioned = idea.indicators_mentioned;
        if (!indicators_mentioned || indicators_mentioned.length === 0) {
          const indicatorMatches = combined.match(indicatorPattern) || [];
          const extracted = [...new Set(indicatorMatches)];
          if (extracted.length > 0) indicators_mentioned = extracted;
        }

        return {
          ...idea,
          title: cleanTitle,
          description,
          instruments,
          indicators_mentioned,
        };
      });

    // Phase 1: Batch-level dedup (in-memory)
    const seen = new Set<string>();
    const batchDeduped: Array<ScoutIdea & { title_hash: string }> = [];
    let batchDuplicateCount = 0;

    for (const idea of ideas) {
      const hash = createHash("sha256")
        .update(idea.title + idea.description)
        .digest("hex");

      if (seen.has(hash)) {
        batchDuplicateCount++;
        continue;
      }
      seen.add(hash);
      batchDeduped.push({ ...idea, title_hash: hash });
    }

    // Phase 2: Cross-time dedup — check system_journal for existing scouted entries
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const existingEntries = await db
      .select({
        titleHash: sql<string>`strategy_params->>'title_hash'`,
        url: sql<string>`strategy_params->>'url'`,
      })
      .from(systemJournal)
      .where(
        and(
          eq(systemJournal.status, "scouted"),
          gte(systemJournal.createdAt, thirtyDaysAgo),
        )
      );

    const existingHashes = new Set(existingEntries.map((e) => e.titleHash).filter(Boolean));
    const existingUrls = new Set(existingEntries.map((e) => e.url).filter(Boolean));

    const newIdeas: Array<ScoutIdea & { title_hash: string }> = [];
    let crossTimeDuplicateCount = 0;

    for (const idea of batchDeduped) {
      if (existingHashes.has(idea.title_hash)) {
        crossTimeDuplicateCount++;
        continue;
      }
      if (idea.url && existingUrls.has(idea.url)) {
        crossTimeDuplicateCount++;
        continue;
      }
      newIdeas.push(idea);
    }

    // Phase 3: Insert new ideas
    const ideaIds: string[] = [];

    for (const idea of newIdeas) {
      const [entry] = await db
        .insert(systemJournal)
        .values({
          source: idea.source,
          generationPrompt: idea.summary ?? idea.description,
          strategyCode: null,
          strategyParams: {
            title: idea.title,
            url: idea.url,
            title_hash: idea.title_hash,
            source_quality: idea.source_quality,
            confidence_score: idea.confidence_score,
            instruments: idea.instruments,
            indicators_mentioned: idea.indicators_mentioned,
          },
          status: "scouted",
        })
        .returning();
      ideaIds.push(entry.id);
    }

    return {
      received: receivedCount,
      new_count: newIdeas.length,
      batch_duplicate_count: batchDuplicateCount,
      cross_time_duplicate_count: crossTimeDuplicateCount,
      idea_ids: ideaIds,
    };
  }

  /**
   * Query recent journal entries for failure patterns to inject into strategy generation.
   * Returns an "AVOID" list derived from analyst critiques of recent failures.
   * Called by n8n before generating new strategies so the system learns from past mistakes.
   */
  async getFailurePatterns(days = 30, limit = 50): Promise<{
    avoidPatterns: string[];
    recentFailures: number;
    recentSuccesses: number;
  }> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    // Fetch recent journal entries that have analyst notes
    const entries = await db
      .select({
        tier: systemJournal.tier,
        status: systemJournal.status,
        analystNotes: systemJournal.analystNotes,
        forgeScore: systemJournal.forgeScore,
        source: systemJournal.source,
        generationPrompt: systemJournal.generationPrompt,
      })
      .from(systemJournal)
      .where(
        and(
          gte(systemJournal.createdAt, cutoff),
          sql`${systemJournal.analystNotes} IS NOT NULL`,
        ),
      )
      .orderBy(desc(systemJournal.createdAt))
      .limit(limit);

    const avoidPatterns: string[] = [];
    let recentFailures = 0;
    let recentSuccesses = 0;

    for (const entry of entries) {
      const isFailure = entry.tier === "REJECTED" || entry.status === "failed";
      if (isFailure) recentFailures++;
      else recentSuccesses++;

      if (!isFailure || !entry.analystNotes) continue;

      // Extract weaknesses and suggestions from analyst critique
      try {
        const critique = JSON.parse(entry.analystNotes);
        if (Array.isArray(critique.weaknesses)) {
          for (const w of critique.weaknesses) {
            if (typeof w === "string" && w.length > 10) {
              avoidPatterns.push(w);
            }
          }
        }
        if (Array.isArray(critique.suggestions)) {
          for (const s of critique.suggestions) {
            if (typeof s === "string" && s.length > 10) {
              avoidPatterns.push(s);
            }
          }
        }
      } catch {
        // analystNotes might be plain text — use directly
        if (entry.analystNotes.length > 20) {
          avoidPatterns.push(entry.analystNotes);
        }
      }
    }

    // Deduplicate and limit to most relevant patterns
    const unique = [...new Set(avoidPatterns)].slice(0, 20);

    logger.info({
      patterns: unique.length,
      recentFailures,
      recentSuccesses,
    }, "Failure patterns extracted for strategy generation");

    return {
      avoidPatterns: unique,
      recentFailures,
      recentSuccesses,
    };
  }

  /**
   * Drain scouted-but-unbacktested ideas from system_journal after a pause/vacation lift.
   *
   * Triggered by the scheduler's `pipeline-resume-drain` job when it detects a
   * transition from PAUSED/VACATION → ACTIVE. Walks scouted ideas (oldest first)
   * and converts each into a strategy via Ollama → runStrategy(), the same path
   * n8n's `8A-idea-to-strategy` workflow uses.
   *
   * Rate limit: max `limit` per call (default 100). Caller is responsible for
   * batching across multiple ticks if backlog exceeds the cap.
   *
   * Returns drain stats so the scheduler can write an audit row.
   */
  async drainScoutedIdeas(limit = 100): Promise<{
    scanned: number;
    drained: number;
    failed: number;
    errors: string[];
  }> {
    // Don't drain if pipeline isn't active — the scheduler should have checked,
    // but defend against race where mode flips back during drain start.
    if (!(await isPipelineActive())) {
      logger.info({ fn: "drainScoutedIdeas" }, "Skipped: pipeline not ACTIVE");
      return { scanned: 0, drained: 0, failed: 0, errors: ["pipeline_not_active"] };
    }

    // Find scouted-but-unbacktested ideas (no strategyId yet)
    const scouted = await db
      .select()
      .from(systemJournal)
      .where(
        and(
          eq(systemJournal.status, "scouted"),
          isNull(systemJournal.strategyId),
        ),
      )
      .orderBy(systemJournal.createdAt)
      .limit(limit);

    if (scouted.length === 0) {
      return { scanned: 0, drained: 0, failed: 0, errors: [] };
    }

    logger.info({ count: scouted.length, limit }, "Pipeline-resume drain: starting scouted-idea drain");

    let drained = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const entry of scouted) {
      // Re-check pause flag every iteration — operator may pause again mid-drain.
      if (!(await isPipelineActive())) {
        logger.info({ fn: "drainScoutedIdeas", processed: drained }, "Pipeline paused mid-drain — stopping");
        break;
      }

      const params = (entry.strategyParams as Record<string, unknown> | null) ?? {};
      const title = String(params.title ?? "untitled");
      const description = entry.generationPrompt ?? title;

      try {
        // M3+M4+M5 fix — generate canonical StrategyDSL (not python_code) and route
        // through runStrategyFromDSL → Python compiler → real backtest config.
        // Old prompt asked for python_code which the engine never executed.
        const prompt = `You are a quantitative trading strategy architect. Convert this trading idea into a Trading Forge StrategyDSL.

Trading Idea:
Title: ${title}
Description: ${String(description).slice(0, 500)}
Source: ${entry.source ?? "unknown"}

Output ONLY a JSON object matching this StrategyDSL schema. No markdown fences, no prose.

REQUIRED FIELDS:
- name (string, snake_case, 3-100 chars)
- description (string, 10-500 chars, one-sentence edge thesis)
- symbol (one of: "MES", "MNQ", "MCL")
- timeframe (one of: "1m", "5m", "15m", "30m", "1h", "4h", "1d")
- direction (one of: "long", "short", "both")
- entry_type (one of: "breakout", "mean_reversion", "trend_follow", "volatility_expansion", "session_pattern")
- entry_indicator (one of these supported patterns):
    sma_crossover, ema_crossover, rsi_reversal, bollinger_breakout, atr_breakout,
    vwap_reversion, donchian_breakout, keltner_squeeze, session_open_breakout, macd_crossover
- entry_params (object, max 5 numeric keys, valid for the chosen entry_indicator)
- entry_condition (string, plain English entry rule)
- exit_type (one of: "fixed_target", "trailing_stop", "time_exit", "indicator_signal", "atr_multiple")
- exit_params (object)
- stop_loss_atr_multiple (number, 0.5 to 5.0)

OPTIONAL FIELDS:
- take_profit_atr_multiple (number, 1.0 to 10.0)
- preferred_regime (one of: "TRENDING_UP", "TRENDING_DOWN", "RANGE_BOUND", "HIGH_VOL", "LOW_VOL")
- session_filter (one of: "RTH_ONLY", "ETH_ONLY", "ALL_SESSIONS", "LONDON", "ASIA")
- max_contracts (integer, 1-20)

Rules:
- max 5 entry_params
- stop_loss_atr_multiple < take_profit_atr_multiple
- Match entry_type to entry_indicator logically
- Output ONLY the JSON object`;

        const response = await this.ollama.generate("trading-quant", prompt, undefined, true);
        let dsl: Record<string, unknown>;
        try {
          dsl = JSON.parse(response.response);
        } catch {
          failed++;
          errors.push(`${entry.id}: invalid JSON from Ollama`);
          continue;
        }

        // Validate canonical DSL required fields before sending to compiler
        const required = [
          "name", "description", "symbol", "timeframe", "direction",
          "entry_type", "entry_indicator", "entry_params", "entry_condition",
          "exit_type", "exit_params", "stop_loss_atr_multiple",
        ];
        const missing = required.filter((f) => !(f in dsl));
        if (missing.length > 0) {
          failed++;
          errors.push(`${entry.id}: missing DSL fields ${missing.join(",")}`);
          continue;
        }

        // M5 fix — coerce provider source to legacy enum runStrategyFromDSL accepts
        const rawSource = String(entry.source ?? "openclaw");
        const mappedSource: "ollama" | "openclaw" | "manual" =
          rawSource === "ollama" || rawSource === "manual" ? rawSource : "openclaw";

        // M3 fix — route through Python compiler → real backtest config
        const result = await this.runStrategyFromDSL(dsl, { source: mappedSource });

        // Link the journal entry to the new strategy (so it stops appearing in drain queue)
        if (result.strategyId) {
          await db
            .update(systemJournal)
            .set({ strategyId: result.strategyId, status: result.status === "completed" ? "tested" : "failed" })
            .where(eq(systemJournal.id, entry.id));
          drained++;
        } else if (result.status === "compile_failed") {
          failed++;
          errors.push(`${entry.id}: compile failed: ${(result.compileErrors ?? []).slice(0, 2).join("; ")}`);
        } else {
          failed++;
          errors.push(`${entry.id}: ${result.status ?? "unknown"}${result.skipped ? " (re-paused)" : ""}`);
        }
      } catch (err) {
        failed++;
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${entry.id}: ${msg}`);
        logger.warn({ err, entryId: entry.id }, "Pipeline-resume drain: idea conversion failed");
      }
    }

    logger.info(
      { scanned: scouted.length, drained, failed },
      "Pipeline-resume drain: completed",
    );

    return {
      scanned: scouted.length,
      drained,
      failed,
      errors: errors.slice(0, 20),
    };
  }
}
