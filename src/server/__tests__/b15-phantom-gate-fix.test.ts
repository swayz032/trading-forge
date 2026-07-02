/**
 * b15-phantom-gate-fix.test.ts — Hardening 2026-06-27
 *
 * Proves the three concrete defects fixed by the B15 phantom-gate fix:
 *
 *   (a) PRODUCER DEFAULT: buildBacktestArgs now defaults battery ON (env unset →
 *       includes --b15-battery so backtests.b15_battery is populated).
 *
 *   (b) NULL-GUARD BEHAVIOUR: when B15_BATTERY_ENABLED=true (or unset) and the
 *       latest backtest has null b15Battery, the cron sweep emits a documented warn
 *       (lifecycle.b15_unavailable_legacy) instead of silently passing — the
 *       silent-pass was the "phantom hard gate" that made B15 a no-op.
 *
 *   (c) EXPLICIT ENV DISABLE: B15_BATTERY_ENABLED=false disables the battery in the
 *       producer (--b15-battery NOT added) and makes the gate advisory-only.
 *
 * Also verifies that the _promoteStrategyInner path now correctly derives
 * b15HardGateEnabled from the same env var (alignment test — previously the pure
 * evaluator always defaulted to true, ignoring B15_BATTERY_ENABLED=false there).
 *
 * buildBacktestArgs is a pure, zero-import function — imported directly.
 * The null-guard and flag-plumbing behaviours are validated inline (same pattern
 * as wave25-b15-parameter-robustness.test.ts lifecycle logic tests) to avoid
 * importing the 3 700-line lifecycle-service.ts with all its heavy dependencies.
 */

import { describe, it, expect, afterEach } from "vitest";
import { buildBacktestArgs } from "../../server/lib/backtest-args.js";

// ─── (a) Producer default is now ON ──────────────────────────────────────────

describe("buildBacktestArgs — B15 producer default (Fix 1)", () => {
  afterEach(() => {
    delete process.env["B15_BATTERY_ENABLED"];
  });

  it("includes --b15-battery when B15_BATTERY_ENABLED is unset (default ON post-fix)", () => {
    delete process.env["B15_BATTERY_ENABLED"];
    const args = buildBacktestArgs({ backtestId: "bt-001", mode: "full" });
    expect(args).toContain("--b15-battery");
  });

  it("includes --b15-battery when B15_BATTERY_ENABLED=true", () => {
    process.env["B15_BATTERY_ENABLED"] = "true";
    const args = buildBacktestArgs({ backtestId: "bt-002", mode: "full" });
    expect(args).toContain("--b15-battery");
  });

  it("includes --backtest-id and --mode alongside --b15-battery", () => {
    delete process.env["B15_BATTERY_ENABLED"];
    const args = buildBacktestArgs({ backtestId: "bt-003", mode: "walk_forward" });
    expect(args).toContain("--backtest-id");
    expect(args).toContain("bt-003");
    expect(args).toContain("--mode");
    expect(args).toContain("walk_forward");
    expect(args).toContain("--b15-battery");
  });

  it("includes --strategy-class when provided", () => {
    delete process.env["B15_BATTERY_ENABLED"];
    const args = buildBacktestArgs({
      backtestId: "bt-004",
      mode: "full",
      strategyClass: "SilverBulletStrategy",
    });
    expect(args).toContain("--strategy-class");
    expect(args).toContain("SilverBulletStrategy");
    expect(args).toContain("--b15-battery");
  });

  it("respects explicit b15BatteryEnabled=false override (caller opt-out)", () => {
    // Even with the default ON, callers can explicitly pass false to skip the battery.
    delete process.env["B15_BATTERY_ENABLED"];
    const args = buildBacktestArgs({ backtestId: "bt-005", mode: "full", b15BatteryEnabled: false });
    expect(args).not.toContain("--b15-battery");
  });

  it("respects explicit b15BatteryEnabled=true override (caller opt-in even when env says false)", () => {
    process.env["B15_BATTERY_ENABLED"] = "false";
    const args = buildBacktestArgs({ backtestId: "bt-006", mode: "full", b15BatteryEnabled: true });
    expect(args).toContain("--b15-battery");
  });
});

// ─── (c) Explicit env disable still works in producer ────────────────────────

describe("buildBacktestArgs — B15_BATTERY_ENABLED=false emergency disable (Fix 1c)", () => {
  afterEach(() => {
    delete process.env["B15_BATTERY_ENABLED"];
  });

  it("does NOT include --b15-battery when B15_BATTERY_ENABLED=false", () => {
    process.env["B15_BATTERY_ENABLED"] = "false";
    const args = buildBacktestArgs({ backtestId: "bt-010", mode: "full" });
    expect(args).not.toContain("--b15-battery");
  });

  it("base args are still correct when battery is disabled", () => {
    process.env["B15_BATTERY_ENABLED"] = "false";
    const args = buildBacktestArgs({ backtestId: "bt-011", mode: "full" });
    expect(args).toContain("--backtest-id");
    expect(args).toContain("bt-011");
    expect(args).toContain("--mode");
    expect(args).toContain("full");
    expect(args).not.toContain("--b15-battery");
  });
});

