#!/usr/bin/env python3
"""The evidence base splits into TWO ERAS that cannot be joined to each other. DIAGNOSTIC ONLY.

    2025 ERA   trade ledger      74 trades, 55 days, 2025-04-02 .. 2025-06-20
               long replay video 3h53m48s, replaying 2025-04-11 and browsing to 2025-04-30
               -> THESE TWO JOIN. Verified below.

    2026 ERA   frozen fidelity corpus   14 sessions, 2026-03-23 .. 2026-04-14
               -> JOINS TO NEITHER. Nine months separate them.

WHY THIS EXPLAINS SOMETHING. ALGO-017 found that no recorded field separates the 7 entries the
trader wanted from the 7 he did not, and ALGO-018's widening found no discarded field does
either. Here is a structural reason to expect that: THE EVIDENCE THAT SHOWS HIS REASONING IS
FROM A DIFFERENT YEAR THAN THE CORPUS HE IS SCORED AGAINST. The video records his screen while
he trades; the ledger records what those trades did. Both are 2025. The fidelity corpus is 2026.

THE FIRST VERIFIED VIDEO-TO-LEDGER JOIN IN THIS CAMPAIGN. [MEASURED 2026-08-22]
The long video's chart reads `Fri 11 Apr '25` at t=1800, 3600 and 5400s, with visible price
18,414-18,736. The ledger holds FOUR MNQ trades on 2025-04-11 at entries 18,449.75, 18,476.50,
18,648.25 and 18,669.50 -- all inside that band. Decision evidence and outcome evidence for the
same day, which no other pair in this corpus offers.

HOW MUCH OF THE VIDEO IS EVEN A CHART. [MEASURED 2026-08-23, objective, no OCR]
39 frames at 360s spacing, chart area, greyscale, mean absolute pixel delta between
consecutive samples. **27 of 38 intervals (71%) are STATIC** - delta below 1.0. The longest run
is t=420..6180, **96 MINUTES PIXEL-IDENTICAL**; a second runs t=6540..9780, 54 minutes. Activity
is concentrated in roughly the final hour. So the "3h53m48s" file is about 71% frozen screen and
any claim resting on nearly four hours of trading is wrong by roughly a factor of four.

That also explains a dead end worth recording: the bottom-right clock reads exactly
`01:15:00 PM UTC-4` at ALL TEN offsets sampled between t=300 and t=5700 - not a stuck widget,
the whole screen is unchanged. It cannot map video time to replay time, so locating his four
2025-04-11 entries needs a different anchor. The obvious one, the realized-PnL field, is an
OUTCOME field and is barred by the ALGO-020 section 3 hard rail.

WHAT THE VIDEO ALSO CONTAINS, extending the custody receipt rather than replacing it:
    t=7200 and t=9200   IDENTICAL OHLC 30 minutes apart -- the chart is frozen, not trading
    t=10800             a CHATGPT CONVERSATION fills the screen. Not a chart at all.
    t=12600             1D daily timeframe, axis spanning Apr to Sep 2025
Any claim about "3h53m of trading" is wrong. Much of it is idle UI and one long stretch is not
FX Replay at all.

THE TRADER'S OBSERVED 2025 BEHAVIOUR vs THE FROZEN RULES (timezone resolved, see below):
    one trade per day        41 of 55 days   (10 days had 2, three had 3, one had 4)
    entries inside 0930-1200 64 of 74        (8 in the 12:00 hour, 2 in the 13:00 hour)
So the frozen rules -- one A+ trade per session, 09:30 to 12:00 -- TIGHTEN his observed behaviour
rather than describe it. That is not a contradiction: a rule he settled on later would look
exactly like this against an earlier record, and FX Replay backtesting is not live trading.
It is flagged, not resolved.

TIMEZONE RESOLVED 2026-08-23 -- THE LEDGER CLOCK IS EASTERN. It was the stated prerequisite for
the teaching lane (ALGO-020 section 3) and `64 of 74` is no longer conditional. Three independent
lines:

  1. THE HARD 09:30 FLOOR. The earliest of all 74 entries is EXACTLY 09:30 and ZERO fall before
     it. That is the RTH open to the minute. Note the argument survives even if FX Replay itself
     restricts replay to RTH: if the export were UTC the floor would appear at 13:30, not 09:30.
     A floor AT 09:30 in the recorded clock means the RECORDED CLOCK IS ET, whatever caused it.
  2. UNDER UTC THE RECORD IS ABSURD. The same entries become 05:30-09:18 ET -- entirely
     overnight and pre-dawn, with NOT ONE in the session this operator trades.
  3. THE UI SAYS SO. The long video's FX Replay clock reads `01:15:00 PM UTC-4`, and the ledger
     is an FX Replay export.

(3) alone was suggestive; (1) is the measurement, and it is a boundary rather than a tendency.

Run: PYTHONPATH=. python -m research.current_mnq_strategy_v2_4_evidence_eras
"""
from __future__ import annotations

