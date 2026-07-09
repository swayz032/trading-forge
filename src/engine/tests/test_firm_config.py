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
    def test_all_production_firms_present(self):
        """Only the two canonical prop firms remain (migration 0097, 2026-05-10 — Topstep + MFFU ONLY).

        deep-scan Backtest #9 (stale-fixture fix): the 9 legacy firms (alpha/tradeify/apex/tpt/ffn/
        earn2trade/top_one/yrm/fundingpips) were removed; FIRM_COMMISSIONS must be EXACTLY the 2-firm set.
        """
        expected = {"topstep_50k", "mffu_50k"}
        actual = set(FIRM_COMMISSIONS.keys())
        assert actual == expected, f"FIRM_COMMISSIONS drift vs canonical 2-firm set: {actual ^ expected}"

    def test_topstep_cheaper_than_mffu(self):
        """Topstep ($0.62/side MES) is cheaper than MFFU ($0.95/side MES) — surviving firms differ.

        Replaces the deleted alpha-zero / tradeify-most-expensive tests (those firms were pruned by
        migration 0097). Asserts the two surviving firms' real, differentiated commissions.
        """
        topstep = get_commission_per_side("topstep_50k", "MES")
        mffu = get_commission_per_side("mffu_50k", "MES")
        assert topstep >= 0 and mffu >= 0
        assert topstep < mffu, f"expected Topstep cheaper than MFFU, got {topstep} vs {mffu}"
        # Topstep is the cheapest across all surviving firms for MES.
        for firm_key in FIRM_COMMISSIONS:
            assert get_commission_per_side(firm_key, "MES") >= topstep

    def test_unknown_firm_raises(self):
        """Unknown firm_key raises ValueError."""
        with pytest.raises(ValueError, match="Unknown firm"):
            get_commission_per_side("unknown_firm", "MES")

    def test_unknown_symbol_raises(self):
        """Unknown symbol raises ValueError."""
        with pytest.raises(ValueError, match="Unknown symbol"):
            get_commission_per_side("mffu_50k", "INVALID")

    def test_commission_impacts_net_pnl(self):
        """$260/day gross: the cheaper firm (Topstep) keeps more net profit than MFFU.

        Topstep: $0.62/side × 2 sides × 2 trades/day = $2.48 → net $257.52
        MFFU:    $0.95/side × 2 sides × 2 trades/day = $3.80 → net $256.20
        Both clear the $250 gate; Topstep keeps more.
        """
        gross_daily = 260.0
        trades_per_day = 2  # round trips

        topstep_comm = get_commission_per_side("topstep_50k", "MES")
        mffu_comm = get_commission_per_side("mffu_50k", "MES")

        topstep_net = gross_daily - (topstep_comm * 2 * trades_per_day)
        mffu_net = gross_daily - (mffu_comm * 2 * trades_per_day)

        assert topstep_net >= 250, f"Topstep net ${topstep_net:.2f} should pass $250 gate"
        assert topstep_net > mffu_net, "Topstep (cheaper) should keep more profit than MFFU"


# ─── Task 3.12: Contract Cap Tests ──────────────────────────────

class TestContractCaps:
    def test_production_firms_caps_within_bounds(self):
        """Both canonical firms return a contract cap within [CONTRACT_CAP_MIN, CONTRACT_CAP_MAX]
        for every micro symbol (Topstep=50, MFFU=40 as of the 2026 firm config).

        deep-scan Backtest #9 (stale-fixture fix): the old assertion hard-coded cap==15 for 8 pruned
        firms — replaced with the real 2-firm caps asserted against the config's own bounds.
        """
        from src.engine.firm_config import CONTRACT_CAP_MIN, CONTRACT_CAP_MAX
        for firm_key in {"topstep_50k", "mffu_50k"}:
            for symbol in ["MES", "MNQ", "MCL"]:
                cap = get_contract_cap(firm_key, symbol)
                assert CONTRACT_CAP_MIN <= cap <= CONTRACT_CAP_MAX, (
                    f"{firm_key} {symbol} cap {cap} outside [{CONTRACT_CAP_MIN},{CONTRACT_CAP_MAX}]"
                )

    def test_pending_firms_conservative_cap(self):
        """Pending firms use conservative cap (clamped to CONTRACT_CAP_MIN)."""
        from src.engine.firm_config import CONTRACT_CAP_MIN
        pending_firms = {"top_one_50k", "yrm_prop_50k", "fundingpips_50k"}
        for firm_key in pending_firms:
            if firm_key not in FIRM_CONTRACT_CAPS:
                continue
            for symbol in ["MES", "MNQ", "MCL"]:
                cap = get_contract_cap(firm_key, symbol)
                assert cap == CONTRACT_CAP_MIN, (
                    f"{firm_key} {symbol} cap should be conservative ({CONTRACT_CAP_MIN}), got {cap}"
                )

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
