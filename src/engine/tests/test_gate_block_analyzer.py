"""Tests for gate_block_analyzer.py — institutional-grade counterfactual engine.

Coverage:
  1.  Counterfactual: synthetic big-move blocked → COSTING verdict
  2.  Counterfactual: synthetic loser blocked → SAVING verdict
  3.  Big-move threshold boundary (MFE just below and just at threshold)
  4.  Big-move qualified by R-multiple (≥ BIG_MOVE_MIN_R)
  5.  Fail-closed: INDETERMINATE when entry bar index out of bounds
  6.  Fail-closed: INDETERMINATE when no forward bars supplied
  7.  Fail-closed: INDETERMINATE when NaN bar data in the simulation window
  8.  Per-gate aggregation: counts, avg R, win/loss
  9.  Verdict mapping: NEUTRAL when avg R near zero
  10. Verdict mapping: INSUFFICIENT_DATA when fewer than MIN_SIGNALS_FOR_VERDICT
  11. Gate key normalization — all known raw strings map to canonical keys
  12. Report: 0 blocked signals → "no data yet" message, no fake verdict
  13. P&L compute: long winner produces positive net P&L after fees
  14. P&L compute: short loser produces negative net P&L
  15. Slippage: conservative ceiling rounding (never fractional gifted to trader)
  16. Determinism: same inputs → same outputs (seed anchor)
  17. Gap-through-stop: bar opens past stop → filled at open (worse for trader)
  18. Time-stop detection: UTC 19:55 exits position
  19. Max hold cap: simulation ends at MAX_HOLD_BARS without infinite loop
  20. Short direction MFE tracks entry_price - bar_low correctly

NOTE ON VECTORBT
----------------
gate_block_analyzer.py does NOT import vectorbt. It imports from:
  - src.engine.exits.style_c_handler (for constants)
  - src.engine.config (for ContractSpec — indirectly via slippage)
  - src.engine.slippage (for compute_slippage)
  - src.engine.data_loader (only at runtime via load_forward_bars)

This file tests simulate_counterfactual and the aggregation layer directly using
synthetic Polars DataFrames — no vectorbt, no DB, no file I/O.
"""
from __future__ import annotations

import math
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import polars as pl
import pytest

# ─── Subject imports ──────────────────────────────────────────────────────────
# Import specific functions — do NOT import the module top-level to avoid
# any transitive vectorbt import chain.
from src.engine.gate_block_analyzer import (
    BIG_MOVE_POINTS,
    MAX_HOLD_BARS,
    MIN_SIGNALS_FOR_VERDICT,
    BlockedSignal,
    CounterfactualResult,
    GateVerdict,
    _compute_median_atr,
    _compute_pnl,
    _compute_slippage_dollars,
    _compute_verdict,
    generate_report,
    normalize_gate_key,
    run_gate_block_analysis,
    simulate_counterfactual,
)

# ─── Synthetic bar builder ────────────────────────────────────────────────────

def _make_bars(
    *,
    n: int = 30,
    open_val: float = 5000.0,
    high_val: float = 5020.0,
    low_val: float = 4990.0,
    close_val: float = 5010.0,
    atr: float = 4.0,
    with_timestamps: bool = False,
    base_ts: Optional[str] = None,
) -> pl.DataFrame:
    """Create a synthetic OHLCV DataFrame with ATR column."""
    opens = [open_val] * n
    highs = [high_val] * n
    lows = [low_val] * n
    closes = [close_val] * n
    atrs = [atr] * n
    volumes = [1000.0] * n

    data: dict = {
        "open": opens,
        "high": highs,
        "low": lows,
        "close": closes,
        "atr_14": atrs,
        "volume": volumes,
    }
    if with_timestamps:
        import datetime as _dt
        from datetime import timedelta

        base = _dt.datetime.fromisoformat(base_ts or "2026-06-24T14:00:00")
        timestamps = [(base + timedelta(minutes=5 * i)).isoformat() for i in range(n)]
        data["ts_event"] = timestamps

    return pl.DataFrame(data)


