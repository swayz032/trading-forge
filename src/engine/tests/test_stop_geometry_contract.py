"""Wave 2 (2026-07-16) — unified stop-geometry contract (Python side).

RED→GREEN pins for:
  - src/engine/stop_geometry.py managed_stop_pts / sizing_stop_pts + the invariant
  - sizing.py compute_risk_derived_contracts symbol-aware sizing stop (surface 6)
  - sizing.py compute_position_sizes stop_multiplier + symbol threading (surface 7)

The two compute_* assertions are RED against unmodified sizing.py: neither
function accepted `symbol` / `stop_multiplier` before Wave 2 (TypeError), and the
scalar risk cap was computed off a floor-free / ceiling-free bare `mult × atr`.
"""

import pytest

from src.engine.stop_geometry import (
    managed_stop_pts,
    sizing_stop_pts,
    get_stop_ceiling_for_symbol,
    get_stop_floor_for_symbol,
)
from src.engine.sizing import compute_risk_derived_contracts, compute_position_sizes


# ─── Helper contract ──────────────────────────────────────────────────────────

class TestStopGeometryHelpers:
    def test_managed_no_floor_mes_low_atr(self):
        # min(ceiling 14, 1.5*4=6) = 6 — NO floor (managed stop is floor-free)
        assert managed_stop_pts("MES", 4.0, 1.5) == pytest.approx(6.0)

    def test_managed_ceiling_binds_mnq(self):
        # min(ceiling 62, 1.5*50=75) = 62
        assert managed_stop_pts("MNQ", 50.0, 1.5) == pytest.approx(62.0)

    def test_sizing_floor_widens_mes(self):
        # min(max(1.5*3=4.5, floor 6), 14) = 6 — floor WIDENS
        assert sizing_stop_pts("MES", 3.0, 1.5) == pytest.approx(6.0)

    def test_sizing_ceiling_binds_mnq(self):
        # min(max(1.5*50=75, 0), 62) = 62
        assert sizing_stop_pts("MNQ", 50.0, 1.5) == pytest.approx(62.0)

    def test_invariant_sizing_ge_managed(self):
        for sym in ("MES", "MNQ", "MCL", "ZZZ"):
            for atr in (0.5, 3, 4, 8, 9.34, 50):
                for mult in (1.5, 2.0, 5.0):
                    assert sizing_stop_pts(sym, atr, mult) >= managed_stop_pts(sym, atr, mult) - 1e-9

    def test_mes_floor_default_and_mnq_none(self):
        assert get_stop_floor_for_symbol("MES") == pytest.approx(6.0)
        assert get_stop_floor_for_symbol("MNQ") is None
        assert get_stop_ceiling_for_symbol("MNQ") == pytest.approx(62.0)


# ─── Surface 6: compute_risk_derived_contracts symbol-aware sizing stop ────────

class TestScalarSizingStop:
    """MFFU $50K → risk budget = 50000 * 0.02 = $1000."""

    def _call(self, atr, mult, symbol=None):
        return compute_risk_derived_contracts(
            base_contracts=6,
            tier_increment=3,
            tier_threshold_dollars=3000.0,
            max_risk_pct_per_trade=0.02,
            liquidity_comfort_cap=100,
            account_balance=50_000.0,
            cumulative_profit=0.0,
            atr_points=atr,
            stop_multiplier=mult,
            point_dollar_value=5.0,   # MES
            firm="mffu",
            symbol=symbol,
        )

    def test_mes_atr3_mult15_floored_to_30_dollars(self):
        # symbol=MES: sizing_stop = min(max(1.5*3=4.5, floor 6), 14) = 6 → $30/contract
        r = self._call(3.0, 1.5, symbol="MES")
        assert r.evidence["stop_dollars_per_contract"] == pytest.approx(30.0)
        assert r.risk_derived_cap == 33          # floor(1000/30)

    def test_mes_atr3_no_symbol_is_legacy_unfloored(self):
        # symbol=None: byte-identical legacy bare 1.5*3=4.5 → $22.5/contract
        r = self._call(3.0, 1.5, symbol=None)
        assert r.evidence["stop_dollars_per_contract"] == pytest.approx(22.5)
        assert r.risk_derived_cap == 44          # floor(1000/22.5)

    def test_mes_atr4_mult20_gives_25_not_33(self):
        r20 = self._call(4.0, 2.0, symbol="MES")   # stop = 8 → $40 → floor(1000/40)=25
        r15 = self._call(4.0, 1.5, symbol="MES")   # stop = 6 → $30 → floor(1000/30)=33
        assert r20.risk_derived_cap == 25
        assert r15.risk_derived_cap == 33

    def test_mnq_atr50_ceiling_binds_at_62(self):
        r = compute_risk_derived_contracts(
            base_contracts=6, tier_increment=3, tier_threshold_dollars=3000.0,
            max_risk_pct_per_trade=0.02, liquidity_comfort_cap=100,
            account_balance=50_000.0, cumulative_profit=0.0,
            atr_points=50.0, stop_multiplier=1.5, point_dollar_value=2.0,  # MNQ
            firm="mffu", symbol="MNQ",
        )
        # sizing_stop = min(max(75, 0), 62) = 62 → $124/contract
        assert r.evidence["stop_dollars_per_contract"] == pytest.approx(124.0)


