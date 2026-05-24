/**
 * parse-truthiness-sentinel.test.ts
 *
 * Unit tests for parseTruthinessSentinel() in python-runner.ts.
 * Kept in a separate file from backtest-truthiness-emit.test.ts because
 * that file mocks python-runner.js globally (required for backtest-service
 * integration tests), which would intercept the real function here.
 */

import { describe, it, expect } from "vitest";
import { parseTruthinessSentinel, B15_BATTERY_SENTINEL } from "../lib/python-runner.js";

describe("parseTruthinessSentinel", () => {
  it("parses PARITY_SHADOW_DRIFT_JSON sentinel line", () => {
    const payload = { passed: false, pnl_diff_pct: 1.5, vbt_total_pnl: 10000, bt_total_pnl: 4000 };
    const line = `PARITY_SHADOW_DRIFT_JSON ${JSON.stringify(payload)}`;
    const result = parseTruthinessSentinel(line);

    expect(result).not.toBeNull();
    expect(result!.type).toBe("parity_shadow_drift");
    expect(result!.payload.passed).toBe(false);
    expect(result!.payload.pnl_diff_pct).toBe(1.5);
  });

  it("parses INVARIANT_FAILURE_JSON sentinel line", () => {
    const payload = { overall_passed: false, critical_failures: ["ending_balance_mismatch"], warnings: [] };
    const line = `INVARIANT_FAILURE_JSON ${JSON.stringify(payload)}`;
    const result = parseTruthinessSentinel(line);

    expect(result).not.toBeNull();
    expect(result!.type).toBe("invariant_failure");
    expect(result!.payload.overall_passed).toBe(false);
    expect(Array.isArray(result!.payload.critical_failures)).toBe(true);
  });

  it("returns null for non-sentinel lines", () => {
    expect(parseTruthinessSentinel("normal python log output")).toBeNull();
    expect(parseTruthinessSentinel("WARNING: something happened")).toBeNull();
    expect(parseTruthinessSentinel("")).toBeNull();
  });

  it("returns null and does not throw on malformed JSON", () => {
    const line = "PARITY_SHADOW_DRIFT_JSON {bad json{{";
    expect(() => parseTruthinessSentinel(line)).not.toThrow();
    expect(parseTruthinessSentinel(line)).toBeNull();
  });

  it("requires exact prefix match — prefix in middle of line is not matched", () => {
    const line = "some prefix PARITY_SHADOW_DRIFT_JSON {}";
    expect(parseTruthinessSentinel(line)).toBeNull();
  });

  it("parses complex nested payload correctly", () => {
    const payload = {
      overall_passed: false,
      passed: false,
      failed: ["ending_balance_mismatch", "total_return_drift"],
      critical_failures: ["ending_balance_mismatch"],
      warnings: ["total_return_drift"],
      details: { ending_balance: 56928, expected: 48100, diff: 8827 },
    };
    const line = `INVARIANT_FAILURE_JSON ${JSON.stringify(payload)}`;
    const result = parseTruthinessSentinel(line);

    expect(result).not.toBeNull();
    expect(result!.type).toBe("invariant_failure");
    expect(result!.payload.critical_failures).toEqual(["ending_balance_mismatch"]);
    const details = result!.payload.details as Record<string, number>;
    expect(details.diff).toBe(8827);
  });

  // ── Wave 25 Item 5: B15_BATTERY_JSON sentinel ─────────────────────────────

  it("exports B15_BATTERY_SENTINEL constant with value 'B15_BATTERY_JSON'", () => {
    expect(B15_BATTERY_SENTINEL).toBe("B15_BATTERY_JSON");
  });

  it("parses B15_BATTERY_JSON sentinel line (Wave 25 Item 5)", () => {
    const payload = {
      event: "b15_battery",
      backtest_id: "abc-123",
      result: { sdr: 0.91, psi: 0.025, rws: 0.14, passed: true, failures: [] },
    };
    const line = `B15_BATTERY_JSON ${JSON.stringify(payload)}`;
    const result = parseTruthinessSentinel(line);

    expect(result).not.toBeNull();
    expect(result!.type).toBe("b15_battery");
    expect((result!.payload as typeof payload).event).toBe("b15_battery");
    expect((result!.payload as typeof payload).result.passed).toBe(true);
    expect((result!.payload as typeof payload).result.sdr).toBe(0.91);
  });

  it("parses B15_BATTERY_JSON when battery FAILED (passed=false)", () => {
    const payload = {
      event: "b15_battery",
      backtest_id: "xyz",
      result: {
        sdr: 0.72,
        psi: 0.03,
        rws: 0.18,
        passed: false,
        failures: ["SDR 0.72 < 0.85 — strategy is perturbation-fragile"],
      },
    };
    const line = `B15_BATTERY_JSON ${JSON.stringify(payload)}`;
    const result = parseTruthinessSentinel(line);

    expect(result).not.toBeNull();
    expect(result!.type).toBe("b15_battery");
    expect((result!.payload as typeof payload).result.passed).toBe(false);
    expect((result!.payload as typeof payload).result.failures).toHaveLength(1);
  });

  it("returns null for B15_BATTERY_JSON with malformed JSON", () => {
    const line = "B15_BATTERY_JSON {not valid json}}}";
    expect(() => parseTruthinessSentinel(line)).not.toThrow();
    expect(parseTruthinessSentinel(line)).toBeNull();
  });

  it("B15_BATTERY_JSON prefix in middle of line is NOT matched", () => {
    const line = "prefix B15_BATTERY_JSON {}";
    expect(parseTruthinessSentinel(line)).toBeNull();
  });
});
