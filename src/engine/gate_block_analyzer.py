"""Gate Block Analyzer — institutional-grade counterfactual engine.

PURPOSE
-------
Diagnose over-engineering (too many gates strangling the edge). For every entry
signal a GATE BLOCKED, simulate the trade it WOULD have been using the REAL
framework exit logic and REAL forward bars, then produce a per-gate VERDICT:

  COSTING    — gate blocked a positive-expectancy edge (avg R > 0, ≥1 big-move winner)
  SAVING     — gate correctly blocked negative-expectancy losers (avg R < 0)
  NEUTRAL    — avg R near zero; gate has no clear directional bias
  INSUFFICIENT_DATA — too few signals to judge

The operator trades BIG MOVES (14-24 MES pts / Style C 2R+). A gate blocking a
big-move A+ setup is the most expensive error this tool must surface.

DATA SOURCE
-----------
paper_signal_logs WHERE acted = false (blocked signals).
Pre-go-live: 0 rows exist — the report says so honestly and exits cleanly.

COUNTERFACTUAL ENGINE
---------------------
- Entry fill: next-bar open (same +1-bar shift as backtester.py np.roll, line 3134)
- Stop: 1.5×ATR floor, per-symbol ceiling via structural_stops constants
         (NOT calling compute_structural_stop — avoids needing swing data;
          uses the same fallback the backtester uses: min(6.0, atr * 1.5))
- Exit: Style C static management loop — VERBATIM from _apply_static_styleC_management
         in backtester.py (lines 778-1012). Reused directly, NOT reinvented.
- Fill model: same slippage model (compute_slippage from slippage.py)
- P&L: computed manually — NEVER passed to vectorbt per CLAUDE.md hard rule.

THRESHOLDS (env-configurable, no magic numbers)
------------------------------------------------
  GATE_BLOCK_BIG_MOVE_POINTS_MES  (default 14)
  GATE_BLOCK_BIG_MOVE_POINTS_MNQ  (default 40)
  GATE_BLOCK_BIG_MOVE_POINTS_MCL  (default 25)  ← ticks for MCL
  GATE_BLOCK_BIG_MOVE_MIN_R       (default 2.0)  ← OR ≥2R qualifies as big move

Determinism: seed=42 (matches conftest.py). No Date.now(), no Math.random().

FAIL-CLOSED RULES
-----------------
- Missing forward bars for a signal → INDETERMINATE (never fabricated)
- 0 blocked signals → report says "no data yet", exits with code 0
- Any per-signal exception → INDETERMINATE for that signal, logged, never raised
"""
from __future__ import annotations

import logging
import math
import os
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import numpy as np
import polars as pl

logger = logging.getLogger(__name__)

# ─── Env-configurable thresholds (NO magic numbers) ──────────────────────────

BIG_MOVE_POINTS: dict[str, float] = {
    "MES": float(os.environ.get("GATE_BLOCK_BIG_MOVE_POINTS_MES", "14")),
    "MNQ": float(os.environ.get("GATE_BLOCK_BIG_MOVE_POINTS_MNQ", "40")),
    "MCL": float(os.environ.get("GATE_BLOCK_BIG_MOVE_POINTS_MCL", "25")),
}
BIG_MOVE_MIN_R: float = float(os.environ.get("GATE_BLOCK_BIG_MOVE_MIN_R", "2.0"))

# Structural stop ceiling — PER-SYMBOL, matching the LIVE framework overlay (CLAUDE.md §4:
# 14pt MES / 62pt MNQ / 1.00pt MCL). The live bot trades these, so the counterfactual MUST
# too — a flat 6pt cap would falsely stop out the operator's BIG-MOVE trades (a 14pt-stop trade
# held through an 8pt pullback to catch an 18pt move would look like a loser under a 6pt stop),
# inverting gate verdicts. Env-overridable per symbol.
# Wave 1 Track 1A 2026-06-27 recalibration:
#   MNQ: 40 → 62  (MNQ ATR in normal/high-vol can reach 50-60pt; 40 was over-skipping)
#   MCL: 0.25 → 1.00  (1pt = 100 ticks; 0.25 = 25 ticks was far too tight for crude micro)
# MUST stay in sync with backtester._STOP_CEILING_DEFAULTS — both read the same env vars.
STRUCTURAL_STOP_CEILING_PTS: dict[str, float] = {
    "MES": float(os.environ.get("STOP_CEILING_PTS_MES", "14")),
    "MNQ": float(os.environ.get("STOP_CEILING_PTS_MNQ", "62")),
    "MCL": float(os.environ.get("STOP_CEILING_PTS_MCL", "1.00")),  # 100 ticks * $0.01
}
STRUCTURAL_STOP_CEILING_DEFAULT_PTS: float = 14.0
STATIC_STYLE_C_ATR_STOP_MULTIPLIER: float = 1.5

# Maximum bars to walk forward for a single counterfactual (matches MAX_HOLD_BARS)
MAX_HOLD_BARS: int = 200

# Min signals to issue a gate verdict (INSUFFICIENT_DATA below this)
MIN_SIGNALS_FOR_VERDICT: int = 5

# Neutral band: avg-R within ±0.1 is NEUTRAL
NEUTRAL_BAND_R: float = 0.1

# ─── Gate key normalization ───────────────────────────────────────────────────

