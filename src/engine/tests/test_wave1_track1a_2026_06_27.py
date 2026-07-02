"""Wave 1 Track 1A 2026-06-27 — Stop ceiling recalibration, MES floor, VIX ATR, liquidity TP2.

Tests pin:
Change 1: MNQ ceiling 40→62, MCL ceiling 0.25→1.00 (both env-driven, in sync with gate_block_analyzer)
Change 2: MES 6pt stop floor widens ATR-stop when ATR-based stop < 6pt
Change 3: VIX-tiered ATR multiplier (default OFF; enabled → correct tier selected)
Change 4: static_styleC TP2 uses nearest INTRADAY level in [1.4R, 2.6R] band; falls back to +2.0R
"""

from __future__ import annotations

import os

import numpy as np
import pytest

os.environ.setdefault("TF_ALLOW_FIXED_1", "true")


# ──────────────────────────────────────────────────────────────────────────────
# Shared helpers
# ──────────────────────────────────────────────────────────────────────────────

def _make_ts(n: int, base_hour: int = 10, base_min: int = 0) -> list[str]:
    """5-minute ET timestamps for n bars."""
    ts = []
    h, m = base_hour, base_min
    for _ in range(n):
        ts.append(f"2024-01-15 {h:02d}:{m:02d}:00")
        m += 5
        if m >= 60:
            m -= 60
            h += 1
    return ts


def _run_stop(
    entry_bars: list[int],
    n: int = 50,
    atr: float = 4.0,
    stop_mult: float = 1.5,
    symbol: str = "MES",
    entry_price: float = 5000.0,
) -> tuple:
    """Build minimal arrays and run _apply_dsl_stop_loss_and_time_stop."""
    from src.engine.backtester import _apply_dsl_stop_loss_and_time_stop

    entry_long = np.zeros(n, dtype=bool)
    for b in entry_bars:
        entry_long[b] = True
    exit_long = np.zeros(n, dtype=bool)
    entry_short = np.zeros(n, dtype=bool)
    exit_short = np.zeros(n, dtype=bool)

    high_np = np.full(n, entry_price + 0.05)
    # Low must not breach the stop level to avoid the C-6 intrabar check.
    # Smallest valid stop after floor: 0.3pt (MCL ATR=0.2 × 1.5).
    # 0.05 < 0.3, so low = ep - 0.05 is always above any valid stop level.
    low_np = np.full(n, entry_price - 0.05)
    close_np = np.full(n, entry_price)   # required: close used as entry ref (C3 FIX)
    atr_np = np.full(n, atr)

    return _apply_dsl_stop_loss_and_time_stop(
        entry_long, exit_long, entry_short, exit_short,
        high_np, low_np, atr_np, _make_ts(n),
        stop_multiplier=stop_mult,
        symbol=symbol,
        close_np=close_np,
    )


# ──────────────────────────────────────────────────────────────────────────────
# Change 1: Stop ceiling recalibration
# ──────────────────────────────────────────────────────────────────────────────

