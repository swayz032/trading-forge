#!/usr/bin/env python3
"""LEVEL/ZONE SUB-WIRE PREMISE AUDIT (R-079 §4 law, R-090 §5 unblock).

The premise-audit law exists because WIRE-1's mechanism claim was never tested: feeding
`compute_structure_state` a real HTF frame moved NONE of the nine fields the column read,
so a graded, licensed fidelity headline had to be withdrawn. Every remaining wire owes its
mechanism a DIRECT test at spike time: vary Y, hold all else, watch X move.

The level/zone claim is: routing level/zone conditions to a level-aware detector produces a
binding that responds to WHICH level the trader named. That has two legs, and BOTH must
hold or the sub-wire is WIRE-1 again:

  LEG 1 — is the NEW detector live?      vary `level`, hold bars, watch the binding move.
  LEG 2 — is the CURRENT binding blind?  if today's primitive already discriminates levels,
                                         re-routing buys nothing and the premise is empty.

Leg 2 is the leg WIRE-1 skipped. A live new detector alone proves nothing about the gain.

Replay-deterministic: fixed seed, synthetic bars, no DB, no clock, no network.
"""

import inspect
import sys
from dataclasses import fields, is_dataclass

import numpy as np
import polars as pl

sys.path.insert(0, ".")
from src.engine.context.structure_engine import compute_structure_state  # noqa: E402
from src.engine.spec_condition_compiler import retest_touch_check  # noqa: E402

SEED, N = 20260720, 300


def make_bars():
    rng = np.random.default_rng(SEED)
    close = 100 + np.cumsum(rng.normal(0, 0.5, N))
    return close, close + 0.4, close - 0.4


def leg1_new_detector_is_live(close, high, low):
    atr = np.full(N, 1.0)
    cases = {
        "level_near_100": np.full(N, 100.0),   # near price
        "level_far_140": np.full(N, 140.0),    # far from price
        "level_hugs_price": close - 0.05,      # tracking price
    }
    out = {k: retest_touch_check(close, high, low, v, atr) for k, v in cases.items()}
    for k, v in out.items():
        print(f"  {k:<18} touches={int(v.sum()):>4} / {N}")

    moves = (not np.array_equal(out["level_near_100"], out["level_far_140"])
             and not np.array_equal(out["level_near_100"], out["level_hugs_price"]))
    # ANTI-VACUITY: a detector stuck all-on or all-off in EVERY case would be useless.
    # Deliberately ALL, not ANY: a constant output for ONE case is correct behaviour —
    # a level 40 points away should yield zero touches, and that all-zero series IS the
    # negative polarity. The first draft of this guard used `any(...)` and FAILED a
    # detector that was working perfectly, because it read a correct negative result as
    # degeneracy. An over-strict guard is its own defect: it would have blocked a valid
    # sub-wire with a green-looking "premise fails".
    degenerate = all(np.all(v == v[0]) for v in out.values())
    both_polarities = any(v.sum() == 0 for v in out.values()) and any(v.sum() > 0 for v in out.values())
    print(f"  LEG 1: binding moves with level = {moves} | degenerate = {degenerate} "
          f"| both polarities exercised = {both_polarities}")
    return moves and not degenerate and both_polarities


def leg2_current_binding_is_blind():
    close, high, low = make_bars()
    df = pl.DataFrame({"open": close, "high": high, "low": low, "close": close,
                       "volume": np.full(N, 1000.0)})
    sig = inspect.signature(compute_structure_state)
    accepts_level = any(("level" in p.lower() or "zone" in p.lower()) for p in sig.parameters)
    s1, s2 = compute_structure_state(df, df), compute_structure_state(df, df)
    identical = (is_dataclass(s1)
                 and all(getattr(s1, f.name) == getattr(s2, f.name) for f in fields(s1)))
    print(f"  signature: {sig}")
    print(f"  LEG 2: accepts a level/zone argument = {accepts_level} | "
          f"any two level/zone conditions get an identical signal = {identical}")
    return (not accepts_level) and identical


def main():
    close, high, low = make_bars()
    print("=== LEG 1 — is the NEW detector (retest_touch_check) live? ===")
    leg1 = leg1_new_detector_is_live(close, high, low)
    print("\n=== LEG 2 — is the CURRENT binding (structure_engine) level-blind? ===")
    leg2 = leg2_current_binding_is_blind()

    print("\n=== VERDICT ===")
    if leg1 and leg2:
        print("  PREMISE HOLDS. The new detector responds to WHICH level was named; the")
        print("  current primitive takes no level input at all, so today 'support at 100'")
        print("  and 'resistance at 140' bind to the IDENTICAL signal. The gain is")
        print("  structural, not incremental — and it is the OPPOSITE of WIRE-1, whose")
        print("  mechanism moved nothing.")
    else:
        print(f"  PREMISE FAILS (leg1={leg1}, leg2={leg2}) — do NOT build. "
              f"{'New detector inert.' if not leg1 else 'Current binding already discriminates; re-routing buys nothing.'}")
    return 0 if (leg1 and leg2) else 1


if __name__ == "__main__":
    sys.exit(main())
