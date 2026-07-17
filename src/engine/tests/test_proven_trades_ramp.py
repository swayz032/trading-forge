"""Scaling-plan-baby-mode (2026-06-23): Proven-trades ramp tests.

Covers:
  (a) Correct tier at N=0/10/20/55 proven trades (PROVEN_TRADES_PER_TIER=10)
  (b) Backward-compat: proven_trades=None → identical to dollar mode
  (c) Withdrawal-safety: drop in cumulativeProfit does NOT lower size when proven_trades drives tier
  (d) 8%-buffer cap allows base 9 on fresh $50K / $2K-buffer Topstep
  (e) TS↔Python parity for ramp across 4 tier cases

TS parity contract:
  tier = floor(proven_trades / proven_trades_per_tier)   [proven-trades mode]
  tier = floor(max(0, cumulative_profit) / tier_threshold)  [dollar fallback]
  pyramidTier = base_contracts + tier_increment × tier
"""

import math
import os

import pytest

from src.engine.sizing import (
    _PROVEN_TRADES_PER_TIER,
    compute_risk_derived_contracts,
)

# ── Shared fixture builder ────────────────────────────────────────────────────

BASE_CONTRACTS = 9   # scaling-plan-baby-mode base
TIER_INC = 3
TIER_THRESH = 3_000.0
MAX_RISK = 0.02
ATR = 4.0
STOP_MULT = 1.5
PV = 5.0   # MES $5/pt
STOP_DOLLARS = STOP_MULT * ATR * PV  # = $30.0
LIQ_CAP = 200


def _base_kwargs(**overrides) -> dict:
    """Standard Topstep kwargs — all defaults sensible for scaling tests."""
    defaults = dict(
        base_contracts=BASE_CONTRACTS,
        tier_increment=TIER_INC,
        tier_threshold_dollars=TIER_THRESH,
        max_risk_pct_per_trade=MAX_RISK,
        liquidity_comfort_cap=LIQ_CAP,
        account_balance=52_000.0,
        cumulative_profit=0.0,         # no dollar-mode tiers by default
        atr_points=ATR,
        stop_multiplier=STOP_MULT,
        point_dollar_value=PV,
        firm_contract_cap=500,          # intentionally high — let sizing breathe
        firm="topstep",
        trailing_dd=2_000.0,
        high_water_balance=52_000.0,
        account_starting_floor=50_000.0,
    )
    defaults.update(overrides)
    return defaults


# ── (a) Correct tiers at N = 0, 10, 20, 55 ──────────────────────────────────


class TestProvenTradesTierFormula:
    """
    With PROVEN_TRADES_PER_TIER=10 (default), verify:
      tier = floor(proven_trades / 10)
      pyramid_tier = base + tier_inc × tier
    """

    def _expected_pyramid_tier(self, proven_trades: int) -> int:
        pt_per_tier = _PROVEN_TRADES_PER_TIER if _PROVEN_TRADES_PER_TIER > 0 else 10
        tier = math.floor(proven_trades / pt_per_tier)
        return BASE_CONTRACTS + TIER_INC * tier

    @pytest.mark.parametrize("proven_trades,expected_tier", [
        (0,  0),   # no ramp yet
        (9,  0),   # < 10 → still tier 0
        (10, 1),   # exactly 10 → tier 1
        (19, 1),   # just below tier 2
        (20, 2),   # exactly 20 → tier 2
        (55, 5),   # 55 // 10 = 5
    ])
    def test_tier_formula_correct(self, proven_trades, expected_tier):
        expected_pyramid = BASE_CONTRACTS + TIER_INC * expected_tier
        result = compute_risk_derived_contracts(
            **_base_kwargs(proven_trades=proven_trades)
        )
        assert result.scaling_mode == "proven_trades", (
            f"proven_trades={proven_trades}: expected scaling_mode='proven_trades'"
        )
        assert result.scaling_tier == expected_tier, (
            f"proven_trades={proven_trades}: expected tier={expected_tier}, got {result.scaling_tier}"
        )
        # pyramid_tier should equal base + inc × tier (or lower if caps bind)
        # The result may be clamped by risk/DD caps — just verify scaling_tier matches.
        # For expected_pyramid <= liquidity cap and account is healthy we expect pyramid_tier.
        if expected_pyramid <= LIQ_CAP:
            assert result.pyramid_tier == expected_pyramid, (
                f"proven_trades={proven_trades}: pyramid_tier expected {expected_pyramid}, got {result.pyramid_tier}"
            )

    def test_zero_proven_trades_gives_base_contracts(self):
        """N=0 → tier 0 → pyramid_tier == base_contracts."""
        result = compute_risk_derived_contracts(**_base_kwargs(proven_trades=0))
        assert result.scaling_tier == 0
        assert result.scaling_mode == "proven_trades"
        assert result.pyramid_tier == BASE_CONTRACTS

    def test_ten_proven_trades_tier_1(self):
        """N=10 → tier 1 → pyramid_tier = base + 3 = 12."""
        result = compute_risk_derived_contracts(**_base_kwargs(proven_trades=10))
        assert result.scaling_tier == 1
        assert result.pyramid_tier == BASE_CONTRACTS + TIER_INC

    def test_twenty_proven_trades_tier_2(self):
        """N=20 → tier 2 → pyramid_tier = base + 6 = 15."""
        result = compute_risk_derived_contracts(**_base_kwargs(proven_trades=20))
        assert result.scaling_tier == 2
        assert result.pyramid_tier == BASE_CONTRACTS + 2 * TIER_INC

    def test_fifty_five_proven_trades_tier_5(self):
        """N=55 → tier 5 → pyramid_tier = base + 15 = 24."""
        result = compute_risk_derived_contracts(**_base_kwargs(proven_trades=55))
        assert result.scaling_tier == 5
        assert result.pyramid_tier == BASE_CONTRACTS + 5 * TIER_INC