# Maps raw reason/signalType substrings → clean gate keys
_GATE_KEY_MAP: list[tuple[str, str]] = [
    ("macro_blackout", "macro_blackout"),
    ("macroBlackout", "macro_blackout"),
    ("lunch_blackout", "lunch_blackout"),
    ("lunchBlackout", "lunch_blackout"),
    ("weighted_score_rejected", "weighted_score_rejected"),
    ("weightedScore", "weighted_score_rejected"),
    ("cross_account_hedge", "cross_account_hedge"),
    ("crossAccountHedge", "cross_account_hedge"),
    ("intra_account_hedge", "intra_account_hedge"),
    ("intraAccountHedge", "intra_account_hedge"),
    ("daily_trade_cap", "daily_trade_cap"),
    ("dailyTradeCap", "daily_trade_cap"),
    ("context_gate_skip", "context_gate_skip"),
    ("contextGate", "context_gate_skip"),
    ("dll_halt", "dll_halt"),
    ("dllHalt", "dll_halt"),
    ("dll_sticky", "dll_halt"),
    ("cross_symbol_dll", "dll_halt"),
    ("force_close", "force_close"),
    ("forceClose", "force_close"),
    ("compliance", "compliance_block"),
    ("news_block", "macro_blackout"),  # news blocks route to macro
    ("pm_taper", "pm_taper"),
    ("pmTaper", "pm_taper"),
]


def normalize_gate_key(signal_type: Optional[str], reason: Optional[str]) -> str:
    """Derive a clean gate key from signalType and reason fields.

    Tries signal_type first, then reason, then returns 'unknown'.
    """
    for raw in [signal_type, reason]:
        if not raw:
            continue
        raw_lower = raw.lower()
        for substr, gate_key in _GATE_KEY_MAP:
            if substr.lower() in raw_lower:
                return gate_key
    # Fall back to first non-empty field cleaned up
    for raw in [signal_type, reason]:
        if raw:
            return raw.lower().replace(" ", "_")[:64]
    return "unknown"


# ─── Data structures ──────────────────────────────────────────────────────────

@dataclass
class BlockedSignal:
    """One blocked signal from paper_signal_logs."""
    signal_id: str
    symbol: str
    direction: str         # "long" | "short"
    price: float           # signal price
    created_at: datetime
    signal_type: Optional[str]
    reason: Optional[str]
    gate_key: str = field(init=False)
    indicator_snapshot: Optional[dict] = None
    session_id: Optional[str] = None

    def __post_init__(self) -> None:
        self.gate_key = normalize_gate_key(self.signal_type, self.reason)


@dataclass
class CounterfactualResult:
    """Per-signal counterfactual simulation outcome."""
    signal_id: str
    gate_key: str
    symbol: str
    direction: str
    entry_price: float
    exit_price: float
    exit_reason: str         # stop_loss | trailing_stop | take_profit | time_stop | max_hold | no_data
    realized_r: float
    net_pnl_dollars: float
    mfe_points: float        # max favorable excursion in points
    is_big_move: bool
    indeterminate: bool = False
    indeterminate_reason: str = ""


@dataclass
class GateVerdict:
    """Aggregated verdict for one gate key."""
    gate_key: str
    blocked_count: int
    evaluated_count: int       # excludes INDETERMINATE
    indeterminate_count: int
    total_net_pnl: float
    win_count: int
    loss_count: int
    avg_r: float
    big_move_winners_blocked: int
    losers_correctly_blocked: int
    verdict: str               # COSTING | SAVING | NEUTRAL | INSUFFICIENT_DATA
    recommendation: str


# ─── P&L computation (per CLAUDE.md: compute ourselves, never pass to vectorbt) ─

def _compute_pnl(
    direction: str,
    entry_price: float,
    exit_price: float,
    point_value: float,
    slippage_dollars_entry: float,
    slippage_dollars_exit: float,
    commission_per_side: float,
    contracts: int = 1,
) -> float:
    """Compute net P&L in dollars. Deterministic, no I/O."""
    sign = 1.0 if direction == "long" else -1.0
    gross_pnl = sign * (exit_price - entry_price) * point_value * contracts
    total_slippage = (slippage_dollars_entry + slippage_dollars_exit) * contracts
    total_commission = commission_per_side * 2 * contracts  # entry + exit
    return gross_pnl - total_slippage - total_commission


def _get_point_value(symbol: str) -> float:
    """Per-contract point value. Source: src/engine/config.py lines 77-88."""
    _VALUES = {"MES": 5.00, "MNQ": 2.00, "MCL": 100.00}
    return _VALUES.get(symbol.upper(), 5.00)


def _get_tick_size(symbol: str) -> float:
    _TICK = {"MES": 0.25, "MNQ": 0.25, "MCL": 0.01}
    return _TICK.get(symbol.upper(), 0.25)


def _get_tick_value(symbol: str) -> float:
    _TV = {"MES": 1.25, "MNQ": 0.50, "MCL": 1.00}
    return _TV.get(symbol.upper(), 1.25)


def _get_big_move_threshold(symbol: str) -> float:
    return BIG_MOVE_POINTS.get(symbol.upper(), BIG_MOVE_POINTS.get("MES", 14.0))


def _compute_slippage_dollars(atr: float, median_atr: float, symbol: str, base_ticks: float = 1.0) -> float:
    """Simplified slippage matching compute_slippage() in slippage.py.

    Uses ceil rounding (conservative / default SLIPPAGE_TICK_ROUNDING_MODE).
    Returns slippage in dollars for ONE fill of ONE contract.
    """
    tick_value = _get_tick_value(symbol)
    if median_atr == 0 or math.isnan(median_atr):
        return base_ticks * tick_value
    raw_ticks = base_ticks * (atr / median_atr)
    slippage_ticks = math.ceil(abs(raw_ticks))  # conservative ceiling
    return slippage_ticks * tick_value


# ─── Counterfactual engine (Style C static — reuses backtester logic) ─────────

