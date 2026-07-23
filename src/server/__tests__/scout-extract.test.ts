/**
 * Scout Extract Endpoint Tests — Pass 16
 *
 * Covers /api/agent/scout-extract behaviour via in-process http server (no supertest dep):
 *   - Input validation (zod schema): missing fields, oversized markdown, bad sourceProvider
 *   - Re-uses transcript_extractor role via mocked callOpenAI
 *   - Empty model response → {extracted:false, reason:"model_unavailable"}
 *   - Non-JSON response → {extracted:false, reason:"non_json"}
 *   - {strategies:[]} → {extracted:false, reason:"no_strategy_content"}
 *   - Big-contract markets (ES/NQ/CL) silently dropped per CLAUDE.md §13
 *   - Mixed batch: ES drops + MES kept → only MES idea returned
 *   - Successful extraction maps DSL → strict scout shape with required fields
 *
 * No DB / no network — callOpenAI mocked.
 */

import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

vi.mock("../index.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const callOpenAIMock = vi.fn();
const callOpenAIOrFallbackMock = vi.fn();
const callScoutExtractLlmMock = vi.fn();
vi.mock("../services/model-router.js", () => ({
  callOpenAI:           (...args: unknown[]) => callOpenAIMock(...args),
  // Pass 17 changed /scout-extract to use callOpenAIOrFallback instead of callOpenAI.
  // W23G.9 (2026-05-19) wrapped transcript_extractor in callScoutExtractLlm for
  // exponential-backoff retry on 429/5xx/timeout. This mock must match so route
  // doesn't blow up with TypeError on undefined LLM helper.
  callOpenAIOrFallback: (...args: unknown[]) => callOpenAIOrFallbackMock(...args),
  callScoutExtractLlm:  (...args: unknown[]) => callScoutExtractLlmMock(...args),
  selectModel:          vi.fn(),
}));

vi.mock("../middleware/idempotency.js", () => ({
  idempotencyMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../middleware/require-live-n8n.js", () => ({
  requireLiveN8n: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../services/agent-service.js", () => ({
  AgentService: class {
    scoutIdeas = vi.fn();
    drainScoutedIdeas = vi.fn();
    runStrategyFromDSL = vi.fn();
  },
}));

vi.mock("../services/regime-service.js", () => ({ analyzeMarket: vi.fn() }));
vi.mock("../services/robustness-service.js", () => ({ runRobustnessTest: vi.fn() }));
// Wave 10: scout-extract now calls db.insert(auditLog).values(...).catch(...)
// when remapping mini→micro contracts (ES→MES etc, sizeMultiplier !== 1).
// The mock must return a chainable object so .values(...) doesn't throw.
vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(() => ({
      values: vi.fn().mockReturnValue({
        catch: vi.fn().mockResolvedValue(undefined),
      }),
    })),
  },
}));
vi.mock("../services/ollama-client.js", () => ({ OllamaClient: class {} }));
vi.mock("../lib/python-runner.js", () => ({ runPythonModule: vi.fn() }));

import { agentRoutes } from "../routes/agent.js";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use("/api/agent", agentRoutes);
  server = app.listen(0);
  await new Promise<void>((r) => server.on("listening", () => r()));
  const port = (server.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
});