# ─── Surface 7: compute_position_sizes threads stop_multiplier + symbol ────────

class TestVectorizedSizing:
    def _sizes(self, mult):
        import polars as pl
        from src.engine.config import PositionSizeConfig, CONTRACT_SPECS

        df = pl.DataFrame({"atr_14": [4.0] * 30})
        cfg = PositionSizeConfig(
            type="risk_derived_pyramid",
            base_contracts=30,       # high so the risk cap binds (not the pyramid tier)
            tier_increment=3,
            tier_threshold_dollars=3000.0,
            max_risk_pct_per_trade=0.02,
            liquidity_comfort_cap=100,
        )
        spec = CONTRACT_SPECS["MES"]
        sizes, _ = compute_position_sizes(
            df, cfg, spec, 14,
            # unhealthy MFFU account (40k < 85% of 50k) so the pyramid FLOOR never
            # re-inflates the risk-capped size — isolates the mult effect.
            profit_scaling_tier={"account_balance": 40_000.0, "firm": "mffu"},
            stop_multiplier=mult,
            symbol="MES",
        )
        return sizes

    def test_mult_threaded_into_per_bar_cap(self):
        # riskDollars = 40000 * 0.02 = $800
        # mult 2.0 → sizing_stop 8 → $40 → floor(800/40)=20
        # mult 1.5 → sizing_stop 6 → $30 → floor(800/30)=26
        s20 = self._sizes(2.0)
        s15 = self._sizes(1.5)
        assert int(s20[0]) == 20
        assert int(s15[0]) == 26


# ─── F-1: gate_block_analyzer rerouted to the canonical managed_stop_pts ───────
# (the THIRD un-rerouted copy of `min(ceiling, atr×1.5)` — closed in-wave under
# zero-carry-forward). Byte-identical for the production micro set {MES,MNQ,MCL}.

class TestGateBlockAnalyzerReroute:
    def test_counterfactual_stop_matches_managed_stop_pts_mes_atr10(self):
        # The counterfactual stop is managed_stop_pts(symbol, atr, 1.5). MES ATR=10 is
        # ceiling-bound: min(14, 1.5*10=15) = 14.
        from src.engine import gate_block_analyzer as gba
        assert managed_stop_pts("MES", 10.0, gba.STATIC_STYLE_C_ATR_STOP_MULTIPLIER) == pytest.approx(14.0)
        assert gba.STATIC_STYLE_C_ATR_STOP_MULTIPLIER == pytest.approx(1.5)

    def test_ceiling_table_is_a_derived_view_no_independent_literals(self):
        # STRUCTURAL_STOP_CEILING_PTS must equal the canonical source by construction
        # (no hand-maintained literals left to drift).
        from src.engine import gate_block_analyzer as gba
        assert gba.STRUCTURAL_STOP_CEILING_PTS == {
            sym: get_stop_ceiling_for_symbol(sym) for sym in ("MES", "MNQ", "MCL")
        }

    def test_source_is_rerouted_to_helper_not_inline_formula(self):
        # RED-proof against a reverted local-dict version: the risk_points computation must call
        # the canonical helper and the old inline `min(stop_ceiling, atr_at_entry * MULT)` must be GONE.
        import inspect
        from src.engine import gate_block_analyzer as gba
        src = inspect.getsource(gba)
        assert "managed_stop_pts(symbol, atr_at_entry, STATIC_STYLE_C_ATR_STOP_MULTIPLIER)" in src
        assert "min(stop_ceiling, atr_at_entry * STATIC_STYLE_C_ATR_STOP_MULTIPLIER)" not in src
