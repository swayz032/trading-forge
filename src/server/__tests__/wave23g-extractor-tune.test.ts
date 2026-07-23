/**
 * wave23g-extractor-tune.test.ts — W23G.2 + W23G.7 combined extractor tuning tests
 *
 * W23G.2 — wrong_instrument tightening:
 *   Test 1: Transcript 90% futures + 10% forex illustration → classification=futures_with_forex_illustration,
 *           extraction succeeds, audit event emitted
 *   Test 2: Transcript 80%+ forex pair analysis → classification=non_futures_primary, empty result
 *   Test 3: Transcript pure futures → classification=futures_primary, normal extraction
 *
 * W23G.7 — single-pass extraction window (8K → 12K):
 *   Test 4: 10K transcript, strategy in middle 6K → first pass (12K window) succeeds,
 *           fallback NOT fired (assert via mock call count = 1)
 *   Test 5: 15K transcript, empty first pass → fallback fires (3 chunks = 4 total calls)
 *   Test 6: Verify audit_log emits extraction_mode field in success response
 *
 * All tests mock callScoutExtractLlm directly — no live DB, no real LLM.
 */

import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

// ─── Module mocks ────────────────────────────────────────────────────────────
vi.mock("../index.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// callScoutExtractLlm is the direct call site inside extractFromChunk.
// Mock it here so we can control per-call responses and count invocations.
const callScoutExtractLlmMock = vi.fn();
vi.mock("../services/model-router.js", () => ({
  callOpenAI:           vi.fn(),
  callOpenAIOrFallback: vi.fn(),
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

// These 3 mocks isolate the windowing logic under test (single-pass / chunked-fallback
// / chunked_oom_safe) from later, independently-shipped enrichment layers (recall pass,
// coverage gate, coverage repair loop) that production now wires into the same request
// path and that also call the shared LLM-extraction mock — without these, their calls
// inflate this file's call-count assertions.
vi.mock("../lib/extraction-coverage-gate.js", () => ({
  runCoverageGate: vi.fn().mockResolvedValue({
    speakerItems: [],
    verdict: { covered: [], shallow: [], missing: [], coverage_pct: 1, verdict: "pass" },
  }),
}));
vi.mock("../lib/extraction-coverage-repair.js", () => ({
  runCoverageRepairLoop: vi.fn(),
}));
vi.mock("../lib/transcript-extractor-recall.js", () => ({
  runRecallPass: vi.fn().mockResolvedValue({
    patched: {},
    recall: {},
    appliedChanges: [],
    failed: true,
  }),
}));

// DB mock: insert chain must support .values(...).catch(...) and .returning() for audit rows.
const auditInsertValues = vi.fn().mockReturnValue({
  catch: vi.fn().mockResolvedValue(undefined),
  returning: vi.fn().mockResolvedValue([{ id: 1 }]),
});
vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(() => ({ values: auditInsertValues })),
  },
}));

// lib/audit-log-helper mock — insertAuditRow is used by the mixed_instrument audit event.
const insertAuditRowMock = vi.fn().mockResolvedValue(undefined);
vi.mock("../lib/audit-log-helper.js", () => ({
  insertAuditRow: (...args: unknown[]) => insertAuditRowMock(...args),
}));

vi.mock("../services/ollama-client.js", () => ({ OllamaClient: class {} }));
vi.mock("../lib/python-runner.js", () => ({ runPythonModule: vi.fn() }));

import { agentRoutes } from "../routes/agent.js";

// ─── Test server ─────────────────────────────────────────────────────────────
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

beforeEach(() => {
  callScoutExtractLlmMock.mockReset();
  // mockClear() preserves the resolved-value implementation set at declaration time.
  // mockReset() would strip it, causing insertAuditRow(...).catch() to throw TypeError.
  insertAuditRowMock.mockClear();
  insertAuditRowMock.mockResolvedValue(undefined);
  auditInsertValues.mockClear();
});

