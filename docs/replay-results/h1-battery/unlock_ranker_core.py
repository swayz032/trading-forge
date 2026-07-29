"""UNLOCK-DISTANCE RANKER -- deterministic core.  AR-428 / R-451(b) as amended by R-452.

WHY THIS FILE EXISTS SEPARATELY FROM THE SCRIPT
-----------------------------------------------
`unlock_chain_determinism_probe.py` convicts the RETIRED `gen_ledger.py`. A guard
that only convicts its predecessor is aimed at the past (R-451 §4b). The functions
below are the ones the shipped ranker actually calls, so the committed determinism
test guards THE REAL CODE rather than a re-implementation of it.

THE DETERMINISM CONTRACT THIS FILE PROMISES
-------------------------------------------
Same frozen census + same class mapping + same counterfactual
    -> BYTE-IDENTICAL output on every run, under any PYTHONHASHSEED.

HOW IT IS ACHIEVED -- and the secondary keys are properties of the DATA, never of
the run (R-452: not set iteration, not dict insertion accidents, not filesystem
order, not process hash seeds):

  1. THE CUMULATIVE CHAIN IS NOT GREEDY ANY MORE.  `gen_ledger.py` walked a greedy
     path and broke ties by Python set-iteration order; AR-427 measured it emitting
     the published chain in only 4 of 12 runs.  This module computes the EXHAUSTIVE
     maximum over every k-subset instead.  The VALUE at each k is a property of the
     census and needs no tie-break at all -- the ambiguity that broke the old
     instrument cannot arise.  Only the WITNESS subset can tie, and that is broken
     by lexicographic class ID: a property of the frozen taxonomy in the committed
     ledger, stable across machines, runtimes and processes.
  2. Every iteration whose ORDER can reach the output goes through `sorted()`.
     Sets and dicts are used only where the result is order-invariant (a sum, a
     membership test, a subset test).
  3. `canonical_spec_label` replaces first-encountered-wins over JSON row order
     (AR-428 §1) with a rule computed from ALL names in the fan-out group.
"""

import itertools
import json
from collections import defaultdict

C8 = "C8_non_executable_annotation_mistyped"


# ---------------------------------------------------------------- spec labels
INSTRUMENT_CODES = ("mcl", "mes", "mnq")


def canonical_spec_label(names, instrument_codes=INSTRUMENT_CODES):
    """Collapse an instrument fan-out group to ONE label. Returns (label, status).

    THE RULE, stated so it can be disputed (R-453 §2):
        The rows of a fan-out group are the SAME spec deployed to different
        markets, so their names must be token-identical except at exactly ONE
        position -- the instrument code. The rule finds the token position that
        VARIES ACROSS THE GROUP and removes it. Everything else is preserved.

        The varying position is DISCOVERED FROM THE DATA. There is no
        hand-maintained suffix list, and nothing is stripped because a human
        thought it looked like noise.

    WHAT IT DOES NOT DO, deliberately: it does NOT remove the timeframe token.
    The timeframe does not vary within a group, so removing it would not be
    data-derived -- it would be domain knowledge asserted as measurement. (This
    is precisely where AR-427's hand-edit went further than any rule could
    justify; see AR-429.)

    THE RESIDUAL CATEGORY IS MANDATORY (R-453 §2): a name that does not match
    the expected fan-out shape is FLAGGED, never silently stripped and never
    silently passed through. `status` is "OK" only when the group had exactly one
    varying token position AND its values are all known instrument codes.
    Every other outcome returns the lexicographically smallest full name with a
    status naming what was wrong.
    """
    names = sorted(set(names))
    if len(names) == 1:
        return names[0], "SINGLETON_no_fanout_group"

    token_lists = [n.split("_") for n in names]
    if len({len(t) for t in token_lists}) != 1:
        return names[0], "RESIDUAL_token_count_differs_across_group"

    width = len(token_lists[0])
    varying = [i for i in range(width) if len({t[i] for t in token_lists}) != 1]
    if len(varying) != 1:
        return names[0], f"RESIDUAL_{len(varying)}_varying_token_positions"

    pos = varying[0]
    values = sorted({t[pos] for t in token_lists})
    tokens = token_lists[0]
    label = "_".join(tokens[:pos] + tokens[pos + 1:])
    if not set(values) <= set(instrument_codes):
        return names[0], "RESIDUAL_varying_token_not_an_instrument_code:" + "|".join(values)
    if not label:
        return names[0], "RESIDUAL_empty_label_after_removal"
    return label, "OK"


