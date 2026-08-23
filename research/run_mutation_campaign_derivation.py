#!/usr/bin/env python3
"""ALGO-009 §7 mutation campaign, for the layers that exist. Byte-exact restore, verified.

"The breakthrough is not accepted until planted defects are killed." §7 lists fifteen. Six of
them belong to the layers built so far; the other nine concern the breakout and pre-break
routes, which are NOT YET BUILT, and this harness says so rather than reporting a smaller
denominator as if it were the whole campaign.

    OWNED AND RUN HERE
      1  turn a plain touch into a valid rejection
      2  hard-code approach=True without measured approach evidence
      3  hard-code takeover/control without control-transfer evidence
      4  allow force alone to authorize a trade
      5  allow a named candle pattern away from the key level to authorize a trade
     15  consume the daily bullet on a candidate the state machine classifies WAIT

    NOT YET APPLICABLE - the routes do not exist
      6-14  normal breakout, second-5m extension, displacement exceptions, retest,
            third-exception ban, parent-OHLC backdating

EVERY ARM: positive witness that the named test is GREEN first (a red-before proves nothing),
a mutation target that must be UNIQUE, a SHA256 check that the file actually changed (a silent
no-op replace already cost a cycle on this campaign), the named test must go RED, then the
bytes are restored and re-verified by SHA256 against this run's OWN starting bytes.

`git status` is INFORMATIONAL here and is not the restore proof. An earlier version asserted git
cleanliness, which cannot distinguish "the harness failed to restore" from "the developer has
uncommitted work in this file" - and it raised a HARD FAIL on legitimate in-progress edits. A
false alarm on a safety check is worse than none, because it teaches you to ignore the real one.

Run: PYTHONPATH=. python -m research.run_mutation_campaign_derivation
"""
from __future__ import annotations

import hashlib
import io
import json
import subprocess
import sys
from pathlib import Path

DERIV = "research/current_mnq_strategy_v2_4_derivation.py"
AUTH = "research/current_mnq_strategy_v2_4_entry_authority.py"
BRK = "research/current_mnq_strategy_v2_4_breakout_derivation.py"
T_DERIV = "tests/test_current_mnq_strategy_v2_4_derivation.py"
T_AUTH = "tests/test_current_mnq_strategy_v2_4_entry_authority.py"
T_BRK = "tests/test_current_mnq_strategy_v2_4_breakout_derivation.py"
OUT = Path("research/current_mnq_strategy_v2_4_mutation_campaign_2026_08_23.json")

