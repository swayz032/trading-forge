#!/usr/bin/env python3
"""Generate the desktop interactive MNQ v2.4 replay-lab V3 pack.

Seen/contaminated 2026 data only. No clean OOS, PnL, exit outcome or parameter
selection is used. The safe pack never embeds bot answers, but later replay bars
are present for UI progressive disclosure and therefore are not cryptographically
withheld from a technically sophisticated reviewer.
"""
from __future__ import annotations

import json
from pathlib import Path

from research import current_mnq_strategy_v2_2_engine_final as old
from research import current_mnq_strategy_v2_4_engine as v24
from research.current_mnq_strategy_v2_4_replay_lab_v3 import (
    LWC_FILE,
    LWC_VERSION,
    build_replay_pack_v3,
    write_lab_v3,
)

ROOT = Path("research/_mnq_v24_replay_lab_v3")
DATA = ROOT / "data"
OUT = ROOT / "pack"
LOCK = Path("research/current_mnq_strategy_v2_2_data_lock.json")
CONTRACT = Path("research/current_mnq_strategy_v2_4_replay_lab_v3_contract.json")
GOLD = Path("research/current_mnq_strategy_v2_4_user_fidelity_gold.json")


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
    days = old.scoreable_days(env)
    # Scan the whole already-seen development sample. Selection is based on
    # authoritative pre-entry semantics and session diversity, never PnL/outcomes.
    review, answers = build_replay_pack_v3(
        env, days, v24.Params(), max_cases=16, max_entry_cases=11, min_entry_cases=8,
    )
    if review["case_count"] != 16 or review["session_count"] != 16:
        raise RuntimeError(
            f"REPLAY_V3_DIVERSITY_FAIL:{review['case_count']}:{review['session_count']}"
        )
    if answers.get("pack_id") != review.get("pack_id"):
        raise RuntimeError("REPLAY_V3_PACK_ID_MISMATCH")

    entry_cases = sum(
        1 for x in answers["answers"].values()
        if x["bot_action"] in {"ENTER_LONG", "ENTER_SHORT"}
    )
    if entry_cases < 8:
        raise RuntimeError(f"REPLAY_V3_TOO_FEW_MOMENTUM_ENTRY_CASES:{entry_cases}")

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
        "status": "INTERACTIVE_DESKTOP_V3_PACK_READY_FOR_TRADER_STYLE_CAPTURE",
        "schema_version": 3,
        "pack_id": review["pack_id"],
        "strategy_release": contract["strategy_release"],
        "chart_engine": f"TradingView Lightweight Charts {LWC_VERSION}",
        "chart_library_file_required": LWC_FILE,
        "data_contract": "seen/contaminated Jan-Apr 2026 M26 sample only",
        "clean_oos_opened": False,
        "pnl_or_exit_outcome_used_for_selection": False,
        "bot_answers_in_safe_pack": False,
        "session_count": review["session_count"],
        "case_count": review["case_count"],
        "authoritative_entry_case_count": entry_cases,
        "one_case_per_session": True,
        "tp_semantics": "FIRST_MEANINGFUL_REACTION_CLUSTER_NOT_SIDE_BY_SIDE_CANDLES",
        "user_gold_reference_manifest": str(GOLD),
        "user_media_bytes_committed": False,
        "future_bars_progressively_hidden_by_ui": True,
        "future_bars_cryptographically_withheld": False,
        "formal_blind_evidence_eligible": False,
        "edge_evidence_eligible": False,
        "next": "Open review_v3.html with the local Lightweight Charts JS beside it; trade each replay minute-by-minute; freeze/export mnq_replay_v3_labels_FROZEN.json; only then open answer_key_v3.json for timing/force/zone/reaction-cluster grading.",
    }
    (OUT / "receipt_v3.json").write_text(json.dumps(receipt, indent=2, sort_keys=True))
    print(json.dumps(receipt, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
