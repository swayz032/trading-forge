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

import json
import os
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


# ─── R-615 §4.2: the THIRD category ──────────────────────────────────────────
# The two-column table above cannot tell BLIND from UNFALSIFIABLE, because a
# tautology passes the absence probe in exactly the same way a merely-blind
# check does.  R-615 §3 convicted this instrument for that, using INV-1
# (_check_balance_arithmetic), whose `ending` DEFAULTS to `starting +
# total_return` — the identical expression it is then compared against.
#
# The discriminator is an ADVERSARIAL SEARCH over the absent-input class:
#   take the absent base, drive ONE field at a time to a hostile value, and ask
#   whether ANY of them makes the check return False.
#     at least one FAIL  -> falsifiable; it is merely BLIND to absence
#     no FAIL anywhere   -> nothing in the searched space can falsify it
#
# ⚠ BOUNDED SEARCH.  "No FAIL found" is NOT a proof of unfalsifiability — it is
# the absence of a counterexample in this space.  The verdict is therefore
# reported as NO-FAIL-FOUND, and a claim of true tautology needs a source-level
# argument as well (INV-1 has one: R-615 §1, read at the executable line).

_HOSTILE_SCALARS = [
    0.0, -1.0, 1.0, 1e12, -1e12, 0.5, 100.0,
    float("inf"), float("-inf"), float("nan"),
]


def _reachable_keys() -> set[str]:
    """Top-level keys a REAL backtest result actually carries.

    ⚠ THIS IS THE CORRECTION THAT MAKES THE THIRD COLUMN MEAN ANYTHING.
    A first version of this search drew hostile fields from the GOOD fixture's
    key space, which INCLUDES `ending_balance` — a key no engine path emits.
    Handing INV-1 that key leaves the absent class entirely, and the search duly
    reported INV-1 as "falsifiable", contradicting R-615 §1's source-level proof
    that it is an identity.  The search space, not the check, was wrong.

    The set is read from a frozen artifact captured at the run_invariants() call
    site of real run_backtest() runs.  NO FALLBACK: a missing artifact aborts,
    because silently reverting to the good-fixture key space is exactly the
    defect above.
    """
    path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                        "docs", "replay-results", "inv-reachable-keys-2026-08-03.json")
    with open(path, encoding="utf-8") as fh:
        return set(json.load(fh)["reachable_top_level_keys"])


def _hostile_variants(base: dict) -> list[tuple[str, dict]]:
    """One-field-at-a-time hostile mutations layered on `base`.

    Restricted to keys the engine can actually emit (`_reachable_keys`), so a
    variant is always an input the system could really produce.
    """
    variants: list[tuple[str, dict]] = []
    good = _good()
    reachable = _reachable_keys()
    for key, good_val in good.items():
        if key not in reachable:
            continue
        if isinstance(good_val, (int, float)):
            for hv in _HOSTILE_SCALARS:
                v = dict(base)
                v[key] = hv
                variants.append((f"{key}={hv}", v))
        elif isinstance(good_val, list):
            # Hostile list VALUES, not just hostile list shapes.  A family of
            # [], [None], good, reversed(good) never drives a magnitude out of
            # range, so it cannot falsify a check that tests magnitudes
            # (INV-8 peak-equity, INV-12 commission) — measured 2026-08-03.
            numeric_extremes = [
                [0.0], [-1e9], [1e12], [1.0] * len(good_val),
                [{"CommissionCost": 1e6, "PnL": 1e6, "Direction": "Long", "Size": 1.0}],
                [{"time": "2025-01-01", "value": 0.0}],
            ]
            for hv in ([], [None], good_val, list(reversed(good_val)), *numeric_extremes):
                v = dict(base)
                v[key] = hv
                variants.append((f"{key}=<list len {len(hv)} {str(hv)[:28]}>", v))
        elif isinstance(good_val, dict):
            for label, hv in (("{}", {}), ("good", good_val)):
                v = dict(base)
                v[key] = hv
                variants.append((f"{key}={label}", v))
    return variants


