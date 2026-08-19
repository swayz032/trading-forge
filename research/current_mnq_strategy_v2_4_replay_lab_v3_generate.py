#!/usr/bin/env python3
"""Generate the desktop interactive MNQ v2.4 replay-lab V3 pack.

Seen/contaminated 2026 data only. No clean OOS, PnL, exit outcome or parameter
selection is used. V3 deliberately excludes every session already shown in the
prior V2 trader review so a new fidelity pass does not recycle the same charts.
The safe pack never embeds bot answers, but later replay bars are present for UI
progressive disclosure and therefore are not cryptographically withheld from a
technically sophisticated reviewer.
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

# These are the eight sessions exposed to the trader in the completed V2 blind
# pack. V3 must not reuse them. This is a presentation/fidelity constraint only;
# it is not a strategy threshold and no trade outcome participates in exclusion.
PRIOR_V2_REVIEW_SESSIONS = frozenset({
    "2026-03-23",
    "2026-03-24",
    "2026-03-25",
    "2026-03-26",
    "2026-03-30",
    "2026-03-31",
    "2026-04-01",
    "2026-04-02",
})


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
    if len(days) < 16:
        raise RuntimeError(f"REPLAY_V3_TOO_FEW_FRESH_SESSIONS:{len(days)}")

    # Scan the whole already-seen development sample after removing prior review
    # sessions. Selection is based on authoritative full entries plus real force
    # candidates rejected by the final room/TP gate, all on different sessions.
    # No PnL, exit, winner/loser or future trade outcome is read.
    review, answers = build_replay_pack_v3_diverse(
        env, days, v24.Params(), max_cases=16, max_entry_cases=11,
        min_entry_cases=8, min_momentum_near_miss_cases=4,
    )
    if review["case_count"] != 16 or review["session_count"] != 16:
        raise RuntimeError(
            f"REPLAY_V3_DIVERSITY_FAIL:{review['case_count']}:{review['session_count']}"
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
    if entry_cases < 8:
        raise RuntimeError(f"REPLAY_V3_TOO_FEW_MOMENTUM_ENTRY_CASES:{entry_cases}")
    if near_miss_cases < 4:
        raise RuntimeError(f"REPLAY_V3_TOO_FEW_MOMENTUM_NEAR_MISSES:{near_miss_cases}")

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
        "data_contract": "seen/contaminated Jan-Apr 2026 M26 sample only",
        "clean_oos_opened": False,
        "pnl_or_exit_outcome_used_for_selection": False,
        "bot_answers_in_safe_pack": False,
        "session_count": review["session_count"],
        "case_count": review["case_count"],
        "authoritative_entry_case_count": entry_cases,
        "momentum_near_miss_case_count": near_miss_cases,
        "one_case_per_session": True,
        "prior_v2_review_sessions_excluded": sorted(PRIOR_V2_REVIEW_SESSIONS),
        "prior_v2_session_overlap_count": 0,
        "tp_semantics": "FIRST_MEANINGFUL_REACTION_CLUSTER_NOT_SIDE_BY_SIDE_CANDLES",
        "user_gold_reference_manifest": str(GOLD),
        "user_media_bytes_committed": False,
        "future_bars_progressively_hidden_by_ui": True,
        "future_bars_cryptographically_withheld": False,
        "formal_blind_evidence_eligible": False,
        "edge_evidence_eligible": False,
        "standalone_html_expected_after_ci_bundle_step": True,
        "next": "Open review_v3.html; trade each fresh replay minute-by-minute; one final ENTER/NO_TRADE decision is allowed per case; freeze/export mnq_replay_v3_labels_FROZEN.json; only then open answer_key_v3.json for timing/force/zone/reaction-cluster grading.",
    }
    (OUT / "receipt_v3.json").write_text(json.dumps(receipt, indent=2, sort_keys=True))
    print(json.dumps(receipt, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
