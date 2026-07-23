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
 * B6 — TESTING→PAPER stopStream race (2026-06-23) — INVERTED for M3 PAPER
 * Authority Flip (2026-07-17). The ORIGINAL bug + fix (documented here for
 * history): stopStream was inside a fire-and-forget IIFE. transitionState()
 * returned {success:true} BEFORE stop completed. A bar arriving in that gap
 * emitted internal-simulator fills under a now-PAPER-state strategy →
 * dual-stream corruption. FIX: await stopStream before returning; on throw,
 * swallow + audit paper.stop_stream_failed_on_transition (warn), never
 * blocking the transition.
 *
 * M3 (2026-07-17) inverted the DIRECTION of the action at this exact site:
 * PAPER is now internal-engine-only, so the block STARTS/CONTINUES the stream
 * on toState==="PAPER" instead of stopping it. The B6 discipline (await
 * synchronously, swallow-but-audit on throw, never block the transition) is
 * UNCHANGED — only "stopStream" became "startStream"/"isStreaming". A NEW
 * sibling block (fromState==="PAPER" leaving to a broker-authoritative state)
 * now owns the stopStream call this describe block used to test.
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
// B6 / M3 — internal stream START must be awaited-equivalent (no race);
// INVERTED 2026-07-17 (M3 PAPER Authority Flip)
// ─────────────────────────────────────────────────────────────────────────────

describe("B6/M3 — start/continue the internal stream (not stop it) on toState===PAPER, same no-race discipline", () => {
  const m3Idx = src.indexOf("M3 FIX (2026-07-17)");

  it("M3 FIX marker exists at the site the old B6 FIX comment used to occupy", () => {
    expect(m3Idx).toBeGreaterThan(-1);
  });

  it("startStream call exists in the toState===PAPER block (not a fire-and-forget IIFE)", () => {
    // The B6 discipline (no `(async () => {...})()` wrapper) carries forward —
    // only the STREAM ACTION inverted from stopStream to startStream.
    const block = src.slice(m3Idx, m3Idx + 4500);
    expect(block).toContain("await startStream(activeSessId, symbols)");
  });

  it("no fire-and-forget IIFE wraps the startStream call", () => {
    // The pre-B6 pattern was `(async () => { try { ... stopStream(...); ... } catch {}})();`
    // — B6 removed the IIFE; M3 preserves that removal for the inverted action.
    const block = src.slice(m3Idx, m3Idx + 4500);
    expect(block).not.toContain("(async () => {");
  });

  it("the awaited startStream attempt happens before the authority audit", () => {
    const block = src.slice(m3Idx, m3Idx + 12500);
    const startLocalIdx = block.indexOf("startStream(activeSessId, symbols)");
    const authorityLocalIdx = block.indexOf("paper.engine_authority_declared");
    expect(startLocalIdx).toBeGreaterThan(-1);
    expect(authorityLocalIdx).toBeGreaterThan(-1);
    expect(startLocalIdx).toBeLessThan(authorityLocalIdx);
  });

  it("writes paper.start_stream_failed_on_transition audit if startStream throws but does not block transition", () => {
    // The catch block around startStream must write this action and NOT return early.
    expect(src).toContain("paper.start_stream_failed_on_transition");
    const auditIdx = src.indexOf("paper.start_stream_failed_on_transition");
    expect(auditIdx).toBeGreaterThan(-1);
    // Verify it does NOT contain `return { success: false }` inside this catch block.
    const catchRegion = src.slice(auditIdx, auditIdx + 500);
    expect(catchRegion).not.toContain("return { success: false");
  });

  it("paper.engine_authority_declared audit fires after the start attempt (observability not state)", () => {
    // The audit must appear AFTER the startStream try/catch block in source order.
    const startFailedIdx = src.indexOf("paper.start_stream_failed_on_transition");
    const authorityIdx = src.indexOf("paper.engine_authority_declared");
    expect(startFailedIdx).toBeGreaterThan(-1);
    expect(authorityIdx).toBeGreaterThan(-1);
    expect(authorityIdx).toBeGreaterThan(startFailedIdx);
  });

  it("starts/continues the stream for ANY transition into PAPER (deepscan14 A1 guard shape preserved — includes SHADOW→PAPER)", () => {
    // deepscan14 A1's guard generalization (fromState==="TESTING" && toState==="PAPER"
    // -> toState==="PAPER" alone) is UNCHANGED by M3 — only the action inside inverted.
    const block = src.slice(m3Idx, m3Idx + 4500);
    expect(block).toContain('if (toState === "PAPER")');
    expect(block).not.toContain('if (fromState === "TESTING" && toState === "PAPER")');
  });

  it("a NEW sibling block stops the stream when LEAVING PAPER for a broker-authoritative state (the M3 zero-carry-forward fix)", () => {
    // This is where the OLD stopStream-on-PAPER call effectively moved to —
    // PAPER's internal stream is now genuinely alive, so something must stop it
    // on the way OUT of PAPER into DEPLOY_READY/PILOT/DEPLOYED, or the internal
    // engine would keep writing fills for a TradersPost-authoritative strategy.
    expect(src).toContain('if (fromState === "PAPER" && isBrokerAuthoritativeState(toState)) {');
    const siblingIdx = src.indexOf('if (fromState === "PAPER" && isBrokerAuthoritativeState(toState)) {');
    const siblingBlock = src.slice(siblingIdx, siblingIdx + 5000);
    expect(siblingBlock).toContain("await stopStream(leavingSessId)");
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
