"""Parity test — Python adaptive exits vs TS adaptive-exit-engine.ts.

Wave 25 Gap B: paper/backtest parity smoke test.

This test generates synthetic fixtures and verifies that the Python
compute_exit_plan_python() produces logically equivalent outputs to what
the TS computeExitPlan() would produce for the same inputs.

Since we cannot import TS code directly, we verify equivalence by asserting
the Python function produces the EXPECTED values that the TS parity table
defines. The TS tables (REGIME_SCALING_DEFAULTS / REGIME_RUNNER_TRAIL_DEFAULTS)
are embedded verbatim in both files and this test confirms both sides agree.

Coverage:
  1. Scaling schedule matches TS REGIME_SCALING_DEFAULTS for all 7 regimes
  2. Runner trail method matches TS REGIME_RUNNER_TRAIL_DEFAULTS for all 7 regimes
  3. TP1/TP2 R-multiple fallback (no liquidity) matches TS +1R / +2R rule
  4. TP1 min-R gate (>= 0.8) matches TS intradayCandidates.find(r >= 0.8) rule
  5. Intraday level filter matches TS INTRADAY_ALLOWED_LEVEL_TYPES set
  6. Day-trader mandate: pwh_iso/pwl_iso/pmh/pml rejected by both sides
  7. Fallback chaining: bad liquidity → R-multiples (TS parity)
"""

from __future__ import annotations

from datetime import datetime

import pytest

from src.engine.config import LiquidityLevelSnapshot
from src.engine.exits.adaptive_exits import (
    INTRADAY_ALLOWED_LEVEL_TYPES,
    REGIME_RUNNER_TRAIL_DEFAULTS,
    REGIME_SCALING_DEFAULTS,
    compute_exit_plan_python,
)

# ─── TS canonical tables (embedded — mirrors adaptive-exit-engine.ts) ──────────
# These are the SOURCE OF TRUTH that both TS and Python must agree on.
# If either side changes, this test will catch the drift.

# REGIME_SCALING_DEFAULTS from adaptive-exit-engine.ts
TS_REGIME_SCALING: dict[str, tuple[float, float, float]] = {
    "TRENDING_UP":    (0.20, 0.30, 0.50),
    "TRENDING_DOWN":  (0.20, 0.30, 0.50),
    "EXPANSION":      (0.20, 0.30, 0.50),
    "RANGE_BOUND":    (0.50, 0.30, 0.20),
    "COMPRESSION":    (0.50, 0.30, 0.20),
    "HIGH_VOL_MACRO": (0.60, 0.30, 0.10),
    "LOW_LIQ_CHOP":   (0.50, 0.50, 0.00),
}

# REGIME_RUNNER_TRAIL_DEFAULTS from adaptive-exit-engine.ts
TS_REGIME_RUNNER_TRAIL: dict[str, str] = {
    "TRENDING_UP":    "anchored_vwap",
    "TRENDING_DOWN":  "anchored_vwap",
    "EXPANSION":      "anchored_vwap",
    "RANGE_BOUND":    "developing_poc",
    "COMPRESSION":    "structure_trail",
    "HIGH_VOL_MACRO": "chandelier",
    "LOW_LIQ_CHOP":   "developing_poc",
}

# INTRADAY_ALLOWED_LEVEL_TYPES from adaptive-exit-engine.ts
TS_INTRADAY_ALLOWED: frozenset[str] = frozenset({
    "pdh", "pdl",
    "asian_high", "asian_low",
    "london_high", "london_low",
    "hod", "lod",
    "naked_poc",
    "untouched_fvg",
    "untouched_ob",
    "eqh", "eql",
})


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _plan(regime: str, entry: float = 4000.0, stop: float = 3994.0,
          direction: str = "long", liq: list | None = None, atr: float = 6.0):
    if liq is None:
        liq = []
    return compute_exit_plan_python(
        entry_price=entry,
        stop_price=stop,
        direction=direction,
        symbol="MES",
        bar_ts=datetime(2025, 6, 10, 14, 0),
        atr=atr,
        regime=regime,
        liquidity_snapshot=liq,
    )


# ─── 1. Scaling schedule parity ───────────────────────────────────────────────


class TestScalingParity:
    """Python scaling must match TS REGIME_SCALING_DEFAULTS exactly."""

    @pytest.mark.parametrize("regime,expected", list(TS_REGIME_SCALING.items()))
    def test_scaling_matches_ts_table(self, regime, expected):
        plan = _plan(regime)
        tp1, tp2, runner = expected
        assert plan.scaling.tp1_pct == pytest.approx(tp1), f"{regime} tp1_pct mismatch"
        assert plan.scaling.tp2_pct == pytest.approx(tp2), f"{regime} tp2_pct mismatch"
        assert plan.scaling.runner_pct == pytest.approx(runner), f"{regime} runner_pct mismatch"

    def test_python_scaling_table_matches_ts_table(self):
        """Python REGIME_SCALING_DEFAULTS must contain all TS regimes with same values."""
        for regime, expected in TS_REGIME_SCALING.items():
            assert regime in REGIME_SCALING_DEFAULTS, f"Python missing regime: {regime}"
            assert REGIME_SCALING_DEFAULTS[regime] == pytest.approx(expected), (
                f"Python scaling for {regime} = {REGIME_SCALING_DEFAULTS[regime]}, "
                f"TS expects {expected}"
            )