#: (§7 item, description, file, find, replace, test that MUST go red)
ARMS = [
    (1, "turn a plain touch into a valid rejection", DERIV,
     "        return bool(self.reached and self.came_from_outside)",
     "        return bool(self.reached)",
     f"{T_DERIV}::test_price_that_sat_INSIDE_the_zone_all_along_has_approached_nothing"),

    (2, "hard-code approach=True without measured evidence", DERIV,
     "    if bars is None or len(bars) < 2:\n"
     "        return Approach(False, False, None, None, NOT_ENOUGH_BARS)",
     "    if True:\n"
     "        return Approach(True, True, 1, \"ABOVE\", None)",
     f"{T_DERIV}::test_price_that_never_touches_the_zone_is_NOT_an_approach"),

    (3, "hard-code control/takeover without control-transfer evidence", DERIV,
     "def _control(row, direction: str, body_frac: float, close_loc: float) -> bool:",
     "def _control(row, direction: str, body_frac: float, close_loc: float) -> bool:\n"
     "    return True",
     f"{T_DERIV}::test_a_touch_with_no_directional_control_is_refused"),

    (4, "allow force alone to authorize a trade (route A story gate)", AUTH,
     "        if not story.complete:\n"
     "            return Authority(WAIT_NO_STORY, None, story, False,\n"
     "                             story.refusal or WAIT_NO_STORY)",
     "        if False:\n"
     "            return Authority(WAIT_NO_STORY, None, story, False,\n"
     "                             story.refusal or WAIT_NO_STORY)",
     f"{T_AUTH}::test_an_incomplete_story_stops_before_force"),

    # The SECOND door into the same defect. Routes B/C/D do not have a rejection story, so
    # they have their own gate - and a campaign that killed only the route A door would have
    # closed the instance it was shown and left the condition wide open.
    (4, "allow force alone to authorize a trade (routes B/C/D evidence gate)", AUTH,
     "        if not read.valid:",
     "        if False and not read.valid:",
     f"{T_AUTH}::test_the_three_breakout_routes_refuse_PURE_rejection_evidence"),

    (5, "allow a candle pattern away from the key level to authorize", DERIV,
     "    ap = derive_approach(bars, lo, hi, pad, lookback)\n"
     "    if not ap.real:",
     "    ap = derive_approach(bars, lo, hi, pad, lookback)\n"
     "    if False:",
     f"{T_DERIV}::test_no_interaction_is_returned_without_a_real_approach"),

    (15, "consume the bullet on a candidate the machine classifies WAIT", AUTH,
     "        return bool(self.state == GRANTED and self.route in ROUTES)",
     "        return True",
     f"{T_AUTH}::test_no_authorized_location_stops_at_step_one"),

    # --- items 6-14: the breakout and pre-break routes, built 2026-08-23 -------------------

    (6, "let the first completed breakout candle enter automatically", BRK,
     "    first = rows[first_idx]",
     "    return BreakoutRead(\"normal_breakout\", None, first_idx)\n"
     "    first = rows[first_idx]",
     f"{T_BRK}::test_the_first_completed_break_candle_NEVER_enters_on_its_own"),

    (7, "remove the second-5m extreme extension from the normal breakout", BRK,
     "    extended = (float(trigger.high) > float(first.high)) if direction == \"L\" \\\n"
     "        else (float(trigger.low) < float(first.low))",
     "    extended = True",
     f"{T_BRK}::test_second_5m_momentum_without_extreme_extension_is_WAIT"),

    (8, "let ordinary momentum satisfy displacement exception #1", BRK,
     "    return bool(_geom(row).range >= reference_range * range_ratio)",
     "    return True",
     f"{T_BRK}::test_ordinary_momentum_is_NOT_displacement"),

    (9, "accept a displacement third candle after it loses directional control", BRK,
     "    if not _momentum(seq[2], direction, body_frac, close_loc):\n"
     "        return BreakoutRead(None, THIRD_CANDLE_LOST_CONTROL)",
     "    if False:\n"
     "        return BreakoutRead(None, THIRD_CANDLE_LOST_CONTROL)",
     f"{T_BRK}::test_a_third_candle_that_reverses_control_kills_the_sequence"),

    (10, "satisfy exception #2 with no real prior test or rejection", BRK,
     "    if test_idx is None:\n"
     "        return BreakoutRead(None, NO_PRIOR_TEST)",
     "    if test_idx is None:\n"
     "        test_idx = 0",
     f"{T_BRK}::test_repeat_test_without_a_real_prior_test_is_refused"),

    (11, "satisfy exception #2 with no meaningful reset", BRK,
     "    reset = any(not touches(r) for r in after)",
     "    reset = True",
     f"{T_BRK}::test_repeat_test_without_a_meaningful_reset_is_refused"),

    (12, "satisfy exception #2 with no true retest or return attack", BRK,
     "    if not _momentum(trigger, direction, body_frac, close_loc):\n"
     "        return BreakoutRead(None, NO_RETURN_ATTACK, test_idx)\n"
     "    return BreakoutRead(EXCEPTION_REPEAT_TEST, None, test_idx)",
     "    return BreakoutRead(EXCEPTION_REPEAT_TEST, None, test_idx)",
     f"{T_BRK}::test_repeat_test_without_a_true_return_attack_is_refused"),

    (13, "create a third pre-break exception", BRK,
     "PREBREAK_EXCEPTIONS = (EXCEPTION_DISPLACEMENT, EXCEPTION_REPEAT_TEST)",
     "PREBREAK_EXCEPTIONS = (EXCEPTION_DISPLACEMENT, EXCEPTION_REPEAT_TEST,\n"
     "                       \"third_exception_invented_here\")",
     f"{T_BRK}::test_the_two_exceptions_match_the_frozen_spec_VERBATIM"),

    (14, "collapse the completed/trigger split so the parent's final OHLC is reachable", BRK,
     "def normal_breakout(completed: pd.DataFrame, trigger,",
     "def normal_breakout(bars: pd.DataFrame, trigger,",
     f"{T_BRK}::test_no_function_can_see_the_triggers_finished_form"),

    # --- NOT section 7 items --------------------------------------------------------------
    # Section 7 enumerates fifteen defects and none of them is about the BRK15 variant, so
    # these are reported OUTSIDE its denominator. Numbering them 7.16+ would invent coverage
    # the ruling never asked for, and an inflated denominator is the same lie as a shrunken
    # one - just in the flattering direction.
    ("V1", "let a STRONG first break enter through the weak-break variant", BRK,
     "    if _momentum(bar1, direction, body_frac, close_loc):\n"
     "        return BreakoutRead(None, BREAK_WAS_NOT_WEAK)",
     "    if False:\n"
     "        return BreakoutRead(None, BREAK_WAS_NOT_WEAK)",
     f"{T_BRK}::test_a_STRONG_first_break_is_refused_by_the_variant"),

    ("V2", "accept a pullback that gave the level back", BRK,
     "    if not held:\n"
     "        return BreakoutRead(None, PULLBACK_LOST_THE_LEVEL)",
     "    if False:\n"
     "        return BreakoutRead(None, PULLBACK_LOST_THE_LEVEL)",
     f"{T_BRK}::test_a_pullback_that_gives_the_level_back_is_a_FAILED_break_not_a_setup"),

    ("V3", "let the variant become a fifth route by accepting it under any route", AUTH,
     "        if variant == VARIANT_BRK15 and route != ROUTE_B_BREAKOUT:",
     "        if False:",
     f"{T_AUTH}::test_the_variant_cannot_be_smuggled_in_under_another_route"),
]


