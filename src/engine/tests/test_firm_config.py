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
    def test_all_7_firms_present(self):
        """All 7 prop firms have commission data."""
        expected_firms = {
            "topstep_50k", "mffu_50k", "tpt_50k", "apex_50k",
            "tradeify_50k", "alpha_50k", "ffn_50k",
        }
        assert set(FIRM_COMMISSIONS.keys()) == expected_firms

    def test_mffu_cheapest(self):
        """MFFU has the cheapest commissions at $1.58/side."""
        mffu = get_commission_per_side("mffu_50k", "ES")
        assert mffu == 1.58

        # Verify it's cheapest across all firms for ES
        for firm_key in FIRM_COMMISSIONS:
            comm = get_commission_per_side(firm_key, "ES")
            assert comm >= mffu

    def test_apex_most_expensive(self):
        """Apex has the most expensive commissions at $2.64/side."""
        apex = get_commission_per_side("apex_50k", "ES")
        assert apex == 2.64

        # Verify it's most expensive across all firms for ES
        for firm_key in FIRM_COMMISSIONS:
            comm = get_commission_per_side(firm_key, "ES")
            assert comm <= apex

    def test_unknown_firm_raises(self):
        """Unknown firm_key raises ValueError."""
        with pytest.raises(ValueError, match="Unknown firm"):
            get_commission_per_side("unknown_firm", "ES")

    def test_unknown_symbol_raises(self):
        """Unknown symbol raises ValueError."""
        with pytest.raises(ValueError, match="Unknown symbol"):
            get_commission_per_side("mffu_50k", "INVALID")

    def test_commission_impacts_net_pnl(self):
        """$260/day gross: passes MFFU net gate, fails Apex net gate.

        MFFU: $1.58/side × 2 sides × 2 trades/day = $6.32 → net $253.68
        Apex: $2.64/side × 2 sides × 2 trades/day = $10.56 → net $249.44

        With $250 daily min gate: MFFU passes, Apex fails.
        """
        gross_daily = 260.0
        trades_per_day = 2  # round trips

        mffu_comm = get_commission_per_side("mffu_50k", "ES")
        apex_comm = get_commission_per_side("apex_50k", "ES")

        mffu_net = gross_daily - (mffu_comm * 2 * trades_per_day)
        apex_net = gross_daily - (apex_comm * 2 * trades_per_day)

        assert mffu_net >= 250, f"MFFU net ${mffu_net:.2f} should pass $250 gate"
        assert apex_net < 250, f"Apex net ${apex_net:.2f} should fail $250 gate"

    def test_micro_contracts_cheaper(self):
        """Micro contracts (MES, MNQ) have lower commissions."""
        for firm_key in FIRM_COMMISSIONS:
            es_comm = get_commission_per_side(firm_key, "ES")
            mes_comm = get_commission_per_side(firm_key, "MES")
            assert mes_comm < es_comm


# ─── Task 3.12: Contract Cap Tests ──────────────────────────────

class TestContractCaps:
    def test_topstep_es_cap_5(self):
        """Topstep 50K caps ES at 5 contracts."""
        assert get_contract_cap("topstep_50k", "ES") == 5

    def test_tpt_stricter_than_topstep(self):
        """TPT is stricter: 3 ES vs Topstep's 5 ES."""
        tpt = get_contract_cap("tpt_50k", "ES")
        topstep = get_contract_cap("topstep_50k", "ES")
        assert tpt < topstep
        assert tpt == 3
        assert topstep == 5

    def test_atr_wants_8_capped_to_5(self):
        """ATR sizing wants 8 ES, Topstep cap 5 → capped to 5."""
        from datetime import datetime, timedelta
        from src.engine.indicators.core import compute_atr

        # Create data that would produce ~8 contracts with dynamic ATR
        n = 30
        dates = [datetime(2023, 1, 1) + timedelta(days=i) for i in range(n)]
        # Low ATR to get high contract count: target_risk / (ATR * tick_value)
        # Want ~8: 500 / (ATR * 12.50) = 8 → ATR ≈ 5.0
        df = pl.DataFrame({
            "ts_event": dates,
            "open":   [4000.0] * n,
            "high":   [4003.0] * n,  # tight range → low ATR
            "low":    [3997.0] * n,
            "close":  [4001.0] * n,
            "volume": [50000] * n,
        })

        atr = compute_atr(df, 14)
        df = df.with_columns(atr.alias("atr_14"))

        config = PositionSizeConfig(type="dynamic_atr", target_risk_dollars=500)
        spec = CONTRACT_SPECS["ES"]

        # Without cap
        sizes_uncapped, _ = compute_position_sizes(df, config, spec, atr_period=14)

        # With Topstep cap of 5
        sizes_capped, _ = compute_position_sizes(
            df, config, spec, atr_period=14, max_contracts=5,
        )

        # Find bars where uncapped > 5
        for i in range(n):
            if not math.isnan(sizes_uncapped[i]) and sizes_uncapped[i] > 5:
                assert sizes_capped[i] == 5

    def test_atr_below_cap_unchanged(self):
        """ATR wants 3 ES, Topstep cap 5 → stays at 3."""
        from datetime import datetime, timedelta
        from src.engine.indicators.core import compute_atr

        n = 30
        dates = [datetime(2023, 1, 1) + timedelta(days=i) for i in range(n)]
        # Higher ATR to get fewer contracts: 500 / (ATR * 12.50) ≈ 3 → ATR ≈ 13.3
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
        spec = CONTRACT_SPECS["ES"]

        sizes, _ = compute_position_sizes(
            df, config, spec, atr_period=14, max_contracts=5,
        )

        # All sizes should be <= 5 and unchanged from uncapped
        sizes_uncapped, _ = compute_position_sizes(df, config, spec, atr_period=14)
        for i in range(n):
            if not math.isnan(sizes[i]) and sizes_uncapped[i] <= 5:
                assert sizes[i] == sizes_uncapped[i]

    def test_unknown_firm_cap_raises(self):
        """Firm not in cap table raises ValueError."""
        with pytest.raises(ValueError, match="No contract cap"):
            get_contract_cap("alpha_50k", "ES")

    def test_cl_higher_cap_than_es(self):
        """CL generally has higher caps than ES (10 vs 5)."""
        for firm_key in FIRM_CONTRACT_CAPS:
            es_cap = get_contract_cap(firm_key, "ES")
            cl_cap = get_contract_cap(firm_key, "CL")
            assert cl_cap >= es_cap
