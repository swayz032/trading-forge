#!/usr/bin/env python3
"""THE DUAL-WINDOW EXAM. The judgement of the wired brain against the trader.

ALGO-047 §2 ordered it, ALGO-049 amended it, and the rules below were fixed BEFORE any arm ran.

═══════════════════════════════════════════════════════════════════════════════
THE ACCEPTANCE RULES ARE PRE-REGISTERED. THEY ARE WRITTEN HERE BEFORE ANY RESULT EXISTS.
THE RULES DECIDE WHAT LANDS — NOT THE SCORE. 5/8 IS THE NUMBER TO BEAT HONESTLY.
═══════════════════════════════════════════════════════════════════════════════

TWO ARMS, AND NEITHER IS A CANDIDATE WINDOW.

  09:30 ARM   baseline-comparable. The frozen 5/8 was measured here, so this arm exists to be
              comparable to it — NOT to be deployed. ALGO-049 WITHDREW the revert; 09:30 is a
              RUN CONFIGURATION (`current_mnq_strategy_v2_4_exam_window.py`), never a committed
              constant again. That module is CALIBRATED: at the pre-wiring pin it reproduces
              5/8 exactly, so moving ROLE 1 by context manager equals moving it by constant.

  08:00 ARM   the taught truth and, per ALGO-049, the UNCONDITIONAL deployment window
              (08:00–12:00). The operator reasserted it and then showed why: a zone rejection
              firing at 08:50 that a 09:30 window censors entirely.

  A1  NO LOST AGREEMENT, COMPARED BY MEMBERSHIP. The 08:00 arm may not lose any DECIDED
      agreement the 09:30 arm had. Membership, never count: a count is satisfied by losing one
      session and gaining another, which is precisely the drift that must not pass silently.

  A2  THE WINDOW IS NEVER THE FIX AND NEVER THE CASUALTY. A degradation at 08:00 is an
      EARLY-ENTRY DEFECT IN THE BRAIN (ALGO-043). This module may therefore never emit a
      recommendation to move, narrow or revert the window; on a failure it names the brain and
      the sessions that convict it, and repairs are ruled then — not chosen here.

  A3  08:00 IS UNCONDITIONAL, SO A FAILING 08:00 ARM BLOCKS FREEZE. There is no 09:30-deployed
      fallback to retreat to (ALGO-049 §3). PASS is a precondition for FREEZE, never a grant of
      it: freezing remains the advisor's ruling.

  A4  CENSORED CASES NEVER CONVICT AND NEVER ACQUIT. Right-censored trader labels are excluded
      from BOTH numerator and denominator, on BOTH arms, and the classes are reported beside
      the verdict rather than folded into it. The asymmetric-censoring diagnostic stays visible
      and stays unadopted — a party may not adopt the reading that flatters it.

  A5  NEVER PICKED BY SCORE. No PnL, realized outcome, winner/loser label or clean-edge result
      participates. The verdict is a function of the pre-registered predicates ONLY, and
      `evaluate()` is pure so it can be handed fabricated arms and checked.

WHY THE TEACHING HASHES ARE HERE. ALGO-050/051/052 pinned six operator screenshots as the
RATIONALE for the 08:00 window and the taught mechanics. They are cited by hash because
identity is the hash and not the path, and they are rationale ONLY: no exam-set change, no
label, no new route, and no code derived from a screenshot. If the wired brain cannot produce
the taught behaviour, THIS EXAM CONVICTS IT — the screenshots do not get compiled into a fix.

Run: PYTHONPATH=. python -m research.run_exam_dual_window
"""
from __future__ import annotations

import io
import json
import time
from datetime import time as _time
from pathlib import Path

from research import current_mnq_strategy_v2_4_exam_window as W
from research import run_frozen_14_case_baseline as B

#: The two arms. Fixed here, before any result.
ARMS = {"baseline_0930": _time(9, 30), "taught_0800": _time(8, 0)}

#: ALGO-049 §3. The deployment window is not a variable this exam may recommend changing.
DEPLOYMENT_ARM = "taught_0800"

#: The frozen comparator. Named so the report cannot quietly re-baseline itself.
FROZEN_BASELINE = "5/8"

