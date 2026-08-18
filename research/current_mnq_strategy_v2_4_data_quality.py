#!/usr/bin/env python3
"""Frozen pre-PnL data-quality quarantine for Current MNQ v2.4.

This module contains no strategy logic and no P&L. It converts the vendor-condition
quarantine declared in current_mnq_strategy_v2_4_edge_semantics.json into exact
score-session exclusions. A flagged vendor date is quarantined through the
maximum causal historical lookback so questionable bars cannot leak into later
PDH/PWH, FVG, wick-zone, or exceptional-swing decisions.
"""
from __future__ import annotations

from datetime import date, timedelta

import pandas as pd


def _quality_spec(edge_spec: dict) -> dict:
    try:
        q = edge_spec["vendor_data_quality_quarantine"]
    except Exception as exc:
        raise RuntimeError("V24_VENDOR_DATA_QUALITY_QUARANTINE_MISSING") from exc
    if not bool(q.get("decision_frozen_before_clean_pnl")):
        raise RuntimeError("V24_VENDOR_DATA_QUALITY_QUARANTINE_NOT_PRE_PNL_FROZEN")
    look = int(q.get("downstream_quarantine_calendar_days", 0))
    if look < 0:
        raise RuntimeError("V24_VENDOR_DATA_QUALITY_QUARANTINE_LOOKBACK_INVALID")
    return q


def declared_vendor_condition_events(edge_spec: dict) -> list[dict]:
    q = _quality_spec(edge_spec)
    events = [dict(x) for x in q.get("source_condition_events", [])]
    seen: set[tuple[str, str]] = set()
    out = []
    for event in events:
        d = str(pd.Timestamp(event["date"]).date())
        condition = str(event["condition"])
        key = (d, condition)
        if key in seen:
            raise RuntimeError(f"V24_VENDOR_DATA_QUALITY_DUPLICATE_EVENT:{d}:{condition}")
        seen.add(key)
        event["date"] = d
        out.append(event)
    if not out:
        raise RuntimeError("V24_VENDOR_DATA_QUALITY_EVENTS_EMPTY")
    return sorted(out, key=lambda x: (x["date"], x["condition"]))


def quarantine_windows(edge_spec: dict) -> list[dict]:
    q = _quality_spec(edge_spec)
    days = int(q["downstream_quarantine_calendar_days"])
    windows = []
    for event in declared_vendor_condition_events(edge_spec):
        start = pd.Timestamp(event["date"]).date()
        end = start + timedelta(days=days)
        windows.append({
            "start": str(start),
            "end": str(end),
            "source_date": str(start),
            "condition": str(event["condition"]),
            "reason": (
                f"Vendor condition {event['condition']} on {start}; exclude the flagged date "
                f"and {days} downstream calendar days so questionable bars cannot enter "
                "causal strategy context."
            ),
        })
    return windows


def apply_vendor_data_quality_quarantine(days: list[date], edge_spec: dict) -> tuple[list[date], dict]:
    windows = quarantine_windows(edge_spec)
    parsed = [
        (pd.Timestamp(w["start"]).date(), pd.Timestamp(w["end"]).date(), w)
        for w in windows
    ]
    eligible: list[date] = []
    excluded: list[dict] = []
    for d in sorted(days):
        hits = [w for s, e, w in parsed if s <= d <= e]
        if not hits:
            eligible.append(d)
            continue
        excluded.append({
            "session": str(d),
            "matched_source_dates": sorted({str(w["source_date"]) for w in hits}),
            "matched_windows": hits,
        })
    q = _quality_spec(edge_spec)
    return eligible, {
        "status": "PASS",
        "candidate_sessions": len(days),
        "eligible_sessions": len(eligible),
        "excluded_sessions": len(excluded),
        "downstream_quarantine_calendar_days": int(q["downstream_quarantine_calendar_days"]),
        "declared_condition_events": declared_vendor_condition_events(edge_spec),
        "declared_windows": windows,
        "excluded": excluded,
    }
