from __future__ import annotations

from typing import Any

import pandas as pd

from research import current_mnq_strategy_v2_4_replay_lab_v3 as lab

NO_VISIBLE_MEANINGFUL_REACTION = "NO_VISIBLE_MEANINGFUL_REACTION_IN_PRESENTED_CONTEXT"
TP_NOT_CAPTURABLE_FROM_PRESENTED_CONTEXT = "TP_NOT_CAPTURABLE_FROM_PRESENTED_CONTEXT"
WAIT_AT_REPLAY_END = "WAIT"
MARKED = "MARKED"


def selected_direction(row: dict[str, Any]) -> str | None:
    action = str(row.get("final_action") or "")
    if action == "ENTER_LONG":
        return "LONG"
    if action == "ENTER_SHORT":
        return "SHORT"
    return None


def selected_tp_evidence(row: dict[str, Any]) -> tuple[dict[str, Any] | None, str]:
    direction = selected_direction(row)
    if direction is None:
        return None, "NOT_APPLICABLE"
    if direction == "LONG":
        tp = row.get("trader_tp_long") or row.get("trader_tp_reaction_cluster")
        status = row.get("trader_tp_long_status") or row.get("trader_tp_status") or ""
    else:
        tp = row.get("trader_tp_short") or row.get("trader_tp_reaction_cluster")
        status = row.get("trader_tp_short_status") or row.get("trader_tp_status") or ""
    if tp is not None:
        return tp, MARKED
    return None, str(status)


def normalize_selected_tp(row: dict[str, Any]) -> dict[str, Any]:
    """Bind only the entered direction into the legacy TP field.

    The opposite-direction pre-entry TP is optional. If the presented chart has no
    meaningful reaction/key level in the entered direction, preserve that as an
    explicit context-gap status instead of inventing a numeric target.
    """
    tp, status = selected_tp_evidence(row)
    row["trader_tp_reaction_cluster"] = tp
    row["trader_tp_status"] = MARKED if tp is not None else status
    return row


def entry_tp_capture_complete(row: dict[str, Any]) -> bool:
    if selected_direction(row) is None:
        return True
    tp, status = selected_tp_evidence(row)
    return tp is not None or status in {
        NO_VISIBLE_MEANINGFUL_REACTION,
        TP_NOT_CAPTURABLE_FROM_PRESENTED_CONTEXT,
    }


def validate_labels_v3_context_aware(labels: dict | list, review: dict) -> None:
    rows = labels.get("labels", []) if isinstance(labels, dict) else labels
    if not isinstance(rows, list):
        raise RuntimeError("REPLAY_V3_LABELS_NOT_LIST")
    expected = {c["case_id"] for c in review["cases"]}
    observed: set[str] = set()
    for row in rows:
        cid = str(row.get("case_id", ""))
        if cid not in expected or cid in observed:
            raise RuntimeError(f"REPLAY_V3_BAD_OR_DUPLICATE_CASE:{cid}")
        observed.add(cid)
        if row.get("final_action") not in {"ENTER_LONG", "ENTER_SHORT", "NO_TRADE", WAIT_AT_REPLAY_END}:
            raise RuntimeError(f"REPLAY_V3_BAD_FINAL_ACTION:{cid}")
        if row.get("entry_force") not in lab.FORCE_LABELS:
            raise RuntimeError(f"REPLAY_V3_BAD_FORCE:{cid}")
        zones = row.get("trader_zones", [])
        if not isinstance(zones, list):
            raise RuntimeError(f"REPLAY_V3_ZONES_NOT_LIST:{cid}")
        for z in zones:
            lab._norm_interval(z)
            if z.get("role") not in lab.ZONE_ROLES:
                raise RuntimeError(f"REPLAY_V3_BAD_ZONE_ROLE:{cid}")
        if str(row["final_action"]).startswith("ENTER_"):
            if not row.get("first_entry_time") and row.get("entry_time_capture_status") != "ENTRY_TIME_NOT_RECOVERABLE_FROM_SAVED_REPLAY_STATE":
                raise RuntimeError(f"REPLAY_V3_ENTRY_WITHOUT_TIME:{cid}")
            if not zones and row.get("key_zone_capture_status") != "KEY_ZONE_NOT_CAPTURED_IN_SAVED_STATE":
                raise RuntimeError(f"REPLAY_V3_ENTRY_WITHOUT_KEY_ZONE:{cid}")
            tp, status = selected_tp_evidence(row)
            if tp is None and status not in {
                NO_VISIBLE_MEANINGFUL_REACTION,
                TP_NOT_CAPTURABLE_FROM_PRESENTED_CONTEXT,
            }:
                raise RuntimeError(f"REPLAY_V3_ENTRY_WITHOUT_TP_CAPTURE_OR_CONTEXT_GAP:{cid}")
            if tp is not None:
                lab._norm_interval(tp)
    if observed != expected:
        raise RuntimeError("REPLAY_V3_MISSING_LABELS:" + ",".join(sorted(expected - observed)[:10]))


