"""stop_geometry.py — Wave 2 (2026-07-16) unified stop-geometry contract (Python side).

Stdlib-only mirror of src/server/lib/stop-geometry.ts + contract-class.ts's
getStopCeilingPts. ONE bounded core, TWO role-separated helpers:

    managed_stop_pts(symbol, atr, config_mult) = min(ceiling, config_mult * atr)
        The stop a trade is MANAGED against (paper + backtest). NO floor — the
        backtest management layer has none; the MES 6pt floor lives ONLY in the
        DSL admission layer, which the tighter managed stop dominates.

    sizing_stop_pts(symbol, atr, config_mult) = min(max(config_mult*atr, floor or 0), ceiling)
        The stop distance the position SIZE is budgeted against. Floor widens
        (near-zero-ATR safety rail), shared ceiling caps.

INVARIANT (parity-gate + property-test per cell):
    sizing_stop_pts(s,a,m) >= managed_stop_pts(s,a,m)  for all inputs
    => dollar risk at the managed stop is always <= the sizing budget.

The per-symbol ceiling/floor tables + the two resolver functions were MOVED here
from backtester.py (which now imports them and keeps thin `_get_*`-prefixed
aliases so existing imports/tests still resolve). This module imports NOTHING
from the engine (no vectorbt, no numpy) so the CI parity gate can spawn it
cheaply and it can never transitively pull the JIT backtester.

Env keys are shared verbatim with the TS side (parity requirement):
    STOP_CEILING_PTS_MES / _MNQ / _MCL   (defaults 14.0 / 62.0 / 1.00)
    STOP_FLOOR_PTS_MES / _MNQ / _MCL     (defaults 6.0 / None / None)
Env is read at CALL TIME so the parity gate's env-override subprocess cases
resolve identically to the TS call-time reads.
"""

from __future__ import annotations

import os
from typing import Optional

# ─── Stop ceiling per symbol (moved from backtester.py Wave 21 E.3) ───────────
# Per CLAUDE.md §4: structural stops have a CEILING per instrument.
# Wave 1 Track 1A 2026-06-27 recalibration: MNQ 40→62, MCL 0.25→1.00, MES 14.0.
# Reads the SAME env vars as gate_block_analyzer.STRUCTURAL_STOP_CEILING_PTS so
# the two tables can NEVER diverge.
_STOP_CEILING_DEFAULTS: dict[str, tuple[str, float]] = {
    # symbol → (env_var_key, default_value)
    "MES": ("STOP_CEILING_PTS_MES", 14.0),
    "ES": ("STOP_CEILING_PTS_MES", 14.0),   # micro alias — shares MES env var
    "MNQ": ("STOP_CEILING_PTS_MNQ", 62.0),
    "NQ": ("STOP_CEILING_PTS_MNQ", 62.0),   # mini alias — shares MNQ env var
    "MCL": ("STOP_CEILING_PTS_MCL", 1.00),
    "CL": ("STOP_CEILING_PTS_MCL", 1.00),   # mini alias — shares MCL env var
}
_STOP_CEILING_DEFAULT: float = 14.0  # fallback for unknown symbols (MES default)


def get_stop_ceiling_for_symbol(symbol: str) -> float:
    """Return the maximum allowed stop distance (in points) for a given symbol.

    Reads env vars (STOP_CEILING_PTS_MES / _MNQ / _MCL) so this function and
    gate_block_analyzer.STRUCTURAL_STOP_CEILING_PTS share a single source of
    truth and can never diverge.

    Wave 1 Track 1A 2026-06-27 defaults:
        MES / ES  → 14.0 points (STOP_CEILING_PTS_MES, unchanged)
        MNQ / NQ  → 62.0 points (STOP_CEILING_PTS_MNQ, was 40)
        MCL / CL  →  1.0 points (STOP_CEILING_PTS_MCL, was 0.25)

    Unknown symbols fall back to the MES default (14.0 points).
    """
    sym = symbol.upper()
    if sym not in _STOP_CEILING_DEFAULTS:
        return _STOP_CEILING_DEFAULT
    env_key, default = _STOP_CEILING_DEFAULTS[sym]
    raw = os.environ.get(env_key)
    if raw is not None:
        try:
            return float(raw)
        except ValueError:
            return default
    return default