// ─── Strategy fixture helper ──────────────────────────────────────────────────
function makeMesStrategy(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "mes_ema_crossover",
    concept_name: "ema_crossover_mes",
    description: "9/21 EMA crossover on MES 5-minute chart during RTH with pullback confirmation.",
    symbol: "MES",
    timeframe: "5m",
    direction: "long",
    entry_indicator: "ema_crossover",
    entry_params: { fast_period: 9, slow_period: 21 },
    entry_condition: "Enter long when 9 EMA crosses above 21 EMA on a 5m close, then price pulls back and reclaims 9 EMA.",
    exit_type: "atr_multiple",
    exit_params: { multiplier: 2.0 },
    stop_loss_atr_multiple: 1.5,
    take_profit_atr_multiple: 3.0,
    preferred_regime: "TRENDING_UP",
    extraction_confidence: 0.9,
    ...overrides,
  };
}

// ─── Transcript fixtures ──────────────────────────────────────────────────────

// JackTrades-style 4H futures content: predominantly futures, brief EURUSD illustration.
// Simulates a 90%+ futures discussion that shows a forex chart for ~30 seconds.
const FUTURES_WITH_FOREX_ILLUSTRATION_TRANSCRIPT = `
Today I am going to show you my 4-hour MES futures strategy that I trade every day on the S&P 500 micro futures.
We are looking at the MES chart on a 4-hour timeframe. The strategy uses the 9 EMA and 21 EMA crossover system.
When the 9 EMA crosses above the 21 EMA on the 4H MES chart I look for a pullback to the 21 EMA.
I only trade this on MES and MNQ micro futures during RTH session hours from 9:30 AM to 4 PM ET.
The stop is 1.5 ATR below the entry candle low. My target is 3R on MES.
I have been trading this MES strategy for 2 years with consistent results on the S&P 500 futures market.
Now as a quick illustration of why patterns work across markets, here is a brief look at EURUSD showing
the same EMA crossover pattern. GBPJPY shows it too. But I only trade MES micro futures personally.
Back to MES: the 4H EMA crossover combined with an RTH pullback has been very reliable on S&P 500 futures.
The entry trigger is when the 9 EMA closes above the 21 EMA on the MES 4-hour chart.
Risk management: 1.5 ATR stop, 3R target. Position size: 6 MES contracts maximum.
`.repeat(3); // ~2100 chars — well within 12K first pass

// Pure forex / non-futures content — 80%+ EURUSD/GBPUSD/forex analysis.
const NON_FUTURES_TRANSCRIPT = `
Today we are covering the EURUSD daily chart trading strategy. This is a pure forex setup.
EURUSD has been in a downtrend and we are looking for GBPUSD correlation. GBPJPY is also aligned bearish.
The entry for EURUSD: when the price breaks below the 20 SMA on the daily chart and EURUSD retests from below.
Stop loss is 50 pips above the retest candle. Target is 100 pips on EURUSD.
EURUSD, GBPUSD, GBPJPY, USDJPY are the pairs I focus on. Forex is 24 hours so timing matters.
This EURUSD strategy has worked for me on the major forex pairs for years.
EURUSD technical analysis: look for the EURUSD to retest the 20 SMA. GBPUSD follows similar patterns.
My forex trading setup: I trade EURUSD, GBPUSD, GBPJPY exclusively. No futures, no crypto.
The EURUSD daily pattern: breakout below 20 SMA, retest, then continuation short EURUSD.
GBPUSD shows the same pattern. USDJPY also aligned. Pure forex strategy for EURUSD traders.
`.repeat(3);

