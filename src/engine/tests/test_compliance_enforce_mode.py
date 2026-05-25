"""
test_compliance_enforce_mode.py — Wave 27.5 Pass C.2 (paper-parity)

Tests for the compliance gate enforcement-mode env knob introduced in H4.

Coverage:
  1. shadow mode: violations logged, trades NOT blocked (pre-C.2 behavior preserved)
  2. enforce mode: violations SKIP all signals, audit line emitted on stderr
  3. BACKTEST_COMPLIANCE_MODE=shadow overrides enforce default
  4. TF_BACKTEST_COMPLIANCE_MODE (legacy alias) also overrides
  5. per-backtest compliance_mode_override wins over env var
  6. compliance_mode_override=None falls through to env then default
  7. violation counter correct in parity_stats
  8. default is "enforce" when neither env var is set
  9. invalid BACKTEST_COMPLIANCE_MODE falls back to "enforce"
 10. compliance_mode_override="shadow" on a violating strategy: signals NOT blocked
"""

import os
from unittest.mock import patch

import numpy as np
import pytest  # noqa: F401 — used implicitly via @pytest.fixture

from src.engine.backtester import (
    _apply_backtest_parity_gates,  # noqa: I001 — project-internal first-party
)

# ─── Helpers ──────────────────────────────────────────────────────────────────

def _make_minimal_df(n_bars: int = 10):
    """Build a minimal Polars DataFrame with the fields the parity gate reads."""
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


def _signals_all_false(n: int = 10) -> np.ndarray:
    return np.zeros(n, dtype=bool)


def _violation_result(violations=None, warnings=None):
    """Fake check_strategy_compliance result with violations."""
    return {
        "violations": violations if violations is not None else [{"type": "overnight_ban", "rule": "overnight_ok"}],
        "warnings": warnings or [],
        "compliant": False,
    }


def _clean_result():
    """Fake check_strategy_compliance result with no violations."""
    return {"violations": [], "warnings": [], "compliant": True}


# ─── Fixture: clean up env between tests ──────────────────────────────────────

@pytest.fixture(autouse=True)
def clean_env():
    """Remove compliance-gate env vars before each test."""
    for key in ("BACKTEST_COMPLIANCE_MODE", "TF_BACKTEST_COMPLIANCE_MODE",
                "TF_BACKTEST_SKIP_MODE", "TF_BACKTEST_ANTI_SETUP_MODE"):
        os.environ.pop(key, None)
    yield
    for key in ("BACKTEST_COMPLIANCE_MODE", "TF_BACKTEST_COMPLIANCE_MODE",
                "TF_BACKTEST_SKIP_MODE", "TF_BACKTEST_ANTI_SETUP_MODE"):
        os.environ.pop(key, None)


# ─── Test 8: default is "enforce" when neither env var is set ─────────────────

def test_default_compliance_mode_is_enforce_when_no_violations(capsys):
    """When no env var is set and no violations exist, enforce mode runs cleanly."""
    df = _make_minimal_df()
    signals = _signals_all_true(10)

    with patch("src.engine.compliance.compliance_gate.check_strategy_compliance",
               return_value=_clean_result()):
        out, stats = _apply_backtest_parity_gates(
            signals, df, "long", "MES", "test_strategy",
        )

    assert stats["compliance_mode"] == "enforce"
    assert stats["compliance_blocked"] == 0
    # Signals unchanged — no violations
    assert np.all(out)


# ─── Test 2: enforce mode — violations SKIP all signals ───────────────────────

def test_enforce_mode_blocks_all_signals_on_violation(capsys):
    """In enforce mode, a compliance violation blocks ALL signals for this call."""
    df = _make_minimal_df()
    signals = _signals_all_true(10)

    with patch("src.engine.compliance.compliance_gate.check_strategy_compliance",
               return_value=_violation_result()):
        out, stats = _apply_backtest_parity_gates(
            signals, df, "long", "MES", "test_strategy",
            compliance_mode_override="enforce",
        )

    # All 10 signals should be blocked
    assert stats["compliance_blocked"] == 10
    assert not np.any(out), "All signals should be zeroed in enforce mode"
    assert len(stats["compliance_violations"]) > 0

    # Verify audit line is emitted to stderr
    captured = capsys.readouterr()
    assert "compliance.enforce_block" in captured.err
    assert "enforce" in captured.err.lower()


