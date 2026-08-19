#!/usr/bin/env python3
"""Incremental personal-device ProjectX context store for MNQ v2.3.

Bootstrap once before the session with enough explicit-contract history for the
60-day strategy warmup. During the session, refresh only the current outright.
ProjectX History is requested with includePartialBar=False by the underlying
adapter, so the signal kernel can consume completed 1m/5m bars causally.
"""
from __future__ import annotations

import json
from dataclasses import asdict
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

import pandas as pd

from research.current_mnq_strategy_v2_2_contracts import projectx_contract_id
from research.current_mnq_strategy_v2_2_projectx_history import (
    HistoryRequest, ProjectXHistory, UNIT_MINUTE,
)
from research import current_mnq_strategy_v2_3_data as common
from research.current_mnq_strategy_v2_3_local_runtime import require_personal_device


class LiveContextStore:
    def __init__(self, root: str | Path, client: ProjectXHistory | None = None):
        require_personal_device("PROJECTX_LIVE_CONTEXT")
        self.root = Path(root)
        self.raw_dir = self.root / "raw_contracts"
        self.raw_dir.mkdir(parents=True, exist_ok=True)
        self.client = client or ProjectXHistory()

    @property
    def manifest_path(self) -> Path:
        return self.root / "dataset_manifest.json"

    def _raw_path(self, contract_id: str) -> Path:
        return self.raw_dir / f"{contract_id.replace('.', '_')}.csv.gz"

    @staticmethod
    def _utc_midnight(d: date) -> datetime:
        return datetime.combine(d, time(0, 0), tzinfo=timezone.utc)

    def _fetch_contract(self, contract_id: str, start: datetime, end: datetime) -> pd.DataFrame:
        if start >= end:
            return pd.DataFrame()
        frame = self.client.fetch(HistoryRequest(
            contract_id=contract_id, start=start, end=end,
            unit=UNIT_MINUTE, unit_number=1, live=False,
        ))
        return common.normalize_1m(frame, contract_id) if len(frame) else frame

    def bootstrap(self, session: date, *, lookback_days: int = 100,
                  as_of_utc: datetime | None = None) -> dict:
        if lookback_days < 75:
            raise RuntimeError("LIVE_CONTEXT_LOOKBACK_TOO_SHORT")
        as_of = (as_of_utc or datetime.now(timezone.utc)).astimezone(timezone.utc)
        context_start = session - timedelta(days=lookback_days)
        windows = common.contract_windows(context_start, session, overlap_days=7)
        frames: dict[str, pd.DataFrame] = {}
        raw_meta = {}
        for w in windows:
            start = self._utc_midnight(w.start)
            end = min(self._utc_midnight(w.end + timedelta(days=1)), as_of)
            if start >= end:
                continue
            frame = self._fetch_contract(w.contract_id, start, end)
            if frame.empty:
                raise RuntimeError(f"LIVE_CONTEXT_CONTRACT_EMPTY:{w.contract_id}")
            path = self._raw_path(w.contract_id)
            frame.to_csv(path, index=False, compression="gzip")
            frames[w.contract_id] = frame
            raw_meta[w.contract_id] = common._file_meta(
                path, len(frame), str(frame.datetime.iloc[0]), str(frame.datetime.iloc[-1])
            ) | {"requested_start": start.isoformat(), "requested_end": end.isoformat()}
        return self._rebuild(session, context_start, frames, raw_meta, as_of)

    def _load_manifest(self) -> dict:
        if not self.manifest_path.exists():
            raise RuntimeError("LIVE_CONTEXT_NOT_BOOTSTRAPPED")
        try:
            return json.loads(self.manifest_path.read_text())
        except Exception as exc:
            raise RuntimeError("LIVE_CONTEXT_MANIFEST_CORRUPT") from exc

    def _load_frames(self, manifest: dict) -> dict[str, pd.DataFrame]:
        frames = {}
        for cid, meta in manifest.get("raw_contract_files", {}).items():
            p = Path(meta["path"])
            if not p.is_absolute():
                p = self.raw_dir / p.name
            if not p.exists() or common.sha256_file(p) != meta["sha256"]:
                raise RuntimeError(f"LIVE_CONTEXT_RAW_HASH_REFUSE:{cid}")
            x = pd.read_csv(p, compression="infer")
            x["datetime"] = pd.to_datetime(x["datetime"], utc=True)
            frames[cid] = common.normalize_1m(x, cid)
        return frames

    def refresh(self, session: date, *, as_of_utc: datetime | None = None,
                overlap_minutes: int = 5) -> dict:
        as_of = (as_of_utc or datetime.now(timezone.utc)).astimezone(timezone.utc)
        manifest = self._load_manifest()
        if manifest.get("requested_start") != str(session) or manifest.get("requested_end") != str(session):
            raise RuntimeError("LIVE_CONTEXT_SESSION_MISMATCH_REBOOTSTRAP")
        frames = self._load_frames(manifest)
        current = projectx_contract_id(session)
        if current not in frames:
            raise RuntimeError("LIVE_CONTEXT_CURRENT_CONTRACT_MISSING")
        old = frames[current]
        last = pd.Timestamp(old.datetime.iloc[-1]).to_pydatetime().astimezone(timezone.utc)
        start = last - timedelta(minutes=max(1, overlap_minutes))
        new = self._fetch_contract(current, start, as_of)
        if len(new):
            merged = pd.concat([old, new], ignore_index=True)
            merged = common.normalize_1m(merged, current)
            frames[current] = merged
            path = self._raw_path(current)
            merged.to_csv(path, index=False, compression="gzip")
        raw_meta = {}
        for cid, frame in frames.items():
            path = self._raw_path(cid)
            if not path.exists():
                frame.to_csv(path, index=False, compression="gzip")
            raw_meta[cid] = common._file_meta(
                path, len(frame), str(frame.datetime.iloc[0]), str(frame.datetime.iloc[-1])
            )
        context_start = pd.Timestamp(manifest["warmup_start"]).date()
        return self._rebuild(session, context_start, frames, raw_meta, as_of)

    def _rebuild(self, session: date, context_start: date,
                 frames: dict[str, pd.DataFrame], raw_meta: dict,
                 as_of: datetime) -> dict:
        bridges: list[common.RollBridge] = []
        for rd in common.transition_dates(context_start, session):
            old_id = projectx_contract_id(rd - timedelta(days=1))
            new_id = projectx_contract_id(rd)
            if old_id not in frames or new_id not in frames:
                raise RuntimeError(f"LIVE_CONTEXT_ROLL_SOURCE_MISSING:{rd}:{old_id}:{new_id}")
            bridges.append(common.compute_roll_bridge(frames[old_id], frames[new_id], rd))
        lead = common.select_lead_rows(frames, context_start, session)
        if lead.empty:
            raise RuntimeError("LIVE_CONTEXT_LEAD_STREAM_EMPTY")
        continuous1 = common.forward_adjust(lead, bridges)
        continuous5 = common.derive_5m(continuous1)
        one_path = self.root / "MNQ_roll_correct_1m.csv.gz"
        five_path = self.root / "MNQ_roll_correct_5m.csv.gz"
        continuous1.to_csv(one_path, index=False, compression="gzip")
        continuous5.to_csv(five_path, index=False, compression="gzip")
        contract_sessions = {
            str(k): str(v) for k, v in common._daily_contract_map(context_start, session).items()
        }
        payload = asdict(common.DatasetManifest(
            schema_version=1,
            requested_start=str(session), requested_end=str(session),
            warmup_start=str(context_start), generated_utc=as_of.isoformat(),
            source="ProjectX local incremental explicit-contract context",
            source_unit="1-minute completed bars", tick_size=common.TICK,
            raw_contract_files=raw_meta, roll_bridges=[asdict(b) for b in bridges],
            continuous_1m=common._file_meta(
                one_path, len(continuous1), str(continuous1.datetime.iloc[0]), str(continuous1.datetime.iloc[-1])
            ),
            continuous_5m=common._file_meta(
                five_path, len(continuous5), str(continuous5.datetime.iloc[0]), str(continuous5.datetime.iloc[-1])
            ),
            sessions=len(set(continuous1.session)), contract_sessions=contract_sessions,
        ))
        payload["as_of_utc"] = as_of.isoformat()
        payload["dataset_sha256"] = common.canonical_hash(payload)
        self.manifest_path.write_text(json.dumps(payload, indent=2, sort_keys=True))
        return payload
