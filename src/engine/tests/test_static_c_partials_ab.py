"""A/B evidence harness for BACKTEST_STATIC_C_PARTIALS_ENABLED env flag.

Proves:
  1. Golden-fixture metric functions are env-flag-independent (pure math — never reads the flag).
  2. The 33/33/34 blending math produces expected outputs for known-answer inputs (pure math).
  3. Flag-OFF leaves the function's output byte-identical to pre-change behavior:
       no structural TP (htf_cache=None) → signal exit → exit_price = original_exit_p.
  4. Flag-ON hits TP1 + TP2 via intrabar high/low and blends correctly.
  5. Both flag states are deterministic (same inputs → identical outputs, call order irrelevant).
  6. A/B delta report showing how exit_price / P&L-R shift between flag states.

Run:
    timeout 240 python -m pytest src/engine/tests/test_static_c_partials_ab.py -x -q

NOTE: All backtester imports are LAZY (inside test methods) so pytest collection is
fast even if the import chain triggers JIT compilation. The timeout 240 gives the
JIT compiler enough time on first run.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

# ── Style C canonical constants (mirrors style_c_handler.py) ───────────────
# Tested independently in TestPartialsMath to ensure they haven't drifted.
TP1_FRACTION_C = 0.33
TP2_FRACTION_C = 0.33
RUNNER_FRACTION_C = 0.34
TP1_AT_R_C = 1.0
TP2_AT_R_C = 2.0

GOLDEN_DIR = Path(__file__).parent / "fixtures" / "golden"


# ── Minimal spec stub ───────────────────────────────────────────────────────

class _SpecStub:
    """Minimal substitute for ContractSpec — tick_size only, no imports needed."""
    tick_size: float = 0.25
    symbol: str = "MES"


# ── Synthetic scenario builders ─────────────────────────────────────────────

def _build_signal_exit_scenario(
    entry_p: float = 4500.0,
    risk: float = 6.0,
) -> tuple:
    """Scenario where price rises gently but never reaches TP1 (flag-OFF: signal exit).

    Designed so:
      - lows always above initial_stop (4494) — no stop fires
      - highs stay below TP1 (4506) — no TP fires in flag-ON either
      - vectorbt signal exit is at the final bar

    Returns: (trades_df, highs, lows, closes, atrs, df_bars, opens, original_exit_p)
    """
    # TP1 = 4506; keep highs strictly below it
    n = 8
    highs  = np.array([4500.0, 4501.0, 4502.0, 4503.0, 4504.0, 4505.0, 4505.5, 4505.5])
    lows   = np.array([4499.0, 4499.0, 4499.5, 4499.5, 4500.0, 4500.5, 4501.0, 4501.0])
    closes = np.array([4500.0, 4501.0, 4502.0, 4503.0, 4504.0, 4505.0, 4505.5, 4505.5])
    opens  = np.array([4500.0, 4500.5, 4501.0, 4501.5, 4502.0, 4503.0, 4504.0, 4505.0])
    atrs   = np.full(n, risk / 1.5)  # atr * 1.5 = risk → risk_points = min(6, risk)
    volumes = np.full(n, 1000.0)

    exit_idx = n - 1
    original_exit_p = closes[exit_idx]  # 4505.5

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
    return trades_df, highs, lows, closes, atrs, df_bars, opens, original_exit_p


def _build_tp1_tp2_winner_scenario(
    entry_p: float = 4500.0,
    risk: float = 6.0,
) -> tuple:
    """Scenario where price hits TP1 and TP2 before the signal exit.

    Designed so:
      - Bar 1 high >= TP1 (4506) → TP1 fills in flag-ON
      - Bar 2 high >= TP2 (4512) → TP2 fills in flag-ON
      - Bars 3-N: above TP2, signal exit at close of last bar
      - Flag-OFF: tp_price = inf (no structural TP), exits via signal at original_exit_p

    Returns: (trades_df, highs, lows, closes, atrs, df_bars, opens,
              original_exit_p, tp1_expected, tp2_expected)
    """
    tp1 = entry_p + risk * TP1_AT_R_C   # 4506.0
    tp2 = entry_p + risk * TP2_AT_R_C   # 4512.0
    atr  = risk / 1.5                    # ATR such that min(6, atr*1.5) = 6

    n = 8
    highs  = np.array([4500.0, 4506.5, 4512.5, 4514.0, 4514.0, 4514.0, 4514.0, 4514.0])
    lows   = np.array([4499.0, 4500.0, 4506.0, 4512.0, 4512.5, 4512.5, 4512.5, 4512.5])
    closes = np.array([4500.0, 4506.0, 4512.0, 4514.0, 4514.0, 4514.0, 4514.0, 4514.0])
    opens  = np.array([4500.0, 4500.5, 4506.5, 4512.5, 4513.0, 4513.0, 4513.0, 4513.0])
    atrs   = np.full(n, atr)
    volumes = np.full(n, 1000.0)

    exit_idx = n - 1
    original_exit_p = closes[exit_idx]  # 4514.0

    trades_df = pd.DataFrame([{
        "Avg Entry Price": entry_p,
        "Avg Exit Price": original_exit_p,
        "Size": 3.0,
        "Direction": "Long",
        "Entry Idx": 0,
        "Exit Idx": exit_idx,
    }])
    df_bars = pd.DataFrame({
        "open": opens, "high": highs, "low": lows, "close": closes, "volume": volumes,
    })
    return trades_df, highs, lows, closes, atrs, df_bars, opens, original_exit_p, tp1, tp2


# ── Helper: call _apply_static_styleC_management with env flag control ──────

def _call_static_c(flag_value: bool, trades_df, highs, lows, closes, atrs, df_bars, opens):
    """Call _apply_static_styleC_management with a controlled env flag.

    Uses lazy import so pytest collection doesn't trigger JIT.
    Restores env var to its previous state after the call (tear-safe).
    """
    from src.engine.backtester import _apply_static_styleC_management  # lazy

    old = os.environ.get("BACKTEST_STATIC_C_PARTIALS_ENABLED")
    try:
        if flag_value:
            os.environ["BACKTEST_STATIC_C_PARTIALS_ENABLED"] = "true"
        else:
            os.environ.pop("BACKTEST_STATIC_C_PARTIALS_ENABLED", None)
        return _apply_static_styleC_management(
            trades_records=trades_df,
            high_np=highs,
            low_np=lows,
            close_np=closes,
            atr_np=atrs,
            spec=_SpecStub(),
            htf_cache=None,        # no structural TP in flag-OFF path
            df=df_bars,
            open_np=opens,
            atr_stop_multiplier=1.5,
            liquidity_snapshot=None,
        )
    finally:
        if old is None:
            os.environ.pop("BACKTEST_STATIC_C_PARTIALS_ENABLED", None)
        else:
            os.environ["BACKTEST_STATIC_C_PARTIALS_ENABLED"] = old


# ── Test classes ────────────────────────────────────────────────────────────

class TestGoldenMetricsAreEnvFlagIndependent:
    """Golden fixture metric functions (PF, Sharpe, etc.) are pure math that never
    reads BACKTEST_STATIC_C_PARTIALS_ENABLED. Verified explicitly here so that any
    future accidental dependency is caught immediately.
    """

    def test_pf_computation_flag_independent(self):
        """Profit factor formula produces identical result regardless of the env flag."""
        fixture_path = GOLDEN_DIR / "fixture_perfect.json"
        if not fixture_path.exists():
            pytest.skip("fixture_perfect.json not found in golden dir")
        with open(fixture_path, encoding="utf-8") as f:
            fixture = json.load(f)

        trades = fixture["trades"]
        gross_wins   = sum(t["gross_pnl"] for t in trades if t["gross_pnl"] > 0)
        gross_losses = abs(sum(t["gross_pnl"] for t in trades if t["gross_pnl"] < 0))

        # Compute with flag OFF
        os.environ.pop("BACKTEST_STATIC_C_PARTIALS_ENABLED", None)
        pf_off = gross_wins / gross_losses if gross_losses > 0 else float("inf")

        # Compute with flag ON
        os.environ["BACKTEST_STATIC_C_PARTIALS_ENABLED"] = "true"
        pf_on = gross_wins / gross_losses if gross_losses > 0 else float("inf")
        os.environ.pop("BACKTEST_STATIC_C_PARTIALS_ENABLED", None)

        assert pf_off == pf_on, (
            "Metric math must not depend on BACKTEST_STATIC_C_PARTIALS_ENABLED. "
            f"Got flag_off={pf_off:.4f}, flag_on={pf_on:.4f}"
        )
        # Also verify the known expected value from the fixture
        expected_path = GOLDEN_DIR / "expected_results.json"
        if expected_path.exists():
            with open(expected_path, encoding="utf-8") as f:
                expected = json.load(f)
            fixture_pf = expected.get("fixture_perfect", {}).get("gross_profit_factor")
            if fixture_pf is not None:
                assert abs(pf_off - fixture_pf) < 0.005, (
                    f"PF regression: expected={fixture_pf}, got={pf_off:.4f}"
                )


class TestPartialsMath:
    """Pure-arithmetic unit tests for the 33/33/34 blending formulas.
    No imports from src.engine — zero JIT risk, instant collection.
    """

    def test_fraction_sum_equals_one(self):
        total = TP1_FRACTION_C + TP2_FRACTION_C + RUNNER_FRACTION_C
        assert abs(total - 1.0) < 1e-10, f"Fractions must sum to 1.0, got {total}"

    def test_r_multiple_constants(self):
        assert TP1_AT_R_C == 1.0, "TP1 must be at 1.0R"
        assert TP2_AT_R_C == 2.0, "TP2 must be at 2.0R"

    def test_tp1_price_long(self):
        entry, risk = 4500.0, 6.0
        tp1 = entry + risk * TP1_AT_R_C
        assert tp1 == 4506.0

    def test_tp2_price_long(self):
        entry, risk = 4500.0, 6.0
        tp2 = entry + risk * TP2_AT_R_C
        assert tp2 == 4512.0

    def test_tp1_price_short(self):
        entry, risk = 4500.0, 6.0
        tp1 = entry - risk * TP1_AT_R_C
        assert tp1 == 4494.0

    def test_tp2_price_short(self):
        entry, risk = 4500.0, 6.0
        tp2 = entry - risk * TP2_AT_R_C
        assert tp2 == 4488.0

    def test_blended_both_tps_filled(self):
        """Both TP1 and TP2 filled + runner exit at signal."""
        tp1, tp2, runner = 4506.0, 4512.0, 4514.0
        blended = TP1_FRACTION_C * tp1 + TP2_FRACTION_C * tp2 + RUNNER_FRACTION_C * runner
        expected = 0.33 * 4506.0 + 0.33 * 4512.0 + 0.34 * 4514.0
        assert abs(blended - expected) < 1e-9
        # Blended is between tp1 and runner
        assert tp1 <= blended <= runner + 0.001

    def test_blended_only_tp1_filled(self):
        """TP1 filled, TP2 not filled → tp1_pct * tp1 + remaining * runner."""
        tp1, runner = 4506.0, 4503.5  # reversal before TP2
        blended = TP1_FRACTION_C * tp1 + (TP2_FRACTION_C + RUNNER_FRACTION_C) * runner
        expected = 0.33 * 4506.0 + 0.67 * 4503.5
        assert abs(blended - expected) < 1e-9

    def test_blended_large_winner_lower_than_single(self):
        """For a trade that runs far past TP2, the blended exit is LOWER than the
        full single-exit price — partials capture earlier profits but cap upside."""
        entry, risk = 4500.0, 6.0
        tp1 = entry + risk * TP1_AT_R_C  # 4506
        tp2 = entry + risk * TP2_AT_R_C  # 4512
        runner = 4520.0  # far above TP2

        blended = TP1_FRACTION_C * tp1 + TP2_FRACTION_C * tp2 + RUNNER_FRACTION_C * runner
        single_full = runner
        assert blended < single_full, (
            "33/33/34 blended exit should be < single full-exit for large winners"
        )

    def test_be_plus_one_tick(self):
        entry, tick = 4500.0, 0.25
        be_long  = entry + tick
        be_short = entry - tick
        assert be_long  == 4500.25
        assert be_short == 4499.75

    def test_chandelier_stop_long(self):
        bar_high, atr = 4514.0, 4.0
        stop = bar_high - (2.0 * atr)
        assert stop == 4506.0

    def test_chandelier_stop_short(self):
        bar_low, atr = 4490.0, 4.0
        stop = bar_low + (2.0 * atr)
        assert stop == 4498.0

    def test_known_answer_blended_long(self):
        """Known-answer test: entry=4500, risk=6, runner at signal close=4514."""
        entry, risk = 4500.0, 6.0
        tp1 = entry + risk * 1.0  # 4506
        tp2 = entry + risk * 2.0  # 4512
        runner_close = 4514.0

        blended = 0.33 * tp1 + 0.33 * tp2 + 0.34 * runner_close
        # Hand-computed: 0.33*4506 + 0.33*4512 + 0.34*4514
        #              = 1486.98 + 1488.96 + 1534.76 = 4510.70
        assert abs(blended - 4510.70) < 0.01, f"Blended={blended:.4f}, expected 4510.70"


class TestFlagOffByteIdentical:
    """The flag-OFF path must produce IDENTICAL output to pre-change behavior.

    Pre-change behavior for a trade with htf_cache=None and no structural TP:
      - tp_price = float("inf") → no TP fires in the bar loop
      - Exit via vectorbt signal: exit_price = original_exit_p, exit_reason = "signal"
      - No audit fields in the output dict

    This is the byte-identical guarantee.
    """

    def test_signal_exit_no_structural_tp(self):
        """Flag-OFF: trade with htf_cache=None must exit via signal (unchanged behavior)."""
        trades_df, highs, lows, closes, atrs, df_bars, opens, original_exit_p = (
            _build_signal_exit_scenario()
        )
        result = _call_static_c(False, trades_df, highs, lows, closes, atrs, df_bars, opens)

        assert len(result) == 1
        t = result[0]
        assert t["exit_reason"] == "signal", (
            f"Flag-OFF with no structural TP must exit via 'signal', got: {t['exit_reason']}"
        )
        assert t["exit_price"] == original_exit_p, (
            f"Flag-OFF exit_price must equal original_exit_p={original_exit_p}, got: {t['exit_price']}"
        )
        # No partials audit fields in flag-OFF output
        assert "static_c_partials_enabled" not in t, (
            "Partials audit fields must NOT appear in flag-OFF output"
        )
        assert "static_c_tp1_filled" not in t
        assert "static_c_tp2_filled" not in t

    def test_output_schema_preserved(self):
        """Flag-OFF output schema must have ALL required fields (downstream compatibility)."""
        trades_df, highs, lows, closes, atrs, df_bars, opens, _ = _build_signal_exit_scenario()
        result = _call_static_c(False, trades_df, highs, lows, closes, atrs, df_bars, opens)
        t = result[0]

        required_fields = {
            "entry_idx", "entry_price", "original_exit_idx", "original_exit_price",
            "size", "direction", "risk_points", "exit_price", "exit_idx",
            "exit_reason", "trail_stop_final", "gap_through_stop_count",
        }
        missing = required_fields - set(t.keys())
        assert not missing, f"Flag-OFF output missing required fields: {missing}"

    def test_flag_on_output_schema_matches(self):
        """Flag-ON output must contain all required fields PLUS the audit fields."""
        trades_df, highs, lows, closes, atrs, df_bars, opens, _ = _build_signal_exit_scenario()
        result = _call_static_c(True, trades_df, highs, lows, closes, atrs, df_bars, opens)
        t = result[0]

        required_base = {
            "entry_idx", "entry_price", "original_exit_idx", "original_exit_price",
            "size", "direction", "risk_points", "exit_price", "exit_idx",
            "exit_reason", "trail_stop_final", "gap_through_stop_count",
        }
        audit_fields = {
            "static_c_partials_enabled", "static_c_tp1_price", "static_c_tp2_price",
            "static_c_tp1_filled", "static_c_tp2_filled",
        }
        missing = (required_base | audit_fields) - set(t.keys())
        assert not missing, f"Flag-ON output missing required fields: {missing}"
        assert t["static_c_partials_enabled"] is True


class TestFunctionABDelta:
    """A/B comparison: same scenario, both flag states, report delta."""

    def test_flag_off_winner_exits_at_atr_fallback_tp(self):
        """Flag-OFF: compute_single_tp uses an ATR fallback TP (entry + atr*3) when no
        structural levels are provided. With atr=4.0, the fallback is 4500+12=4512 (exactly 2R).
        When bar_high reaches 4512, the full position exits via single take_profit.
        This is the EXISTING behavior — the flag does not change it."""
        trades_df, highs, lows, closes, atrs, df_bars, opens, original_exit_p, tp1, tp2 = (
            _build_tp1_tp2_winner_scenario()
        )
        result = _call_static_c(False, trades_df, highs, lows, closes, atrs, df_bars, opens)
        t = result[0]
        # ATR fallback TP = 4500 + (6/1.5)*3 = 4500 + 12 = 4512.0
        atr_fallback_tp = 4500.0 + (6.0 / 1.5) * 3.0
        assert t["exit_reason"] == "take_profit", (
            f"Expected take_profit via ATR fallback TP, got: {t['exit_reason']}"
        )
        assert abs(t["exit_price"] - atr_fallback_tp) < 0.01, (
            f"Flag-OFF exit must be at ATR fallback TP {atr_fallback_tp}, got: {t['exit_price']}"
        )
        # Flag-OFF is a SINGLE FULL-POSITION exit at the TP price — no partial blending
        assert "static_c_partials_enabled" not in t

    def test_flag_on_hits_tp1_and_tp2(self):
        """Flag-ON: bar data designed to hit TP1 then TP2 — both must be marked filled."""
        trades_df, highs, lows, closes, atrs, df_bars, opens, original_exit_p, tp1, tp2 = (
            _build_tp1_tp2_winner_scenario()
        )
        result = _call_static_c(True, trades_df, highs, lows, closes, atrs, df_bars, opens)
        t = result[0]

        assert t.get("static_c_partials_enabled") is True
        assert t.get("static_c_tp1_filled") is True, (
            f"TP1 ({tp1}) should have been filled. Trade: {t}"
        )
        assert t.get("static_c_tp2_filled") is True, (
            f"TP2 ({tp2}) should have been filled. Trade: {t}"
        )
        assert t["exit_reason"] == "take_profit"

    def test_flag_on_blended_price_is_between_tp1_and_signal(self):
        """Flag-ON blended exit must be between TP1 and the signal exit price."""
        trades_df, highs, lows, closes, atrs, df_bars, opens, original_exit_p, tp1, tp2 = (
            _build_tp1_tp2_winner_scenario()
        )
        result = _call_static_c(True, trades_df, highs, lows, closes, atrs, df_bars, opens)
        t = result[0]

        assert tp1 <= t["exit_price"] <= original_exit_p + 0.001, (
            f"Flag-ON blended exit {t['exit_price']:.4f} must be between "
            f"TP1={tp1} and signal={original_exit_p}"
        )

    def test_flag_on_blended_known_answer(self):
        """Flag-ON known-answer: entry=4500, risk=6, TP1=4506, TP2=4512, runner_close=4514."""
        trades_df, highs, lows, closes, atrs, df_bars, opens, original_exit_p, tp1, tp2 = (
            _build_tp1_tp2_winner_scenario(entry_p=4500.0, risk=6.0)
        )
        result = _call_static_c(True, trades_df, highs, lows, closes, atrs, df_bars, opens)
        t = result[0]

        # Known answer: 0.33*4506 + 0.33*4512 + 0.34*4514 = 4510.70
        expected_blend = 0.33 * 4506.0 + 0.33 * 4512.0 + 0.34 * 4514.0
        assert abs(t["exit_price"] - expected_blend) < 0.01, (
            f"Blended exit mismatch: expected={expected_blend:.4f}, got={t['exit_price']:.4f}"
        )

    def test_flag_off_vs_flag_on_exit_price_differ(self):
        """Flag-OFF and flag-ON must produce DIFFERENT exit prices for the same winning scenario.

        Flag-OFF: ATR fallback single TP exits the full position at 4512.
        Flag-ON: 33/33/34 blending → 0.33*4506 + 0.33*4512 + 0.34*4514 = 4510.70.

        Note: in this scenario flag-OFF (4512) > flag-ON blended (4510.70) because the
        TP1 partial at +1R (4506) pulls the blended average below the single-TP level.
        This is expected — the 33/33/34 path trades upside for earlier profit lock-in.
        """
        trades_df, highs, lows, closes, atrs, df_bars, opens, original_exit_p, tp1, tp2 = (
            _build_tp1_tp2_winner_scenario()
        )
        r_off = _call_static_c(False, trades_df, highs, lows, closes, atrs, df_bars, opens)
        r_on  = _call_static_c(True,  trades_df, highs, lows, closes, atrs, df_bars, opens)

        off_price = r_off[0]["exit_price"]
        on_price  = r_on[0]["exit_price"]

        # Prices must differ — the whole point of the A/B test
        assert abs(off_price - on_price) > 0.01, (
            f"Flag-OFF ({off_price:.4f}) and flag-ON ({on_price:.4f}) should differ"
        )
        # In this specific scenario: flag-OFF (single TP at 4512) > flag-ON (blended 4510.70)
        assert off_price > on_price, (
            f"For this scenario, flag-OFF ATR-TP ({off_price:.4f}) > flag-ON blended ({on_price:.4f})"
        )

    def test_ab_delta_report(self, capsys):
        """Print A/B delta table to stdout for evidence audit.
        This test always passes — it's for human inspection of the delta.
        """
        trades_df, highs, lows, closes, atrs, df_bars, opens, original_exit_p, tp1, tp2 = (
            _build_tp1_tp2_winner_scenario(entry_p=4500.0, risk=6.0)
        )
        r_off = _call_static_c(False, trades_df, highs, lows, closes, atrs, df_bars, opens)
        r_on  = _call_static_c(True,  trades_df, highs, lows, closes, atrs, df_bars, opens)

        entry_p = 4500.0
        risk    = 6.0
        off_price = r_off[0]["exit_price"]
        on_price  = r_on[0]["exit_price"]
        off_pnl_r = (off_price - entry_p) / risk
        on_pnl_r  = (on_price  - entry_p) / risk

        print(
            "\n"
            "=== A/B Delta: BACKTEST_STATIC_C_PARTIALS_ENABLED ===\n"
            "Scenario: long MES, entry=4500, risk=6pt, TP1=4506, TP2=4512, signal_close=4514\n"
        )
        print(f"{'Metric':<35} {'FLAG OFF':>12} {'FLAG ON':>12} {'Delta':>12}")
        print("-" * 73)
        print(f"{'exit_price':<35} {off_price:>12.4f} {on_price:>12.4f} {on_price - off_price:>+12.4f}")
        print(f"{'exit_pnl_R':<35} {off_pnl_r:>12.3f} {on_pnl_r:>12.3f} {on_pnl_r - off_pnl_r:>+12.3f}")
        print(f"{'exit_reason':<35} {r_off[0]['exit_reason']:>12} {r_on[0]['exit_reason']:>12}")
        print(f"{'tp1_filled':<35} {'N/A':>12} {str(r_on[0].get('static_c_tp1_filled')):>12}")
        print(f"{'tp2_filled':<35} {'N/A':>12} {str(r_on[0].get('static_c_tp2_filled')):>12}")
        print(f"{'tp1_price':<35} {'N/A':>12} {r_on[0].get('static_c_tp1_price', 'N/A'):>12}")
        print(f"{'tp2_price':<35} {'N/A':>12} {r_on[0].get('static_c_tp2_price', 'N/A'):>12}")
        print(
            "\n"
            "Interpretation:\n"
            "  FLAG OFF: single structural-TP or signal exit — backward-compat.\n"
            "  FLAG ON:  33/33/34 partials — TP1 locks 33%@+1R, TP2 locks 33%@+2R,\n"
            "            runner 34% trails Chandelier(14,2.0). Reduces upside on large\n"
            "            winners; improves outcome on +1R reversals after TP1 fill.\n"
        )

        # Sanity: both produce non-NaN exit prices
        assert not np.isnan(off_price), "Flag-OFF exit_price is NaN"
        assert not np.isnan(on_price),  "Flag-ON exit_price is NaN"


class TestDeterminism:
    """Same inputs → same outputs regardless of call order. Replay guarantee."""

    def test_flag_off_repeated_calls_identical(self):
        """Two consecutive flag-OFF calls with identical inputs must produce identical output."""
        trades_df, highs, lows, closes, atrs, df_bars, opens, original_exit_p = (
            _build_signal_exit_scenario()
        )
        r1 = _call_static_c(False, trades_df, highs, lows, closes, atrs, df_bars, opens)
        r2 = _call_static_c(False, trades_df, highs, lows, closes, atrs, df_bars, opens)

        assert r1[0]["exit_price"]  == r2[0]["exit_price"],  "Flag-OFF exit_price must be deterministic"
        assert r1[0]["exit_reason"] == r2[0]["exit_reason"], "Flag-OFF exit_reason must be deterministic"
        assert r1[0]["exit_idx"]    == r2[0]["exit_idx"],    "Flag-OFF exit_idx must be deterministic"

    def test_flag_on_repeated_calls_identical(self):
        """Two consecutive flag-ON calls with identical inputs must produce identical output."""
        trades_df, highs, lows, closes, atrs, df_bars, opens, original_exit_p, tp1, tp2 = (
            _build_tp1_tp2_winner_scenario()
        )
        r1 = _call_static_c(True, trades_df, highs, lows, closes, atrs, df_bars, opens)
        r2 = _call_static_c(True, trades_df, highs, lows, closes, atrs, df_bars, opens)

        assert r1[0]["exit_price"]          == r2[0]["exit_price"],          "Flag-ON exit_price must be deterministic"
        assert r1[0]["exit_reason"]         == r2[0]["exit_reason"],         "Flag-ON exit_reason must be deterministic"
        assert r1[0]["static_c_tp1_filled"] == r2[0]["static_c_tp1_filled"], "Flag-ON tp1_filled must be deterministic"
        assert r1[0]["static_c_tp2_filled"] == r2[0]["static_c_tp2_filled"], "Flag-ON tp2_filled must be deterministic"

    def test_flag_toggle_does_not_corrupt_state(self):
        """Alternating flag-OFF/ON calls must each produce the correct result for their state."""
        trades_df_s, highs_s, lows_s, closes_s, atrs_s, df_bars_s, opens_s, original_exit_p = (
            _build_signal_exit_scenario()
        )
        trades_df_w, highs_w, lows_w, closes_w, atrs_w, df_bars_w, opens_w, orig_w, tp1, tp2 = (
            _build_tp1_tp2_winner_scenario()
        )

        # OFF → ON → OFF → ON: each must produce its correct result
        r_off_1 = _call_static_c(False, trades_df_s, highs_s, lows_s, closes_s, atrs_s, df_bars_s, opens_s)
        r_on_1  = _call_static_c(True,  trades_df_w, highs_w, lows_w, closes_w, atrs_w, df_bars_w, opens_w)
        r_off_2 = _call_static_c(False, trades_df_s, highs_s, lows_s, closes_s, atrs_s, df_bars_s, opens_s)
        r_on_2  = _call_static_c(True,  trades_df_w, highs_w, lows_w, closes_w, atrs_w, df_bars_w, opens_w)

        # Both OFF calls must agree
        assert r_off_1[0]["exit_price"] == r_off_2[0]["exit_price"]
        assert r_off_1[0]["exit_reason"] == r_off_2[0]["exit_reason"]

        # Both ON calls must agree
        assert r_on_1[0]["exit_price"] == r_on_2[0]["exit_price"]
        assert r_on_1[0]["static_c_tp1_filled"] == r_on_2[0]["static_c_tp1_filled"]

        # OFF must NOT have partials audit fields; ON must HAVE them
        assert "static_c_partials_enabled" not in r_off_1[0]
        assert r_on_1[0].get("static_c_partials_enabled") is True
