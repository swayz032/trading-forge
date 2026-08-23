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
T_DERIV = "tests/test_current_mnq_strategy_v2_4_derivation.py"
T_AUTH = "tests/test_current_mnq_strategy_v2_4_entry_authority.py"
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

    (4, "allow force alone to authorize a trade", AUTH,
     "    if not story.complete:\n"
     "        return Authority(WAIT_NO_STORY, None, story, False,\n"
     "                         story.refusal or WAIT_NO_STORY)",
     "    if False:\n"
     "        return Authority(WAIT_NO_STORY, None, story, False,\n"
     "                         story.refusal or WAIT_NO_STORY)",
     f"{T_AUTH}::test_an_incomplete_story_stops_before_force"),

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
]

NOT_APPLICABLE = {
    6: "allow the first completed breakout candle to enter automatically",
    7: "remove second-5m extreme extension from normal breakout",
    8: "allow ordinary momentum to satisfy displacement exception #1",
    9: "allow displacement third candle after it loses directional control",
    10: "satisfy exception #2 without a real prior test/rejection",
    11: "satisfy exception #2 without a meaningful reset",
    12: "satisfy exception #2 without a true retest/return breakout attack",
    13: "create a third pre-break exception",
    14: "use final parent-5m OHLC to backdate an earlier entry",
}


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
    START = {p: sha(p) for p in (DERIV, AUTH)}

    for item, desc, path, find, repl, test in ARMS:
        if not run(test):
            print(f"  §7.{item:<3} ABORT - {test} is already RED; a kill would prove nothing")
            failures.append(item)
            results.append({"item": item, "description": desc, "outcome": "ABORT_ALREADY_RED"})
            continue

        raw = io.open(path, "rb").read()
        before = sha(path)
        src = io.open(path, encoding="utf-8").read()
        n = src.count(find)
        if n != 1:
            print(f"  §7.{item:<3} TARGET NOT UNIQUE ({n}) in {path}")
            failures.append(item)
            results.append({"item": item, "description": desc,
                            "outcome": f"TARGET_NOT_UNIQUE_{n}"})
            continue
        try:
            io.open(path, "w", encoding="utf-8", newline="\n").write(src.replace(find, repl))
            if sha(path) == before:
                print(f"  §7.{item:<3} SILENT NO-OP MUTATION")
                failures.append(item)
                results.append({"item": item, "description": desc, "outcome": "SILENT_NO_OP"})
                continue
            killed = not run(test)
            print(f"  §7.{item:<3} {'KILLED  ' if killed else 'SURVIVED'}  {desc}")
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

    dirty = subprocess.run(["git", "status", "--porcelain", DERIV, AUTH],
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
        "owned_and_run": len(ARMS),
        "killed": sum(1 for r in results if r["outcome"] == "KILLED"),
        "not_yet_applicable": {str(k): v for k, v in NOT_APPLICABLE.items()},
        "scope_note": (
            "6 of section 7's 15 items belong to the layers built so far. Items 6-14 concern "
            "the breakout and pre-break routes, which are NOT YET BUILT - reporting 6/6 as if "
            "it were the whole campaign would be a false green."),
        "restored_byte_exact": True,
        "results": results,
    }
    io.open(OUT, "w", encoding="utf-8", newline="\n").write(
        json.dumps(out, indent=2, ensure_ascii=False) + "\n")

    print(f"\nwrote {OUT}")
    print(f"  killed {out['killed']} of {out['owned_and_run']} owned; "
          f"{len(NOT_APPLICABLE)} items not yet applicable (routes not built)")
    if failures:
        print(f"\nCAMPAIGN FAILED for section 7 items: {sorted(set(failures))}")
        return 1
    print("\nCAMPAIGN PASSED for every item the built layers own.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
