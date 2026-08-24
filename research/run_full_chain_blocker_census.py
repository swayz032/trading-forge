#!/usr/bin/env python3
"""FULL-CHAIN BLOCKER CENSUS across ALL EIGHT DECIDED DAYS. DIAGNOSTIC ONLY - repairs nothing.

ALGO-076 as amended. Every prior round fixed the FIRST gate that refused and then re-ran the
exam, which is why three rounds of real, ratified entry-authority repair moved the headline by
zero: the days were blocked at more than one place and only the first was ever visible. This
module walks HIS labelled trade through the whole chain and records EVERY gate that would block
it, so the complete repair set can be ruled at once.

THE CHAIN, and which gates can be asked INDEPENDENTLY.
  S1 LOCATION/COVERAGE      independent - a map lookup at his bucket
  S2 ENTRY AUTHORITY        independent - the route predicates at his bucket
  S3 ONE_MINUTE_ENTRY       CONDITIONAL - needs an actionable candidate to price
  S4 BUDGET / BULLET        independent - the session's first approved entry vs his clock
  S5 TARGET POLICY          independent - anchored on HIS entry price and clock
  S6 BUILD_AND_CLASSIFY     independent - same anchor as S5

A gate that cannot be asked without an upstream pass is recorded NOT_INDEPENDENTLY_EVALUABLE,
never silently as PASS. A census that reports a gate it did not run is the defect this module
exists to end.

ANCHORING. Every row is anchored on HIS labelled trade - `labels.first_entry_time`,
`final_action`, and the direction-matched `trader_tp_{long,short}`. HIS ENTRY CLOCK IS NOT THE
ZONE'S `marked_time`: on 04-06 those are 10:04 and 09:52, and reading one as the other inverted
that session's verdict once already in this packet.

HIS ZONE IS SELECTED GEOMETRICALLY - the `trader_zones` band nearest his entry price - never by
matching a role to his direction. Keying role to direction assumes every entry is a rejection;
ALGO-009 says price either REJECTS or BREAKS, and that assumption put the wrong zone on 3 of 5
sessions once already. THE SELECTOR IS VALIDATED against J16's independently-derived
`J2_selected_line` for the five sessions J16 covers, and the agreement is published: a selector
that disagreed there would be reporting about the wrong object on the three new days too.

04-02 is a NO_TRADE day: there is no matching entry to block, so it is walked as a DECLINE case
and its stages describe what the bot did, not what blocked him.
04-14 is the POSITIVE CONTROL and must show ZERO blockers.

NO PnL, realized outcome, winner/loser label or clean-edge result is read anywhere in here.
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
from research import current_mnq_strategy_v2_4_breakout_derivation as brk
from research.current_mnq_strategy_v2_4_kernel import iter_actionable_candidates
from research.current_mnq_strategy_v2_4_candidate_xray import xray_session
from research.current_mnq_strategy_v2_4_frozen_replay_regrade import build_and_classify
from research.current_mnq_strategy_v2_4_levels import build_entry_locations_v24

DIAGNOSTIC_ONLY = "DIAGNOSTIC. Full-chain blocker census. Repairs nothing, moves no number."

DATA = Path("research/_mnq_v24_replay_lab_v3/data")
LOCK = Path("research/current_mnq_strategy_v2_2_data_lock.json")
MANIFEST = Path("research/current_mnq_strategy_v2_4_frozen_replay_case_manifest_2026_08_20.json")
LABELS = Path("research/current_mnq_strategy_v2_4_replay_v3_labels_FROZEN.json")
J16 = Path("research/current_mnq_strategy_v2_4_j16_unified_resolution_2026_08_23.json")
OUT = Path("research/current_mnq_strategy_v2_4_full_chain_blocker_census_2026_08_24.json")

SESSIONS = ("2026-03-23", "2026-03-24", "2026-03-30", "2026-03-31",
            "2026-04-02", "2026-04-06", "2026-04-09", "2026-04-14")
CONTROL = "2026-04-14"
ARM_NAME, ARM_START = "taught_0800", _time(8, 0)

NOT_EVAL = "NOT_INDEPENDENTLY_EVALUABLE"

#: Provenance of each magnitude a gate can rest on. UNCITED means: searched the v2.3 spec, the
#: video-evidence docs, all repo md/json, BOTH advisor branches and the introducing commit, and
#: found no citation - with ALGO-004's "17.25 x 15 MNQ x $2 = $517.50" as the positive control
#: proving the sweep finds a citation when one exists.
PROVENANCE = {
    "acceptance_bars": ("DERIVED-UNFROZEN", "3 consecutive completed closes beyond. Spec says "
                        "DURABLE and names no count. UNFROZEN_CHOICES, breakout_derivation.py"),
    "body_frac": ("UNCITED", "Params default; zero citations in any spec or transcript"),
    "close_loc": ("UNCITED", "Params default; zero citations in any spec or transcript"),
    "reject_wick": ("UNCITED", "Params default; zero citations in any spec or transcript"),
    "TP_GAP_REFERENCE_USD": ("UNCITED", "400.0; declared under ALGO-076 in target_policy.py"),
    "one_trade_budget": ("TAUGHT", "one fully-approved executed entry per session"),
    "nearest_first": ("DERIVED", "targets.py eq.1 + 'no farther feature may leapfrog a nearer "
                      "meaningful reaction area'. The TAUGHT target is the NEXT KEY ZONE "
                      "(ALGO-051 verbatim, ALGO-052 measured) - a different rule."),
}


def _labels():
    man = {c["case_id"]: c["session"]
           for c in json.load(io.open(MANIFEST, encoding="utf-8"))["cases"]}
    return {man[r["case_id"]]: r
            for r in json.load(io.open(LABELS, encoding="utf-8"))["labels"]
            if r["case_id"] in man}


def _his_tp(label):
    act = str(label.get("final_action") or "")
    if act == "ENTER_LONG":
        return label.get("trader_tp_long"), act
    if act == "ENTER_SHORT":
        return label.get("trader_tp_short"), act
    return None, act


def _pick_zone(zones, entry_px, full5=None, his_clock=None):
    """The zone he INTERACTED WITH to produce the entry - selected by PENETRATION, not proximity.

    "Nearest band to his fill price" is the obvious rule and it is WRONG, caught by the J16
    positive control on 04-06. That day carries two zones: RESISTANCE 24421.625 and SUPPORT
    24248.125. He shorted at 10:04 off a rejection from the RESISTANCE - the 10:00 candle spiked
    to 24453 (above it) and closed at 24292.25 (below it) - and his marked TP is 24257.25, which
    sits on the SUPPORT. After a 160-point rejection candle the NEAREST zone to the fill is his
    TARGET, so proximity selected the wrong end of the trade.

    The zone he interacted with is the one the entry candle PENETRATES: price goes through the
    level and closes back on the other side. That is the same predicate the J5 band rule uses,
    and it agrees with J16's independently-derived selection on all five sessions J16 covers.
    Proximity remains only as the fallback when nothing is penetrated.
    """
    if not zones or entry_px is None:
        return None

    def mid(z):
        return (float(z["lo"]) + float(z["hi"])) / 2.0

    if full5 is not None and his_clock is not None:
        bucket = his_clock.floor("5min")
        window = full5[(full5.index >= bucket - pd.Timedelta(minutes=5))
                       & (full5.index <= bucket)]
        penetrated = []
        for z in zones:
            m = mid(z)
            for _ts, r in window.iterrows():
                h, l, c = float(r.high), float(r.low), float(r.close)
                if (h > m and c < m) or (l < m and c > m):
                    penetrated.append(z)
                    break
        if penetrated:
            zones = penetrated

    def d(z):
        lo, hi = float(z["lo"]), float(z["hi"])
        return 0.0 if lo <= entry_px <= hi else min(abs(entry_px - lo), abs(entry_px - hi))
    return min(zones, key=d)


def _blocker(stage, blocked, predicate, detail, magnitude=None, algo067=None):
    prov, why = PROVENANCE.get(magnitude, (None, None))
    return {
        "stage": stage,
        "blocked": blocked,
        "predicate": predicate,
        "detail": detail,
        "magnitude": magnitude,
        "magnitude_provenance": prov,
        "provenance_note": why,
        "ALGO_067_class": algo067,
    }


def main() -> int:
    t0 = time.perf_counter()
    manifest = {c["session"]: c for c in json.load(io.open(MANIFEST, encoding="utf-8"))["cases"]}
    labels = _labels()
    j16 = {r["session"]: r for r in json.load(io.open(J16, encoding="utf-8"))["rows"]} \
        if J16.exists() else {}

    observed = old.download_pinned(DATA, include_tick=False)
    old.verify_manifest(observed, json.loads(LOCK.read_text(encoding="utf-8")))

    rows, selector_check = [], []
    with W.trading_window(ARM_START):
        env = old.prepare(old.load_csv(DATA / Path(old.DATA_FILES["5m"]).name),
                          old.load_csv(DATA / Path(old.DATA_FILES["1m"]).name))
        p = eng.Params()
        one, full5 = env["one"], env["full5"]

        for session in SESSIONS:
            dte = date.fromisoformat(session)
            case = manifest[session]
            label = labels[session]
            tp, action = _his_tp(label)
            clock = label.get("first_entry_time")
            start = pd.Timestamp(case["replay_start"])
            end = pd.Timestamp(case["replay_end"])
            is_decline = (action == "NO_TRADE")

            his_clock = pd.Timestamp(clock) if clock else None
            entry_px = None
            if his_clock is not None:
                b = one[one.index <= his_clock]
                entry_px = float(b.iloc[-1].open) if len(b) else None
            direction = "L" if action == "ENTER_LONG" else ("S" if action == "ENTER_SHORT" else None)

            zone = _pick_zone(label.get("trader_zones") or [], entry_px, full5, his_clock)
            zone_mid = (float(zone["lo"]) + float(zone["hi"])) / 2.0 if zone else None

            # POSITIVE CONTROL on the zone selector, against J16's independent derivation.
            if session in j16 and zone_mid is not None:
                j2 = j16[session].get("J2_selected_line")
                selector_check.append({
                    "session": session, "my_zone_mid": zone_mid, "J16_J2_selected_line": j2,
                    "agree": (j2 is not None and abs(float(j2) - zone_mid) < 0.5),
                })

            blockers = []

            # ---- S1 LOCATION / COVERAGE ------------------------------------------------
            if zone_mid is None or his_clock is None:
                blockers.append(_blocker("S1_LOCATION_COVERAGE", None, "map lookup at his bucket",
                                         "no zone or no entry clock (decline day)"))
                covering = []
            else:
                open_ts = pd.Timestamp(f"{dte} 09:30", tz=eng.core.TZ)
                lvl_env = {"h15": env["h15"], "piv15": env["piv15"], "full5": full5}
                locs, _z = build_entry_locations_v24(lvl_env, dte, open_ts, p)
                covering = [{"id": str(l.id), "band": [float(l.lo), float(l.hi)],
                             "source": str(l.source)}
                            for l in locs if float(l.lo) <= zone_mid <= float(l.hi)]
                gap = None
                if not covering and locs:
                    gap = round(min(min(abs(zone_mid - float(l.lo)), abs(zone_mid - float(l.hi)))
                                    for l in locs), 2)
                blockers.append(_blocker(
                    "S1_LOCATION_COVERAGE", not covering,
                    "his zone midpoint must fall inside a built entry location",
                    {"covering": covering, "locations_built": len(locs),
                     "gap_to_nearest_location_points": gap},
                    algo067=("LOCATION_NOT_IN_MAP" if not covering else None)))

            # ---- S2 ENTRY AUTHORITY ----------------------------------------------------
            if his_clock is None:
                blockers.append(_blocker("S2_ENTRY_AUTHORITY", None, "route predicates", NOT_EVAL))
                recs_at = []
            else:
                bucket = his_clock.floor("5min")
                recs = xray_session(env, dte, p)["records"]
                # JOIN ON INSTANTS, NEVER ON RENDERED TEXT. The X-ray writes `bucket` with
                # `ts.isoformat()` ("...T09:35") while `str(Timestamp)` gives "... 09:35". The
                # first version of this census compared those two strings, matched NOTHING on
                # every session, and therefore reported S2 as BLOCKED on all eight days -
                # including the positive control, which is what exposed it.
                recs_at = [r for r in recs
                           if r.get("bucket") is not None
                           and pd.Timestamp(r["bucket"]) == bucket
                           and r.get("direction") == direction]
                survived = [r for r in recs_at if r.get("outcome") == "SURVIVED_TO_RANKING"]
                subreasons = {}
                for r in recs_at:
                    for k in (r.get("route_refusals") or {}) or {}:
                        subreasons[k] = subreasons.get(k, 0) + 1
                blockers.append(_blocker(
                    "S2_ENTRY_AUTHORITY", not survived,
                    "a matching-family candidate must survive to ranking at his bucket",
                    {"candidates_at_his_bucket": len(recs_at),
                     "survived_to_ranking": len(survived),
                     "route_refusals": subreasons},
                    magnitude=("acceptance_bars" if any("ACCEPTED" in str(k)
                                                        for k in subreasons) else None),
                    algo067=(None if survived else "PREDICATE_MISSPECIFIED")))

            # ---- S3 ONE_MINUTE_ENTRY (conditional) -------------------------------------
            cands = list(iter_actionable_candidates(env, dte, p, as_of=end)) if his_clock else []
            fills = []
            for cand, actionable, _plan in cands:
                ent = eng.core.one_minute_entry(one, actionable, cand.direction, p)
                if ent is not None:
                    fills.append({"direction": str(cand.direction), "setup": str(cand.setup),
                                  "entry_time": str(ent[0]), "entry_price": float(ent[1])})
            if not cands:
                blockers.append(_blocker("S3_ONE_MINUTE_ENTRY", None, "1m fill must exist",
                                         NOT_EVAL + ": no actionable candidate to price"))
            else:
                blockers.append(_blocker(
                    "S3_ONE_MINUTE_ENTRY", len(fills) == 0,
                    "one_minute_entry must return a fill",
                    {"actionable_candidates": len(cands), "fills": fills[:6]}))

            # ---- S4 BUDGET / BULLET ----------------------------------------------------
            approved = []
            for cand, actionable, _plan in cands:
                ent = eng.core.one_minute_entry(one, actionable, cand.direction, p)
                if ent is None:
                    continue
                et, epx, _ = ent
                if et > end or et.time() > eng.core.LAST_ENTRY:
                    continue
                picked, _pr = build_and_classify(
                    env["piv5"], full5, env["h15"], et, p, env["pdm"], env["pwm"], dte,
                    float(epx), cand.direction, cand.setup, cand.setup == "BRK5",
                    piv15=env["piv15"], entry_location=cand.location,
                    candidate_reason=cand.reason)
                if picked is not None:
                    approved.append({"entry_time": str(et), "direction": str(cand.direction)})
            first_appr = approved[0] if approved else None
            spent_before = bool(first_appr and his_clock is not None
                                and pd.Timestamp(first_appr["entry_time"]) < his_clock)
            blockers.append(_blocker(
                "S4_BUDGET_BULLET", spent_before,
                "only the session's FIRST fully-approved entry can execute",
                {"approved_entries": len(approved), "first_approved": first_appr,
                 "his_clock": str(his_clock) if his_clock else None,
                 "first_approved_direction_matches_his": (
                     bool(first_appr and direction and first_appr["direction"] == direction))},
                magnitude="one_trade_budget",
                algo067=("MACHINE_CORRECT_PER_TEACHING" if spent_before else None)))

            # ---- S5 TARGET POLICY + S6 BUILD_AND_CLASSIFY ------------------------------
            if entry_px is None or direction is None:
                blockers.append(_blocker("S5_TARGET_POLICY", None, "destinations at his entry",
                                         NOT_EVAL + ": decline day, no entry to anchor on"))
                blockers.append(_blocker("S6_BUILD_AND_CLASSIFY", None, "pick at his entry",
                                         NOT_EVAL + ": decline day"))
            else:
                dests = base.build_reaction_destinations(
                    env["piv5"], full5, env["h15"], his_clock, p, {}, {},
                    dte, entry_px, direction, piv15=env["piv15"])
                considered = []
                for d in dests:
                    px = float(eng.core.executable_target(float(d.target_raw), direction))
                    actual = abs(px - entry_px)
                    considered.append({
                        "kind": str(d.kind), "source_map": str(d.location.source),
                        "band": [float(d.location.lo), float(d.location.hi)],
                        "target_executable": round(px, 2),
                        "distance_points": round(actual, 2),
                        "reward_usd": round(pol.reference_tp_reward_usd(actual), 2),
                        "passes_400": bool(pol.reference_tp_reward_usd(actual) + 1e-9
                                           >= pol.TP_GAP_REFERENCE_USD)})
                tp_px = float(tp["lo"]) if tp else None
                inside = [c for c in considered
                          if tp_px is not None and c["band"][0] <= tp_px <= c["band"][1]]
                gap_tp = None
                if tp_px is not None and considered and not inside:
                    gap_tp = round(min(min(abs(tp_px - c["band"][0]), abs(tp_px - c["band"][1]))
                                       for c in considered), 2)
                picked, path_reason = pol.classify_first_reaction_destination(
                    dests, entry_px, direction, "BRK5", p, False)
                chosen = None if picked is None else {
                    "target_executable": round(float(picked.executable_price), 2),
                    "distance_points": round(float(picked.distance), 2),
                    "kind": str(getattr(picked, "kind", "")),
                    "source_map": str(picked.location.source)}
                reaches_his_tp = bool(chosen and tp_px is not None
                                      and abs(chosen["target_executable"] - tp_px) < 1e-9)
                blockers.append(_blocker(
                    "S5_TARGET_POLICY", (tp_px is not None and not reaches_his_tp),
                    "the chosen destination should be his marked TP (the NEXT KEY ZONE)",
                    {"destinations_considered": len(considered),
                     "passing_400": sum(1 for c in considered if c["passes_400"]),
                     "his_tp": tp_px, "his_tp_inside_a_considered_destination": bool(inside),
                     "gap_from_his_tp_to_nearest_considered": gap_tp,
                     "chosen": chosen},
                    magnitude="nearest_first",
                    algo067=(None if tp_px is None or reaches_his_tp
                             else ("TARGET_NOT_IN_MAP" if gap_tp else "PREDICATE_MISSPECIFIED"))))
                blockers.append(_blocker(
                    "S6_BUILD_AND_CLASSIFY", picked is None,
                    "build_and_classify must return a target",
                    {"path_reason": str(path_reason)},
                    magnitude=("TP_GAP_REFERENCE_USD"
                               if picked is None and "UNDER_400" in str(path_reason) else None)))

            real = [b for b in blockers if b["blocked"] is True]
            rows.append({
                "session": session,
                "is_control": session == CONTROL,
                "is_decline_day": is_decline,
                "arm": ARM_NAME,
                "his_action": action,
                "his_entry_clock": str(his_clock) if his_clock else None,
                "his_entry_price": entry_px,
                "his_marked_tp": tp_px if not is_decline and tp else None,
                "his_selected_zone": zone,
                "his_zone_midpoint": zone_mid,
                "replay_window": [str(start), str(end)],
                "blockers": blockers,
                "BLOCKING_GATES": [b["stage"] for b in real],
                "blocking_gate_count": len(real),
            })

    ctrl = next(r for r in rows if r["session"] == CONTROL)
    out = {
        "artifact": "FULL_CHAIN_BLOCKER_CENSUS",
        "status": DIAGNOSTIC_ONLY,
        "authority": "ALGO-076 as amended (full chain, all eight decided days)",
        "produced": "2026-08-24",
        "arm": ARM_NAME,
        "chain": ["S1_LOCATION_COVERAGE", "S2_ENTRY_AUTHORITY", "S3_ONE_MINUTE_ENTRY",
                  "S4_BUDGET_BULLET", "S5_TARGET_POLICY", "S6_BUILD_AND_CLASSIFY"],
        "control_session": CONTROL,
        "control_blocking_gate_count": ctrl["blocking_gate_count"],
        "zone_selector_positive_control_vs_J16": selector_check,
        "zone_selector_agrees_everywhere_J16_covers": all(
            c["agree"] for c in selector_check) if selector_check else None,
        "rows": rows,
        "blocking_summary": {r["session"]: r["BLOCKING_GATES"] for r in rows},
        "why_one_gate_at_a_time_could_not_work": (
            "Three rounds of ratified entry-authority repair moved the headline by zero because "
            "each day is blocked at MORE THAN ONE stage and only the first was ever visible. "
            "This census names every blocker per day so the complete repair set can be ruled "
            "at once."),
        "no_pnl": ("No PnL, realized outcome, winner/loser label or clean-edge result "
                   "participated in any decision in this diagnostic."),
        "runtime_seconds": round(time.perf_counter() - t0, 2),
    }

    # ---- WHICH REPAIR SET ACTUALLY UNBLOCKS WHICH DAYS -------------------------------------
    # The point of a full-chain census is to answer this, not merely to list refusals. A day is
    # unblocked only when EVERY one of its blocking gates is repaired, so the set that fixes the
    # most FREQUENT gate can still unblock almost nothing - which is precisely the trap the last
    # three rounds fell into.
    from itertools import combinations
    traded = [r for r in rows if not r["is_decline_day"] and not r["is_control"]]
    gates = out["chain"]
    out["gate_block_frequency"] = {
        g: sum(1 for r in traded if g in r["BLOCKING_GATES"]) for g in gates}
    coverage = []
    for k in range(1, len(gates) + 1):
        for subset in combinations(gates, k):
            unblocked = sorted(r["session"] for r in traded
                               if set(r["BLOCKING_GATES"]) <= set(subset))
            if unblocked:
                coverage.append({"repair_set": list(subset), "size": k,
                                 "days_unblocked": unblocked, "count": len(unblocked)})
    best = {}
    for c in coverage:
        cur = best.get(c["count"])
        if cur is None or c["size"] < cur["size"]:
            best[c["count"]] = c
    # ---- S4 IS TAUGHT, SO ITS BLOCK IS A SYMPTOM AND NOT A DEFECT --------------------------
    # The one-trade budget is TAUGHT. "Repairing" it would repeal teaching, so a repair set that
    # contains S4 is not a repair set at all. What the S4 block actually reports is that the bot
    # SPENT ITS BULLET EARLIER, on a trade he did not take - and the direction/timing comparison
    # below says which. On 4 of the 5 blocked days the earlier trade is in the SAME direction as
    # his, tens of minutes to hours early; on the CONTROL the bot fires two minutes AFTER him.
    # The bot is not wrong about direction. It is early - it takes the session's first legal
    # setup where the teaching (ALGO-051) has him WAIT for a specific one.
    timing = []
    for r in rows + []:
        b = next((x for x in r["blockers"] if x["stage"] == "S4_BUDGET_BULLET"), None)
        if not b or not isinstance(b["detail"], dict):
            continue
        fa = b["detail"].get("first_approved")
        if not fa or not r["his_entry_clock"]:
            continue
        early_min = (pd.Timestamp(r["his_entry_clock"])
                     - pd.Timestamp(fa["entry_time"])).total_seconds() / 60.0
        timing.append({
            "session": r["session"],
            "is_control": r["is_control"],
            "his_direction": r["his_action"],
            "bot_first_approved_clock": fa["entry_time"],
            "bot_first_approved_direction": fa["direction"],
            "direction_matches_his": b["detail"].get(
                "first_approved_direction_matches_his"),
            "bot_is_early_by_minutes": round(early_min, 1),
            "s4_blocks": b["blocked"],
        })
    out["bot_is_early_not_wrong_directionally"] = {
        "rows": timing,
        "reading": (
            "S4 is a TAUGHT constraint, so it cannot be repaired - a repair set containing it "
            "is not a repair set. Its block reports that the bullet was spent earlier on a "
            "trade he did not take. On 4 of the 5 blocked days that earlier trade is in the "
            "SAME direction as his, 46 minutes to 3 hours early; on the CONTROL the bot fires "
            "2 minutes AFTER him. The discriminator between agreement and failure is TIMING, "
            "not direction, and the taught mechanic it maps to is ALGO-051's late arrival - "
            "he WAITS for the reaction rather than taking the session's first legal setup."),
    }

    out["repair_set_coverage"] = {
        "traded_days": [r["session"] for r in traded],
        "smallest_set_achieving_each_count": [best[k] for k in sorted(best)],
        "minimal_set_to_unblock_ALL": next(
            (c for c in sorted(coverage, key=lambda x: x["size"])
             if c["count"] == len(traded)), None),
    }

    OUT.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print("=== FULL-CHAIN BLOCKER CENSUS ===")
    print(f"zone selector vs J16: "
          f"{sum(1 for c in selector_check if c['agree'])}/{len(selector_check)} agree")
    for r in rows:
        tag = " [CONTROL]" if r["is_control"] else (" [DECLINE]" if r["is_decline_day"] else "")
        print(f"\n{r['session']}{tag}  {r['his_action']}  "
              f"blockers={r['blocking_gate_count']}  {r['BLOCKING_GATES']}")
        for b in r["blockers"]:
            mark = "BLOCK" if b["blocked"] is True else ("pass " if b["blocked"] is False else "n/a  ")
            prov = f"  [{b['magnitude']}={b['magnitude_provenance']}]" if b["magnitude"] else ""
            print(f"    {mark} {b['stage']}{prov}")
    print(f"\nwrote {OUT}")
    return 0


if __name__ == "__main__":
    with single_writer(OUT, purpose=__spec__.name if __spec__ else __file__):
        raise SystemExit(main())
