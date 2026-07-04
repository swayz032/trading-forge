"""H5 fix regression tests — admission-stop parity (deep-scan #15, 2026-07-03).

FINDING: apply_eligibility_gate() computes compute_structural_stop() per signal
(sweep_wick > order_block > FVG > swing_point, ceiling-checked) to decide
TAKE/REDUCE/SKIP, but discarded that stop_plan after the decision. The trade-
management loops (naked / stop_only / static Style C / adaptive / R:R
reporting) then independently recomputed
risk_points = min(ceiling, atr_at_entry * atr_stop_multiplier) — a DIFFERENT,
purely ATR-based stop the strategy's own risk model never validated. So the
simulated stop-out fired at a price admission never approved.

FIX: apply_eligibility_gate() now threads its per-bar structural distance
forward via gate_stats["structural_stop_map"]. Callers merge the long/short
maps into {"long": {bar_idx: {...}}, "short": {...}} and pass it to
_apply_trade_management(), which resolves risk_points via
_resolve_stop_risk_points() instead of the raw ATR clamp.

These tests pin:
  1. _resolve_stop_risk_points() unit contract (5 cases).
  2. End-to-end _apply_trade_management() proof: a trade whose structural stop
     is TIGHTER than the legacy ATR-clamped stop exits at the STRUCTURAL price,
     not the wider legacy price.
  3. Byte-identical fallback: BACKTEST_STRUCTURAL_STOP_PARITY_ENABLED=false and
     structural_stop_map=None both reproduce the exact pre-fix output.
  4. apply_eligibility_gate() schema stability: gate_stats["structural_stop_map"]
     is always present (empty dict in passthrough mode) so callers can safely
     .get() it without a KeyError, preserving the passthrough contract.

These tests import backtester.py — vectorbt is lazily imported inside
functions in this module (not at module load time), so the import itself is
fast (~1s observed on the tower, 2026-07-03). See feedback_vectorbt_import_hang
memory for the historical caveat about isolated single-test JIT hangs; that
affected a different, now-superseded import path and does not apply to
_resolve_stop_risk_points / _apply_trade_management, which never touch vectorbt.
"""
from __future__ import annotations

import os

import numpy as np
import pandas as pd
import polars as pl
import pytest

# Allow fixed_contracts=1 in test configs (repo-wide test convention).
os.environ.setdefault("TF_ALLOW_FIXED_1", "true")


def _make_spec():
    from src.engine.config import ContractSpec
    # Not a CONTRACT_SPECS registry object → _symbol_of_spec() falls back to
    # "MES" (ceiling 14.0pt), which matches every hand-computed value below.
    return ContractSpec(tick_size=0.25, tick_value=1.25, point_value=5.0)


def _make_records(entry_idx: int, exit_idx: int, entry_p: float = 4400.0,
                   exit_p: float = 4398.0, direction: str = "Long") -> pd.DataFrame:
    return pd.DataFrame([{
        "Avg Entry Price": entry_p,
        "Avg Exit Price": exit_p,
        "Size": 1.0,
        "Direction": direction,
        "Entry Idx": entry_idx,
        "Exit Idx": exit_idx,
    }])


# ──────────────────────────────────────────────────────────────────────────────
# 1. _resolve_stop_risk_points() unit contract
# ──────────────────────────────────────────────────────────────────────────────

