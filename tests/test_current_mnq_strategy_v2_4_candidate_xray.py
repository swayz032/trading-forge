"""Candidate X-ray correspondence + diagnostic-only guards — ALGO-009 §4.

The X-ray MIRRORS `kernel.iter_actionable_candidates` because the kernel yields only the
single ranked winner per clock and discards the rest, so a wrapper cannot observe rejected
candidates. A mirror can drift. These tests pin the correspondence and the diagnostic-only
boundary.
"""
from __future__ import annotations

import inspect
import re
from types import SimpleNamespace

import pandas as pd

import pytest

from research import current_mnq_strategy_v2_4_candidate_xray as xray
from research import current_mnq_strategy_v2_4_kernel as kernel

# Every gate the production kernel consults must also be consulted by the X-ray, or the
# X-ray is diagnosing a different machine than the one that trades.
SHARED_GATES = (
    "reversal_story_v24",
    "displacement_sequence_prebreak",
    "repeat_test_momentum_prebreak",
    "breakout_followthrough_after_first_print",
    "force_snapshot",
    "plan_allows_v24",
    "decision_times",
    "build_premarket_plan_v24",
    "build_entry_locations_v24",
    "zone_state_at_v24",
    "active_fvg_interaction_locations",
    # The RANKER. It was missing from this tuple, and that omission is exactly how the X-ray
    # came to pick a different winner than the machine it claims to mirror.
    "_rank_and_yield",
)


def test_the_xray_consults_every_gate_the_kernel_consults():
    ksrc = inspect.getsource(kernel.iter_actionable_candidates)
    xsrc = inspect.getsource(xray.xray_session)
    missing = [g for g in SHARED_GATES if g in ksrc and g not in xsrc]
    assert not missing, (
        f"the kernel consults {missing} and the X-ray does not - the diagnosis would be of a "
        f"different machine than the one that trades"
    )


def test_the_xray_imports_the_gates_rather_than_reimplementing_them():
    """A reimplemented gate can agree today and diverge silently tomorrow."""
    src = inspect.getsource(xray)
    for g in SHARED_GATES:
        assert f"import" in src and g in src, g
    # It must not define its own version of any gate.
    for g in SHARED_GATES:
        assert f"def {g}(" not in src, f"the X-ray defines its own {g} instead of importing it"


def test_there_is_no_fifth_legal_route():
    """ALGO-009 §3 is explicit: four routes, no fifth."""
    assert len(xray.LEGAL_ROUTES) == 4
    assert set(xray.LEGAL_ROUTES) == {
        xray.ROUTE_A_REJECTION, xray.ROUTE_B_BREAKOUT,
        xray.ROUTE_C_DISPLACEMENT, xray.ROUTE_D_RETEST,
    }


def test_the_xray_is_diagnostic_only():
    """It must never trade, never consume a bullet, and never be imported by production."""
    src = inspect.getsource(xray)
    assert "DIAGNOSTIC ONLY" in src
    # Check the PROPERTY, not a word. A first version banned the substring "winner", which
    # this module legitimately uses to describe the RANKING winner - nothing to do with PnL.
    # What matters is that no outcome/PnL DATA is read.
    reads = re.findall(r"[.]get[(]['\"]([a-z_]+)['\"][)]|[[]['\"]([a-z_]+)['\"][]]", src)
    fields = {a or b for a, b in reads}
    outcome = {f for f in fields
               if any(k in f for k in ("pnl", "realized", "profit", "win", "loss"))}
    assert not outcome, f"the X-ray reads outcome fields: {sorted(outcome)}"
    # Nothing in production may import it.
    import pathlib
    for f in pathlib.Path("research").glob("current_mnq_strategy_v2_4_*.py"):
        if f.name.endswith("candidate_xray.py"):
            continue
        assert "candidate_xray" not in f.read_text(encoding="utf-8"), (
            f"{f.name} imports the X-ray - it is diagnostic only and must stay out of the "
            f"production path"
        )


