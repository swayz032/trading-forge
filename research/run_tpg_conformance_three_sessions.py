#!/usr/bin/env python3
"""T / P / G SOURCE-TO-ENGINE CONFORMANCE for the three lost days. ALGO-067 §3. DIAGNOSTIC.

Three columns per session, and one verdict from the ALGO-067 taxonomy:

  T  the TAUGHT FORM he most plausibly traded, cited to ALGO-009's route contracts and the
     pinned operator screenshots (ALGO-050/051/052) - NEVER inferred from the outcome. Citing
     the form from what happened next is how a post-hoc story becomes a requirement.
  P  the REFUSING PREDICATE: its name, its executable line, what it actually tests, and whether
     its MAGNITUDE is taught or constructed.
  G  the candle GEOMETRY at his marked_time and at his entry clock, on his own timeframe.

VERDICTS (ALGO-067):
  MACHINE_CORRECT_PER_TEACHING     the refusal is faithful; then name the taught form he used
                                   instead, or TAUGHT_FORM_ABSENT_FROM_DERIVATION
  PREDICATE_MISSPECIFIED           the predicate refuses on an UNTAUGHT magnitude
  LIFECYCLE_ORDERING               the location was retired before the entry could form
  UNCLASSIFIED                     stated rather than forced

WHY "IS THE MAGNITUDE TAUGHT" IS THE HINGE. ALGO-064 established that this lane's quality
numbers are CONSTRUCTED: the frozen specs NAME body_frac / range_ratio / close_loc but carry no
citation and no values, and the numbers themselves live as `Params` defaults inherited from an
earlier engine generation (v2_2_engine.py:69-73). A predicate that refuses him on an untaught
magnitude is a different finding from one that refuses him on a taught SHAPE.

Run: PYTHONPATH=. python -m research.run_tpg_conformance_three_sessions
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

DIAGNOSTIC_ONLY = (
    "DIAGNOSTIC. Source-to-engine conformance. Repairs nothing, selects no rule, tunes no "
    "parameter. ALGO-067 section 3."
)

DATA = Path("research/_mnq_v24_replay_lab_v3/data")
LOCK = Path("research/current_mnq_strategy_v2_2_data_lock.json")
OUT = Path("research/current_mnq_strategy_v2_4_tpg_conformance_2026_08_23.json")

#: Where the magnitudes actually live. Named, so "untaught" is a citation and not an opinion.
MAGNITUDE_PROVENANCE = {
    "body_frac": "0.62 - research/current_mnq_strategy_v2_2_engine.py:69 (Params default). "
                 "NAMED in the frozen specs, NO citation, NO value in any spec. UNTAUGHT.",
    "close_loc": "0.78 - v2_2_engine.py:71 (Params default). Same status. UNTAUGHT.",
    "range_ratio": "1.25 - v2_2_engine.py:70 (Params default). Same status. UNTAUGHT.",
    "breakout_clear_atr": "0.05 - v2_2_engine.py:73 (Params default). Same status. UNTAUGHT.",
    "reject_wick": "0.35 - v2_2_engine.py:72 (Params default). Same status. UNTAUGHT.",
    "close_beyond_the_band": "NOT a magnitude - a DEFINITION. ALGO-009's Route B contract says "
                             "'ACTUAL FIRST BREAK PRINT/CLOSE', so requiring a completed CLOSE "
                             "beyond the band is TAUGHT.",
}

SESSIONS = {
    "2026-03-30": {
        "direction": "S", "role": "SUPPORT", "line": 23436.625, "interaction": "BREAK",
        "entry": "2026-03-30T09:41:00-04:00", "marked": "2026-03-30T09:35:00-04:00",
        "tf": "5m", "bars_from": "09:35", "bars_to": "09:45",
        "T_taught_form": {
            "form": "LATE-ARRIVAL MOMENTUM BREAKOUT of a key level, targeting the next zone",
            "citations": [
                "ALGO-051 operator verbatim: '...i seen a momentum/ momenteum candle breakout "
                "and i jumped in and targeted the next key zone'",
                "ALGO-009 ROUTE B contract: 'AUTHORIZED SR/FVG -> ACTUAL FIRST BREAK "
                "PRINT/CLOSE -> SETUP ONLY -> NEXT FORMING 5M EXTENDS THE FIRST BREAK CANDLE "
                "DIRECTIONAL EXTREME -> SUSTAINED FORCE -> ENTER'",
                "ALGO-009 ROUTE D contract: 'REAL INITIAL KEY-LEVEL TEST/REJECTION -> "
                "MEANINGFUL RESET AWAY -> RETURN/RETEST -> BREAKOUT ATTACK DEVELOPS'",
            ],
            "not_inferred_from_outcome": True,
        },
        "MEASURED_lifecycle_override": {
            "verdict": "LIFECYCLE_ORDERING",
            "why": (
                "MEASURED per bucket, and it overrides this module's own coarse verdict rule. "
                "At bucket 09:35 the covering zone S:...93755 (band 23432.11-23447.39) is "
                "ACTIVE_SUPPORT and NO completed close is beyond it - so "
                "NO_COMPLETED_PRINT_BEYOND_THE_ZONE is CORRECT there, the break has not "
                "happened yet. At bucket 09:40 a completed close beyond DOES exist (09:35 "
                "close 23424.50) but the zone is BROKEN and therefore INACTIVE, so "
                "kernel.py:210 drops it. THERE IS NO BUCKET AT WHICH THE ZONE IS BOTH ALIVE "
                "AND CARRIES A COMPLETED BREAK PRINT. Same root cause as 2026-03-31: the break "
                "retires the zone the break entry needs. The taught close-beyond definition is "
                "not what refused him - the ordering is."),
            "supersedes": (
                "my pre-registered rule 'a taught definition also refuses => "
                "MACHINE_CORRECT_PER_TEACHING' was too coarse: it read WHICH predicate refused "
                "without asking whether the zone was still alive at the bucket where that "
                "predicate could have passed. The rule is kept and its failure recorded rather "
                "than quietly rewritten."),
            "measured_buckets": {
                "09:35": {"zone_state": "ACTIVE_SUPPORT", "active": True,
                          "any_completed_close_beyond": False},
                "09:40": {"zone_state": "BROKEN", "active": False,
                          "any_completed_close_beyond": True,
                          "the_beyond_bar": "09:35 close 23424.50"},
            },
        },
        "P_refusing_predicates": [
            {"route": "C_PREBREAK_DISPLACEMENT",
             "refusal": "ORDINARY_MOMENTUM_IS_NOT_TRUE_DISPLACEMENT",
             "predicate": "is_true_displacement()",
             "executable_line": "research/current_mnq_strategy_v2_4_breakout_derivation.py:"
                                "110-123",
             "what_it_tests": "momentum (body_frac >= 0.62 AND close_loc >= 0.78) AND range "
                              ">= reference_range * range_ratio (1.25)",
             "magnitudes": ["body_frac", "close_loc", "range_ratio"],
             "magnitude_taught": False},
            {"route": "D_PREBREAK_RETEST_BREAKOUT",
             "refusal": "accepted_break=NO_COMPLETED_PRINT_BEYOND_THE_ZONE",
             "predicate": "_beyond()",
             "executable_line": "research/current_mnq_strategy_v2_4_breakout_derivation.py:"
                                "119-121",
             "what_it_tests": "a COMPLETED CLOSE past the band; a wick through is not a break",
             "magnitudes": ["close_beyond_the_band"],
             "magnitude_taught": True},
            {"route": "D_PREBREAK_RETEST_BREAKOUT",
             "refusal": "repeat_test=REPEAT_TEST_WITHOUT_A_REAL_PRIOR_TEST",
             "predicate": "prebreak_repeat_test()",
             "executable_line": "research/current_mnq_strategy_v2_4_breakout_derivation.py:"
                                "240-282",
             "what_it_tests": "a real prior test/rejection, a meaningful reset, then a true "
                              "return attack",
             "magnitudes": ["reject_wick", "body_frac", "close_loc"],
             "magnitude_taught": False},
        ],
    },
    "2026-04-06": {
        "direction": "S", "role": "RESISTANCE", "line": 24421.625, "interaction": "REJECT",
        "entry": "2026-04-06T10:04:00-04:00", "marked": "2026-04-06T09:52:00-04:00",
        "tf": "15m", "bars_from": "09:45", "bars_to": "10:15",
        "T_taught_form": {
            "form": "ZONE REJECTION then MOMENTUM CANDLES - the strategy's NAME mechanic",
            "citations": [
                "ALGO-052 operator verbatim: 'how price rejectec my key zone then momentum "
                "candles formed and i jumped in'",
                "ALGO-009 ROUTE A contract: 'AUTHORIZED SR/FVG -> REAL INTERACTION -> GENUINE "
                "REJECTION/CONTROL STORY -> DIRECTIONAL 5M MOMENTUM -> SUSTAINED CAUSAL FORCE'",
                "ALGO-009: 'A touch alone is never rejection authority.'",
            ],
            "not_inferred_from_outcome": True,
        },
        "P_refusing_predicates": [
            {"route": "A_NORMAL_REJECTION",
             "refusal": "TOUCH_WITHOUT_DIRECTIONAL_CONTROL",
             "predicate": "_control()",
             "executable_line": "research/current_mnq_strategy_v2_4_derivation.py:160-165",
             "what_it_tests": "for a SHORT: bearish AND body_frac >= 0.62 AND close_loc <= "
                              "1 - 0.78 = 0.22",
             "magnitudes": ["body_frac", "close_loc"],
             "magnitude_taught": False},
        ],
    },
}

ALREADY_VERDICTED = {
    "2026-03-31": {
        "verdict": "LIFECYCLE_ORDERING",
        "settled_by": "ALGO-067 §3, artifact "
                      "current_mnq_strategy_v2_4_zone_lifecycle_0331_vs_0414_2026_08_23.json, "
                      "ratified by the advisor at a036d4f6",
        "summary": "both covering zones are BROKEN and therefore INACTIVE at his entry bucket "
                   "09:45, while the control's zone is TESTED and ACTIVE at 09:35 and grants. "
                   "A decisive break retires the zone the break entry needs "
                   "(zone_lifecycle.py:81-83 -> v2_2_engine.py:135-141 -> kernel.py:210).",
        "open_semantic_question_NOT_folded_in": (
            "the zone oscillates BROKEN -> FLIPPED_RETEST -> BROKEN across four bars; whether a "
            "zone may re-activate and be re-broken within 15 minutes is recorded for ALGO-068 "
            "and is deliberately NOT part of this verdict"),
    },
}


def _geom(bar, line: float, role: str) -> dict:
    o, h, l, c = float(bar.open), float(bar.high), float(bar.low), float(bar.close)
    rng = h - l
    if role == "SUPPORT":
        pen, away = max(0.0, line - l), c - line
    else:
        pen, away = max(0.0, h - line), line - c
    return {
        "ohlc": [round(o, 2), round(h, 2), round(l, 2), round(c, 2)],
        "range": round(rng, 2),
        "body_frac": round(abs(c - o) / rng, 3) if rng > 0 else None,
        "close_loc": round((c - l) / rng, 3) if rng > 0 else None,
        "bullish": bool(c > o),
        "touched_the_line": bool(l <= line <= h),
        "penetration_points": round(pen, 2),
        "close_away_points": round(away, 2),
        "closed_beyond_the_line": bool((c < line) if role == "SUPPORT" else (c > line)),
    }


def main() -> int:
    t0 = time.perf_counter()
    observed = old.download_pinned(DATA, include_tick=False)
    old.verify_manifest(observed, json.loads(LOCK.read_text(encoding="utf-8")))

    rows = []
    with W.trading_window(W.BASELINE_ARM_START):
        env = old.prepare(old.load_csv(DATA / Path(old.DATA_FILES["5m"]).name),
                          old.load_csv(DATA / Path(old.DATA_FILES["1m"]).name))
        p = v24.Params()

        for session, spec in SESSIONS.items():
            bars = env["h15"] if spec["tf"].startswith("15") else env["full5"]
            tz = bars.index.tz
            lo_t = pd.Timestamp(f"{session} {spec['bars_from']}", tz=tz)
            hi_t = pd.Timestamp(f"{session} {spec['bars_to']}", tz=tz)
            window = bars[(bars.index >= lo_t) & (bars.index <= hi_t)]

            marked = pd.Timestamp(spec["marked"])
            entry = pd.Timestamp(spec["entry"])
            g_marked = _geom(bars[bars.index <= marked].iloc[-1], spec["line"], spec["role"])
            g_entry = _geom(bars[bars.index <= entry].iloc[-1], spec["line"], spec["role"])

            untaught = [pr for pr in spec["P_refusing_predicates"]
                        if not pr["magnitude_taught"]]
            taught_pr = [pr for pr in spec["P_refusing_predicates"] if pr["magnitude_taught"]]

            # THE VERDICT RULE, stated before the rows are read: a refusal resting ONLY on
            # untaught magnitudes is PREDICATE_MISSPECIFIED; one where a TAUGHT definition also
            # refuses cannot be blamed on a number, so the machine is correct per the teaching
            # and the question becomes which taught form he actually used.
            measured = spec.get("MEASURED_lifecycle_override")
            if measured:
                verdict = measured["verdict"]
                why = measured["why"]
            elif taught_pr and untaught:
                verdict = "MACHINE_CORRECT_PER_TEACHING"
                why = (f"a TAUGHT definition also refuses ({taught_pr[0]['refusal']} via "
                       f"{taught_pr[0]['predicate']}), so this refusal cannot be attributed to "
                       f"an untaught magnitude - though {len(untaught)} of the predicates do "
                       f"rest on untaught numbers")
            elif untaught and not taught_pr:
                verdict = "PREDICATE_MISSPECIFIED"
                why = ("every refusing predicate rests on UNTAUGHT magnitudes "
                       f"({sorted({m for pr in untaught for m in pr['magnitudes']})}); the "
                       "shape he traded is taught, the numbers refusing it are not")
            else:
                verdict = "UNCLASSIFIED"
                why = "the refusing predicates do not resolve to taught or untaught cleanly"

            rows.append({
                "session": session,
                "his_direction": spec["direction"],
                "selected_role": spec["role"],
                "selected_line": spec["line"],
                "J3_interaction": spec["interaction"],
                "T_taught_form": spec["T_taught_form"],
                "P_refusing_predicates": spec["P_refusing_predicates"],
                "P_magnitude_provenance": {
                    m: MAGNITUDE_PROVENANCE.get(
                        m, "PROVENANCE NOT RECORDED - treat as UNTAUGHT until cited")
                    for pr in spec["P_refusing_predicates"] for m in pr["magnitudes"]},
                "G_at_marked_time": {"clock": str(marked), **g_marked},
                "G_at_entry_clock": {"clock": str(entry), **g_entry},
                "G_window": [{"clock": str(t), **_geom(window.loc[t], spec["line"],
                                                       spec["role"])}
                             for t in window.index],
                "VERDICT": verdict,
                "why": why,
            })

    for session, block in ALREADY_VERDICTED.items():
        rows.append({"session": session, "VERDICT": block["verdict"],
                     "why": block["summary"], "settled_by": block["settled_by"],
                     "open_semantic_question_NOT_folded_in":
                         block["open_semantic_question_NOT_folded_in"]})

    out = {
        "artifact": "TPG_CONFORMANCE_THREE_SESSIONS",
        "status": DIAGNOSTIC_ONLY,
        "authority": "ALGO-067 section 3",
        "produced": "2026-08-23",
        "taxonomy": ["MACHINE_CORRECT_PER_TEACHING", "PREDICATE_MISSPECIFIED",
                     "LIFECYCLE_ORDERING", "UNCLASSIFIED"],
        "verdict_rule_stated_before_the_rows": (
            "a refusal resting ONLY on untaught magnitudes is PREDICATE_MISSPECIFIED; a refusal "
            "where a TAUGHT definition also refuses is MACHINE_CORRECT_PER_TEACHING, because it "
            "cannot be attributed to a number nobody taught"),
        "magnitude_provenance": MAGNITUDE_PROVENANCE,
        "rows": rows,
        "repairs": "NONE. ALGO-068 rules all three together.",
        "runtime_seconds": round(time.perf_counter() - t0, 2),
        "no_pnl": ("No PnL, realized outcome, winner/loser label or clean-edge result "
                   "participated in any decision in this diagnostic."),
    }
    OUT.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    for r in rows:
        print(f"\n=== {r['session']}  ->  {r['VERDICT']} ===")
        if "T_taught_form" in r:
            print(f"  T: {r['T_taught_form']['form']}")
            print(f"  P: " + "; ".join(
                f"{pr['refusal']} [{pr['predicate']}, magnitude_taught="
                f"{pr['magnitude_taught']}]" for pr in r["P_refusing_predicates"]))
            gm, ge = r["G_at_marked_time"], r["G_at_entry_clock"]
            print(f"  G marked {gm['clock'][11:16]}: body {gm['body_frac']} "
                  f"close_loc {gm['close_loc']} touched={gm['touched_the_line']} "
                  f"pen {gm['penetration_points']} away {gm['close_away_points']}")
            print(f"  G entry  {ge['clock'][11:16]}: body {ge['body_frac']} "
                  f"close_loc {ge['close_loc']} touched={ge['touched_the_line']} "
                  f"beyond={ge['closed_beyond_the_line']}")
        print(f"  why: {r['why']}")
    print(f"\nwrote {OUT}")
    return 0


if __name__ == "__main__":
    with single_writer(OUT, purpose=__spec__.name if __spec__ else __file__):
        raise SystemExit(main())