def canonicalization_report(groups):
    """[(key, names, label, status)] for every group whose status is not OK.

    A census is bounded by its surface: this is the surface on which the label
    rule declined to apply, published beside the count rather than swallowed.
    """
    out = []
    for key in sorted(groups):
        names = sorted(set(groups[key]))
        label, status = canonical_spec_label(names)
        if status != "OK":
            out.append((key, names, label, status))
    return out


# ---------------------------------------------------------------- frozen load
def load_frozen(census_path, classified_path):
    """Frozen census + frozen class mapping -> per-VIDEO blocking picture.

    The join key is (strategy_id, condition_id) and it is validated, not assumed:
    a duplicate key carrying a different class, or a refusal with no class, is an
    ERROR here rather than a silent row drop.
    """
    with open(census_path, encoding="utf-8") as fh:
        census = json.load(fh)
    with open(classified_path, encoding="utf-8") as fh:
        classified = json.load(fh)

    cls_by_key = {}
    for r in classified:
        key = (r["strategy_id"], r["condition_id"])
        prev = cls_by_key.get(key)
        if prev is not None and prev != r["remediation_class"]:
            raise ValueError(f"conflicting remediation_class for {key}: {prev} vs {r['remediation_class']}")
        cls_by_key[key] = r["remediation_class"]

    by_video = defaultdict(list)
    for row in census["strategies"]:
        by_video[row["video"]].append(row)

    videos = {}
    label_status = {}
    for video in sorted(by_video):
        rows = sorted(by_video[video], key=lambda r: r["strategy_id"])
        rep = rows[0]
        label, status = canonical_spec_label([r["name"] for r in rows])
        label_status[video] = status
        refusals = []
        for r in sorted(rep["refusals"], key=lambda x: x["condition_id"]):
            key = (r["strategy_id"], r["condition_id"])
            if key not in cls_by_key:
                raise KeyError(f"refusal with no remediation_class: {key}")
            refusals.append({"condition_id": r["condition_id"],
                             "remediation_class": cls_by_key[key],
                             "rule_text": r["rule_text"]})
        videos[video] = {
            "video": video,
            "spec": label,
            "spec_label_status": status,
            "row_names": sorted(r["name"] for r in rows),
            "classes": frozenset(x["remediation_class"] for x in refusals),
            "refusals": refusals,
        }
    meta = {k: v for k, v in census.items() if k != "strategies"}
    meta["spec_label_status_counts"] = {
        s: sum(1 for x in label_status.values() if x == s)
        for s in sorted(set(label_status.values()))}
    return videos, meta


# ------------------------------------------------------------ unlock counting
def videos_clean_under(videos, remediated):
    """Count videos every one of whose blocking classes is in `remediated`.

    Order-invariant by construction: a sum over a subset test.
    """
    remediated = frozenset(remediated)
    return sum(1 for v in videos.values() if v["classes"] <= remediated)


def classes_present(videos):
    return sorted({c for v in videos.values() for c in v["classes"]})