def _make_big_move_bars(
    *,
    n: int = 30,
    entry_price: float = 5000.0,
    move_pts: float = 18.0,
    atr: float = 4.0,
    with_timestamps: bool = False,
    base_ts: Optional[str] = None,
) -> pl.DataFrame:
    """Bars that produce a big favorable move to trigger TP2 (2R = 8pts at ATR=4).

    deepscan16 Wave-1 Track2 MED #24: with_timestamps (default False, opt-in)
    adds a ts_event column matching _make_signal's default created_at so
    run_gate_block_analysis's real _find_entry_bar_idx() call can locate bar 0
    the same way it does with real bar data. Without this column,
    _find_entry_bar_idx now returns -1 (INDETERMINATE) rather than the old
    fabricated "assume bar 0" fallback — end-to-end tests that go through
    run_gate_block_analysis (not simulate_counterfactual directly with an
    explicit entry_bar_idx) must opt in.
    """
    # Bar 0 is entry bar (open = entry_price)
    # Bars 1-5: high keeps rising until ≥2R is hit
    opens = [entry_price] * n
    highs = [entry_price + move_pts] * n  # sustained big move
    lows = [entry_price - 1.0] * n  # well above stop (stop = ~6pt below)
    closes = [entry_price + move_pts - 0.25] * n
    atrs = [atr] * n
    volumes = [1000.0] * n
    data: dict = {
        "open": opens,
        "high": highs,
        "low": lows,
        "close": closes,
        "atr_14": atrs,
        "volume": volumes,
    }
    if with_timestamps:
        import datetime as _dt
        from datetime import timedelta

        base = _dt.datetime.fromisoformat(base_ts or "2026-06-24T14:00:00")
        data["ts_event"] = [(base + timedelta(minutes=5 * i)).isoformat() for i in range(n)]
    return pl.DataFrame(data)


def _make_loser_bars(
    *,
    n: int = 30,
    entry_price: float = 5000.0,
    drop_pts: float = 8.0,  # more than risk_points (≤6pt) → stop hit
    atr: float = 4.0,
    with_timestamps: bool = False,
    base_ts: Optional[str] = None,
) -> pl.DataFrame:
    """Bars that produce an immediate stop-out (loser).

    deepscan16 Wave-1 Track2 MED #24: see _make_big_move_bars docstring — same
    opt-in with_timestamps contract.
    """
    opens = [entry_price] * n
    highs = [entry_price + 0.5] * n
    lows = [entry_price - drop_pts] * n  # below stop
    closes = [entry_price - drop_pts + 0.25] * n
    atrs = [atr] * n
    volumes = [1000.0] * n
    data: dict = {
        "open": opens,
        "high": highs,
        "low": lows,
        "close": closes,
        "atr_14": atrs,
        "volume": volumes,
    }
    if with_timestamps:
        import datetime as _dt
        from datetime import timedelta

        base = _dt.datetime.fromisoformat(base_ts or "2026-06-24T14:00:00")
        data["ts_event"] = [(base + timedelta(minutes=5 * i)).isoformat() for i in range(n)]
    return pl.DataFrame(data)


def _make_signal(
    *,
    symbol: str = "MES",
    direction: str = "long",
    price: float = 5000.0,
    signal_type: Optional[str] = None,
    reason: Optional[str] = "macro_blackout",
    signal_id: str = "test-signal-001",
) -> BlockedSignal:
    return BlockedSignal(
        signal_id=signal_id,
        symbol=symbol,
        direction=direction,
        price=price,
        created_at=datetime(2026, 6, 24, 14, 0, 0, tzinfo=timezone.utc),
        signal_type=signal_type,
        reason=reason,
    )


# ─── Test 1: big-move blocked → COSTING ──────────────────────────────────────

def test_counterfactual_big_move_blocked_produces_costing_verdict():
    """A blocked signal that would have been a big-move winner → COSTING verdict."""
    atr = 4.0
    entry_price = 5000.0
    # risk_points = min(6.0, 4.0 * 1.5) = 6.0
    # TP2 at 2R = 5012.0; big move threshold MES default = 14pt; MFE = 18pt → big move
    bars = _make_big_move_bars(entry_price=entry_price, move_pts=18.0, atr=atr)

    signal = _make_signal(reason="macro_blackout", price=entry_price)
    median_atr = _compute_median_atr(bars)

    result = simulate_counterfactual(
        signal=signal,
        bars=bars,
        entry_bar_idx=0,
        median_atr=median_atr,
    )

    assert not result.indeterminate, f"Should not be INDET: {result.indeterminate_reason}"
    assert result.realized_r > 0, f"Expected positive R, got {result.realized_r}"
    assert result.mfe_points >= 14.0, f"Expected MFE >= 14pt, got {result.mfe_points}"
    assert result.is_big_move, "Expected big_move=True"

    # Now aggregate into verdict
    results = [result] * 6  # 6 identical results to exceed MIN_SIGNALS_FOR_VERDICT=5
    verdict = _compute_verdict("macro_blackout", results)
    assert verdict.verdict == "COSTING", f"Expected COSTING, got {verdict.verdict}"
    assert verdict.big_move_winners_blocked >= 1


# ─── Test 2: loser blocked → SAVING ──────────────────────────────────────────

