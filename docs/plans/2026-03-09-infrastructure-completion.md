# Infrastructure Completion: Pre-Phase 0 + Phase 0 + Phase 1 Gaps

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Ollama integration (Modelfile + HTTP client + agent service + webhook routes), n8n workflows via MCP, and Lambda data fetch CDK stack.

**Architecture:** Agent routes at `/api/agent/*` receive requests from n8n, delegate to agent-service which bridges Ollama (strategy generation/critique) with the existing backtest engine (Python subprocess) and persists to DB. n8n workflows orchestrate the full loop (generate -> backtest -> critique -> journal). A CDK stack deploys Lambda + EventBridge for nightly data fetch.

**Tech Stack:** Express 5, Zod, Drizzle ORM, Vitest, Ollama REST API, n8n MCP, AWS CDK

**Subagent dispatch:**
- Task 1: `local-dev-optimizer` — Ollama Modelfile + GPU config
- Task 5: `n8n-production-architect` — One per workflow (4 total, 2 parallel batches)
- Tasks 2-4: `subagent-driven-development` — TDD implementation
- Task 6: General agent — CDK stack

---

## Task 1: Ollama Trading-Quant Modelfile

**Subagent:** `local-dev-optimizer`

**Files:**
- Create: `ollama/Modelfile.trading-quant`

**Step 1: Create Modelfile**

```dockerfile
FROM qwen3-coder:30b

SYSTEM """You are a quantitative strategy generator for futures trading. You write vectorbt Python code.

RULES:
- Max 5 parameters per strategy
- Strategy must be describable in one sentence
- Use only proven edges: trend following, mean reversion, volatility expansion, session patterns
- Include ATR-based slippage modeling
- Use walk-forward validation
- Score against prop firm rules: $2K max drawdown for Topstep 50K, target $250/day avg, 60%+ win days, profit factor >= 1.75
- NO black-box ML for entries/exits
- NO ICT/SMC concepts

OUTPUT FORMAT (strict JSON):
{
  "strategy_name": "string",
  "one_sentence": "string",
  "edge_hypothesis": "string",
  "params": {"param1": value, ...},
  "python_code": "string (valid vectorbt Python)",
  "expected_metrics": {
    "avg_daily_pnl": number,
    "win_rate": number,
    "profit_factor": number,
    "max_drawdown": number,
    "sharpe_ratio": number
  }
}
"""

PARAMETER num_ctx 8192
PARAMETER temperature 0.7
PARAMETER num_gpu 35
```

**Step 2: Build model**

Run: `ollama create trading-quant -f ollama/Modelfile.trading-quant`
Expected: Success message, model appears in `ollama list`

**Step 3: Smoke test**

Run: `ollama run trading-quant "Generate a mean reversion strategy for ES 15min using Bollinger Bands"`
Expected: JSON output with strategy_name, python_code, etc.

**Step 4: Commit**

```bash
git add ollama/Modelfile.trading-quant
git commit -m "feat: add trading-quant Ollama modelfile (qwen3-coder:30b)"
```

---

## Task 2: Ollama HTTP Client Service

**Files:**
- Create: `src/server/services/ollama-client.ts`
- Create: `src/server/services/ollama-client.test.ts`
- Modify: `.env.example` (add OLLAMA_HOST)

**Step 1: Write the failing tests**