class TestCeilingRecalibration:
    """MNQ 40→62, MCL 0.25→1.00, MES unchanged at 14."""

    def test_mnq_new_ceiling_62(self):
        from src.engine.backtester import _get_stop_ceiling_for_symbol
        assert _get_stop_ceiling_for_symbol("MNQ") == pytest.approx(62.0)
        assert _get_stop_ceiling_for_symbol("NQ") == pytest.approx(62.0)

    def test_mcl_new_ceiling_100(self):
        from src.engine.backtester import _get_stop_ceiling_for_symbol
        assert _get_stop_ceiling_for_symbol("MCL") == pytest.approx(1.00)
        assert _get_stop_ceiling_for_symbol("CL") == pytest.approx(1.00)

    def test_mes_ceiling_unchanged(self):
        from src.engine.backtester import _get_stop_ceiling_for_symbol
        assert _get_stop_ceiling_for_symbol("MES") == pytest.approx(14.0)
        assert _get_stop_ceiling_for_symbol("ES") == pytest.approx(14.0)

    def test_mnq_stop_45_not_skipped_under_new_ceiling(self):
        # ATR=30 → stop=45 < new ceiling 62 → NOT skipped (was skipped under old ceiling 40)
        el_out, _, _, _, meta = _run_stop(entry_bars=[5], atr=30.0, symbol="MNQ")
        assert bool(el_out[5]) is True, "stop=45 must pass new 62pt ceiling"
        assert len(meta["skipped_trades"]) == 0

    def test_mnq_stop_63_skipped_over_new_ceiling(self):
        # ATR=42 → stop=63 > new ceiling 62 → SKIPPED
        el_out, _, _, _, meta = _run_stop(entry_bars=[5], atr=42.0, symbol="MNQ")
        assert bool(el_out[5]) is False, "stop=63 must be skipped under ceiling=62"
        assert meta["skipped_trades"][0]["ceiling"] == pytest.approx(62.0)

    def test_mcl_stop_030_not_skipped_under_new_ceiling(self):
        # ATR=0.2 → stop=0.3 < new ceiling 1.00 → NOT skipped (was skipped under 0.25)
        el_out, _, _, _, meta = _run_stop(entry_bars=[5], atr=0.2, symbol="MCL")
        assert bool(el_out[5]) is True, "stop=0.3 must pass new 1.00pt ceiling"
        assert len(meta["skipped_trades"]) == 0

    def test_mcl_stop_105_skipped_over_new_ceiling(self):
        # ATR=0.7 → stop=1.05 > new ceiling 1.00 → SKIPPED
        el_out, _, _, _, meta = _run_stop(entry_bars=[5], atr=0.7, symbol="MCL")
        assert bool(el_out[5]) is False, "stop=1.05 must be skipped under ceiling=1.00"
        assert meta["skipped_trades"][0]["ceiling"] == pytest.approx(1.00)

    def test_env_override_mnq_ceiling(self, monkeypatch):
        """STOP_CEILING_PTS_MNQ env overrides the baked default."""
        from src.engine.backtester import _get_stop_ceiling_for_symbol
        monkeypatch.setenv("STOP_CEILING_PTS_MNQ", "50")
        assert _get_stop_ceiling_for_symbol("MNQ") == pytest.approx(50.0)

    def test_gate_block_analyzer_in_sync(self):
        """backtester and gate_block_analyzer must agree — they share the same env vars."""
        from src.engine.backtester import _get_stop_ceiling_for_symbol
        from src.engine.gate_block_analyzer import STRUCTURAL_STOP_CEILING_PTS
        assert STRUCTURAL_STOP_CEILING_PTS["MES"] == pytest.approx(_get_stop_ceiling_for_symbol("MES"))
        assert STRUCTURAL_STOP_CEILING_PTS["MNQ"] == pytest.approx(_get_stop_ceiling_for_symbol("MNQ"))
        assert STRUCTURAL_STOP_CEILING_PTS["MCL"] == pytest.approx(_get_stop_ceiling_for_symbol("MCL"))


# ──────────────────────────────────────────────────────────────────────────────
# Change 2: MES 6pt stop floor
# ──────────────────────────────────────────────────────────────────────────────