// Pure MES/futures content — no non-futures references at all.
const PURE_FUTURES_TRANSCRIPT = `
This is the 9 EMA and 21 EMA pullback strategy on MES micro futures, 5-minute timeframe RTH only.
I trade this exclusively on MES and MNQ. The entry is when the 9 EMA crosses above the 21 EMA on MES.
After the crossover I wait for price to pull back to the 21 EMA and then print a bullish engulfing close.
The stop is 1.5 ATR below the swing low. Target is 3R. I trade 6 MES contracts per signal.
This MES strategy runs during regular trading hours on the S&P 500 micro futures only.
Session filter: 9:30 AM to 3:55 PM ET. Hard flatten at 15:55 ET per risk rules.
Position sizing: 6 MES contracts base, risk-derived ceiling per 2% rule.
The EMA crossover on MES 5-minute chart is the cleanest signal I have found for S&P 500 futures.
Preferred regime: trending up. Avoid range-bound days on MES.
`.repeat(3);

// ─── W23G.2 tests ────────────────────────────────────────────────────────────

describe("W23G.2 — wrong_instrument tightening", () => {
  it("test 1: 90% futures + 10% forex illustration → classification=futures_with_forex_illustration, extraction succeeds", async () => {
    // LLM sees the mixed transcript and correctly classifies it as futures_with_forex_illustration.
    // Strategy IS extracted (it's a valid futures strategy).
    callScoutExtractLlmMock.mockResolvedValueOnce(JSON.stringify({
      instrument_classification: "futures_with_forex_illustration",
      strategies: [makeMesStrategy()],
    }));

    const r = await postScoutExtract({
      sourceUrl: "https://youtube.com/watch?v=jacktrades4h",
      sourceProvider: "tavily",
      markdown: FUTURES_WITH_FOREX_ILLUSTRATION_TRANSCRIPT,
    });

    expect(r.status).toBe(200);
    expect(r.json.extracted).toBe(true);
    expect(r.json.ideas).toHaveLength(1);
    // Route must echo the instrument_classification in the response
    expect(r.json.instrument_classification).toBe("futures_with_forex_illustration");
    // audit event for mixed-instrument keep must be emitted
    expect(insertAuditRowMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "scout.mixed_instrument_kept_futures",
        status: "success",
        result: expect.objectContaining({
          instrument_classification: "futures_with_forex_illustration",
        }),
      }),
    );
  });

  it("test 2: 80%+ forex pair analysis → classification=non_futures_primary, empty result", async () => {
    // LLM sees predominantly forex content and classifies it as non_futures_primary.
    // No strategies are extracted.
    callScoutExtractLlmMock.mockResolvedValueOnce(JSON.stringify({
      instrument_classification: "non_futures_primary",
      strategies: [],
      empty_reason: "wrong_instrument",
    }));

    const r = await postScoutExtract({
      sourceUrl: "https://youtube.com/watch?v=forexonly",
      sourceProvider: "tavily",
      markdown: NON_FUTURES_TRANSCRIPT,
    });

    expect(r.status).toBe(200);
    expect(r.json.extracted).toBe(false);
    expect(r.json.reason).toBe("wrong_instrument");
    expect(r.json.ideas).toEqual([]);
    // The mixed-instrument audit event must NOT be emitted for non_futures_primary
    expect(insertAuditRowMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: "scout.mixed_instrument_kept_futures" }),
    );
  });

  it("test 3: pure futures transcript → classification=futures_primary, normal extraction", async () => {
    // LLM sees pure futures content and classifies accordingly.
    callScoutExtractLlmMock.mockResolvedValueOnce(JSON.stringify({
      instrument_classification: "futures_primary",
      strategies: [makeMesStrategy({ concept_name: "ema_pullback_mes_5m" })],
    }));

    const r = await postScoutExtract({
      sourceUrl: "https://youtube.com/watch?v=puremersfutures",
      sourceProvider: "tavily",
      markdown: PURE_FUTURES_TRANSCRIPT,
    });

    expect(r.status).toBe(200);
    expect(r.json.extracted).toBe(true);
    expect(r.json.ideas).toHaveLength(1);
    expect(r.json.instrument_classification).toBe("futures_primary");
    // No mixed-instrument audit event for pure futures
    expect(insertAuditRowMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: "scout.mixed_instrument_kept_futures" }),
    );
  });
});