import csv
import io
import json
from collections import Counter
from datetime import date
from pathlib import Path

DIAGNOSTIC_ONLY = (
    "DIAGNOSTIC_ONLY. Describes which evidence sets can be joined to which. Selects no strategy "
    "rule, sets no threshold. ALGO-002 section 3.3 and ALGO-011."
)

LEDGER = Path("C:/Users/tonio/Downloads/backtesting-analytics.csv")
SCORECARD = Path("research/current_mnq_strategy_v2_4_frozen_14_case_scorecard_2026_08_21.json")

#: Read off the long replay video's own chart, at the stated offsets. See the module docstring.
VIDEO_OBSERVATIONS = {
    "file": "Desktop 2026.08.15 - 17.13.57.01.mp4",
    "duration_seconds": 14027.58,
    "replayed_dates_read_from_the_chart": {
        "1800": "2025-04-11", "3600": "2025-04-11", "5400": "2025-04-11",
        "12600": "2025-04-30",
    },
    "visible_price_band": [18414.25, 18736.75],
    "non_trading_content": {
        "7200_and_9200": "identical OHLC 30 minutes apart - the chart is frozen",
        "10800": "a ChatGPT conversation fills the screen; not a chart",
        "12600": "1D daily timeframe, axis spanning Apr to Sep 2025",
    },
    "coverage": "9 sampled offsets of a 14027s file. UNENUMERATED; this bounds the DATES, "
                "not the content.",
    # ---- BOUNDED ENUMERATION AT THE JOIN (ALGO-020 section 3 item 2) --------------------
    # Not a full 3h53m census, which the ruling explicitly did not ask for. An OBJECTIVE
    # bound on how much of the file is a frozen screen: 39 frames at 360s spacing, cropped
    # to the chart area, greyscaled, mean absolute pixel delta between consecutive samples.
    # No OCR and no interpretation.
    "static_screen_measurement": {
        "method": "39 frames at 360s spacing, chart area cropped, greyscale, mean abs delta "
                  "between consecutive samples; STATIC means delta < 1.0",
        "intervals": 38,
        "static_intervals": 27,
        "static_share": "71%",
        "longest_static_run_seconds": [420, 6180],
        "longest_static_run_minutes": 96,
        "second_static_run_seconds": [6540, 9780],
        "second_static_run_minutes": 54,
        "activity_concentrated_in": "roughly the final hour, t=9780 onward",
        "finding": (
            "the 3h53m48s file is about 71% FROZEN SCREEN. Two runs of 96 and 54 minutes are "
            "pixel-identical end to end. Any claim resting on '3h53m of trading' is wrong by "
            "roughly a factor of four."),
        "why_the_clock_never_moved": (
            "the bottom-right field reads exactly `01:15:00 PM UTC-4` at all ten offsets "
            "sampled between t=300 and t=5700. That is not a stuck widget - the whole screen "
            "is unchanged across that span. It also means the field cannot be used to map "
            "video time to replay time, so locating his entries needs a different anchor."),
        "SAMPLING_CAVEAT": (
            "this bounds PERSISTENT change, not all activity. A transient that appeared and "
            "reverted between two samples would be invisible. What is established is that 27 "
            "of 38 six-minute intervals BEGIN AND END on an identical screen."),
    },
}

WINDOW_START_MIN, WINDOW_END_MIN = 9 * 60 + 30, 12 * 60


def _minutes(stamp: str) -> int:
    h, m, _ = stamp.split(" ")[1].split(":")
    return int(h) * 60 + int(m)


def _iso(stamp: str) -> str:
    y, m, d = stamp.split(" ")[0].split("/")
    return date(int(y), int(m), int(d)).isoformat()


