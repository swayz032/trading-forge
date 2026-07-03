"""E2 (deep-scan #7 2026-07-02) — PBO available for non-optimize plain-WF.

Previous behavior: _build_cpcv_paths_from_window_results used oos_sharpe as IS
fallback when no optimizer score existed → IS==OOS → degenerate guard → pbo=None
→ lifecycle gate grandfather-proceeds for ALL non-optimize plain-WF runs.

New behavior (E2): when per-window IS daily P&Ls are available in _is_daily_pnls
(threaded in by walk_forward.py during assembly), compute the real IS Sharpe per
window so IS ≠ OOS → pbo is computed.

Tests:
  - With _is_daily_pnls: IS Sharpe computed → IS ≠ OOS → pbo computed (not None)
  - Without _is_daily_pnls and no optimizer: IS==OOS → degenerate → pbo=None
  - With optimizer best_sharpe: optimizer IS used (highest priority, pre-E2 path)
  - _is_daily_pnls with < 2 samples → falls back to OOS (degenerate)
  - _is_daily_pnls with zero variance → falls back to OOS (degenerate)
  - Replay determinism: same window_results → same PBO
"""

from __future__ import annotations

import math

import numpy as np
import pytest

from src.engine.pbo_gate import (
    _build_cpcv_paths_from_window_results,
    compute_pbo_from_cpcv_paths,
)


def _make_window(
    oos_sharpe: float = 1.0,
    optimizer_sharpe: float | None = None,
    is_daily_pnls: list[float] | None = None,
) -> dict:
    """Build a plain-WF window_results dict for testing."""
    w: dict = {
        "oos_metrics": {"sharpe_ratio": oos_sharpe},
        "confidence": "OK",
    }
    if optimizer_sharpe is not None:
        w["optimization"] = {"best_sharpe": optimizer_sharpe}
    if is_daily_pnls is not None:
        w["_is_daily_pnls"] = is_daily_pnls
    return w


def _daily_pnls_for_sharpe(target_sharpe: float, n: int = 60, seed: int = 42) -> list[float]:
    """Generate synthetic daily P&L series with approximately target_sharpe."""
    rng = np.random.default_rng(seed)
    # mean/std * sqrt(252) ≈ target_sharpe → mean = target_sharpe * std / sqrt(252)
    std = 100.0
    mean = target_sharpe * std / np.sqrt(252)
    return list(rng.normal(mean, std, n))


