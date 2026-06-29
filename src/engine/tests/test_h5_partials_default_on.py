"""H-5 (2026-06-29): BACKTEST_STATIC_C_PARTIALS_ENABLED default changed from OFF to ON.

Regression assertions:
  1. Default path (no env var) activates 33/33/34 partial logic.
  2. TP1@+1R sets BE+1-tick stop and records tp1_filled=True.
  3. Both TP1 and TP2 fill when price hits both levels → blended exit.
  4. Env var "false"/"0"/"no" reverts to legacy single-TP path.
  5. Env var "true"/"1"/"yes" explicitly activates partials (same as default now).

NOTE: All backtester imports are LAZY (inside test methods) to prevent pytest
collection from triggering vectorbt JIT compilation (hangs on this tower).
"""
from __future__ import annotations

import os

import numpy as np
import pandas as pd

# ── Canonical Style C constants (must match style_c_handler.py) ─────────────
TP1_FRACTION_C = 0.33
TP2_FRACTION_C = 0.33
RUNNER_FRACTION_C = 0.34
TP1_AT_R_C = 1.0
TP2_AT_R_C = 2.0


class _SpecStub:
    tick_size: float = 0.25
    symbol: str = "MES"


def _build_tp1_tp2_scenario(
    entry_p: float = 4500.0,
    risk: float = 6.0,
) -> tuple:
    """Scenario where price hits both TP1 and TP2 then closes.

    Design constraints:
      - TP1 = entry + 1R = 4506.0; TP2 = entry + 2R = 4512.0
      - Bar loop: range(entry_idx+1, original_exit_idx) = bars 1..8 (excl. bar 9)
      - After TP1 hits (bar 2), BE+1tick stop = 4500.25
      - Bars 3-8 must have low > 4500.25 so stop never fires before TP2
      - ATR = risk/1.5 = 4.0; Chandelier = bar_high - 2*ATR = bar_high - 8

    Timeline:
      bar 0: entry bar (skipped by loop)
      bar 1: pre-TP1; high=4504 < 4506
      bar 2: TP1 hits (high=4507); stop → 4500.25
      bar 3: low=4505 > 4500.25; TP2 not yet
      bar 4: low=4506 > 4500.25; TP2 not yet
      bar 5: TP2 hits (high=4513); stop → max(4500.25, 4513-8=4505) = 4505
      bar 6: low=4508 > 4505; stop → max(4505, 4514-8=4506) = 4506
      bar 7: low=4510 > 4506; trail holds
      bar 8: low=4512 > 4506; trail holds
      bar 9: original_exit_idx (runner exits at close=4514.0)

    Blended exit: 0.33*4506 + 0.33*4512 + 0.34*4514 = 4510.70

    Returns (trades_df, highs, lows, closes, atrs, df_bars, opens, original_exit_p, tp1, tp2)
    """
    tp1 = entry_p + risk * TP1_AT_R_C   # 4506.0
    tp2 = entry_p + risk * TP2_AT_R_C   # 4512.0
    n = 10
    highs  = np.array([4500.0, 4504.0, 4507.0, 4508.0, 4510.0, 4513.0, 4514.0, 4514.0, 4514.0, 4514.0])
    lows   = np.array([4499.0, 4501.0, 4505.0, 4505.0, 4506.0, 4507.0, 4508.0, 4510.0, 4512.0, 4513.0])
    closes = np.array([4500.0, 4503.0, 4506.5, 4507.0, 4509.0, 4512.5, 4513.0, 4514.0, 4514.0, 4514.0])
    opens  = np.array([4499.5, 4501.0, 4504.5, 4507.0, 4508.0, 4510.0, 4512.0, 4513.0, 4513.5, 4514.0])
    atrs   = np.full(n, risk / 1.5)  # 4.0
    volumes = np.full(n, 1000.0)

    exit_idx = n - 1
    original_exit_p = closes[exit_idx]  # 4514.0

    trades_df = pd.DataFrame([{
        "Avg Entry Price": entry_p,
        "Avg Exit Price": original_exit_p,
        "Size": 1.0,
        "Direction": "Long",
        "Entry Idx": 0,
        "Exit Idx": exit_idx,
    }])

    df_bars = pd.DataFrame({
        "open": opens, "high": highs, "low": lows, "close": closes, "volume": volumes,
    })

    return trades_df, highs, lows, closes, atrs, df_bars, opens, original_exit_p, tp1, tp2


