#!/usr/bin/env python3
"""ALGO-169 - CLEANROOM-v3 evaluation against the PRE-REGISTERED clauses. Committed before it ran.

PRE-REGISTERED BY ALGO-167 BEFORE v3 WAS WRITTEN, restated here verbatim so it cannot drift:
  1. coverage of his marked levels must exceed ITS OWN NULL by >= 2 sd
  2. median zone WIDTH and SHARE-OF-SESSION-RANGE reported in the SAME TABLE as coverage, always
  3. <= 5 zones per session
  ADVERSE BRANCH: mutual overlap may collapse the map to almost nothing, or leave it at chance.
  AT CHANCE IS THE MOST LIKELY OUTCOME and it is published as A FAILURE OF THE APPROACH, not as a
  reason for a fourth build.

Clause 2 is enforced structurally here: `_row()` is the ONLY way a coverage figure is printed, and
it cannot print one without also printing width and range share. A promise in prose is not a
control; this campaign has been burned by exactly that.

v1 and v2.4 are carried in the same table as reference arms, scored by the identical instrument.
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
import research.mnq_sr_cleanroom_v1 as CR1
import research.mnq_sr_cleanroom_v3 as CR3

core = prod.core
R = Path("research")
TRIALS, SEED = 4000, 11
SD_BAR = 2.0


def _ov(a, b, c, d):
    return not (b < c or d < a)


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
    return pd.Series(fr).median() if fr else float("nan")


def _row(name, sessions, widths, per_session_counts):
    """THE ONLY WAY A COVERAGE NUMBER IS PRINTED. It cannot omit width or range share."""
    obs = sum(1 for z, _, _, his in sessions for h in his
              if any(_ov(h["lo"], h["hi"], a, b) for a, b in z))
    n = sum(len(his) for _, _, _, his in sessions)
    random.seed(SEED)
    draws = []
    for _ in range(TRIALS):
        k = 0
        for zones, lo, hi, his in sessions:
            for _ in his:
                p = random.uniform(lo, hi)
                k += any(_ov(p, p + 0.25, a, b) for a, b in zones)
        draws.append(k)
    mu, sd = st.mean(draws), st.pstdev(draws)
    w = pd.Series(widths)
    dist = (obs - mu) / sd if sd else float("nan")
    return {
        "map": name,
        "median_width_pts": round(float(w.median()), 2) if len(w) else float("nan"),
        "share_of_session_range": f"{100*_range_share(sessions):.0f}%",
        "zones_per_session_mean": round(st.mean(per_session_counts), 2),
        "zones_per_session_max": max(per_session_counts),
        "covers": f"{obs} of {n}",
        "null_mean": round(mu, 1),
        "null_sd": round(sd, 1),
        "sd_above_null": round(dist, 2),
    }


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

    arms = {"CLEANROOM-v3 (mutual overlap)": ([], [], []),
            "CLEANROOM-v1 (transitive, RETRACTED)": ([], [], []),
            "v2.4": ([], [], [])}

    for c in cases:
        day = c["session"]
        his = labels.get(c["case_id"], {}).get("trader_zones") or []
        d5 = env["full5"]
        day5 = d5[(d5.index >= pd.Timestamp(f"{day} 00:00", tz=core.TZ)) &
                  (d5.index < pd.Timestamp(f"{day} 23:59", tz=core.TZ))]
        if day5.empty or not his:
            continue
        lo, hi = float(day5.low.min()), float(day5.high.max())
        asof = pd.Timestamp(f"{day} 09:30", tz=core.TZ)

        for name, zs in (
            ("CLEANROOM-v3 (mutual overlap)",
             [(z.lo, z.hi) for z in CR3.build_map(env["h15"], env["full5"], asof)]),
            ("CLEANROOM-v1 (transitive, RETRACTED)",
             [(z.lo, z.hi) for z in CR1.build_map(env["h15"], env["full5"], asof)]),
            ("v2.4",
             [(float(r["lo"]), float(r["hi"]))
              for r in pinned.get(day, {}).get("rows", []) if r.get("lo") is not None]),
        ):
            sess, wid, cnt = arms[name]
            cnt.append(len(zs))
            if zs:
                wid += [b - a for a, b in zs]
                sess.append((zs, lo, hi, his))

    rows = [_row(n, s, w, c) for n, (s, w, c) in arms.items() if s]
    df = pd.DataFrame(rows)
    print("\n=== ALGO-169 - CLEANROOM-v3, scored against the PRE-REGISTERED clauses ===")
    print(df.to_string(index=False))

    v3 = rows[0]
    print("\n--- VERDICT on v3, against clauses fixed before it was written ---")
    c3 = v3["zones_per_session_max"] <= 5
    c1 = v3["sd_above_null"] >= SD_BAR
    print(f"  clause 3  <= 5 zones/session        : max {v3['zones_per_session_max']}  "
          f"{'PASS' if c3 else 'FAIL'}")
    print(f"  clause 1  coverage >= +{SD_BAR} sd over null: {v3['sd_above_null']:+.2f} sd  "
          f"{'PASS' if c1 else 'FAIL'}")
    print(f"  clause 2  width + range share printed beside coverage: PASS (structural - `_row()` "
          f"cannot print coverage without them)")
    print(f"\n  OVERALL: {'PASS' if (c1 and c3) else 'FAIL'}")
    if not c1:
        print("  The pre-registered adverse branch fired. Published as a FAILURE OF THE APPROACH,")
        print("  not as a reason for a fourth build.")


if __name__ == "__main__":
    main()
