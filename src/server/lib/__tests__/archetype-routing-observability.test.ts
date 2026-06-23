/**
 * archetype-routing-observability.test.ts — Pass 4.5 Track D (2026-06-23)
 *
 * Verifies the three observability helpers that fire SSE + Prometheus signals
 * at each stage of the /api/live-order archetype_signal handler lifecycle.
 *
 * Test strategy:
 *   - Static source-file inspection for structural contracts (no mock required).
 *   - Runtime unit tests with vi.doMock() isolation: mocked broadcastSSE,
 *     ARCHETYPE_ROUTING_EVENTS, archetypeSignalsRoutedTotal, and logger so no
 *     I/O occurs and no prom-client registry is touched.
 *   - All tests verify the exact payload shape Track B will depend on.
 *
 * Tests:
 *   §1  Source-level structural checks (exports, types, constants, counter)
 *   §2  emitArchetypeSignalReceived — broadcasts correct SSE event + payload
 *   §3  emitArchetypeSignalReceived — does NOT increment Prometheus counter
 *   §4  emitArchetypeSignalResolved — broadcasts correct SSE event + payload
 *   §5  emitArchetypeSignalResolved — increments counter with resolved_action label
 *   §6  emitArchetypeEvaluatorFailed — broadcasts correct SSE event + payload
 *   §7  emitArchetypeEvaluatorFailed — increments counter with resolved_action:"evaluator_failed"
 *   §8  Fire-and-forget — SSE failure does not throw (received)
 *   §9  Fire-and-forget — SSE failure does not throw (resolved)
 *  §10  Fire-and-forget — SSE failure does not throw (failed)
 *  §11  Fire-and-forget — counter failure does not throw (resolved)
 *  §12  Fire-and-forget — counter failure does not throw (failed)
 *  §13  Counter aggregation — multiple resolved calls accumulate
 *  §14  Counter aggregation — different archetypes use independent labels
 *  §15  Correlation ID — null propagates without error (received)
 *  §16  Correlation ID — null propagates without error (resolved)
 *  §17  Correlation ID — null propagates without error (failed)
 *  §18  All resolved_action values (excluding evaluator_failed) pass through resolved helper
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";

// ─── Source files for static inspection ──────────────────────────────────────

const HELPER_SRC = fs.readFileSync(
  path.resolve(__dirname, "../archetype-routing-observability.ts"),
  "utf-8",
);

const METRICS_SRC = fs.readFileSync(
  path.resolve(__dirname, "../metrics-registry.ts"),
  "utf-8",
);

const SSE_SRC = fs.readFileSync(
  path.resolve(__dirname, "../../routes/sse.ts"),
  "utf-8",
);

// ─── §1 Source-level structural checks ───────────────────────────────────────

describe("archetype-routing-observability — source structure", () => {
  it("exports emitArchetypeSignalReceived as a named void function", () => {
    expect(HELPER_SRC).toContain("export function emitArchetypeSignalReceived");
    expect(HELPER_SRC).toMatch(/export function emitArchetypeSignalReceived[\s\S]{0,300}\): void/);
  });

  it("exports emitArchetypeSignalResolved as a named void function", () => {
    expect(HELPER_SRC).toContain("export function emitArchetypeSignalResolved");
    expect(HELPER_SRC).toMatch(/export function emitArchetypeSignalResolved[\s\S]{0,300}\): void/);
  });

  it("exports emitArchetypeEvaluatorFailed as a named void function", () => {
    expect(HELPER_SRC).toContain("export function emitArchetypeEvaluatorFailed");
    expect(HELPER_SRC).toMatch(/export function emitArchetypeEvaluatorFailed[\s\S]{0,300}\): void/);
  });

  it("no helper is declared async (fire-and-forget contract)", () => {
    expect(HELPER_SRC).not.toMatch(/export async function emitArchetypeSignalReceived/);
    expect(HELPER_SRC).not.toMatch(/export async function emitArchetypeSignalResolved/);
    expect(HELPER_SRC).not.toMatch(/export async function emitArchetypeEvaluatorFailed/);
  });

  it("exports ArchetypeSignalReceivedPayload interface with all required fields", () => {
    expect(HELPER_SRC).toContain("export interface ArchetypeSignalReceivedPayload");
    expect(HELPER_SRC).toContain("strategy_id");
    expect(HELPER_SRC).toContain("archetype");
    expect(HELPER_SRC).toContain("account_id");
    expect(HELPER_SRC).toContain("correlation_id");
    expect(HELPER_SRC).toContain("bar_timestamp");
  });

  it("exports ArchetypeSignalResolvedPayload interface with all required fields", () => {
    expect(HELPER_SRC).toContain("export interface ArchetypeSignalResolvedPayload");
    expect(HELPER_SRC).toContain("resolved_action");
    expect(HELPER_SRC).toContain("reason");
  });

  it("exports ArchetypeEvaluatorFailedPayload interface with all required fields", () => {
    expect(HELPER_SRC).toContain("export interface ArchetypeEvaluatorFailedPayload");
    expect(HELPER_SRC).toContain("error_class");
  });

  it("exports ResolvedAction type covering all 6 values", () => {
    expect(HELPER_SRC).toContain("export type ResolvedAction");
    expect(HELPER_SRC).toContain('"enter_long"');
    expect(HELPER_SRC).toContain('"enter_short"');
    expect(HELPER_SRC).toContain('"exit_long"');
    expect(HELPER_SRC).toContain('"exit_short"');
    expect(HELPER_SRC).toContain('"hold"');
    expect(HELPER_SRC).toContain('"evaluator_failed"');
  });

  it("imports archetypeSignalsRoutedTotal from metrics-registry", () => {
    expect(HELPER_SRC).toContain("archetypeSignalsRoutedTotal");
    expect(HELPER_SRC).toContain("metrics-registry");
  });

  it("imports broadcastSSE and ARCHETYPE_ROUTING_EVENTS from sse.ts route", () => {
    expect(HELPER_SRC).toContain("broadcastSSE");
    expect(HELPER_SRC).toContain("ARCHETYPE_ROUTING_EVENTS");
    expect(HELPER_SRC).toMatch(/from.*sse\.js/);
  });

  it("Prometheus increments are inside try/catch blocks", () => {
    expect(HELPER_SRC).toMatch(/try\s*\{[\s\S]{0,200}archetypeSignalsRoutedTotal/);
  });

  it("SSE broadcasts are inside try/catch blocks", () => {
    expect(HELPER_SRC).toMatch(/try\s*\{[\s\S]{0,200}broadcastSSE/);
  });

  it("metrics-registry.ts declares archetypeSignalsRoutedTotal Counter", () => {
    expect(METRICS_SRC).toContain("archetypeSignalsRoutedTotal");
    expect(METRICS_SRC).toContain("tf_archetype_signals_routed_total");
  });

  it("metrics-registry.ts counter has archetype and resolved_action labels", () => {
    const idx = METRICS_SRC.indexOf("archetypeSignalsRoutedTotal");
    const block = METRICS_SRC.slice(idx, idx + 500);
    expect(block).toContain("archetype");
    expect(block).toContain("resolved_action");
    expect(block).toContain("labelNames");
  });

  it("sse.ts declares ARCHETYPE_ROUTING_EVENTS with all 3 events", () => {
    expect(SSE_SRC).toContain("ARCHETYPE_ROUTING_EVENTS");
    expect(SSE_SRC).toContain("SIGNAL_RECEIVED");
    expect(SSE_SRC).toContain("SIGNAL_RESOLVED");
    expect(SSE_SRC).toContain("EVALUATOR_FAILED");
    expect(SSE_SRC).toContain("archetype:signal_received");
    expect(SSE_SRC).toContain("archetype:signal_resolved");
    expect(SSE_SRC).toContain("archetype:evaluator_failed");
  });

  it("sse.ts exports ArchetypeRoutingEventName type", () => {
    expect(SSE_SRC).toContain("export type ArchetypeRoutingEventName");
  });
});

// ─── §2 emitArchetypeSignalReceived — SSE broadcast ──────────────────────────

describe("archetype-routing-observability — emitArchetypeSignalReceived SSE", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("broadcasts archetype:signal_received with all 5 payload fields", async () => {
    const broadcastMock = vi.fn();

    vi.doMock("../../routes/sse.js", () => ({
      broadcastSSE: broadcastMock,
      ARCHETYPE_ROUTING_EVENTS: {
        SIGNAL_RECEIVED:  "archetype:signal_received",
        SIGNAL_RESOLVED:  "archetype:signal_resolved",
        EVALUATOR_FAILED: "archetype:evaluator_failed",
      },
    }));
    vi.doMock("../metrics-registry.js", () => ({
      archetypeSignalsRoutedTotal: { labels: () => ({ inc: vi.fn() }) },
    }));
    vi.doMock("../logger.js", () => ({
      logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
    }));

    const { emitArchetypeSignalReceived } = await import("../archetype-routing-observability.js");

    emitArchetypeSignalReceived({
      strategy_id:    "strat-uuid-001",
      archetype:      "bounce_off_level",
      account_id:     "acct-topstep-01",
      correlation_id: "corr-abc-001",
      bar_timestamp:  "2026-06-23T09:30:00.000Z",
    });

    expect(broadcastMock).toHaveBeenCalledOnce();
    const [eventName, payload] = broadcastMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(eventName).toBe("archetype:signal_received");
    expect(payload.strategy_id).toBe("strat-uuid-001");
    expect(payload.archetype).toBe("bounce_off_level");
    expect(payload.account_id).toBe("acct-topstep-01");
    expect(payload.correlation_id).toBe("corr-abc-001");
    expect(payload.bar_timestamp).toBe("2026-06-23T09:30:00.000Z");
  });
});

// ─── §3 emitArchetypeSignalReceived — does NOT increment counter ──────────────

describe("archetype-routing-observability — emitArchetypeSignalReceived no counter", () => {
  it("does NOT increment the Prometheus counter (Stage 1 is pre-routing)", async () => {
    vi.resetModules();
    const incMock = vi.fn();
    const labelsMock = vi.fn().mockReturnValue({ inc: incMock });

    vi.doMock("../../routes/sse.js", () => ({
      broadcastSSE: vi.fn(),
      ARCHETYPE_ROUTING_EVENTS: {
        SIGNAL_RECEIVED:  "archetype:signal_received",
        SIGNAL_RESOLVED:  "archetype:signal_resolved",
        EVALUATOR_FAILED: "archetype:evaluator_failed",
      },
    }));
    vi.doMock("../metrics-registry.js", () => ({
      archetypeSignalsRoutedTotal: { labels: labelsMock },
    }));
    vi.doMock("../logger.js", () => ({
      logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
    }));

    const { emitArchetypeSignalReceived } = await import("../archetype-routing-observability.js");

    emitArchetypeSignalReceived({
      strategy_id:    "strat-uuid-002",
      archetype:      "bounce_off_level",
      account_id:     "acct-topstep-01",
      correlation_id: null,
      bar_timestamp:  "2026-06-23T09:30:00.000Z",
    });

    expect(labelsMock).not.toHaveBeenCalled();
    expect(incMock).not.toHaveBeenCalled();
  });
});

// ─── §4 emitArchetypeSignalResolved — SSE broadcast ──────────────────────────

describe("archetype-routing-observability — emitArchetypeSignalResolved SSE", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("broadcasts archetype:signal_resolved with all 6 payload fields", async () => {
    const broadcastMock = vi.fn();

    vi.doMock("../../routes/sse.js", () => ({
      broadcastSSE: broadcastMock,
      ARCHETYPE_ROUTING_EVENTS: {
        SIGNAL_RECEIVED:  "archetype:signal_received",
        SIGNAL_RESOLVED:  "archetype:signal_resolved",
        EVALUATOR_FAILED: "archetype:evaluator_failed",
      },
    }));
    vi.doMock("../metrics-registry.js", () => ({
      archetypeSignalsRoutedTotal: { labels: () => ({ inc: vi.fn() }) },
    }));
    vi.doMock("../logger.js", () => ({
      logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
    }));

    const { emitArchetypeSignalResolved } = await import("../archetype-routing-observability.js");

    emitArchetypeSignalResolved({
      strategy_id:     "strat-uuid-003",
      archetype:       "ict_bias_aligned_continuation",
      resolved_action: "enter_long",
      account_id:      "acct-mffu-01",
      correlation_id:  "corr-resolve-001",
      reason:          "structure + killzone confluence met",
    });

    expect(broadcastMock).toHaveBeenCalledOnce();
    const [eventName, payload] = broadcastMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(eventName).toBe("archetype:signal_resolved");
    expect(payload.strategy_id).toBe("strat-uuid-003");
    expect(payload.archetype).toBe("ict_bias_aligned_continuation");
    expect(payload.resolved_action).toBe("enter_long");
    expect(payload.account_id).toBe("acct-mffu-01");
    expect(payload.correlation_id).toBe("corr-resolve-001");
    expect(payload.reason).toBe("structure + killzone confluence met");
  });
});

// ─── §5 emitArchetypeSignalResolved — Prometheus counter ─────────────────────

describe("archetype-routing-observability — emitArchetypeSignalResolved counter", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("increments archetypeSignalsRoutedTotal with archetype + resolved_action labels", async () => {
    const incMock = vi.fn();
    const labelsMock = vi.fn().mockReturnValue({ inc: incMock });

    vi.doMock("../../routes/sse.js", () => ({
      broadcastSSE: vi.fn(),
      ARCHETYPE_ROUTING_EVENTS: {
        SIGNAL_RECEIVED:  "archetype:signal_received",
        SIGNAL_RESOLVED:  "archetype:signal_resolved",
        EVALUATOR_FAILED: "archetype:evaluator_failed",
      },
    }));
    vi.doMock("../metrics-registry.js", () => ({
      archetypeSignalsRoutedTotal: { labels: labelsMock },
    }));
    vi.doMock("../logger.js", () => ({
      logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
    }));

    const { emitArchetypeSignalResolved } = await import("../archetype-routing-observability.js");

    emitArchetypeSignalResolved({
      strategy_id:     "strat-uuid-004",
      archetype:       "bounce_off_level",
      resolved_action: "enter_short",
      account_id:      "acct-topstep-01",
      correlation_id:  null,
      reason:          null,
    });

    expect(labelsMock).toHaveBeenCalledWith({
      archetype:       "bounce_off_level",
      resolved_action: "enter_short",
    });
    expect(incMock).toHaveBeenCalledOnce();
  });

  it("increments counter for 'hold' resolved_action", async () => {
    vi.resetModules();
    const incMock = vi.fn();
    const labelsMock = vi.fn().mockReturnValue({ inc: incMock });

    vi.doMock("../../routes/sse.js", () => ({
      broadcastSSE: vi.fn(),
      ARCHETYPE_ROUTING_EVENTS: {
        SIGNAL_RECEIVED:  "archetype:signal_received",
        SIGNAL_RESOLVED:  "archetype:signal_resolved",
        EVALUATOR_FAILED: "archetype:evaluator_failed",
      },
    }));
    vi.doMock("../metrics-registry.js", () => ({
      archetypeSignalsRoutedTotal: { labels: labelsMock },
    }));
    vi.doMock("../logger.js", () => ({
      logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
    }));

    const { emitArchetypeSignalResolved } = await import("../archetype-routing-observability.js");

    emitArchetypeSignalResolved({
      strategy_id:     "strat-uuid-005",
      archetype:       "ict_bias_aligned_continuation",
      resolved_action: "hold",
      account_id:      "acct-topstep-01",
      correlation_id:  null,
      reason:          "insufficient confluence",
    });

    expect(labelsMock).toHaveBeenCalledWith({
      archetype:       "ict_bias_aligned_continuation",
      resolved_action: "hold",
    });
    expect(incMock).toHaveBeenCalledOnce();
  });
});

// ─── §6 emitArchetypeEvaluatorFailed — SSE broadcast ─────────────────────────

describe("archetype-routing-observability — emitArchetypeEvaluatorFailed SSE", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("broadcasts archetype:evaluator_failed with all 4 payload fields", async () => {
    const broadcastMock = vi.fn();

    vi.doMock("../../routes/sse.js", () => ({
      broadcastSSE: broadcastMock,
      ARCHETYPE_ROUTING_EVENTS: {
        SIGNAL_RECEIVED:  "archetype:signal_received",
        SIGNAL_RESOLVED:  "archetype:signal_resolved",
        EVALUATOR_FAILED: "archetype:evaluator_failed",
      },
    }));
    vi.doMock("../metrics-registry.js", () => ({
      archetypeSignalsRoutedTotal: { labels: () => ({ inc: vi.fn() }) },
    }));
    vi.doMock("../logger.js", () => ({
      logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
    }));

    const { emitArchetypeEvaluatorFailed } = await import("../archetype-routing-observability.js");

    emitArchetypeEvaluatorFailed({
      strategy_id:    "strat-uuid-006",
      archetype:      "bounce_off_level",
      error_class:    "TimeoutError",
      correlation_id: "corr-fail-001",
    });

    expect(broadcastMock).toHaveBeenCalledOnce();
    const [eventName, payload] = broadcastMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(eventName).toBe("archetype:evaluator_failed");
    expect(payload.strategy_id).toBe("strat-uuid-006");
    expect(payload.archetype).toBe("bounce_off_level");
    expect(payload.error_class).toBe("TimeoutError");
    expect(payload.correlation_id).toBe("corr-fail-001");
  });
});

// ─── §7 emitArchetypeEvaluatorFailed — Prometheus counter ────────────────────

describe("archetype-routing-observability — emitArchetypeEvaluatorFailed counter", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("increments counter with resolved_action:'evaluator_failed'", async () => {
    const incMock = vi.fn();
    const labelsMock = vi.fn().mockReturnValue({ inc: incMock });

    vi.doMock("../../routes/sse.js", () => ({
      broadcastSSE: vi.fn(),
      ARCHETYPE_ROUTING_EVENTS: {
        SIGNAL_RECEIVED:  "archetype:signal_received",
        SIGNAL_RESOLVED:  "archetype:signal_resolved",
        EVALUATOR_FAILED: "archetype:evaluator_failed",
      },
    }));
    vi.doMock("../metrics-registry.js", () => ({
      archetypeSignalsRoutedTotal: { labels: labelsMock },
    }));
    vi.doMock("../logger.js", () => ({
      logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
    }));

    const { emitArchetypeEvaluatorFailed } = await import("../archetype-routing-observability.js");

    emitArchetypeEvaluatorFailed({
      strategy_id:    "strat-uuid-007",
      archetype:      "ict_bias_aligned_continuation",
      error_class:    "SubprocessError",
      correlation_id: null,
    });

    expect(labelsMock).toHaveBeenCalledWith({
      archetype:       "ict_bias_aligned_continuation",
      resolved_action: "evaluator_failed",
    });
    expect(incMock).toHaveBeenCalledOnce();
  });

  it("always uses evaluator_failed label regardless of error_class", async () => {
    vi.resetModules();
    const incMock = vi.fn();
    const labelsMock = vi.fn().mockReturnValue({ inc: incMock });

    vi.doMock("../../routes/sse.js", () => ({
      broadcastSSE: vi.fn(),
      ARCHETYPE_ROUTING_EVENTS: {
        SIGNAL_RECEIVED:  "archetype:signal_received",
        SIGNAL_RESOLVED:  "archetype:signal_resolved",
        EVALUATOR_FAILED: "archetype:evaluator_failed",
      },
    }));
    vi.doMock("../metrics-registry.js", () => ({
      archetypeSignalsRoutedTotal: { labels: labelsMock },
    }));
    vi.doMock("../logger.js", () => ({
      logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
    }));

    const { emitArchetypeEvaluatorFailed } = await import("../archetype-routing-observability.js");

    emitArchetypeEvaluatorFailed({
      strategy_id:    "strat-uuid-008",
      archetype:      "bounce_off_level",
      error_class:    "Error",  // generic error — resolved_action must still be evaluator_failed
      correlation_id: null,
    });

    const [labelArg] = labelsMock.mock.calls[0] as [Record<string, string>];
    expect(labelArg.resolved_action).toBe("evaluator_failed");
  });
});

// ─── §8-10 Fire-and-forget — SSE failures do not throw ────────────────────────

describe("archetype-routing-observability — SSE failure resilience (received)", () => {
  it("emitArchetypeSignalReceived does not throw when broadcastSSE throws", async () => {
    vi.resetModules();

    vi.doMock("../../routes/sse.js", () => ({
      broadcastSSE: vi.fn().mockImplementation(() => {
        throw new Error("broken SSE socket");
      }),
      ARCHETYPE_ROUTING_EVENTS: {
        SIGNAL_RECEIVED:  "archetype:signal_received",
        SIGNAL_RESOLVED:  "archetype:signal_resolved",
        EVALUATOR_FAILED: "archetype:evaluator_failed",
      },
    }));
    vi.doMock("../metrics-registry.js", () => ({
      archetypeSignalsRoutedTotal: { labels: () => ({ inc: vi.fn() }) },
    }));
    vi.doMock("../logger.js", () => ({
      logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
    }));

    const { emitArchetypeSignalReceived } = await import("../archetype-routing-observability.js");

    expect(() =>
      emitArchetypeSignalReceived({
        strategy_id:    "s-sse-fail-recv",
        archetype:      "bounce_off_level",
        account_id:     "acct-01",
        correlation_id: null,
        bar_timestamp:  "2026-06-23T09:30:00.000Z",
      })
    ).not.toThrow();
  });
});

describe("archetype-routing-observability — SSE failure resilience (resolved)", () => {
  it("emitArchetypeSignalResolved does not throw when broadcastSSE throws", async () => {
    vi.resetModules();

    vi.doMock("../../routes/sse.js", () => ({
      broadcastSSE: vi.fn().mockImplementation(() => {
        throw new Error("dead SSE client");
      }),
      ARCHETYPE_ROUTING_EVENTS: {
        SIGNAL_RECEIVED:  "archetype:signal_received",
        SIGNAL_RESOLVED:  "archetype:signal_resolved",
        EVALUATOR_FAILED: "archetype:evaluator_failed",
      },
    }));
    vi.doMock("../metrics-registry.js", () => ({
      archetypeSignalsRoutedTotal: { labels: () => ({ inc: vi.fn() }) },
    }));
    vi.doMock("../logger.js", () => ({
      logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
    }));

    const { emitArchetypeSignalResolved } = await import("../archetype-routing-observability.js");

    expect(() =>
      emitArchetypeSignalResolved({
        strategy_id:     "s-sse-fail-resolved",
        archetype:       "bounce_off_level",
        resolved_action: "enter_long",
        account_id:      "acct-01",
        correlation_id:  null,
        reason:          null,
      })
    ).not.toThrow();
  });
});

describe("archetype-routing-observability — SSE failure resilience (failed)", () => {
  it("emitArchetypeEvaluatorFailed does not throw when broadcastSSE throws", async () => {
    vi.resetModules();

    vi.doMock("../../routes/sse.js", () => ({
      broadcastSSE: vi.fn().mockImplementation(() => {
        throw new Error("dead SSE client");
      }),
      ARCHETYPE_ROUTING_EVENTS: {
        SIGNAL_RECEIVED:  "archetype:signal_received",
        SIGNAL_RESOLVED:  "archetype:signal_resolved",
        EVALUATOR_FAILED: "archetype:evaluator_failed",
      },
    }));
    vi.doMock("../metrics-registry.js", () => ({
      archetypeSignalsRoutedTotal: { labels: () => ({ inc: vi.fn() }) },
    }));
    vi.doMock("../logger.js", () => ({
      logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
    }));

    const { emitArchetypeEvaluatorFailed } = await import("../archetype-routing-observability.js");

    expect(() =>
      emitArchetypeEvaluatorFailed({
        strategy_id:    "s-sse-fail-eval",
        archetype:      "bounce_off_level",
        error_class:    "TimeoutError",
        correlation_id: null,
      })
    ).not.toThrow();
  });
});

// ─── §11-12 Fire-and-forget — counter failures do not throw ───────────────────

describe("archetype-routing-observability — counter failure resilience (resolved)", () => {
  it("emitArchetypeSignalResolved does not throw when counter.labels().inc() throws", async () => {
    vi.resetModules();

    vi.doMock("../../routes/sse.js", () => ({
      broadcastSSE: vi.fn(),
      ARCHETYPE_ROUTING_EVENTS: {
        SIGNAL_RECEIVED:  "archetype:signal_received",
        SIGNAL_RESOLVED:  "archetype:signal_resolved",
        EVALUATOR_FAILED: "archetype:evaluator_failed",
      },
    }));
    vi.doMock("../metrics-registry.js", () => ({
      archetypeSignalsRoutedTotal: {
        labels: vi.fn().mockReturnValue({
          inc: vi.fn().mockImplementation(() => {
            throw new Error("prom-client registry not initialized");
          }),
        }),
      },
    }));
    vi.doMock("../logger.js", () => ({
      logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
    }));

    const { emitArchetypeSignalResolved } = await import("../archetype-routing-observability.js");

    expect(() =>
      emitArchetypeSignalResolved({
        strategy_id:     "s-counter-fail-resolved",
        archetype:       "bounce_off_level",
        resolved_action: "enter_long",
        account_id:      "acct-01",
        correlation_id:  null,
        reason:          null,
      })
    ).not.toThrow();
  });
});

describe("archetype-routing-observability — counter failure resilience (failed)", () => {
  it("emitArchetypeEvaluatorFailed does not throw when counter.labels().inc() throws", async () => {
    vi.resetModules();

    vi.doMock("../../routes/sse.js", () => ({
      broadcastSSE: vi.fn(),
      ARCHETYPE_ROUTING_EVENTS: {
        SIGNAL_RECEIVED:  "archetype:signal_received",
        SIGNAL_RESOLVED:  "archetype:signal_resolved",
        EVALUATOR_FAILED: "archetype:evaluator_failed",
      },
    }));
    vi.doMock("../metrics-registry.js", () => ({
      archetypeSignalsRoutedTotal: {
        labels: vi.fn().mockReturnValue({
          inc: vi.fn().mockImplementation(() => {
            throw new Error("prom-client registry not initialized");
          }),
        }),
      },
    }));
    vi.doMock("../logger.js", () => ({
      logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
    }));

    const { emitArchetypeEvaluatorFailed } = await import("../archetype-routing-observability.js");

    expect(() =>
      emitArchetypeEvaluatorFailed({
        strategy_id:    "s-counter-fail-eval",
        archetype:      "bounce_off_level",
        error_class:    "SubprocessError",
        correlation_id: null,
      })
    ).not.toThrow();
  });
});

// ─── §13 Counter aggregation — multiple resolved calls accumulate ─────────────

describe("archetype-routing-observability — counter aggregation (same archetype)", () => {
  it("three resolved calls with same archetype increment the counter three times", async () => {
    vi.resetModules();
    const incMock = vi.fn();

    vi.doMock("../../routes/sse.js", () => ({
      broadcastSSE: vi.fn(),
      ARCHETYPE_ROUTING_EVENTS: {
        SIGNAL_RECEIVED:  "archetype:signal_received",
        SIGNAL_RESOLVED:  "archetype:signal_resolved",
        EVALUATOR_FAILED: "archetype:evaluator_failed",
      },
    }));
    vi.doMock("../metrics-registry.js", () => ({
      archetypeSignalsRoutedTotal: { labels: () => ({ inc: incMock }) },
    }));
    vi.doMock("../logger.js", () => ({
      logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
    }));

    const { emitArchetypeSignalResolved } = await import("../archetype-routing-observability.js");

    const base = {
      archetype:       "bounce_off_level",
      resolved_action: "enter_long" as const,
      account_id:      "acct-01",
      correlation_id:  null,
      reason:          null,
    };

    emitArchetypeSignalResolved({ ...base, strategy_id: "s-a" });
    emitArchetypeSignalResolved({ ...base, strategy_id: "s-b" });
    emitArchetypeSignalResolved({ ...base, strategy_id: "s-c" });

    expect(incMock).toHaveBeenCalledTimes(3);
  });
});

// ─── §14 Counter aggregation — different archetypes use independent labels ────

describe("archetype-routing-observability — counter aggregation (different archetypes)", () => {
  it("two calls with different archetypes each receive their own label call", async () => {
    vi.resetModules();
    const incMock = vi.fn();
    const labelsMock = vi.fn().mockReturnValue({ inc: incMock });

    vi.doMock("../../routes/sse.js", () => ({
      broadcastSSE: vi.fn(),
      ARCHETYPE_ROUTING_EVENTS: {
        SIGNAL_RECEIVED:  "archetype:signal_received",
        SIGNAL_RESOLVED:  "archetype:signal_resolved",
        EVALUATOR_FAILED: "archetype:evaluator_failed",
      },
    }));
    vi.doMock("../metrics-registry.js", () => ({
      archetypeSignalsRoutedTotal: { labels: labelsMock },
    }));
    vi.doMock("../logger.js", () => ({
      logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
    }));

    const { emitArchetypeSignalResolved } = await import("../archetype-routing-observability.js");

    emitArchetypeSignalResolved({
      strategy_id:     "s-x",
      archetype:       "bounce_off_level",
      resolved_action: "enter_long",
      account_id:      "acct-01",
      correlation_id:  null,
      reason:          null,
    });

    emitArchetypeSignalResolved({
      strategy_id:     "s-y",
      archetype:       "ict_bias_aligned_continuation",
      resolved_action: "hold",
      account_id:      "acct-01",
      correlation_id:  null,
      reason:          null,
    });

    expect(labelsMock).toHaveBeenCalledTimes(2);
    expect(labelsMock).toHaveBeenCalledWith({
      archetype:       "bounce_off_level",
      resolved_action: "enter_long",
    });
    expect(labelsMock).toHaveBeenCalledWith({
      archetype:       "ict_bias_aligned_continuation",
      resolved_action: "hold",
    });
    expect(incMock).toHaveBeenCalledTimes(2);
  });
});

// ─── §15-17 Correlation ID — null propagates without error ───────────────────

describe("archetype-routing-observability — correlation_id null (received)", () => {
  it("accepts null correlation_id and propagates it in the SSE payload", async () => {
    vi.resetModules();
    const broadcastMock = vi.fn();

    vi.doMock("../../routes/sse.js", () => ({
      broadcastSSE: broadcastMock,
      ARCHETYPE_ROUTING_EVENTS: {
        SIGNAL_RECEIVED:  "archetype:signal_received",
        SIGNAL_RESOLVED:  "archetype:signal_resolved",
        EVALUATOR_FAILED: "archetype:evaluator_failed",
      },
    }));
    vi.doMock("../metrics-registry.js", () => ({
      archetypeSignalsRoutedTotal: { labels: () => ({ inc: vi.fn() }) },
    }));
    vi.doMock("../logger.js", () => ({
      logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
    }));

    const { emitArchetypeSignalReceived } = await import("../archetype-routing-observability.js");

    expect(() =>
      emitArchetypeSignalReceived({
        strategy_id:    "s-null-corr-recv",
        archetype:      "bounce_off_level",
        account_id:     "acct-01",
        correlation_id: null,
        bar_timestamp:  "2026-06-23T09:30:00.000Z",
      })
    ).not.toThrow();

    const payload = broadcastMock.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.correlation_id).toBeNull();
  });
});

describe("archetype-routing-observability — correlation_id null (resolved)", () => {
  it("accepts null correlation_id in resolved payload and propagates it via SSE", async () => {
    vi.resetModules();
    const broadcastMock = vi.fn();

    vi.doMock("../../routes/sse.js", () => ({
      broadcastSSE: broadcastMock,
      ARCHETYPE_ROUTING_EVENTS: {
        SIGNAL_RECEIVED:  "archetype:signal_received",
        SIGNAL_RESOLVED:  "archetype:signal_resolved",
        EVALUATOR_FAILED: "archetype:evaluator_failed",
      },
    }));
    vi.doMock("../metrics-registry.js", () => ({
      archetypeSignalsRoutedTotal: { labels: () => ({ inc: vi.fn() }) },
    }));
    vi.doMock("../logger.js", () => ({
      logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
    }));

    const { emitArchetypeSignalResolved } = await import("../archetype-routing-observability.js");

    expect(() =>
      emitArchetypeSignalResolved({
        strategy_id:     "s-null-corr-res",
        archetype:       "bounce_off_level",
        resolved_action: "exit_long",
        account_id:      "acct-01",
        correlation_id:  null,
        reason:          null,
      })
    ).not.toThrow();

    const payload = broadcastMock.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.correlation_id).toBeNull();
  });
});

describe("archetype-routing-observability — correlation_id null (failed)", () => {
  it("accepts null correlation_id in evaluator_failed payload and propagates it via SSE", async () => {
    vi.resetModules();
    const broadcastMock = vi.fn();

    vi.doMock("../../routes/sse.js", () => ({
      broadcastSSE: broadcastMock,
      ARCHETYPE_ROUTING_EVENTS: {
        SIGNAL_RECEIVED:  "archetype:signal_received",
        SIGNAL_RESOLVED:  "archetype:signal_resolved",
        EVALUATOR_FAILED: "archetype:evaluator_failed",
      },
    }));
    vi.doMock("../metrics-registry.js", () => ({
      archetypeSignalsRoutedTotal: { labels: () => ({ inc: vi.fn() }) },
    }));
    vi.doMock("../logger.js", () => ({
      logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
    }));

    const { emitArchetypeEvaluatorFailed } = await import("../archetype-routing-observability.js");

    expect(() =>
      emitArchetypeEvaluatorFailed({
        strategy_id:    "s-null-corr-fail",
        archetype:      "bounce_off_level",
        error_class:    "TimeoutError",
        correlation_id: null,
      })
    ).not.toThrow();

    const payload = broadcastMock.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.correlation_id).toBeNull();
  });
});

// ─── §18 All resolved_action values pass through emitArchetypeSignalResolved ──

describe("archetype-routing-observability — all non-failure resolved_action values", () => {
  const validActions = [
    "enter_long",
    "enter_short",
    "exit_long",
    "exit_short",
    "hold",
  ] as const;

  for (const action of validActions) {
    it(`broadcasts archetype:signal_resolved for resolved_action="${action}"`, async () => {
      vi.resetModules();
      const broadcastMock = vi.fn();

      vi.doMock("../../routes/sse.js", () => ({
        broadcastSSE: broadcastMock,
        ARCHETYPE_ROUTING_EVENTS: {
          SIGNAL_RECEIVED:  "archetype:signal_received",
          SIGNAL_RESOLVED:  "archetype:signal_resolved",
          EVALUATOR_FAILED: "archetype:evaluator_failed",
        },
      }));
      vi.doMock("../metrics-registry.js", () => ({
        archetypeSignalsRoutedTotal: { labels: () => ({ inc: vi.fn() }) },
      }));
      vi.doMock("../logger.js", () => ({
        logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
      }));

      const { emitArchetypeSignalResolved } = await import("../archetype-routing-observability.js");

      emitArchetypeSignalResolved({
        strategy_id:     `strat-${action}`,
        archetype:       "bounce_off_level",
        resolved_action: action,
        account_id:      "acct-01",
        correlation_id:  null,
        reason:          null,
      });

      expect(broadcastMock).toHaveBeenCalledOnce();
      const [eventName, payload] = broadcastMock.mock.calls[0] as [string, Record<string, unknown>];
      expect(eventName).toBe("archetype:signal_resolved");
      expect(payload.resolved_action).toBe(action);
    });
  }
});