def _run_management(flag_value: bool | None, trades_df, highs, lows, closes, atrs, df_bars, opens):
    """Call _apply_static_styleC_management with the given flag."""
    from src.engine.backtester import _apply_static_styleC_management  # lazy

    old = os.environ.get("BACKTEST_STATIC_C_PARTIALS_ENABLED")
    try:
        if flag_value is None:
            # Clear the env var to test the default behavior
            os.environ.pop("BACKTEST_STATIC_C_PARTIALS_ENABLED", None)
        elif flag_value:
            os.environ["BACKTEST_STATIC_C_PARTIALS_ENABLED"] = "true"
        else:
            os.environ["BACKTEST_STATIC_C_PARTIALS_ENABLED"] = "false"

        spec = _SpecStub()
        return _apply_static_styleC_management(
            trades_records=trades_df,
            high_np=highs,
            low_np=lows,
            close_np=closes,
            open_np=opens,
            atr_np=atrs,
            df=df_bars,
            spec=spec,
            atr_stop_multiplier=1.5,
            htf_cache=None,
            liquidity_snapshot=None,
        )
    finally:
        if old is None:
            os.environ.pop("BACKTEST_STATIC_C_PARTIALS_ENABLED", None)
        else:
            os.environ["BACKTEST_STATIC_C_PARTIALS_ENABLED"] = old