#: ALGO-050 (1) · ALGO-051 (3) · ALGO-052 (2). Rationale only — identity is the hash.
TEACHING_EVIDENCE = {
    "ALGO-050_0821_0850_zone_rejection_290pt":
        "0b71c0c12f291c8774a313629d5749308c862ce1ccd41c4b4de1823568a1dcaa",
    "ALGO-051_late_arrival_react_then_momentum_a":
        "5ac1a02346b7ce007b860964a1ac0b12b78565010718ce62cea0e8fd00cebc6e",
    "ALGO-051_late_arrival_react_then_momentum_b":
        "b69a1b9dfbf64c7a39206dbdbd9389f4cad7a5871610a8c40b8d15f1a19ccd14",
    "ALGO-051_late_arrival_react_then_momentum_c":
        "f48f460e251f862d0ba39d2cbb91571ab85bc21eac394b8bc4d157505060f969",
    "ALGO-052_zone_rejection_momentum_entry_5m":
        "f33d039a7227f2e0193e7ce5391ee3a171f0105f3368ce77120b9e4c4cf04d81",
    "ALGO-052_zone_rejection_momentum_entry_1m":
        "4e0ec9d3bab75b201dba161037143a5f6f99e5344c6ff5a0bdd1c6d9fe88a8e9",
}

PRE_REGISTERED = {
    "authority": "ALGO-047 §2, as amended by ALGO-049",
    "A1_no_lost_agreement": (
        "the 08:00 arm may not lose any DECIDED agreement the 09:30 arm had, compared by "
        "MEMBERSHIP of the agreeing sessions and never by count"),
    "A2_window_is_never_the_fix": (
        "a degradation at 08:00 is an early-entry defect IN THE BRAIN; this module may not "
        "recommend moving, narrowing or reverting the window"),
    "A3_unconditional_deployment_window": (
        "08:00-12:00 is unconditional, so a failing 08:00 arm BLOCKS FREEZE; there is no "
        "09:30-deployed fallback. A pass is a precondition for FREEZE, not a grant of it"),
    "A4_censoring": (
        "right-censored trader labels are excluded from both numerator and denominator on "
        "both arms; classes are reported beside the verdict, never folded into it"),
    "A5_never_by_score": (
        "no PnL, realized outcome, winner/loser label or clean-edge result participates; the "
        "verdict is a function of the pre-registered predicates only"),
}

OUT = Path("research/current_mnq_strategy_v2_4_exam_dual_window_2026_08_23.json")
ARM_OUT = "research/current_mnq_strategy_v2_4_exam_arm_{arm}_2026_08_23.json"


def _agreeing_sessions(scorecard: dict) -> set[str]:
    """The DECIDED agreements, as a SET of sessions. Censored cases are not decided."""
    return {c["session"] for c in scorecard["cases"]
            if c["mismatch_class"] in B.AGREEMENT_CLASSES}


def _decided_sessions(scorecard: dict) -> set[str]:
    return {c["session"] for c in scorecard["cases"]
            if not str(c["mismatch_class"]).startswith("CENSORED")}


def summarise_arm(name: str, scorecard: dict) -> dict:
    agg = scorecard["aggregates"]
    agreeing = _agreeing_sessions(scorecard)
    decided = _decided_sessions(scorecard)
    return {
        "arm": name,
        "window_start": str(ARMS[name]),
        "agreement": f"{len(agreeing)}/{len(decided)}",
        "agreeing_sessions": sorted(agreeing),
        "decided_sessions": sorted(decided),
        "censored_excluded": agg["censored_excluded_from_both_numerator_and_denominator"],
        "class_census": agg["mismatch_class_census"],
        "bot_entered_in_window": agg["bot_entered_in_window_count"],
        "bot_genuinely_declined_in_window": agg["bot_genuinely_declined_in_window_count"],
        "bot_unavailable_in_window": agg["bot_unavailable_in_window_count"],
        "bot_traded_at_all_in_the_session": agg["bot_traded_at_all_in_the_session_count"],
        "total_decisions_through_window_end": agg["total_decisions_through_window_end"],
        "asymmetric_censoring_diagnostic": agg["asymmetric_censoring_diagnostic"],
    }