def optimal_chain(videos, replication_factor=3):
    """EXHAUSTIVE best-k coverage. Replaces gen_ledger.py's order-dependent greedy.

    Returns one entry per k: the maximum number of videos any k-subset can clean,
    and the lexicographically smallest subset achieving it. The VALUES are unique
    functions of the census; only the witness needed a tie-break, and lexicographic
    class ID is a property of the frozen taxonomy.
    """
    classes = classes_present(videos)
    chain = []
    for k in range(1, len(classes) + 1):
        best_n, best_subset = -1, None
        for subset in itertools.combinations(classes, k):   # combinations of a SORTED list
            n = videos_clean_under(videos, subset)
            if n > best_n:                                   # strict > keeps the FIRST,
                best_n, best_subset = n, subset              # i.e. the lexicographically smallest
        chain.append({"k": k,
                      "videos_clean": best_n,
                      "strategies_clean": best_n * replication_factor,
                      "witness": list(best_subset)})
    return chain


def each_class_alone(videos, replication_factor=3):
    return [{"remediation_class": c,
             "videos_clean": videos_clean_under(videos, {c}),
             "strategies_clean": videos_clean_under(videos, {c}) * replication_factor}
            for c in classes_present(videos)]


# ------------------------------------------------------- the {C8-fixed} ranking
def rank_specs(videos, fixed_class=C8):
    """Per-spec unlock distance under the {fixed_class}-corrected counterfactual.

    unlock distance (R-449) := the number of ADDITIONAL blocker CLASSES beyond
    `fixed_class` that must be corrected before the spec has ZERO blocking
    conditions. Distance 0 => the fix alone fully clears it.

    Rank key (R-449): distance asc -> fewest residual conditions -> fewest
    distinct videos -> video ID. On POP-120-LIVE spec and video are 1:1, so the
    third key is constant at 1; video ID is the stable final key and is a
    property of the data.
    """
    rows = []
    for video in sorted(videos):
        v = videos[video]
        residual_classes = sorted(v["classes"] - {fixed_class})
        residual = [r for r in v["refusals"] if r["remediation_class"] != fixed_class]
        fixed = [r for r in v["refusals"] if r["remediation_class"] == fixed_class]
        rows.append({
            "video": video,
            "spec": v["spec"],
            "distance": len(residual_classes),
            "residual_conditions": len(residual),
            "fixed_class_conditions": len(fixed),
            "total_conditions": len(v["refusals"]),
            "distinct_videos": 1,
            "residual_classes": [c.split("_")[0] for c in residual_classes],
            "residual_classes_full": residual_classes,
            "carries_fixed_class": fixed_class in v["classes"],
            "row_names": v["row_names"],
        })
    rows.sort(key=lambda r: (r["distance"], r["residual_conditions"],
                             r["distinct_videos"], r["video"]))
    return rows


def serialize(obj):
    """The canonical byte form the determinism test compares."""
    return json.dumps(obj, indent=1, sort_keys=True, ensure_ascii=False)


# --------------------------------------------------- RETIRED, kept to convict it
def legacy_greedy_chain_RETIRED(videos, replication_factor=3):
    """gen_ledger.py's greedy loop, VERBATIM in behaviour. DO NOT USE FOR DECISIONS.

    Retired by R-451 §2: it iterates a SET of class-name strings and keeps the
    first strict maximum, so a consequential tie is resolved by Python's
    per-process str hash randomisation. Measured (AR-427 §2) emitting the
    published chain in 4 of 12 runs.

    It survives here for exactly one purpose: the committed determinism test runs
    it on the tied fixture to prove the fixture DISCRIMINATES. A determinism test
    that cannot convict the known-broken instrument has not been shown to bite.
    """
    by_vid = {v: set(d["classes"]) for v, d in videos.items()}
    classes = sorted({c for s in by_vid.values() for c in s})
    chosen, rem, chain = [], set(classes), []
    while rem:
        best = None
        for c in rem:                                    # <-- SET iteration: the defect
            cand = set(chosen) | {c}
            n = sum(1 for s in by_vid.values() if s <= cand)
            if best is None or n > best[1]:              # <-- first max wins
                best = (c, n)
        chosen.append(best[0])
        rem.discard(best[0])
        chain.append({"class": best[0], "videos_clean": best[1],
                      "strategies_clean": best[1] * replication_factor})
    return chain