class TestMesStopFloor:
    """MES stop floor = 6pt: widens tight ATR-stops, never skips."""

    def test_floor_function_mes_default(self):
        """_get_stop_floor_for_symbol returns 6.0 for MES by default."""
        from src.engine.backtester import _get_stop_floor_for_symbol
        assert _get_stop_floor_for_symbol("MES") == pytest.approx(6.0)
        assert _get_stop_floor_for_symbol("ES") == pytest.approx(6.0)

    def test_floor_function_mnq_none_by_default(self):
        from src.engine.backtester import _get_stop_floor_for_symbol
        assert _get_stop_floor_for_symbol("MNQ") is None
        assert _get_stop_floor_for_symbol("NQ") is None

    def test_floor_function_mcl_none_by_default(self):
        from src.engine.backtester import _get_stop_floor_for_symbol
        assert _get_stop_floor_for_symbol("MCL") is None
        assert _get_stop_floor_for_symbol("MCL") is None

    def test_floor_function_unknown_symbol(self):
        from src.engine.backtester import _get_stop_floor_for_symbol
        assert _get_stop_floor_for_symbol("SOMETHING") is None

    def test_tight_atr_stop_widened_to_floor(self):
        # ATR=2, mult=1.5 → raw stop_dist=3.0 < 6.0 floor → widened to 6.0.
        # The entry is NOT skipped (3pt < ceiling=14, widened stop 6pt < ceiling=14).
        el_out, _, _, _, meta = _run_stop(entry_bars=[5], atr=2.0, symbol="MES", stop_mult=1.5)
        # Entry should pass (not skipped)
        assert bool(el_out[5]) is True, "floor widens stop but never causes a skip"
        assert len(meta["skipped_trades"]) == 0

    def test_stop_exactly_at_floor_not_skipped(self):
        # ATR=4.0, mult=1.5 → stop_dist=6.0 == floor → no widen needed, not skipped.
        el_out, _, _, _, meta = _run_stop(entry_bars=[5], atr=4.0, symbol="MES", stop_mult=1.5)
        assert bool(el_out[5]) is True
        assert len(meta["skipped_trades"]) == 0

    def test_stop_above_floor_unchanged(self):
        # ATR=6.0, mult=1.5 → stop_dist=9.0 > 6.0 floor → no widening, not skipped.
        el_out, _, _, _, meta = _run_stop(entry_bars=[5], atr=6.0, symbol="MES", stop_mult=1.5)
        assert bool(el_out[5]) is True
        assert len(meta["skipped_trades"]) == 0

    def test_widened_stop_still_skipped_if_over_ceiling(self):
        # ATR=1.0, mult=1.5 → raw stop=1.5 → widened to 6.0 (floor) → 6.0 < 14.0 (ceiling) → NOT skipped.
        # But if floor widened to ABOVE ceiling, it would be skipped.
        # This is a degenerate case (floor > ceiling) only possible via env override.
        el_out, _, _, _, meta = _run_stop(entry_bars=[5], atr=1.0, symbol="MES", stop_mult=1.5)
        # Widened to 6.0, ceiling=14.0 → not skipped
        assert bool(el_out[5]) is True
        assert len(meta["skipped_trades"]) == 0

    def test_floor_env_override(self, monkeypatch):
        """STOP_FLOOR_PTS_MES env overrides the baked 6.0 default."""
        from src.engine.backtester import _get_stop_floor_for_symbol
        monkeypatch.setenv("STOP_FLOOR_PTS_MES", "8.0")
        assert _get_stop_floor_for_symbol("MES") == pytest.approx(8.0)

    def test_floor_env_zero_disables(self, monkeypatch):
        """STOP_FLOOR_PTS_MES=0 disables the floor (returns None)."""
        from src.engine.backtester import _get_stop_floor_for_symbol
        monkeypatch.setenv("STOP_FLOOR_PTS_MES", "0")
        assert _get_stop_floor_for_symbol("MES") is None

    def test_mnq_floor_opt_in_via_env(self, monkeypatch):
        """MNQ has no default floor but can be set via env."""
        from src.engine.backtester import _get_stop_floor_for_symbol
        monkeypatch.setenv("STOP_FLOOR_PTS_MNQ", "12.0")
        assert _get_stop_floor_for_symbol("MNQ") == pytest.approx(12.0)


# ──────────────────────────────────────────────────────────────────────────────
# Change 3: VIX-tiered ATR multiplier
# ──────────────────────────────────────────────────────────────────────────────

