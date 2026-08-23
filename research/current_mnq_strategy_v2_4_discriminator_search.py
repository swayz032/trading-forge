#!/usr/bin/env python3
"""Does ANY recorded field separate the trades the trader wanted from the ones he did not?

[MEASURED 2026-08-23, budget-faithful population, after the ALGO-020 F-1 repair]

**THE HONEST ANSWER IS NOW: THE CORPUS CANNOT ANSWER THIS QUESTION AT ITS CURRENT SIZE.**

Under the refuted window join this compared 7 wanted entries against 7 unwanted and found no
separating field. The budget-faithful join removes the 7 sessions whose bullet was spent before
the window opened -- there is no in-window bot decision to characterise in those, and no force
receipt attached to one. What remains is **5 wanted vs 2 unwanted**.

    CATEGORICAL -- still indistinguishable, but now at a size where that means little:
        wanted     REV 4, BRK5 1 | WICK_ZONE 4, STRONG_SWING_DISPLACEMENT 1
        unwanted   REV 1, BRK5 1 | WICK_ZONE 1, STRONG_SWING_DISPLACEMENT 1

    NUMERIC -- ZERO fields testable. The smaller group has 2 members and a separation claim
    needs at least MIN_GROUP on both sides.

SO THE VERDICT IS `NOT TESTABLE`, NOT "no discriminator found". Those are different claims and
only one of them is true. Reporting the second from zero tests would be a green check with no
path to red -- the exact defect this campaign keeps convicting itself of, and it would have
gone out under the old wording.

WHAT SURVIVES from the pre-repair run: the categorical distributions were indistinguishable at
7-vs-7, and three force-receipt fields (`confirmed`, `latest_close_at_directional_extreme`,
`partial_momentum_geometry`) were constant across all 14 cases and so could not discriminate
anything. That finding was made on a larger population and is recorded in ALGO-017; it is not
re-derived here at a size that cannot support it.

WHAT IT MEANS FOR THE WORK: the state machine still cannot be built from the fields the kernel
records, but the reason is now sample size as much as signal. Growing the population -- or
computing genuinely new evidence at the decision clock, which is what ALGO-020 section 4 item 5
orders -- is the only way this question becomes answerable.

`trader_label_censored` is excluded and enforced by a test: derived from the trader's own label,
it separates by construction and would be circular.

Re-run whenever a field is added to the scorecard, or the population grows.

Run: PYTHONPATH=. python -m research.current_mnq_strategy_v2_4_discriminator_search
"""
from __future__ import annotations

import io
import json
from collections import Counter
from pathlib import Path

DIAGNOSTIC_ONLY = (
    "DIAGNOSTIC_ONLY. Asks whether recorded fields carry discriminating information. Fits "
    "nothing, tunes nothing, selects no strategy rule. ALGO-011."
)

SCORECARD = Path("research/current_mnq_strategy_v2_4_frozen_14_case_scorecard_2026_08_21.json")
ENTERED = frozenset({"ENTER_LONG", "ENTER_SHORT"})

#: Derived from the trader's own label, so using it as a discriminator is circular.
CIRCULAR = frozenset({"trader_label_censored"})

#: A separation claim needs enough members on BOTH sides to mean anything.
MIN_GROUP = 3


def _flat(d: dict, prefix: str = "") -> dict:
    out: dict[str, float] = {}
    for k, v in d.items():
        if isinstance(v, dict):
            out.update(_flat(v, prefix + k + "."))
        elif isinstance(v, bool):
            out[prefix + k] = float(v)
        elif isinstance(v, (int, float)):
            out[prefix + k] = float(v)
    return out


