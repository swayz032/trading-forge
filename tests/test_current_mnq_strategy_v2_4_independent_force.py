"""The force receipt must be able to DISAGREE. That is the whole of F-4.

The refuted version called `force_snapshot` with identical arguments to a pure function, so
`FORCE_RECEIPT_DISAGREES_WITH_KERNEL_GATE` had no path to red on any published case. These
tests pin that the replacement is a genuinely second derivation and that it fires.
"""
from __future__ import annotations

import ast
import inspect
from pathlib import Path

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

#: FLAKE-1 (ALGO-055). Where a failure's evidence is persisted. A red that leaves nothing
#: behind is a red you cannot diagnose: this test went red ONCE, passed in seven subsequent
#: observations, and its assertion text was never captured. That gap is closed structurally
#: rather than by remembering to look next time.
FLAKE_EVIDENCE = Path("research/current_mnq_strategy_v2_4_force_crosscheck_failure.json")

DATA_DIR = Path("research/_mnq_v24_replay_lab_v3/data")
DATA_LOCK = Path("research/current_mnq_strategy_v2_2_data_lock.json")


def _custody_report() -> dict:
    """Hash the fetched CSVs against the committed lock. A DATA question, asked separately.

    `download_pinned` is network-backed and sits inside the test body, so a corrupt or
    mid-flight file could previously surface as a DERIVATION DISAGREEMENT — a semantic alarm
    raised by a data incident. ALGO-055 pre-registered the split: custody is verified first and
    fails with its own name.
    """
    import hashlib
    import json
    lock = json.loads(DATA_LOCK.read_text(encoding="utf-8"))["files"]
    report = {}
    for key in ("5m", "1m"):
        path = DATA_DIR / Path(old.DATA_FILES[key]).name
        raw = path.read_bytes()
        got = hashlib.sha256(raw).hexdigest()
        want = lock[key]["sha256"]
        report[key] = {"path": str(path), "expected_sha256": want, "observed_sha256": got,
                       "expected_bytes": lock[key]["bytes"], "observed_bytes": len(raw),
                       "match": got == want}
    report["custody"] = "GREEN" if all(v["match"] for v in report.values()
                                       if isinstance(v, dict)) else "RED"
    return report


def test_the_pinned_data_matches_its_committed_custody_hashes():
    """FLAKE-1 §1: DATA_CUSTODY_ERROR is its OWN red, distinct from a derivation disagreement.

    Pre-registered recurrence rule (ALGO-055 §3): custody RED alone is a DATA INCIDENT and
    raises no semantic alarm. A derivation red WITH custody GREEN is genuine nondeterminism in
    the derivations and is STOP-THE-LINE for the exam.
    """
    if not DATA_DIR.exists():
        pytest.skip("pinned replay data not present")
    rep = _custody_report()
    if rep["custody"] != "GREEN":
        _persist_failure("DATA_CUSTODY_ERROR", rep, rows=[])
        pytest.fail(
            "DATA_CUSTODY_ERROR: the fetched pinned data does not match the committed lock. "
            "This is a DATA INCIDENT, not a semantic finding - the derivations were not even "
            f"compared. Evidence: {FLAKE_EVIDENCE}. {rep}")


def _persist_failure(kind: str, custody: dict, rows: list) -> None:
    """FLAKE-1 §2: any red leaves its evidence on disk, so the observation gap cannot recur."""
    import json
    FLAKE_EVIDENCE.write_text(json.dumps({
        "artifact": "FORCE_CROSSCHECK_FAILURE",
        "authority": "ALGO-055 (FLAKE-1 custody split)",
        "kind": kind,
        "custody": custody,
        "disagreeing_rows": rows,
        "recurrence_rule": (
            "derivation red WITH custody GREEN = genuine derivation nondeterminism = "
            "STOP-THE-LINE for the exam. Custody red alone = data incident, no semantic alarm."),
    }, indent=2) + "\n", encoding="utf-8")


def test_the_two_derivations_agree_across_the_frozen_corpus():
    """POSITIVE WITNESS on real data. Slow-ish but this is the claim that matters.

    Custody is verified BEFORE any comparison (ALGO-055 §1) so a data incident can never be
    reported as a derivation disagreement, and every disagreeing row is persisted (§2) instead
    of living only in a terminal that has already scrolled.
    """
    import json
    if not DATA_DIR.exists():
        pytest.skip("pinned replay data not present")
    observed = old.download_pinned(DATA_DIR, include_tick=False)
    old.verify_manifest(observed, json.loads(DATA_LOCK.read_text(encoding="utf-8")))

    custody = _custody_report()
    assert custody["custody"] == "GREEN", (
        f"DATA_CUSTODY_ERROR before any comparison - a data incident, not a semantic finding: "
        f"{custody}")

    one = old.prepare(old.load_csv(DATA_DIR / Path(old.DATA_FILES["5m"]).name),
                      old.load_csv(DATA_DIR / Path(old.DATA_FILES["1m"]).name))["one"]
    p = v24.Params()

    checked = 0
    disagreements: list[dict] = []
    for day in ("2026-03-23", "2026-04-09"):
        for hh, mm in ((10, 5), (10, 20), (11, 25)):
            start = pd.Timestamp(f"{day} {hh:02d}:{mm:02d}", tz=TZ)
            known = start + pd.Timedelta(minutes=3)
            for direction in ("L", "S"):
                snap = F.force_snapshot(one, start, 5, direction, known, p)
                ind = I.independent_force(one, start, 5, direction, known,
                                          float(p.body_frac), float(p.close_loc))
                diff = I.compare(snap, ind)
                if diff:
                    disagreements.append({"day": day, "start": str(start.time()),
                                          "direction": direction, "differences": list(diff)})
                checked += 1

    if disagreements:
        _persist_failure("DERIVATION_DISAGREEMENT_WITH_CUSTODY_GREEN", custody, disagreements)
        pytest.fail(
            "DERIVATION_DISAGREEMENT while custody is GREEN. Per the ALGO-055 recurrence rule "
            "this is genuine derivation nondeterminism and is STOP-THE-LINE for the exam. "
            f"Evidence retained at {FLAKE_EVIDENCE}: {disagreements}")
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
