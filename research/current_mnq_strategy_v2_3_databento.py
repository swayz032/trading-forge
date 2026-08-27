#!/usr/bin/env python3
"""Multi-year explicit-contract MNQ history collector using Databento.

Databento is used only for deep historical validation. ProjectX remains the
broker/realtime execution source. We deliberately DO NOT use vendor continuous
roll selection: each H/M/U/Z outright is requested explicitly and the frozen
MNQ v2.3 roll policy decides which contract supplies each session.

The Databento SDK reads DATABENTO_API_KEY from the local environment. No key is
stored in repository files or dataset manifests.
"""
from __future__ import annotations

import json
import time
from dataclasses import asdict
from datetime import date, timedelta
from pathlib import Path

import pandas as pd

from research.current_mnq_strategy_v2_2_contracts import MONTH_CODE, projectx_contract_id
from research import current_mnq_strategy_v2_3_data as common

DATASET = "GLBX.MDP3"
SCHEMA = "ohlcv-1m"
MNQ_LAUNCH = date(2019, 5, 6)
DATABENTO_MAX_ATTEMPTS = 5


def databento_raw_symbol(contract_id: str) -> str:
    # ProjectX: CON.F.US.MNQ.H26 -> CME/Databento raw symbol MNQH6.
    tail = contract_id.rsplit(".", 1)[-1]
    if len(tail) != 3 or tail[0] not in set(MONTH_CODE.values()) or not tail[1:].isdigit():
        raise ValueError(f"unexpected MNQ contract id: {contract_id}")
    return f"MNQ{tail[0]}{int(tail[1:]) % 10}"


def _databento_get_range(db, client, *, label: str, **kwargs):
    """Run one historical request with bounded retries for transport/server faults.

    Databento client-side HTTP errors (bad auth, invalid request, missing symbol,
    permission failure, etc.) are deterministic and must fail immediately. Generic
    BentoError transport failures such as a prematurely-ended HTTP stream, plus
    server-side 5xx errors, are retried with bounded exponential backoff.
    """
    for attempt in range(1, DATABENTO_MAX_ATTEMPTS + 1):
        try:
            return client.timeseries.get_range(**kwargs)
        except db.BentoClientError:
            raise
        except (db.BentoServerError, db.BentoError, OSError) as exc:
            if attempt >= DATABENTO_MAX_ATTEMPTS:
                raise RuntimeError(
                    f"DATABENTO_RETRY_EXHAUSTED:{label}:attempts={DATABENTO_MAX_ATTEMPTS}:"
                    f"{type(exc).__name__}:{exc}"
                ) from exc
            delay = min(2 ** (attempt - 1), 16)
            print(
                f"Databento transient stream failure [{label}] "
                f"attempt {attempt}/{DATABENTO_MAX_ATTEMPTS}; retrying in {delay}s "
                f"({type(exc).__name__})",
                flush=True,
            )
            time.sleep(delay)
    raise AssertionError("unreachable")


def _to_frame(store, canonical_contract_id: str, raw_symbol: str) -> pd.DataFrame:
    df = store.to_df()
    if df.empty:
        return pd.DataFrame()
    x = df.reset_index()
    if "ts_event" in x.columns:
        x = x.rename(columns={"ts_event": "datetime"})
    elif "datetime" not in x.columns:
        raise RuntimeError("DATABENTO_TS_EVENT_MISSING")
    keep = [c for c in ("datetime", "open", "high", "low", "close", "volume") if c in x.columns]
    x = x[keep].copy()
    x["raw_symbol"] = raw_symbol
    x = common.normalize_1m(x, canonical_contract_id)
    x["raw_symbol"] = raw_symbol
    return x