def measure(ledger: Path = LEDGER, scorecard: Path = SCORECARD) -> dict:
    corpus = sorted({c["session"] for c in
                     json.load(io.open(scorecard, encoding="utf-8"))["cases"]})
    if not ledger.exists():
        return {"status": DIAGNOSTIC_ONLY, "ledger_present": False,
                "corpus_range": [corpus[0], corpus[-1]]}

    rows = list(csv.DictReader(io.open(ledger, encoding="utf-8-sig")))
    days = sorted({_iso(r["dateStart"]) for r in rows})
    per_day = Counter(_iso(r["dateStart"]) for r in rows)
    in_window = [r for r in rows if WINDOW_START_MIN <= _minutes(r["dateStart"]) <= WINDOW_END_MIN]

    video_days = sorted(set(VIDEO_OBSERVATIONS["replayed_dates_read_from_the_chart"].values()))
    lo, hi = VIDEO_OBSERVATIONS["visible_price_band"]
    joined = []
    for d in video_days:
        same = [r for r in rows if _iso(r["dateStart"]) == d]
        joined.append({
            "date": d,
            "ledger_trades": len(same),
            "entry_prices": [float(r["entryPrice"]) for r in same],
            "all_inside_the_videos_visible_price_band":
                all(lo <= float(r["entryPrice"]) <= hi for r in same) if same else False,
        })

    return {
        "status": DIAGNOSTIC_ONLY,
        "ledger_present": True,
        "eras": {
            "2025": {"ledger_range": [days[0], days[-1]], "ledger_trades": len(rows),
                     "ledger_days": len(days), "video_dates": video_days},
            "2026": {"corpus_range": [corpus[0], corpus[-1]], "corpus_sessions": len(corpus)},
        },
        "ledger_x_corpus_overlap_days": sorted(set(days) & set(corpus)),
        "video_x_corpus_overlap_days": sorted(set(video_days) & set(corpus)),
        "video_x_ledger_join": joined,
        "video_and_ledger_join_on_at_least_one_day":
            any(j["ledger_trades"] > 0 for j in joined),
        "observed_behaviour_2025": {
            "days": len(days),
            "days_with_exactly_one_trade": sum(1 for v in per_day.values() if v == 1),
            "trades_per_day_distribution": dict(sorted(Counter(per_day.values()).items())),
            "entries_inside_0930_1200": len(in_window),
            "entries_total": len(rows),
            "entry_hour_distribution":
                dict(sorted(Counter(_minutes(r["dateStart"]) // 60 for r in rows).items())),
            "earliest_entry_clock": min(_minutes(r["dateStart"]) for r in rows),
            "entries_before_0930": sum(1 for r in rows
                                       if _minutes(r["dateStart"]) < WINDOW_START_MIN),
            "TIMEZONE_RESOLVED": (
                "EASTERN. Measured 2026-08-23: the earliest of all 74 entries is exactly 09:30 "
                "and zero fall before it - the RTH open to the minute. Under UTC the same "
                "entries would be 05:30-09:18 ET, entirely overnight with none in the session. "
                "The FX Replay UI in the long video independently reads UTC-4. The in-window "
                "figure is no longer conditional."),
        },
        "video_observations": VIDEO_OBSERVATIONS,
    }


def main() -> None:
    m = measure()
    if not m.get("ledger_present"):
        print("ledger not present on this machine; nothing measurable")
        return
    e = m["eras"]
    print(f'2025 era : ledger {e["2025"]["ledger_range"]} '
          f'({e["2025"]["ledger_trades"]} trades / {e["2025"]["ledger_days"]} days)')
    print(f'           video replays {e["2025"]["video_dates"]}')
    print(f'2026 era : corpus {e["2026"]["corpus_range"]} '
          f'({e["2026"]["corpus_sessions"]} sessions)')
    print()
    print(f'ledger x corpus overlap : {len(m["ledger_x_corpus_overlap_days"])} days')
    print(f'video  x corpus overlap : {len(m["video_x_corpus_overlap_days"])} days')
    print(f'video  x ledger join    : {m["video_and_ledger_join_on_at_least_one_day"]}')
    for j in m["video_x_ledger_join"]:
        print(f'    {j["date"]}  {j["ledger_trades"]} ledger trades  '
              f'entries {j["entry_prices"]}  in the video price band: '
              f'{j["all_inside_the_videos_visible_price_band"]}')
    b = m["observed_behaviour_2025"]
    print()
    print(f'observed 2025 behaviour: {b["days_with_exactly_one_trade"]} of {b["days"]} days had '
          f'exactly one trade; {b["entries_inside_0930_1200"]} of {b["entries_total"]} entries '
          f'inside 09:30-12:00')
    print(f'  {b["TIMEZONE_UNRESOLVED"]}')


if __name__ == "__main__":
    main()