def evaluate(baseline: dict, taught: dict) -> dict:
    """Apply the PRE-REGISTERED rules. PURE — no result may change the rule.

    A1 is the whole verdict, and it is deliberately a MEMBERSHIP test. `lost` is what convicts;
    `gained` is reported but may never offset a loss, because offsetting is how a count-shaped
    rule launders a regression.
    """
    base_agree = set(baseline["agreeing_sessions"])
    taught_agree = set(taught["agreeing_sessions"])
    lost = sorted(base_agree - taught_agree)
    gained = sorted(taught_agree - base_agree)

    passed = not lost
    return {
        "rule_applied": "A1_NO_LOST_AGREEMENT_BY_MEMBERSHIP",
        "verdict": "PASS" if passed else "FAIL",
        "lost_agreements": lost,
        "gained_agreements": gained,
        "offsetting_is_forbidden": (
            "a gained session may never offset a lost one; A1 is a membership test precisely "
            "so a regression cannot be laundered by an unrelated improvement"),
        "baseline_agreement": baseline["agreement"],
        "taught_agreement": taught["agreement"],
        "frozen_comparator": FROZEN_BASELINE,
        "what_a_failure_means": (
            "an EARLY-ENTRY DEFECT IN THE BRAIN on the sessions named in lost_agreements "
            "(ALGO-043). The window is never the fix and never the casualty; repairs are "
            "ruled from this evidence, not chosen here."),
        "freeze": ("PRECONDITION MET - freezing is still the advisor's ruling, never this "
                   "module's" if passed else
                   "BLOCKED. 08:00-12:00 is unconditional and there is no 09:30-deployed "
                   "fallback (ALGO-049 §3)."),
        "no_score_participated": PRE_REGISTERED["A5_never_by_score"],
    }


def _run_arm(name: str) -> dict:
    """Run the baseline end-to-end inside the arm's window, writing to the ARM's artifact.

    The committed scorecard is never overwritten by an exam arm: an arm is a measurement under
    a run configuration, not the canonical baseline, and letting it claim that filename would
    make the campaign's headline depend on whichever arm happened to run last.
    """
    arm_path = Path(ARM_OUT.format(arm=name))
    original_out = B.OUT
    try:
        B.OUT = arm_path
        W.run_window(ARMS[name], lambda: None, lambda _env: B.main())
    finally:
        B.OUT = original_out
    return json.load(io.open(arm_path, encoding="utf-8"))


def main() -> int:
    t0 = time.perf_counter()
    arms = {}
    for name in ARMS:
        print(f"--- arm {name} ({ARMS[name]}) ---")
        arms[name] = summarise_arm(name, _run_arm(name))

    verdict = evaluate(arms["baseline_0930"], arms[DEPLOYMENT_ARM])

    out = {
        "artifact": "EXAM_DUAL_WINDOW",
        "authority": "ALGO-047 §2 as amended by ALGO-049",
        "produced": "2026-08-23",
        "pre_registered": PRE_REGISTERED,
        "teaching_evidence_rationale_only": TEACHING_EVIDENCE,
        "teaching_evidence_note": (
            "rationale for the 08:00 window and the taught mechanics. NO exam-set change, no "
            "label, no new route, no code derived from a screenshot: if the brain cannot "
            "produce the taught behaviour, this exam convicts it."),
        "arms": arms,
        "verdict": verdict,
        "runtime_seconds": round(time.perf_counter() - t0, 2),
        "no_pnl": ("No PnL, realized outcome, winner/loser label or clean-edge result "
                   "participated in any decision in this exam."),
    }
    OUT.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print(f"\n  baseline 09:30 : {arms['baseline_0930']['agreement']}")
    print(f"  taught   08:00 : {arms[DEPLOYMENT_ARM]['agreement']}")
    print(f"  lost agreements: {verdict['lost_agreements'] or 'NONE'}")
    print(f"  VERDICT        : {verdict['verdict']}")
    print(f"  freeze         : {verdict['freeze']}")
    print(f"\nwrote {OUT}")
    return 0 if verdict["verdict"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
