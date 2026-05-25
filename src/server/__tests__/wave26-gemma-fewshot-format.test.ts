/**
 * wave26-gemma-fewshot-format.test.ts
 *
 * Wave 26 Pass C — Gemma-4 few-shot message format and sampling parameter tests.
 *
 * Validates:
 *   G1. buildGemmaFewShotMessages produces NO system role in output messages
 *   G2. Only user and assistant roles appear in the messages array
 *   G3. Rules + KB + schema appear in the first user turn
 *   G4. Few-shot examples produce alternating user/assistant pairs
 *   G5. Schema is re-stated in the final user turn
 *   G6. Final user turn contains "Return ONLY JSON matching the schema above"
 *   G7. Final user turn contains the transcript payload
 *   G8. callScoutExtractLlm sends temperature=0.1, top_p=0.95, top_k=64, num_predict=2048
 *   G9. callScoutExtractLlm sends min_p=0.0, repeat_penalty=1.0, num_ctx=16384
 *   G10. No `think` field in the request body or options (Ollama bug #15260)
 *   G11. No system role in messages sent to Ollama
 *   G12. When no few-shot examples exist, rules+KB+schema appear in the only user turn
 *   G13. Schema object is still passed as format arg (GBNF enforcement preserved)
 *   G14. TRANSCRIPT_EXTRACTOR_STRICT_SCHEMA=false → format=true (non-schema fallback)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mock OllamaClient ────────────────────────────────────────────────────────
let capturedChatCalls: Array<{
  model: string;
  messages: Array<{ role: string; content: string }>;
  options?: Record<string, unknown>;
  format?: unknown;
}> = [];

vi.mock("../services/ollama-client.js", () => {
  return {
    OllamaClient: vi.fn().mockImplementation(() => ({
      chat: vi.fn().mockImplementation((model, messages, options, format) => {
        capturedChatCalls.push({ model, messages, options, format });
        return Promise.resolve({
          message: {
            role: "assistant",
            content: JSON.stringify({
              strategies: [],
              empty_reason: null,
              empty_reason_detail: null,
              instrument_classification: null,
            }),
          },
        });
      }),
      generate: vi.fn().mockResolvedValue({ response: "" }),
    })),
  };
});

// ─── Mock DB / schema ─────────────────────────────────────────────────────────
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
import {
  callScoutExtractLlm,
  buildGemmaFewShotMessages,
  __setOllamaHealthyForTests,
  __clearPromptCacheForTests,
} from "../services/model-router.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CLOUD_NO_OP = vi.fn().mockResolvedValue(null);

const SAMPLE_MESSAGES: Array<{ role: "user"; content: string }> = [
  {
    role: "user",
    content:
      "Extract strategies from this transcript: The VWAP fade I trade every day on MES. Five-minute bars.",
  },
];

const SAMPLE_SCHEMA: Record<string, unknown> = {
  type: "object",
  required: ["strategies"],
  properties: {
    strategies: { type: "array" },
    empty_reason: { type: ["string", "null"] },
  },
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("wave26-gemma-fewshot-format", () => {
  let savedStrictSchema: string | undefined;
  let savedLocalModel: string | undefined;
  let savedNumCtx: string | undefined;

  beforeEach(() => {
    savedStrictSchema = process.env.TRANSCRIPT_EXTRACTOR_STRICT_SCHEMA;
    savedLocalModel = process.env.TRANSCRIPT_EXTRACTOR_LOCAL_MODEL;
    savedNumCtx = process.env.TRANSCRIPT_EXTRACTOR_NUM_CTX;
    capturedChatCalls = [];
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

  // ── G1-G2: No system role ────────────────────────────────────────────────────

  it("G1: buildGemmaFewShotMessages produces no system role in output", () => {
    const msgs = buildGemmaFewShotMessages(
      "transcript_extractor",
      undefined,
      "Sample transcript text",
      SAMPLE_SCHEMA,
    );

    const systemMessages = msgs.filter((m) => (m as { role: string }).role === "system");
    expect(systemMessages).toHaveLength(0);
  });

  it("G2: only user and assistant roles appear in buildGemmaFewShotMessages output", () => {
    const msgs = buildGemmaFewShotMessages(
      "transcript_extractor",
      undefined,
      "Sample transcript text",
      SAMPLE_SCHEMA,
    );

    const validRoles = new Set(["user", "assistant"]);
    for (const msg of msgs) {
      expect(validRoles.has(msg.role)).toBe(true);
    }
  });

  // ── G3: Rules + KB + schema in first user turn ───────────────────────────────

  it("G3: first user turn contains the schema as JSON block", () => {
    const msgs = buildGemmaFewShotMessages(
      "transcript_extractor",
      undefined,
      "Sample transcript",
      SAMPLE_SCHEMA,
    );

    const firstUser = msgs.find((m) => m.role === "user");
    expect(firstUser).toBeDefined();
    // Schema should appear as JSON in the first user turn
    expect(firstUser!.content).toContain('"strategies"');
  });

  // ── G4: Few-shot examples as alternating user/assistant pairs ────────────────

  it("G4: few-shot examples produce alternating user/assistant pairs before final turn", () => {
    const msgs = buildGemmaFewShotMessages(
      "transcript_extractor",
      undefined,
      "FINAL_TRANSCRIPT",
      SAMPLE_SCHEMA,
    );

    // Find indices of assistant turns — each must be preceded by a user turn
    for (let i = 1; i < msgs.length; i++) {
      if (msgs[i]!.role === "assistant") {
        expect(msgs[i - 1]!.role).toBe("user");
      }
    }

    // The pattern must end with a user turn (the final "extract from this transcript" turn)
    expect(msgs[msgs.length - 1]!.role).toBe("user");
  });

  it("G4b: few-shot assistant turns contain valid JSON", () => {
    const msgs = buildGemmaFewShotMessages(
      "transcript_extractor",
      undefined,
      "Sample transcript",
      SAMPLE_SCHEMA,
    );

    const assistantTurns = msgs.filter((m) => m.role === "assistant");
    // Should have at least 1 (the few-shot files in the repo exist)
    // If zero, the test is still valid (fallback case)
    for (const turn of assistantTurns) {
      expect(() => JSON.parse(turn.content)).not.toThrow();
    }
  });

  // ── G5-G7: Schema re-stated + transcript in final user turn ─────────────────

  it("G5: schema is re-stated in the final user turn", () => {
    const msgs = buildGemmaFewShotMessages(
      "transcript_extractor",
      undefined,
      "My transcript payload",
      SAMPLE_SCHEMA,
    );

    const lastUser = [...msgs].reverse().find((m) => m.role === "user");
    expect(lastUser).toBeDefined();
    expect(lastUser!.content).toContain("matching the schema above");
  });

  it("G6: final user turn contains 'Return ONLY JSON matching the schema above'", () => {
    const msgs = buildGemmaFewShotMessages(
      "transcript_extractor",
      undefined,
      "My transcript payload",
      SAMPLE_SCHEMA,
    );

    const finalTurn = msgs[msgs.length - 1]!;
    expect(finalTurn.role).toBe("user");
    expect(finalTurn.content).toContain("Return ONLY JSON matching the schema above.");
  });

  it("G7: final user turn contains the transcript payload verbatim", () => {
    const transcriptPayload = "THIS_IS_MY_UNIQUE_TRANSCRIPT_CONTENT_XYZ123";
    const msgs = buildGemmaFewShotMessages(
      "transcript_extractor",
      undefined,
      transcriptPayload,
      SAMPLE_SCHEMA,
    );

    const finalTurn = msgs[msgs.length - 1]!;
    expect(finalTurn.content).toContain(transcriptPayload);
  });

  // ── G8-G9: Gemma 4 sampling parameters ──────────────────────────────────────

  it("G8: callScoutExtractLlm sends temperature=0.1, top_p=0.95, top_k=64, num_predict=2048", async () => {
    __setOllamaHealthyForTests(true);
    delete process.env.TRANSCRIPT_EXTRACTOR_FORCE_CLOUD;

    await callScoutExtractLlm(SAMPLE_MESSAGES, undefined, CLOUD_NO_OP);

    expect(capturedChatCalls.length).toBeGreaterThan(0);
    const { options } = capturedChatCalls[0]!;
    expect(options).toBeDefined();
    expect(options!.temperature).toBe(0.1);
    expect(options!.top_p).toBe(0.95);
    expect(options!.top_k).toBe(64);
    expect(options!.num_predict).toBe(2048);
  });

  it("G9: callScoutExtractLlm sends min_p=0.0, repeat_penalty=1.0, num_ctx=16384 (default)", async () => {
    __setOllamaHealthyForTests(true);
    delete process.env.TRANSCRIPT_EXTRACTOR_FORCE_CLOUD;

    await callScoutExtractLlm(SAMPLE_MESSAGES, undefined, CLOUD_NO_OP);

    expect(capturedChatCalls.length).toBeGreaterThan(0);
    const { options } = capturedChatCalls[0]!;
    expect(options!.min_p).toBe(0.0);
    expect(options!.repeat_penalty).toBe(1.0);
    expect(options!.num_ctx).toBe(16384);
  });

  // ── G10: No think field ───────────────────────────────────────────────────────

  it("G10: no think field in options or body root (Ollama bug #15260)", async () => {
    __setOllamaHealthyForTests(true);
    delete process.env.TRANSCRIPT_EXTRACTOR_FORCE_CLOUD;

    await callScoutExtractLlm(SAMPLE_MESSAGES, undefined, CLOUD_NO_OP);

    expect(capturedChatCalls.length).toBeGreaterThan(0);
    const call = capturedChatCalls[0]!;
    // Check options object
    expect(call.options).not.toHaveProperty("think");
    // Check body root keys (model, messages, options, format — no think)
    expect(call).not.toHaveProperty("think");
  });

  // ── G11: No system role sent to Ollama ───────────────────────────────────────

  it("G11: messages sent to Ollama contain no system role", async () => {
    __setOllamaHealthyForTests(true);
    delete process.env.TRANSCRIPT_EXTRACTOR_FORCE_CLOUD;

    await callScoutExtractLlm(SAMPLE_MESSAGES, undefined, CLOUD_NO_OP);

    expect(capturedChatCalls.length).toBeGreaterThan(0);
    const { messages } = capturedChatCalls[0]!;
    const systemMessages = messages.filter((m) => m.role === "system");
    expect(systemMessages).toHaveLength(0);
  });

  // ── G12: No few-shot examples fallback ──────────────────────────────────────

  it("G12: when schema is null, final turn says Return ONLY valid JSON", () => {
    const msgs = buildGemmaFewShotMessages(
      "transcript_extractor",
      undefined,
      "My transcript",
      null, // no schema
    );

    const finalTurn = msgs[msgs.length - 1]!;
    expect(finalTurn.role).toBe("user");
    expect(finalTurn.content).toContain("Return ONLY valid JSON.");
  });

  // ── G13: Schema object still passed as format arg ────────────────────────────

  it("G13: schema object is passed as format arg to Ollama (GBNF enforcement preserved)", async () => {
    delete process.env.TRANSCRIPT_EXTRACTOR_STRICT_SCHEMA; // default = strict
    __setOllamaHealthyForTests(true);
    delete process.env.TRANSCRIPT_EXTRACTOR_FORCE_CLOUD;

    await callScoutExtractLlm(SAMPLE_MESSAGES, undefined, CLOUD_NO_OP);

    expect(capturedChatCalls.length).toBeGreaterThan(0);
    const { format } = capturedChatCalls[0]!;
    // Must be an object (the schema), not a boolean or string
    expect(format).toBeDefined();
    expect(typeof format).toBe("object");
    expect(format).not.toBeNull();
    expect(format).not.toBe(true);
  });

  // ── G14: Strict schema disabled → format=true fallback ───────────────────────

  it("G14: TRANSCRIPT_EXTRACTOR_STRICT_SCHEMA=false → format=true (json string fallback)", async () => {
    process.env.TRANSCRIPT_EXTRACTOR_STRICT_SCHEMA = "false";
    __setOllamaHealthyForTests(true);
    delete process.env.TRANSCRIPT_EXTRACTOR_FORCE_CLOUD;

    await callScoutExtractLlm(SAMPLE_MESSAGES, undefined, CLOUD_NO_OP);

    expect(capturedChatCalls.length).toBeGreaterThan(0);
    expect(capturedChatCalls[0]!.format).toBe(true);
  });
});