def test_counterfactual_loser_blocked_produces_saving_verdict():
    """A blocked signal that would have stopped out → SAVING verdict."""
    atr = 4.0
    entry_price = 5000.0
    bars = _make_loser_bars(entry_price=entry_price, drop_pts=8.0, atr=atr)
    median_atr = _compute_median_atr(bars)

    signal = _make_signal(reason="lunch_blackout_window", price=entry_price)
    result = simulate_counterfactual(
        signal=signal,
        bars=bars,
        entry_bar_idx=0,
        median_atr=median_atr,
    )

    assert not result.indeterminate
    assert result.realized_r < 0, f"Expected negative R (stop-out), got {result.realized_r}"
    assert result.exit_reason in ("stop_loss", "trailing_stop")
    assert not result.is_big_move

    # Aggregate into verdict (6 identical losers)
    results = [result] * 6
    verdict = _compute_verdict("lunch_blackout", results)
    assert verdict.verdict == "SAVING", f"Expected SAVING, got {verdict.verdict}"
    assert verdict.losers_correctly_blocked >= 1


# ─── Test 3: big-move threshold boundary ─────────────────────────────────────

def test_big_move_threshold_boundary():
    """MFE just below threshold → not big move; at/above threshold → big move."""
    threshold_mes = BIG_MOVE_POINTS.get("MES", 14.0)
    atr = 4.0
    entry_price = 5000.0
    median_atr = atr

    def _run_with_mfe(mfe_pts: float) -> CounterfactualResult:
        bars = _make_big_move_bars(entry_price=entry_price, move_pts=mfe_pts, atr=atr)
        signal = _make_signal(reason="macro_blackout")
        return simulate_counterfactual(
            signal=signal, bars=bars, entry_bar_idx=0, median_atr=median_atr,
        )

    # Just below threshold (move stops short of TP2 at 2R=8pt, so exit may be trailing)
    # Pre-existing: this call's result is unused (kept for the exercised code path /
    # future assertion); prefixed to silence ruff F841 without changing test behavior.
    _result_below = _run_with_mfe(threshold_mes - 0.5)
    # MFE may still be below threshold if bars don't reach far enough
    # is_big_move is False when MFE < threshold AND MFE < BIG_MOVE_MIN_R * risk_points
    # risk_points = 6.0; BIG_MOVE_MIN_R * 6 = 12.0; threshold=14
    # Move = 13.5 → MFE = 13.5 which is >= 12.0 (BIG_MOVE_MIN_R * risk) but < 14
    # So is_big_move depends on whether MFE >= risk*MIN_R
    # 13.5 >= 6*2=12 → True → big move by R-multiple
    # Let's test a clearly-below case: 10pt (below both threshold and 2R*risk)
    result_below2 = _run_with_mfe(9.0)  # 9pt < 12pt (2R*6) AND < 14pt → not big move

    assert not result_below2.is_big_move, (
        f"9pt MFE should not be big move (threshold={threshold_mes}, 2R*risk=12): "
        f"mfe={result_below2.mfe_points}"
    )

    result_at = _run_with_mfe(threshold_mes + 0.1)
    assert result_at.is_big_move, (
        f"MFE at {threshold_mes + 0.1}pt should be big move: mfe={result_at.mfe_points}"
    )


# ─── Test 4: big-move by R-multiple ──────────────────────────────────────────

def test_big_move_qualified_by_r_multiple():
    """MFE below point threshold but ≥ BIG_MOVE_MIN_R × risk_points → is_big_move."""
    # risk_points = min(6, 2*1.5) = 3.0 with ATR=2
    # BIG_MOVE_MIN_R = 2.0 → big-move threshold by R = 6pt
    # BIG_MOVE_POINTS["MES"] = 14 → point threshold is 14pt
    # MFE = 7pt: above 6pt R-threshold but below 14pt point threshold → big move by R
    atr = 2.0  # risk_points = min(6, 3.0) = 3.0; 2R*3 = 6pt R-threshold
    entry_price = 5000.0
    bars = _make_big_move_bars(entry_price=entry_price, move_pts=7.0, atr=atr)
    signal = _make_signal(reason="macro_blackout")
    result = simulate_counterfactual(
        signal=signal,
        bars=bars,
        entry_bar_idx=0,
        median_atr=atr,
    )
    # MFE >= 6pt (2R threshold) even though < 14pt (point threshold) → big move
    assert result.is_big_move, (
        f"MFE={result.mfe_points:.2f} with risk=3pt should be big move by R-multiple"
    )


# ─── Test 5: INDETERMINATE on out-of-bounds entry bar ────────────────────────

