#!/usr/bin/env python3
"""Canonical frozen 14-case fidelity baseline — ALGO-007 §6, REPAIRED per ALGO-008.

An independent grade (band 5, REFUTED) found two critical defects in the first version of
this file. Both are closed here, and the corrections are load-bearing rather than cosmetic:

F-1 SESSION-vs-WINDOW JOIN. `_full_entry_decisions_through` filters `entry_time > end` and
    never `entry_time < start`, so `decisions[0]` is the first A+ of the SESSION. Seven of
    fourteen published bot decisions happened BEFORE the audited window opened, by up to 103
    minutes, while the artifact's own status string said SAME_WINDOW. This file now
    classifies on the first IN-WINDOW decision. The session-scoped value is retained beside
    it, because the regrade module's docstring genuinely promises a session-scoped answer and
    the calibration generator consumes it.

F-2 A REAL DIRECTION INVERSION WAS PUBLISHED AS ZERO. On 2026-04-09 the bot went SHORT at
    11:27 and 11:28 inside the window while the trader went LONG at 11:35. The session join
    hid it behind a 09:52 pre-window entry.

F-3 STRUCTURALLY DEAD BRANCHES. The bot entered in 14/14 sessions, so every classifier branch
    requiring `bot not entered` was unreachable: MISSED_TRADER_ENTRY and the WAIT/NO_TRADE
    comparison could never fire. Their zeros were not measurements. On the window join the
    bot can decline, so both are live.

F-4 RIGHT-CENSORED TRADER LABELS. Six of fourteen labels carry
    TRADER_ENDED_PRESENTED_REPLAY_STILL_WAITING, each with a single timeline entry stamped at
    exactly the window end. The trader had not declined - the replay was cut off while he was
    still watching. The previous version read WAIT as a decline, which is what produced the
    "trigger-happy" conclusion. Censored cases are now segregated and cannot convict the bot.

F-5 A BULLET MECHANISM THAT DOES NOT EXIST. There is no one-trade-per-session rule anywhere in
    the import closure, and the bot took BOTH directions in 6 of 14 sessions. The
    "consumed bullet" class is removed rather than renamed.

F-7 FORCE RECEIPT NAMING THE WRONG FUNCTION. See FORCE_RECEIPT below.

HARD RAILS, enforced here rather than asserted:
  * No realized PnL, winner/loser, exit outcome or later-session data enters any comparison.
  * The trader oracle is read-only; nothing tunes toward it.
  * Bot clocks come from the engine's causal output.

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

CENSOR_WARNING = "TRADER_ENDED_PRESENTED_REPLAY_STILL_WAITING"
ENTERED = {"ENTER_LONG", "ENTER_SHORT"}

FORCE_RECEIPT = (
    "NOT_EMITTED. ALGO-008 F-7 refuted the previous justification, which claimed force was "
    "implied because the entry passed `one_minute_entry` - a v2.2 FILL-PRICE helper with zero "
    "force logic. The conclusion survives by a different route (`iter_actionable_candidates` "
    "has exactly one yield and every branch reaching it force-gates first), but an "
    "implication-by-existence receipt CANNOT GO RED and must be replaced by the actual "
    "force.confirmed snapshot before any semantic repair."
)


def _bot_window_state(row: dict) -> str:
    """The bot's decision INSIDE the audited window. It is now allowed to decline."""
    w = row.get("in_window")
    return str(w["bot_action"]) if w else "NO_ENTRY_IN_WINDOW"


def _bot_session_state(row: dict) -> str:
    """Retained for continuity with the refuted session-joined figure."""
    a = row.get("bot_action")
    if not a:
        raise RuntimeError(f"regrade row has no bot_action: {sorted(row)}")
    return str(a)


