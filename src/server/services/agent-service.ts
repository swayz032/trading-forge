import { createHash } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { strategies, systemJournal, auditLog } from "../db/schema.js";
import { runBacktest } from "./backtest-service.js";
import { OllamaClient } from "./ollama-client.js";
import { logger } from "../index.js";

const SYMBOLS = ["ES", "NQ", "CL", "YM", "RTY", "GC", "MES", "MNQ"] as const;
type Symbol = (typeof SYMBOLS)[number];

export interface RunStrategyInput {
  strategy_name: string;
  one_sentence: string;
  python_code: string;
  params: Record<string, unknown>;
  symbol: Symbol;
  timeframe: string;
  start_date: string;
  end_date: string;
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
}

export class AgentService {
  private ollama: OllamaClient;

  constructor(ollamaClient?: OllamaClient) {
    this.ollama = ollamaClient ?? new OllamaClient();
  }

  async runStrategy(input: RunStrategyInput) {
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

  async critiqueResults(input: CritiqueInput) {
    const model = input.model ?? "llama3:8b";
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

    const response = await this.ollama.generate(model, prompt);

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

    const results: Array<{ strategy_name: string; status: string; strategyId?: string; backtestId?: string; error?: string }> = [];

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
    const seen = new Set<string>();
    const newIdeas: ScoutIdea[] = [];
    let duplicateCount = 0;

    for (const idea of ideas) {
      const hash = createHash("sha256")
        .update(idea.title + idea.description)
        .digest("hex");

      if (seen.has(hash)) {
        duplicateCount++;
        continue;
      }
      seen.add(hash);
      newIdeas.push(idea);
    }

    const ideaIds: string[] = [];

    for (const idea of newIdeas) {
      const [entry] = await db
        .insert(systemJournal)
        .values({
          source: idea.source,
          generationPrompt: idea.summary ?? idea.description,
          strategyCode: null,
          strategyParams: { title: idea.title, url: idea.url },
          status: "scouted",
        })
        .returning();
      ideaIds.push(entry.id);
    }

    return {
      received: ideas.length,
      new_count: newIdeas.length,
      duplicate_count: duplicateCount,
      idea_ids: ideaIds,
    };
  }
}
