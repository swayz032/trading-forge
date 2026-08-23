#!/usr/bin/env python3
"""Re-evaluate repaired bot semantics on the trader's already-frozen replay windows.

The case manifest contains only public-to-the-project replay IDs/session windows,
not the trader's decisions. This module therefore cannot tune toward the trader
labels. It asks the current exact strategy: did a full A+ entry exist before the
old replay window, inside it, or not through its end?

This is seen/development fidelity evidence only. It never reads exits, PnL,
winners or clean OOS data.
"""
from __future__ import annotations

from datetime import date
import json
from pathlib import Path

import pandas as pd

from research import current_mnq_strategy_v2_4_engine as eng
from research.current_mnq_strategy_v2_4_force import force_snapshot
from research.current_mnq_strategy_v2_4_independent_force import (
    compare,
    independent_force,
    parent_for_setup,
)
from research.current_mnq_strategy_v2_4_session_budget import (
    MAX_FULLY_APPROVED_EXECUTED_TRADES_PER_SESSION,
)
from research.current_mnq_strategy_v2_4_kernel import iter_actionable_candidates
from research.current_mnq_strategy_v2_4_target_policy import build_and_classify

MANIFEST = Path(__file__).with_name("current_mnq_strategy_v2_4_frozen_replay_case_manifest_2026_08_20.json")


