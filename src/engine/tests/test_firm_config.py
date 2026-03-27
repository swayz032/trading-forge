"""Tests for per-firm commissions and contract caps (Tasks 3.11 + 3.12)."""

import math

import numpy as np
import polars as pl
import pytest

from src.engine.firm_config import (
    FIRM_COMMISSIONS,
    FIRM_CONTRACT_CAPS,
    get_commission_per_side,
    get_contract_cap,
)
from src.engine.sizing import compute_position_sizes
from src.engine.config import (
    ContractSpec,
    PositionSizeConfig,
    CONTRACT_SPECS,
)


# ─── Task 3.11: Per-Firm Commission Tests ────────────────────────

class TestFirmCommissions:
    def test_all_8_firms_present(self):
        """All 8 prop firms have commission data."""
        expected_firms = {
            "topstep_50k", "mffu_50k", "tpt_50k", "apex_50k",
            "tradeify_50k", "alpha_50k", "ffn_50k", "earn2trade_50k",
        }
        assert set(FIRM_COMMISSIONS.keys()) == expected_firms

    def test_alpha_zero_commission(self):
        """Alpha Futures has zero commissions."""
        alpha = get_commission_per_side("alpha_50k", "MES")
        assert alpha == 0.00

        # Verify it's cheapest across all firms for MES
        for firm_key in FIRM_COMMISSIONS:
            comm = get_commission_per_side(firm_key, "MES")
            assert comm >= alpha

    def test_tradeify_most_expensive(self):
        """Tradeify has the most expensive commissions at $1.29/side."""
        tradeify = get_commission_per_side("tradeify_50k", "MES")
        assert tradeify == 1.29

        # Verify it's most expensive across all firms for MES
        for firm_key in FIRM_COMMISSIONS:
            comm = get_commission_per_side(firm_key, "MES")
            assert comm <= tradeify

    def test_unknown_firm_raises(self):
        """Unknown firm_key raises ValueError."""
        with pytest.raises(ValueError, match="Unknown firm"):
            get_commission_per_side("unknown_firm", "MES")

    def test_unknown_symbol_raises(self):
        """Unknown symbol raises ValueError."""
        with pytest.raises(ValueError, match="Unknown symbol"):
            get_commission_per_side("mffu_50k", "INVALID")

    def test_commission_impacts_net_pnl(self):
        """$260/day gross: passes Alpha net gate, may fail Tradeify net gate.

        Alpha: $0.00/side × 2 sides × 2 trades/day = $0.00 → net $260.00
        Tradeify: $1.29/side × 2 sides × 2 trades/day = $5.16 → net $254.84

        Both pass $250 gate, but Alpha keeps more profit.
        """
        gross_daily = 260.0
        trades_per_day = 2  # round trips

        alpha_comm = get_commission_per_side("alpha_50k", "MES")
        tradeify_comm = get_commission_per_side("tradeify_50k", "MES")

        alpha_net = gross_daily - (alpha_comm * 2 * trades_per_day)
        tradeify_net = gross_daily - (tradeify_comm * 2 * trades_per_day)

        assert alpha_net >= 250, f"Alpha net ${alpha_net:.2f} should pass $250 gate"
        assert alpha_net > tradeify_net, "Alpha should keep more profit than Tradeify"


# ─── Task 3.12: Contract Cap Tests ──────────────────────────────

class TestContractCaps:
    def test_all_firms_default_15(self):
        """All firms default to 15 contracts for all micro symbols."""
        for firm_key in FIRM_CONTRACT_CAPS:
            for symbol in ["MES", "MNQ", "MCL"]:
                assert get_contract_cap(firm_key, symbol) == 15

    def test_cap_clamped_to_min_10(self):
        """get_contract_cap never returns below CONTRACT_CAP_MIN (10)."""
        from src.engine.firm_config import CONTRACT_CAP_MIN
        for firm_key in FIRM_CONTRACT_CAPS:
            for symbol in ["MES", "MNQ", "MCL"]:
                assert get_contract_cap(firm_key, symbol) >= CONTRACT_CAP_MIN

    def test_cap_clamped_to_max_20(self):
        """get_contract_cap never returns above CONTRACT_CAP_MAX (20)."""
        from src.engine.firm_config import CONTRACT_CAP_MAX
        for firm_key in FIRM_CONTRACT_CAPS:
            for symbol in ["MES", "MNQ", "MCL"]:
                assert get_contract_cap(firm_key, symbol) <= CONTRACT_CAP_MAX

    def test_atr_wants_more_capped_to_firm_limit(self):
        """ATR sizing wants >15 MES, firm cap 15 → capped to 15."""
        from datetime import datetime, timedelta
        from src.engine.indicators.core import compute_atr

        n = 30
        dates = [datetime(2023, 1, 1) + timedelta(days=i) for i in range(n)]
        # Very low ATR to get high contract count: target_risk / (ATR * tick_value)
        # Want >15: 500 / (ATR * 1.25) > 15 → ATR < 26.67
        df = pl.DataFrame({
            "ts_event": dates,
            "open":   [4000.0] * n,
            "high":   [4001.0] * n,  # very tight range → very low ATR
            "low":    [3999.0] * n,
            "close":  [4000.5] * n,
            "volume": [50000] * n,
        })

        atr = compute_atr(df, 14)
        df = df.with_columns(atr.alias("atr_14"))

        config = PositionSizeConfig(type="dynamic_atr", target_risk_dollars=500)
        spec = CONTRACT_SPECS["MES"]

        # Without cap
        sizes_uncapped, _ = compute_position_sizes(df, config, spec, atr_period=14)

        # With firm cap of 15
        sizes_capped, _ = compute_position_sizes(
            df, config, spec, atr_period=14, max_contracts=15,
        )

        # Find bars where uncapped > 15
        for i in range(n):
            if not math.isnan(sizes_uncapped[i]) and sizes_uncapped[i] > 15:
                assert sizes_capped[i] == 15

    def test_atr_below_cap_unchanged(self):
        """ATR wants 3 MES, firm cap 15 → stays at 3."""
        from datetime import datetime, timedelta
        from src.engine.indicators.core import compute_atr

        n = 30
        dates = [datetime(2023, 1, 1) + timedelta(days=i) for i in range(n)]
        df = pl.DataFrame({
            "ts_event": dates,
            "open":   [4000.0] * n,
            "high":   [4015.0] * n,
            "low":    [3985.0] * n,
            "close":  [4001.0] * n,
            "volume": [50000] * n,
        })

        atr = compute_atr(df, 14)
        df = df.with_columns(atr.alias("atr_14"))

        config = PositionSizeConfig(type="dynamic_atr", target_risk_dollars=500)
        spec = CONTRACT_SPECS["MES"]

        sizes, _ = compute_position_sizes(
            df, config, spec, atr_period=14, max_contracts=15,
        )

        # All sizes should be <= 15 and unchanged from uncapped
        sizes_uncapped, _ = compute_position_sizes(df, config, spec, atr_period=14)
        for i in range(n):
            if not math.isnan(sizes[i]) and sizes_uncapped[i] <= 15:
                assert sizes[i] == sizes_uncapped[i]

    def test_unknown_firm_cap_raises(self):
        """Firm not in cap table raises ValueError."""
        with pytest.raises(ValueError, match="No contract cap"):
            get_contract_cap("unknown_firm", "MES")
