#!/usr/bin/env python3
"""THE RANK CONTEST SPLIT — what `kernel.py:205`'s precedence dictionary actually decides.
DIAGNOSTIC ONLY. REPORTS BY KEY. DERIVES NOTHING.

ALGO-132 §2, and the distinction it turns on, restated so it cannot drift:
**measuring what the code DOES is not fitting; measuring what improves the SCORE is.**
Nothing here is scored, ranked for merit, or compared to an arm. No repair is proposed.

THE QUESTION. `_rank_and_yield` takes `max(candidates, key=(rank[setup], quality, confluence))`
over same-direction candidates at one bucket, and **it ignores location identity entirely**. So
one operator adjudicates two structurally different situations, and ALGO-132 §2 pre-registered
both branches BEFORE this ran:

  SAME-ZONE   two or more candidates at the SAME location id. The teaching says one interaction
              at one zone has at most ONE true classification (`video_evidence.md` principle 5,
              source-7 rule 3 `BOTH_OUTCOMES_ALLOWED_AT_ZONE`, and the engineering order
              `CLASSIFY REJECT / RECLAIM / BREAK / RETEST`). ⇒ the CLASSIFIER is the defect and
              the rank is only what makes it visible.

  CROSS-ZONE  candidates at DIFFERENT location ids. A real choice — and the teaching answers it
              with no setup-family preference. ⇒ `no citation found in the surfaces named` is the
              honest close, NOT a licence to invent one.

INSTRUMENT CAVEAT, STATED BECAUSE IT BOUNDS THE RESULT. This reads the X-ray's
`SURVIVED_TO_RANKING` records, which are emitted at the same site where the kernel appends to its
candidate list. It is the closest committed observer of that list. It is NOT the list itself:
ALGO-096 established that the X-ray asks FORCE FIRST where the kernel asks it later, so an
evaluation-order difference exists between the two. Every count below is therefore
`ARTIFACT-SOURCED from the X-ray`, not `MEASURED at kernel.py:205`, and a same-key disagreement
between the two would be a finding in its own right.

Run: PYTHONPATH=. python -m research.run_algo132_rank_contest_split_2026_08_26
"""
from __future__ import annotations

import io
import json
import time
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

from research import current_mnq_strategy_v2_2_engine_final as old
from research import current_mnq_strategy_v2_4_engine as v24
from research.current_mnq_strategy_v2_4_candidate_xray import xray_session

DATA = Path("research/_mnq_v24_replay_lab_v3/data")
LOCK = Path("research/current_mnq_strategy_v2_2_data_lock.json")
MANIFEST = Path("research/current_mnq_strategy_v2_4_frozen_replay_case_manifest_2026_08_20.json")
OUT = Path("research/current_mnq_strategy_v2_4_algo132_rank_contest_split_2026_08_26.json")

ROUTE_A = "A_NORMAL_REJECTION"
#: `kernel.py:205` verbatim. Reproduced to REPORT which candidate the dictionary selects.
#: It is not endorsed, and no alternative ordering is computed anywhere in this file.
RANK = {"BRK5": 3, "BRK15": 2, "REV": 1}


def _setup_of(rec: dict) -> str:
    """The kernel's setup label for an X-ray record. Route A is REV; the break family is BRK5
    unless the record carries the 15m variant, which the kernel ranks as BRK15."""
    if rec.get("route") == ROUTE_A:
        return "REV"
    return "BRK15" if rec.get("variant") else "BRK5"


