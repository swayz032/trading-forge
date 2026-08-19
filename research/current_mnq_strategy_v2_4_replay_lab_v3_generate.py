#!/usr/bin/env python3
"""Generate the desktop interactive MNQ v2.4 replay-lab V3 pack.

Seen/contaminated 2026 data only. No clean OOS, PnL, exit outcome or parameter
selection is used. V3 deliberately excludes every session already shown in the
prior V2 trader review so a new fidelity pass does not recycle the same charts.
The pinned M26 development sample contains nine scoreable sessions not previously
shown; V3 uses those nine rather than faking a 16-case target with repeated days.
The safe pack never embeds bot answers, but later replay bars are present for UI
progressive disclosure and therefore are not cryptographically withheld.
"""
from __future__ import annotations

import json
from pathlib import Path

from research import current_mnq_strategy_v2_2_engine_final as old
from research import current_mnq_strategy_v2_4_engine as v24
from research.current_mnq_strategy_v2_4_replay_lab_v3 import (
    LWC_FILE,
    LWC_VERSION,
    write_lab_v3,
)
from research.current_mnq_strategy_v2_4_replay_lab_v3_selection import (
    build_replay_pack_v3_diverse,
)

ROOT = Path("research/_mnq_v24_replay_lab_v3")
DATA = ROOT / "data"
OUT = ROOT / "pack"
LOCK = Path("research/current_mnq_strategy_v2_2_data_lock.json")
CONTRACT = Path("research/current_mnq_strategy_v2_4_replay_lab_v3_contract.json")
GOLD = Path("research/current_mnq_strategy_v2_4_user_fidelity_gold.json")

PRIOR_V2_REVIEW_SESSIONS = frozenset({
    "2026-03-23", "2026-03-24", "2026-03-25", "2026-03-26",
    "2026-03-30", "2026-03-31", "2026-04-01", "2026-04-02",
})

ZONE_SOURCE_METHODS = [
    "VISIBLE_REJECTION",
    "ZOOMED_OUT_HIGHER_LOWER",
    "MOVE_AWAY_REJECTION_ORIGIN",
]


