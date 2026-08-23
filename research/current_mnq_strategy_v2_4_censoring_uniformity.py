#!/usr/bin/env python3
"""Is the right-censoring criterion applied UNIFORMLY across all 14 cases? DIAGNOSTIC ONLY.

WHY THIS IS THE MOST DANGEROUS NUMBER IN THE CAMPAIGN. Censoring is the mechanism by which a bad
score becomes a good one: every case moved into the censored bucket leaves the denominator, and
the published 6/8 looks far better than 6/14. Selective application -- leaving a case in the
denominator because it happens to AGREE, or censoring one out because it does not -- would
manufacture the headline, and nothing else in the evaluator would show it.

WHAT IS MEASURED. The runner takes censoring from the labels file's own `capture_warnings`,
which is an EXTERNAL authority rather than the evaluator's own judgement, and that is the right
design. What nothing checked is whether those warnings agree with the timelines in the same
file. This derives the condition independently and compares.

THE RESULT, AND THE CORRECTION IT FORCED ON ME. [MEASURED 2026-08-22]

Exactly one case disagreed with my first derived rule -- 2026-04-02 -- and the LABELS FILE WAS
RIGHT AND MY RULE WAS WRONG. I had derived "no entry AND timeline ends at the window end" as the
censoring condition. That lumps two different things together:

    WAIT      the replay ended while the trader was still watching. He never decided.
              RIGHT-CENSORED. Correctly excluded from the denominator.
    NO_TRADE  the trader positively decided NOT to trade. That IS a decision.
              It belongs in the denominator, and it is counted against the bot.

2026-04-02 is `NO_TRADE` at exactly the window end, is NOT censored, and carries
`BOT_ONLY_ENTRY_UNCENSORED_DECLINE` -- the bot entered where the trader declined. So the one
place the labels file departs from a naive rule is a place where it is STRICTER, keeping in the
denominator a case the bot FAILS. That is the opposite of manufacturing a good score.

    14 = 7 trader entries + 1 positive decline + 6 right-censored

This module is a MEASUREMENT, not a grade. I cannot grade my own evaluator. Whether the
measurement is adequate is for the independent grader and the advisor to say.

A LIMITATION FOUND ALONG THE WAY, recorded because nothing else records it: every one of the 14
`decision_timeline` arrays has EXACTLY ONE ENTRY. The schema can express a trader who changes
his mind mid-window; this corpus never does. Any reasoning that depends on a multi-step trader
timeline has no support here.

Run: PYTHONPATH=. python -m research.current_mnq_strategy_v2_4_censoring_uniformity
"""
from __future__ import annotations

import io
import json
from pathlib import Path

import pandas as pd

DIAGNOSTIC_ONLY = (
    "DIAGNOSTIC_ONLY. Checks that a stated criterion is applied uniformly. Selects no strategy "
    "rule and grades nothing. ALGO-011."
)

LABELS = Path("C:/Users/tonio/Downloads/mnq_replay_v3_labels_FROZEN.json")
SCORECARD = Path("research/current_mnq_strategy_v2_4_frozen_14_case_scorecard_2026_08_21.json")
WARNING = "TRADER_ENDED_PRESENTED_REPLAY_STILL_WAITING"

ENTERED = frozenset({"ENTER_LONG", "ENTER_SHORT"})
#: The trader never decided -- the replay ran out. These are right-censored.
UNDECIDED = frozenset({"WAIT"})
#: A positive decision NOT to trade. NOT censored; it belongs in the denominator.
DECLINED = frozenset({"NO_TRADE"})


def rows(labels: Path = LABELS, scorecard: Path = SCORECARD) -> list[dict]:
    doc = json.load(io.open(labels, encoding="utf-8"))
    sc = json.load(io.open(scorecard, encoding="utf-8"))
    declared = {w["case_id"] for w in doc["capture_warnings"] if w["warning"] == WARNING}
    by_id = {c["case_id"]: c for c in sc["cases"]}

    out = []
    for lab in doc["labels"]:
        cid = lab["case_id"]
        case = by_id[cid]
        tl = lab["decision_timeline"]
        w_end = pd.Timestamp(case["replay_window"]["end"])
        last = pd.Timestamp(tl[-1]["time"]) if tl else None
        action = lab["final_action"]
        out.append({
            "session": case["session"], "case_id": cid,
            "final_action": action,
            "timeline_len": len(tl),
            "ends_at_window_end": bool(last is not None and last == w_end),
            "declared_censored": cid in declared,
            "derived_censored": action in UNDECIDED,
            "kind": ("ENTERED" if action in ENTERED else
                     "DECLINED" if action in DECLINED else
                     "UNDECIDED" if action in UNDECIDED else "UNKNOWN_ACTION"),
            "mismatch_class": case["mismatch_class"],
        })
    return sorted(out, key=lambda r: r["session"])


def audit(labels: Path = LABELS, scorecard: Path = SCORECARD) -> dict:
    rs = rows(labels, scorecard)
    disagreements = [r for r in rs if r["declared_censored"] != r["derived_censored"]]
    unknown = [r for r in rs if r["kind"] == "UNKNOWN_ACTION"]
    entered = [r for r in rs if r["kind"] == "ENTERED"]
    declined = [r for r in rs if r["kind"] == "DECLINED"]
    undecided = [r for r in rs if r["kind"] == "UNDECIDED"]
    return {
        "status": DIAGNOSTIC_ONLY,
        "cases": len(rs),
        "entered": len(entered),
        "declined_positively": len(declined),
        "undecided_right_censored": len(undecided),
        "declared_censored": sum(1 for r in rs if r["declared_censored"]),
        "uniform": not disagreements and not unknown,
        "disagreements": disagreements,
        "unknown_actions": unknown,
        "every_timeline_has_one_entry": all(r["timeline_len"] == 1 for r in rs),
        "decomposition": (f'{len(rs)} = {len(entered)} entries + {len(declined)} positive '
                          f'decline + {len(undecided)} right-censored'),
        "rows": rs,
    }


def main() -> None:
    a = audit()
    w = f'{"session":11} {"final_action":13} {"kind":10} {"at end":7} {"censored":9} {"class"}'
    print(w)
    print("-" * 88)
    for r in a["rows"]:
        print(f'{r["session"]:11} {r["final_action"]:13} {r["kind"]:10} '
              f'{str(r["ends_at_window_end"]):7} {str(r["declared_censored"]):9} '
              f'{r["mismatch_class"]}')
    print()
    print(a["decomposition"])
    print(f'uniform: {a["uniform"]}   disagreements: {len(a["disagreements"])}   '
          f'unknown actions: {len(a["unknown_actions"])}')
    for r in a["disagreements"]:
        print(f'  DISAGREE {r["session"]} {r["final_action"]}')
    if not a["every_timeline_has_one_entry"]:
        print("NOTE: a timeline with more than one entry now exists - the docstring is stale.")


if __name__ == "__main__":
    main()
