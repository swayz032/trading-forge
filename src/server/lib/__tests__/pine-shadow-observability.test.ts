/**
 * pine-shadow-observability.test.ts — Pass 3 Track D (2026-06-22)
 *
 * Verifies the observability helper that fires both the SSE broadcast and the
 * Prometheus counter increment on every Pine export SHADOW refusal.
 *
 * Test strategy:
 *   - Static source-file inspection for structural contracts (no mock required).
 *   - Runtime unit tests with vi.doMock() isolation: mocked broadcastSSE,
 *     PINE_EVENTS, pineShadowRefusalsTotal, and logger so no I/O occurs.
 *   - All tests verify the exact payload shape Track A + C will receive.
 *
 * Tests:
 *   §1  Source-level structural checks (exports, type, constant, counter)
 *   §2  SSE broadcast — correct event name + payload fields on emitPineShadowRefused()
 *   §3  Prometheus counter — correct label + increment on emitPineShadowRefused()
 *   §4  Label aggregation — multiple calls with same blocked_at accumulate
 *   §5  Label aggregation — multiple calls with different blocked_at are independent
 *   §6  Fire-and-forget contract — no throw on SSE failure
 *   §7  Fire-and-forget contract — no throw on counter failure
 *   §8  Correlation ID — null propagation (no block, no warn)
 *   §9  Correlation ID — non-null propagation preserved in SSE payload
 *  §10  All four BlockedAtSite values are covered by the type in source
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";

// ─── Source files for static inspection ──────────────────────────────────────

const HELPER_SRC = fs.readFileSync(
  path.resolve(__dirname, "../pine-shadow-observability.ts"),
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

describe("pine-shadow-observability — source structure", () => {
  it("exports emitPineShadowRefused as a named void function", () => {
    expect(HELPER_SRC).toContain("export function emitPineShadowRefused");
    expect(HELPER_SRC).toMatch(/export function emitPineShadowRefused[\s\S]{0,200}\): void/);
  });

  it("is NOT declared async (fire-and-forget contract)", () => {
    expect(HELPER_SRC).not.toMatch(/export async function emitPineShadowRefused/);
  });

  it("exports PineShadowRefusedPayload interface with all 5 required fields", () => {
    expect(HELPER_SRC).toContain("export interface PineShadowRefusedPayload");
    expect(HELPER_SRC).toContain("strategy_id");
    expect(HELPER_SRC).toContain("lifecycle_state");
    expect(HELPER_SRC).toContain("shadow_mode_enabled");
    expect(HELPER_SRC).toContain("blocked_at");
    expect(HELPER_SRC).toContain("correlation_id");
  });

  it("exports BlockedAtSite type with all 4 call-site values", () => {
    expect(HELPER_SRC).toContain("export type BlockedAtSite");
    expect(HELPER_SRC).toContain('"compileDualPineExport"');
    expect(HELPER_SRC).toContain('"compilePineExport"');
    expect(HELPER_SRC).toContain('"recipient_build"');
    expect(HELPER_SRC).toContain('"artifact_download"');
  });

  it("imports pineShadowRefusalsTotal from metrics-registry", () => {
    expect(HELPER_SRC).toContain("pineShadowRefusalsTotal");
    expect(HELPER_SRC).toContain("metrics-registry");
  });

  it("imports broadcastSSE and PINE_EVENTS from sse.ts route", () => {
    expect(HELPER_SRC).toContain("broadcastSSE");
    expect(HELPER_SRC).toContain("PINE_EVENTS");
    expect(HELPER_SRC).toMatch(/from.*sse\.js/);
  });

  it("Prometheus increment is inside a try/catch block", () => {
    expect(HELPER_SRC).toMatch(/try\s*\{[\s\S]{0,100}pineShadowRefusalsTotal/);
  });

  it("SSE broadcast is inside a try/catch block", () => {
    expect(HELPER_SRC).toMatch(/try\s*\{[\s\S]{0,100}broadcastSSE/);
  });

  it("metrics-registry.ts declares pineShadowRefusalsTotal Counter", () => {
    expect(METRICS_SRC).toContain("pineShadowRefusalsTotal");
    expect(METRICS_SRC).toContain("tf_pine_shadow_refusals_total");
  });

  it("metrics-registry.ts counter has blocked_at label", () => {
    // Find the pineShadowRefusalsTotal block and verify labelNames includes blocked_at
    const idx = METRICS_SRC.indexOf("pineShadowRefusalsTotal");
    const block = METRICS_SRC.slice(idx, idx + 400);
    expect(block).toContain("blocked_at");
    expect(block).toContain("labelNames");
  });

  it("sse.ts declares PINE_EVENTS.REFUSED_SHADOW_STRATEGY", () => {
    expect(SSE_SRC).toContain("PINE_EVENTS");
    expect(SSE_SRC).toContain("REFUSED_SHADOW_STRATEGY");
    expect(SSE_SRC).toContain("pine:refused_shadow_strategy");
  });

  it("sse.ts exports PineEventName type", () => {
    expect(SSE_SRC).toContain("export type PineEventName");
  });
});

// ─── §2 SSE broadcast — correct event name and payload ───────────────────────

describe("pine-shadow-observability — SSE broadcast", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("broadcasts pine:refused_shadow_strategy with all 5 payload fields", async () => {
    const broadcastMock = vi.fn();
    const incMock = vi.fn();

    vi.doMock("../../routes/sse.js", () => ({
      broadcastSSE: broadcastMock,
      PINE_EVENTS: { REFUSED_SHADOW_STRATEGY: "pine:refused_shadow_strategy" },
    }));
    vi.doMock("../metrics-registry.js", () => ({
      pineShadowRefusalsTotal: { labels: () => ({ inc: incMock }) },
    }));
    vi.doMock("../logger.js", () => ({
      logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
    }));

    const { emitPineShadowRefused } = await import("../pine-shadow-observability.js");

    emitPineShadowRefused({
      strategy_id:         "strat-uuid-001",
      lifecycle_state:     "SHADOW",
      shadow_mode_enabled: true,
      blocked_at:          "compileDualPineExport",
      correlation_id:      "corr-abc-123",
    });

    expect(broadcastMock).toHaveBeenCalledOnce();
    const [eventName, payload] = broadcastMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(eventName).toBe("pine:refused_shadow_strategy");
    expect(payload.strategy_id).toBe("strat-uuid-001");
    expect(payload.lifecycle_state).toBe("SHADOW");
    expect(payload.shadow_mode_enabled).toBe(true);
    expect(payload.blocked_at).toBe("compileDualPineExport");
    expect(payload.correlation_id).toBe("corr-abc-123");
  });

  it("broadcasts correct event name for recipient_build call site", async () => {
    vi.resetModules();
    const broadcastMock = vi.fn();

    vi.doMock("../../routes/sse.js", () => ({
      broadcastSSE: broadcastMock,
      PINE_EVENTS: { REFUSED_SHADOW_STRATEGY: "pine:refused_shadow_strategy" },
    }));
    vi.doMock("../metrics-registry.js", () => ({
      pineShadowRefusalsTotal: { labels: () => ({ inc: vi.fn() }) },
    }));
    vi.doMock("../logger.js", () => ({
      logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
    }));

    const { emitPineShadowRefused } = await import("../pine-shadow-observability.js");

    emitPineShadowRefused({
      strategy_id:         "strat-uuid-002",
      lifecycle_state:     "SHADOW",
      shadow_mode_enabled: false,
      blocked_at:          "recipient_build",
      correlation_id:      null,
    });

    const [eventName] = broadcastMock.mock.calls[0] as [string, unknown];
    expect(eventName).toBe("pine:refused_shadow_strategy");
  });
});

// ─── §3 Prometheus counter — correct label + increment ───────────────────────

describe("pine-shadow-observability — Prometheus counter", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("increments pineShadowRefusalsTotal with correct blocked_at label", async () => {
    const incMock = vi.fn();
    const labelsMock = vi.fn().mockReturnValue({ inc: incMock });

    vi.doMock("../../routes/sse.js", () => ({
      broadcastSSE: vi.fn(),
      PINE_EVENTS: { REFUSED_SHADOW_STRATEGY: "pine:refused_shadow_strategy" },
    }));
    vi.doMock("../metrics-registry.js", () => ({
      pineShadowRefusalsTotal: { labels: labelsMock },
    }));
    vi.doMock("../logger.js", () => ({
      logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
    }));

    const { emitPineShadowRefused } = await import("../pine-shadow-observability.js");

    emitPineShadowRefused({
      strategy_id:         "strat-uuid-003",
      lifecycle_state:     "SHADOW",
      shadow_mode_enabled: true,
      blocked_at:          "artifact_download",
      correlation_id:      "corr-xyz-789",
    });

    expect(labelsMock).toHaveBeenCalledWith({ blocked_at: "artifact_download" });
    expect(incMock).toHaveBeenCalledOnce();
  });

  it("increments for compilePineExport call site", async () => {
    vi.resetModules();
    const incMock = vi.fn();
    const labelsMock = vi.fn().mockReturnValue({ inc: incMock });

    vi.doMock("../../routes/sse.js", () => ({
      broadcastSSE: vi.fn(),
      PINE_EVENTS: { REFUSED_SHADOW_STRATEGY: "pine:refused_shadow_strategy" },
    }));
    vi.doMock("../metrics-registry.js", () => ({
      pineShadowRefusalsTotal: { labels: labelsMock },
    }));
    vi.doMock("../logger.js", () => ({
      logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
    }));

    const { emitPineShadowRefused } = await import("../pine-shadow-observability.js");

    emitPineShadowRefused({
      strategy_id:         "strat-uuid-004",
      lifecycle_state:     "TESTING",
      shadow_mode_enabled: true,
      blocked_at:          "compilePineExport",
      correlation_id:      null,
    });

    expect(labelsMock).toHaveBeenCalledWith({ blocked_at: "compilePineExport" });
    expect(incMock).toHaveBeenCalledOnce();
  });
});

// ─── §4 Label aggregation — same blocked_at accumulates ──────────────────────

describe("pine-shadow-observability — label aggregation (same site)", () => {
  it("three calls with the same blocked_at increment the counter three times", async () => {
    vi.resetModules();
    const incMock = vi.fn();

    vi.doMock("../../routes/sse.js", () => ({
      broadcastSSE: vi.fn(),
      PINE_EVENTS: { REFUSED_SHADOW_STRATEGY: "pine:refused_shadow_strategy" },
    }));
    vi.doMock("../metrics-registry.js", () => ({
      pineShadowRefusalsTotal: { labels: () => ({ inc: incMock }) },
    }));
    vi.doMock("../logger.js", () => ({
      logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
    }));

    const { emitPineShadowRefused } = await import("../pine-shadow-observability.js");

    const base = {
      lifecycle_state:     "SHADOW",
      shadow_mode_enabled: true,
      blocked_at:          "compileDualPineExport" as const,
      correlation_id:      null,
    };

    emitPineShadowRefused({ ...base, strategy_id: "s-a" });
    emitPineShadowRefused({ ...base, strategy_id: "s-b" });
    emitPineShadowRefused({ ...base, strategy_id: "s-c" });

    // counter must have been incremented exactly 3 times
    expect(incMock).toHaveBeenCalledTimes(3);
  });
});

// ─── §5 Label aggregation — different blocked_at values are independent ───────

describe("pine-shadow-observability — label aggregation (different sites)", () => {
  it("two calls with different blocked_at values each receive their own label call", async () => {
    vi.resetModules();
    const incMock = vi.fn();
    const labelsMock = vi.fn().mockReturnValue({ inc: incMock });

    vi.doMock("../../routes/sse.js", () => ({
      broadcastSSE: vi.fn(),
      PINE_EVENTS: { REFUSED_SHADOW_STRATEGY: "pine:refused_shadow_strategy" },
    }));
    vi.doMock("../metrics-registry.js", () => ({
      pineShadowRefusalsTotal: { labels: labelsMock },
    }));
    vi.doMock("../logger.js", () => ({
      logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
    }));

    const { emitPineShadowRefused } = await import("../pine-shadow-observability.js");

    emitPineShadowRefused({
      strategy_id:         "s-x",
      lifecycle_state:     "SHADOW",
      shadow_mode_enabled: true,
      blocked_at:          "compileDualPineExport",
      correlation_id:      null,
    });

    emitPineShadowRefused({
      strategy_id:         "s-y",
      lifecycle_state:     "SHADOW",
      shadow_mode_enabled: true,
      blocked_at:          "artifact_download",
      correlation_id:      null,
    });

    // Two separate labels() calls with different blocked_at values
    expect(labelsMock).toHaveBeenCalledTimes(2);
    expect(labelsMock).toHaveBeenCalledWith({ blocked_at: "compileDualPineExport" });
    expect(labelsMock).toHaveBeenCalledWith({ blocked_at: "artifact_download" });
    expect(incMock).toHaveBeenCalledTimes(2);
  });
});

// ─── §6 Fire-and-forget contract — SSE failure does not throw ─────────────────

describe("pine-shadow-observability — SSE failure resilience", () => {
  it("does not throw when broadcastSSE throws internally", async () => {
    vi.resetModules();

    vi.doMock("../../routes/sse.js", () => ({
      broadcastSSE: vi.fn().mockImplementation(() => {
        throw new Error("broken SSE socket");
      }),
      PINE_EVENTS: { REFUSED_SHADOW_STRATEGY: "pine:refused_shadow_strategy" },
    }));
    vi.doMock("../metrics-registry.js", () => ({
      pineShadowRefusalsTotal: { labels: () => ({ inc: vi.fn() }) },
    }));
    vi.doMock("../logger.js", () => ({
      logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
    }));

    const { emitPineShadowRefused } = await import("../pine-shadow-observability.js");

    expect(() =>
      emitPineShadowRefused({
        strategy_id:         "s-fail-sse",
        lifecycle_state:     "SHADOW",
        shadow_mode_enabled: true,
        blocked_at:          "compilePineExport",
        correlation_id:      null,
      })
    ).not.toThrow();
  });
});

// ─── §7 Fire-and-forget contract — counter failure does not throw ─────────────

describe("pine-shadow-observability — counter failure resilience", () => {
  it("does not throw when Prometheus labels().inc() throws", async () => {
    vi.resetModules();

    vi.doMock("../../routes/sse.js", () => ({
      broadcastSSE: vi.fn(),
      PINE_EVENTS: { REFUSED_SHADOW_STRATEGY: "pine:refused_shadow_strategy" },
    }));
    vi.doMock("../metrics-registry.js", () => ({
      pineShadowRefusalsTotal: {
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

    const { emitPineShadowRefused } = await import("../pine-shadow-observability.js");

    expect(() =>
      emitPineShadowRefused({
        strategy_id:         "s-fail-counter",
        lifecycle_state:     "SHADOW",
        shadow_mode_enabled: false,
        blocked_at:          "recipient_build",
        correlation_id:      null,
      })
    ).not.toThrow();
  });
});

// ─── §8 Correlation ID — null does not cause errors ──────────────────────────

describe("pine-shadow-observability — correlation_id: null", () => {
  it("accepts null correlation_id and propagates it in the SSE payload", async () => {
    vi.resetModules();
    const broadcastMock = vi.fn();

    vi.doMock("../../routes/sse.js", () => ({
      broadcastSSE: broadcastMock,
      PINE_EVENTS: { REFUSED_SHADOW_STRATEGY: "pine:refused_shadow_strategy" },
    }));
    vi.doMock("../metrics-registry.js", () => ({
      pineShadowRefusalsTotal: { labels: () => ({ inc: vi.fn() }) },
    }));
    vi.doMock("../logger.js", () => ({
      logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
    }));

    const { emitPineShadowRefused } = await import("../pine-shadow-observability.js");

    expect(() =>
      emitPineShadowRefused({
        strategy_id:         "s-null-corr",
        lifecycle_state:     "SHADOW",
        shadow_mode_enabled: true,
        blocked_at:          "compileDualPineExport",
        correlation_id:      null,
      })
    ).not.toThrow();

    const payload = broadcastMock.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.correlation_id).toBeNull();
  });
});

// ─── §9 Correlation ID — non-null preserved in SSE payload ───────────────────

describe("pine-shadow-observability — correlation_id: non-null", () => {
  it("passes correlation_id through to SSE payload unchanged", async () => {
    vi.resetModules();
    const broadcastMock = vi.fn();

    vi.doMock("../../routes/sse.js", () => ({
      broadcastSSE: broadcastMock,
      PINE_EVENTS: { REFUSED_SHADOW_STRATEGY: "pine:refused_shadow_strategy" },
    }));
    vi.doMock("../metrics-registry.js", () => ({
      pineShadowRefusalsTotal: { labels: () => ({ inc: vi.fn() }) },
    }));
    vi.doMock("../logger.js", () => ({
      logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
    }));

    const { emitPineShadowRefused } = await import("../pine-shadow-observability.js");

    emitPineShadowRefused({
      strategy_id:         "s-corr-present",
      lifecycle_state:     "SHADOW",
      shadow_mode_enabled: true,
      blocked_at:          "artifact_download",
      correlation_id:      "trace-id-9999",
    });

    const payload = broadcastMock.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.correlation_id).toBe("trace-id-9999");
  });
});

// ─── §10 All four BlockedAtSite values in SSE payload (coverage sweep) ────────

describe("pine-shadow-observability — all BlockedAtSite values emit SSE", () => {
  const allSites = [
    "compileDualPineExport",
    "compilePineExport",
    "recipient_build",
    "artifact_download",
  ] as const;

  for (const site of allSites) {
    it(`emits pine:refused_shadow_strategy for blocked_at="${site}"`, async () => {
      vi.resetModules();
      const broadcastMock = vi.fn();

      vi.doMock("../../routes/sse.js", () => ({
        broadcastSSE: broadcastMock,
        PINE_EVENTS: { REFUSED_SHADOW_STRATEGY: "pine:refused_shadow_strategy" },
      }));
      vi.doMock("../metrics-registry.js", () => ({
        pineShadowRefusalsTotal: { labels: () => ({ inc: vi.fn() }) },
      }));
      vi.doMock("../logger.js", () => ({
        logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
      }));

      const { emitPineShadowRefused } = await import("../pine-shadow-observability.js");

      emitPineShadowRefused({
        strategy_id:         `strat-${site}`,
        lifecycle_state:     "SHADOW",
        shadow_mode_enabled: true,
        blocked_at:          site,
        correlation_id:      null,
      });

      expect(broadcastMock).toHaveBeenCalledOnce();
      const [eventName, payload] = broadcastMock.mock.calls[0] as [string, Record<string, unknown>];
      expect(eventName).toBe("pine:refused_shadow_strategy");
      expect(payload.blocked_at).toBe(site);
    });
  }
});
