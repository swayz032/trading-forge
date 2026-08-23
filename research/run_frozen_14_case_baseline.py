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

F-5 THE BULLET CLASS WAS WRONG, BUT SO WAS MY RETRACTION OF IT. I first classified two cases
    as EARLIER_OPPOSITE_ENTRY_CONSUMED_BULLET, then claimed the mechanism did not exist at
    all. ALGO-011 §2 refuted the second claim and I reproduced it: the one-trade rule IS
    real, enforced three separate implicit ways - a `return` inside the candidate loop in
    `_analysis_run_day`, first-actionable-only in the signal path, and an explicit
    DAILY_BULLET_ALREADY_RESOLVED guard in the shadow runtime. A rule implemented as control
    flow has no name to grep for. The defect is that the invariant is DISTRIBUTED, not
    absent; see `current_mnq_strategy_v2_4_session_budget.py`. The class is still removed
    here, because on the WINDOW join those two cases are not what it described.

F-7 FORCE RECEIPT NAMING THE WRONG FUNCTION. CLOSED: the scorecard now carries the actual
    `force_snapshot` recomputed at the candidate's own decision clock, and the regrade raises
    FORCE_RECEIPT_DISAGREES_WITH_KERNEL_GATE if it ever returns unconfirmed.

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
# ---- F-6 REPAIR (ALGO-020 section 1 item 6 / section 4 item 4) --------------------------
# The trader oracle used to live ONLY in a Downloads folder, outside git. Two hashes were
# recorded for it and NOTHING COMPARED THEM, because they cover DIFFERENT BYTE RANGES:
#   whole-file sha256      1b20b0a8...  (the scorecard's `trader_labels_file_sha256`)
#   internal labels_sha256 11d8dec0...  (the manifest's, over {schema_version, pack_id,
#                                        frozen_at, labels} only)
# So `status`, `wait_at_replay_end_count` and `capture_warnings` -- THE ENTIRE CENSORING
# ANNOTATION -- sat outside the signed payload, unsigned and unchecked.
# The file is now COMMITTED, byte-identical, after a field scan confirmed it carries no
# monetary field. Git custody covers the WHOLE byte range, which closes the hole without
# needing to reproduce the freeze signature. The Downloads copy is now optional corroboration.
LABELS = Path("research/current_mnq_strategy_v2_4_replay_v3_labels_FROZEN.json")
LABELS_EXTERNAL_ORIGIN = Path("C:/Users/tonio/Downloads/mnq_replay_v3_labels_FROZEN.json")
OUT = Path("research/current_mnq_strategy_v2_4_frozen_14_case_scorecard_2026_08_21.json")

CENSOR_WARNING = "TRADER_ENDED_PRESENTED_REPLAY_STILL_WAITING"
ENTERED = {"ENTER_LONG", "ENTER_SHORT"}

#: Both are AGREEMENT. Taking the same trade, and BOTH GENUINELY standing aside.
#: `BOTH_DECLINED` is the class the semantics work exists to produce, and the refuted raw
#: string compare scored it as a disagreement (G-1). It is reachable ONLY when the bot still
#: held its bullet inside the window - a bot that already traded pre-window did not decline,
#: and `TRADER_DECLINED_BOT_TRADED_PRE_WINDOW` is deliberately NOT in this set.
AGREEMENT_CLASSES = frozenset({"AGREE", "BOTH_DECLINED"})

#: The bot spent its one trade before the window opened. NOT a decline; it traded.
BUDGET_CONSUMED = "BUDGET_CONSUMED_BEFORE_WINDOW"