# ─── Test 1: shadow mode — violations logged, trades NOT blocked ───────────────

def test_shadow_mode_logs_but_does_not_block(capsys):
    """In shadow mode, violations are logged to stderr but signals are NOT blocked."""
    df = _make_minimal_df()
    signals = _signals_all_true(10)

    with patch("src.engine.compliance.compliance_gate.check_strategy_compliance",
               return_value=_violation_result()):
        out, stats = _apply_backtest_parity_gates(
            signals, df, "long", "MES", "test_strategy",
            compliance_mode_override="shadow",
        )

    # No blocking in shadow mode
    assert stats["compliance_blocked"] == 0, "Shadow mode must NOT block trades"
    assert np.all(out), "All signals must pass through in shadow mode"

    # Violations are still recorded in stats
    assert len(stats["compliance_violations"]) > 0

    # Audit line emitted to stderr (shadow_logged, not enforce_block)
    captured = capsys.readouterr()
    assert "compliance.shadow_logged" in captured.err


# ─── Test 3: BACKTEST_COMPLIANCE_MODE=shadow overrides enforce default ────────

def test_env_var_shadow_overrides_default_enforce(capsys):
    """BACKTEST_COMPLIANCE_MODE=shadow env var switches from default enforce to shadow."""
    os.environ["BACKTEST_COMPLIANCE_MODE"] = "shadow"
    df = _make_minimal_df()
    signals = _signals_all_true(10)

    with patch("src.engine.compliance.compliance_gate.check_strategy_compliance",
               return_value=_violation_result()):
        out, stats = _apply_backtest_parity_gates(
            signals, df, "long", "MES", "test_strategy",
        )

    assert stats["compliance_mode"] == "shadow"
    assert stats["compliance_blocked"] == 0
    assert np.all(out)


# ─── Test 4: legacy TF_BACKTEST_COMPLIANCE_MODE env var ───────────────────────

def test_legacy_env_var_tf_prefix_is_respected(capsys):
    """TF_BACKTEST_COMPLIANCE_MODE (legacy alias) also works as shadow override."""
    os.environ["TF_BACKTEST_COMPLIANCE_MODE"] = "shadow"
    df = _make_minimal_df()
    signals = _signals_all_true(10)

    with patch("src.engine.compliance.compliance_gate.check_strategy_compliance",
               return_value=_violation_result()):
        out, stats = _apply_backtest_parity_gates(
            signals, df, "long", "MES", "test_strategy",
        )

    assert stats["compliance_mode"] == "shadow"
    assert stats["compliance_blocked"] == 0


# ─── Test: BACKTEST_COMPLIANCE_MODE takes precedence over TF_ alias ───────────

def test_new_env_var_wins_over_legacy_alias(capsys):
    """BACKTEST_COMPLIANCE_MODE takes precedence over TF_BACKTEST_COMPLIANCE_MODE."""
    os.environ["BACKTEST_COMPLIANCE_MODE"] = "enforce"
    os.environ["TF_BACKTEST_COMPLIANCE_MODE"] = "shadow"
    df = _make_minimal_df()
    signals = _signals_all_true(10)

    with patch("src.engine.compliance.compliance_gate.check_strategy_compliance",
               return_value=_violation_result()):
        out, stats = _apply_backtest_parity_gates(
            signals, df, "long", "MES", "test_strategy",
        )

    # enforce wins because BACKTEST_COMPLIANCE_MODE takes precedence
    assert stats["compliance_mode"] == "enforce"
    assert stats["compliance_blocked"] == 10


# ─── Test 5: per-backtest override wins over env var ──────────────────────────

