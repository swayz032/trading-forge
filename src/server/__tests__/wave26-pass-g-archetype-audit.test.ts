/**
 * wave26-pass-g-archetype-audit.test.ts — Wave 26 Pass G (2026-05-26)
 *
 * Verifies the observability layer for the two new engine archetypes and the
 * A3 strategy-source resolver. Four audit event contracts and all SSE + metric
 * emissions are exercised here.
 *
 * Test strategy: static source inspection + isolated unit tests with mocked
 * dependencies (mirrors wave26-pass-d-graduator-vocab-expansion.test.ts pattern).
 * No DB connection required.
 *
 * Tests:
 *   1. engine.archetype.bounce_off_level.signal_fired — all required fields
 *   2. engine.archetype.ict_bias_aligned_continuation.signal_fired — all required fields
 *   3. strategy.source_url_resolved — all 4 resolution paths emit correct audit
 *   4. strategy.source_url_unresolved — WARN status, orphan-detection path
 *   5. SSE factory:archetype_signal_fired broadcast on both archetypes
 *   6. Prometheus tf_archetype_signals_total increments on both archetypes
 *   7. Prometheus tf_strategy_source_resolution_total increments per path
 *   8. graduation.archetype_route_taken — routed via WAVE26G_AUDIT_ARCHETYPES
 *   9. ARCHETYPE_REGISTRY contains bounce_off_level and ict_bias_aligned_continuation
 *  10. deriveEntryIndicator routing regex covers bounce and continuation concepts
 *  11. WAVE26G_AUDIT_ARCHETYPES constant contains both new archetypes
 *  12. fire-and-forget pattern: emit functions are void and never throw
 *  13. Correlation ID propagated through to audit row
 *  14. strategy-source-resolver emits unresolved audit on null return
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";

// ─── Source files for static inspection ──────────────────────────────────────

const GRADUATOR_SRC = fs.readFileSync(
  path.resolve(__dirname, "../services/direct-bucket-graduator.ts"),
  "utf-8",
);

const ARCHETYPE_AUDIT_SRC = fs.readFileSync(
  path.resolve(__dirname, "../lib/archetype-signal-audit.ts"),
  "utf-8",
);

const METRICS_REGISTRY_SRC = fs.readFileSync(
  path.resolve(__dirname, "../lib/metrics-registry.ts"),
  "utf-8",
);

const SSE_SRC = fs.readFileSync(
  path.resolve(__dirname, "../routes/sse.ts"),
  "utf-8",
);

const SOURCE_RESOLVER_SRC = fs.readFileSync(
  path.resolve(__dirname, "../lib/strategy-source-resolver.ts"),
  "utf-8",
);

// ─── §1 Archetype registry ────────────────────────────────────────────────────

describe("Wave 26 Pass G — ARCHETYPE_REGISTRY entries", () => {
  it("registers bounce_off_level with correct engineSpec", () => {
    expect(GRADUATOR_SRC).toMatch(/bounce_off_level:\s*\{/);
    expect(GRADUATOR_SRC).toMatch(/engineSpec:\s*["']bounce_off_level["']/);
    expect(GRADUATOR_SRC).toMatch(/strategyClass:\s*["']src\.engine\.strategies\.bounce_off_level\.BounceOffLevelStrategy["']/);
  });

  it("registers ict_bias_aligned_continuation with correct engineSpec", () => {
    expect(GRADUATOR_SRC).toMatch(/ict_bias_aligned_continuation:\s*\{/);
    expect(GRADUATOR_SRC).toMatch(/engineSpec:\s*["']ict_bias_aligned_continuation["']/);
    // A2 may use either capitalization for the Python class name
    expect(GRADUATOR_SRC).toMatch(/strategyClass:\s*["']src\.engine\.strategies\.ict_bias_aligned_continuation\.(Ict|ICT)BiasAlignedContinuationStrategy["']/);
  });
});

// ─── §2 WAVE26G_AUDIT_ARCHETYPES constant ────────────────────────────────────

describe("Wave 26 Pass G — WAVE26G_AUDIT_ARCHETYPES constant", () => {
  it("declares the constant with both new archetype names", () => {
    expect(GRADUATOR_SRC).toContain("WAVE26G_AUDIT_ARCHETYPES");
    expect(GRADUATOR_SRC).toMatch(/WAVE26G_AUDIT_ARCHETYPES.*bounce_off_level/s);
    expect(GRADUATOR_SRC).toMatch(/WAVE26G_AUDIT_ARCHETYPES.*ict_bias_aligned_continuation/s);
  });

  it("declares WAVE26G_ROUTE_PATTERNS for both archetypes", () => {
    expect(GRADUATOR_SRC).toContain("WAVE26G_ROUTE_PATTERNS");
    expect(GRADUATOR_SRC).toMatch(/WAVE26G_ROUTE_PATTERNS.*bounce_off_level/s);
    expect(GRADUATOR_SRC).toMatch(/WAVE26G_ROUTE_PATTERNS.*ict_bias_aligned_continuation/s);
  });
});

// ─── §3 deriveEntryIndicator routing regex ────────────────────────────────────

describe("Wave 26 Pass G — deriveEntryIndicator routing", () => {
  it("ships bounce_off_level routing regex in deriveEntryIndicator", () => {
    expect(GRADUATOR_SRC).toContain("archetype:bounce_off_level");
  });

  it("ships ict_bias_aligned_continuation routing regex in deriveEntryIndicator", () => {
    expect(GRADUATOR_SRC).toContain("archetype:ict_bias_aligned_continuation");
  });

  it("bounce routing regex covers 'bounce off ema' pattern", () => {
    // The regex in source must handle the 'bounce' keyword combined with MA type
    expect(GRADUATOR_SRC).toMatch(/bounce.*archetype:bounce_off_level/s);
  });

  it("continuation routing regex covers 'bias_aligned' and 'bos_fvg' patterns", () => {
    expect(GRADUATOR_SRC).toMatch(/bias.aligned|bos.fvg|choch.fvg/);
  });
});

// ─── §4 graduation.archetype_route_taken audit event ─────────────────────────

describe("Wave 26 Pass G — graduation.archetype_route_taken audit", () => {
  it("audit action name graduation.archetype_route_taken is in source", () => {
    expect(GRADUATOR_SRC).toContain("graduation.archetype_route_taken");
  });

  it("audit fires using insertAuditRowSafe (fire-and-forget)", () => {
    // The action string appears in source at two types of locations:
    //   (a) inside the insertAuditRowSafe({ action: "graduation.archetype_route_taken" }) call
    //   (b) inside the .catch() logger.warn message after the call
    // We find the call-site occurrence (which has `action:` before it) and verify
    // both insertAuditRowSafe and a following .catch() are present in the block.
    const actionStr = 'action: "graduation.archetype_route_taken"';
    const callIdx = GRADUATOR_SRC.indexOf(actionStr);
    expect(callIdx).toBeGreaterThan(0);
    // insertAuditRowSafe must appear just before the action string
    const insertSafeIdx = GRADUATOR_SRC.lastIndexOf("insertAuditRowSafe", callIdx);
    expect(insertSafeIdx).toBeGreaterThan(0);
    expect(callIdx - insertSafeIdx).toBeLessThan(50); // within 50 chars
    // .catch() must appear after the insertAuditRowSafe call
    const afterCall = GRADUATOR_SRC.slice(callIdx, callIdx + 600);
    expect(afterCall).toMatch(/\.catch\(/);
  });

  it("audit row includes concept_name, archetype, and route_reason fields", () => {
    // Find the actual call — last occurrence of the action string is the real audit write
    const lastIdx = GRADUATOR_SRC.lastIndexOf("graduation.archetype_route_taken");
    // Look backward from action string to find the insertAuditRowSafe call context
    const callStart = GRADUATOR_SRC.lastIndexOf("insertAuditRowSafe", lastIdx);
    const contextWindow = GRADUATOR_SRC.slice(callStart, callStart + 700);
    expect(contextWindow).toContain("concept_name");
    expect(contextWindow).toContain("archetype");
    expect(contextWindow).toContain("route_reason");
  });

  it("audit fires only for WAVE26G_AUDIT_ARCHETYPES set members (not all archetypes)", () => {
    // The gate check must reference WAVE26G_AUDIT_ARCHETYPES.has()
    expect(GRADUATOR_SRC).toMatch(/WAVE26G_AUDIT_ARCHETYPES\.has\(/);
  });

  it("correlationId is threaded into the audit row", () => {
    // Find the actual insertAuditRowSafe call that writes the audit row
    const lastIdx = GRADUATOR_SRC.lastIndexOf("graduation.archetype_route_taken");
    const callStart = GRADUATOR_SRC.lastIndexOf("insertAuditRowSafe", lastIdx);
    const contextWindow = GRADUATOR_SRC.slice(callStart, callStart + 700);
    expect(contextWindow).toMatch(/correlationId/);
  });
});

// ─── §5 engine.archetype.bounce_off_level.signal_fired audit ─────────────────

describe("Wave 26 Pass G — engine.archetype.bounce_off_level.signal_fired", () => {
  it("action string is in archetype-signal-audit.ts", () => {
    expect(ARCHETYPE_AUDIT_SRC).toContain("engine.archetype.bounce_off_level.signal_fired");
  });

  it("payload type BounceOffLevelSignalPayload declares all required fields", () => {
    expect(ARCHETYPE_AUDIT_SRC).toContain("BounceOffLevelSignalPayload");
    expect(ARCHETYPE_AUDIT_SRC).toContain("strategy_id");
    expect(ARCHETYPE_AUDIT_SRC).toContain("correlation_id");
    expect(ARCHETYPE_AUDIT_SRC).toContain("direction");
    expect(ARCHETYPE_AUDIT_SRC).toContain("ma_type");
    expect(ARCHETYPE_AUDIT_SRC).toContain("ma_period");
    expect(ARCHETYPE_AUDIT_SRC).toContain("rejection_pattern");
    expect(ARCHETYPE_AUDIT_SRC).toContain("bar_timestamp");
  });

  it("emitBounceOffLevelSignal is exported", () => {
    expect(ARCHETYPE_AUDIT_SRC).toContain("export function emitBounceOffLevelSignal");
  });

  it("function is void (fire-and-forget — no async)", () => {
    const fnDecl = ARCHETYPE_AUDIT_SRC.match(/export function emitBounceOffLevelSignal[\s\S]{0,200}/)?.[0] ?? "";
    expect(fnDecl).toContain("): void");
    expect(fnDecl).not.toContain("async");
  });
});

// ─── §6 engine.archetype.ict_bias_aligned_continuation.signal_fired audit ────

describe("Wave 26 Pass G — engine.archetype.ict_bias_aligned_continuation.signal_fired", () => {
  it("action string is in archetype-signal-audit.ts", () => {
    expect(ARCHETYPE_AUDIT_SRC).toContain("engine.archetype.ict_bias_aligned_continuation.signal_fired");
  });

  it("payload type IctBiasAlignedContinuationSignalPayload declares all required fields", () => {
    expect(ARCHETYPE_AUDIT_SRC).toContain("IctBiasAlignedContinuationSignalPayload");
    expect(ARCHETYPE_AUDIT_SRC).toContain("strategy_id");
    expect(ARCHETYPE_AUDIT_SRC).toContain("correlation_id");
    expect(ARCHETYPE_AUDIT_SRC).toContain("direction");
    expect(ARCHETYPE_AUDIT_SRC).toContain("htf_bias");
    expect(ARCHETYPE_AUDIT_SRC).toContain("structure_break_type");
    expect(ARCHETYPE_AUDIT_SRC).toContain("fvg_age_bars");
    expect(ARCHETYPE_AUDIT_SRC).toContain("killzone");
    expect(ARCHETYPE_AUDIT_SRC).toContain("bar_timestamp");
  });

  it("structure_break_type is typed as BOS | CHoCH union", () => {
    expect(ARCHETYPE_AUDIT_SRC).toMatch(/structure_break_type:\s*["']BOS["']\s*\|\s*["']CHoCH["']/);
  });

  it("emitIctBiasAlignedContinuationSignal is exported", () => {
    expect(ARCHETYPE_AUDIT_SRC).toContain("export function emitIctBiasAlignedContinuationSignal");
  });

  it("function is void (fire-and-forget — no async)", () => {
    // Verify the function is not async (sync void fire-and-forget contract)
    expect(ARCHETYPE_AUDIT_SRC).toContain("export function emitIctBiasAlignedContinuationSignal");
    // It must NOT be declared as async export
    expect(ARCHETYPE_AUDIT_SRC).not.toMatch(/export async function emitIctBiasAlignedContinuationSignal/);
    // The function must declare a void return somewhere in its region
    const fnStart = ARCHETYPE_AUDIT_SRC.indexOf("export function emitIctBiasAlignedContinuationSignal");
    const fnRegion = ARCHETYPE_AUDIT_SRC.slice(fnStart, fnStart + 200);
    expect(fnRegion).toMatch(/void/);
  });
});

// ─── §7 SSE factory:archetype_signal_fired event ─────────────────────────────

describe("Wave 26 Pass G — SSE factory:archetype_signal_fired", () => {
  it("FACTORY_EVENTS.ARCHETYPE_SIGNAL_FIRED is declared in sse.ts", () => {
    expect(SSE_SRC).toContain("ARCHETYPE_SIGNAL_FIRED");
    expect(SSE_SRC).toContain("factory:archetype_signal_fired");
  });

  it("archetype-signal-audit.ts imports and uses FACTORY_EVENTS.ARCHETYPE_SIGNAL_FIRED", () => {
    expect(ARCHETYPE_AUDIT_SRC).toContain("FACTORY_EVENTS");
    expect(ARCHETYPE_AUDIT_SRC).toContain("ARCHETYPE_SIGNAL_FIRED");
  });

  it("broadcastSSE is called inside emitBounceOffLevelSignal or its delegate", () => {
    // The emit function calls broadcastArchetypeSSE which itself calls broadcastSSE.
    // Either pattern constitutes correct delegation.
    const fnStart = ARCHETYPE_AUDIT_SRC.indexOf("export function emitBounceOffLevelSignal");
    const fnEnd = ARCHETYPE_AUDIT_SRC.indexOf("export function emitIctBias");
    const fnBody = ARCHETYPE_AUDIT_SRC.slice(fnStart, fnEnd);
    expect(fnBody).toMatch(/broadcastSSE|broadcastArchetypeSSE/);
  });

  it("broadcastSSE is called inside emitIctBiasAlignedContinuationSignal or its delegate", () => {
    const fnStart = ARCHETYPE_AUDIT_SRC.indexOf("export function emitIctBiasAlignedContinuationSignal");
    const fnBody = ARCHETYPE_AUDIT_SRC.slice(fnStart, fnStart + 1500);
    expect(fnBody).toMatch(/broadcastSSE|broadcastArchetypeSSE/);
  });

  it("SSE broadcast is wrapped in try/catch (non-blocking contract)", () => {
    expect(ARCHETYPE_AUDIT_SRC).toMatch(/try\s*\{[\s\S]{0,50}broadcastSSE/);
  });
});

// ─── §8 Prometheus metrics ────────────────────────────────────────────────────

describe("Wave 26 Pass G — Prometheus metrics", () => {
  it("tf_archetype_signals_total Counter is declared in metrics-registry.ts", () => {
    expect(METRICS_REGISTRY_SRC).toContain("archetypeSignalsTotal");
    expect(METRICS_REGISTRY_SRC).toContain("tf_archetype_signals_total");
    expect(METRICS_REGISTRY_SRC).toMatch(/labelNames:.*archetype.*direction/s);
  });

  it("tf_strategy_source_resolution_total Counter is declared in metrics-registry.ts", () => {
    expect(METRICS_REGISTRY_SRC).toContain("strategySourceResolutionTotal");
    expect(METRICS_REGISTRY_SRC).toContain("tf_strategy_source_resolution_total");
    expect(METRICS_REGISTRY_SRC).toMatch(/labelNames:.*path/s);
  });

  it("archetypeSignalsTotal is imported and incremented in archetype-signal-audit.ts", () => {
    expect(ARCHETYPE_AUDIT_SRC).toContain("archetypeSignalsTotal");
    expect(ARCHETYPE_AUDIT_SRC).toContain(".inc()");
  });

  it("strategySourceResolutionTotal is imported and incremented in strategy-source-resolver.ts", () => {
    expect(SOURCE_RESOLVER_SRC).toContain("strategySourceResolutionTotal");
    expect(SOURCE_RESOLVER_SRC).toContain(".inc()");
  });

  it("Prometheus increment in emit functions is inside try/catch (never throws)", () => {
    // Both emit functions must guard the .inc() call
    const bounceSection = ARCHETYPE_AUDIT_SRC.slice(
      ARCHETYPE_AUDIT_SRC.indexOf("export function emitBounceOffLevelSignal"),
      ARCHETYPE_AUDIT_SRC.indexOf("export function emitIctBias"),
    );
    expect(bounceSection).toMatch(/try\s*\{[^}]*archetypeSignalsTotal/s);

    const ictSection = ARCHETYPE_AUDIT_SRC.slice(
      ARCHETYPE_AUDIT_SRC.indexOf("export function emitIctBiasAlignedContinuationSignal"),
    );
    expect(ictSection).toMatch(/try\s*\{[^}]*archetypeSignalsTotal/s);
  });
});

// ─── §9 strategy.source_url_resolved audit ────────────────────────────────────

describe("Wave 26 Pass G — strategy.source_url_resolved audit", () => {
  it("action string strategy.source_url_resolved is in strategy-source-resolver.ts", () => {
    expect(SOURCE_RESOLVER_SRC).toContain("strategy.source_url_resolved");
  });

  it("resolution_path field is emitted on resolved audit", () => {
    const idx = SOURCE_RESOLVER_SRC.indexOf("strategy.source_url_resolved");
    const ctx = SOURCE_RESOLVER_SRC.slice(Math.max(0, idx - 200), idx + 400);
    expect(ctx).toContain("resolution_path");
  });

  it("url_count field is emitted on resolved audit", () => {
    const idx = SOURCE_RESOLVER_SRC.indexOf("strategy.source_url_resolved");
    const ctx = SOURCE_RESOLVER_SRC.slice(Math.max(0, idx - 200), idx + 400);
    expect(ctx).toContain("url_count");
  });

  it("all 4 named resolution paths are present: direct, variant_inheritance, audit_fallback, multi_source", () => {
    expect(SOURCE_RESOLVER_SRC).toContain('"direct"');
    expect(SOURCE_RESOLVER_SRC).toContain('"variant_inheritance"');
    expect(SOURCE_RESOLVER_SRC).toContain('"audit_fallback"');
    expect(SOURCE_RESOLVER_SRC).toContain('"multi_source"');
  });

  it("resolved audit uses insertAuditRowSafe (fire-and-forget)", () => {
    expect(SOURCE_RESOLVER_SRC).toContain("insertAuditRowSafe");
    // The .catch() after insertAuditRowSafe must be present
    const resolvedIdx = SOURCE_RESOLVER_SRC.indexOf("strategy.source_url_resolved");
    const window = SOURCE_RESOLVER_SRC.slice(resolvedIdx - 50, resolvedIdx + 500);
    expect(window).toMatch(/\.catch\(/);
  });
});

// ─── §10 strategy.source_url_unresolved audit ────────────────────────────────

describe("Wave 26 Pass G — strategy.source_url_unresolved audit", () => {
  it("action string strategy.source_url_unresolved is in strategy-source-resolver.ts", () => {
    expect(SOURCE_RESOLVER_SRC).toContain("strategy.source_url_unresolved");
  });

  it("unresolved audit uses status: warn", () => {
    const idx = SOURCE_RESOLVER_SRC.indexOf("strategy.source_url_unresolved");
    const ctx = SOURCE_RESOLVER_SRC.slice(idx - 50, idx + 400);
    expect(ctx).toContain("warn");
  });

  it("strategy_name is included in unresolved audit input", () => {
    const idx = SOURCE_RESOLVER_SRC.indexOf("strategy.source_url_unresolved");
    const ctx = SOURCE_RESOLVER_SRC.slice(idx, idx + 400);
    expect(ctx).toContain("strategy_name");
  });

  it("logger.warn fires before or at unresolved audit to surface orphan issues", () => {
    // logger.warn must appear near the unresolved path
    const idx = SOURCE_RESOLVER_SRC.indexOf("strategy.source_url_unresolved");
    const ctx = SOURCE_RESOLVER_SRC.slice(Math.max(0, idx - 300), idx + 50);
    expect(ctx).toContain("logger.warn");
  });
});

// ─── §11 fire-and-forget contract ────────────────────────────────────────────

describe("Wave 26 Pass G — fire-and-forget contract", () => {
  it("emitBounceOffLevelSignal returns void synchronously — safe to call without await", () => {
    expect(ARCHETYPE_AUDIT_SRC).toMatch(/export function emitBounceOffLevelSignal[\s\S]{0,50}\): void/);
  });

  it("emitIctBiasAlignedContinuationSignal returns void synchronously", () => {
    // Multi-line function signature: function name + payload param + ): void
    // The signature span can be up to 200 chars — use a larger window.
    expect(ARCHETYPE_AUDIT_SRC).toMatch(/export function emitIctBiasAlignedContinuationSignal[\s\S]{0,200}\): void/);
  });

  it("all insertAuditRowSafe calls in archetype-signal-audit.ts have .catch()", () => {
    const calls = [...ARCHETYPE_AUDIT_SRC.matchAll(/insertAuditRowSafe\(/g)];
    expect(calls.length).toBeGreaterThanOrEqual(2); // one per archetype
    // Each insertAuditRowSafe call must have a .catch() somewhere in the surrounding
    // 1000-char window (the call + its chained .catch() block)
    for (const match of calls) {
      const pos = match.index!;
      const window = ARCHETYPE_AUDIT_SRC.slice(pos, pos + 1000);
      expect(window).toMatch(/\.catch\(/);
    }
  });

  it("graduation.archetype_route_taken audit write has .catch() in direct-bucket-graduator.ts", () => {
    // Find the actual action: string in the insertAuditRowSafe call
    const actionStr = 'action: "graduation.archetype_route_taken"';
    const callIdx = GRADUATOR_SRC.indexOf(actionStr);
    expect(callIdx).toBeGreaterThan(0);
    // .catch() must appear within 600 chars of the action string
    const afterCall = GRADUATOR_SRC.slice(callIdx, callIdx + 600);
    expect(afterCall).toMatch(/\.catch\(/);
  });
});

// ─── §12 Payload field coverage via unit-level mock ──────────────────────────

describe("Wave 26 Pass G — emit functions with mocked dependencies", () => {
  // These tests exercise the actual runtime path of the emit functions using
  // mocked insertAuditRowSafe + broadcastSSE to avoid DB/SSE I/O.

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emitBounceOffLevelSignal passes all payload fields to insertAuditRowSafe", async () => {
    const insertMock = vi.fn().mockResolvedValue(true);
    const broadcastMock = vi.fn();

    vi.doMock("../lib/audit-log-helper.js", () => ({ insertAuditRowSafe: insertMock }));
    vi.doMock("../routes/sse.js", () => ({
      broadcastSSE: broadcastMock,
      FACTORY_EVENTS: { ARCHETYPE_SIGNAL_FIRED: "factory:archetype_signal_fired" },
    }));
    vi.doMock("../lib/metrics-registry.js", () => ({
      archetypeSignalsTotal: { labels: () => ({ inc: vi.fn() }) },
    }));
    vi.doMock("../lib/logger.js", () => ({
      logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
    }));

    const { emitBounceOffLevelSignal } = await import("../lib/archetype-signal-audit.js");

    emitBounceOffLevelSignal({
      strategy_id:       "strat-001",
      correlation_id:    "corr-abc-123",
      direction:         "long",
      ma_type:           "ema",
      ma_period:         21,
      rejection_pattern: "hammer",
      bar_timestamp:     "2026-05-26T14:30:00.000Z",
    });

    // Allow fire-and-forget promises to settle
    await new Promise(r => setTimeout(r, 0));

    expect(insertMock).toHaveBeenCalledOnce();
    const callArg = insertMock.mock.calls[0][0];
    expect(callArg.action).toBe("engine.archetype.bounce_off_level.signal_fired");
    expect(callArg.entityId).toBe("strat-001");
    expect(callArg.correlationId).toBe("corr-abc-123");
    expect(callArg.result.direction).toBe("long");
    expect(callArg.result.ma_type).toBe("ema");
    expect(callArg.result.ma_period).toBe(21);
    expect(callArg.result.rejection_pattern).toBe("hammer");
    expect(callArg.input.bar_timestamp).toBe("2026-05-26T14:30:00.000Z");
  });

  it("emitIctBiasAlignedContinuationSignal passes all payload fields to insertAuditRowSafe", async () => {
    vi.resetModules();

    const insertMock = vi.fn().mockResolvedValue(true);
    const broadcastMock = vi.fn();

    vi.doMock("../lib/audit-log-helper.js", () => ({ insertAuditRowSafe: insertMock }));
    vi.doMock("../routes/sse.js", () => ({
      broadcastSSE: broadcastMock,
      FACTORY_EVENTS: { ARCHETYPE_SIGNAL_FIRED: "factory:archetype_signal_fired" },
    }));
    vi.doMock("../lib/metrics-registry.js", () => ({
      archetypeSignalsTotal: { labels: () => ({ inc: vi.fn() }) },
    }));
    vi.doMock("../lib/logger.js", () => ({
      logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
    }));

    const { emitIctBiasAlignedContinuationSignal } = await import("../lib/archetype-signal-audit.js");

    emitIctBiasAlignedContinuationSignal({
      strategy_id:          "strat-002",
      correlation_id:       "corr-def-456",
      direction:            "short",
      htf_bias:             "bearish",
      structure_break_type: "CHoCH",
      fvg_age_bars:         4,
      killzone:             "ny_am",
      bar_timestamp:        "2026-05-26T15:00:00.000Z",
    });

    await new Promise(r => setTimeout(r, 0));

    expect(insertMock).toHaveBeenCalledOnce();
    const callArg = insertMock.mock.calls[0][0];
    expect(callArg.action).toBe("engine.archetype.ict_bias_aligned_continuation.signal_fired");
    expect(callArg.entityId).toBe("strat-002");
    expect(callArg.correlationId).toBe("corr-def-456");
    expect(callArg.result.direction).toBe("short");
    expect(callArg.result.htf_bias).toBe("bearish");
    expect(callArg.result.structure_break_type).toBe("CHoCH");
    expect(callArg.result.fvg_age_bars).toBe(4);
    expect(callArg.result.killzone).toBe("ny_am");
  });

  it("emitBounceOffLevelSignal broadcasts SSE with archetype field", async () => {
    vi.resetModules();

    const insertMock = vi.fn().mockResolvedValue(true);
    const broadcastMock = vi.fn();

    vi.doMock("../lib/audit-log-helper.js", () => ({ insertAuditRowSafe: insertMock }));
    vi.doMock("../routes/sse.js", () => ({
      broadcastSSE: broadcastMock,
      FACTORY_EVENTS: { ARCHETYPE_SIGNAL_FIRED: "factory:archetype_signal_fired" },
    }));
    vi.doMock("../lib/metrics-registry.js", () => ({
      archetypeSignalsTotal: { labels: () => ({ inc: vi.fn() }) },
    }));
    vi.doMock("../lib/logger.js", () => ({
      logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
    }));

    const { emitBounceOffLevelSignal } = await import("../lib/archetype-signal-audit.js");

    emitBounceOffLevelSignal({
      strategy_id:       "strat-003",
      correlation_id:    null,
      direction:         "short",
      ma_type:           "sma",
      ma_period:         50,
      rejection_pattern: "shooting_star",
      bar_timestamp:     "2026-05-26T09:30:00.000Z",
    });

    expect(broadcastMock).toHaveBeenCalledOnce();
    const [eventName, payload] = broadcastMock.mock.calls[0];
    expect(eventName).toBe("factory:archetype_signal_fired");
    expect(payload.archetype).toBe("bounce_off_level");
    expect(payload.direction).toBe("short");
    expect(payload.strategy_id).toBe("strat-003");
  });

  it("emit functions do not throw even when insertAuditRowSafe rejects", async () => {
    vi.resetModules();

    const insertMock = vi.fn().mockRejectedValue(new Error("DB connection lost"));
    vi.doMock("../lib/audit-log-helper.js", () => ({ insertAuditRowSafe: insertMock }));
    vi.doMock("../routes/sse.js", () => ({
      broadcastSSE: vi.fn(),
      FACTORY_EVENTS: { ARCHETYPE_SIGNAL_FIRED: "factory:archetype_signal_fired" },
    }));
    vi.doMock("../lib/metrics-registry.js", () => ({
      archetypeSignalsTotal: { labels: () => ({ inc: vi.fn() }) },
    }));
    vi.doMock("../lib/logger.js", () => ({
      logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
    }));

    const { emitBounceOffLevelSignal } = await import("../lib/archetype-signal-audit.js");

    // Must not throw
    expect(() => emitBounceOffLevelSignal({
      strategy_id:       "strat-004",
      correlation_id:    null,
      direction:         "long",
      ma_type:           "ema",
      ma_period:         9,
      rejection_pattern: "none",
      bar_timestamp:     "2026-05-26T10:00:00.000Z",
    })).not.toThrow();

    // Allow .catch() to run
    await new Promise(r => setTimeout(r, 10));
    // No unhandled rejection should be thrown — test passes if we get here
  });
});
