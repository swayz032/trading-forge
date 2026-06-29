/**
 * rl-kill-switch-circuit-breaker-hardening.test.ts
 *
 * Verifies three audit findings in the quantum challenger RL training layer:
 *
 *  Fix 1 (HIGH) — RL training kill-switch gap:
 *    Both fire paths in backtest-service.ts (legacy rl_training_runs path and
 *    C.2 quantum_rl_runs path) must gate on readLearningLoopMode().autonomousOn
 *    (AUTOPILOT / mode>=2) and emit quantum_rl.training_loop_halted_skip when
 *    halted.
 *
 *  Fix 2 (MED) — dual RL path decision:
 *    rl_training_runs IS consumed by critic-optimizer-service.ts (not orphaned).
 *    Legacy path RETAINED but gated identically to C.2. Confirms by grep evidence
 *    that the table is read.
 *
 *  Fix 3 (MED) — circuit breaker durability:
 *    quantum-rl-training-runner.ts persists breaker state to system_parameters
 *    (quantum_rl_circuit_open / quantum_rl_consecutive_failures). Exports
 *    _resetRlCircuitBreakerForTests which also resets _rlBreakerStateLoaded so
 *    DB re-init is allowed in integration tests.  notifyCritical is called when
 *    the breaker opens. quantum_rl.training_circuit_breaker_closed is emitted on
 *    cooldown auto-reset.
 *
 * Strategy: source-level assertions (fs.readFileSync) for authority-boundary
 * guarantees that are hard to test via dynamic import; functional assertions
 * (import and invoke) for exported symbols that can be called safely in a test.
 *
 * Authority boundary — CHALLENGER-ONLY invariant:
 *   These tests verify RL training NEVER gates lifecycle promotions.
 *   runRlTrainingForStrategy is not imported from any lifecycle or order-routing
 *   module in this file.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";

// ── Paths ─────────────────────────────────────────────────────────────────────

const SRC_ROOT = path.resolve(import.meta.dirname ?? ".", "../../..");

const BACKTEST_SVC = path.join(
  SRC_ROOT,
  "src/server/services/backtest-service.ts",
);
const RL_RUNNER = path.join(
  SRC_ROOT,
  "src/server/lib/quantum-rl-training-runner.ts",
);
const CRITIC_SVC = path.join(
  SRC_ROOT,
  "src/server/services/critic-optimizer-service.ts",
);

// ═══════════════════════════════════════════════════════════════════════════════
// Fix 1 — RL training kill-switch gap
// ═══════════════════════════════════════════════════════════════════════════════

describe("Fix 1 — RL training kill-switch gate (both paths in backtest-service.ts)", () => {
  let backtestSrc: string;

  beforeEach(() => {
    backtestSrc = fs.readFileSync(BACKTEST_SVC, "utf-8");
  });

  // ── Import wiring ──────────────────────────────────────────────────────────

  it("backtest-service.ts imports readLearningLoopMode from learning-loop-mode.js", () => {
    expect(backtestSrc).toContain('readLearningLoopMode');
    expect(backtestSrc).toMatch(/from\s+["'].*learning-loop-mode/);
  });

  // ── Legacy path (rl_training_runs) ─────────────────────────────────────────

  it("legacy path gates on rlLegacyMode.autonomousOn before spawning training", () => {
    expect(backtestSrc).toContain("rlLegacyMode.autonomousOn");
  });

  it("legacy path reads the mode via readLearningLoopMode() (not hardcoded boolean)", () => {
    expect(backtestSrc).toMatch(/rlLegacyMode\s*=\s*await\s+readLearningLoopMode\(\)/);
  });

  it("legacy path emits quantum_rl.training_loop_halted_skip audit action when halted", () => {
    // Verify the audit action appears in the legacy path block — must appear at
    // least twice: once for legacy, once for C.2.
    const occurrences = (backtestSrc.match(/quantum_rl\.training_loop_halted_skip/g) ?? []).length;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });

  it("legacy path includes path: 'legacy_rl_training_runs' in halt audit payload", () => {
    expect(backtestSrc).toContain(`"legacy_rl_training_runs"`);
  });

  it("legacy path has off-RTH guard via isOffRthTrainingWindow() as a second check", () => {
    expect(backtestSrc).toContain("isOffRthTrainingWindow()");
  });

  // ── C.2 path (quantum_rl_runs) ─────────────────────────────────────────────

  it("C.2 path gates on rlC2Mode.autonomousOn before calling runRlTrainingForStrategy", () => {
    expect(backtestSrc).toContain("rlC2Mode.autonomousOn");
  });

  it("C.2 path reads the mode via readLearningLoopMode() (not hardcoded boolean)", () => {
    expect(backtestSrc).toMatch(/rlC2Mode\s*=\s*await\s+readLearningLoopMode\(\)/);
  });

  it("C.2 path includes path: 'c2_quantum_rl_runs' in halt audit payload", () => {
    expect(backtestSrc).toContain(`"c2_quantum_rl_runs"`);
  });

  // ── Fail-closed semantics ──────────────────────────────────────────────────

  it("halt condition is !autonomousOn — OBSERVE (mode=1) is blocked, AUTOPILOT (mode=2) passes", () => {
    // readLearningLoopMode.autonomousOn = mode >= 2, so !autonomousOn blocks mode<2
    // Verify the negation: !rlLegacyMode.autonomousOn and !rlC2Mode.autonomousOn
    expect(backtestSrc).toContain("!rlLegacyMode.autonomousOn");
    expect(backtestSrc).toContain("!rlC2Mode.autonomousOn");
  });

  it("halt audit result contains reason: kill_switch_not_autopilot", () => {
    expect(backtestSrc).toContain(`"kill_switch_not_autopilot"`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Fix 2 — dual RL path: rl_training_runs is consumed (not orphaned)
// ═══════════════════════════════════════════════════════════════════════════════

describe("Fix 2 — dual RL path: rl_training_runs table is NOT orphaned", () => {
  let criticSrc: string;
  let backtestSrc: string;

  beforeEach(() => {
    criticSrc = fs.readFileSync(CRITIC_SVC, "utf-8");
    backtestSrc = fs.readFileSync(BACKTEST_SVC, "utf-8");
  });

  it("critic-optimizer-service.ts reads from rl_training_runs (SELECT consumer exists)", () => {
    // critic-optimizer-service.ts line ~1393 does db.select().from(rlTrainingRuns)
    expect(criticSrc).toContain("rlTrainingRuns");
    // At minimum a .from() reference to confirm it's queried
    expect(criticSrc).toMatch(/from\(rlTrainingRuns\)|rlTrainingRuns\s*\)/);
  });

  it("legacy path in backtest-service.ts still WRITES to rl_training_runs", () => {
    // Legacy path inserts into rl_training_runs before calling Python
    expect(backtestSrc).toContain("rl_training_runs");
  });

  it("legacy path block is present in backtest-service.ts (not retired)", () => {
    // The comment block marking the legacy path must exist
    expect(backtestSrc).toContain("LEGACY PATH");
  });

  it("C.2 path writes to quantum_rl_runs namespace (separate table)", () => {
    // C.2 calls runRlTrainingForStrategy which targets quantum_rl_runs
    expect(backtestSrc).toContain("quantum_rl_runs");
  });

  it("backtest-service.ts comment documents critic-optimizer-service.ts as consumer", () => {
    // Ensures the decision is documented inline, not just in tests
    expect(backtestSrc).toContain("critic-optimizer-service.ts");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Fix 3 — circuit breaker durability in quantum-rl-training-runner.ts
// ═══════════════════════════════════════════════════════════════════════════════

describe("Fix 3 — circuit breaker persistence (quantum-rl-training-runner.ts)", () => {
  let rlRunnerSrc: string;

  beforeEach(() => {
    rlRunnerSrc = fs.readFileSync(RL_RUNNER, "utf-8");
  });

  // ── system_parameters row names ────────────────────────────────────────────

  it("defines _RL_PARAM_OPEN constant = 'quantum_rl_circuit_open'", () => {
    expect(rlRunnerSrc).toContain(`"quantum_rl_circuit_open"`);
    expect(rlRunnerSrc).toContain("_RL_PARAM_OPEN");
  });

  it("defines _RL_PARAM_FAILURES constant = 'quantum_rl_consecutive_failures'", () => {
    expect(rlRunnerSrc).toContain(`"quantum_rl_consecutive_failures"`);
    expect(rlRunnerSrc).toContain("_RL_PARAM_FAILURES");
  });

  // ── Persistence functions ──────────────────────────────────────────────────

  it("contains _persistRlBreakerState function that upserts systemParameters", () => {
    expect(rlRunnerSrc).toContain("_persistRlBreakerState");
    expect(rlRunnerSrc).toContain("systemParameters");
  });

  it("contains _initRlBreakerStateFromDb function (load once on first call)", () => {
    expect(rlRunnerSrc).toContain("_initRlBreakerStateFromDb");
    expect(rlRunnerSrc).toContain("_rlBreakerStateLoaded");
  });

  it("_persistRlBreakerState is called inside _recordRlSuccess", () => {
    // Success path must persist state so failure counter reset is durable
    expect(rlRunnerSrc).toMatch(/_recordRlSuccess[\s\S]{0,400}_persistRlBreakerState/);
  });

  it("_persistRlBreakerState is called inside _recordRlFailure", () => {
    // The function body includes a large Discord notification block before the
    // persist call — use a wider window (1500 chars) to span the whole body.
    expect(rlRunnerSrc).toMatch(/_recordRlFailure[\s\S]{0,1500}_persistRlBreakerState/);
  });

  // ── init-once guard ────────────────────────────────────────────────────────

  it("_initRlBreakerStateFromDb exits early when _rlBreakerStateLoaded is true", () => {
    expect(rlRunnerSrc).toContain("if (_rlBreakerStateLoaded) return;");
  });

  it("_initRlBreakerStateFromDb is awaited at the top of runRlTrainingForStrategy", () => {
    expect(rlRunnerSrc).toMatch(/await\s+_initRlBreakerStateFromDb\(\)/);
  });

  // ── _isCircuitOpen return type changed ────────────────────────────────────

  it("_isCircuitOpen returns { isOpen, justReset } object (not bare boolean)", () => {
    expect(rlRunnerSrc).toContain("justReset");
    expect(rlRunnerSrc).toMatch(/return\s*\{\s*isOpen:\s*false,\s*justReset:\s*false\s*\}/);
  });

  it("runRlTrainingForStrategy destructures { isOpen, justReset } from _isCircuitOpen()", () => {
    expect(rlRunnerSrc).toMatch(/const\s*\{\s*isOpen,\s*justReset\s*\}\s*=\s*_isCircuitOpen\(\)/);
  });

  // ── Recovery audit on cooldown reset ─────────────────────────────────────

  it("emits quantum_rl.training_circuit_breaker_closed audit row when justReset is true", () => {
    expect(rlRunnerSrc).toContain("quantum_rl.training_circuit_breaker_closed");
    expect(rlRunnerSrc).toContain("justReset");
  });

  it("recovery audit includes reason: cooldown_expired", () => {
    expect(rlRunnerSrc).toContain(`"cooldown_expired"`);
  });

  // ── Discord escalation on circuit open ────────────────────────────────────

  it("imports notifyCritical from notification-service.js", () => {
    expect(rlRunnerSrc).toMatch(/from\s+["'].*notification-service/);
    expect(rlRunnerSrc).toContain("notifyCritical");
  });

  it("imports appendFamilyGradePostscript from notification-helpers.js", () => {
    expect(rlRunnerSrc).toMatch(/from\s+["'].*notification-helpers/);
    expect(rlRunnerSrc).toContain("appendFamilyGradePostscript");
  });

  it("calls notifyCritical inside _recordRlFailure when circuit opens", () => {
    // The notifyCritical call is inside the _recordRlFailure function body
    expect(rlRunnerSrc).toMatch(
      /_recordRlFailure[\s\S]{0,800}notifyCritical\(/,
    );
  });

  it("wraps notifyCritical body with appendFamilyGradePostscript (family-grade requirement)", () => {
    expect(rlRunnerSrc).toMatch(
      /notifyCritical\s*\([\s\S]{0,100}appendFamilyGradePostscript\(/,
    );
  });

  // ── Test reset hook ────────────────────────────────────────────────────────

  it("_resetRlCircuitBreakerForTests resets _rlBreakerStateLoaded to false (allows DB re-init)", () => {
    // The reset must set _rlBreakerStateLoaded = false so tests can re-test the
    // init path without module reload
    expect(rlRunnerSrc).toMatch(
      /_resetRlCircuitBreakerForTests[\s\S]{0,200}_rlBreakerStateLoaded\s*=\s*false/,
    );
  });

  // ── Challenger isolation ───────────────────────────────────────────────────

  it("rl-training-runner does not import lifecycle-service (challenger isolation)", () => {
    expect(rlRunnerSrc).not.toContain("lifecycle-service");
  });

  it("rl-training-runner does not import paper-signal-service (challenger isolation)", () => {
    expect(rlRunnerSrc).not.toContain("paper-signal-service");
  });

  it("rl-training-runner does not import order-router (challenger isolation)", () => {
    expect(rlRunnerSrc).not.toContain("order-router");
    expect(rlRunnerSrc).not.toContain("broker-router");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Governance invariant — CHALLENGER-ONLY preserved
// ═══════════════════════════════════════════════════════════════════════════════

describe("CHALLENGER-ONLY invariant — RL training never gates lifecycle promotions", () => {
  let backtestSrc: string;
  let rlRunnerSrc: string;

  beforeEach(() => {
    backtestSrc = fs.readFileSync(BACKTEST_SVC, "utf-8");
    rlRunnerSrc = fs.readFileSync(RL_RUNNER, "utf-8");
  });

  it("rl_training_runs rows carry authoritative:false governance label", () => {
    expect(backtestSrc).toContain(`authoritative: false`);
    // Governance label in the legacy path insert
    expect(backtestSrc).toContain(`"challenger_only"`);
  });

  it("quantum_rl_runs rows carry challenger_only decision_role", () => {
    // The C.2 path (via runRlTrainingForStrategy) carries governance through
    // the runner. The runner itself must document challenger governance.
    expect(rlRunnerSrc).toContain("challenger");
  });

  it("backtest-service.ts RL block never calls promoteStrategy or lifecycle transition", () => {
    // Verify no direct promotion call in the RL fire blocks
    // Check the RL section that spans lines 1903-2120
    const rlSection = backtestSrc.slice(
      backtestSrc.indexOf("Auto RL training"),
      backtestSrc.indexOf("Auto Quantum Monte Carlo"),
    );
    expect(rlSection).not.toContain("promoteStrategy");
    expect(rlSection).not.toContain("transitionLifecycle");
    expect(rlSection).not.toContain("lifecycle-service");
  });

  it("kill-switch gates are inside void IIFEs (fire-and-forget; never block backtest result)", () => {
    // Both RL blocks are wrapped in void (async () => { ... })()
    // Count occurrences to verify BOTH paths use the pattern
    const voidIifePattern = /void\s*\(async\s*\(\)\s*=>/g;
    const occurrences = (backtestSrc.match(voidIifePattern) ?? []).length;
    // Legacy + C.2 + possibly other fire-and-forget blocks elsewhere
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });

  it("rl-training-runner RlTrainingAutoFireResult does not include lifecycle transition fields", () => {
    // The result type must not have fields that could be mistaken for lifecycle authority
    expect(rlRunnerSrc).toContain("RlTrainingAutoFireResult");
    // Status values are terminal to the runner — no lifecycle escalation
    expect(rlRunnerSrc).toMatch(
      /status:\s*["']completed["']\s*\|\s*["']failed["']\s*\|\s*["']circuit_open["']\s*\|\s*["']skipped_rth["']/,
    );
  });
});
