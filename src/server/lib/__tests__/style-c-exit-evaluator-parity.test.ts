/**
 * style-c-exit-evaluator-parity.test.ts — deep-scan #4 (2026-06-29)
 *
 * Cross-language parity gate for the dark-launched TS-native Style C evaluator.
 * Loads tests/fixtures/style_c_parity_fixtures.json (the SAME fixtures the Python
 * test tests/test_style_c_parity_2026_06_29.py runs through style_c_handler.py).
 * Both engines MUST produce identical decision + new_stop on every fixture.
 *
 * Until this suite (and its Python twin) is GREEN, STYLE_C_EXIT_TS_NATIVE must
 * stay false (default) — the evaluator runs dark behind the audited Python path.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { evaluateStyleCExit, type StyleCEvalState } from "../style-c-exit-evaluator.js";

interface Fixture {
  name: string;
  state: StyleCEvalState;
  expected_decision: string;
  expected_new_stop: number | null;
}

const FIXTURE_PATH = resolve(process.cwd(), "tests/fixtures/style_c_parity_fixtures.json");
const fixtures: Fixture[] = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")).fixtures;

describe("Style C TS evaluator ↔ Python parity (shared fixtures)", () => {
  it("loaded the shared fixture set", () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(14);
  });

  for (const fx of fixtures) {
    it(`${fx.name} → ${fx.expected_decision}`, () => {
      const result = evaluateStyleCExit(fx.state);
      expect(result.decision).toBe(fx.expected_decision);
      if (fx.expected_new_stop === null) {
        expect(result.new_stop == null).toBe(true);
      } else {
        expect(result.new_stop).toBeCloseTo(fx.expected_new_stop, 6);
      }
    });
  }

  // NaN / Inf cannot be encoded in JSON — assert the fail-closed HOLD inline.
  it("NaN entry_price → HOLD (fail-closed)", () => {
    const r = evaluateStyleCExit({
      direction: "long", entry_price: NaN, stop_pts: 10, current_price: 4505,
      current_time_et: "10:00", bar_high: 4510, bar_low: 4502,
    });
    expect(r.decision).toBe("HOLD");
    expect(r.evidence["error"]).toBe("NaN_or_Inf_in_entry_price");
  });

  it("Infinity current_price → HOLD (fail-closed)", () => {
    const r = evaluateStyleCExit({
      direction: "long", entry_price: 4500, stop_pts: 10, current_price: Infinity,
      current_time_et: "10:00", bar_high: 4510, bar_low: 4502,
    });
    expect(r.decision).toBe("HOLD");
    expect(r.evidence["error"]).toBe("NaN_or_Inf_in_current_price");
  });
});