def main():
    contract = json.loads(CONTRACT.read_text())
    gold = json.loads(GOLD.read_text())
    if contract["status"] != "LOCKED_DESKTOP_INTERACTIVE_FIDELITY_LAB_V3":
        raise RuntimeError("REPLAY_V3_CONTRACT_NOT_LOCKED")
    observed_gold = {x["id"] for x in gold["fixtures"]}
    required_gold = set(contract["gold_reference"]["required_fixture_ids"])
    missing_gold = sorted(required_gold - observed_gold)
    if missing_gold:
        raise RuntimeError("REPLAY_V3_GOLD_REFERENCE_MISSING:" + ",".join(missing_gold))

    observed = old.download_pinned(DATA, include_tick=False)
    lock = json.loads(LOCK.read_text())
    old.verify_manifest(observed, lock)
    raw5 = old.load_csv(DATA / Path(old.DATA_FILES["5m"]).name)
    raw1 = old.load_csv(DATA / Path(old.DATA_FILES["1m"]).name)
    dq = old.data_quality_gate(raw1, raw5)
    if dq["status"] != "PASS":
        raise RuntimeError("REPLAY_V3_DATA_QUALITY_FAIL:" + "|".join(dq["issues"]))

    env = old.prepare(raw5, raw1)
    all_days = old.scoreable_days(env)
    days = [d for d in all_days if str(d) not in PRIOR_V2_REVIEW_SESSIONS]
    if not days:
        raise RuntimeError("REPLAY_V3_NO_FRESH_SESSIONS")

    # Do not recycle old sessions merely to preserve a cosmetic 16-case count.
    # Use every genuinely fresh scoreable session in the pinned development set.
    target_cases = min(16, len(days))
    min_entries = min(4, target_cases)
    min_near_misses = min(2, max(0, target_cases - min_entries))
    review, answers = build_replay_pack_v3_diverse(
        env, days, v24.Params(), max_cases=target_cases,
        max_entry_cases=min(6, target_cases), min_entry_cases=min_entries,
        min_momentum_near_miss_cases=min_near_misses,
    )
    if review["case_count"] != target_cases or review["session_count"] != target_cases:
        raise RuntimeError(
            f"REPLAY_V3_DIVERSITY_FAIL:{review['case_count']}:{review['session_count']}:{target_cases}"
        )
    if answers.get("pack_id") != review.get("pack_id"):
        raise RuntimeError("REPLAY_V3_PACK_ID_MISMATCH")

    current_sessions = {c["session"] for c in review["cases"]}
    overlap = sorted(current_sessions & PRIOR_V2_REVIEW_SESSIONS)
    if overlap:
        raise RuntimeError("REPLAY_V3_PRIOR_SESSION_REUSE:" + ",".join(overlap))

    sampling = answers.get("sampling_receipt", {})
    entry_cases = int(sampling.get("authoritative_entry_cases", 0))
    near_miss_cases = int(sampling.get("momentum_near_miss_cases", 0))
    if entry_cases < min_entries:
        raise RuntimeError(f"REPLAY_V3_TOO_FEW_MOMENTUM_ENTRY_CASES:{entry_cases}<{min_entries}")
    if near_miss_cases < min_near_misses:
        raise RuntimeError(f"REPLAY_V3_TOO_FEW_MOMENTUM_NEAR_MISSES:{near_miss_cases}<{min_near_misses}")

    write_lab_v3(OUT, review, answers)
    html = (OUT / "review_v3.html").read_text(encoding="utf-8")
    safe_json = (OUT / "review_pack_v3.json").read_text(encoding="utf-8")
    forbidden = [
        "bot_action", "bot_relevant_zones", "bot_tp_reaction_cluster",
        "bot_entry_time", "gold_reference_ids", "net_pnl", "gross_pnl",
        "exit_reason", "winner",
    ]
    leaks = [x for x in forbidden if x in safe_json]
    if leaks:
        raise RuntimeError("REPLAY_V3_SAFE_PACK_LEAK:" + ",".join(leaks))
    # These are scaffold markers before CI injects the unified trader-visible
    # enhancement and bundles the page into one self-contained HTML file.
    required_ui = [
        LWC_FILE, "15m Context / Key Zones", "5m Main Setup / TP Reaction Cluster",
        "1m Live Force / Tug-of-War", "+1m", "+5m", "Draw Key Zone",
        "Draw Reaction Cluster", "Freeze & Export", "requestFullscreen",
        "first meaningful <b>reaction cluster</b>",
    ]
    missing_ui = [x for x in required_ui if x not in html]
    if missing_ui:
        raise RuntimeError("REPLAY_V3_UI_MISSING:" + ",".join(missing_ui))

    receipt = {
        "status": "INTERACTIVE_DESKTOP_V3_FRESH_PACK_READY_FOR_TRADER_STYLE_CAPTURE",
        "schema_version": 3,
        "pack_id": review["pack_id"],
        "strategy_release": contract["strategy_release"],
        "chart_engine": f"TradingView Lightweight Charts {LWC_VERSION}",
        "data_contract": "seen/contaminated Jan-Apr 2026 M26 sample only",
        "clean_oos_opened": False,
        "pnl_or_exit_outcome_used_for_selection": False,
        "bot_answers_in_safe_pack": False,
        "session_count": review["session_count"],
        "case_count": review["case_count"],
        "available_fresh_scoreable_sessions": len(days),
        "authoritative_entry_case_count": entry_cases,
        "momentum_near_miss_case_count": near_miss_cases,
        "one_case_per_session": True,
        "prior_v2_review_sessions_excluded": sorted(PRIOR_V2_REVIEW_SESSIONS),
        "prior_v2_session_overlap_count": 0,
        "repeated_old_sessions_used_to_fill_case_count": False,
        "tp_semantics": "FIRST_MEANINGFUL_REACTION_CLUSTER_NOT_SIDE_BY_SIDE_CANDLES",
        "trader_requested_ui_layout": "ONE_UNIFIED_MAIN_STRUCTURE_CHART_PLUS_BOTTOM_1M_ENTRY_CHART",
        "key_zone_and_tp_same_main_chart_after_ci_enhancement": True,
        "main_chart_timeframe_switch": ["5m", "15m"],
        "main_chart_native_pan_zoom": True,
        "main_chart_explicit_zoom_controls": True,
        "zone_source_methods": ZONE_SOURCE_METHODS,
        "move_away_rejection_can_be_marked_after_waiting_for_visible_separation": True,
        "one_final_entry_per_case": True,
        "user_gold_reference_manifest": str(GOLD),
        "user_media_bytes_committed": False,
        "future_bars_progressively_hidden_by_ui": True,
        "future_bars_cryptographically_withheld": False,
        "formal_blind_evidence_eligible": False,
        "edge_evidence_eligible": False,
        "standalone_html_expected_after_ci_bundle_step": True,
        "next": "Open review_v3.html; use the one big main chart for key zones + TP, switch 5m/15m and zoom/pan when the level is outside the immediate view, use the bottom 1m chart for force/entry timing, make one final ENTER/NO_TRADE decision, then freeze/export mnq_replay_v3_labels_FROZEN.json. Only after labels freeze may the hidden answer key be opened for grading.",
    }
    (OUT / "receipt_v3.json").write_text(json.dumps(receipt, indent=2, sort_keys=True))
    print(json.dumps(receipt, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
