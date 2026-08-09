"""B1 STEP 3 — ORDERED discrimination rule for OPENING_RANGE_DEFINITION, and the
six controls + corpus blast-radius read that must pass BEFORE it lands.

AUTHORITY: R-731 §2/§3, widened to a TWO-member population at R-732 §2, executing
`EXTERNAL-READ-2026-08-09-STEP3-DISCRIMINATION-TIGHTENED.md` PART 2 and
`...-WIDEN-TO-TWO-DEFINITIONS.md`. Read-only: it classifies text and reports;
it edits nothing.

🛑 IT IMPORTS THE PRODUCTION RULE (`opening_range_definition.classify_opening_
range_definition`) — the same function `spec_producer._classify_family` calls. It
does NOT carry its own copy. An instrument holding a private copy of the rule it
measures drifts from production silently and then passes while testing a rule
nothing runs.

WHY THE RULE IS ORDERED AND NOT A CONJUNCTION
---------------------------------------------
`R-730 §2` first stated the rule as "clock window AND range construction", and
`AR-824 §1` refuted it by measurement: the breakout sentence

    "so now we take a look at these levels projected going out after this
     30 minute range is over ... we look for a breakout"

carries BOTH halves. `R-731 §2` amended the design accordingly. The order IS the
mechanism:

    STAGE 1  reference/trigger evidence  -> REFUSE (blocks, whatever else is present)
    STAGE 2  positive definition evidence -> require explicit clock AND construction
    STAGE 3  anaphoric-only clock         -> REFUSE (no typed duration of its own)

WHY THIS IS NOT A `breakout` BLACKLIST
--------------------------------------
`R-731 §2` forbids implementing stage 1 as a word list, and the reason is the
campaign's own: `GOVERN WITH A CLOSED RULE, NOT AN OPEN LIST` — a blacklist is a
membership test over a list you can never finish.

Stage 1 tests a SEMANTIC RELATION with three closed classes, each of which is a
way of positioning the range as ALREADY CONSTRUCTED:

    CROSSING     a directional relation between price and an existing boundary
    CONSUMPTION  an action taken with respect to an existing range
    POSTERIORITY a time relation to the range's completion

A sentence exhibiting any of them is describing what to DO with a range, not how
the range is BUILT. The patterns below are evidence FOR those classes; the
classes are the rule. That distinction is what makes a new phrasing a question
about which class it belongs to, rather than a request to extend a list.

THE ANTI-CHEAT THIS INSTRUMENT ENFORCES ON ITSELF
-------------------------------------------------
`R-731 §3`, the most important line in that ruling:

    "STOP if any condition beyond the authorized golden definition changes. DO
     NOT HARDCODE THE VIDEO OR STRATEGY ID TO FORCE THE POPULATION BACK TO ONE."

So the RULE takes no stub argument and contains no video id — that split is
R-732 §2's ruling: `AN ID IN PRODUCTION CODE IS A CLASSIFIER THAT HAS MEMORISED
ITS ANSWER; AN ID IN A TEST IS A POPULATION ASSERTION.` This file is the
population assertion, so it names both frozen members and exits non-zero if the
measured population is not EXACTLY those two — in EITHER direction, a third
member or a missing one. ★ The stop is not spent by being honoured once
(R-732 §2): a third member still stops.
`NARROWING THE POPULATION UNTIL THE RULE LOOKS RIGHT IS NOT SCOPING, IT IS
SUPPRESSING THE CONTROL.`

RUN:  python docs/replay-results/h1-battery/opening_range_definition_discrimination.py
"""

from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.getcwd())
from src.engine.opening_range_definition import (  # noqa: E402
    classify_opening_range_definition as classify,
)

CENSUS = os.path.join("docs", "replay-results", "h1-battery", "tier-a-compile-census.json")

# 🛑 THE RULE IS IMPORTED FROM PRODUCTION, NEVER COPIED HERE.
# A measurement instrument carrying its own copy of the rule it measures drifts
# away from production silently and then goes on passing while testing a rule
# nothing runs. That is the dead-control shape this campaign convicts, and the
# six controls below are only worth anything because they exercise the SAME
# function `spec_producer._classify_family` calls.

# The TWO conditions STEP 3 is authorized to re-type (R-732 §2). Naming them HERE
# is correct and naming them in production code is not: `AN ID IN PRODUCTION CODE
# IS A CLASSIFIER THAT HAS MEMORISED ITS ANSWER; AN ID IN A TEST IS A POPULATION
# ASSERTION.` This file is the population assertion.
AUTHORIZED_MEMBERS: set[tuple[str, str]] = {
    ("st5e-YJRfKc__s0", "WAIT_STRUCTURE:once-you-take-the-price-that-s-establish#0"),
    ("dENM6gt8ZRg__s0", "WAIT_STRUCTURE:the-first-five-minute-candle-from-09-30#0"),
}


