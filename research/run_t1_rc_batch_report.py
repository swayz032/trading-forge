#!/usr/bin/env python3
"""THE T1-PRIME + R-C BATCH REPORT. HYPOTHETICAL - NOTHING LANDS, NO PRODUCTION FILE TOUCHED.

AMENDED UNDER ALGO-086 AFTER TWO OPERATOR CORRECTIONS. The first version of this module demoted
the $400 floor and admitted 30m HTF bands. Both premises are retracted and both are removed:
  * "i had a rule that said if the tp is under 400$ dont target it cxause the tp zone is too
    close" - THE FLOOR IS HIS. It keeps its refusal power. No demotion.
  * "i never saod nothing obut 30 minturws" / "yes i onyl draw zones on 5 minbute and 15
    mintues" - R-B IS OUT. No 30m or 60m bands anywhere.
The in-flight run of the earlier design was KILLED rather than allowed to finish: its output
would have described a machine built on two retracted premises.

ALGO-085. R-A was rejected as scoped because a target-universe change silently loosened the
ENTRY gate through the uncited $400 floor. The batch settles that coupling by construction: the
floor is DEMOTED to record-only INSIDE the batch, never standalone, and every element lands
together or not at all.

T1-PRIME - the destination universe becomes FRESH KEY LEVEL ZONE bands, his timeframes only:
  R-D  kind restriction - only KEY_ZONE destinations survive; clusters and FVGs leave the TARGET
       universe only. Cited three times: ALGO-050/051/052 all say "targeted the next key zone",
       and ALGO-051 uses "liquidity reaction zone" for where the reaction HAPPENS, never as a
       target.
  R-A  spent filter - a zone price has already traded into, on bars COMPLETING at or before the
       decision clock, is not a destination.
  FLOOR UNCHANGED. It is his rule and keeps its refusal power. The open rollover-vs-skip
       question is NOT answered here and the single-shot behaviour is untouched.

R-C - a bullet may only be spent at a FRESH zone: no completed bar has traded into the zone's
band between the zone's BIRTH (parsed from its deterministic id) and the decision clock. Taught
exceptions are enumerated in the artifact with their taught story cited, never silently exempted.

PRE-REGISTERED BY ALGO-086, stated here before the run:
  (a) 04-14's approved entry SURVIVES with a valid 5m/15m KEY_ZONE target, else the batch fails
      its control
  (b) the five convicted early trades are REFUSED by R-C, with freshness evidence per trade
  (c) 03-30 is NO LONGER expected to gain a TP-containing target. The 5m/15m sweep found no
      source for it - and found the containment METHOD itself vacuous: 5m/15m wick-to-close
      bands tile 100.0% of the day's traded range, so ANY price is "inside a band". Its S5
      block stands as an HONEST LOSS and the batch must not be widened to recover it.
  (d) every net ADDITION passes the ALGO-070 clause walk

NO PnL, realized outcome, winner/loser label or clean-edge result is read anywhere.
"""
from __future__ import annotations

import io
import json
import time
from dataclasses import replace
from datetime import date, time as _time
from pathlib import Path

import pandas as pd

from research.current_mnq_strategy_v2_4_single_writer import single_writer
from research import current_mnq_strategy_v2_2_engine_final as old
from research import current_mnq_strategy_v2_4_engine as eng
from research import current_mnq_strategy_v2_4_exam_window as W
from research import current_mnq_strategy_v2_4_targets as base
from research import current_mnq_strategy_v2_4_target_policy as pol
from research.current_mnq_strategy_v2_4_kernel import iter_actionable_candidates

DIAGNOSTIC_ONLY = "DIAGNOSTIC. Hypothetical T1+R-C batch. Lands nothing, moves no production file."