Create `src/server/services/ollama-client.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OllamaClient } from "./ollama-client.js";

describe("OllamaClient", () => {
  let client: OllamaClient;

  beforeEach(() => {
    client = new OllamaClient("http://localhost:11434");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("generate", () => {
    it("sends correct request to /api/generate", async () => {
      const mockResponse = { response: "test output" };
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), { status: 200 })
      );

      const result = await client.generate("trading-quant", "Generate a strategy");

      expect(fetch).toHaveBeenCalledWith(
        "http://localhost:11434/api/generate",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "trading-quant",
            prompt: "Generate a strategy",
            stream: false,
          }),
        })
      );
      expect(result).toEqual(mockResponse);
    });

    it("passes options through to request body", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ response: "ok" }), { status: 200 })
      );

      await client.generate("trading-quant", "test", { temperature: 0.5, num_ctx: 4096 });

      expect(fetch).toHaveBeenCalledWith(
        "http://localhost:11434/api/generate",
        expect.objectContaining({
          body: JSON.stringify({
            model: "trading-quant",
            prompt: "test",
            stream: false,
            options: { temperature: 0.5, num_ctx: 4096 },
          }),
        })
      );
    });

    it("throws on network error (Ollama unreachable)", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("fetch failed"));

      await expect(client.generate("trading-quant", "test")).rejects.toThrow(
        "Ollama unreachable at http://localhost:11434: fetch failed"
      );
    });

    it("throws on non-200 response", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response("model not found", { status: 404 })
      );

      await expect(client.generate("bad-model", "test")).rejects.toThrow(
        "Ollama error 404"
      );
    });

    it("throws on malformed JSON response", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response("not json", { status: 200 })
      );

      await expect(client.generate("trading-quant", "test")).rejects.toThrow(
        "Failed to parse Ollama response"
      );
    });
  });

  describe("chat", () => {
    it("sends correct request to /api/chat", async () => {
      const mockResponse = { message: { role: "assistant", content: "critique here" } };
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), { status: 200 })
      );

      const messages = [{ role: "user" as const, content: "Review these results" }];
      const result = await client.chat("llama3:8b", messages);

      expect(fetch).toHaveBeenCalledWith(
        "http://localhost:11434/api/chat",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            model: "llama3:8b",
            messages,
            stream: false,
          }),
        })
      );
      expect(result).toEqual(mockResponse);
    });
  });

  describe("defaults", () => {
    it("uses default host when not specified", () => {
      const defaultClient = new OllamaClient();
      expect(defaultClient.baseUrl).toBe("http://localhost:11434");
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/server/services/ollama-client.test.ts`
Expected: FAIL — module not found

**Step 3: Implement ollama-client.ts**

Create `src/server/services/ollama-client.ts`:

```typescript
export interface GenerateResponse {
  response: string;
  [key: string]: unknown;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatResponse {
  message: { role: string; content: string };
  [key: string]: unknown;
}

export interface OllamaOptions {
  temperature?: number;
  num_ctx?: number;
  num_gpu?: number;
  [key: string]: unknown;
}

export class OllamaClient {
  public readonly baseUrl: string;
  private timeoutMs: number;

  constructor(baseUrl?: string, timeoutMs = 120_000) {
    this.baseUrl = baseUrl ?? process.env.OLLAMA_HOST ?? "http://localhost:11434";
    this.timeoutMs = timeoutMs;
  }

  async generate(model: string, prompt: string, options?: OllamaOptions): Promise<GenerateResponse> {
    const body: Record<string, unknown> = { model, prompt, stream: false };
    if (options) body.options = options;
    return this.request<GenerateResponse>("/api/generate", body);
  }

  async chat(model: string, messages: ChatMessage[], options?: OllamaOptions): Promise<ChatResponse> {
    const body: Record<string, unknown> = { model, messages, stream: false };
    if (options) body.options = options;
    return this.request<ChatResponse>("/api/chat", body);
  }

  private async request<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeout);
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Ollama unreachable at ${this.baseUrl}: ${msg}`);
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Ollama error ${res.status}: ${text}`);
    }

    try {
      return (await res.json()) as T;
    } catch {
      throw new Error("Failed to parse Ollama response");
    }
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/server/services/ollama-client.test.ts`
Expected: All 7 tests PASS

**Step 5: Update .env.example**

Add after the `LOG_LEVEL` line:

```
# Ollama — Local AI model server
OLLAMA_HOST=http://localhost:11434
```

**Step 6: Commit**

```bash
git add src/server/services/ollama-client.ts src/server/services/ollama-client.test.ts .env.example
git commit -m "feat: add Ollama HTTP client service with tests"
```

---