def test_indeterminate_on_out_of_bounds_entry_bar():
    """Entry bar index beyond DataFrame length → INDETERMINATE."""
    bars = _make_bars(n=5)
    signal = _make_signal()
    result = simulate_counterfactual(
        signal=signal, bars=bars, entry_bar_idx=10, median_atr=4.0,
    )
    assert result.indeterminate, "Should be INDETERMINATE when entry_bar_idx >= len(bars)"
    assert math.isnan(result.realized_r)


# ─── Test 6: INDETERMINATE on no forward bars ────────────────────────────────

def test_indeterminate_on_no_forward_bars():
    """Entry bar is last bar — no forward bars to simulate → INDETERMINATE."""
    bars = _make_bars(n=2)
    signal = _make_signal()
    result = simulate_counterfactual(
        signal=signal, bars=bars, entry_bar_idx=1, median_atr=4.0,
    )
    # entry_bar_idx=1, len=2 → entry_bar_idx + 1 = 2 >= len(bars) → INDET
    assert result.indeterminate, "Should be INDET when no forward bars after entry"


# ─── Test 7: INDETERMINATE on NaN bar data ───────────────────────────────────

def test_indeterminate_on_nan_bar_data():
    """NaN in high/low during simulation window → INDETERMINATE."""
    # Create bars with NaN in bar 2 (first simulation bar)
    highs = [5020.0, float("nan"), 5015.0] + [5010.0] * 10
    lows = [4990.0, float("nan"), 4995.0] + [4990.0] * 10
    n = len(highs)
    bars = pl.DataFrame({
        "open": [5000.0] * n,
        "high": highs,
        "low": lows,
        "close": [5005.0] * n,
        "atr_14": [4.0] * n,
        "volume": [1000.0] * n,
    })
    signal = _make_signal()
    result = simulate_counterfactual(
        signal=signal, bars=bars, entry_bar_idx=0, median_atr=4.0,
    )
    assert result.indeterminate, "Should be INDET when NaN bar in simulation window"


# ─── Test 8: per-gate aggregation ────────────────────────────────────────────

def test_per_gate_aggregation_counts():
    """Aggregation counts win/loss/indet correctly."""
    # 3 winners, 2 losers, 1 INDET
    def _make_result(r: float, indet: bool = False) -> CounterfactualResult:
        return CounterfactualResult(
            signal_id="x",
            gate_key="macro_blackout",
            symbol="MES",
            direction="long",
            entry_price=5000.0,
            exit_price=5010.0 if r > 0 else 4994.0,
            exit_reason="take_profit" if r > 0 else "stop_loss",
            realized_r=r,
            net_pnl_dollars=r * 30.0,
            mfe_points=abs(r) * 6.0,
            is_big_move=(abs(r) * 6.0 >= BIG_MOVE_POINTS.get("MES", 14.0)),
            indeterminate=indet,
            indeterminate_reason="test" if indet else "",
        )

    results = [
        _make_result(2.0),   # winner
        _make_result(1.5),   # winner
        _make_result(3.0),   # winner
        _make_result(-1.0),  # loser
        _make_result(-0.5),  # loser
        _make_result(0.0, indet=True),  # INDET
    ]

    verdict = _compute_verdict("macro_blackout", results)
    assert verdict.blocked_count == 6
    assert verdict.evaluated_count == 5  # excludes INDET
    assert verdict.indeterminate_count == 1
    assert verdict.win_count == 3
    assert verdict.loss_count == 2
    assert abs(verdict.avg_r - ((2.0 + 1.5 + 3.0 - 1.0 - 0.5) / 5)) < 0.01


# ─── Test 9: NEUTRAL verdict ─────────────────────────────────────────────────

def test_neutral_verdict_near_zero_avg_r():
    """avg R within NEUTRAL_BAND → NEUTRAL verdict."""
    def _result(r: float) -> CounterfactualResult:
        return CounterfactualResult(
            signal_id="x", gate_key="context_gate_skip", symbol="MES",
            direction="long", entry_price=5000.0, exit_price=5000.0,
            exit_reason="signal", realized_r=r, net_pnl_dollars=r * 5.0,
            mfe_points=1.0, is_big_move=False,
        )

    # avg R = (0.05 + 0.02 + -0.03 + -0.01 + 0.02 + -0.04) / 6 ≈ 0.0017 → NEUTRAL
    results = [_result(x) for x in [0.05, 0.02, -0.03, -0.01, 0.02, -0.04]]
    verdict = _compute_verdict("context_gate_skip", results)
    assert verdict.verdict == "NEUTRAL", f"Expected NEUTRAL, got {verdict.verdict}"


# ─── Test 10: INSUFFICIENT_DATA verdict ──────────────────────────────────────

