#!/usr/bin/env python3
"""Canonical frozen 14-case fidelity baseline — ALGO-007 §6.

Replaces the RELAYED 6/14 baseline inherited from a dead session with a measurement taken on
the exact current head. Emits the per-case scorecard fields ALGO-007 enumerated, plus the
aggregate diagnostics it requires.

HARD RAILS ENFORCED IN CODE, not in prose:
  * No realized PnL, winner/loser status, exit outcome or later-session information enters the
    comparison. The bot side comes from `regrade_frozen_case_windows`, whose own module
    docstring states it never reads exits, PnL, winners or clean OOS data.
  * The trader oracle is read-only. Nothing here tunes toward it.
  * Bot decision clocks come from the engine's causal output; this file never derives a clock
    from a final parent-5m bar.

Run:  PYTHONPATH=. python -m research.run_frozen_14_case_baseline
"""
from __future__ import annotations

import hashlib
import io
import json
import time
from pathlib import Path

import pandas as pd

from research import current_mnq_strategy_v2_2_engine_final as old
from research import current_mnq_strategy_v2_4_engine as v24
from research.current_mnq_strategy_v2_4_frozen_replay_regrade import (
    MANIFEST,
    regrade_frozen_case_windows,
)

DATA = Path("research/_mnq_v24_replay_lab_v3/data")
LOCK = Path("research/current_mnq_strategy_v2_2_data_lock.json")
LABELS = Path("C:/Users/tonio/Downloads/mnq_replay_v3_labels_FROZEN.json")
OUT = Path("research/current_mnq_strategy_v2_4_frozen_14_case_scorecard_2026_08_21.json")

# Fields that may never influence the comparison. Asserted, not assumed.
FORBIDDEN = ("pnl", "realized", "winner", "loser", "profit", "exit_outcome")


def _bot_state(row: dict) -> str:
    """Read the regrade's own `bot_action`. It already emits ENTER_LONG / ENTER_SHORT.

    A first version of this mapper looked for `side` / `direction`, found neither, and
    labelled all fourteen cases ENTER_UNKNOWN_DIRECTION - producing a headline 0/14 that was
    entirely an artifact of my field names, not a measurement of the strategy. Guarded below."""
    action = row.get("bot_action")
    if not action:
        raise RuntimeError(f"regrade row has no bot_action: {sorted(row)}")
    return str(action)


# A bot entry this far before the trader's clock is a different session event, not a
# competing read of the same decision.
EARLY_ENTRY_SECONDS = 15 * 60


def _mismatch_class(trader: str, bot: str, ws: str | None,
                    delta_s: float | None = None) -> str:
    if trader == bot:
        return "AGREE"
    entered = {"ENTER_LONG", "ENTER_SHORT"}
    if trader in entered and bot in entered:
        # Both entered, opposite ways - but WHEN matters. A first pass called these simply
        # OPPOSITE_DIRECTION; both instances turned out to be the bot entering 62 and 103
        # minutes EARLIER in the session. That is one-bullet consumption in the other
        # direction, not an inverted read of the trader's setup, and the two belong in
        # different defect queues.
        early = (delta_s is not None and delta_s <= -EARLY_ENTRY_SECONDS) or                 ws == "FIRST_A_PLUS_PRECEDES_OLD_REPLAY_WINDOW"
        return "EARLIER_OPPOSITE_ENTRY_CONSUMED_BULLET" if early else                "OPPOSITE_DIRECTION_AT_DECISION"
    if trader in entered and bot not in entered:
        return "MISSED_TRADER_ENTRY"
    if bot in entered and trader not in entered:
        if ws == "FIRST_A_PLUS_PRECEDES_OLD_REPLAY_WINDOW":
            return "BOT_ONLY_ENTRY_BEFORE_WINDOW"
        return "BOT_ONLY_ENTRY_IN_WINDOW"
    if {trader, bot} <= {"WAIT", "NO_TRADE", "NO_TRADE_THROUGH_WINDOW"}:
        return "WAIT_VS_NO_TRADE"
    return "OTHER"


