"""C-05 / D9 (2026-07-16) — vectorized backtest-path lowest-wins honesty.

Grader HIGH #1 + HIGH #2 (must close same wave as the scalar D9 fix):

  HIGH #1 — the per-bar `min-1` "minimum tradeable" fallback in the risk_derived_pyramid
    branch of `compute_position_sizes` fabricated a 1-contract trade on exactly the bars where
    lowest-wins collapsed to 0 — the identical scenario D9 fixes for the scalar/live path, just
    floored to 1 instead of base. It is REMOVED: a lowest-wins-0 bar STAYS 0 (skip).

  HIGH #2 — the wholesale `sizes = np.full(n, 1.0)` fallback fired whenever the PRELIM scalar call
    (using SESSION-MEAN ATR) returned a rejection_reason. After D9 a healthy narrow-buffer account
    whose MEAN ATR collapses the risk cap now rejects unconditionally (negative_cap), so this branch
    silently degraded the whole run to flat-1/bar. It is SPLIT:
      - structural reject (zero_balance / zero_atr / zero_buffer) → np.zeros (honest whole-run skip)
      - mean-ATR negative_cap → PROCEED to the per-bar computation (per-bar ATR still varies), which
        honestly skips-to-0 the collapsed bars and sizes the rest at the risk cap.

Each test is a RED-proof: reverting the src fix re-introduces the fabricated 1-contract size and
fails the assertion. Reachability of HIGH #2's branch is asserted directly (the prelim scalar returns
negative_cap on D9's own motivating scenario: healthy account, narrow $2K Topstep buffer, wide mean ATR).
"""

import numpy as np
import polars as pl
import pytest

from src.engine.sizing import compute_position_sizes, compute_risk_derived_contracts
from src.engine.config import CONTRACT_SPECS, PositionSizeConfig

MES = CONTRACT_SPECS["MES"]  # tick_size=0.25, point_value=5.0

# Fresh Topstep 50K combine: buffer $2K → risk_dollars = 2000 * 0.02 = $40.
TOPSTEP_HEALTHY = {
    "account_pnl_total": 0.0,
    "account_balance": 52_000.0,
    "firm": "topstep",
    "trailing_dd": 2_000.0,
    "high_water_balance": 52_000.0,
    "account_starting_floor": 50_000.0,
}


def _cfg(base=9, firm_cap=50):
    return PositionSizeConfig(
        type="risk_derived_pyramid",
        base_contracts=base,
        tier_increment=3,
        tier_threshold_dollars=3000,
        max_risk_pct_per_trade=0.02,
        liquidity_comfort_cap=100,
        firm_contract_cap=firm_cap,
        topstep_account_cap_override=None,
    )


def _sizes(atr_list, profit_tier=None):
    df = pl.DataFrame({"atr_14": [float(a) for a in atr_list]})
    sizes, over_risk = compute_position_sizes(
        df,
        _cfg(),
        MES,
        atr_period=14,
        profit_scaling_tier=profit_tier if profit_tier is not None else TOPSTEP_HEALTHY,
        stop_multiplier=1.5,
        symbol=None,  # legacy bare mult×atr → predictable per-bar math
    )
    return sizes, over_risk


class TestHigh2Reachability:
    """The mean-ATR negative_cap branch IS reachable on D9's motivating scenario."""

    def test_prelim_scalar_returns_negative_cap_on_healthy_wide_mean_atr(self):
        # Mean ATR = 6.0 → scalar stop = 1.5*6*5 = $45 > risk_dollars $40 → cap 0 → negative_cap.
        # Account is HEALTHY (52000/50000 = 1.04 ≥ 0.85) and buffer is a normal fresh-combine $2K.
        r = compute_risk_derived_contracts(
            base_contracts=9, tier_increment=3, tier_threshold_dollars=3000,
            max_risk_pct_per_trade=0.02, liquidity_comfort_cap=100,
            account_balance=52_000.0, cumulative_profit=0.0,
            atr_points=6.0, stop_multiplier=1.5, point_dollar_value=5.0,
            firm_contract_cap=50, firm="topstep", trailing_dd=2_000.0,
            high_water_balance=52_000.0, account_starting_floor=50_000.0,
        )
        assert r.rejection_reason == "negative_cap"
        assert r.account_health_ratio >= 0.85  # HEALTHY — pre-D9 this FLOORED, not rejected


