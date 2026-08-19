#!/usr/bin/env python3
"""Generate the first blind Human-vs-Bot replay pack from seen 2026 MNQ data.

Development/fidelity only. This script never opens the clean 2019-2021 dataset,
never reports PnL, and never grades the trader before labels are frozen.
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
    # Fixed chronological prefix of the already-seen development sample. This is
    # a fidelity workload choice, not an outcome-selected sample.
    selected_days = days[:30]
    review, answers = build_replay_pack(
        env, selected_days, v24.Params(), max_entry_cases=12, max_touch_cases=12,
    )
    if review["case_count"] < 8:
        raise RuntimeError(f"REPLAY_LAB_TOO_FEW_CASES:{review['case_count']}")
    write_lab(OUT, review, answers)
    receipt = {
        "status": "BLIND_REPLAY_PACK_READY_FOR_TRADER_LABELS",
        "data_contract": "seen/contaminated Jan-Apr 2026 M26 sample only",
        "clean_oos_opened": False,
        "pnl_in_review_pack": False,
        "bot_answer_in_review_pack": False,
        "selected_session_count": len(selected_days),
        "case_count": review["case_count"],
        "next": "Trader labels review.html without opening answer_key.json; freeze labels before grading.",
    }
    (OUT / "receipt.json").write_text(json.dumps(receipt, indent=2, sort_keys=True))
    print(json.dumps(receipt, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
