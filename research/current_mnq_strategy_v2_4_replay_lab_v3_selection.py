#!/usr/bin/env python3
"""Diversity-first V3 replay sampling with real momentum near-miss controls.

This module exists because the seen Jan-Apr 2026 sample has fewer than sixteen
sessions that satisfy the full final ENTER equation. We do not repeat sessions or
invent generic duplicates to fill the desktop lab. Instead, after selecting all
useful full-engine entries, we sample different sessions where the shared kernel
proved a real candle-story + force candidate but the final ROOM/TP gate correctly
rejected the trade. Those are especially useful blind fidelity cases: the trader
can show whether he would take that momentum while the authoritative bot remains
NO_TRADE. No PnL, exit, winner/loser or future outcome participates in selection.
"""
from __future__ import annotations

from dataclasses import asdict
from datetime import date
import hashlib
import json
from typing import Iterable

import pandas as pd

from research import current_mnq_strategy_v2_4_engine as eng
from research.current_mnq_strategy_v2_4_kernel import iter_actionable_candidates
from research.current_mnq_strategy_v2_4_targets import build_and_classify
from research import current_mnq_strategy_v2_4_replay_lab_v3 as v3


def _first_momentum_near_miss(env: dict, dte: date, p: eng.Params):
    """First real force candidate rejected only after candidate formation.

    A returned row is NOT an entry. It carries the causal candidate/reference
    clock so the blind replay contains realistic momentum, while authoritative
    bot_action remains NO_TRADE because the final room/TP gate did not approve it.
    """
    for cand, actionable, plan in iter_actionable_candidates(env, dte, p, as_of=None):
        ent = eng.core.one_minute_entry(env["one"], actionable, cand.direction, p)
        if ent is None:
            continue
        entry_time, entry, _raw_open = ent
        if entry_time.time() > v3.LAST_ENTRY:
            continue
        picked, path_reason = build_and_classify(
            env["piv5"], env["full5"], env["h15"], entry_time, p,
            env["pdm"], env["pwm"], dte, entry, cand.direction, cand.setup,
            cand.setup == "BRK5", piv15=env["piv15"],
        )
        if picked is None:
            return cand, actionable, plan, entry_time, float(entry), str(path_reason)
    return None


def _deterministic_no_trade_clock(env: dict, dte: date) -> pd.Timestamp | None:
    """Last-resort different-session control, independent of outcomes/PnL."""
    one = env["one"]
    for clock in ("10:00", "10:30", "11:00"):
        cutoff = pd.Timestamp(f"{dte} {clock}", tz=eng.core.TZ)
        q = one[
            (one.index.date == dte)
            & ((one.index + pd.Timedelta(minutes=1)) <= cutoff)
        ]
        if len(q):
            return cutoff
    return None


def _gold_for_reason(reason: str | None) -> list[str]:
    base = list(v3.GOLD_BY_REASON.get(str(reason), []))
    return list(dict.fromkeys(base + [
        "V24G06_FIRST_REACTION_LIQUIDITY_BEFORE_FVG",
        "V24G07_RANGE_DAY_KEY_ZONE_ROOM",
        "V24G08_LIVE_MOMENTUM_FORCE_BEFORE_CANDLE_CLOSE",
    ]))


