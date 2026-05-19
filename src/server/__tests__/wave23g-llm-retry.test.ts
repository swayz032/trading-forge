/**
 * wave23g-llm-retry.test.ts — W23G.9 Scout-extract exponential-backoff retry
 *
 * Tests withScoutExtractRetry and callScoutExtractLlm in isolation.
 * All tests mock callOpenAI and the audit writer — no live DB, no Ollama.
 *
 * Coverage:
 *   1. Succeed first try → no retries, no audit rows
 *   2. HTTP 429 then success → 1 retry, llm.retry_attempt audit emitted,
 *      llm.recovered_after_retry emitted, result has recoveredAfterRetry=true
 *   3. 3× 429 → all retries exhausted, llm.exhausted_retries emitted,
 *      Ollama fallback called
 *   4. Timeout then success → 1 retry, success, correct audit shape
 *   5. classifyLlmError: correctly classifies 429 / 5xx / timeout / model_unavailable
 *   6. Non-transient error → no retry, returns null immediately
 *   7. callFn returns null (budget gate) → clean null returned, no retry
 *   8. callScoutExtractLlm: success first try → passes text through
 *   9. callScoutExtractLlm: 3× exhaustion → Ollama fallback invoked
 *  10. callScoutExtractLlm: clean null from callFn → delegates to callOpenAIOrFallback path
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  withScoutExtractRetry,
  classifyLlmError,
  callScoutExtractLlm,
  type LlmRetryReason,
  type ScoutExtractRetryResult,
} from "../services/model-router.js";

// ─── Mock all DB-touching modules before any import resolves ───────────────
// model-router.ts imports `logger` from `../index.js` which boots the full
// Express graph (routes, compliance.ts, etc.). Mock `../index.js` early to
// prevent that chain, same pattern used in wave9-critic-budget-closed.test.ts.
vi.mock("../index.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../db/index.js", () => ({
  db: {
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    }),
  },
}));

vi.mock("../db/schema.js", () => ({
  auditLog: { _: { name: "audit_log" } },
  strategies: { _: { name: "strategies" } },
  biasState: { _: { name: "bias_state" } },
  complianceRulesets: { _: { name: "compliance_rulesets" } },
  complianceReviews: { _: { name: "compliance_reviews" } },
  complianceDriftLog: { _: { name: "compliance_drift_log" } },
}));

vi.mock("../lib/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../lib/circuit-breaker.js", () => ({
  CircuitBreakerRegistry: {
    get: vi.fn().mockReturnValue({
      currentState: "CLOSED",
      status: vi.fn().mockReturnValue("CLOSED"),
      call: vi.fn().mockImplementation((fn: () => Promise<unknown>) => fn()),
    }),
  },
  CircuitOpenError: class CircuitOpenError extends Error {
    reopensAt = new Date();
  },
}));

// OllamaClient mock — used by callScoutExtractLlm on retry exhaustion
vi.mock("../services/ollama-client.js", () => ({
  OllamaClient: vi.fn().mockImplementation(() => ({
    generate: vi.fn().mockResolvedValue({ response: '{"strategies":[]}' }),
  })),
}));

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Build a no-sleep function for tests (avoids actual waits). */
const noSleep = () => Promise.resolve();

/** Build an audit spy that collects all emitted rows. */
function makeAuditSpy() {
  const rows: Array<{ action: string; decisionAuthority: string; status: string; result: Record<string, unknown> }> = [];
  const spy = vi.fn().mockImplementation(async (row: typeof rows[0]) => {
    rows.push(row);
  });
  return { spy, rows };
}

// ─── classifyLlmError ──────────────────────────────────────────────────────

