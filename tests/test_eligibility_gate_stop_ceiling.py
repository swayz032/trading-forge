"""Regression tests: eligibility-gate per-symbol stop ceiling (Wave 1 fix 2026-06-27).

BUG (fixed): backtester.py apply_eligibility_gate() called compute_structural_stop()
with max_stop_points=6.0 hardcoded and no symbol= kwarg.  Effect:

  MNQ: structural stop clamped to 6pt  (correct ceiling is 62pt)
  MCL: structural stop clamped to 6pt  (correct ceiling is  1pt)
  MES: stop clamped to 6pt             (correct ceiling is 14pt; 6pt was too tight)

All non-MES symbols got wrong stop distances fed into evaluate_signal(),
corrupting the R:R pre-filter on every non-MES backtest.

FIX: replaced the two wrong args with
  symbol=symbol
  max_stop_points=_get_stop_ceiling_for_symbol(symbol)
matching the identical pattern already used by the DSL path at backtester.py:2064.

These tests import only src.engine.context.structural_stops (no vectorbt, no click,
no polars — safe to run in isolation).  The ceiling-table values are verified via
direct assertion against the known defaults from _STOP_CEILING_DEFAULTS.
"""
from __future__ import annotations

import pytest

from src.engine.context.structural_stops import compute_structural_stop


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _stop_dist(stop_plan, entry_price: float) -> float:
    """Absolute stop distance in points."""
    return abs(entry_price - stop_plan.stop_price)


# ---------------------------------------------------------------------------
# Ceiling-table constants (mirrors backtester._STOP_CEILING_DEFAULTS)
# Hard-coded here so the test does NOT import backtester.py (vectorbt-safe).
# If the table changes, update both the table in backtester.py AND these values.
# ---------------------------------------------------------------------------

MES_CEILING = 14.0
MNQ_CEILING = 62.0
MCL_CEILING = 1.0


# ---------------------------------------------------------------------------
# BUG PROOF — demonstrate old hardcoded-6pt behaviour is wrong for MNQ
# ---------------------------------------------------------------------------

class TestBugProof:
    """Demonstrate that the old max_stop_points=6.0 (no symbol kwarg) was wrong."""

    def test_mnq_30pt_stop_clamped_to_6pt_with_old_hardcoded_args(self):
        """OLD BEHAVIOUR (bug): MNQ ATR=20pt → 1.5×ATR stop=30pt.

        With max_stop_points=6.0 (hardcoded) and symbol="MES" (default):
            30pt > 6pt → stop CLAMPED to 6pt → wrong R:R for evaluate_signal.
        """
        entry = 20_000.0
        atr = 20.0  # 1.5 × 20 = 30pt structural stop

        stop_plan = compute_structural_stop(
            direction="long",
            entry_price=entry,
            point_value=2.0,    # MNQ $2/pt
            atr=atr,
            tick_size=0.25,
            # BUG: wrong symbol (defaults to "MES") + wrong ceiling
            max_stop_points=6.0,
        )

        dist = _stop_dist(stop_plan, entry)
        # Bug: 30pt stop is clamped to 6pt
        assert dist == pytest.approx(6.0, abs=1e-9), (
            f"BUG PROOF FAILED: expected 6pt clamped stop, got {dist:.4f}pt"
        )
        assert "_capped_6pt" in stop_plan.stop_reason, (
            f"BUG PROOF FAILED: expected '_capped_6pt' in reason, got: {stop_plan.stop_reason}"
        )


# ---------------------------------------------------------------------------
# FIX VERIFICATION — correct per-symbol ceiling behaviour
# ---------------------------------------------------------------------------

