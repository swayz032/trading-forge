#!/usr/bin/env python3
"""WHY WAS HIS LEVEL NOT IN THE MAP? L1-L4, pre-registered by ALGO-063. DIAGNOSTIC ONLY.

The §3 diagnosis resolved two of the four lost sessions to LOCATION_NOT_IN_MAP: the machine was
deciding at his clock, on his side, with dozens of authorized candidates — and none of its
locations covered the level he traded. ALGO-063 pre-registered how that must be resolved, so
the answer cannot be argued after the numbers are seen.

THE MAP IS FROZEN PRE-OPEN. The executable site is ONE line in the v2.4 kernel, not a note in
the v2_1 file:

    kernel.py:180   open_ts = pd.Timestamp(f"{dte} 09:30", tz=core.TZ)
    kernel.py:187   locations, _ = build_entry_locations_v24(env, dte, open_ts, p)

and the builder itself is causal as of that instant:

    levels.py:229   established_zones = core.build_zones(piv15, h15, open_ts, p, look_days=40)
    levels.py:231   a15 = h15[h15.index + pd.Timedelta(minutes=15) <= open_ts].atr...

AND HIS LEVELS ARE MARKED IN-SESSION. The advisor measured it across all five sessions: every
`trader_zone` is a ONE-TICK level, `source_method = VISIBLE_REJECTION`, marked between 09:30
and 09:52 on the 5m or 15m — never pre-open. So the HYPOTHESIS is that a level he marks from a
rejection he watched happen cannot be in a map frozen before it happened. That is a hypothesis
and this module is the test: `build_entry_locations_v24` takes `open_ts` as an ARGUMENT, so the
same map rule can be recomputed causally as of HIS marked_time and compared.

    L1  MAP_FROZEN_PRE_OPEN        not covered at 09:30, COVERED when the same rule is
                                   recomputed as of his marked_time -> the freeze is the cause
    L2  MAP_RULE_EXCLUDES          covered by neither -> the rule excludes his level; name the
                                   rule and the parameter
    L3  COVERED_BUT_UNAUTHORIZED   a zone covers it but `entry_authorized` is False -> name the
                                   gate
    L4  NEAR_MISS                  a band edge within the frozen 17.25-point stop
    L0  UNRESOLVED                 residual, stated rather than forced

04-14 IS THE CONTROL ROW and it is not decoration: the agreeing session's level is the SAME
KIND (one-tick, VISIBLE_REJECTION, marked 09:30 on the 5m), so "his level type" cannot be what
separates it from the four. If its band existed PRE-OPEN and the others' did not, the freeze is
the discriminator; if its band is also only present later, L1 is refuted and the difference
lies elsewhere.

Run: PYTHONPATH=. python -m research.run_location_map_resolution
"""
from __future__ import annotations

import io
import json
import time
from pathlib import Path

import pandas as pd

from research.current_mnq_strategy_v2_4_single_writer import single_writer
from research import current_mnq_strategy_v2_2_engine_final as old
from research import current_mnq_strategy_v2_4_engine as v24
from research import current_mnq_strategy_v2_4_exam_window as W
from research import run_refusal_diagnosis_lost_four as D
from research.current_mnq_strategy_v2_4_levels import build_entry_locations_v24

DIAGNOSTIC_ONLY = (
    "DIAGNOSTIC. Resolves WHY a level is absent from the map. Repairs nothing, selects no rule, "
    "tunes no parameter. ALGO-063 section 3."
)

DATA = Path("research/_mnq_v24_replay_lab_v3/data")
LOCK = Path("research/current_mnq_strategy_v2_2_data_lock.json")
DIAG = Path("research/current_mnq_strategy_v2_4_refusal_diagnosis_lost_four_2026_08_23.json")
OUT = Path("research/current_mnq_strategy_v2_4_location_map_resolution_2026_08_23.json")

#: The AGREE session. Its row is a CONTROL, not a finding.
CONTROL_SESSION = "2026-04-14"

#: The frozen stop. A gap wider than this is a different level, not a near-miss. It is the
#: strategy's own constant, never a threshold chosen here.
FROZEN_STOP_POINTS = 17.25

