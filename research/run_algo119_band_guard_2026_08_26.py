#!/usr/bin/env python3
"""BAND GUARD, differ half — the two captures joined BY KEY, and every changed zone attributed
to exactly ONE bucket. DIAGNOSTIC ONLY.

ALGO-119 §5 ordered the guard at both pins by key. ALGO-120 §5 added the requirement this
module exists to satisfy: the buckets must PARTITION the changed set — every changed key in
exactly one bucket, and |a|+|b|+|c|+|d|+|e| == |changed|.

    (a) ESTABLISHED-OVERLAP DROP   the ruled band reaches an established zone the symmetric
                                   band did not                       `levels.py` §established
    (b) RANK DISPLACEMENT          a same-side zone with a better sort key now overlaps it and
                                   the greedy pass suppresses it      `levels.py` §chosen
    (c) LIFECYCLE                  `zone_state_at_v24` on the ruled band
    (d) QUALITY MOVE               a key present BEFORE and AFTER whose quality inputs moved
    (e) RESIDUAL                   required. A taxonomy with no residual must mis-file or fall
                                   silent, and both hide the finding.

BUCKET (d) IS A POSITIVE CONTROL ON THIS DESK'S OWN CLAIM, not a category we expect to use.
The refactor split the pivot->candle join out of `_pivot_close_away` so the band could use it.
If that refactor moved the quality score for ANY zone that exists at both pins, then the band
is not the only thing that changed and re-exam #5 is confounded. (d) MUST BE EMPTY.
ALGO-120: "If (d) is non-empty ... say so, fix it, re-run. Do not read the exam through it."

HOW A REMOVED ZONE IS ATTRIBUTED, AND WHY IT IS NOT A REIMPLEMENTATION. Every predicate below
is the PRODUCTION function called directly — `_pivot_source_bar`, `_rejection_band`,
`core.overlap`, `zone_state_at_v24`, `core.Zone`. Nothing re-derives what the module does; the
module is asked. The probe order MIRRORS the code's evaluation order, because a bucket assigned
out of order would name a later stage for a zone an earlier stage had already dropped.

NO PnL, realized outcome, winner/loser label or clean-edge result is read anywhere.

Run: PYTHONPATH=. python -m research.run_algo119_band_guard_2026_08_26
"""
from __future__ import annotations

import io
import json
import time
from datetime import date
from pathlib import Path

import pandas as pd

from research import current_mnq_strategy_v2_2_engine_final as old
from research import current_mnq_strategy_v2_3_engine as prod
from research import current_mnq_strategy_v2_4_engine as v24
from research import current_mnq_strategy_v2_4_levels as levels
from research.current_mnq_strategy_v2_4_fvg import active_15m_fvgs
from research.current_mnq_strategy_v2_4_zone_lifecycle import zone_state_at_v24

core = prod.core

BEFORE = Path("research/current_mnq_strategy_v2_4_algo119_map_BEFORE_a355507d.json")
AFTER = Path("research/current_mnq_strategy_v2_4_algo119_map_AFTER_2026_08_26.json")
OUT = Path("research/current_mnq_strategy_v2_4_algo119_band_guard_2026_08_26.json")

DATA = Path("research/_mnq_v24_replay_lab_v3/data")
LOCK = Path("research/current_mnq_strategy_v2_2_data_lock.json")

SWING = "STRONG_SWING_DISPLACEMENT"
#: ALGO-120 §5 defines (d) as "close_away or quality differs for a key present before AND
#: after". These are the inputs the BAND CANNOT REACH: `_quality` is computed from the pivot
#: row and the source bar, never from `lo`/`hi`. (d) is the assertion that the join refactor
#: moved none of them.
BAND_INDEPENDENT_QUALITY_FIELDS = ("quality", "close_away", "wick_quality", "displacement",
                                   "recency")
#: `confluence` is NOT one of them and the first version of this guard wrongly put it there,
#: firing (d) on 15 keys. Confluence is `core.overlap(lo, hi, fvg.lo, fvg.hi)` — a function OF
#: the band — so a wider band gains it by construction. Reporting it as a refactor artifact
#: would have convicted the refactor for doing exactly what the ruled shape is supposed to do.
#: It is a real SELECTION effect (confluence is a rank term at `levels.py` §chosen and at
#: `kernel.py:207`), it belongs to the change, and ALGO-120's five buckets do not name it — so
#: it goes to the RESIDUAL with its reason, which is what a residual bucket is for.
BAND_DEPENDENT_FIELDS = ("confluence",)