DATA = Path("research/_mnq_v24_replay_lab_v3/data")
LOCK = Path("research/current_mnq_strategy_v2_2_data_lock.json")
MAN = Path("research/current_mnq_strategy_v2_4_frozen_replay_case_manifest_2026_08_20.json")
LABELS = Path("research/current_mnq_strategy_v2_4_replay_v3_labels_FROZEN.json")
OUT = Path("research/current_mnq_strategy_v2_4_t1_rc_batch_report_2026_08_24.json")

ARM_START = _time(8, 0)
CONTROL = "2026-04-14"

#: KEY ZONE destination kinds. Clusters and FVGs are NOT key zones and leave the TARGET universe.
KEY_ZONE_KINDS = ("KEY_ZONE_15M",
                  "KEY_ZONE_15M_REFINED_LIQUIDITY_CLUSTER_5M",
                  "KEY_ZONE_15M_REFINED_FVG_15M_NATIVE")
HTF_BAND_KIND = "KEY_ZONE_30M_REJECTION_BAND"

#: The five convicted early trades, from the ratified census. Keys are (session, clock, dir).
CONVICTED_EARLY = (("2026-03-23", "08:14", "S"), ("2026-03-24", "08:17", "S"),
                   ("2026-03-31", "09:03", "L"), ("2026-04-06", "09:07", "S"),
                   ("2026-04-09", "09:37", "L"))

#: Taught exceptions to R-C, enumerated rather than silently exempted. Each names the story that
#: earns the exception, so a reader can check the exemption against the teaching.
RC_TAUGHT_EXCEPTIONS = {
    "ACCEPTED_BREAK_RETEST_THEN_INTRA5_FORCE": (
        "ALGO-009 Route D: the level is broken, ACCEPTED, then RETESTED as the opposite role. "
        "A retest is by definition a second visit, so freshness cannot be required of it."),
    "PREBREAK_REPEAT_TEST_INTRA5_FORCE": (
        "ALGO-009 exception 2: prior test -> reset -> return attack. The prior test is the "
        "story's own premise; requiring freshness would delete the form."),
}


def _labels():
    man = {c["case_id"]: c["session"] for c in json.load(io.open(MAN, encoding="utf-8"))["cases"]}
    return {man[r["case_id"]]: r
            for r in json.load(io.open(LABELS, encoding="utf-8"))["labels"]
            if r["case_id"] in man}


def _completed_bars_in_band(full5, lo, hi, since, until):
    """Bars COMPLETING at or before `until` (and at/after `since`) whose range meets [lo, hi]."""
    if full5 is None or len(full5) == 0:
        return []
    win = full5[(full5.index >= since) & (full5.index < until)]
    hits = []
    for t, r in win.iterrows():
        if t + pd.Timedelta(minutes=5) > until:
            continue
        if float(r.low) <= hi and float(r.high) >= lo:
            hits.append({"bucket": str(t), "ohlc": [float(r.open), float(r.high),
                                                    float(r.low), float(r.close)]})
    return hits


def _zone_birth(loc):
    """Birth instant from the deterministic id, e.g. 'S:2026-03-03T09:30:00-05:00:97791'."""
    raw = str(getattr(loc, "id", "") or "")
    parts = raw.split(":")
    for i in range(len(parts)):
        cand = ":".join(parts[i:i + 3])
        if "T" in cand and "-" in cand:
            try:
                return pd.Timestamp(cand)
            except Exception:
                continue
    return None


def _resample(full5, minutes):
    return full5.resample(f"{minutes}min", origin="start_day", offset="9h30min",
                          label="left", closed="left").agg(
        open=("open", "first"), high=("high", "max"),
        low=("low", "min"), close=("close", "last")).dropna()