#: The executable sites, cited rather than described.
MAP_RULE_SITES = {
    "pre_open_anchor": "research/current_mnq_strategy_v2_4_kernel.py:180  "
                       'open_ts = pd.Timestamp(f"{dte} 09:30", tz=core.TZ)',
    "map_built_once_at_that_anchor": "research/current_mnq_strategy_v2_4_kernel.py:187  "
                                     "locations, _ = build_entry_locations_v24(env, dte, "
                                     "open_ts, p)",
    "zones_causal_as_of_the_anchor": "research/current_mnq_strategy_v2_4_levels.py:229  "
                                     "established_zones = core.build_zones(piv15, h15, "
                                     "open_ts, p, look_days=40)",
    "atr_causal_as_of_the_anchor": "research/current_mnq_strategy_v2_4_levels.py:231  "
                                   "a15 = h15[h15.index + 15min <= open_ts].atr.tail(20)"
                                   ".median()",
}

#: MEASURED at the nearest same-side causal pivot to his level, against the frozen key-level
#: spec (current_mnq_strategy_v2_4_key_level_semantics.json, MNQ-V2.4-SR-LOCATION-EQUATION-5).
#: TWO paths lead into the map, so an exclusion must name WHICH one refused:
#:
#:   established_zone_path          minimum_independent_rejections = 2
#:   exceptional_single_swing_path  wick >= min_wick AND disp >= max(1.0, Q75(same-side pivot
#:                                  disp confirmed in [candidate_confirm-40d, candidate_confirm)))
#:
#: The control clears BOTH by a hair - wick by 0.023, displacement by 0.006 ATR - so inclusion
#: of a trader level in this map is decided on sub-1% margins.
MAP_EXCLUSION_MEASURED = {
    "2026-03-24": {
        "nearest_same_side_pivot": 24193.5, "distance_points": 1.38,
        "wick": 0.038, "min_wick": 0.2, "wick_passes": False,
        "disp": 1.798, "single_swing_threshold": 2.189, "disp_passes": False,
        "threshold_basis": "Q75 of 340 same-side reference pivots",
        "operative_parameter": "min_wick",
        "rule": "exceptional_single_swing_path AND established_zone_path both require "
                "wick >= min_wick; this pivot fails it, so neither path can admit his level",
    },
    "2026-03-30": {
        "nearest_same_side_pivot": 23611.0, "distance_points": 1.88,
        "wick": 0.589, "min_wick": 0.2, "wick_passes": True,
        "disp": 1.474, "single_swing_threshold": 2.079, "disp_passes": False,
        "threshold_basis": "Q75 of 367 same-side reference pivots",
        "operative_parameter": "exceptional_single_swing_path displacement threshold "
                               "max(1.0, Q75(same-side disp))",
        "rule": "wick passes, so the single-swing path is reachable, but displacement 1.474 is "
                "below the 2.079 threshold; the established path needs 2 independent "
                "rejections and this pivot is alone in its price cluster",
    },
    "2026-04-14": {
        "nearest_same_side_pivot": 25619.75, "distance_points": 0.88,
        "wick": 0.223, "min_wick": 0.2, "wick_passes": True,
        "disp": 2.100, "single_swing_threshold": 2.094, "disp_passes": True,
        "threshold_basis": "Q75 of 338 same-side reference pivots",
        "operative_parameter": None,
        "rule": "CONTROL: enters via exceptional_single_swing_path, clearing min_wick by 0.023 "
                "and the displacement threshold by 0.006",
    },
}

L1 = "L1_MAP_FROZEN_PRE_OPEN"
L2 = "L2_MAP_RULE_EXCLUDES"
L3 = "L3_COVERED_BUT_UNAUTHORIZED"

#: Covered AND authorized. Not one of ALGO-063's four, because for a LOCATION_NOT_IN_MAP
#: subject it cannot occur - but the CONTROL row is exactly this, and reporting it as
#: "COVERED_BUT_UNAUTHORIZED" told the reader the opposite of what the row said.
L3A = "L3a_COVERED_AND_AUTHORIZED"
L4 = "L4_NEAR_MISS"
L0 = "L0_UNRESOLVED"