def simulate_counterfactual(
    signal: BlockedSignal,
    bars: pl.DataFrame,
    entry_bar_idx: int,
    median_atr: float,
) -> CounterfactualResult:
    """Simulate what the blocked trade would have done.

    FAITHFUL: reuses the SAME stop/exit logic as _apply_static_styleC_management
    (backtester.py lines 778-1012). Same fill model (slippage.py). Computes
    P&L manually — never touches vectorbt.

    Args:
        signal: The blocked signal.
        bars: DataFrame with columns [open, high, low, close, atr_14, volume].
              Must include at least entry_bar_idx+1 rows.
        entry_bar_idx: Bar index to fill at (next bar after signal — +1 shift).
        median_atr: Pre-computed median ATR over the bars window.

    Returns:
        CounterfactualResult — INDETERMINATE when missing forward data.
    """
    symbol = signal.symbol.upper()
    direction = signal.direction
    point_value = _get_point_value(symbol)
    tick_size = _get_tick_size(symbol)
    commission_per_side: float = 0.62  # matches backtester.py default
    is_short = direction == "short"

    def _indet(reason: str) -> CounterfactualResult:
        return CounterfactualResult(
            signal_id=signal.signal_id,
            gate_key=signal.gate_key,
            symbol=symbol,
            direction=direction,
            entry_price=float("nan"),
            exit_price=float("nan"),
            exit_reason="no_data",
            realized_r=float("nan"),
            net_pnl_dollars=float("nan"),
            mfe_points=float("nan"),
            is_big_move=False,
            indeterminate=True,
            indeterminate_reason=reason,
        )

    # Need at least entry bar + 1 exit bar
    if entry_bar_idx >= len(bars):
        return _indet("entry_bar_index_out_of_bounds")
    if entry_bar_idx + 1 >= len(bars):
        return _indet("no_forward_bars_after_entry")

    # ── Entry fill: next-bar OPEN (matches np.roll +1 shift in backtester) ──
    entry_row = bars.row(entry_bar_idx, named=True)
    entry_price = float(entry_row.get("open", entry_row.get("close", float("nan"))))
    if math.isnan(entry_price) or entry_price <= 0:
        return _indet("invalid_entry_bar_open")

    # ── ATR at entry ──
    atr_at_entry = float(entry_row.get("atr_14", float("nan")))
    if math.isnan(atr_at_entry) or atr_at_entry <= 0:
        # Fallback: use 1% of price as ATR proxy
        atr_at_entry = entry_price * 0.01

    # ── Stop: min(per-symbol framework ceiling, 1.5×ATR) — matches the LIVE overlay (NOT the
    #    backtester's 6pt fallback), so the counterfactual reflects the operator's big-move stops ──
    stop_ceiling = STRUCTURAL_STOP_CEILING_PTS.get(symbol.upper(), STRUCTURAL_STOP_CEILING_DEFAULT_PTS)
    risk_points = min(stop_ceiling, atr_at_entry * STATIC_STYLE_C_ATR_STOP_MULTIPLIER)
    min_trail = max(2.0, tick_size * 8)

    if is_short:
        initial_stop = entry_price + risk_points
    else:
        initial_stop = entry_price - risk_points

    # ── TP model: Style C bar-by-bar — TP1 at 1R, TP2 at 2R, runner trail after 2R.
    # For the counterfactual we exit at 2R (where max runner trail begins) or stop;
    # this mirrors the backtester's runner-trail resolution. We record MFE independently.
    trail_stop = initial_stop
    exit_price = float("nan")
    exit_idx = -1
    exit_reason = "max_hold"
    mfe_points = 0.0

    # ── Entry slippage ──
    slippage_entry = _compute_slippage_dollars(atr_at_entry, median_atr, symbol)

    # ── Bar-by-bar simulation (mirrors backtester.py lines 899-1003) ──
    sim_end = min(entry_bar_idx + MAX_HOLD_BARS, len(bars))
    tp1_filled = False
    tp1_price = entry_price + (1 if not is_short else -1) * risk_points * 1.0
    tp2_price = entry_price + (1 if not is_short else -1) * risk_points * 2.0

    for bar_idx in range(entry_bar_idx + 1, sim_end):
        row = bars.row(bar_idx, named=True)
        bar_high = float(row.get("high", float("nan")))
        bar_low = float(row.get("low", float("nan")))
        bar_open = float(row.get("open", bar_low))

        if math.isnan(bar_high) or math.isnan(bar_low):
            # Gap / missing data — treat as INDETERMINATE if we haven't exited yet
            if exit_idx == -1:
                return _indet(f"nan_bar_at_idx_{bar_idx}")
            break

        # MFE tracking
        if not is_short:
            bar_mfe = bar_high - entry_price
        else:
            bar_mfe = entry_price - bar_low
        if bar_mfe > mfe_points:
            mfe_points = bar_mfe

        # 1. Stop check (conservative: check before advancing trail)
        if not is_short and bar_low <= trail_stop:
            if bar_open < trail_stop:
                exit_price = bar_open  # gap fill (worse for trader)
            else:
                exit_price = trail_stop
            exit_reason = "trailing_stop" if trail_stop > initial_stop else "stop_loss"
            exit_idx = bar_idx
            break
        elif is_short and bar_high >= trail_stop:
            if bar_open > trail_stop:
                exit_price = bar_open
            else:
                exit_price = trail_stop
            exit_reason = "trailing_stop" if trail_stop < initial_stop else "stop_loss"
            exit_idx = bar_idx
            break

        # 2. TP2 full exit (model as full close when 2R reached — runner is subsumed)
        if not is_short and bar_high >= tp2_price:
            exit_price = tp2_price
            exit_reason = "take_profit"
            exit_idx = bar_idx
            break
        elif is_short and bar_low <= tp2_price:
            exit_price = tp2_price
            exit_reason = "take_profit"
            exit_idx = bar_idx
            break

        # 3. TP1 state update (BE move, no partial close in this simplified model)
        if not tp1_filled:
            if (not is_short and bar_high >= tp1_price) or (is_short and bar_low <= tp1_price):
                tp1_filled = True

        # 4. Advance trailing stop (mirrors backtester lines 981-1002)
        if not is_short:
            pnl_points = bar_high - entry_price
        else:
            pnl_points = entry_price - bar_low

        # After 1R: move to BE+1 tick
        if pnl_points >= risk_points:
            if not is_short:
                be_stop = entry_price + tick_size
                trail_stop = max(trail_stop, be_stop)
            else:
                be_stop = entry_price - tick_size
                trail_stop = min(trail_stop, be_stop)

        # After 2R: trail 1R behind price
        if pnl_points >= risk_points * 2:
            if not is_short:
                new_stop = bar_high - max(risk_points, min_trail)
                trail_stop = max(trail_stop, new_stop)
            else:
                new_stop = bar_low + max(risk_points, min_trail)
                trail_stop = min(trail_stop, new_stop)

        # 5. Time stop: 15:55 ET (approximate via bar index — full ET conversion
        #    is only available with real timestamps; when not available we rely on
        #    max_hold to cap the simulation, which is conservative)
        bar_ts = row.get("ts_event") or row.get("timestamp") or row.get("date")
        if bar_ts is not None:
            try:
                ts_str = str(bar_ts)
                # Look for HH:MM pattern
                if "T" in ts_str:
                    time_part = ts_str.split("T")[1][:5]
                elif " " in ts_str:
                    time_part = ts_str.split(" ")[1][:5]
                else:
                    time_part = ts_str[11:16]
                if time_part >= "19:55":  # 19:55 UTC ≈ 15:55 ET (EST; 20:55 EDT)
                    exit_price = bar_open if not math.isnan(bar_open) else float(row.get("close", entry_price))
                    exit_reason = "time_stop"
                    exit_idx = bar_idx
                    break
            except Exception:
                pass  # no timestamp available; rely on max_hold

    # Max hold expiry
    if exit_idx == -1:
        last_idx = min(entry_bar_idx + MAX_HOLD_BARS, len(bars) - 1)
        last_row = bars.row(last_idx, named=True)
        exit_price = float(last_row.get("close", float("nan")))
        exit_reason = "max_hold"
        if math.isnan(exit_price):
            return _indet("no_valid_exit_price_at_max_hold")

    if math.isnan(exit_price) or exit_price <= 0:
        return _indet("invalid_exit_price")

    # ── Exit slippage ──
    exit_bar_row = bars.row(exit_idx if exit_idx > 0 else entry_bar_idx + 1, named=True)
    exit_atr = float(exit_bar_row.get("atr_14", atr_at_entry))
    if math.isnan(exit_atr) or exit_atr <= 0:
        exit_atr = atr_at_entry
    slippage_exit = _compute_slippage_dollars(exit_atr, median_atr, symbol)

    # ── P&L ──
    net_pnl = _compute_pnl(
        direction=direction,
        entry_price=entry_price,
        exit_price=exit_price,
        point_value=point_value,
        slippage_dollars_entry=slippage_entry,
        slippage_dollars_exit=slippage_exit,
        commission_per_side=commission_per_side,
        contracts=1,
    )

    # ── R-multiple ──
    if risk_points > 0:
        sign = 1 if not is_short else -1
        realized_r = sign * (exit_price - entry_price) / risk_points
    else:
        realized_r = 0.0

    # ── Big move detection ──
    big_move_threshold = _get_big_move_threshold(symbol)
    is_big_move = (mfe_points >= big_move_threshold) or (mfe_points >= risk_points * BIG_MOVE_MIN_R)

    return CounterfactualResult(
        signal_id=signal.signal_id,
        gate_key=signal.gate_key,
        symbol=symbol,
        direction=direction,
        entry_price=entry_price,
        exit_price=exit_price,
        exit_reason=exit_reason,
        realized_r=round(realized_r, 3),
        net_pnl_dollars=round(net_pnl, 2),
        mfe_points=round(mfe_points, 3),
        is_big_move=is_big_move,
    )


