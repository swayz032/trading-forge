/**
 * Regression test — deep-scan verify-fix cluster B (2026-07-06)
 *
 * bias-state-service.ts embeds PLAYBOOK_TO_REGIME (a Python dict inside a
 * script string). Wave 25 Pass 6 added 4 institutional playbooks to
 * playbook_router.py, but they were MISSING from PLAYBOOK_TO_REGIME, so
 * `PLAYBOOK_TO_REGIME.get(routed_playbook, "UNKNOWN")` returned "UNKNOWN" for
 * those regimes — and resolveActiveStrategy() treats "UNKNOWN" as "no regime
 * filtering" (any strategy eligible), silently DISABLING the preferred_regimes
 * gate during EXPANSION / COMPRESSION / HIGH_VOL_MACRO / LATE_CYCLE_OVERHEATING.
 *
 * Because the mapping lives in an embedded Python string (not importable TS),
 * this test asserts against the source text: each new playbook must map to its
 * institutional regime label (a non-"UNKNOWN" value), and the TS filter branch
 * that disables filtering must remain "UNKNOWN"-keyed (so a real regime label
 * routes through the FILTERING branch, not the wildcard branch).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(
  resolve(__dirname, "../services/bias-state-service.ts"),
  "utf8",
);

describe("bias-state-service PLAYBOOK_TO_REGIME — Wave 25 Pass 6 institutional playbooks", () => {
  const expected: Array<[string, string]> = [
    ["DISPLACEMENT_CONTINUATION", "EXPANSION"],
    ["BREAKOUT_PREP", "COMPRESSION"],
    ["REDUCED_SIZING", "HIGH_VOL_MACRO"],
    ["LATE_CYCLE_MEAN_REVERSION", "LATE_CYCLE_OVERHEATING"],
  ];

  for (const [playbook, regime] of expected) {
    it(`maps ${playbook} → ${regime} (non-UNKNOWN so the preferred_regimes filter engages)`, () => {
      // Python dict entry form:  "PLAYBOOK":  "REGIME",
      const re = new RegExp(`"${playbook}"\\s*:\\s*"${regime}"`);
      expect(src).toMatch(re);
      expect(regime).not.toBe("UNKNOWN");
    });
  }

  it("resolveActiveStrategy still treats ONLY 'UNKNOWN' as the no-filtering wildcard", () => {
    // The wildcard/no-filtering branch must remain keyed on the literal "UNKNOWN"
    // — the 4 institutional playbooks now resolve to real regime labels, so they
    // route through the FILTERING branch instead of this wildcard.
    expect(src).toMatch(/regimeLabel === "UNKNOWN"/);
  });
});
