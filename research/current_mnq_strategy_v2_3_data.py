#!/usr/bin/env python3
"""Roll-correct, causal MNQ dataset builder for v2.3 production validation.

Important design choice: the research stream is FORWARD-adjusted at each roll.
Past bars are never rewritten using a future roll. Instead, when a new lead
contract takes over, that new segment is shifted by the observed old/new basis at
a predeclared overlap window. This removes artificial roll gaps without future
information. Every row retains contract_id, raw prices and the applied adjustment.

Credentialed ProjectX collection is intentionally LOCAL-ONLY. GitHub Actions may
unit-test this module with fixtures but may not authenticate or pull user data.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from typing import Iterable

import numpy as np
import pandas as pd

from research.current_mnq_strategy_v2_2_contracts import projectx_contract_id
from research.current_mnq_strategy_v2_2_projectx_history import (
    HistoryRequest,
    ProjectXHistory,
    UNIT_MINUTE,
)
from research.current_mnq_strategy_v2_3_local_runtime import require_personal_device

TZ = "America/New_York"
TICK = 0.25


@dataclass(frozen=True)
class ContractWindow:
    contract_id: str
    start: date
    end: date


@dataclass(frozen=True)
class RollBridge:
    roll_date: str
    old_contract: str
    new_contract: str
    anchor_start: str
    anchor_end: str
    shared_minutes: int
    raw_gap_new_minus_old: float


@dataclass(frozen=True)
class DatasetManifest:
    schema_version: int
    requested_start: str
    requested_end: str
    warmup_start: str
    generated_utc: str
    source: str
    source_unit: str
    tick_size: float
    raw_contract_files: dict
    roll_bridges: list[dict]
    continuous_1m: dict
    continuous_5m: dict
    sessions: int
    contract_sessions: dict


def sha256_file(path: str | Path) -> str:
    h = hashlib.sha256()
    with Path(path).open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def canonical_hash(obj: dict) -> str:
    payload = json.dumps(obj, sort_keys=True, separators=(",", ":"), default=str).encode()
    return hashlib.sha256(payload).hexdigest()


def quantize_to_tick(value: float, tick: float = TICK) -> float:
    if not np.isfinite(value) or tick <= 0:
        raise RuntimeError("ROLL_BRIDGE_NONFINITE_OR_INVALID_TICK")
    v = Decimal(str(float(value)))
    t = Decimal(str(float(tick)))
    ticks = (v / t).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    return float(ticks * t)


def _daily_contract_map(start: date, end: date) -> dict[date, str]:
    out: dict[date, str] = {}
    d = start
    while d <= end:
        out[d] = projectx_contract_id(d)
        d += timedelta(days=1)
    return out


def contract_windows(start: date, end: date, overlap_days: int = 7) -> list[ContractWindow]:
    """Consecutive expected-lead windows with overlap for basis measurement."""
    if start > end:
        return []
    mapping = _daily_contract_map(start, end)
    days = list(mapping)
    groups: list[tuple[str, date, date]] = []
    cur_contract = mapping[days[0]]
    cur_start = days[0]
    prev = days[0]
    for d in days[1:]:
        cid = mapping[d]
        if cid != cur_contract:
            groups.append((cur_contract, cur_start, prev))
            cur_contract, cur_start = cid, d
        prev = d
    groups.append((cur_contract, cur_start, prev))
    return [
        ContractWindow(cid, s - timedelta(days=overlap_days), e + timedelta(days=overlap_days))
        for cid, s, e in groups
    ]


def normalize_1m(df: pd.DataFrame, contract_id: str) -> pd.DataFrame:
    if df.empty:
        return pd.DataFrame(columns=["datetime", "open", "high", "low", "close", "volume", "contract_id"])
    x = df.copy()
    if "datetime" not in x:
        raise RuntimeError("DATA_MISSING_DATETIME")
    x["datetime"] = pd.to_datetime(x["datetime"], utc=True)
    x = x.sort_values("datetime").drop_duplicates("datetime", keep="last")
    for c in ("open", "high", "low", "close"):
        x[c] = pd.to_numeric(x[c], errors="coerce")
    x["volume"] = pd.to_numeric(x.get("volume", 0), errors="coerce").fillna(0)
    x["contract_id"] = contract_id
    bad = (~np.isfinite(x[["open", "high", "low", "close"]])).any(axis=1)
    if bad.any():
        raise RuntimeError(f"DATA_NONFINITE_OHLC:{int(bad.sum())}")
    invariant = ((x.high < x[["open", "close"]].max(axis=1)) |
                 (x.low > x[["open", "close"]].min(axis=1)) |
                 (x.high < x.low))
    if invariant.any():
        raise RuntimeError(f"DATA_OHLC_INVARIANT:{int(invariant.sum())}")
    off_tick = ((x[["open", "high", "low", "close"]] / TICK).round() -
                (x[["open", "high", "low", "close"]] / TICK)).abs().max(axis=1) > 1e-8
    if off_tick.any():
        raise RuntimeError(f"DATA_OFF_TICK:{int(off_tick.sum())}")
    return x.reset_index(drop=True)


def transition_dates(start: date, end: date) -> list[date]:
    """Dates on which the frozen CME customary lead contract changes."""
    mapping = _daily_contract_map(start - timedelta(days=1), end)
    out = []
    prev = mapping[start - timedelta(days=1)]
    d = start
    while d <= end:
        cur = mapping[d]
        if cur != prev:
            out.append(d)
        prev = cur
        d += timedelta(days=1)
    return out


def compute_roll_bridge(old_df: pd.DataFrame, new_df: pd.DataFrame, roll_date: date,
                        min_shared: int = 10) -> RollBridge:
    """Use the last 30 RTH minutes of the prior Friday; median basis is robust.

    The raw old/new contract closes are both on the MNQ tick grid. With an even
    number of observations, however, the statistical median can land halfway
    between ticks. Quantizing the bridge itself to the 0.25 grid preserves valid
    futures prices throughout the forward-adjusted analysis stream.
    """
    old = normalize_1m(old_df, str(old_df.contract_id.iloc[0]) if len(old_df) and "contract_id" in old_df else "OLD")
    new = normalize_1m(new_df, str(new_df.contract_id.iloc[0]) if len(new_df) and "contract_id" in new_df else "NEW")
    old_id = str(old.contract_id.iloc[0])
    new_id = str(new.contract_id.iloc[0])
    anchor_day = roll_date - timedelta(days=3)
    while anchor_day.weekday() != 4:
        anchor_day -= timedelta(days=1)
    start_local = pd.Timestamp.combine(anchor_day, time(15, 30)).tz_localize(TZ)
    end_local = pd.Timestamp.combine(anchor_day, time(15, 59)).tz_localize(TZ)
    a = old.set_index("datetime").tz_convert(TZ)
    b = new.set_index("datetime").tz_convert(TZ)
    a = a[(a.index >= start_local) & (a.index <= end_local)][["close"]].rename(columns={"close": "old"})
    b = b[(b.index >= start_local) & (b.index <= end_local)][["close"]].rename(columns={"close": "new"})
    joined = a.join(b, how="inner").dropna()
    if len(joined) < min_shared:
        raise RuntimeError(f"ROLL_BRIDGE_INSUFFICIENT_OVERLAP:{roll_date}:{len(joined)}")
    gaps = joined["new"] - joined["old"]
    gap = quantize_to_tick(float(gaps.median()))
    return RollBridge(
        roll_date=str(roll_date), old_contract=old_id, new_contract=new_id,
        anchor_start=str(start_local), anchor_end=str(end_local),
        shared_minutes=int(len(joined)), raw_gap_new_minus_old=gap,
    )


def session_date_for_timestamp(ts: pd.Timestamp) -> date:
    local = ts.tz_convert(TZ) if ts.tzinfo else ts.tz_localize("UTC").tz_convert(TZ)
    # CME evening session belongs to the following business/trading date.
    return (local.date() + timedelta(days=1)) if local.time() >= time(18, 0) else local.date()


def select_lead_rows(contract_frames: dict[str, pd.DataFrame], start: date, end: date) -> pd.DataFrame:
    parts = []
    for cid, frame in contract_frames.items():
        x = normalize_1m(frame, cid)
        if x.empty:
            continue
        x["session"] = [session_date_for_timestamp(t) for t in x["datetime"]]
        x = x[(x.session >= start) & (x.session <= end)]
        if x.empty:
            continue
        expected = x["session"].map(projectx_contract_id)
        x = x[expected == cid]
        parts.append(x)
    if not parts:
        return pd.DataFrame()
    out = pd.concat(parts, ignore_index=True).sort_values("datetime")
    if out["datetime"].duplicated().any():
        raise RuntimeError("LEAD_STREAM_DUPLICATE_TIMESTAMPS")
    return out.reset_index(drop=True)


def forward_adjust(lead: pd.DataFrame, bridges: Iterable[RollBridge]) -> pd.DataFrame:
    """Causal roll-continuous stream; old history never changes after the fact."""
    if lead.empty:
        return lead.copy()
    x = lead.copy().sort_values("datetime")
    bridges = sorted(list(bridges), key=lambda b: b.roll_date)
    adjustment_by_contract: dict[str, float] = {}
    first_contract = str(x.iloc[0].contract_id)
    adjustment_by_contract[first_contract] = 0.0
    for br in bridges:
        if br.old_contract not in adjustment_by_contract:
            adjustment_by_contract[br.old_contract] = 0.0
        adjustment_by_contract[br.new_contract] = quantize_to_tick(
            adjustment_by_contract[br.old_contract] - float(br.raw_gap_new_minus_old)
        )
    x["price_adjustment"] = x.contract_id.map(adjustment_by_contract)
    if x.price_adjustment.isna().any():
        missing = sorted(set(x.loc[x.price_adjustment.isna(), "contract_id"]))
        raise RuntimeError(f"ROLL_ADJUSTMENT_MISSING:{missing}")
    for c in ("open", "high", "low", "close"):
        x[f"raw_{c}"] = x[c]
        x[c] = x[c] + x["price_adjustment"]
    off_tick = ((x[["open", "high", "low", "close"]] / TICK).round() -
                (x[["open", "high", "low", "close"]] / TICK)).abs().max(axis=1) > 1e-8
    if off_tick.any():
        raise RuntimeError(f"ROLL_ADJUSTED_OFF_TICK:{int(off_tick.sum())}")
    return x


def derive_5m(one: pd.DataFrame) -> pd.DataFrame:
    if one.empty:
        return one.copy()
    x = one.copy()
    idx = pd.to_datetime(x["datetime"], utc=True)
    x = x.set_index(idx)
    agg = x.resample("5min", origin="start_day", label="left", closed="left").agg(
        open=("open", "first"), high=("high", "max"), low=("low", "min"),
        close=("close", "last"), volume=("volume", "sum"),
        contract_id=("contract_id", "last"), price_adjustment=("price_adjustment", "last"),
    ).dropna(subset=["open", "high", "low", "close"])
    agg.index.name = "datetime"
    return agg.reset_index()


def _file_meta(path: Path, rows: int, first: str | None, last: str | None) -> dict:
    return {
        "path": str(path), "sha256": sha256_file(path), "bytes": path.stat().st_size,
        "rows": int(rows), "first_timestamp": first, "last_timestamp": last,
    }


def collect_local_projectx(start: date, end: date, out_dir: str | Path,
                           warmup_days: int = 90) -> dict:
    """Collect and freeze roll-correct 1m/5m data on the user's personal device."""
    require_personal_device("PROJECTX_HISTORY_COLLECTION")
    if start >= end:
        raise ValueError("start must be before end")
    root = Path(out_dir)
    raw_dir = root / "raw_contracts"
    raw_dir.mkdir(parents=True, exist_ok=True)
    warmup_start = start - timedelta(days=warmup_days)
    windows = contract_windows(warmup_start, end, overlap_days=7)
    client = ProjectXHistory()
    frames: dict[str, pd.DataFrame] = {}
    raw_meta: dict[str, dict] = {}
    for w in windows:
        req = HistoryRequest(
            contract_id=w.contract_id,
            start=datetime.combine(w.start, time(0, 0), tzinfo=timezone.utc),
            end=datetime.combine(w.end + timedelta(days=1), time(0, 0), tzinfo=timezone.utc),
            unit=UNIT_MINUTE, unit_number=1, live=False,
        )
        frame = normalize_1m(client.fetch(req), w.contract_id)
        if frame.empty:
            raise RuntimeError(f"CONTRACT_HISTORY_EMPTY:{w.contract_id}")
        path = raw_dir / f"{w.contract_id.replace('.', '_')}.csv.gz"
        frame.to_csv(path, index=False, compression="gzip")
        frames[w.contract_id] = frame
        raw_meta[w.contract_id] = _file_meta(
            path, len(frame), str(frame.datetime.iloc[0]), str(frame.datetime.iloc[-1])
        ) | {"requested_start": str(w.start), "requested_end": str(w.end)}

    bridges: list[RollBridge] = []
    for rd in transition_dates(warmup_start, end):
        old_id = projectx_contract_id(rd - timedelta(days=1))
        new_id = projectx_contract_id(rd)
        if old_id not in frames or new_id not in frames:
            raise RuntimeError(f"ROLL_SOURCE_MISSING:{rd}:{old_id}:{new_id}")
        bridges.append(compute_roll_bridge(frames[old_id], frames[new_id], rd))

    lead = select_lead_rows(frames, warmup_start, end)
    continuous1 = forward_adjust(lead, bridges)
    continuous5 = derive_5m(continuous1)
    one_path = root / "MNQ_roll_correct_1m.csv.gz"
    five_path = root / "MNQ_roll_correct_5m.csv.gz"
    continuous1.to_csv(one_path, index=False, compression="gzip")
    continuous5.to_csv(five_path, index=False, compression="gzip")

    contract_sessions = {str(k): str(v) for k, v in _daily_contract_map(warmup_start, end).items()}
    manifest = DatasetManifest(
        schema_version=1,
        requested_start=str(start), requested_end=str(end), warmup_start=str(warmup_start),
        generated_utc=datetime.now(timezone.utc).isoformat(), source="ProjectX History/retrieveBars",
        source_unit="1-minute", tick_size=TICK, raw_contract_files=raw_meta,
        roll_bridges=[asdict(b) for b in bridges],
        continuous_1m=_file_meta(one_path, len(continuous1),
                                 str(continuous1.datetime.iloc[0]), str(continuous1.datetime.iloc[-1])),
        continuous_5m=_file_meta(five_path, len(continuous5),
                                 str(continuous5.datetime.iloc[0]), str(continuous5.datetime.iloc[-1])),
        sessions=len(set(continuous1.session)), contract_sessions=contract_sessions,
    )
    payload = asdict(manifest)
    payload["dataset_sha256"] = canonical_hash(payload)
    (root / "dataset_manifest.json").write_text(json.dumps(payload, indent=2, sort_keys=True))
    return payload
