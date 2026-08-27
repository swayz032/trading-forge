#!/usr/bin/env python3
"""TARGET-LAYER T/P/G for 03-30, 03-24, 03-31 with 04-14 as CONTROL. DIAGNOSTIC ONLY.

ALGO-076 order (1). Re-exam #2 showed not one of the four lost members is an entry-authority
failure, so the question moves down a layer: at HIS entry, what did the target policy CONSIDER,
which destination did it CHOOSE and why at the executable line, and how does that compare with
the TP he actually marked?

WHAT IS MEASURED, PER SESSION
  T  the taught rule the policy is applying, cited to its own text
  P  every ReactionDestination the policy considered - kind, source map, band, first-contact
     distance, target price, meaningfulness, quality, and the reference reward in USD - then
     the one it chose, or the refusal literal at the line that refused
  G  his marked TP from the FROZEN labels (direction-matched), its distance from his entry, and
     whether that price falls inside ANY location in the machine's 15m key-zone map at that
     instant, or inside any 5m cluster

THE RELAYED PREMISE WAS VERIFIED BEFORE THIS MODULE WAS WRITTEN. ALGO-076 relayed three marked
TPs (03-30 short 23355.25, 03-31 long 23540.75, 03-24 long 24641.5). All three match
`labels.trader_tp_{short,long}` in the frozen pack exactly, and each one's `planned_direction`
matches that session's `final_action`. The join key is `case_id` -> manifest `session`; the
labels carry no session field of their own.

TWO FACTS THE ORDER DID NOT CARRY, BOTH PUBLISHED HERE RATHER THAN ABSORBED:
  - 04-14, the CONTROL, has `trader_tp_long: None` with status
    NO_VISIBLE_MEANINGFUL_REACTION_IN_PRESENTED_CONTEXT. He entered LONG and marked no long TP.
    So the control constrains the "considered/chosen" half of the comparison and is SILENT on
    the "vs his marked TP" half. Saying otherwise would invent a control.
  - On 03-24 every approved bot entry is SHORT while his action is ENTER_LONG. The bullet is
    spent in the OPPOSITE direction to his trade, which is a different failure from picking the
    wrong target in the right direction.

AND ONE STANDING INVARIANT THE REPAIR WILL HAVE TO CONTEND WITH: `targets.py` closes its own
docstring with "No farther feature may leapfrog a nearer meaningful reaction area for prettier
PnL." Nearest-first is not an accident here - it is a deliberate anti-fitting guard. This module
does not touch it; it measures what it does.

NOTHING IS REPAIRED. ALGO-076 holds every target-layer change until ALGO-077.
"""
from __future__ import annotations

import io
import json
import time
from datetime import date, time as _time
from pathlib import Path

import pandas as pd

from research.current_mnq_strategy_v2_4_single_writer import single_writer
from research import current_mnq_strategy_v2_2_engine_final as old
from research import current_mnq_strategy_v2_4_engine as eng
from research import current_mnq_strategy_v2_4_exam_window as W
from research import current_mnq_strategy_v2_4_targets as base
from research import current_mnq_strategy_v2_4_target_policy as pol
from research.current_mnq_strategy_v2_4_levels import build_entry_locations_v24

DIAGNOSTIC_ONLY = "DIAGNOSTIC. Target-layer T/P/G at his entry. Repairs nothing."

DATA = Path("research/_mnq_v24_replay_lab_v3/data")
LOCK = Path("research/current_mnq_strategy_v2_2_data_lock.json")
MANIFEST = Path("research/current_mnq_strategy_v2_4_frozen_replay_case_manifest_2026_08_20.json")
LABELS = Path("research/current_mnq_strategy_v2_4_replay_v3_labels_FROZEN.json")
OUT = Path("research/current_mnq_strategy_v2_4_tpg_target_layer_2026_08_23.json")

SESSIONS = ("2026-03-24", "2026-03-30", "2026-03-31", "2026-04-14")
CONTROL = "2026-04-14"

#: The 08:00 arm: it is the only one in which all three subject sessions have a candidate that
#: REACHES the target layer at all (ALGO-075 §3). The arm is named in the artifact.
ARM_NAME, ARM_START = "taught_0800", _time(8, 0)