def test_insufficient_data_verdict():
    """Fewer than MIN_SIGNALS_FOR_VERDICT evaluable → INSUFFICIENT_DATA."""
    def _result(r: float) -> CounterfactualResult:
        return CounterfactualResult(
            signal_id="x", gate_key="dll_halt", symbol="MES",
            direction="long", entry_price=5000.0, exit_price=5010.0,
            exit_reason="take_profit", realized_r=r, net_pnl_dollars=30.0,
            mfe_points=5.0, is_big_move=False,
        )

    # Only MIN_SIGNALS_FOR_VERDICT - 1 signals
    results = [_result(1.0)] * (MIN_SIGNALS_FOR_VERDICT - 1)
    verdict = _compute_verdict("dll_halt", results)
    assert verdict.verdict == "INSUFFICIENT_DATA"


# ─── Test 11: gate key normalization ─────────────────────────────────────────

@pytest.mark.parametrize("signal_type,reason,expected", [
    (None, "macro_blackout", "macro_blackout"),
    (None, "macroBlackout event", "macro_blackout"),
    (None, "lunch_blackout_window", "lunch_blackout"),
    (None, "signal.weighted_score_rejected", "weighted_score_rejected"),
    (None, "daily_trade_cap_reached", "daily_trade_cap"),
    ("dll_halt_blocks", None, "dll_halt"),
    ("dll_halt_sticky", None, "dll_halt"),
    ("cross_symbol_dll_halts", None, "dll_halt"),
    (None, "cross_account_hedge_active", "cross_account_hedge"),
    (None, "intra_account_hedge_block", "intra_account_hedge"),
    (None, "context_gate_skip_no_context", "context_gate_skip"),
    (None, None, "unknown"),
])
def test_gate_key_normalization(signal_type, reason, expected):
    gate_key = normalize_gate_key(signal_type, reason)
    assert gate_key == expected, f"Expected '{expected}', got '{gate_key}'"


# ─── Test 12: 0 blocked signals → honest no-data report ─────────────────────

def test_zero_blocked_signals_report(tmp_path):
    """0 blocked signals → report says 'no data yet', no fake verdict."""
    report_path = generate_report(
        verdicts=[],
        output_path=tmp_path / "empty.md",
        report_name="test-empty",
        since_iso=None,
        total_blocked=0,
        total_indeterminate=0,
    )
    content = Path(report_path).read_text(encoding="utf-8")
    assert "No Data Yet" in content or "no blocked-signal data" in content.lower()
    assert "COSTING" not in content
    assert "SAVING" not in content


def test_run_analysis_with_zero_signals_does_not_crash(tmp_path):
    """run_gate_block_analysis with injected empty signal list → clean exit."""
    result = run_gate_block_analysis(
        report_name="test-zero",
        output_dir=tmp_path,
        signals=[],  # inject empty — bypass DB
    )
    assert result["total_blocked"] == 0
    assert result["verdicts"] == []
    report_content = Path(result["report_path"]).read_text(encoding="utf-8")
    assert "no blocked-signal data" in report_content.lower() or "No Data Yet" in report_content


# ─── Test 13: P&L compute — long winner ──────────────────────────────────────

def test_pnl_long_winner_positive():
    """Long winner: exit > entry → positive net P&L after fees."""
    # MES: point_value=5.0, tick_value=1.25, commission=0.62/side
    net = _compute_pnl(
        direction="long",
        entry_price=5000.0,
        exit_price=5012.0,  # +12pt
        point_value=5.0,
        slippage_dollars_entry=1.25,  # 1 tick
        slippage_dollars_exit=1.25,
        commission_per_side=0.62,
        contracts=1,
    )
    # Gross: 12 * 5.0 = $60
    # Fees: 1.25 + 1.25 + 0.62*2 = $3.74
    # Net: $56.26
    assert net > 0, f"Long winner should have positive P&L, got {net}"
    assert abs(net - (60.0 - 2.50 - 1.24)) < 0.05, f"Unexpected net P&L: {net}"


# ─── Test 14: P&L compute — short loser ──────────────────────────────────────

def test_pnl_short_loser_negative():
    """Short loser: exit > entry (price went up against short) → negative P&L."""
    net = _compute_pnl(
        direction="short",
        entry_price=5000.0,
        exit_price=5008.0,  # price rose 8pt — adverse for short
        point_value=5.0,
        slippage_dollars_entry=1.25,
        slippage_dollars_exit=1.25,
        commission_per_side=0.62,
        contracts=1,
    )
    # Gross: -1 * 8 * 5.0 = -$40
    assert net < 0, f"Short loser should have negative P&L, got {net}"


# ─── Test 15: slippage ceiling rounding ──────────────────────────────────────