def _bot_window_state(row: dict) -> str:
    """The bot's decision INSIDE the audited window, UNDER ITS OWN ONE-TRADE BUDGET.

    F-1 REPAIR (ALGO-019). Only the session's first fully-approved entry can execute. When
    that entry precedes the window, the bot has no bullet left inside it and CANNOT act -
    so a trader entry there is a MISS, not an agreement. The previous version reported
    `in_window[0]` regardless and published 2026-03-23 as AGREE while production had gone
    the OPPOSITE direction 57 minutes before the window opened.
    """
    bf = row.get("budget_faithful")
    if bf is None:
        raise RuntimeError(
            "REGRADE_ROW_PREDATES_THE_F1_REPAIR: no `budget_faithful` block. Re-run the "
            "regrade; scoring this row would reproduce the refuted window join.")
    if bf.get("bullet_spent_before_window"):
        return BUDGET_CONSUMED
    w = row.get("in_window")
    return str(w["bot_action"]) if w else "NO_ENTRY_IN_WINDOW"


def _missed_reason(bot: str) -> str | None:
    """WHY the bot failed to meet a trader entry. Two independent causes, both real."""
    if bot == BUDGET_CONSUMED:
        return "BUDGET_CONSUMED_BEFORE_WINDOW"
    if bot == "NO_ENTRY_IN_WINDOW":
        return "NO_PERMISSION_IN_WINDOW"
    return None


def _bot_session_state(row: dict) -> str:
    """Retained for continuity with the refuted session-joined figure."""
    a = row.get("bot_action")
    if not a:
        raise RuntimeError(f"regrade row has no bot_action: {sorted(row)}")
    return str(a)