#: WHAT HE TEACHES, cited - not what the module implements.
TAUGHT_RULE = (
    "ALGO-051, operator verbatim: '...momentum candle breakout and i jumped in and TARGETED THE "
    "NEXT KEY ZONE' - the target re-anchors to the NEXT key zone (22784.25; 32 pts x $30/pt at "
    "the 15-MNQ reference size). ALGO-052 measures the same shape: target 21932.25, 'the UPPER "
    "KEY ZONE BAND', 110 pts x $30 = $3300, 're-anchored at the opposite key zone'. THE TAUGHT "
    "TARGET IS A KEY ZONE BAND.")

#: WHAT THE MACHINE IMPLEMENTS. The two differ in their UNIVERSE, not only in their ordering:
#: the machine's destination set includes LIQUIDITY_CLUSTER and FVG_15M features that are not
#: key zones at all, and then takes the NEAREST of that wider set.
MACHINE_RULE = (
    "targets.py equation 1: 'The first MEANINGFUL reaction area by physical near edge owns the "
    "room/blocker question', closed by 'No farther feature may leapfrog a nearer meaningful "
    "reaction area for prettier PnL.' Its universe is KEY_ZONE_15M + LIQUIDITY_CLUSTER + "
    "FVG_15M + refined 5m clusters. The $400 floor is a LATER layer applied after selection.")

KEY_ZONE_KINDS = ("KEY_ZONE_15M", "KEY_ZONE_15M_REFINED_LIQUIDITY_CLUSTER_5M")


def _labels_by_session():
    lab = json.load(io.open(LABELS, encoding="utf-8"))["labels"]
    man = {c["case_id"]: c["session"]
           for c in json.load(io.open(MANIFEST, encoding="utf-8"))["cases"]}
    return {man[r["case_id"]]: r for r in lab if r["case_id"] in man}


def _his_tp(label):
    """The marked TP in HIS OWN direction. A short TP on a long day is not his target."""
    action = str(label.get("final_action") or "")
    if action == "ENTER_LONG":
        tp, side = label.get("trader_tp_long"), "long"
    elif action == "ENTER_SHORT":
        tp, side = label.get("trader_tp_short"), "short"
    else:
        return None, None, action
    return tp, side, action


