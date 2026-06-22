/**
 * Scout Extract Confluence Gate Fields — Wave 23F (2026-05-19)
 *
 * Covers the 5 new A+ confluence gate fields added to pendingIdeaSchema
 * and emitted by the scout-extract route handler:
 *   - confluence_factors (closed enum array)
 *   - min_factors_satisfied (int 0-5)
 *   - source_claim_win_rate (float 0-1 or null)
 *   - source_claim_avg_r (float or null)
 *   - symbols (array of MES/MNQ/MCL)
 *
 * Tests:
 *   1. All 5 fields populated → scout-extract emits them; pendingIdeaSchema accepts them
 *   2. None of the 5 fields present → schema still parses (all optional)
 *   3. Invalid enum token in confluence_factors → Zod rejects
 *   4. source_claim_win_rate: null → accepted by schema
 *
 * LLM mocking pattern follows scout-extract.test.ts (callOpenAIOrFallback mock).
 */

import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { z } from "zod";

vi.mock("../index.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const callOpenAIOrFallbackMock = vi.fn();
vi.mock("../services/model-router.js", () => ({
  callOpenAI:           vi.fn(),
  callOpenAIOrFallback: (...args: unknown[]) => callOpenAIOrFallbackMock(...args),
  // Wave hardening 2026-06-22, test isolation: the scout-extract handler now
  // calls callScoutExtractLlm (agent.ts:807, W23G.9 transcript_extractor role),
  // which was absent from this mock → undefined → handler threw 500. Route it to
  // the same mock the test drives so the LLM response stub flows through.
  callScoutExtractLlm:  (...args: unknown[]) => callOpenAIOrFallbackMock(...args),
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
  "MES strategy: enter long on EMA crossover with 14 ATR stop. ".repeat(3);

const BASE_STRATEGY = {
  name: "ema_pullback",
  concept_name: "ema_pullback_mes",
  description: "9/21 EMA pullback on MES with regime confirmation and volume filter per source.",
  symbol: "MES",
  timeframe: "5m",
  direction: "long",
  entry_indicator: "ema_crossover",
  entry_params: { fast_period: 9, slow_period: 21 },
  entry_condition: "Enter long when 9 EMA closes above 21 EMA after a pullback to the 21 EMA with bullish engulfing candle.",
  exit_type: "atr_multiple",
  stop_loss_atr_multiple: 1.5,
  take_profit_atr_multiple: 2.5,
  max_contracts: 3,
  preferred_regime: "TRENDING_UP",
  extraction_confidence: 0.85,
};

describe("Wave 23F — scout-extract confluence gate fields", () => {
  beforeEach(() => {
    callOpenAIOrFallbackMock.mockReset();
  });

  it("all 5 new fields populated → route emits them correctly", async () => {
    callOpenAIOrFallbackMock.mockResolvedValueOnce(JSON.stringify({
      strategies: [
        {
          ...BASE_STRATEGY,
          confluence_factors: ["regime_match", "structural_setup", "volume_confirmation"],
          min_factors_satisfied: 2,
          source_claim_win_rate: 0.72,
          source_claim_avg_r: 2.1,
          symbols: ["MES"],
        },
      ],
    }));

    const r = await postScoutExtract({
      sourceUrl: "https://youtube.com/watch?v=ema-pullback",
      sourceProvider: "tavily",
      markdown: VALID_MARKDOWN_MIN,
    });

    expect(r.status).toBe(200);
    expect(r.json.extracted).toBe(true);
    expect(r.json.ideas).toHaveLength(1);

    const idea = r.json.ideas[0];
    expect(idea.confluence_factors).toEqual(["regime_match", "structural_setup", "volume_confirmation"]);
    expect(idea.min_factors_satisfied).toBe(2);
    expect(idea.source_claim_win_rate).toBe(0.72);
    expect(idea.source_claim_avg_r).toBe(2.1);
    expect(idea.symbols).toEqual(["MES"]);
  });

  it("none of the 5 new fields present → route succeeds; fields absent from output", async () => {
    callOpenAIOrFallbackMock.mockResolvedValueOnce(JSON.stringify({
      strategies: [BASE_STRATEGY],
    }));

    const r = await postScoutExtract({
      sourceUrl: "https://youtube.com/watch?v=no-confluence",
      sourceProvider: "brave",
      markdown: VALID_MARKDOWN_MIN,
    });

    expect(r.status).toBe(200);
    expect(r.json.extracted).toBe(true);
    expect(r.json.ideas).toHaveLength(1);

    const idea = r.json.ideas[0];
    // Fields should be absent (not undefined — JSON serialization drops undefined keys)
    expect("confluence_factors" in idea).toBe(false);
    expect("min_factors_satisfied" in idea).toBe(false);
    expect("source_claim_win_rate" in idea).toBe(false);
    expect("source_claim_avg_r" in idea).toBe(false);
    expect("symbols" in idea).toBe(false);
  });

  it("invalid enum token in confluence_factors → route filters it out silently (server-side whitelist)", async () => {
    // The route filters invalid tokens server-side using VALID_CONFLUENCE_FACTORS Set.
    // An invalid token like "liquidity_sweep" is stripped; only valid tokens survive.
    callOpenAIOrFallbackMock.mockResolvedValueOnce(JSON.stringify({
      strategies: [
        {
          ...BASE_STRATEGY,
          confluence_factors: ["regime_match", "liquidity_sweep", "volume_confirmation"],
          min_factors_satisfied: 2,
          source_claim_win_rate: null,
          source_claim_avg_r: null,
          symbols: ["MES"],
        },
      ],
    }));

    const r = await postScoutExtract({
      sourceUrl: "https://youtube.com/watch?v=bad-enum",
      sourceProvider: "exa",
      markdown: VALID_MARKDOWN_MIN,
    });

    expect(r.status).toBe(200);
    expect(r.json.extracted).toBe(true);
    const idea = r.json.ideas[0];
    // "liquidity_sweep" is not a valid token — filtered out
    expect(idea.confluence_factors).toEqual(["regime_match", "volume_confirmation"]);
  });

  it("source_claim_win_rate: null → accepted and emitted as null", async () => {
    callOpenAIOrFallbackMock.mockResolvedValueOnce(JSON.stringify({
      strategies: [
        {
          ...BASE_STRATEGY,
          confluence_factors: ["macro_alignment"],
          min_factors_satisfied: 1,
          source_claim_win_rate: null,
          source_claim_avg_r: null,
          symbols: ["MES", "MNQ"],
        },
      ],
    }));

    const r = await postScoutExtract({
      sourceUrl: "https://youtube.com/watch?v=null-claims",
      sourceProvider: "parallel",
      markdown: VALID_MARKDOWN_MIN,
    });

    expect(r.status).toBe(200);
    expect(r.json.extracted).toBe(true);
    const idea = r.json.ideas[0];
    expect(idea.source_claim_win_rate).toBeNull();
    expect(idea.source_claim_avg_r).toBeNull();
    expect(idea.symbols).toEqual(["MES", "MNQ"]);
  });

  // ── Zod schema unit tests (pendingIdeaSchema is not exported; test the Zod shapes directly) ──

  describe("pendingIdeaSchema confluence_factors Zod shape", () => {
    // Replicate the Zod shape from pendingIdeaSchema for unit testing
    const confluenceFactorsSchema = z.array(z.enum([
      "regime_match", "structural_setup", "volume_confirmation",
      "macro_alignment", "vp_shape",
    ])).optional();

    it("accepts valid enum tokens", () => {
      expect(confluenceFactorsSchema.safeParse(["regime_match", "vp_shape"]).success).toBe(true);
    });

    it("accepts empty array", () => {
      expect(confluenceFactorsSchema.safeParse([]).success).toBe(true);
    });

    it("accepts undefined (optional)", () => {
      expect(confluenceFactorsSchema.safeParse(undefined).success).toBe(true);
    });

    it("rejects invalid enum token", () => {
      const result = confluenceFactorsSchema.safeParse(["regime_match", "liquidity_sweep"]);
      expect(result.success).toBe(false);
    });

    it("source_claim_win_rate: null is accepted", () => {
      const schema = z.number().min(0).max(1).nullable().optional();
      expect(schema.safeParse(null).success).toBe(true);
      expect(schema.safeParse(0.72).success).toBe(true);
      expect(schema.safeParse(undefined).success).toBe(true);
    });

    it("symbols rejects non-enum values", () => {
      const schema = z.array(z.enum(["MES", "MNQ", "MCL"])).optional();
      expect(schema.safeParse(["MES", "ES"]).success).toBe(false);
      expect(schema.safeParse(["MES", "MNQ"]).success).toBe(true);
    });
  });
});
