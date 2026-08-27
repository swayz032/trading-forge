#!/usr/bin/env python3
"""ALGO-176 - PREDICATE C, the ALGO-175 acceptance, WITH the positive control that gates it.

PREDICATE C, as ruled: for every in-window decision, `max(constituent pivot .confirm) <= decision ts`.

C READS A REAL FIELD, NOT A RECONSTRUCTION. Verified at source:
  v2_2_engine.py:517  created = max(r.confirm for r in independent)      # established zones
  v2_4_levels.py:206  created = row.confirm                              # exceptional swing zones
and both families embed that same stamp in the zone id
(`{side}:{created.isoformat()}:{tick}` / `SWING:{side}:{created.isoformat()}:{tick}`).
So `zone.created` IS the quantity C asks for. Different layer from the location builder, which is
what makes C non-tautological: it never calls `build_entry_locations_v24`.

THE POSITIVE CONTROL IS NOT OPTIONAL AND THE VERDICT DOES NOT EXIST WITHOUT IT.
C is an ABSENCE claim. Run it against the PRE-REPAIR walk, which contains four known HARD defects,
and it must re-find them. If it cannot, a zero on the post-repair walk means nothing at all.

This script reports BOTH arms and lets the control decide whether the verdict is admissible. It
does NOT declare a pass on its own.
"""
from __future__ import annotations

import io
import json
import re
import sys
from pathlib import Path

import pandas as pd

R = Path("research")
PRE = R / "current_mnq_strategy_v2_4_algo141_what_drops_his_setup.json"
POST = R / "current_mnq_strategy_v2_4_algo175_postrepair_walk.json"
WIN_LO, WIN_HI = "08:00", "09:30"

#: The four HARD rows ALGO-173 established, by (session, decision clock). The control must re-find
#: exactly these; anything less and C under-detects the defect it is meant to certify gone.
KNOWN_HARD = {("2026-03-30", "08:05"), ("2026-04-02", "08:05"),
              ("2026-04-06", "08:25"), ("2026-04-14", "09:15")}

_ISO = re.compile(r"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2})")


def _created_of(zone_id: str):
    """The zone's own `created` stamp, embedded in its identifier by both builders."""
    m = _ISO.search(zone_id or "")
    return pd.Timestamp(m.group(1)) if m else None


def _scan(path: Path, label: str):
    if not path.exists():
        print(f"\n{label}: MISSING ({path}) - cannot scan")
        return None
    walk = json.load(io.open(path, encoding="utf-8"))["per_session"]
    viol, n_dec, n_bul, unparsed = [], 0, 0, 0
    for day in sorted(walk):
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
            n_bul += is_bullet
            created = _created_of(str(r.get("location_id")))
            if created is None:
                unparsed += 1
                continue
            if created > ts:
                viol.append({"session": day, "clock": str(ts)[11:16],
                             "zone_id": str(r.get("location_id")),
                             "created": str(created)[:19], "decision_ts": str(ts)[:19],
                             "became_the_trade": is_bullet})
    print(f"\n=== {label} ===")
    print(f"  in-window decisions {n_dec}   bullets {n_bul}   unparsable zone ids {unparsed}")
    print(f"  PREDICATE C VIOLATIONS: {len(viol)} decisions, "
          f"{sum(1 for v in viol if v['became_the_trade'])} bullets")
    for v in sorted(viol, key=lambda x: x["decision_ts"]):
        print(f"    {v['decision_ts']}  created {v['created']}  "
              f"{'TRADE' if v['became_the_trade'] else '-':<6} {v['zone_id'][:44]}")
    return {"n_dec": n_dec, "n_bul": n_bul, "viol": viol, "unparsed": unparsed}


def main() -> None:
    pre = _scan(PRE, "POSITIVE CONTROL - PRE-REPAIR walk (4 known HARD defects)")
    if pre is None:
        sys.exit("control arm missing")

    found = {(v["session"], v["clock"]) for v in pre["viol"]}
    missed = KNOWN_HARD - found
    extra = found - KNOWN_HARD

    print("\n--- CONTROL VERDICT ---")
    print(f"  known HARD defects        : {len(KNOWN_HARD)}")
    print(f"  re-found by predicate C   : {len(KNOWN_HARD & found)}")
    if missed:
        print(f"  !! MISSED BY C            : {sorted(missed)}")
    if extra:
        print(f"  additional C violations   : {sorted(extra)}")

    control_ok = not missed
    print(f"  CONTROL {'PASSED' if control_ok else 'FAILED'}")
    if not control_ok:
        print("  C UNDER-DETECTS. It cannot re-find every known defect, so a zero on the")
        print("  post-repair arm would certify nothing. THE VERDICT IS INADMISSIBLE ON C ALONE.")
        print("  Reason C misses them: a zone whose constituent pivot confirmed EARLY can still be")
        print("  unproducible at the decision, because whether it QUALIFIES depends on inputs")
        print("  computed to the anchor. C tests the pivot's clock, not the zone's derivability.")

    post = _scan(POST, "POST-REPAIR walk")
    print("\n--- ACCEPTANCE ---")
    if post is None:
        print("  post-repair walk missing; nothing to accept.")
        return
    nb = sum(1 for v in post["viol"] if v["became_the_trade"])
    print(f"  PREDICATE C on the repaired kernel: {len(post['viol'])} decisions, {nb} bullets")
    if control_ok:
        print(f"  VERDICT: {'PASS' if nb == 0 else 'FAIL'} (C is admissible - control re-found all "
              f"{len(KNOWN_HARD)} known defects)")
    else:
        print(f"  NO VERDICT. C returned {nb} violating bullets, but its control FAILED, so the")
        print("  number is reported and NOT interpreted as a pass.")


if __name__ == "__main__":
    main()