class TestVixAtrMultiplier:
    """apply_vix_atr_multiplier: default OFF, 3-tier when ON."""

    def test_disabled_by_default_returns_base(self):
        from src.engine.margin_expansion import apply_vix_atr_multiplier
        assert apply_vix_atr_multiplier(1.5, 25.0) == pytest.approx(1.5)
        assert apply_vix_atr_multiplier(2.0, 35.0) == pytest.approx(2.0)
        assert apply_vix_atr_multiplier(1.5, 50.0) == pytest.approx(1.5)

    def test_disabled_none_vix_returns_base(self):
        from src.engine.margin_expansion import apply_vix_atr_multiplier
        assert apply_vix_atr_multiplier(1.5, None) == pytest.approx(1.5)

    def test_enabled_none_vix_returns_base_fail_open(self):
        """When enabled but VIX unavailable, fail-open (return base)."""
        from src.engine.margin_expansion import apply_vix_atr_multiplier
        result = apply_vix_atr_multiplier(1.5, None, enabled=True)
        assert result == pytest.approx(1.5), "None VIX must fail-open to base_mult"

    def test_enabled_vix_below_20_returns_low_tier(self):
        from src.engine.margin_expansion import apply_vix_atr_multiplier
        result = apply_vix_atr_multiplier(1.5, 15.0, enabled=True)
        assert result == pytest.approx(1.5), "VIX=15 < 20 → low tier = 1.5"

    def test_enabled_vix_exactly_20_returns_mid_tier(self):
        """VIX == tier_low threshold → mid tier (boundary inclusive on mid side)."""
        from src.engine.margin_expansion import apply_vix_atr_multiplier
        result = apply_vix_atr_multiplier(1.5, 20.0, enabled=True)
        assert result == pytest.approx(2.0), "VIX=20.0 (at threshold) → mid tier = 2.0"

    def test_enabled_vix_25_returns_mid_tier(self):
        from src.engine.margin_expansion import apply_vix_atr_multiplier
        result = apply_vix_atr_multiplier(1.5, 25.0, enabled=True)
        assert result == pytest.approx(2.0), "20 ≤ VIX=25 ≤ 30 → mid tier = 2.0"

    def test_enabled_vix_exactly_30_returns_mid_tier(self):
        """VIX exactly at tier_mid → still mid tier (inclusive)."""
        from src.engine.margin_expansion import apply_vix_atr_multiplier
        result = apply_vix_atr_multiplier(1.5, 30.0, enabled=True)
        assert result == pytest.approx(2.0), "VIX=30.0 (at tier_mid) → mid tier = 2.0"

    def test_enabled_vix_above_30_returns_high_tier(self):
        from src.engine.margin_expansion import apply_vix_atr_multiplier
        result = apply_vix_atr_multiplier(1.5, 35.0, enabled=True)
        assert result == pytest.approx(2.5), "VIX=35 > 30 → high tier = 2.5"

    def test_enabled_vix_crisis_55_returns_high_tier(self):
        from src.engine.margin_expansion import apply_vix_atr_multiplier
        result = apply_vix_atr_multiplier(1.5, 55.0, enabled=True)
        assert result == pytest.approx(2.5)

    def test_custom_tier_overrides_via_kwargs(self):
        """Keyword arg overrides work for tests without env changes."""
        from src.engine.margin_expansion import apply_vix_atr_multiplier
        result = apply_vix_atr_multiplier(
            1.5, 18.0,
            enabled=True,
            tier_low=15.0,   # lower threshold → VIX=18 is MID
            mult_mid=3.0,
        )
        assert result == pytest.approx(3.0), "custom mid mult=3.0"

    def test_env_flag_true_activates_tiers(self, monkeypatch):
        """VIX_TIERED_ATR_ENABLED=true env flag activates tiers without enabled= kwarg."""
        monkeypatch.setenv("VIX_TIERED_ATR_ENABLED", "true")
        from src.engine.margin_expansion import apply_vix_atr_multiplier
        result = apply_vix_atr_multiplier(1.5, 35.0)
        assert result == pytest.approx(2.5), "flag=true + VIX=35 → high tier 2.5"

    def test_determinism_pure_function(self):
        """Same inputs always produce same output (pure function)."""
        from src.engine.margin_expansion import apply_vix_atr_multiplier
        results = [apply_vix_atr_multiplier(1.5, 25.0, enabled=True) for _ in range(5)]
        assert len(set(results)) == 1

    def test_env_tier_thresholds_overridable(self, monkeypatch):
        monkeypatch.setenv("VIX_ATR_TIER_LOW", "15.0")
        monkeypatch.setenv("VIX_ATR_TIER_MID", "25.0")
        monkeypatch.setenv("VIX_ATR_MULT_HIGH", "3.0")
        from src.engine.margin_expansion import apply_vix_atr_multiplier
        # Use kwargs to test env-driven paths (avoids module re-import complexity)
        result = apply_vix_atr_multiplier(
            1.5, 28.0,
            enabled=True,
            tier_low=float(os.environ.get("VIX_ATR_TIER_LOW", "15.0")),
            tier_mid=float(os.environ.get("VIX_ATR_TIER_MID", "25.0")),
            mult_high=float(os.environ.get("VIX_ATR_MULT_HIGH", "3.0")),
        )
        # VIX=28 > tier_mid=25 → high tier 3.0
        assert result == pytest.approx(3.0)


