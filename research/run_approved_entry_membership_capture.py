"""MEMBERSHIP CAPTURE FOR R-A / R-B: fully-approved entries and their chosen TARGETS, 14 sessions.

The X-ray grant capture used for earlier repairs is the WRONG INSTRUMENT here: it records
SURVIVED_TO_RANKING, which is upstream of `build_and_classify`, so a target-layer repair cannot
move it and the guard would pass vacuously. R-A and R-B act on the destination universe, so the
object that can move is the set of FULLY-APPROVED entries and the target each one selected.

Keyed for membership on (session, entry_time, direction, setup) with the chosen target carried
beside it, so an approval that survives with a DIFFERENT target is visible as a change rather
than as an identity.
"""
import io
import json
import sys
from datetime import date, time as _time
from pathlib import Path

import pandas as pd

from research import current_mnq_strategy_v2_2_engine_final as old
from research import current_mnq_strategy_v2_4_engine as eng
from research import current_mnq_strategy_v2_4_exam_window as W
from research.current_mnq_strategy_v2_4_kernel import iter_actionable_candidates
from research.current_mnq_strategy_v2_4_frozen_replay_regrade import build_and_classify

DATA = Path("research/_mnq_v24_replay_lab_v3/data")
LOCK = Path("research/current_mnq_strategy_v2_2_data_lock.json")
MAN = Path("research/current_mnq_strategy_v2_4_frozen_replay_case_manifest_2026_08_20.json")

out_path = sys.argv[1] if len(sys.argv) > 1 else "approved_all14.json"
man = {c["session"]: c for c in json.load(io.open(MAN, encoding="utf-8"))["cases"]}

observed = old.download_pinned(DATA, include_tick=False)
old.verify_manifest(observed, json.loads(LOCK.read_text(encoding="utf-8")))

out = {}
total = 0
with W.trading_window(_time(8, 0)):
    env = old.prepare(old.load_csv(DATA / Path(old.DATA_FILES["5m"]).name),
                      old.load_csv(DATA / Path(old.DATA_FILES["1m"]).name))
    p = eng.Params()
    for session in sorted(man):
        dte = date.fromisoformat(session)
        end = pd.Timestamp(man[session]["replay_end"])
        rows = []
        for cand, actionable, _plan in iter_actionable_candidates(env, dte, p, as_of=end):
            ent = eng.core.one_minute_entry(env["one"], actionable, cand.direction, p)
            if ent is None:
                continue
            et, epx, _ = ent
            if et > end or et.time() > eng.core.LAST_ENTRY:
                continue
            picked, reason = build_and_classify(
                env["piv5"], env["full5"], env["h15"], et, p, env["pdm"], env["pwm"], dte,
                float(epx), cand.direction, cand.setup, cand.setup == "BRK5",
                piv15=env["piv15"], entry_location=cand.location,
                candidate_reason=cand.reason)
            if picked is None:
                continue
            rows.append({
                "key": [session, str(et), str(cand.direction), str(cand.setup)],
                "target": round(float(picked.executable_price), 2),
                "target_kind": str(getattr(picked, "kind", "")),
                "target_band": [float(picked.location.lo), float(picked.location.hi)],
                "path_reason": str(reason),
            })
        out[session] = rows
        total += len(rows)
        print(f"  {session}: {len(rows)} fully-approved entries")

io.open(out_path, "w", encoding="utf-8").write(json.dumps(out, indent=2))
print(f"TOTAL fully-approved entries across 14 sessions: {total}")
print(f"wrote {out_path}")