## Task 3: Agent Service Layer

**Files:**
- Create: `src/server/services/agent-service.ts`
- Create: `src/server/services/agent-service.test.ts`

**Step 1: Write the failing tests**

Create `src/server/services/agent-service.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies before import
vi.mock("../db/index.js", () => ({
  db: {
    insert: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([{ id: "strategy-uuid-1" }]),
    limit: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("./backtest-service.js", () => ({
  runBacktest: vi.fn().mockResolvedValue({
    id: "backtest-uuid-1",
    status: "completed",
    total_return: 0.15,
    sharpe_ratio: 2.1,
    max_drawdown: -1500,
    win_rate: 0.65,
    profit_factor: 2.3,
    total_trades: 100,
    avg_trade_pnl: 150,
    avg_daily_pnl: 350,
    tier: "TIER_1",
    forge_score: 85,
    equity_curve: [100, 105, 110],
    trades: [],
    daily_pnls: [200, -100, 300],
    execution_time_ms: 5000,
  }),
}));

vi.mock("./ollama-client.js", () => ({
  OllamaClient: vi.fn().mockImplementation(() => ({
    generate: vi.fn().mockResolvedValue({
      response: JSON.stringify({
        strengths: ["Good Sharpe ratio"],
        weaknesses: ["Small sample size"],
        suggestions: ["Test more timeframes"],
        overall_assessment: "Promising but needs validation",
      }),
    }),
  })),
}));

vi.mock("../index.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import { AgentService } from "./agent-service.js";
import { runBacktest } from "./backtest-service.js";
import { db } from "../db/index.js";

describe("AgentService", () => {
  let service: AgentService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AgentService();
  });

  describe("runStrategy", () => {
    it("inserts strategy, calls runBacktest, logs to audit", async () => {
      // Mock the chain: insert().values().returning()
      const mockReturning = vi.fn().mockResolvedValue([{ id: "strategy-uuid-1" }]);
      const mockValues = vi.fn().mockReturnValue({ returning: mockReturning });
      (db.insert as ReturnType<typeof vi.fn>).mockReturnValue({ values: mockValues });

      const input = {
        strategy_name: "BB Mean Reversion",
        one_sentence: "Buy when price touches lower BB on ES 15min",
        python_code: "import vectorbt as vbt\n# strategy code here",
        params: { period: 20, std_dev: 2.0 },
        symbol: "ES" as const,
        timeframe: "15min",
        start_date: "2024-01-01",
        end_date: "2024-12-31",
        source: "ollama" as const,
      };

      const result = await service.runStrategy(input);

      expect(mockValues).toHaveBeenCalled();
      expect(runBacktest).toHaveBeenCalledWith(
        "strategy-uuid-1",
        expect.objectContaining({
          strategy: expect.objectContaining({ name: "BB Mean Reversion", symbol: "ES" }),
        })
      );
      expect(result).toHaveProperty("strategyId", "strategy-uuid-1");
      expect(result).toHaveProperty("status", "completed");
    });
  });

  describe("critiqueResults", () => {
    it("formats prompt and returns structured critique", async () => {
      const result = await service.critiqueResults({
        results: {
          sharpe_ratio: 2.1,
          max_drawdown: -1500,
          win_rate: 0.65,
          profit_factor: 2.3,
          total_trades: 100,
          avg_daily_pnl: 350,
        },
      });

      expect(result.critique).toHaveProperty("strengths");
      expect(result.critique).toHaveProperty("weaknesses");
      expect(result.critique).toHaveProperty("suggestions");
      expect(result.critique).toHaveProperty("overall_assessment");
    });
  });

  describe("batchSubmit", () => {
    it("rejects batches over 20 strategies", async () => {
      const strategies = Array.from({ length: 21 }, (_, i) => ({
        strategy_name: `Strategy ${i}`,
        one_sentence: "test",
        python_code: "pass",
        params: {},
        symbol: "ES" as const,
        timeframe: "15min",
        start_date: "2024-01-01",
        end_date: "2024-12-31",
        source: "ollama" as const,
      }));

      await expect(service.batchSubmit(strategies)).rejects.toThrow("Maximum 20 strategies per batch");
    });

    it("processes strategies sequentially", async () => {
      const mockReturning = vi.fn().mockResolvedValue([{ id: "s-1" }]);
      const mockValues = vi.fn().mockReturnValue({ returning: mockReturning });
      (db.insert as ReturnType<typeof vi.fn>).mockReturnValue({ values: mockValues });

      const strategies = [
        {
          strategy_name: "Strat A",
          one_sentence: "test A",
          python_code: "pass",
          params: {},
          symbol: "ES" as const,
          timeframe: "15min",
          start_date: "2024-01-01",
          end_date: "2024-12-31",
          source: "ollama" as const,
        },
        {
          strategy_name: "Strat B",
          one_sentence: "test B",
          python_code: "pass",
          params: {},
          symbol: "NQ" as const,
          timeframe: "15min",
          start_date: "2024-01-01",
          end_date: "2024-12-31",
          source: "ollama" as const,
        },
      ];

      const result = await service.batchSubmit(strategies);

      expect(result.count).toBe(2);
      expect(result.results).toHaveLength(2);
    });
  });

  describe("scoutIdeas", () => {
    it("deduplicates by content hash", async () => {
      // Mock select to return empty (no existing entries)
      const mockLimit = vi.fn().mockResolvedValue([]);
      const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit });
      const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
      (db.select as ReturnType<typeof vi.fn>).mockReturnValue({ from: mockFrom });

      const mockReturning = vi.fn().mockResolvedValue([{ id: "idea-1" }]);
      const mockValues = vi.fn().mockReturnValue({ returning: mockReturning });
      (db.insert as ReturnType<typeof vi.fn>).mockReturnValue({ values: mockValues });

      const ideas = [
        { source: "openclaw", title: "RSI Strategy", description: "Buy when RSI < 30" },
        { source: "openclaw", title: "RSI Strategy", description: "Buy when RSI < 30" }, // duplicate
      ];

      const result = await service.scoutIdeas(ideas);

      expect(result.received).toBe(2);
      expect(result.duplicate_count).toBe(1);
      expect(result.new_count).toBe(1);
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/server/services/agent-service.test.ts`
Expected: FAIL — module not found

