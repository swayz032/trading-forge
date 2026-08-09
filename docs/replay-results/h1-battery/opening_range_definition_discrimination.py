"""B1 STEP 3 — ORDERED discrimination rule for OPENING_RANGE_DEFINITION, and the
six controls + corpus blast-radius read that must pass BEFORE it lands.

AUTHORITY: R-731 §2/§3, executing `EXTERNAL-READ-2026-08-09-STEP3-DISCRIMINATION-
TIGHTENED.md` PART 2. Read-only: this instrument classifies text and reports. It
imports no production classifier and edits nothing.

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

So this instrument takes NO stub argument and has no allow-list of videos. It
reports the full population and exits non-zero when the population is not the
single authorized condition. `NARROWING THE POPULATION UNTIL THE RULE LOOKS RIGHT
IS NOT SCOPING, IT IS SUPPRESSING THE CONTROL.`

RUN:  python docs/replay-results/h1-battery/opening_range_definition_discrimination.py
"""

from __future__ import annotations

import json
import os
import re
import sys

CENSUS = os.path.join("docs", "replay-results", "h1-battery", "tier-a-compile-census.json")

# The one condition STEP 3 is authorized to re-type.
AUTHORIZED_STUB = "st5e-YJRfKc__s0"
AUTHORIZED_CONDITION_ID = "WAIT_STRUCTURE:once-you-take-the-price-that-s-establish#0"


# ── STAGE 1 — reference/trigger evidence, by semantic class ──────────────────
# Each class is a way of treating the range as ALREADY BUILT. The class is the
# rule; these patterns are evidence for it.
REFERENCE_CLASSES: dict[str, re.Pattern] = {
    # A directional relation between price and an existing boundary.
    "CROSSING": re.compile(
        r"\b(?:break|breaks|breaking|broke|breakout|cross|crosses|crossing|"
        r"close[sd]?\s+(?:above|below|outside|inside)|pierce[sd]?)\b",
        re.IGNORECASE,
    ),
    # An action taken with respect to an existing range.
    "CONSUMPTION": re.compile(
        r"\b(?:enter|entry|entries|look\s+for|wait\s+for|target|stop\s+(?:loss|below|above)|"
        r"take\s+profit|project(?:ing|ed)?)\b",
        re.IGNORECASE,
    ),
    # A time relation to the range's COMPLETION — the range must already exist
    # for "after it is over" to mean anything.
    "POSTERIORITY": re.compile(
        r"\b(?:after|once)\b[^.]{0,80}?\b(?:is\s+over|has\s+(?:closed|formed|completed)|"
        r"complete[ds]?|finished)\b",
        re.IGNORECASE,
    ),
}

# ── STAGE 2 — positive definition evidence ───────────────────────────────────
# An EXPLICIT clock or duration. Digits are required: that is what makes stage 3
# fall out as a consequence rather than a separate special case.
EXPLICIT_CLOCK = re.compile(
    r"\b\d{1,2}\s*[:.]\s*\d{2}\b"                     # 9:30, 09:35
    r"|\b\d{1,3}\s*-?\s*(?:minute|minutes|min)\b",    # 5 minute, 30-minute
    re.IGNORECASE,
)

# Language describing FORMATION, ESTABLISHMENT, CALCULATION, HIGH/LOW
# CONSTRUCTION, or PRICE CAPTURED DURING THE WINDOW (read, PART 2 item 2).
CONSTRUCTION = re.compile(
    r"\b(?:forms?|forming|formed|establish(?:es|ed|ing)?|"
    r"gives?\s+us|is\s+what\s+(?:forms|gives)|captur(?:e|ed|ing)|"
    r"take\s+the\s+.{0,40}?high|high\s+and\s+the?\s*.{0,20}?low|"
    r"difference\s+between\s+the\s+high)\b",
    re.IGNORECASE,
)