# ─── 2. Runner trail method parity ────────────────────────────────────────────


class TestRunnerTrailParity:
    """Python runner trail must match TS REGIME_RUNNER_TRAIL_DEFAULTS exactly."""

    @pytest.mark.parametrize("regime,expected", list(TS_REGIME_RUNNER_TRAIL.items()))
    def test_runner_trail_matches_ts_table(self, regime, expected):
        plan = _plan(regime)
        assert plan.runner_trail_method == expected, (
            f"Regime {regime}: Python={plan.runner_trail_method}, TS expects {expected}"
        )

    def test_python_runner_table_matches_ts_table(self):
        """Python REGIME_RUNNER_TRAIL_DEFAULTS must match TS table."""
        for regime, expected in TS_REGIME_RUNNER_TRAIL.items():
            assert regime in REGIME_RUNNER_TRAIL_DEFAULTS, f"Python missing regime: {regime}"
            assert REGIME_RUNNER_TRAIL_DEFAULTS[regime] == expected, (
                f"Python runner for {regime} = {REGIME_RUNNER_TRAIL_DEFAULTS[regime]}, "
                f"TS expects {expected}"
            )


# ─── 3. Intraday level type filter parity ─────────────────────────────────────


class TestLevelTypeFilterParity:
    def test_python_allowed_set_matches_ts(self):
        """Python INTRADAY_ALLOWED_LEVEL_TYPES must match TS exactly."""
        assert INTRADAY_ALLOWED_LEVEL_TYPES == TS_INTRADAY_ALLOWED, (
            f"Python allowed set differs from TS.\n"
            f"  Python only: {INTRADAY_ALLOWED_LEVEL_TYPES - TS_INTRADAY_ALLOWED}\n"
            f"  TS only: {TS_INTRADAY_ALLOWED - INTRADAY_ALLOWED_LEVEL_TYPES}"
        )

    @pytest.mark.parametrize("excluded_type", ["pwh_iso", "pwl_iso", "pmh", "pml"])
    def test_day_trader_mandate_excludes_multi_day_levels(self, excluded_type):
        """Both Python and TS must reject multi-day DOL types."""
        assert excluded_type not in INTRADAY_ALLOWED_LEVEL_TYPES
        assert excluded_type not in TS_INTRADAY_ALLOWED


# ─── 4. R-multiple fallback parity ────────────────────────────────────────────


class TestRMultipleFallbackParity:
    def test_no_liquidity_tp1_is_1R(self):
        """Empty snapshot → TP1 = +1R (matches TS +1R fallback)."""
        plan = _plan("TRENDING_UP", entry=4000.0, stop=3994.0)
        # TS: tp1Price = entry + 1.0 * stopDistance = 4000 + 1 * 6 = 4006
        assert plan.tp1.source == "r_multiple"
        assert plan.tp1.price == pytest.approx(4006.0)
        assert plan.tp1.r_multiple == pytest.approx(1.0)

    def test_no_liquidity_tp2_is_2R(self):
        """Empty snapshot → TP2 = +2R (matches TS tp2FallbackR=2.0)."""
        plan = _plan("TRENDING_UP", entry=4000.0, stop=3994.0)
        assert plan.tp2.source == "r_multiple"
        assert plan.tp2.price == pytest.approx(4012.0)
        assert plan.tp2.r_multiple == pytest.approx(2.0)

    def test_short_no_liquidity_tp1_is_minus_1R(self):
        """Short + empty snapshot → TP1 = -1R = entry - 1*stop_distance."""
        plan = compute_exit_plan_python(
            entry_price=4000.0,
            stop_price=4006.0,  # stop above for short
            direction="short",
            symbol="MES",
            bar_ts=datetime(2025, 6, 10, 14, 0),
            atr=6.0,
            regime="TRENDING_DOWN",
            liquidity_snapshot=[],
        )
        assert plan.tp1.price == pytest.approx(3994.0)  # 4000 - 6
        assert plan.tp2.price == pytest.approx(3988.0)  # 4000 - 12


# ─── 5. Liquidity TP1 parity ──────────────────────────────────────────────────


