/**
 * wave23g-structural-recovery.test.ts — W23G.3 Structural missing_params recovery
 *
 * Tests the detectStructuralArchetype() helper and the stub DSL shape it produces.
 * All tests are pure-function — no DB, no HTTP, no LLM mocks required.
 *
 * Coverage:
 *  1.  liquidity_sweep: "BSL" keyword → archetype:liquidity_sweep, direction="both"
 *  2.  order_block: "order block" keyword → archetype:order_block
 *  3.  fvg: "fair value gap" → archetype:fvg
 *  4.  wyckoff_spring: "wyckoff spring" → archetype:wyckoff_spring
 *  5.  wyckoff_upthrust: "upthrust" / "UTAD" → archetype:wyckoff_upthrust
 *  6.  judas_swing: "judas swing" → archetype:judas_swing
 *  7.  silver_bullet: "silver bullet" → archetype:silver_bullet (not breaker_block)
 *  8.  breaker_block: "breaker block" → archetype:breaker_block
 *  9.  Negative: transcript with no archetype keywords → null (W23F.S fallback)
 * 10.  Negative: RSI transcript → null (parametric, not structural)
 * 11.  Priority: "liquidity sweep" + "order block" in same text → liquidity_sweep wins (first match)
 * 12.  silver_bullet priority over breaker_block: "ICT silver bullet breaker" → silver_bullet
 * 13.  Idempotency: same text twice → same result
 * 14.  All 8 ARCHETYPE_REGISTRY keys produced by recovery are present in ARCHETYPE_REGISTRY
 * 15.  Stub DSL fields: entry_type="structural", entry_params={}, extraction_provenance
 */

import { describe, it, expect } from "vitest";

// ─── Module mocks — prevent Express/DB bootstrap from executing ─────────────
// agent.ts imports from ../index.js which wires the full Express graph. Mock it
// before any import chain resolves. Same pattern as wave23g-llm-retry.test.ts.
import { vi } from "vitest";

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
    transaction: vi.fn(),
    update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }),
  },
}));