def main() -> int:
    t0 = time.perf_counter()
    sessions = [c["session"] for c in json.load(io.open(MANIFEST, encoding="utf-8"))["cases"]]
    old.verify_manifest(old.download_pinned(DATA, include_tick=False),
                        json.loads(LOCK.read_text(encoding="utf-8")))
    env = old.prepare(old.load_csv(DATA / Path(old.DATA_FILES["5m"]).name),
                      old.load_csv(DATA / Path(old.DATA_FILES["1m"]).name))
    p = v24.Params()

    contests, per_session = [], {}
    for s in sessions:
        recs = xray_session(env, date.fromisoformat(s), p)["records"]
        groups: dict[tuple, list] = defaultdict(list)
        for r in recs:
            if r.get("outcome") != "SURVIVED_TO_RANKING":
                continue
            groups[(r.get("bucket"), r.get("direction"))].append(r)

        n_contest = n_same = n_cross = n_mixed = 0
        for (bucket, direction), members in sorted(groups.items()):
            if len(members) < 2:
                continue
            n_contest += 1
            locs = [str(m.get("location_id")) for m in members]
            setups = [_setup_of(m) for m in members]
            by_loc = Counter(locs)
            same_zone_pairs = sorted(k for k, v in by_loc.items() if v > 1)
            distinct_locs = len(by_loc)
            if same_zone_pairs and distinct_locs > 1:
                kind = "MIXED"
                n_mixed += 1
            elif same_zone_pairs:
                kind = "SAME_ZONE"
                n_same += 1
            else:
                kind = "CROSS_ZONE"
                n_cross += 1

            winner = max(members, key=lambda m: (RANK[_setup_of(m)],
                                                 float(m.get("location_quality") or 0.0),
                                                 int(m.get("location_confluence") or 0)))
            #: A contest the rank DECIDED is one where the setups differ. Where every
            #: candidate shares a setup the dictionary is not the tiebreaker and saying so
            #: matters - otherwise a count of "contests" overstates what the rank did.
            rank_decided = len(set(setups)) > 1
            rev_present = "REV" in setups
            contests.append({
                "session": s, "bucket": bucket, "direction": direction,
                "kind": kind, "n_candidates": len(members),
                "distinct_locations": distinct_locs,
                "same_zone_location_ids": same_zone_pairs,
                "setups": sorted(setups),
                "rank_was_the_tiebreaker": rank_decided,
                "a_rejection_was_present": rev_present,
                "a_rejection_lost_to_a_break": bool(
                    rev_present and _setup_of(winner) != "REV"),
                "winner_setup": _setup_of(winner),
                "winner_location_id": str(winner.get("location_id")),
                "members": [{"setup": _setup_of(m), "route": m.get("route"),
                             "location_id": str(m.get("location_id")),
                             "location_source": m.get("location_source"),
                             "clock": m.get("clock")} for m in members],
            })
        per_session[s] = {"buckets_with_a_survivor": len(groups), "contests": n_contest,
                          "SAME_ZONE": n_same, "CROSS_ZONE": n_cross, "MIXED": n_mixed}
        print(f"  {s}  contests={n_contest:3d}  same={n_same:3d} cross={n_cross:3d} "
              f"mixed={n_mixed:3d}", flush=True)

    kinds = Counter(c["kind"] for c in contests)
    artifact = {
        "artifact": "ALGO132_RANK_CONTEST_SPLIT",
        "status": "DIAGNOSTIC ONLY. Reports what the rank decides, by key. Derives nothing, "
                  "proposes nothing, scores nothing.",
        "authority": "ALGO-132 §2",
        "evidence_grade": "ARTIFACT-SOURCED from the X-ray's SURVIVED_TO_RANKING records - NOT "
                          "measured at kernel.py:205. See the module docstring: ALGO-096 "
                          "established an evaluation-order difference between the two.",
        "the_rank_verbatim": "kernel.py:205  rank = {'BRK5': 3, 'BRK15': 2, 'REV': 1}",
        "pre_registered_branches": {
            "SAME_ZONE": "the teaching forbids two classifications of one interaction, so the "
                         "CLASSIFIER is the defect and the rank is a symptom",
            "CROSS_ZONE": "a real choice the teaching answers with no setup preference; "
                          "`no citation found in the surfaces named` is the honest close",
        },
        "totals": {
            "contests": len(contests),
            "SAME_ZONE": kinds.get("SAME_ZONE", 0),
            "CROSS_ZONE": kinds.get("CROSS_ZONE", 0),
            "MIXED": kinds.get("MIXED", 0),
            "contests_where_the_rank_was_the_tiebreaker": sum(
                1 for c in contests if c["rank_was_the_tiebreaker"]),
            "contests_where_a_rejection_lost_to_a_break": sum(
                1 for c in contests if c["a_rejection_lost_to_a_break"]),
        },
        "per_session": per_session,
        "contests": contests,
        "no_pnl": "No PnL, realized outcome, winner/loser label or clean-edge result is read "
                  "anywhere in this artifact.",
        "elapsed_s": round(time.perf_counter() - t0, 2),
    }
    io.open(OUT, "w", encoding="utf-8", newline="\n").write(
        json.dumps(artifact, indent=2, sort_keys=True))
    print(f"\nTOTALS {artifact['totals']}")
    print(f"wrote {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