**Step 3: Implement agent-service.ts**

Create `src/server/services/agent-service.ts`:

```typescript
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

    // 2. Build backtest config — use python_code path
    const backtestConfig = {
      strategy: {
        name: input.strategy_name,
        symbol: input.symbol,
        timeframe: input.timeframe,
        python_code: input.python_code,
        params: input.params,
        // Minimal structured fields for the engine to fall back on
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

    // 4. Log to systemJournal
    await db.insert(systemJournal).values({
      strategyId,
      backtestId: result.id,
      source: input.source,
      generationPrompt: input.one_sentence,
      strategyCode: input.python_code,
      strategyParams: input.params,
      forgeScore: result.forge_score != null ? String(result.forge_score) : null,
      tier: result.tier ?? null,
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
        tier: result.tier,
        forge_score: result.forge_score,
      },
      status: result.status === "completed" ? "success" : "failure",
    });

    logger.info({ strategyId, backtestId: result.id, tier: result.tier }, "Agent strategy run complete");

    return {
      strategyId,
      backtestId: result.id,
      status: result.status,
      tier: result.tier,
      forgeScore: result.forge_score,
    };
  }

  async critiqueResults(input: CritiqueInput) {
    const model = input.model ?? "llama3:8b";
    let metricsText: string;

    if (input.results) {
      metricsText = JSON.stringify(input.results, null, 2);
    } else if (input.backtestId) {
      // Lookup from DB would go here — for now require results
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
      // If Ollama didn't return valid JSON, wrap the text
      critique = {
        strengths: [],
        weaknesses: [],
        suggestions: [],
        overall_assessment: response.response,
      };
    }

    // Update journal if backtestId provided
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

    // Process sequentially to avoid GPU contention
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
          status: "scouted" as const,
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
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/server/services/agent-service.test.ts`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/server/services/agent-service.ts src/server/services/agent-service.test.ts
git commit -m "feat: add agent service layer (run, critique, batch, scout)"
```

---

## Task 4: Agent Webhook Routes

**Files:**
- Create: `src/server/routes/agent.ts`
- Modify: `src/server/index.ts` (register routes)

**Step 1: Implement agent.ts routes**

Create `src/server/routes/agent.ts`:

```typescript
import { Router } from "express";
import { z } from "zod";
import { AgentService } from "../services/agent-service.js";

