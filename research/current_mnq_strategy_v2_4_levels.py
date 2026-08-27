#!/usr/bin/env python3
"""Causal support/resistance map for Current MNQ v2.4.

Direct trader fidelity scope (2026-08-20): the active strategy map contains only
structural support/resistance zones plus active 15m FVG context. PDH/PDL/PWH/PWL
are inherited legacy concepts and are forbidden from v2.4 entry authorization or
confluence.

Two structural paths can create an executable 15m S/R zone:
1. ESTABLISHED: the multi-rejection quality engine.
2. EXCEPTIONAL_SINGLE_SWING: one confirmed pivot whose rejection wick is valid
   and whose displacement was exceptional versus the same-side regime that
   existed BEFORE that pivot confirmed.

Later pivots may never retroactively redefine whether an older swing was dramatic.
The reference window is anchored to each candidate's own confirmation time, so
older comparison pivots aging out of the current premarket window cannot silently
reclassify a previously-known swing. All zone roles use the v2.4 reclaim/break/
retest lifecycle. No PnL appears here.

Range-day fidelity: when causal pre-open structure is MIXED/ranging, a nearby
structural S/R zone is not deleted (it may still matter as reaction/TP context),
but it is not authorized as a fresh entry location unless price has the already-
frozen minimum room to break out of the range before reaching that zone.
"""
from __future__ import annotations

from dataclasses import replace
import json
import math
from pathlib import Path

import numpy as np
import pandas as pd

from research import current_mnq_strategy_v2_3_engine as prod
from research.current_mnq_strategy_v2_4_fvg import active_15m_fvgs
from research.current_mnq_strategy_v2_4_premarket import build_premarket_plan_v24
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


def _candidate_prior_reference_set(history: pd.DataFrame, side: str,
                                   candidate_confirm: pd.Timestamp,
                                   look_days: int) -> pd.DataFrame:
    start = candidate_confirm - pd.Timedelta(days=int(look_days))
    return history[
        (history.side == side) &
        (history.confirm >= start) &
        (history.confirm < candidate_confirm)
    ].copy()


def _empirical_rank(values: np.ndarray, x: float) -> float:
    if len(values) == 0:
        return 0.5
    return float(np.mean(values <= float(x)))


def _pivot_source_bar(h15: pd.DataFrame, row):
    """THE join: a pivot back to the candle that made it. One lookup, in one place.

    It used to end `except Exception: return 0.5`, which fabricated a quality term whenever
    the candle could not be found. The band is now drawn FROM this bar, so a silent fallback
    would draw a plausible zone unrelated to its candle and nothing would go red. It raises
    instead (ALGO-119 §3).
    """
    try:
        bar = h15.loc[row.t]
    except Exception as exc:
        raise RuntimeError(
            f"V24_PIVOT_SOURCE_BAR_JOIN_FAILED:{row.side}:{row.t}") from exc
    if isinstance(bar, pd.DataFrame):
        if bar.empty:
            raise RuntimeError(f"V24_PIVOT_SOURCE_BAR_JOIN_FAILED:{row.side}:{row.t}")
        bar = bar.iloc[0]
    return bar


def _rejection_band(bar, side: str) -> tuple[float, float]:
    """His zone, in his words (ALGO-073 §1, ruled §2):

        "i take a key zone with a wick and i draw the zone from the top of the wick to
         where the xandle closed"

    RESISTANCE: the top of the upper wick DOWN TO that candle's close.
    SUPPORT:    the mirror, the bottom of the lower wick UP TO that candle's close.

    The width is whatever that candle's wick-to-close IS. No pad, no ATR term, no tick floor
    and no rounding is added here, and none is needed: every pivot that reaches this point has
    already passed `wick >= p.min_wick` in this module's history filter, and `wick` is measured
    from the BODY EDGE, so `close - low >= min_wick * range > 0` on the support side and
    `high - close >= min_wick * range > 0` on the resistance side. A degenerate band is
    therefore unreachable — and it still raises rather than passing, so a later change to that
    filter fails loudly instead of drawing a zero-width zone.
    """
    if side == "S":
        lo, hi = float(bar.low), float(bar.close)
    else:
        lo, hi = float(bar.close), float(bar.high)
    if not (np.isfinite(lo) and np.isfinite(hi)) or hi <= lo:
        raise RuntimeError(f"V24_REJECTION_BAND_DEGENERATE:{side}:{lo}:{hi}")
    return lo, hi


