#!/usr/bin/env python3
"""ALGO-173b - WHICH MECHANISM, per affected decision. The count is not the finding.

ALGO-173 found 5 of 19 in-window decisions chose a location PRESENT in the 09:30 set and ABSENT
from the causal 08:00 set. That count is measured at the LOCATION surface, which is the right
surface - a decision consumes locations - but it is a COMPOSITE. `build_entry_locations_v24` runs
build_zones -> zone_state_at_v24 -> enrich_confluence -> valid_location -> swing builder ->
_range_room_authorization, and an absence can be created at ANY of those.

Reporting "5 lookahead bullets" without this split would be a GATE LABEL PRESENTED AS A SUB-REASON,
which is a law this campaign already minted against itself.

TWO BUILDERS, because established and exceptional zones do not come from the same place and a
single join key CANNOT see both:
  * established -> `core.build_zones`
  * exceptional -> `levels.exceptional_single_swing_zones`   (id prefix `SWING:`)
My first decomposition joined only on build_zones and reported the two SWING rows as an
"id-shape mismatch". That was MY JOIN KEY, not a mystery in the data - see [[commit-subject-unsearchable]]
for the same error on a different surface.

MECHANISMS DISTINGUISHED:
  HARD          the zone is NOT CONSTRUCTED by its own builder at 08:00. The decision used a level
                that does not exist in the causal map.
  AUTHORIZATION the zone IS constructed at 08:00 but does not survive to the location list until
                later bars. The level exists; its authorization depended on post-decision data.
Both are non-causal for the decision. They are not the same defect and must not share a number.

POSITIVE CONTROL PER CALL: each builder must return a NON-EMPTY set at 08:00, or its "absent" is a
statement about an empty call.

READ-ONLY. No v2.4 file written, nothing monkeypatched, no repair proposed.
"""
from __future__ import annotations

import io
import json
from pathlib import Path

import numpy as np
import pandas as pd

from research import current_mnq_strategy_v2_2_engine_final as old
from research import current_mnq_strategy_v2_3_engine as prod
from research import current_mnq_strategy_v2_4_levels as L

core = prod.core
R = Path("research")
DATA = R / "_mnq_v24_replay_lab_v3/data"
ENUM = R / "current_mnq_strategy_v2_4_algo173_anchor_enumeration.json"


def _sets(env, p, day, anchor):
    """Both builders at one anchor, plus their sizes for the per-call control."""
    ts = pd.Timestamp(f"{day} {anchor}", tz=core.TZ)
    h15, piv15, full5 = env["h15"], env["piv15"], env["full5"]
    ez = core.build_zones(piv15, h15, ts, p, look_days=40)
    est_ids = {str(getattr(z, "id", None)) for z in ez}
    ez = [L.zone_state_at_v24(z, full5, ts, p) for z in ez]
    a15 = h15[h15.index + pd.Timedelta(minutes=15) <= ts].atr.tail(20).median()
    atr15 = float(a15) if np.isfinite(a15) else 20.0
    fv = L.active_15m_fvgs(h15, ts)
    ez = core.enrich_confluence(ez, [], fv, atr15, p)
    est = [loc for loc in core.zone_locations(ez) if core.valid_location(loc.zone, p)]
    sw = L.exceptional_single_swing_zones(piv15, h15, full5, ts, p,
                                          established=est, refs=[], native_fvgs=fv)
    return est_ids, {str(x.id) for x in sw}


def main() -> None:
    env = old.prepare(old.load_csv(DATA / Path(old.DATA_FILES["5m"]).name),
                      old.load_csv(DATA / Path(old.DATA_FILES["1m"]).name))
    p = prod.Params()
    rows = json.load(io.open(ENUM, encoding="utf-8"))["rows"]

    print(f"{'decision':<22} {'zone id':<44} {'MECHANISM':<14} control")
    tally = {}
    for r in rows:
        day, zid = r["session"], r["zone_id"]
        est0, sw0 = _sets(env, p, day, "08:00")
        est9, sw9 = _sets(env, p, day, "09:30")
        is_swing = zid.startswith("SWING:")
        at0, at9 = (sw0, sw9) if is_swing else (est0, est9)
        key = zid if is_swing else (zid.split(":", 1)[1] if zid.startswith("FVG15:") else zid)
        n0 = len(at0)
        if n0 == 0:
            mech, ctrl = "CONTROL FAIL", "builder EMPTY at 08:00 - absence is vacuous"
        elif key in at9 and key not in at0:
            mech, ctrl = "HARD", f"{n0} zones at 08:00 - absence is real"
        elif key in at9 and key in at0:
            mech, ctrl = "AUTHORIZATION", f"{n0} zones at 08:00 - exists, filtered later"
        else:
            mech, ctrl = "UNJOINED", f"{n0} zones at 08:00 - key not found at either anchor"
        tally[mech] = tally.get(mech, 0) + 1
        print(f"{day} {r['decision_ts'][11:16]:<10} {zid[:44]:<44} {mech:<14} {ctrl}")

    print(f"\nMECHANISM TALLY: {tally}")
    print("HARD          = the level does not exist in the causal map.")
    print("AUTHORIZATION = the level exists at 08:00 but is not an authorized location until later")
    print("                bars. Both are non-causal for the decision; they are different defects.")


if __name__ == "__main__":
    main()