async function postScoutExtract(body: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${baseUrl}/api/agent/scout-extract`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

const VALID_MARKDOWN_MIN =
  "MES strategy on the 5 and 15 minute charts: use 8, 9, and 21 EMA signals with a 14 ATR period, " +
  "1 or 1.5 ATR stop, 2.5 or 3 ATR target, and at most 3, 4, or 10 micro contracts. ".repeat(3);

describe("POST /api/agent/scout-extract", () => {
  beforeEach(() => {
    callOpenAIMock.mockReset();
    callOpenAIOrFallbackMock.mockReset();
  });

  it("rejects missing required fields with 400", async () => {
    const r = await postScoutExtract({});
    expect(r.status).toBe(400);
    expect(r.json.error).toBe("Invalid request");
  });

  it("rejects oversized markdown (>100KB)", async () => {
    const r = await postScoutExtract({
      sourceUrl: "https://example.com",
      sourceProvider: "brave",
      markdown: "a".repeat(100_001),
    });
    expect(r.status).toBe(400);
  });

  it("rejects unsupported sourceProvider", async () => {
    const r = await postScoutExtract({
      sourceUrl: "https://example.com",
      sourceProvider: "reddit",
      markdown: VALID_MARKDOWN_MIN,
    });
    expect(r.status).toBe(400);
  });

  it("returns no_strategy_content when model returns {strategies:[]}", async () => {
    callScoutExtractLlmMock.mockResolvedValueOnce(JSON.stringify({ strategies: [] }));
    const r = await postScoutExtract({
      sourceUrl: "https://example.com",
      sourceProvider: "tavily",
      markdown: VALID_MARKDOWN_MIN,
    });
    expect(r.status).toBe(200);
    expect(r.json.extracted).toBe(false);
    expect(r.json.reason).toBe("no_strategy_content");
    expect(r.json.ideas).toEqual([]);
  });

  it("returns model_unavailable when callOpenAI returns null", async () => {
    callScoutExtractLlmMock.mockResolvedValueOnce(null);
    const r = await postScoutExtract({
      sourceUrl: "https://example.com",
      sourceProvider: "brave",
      markdown: VALID_MARKDOWN_MIN,
    });
    expect(r.status).toBe(200);
    expect(r.json.extracted).toBe(false);
    expect(r.json.reason).toBe("model_unavailable");
  });

  it("returns non_json when model returns invalid JSON", async () => {
    callScoutExtractLlmMock.mockResolvedValueOnce("not json at all");
    const r = await postScoutExtract({
      sourceUrl: "https://example.com",
      sourceProvider: "brave",
      markdown: VALID_MARKDOWN_MIN,
    });
    expect(r.status).toBe(200);
    expect(r.json.extracted).toBe(false);
    expect(r.json.reason).toBe("non_json");
  });

  it("remaps ES/NQ/CL strategies to MES/MNQ/MCL (Wave 10: mini→micro remap, not drop)", async () => {
    // Wave 10 fix: ES sources are valid (operator directive Pass 19 Track F).
    // ES → MES is remapped, NOT dropped. The point-value ratio is preserved by
    // scaling max_contracts 10× (ES=$50/pt → MES=$5/pt).
    callScoutExtractLlmMock.mockResolvedValueOnce(JSON.stringify({
      strategies: [
        {
          name: "es_breakout",
          concept_name: "es_breakout_v1",
          description: "Breakout strategy on ES futures with explicit entry rules.",
          symbol: "ES",
          timeframe: "5m",
          direction: "long",
          entry_indicator: "atr_breakout",
          entry_params: { period: 14, multiplier: 1.5 },
          entry_condition: "Enter long on ATR breakout above 14-period channel.",
          exit_type: "atr_multiple",
          stop_loss_atr_multiple: 1.5,
          take_profit_atr_multiple: 3.0,
          max_contracts: 3,
        },
      ],
    }));
    const r = await postScoutExtract({
      sourceUrl: "https://example.com",
      sourceProvider: "tavily",
      markdown: VALID_MARKDOWN_MIN,
    });
    expect(r.status).toBe(200);
    expect(r.json.extracted).toBe(true);
    // ES remapped → MES; strategy is kept (not dropped)
    expect(r.json.ideas).toHaveLength(1);
    expect(r.json.ideas[0].market).toBe("MES");
    expect(r.json.ideas[0].concept_name).toBe("es_breakout_v1");
  });

  it("keeps MES strategy and maps DSL → strict scout shape", async () => {
    callScoutExtractLlmMock.mockResolvedValueOnce(JSON.stringify({
      strategies: [
        {
          name: "mes_vwap_fade",
          concept_name: "vwap_fade_mes",
          description: "Fade overextended MES away from session VWAP within range-bound regimes per source.",
          symbol: "MES",
          timeframe: "5m",
          direction: "short",
          entry_indicator: "vwap_reversion",
          entry_params: { deviation_threshold: 1.5 },
          entry_condition: "Short when 5m bar closes above VWAP + 1.5x ATR during RTH.",
          exit_type: "indicator_signal",
          exit_params: { signal: "price_at_vwap" },
          stop_loss_atr_multiple: 1.5,
          take_profit_atr_multiple: 2.5,
          preferred_regime: "RANGE_BOUND",
          max_contracts: 3,
        },
      ],
    }));
    const r = await postScoutExtract({
      sourceUrl: "https://example.com/article",
      sourceProvider: "tavily",
      markdown: VALID_MARKDOWN_MIN,
    });
    expect(r.status).toBe(200);
    expect(r.json.extracted).toBe(true);
    expect(r.json.ideas).toHaveLength(1);
    const idea = r.json.ideas[0];
    expect(idea.market).toBe("MES");
    expect(idea.timeframe).toBe("5m");
    expect(idea.regime).toBe("RANGE_BOUND");
    expect(idea.source_url).toBe("https://example.com/article");
    expect(idea.source_provider).toBe("tavily");
    expect(idea.concept_name).toBe("vwap_fade_mes");
    expect(idea.signal_type).toBe("strategy_candidate");
    expect(idea.thesis.length).toBeGreaterThanOrEqual(20);
    expect(idea.entry_rules.length).toBeGreaterThanOrEqual(20);
    expect(idea.exit_rules.length).toBeGreaterThanOrEqual(20);
    expect(idea.risk_rules.length).toBeGreaterThanOrEqual(10);
  });

  it("mixed batch: keeps MES (1×) and remaps ES → MES (10×)", async () => {
    // Wave 10 fix: ES is now remapped to MES, not dropped.
    // Both strategies survive; ES idea gets market=MES.
    callScoutExtractLlmMock.mockResolvedValueOnce(JSON.stringify({
      strategies: [
        {
          name: "es_remap",
          concept_name: "es_remap",
          description: "ES big-contract strategy remapped to MES with 10× contract scale.",
          symbol: "ES",
          timeframe: "5m",
          entry_indicator: "atr_breakout",
          entry_params: { period: 14, multiplier: 1.5 },
          entry_condition: "Long on ATR breakout above 14-period high.",
          exit_type: "atr_multiple",
          stop_loss_atr_multiple: 1.5,
          take_profit_atr_multiple: 3.0,
        },
        {
          name: "mes_keep",
          concept_name: "mes_keep",
          description: "MES micro strategy that should pass through and reach the strict scout pipeline.",
          symbol: "MES",
          timeframe: "15m",
          entry_indicator: "ema_crossover",
          entry_params: { fast_period: 8, slow_period: 21 },
          entry_condition: "Long when 8 EMA crosses above 21 EMA on 15m.",
          exit_type: "atr_multiple",
          stop_loss_atr_multiple: 1.0,
          take_profit_atr_multiple: 3.0,
          preferred_regime: "TRENDING_UP",
          max_contracts: 4,
        },
      ],
    }));
    const r = await postScoutExtract({
      sourceUrl: "https://example.com/mixed",
      sourceProvider: "parallel",
      markdown: VALID_MARKDOWN_MIN,
    });
    expect(r.status).toBe(200);
    expect(r.json.extracted).toBe(true);
    // Both strategies land — ES remapped to MES, MES kept as-is
    expect(r.json.ideas).toHaveLength(2);
    const markets = r.json.ideas.map((i: { market: string }) => i.market);
    expect(markets).toContain("MES");
    // Both ideas should be MES (ES remapped + original MES)
    expect(r.json.ideas.every((i: { market: string }) => i.market === "MES")).toBe(true);
  });
});
