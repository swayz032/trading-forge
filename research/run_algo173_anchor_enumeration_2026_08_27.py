#!/usr/bin/env python3
"""ALGO-173 - THE ENUMERATION. Authorized by ALGO-172.

ALGO-171 closed one instance at source. `[instance-not-condition]` says the next move is THE COUNT,
not a bigger claim. So: for EVERY decision strictly inside 08:00-09:30 across all 14 sessions, does
its location set contain a zone that is ABSENT from the causal 08:00-anchored build?

REPORTED AS TWO SEPARATE COUNTS, because they are different objects and only one of them is a trade:
  * affected DECISIONS - any walked candidate whose chosen location is absent at 08:00
  * affected BULLETS   - only those where `became_the_trade` is true

POSITIVE CONTROL PER SESSION, not once for the run: the 08:00 build must return a NON-EMPTY
authorized location set. If it were empty, every "absent at 08:00" would be a statement about an
empty call rather than about a zone - and the whole enumeration would read as a maximal positive
for the most boring possible reason.

READ-ONLY. No v2.4 file is written and nothing is monkeypatched. NO REPAIR IS PROPOSED: moving
kernel.py:222 changes which zones exist at all and would invalidate every campaign number measured
against the current map, which makes it a ruling and not a worker's edit.

SCOPE HELD: this is zone EXISTENCE, not zone STATE. ALGO-137's refutation of the state version
stands untouched - `zone_state_at` really is re-evaluated per bucket at `ts`.
"""
from __future__ import annotations

# ACCEPTANCE NOTE (ALGO-174): this file is the CONVICTING INSTRUMENT and is re-run to prove the
# repair, per [red-path-decay] - never a fresh instrument built after the fact. The ONLY thing
# parameterized below is the INPUT WALK PATH, so the same script can read the pre-repair baseline
# and the post-repair walk. The predicate, the per-session positive control and the two counts are
# byte-identical to the run that convicted the kernel.
import io
import json
import sys
from datetime import date
from pathlib import Path

import pandas as pd

from research import current_mnq_strategy_v2_2_engine_final as old
from research import current_mnq_strategy_v2_3_engine as prod
from research import current_mnq_strategy_v2_4_kernel as K

core = prod.core
R = Path("research")
DATA = R / "_mnq_v24_replay_lab_v3/data"
#: Default is the PRE-REPAIR baseline, unchanged. `argv[1]` points the SAME predicate at the
#: post-repair walk for the ALGO-174 acceptance. Nothing else about this script varies.
WALK = Path(sys.argv[1]) if len(sys.argv) > 1 else \
    R / "current_mnq_strategy_v2_4_algo141_what_drops_his_setup.json"
WIN_LO, WIN_HI = "08:00", "09:30"