def test_per_backtest_override_wins_over_env_var(capsys):
    """compliance_mode_override argument wins over BACKTEST_COMPLIANCE_MODE env var."""
    os.environ["BACKTEST_COMPLIANCE_MODE"] = "enforce"
    df = _make_minimal_df()
    signals = _signals_all_true(10)

    with patch("src.engine.compliance.compliance_gate.check_strategy_compliance",
               return_value=_violation_result()):
        out, stats = _apply_backtest_parity_gates(
            signals, df, "long", "MES", "test_strategy",
            compliance_mode_override="shadow",  # per-backtest opts out
        )

    # Shadow wins even though env says enforce
    assert stats["compliance_mode"] == "shadow"
    assert stats["compliance_blocked"] == 0
    assert np.all(out)


# ─── Test 6: compliance_mode_override=None falls through to env then default ──

def test_override_none_falls_through_to_env(capsys):
    """When override is None, env var is used; when env also absent, default 'enforce'."""
    # No env var set — should default to enforce
    df = _make_minimal_df()
    signals = _signals_all_true(10)

    with patch("src.engine.compliance.compliance_gate.check_strategy_compliance",
               return_value=_clean_result()):
        out, stats = _apply_backtest_parity_gates(
            signals, df, "long", "MES", "test_strategy",
            compliance_mode_override=None,
        )

    assert stats["compliance_mode"] == "enforce"
    assert stats["compliance_blocked"] == 0


# ─── Test 7: violation counter is correct in parity_stats ────────────────────

def test_violation_counter_is_correct_in_enforce_mode():
    """compliance_blocked matches the number of signals that were blocked."""
    df = _make_minimal_df(n_bars=20)
    # Create sparse signals — only 7 True out of 20
    signals = np.zeros(20, dtype=bool)
    signals[[2, 5, 8, 11, 14, 17, 19]] = True  # 7 signals

    with patch("src.engine.compliance.compliance_gate.check_strategy_compliance",
               return_value=_violation_result()):
        out, stats = _apply_backtest_parity_gates(
            signals, df, "long", "MES", "test_strategy",
            compliance_mode_override="enforce",
        )

    assert stats["compliance_blocked"] == 7, "Should block exactly 7 True signals"
    assert not np.any(out)


# ─── Test 9: invalid BACKTEST_COMPLIANCE_MODE falls back to enforce ───────────

def test_invalid_env_var_falls_back_to_enforce():
    """An unrecognised BACKTEST_COMPLIANCE_MODE value defaults to 'enforce'."""
    os.environ["BACKTEST_COMPLIANCE_MODE"] = "banana_split"
    df = _make_minimal_df()
    signals = _signals_all_true(10)

    with patch("src.engine.compliance.compliance_gate.check_strategy_compliance",
               return_value=_clean_result()):
        out, stats = _apply_backtest_parity_gates(
            signals, df, "long", "MES", "test_strategy",
        )

    # Invalid value → falls back to enforce
    assert stats["compliance_mode"] == "enforce"


# ─── Test 10: override=shadow on violating strategy — signals NOT blocked ─────

def test_per_backtest_shadow_on_violating_strategy():
    """Research backtest with shadow override: violations logged, signals pass through."""
    df = _make_minimal_df()
    signals = _signals_all_true(10)

    with patch("src.engine.compliance.compliance_gate.check_strategy_compliance",
               return_value=_violation_result(
                   violations=[{"type": "hft_ban", "rule": "max_orders_per_second"}]
               )):
        out, stats = _apply_backtest_parity_gates(
            signals, df, "long", "MNQ", "research_strategy_007",
            compliance_mode_override="shadow",
        )

    assert stats["compliance_mode"] == "shadow"
    assert stats["compliance_blocked"] == 0
    assert np.all(out), "Research shadow mode must not block any signals"
    # Violations are still recorded for observability
    assert any(v.get("type") == "hft_ban" for v in stats["compliance_violations"]
               if isinstance(v, dict))