export const agentRoutes = Router();
const agentService = new AgentService();

// ─── Validation Schemas ──────────────────────────────────────────

const symbolEnum = z.enum(["ES", "NQ", "CL", "YM", "RTY", "GC", "MES", "MNQ"]);

const runStrategySchema = z.object({
  strategy_name: z.string().min(1),
  one_sentence: z.string().min(1),
  python_code: z.string().min(1),
  params: z.record(z.unknown()).refine(
    (obj) => Object.keys(obj).length <= 5,
    { message: "Maximum 5 parameters" }
  ),
  symbol: symbolEnum,
  timeframe: z.string().min(1),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  source: z.enum(["ollama", "openclaw", "manual"]).default("ollama"),
});

const critiqueSchema = z
  .object({
    backtestId: z.string().uuid().optional(),
    results: z.record(z.unknown()).optional(),
    model: z.string().optional().default("llama3:8b"),
  })
  .refine((data) => data.backtestId || data.results, {
    message: "Either backtestId or results must be provided",
  });

const batchSchema = z.object({
  strategies: z.array(runStrategySchema).min(1).max(20),
});

const scoutIdeaSchema = z.object({
  source: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  url: z.string().url().optional(),
  summary: z.string().optional(),
});

const scoutSchema = z.object({
  ideas: z.array(scoutIdeaSchema).min(1),
});

// ─── POST /api/agent/run-strategy ────────────────────────────────

agentRoutes.post("/run-strategy", async (req, res) => {
  const parsed = runStrategySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  // Fire and forget
  agentService.runStrategy(parsed.data).catch(() => {
    // Error persisted to DB by service
  });

  res.status(202).json({ message: "Strategy submitted" });
});

// ─── POST /api/agent/critique ────────────────────────────────────