class TestResolveStopRiskPoints:
    def test_prefers_structural_when_tighter_than_atr_fallback(self):
        """Structural distance (5.0) < ATR-clamped fallback (14.0) → use structural."""
        from src.engine.backtester import _resolve_stop_risk_points

        risk_points, stop_basis = _resolve_stop_risk_points(
            entry_idx=1, is_short=False,
            atr_fallback_points=14.0, stop_ceiling=14.0,
            structural_stop_map={"long": {0: {"distance": 5.0, "stop_price": 4395.0,
                                                "stop_reason": "order_block"}},
                                  "short": {}},
        )
        assert stop_basis == "structural"
        assert risk_points == pytest.approx(5.0)

    def test_ceiling_still_caps_structural_distance(self):
        """Belt-and-suspenders: even a structural distance > ceiling gets capped.

        Should never happen for a trade that actually passed apply_eligibility_gate
        (compute_structural_stop sets skip_trade=True and the gate discards the
        signal otherwise) — but the resolver must never trust a second code path
        blindly.
        """
        from src.engine.backtester import _resolve_stop_risk_points

        risk_points, stop_basis = _resolve_stop_risk_points(
            entry_idx=1, is_short=False,
            atr_fallback_points=14.0, stop_ceiling=14.0,
            structural_stop_map={"long": {0: {"distance": 30.0, "stop_price": 4370.0,
                                                "stop_reason": "swing_point"}},
                                  "short": {}},
        )
        assert stop_basis == "structural"
        assert risk_points == pytest.approx(14.0)  # ceiling-capped

    def test_fallback_when_flag_disabled(self, monkeypatch):
        """BACKTEST_STRUCTURAL_STOP_PARITY_ENABLED=false → byte-identical legacy behavior."""
        from src.engine.backtester import _resolve_stop_risk_points

        monkeypatch.setenv("BACKTEST_STRUCTURAL_STOP_PARITY_ENABLED", "false")
        risk_points, stop_basis = _resolve_stop_risk_points(
            entry_idx=1, is_short=False,
            atr_fallback_points=14.0, stop_ceiling=14.0,
            structural_stop_map={"long": {0: {"distance": 5.0, "stop_price": 4395.0,
                                                "stop_reason": "order_block"}},
                                  "short": {}},
        )
        assert stop_basis == "atr_fallback"
        assert risk_points == pytest.approx(14.0)

    def test_fallback_when_map_is_none(self):
        """structural_stop_map=None (caller never threaded a map) → legacy behavior."""
        from src.engine.backtester import _resolve_stop_risk_points

        risk_points, stop_basis = _resolve_stop_risk_points(
            entry_idx=1, is_short=False,
            atr_fallback_points=14.0, stop_ceiling=14.0,
            structural_stop_map=None,
        )
        assert stop_basis == "atr_fallback"
        assert risk_points == pytest.approx(14.0)

    def test_fallback_when_admission_bar_missing_from_map(self):
        """Map exists but has no entry for this trade's admission bar → legacy behavior.

        Defensive: a data-path gap (e.g. htf_cache unavailable for that one bar)
        must degrade gracefully, never raise and never fabricate a distance.
        """
        from src.engine.backtester import _resolve_stop_risk_points

        risk_points, stop_basis = _resolve_stop_risk_points(
            entry_idx=1, is_short=False,
            atr_fallback_points=14.0, stop_ceiling=14.0,
            structural_stop_map={"long": {99: {"distance": 5.0, "stop_price": 4395.0,
                                                 "stop_reason": "order_block"}},
                                  "short": {}},
        )
        assert stop_basis == "atr_fallback"
        assert risk_points == pytest.approx(14.0)

    def test_short_side_reads_short_sub_map(self):
        """is_short=True must read structural_stop_map['short'], not ['long']."""
        from src.engine.backtester import _resolve_stop_risk_points

        risk_points, stop_basis = _resolve_stop_risk_points(
            entry_idx=1, is_short=True,
            atr_fallback_points=14.0, stop_ceiling=14.0,
            structural_stop_map={"long": {0: {"distance": 5.0, "stop_price": 4395.0,
                                                "stop_reason": "order_block"}},
                                  "short": {0: {"distance": 6.0, "stop_price": 4406.0,
                                                  "stop_reason": "sweep_wick"}}},
        )
        assert stop_basis == "structural"
        assert risk_points == pytest.approx(6.0)


# ──────────────────────────────────────────────────────────────────────────────
# 2 + 3. End-to-end _apply_trade_management(): structural wins, fallback is
#         byte-identical when disabled / map absent.
# ──────────────────────────────────────────────────────────────────────────────

def _bar_arrays():
    """Bars engineered so a 5.0pt structural stop fires at bar 2, but the wider
    14.0pt legacy ATR-clamped stop does NOT — the low at bar 2 (4390) sits
    between the two stop prices (structural 4395, legacy 4386)."""
    open_np = np.array([4400.0, 4400.0, 4396.0, 4394.0, 4394.0])
    high_np = np.array([4402.0, 4402.0, 4397.0, 4396.0, 4396.0])
    low_np = np.array([4398.0, 4398.0, 4390.0, 4390.0, 4390.0])
    close_np = np.array([4400.0, 4400.0, 4393.0, 4393.0, 4393.0])
    atr_np = np.array([10.0] * 5)
    df = pl.DataFrame({
        "open": open_np.tolist(), "high": high_np.tolist(),
        "low": low_np.tolist(), "close": close_np.tolist(),
        "atr_14": atr_np.tolist(),
    })
    return open_np, high_np, low_np, close_np, atr_np, df


