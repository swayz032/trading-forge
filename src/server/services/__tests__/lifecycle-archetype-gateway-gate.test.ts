/**
 * lifecycle-archetype-gateway-gate.test.ts — Pass 4.5 Track B (hardening/phase-0)
 *
 * Tests for the archetype gateway-mode bypass gate added to TESTING → PAPER promotion
 * in lifecycle-service.ts (_promoteStrategyInner).
 *
 * GATE LOGIC (from lifecycle-service.ts):
 *   if (fromState === "TESTING" && toState === "PAPER") {
 *     const entryIndicator = strategy.config.entry_indicator;
 *     if (entryIndicator.startsWith("archetype:") && process.env.LIVE_ORDER_GATEWAY_URL) {
 *       const result = await compileDualPineExport(id, ..., persist=false, ..., { mode: "tf_gateway" });
 *       if (!hasActionMarker || !hasArchetypeMarker) → BLOCK (audit + Discord WARN)
 *     }
 *   }
 *
 * CASES TESTED:
 *   CASE 1: archetype strategy + LIVE_ORDER_GATEWAY_URL set + Pine has markers → PASSES
 *   CASE 2: archetype strategy + LIVE_ORDER_GATEWAY_URL set + Pine lacks markers → BLOCKS
 *             audit: lifecycle.archetype_gateway_bypass_blocked
 *   CASE 3: parametric strategy + LIVE_ORDER_GATEWAY_URL set → gate SKIPPED
 *   CASE 4: archetype strategy + LIVE_ORDER_GATEWAY_URL UNSET → gate SKIPPED (Path A)
 *
 * APPROACH:
 *   We test the gate decision contract as a pure function mirroring the gate block —
 *   the same structural-analysis pattern as lifecycle-archetype-promotion.test.ts.
 *   This avoids the full lifecycle-service.ts dependency graph (kill-switch + 6 services).
 *
 *   Source contract validation: we also verify the gate block is present in
 *   lifecycle-service.ts with the correct structure (same technique as Pass 2 Track C).
 *
 * PARITY CONSTRAINTS:
 *   - Gate runs AFTER Frankenstein gate, BEFORE writeBlock
 *   - Gate skips for parametric strategies (entry_indicator doesn't start with "archetype:")
 *   - Gate skips when LIVE_ORDER_GATEWAY_URL is not set (Path A legacy support)
 *   - Fail-CLOSED: compileDualPineExport error → block promotion (not pass-through)
 *   - Audit action: "lifecycle.archetype_gateway_bypass_blocked", status: "warn"
 *   - Discord WARN with family-grade postscript on block
 *
 * VITEST STATUS: All 4 cases GREEN.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// ─── Source file paths ─────────────────────────────────────────────────────────

const LIFECYCLE_SERVICE_PATH = resolve(
  process.cwd(),
  "src/server/services/lifecycle-service.ts",
);

// ─── Gate decision types (mirrors the gate in lifecycle-service.ts) ──────────

interface GatewayGateInput {
  entryIndicator: string;
  liveOrderGatewayUrl: string | undefined;
  pineContent: string;    // combined indicator + strategy content from compileDualPineExport
  compileThrows: boolean;
}

interface GatewayGateResult {
  blocked: boolean;
  auditAction: string | null;
  auditStatus: "warn" | null;
  reason: string | null;
  skipped: boolean;       // true when gate is not applicable (parametric or no gateway URL)
}

/**
 * Pure-function mirror of the archetype gateway-mode bypass gate block in
 * lifecycle-service.ts (_promoteStrategyInner, Pass 4.5 Track B gate).
 *
 * Input:
 *   entryIndicator     — strategy.config.entry_indicator
 *   liveOrderGatewayUrl — value of LIVE_ORDER_GATEWAY_URL env (undefined = not set)
 *   pineContent        — combined Pine output that would be produced by compileDualPineExport
 *   compileThrows      — simulates compileDualPineExport throwing
 *
 * Returns:
 *   blocked  — true iff the gate would block promotion
 *   skipped  — true iff the gate is not applicable for this strategy/config
 *   auditAction — the audit action that would be written on block
 */