def _swings(cap: dict, session: str) -> dict:
    return {r["id"]: r for r in cap["per_session"][session]["rows"] if r["source"] == SWING}


def _established(cap: dict, session: str) -> list:
    return [r for r in cap["per_session"][session]["rows"] if r["source"] != SWING]


def _sort_key(r: dict):
    """`levels.py`'s own greedy order: (-quality, -confluence, mid, id)."""
    return (-float(r["quality"]), -int(r["confluence"]), float(r["mid"]), str(r["id"]))


def _ruled_band(env, row: dict):
    """The band the ruled construction draws for a zone recorded at the OTHER pin.

    Production functions only: the pivot's own source bar, then `_rejection_band`.

    IT USES `origin_side`, NOT `side`. `zone_lifecycle` overwrites `side` with the LIVE ROLE
    on a break or flip, so a zone created as support can be carrying `side="R"` by the time it
    reaches the map. The first version of this guard joined on `side` and drew the MIRRORED
    band for every flipped zone — it reported bands that did not contain their own pivot level,
    which is what the residual bucket surfaced.
    """
    h15 = env["h15"]
    probe = type("Row", (), {"t": pd.Timestamp(row["last_event"]),
                         "side": row["origin_side"]})()
    bar = levels._pivot_source_bar(h15, probe)
    return levels._rejection_band(bar, row["origin_side"])


def _rebuild_zone(row: dict, lo: float, hi: float):
    state = (core.ZoneState.ACTIVE_SUPPORT if row["origin_side"] == "S"
             else core.ZoneState.ACTIVE_RESISTANCE)
    return core.Zone(
        id=row["id"], side=row["origin_side"], lo=float(lo), hi=float(hi), mid=(lo + hi) / 2.0,
        touches=int(row["touches"]), wick_quality=float(row["wick_quality"]),
        close_away=float(row["close_away"]), displacement=float(row["displacement"]),
        compactness=float(row["compactness"]), independence=float(row["independence"]),
        recency=float(row["recency"]), quality=float(row["quality"]),
        created=pd.Timestamp(row["created"]), last_event=pd.Timestamp(row["last_event"]),
        source=SWING, confluence=int(row["confluence"]), state=state,
    )