def test_every_rejection_names_exactly_one_earliest_gate():
    """A candidate that dies without naming its gate teaches nothing."""
    gates = {v for k, v in vars(xray).items() if k.startswith("GATE_")}
    assert len(gates) >= 6
    src = inspect.getsource(xray.xray_session)
    for g in gates:
        name = [k for k, v in vars(xray).items() if v == g][0]
        assert name in src, f"{name} is declared but never used as a killing gate"


# ─────────────────────────────────────────────────────────────────────────────────────────
# RANKING CORRESPONDENCE.  A positive control on the story-ablation mirror caught the X-ray
# granting 10 Route A candidates the kernel does not grant, in one session.  Root cause: the
# X-ray had its own ranking rule.  These pin the repair.
# ─────────────────────────────────────────────────────────────────────────────────────────

def _loc(quality=0.5, confluence=1):
    return SimpleNamespace(quality=quality, confluence=confluence, id="LOC")


def _cand(direction, setup, quality=0.5, confluence=1):
    return SimpleNamespace(direction=direction, setup=setup,
                           location=_loc(quality, confluence))


BEFORE_LAST_ENTRY = pd.Timestamp("2026-04-09 10:00", tz=kernel.core.TZ)


def test_the_xray_delegates_ranking_to_the_kernel():
    """A locally-written ranking rule is how the mirror diverged. It must call the kernel's."""
    src = inspect.getsource(xray.xray_session)
    assert "_rank_and_yield(" in src, "the X-ray must CALL the kernel's ranker"
    # Check the EXECUTABLE lines. The comment block explaining the repair names the old rule
    # on purpose, and a substring test that reads comments would convict the fix itself.
    code = [ln for ln in src.splitlines() if not ln.strip().startswith("#")]
    for banned in ("survivors[0]", "survivors[1:]"):
        assert not any(banned in ln for ln in code), (
            f"{banned} is the list-order rule the kernel does not use - it selects the MAX by "
            f"(setup rank, location.quality, location.confluence)"
        )


def test_the_demotion_is_scoped_to_the_clock_being_ranked():
    """It used to scan every accumulated record, retroactively demoting earlier winners."""
    src = inspect.getsource(xray.xray_session)
    code = [ln for ln in src.splitlines() if not ln.strip().startswith("#")]
    assert not any("for r in records:" in ln for ln in code), (
        "demoting by scanning ALL records lets a later clock revoke an earlier clock's winner"
    )


def test_the_ranker_prefers_a_breakout_over_a_reversal():
    """RED under the old rule: Route A (REV) is appended FIRST, so list order picked it."""
    rev, brk = _cand("L", "REV"), _cand("L", "BRK5")
    chosen = kernel._rank_and_yield([rev, brk], BEFORE_LAST_ENTRY, None, None)
    assert chosen is not None
    assert chosen[0] is brk, "the kernel ranks BRK5=3 above REV=1; list order would pick REV"


def test_a_direction_conflict_yields_nothing():
    """Both directions permitted at one clock => the kernel yields NOTHING."""
    conflict = [_cand("L", "REV"), _cand("S", "BRK5")]
    assert kernel._rank_and_yield(conflict, BEFORE_LAST_ENTRY, None, None) is None
    # POSITIVE WITNESS: the same two candidates AGREEING do yield, so the None above is the
    # conflict veto and not some unrelated refusal.
    agree = [_cand("L", "REV"), _cand("L", "BRK5")]
    assert kernel._rank_and_yield(agree, BEFORE_LAST_ENTRY, None, None) is not None


def test_a_decision_clock_past_last_entry_yields_nothing():
    late = pd.Timestamp(
        f"2026-04-09 {kernel.core.LAST_ENTRY}", tz=kernel.core.TZ) + pd.Timedelta(minutes=1)
    assert kernel._rank_and_yield([_cand("L", "REV")], late, None, None) is None
    # POSITIVE WITNESS: the identical candidate before the cutoff yields.
    assert kernel._rank_and_yield(
        [_cand("L", "REV")], BEFORE_LAST_ENTRY, None, None) is not None