def build_replay_pack_v3_diverse(
    env: dict,
    days: Iterable[date],
    p: eng.Params | None = None,
    max_cases: int = 16,
    max_entry_cases: int = 11,
    min_entry_cases: int = 8,
    min_momentum_near_miss_cases: int = 4,
) -> tuple[dict, dict]:
    p = p or eng.Params()
    days = list(days)
    entries: list[tuple[date, tuple]] = []
    non_entry: list[date] = []

    for dte in days:
        full = v3._authoritative_first_entry(env, dte, p)
        if full is None:
            non_entry.append(dte)
        else:
            entries.append((dte, full))

    # First cover distinct setup reasons; then fill chronologically. This never
    # reads an exit, return, PnL field, winner flag, or future trade outcome.
    selected_entries: list[tuple[date, tuple]] = []
    seen_reason: set[str] = set()
    for row in entries:
        reason = str(row[1][0].reason)
        if reason not in seen_reason and len(selected_entries) < max_entry_cases:
            selected_entries.append(row)
            seen_reason.add(reason)
    for row in entries:
        if len(selected_entries) >= max_entry_cases:
            break
        if row not in selected_entries:
            selected_entries.append(row)
    if len(selected_entries) < min_entry_cases:
        raise RuntimeError(
            f"REPLAY_V3_TOO_FEW_AUTHORITATIVE_ENTRY_CASES:{len(selected_entries)}"
        )

    cases: list[v3.ReplayCaseV3] = []
    answers: list[v3.AnswerV3] = []
    used_sessions: set[str] = set()

    for dte, full in selected_entries:
        cand, _actionable, _plan, entry_time, entry, picked, _path_reason = full
        c = v3._make_case(env, dte, entry_time, "AUTHORITATIVE_ENTRY_REPLAY")
        zones = v3._decision_relevant_zones(
            v3._zone_rows(env, dte, p), entry, str(cand.location.id), 3,
        )
        loc = picked.location
        tp = {
            "lo": float(loc.lo), "hi": float(loc.hi), "mid": float(loc.mid),
            "source": str(loc.source), "kind": str(picked.kind),
            "target_raw": float(picked.raw_price),
            "target_executable": float(picked.executable_price),
            "first_contact_distance": float(picked.first_contact_distance),
        }
        cases.append(c)
        answers.append(v3.AnswerV3(
            c.case_id,
            "AUTHORITATIVE_FULL_ENGINE_ENTRY_REPLAY",
            "ENTER_LONG" if cand.direction == "L" else "ENTER_SHORT",
            entry_time.isoformat(), str(cand.setup), str(cand.reason),
            str(cand.location.id), zones, float(entry), tp,
            _gold_for_reason(str(cand.reason)),
        ))
        used_sessions.add(str(dte))

    near_miss_count = 0
    remaining_controls: list[date] = []
    for dte in non_entry:
        if len(cases) >= max_cases:
            break
        miss = _first_momentum_near_miss(env, dte, p)
        if miss is None:
            remaining_controls.append(dte)
            continue
        cand, _actionable, _plan, reference_time, reference_price, path_reason = miss
        c = v3._make_case(
            env, dte, reference_time,
            "MOMENTUM_FORCE_CANDIDATE_REJECTED_BY_ROOM_OR_TP",
        )
        zones = v3._decision_relevant_zones(
            v3._zone_rows(env, dte, p), reference_price,
            str(cand.location.id), 3,
        )
        cases.append(c)
        answers.append(v3.AnswerV3(
            c.case_id,
            "MOMENTUM_FORCE_CANDIDATE_REJECTED_BY_ROOM_OR_TP",
            "NO_TRADE", None, str(cand.setup),
            f"{cand.reason}|FINAL_GATE:{path_reason}",
            str(cand.location.id), zones, None, None,
            _gold_for_reason(str(cand.reason)),
        ))
        used_sessions.add(str(dte))
        near_miss_count += 1

    # Fill only if the sample still lacks enough distinct sessions. Prefer the
    # established V2 structural controls, then a fixed clock on a no-entry day.
    for dte in remaining_controls:
        if len(cases) >= max_cases:
            break
        ctl = v3._control_anchor(env, dte, p)
        if ctl is not None:
            anchor, kind = ctl
        else:
            anchor = _deterministic_no_trade_clock(env, dte)
            kind = "FIXED_CLOCK_NO_FULL_ENGINE_ENTRY_CONTROL"
            if anchor is None:
                continue
        c = v3._make_case(env, dte, anchor, kind)
        ctx = c.context_1m
        if not ctx:
            continue
        ref = float(ctx[-1]["close"])
        zones = v3._decision_relevant_zones(v3._zone_rows(env, dte, p), ref, None, 3)
        cases.append(c)
        answers.append(v3.AnswerV3(
            c.case_id, kind, "NO_TRADE", None, None, None, None,
            zones, None, None,
            [
                "V24G07_RANGE_DAY_KEY_ZONE_ROOM",
                "V24G08_LIVE_MOMENTUM_FORCE_BEFORE_CANDLE_CLOSE",
            ],
        ))
        used_sessions.add(str(dte))

    if near_miss_count < min_momentum_near_miss_cases:
        raise RuntimeError(
            f"REPLAY_V3_TOO_FEW_MOMENTUM_NEAR_MISS_CASES:"
            f"{near_miss_count}<{min_momentum_near_miss_cases}"
        )
    if len(cases) < max_cases:
        raise RuntimeError(
            f"REPLAY_V3_TOO_FEW_DIVERSE_SESSIONS:{len(cases)}<{max_cases}"
        )

    cases = cases[:max_cases]
    kept = {c.case_id for c in cases}
    answer_map = {x.case_id: asdict(x) for x in answers if x.case_id in kept}
    review = {
        "schema_version": v3.SCHEMA_VERSION,
        "status": "INTERACTIVE_DESKTOP_STYLE_CAPTURE_UI_HIDDEN_FUTURE_NO_PNL",
        "future_visibility": "UI_PROGRESSIVE_DISCLOSURE_ONLY_NOT_CRYPTOGRAPHICALLY_WITHHELD",
        "chart_engine": {"name": "TradingView Lightweight Charts", "version": v3.LWC_VERSION},
        "tp_instruction": "Mark the first meaningful REACTION CLUSTER you would actually use as TP. Not merely side-by-side candles.",
        "allowed_actions": sorted(v3.ACTIONS),
        "allowed_force_labels": sorted(v3.FORCE_LABELS),
        "allowed_zone_roles": sorted(v3.ZONE_ROLES),
        "case_count": len(cases),
        "session_count": len({c.session for c in cases}),
        "cases": [asdict(x) for x in cases],
    }
    if review["case_count"] != review["session_count"]:
        raise RuntimeError("REPLAY_V3_SESSION_DIVERSITY_BROKEN")
    review["pack_id"] = hashlib.sha256(
        json.dumps(review["cases"], sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    key = {
        "schema_version": v3.SCHEMA_VERSION,
        "pack_id": review["pack_id"],
        "status": "HIDDEN_V3_BOT_KEY_DO_NOT_OPEN_BEFORE_LABEL_FREEZE",
        "sampling_receipt": {
            "authoritative_entry_cases": sum(
                1 for x in answer_map.values()
                if x["hidden_case_kind"] == "AUTHORITATIVE_FULL_ENGINE_ENTRY_REPLAY"
            ),
            "momentum_near_miss_cases": sum(
                1 for x in answer_map.values()
                if x["hidden_case_kind"] == "MOMENTUM_FORCE_CANDIDATE_REJECTED_BY_ROOM_OR_TP"
            ),
            "distinct_sessions": review["session_count"],
            "pnl_or_exit_outcome_used": False,
        },
        "answers": answer_map,
    }
    v3._assert_safe_review(review)
    return review, key