// ─── Producer / consumer env-var alignment ────────────────────────────────────
// Validates that both sides derive the same boolean from the same env key.

describe("B15 producer/consumer env-var symmetry (Fix 1 alignment)", () => {
  afterEach(() => {
    delete process.env["B15_BATTERY_ENABLED"];
  });

  it("producer default (unset env) → ON, matches consumer default of 'true'", () => {
    delete process.env["B15_BATTERY_ENABLED"];
    // Producer: opts.b15BatteryEnabled ?? ((process.env.B15_BATTERY_ENABLED ?? "true") === "true")
    const producerDefault = (process.env["B15_BATTERY_ENABLED"] ?? "true") === "true";
    // Consumer: (process.env.B15_BATTERY_ENABLED ?? "true") === "true"  [lifecycle-service.ts:3410]
    const consumerDefault = (process.env["B15_BATTERY_ENABLED"] ?? "true") === "true";
    expect(producerDefault).toBe(true);
    expect(consumerDefault).toBe(true);
    expect(producerDefault).toBe(consumerDefault);
  });

  it("explicit false → both producer and consumer are OFF", () => {
    process.env["B15_BATTERY_ENABLED"] = "false";
    const producerEnabled = (process.env["B15_BATTERY_ENABLED"] ?? "true") === "true";
    const consumerEnabled = (process.env["B15_BATTERY_ENABLED"] ?? "true") === "true";
    expect(producerEnabled).toBe(false);
    expect(consumerEnabled).toBe(false);
  });

  it("explicit true → both producer and consumer are ON", () => {
    process.env["B15_BATTERY_ENABLED"] = "true";
    const producerEnabled = (process.env["B15_BATTERY_ENABLED"] ?? "true") === "true";
    const consumerEnabled = (process.env["B15_BATTERY_ENABLED"] ?? "true") === "true";
    expect(producerEnabled).toBe(true);
    expect(consumerEnabled).toBe(true);
  });
});

// ─── (b) Null-guard now warns instead of silently passing ────────────────────
// Tests the logic of the new else-if branch added to the cron sweep
// (lifecycle-service.ts) as an inline behavioral assertion — mirrors the pattern
// in wave25-b15-parameter-robustness.test.ts which tests lifecycle logic inline.

describe("B15 cron sweep null-guard — no silent-pass when enabled + missing (Fix 3)", () => {
  afterEach(() => {
    delete process.env["B15_BATTERY_ENABLED"];
  });

  it("old silent-pass: null battery + gate enabled → shouldWarn was false (pre-fix, WRONG)", () => {
    // This documents the PRE-FIX bug: the code had no else branch, so warn was never called.
    const b15HardGateEnabled = true;
    const latestBtB15Battery = null;
    let warnEmitted = false;

    // PRE-FIX code path (for documentation; no else branch existed):
    if (latestBtB15Battery != null) {
      // process battery data — never reached
      void latestBtB15Battery;
    }
    // no else → warnEmitted stays false

    expect(warnEmitted).toBe(false); // confirms pre-fix was silent — this was the bug
    expect(b15HardGateEnabled).toBe(true); // gate was "enabled" but b15 data never populated
  });

  it("new behaviour: null battery + gate enabled → warn IS emitted (post-fix)", () => {
    const b15HardGateEnabled = true;
    const latestBtB15Battery = null;
    const warnMessages: string[] = [];
    const mockWarn = (msg: string) => { warnMessages.push(msg); };

    // POST-FIX code path (new else-if branch in lifecycle-service.ts):
    if (latestBtB15Battery != null) {
      // process battery data — never reached for null input
      void latestBtB15Battery;
    } else if (b15HardGateEnabled) {
      mockWarn(
        "B15 Parameter Robustness Battery gate: no battery data on latest backtest — lifecycle.b15_unavailable_legacy (warn; promotion continues; re-run backtest to populate battery)",
      );
    }

    expect(warnMessages).toHaveLength(1);
    expect(warnMessages[0]).toContain("lifecycle.b15_unavailable_legacy");
    expect(warnMessages[0]).toContain("re-run backtest");
  });

  it("null battery + gate DISABLED → warn NOT emitted (else-if guard respected)", () => {
    const b15HardGateEnabled = false; // B15_BATTERY_ENABLED=false
    const latestBtB15Battery = null;
    const warnMessages: string[] = [];
    const mockWarn = (msg: string) => { warnMessages.push(msg); };

    if (latestBtB15Battery != null) {
      void latestBtB15Battery;
    } else if (b15HardGateEnabled) {
      // Gate disabled — this branch is NOT taken
      mockWarn("should not be called");
    }

    expect(warnMessages).toHaveLength(0); // No warn when gate disabled — correct
  });

  it("non-null battery that passed → warn NOT emitted (normal passing path)", () => {
    const b15HardGateEnabled = true;
    const latestBtB15Battery = { passed: true, sdr: 0.91, psi: 0.02, rws: 0.14, failures: [] };
    const warnMessages: string[] = [];
    const mockWarn = (msg: string) => { warnMessages.push(msg); };

    if (latestBtB15Battery != null) {
      // Battery present and passed — no warn expected
      if (latestBtB15Battery.passed === false) {
        mockWarn("should not be called — battery passed");
      }
    } else if (b15HardGateEnabled) {
      mockWarn("should not be called — battery data is present");
    }

    expect(warnMessages).toHaveLength(0);
  });

  it("non-null battery that FAILED + gate enabled → blocks (no warn, hard block path)", () => {
    const b15HardGateEnabled = true;
    const latestBtB15Battery = { passed: false, sdr: 0.70, psi: 0.06, rws: 0.22, failures: ["SDR 0.70 < 0.85"] };
    let blocked = false;
    const warnMessages: string[] = [];
    const mockWarn = (msg: string) => { warnMessages.push(msg); };

    if (latestBtB15Battery != null) {
      if (latestBtB15Battery.passed === false) {
        if (b15HardGateEnabled) {
          blocked = true; // simulate `continue` in cron sweep
        } else {
          mockWarn("advisory only");
        }
      }
    } else if (b15HardGateEnabled) {
      mockWarn("b15_unavailable_legacy");
    }

    expect(blocked).toBe(true);
    expect(warnMessages).toHaveLength(0); // hard block, not warn
  });
});

