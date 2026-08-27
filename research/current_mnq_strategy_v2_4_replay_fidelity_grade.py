#!/usr/bin/env python3
"""WAIT-preserving Human-vs-Bot fidelity grader for Current MNQ v2.4.

The V3 UI intentionally preserves WAIT when the replay window ends while the
trader is still waiting. The original V3 validator accidentally rejected WAIT,
which made the upgraded calibration contract impossible to grade honestly.

This module is fidelity-only. It never reads PnL, exits, winners or future
outcomes. It separates exact action agreement from behavioral entered-vs-did-not-
enter agreement so WAIT is never silently relabeled NO_TRADE.
"""
from __future__ import annotations

import pandas as pd

from research import current_mnq_strategy_v2_4_replay_lab_v3 as v3

ACTIONS = {"ENTER_LONG", "ENTER_SHORT", "WAIT", "NO_TRADE"}


def _rows(labels: dict | list) -> list[dict]:
    rows = labels.get("labels", []) if isinstance(labels, dict) else labels
    if not isinstance(rows, list):
        raise RuntimeError("REPLAY_FIDELITY_LABELS_NOT_LIST")
    return rows


def validate_wait_preserving_labels(labels: dict | list, review: dict) -> None:
    rows = _rows(labels)
    expected = {c["case_id"] for c in review["cases"]}
    observed: set[str] = set()

    for row in rows:
        cid = str(row.get("case_id", ""))
        if cid not in expected or cid in observed:
            raise RuntimeError(f"REPLAY_FIDELITY_BAD_OR_DUPLICATE_CASE:{cid}")
        observed.add(cid)

        action = row.get("final_action")
        if action not in ACTIONS:
            raise RuntimeError(f"REPLAY_FIDELITY_BAD_FINAL_ACTION:{cid}:{action}")
        if row.get("entry_force") not in v3.FORCE_LABELS:
            raise RuntimeError(f"REPLAY_FIDELITY_BAD_FORCE:{cid}")

        zones = row.get("trader_zones", [])
        if not isinstance(zones, list):
            raise RuntimeError(f"REPLAY_FIDELITY_ZONES_NOT_LIST:{cid}")
        for z in zones:
            v3._norm_interval(z)
            if z.get("role") not in v3.ZONE_ROLES:
                raise RuntimeError(f"REPLAY_FIDELITY_BAD_ZONE_ROLE:{cid}")

        if str(action).startswith("ENTER_"):
            if not row.get("first_entry_time"):
                raise RuntimeError(f"REPLAY_FIDELITY_ENTRY_WITHOUT_TIME:{cid}")
            if not zones:
                raise RuntimeError(f"REPLAY_FIDELITY_ENTRY_WITHOUT_KEY_ZONE:{cid}")
        else:
            if row.get("first_entry_time") is not None:
                raise RuntimeError(f"REPLAY_FIDELITY_NONENTRY_WITH_ENTRY_TIME:{cid}")

    if observed != expected:
        raise RuntimeError(
            "REPLAY_FIDELITY_MISSING_LABELS:" + ",".join(sorted(expected - observed)[:10])
        )


def _entered(action: str) -> bool:
    return str(action).startswith("ENTER_")


def grade_wait_preserving_labels(labels: dict | list, review: dict, answer_key: dict) -> dict:
    validate_wait_preserving_labels(labels, review)
    if answer_key.get("pack_id") != review.get("pack_id"):
        raise RuntimeError("REPLAY_FIDELITY_PACK_KEY_MISMATCH")

    out: list[dict] = []
    for lab in _rows(labels):
        answer = answer_key["answers"][lab["case_id"]]
        trader_action = str(lab["final_action"])
        bot_action = str(answer["bot_action"])
        action_agree = trader_action == bot_action
        behavior_agree = _entered(trader_action) == _entered(bot_action)

        timing_delta = None
        if _entered(trader_action) and answer.get("bot_entry_time"):
            timing_delta = (
                pd.Timestamp(lab["first_entry_time"]) - pd.Timestamp(answer["bot_entry_time"])
            ).total_seconds() / 60.0

        tp_grade = None
        trader_tp = lab.get("trader_tp_reaction_cluster")
        bot_tp = answer.get("bot_tp_reaction_cluster")
        if action_agree and _entered(trader_action) and trader_tp is not None and bot_tp is not None:
            tp_grade = v3._geometry(v3._norm_interval(trader_tp), v3._norm_interval(bot_tp))

        out.append({
            "case_id": lab["case_id"],
            "trader_action": trader_action,
            "bot_action": bot_action,
            "exact_action_agreement": action_agree,
            "entered_behavior_agreement": behavior_agree,
            "trader_wait_preserved": trader_action == "WAIT",
            "trader_first_entry_time": lab.get("first_entry_time"),
            "bot_entry_time": answer.get("bot_entry_time"),
            "entry_timing_delta_minutes": timing_delta,
            "trader_force_at_entry": lab.get("entry_force"),
            "bot_setup": answer.get("bot_setup"),
            "bot_reason": answer.get("bot_reason"),
            "gold_reference_ids": answer.get("gold_reference_ids", []),
            "key_zone_grade": v3._zone_grade(
                lab.get("trader_zones", []), answer.get("bot_relevant_zones", [])
            ),
            "tp_reaction_cluster_grade": tp_grade,
        })

    exact = sum(1 for r in out if r["exact_action_agreement"])
    behavioral = sum(1 for r in out if r["entered_behavior_agreement"])
    waits = sum(1 for r in out if r["trader_wait_preserved"])
    timing = [
        float(r["entry_timing_delta_minutes"]) for r in out
        if r["entry_timing_delta_minutes"] is not None
        and _entered(r["trader_action"])
        and r["trader_action"] == r["bot_action"]
    ]

    return {
        "status": "WAIT_PRESERVING_V3_FIDELITY_GRADE_ONLY_NOT_EDGE_EVIDENCE",
        "pack_id": review["pack_id"],
        "cases": len(out),
        "trader_wait_count": waits,
        "exact_action_agreements": exact,
        "exact_action_agreement_rate": exact / max(len(out), 1),
        "entered_behavior_agreements": behavioral,
        "entered_behavior_agreement_rate": behavioral / max(len(out), 1),
        "same_direction_entry_timing_deltas_minutes": timing,
        "rows": out,
        "warning": "WAIT remains WAIT. Fidelity-only outcome data is excluded from this grade.",
    }
