#!/usr/bin/env python3
"""Deduplicated X-ray episode census across the 14 frozen sessions — ALGO-011 §8.

Reports BOTH surfaces GPT requires: raw observation density AND deduplicated opportunity
density. Only the latter may support a statement about how permissive the authorization
layer is.

Run: PYTHONPATH=. python -m research.run_xray_episode_census
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
from research.current_mnq_strategy_v2_4_candidate_xray import xray_session
from research.current_mnq_strategy_v2_4_session_budget import (
    MAX_FULLY_APPROVED_EXECUTED_TRADES_PER_SESSION,
)
from research.current_mnq_strategy_v2_4_xray_episodes import (
    DIAGNOSTIC_ONLY,
    EPISODE_GAP_MINUTES,
    SENSITIVITY_GAPS,
    episodes_for_session,
)

DATA = Path("research/_mnq_v24_replay_lab_v3/data")
LOCK = Path("research/current_mnq_strategy_v2_2_data_lock.json")
SCORECARD = Path("research/current_mnq_strategy_v2_4_frozen_14_case_scorecard_2026_08_21.json")
OUT = Path("research/current_mnq_strategy_v2_4_xray_episode_census_2026_08_22.json")


def main() -> None:
    t0 = time.perf_counter()
    sc = json.load(io.open(SCORECARD, encoding="utf-8"))
    by_session = {c["session"]: c for c in sc["cases"]}

    observed = old.download_pinned(DATA, include_tick=False)
    old.verify_manifest(observed, json.loads(LOCK.read_text()))
    raw5 = old.load_csv(DATA / Path(old.DATA_FILES["5m"]).name)
    raw1 = old.load_csv(DATA / Path(old.DATA_FILES["1m"]).name)
    env = old.prepare(raw5, raw1)
    p = v24.Params()

    sessions = []
    for sess in sorted(by_session):
        xr = xray_session(env, date.fromisoformat(sess), p)
        e = episodes_for_session(xr)
        case = by_session[sess]
        e["trader_state"] = case["trader_state"]
        e["trader_label_censored"] = case["trader_label_censored"]
        e["bot_state_in_window"] = case["bot_state_in_window"]
        e["mismatch_class"] = case["mismatch_class"]
        sessions.append(e)
        print(f"  {sess}  raw={e['raw_survivor_observations']:4}  "
              f"episodes={e['deduplicated_episodes']:3}  "
              f"sens={e['episode_count_sensitivity_to_gap']}  {e['mismatch_class']}")

    raw_total = sum(s["raw_survivor_observations"] for s in sessions)
    ep_total = sum(s["deduplicated_episodes"] for s in sessions)
    trader_trades = sum(1 for c in sc["cases"] if c["trader_state"].startswith("ENTER"))
    uncensored = [s for s in sessions if not s["trader_label_censored"]]
    ep_unc = sum(s["deduplicated_episodes"] for s in uncensored)
    trades_unc = sum(1 for c in sc["cases"]
                     if not c["trader_label_censored"] and c["trader_state"].startswith("ENTER"))

    by_route = Counter()
    for s in sessions:
        for e in s["episodes"]:
            by_route[e["legal_route"]] += 1

    sens_totals = {str(g): sum(s["episode_count_sensitivity_to_gap"][str(g)] for s in sessions)
                   for g in SENSITIVITY_GAPS}

    out = {
        "artifact": "XRAY_EPISODE_CENSUS_14_SESSIONS",
        "authority": "ALGO-011 §8",
        "status": DIAGNOSTIC_ONLY,
        "produced": "2026-08-22",
        "grouping_rule": "(session, direction, legal_route, location_id), new episode when "
                         f"consecutive permission clocks are more than {EPISODE_GAP_MINUTES} "
                         "minutes apart",
        "retracted_claim": (
            "I previously reported 315 surviving observations against 7 trader trades as a "
            "'45:1 permission ratio'. That divided two incommensurable quantities: 315 counts "
            "per-decision-clock observations of possibly-persistent setups, 7 counts "
            "decisions. GPT ruled it inadmissible and the deduplicated figures below replace "
            "it."
        ),
        "one_trade_budget": MAX_FULLY_APPROVED_EXECUTED_TRADES_PER_SESSION,
        "totals": {
            "sessions": len(sessions),
            "raw_survivor_observations": raw_total,
            "deduplicated_episodes": ep_total,
            "observations_per_episode": round(raw_total / max(ep_total, 1), 1),
            "episodes_per_session": round(ep_total / max(len(sessions), 1), 1),
            "trader_trades_all_14": trader_trades,
            "episodes_uncensored_sessions": ep_unc,
            "trader_trades_uncensored": trades_unc,
            "episodes_per_trader_trade_uncensored":
                round(ep_unc / max(trades_unc, 1), 1),
            "runtime_seconds": round(time.perf_counter() - t0, 2),
        },
        "episode_count_sensitivity_to_gap_minutes": sens_totals,
        "episodes_by_legal_route": dict(sorted(by_route.items())),
        "sessions": sessions,
    }
    io.open(OUT, "w", encoding="utf-8", newline="\n").write(
        json.dumps(out, indent=2, ensure_ascii=False) + "\n")

    t = out["totals"]
    print(f"\nwrote {OUT}")
    print(f"  raw observations          : {t['raw_survivor_observations']}")
    print(f"  DEDUPLICATED EPISODES     : {t['deduplicated_episodes']}"
          f"  ({t['observations_per_episode']} observations each)")
    print(f"  episodes per session      : {t['episodes_per_session']}")
    print(f"  uncensored episodes/trade : {t['episodes_uncensored_sessions']} episodes vs "
          f"{t['trader_trades_uncensored']} trades = "
          f"{t['episodes_per_trader_trade_uncensored']}:1")
    print(f"  sensitivity to gap        : {sens_totals}")
    print(f"  by route                  : {out['episodes_by_legal_route']}")


if __name__ == "__main__":
    main()
