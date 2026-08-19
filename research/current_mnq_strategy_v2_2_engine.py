#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import math
import os
import urllib.request
from dataclasses import dataclass, asdict, replace
from enum import Enum
from pathlib import Path
from typing import Iterable

import numpy as np
import pandas as pd

from research import current_mnq_strategy_v1_fast as v1
from research import current_mnq_strategy_v2_ab as v2

TZ = "America/New_York"
TICK = 0.25
POINT_VALUE = 2.0
CONTRACTS = 15
ROUND_TRIP_FEE = 1.22 * CONTRACTS
STOP_POINTS = 17.25
SOURCE_REPO = "axb0306/cme-futures-ohlc"
SOURCE_COMMIT = "60abd3fb6369c6ce0b6a4a65b0f2562fc96b1264"
SOURCE_CONTRACT_ID = "CON.F.US.MNQ.M26"
SOURCE_CONTRACT_NOTE = (
    "Pinned source updater identifies MNQ as M26. This development sample is therefore "
    "treated as a single-contract M26 research sample, NOT a then-active front-month series."
)
DATA_FILES = {
    "5m": "MNQ/MNQ_5min_20260120_20260415.csv",
    "1m": "MNQ/MNQ_1min_20260120_20260415.csv",
    "tick": "MNQ/MNQ_tick_20260309_20260415.csv",
}
TRADE_START = pd.Timestamp("09:30").time()
LAST_ENTRY = pd.Timestamp("12:00").time()
RTH_END = pd.Timestamp("15:59").time()
PRE_START = pd.Timestamp("04:00").time()
PRE_END = pd.Timestamp("09:29").time()
OVERNIGHT_START = pd.Timestamp("18:00").time()
MIN_WARMUP_DAYS = 60


class ZoneState(str, Enum):
    ACTIVE_SUPPORT = "ACTIVE_SUPPORT"
    ACTIVE_RESISTANCE = "ACTIVE_RESISTANCE"
    TESTED = "TESTED"
    BROKEN = "BROKEN"
    FLIPPED_RETEST = "FLIPPED_RETEST"
    RETIRED = "RETIRED"


@dataclass(frozen=True)
class Params:
    stop: float = STOP_POINTS
    ztol_atr: float = 0.18
    min_wick: float = 0.20
    min_disp_atr: float = 0.45
    min_zone_quality: float = 0.58
    high_zone_quality: float = 0.72
    body_frac: float = 0.62
    range_ratio: float = 1.25
    close_loc: float = 0.78
    reject_wick: float = 0.35
    breakout_clear_atr: float = 0.05
    touch_pad_atr: float = 0.10
    compression_ratio: float = 0.85
    weakening_ratio: float = 0.95
    min_room_r: float = 1.50
    tp_depth: float = 0.50
    recency_half_life_days: float = 20.0
    fvg_overlap_atr: float = 0.15
    key_level_pad_atr: float = 0.06
    weak_blocker_quality: float = 0.45
    strong_blocker_quality: float = 0.65
    entry_slip_points: float = 0.25
    exit_slip_points: float = 0.25
    latency_seconds: float = 0.0


PARAMETER_REGISTRY = {
    "ztol_atr": (0.14, 0.22, "ATR-normalized price clustering tolerance"),
    "min_wick": (0.16, 0.26, "minimum rejection wick fraction"),
    "min_disp_atr": (0.35, 0.60, "minimum post-rejection displacement in ATR"),
    "min_zone_quality": (0.52, 0.64, "minimum interpretable zone quality"),
    "high_zone_quality": (0.66, 0.78, "standalone high-quality zone threshold"),
    "body_frac": (0.56, 0.68, "strong candle body fraction"),
    "range_ratio": (1.10, 1.40, "strong candle range expansion"),
    "close_loc": (0.72, 0.84, "close near candle extreme"),
    "reject_wick": (0.28, 0.42, "rejection wick threshold"),
    "breakout_clear_atr": (0.03, 0.08, "clearance beyond zone"),
    "touch_pad_atr": (0.07, 0.13, "zone interaction tolerance"),
    "compression_ratio": (0.78, 0.92, "range compression"),
    "weakening_ratio": (0.88, 1.00, "body weakening"),
    "min_room_r": (1.25, 2.00, "minimum blocker-free room"),
    "tp_depth": (0.40, 0.60, "safe-middle depth inside destination"),
    "recency_half_life_days": (14.0, 30.0, "zone recency decay"),
    "fvg_overlap_atr": (0.10, 0.22, "FVG overlap tolerance"),
    "key_level_pad_atr": (0.04, 0.09, "key-level zone width"),
    "weak_blocker_quality": (0.35, 0.52, "shelf pass-through threshold"),
    "strong_blocker_quality": (0.58, 0.72, "hard blocker threshold"),
}


@dataclass
class Zone:
    id: str
    side: str
    lo: float
    hi: float
    mid: float
    touches: int
    wick_quality: float
    close_away: float
    displacement: float
    compactness: float
    independence: float
    recency: float
    quality: float
    created: pd.Timestamp
    last_event: pd.Timestamp
    source: str = "WICK_ZONE"
    confluence: int = 0
    state: ZoneState | str = ZoneState.ACTIVE_SUPPORT

    @property
    def active(self) -> bool:
        return self.state in (
            ZoneState.ACTIVE_SUPPORT,
            ZoneState.ACTIVE_RESISTANCE,
            ZoneState.TESTED,
            ZoneState.FLIPPED_RETEST,
        )


@dataclass
class Location:
    id: str
    side: str
    lo: float
    hi: float
    mid: float
    source: str
    quality: float
    confluence: int
    entry_authorized: bool
    zone: Zone | None = None


@dataclass
class FVG:
    side: str
    lo: float
    hi: float
    created: pd.Timestamp
    source: str = "FVG_ACTIVE_PARTIAL"

    @property
    def mid(self):
        return (self.lo + self.hi) / 2.0


@dataclass
class Target:
    location: Location
    raw_price: float
    executable_price: float
    distance: float
    quality: float
    blocker: bool
    destination: bool
    fvg_confluent: bool


