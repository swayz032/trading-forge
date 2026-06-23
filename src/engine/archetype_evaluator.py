"""Archetype Evaluator CLI — Python subprocess entry point for Pass 4.5 Track C.

Reads a JSON payload from stdin and evaluates whether a structural archetype
strategy would enter, exit, or hold on the provided bar context. Returns a
JSON verdict to stdout.

Called by Track B's /api/live-order route via subprocess:
    echo '<json>' | python -m src.engine.archetype_evaluator

Stdin JSON Schema
-----------------
{
  "archetype":   "<registry key>",          -- required, e.g. "silver_bullet"
  "strategy_id": "<uuid>",                  -- required, for audit trail
  "bar": {                                  -- required, current bar OHLCV
    "timestamp":  "<ISO 8601>",
    "symbol":     "<SYM>",
    "close":      <float>,
    "high":       <float>,
    "low":        <float>,
    "open":       <float>,
    "volume":     <int>
  },
  "position": {                             -- required, current position state
    "side":       "long" | "short" | "flat",
    "size":       <int>
  },
  "bias_state": {                           -- required, current bias/regime
    "regime":               "<str>",        -- e.g. "TRENDING", "RANGE_BOUND"
    "institutional_regime": "<str>",        -- e.g. "EXPANSION", "COMPRESSION"
    "htf_bias":             "<str|null>",   -- "bullish" | "bearish" | null
    "pd_zone":              "<str|null>",   -- "premium" | "discount" | null
    "narrative_phase":      "<str|null>"    -- "ACCUMULATION" | "DISTRIBUTION" | etc.
  }
}

Stdout JSON Schema (success)
-----------------------------
{
  "action":    "enter_long" | "enter_short" | "exit_long" | "exit_short" | "hold",
  "reason":    "<plain-English explanation>",
  "archetype": "<registry key>"
}

Stdout JSON Schema (error)
---------------------------
{
  "status": "error",
  "reason": "<message>"
}

Exit code 1 on any error; exit code 0 on success.

Architecture Decision: Track B passes the FULL bar context + bias_state via stdin.
This avoids Python-to-DB round-trip latency and keeps this module stateless. The
caller (live-order.ts) already holds bar context and bias_state in memory at
signal time. Any DB reads needed for multi-bar lookback are synthetic in the
evaluator (we build a lookback window of identical bars — sufficient for detecting
whether the CURRENT bar has a signal, not for full-backtest-quality signal timing).

Multi-bar lookback note: The strategy classes are designed for bar-by-bar replay
over historical data. To evaluate a single "current bar" we synthesise a window of
bars at the same price level (no-pattern bars) followed by the live bar. This tells
us whether the CURRENT bar satisfies the entry pattern. It does NOT produce the same
temporal signal sequence that the backtester would — it answers the signal-now question.

ARCHETYPE_CLASS_MAP source-of-truth cross-reference:
    TypeScript source: src/server/services/direct-bucket-graduator.ts — ARCHETYPE_REGISTRY
    Python backtest path: strategyClass fields in ARCHETYPE_REGISTRY (same dotted paths)

Archetypes needing adapter layer (carry-forward):
    smt_reversal — requires compute_multi() with two DataFrames (ES + NQ); single-bar
                   stdin context cannot supply both instruments. Returns "hold" with a
                   documented reason until Track B passes a dual-instrument payload.

All other archetypes are directly wired via ARCHETYPE_CLASS_MAP below.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from typing import Any

import polars as pl

# ---------------------------------------------------------------------------
# ARCHETYPE_CLASS_MAP — mirrors ARCHETYPE_REGISTRY in direct-bucket-graduator.ts
#
# Source of truth: src/server/services/direct-bucket-graduator.ts ARCHETYPE_REGISTRY
# Update this dict IN LOCKSTEP with any additions to ARCHETYPE_REGISTRY (both
# the strategyClass field AND the key name must match exactly).
#
# Keys that share a class (aliases) are included explicitly so every registry
# key resolves without a secondary lookup.
# ---------------------------------------------------------------------------

def _get_archetype_class_map() -> dict[str, type]:
    """Lazily import strategy classes to avoid circular imports and heavy load."""
    from src.engine.strategies.bounce_off_level import BounceOffLevelStrategy
    from src.engine.strategies.breaker import BreakerStrategy
    from src.engine.strategies.eqhl_raid import EqhlRaidStrategy
    from src.engine.strategies.gann_box_4h_continuation import (
        GannBox4HContinuationStrategy,
    )
    from src.engine.strategies.ict_2022 import ICT2022Strategy
    from src.engine.strategies.ict_bias_aligned_continuation import (
        ICTBiasAlignedContinuationStrategy,
    )
    from src.engine.strategies.ict_scalp import ICTScalpStrategy
    from src.engine.strategies.ict_swing import ICTSwingStrategy
    from src.engine.strategies.iofed import IOFEDStrategy
    from src.engine.strategies.judas_swing import JudasSwingStrategy
    from src.engine.strategies.london_raid import LondonRaidStrategy
    from src.engine.strategies.midnight_open import MidnightOpenStrategy
    from src.engine.strategies.mitigation import MitigationStrategy
    from src.engine.strategies.ny_lunch_reversal import NYLunchReversalStrategy
    from src.engine.strategies.ote_strategy import OTEStrategy
    from src.engine.strategies.power_of_3 import PowerOf3Strategy
    from src.engine.strategies.propulsion import PropulsionStrategy
    from src.engine.strategies.quarterly_swing import QuarterlySwingStrategy
    from src.engine.strategies.silver_bullet import SilverBulletStrategy
    from src.engine.strategies.smt_reversal import SMTReversalStrategy
    from src.engine.strategies.turtle_soup import TurtleSoupStrategy
    from src.engine.strategies.unicorn import UnicornStrategy

    return {
        # ICT time-window archetypes
        "ict_silver_bullet_ny_am":       SilverBulletStrategy,
        "ict_silver_bullet_london":      SilverBulletStrategy,
        "ict_silver_bullet_ny_pm":       SilverBulletStrategy,
        "ict_judas_swing":               JudasSwingStrategy,
        "ict_ny_lunch_reversal":         NYLunchReversalStrategy,
        "ict_midnight_open":             MidnightOpenStrategy,
        "ict_london_raid":               LondonRaidStrategy,
        "ict_turtle_soup":               TurtleSoupStrategy,
        "ict_ote":                       OTEStrategy,
        "ict_power_of_3":                PowerOf3Strategy,
        "ict_unicorn":                   UnicornStrategy,
        "ict_breaker":                   BreakerStrategy,
        "ict_mitigation":                MitigationStrategy,
        "ict_iofed":                     IOFEDStrategy,
        "smt_reversal":                  SMTReversalStrategy,  # needs adapter — see below
        "ict_quarterly_swing":           QuarterlySwingStrategy,
        "ict_propulsion":                PropulsionStrategy,
        "ict_eqhl_raid":                 EqhlRaidStrategy,
        "ict_scalp":                     ICTScalpStrategy,
        "ict_swing":                     ICTSwingStrategy,
        "ict_2022":                      ICT2022Strategy,
        # Structural primitives
        "break_of_structure":            ICTSwingStrategy,
        "change_of_character":           ICTSwingStrategy,
        "market_structure_shift":        ICT2022Strategy,
        "cisd":                          ICTScalpStrategy,
        "fvg_retrace":                   SilverBulletStrategy,
        # W23G.3 short-form aliases
        "fvg":                           SilverBulletStrategy,
        "judas_swing":                   JudasSwingStrategy,
        "silver_bullet":                 SilverBulletStrategy,
        "breaker_block":                 BreakerStrategy,
        "order_block":                   BreakerStrategy,
        "liquidity_sweep":               TurtleSoupStrategy,
        # Wyckoff
        "wyckoff_spring":                TurtleSoupStrategy,
        "wyckoff_upthrust":              TurtleSoupStrategy,
        "wyckoff_accumulation":          PowerOf3Strategy,
        "wyckoff_distribution":          PowerOf3Strategy,
        # Wave 26 Pass G archetypes
        "bounce_off_level":              BounceOffLevelStrategy,
        "ict_bias_aligned_continuation": ICTBiasAlignedContinuationStrategy,
        # W3.4 Gann box 4H continuation
        "gann_box_4h_continuation":      GannBox4HContinuationStrategy,
    }


# ---------------------------------------------------------------------------
# Multi-instrument archetypes that cannot be evaluated from a single-bar stdin.
# These return hold + a carry-forward reason instead of attempting a bad eval.
# ---------------------------------------------------------------------------
_MULTI_INSTRUMENT_ARCHETYPES: frozenset[str] = frozenset({
    "smt_reversal",
})

# Minimum synthetic lookback window to ensure indicator warmup completes.
# ATR(14) needs 14 bars; MA(200) needs 200 bars; we use 210 as the safe ceiling.
_WARMUP_BARS: int = 210


def _build_synthetic_df(bar: dict[str, Any], warmup: int = _WARMUP_BARS) -> pl.DataFrame:
    """Build a synthetic polars DataFrame ending with the live bar.

    The first `warmup` bars are neutral (same price level, no pattern) and
    exist only to satisfy indicator warmup requirements. The LAST bar is the
    live bar. We check only the last row's entry/exit signals.

    The timestamp column uses 5-minute spacing to satisfy session-detection
    helpers that examine ET hour/minute.
    """
    ts_str = bar.get("timestamp", "2026-01-02T10:00:00Z")
    try:
        live_ts = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
    except Exception:
        live_ts = datetime.now(tz=timezone.utc)

    close = float(bar.get("close", 5000.0))
    high  = float(bar.get("high", close + 1.0))
    low   = float(bar.get("low",  close - 1.0))
    open_ = float(bar.get("open", close))
    vol   = int(bar.get("volume", 1000))

    # Build warmup bars at a price slightly away from the live bar so MA warmup
    # is meaningful (all-same-price would compute correct MA but zero ATR).
    # We use a gentle oscillation ±0.5 pt to keep ATR non-zero.
    n_warmup = warmup
    half = n_warmup // 2
    warmup_closes: list[float] = []
    warmup_highs:  list[float] = []
    warmup_lows:   list[float] = []
    warmup_opens:  list[float] = []
    for k in range(n_warmup):
        # Alternates slightly above and below so ATR is nonzero and MA converges.
        delta = 0.5 if k % 2 == 0 else -0.5
        wc = close + delta
        warmup_closes.append(wc)
        warmup_highs.append(wc + 0.5)
        warmup_lows.append(wc - 0.5)
        warmup_opens.append(wc)

    all_closes = warmup_closes + [close]
    all_highs  = warmup_highs  + [high]
    all_lows   = warmup_lows   + [low]
    all_opens  = warmup_opens  + [open_]
    all_vols   = [vol] * (n_warmup + 1)

    # Build timestamps: walk back from live_ts in 5-minute steps for warmup bars.
    step_sec = 5 * 60
    all_ts = []
    for k in range(n_warmup + 1):
        offset_sec = (n_warmup - k) * step_sec
        from datetime import timedelta
        ts_k = live_ts - timedelta(seconds=offset_sec)
        all_ts.append(ts_k)

    return pl.DataFrame({
        "ts_event": all_ts,
        "open":     all_opens,
        "high":     all_highs,
        "low":      all_lows,
        "close":    all_closes,
        "volume":   all_vols,
    }).cast({
        "open":   pl.Float64,
        "high":   pl.Float64,
        "low":    pl.Float64,
        "close":  pl.Float64,
        "volume": pl.Int64,
    })


def evaluate_archetype(
    archetype: str,
    bar_context: dict[str, Any],
    position_state: dict[str, Any],
    bias_state: dict[str, Any],
) -> dict[str, Any]:
    """Evaluate a single archetype against the current bar context.

    Args:
        archetype:      Registry key (e.g. "silver_bullet").
        bar_context:    Dict with keys: timestamp, symbol, close, high, low, open, volume.
        position_state: Dict with keys: side ("long"|"short"|"flat"), size (int).
        bias_state:     Dict with keys: regime, institutional_regime, htf_bias, pd_zone, etc.

    Returns:
        Dict with keys: action, reason, archetype.
        action is one of: enter_long | enter_short | exit_long | exit_short | hold.

    Raises:
        ValueError: if archetype key is not in ARCHETYPE_CLASS_MAP.
    """
    class_map = _get_archetype_class_map()

    if archetype not in class_map:
        raise ValueError(
            f"Unknown archetype key: {archetype!r}. "
            f"Known keys: {sorted(class_map.keys())}"
        )

    # Multi-instrument archetypes: carry-forward, cannot evaluate from single bar.
    if archetype in _MULTI_INSTRUMENT_ARCHETYPES:
        return {
            "action":    "hold",
            "reason":    (
                f"Archetype '{archetype}' requires multi-instrument data (ES + NQ). "
                "Single-bar stdin payload is insufficient. "
                "Carry-forward: Track B must pass a dual-instrument payload to activate this archetype."
            ),
            "archetype": archetype,
        }

    strategy_cls = class_map[archetype]

    # Instantiate with default params — all archetype classes carry sensible defaults.
    try:
        strategy = strategy_cls()
    except Exception as exc:
        raise ValueError(
            f"Failed to instantiate {strategy_cls.__name__} for archetype '{archetype}': {exc}"
        ) from exc

    # Build the synthetic bar history and run compute().
    df = _build_synthetic_df(bar_context)

    try:
        result_df = strategy.compute(df)
    except Exception as exc:
        raise ValueError(
            f"strategy.compute() failed for archetype '{archetype}' "
            f"(class {strategy_cls.__name__}): {exc}"
        ) from exc

    # Inspect the LAST row (the live bar).
    last = result_df.row(-1, named=True)
    entry_long  = bool(last.get("entry_long",  False))
    entry_short = bool(last.get("entry_short", False))
    exit_long   = bool(last.get("exit_long",   False))
    exit_short  = bool(last.get("exit_short",  False))

    position_side = position_state.get("side", "flat").lower()

    # Exit signals take priority over entry signals (per execution order in backtester).
    if exit_long and position_side == "long":
        return {
            "action":    "exit_long",
            "reason":    f"Archetype '{archetype}' emitted exit_long on the current bar.",
            "archetype": archetype,
        }

    if exit_short and position_side == "short":
        return {
            "action":    "exit_short",
            "reason":    f"Archetype '{archetype}' emitted exit_short on the current bar.",
            "archetype": archetype,
        }

    if entry_long and position_side == "flat":
        return {
            "action":    "enter_long",
            "reason":    f"Archetype '{archetype}' signals long entry on the current bar.",
            "archetype": archetype,
        }

    if entry_short and position_side == "flat":
        return {
            "action":    "enter_short",
            "reason":    f"Archetype '{archetype}' signals short entry on the current bar.",
            "archetype": archetype,
        }

    return {
        "action":    "hold",
        "reason":    (
            f"Archetype '{archetype}' produced no actionable signal "
            f"(entry_long={entry_long}, entry_short={entry_short}, "
            f"exit_long={exit_long}, exit_short={exit_short}) "
            f"with position side='{position_side}'."
        ),
        "archetype": archetype,
    }


def main() -> None:
    """CLI entry point — reads JSON from stdin, writes JSON verdict to stdout."""
    parser = argparse.ArgumentParser(
        description="Archetype evaluator CLI — returns JSON verdict to stdout.",
        add_help=True,
    )
    # All fields can also come from stdin JSON; argparse args are optional overrides
    # for debugging. The canonical production path is stdin JSON (option b).
    parser.add_argument("--archetype",              default=None, help="Archetype registry key (override stdin)")
    parser.add_argument("--strategy-id",            default=None, help="Strategy UUID (for audit trail)")
    parser.add_argument("--bar-timestamp",           default=None, help="ISO bar timestamp (override stdin)")
    parser.add_argument("--symbol",                 default=None, help="Instrument symbol (override stdin)")
    parser.add_argument("--account-id",             default=None, help="Account UUID (for audit trail)")
    parser.add_argument("--correlation-id",         default=None, help="Correlation ID (for audit trail)")
    parser.add_argument("--current-position",       default=None, choices=["long", "short", "flat"],
                        help="Current position side (override stdin)")
    parser.add_argument("--current-position-size",  default=None, type=int,
                        help="Current position size in contracts (override stdin)")
    args = parser.parse_args()

    # Read full JSON payload from stdin.
    try:
        raw = sys.stdin.read()
    except Exception as exc:
        _emit_error(f"Failed to read stdin: {exc}")
        sys.exit(1)

    if not raw.strip():
        _emit_error("Empty stdin — expected JSON payload.")
        sys.exit(1)

    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        _emit_error(f"Malformed stdin JSON: {exc}")
        sys.exit(1)

    # CLI args take precedence over stdin for individual fields (for manual debugging).
    archetype = args.archetype or payload.get("archetype")
    if not archetype:
        _emit_error("'archetype' field missing from payload and not supplied via --archetype.")
        sys.exit(1)

    bar_context = payload.get("bar", {})
    if args.bar_timestamp:
        bar_context["timestamp"] = args.bar_timestamp
    if args.symbol:
        bar_context["symbol"] = args.symbol

    position_state = payload.get("position", {})
    if args.current_position:
        position_state["side"] = args.current_position
    if args.current_position_size is not None:
        position_state["size"] = args.current_position_size

    bias_state = payload.get("bias_state", {})

    try:
        verdict = evaluate_archetype(archetype, bar_context, position_state, bias_state)
    except ValueError as exc:
        _emit_error(str(exc))
        sys.exit(1)
    except Exception as exc:
        _emit_error(f"Unexpected error in evaluate_archetype: {exc}")
        sys.exit(1)

    # Validate action vocabulary before emitting (internal correctness check).
    valid_actions = {"enter_long", "enter_short", "exit_long", "exit_short", "hold"}
    if verdict.get("action") not in valid_actions:
        _emit_error(
            f"Internal error: evaluate_archetype returned invalid action "
            f"'{verdict.get('action')}'. Valid: {valid_actions}"
        )
        sys.exit(1)

    print(json.dumps(verdict))
    sys.exit(0)


def _emit_error(reason: str) -> None:
    """Print error JSON to stdout and log to stderr."""
    print(json.dumps({"status": "error", "reason": reason}))
    print(f"[archetype_evaluator] ERROR: {reason}", file=sys.stderr)


if __name__ == "__main__":
    main()