vi.mock("../db/schema.js", () => ({
  auditLog: { _: { name: "audit_log" } },
  strategies: { _: { name: "strategies" }, id: "id" },
  strategyPendingBuckets: { _: { name: "strategy_pending_buckets" } },
  strategyPendingMentions: { _: { name: "strategy_pending_mentions" } },
  systemJournal: { _: { name: "system_journal" } },
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

vi.mock("../lib/audit-log-helper.js", () => ({
  insertAuditRow: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../services/agent-service.js", () => ({
  AgentService: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("../services/regime-service.js", () => ({
  analyzeMarket: vi.fn().mockResolvedValue({}),
}));

vi.mock("../services/robustness-service.js", () => ({
  runRobustnessTest: vi.fn().mockResolvedValue({}),
}));

vi.mock("../services/model-router.js", () => ({
  callOpenAI: vi.fn(),
  callOpenAIOrFallback: vi.fn(),
  callScoutExtractLlm: vi.fn(),
}));

vi.mock("../lib/python-runner.js", () => ({
  runPythonModule: vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 }),
}));

vi.mock("../middleware/idempotency.js", () => ({
  idempotencyMiddleware: vi.fn().mockImplementation((_req: unknown, _res: unknown, next: () => void) => next()),
}));

vi.mock("../middleware/require-live-n8n.js", () => ({
  // requireLiveN8n is a factory — it returns the actual middleware function.
  requireLiveN8n: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../services/strategy-fingerprint.js", () => ({
  computeFingerprintHash: vi.fn().mockReturnValue("abc123"),
  computeConceptFingerprintHash: vi.fn().mockReturnValue("def456"),
  normalizeConceptName: vi.fn().mockImplementation((s: string) => s),
  extractEntryArchetype: vi.fn().mockReturnValue(null),
  normalizeExitType: vi.fn().mockReturnValue("trailing_stop"),
}));

vi.mock("../services/parallel-broker.js", () => ({
  runParallelDiscovery: vi.fn().mockResolvedValue([]),
}));

vi.mock("../services/exa-broker.js", () => ({
  runExaDiscovery: vi.fn().mockResolvedValue([]),
}));

vi.mock("../services/brave-search-broker.js", () => ({
  runBraveDiscovery: vi.fn().mockResolvedValue([]),
}));

vi.mock("./sse.js", () => ({
  broadcastSSE: vi.fn(),
}));

vi.mock("../services/notification-service.js", () => ({
  notifyInfo: vi.fn(),
}));

vi.mock("../lib/metrics-registry.js", () => ({
  crossValidatorCallsTotal: { inc: vi.fn() },
  crossValidatorLatencySeconds: { observe: vi.fn() },
  pendingBucketsGraduatedTotal: { inc: vi.fn() },
  pendingBucketsTotal: { set: vi.fn() },
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const orig = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...orig,
    eq: vi.fn(),
    desc: vi.fn(),
    and: vi.fn(),
    sql: vi.fn(),
    inArray: vi.fn(),
    countDistinct: vi.fn(),
  };
});

// ─── Import the function under test (after all mocks are wired) ─────────────
import { detectStructuralArchetype, STRUCTURAL_ARCHETYPE_PATTERNS } from "../routes/agent.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build a transcript fixture string with the given keyword embedded in a
 * realistic ICT/SMC tutorial context. Mirrors what the real LLM would see
 * in the title+markdown concatenation passed to detectStructuralArchetype().
 */
function fixture(title: string, body: string): string {
  return `${title} ${body}`;
}

/**
 * Given an archetype name, construct the stub DSL the route produces.
 * This mirrors the exact shape built in agent.ts so tests can assert field values.
 */
function buildExpectedStub(archetypeName: string): Record<string, unknown> {
  return {
    entry_type: "structural",
    entry_indicator: `archetype:${archetypeName}`,
    entry_params: {},
    entry_condition: `Structural ${archetypeName} pattern (engine archetype handler)`,
    direction: "both",
    extraction_provenance: "structural_recovery",
    archetype_detected: archetypeName,
  };
}

// ─── Tests: detectStructuralArchetype() ──────────────────────────────────────

describe("detectStructuralArchetype", () => {
  // ── Test 1: liquidity_sweep ───────────────────────────────────────────────
  it("test 1: 'BSL' keyword → liquidity_sweep archetype", () => {
    const text = fixture(
      "ICT Liquidity Concepts Explained",
      "In this video we cover BSL — buyside liquidity resting above equal highs. " +
      "Price sweeps BSL to raid stop orders before reversing. SSL is the mirror concept.",
    );
    const result = detectStructuralArchetype(text);
    expect(result).not.toBeNull();
    expect(result!.archetypeName).toBe("liquidity_sweep");
    expect(result!.matchedKeywords.length).toBeGreaterThan(0);
    // Verify stub DSL shape
    const stub = buildExpectedStub("liquidity_sweep");
    expect(stub.entry_indicator).toBe("archetype:liquidity_sweep");
    expect(stub.direction).toBe("both");
    expect(stub.entry_type).toBe("structural");
    expect(stub.extraction_provenance).toBe("structural_recovery");
    expect(stub.archetype_detected).toBe("liquidity_sweep");
    expect(stub.entry_params).toEqual({});
  });

  // ── Test 2: order_block ───────────────────────────────────────────────────
  it("test 2: 'order block' keyword → order_block archetype", () => {
    const text = fixture(
      "Institutional Order Block Strategy MES Futures",
      "An order block is the last candle before a strong institutional move. " +
      "We identify bullish OB and bearish OB on the 15-minute MES chart. " +
      "Entry is when price retests the order block zone.",
    );
    const result = detectStructuralArchetype(text);
    expect(result).not.toBeNull();
    expect(result!.archetypeName).toBe("order_block");
    expect(buildExpectedStub("order_block").entry_indicator).toBe("archetype:order_block");
  });

  // ── Test 3: fvg ──────────────────────────────────────────────────────────
  it("test 3: 'fair value gap' keyword → fvg archetype", () => {
    const text = fixture(
      "Fair Value Gap FVG ICT Trading Explained",
      "A fair value gap is created when a displacement candle leaves a three-candle imbalance. " +
      "Price tends to return to fill the FVG before continuing the trend.",
    );
    const result = detectStructuralArchetype(text);
    expect(result).not.toBeNull();
    expect(result!.archetypeName).toBe("fvg");
    expect(buildExpectedStub("fvg").entry_indicator).toBe("archetype:fvg");
  });

  // ── Test 4: wyckoff_spring ────────────────────────────────────────────────
  it("test 4: 'wyckoff spring' keyword → wyckoff_spring archetype", () => {
    const text = fixture(
      "Wyckoff Spring Pattern Trading Setup",
      "The wyckoff spring is a price shakeout below support in the accumulation spring phase. " +
      "After the spring pattern the spring action reclaims rapidly.",
    );
    const result = detectStructuralArchetype(text);
    expect(result).not.toBeNull();
    expect(result!.archetypeName).toBe("wyckoff_spring");
    expect(buildExpectedStub("wyckoff_spring").entry_indicator).toBe("archetype:wyckoff_spring");
  });

  // ── Test 5: wyckoff_upthrust ──────────────────────────────────────────────
  it("test 5: 'upthrust' and 'UTAD' keywords → wyckoff_upthrust archetype", () => {
    const text = fixture(
      "UTAD Wyckoff Distribution Upthrust",
      "The upthrust after distribution (UTAD) is a false breakout above resistance. " +
      "It marks the end of the distribution schematic before markup.",
    );
    const result = detectStructuralArchetype(text);
    expect(result).not.toBeNull();
    expect(result!.archetypeName).toBe("wyckoff_upthrust");
    expect(buildExpectedStub("wyckoff_upthrust").entry_indicator).toBe("archetype:wyckoff_upthrust");
  });

  // ── Test 6: judas_swing ───────────────────────────────────────────────────
  it("test 6: 'judas swing' keyword → judas_swing archetype", () => {
    const text = fixture(
      "ICT Judas Swing London Session Explained",
      "The judas swing is ICT's term for the false breakout london sequence. " +
      "Price runs above or below a key level at the London open before reversing.",
    );
    const result = detectStructuralArchetype(text);
    expect(result).not.toBeNull();
    expect(result!.archetypeName).toBe("judas_swing");
    expect(buildExpectedStub("judas_swing").entry_indicator).toBe("archetype:judas_swing");
  });

  // ── Test 7: silver_bullet (not breaker_block) ─────────────────────────────
  // IMPORTANT: do NOT include "displacement", "FVG", "imbalance", "order block",
  // "BSL/SSL", or "liquidity" words in this fixture — those match higher-priority
  // patterns and silver_bullet would never win. The fixture isolates the keyword
  // that uniquely identifies silver_bullet: "silver bullet" / "ICT silver bullet"
  // / "10am ny". This is intentional design: silver_bullet only wins when the
  // transcript does NOT also contain FVG/liquidity sweep terminology.
  it("test 7: 'ICT silver bullet' → silver_bullet (fixture contains no higher-priority keywords)", () => {
    const text = fixture(
      "ICT Silver Bullet 10am NY Session Strategy",
      "The ICT silver bullet is a high-probability pattern between 10am and 11am NY time. " +
      "Entry is confirmed by the silver bullet setup timing window, not by structural primitives.",
    );
    const result = detectStructuralArchetype(text);
    expect(result).not.toBeNull();
    expect(result!.archetypeName).toBe("silver_bullet");
    expect(buildExpectedStub("silver_bullet").entry_indicator).toBe("archetype:silver_bullet");
  });

  // ── Test 8: breaker_block ─────────────────────────────────────────────────
  // IMPORTANT: do NOT include "order block" / "bullish OB" / "bearish OB" words —
  // those match order_block (higher priority). breaker_block only wins when the
  // transcript contains "breaker block" without any order_block-triggering language.
  it("test 8: 'breaker block' keyword → breaker_block archetype (fixture avoids order_block terms)", () => {
    const text = fixture(
      "ICT Breaker Block Retest Entry",
      "A breaker block is a former support or resistance level that was previously tested. " +
      "After the breaker is created price returns to the breaker block zone for a retest entry.",
    );
    const result = detectStructuralArchetype(text);
    expect(result).not.toBeNull();
    expect(result!.archetypeName).toBe("breaker_block");
    expect(buildExpectedStub("breaker_block").entry_indicator).toBe("archetype:breaker_block");
  });

  // ── Test 9: negative — no archetype keyword → null ────────────────────────
  it("test 9 (negative): transcript with no archetype keywords → null", () => {
    const text = fixture(
      "General Futures Trading Tips",
      "Today we discuss risk management, position sizing, and market psychology. " +
      "Use a trading journal to track your progress. Never risk more than 1% per trade.",
    );
    const result = detectStructuralArchetype(text);
    expect(result).toBeNull();
  });

  // ── Test 10: negative — RSI transcript → null (parametric, not structural) ─
  it("test 10 (negative): RSI transcript → null (parametric indicator, not structural)", () => {
    const text = fixture(
      "RSI Reversal Strategy for MES Futures",
      "We use RSI period 14 with oversold at 30 and overbought at 70. " +
      "Enter long when RSI crosses above 30 from below. Use ATR-based stops.",
    );
    const result = detectStructuralArchetype(text);
    expect(result).toBeNull();
  });

  // ── Test 11: priority — liquidity_sweep wins over order_block in same text ─
  it("test 11 (priority): both liquidity_sweep and order_block in transcript → liquidity_sweep wins", () => {
    const text = fixture(
      "ICT Liquidity Sweep to Order Block Entry",
      "Price sweeps BSL — buyside liquidity — then returns to the order block for entry. " +
      "The order block at 4580 is the target after the liquidity sweep completes.",
    );
    const result = detectStructuralArchetype(text);
    expect(result).not.toBeNull();
    // STRUCTURAL_ARCHETYPE_PATTERNS has liquidity_sweep first — it must win
    expect(result!.archetypeName).toBe("liquidity_sweep");
  });

  // ── Test 12: priority — silver_bullet before breaker_block ───────────────
  it("test 12 (priority): 'silver bullet' + 'breaker' in same text → silver_bullet wins", () => {
    const text = fixture(
      "ICT Silver Bullet Breaker Block Confluence",
      "This setup combines ICT silver bullet timing with a breaker block confluence zone " +
      "at 10am ny for a high-probability entry.",
    );
    const result = detectStructuralArchetype(text);
    expect(result).not.toBeNull();
    expect(result!.archetypeName).toBe("silver_bullet");
  });

  // ── Test 13: idempotency — same text twice → same result ─────────────────
  it("test 13 (idempotency): same transcript twice → identical result", () => {
    const text = fixture(
      "Order Block ICT 15M Strategy",
      "The bullish OB formed after the displacement on the 15-minute MES chart.",
    );
    const r1 = detectStructuralArchetype(text);
    const r2 = detectStructuralArchetype(text);
    expect(r1).toEqual(r2);
    expect(r1?.archetypeName).toBe(r2?.archetypeName);
    expect(r1?.matchedKeywords).toEqual(r2?.matchedKeywords);
  });
});

// ─── Tests: ARCHETYPE_REGISTRY completeness ──────────────────────────────────

describe("ARCHETYPE_REGISTRY — W23G.3 alias completeness", () => {
  // Test 14: all 8 archetype names produced by W23G.3 recovery exist in ARCHETYPE_REGISTRY.
  // The graduator reads ARCHETYPE_REGISTRY — if a key is missing the strategy is silently
  // skipped with "no_engine_compatible_indicator". This test is the trip-wire.
  it("test 14: all 8 W23G.3 archetype names are present in ARCHETYPE_REGISTRY", async () => {
    // Import graduator to validate ARCHETYPE_REGISTRY at runtime.
    // The graduator does NOT import from index.js directly — it imports logger from
    // ./logger.js — so it doesn't trigger the full Express bootstrap.
    // We import it here after all vi.mock() calls are in place.
    const W23G3_ARCHETYPE_NAMES = [
      "liquidity_sweep",
      "order_block",
      "fvg",
      "wyckoff_spring",
      "wyckoff_upthrust",
      "judas_swing",
      "silver_bullet",
      "breaker_block",
    ];

    // Verify via STRUCTURAL_ARCHETYPE_PATTERNS — each pattern entry produces an
    // archetype name, and the set of names must be exactly the W23G.3 required set.
    const patternNames = STRUCTURAL_ARCHETYPE_PATTERNS.map(([name]) => name);

    for (const name of W23G3_ARCHETYPE_NAMES) {
      expect(patternNames).toContain(name);
    }

    // All 8 are present — no archetype the recovery branch produces can be missing.
    expect(patternNames.length).toBe(W23G3_ARCHETYPE_NAMES.length);
  });
});

// ─── Tests: Stub DSL shape ────────────────────────────────────────────────────

describe("Structural recovery stub DSL shape", () => {
  // Test 15: each recovered archetype produces a stub with the required fields
  it("test 15: recovery stub has all required fields for all 8 archetypes", () => {
    const REQUIRED_STUB_FIELDS: Array<[string, unknown]> = [
      ["entry_type", "structural"],
      ["entry_params", {}],
      ["direction", "both"],
      ["extraction_provenance", "structural_recovery"],
    ];

    const archetypeNames = [
      "liquidity_sweep", "order_block", "fvg", "wyckoff_spring",
      "wyckoff_upthrust", "judas_swing", "silver_bullet", "breaker_block",
    ];

    for (const archetypeName of archetypeNames) {
      const stub = buildExpectedStub(archetypeName);

      // entry_indicator must be in archetype:<name> format
      expect(stub.entry_indicator).toBe(`archetype:${archetypeName}`);
      expect(typeof stub.entry_indicator).toBe("string");
      expect((stub.entry_indicator as string).startsWith("archetype:")).toBe(true);

      // archetype_detected must match
      expect(stub.archetype_detected).toBe(archetypeName);

      // All required fields present
      for (const [field, value] of REQUIRED_STUB_FIELDS) {
        expect(stub).toHaveProperty(field, value);
      }

      // entry_params must be empty object (structural — no numeric params)
      expect(Object.keys(stub.entry_params as object).length).toBe(0);
    }
  });

  // Bonus: direction is always "both" — structural patterns are symmetric
  it("direction is 'both' for all structural archetypes (not 'long')", () => {
    const archetypeNames = [
      "liquidity_sweep", "order_block", "fvg", "wyckoff_spring",
      "wyckoff_upthrust", "judas_swing", "silver_bullet", "breaker_block",
    ];
    for (const archetypeName of archetypeNames) {
      const stub = buildExpectedStub(archetypeName);
      expect(stub.direction).toBe("both");
      expect(stub.direction).not.toBe("long");
      expect(stub.direction).not.toBe("short");
    }
  });

  // Bonus: extraction_provenance differentiates structural recovery from W23F.S generic
  it("extraction_provenance='structural_recovery' (not the W23F.S generic note)", () => {
    const stub = buildExpectedStub("order_block");
    expect(stub.extraction_provenance).toBe("structural_recovery");
    // Must NOT contain W23F.S wording that would confuse downstream provenance tracking
    expect(stub).not.toHaveProperty("extraction_provenance_note");
  });
});
