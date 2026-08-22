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
        fs = force_snapshot(env["one"], cand.signal_time, 5, cand.direction,
                            cand.confirmed_time, p)
        force_receipt = {
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
        if not fs.confirmed:
            # The kernel force-gates before yielding, so an unconfirmed snapshot here means
            # the recomputation has diverged from the gate. Fail loudly rather than publish
            # a receipt that disagrees with the decision it describes.
            raise RuntimeError(
                f"FORCE_RECEIPT_DISAGREES_WITH_KERNEL_GATE at {cand.confirmed_time}: "
                f"{fs.reason}")

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
            rows.append({
                "case_id": case["case_id"], "session": case["session"],
                "window_status": "NO_FULL_ENTRY_THROUGH_REPLAY_END",
                "bot_action": "NO_TRADE_THROUGH_WINDOW", "bot_entry_time": None,
                "decision_count_through_end": 0,
                "decision_count_in_window": 0,
                "decisions_discarded_by_first_only": 0,
                "in_window": None,
                "in_window_actions": [],
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
        row = {
            "case_id": case["case_id"], "session": case["session"],
            "window_status": status, **first,
            "decision_count_through_end": len(decisions),
            "decision_count_in_window": len(in_window),
            "decisions_discarded_by_first_only": len(decisions) - 1,
        }
        if in_window:
            w = in_window[0]
            row["in_window"] = {
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
            row["in_window_actions"] = [d["bot_action"] for d in in_window]
        else:
            row["in_window"] = None
            row["in_window_actions"] = []
        rows.append(row)

    return {
        "status": "POST_REPAIR_SAME_WINDOW_BOT_REGRADE_NOT_EDGE_EVIDENCE",
        "source_pack_id": manifest["source_pack_id"],
        "case_count": len(rows),
        "contains_trader_decisions": False,
        "pnl_or_exit_used": False,
        "rows": rows,
    }
