#!/usr/bin/env python3
"""OBJECT-REFERENCE CENSUS of the 16 level/zone conditions (R-097 §3(i)).

Why census-first: the sub-wire failed because production fed `retest_touch_check` an
EMA(20) proxy as `level` — live function, production-CONSTANT input. The fix is a
per-condition level resolver, but a resolver cannot be designed before we know WHAT KIND
of thing traders actually point at when they say "level". R-097 §3's insight: the trader's
level is usually NOT a literal price but a REFERENCE to a market-derived object, so the
resolver is an OBJECT-BINDING layer onto detectors the repo already owns — not one parser.

This classifies reference KIND only. It proposes no resolver and writes no engine code.

Rules are authored from the reference taxonomy R-097 §3 names (absolute price / swing /
session range / FVG edge / prior-day / bare anaphora), NOT tuned to these 16 texts.
Multi-label: a condition may name more than one kind.

CAUTION, learned the hard way this session (AR-077): a regex used to SIZE a defect can
inherit the defect. This one classifies REFERENCE KIND, which is a different mechanism
from the level-resolution it informs — but its output is a design input, not a measurement,
and it is labelled RECONSTRUCTION-GRADE: the hard call (anaphora vs implicit reference)
is exactly where a keyword rule is weakest, so the artifact reports an ANAPHORA-AMBIGUOUS
bucket rather than forcing those rows into a class.
"""

import json
import os
import re
import sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
CENSUS = os.path.join(HERE, "wire1-structure-census-v2.json")
OUT = os.path.join(HERE, "levelzone-object-reference-census.json")

KIND_RES = [
    ("absolute_price", re.compile(r"\b\d{2,5}(?:\.\d+)?\b(?!\s*(?:m|min|minute|h|hour|%))", re.I)),
    ("swing", re.compile(r"\b(swing\s+(high|low)|higher\s+high|lower\s+low|lower\s+high|"
                         r"higher\s+low|previous\s+(high|low)|prior\s+(high|low)|"
                         r"recent\s+(high|low)|peak|trough)\b", re.I)),
    ("session_range", re.compile(r"\b(session|asia\w*|london|new\s+york|opening\s+range|"
                                 r"pre[-\s]?market|overnight|range\s+(high|low)|"
                                 r"high\s+of\s+(the\s+)?day|low\s+of\s+(the\s+)?day)\b", re.I)),
    ("fvg_edge", re.compile(r"\b(fair\s+value\s+gap|fvg|imbalance|inefficienc(y|ies)|gap)\b", re.I)),
    ("prior_day", re.compile(r"\b(previous\s+day|prior\s+day|pdh|pdl|yesterday|daily\s+(high|low))\b", re.I)),
    ("order_block_edge", re.compile(r"\b(order\s+block|breaker|mitigation\s+block|demand|supply)\b", re.I)),
    # ADDED after first run: support/resistance had NO bucket, so 2 genuine S/R references
    # fell into "no kind matched". Caught by asking whether the taxonomy — not the corpus —
    # was the gap, the same question that caught AR-077's session-sizing regex. A reference
    # taxonomy missing the single most common retail level name is exactly the same-kind
    # failure this session keeps convicting; recorded rather than silently patched.
    ("named_sr_level", re.compile(r"\b(support|resistance)\b", re.I)),
]
# Bare anaphora: points at a level without naming which. The hard case R-097 §3 flags.
ANAPHORA_RE = re.compile(r"\b(the|this|that|these|those|it|there)\s+"
                         r"(level|zone|area|line|point|price)\b", re.I)


def classify(text):
    kinds = [k for k, rx in KIND_RES if rx.search(text)]
    return kinds, bool(ANAPHORA_RE.search(text))


def main():
    rows = [r for r in json.load(open(CENSUS, encoding="utf-8"))["rows"]
            if "level_zone" in r["concepts"]]
    if not rows:
        print("FAIL: zero level_zone rows found — census input wrong", file=sys.stderr)
        return 1

    out_rows = []
    for r in rows:
        kinds, anaph = classify(r["object"])
        out_rows.append({
            "condition_id": r["condition_id"], "file": r["file"], "role": r["role"],
            "object": r["object"], "reference_kinds": kinds, "bare_anaphora": anaph,
            # The resolver's hardest population: points at "the level" and names no kind.
            "anaphora_ambiguous": anaph and not kinds,
        })

    n = len(out_rows)
    kind_counts = Counter(k for r in out_rows for k in r["reference_kinds"])
    unresolvable = sum(1 for r in out_rows if r["anaphora_ambiguous"])
    no_kind = sum(1 for r in out_rows if not r["reference_kinds"])

    json.dump({
        "artifact": "levelzone-object-reference-census",
        "authority": "R-097 §3(i)",
        "status": "DESIGN INPUT ONLY — proposes no resolver, writes no engine code",
        "grade": "RECONSTRUCTION-GRADE: reference-kind rules authored from R-097 §3's "
                 "taxonomy, not tuned to these texts; the anaphora call is where a keyword "
                 "rule is weakest, so ambiguous rows are bucketed, never forced",
        "generator": "docs/replay-results/h1-battery/levelzone_object_reference_census.py",
        "n": n,
        "reference_kind_counts": dict(kind_counts),
        "bare_anaphora": sum(1 for r in out_rows if r["bare_anaphora"]),
        "anaphora_ambiguous_HARD_CASE": unresolvable,
        "no_kind_matched": no_kind,
        "rows": out_rows,
    }, open(OUT, "w", encoding="utf-8", newline="\n"), indent=2)

    print(f"level/zone conditions: {n}")
    for k, v in kind_counts.most_common():
        print(f"  {k:<18} {v:>3}  {v/n*100:5.1f}%")
    print(f"  {'bare anaphora':<18} {sum(1 for r in out_rows if r['bare_anaphora']):>3}")
    print(f"  {'ANAPHORA-AMBIGUOUS':<18} {unresolvable:>3}  <- the resolver's hard case")
    print(f"  {'no kind matched':<18} {no_kind:>3}")
    if n and kind_counts:
        print("\nPASS: census computed, kinds non-degenerate.")
        return 0
    print("\nFAIL: degenerate census (no kind ever matched).", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
