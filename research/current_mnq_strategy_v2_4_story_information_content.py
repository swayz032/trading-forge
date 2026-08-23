#!/usr/bin/env python3
"""How much does the `Story` actually SAY at the moment of a granted entry? DIAGNOSTIC ONLY.

The scorecard records `story_receipt` -- one string. The Story the kernel built has ELEVEN
booleans plus a `complete` property. If any of that separated the entries the trader wanted from
the ones he did not, the discriminator would already be computed and merely discarded, which
would be the cheapest fix available anywhere in this campaign.

IT DOES NOT. And measuring it shows why. [MEASURED 2026-08-22, over the 10 Route A entries]

    field            wanted   unwanted   note
    approach          5/5       5/5      CONSTANT -- hardcoded literal True (entries.py:168)
    takeover          5/5       5/5      CONSTANT -- hardcoded literal True (entries.py:174)
    weakening         0/5       0/5      CONSTANT -- NEVER TRUE, not once, in any granted entry
    reclaim           5/5       5/5      CONSTANT -- forced: `fight` requires `reclaimed`
    fight             5/5       5/5      CONSTANT -- forced: a granted entry has complete=True
    decision          5/5       5/5      CONSTANT -- same
    follow_through    5/5       5/5      CONSTANT -- and it is `bool(follow)`, the SAME
                                         EXPRESSION as `decision` (entries.py:176 and 178).
                                         Two fields, one value, no extra information.
    complete          5/5       5/5      CONSTANT -- true by definition of being granted
    compression       3/5       2/5      varies, does not separate
    rejection         2/5       4/5      varies, does not separate
    failed_push       4/5       5/5      varies, does not separate
    displacement      2/5       1/5      varies, does not separate
    location.quality  0.77-0.86 0.73-0.86  overlaps
    location.confluence 0.0     0.0-1.0    overlaps

    DISCARDED FIELDS THAT SEPARATE THE GROUPS: 0

SO THE STORY ADVERTISES TWELVE STATES AND CARRIES FOUR VARYING BITS at the point of a granted
entry, and none of the four discriminate. Eight are constant: two hardcoded, one never-true, one
a duplicate of another, and four forced true by the fact of the grant itself.

`weakening` deserves its own line. It is `_shrinking_into_zone` -- the trader's "candles shrink
into the level" pattern -- and it is one of the four alternatives in the `fight` disjunction. It
fired ZERO times across every granted rejection entry in the corpus. Either the predicate does
not match what the trader means by it, or the pattern is genuinely absent from these 14 days.
This module cannot tell which, and does not guess.

A NOTE ON `rejection`, because the direction is the opposite of the intuitive one: a real
rejection wick is present in 2 of 5 WANTED entries and 4 of 5 UNWANTED ones. At n=5 per group
that is noise and no conclusion is drawn -- but it is recorded, because "require the wick" is
the obvious first repair and this is the only evidence bearing on it, and it does not support it.

SCOPE, stated honestly: Route A only. BRK5 candidates carry `story=None` by construction, so 4
of the 14 cases cannot be included. 5 versus 5.

COLLECTION LIVES IN THE RUNNER, NOT HERE.  `run_story_information_content.py` imports the X-ray
and calls `analyse()`; this module imports nothing diagnostic.  That is not tidiness -- a test
(`test_the_xray_is_diagnostic_only`) forbids anything in the `current_mnq_strategy_v2_4_*`
namespace from importing the X-ray, and it CAUGHT ME putting `collect()` here.  `analyse()` is
pure, which is also why it can be tested directly.

Run: PYTHONPATH=. python -m research.run_story_information_content
"""
from __future__ import annotations

from pathlib import Path

DIAGNOSTIC_ONLY = (
    "DIAGNOSTIC_ONLY. Measures how much information the Story carries. Fits nothing, tunes "
    "nothing, selects no strategy rule. ALGO-011."
)

SCORECARD = Path("research/current_mnq_strategy_v2_4_frozen_14_case_scorecard_2026_08_21.json")

ENTERED = frozenset({"ENTER_LONG", "ENTER_SHORT"})
STORY_FIELDS = ("approach", "weakening", "compression", "rejection", "failed_push", "reclaim",
                "takeover", "displacement", "follow_through", "fight", "decision", "complete")


def analyse(rows: list[dict]) -> dict:
    A = [r for r in rows if r["wanted"]]
    B = [r for r in rows if not r["wanted"]]
    fields, constant, varying, separating = {}, [], [], []
    for f in STORY_FIELDS:
        a, b = sum(r[f] for r in A), sum(r[f] for r in B)
        allv = {r[f] for r in rows}
        is_const = len(allv) == 1
        seps = (a == len(A) and b == 0) or (a == 0 and b == len(B))
        fields[f] = {"wanted": f"{a}/{len(A)}", "unwanted": f"{b}/{len(B)}",
                     "constant": is_const, "separates": seps}
        (constant if is_const else varying).append(f)
        if seps:
            separating.append(f)
    return {
        "status": DIAGNOSTIC_ONLY,
        "scope": "Route A only. BRK5 candidates carry story=None by construction.",
        "cases": len(rows), "wanted": len(A), "unwanted": len(B),
        "fields": fields,
        "constant_fields": constant,
        "varying_fields": varying,
        "separating_fields": separating,
        "duplicate_fields": {
            "follow_through_equals_decision":
                all(r["follow_through"] == r["decision"] for r in rows),
            "why": "both are `bool(follow)` -- entries.py:176 and 178. One value, two names."},
        "weakening_never_fires": all(not r["weakening"] for r in rows),
        "verdict": (
            f"the Story advertises {len(STORY_FIELDS)} states and carries {len(varying)} varying "
            f"bits at the point of a granted entry; {len(separating)} of them discriminate."),
        "rows": rows,
    }