class TestApplyTradeManagementStructuralStopParity:
    def test_structural_stop_fires_tighter_than_atr_fallback(self):
        """Structural distance (5.0pt) is used → stop fires at bar 2 (4395.0),
        NOT the legacy ATR-clamped 14.0pt stop which would never fire in this
        bar sequence (low never dips to 4386)."""
        from src.engine.backtester import _apply_trade_management

        open_np, high_np, low_np, close_np, atr_np, df = _bar_arrays()
        records = _make_records(entry_idx=1, exit_idx=4)
        spec = _make_spec()
        structural_stop_map = {
            "long": {0: {"distance": 5.0, "stop_price": 4395.0, "stop_reason": "order_block"}},
            "short": {},
        }

        managed = _apply_trade_management(
            records, high_np, low_np, close_np, atr_np,
            spec, None, df, open_np=open_np,
            structural_stop_map=structural_stop_map,
        )
        assert len(managed) == 1
        m = managed[0]
        assert m["stop_basis"] == "structural"
        assert m["risk_points"] == pytest.approx(5.0)
        assert m["exit_reason"] == "stop_loss"
        assert m["exit_idx"] == 2
        assert m["exit_price"] == pytest.approx(4395.0)

    def test_fallback_byte_identical_when_flag_disabled(self, monkeypatch):
        """With the flag OFF, output must exactly match the pre-fix ATR-clamp
        behavior even though a (tighter) structural map is available."""
        from src.engine.backtester import _apply_trade_management

        open_np, high_np, low_np, close_np, atr_np, df = _bar_arrays()
        records = _make_records(entry_idx=1, exit_idx=4)
        spec = _make_spec()
        structural_stop_map = {
            "long": {0: {"distance": 5.0, "stop_price": 4395.0, "stop_reason": "order_block"}},
            "short": {},
        }

        monkeypatch.setenv("BACKTEST_STRUCTURAL_STOP_PARITY_ENABLED", "false")
        managed_off = _apply_trade_management(
            records, high_np, low_np, close_np, atr_np,
            spec, None, df, open_np=open_np,
            structural_stop_map=structural_stop_map,
        )[0]

        monkeypatch.delenv("BACKTEST_STRUCTURAL_STOP_PARITY_ENABLED", raising=False)
        managed_nomap = _apply_trade_management(
            records, high_np, low_np, close_np, atr_np,
            spec, None, df, open_np=open_np,
            structural_stop_map=None,
        )[0]

        # Both must reproduce the pre-fix legacy formula: min(ceiling=14.0, atr*1.5=15.0)=14.0
        for m, label in ((managed_off, "flag_off"), (managed_nomap, "no_map")):
            assert m["stop_basis"] == "atr_fallback", label
            assert m["risk_points"] == pytest.approx(14.0), label
            assert m["exit_reason"] == "signal", label  # legacy stop never fires in this bar sequence
            assert m["exit_price"] == pytest.approx(4398.0), label  # original vectorbt signal exit

        # And the two byte-identical fallback paths must match each other exactly.
        assert managed_off["risk_points"] == managed_nomap["risk_points"]
        assert managed_off["exit_price"] == managed_nomap["exit_price"]
        assert managed_off["exit_reason"] == managed_nomap["exit_reason"]
        assert managed_off["exit_idx"] == managed_nomap["exit_idx"]

    def test_no_structural_map_argument_preserves_pre_fix_default(self):
        """Callers that never pass structural_stop_map at all (e.g. any caller
        not yet updated) get the default None → legacy behavior, confirming the
        new kwarg is fully backward compatible."""
        from src.engine.backtester import _apply_trade_management

        open_np, high_np, low_np, close_np, atr_np, df = _bar_arrays()
        records = _make_records(entry_idx=1, exit_idx=4)
        spec = _make_spec()

        managed = _apply_trade_management(
            records, high_np, low_np, close_np, atr_np,
            spec, None, df, open_np=open_np,
        )[0]
        assert managed["stop_basis"] == "atr_fallback"
        assert managed["risk_points"] == pytest.approx(14.0)


# ──────────────────────────────────────────────────────────────────────────────
# 4. apply_eligibility_gate() schema stability: structural_stop_map key always
#    present, even in passthrough mode (htf_cache=None/empty).
# ──────────────────────────────────────────────────────────────────────────────

class TestApplyEligibilityGateStructuralStopMapSchema:
    def test_passthrough_mode_yields_empty_structural_stop_map(self):
        """htf_cache=None → passthrough mode; gate_stats["structural_stop_map"]
        must still exist (empty dict) so callers can safely .get() it without
        risking a KeyError — the additive schema change must not break the
        pre-existing passthrough contract."""
        from src.engine.backtester import apply_eligibility_gate

        n = 10
        df = pl.DataFrame({
            "close": [4400.0 + i for i in range(n)],
            "atr_14": [4.0] * n,
        })
        entries = np.zeros(n, dtype=bool)
        entries[3] = True
        exits = np.zeros(n, dtype=bool)

        filtered, filtered_exits, gate_stats = apply_eligibility_gate(
            entries, exits, df, direction="long", symbol="MES",
            htf_cache=None,
        )
        assert gate_stats["mode"] == "passthrough_htf_unavailable"
        assert gate_stats.get("structural_stop_map", "MISSING") == {}
        # Passthrough: signals pass through unfiltered.
        assert bool(filtered[3]) is True

    def test_ablation_disabled_mode_yields_empty_structural_stop_map(self, monkeypatch):
        """TF_CONFLUENCE_OVERLAY_DISABLED=true early-return path must also carry
        the additive key so every return path has a uniform schema."""
        from src.engine.backtester import apply_eligibility_gate

        monkeypatch.setenv("TF_CONFLUENCE_OVERLAY_DISABLED", "true")
        n = 5
        df = pl.DataFrame({
            "close": [4400.0 + i for i in range(n)],
            "atr_14": [4.0] * n,
        })
        entries = np.zeros(n, dtype=bool)
        exits = np.zeros(n, dtype=bool)

        _, _, gate_stats = apply_eligibility_gate(
            entries, exits, df, direction="long", symbol="MES",
            htf_cache={"2026-01-05": object()},
        )
        assert gate_stats["mode"] == "source_entry_only"
        assert gate_stats.get("structural_stop_map", "MISSING") == {}
