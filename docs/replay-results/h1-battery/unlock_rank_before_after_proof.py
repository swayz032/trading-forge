"""PROOF that canonicalizing the `spec` label moved NO number.  AR-429 / R-453 §1.

R-453: '"no number moves" is the claim, and it needs a proof, not a sentence.
Prove it as a SET COMPARISON, NOT A SPOT CHECK: the ORDERED 40-row ranking must be
IDENTICAL -- same videos, same dist, same resid, same POSITIONS -- with only the
`spec` LABEL changed. State explicitly whether ANY row's position changed.'

If a position DID move, the label was load-bearing in the sort and the ranking
approved in R-451 would itself be order-dependent -- a STOP, not a footnote.

    python unlock_rank_before_after_proof.py BEFORE.json AFTER.json
"""

import json
import sys

# fields that carry a NUMBER or an IDENTITY -- these must be bit-identical
INVARIANT = ["video", "distance", "residual_conditions", "total_conditions",
             "residual_classes"]
# Fields renamed across schema versions: (current name, historical alias).
# ★ Resolved by TRYING BOTH NAMES ON BOTH SIDES. The first version of this tool
#   hard-coded old-name-on-the-left / new-name-on-the-right, so comparing two
#   POST-rename artifacts read every row as `None -> 0` and reported 80 moved
#   numbers that had not moved (AR-430 §3). A comparison tool that only works in
#   one direction is a tool that manufactures findings.
ALIASES = [("fixed_class_conditions", "c8_conditions"),
           ("carries_fixed_class", "carries_c8")]


def resolve(row, *names):
    for n in names:
        if n in row:
            return row[n]
    return None


def load(path):
    with open(path, encoding="utf-8") as fh:
        doc = json.load(fh)
    return doc if isinstance(doc, list) else doc["ranking"]


def main():
    before, after = load(sys.argv[1]), load(sys.argv[2])
    ok = True

    print(f"rows: before={len(before)}  after={len(after)}")
    if len(before) != len(after):
        print("FAIL: row count changed")
        return 1

    # 1. POSITION: the ordered video sequence, compared as an ORDERED LIST
    pos_b = [r["video"] for r in before]
    pos_a = [r["video"] for r in after]
    print(f"\n1. ORDERED video sequence identical : {pos_b == pos_a}")
    if pos_b != pos_a:
        ok = False
        for i, (b, a) in enumerate(zip(pos_b, pos_a), 1):
            if b != a:
                print(f"   POSITION {i} MOVED: {b} -> {a}   *** STOP: label was load-bearing")
    # and as SETS, so a reorder and a substitution cannot look alike
    print(f"   video SETS identical (A-B = B-A = empty): "
          f"{set(pos_b) == set(pos_a)}  |A-B|={len(set(pos_b)-set(pos_a))} "
          f"|B-A|={len(set(pos_a)-set(pos_b))}")

    # 2. EVERY invariant field, every row, keyed by video (the join key is the claim)
    bi = {r["video"]: r for r in before}
    ai = {r["video"]: r for r in after}
    diffs = []
    for v in sorted(bi):
        b, a = bi[v], ai[v]
        for f in INVARIANT:
            if b.get(f) != a.get(f):
                diffs.append((v, f, b.get(f), a.get(f)))
        for new, old in ALIASES:
            bv, av = resolve(b, new, old), resolve(a, new, old)
            if bv != av:
                diffs.append((v, f"{new}(<-{old})", bv, av))
    print(f"\n2. invariant-field differences across all {len(bi)} rows : {len(diffs)}")
    for v, f, x, y in diffs:
        ok = False
        print(f"   {v}  {f}: {x!r} -> {y!r}   *** A NUMBER MOVED")

    # 3. the ONLY field permitted to change
    label_changes = [(v, bi[v]["spec"], ai[v]["spec"]) for v in sorted(bi)
                     if bi[v]["spec"] != ai[v]["spec"]]
    print(f"\n3. `spec` LABEL changes (the only permitted change) : {len(label_changes)} of {len(bi)}")
    for v, b, a in label_changes:
        print(f"   {v:12s} {b}  ->  {a}")

    print(f"\nVERDICT: {'NO NUMBER MOVED -- label-only change PROVEN' if ok else 'FAILED -- see above'}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
