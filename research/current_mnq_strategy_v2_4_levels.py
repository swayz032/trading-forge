#!/usr/bin/env python3
"""Causal key-level map for Current MNQ v2.4.

Two structural paths can create an executable 15m zone:
1. ESTABLISHED: the multi-rejection quality engine.
2. EXCEPTIONAL_SINGLE_SWING: one confirmed pivot whose rejection wick is valid
   and whose displacement was exceptional versus the same-side regime that
   existed BEFORE that pivot confirmed.

Later pivots may never retroactively redefine whether an older swing was dramatic.
All zone roles use the v2.4 reclaim/break/retest lifecycle. No PnL appears here.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import pandas as pd

from research import current_mnq_strategy_v2_3_engine as prod
from research.current_mnq_strategy_v2_4_fvg import active_15m_fvgs
from research.current_mnq_strategy_v2_4_zone_lifecycle import zone_state_at_v24

core = prod.core
SPEC_PATH = Path(__file__).with_name("current_mnq_strategy_v2_4_key_level_semantics.json")
SOURCE = "STRONG_SWING_DISPLACEMENT"


def load_key_level_spec(path: str | Path = SPEC_PATH) -> dict:
    return json.loads(Path(path).read_text())


def _reference_threshold(q: pd.DataFrame, floor_atr: float,
                         percentile: float, min_refs: int) -> float:
    disp = pd.to_numeric(q.get("disp", pd.Series(dtype=float)), errors="coerce")
    disp = disp[np.isfinite(disp)]
    if len(disp) < int(min_refs):
        return float(floor_atr)
    return float(max(float(floor_atr), float(np.quantile(disp.to_numpy(float), percentile))))


def _empirical_rank(values: np.ndarray, x: float) -> float:
    if len(values) == 0:
        return 0.5
    return float(np.mean(values <= float(x)))


def _pivot_close_away(h15: pd.DataFrame, row) -> float:
    try:
        bar = h15.loc[row.t]
        if isinstance(bar, pd.DataFrame):
            bar = bar.iloc[0]
        rg = max(float(bar.high - bar.low), core.TICK)
        if row.side == "S":
            return float(np.clip((float(bar.close) - float(bar.low)) / rg, 0.0, 1.0))
        return float(np.clip((float(bar.high) - float(bar.close)) / rg, 0.0, 1.0))
    except Exception:
        return 0.5


def _quality(row, threshold: float, prior_same_side_disp: np.ndarray,
             asof: pd.Timestamp, p: core.Params, close_away: float) -> tuple[float, float, float]:
    wick_q = float(np.clip((float(row.wick) - float(p.min_wick)) /
                           max(1.0 - float(p.min_wick), 1e-9), 0.0, 1.0))
    disp_rank = _empirical_rank(prior_same_side_disp, float(row.disp))
    disp_strength = float(np.clip(float(row.disp) / max(float(threshold) * 1.5, 1e-9), 0.0, 1.0))
    days = max(0.0, (asof - row.confirm).total_seconds() / 86400.0)
    recency = float(math.exp(-math.log(2.0) * days / max(float(p.recency_half_life_days), 1e-9)))
    quality = float(np.clip(
        0.35 * disp_rank + 0.25 * disp_strength +
        0.15 * wick_q + 0.15 * recency + 0.10 * float(close_away),
        0.0, 1.0,
    ))
    return quality, wick_q, recency


def exceptional_single_swing_zones(piv15: pd.DataFrame, h15: pd.DataFrame,
                                   full5: pd.DataFrame, asof: pd.Timestamp,
                                   p: core.Params,
                                   established: list[core.Location] | None = None,
                                   refs: list[float] | None = None,
                                   native_fvgs: list | None = None,
                                   spec: dict | None = None) -> list[core.Location]:
    spec = spec or load_key_level_spec()
    rule = spec["exceptional_single_swing_path"]
    if piv15 is None or piv15.empty:
        return []
    required = {"t", "confirm", "side", "price", "wick", "disp", "atr"}
    if not required.issubset(piv15.columns):
        raise RuntimeError(f"V24_PIVOT_SCHEMA_MISSING:{sorted(required-set(piv15.columns))}")

    look = int(rule["lookback_calendar_days"])
    floor_atr = float(rule["absolute_displacement_floor_atr"])
    percentile = float(rule["recent_displacement_percentile"])
    min_refs = int(rule["minimum_reference_pivots_for_percentile"])
    established = established or []
    refs = refs or []
    native_fvgs = native_fvgs or []

    q = piv15[
        (piv15.confirm <= asof) &
        (piv15.t >= asof - pd.Timedelta(days=look)) &
        (pd.to_numeric(piv15.wick, errors="coerce") >= float(p.min_wick))
    ].copy()
    if q.empty:
        return []

    out: list[core.Location] = []
    for side in ("S", "R"):
        side_q = q[q.side == side].sort_values(["confirm", "t", "price"])
        if side_q.empty:
            continue
        for row in side_q.itertuples():
            prior = side_q[side_q.confirm < row.confirm]
            threshold = _reference_threshold(prior, floor_atr, percentile, min_refs)
            prior_disp = pd.to_numeric(prior.disp, errors="coerce").dropna().to_numpy(float)
            if not np.isfinite(float(row.disp)) or float(row.disp) < threshold:
                continue
            atr = max(float(row.atr), core.TICK)
            half = max(core.TICK * 4.0, float(p.key_level_pad_atr) * atr)
            center = float(row.price)
            lo, hi = center - half, center + half
            if any(core.overlap(lo, hi, float(x.lo), float(x.hi), 0.0) for x in established):
                continue

            close_away = _pivot_close_away(h15, row)
            quality, wick_q, recency = _quality(row, threshold, prior_disp, asof, p, close_away)
            confluence = int(any(lo <= float(x) <= hi for x in refs))
            confluence += int(any(core.overlap(lo, hi, float(f.lo), float(f.hi), 0.0)
                                  for f in native_fvgs))
            created = row.confirm
            zid = f"SWING:{side}:{created.isoformat()}:{round(center/core.TICK)}"
            state = core.ZoneState.ACTIVE_SUPPORT if side == "S" else core.ZoneState.ACTIVE_RESISTANCE
            zone = core.Zone(
                id=zid, side=side, lo=float(lo), hi=float(hi), mid=center,
                touches=1, wick_quality=wick_q, close_away=close_away,
                displacement=float(row.disp), compactness=1.0,
                independence=0.0, recency=recency, quality=quality,
                created=created, last_event=row.t, source=SOURCE,
                confluence=int(confluence), state=state,
            )
            zone = zone_state_at_v24(zone, full5, asof, p)
            if not zone.active:
                continue
            out.append(core.Location(
                id=zone.id, side=zone.side, lo=zone.lo, hi=zone.hi,
                mid=zone.mid, source=SOURCE, quality=zone.quality,
                confluence=zone.confluence, entry_authorized=True, zone=zone,
            ))

    chosen: list[core.Location] = []
    for loc in sorted(out, key=lambda x: (-x.quality, -x.confluence, x.mid, x.id)):
        if any(x.side == loc.side and core.overlap(x.lo, x.hi, loc.lo, loc.hi, 0.0) for x in chosen):
            continue
        chosen.append(loc)
    return sorted(chosen, key=lambda x: (x.mid, x.id))


def build_entry_locations_v24(env: dict, dte, open_ts: pd.Timestamp,
                              p: core.Params) -> tuple[list[core.Location], list[core.Zone]]:
    """Build frozen pre-open entry map with native FVG confluence and role flips."""
    h15, piv15, full5 = env["h15"], env["piv15"], env["full5"]
    established_zones = core.build_zones(piv15, h15, open_ts, p, look_days=40)
    established_zones = [zone_state_at_v24(z, full5, open_ts, p) for z in established_zones]
    a15 = h15[h15.index + pd.Timedelta(minutes=15) <= open_ts].atr.tail(20).median()
    atr15 = float(a15) if np.isfinite(a15) else 20.0
    native_fvgs = active_15m_fvgs(h15, open_ts)
    refs: list[float] = []
    if dte in env["pdm"]:
        refs += list(env["pdm"][dte])
    if env["pwm"].get(dte):
        refs += list(env["pwm"][dte])

    established_zones = core.enrich_confluence(established_zones, refs, native_fvgs, atr15, p)
    established = [
        loc for loc in core.zone_locations(established_zones)
        if core.valid_location(loc.zone, p)
    ]
    swings = exceptional_single_swing_zones(
        piv15, h15, full5, open_ts, p,
        established=established, refs=refs, native_fvgs=native_fvgs,
    )
    keys = core.make_key_locations(env["pdm"], env["pwm"], dte, atr15, p)
    return established + swings + keys, established_zones + [x.zone for x in swings if x.zone is not None]