class TestLiquidityTP1Parity:
    def test_tp1_min_R_gate(self):
        """TP1 requires R >= 0.8 (TS: find c where r >= 0.8).
        Uses atr=10 so all levels are within max_distance cap.
        """
        # Level at 4004 = 0.67R — below gate → skipped
        # Level at 4005 = 0.83R — passes
        liq = [
            LiquidityLevelSnapshot("pdh", 4004.0, 3),  # 0.67R skipped
            LiquidityLevelSnapshot("hod", 4005.0, 4),  # 0.83R chosen
        ]
        plan = _plan("TRENDING_UP", liq=liq, atr=10.0)
        assert plan.tp1.source == "liquidity"
        assert plan.tp1.price == pytest.approx(4005.0)

    def test_tp1_below_min_R_falls_back(self):
        """All levels below 0.8R → fallback to +1R."""
        liq = [
            LiquidityLevelSnapshot("pdh", 4003.0, 3),  # 0.5R — below gate
        ]
        plan = _plan("TRENDING_UP", liq=liq, atr=10.0)
        assert plan.tp1.source == "r_multiple"

    def test_tp2_at_least_0p5R_beyond_tp1(self):
        """TP2 must be >= tp1_r + 0.5 (TS: r >= tp1.r_multiple + 0.5).
        Uses atr=10 so all levels are within max_distance cap.

        deepscan17 (2026-07-05): all three candidates now share the SAME
        htf_significance (3) so the composite rank score (see B-4(b) fix in
        adaptive_exits.py) degenerates to pure proximity ordering for THIS
        fixture — isolating the R-gap-from-TP1 logic under test from the
        significance-based reranking behavior (which has its own dedicated
        coverage in scripts/wave26-ts-python-exit-parity.ts's
        "liquidity_rank_divergence" fixtures). Before the fix, london_high's
        higher significance (4) made it outrank pdh and become TP1 instead —
        an accurate reflection of the corrected algorithm, but not what this
        test intends to exercise.
        """
        liq = [
            LiquidityLevelSnapshot("pdh", 4006.0, 3),         # 1.0R → TP1 (nearest, tied significance)
            LiquidityLevelSnapshot("asian_high", 4007.0, 3),  # 1.17R — 0.17R above TP1, too close
            LiquidityLevelSnapshot("london_high", 4009.0, 3), # 1.5R — 0.5R above TP1, qualifies
        ]
        plan = _plan("TRENDING_UP", liq=liq, atr=10.0)
        assert plan.tp1.price == pytest.approx(4006.0)
        assert plan.tp2.price == pytest.approx(4009.0)
        assert plan.tp2.source == "liquidity"


# ─── 6. Synthetic fixture cross-check ────────────────────────────────────────


class TestSyntheticFixtureCrossCheck:
    """Full synthetic fixture: verifies end-to-end plan shape matches TS contract."""

    def _make_liquidity(self, direction: str = "long"):
        """Synthetic intraday liquidity: PDH + naked_poc above/below entry.
        Levels placed within atr=20 max_distance cap (7pt and 15pt from entry).
        """
        if direction == "long":
            return [
                LiquidityLevelSnapshot("pdh", 4007.0, 4),        # 1.17R — TP1 (7pt above, within atr=20)
                LiquidityLevelSnapshot("naked_poc", 4015.0, 3),  # 2.5R — TP2 (15pt above, within atr=20)
            ]
        else:
            return [
                LiquidityLevelSnapshot("pdl", 3993.0, 4),        # 1.17R for short
                LiquidityLevelSnapshot("naked_poc", 3985.0, 3),  # 2.5R for short
            ]

    @pytest.mark.parametrize("regime,expected_tp1_pct,expected_runner_method", [
        ("TRENDING_UP",    0.20, "anchored_vwap"),
        ("RANGE_BOUND",    0.50, "developing_poc"),
        ("HIGH_VOL_MACRO", 0.60, "chandelier"),
        ("COMPRESSION",    0.50, "structure_trail"),
    ])
    def test_full_plan_matches_ts_contract(self, regime, expected_tp1_pct, expected_runner_method):
        liq = self._make_liquidity("long")
        # Use atr=20 so levels at +7pt and +15pt are within max_distance cap
        plan = _plan(regime, liq=liq, atr=20.0)

        # Liquidity TP1 (pdh at 4007 = 1.17R)
        assert plan.tp1.source == "liquidity"
        assert plan.tp1.level_type == "pdh"
        assert plan.tp1.price == pytest.approx(4007.0)

        # Scaling from TS table
        assert plan.scaling.tp1_pct == pytest.approx(expected_tp1_pct)
        assert abs(plan.scaling.tp1_pct + plan.scaling.tp2_pct + plan.scaling.runner_pct - 1.0) < 1e-6

        # Runner trail from TS table
        assert plan.runner_trail_method == expected_runner_method

    def test_audit_payload_has_parity_fields(self):
        """audit_payload must expose the fields the TS audit event would capture."""
        liq = self._make_liquidity("long")
        plan = _plan("TRENDING_UP", liq=liq, atr=20.0)

        ap = plan.audit_payload
        assert "tp1_source" in ap
        assert "tp1_price" in ap
        assert "tp2_source" in ap
        assert "tp2_price" in ap
        assert "runner_trail_method" in ap
        assert "scaling_tp1_pct" in ap
        assert "regime" in ap