def main() -> int:
    t0 = time.perf_counter()
    before = json.load(io.open(BEFORE, encoding="utf-8"))
    after = json.load(io.open(AFTER, encoding="utf-8"))
    assert before["sessions"] == after["sessions"], "the two captures cover different sessions"

    old.verify_manifest(old.download_pinned(DATA, include_tick=False),
                        json.loads(LOCK.read_text(encoding="utf-8")))
    env = old.prepare(old.load_csv(DATA / Path(old.DATA_FILES["5m"]).name),
                      old.load_csv(DATA / Path(old.DATA_FILES["1m"]).name))
    p = v24.Params()

    sessions_out, buckets = {}, {"a": [], "b": [], "c": [], "d": [], "e": []}
    for s in before["sessions"]:
        b_sw, a_sw = _swings(before, s), _swings(after, s)
        a_est = _established(after, s)
        full5 = env["full5"]
        open_ts = pd.Timestamp(f"{s} 09:30", tz=core.TZ)
        fvgs = active_15m_fvgs(env["h15"], open_ts)

        removed = [b_sw[k] for k in sorted(set(b_sw) - set(a_sw))]
        added = [a_sw[k] for k in sorted(set(a_sw) - set(b_sw))]
        both = sorted(set(b_sw) & set(a_sw))

        changed = []

        # (d) FIRST, and over the keys that survive at BOTH pins: the positive control.
        for k in both:
            moved = {f: [b_sw[k][f], a_sw[k][f]] for f in BAND_INDEPENDENT_QUALITY_FIELDS
                     if b_sw[k][f] != a_sw[k][f]}
            band_moved = {f: [b_sw[k][f], a_sw[k][f]] for f in BAND_DEPENDENT_FIELDS
                          if b_sw[k][f] != a_sw[k][f]}
            if moved:
                rec = {"session": s, "key": k, "direction": "PRESENT_BOTH", "bucket": "d",
                       "moved_fields": moved}
                buckets["d"].append(rec)
                changed.append(rec)
            elif band_moved:
                rec = {"session": s, "key": k, "direction": "PRESENT_BOTH", "bucket": "e",
                       "moved_fields": band_moved,
                       "why": "a BAND-DEPENDENT field moved on a key present at both pins. "
                              "`confluence` is an FVG overlap computed FROM lo/hi, so the "
                              "ruled band gains it by construction. It is not a quality move "
                              "and not a refactor artifact — and ALGO-120's five buckets do "
                              "not name this class, so the residual carries it."}
                buckets["e"].append(rec)
                changed.append(rec)

        for row in removed:
            k = row["id"]
            try:
                lo, hi = _ruled_band(env, row)
            except RuntimeError as exc:
                rec = {"session": s, "key": k, "direction": "REMOVED", "bucket": "e",
                       "why": f"the ruled band could not be drawn for this key: {exc}"}
                buckets["e"].append(rec)
                changed.append(rec)
                continue

            hit = next((x for x in a_est
                        if core.overlap(lo, hi, float(x["lo"]), float(x["hi"]), 0.0)), None)
            if hit is not None:
                rec = {"session": s, "key": k, "direction": "REMOVED", "bucket": "a",
                       "ruled_band": [lo, hi], "old_band": [row["lo"], row["hi"]],
                       "established_zone_reached": {
                           "id": hit["id"], "band": [hit["lo"], hit["hi"]],
                           "source": hit["source"]}}
                buckets["a"].append(rec)
                changed.append(rec)
                continue

            zone = zone_state_at_v24(_rebuild_zone(row, lo, hi), full5, open_ts, p)
            if not zone.active:
                rec = {"session": s, "key": k, "direction": "REMOVED", "bucket": "c",
                       "ruled_band": [lo, hi], "old_band": [row["lo"], row["hi"]],
                       "state_on_the_ruled_band": str(zone.state)}
                buckets["c"].append(rec)
                changed.append(rec)
                continue

            # PRODUCTION DEDUPS BY THE LIVE ROLE (`x.side == loc.side` over the post-lifecycle
            # zones), not by creation polarity — and confluence is recomputed from the RULED
            # band. Both are taken from the ruled-band objects here rather than from the BEFORE
            # capture, because a check that mirrors production approximately is a check that
            # convicts the wrong stage.
            live_role = str(zone.side)
            conf = int(any(core.overlap(lo, hi, float(f.lo), float(f.hi), 0.0) for f in fvgs))
            mine = {"quality": row["quality"], "confluence": conf,
                    "mid": (lo + hi) / 2.0, "id": k}
            winner = next(
                (w for w in sorted((x for x in a_sw.values() if x["side"] == live_role),
                                   key=_sort_key)
                 if core.overlap(lo, hi, float(w["lo"]), float(w["hi"]), 0.0)
                 and _sort_key(w) < _sort_key(mine)), None)
            if winner is not None:
                rec = {"session": s, "key": k, "direction": "REMOVED", "bucket": "b",
                       "ruled_band": [lo, hi], "old_band": [row["lo"], row["hi"]],
                       "live_role": live_role,
                       "suppressed_by": {"id": winner["id"], "band": [winner["lo"], winner["hi"]],
                                         "quality": winner["quality"],
                                         "confluence": winner["confluence"]},
                       "its_own_quality": row["quality"], "its_own_confluence": conf}
                buckets["b"].append(rec)
                changed.append(rec)
                continue

            rec = {"session": s, "key": k, "direction": "REMOVED", "bucket": "e",
                   "ruled_band": [lo, hi], "old_band": [row["lo"], row["hi"]],
                   "why": "no established overlap, active on the ruled band, no better-ranked "
                          "same-side overlap in the AFTER map"}
            buckets["e"].append(rec)
            changed.append(rec)

        for row in added:
            k = row["id"]
            rec = {"session": s, "key": k, "direction": "ADDED", "bucket": "c",
                   "ruled_band": [row["lo"], row["hi"]], "quality": row["quality"],
                   "why": "present only on the ruled band; the shape decided its survival "
                          "through the same stages, and it survived"}
            buckets["c"].append(rec)
            changed.append(rec)

        b_widths = [r["hi"] - r["lo"] for r in b_sw.values()]
        a_widths = [r["hi"] - r["lo"] for r in a_sw.values()]
        sessions_out[s] = {
            "map_size_total": [before["per_session"][s]["map_size_total"],
                               after["per_session"][s]["map_size_total"]],
            "map_size_authorized": [before["per_session"][s]["map_size_authorized"],
                                    after["per_session"][s]["map_size_authorized"]],
            "swing_zones": [len(b_sw), len(a_sw)],
            "established_zones": [before["per_session"][s]["established_zones"],
                                  after["per_session"][s]["established_zones"]],
            "swing_band_width_median": [
                round(float(pd.Series(b_widths).median()), 3) if b_widths else None,
                round(float(pd.Series(a_widths).median()), 3) if a_widths else None],
            "swing_band_width_min_max": [
                [round(min(b_widths), 3), round(max(b_widths), 3)] if b_widths else None,
                [round(min(a_widths), 3), round(max(a_widths), 3)] if a_widths else None],
            "keys_removed": len(removed),
            "keys_added": len(added),
            "keys_present_at_both_pins": len(both),
            "changed_keys": len(changed),
        }
        print(f"  {s}  map {sessions_out[s]['map_size_total'][0]:3d} -> "
              f"{sessions_out[s]['map_size_total'][1]:3d}   swing "
              f"{len(b_sw):3d} -> {len(a_sw):3d}   removed={len(removed):3d} added={len(added):2d}",
              flush=True)

    total_changed = sum(len(v) for v in buckets.values())
    keys = [f"{r['session']}|{r['key']}" for v in buckets.values() for r in v]
    partition_ok = len(keys) == len(set(keys))

    artifact = {
        "artifact": "ALGO119_BAND_GUARD",
        "status": "DIAGNOSTIC ONLY. Measures the ruled band against the symmetric one. "
                  "Proposes nothing, tunes nothing, reads no PnL.",
        "authority": "ALGO-119 §5 (both pins, by key) · ALGO-120 §5 (bucket partition)",
        "pins": {"BEFORE": before.get("repo_root") and "a355507d (read-only git archive arena)",
                 "AFTER": "working head"},
        "structural_observable_note": (
            "MAP SIZE IS REPORTED AS A STRUCTURAL OBSERVABLE AND CARRIES NO TARGET. No band "
            "was chosen, tuned or preferred because of what it does to this number."),
        "per_session": sessions_out,
        "totals": {
            "map_size_total": [before["totals"]["map_size_total"],
                               after["totals"]["map_size_total"]],
            "map_size_authorized": [before["totals"]["map_size_authorized"],
                                    after["totals"]["map_size_authorized"]],
            "swing_zones": [before["totals"]["swing_zones"], after["totals"]["swing_zones"]],
        },
        "bucket_counts": {k: len(v) for k, v in buckets.items()},
        "changed_keys_total": total_changed,
        "PARTITION_HOLDS": bool(partition_ok),
        "partition_check": (
            f"|a|+|b|+|c|+|d|+|e| = {total_changed}; distinct session|key = {len(set(keys))}; "
            "each changed key appears in exactly one bucket"),
        "BUCKET_D_POSITIVE_CONTROL": (
            "EMPTY — the join refactor moved no quality input for any zone present at both "
            "pins, so re-exam #5 reads the band and only the band"
            if not buckets["d"] else
            "NON-EMPTY — THE REFACTOR MOVED THE QUALITY SCORE. Re-exam #5 is CONFOUNDED and "
            "may not be read through it (ALGO-120 §5)."),
        "buckets": buckets,
        "no_pnl": ("No PnL, realized outcome, winner/loser label or clean-edge result is read "
                   "anywhere in this artifact."),
        "elapsed_s": round(time.perf_counter() - t0, 2),
    }
    io.open(OUT, "w", encoding="utf-8", newline="\n").write(
        json.dumps(artifact, indent=2, sort_keys=True))
    print(f"\nbuckets {artifact['bucket_counts']}  changed={total_changed}  "
          f"partition={partition_ok}")
    print(f"(d) {artifact['BUCKET_D_POSITIVE_CONTROL'][:60]}")
    print(f"wrote {OUT}  ({artifact['elapsed_s']}s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