describe("classifyLlmError", () => {
  it("classifies HTTP 429 status arg as http_429", () => {
    expect(classifyLlmError(new Error("rate limited"), 429)).toBe("http_429");
  });

  it("classifies HTTP 500 status arg as http_5xx", () => {
    expect(classifyLlmError(new Error("internal server error"), 500)).toBe("http_5xx");
  });

  it("classifies HTTP 503 status arg as http_5xx", () => {
    expect(classifyLlmError(new Error("service unavailable"), 503)).toBe("http_5xx");
  });

  it("classifies timeout error message as network_timeout", () => {
    expect(classifyLlmError(new Error("Request timed out after 30s"))).toBe("network_timeout");
  });

  it("classifies 'aborted' error message as network_timeout", () => {
    expect(classifyLlmError(new Error("The operation was aborted"))).toBe("network_timeout");
  });

  it("classifies 'model_unavailable' in error message", () => {
    expect(classifyLlmError(new Error("model_unavailable: gpt-5-mini"))).toBe("model_unavailable");
  });

  it("classifies 'rate_limit' in error message", () => {
    expect(classifyLlmError(new Error("OpenAI error: rate_limit exceeded"))).toBe("rate_limit");
  });

  it("classifies OpenAI SDK .status=429 on error object as http_429", () => {
    const err = Object.assign(new Error("429"), { status: 429 });
    expect(classifyLlmError(err)).toBe("http_429");
  });

  it("returns null for non-transient errors", () => {
    expect(classifyLlmError(new Error("JSON parse error: unexpected token"))).toBeNull();
    expect(classifyLlmError(new Error("TypeError: undefined is not a function"))).toBeNull();
  });

  it("returns null when no status and no known message pattern", () => {
    expect(classifyLlmError(new Error("some unexpected error"))).toBeNull();
  });
});

// ─── withScoutExtractRetry ────────────────────────────────────────────────

