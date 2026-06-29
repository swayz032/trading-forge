/**
 * quantum-replay-runner circuit breaker — cooldown auto-reset parity.
 *
 * Brings the MC/replay breaker to parity with quantum-rl-training-runner: the
 * breaker now self-heals after a cooldown (was: stuck-open until manual SQL),
 * audits its recovery (`quantum_replay.circuit_breaker_closed`), and the Discord
 * alert carries the reset SQL. These are operational/vacation-safety guarantees,
 * so the wiring is asserted at the source-contract level (the time-based reset
 * itself is exercised behaviorally by the shared pattern in the RL runner tests).
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, it, expect } from "vitest";

const SRC = readFileSync(
  resolve(process.cwd(), "src/server/lib/quantum-replay-runner.ts"),
  "utf8",
);

describe("quantum-replay-runner — circuit breaker cooldown auto-reset (parity with RL breaker)", () => {
  it("reads QUANTUM_REPLAY_CIRCUIT_BREAKER_COOLDOWN_MS with a 1h default", () => {
    expect(SRC).toContain("QUANTUM_REPLAY_CIRCUIT_BREAKER_COOLDOWN_MS");
    expect(SRC).toContain("3600000"); // 1 hour default, floored at 60_000
    expect(SRC).toMatch(/Math\.max\(\s*60_000/);
  });

  it("has a _isCircuitOpen() helper that auto-resets after cooldown and reports justReset", () => {
    expect(SRC).toContain("function _isCircuitOpen()");
    expect(SRC).toContain("justReset");
    // self-reset path clears state when the cooldown has elapsed
    expect(SRC).toMatch(/Date\.now\(\)\s*-\s*_circuitOpenedAt\s*>=\s*_circuitBreakerCooldownMs/);
  });

  it("stamps and persists the open timestamp so cooldown survives a restart", () => {
    expect(SRC).toContain("_circuitOpenedAt = Date.now()");
    expect(SRC).toContain("quantum_replay_circuit_opened_at");
  });

  it("emits a quantum_replay.circuit_breaker_closed recovery audit on auto-reset", () => {
    expect(SRC).toContain("quantum_replay.circuit_breaker_closed");
    expect(SRC).toContain("cooldown_expired");
  });

  it("includes the manual-reset SQL + self-reset note in the OPEN Discord alert", () => {
    expect(SRC).toContain("quantum_replay_circuit_open");
    expect(SRC).toMatch(/self-resets automatically|auto-resume|auto-resumes/i);
    expect(SRC).toContain("UPDATE system_parameters SET current_value='0'");
  });

  it("clears the open timestamp on success and on the test reset", () => {
    // _recordSuccess and _resetCircuitBreakerForTests both null the timestamp
    const successClears = /_recordSuccess[\s\S]{0,200}_circuitOpenedAt = null/.test(SRC);
    const testResetClears = /_resetCircuitBreakerForTests[\s\S]{0,200}_circuitOpenedAt = null/.test(SRC);
    expect(successClears).toBe(true);
    expect(testResetClears).toBe(true);
  });
});
