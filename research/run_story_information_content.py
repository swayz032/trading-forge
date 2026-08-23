#!/usr/bin/env python3
"""Collect the Story flags for every Route A entry and analyse them. DIAGNOSTIC ONLY.

The collection half of `current_mnq_strategy_v2_4_story_information_content`. It lives here
because a test forbids anything in the `current_mnq_strategy_v2_4_*` namespace from importing
the X-ray -- that guard caught the first version of this code sitting in the library module.

Run: PYTHONPATH=. python -m research.run_story_information_content
"""
from __future__ import annotations

import io
import json
from datetime import date
from pathlib import Path

from research import current_mnq_strategy_v2_2_engine_final as old
from research import current_mnq_strategy_v2_4_engine as v24
from research.current_mnq_strategy_v2_4_candidate_xray import ROUTE_A_REJECTION, xray_session
from research.current_mnq_strategy_v2_4_entries import reversal_story_v24
from research.current_mnq_strategy_v2_4_story_information_content import (
    ENTERED,
    STORY_FIELDS,
    analyse,
)

DATA = Path("research/_mnq_v24_replay_lab_v3/data")
LOCK = Path("research/current_mnq_strategy_v2_2_data_lock.json")
SCORECARD = Path("research/current_mnq_strategy_v2_4_frozen_14_case_scorecard_2026_08_21.json")
OUT = Path("research/current_mnq_strategy_v2_4_story_information_content_2026_08_22.json")


def collect(scorecard: Path = SCORECARD) -> list[dict]:
    sc = json.load(io.open(scorecard, encoding="utf-8"))
    observed = old.download_pinned(DATA, include_tick=False)
    old.verify_manifest(observed, json.loads(LOCK.read_text()))
    raw5 = old.load_csv(DATA / Path(old.DATA_FILES["5m"]).name)
    raw1 = old.load_csv(DATA / Path(old.DATA_FILES["1m"]).name)
    env = old.prepare(raw5, raw1)
    p = v24.Params()

    rows = []
    for case in sorted(sc["cases"], key=lambda c: c["session"]):
        if case["entry_family_receipt"] != "REV":
            continue
        clock = case["bot_decision_clock"]
        direction = "L" if case["bot_state_in_window"] == "ENTER_LONG" else "S"
        captured: dict = {}

        def hook(record, **inputs):
            captured[(record["clock"], record["direction"])] = inputs

        xr = xray_session(env, date.fromisoformat(case["session"]), p,
                          on_rejection_candidate=hook)
        grant = next((r for r in xr["records"]
                      if r.get("outcome") == "SURVIVED_TO_RANKING"
                      and r.get("route") == ROUTE_A_REJECTION
                      and r["clock"] == clock and r["direction"] == direction), None)
        if grant is None:
            continue
        inp = captured[(clock, direction)]
        story = reversal_story_v24(inp["full5"], inp["ts"], inp["row"], inp["direction"],
                                   inp["loc"], inp["p"], inp["pad"])
        loc = inp["loc"]
        row = {"session": case["session"], "wanted": case["trader_state"] in ENTERED,
               "quality": float(getattr(loc, "quality", 0.0)),
               "confluence": float(getattr(loc, "confluence", 0.0))}
        row.update({f: bool(getattr(story, f)) for f in STORY_FIELDS})
        rows.append(row)
    return rows


def main() -> None:
    a = analyse(collect())
    print(f'{"field":18} {"wanted":>8} {"unwanted":>9}  note')
    for f, v in a["fields"].items():
        note = "SEPARATES" if v["separates"] else ("constant" if v["constant"] else "")
        print(f'  {f:16} {v["wanted"]:>8} {v["unwanted"]:>9}  {note}')
    print()
    print(f'constant  : {len(a["constant_fields"])} {a["constant_fields"]}')
    print(f'varying   : {len(a["varying_fields"])} {a["varying_fields"]}')
    print(f'separating: {len(a["separating_fields"])}')
    print(f'follow_through == decision everywhere: '
          f'{a["duplicate_fields"]["follow_through_equals_decision"]}')
    print(f'weakening never fires: {a["weakening_never_fires"]}')
    print()
    print(a["verdict"])
    io.open(OUT, "w", encoding="utf-8", newline="\n").write(
        json.dumps(a, indent=2, ensure_ascii=False) + "\n")
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