describe("withScoutExtractRetry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("test 1: succeeds first try → no retries, no audit rows, attempts=1", async () => {
    const { spy: auditSpy, rows } = makeAuditSpy();
    const callFn = vi.fn().mockResolvedValue('{"strategies":[]}');

    const result = await withScoutExtractRetry(callFn, auditSpy, noSleep);

    expect(result.text).toBe('{"strategies":[]}');
    expect(result.recoveredAfterRetry).toBe(false);
    expect(result.exhausted).toBe(false);
    expect(result.attempts).toBe(1);
    expect(callFn).toHaveBeenCalledTimes(1);
    // No audit rows on clean first-try success
    expect(rows.filter((r) => r.action === "llm.retry_attempt")).toHaveLength(0);
    expect(rows.filter((r) => r.action === "llm.recovered_after_retry")).toHaveLength(0);
    expect(rows.filter((r) => r.action === "llm.exhausted_retries")).toHaveLength(0);
  });

  it("test 2: HTTP 429 then success → 1 retry, correct audit rows emitted", async () => {
    const { spy: auditSpy, rows } = makeAuditSpy();

    const err429 = Object.assign(new Error("Too Many Requests"), { status: 429 });
    const callFn = vi
      .fn()
      .mockRejectedValueOnce(err429)
      .mockResolvedValueOnce('{"strategies":[{"name":"ema_cross"}]}');

    const result = await withScoutExtractRetry(callFn, auditSpy, noSleep);

    expect(result.text).toBe('{"strategies":[{"name":"ema_cross"}]}');
    expect(result.recoveredAfterRetry).toBe(true);
    expect(result.exhausted).toBe(false);
    expect(result.attempts).toBe(2);
    expect(callFn).toHaveBeenCalledTimes(2);

    // retry_attempt row for the failed attempt
    const retryAttemptRows = rows.filter((r) => r.action === "llm.retry_attempt");
    expect(retryAttemptRows).toHaveLength(1);
    expect(retryAttemptRows[0].result).toMatchObject({
      role: "scout_extract",
      attempt: 1,
      reason: "http_429",
    });

    // recovered_after_retry row on success
    const recoveredRows = rows.filter((r) => r.action === "llm.recovered_after_retry");
    expect(recoveredRows).toHaveLength(1);
    expect(recoveredRows[0].result).toMatchObject({
      role: "scout_extract",
      attempts_total: 2,
      last_reason: "http_429",
    });
    expect(recoveredRows[0].status).toBe("success");

    // No exhaustion row
    expect(rows.filter((r) => r.action === "llm.exhausted_retries")).toHaveLength(0);
  });

  it("test 3: 3× 429 → all retries exhausted, llm.exhausted_retries emitted, returns exhausted=true", async () => {
    const { spy: auditSpy, rows } = makeAuditSpy();

    const err429 = Object.assign(new Error("Too Many Requests"), { status: 429 });
    const callFn = vi.fn().mockRejectedValue(err429);

    const result = await withScoutExtractRetry(callFn, auditSpy, noSleep);

    expect(result.text).toBeNull();
    expect(result.exhausted).toBe(true);
    expect(result.recoveredAfterRetry).toBe(false);
    expect(result.attempts).toBe(3);
    expect(callFn).toHaveBeenCalledTimes(3);

    // All 3 attempts emit retry_attempt rows (each failed attempt is audited)
    const retryRows = rows.filter((r) => r.action === "llm.retry_attempt");
    expect(retryRows).toHaveLength(3);
    expect(retryRows[0].result.attempt).toBe(1);
    expect(retryRows[1].result.attempt).toBe(2);
    expect(retryRows[2].result.attempt).toBe(3);

    // 1 exhausted_retries row
    const exhaustedRows = rows.filter((r) => r.action === "llm.exhausted_retries");
    expect(exhaustedRows).toHaveLength(1);
    expect(exhaustedRows[0].decisionAuthority).toBe("gate");
    expect(exhaustedRows[0].status).toBe("rejected");
    expect(exhaustedRows[0].result).toMatchObject({
      role: "scout_extract",
      attempts_total: 3,
      last_reason: "http_429",
    });

    // No recovered row
    expect(rows.filter((r) => r.action === "llm.recovered_after_retry")).toHaveLength(0);
  });

  it("test 4: timeout then success → 1 retry, success, reason=network_timeout", async () => {
    const { spy: auditSpy, rows } = makeAuditSpy();

    const timeoutErr = new Error("Request timed out after 30s");
    const callFn = vi
      .fn()
      .mockRejectedValueOnce(timeoutErr)
      .mockResolvedValueOnce('{"strategies":[{"name":"orb_mes"}]}');

    const result = await withScoutExtractRetry(callFn, auditSpy, noSleep);

    expect(result.text).toBe('{"strategies":[{"name":"orb_mes"}]}');
    expect(result.recoveredAfterRetry).toBe(true);
    expect(result.attempts).toBe(2);
    expect(result.lastReason).toBe("network_timeout");

    const retryRows = rows.filter((r) => r.action === "llm.retry_attempt");
    expect(retryRows).toHaveLength(1);
    expect(retryRows[0].result.reason).toBe("network_timeout");

    const recoveredRows = rows.filter((r) => r.action === "llm.recovered_after_retry");
    expect(recoveredRows).toHaveLength(1);
    expect(recoveredRows[0].result.last_reason).toBe("network_timeout");
  });

  it("test 5 (non-transient): non-retryable error → no retry, returns null immediately", async () => {
    const { spy: auditSpy, rows } = makeAuditSpy();

    const parseErr = new Error("JSON parse error: unexpected token {");
    const callFn = vi.fn().mockRejectedValue(parseErr);

    const result = await withScoutExtractRetry(callFn, auditSpy, noSleep);

    expect(result.text).toBeNull();
    expect(result.exhausted).toBe(false);
    expect(result.attempts).toBe(1);
    expect(callFn).toHaveBeenCalledTimes(1);
    // No audit rows for non-transient error
    expect(rows).toHaveLength(0);
  });

  it("test 6 (budget gate): callFn returns null → clean null, no retry, no audit rows", async () => {
    const { spy: auditSpy, rows } = makeAuditSpy();

    const callFn = vi.fn().mockResolvedValue(null);

    const result = await withScoutExtractRetry(callFn, auditSpy, noSleep);

    expect(result.text).toBeNull();
    expect(result.exhausted).toBe(false);
    expect(result.recoveredAfterRetry).toBe(false);
    expect(result.attempts).toBe(1);
    expect(callFn).toHaveBeenCalledTimes(1);
    expect(rows).toHaveLength(0);
  });

  it("model_unavailable in error message triggers retry", async () => {
    const { spy: auditSpy, rows } = makeAuditSpy();

    const modelErr = new Error("model_unavailable: gpt-5-mini is currently overloaded");
    const callFn = vi
      .fn()
      .mockRejectedValueOnce(modelErr)
      .mockResolvedValueOnce('{"strategies":[]}');

    const result = await withScoutExtractRetry(callFn, auditSpy, noSleep);

    expect(result.recoveredAfterRetry).toBe(true);
    const retryRows = rows.filter((r) => r.action === "llm.retry_attempt");
    expect(retryRows[0].result.reason).toBe("model_unavailable");
  });

  it("HTTP 5xx triggers retry", async () => {
    const { spy: auditSpy, rows } = makeAuditSpy();

    const err502 = Object.assign(new Error("Bad Gateway"), { status: 502 });
    const callFn = vi
      .fn()
      .mockRejectedValueOnce(err502)
      .mockResolvedValueOnce('{"strategies":[]}');

    const result = await withScoutExtractRetry(callFn, auditSpy, noSleep);

    expect(result.recoveredAfterRetry).toBe(true);
    const retryRows = rows.filter((r) => r.action === "llm.retry_attempt");
    expect(retryRows[0].result.reason).toBe("http_5xx");
  });

  it("audit rows contain role=scout_extract in result block", async () => {
    const { spy: auditSpy, rows } = makeAuditSpy();

    const err429 = Object.assign(new Error("429"), { status: 429 });
    const callFn = vi.fn().mockRejectedValue(err429);

    await withScoutExtractRetry(callFn, auditSpy, noSleep);

    for (const row of rows) {
      expect(row.result.role).toBe("scout_extract");
    }
  });
});