def _section7_items():
    """DERIVED from ARMS. An arm whose id is not an integer is not a section 7 item."""
    return {a[0] for a in ARMS if isinstance(a[0], int)}

NOT_APPLICABLE: dict[int, str] = {}

#: Item 14 is defended STRUCTURALLY rather than by a predicate: no function in the breakout
#: module ever receives the forming parent's finished OHLC, so there is nothing to backdate
#: from. The mutation therefore attacks the architecture - it collapses the completed/trigger
#: split - and what it proves is that the split is load-bearing. It does NOT prove that some
#: other layer refuses a backdated entry clock; that belongs to the kernel and is not built
#: here. Saying so is the point: a kill whose scope is overstated is a false green.
CAVEATS = {
    14: ("defended structurally, not by a predicate - the kill proves the completed/trigger "
         "split is load-bearing, not that a backdated entry clock is refused elsewhere"),
}


def label(item) -> str:
    """A non-section-7 arm must not print wearing a section 7 number."""
    return f"S7.{item}" if isinstance(item, int) else f"variant.{item}"


def sha(p: str) -> str:
    return hashlib.sha256(io.open(p, "rb").read()).hexdigest()


def run(nodeid: str) -> bool:
    r = subprocess.run([sys.executable, "-m", "pytest", nodeid, "-q", "--no-header",
                        "-p", "no:cacheprovider"], capture_output=True, text=True)
    return r.returncode == 0