def _htf_band_destinations(full5, asof, dte, entry, direction, p):
    """R-B: 30m rejection bands (wick extreme -> close) ahead of entry, as destinations."""
    tz = full5.index.tz
    day_lo = pd.Timestamp(f"{dte} 00:00", tz=tz)
    htf = _resample(full5[full5.index < asof], 30)
    out = []
    for t, r in htf.tail(24).iterrows():
        closes_at = t + pd.Timedelta(minutes=30)
        if closes_at > asof or t < day_lo:
            continue
        o, h, l, c = float(r.open), float(r.high), float(r.low), float(r.close)
        for which, lo_, hi_ in (("upper", min(c, h), max(c, h)), ("lower", min(l, c), max(l, c))):
            if hi_ - lo_ <= 0:
                continue
            ahead = (lo_ > entry) if direction == "L" else (hi_ < entry)
            if not ahead:
                continue
            contact = (lo_ - entry) if direction == "L" else (entry - hi_)
            if contact <= 0:
                continue
            target_raw = lo_ if direction == "L" else hi_
            loc = eng.core.Location(
                id=f"HTF30:{which}:{t.isoformat()}", side=("R" if direction == "L" else "S"),
                lo=lo_, hi=hi_, mid=(lo_ + hi_) / 2.0, source="HTF_30M_REJECTION_BAND",
                quality=float(p.min_zone_quality), confluence=0,
                entry_authorized=False, zone=None)
            out.append(base.ReactionDestination(
                location=loc, kind=HTF_BAND_KIND, first_contact_distance=float(contact),
                target_raw=float(target_raw), quality=float(p.min_zone_quality),
                meaningful=True, fvg_confluent=False, precision_source="HTF_30M"))
    return out


def apply_T1(dests, full5, asof, dte, entry, direction, p):
    """R-D kind restriction + R-A spent filter + R-B HTF bands. Returns (universe, telemetry)."""
    session_open = pd.Timestamp(f"{dte} 08:00", tz=full5.index.tz)
    kept_kind = [d for d in dests if str(d.kind) in KEY_ZONE_KINDS]
    # R-B REMOVED under ALGO-086: he draws zones on 5m and 15m only. No HTF bands are added.
    pool = kept_kind
    fresh = [d for d in pool
             if not _completed_bars_in_band(full5, float(d.location.lo), float(d.location.hi),
                                            session_open, pd.Timestamp(asof))]
    tele = {"considered_before": len(dests), "after_kind_restriction": len(kept_kind),
            "htf_bands_added": 0, "after_spent_filter": len(fresh)}
    return fresh, tele


def rc_zone_is_fresh(loc, full5, asof):
    """R-C: no completed bar has traded into the zone's band since the zone's BIRTH."""
    birth = _zone_birth(loc)
    if birth is None or full5 is None:
        return True, None, []
    hits = _completed_bars_in_band(full5, float(loc.lo), float(loc.hi), birth,
                                   pd.Timestamp(asof))
    return (not hits), str(birth), hits[:4]