def _mismatch_class(trader: str, bot: str, censored: bool) -> str:
    t_in, b_in = trader in ENTERED, bot in ENTERED
    if censored:
        # No decision was ever made. Nothing here can convict or acquit the bot.
        return "CENSORED_BOT_ENTERED" if b_in else "CENSORED_BOT_DECLINED"
    if trader == bot:
        return "AGREE"
    if t_in and b_in:
        return "OPPOSITE_DIRECTION_AT_DECISION"
    if t_in and not b_in:
        return "MISSED_TRADER_ENTRY"
    if b_in and not t_in:
        return "BOT_ONLY_ENTRY_UNCENSORED_DECLINE"
    return "BOTH_DECLINED"


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

    windows = {c["case_id"]: c for c in json.loads(Path(MANIFEST).read_text())["cases"]}
    labels_raw = io.open(LABELS, "rb").read()
    doc = json.loads(labels_raw.decode("utf-8"))
    labels = {x["case_id"]: x for x in doc["labels"]}
    bot_rows = {r["case_id"]: r for r in regrade["rows"]}

    if not (set(windows) == set(labels) == set(bot_rows)):
        raise RuntimeError("CASE_ID_SET_MISMATCH_ACROSS_MANIFEST_LABELS_AND_REGRADE")
    if any(not r.get("bot_action") for r in bot_rows.values()):
        raise RuntimeError("BOT_ACTION_MISSING_ON_SOME_ROWS")

    censored_ids = {w["case_id"] for w in doc.get("capture_warnings", [])
                    if w.get("warning") == CENSOR_WARNING}
    if len(censored_ids) != doc.get("wait_at_replay_end_count"):
        raise RuntimeError("CENSOR_COUNT_DISAGREES_WITH_CAPTURE_WARNINGS")

    cases = []
    for cid in sorted(windows, key=lambda k: windows[k]["session"]):
        w, lab, bot = windows[cid], labels[cid], bot_rows[cid]
        trader = lab.get("final_action") or "UNKNOWN"
        censored = cid in censored_ids
        bstate = _bot_window_state(bot)
        iw = bot.get("in_window") or {}
        bot_clock = iw.get("bot_entry_time")
        trader_clock = lab.get("first_entry_time")
        delta_s = None
        if bot_clock and trader_clock:
            delta_s = (pd.Timestamp(bot_clock) - pd.Timestamp(trader_clock)).total_seconds()
        tl = lab.get("decision_timeline") or []

        cases.append({
            "case_id": cid,
            "session": w["session"],
            "replay_window": {"start": w["replay_start"], "end": w["replay_end"]},
            "trader_state": trader,
            "trader_label_censored": censored,
            "trader_censor_note": (
                "Replay ended while the trader was still watching. This is NOT a decline and "
                "may not be counted against the bot." if censored else None),
            "bot_state_in_window": bstate,
            "bot_state_session_first_REFUTED_JOIN": _bot_session_state(bot),
            "bot_window_status": bot.get("window_status"),
            "bot_decision_clock": bot_clock,
            "trader_decision_clock": trader_clock,
            "timing_delta_seconds": delta_s,
            "decisions_through_window_end": bot.get("decision_count_through_end"),
            "decisions_in_window": bot.get("decision_count_in_window"),
            "in_window_action_sequence": bot.get("in_window_actions"),
            "interaction_geometry": {
                "location_id": iw.get("bot_location_id"),
                "location_source": iw.get("bot_location_source"),
            },
            "entry_family_receipt": iw.get("bot_setup"),
            "story_receipt": iw.get("bot_reason"),
            "force_receipt": FORCE_RECEIPT,
            "trader_entry_force": lab.get("entry_force"),
            "trader_final_timeline_force": (tl[-1].get("force") if tl else None),
            "first_tp": {
                "target_source": iw.get("bot_target_source"),
                "target_kind": iw.get("bot_target_kind"),
                "raw_price": iw.get("bot_target_raw"),
                "executable_price": iw.get("bot_target_executable"),
                "path_reason": iw.get("bot_path_reason"),
            },
            "trader_marked_tp": lab.get("trader_tp_status"),
            "mismatch_class": _mismatch_class(trader, bstate, censored),
        })

    mism = [c["mismatch_class"] for c in cases]
    unc = [c for c in cases if not c["trader_label_censored"]]
    deltas = sorted(c["timing_delta_seconds"] for c in cases
                    if c["timing_delta_seconds"] is not None
                    and c["trader_state"] == c["bot_state_in_window"])

    agg = {
        "join": "WINDOW",
        "join_note": "The refuted first version joined on SESSION; see F-1 in the docstring.",
        "exact_action_agreement":
            f"{sum(1 for c in cases if c['trader_state'] == c['bot_state_in_window'])}/14",
        "uncensored_case_count": len(unc),
        "exact_action_agreement_uncensored":
            f"{sum(1 for c in unc if c['trader_state'] == c['bot_state_in_window'])}/{len(unc)}",
        "opposite_direction_at_decision_count": mism.count("OPPOSITE_DIRECTION_AT_DECISION"),
        "missed_trader_entry_count": mism.count("MISSED_TRADER_ENTRY"),
        "bot_only_entry_uncensored_decline_count":
            mism.count("BOT_ONLY_ENTRY_UNCENSORED_DECLINE"),
        "both_declined_count": mism.count("BOTH_DECLINED"),
        "censored_bot_entered_count": mism.count("CENSORED_BOT_ENTERED"),
        "censored_bot_declined_count": mism.count("CENSORED_BOT_DECLINED"),
        "bot_declined_in_window_count":
            sum(1 for c in cases if c["bot_state_in_window"] == "NO_ENTRY_IN_WINDOW"),
        "total_decisions_through_window_end":
            sum(c["decisions_through_window_end"] or 0 for c in cases),
        "total_decisions_in_window": sum(c["decisions_in_window"] or 0 for c in cases),
        "same_direction_timing_deltas_seconds": deltas,
        "mismatch_class_census": {k: mism.count(k) for k in sorted(set(mism))},
    }

    total_s = time.perf_counter() - t0
    out = {
        "artifact": "FROZEN_14_CASE_FIDELITY_BASELINE_SCORECARD",
        "authority": "ALGO-007 §6, repaired per the ALGO-008 grade (band 5, REFUTED)",
        "produced": "2026-08-22",
        "status": "SEEN_DEVELOPMENT_FIDELITY_EVIDENCE_ONLY_NOT_EDGE_EVIDENCE",
        "supersedes": "the SESSION-joined scorecard whose two headline figures were refuted",
        "regrade_status": regrade["status"],
        "source_pack_id": regrade["source_pack_id"],
        "trader_labels_file_sha256": hashlib.sha256(labels_raw).hexdigest(),
        "trader_labels_status": doc.get("status"),
        "right_censored_case_count": len(censored_ids),
        "censoring_note": (
            "Six labels carry TRADER_ENDED_PRESENTED_REPLAY_STILL_WAITING with a single "
            "timeline entry at exactly the window end. Those cases record NO trader decision "
            "and are segregated from every agreement and disagreement count."
        ),
        "case_count": len(cases),
        "pnl_or_exit_used": False,
        "runtime": {
            "total_seconds": round(total_s, 2),
            "data_prepare_seconds": round(prep_s, 2),
            "regrade_seconds": round(regrade_s, 2),
            "per_case_mean_seconds": round(regrade_s / max(len(cases), 1), 3),
        },
        "aggregates": agg,
        "cases": cases,
    }

    io.open(OUT, "w", encoding="utf-8", newline="\n").write(
        json.dumps(out, indent=2, ensure_ascii=False) + "\n")

    print(f"wrote {OUT}")
    print("  join                      : WINDOW  (was SESSION - refuted)")
    print(f"  exact action agreement    : {agg['exact_action_agreement']}")
    print(f"  ... uncensored only       : {agg['exact_action_agreement_uncensored']}")
    print(f"  opposite AT decision      : {agg['opposite_direction_at_decision_count']}")
    print(f"  missed trader entries     : {agg['missed_trader_entry_count']}")
    print(f"  bot-only vs REAL decline  : {agg['bot_only_entry_uncensored_decline_count']}")
    print(f"  bot declined in window    : {agg['bot_declined_in_window_count']}")
    print(f"  censored (segregated)     : {agg['censored_bot_entered_count']} entered / "
          f"{agg['censored_bot_declined_count']} declined")
    print(f"  decisions end / in-window : {agg['total_decisions_through_window_end']} / "
          f"{agg['total_decisions_in_window']}")
    print(f"  census                    : {agg['mismatch_class_census']}")
    print(f"  runtime                   : {out['runtime']['total_seconds']}s")


if __name__ == "__main__":
    main()