agentRoutes.post("/critique", async (req, res) => {
  const parsed = critiqueSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  try {
    const result = await agentService.critiqueResults(parsed.data);
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// ─── POST /api/agent/batch ───────────────────────────────────────

agentRoutes.post("/batch", async (req, res) => {
  const parsed = batchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  // Fire and forget
  agentService.batchSubmit(parsed.data.strategies).catch(() => {
    // Errors persisted per-strategy
  });

  res.status(202).json({ count: parsed.data.strategies.length, message: "Batch submitted" });
});

// ─── POST /api/agent/scout-ideas ─────────────────────────────────

agentRoutes.post("/scout-ideas", async (req, res) => {
  const parsed = scoutSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  try {
    const result = await agentService.scoutIdeas(parsed.data.ideas);
    res.status(201).json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});
```

**Step 2: Register routes in index.ts**

Add import after line 10 (after backtestRoutes import):

```typescript
import { agentRoutes } from "./routes/agent.js";
```

Add route after line 40 (after backtestRoutes):

```typescript
app.use("/api/agent", agentRoutes);
```

**Step 3: Type check + tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS

**Step 4: Commit**

```bash
git add src/server/routes/agent.ts src/server/index.ts
git commit -m "feat: add agent webhook routes (run-strategy, critique, batch, scout-ideas)"
```

---

## Task 5: n8n Trading Forge Workflows (via n8n MCP)

**Subagent:** `n8n-production-architect` — one per workflow

**No local files created.** All workflows built directly in n8n via MCP tools.

### Workflow 5A: Nightly Strategy Research Loop
- Schedule: `0 2 * * 1-5` (Mon-Fri 2 AM EST)
- Flow: Schedule → Ollama (trading-quant) → parse → POST /api/agent/batch → Wait 5m → GET backtests → Ollama (llama3:8b critique) → POST /api/agent/critique → POST /api/journal
- Tag: "trading-forge"

### Workflow 5B: Strategy Generation Loop (Webhook)
- Trigger: POST webhook at `/trading-forge/generate`
- Flow: Webhook → Ollama (trading-quant) → POST /api/agent/run-strategy → Wait 2m → GET backtest → IF tier !== REJECTED → journal / else → critique → refine (max 3 loops) → Respond
- Tag: "trading-forge"

### Workflow 5C: Weekly Strategy Hunt
- Schedule: `0 8 * * 6` (Saturday 8 AM EST)
- Flow: Schedule → Ollama 9 strategies (3 each ES/NQ/CL) → Split 3 at a time → POST /api/agent/batch → Wait 10m → GET backtests → filter TIER_1/TIER_2 → IF any → critique + journal + notify / else → log
- Tag: "trading-forge"

### Workflow 5D: Monthly Robustness Check
- Schedule: `0 6 1 * *` (1st of month 6 AM EST)
- Flow: Schedule → GET deployed strategies → Loop → POST /api/backtests (re-run) → Wait 3m → compare metrics → IF degraded → alert + journal / else → log healthy
- Tag: "trading-forge"

**Each subagent will:**
1. Invoke n8n skills (mcp-tools-expert, workflow-patterns, node-configuration, code-javascript, expression-syntax, validation-expert)
2. search_nodes → get_node → n8n_create_workflow → n8n_update_partial_workflow → n8n_validate_workflow → activate

---

## Task 6: Lambda + EventBridge (AWS CDK)

**Files:**
- Create: `infra/cdk/lib/data-fetch-stack.ts`
- Create: `infra/cdk/bin/app.ts`
- Create: `infra/cdk/cdk.json`
- Create: `infra/cdk/package.json`
- Create: `infra/cdk/tsconfig.json`
- Create: `infra/lambda/nightly-data-fetch/handler.py`
- Create: `infra/lambda/nightly-data-fetch/requirements.txt`

**Step 1: Create CDK project structure**

`infra/cdk/package.json`:
```json
{
  "name": "trading-forge-infra",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "build": "tsc",
    "synth": "cdk synth",
    "deploy": "cdk deploy"
  },
  "dependencies": {
    "aws-cdk-lib": "^2.170.0",
    "constructs": "^10.4.0"
  },
  "devDependencies": {
    "typescript": "~5.7.0"
  }
}
```

`infra/cdk/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "declaration": true,
    "strict": true,
    "outDir": "dist",
    "rootDir": ".",
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["bin/**/*.ts", "lib/**/*.ts"]
}
```

`infra/cdk/cdk.json`:
```json
{
  "app": "npx ts-node bin/app.ts"
}
```

`infra/cdk/bin/app.ts`:
```typescript
#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { DataFetchStack } from "../lib/data-fetch-stack";

const app = new cdk.App();
new DataFetchStack(app, "TradingForgeDataFetch", {
  env: { region: "us-east-1" },
});
```

**Step 2: Implement data-fetch-stack.ts**

`infra/cdk/lib/data-fetch-stack.ts`:
```typescript
import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as sns from "aws-cdk-lib/aws-sns";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

export class DataFetchStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const bucket = s3.Bucket.fromBucketName(this, "DataBucket", "trading-forge-data");

    const failureTopic = new sns.Topic(this, "DataFetchFailures", {
      topicName: "trading-forge-data-fetch-failures",
    });

    const fn = new lambda.Function(this, "NightlyDataFetch", {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: "handler.handler",
      code: lambda.Code.fromAsset("../../infra/lambda/nightly-data-fetch"),
      memorySize: 512,
      timeout: cdk.Duration.minutes(15),
      environment: {
        S3_BUCKET: "trading-forge-data",
        SYMBOLS: "ES,NQ,CL",
        SNS_TOPIC_ARN: failureTopic.topicArn,
      },
    });

    bucket.grantReadWrite(fn);
    failureTopic.grantPublish(fn);

    // Weekdays 7 AM UTC = 2 AM EST
    new events.Rule(this, "NightlySchedule", {
      schedule: events.Schedule.expression("cron(0 7 ? * MON-FRI *)"),
      targets: [new targets.LambdaFunction(fn)],
    });
  }
}
```

**Step 3: Implement Lambda handler**

`infra/lambda/nightly-data-fetch/handler.py`:
```python
"""Nightly data fetch Lambda — downloads latest daily bars via Massive API."""