def test_slippage_ceiling_rounding():
    """Slippage uses ceiling rounding (conservative) — never fractional gifted back."""
    # base_ticks=1.0, atr=4.0, median_atr=3.0 → raw_ticks = 1*(4/3) = 1.333 → ceil = 2
    slippage = _compute_slippage_dollars(atr=4.0, median_atr=3.0, symbol="MES", base_ticks=1.0)
    # Expected: ceil(1.333) = 2 ticks × 1.25 tick_value = $2.50
    assert slippage == pytest.approx(2.50, abs=0.01), f"Expected $2.50, got {slippage}"


def test_slippage_exact_integer_ticks_unchanged():
    """When ATR == median_ATR, raw_ticks = 1.0 → ceil = 1 → no inflation."""
    slippage = _compute_slippage_dollars(atr=4.0, median_atr=4.0, symbol="MES", base_ticks=1.0)
    assert slippage == pytest.approx(1.25, abs=0.01), f"Expected $1.25 (1 tick), got {slippage}"


# ─── Test 16: determinism (same inputs → same outputs) ───────────────────────

def test_determinism_same_inputs_same_outputs():
    """Identical inputs produce identical outputs (seed=42, no RNG in hot path)."""
    bars = _make_big_move_bars(entry_price=5000.0, move_pts=18.0, atr=4.0)
    signal = _make_signal(reason="macro_blackout")
    median_atr = _compute_median_atr(bars)

    results = [
        simulate_counterfactual(signal=signal, bars=bars, entry_bar_idx=0, median_atr=median_atr)
        for _ in range(3)
    ]

    for r in results[1:]:
        assert r.realized_r == results[0].realized_r
        assert r.exit_price == results[0].exit_price
        assert r.exit_reason == results[0].exit_reason
        assert r.mfe_points == results[0].mfe_points


# ─── Test 17: gap-through-stop filled at open ────────────────────────────────

def test_gap_through_stop_filled_at_open():
    """Bar opens below stop (gap-down) → fill at open (worse for trader)."""
    entry_price = 5000.0
    atr = 4.0
    # risk_points = min(6.0, 4.0 * 1.5) = 6.0
    # initial_stop = 5000 - 6.0 = 4994.0
    # Bar 1: open = 4991 (below stop), low = 4990, high = 5001 → gap fill at 4991

    bars = pl.DataFrame({
        "open": [entry_price, 4991.0, 5000.0] + [5000.0] * 10,
        "high": [entry_price + 5, 5001.0, 5010.0] + [5010.0] * 10,
        "low": [entry_price - 1, 4990.0, 4995.0] + [4995.0] * 10,
        "close": [entry_price, 4995.0, 5005.0] + [5005.0] * 10,
        "atr_14": [atr] * 13,
        "volume": [1000.0] * 13,
    })

    signal = _make_signal(direction="long", reason="macro_blackout")
    result = simulate_counterfactual(
        signal=signal, bars=bars, entry_bar_idx=0, median_atr=atr,
    )

    assert not result.indeterminate
    # Gap-down fill: exit at 4991 (the open), not at 4994 (the stop)
    assert result.exit_price == pytest.approx(4991.0, abs=0.01), (
        f"Gap fill should be at bar_open (4991), got {result.exit_price}"
    )
    assert result.exit_reason in ("stop_loss", "trailing_stop")
    assert result.realized_r < 0  # loss


# ─── Test 18: time-stop detection ────────────────────────────────────────────

def test_time_stop_exits_at_1955_utc():
    """Bar timestamp at 19:55 UTC (≈ 15:55 ET) triggers time-stop flatten."""
    entry_price = 5000.0
    atr = 4.0
    # Bar 0: signal time; bar 1: 19:55 UTC time-stop bar
    timestamps = [
        "2026-06-24T14:00:00",  # bar 0 — entry
        "2026-06-24T19:55:00",  # bar 1 — 19:55 UTC = 15:55 ET → time-stop
        "2026-06-24T20:00:00",  # bar 2 — should not be reached
    ]
    bars = pl.DataFrame({
        "open": [entry_price, entry_price + 3, entry_price + 10],
        "high": [entry_price + 2, entry_price + 5, entry_price + 15],
        "low": [entry_price - 1, entry_price + 1, entry_price + 5],
        "close": [entry_price + 1, entry_price + 4, entry_price + 12],
        "atr_14": [atr] * 3,
        "volume": [1000.0] * 3,
        "ts_event": timestamps,
    })

    signal = _make_signal(reason="macro_blackout")
    result = simulate_counterfactual(
        signal=signal, bars=bars, entry_bar_idx=0, median_atr=atr,
    )

    assert not result.indeterminate
    assert result.exit_reason == "time_stop", (
        f"Expected time_stop exit, got {result.exit_reason}"
    )