def _full_entry_decisions_through(env: dict, dte: date, end: pd.Timestamp, p: eng.Params):
    """Yield full equation-approved entries through `end` without any exit/PnL path."""
    for cand, actionable, plan in iter_actionable_candidates(env, dte, p, as_of=end):
        ent = eng.core.one_minute_entry(env["one"], actionable, cand.direction, p)
        if ent is None:
            continue
        entry_time, entry, _raw_open = ent
        if entry_time > end or entry_time.time() > eng.core.LAST_ENTRY:
            continue
        picked, path_reason = build_and_classify(
            env["piv5"], env["full5"], env["h15"], entry_time, p,
            env["pdm"], env["pwm"], dte, float(entry), cand.direction, cand.setup,
            cand.setup == "BRK5", piv15=env["piv15"],
            entry_location=cand.location,
            candidate_reason=cand.reason,
        )
        if picked is None:
            continue
        # ---- F-7 REPAIR: the ACTUAL force proof, not an implication ---------------------
        # Recomputed with the same pure function the kernel gated on, at this candidate's own
        # decision clock. A receipt that cannot go red is not a receipt: falsify
        # force.confirmed and this block changes.
        # ---- F-4 REPAIR (ALGO-020 section 1 item 4) --------------------------------
        # The parent the KERNEL gated on, PER SETUP. BRK15 confirms through a 15m parent
        # floored to the DECISION clock; this hardcoded a 5m parent anchored at the
        # signal time and would have raised against correct BRK15 decisions.
        parent_start, parent_minutes = parent_for_setup(
            cand.setup, cand.signal_time, cand.confirmed_time)
        fs = force_snapshot(env["one"], parent_start, parent_minutes, cand.direction,
                            cand.confirmed_time, p)
        # A SECOND, INDEPENDENT DERIVATION from the raw 1m bars, calling neither
        # `force_snapshot` nor `momentum_bar`. The previous check re-called the SAME pure
        # function with IDENTICAL arguments and so could never disagree - the whole of
        # F-4. Two implementations agreeing is evidence; one agreeing with itself is not.
        indep = independent_force(
            env["one"], parent_start, parent_minutes, cand.direction,
            cand.confirmed_time, float(p.body_frac), float(p.close_loc))
        divergences = compare(fs, indep)
        if divergences:
            raise RuntimeError(
                f"FORCE_DERIVATIONS_DISAGREE at {cand.confirmed_time} "
                f"({cand.setup}, parent {parent_minutes}m @ {parent_start}): "
                f"{divergences}")

        force_receipt = {
            "cross_checked_against_an_independent_derivation": True,
            "independent_derivation_agreed": not divergences,
            "parent_minutes": int(parent_minutes),
            "parent_start_used": parent_start.isoformat(),
            "setup": str(cand.setup),
            "confirmed": bool(fs.confirmed),
            "decision_clock": (fs.decision_time.isoformat() if fs.decision_time is not None
                               else None),
            "parent_start": fs.parent_start.isoformat(),
            "completed_1m_observations": int(fs.completed_1m),
            "directional_progress": float(fs.directional_progress),
            "path_distance": float(fs.path_distance),
            "path_efficiency": float(fs.path_efficiency),
            "latest_close_at_directional_extreme": bool(fs.latest_close_at_directional_extreme),
            "partial_momentum_geometry": bool(fs.partial_momentum_geometry),
            "reason": str(fs.reason),
            "source": "research.current_mnq_strategy_v2_4_force.force_snapshot, recomputed at "
                      "the candidate's own (signal_time, confirmed_time, direction) - the "
                      "same pure call the kernel gated on.",
        }
        # ---- F-2 REPAIR (arena grade 2026-08-23, HIGH) ------------------------------
        # THE RAISE THAT USED TO LIVE HERE COULD NEVER FIRE, and the artifact advertised it
        # as a live guard. For REV and BRK5, `parent_for_setup` returns
        # `(cand.signal_time, 5)` - the EXACT argument tuple the kernel already gated on -
        # and `force_snapshot` is pure, so `confirmed` was True by construction on 100% of
        # the corpus. A green check with no path to red, wearing the name of a disagreement
        # detector.
        #
        # What this receipt actually establishes is REPRODUCIBILITY: the gate's own decision
        # can be recomputed from the recorded inputs. That is worth publishing and it is not
        # nothing - but it is not a cross-check, and it is no longer captioned as one. The
        # real cross-check is `independent_force`, whose own power is narrower than its
        # caption claimed (see the same grade, F-3).
        assert fs.confirmed, (
            "force_snapshot is pure and the kernel gated on this same tuple; a False here "
            "would mean the recorded inputs do not reproduce the decision at all")

        yield {
            "bot_action": "ENTER_LONG" if cand.direction == "L" else "ENTER_SHORT",
            "force_receipt": force_receipt,
            "bot_entry_time": entry_time.isoformat(),
            "bot_setup": str(cand.setup),
            "bot_reason": str(cand.reason),
            "bot_location_id": str(cand.location.id),
            "bot_location_source": str(cand.location.source),
            "bot_target_source": str(picked.location.source),
            "bot_target_kind": str(getattr(picked, "kind", "")),
            "bot_target_raw": float(picked.raw_price),
            "bot_target_executable": float(picked.executable_price),
            "bot_path_reason": str(path_reason),
        }