def _pivot_close_away(bar, side: str) -> float:
    """Where the candle closed, as a fraction of its own range, away from the extreme."""
    rg = max(float(bar.high) - float(bar.low), core.TICK)
    if side == "S":
        return float(np.clip((float(bar.close) - float(bar.low)) / rg, 0.0, 1.0))
    return float(np.clip((float(bar.high) - float(bar.close)) / rg, 0.0, 1.0))


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
    if refs:
        raise RuntimeError("V24_LEGACY_PRIOR_DAY_WEEK_REFERENCE_FORBIDDEN")
    native_fvgs = native_fvgs or []

    history = piv15[
        (piv15.confirm <= asof) &
        (pd.to_numeric(piv15.wick, errors="coerce") >= float(p.min_wick))
    ].copy()
    q = history[history.t >= asof - pd.Timedelta(days=look)].copy()
    if q.empty:
        return []

    out: list[core.Location] = []
    for side in ("S", "R"):
        side_q = q[q.side == side].sort_values(["confirm", "t", "price"])
        if side_q.empty:
            continue
        for row in side_q.itertuples():
            prior = _candidate_prior_reference_set(history, side, row.confirm, look)
            threshold = _reference_threshold(prior, floor_atr, percentile, min_refs)
            prior_disp = pd.to_numeric(prior.disp, errors="coerce").dropna().to_numpy(float)
            if not np.isfinite(float(row.disp)) or float(row.disp) < threshold:
                continue
            # THE RULED BAND (ALGO-073 §2, built ALGO-119). The band comes from the source
            # rejection candle and from nothing else. The symmetric
            # `max(TICK * 4.0, key_level_pad_atr * atr)` construction that stood here drew a
            # ~2.4-point band centred ON the extreme; his is one-sided FROM it and is whatever
            # the candle's wick-to-close is. The join was already here — it is used, not
            # duplicated.
            bar = _pivot_source_bar(h15, row)
            lo, hi = _rejection_band(bar, side)
            level = float(row.price)
            if any(core.overlap(lo, hi, float(x.lo), float(x.hi), 0.0) for x in established):
                continue

            close_away = _pivot_close_away(bar, side)
            quality, wick_q, recency = _quality(row, threshold, prior_disp, asof, p, close_away)
            # Direct trader scope: only active FVG overlap may add confluence to
            # an S/R zone. No daily/weekly reference level vote exists in v2.4.
            confluence = int(any(core.overlap(lo, hi, float(f.lo), float(f.hi), 0.0)
                                 for f in native_fvgs))
            created = row.confirm
            # The identity stays anchored on the pivot's own LEVEL price: it is the same zone
            # — same pivot, same level, same side, same confirmation — and only its band SHAPE
            # changed. That is what keeps a before/after comparison joinable BY KEY.
            zid = f"SWING:{side}:{created.isoformat()}:{round(level/core.TICK)}"
            # `mid` is consumed as a band-INTERIOR reclaim/away threshold
            # (`zone_lifecycle.py:91`), and every other zone family already sets it to the
            # middle of its own band. On the ruled band the level price is an EDGE, so leaving
            # `mid` there would silently redefine what "reclaimed" means.
            mid = (lo + hi) / 2.0
            state = core.ZoneState.ACTIVE_SUPPORT if side == "S" else core.ZoneState.ACTIVE_RESISTANCE
            zone = core.Zone(
                id=zid, side=side, lo=float(lo), hi=float(hi), mid=float(mid),
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


def _range_room_authorization(locations: list[core.Location], env: dict, dte,
                              open_ts: pd.Timestamp, p: core.Params) -> list[core.Location]:
    """On a causal ranging/mixed morning, do not crowd fresh S/R entry zones.

    The location is preserved even when authorization is removed so target/blocker
    construction can still respect a nearby reaction area. No hindsight full-day
    range label or prior-day/week reference is used.
    """
    full5 = env["full5"]
    # ALGO-181: anchored at the decision clock; see build_premarket_plan_v24's docstring.
    plan = build_premarket_plan_v24(full5, dte, open_ts)
    if str(plan.pm_structure) != "MIXED":
        return locations
    pm = full5[
        (full5.index.date == dte) &
        (full5.index.time >= core.PRE_START) &
        (full5.index.time <= core.PRE_END) &
        (full5.index < open_ts)
    ]
    if len(pm) < 12:
        return locations
    range_lo = float(pm.low.min())
    range_hi = float(pm.high.max())
    min_room = float(p.min_room_r) * float(p.stop)
    out: list[core.Location] = []
    for loc in locations:
        authorized = bool(loc.entry_authorized)
        if loc.side == "R":
            travel_room = float(loc.lo) - range_hi
            authorized = authorized and travel_room >= min_room
        elif loc.side == "S":
            travel_room = range_lo - float(loc.hi)
            authorized = authorized and travel_room >= min_room
        out.append(replace(loc, entry_authorized=bool(authorized)))
    return out


def build_entry_locations_v24(env: dict, dte, open_ts: pd.Timestamp,
                              p: core.Params) -> tuple[list[core.Location], list[core.Zone]]:
    """Build pre-open S/R map with FVG confluence; no prior-day/week levels."""
    h15, piv15, full5 = env["h15"], env["piv15"], env["full5"]
    established_zones = core.build_zones(piv15, h15, open_ts, p, look_days=40)
    established_zones = [zone_state_at_v24(z, full5, open_ts, p) for z in established_zones]
    a15 = h15[h15.index + pd.Timedelta(minutes=15) <= open_ts].atr.tail(20).median()
    atr15 = float(a15) if np.isfinite(a15) else 20.0
    native_fvgs = active_15m_fvgs(h15, open_ts)

    # No PDH/PDL/PWH/PWL confluence. Structural S/R may be strengthened by an
    # active FVG overlap; otherwise exceptionally high-quality S/R stands alone.
    established_zones = core.enrich_confluence(established_zones, [], native_fvgs, atr15, p)
    established = [
        loc for loc in core.zone_locations(established_zones)
        if core.valid_location(loc.zone, p)
    ]
    swings = exceptional_single_swing_zones(
        piv15, h15, full5, open_ts, p,
        established=established, refs=[], native_fvgs=native_fvgs,
    )
    locations = _range_room_authorization(established + swings, env, dte, open_ts, p)
    return locations, established_zones + [x.zone for x in swings if x.zone is not None]