# ─── Test 19: max hold cap ────────────────────────────────────────────────────

def test_max_hold_cap_terminates_simulation():
    """Simulation ends at MAX_HOLD_BARS even when no stop/TP hit.

    Scenario: price oscillates between entry-0.5 and entry+0.5 — never reaching
    stop (entry-6pt) or TP2 (entry+2R). After 1R the trailing stop advances to
    BE, but since price never exceeds 1R the stop stays at initial_stop throughout,
    and the position must close at max_hold via the close price.

    Key: keep high < entry + risk_points (no 1R crossing), so the trail never moves.
    risk_points = min(6.0, atr * 1.5). With atr=2.0: risk_points = 3.0.
    So highs must stay below entry + 3.0 AND lows must stay above entry - 3.0.
    """
    n = MAX_HOLD_BARS + 50
    entry_price = 5000.0
    atr = 2.0
    # risk_points = min(6.0, 2.0*1.5) = 3.0
    # Stop = entry - 3.0 = 4997.0; TP2 = entry + 6.0 = 5006.0
    # Bars: oscillate tightly around entry — never hit stop or TP2
    bars = pl.DataFrame({
        "open": [entry_price] * n,
        "high": [entry_price + 1.0] * n,   # < TP1 (entry+3) → no trail
        "low": [entry_price - 1.0] * n,    # > stop (entry-3) → no stop hit
        "close": [entry_price] * n,
        "atr_14": [atr] * n,
        "volume": [1000.0] * n,
    })

    signal = _make_signal(reason="dll_halt")
    result = simulate_counterfactual(
        signal=signal, bars=bars, entry_bar_idx=0, median_atr=atr,
    )

    # Should exit at max_hold (never hits stop or TP within MAX_HOLD_BARS)
    assert not result.indeterminate, f"INDET: {result.indeterminate_reason}"
    assert result.exit_reason == "max_hold", (
        f"Expected max_hold exit, got {result.exit_reason}"
    )


# ─── Test 20: short direction MFE ────────────────────────────────────────────

def test_short_direction_mfe_tracks_entry_minus_low():
    """Short MFE = entry_price - bar_low (move in favor of short)."""
    entry_price = 5000.0
    atr = 4.0
    drop_pts = 18.0  # favorable for short

    # Bars: lows drop well below entry; highs stay above stop (entry + 6)
    bars = pl.DataFrame({
        "open": [entry_price] * 5,
        "high": [entry_price + 1.0] * 5,  # never hits stop (entry + 6)
        "low": [entry_price - drop_pts] * 5,  # TP2 at entry - 2R = entry - 8
        "close": [entry_price - drop_pts + 0.5] * 5,
        "atr_14": [atr] * 5,
        "volume": [1000.0] * 5,
    })

    signal = _make_signal(direction="short", reason="macro_blackout")
    result = simulate_counterfactual(
        signal=signal, bars=bars, entry_bar_idx=0, median_atr=atr,
    )

    assert not result.indeterminate
    # MFE for short = max(entry - bar_low) = 18pt
    assert result.mfe_points >= drop_pts - 1.0, (
        f"Short MFE should track favorable downward move, got {result.mfe_points}"
    )
    assert result.realized_r > 0, "Short winner should have positive R"
    assert result.is_big_move, "18pt drop should be a big move for MES"


# ─── Test 21: full run with injected signals and mock data loader ─────────────

def test_full_run_with_injected_signals_and_data_loader(tmp_path):
    """End-to-end run_gate_block_analysis with injected signals and data loader."""
    entry_price = 5000.0
    atr = 4.0

    signals = [
        _make_signal(
            signal_id=f"sig-{i:03d}",
            reason="macro_blackout",
            price=entry_price,
        )
        for i in range(6)  # 6 signals to exceed MIN_SIGNALS_FOR_VERDICT
    ]

    # Mock data loader that returns big-move bars.
    # deepscan16 Wave-1 Track2 MED #24: with_timestamps=True is now required —
    # _find_entry_bar_idx() no longer fabricates "assume bar 0" when ts_event is
    # absent (fixed to return -1 / INDETERMINATE per its documented contract).
    # base_ts matches _make_signal's default created_at (2026-06-24T14:00:00 UTC)
    # so the real bar-lookup logic locates bar 0 the same way it would on real data.
    def _mock_loader(**kwargs):
        return _make_big_move_bars(
            entry_price=entry_price, move_pts=18.0, atr=atr,
            with_timestamps=True, base_ts="2026-06-24T14:00:00",
        )

    result = run_gate_block_analysis(
        report_name="test-full-run",
        output_dir=tmp_path,
        signals=signals,
        data_loader_fn=_mock_loader,
    )

    assert result["total_blocked"] == 6
    assert len(result["verdicts"]) > 0

    verdict = next((v for v in result["verdicts"] if v.gate_key == "macro_blackout"), None)
    assert verdict is not None
    assert verdict.verdict in ("COSTING", "INSUFFICIENT_DATA", "NEUTRAL")
    # With 6 big-move winners: should be COSTING
    assert verdict.verdict == "COSTING", f"6 big-move winners should be COSTING, got {verdict.verdict}"

    # Report file was written
    report_path = Path(result["report_path"])
    assert report_path.exists()
    content = report_path.read_text(encoding="utf-8")
    assert "macro_blackout" in content
    assert "COSTING" in content