def _mismatch_class(trader: str, bot: str, censored: bool) -> str:
    """Classify one case.

    BUDGET_CONSUMED_BEFORE_WINDOW IS NOT A DECLINE, and conflating the two is how I nearly
    re-inflated the very headline the band-5 grade refuted. The bot did not stand aside in
    those sessions - IT TRADED, before the window opened. Folding that into BOTH_DECLINED
    scored a bot trade as agreement and moved the figure 5/8 -> 6/8 in the bot's favour.
    Unavailable, declined, and entered are three states, not two.
    """
    t_in, b_in = trader in ENTERED, bot in ENTERED
    unavailable = bot == BUDGET_CONSUMED

    if censored:
        # No trader decision was ever made. Nothing here can convict or acquit the bot.
        if unavailable:
            return "CENSORED_BOT_BUDGET_CONSUMED"
        return "CENSORED_BOT_ENTERED" if b_in else "CENSORED_BOT_DECLINED"

    if unavailable:
        # The bot spent its one trade before the window. It cannot agree with anything here.
        return ("MISSED_TRADER_ENTRY" if t_in
                else "TRADER_DECLINED_BOT_TRADED_PRE_WINDOW")

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
    if LABELS_EXTERNAL_ORIGIN.exists():
        ext = LABELS_EXTERNAL_ORIGIN.read_bytes()
        if ext != labels_raw:
            raise RuntimeError(
                "COMMITTED_LABELS_DIVERGE_FROM_THE_EXTERNAL_ORIGIN: "
                f"{hashlib.sha256(labels_raw).hexdigest()} in-repo vs "
                f"{hashlib.sha256(ext).hexdigest()} at {LABELS_EXTERNAL_ORIGIN}. The frozen "
                "labels are never edited; one of these two has moved.")
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
            "force_receipt": iw.get("force_receipt"),
            "force_receipt_note": (
                "REAL SNAPSHOT as of ALGO-011 §9.3. The previous receipt claimed force was "
                "implied because the entry passed `one_minute_entry` - a v2.2 fill-price "
                "helper with zero force logic (ALGO-008 F-7). This is now the actual "
                "force_snapshot recomputed at the candidate's own decision clock with the "
                "same pure function the kernel gated on, and the regrade raises "
                "FORCE_RECEIPT_DISAGREES_WITH_KERNEL_GATE if it ever comes back unconfirmed."
            ),
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
            "missed_reason": (
                _missed_reason(bstate)
                if _mismatch_class(trader, bstate, censored) == "MISSED_TRADER_ENTRY"
                else None),
            "budget_faithful": bot.get("budget_faithful"),
        })

    mism = [c["mismatch_class"] for c in cases]
    unc = [c for c in cases if not c["trader_label_censored"]]
    deltas = sorted(c["timing_delta_seconds"] for c in cases
                    if c["timing_delta_seconds"] is not None
                    and c["trader_state"] == c["bot_state_in_window"])

    agg = {
        "join": "WINDOW",
        "join_note": "The refuted first version joined on SESSION; see F-1 in the docstring.",
        # F-2 + G-1 REPAIR (ALGO-020 section 1 item 2). Agreement is now read OFF THE
        # CLASSIFIER and nowhere else. It used to be a raw string compare with a hardcoded
        # /14 running parallel to `_mismatch_class`, which guarded censoring while the
        # headline did not. Two consequences the grader red-proofed and this closes:
        #   F-2  make one censored label's action equal its bot action and the headline moved
        #        6/14 -> 7/14 while the census did not move at all.
        #   G-1  a trader NO_TRADE against a bot NO_ENTRY_IN_WINDOW is BOTH_DECLINED - a
        #        genuine agreement, and exactly what the semantics work is meant to produce -
        #        yet a string compare scored it as DISagreement.
        # AGREEMENT = AGREE union BOTH_DECLINED. Censored cases are excluded by the
        # classifier itself, so there is no second place for the rule to drift.
        "agreement_definition": "AGREE + BOTH_DECLINED, from _mismatch_class only",
        "agreement_decided_cases":
            f"{sum(1 for c in unc if c['mismatch_class'] in AGREEMENT_CLASSES)}/{len(unc)}",
        "uncensored_case_count": len(unc),
        "censored_excluded_from_both_numerator_and_denominator":
            sum(1 for c in cases if c["trader_label_censored"]),

        # THE CENSORING IS ASYMMETRIC, AND THE HEADLINE DOES NOT SAY SO.
        #
        # A trader who never rendered a decision is removed from BOTH numerator and
        # denominator - that is the F-1 repair and it is right. But a BOT that never rendered
        # a decision inside the window (its daily bullet was already spent) is left in the
        # denominator and scored as a DISAGREEMENT. The same argument that excuses one
        # excuses the other, and nothing here was applying it to the bot.
        #
        # Surfaced by the independent grader as "prose selects 8, flags select 6". Measured,
        # it is THREE sessions, not two: 03-23, 04-02 and 04-09 all carry
        # BUDGET_CONSUMED_BEFORE_WINDOW and all three currently count against the bot.
        #
        # THE HEADLINE IS NOT CHANGED HERE. The symmetric denominator FLATTERS the bot, which
        # is precisely why it may not be adopted by the party it flatters, and the standing
        # rule of this lane is that the stricter reading holds while the textbook is silent.
        # This block exists so the choice is VISIBLE instead of implicit, and so the advisor
        # rules on a number he can see rather than one he has to derive.
        "asymmetric_censoring_diagnostic": {
            "STATUS": "DIAGNOSTIC_ONLY_NOT_THE_HEADLINE",
            "question": (
                "trader-side non-decision is excluded from both numerator and denominator; "
                "bot-side non-decision is counted as a disagreement. Should it also be "
                "excluded, or is an unavailable bot a real failure that must count?"),
            "sessions_where_the_bot_had_no_in_window_decision": sorted(
                c["session"] for c in unc
                if c.get("bot_state_in_window") == BUDGET_CONSUMED),
            "headline_as_published_stricter_reading":
                f"{sum(1 for c in unc if c['mismatch_class'] in AGREEMENT_CLASSES)}/{len(unc)}",
            "if_bot_side_were_censored_symmetrically": (
                lambda d: f"{sum(1 for c in d if c['mismatch_class'] in AGREEMENT_CLASSES)}"
                          f"/{len(d)}")(
                [c for c in unc if c.get("bot_state_in_window") != BUDGET_CONSUMED]),
            "why_it_is_not_adopted": (
                "it raises the fidelity number, and a party may not adopt the reading that "
                "flatters it. This is an ALGO question, not a worker decision."),
        },
        "opposite_direction_at_decision_count": mism.count("OPPOSITE_DIRECTION_AT_DECISION"),
        "missed_trader_entry_count": mism.count("MISSED_TRADER_ENTRY"),
        "bot_only_entry_uncensored_decline_count":
            mism.count("BOT_ONLY_ENTRY_UNCENSORED_DECLINE"),
        "both_declined_count": mism.count("BOTH_DECLINED"),
        "censored_bot_entered_count": mism.count("CENSORED_BOT_ENTERED"),
        "censored_bot_declined_count": mism.count("CENSORED_BOT_DECLINED"),
        "missed_reason_census": {
            r: sum(1 for c in cases if c.get("missed_reason") == r)
            for r in ("BUDGET_CONSUMED_BEFORE_WINDOW", "NO_PERMISSION_IN_WINDOW")},
        "sessions_whose_bullet_was_spent_before_the_window":
            sum(1 for c in cases
                if (c.get("budget_faithful") or {}).get("bullet_spent_before_window")),
        "in_window_entries_the_budget_forbids":
            sum((c.get("budget_faithful") or {}).get("in_window_entries_the_budget_forbids", 0)
                for c in cases),
        "bot_genuinely_declined_in_window_count":
            sum(1 for c in cases if c["bot_state_in_window"] == "NO_ENTRY_IN_WINDOW"),
        "bot_unavailable_in_window_count":
            sum(1 for c in cases if c["bot_state_in_window"] == BUDGET_CONSUMED),
        "bot_entered_in_window_count":
            sum(1 for c in cases if c["bot_state_in_window"] in ENTERED),
        "bot_traded_at_all_in_the_session_count":
            sum(1 for c in cases
                if ((c.get("budget_faithful") or {}).get("session_first_action") in ENTERED)),
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
        "trader_labels_custody": {
            "path": str(LABELS),
            "committed_to_git": True,
            "whole_file_sha256": hashlib.sha256(labels_raw).hexdigest(),
            "whole_file_sha256_covers": "every byte, including the censoring annotation",
            "internal_labels_sha256": doc.get("labels_sha256"),
            "internal_labels_sha256_covers":
                "{schema_version, pack_id, frozen_at, labels} only",
            "keys_OUTSIDE_the_internal_signature":
                [k for k in doc if k not in
                 {"schema_version", "pack_id", "frozen_at", "labels", "labels_sha256"}],
            "why_both_are_recorded": (
                "these two digests cover DIFFERENT BYTE RANGES and comparing them to each "
                "other is meaningless. Each is now named with its scope so nobody tries."),
            "corroborated_against_external_origin": LABELS_EXTERNAL_ORIGIN.exists(),
        },
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
    print(f"  agreement (decided cases) : {agg['agreement_decided_cases']}"
          f"   [{agg['agreement_definition']}]")
    print(f"  censored, excluded        : "
          f"{agg['censored_excluded_from_both_numerator_and_denominator']}")
    print(f"  bullet spent pre-window   : "
          f"{agg['sessions_whose_bullet_was_spent_before_the_window']} sessions, hiding "
          f"{agg['in_window_entries_the_budget_forbids']} unreachable in-window entries")
    print(f"  missed reasons            : {agg['missed_reason_census']}")
    print(f"  opposite AT decision      : {agg['opposite_direction_at_decision_count']}")
    print(f"  missed trader entries     : {agg['missed_trader_entry_count']}")
    print(f"  bot-only vs REAL decline  : {agg['bot_only_entry_uncensored_decline_count']}")
    print(f"  bot entered in window     : {agg['bot_entered_in_window_count']}   "
          f"declined {agg['bot_genuinely_declined_in_window_count']}   "
          f"unavailable {agg['bot_unavailable_in_window_count']}")
    print(f"  bot traded at all (session): {agg['bot_traded_at_all_in_the_session_count']} of 14")
    print(f"  censored (segregated)     : {agg['censored_bot_entered_count']} entered / "
          f"{agg['censored_bot_declined_count']} declined")
    print(f"  decisions end / in-window : {agg['total_decisions_through_window_end']} / "
          f"{agg['total_decisions_in_window']}")
    print(f"  census                    : {agg['mismatch_class_census']}")
    print(f"  runtime                   : {out['runtime']['total_seconds']}s")


if __name__ == "__main__":
    main()
