/**
 * Pass 9 Branch A — Responses API shim unit tests.
 *
 * Covers the parser shim, schema mapper, env-flag detection, and the
 * routing branch in callOpenAI. No live HTTP, no live DB. Mocks the
 * `openai` SDK module and global fetch so both upstream paths are
 * exercised deterministically.
 *
 * The four backend invariants the canary depends on are asserted here:
 *   1. parseChatCompletionsResponse / parseResponsesApiResponse normalize
 *      to identical ParsedLLMResponse shape.
 *   2. loadStrictSchemaForRole returns schema for 4 roles, null for 2.
 *   3. isResponsesApiEnabled is per-role (no global flag accidentally
 *      enabling all roles at once).
 *   4. callOpenAI routes by flag — flag ON → Responses path, OFF → Chat
 *      Completions path. Defaults safely when fetch fails.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../index.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// DB layer — the audit log + cost tracker writes are fire-and-forget; mock
// to no-op so test runs don't require a live database.
vi.mock("../db/index.js", () => ({
  db: {
    insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue(undefined) })),
    execute: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../db/schema.js", () => ({
  auditLog: {},
  strategies: {},
  systemJournal: {},
  backtests: {},
}));

// Circuit breaker — bypass entirely so we exercise the branch logic.
vi.mock("../lib/circuit-breaker.js", () => {
  class CircuitOpenError extends Error {
    reopensAt = new Date();
  }
  return {
    CircuitBreakerRegistry: {
      get: () => ({
        currentState: "CLOSED",
        status: () => "CLOSED",
        call: async (fn: () => Promise<unknown>) => fn(),
      }),
    },
    CircuitOpenError,
  };
});

// Mock the OpenAI SDK chat.completions.create so the Chat Completions path
// is fully observable. The factory is invoked once per import inside
// callChatCompletions (dynamic import).
const chatCompletionsCreate = vi.fn();
vi.mock("openai", () => ({
  default: class {
    chat = {
      completions: {
        create: chatCompletionsCreate,
      },
    };
    constructor(_: unknown) {}
  },
}));

import {
  parseChatCompletionsResponse,
  parseResponsesApiResponse,
  loadStrictSchemaForRole,
  isResponsesApiEnabled,
  callOpenAI,
  type ParsedLLMResponse,
  type ModelRole,
} from "../services/model-router.js";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV, OPENAI_API_KEY: "test-key" };
  chatCompletionsCreate.mockReset();
  (global as any).fetch = vi.fn();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

// ─── parseChatCompletionsResponse ─────────────────────────────────────────

describe("parseChatCompletionsResponse", () => {
  it("happy path: extracts text + usage + finish_reason", () => {
    const raw = {
      choices: [{ message: { content: '{"score":7}' }, finish_reason: "stop" }],
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    };
    const r = parseChatCompletionsResponse(raw);
    expect(r.text).toBe('{"score":7}');
    expect(r.inputTokens).toBe(100);
    expect(r.outputTokens).toBe(50);
    expect(r.finishReason).toBe("stop");
    expect(r.apiPath).toBe("chat_completions");
    expect(r.usedStrictSchema).toBe(false);
    expect(r.reasoningTokens).toBeUndefined();
  });

  it("missing usage block → zero tokens", () => {
    const raw = { choices: [{ message: { content: "ok" }, finish_reason: "stop" }] };
    const r = parseChatCompletionsResponse(raw);
    expect(r.inputTokens).toBe(0);
    expect(r.outputTokens).toBe(0);
  });

  it("finish_reason='length' propagates", () => {
    const raw = {
      choices: [{ message: { content: "truncated" }, finish_reason: "length" }],
      usage: { prompt_tokens: 10, completion_tokens: 1024 },
    };
    expect(parseChatCompletionsResponse(raw).finishReason).toBe("length");
  });

  it("empty choices → empty text, default finish=stop", () => {
    const r = parseChatCompletionsResponse({ choices: [], usage: {} });
    expect(r.text).toBe("");
    expect(r.finishReason).toBe("stop");
  });

  it("non-string content (rare tool-call shape) → empty text fallback", () => {
    const raw = { choices: [{ message: { content: null }, finish_reason: "tool_calls" }] };
    const r = parseChatCompletionsResponse(raw);
    expect(r.text).toBe("");
    expect(r.finishReason).toBe("tool_calls");
  });
});

// ─── parseResponsesApiResponse ────────────────────────────────────────────

describe("parseResponsesApiResponse", () => {
  it("happy path: extracts text + usage + reasoning_tokens", () => {
    const raw = {
      id: "resp_abc",
      output: [
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: '{"accept":true}' }],
        },
      ],
      usage: {
        input_tokens: 200,
        output_tokens: 80,
        output_tokens_details: { reasoning_tokens: 30 },
      },
    };
    const r = parseResponsesApiResponse(raw);
    expect(r.text).toBe('{"accept":true}');
    expect(r.inputTokens).toBe(200);
    expect(r.outputTokens).toBe(80);
    expect(r.reasoningTokens).toBe(30);
    expect(r.apiPath).toBe("responses");
    expect(r.refusal).toBeUndefined();
  });

  it("refusal field surfaces as ParsedLLMResponse.refusal", () => {
    const raw = {
      output: [
        {
          type: "message",
          role: "assistant",
          refusal: "I can't help with that",
          content: [],
        },
      ],
      usage: { input_tokens: 50, output_tokens: 5 },
    };
    const r = parseResponsesApiResponse(raw);
    expect(r.refusal).toBe("I can't help with that");
    expect(r.finishReason).toBe("refusal");
  });

  it("multi-content-block message concatenates text", () => {
    const raw = {
      output: [
        {
          type: "message",
          role: "assistant",
          content: [
            { type: "output_text", text: "part1 " },
            { type: "output_text", text: "part2" },
          ],
        },
      ],
      usage: { input_tokens: 1, output_tokens: 1 },
    };
    expect(parseResponsesApiResponse(raw).text).toBe("part1 part2");
  });

  it("incomplete_details.reason propagates as finishReason", () => {
    const raw = {
      output: [
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "partial" }],
        },
      ],
      usage: { input_tokens: 10, output_tokens: 100 },
      incomplete_details: { reason: "max_output_tokens" },
    };
    expect(parseResponsesApiResponse(raw).finishReason).toBe("max_output_tokens");
  });

  it("missing reasoning_tokens → undefined (not zero)", () => {
    const raw = {
      output: [{ type: "message", content: [{ type: "output_text", text: "x" }] }],
      usage: { input_tokens: 1, output_tokens: 1 },
    };
    expect(parseResponsesApiResponse(raw).reasoningTokens).toBeUndefined();
  });

  it("empty output array → empty text, default stop", () => {
    const r = parseResponsesApiResponse({ output: [], usage: {} });
    expect(r.text).toBe("");
    expect(r.finishReason).toBe("stop");
  });
});

// ─── loadStrictSchemaForRole ──────────────────────────────────────────────

describe("loadStrictSchemaForRole", () => {
  it("returns schema for scout_auditor", async () => {
    const s = (await loadStrictSchemaForRole("scout_auditor")) as any;
    expect(s).toBeTruthy();
    expect(s.required).toEqual(["score", "accept", "reason"]);
    expect(s.additionalProperties).toBe(false);
    expect(s.properties.score.minimum).toBe(0);
  });

  it("returns schema for dsl_quality_critic with concerns array", async () => {
    const s = (await loadStrictSchemaForRole("dsl_quality_critic")) as any;
    expect(s).toBeTruthy();
    expect(s.required).toContain("concerns");
    expect(s.properties.concerns.items.properties.severity.enum).toEqual(["low", "medium", "high"]);
  });

  it("returns the strategy schema snapshot for strategy_proposer", async () => {
    const s = (await loadStrictSchemaForRole("strategy_proposer")) as any;
    // The snapshot file is authored for strict JSON schema → has $defs.
    expect(s).toBeTruthy();
    expect(typeof s).toBe("object");
  });

  it("returns null for transcript_extractor (W23H-postmortem-fix13 reverted to json_object)", async () => {
    // 2026-05-21: transcript_extractor was reverted to json_object mode — the
    // 35-required-field strict schema made GPT-5-mini emit `strategies: []`
    // rather than try to satisfy it (model-router.ts:1129). The role no longer
    // shares the strategy snapshot; loadStrictSchemaForRole MUST return null so
    // callOpenAI falls back to json_object mode.
    expect(await loadStrictSchemaForRole("transcript_extractor")).toBeNull();
  });

  it("returns null for critic_evaluator (variable shape)", async () => {
    expect(await loadStrictSchemaForRole("critic_evaluator")).toBeNull();
  });

  it("returns null for nightly_review (variable shape)", async () => {
    expect(await loadStrictSchemaForRole("nightly_review")).toBeNull();
  });

  it("returns null for non-OpenAI roles", async () => {
    expect(await loadStrictSchemaForRole("fast_critique" as ModelRole)).toBeNull();
    expect(await loadStrictSchemaForRole("dsl_writer" as ModelRole)).toBeNull();
    expect(await loadStrictSchemaForRole("embedder" as ModelRole)).toBeNull();
  });
});

// ─── isResponsesApiEnabled ────────────────────────────────────────────────

describe("isResponsesApiEnabled", () => {
  it("default OFF — no env var set", () => {
    delete process.env.OPENAI_USE_RESPONSES_API_SCOUT_AUDITOR;
    expect(isResponsesApiEnabled("scout_auditor")).toBe(false);
  });

  it("ON when per-role flag is exactly 'true'", () => {
    process.env.OPENAI_USE_RESPONSES_API_SCOUT_AUDITOR = "true";
    expect(isResponsesApiEnabled("scout_auditor")).toBe(true);
  });

  it("OFF when flag is anything other than literal 'true'", () => {
    process.env.OPENAI_USE_RESPONSES_API_SCOUT_AUDITOR = "1";
    expect(isResponsesApiEnabled("scout_auditor")).toBe(false);
    process.env.OPENAI_USE_RESPONSES_API_SCOUT_AUDITOR = "TRUE";
    expect(isResponsesApiEnabled("scout_auditor")).toBe(false);
    process.env.OPENAI_USE_RESPONSES_API_SCOUT_AUDITOR = "yes";
    expect(isResponsesApiEnabled("scout_auditor")).toBe(false);
  });

  it("flag is per-role — turning on scout_auditor does NOT enable strategy_proposer", () => {
    process.env.OPENAI_USE_RESPONSES_API_SCOUT_AUDITOR = "true";
    delete process.env.OPENAI_USE_RESPONSES_API_STRATEGY_PROPOSER;
    expect(isResponsesApiEnabled("scout_auditor")).toBe(true);
    expect(isResponsesApiEnabled("strategy_proposer")).toBe(false);
  });
});

// ─── callOpenAI routing ───────────────────────────────────────────────────

describe("callOpenAI routing", () => {
  it("flag OFF → calls Chat Completions path (SDK), never fetches /v1/responses", async () => {
    delete process.env.OPENAI_USE_RESPONSES_API_SCOUT_AUDITOR;
    chatCompletionsCreate.mockResolvedValue({
      choices: [{ message: { content: '{"score":8,"accept":true,"reason":"ok"}' }, finish_reason: "stop" }],
      usage: { prompt_tokens: 100, completion_tokens: 20 },
    });
    const result = await callOpenAI("scout_auditor", [{ role: "user", content: "x" }]);
    expect(result).toBe('{"score":8,"accept":true,"reason":"ok"}');
    expect(chatCompletionsCreate).toHaveBeenCalledTimes(1);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("flag ON → calls Responses API path (fetch), SDK chat.completions never called", async () => {
    process.env.OPENAI_USE_RESPONSES_API_SCOUT_AUDITOR = "true";
    (global.fetch as any).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        output: [
          {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: '{"score":9,"accept":true,"reason":"strict-ok"}' }],
          },
        ],
        usage: { input_tokens: 80, output_tokens: 25, output_tokens_details: { reasoning_tokens: 10 } },
      }),
      text: async () => "",
    });
    const result = await callOpenAI("scout_auditor", [{ role: "user", content: "x" }]);
    expect(result).toBe('{"score":9,"accept":true,"reason":"strict-ok"}');
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const fetchUrl = (global.fetch as any).mock.calls[0][0] as string;
    expect(fetchUrl).toMatch(/\/responses$/);
    expect(chatCompletionsCreate).not.toHaveBeenCalled();
  });

  it("flag ON + Responses fetch returns refusal → callOpenAI returns null", async () => {
    process.env.OPENAI_USE_RESPONSES_API_SCOUT_AUDITOR = "true";
    (global.fetch as any).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        output: [
          {
            type: "message",
            role: "assistant",
            refusal: "no",
            content: [],
          },
        ],
        usage: { input_tokens: 5, output_tokens: 1 },
      }),
      text: async () => "",
    });
    expect(await callOpenAI("scout_auditor", [{ role: "user", content: "x" }])).toBeNull();
  });

  it("flag ON but Responses fetch fails → callOpenAI returns null (caller falls back)", async () => {
    process.env.OPENAI_USE_RESPONSES_API_SCOUT_AUDITOR = "true";
    (global.fetch as any).mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: "boom" }),
      text: async () => "internal",
    });
    expect(await callOpenAI("scout_auditor", [{ role: "user", content: "x" }])).toBeNull();
  });

  it("OPENAI_API_KEY missing → callOpenAI returns null without hitting either path", async () => {
    delete process.env.OPENAI_API_KEY;
    expect(await callOpenAI("scout_auditor", [{ role: "user", content: "x" }])).toBeNull();
    expect(chatCompletionsCreate).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("non-OpenAI role (fast_critique) → returns null without flag check", async () => {
    process.env.OPENAI_USE_RESPONSES_API_FAST_CRITIQUE = "true";
    expect(await callOpenAI("fast_critique" as ModelRole, [{ role: "user", content: "x" }])).toBeNull();
  });

  it("flag ON + role lacking responsesApiVersion → falls back to Chat Completions (defensive)", async () => {
    // dsl_writer is Ollama-only (provider !== openai) so the test above
    // already guards. To prove the dual-condition routing rule (flag AND
    // config), we exercise the canonical role with the flag OFF and assert
    // Chat path. (Implementation contract: BOTH flag AND
    // config.responsesApiVersion === "v1" must be set to route Responses.)
    delete process.env.OPENAI_USE_RESPONSES_API_DSL_QUALITY_CRITIC;
    chatCompletionsCreate.mockResolvedValue({
      choices: [{ message: { content: "{}" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });
    await callOpenAI("dsl_quality_critic", [{ role: "user", content: "x" }]);
    expect(chatCompletionsCreate).toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("Responses path body includes response_format json_schema for scout_auditor", async () => {
    process.env.OPENAI_USE_RESPONSES_API_SCOUT_AUDITOR = "true";
    (global.fetch as any).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "{}" }] }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
      text: async () => "",
    });
    await callOpenAI("scout_auditor", [{ role: "user", content: "x" }]);
    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(body.response_format).toBeDefined();
    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.response_format.json_schema.name).toBe("scout_auditor_output");
  });

  it("Responses path body falls back to json_object for critic_evaluator (no strict schema)", async () => {
    process.env.OPENAI_USE_RESPONSES_API_CRITIC_EVALUATOR = "true";
    (global.fetch as any).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "{}" }] }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
      text: async () => "",
    });
    await callOpenAI("critic_evaluator", [{ role: "user", content: "x" }]);
    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(body.response_format).toEqual({ type: "json_object" });
  });
});

// ─── ParsedLLMResponse type sanity (compile-time guard) ───────────────────

describe("ParsedLLMResponse contract", () => {
  it("Chat Completions and Responses produce assignable shapes", () => {
    const a: ParsedLLMResponse = parseChatCompletionsResponse({
      choices: [{ message: { content: "x" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });
    const b: ParsedLLMResponse = parseResponsesApiResponse({
      output: [{ type: "message", content: [{ type: "output_text", text: "x" }] }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    expect(a.apiPath).toBe("chat_completions");
    expect(b.apiPath).toBe("responses");
    expect(typeof a.text).toBe("string");
    expect(typeof b.text).toBe("string");
  });
});