# ─── Test 22: mixed gate types in single run ─────────────────────────────────

def test_mixed_gate_types_produce_separate_verdicts(tmp_path):
    """Multiple gate types → separate verdicts per gate."""
    entry_price = 5000.0
    atr = 4.0

    big_move_signals = [
        _make_signal(signal_id=f"bm-{i}", reason="macro_blackout")
        for i in range(6)
    ]
    loser_signals = [
        _make_signal(signal_id=f"lo-{i}", reason="lunch_blackout_window")
        for i in range(6)
    ]

    call_count = {"n": 0}

    # deepscan16 Wave-1 Track2 MED #24: with_timestamps=True required — see
    # test_full_run_with_injected_signals_and_data_loader for the full rationale.
    def _mock_loader(**kwargs):
        # Determine which signal is being processed by call order
        n = call_count["n"]
        call_count["n"] += 1
        if n < 6:
            return _make_big_move_bars(
                entry_price=entry_price, move_pts=18.0, atr=atr,
                with_timestamps=True, base_ts="2026-06-24T14:00:00",
            )
        else:
            return _make_loser_bars(
                entry_price=entry_price, drop_pts=8.0, atr=atr,
                with_timestamps=True, base_ts="2026-06-24T14:00:00",
            )

    result = run_gate_block_analysis(
        report_name="test-mixed-gates",
        output_dir=tmp_path,
        signals=big_move_signals + loser_signals,
        data_loader_fn=_mock_loader,
    )

    gate_keys = {v.gate_key for v in result["verdicts"]}
    assert "macro_blackout" in gate_keys
    assert "lunch_blackout" in gate_keys


# ─── Test 23: report structure when verdicts exist ───────────────────────────

def test_report_structure_with_verdicts(tmp_path):
    """Report contains verdict table and plain-English summary."""
    verdicts = [
        GateVerdict(
            gate_key="macro_blackout",
            blocked_count=10,
            evaluated_count=8,
            indeterminate_count=2,
            total_net_pnl=250.0,
            win_count=6,
            loss_count=2,
            avg_r=1.5,
            big_move_winners_blocked=3,
            losers_correctly_blocked=2,
            verdict="COSTING",
            recommendation="[COSTING] Gate blocked 3 big-move winners...",
        )
    ]
    path = generate_report(
        verdicts=verdicts,
        output_path=tmp_path / "test-report.md",
        report_name="test-report",
        since_iso="2026-06-01T00:00:00Z",
        total_blocked=10,
        total_indeterminate=2,
    )
    content = Path(path).read_text(encoding="utf-8")
    assert "macro_blackout" in content
    assert "COSTING" in content
    assert "Plain-English Summary" in content
    assert "big-move" in content.lower() or "big move" in content.lower()


# ─── Test 24: BlockedSignal gate_key is set via __post_init__ ────────────────

def test_blocked_signal_gate_key_auto_set():
    sig = BlockedSignal(
        signal_id="abc",
        symbol="MNQ",
        direction="long",
        price=20000.0,
        created_at=datetime.now(timezone.utc),
        signal_type=None,
        reason="lunch_blackout_window",
    )
    assert sig.gate_key == "lunch_blackout"


# ─── Test 25: compute_median_atr handles empty / all-null gracefully ──────────

def test_compute_median_atr_handles_empty_df():
    bars = pl.DataFrame({"open": [5000.0], "high": [5010.0], "low": [4990.0], "close": [5005.0]})
    median = _compute_median_atr(bars)
    assert math.isnan(median), "No atr_14 column should return NaN"


def test_compute_median_atr_computes_correctly():
    bars = pl.DataFrame({
        "atr_14": [2.0, 4.0, 6.0, 8.0, 10.0]
    })
    median = _compute_median_atr(bars)
    assert median == pytest.approx(6.0, abs=0.01)
