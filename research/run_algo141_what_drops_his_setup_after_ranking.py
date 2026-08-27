#!/usr/bin/env python3
"""WHAT DROPS A SURVIVING REJECTION BETWEEN RANKING AND THE TRADE? DIAGNOSTIC ONLY. BY KEY.

ALGO-140 item 2, run as ALGO-096's procedure rather than as a new method:
  * the EMITTER'S REASON FIELD, never the gate label
  * the DEEPEST gate reached, BY KEY - never by majority
  * a G-FORCED-TRUE CEILING to separate "genuinely refused" from "refused by one gate"
  * a RESIDUAL branch, required

THE LAYER IS EXACTLY THREE `continue`s in `_analysis_run_day`
(`current_mnq_strategy_v2_4_engine.py:43-60`), and they are the whole distance between a candidate
that survived ranking and a recorded trade:

    G1  core.one_minute_entry(...) is None            -> no fill
    G2  entry_time.time() > core.LAST_ENTRY           -> past the last entry time
    G3  build_and_classify(...) returns picked=None   -> NO TARGET, and its second return value
                                                        IS the emitter's reason string

NOTHING IS REIMPLEMENTED HERE. `iter_actionable_candidates`, `core.one_minute_entry` and
`build_and_classify` are the production functions, called in the production order, with their
return values recorded instead of discarded. `_analysis_run_day` throws `path_reason` away on a
`continue`; that string is the entire object this measurement exists to read.

THE CEILING IS A CONTROLLED EXPERIMENT IN THIS PROCESS ONLY. It sets the target policy's reward
floor to zero IN MEMORY and re-runs, to measure how many rejections the floor alone is holding
back. NOTHING IS WRITTEN TO DISK AND NO FILE IS MODIFIED. A ceiling is not a proposal: it bounds
what a repair could possibly recover, which is exactly what tells you whether the gate is worth
opening at all.

Run: PYTHONPATH=. python -m research.run_algo141_what_drops_his_setup_after_ranking
"""
from __future__ import annotations

import io
import json
import time
from collections import Counter
from datetime import date
from pathlib import Path

from research import current_mnq_strategy_v2_2_engine_final as old
from research import current_mnq_strategy_v2_4_engine as v24
from research import current_mnq_strategy_v2_4_target_policy as pol
from research.current_mnq_strategy_v2_4_kernel import iter_actionable_candidates
from research.current_mnq_strategy_v2_4_target_policy import build_and_classify

core = old
DATA = Path("research/_mnq_v24_replay_lab_v3/data")
LOCK = Path("research/current_mnq_strategy_v2_2_data_lock.json")
MANIFEST = Path("research/current_mnq_strategy_v2_4_frozen_replay_case_manifest_2026_08_20.json")
OUT = Path("research/current_mnq_strategy_v2_4_algo141_what_drops_his_setup.json")


def _walk(env, dte, p):
    """The production loop, with every return value recorded instead of discarded."""
    full5, one, h15 = env["full5"], env["one"], env["h15"]
    out = []
    for cand, actionable, plan in iter_actionable_candidates(env, dte, p, as_of=None):
        rec = {"setup": cand.setup, "direction": cand.direction,
               "signal_time": str(cand.signal_time), "confirmed_time": str(cand.confirmed_time),
               "location_id": str(cand.location.id),
               "location_source": str(cand.location.source),
               "candidate_reason": str(cand.reason)}
        ent = core.one_minute_entry(one, actionable, cand.direction, p)
        if ent is None:
            rec.update(deepest_gate="G1_NO_FILL", emitter_reason=None, became_the_trade=False)
            out.append(rec); continue
        entry_time, entry, _raw = ent
        rec["entry_time"] = str(entry_time)
        if entry_time.time() > core.LAST_ENTRY:
            rec.update(deepest_gate="G2_PAST_LAST_ENTRY", emitter_reason=None,
                       became_the_trade=False)
            out.append(rec); continue
        picked, path_reason = build_and_classify(
            env["piv5"], full5, h15, entry_time, p, env["pdm"], env["pwm"], dte,
            entry, cand.direction, cand.setup, cand.setup == "BRK5",
            piv15=env["piv15"], entry_location=cand.location, candidate_reason=cand.reason,
        )
        if picked is None:
            rec.update(deepest_gate="G3_NO_TARGET", emitter_reason=str(path_reason),
                       became_the_trade=False)
            out.append(rec); continue
        rec.update(deepest_gate="REACHED_THE_TRADE", emitter_reason=str(path_reason),
                   became_the_trade=True,
                   target_source=str(picked.location.source),
                   target_points=abs(float(picked.executable_price) - float(entry)))
        out.append(rec)
        break                     # `_analysis_run_day` returns here; the session is decided
    return out


