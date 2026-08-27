#!/usr/bin/env python3
"""ALGO-166 - THE NULL CONTROL THAT ALGO-163 NEVER RAN, and that retracts its headline.

THE QUESTION NOBODY ASKED: when a map "covers 17 of his 28 marked levels", how many would it cover
if his levels were replaced by RANDOM prices? If the answer is also 17, the number was never about
his levels at all - it was about how wide the bands are.

It is 17.5.

This script computes, for each map, against ITS OWN bands:
  * the median band WIDTH, and the share of each session's own price range the map covers
  * the observed coverage of his marked levels
  * a null distribution: the same count of one-tick levels drawn uniformly from the session's
    range, 4,000 draws
  * the observed result's distance from that null, in sd

RESULT (see `mnq_sr_cleanroom_v1_RESULT.md`, retracted in place):
  CLEANROOM-v1  width 912.6 pts, 78 pct of range, 17 of 28, null mean 17.5  -> -0.27 sd, p=0.718
  v2.4          width  17.75 pts, 29 pct of range, 13 of 28, null mean  9.5  -> +1.43 sd, p=0.112
  The ranking REVERSES once each map is scored against its own null. `17 vs 13` was never
  like-for-like.

INSTRUMENT LIMIT, STATED: the null draws UNIFORMLY over each session's range. His levels are not
uniformly placed, so a null drawn from pivot locations would be a stricter test. It is not needed
to carry the conclusion - the width and range-coverage figures stand alone and use no null at all.

This is a MEASUREMENT script. It selects nothing and changes nothing.
"""
from __future__ import annotations

import io
import json
import random
import statistics as st
from pathlib import Path

import pandas as pd

from research import current_mnq_strategy_v2_2_engine_final as old
from research import current_mnq_strategy_v2_3_engine as prod
import research.mnq_sr_cleanroom_v1 as CR

core = prod.core
R = Path("research")
TRIALS = 4000
SEED = 11


def _ov(a_lo, a_hi, b_lo, b_hi):
    return not (a_hi < b_lo or b_hi < a_lo)


def _null(sessions, trials=TRIALS, seed=SEED):
    """Same number of one-tick levels, drawn uniformly from each session's own range."""
    random.seed(seed)
    out = []
    for _ in range(trials):
        k = 0
        for zones, lo, hi, his in sessions:
            for _ in his:
                p = random.uniform(lo, hi)
                k += any(_ov(p, p + 0.25, a, b) for a, b in zones)
        out.append(k)
    return out


def _range_share(sessions):
    fr = []
    for zones, lo, hi, _ in sessions:
        iv = sorted([(max(a, lo), min(b, hi)) for a, b in zones if b > lo and a < hi])
        merged = []
        for a, b in iv:
            if merged and a <= merged[-1][1]:
                merged[-1] = (merged[-1][0], max(merged[-1][1], b))
            else:
                merged.append((a, b))
        fr.append(sum(b - a for a, b in merged) / max(hi - lo, 1e-9))
    return pd.Series(fr).median()


def _report(name, sessions, widths):
    obs = sum(1 for z, _, _, his in sessions for h in his
              if any(_ov(h["lo"], h["hi"], a, b) for a, b in z))
    n = sum(len(his) for _, _, _, his in sessions)
    draws = _null(sessions)
    mu, sd = st.mean(draws), st.pstdev(draws)
    w = pd.Series(widths)
    print(f"\n=== {name} ===")
    print(f"  band WIDTH pts   median {w.median():8.2f}   mean {w.mean():8.2f}   max {w.max():.1f}")
    print(f"  share of each session's price range covered: {100*_range_share(sessions):.0f}%")
    print(f"  covers his levels: {obs} of {n}")
    print(f"  NULL ({TRIALS} draws): mean {mu:.1f}  sd {sd:.1f}  range {min(draws)}-{max(draws)}")
    print(f"  P(null >= {obs}) = {sum(1 for d in draws if d >= obs)/TRIALS:.3f}")
    print(f"  DISTANCE FROM CHANCE: {(obs-mu)/sd:+.2f} sd")


def main() -> None:
    env = old.prepare(
        old.load_csv(R / "_mnq_v24_replay_lab_v3/data" / Path(old.DATA_FILES["5m"]).name),
        old.load_csv(R / "_mnq_v24_replay_lab_v3/data" / Path(old.DATA_FILES["1m"]).name))
    cases = json.load(io.open(
        R / "current_mnq_strategy_v2_4_frozen_replay_case_manifest_2026_08_20.json",
        encoding="utf-8"))["cases"]
    labels = {r["case_id"]: r for r in json.load(io.open(
        R / "current_mnq_strategy_v2_4_replay_v3_labels_FROZEN.json", encoding="utf-8"))["labels"]}
    pinned = json.load(io.open(
        R / "current_mnq_strategy_v2_4_algo137_map_RELAND.json", encoding="utf-8"))["per_session"]

    cr_s, cr_w, v24_s, v24_w = [], [], [], []
    for c in cases:
        day = c["session"]
        his = labels.get(c["case_id"], {}).get("trader_zones") or []
        d5 = env["full5"]
        day5 = d5[(d5.index >= pd.Timestamp(f"{day} 00:00", tz=core.TZ)) &
                  (d5.index < pd.Timestamp(f"{day} 23:59", tz=core.TZ))]
        if day5.empty or not his:
            continue
        lo, hi = float(day5.low.min()), float(day5.high.max())

        z = CR.build_map(env["h15"], env["full5"], pd.Timestamp(f"{day} 09:30", tz=core.TZ))
        if z:
            cr_w += [x.hi - x.lo for x in z]
            cr_s.append(([(x.lo, x.hi) for x in z], lo, hi, his))

        rows = [r for r in pinned.get(day, {}).get("rows", []) if r.get("lo") is not None]
        if rows:
            zs = [(float(r["lo"]), float(r["hi"])) for r in rows]
            v24_w += [b - a for a, b in zs]
            v24_s.append((zs, lo, hi, his))

    _report("CLEANROOM-v1 (the map ALGO-163 said PASSED)", cr_s, cr_w)
    _report("v2.4 (the baseline it claimed to beat)", v24_s, v24_w)
    print("\nThe ranking REVERSES once each map is scored against its own null.")


if __name__ == "__main__":
    main()
