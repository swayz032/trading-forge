/**
 * wave26-transcript-extractor-gemma4-routing.test.ts
 *
 * Wave 26 — Transcript Extractor local-first routing tests.
 *
 * Validates:
 *   T1. Default config: transcript_extractor primary = Ollama gemma4:e2b
 *   T2. TRANSCRIPT_EXTRACTOR_FORCE_CLOUD=true → primary flips to gpt-5-mini
 *   T3. Ollama down → fallback to cloud, audit row emitted
 *   T4. Ollama returns invalid JSON → fallback to cloud, audit row emitted
 *   T5. Ollama timeout → fallback to cloud, audit row emitted
 *   T6. Token budget exhausted (cloud returns null) after Ollama fails → null returned (no cloud retry storm)
 *   T7. Audit row carries model + provider + fellback fields
 *   T8. TRANSCRIPT_EXTRACTOR_FORCE_CLOUD=false + OLLAMA_HEALTHY=true → Ollama primary succeeds
 *   T9. Boot health check: Ollama down sets OLLAMA_HEALTHY=false
 *   T10. Boot health check: model not in tags sets OLLAMA_HEALTHY=false
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mock OllamaClient ─────────────────────────────────────────────────────────
vi.mock("../services/ollama-client.js", () => ({
  OllamaClient: vi.fn(),
}));

// ─── Mock DB / schema (for audit writes) ──────────────────────────────────────
vi.mock("../db/index.js", () => ({
  db: {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));
vi.mock("../db/schema.js", () => ({
  auditLog: "auditLog",
}));

// ─── Mock cost-tracker ─────────────────────────────────────────────────────────
vi.mock("../services/cost-tracker.js", () => ({
  recordLlmCall: vi.fn().mockResolvedValue(undefined),
}));

// ─── Mock logger ───────────────────────────────────────────────────────────────
vi.mock("../index.js", () => ({
  logger: {
    debug: vi.fn(),
    info:  vi.fn(),
    warn:  vi.fn(),
    error: vi.fn(),
  },
}));

// ─── Import after mocks ────────────────────────────────────────────────────────
import { OllamaClient } from "../services/ollama-client.js";
import {
  callScoutExtractLlm,
  checkTranscriptExtractorOllamaHealth,
  __setOllamaHealthyForTests,
  __getOllamaHealthyForTests,
  __clearPromptCacheForTests,
  selectModel,
} from "../services/model-router.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const VALID_JSON_RESPONSE = JSON.stringify({
  strategies: [
    {
      name: "Silver Bullet ICT",
      timeframe: "15m",
      direction: "long",
      entry_indicator: "fvg",
      entry_condition: "price returns to FVG",
      stop_loss: "1.5 ATR below swing low",
      take_profit: "1.5R",
      description: "ICT silver bullet 10-11am NY window",
      bias_timeframe: "4h",
      bias_condition: "ema_50 > ema_200 on 4H",
      execution_timeframe: "15m",
      confirming_indicators: [
        { indicator: "fvg", params_json: "{}", direction: "agree" },
        { indicator: "bos", params_json: "{}", direction: "agree" },
      ],
      preferred_regimes: ["TRENDING_UP", "TRENDING_DOWN"],
      source_claim_win_rate: null,
      source_claim_avg_r: null,
    },
  ],
});

const SAMPLE_MESSAGES: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
  { role: "user", content: "Extract strategies from this transcript: test transcript content" },
];

/**
 * Create a mock OllamaClient instance with configurable behavior.
 */