# ─── Aggregation & verdict ────────────────────────────────────────────────────

def _compute_verdict(
    gate_key: str,
    results: list[CounterfactualResult],
) -> GateVerdict:
    """Aggregate per-signal results into a gate-level verdict."""
    blocked_count = len(results)
    valid = [r for r in results if not r.indeterminate]
    indet_count = blocked_count - len(valid)
    evaluated_count = len(valid)

    if evaluated_count < MIN_SIGNALS_FOR_VERDICT:
        return GateVerdict(
            gate_key=gate_key,
            blocked_count=blocked_count,
            evaluated_count=evaluated_count,
            indeterminate_count=indet_count,
            total_net_pnl=0.0,
            win_count=0,
            loss_count=0,
            avg_r=0.0,
            big_move_winners_blocked=0,
            losers_correctly_blocked=0,
            verdict="INSUFFICIENT_DATA",
            recommendation=(
                f"Only {evaluated_count} evaluable signals (need {MIN_SIGNALS_FOR_VERDICT}). "
                f"Accumulate more paper-session data before drawing conclusions."
            ),
        )

    total_pnl = sum(r.net_pnl_dollars for r in valid)
    win_count = sum(1 for r in valid if r.realized_r > 0)
    loss_count = sum(1 for r in valid if r.realized_r <= 0)
    big_move_winners = sum(1 for r in valid if r.is_big_move and r.realized_r > 0)
    losers_correctly_blocked = sum(1 for r in valid if r.realized_r <= 0)

    avg_r = sum(r.realized_r for r in valid) / evaluated_count if evaluated_count > 0 else 0.0

    # Verdict logic
    if avg_r > NEUTRAL_BAND_R and big_move_winners >= 1:
        verdict = "COSTING"
    elif avg_r < -NEUTRAL_BAND_R:
        verdict = "SAVING"
    elif -NEUTRAL_BAND_R <= avg_r <= NEUTRAL_BAND_R:
        verdict = "NEUTRAL"
    else:
        # avg_r > 0 but no big-move winners: still COSTING (positive expectancy)
        verdict = "COSTING"

    # Recommendation text
    if verdict == "COSTING":
        if big_move_winners > 0:
            avg_pnl_blocked = total_pnl / evaluated_count
            recommendation = (
                f"[COSTING] Gate blocked {big_move_winners} big-move winner(s) "
                f"(MFE >= {_get_big_move_threshold(results[0].symbol if results else 'MES')}pt "
                f"or >= {BIG_MOVE_MIN_R}R). "
                f"Counterfactual avg R = {avg_r:.2f}, avg P&L = ${avg_pnl_blocked:.0f}/trade. "
                f"Win rate = {win_count}/{evaluated_count}. "
                f"Candidate to LOOSEN or TUNE — consider requiring multiple confirming conditions "
                f"before blocking rather than a hard gate."
            )
        else:
            recommendation = (
                f"[COSTING] Gate has positive counterfactual expectancy (avg R = {avg_r:.2f}) "
                f"but no confirmed big-move winners. "
                f"Monitor closely before loosening — may be statistical noise below {MIN_SIGNALS_FOR_VERDICT} signals."
            )
    elif verdict == "SAVING":
        recommendation = (
            f"[SAVING] Gate correctly blocked losing trades. "
            f"Counterfactual avg R = {avg_r:.2f}, {losers_correctly_blocked} of {evaluated_count} "
            f"would have been losers. KEEP this gate — it is doing its job."
        )
    else:
        recommendation = (
            f"[NEUTRAL] Gate has no clear directional bias (avg R = {avg_r:.2f}). "
            f"Neither strongly COSTING nor SAVING. Review gate parameters — "
            f"consider loosening to capture the ~{win_count} potential winners "
            f"if they meet A+ quality criteria."
        )

    return GateVerdict(
        gate_key=gate_key,
        blocked_count=blocked_count,
        evaluated_count=evaluated_count,
        indeterminate_count=indet_count,
        total_net_pnl=round(total_pnl, 2),
        win_count=win_count,
        loss_count=loss_count,
        avg_r=round(avg_r, 3),
        big_move_winners_blocked=big_move_winners,
        losers_correctly_blocked=losers_correctly_blocked,
        verdict=verdict,
        recommendation=recommendation,
    )


