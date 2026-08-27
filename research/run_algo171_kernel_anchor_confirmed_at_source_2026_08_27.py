#!/usr/bin/env python3
"""ALGO-171 - the ALGO-168 limitation, CLOSED at the executable line and then measured.

ALGO-168 reported a positive from a PINNED capture and named its own escape route:
"it does NOT re-run the kernel, so it cannot see a filter applied live between the map build and
the decision that the capture does not record. If such a filter exists this is a false positive."

THIS CLOSES THAT ROUTE, and it very nearly closed it the other way.

WHAT I FOUND FIRST, AND IT LOOKED LIKE A REFUTATION OF MY OWN FINDING:
  `core.run_day` (v2_2_engine.py:924-931) sets `open_ts = session.index[0]`, and `r5` is floored at
  `TRADE_START` = 08:00 (`:879`). So THAT engine builds its map at 08:00 and is causal. Its own
  comment celebrates having deleted "a second copy of the 09:30 literal" precisely because a stale
  duplicate made a window amendment a silent no-op.

WHAT ACTUALLY RUNS FOR v2.4, AND IT IS A DIFFERENT FUNCTION:
  `current_mnq_strategy_v2_4_kernel.py:222`  open_ts = pd.Timestamp(f"{dte} 09:30", tz=core.TZ)
  `current_mnq_strategy_v2_4_kernel.py:229`  locations, _ = build_entry_locations_v24(env, dte, open_ts, p)
  while `_bucket_starts(r5, one, dte, as_of)` iterates decisions from 08:00.

  `iter_actionable_candidates` is the function the candidate walk used and the one that produces
  the trades. THE SECOND COPY OF THE 09:30 LITERAL WAS NOT DELETED - IT MOVED. The pinned capture's
  `map_anchor` note ("mirroring candidate_xray.py and kernel.py") was accurate all along.

SO THE TWO ENGINES DISAGREE WITH EACH OTHER ABOUT WHEN THE MAP IS DRAWN, and the one that anchors
late is the one whose decisions start early.

THIS SCRIPT MEASURES THE DELTA DIRECTLY, by calling the production location builder at both
anchors. It is read-only: no v2.4 file is modified and nothing is monkeypatched.

POSITIVE CONTROL: the 08:00 build must still return a non-empty location set. If it returned
nothing, "the zone is absent at 08:00" would be a statement about an empty call, not about the
zone - the population failure this campaign has hit most often.
"""
from __future__ import annotations

import io
import json
from datetime import date
from pathlib import Path

import pandas as pd

from research import current_mnq_strategy_v2_2_engine_final as old
from research import current_mnq_strategy_v2_3_engine as prod
from research import current_mnq_strategy_v2_4_kernel as K

core = prod.core
R = Path("research")
DATA = R / "_mnq_v24_replay_lab_v3/data"

#: The two decisions ALGO-168 flagged, with the zone each chose and its created stamp.
FLAGGED = {
    "2026-03-30": ("08:05", "S:2026-03-30T08:45:00-04:00:93755"),
    "2026-04-02": ("08:05", "SWING:S:2026-04-02T08:45:00-04:00:94666"),
}


def main() -> None:
    env = old.prepare(old.load_csv(DATA / Path(old.DATA_FILES["5m"]).name),
                      old.load_csv(DATA / Path(old.DATA_FILES["1m"]).name))
    p = prod.Params()

    print("KERNEL SOURCE, the line that decides the anchor:")
    src = (R / "current_mnq_strategy_v2_4_kernel.py").read_text(encoding="utf-8").split("\n")
    for i, line in enumerate(src[215:232], start=216):
        if "open_ts" in line and ("09:30" in line or "build_entry_locations" in line):
            print(f"  kernel.py:{i}: {line.strip()}")

    print("\nsession      anchor   locations   flagged zone present?")
    for day, (dec, zid) in FLAGGED.items():
        dte = date.fromisoformat(day)
        row = {}
        for label, anchor in (("09:30 (what the kernel uses)", f"{day} 09:30"),
                              ("08:00 (causal for the decision)", f"{day} 08:00")):
            ts = pd.Timestamp(anchor, tz=core.TZ)
            locs, _ = K.build_entry_locations_v24(env, dte, ts, p)
            auth = [x for x in locs if x.entry_authorized]
            present = any(str(x.id) == zid for x in auth)
            row[label] = (len(auth), present)
            print(f"{day}   {label:32s} {len(auth):4d}      {'YES' if present else 'no'}")
        # ---- POSITIVE CONTROL ----
        n_causal = row["08:00 (causal for the decision)"][0]
        if n_causal == 0:
            print("  !! CONTROL FAILED - the 08:00 build returned NO locations at all, so its")
            print("     'no' above is a statement about an empty call, not about the zone.")
            continue
        print(f"  CONTROL PASSED: the 08:00 build returned {n_causal} authorized locations, so its")
        print("     'no' is evidence about the zone.")
        late, causal = row["09:30 (what the kernel uses)"], row["08:00 (causal for the decision)"]
        if late[1] and not causal[1]:
            print(f"  => CONFIRMED at the decision of {dec}: the zone the trade used EXISTS in the")
            print("     09:30 map the kernel builds and DOES NOT EXIST in the causal 08:00 map.")
        elif late[1] and causal[1]:
            print("  => NOT a lookahead for this zone: present at 08:00 too. ALGO-168 overstated.")
        else:
            print("  => zone absent from the 09:30 build as well - re-examine the identifier.")


if __name__ == "__main__":
    main()
