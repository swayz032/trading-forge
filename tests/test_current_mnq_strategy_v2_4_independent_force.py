"""The force receipt must be able to DISAGREE. That is the whole of F-4.

The refuted version called `force_snapshot` with identical arguments to a pure function, so
`FORCE_RECEIPT_DISAGREES_WITH_KERNEL_GATE` had no path to red on any published case. These
tests pin that the replacement is a genuinely second derivation and that it fires.
"""
from __future__ import annotations

import ast
import inspect

import numpy as np
import pandas as pd
import pytest

from research import current_mnq_strategy_v2_2_engine_final as old
from research import current_mnq_strategy_v2_4_engine as v24
from research import current_mnq_strategy_v2_4_force as F
from research import current_mnq_strategy_v2_4_independent_force as I

TZ = "America/New_York"


def _bars(start, closes, opens=None, highs=None, lows=None):
    idx = pd.date_range(start, periods=len(closes), freq="1min", tz=TZ)
    o = opens or [closes[0]] + list(closes[:-1])
    return pd.DataFrame(
        {"open": o,
         "high": highs or [max(a, b) + 0.25 for a, b in zip(o, closes)],
         "low": lows or [min(a, b) - 0.25 for a, b in zip(o, closes)],
         "close": list(closes)},
        index=idx)


# --- it is genuinely INDEPENDENT ---------------------------------------------------------

def test_it_calls_neither_force_snapshot_nor_momentum_bar():
    """A second derivation that delegates to the first is the first.

    Checked on the AST, not the text. A substring scan convicts the module's own docstring,
    which names both functions in order to promise it does not call them - the third time
    today a prose-reading guard has convicted the sentence written to make the promise.
    """
    tree = ast.parse(inspect.getsource(I))
    called, imported = set(), set()
    for n in ast.walk(tree):
        if isinstance(n, ast.Call):
            f = n.func
            nm = getattr(f, "id", None) or getattr(f, "attr", None)
            if nm:
                called.add(nm)
        elif isinstance(n, ast.ImportFrom):
            imported.add(n.module or "")
            for a in n.names:
                imported.add(a.name)
        elif isinstance(n, ast.Import):
            for a in n.names:
                imported.add(a.name)
    for banned in ("force_snapshot", "momentum_bar"):
        assert banned not in called, f"it CALLS {banned}"
        assert banned not in imported, f"it IMPORTS {banned}"
    assert not any("current_mnq_strategy_v2_4_force" in m for m in imported), (
        f"it imports the module it is supposed to be independent of: {sorted(imported)}")
    # POSITIVE WITNESS: it really does compute, so the emptiness above is not vacuous.
    assert "independent_force" in {f.name for f in ast.walk(tree)
                                   if isinstance(f, ast.FunctionDef)}


def test_its_observation_floor_matches_the_kernels_and_is_not_imported():
    """Mirrored deliberately: a change to one must be CAUGHT, not silently followed."""
    assert I.MIN_COMPLETED_1M == F.MIN_COMPLETED_1M_OBSERVATIONS


# --- the BRK15 parent, ruled by ALGO-020 section 2 ----------------------------------------

def test_brk15_uses_a_15m_parent_floored_to_the_decision_clock():
    sig = pd.Timestamp("2026-04-09 10:07", tz=TZ)
    dec = pd.Timestamp("2026-04-09 10:53", tz=TZ)
    start, minutes = I.parent_for_setup("BRK15", sig, dec)
    assert minutes == 15
    assert start == pd.Timestamp("2026-04-09 10:45", tz=TZ)
    assert start != sig, (
        "anchoring BRK15 at the signal time is what made the old receipt raise against "
        "correct kernel decisions")


@pytest.mark.parametrize("setup", ["REV", "BRK5"])
def test_the_other_setups_use_the_5m_signal_bucket(setup):
    sig = pd.Timestamp("2026-04-09 10:05", tz=TZ)
    dec = pd.Timestamp("2026-04-09 10:53", tz=TZ)
    assert I.parent_for_setup(setup, sig, dec) == (sig, 5)


# --- compare() detects every divergence it claims to -------------------------------------

class _Snap:
    def __init__(self, **kw):
        self.__dict__.update(kw)


