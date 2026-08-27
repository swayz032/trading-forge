#!/usr/bin/env python3
"""ALGO-167 - AUTHORIZED READ-ONLY TRACE (ALGO-165). Does v2.4's 09:30-anchored map hand an
08:00-09:30 decision a zone that DID NOT YET EXIST at that decision?

READ-ONLY. NO v2.4 FILE IS OPENED FOR WRITING AND NOTHING IS EDITED.

SCOPE, and it is narrow on purpose. ALGO-137 already refuted the zone-STATE version of this
question: `zone_state_at_v24` is re-evaluated per bucket at `ts`, so a zone's STATE is not
backdated. THIS ASKS A DIFFERENT OBJECT - zone EXISTENCE. Which zones the 09:30-anchored
`build_zones` admits at all was never traced. Different object, different answer possible.

THE PREDICATE, by key: for every candidate decision whose `signal_time` is strictly inside
08:00-09:30, does the location set available to it contain a zone whose `created` timestamp is
AFTER that `signal_time`?

  (a) THE ZONE ACTUALLY USED  - is the chosen `location_id` created after the decision?
  (b) THE SET AVAILABLE       - does the 09:30 map contain ANY zone created after the decision?
      This is the question as ALGO-165 posed it.

POSITIVE CONTROL IS MANDATORY AND RUNS FIRST. A synthetic zone created one minute after the
decision is injected, and the instrument must flag it. Without that, a zero is evidence about a
blind extractor rather than about the code - the population failure that has been this campaign's
most common false green.

INSTRUMENT LIMIT, STATED: this reads the PINNED map capture
(`current_mnq_strategy_v2_4_algo137_map_RELAND.json`, whose own `map_anchor` field records
"09:30 session open, mirroring candidate_xray.py and kernel.py") and the pinned candidate walk.
It is evidence about THAT CAPTURE. It does not re-run the kernel, so it cannot see a filter
applied live between the map build and the decision that the capture does not record.
"""
from __future__ import annotations

import io
import json
from pathlib import Path

import pandas as pd

R = Path("research")
MAP = R / "current_mnq_strategy_v2_4_algo137_map_RELAND.json"
WALK = R / "current_mnq_strategy_v2_4_algo141_what_drops_his_setup.json"
WIN_LO, WIN_HI = "08:00", "09:30"


def _created(zone_row) -> pd.Timestamp:
    return pd.Timestamp(zone_row["created"])


def _decisions(walk):
    """Every walked candidate with a signal_time strictly inside 08:00-09:30."""
    out = []
    for session, blob in walk["per_session"].items():
        for row in blob.get("rows", []):
            st = row.get("signal_time") or row.get("confirmed_time") or row.get("entry_time")
            if not st:
                continue
            ts = pd.Timestamp(st)
            if pd.Timestamp(f"{session} {WIN_LO}", tz=ts.tz) <= ts < \
               pd.Timestamp(f"{session} {WIN_HI}", tz=ts.tz):
                out.append((session, ts, row))
    return out


def _scan(decisions, per_session, label):
    used_after, set_after, rows = 0, 0, []
    for session, ts, row in decisions:
        zones = per_session.get(session, {}).get("rows", [])
        later = [z for z in zones if _created(z) > ts]
        chosen = next((z for z in zones if z.get("id") == row.get("location_id")), None)
        chosen_after = bool(chosen and _created(chosen) > ts)
        used_after += chosen_after
        set_after += bool(later)
        rows.append((session, ts, row.get("location_id"), chosen_after, len(later),
                     max((_created(z) for z in later), default=None)))
    print(f"\n--- {label} ---")
    print(f"decisions strictly inside {WIN_LO}-{WIN_HI}: {len(decisions)}")
    print(f"  (a) decisions whose CHOSEN zone was created AFTER the decision : {used_after}")
    print(f"  (b) decisions whose AVAILABLE SET contained a later-created zone: {set_after}")
    return rows, used_after, set_after


def main() -> None:
    per_session = json.load(io.open(MAP, encoding="utf-8"))["per_session"]
    walk = json.load(io.open(WALK, encoding="utf-8"))
    decisions = _decisions(walk)
    if not decisions:
        print("NO DECISIONS IN WINDOW - the trace is vacuous, do not read a zero from it.")
        return

    # ---- POSITIVE CONTROL FIRST ----
    salted = {s: {"rows": list(b.get("rows", []))} for s, b in per_session.items()}
    s0, ts0, _ = decisions[0]
    salted.setdefault(s0, {"rows": []})["rows"].append(
        {"id": "SYNTHETIC_CONTROL", "created": str(ts0 + pd.Timedelta(minutes=1)),
         "lo": 0.0, "hi": 0.0})
    _, _, ctrl_set = _scan(decisions, salted, "POSITIVE CONTROL (a planted later-created zone)")
    if ctrl_set < 1:
        print("\nCONTROL FAILED - the instrument cannot see a planted later-created zone.")
        print("A zero from the real scan below would be meaningless. STOPPING.")
        return
    print("  CONTROL PASSED: the instrument sees a planted later-created zone.")

    # ---- THE REAL SCAN ----
    rows, used_after, set_after = _scan(decisions, per_session, "REAL SCAN (pinned capture)")

    print("\nBY KEY - decision ts | chosen location | chosen created after? | later-created in set")
    for session, ts, loc, chosen_after, n_later, latest in sorted(rows):
        print(f"  {str(ts)[:19]}  {str(loc)[:44]:44s}  {'YES' if chosen_after else 'no':3s}"
              f"  {n_later:3d}" + (f"  latest {str(latest)[:19]}" if latest is not None else ""))

    print("\nVERDICT")
    if used_after == 0 and set_after == 0:
        print("  NEGATIVE on both (a) and (b) in this capture. The 09:30 anchor did not hand any")
        print("  in-window decision a zone that post-dates it. Reported with the instrument limit")
        print("  in the docstring: this is evidence about the CAPTURE, not a kernel re-run.")
    else:
        print(f"  POSITIVE: (a)={used_after}  (b)={set_after}. Zones post-dating a decision were")
        print("  available to it. This bears on the census and the refusals - see ALGO-165.")


if __name__ == "__main__":
    main()
