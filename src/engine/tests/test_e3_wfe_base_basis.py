"""E3 (deep-scan #7 2026-07-02) — WFE base-basis cross-run comparability.

Previous behavior: wfe_overall denominator shifts between optimize=True
(optimizer_best_score_mean — cherry-picked IS max, inflated) and optimize=False
(base_config_daily_pnls).  WFE was not comparable across optimize/non-optimize runs.

New behavior (E3): also emit wfe_overall_base_basis (additive key) — WFE computed
from base-config IS Sharpe regardless of optimize mode.  Stable reference across runs.

Tests:
  - wfe_overall_base_basis = OOS/IS_base (using daily pnls, not optimizer score)
  - wfe_overall_base_basis is None when no IS daily pnls available
  - wfe_overall_base_basis ≠ wfe_overall when IS basis differs (optimize=True case)
  - wfe_overall_base_basis == wfe_overall when IS basis is the same (optimize=False)
  - The existing wfe_overall key is unchanged (backward compat)
  - Replay determinism: same pnls → same base_basis

These tests are pure unit tests of the WFE computation logic, independent of
the full walk_forward.py integration (no vectorbt import, no backtester).
"""

from __future__ import annotations

import numpy as np
import pytest

# Pure helpers — no vectorbt dependency
from src.engine.cross_validation import compute_wfe


def _compute_sharpe(pnls: list[float]) -> float:
    """Annualized Sharpe from daily P&L list (same formula as walk_forward.py)."""
    if len(pnls) < 2:
        return 0.0
    arr = np.array(pnls, dtype=float)
    std = float(np.std(arr, ddof=1))
    if std <= 0:
        return 0.0
    return float(np.mean(arr) / std * np.sqrt(252))


def _simulate_wfe_base_basis(
    all_is_pnls: list[float],
    agg_sharpe: float,
) -> float | None:
    """Replicate the E3 wfe_overall_base_basis logic from walk_forward.py."""
    if len(all_is_pnls) < 2:
        return None
    arr = np.array(all_is_pnls, dtype=float)
    std = float(np.std(arr, ddof=1))
    if std <= 0:
        return None
    is_sharpe_base = float(np.mean(arr) / std * np.sqrt(252))
    if is_sharpe_base <= 0:
        return None
    wfe_dict = compute_wfe(is_sharpe=is_sharpe_base, oos_sharpe=agg_sharpe)
    return wfe_dict["wfe"]


class TestE3WfeBaseBasis:
    """wfe_overall_base_basis uses base-config IS Sharpe denominator."""

    def test_base_basis_equals_oos_over_is(self):
        """wfe_overall_base_basis = OOS_sharpe / IS_sharpe (base config).

        compute_wfe() rounds to 4 decimal places, so we use abs=0.0001 tolerance
        (≤ 0.5 units of 4dp rounding) rather than a tight relative tolerance.
        """
        is_pnls = [100.0, 120.0, 80.0, 110.0, 90.0] * 20  # 100 daily pnls
        oos_sharpe = 0.8
        is_sharpe = _compute_sharpe(is_pnls)
        assert is_sharpe > 0, "Test requires positive IS Sharpe"
        base_basis = _simulate_wfe_base_basis(is_pnls, oos_sharpe)
        expected_wfe = round(oos_sharpe / is_sharpe, 4)  # match compute_wfe 4dp rounding
        assert base_basis == pytest.approx(expected_wfe, abs=0.0001), (
            f"wfe_overall_base_basis={base_basis} should equal round(OOS/IS_base, 4)={expected_wfe}"
        )

    def test_base_basis_none_when_no_is_pnls(self):
        """wfe_overall_base_basis=None when all_is_pnls is empty."""
        result = _simulate_wfe_base_basis([], agg_sharpe=1.0)
        assert result is None

    def test_base_basis_none_when_single_is_pnl(self):
        """wfe_overall_base_basis=None when only 1 IS P&L (can't compute std)."""
        result = _simulate_wfe_base_basis([100.0], agg_sharpe=1.0)
        assert result is None

    def test_base_basis_none_when_is_sharpe_nonpositive(self):
        """wfe_overall_base_basis=None when base IS Sharpe ≤ 0 (no edge)."""
        # Uniformly negative IS pnls → negative IS Sharpe → None
        is_pnls = [-50.0, -60.0, -40.0, -70.0, -30.0] * 10
        result = _simulate_wfe_base_basis(is_pnls, agg_sharpe=1.0)
        assert result is None

    def test_base_basis_ne_canonical_when_optimizer_inflates_is(self):
        """wfe_overall_base_basis ≠ wfe_overall when optimizer cherry-picked IS.

        optimize=True: canonical wfe_overall uses optimizer best_score (inflated).
        wfe_overall_base_basis uses all_is_pnls (base-config, lower IS Sharpe).
        Base-basis WFE is HIGHER because denominator is lower.
        """
        # Base-config IS pnls (modest Sharpe ~1.0)
        is_pnls = [100.0, 90.0, 110.0, 80.0, 100.0] * 20
        is_sharpe_base = _compute_sharpe(is_pnls)

        # Optimizer cherry-picked IS Sharpe (higher, e.g. 2.0× the base)
        is_sharpe_optimizer = is_sharpe_base * 2.0

        oos_sharpe = 0.6
        base_basis = _simulate_wfe_base_basis(is_pnls, oos_sharpe)
        wfe_canonical = compute_wfe(is_sharpe=is_sharpe_optimizer, oos_sharpe=oos_sharpe)["wfe"]

        # base_basis WFE > canonical (base IS is lower → ratio OOS/IS is higher)
        assert base_basis is not None
        assert base_basis > wfe_canonical, (
            f"base_basis WFE ({base_basis:.4f}) should be > canonical WFE "
            f"({wfe_canonical:.4f}) when optimizer inflates IS"
        )

    def test_base_basis_equals_canonical_when_same_source(self):
        """wfe_overall_base_basis == wfe_overall when both use base-config IS pnls."""
        is_pnls = [100.0, 90.0, 110.0, 80.0, 100.0] * 20
        oos_sharpe = 0.7
        is_sharpe = _compute_sharpe(is_pnls)
        base_basis = _simulate_wfe_base_basis(is_pnls, oos_sharpe)
        canonical = compute_wfe(is_sharpe=is_sharpe, oos_sharpe=oos_sharpe)["wfe"]
        assert base_basis == pytest.approx(canonical, rel=1e-6)

    def test_replay_determinism(self):
        """Same IS pnls + OOS Sharpe → same wfe_overall_base_basis."""
        is_pnls = [105.0, 92.0, 115.0, 88.0, 103.0] * 15
        oos = 0.75
        r1 = _simulate_wfe_base_basis(is_pnls, oos)
        r2 = _simulate_wfe_base_basis(is_pnls, oos)
        assert r1 == pytest.approx(r2)

    def test_existing_wfe_overall_key_unchanged(self):
        """compute_wfe output schema is unchanged (E3 is additive only)."""
        result = compute_wfe(is_sharpe=1.5, oos_sharpe=0.9)
        assert "wfe" in result
        assert "status" in result
        assert result["wfe"] == pytest.approx(0.9 / 1.5, rel=1e-5)
