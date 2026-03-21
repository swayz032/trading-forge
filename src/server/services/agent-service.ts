import { createHash } from "crypto";
import { eq, and, gte, sql, inArray, desc } from "drizzle-orm";
import { db } from "../db/index.js";
import { strategies, systemJournal, auditLog } from "../db/schema.js";
import { runBacktest } from "./backtest-service.js";
import { OllamaClient } from "./ollama-client.js";
import { GraveyardGate } from "./graveyard-gate.js";
import { logger } from "../index.js";

const SYMBOLS = ["ES", "NQ", "CL", "YM", "RTY", "GC", "MES", "MNQ", "MCL", "MGC"] as const;
type Symbol = (typeof SYMBOLS)[number];

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

  async runStrategy(input: RunStrategyInput) {
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

    // 1. Insert strategy into DB
    const [strategy] = await db
      .insert(strategies)
      .values({
        name: input.strategy_name,
        description: input.one_sentence,
        symbol: input.symbol,
        timeframe: input.timeframe,
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
    const result = await runBacktest(strategyId, backtestConfig);

    const tier = "tier" in result ? result.tier : null;
    const forgeScore = "forge_score" in result ? result.forge_score : null;

    // 4. Log to systemJournal
    await db.insert(systemJournal).values({
      strategyId,
      backtestId: result.id,
      source: input.source,
      generationPrompt: input.one_sentence,
      strategyCode: input.python_code,
      strategyParams: input.params,
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
      },
      status: result.status === "completed" ? "success" : "failure",
    });

    logger.info({ strategyId, backtestId: result.id, tier }, "Agent strategy run complete");

    return {
      strategyId,
      backtestId: result.id,
      status: result.status,
      tier,
      forgeScore,
    };
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
  }) {
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
    const result = await runBacktest(strategyId, backtestConfig, input.strategy_class);

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
    });

    logger.info({ strategyId, backtestId: result.id, tier, strategyClass: input.strategy_class }, "Class strategy run complete");

    return {
      strategyId,
      backtestId: result.id,
      status: result.status,
      tier,
      forgeScore,
    };
  }

  async critiqueResults(input: CritiqueInput) {
    const model = input.model ?? "fast";
    let metricsText: string;

    if (input.results) {
      metricsText = JSON.stringify(input.results, null, 2);
    } else if (input.backtestId) {
      throw new Error("backtestId lookup not yet implemented — pass results directly");
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

    const response = await this.ollama.generate(model, prompt, undefined, true);

    let critique: { strengths: string[]; weaknesses: string[]; suggestions: string[]; overall_assessment: string };
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
        results.push({
          strategy_name: input.strategy_name,
          status: "failed",
          error: err instanceof Error ? err.message : String(err),
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
    const instrumentPattern = /(ES|NQ|CL)\b/gi;
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
}