# ── (b) Backward compat: proven_trades absent = dollar mode ──────────────────


class TestBackwardCompat:
    """proven_trades=None must produce byte-identical results to prior behavior."""

    def test_dollar_mode_when_proven_trades_absent(self):
        """No proven_trades → scaling_mode='dollar_fallback', same tier as before."""
        result = compute_risk_derived_contracts(
            **_base_kwargs(cumulative_profit=0.0)  # no proven_trades kwarg
        )
        assert result.scaling_mode == "dollar_fallback"
        assert result.scaling_tier == 0
        assert result.pyramid_tier == BASE_CONTRACTS

    def test_dollar_mode_one_tier(self):
        """$3K profit → tier 1 in dollar mode."""
        result = compute_risk_derived_contracts(
            **_base_kwargs(cumulative_profit=3_000.0)
        )
        assert result.scaling_mode == "dollar_fallback"
        assert result.scaling_tier == 1
        assert result.pyramid_tier == BASE_CONTRACTS + TIER_INC

    def test_proven_trades_none_identical_to_absent(self):
        """Explicitly passing proven_trades=None is byte-identical to not passing it."""
        result_absent = compute_risk_derived_contracts(**_base_kwargs(cumulative_profit=2_000.0))
        result_none = compute_risk_derived_contracts(**_base_kwargs(cumulative_profit=2_000.0, proven_trades=None))
        assert result_absent.final_contracts == result_none.final_contracts
        assert result_absent.scaling_mode == result_none.scaling_mode == "dollar_fallback"
        assert result_absent.scaling_tier == result_none.scaling_tier

    def test_proven_trades_zero_vs_dollar_fallback_tier(self):
        """proven_trades=0 → proven mode / tier 0; dollar mode with $0 profit → also tier 0; both same final size."""
        result_pt = compute_risk_derived_contracts(**_base_kwargs(proven_trades=0, cumulative_profit=0.0))
        result_dollar = compute_risk_derived_contracts(**_base_kwargs(cumulative_profit=0.0))
        # Both should produce the same pyramid tier and final contracts
        assert result_pt.pyramid_tier == result_dollar.pyramid_tier
        assert result_pt.final_contracts == result_dollar.final_contracts
        assert result_pt.scaling_mode == "proven_trades"
        assert result_dollar.scaling_mode == "dollar_fallback"


# ── (c) Withdrawal safety: proven_trades mode monotonic ──────────────────────


class TestWithdrawalSafety:
    """
    When proven_trades is the tier driver, a drop in cumulativeProfit must NOT
    lower the pyramid tier. proven_trades is monotonic by contract.
    """

    def test_profit_drop_does_not_lower_tier_in_proven_mode(self):
        """After a losing trade, profit drops but tier stays if proven_trades is unchanged."""
        proven_count = 20   # tier 2
        result_before = compute_risk_derived_contracts(
            **_base_kwargs(proven_trades=proven_count, cumulative_profit=3_000.0)
        )
        # Simulate a losing trade: profit drops
        result_after = compute_risk_derived_contracts(
            **_base_kwargs(proven_trades=proven_count, cumulative_profit=-500.0)
        )
        # proven_trades unchanged → tier must be identical
        assert result_after.scaling_tier == result_before.scaling_tier == 2
        assert result_after.pyramid_tier == result_before.pyramid_tier
        assert result_after.scaling_mode == "proven_trades"

    def test_dollar_mode_is_sensitive_to_profit_drop(self):
        """Dollar mode (contrast): profit drop CAN lower the tier."""
        result_high = compute_risk_derived_contracts(
            **_base_kwargs(cumulative_profit=3_000.0)  # tier 1
        )
        result_low = compute_risk_derived_contracts(
            **_base_kwargs(cumulative_profit=-500.0)   # tier 0
        )
        assert result_high.scaling_tier == 1
        assert result_low.scaling_tier == 0
        # proven_trades mode does NOT have this property — withdrawal-safe.