import json
import os
from datetime import datetime, timedelta
from urllib.request import urlopen, Request
from urllib.error import URLError

import boto3

S3_BUCKET = os.environ.get("S3_BUCKET", "trading-forge-data")
SYMBOLS = os.environ.get("SYMBOLS", "ES,NQ,CL").split(",")
SNS_TOPIC_ARN = os.environ.get("SNS_TOPIC_ARN", "")
MASSIVE_BASE_URL = "https://api.massive.app/v1"

s3 = boto3.client("s3")
sns = boto3.client("sns")


def handler(event, context):
    """Fetch yesterday's daily bars for each configured symbol."""
    yesterday = (datetime.utcnow() - timedelta(days=1)).strftime("%Y-%m-%d")
    results = []
    failures = []

    for symbol in SYMBOLS:
        try:
            data = fetch_daily_bar(symbol, yesterday)
            s3_key = f"daily/{symbol}/{yesterday}.json"
            s3.put_object(
                Bucket=S3_BUCKET,
                Key=s3_key,
                Body=json.dumps(data),
                ContentType="application/json",
            )
            results.append({"symbol": symbol, "date": yesterday, "s3_key": s3_key, "status": "ok"})
        except Exception as e:
            failures.append({"symbol": symbol, "date": yesterday, "error": str(e)})

    if failures and SNS_TOPIC_ARN:
        sns.publish(
            TopicArn=SNS_TOPIC_ARN,
            Subject=f"Trading Forge Data Fetch Failures ({yesterday})",
            Message=json.dumps(failures, indent=2),
        )

    return {"date": yesterday, "results": results, "failures": failures}


def fetch_daily_bar(symbol: str, date: str) -> dict:
    """Fetch daily OHLCV bar from Massive API (free tier)."""
    url = f"{MASSIVE_BASE_URL}/bars/{symbol}?date={date}&timeframe=daily"
    req = Request(url, headers={"Accept": "application/json"})

    try:
        with urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode())
    except URLError as e:
        raise RuntimeError(f"Failed to fetch {symbol} for {date}: {e}") from e
```

`infra/lambda/nightly-data-fetch/requirements.txt`:
```
boto3>=1.34.0
```

**Step 4: Verify CDK synth**

Run: `cd infra/cdk && npm install && npx cdk synth`
Expected: CloudFormation template output (JSON/YAML)

**Step 5: Commit**

```bash
git add infra/
git commit -m "feat: add CDK stack for nightly data fetch Lambda + EventBridge"
```

---

## Verification Checklist

```bash
# All TypeScript tests pass
npx vitest run

# Type check passes
npx tsc --noEmit

# Ollama model works
ollama list | grep trading-quant

# CDK synthesizes
cd infra/cdk && npx cdk synth

# Agent endpoints respond (after npm run dev)
curl -X POST http://localhost:4000/api/agent/run-strategy \
  -H "Content-Type: application/json" \
  -d '{"strategy_name":"test","one_sentence":"test","python_code":"pass","params":{},"symbol":"ES","timeframe":"15min","start_date":"2024-01-01","end_date":"2024-12-31"}'

# n8n workflows validated (via MCP)
# Each workflow passes n8n_validate_workflow
```