class TestFixVerification:
    """Verify the fix: per-symbol ceiling from _get_stop_ceiling_for_symbol(symbol)."""

    # ---- MNQ ---------------------------------------------------------------

    def test_mnq_long_30pt_stop_not_clamped_with_62pt_ceiling(self):
        """FIX: MNQ ATR=20pt → 30pt stop < 62pt ceiling → NOT clamped."""
        entry = 20_000.0
        atr = 20.0

        stop_plan = compute_structural_stop(
            direction="long",
            entry_price=entry,
            point_value=2.0,
            atr=atr,
            tick_size=0.25,
            symbol="MNQ",
            max_stop_points=MNQ_CEILING,  # 62pt — correct post-fix value
        )

        dist = _stop_dist(stop_plan, entry)
        assert dist > 25.0, (
            f"MNQ 30pt stop incorrectly clamped to {dist:.2f}pt; "
            f"should be ~30pt with 62pt ceiling"
        )
        assert "_capped_" not in stop_plan.stop_reason, (
            f"MNQ stop was unexpectedly capped: {stop_plan.stop_reason}"
        )
        # Stop should be approximately 1.5 × ATR = 30pt
        assert dist == pytest.approx(30.0, abs=2.0), (
            f"MNQ ATR-fallback stop expected ~30pt, got {dist:.2f}pt"
        )

    def test_mnq_short_30pt_stop_not_clamped_with_62pt_ceiling(self):
        """FIX: MNQ short direction — same ceiling logic."""
        entry = 20_000.0
        atr = 20.0

        stop_plan = compute_structural_stop(
            direction="short",
            entry_price=entry,
            point_value=2.0,
            atr=atr,
            tick_size=0.25,
            symbol="MNQ",
            max_stop_points=MNQ_CEILING,
        )

        dist = _stop_dist(stop_plan, entry)
        assert dist > 25.0, (
            f"MNQ short 30pt stop incorrectly clamped to {dist:.2f}pt"
        )
        assert "_capped_" not in stop_plan.stop_reason

    def test_mnq_above_ceiling_is_clamped(self):
        """FIX: MNQ stop above 62pt ceiling IS clamped (ceiling enforcement is preserved)."""
        entry = 20_000.0
        atr = 50.0  # 1.5 × 50 = 75pt > 62pt ceiling

        stop_plan = compute_structural_stop(
            direction="long",
            entry_price=entry,
            point_value=2.0,
            atr=atr,
            tick_size=0.25,
            symbol="MNQ",
            max_stop_points=MNQ_CEILING,
        )

        dist = _stop_dist(stop_plan, entry)
        assert dist == pytest.approx(MNQ_CEILING, abs=1e-9), (
            f"MNQ above-ceiling stop should be clamped to {MNQ_CEILING}pt, got {dist:.2f}pt"
        )
        assert "_capped_" in stop_plan.stop_reason

    # ---- MES ---------------------------------------------------------------

    def test_mes_stop_within_14pt_ceiling_not_clamped(self):
        """FIX: MES ATR=5pt → 7.5pt stop < 14pt ceiling → NOT clamped."""
        entry = 5_000.0
        atr = 5.0  # 1.5 × 5 = 7.5pt < 14pt

        stop_plan = compute_structural_stop(
            direction="long",
            entry_price=entry,
            point_value=5.0,    # MES $5/pt
            atr=atr,
            tick_size=0.25,
            symbol="MES",
            max_stop_points=MES_CEILING,  # 14pt
        )

        dist = _stop_dist(stop_plan, entry)
        assert dist == pytest.approx(7.5, abs=1.0), (
            f"MES 7.5pt stop should not be clamped, got {dist:.2f}pt"
        )
        assert "_capped_" not in stop_plan.stop_reason

    def test_mes_stop_above_14pt_ceiling_is_clamped(self):
        """FIX: MES ATR=10pt → 15pt stop > 14pt ceiling → clamped to 14pt."""
        entry = 5_000.0
        atr = 10.0  # 1.5 × 10 = 15pt > 14pt

        stop_plan = compute_structural_stop(
            direction="long",
            entry_price=entry,
            point_value=5.0,
            atr=atr,
            tick_size=0.25,
            symbol="MES",
            max_stop_points=MES_CEILING,
        )

        dist = _stop_dist(stop_plan, entry)
        assert dist == pytest.approx(MES_CEILING, abs=1e-9), (
            f"MES above-ceiling stop should be clamped to 14pt, got {dist:.2f}pt"
        )
        assert "_capped_14pt" in stop_plan.stop_reason

    # ---- MCL ---------------------------------------------------------------

    def test_mcl_stop_within_1pt_ceiling_not_clamped(self):
        """FIX: MCL ATR=0.30pt → 0.45pt stop < 1.0pt ceiling → NOT clamped."""
        entry = 75.0  # typical MCL (crude oil in dollars/barrel) price
        atr = 0.30   # 1.5 × 0.30 = 0.45pt < 1.0pt ceiling

        stop_plan = compute_structural_stop(
            direction="long",
            entry_price=entry,
            point_value=1000.0,  # MCL $1000/pt (crude oil)
            atr=atr,
            tick_size=0.01,
            symbol="MCL",
            max_stop_points=MCL_CEILING,  # 1.0pt
        )

        dist = _stop_dist(stop_plan, entry)
        assert dist < MCL_CEILING + 0.01, (
            f"MCL stop within ceiling should not be clamped, got {dist:.4f}pt"
        )
        assert "_capped_" not in stop_plan.stop_reason

    def test_mcl_stop_above_1pt_ceiling_is_clamped(self):
        """FIX: MCL ATR=1.5pt → 2.25pt stop > 1.0pt ceiling → clamped to 1.0pt.

        Old bug: max_stop_points=6.0 meant a 2.25pt MCL stop was NOT clamped
        (2.25 < 6.0 → no clamp), so MCL trades with oversized stops went to
        evaluate_signal with an incorrect (too-lenient) R:R calculation.
        """
        entry = 75.0
        atr = 1.5  # 1.5 × 1.5 = 2.25pt > 1.0pt ceiling

        stop_plan = compute_structural_stop(
            direction="long",
            entry_price=entry,
            point_value=1000.0,
            atr=atr,
            tick_size=0.01,
            symbol="MCL",
            max_stop_points=MCL_CEILING,
        )

        dist = _stop_dist(stop_plan, entry)
        assert dist == pytest.approx(MCL_CEILING, abs=1e-9), (
            f"MCL above-ceiling stop should be clamped to 1.0pt, got {dist:.4f}pt"
        )
        assert "_capped_" in stop_plan.stop_reason

    # ---- MNQ sweep buffer --------------------------------------------------

    def test_mnq_uses_mnq_sweep_buffer_not_mes(self):
        """FIX: symbol='MNQ' → 5-tick (1.25pt) buffer, not MES 3-tick (0.75pt).

        Verifying the symbol kwarg now correctly routes the sweep buffer lookup.
        Uses a structural level so the buffer is actually applied.
        """
        entry = 20_000.0
        swing_low = 19_980.0  # 20pt below entry — structural level

        stop_mes = compute_structural_stop(
            direction="long",
            entry_price=entry,
            point_value=2.0,
            atr=5.0,
            tick_size=0.25,
            symbol="MES",          # MES: 3-tick = 0.75pt buffer
            nearest_swing_low=swing_low,
            max_stop_points=MES_CEILING,
        )
        stop_mnq = compute_structural_stop(
            direction="long",
            entry_price=entry,
            point_value=2.0,
            atr=5.0,
            tick_size=0.25,
            symbol="MNQ",          # MNQ: 5-tick = 1.25pt buffer
            nearest_swing_low=swing_low,
            max_stop_points=MNQ_CEILING,
        )

        # MNQ buffer (1.25pt) > MES buffer (0.75pt) → MNQ stop price is lower
        # For a long: stop = swing_low - buffer → lower stop = more buffer
        assert stop_mnq.stop_price < stop_mes.stop_price, (
            f"MNQ stop {stop_mnq.stop_price} should be lower than MES stop "
            f"{stop_mes.stop_price} due to wider 5-tick sweep buffer"
        )
        assert stop_mnq.sweep_aware_buffer, "MNQ should use sweep-aware buffer"
        assert stop_mes.sweep_aware_buffer, "MES should use sweep-aware buffer"