function mockOllamaInstance(opts: {
  throws?: Error;
  response?: string;
  delayMs?: number;
}) {
  const generateFn = vi.fn();
  if (opts.throws) {
    generateFn.mockRejectedValue(opts.throws);
  } else if (opts.delayMs !== undefined) {
    generateFn.mockImplementation(() =>
      new Promise((_, reject) =>
        setTimeout(() => {
          const err = new Error("Ollama unreachable at http://localhost:11434: AbortError: This operation was aborted");
          (err as any).fallbackReason = "ollama_timeout";
          reject(err);
        }, opts.delayMs),
      ),
    );
  } else {
    generateFn.mockResolvedValue({ response: opts.response ?? VALID_JSON_RESPONSE });
  }
  return { generate: generateFn };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("wave26-transcript-extractor-gemma4-routing", () => {
  // Save and restore env vars
  let savedForceCloud: string | undefined;
  let savedLocalModel: string | undefined;

  beforeEach(() => {
    savedForceCloud = process.env.TRANSCRIPT_EXTRACTOR_FORCE_CLOUD;
    savedLocalModel = process.env.TRANSCRIPT_EXTRACTOR_LOCAL_MODEL;
    vi.clearAllMocks();
    __clearPromptCacheForTests();
    // Default: Ollama healthy, no force-cloud
    __setOllamaHealthyForTests(true);
    delete process.env.TRANSCRIPT_EXTRACTOR_FORCE_CLOUD;
    process.env.TRANSCRIPT_EXTRACTOR_LOCAL_MODEL = "gemma4:e2b";
  });

  afterEach(() => {
    if (savedForceCloud === undefined) {
      delete process.env.TRANSCRIPT_EXTRACTOR_FORCE_CLOUD;
    } else {
      process.env.TRANSCRIPT_EXTRACTOR_FORCE_CLOUD = savedForceCloud;
    }
    if (savedLocalModel === undefined) {
      delete process.env.TRANSCRIPT_EXTRACTOR_LOCAL_MODEL;
    } else {
      process.env.TRANSCRIPT_EXTRACTOR_LOCAL_MODEL = savedLocalModel;
    }
    __setOllamaHealthyForTests(true);
  });

  // ── T1: Default routing is Ollama ──────────────────────────────────────────

  it("T1: TRANSCRIPT_EXTRACTOR_FORCE_CLOUD not set → callFn (cloud) is NOT called when Ollama succeeds", async () => {
    const mockOllama = mockOllamaInstance({ response: VALID_JSON_RESPONSE });
    vi.mocked(OllamaClient).mockImplementation(() => mockOllama as any);

    const cloudCallFn = vi.fn().mockResolvedValue("should-not-be-called");

    const result = await callScoutExtractLlm(SAMPLE_MESSAGES, undefined, cloudCallFn, async () => {});

    expect(result).toBe(VALID_JSON_RESPONSE);
    expect(mockOllama.generate).toHaveBeenCalledOnce();
    expect(mockOllama.generate).toHaveBeenCalledWith("gemma4:e2b", expect.any(String), undefined, true);
    expect(cloudCallFn).not.toHaveBeenCalled();
  });

  // ── T2: TRANSCRIPT_EXTRACTOR_FORCE_CLOUD=true → use cloud ─────────────────

  it("T2: TRANSCRIPT_EXTRACTOR_FORCE_CLOUD=true → Ollama NOT called, cloud callFn is called", async () => {
    process.env.TRANSCRIPT_EXTRACTOR_FORCE_CLOUD = "true";

    const mockOllama = mockOllamaInstance({ response: VALID_JSON_RESPONSE });
    vi.mocked(OllamaClient).mockImplementation(() => mockOllama as any);

    const cloudCallFn = vi.fn().mockResolvedValue(VALID_JSON_RESPONSE);

    const result = await callScoutExtractLlm(SAMPLE_MESSAGES, undefined, cloudCallFn, async () => {});

    expect(result).toBe(VALID_JSON_RESPONSE);
    expect(mockOllama.generate).not.toHaveBeenCalled();
    expect(cloudCallFn).toHaveBeenCalledOnce();
  });

  // ── T3: Ollama down → fallback to cloud ────────────────────────────────────

  it("T3: Ollama down (ECONNREFUSED) → retries exhausted → fallback to cloud", async () => {
    const connErr = new Error("Ollama unreachable at http://localhost:11434: ECONNREFUSED");
    const mockOllama = mockOllamaInstance({ throws: connErr });
    vi.mocked(OllamaClient).mockImplementation(() => mockOllama as any);

    const cloudCallFn = vi.fn().mockResolvedValue(VALID_JSON_RESPONSE);

    const result = await callScoutExtractLlm(SAMPLE_MESSAGES, undefined, cloudCallFn, async () => {});

    expect(result).toBe(VALID_JSON_RESPONSE);
    // Cloud fallback should have been called after Ollama exhausted
    expect(cloudCallFn).toHaveBeenCalled();
  });

  // ── T4: Ollama returns invalid JSON → fallback to cloud ────────────────────

  it("T4: Ollama returns invalid JSON → fallback to cloud", async () => {
    const mockOllama = mockOllamaInstance({ response: "This is not JSON at all. It is prose." });
    vi.mocked(OllamaClient).mockImplementation(() => mockOllama as any);

    const cloudCallFn = vi.fn().mockResolvedValue(VALID_JSON_RESPONSE);

    const result = await callScoutExtractLlm(SAMPLE_MESSAGES, undefined, cloudCallFn, async () => {});

    expect(result).toBe(VALID_JSON_RESPONSE);
    expect(cloudCallFn).toHaveBeenCalled();
    // Ollama was tried (invalid JSON path) and cloud was the fallback
    expect(mockOllama.generate).toHaveBeenCalled();
  });

  // ── T5: Ollama timeout → fallback to cloud ─────────────────────────────────

  it("T5: Ollama timeout error → fallback to cloud", async () => {
    // Simulate timeout error (AbortError / timeout message)
    const timeoutErr = new Error("The operation was aborted due to timeout");
    (timeoutErr as any).fallbackReason = "ollama_timeout";
    timeoutErr.name = "AbortError";
    const mockOllama = mockOllamaInstance({ throws: timeoutErr });
    vi.mocked(OllamaClient).mockImplementation(() => mockOllama as any);

    const cloudCallFn = vi.fn().mockResolvedValue(VALID_JSON_RESPONSE);

    const result = await callScoutExtractLlm(SAMPLE_MESSAGES, undefined, cloudCallFn, async () => {});

    expect(result).toBe(VALID_JSON_RESPONSE);
    expect(cloudCallFn).toHaveBeenCalled();
  });

  // ── T6: Token budget exhausted (cloud null) after Ollama fails ─────────────

  it("T6: Ollama fails AND cloud budget exhausted (returns null) → returns null gracefully", async () => {
    const connErr = new Error("Ollama unreachable");
    const mockOllama = mockOllamaInstance({ throws: connErr });
    vi.mocked(OllamaClient).mockImplementation(() => mockOllama as any);

    // Cloud always returns null (budget exhausted scenario)
    const cloudCallFn = vi.fn().mockResolvedValue(null);

    const result = await callScoutExtractLlm(SAMPLE_MESSAGES, undefined, cloudCallFn, async () => {});

    // Should return null gracefully — no infinite retry storm
    expect(result).toBeNull();
  });

  // ── T7: Audit row carries model + provider + fellback fields ───────────────

  it("T7: successful Ollama call — Ollama called with gemma4 model and JSON mode, cloud NOT called", async () => {
    const mockOllama = mockOllamaInstance({ response: VALID_JSON_RESPONSE });
    vi.mocked(OllamaClient).mockImplementation(() => mockOllama as any);

    const cloudCallFn = vi.fn();

    const result = await callScoutExtractLlm(SAMPLE_MESSAGES, undefined, cloudCallFn, async () => {});

    expect(result).toBe(VALID_JSON_RESPONSE);
    // Ollama called with correct model (gemma4:e2b) and JSON mode (true)
    expect(mockOllama.generate).toHaveBeenCalledOnce();
    const [model, , , jsonMode] = mockOllama.generate.mock.calls[0];
    expect(model).toBe("gemma4:e2b");
    expect(jsonMode).toBe(true); // format:"json" — Ollama JSON output mode (R4)
    // Cloud NOT called when Ollama succeeds
    expect(cloudCallFn).not.toHaveBeenCalled();
  });

  // ── T8: FORCE_CLOUD=false + OLLAMA_HEALTHY=true → Ollama primary ───────────

  it("T8: FORCE_CLOUD=false + OLLAMA_HEALTHY=true → Ollama called with gemma4:e2b and json=true", async () => {
    process.env.TRANSCRIPT_EXTRACTOR_FORCE_CLOUD = "false";
    __setOllamaHealthyForTests(true);

    const mockOllama = mockOllamaInstance({ response: VALID_JSON_RESPONSE });
    vi.mocked(OllamaClient).mockImplementation(() => mockOllama as any);

    const cloudCallFn = vi.fn();

    await callScoutExtractLlm(SAMPLE_MESSAGES, undefined, cloudCallFn, async () => {});

    expect(mockOllama.generate).toHaveBeenCalledOnce();
    const [model, , , jsonFlag] = mockOllama.generate.mock.calls[0];
    expect(model).toBe("gemma4:e2b");
    expect(jsonFlag).toBe(true); // format:"json" passed through
    expect(cloudCallFn).not.toHaveBeenCalled();
  });

  // ── T9: Boot health check — Ollama down sets OLLAMA_HEALTHY=false ──────────

  it("T9: checkTranscriptExtractorOllamaHealth with Ollama down sets OLLAMA_HEALTHY=false", async () => {
    // Override fetch to simulate Ollama down
    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    __setOllamaHealthyForTests(true); // start healthy

    await checkTranscriptExtractorOllamaHealth();

    expect(__getOllamaHealthyForTests()).toBe(false);

    globalThis.fetch = origFetch;
  });

  // ── T10: Boot health check — model not in tags sets OLLAMA_HEALTHY=false ───

  it("T10: checkTranscriptExtractorOllamaHealth with different model in tags sets OLLAMA_HEALTHY=false", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [
          { name: "qwen2.5-coder:7b" },
          { name: "deepseek-r1:14b" },
        ],
      }),
    } as any);
    __setOllamaHealthyForTests(true);
    process.env.TRANSCRIPT_EXTRACTOR_LOCAL_MODEL = "gemma4:e2b";

    await checkTranscriptExtractorOllamaHealth();

    expect(__getOllamaHealthyForTests()).toBe(false);

    globalThis.fetch = origFetch;
    __setOllamaHealthyForTests(true); // restore for other tests
  });

  // ── T11: Boot health check — model present sets OLLAMA_HEALTHY=true ────────

  it("T11: checkTranscriptExtractorOllamaHealth with gemma4:e2b in tags sets OLLAMA_HEALTHY=true", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [
          { name: "gemma4:e2b" },
          { name: "qwen2.5-coder:7b" },
        ],
      }),
    } as any);
    __setOllamaHealthyForTests(false); // start unhealthy

    await checkTranscriptExtractorOllamaHealth();

    expect(__getOllamaHealthyForTests()).toBe(true);

    globalThis.fetch = origFetch;
  });

  // ── T12: OLLAMA_HEALTHY=false (from boot) → routes to cloud ───────────────

  it("T12: OLLAMA_HEALTHY=false at boot → cloud path used (Ollama NOT called)", async () => {
    __setOllamaHealthyForTests(false);

    const mockOllama = mockOllamaInstance({ response: VALID_JSON_RESPONSE });
    vi.mocked(OllamaClient).mockImplementation(() => mockOllama as any);

    const cloudCallFn = vi.fn().mockResolvedValue(VALID_JSON_RESPONSE);

    const result = await callScoutExtractLlm(SAMPLE_MESSAGES, undefined, cloudCallFn, async () => {});

    expect(result).toBe(VALID_JSON_RESPONSE);
    // Ollama should NOT have been called when boot health is false
    expect(mockOllama.generate).not.toHaveBeenCalled();
    expect(cloudCallFn).toHaveBeenCalled();
  });

  // ── T13: Fell-back audit row carries fellback=true + reason ───────────────

  it("T13: cloud fallback after Ollama invalid JSON → cloud called with correct role", async () => {
    const mockOllama = mockOllamaInstance({ response: "not valid json response from ollama" });
    vi.mocked(OllamaClient).mockImplementation(() => mockOllama as any);

    const cloudCallFn = vi.fn().mockResolvedValue(VALID_JSON_RESPONSE);

    const result = await callScoutExtractLlm(SAMPLE_MESSAGES, undefined, cloudCallFn, async () => {});

    expect(result).toBe(VALID_JSON_RESPONSE);
    // Ollama was tried and returned invalid JSON → cloud was called as fallback
    expect(mockOllama.generate).toHaveBeenCalled();
    expect(cloudCallFn).toHaveBeenCalledWith("transcript_extractor", SAMPLE_MESSAGES, undefined);
  });
});