def _approved(env, dte, p, end, batch: bool):
    """Fully-approved entries. `batch` applies T1 (+ floor demotion) and R-C."""
    rows = []
    one, full5 = env["one"], env["full5"]
    for cand, actionable, _plan in iter_actionable_candidates(env, dte, p, as_of=end):
        ent = eng.core.one_minute_entry(one, actionable, cand.direction, p)
        if ent is None:
            continue
        et, epx, _ = ent
        if et > end or et.time() > eng.core.LAST_ENTRY:
            continue

        rc_note = None
        if batch:
            reason = str(cand.reason)
            if reason in RC_TAUGHT_EXCEPTIONS:
                rc_note = {"exempt": True, "reason": reason,
                           "taught_story": RC_TAUGHT_EXCEPTIONS[reason]}
            elif cand.location is not None:
                fresh, birth, hits = rc_zone_is_fresh(cand.location, full5, et)
                rc_note = {"exempt": False, "fresh": bool(fresh), "zone_birth": birth,
                           "completed_bars_in_band_since_birth": hits, "hits": len(hits)}
                if not fresh:
                    rows.append({"key": [str(dte), str(et), str(cand.direction),
                                         str(cand.setup)],
                                 "REFUSED_BY": "R_C_ZONE_NOT_FRESH", "rc": rc_note,
                                 "location_id": str(getattr(cand.location, "id", "")),
                                 "location_band": [float(cand.location.lo),
                                                   float(cand.location.hi)],
                                 "candidate_reason": reason})
                    continue

        dests = base.build_reaction_destinations(
            env["piv5"], full5, env["h15"], et, p, {}, {}, dte, float(epx),
            cand.direction, piv15=env["piv15"])
        tele = None
        if batch:
            dests, tele = apply_T1(dests, full5, et, dte, float(epx), cand.direction, p)
        picked, reason_path = pol.classify_first_reaction_destination(
            dests, float(epx), cand.direction, cand.setup, p, cand.setup == "BRK5",
            entry_location=cand.location, candidate_reason=cand.reason)
        if picked is None:
            continue
        rows.append({
            "key": [str(dte), str(et), str(cand.direction), str(cand.setup)],
            "target": round(float(picked.executable_price), 2),
            "target_kind": str(getattr(picked, "kind", "")),
            "target_band": [float(picked.location.lo), float(picked.location.hi)],
            "path_reason": str(reason_path),
            "candidate_reason": str(cand.reason),
            "location_id": str(getattr(cand.location, "id", "")) if cand.location else None,
            "floor_telemetry_usd": round(
                pol.reference_tp_reward_usd(float(picked.distance)), 2),
            "t1_telemetry": tele,
            "rc": rc_note,
        })
    return rows