@dataclass
class PremarketPlan:
    primary: str
    score: float
    continuation_side: str | None
    reversal_side: str | None
    invalidation: str
    pdh: float | None
    pdl: float | None
    pwh: float | None
    pwl: float | None
    overnight_high: float | None
    overnight_low: float | None
    overnight_mid: float | None
    gap_from_prev_close: float | None
    pm_control: float
    pm_structure: str
    location_state: str


@dataclass
class Story:
    approach: bool
    weakening: bool
    compression: bool
    rejection: bool
    failed_push: bool
    reclaim: bool
    takeover: bool
    displacement: bool
    follow_through: bool
    fight: bool
    decision: bool

    @property
    def complete(self) -> bool:
        return self.approach and self.fight and self.decision


@dataclass
class Candidate:
    direction: str
    setup: str
    location: Location
    story: Story | None
    signal_time: pd.Timestamp
    confirmed_time: pd.Timestamp
    reason: str


@dataclass
class PendingBreakout:
    direction: str
    location_id: str
    attempted_at: pd.Timestamp
    zone_lo: float
    zone_hi: float


def round_to_tick(price: float, mode: str = "nearest") -> float:
    ticks = price / TICK
    if mode == "down":
        k = math.floor(ticks + 1e-12)
    elif mode == "up":
        k = math.ceil(ticks - 1e-12)
    else:
        k = round(ticks)
    return float(k * TICK)


def tick_valid(price: float) -> bool:
    return abs(price / TICK - round(price / TICK)) < 1e-9


def executable_target(raw: float, direction: str) -> float:
    return round_to_tick(raw, "down" if direction == "L" else "up")


def executable_stop(raw: float, direction: str) -> float:
    return round_to_tick(raw, "up" if direction == "L" else "down")


def source_url(path: str) -> str:
    return f"https://raw.githubusercontent.com/{SOURCE_REPO}/{SOURCE_COMMIT}/{path}"


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def download_pinned(data_dir: Path, include_tick: bool = False) -> dict:
    data_dir.mkdir(parents=True, exist_ok=True)
    observed = {}
    for key in ("5m", "1m") + (("tick",) if include_tick else tuple()):
        rel = DATA_FILES[key]
        out = data_dir / Path(rel).name
        if not out.exists():
            urllib.request.urlretrieve(source_url(rel), out)
        x = pd.read_csv(out)
        tcol = "datetime"
        observed[key] = {
            "source_repo": SOURCE_REPO,
            "source_commit": SOURCE_COMMIT,
            "source_path": rel,
            "sha256": sha256_file(out),
            "bytes": out.stat().st_size,
            "rows": int(len(x)),
            "first_timestamp": str(x[tcol].iloc[0]) if len(x) else None,
            "last_timestamp": str(x[tcol].iloc[-1]) if len(x) else None,
            "contract_id": SOURCE_CONTRACT_ID,
            "contract_note": SOURCE_CONTRACT_NOTE,
        }
    return observed


def verify_manifest(observed: dict, lock: dict) -> None:
    for key, got in observed.items():
        exp = lock.get("files", {}).get(key)
        if not exp:
            raise RuntimeError(f"DATA_MANIFEST_MISSING:{key}")
        for field in ("source_commit", "source_path", "sha256", "rows", "first_timestamp", "last_timestamp"):
            if str(got.get(field)) != str(exp.get(field)):
                raise RuntimeError(f"DATA_MANIFEST_MISMATCH:{key}:{field}:{got.get(field)}!={exp.get(field)}")


def load_csv(path: Path) -> pd.DataFrame:
    x = pd.read_csv(path)
    x["datetime"] = pd.to_datetime(x["datetime"], utc=True)
    x = x.set_index("datetime").sort_index()
    x.index = x.index.tz_convert(TZ)
    return x


def data_quality_gate(raw1: pd.DataFrame, raw5: pd.DataFrame) -> dict:
    issues = []
    for name, x in (("1m", raw1), ("5m", raw5)):
        if x.index.has_duplicates:
            issues.append(f"{name}:duplicate_timestamps")
        if not x.index.is_monotonic_increasing:
            issues.append(f"{name}:non_monotonic")
        for c in ("open", "high", "low", "close"):
            bad_tick = ((x[c] / TICK - np.round(x[c] / TICK)).abs() > 1e-8).sum()
            if bad_tick:
                issues.append(f"{name}:off_tick_{c}:{int(bad_tick)}")
        bad_ohlc = ((x.high < x[["open", "close"]].max(axis=1)) |
                    (x.low > x[["open", "close"]].min(axis=1)) |
                    (x.high < x.low)).sum()
        if bad_ohlc:
            issues.append(f"{name}:ohlc_invariant:{int(bad_ohlc)}")
    one = raw1[["open", "high", "low", "close"]].copy()
    agg = one.resample("5min", origin="start_day", label="left", closed="left").agg(
        open=("open", "first"), high=("high", "max"), low=("low", "min"), close=("close", "last")
    ).dropna()
    shared = agg.index.intersection(raw5.index)
    a = agg.loc[shared]
    b = raw5.loc[shared, ["open", "high", "low", "close"]]
    diffs = (a - b).abs()
    mismatch = (diffs > 1e-8).any(axis=1)
    parity_rate = float((~mismatch).mean()) if len(shared) else 0.0
    if len(shared) < 100:
        issues.append("parity:insufficient_shared_bars")
    if parity_rate < 0.995:
        issues.append(f"parity:below_99.5:{parity_rate:.6f}")
    r5 = raw5[(raw5.index.time >= pd.Timestamp("09:30").time()) &
              (raw5.index.time <= pd.Timestamp("15:55").time())]
    counts = r5.groupby(r5.index.date).size()
    complete = counts[counts >= 76]
    return {
        "issues": issues,
        "shared_1m_5m": int(len(shared)),
        "parity_rate": parity_rate,
        "complete_rth_sessions": int(len(complete)),
        "total_rth_sessions": int(len(counts)),
        "status": "PASS" if not issues else "FAIL",
    }


