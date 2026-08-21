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
        yield {
            "bot_action": "ENTER_LONG" if cand.direction == "L" else "ENTER_SHORT",
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
            })
            continue

        first = decisions[0]
        t = pd.Timestamp(first["bot_entry_time"])
        if t < start:
            status = "FIRST_A_PLUS_PRECEDES_OLD_REPLAY_WINDOW"
        else:
            status = "FIRST_A_PLUS_INSIDE_OLD_REPLAY_WINDOW"
        rows.append({
            "case_id": case["case_id"], "session": case["session"],
            "window_status": status, **first,
        })

    return {
        "status": "POST_REPAIR_SAME_WINDOW_BOT_REGRADE_NOT_EDGE_EVIDENCE",
        "source_pack_id": manifest["source_pack_id"],
        "case_count": len(rows),
        "contains_trader_decisions": False,
        "pnl_or_exit_used": False,
        "rows": rows,
    }
