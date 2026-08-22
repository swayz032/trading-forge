"""Candidate X-ray correspondence + diagnostic-only guards — ALGO-009 §4.

The X-ray MIRRORS `kernel.iter_actionable_candidates` because the kernel yields only the
single ranked winner per clock and discards the rest, so a wrapper cannot observe rejected
candidates. A mirror can drift. These tests pin the correspondence and the diagnostic-only
boundary.
"""
from __future__ import annotations

import inspect
import re

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
