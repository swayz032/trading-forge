"""Tests for per-symbol event product scoping (2026-07-08 scope fix).

The macro-blackout mask must PRODUCT-SCOPE events per the ratified convention, mirroring
the TS reference of truth `src/server/lib/news-policy.ts::eventAffectsSymbol`:
  • FOMC / FOMC_MINUTES → ALL products
  • CPI / NFP           → equity-index products ONLY
  • EIA                 → crude products ONLY

IMPORTANT: this module imports ONLY economic_calendar — NOT backtester (which transitively
pulls the vectorbt JIT engine and HANGS under pytest collection on the tower).

Bar timestamps are built from `_events_for_type` (the SAME resolver generate_event_mask
uses — authoritative JSON snapshot or hardcoded STATIC_EVENTS) and rendered as tz-aware ET
series, so the test lands a bar exactly on a real event regardless of the resolver source
and with zero DST ambiguity.
"""

import polars as pl
import pytest

from src.engine.economic_calendar import (
    generate_event_mask,
    symbol_passes_event_scope,
    _events_for_type,
    _parse_event_datetime,
)


def _et_bar_series(evt_dt) -> pl.Series:
    """One-bar tz-aware ET series positioned exactly at `evt_dt` (naive ET wall-clock).

    Attaching America/New_York directly means generate_event_mask reads the ET wall-clock
    without any UTC-offset math — DST-proof for both EST and EDT event dates.
    """
    return pl.Series("ts_event", [evt_dt]).dt.replace_time_zone("America/New_York")


def _first_event_dt(event_type: str):
    evts = _events_for_type(event_type)
    assert evts, f"expected at least one {event_type} event from the resolver"
    return _parse_event_datetime(evts[0])


# ─── 1a: EIA (crude) does NOT suppress an index symbol ───────────────────────

class TestEiaScope:
    def test_eia_does_not_suppress_index_mes(self):
        """MES is NOT masked inside an EIA-only-policy window (EIA is crude-only)."""
        ts = _et_bar_series(_first_event_dt("EIA"))
        policies = [{"event_type": "EIA", "action": "SIT_OUT", "window_minutes": 30}]
        mask = generate_event_mask(ts, policies, "MES")
        assert mask[0] == False, "EIA must not black out an index symbol (MES)"

    def test_eia_still_suppresses_crude_mcl(self):
        """Sanity: the same EIA bar DOES mask MCL (crude) — scoping isn't just no-op."""
        ts = _et_bar_series(_first_event_dt("EIA"))
        policies = [{"event_type": "EIA", "action": "SIT_OUT", "window_minutes": 30}]
        mask = generate_event_mask(ts, policies, "MCL")
        assert mask[0] == True, "EIA must still mask crude (MCL)"


# ─── 1b: CPI/NFP (index) do NOT suppress a crude symbol ──────────────────────

class TestCpiNfpScope:
    def test_cpi_nfp_do_not_suppress_crude_mcl(self):
        """MCL is NOT masked inside a CPI+NFP-policy window (CPI/NFP are index-only)."""
        ts = _et_bar_series(_first_event_dt("CPI"))
        policies = [
            {"event_type": "CPI", "action": "SIT_OUT", "window_minutes": 30},
            {"event_type": "NFP", "action": "SIT_OUT", "window_minutes": 30},
        ]
        mask = generate_event_mask(ts, policies, "MCL")
        assert mask[0] == False, "CPI/NFP must not black out a crude symbol (MCL)"

    def test_cpi_still_suppresses_index_mes(self):
        """Sanity: the same CPI bar DOES mask MES (index)."""
        ts = _et_bar_series(_first_event_dt("CPI"))
        policies = [
            {"event_type": "CPI", "action": "SIT_OUT", "window_minutes": 30},
            {"event_type": "NFP", "action": "SIT_OUT", "window_minutes": 30},
        ]
        mask = generate_event_mask(ts, policies, "MES")
        assert mask[0] == True, "CPI must still mask an index symbol (MES)"


# ─── 1c: FOMC suppresses ALL products ────────────────────────────────────────

class TestFomcScope:
    def test_fomc_suppresses_all_products(self):
        """FOMC (all-products) masks MES, MNQ, and MCL alike."""
        ts = _et_bar_series(_first_event_dt("FOMC"))
        policies = [{"event_type": "FOMC", "action": "SIT_OUT", "window_minutes": 30}]
        for sym in ("MES", "MNQ", "MCL"):
            mask = generate_event_mask(ts, policies, sym)
            assert mask[0] == True, f"FOMC should mask all products, missed {sym}"

    def test_fomc_only_accepts_unknown_symbol(self):
        """All-products events accept ANY non-None symbol (even unrecognized)."""
        ts = _et_bar_series(_first_event_dt("FOMC"))
        policies = [{"event_type": "FOMC", "action": "SIT_OUT", "window_minutes": 30}]
        # FOMC-only policy set has no product-scoped event → unknown symbol is allowed.
        mask = generate_event_mask(ts, policies, "XYZ")
        assert mask[0] == True


# ─── SYMBOL REQUIRED, NEVER GUESS ────────────────────────────────────────────

class TestSymbolRequired:
    def test_symbol_none_raises(self):
        ts = _et_bar_series(_first_event_dt("FOMC"))
        policies = [{"event_type": "FOMC", "action": "SIT_OUT", "window_minutes": 30}]
        with pytest.raises(ValueError):
            generate_event_mask(ts, policies, None)

    def test_unrecognized_symbol_with_product_scoped_event_raises(self):
        """Unknown symbol + a product-scoped (CPI) policy → ValueError (refuse to guess)."""
        ts = _et_bar_series(_first_event_dt("CPI"))
        policies = [{"event_type": "CPI", "action": "SIT_OUT", "window_minutes": 30}]
        with pytest.raises(ValueError):
            generate_event_mask(ts, policies, "XYZ")


# ─── Pure-function parity with the pin ───────────────────────────────────────

class TestSymbolPassesEventScope:
    def test_fomc_family_all_products(self):
        for sym in ("MES", "MNQ", "MCL", "CL", "QM", "XYZ"):
            assert symbol_passes_event_scope("FOMC", sym) is True
            assert symbol_passes_event_scope("FOMC_MINUTES", sym) is True

    def test_cpi_nfp_index_only(self):
        for t in ("CPI", "NFP"):
            assert symbol_passes_event_scope(t, "MES") is True
            assert symbol_passes_event_scope(t, "NQ") is True
            assert symbol_passes_event_scope(t, "MCL") is False
            assert symbol_passes_event_scope(t, "CL") is False
            assert symbol_passes_event_scope(t, "QM") is False

    def test_eia_crude_only(self):
        assert symbol_passes_event_scope("EIA", "MCL") is True
        assert symbol_passes_event_scope("EIA", "CL") is True
        assert symbol_passes_event_scope("EIA", "QM") is True
        assert symbol_passes_event_scope("EIA", "MES") is False
        assert symbol_passes_event_scope("EIA", "NQ") is False

    def test_unknown_event_type_all_products(self):
        assert symbol_passes_event_scope("SOMETHING_ELSE", "MES") is True

    def test_case_insensitive(self):
        assert symbol_passes_event_scope("cpi", "mes") is True
        assert symbol_passes_event_scope("eia", "mes") is False