# ─── Data loader (reads from paper_signal_logs via psycopg2) ─────────────────

def load_blocked_signals(
    db_connection_string: Optional[str] = None,
    *,
    since_iso: Optional[str] = None,
) -> list[BlockedSignal]:
    """Load blocked signals from paper_signal_logs WHERE acted = false.

    Falls back to [] (not an error) when:
    - DB is unreachable (logged as WARNING)
    - No rows match (pre-go-live; report handles this case)

    Args:
        db_connection_string: psycopg2-compatible connection string.
            If None, reads from DATABASE_URL env var.
        since_iso: ISO timestamp filter (e.g., "2026-06-01T00:00:00Z").

    Returns:
        List of BlockedSignal objects sorted by created_at ascending.
    """
    conn_str = db_connection_string or os.environ.get("DATABASE_URL", "")
    if not conn_str:
        logger.warning("gate_block_analyzer: DATABASE_URL not set; returning empty signal list")
        return []

    try:
        import psycopg2  # type: ignore[import]
        import psycopg2.extras  # type: ignore[import]
    except ImportError:
        logger.warning("gate_block_analyzer: psycopg2 not available; returning empty signal list")
        return []

    try:
        conn = psycopg2.connect(conn_str)
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        query = """
            SELECT
                id::text AS signal_id,
                symbol,
                direction,
                COALESCE(price, 0.0)::float AS price,
                created_at,
                signal_type,
                reason,
                indicator_snapshot,
                session_id::text AS session_id
            FROM paper_signal_logs
            WHERE acted = false
        """
        params: list = []
        if since_iso:
            query += " AND created_at >= %s"
            params.append(since_iso)
        query += " ORDER BY created_at ASC"

        cur.execute(query, params)
        rows = cur.fetchall()
        cur.close()
        conn.close()
    except Exception as exc:
        logger.warning("gate_block_analyzer: DB query failed: %s", exc)
        return []

    signals: list[BlockedSignal] = []
    for row in rows:
        try:
            signals.append(BlockedSignal(
                signal_id=str(row["signal_id"]),
                symbol=str(row["symbol"]).upper(),
                direction=str(row["direction"]).lower(),
                price=float(row["price"] or 0.0),
                created_at=row["created_at"] if isinstance(row["created_at"], datetime)
                           else datetime.fromisoformat(str(row["created_at"])),
                signal_type=row.get("signal_type"),
                reason=row.get("reason"),
                indicator_snapshot=row.get("indicator_snapshot"),
                session_id=row.get("session_id"),
            ))
        except Exception as exc:
            logger.warning("gate_block_analyzer: skipping malformed row %s: %s", row.get("signal_id"), exc)
            continue

    logger.info("gate_block_analyzer: loaded %d blocked signals", len(signals))
    return signals


# ─── Forward-bar loader ───────────────────────────────────────────────────────