def search(scorecard: Path = SCORECARD) -> dict:
    all_cases = json.load(io.open(scorecard, encoding="utf-8"))["cases"]
    # BUDGET-FAITHFUL POPULATION (ALGO-020 F-1). Only sessions where the bot ACTUALLY entered
    # inside the audited window can be compared against a trader decision made there. In the
    # other 7 the bullet was spent before the window opened, so there is no in-window bot
    # decision to characterise and no force receipt attached to one.
    # THE DENOMINATOR SHRINKS FROM 7-vs-7 TO 5-vs-2 AND THE FINDING IS WEAKER FOR IT. Said
    # plainly rather than quietly kept at the old size.
    cases = [c for c in all_cases if c["bot_state_in_window"] in ENTERED]
    excluded = len(all_cases) - len(cases)
    wanted = [c for c in cases if c["trader_state"] in ENTERED]
    unwanted = [c for c in cases if c["trader_state"] not in ENTERED]

    def cats(group):
        return {
            "route": dict(Counter(c["entry_family_receipt"] for c in group)),
            "story": dict(Counter(str(c["story_receipt"]) for c in group)),
            "location_source": dict(
                Counter(c["interaction_geometry"]["location_source"] for c in group)),
        }

    fa = [_flat(c) for c in wanted]
    fb = [_flat(c) for c in unwanted]
    keys = sorted((set().union(*[set(f) for f in fa + fb])) - CIRCULAR) if cases else []

    numeric, separating, constant = [], [], []
    for k in keys:
        a = [f[k] for f in fa if k in f]
        b = [f[k] for f in fb if k in f]
        if len(a) < MIN_GROUP or len(b) < MIN_GROUP:
            continue
        allv = a + b
        if min(allv) == max(allv):
            constant.append({"field": k, "value": allv[0]})
        sep = max(a) < min(b) or max(b) < min(a)
        row = {"field": k, "wanted_range": [min(a), max(a)],
               "unwanted_range": [min(b), max(b)], "completely_separated": sep}
        numeric.append(row)
        if sep:
            separating.append(row)

    return {
        "status": DIAGNOSTIC_ONLY,
        "population": (
            "sessions where the bot ACTUALLY entered inside the audited window, under the "
            "one-trade budget. The rest have no in-window bot decision to characterise."),
        "sessions_excluded_bullet_spent_pre_window": excluded,
        "wanted_entries": len(wanted),
        "unwanted_entries": len(unwanted),
        "categorical": {"wanted": cats(wanted), "unwanted": cats(unwanted)},
        "categorical_distributions_are_indistinguishable":
            cats(wanted)["route"] == cats(unwanted)["route"],
        "numeric_fields_tested": len(numeric),
        "numeric_fields_completely_separating": len(separating),
        "separating_fields": separating,
        "constant_across_the_whole_corpus": constant,
        "min_group_size_for_a_numeric_test": MIN_GROUP,
        "verdict": (
            f"NOT TESTABLE. {len(numeric)} numeric fields could be tested because the smaller "
            f"group has {min(len(wanted), len(unwanted))} members and the test needs "
            f"{MIN_GROUP}. A verdict of 'no discriminator' from ZERO tests would be a green "
            f"check with no path to red, so none is issued."
            if not numeric else
            "NO DISCRIMINATOR AVAILABLE IN THE RECORDED FIELDS. The state machine cannot be "
            "built from what the kernel currently records; tuning a threshold on a field whose "
            "two groups overlap completely cannot succeed."
            if not separating else
            f"{len(separating)} field(s) separate the groups completely - investigate."),
        "testable": bool(numeric),
        "strength_limit": (
            f"{len(wanted)} wanted vs {len(unwanted)} unwanted after the budget-faithful join "
            f"excluded {excluded} sessions whose bullet was spent pre-window. THIS IS A MUCH "
            "WEAKER TEST THAN THE 7-vs-7 IT REPLACES: absence of complete separation at this "
            "size is close to uninformative, and with an unwanted group this small a spurious "
            "separation would also be easy to find. The decision-relevant claim survives only "
            "in its weakest form - nothing available to build from today - and the honest "
            "summary is that THE CORPUS CANNOT ANSWER THIS QUESTION at its current size."),
    }


def main() -> None:
    s = search()
    print(f'wanted {s["wanted_entries"]}  unwanted {s["unwanted_entries"]}')
    for side in ("wanted", "unwanted"):
        print(f'  {side:9} {s["categorical"][side]}')
    print()
    print(f'numeric fields tested        : {s["numeric_fields_tested"]}')
    print(f'completely separating        : {s["numeric_fields_completely_separating"]}')
    print(f'constant across all 14 cases : {len(s["constant_across_the_whole_corpus"])}')
    for c in s["constant_across_the_whole_corpus"]:
        print(f'    {c["field"]} = {c["value"]}')
    print()
    print(s["verdict"])
    print(s["strength_limit"])


if __name__ == "__main__":
    main()
