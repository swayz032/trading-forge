"""Measure which invariants can PASS because their input was ABSENT.

R-612 §4.2 asked for a per-invariant table the desk can re-derive rather than a
count read off the source. This probe answers the property directly and
mechanically: hand each invariant a result dict that declares trades were taken
but carries NO metrics at all, and record the verdict.

    PASS on an empty result  -> the predicate is satisfiable by absence (BLIND)
    FAIL on an empty result  -> absence is detected (GUARDED)

A second column runs the same check on a fully-populated good result, so a row
that reads BLIND cannot be confused with a check that simply always fails, and a
row that reads GUARDED cannot be confused with one that always fails either.

Usage:
    TF_ALLOW_FIXED_1=true PYTHONPATH=<repo root> python scripts/invariant_absence_sweep.py
"""
from __future__ import annotations

import sys

from src.engine.invariant_harness import core as C

# The population under test: every check registered in the harness itself, read
# from the harness's own registry rather than a hand-kept list here — a
# hand-kept list is exactly the self-certifying-collection defect.
if hasattr(C, "_CRITICAL_CHECKS") and hasattr(C, "_WARNING_CHECKS"):
    CHECKS = list(C._CRITICAL_CHECKS) + list(C._WARNING_CHECKS)
else:
    CHECKS = None


def _good() -> dict:
    starting = 50_000.0
    total_return, n = 2_000.0, 10
    avg = total_return / n
    bars = [starting + (total_return / 100) * i for i in range(101)]
    return {
        "starting_balance": starting,
        "ending_balance": starting + total_return,
        "total_return": total_return,
        "total_trades": n,
        "win_rate": 0.6,
        "profit_factor": 1.8,
        "sharpe_ratio": 1.5,
        "max_drawdown": 800.0,
        "avg_trade_pnl": avg,
        "trades": [{"Direction": "Long" if i < 5 else "Short", "PnL": avg,
                    "CommissionCost": 1.24, "Size": 1.0} for i in range(n)],
        "daily_pnls": [total_return / 10] * 10,
        "equity_bars": bars,
        "equity_curve": [{"time": f"2025-01-{i+1:02d}", "value": v}
                         for i, v in enumerate(bars[::10])],
        "long_short_split": {"long": {"trades": 5, "pnl": avg * 5},
                             "short": {"trades": 5, "pnl": avg * 5}},
        "prop_compliance": {"topstep": {"starting_balance": starting,
                                        "ending_balance": starting + total_return,
                                        "ending_balance_uncapped": starting + total_return}},
    }


def _verdict(fn, result: dict) -> str:
    try:
        return "PASS" if fn(result).passed else "FAIL"
    except Exception as exc:                                  # noqa: BLE001
        return f"RAISED({type(exc).__name__})"


def main() -> int:
    if CHECKS is None:
        print("could not read the harness registry (_ALL_CHECKS) — refusing to "
              "substitute a hand-kept list", file=sys.stderr)
        return 2

    # "trades were taken" is the only fact asserted; every metric is absent.
    empty = {"total_trades": 10}

    rows = []
    for fn in CHECKS:
        on_empty = _verdict(fn, dict(empty))
        on_good = _verdict(fn, _good())
        blind = on_empty == "PASS"
        rows.append((fn.__name__, on_empty, on_good, blind))

    width = max(len(r[0]) for r in rows)
    print(f"{'invariant':<{width}}  {'absent-input':<14}  {'good-input':<12}  verdict")
    print("-" * (width + 44))
    for name, on_empty, on_good, blind in rows:
        print(f"{name:<{width}}  {on_empty:<14}  {on_good:<12}  "
              f"{'BLIND-TO-ABSENCE' if blind else 'guarded'}")

    blind_n = sum(1 for r in rows if r[3])
    print(f"\n{blind_n} of {len(rows)} invariants PASS on a result whose metrics are absent.")
    # Every check must still pass on good data, or the table is measuring a
    # broken harness rather than a blind one.
    bad = [r[0] for r in rows if r[2] != "PASS"]
    print(f"control — checks failing on GOOD data: {bad if bad else 'none'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