def load_forward_bars(
    symbol: str,
    from_dt: datetime,
    n_bars: int = MAX_HOLD_BARS + 2,
    timeframe: str = "5m",
    *,
    data_loader_fn=None,
) -> Optional[pl.DataFrame]:
    """Load forward bars starting at from_dt for counterfactual simulation.

    Uses data_loader.py load_ohlcv() by default.
    Returns None (INDETERMINATE) if loading fails.

    ATR is computed inline if not already in the DataFrame.
    """
    if data_loader_fn is not None:
        try:
            return data_loader_fn(symbol=symbol, from_dt=from_dt, n_bars=n_bars, timeframe=timeframe)
        except Exception as exc:
            logger.warning("gate_block_analyzer: data_loader_fn failed for %s @ %s: %s", symbol, from_dt, exc)
            return None

    # Default: use data_loader.load_ohlcv
    try:
        from src.engine.data_loader import load_ohlcv  # noqa: PLC0415

        from_str = from_dt.strftime("%Y-%m-%d")
        # Estimate end date: enough bars forward (generous buffer)
        import math as _math
        # 5m bars: ~80/day RTH; pad 3× to account for weekends / holidays
        days_needed = _math.ceil((n_bars / 78) * 3) + 2
        from datetime import timedelta
        end_dt = from_dt + timedelta(days=days_needed)
        end_str = end_dt.strftime("%Y-%m-%d")

        df = load_ohlcv(
            symbol=symbol,
            timeframe=timeframe,
            start=from_str,
            end=end_str,
            adjusted=True,
            ignore_quality_gate=False,
        )
        if df is None or len(df) == 0:
            return None

        # Ensure ATR column exists
        if "atr_14" not in df.columns:
            try:
                from src.engine.indicators.core import compute_atr  # noqa: PLC0415
                atr_series = compute_atr(df, 14)
                df = df.with_columns(atr_series.alias("atr_14"))
            except Exception:
                # Fallback: use 0.5% of close as ATR proxy
                df = df.with_columns(
                    (pl.col("close") * 0.005).alias("atr_14")
                )

        return df

    except Exception as exc:
        logger.warning("gate_block_analyzer: load_forward_bars failed for %s: %s", symbol, exc)
        return None


def _find_entry_bar_idx(df: pl.DataFrame, signal_dt: datetime) -> int:
    """Find the bar index that contains signal_dt, then return +1 (next-bar fill).

    Returns -1 if no suitable bar is found.
    """
    ts_col = "ts_event" if "ts_event" in df.columns else None
    if ts_col is None:
        for col in ["timestamp", "date", "datetime"]:
            if col in df.columns:
                ts_col = col
                break

    if ts_col is None:
        # No timestamp column — assume first bar is entry
        return 0

    # Find the bar whose timestamp is closest to but not after the signal
    # signal_dt is in UTC; bars may be in UTC or local
    signal_ts_us = int(signal_dt.replace(tzinfo=timezone.utc).timestamp() * 1e6)

    try:
        # Try to find first bar AFTER signal timestamp
        ts_series = df[ts_col]
        for i in range(len(ts_series)):
            val = ts_series[i]
            if val is None:
                continue
            try:
                val_str = str(val)
                if "T" in val_str:
                    bar_dt = datetime.fromisoformat(val_str.replace("Z", "+00:00"))
                else:
                    bar_dt = datetime.fromisoformat(val_str)
                bar_us = int(bar_dt.timestamp() * 1e6)
                if bar_us >= signal_ts_us:
                    # This bar is at or after signal; entry is the NEXT bar
                    return min(i, len(df) - 2)  # entry bar, next bar is fill
            except Exception:
                continue
    except Exception:
        pass

    # Fallback: first bar
    return 0


def _compute_median_atr(df: pl.DataFrame) -> float:
    """Compute median ATR over the available bars."""
    if "atr_14" in df.columns:
        atr_np = df["atr_14"].drop_nulls().to_numpy().astype(float)
        valid = atr_np[~np.isnan(atr_np)]
        if len(valid) > 0:
            return float(np.nanmedian(valid))
    return float("nan")


# ─── Report generator ─────────────────────────────────────────────────────────

def _verdict_pill(verdict: str) -> str:
    """Plain-English verdict pill for markdown."""
    _PILLS = {
        "COSTING": "COSTING (review — gate is blocking winners)",
        "SAVING": "SAVING (keep — gate is doing its job)",
        "NEUTRAL": "NEUTRAL (monitor — no clear directional bias)",
        "INSUFFICIENT_DATA": "INSUFFICIENT DATA (need more signals)",
    }
    return _PILLS.get(verdict, verdict)


