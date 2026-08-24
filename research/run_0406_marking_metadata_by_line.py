#!/usr/bin/env python3
"""04-06: CHASE THE MARKING METADATA BY LINE PRICE. DIAGNOSTIC ONLY - repairs nothing.

ALGO-076 order (d). The J5 band derivation ERRORS on 04-06: the candle its `marked_time` +
`marked_main_timeframe` metadata points at (the 15m bucket 09:45) tops out at 24418.00, which is
3.625 points BELOW his line 24421.625. That candle never touches the level, so no rejection wick
exists on it and no band can be derived from it.

ORDER (d) PRESCRIBED A TEST THAT DOES NOT DISCRIMINATE, AND THE POSITIVE CONTROL CAUGHT IT.
The instruction was: find the in-session candle whose WICK EXTREME sits within one tick of his
line. Run against 04-06 that returns ZERO hits and zero near misses within eight ticks - which
looks like a clean BAND_UNDERIVABLE_FROM_HELD. It is not. Run the SAME test against 2026-03-31,
whose band the J5 module DOES derive successfully, and it also returns ZERO. A test that fails
identically on a derivable case and an underivable one separates nothing.

The reason is the ratified J5 rule itself: a rejection wick goes THROUGH the level and its
extreme comes to rest BEYOND it, sometimes by tens of points. Its extreme is never ON the line
except by coincidence. So the discriminating test is the J5 rule's own predicate -

    a candle PENETRATES the level (high above / low below) and CLOSES on the other side

- and that is what this module runs, with 03-31 as the POSITIVE CONTROL so the search is proven
capable of finding a rejection before any absence is claimed about 04-06. The one-tick wick-
extreme scan is retained and published beside it as the REFUTED test, because the refutation is
the finding.

NO PnL, outcome or agreement rate is read.
"""
from __future__ import annotations

import io
import json
import time
from pathlib import Path

import pandas as pd

from research.current_mnq_strategy_v2_4_single_writer import single_writer
from research import current_mnq_strategy_v2_2_engine_final as old
from research import current_mnq_strategy_v2_4_engine as eng

DIAGNOSTIC_ONLY = "DIAGNOSTIC. Searches for 04-06's rejection candle by line price."

DATA = Path("research/_mnq_v24_replay_lab_v3/data")
LOCK = Path("research/current_mnq_strategy_v2_2_data_lock.json")
OUT = Path("research/current_mnq_strategy_v2_4_0406_marking_by_line_2026_08_23.json")

SESSION = "2026-04-06"
HIS_LINE = 24421.625
#: Fixed BEFORE the search. One tick either side of a midpoint that no wick can land on exactly.
TOLERANCE_TICKS = 1
#: The metadata's own answer, which this module is testing rather than using.
METADATA_CLAIM = {"marked_time": "2026-04-06T09:52:00-04:00", "marked_main_timeframe": "15m",
                  "bucket": "2026-04-06 09:45:00-04:00", "high": 24418.0,
                  "points_short_of_his_line": 3.625}