# ─── Stop floor per symbol (moved from backtester.py Wave 1 Track 1A) ─────────
# A floor widens a stop that is too tight (prevents trivial fills from noise).
# Only MES has a default floor (6.0 pt). MNQ/MCL floors are opt-in via env.
# A floor widens — it never skips (that is the ceiling's job).
_STOP_FLOOR_ENV_MAP: dict[str, tuple[str, Optional[float]]] = {
    "MES": ("STOP_FLOOR_PTS_MES", 6.0),
    "ES": ("STOP_FLOOR_PTS_MES", 6.0),   # micro alias
    "MNQ": ("STOP_FLOOR_PTS_MNQ", None),   # no default — opt-in via env
    "NQ": ("STOP_FLOOR_PTS_MNQ", None),
    "MCL": ("STOP_FLOOR_PTS_MCL", None),   # no default — opt-in via env
    "CL": ("STOP_FLOOR_PTS_MCL", None),
}


def get_stop_floor_for_symbol(symbol: str) -> Optional[float]:
    """Return the minimum stop distance (floor) in points for a given symbol.

    Returns None when no floor applies (unknown symbol or opt-in env unset for
    MNQ/MCL, or env explicitly 0/negative which disables the floor).

    Wave 1 Track 1A 2026-06-27 defaults:
        MES / ES  → 6.0 points (STOP_FLOOR_PTS_MES)
        MNQ / NQ  → None unless STOP_FLOOR_PTS_MNQ is set
        MCL / CL  → None unless STOP_FLOOR_PTS_MCL is set
    """
    sym = symbol.upper()
    if sym not in _STOP_FLOOR_ENV_MAP:
        return None
    env_key, default = _STOP_FLOOR_ENV_MAP[sym]
    raw = os.environ.get(env_key)
    if raw is not None:
        try:
            v = float(raw)
            return v if v > 0.0 else None  # 0 or negative = no floor
        except ValueError:
            return default
    return default


# ─── Two role-separated helpers ───────────────────────────────────────────────

def managed_stop_pts(symbol: str, atr: float, config_mult: float) -> float:
    """MANAGED stop distance = min(ceiling(symbol), config_mult * atr). NO floor."""
    return min(get_stop_ceiling_for_symbol(symbol), config_mult * atr)


def sizing_stop_pts(symbol: str, atr: float, config_mult: float) -> float:
    """SIZING stop distance = min(max(config_mult*atr, floor or 0), ceiling)."""
    floor = get_stop_floor_for_symbol(symbol)
    floor_v = floor if floor is not None else 0.0
    ceiling = get_stop_ceiling_for_symbol(symbol)
    return min(max(config_mult * atr, floor_v), ceiling)


# ─── CLI grid emitter for the CI parity gate ──────────────────────────────────
# The parity gate (scripts/check-ts-python-stop-geometry-parity.ts) writes a JSON
# grid `{"cells": [[symbol, atr, mult], ...]}` to this module's stdin and reads
# back `[{"managed": x, "sizing": y}, ...]` — the SAME grid the gate evaluates
# in-process against the TS helpers, so the two can be compared cell-by-cell.
if __name__ == "__main__":  # pragma: no cover — exercised via the parity gate
    import json
    import sys

    _payload = json.loads(sys.stdin.read() or "{}")
    _cells = _payload.get("cells", [])
    _out = []
    for _cell in _cells:
        _sym, _atr, _mult = _cell[0], float(_cell[1]), float(_cell[2])
        _out.append(
            {
                "managed": managed_stop_pts(_sym, _atr, _mult),
                "sizing": sizing_stop_pts(_sym, _atr, _mult),
            }
        )
    sys.stdout.write(json.dumps(_out))