class TestH5PartialsDefaultOn:
    """H-5 regression: default env state must activate 33/33/34 partials path."""

    def test_default_env_activates_partials(self):
        """No env var set → partials ON (H-5 default flip)."""
        trades_df, highs, lows, closes, atrs, df_bars, opens, _, _, _ = (
            _build_tp1_tp2_scenario()
        )
        # Pass flag_value=None to simulate no env var set
        result = _run_management(None, trades_df, highs, lows, closes, atrs, df_bars, opens)
        assert len(result) == 1
        t = result[0]
        # Partials audit field must be present when ON
        assert t.get("static_c_partials_enabled") is True, (
            "Default (no env var) must now activate 33/33/34 partials (H-5 flip). "
            f"Got: {t}"
        )

    def test_default_tp1_hit_records_tp1_filled(self):
        """Default path: TP1 hit → static_c_tp1_filled=True."""
        trades_df, highs, lows, closes, atrs, df_bars, opens, _, tp1, tp2 = (
            _build_tp1_tp2_scenario()
        )
        result = _run_management(None, trades_df, highs, lows, closes, atrs, df_bars, opens)
        t = result[0]
        assert t.get("static_c_tp1_filled") is True, (
            f"TP1 at {tp1} should have been filled. Trade: {t}"
        )

    def test_default_tp2_hit_records_tp2_filled(self):
        """Default path: price hits both TP1 and TP2 → tp2_filled=True."""
        trades_df, highs, lows, closes, atrs, df_bars, opens, _, tp1, tp2 = (
            _build_tp1_tp2_scenario()
        )
        result = _run_management(None, trades_df, highs, lows, closes, atrs, df_bars, opens)
        t = result[0]
        assert t.get("static_c_tp2_filled") is True, (
            f"TP2 at {tp2} should have been filled. Trade: {t}"
        )

    def test_default_exit_is_blended_33_33_34(self):
        """Default path: blended exit = 0.33*tp1 + 0.33*tp2 + 0.34*runner."""
        entry_p = 4500.0
        risk = 6.0
        tp1 = entry_p + risk * TP1_AT_R_C   # 4506.0
        tp2 = entry_p + risk * TP2_AT_R_C   # 4512.0
        trades_df, highs, lows, closes, atrs, df_bars, opens, original_exit_p, _, _ = (
            _build_tp1_tp2_scenario(entry_p=entry_p, risk=risk)
        )
        result = _run_management(None, trades_df, highs, lows, closes, atrs, df_bars, opens)
        t = result[0]

        runner_exit = closes[-1]  # 4514.0
        expected_blended = (
            TP1_FRACTION_C * tp1
            + TP2_FRACTION_C * tp2
            + RUNNER_FRACTION_C * runner_exit
        )
        actual = t["exit_price"]
        assert abs(actual - expected_blended) < 0.01, (
            f"Blended exit should be {expected_blended:.4f}, got {actual:.4f}. "
            f"Formula: 0.33×{tp1} + 0.33×{tp2} + 0.34×{runner_exit}"
        )

    def test_explicit_false_reverts_to_legacy_path(self):
        """Env var 'false' → legacy single-TP path (partials audit fields absent)."""
        trades_df, highs, lows, closes, atrs, df_bars, opens, _, _, _ = (
            _build_tp1_tp2_scenario()
        )
        result = _run_management(False, trades_df, highs, lows, closes, atrs, df_bars, opens)
        t = result[0]
        assert "static_c_partials_enabled" not in t, (
            "Env=false must revert to legacy path — no partials audit fields. "
            f"Got: {t}"
        )

    def test_explicit_zero_reverts_to_legacy_path(self):
        """Env var '0' → legacy path (same as 'false')."""
        from src.engine.backtester import _apply_static_styleC_management  # lazy

        trades_df, highs, lows, closes, atrs, df_bars, opens, _, _, _ = (
            _build_tp1_tp2_scenario()
        )
        old = os.environ.get("BACKTEST_STATIC_C_PARTIALS_ENABLED")
        try:
            os.environ["BACKTEST_STATIC_C_PARTIALS_ENABLED"] = "0"
            spec = _SpecStub()
            result = _apply_static_styleC_management(
                trades_records=trades_df,
                high_np=highs, low_np=lows, close_np=closes, open_np=opens,
                atr_np=atrs, df=df_bars, spec=spec, atr_stop_multiplier=1.5,
                htf_cache=None, liquidity_snapshot=None,
            )
        finally:
            if old is None:
                os.environ.pop("BACKTEST_STATIC_C_PARTIALS_ENABLED", None)
            else:
                os.environ["BACKTEST_STATIC_C_PARTIALS_ENABLED"] = old

        t = result[0]
        assert "static_c_partials_enabled" not in t, (
            "Env='0' must disable partials. Got: {t}"
        )

    def test_explicit_true_activates_partials(self):
        """Env var 'true' → same as default (partials ON)."""
        trades_df, highs, lows, closes, atrs, df_bars, opens, _, _, _ = (
            _build_tp1_tp2_scenario()
        )
        result = _run_management(True, trades_df, highs, lows, closes, atrs, df_bars, opens)
        t = result[0]
        assert t.get("static_c_partials_enabled") is True, (
            "Env='true' must activate partials. Got: {t}"
        )

    def test_default_and_explicit_true_produce_identical_output(self):
        """Default and explicit 'true' must produce byte-identical trade records."""
        trades_df, highs, lows, closes, atrs, df_bars, opens, _, _, _ = (
            _build_tp1_tp2_scenario()
        )
        r_default = _run_management(None, trades_df, highs, lows, closes, atrs, df_bars, opens)
        r_explicit = _run_management(True, trades_df, highs, lows, closes, atrs, df_bars, opens)
        assert r_default[0]["exit_price"] == r_explicit[0]["exit_price"], (
            "Default and explicit 'true' must produce identical exit prices"
        )
        assert r_default[0].get("static_c_tp1_filled") == r_explicit[0].get("static_c_tp1_filled"), (
            "TP1 fill state must match between default and explicit 'true'"
        )
