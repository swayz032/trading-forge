#!/usr/bin/env python3
"""Generate the robust blind Human-vs-Bot replay pack from seen 2026 MNQ data.

Development/fidelity only. This script never opens the clean 2019-2021 dataset,
never uses future trade outcomes, and never grades the trader before labels are
frozen. Bot zones/action/TP live only in the separately uploaded hidden key.
"""
from __future__ import annotations

import json
from pathlib import Path

from research import current_mnq_strategy_v2_2_engine_final as old
from research import current_mnq_strategy_v2_4_engine as v24
from research.current_mnq_strategy_v2_4_replay_lab import build_replay_pack, write_lab

ROOT = Path("research/_mnq_v24_replay_lab")
DATA = ROOT / "data"
OUT = ROOT / "pack"
LOCK = Path("research/current_mnq_strategy_v2_2_data_lock.json")


def main():
    observed = old.download_pinned(DATA, include_tick=False)
    lock = json.loads(LOCK.read_text())
    old.verify_manifest(observed, lock)
    raw5 = old.load_csv(DATA / Path(old.DATA_FILES["5m"]).name)
    raw1 = old.load_csv(DATA / Path(old.DATA_FILES["1m"]).name)
    dq = old.data_quality_gate(raw1, raw5)
    if dq["status"] != "PASS":
        raise RuntimeError("REPLAY_LAB_DATA_QUALITY_FAIL:" + "|".join(dq["issues"]))

    env = old.prepare(raw5, raw1)
    days = old.scoreable_days(env)
    # Fixed chronological prefix of the already-seen development sample. Workload
    # selection is independent of future outcomes and PnL.
    selected_days = days[:40]
    review, answers = build_replay_pack(
        env, selected_days, v24.Params(),
        max_entry_cases=8, max_touch_cases=8, max_no_zone_cases=6,
    )
    if review["case_count"] < 12:
        raise RuntimeError(f"REPLAY_LAB_TOO_FEW_CASES:{review['case_count']}")
    if answers.get("pack_id") != review.get("pack_id"):
        raise RuntimeError("REPLAY_LAB_PACK_ID_MISMATCH")

    write_lab(OUT, review, answers)
    safe_html = (OUT / "review.html").read_text(encoding="utf-8")
    safe_json = (OUT / "review_pack.json").read_text(encoding="utf-8")
    forbidden = ["bot_action", "bot_zones", "bot_tp_zone", "hidden_case_kind", "net_pnl", "exit_reason"]
    leaks = [x for x in forbidden if x in safe_json]
    if leaks:
        raise RuntimeError("REPLAY_LAB_SAFE_PACK_LEAK:" + ",".join(leaks))
    required_ui = ["chart15", "chart5", "chart1", "Draw Key Zone", "Draw TP Zone", "Freeze & Export Labels"]
    missing_ui = [x for x in required_ui if x not in safe_html]
    if missing_ui:
        raise RuntimeError("REPLAY_LAB_UI_MISSING:" + ",".join(missing_ui))

    receipt = {
        "status": "ROBUST_BLIND_ZONE_ENTRY_TP_PACK_READY_FOR_TRADER_LABELS",
        "schema_version": 2,
        "pack_id": review["pack_id"],
        "data_contract": "seen/contaminated Jan-Apr 2026 M26 sample only",
        "clean_oos_opened": False,
        "future_outcome_used": False,
        "pnl_in_review_pack": False,
        "bot_answer_in_review_pack": False,
        "bot_zones_in_review_pack": False,
        "bot_tp_in_review_pack": False,
        "ui_15m_key_zone_drawing": True,
        "ui_5m_tp_zone_drawing": True,
        "ui_1m_force_review": True,
        "ui_browser_autosave": True,
        "ui_frozen_label_export": True,
        "selected_session_count": len(selected_days),
        "case_count": review["case_count"],
        "next": "Trader opens review.html only, labels every case, exports mnq_replay_labels_FROZEN.json, then grading may open answer_key.json.",
    }
    (OUT / "receipt.json").write_text(json.dumps(receipt, indent=2, sort_keys=True))
    print(json.dumps(receipt, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
