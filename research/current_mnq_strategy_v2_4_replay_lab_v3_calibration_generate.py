#!/usr/bin/env python3
"""Generate an automated momentum-heavy bilateral-context calibration artifact.

This is fidelity regression only. It may reuse seen development sessions because
no PnL/exit/winner information participates. The trader has already supplied and
frozen the manual evidence corpus; this generator is machine verification and does
not request new trader replay work.

Current strategy scope is closed: structural support/resistance, liquidity/reaction
clusters and active 15m FVGs only. PDH/PDL/PWH/PWL are never supplied to reaction
construction.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pandas as pd

from research import current_mnq_strategy_v2_2_engine_final as old
from research import current_mnq_strategy_v2_4_engine as v24
from research import current_mnq_strategy_v2_4_replay_lab_v3 as v3
from research import current_mnq_strategy_v2_4_replay_lab_v3_selection as sel
from research.current_mnq_strategy_v2_4_frozen_replay_regrade import regrade_frozen_case_windows
from research.current_mnq_strategy_v2_4_fvg import active_15m_fvgs
from research.current_mnq_strategy_v2_4_targets import build_reaction_destinations

ROOT = Path("research/_mnq_v24_replay_lab_v3")
DATA = ROOT / "data"
OUT = ROOT / "pack"
LOCK = Path("research/current_mnq_strategy_v2_2_data_lock.json")
REQ = Path("research/current_mnq_strategy_v2_4_replay_calibration_requirements.json")


def _extended_make_case(env: dict, dte, anchor: pd.Timestamp, kind: str) -> v3.ReplayCaseV3:
    start, end = v3._bounds(dte, anchor)
    one = env["one"]
    replay = one[
        (one.index >= start)
        & ((one.index + pd.Timedelta(minutes=1)) <= end)
    ][["open", "high", "low", "close"]].copy()
    return v3.ReplayCaseV3(
        case_id=v3._case_id(dte, anchor, kind),
        session=str(dte),
        replay_start=start.isoformat(),
        replay_end=end.isoformat(),
        context_1m=v3._bar_json(v3._completed(one, start, 1, pd.Timedelta(minutes=60)), 1),
        context_5m=v3._bar_json(v3._completed(env["full5"], start, 5, pd.Timedelta(days=10)), 5),
        context_15m=v3._bar_json(v3._completed(env["h15"], start, 15, pd.Timedelta(days=40)), 15),
        replay_1m=v3._bar_json(replay, 1),
    )


def _reference_candidate(env: dict, dte, p):
    # Use the selection module's exact production-policy helper. It passes the
    # candidate's location/reason into the TP policy so processed-reaction
    # continuation cannot diverge from historical/live execution semantics.
    full = sel._authoritative_first_entry(env, dte, p)
    if full is not None:
        cand, _actionable, _plan, t, price, _picked, _reason = full
        return "AUTHORITATIVE", cand, t, float(price)
    miss = sel._first_momentum_near_miss(env, dte, p)
    if miss is not None:
        cand, _actionable, _plan, t, price, _path_reason = miss
        return "MOMENTUM_NEAR_MISS", cand, t, float(price)
    return None


def _meaningful_destinations(env: dict, dte, asof: pd.Timestamp, price: float, direction: str, p):
    return [
        x for x in build_reaction_destinations(
            env["piv5"], env["full5"], env["h15"], asof, p,
            {}, {}, dte, price, direction,
            piv15=env["piv15"],
        )
        if bool(x.meaningful) and float(x.first_contact_distance) > 0
    ]


def _bilateral_context(env: dict, dte, asof: pd.Timestamp, price: float, p) -> bool:
    return bool(
        _meaningful_destinations(env, dte, asof, price, "L", p)
        and _meaningful_destinations(env, dte, asof, price, "S", p)
    )


def _fvg_rows(env: dict, replay_start: str) -> list[dict]:
    asof = pd.Timestamp(replay_start)
    return [
        {
            "direction": str(x.direction),
            "lo": float(x.lo),
            "hi": float(x.hi),
            "mid": float(x.mid),
            "formed_at": x.formed_at.isoformat(),
            "source": str(x.source),
        }
        for x in active_15m_fvgs(env["h15"], asof)
    ]


def main() -> None:
    req = json.loads(REQ.read_text())
    if req.get("status") != "LOCKED_TRADER_FIDELITY_CALIBRATION_REQUIREMENTS":
        raise RuntimeError("REPLAY_CALIBRATION_REQUIREMENTS_NOT_LOCKED")

    observed = old.download_pinned(DATA, include_tick=False)
    lock = json.loads(LOCK.read_text())
    old.verify_manifest(observed, lock)
    raw5 = old.load_csv(DATA / Path(old.DATA_FILES["5m"]).name)
    raw1 = old.load_csv(DATA / Path(old.DATA_FILES["1m"]).name)
    dq = old.data_quality_gate(raw1, raw5)
    if dq["status"] != "PASS":
        raise RuntimeError("REPLAY_CALIBRATION_DATA_QUALITY_FAIL:" + "|".join(dq["issues"]))

    env = old.prepare(raw5, raw1)
    p = v24.Params()
    all_days = list(old.scoreable_days(env))

    eligible = []
    kinds = {}
    for dte in all_days:
        ref = _reference_candidate(env, dte, p)
        if ref is None:
            continue
        kind, cand, asof, price = ref
        if not _bilateral_context(env, dte, asof, price, p):
            continue
        eligible.append(dte)
        kinds[str(dte)] = {
            "reference_kind": kind,
            "reason": str(cand.reason),
            "reference_time": asof.isoformat(),
        }

    if not eligible:
        raise RuntimeError("REPLAY_CALIBRATION_NO_BILATERAL_MOMENTUM_SESSIONS")

    target = min(int(req["sampling"]["target_cases"]), len(eligible))
    original_make_case = v3._make_case
    v3._make_case = _extended_make_case
    try:
        review, answers = sel.build_replay_pack_v3_diverse(
            env,
            eligible,
            p,
            max_cases=target,
            max_entry_cases=target,
            min_entry_cases=0,
            min_momentum_near_miss_cases=0,
        )
    finally:
        v3._make_case = original_make_case

    # Objective causal 15m FVG context is safe machine-visible market structure;
    # it contains no selected target, PnL, or future outcome.
    for case in review["cases"]:
        case["context_15m_active_fvgs_at_replay_start"] = _fvg_rows(env, case["replay_start"])
        case["calibration_context"] = {
            "bilateral_meaningful_reaction_context": True,
            "context_15m_days": 40,
            "context_5m_days": 10,
            "context_1m_minutes": 60,
        }

    review["status"] = "AUTOMATED_FIDELITY_REGRESSION_MOMENTUM_HEAVY_BILATERAL_CONTEXT"
    review["calibration_requirements"] = str(REQ)
    review["target_policy"] = "current_mnq_strategy_v2_4_target_policy"
    review["tp_instruction"] = (
        "Machine regression context: valid targets are structural support/resistance reaction "
        "zones, 5m liquidity/reaction clusters, or the midpoint of an active 15m FVG. "
        "PDH/PDL/PWH/PWL are not strategy inputs. For entry safety, the planned TP display "
        "uses the trader's frozen $400 reference rule: $400+ at 15 MNQ can still be enough "
        "gap if every other A+ gate passes; under $400 blocks immediate entry. An untouched "
        "under-$400 TP1 may not be blindly skipped for TP2. A later valid continuation earned "
        "at that same reaction area can make the next meaningful destination active."
    )
    review["pack_id"] = hashlib.sha256(
        json.dumps(review["cases"], sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    answers["pack_id"] = review["pack_id"]

    # The trader has already frozen labels for the old 14-case pack. Regrade the
    # repaired bot on those same windows without requesting any new trader labels.
    answers["post_repair_same_window_regrade"] = regrade_frozen_case_windows(env, p)

    v3.write_lab_v3(OUT, review, answers)

    sampling = answers.get("sampling_receipt", {})
    authoritative = int(sampling.get("authoritative_entry_cases", 0))
    near_miss = int(sampling.get("momentum_near_miss_cases", 0))
    receipt = {
        "status": "AUTOMATED_FIDELITY_REGRESSION_READY",
        "strategy_release": req["strategy_release"],
        "pack_id": review["pack_id"],
        "case_count": review["case_count"],
        "session_count": review["session_count"],
        "eligible_bilateral_momentum_sessions": len(eligible),
        "authoritative_entry_cases": authoritative,
        "momentum_near_miss_cases": near_miss,
        "momentum_or_entry_cases": authoritative + near_miss,
        "all_cases_require_bilateral_meaningful_reaction_context": True,
        "context_15m_days": 40,
        "context_5m_days": 10,
        "context_1m_minutes": 60,
        "active_15m_fvg_context_embedded": True,
        "active_15m_fvg_midpoint_is_valid_tp_when_first_reaction": True,
        "legacy_named_daily_weekly_levels_used": False,
        "tp_reference_safe_floor_usd": 400.0,
        "tp_reference_contracts": 15,
        "untouched_under_400_tp1_blind_rollover_allowed": False,
        "processed_reaction_can_promote_next_destination": True,
        "answer_key_uses_production_target_policy": True,
        "post_repair_same_window_regrade_embedded_in_hidden_key": True,
        "manual_trader_replay_requested": False,
        "seen_development_sessions_may_be_reused": True,
        "blind_evidence_eligible": False,
        "edge_evidence_eligible": False,
        "pnl_or_exit_outcome_used_for_selection": False,
        "selected_reference_metadata": {
            c["session"]: kinds.get(c["session"], {}) for c in review["cases"]
        },
    }
    (OUT / "calibration_receipt_v3.json").write_text(
        json.dumps(receipt, indent=2, sort_keys=True), encoding="utf-8"
    )
    print(json.dumps(receipt, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
