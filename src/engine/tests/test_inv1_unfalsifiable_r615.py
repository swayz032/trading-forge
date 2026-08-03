"""R-615 §4.1 / §4.2 (LANE-7) — INV-1 cannot fail on any REACHABLE input.

TRIPWIRE FOR A KNOWN-BROKEN STATE.  These tests assert BOTH halves, so they
fail loudly whichever way the state changes:

  1. INV-1 passes on every reachable-shaped input          (the defect, pinned)
  2. INV-1 CAN fail once `ending_balance` is supplied       (green control:
     the check is not simply broken — it is starved of its input)

When the desk rules on the disposition (repair / disable / delete, R-615 §4.1),
test 1 MUST start failing.  That is the point: a silent repair cannot land
without tripping this file.

Plus a red-proof of the DETECTOR added to scripts/invariant_absence_sweep.py:
it must flag a planted tautology and must NOT flag a planted real check.
"""
from __future__ import annotations

import importlib.util
import json
import os

import pytest

from src.engine.invariant_harness import core as C

# src/engine/tests/<this file> -> up FOUR levels to reach the repo root.
_REPO = os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.dirname(os.path.abspath(__file__)))))
_ARTIFACT = os.path.join(_REPO, "docs", "replay-results",
                         "inv-reachable-keys-2026-08-03.json")


def _reachable() -> dict:
    with open(_ARTIFACT, encoding="utf-8") as fh:
        return json.load(fh)


# ─── 1. The frozen reachable key set ─────────────────────────────────────────

def test_engine_never_emits_the_two_balance_keys():
    """The join-key fact the whole finding rests on."""
    keys = set(_reachable()["reachable_top_level_keys"])
    # POSITIVE CONTROL first: if these are missing the artifact is not a real
    # backtest result and the absence below would prove nothing.
    for control in ("total_return", "max_drawdown", "profit_factor", "total_trades"):
        assert control in keys, f"artifact is not a real result — {control} missing"

    assert "ending_balance" not in keys
    assert "starting_balance" not in keys


# ─── 2. INV-1 on reachable input: the pinned defect ──────────────────────────

@pytest.mark.parametrize("total_return", [0.0, -16.22, 1_000.0, -50_000.0, 1e9])
@pytest.mark.parametrize("total_trades", [0, 3, 10_000])
def test_inv1_always_passes_on_reachable_input(total_return, total_trades):
    """No reachable result carries `ending_balance`, so INV-1 is an identity.

    R-615 §1 proved this at the executable line (:173 defaults `ending` to the
    same expression :175 computes as `expected`).  This asserts the behaviour.
    """
    result = {"total_return": total_return, "total_trades": total_trades}
    check = C._check_balance_arithmetic(result)

    # POSITIVE WITNESS that the check actually ran and is the one we mean —
    # a negative assertion ("never fails") is satisfied by a no-op otherwise.
    assert check.name == "balance_arithmetic"
    assert check.severity == "CRITICAL"

    assert check.passed is True
    # And the identity is exact, not merely within tolerance:
    assert "diff = 0.0000" in check.actual


def test_inv1_reports_a_balance_the_engine_never_produced():
    """The failure mode is worse than passing: it publishes an invented number."""
    check = C._check_balance_arithmetic({"total_return": -16.22, "total_trades": 3})
    assert check.passed is True
    # 50_000 - 16.22 — a value no engine path emitted, presented as `actual`.
    assert "49983.78" in check.actual


# ─── 3. Green control: the check is starved, not dead ────────────────────────

def test_inv1_can_fail_when_ending_balance_is_supplied():
    """Supply the key and INV-1 discriminates correctly — so the logic works.

    This is what separates "unfalsifiable because its input never arrives" from
    "unfalsifiable because the predicate is broken".
    """
    good = {"total_return": 1_000.0, "total_trades": 5,
            "ending_balance": 51_000.0}          # 50_000 + 1_000 — correct
    assert C._check_balance_arithmetic(good).passed is True

    bad = dict(good, ending_balance=57_000.0)    # the Topstep +$7K shape
    assert C._check_balance_arithmetic(bad).passed is False


# ─── 4. Red-proof of the DETECTOR itself ─────────────────────────────────────