# ── (d) 8% buffer cap allows base 9 on fresh $50K / $2K-buffer Topstep ───────


class TestEightPctBufferCap:
    """
    Fresh Topstep 50K account:
      trailing_floor = 50_000 (starting floor)
      buffer = 52_000 - 50_000 = $2_000
      risk_dollars = buffer × 0.02 = $40
      risk_derived_cap = floor(40 / 30) = 1

    C-05/D9 (2026-07-16): the pyramid-floor override was REMOVED — risk math wins, lowest wins.
    On this fresh combine risk_derived_cap = 1 now BINDS (final = 1), regardless of base 9 or
    account health. A narrow-buffer combine trades the risk cap or skips, never a fabricated base floor.
    """

    def test_base_9_on_fresh_account_no_dd_room_cap(self):
        """C-05/D9: no floor override — risk cap (1) binds on a fresh $2K-buffer combine."""
        result = compute_risk_derived_contracts(
            **_base_kwargs(
                account_balance=52_000.0,
                high_water_balance=52_000.0,
                account_starting_floor=50_000.0,
                trailing_dd=2_000.0,
                cumulative_profit=0.0,
                # current_drawdown_room not provided → no DD-room cap
                firm_contract_cap=50,
            )
        )
        # risk_derived_cap = floor(2000 × 0.02 / 30) = 1 → binds (lowest wins), no floor
        assert result.risk_derived_cap == 1
        assert result.pyramid_floor_applied is False
        assert result.final_contracts == 1
        assert result.drawdown_room_cap is None

    def test_8pct_drawdown_room_cap_allows_base_9_at_3375_room(self):
        """C-05/D9: floor override REMOVED. current_drawdown_room=$3,375 → DD cap=9, but the
        small-buffer risk cap (1) is lower and now binds (lowest wins) → final = 1."""
        room = 3_375.0
        expected_dd_cap = math.floor(room * 0.08 / STOP_DOLLARS)
        assert expected_dd_cap == 9, f"Math precondition: expected 9, got {expected_dd_cap}"
        result = compute_risk_derived_contracts(
            **_base_kwargs(
                account_balance=52_000.0,
                high_water_balance=52_000.0,
                account_starting_floor=50_000.0,
                trailing_dd=2_000.0,
                current_drawdown_room=room,
                cumulative_profit=0.0,
                firm_contract_cap=50,
            )
        )
        assert result.drawdown_room_cap == expected_dd_cap
        assert result.risk_derived_cap == 1
        assert result.final_contracts == 1  # risk cap (1) < DD cap (9); lowest wins

    def test_8pct_small_dd_room_caps_below_base(self):
        """
        Small DD room → cap < base → DD room cap wins over pyramid floor.
        room = $300 → cap = floor(300 × 0.08 / 30) = floor(0.8) = 0 → 0 contracts.
        """
        result = compute_risk_derived_contracts(
            **_base_kwargs(
                account_balance=52_000.0,
                high_water_balance=52_000.0,
                account_starting_floor=50_000.0,
                trailing_dd=2_000.0,
                current_drawdown_room=300.0,
                cumulative_profit=0.0,
                firm_contract_cap=50,
            )
        )
        assert result.drawdown_room_cap == 0
        assert result.drawdown_room_cap_binding is True
        assert result.final_contracts == 0


# ── (e) TS↔Python parity for ramp across 4 tier cases ────────────────────────