def collect_databento(start: date, end: date, out_dir: str | Path,
                       warmup_days: int = 90) -> dict:
    """Collect a frozen multi-year validation dataset from explicit MNQ outrights."""
    if start < MNQ_LAUNCH:
        raise ValueError(f"MNQ did not exist before {MNQ_LAUNCH}")
    if start >= end:
        raise ValueError("start must be before end")
    try:
        import databento as db
    except ImportError as exc:
        raise RuntimeError(
            "DATABENTO_SDK_MISSING: install research/mnq_v23_databento_requirements.txt"
        ) from exc

    root = Path(out_dir)
    raw_dir = root / "raw_contracts"
    raw_dir.mkdir(parents=True, exist_ok=True)
    # Never manufacture pre-launch MNQ warmup. Initial strategy warmup is simply
    # unscored until enough genuine MNQ bars exist after launch.
    warmup_start = max(MNQ_LAUNCH, start - timedelta(days=warmup_days))
    windows = common.contract_windows(warmup_start, end, overlap_days=7)
    client = db.Historical()  # reads DATABENTO_API_KEY by SDK convention

    frames: dict[str, pd.DataFrame] = {}
    raw_meta: dict[str, dict] = {}
    definitions: dict[str, dict] = {}

    for w in windows:
        symbol = databento_raw_symbol(w.contract_id)
        request_start = max(MNQ_LAUNCH, w.start)
        # We only need one vendor definition record to verify that the explicit
        # raw symbol resolves to the expected contract metadata. Streaming every
        # definition update across the full contract window adds no evidence and
        # needlessly enlarges the HTTP stream, so keep this request bounded.
        definition = _databento_get_range(
            db,
            client,
            label=f"definition:{symbol}:{w.contract_id}",
            dataset=DATASET,
            schema="definition",
            symbols=symbol,
            stype_in="raw_symbol",
            start=str(request_start),
            end=str(min(w.end + timedelta(days=1), end + timedelta(days=8))),
            limit=1,
        ).to_df()
        if definition.empty:
            raise RuntimeError(f"DATABENTO_DEFINITION_EMPTY:{symbol}:{w.contract_id}")
        d0 = definition.reset_index().iloc[0]
        observed_raw = str(d0.get("raw_symbol", symbol))
        if observed_raw != symbol:
            raise RuntimeError(f"DATABENTO_DEFINITION_SYMBOL_MISMATCH:{observed_raw}!={symbol}")
        definitions[w.contract_id] = {
            "raw_symbol": symbol,
            "instrument_id": int(d0["instrument_id"]) if "instrument_id" in d0 else None,
            "expiration": str(d0.get("expiration", "")),
            "asset": str(d0.get("asset", "MNQ")),
        }

        store = _databento_get_range(
            db,
            client,
            label=f"ohlcv-1m:{symbol}:{w.contract_id}",
            dataset=DATASET,
            schema=SCHEMA,
            symbols=symbol,
            stype_in="raw_symbol",
            start=str(request_start),
            end=str(w.end + timedelta(days=1)),
        )
        frame = _to_frame(store, w.contract_id, symbol)
        if frame.empty:
            raise RuntimeError(f"DATABENTO_CONTRACT_HISTORY_EMPTY:{symbol}:{w.contract_id}")
        path = raw_dir / f"{w.contract_id.replace('.', '_')}.csv.gz"
        frame.to_csv(path, index=False, compression="gzip")
        frames[w.contract_id] = frame
        raw_meta[w.contract_id] = common._file_meta(
            path, len(frame), str(frame.datetime.iloc[0]), str(frame.datetime.iloc[-1])
        ) | {
            "source_raw_symbol": symbol,
            "source_dataset": DATASET,
            "source_schema": SCHEMA,
            "requested_start": str(request_start),
            "requested_end": str(w.end),
            "definition": definitions[w.contract_id],
        }

    bridges: list[common.RollBridge] = []
    for rd in common.transition_dates(warmup_start, end):
        old_id = projectx_contract_id(rd - timedelta(days=1))
        new_id = projectx_contract_id(rd)
        if old_id not in frames or new_id not in frames:
            raise RuntimeError(f"DATABENTO_ROLL_SOURCE_MISSING:{rd}:{old_id}:{new_id}")
        bridges.append(common.compute_roll_bridge(frames[old_id], frames[new_id], rd))

    lead = common.select_lead_rows(frames, warmup_start, end)
    if lead.empty:
        raise RuntimeError("DATABENTO_LEAD_STREAM_EMPTY")
    continuous1 = common.forward_adjust(lead, bridges)
    continuous5 = common.derive_5m(continuous1)
    one_path = root / "MNQ_roll_correct_1m.csv.gz"
    five_path = root / "MNQ_roll_correct_5m.csv.gz"
    continuous1.to_csv(one_path, index=False, compression="gzip")
    continuous5.to_csv(five_path, index=False, compression="gzip")

    contract_sessions = {
        str(k): str(v) for k, v in common._daily_contract_map(warmup_start, end).items()
    }
    manifest = common.DatasetManifest(
        schema_version=1,
        requested_start=str(start), requested_end=str(end), warmup_start=str(warmup_start),
        generated_utc=pd.Timestamp.utcnow().isoformat(),
        source=f"Databento {DATASET} explicit raw_symbol",
        source_unit=SCHEMA,
        tick_size=common.TICK,
        raw_contract_files=raw_meta,
        roll_bridges=[asdict(b) for b in bridges],
        continuous_1m=common._file_meta(
            one_path, len(continuous1), str(continuous1.datetime.iloc[0]), str(continuous1.datetime.iloc[-1])
        ),
        continuous_5m=common._file_meta(
            five_path, len(continuous5), str(continuous5.datetime.iloc[0]), str(continuous5.datetime.iloc[-1])
        ),
        sessions=len(set(continuous1.session)), contract_sessions=contract_sessions,
    )
    payload = asdict(manifest)
    payload["mnq_launch_date"] = str(MNQ_LAUNCH)
    payload["databento_definitions"] = definitions
    payload["dataset_sha256"] = common.canonical_hash(payload)
    (root / "dataset_manifest.json").write_text(json.dumps(payload, indent=2, sort_keys=True))
    return payload
