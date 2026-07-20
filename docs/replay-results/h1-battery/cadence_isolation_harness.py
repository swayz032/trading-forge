#!/usr/bin/env python3
"""CADENCE-ISOLATION HARNESS — level/zone sub-wire (R-079 §4.3, AR-083 CRITICAL).

WHY THIS EXISTS (receipts, not narrative): the independent grade of the level/zone sub-wire
(AR-083, `docs/designs/AGENT-REPORTS.md` §B) found that routing changes TWO variables at once.
`_eval_wait_structure` (the baseline, `src/engine/spec_condition_compiler.py:357-406`) recomputes
`compute_structure_state` only every `STRUCTURE_RECOMPUTE_CADENCE_BARS` (10) bars and HOLDS the
value between recomputes. `_eval_wait_structure_levelzone` (~line 643-661) delegates to
`_eval_wait_retest` -> `retest_touch_check`, which evaluates EVERY bar, no holding. So "routing"
bundles level-awareness together with a cadence change from held-every-10 to every-bar. The grader
measured cadence ALONE (level-awareness held fixed) at entries 49 vs 10 — a ~5x swing — over 2000
bars. This is the WIRE-1 failure pattern: a 721->631 trade change was read as fidelity when it was
cadence, because the two moved together and nobody isolated them.

This harness separates the two axes and reports each ON ITS OWN. It NEVER reports a single
combined delta (baseline-cadence10-blind vs routed-cadence1-aware) — that confounded comparison
is exactly the ~5x AR-083 caught, and computing it here would just reproduce the same mistake with
extra steps.

DESIGN — a 2x2 over (level-awareness x cadence), all four cells built from REAL PRODUCTION CODE
(not re-derived math):
  - `_eval_wait_structure_levelzone` and the `_eval_wait_retest` it delegates to touch no `self`
    state on the path this harness exercises (verified by reading the methods before relying on
    this) -- calling them unbound with self=None reuses the exact production evaluator instead of
    re-authoring the math, avoiding the duplicate-classifier defect class this campaign keeps
    convicting (spec_family_bindings.py's own LEVEL_ZONE_RE docstring names the same discipline).
  - `_eval_wait_structure` is likewise called unbound; its ONLY self-touching branch (the WIRE-1
    `htf_structure_active` wired-column path) is provably skipped because this harness's synthetic
    df carries no such column, asserted before every call.
  - Cadence is varied by monkeypatching the module-level `STRUCTURE_RECOMPUTE_CADENCE_BARS`
    constant for the duration of one call (production code, patched constant — not a rewrite).
  - The one cell with no production equivalent (level-aware evaluated at a HELD cadence -- this
    combination has never executed in production) is built by resampling the already-computed
    every-bar level-aware array with the EXACT same hold rule `_eval_wait_structure` itself uses
    (`i % cadence == 0 or i == n-1` samples fresh, every other bar holds). This substitution is
    exact, not approximate: `retest_touch_check` (spec_condition_compiler.py:110-135) computes bar
    i from close[i]/high[i]/low[i]/level[i]/atr[i] ONLY -- no window -- so "recompute at bar i,
    hold until the next cadence point" and "read the precomputed every-bar value at bar i, hold
    until the next cadence point" are mathematically identical.

Replay-deterministic: fixed seed (42), synthetic bars, no DB, no clock, no network. Exits non-zero
on anti-vacuity failure so this is usable as a gate, not just a report (generator-with-artifact
law, mirrors docs/replay-results/h1-battery/levelzone_premise_audit.py).

Run: python docs/replay-results/h1-battery/cadence_isolation_harness.py
"""

from __future__ import annotations

import sys
from unittest.mock import patch

import numpy as np
import polars as pl

sys.path.insert(0, ".")
from src.engine.spec_condition_compiler import (  # noqa: E402
    STRUCTURE_RECOMPUTE_CADENCE_BARS as PROD_CADENCE,
)
from src.engine.spec_condition_compiler import SpecConditionStrategy  # noqa: E402

SEED, N = 42, 2000