class TestTSPythonParityRamp:
    """
    Verify Python sizing formula matches what TypeScript produces.
    TS formula (from risk-sizing.ts):
      tiers = (provenTrades != null) ? floor(provenTrades / PROVEN_TRADES_PER_TIER)
                                     : floor(max(0, cumulativeProfit) / tier_threshold)
      pyramidTierRaw = base_contracts + tier_increment * tiers

    We verify by checking the Python result's scaling_tier and pyramid_tier
    match the expected formula output for each case.
    """

    @pytest.mark.parametrize("proven_trades,expected_tier", [
        (0,  0),
        (10, 1),
        (20, 2),
        (55, 5),
    ])
    def test_parity_proven_trades_tier(self, proven_trades, expected_tier):
        """Python and TS must compute identical tier = floor(pt / 10)."""
        expected_pyramid = BASE_CONTRACTS + TIER_INC * expected_tier

        result = compute_risk_derived_contracts(**_base_kwargs(proven_trades=proven_trades))

        assert result.scaling_mode == "proven_trades"
        assert result.scaling_tier == expected_tier, (
            f"proven_trades={proven_trades}: Python scaling_tier={result.scaling_tier}, "
            f"expected TS-equivalent tier={expected_tier}"
        )
        assert result.pyramid_tier == expected_pyramid, (
            f"proven_trades={proven_trades}: Python pyramid_tier={result.pyramid_tier}, "
            f"expected TS-equivalent {expected_pyramid}"
        )

    @pytest.mark.parametrize("cumulative_profit,expected_tier", [
        (0.0,   0),
        (3_000.0, 1),
        (6_000.0, 2),
        (16_500.0, 5),
    ])
    def test_parity_dollar_fallback_tier(self, cumulative_profit, expected_tier):
        """Dollar-fallback mode: tier = floor(profit / 3000)."""
        expected_pyramid = BASE_CONTRACTS + TIER_INC * expected_tier

        result = compute_risk_derived_contracts(
            **_base_kwargs(cumulative_profit=cumulative_profit)
        )

        assert result.scaling_mode == "dollar_fallback"
        assert result.scaling_tier == expected_tier, (
            f"cumulative_profit={cumulative_profit}: Python scaling_tier={result.scaling_tier}, "
            f"expected TS-equivalent tier={expected_tier}"
        )
        assert result.pyramid_tier == expected_pyramid, (
            f"cumulative_profit={cumulative_profit}: Python pyramid_tier={result.pyramid_tier}, "
            f"expected TS-equivalent {expected_pyramid}"
        )


# ── Extra edge cases ──────────────────────────────────────────────────────────


class TestEdgeCases:
    def test_proven_trades_negative_treated_as_zero(self):
        """Negative proven_trades input → treated as 0 (max(0, ...) guard)."""
        result = compute_risk_derived_contracts(**_base_kwargs(proven_trades=-5))
        assert result.scaling_tier == 0
        assert result.scaling_mode == "proven_trades"

    def test_proven_trades_large_value(self):
        """Large proven_trades value → large tier (no artificial cap imposed by sizing)."""
        result = compute_risk_derived_contracts(**_base_kwargs(proven_trades=1_000))
        expected_tier = 1_000 // (_PROVEN_TRADES_PER_TIER or 10)
        assert result.scaling_tier == expected_tier
        assert result.scaling_mode == "proven_trades"

    def test_proven_trades_float_accepted(self):
        """Float proven_trades (e.g. 10.0) should work — truncated to int."""
        result = compute_risk_derived_contracts(**_base_kwargs(proven_trades=10.0))
        assert result.scaling_tier == 1
        assert result.scaling_mode == "proven_trades"

    def test_scaling_mode_in_zero_balance_result(self):
        """Even zero_balance early return emits scaling_mode and scaling_tier."""
        result = compute_risk_derived_contracts(**_base_kwargs(account_balance=0.0))
        assert result.rejection_reason == "zero_balance"
        assert result.scaling_mode in ("proven_trades", "dollar_fallback")
        assert isinstance(result.scaling_tier, int)

    def test_scaling_mode_in_zero_atr_result(self):
        """Even zero_atr early return emits scaling_mode and scaling_tier."""
        result = compute_risk_derived_contracts(**_base_kwargs(atr_points=0.0))
        assert result.rejection_reason == "zero_atr"
        assert result.scaling_mode in ("proven_trades", "dollar_fallback")
        assert isinstance(result.scaling_tier, int)

    def test_scaling_mode_in_zero_buffer_result(self):
        """zero_buffer early return (Topstep, buffer=0) emits scaling_mode and scaling_tier."""
        result = compute_risk_derived_contracts(
            **_base_kwargs(
                account_balance=50_000.0,
                high_water_balance=50_000.0,
                account_starting_floor=50_000.0,
                trailing_dd=2_000.0,
            )
        )
        # trailing_floor = min(50000-2000, 50000) = 48000; buffer = 50000-48000 = 2000 > 0
        # Actually this won't be zero_buffer. Use a case where buffer <= 0:
        # account_balance = 48500, trailing_floor = min(52000-2000,50000)=50000 → too complex.
        # Simpler: use account_balance <= trailing_floor directly.
        result2 = compute_risk_derived_contracts(
            **_base_kwargs(
                account_balance=49_500.0,
                high_water_balance=52_000.0,
                account_starting_floor=50_000.0,
                trailing_dd=2_000.0,
            )
        )
        # trailing_floor = min(52000 - 2000, 50000) = 50000; buffer = 49500 - 50000 = -500 <= 0
        assert result2.rejection_reason == "zero_buffer"
        assert result2.scaling_mode in ("proven_trades", "dollar_fallback")
        assert isinstance(result2.scaling_tier, int)
