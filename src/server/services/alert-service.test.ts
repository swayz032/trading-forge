/**
 * alert-service.test.ts
 *
 * FIX 1 verification: Discord relay fetch has a 4-second timeout.
 * A hung relay must not block critical alert delivery indefinitely.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mocks — must be hoisted ──────────────────────────────────────────────────

vi.mock("../db/index.js", () => ({
  db: {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{
          id: "alert-uuid-1",
          type: "system",
          severity: "critical",
          title: "Kill switch: test",
          message: "test message",
          metadata: {},
        }]),
      }),
    }),
  },
}));

vi.mock("../routes/sse.js", () => ({ broadcastSSE: vi.fn() }));
vi.mock("../index.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { createAlert } from "./alert-service.js";
import { logger } from "../index.js";

// ── Tests ────────────────────────────────────────────────────────────────────

/** Build a DOMException-like TimeoutError, the same type AbortSignal.timeout fires. */
function makeTimeoutError(): Error {
  const e = new Error("The operation was aborted due to timeout");
  e.name = "TimeoutError";
  return e;
}

describe("createAlert — Discord relay timeout (FIX 1)", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DISCORD_ALERT_PORT = "4100";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("fetch is called with an AbortSignal so the relay has a bounded deadline", async () => {
    // Mock fetch to succeed immediately — we're asserting the signal is PRESENT
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true } as Response);

    await createAlert({
      type: "system",
      severity: "critical",
      title: "Kill switch: component",
      message: "test",
    });

    const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>;
    expect(mockFetch).toHaveBeenCalled();
    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(opts.signal).toBeDefined();
    expect(opts.signal).toBeInstanceOf(AbortSignal);
  });

  it("logs a warn (not throws) when Discord relay times out", async () => {
    // Simulate the abort signal firing — fetch rejects with TimeoutError
    globalThis.fetch = vi.fn().mockRejectedValue(makeTimeoutError());

    await createAlert({
      type: "system",
      severity: "critical",
      title: "Kill switch: component",
      message: "test",
    });

    const mockWarn = logger.warn as ReturnType<typeof vi.fn>;
    expect(mockWarn).toHaveBeenCalled();
    const [logObj] = mockWarn.mock.calls[mockWarn.mock.calls.length - 1] as [Record<string, unknown>, string];
    expect(logObj).toHaveProperty("timeout", true);
  });

  it("returns the created alert even when Discord relay times out", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(makeTimeoutError());

    const alert = await createAlert({
      type: "system",
      severity: "critical",
      title: "Kill switch: component",
      message: "test",
    });

    expect(alert).toBeDefined();
    expect(alert.id).toBe("alert-uuid-1");
  });

  it("logs warn with timeout=false for non-timeout errors (e.g. connection refused)", async () => {
    const connErr = new Error("connect ECONNREFUSED 127.0.0.1:4100");
    connErr.name = "Error";
    globalThis.fetch = vi.fn().mockRejectedValue(connErr);

    await createAlert({
      type: "system",
      severity: "critical",
      title: "Kill switch: component",
      message: "test",
    });

    const mockWarn = logger.warn as ReturnType<typeof vi.fn>;
    expect(mockWarn).toHaveBeenCalled();
    const [logObj] = mockWarn.mock.calls[mockWarn.mock.calls.length - 1] as [Record<string, unknown>, string];
    // timeout flag must be false for non-abort errors
    expect(logObj).toHaveProperty("timeout", false);
  });

  it("does not call Discord relay for non-critical alerts", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true } as Response);

    await createAlert({
      type: "system",
      severity: "warning",
      title: "Some warning",
      message: "test",
    });

    // fetch should NOT have been called (only critical alerts hit Discord)
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