def make_bars() -> tuple[np.ndarray, np.ndarray, np.ndarray, pl.DataFrame]:
    """Same generator convention as levelzone_premise_audit.py's make_bars() and
    test_levelzone_routing.py's _synthetic_df() -- a mean-reverting-ish random walk with
    wick range, deterministic under a fixed seed. No `htf_structure_active` column, by
    construction, so the WIRE-1 wired-column branch of _eval_wait_structure never engages
    here (this harness measures the PROXY path only, same path routing changed)."""
    rng = np.random.default_rng(SEED)
    close = 100 + np.cumsum(rng.normal(0, 0.5, N))
    high = close + rng.uniform(0.1, 1.5, N)
    low = close - rng.uniform(0.1, 1.5, N)
    open_ = close + rng.normal(0, 0.3, N)
    volume = np.full(N, 1000.0)
    df = pl.DataFrame(
        {"open": open_, "high": high, "low": low, "close": close, "volume": volume}
    )
    assert "htf_structure_active" not in df.columns
    return (
        close.astype(np.float64),
        high.astype(np.float64),
        low.astype(np.float64),
        df,
    )


def level_aware_everybar(close: np.ndarray, high: np.ndarray, low: np.ndarray, n: int) -> np.ndarray:
    """REAL production evaluator, unmodified, called unbound (self=None). Calls
    `_eval_wait_retest` directly rather than through the `_eval_wait_structure_levelzone` thin
    wrapper -- the wrapper's ONLY body is `return self._eval_wait_retest(...)` (spec_condition_
    compiler.py:661), a pure pass-through that needs `self` solely to look up the method, not to
    read any instance state; calling the target method directly is the identical computation
    without an unusable `self` in the middle. Every-bar by construction -- this family has no
    cadence limiting in production today."""
    return SpecConditionStrategy._eval_wait_retest(None, close, high, low, n)


def level_blind_at_cadence(df: pl.DataFrame, n: int, cadence: int) -> np.ndarray:
    """REAL production evaluator (_eval_wait_structure), unmodified, called unbound with the
    module constant monkeypatched for the call's duration. self is never touched on this path
    (asserted: df carries no htf_structure_active column)."""
    assert "htf_structure_active" not in df.columns
    with patch("src.engine.spec_condition_compiler.STRUCTURE_RECOMPUTE_CADENCE_BARS", cadence):
        return SpecConditionStrategy._eval_wait_structure(None, n, df)


def hold_at_cadence(everybar: np.ndarray, cadence: int) -> np.ndarray:
    """HARNESS-ONLY helper -- no production equivalent exists (level-aware evaluation has never
    run at a held cadence in production). See module docstring for why this resample is an EXACT
    substitute for 'recompute at bar i, hold until next cadence point', not an approximation."""
    n = len(everybar)
    out = np.zeros(n, dtype=bool)
    last = False
    for i in range(n):
        if i % cadence == 0 or i == n - 1:
            last = bool(everybar[i])
        out[i] = last
    return out


def describe(arr: np.ndarray) -> dict:
    n = len(arr)
    bars_true = int(arr.sum())
    entries = int(np.sum(arr[1:] & ~arr[:-1]))  # False->True rising edges
    return {"bars_true": bars_true, "pct_true": round(100 * bars_true / n, 2), "entries": entries}


def disagreement_pct(a: np.ndarray, b: np.ndarray) -> float:
    return round(100 * float(np.mean(a != b)), 2)


