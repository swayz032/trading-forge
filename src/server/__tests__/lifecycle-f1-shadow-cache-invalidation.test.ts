/**
 * lifecycle-f1-shadow-cache-invalidation.test.ts — F-1 Capital Safety Bug
 *
 * AUDIT FINDING F-1 (2026-06-23): when writeBlock() atomically sets
 * shadow_mode_enabled=true in the DB (strategy → SHADOW), the in-memory
 * sessionCache in paper-signal-service.ts is NOT invalidated.  The cache has
 * no TTL and is keyed by sessionId.  Any active paper session for that strategy
 * keeps stale shadowModeEnabled=false → next signal is EXECUTED as a real
 * TradersPost broker order instead of being shadow-intercepted.
 *
 * FIX MANDATE:
 *   • paper-signal-service.ts exports invalidateSessionCacheForStrategy(strategyId)
 *   • It iterates the sessionCache Map, evicts entries whose .strategyId matches
 *   • lifecycle-service.ts calls it from writeBlock's post-commit block whenever
 *     shadow_mode_enabled changes (→SHADOW and SHADOW→ transitions)
 *   • The call is wrapped in try/catch — a cache eviction error NEVER breaks/blocks
 *     the lifecycle transition
 *
 * Capital-safety invariant: after CANDIDATE→SHADOW, the next signal for that
 * strategy must be shadow-intercepted (NO broker call), not executed from stale cache.
 *
 * TDD: tests written FAILING first.
 *
 * T-1: paper-signal-service.ts exports invalidateSessionCacheForStrategy
 * T-2: invalidateSessionCacheForStrategy evicts entries whose .strategyId matches
 * T-3: invalidateSessionCacheForStrategy does NOT evict entries for other strategies
 * T-4: lifecycle-service.ts calls invalidateSessionCacheForStrategy in post-commit
 *       block when transitioning INTO SHADOW (shadow_mode_enabled becomes true)
 * T-5: lifecycle-service.ts calls invalidateSessionCacheForStrategy in post-commit
 *       block when transitioning OUT of SHADOW (shadow_mode_enabled becomes false)
 * T-6: the call is fail-soft — wrapped in try/catch so an eviction error cannot
 *       block or abort the lifecycle transition
 * T-7: the call is dynamic import (or a conditional import) so lifecycle-service
 *       does NOT unconditionally import from paper-signal-service at module load
 *       (avoids circular-import risk at production boot)
 * T-8: invalidateSessionCacheForStrategy handles an empty cache (no entries at all)
 *       without throwing
 * T-9: invalidateSessionCacheForStrategy handles a strategyId with no matching
 *       sessions without throwing
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const LIFECYCLE_PATH = resolve(process.cwd(), "src/server/services/lifecycle-service.ts");
const PSS_PATH = resolve(process.cwd(), "src/server/services/paper-signal-service.ts");

// ─────────────────────────────────────────────────────────────────────────────
// T-1: paper-signal-service.ts exports invalidateSessionCacheForStrategy
// ─────────────────────────────────────────────────────────────────────────────

describe("T-1 — invalidateSessionCacheForStrategy is exported from paper-signal-service.ts", () => {
  it("paper-signal-service.ts has an export named invalidateSessionCacheForStrategy", () => {
    const src = readFileSync(PSS_PATH, "utf8");
    expect(src).toContain("export function invalidateSessionCacheForStrategy");
  });

  it("invalidateSessionCacheForStrategy accepts a strategyId string parameter", () => {
    const src = readFileSync(PSS_PATH, "utf8");
    const idx = src.indexOf("export function invalidateSessionCacheForStrategy");
    expect(idx).toBeGreaterThan(-1);
    // Read the function signature (first 120 chars)
    const sig = src.slice(idx, idx + 120);
    expect(sig).toMatch(/strategyId\s*:/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T-2: invalidateSessionCacheForStrategy evicts matching entries
// ─────────────────────────────────────────────────────────────────────────────

describe("T-2 — invalidateSessionCacheForStrategy evicts cache entries for the given strategyId", () => {
  it("function body iterates sessionCache and deletes entries with matching strategyId", () => {
    const src = readFileSync(PSS_PATH, "utf8");
    const fnIdx = src.indexOf("export function invalidateSessionCacheForStrategy");
    expect(fnIdx).toBeGreaterThan(-1);
    // Find the function body — from { to the matching }
    const bodyStart = src.indexOf("{", fnIdx);
    expect(bodyStart).toBeGreaterThan(fnIdx);
    // Read next 600 chars — should contain loop + delete
    const body = src.slice(bodyStart, bodyStart + 600);
    // Must iterate over the cache (for...of, forEach, or entries())
    const iterates = body.includes("sessionCache") && (
      body.includes("for (") ||
      body.includes("forEach") ||
      body.includes(".entries()")
    );
    expect(iterates).toBe(true);
    // Must delete matching entries
    expect(body).toContain("sessionCache.delete");
  });

  it("function checks .strategyId on each cached entry before deleting", () => {
    const src = readFileSync(PSS_PATH, "utf8");
    const fnIdx = src.indexOf("export function invalidateSessionCacheForStrategy");
    expect(fnIdx).toBeGreaterThan(-1);
    const bodyStart = src.indexOf("{", fnIdx);
    const body = src.slice(bodyStart, bodyStart + 600);
    // Must reference .strategyId for comparison
    expect(body).toMatch(/\.strategyId/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T-3: does NOT evict entries for other strategies
// ─────────────────────────────────────────────────────────────────────────────

describe("T-3 — invalidateSessionCacheForStrategy does NOT evict unrelated entries", () => {
  it("function only deletes entries that match the given strategyId (conditional check before delete)", () => {
    const src = readFileSync(PSS_PATH, "utf8");
    const fnIdx = src.indexOf("export function invalidateSessionCacheForStrategy");
    expect(fnIdx).toBeGreaterThan(-1);
    const bodyStart = src.indexOf("{", fnIdx);
    const body = src.slice(bodyStart, bodyStart + 600);
    // The delete must be conditional — not just "delete everything"
    // There must be a comparison (=== strategyId or !== strategyId) gating the delete
    const hasConditional = body.includes("=== strategyId") || body.includes("strategyId ===");
    expect(hasConditional).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T-4: lifecycle-service.ts calls invalidation on →SHADOW
// ─────────────────────────────────────────────────────────────────────────────

describe("T-4 — lifecycle-service.ts calls invalidateSessionCacheForStrategy when entering SHADOW", () => {
  it("lifecycle-service.ts references invalidateSessionCacheForStrategy", () => {
    const src = readFileSync(LIFECYCLE_PATH, "utf8");
    expect(src).toContain("invalidateSessionCacheForStrategy");
  });

  it("the invalidation call site appears in the post-commit section (after writeBlock)", () => {
    const src = readFileSync(LIFECYCLE_PATH, "utf8");
    // Post-commit section anchor
    const postCommitIdx = src.indexOf("Post-commit side effects");
    expect(postCommitIdx).toBeGreaterThan(-1);
    const invalidateIdx = src.indexOf("invalidateSessionCacheForStrategy", postCommitIdx);
    expect(invalidateIdx).toBeGreaterThan(postCommitIdx);
  });

  it("the invalidation is called when shadow_mode_enabled changes (toState===SHADOW OR fromState===SHADOW)", () => {
    const src = readFileSync(LIFECYCLE_PATH, "utf8");
    const postCommitIdx = src.indexOf("Post-commit side effects");
    // Find the region around the invalidation call
    const invalidateIdx = src.indexOf("invalidateSessionCacheForStrategy", postCommitIdx);
    expect(invalidateIdx).toBeGreaterThan(-1);
    // Look at 500 chars before the call for the conditional that guards it
    const context = src.slice(Math.max(postCommitIdx, invalidateIdx - 500), invalidateIdx + 100);
    // Must be inside a condition that checks SHADOW transitions
    const mentionsShadow = context.includes("SHADOW") || context.includes("shadow_mode");
    expect(mentionsShadow).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T-5: lifecycle-service.ts calls invalidation on SHADOW→ (exit)
// ─────────────────────────────────────────────────────────────────────────────

describe("T-5 — lifecycle-service.ts calls invalidateSessionCacheForStrategy when exiting SHADOW", () => {
  it("invalidateSessionCacheForStrategy call covers both entry-to and exit-from SHADOW", () => {
    const src = readFileSync(LIFECYCLE_PATH, "utf8");
    const postCommitIdx = src.indexOf("Post-commit side effects");
    // Count occurrences of the call after post-commit
    const after = src.slice(postCommitIdx);
    const matches = [...after.matchAll(/invalidateSessionCacheForStrategy/g)];
    // Either one call inside a combined condition (toState=SHADOW || fromState=SHADOW)
    // or two separate calls (one for entry, one for exit)
    // Both patterns satisfy the contract — just ensure at least one occurrence
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it("the guard condition covers both toState===SHADOW and fromState===SHADOW cases", () => {
    const src = readFileSync(LIFECYCLE_PATH, "utf8");
    const postCommitIdx = src.indexOf("Post-commit side effects");
    const invalidateIdx = src.indexOf("invalidateSessionCacheForStrategy", postCommitIdx);
    expect(invalidateIdx).toBeGreaterThan(-1);
    // Look at 800 chars around the call site for the combined condition
    const context = src.slice(Math.max(postCommitIdx, invalidateIdx - 800), invalidateIdx + 200);
    // The condition must include both SHADOW entry (toState) and SHADOW exit (fromState)
    const coversEntry = context.includes("toState") && context.includes("SHADOW");
    const coversExit = context.includes("fromState") && context.includes("SHADOW");
    expect(coversEntry).toBe(true);
    expect(coversExit).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T-6: fail-soft — eviction error cannot block/abort the lifecycle transition
// ─────────────────────────────────────────────────────────────────────────────

describe("T-6 — shadow cache invalidation is fail-soft (eviction error does not abort transition)", () => {
  it("the invalidation call site is wrapped in a try/catch block", () => {
    const src = readFileSync(LIFECYCLE_PATH, "utf8");
    const postCommitIdx = src.indexOf("Post-commit side effects");
    const invalidateIdx = src.indexOf("invalidateSessionCacheForStrategy", postCommitIdx);
    expect(invalidateIdx).toBeGreaterThan(-1);
    // There must be a try/catch surrounding the invalidation call.
    // Look 600 chars before the call for "try {" and 800 chars after for "catch"
    // (the try block may contain multiple statements before the catch closes).
    const before = src.slice(Math.max(postCommitIdx, invalidateIdx - 600), invalidateIdx);
    expect(before).toContain("try");
    const after = src.slice(invalidateIdx, invalidateIdx + 800);
    expect(after).toContain("catch");
  });

  it("the catch block does NOT re-throw (eviction error is absorbed)", () => {
    const src = readFileSync(LIFECYCLE_PATH, "utf8");
    const postCommitIdx = src.indexOf("Post-commit side effects");
    const invalidateIdx = src.indexOf("invalidateSessionCacheForStrategy", postCommitIdx);
    expect(invalidateIdx).toBeGreaterThan(-1);
    // Find the catch block that encloses the invalidation
    const region = src.slice(invalidateIdx, invalidateIdx + 500);
    const catchIdx = region.indexOf("catch");
    expect(catchIdx).toBeGreaterThan(-1);
    const catchBlock = region.slice(catchIdx, catchIdx + 200);
    // Should NOT re-throw
    expect(catchBlock).not.toContain("throw ");
  });

  it("the catch block logs a warning (not silently swallowed)", () => {
    const src = readFileSync(LIFECYCLE_PATH, "utf8");
    const postCommitIdx = src.indexOf("Post-commit side effects");
    const invalidateIdx = src.indexOf("invalidateSessionCacheForStrategy", postCommitIdx);
    expect(invalidateIdx).toBeGreaterThan(-1);
    const region = src.slice(invalidateIdx, invalidateIdx + 500);
    const catchIdx = region.indexOf("catch");
    expect(catchIdx).toBeGreaterThan(-1);
    const catchBlock = region.slice(catchIdx, catchIdx + 200);
    // Should have a logger.warn call
    expect(catchBlock).toMatch(/logger\.(warn|error)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T-7: import safety — lifecycle-service uses dynamic import or
//       a conditional guard to avoid unconditional circular-import risk
// ─────────────────────────────────────────────────────────────────────────────

describe("T-7 — lifecycle-service.ts imports invalidateSessionCacheForStrategy safely", () => {
  it("lifecycle-service.ts does NOT have a top-level static import of the full paper-signal-service module", () => {
    const src = readFileSync(LIFECYCLE_PATH, "utf8");
    // Top-level static imports end before the first non-import/non-const statement
    // We check that there is no bare 'import ... from "...paper-signal-service"' at the top
    // A dynamic import("...paper-signal-service...") inside a function is fine.
    // Find any static import of paper-signal-service
    const staticImportPattern = /^import\s+.+\s+from\s+['"].*paper-signal-service/m;
    expect(staticImportPattern.test(src)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T-8 / T-9: invalidateSessionCacheForStrategy is safe on empty/miss
//   (source-inspection tests — same pattern as T-1 through T-7 above,
//    avoiding DB-bootstrap complexity that vitest module isolation triggers)
// ─────────────────────────────────────────────────────────────────────────────

describe("T-8 & T-9 — invalidateSessionCacheForStrategy is safe on empty cache and on cache miss", () => {
  it("T-8: function body does not assume the cache is non-empty (no unconditional [0] index access)", () => {
    const src = readFileSync(PSS_PATH, "utf8");
    const fnIdx = src.indexOf("export function invalidateSessionCacheForStrategy");
    expect(fnIdx).toBeGreaterThan(-1);
    const bodyStart = src.indexOf("{", fnIdx);
    const body = src.slice(bodyStart, bodyStart + 600);
    // The function must NOT do unconditional index-0 access that would throw on empty map
    // Safe patterns: for...of, forEach, .entries() — these naturally skip on empty map
    expect(body).not.toMatch(/sessionCache\[\s*0\s*\]/);
    // Must use safe iteration (for...of entries, forEach, or similar)
    const safeIteration = body.includes("for (") || body.includes("forEach") || body.includes(".entries()") || body.includes(".values()");
    expect(safeIteration).toBe(true);
  });

  it("T-9: function does not call sessionCache.get() alone — iterates the whole cache to find by strategyId", () => {
    const src = readFileSync(PSS_PATH, "utf8");
    const fnIdx = src.indexOf("export function invalidateSessionCacheForStrategy");
    expect(fnIdx).toBeGreaterThan(-1);
    const bodyStart = src.indexOf("{", fnIdx);
    const body = src.slice(bodyStart, bodyStart + 600);
    // The function cannot use .get(strategyId) because the cache is keyed by sessionId.
    // It must iterate all entries and filter by .strategyId field value.
    // Verify there's NO "sessionCache.get(strategyId)" pattern (that would be wrong key).
    expect(body).not.toMatch(/sessionCache\.get\s*\(\s*strategyId\s*\)/);
  });

  it("invalidateSessionCacheForStrategy is idempotent — calling it twice is safe (source contract)", () => {
    const src = readFileSync(PSS_PATH, "utf8");
    const fnIdx = src.indexOf("export function invalidateSessionCacheForStrategy");
    expect(fnIdx).toBeGreaterThan(-1);
    // Find the body opening brace
    const bodyStart = src.indexOf("{", fnIdx);
    // Find the closing brace of this specific function (the next "}\n" at column 0)
    // Use a small window that covers the function body but NOT the next exported function.
    // The function is short (~6 lines / ~200 chars of body content).
    const body = src.slice(bodyStart, bodyStart + 200);
    // Map.delete() on a non-existent key is always safe (returns false, not throw).
    // The function must use Map.delete(), not an operation that could throw on double-call.
    expect(body).toContain("sessionCache.delete");
    // Must NOT use Map.clear() inside the function body — that would be over-broad.
    // (clearSessionCache() is a separate exported function that follows; we stay within 200 chars.)
    expect(body).not.toContain("sessionCache.clear()");
  });
});