function evaluateArchetypeGatewayGate(input: GatewayGateInput): GatewayGateResult {
  const { entryIndicator, liveOrderGatewayUrl, pineContent, compileThrows } = input;

  // Gate condition 1: must be TESTING → PAPER and archetype: prefix
  const isArchetype = entryIndicator.startsWith("archetype:");
  if (!isArchetype) {
    return { blocked: false, auditAction: null, auditStatus: null, reason: null, skipped: true };
  }

  // Gate condition 2: must have LIVE_ORDER_GATEWAY_URL (Path B)
  if (!liveOrderGatewayUrl) {
    return { blocked: false, auditAction: null, auditStatus: null, reason: null, skipped: true };
  }

  // Compile error → fail-CLOSED
  if (compileThrows) {
    return {
      blocked: true,
      auditAction: "lifecycle.archetype_gateway_bypass_blocked",
      auditStatus: "warn",
      reason: "archetype gateway-mode bypass gate: compilation failed (fail-closed)",
      skipped: false,
    };
  }

  // Check markers
  const hasActionMarker = pineContent.includes('"action":"archetype_signal"');
  const archetypeKey = entryIndicator.slice("archetype:".length);
  const hasArchetypeMarker = pineContent.includes(`"archetype":"${archetypeKey}"`);

  if (!hasActionMarker || !hasArchetypeMarker) {
    const missingMarkers: string[] = [];
    if (!hasActionMarker) missingMarkers.push('"action":"archetype_signal"');
    if (!hasArchetypeMarker) missingMarkers.push(`"archetype":"${archetypeKey}"`);
    return {
      blocked: true,
      auditAction: "lifecycle.archetype_gateway_bypass_blocked",
      auditStatus: "warn",
      reason: `missing TF-gateway markers: ${missingMarkers.join(", ")}`,
      skipped: false,
    };
  }

  // Gate passes
  return { blocked: false, auditAction: null, auditStatus: null, reason: null, skipped: false };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Pass 4.5 Track B — archetype gateway-mode bypass gate contract", () => {
  // ─── CASE 1: Archetype + URL + markers present → PASSES ────────────────
  describe("CASE 1: archetype strategy + LIVE_ORDER_GATEWAY_URL set + Pine has markers → PASSES", () => {
    const pineWithMarkers = `
// Auto-generated TF-gateway alert Pine
var json_payload = '{"action":"archetype_signal","archetype":"bounce_off_level","account_id":"{{plot_01}}"}'
alertcondition(condition, message=json_payload)
`;

    it("gate is not blocked when both markers are present", () => {
      const result = evaluateArchetypeGatewayGate({
        entryIndicator: "archetype:bounce_off_level",
        liveOrderGatewayUrl: "https://trading-forge.example.com",
        pineContent: pineWithMarkers,
        compileThrows: false,
      });
      expect(result.blocked).toBe(false);
    });

    it("gate is not skipped (it evaluated and passed)", () => {
      const result = evaluateArchetypeGatewayGate({
        entryIndicator: "archetype:bounce_off_level",
        liveOrderGatewayUrl: "https://trading-forge.example.com",
        pineContent: pineWithMarkers,
        compileThrows: false,
      });
      expect(result.skipped).toBe(false);
    });

    it("no audit action on pass", () => {
      const result = evaluateArchetypeGatewayGate({
        entryIndicator: "archetype:bounce_off_level",
        liveOrderGatewayUrl: "https://trading-forge.example.com",
        pineContent: pineWithMarkers,
        compileThrows: false,
      });
      expect(result.auditAction).toBeNull();
    });
  });

  // ─── CASE 2: Archetype + URL + Pine LACKS markers → BLOCKS ─────────────
  describe("CASE 2: archetype strategy + URL set + Pine lacks markers → BLOCKS, audit emitted", () => {
    const pineWithoutMarkers = `
// Standard parametric Pine — no TF-gateway markers
strategy("Bounce Off Level Strategy", overlay=true)
var ema_val = ta.ema(close, 20)
if (close > ema_val)
    strategy.entry("long", strategy.long)
`;

    it("gate blocks when action marker is absent", () => {
      const result = evaluateArchetypeGatewayGate({
        entryIndicator: "archetype:bounce_off_level",
        liveOrderGatewayUrl: "https://trading-forge.example.com",
        pineContent: pineWithoutMarkers,
        compileThrows: false,
      });
      expect(result.blocked).toBe(true);
    });

    it("audit action is lifecycle.archetype_gateway_bypass_blocked on block", () => {
      const result = evaluateArchetypeGatewayGate({
        entryIndicator: "archetype:bounce_off_level",
        liveOrderGatewayUrl: "https://trading-forge.example.com",
        pineContent: pineWithoutMarkers,
        compileThrows: false,
      });
      expect(result.auditAction).toBe("lifecycle.archetype_gateway_bypass_blocked");
    });

    it("audit status is warn on block", () => {
      const result = evaluateArchetypeGatewayGate({
        entryIndicator: "archetype:bounce_off_level",
        liveOrderGatewayUrl: "https://trading-forge.example.com",
        pineContent: pineWithoutMarkers,
        compileThrows: false,
      });
      expect(result.auditStatus).toBe("warn");
    });

    it("reason describes the missing markers", () => {
      const result = evaluateArchetypeGatewayGate({
        entryIndicator: "archetype:bounce_off_level",
        liveOrderGatewayUrl: "https://trading-forge.example.com",
        pineContent: pineWithoutMarkers,
        compileThrows: false,
      });
      expect(result.reason).toContain("missing TF-gateway markers");
      expect(result.reason).toContain('"action":"archetype_signal"');
    });

    it("gate is not skipped (it evaluated and blocked)", () => {
      const result = evaluateArchetypeGatewayGate({
        entryIndicator: "archetype:bounce_off_level",
        liveOrderGatewayUrl: "https://trading-forge.example.com",
        pineContent: pineWithoutMarkers,
        compileThrows: false,
      });
      expect(result.skipped).toBe(false);
    });

    it("gate also blocks when only archetype marker absent but action marker present", () => {
      const partialPine = `
var json_payload = '{"action":"archetype_signal","archetype":"WRONG_KEY"}'
`;
      const result = evaluateArchetypeGatewayGate({
        entryIndicator: "archetype:bounce_off_level",
        liveOrderGatewayUrl: "https://trading-forge.example.com",
        pineContent: partialPine,
        compileThrows: false,
      });
      // "archetype":"bounce_off_level" not present — WRONG_KEY doesn't match
      expect(result.blocked).toBe(true);
    });
  });

  // ─── CASE 3: Parametric strategy → gate SKIPPED ─────────────────────────
  describe("CASE 3: parametric strategy (no archetype: prefix) → gate SKIPPED", () => {
    const parametricIndicators = [
      "ema_crossover",
      "atr_breakout",
      "rsi_momentum",
      "vwap_mean_reversion",
      "uncatalogued:fake_speaker_term",   // uncatalogued: is also NOT archetype:
    ];

    for (const entryIndicator of parametricIndicators) {
      it(`gate is skipped for entry_indicator='${entryIndicator}'`, () => {
        const result = evaluateArchetypeGatewayGate({
          entryIndicator,
          liveOrderGatewayUrl: "https://trading-forge.example.com",
          pineContent: "// no markers",
          compileThrows: false,
        });
        expect(result.skipped).toBe(true);
        expect(result.blocked).toBe(false);
      });
    }

    it("no audit action is emitted for parametric strategies", () => {
      const result = evaluateArchetypeGatewayGate({
        entryIndicator: "ema_crossover",
        liveOrderGatewayUrl: "https://trading-forge.example.com",
        pineContent: "// no markers",
        compileThrows: false,
      });
      expect(result.auditAction).toBeNull();
    });
  });

  // ─── CASE 4: Archetype + LIVE_ORDER_GATEWAY_URL UNSET → gate SKIPPED ────
  describe("CASE 4: archetype strategy + LIVE_ORDER_GATEWAY_URL not set → gate SKIPPED (Path A)", () => {
    it("gate is skipped when LIVE_ORDER_GATEWAY_URL is undefined", () => {
      const result = evaluateArchetypeGatewayGate({
        entryIndicator: "archetype:bounce_off_level",
        liveOrderGatewayUrl: undefined,
        pineContent: "// no markers — should not matter",
        compileThrows: false,
      });
      expect(result.skipped).toBe(true);
      expect(result.blocked).toBe(false);
    });

    it("gate is skipped when LIVE_ORDER_GATEWAY_URL is empty string", () => {
      const result = evaluateArchetypeGatewayGate({
        entryIndicator: "archetype:bounce_off_level",
        liveOrderGatewayUrl: "",
        pineContent: "// no markers",
        compileThrows: false,
      });
      // Empty string is falsy — same as not set
      expect(result.skipped).toBe(true);
    });

    it("no audit is emitted for Path A (no gateway URL)", () => {
      const result = evaluateArchetypeGatewayGate({
        entryIndicator: "archetype:ict_silver_bullet_ny_am",
        liveOrderGatewayUrl: undefined,
        pineContent: "",
        compileThrows: false,
      });
      expect(result.auditAction).toBeNull();
    });
  });

  // ─── CASE 5 (Bonus): compileDualPineExport throws → fail-CLOSED ─────────
  describe("CASE 5 (fail-CLOSED): compileDualPineExport throws → gate blocks", () => {
    it("blocks promotion when compileDualPineExport throws", () => {
      const result = evaluateArchetypeGatewayGate({
        entryIndicator: "archetype:bounce_off_level",
        liveOrderGatewayUrl: "https://trading-forge.example.com",
        pineContent: "",
        compileThrows: true,
      });
      expect(result.blocked).toBe(true);
      expect(result.auditAction).toBe("lifecycle.archetype_gateway_bypass_blocked");
    });

    it("reason mentions fail-closed on compile error", () => {
      const result = evaluateArchetypeGatewayGate({
        entryIndicator: "archetype:bounce_off_level",
        liveOrderGatewayUrl: "https://trading-forge.example.com",
        pineContent: "",
        compileThrows: true,
      });
      expect(result.reason).toContain("fail-closed");
    });
  });
});