def main() -> None:
    env = old.prepare(old.load_csv(DATA / Path(old.DATA_FILES["5m"]).name),
                      old.load_csv(DATA / Path(old.DATA_FILES["1m"]).name))
    p = prod.Params()
    walk = json.load(io.open(WALK, encoding="utf-8"))["per_session"]

    rows, control_failures, by_own_ts = [], [], []
    n_dec = n_bullet = 0

    for day in sorted(walk):
        dte = date.fromisoformat(day)
        late, _ = K.build_entry_locations_v24(
            env, dte, pd.Timestamp(f"{day} 09:30", tz=core.TZ), p)
        causal, _ = K.build_entry_locations_v24(
            env, dte, pd.Timestamp(f"{day} 08:00", tz=core.TZ), p)
        late_ids = {str(x.id) for x in late if x.entry_authorized}
        causal_ids = {str(x.id) for x in causal if x.entry_authorized}

        # ---- POSITIVE CONTROL, PER SESSION ----
        if not causal_ids:
            control_failures.append(day)
            continue

        for r in walk[day].get("rows", []):
            st = r.get("signal_time") or r.get("confirmed_time") or r.get("entry_time")
            if not st:
                continue
            ts = pd.Timestamp(st)
            if not (pd.Timestamp(f"{day} {WIN_LO}", tz=ts.tz) <= ts
                    < pd.Timestamp(f"{day} {WIN_HI}", tz=ts.tz)):
                continue
            n_dec += 1
            is_bullet = bool(r.get("became_the_trade"))
            n_bullet += is_bullet
            zid = str(r.get("location_id"))

            #: ── PREDICATE B, ADDED BEFORE THE POST-REPAIR RUN, NOT AFTER SEEING IT ──
            #: PREDICATE A below ("absent from the 08:00 build") was correct while the kernel had
            #: ONE anchor. It is WRONG AS AN ACCEPTANCE for the repaired kernel, and this is
            #: knowable without running anything: after the repair there is no single anchor, so a
            #: decision at 09:15 may LEGITIMATELY use a level that formed at 08:45. Predicate A
            #: would score that as affected and fail a correct repair.
            #: Predicate B is the PROPERTY the ruling actually states: is the chosen location
            #: present in the build at THIS DECISION'S OWN `ts`?
            own, _ = K.build_entry_locations_v24(env, dte, ts, p)
            own_ids = {str(x.id) for x in own if x.entry_authorized}
            non_causal_at_own_ts = bool(own_ids) and zid not in own_ids
            if non_causal_at_own_ts:
                by_own_ts.append({"session": day, "decision_ts": str(ts)[:19], "zone_id": zid,
                                  "became_the_trade": is_bullet, "n_locs_own_ts": len(own_ids)})

            affected = zid in late_ids and zid not in causal_ids
            if affected:
                rows.append({
                    "session": day, "decision_ts": str(ts)[:19], "zone_id": zid,
                    "at_0930": "PRESENT", "at_0800": "ABSENT",
                    "became_the_trade": is_bullet,
                    "n_locs_0930": len(late_ids), "n_locs_0800": len(causal_ids),
                })

    print(f"POSITIVE CONTROL: {len(walk) - len(control_failures)} of {len(walk)} sessions returned "
          f"a NON-EMPTY 08:00 location set.")
    if control_failures:
        print(f"  !! CONTROL FAILED and those sessions are EXCLUDED, not counted as clean: "
              f"{control_failures}")

    print(f"\ndecisions strictly inside {WIN_LO}-{WIN_HI}: {n_dec}   of which bullets: {n_bullet}")
    aff_dec = len(rows)
    aff_bul = sum(1 for r in rows if r["became_the_trade"])
    print(f"AFFECTED DECISIONS: {aff_dec} of {n_dec}")
    print(f"AFFECTED BULLETS  : {aff_bul} of {n_bullet}")

    ob_dec = len(by_own_ts)
    ob_bul = sum(1 for r in by_own_ts if r["became_the_trade"])
    print("\n--- PREDICATE B: the PROPERTY the ruling states ---")
    print(f"  chosen location ABSENT from the build at the decision's OWN ts")
    print(f"  NON-CAUSAL DECISIONS: {ob_dec} of {n_dec}")
    print(f"  NON-CAUSAL BULLETS  : {ob_bul} of {n_bullet}")
    for r in sorted(by_own_ts, key=lambda x: x["decision_ts"]):
        print(f"    {r['decision_ts']}  {r['zone_id'][:44]:<44} "
              f"{'TRADE' if r['became_the_trade'] else '-':<6} ({r['n_locs_own_ts']} locs at own ts)")

    if rows:
        print("\nBY KEY")
        print(f"  {'decision ts':<20} {'zone id':<46} {'09:30':<8} {'08:00':<7} trade")
        for r in sorted(rows, key=lambda x: x["decision_ts"]):
            print(f"  {r['decision_ts']:<20} {r['zone_id'][:46]:<46} {r['at_0930']:<8} "
                  f"{r['at_0800']:<7} {'YES' if r['became_the_trade'] else '-'}")

    out = R / f"current_mnq_strategy_v2_4_algo173_anchor_enumeration_{WALK.stem[-12:]}.json"
    out.write_text(json.dumps({
        "window": [WIN_LO, WIN_HI], "sessions": len(walk),
        "control_failures": control_failures,
        "decisions_in_window": n_dec, "bullets_in_window": n_bullet,
        "affected_decisions": aff_dec, "affected_bullets": aff_bul,
        "predicate_b_non_causal_decisions": ob_dec,
        "predicate_b_non_causal_bullets": ob_bul,
        "predicate_b_rows": by_own_ts,
        "rows": rows}, indent=1), encoding="utf-8")
    print(f"\nwritten to {out}")


if __name__ == "__main__":
    main()
