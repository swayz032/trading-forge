/**
 * Handler-driven dispatch-marker bidirectional fix — 2026-07-04
 *
 * Regression coverage for the bug where spec-onboarded direction="both"
 * strategies whose entry_long === entry_short === a dispatch marker
 * ("archetype_dispatch:<key>" / "spec_conditions:<hash>", stamped by
 * spec-onboarding-service.ts::buildDirectionalEntries()) were silently
 * coerced to direction="long" by framework-overlay.ts's duplicate-text
 * guard — because that guard only recognized the "high < low" sentinel and
 * an entry_indicator starting with "archetype:", not the newer
 * spec-onboarding dispatch-marker convention. The short side was amputated
 * (entry_short set to "") on every one of the 78-of-120 affected strategies.
 *
 * Phase 1 verification (engine, 2026-07-04) confirmed this is a genuine
 * false-positive, not a cosmetic label to preserve: both dispatch markers
 * route to engine code that ACTUALLY emits independent long AND short signals
 * per bar —
 *   - "spec_conditions:<hash>" -> SpecConditionStrategy
 *     (src/engine/spec_condition_compiler.py:356-368 — when
 *     spec.direction=="both", entry_long = entry_signal & wait_bias_bull and
 *     entry_short = entry_signal & ~wait_bias_bull, a real EMA-slope bias
 *     split, not a duplicated boolean).
 *   - "archetype_dispatch:<key>" -> an ARCHETYPE_CLASS_MAP strategy class via
 *     src/engine/archetype_evaluator.py (e.g.
 *     src/engine/strategies/bounce_off_level.py::compute(), which sets
 *     entry_long[i] and entry_short[i] independently inside its own bar-loop
 *     logic, never gated by an external direction flag).
 *
 * Fix: src/server/lib/handler-driven-entry.ts::isHandlerDrivenEntry() is now
 * the SINGLE shared recognizer used by both:
 *   - framework-overlay.ts's direction="both" coercion guard
 *   - direct-bucket-graduator.ts's auditBidirectionalCompleteness() (Gate 1),
 *     including the copy called by spec-onboarding-service.ts via
 *     getGraduatorModule()
 * so the two guards can never independently drift apart again.
 *
 * §1 tests the shared helper directly (pure, no DB).
 * §2 tests applyFrameworkOverlay()'s real behavior end-to-end.
 * §3 tests Gate 1 (auditBidirectionalCompleteness) via an inline mirror of
 *    the real source PLUS a static source-fidelity check — same convention
 *    as wave26-pass-g-b2-auditor-gates.test.ts, which avoids the
 *    DATABASE_URL bootstrap triggered by a top-level import of
 *    direct-bucket-graduator.ts. Unlike that file, the mirror here delegates
 *    to the REAL isHandlerDrivenEntry import instead of reimplementing the
 *    recognition logic, so §1's coverage is not duplicated/divergent.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { isHandlerDrivenEntry } from "../lib/handler-driven-entry.js";
import { applyFrameworkOverlay } from "../services/framework-overlay.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const GRADUATOR_SRC = fs.readFileSync(
  path.resolve(__dirname, "../services/direct-bucket-graduator.ts"),
  "utf-8",
);

// ─────────────────────────────────────────────────────────────────────────────
// §1  isHandlerDrivenEntry — the shared helper
// ─────────────────────────────────────────────────────────────────────────────

describe("isHandlerDrivenEntry (shared helper, src/server/lib/handler-driven-entry.ts)", () => {
  it("recognizes the 'high < low' sentinel on both sides", () => {
    expect(isHandlerDrivenEntry("high < low", "high < low", null)).toBe(true);
  });

  it("recognizes entry_indicator starting with 'archetype:' regardless of entry text", () => {
    expect(isHandlerDrivenEntry("some text", "some text", "archetype:ict_bias_aligned_continuation")).toBe(true);
  });

  it("recognizes identical archetype_dispatch:<key> markers on both sides (the bug case)", () => {
    expect(
      isHandlerDrivenEntry("archetype_dispatch:bounce_off_level", "archetype_dispatch:bounce_off_level", null),
    ).toBe(true);
  });

  it("recognizes identical spec_conditions:<hash> markers on both sides (the bug case)", () => {
    expect(
      isHandlerDrivenEntry("spec_conditions:abc123def456", "spec_conditions:abc123def456", null),
    ).toBe(true);
  });

  it("does NOT exempt genuinely-ambiguous duplicated grammar text (guard must stay intact)", () => {
    expect(isHandlerDrivenEntry("close > sma_20", "close > sma_20", null)).toBe(false);
  });

  it("does NOT exempt mismatched text even if one side looks like a dispatch marker", () => {
    expect(isHandlerDrivenEntry("spec_conditions:abc123def456", "close > sma_20", null)).toBe(false);
  });

  it("handles empty/undefined inputs safely (no throw, false)", () => {
    expect(isHandlerDrivenEntry(undefined, undefined, undefined)).toBe(false);
    expect(isHandlerDrivenEntry("", "", null)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2  applyFrameworkOverlay — direction="both" coercion guard, real behavior
// ─────────────────────────────────────────────────────────────────────────────

type OverlayCompiled = Parameters<typeof applyFrameworkOverlay>[0]["compiled"];

function makeBothConfig(entryLong: string, entryShort: string, entryIndicator?: string): OverlayCompiled {
  return {
    strategy: {
      name: "test_both_strategy",
      stop_loss: { type: "atr", multiplier: 1.5 },
      entry_long: entryLong,
      entry_short: entryShort,
    },
    exit_type: "trailing_stop",
    direction: "both",
    entry_type: "limit",
    ...(entryIndicator ? { entry_indicator: entryIndicator } : {}),
  } as OverlayCompiled;
}

describe("applyFrameworkOverlay — direction='both' dispatch-marker fix", () => {
  it("PRESERVES both sides for a spec_conditions dispatch marker (was silently coerced pre-fix)", () => {
    const result = applyFrameworkOverlay({
      compiled: makeBothConfig("spec_conditions:abc123def456", "spec_conditions:abc123def456"),
      source: "graduated_bucket",
      symbol: "MES",
    });
    expect(result.config.direction).toBe("both");
    expect(result.config.strategy?.entry_short).toBe("spec_conditions:abc123def456");
    expect(result.appliedRules.some((r) => r.includes("preserved"))).toBe(true);
  });

  it("PRESERVES both sides for an archetype_dispatch marker (was silently coerced pre-fix)", () => {
    const result = applyFrameworkOverlay({
      compiled: makeBothConfig("archetype_dispatch:bounce_off_level", "archetype_dispatch:bounce_off_level"),
      source: "graduated_bucket",
      symbol: "MES",
    });
    expect(result.config.direction).toBe("both");
    expect(result.config.strategy?.entry_short).toBe("archetype_dispatch:bounce_off_level");
  });

  it("PRESERVES both sides for the 'high < low' archetype sentinel (unchanged legacy behavior)", () => {
    const result = applyFrameworkOverlay({
      compiled: makeBothConfig("high < low", "high < low"),
      source: "graduated_bucket",
      symbol: "MES",
    });
    expect(result.config.direction).toBe("both");
    expect(result.config.strategy?.entry_short).toBe("high < low");
  });

  it("STILL COERCES a genuinely-broken both (identical non-handler grammar text) to 'long' — guard intact", () => {
    const result = applyFrameworkOverlay({
      compiled: makeBothConfig("close > sma_20", "close > sma_20"),
      source: "graduated_bucket",
      symbol: "MES",
    });
    expect(result.config.direction).toBe("long");
    expect(result.config.strategy?.entry_short).toBe("");
    expect(result.appliedRules.some((r) => r.includes("coerced to 'long'"))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3  Gate 1 (auditBidirectionalCompleteness) — inline mirror + source fidelity
// ─────────────────────────────────────────────────────────────────────────────
//
// Mirrors the real function body 1:1 (verified against source below) but
// delegates recognition to the REAL isHandlerDrivenEntry import rather than
// reimplementing it — avoids the DATABASE_URL bootstrap triggered by a
// top-level import of direct-bucket-graduator.ts (same rationale as
// wave26-pass-g-b2-auditor-gates.test.ts §0).

const BIDIR_SENTINEL = "high < low";

interface BidirectionalAuditResult {
  pass: boolean;
  reason: string | null;
}

function auditBidirectionalCompleteness(compiledConfig: {
  direction?: string;
  archetype?: string | null;
  entry_long?: string;
  entry_short?: string;
  entry_indicator?: string | null;
}): BidirectionalAuditResult {
  const direction = compiledConfig.direction ?? "";
  if (direction !== "both") return { pass: true, reason: null };

  const entryLong  = compiledConfig.entry_long  ?? "";
  const entryShort = compiledConfig.entry_short ?? "";
  const isHandlerDriven = Boolean(compiledConfig.archetype) ||
    isHandlerDrivenEntry(entryLong, entryShort, compiledConfig.entry_indicator ?? null);

  const longIsSentinel  = entryLong  === BIDIR_SENTINEL || entryLong  === "";
  const shortIsSentinel = entryShort === BIDIR_SENTINEL || entryShort === "";

  if (isHandlerDriven) {
    if (longIsSentinel !== shortIsSentinel) {
      return { pass: false, reason: "incomplete_bidirectional_extraction" };
    }
    return { pass: true, reason: null };
  }

  if (longIsSentinel || shortIsSentinel) {
    return { pass: false, reason: "incomplete_bidirectional_extraction" };
  }

  return { pass: true, reason: null };
}

describe("Gate 1 (auditBidirectionalCompleteness) — dispatch-marker exemption", () => {
  it("PASSES a spec_conditions dispatch-marker both-spec (no named archetype)", () => {
    const result = auditBidirectionalCompleteness({
      direction: "both",
      archetype: null,
      entry_long:  "spec_conditions:abc123def456",
      entry_short: "spec_conditions:abc123def456",
      entry_indicator: "spec_conditions:abc123def456",
    });
    expect(result.pass).toBe(true);
    expect(result.reason).toBeNull();
  });

  it("PASSES an archetype_dispatch marker both-spec (no named archetype field set)", () => {
    const result = auditBidirectionalCompleteness({
      direction: "both",
      archetype: null,
      entry_long:  "archetype_dispatch:bounce_off_level",
      entry_short: "archetype_dispatch:bounce_off_level",
    });
    expect(result.pass).toBe(true);
    expect(result.reason).toBeNull();
  });

  it("still PASSES the pre-existing archetype-field path (both sentinel, archetype set)", () => {
    const result = auditBidirectionalCompleteness({
      direction: "both",
      archetype: "silver_bullet",
      entry_long:  "high < low",
      entry_short: "high < low",
    });
    expect(result.pass).toBe(true);
    expect(result.reason).toBeNull();
  });

  it("still REJECTS a genuinely-broken parametric both (identical non-handler grammar)", () => {
    // Gate 1's parametric path only rejects on emptiness/sentinel — identical
    // non-handler grammar text is caught downstream by framework-overlay.ts's
    // coercion guard, not by this gate. Documented here so a future change to
    // either guard doesn't silently assume the other one covers this case.
    const result = auditBidirectionalCompleteness({
      direction: "both",
      archetype: null,
      entry_long:  "close > sma_20",
      entry_short: "close > sma_20",
    });
    expect(result.pass).toBe(true);
  });

  it("still REJECTS mixed sentinel/real state under the handler-driven path", () => {
    const result = auditBidirectionalCompleteness({
      direction: "both",
      archetype: "bounce_off_level",
      entry_long:  "close bounces above ema_50",
      entry_short: "high < low",
    });
    expect(result.pass).toBe(false);
    expect(result.reason).toBe("incomplete_bidirectional_extraction");
  });

  it("still REJECTS a genuinely empty/sentinel parametric both with no dispatch marker", () => {
    const result = auditBidirectionalCompleteness({
      direction: "both",
      archetype: null,
      entry_long:  "rsi_14 crosses_above 50",
      entry_short: "",
    });
    expect(result.pass).toBe(false);
    expect(result.reason).toBe("incomplete_bidirectional_extraction");
  });
});

describe("Gate 1 — static source-fidelity check (direct-bucket-graduator.ts)", () => {
  it("real source imports isHandlerDrivenEntry from the shared leaf lib", () => {
    expect(GRADUATOR_SRC).toMatch(
      /import\s*\{\s*isHandlerDrivenEntry\s*\}\s*from\s*["']\.\.\/lib\/handler-driven-entry\.js["']/,
    );
  });

  it("real auditBidirectionalCompleteness signature accepts entry_indicator", () => {
    const fnIdx = GRADUATOR_SRC.indexOf("export function auditBidirectionalCompleteness");
    expect(fnIdx).toBeGreaterThan(-1);
    const sig = GRADUATOR_SRC.slice(fnIdx, fnIdx + 400);
    expect(sig).toContain("entry_indicator?: string | null");
  });

  it("real function body computes isHandlerDriven via the shared helper OR the legacy archetype field", () => {
    const fnIdx = GRADUATOR_SRC.indexOf("export function auditBidirectionalCompleteness");
    const bodySlice = GRADUATOR_SRC.slice(fnIdx, fnIdx + 1200);
    expect(bodySlice).toContain("Boolean(compiledConfig.archetype)");
    expect(bodySlice).toMatch(/isHandlerDrivenEntry\(\s*entryLong\s*,\s*entryShort\s*,\s*compiledConfig\.entry_indicator/);
  });
});