def main() -> int:
    t0 = time.perf_counter()
    sessions = [c["session"] for c in json.load(io.open(MANIFEST, encoding="utf-8"))["cases"]]
    old.verify_manifest(old.download_pinned(DATA, include_tick=False),
                        json.loads(LOCK.read_text(encoding="utf-8")))
    env = old.prepare(old.load_csv(DATA / Path(old.DATA_FILES["5m"]).name),
                      old.load_csv(DATA / Path(old.DATA_FILES["1m"]).name))
    p = v24.Params()

    per_session, rev_gates, all_reasons = {}, Counter(), Counter()
    for s in sessions:
        walk = _walk(env, date.fromisoformat(s), p)
        revs = [r for r in walk if r["setup"] == "REV"]
        for r in revs:
            rev_gates[r["deepest_gate"]] += 1
            if r.get("emitter_reason"):
                all_reasons[str(r["emitter_reason"]).split(":")[0]] += 1
        traded = next((r for r in walk if r["became_the_trade"]), None)
        per_session[s] = {
            "candidates_walked": len(walk),
            "rejection_candidates": len(revs),
            "the_trade": ({"setup": traded["setup"], "entry_time": traded.get("entry_time"),
                           "location_source": traded["location_source"]} if traded else None),
            "rejections_that_died_at": dict(Counter(r["deepest_gate"] for r in revs)),
            "rows": walk,
        }
        print(f"  {s}  walked={len(walk):3d}  REV={len(revs):3d}  "
              f"trade={(traded or {}).get('setup', 'NONE'):5s}  "
              f"REV died at {dict(Counter(r['deepest_gate'] for r in revs))}", flush=True)

    # ── THE CEILING. In-memory only; nothing is written and no file is modified. ──
    floor_was = pol.TP_GAP_REFERENCE_USD
    pol.TP_GAP_REFERENCE_USD = 0.0
    ceiling = {}
    try:
        for s in sessions:
            walk = _walk(env, date.fromisoformat(s), p)
            traded = next((r for r in walk if r["became_the_trade"]), None)
            ceiling[s] = {"setup": (traded or {}).get("setup"),
                          "entry_time": (traded or {}).get("entry_time")}
            print(f"  [ceiling] {s}  trade={(traded or {}).get('setup','NONE')}", flush=True)
    finally:
        pol.TP_GAP_REFERENCE_USD = floor_was

    base_rev = sum(1 for v in per_session.values()
                   if (v["the_trade"] or {}).get("setup") == "REV")
    ceil_rev = sum(1 for v in ceiling.values() if v.get("setup") == "REV")
    artifact = {
        "artifact": "ALGO141_WHAT_DROPS_HIS_SETUP_AFTER_RANKING",
        "status": "DIAGNOSTIC ONLY. Records what the production functions return. Derives "
                  "nothing, proposes nothing, changes no file.",
        "authority": "ALGO-140 item 2, run as ALGO-096's procedure",
        "the_layer": "current_mnq_strategy_v2_4_engine.py:43-60 - three continues: G1 no fill, "
                     "G2 past LAST_ENTRY, G3 no target",
        "rejections_by_deepest_gate_BY_KEY": dict(rev_gates),
        "emitter_reason_families_on_refused_rejections": dict(all_reasons),
        "sessions_whose_trade_is_a_REJECTION": {"as_built": base_rev,
                                                "with_the_reward_floor_at_zero": ceil_rev},
        "ceiling_note": ("THE CEILING IS NOT A PROPOSAL. The floor is his own taught rule and is "
                         "untouched on disk. The number bounds what opening that one gate could "
                         "possibly recover - no more."),
        "per_session": per_session,
        "ceiling_per_session": ceiling,
        "no_pnl": "No PnL, realized outcome, winner/loser label or clean-edge result decided "
                  "anything here; net_pnl is never read.",
        "elapsed_s": round(time.perf_counter() - t0, 2),
    }
    io.open(OUT, "w", encoding="utf-8", newline="\n").write(
        json.dumps(artifact, indent=2, sort_keys=True))
    print(f"\nREJECTIONS BY DEEPEST GATE (by key): {dict(rev_gates)}")
    print(f"EMITTER REASON FAMILIES: {dict(all_reasons)}")
    print(f"SESSIONS TRADING A REJECTION: as-built {base_rev}  |  floor at zero {ceil_rev}")
    print(f"wrote {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
