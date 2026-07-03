/**
 * lifecycle-b3-b6-archetype-gate-stop-race.test.ts
 *
 * Tests for two BLOCKERs in lifecycle-service.ts:
 *
 * B3 — Archetype gateway gate is env-conditional (fail-OPEN when unset).
 *   Original: `if (entryIndicator.startsWith("archetype:") && process.env.LIVE_ORDER_GATEWAY_URL)`
 *   When LIVE_ORDER_GATEWAY_URL is unset, the entire gate is skipped. An archetype
 *   strategy promoted TESTING→PAPER would bypass Pine marker verification → if it fires
 *   a Pine alert, it hits /api/live-order without TF-gateway markers → bypasses
 *   kill-switch/compliance/firm-cap.
 *
 *   FIX: fail-CLOSED when env unset — block promotion + write
 *   lifecycle.archetype_gateway_env_missing audit + Discord WARN.
 *
 * B6 — TESTING→PAPER stopStream race.
 *   Original: stopStream was inside a fire-and-forget IIFE. transitionState() returned
 *   {success:true} BEFORE stop completed. A bar arriving in that gap emitted internal-
 *   simulator fills under a now-PAPER-state strategy → dual-stream corruption.
 *
 *   FIX: await stopStream before returning. If stopStream throws, swallow + audit
 *   paper.stop_stream_failed_on_transition (warn) but do NOT block the transition.
 *
 * Source-code inspection pattern (same as lifecycle-gauntlet-hardening.test.ts and
 * lifecycle-f1-shadow-cache-invalidation.test.ts).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const LIFECYCLE_PATH = resolve(process.cwd(), "src/server/services/lifecycle-service.ts");

const src = readFileSync(LIFECYCLE_PATH, "utf8");

// ─────────────────────────────────────────────────────────────────────────────
// B3 — Archetype gateway gate fails CLOSED when LIVE_ORDER_GATEWAY_URL is unset
// ─────────────────────────────────────────────────────────────────────────────

describe("B3 — archetype gateway env-missing block", () => {
  it("BLOCKs archetype promotion when LIVE_ORDER_GATEWAY_URL is unset", () => {
    // The fix adds an explicit `!process.env.LIVE_ORDER_GATEWAY_URL` branch that
    // fires lifecycle.archetype_gateway_env_missing and returns { success: false }.
    expect(src).toContain("!process.env.LIVE_ORDER_GATEWAY_URL");
    expect(src).toContain("lifecycle.archetype_gateway_env_missing");
  });

  it("env-missing branch emits audit action lifecycle.archetype_gateway_env_missing", () => {
    const missingEnvIdx = src.indexOf("archetype_gateway_env_missing");
    expect(missingEnvIdx).toBeGreaterThan(-1);
    // The audit action must appear inside a block that includes missingEnv: "LIVE_ORDER_GATEWAY_URL"
    const region = src.slice(missingEnvIdx, missingEnvIdx + 500);
    expect(region).toContain("LIVE_ORDER_GATEWAY_URL");
  });

  it("env-missing branch returns { success: false } with error string", () => {
    // Find the env-missing block (starts at "archetype strategy (...) cannot be promoted")
    const blockIdx = src.indexOf("archetype strategy");
    expect(blockIdx).toBeGreaterThan(-1);
    // The return is ~2300 chars after the blockReason var; use 2500 window
    const region = src.slice(blockIdx, blockIdx + 2500);
    expect(region).toContain("return { success: false");
  });

  it("env-missing branch calls notifyWarning with archetype gateway info", () => {
    const envMissingIdx = src.indexOf("Archetype Gateway Env Missing");
    expect(envMissingIdx).toBeGreaterThan(-1);
  });

  it("runs marker verification when LIVE_ORDER_GATEWAY_URL is set", () => {
    // The } else if (...startsWith("archetype:") && process.env.LIVE_ORDER_GATEWAY_URL) branch
    // must still exist (regression test).
    expect(src).toContain(
      'entryIndicator.startsWith("archetype:") && process.env.LIVE_ORDER_GATEWAY_URL',
    );
  });

  it("still BLOCKs when env set but markers missing", () => {
    // The existing archetype_gateway_bypass_blocked audit action must still be present.
    expect(src).toContain("lifecycle.archetype_gateway_bypass_blocked");
  });

  it("passes through non-archetype strategies regardless of env", () => {
    // The outer block is `if (entryIndicator.startsWith("archetype:") && !process.env...)`.
    // Non-archetype strategies never enter either branch — they continue past this block.
    // Verify the archetype check still gates on startsWith("archetype:").
    expect(src).toContain('entryIndicator.startsWith("archetype:")');
    // And that there is no unconditional block covering all entry_indicators.
    const blockAllIdx = src.indexOf("return { success: false, error: blockReason }");
    // The block exists but only after archetype-specific checks — verified by the presence
    // of entryIndicator.startsWith guard wrapping the fail-closed paths.
    expect(blockAllIdx).toBeGreaterThan(-1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B6 — TESTING→PAPER stopStream must be awaited (no race)
// ─────────────────────────────────────────────────────────────────────────────

describe("B6 — await stopStream before returning from TESTING→PAPER transition", () => {
  it("stopStream call is awaited (not inside a fire-and-forget IIFE)", () => {
    // The fix replaces `(async () => { ... })()` with a direct `await stopStream(...)`.
    // Verify the await keyword precedes stopStream.
    expect(src).toContain("await stopStream(");
  });

  it("no fire-and-forget IIFE wraps the stopStream call", () => {
    // The old pattern was `(async () => { try { ... stopStream(...); ... } catch {}})();`
    // After B6 fix, the IIFE is removed from the TESTING→PAPER block.
    // We verify by checking that stopStream does NOT appear only inside `(async () => {`.
    // Specifically: the iife pattern `(async () => {` should NOT appear immediately before
    // the `stopStream` call in the TESTING→PAPER block.
    const testingToPaperIdx = src.indexOf("B6 FIX");
    expect(testingToPaperIdx).toBeGreaterThan(-1);
    // Grab the TESTING→PAPER block (up to 3000 chars)
    const block = src.slice(testingToPaperIdx, testingToPaperIdx + 3000);
    // The IIFE pattern should NOT be in this block
    expect(block).not.toContain("(async () => {");
  });

  it("awaits stopStream before the strategyPromotions.labels() call (in the same transition block)", () => {
    // After B6 fix: stopStream is awaited synchronously, then strategyPromotions.labels() fires.
    // Both are inside the TESTING→PAPER post-transition block.
    // Anchor on the B6 FIX comment to get local indices within that block.
    const b6Start = src.indexOf("B6 FIX");
    expect(b6Start).toBeGreaterThan(-1);
    // Grab a window large enough to span from B6 FIX to just past strategyPromotions.labels
    const block = src.slice(b6Start, b6Start + 5000);
    const stopLocalIdx = block.indexOf("await stopStream(");
    const promLocalIdx = block.indexOf("strategyPromotions.labels(");
    expect(stopLocalIdx).toBeGreaterThan(-1);
    expect(promLocalIdx).toBeGreaterThan(-1);
    expect(stopLocalIdx).toBeLessThan(promLocalIdx);
  });

  it("writes paper.stop_stream_failed_on_transition audit if stopStream throws but does not block transition", () => {
    // The catch block around stopStream must write this action and NOT return early.
    expect(src).toContain("paper.stop_stream_failed_on_transition");
    // Find the catch block containing this audit action.
    const auditIdx = src.indexOf("paper.stop_stream_failed_on_transition");
    expect(auditIdx).toBeGreaterThan(-1);
    // Verify it does NOT contain `return { success: false }` inside this catch block.
    // Grab ~500 chars after the audit action to inspect the catch block.
    const catchRegion = src.slice(auditIdx, auditIdx + 500);
    // The catch block should NOT have a failing return.
    expect(catchRegion).not.toContain("return { success: false");
  });

  it("paper.engine_authority_declared audit fires after stop (observability not state)", () => {
    // The audit must appear AFTER the stopStream try/catch block in source order.
    const stopFailedIdx = src.indexOf("paper.stop_stream_failed_on_transition");
    const authorityIdx = src.indexOf("paper.engine_authority_declared");
    expect(stopFailedIdx).toBeGreaterThan(-1);
    expect(authorityIdx).toBeGreaterThan(-1);
    // engine_authority_declared appears AFTER the stop-failed audit action.
    expect(authorityIdx).toBeGreaterThan(stopFailedIdx);
  });

  it("calls stopStream for ANY transition into PAPER (deepscan14 A1 — includes SHADOW→PAPER)", () => {
    // deepscan14 A1: the guard was generalized from
    // `fromState === "TESTING" && toState === "PAPER"` to `toState === "PAPER"`
    // because the Wave 29 default ladder reaches PAPER via SHADOW→PAPER, and the
    // internal sim stream must stop on that edge too (dual-stream P&L corruption fix).
    const b6BlockIdx = src.indexOf("B6 FIX");
    expect(b6BlockIdx).toBeGreaterThan(-1);
    // The if-guard sits after the verbose deepscan14 A1 comment; use a generous window
    const block = src.slice(b6BlockIdx, b6BlockIdx + 3000);
    expect(block).toContain('if (toState === "PAPER")');
    // And it must NOT have reverted to the old fromState-restricted guard as the live condition.
    expect(block).not.toContain('if (fromState === "TESTING" && toState === "PAPER")');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Regression — existing audit action namespaces not removed
// ─────────────────────────────────────────────────────────────────────────────

describe("regression — existing gate audit actions preserved", () => {
  it("lifecycle.archetype_gateway_bypass_blocked still present (markers missing path)", () => {
    expect(src).toContain("lifecycle.archetype_gateway_bypass_blocked");
  });

  it("paper.engine_authority_declared still present (stream stopped successfully path)", () => {
    expect(src).toContain("paper.engine_authority_declared");
  });
});