# ── the six required controls (read, PART 2 "REQUIRED CONTROLS") ─────────────
GOLDEN_TEXT = (
    "once you take the price that's established in the first 5, 15, and the 30 minute "
    "ranges, you have what we call the 5,5 and the 30 minute OB"
)
BREAKOUT_TEXT = (
    "So now we take a look at these levels projected going out after this 30 minute range "
    "is over. So from 7 a.m. onwards in this case off of the Pacific Standard chart and we "
    "look for a breakout. Do we see a breakout above or below?"
)
ANAPHORIC_TEXT = (
    "We take the opening range high and the opening range low in between these time "
    "periods. And that's what forms the opening range."
)
NEIGHBOUR_TEXT = (
    "After the first break of structure, price performs a healthy pullback and then forms "
    "another break of structure, further confirming the trend"
)
# Controls 4 and 5 — `vary-deleted` applied to the rule's own two limbs. Each
# limb removed independently must block the classification.
GOLDEN_MINUS_DURATION = (
    "once you take the price that's established in the opening ranges, you have what we "
    "call the OB"
)
GOLDEN_MINUS_CONSTRUCTION = "the first 5, 15, and the 30 minute ranges"

# ── R-733 §3: the boundary-pair CLASS, and the two controls it owes ──────────
# Control 7 is the READ's fifth control, and R-733 §1 singles it out as the one
# the desk would not have specified: it tests that STAGE 1 PRECEDENCE SURVIVES
# THE WIDENING. Widening the construction limb makes trigger sentences MORE
# likely to carry construction evidence, so without this control the widening
# could quietly reopen the breakout question R-732 §4 closed. It is the
# difference between widening a limb and reopening a ruling.
PRECEDENCE_TEXT = (
    "we look for a breakout above the top and below the bottom of that 15 minute range "
    "from 9:30 to 9:45"
)
# Control 8 is R-733 §3 addition B. ORDER IS NOT LOAD-BEARING: "the low and the
# high" names the same two boundaries of the same window. Refusing it would be
# the SAME under-inclusiveness this fix removes, one synonym axis over — so it is
# measured here rather than assumed either way.
REVERSE_ORDER_TEXT = "marking out the low and the high of that range from 9:30 to 9:45"

CONTROLS = [
    ("1 the real definition condition moves", GOLDEN_TEXT, True),
    ("2 the breakout sentence does NOT move", BREAKOUT_TEXT, False),
    ("3 the anaphoric sentence does NOT move", ANAPHORIC_TEXT, False),
    ("4 duration evidence removed -> blocked", GOLDEN_MINUS_DURATION, False),
    ("5 construction evidence removed -> blocked", GOLDEN_MINUS_CONSTRUCTION, False),
    ("6 genuine structure neighbour does NOT move", NEIGHBOUR_TEXT, False),
    ("7 stage-1 precedence SURVIVES the widening", PRECEDENCE_TEXT, False),
    ("8 reverse-order boundary pair moves", REVERSE_ORDER_TEXT, True),
]


def main() -> int:
    failures = 0

    print("=" * 78)
    print(f"REQUIRED CONTROLS: {len(CONTROLS)} (R-731 §3, +2 at R-733 §3)")
    print("=" * 78)
    for label, text, expected in CONTROLS:
        got, reason, _ = classify(text)
        ok = got == expected
        failures += 0 if ok else 1
        print(f"  [{'PASS' if ok else 'FAIL'}] {label:<46} -> {reason}")

    print()
    print("=" * 78)
    print("CORPUS-WIDE READ-ONLY BLAST RADIUS (authorized R-731 §3)")
    print("=" * 78)
    census = json.load(open(CENSUS, encoding="utf-8"))
    moved, scanned = [], 0
    for spec in census["specs"]:
        for cond in spec["conditions"]:
            scanned += 1
            is_def, reason, _ = classify(cond["object"])
            if is_def:
                moved.append((spec["stub"], spec["strategy_name"], cond["condition_id"], cond["object"]))

    print(f"  conditions scanned : {scanned} across {len(census['specs'])} specs")
    print(f"  would re-type      : {len(moved)}")
    for stub, name, cid, obj in moved:
        authorized = (stub, cid) in AUTHORIZED_MEMBERS
        tag = "AUTHORIZED" if authorized else "*** BEYOND THE AUTHORIZED CONDITION ***"
        print(f"    {tag}\n      spec      : {stub} ({name})\n      condition : {cid}\n"
              f"      text      : {obj[:110]}")

    beyond = [m for m in moved if (m[0], m[2]) not in AUTHORIZED_MEMBERS]
    missing = AUTHORIZED_MEMBERS - {(m[0], m[2]) for m in moved}

    print()
    print("=" * 78)
    if failures:
        print(f"CONTROLS FAILED: {failures}. The rule is not proven; nothing may land.")
        return 2
    if beyond:
        print("STOP — R-731 §3. The rule is semantically correct and all six controls pass,")
        print(f"but it re-types {len(beyond)} condition(s) BEYOND the authorized population.")
        print("This is a FINDING ABOUT THE RULE and it is escalated, NOT suppressed.")
        print("No video or strategy id is hardcoded to force the population back to one:")
        print("`NARROWING THE POPULATION UNTIL THE RULE LOOKS RIGHT IS NOT SCOPING,")
        print(" IT IS SUPPRESSING THE CONTROL.`")
        return 3
    if missing:
        print(f"AUTHORIZED MEMBER(S) NOT CAPTURED: {sorted(missing)}")
        print("The population is SHORT, which is a finding about the rule in the other")
        print("direction and is reported rather than shrugged at.")
        return 4
    print(f"ALL {len(CONTROLS)} CONTROLS PASS and the blast radius is EXACTLY the two "
          "authorized members.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
