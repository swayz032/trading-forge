/**
 * Wave 9 — PARAM_RANGES TS↔Python drift detection tests
 *
 * Verifies that TS CANONICAL_PARAM_RANGES (in param-ranges.ts) and
 * REQUIRED_PARAMS_BY_INDICATOR_FULL (in direct-bucket-graduator.ts) are in
 * exact sync with Python pattern_library.py ENTRY_PATTERNS. Any key present
 * in one side but absent on the other is a silent-rejection bug waiting to
 * happen.
 *
 * F-2 fix (2026-05-20): PARAM_RANGES moved from graduator.ts to the canonical
 * lib/param-ranges.ts — this test now scans param-ranges.ts for the range
 * definitions. The graduator re-exports the same constant; scanning the source
 * of truth file is safer and avoids the previous regex brittleness.
 *
 * Does NOT import the modules (avoids DB/service deps). Instead:
 *   - Reads the TS files textually and extracts keys via regex.
 *   - Reads the Python file textually and extracts keys via regex.
 * This keeps the test dependency-free and fast.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

// ─── File paths ───────────────────────────────────────────────────────────────

const ROOT = resolve(import.meta.dirname, "../../..");
// F-2: canonical range definitions now live in lib/param-ranges.ts
const TS_PARAM_RANGES_FILE = resolve(ROOT, "src/server/lib/param-ranges.ts");
const TS_GRADUATOR = resolve(ROOT, "src/server/services/direct-bucket-graduator.ts");
const PY_PATTERN_LIB = resolve(ROOT, "src/engine/compiler/pattern_library.py");

// ─── Helpers — textual extraction ────────────────────────────────────────────

/** Extract keys from TS const block like: const NAME: Record<...> = { key1: ..., key2: ... }
 *
 * Handles both `\n};` and `\n} as const;` block endings (F-2: param-ranges.ts uses "as const").
 */
function extractTsRecordKeys(source: string, constName: string): string[] {
  // Match the const block by name — capture everything between the outer braces.
  // Ending pattern: \n} optionally followed by " as const" then semicolon.
  const re = new RegExp(`const ${constName}[^=]+=\\s*\\{([\\s\\S]*?)\\n\\}(?:\\s*as\\s+const)?;`);
  const match = source.match(re);
  if (!match) throw new Error(`Could not find '${constName}' block in TS file`);
  // Each key line starts with optional whitespace then the key name followed by colon/space.
  return [...match[1].matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]);
}

/** Extract ENTRY_PATTERNS keys from Python source via regex.
 *
 * Matches ONLY top-level indicator keys in the ENTRY_PATTERNS dict. These are
 * indented by 4 spaces (one level inside the dict). Nested keys like
 * "required_params" and "param_ranges" are indented 8+ spaces and must NOT
 * be matched.
 */