def prev_maps(r5: pd.DataFrame):
    ds = r5.groupby(r5.index.date).agg(hi=("high", "max"), lo=("low", "min"), close=("close", "last"))
    dates = list(ds.index)
    pdm, pcm = {}, {}
    for i, d in enumerate(dates):
        if i:
            pdm[d] = (float(ds.iloc[i - 1].hi), float(ds.iloc[i - 1].lo))
            pcm[d] = float(ds.iloc[i - 1].close)
    tmp = r5.copy()
    tmp["wk"] = tmp.index.tz_localize(None).to_period("W-FRI")
    ws = tmp.groupby("wk").agg(hi=("high", "max"), lo=("low", "min"))
    wks = list(ws.index)
    prior = {wks[i]: (float(ws.iloc[i - 1].hi), float(ws.iloc[i - 1].lo)) for i in range(1, len(wks))}
    pwm = {d: prior.get(pd.Timestamp(d).to_period("W-FRI")) for d in dates}
    return pdm, pwm, pcm


def active_fvgs_partial(h: pd.DataFrame, asof: pd.Timestamp, look_days: int = 25) -> list[FVG]:
    q = h[(h.index + pd.Timedelta(minutes=15) <= asof) &
          (h.index >= asof - pd.Timedelta(days=look_days))]
    if len(q) < 3:
        return []
    lows = q.low.to_numpy(float)
    highs = q.high.to_numpy(float)
    fut_min = np.full(len(q), np.inf)
    fut_max = np.full(len(q), -np.inf)
    if len(q) > 1:
        fut_min[:-1] = np.minimum.accumulate(lows[:0:-1])[::-1]
        fut_max[:-1] = np.maximum.accumulate(highs[:0:-1])[::-1]
    raw = []
    for i in range(2, len(q)):
        a, c = q.iloc[i - 2], q.iloc[i]
        created = q.index[i] + pd.Timedelta(minutes=15)
        if c.low > a.high:
            lo, hi = float(a.high), float(c.low)
            m = fut_min[i]
            if m <= lo:
                continue
            rem_hi = hi if not np.isfinite(m) else min(hi, float(m))
            if rem_hi > lo:
                raw.append(FVG("S", lo, rem_hi, created))
        if c.high < a.low:
            lo, hi = float(c.high), float(a.low)
            m = fut_max[i]
            if m >= hi:
                continue
            rem_lo = lo if not np.isfinite(m) else max(lo, float(m))
            if hi > rem_lo:
                raw.append(FVG("R", rem_lo, hi, created))
    out = []
    for side in ("S", "R"):
        xs = sorted([f for f in raw if f.side == side], key=lambda f: (f.lo, f.hi))
        side_out = []
        for f in xs:
            if not side_out or f.lo > side_out[-1].hi:
                side_out.append(FVG(side, f.lo, f.hi, f.created))
            else:
                last = side_out[-1]
                side_out[-1] = FVG(side, min(last.lo, f.lo), max(last.hi, f.hi), min(last.created, f.created))
        out.extend(side_out)
    return out


def _weighted_median(values: np.ndarray, weights: np.ndarray) -> float:
    order = np.argsort(values)
    v = values[order]
    w = weights[order]
    c = np.cumsum(w) / np.sum(w)
    return float(v[np.searchsorted(c, 0.5)])


def _event_close_away(row, bar) -> float:
    rg = max(float(bar.high - bar.low), TICK)
    if row.side == "S":
        return float((bar.close - bar.low) / rg)
    return float((bar.high - bar.close) / rg)


def build_zones(piv: pd.DataFrame, bars: pd.DataFrame, asof: pd.Timestamp, p: Params, look_days: int = 40) -> list[Zone]:
    q = piv[(piv.confirm <= asof) & (piv.t >= asof - pd.Timedelta(days=look_days)) &
            (piv.wick >= p.min_wick) & (piv.disp >= p.min_disp_atr)].copy()
    if q.empty:
        return []
    zones: list[Zone] = []
    for side in ("S", "R"):
        s = q[q.side == side].sort_values(["price", "t"])
        if len(s) < 2:
            continue
        rows = list(s.itertuples())
        n = len(rows)
        parent = list(range(n))
        def find(i):
            while parent[i] != i:
                parent[i] = parent[parent[i]]
                i = parent[i]
            return i
        def union(i, j):
            a, b = find(i), find(j)
            if a != b:
                parent[b] = a
        for i in range(n):
            for j in range(i + 1, n):
                tol = p.ztol_atr * float(np.nanmedian([rows[i].atr, rows[j].atr]))
                if abs(rows[i].price - rows[j].price) <= max(TICK * 4, tol):
                    union(i, j)
                elif rows[j].price - rows[i].price > max(TICK * 8, tol * 2):
                    break
        groups = {}
        for i, r in enumerate(rows):
            groups.setdefault(find(i), []).append(r)
        for group in groups.values():
            independent = []
            for r in sorted(group, key=lambda z: z.t):
                if not independent or r.t - independent[-1].t >= pd.Timedelta(minutes=30):
                    independent.append(r)
            if len(independent) < 2:
                continue
            prices = np.array([r.price for r in independent], dtype=float)
            atrs = np.array([max(float(r.atr), TICK) for r in independent], dtype=float)
            wicks = np.array([float(r.wick) for r in independent], dtype=float)
            disps = np.array([float(r.disp) for r in independent], dtype=float)
            rec_days = np.array([(asof - r.confirm).total_seconds() / 86400 for r in independent])
            rec_w = np.exp(-math.log(2) * rec_days / p.recency_half_life_days)
            center = _weighted_median(prices, np.maximum(rec_w, 1e-6))
            med_atr = float(np.median(atrs))
            mad = float(np.median(np.abs(prices - np.median(prices))))
            compactness = float(np.clip(1.0 - (mad / max(med_atr * 0.30, TICK)), 0, 1))
            if len(prices) >= 5:
                lo0, hi0 = np.quantile(prices, [0.20, 0.80])
            else:
                lo0, hi0 = float(prices.min()), float(prices.max())
            pad = max(TICK, 0.05 * med_atr)
            lo, hi = float(lo0 - pad), float(hi0 + pad)
            close_away_vals = []
            for r in independent:
                try:
                    bar = bars.loc[r.t]
                    if isinstance(bar, pd.DataFrame):
                        bar = bar.iloc[0]
                    close_away_vals.append(_event_close_away(r, bar))
                except Exception:
                    close_away_vals.append(0.5)
            close_away = float(np.mean(close_away_vals))
            wick_q = float(np.clip((np.mean(wicks) - p.min_wick) / 0.40, 0, 1))
            disp_q = float(np.clip((np.median(disps) - p.min_disp_atr) / 1.00, 0, 1))
            close_q = float(np.clip((close_away - 0.50) / 0.45, 0, 1))
            recency = float(np.mean(rec_w))
            gaps = np.diff(sorted([r.t.value for r in independent])) / 3.6e12
            independence = float(np.clip(np.median(gaps) / 6.0, 0, 1)) if len(gaps) else 0.0
            touch_sat = float(min(1.0, math.log1p(len(independent)) / math.log(5)))
            quality = (0.22 * wick_q + 0.24 * disp_q + 0.16 * close_q +
                       0.16 * compactness + 0.10 * independence + 0.07 * recency + 0.05 * touch_sat)
            created = max(r.confirm for r in independent)
            last_event = max(r.t for r in independent)
            zid = f"{side}:{created.isoformat()}:{round(center/TICK)}"
            state = ZoneState.ACTIVE_SUPPORT if side == "S" else ZoneState.ACTIVE_RESISTANCE
            zones.append(Zone(zid, side, lo, hi, center, len(independent), wick_q, close_away,
                              float(np.mean(disps)), compactness, independence, recency, float(quality),
                              created, last_event, "WICK_ZONE", 0, state))
    return sorted(zones, key=lambda z: (z.mid, z.id))


