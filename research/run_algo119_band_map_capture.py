#!/usr/bin/env python3
"""BAND GUARD, capture half — the pre-open zone map for the frozen sessions. DIAGNOSTIC ONLY.

ALGO-119 §5 / ALGO-120. This script is run TWICE with IDENTICAL code — once inside a read-only
`git archive` arena at the PRE-BAND pin, once at the head — and the two artifacts are diffed by
key. That is why the query lives here and not in the differ: a comparison whose two halves were
written separately is comparing two instruments as much as two trees.

IT PROPOSES NOTHING, SCORES NOTHING AND READS NO PnL. It records what the map contains.

The map anchor is `09:30` because that is what `candidate_xray.py:112` and `kernel.py` use to
build the pre-open map; the exam's 08:00 / 09:30 ARMS are a different question (the trading
window), and the arms are the exam's job, not this artifact's.

Run: PYTHONPATH=. python -m research.run_algo119_band_map_capture <out.json>
"""
from __future__ import annotations

import io
import json
import os
import sys
import time
from datetime import date
from pathlib import Path

import pandas as pd

from research import current_mnq_strategy_v2_2_engine_final as old
from research import current_mnq_strategy_v2_4_engine as v24
from research import current_mnq_strategy_v2_3_engine as prod
from research.current_mnq_strategy_v2_4_levels import build_entry_locations_v24
from research.current_mnq_strategy_v2_4_zone_lifecycle import origin_side

#: Absolute so the arena run reads the SAME pinned bars as the head run. A capture that
#: silently used a different data set would report a band change that was a data change.
ROOT = Path(os.environ.get("ALGO119_REPO_ROOT", ".")).resolve()
DATA = ROOT / "research/_mnq_v24_replay_lab_v3/data"
LOCK = ROOT / "research/current_mnq_strategy_v2_2_data_lock.json"
MANIFEST = ROOT / "research/current_mnq_strategy_v2_4_frozen_replay_case_manifest_2026_08_20.json"

SWING_SOURCE = "STRONG_SWING_DISPLACEMENT"


def _row(loc) -> dict:
    z = loc.zone
    return {
        "id": str(loc.id),
        "side": str(loc.side),
        # THE LIVE ROLE AND THE CREATION POLARITY ARE DIFFERENT FIELDS. `zone_lifecycle`
        # does `replace(zone, side=role)` on a break/flip, so `loc.side` is the CURRENT role
        # and the id keeps the original. Anything that reconstructs the band must use the
        # ORIGIN, which is what production draws it from. Measured: they disagree on real
        # zones, and joining on `side` silently drew the mirrored band.
        "origin_side": (None if z is None else str(origin_side(z))),
        "source": str(loc.source),
        "lo": float(loc.lo),
        "hi": float(loc.hi),
        "mid": float(loc.mid),
        "width": float(loc.hi) - float(loc.lo),
        "quality": float(loc.quality),
        "confluence": int(loc.confluence),
        "entry_authorized": bool(loc.entry_authorized),
        "close_away": (None if z is None else float(z.close_away)),
        "wick_quality": (None if z is None else float(z.wick_quality)),
        "displacement": (None if z is None else float(z.displacement)),
        "recency": (None if z is None else float(z.recency)),
        "state": (None if z is None else str(z.state)),
        "created": (None if z is None else z.created.isoformat()),
        "last_event": (None if z is None else z.last_event.isoformat()),
        "touches": (None if z is None else int(z.touches)),
        "compactness": (None if z is None else float(z.compactness)),
        "independence": (None if z is None else float(z.independence)),
    }


def main(argv: list[str]) -> int:
    out_path = Path(argv[1]) if len(argv) > 1 else Path("algo119_map_capture.json")
    t0 = time.perf_counter()

    manifest = json.load(io.open(MANIFEST, encoding="utf-8"))["cases"]
    sessions = [c["session"] for c in manifest]

    observed = old.download_pinned(DATA, include_tick=False)
    old.verify_manifest(observed, json.loads(LOCK.read_text(encoding="utf-8")))
    env = old.prepare(old.load_csv(DATA / Path(old.DATA_FILES["5m"]).name),
                      old.load_csv(DATA / Path(old.DATA_FILES["1m"]).name))
    p = v24.Params()

    per_session = {}
    for s in sessions:
        dte = date.fromisoformat(s)
        open_ts = pd.Timestamp(f"{dte} 09:30", tz=prod.core.TZ)
        locations, _zones = build_entry_locations_v24(env, dte, open_ts, p)
        rows = [_row(x) for x in locations]
        swing = [r for r in rows if r["source"] == SWING_SOURCE]
        per_session[s] = {
            "map_size_total": len(rows),
            "map_size_authorized": sum(1 for r in rows if r["entry_authorized"]),
            "swing_zones": len(swing),
            "swing_zones_authorized": sum(1 for r in swing if r["entry_authorized"]),
            "established_zones": len(rows) - len(swing),
            "rows": rows,
        }
        print(f"  {s}  total={len(rows):3d}  authorized={per_session[s]['map_size_authorized']:3d}"
              f"  swing={len(swing):3d}", flush=True)

    artifact = {
        "artifact": "ALGO119_BAND_MAP_CAPTURE",
        "status": "DIAGNOSTIC ONLY. Records the pre-open map. Proposes nothing, scores nothing.",
        "authority": "ALGO-119 §5 (guard at both pins, by key) and ALGO-120 (bucket partition)",
        "map_anchor": "09:30 session open, mirroring candidate_xray.py and kernel.py",
        "instrument": "build_entry_locations_v24",
        "repo_root": str(ROOT),
        "sessions": sessions,
        "per_session": per_session,
        "totals": {
            "map_size_total": sum(v["map_size_total"] for v in per_session.values()),
            "map_size_authorized": sum(v["map_size_authorized"] for v in per_session.values()),
            "swing_zones": sum(v["swing_zones"] for v in per_session.values()),
            "swing_zones_authorized": sum(v["swing_zones_authorized"] for v in per_session.values()),
        },
        "no_pnl": ("No PnL, realized outcome, winner/loser label or clean-edge result is read "
                   "anywhere in this artifact."),
        "elapsed_s": round(time.perf_counter() - t0, 2),
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    io.open(out_path, "w", encoding="utf-8", newline="\n").write(
        json.dumps(artifact, indent=2, sort_keys=True))
    print(f"wrote {out_path}  ({artifact['elapsed_s']}s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