def _covers(loc, zone) -> bool:
    return float(loc.lo) <= float(zone["hi"]) and float(loc.hi) >= float(zone["lo"])


def _gap(loc, zone) -> float:
    if _covers(loc, zone):
        return 0.0
    return min(abs(float(loc.lo) - float(zone["hi"])), abs(float(zone["lo"]) - float(loc.hi)))


def _probe(env, dte, anchor: pd.Timestamp, zone, p) -> dict:
    """Build the map with the SAME RULE at a different causal instant, and look for his level."""
    locations, _ = build_entry_locations_v24(env, dte, anchor, p)
    covering = [x for x in locations if _covers(x, zone)]
    nearest = min(locations, key=lambda x: _gap(x, zone)) if locations else None
    return {
        "anchor": anchor.isoformat(),
        "locations_built": len(locations),
        "authorized_built": sum(1 for x in locations if x.entry_authorized),
        "covering_his_level": len(covering),
        "covering_and_authorized": sum(1 for x in covering if x.entry_authorized),
        "covering_bands": [
            {"id": str(x.id), "lo": float(x.lo), "hi": float(x.hi), "side": str(x.side),
             "source": str(x.source), "entry_authorized": bool(x.entry_authorized)}
            for x in covering[:6]],
        "nearest_band": (
            {"lo": float(nearest.lo), "hi": float(nearest.hi),
             "gap_points": round(_gap(nearest, zone), 2),
             "entry_authorized": bool(nearest.entry_authorized)} if nearest is not None
            else None),
    }


def resolve(pre_open: dict, at_marked: dict) -> tuple[str, str]:
    """The PRE-REGISTERED ladder (ALGO-063). Order matters and it was fixed before any result."""
    if pre_open["covering_and_authorized"]:
        return L3A, ("an AUTHORIZED zone covered his level pre-open, so for this row the map is "
                     "NOT the question - any absence at his clock is a later gate")
    if pre_open["covering_his_level"] and not pre_open["covering_and_authorized"]:
        return L3, ("a zone covered his level pre-open but `entry_authorized` is False - the "
                    "authorization gate, not the map, removed it")
    if at_marked["covering_his_level"] and not pre_open["covering_his_level"]:
        return L1, ("the SAME map rule, recomputed causally as of his marked_time, DOES place a "
                    "zone on his level - it is absent at 09:30 only because the map is frozen "
                    "before the rejection he marked had happened")
    near = pre_open.get("nearest_band") or {}
    if near.get("gap_points") is not None and near["gap_points"] <= FROZEN_STOP_POINTS:
        return L4, (f"nearest pre-open band is {near['gap_points']} points away, within the "
                    f"frozen {FROZEN_STOP_POINTS}-point stop - a near miss, not a different "
                    f"level")
    if not at_marked["covering_his_level"]:
        return L2, ("the map rule places no zone on his level at EITHER instant, so the freeze "
                    "is not the cause - the rule itself excludes it")
    return L0, "the ladder does not resolve this session; stated rather than forced"


