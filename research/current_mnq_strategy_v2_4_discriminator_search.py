#!/usr/bin/env python3
"""Does ANY recorded field separate the trades the trader wanted from the ones he did not?

[MEASURED 2026-08-22]  NO. Not one.

The bot entered in 14 of 14 sessions; the trader entered in 7. So the corpus splits cleanly into
7 wanted and 7 unwanted entries, and the state machine's whole job is to tell them apart. This
asks the prior question: IS THE INFORMATION EVEN PRESENT in what the kernel records?

    CATEGORICAL -- the receipts are indistinguishable:
        wanted     REV 5, BRK5 2 | ZONE_REJECTION 5, PREBREAK_REPEAT 1, FIRST_BREAK 1
                   | WICK_ZONE 5, STRONG_SWING_DISPLACEMENT 2
        unwanted   REV 5, BRK5 2 | ZONE_REJECTION 5, PREBREAK_REPEAT 2
                   | WICK_ZONE 4, STRONG_SWING_DISPLACEMENT 3

    NUMERIC -- 0 of 12 fields show complete separation. Every range overlaps.

    WORSE, THREE FIELDS ARE CONSTANT ACROSS ALL FOURTEEN CASES:
        force_receipt.confirmed                         always True
        force_receipt.latest_close_at_directional_extreme always True
        force_receipt.partial_momentum_geometry          always True
    A field with one value carries no information. These cannot discriminate anything, and a
    receipt built from them cannot explain a decision.

WHAT THIS MEANS, and it is constructive rather than gloomy: THE STATE MACHINE CANNOT BE BUILT
FROM THE FIELDS THE KERNEL CURRENTLY RECORDS. Whatever separates a trade the trader wants from
one he does not is not in this instrumentation. Tuning thresholds on these fields cannot
succeed, because there is no threshold on a field whose two groups overlap completely.

HONEST LIMIT ON THE STRENGTH OF THIS. Seven per group. "Complete separation" is a demanding
criterion and its absence at n=7 is NOT proof that no signal exists -- a weak but real effect
would not show. What it does establish is that NO DISCRIMINATOR IS AVAILABLE TO BUILD FROM
TODAY, which is the decision-relevant claim. It also excludes `trader_label_censored`, which is
derived from the trader's own label and would be circular.

Re-run this whenever a field is added to the scorecard. That is the point of it being a module
rather than a note.

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
    cases = json.load(io.open(scorecard, encoding="utf-8"))["cases"]
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
        if len(a) < 3 or len(b) < 3:
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
        "wanted_entries": len(wanted),
        "unwanted_entries": len(unwanted),
        "categorical": {"wanted": cats(wanted), "unwanted": cats(unwanted)},
        "categorical_distributions_are_indistinguishable":
            cats(wanted)["route"] == cats(unwanted)["route"],
        "numeric_fields_tested": len(numeric),
        "numeric_fields_completely_separating": len(separating),
        "separating_fields": separating,
        "constant_across_the_whole_corpus": constant,
        "verdict": (
            "NO DISCRIMINATOR AVAILABLE IN THE RECORDED FIELDS. The state machine cannot be "
            "built from what the kernel currently records; tuning a threshold on a field whose "
            "two groups overlap completely cannot succeed."
            if not separating else
            f"{len(separating)} field(s) separate the groups completely - investigate."),
        "strength_limit": (
            "7 per group. Absence of COMPLETE separation at n=7 is not proof that no signal "
            "exists; a weak but real effect would not show. The decision-relevant claim is the "
            "weaker one: nothing available to build from today."),
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
