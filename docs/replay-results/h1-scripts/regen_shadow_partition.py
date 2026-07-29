#!/usr/bin/env python3
"""Regenerate the shadow-evaluation DEV / HOLDOUT partition MECHANICALLY.

R-459 step (2). The published DEV-14 list in
docs/designs/SHADOW-EVAL-FREEZE-AND-RESULTS-2026-07-29.md was wrong in four
places while claiming to be "derived mechanically from the split file, not
hand-listed" (AR-444 §3). This is the instrument that emits it, so no list is
ever typed again.

TWO INDEPENDENT PATHS, cross-checked against each other:
  PATH A  the run's own output   -- shadow_rows.json `pop` labels
  PATH B  the stated derivation  -- re-applying the harness's own line 11
                                    regex to the split file's rules_design_keys,
                                    intersected with the run population

HOLDOUT is always emitted as the COMPLEMENT of DEV over the population; it is
never enumerated separately, because two hand-maintained complementary lists is
how they drift apart.

FAILS LOUD. Every input is pinned by sha256 and a mismatch raises. A missing
input raises. Nothing is defaulted, nothing is skipped -- a guard that cannot
go red is not a guard.
"""

import hashlib
import json
import re
import sys

# ---------------------------------------------------------------- pinned inputs
RETENTION = (
    r"C:/Users/tonio/Projects/trading-forge/backups/h1-shadow-eval/"
    r"shadow-eval-edaa0c14"
)
SPLIT = (
    r"C:/Users/tonio/Projects/trading-forge/trading-forge/.claude/worktrees/"
    r"extraction-100/docs/replay-results/corpus-v3-heldout-split-2026-07-05.json"
)
CENSUS = (
    r"C:/Users/tonio/Projects/trading-forge/backups/h1-census/"
    r"unknown-dbtime-ad4335f0/pop120_census.json"
)

PINS = {
    f"{RETENTION}/shadow_rows.json":
        "edaa0c1473b7d28173ddcfc43b6495ed51155b09881975f60e085fb5a643ca51",
    # the harness itself -- pinned by SHADOW-EVAL-FREEZE-AND-RESULTS-2026-07-29.md
    f"{RETENTION}/shadow.ts":
        "16654d173baf14b11caa25c6318ecbee3fcb6417cc68fe4fada153ba8fa77635",
    # the partition source -- pinned by the same freeze table
    SPLIT:
        "9981660ba5e95d2ef3137c0c9db9a11018c96719011cb3ad2a7854cf1ac3d4e5",
    CENSUS:
        "ad4335f0cdf8b3b9e2b9987b4497ea60cebf07cac6fa2aae0a4b6adfc30a413c",
}

# The harness's own video-extraction regex, shadow.ts line 11, copied verbatim.
# Ported rather than reinvented: a second implementation of the derivation is
# exactly the second path that let the published list drift.
V11 = re.compile(r"[A-Za-z0-9_-]{11}")


def read_pinned(path: str) -> bytes:
    """Read a file and refuse to continue unless it is the pinned object."""
    try:
        blob = open(path, "rb").read()
    except OSError as exc:
        raise SystemExit(f"FAIL-LOUD: pinned input unreadable: {path}\n  {exc}")
    got = hashlib.sha256(blob).hexdigest()
    want = PINS[path]
    if got != want:
        raise SystemExit(
            "FAIL-LOUD: pinned input changed -- refusing to emit a partition "
            f"from an object I cannot vouch for.\n  {path}\n"
            f"  expected {want}\n  actual   {got}"
        )
    return blob


def main() -> int:
    rows = json.loads(read_pinned(f"{RETENTION}/shadow_rows.json"))
    read_pinned(f"{RETENTION}/shadow.ts")  # integrity only; not parsed
    split = json.loads(read_pinned(SPLIT))
    census = json.loads(read_pinned(CENSUS))

    population = sorted({r["video"] for r in rows})
    census_videos = sorted({s["video"] for s in census["strategies"]})

    # ---- PATH A: what the run actually labelled -----------------------------
    dev_a = sorted({r["video"] for r in rows if r["pop"] == "DEV14"})

    # ---- PATH B: re-derive from the split file, the stated method -----------
    design = set()
    for key in split["rules_design_keys"]:
        m = V11.search(key)
        if not m:
            raise SystemExit(f"FAIL-LOUD: no video id in design key {key!r}")
        design.add(m.group(0))
    dev_b = sorted(v for v in population if v in design)

    # ---- the cross-check that makes either path believable ------------------
    if dev_a != dev_b:
        raise SystemExit(
            "FAIL-LOUD: the run's labels and the stated derivation DISAGREE.\n"
            f"  run-only:        {sorted(set(dev_a) - set(dev_b))}\n"
            f"  derivation-only: {sorted(set(dev_b) - set(dev_a))}"
        )

    dev = dev_a
    holdout = [v for v in population if v not in set(dev)]  # COMPLEMENT, always

    # ---- the population must be the census, or the split means nothing ------
    if population != census_videos:
        raise SystemExit(
            "FAIL-LOUD: run population != census population.\n"
            f"  in run not census: {[v for v in population if v not in census_videos]}\n"
            f"  in census not run: {[v for v in census_videos if v not in population]}"
        )

    print(f"POPULATION            {len(population)}  (== census, verified)")
    print(f"PARTITION             DEV-{len(dev)} / HOLDOUT-{len(holdout)}")
    print("PATH A (run labels) == PATH B (split-file derivation): YES")
    print()
    print(f"DEV-{len(dev)}:")
    for v in dev:
        print(f"  {v}")
    print()
    print(f"HOLDOUT-{len(holdout)} (emitted as the COMPLEMENT, never enumerated by hand):")
    for v in holdout:
        print(f"  {v}")
    print()

    # ---- the four names R-459 asked me to verify rather than adopt ----------
    print("R-459's four named videos, checked against the census MYSELF:")
    for vid, claim in (
        ("psH--oXkD8M", "OUT"),
        ("x1ydP8bC7OE", "OUT"),
        ("ktkqq7QsN9Q", "IN"),
        ("sVkmZklJDHI", "IN"),
    ):
        actual = "IN" if vid in dev else "OUT"
        print(
            f"  {vid:14s} ruling says {claim:3s} | emitted {actual:3s} | "
            f"in census: {'yes' if vid in census_videos else 'NO'} | "
            f"{'AGREE' if actual == claim else '*** DISAGREE ***'}"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
