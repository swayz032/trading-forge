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
  // WAS `expect(fixtures.length).toBeGreaterThanOrEqual(14)` against a true count
  // of exactly 14 — zero slack, so it genuinely bit. But its correctness was a
  // COINCIDENCE OF THE POPULATION'S CURRENT SIZE: add a fifteenth fixture and it
  // silently licenses dropping back to fourteen, with nobody having edited the
  // guard. A floor is a non-biter with a delay fuse, and it is invisible at birth
  // because the confessional comment ("14 at time of writing") would have been
  // RIGHT. An equality over NAMES is self-maintaining instead: adding a scenario
  // stays green with no edit here, and removing one goes red by name.
  //
  // This list was GENERATED from the fixture file, not hand-typed. It is a
  // REQUIRED-MINIMUM set: each entry is a distinct exit scenario this parity gate
  // must keep covering, so deleting one is a visible, reviewable act rather than
  // a number quietly getting smaller.
  const REQUIRED_SCENARIOS = [
    "long_tp1_hit_intrabar_high",
    "long_tp1_not_reached_holds",
    "long_tp2_hit_after_tp1",
    "long_tp1_priority_over_tp2_when_tp1_unfilled",
    "short_tp1_hit_intrabar_low",
    "short_tp2_hit_after_tp1",
    "runner_trail_update_poc_not_breached_long",
    "runner_trail_breached_long",
    "time_stop_at_1555_takes_priority_over_tp1",
    "time_stop_before_1554_no_flatten",
    "hold_default_no_trigger",
    "stop_pts_zero_holds",
    "bar_high_null_falls_back_to_current_price_long",
    "tp1_already_filled_no_refire_tp2_not_reached",
  ] as const;

  it("every required exit scenario is still present in the shared fixtures", () => {
    const present = new Set(fixtures.map((f) => f.name));
    const missing = REQUIRED_SCENARIOS.filter((n) => !present.has(n));
    expect(missing).toEqual([]);
  });

  it("fixture names are unique (a duplicate would silently mask a deletion)", () => {
    const names = fixtures.map((f) => f.name);
    expect(names.length).toBe(new Set(names).size);
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