def main() -> int:
    t0 = time.perf_counter()
    man = {c["session"]: c for c in json.load(io.open(MAN, encoding="utf-8"))["cases"]}
    labels = _labels()
    observed = old.download_pinned(DATA, include_tick=False)
    old.verify_manifest(observed, json.loads(LOCK.read_text(encoding="utf-8")))

    baseline, batch = {}, {}
    original_floor = pol.TP_GAP_REFERENCE_USD
    with W.trading_window(ARM_START):
        env = old.prepare(old.load_csv(DATA / Path(old.DATA_FILES["5m"]).name),
                          old.load_csv(DATA / Path(old.DATA_FILES["1m"]).name))
        p = eng.Params()
        for s in sorted(man):
            dte = date.fromisoformat(s)
            end = pd.Timestamp(man[s]["replay_end"])
            baseline[s] = _approved(env, dte, p, end, batch=False)
        # NO FLOOR DEMOTION. The floor is the operator's own rule (ALGO-086) and keeps its
        # refusal power in BOTH arms; the open rollover-vs-skip question is not answered here.
        for s in sorted(man):
            dte = date.fromisoformat(s)
            end = pd.Timestamp(man[s]["replay_end"])
            batch[s] = _approved(env, dte, p, end, batch=True)
    assert pol.TP_GAP_REFERENCE_USD == original_floor == 400.0, "the floor must be untouched"

    kb = {tuple(r["key"]) for s in baseline for r in baseline[s] if "target" in r}
    kt = {tuple(r["key"]) for s in batch for r in batch[s] if "target" in r}
    tb = {tuple(r["key"]): r for s in baseline for r in baseline[s] if "target" in r}
    tt = {tuple(r["key"]): r for s in batch for r in batch[s] if "target" in r}
    refused_rc = [r for s in batch for r in batch[s] if r.get("REFUSED_BY")]

    # ---- pre-registered checks -------------------------------------------------------
    ctrl_rows = [r for r in batch.get(CONTROL, []) if "target" in r]
    ctrl_ok = bool(ctrl_rows) and all(
        str(r["target_kind"]) in KEY_ZONE_KINDS for r in ctrl_rows)

    convicted = []
    for sess, clock, direction in CONVICTED_EARLY:
        hit = next((r for r in batch.get(sess, [])
                    if r["key"][1][11:16] == clock and r["key"][2] == direction), None)
        convicted.append({
            "session": sess, "clock": clock, "direction": direction,
            "found": hit is not None,
            "refused_by": (hit or {}).get("REFUSED_BY"),
            "freshness_evidence": (hit or {}).get("rc"),
            "still_approved": bool(hit and "target" in hit),
        })
    convicted_refused = [c for c in convicted if c["refused_by"] == "R_C_ZONE_NOT_FRESH"]

    tp_0330 = 23355.25
    r30 = [r for r in batch.get("2026-03-30", []) if "target" in r]
    tp_contained = any(r["target_band"][0] <= tp_0330 <= r["target_band"][1] for r in r30)

    out = {
        "artifact": "T1_RC_BATCH_REPORT",
        "status": DIAGNOSTIC_ONLY,
        "authority": "ALGO-085",
        "produced": "2026-08-24",
        "nothing_landed": True,
        "floor_untouched_in_both_arms": pol.TP_GAP_REFERENCE_USD,
        "floor_provenance": "OPERATOR-TAUGHT-2026-08-24; refusal power intact; no demotion",
        "r_b_removed": "he draws zones on 5m and 15m only - no 30m/60m bands anywhere",
        "pre_registered": {
            "a_control_survives_with_a_key_zone_target": ctrl_ok,
            "b_five_convicted_early_trades_refused_by_RC":
                f"{len(convicted_refused)}/5",
            "c_0330_target_contains_his_TP_REPORTED_NOT_EXPECTED": tp_contained,
            "c_note": ("ALGO-086: 03-30's S5 block stands as an HONEST LOSS. The 5m/15m sweep "
                       "found no source, and found containment itself vacuous - bands tile "
                       "100.0% of the day's range. Reported, never a success criterion."),
        },
        "approved_baseline": len(kb),
        "approved_batch": len(kt),
        "entries_REMOVED_by_the_batch": sorted(list(k) for k in (kb - kt)),
        "entries_ADDED_by_the_batch": sorted(list(k) for k in (kt - kb)),
        "target_changes_on_survivors": [
            {"key": list(k), "before": tb[k]["target"], "after": tt[k]["target"],
             "kind_after": tt[k]["target_kind"]}
            for k in sorted(kb & kt) if tb[k]["target"] != tt[k]["target"]],
        "refused_by_RC": refused_rc,
        "convicted_early_trades": convicted,
        "rc_taught_exceptions": RC_TAUGHT_EXCEPTIONS,
        "baseline_rows": baseline,
        "batch_rows": batch,
        "no_pnl": ("No PnL, realized outcome, winner/loser label or clean-edge result "
                   "participated in any decision in this diagnostic."),
        "runtime_seconds": round(time.perf_counter() - t0, 2),
    }
    OUT.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print("=== T1 + R-C BATCH REPORT (hypothetical) ===")
    print(f"approved: baseline {len(kb)}  ->  batch {len(kt)}")
    print(f"  removed {len(kb - kt)}   added {len(kt - kb)}   "
          f"target changes {len(out['target_changes_on_survivors'])}")
    print(f"  refused by R-C: {len(refused_rc)}")
    print("\nPRE-REGISTERED:")
    print(f"  (a) control survives with a key-zone target : {ctrl_ok}")
    print(f"  (b) five convicted early trades refused     : {len(convicted_refused)}/5")
    for c in convicted:
        print(f"        {c['session']} {c['clock']} {c['direction']}: "
              f"refused_by={c['refused_by']}  still_approved={c['still_approved']}")
    print(f"  (c) 03-30 contains his TP {tp_0330}: {tp_contained}  (REPORTED - honest loss)")
    print(f"\nfloor untouched: {pol.TP_GAP_REFERENCE_USD}")
    print(f"wrote {OUT}")
    return 0


if __name__ == "__main__":
    with single_writer(OUT, purpose=__spec__.name if __spec__ else __file__):
        raise SystemExit(main())
