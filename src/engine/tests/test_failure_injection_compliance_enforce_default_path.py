"""
test_failure_injection_compliance_enforce_default_path.py

FAILURE-INJECTION coverage for incident class #7 of the autonomous-readiness
fault-injection campaign (2026-07-12): backtest compliance enforce mode
(src/engine/backtester.py::_apply_backtest_parity_gates, gated by
src/server/lib/compliance-mode.ts / the Python-side compliance_mode resolver).

The existing suite (src/engine/tests/test_compliance_enforce_mode.py) already
has strong failure-injection coverage — most notably
`test_enforce_mode_blocks_all_signals_on_violation` (injects a violation via
a mocked check_strategy_compliance return value and asserts the REAL
_apply_backtest_parity_gates function actually zeroes every signal, not just
that a "blocked" flag exists). That file explicitly passes
compliance_mode_override="enforce" on every enforce-mode test.

GAP this file closes: no existing test exercises the TRUE PRODUCTION DEFAULT
PATH — a backtest invoked with NEITHER a per-backtest compliance_mode
override NOR any compliance-mode env var set (compliance_mode_override=None,
env unset) — WHILE a violation is injected. Per CLAUDE.md ("Backtest
compliance enforce mode (Wave 27.5 Pass C.2 — DEFAULT)"), this exact
unconfigured state is what happens in the field whenever a new strategy is
backtested and nobody has touched compliance settings — i.e. the actual
30-day-unattended-vacation baseline behavior. Every existing enforce-mode
test proves the mechanism works WHEN EXPLICITLY SELECTED; this file proves
the mechanism is what actually fires when NOTHING is configured (the state
the operator's autonomous scout pipeline runs backtests in every day).

test_default_compliance_mode_is_enforce_when_no_violations (existing) proves
default=enforce with a CLEAN result (no violation to catch). This file
injects a genuine violation into that exact same unconfigured state.

DO NOT EDIT SOURCE FROM THIS FILE.
"""

import os
from unittest.mock import patch

import numpy as np
import pytest  # noqa: F401 — used implicitly via @pytest.fixture

from src.engine.backtester import (
    _apply_backtest_parity_gates,  # noqa: I001 — project-internal first-party
)


def _make_minimal_df(n_bars: int = 10):
    import polars as pl
    return pl.DataFrame(
        {
            "close": [4000.0 + i for i in range(n_bars)],
            "atr_14": [10.0] * n_bars,
            "ts_et": [f"2026-01-15T09:{30+i:02d}:00" for i in range(n_bars)],
        }
    )


def _signals_all_true(n: int = 10) -> np.ndarray:
    return np.ones(n, dtype=bool)


def _violation_result(violations=None, warnings=None):
    return {
        "violations": violations if violations is not None else [{"type": "overnight_ban", "rule": "overnight_ok"}],
        "warnings": warnings or [],
        "compliant": False,
    }


@pytest.fixture(autouse=True)
def clean_env():
    """Remove compliance-gate env vars before each test — this IS the injected
    'nothing configured' state under test, not incidental cleanup."""
    for key in ("BACKTEST_COMPLIANCE_MODE", "TF_BACKTEST_COMPLIANCE_MODE",
                "TF_BACKTEST_SKIP_MODE", "TF_BACKTEST_ANTI_SETUP_MODE"):
        os.environ.pop(key, None)
    yield
    for key in ("BACKTEST_COMPLIANCE_MODE", "TF_BACKTEST_COMPLIANCE_MODE",
                "TF_BACKTEST_SKIP_MODE", "TF_BACKTEST_ANTI_SETUP_MODE"):
        os.environ.pop(key, None)


def test_default_unconfigured_state_with_injected_violation_still_blocks(capsys):
    """THE GAP TEST: no env var set, no compliance_mode_override passed at all
    (the argument is simply omitted, matching how a fresh autonomous scout
    backtest call is actually made in the field) + a genuine violation
    injected -> the institutional default (enforce) must ACTUALLY BLOCK every
    signal, not merely report compliance_mode='enforce' in stats while
    silently letting signals through."""
    df = _make_minimal_df()
    signals = _signals_all_true(10)

    with patch(
        "src.engine.compliance.compliance_gate.check_strategy_compliance",
        return_value=_violation_result(),
    ):
        # compliance_mode_override intentionally OMITTED — this is the exact
        # call shape an unconfigured production backtest uses.
        out, stats = _apply_backtest_parity_gates(
            signals, df, "long", "MES", "test_strategy_unconfigured",
        )

    assert stats["compliance_mode"] == "enforce"
    # THE INJECTION-BASED PROOF: a test that only checked
    # stats["compliance_mode"] == "enforce" would pass even if the actual
    # signal-zeroing logic were dead code — this is the assertion on the
    # observable side effect.
    assert stats["compliance_blocked"] == 10
    assert not np.any(out), "unconfigured-default (enforce) must block ALL signals when a violation is injected"
    assert len(stats["compliance_violations"]) > 0

    captured = capsys.readouterr()
    assert "compliance.enforce_block" in captured.err


def test_default_unconfigured_state_with_partial_violations_blocks_only_the_violating_bars_worth_of_signal_count(capsys):
    """Sparse-signal variant of the gap test above: only some bars carry a
    signal; the unconfigured default must still block exactly those signals
    (not silently pass a subset through due to some off-by-one in the
    default-path branch that the explicit-override tests never touch)."""
    df = _make_minimal_df(n_bars=20)
    signals = np.zeros(20, dtype=bool)
    signals[[1, 4, 9, 15]] = True  # 4 signals

    with patch(
        "src.engine.compliance.compliance_gate.check_strategy_compliance",
        return_value=_violation_result(violations=[{"type": "hft_ban", "rule": "max_orders_per_second"}]),
    ):
        out, stats = _apply_backtest_parity_gates(
            signals, df, "long", "MNQ", "test_strategy_unconfigured_sparse",
        )

    assert stats["compliance_mode"] == "enforce"
    assert stats["compliance_blocked"] == 4
    assert not np.any(out)


def test_default_unconfigured_state_clean_result_does_not_false_positive_block(capsys):
    """Negative control for the gap test: the unconfigured default must NOT
    block when there is genuinely no violation — proves the default-path
    block above is a real conditional response to the injected violation,
    not an unconditional zero-everything bug that would trivially pass the
    two tests above for the wrong reason."""
    df = _make_minimal_df()
    signals = _signals_all_true(10)

    with patch(
        "src.engine.compliance.compliance_gate.check_strategy_compliance",
        return_value={"violations": [], "warnings": [], "compliant": True},
    ):
        out, stats = _apply_backtest_parity_gates(
            signals, df, "long", "MES", "test_strategy_unconfigured_clean",
        )

    assert stats["compliance_mode"] == "enforce"
    assert stats["compliance_blocked"] == 0
    assert np.all(out), "unconfigured default must NOT block when no violation is injected (negative control)"