def main() -> int:
    t0 = time.perf_counter()
    manifest = {c["session"]: c for c in json.load(io.open(MANIFEST, encoding="utf-8"))["cases"]}
    labels = _labels_by_session()

    observed = old.download_pinned(DATA, include_tick=False)
    old.verify_manifest(observed, json.loads(LOCK.read_text(encoding="utf-8")))

    rows = []
    with W.trading_window(ARM_START):
        env = old.prepare(old.load_csv(DATA / Path(old.DATA_FILES["5m"]).name),
                          old.load_csv(DATA / Path(old.DATA_FILES["1m"]).name))
        p = eng.Params()
        for session in SESSIONS:
            dte = date.fromisoformat(session)
            label = labels[session]
            tp, tp_side, action = _his_tp(label)
            direction = "L" if action == "ENTER_LONG" else "S"
            his_clock = pd.Timestamp(label["first_entry_time"])

            # His fill: the 1m bar OPEN at his own entry clock. Using a close, or a 5m bar,
            # would price him at a different instant than the one the label records.
            one = env["one"]
            bar = one[one.index <= his_clock]
            entry_px = float(bar.iloc[-1].open) if len(bar) else None

            considered = []
            chosen = None
            refusal = None
            in_15m_map = None
            in_5m_cluster = None

            if entry_px is not None:
                dests = base.build_reaction_destinations(
                    env["piv5"], env["full5"], env["h15"], his_clock, p, {}, {},
                    dte, entry_px, direction, piv15=env["piv15"])
                for d in dests:
                    dist = float(d.first_contact_distance)
                    raw = float(d.target_raw)
                    px = float(eng.core.executable_target(raw, direction))
                    actual = abs(px - entry_px)
                    considered.append({
                        "kind": str(d.kind),
                        "source_map": str(d.location.source),
                        "band": [float(d.location.lo), float(d.location.hi)],
                        "first_contact_distance_points": round(dist, 2),
                        "target_raw": round(raw, 2),
                        "target_executable": round(px, 2),
                        "actual_target_distance_points": round(actual, 2),
                        "reference_reward_usd": round(pol.reference_tp_reward_usd(actual), 2),
                        "meaningful": bool(d.meaningful),
                        "quality": round(float(d.quality), 4),
                        "passes_the_400_floor": bool(
                            pol.reference_tp_reward_usd(actual) + 1e-9 >= pol.TP_GAP_REFERENCE_USD),
                    })
                picked, path_reason = pol.classify_first_reaction_destination(
                    dests, entry_px, direction, "BRK5", p, False)
                if picked is None:
                    refusal = str(path_reason)
                else:
                    # `Target.executable_price` - the field, not a guessed `.price`. The first
                    # version used `getattr(picked, "price", None)` and silently published
                    # target_executable: null for every session, which made the chosen-vs-his
                    # distance comparison - the whole point of the row - unmeasurable.
                    chosen = {
                        "target_executable": round(float(picked.executable_price), 2),
                        "distance_points": round(float(picked.distance), 2),
                        "reference_reward_usd": round(
                            pol.reference_tp_reward_usd(float(picked.distance)), 2),
                        "band": [float(picked.location.lo), float(picked.location.hi)],
                        "source_map": str(picked.location.source),
                        "kind": str(getattr(picked, "kind", "")),
                        "path_reason": str(path_reason),
                    }

                # Does HIS marked TP exist as a key level zone in the machine's 15m map now?
                if tp:
                    open_ts = pd.Timestamp(f"{dte} 09:30", tz=eng.core.TZ)
                    lvl_env = {"h15": env["h15"], "piv15": env["piv15"], "full5": env["full5"]}
                    locs, _zones = build_entry_locations_v24(lvl_env, dte, open_ts, p)
                    tp_px = float(tp["lo"])
                    hits = [{"id": str(l.id), "band": [float(l.lo), float(l.hi)],
                             "source": str(l.source)}
                            for l in locs if float(l.lo) <= tp_px <= float(l.hi)]
                    in_15m_map = hits
                    nearest = min(
                        ((min(abs(tp_px - float(l.lo)), abs(tp_px - float(l.hi))), l)
                         for l in locs), default=(None, None))
                    in_5m_cluster = [c for c in considered
                                     if c["band"][0] <= tp_px <= c["band"][1]]

            his_tp_distance = (round(abs(float(tp["lo"]) - entry_px), 2)
                               if (tp and entry_px is not None) else None)

            # THE COVERAGE NUMBER. If his TP is not inside any considered destination, how far
            # is it from the nearest one? A selection repair can never reach a price the map
            # does not contain, so this is what separates a SELECTION defect from a COVERAGE
            # defect - and they need different repairs.
            gap_to_nearest_considered = None
            nearest_considered_band = None
            if tp and considered:
                tp_px = float(tp["lo"])
                best = min(considered, key=lambda c: 0.0 if c["band"][0] <= tp_px <= c["band"][1]
                           else min(abs(tp_px - c["band"][0]), abs(tp_px - c["band"][1])))
                inside = best["band"][0] <= tp_px <= best["band"][1]
                gap_to_nearest_considered = 0.0 if inside else round(
                    min(abs(tp_px - best["band"][0]), abs(tp_px - best["band"][1])), 2)
                nearest_considered_band = best["band"]

            chosen_is_a_key_zone = (
                chosen is not None and str(chosen.get("kind", "")) in KEY_ZONE_KINDS)

            # ALGO-067 taxonomy. TARGET_NOT_IN_MAP is a RESIDUAL member proposed at THIS layer -
            # the analogue of LOCATION_NOT_IN_MAP at the entry layer - and it is flagged as
            # proposed rather than quietly minted, because a taxonomy without a residual forces
            # the classifier to mis-file or stay silent and both hide the finding.
            if tp is None:
                verdict = "NO_MARKED_TP_IN_HIS_DIRECTION"
            elif gap_to_nearest_considered not in (None, 0.0):
                verdict = "TARGET_NOT_IN_MAP"
            elif not chosen_is_a_key_zone:
                verdict = "PREDICATE_MISSPECIFIED"
            elif chosen and abs(chosen["target_executable"] - float(tp["lo"])) > 1e-9:
                verdict = "PREDICATE_MISSPECIFIED"
            else:
                verdict = "MACHINE_CORRECT_PER_TEACHING"
            chosen_distance = (chosen and chosen.get("target_executable") is not None
                               and round(abs(chosen["target_executable"] - entry_px), 2)) or None

            rows.append({
                "session": session,
                "is_control": session == CONTROL,
                "arm": ARM_NAME,
                "his_action": action,
                "his_entry_clock": str(his_clock),
                "his_entry_price_1m_open": entry_px,
                "his_marked_tp": tp,
                "his_marked_tp_side": tp_side,
                "his_marked_tp_status": label.get("trader_tp_status"),
                "his_marked_tp_distance_points": his_tp_distance,
                "T_taught_rule": TAUGHT_RULE,
                "T_machine_rule": MACHINE_RULE,
                "P_destinations_considered": considered,
                "P_destination_count": len(considered),
                "P_chosen": chosen,
                "P_refusal": refusal,
                "P_chosen_distance_points": chosen_distance,
                "G_his_tp_inside_a_15m_key_zone": in_15m_map,
                "G_his_tp_inside_a_considered_destination": in_5m_cluster,
                "how_many_considered_pass_the_400_floor": sum(
                    1 for c in considered if c["passes_the_400_floor"]),
                "G_gap_from_his_tp_to_nearest_considered_points": gap_to_nearest_considered,
                "G_nearest_considered_band": nearest_considered_band,
                "P_chosen_is_a_key_zone": chosen_is_a_key_zone,
                "ALGO_067_verdict": verdict,
            })

    out = {
        "artifact": "TPG_TARGET_LAYER",
        "status": DIAGNOSTIC_ONLY,
        "authority": "ALGO-076 order (1)",
        "produced": "2026-08-23",
        "arm": ARM_NAME,
        "control_session": CONTROL,
        "control_has_no_marked_tp_in_his_direction": True,
        "relayed_tps_verified_against_the_frozen_pack": True,
        "taxonomy_note": (
            "TARGET_NOT_IN_MAP is PROPOSED as a residual member of the ALGO-067 taxonomy at the "
            "target layer - the analogue of LOCATION_NOT_IN_MAP at the entry layer. It is not "
            "minted here; ALGO-077 ratifies or renames it."),
        "the_400_floor_refuses_NOTHING_at_his_entry": (
            "Every destination considered at his own entry clears the floor in all four "
            "sessions (81/81, 10/10, 122/122, 3/3). The 112.50 / 382.50 / 397.50 refusals in "
            "ALGO-075 were measured at the BOT's candidate prices and clocks, which are "
            "different instants. The floor is not what separates him from the machine here."),
        "standing_invariant_any_repair_must_contend_with": (
            "targets.py docstring: 'No farther feature may leapfrog a nearer meaningful reaction "
            "area for prettier PnL.' Nearest-first is a deliberate anti-fitting guard, not an "
            "oversight."),
        "rows": rows,
        "no_pnl": ("No PnL, realized outcome, winner/loser label or clean-edge result "
                   "participated in any decision in this diagnostic."),
        "runtime_seconds": round(time.perf_counter() - t0, 2),
    }
    OUT.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print(f"=== TARGET-LAYER T/P/G  (arm {ARM_NAME}) ===")
    for r in rows:
        tag = "  [CONTROL]" if r["is_control"] else ""
        print(f"\n{r['session']}{tag}  {r['his_action']} @ {r['his_entry_clock'][11:19]} "
              f"px={r['his_entry_price_1m_open']}")
        tp = r["his_marked_tp"]
        print(f"   his marked TP: {tp['lo'] if tp else None}  "
              f"({r['his_marked_tp_status']})  distance={r['his_marked_tp_distance_points']} pts")
        print(f"   destinations considered: {r['P_destination_count']}   "
              f"passing the $400 floor: {r['how_many_considered_pass_the_400_floor']}")
        for c in r["P_destinations_considered"][:6]:
            print(f"      {c['kind']:<18} {c['source_map']:<18} band={c['band']} "
                  f"dist={c['first_contact_distance_points']:>8.2f} "
                  f"tgt={c['target_executable']:>10.2f} "
                  f"reward=${c['reference_reward_usd']:>9.2f} "
                  f"{'PASS400' if c['passes_the_400_floor'] else 'under400'}")
        print(f"   CHOSEN: {r['P_chosen']}")
        print(f"   REFUSAL: {r['P_refusal']}")
        print(f"   his TP inside a 15m key zone: {r['G_his_tp_inside_a_15m_key_zone']}")
        print(f"   his TP inside a considered destination: "
              f"{r['G_his_tp_inside_a_considered_destination']}")
    print(f"\nwrote {OUT}")
    return 0


if __name__ == "__main__":
    with single_writer(OUT, purpose=__spec__.name if __spec__ else __file__):
        raise SystemExit(main())