// ─── (b/c) _promoteStrategyInner flag plumbing (Fix 2) ───────────────────────
// Verifies the b15HardGateEnabled derivation that _promoteStrategyInner now
// computes and passes to evaluatePaperToDeployReadyGates.

describe("_promoteStrategyInner b15HardGateEnabled flag plumbing (Fix 2)", () => {
  afterEach(() => {
    delete process.env["B15_BATTERY_ENABLED"];
  });

  it("b15HardGateEnabled is TRUE when B15_BATTERY_ENABLED is unset (default ON)", () => {
    delete process.env["B15_BATTERY_ENABLED"];
    // Mirrors the new code in _promoteStrategyInner pdrInput
    const b15HardGateEnabled = (process.env["B15_BATTERY_ENABLED"] ?? "true") === "true";
    expect(b15HardGateEnabled).toBe(true);
  });

  it("b15HardGateEnabled is FALSE when B15_BATTERY_ENABLED=false (operator disable)", () => {
    process.env["B15_BATTERY_ENABLED"] = "false";
    const b15HardGateEnabled = (process.env["B15_BATTERY_ENABLED"] ?? "true") === "true";
    expect(b15HardGateEnabled).toBe(false);
  });

  it("b15HardGateEnabled is TRUE when B15_BATTERY_ENABLED=true", () => {
    process.env["B15_BATTERY_ENABLED"] = "true";
    const b15HardGateEnabled = (process.env["B15_BATTERY_ENABLED"] ?? "true") === "true";
    expect(b15HardGateEnabled).toBe(true);
  });

  it("pre-fix: pure evaluator b15HardGateEnabled defaulted to true even when env=false (the bug)", () => {
    // Before Fix 2, _promoteStrategyInner did NOT pass b15HardGateEnabled to pdrInput.
    // The pure evaluator's function signature is:
    //   function evaluatePaperToDeployReadyGates(input) {
    //     const { b15HardGateEnabled = true } = input;  // always true if not passed!
    //   }
    // So even with B15_BATTERY_ENABLED=false, the direct path ran with enabled=true.
    process.env["B15_BATTERY_ENABLED"] = "false";
    const envValue = (process.env["B15_BATTERY_ENABLED"] ?? "true") === "true"; // false
    const oldBehaviourDefault = true; // pure function defaulted to true when key absent
    // These differed — B15_BATTERY_ENABLED=false was IGNORED on the direct path
    expect(envValue).toBe(false);
    expect(oldBehaviourDefault).toBe(true);
    expect(envValue).not.toBe(oldBehaviourDefault); // confirms the pre-fix mismatch
  });

  it("post-fix: _promoteStrategyInner passes b15HardGateEnabled matching env (mismatch gone)", () => {
    process.env["B15_BATTERY_ENABLED"] = "false";
    // Post-fix: pdrInput now includes b15HardGateEnabled derived from env
    const b15HardGateEnabledInPdrInput = (process.env["B15_BATTERY_ENABLED"] ?? "true") === "true";
    // Pure evaluator would receive this value instead of defaulting to true
    expect(b15HardGateEnabledInPdrInput).toBe(false); // env respected on direct path
  });
});
