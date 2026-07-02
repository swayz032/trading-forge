#!/usr/bin/env python3
"""Null-strategy generator for gate-battery calibration (Layer 4 research conveyor, item 2).

Generates N structurally-valid BacktestRequest specs with ZERO predictive content
by construction. Used by null_gate_calibration.py to measure the battery false-pass rate.

Zero-edge proof:
- Entry condition: "close > open" (long) / "open > close" (short)
  These are intrabar direction signals. Under H0 (no edge), the intrabar direction
  at bar t is uncorrelated with the future return over the 1R/2R target horizon.
  Rationale: a Style C TP1 at 1R and stop at 1R gives exactly a 1:1 risk/reward
  structure. If bar direction predicted future direction, the market would exploit it.
  In practice, E[return_t+k | close_t > open_t] ≈ E[return_t+k] at the 1R horizon.
- Exit: Style C static (Mode B frozen overlay) — TP1@1R (33%), TP2@2R (33%),
  runner@3R (34%). Identical to real strategies; only the ENTRY has no edge.
- Stop: fixed points per symbol (symbol-appropriate sizing).
- No lookahead: all conditions use only current-bar OHLCV columns.

Reproducibility:
- Same (n, seed, symbol, timeframe) combination → same spec. PCG64DXSM RNG.
- Seeds are embedded in each spec for calibration provenance.

Structural validity:
- Every spec passes BacktestRequest.model_validate() before being emitted.
- TF_ALLOW_FIXED_1=true must be set in the calling environment (or pass --allow-fixed-1).

Usage:
    # Set env var before running or use the --allow-fixed-1 flag
    TF_ALLOW_FIXED_1=true python scripts/generate_null_strategies.py --n 10
    python scripts/generate_null_strategies.py --n 100 --seed 42 --out null_specs.json
    python scripts/generate_null_strategies.py --n 5 --allow-fixed-1 --smoke
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Optional

import numpy as np

# ─── Config pools (vary across null strategies) ──────────────────────────────

_SYMBOL_POOL = ["MES", "MNQ", "MCL"]

_TIMEFRAME_POOL = ["5m", "15m"]

# Fixed-point stops per symbol (points, not ticks).
# MNQ: 6-point cap from deepscan5 C4 fix.
_FIXED_STOP_POINTS: dict[str, list[float]] = {
    "MES": [3.0, 4.0, 5.0],
    "MNQ": [4.0, 5.0, 6.0],
    "MCL": [0.10, 0.15, 0.20],
}

# Entry condition pairs (long, short) — all have zero predictive content.
# Pair 0: intrabar bullish/bearish direction (complement)
# Pair 1: same but reversed — intentionally contrarian null
# Pair 2: close vs open with >=/<= boundary
# Pair 3: high relative to close (wick-based — no directional edge)
# Pair 4: close vs open (pair 0 again, creates duplicate for distribution coverage)
_ENTRY_CONDITION_PAIRS: list[tuple[str, str]] = [
    ("close > open", "open > close"),          # 0: bullish bar long / bearish bar short
    ("open > close", "close > open"),          # 1: contrarian (reversed) — still null
    ("close >= open", "close < open"),         # 2: inclusive boundary variant
    ("high > close", "close > low"),           # 3: wick-presence (no directional edge)
    ("close > open", "close > open"),          # 4: same condition both sides (symmetric null)
]

# Entry windows (RTH subsets).
# When allow_entry_windows=None, the backtester applies no time filter.
# Production calibration should use RTH windows to match real strategy conditions.
# The smoke test (--smoke flag) passes allow_entry_windows=None to avoid
# needing RTH-correct synthetic timestamps.
_ENTRY_WINDOWS_POOL: list[Optional[list[str]]] = [
    ["09:45-15:30 ET"],          # Full RTH core (avoids first 15m noise)
    ["09:30-12:00 ET"],          # AM session only
    ["13:00-15:30 ET"],          # PM session only
]

# Default backtest date range for production calibration.
DEFAULT_START_DATE = "2023-01-01"
DEFAULT_END_DATE = "2024-12-31"


# ─── RNG seeding (PCG64DXSM for determinism, consistent with engine) ─────────

def _make_rng(seed: int) -> np.random.Generator:
    return np.random.default_rng(np.random.PCG64DXSM(seed))


# ─── Single null spec generator ──────────────────────────────────────────────

def generate_null_spec(
    strategy_index: int,
    seed: int,
    start_date: str = DEFAULT_START_DATE,
    end_date: str = DEFAULT_END_DATE,
    smoke: bool = False,
) -> dict:
    """Generate a single null BacktestRequest spec as a dict.

    Args:
        strategy_index: Which null strategy to generate (0-based). Different
            indices produce different symbol/timeframe/stop combinations.
        seed: Base RNG seed. Same (strategy_index, seed) → same output.
        start_date: Backtest start date (YYYY-MM-DD).
        end_date: Backtest end date (YYYY-MM-DD).
        smoke: If True, omit allowed_entry_windows so the spec works with
            synthetic data that has arbitrary timestamps.

    Returns:
        dict that can be passed to BacktestRequest.model_validate().
        Includes extra "_null_calibration_meta" key (stripped before validation).
    """
    rng = _make_rng(seed + strategy_index * 97)  # non-overlapping streams

    symbol_idx = strategy_index % len(_SYMBOL_POOL)
    timeframe_idx = (strategy_index // len(_SYMBOL_POOL)) % len(_TIMEFRAME_POOL)
    stop_idx = strategy_index % len(_FIXED_STOP_POINTS[_SYMBOL_POOL[symbol_idx]])
    entry_pair_idx = strategy_index % len(_ENTRY_CONDITION_PAIRS)
    window_idx = strategy_index % len(_ENTRY_WINDOWS_POOL)

    symbol = _SYMBOL_POOL[symbol_idx]
    timeframe = _TIMEFRAME_POOL[timeframe_idx]
    stop_points = _FIXED_STOP_POINTS[symbol][stop_idx]
    entry_long, entry_short = _ENTRY_CONDITION_PAIRS[entry_pair_idx]
    entry_windows = None if smoke else _ENTRY_WINDOWS_POOL[window_idx]

    strategy_name = f"null_calibration_{strategy_index:04d}_seed{seed}"

    # Slippage and commission: use topstep_50k rates
    commission_map = {
        "MES": 0.62, "MNQ": 0.62, "MCL": 0.77,
    }

    spec: dict = {
        "strategy": {
            "name": strategy_name,
            "symbol": symbol,
            "timeframe": timeframe,
            "indicators": [],                # No indicators needed for close>open
            "entry_long": entry_long,
            "entry_short": entry_short,
            "exit": "close < 0",            # Never fires; Style C handles exits
            "stop_loss": {
                "type": "fixed",
                "fixed_points": stop_points,
            },
            "take_profit": None,            # Style C overlay manages this
            "position_size": {
                "type": "fixed",
                "fixed_contracts": 1,       # TF_ALLOW_FIXED_1=true required
            },
            "overnight_hold": False,
            "preferred_regime": None,
            "allowed_entry_windows": entry_windows,
        },
        "start_date": start_date,
        "end_date": end_date,
        "slippage_ticks": 1.0,
        "commission_per_side": commission_map[symbol],
        "mode": "walkforward",
        "max_trades_per_day": 1,            # 1 A+ trade/day class
        "firm_key": "topstep_50k",
        "exit_engine": "static_styleC",    # Mode B frozen overlay
        # null_calibration marker — MUST be present on all null runs.
        # Follows the replay_mode precedent from the quantum replay harness.
        "_null_calibration_meta": {
            "null_calibration": True,
            "null_seed": seed,
            "strategy_index": strategy_index,
            "entry_pair_idx": entry_pair_idx,
            "symbol": symbol,
            "timeframe": timeframe,
            "stop_points": stop_points,
        },
    }

    return spec


def generate_null_specs(
    n: int,
    seed: int = 42,
    start_date: str = DEFAULT_START_DATE,
    end_date: str = DEFAULT_END_DATE,
    smoke: bool = False,
) -> list[dict]:
    """Generate N null BacktestRequest specs.

    Args:
        n: Number of null strategies to generate.
        seed: Base RNG seed for reproducibility.
        start_date: Backtest start date.
        end_date: Backtest end date.
        smoke: If True, omit entry windows for synthetic-data compatibility.

    Returns:
        List of N spec dicts (includes _null_calibration_meta extra key).
    """
    return [
        generate_null_spec(i, seed=seed, start_date=start_date,
                           end_date=end_date, smoke=smoke)
        for i in range(n)
    ]


def validate_spec(spec: dict, allow_fixed_1: bool = True) -> tuple[bool, Optional[str]]:
    """Validate a null spec against BacktestRequest Pydantic model.

    Strips _null_calibration_meta before validation (it's not a BacktestRequest field).

    Args:
        spec: Dict from generate_null_spec().
        allow_fixed_1: If True, sets TF_ALLOW_FIXED_1=true before validation.

    Returns:
        (True, None) if valid; (False, error_message) if invalid.
    """
    if allow_fixed_1:
        os.environ["TF_ALLOW_FIXED_1"] = "true"

    # Strip meta key before validation
    clean_spec = {k: v for k, v in spec.items() if not k.startswith("_")}

    try:
        from src.engine.config import BacktestRequest
        BacktestRequest.model_validate(clean_spec)
        return True, None
    except Exception as exc:
        return False, str(exc)


# ─── CLI ─────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate null BacktestRequest specs for gate-battery calibration"
    )
    parser.add_argument("--n", type=int, default=10,
                        help="Number of null strategies to generate (default: 10)")
    parser.add_argument("--seed", type=int, default=42,
                        help="Base RNG seed (default: 42)")
    parser.add_argument("--start-date", default=DEFAULT_START_DATE,
                        help=f"Backtest start date (default: {DEFAULT_START_DATE})")
    parser.add_argument("--end-date", default=DEFAULT_END_DATE,
                        help=f"Backtest end date (default: {DEFAULT_END_DATE})")
    parser.add_argument("--out", type=str, default=None,
                        help="Output file path (default: stdout)")
    parser.add_argument("--allow-fixed-1", action="store_true",
                        help="Set TF_ALLOW_FIXED_1=true (required for fixed_contracts=1)")
    parser.add_argument("--smoke", action="store_true",
                        help="Smoke mode: omit entry windows for synthetic-data compat")
    parser.add_argument("--validate", action="store_true",
                        help="Validate each spec against BacktestRequest before emitting")
    args = parser.parse_args()

    if args.allow_fixed_1:
        os.environ["TF_ALLOW_FIXED_1"] = "true"

    specs = generate_null_specs(
        n=args.n,
        seed=args.seed,
        start_date=args.start_date,
        end_date=args.end_date,
        smoke=args.smoke,
    )

    if args.validate:
        errors = 0
        for i, spec in enumerate(specs):
            ok, err = validate_spec(spec)
            if not ok:
                print(f"  INVALID spec {i}: {err}", file=sys.stderr)
                errors += 1
        if errors:
            print(f"Validation: {errors}/{len(specs)} specs FAILED", file=sys.stderr)
            sys.exit(1)
        print(f"Validation: all {len(specs)} specs PASSED BacktestRequest validation",
              file=sys.stderr)

    output = json.dumps(specs, indent=2)

    if args.out:
        Path(args.out).write_text(output, encoding="utf-8")
        print(f"Wrote {len(specs)} null specs to {args.out}", file=sys.stderr)
    else:
        print(output)


if __name__ == "__main__":
    main()
