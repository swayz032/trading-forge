"""v4 §3-1B — UNLOCK-DISTANCE RANKER (driver).  AR-427, repaired in AR-429.

All computation lives in `unlock_ranker_core.py` so the committed determinism
test (`test_unlock_ranker_determinism.py`) guards THE SHIPPED CODE rather than a
re-implementation of it.

WHAT CHANGED FROM THE AR-427 VERSION, and why (R-451 §4b, R-452, R-453):
  * `spec` is now a canonical, GROUP-DERIVED label. The old `rows[0]["name"]`
    was first-encountered-wins over JSON row order — item six on R-452's list of
    order-dependent selection patterns, found inside this instrument (AR-428 §1).
  * the cumulative chain is EXHAUSTIVE, not greedy. The AR-427 script's greedy
    was deterministic (it sorted its ties) but stably SUBOPTIMAL: it emitted
    2·5·9·13·17·24·31·37·40 where the true optimum is 2·5·9·13·19·25·31·37·40.
    The acceptance gate in AR-427 §1 was passed by the separate exhaustive audit,
    not by this script; that split is closed and there is now one instrument.

USAGE
    POP120_CENSUS=... POP120_CLASSIFIED=... python unlock_distance_ranker.py [outdir]

The census payload is NOT committed — it is a snapshot of live operator data.
Its provenance, hashes and retention live in
`CENSUS-REPRODUCIBILITY-MANIFEST-2026-07-29.md`.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import unlock_ranker_core as core  # noqa: E402

REPLICATION = 3          # POP-120-LIVE: 40 videos x 3 markets


def main():
    census = os.environ.get("POP120_CENSUS")
    classified = os.environ.get("POP120_CLASSIFIED")
    if not (census and classified):
        raise SystemExit("set POP120_CENSUS and POP120_CLASSIFIED (see the manifest)")
    outdir = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.abspath(__file__))

    videos, meta = core.load_frozen(census, classified)
    print(f"backtests_total = {meta['backtests_total']}   "
          f"rows = {meta['rows_with_compiled_spec']}   videos = {len(videos)}")
    print(f"spec-label status counts = {meta['spec_label_status_counts']}")

    groups = {v: d["row_names"] for v, d in videos.items()}
    residual = core.canonicalization_report(groups)
    print(f"spec-label RESIDUAL cases (flagged, never silently stripped) = {len(residual)}")
    for key, names, label, status in residual:
        print(f"   {key}  {status}  -> {label}   from {names}")

    alone = core.each_class_alone(videos, REPLICATION)
    chain = core.optimal_chain(videos, REPLICATION)
    ranking = core.rank_specs(videos)

    print("\nEACH CLASS ALONE:")
    for e in alone:
        print(f"  {e['remediation_class']:48s} videos={e['videos_clean']:2d} "
              f"strategies={e['strategies_clean']:3d}")
    print("\nEXHAUSTIVE BEST-k CHAIN:")
    for e in chain:
        print(f"  k={e['k']}  videos={e['videos_clean']:2d}  strategies={e['strategies_clean']:3d}"
              f"   witness={','.join(c.split('_')[0] for c in e['witness'])}")

    print("\nRANKING:")
    print(f"{'#':>2} {'video':12s} {'dist':>4s} {'resid':>5s} {'C8':>3s} {'tot':>4s} "
          f"{'residual':22s} spec")
    for i, r in enumerate(ranking, 1):
        print(f"{i:2d} {r['video']:12s} {r['distance']:4d} {r['residual_conditions']:5d} "
              f"{r['fixed_class_conditions']:3d} {r['total_conditions']:4d} "
              f"{','.join(r['residual_classes']) or '-':22s} {r['spec']}")

    payload = {"population": {"videos": len(videos),
                              "rows": meta["rows_with_compiled_spec"],
                              "replication_factor": REPLICATION,
                              "backtests_total": meta["backtests_total"]},
               "spec_label_status_counts": meta["spec_label_status_counts"],
               "each_class_alone": alone,
               "optimal_chain": chain,
               "ranking": ranking}
    out = os.path.join(outdir, "unlock-distance-rank-2026-07-29.json")
    with open(out, "w", encoding="utf-8") as fh:
        fh.write(core.serialize(payload))
    print(f"\nwrote {out}")


if __name__ == "__main__":
    main()