// ─── callScoutExtractLlm ──────────────────────────────────────────────────

describe("callScoutExtractLlm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("test 8: success first try → returns text, no Ollama invoked", async () => {
    const mockCallFn = vi.fn().mockResolvedValue('{"strategies":[{"name":"vwap_pull"}]}');

    const result = await callScoutExtractLlm(
      [{ role: "user", content: "extract strategies" }],
      undefined,
      mockCallFn,
      noSleep,
    );

    expect(result).toBe('{"strategies":[{"name":"vwap_pull"}]}');
    expect(mockCallFn).toHaveBeenCalledTimes(1);
    expect(mockCallFn).toHaveBeenCalledWith(
      "transcript_extractor",
      [{ role: "user", content: "extract strategies" }],
      undefined,
    );
  });

  it("test 9: 3× exhaustion → Ollama fallback invoked (mocked OllamaClient)", async () => {
    const err429 = Object.assign(new Error("429"), { status: 429 });
    const mockCallFn = vi.fn().mockRejectedValue(err429);

    // The OllamaClient mock is set up at module level (vi.mock at top of file).
    // We just verify the result comes from the Ollama path (non-null).
    // Pass noSleep to avoid real 1s+4s+15s delays in unit tests.
    const result = await callScoutExtractLlm(
      [{ role: "user", content: "extract strategies" }],
      undefined,
      mockCallFn,
      noSleep,
    );

    // OllamaClient.generate mock returns '{"strategies":[]}' → callScoutExtractLlm
    // returns that string (non-null). If Ollama fallback was not invoked, result
    // would be null.
    expect(result).toBeTruthy();
    expect(mockCallFn).toHaveBeenCalledTimes(3);
  });

  it("test 10: clean null from callFn (budget gate) → NOT retried, callFn called exactly once", async () => {
    // Budget-gate: callFn returns null immediately (not via throw).
    // withScoutExtractRetry returns { exhausted: false, text: null }.
    // Key assertion: callFn was NOT retried — null is a clean non-retryable signal.
    // The function may still delegate to the Ollama fallback path via
    // callOpenAIOrFallback (which is fine and expected); what matters is
    // that the injected callFn is only invoked once (no retry loop).
    const mockCallFn = vi.fn().mockResolvedValue(null);

    await callScoutExtractLlm(
      [{ role: "user", content: "extract strategies" }],
      undefined,
      mockCallFn,
      noSleep,
    );

    // The injected callFn must be called exactly once — clean null does NOT retry.
    expect(mockCallFn).toHaveBeenCalledTimes(1);
  });

  it("passes taskContext to callFn", async () => {
    const mockCallFn = vi.fn().mockResolvedValue('{"strategies":[]}');
    const ctx = { signalType: "strategy_candidate" as const };

    await callScoutExtractLlm(
      [{ role: "user", content: "test" }],
      ctx,
      mockCallFn,
      noSleep,
    );

    expect(mockCallFn).toHaveBeenCalledWith("transcript_extractor", expect.any(Array), ctx);
  });
});