# An anaphoric clock: a window referred to by pronoun, carrying no typed
# duration. Reported explicitly so stage 3 is VISIBLE in the output rather than
# being an unremarked side effect of requiring digits.
ANAPHORIC_CLOCK = re.compile(
    r"\b(?:these|those|this|that)\s+(?:time\s+periods?|periods?|windows?|ranges?|candles?)\b",
    re.IGNORECASE,
)


def classify(text: str) -> tuple[bool, str, dict]:
    """Ordered semantic classification. Returns (is_definition, reason, evidence)."""
    reference_hits = {
        name: pattern.search(text).group(0)  # type: ignore[union-attr]
        for name, pattern in REFERENCE_CLASSES.items()
        if pattern.search(text)
    }
    clock = EXPLICIT_CLOCK.search(text)
    construction = CONSTRUCTION.search(text)
    anaphoric = ANAPHORIC_CLOCK.search(text)

    evidence = {
        "reference_classes": reference_hits,
        "explicit_clock": clock.group(0) if clock else None,
        "construction": construction.group(0) if construction else None,
        "anaphoric_clock": anaphoric.group(0) if anaphoric else None,
    }

    # STAGE 1 — reference evidence BLOCKS, whatever else the sentence carries.
    if reference_hits:
        return False, f"REFUSED_STAGE_1_REFERENCE[{'+'.join(sorted(reference_hits))}]", evidence
    # STAGE 3 (evaluated as part of stage 2's requirement) — an anaphoric clock
    # with no typed duration cannot supply the window.
    if clock is None:
        reason = "REFUSED_STAGE_3_ANAPHORIC_CLOCK" if anaphoric else "REFUSED_NO_EXPLICIT_CLOCK"
        return False, reason, evidence
    # STAGE 2 — both limbs required.
    if construction is None:
        return False, "REFUSED_NO_CONSTRUCTION_EVIDENCE", evidence
    return True, "DEFINITION", evidence


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

CONTROLS = [
    ("1 the real definition condition moves", GOLDEN_TEXT, True),
    ("2 the breakout sentence does NOT move", BREAKOUT_TEXT, False),
    ("3 the anaphoric sentence does NOT move", ANAPHORIC_TEXT, False),
    ("4 duration evidence removed -> blocked", GOLDEN_MINUS_DURATION, False),
    ("5 construction evidence removed -> blocked", GOLDEN_MINUS_CONSTRUCTION, False),
    ("6 genuine structure neighbour does NOT move", NEIGHBOUR_TEXT, False),
]


def main() -> int:
    failures = 0

    print("=" * 78)
    print("SIX REQUIRED CONTROLS (R-731 §3)")
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
        authorized = stub == AUTHORIZED_STUB and cid == AUTHORIZED_CONDITION_ID
        tag = "AUTHORIZED" if authorized else "*** BEYOND THE AUTHORIZED CONDITION ***"
        print(f"    {tag}\n      spec      : {stub} ({name})\n      condition : {cid}\n"
              f"      text      : {obj[:110]}")

    beyond = [m for m in moved if not (m[0] == AUTHORIZED_STUB and m[2] == AUTHORIZED_CONDITION_ID)]

    print()
    print("=" * 78)
    if failures:
        print(f"CONTROLS FAILED: {failures}. The rule is not proven; nothing may land.")
        return 2
    if beyond:
        print("STOP — R-731 §3. The rule is semantically correct and all six controls pass,")
        print(f"but it re-types {len(beyond)} condition(s) BEYOND the authorized golden definition.")
        print("This is a FINDING ABOUT THE RULE and it is escalated, NOT suppressed.")
        print("No video or strategy id is hardcoded to force the population back to one:")
        print("`NARROWING THE POPULATION UNTIL THE RULE LOOKS RIGHT IS NOT SCOPING,")
        print(" IT IS SUPPRESSING THE CONTROL.`")
        return 3
    print("ALL SIX CONTROLS PASS and the blast radius is exactly the authorized condition.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