def regrade_frozen_case_windows(env: dict, p: eng.Params | None = None,
                                manifest_path: str | Path = MANIFEST) -> dict:
    p = p or eng.Params()
    manifest = json.loads(Path(manifest_path).read_text())
    rows = []
    for case in manifest["cases"]:
        dte = date.fromisoformat(case["session"])
        start = pd.Timestamp(case["replay_start"])
        end = pd.Timestamp(case["replay_end"])
        decisions = list(_full_entry_decisions_through(env, dte, end, p))
        if not decisions:
            # ---- F-1 REPAIR (arena grade 2026-08-23, CRITICAL) ----------------------
            # THIS BRANCH USED TO OMIT `budget_faithful` ENTIRELY, and that one missing key
            # made a GENUINE DECLINE unrepresentable:
            #
            #   `_bot_window_state` returns NO_ENTRY_IN_WINDOW only when `budget_faithful`
            #   exists, the bullet is NOT spent, and there is no in-window entry. With the
            #   key absent, the scorer raised `REGRADE_ROW_PREDATES_THE_F1_REPAIR` instead -
            #   a message that sends the reader chasing a stale artifact that does not exist.
            #
            # Four published metrics were therefore STRUCTURALLY ZERO rather than measured:
            # `bot_genuinely_declined_in_window_count`, `both_declined_count`,
            # `censored_bot_declined_count` and `missed_reason_census[NO_PERMISSION_IN_WINDOW]`
            # - and `AGREEMENT_CLASSES = {AGREE, BOTH_DECLINED}` degenerated to `{AGREE}`,
            # making the whole G-1 repair dead code.
            #
            # A bot that took NO entry through the window end HAS NOT SPENT ITS BULLET. That
            # is the honest reading and it is what makes all four metrics live again.
            rows.append({
                "case_id": case["case_id"], "session": case["session"],
                "window_status": "NO_FULL_ENTRY_THROUGH_REPLAY_END",
                "bot_action": "NO_TRADE_THROUGH_WINDOW", "bot_entry_time": None,
                "decision_count_through_end": 0,
                "decision_count_in_window": 0,
                "decisions_discarded_by_first_only": 0,
                "in_window": None,
                "in_window_actions": [],
                "budget_faithful": {
                    "one_trade_budget": MAX_FULLY_APPROVED_EXECUTED_TRADES_PER_SESSION,
                    "session_first_entry_time": None,
                    "session_first_action": None,
                    "bullet_spent_before_window": False,
                    "executable_in_window": False,
                    "in_window_entries_the_budget_forbids": 0,
                    "note": (
                        "No fully-approved entry existed anywhere through the replay end, so "
                        "the bullet was never spent and the bot GENUINELY DECLINED. Emitting "
                        "this block is what makes that state reachable at all."),
                },
            })
            continue

        first = decisions[0]
        t = pd.Timestamp(first["bot_entry_time"])
        if t < start:
            status = "FIRST_A_PLUS_PRECEDES_OLD_REPLAY_WINDOW"
        else:
            status = "FIRST_A_PLUS_INSIDE_OLD_REPLAY_WINDOW"

        # ---- F-1 REPAIR (ALGO-008 grade, band 5 REFUTED) --------------------------------
        # `_full_entry_decisions_through` filters `entry_time > end` and NEVER
        # `entry_time < start`. The window filter is asymmetric, so `decisions[0]` is the
        # first A+ of the SESSION, not of the WINDOW. Seven of fourteen published bot
        # decisions happened before the audited window opened, by up to 103 minutes, while
        # the artifact's own status string said SAME_WINDOW.
        #
        # ADDITIVE: the session-scoped answer above is what this module's docstring promises
        # and what the calibration generator consumes, so it is untouched. The window-scoped
        # answer is emitted beside it and consumers choose explicitly.
        in_window = [d for d in decisions if pd.Timestamp(d["bot_entry_time"]) >= start]

        # ---- F-1 REPAIR (ALGO-019, grader band 5 CRITICAL) ------------------------------
        # THE WINDOW JOIN ABOVE CREDITS THE BOT WITH TRADES ITS OWN BUDGET FORBIDS.
        # `session_budget.MAX_FULLY_APPROVED_EXECUTED_TRADES_PER_SESSION` is 1 and three
        # production sites enforce it, so ONLY `decisions[0]` can ever execute. In 7 of 14
        # sessions that first A+ lands BEFORE the audited window opens - by up to 103 minutes
        # - and `in_window[0]` then reports an entry the bullet had already been spent on.
        # 2026-03-23 was published AGREE while production went the OPPOSITE direction 57
        # minutes before the window opened.
        #
        # The budget-faithful answer: if the bullet is spent before the window, the bot CANNOT
        # act inside it, and a trader entry there is a MISS - not an agreement.
        # Emitted beside the window join rather than replacing it, so the session contract the
        # calibration generator consumes is untouched and consumers choose explicitly.
        # ---- G-3 REPAIR (ALGO-020 section 1 item 7) ---------------------------------
        # Everything below indexes `decisions[0]` and `in_window[0]`, which assumes
        # `iter_actionable_candidates` yields in decision-clock order. NOTHING PINNED THAT,
        # and 2026-04-02's mixed in-window sequence (L,S,S) makes the recorded direction
        # order-dependent. Post-F-1 the "first" decides the entire headline. Refuse rather
        # than assume: this is the one place the order is knowable.
        clocks = [pd.Timestamp(d["bot_entry_time"]) for d in decisions]
        if clocks != sorted(clocks):
            raise RuntimeError(
                f"DECISION_CLOCKS_NOT_IN_ORDER for {case['case_id']}: {clocks}. "
                f"`decisions[0]` is not the session's first entry and every figure "
                f"downstream of it is wrong.")

        session_first = decisions[0] if decisions else None
        spent_before = bool(
            session_first is not None
            and pd.Timestamp(session_first["bot_entry_time"]) < start)
        executable = None if (session_first is None or spent_before) else session_first

        row = {
            "case_id": case["case_id"], "session": case["session"],
            "window_status": status, **first,
            "decision_count_through_end": len(decisions),
            "decision_count_in_window": len(in_window),
            "decisions_discarded_by_first_only": len(decisions) - 1,
            "budget_faithful": {
                "one_trade_budget": MAX_FULLY_APPROVED_EXECUTED_TRADES_PER_SESSION,
                "session_first_entry_time": (
                    session_first["bot_entry_time"] if session_first else None),
                "session_first_action": (
                    session_first["bot_action"] if session_first else None),
                "bullet_spent_before_window": spent_before,
                "executable_in_window": bool(executable),
                "in_window_entries_the_budget_forbids": len(in_window) if spent_before else 0,
                "note": (
                    "Only the session's FIRST fully-approved entry can execute. When it "
                    "precedes the window, every in-window entry is unreachable and must not "
                    "be scored as the bot's decision."),
            },
        }
        def _payload(w):
            return {
                "bot_action": w["bot_action"],
                "bot_entry_time": w["bot_entry_time"],
                "bot_setup": w["bot_setup"],
                "bot_reason": w["bot_reason"],
                "bot_location_id": w["bot_location_id"],
                "bot_location_source": w["bot_location_source"],
                "bot_target_source": w["bot_target_source"],
                "bot_target_kind": w["bot_target_kind"],
                "bot_target_raw": w["bot_target_raw"],
                "bot_target_executable": w["bot_target_executable"],
                "bot_path_reason": w["bot_path_reason"],
                "force_receipt": w.get("force_receipt"),
            }

        # TWO SURFACES, SEPARATELY AND LABELLED — ALGO-020 section 1 repair contract item 1.
        #   `in_window`           PRODUCTION-FAITHFUL. Budget-honoring, and THE HEADLINE.
        #   `authorization_view`  the budget-IGNORED kernel view. Diagnostic ONLY. It answers
        #                         "what would the authorization layer have permitted here",
        #                         never "what did the bot do".
        row["in_window"] = _payload(executable) if executable is not None else None
        row["in_window_actions"] = (
            [executable["bot_action"]] if executable is not None else [])
        row["authorization_view"] = {
            "SURFACE": "BUDGET_IGNORED_DIAGNOSTIC_ONLY_NOT_THE_BOT_S_DECISION",
            "first_permitted_in_window": _payload(in_window[0]) if in_window else None,
            "all_in_window_actions": [d["bot_action"] for d in in_window],
            "count": len(in_window),
            "why_it_is_not_the_headline": (
                "the one-trade budget means only the session's first fully-approved entry can "
                "execute. Where that entry precedes the window, everything listed here is "
                "unreachable. Scoring it as the bot's decision is exactly the refuted F-1 join."),
        }
        rows.append(row)

    return {
        "status": "POST_REPAIR_SAME_WINDOW_BOT_REGRADE_NOT_EDGE_EVIDENCE",
        "source_pack_id": manifest["source_pack_id"],
        "case_count": len(rows),
        "contains_trader_decisions": False,
        "pnl_or_exit_used": False,
        "rows": rows,
    }
