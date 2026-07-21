#!/usr/bin/env python3
"""ANTECEDENT PROBE (R-098 §3(i-b)) — count, do not build.

Question, and only this question: for the level/zone rows that name no resolvable level
in their own span (8 bare-anaphora + 6 no-kind), does the SURROUNDING spec text name the
referent within a few conditions? If mostly YES, an antecedent-resolution mechanism earns
a place in the resolver design. If mostly NO, the unresolvable class closes honestly.

No resolver is proposed. No engine code is written. One artifact, generator attached.

Method: for each target condition, scan the +/- WINDOW neighbouring entry_conditions in its
own spec (the text a human would have on screen around it) for a concrete level-naming
object. "Concrete" reuses the SAME reference-kind vocabulary as the object-reference census
rather than a fresh one — a second divergent vocabulary is the defect this campaign keeps
convicting. Evidence is quoted verbatim so every YES is checkable, never asserted.

Known limit, stated not buried: the spec's condition list is a PROXY for the transcript.
A referent named in the video but never transcribed into any condition is invisible here,
so a NO is "not recoverable from the spec", which is the weaker and safer claim.
"""

import glob
import json
import os
import re
import sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
REFC = os.path.join(HERE, "levelzone-object-reference-census.json")
SPECS = os.path.join(ROOT, "docs/replay-results/h1-scripts/claude-rung-v32/shakedown_specs")
OUT = os.path.join(HERE, "levelzone-antecedent-probe.json")
WINDOW = 2

# Same vocabulary as the object-reference census — imported in spirit, restated here only
# because that generator exposes it as module-level regex tuples; kept byte-comparable.
CONCRETE_RE = re.compile(
    r"\b(support|resistance|order\s+block|breaker|mitigation\s+block|demand|supply"
    r"|swing\s+(high|low)|higher\s+high|lower\s+low|lower\s+high|higher\s+low"
    r"|previous\s+(day|high|low)|prior\s+(high|low)|recent\s+(high|low)"
    r"|fair\s+value\s+gap|fvg|imbalance|inefficienc(y|ies)"
    r"|session|asia\w*|london|new\s+york|opening\s+range|pre[-\s]?market|overnight"
    r"|high\s+of\s+(the\s+)?day|low\s+of\s+(the\s+)?day|pdh|pdl)\b", re.I)


def main():
    ref = json.load(open(REFC, encoding="utf-8"))
    targets = {r["condition_id"]: r for r in ref["rows"]
               if r["bare_anaphora"] or not r["reference_kinds"]}
    if not targets:
        print("FAIL: no target rows — probe input wrong", file=sys.stderr)
        return 1

    # index every spec's condition list once
    by_file = {}
    for p in sorted(glob.glob(os.path.join(SPECS, "*.spec.json"))):
        d = json.load(open(p, encoding="utf-8"))
        by_file[os.path.basename(p)] = d.get("spec", {}).get("entry_conditions", [])

    rows = []
    for cid, t in targets.items():
        conds = by_file.get(t["file"], [])
        idx = next((i for i, c in enumerate(conds) if c.get("id") == cid), None)
        hits = []
        if idx is not None:
            lo, hi = max(0, idx - WINDOW), min(len(conds), idx + WINDOW + 1)
            for j in range(lo, hi):
                if j == idx:
                    continue
                obj = conds[j].get("object", "")
                m = CONCRETE_RE.search(obj)
                if m:
                    hits.append({"offset": j - idx, "matched": m.group(0),
                                 "evidence": obj[:200]})
        rows.append({
            "condition_id": cid, "file": t["file"], "object": t["object"],
            "own_span_kinds": t["reference_kinds"],
            "anaphora_ambiguous": t["anaphora_ambiguous"],
            "antecedent_found": bool(hits),
            "antecedent_evidence": hits[:3],
            "located_in_spec": idx is not None,
        })

    n = len(rows)
    yes = sum(1 for r in rows if r["antecedent_found"])
    hard = [r for r in rows if r["anaphora_ambiguous"]]
    hard_yes = sum(1 for r in hard if r["antecedent_found"])

    json.dump({
        "artifact": "levelzone-antecedent-probe",
        "authority": "R-098 §3(i-b)",
        "status": "COUNT ONLY — no resolver proposed, no engine code written",
        "question": "does surrounding spec text name the referent the condition points at?",
        "method": f"scan +/-{WINDOW} neighbouring entry_conditions for a concrete "
                  f"level-naming object; vocabulary reused from the object-reference census",
        "known_limit": "the spec's condition list is a PROXY for the transcript; a referent "
                       "spoken on video but never transcribed into a condition is invisible "
                       "here, so a NO means 'not recoverable from the spec' — the weaker, "
                       "safer claim",
        "n_targets": n, "antecedent_found": yes, "antecedent_absent": n - yes,
        "hard_case_n": len(hard), "hard_case_antecedent_found": hard_yes,
        "rows": rows,
    }, open(OUT, "w", encoding="utf-8", newline="\n"), indent=2)

    print(f"targets (anaphora or no-kind): {n}")
    print(f"  antecedent FOUND nearby : {yes:>3}  ({yes/n*100:.1f}%)")
    print(f"  antecedent ABSENT       : {n-yes:>3}  ({(n-yes)/n*100:.1f}%)")
    print(f"  -- of the {len(hard)} ANAPHORA-AMBIGUOUS (the hard case) --")
    print(f"     antecedent FOUND     : {hard_yes:>3}")
    print(f"     antecedent ABSENT    : {len(hard)-hard_yes:>3}")
    print(f"\nREADS: {'antecedent-resolution EARNS a design slot' if yes/n >= 0.5 else 'the UNRESOLVABLE class closes honestly'}")
    if not all(r["located_in_spec"] for r in rows):
        print("WARN: some targets not located in their spec — counts understate", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