class TestE2BuildCpcvPathsFromWindowResults:
    """_build_cpcv_paths_from_window_results IS-Sharpe resolution."""

    def test_optimizer_takes_priority_over_is_pnls(self):
        """When both optimizer and _is_daily_pnls present, optimizer wins."""
        is_pnls = _daily_pnls_for_sharpe(0.5)  # low IS Sharpe from pnls
        w = _make_window(oos_sharpe=1.0, optimizer_sharpe=2.5, is_daily_pnls=is_pnls)
        paths = _build_cpcv_paths_from_window_results([w])
        assert len(paths) == 1
        assert paths[0]["is_sharpe"] == pytest.approx(2.5)

    def test_is_pnls_used_when_no_optimizer(self):
        """When no optimizer, _is_daily_pnls are used to compute IS Sharpe."""
        is_pnls = _daily_pnls_for_sharpe(2.0)  # high IS Sharpe
        oos_sharpe = 0.8
        w = _make_window(oos_sharpe=oos_sharpe, is_daily_pnls=is_pnls)
        paths = _build_cpcv_paths_from_window_results([w])
        assert len(paths) == 1
        # IS Sharpe from pnls should differ from OOS Sharpe
        is_s = paths[0]["is_sharpe"]
        assert abs(is_s - oos_sharpe) > 0.1, (
            f"IS Sharpe ({is_s:.4f}) should differ from OOS ({oos_sharpe})"
        )

    def test_no_is_pnls_no_optimizer_uses_oos(self):
        """Fallback: no _is_daily_pnls, no optimizer → IS = OOS (degenerate path)."""
        w = _make_window(oos_sharpe=1.2)
        paths = _build_cpcv_paths_from_window_results([w])
        assert paths[0]["is_sharpe"] == pytest.approx(1.2)
        assert paths[0]["oos_sharpe"] == pytest.approx(1.2)

    def test_empty_is_pnls_falls_back_to_oos(self):
        """_is_daily_pnls=[] (< 2 samples) → fallback to OOS Sharpe."""
        w = _make_window(oos_sharpe=0.9, is_daily_pnls=[])
        paths = _build_cpcv_paths_from_window_results([w])
        assert paths[0]["is_sharpe"] == pytest.approx(0.9)

    def test_single_is_pnl_falls_back_to_oos(self):
        """_is_daily_pnls with 1 element (can't compute std) → fallback to OOS."""
        w = _make_window(oos_sharpe=0.7, is_daily_pnls=[150.0])
        paths = _build_cpcv_paths_from_window_results([w])
        assert paths[0]["is_sharpe"] == pytest.approx(0.7)

    def test_zero_variance_is_pnls_falls_back_to_oos(self):
        """_is_daily_pnls all identical (std≈0) → fallback to OOS."""
        # All same value → std=0 → IS Sharpe undefined
        w = _make_window(oos_sharpe=0.6, is_daily_pnls=[100.0] * 30)
        paths = _build_cpcv_paths_from_window_results([w])
        assert paths[0]["is_sharpe"] == pytest.approx(0.6)

    def test_multiple_windows_mixed(self):
        """Mix of optimizer, is_pnls, and fallback windows."""
        w1 = _make_window(oos_sharpe=1.0, optimizer_sharpe=2.0)       # optimizer
        w2 = _make_window(oos_sharpe=0.8, is_daily_pnls=_daily_pnls_for_sharpe(1.5))  # is_pnls
        w3 = _make_window(oos_sharpe=0.5)                              # fallback
        paths = _build_cpcv_paths_from_window_results([w1, w2, w3])
        assert len(paths) == 3
        assert paths[0]["is_sharpe"] == pytest.approx(2.0)            # optimizer
        assert abs(paths[1]["is_sharpe"] - 0.8) > 0.05                # is_pnls != OOS
        assert paths[2]["is_sharpe"] == pytest.approx(0.5)             # fallback = OOS

    def test_replay_determinism(self):
        """Same window_results → same path IS Sharpes."""
        is_pnls = _daily_pnls_for_sharpe(1.8, seed=99)
        w = _make_window(oos_sharpe=0.9, is_daily_pnls=is_pnls)
        paths_1 = _build_cpcv_paths_from_window_results([w])
        paths_2 = _build_cpcv_paths_from_window_results([w])
        assert paths_1[0]["is_sharpe"] == paths_2[0]["is_sharpe"]


class TestE2PboComputedWithIsNeOos:
    """PBO is computed (not None) when IS Sharpe diverges from OOS via E2 fix."""

    def _build_4_windows(self) -> list[dict]:
        """Minimal 4-window set with IS pnls giving IS > OOS for PBO computation."""
        return [
            _make_window(
                oos_sharpe=0.5 + 0.1 * i,
                is_daily_pnls=_daily_pnls_for_sharpe(1.5 + 0.1 * i, seed=i),
            )
            for i in range(4)
        ]

    def test_pbo_not_none_with_is_pnls(self):
        """With IS daily pnls: IS ≠ OOS → pbo is a float, not None."""
        paths = _build_cpcv_paths_from_window_results(self._build_4_windows())
        result = compute_pbo_from_cpcv_paths(paths)
        pbo = result.get("pbo")
        assert pbo is not None, "PBO should not be None when IS pnls available"
        assert isinstance(pbo, float)
        assert 0.0 <= pbo <= 1.0

    def test_pbo_none_without_is_pnls_no_optimizer(self):
        """Without IS pnls or optimizer: IS==OOS → degenerate → pbo=None (BLOCK)."""
        windows = [_make_window(oos_sharpe=0.5 + 0.1 * i) for i in range(4)]
        paths = _build_cpcv_paths_from_window_results(windows)
        result = compute_pbo_from_cpcv_paths(paths)
        assert result.get("pbo") is None
        assert result.get("degenerate") is True
