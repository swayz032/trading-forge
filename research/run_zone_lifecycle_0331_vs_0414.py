#!/usr/bin/env python3
"""03-31's ABSENCE, enumerated bar by bar, against 04-14's grant. ALGO-067 §3. DIAGNOSTIC ONLY.

THE ROW THAT PROMPTED THIS. Under the J1-J6 join, 2026-03-31 has TWO authorized locations
covering his level at 09:30 and produces ZERO break-family candidates at his clock. An absence,
not a refusal — and absence is what this seat has been wrong about twice, so it gets a positive
control: 2026-04-14 is the same shape (a break-long at resistance) and the machine GRANTS it.
The first stage at which the two diverge is the finding.

THE MECHANISM, AT ITS EXECUTABLE LINES.

    zone_lifecycle.py:43   _breaks(role, close, lo, hi, clear):
                             role "S" -> close <  lo - clear
                             role "R" -> close >  hi + clear
    zone_lifecycle.py:77   clear = p.breakout_clear_atr * atr
    zone_lifecycle.py:81   if _breaks(...): state = BROKEN
    v2_2_engine.py:135     Zone.active = state in {ACTIVE_SUPPORT, ACTIVE_RESISTANCE,
                                                   TESTED, FLIPPED_RETEST}   <- BROKEN is NOT
    kernel.py:210          if before.active: pre_locs.append(...)            <- so BROKEN is
                                                                                DROPPED

So a zone that is broken DECISIVELY - closing beyond it by more than the ATR clearance -
disappears from the candidate locations entirely, and no candidate of ANY route can form there.
A zone broken MARGINALLY (closing beyond it but inside the clearance) stays TESTED, and TESTED
is still active.

WHICH RAISES THE QUESTION THIS MODULE MEASURES. The taught break entry is a MOMENTUM break. The
harder the break, the more certainly the zone is retired before the entry clock. If that is what
happened on 03-31, the defect is LIFECYCLE ORDERING - the zone the break needs is retired BY the
break - and it is not a threshold anywhere.

This module measures; it does not repair, and it does not touch the lifecycle.

Run: PYTHONPATH=. python -m research.run_zone_lifecycle_0331_vs_0414
"""
from __future__ import annotations

import io
import json
import time
from pathlib import Path

import numpy as np
import pandas as pd

from research.current_mnq_strategy_v2_4_single_writer import single_writer
from research import current_mnq_strategy_v2_2_engine_final as old
from research import current_mnq_strategy_v2_4_engine as v24
from research import current_mnq_strategy_v2_4_exam_window as W
from research import run_refusal_diagnosis_lost_four as D
from research.current_mnq_strategy_v2_4_levels import build_entry_locations_v24
from research.current_mnq_strategy_v2_4_zone_lifecycle import zone_state_at_v24

DIAGNOSTIC_ONLY = (
    "DIAGNOSTIC. Enumerates zone-lifecycle transitions. Repairs nothing, changes no rule. "
    "ALGO-067 section 3."
)

DATA = Path("research/_mnq_v24_replay_lab_v3/data")
LOCK = Path("research/current_mnq_strategy_v2_2_data_lock.json")
OUT = Path("research/current_mnq_strategy_v2_4_zone_lifecycle_0331_vs_0414_2026_08_23.json")

EXECUTABLE_LINES = {
    "break_test": "research/current_mnq_strategy_v2_4_zone_lifecycle.py:43-46  _breaks(): "
                  "role 'S' -> close < lo - clear ; role 'R' -> close > hi + clear",
    "clearance": "research/current_mnq_strategy_v2_4_zone_lifecycle.py:77  "
                 "clear = p.breakout_clear_atr * atr",
    "sets_broken": "research/current_mnq_strategy_v2_4_zone_lifecycle.py:81-83  "
                   "if _breaks(...): state = ZoneState.BROKEN",
    "active_excludes_broken": "research/current_mnq_strategy_v2_2_engine.py:135-141  "
                              "Zone.active = state in {ACTIVE_SUPPORT, ACTIVE_RESISTANCE, "
                              "TESTED, FLIPPED_RETEST} - BROKEN is absent",
    "kernel_drops_inactive": "research/current_mnq_strategy_v2_4_kernel.py:210  "
                             "if before.active: pre_locs.append(...)",
}