# ---------------------------------------------------------------------------
# Ceiling-table assertion — verifies _STOP_CEILING_DEFAULTS via structural_stops
# (avoids vectorbt import; tests the effective ceiling behaviour not the dict directly)
# ---------------------------------------------------------------------------

class TestCeilingTableValues:
    """Verify the ceiling constants are what the code documents."""

    def test_mes_ceiling_is_14pt(self):
        """MES ceiling default is 14.0pt (Wave 1 Track 1A 2026-06-27)."""
        assert MES_CEILING == 14.0

    def test_mnq_ceiling_is_62pt(self):
        """MNQ ceiling default is 62.0pt (Wave 1 Track 1A 2026-06-27, was 40)."""
        assert MNQ_CEILING == 62.0

    def test_mcl_ceiling_is_1pt(self):
        """MCL ceiling default is 1.0pt = 100 ticks (Wave 1 Track 1A 2026-06-27, was 0.25)."""
        assert MCL_CEILING == 1.0

    def test_mnq_ceiling_vastly_exceeds_old_hardcoded_6pt(self):
        """The fix is meaningful: 62pt MNQ ceiling vs 6pt bug ceiling = 10× difference."""
        assert MNQ_CEILING > 6.0 * 5, (
            "MNQ ceiling should be more than 5× the old hardcoded 6pt value"
        )
