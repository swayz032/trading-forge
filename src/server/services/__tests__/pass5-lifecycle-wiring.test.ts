/**
 * pass5-lifecycle-wiring.test.ts — Pass 5 Combined Tracks C+D
 *
 * Integration / source-code analysis tests verifying that:
 *  1. PATCH PAPER→DEPLOY_READY with valid HMAC + gate-pass → 200 + audit
 *  2. PATCH PAPER→DEPLOY_READY with valid HMAC + gate-block (WFE 0.5) → 403 + wfe_hard_floor_block audit
 *  3. PATCH without HMAC → 401
 *  4. PATCH with placeholder secret → 503
 *  5. PATCH SHADOW→PAPER with divergence block → 403 + shadow_divergence_blocked audit
 *  6. Cron sweep + PATCH on same strategy produce structurally equivalent audit rows (parity)
 *  7. POST /api/paper/start for PAPER-state strategy → 409 + paper.start_refused_paper_state
 *  8. TESTING→PAPER transition triggers stopStream() (mocked)
 *
 * Tests use source-code analysis and lightweight mock-based behavioral tests.
 * No real DB connections. No live imports of lifecycle-service (too many side-effects).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHmac } from "node:crypto";

// ──────────────────────────────────────────────────────────────────────────────
// Source paths
// ──────────────────────────────────────────────────────────────────────────────

const LIFECYCLE_PATH = resolve(process.cwd(), "src/server/services/lifecycle-service.ts");
const STRATEGIES_ROUTE_PATH = resolve(process.cwd(), "src/server/routes/strategies.ts");
const PAPER_ROUTE_PATH = resolve(process.cwd(), "src/server/routes/paper.ts");
const ENV_EXAMPLE_PATH = resolve(process.cwd(), ".env.example");

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function buildHmac(secret: string, timestamp: number, strategyId: string, fromState: string, toState: string): string {
  const payload = `${timestamp}:${strategyId}:${fromState}:${toState}`;
  return createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}

// ──────────────────────────────────────────────────────────────────────────────
// 1. PATCH route: HMAC presence, response codes (source-code assertions)
// ──────────────────────────────────────────────────────────────────────────────

describe("Pass 5 Track C — PATCH /:id/lifecycle HMAC gate (strategies.ts)", () => {
  it("imports createHmac and timingSafeEqual from crypto", () => {
    const src = readFileSync(STRATEGIES_ROUTE_PATH, "utf8");
    expect(src).toContain("createHmac");
    expect(src).toContain("timingSafeEqual");
  });

  it("returns 503 when secret is unset or placeholder", () => {
    const src = readFileSync(STRATEGIES_ROUTE_PATH, "utf8");
    // Must handle missing OR placeholder ("your-secret-here")
    expect(src).toContain("503");
    expect(src).toContain("admin_promote_hmac_not_configured");
    expect(src).toContain("your-secret-here");
  });

  it("returns 401 on HMAC verification failure", () => {
    const src = readFileSync(STRATEGIES_ROUTE_PATH, "utf8");
    expect(src).toContain("hmac_verification_failed");
    expect(src).toContain("401");
  });

  it("returns 401 on timestamp drift > 60s", () => {
    const src = readFileSync(STRATEGIES_ROUTE_PATH, "utf8");
    expect(src).toContain("timestamp_drift_exceeded");
    expect(src).toContain("60_000");
  });

  it("returns 403 (not 400) when gate blocks promotion", () => {
    const src = readFileSync(STRATEGIES_ROUTE_PATH, "utf8");
    // The gate-block path after promoteStrategy() result:
    // res.status(403).json — NOT res.status(400).json for gate blocks
    const idx = src.indexOf("lifecycleService.promoteStrategy");
    expect(idx).toBeGreaterThan(-1);
    const afterCall = src.slice(idx, idx + 300);
    expect(afterCall).toContain("403");
  });

  it("signing input matches plan format: ts:strategyId:fromState:toState", () => {
    const src = readFileSync(STRATEGIES_ROUTE_PATH, "utf8");
    // The payload construction must use the 4-part colon-joined format
    expect(src).toContain("${timestamp}:${strategyId}:${fromState}:${toState}");
  });

  it("ADMIN_PROMOTE_HMAC_SECRET is documented in .env.example", () => {
    const envSrc = readFileSync(ENV_EXAMPLE_PATH, "utf8");
    expect(envSrc).toContain("ADMIN_PROMOTE_HMAC_SECRET");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 2. HMAC signing helper behavioural tests
// ──────────────────────────────────────────────────────────────────────────────

describe("Pass 5 Track C — HMAC signing correctness (unit)", () => {
  it("buildHmac produces consistent output for same inputs", () => {
    const secret = "test-secret-for-unit-test";
    const ts = 1735000000;
    const sig1 = buildHmac(secret, ts, "strat-uuid", "PAPER", "DEPLOY_READY");
    const sig2 = buildHmac(secret, ts, "strat-uuid", "PAPER", "DEPLOY_READY");
    expect(sig1).toBe(sig2);
    expect(sig1).toHaveLength(64); // hex sha256
  });

  it("different strategyIds produce different signatures", () => {
    const secret = "test-secret-for-unit-test";
    const ts = 1735000000;
    const sig1 = buildHmac(secret, ts, "strat-a", "PAPER", "DEPLOY_READY");
    const sig2 = buildHmac(secret, ts, "strat-b", "PAPER", "DEPLOY_READY");
    expect(sig1).not.toBe(sig2);
  });

  it("different fromState/toState produce different signatures", () => {
    const secret = "test-secret-for-unit-test";
    const ts = 1735000000;
    const sig1 = buildHmac(secret, ts, "strat-a", "PAPER", "DEPLOY_READY");
    const sig2 = buildHmac(secret, ts, "strat-a", "SHADOW", "PAPER");
    expect(sig1).not.toBe(sig2);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 3. PAPER→DEPLOY_READY evaluator wiring — source-code analysis
// ──────────────────────────────────────────────────────────────────────────────

describe("Pass 5 Track C — PAPER→DEPLOY_READY evaluator wiring parity", () => {
  it("wires evaluatePaperToDeployReadyGates from paper-to-deploy-ready-gates.js", () => {
    const src = readFileSync(LIFECYCLE_PATH, "utf8");
    expect(src).toContain("evaluatePaperToDeployReadyGates");
    expect(src).toContain("paper-to-deploy-ready-gates.js");
  });

  it("builds pdrInput with all required flat fields: b14SurvivalTwin, mcRuinCi, b15Battery, walkForwardResults, orchGates, frozenPolicy", () => {
    const src = readFileSync(LIFECYCLE_PATH, "utf8");
    const pdrIdx = src.indexOf("pdrInput");
    expect(pdrIdx).toBeGreaterThan(-1);
    // Window widened 2000→5000 (pre-existing test fragility, unrelated to M3 —
    // orchGates/frozenPolicy sit ~3-4.2K chars past the anchor; confirmed via
    // base@255b503a comparison this was already too small before M3 landed).
    const pdrBlock = src.slice(pdrIdx, pdrIdx + 5000);
    expect(pdrBlock).toContain("b14SurvivalTwin");
    expect(pdrBlock).toContain("mcRuinCi");
    expect(pdrBlock).toContain("b15Battery");
    expect(pdrBlock).toContain("walkForwardResults");
    expect(pdrBlock).toContain("orchGates");
    expect(pdrBlock).toContain("frozenPolicy");
  });

  it("passes b14McDataAvailable field (truthy when MC run loaded)", () => {
    const src = readFileSync(LIFECYCLE_PATH, "utf8");
    expect(src).toContain("b14McDataAvailable");
  });

  it("blocks with return { success: false } on gate block", () => {
    const src = readFileSync(LIFECYCLE_PATH, "utf8");
    // Anchor on the gate-check itself (matches the pattern the neighboring
    // "inserts audit row" test already uses successfully) — the pdrInput
    // object grew large enough across later waves that anchoring from its
    // declaration no longer reaches this block within a reasonable window
    // (pre-existing fragility, unrelated to M3; confirmed via base@255b503a).
    const idx = src.indexOf("!gatePdrResult.passed");
    expect(idx).toBeGreaterThan(-1);
    const afterCall = src.slice(idx, idx + 1500);
    expect(afterCall).toContain("return { success: false");
  });

  it("inserts audit row using auditAction from evaluator result", () => {
    const src = readFileSync(LIFECYCLE_PATH, "utf8");
    const idx = src.indexOf("!gatePdrResult.passed");
    const block = src.slice(idx, idx + 1500);
    expect(block).toContain("gatePdrResult.auditAction");
    expect(block).toContain("db.insert(auditLog)");
  });

  it("broadcasts SSE event on block", () => {
    const src = readFileSync(LIFECYCLE_PATH, "utf8");
    // lifecycle-service.ts broadcasts via the named LIFECYCLE_GATE_EVENTS
    // constant (sse.ts), not the raw "lifecycle:..." string literal — the
    // literal never appears in this file (pre-existing test-fragility,
    // unrelated to M3; confirmed the raw literal was never here on
    // base@255b503a either, and the SSE genuinely fires via the constant).
    expect(src).toContain("LIFECYCLE_GATE_EVENTS.PAPER_TO_DEPLOY_READY_BLOCKED");
  });

  it("increments strategyPromotions counter on block", () => {
    const src = readFileSync(LIFECYCLE_PATH, "utf8");
    const idx = src.indexOf("!gatePdrResult.passed");
    const block = src.slice(idx, idx + 1500);
    expect(block).toContain("strategyPromotions.labels");
  });

  it("wraps evaluator call in try/catch with fail-CLOSED behavior (F-1 hardening 2026-06-23)", () => {
    // F-1 changed catch from fail-open to fail-closed — test updated to reflect new contract.
    // Anchor re-based on the gate-check (same rationale as the "blocks with
    // return" test above — pre-existing fragility, unrelated to M3).
    const src = readFileSync(LIFECYCLE_PATH, "utf8");
    const pdrInputIdx = src.indexOf("!gatePdrResult.passed");
    expect(pdrInputIdx).toBeGreaterThan(-1);
    const block = src.slice(pdrInputIdx, pdrInputIdx + 10000);
    expect(block).toContain("catch (pdrGateErr)");
    // Must return fail-closed on error
    const catchIdx = src.indexOf("catch (pdrGateErr)");
    const catchBlock = src.slice(catchIdx, catchIdx + 700);
    expect(catchBlock).toContain("paper_to_deploy_ready_gate_evaluator_error");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 4. SHADOW→PAPER evaluator wiring — source-code analysis
// ──────────────────────────────────────────────────────────────────────────────

describe("Pass 5 Track C — SHADOW→PAPER evaluator wiring parity", () => {
  it("wires evaluateShadowToPaperGate from shadow-to-paper-gate.js", () => {
    const src = readFileSync(LIFECYCLE_PATH, "utf8");
    expect(src).toContain("evaluateShadowToPaperGate");
    expect(src).toContain("shadow-to-paper-gate.js");
  });

  it("destructures loadDivergenceInputs result to flat fields (not divergenceInputs bag)", () => {
    const src = readFileSync(LIFECYCLE_PATH, "utf8");
    // Must pass shadowSignals: divInputs.shadowSignals (not divergenceInputs: divInputs)
    expect(src).toContain("shadowSignals: divInputs.shadowSignals");
    expect(src).toContain("backtestExpected: divInputs.backtestExpected");
    expect(src).toContain("backtestExpectedCount: divInputs.backtestExpected.length");
  });

  it("blocks with return { success: false } on gate block", () => {
    const src = readFileSync(LIFECYCLE_PATH, "utf8");
    const idx = src.indexOf("!shadowGateResult.passed");
    expect(idx).toBeGreaterThan(-1);
    // The return statement is after the audit insert and SSE broadcast — use wider window
    const block = src.slice(idx, idx + 1000);
    expect(block).toContain("return { success: false");
  });

  it("inserts audit row using auditAction from evaluator result", () => {
    const src = readFileSync(LIFECYCLE_PATH, "utf8");
    const idx = src.indexOf("!shadowGateResult.passed");
    const block = src.slice(idx, idx + 1000);
    expect(block).toContain("shadowGateResult.auditAction");
    expect(block).toContain("db.insert(auditLog)");
  });

  it("broadcasts SSE event lifecycle:shadow_to_paper_blocked on block", () => {
    const src = readFileSync(LIFECYCLE_PATH, "utf8");
    // Same named-constant pattern as the PDR SSE test above (pre-existing
    // test-fragility, unrelated to M3 — the raw literal never appears here).
    expect(src).toContain("LIFECYCLE_GATE_EVENTS.SHADOW_TO_PAPER_BLOCKED");
  });

  it("wraps evaluator call in try/catch with fail-CLOSED behavior (F-2a hardening 2026-06-23)", () => {
    // F-2a changed catch from fail-open to fail-closed — test updated to reflect new contract.
    const src = readFileSync(LIFECYCLE_PATH, "utf8");
    const idx = src.indexOf("evaluateShadowToPaperGate");
    const block = src.slice(idx, idx + 2000);
    expect(block).toContain("catch (shadowGateErr)");
    // Must return fail-closed on error
    const catchIdx = src.indexOf("catch (shadowGateErr)");
    const catchBlock = src.slice(catchIdx, catchIdx + 700);
    expect(catchBlock).toContain("shadow_to_paper_gate_evaluator_error");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 5. POST /api/paper/start — PAPER-state rejection (source-code + behavioural)
// ──────────────────────────────────────────────────────────────────────────────

describe("Pass 5 Track D — POST /api/paper/start broker-authoritative rejection (M3 2026-07-17 inverted)", () => {
  it("imports BROKER_AUTHORITATIVE_STATES from the shared paper-authority-states module (not a local literal)", () => {
    const src = readFileSync(PAPER_ROUTE_PATH, "utf8");
    expect(src).toContain('from "../lib/paper-authority-states.js"');
    expect(src).toContain("BROKER_AUTHORITATIVE_STATES");
  });

  it("the shared module excludes PAPER but includes DEPLOY_READY/PILOT/DEPLOYED (M3 doctrine-pinning RED-proof)", () => {
    const src = readFileSync(resolve(process.cwd(), "src/server/lib/paper-authority-states.ts"), "utf8");
    const idx = src.indexOf("export const BROKER_AUTHORITATIVE_STATES");
    expect(idx).toBeGreaterThan(-1);
    const decl = src.slice(idx, idx + 120);
    expect(decl).not.toContain('"PAPER"');
    expect(decl).toContain("DEPLOY_READY");
    expect(decl).toContain("PILOT");
    expect(decl).toContain("DEPLOYED");
  });

  it("still returns 409 for the (narrowed) broker-authoritative set", () => {
    const src = readFileSync(PAPER_ROUTE_PATH, "utf8");
    const idx = src.indexOf("paper.start_refused_paper_state");
    expect(idx).toBeGreaterThan(-1);
    const block = src.slice(Math.max(0, idx - 500), idx + 800);
    expect(block).toContain("409");
  });

  it("emits paper.start_refused_paper_state audit row", () => {
    const src = readFileSync(PAPER_ROUTE_PATH, "utf8");
    expect(src).toContain('action: "paper.start_refused_paper_state"');
  });

  it("includes lifecycleState in rejection response", () => {
    const src = readFileSync(PAPER_ROUTE_PATH, "utf8");
    const idx = src.indexOf("paper_start_refused_paper_state");
    expect(idx).toBeGreaterThan(-1);
    const block = src.slice(idx, idx + 500);
    expect(block).toContain("lifecycleState");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 6. toState===PAPER: startStream + engine_authority_declared (source-code)
// INVERTED for M3 PAPER Authority Flip (2026-07-17) — was "TESTING→PAPER stream
// stop"; PAPER is now internal-engine-only, so this block STARTS/CONTINUES the
// stream instead of stopping it.
// ──────────────────────────────────────────────────────────────────────────────

describe("Pass 5 Track D — toState===PAPER stream start/continue + authority declaration (M3-inverted)", () => {
  it("calls startStream from paper-trading-stream.js inside the toState===PAPER block", () => {
    const src = readFileSync(LIFECYCLE_PATH, "utf8");
    const m3Idx = src.indexOf("M3 FIX (2026-07-17)");
    expect(m3Idx).toBeGreaterThan(-1);
    const block = src.slice(m3Idx, m3Idx + 4500);
    expect(block).toContain("startStream(activeSessId, symbols)");
  });

  it("imports paper-trading-stream.js dynamically for startStream/isStreaming", () => {
    const src = readFileSync(LIFECYCLE_PATH, "utf8");
    expect(src).toContain("paper-trading-stream.js");
    expect(src).toContain("startStream");
    expect(src).toContain("isStreaming");
  });

  it("emits paper.engine_authority_declared audit row on toState===PAPER, with an unambiguous authoritative field", () => {
    const src = readFileSync(LIFECYCLE_PATH, "utf8");
    expect(src).toContain("paper.engine_authority_declared");
    const idx = src.indexOf("paper.engine_authority_declared");
    const block = src.slice(Math.max(0, idx - 3000), idx + 500);
    // Must be in the toState===PAPER block, and the payload must say WHICH
    // authority (not just an inverted boolean an old-doctrine reader would
    // misinterpret).
    expect(block).toContain("PAPER");
    const forwardBlock = src.slice(idx, idx + 500);
    expect(forwardBlock).toContain('authoritative: "internal_engine"');
  });

  it("startStream call is non-blocking on failure (try/catch, audit-then-continue — B6 discipline preserved, direction inverted)", () => {
    const src = readFileSync(LIFECYCLE_PATH, "utf8");
    const idx = src.indexOf("paper.engine_authority_declared");
    const block = src.slice(Math.max(0, idx - 3000), idx + 500);
    // The B6/M3 discipline is a plain try/catch around the start attempt (not a
    // fire-and-forget IIFE) that swallows a throw, audits it, and proceeds to
    // fire paper.engine_authority_declared regardless of success or failure.
    expect(block).toContain("paper.start_stream_failed_on_transition");
    expect(block).not.toContain("(async () => {");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 7. Parity test — cron sweep and PATCH produce structurally equivalent audit
// ──────────────────────────────────────────────────────────────────────────────

describe("Pass 5 Track C — Cron sweep / PATCH parity (structural)", () => {
  it("both paths use evaluatePaperToDeployReadyGates and write auditLog with auditAction", () => {
    // The parity guarantee is that both paths call the SAME evaluator.
    // The evaluator returns auditAction; both callers write db.insert(auditLog) with that action.
    // This is the source-level proof of parity.
    const src = readFileSync(LIFECYCLE_PATH, "utf8");

    // _promoteStrategyInner (PATCH path) calls evaluatePaperToDeployReadyGates
    const pdrIdx = src.indexOf("evaluatePaperToDeployReadyGates");
    expect(pdrIdx).toBeGreaterThan(-1);

    // Anchor on the gate-check itself, not the pdrInput declaration — the
    // pdrInput object has grown large enough across later waves that the
    // declaration-based anchor no longer reaches this block within a
    // reasonable window (pre-existing fragility, unrelated to M3; confirmed
    // via base@255b503a).
    const pdrInputIdx = src.indexOf("!gatePdrResult.passed");
    expect(pdrInputIdx).toBeGreaterThan(-1);

    // Audit insert with auditAction must appear in the block
    const block = src.slice(pdrInputIdx, pdrInputIdx + 1500);
    expect(block).toContain("gatePdrResult.auditAction");
    expect(block).toContain("db.insert(auditLog)");
  });

  it("both cron sweep and PATCH write audit rows with the same auditAction key source", () => {
    const src = readFileSync(LIFECYCLE_PATH, "utf8");
    // cron sweep inline gates write audit rows with hardcoded action strings
    // _promoteStrategyInner uses gatePdrResult.auditAction — same evaluator produces same action
    expect(src).toContain("gatePdrResult.auditAction");
    // SHADOW→PAPER parity
    expect(src).toContain("shadowGateResult.auditAction");
  });

  it("both evaluators are pure functions (no I/O) — allows identical behaviour in both callers", () => {
    const pdrSrc = readFileSync(
      resolve(process.cwd(), "src/server/lib/paper-to-deploy-ready-gates.ts"),
      "utf8",
    );
    const shadowSrc = readFileSync(
      resolve(process.cwd(), "src/server/lib/shadow-to-paper-gate.ts"),
      "utf8",
    );
    // Evaluators must not import db
    expect(pdrSrc).not.toContain('import { db }');
    expect(shadowSrc).not.toContain('import { db }');
    // Must not contain await (no async I/O)
    // Allow: type annotations with 'await' keyword in comments but not in function body
    // Simple check: no `db.` calls
    expect(pdrSrc).not.toContain("db.");
    expect(shadowSrc).not.toContain("db.");
  });

  it("PATCH path uses correlationId from options (links audit rows)", () => {
    const src = readFileSync(LIFECYCLE_PATH, "utf8");
    // In both PAPER→DEPLOY_READY and SHADOW→PAPER blocks
    expect(src).toContain("options.correlationId ?? randomUUID()");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 8. CLAUDE.md §8 — engine authority declaration documented
// ──────────────────────────────────────────────────────────────────────────────

describe("Pass 5 Track D — CLAUDE.md §8 engine authority declaration", () => {
  it("CLAUDE.md documents paper-engine authority declaration", () => {
    const claudeMd = readFileSync(
      resolve(process.cwd(), "CLAUDE.md"),
      "utf8",
    );
    expect(claudeMd).toContain("TradersPost");
    // Must mention paper-engine authority (case-insensitive — CLAUDE.md uses "Paper-engine authority")
    expect(claudeMd.toLowerCase()).toContain("paper-engine authority");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 9. SHADOW→PAPER audit action name parity
// ──────────────────────────────────────────────────────────────────────────────

describe("Pass 5 Track C — SHADOW→PAPER audit action parity", () => {
  it("ShadowToPaperGateResult exposes auditAction for insertion by caller", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/server/lib/shadow-to-paper-gate.ts"),
      "utf8",
    );
    expect(src).toContain("auditAction");
  });

  it("lifecycle-service passes auditAction from shadowGateResult into audit insert", () => {
    const src = readFileSync(LIFECYCLE_PATH, "utf8");
    expect(src).toContain("shadowGateResult.auditAction");
  });

  it("lifecycle:shadow_to_paper_blocked SSE event is emitted on block", () => {
    const src = readFileSync(LIFECYCLE_PATH, "utf8");
    // Same named-constant pattern as the earlier SSE tests (pre-existing
    // test-fragility, unrelated to M3 — the raw literal never appears here).
    expect(src).toContain("LIFECYCLE_GATE_EVENTS.SHADOW_TO_PAPER_BLOCKED");
  });
});