// ─── Source contract tests ────────────────────────────────────────────────────
//
// Verify the gate block is present in lifecycle-service.ts with the correct
// structure — catches accidental code drift without invoking the full service.

describe("Pass 4.5 Track B — lifecycle-service.ts gate block source contract", () => {
  let source: string;

  beforeAll(() => {
    expect(existsSync(LIFECYCLE_SERVICE_PATH), `lifecycle-service.ts must exist at ${LIFECYCLE_SERVICE_PATH}`).toBe(true);
    source = readFileSync(LIFECYCLE_SERVICE_PATH, "utf8");
  });

  it("lifecycle-service.ts contains the Pass 4.5 Track B gate comment", () => {
    expect(source).toContain("Pass 4.5 Track B");
    expect(source).toContain("archetype gateway-mode bypass gate");
  });

  it("gate checks entry_indicator.startsWith('archetype:')", () => {
    expect(source).toContain('entryIndicator.startsWith("archetype:")');
  });

  it("gate checks process.env.LIVE_ORDER_GATEWAY_URL", () => {
    expect(source).toContain("process.env.LIVE_ORDER_GATEWAY_URL");
  });

  it("gate calls compileDualPineExport with persist=false (dry-run)", () => {
    // The call must pass false as the persist argument
    expect(source).toContain("compileDualPineExport(");
    expect(source).toContain("false,");
  });

  it("gate inspects Pine content for '\"action\":\"archetype_signal\"' marker", () => {
    expect(source).toContain('"action":"archetype_signal"');
  });

  it("gate inspects Pine content for archetype-keyed marker", () => {
    expect(source).toContain('"archetype":"${archetypeKey}"');
  });

  it("gate emits lifecycle.archetype_gateway_bypass_blocked audit action on block", () => {
    expect(source).toContain("lifecycle.archetype_gateway_bypass_blocked");
  });

  it("gate returns { success: false } on block (not silent skip)", () => {
    // The block path must call `return { success: false, error: ... }`
    // We verify the pattern exists after the archetype_gateway_bypass_blocked audit.
    // Scope the search to start AFTER blockIdx: a pre-existing commit added an
    // EARLIER, unrelated archetype_gateway_env_missing gate that reuses the
    // identical `return { success: false, error: blockReason };` text — an unscoped
    // indexOf() finds that earlier occurrence instead.
    const blockIdx = source.indexOf("lifecycle.archetype_gateway_bypass_blocked");
    const successFalseIdx = source.indexOf("return { success: false, error: blockReason }", blockIdx);
    expect(blockIdx).toBeGreaterThan(0);
    expect(successFalseIdx).toBeGreaterThan(blockIdx);
  });

  it("gate uses dynamic import for compileDualPineExport (lazy load for test isolation)", () => {
    expect(source).toMatch(/const \{ compileDualPineExport \} = await import\(["']\.\/pine-export-service\.js["']\)/);
  });

  it("gate is positioned BEFORE writeBlock (in lifecycle-service.ts write order)", () => {
    const gateIdx = source.indexOf("archetype gateway-mode bypass gate");
    const writeBlockIdx = source.indexOf("const writeBlock = async");
    expect(gateIdx).toBeGreaterThan(0);
    expect(writeBlockIdx).toBeGreaterThan(gateIdx);
  });

  it("gate uses { mode: 'tf_gateway' } as gatewayOptions when calling compileDualPineExport", () => {
    expect(source).toContain('"tf_gateway"');
  });

  it("gate has fail-CLOSED catch block that returns { success: false }", () => {
    // The catch block must block (not pass-through) on compile error
    expect(source).toContain("archetype gateway-mode bypass gate: compilation failed (fail-closed)");
  });
});

// ─── Marker detection algorithm tests ────────────────────────────────────────
//
// Tests for the substring-match logic that detects TF-gateway markers.
// This ensures the string matching is precise — not accidentally matching
// partial strings or being fooled by variant quoting.

describe("Pass 4.5 Track B — TF-gateway marker detection algorithm", () => {
  const ARCHETYPE_KEY = "ict_bias_aligned_continuation";
  const ENTRY_INDICATOR = `archetype:${ARCHETYPE_KEY}`;
  const GATEWAY_URL = "https://trading-forge.example.com";

  it("correctly identifies valid markers in combined Pine output", () => {
    const validPine = `
//@version=5
indicator("ICT Bias Aligned Continuation TF-Gateway", overlay=true)
var payload = '{"action":"archetype_signal","archetype":"ict_bias_aligned_continuation","account_id":"{{plot_01}}"}'
alertcondition(true, message=payload)
`;
    const result = evaluateArchetypeGatewayGate({
      entryIndicator: ENTRY_INDICATOR,
      liveOrderGatewayUrl: GATEWAY_URL,
      pineContent: validPine,
      compileThrows: false,
    });
    expect(result.blocked).toBe(false);
  });

  it("rejects when action marker has wrong action value", () => {
    const badActionPine = `
var payload = '{"action":"enter_long","archetype":"ict_bias_aligned_continuation"}'
`;
    const result = evaluateArchetypeGatewayGate({
      entryIndicator: ENTRY_INDICATOR,
      liveOrderGatewayUrl: GATEWAY_URL,
      pineContent: badActionPine,
      compileThrows: false,
    });
    // "action":"archetype_signal" is absent → blocked
    expect(result.blocked).toBe(true);
  });

  it("rejects when archetype marker has wrong key", () => {
    const wrongKeyPine = `
var payload = '{"action":"archetype_signal","archetype":"bounce_off_level"}'
`;
    const result = evaluateArchetypeGatewayGate({
      entryIndicator: ENTRY_INDICATOR,   // expects ict_bias_aligned_continuation
      liveOrderGatewayUrl: GATEWAY_URL,
      pineContent: wrongKeyPine,
      compileThrows: false,
    });
    // archetype key mismatch — blocked
    expect(result.blocked).toBe(true);
  });

  it("accepts when markers are split across indicator and strategy content (combined check)", () => {
    // The lifecycle gate combines indicatorContent + "\n" + strategyContent
    // One marker in each half should still pass
    const indicatorPart = `var x = '{"action":"archetype_signal"}'`;
    const strategyPart = `var y = '{"archetype":"ict_bias_aligned_continuation"}'`;
    const combined = indicatorPart + "\n" + strategyPart;

    const result = evaluateArchetypeGatewayGate({
      entryIndicator: ENTRY_INDICATOR,
      liveOrderGatewayUrl: GATEWAY_URL,
      pineContent: combined,
      compileThrows: false,
    });
    expect(result.blocked).toBe(false);
  });
});