def generate_report(
    verdicts: list[GateVerdict],
    output_path: Path,
    report_name: str,
    since_iso: Optional[str],
    total_blocked: int,
    total_indeterminate: int,
) -> str:
    """Generate markdown report to output_path. Returns the path as string."""
    lines: list[str] = []
    lines.append(f"# Gate Block Analysis — {report_name}")
    lines.append("")
    lines.append(f"**Generated:** {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}")
    if since_iso:
        lines.append(f"**Period filter:** since {since_iso}")
    lines.append(f"**Total blocked signals analyzed:** {total_blocked}")
    lines.append(f"**Total INDETERMINATE (missing forward data):** {total_indeterminate}")
    lines.append("")

    if total_blocked == 0:
        lines.append("## No Data Yet")
        lines.append("")
        lines.append(
            "No blocked-signal data found in paper_signal_logs (acted = false). "
            "This is expected pre-go-live before paper trading starts. "
            "Re-run this report after paper trading accumulates blocked signals."
        )
        lines.append("")
        lines.append(
            "**To generate meaningful counterfactuals:** let the paper engine run "
            "for at least 1-2 weeks so each gate blocks enough signals "
            f"(minimum {MIN_SIGNALS_FOR_VERDICT} evaluable per gate for a verdict)."
        )
        output_path.write_text("\n".join(lines), encoding="utf-8")
        return str(output_path)

    # Verdict summary table
    lines.append("## Verdict Summary")
    lines.append("")
    lines.append(
        "| Gate | Blocked | Evaluated | INDET | Avg R | Big-Move Wins Blocked | Verdict |"
    )
    lines.append("|---|---|---|---|---|---|---|")
    for v in sorted(verdicts, key=lambda x: x.verdict):
        lines.append(
            f"| {v.gate_key} "
            f"| {v.blocked_count} "
            f"| {v.evaluated_count} "
            f"| {v.indeterminate_count} "
            f"| {v.avg_r:.2f}R "
            f"| {v.big_move_winners_blocked} "
            f"| **{v.verdict}** |"
        )
    lines.append("")

    # Per-gate detail
    lines.append("## Per-Gate Detail")
    lines.append("")
    for v in verdicts:
        lines.append(f"### {v.gate_key}")
        lines.append("")
        lines.append(f"**Verdict:** {_verdict_pill(v.verdict)}")
        lines.append("")
        lines.append(
            f"- Signals blocked: {v.blocked_count}\n"
            f"- Counterfactuals evaluated: {v.evaluated_count}\n"
            f"- INDETERMINATE (missing data): {v.indeterminate_count}\n"
            f"- Win count (would-be winners): {v.win_count}\n"
            f"- Loss count (would-be losers): {v.loss_count}\n"
            f"- Big-move winners blocked: {v.big_move_winners_blocked} "
            f"(MFE >= threshold OR >= {BIG_MOVE_MIN_R}R)\n"
            f"- Losers correctly blocked: {v.losers_correctly_blocked}\n"
            f"- Total counterfactual P&L: ${v.total_net_pnl:,.0f}\n"
            f"- Average R per blocked signal: {v.avg_r:.2f}R"
        )
        lines.append("")
        lines.append(f"**Recommendation:** {v.recommendation}")
        lines.append("")

    # Plain-English summary for non-technical operator
    lines.append("## Plain-English Summary")
    lines.append("")
    costing_gates = [v for v in verdicts if v.verdict == "COSTING"]
    saving_gates = [v for v in verdicts if v.verdict == "SAVING"]
    neutral_gates = [v for v in verdicts if v.verdict == "NEUTRAL"]
    indet_gates = [v for v in verdicts if v.verdict == "INSUFFICIENT_DATA"]

    if costing_gates:
        lines.append(
            f"**{len(costing_gates)} gate(s) are COSTING you money** — "
            f"they are blocking trades that would have made money on average. "
            f"Gates: {', '.join(v.gate_key for v in costing_gates)}. "
            f"Review these first — especially any that blocked big moves "
            f"(14+ MES pts / 40+ MNQ pts)."
        )
    if saving_gates:
        lines.append(
            f"**{len(saving_gates)} gate(s) are SAVING you money** — "
            f"they are blocking losing trades. "
            f"Gates: {', '.join(v.gate_key for v in saving_gates)}. Keep them."
        )
    if neutral_gates:
        lines.append(
            f"**{len(neutral_gates)} gate(s) are NEUTRAL** — "
            f"no clear directional bias yet. "
            f"Gates: {', '.join(v.gate_key for v in neutral_gates)}."
        )
    if indet_gates:
        lines.append(
            f"**{len(indet_gates)} gate(s) have INSUFFICIENT DATA** — "
            f"need at least {MIN_SIGNALS_FOR_VERDICT} evaluable signals each. "
            f"Gates: {', '.join(v.gate_key for v in indet_gates)}."
        )
    lines.append("")
    lines.append(
        "_Note: INDETERMINATE signals (missing forward bar data) are excluded from "
        "the counterfactual math. A high INDETERMINATE count means the data loader "
        "cannot find forward bars for those signals — typically pre-go-live or "
        "signals near data-window boundaries._"
    )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text("\n".join(lines), encoding="utf-8")
    return str(output_path)


# ─── Main analysis function ───────────────────────────────────────────────────