function extractPythonEntryPatternKeys(source: string): string[] {
  // Extract the ENTRY_PATTERNS block first
  const blockMatch = source.match(/ENTRY_PATTERNS:\s*dict[^=]+=\s*\{([\s\S]*?)^}/m)
    ?? source.match(/ENTRY_PATTERNS\s*=\s*\{([\s\S]*?)^}/m);
  if (!blockMatch) return [];
  // Top-level keys are indented exactly 4 spaces followed by a quoted string key and a colon
  return [...blockMatch[1].matchAll(/^ {4}"(\w+)":\s*\{/gm)].map((m) => m[1]);
}

/** Extract required_params for a given indicator from Python ENTRY_PATTERNS. */
function extractPythonRequiredParams(source: string, indicator: string): string[] {
  // Find the block for this indicator
  const blockRe = new RegExp(`"${indicator}":\\s*\\{[\\s\\S]*?\\}\\s*,`, "m");
  const blockMatch = source.match(blockRe);
  if (!blockMatch) return [];
  const requiredMatch = blockMatch[0].match(/"required_params":\s*\[(.*?)\]/);
  if (!requiredMatch) return [];
  return [...requiredMatch[1].matchAll(/"(\w+)"/g)].map((m) => m[1]);
}

/** Extract required params list for a given indicator from TS REQUIRED_PARAMS_BY_INDICATOR_FULL. */
function extractTsRequiredParams(source: string, indicator: string): string[] {
  // Matches lines like:   indicator_name: ["param1", "param2"],
  const lineRe = new RegExp(`^\\s+${indicator}:\\s*\\[([^\\]]+)\\]`, "m");
  const match = source.match(lineRe);
  if (!match) return [];
  return [...match[1].matchAll(/"(\w+)"/g)].map((m) => m[1]);
}

/** Extract param range keys for a given indicator from TS PARAM_RANGES. */
function extractTsParamRangeKeys(source: string, indicator: string): string[] {
  // PARAM_RANGES block for one indicator: indicator: { key1: [...], key2: [...] }
  const blockRe = new RegExp(`^  ${indicator}:\\s*\\{([^}]+)\\}`, "m");
  const match = source.match(blockRe);
  if (!match) return [];
  return [...match[1].matchAll(/(\w+):/g)].map((m) => m[1]);
}

/** Extract param range keys for a given indicator from Python param_ranges dict. */
function extractPythonParamRangeKeys(source: string, indicator: string): string[] {
  // Find the indicator block, then look inside "param_ranges": { ... }
  const blockRe = new RegExp(`"${indicator}":\\s*\\{[\\s\\S]*?\\}\\s*,`, "m");
  const blockMatch = source.match(blockRe);
  if (!blockMatch) return [];
  const rangesMatch = blockMatch[0].match(/"param_ranges":\s*\{([\s\S]*?)\}/);
  if (!rangesMatch) return [];
  return [...rangesMatch[1].matchAll(/"(\w+)":/g)].map((m) => m[1]);
}

// ─── Load sources ─────────────────────────────────────────────────────────────

// Canonical param ranges now live in lib/param-ranges.ts (F-2 fix 2026-05-20)
const tsParamRangesSource = readFileSync(TS_PARAM_RANGES_FILE, "utf-8");
const tsSource = readFileSync(TS_GRADUATOR, "utf-8");
const pySource = readFileSync(PY_PATTERN_LIB, "utf-8");

const tsParamRangeKeys = extractTsRecordKeys(tsParamRangesSource, "CANONICAL_PARAM_RANGES");
const tsRequiredParamKeys = extractTsRecordKeys(tsSource, "REQUIRED_PARAMS_BY_INDICATOR_FULL");
const pyPatternKeys = extractPythonEntryPatternKeys(pySource);

// ─── Tests ────────────────────────────────────────────────────────────────────

// TS-only indicators: these have canonical param ranges in TS but compile to a
// different Python primitive at the dsl-compiler layer (no Python ENTRY_PATTERNS
// entry needed). Keep this list minimal — new entries require justification.
//
// connors_rsi2:             compiles to Python rsi_reversal with period=2 defaults (F-3 fix).
// supertrend:               routes to a strategy class, not a pattern_library ENTRY_PATTERNS key.
// ichimoku_cloud:           routes to a strategy class, not a pattern_library ENTRY_PATTERNS key.
// dema_crossover:           routes to a strategy class, not a pattern_library ENTRY_PATTERNS key.
// alma_filter:              routes to a strategy class, not a pattern_library ENTRY_PATTERNS key.
// rsi_divergence:           TS-side divergence variant; Python uses rsi_reversal for the parametric path.
// atr_trailing_stop:        TS-side trailing-stop indicator; Python uses atr_breakout for the parametric path.
// cumulative_delta:         volume/order-flow indicator compiled via order_flow module, not ENTRY_PATTERNS.
// vwap_order_flow:          volume/order-flow indicator compiled via order_flow module, not ENTRY_PATTERNS.
// volume_profile:           routes to archetype:order_block at compile time (see graduator §2b).
// liquidity_sweep_breakout: routes to archetype:liquidity_sweep at compile time (see graduator §2b).
// fifo_session_open:        session/event indicator; no Python ENTRY_PATTERNS counterpart (engine-side DSL only).
// news_fade_mco:            event-driven indicator; no Python ENTRY_PATTERNS counterpart (engine-side DSL only).
// ict_bias_aligned_continuation: full archetype strategy CLASS (src/engine/strategies/
//                           ict_bias_aligned_continuation.py), routed via archetype
//                           dispatch — never a pattern_library.py ENTRY_PATTERNS entry.
//                           Added to CANONICAL_PARAM_RANGES (critic-replay-lifecycle-misc,
//                           2026-07-17) so the critic's H-5/H-8 bounds machinery has real
//                           bounds for this archetype's 6 numeric knobs.
// Wave hardening 2026-06-22, CI-trust: documented 12 TS-only indicators that are genuine DSL-only
// aliases or route through strategy classes / archetype routing rather than pattern_library.
const TS_ONLY_INDICATORS = new Set([
  "connors_rsi2",
  "supertrend",
  "ichimoku_cloud",
  "dema_crossover",
  "alma_filter",
  "rsi_divergence",
  "atr_trailing_stop",
  "cumulative_delta",
  "vwap_order_flow",
  "volume_profile",
  "liquidity_sweep_breakout",
  "fifo_session_open",
  "news_fade_mco",
  "ict_bias_aligned_continuation",
]);

describe("Wave 9 — PARAM_RANGES TS↔Python drift", () => {
  describe("TS PARAM_RANGES keys exist in Python ENTRY_PATTERNS", () => {
    it("every TS PARAM_RANGES key has a Python ENTRY_PATTERNS counterpart (excluding TS-only indicators)", () => {
      const missing = tsParamRangeKeys.filter((k) => !TS_ONLY_INDICATORS.has(k) && !pyPatternKeys.includes(k));
      expect(missing, `TS PARAM_RANGES has keys absent from Python: [${missing.join(", ")}]`).toEqual([]);
    });
  });

  describe("Python ENTRY_PATTERNS keys exist in TS REQUIRED_PARAMS_BY_INDICATOR_FULL", () => {
    it("every Python ENTRY_PATTERNS key has a TS REQUIRED_PARAMS_BY_INDICATOR_FULL counterpart", () => {
      const missing = pyPatternKeys.filter((k) => !tsRequiredParamKeys.includes(k));
      expect(missing, `Python ENTRY_PATTERNS has keys absent from TS REQUIRED_PARAMS_BY_INDICATOR_FULL: [${missing.join(", ")}]`).toEqual([]);
    });
  });

  describe("TS REQUIRED_PARAMS_BY_INDICATOR_FULL keys exist in Python ENTRY_PATTERNS", () => {
    it("every TS REQUIRED_PARAMS_BY_INDICATOR_FULL key has a Python ENTRY_PATTERNS counterpart", () => {
      // Wave hardening 2026-06-22, CI-trust: TS_ONLY_INDICATORS are excluded —
      // they are DSL-only aliases or route via strategy classes, not ENTRY_PATTERNS.
      const missing = tsRequiredParamKeys.filter((k) => !TS_ONLY_INDICATORS.has(k) && !pyPatternKeys.includes(k));
      expect(missing, `TS REQUIRED_PARAMS_BY_INDICATOR_FULL has keys absent from Python: [${missing.join(", ")}]`).toEqual([]);
    });
  });

  describe("vwap_fade required params match on both sides", () => {
    it("TS REQUIRED_PARAMS_BY_INDICATOR_FULL.vwap_fade uses atr_extension_threshold (not deviation_threshold)", () => {
      const tsParams = extractTsRequiredParams(tsSource, "vwap_fade");
      expect(tsParams).toContain("atr_extension_threshold");
      expect(tsParams).not.toContain("deviation_threshold");
    });

    it("Python ENTRY_PATTERNS.vwap_fade required_params uses atr_extension_threshold", () => {
      const pyParams = extractPythonRequiredParams(pySource, "vwap_fade");
      expect(pyParams).toContain("atr_extension_threshold");
      expect(pyParams).not.toContain("deviation_threshold");
    });

    it("both sides list identical required params for vwap_fade", () => {
      const tsParams = extractTsRequiredParams(tsSource, "vwap_fade").sort();
      const pyParams = extractPythonRequiredParams(pySource, "vwap_fade").sort();
      expect(tsParams).toEqual(pyParams);
    });
  });

  describe("overnight_drift required params match on both sides", () => {
    it("TS REQUIRED_PARAMS_BY_INDICATOR_FULL.overnight_drift uses Python-canonical params", () => {
      const tsParams = extractTsRequiredParams(tsSource, "overnight_drift");
      expect(tsParams).toContain("drift_atr_threshold");
      expect(tsParams).toContain("asia_lookback_bars");
      // Old stale params must be gone
      expect(tsParams).not.toContain("drift_session");
      expect(tsParams).not.toContain("entry_window_minutes");
    });

    it("both sides list identical required params for overnight_drift", () => {
      const tsParams = extractTsRequiredParams(tsSource, "overnight_drift").sort();
      const pyParams = extractPythonRequiredParams(pySource, "overnight_drift").sort();
      expect(tsParams).toEqual(pyParams);
    });
  });

  describe("PARAM_RANGES numeric keys match Python param_ranges for core indicators", () => {
    // Spot-check a sample of indicators to ensure range-key parity.
    // F-2: scan tsParamRangesSource (lib/param-ranges.ts) — the canonical source.
    // connors_rsi2 is TS-only (no Python pattern_library entry) — excluded from parity checks.
    const SPOT_CHECKS = ["vwap_fade", "sma_crossover", "ema_crossover", "rsi_reversal", "macd_crossover", "overnight_drift"];
    for (const ind of SPOT_CHECKS) {
      it(`PARAM_RANGES and Python param_ranges keys match for '${ind}'`, () => {
        const tsKeys = extractTsParamRangeKeys(tsParamRangesSource, ind).sort();
        const pyKeys = extractPythonParamRangeKeys(pySource, ind).sort();
        expect(tsKeys, `Mismatch for ${ind} — TS: [${tsKeys}] vs Python: [${pyKeys}]`).toEqual(pyKeys);
      });
    }
  });
});