def _falsify(fn, base: dict) -> tuple[bool, str]:
    """Search for one input in the hostile family on which `fn` returns False.

    TWO BASES, both restricted to reachable keys:
      - the ABSENT base (metrics missing), and
      - the GOOD base (metrics present and self-consistent).

    One base is not enough.  Several checks early-return `passed=True` when
    their subject field is missing, so from the absent base a single-field
    mutation can never reach their comparison at all — INV-5 needs a populated
    long_short_split AND a mismatched total_trades together.  Searching from the
    good base supplies the first for free and mutates the second, which turns a
    two-field problem back into a one-field one.
    """
    # The GOOD base must be reachability-filtered TOO.  Unfiltered, it carries
    # `ending_balance` — and handing INV-1 that key falsifies it instantly,
    # which is the same error as mutating an unreachable key, just moved into
    # the base.  Measured 2026-08-03: unfiltered, INV-1 reported falsifiable
    # via [good] total_return=0.0.
    reachable = _reachable_keys()
    good_reachable = {k: v for k, v in _good().items() if k in reachable}
    for base_name, b in (("absent", base), ("good", good_reachable)):
        for label, variant in _hostile_variants(b):
            if _verdict(fn, variant) == "FAIL":
                return True, f"[{base_name}] {label}"
    return False, ""


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
        # THIRD CATEGORY: only meaningful for checks that pass on absence.
        if blind:
            found, witness = _falsify(fn, dict(empty))
            cat = "BLIND (falsifiable)" if found else "UNFALSIFIABLE?"
        else:
            found, witness, cat = True, "(fails on absence)", "guarded"
        rows.append((fn.__name__, on_empty, on_good, blind, cat, witness))

    width = max(len(r[0]) for r in rows)
    print(f"{'invariant':<{width}}  {'absent-input':<14}  {'good-input':<12}  verdict")
    print("-" * (width + 44))
    for name, on_empty, on_good, blind, _cat, _w in rows:
        print(f"{name:<{width}}  {on_empty:<14}  {on_good:<12}  "
              f"{'BLIND-TO-ABSENCE' if blind else 'guarded'}")

    blind_n = sum(1 for r in rows if r[3])
    print(f"\n{blind_n} of {len(rows)} invariants PASS on a result whose metrics are absent.")
    # Every check must still pass on good data, or the table is measuring a
    # broken harness rather than a blind one.
    bad = [r[0] for r in rows if r[2] != "PASS"]
    print(f"control — checks failing on GOOD data: {bad if bad else 'none'}")

    # ─── R-615 §4.2 re-publication: three categories, not two ───────────────
    print(f"\n{'=' * (width + 44)}")
    print("R-615 §4.2 — THREE-WAY TABLE (adversarial search over the absent class)")
    print(f"{'=' * (width + 44)}")
    print(f"{'invariant':<{width}}  {'category':<22}  falsifying witness")
    print("-" * (width + 44))
    for name, _e, _g, _b, cat, witness in rows:
        print(f"{name:<{width}}  {cat:<22}  {witness}")

    n_guarded = sum(1 for r in rows if r[4] == "guarded")
    n_blind = sum(1 for r in rows if r[4] == "BLIND (falsifiable)")
    n_unfals = sum(1 for r in rows if r[4] == "UNFALSIFIABLE?")
    print(f"\nguarded={n_guarded}  BLIND-but-falsifiable={n_blind}  "
          f"UNFALSIFIABLE?={n_unfals}   (total {len(rows)})")

    # POSITIVE CONTROL on the SEARCH ITSELF: if the hostile family never
    # falsifies anything, the searcher is broken and every UNFALSIFIABLE? row
    # is an instrument artefact rather than a finding.
    print(f"control — searcher found a falsifying input for {n_blind} of "
          f"{n_blind + n_unfals} absence-passing checks; "
          f"{'SEARCHER LIVE' if n_blind > 0 else 'SEARCHER DEAD — do not trust the UNFALSIFIABLE? column'}")
    print("NOTE: UNFALSIFIABLE? = no counterexample in a BOUNDED search. "
          "It is a nomination, not a proof; confirm at the executable line.")

    # State the search space explicitly: which fixture keys were EXCLUDED as
    # unreachable is the whole reason the third column separates from the first.
    excluded = sorted(set(_good()) - _reachable_keys())
    print(f"\nsearch space = keys the engine really emits; EXCLUDED as unreachable "
          f"({len(excluded)}): {excluded}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
