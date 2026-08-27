"""MEMBERSHIP CAPTURE FOR R-A / R-B: fully-approved entries and their chosen TARGETS, 14 sessions.

The X-ray grant capture used for earlier repairs is the WRONG INSTRUMENT here: it records
SURVIVED_TO_RANKING, which is upstream of `build_and_classify`, so a target-layer repair cannot
move it and the guard would pass vacuously. R-A and R-B act on the destination universe, so the
object that can move is the set of FULLY-APPROVED entries and the target each one selected.

Keyed for membership on (session, entry_time, direction, setup) with the chosen target carried
beside it, so an approval that survives with a DIFFERENT target is visible as a change rather
than as an identity.
"""
import hashlib
import io
import json
import os
import sys
from datetime import date, datetime, time as _time
from pathlib import Path

import pandas as pd

from research import current_mnq_strategy_v2_2_engine_final as old
from research import current_mnq_strategy_v2_4_engine as eng
from research import current_mnq_strategy_v2_4_exam_window as W
from research.current_mnq_strategy_v2_4_kernel import iter_actionable_candidates
from research.current_mnq_strategy_v2_4_frozen_replay_regrade import build_and_classify
from research.current_mnq_strategy_v2_4_zone_lifecycle import zone_state_at_v24

DATA = Path("research/_mnq_v24_replay_lab_v3/data")
LOCK = Path("research/current_mnq_strategy_v2_2_data_lock.json")
MAN = Path("research/current_mnq_strategy_v2_4_frozen_replay_case_manifest_2026_08_20.json")

out_path = sys.argv[1] if len(sys.argv) > 1 else "approved_all14.json"
# ARM PIN, ALGO-096 §5: the capture is required "at BOTH pins". The arm time was hard-coded
# to 08:00; it is now argv[2] and DEFAULTS to 08:00, so every existing invocation is
# byte-for-byte behaviour-preserving and only an explicit second argument moves the pin.
_arm = sys.argv[2] if len(sys.argv) > 2 else "08:00"
ARM = _time(*(int(x) for x in _arm.split(":")))
man = {c["session"]: c for c in json.load(io.open(MAN, encoding="utf-8"))["cases"]}

observed = old.download_pinned(DATA, include_tick=False)
old.verify_manifest(observed, json.loads(LOCK.read_text(encoding="utf-8")))

# F-3 (ALGO-100A): a RUN STAMP on the artifact itself. Two errors this campaign already
# made would have been caught by it - an artifact produced by an OLDER build of this
# instrument was described as "the same script at two commits" (ALGO-100A claim 8), and
# two arms were told apart only by their filenames. The stamp records WHICH build wrote
# the file, not just which pin it used.
out = {
    "__arm_pin__": _arm,
    "__run_stamp__": {
        "written_at": datetime.now().astimezone().isoformat(),
        "instrument": os.path.basename(__file__),
        "instrument_sha256": hashlib.sha256(
            io.open(__file__, "rb").read()).hexdigest(),
        "field_schema_version": 2,
        "reader_note": (
            "keys wrapped in double underscores are METADATA, not sessions - strip "
            "every __dunder__ key before iterating sessions, or the count silently "
            "gains a row"),
    },
}
total = 0
with W.trading_window(ARM):
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
            # ENTRY-ZONE FIELDS, added under ALGO-098's instrument order. This capture keyed on
            # (session, entry_time, direction, setup) and carried only the TARGET, so ALGO-070
            # clauses (i) MATCHING family for the J3-classified interaction, (ii) taught story
            # of that family, and (iv) not Route A on a BROKEN zone were ALL UNANSWERABLE from
            # it - every one of them is a statement about the ENTRY zone, and the guard could
            # not see the layer its own ruling asked about (ALGO-085's law, from the other
            # side). The zone id, band, source, side, the story kind and every matched form,
            # and the zone STATE replayed at the bucket now travel with each approval, so the
            # clause walk is answerable from this artifact alone rather than by a join nobody
            # runs.
            loc = getattr(cand, "location", None)
            # ZONE STATE AT THE BUCKET, replayed causally the same way the kernel and the X-ray
            # replay it - `zone_state_at_v24` over bars STRICTLY BEFORE the bucket. This is the
            # field ALGO-070 clause (iv) ("not Route A on a BROKEN zone") needs, and it is
            # computed here rather than joined from the X-ray so the guard can answer the
            # clause on its own evidence.
            zstate = None
            if loc is not None and getattr(loc, "zone", None) is not None:
                try:
                    zstate = str(zone_state_at_v24(loc.zone, env["full5"],
                                                   et.floor("5min"), p).state)
                except Exception as exc:                          # noqa: BLE001
                    zstate = f"UNAVAILABLE:{type(exc).__name__}"
            elif loc is not None:
                zstate = "NO_ZONE_ON_LOCATION"
            story = getattr(cand, "story", None)
            rows.append({
                "key": [session, str(et), str(cand.direction), str(cand.setup)],
                "entry_location_id": (str(loc.id) if loc is not None else None),
                "entry_location_band": ([float(loc.lo), float(loc.hi)]
                                        if loc is not None else None),
                "entry_location_source": (str(getattr(loc, "source", ""))
                                          if loc is not None else None),
                "entry_location_side": (str(getattr(loc, "side", ""))
                                        if loc is not None else None),
                "candidate_reason": str(getattr(cand, "reason", "")),
                "story_kind": (str(getattr(story, "interaction", "") or "")
                               if story is not None else None),
                "story_all_kinds": (list(getattr(story, "all_kinds", ()) or ())
                                    if story is not None else None),
                "zone_state_at_bucket": zstate,
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
