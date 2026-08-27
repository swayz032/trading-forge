#!/usr/bin/env python3
"""Can the trade ledger validate the frozen replay corpus row by row? DIAGNOSTIC ONLY.

THE ANSWER IS NO, AND IT IS STRUCTURAL. [MEASURED 2026-08-22]

    frozen corpus   14 sessions   2026-03-23 .. 2026-04-14
    trade ledger    55 dates      2025-04-02 .. 2025-06-20   (74 rows)
    dates in common 0

They are nine months apart and share not one session. ALGO-002 section 3.3 authorized the
ledger as a "TP/exit fidelity diagnostic", and it remains excellent evidence of WHAT THE TRADER
DOES -- his stop discipline (four rows at exactly -517.50 dollars, 17.25 points), his contract
sizing, his hold times. It is NOT and cannot be row-level ground truth for any of the 14 replay
sessions, because it does not describe those days.

WHY THIS FILE EXISTS RATHER THAN A NOTE. A zero that is merely absent from a report is
indistinguishable from a question nobody asked. Worse, the two artifacts sit side by side in
`research/` with the same instrument and the same symbol, and a future join across them would
look entirely reasonable and produce a silently empty or -- if a date parse ever went wrong --
a silently WRONG match set. `assert_ledger_can_ground_truth_the_corpus` refuses out loud.

If the operator later supplies ledger rows covering the corpus dates, the guard stops refusing
on its own. It gates on the MEASUREMENT, never on a hardcoded verdict.
"""
from __future__ import annotations

import csv
import io
import json
from datetime import date
from pathlib import Path

DIAGNOSTIC_ONLY = (
    "DIAGNOSTIC_ONLY. Measures whether two evidence sets can be joined. Selects no strategy "
    "rule, no threshold and no parameter. ALGO-002 section 3.3."
)

SCORECARD = Path("research/current_mnq_strategy_v2_4_frozen_14_case_scorecard_2026_08_21.json")
LEDGER_CSV = Path("C:/Users/tonio/Downloads/backtesting-analytics.csv")
LEDGER_DATE_COLUMNS = ("dateStart", "dateEnd")


def _iso(raw: str | None) -> str | None:
    """Parse a ledger date cell. Returns None rather than guessing at an unknown shape."""
    s = (raw or "").strip().split(" ")[0]
    for sep in ("/", "-"):
        parts = s.split(sep)
        if len(parts) == 3:
            try:
                return date(int(parts[0]), int(parts[1]), int(parts[2])).isoformat()
            except ValueError:
                continue
    return None


def frozen_sessions(scorecard: Path = SCORECARD) -> set[str]:
    sc = json.load(io.open(scorecard, encoding="utf-8"))
    return {c["session"] for c in sc["cases"]}


def ledger_dates(csv_path: Path = LEDGER_CSV) -> tuple[set[str], int, int]:
    """(distinct dates, rows read, cells that would not parse).

    The unparsed count is returned, not swallowed. A join that silently drops rows it could not
    read would report a small overlap and call it a measurement.
    """
    if not csv_path.exists():
        return set(), 0, 0
    rows = list(csv.DictReader(io.open(csv_path, encoding="utf-8-sig")))
    out: set[str] = set()
    unparsed = 0
    for r in rows:
        for col in LEDGER_DATE_COLUMNS:
            if col not in r:
                continue
            v = _iso(r[col])
            if v is None:
                unparsed += 1
            else:
                out.add(v)
    return out, len(rows), unparsed


def measure(scorecard: Path = SCORECARD, csv_path: Path = LEDGER_CSV) -> dict:
    corpus = frozen_sessions(scorecard)
    led, rows, unparsed = ledger_dates(csv_path)
    overlap = sorted(corpus & led)
    return {
        "status": DIAGNOSTIC_ONLY,
        "ledger_present": bool(rows),
        "ledger_rows": rows,
        "ledger_distinct_dates": len(led),
        "ledger_range": [min(led), max(led)] if led else None,
        "ledger_date_cells_unparsed": unparsed,
        "corpus_sessions": len(corpus),
        "corpus_range": [min(corpus), max(corpus)] if corpus else None,
        "overlapping_dates": overlap,
        "overlap_count": len(overlap),
        "can_ground_truth_the_corpus": bool(overlap),
    }


def assert_ledger_can_ground_truth_the_corpus(m: dict | None = None) -> dict:
    """Refuse, loudly, any use of the ledger as per-session ground truth without an overlap.

    Call this BEFORE joining ledger rows to replay sessions. It is not a style check: an empty
    join reads exactly like a clean one.
    """
    m = m or measure()
    if not m["ledger_present"]:
        raise RuntimeError(
            "LEDGER_NOT_PRESENT: the CSV is not committed and is absent from this machine, so "
            "no overlap can be measured. Absence of the file is not absence of overlap.")
    if not m["can_ground_truth_the_corpus"]:
        raise RuntimeError(
            "LEDGER_AND_CORPUS_ARE_DISJOINT: the ledger covers "
            f'{m["ledger_range"][0]}..{m["ledger_range"][1]} ({m["ledger_distinct_dates"]} '
            f'dates) and the frozen corpus covers {m["corpus_range"][0]}..'
            f'{m["corpus_range"][1]} ({m["corpus_sessions"]} sessions). They share NO date. '
            "The ledger is evidence of what the trader does; it cannot be row-level ground "
            "truth for these replay sessions.")
    return m


def main() -> None:
    m = measure()
    print(json.dumps(m, indent=2))
    try:
        assert_ledger_can_ground_truth_the_corpus(m)
        print("\nJOIN PERMITTED: the two sets overlap.")
    except RuntimeError as e:
        print(f"\nJOIN REFUSED: {e}")


if __name__ == "__main__":
    main()