def main() -> None:
    t0 = time.perf_counter()

    observed = old.download_pinned(DATA, include_tick=False)
    old.verify_manifest(observed, json.loads(LOCK.read_text()))
    raw5 = old.load_csv(DATA / Path(old.DATA_FILES["5m"]).name)
    raw1 = old.load_csv(DATA / Path(old.DATA_FILES["1m"]).name)
    dq = old.data_quality_gate(raw1, raw5)
    if dq["status"] != "PASS":
        raise RuntimeError("BASELINE_DATA_QUALITY_FAIL:" + "|".join(dq["issues"]))

    t_prep = time.perf_counter()
    env = old.prepare(raw5, raw1)
    p = v24.Params()
    prep_s = time.perf_counter() - t_prep

    t_re = time.perf_counter()
    regrade = regrade_frozen_case_windows(env, p)
    regrade_s = time.perf_counter() - t_re

    manifest = json.loads(Path(MANIFEST).read_text())
    windows = {c["case_id"]: c for c in manifest["cases"]}
    labels_raw = io.open(LABELS, "rb").read()
    labels = {x["case_id"]: x for x in json.loads(labels_raw.decode("utf-8"))["labels"]}
    bot_rows = {r["case_id"]: r for r in regrade["rows"]}

    if not (set(windows) == set(labels) == set(bot_rows)):
        raise RuntimeError("CASE_ID_SET_MISMATCH_ACROSS_MANIFEST_LABELS_AND_REGRADE")

    # Instrument guard: a mapper that silently fails to read the bot action produces a
    # headline score of 0/14 that looks like a devastating fidelity result and is actually a
    # typo. It happened on the first run of this file.
    unknown = [r["case_id"] for r in bot_rows.values() if not r.get("bot_action")]
    if unknown:
        raise RuntimeError(f"BOT_ACTION_MISSING_ON_{len(unknown)}_ROWS:{unknown[:3]}")

    # Earlier same-session bot entry consuming the daily bullet.
    by_session: dict[str, list[str]] = {}
    for cid, w in windows.items():
        by_session.setdefault(w["session"], []).append(cid)

    cases = []
    for cid in sorted(windows):
        w, lab, bot = windows[cid], labels[cid], bot_rows[cid]
        trader = lab.get("final_action") or "UNKNOWN"
        bstate = _bot_state(bot)
        ws = bot.get("window_status")

        bot_clock = bot.get("bot_entry_time")
        trader_clock = lab.get("first_entry_time")
        delta_s = None
        if bot_clock and trader_clock:
            delta_s = (pd.Timestamp(bot_clock) - pd.Timestamp(trader_clock)).total_seconds()

        bullet = None
        if ws == "FIRST_A_PLUS_PRECEDES_OLD_REPLAY_WINDOW":
            bullet = "BOT_ENTERED_BEFORE_THIS_WINDOW_IN_THE_SAME_SESSION"
        elif delta_s is not None and delta_s <= -EARLY_ENTRY_SECONDS:
            bullet = (f"BOT_ENTERED_{abs(int(delta_s // 60))}_MINUTES_BEFORE_THE_TRADER_"
                      f"IN_THE_SAME_SESSION")

        cases.append({
            "case_id": cid,
            "session": w["session"],
            "replay_window": {"start": w["replay_start"], "end": w["replay_end"]},
            "trader_state": trader,
            "bot_state": bstate,
            "bot_window_status": ws,
            "bot_decision_clock": bot_clock,
            "trader_decision_clock": trader_clock,
            "timing_delta_seconds": delta_s,
            "direction": {"trader": trader, "bot": bstate},
            "interaction_geometry": {
                "location_id": bot.get("bot_location_id"),
                "location_source": bot.get("bot_location_source"),
            },
            "entry_family_receipt": bot.get("bot_setup"),
            "story_receipt": bot.get("bot_reason"),
            "force_receipt": (
                "NOT_EMITTED_BY_THE_REGRADE — `_full_entry_decisions_through` yields no force "
                "field. The entry nevertheless passed `one_minute_entry`, which is the force "
                "gate, so force is IMPLIED by the entry existing but is not independently "
                "receipted here. Stated rather than invented."
            ),
            "trader_entry_force": lab.get("entry_force"),
            "first_tp": {
                "target_source": bot.get("bot_target_source"),
                "target_kind": bot.get("bot_target_kind"),
                "raw_price": bot.get("bot_target_raw"),
                "executable_price": bot.get("bot_target_executable"),
                "path_reason": bot.get("bot_path_reason"),
            },
            "trader_marked_tp": lab.get("trader_tp_status"),
            "earlier_same_session_bullet": bullet,
            "mismatch_class": _mismatch_class(trader, bstate, ws, delta_s),
        })

    entered = {"ENTER_LONG", "ENTER_SHORT"}
    mism = [c["mismatch_class"] for c in cases]
    deltas = [c["timing_delta_seconds"] for c in cases
              if c["timing_delta_seconds"] is not None
              and c["trader_state"] == c["bot_state"] and c["trader_state"] in entered]

    agg = {
        "exact_action_agreement": f"{sum(1 for c in cases if c['trader_state'] == c['bot_state'])}/14",
        "entered_vs_not_agreement":
            f"{sum(1 for c in cases if (c['trader_state'] in entered) == (c['bot_state'] in entered))}/14",
        "opposite_direction_at_decision_count": mism.count("OPPOSITE_DIRECTION_AT_DECISION"),
        "earlier_opposite_entry_consumed_bullet_count":
            mism.count("EARLIER_OPPOSITE_ENTRY_CONSUMED_BULLET"),
        "in_window_bot_only_entry_count": mism.count("BOT_ONLY_ENTRY_IN_WINDOW"),
        "pre_window_bot_only_entry_count": mism.count("BOT_ONLY_ENTRY_BEFORE_WINDOW"),
        "missed_trader_entry_count": mism.count("MISSED_TRADER_ENTRY"),
        "wait_vs_no_trade_disagreement_count": mism.count("WAIT_VS_NO_TRADE"),
        "cases_affected_by_earlier_same_session_bullet":
            sum(1 for c in cases if c["earlier_same_session_bullet"]),
        "same_direction_timing_deltas_seconds": sorted(deltas),
        "mismatch_class_census": {k: mism.count(k) for k in sorted(set(mism))},
    }

    total_s = time.perf_counter() - t0
    out = {
        "artifact": "FROZEN_14_CASE_FIDELITY_BASELINE_SCORECARD",
        "authority": "ALGO-007 §6",
        "produced": "2026-08-21",
        "status": "SEEN_DEVELOPMENT_FIDELITY_EVIDENCE_ONLY_NOT_EDGE_EVIDENCE",
        "regrade_status": regrade["status"],
        "source_pack_id": regrade["source_pack_id"],
        "trader_labels_file_sha256": hashlib.sha256(labels_raw).hexdigest(),
        "case_count": len(cases),
        "pnl_or_exit_used": False,
        "pnl_rail": ("No realized PnL, winner/loser status, exit outcome or later-session "
                     "information participates in any comparison in this artifact."),
        "runtime": {
            "total_seconds": round(total_s, 2),
            "data_prepare_seconds": round(prep_s, 2),
            "regrade_seconds": round(regrade_s, 2),
            "per_case_mean_seconds": round(regrade_s / max(len(cases), 1), 3),
        },
        "aggregates": agg,
        "cases": cases,
    }

    blob = json.dumps(out, indent=2, ensure_ascii=False) + "\n"
    for f in FORBIDDEN:
        for c in out["cases"]:
            assert not any(f in str(k).lower() for k in c), f"forbidden field {f!r} in a case row"

    io.open(OUT, "w", encoding="utf-8", newline="\n").write(blob)
    print(f"wrote {OUT}")
    print(f"  exact action agreement : {agg['exact_action_agreement']}")
    print(f"  entered-vs-not         : {agg['entered_vs_not_agreement']}")
    print(f"  opposite AT decision   : {agg['opposite_direction_at_decision_count']}")
    print(f"  earlier opposite/bullet: {agg['earlier_opposite_entry_consumed_bullet_count']}")
    print(f"  bot-only in window     : {agg['in_window_bot_only_entry_count']}")
    print(f"  bot-only pre window    : {agg['pre_window_bot_only_entry_count']}")
    print(f"  missed trader entries  : {agg['missed_trader_entry_count']}")
    print(f"  WAIT vs NO_TRADE       : {agg['wait_vs_no_trade_disagreement_count']}")
    print(f"  mismatch census        : {agg['mismatch_class_census']}")
    print(f"  runtime                : {out['runtime']['total_seconds']}s total, "
          f"{out['runtime']['regrade_seconds']}s regrade")


if __name__ == "__main__":
    main()