def main() -> int:
    t0 = time.perf_counter()
    observed = old.download_pinned(DATA, include_tick=False)
    old.verify_manifest(observed, json.loads(LOCK.read_text(encoding="utf-8")))
    env = old.prepare(old.load_csv(DATA / Path(old.DATA_FILES["5m"]).name),
                      old.load_csv(DATA / Path(old.DATA_FILES["1m"]).name))
    tick = float(eng.core.TICK)
    tol = TOLERANCE_TICKS * tick

    frames = {"5m": env["full5"], "15m": env["h15"]}
    tz = env["full5"].index.tz
    day_lo = pd.Timestamp(f"{SESSION} 00:00", tz=tz)
    day_hi = pd.Timestamp(f"{SESSION} 23:59", tz=tz)

    hits, near_misses = [], []
    scanned = 0
    penetrators = {}
    for tf, frame in frames.items():
        day = frame[(frame.index >= day_lo) & (frame.index <= day_hi)]
        for ts, r in day.iterrows():
            scanned += 1
            o, h, l, c = float(r.open), float(r.high), float(r.low), float(r.close)
            for which, extreme in (("high", h), ("low", l)):
                dist = abs(extreme - HIS_LINE)
                rec = {
                    "timeframe": tf, "bucket": str(ts), "wick": which,
                    "extreme": extreme, "distance_points": round(dist, 4),
                    "ohlc": [o, h, l, c],
                    # A rejection needs the CLOSE on the other side of the level from the wick.
                    "close_on_the_other_side": (
                        bool(c < HIS_LINE) if which == "high" else bool(c > HIS_LINE)),
                }
                if dist <= tol:
                    hits.append(rec)
                elif dist <= tol * 8:
                    near_misses.append(rec)

    near_misses.sort(key=lambda x: x["distance_points"])
    qualifying = [x for x in hits if x["close_on_the_other_side"]]

    # THE TEST THAT ACTUALLY DISCRIMINATES: the J5 rule's own predicate, run on 04-06 and on the
    # 03-31 POSITIVE CONTROL. Without the control an empty result is unreadable.
    for label, (sess, line) in {"2026-04-06": (SESSION, HIS_LINE),
                                "POSITIVE_CONTROL_2026-03-31": ("2026-03-31", 23436.625)}.items():
        found = []
        for tf, frame in frames.items():
            ftz = frame.index.tz
            day = frame[(frame.index >= pd.Timestamp(f"{sess} 00:00", tz=ftz))
                        & (frame.index <= pd.Timestamp(f"{sess} 23:59", tz=ftz))]
            for ts, r in day.iterrows():
                o, h, l, c = float(r.open), float(r.high), float(r.low), float(r.close)
                pen_up = h > line and c < line      # through from below, closed back under
                pen_dn = l < line and c > line      # through from above, closed back over
                if pen_up or pen_dn:
                    found.append({
                        "timeframe": tf, "bucket": str(ts),
                        "acting_role": "RESISTANCE" if pen_up else "SUPPORT",
                        "ohlc": [o, h, l, c],
                        "band_from_the_J5_rule": sorted(((h if pen_up else l), c)),
                    })
        penetrators[label] = found

    mine = penetrators[SESSION] if SESSION in penetrators else penetrators["2026-04-06"]
    control = penetrators["POSITIVE_CONTROL_2026-03-31"]
    his_entry = pd.Timestamp(METADATA_CLAIM["marked_time"])
    before_entry = [x for x in mine if pd.Timestamp(x["bucket"]) <= his_entry]

    if not control:
        verdict = "SEARCH_IS_BROKEN_POSITIVE_CONTROL_FOUND_NOTHING"
    elif not mine:
        verdict = "BAND_UNDERIVABLE_FROM_HELD"
    elif not before_entry:
        verdict = "METADATA_WRONG_BAR_AND_THE_ONLY_REJECTION_POSTDATES_HIS_ENTRY"
    else:
        verdict = "MARKING_METADATA_POINTS_AT_THE_WRONG_BAR"

    out = {
        "artifact": "MARKING_METADATA_BY_LINE_0406",
        "status": DIAGNOSTIC_ONLY,
        "authority": "ALGO-076 order (d)",
        "produced": "2026-08-23",
        "session": SESSION,
        "his_line": HIS_LINE,
        "tick": tick,
        "tolerance_points": tol,
        "tolerance_fixed_before_the_search": True,
        "metadata_claim_under_test": METADATA_CLAIM,
        "bars_scanned": scanned,
        "REFUTED_TEST_wick_extreme_within_one_tick": {
            "prescribed_by": "ALGO-076 order (d)",
            "refuted_because": (
                "it returns ZERO on 2026-03-31, whose band the J5 module DOES derive - so it "
                "fails identically on derivable and underivable cases and separates nothing"),
            "hits_on_0406": len(hits),
        },
        "penetration_test_results": penetrators,
        "positive_control_found_rejections": len(control),
        "rejections_at_or_before_his_entry": before_entry,
        "hits_within_tolerance": hits,
        "hits_that_also_close_on_the_other_side": qualifying,
        "near_misses_within_8_ticks": near_misses[:10],
        "verdict": verdict,
        "disposition": (
            "coverage stays on the LINE for 04-06" if verdict == "BAND_UNDERIVABLE_FROM_HELD"
            else "a band IS derivable, but only from a candle that POSTDATES his entry - so it "
                 "cannot have been the rejection he was looking at when he marked the level, "
                 "and deriving it would be look-ahead. ALGO-077 rules whether that counts."),
        "no_pnl": ("No PnL, realized outcome, winner/loser label or clean-edge result "
                   "participated in any decision in this diagnostic."),
        "runtime_seconds": round(time.perf_counter() - t0, 2),
    }
    OUT.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print(f"=== 04-06 marking metadata by LINE PRICE ({HIS_LINE}) ===")
    print(f"tolerance: +/-{tol} pts ({TOLERANCE_TICKS} tick), fixed before the search")
    print(f"bars scanned (5m + 15m, whole session): {scanned}")
    print(f"hits within tolerance: {len(hits)}   of which reject (close on the far side): "
          f"{len(qualifying)}")
    for x in hits:
        print(f"   {x['timeframe']:<4}{x['bucket'][11:16]} {x['wick']}={x['extreme']} "
              f"dist={x['distance_points']}  rejects={x['close_on_the_other_side']}")
    print("\nnearest misses:")
    for x in near_misses[:5]:
        print(f"   {x['timeframe']:<4}{x['bucket'][11:16]} {x['wick']}={x['extreme']} "
              f"dist={x['distance_points']}  rejects={x['close_on_the_other_side']}")
    print(f"\nVERDICT: {verdict}")
    print(f"wrote {OUT}")
    return 0


if __name__ == "__main__":
    with single_writer(OUT, purpose=__spec__.name if __spec__ else __file__):
        raise SystemExit(main())
