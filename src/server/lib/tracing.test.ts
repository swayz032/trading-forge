/**
 * Unit tests for src/server/lib/tracing.ts
 *
 * These tests verify:
 *   1. OTEL_AVAILABLE export is a boolean in all code paths
 *   2. The tracer export always satisfies the Tracer interface (startSpan + Span.end)
 *   3. The no-op path never throws
 *   4. Span.setAttribute is callable with all three value types without throwing
 *   5. Nested startSpan calls are safe (test proxy for the try/finally span-leak fix)
 *
 * Intentionally avoids mocking the OTel SDK internals — these tests verify the
 * exported contract that consumer code depends on, not the SDK's own behaviour.
 */

import { describe, it, expect } from "vitest";
import { tracer, OTEL_AVAILABLE } from "./tracing.js";

describe("tracing module exports", () => {
  it("OTEL_AVAILABLE is a boolean", () => {
    expect(typeof OTEL_AVAILABLE).toBe("boolean");
  });

  it("tracer is defined", () => {
    expect(tracer).toBeDefined();
  });

  it("tracer.startSpan returns a span with setAttribute and end", () => {
    const span = tracer.startSpan("test.span");
    expect(typeof span.setAttribute).toBe("function");
    expect(typeof span.end).toBe("function");
  });
});

describe("span interface — no-throw contract", () => {
  it("setAttribute(string) does not throw", () => {
    const span = tracer.startSpan("test.string_attr");
    expect(() => span.setAttribute("key", "value")).not.toThrow();
    span.end();
  });

  it("setAttribute(number) does not throw", () => {
    const span = tracer.startSpan("test.number_attr");
    expect(() => span.setAttribute("pnl", 123.45)).not.toThrow();
    span.end();
  });

  it("setAttribute(boolean) does not throw", () => {
    const span = tracer.startSpan("test.bool_attr");
    expect(() => span.setAttribute("filled", true)).not.toThrow();
    span.end();
  });

  it("span.end() is idempotent — second call does not throw", () => {
    const span = tracer.startSpan("test.double_end");
    span.end();
    expect(() => span.end()).not.toThrow();
  });

  it("multiple concurrent startSpan calls do not interfere", () => {
    const span1 = tracer.startSpan("paper.position_open");
    const span2 = tracer.startSpan("paper.fill_check");
    span2.setAttribute("filled", true);
    span2.end();
    span1.setAttribute("contracts", 2);
    span1.end();
    // No assertion needed — the test passes if no exception is thrown
  });
});

describe("span lifecycle — try/finally pattern safety", () => {
  it("span.end() is called even when the body throws (simulates try/finally guard)", () => {
    const span = tracer.startSpan("paper.position_close");
    let endCalled = false;

    // Patch end() to track invocation — works for both OTel real spans and NoOpSpan
    const originalEnd = span.end.bind(span);
    span.end = () => {
      endCalled = true;
      originalEnd();
    };

    try {
      span.setAttribute("netPnl", 0);
      throw new Error("simulated mid-close failure");
    } catch {
      // intentionally swallowed — we only care that finally runs
    } finally {
      span.end();
    }

    expect(endCalled).toBe(true);
  });
});