def main() -> int:
    t0 = time.perf_counter()
    diag = json.load(io.open(DIAG, encoding="utf-8"))
    subjects = [r["session"] for r in diag["as_landed"]
                if r["AT_CLOCK_classification"] == D.LOCATION_NOT_IN_MAP]

    labels = D._raw_labels()
    traders = D._trader_entries()

    observed = old.download_pinned(DATA, include_tick=False)
    old.verify_manifest(observed, json.loads(LOCK.read_text(encoding="utf-8")))

    rows = []
    with W.trading_window(W.BASELINE_ARM_START):
        env = old.prepare(old.load_csv(DATA / Path(old.DATA_FILES["5m"]).name),
                          old.load_csv(DATA / Path(old.DATA_FILES["1m"]).name))
        p = v24.Params()

        for session in subjects + [CONTROL_SESSION]:
            tr, lab = traders.get(session, {}), labels.get(session, {})
            direction = {"ENTER_LONG": "L", "ENTER_SHORT": "S"}.get(tr.get("final_action"))
            zone = D._his_zone(lab, direction) if direction else None
            if not zone:
                rows.append({"session": session, "resolution": L0,
                             "why": "no marked zone for his direction"})
                continue

            dte = pd.Timestamp(session).date()
            marked = pd.Timestamp(zone["marked_time"])
            pre_open = _probe(env, dte, pd.Timestamp(f"{session} 09:30", tz=marked.tz), zone, p)
            at_marked = _probe(env, dte, marked, zone, p)
            res, why = resolve(pre_open, at_marked)
            rule = MAP_EXCLUSION_MEASURED.get(session)

            rows.append({
                "session": session,
                "is_control": session == CONTROL_SESSION,
                "trader_final_action": tr.get("final_action"),
                "his_direction": direction,
                "his_level": {"lo": zone["lo"], "hi": zone["hi"], "role": zone["role"],
                              "source_method": zone.get("source_method"),
                              "marked_time": zone.get("marked_time"),
                              "marked_main_timeframe": zone.get("marked_main_timeframe"),
                              "width_points": round(float(zone["hi"]) - float(zone["lo"]), 2)},
                "map_PRE_OPEN_0930": pre_open,
                "map_RECOMPUTED_AT_HIS_MARKED_TIME": at_marked,
                "resolution": res,
                "why": why,
                "L2_rule_and_parameter": rule,
            })

    control = next((r for r in rows if r.get("is_control")), None)
    findings = [r for r in rows if not r.get("is_control")]
    ladder = {r["session"]: r["resolution"] for r in findings}

    out = {
        "artifact": "LOCATION_MAP_RESOLUTION",
        "status": DIAGNOSTIC_ONLY,
        "authority": "ALGO-063 section 3",
        "produced": "2026-08-23",
        "question": ("for each LOCATION_NOT_IN_MAP session, WHY is his level absent from the "
                     "map - and does the pre-open freeze explain it?"),
        "pre_registered_ladder": {
            L1: "not covered at 09:30, covered when the SAME rule is recomputed at his "
                "marked_time -> the freeze is the cause",
            L2: "covered by neither -> the rule excludes his level",
            L3: "a zone covers it pre-open but is not entry_authorized -> a gate, not the map",
            L4: f"nearest band edge within the frozen {FROZEN_STOP_POINTS}-point stop",
            L0: "residual, stated rather than forced",
        },
        "map_rule_executable_sites": MAP_RULE_SITES,
        "frozen_stop_points": FROZEN_STOP_POINTS,
        "subjects": subjects,
        "resolutions": ladder,
        "control_row_2026_04_14": control,
        "rows": rows,
        "repairs": "NONE. This resolves; ALGO-064 rules the repair.",
        "runtime_seconds": round(time.perf_counter() - t0, 2),
        "no_pnl": ("No PnL, realized outcome, winner/loser label or clean-edge result "
                   "participated in any decision in this diagnostic."),
    }
    OUT.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    for r in rows:
        tag = "CONTROL" if r.get("is_control") else "subject"
        print(f"\n[{tag}] {r['session']}  -> {r['resolution']}")
        if "his_level" in r:
            hl = r["his_level"]
            print(f"    his level      : {hl['lo']}-{hl['hi']} ({hl['role']}, "
                  f"{hl['source_method']}, marked {hl['marked_time']} on "
                  f"{hl['marked_main_timeframe']})")
            print(f"    map @ 09:30    : {r['map_PRE_OPEN_0930']['covering_his_level']} covering"
                  f"  (nearest {r['map_PRE_OPEN_0930']['nearest_band']})")
            print(f"    map @ marked   : "
                  f"{r['map_RECOMPUTED_AT_HIS_MARKED_TIME']['covering_his_level']} covering")
        print(f"    {r['why']}")
    print(f"\nwrote {OUT}")
    return 0


if __name__ == "__main__":
    # ALGO-057 4.1: ONE WRITER PER ARTIFACT, and the lock covers the whole RUN.
    with single_writer(OUT, purpose=__spec__.name if __spec__ else __file__):
        raise SystemExit(main())