def main() -> int:
    results, failures = [], []
    #: The bytes this run started with. The restore proof is equality against THESE, because
    #: git cleanliness answers a different question entirely.
    START = {p: sha(p) for p in (DERIV, AUTH, BRK)}

    for item, desc, path, find, repl, test in ARMS:
        if not run(test):
            print(f"  {label(item):<12} ABORT - {test} is already RED; a kill proves nothing")
            failures.append(item)
            results.append({"item": item, "description": desc, "outcome": "ABORT_ALREADY_RED"})
            continue

        raw = io.open(path, "rb").read()
        before = sha(path)
        src = io.open(path, encoding="utf-8").read()
        n = src.count(find)
        if n != 1:
            print(f"  {label(item):<12} TARGET NOT UNIQUE ({n}) in {path}")
            failures.append(item)
            results.append({"item": item, "description": desc,
                            "outcome": f"TARGET_NOT_UNIQUE_{n}"})
            continue
        try:
            io.open(path, "w", encoding="utf-8", newline="\n").write(src.replace(find, repl))
            if sha(path) == before:
                print(f"  {label(item):<12} SILENT NO-OP MUTATION")
                failures.append(item)
                results.append({"item": item, "description": desc, "outcome": "SILENT_NO_OP"})
                continue
            killed = not run(test)
            print(f"  {label(item):<12} {'KILLED  ' if killed else 'SURVIVED'}  {desc}")
            if not killed:
                failures.append(item)
            results.append({"item": item, "description": desc, "file": path, "test": test,
                            "outcome": "KILLED" if killed else "SURVIVED"})
        finally:
            io.open(path, "wb").write(raw)
            assert sha(path) == before, f"RESTORE FAILED for {path}"

    # RESTORE CHECK. Compare against the bytes THIS HARNESS started with, never against git
    # cleanliness. The first version asserted `git status` was clean, which cannot tell
    # "the harness failed to restore" from "the developer has uncommitted work in this file" -
    # and it raised a HARD FAIL on legitimate in-progress edits. A false alarm on a safety
    # check is worse than none, because it teaches you to ignore the real one.
    not_restored = [p for p, before in START.items() if sha(p) != before]
    if not_restored:
        print(f"\nHARD FAIL: bytes were not restored: {not_restored}")
        return 1
    print("\nrestore verified by SHA256 against this run's own starting bytes")

    dirty = subprocess.run(["git", "status", "--porcelain", DERIV, AUTH, BRK],
                           capture_output=True, text=True).stdout.strip()
    if dirty:
        print(f"note: these files have uncommitted work unrelated to the campaign:\n{dirty}")
        print("      (informational - the SHA check above is the restore proof)")

    for _, _, _, _, _, test in ARMS:
        if not run(test):
            print(f"HARD FAIL: {test} did not return GREEN after restore")
            return 1
    print("all named tests GREEN again after restore")

    out = {
        "artifact": "MUTATION_CAMPAIGN_DERIVATION_LAYERS",
        "authority": "ALGO-009 section 7",
        "produced": "2026-08-23",
        "owned_and_run": len(_section7_items()),
        "mutations_run": len(ARMS),
        "section7_mutations": sum(1 for a in ARMS if isinstance(a[0], int)),
        "extra_mutations_outside_section7": {
            str(a[0]): a[1] for a in ARMS if not isinstance(a[0], int)},
        "extra_note": (
            "section 7 enumerates fifteen defects and none is about the BRK15 variant, "
            "so the V-arms are reported OUTSIDE its denominator. Numbering them 7.16+ "
            "would invent coverage the ruling never asked for - an inflated denominator "
            "is the same lie as a shrunken one, in the flattering direction."),
        "killed": sum(1 for r in results if r["outcome"] == "KILLED"),
        "items_with_two_doors": sorted(
            {i for i in (a[0] for a in ARMS) if isinstance(i, int)
             and sum(1 for a in ARMS if a[0] == i) > 1}),
        "not_yet_applicable": {str(k): v for k, v in NOT_APPLICABLE.items()},
        "caveats": {str(k): v for k, v in CAVEATS.items()},
        "scope_note": (
            "All 15 of section 7's items are now owned and run. Items 6-14 became runnable "
            "when routes B/C/D were built on 2026-08-23; before that they were deferred BY "
            "NAME rather than folded into a smaller denominator. Item 14 carries a caveat: "
            "its guard is architectural, so read `caveats` before quoting the kill. The V-arms are NOT section 7 items - see `extra_note`."),
        "restored_byte_exact": True,
        "results": results,
    }
    io.open(OUT, "w", encoding="utf-8", newline="\n").write(
        json.dumps(out, indent=2, ensure_ascii=False) + "\n")

    print(f"\nwrote {OUT}")
    print(f"  killed {out['killed']} of {out['mutations_run']} mutations: "
          f"{out['section7_mutations']} across {out['owned_and_run']} of section 7's 15 "
          f"items, plus {len(out['extra_mutations_outside_section7'])} outside it (BRK15)")
    if failures:
        print(f"\nCAMPAIGN FAILED for section 7 items: {sorted(set(failures))}")
        return 1
    print("\nCAMPAIGN PASSED for every item the built layers own.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
