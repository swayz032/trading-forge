/**
 * deepscan18c-c3-eligibility-gate-mode-persistence.test.ts
 *
 * C-3 fix (Deep-Scan #18c, 2026-07-05) — eligibility gate mode disclosure persistence.
 *
 * BUG: Python backtester.py::apply_eligibility_gate() computes gate_stats["mode"]
 * (source_entry_only / passthrough_htf_unavailable / passthrough_strategy_unregistered
 * / tf_institutional_overlay) + gate_stats["passthrough_reason"], but the MAIN backtest
 * path (run_backtest()) captured the per-side gate_stats blobs ONLY to extract
 * "structural_stop_map" — "mode" was computed and then silently discarded before
 * ever reaching the persisted backtest row. A strategy transitioning from
 * passthrough_strategy_unregistered -> tf_institutional_overlay (e.g. after being
 * added to playbook_router.ALL_STRATS) produced NO queryable record distinguishing
 * pre-flip vs post-flip backtests.
 *
 * FIX:
 *   1. Python: new pure helper _build_eligibility_gate_mode_disclosure() assembles
 *      {"long", "long_passthrough_reason", "short", "short_passthrough_reason"} from
 *      the raw gate_stats blobs and run_backtest() writes it to the additive
 *      result["eligibility_gate_mode"] key (see
 *      src/engine/tests/test_c3_eligibility_gate_mode_disclosure.py for the Python
 *      unit + surfacing-helper coverage).
 *   2. TS: backtest-service.ts::buildResultExtras() adds "eligibility_gate_mode" to
 *      its extraKeys allowlist so the key survives into backtests.result_extras
 *      JSONB (the same mechanism that already persists dsl_guards / expected_signals
 *      / parity_shadow / invariants — see the existing E-1 cross-track test in
 *      deepscan16-hard-gate-counters.test.ts for the established source-scan pattern
 *      this test follows, since buildResultExtras is not exported and is heavily
 *      DB-coupled).
 *   3. jsonb-shapes.ts::BacktestResultExtrasShape gains a typed optional
 *      `eligibility_gate_mode` field documenting the contract (forward-compat
 *      catch-all `[key: string]: unknown` already accepted it; the named field adds
 *      IDE-visible documentation, matching the convention used for wfe_overall /
 *      pbo_overall / b14_ruin_ci etc.).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKTEST_SERVICE_PATH = join(HERE, "../services/backtest-service.ts");
const JSONB_SHAPES_PATH = join(HERE, "../db/jsonb-shapes.ts");

describe("C-3 — backtest-service.ts persists eligibility_gate_mode via buildResultExtras", () => {
  const src = readFileSync(BACKTEST_SERVICE_PATH, "utf-8");

  it("adds eligibility_gate_mode to the buildResultExtras extraKeys allowlist", () => {
    expect(src).toContain('"eligibility_gate_mode"');
  });

  it("the eligibility_gate_mode key sits inside the buildResultExtras function body, not elsewhere", () => {
    const fnStart = src.indexOf("function buildResultExtras");
    expect(fnStart).toBeGreaterThan(-1);
    // Tolerate CRLF line endings — find the closing brace at column 0 after fnStart.
    const closeBraceMatch = /\r?\n\}\r?\n/.exec(src.slice(fnStart));
    expect(closeBraceMatch).not.toBeNull();
    const fnEnd = fnStart + (closeBraceMatch as RegExpExecArray).index;
    expect(fnEnd).toBeGreaterThan(fnStart);
    const fnBody = src.slice(fnStart, fnEnd);
    expect(fnBody).toContain('"eligibility_gate_mode"');
  });

  it("documents the Python producer contract (result[\"eligibility_gate_mode\"])", () => {
    // Guards against a future edit silently repointing the comment/contract
    // without updating the actual Python-side key name.
    expect(src).toContain("eligibility_gate_mode");
    expect(src.toLowerCase()).toContain("passthrough_strategy_unregistered");
  });
});

describe("C-3 — BacktestResultExtrasShape documents eligibility_gate_mode", () => {
  const src = readFileSync(JSONB_SHAPES_PATH, "utf-8");

  it("declares a typed optional eligibility_gate_mode field with long/short + passthrough_reason", () => {
    const ifaceStart = src.indexOf("export interface BacktestResultExtrasShape");
    expect(ifaceStart).toBeGreaterThan(-1);
    // Tolerate CRLF line endings — find the closing brace at column 0 after ifaceStart.
    const closeBraceMatch = /\r?\n\}\r?\n/.exec(src.slice(ifaceStart));
    expect(closeBraceMatch).not.toBeNull();
    const ifaceEnd = ifaceStart + (closeBraceMatch as RegExpExecArray).index;
    const ifaceBody = src.slice(ifaceStart, ifaceEnd);
    expect(ifaceBody).toContain("eligibility_gate_mode");
    expect(ifaceBody).toContain("long_passthrough_reason");
    expect(ifaceBody).toContain("short_passthrough_reason");
  });
});

// ─── Reference implementation — buildResultExtras extraction loop ─────────────
//
// buildResultExtras() is not exported (heavily DB-coupled via BacktestResult type
// import chains). Per the established repo pattern (see
// deepscan16-hard-gate-counters.test.ts "Reference implementation" section), this
// is an exact-copy reference of the *generic* key-extraction loop, parameterized
// over a minimal key list including "eligibility_gate_mode", to pin the inclusion/
// exclusion contract independent of the DB layer:
//   - present (non-null/undefined) values are copied into the extras object
//   - null/undefined values are omitted entirely (not persisted as explicit null)
function extractAllowlistedExtras(
  result: Record<string, unknown>,
  extraKeys: readonly string[],
): Record<string, unknown> | null {
  const extras: Record<string, unknown> = {};
  let hasAny = false;
  for (const key of extraKeys) {
    const value = result[key];
    if (value !== undefined && value !== null) {
      extras[key] = value;
      hasAny = true;
    }
  }
  return hasAny ? extras : null;
}

const REFERENCE_EXTRA_KEYS = ["eligibility_gate_mode", "dsl_guards", "invariants"] as const;

describe("Reference implementation — eligibility_gate_mode extraction via the generic allowlist loop", () => {
  it("includes eligibility_gate_mode when the Python result populates it (registered-strategy shape)", () => {
    const pythonResult = {
      eligibility_gate_mode: {
        long: "tf_institutional_overlay",
        long_passthrough_reason: null,
        short: null,
        short_passthrough_reason: null,
      },
    };
    const extras = extractAllowlistedExtras(pythonResult, REFERENCE_EXTRA_KEYS);
    expect(extras).not.toBeNull();
    expect(extras?.eligibility_gate_mode).toEqual({
      long: "tf_institutional_overlay",
      long_passthrough_reason: null,
      short: null,
      short_passthrough_reason: null,
    });
  });

  it("includes eligibility_gate_mode when the Python result reports an unregistered-strategy passthrough", () => {
    const pythonResult = {
      eligibility_gate_mode: {
        long: "passthrough_strategy_unregistered",
        long_passthrough_reason: "strategy_name='new_unregistered_strategy' not in playbook_router.ALL_STRATS",
        short: null,
        short_passthrough_reason: null,
      },
    };
    const extras = extractAllowlistedExtras(pythonResult, REFERENCE_EXTRA_KEYS);
    expect(extras).not.toBeNull();
    const mode = extras?.eligibility_gate_mode as Record<string, unknown>;
    expect(mode.long).toBe("passthrough_strategy_unregistered");
    expect(mode.long_passthrough_reason).toContain("new_unregistered_strategy");
  });

  it("distinguishes a registered-strategy run from an unregistered-strategy run at the persisted-row level", () => {
    // This is the exact regression the C-3 fix closes: before the fix, NEITHER run
    // left any queryable trace — both persisted rows were indistinguishable because
    // "mode" was computed and discarded. After the fix, result_extras.eligibility_gate_mode
    // differs between the two runs.
    const registeredRun = extractAllowlistedExtras(
      { eligibility_gate_mode: { long: "tf_institutional_overlay", long_passthrough_reason: null, short: null, short_passthrough_reason: null } },
      REFERENCE_EXTRA_KEYS,
    );
    const unregisteredRun = extractAllowlistedExtras(
      { eligibility_gate_mode: { long: "passthrough_strategy_unregistered", long_passthrough_reason: "strategy_name='x' not in playbook_router.ALL_STRATS", short: null, short_passthrough_reason: null } },
      REFERENCE_EXTRA_KEYS,
    );
    expect(registeredRun?.eligibility_gate_mode).not.toEqual(unregisteredRun?.eligibility_gate_mode);
  });

  it("omits eligibility_gate_mode entirely for legacy Python results that never emit the key (pre-C-3 grandfather)", () => {
    const legacyResult = { dsl_guards: { stop_ceiling_skips: 0 } };
    const extras = extractAllowlistedExtras(legacyResult, REFERENCE_EXTRA_KEYS);
    expect(extras).not.toBeNull();
    expect(extras).not.toHaveProperty("eligibility_gate_mode");
    expect(extras?.dsl_guards).toEqual({ stop_ceiling_skips: 0 });
  });

  it("returns null when no allowlisted key is present at all (no partial/empty-object write)", () => {
    const extras = extractAllowlistedExtras({ some_unrelated_field: 1 }, REFERENCE_EXTRA_KEYS);
    expect(extras).toBeNull();
  });
});