def zone_state_at(zone: Zone, bars5: pd.DataFrame, asof: pd.Timestamp, p: Params) -> Zone:
    q = bars5[(bars5.index >= zone.created) & (bars5.index < asof)]
    if q.empty:
        return zone
    z = replace(zone)
    tests = 0
    broken_at = None
    for ts, r in q.iterrows():
        atr = float(r.get("atr", np.nan))
        clear = p.breakout_clear_atr * atr if np.isfinite(atr) else TICK * 2
        interacts = r.low <= z.hi and r.high >= z.lo
        if interacts:
            tests += 1
        if z.side == "S" and r.close < z.lo - clear:
            broken_at = ts
            break
        if z.side == "R" and r.close > z.hi + clear:
            broken_at = ts
            break
    if broken_at is None:
        if tests:
            z.state = ZoneState.TESTED
        return z
    z.state = ZoneState.BROKEN
    later = q[q.index > broken_at]
    if len(later):
        for _, r in later.iterrows():
            if r.low <= z.hi and r.high >= z.lo:
                if z.side == "S" and r.close <= z.mid:
                    z.state = ZoneState.FLIPPED_RETEST
                elif z.side == "R" and r.close >= z.mid:
                    z.state = ZoneState.FLIPPED_RETEST
                break
    return z


def overlap(a_lo, a_hi, b_lo, b_hi, tol=0.0):
    return not (a_hi < b_lo - tol or b_hi < a_lo - tol)


def enrich_confluence(zones: list[Zone], refs: list[float], fvgs: list[FVG], atr15: float, p: Params) -> list[Zone]:
    tol = max(TICK * 4, p.fvg_overlap_atr * max(atr15, TICK))
    out = []
    for z in zones:
        key_vote = int(any(z.lo - tol <= x <= z.hi + tol for x in refs))
        fvg_vote = int(any(overlap(z.lo, z.hi, f.lo, f.hi, tol) for f in fvgs))
        out.append(replace(z, confluence=key_vote + fvg_vote))
    return out


def valid_location(z: Zone, p: Params) -> bool:
    if not z.active:
        return False
    if z.quality < p.min_zone_quality:
        return False
    return bool(z.confluence >= 1 or z.quality >= p.high_zone_quality)


def make_key_locations(pdm, pwm, dte, atr15, p: Params) -> list[Location]:
    pad = max(TICK * 4, p.key_level_pad_atr * max(atr15, TICK))
    out = []
    def add(name, price):
        out.append(Location(name, "B", price - pad, price + pad, price, name, 0.80, 1, False, None))
    if dte in pdm:
        add("PDH", pdm[dte][0]); add("PDL", pdm[dte][1])
    if pwm.get(dte):
        add("PWH", pwm[dte][0]); add("PWL", pwm[dte][1])
    return out


def zone_locations(zones: list[Zone]) -> list[Location]:
    return [Location(z.id, z.side, z.lo, z.hi, z.mid, z.source, z.quality, z.confluence, True, z) for z in zones]


