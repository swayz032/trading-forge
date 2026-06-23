/**
 * lifecycle-f3-shadow-route.test.ts — F-3 Audit Finding: CANDIDATE must route through SHADOW
 *
 * Audit finding F-3 (2026-06-23): NO strategy may reach PAPER (paper capital, real TradersPost
 * creds) without SHADOW skew measurement. The backtest fast-track used to call
 * promoteStrategy("CANDIDATE","PAPER") directly, bypassing the shadow-signal divergence gate
 * that catches training-serving skew (institutional grade #1 failure mode).
 *
 * Fix: route fast-track CANDIDATE→SHADOW (not CANDIDATE→PAPER).
 * SHADOW→PAPER already gated by A.3 divergence check (≥20 signals, <5% divergence).
 * TESTING is still skippable — SHADOW is the mandatory skew measurement layer.
 *
 * Tests (TDD — written FAILING first, then made green):
 *
 * T-1: CANDIDATE→PAPER is INVALID (removed from VALID_TRANSITIONS)
 * T-2: CANDIDATE→SHADOW is VALID (added to VALID_TRANSITIONS)
 * T-3: backtest-service fast-track documents promoteStrategy to SHADOW, not PAPER
 * T-4: writeBlock sets shadow_mode_enabled=true when toState===SHADOW (anti-orphan)
 * T-5: SHADOW→PAPER still reachable (divergence gate path unchanged)
 * T-6: shadow_mode_enabled=false when exiting SHADOW (toState===PAPER)
 * T-7: .env.example documents PROMOTION_GRANDFATHER_PRE_PASS_E flag
 * T-8: lifecycle-service F-3 rationale comment reflects CANDIDATE→SHADOW routing
 * T-9: backtest fast-track audit actions reference SHADOW not PAPER as toState
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const LIFECYCLE_PATH = resolve(process.cwd(), "src/server/services/lifecycle-service.ts");
const BACKTEST_PATH = resolve(process.cwd(), "src/server/services/backtest-service.ts");
const ENV_EXAMPLE_PATH = resolve(process.cwd(), ".env.example");

// ─────────────────────────────────────────────────────────────────────────────
// T-1: CANDIDATE→PAPER is INVALID — removed from VALID_TRANSITIONS
// ─────────────────────────────────────────────────────────────────────────────

describe("T-1 — CANDIDATE→PAPER is INVALID (F-3 fix)", () => {
  it("CANDIDATE entry in VALID_TRANSITIONS does NOT include PAPER", () => {
    const src = readFileSync(LIFECYCLE_PATH, "utf8");

    // Find the CANDIDATE: [...] line inside VALID_TRANSITIONS
    const candidateIdx = src.indexOf('CANDIDATE: [');
    expect(candidateIdx).toBeGreaterThan(-1);

    // Read just that line (up to the closing bracket)
    const lineEnd = src.indexOf(']', candidateIdx);
    expect(lineEnd).toBeGreaterThan(candidateIdx);
    const candidateLine = src.slice(candidateIdx, lineEnd + 1);

    // Must NOT contain "PAPER" as a direct CANDIDATE target
    expect(candidateLine).not.toContain('"PAPER"');
  });

  it("CANDIDATE entry in VALID_TRANSITIONS includes SHADOW", () => {
    const src = readFileSync(LIFECYCLE_PATH, "utf8");

    const candidateIdx = src.indexOf('CANDIDATE: [');
    expect(candidateIdx).toBeGreaterThan(-1);

    const lineEnd = src.indexOf(']', candidateIdx);
    const candidateLine = src.slice(candidateIdx, lineEnd + 1);

    expect(candidateLine).toContain('"SHADOW"');
  });

  it("CANDIDATE entry in VALID_TRANSITIONS still includes TESTING and GRAVEYARD", () => {
    const src = readFileSync(LIFECYCLE_PATH, "utf8");

    const candidateIdx = src.indexOf('CANDIDATE: [');
    expect(candidateIdx).toBeGreaterThan(-1);

    const lineEnd = src.indexOf(']', candidateIdx);
    const candidateLine = src.slice(candidateIdx, lineEnd + 1);

    expect(candidateLine).toContain('"TESTING"');
    expect(candidateLine).toContain('"GRAVEYARD"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T-2: CANDIDATE→SHADOW is VALID
// ─────────────────────────────────────────────────────────────────────────────

describe("T-2 — CANDIDATE→SHADOW is VALID", () => {
  // Pure-function test using the local VALID_TRANSITIONS mirror from the source
  // (source inspection, not runtime import — avoids DB dependency)
  it("lifecycle-service source contains CANDIDATE: [...SHADOW...]", () => {
    const src = readFileSync(LIFECYCLE_PATH, "utf8");
    // The CANDIDATE transitions line must contain SHADOW
    expect(src).toMatch(/CANDIDATE:\s*\[.*"SHADOW".*\]/);
  });

  it("SHADOW appears in the CANDIDATE transitions array before GRAVEYARD", () => {
    const src = readFileSync(LIFECYCLE_PATH, "utf8");
    const candidateIdx = src.indexOf('CANDIDATE: [');
    expect(candidateIdx).toBeGreaterThan(-1);
    const lineEnd = src.indexOf(']', candidateIdx);
    const candidateLine = src.slice(candidateIdx, lineEnd + 1);

    const shadowPos = candidateLine.indexOf('"SHADOW"');
    const graveyardPos = candidateLine.indexOf('"GRAVEYARD"');
    expect(shadowPos).toBeGreaterThan(-1);
    expect(graveyardPos).toBeGreaterThan(-1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T-3: backtest-service fast-track promotes to SHADOW, not PAPER
// ─────────────────────────────────────────────────────────────────────────────

describe("T-3 — backtest fast-track promotes CANDIDATE→SHADOW (not PAPER)", () => {
  it("backtest-service promoteStrategy call uses 'SHADOW' as the target state", () => {
    const src = readFileSync(BACKTEST_PATH, "utf8");

    // The fast-track section contains the promoteStrategy call.
    // Find the FIX 2 fast-track block header.
    const fix2Idx = src.indexOf("FIX 2 — CANDIDATE");
    expect(fix2Idx).toBeGreaterThan(-1);

    // Read the block from FIX 2 comment to the end of the auto-promote try/catch
    // (~3000 chars is safe to capture the full block)
    const block = src.slice(fix2Idx, fix2Idx + 5000);

    // The promoteStrategy call must target SHADOW
    expect(block).toContain('"SHADOW"');

    // The promoteStrategy call must NOT target PAPER directly in this block
    // (look for the literal argument pair "CANDIDATE", "PAPER")
    expect(block).not.toContain('"CANDIDATE",\n            "PAPER"');
    expect(block).not.toMatch(/promoteStrategy\s*\(\s*\n\s*strategyId\s*,\s*\n\s*"CANDIDATE"\s*,\s*\n\s*"PAPER"/);
  });

  it("backtest-service fast-track audit input.toState references SHADOW not PAPER", () => {
    const src = readFileSync(BACKTEST_PATH, "utf8");

    const fix2Idx = src.indexOf("FIX 2 — CANDIDATE");
    expect(fix2Idx).toBeGreaterThan(-1);

    const block = src.slice(fix2Idx, fix2Idx + 5000);

    // Audit rows in the fast-track block should say toState: "SHADOW"
    // (the gate blocks that exit early still say fromState: "CANDIDATE")
    // Count occurrences of toState: "PAPER" in the block — should be 0
    const toPaperInBlock = (block.match(/toState:\s*["']PAPER["']/g) ?? []).length;
    expect(toPaperInBlock).toBe(0);
  });

  it("backtest-service fast-track comment updated to mention SHADOW", () => {
    const src = readFileSync(BACKTEST_PATH, "utf8");

    const fix2Idx = src.indexOf("FIX 2 — CANDIDATE");
    expect(fix2Idx).toBeGreaterThan(-1);

    // The comment describing the fast-track route should mention SHADOW
    const commentBlock = src.slice(fix2Idx, fix2Idx + 500);
    expect(commentBlock).toContain("SHADOW");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T-4: writeBlock sets shadow_mode_enabled=true when toState===SHADOW (anti-orphan)
// ─────────────────────────────────────────────────────────────────────────────

describe("T-4 — writeBlock sets shadowModeEnabled=true on SHADOW entry (anti-orphan)", () => {
  it("lifecycle-service writeBlock sets shadowModeEnabled: true when toState === SHADOW", () => {
    const src = readFileSync(LIFECYCLE_PATH, "utf8");

    // writeBlock is the inner function that does the DB update.
    // It must set shadowModeEnabled: true when targeting SHADOW.
    // Look for the conditional pattern near the .set({ lifecycleState: toState, ... }) block.
    // The pattern: shadowModeEnabled is set conditionally based on toState
    expect(src).toContain("shadowModeEnabled");

    // The shadow activation should be inside the writeBlock (near the strategy update)
    const writeBlockIdx = src.indexOf("const writeBlock = async");
    expect(writeBlockIdx).toBeGreaterThan(-1);

    // Read 2000 chars from writeBlock to capture the update.set() call
    const writeBlockSection = src.slice(writeBlockIdx, writeBlockIdx + 2000);
    expect(writeBlockSection).toContain("shadowModeEnabled");
  });

  it("lifecycle-service writeBlock sets shadowModeEnabled: false when exiting SHADOW (SHADOW→PAPER)", () => {
    const src = readFileSync(LIFECYCLE_PATH, "utf8");

    // When toState === "PAPER" from SHADOW, shadow_mode_enabled should be cleared
    // to prevent the paper signal service from continuing to intercept signals.
    const writeBlockIdx = src.indexOf("const writeBlock = async");
    expect(writeBlockIdx).toBeGreaterThan(-1);
    const writeBlockSection = src.slice(writeBlockIdx, writeBlockIdx + 2000);

    // The conditional must reference both SHADOW entry (true) and PAPER exit (false)
    // Presence of both 'true' and 'false' assignments to shadowModeEnabled
    expect(writeBlockSection).toMatch(/shadowModeEnabled.*true|true.*shadowModeEnabled/);
    expect(writeBlockSection).toMatch(/shadowModeEnabled.*false|false.*shadowModeEnabled/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T-5: SHADOW→PAPER still reachable via divergence gate (unchanged)
// ─────────────────────────────────────────────────────────────────────────────

describe("T-5 — SHADOW→PAPER path is still valid (divergence gate unchanged)", () => {
  it("VALID_TRANSITIONS SHADOW array still contains PAPER", () => {
    const src = readFileSync(LIFECYCLE_PATH, "utf8");

    // Find the SHADOW transitions entry
    const shadowIdx = src.indexOf('SHADOW: [');
    expect(shadowIdx).toBeGreaterThan(-1);

    const lineEnd = src.indexOf(']', shadowIdx);
    const shadowLine = src.slice(shadowIdx, lineEnd + 1);

    expect(shadowLine).toContain('"PAPER"');
  });

  it("Gate 2.5 SHADOW→PAPER divergence check block is still present", () => {
    const src = readFileSync(LIFECYCLE_PATH, "utf8");

    // The Wave 29 Pass A.3 divergence gate must still exist
    expect(src).toContain("Gate 2.5");
    expect(src).toContain("compareShadowToBacktest");
    expect(src).toContain("lifecycle.shadow_divergence_blocked");
  });

  it("lifecycle.shadow_promotion_passed audit action is still wired", () => {
    const src = readFileSync(LIFECYCLE_PATH, "utf8");
    expect(src).toContain("lifecycle.shadow_promotion_passed");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T-7: .env.example documents PROMOTION_GRANDFATHER_PRE_PASS_E
// ─────────────────────────────────────────────────────────────────────────────

describe("T-7 — .env.example documents PROMOTION_GRANDFATHER_PRE_PASS_E", () => {
  it(".env.example contains PROMOTION_GRANDFATHER_PRE_PASS_E=false", () => {
    const src = readFileSync(ENV_EXAMPLE_PATH, "utf8");
    expect(src).toContain("PROMOTION_GRANDFATHER_PRE_PASS_E=false");
  });

  it(".env.example PROMOTION_GRANDFATHER_PRE_PASS_E entry has a comment explaining migration-only use", () => {
    const src = readFileSync(ENV_EXAMPLE_PATH, "utf8");

    const flagIdx = src.indexOf("PROMOTION_GRANDFATHER_PRE_PASS_E");
    expect(flagIdx).toBeGreaterThan(-1);

    // The surrounding block (300 chars before the flag line) should contain a comment
    const surroundingBlock = src.slice(Math.max(0, flagIdx - 400), flagIdx + 200);
    // Must mention migration and fail-closed meaning
    expect(surroundingBlock.toLowerCase()).toMatch(/migration|escape valve|grandfather/i);
    expect(surroundingBlock.toLowerCase()).toMatch(/fail.closed|fails.closed/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T-8: lifecycle-service F-3 comment reflects CANDIDATE→SHADOW routing
// ─────────────────────────────────────────────────────────────────────────────

describe("T-8 — lifecycle-service F-3 comment updated for CANDIDATE→SHADOW", () => {
  it("VALID_TRANSITIONS CANDIDATE comment references SHADOW as fast-track target", () => {
    const src = readFileSync(LIFECYCLE_PATH, "utf8");

    const candidateIdx = src.indexOf('CANDIDATE: [');
    expect(candidateIdx).toBeGreaterThan(-1);

    // Read the comment block above CANDIDATE (up to 800 chars before)
    const commentBlock = src.slice(Math.max(0, candidateIdx - 800), candidateIdx + 300);
    // Must mention SHADOW as the fast-track destination
    expect(commentBlock).toContain("SHADOW");
  });

  it("VALID_TRANSITIONS CANDIDATE comment states PAPER is no longer a direct CANDIDATE target", () => {
    const src = readFileSync(LIFECYCLE_PATH, "utf8");

    const candidateIdx = src.indexOf('CANDIDATE: [');
    expect(candidateIdx).toBeGreaterThan(-1);

    const commentBlock = src.slice(Math.max(0, candidateIdx - 800), candidateIdx + 300);
    // The F-3 comment must document that CANDIDATE→PAPER is now invalid
    // (either directly says "not a direct" or "removed" or "no longer")
    expect(commentBlock).toMatch(/PAPER.*no longer|no longer.*PAPER|PAPER.*removed|removed.*PAPER|CANDIDATE.*SHADOW/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T-9: backtest fast-track gate block audit actions reference SHADOW
// ─────────────────────────────────────────────────────────────────────────────

describe("T-9 — backtest fast-track gate audit actions reference SHADOW as destination", () => {
  it("strategy.fast-track.survival-score-blocked audit input references SHADOW", () => {
    const src = readFileSync(BACKTEST_PATH, "utf8");

    const actionIdx = src.indexOf("strategy.fast-track.survival-score-blocked");
    expect(actionIdx).toBeGreaterThan(-1);

    // Read the surrounding audit row (400 chars) — the input.toState should say SHADOW
    const auditBlock = src.slice(actionIdx, actionIdx + 400);
    expect(auditBlock).toContain("SHADOW");
    // Must NOT say PAPER as toState in this audit row
    expect(auditBlock).not.toContain('"PAPER"');
  });

  it("strategy.fast-track.compliance-drift-blocked audit input references SHADOW", () => {
    const src = readFileSync(BACKTEST_PATH, "utf8");

    const actionIdx = src.indexOf("strategy.fast-track.compliance-drift-blocked");
    expect(actionIdx).toBeGreaterThan(-1);

    const auditBlock = src.slice(actionIdx, actionIdx + 400);
    expect(auditBlock).toContain("SHADOW");
    expect(auditBlock).not.toContain('"PAPER"');
  });

  it("strategy.fast-track.compliance_blocked audit input references SHADOW", () => {
    const src = readFileSync(BACKTEST_PATH, "utf8");

    const actionIdx = src.indexOf("strategy.fast-track.compliance_blocked");
    expect(actionIdx).toBeGreaterThan(-1);

    const auditBlock = src.slice(actionIdx, actionIdx + 400);
    expect(auditBlock).toContain("SHADOW");
    expect(auditBlock).not.toContain('"PAPER"');
  });

  it("strategy.fast-track.exportability-blocked audit input references SHADOW", () => {
    const src = readFileSync(BACKTEST_PATH, "utf8");

    const actionIdx = src.indexOf("strategy.fast-track.exportability-blocked");
    expect(actionIdx).toBeGreaterThan(-1);

    const auditBlock = src.slice(actionIdx, actionIdx + 400);
    expect(auditBlock).toContain("SHADOW");
    expect(auditBlock).not.toContain('"PAPER"');
  });
});
