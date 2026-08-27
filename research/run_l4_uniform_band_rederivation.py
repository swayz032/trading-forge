#!/usr/bin/env python3
"""L4 - RE-DERIVE EVERY BAND UNDER THE ALGO-078 §5 LAW. DIAGNOSTIC ONLY - repairs nothing.

THE LAW, generalising the 04-06 verdict: `marked_time` is UNTRUSTED METADATA. Every band's
source candle is DERIVED, never read off the label:

    join on LINE PRICE  ->  among COMPLETED bars AT OR BEFORE his entry, find the candle that
    PENETRATES his line (through it, closing on the other side)  ->  band = [wick extreme, close]

WHY THE LAW EXISTS. The metadata-driven derivation put 04-06 on a candle whose high stopped
3.625 points short of his line, and marked ALL FOUR other bands as FORMING - three of them at
the exact open of their own bar, so their extremes and closes did not exist when he drew the
level. ALGO-078 notes 03-24's band candle closes THIRTEEN MINUTES AFTER his 09:32 entry. A band
built from bars that had not printed is not a band he could have drawn.

WHAT IS PUBLISHED: old band vs new band per session, the source candle each came from, and
whether the new one is COMPLETED at his entry - which under this law it is BY CONSTRUCTION, so
that column is a self-check on the implementation and NOT evidence of anything.

CONTROLS. 03-31 has a rich penetration history (12 candles) and must re-derive cleanly; 04-14 is
the agreement session. A law that breaks either is wrong.

Downstream S1 location-coverage under the new bands is re-run as a REPORT only. Nothing lands.
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
from research.current_mnq_strategy_v2_4_levels import build_entry_locations_v24

DIAGNOSTIC_ONLY = "DIAGNOSTIC. Re-derives every band under the §5 law. Repairs nothing."

DATA = Path("research/_mnq_v24_replay_lab_v3/data")
LOCK = Path("research/current_mnq_strategy_v2_2_data_lock.json")
MANIFEST = Path("research/current_mnq_strategy_v2_4_frozen_replay_case_manifest_2026_08_20.json")
LABELS = Path("research/current_mnq_strategy_v2_4_replay_v3_labels_FROZEN.json")
OLD_BANDS = Path("research/current_mnq_strategy_v2_4_j5_bands_five_sessions_2026_08_23.json")
OUT = Path("research/current_mnq_strategy_v2_4_l4_uniform_band_rederivation_2026_08_24.json")

SESSIONS = ("2026-03-24", "2026-03-30", "2026-03-31", "2026-04-06", "2026-04-14")
CONTROLS = ("2026-03-31", "2026-04-14")
ARM_NAME, ARM_START = "taught_0800", _time(8, 0)


def _labels():
    man = {c["case_id"]: c["session"]
           for c in json.load(io.open(MANIFEST, encoding="utf-8"))["cases"]}
    return {man[r["case_id"]]: r
            for r in json.load(io.open(LABELS, encoding="utf-8"))["labels"]
            if r["case_id"] in man}


def _pick_line(label, entry_px, full5, his_clock):
    """His line = midpoint of the zone the entry candle PENETRATES (the ratified selector)."""
    zones = label.get("trader_zones") or []
    if not zones:
        return None
    def mid(z):
        return (float(z["lo"]) + float(z["hi"])) / 2.0
    bucket = his_clock.floor("5min")
    win = full5[(full5.index >= bucket - pd.Timedelta(minutes=5)) & (full5.index <= bucket)]
    pen = []
    for z in zones:
        m = mid(z)
        for _t, r in win.iterrows():
            h, l, c = float(r.high), float(r.low), float(r.close)
            if (h > m and c < m) or (l < m and c > m):
                pen.append(z)
                break
    pool = pen or zones
    return mid(min(pool, key=lambda z: 0.0 if float(z["lo"]) <= entry_px <= float(z["hi"])
                   else min(abs(entry_px - float(z["lo"])), abs(entry_px - float(z["hi"])))))


def main() -> int:
    t0 = time.perf_counter()
    labels = _labels()
    oldb = {r["session"]: r for r in json.load(io.open(OLD_BANDS, encoding="utf-8"))["rows"]} \
        if OLD_BANDS.exists() else {}
    observed = old.download_pinned(DATA, include_tick=False)
    old.verify_manifest(observed, json.loads(LOCK.read_text(encoding="utf-8")))

    rows = []
    with W.trading_window(ARM_START):
        env = old.prepare(old.load_csv(DATA / Path(old.DATA_FILES["5m"]).name),
                          old.load_csv(DATA / Path(old.DATA_FILES["1m"]).name))
        p = eng.Params()
        full5, h15, one = env["full5"], env["h15"], env["one"]
        tz = full5.index.tz

        for session in SESSIONS:
            dte = date.fromisoformat(session)
            label = labels[session]
            his_clock = pd.Timestamp(label["first_entry_time"])
            b = one[one.index <= his_clock]
            entry_px = float(b.iloc[-1].open)
            line = _pick_line(label, entry_px, full5, his_clock)
            day_lo = pd.Timestamp(f"{session} 00:00", tz=tz)

            # ---- THE LAW: completed bars at or before his entry that PENETRATE his line ----
            cands = []
            for tf, frame, minutes in (("5m", full5, 5), ("15m", h15, 15)):
                day = frame[(frame.index >= day_lo) & (frame.index < his_clock)]
                for t, r in day.iterrows():
                    closes_at = t + pd.Timedelta(minutes=minutes)
                    if closes_at > his_clock:
                        continue                      # NOT completed at his entry
                    o, h, l, c = float(r.open), float(r.high), float(r.low), float(r.close)
                    pen_up = h > line and c < line
                    pen_dn = l < line and c > line
                    if not (pen_up or pen_dn):
                        continue
                    extreme = h if pen_up else l
                    lo_, hi_ = sorted((extreme, c))
                    cands.append({
                        "timeframe": tf, "bucket": str(t), "closes_at": str(closes_at),
                        "acting_role": "RESISTANCE" if pen_up else "SUPPORT",
                        "ohlc": [o, h, l, c],
                        "band": [round(lo_, 4), round(hi_, 4)],
                        "width_points": round(hi_ - lo_, 2),
                        "completed_at_his_entry": True,
                    })
            # The band he could most recently have drawn: the LATEST completed penetration.
            chosen = max(cands, key=lambda x: pd.Timestamp(x["bucket"])) if cands else None

            o_row = oldb.get(session, {})
            old_band = ([o_row.get("band_lo"), o_row.get("band_hi")]
                        if o_row.get("band_lo") is not None else None)

            # ---- downstream S1: does the NEW band land inside a built location? -----------
            open_ts = pd.Timestamp(f"{dte} 09:30", tz=eng.core.TZ)
            locs, _z = build_entry_locations_v24(
                {"h15": h15, "piv15": env["piv15"], "full5": full5}, dte, open_ts, p)
            covering_new = []
            if chosen:
                nlo, nhi = chosen["band"]
                covering_new = [{"id": str(l.id), "band": [float(l.lo), float(l.hi)]}
                                for l in locs
                                if float(l.lo) <= nhi and nlo <= float(l.hi)]

            rows.append({
                "session": session,
                "is_control": session in CONTROLS,
                "his_entry_clock": str(his_clock),
                "his_line": line,
                "OLD_band_from_marked_time": old_band,
                "OLD_state_at_marked_time": o_row.get("rejection_candle_state_at_marked_time"),
                "OLD_source_candle": o_row.get("rejection_candle_bucket"),
                "OLD_error": o_row.get("ERROR"),
                "completed_penetrations_at_or_before_his_entry": len(cands),
                "all_candidates": cands[:10],
                "NEW_band": chosen["band"] if chosen else None,
                "NEW_source_candle": chosen["bucket"] if chosen else None,
                "NEW_source_closes_at": chosen["closes_at"] if chosen else None,
                "NEW_timeframe": chosen["timeframe"] if chosen else None,
                "NEW_acting_role": chosen["acting_role"] if chosen else None,
                "NEW_width_points": chosen["width_points"] if chosen else None,
                "NEW_is_completed_at_his_entry": bool(chosen),
                "S1_locations_overlapping_the_NEW_band": covering_new[:6],
                "S1_locations_overlapping_count": len(covering_new),
                "verdict": ("BAND_DERIVED_FROM_A_COMPLETED_BAR" if chosen
                            else "NO_COMPLETED_PENETRATION_BEFORE_HIS_ENTRY"),
            })

    derived = [r for r in rows if r["NEW_band"]]
    ctrls = [r for r in rows if r["is_control"]]
    out = {
        "artifact": "L4_UNIFORM_BAND_REDERIVATION",
        "status": DIAGNOSTIC_ONLY,
        "authority": "ALGO-078 lane 4, §5 law",
        "produced": "2026-08-24",
        "arm": ARM_NAME,
        "law": ("marked_time is UNTRUSTED. Join on LINE PRICE; among COMPLETED bars at or "
                "before his entry take the candle that PENETRATES the line; "
                "band = [wick extreme, close]. Latest such candle wins."),
        "controls": list(CONTROLS),
        "controls_all_derived": all(r["NEW_band"] for r in ctrls),
        "rows": rows,
        "sessions_derived": [r["session"] for r in derived],
        "sessions_with_no_completed_penetration": [
            r["session"] for r in rows if not r["NEW_band"]],
        "completed_by_construction_note": (
            "NEW_is_completed_at_his_entry is True by construction under this law - it is an "
            "implementation self-check, NOT evidence."),
        "downstream_is_report_only": True,
        "no_pnl": ("No PnL, realized outcome, winner/loser label or clean-edge result "
                   "participated in any decision in this diagnostic."),
        "runtime_seconds": round(time.perf_counter() - t0, 2),
    }
    OUT.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print("=== L4 UNIFORM BAND RE-DERIVATION (§5 law) ===")
    for r in rows:
        tag = " [CONTROL]" if r["is_control"] else ""
        print(f"\n{r['session']}{tag}  line={r['his_line']}  entry={r['his_entry_clock'][11:16]}")
        print(f"   OLD {r['OLD_band_from_marked_time']}  "
              f"({r['OLD_state_at_marked_time']}, candle {str(r['OLD_source_candle'])[11:16]})"
              + (f"  ERROR={r['OLD_error'][:40]}" if r.get("OLD_error") else ""))
        print(f"   NEW {r['NEW_band']}  from {r['NEW_timeframe']} "
              f"{str(r['NEW_source_candle'])[11:16]} closing {str(r['NEW_source_closes_at'])[11:16]}"
              f"  role={r['NEW_acting_role']}  w={r['NEW_width_points']}")
        print(f"   completed penetrations available: "
              f"{r['completed_penetrations_at_or_before_his_entry']}"
              f"   S1 locations overlapping NEW: {r['S1_locations_overlapping_count']}")
    print(f"\ncontrols all derived: {out['controls_all_derived']}")
    print(f"wrote {OUT}")
    return 0


if __name__ == "__main__":
    with single_writer(OUT, purpose=__spec__.name if __spec__ else __file__):
        raise SystemExit(main())
