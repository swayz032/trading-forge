#!/usr/bin/env python3
"""ALGO-163 - Does the CONFLUENCE RANK do anything? An ablation of my own build's stated mechanism.

MNQ-SR-CLEANROOM-SPEC.md section 1 says, verbatim: "Rule 4 is the whole build ... Here confluence
count IS the rank." THIS SCRIPT TESTS THAT SENTENCE AND REFUTES IT.

This is NOT a threshold search and it may not become one. ALGO-162 forbids hunting a cap between
3 and 6. Nothing here varies the cap: TOP_PER_SESSION stays 3 in every arm. The only thing varied
is the SORT KEY, and it is varied to attack my own causal claim, not to find a better map.

PRE-DECLARED BEFORE RUNNING, and binding whatever comes back: no arm of this ablation licenses a
change to mnq_sr_cleanroom_v1.py. If an arm scores higher, that is a FINDING ABOUT THE CLAIM,
not a candidate build. Adopting it would be selecting a rank by what it does to his fourteen
sessions - the exact contamination the clean-room exists to exclude.
"""
from __future__ import annotations

import io
import json
from pathlib import Path

import pandas as pd

from research import current_mnq_strategy_v2_2_engine_final as old
from research import current_mnq_strategy_v2_3_engine as prod
import research.mnq_sr_cleanroom_v1 as CR

core = prod.core
R = "research/"
D = Path(R + "_mnq_v24_replay_lab_v3/data")

ARMS = {
    "AS_BUILT           (conf, members, recent)": lambda z: (-z.confluence, -z.members, -z.last_t.value),
    "NO_CONFLUENCE      (members, recent)":       lambda z: (-z.members, -z.last_t.value),
    "CONFLUENCE_ONLY    (conf, no tiebreak)":     lambda z: (-z.confluence,),
    "RECENCY_ONLY       (recent)":                lambda z: (-z.last_t.value,),
    "MEMBERS_ONLY       (members)":               lambda z: (-z.members,),
}


def _overlap(a_lo, a_hi, b_lo, b_hi):
    return not (a_hi < b_lo or b_hi < a_lo)


def main() -> None:
    env = old.prepare(old.load_csv(D / Path(old.DATA_FILES["5m"]).name),
                      old.load_csv(D / Path(old.DATA_FILES["1m"]).name))
    cases = json.load(io.open(
        R + "current_mnq_strategy_v2_4_frozen_replay_case_manifest_2026_08_20.json",
        encoding="utf-8"))["cases"]
    labels = {r["case_id"]: r for r in json.load(io.open(
        R + "current_mnq_strategy_v2_4_replay_v3_labels_FROZEN.json",
        encoding="utf-8"))["labels"]}

    CR.TOP_PER_SESSION = 99            # build the full candidate set, then cut in each arm at 3
    cov = {k: 0 for k in ARMS}
    fam_hits, n_cand, by_conf, by_tie = {}, 0, 0, 0

    for c in cases:
        asof = pd.Timestamp(f"{c['session']} 09:30", tz=core.TZ)
        zones = CR.build_map(env["h15"], env["full5"], asof)
        his = labels.get(c["case_id"], {}).get("trader_zones") or []
        n_cand += len(zones)
        for z in zones:
            for f in z.families:
                fam_hits[f] = fam_hits.get(f, 0) + 1
        s = sorted(zones, key=lambda z: (-z.confluence, -z.members, -z.last_t.value))
        if len(s) > 3:
            if s[2].confluence != s[3].confluence:
                by_conf += 1
            else:
                by_tie += 1
        for name, key in ARMS.items():
            top = sorted(zones, key=key)[:3]
            cov[name] += sum(1 for h in his
                             if any(_overlap(h["lo"], h["hi"], t.lo, t.hi) for t in top))
    CR.TOP_PER_SESSION = 3

    print(f"candidate levels across the 14 sessions: {n_cand}")
    print("FAMILY FIRING RATES - a family that fires on everything cannot rank anything:")
    for f, n in sorted(fam_hits.items(), key=lambda kv: -kv[1]):
        print(f"   {f:22s} {n:4d} of {n_cand}   ({100*n/n_cand:5.1f}%)")
    print()
    print(f"the top-3 boundary decided BY CONFLUENCE: {by_conf} of 14 sessions")
    print(f"the top-3 boundary decided BY A TIEBREAK: {by_tie} of 14 sessions")
    print()
    print("coverage of his 28 marked levels, pad 0.00, cap fixed at 3 in EVERY arm:")
    for name in ARMS:
        print(f"   {name:44s} {cov[name]:2d} of 28")
    print()
    print("v2.4 baseline at the same pad and arm: 13 of 28, from 37.3 zones per session.")


if __name__ == "__main__":
    main()