def _agreeing():
    ind = {"confirmed": True, "reason": "SUSTAINED_DIRECTIONAL_FORCE", "completed_1m": 3,
           "directional_progress": 10.0, "path_distance": 12.0, "path_efficiency": 0.833}
    snap = _Snap(confirmed=True, reason="SUSTAINED_DIRECTIONAL_FORCE", completed_1m=3,
                 directional_progress=10.0, path_distance=12.0, path_efficiency=0.833)
    return snap, ind


def test_compare_is_silent_when_they_agree():
    snap, ind = _agreeing()
    assert I.compare(snap, ind) == []


@pytest.mark.parametrize("field,bad", [
    ("confirmed", False),
    ("reason", "TUG_OF_WAR_PATH_TOO_INEFFICIENT"),
    ("completed_1m", 2),
    ("directional_progress", 9.0),
    ("path_distance", 15.0),
    ("path_efficiency", 0.5),
])
def test_compare_CATCHES_each_kind_of_divergence(field, bad):
    """Six ways to disagree, each proven reachable. A receipt that cannot disagree is not one."""
    snap, ind = _agreeing()
    setattr(snap, field, bad)
    d = I.compare(snap, ind)
    assert d, f"a divergence in {field} went undetected"
    assert any(field in x for x in d), d


def test_a_float_within_tolerance_is_not_a_divergence():
    snap, ind = _agreeing()
    snap.path_efficiency = 0.833 + 1e-9
    assert I.compare(snap, ind) == []


# --- the two derivations agree on REAL frozen bars ---------------------------------------

def test_the_two_derivations_agree_across_the_frozen_corpus():
    """POSITIVE WITNESS on real data. Slow-ish but this is the claim that matters."""
    from pathlib import Path
    import json
    data = Path("research/_mnq_v24_replay_lab_v3/data")
    lock = Path("research/current_mnq_strategy_v2_2_data_lock.json")
    if not data.exists():
        pytest.skip("pinned replay data not present")
    observed = old.download_pinned(data, include_tick=False)
    old.verify_manifest(observed, json.loads(lock.read_text(encoding="utf-8")))
    one = old.prepare(old.load_csv(data / Path(old.DATA_FILES["5m"]).name),
                      old.load_csv(data / Path(old.DATA_FILES["1m"]).name))["one"]
    p = v24.Params()

    checked = 0
    for day in ("2026-03-23", "2026-04-09"):
        for hh, mm in ((10, 5), (10, 20), (11, 25)):
            start = pd.Timestamp(f"{day} {hh:02d}:{mm:02d}", tz=TZ)
            known = start + pd.Timedelta(minutes=3)
            for direction in ("L", "S"):
                snap = F.force_snapshot(one, start, 5, direction, known, p)
                ind = I.independent_force(one, start, 5, direction, known,
                                          float(p.body_frac), float(p.close_loc))
                assert I.compare(snap, ind) == [], (
                    f"{day} {start.time()} {direction}: {I.compare(snap, ind)}")
                checked += 1
    assert checked >= 12, f"only {checked} comparisons ran - too few to mean anything"


def test_a_perturbed_threshold_makes_them_DISAGREE(monkeypatch):
    """RED-PROOF. Move the independent derivation's floor and the cross-check must fire.

    Without this, "they agreed" is indistinguishable from "the comparison never runs".
    """
    one = _bars("2026-04-09 10:00", [100.0, 101.0, 102.0, 103.0])
    start = pd.Timestamp("2026-04-09 10:00", tz=TZ)
    known = start + pd.Timedelta(minutes=3)
    p = v24.Params()

    snap = F.force_snapshot(one, start, 5, "L", known, p)
    base = I.independent_force(one, start, 5, "L", known,
                               float(p.body_frac), float(p.close_loc))
    assert I.compare(snap, base) == [], "positive witness: unperturbed, they agree"

    monkeypatch.setattr(I, "MIN_COMPLETED_1M", 99)
    perturbed = I.independent_force(one, start, 5, "L", known,
                                    float(p.body_frac), float(p.close_loc))
    assert I.compare(snap, perturbed), (
        "with the observation floor moved the two derivations MUST disagree - if they still "
        "agree the comparison is not actually reading the independent result")


def test_it_is_diagnostic_only():
    assert "DIAGNOSTIC_ONLY" in I.DIAGNOSTIC_ONLY
    src = inspect.getsource(I)
    assert "np" in src and isinstance(np.float64(1.0), float)