def grade_labels_v3_context_aware(labels: dict | list, review: dict, answer_key: dict) -> dict:
    validate_labels_v3_context_aware(labels, review)
    if answer_key.get("pack_id") != review.get("pack_id"):
        raise RuntimeError("REPLAY_V3_PACK_KEY_MISMATCH")
    rows_in = labels.get("labels", []) if isinstance(labels, dict) else labels
    out = []
    for trader in rows_in:
        answer = answer_key["answers"][trader["case_id"]]
        action_agree = trader["final_action"] == answer["bot_action"]
        timing_delta = None
        if str(trader["final_action"]).startswith("ENTER_") and answer["bot_entry_time"] and trader.get("first_entry_time"):
            timing_delta = (
                pd.Timestamp(trader["first_entry_time"]) - pd.Timestamp(answer["bot_entry_time"])
            ).total_seconds() / 60.0

        tp_grade = None
        tp, tp_status = selected_tp_evidence(trader)
        if action_agree and str(trader["final_action"]).startswith("ENTER_"):
            bot_tp = answer.get("bot_tp_reaction_cluster")
            if tp is not None and bot_tp:
                tp_grade = lab._geometry(lab._norm_interval(tp), lab._norm_interval(bot_tp))
                tp_grade["status"] = "GEOMETRY_COMPARED"
            elif tp_status == NO_VISIBLE_MEANINGFUL_REACTION:
                tp_grade = {
                    "status": "TRADER_PRESENTED_CONTEXT_HAS_NO_VISIBLE_MEANINGFUL_REACTION",
                    "context_gap": True,
                    "bot_target_present": bool(bot_tp),
                    "geometry_compared": False,
                }
            elif tp_status == TP_NOT_CAPTURABLE_FROM_PRESENTED_CONTEXT:
                tp_grade = {
                    "status": "TP_NOT_CAPTURABLE_FROM_PRESENTED_CONTEXT",
                    "context_gap": True,
                    "bot_target_present": bool(bot_tp),
                    "geometry_compared": False,
                }

        out.append({
            "case_id": trader["case_id"],
            "trader_action": trader["final_action"],
            "bot_action": answer["bot_action"],
            "action_agreement": action_agree,
            "trader_waited_through_presented_replay": trader["final_action"] == WAIT_AT_REPLAY_END,
            "trader_first_entry_time": trader.get("first_entry_time"),
            "bot_entry_time": answer["bot_entry_time"],
            "entry_timing_delta_minutes": timing_delta,
            "trader_force_at_entry": trader.get("entry_force"),
            "bot_setup": answer["bot_setup"],
            "bot_reason": answer["bot_reason"],
            "gold_reference_ids": answer["gold_reference_ids"],
            "key_zone_grade": lab._zone_grade(trader.get("trader_zones", []), answer["bot_relevant_zones"]),
            "trader_tp_capture_status": tp_status,
            "tp_reaction_cluster_grade": tp_grade,
        })

    disagreements = [r for r in out if not r["action_agreement"]]
    waits = [r for r in out if r["trader_waited_through_presented_replay"]]
    context_gaps = [
        r for r in out
        if isinstance(r.get("tp_reaction_cluster_grade"), dict)
        and r["tp_reaction_cluster_grade"].get("context_gap") is True
    ]
    return {
        "status": "V3_INTERACTIVE_FIDELITY_GRADE_ONLY_NOT_EDGE_EVIDENCE",
        "pack_id": review["pack_id"],
        "cases": len(out),
        "action_agreements": len(out) - len(disagreements),
        "action_agreement_rate": (len(out) - len(disagreements)) / max(len(out), 1),
        "disagreements": disagreements,
        "trader_wait_at_replay_end_cases": waits,
        "tp_presented_context_gaps": context_gaps,
        "rows": out,
        "warning": (
            "WAIT means the trader was still waiting when the presented replay window ended; it is not NO_TRADE. "
            "A TP context-gap status records a fidelity/presentation limitation. It must not be treated as proof that "
            "ROOM_TO_FIRST_REACTION passed, and no numeric TP may be invented."
        ),
    }
