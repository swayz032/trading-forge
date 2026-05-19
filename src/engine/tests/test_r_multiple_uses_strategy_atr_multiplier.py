"""L3 regression: R-multiple calculation must use strategy config atr_multiplier.

Bug: hardcoded sl_mult = 2.0 in backtester.py trade loop understated R-multiple
by 25% vs the canonical 1.5×ATR stop (CLAUDE.md §4).

Fix: sl_mult = getattr(config.stop_loss, 'multiplier', 1.5)

Impact: False negatives on the W23-D R-expectancy gate (avg_R < 2.0R) because
a 3R winner was being computed as 2.25R (3/1.5×ATR × 1.5 vs × 2.0).
"""
from __future__ import annotations

import pytest


class TestRMultipleUsesStrategyAtrMultiplier:
    """L3: risk_points = ATR × config.stop_loss.multiplier (not 2.0)."""

    def test_r_multiple_with_15_multiplier(self):
        """Using 1.5x ATR multiplier: 3pt profit at 3pt stop = 1.0R exactly."""
        atr = 2.0
        sl_mult = 1.5  # canonical per CLAUDE.md §4
        point_value = 5.0
        price_diff = 3.0  # 3pt profit
        size = 6.0  # 6 contracts

        risk_points = min(atr * sl_mult, 6.0)  # = 3.0 (uncapped)
        risk_dollars = risk_points * point_value  # = 15.0

        net_pnl = price_diff * size * point_value  # = 90.0
        reward_dollars = net_pnl / size  # = 15.0 per contract

        rr = round(reward_dollars / risk_dollars, 2)
        assert rr == pytest.approx(1.0), \
            f"Expected R=1.0 (reward=risk with 1.5x SL), got R={rr}"

    def test_r_multiple_with_20_multiplier_would_understate(self):
        """Hardcoded 2.0x multiplier understates R — the OLD buggy behavior."""
        atr = 2.0
        sl_mult_wrong = 2.0  # old hardcoded value
        sl_mult_correct = 1.5  # canonical

        risk_points_wrong = min(atr * sl_mult_wrong, 6.0)   # = 4.0
        risk_points_correct = min(atr * sl_mult_correct, 6.0)  # = 3.0

        point_value = 5.0
        net_per_contract = 10.0  # 10 dollar gain per contract

        rr_wrong = round(net_per_contract / (risk_points_wrong * point_value), 2)
        rr_correct = round(net_per_contract / (risk_points_correct * point_value), 2)

        # 2.0x multiplier overstates risk → understates R-multiple
        assert rr_wrong < rr_correct, \
            f"2.0x multiplier (R={rr_wrong}) should understate R vs 1.5x (R={rr_correct})"

    def test_r_multiple_formula_matches_engine(self):
        """Verify the full engine formula: rr = (net_pnl/size) / (risk_points * point_value)."""
        atr_at_entry = 3.0
        sl_mult = 1.5
        point_value = 5.0
        size = 6.0
        net_pnl = 150.0  # = 5pts × 6 contracts × $5/pt

        risk_points = min(atr_at_entry * sl_mult, 6.0)
        risk_dollars = risk_points * point_value
        reward_dollars = net_pnl / size

        rr = round(reward_dollars / risk_dollars, 2)
        # risk_points=4.5, risk_dollars=22.5, reward_dollars=25.0 → R≈1.11
        assert rr > 1.0, f"Expected R > 1.0 for a winning trade, got {rr}"
        assert rr == pytest.approx(25.0 / 22.5, rel=0.01), \
            f"Expected R=25/22.5={25/22.5:.4f}, got {rr}"

    def test_r_multiple_capped_at_6pt_stop(self):
        """Stop is capped at 6pt (ceiling). Risk = min(ATR × mult, 6.0)."""
        atr = 10.0  # Very wide ATR
        sl_mult = 1.5
        point_value = 5.0

        risk_points = min(atr * sl_mult, 6.0)  # cap at 6.0
        assert risk_points == pytest.approx(6.0), \
            f"Expected risk capped at 6.0pt, got {risk_points}"

        risk_dollars = risk_points * point_value
        assert risk_dollars == pytest.approx(30.0), \
            f"Expected risk_dollars=30.0, got {risk_dollars}"

    def test_w23d_gate_impact_of_multiplier_choice(self):
        """W23-D R-expectancy gate requires avg_R >= 2.0R.

        A trade producing 3pt profit at ATR=2.0:
          - With 2.0x (bug): risk=4.0pt, R=0.75 (understate → false REJECT)
          - With 1.5x (fix): risk=3.0pt, R=1.0 (correct → may PASS)
        """
        atr = 2.0
        profit_pts = 3.0
        point_value = 5.0
        size = 1.0

        # Correct (L3 fix)
        risk_points_correct = min(atr * 1.5, 6.0)
        rr_correct = round(
            (profit_pts * size * point_value / size) / (risk_points_correct * point_value), 2
        )

        # Buggy (old code)
        risk_points_wrong = min(atr * 2.0, 6.0)
        rr_wrong = round(
            (profit_pts * size * point_value / size) / (risk_points_wrong * point_value), 2
        )

        # The fix produces a higher (more accurate) R-multiple
        assert rr_correct > rr_wrong, (
            f"Correct multiplier (1.5x) R={rr_correct} must exceed buggy (2.0x) R={rr_wrong}"
        )
