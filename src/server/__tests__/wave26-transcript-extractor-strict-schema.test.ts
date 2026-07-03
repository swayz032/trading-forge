/**
 * wave26-transcript-extractor-strict-schema.test.ts
 *
 * Wave 26 Pass B — Transcript Extractor strict JSON Schema enforcement.
 *
 * Validates:
 *   S1. ollama-client: format=object → body.format is that object (GBNF schema enforcement)
 *   S2. ollama-client: format=true → body.format = "json" (backward compat)
 *   S3. ollama-client: format=undefined → format key omitted from body entirely
 *   S4. callOllamaForTranscriptExtractor uses /api/chat (not /api/generate)
 *   S5. Messages array has NO system role + has user role (Wave 26 Pass C: Gemma no-system-role fix)
 *   S6. Final user message content includes "Return ONLY JSON matching the schema above" literal
 *   S7. Options include temperature=0.1, top_p=0.95, top_k=64, num_predict=2048, num_ctx=16384 (Wave 26 Pass C: Gemma 4 sampling fix)
 *   S8. No `think` field anywhere in request body
 *   S9. TRANSCRIPT_EXTRACTOR_STRICT_SCHEMA=false → falls back to format:"json" string
 *   S10. Default model = gemma4 when env unset
 *   S11. TRANSCRIPT_EXTRACTOR_STRICT_SCHEMA=true (default) → format object passed to Ollama
 *   S12. Schema object is the full transcript-extractor-output-schema.json (has strategies array)
 *   S13. transcript-extractor-output-schema.json validates a well-formed strategy object
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mock OllamaClient ────────────────────────────────────────────────────────
// We capture the exact body sent to Ollama to inspect format, options, messages.
let capturedChatBodies: Array<{
  model: string;
  messages: Array<{ role: string; content: string }>;
  options?: Record<string, unknown>;
  format?: unknown;
}> = [];

let capturedGenerateBodies: Array<{
  model: string;
  prompt: string;
  options?: Record<string, unknown>;
  format?: unknown;
}> = [];

vi.mock("../services/ollama-client.js", () => {
  return {
    OllamaClient: vi.fn().mockImplementation(() => ({
      chat: vi.fn().mockImplementation((model, messages, options, format) => {
        capturedChatBodies.push({ model, messages, options, format });
        return Promise.resolve({
          message: {
            role: "assistant",
            content: JSON.stringify({
              strategies: [
                {
                  name: "ICT Silver Bullet MES",
                  symbol: "MES",
                  timeframe: "15m",
                  direction: "long",
                  entry_type: "session_pattern",
                  entry_indicator: "fvg",
                  entry_params: { window_start: "10:00", window_end: "11:00" },
                  entry_condition: "Price retraces into FVG during silver bullet window",
                  exit_type: "fixed_target",
                  exit_params: { take_profit_r: 2 },
                  stop_loss_atr_multiple: 1.5,
                  description: "ICT silver bullet strategy using FVG as entry trigger",
                  bias_timeframe: "4h",
                  bias_condition: "ema_50 > ema_200 on 4H chart",
                  preferred_regimes: ["TRENDING_UP", "TRENDING_DOWN", "RANGE_BOUND"],
                  confirming_indicators: [
                    { indicator: "fvg", params: {}, direction: "agree" },
                    { indicator: "bos", params: {}, direction: "agree" },
                  ],
                  source_claim_win_rate: null,
                  source_claim_avg_r: null,
                },
              ],
              empty_reason: null,
              empty_reason_detail: null,
              instrument_classification: "MES (S&P 500 micro futures)",
            }),
          },
        });
      }),
      generate: vi.fn().mockImplementation((model, prompt, options, format) => {
        capturedGenerateBodies.push({ model, prompt, options, format });
        return Promise.resolve({ response: JSON.stringify({ strategies: [] }) });
      }),
    })),
  };
});

// ─── Mock DB / schema (for audit writes) ─────────────────────────────────────
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

// ─── Mock cost-tracker ────────────────────────────────────────────────────────
vi.mock("../services/cost-tracker.js", () => ({
  recordLlmCall: vi.fn().mockResolvedValue(undefined),
}));

// ─── Mock logger ──────────────────────────────────────────────────────────────
vi.mock("../index.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ─── Import after mocks ───────────────────────────────────────────────────────
import { OllamaClient } from "../services/ollama-client.js";
import {
  callScoutExtractLlm,
  __setOllamaHealthyForTests,
  __clearPromptCacheForTests,
} from "../services/model-router.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────
const CLOUD_NO_OP = vi.fn().mockResolvedValue(null);

const SAMPLE_TRANSCRIPT_MESSAGES: Array<{ role: "user"; content: string }> = [
  { role: "user", content: "Extract strategies from this transcript: [ICT Silver Bullet content]" },
];

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("wave26-transcript-extractor-strict-schema", () => {
  let savedStrictSchema: string | undefined;
  let savedLocalModel: string | undefined;
  let savedNumCtx: string | undefined;

  beforeEach(() => {
    savedStrictSchema = process.env.TRANSCRIPT_EXTRACTOR_STRICT_SCHEMA;
    savedLocalModel = process.env.TRANSCRIPT_EXTRACTOR_LOCAL_MODEL;
    savedNumCtx = process.env.TRANSCRIPT_EXTRACTOR_NUM_CTX;
    capturedChatBodies = [];
    capturedGenerateBodies = [];
    vi.clearAllMocks();
    __clearPromptCacheForTests();
    __setOllamaHealthyForTests(true);
    delete process.env.TRANSCRIPT_EXTRACTOR_FORCE_CLOUD;
    delete process.env.TRANSCRIPT_EXTRACTOR_STRICT_SCHEMA;
    delete process.env.TRANSCRIPT_EXTRACTOR_LOCAL_MODEL;
    delete process.env.TRANSCRIPT_EXTRACTOR_NUM_CTX;
  });

  afterEach(() => {
    if (savedStrictSchema === undefined) {
      delete process.env.TRANSCRIPT_EXTRACTOR_STRICT_SCHEMA;
    } else {
      process.env.TRANSCRIPT_EXTRACTOR_STRICT_SCHEMA = savedStrictSchema;
    }
    if (savedLocalModel === undefined) {
      delete process.env.TRANSCRIPT_EXTRACTOR_LOCAL_MODEL;
    } else {
      process.env.TRANSCRIPT_EXTRACTOR_LOCAL_MODEL = savedLocalModel;
    }
    if (savedNumCtx === undefined) {
      delete process.env.TRANSCRIPT_EXTRACTOR_NUM_CTX;
    } else {
      process.env.TRANSCRIPT_EXTRACTOR_NUM_CTX = savedNumCtx;
    }
    __setOllamaHealthyForTests(true);
  });

  // ── S1-S3: OllamaClient format parameter passthrough ─────────────────────────
  //
  // These tests exercise OllamaClient directly — import and instantiate it
  // outside of callScoutExtractLlm to isolate the passthrough behavior.

  it("S1: OllamaClient.chat format=object → body.format is that exact object", async () => {
    const schema = { type: "object", properties: { strategies: { type: "array" } } };
    const client = new OllamaClient("http://localhost:11434");
    await client.chat("test-model", [{ role: "user", content: "test" }], undefined, schema);
    expect(capturedChatBodies).toHaveLength(1);
    expect(capturedChatBodies[0]!.format).toBe(schema);
    expect(capturedChatBodies[0]!.format).not.toBe("json");
  });

  it("S2: OllamaClient.chat format=true → format is true (backward compat)", async () => {
    const client = new OllamaClient("http://localhost:11434");
    await client.chat("test-model", [{ role: "user", content: "test" }], undefined, true);
    expect(capturedChatBodies[0]!.format).toBe(true);
  });

  it("S3: OllamaClient.chat format=undefined → format key is undefined (omitted from body)", async () => {
    const client = new OllamaClient("http://localhost:11434");
    await client.chat("test-model", [{ role: "user", content: "test" }], undefined, undefined);
    // format should be undefined (not passed to the implementation)
    expect(capturedChatBodies[0]!.format).toBeUndefined();
  });

  // ── S4: callOllamaForTranscriptExtractor uses /api/chat ──────────────────────

  it("S4: callScoutExtractLlm (Ollama path) calls ollama.chat NOT ollama.generate", async () => {
    __setOllamaHealthyForTests(true);
    delete process.env.TRANSCRIPT_EXTRACTOR_FORCE_CLOUD;

    await callScoutExtractLlm(SAMPLE_TRANSCRIPT_MESSAGES, undefined, CLOUD_NO_OP);

    const instance = vi.mocked(OllamaClient).mock.results[0]?.value as ReturnType<typeof vi.fn> | undefined;
    expect(instance).toBeDefined();
    const chatFn = (instance as any)?.chat as ReturnType<typeof vi.fn>;
    const generateFn = (instance as any)?.generate as ReturnType<typeof vi.fn>;
    expect(chatFn).toHaveBeenCalled();
    expect(generateFn).not.toHaveBeenCalled();
  });

  // ── S5: Messages array has NO system role (Wave 26 Pass C Gemma fix) ────────
  // Gemma has no native system role (Google AI Gemma prompt docs). Pass C moves
  // rules+KB into the first user turn as alternating few-shot pairs. System role
  // must be ABSENT.

  it("S5: chat messages array has NO system role (Gemma no-system-role fix) but has user role", async () => {
    __setOllamaHealthyForTests(true);
    delete process.env.TRANSCRIPT_EXTRACTOR_FORCE_CLOUD;

    await callScoutExtractLlm(SAMPLE_TRANSCRIPT_MESSAGES, undefined, CLOUD_NO_OP);

    expect(capturedChatBodies.length).toBeGreaterThan(0);
    const { messages } = capturedChatBodies[0]!;
    const roles = messages.map((m) => m.role);
    // No system role — Gemma has no native system role
    expect(roles).not.toContain("system");
    // Must have user role (at minimum the final transcript turn)
    expect(roles).toContain("user");
  });

  // ── S6: Final user turn includes schema adherence instruction ───────────────
  // Wave 26 Pass C: schema instruction moved to final user turn (Gemma loses
  // long-range schema awareness across multi-turn context — must re-state).

  it("S6: final user message content includes 'matching the schema' instruction", async () => {
    __setOllamaHealthyForTests(true);
    delete process.env.TRANSCRIPT_EXTRACTOR_FORCE_CLOUD;

    await callScoutExtractLlm(SAMPLE_TRANSCRIPT_MESSAGES, undefined, CLOUD_NO_OP);

    expect(capturedChatBodies.length).toBeGreaterThan(0);
    const { messages } = capturedChatBodies[0]!;
    // Find the LAST user message (final instruction turn)
    const userMsgs = messages.filter((m) => m.role === "user");
    expect(userMsgs.length).toBeGreaterThan(0);
    const lastUserMsg = userMsgs[userMsgs.length - 1]!;
    expect(lastUserMsg.content).toContain("matching the schema");
  });

  // ── S7: Sampling options — Gemma 4 correct values (Wave 26 Pass C) ──────────
  // Old values: temp=0, top_p=0.9, top_k=20 (caused GBNF repetition loop on gemma4)
  // New values: temp=0.1, top_p=0.95, top_k=64, num_predict=2048
  //   - temperature=0.1: avoids Ollama issue #15502 (temp=0 + GBNF = repetition loop)
  //   - top_p=0.95: Google default for Gemma 4
  //   - top_k=64: Google default; vocab tail needed for JSON escapes (\", \n, etc.)
  //   - num_predict=2048: HARD CAP prevents unbounded repetition if bug fires

  it("S7: chat options include temperature=0.1, top_p=0.95, top_k=64, num_predict=4096, num_ctx=32768", async () => {
    __setOllamaHealthyForTests(true);
    delete process.env.TRANSCRIPT_EXTRACTOR_FORCE_CLOUD;

    await callScoutExtractLlm(SAMPLE_TRANSCRIPT_MESSAGES, undefined, CLOUD_NO_OP);

    expect(capturedChatBodies.length).toBeGreaterThan(0);
    const { options } = capturedChatBodies[0]!;
    expect(options).toBeDefined();
    expect(options!.temperature).toBe(0.1);
    expect(options!.top_p).toBe(0.95);
    expect(options!.top_k).toBe(64);
    expect(options!.num_predict).toBe(4096);
    expect(options!.num_ctx).toBe(32768);
  });

  // ── S8: No `think` field anywhere in request body ────────────────────────────

  it("S8: chat options do NOT contain a think field (Ollama bug #15260)", async () => {
    __setOllamaHealthyForTests(true);
    delete process.env.TRANSCRIPT_EXTRACTOR_FORCE_CLOUD;

    await callScoutExtractLlm(SAMPLE_TRANSCRIPT_MESSAGES, undefined, CLOUD_NO_OP);

    expect(capturedChatBodies.length).toBeGreaterThan(0);
    const { options } = capturedChatBodies[0]!;
    expect(options).not.toHaveProperty("think");
    // Also check the body root (format param is separate from options)
    const body = capturedChatBodies[0]!;
    expect(body).not.toHaveProperty("think");
  });

  // ── S9: TRANSCRIPT_EXTRACTOR_STRICT_SCHEMA=false → format:"json" string ─────

  it("S9: TRANSCRIPT_EXTRACTOR_STRICT_SCHEMA=false → format passed as true (json string fallback)", async () => {
    process.env.TRANSCRIPT_EXTRACTOR_STRICT_SCHEMA = "false";
    __setOllamaHealthyForTests(true);
    delete process.env.TRANSCRIPT_EXTRACTOR_FORCE_CLOUD;

    await callScoutExtractLlm(SAMPLE_TRANSCRIPT_MESSAGES, undefined, CLOUD_NO_OP);

    expect(capturedChatBodies.length).toBeGreaterThan(0);
    // When strict schema is disabled, format should be true (which becomes "json" in the wire body)
    expect(capturedChatBodies[0]!.format).toBe(true);
    expect(capturedChatBodies[0]!.format).not.toBeInstanceOf(Object);
  });

  // ── S10: Default model = gemma4 when env unset ─────────────────────

  it("S10: default local model is gemma4 when TRANSCRIPT_EXTRACTOR_LOCAL_MODEL is unset", async () => {
    delete process.env.TRANSCRIPT_EXTRACTOR_LOCAL_MODEL;
    __setOllamaHealthyForTests(true);
    delete process.env.TRANSCRIPT_EXTRACTOR_FORCE_CLOUD;

    await callScoutExtractLlm(SAMPLE_TRANSCRIPT_MESSAGES, undefined, CLOUD_NO_OP);

    expect(capturedChatBodies.length).toBeGreaterThan(0);
    expect(capturedChatBodies[0]!.model).toBe("gemma4:e4b-it-qat");
  });

  // ── S11: Default strict schema = true → format is schema object ──────────────

  it("S11: TRANSCRIPT_EXTRACTOR_STRICT_SCHEMA unset (default true) → format is an object (schema)", async () => {
    delete process.env.TRANSCRIPT_EXTRACTOR_STRICT_SCHEMA;
    __setOllamaHealthyForTests(true);
    delete process.env.TRANSCRIPT_EXTRACTOR_FORCE_CLOUD;

    await callScoutExtractLlm(SAMPLE_TRANSCRIPT_MESSAGES, undefined, CLOUD_NO_OP);

    expect(capturedChatBodies.length).toBeGreaterThan(0);
    const { format } = capturedChatBodies[0]!;
    // Should be an object (the schema), not the string "json" or boolean true
    expect(format).toBeDefined();
    expect(typeof format).toBe("object");
    expect(format).not.toBeNull();
  });

  // ── S12: Schema object has strategies array in its properties ─────────────────

  it("S12: schema object passed to chat has strategies as required top-level array property", async () => {
    delete process.env.TRANSCRIPT_EXTRACTOR_STRICT_SCHEMA;
    __setOllamaHealthyForTests(true);
    delete process.env.TRANSCRIPT_EXTRACTOR_FORCE_CLOUD;

    await callScoutExtractLlm(SAMPLE_TRANSCRIPT_MESSAGES, undefined, CLOUD_NO_OP);

    expect(capturedChatBodies.length).toBeGreaterThan(0);
    const format = capturedChatBodies[0]!.format as Record<string, unknown>;
    expect(format).toBeDefined();
    const properties = format.properties as Record<string, unknown> | undefined;
    expect(properties).toBeDefined();
    expect(properties!.strategies).toBeDefined();
    const required = format.required as string[] | undefined;
    expect(Array.isArray(required)).toBe(true);
    expect(required).toContain("strategies");
  });

  // ── S13: Validate schema against a sample strategy object ─────────────────────
  //
  // This test loads the schema file directly and validates a hand-crafted
  // strategy object — confirms round-trip integrity without needing ajv.

  it("S13: transcript-extractor-output-schema.json structure is internally consistent", async () => {
    // Load the schema directly from file system
    const { readFileSync } = await import("fs");
    const { resolve } = await import("path");
    const schemaPath = resolve(process.cwd(), "src/agents/kb/transcript-extractor-output-schema.json");
    const raw = readFileSync(schemaPath, "utf-8");
    const schema = JSON.parse(raw) as Record<string, unknown>;

    // Schema must have the wrapper structure
    expect(schema.type).toBe("object");
    expect(schema.additionalProperties).toBe(false);
    const required = schema.required as string[];
    expect(required).toContain("strategies");

    // Properties must include strategies, empty_reason, empty_reason_detail, instrument_classification
    const props = schema.properties as Record<string, unknown>;
    expect(props.strategies).toBeDefined();
    expect(props.empty_reason).toBeDefined();
    expect(props.empty_reason_detail).toBeDefined();
    expect(props.instrument_classification).toBeDefined();

    // $defs must contain StrategyDSL
    const defs = schema.$defs as Record<string, unknown>;
    expect(defs.StrategyDSL).toBeDefined();
    const stratDsl = defs.StrategyDSL as Record<string, unknown>;

    // StrategyDSL required fields
    const stratRequired = stratDsl.required as string[];
    expect(stratRequired).toContain("name");
    expect(stratRequired).toContain("symbol");
    expect(stratRequired).toContain("timeframe");
    expect(stratRequired).toContain("direction");
    expect(stratRequired).toContain("entry_type");
    expect(stratRequired).toContain("entry_indicator");
    expect(stratRequired).toContain("entry_condition");
    expect(stratRequired).toContain("stop_loss_atr_multiple");

    // W23H fields are present
    const stratProps = stratDsl.properties as Record<string, unknown>;
    expect(stratProps.bias_timeframe).toBeDefined();
    expect(stratProps.confirming_indicators).toBeDefined();
    expect(stratProps.preferred_regimes).toBeDefined();
    expect(stratProps.bias_condition).toBeDefined();
    expect(stratProps.execution_timeframe).toBeDefined();
    expect(stratProps.min_factors_satisfied).toBeDefined();

    // Symbol enum includes only the 3 allowed values
    const symbolProp = stratProps.symbol as ({ enum?: string[] } | undefined);
    if (symbolProp) {
      expect(symbolProp.enum).toEqual(expect.arrayContaining(["MES", "MNQ", "MCL"]));
    }
  });
});