CASES = {
    "2026-03-31": {"line": 23436.625, "role": "RESISTANCE", "entry": "09:49",
                   "lane": "SUBJECT (zero break candidates despite coverage)"},
    "2026-04-14": {"line": 25716.625, "role": "RESISTANCE", "entry": "09:36",
                   "lane": "POSITIVE CONTROL (same shape, machine GRANTS it)"},
}


def main() -> int:
    t0 = time.perf_counter()
    observed = old.download_pinned(DATA, include_tick=False)
    old.verify_manifest(observed, json.loads(LOCK.read_text(encoding="utf-8")))

    out_rows = {}
    with W.trading_window(W.BASELINE_ARM_START):
        env = old.prepare(old.load_csv(DATA / Path(old.DATA_FILES["5m"]).name),
                          old.load_csv(DATA / Path(old.DATA_FILES["1m"]).name))
        p = v24.Params()
        full5 = env["full5"]

        for session, spec in CASES.items():
            line = spec["line"]
            dte = pd.Timestamp(session).date()
            open_ts = pd.Timestamp(f"{session} 09:30", tz=full5.index.tz)
            locations, _ = build_entry_locations_v24(env, dte, open_ts, p)

            # The locations whose band covers his line, and which carry a lifecycle zone.
            covering = [x for x in locations
                        if float(x.lo) <= line <= float(x.hi) and x.zone is not None]

            end = pd.Timestamp(f"{session} {spec['entry']}", tz=full5.index.tz) \
                + pd.Timedelta(minutes=5)
            clocks = [t for t in full5.index if open_ts <= t <= end]

            zones_out = []
            for loc in covering:
                z = loc.zone
                transitions = []
                prev_state = None
                for ts in clocks:
                    st = zone_state_at_v24(z, full5, ts, p)
                    bar = full5.loc[ts]
                    atr = float(bar.atr) if pd.notna(bar.atr) else float("nan")
                    clear = (p.breakout_clear_atr * atr if np.isfinite(atr) else None)
                    role = st.side
                    if role == "S":
                        breaks = float(bar.close) < float(z.lo) - (clear or 0)
                        margin = round(float(z.lo) - (clear or 0) - float(bar.close), 2)
                    else:
                        breaks = float(bar.close) > float(z.hi) + (clear or 0)
                        margin = round(float(bar.close) - (float(z.hi) + (clear or 0)), 2)
                    row = {
                        "clock": str(ts),
                        "bar_close": round(float(bar.close), 2),
                        "atr": None if not np.isfinite(atr) else round(atr, 2),
                        "clearance_points": None if clear is None else round(clear, 2),
                        "role_now": role,
                        "state_now": str(st.state).split(".")[-1],
                        "active_now": bool(st.active),
                        "this_bar_would_break_it": bool(breaks),
                        "margin_past_the_clearance": margin,
                    }
                    if str(row["state_now"]) != prev_state:
                        row["TRANSITION"] = f"{prev_state} -> {row['state_now']}"
                        prev_state = row["state_now"]
                    transitions.append(row)

                first_inactive = next((r for r in transitions if not r["active_now"]), None)
                # HIS ENTRY BUCKET, not the last clock enumerated. The first version read
                # `transitions[-1]` - one bar PAST his entry - and on 03-31 that bar (09:50) is
                # TESTED while his own bucket (09:45) is BROKEN. It printed "NOT the lifecycle"
                # about data that says the opposite. An off-by-one in the SUMMARY inverted the
                # finding while every underlying row was correct.
                entry_bucket = pd.Timestamp(
                    f"{session} {spec['entry']}", tz=full5.index.tz).floor("5min")
                at_entry = next((r for r in transitions
                                 if pd.Timestamp(r["clock"]) == entry_bucket), None)
                zones_out.append({
                    "location_id": str(loc.id),
                    "band": [round(float(loc.lo), 2), round(float(loc.hi), 2)],
                    "source": str(loc.source),
                    "zone_created": str(z.created),
                    "first_clock_it_became_INACTIVE": (
                        None if first_inactive is None else first_inactive["clock"]),
                    "state_when_it_went_inactive": (
                        None if first_inactive is None else first_inactive["state_now"]),
                    "his_entry_bucket": str(entry_bucket),
                    "state_at_his_entry_bucket": (
                        None if at_entry is None else at_entry["state_now"]),
                    "still_active_at_his_entry": (
                        None if at_entry is None else bool(at_entry["active_now"])),
                    "bar_by_bar": transitions,
                })

            out_rows[session] = {
                "lane": spec["lane"], "his_line": line, "his_role": spec["role"],
                "entry_clock": spec["entry"],
                "locations_covering_his_line_at_0930": len(covering),
                "zones": zones_out,
            }

    subject = out_rows.get("2026-03-31", {})
    control = out_rows.get("2026-04-14", {})

    def alive_at_entry(block):
        return [z["location_id"] for z in block.get("zones", [])
                if z["still_active_at_his_entry"]]

    finding = {
        "subject_zones_alive_at_his_entry": alive_at_entry(subject),
        "control_zones_alive_at_his_entry": alive_at_entry(control),
        "first_divergent_stage": None,
    }
    s_alive, c_alive = finding["subject_zones_alive_at_his_entry"], \
        finding["control_zones_alive_at_his_entry"]
    if not s_alive and c_alive:
        finding["first_divergent_stage"] = (
            "ZONE LIFECYCLE: every covering zone on 2026-03-31 is INACTIVE by his entry clock, "
            "while the control's covering zone is still ACTIVE. The kernel drops inactive "
            "locations (kernel.py:210), so no candidate of any route can form at a retired "
            "zone - which is why the break family produced ZERO candidates rather than a "
            "refusal.")
    elif s_alive:
        finding["first_divergent_stage"] = (
            "NOT the lifecycle: covering zones are still active at his entry on the subject, "
            "so the absence of break candidates has another cause.")

    out = {
        "artifact": "ZONE_LIFECYCLE_0331_VS_0414",
        "status": DIAGNOSTIC_ONLY,
        "authority": "ALGO-067 section 3",
        "produced": "2026-08-23",
        "question": ("why does 2026-03-31 produce ZERO break candidates at a level covered by "
                     "TWO authorized locations, when 2026-04-14 - the same shape - grants?"),
        "executable_lines": EXECUTABLE_LINES,
        "hypothesis_under_test": (
            "the break RETIRES the zone the break entry needs: a decisive close beyond the "
            "band sets BROKEN, BROKEN is not `active`, and the kernel drops inactive locations"),
        "sessions": out_rows,
        "finding": finding,
        "runtime_seconds": round(time.perf_counter() - t0, 2),
        "no_pnl": ("No PnL, realized outcome, winner/loser label or clean-edge result "
                   "participated in any decision in this diagnostic."),
    }
    OUT.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    for session, block in out_rows.items():
        print(f"\n=== {session}  [{block['lane']}]  his {block['his_role']} "
              f"{block['his_line']}  entry {block['entry_clock']} ===")
        for z in block["zones"]:
            print(f"  zone {z['location_id']}  band {z['band']}  ({z['source']})")
            print(f"    still ACTIVE at his entry: {z['still_active_at_his_entry']}"
                  f"   first inactive at: {z['first_clock_it_became_INACTIVE']}")
            for r in z["bar_by_bar"]:
                if "TRANSITION" in r or r["this_bar_would_break_it"]:
                    print(f"      {r['clock'][11:16]} close={r['bar_close']:<10} "
                          f"clear={r['clearance_points']}  {r.get('TRANSITION','')}"
                          f"{'  BREAKS' if r['this_bar_would_break_it'] else ''}"
                          f"  active={r['active_now']}")
    print(f"\nFINDING: {finding['first_divergent_stage']}")
    print(f"\nwrote {OUT}")
    return 0


if __name__ == "__main__":
    with single_writer(OUT, purpose=__spec__.name if __spec__ else __file__):
        raise SystemExit(main())