def premarket_plan(full5: pd.DataFrame, dte, pdm, pwm, pcm) -> PremarketPlan:
    day = full5[full5.index.date == dte]
    pm = day[(day.index.time >= PRE_START) & (day.index.time <= PRE_END)]
    if len(pm) < 12:
        return PremarketPlan("NEUTRAL", 0.0, None, None, "insufficient_premarket",
                             None, None, None, None, None, None, None, None, 0.0, "UNKNOWN", "UNKNOWN")
    p = v1.feat(pm)
    first, last = p.iloc[0], p.iloc[-1]
    atr5 = float(p.atr.dropna().tail(20).median()) if p.atr.notna().any() else float(p["range"].median())
    atr5 = max(atr5, 1.0)
    net = float(last.close - first.open)
    score = 0.0
    if net >= 0.75 * atr5: score += 1
    elif net <= -0.75 * atr5: score -= 1
    lh = p.tail(12)
    signed = np.sign(lh.close - lh.open) * (lh.body / lh["range"].replace(0, np.nan)).fillna(0)
    ctl = float(signed.mean())
    if ctl >= 0.15: score += 1
    elif ctl <= -0.15: score -= 1
    n = max(3, len(p) // 3)
    a, b = p.head(n), p.tail(n)
    if b.high.median() > a.high.median() and b.low.median() > a.low.median():
        structure = "UP"; score += 1
    elif b.high.median() < a.high.median() and b.low.median() < a.low.median():
        structure = "DOWN"; score -= 1
    else:
        structure = "MIXED"
    pdh = pdl = pwh = pwl = None
    location_state = "INSIDE_PRIOR_RANGE"
    if dte in pdm:
        pdh, pdl = pdm[dte]
        mid = (pdh + pdl) / 2
        if last.close > pdh:
            score += 1; location_state = "ABOVE_PDH"
        elif last.close < pdl:
            score -= 1; location_state = "BELOW_PDL"
        elif last.close > mid:
            score += 0.5; location_state = "UPPER_PRIOR_RANGE"
        else:
            score -= 0.5; location_state = "LOWER_PRIOR_RANGE"
    if pwm.get(dte):
        pwh, pwl = pwm[dte]
        if last.close > pwh: score += 0.5
        elif last.close < pwl: score -= 0.5
    prev_close = pcm.get(dte)
    gap = float(first.open - prev_close) if prev_close is not None else None
    if prev_close is not None:
        if last.close > prev_close + 0.25 * atr5: score += 0.5
        elif last.close < prev_close - 0.25 * atr5: score -= 0.5
    prior_date = (pd.Timestamp(dte) - pd.Timedelta(days=1)).date()
    ov = full5[(((full5.index.date == prior_date) & (full5.index.time >= OVERNIGHT_START)) |
                ((full5.index.date == dte) & (full5.index.time <= PRE_END)))]
    onh = float(ov.high.max()) if len(ov) else None
    onl = float(ov.low.min()) if len(ov) else None
    onm = (onh + onl) / 2 if onh is not None and onl is not None else None
    primary = "BULL" if score >= 1.5 else "BEAR" if score <= -1.5 else "NEUTRAL"
    cont = "L" if primary == "BULL" else "S" if primary == "BEAR" else None
    rev = "S" if primary == "BULL" else "L" if primary == "BEAR" else None
    invalidation = "opposite control-transfer at A+ location" if primary != "NEUTRAL" else "new directional acceptance"
    return PremarketPlan(primary, score, cont, rev, invalidation, pdh, pdl, pwh, pwl,
                         onh, onl, onm, gap, ctl, structure, location_state)


def strong_bar(r, direction: str, p: Params) -> bool:
    if direction == "L":
        return bool(r.close > r.open and r.bf >= p.body_frac and r.rr >= p.range_ratio and r.cl >= p.close_loc)
    return bool(r.close < r.open and r.bf >= p.body_frac and r.rr >= p.range_ratio and r.cl <= 1 - p.close_loc)


def prior_bars(full5: pd.DataFrame, ts: pd.Timestamp, n: int) -> pd.DataFrame:
    return full5[full5.index < ts].tail(n)


def reversal_story(full5: pd.DataFrame, ts: pd.Timestamp, r, direction: str, loc: Location, p: Params) -> Story:
    q = prior_bars(full5, ts, 6)
    if len(q) < 5:
        return Story(False, False, False, False, False, False, False, False, False, False, False)
    q5 = q.tail(5)
    approach = bool(q5.close.iloc[-1] < q5.open.iloc[0]) if direction == "L" else bool(q5.close.iloc[-1] > q5.open.iloc[0])
    bodies = q5.body.to_numpy(float)
    ranges = q5["range"].to_numpy(float)
    weakening = bool(np.nanmedian(bodies[-2:]) <= max(bodies[0], 1e-9) * p.weakening_ratio)
    inside = q5.high.iloc[-1] <= q5.high.iloc[-2] and q5.low.iloc[-1] >= q5.low.iloc[-2]
    compression = bool(inside or (np.isfinite(ranges[-1]) and ranges[-1] <= ranges[0] * p.compression_ratio))
    prev = q.iloc[-1]
    if direction == "L":
        rejection = bool(max(float(r.lw), float(prev.lw)) >= p.reject_wick)
        failed_push = bool(min(float(r.low), float(prev.low)) <= loc.mid and float(r.close) >= loc.mid)
        reclaim = bool(float(r.close) >= loc.mid and float(r.close) > float(prev.close))
        takeover = bool(bool(r.be) or strong_bar(r, "L", p))
        displacement = bool(takeover and (r.rr >= 1.0 or bool(r.be)))
        follow = bool(float(r.close) >= loc.mid and float(r.cl) >= 0.60)
    else:
        rejection = bool(max(float(r.uw), float(prev.uw)) >= p.reject_wick)
        failed_push = bool(max(float(r.high), float(prev.high)) >= loc.mid and float(r.close) <= loc.mid)
        reclaim = bool(float(r.close) <= loc.mid and float(r.close) < float(prev.close))
        takeover = bool(bool(r.se) or strong_bar(r, "S", p))
        displacement = bool(takeover and (r.rr >= 1.0 or bool(r.se)))
        follow = bool(float(r.close) <= loc.mid and float(r.cl) <= 0.40)
    fight = bool(rejection and (weakening or compression or failed_push) and reclaim)
    decision = bool(takeover and displacement and follow)
    return Story(approach, weakening, compression, rejection, failed_push, reclaim,
                 takeover, displacement, follow, fight, decision)


def plan_allows(plan: PremarketPlan, direction: str, setup: str, story: Story | None, loc: Location) -> bool:
    if plan.primary == "NEUTRAL":
        return True
    aligned = (plan.primary == "BULL" and direction == "L") or (plan.primary == "BEAR" and direction == "S")
    if aligned:
        return True
    return bool(setup == "REV" and story is not None and story.complete and
                (loc.confluence >= 2 or loc.quality >= 0.80))


def bar_interacts(loc: Location, r, pad: float) -> bool:
    return bool(r.low <= loc.hi + pad and r.high >= loc.lo - pad)


def decisive_outside(loc: Location, r, direction: str, p: Params) -> bool:
    clear = p.breakout_clear_atr * float(r.atr)
    if direction == "L":
        return bool(r.close > loc.hi + clear)
    return bool(r.close < loc.lo - clear)


def breakout_pressure(full5, ts, direction):
    q = prior_bars(full5, ts, 3)
    if len(q) < 3:
        return False
    if direction == "L":
        return bool((q.close > q.open).sum() >= 2 and q.close.iloc[-1] >= q.close.iloc[0])
    return bool((q.close < q.open).sum() >= 2 and q.close.iloc[-1] <= q.close.iloc[0])


def latest_new_15m_confirmation(h15: pd.DataFrame, pending: PendingBreakout, known_at: pd.Timestamp) -> pd.Timestamp | None:
    q = h15[(h15.index + pd.Timedelta(minutes=15) > pending.attempted_at) &
            (h15.index + pd.Timedelta(minutes=15) <= known_at)]
    for ts, r in q.iterrows():
        accepted = r.close > pending.zone_hi if pending.direction == "L" else r.close < pending.zone_lo
        rg = max(float(r.high - r.low), TICK)
        bf = abs(float(r.close - r.open)) / rg
        if accepted and bf >= 0.50:
            return ts + pd.Timedelta(minutes=15)
    return None


def _target_quality(loc: Location, fvg_conf: bool) -> float:
    source_bonus = 0.10 if loc.source in ("PDH", "PDL", "PWH", "PWL") else 0.0
    fvg_bonus = 0.08 if fvg_conf else 0.0
    conf_bonus = 0.05 * min(loc.confluence, 2)
    return float(np.clip(loc.quality + source_bonus + fvg_bonus + conf_bonus, 0, 1))


def build_target_locations(piv5: pd.DataFrame, full5: pd.DataFrame, h15: pd.DataFrame,
                           asof: pd.Timestamp, p: Params, pdm, pwm, dte) -> list[tuple[Location, bool]]:
    z = build_zones(piv5, full5, asof, p, look_days=25)
    z = [zone_state_at(x, full5, asof, p) for x in z]
    a15 = h15[h15.index + pd.Timedelta(minutes=15) <= asof].atr.tail(20).median()
    atr15 = float(a15) if np.isfinite(a15) else 20.0
    fvgs = active_fvgs_partial(h15, asof)
    refs = []
    if dte in pdm: refs += list(pdm[dte])
    if pwm.get(dte): refs += list(pwm[dte])
    z = enrich_confluence(z, refs, fvgs, atr15, p)
    locs = zone_locations([x for x in z if x.active])
    locs += make_key_locations(pdm, pwm, dte, atr15, p)
    out = []
    tol = max(TICK * 4, p.fvg_overlap_atr * atr15)
    for loc in locs:
        fvg_conf = any(overlap(loc.lo, loc.hi, f.lo, f.hi, tol) for f in fvgs)
        out.append((loc, fvg_conf))
    return out


def classify_path_and_destination(targets: list[tuple[Location, bool]], entry: float, direction: str,
                                  setup: str, p: Params, strong_momentum: bool):
    items = []
    for loc, fvg_conf in targets:
        if direction == "L":
            if loc.mid <= entry:
                continue
            raw = loc.lo + p.tp_depth * (loc.hi - loc.lo)
            dist = raw - entry
        else:
            if loc.mid >= entry:
                continue
            raw = loc.hi - p.tp_depth * (loc.hi - loc.lo)
            dist = entry - raw
        if dist <= 0:
            continue
        q = _target_quality(loc, fvg_conf)
        items.append((float(dist), loc, fvg_conf, q, float(raw)))
    items.sort(key=lambda x: x[0])
    if not items:
        return None, "NO_DESTINATION"
    min_room = p.min_room_r * p.stop
    chosen = None
    for dist, loc, fvg_conf, q, raw in items:
        if dist < min_room:
            if q >= p.strong_blocker_quality:
                return None, f"HARD_BLOCKER:{loc.source}:{dist:.2f}"
            if q > p.weak_blocker_quality and not (setup == "BRK5" and strong_momentum):
                return None, f"BLOCKER:{loc.source}:{dist:.2f}"
            continue
        major = bool(q >= 0.62 or loc.source in ("PDH", "PDL", "PWH", "PWL"))
        if setup == "BRK5" and strong_momentum:
            if major:
                chosen = (dist, loc, fvg_conf, q, raw); break
        else:
            if major:
                chosen = (dist, loc, fvg_conf, q, raw); break
    if chosen is None:
        return None, "NO_MAJOR_DESTINATION"
    dist, loc, fvg_conf, q, raw = chosen
    px = executable_target(raw, direction)
    return Target(loc, raw, px, abs(px - entry), q, False, True, fvg_conf), "OK"


def one_minute_entry(one: pd.DataFrame, actionable_at: pd.Timestamp, direction: str, p: Params):
    q = one[one.index >= actionable_at]
    if q.empty:
        return None
    ts = q.index[0]
    if ts.date() != actionable_at.date():
        return None
    raw_open = float(q.iloc[0].open)
    px = raw_open + p.entry_slip_points if direction == "L" else raw_open - p.entry_slip_points
    return ts, round_to_tick(px, "up" if direction == "L" else "down"), raw_open


def exit_1m_realistic(one: pd.DataFrame, entry_time: pd.Timestamp, direction: str, entry: float, target: float, p: Params):
    raw_stop = entry - p.stop if direction == "L" else entry + p.stop
    stop = executable_stop(raw_stop, direction)
    q = one[(one.index >= entry_time) & (one.index.date == entry_time.date()) & (one.index.time <= RTH_END)]
    mfe = 0.0
    mae = 0.0
    for ts, r in q.iterrows():
        if direction == "L":
            mfe = max(mfe, float(r.high - entry))
            mae = min(mae, float(r.low - entry))
            if float(r.open) <= stop:
                raw_fill = min(stop, float(r.open)) - p.exit_slip_points
                return ts, round_to_tick(raw_fill, "down"), "STOP_GAP", mfe, mae
            hit_s = float(r.low) <= stop
            hit_t = float(r.high) >= target + TICK
            if hit_s:
                raw_fill = stop - p.exit_slip_points
                return ts, round_to_tick(raw_fill, "down"), "STOP_AMBIG" if hit_t else "STOP", mfe, mae
            if hit_t:
                return ts, target, "TARGET_TRADETHROUGH", mfe, mae
        else:
            mfe = max(mfe, float(entry - r.low))
            mae = min(mae, float(entry - r.high))
            if float(r.open) >= stop:
                raw_fill = max(stop, float(r.open)) + p.exit_slip_points
                return ts, round_to_tick(raw_fill, "up"), "STOP_GAP", mfe, mae
            hit_s = float(r.high) >= stop
            hit_t = float(r.low) <= target - TICK
            if hit_s:
                raw_fill = stop + p.exit_slip_points
                return ts, round_to_tick(raw_fill, "up"), "STOP_AMBIG" if hit_t else "STOP", mfe, mae
            if hit_t:
                return ts, target, "TARGET_TRADETHROUGH", mfe, mae
    if len(q):
        raw = float(q.iloc[-1].close) - p.exit_slip_points if direction == "L" else float(q.iloc[-1].close) + p.exit_slip_points
        return q.index[-1], round_to_tick(raw, "down" if direction == "L" else "up"), "FLAT", mfe, mae
    return entry_time, entry, "NO1M", mfe, mae


def prepare(raw5: pd.DataFrame, raw1: pd.DataFrame):
    full5 = v1.feat(raw5.copy())
    r5 = v1.feat(raw5[(raw5.index.time >= pd.Timestamp("09:30").time()) &
                       (raw5.index.time <= pd.Timestamp("15:59").time())].copy())
    one = raw1[(raw1.index.time >= pd.Timestamp("09:30").time()) &
               (raw1.index.time <= pd.Timestamp("15:59").time())].copy()
    h15 = v1.htf15(full5)
    piv15 = v1.pivots(h15, mins=15)
    piv5 = v1.pivots(full5, mins=5)
    pdm, pwm, pcm = prev_maps(r5)
    return dict(full5=full5, r5=r5, one=one, h15=h15, piv15=piv15, piv5=piv5, pdm=pdm, pwm=pwm, pcm=pcm)


def scoreable_days(env) -> list:
    days = sorted(set(env["r5"].index.date))
    if not days:
        return []
    first_data = env["full5"].index.min()
    out = []
    for d in days:
        open_ts = pd.Timestamp(f"{d} 09:30", tz=TZ)
        if open_ts - first_data < pd.Timedelta(days=MIN_WARMUP_DAYS):
            continue
        session = env["r5"][env["r5"].index.date == d]
        if len(session) < 76:
            continue
        out.append(d)
    return out


def build_entry_locations(env, dte, open_ts, p: Params):
    h15, piv15, full5 = env["h15"], env["piv15"], env["full5"]
    zones = build_zones(piv15, h15, open_ts, p, look_days=40)
    zones = [zone_state_at(z, full5, open_ts, p) for z in zones]
    a15 = h15[h15.index + pd.Timedelta(minutes=15) <= open_ts].atr.tail(20).median()
    atr15 = float(a15) if np.isfinite(a15) else 20.0
    fvgs = active_fvgs_partial(h15, open_ts)
    refs = []
    if dte in env["pdm"]: refs += list(env["pdm"][dte])
    if env["pwm"].get(dte): refs += list(env["pwm"][dte])
    zones = enrich_confluence(zones, refs, fvgs, atr15, p)
    zloc = [loc for loc in zone_locations(zones) if valid_location(loc.zone, p)]
    keys = make_key_locations(env["pdm"], env["pwm"], dte, atr15, p)
    return zloc + keys, zones


def run_day(env, dte, p: Params):
    full5, r5, one, h15 = env["full5"], env["r5"], env["one"], env["h15"]
    session = r5[r5.index.date == dte]
    if len(session) < 76:
        return None
    open_ts = session.index[0]
    plan = premarket_plan(full5, dte, env["pdm"], env["pwm"], env["pcm"])
    locations, _ = build_entry_locations(env, dte, open_ts, p)
    authorized = [x for x in locations if x.entry_authorized]
    pending: dict[tuple[str, str], PendingBreakout] = {}
    for i in range(0, len(session)):
        ts = session.index[i]
        if ts.time() < TRADE_START:
            continue
        r = session.iloc[i]
        bar_close = ts + pd.Timedelta(minutes=5)
        if not np.isfinite(r.atr):
            continue
        current_locs = []
        for loc in authorized:
            if loc.zone is None:
                current_locs.append(loc); continue
            zs = zone_state_at(loc.zone, full5, bar_close, p)
            if zs.active:
                current_locs.append(replace(loc, zone=zs, quality=zs.quality, confluence=zs.confluence))
        candidates: list[Candidate] = []
        pad = max(TICK * 2, p.touch_pad_atr * float(r.atr))
        for direction, side in (("L", "S"), ("S", "R")):
            near = [loc for loc in current_locs if loc.side == side and bar_interacts(loc, r, pad)]
            for loc in near:
                story = reversal_story(full5, ts, r, direction, loc, p)
                if story.complete and plan_allows(plan, direction, "REV", story, loc):
                    candidates.append(Candidate(direction, "REV", loc, story, ts, bar_close, "COMPLETE_REVERSAL"))
        for direction, side in (("L", "R"), ("S", "S")):
            relevant = [loc for loc in current_locs if loc.side == side]
            for loc in relevant:
                if not decisive_outside(loc, r, direction, p):
                    continue
                if not breakout_pressure(full5, ts, direction):
                    continue
                if strong_bar(r, direction, p):
                    if plan_allows(plan, direction, "BRK5", None, loc):
                        candidates.append(Candidate(direction, "BRK5", loc, None, ts, bar_close, "STRONG_5M_ACCEPTANCE"))
                else:
                    key = (direction, loc.id)
                    pending.setdefault(key, PendingBreakout(direction, loc.id, bar_close, loc.lo, loc.hi))
        for key, pen in list(pending.items()):
            loc = next((x for x in current_locs if x.id == pen.location_id), None)
            if loc is None:
                pending.pop(key, None); continue
            confirmed = latest_new_15m_confirmation(h15, pen, bar_close)
            if confirmed is not None and confirmed <= bar_close:
                if plan_allows(plan, pen.direction, "BRK15", None, loc):
                    candidates.append(Candidate(pen.direction, "BRK15", loc, None, pen.attempted_at, confirmed, "NEW_15M_ACCEPTANCE"))
                pending.pop(key, None)
        if not candidates:
            continue
        if len(set(c.direction for c in candidates)) != 1:
            continue
        rank = {"BRK5": 3, "BRK15": 2, "REV": 1}
        cand = max(candidates, key=lambda c: (rank[c.setup], c.location.quality, c.location.confluence))
        actionable = max(bar_close, cand.confirmed_time)
        if actionable.time() > LAST_ENTRY:
            continue
        ent = one_minute_entry(one, actionable, cand.direction, p)
        if ent is None:
            continue
        entry_time, entry, raw_open = ent
        if entry_time.time() > LAST_ENTRY:
            continue
        targets = build_target_locations(env["piv5"], full5, h15, entry_time, p, env["pdm"], env["pwm"], dte)
        picked, path_reason = classify_path_and_destination(targets, entry, cand.direction, cand.setup, p, cand.setup == "BRK5")
        if picked is None:
            continue
        exit_time, exit_px, why, mfe, mae = exit_1m_realistic(one, entry_time, cand.direction, entry, picked.executable_price, p)
        pts = exit_px - entry if cand.direction == "L" else entry - exit_px
        gross = pts * POINT_VALUE * CONTRACTS
        net = gross - ROUND_TRIP_FEE
        stop = executable_stop(entry - p.stop if cand.direction == "L" else entry + p.stop, cand.direction)
        assert all(tick_valid(x) for x in (entry, stop, picked.executable_price, exit_px))
        return {
            "session": str(dte), "signal_time": str(cand.signal_time), "confirmed_time": str(cand.confirmed_time),
            "entry_time": str(entry_time), "side": "LONG" if cand.direction == "L" else "SHORT",
            "setup": cand.setup, "premarket_primary": plan.primary, "premarket_score": plan.score,
            "premarket_structure": plan.pm_structure, "premarket_location": plan.location_state,
            "entry_location": cand.location.source, "location_quality": cand.location.quality,
            "location_confluence": cand.location.confluence, "entry_raw_open": raw_open, "entry": entry,
            "stop": stop, "target_raw": picked.raw_price, "target": picked.executable_price,
            "target_points": abs(picked.executable_price - entry), "target_source": picked.location.source,
            "target_quality": picked.quality, "path_reason": path_reason, "exit_time": str(exit_time),
            "exit_price": exit_px, "exit_reason": why, "gross_pnl": gross, "fees": ROUND_TRIP_FEE,
            "net_pnl": net, "r": pts / p.stop, "mfe_points": mfe, "mae_points": mae,
            "contract_id": SOURCE_CONTRACT_ID,
        }
    return None


def run_backtest(env, p: Params, days: Iterable | None = None) -> pd.DataFrame:
    days = list(days) if days is not None else scoreable_days(env)
    rows = []
    for d in days:
        row = run_day(env, d, p)
        if row:
            rows.append(row)
    return pd.DataFrame(rows)


def metrics(ledger: pd.DataFrame) -> dict:
    if ledger.empty:
        return {"trades": 0, "net_pnl": 0.0}
    x = ledger.net_pnl.to_numpy(float)
    w, l = x[x > 0], x[x < 0]
    eq = np.cumsum(x)
    peak = np.maximum.accumulate(np.r_[0.0, eq])[:-1]
    dd = eq - peak
    return {
        "trades": int(len(x)), "win_rate": float((x > 0).mean()), "net_pnl": float(x.sum()),
        "avg_trade": float(x.mean()), "profit_factor": float(w.sum() / abs(l.sum())) if len(l) else math.inf,
        "max_close_dd": float(dd.min()) if len(dd) else 0.0,
        "avg_winner": float(w.mean()) if len(w) else None, "median_winner": float(np.median(w)) if len(w) else None,
        "avg_loser": float(l.mean()) if len(l) else None, "median_target_points": float(ledger.target_points.median()),
        "avg_target_points": float(ledger.target_points.mean()), "longs": int((ledger.side == "LONG").sum()),
        "shorts": int((ledger.side == "SHORT").sum()),
    }


def intratrade_equity_risk(ledger: pd.DataFrame) -> dict:
    if ledger.empty:
        return {}
    running = 0.0; peak = 0.0; worst = 0.0; worst_trade_mae_cash = 0.0
    for r in ledger.itertuples():
        mae_cash = float(r.mae_points) * POINT_VALUE * CONTRACTS
        worst_trade_mae_cash = min(worst_trade_mae_cash, mae_cash)
        intralow = running + mae_cash - ROUND_TRIP_FEE
        worst = min(worst, intralow - peak)
        running += float(r.net_pnl)
        peak = max(peak, running)
        worst = min(worst, running - peak)
    return {"mae_aware_drawdown": worst, "worst_trade_mae_cash": worst_trade_mae_cash}


def deterministic_perturbations(base: Params, n: int = 24, seed: int = 22026) -> list[tuple[str, Params]]:
    rng = np.random.default_rng(seed)
    keys = list(PARAMETER_REGISTRY)
    strata = (np.arange(n)[:, None] + rng.random((n, len(keys)))) / n
    for j in range(len(keys)):
        rng.shuffle(strata[:, j])
    out = [("BASE", base)]
    for i in range(n):
        kw = asdict(base)
        for j, k in enumerate(keys):
            lo, hi, _ = PARAMETER_REGISTRY[k]
            kw[k] = float(lo + strata[i, j] * (hi - lo))
        out.append((f"LHS{i+1:02d}", Params(**kw)))
    return out


def stress_slippage_profiles(base: Params):
    return [
        ("SLIP_0_5", replace(base, entry_slip_points=0.25, exit_slip_points=0.25)),
        ("SLIP_1", replace(base, entry_slip_points=0.50, exit_slip_points=0.50)),
        ("SLIP_2", replace(base, entry_slip_points=1.00, exit_slip_points=1.00)),
        ("SLIP_4", replace(base, entry_slip_points=2.00, exit_slip_points=2.00)),
    ]


def synthetic_fidelity_fixtures() -> dict:
    checks = {}
    checks["tick_round_long_target"] = executable_target(20000.375, "L") == 20000.25
    checks["tick_round_short_target"] = executable_target(20000.125, "S") == 20000.25
    checks["all_registry_named"] = all(len(v) == 3 and isinstance(v[2], str) for v in PARAMETER_REGISTRY.values())
    checks["polarity_contract"] = {"REV_LONG": "SUPPORT", "REV_SHORT": "RESISTANCE",
                                    "BRK_LONG": "RESISTANCE", "BRK_SHORT": "SUPPORT"}
    return checks