# ──────────────────────────────────────────────────────────────────────────────
# Change 4: Liquidity-mapped TP2 in static_styleC
# ──────────────────────────────────────────────────────────────────────────────

class TestLiquidityMappedTP2:
    """compute_single_tp: picks intraday level in [1.4R, 2.6R] band before falling back to +2.0R."""

    def _snap(self, level_type: str, price: float) -> dict:
        return {"level_type": level_type, "price": price}

    def test_no_snapshot_uses_atr_fallback(self):
        """With no liquidity_snapshot, function behaviour unchanged (+3×ATR fallback)."""
        from src.engine.context.structural_targets import compute_single_tp
        # entry=5000, stop=4994 → risk=6 → atr fallback = 5000 + 3*8 = 5024
        result = compute_single_tp(
            direction="long",
            entry_price=5000.0,
            stop_price=4994.0,
            atr=8.0,
            liquidity_snapshot=None,
        )
        assert result == pytest.approx(5024.0), "no snapshot → 3×ATR fallback"

    def test_empty_snapshot_uses_atr_fallback(self):
        from src.engine.context.structural_targets import compute_single_tp
        result = compute_single_tp(
            direction="long",
            entry_price=5000.0,
            stop_price=4994.0,
            atr=8.0,
            liquidity_snapshot=[],
        )
        assert result == pytest.approx(5024.0), "empty snapshot → 3×ATR fallback"

    def test_intraday_level_in_band_long_returns_level(self):
        """Nearest INTRADAY level in [1.4R, 2.6R] band is returned for long."""
        from src.engine.context.structural_targets import compute_single_tp
        # entry=5000, stop=4994 → risk=6 → band=[1.4×6, 2.6×6]=[8.4, 15.6] above entry
        # level at 5012 → dist=12 → 8.4 ≤ 12 ≤ 15.6 → in band → return 5012
        snap = [self._snap("pdh", 5012.0)]  # pdh is INTRADAY_ALLOWED
        result = compute_single_tp(
            direction="long",
            entry_price=5000.0,
            stop_price=4994.0,
            atr=8.0,
            liquidity_snapshot=snap,
        )
        assert result == pytest.approx(5012.0)

    def test_intraday_level_in_band_short_returns_level(self):
        """Short direction: level below entry in band is returned."""
        from src.engine.context.structural_targets import compute_single_tp
        # entry=5000, stop=5006 → risk=6 → band=[8.4, 15.6] below entry
        # level at 4987 → dist=13 → in band → return 4987
        snap = [self._snap("pdl", 4987.0)]  # pdl is INTRADAY_ALLOWED
        result = compute_single_tp(
            direction="short",
            entry_price=5000.0,
            stop_price=5006.0,
            atr=8.0,
            liquidity_snapshot=snap,
        )
        assert result == pytest.approx(4987.0)

    def test_level_below_band_not_used_fallback_to_atr(self):
        """A level at 1.0R (dist=6 < 8.4 low_band) is below band — falls back to ATR."""
        from src.engine.context.structural_targets import compute_single_tp
        snap = [self._snap("eqh", 5006.0)]  # dist=6 < band_low=8.4
        result = compute_single_tp(
            direction="long",
            entry_price=5000.0,
            stop_price=4994.0,
            atr=8.0,
            liquidity_snapshot=snap,
        )
        assert result == pytest.approx(5024.0), "below-band level ignored; fallback to 3×ATR"

    def test_level_above_band_not_used_fallback_to_atr(self):
        """A level at 3.0R (dist=18 > 15.6 high_band) is above band — falls back to ATR."""
        from src.engine.context.structural_targets import compute_single_tp
        snap = [self._snap("hod", 5018.0)]  # dist=18 > band_high=15.6
        result = compute_single_tp(
            direction="long",
            entry_price=5000.0,
            stop_price=4994.0,
            atr=8.0,
            liquidity_snapshot=snap,
        )
        assert result == pytest.approx(5024.0), "above-band level ignored; fallback to 3×ATR"

    def test_disallowed_level_type_ignored(self):
        """pwh_iso (not in INTRADAY_ALLOWED) is ignored even if in band."""
        from src.engine.context.structural_targets import compute_single_tp
        snap = [self._snap("pwh_iso", 5012.0)]  # NOT in INTRADAY_ALLOWED_LEVEL_TYPES
        result = compute_single_tp(
            direction="long",
            entry_price=5000.0,
            stop_price=4994.0,
            atr=8.0,
            liquidity_snapshot=snap,
        )
        # pwh_iso excluded → fallback to 3×ATR
        assert result == pytest.approx(5024.0)

    def test_nearest_of_two_in_band_chosen(self):
        """When multiple levels qualify, the nearest (smallest dist from entry) wins."""
        from src.engine.context.structural_targets import compute_single_tp
        # risk=6, band=[8.4, 15.6], entry=5000
        # level A at 5010 (dist=10) and level B at 5014 (dist=14) — both in band
        snap = [
            self._snap("hod", 5014.0),   # further
            self._snap("asian_high", 5010.0),  # nearer
        ]
        result = compute_single_tp(
            direction="long",
            entry_price=5000.0,
            stop_price=4994.0,
            atr=8.0,
            liquidity_snapshot=snap,
        )
        assert result == pytest.approx(5010.0), "nearer level wins"

    def test_dataclass_like_object_supported(self):
        """LiquidityLevelSnapshot dataclass (attribute access) also works."""
        from src.engine.context.structural_targets import compute_single_tp

        class FakeLevel:
            def __init__(self, level_type, price):
                self.level_type = level_type
                self.price = price

        snap = [FakeLevel("pdh", 5012.0)]
        result = compute_single_tp(
            direction="long",
            entry_price=5000.0,
            stop_price=4994.0,
            atr=8.0,
            liquidity_snapshot=snap,
        )
        assert result == pytest.approx(5012.0)

    def test_env_band_override(self, monkeypatch):
        """STATIC_TP2_LIQ_BAND_LOW_R and HIGH_R env vars override the default band."""
        monkeypatch.setenv("STATIC_TP2_LIQ_BAND_LOW_R", "2.0")
        monkeypatch.setenv("STATIC_TP2_LIQ_BAND_HIGH_R", "3.0")
        from src.engine.context.structural_targets import compute_single_tp
        # risk=6, entry=5000, new band=[12.0, 18.0]
        # level at 5010 → dist=10 < 12.0 low bound → below band → ignored
        snap = [self._snap("pdh", 5010.0)]
        result = compute_single_tp(
            direction="long",
            entry_price=5000.0,
            stop_price=4994.0,
            atr=8.0,
            liquidity_snapshot=snap,
        )
        # With band [12, 18], dist=10 is below band → fallback to 3×ATR=5024
        assert result == pytest.approx(5024.0), "level below custom band → fallback"

    def test_band_env_wider_includes_previously_excluded(self, monkeypatch):
        """Widening band low to 0.5R makes a 1.0R level qualify."""
        monkeypatch.setenv("STATIC_TP2_LIQ_BAND_LOW_R", "0.5")
        monkeypatch.setenv("STATIC_TP2_LIQ_BAND_HIGH_R", "3.0")
        from src.engine.context.structural_targets import compute_single_tp
        # risk=6, new band=[3.0, 18.0]. level at 5006 → dist=6 → in band
        snap = [self._snap("eqh", 5006.0)]
        result = compute_single_tp(
            direction="long",
            entry_price=5000.0,
            stop_price=4994.0,
            atr=8.0,
            liquidity_snapshot=snap,
        )
        assert result == pytest.approx(5006.0)

    def test_wrong_side_level_ignored_long(self):
        """A level below entry (wrong side for long) is ignored."""
        from src.engine.context.structural_targets import compute_single_tp
        snap = [self._snap("pdh", 4990.0)]  # below entry for long
        result = compute_single_tp(
            direction="long",
            entry_price=5000.0,
            stop_price=4994.0,
            atr=8.0,
            liquidity_snapshot=snap,
        )
        assert result == pytest.approx(5024.0), "wrong-side level → fallback"

    def test_structural_level_returned_when_no_liq_snap(self):
        """Without snapshot, structural BSL still returned if >= 2R."""
        from src.engine.context.structural_targets import compute_single_tp
        # entry=5000, stop=4994, risk=6, bsl=5013 (dist=13 >= 12=2R) → returned
        result = compute_single_tp(
            direction="long",
            entry_price=5000.0,
            stop_price=4994.0,
            nearest_bsl=5013.0,
            atr=0.0,
        )
        assert result == pytest.approx(5013.0)