class TestHigh2NegativeCapProceedsPerBar:
    """HIGH #2: mean-ATR negative_cap → per-bar computation, NOT wholesale flat-1/bar."""

    def test_mean_atr_reject_still_sizes_per_bar_lowest_wins(self):
        # alternating narrow(2)/wide(10) ATR → mean 6.0 → prelim scalar negative_cap (see above).
        # per-bar: ATR2 → cap floor(40/(1.5*2*5))=2 ; ATR10 → cap floor(40/(1.5*10*5))=0 (skip).
        sizes, _ = _sizes([2, 10, 2, 10, 2, 10, 2, 10, 2, 10])
        # NOT the pre-fix wholesale fabrication of 1 contract every bar:
        assert not np.all(sizes == 1.0), "HIGH#2 regression: wholesale flat-1/bar fabrication"
        # narrow-ATR bars size at the risk cap; wide-ATR bars honestly skip to 0:
        assert sizes[0] == 2.0
        assert sizes[1] == 0.0
        assert set(np.unique(sizes)) == {0.0, 2.0}


class TestHigh1NoMinOneFabrication:
    """HIGH #1: a lowest-wins-0 bar STAYS 0 even when the run itself is sizable."""

    def test_collapsed_bar_stays_zero_not_one(self):
        # 9 narrow(2) + 1 wide(10) → mean 2.8 → scalar cap floor(40/(1.5*2.8*5))=1 (rejection None).
        # The single wide-ATR bar collapses to per-bar cap 0 → must STAY 0 (was fabricated to 1).
        sizes, over_risk = _sizes([2, 2, 2, 2, 2, 2, 2, 2, 2, 10])
        assert sizes[9] == 0.0, "HIGH#1 regression: min-1 fabricated a phantom 1-contract trade"
        assert np.all(sizes[:9] == 2.0)  # sizable bars unaffected
        # the fabrication was SILENT — over_risk stays all-False on this path (documents the bug)
        assert not over_risk.any()


class TestHigh2StructuralRejectSkipsWholeRun:
    """HIGH #2: a structural reject (un-sizable account) skips the whole run to 0, not flat-1/bar."""

    def test_zero_balance_skips_all_bars_to_zero(self):
        tier = {**TOPSTEP_HEALTHY, "account_balance": 0.0}
        sizes, _ = _sizes([4, 4, 4, 4, 4], profit_tier=tier)
        assert np.all(sizes == 0.0), "structural reject must honestly skip, not fabricate 1/bar"

    def test_zero_buffer_skips_all_bars_to_zero(self):
        # Topstep below trailing floor: balance 47000, HWM 50000, DD 2000 → floor 48000,
        # buffer -1000 → zero_buffer structural reject (account healthy 0.94 but un-sizable).
        tier = {**TOPSTEP_HEALTHY, "account_balance": 47_000.0, "high_water_balance": 50_000.0}
        sizes, _ = _sizes([4, 4, 4, 4, 4], profit_tier=tier)
        assert np.all(sizes == 0.0), "zero_buffer must honestly skip, not fabricate 1/bar"


class TestNewHighFirmCapOverrideOnNegativeCapPath:
    """C-05/D9 NEW-HIGH: topstep_account_cap_override must still bind on the per-bar path that the
    HIGH#2 fix activated for negative_cap. Regression the HIGH#2 fix introduced: the scalar
    negative_cap return hardcoded firm_cap=None, so the per-bar consumer fell back to max_contracts
    (or 1e9), dropping the per-account cap."""

    def test_topstep_account_cap_override_binds_per_bar_on_negative_cap(self):
        # override=1 is TIGHTER than both firm_contract_cap=50 and max_contracts=50.
        cfg = PositionSizeConfig(
            type="risk_derived_pyramid",
            base_contracts=9,
            tier_increment=3,
            tier_threshold_dollars=3000,
            max_risk_pct_per_trade=0.02,
            liquidity_comfort_cap=100,
            firm_contract_cap=50,
            topstep_account_cap_override=1,
        )
        # alternating narrow/wide ATR → mean 6 → prelim scalar negative_cap → per-bar path.
        df = pl.DataFrame({"atr_14": [2.0, 10.0, 2.0, 10.0, 2.0, 10.0, 2.0, 10.0, 2.0, 10.0]})
        sizes, _ = compute_position_sizes(
            df, cfg, MES, atr_period=14, profit_scaling_tier=TOPSTEP_HEALTHY,
            max_contracts=50, stop_multiplier=1.5, symbol=None,
        )
        # narrow-ATR bars would size to riskCap=2, but the per-account override caps them at 1.
        assert sizes.max() <= 1, "topstep_account_cap_override dropped on the negative_cap per-bar path"
        # wide-ATR bars still honestly skip to 0 (lowest wins); narrow bars clamp to the override
        assert set(np.unique(sizes)) == {0.0, 1.0}


class TestPmClosedBarsStillZero:
    """Regression guard: bars the pyramid tier zeroes (PM-closed) were already 0 and stay 0."""

    def test_healthy_narrow_atr_sizes_normally(self):
        # All narrow ATR (2) → mean 2 → scalar cap floor(40/15)=2, rejection None → every bar sizes 2.
        sizes, _ = _sizes([2, 2, 2, 2, 2])
        assert np.all(sizes == 2.0)