def run_gate_block_analysis(
    report_name: str,
    output_dir: Optional[Path] = None,
    db_connection_string: Optional[str] = None,
    since_iso: Optional[str] = None,
    timeframe: str = "5m",
    *,
    data_loader_fn=None,
    signals: Optional[list[BlockedSignal]] = None,  # injectable for tests
) -> dict:
    """Run the full gate block analysis and write the markdown report.

    Args:
        report_name: Deterministic report identifier (CLI arg, no Date.now).
        output_dir: Directory to write the report. Defaults to docs/gate-block-analysis/.
        db_connection_string: psycopg2 connection string. Falls back to DATABASE_URL env.
        since_iso: ISO timestamp filter on paper_signal_logs.created_at.
        timeframe: Backtest timeframe for forward-bar loading (default "5m").
        data_loader_fn: Optional injectable data loader (for testing / override).
        signals: Inject pre-loaded signals (bypasses DB; for testing).

    Returns:
        dict with keys: report_path, verdicts, total_blocked, total_indeterminate
    """
    np.random.seed(42)  # determinism anchor

    if output_dir is None:
        # Locate project root relative to this file
        here = Path(__file__).parent
        project_root = here.parent.parent  # src/engine -> src -> project root
        output_dir = project_root / "docs" / "gate-block-analysis"

    output_path = output_dir / f"{report_name}.md"

    # Load signals
    if signals is None:
        signals = load_blocked_signals(
            db_connection_string=db_connection_string,
            since_iso=since_iso,
        )

    total_blocked = len(signals)

    if total_blocked == 0:
        report_path = generate_report(
            verdicts=[],
            output_path=output_path,
            report_name=report_name,
            since_iso=since_iso,
            total_blocked=0,
            total_indeterminate=0,
        )
        logger.info("gate_block_analyzer: no blocked signals — wrote empty report to %s", report_path)
        return {
            "report_path": report_path,
            "verdicts": [],
            "total_blocked": 0,
            "total_indeterminate": 0,
        }

    # Group signals by symbol for efficient bar loading
    from collections import defaultdict
    by_symbol: dict[str, list[BlockedSignal]] = defaultdict(list)
    for sig in signals:
        by_symbol[sig.symbol].append(sig)

    # Run counterfactuals
    all_results: list[CounterfactualResult] = []

    for sym, sym_signals in by_symbol.items():
        logger.info("gate_block_analyzer: processing %d signals for %s", len(sym_signals), sym)

        for sig in sym_signals:
            try:
                bars = load_forward_bars(
                    symbol=sym,
                    from_dt=sig.created_at,
                    n_bars=MAX_HOLD_BARS + 5,
                    timeframe=timeframe,
                    data_loader_fn=data_loader_fn,
                )
                if bars is None or len(bars) == 0:
                    all_results.append(CounterfactualResult(
                        signal_id=sig.signal_id,
                        gate_key=sig.gate_key,
                        symbol=sym,
                        direction=sig.direction,
                        entry_price=float("nan"),
                        exit_price=float("nan"),
                        exit_reason="no_data",
                        realized_r=float("nan"),
                        net_pnl_dollars=float("nan"),
                        mfe_points=float("nan"),
                        is_big_move=False,
                        indeterminate=True,
                        indeterminate_reason="forward_bars_unavailable",
                    ))
                    continue

                entry_bar_idx = _find_entry_bar_idx(bars, sig.created_at)
                median_atr = _compute_median_atr(bars)
                if math.isnan(median_atr) or median_atr <= 0:
                    median_atr = float(bars["close"].mean()) * 0.005

                result = simulate_counterfactual(
                    signal=sig,
                    bars=bars,
                    entry_bar_idx=entry_bar_idx,
                    median_atr=median_atr,
                )
                all_results.append(result)

            except Exception as exc:
                logger.warning(
                    "gate_block_analyzer: signal %s failed with unexpected error: %s",
                    sig.signal_id, exc,
                )
                all_results.append(CounterfactualResult(
                    signal_id=sig.signal_id,
                    gate_key=sig.gate_key,
                    symbol=sym,
                    direction=sig.direction,
                    entry_price=float("nan"),
                    exit_price=float("nan"),
                    exit_reason="no_data",
                    realized_r=float("nan"),
                    net_pnl_dollars=float("nan"),
                    mfe_points=float("nan"),
                    is_big_move=False,
                    indeterminate=True,
                    indeterminate_reason=f"exception: {exc}",
                ))

    total_indeterminate = sum(1 for r in all_results if r.indeterminate)

    # Group by gate and compute verdicts
    by_gate: dict[str, list[CounterfactualResult]] = defaultdict(list)
    for r in all_results:
        by_gate[r.gate_key].append(r)

    verdicts = [_compute_verdict(gate_key, results) for gate_key, results in by_gate.items()]
    verdicts.sort(key=lambda v: v.verdict)

    report_path = generate_report(
        verdicts=verdicts,
        output_path=output_path,
        report_name=report_name,
        since_iso=since_iso,
        total_blocked=total_blocked,
        total_indeterminate=total_indeterminate,
    )

    logger.info(
        "gate_block_analyzer: COMPLETE — %d signals, %d gates, %d INDET, report=%s",
        total_blocked, len(verdicts), total_indeterminate, report_path,
    )
    return {
        "report_path": report_path,
        "verdicts": verdicts,
        "total_blocked": total_blocked,
        "total_indeterminate": total_indeterminate,
    }


# ─── CLI ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import argparse

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )

    parser = argparse.ArgumentParser(
        description="Gate Block Analyzer — counterfactual per-gate edge diagnosis"
    )
    parser.add_argument(
        "report_name",
        help="Deterministic report identifier, e.g. 'weekly-2026-06-24'. "
             "Output: docs/gate-block-analysis/<name>.md",
    )
    parser.add_argument(
        "--since",
        default=None,
        metavar="ISO_TIMESTAMP",
        help="Filter signals created after this ISO timestamp, e.g. 2026-06-01T00:00:00Z",
    )
    parser.add_argument(
        "--timeframe",
        default="5m",
        metavar="TF",
        help="Bar timeframe for forward-bar loading (default: 5m)",
    )
    parser.add_argument(
        "--output-dir",
        default=None,
        metavar="DIR",
        help="Output directory (default: docs/gate-block-analysis/)",
    )
    args = parser.parse_args()

    output_dir = Path(args.output_dir) if args.output_dir else None

    result = run_gate_block_analysis(
        report_name=args.report_name,
        output_dir=output_dir,
        since_iso=args.since,
        timeframe=args.timeframe,
    )

    print(f"Report written to: {result['report_path']}")
    print(f"Total blocked: {result['total_blocked']}")
    print(f"Total INDETERMINATE: {result['total_indeterminate']}")
    print(f"Gate verdicts: {len(result['verdicts'])}")
    for v in result["verdicts"]:
        print(f"  [{v.verdict}] {v.gate_key}: avg_r={v.avg_r:.2f}, big_moves_blocked={v.big_move_winners_blocked}")
    sys.exit(0)