def main() -> int:
    close, high, low, df = make_bars()
    n = len(close)

    aware_c1 = level_aware_everybar(close, high, low, n)                    # aware, cadence=1
    aware_c10 = hold_at_cadence(aware_c1, PROD_CADENCE)                     # aware, cadence=10 (held)
    blind_c1 = level_blind_at_cadence(df, n, 1)                             # blind, cadence=1
    blind_c10 = level_blind_at_cadence(df, n, PROD_CADENCE)                 # blind, cadence=10 (held) == TODAY's production baseline

    print(f"seed={SEED} n_bars={n} production_cadence={PROD_CADENCE}\n")

    print("=== FOUR CELLS (level-awareness x cadence) ===")
    cells = [
        ("aware,   cadence=1 (every-bar)          ", aware_c1),
        ("aware,   cadence=10 (held)               ", aware_c10),
        ("blind,   cadence=1 (every-bar)          ", blind_c1),
        ("blind,   cadence=10 (held) == PRODUCTION BASELINE TODAY", blind_c10),
    ]
    descs = {}
    for label, arr in cells:
        d = describe(arr)
        descs[label] = d
        print(f"  {label:<58} bars_true={d['bars_true']:>5} ({d['pct_true']:>5.2f}%)  entries={d['entries']:>4}")

    print("\n=== C2 / AXIS A -- LEVEL-AWARENESS varied, CADENCE held FIXED (the claimed mechanism) ===")
    print("  -- cadence fixed = every-bar (1) --")
    da1, db1 = describe(aware_c1), describe(blind_c1)
    print(f"    level-aware entries={da1['entries']:<4} bars_true={da1['bars_true']}")
    print(f"    level-blind entries={db1['entries']:<4} bars_true={db1['bars_true']}")
    print(f"    bar-level disagreement: {disagreement_pct(aware_c1, blind_c1)}%")
    print("  -- cadence fixed = every-10 held (production cadence) --")
    da10, db10 = describe(aware_c10), describe(blind_c10)
    print(f"    level-aware entries={da10['entries']:<4} bars_true={da10['bars_true']}")
    print(f"    level-blind entries={db10['entries']:<4} bars_true={db10['bars_true']}   <- today's production baseline")
    print(f"    bar-level disagreement: {disagreement_pct(aware_c10, blind_c10)}%")

    print("\n=== C3 / AXIS B -- CADENCE varied, LEVEL-AWARENESS held FIXED (the confound, R-079 sec.4.3) ===")
    print("  -- level-awareness fixed = ON (aware) -- [reproduces AR-083's own methodology] --")
    print(f"    cadence=every-bar     entries={da1['entries']:<4} bars_true={da1['bars_true']}")
    print(f"    cadence=every-10-held entries={da10['entries']:<4} bars_true={da10['bars_true']}")
    print(f"    bar-level disagreement: {disagreement_pct(aware_c1, aware_c10)}%")
    print("  -- level-awareness fixed = OFF (blind) --")
    print(f"    cadence=every-bar     entries={db1['entries']:<4} bars_true={db1['bars_true']}")
    print(f"    cadence=every-10-held entries={db10['entries']:<4} bars_true={db10['bars_true']}")
    print(f"    bar-level disagreement: {disagreement_pct(blind_c1, blind_c10)}%")

    print("\n*** C4 NOTICE: the two axes above are reported SEPARATELY and are never combined into")
    print("*** one delta. blind_cadence10 (today's baseline) vs aware_cadence1 (today's routed")
    print("*** evaluator) is DELIBERATELY NOT computed as a single number anywhere in this script")
    print("*** -- that confounded comparison is exactly the ~5x swing AR-083 caught.")

    # ── ANTI-VACUITY ──────────────────────────────────────────────────────────────────────
    # A guard that can never fail is worthless (same doctrine as levelzone_premise_audit.py's
    # leg-1 guard and test_levelzone_routing.py's classifier anti-vacuity companion). Each check
    # below is mutation-tested externally (see the packet return): breaking the thing it protects
    # must make THIS check fail, not silently pass.
    ok = True
    for label, arr in cells:
        if arr.all() or not arr.any():
            print(f"\nFAIL anti-vacuity: '{label.strip()}' is degenerate (all-True or all-False) "
                  f"-- a constant signal proves nothing about either axis.")
            ok = False
    if np.array_equal(aware_c1, blind_c1):
        print("\nFAIL anti-vacuity: level-aware and level-blind are IDENTICAL at cadence=1 -- "
              "axis A (C2) could never detect a real level-awareness regression on this fixture.")
        ok = False
    if np.array_equal(aware_c1, aware_c10):
        print("\nFAIL anti-vacuity: cadence=1 and cadence=10-held are IDENTICAL under level-aware -- "
              "axis B (C3) could never detect a real cadence regression on this fixture.")
        ok = False
    if np.array_equal(blind_c1, blind_c10):
        print("\nFAIL anti-vacuity: cadence=1 and cadence=10-held are IDENTICAL under level-blind -- "
              "axis B (C3)'s cross-check could never detect a real cadence regression either.")
        ok = False

    print(f"\n{'PASS' if ok else 'FAIL'}: cadence-isolation harness "
          f"{'ran cleanly, both axes non-degenerate, and no combined delta was reported.' if ok else 'FAILED anti-vacuity -- see above.'}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