// ─── W23G.7 tests ────────────────────────────────────────────────────────────

describe("W23G.7 — single-pass extraction (12K window)", () => {
  it("test 4: 10K transcript, strategy in middle 6K → first pass (12K window) succeeds, fallback NOT fired", async () => {
    // Build a 10K transcript where the strategy description is in characters 4000-10000.
    // With the new 12K window the first pass captures the entire transcript.
    // Use a padded preamble to guarantee exact size.
    const strategyCore = "Here is my MES futures strategy: I trade the MES 5-minute chart using the 9 EMA crossing above the 21 EMA. " +
      "The entry trigger is when the 9 EMA closes above the 21 EMA on a 5-minute bar during RTH. " +
      "Stop is 1.5 ATR below the entry candle. Target is 3R. I use 6 MES contracts base size. " +
      "This is the complete system I use on S&P 500 micro futures every day during RTH. " +
      "EMA crossover entry with pullback confirmation: enter long when 9 EMA crosses 21 EMA, wait for retest. ";
    const strategySection = strategyCore.repeat(10); // ~550 chars × 10 = ~5.5 KB
    const TARGET_LENGTH = 10_000;
    const preambleNeeded = TARGET_LENGTH - strategySection.length;
    const preamble = "Market commentary with no strategy content here at all. ".repeat(
      Math.ceil(preambleNeeded / 55)
    ).slice(0, preambleNeeded);
    const transcript10K = (preamble + strategySection).slice(0, TARGET_LENGTH);
    expect(transcript10K.length).toBe(TARGET_LENGTH); // sanity-check fixture is exactly 10K

    // entry_sequence (>=3 steps) is required so isThinResult() in agent.ts's
    // THIN-RECHUNK gate does not classify this as "thin" and trigger an unwanted
    // rechunk — the original fixture predates THIN-RECHUNK and never set this field.
    callScoutExtractLlmMock.mockResolvedValueOnce(JSON.stringify({
      instrument_classification: "futures_primary",
      strategies: [makeMesStrategy({
        entry_sequence: [
          { step: 1, action: "9 EMA crosses above 21 EMA on 5m bar" },
          { step: 2, action: "wait for pullback to 21 EMA" },
          { step: 3, action: "enter long on retest confirmation" },
        ],
      })],
    }));

    const r = await postScoutExtract({
      sourceUrl: "https://youtube.com/watch?v=singlepass10k",
      sourceProvider: "tavily",
      markdown: transcript10K,
    });

    expect(r.status).toBe(200);
    expect(r.json.extracted).toBe(true);
    expect(r.json.ideas).toHaveLength(1);
    // Critical: callScoutExtractLlm must be called exactly once — no chunked fallback.
    expect(callScoutExtractLlmMock).toHaveBeenCalledTimes(1);
    // Telemetry field must indicate single_pass
    expect(r.json.extraction_mode).toBe("single_pass");
  });

  it("test 5: 15K transcript uses the retry-hardened two-window OOM-safe path", async () => {
    // Build a 15K transcript where the first 12K is all preamble with no strategy.
    // The strategy appears in the last 3K (captured by the end chunk in fallback).
    const strategyAtEnd =
      "Strategy section: enter long on MES when the 9 EMA crosses above 21 EMA on 5m chart during RTH. " +
      "Stop loss is 1.5 ATR. Target is 3R. Contracts: 6 MES base. This is the complete entry rule. " +
      "Enter when 9 EMA closes above 21 EMA. Position size 6 MES contracts with risk-derived ceiling. ";
    const TARGET_LENGTH = 15_000;
    const preambleLen = TARGET_LENGTH - strategyAtEnd.length;
    const preamble = "Long introduction with no strategy rules at all here. ".repeat(
      Math.ceil(preambleLen / 53)
    ).slice(0, preambleLen);
    const transcript15K = (preamble + strategyAtEnd).slice(0, TARGET_LENGTH);
    expect(transcript15K.length).toBe(TARGET_LENGTH); // sanity-check

    // CHUNKING_THRESHOLD_CHARS was lowered 14000→12000 (a pre-existing, already-shipped
    // change), so a 15K transcript now routes into the OOM-safe 2-window chunked path
    // (chunkChars=10000, overlapChars=1000 → windows [0,10000) and [9000,15000)) instead
    // of the old first-pass(12K)+3-way-fallback path this test originally exercised.
    // Call 1 (window [0,10000)): empty — no strategy content in the preamble-only window.
    callScoutExtractLlmMock.mockResolvedValueOnce(JSON.stringify({
      instrument_classification: "futures_primary",
      strategies: [],
      empty_reason: "no_strategy_content",
    }));
    // Call 2 (window [9000,15000)): strategy found — entry_sequence (>=3 steps) required
    // again so isThinResult()'s THIN-RECHUNK gate doesn't escalate the merged result.
    callScoutExtractLlmMock.mockResolvedValueOnce(JSON.stringify({
      strategies: [makeMesStrategy({
        concept_name: "ema_crossover_end_chunk",
        entry_sequence: [
          { step: 1, action: "9 EMA crosses above 21 EMA on 5m bar" },
          { step: 2, action: "wait for pullback to 21 EMA" },
          { step: 3, action: "enter long on retest confirmation" },
        ],
      })],
    }));

    const r = await postScoutExtract({
      sourceUrl: "https://youtube.com/watch?v=chunked15k",
      sourceProvider: "tavily",
      markdown: transcript15K,
    });

    expect(r.status).toBe(200);
    expect(r.json.extracted).toBe(true);
    expect(r.json.ideas).toHaveLength(1);
    // Three bounded attempts across two windows: transient empty chunk results are
    // retried because long-video extraction is empirically non-deterministic.
    expect(callScoutExtractLlmMock).toHaveBeenCalledTimes(6);
    // Telemetry uses the current public name for the bounded two-window path.
    expect(r.json.extraction_mode).toBe("chunked_fallback");
  });

  it("test 6: success response contains extraction_mode and tokens_estimated fields", async () => {
    const markdown = "MES strategy: 9 EMA crosses 21 EMA. Enter long, stop 1.5 ATR, target 3R. ".repeat(50); // ~3.5K

    callScoutExtractLlmMock.mockResolvedValueOnce(JSON.stringify({
      instrument_classification: "futures_primary",
      strategies: [makeMesStrategy()],
    }));

    const r = await postScoutExtract({
      sourceUrl: "https://youtube.com/watch?v=telemetrycheck",
      sourceProvider: "tavily",
      markdown,
    });

    expect(r.status).toBe(200);
    expect(r.json.extracted).toBe(true);
    // extraction_mode must be present
    expect(r.json).toHaveProperty("extraction_mode");
    expect(["single_pass", "chunked_fallback"]).toContain(r.json.extraction_mode);
    // tokens_estimated must be a positive integer approximately markdown.length / 4
    expect(r.json).toHaveProperty("tokens_estimated");
    expect(typeof r.json.tokens_estimated).toBe("number");
    expect(r.json.tokens_estimated).toBeGreaterThan(0);
    expect(r.json.tokens_estimated).toBeLessThanOrEqual(Math.ceil(markdown.length / 4) + 1);
    // instrument_classification must be present
    expect(r.json).toHaveProperty("instrument_classification");
    expect(["futures_primary", "futures_with_forex_illustration", "non_futures_primary"]).toContain(
      r.json.instrument_classification,
    );
    // Single mock call → single_pass
    expect(r.json.extraction_mode).toBe("single_pass");
    expect(callScoutExtractLlmMock).toHaveBeenCalledTimes(1);
  });
});
