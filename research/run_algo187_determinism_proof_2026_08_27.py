#!/usr/bin/env python3
"""ALGO-187 obligation 2 — PROVE DETERMINISM, by key, before any parallel run is trusted.

ALGO-185 §4: "Same session in two separate processes, compared BY KEY. Then one session inside an
N-way pool versus alone. Identical or the pool is refused."

WHAT IS COMPARED: a canonical digest of every actionable candidate the kernel yields for a session —
setup, direction, signal time, confirmed time, location id and location source. NOT a count. A count
survives a swap, and that law has already cost this campaign three separate corrections today.

WHY TWO SEPARATE PROCESSES AND NOT TWO CALLS IN ONE: a same-process repeat would share every import,
every module-level object and any warm cache, so agreement would be guaranteed by construction
rather than earned. Separate processes re-import everything, which is exactly what the pool does.

WHY THE POOL ARM IS SEPARATE FROM THE TWO-PROCESS ARM: two sequential processes prove the
computation is reproducible. Only the pool arm proves it is reproducible WHILE OTHER SESSIONS RUN
BESIDE IT — which is the thing actually being authorised.

VACUITY GUARD: a session that yields no candidates would compare equal trivially. Every arm asserts
its digest is non-empty before comparing.
"""
from __future__ import annotations

import hashlib
import json
import multiprocessing as mp
import time
from datetime import date
from pathlib import Path

DATA = Path("research/_mnq_v24_replay_lab_v3/data")
_ENV = {}


def _init():
    """One environment per worker process, exactly as the real parallel run would do."""
    from research import current_mnq_strategy_v2_2_engine_final as old
    from research import current_mnq_strategy_v2_3_engine as prod
    _ENV["env"] = old.prepare(old.load_csv(DATA / Path(old.DATA_FILES["5m"]).name),
                              old.load_csv(DATA / Path(old.DATA_FILES["1m"]).name))
    _ENV["p"] = prod.Params()


def digest(day: str) -> dict:
    """Canonical, order-preserving record of what the kernel yielded for one session."""
    from research import current_mnq_strategy_v2_4_kernel as K
    if "env" not in _ENV:
        _init()
    rows = []
    for cand, actionable, plan in K.iter_actionable_candidates(
            _ENV["env"], date.fromisoformat(day), _ENV["p"], as_of=None):
        rows.append([str(cand.setup), str(cand.direction), str(cand.signal_time),
                     str(cand.confirmed_time), str(cand.location.id),
                     str(cand.location.source), str(actionable),
                     str(getattr(plan, "primary", None)),
                     str(getattr(plan, "pm_structure", None))])
    blob = json.dumps(rows, sort_keys=True)
    return {"day": day, "n": len(rows), "rows": rows,
            "sha": hashlib.sha256(blob.encode()).hexdigest()}


def _one(day):
    return digest(day)


DAYS = ["2026-03-30", "2026-04-02", "2026-04-06", "2026-03-31"]


def main() -> None:
    print("ARM 1 - the SAME session in TWO SEPARATE PROCESSES, compared by key")
    with mp.Pool(1, initializer=_init) as pool:
        a = pool.apply(_one, ("2026-03-30",))
    with mp.Pool(1, initializer=_init) as pool:
        b = pool.apply(_one, ("2026-03-30",))
    assert a["n"] > 0, "the session yielded NO candidates - the comparison would be vacuous"
    print(f"  candidates: {a['n']} vs {b['n']}")
    print(f"  sha: {a['sha'][:16]} vs {b['sha'][:16]}")
    same_2p = a["rows"] == b["rows"]
    print(f"  IDENTICAL BY KEY: {same_2p}")
    if not same_2p:
        for i, (x, y) in enumerate(zip(a["rows"], b["rows"])):
            if x != y:
                print(f"    first difference at row {i}:\n      A {x}\n      B {y}")
                break

    print("\nARM 2 - solo runs versus the SAME sessions inside a 4-way pool")
    solo = {}
    t0 = time.time()
    for d in DAYS:
        with mp.Pool(1, initializer=_init) as pool:
            solo[d] = pool.apply(_one, (d,))
    t_solo = time.time() - t0

    t0 = time.time()
    with mp.Pool(4, initializer=_init) as pool:
        pooled = {r["day"]: r for r in pool.map(_one, DAYS)}
    t_pool = time.time() - t0

    ok = True
    for d in DAYS:
        s, q = solo[d], pooled[d]
        assert s["n"] > 0, f"{d} yielded NO candidates - vacuous"
        same = s["rows"] == q["rows"]
        ok &= same
        print(f"  {d}: solo n={s['n']:3d}  pooled n={q['n']:3d}  IDENTICAL BY KEY: {same}")
        if not same:
            for i, (x, y) in enumerate(zip(s["rows"], q["rows"])):
                if x != y:
                    print(f"      first difference at row {i}:\n        solo   {x}\n        pooled {y}")
                    break

    print(f"\n  wall-clock: {len(DAYS)} sessions sequentially {t_solo:.1f}s | in a 4-way pool "
          f"{t_pool:.1f}s | speedup {t_solo/max(t_pool,1e-9):.2f}x")
    print(f"\nVERDICT: {'DETERMINISM PROVEN - the pool may be used' if (same_2p and ok) else 'REFUSED - the pool is not the same computation'}")


if __name__ == "__main__":
    mp.freeze_support()
    main()