def _load_sweep():
    path = os.path.join(_REPO, "scripts", "invariant_absence_sweep.py")
    spec = importlib.util.spec_from_file_location("_sweep", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_detector_flags_a_planted_tautology_and_spares_a_real_check():
    """The UNFALSIFIABLE column must detect the CLASS, not just INV-1.

    Without both arms this is untrustworthy: a detector that flags everything
    and a detector that flags nothing both 'agree' with a single-instance test.
    """
    sweep = _load_sweep()

    def planted_tautology(result: dict) -> C.InvariantCheck:
        """Same shape as INV-1: expected computed from its own default."""
        base = C._safe_float(result.get("total_return", 0.0))
        observed = C._safe_float(result.get("never_emitted_key", base))
        return C.InvariantCheck(
            name="planted_tautology", passed=abs(observed - base) <= 1.0,
            tolerance="$1.00", expected="identity", actual="identity",
            evidence="planted", severity="CRITICAL",
        )

    def planted_real_check(result: dict) -> C.InvariantCheck:
        """Reads a REACHABLE key and can genuinely fail."""
        wr = C._safe_float(result.get("win_rate", 0.5))
        return C.InvariantCheck(
            name="planted_real", passed=0.0 <= wr <= 1.0,
            tolerance="[0,1]", expected="win_rate in range", actual=f"{wr}",
            evidence="planted", severity="CRITICAL",
        )

    absent = {"total_trades": 10}

    taut_found, _ = sweep._falsify(planted_tautology, dict(absent))
    real_found, witness = sweep._falsify(planted_real_check, dict(absent))

    assert taut_found is False, "detector MISSED a planted tautology"
    assert real_found is True, "detector wrongly flagged a falsifiable check"
    assert "win_rate" in witness


def test_the_tripwire_itself_goes_red_on_a_repaired_inv1():
    """RED-PROOF OF THIS FILE.

    `test_inv1_always_passes_on_reachable_input` asserts a defect persists.  An
    assertion like that is worthless unless it is shown to BREAK when the defect
    is removed — otherwise it might be passing for an unrelated reason and would
    stay green straight through the repair.

    So: build the repaired check (no self-defaulting; absent input is NOT a
    pass) and confirm the pinned predicate fails on it.
    """
    def repaired_inv1(result: dict) -> C.InvariantCheck:
        starting = C._safe_float(result.get("starting_balance", C._STARTING_BALANCE))
        total_return = C._aggregate_metric(result, "total_return", 0.0)
        if "ending_balance" not in result:
            # cannot verify -> must not report a CRITICAL pass
            return C.InvariantCheck(
                name="balance_arithmetic", passed=False, tolerance="$1.00",
                expected="ending_balance present", actual="ending_balance ABSENT",
                evidence="engine emitted no ending_balance", severity="CRITICAL",
            )
        ending = C._safe_float(result["ending_balance"])
        diff = abs(ending - (starting + total_return))
        return C.InvariantCheck(
            name="balance_arithmetic", passed=diff <= 1.0, tolerance="$1.00",
            expected="", actual=f"diff = {diff:.4f}", evidence="", severity="CRITICAL",
        )

    reachable_input = {"total_return": -16.22, "total_trades": 3}

    # The CURRENT check passes (the pinned defect) ...
    assert C._check_balance_arithmetic(reachable_input).passed is True
    # ... and the REPAIRED one does not. The tripwire therefore discriminates.
    assert repaired_inv1(reachable_input).passed is False

    # And the repaired check still passes on a genuinely correct input, so the
    # red above is real detection and not a check that fails on everything.
    assert repaired_inv1({"total_return": 1_000.0, "total_trades": 5,
                          "ending_balance": 51_000.0}).passed is True


def test_detector_reproduces_the_r615_finding_on_inv1():
    """Second path to R-615 §1: mechanical search, no source reading."""
    sweep = _load_sweep()
    found, _ = sweep._falsify(C._check_balance_arithmetic, {"total_trades": 10})
    assert found is False, (
        "INV-1 became falsifiable on reachable input — if this is a deliberate "
        "repair, R-615 §4.1's disposition landed and this tripwire must be "
        "retired in the same commit."
    )
