"""Measure whether the receipt's unordered collections are ORDER-SENSITIVE on this host.

AR-1398 diagnostic. AR-1387A section 4 states the receipt hash is actively nondeterministic
because `evidence_relevance._score()` sums Python sets in randomised order, and reports four
different hashes from four `PYTHONHASHSEED` values on one Linux host. On this tower the same four
seeds produce ONE hash. Exactly one of three things is true, and guessing between them is how a
real defect gets closed as "not reproducible":

  H1  the defect is real but LATENT here -- this fixture's term sets happen to sum
      order-insensitively, and the emitted `shared_terms` lists happen to be short enough that
      their order never varies;
  H2  the defect is real and ACTIVE here, and the seed-matrix probe is measuring the wrong bytes;
  H3  the defect is not in this code at all.

This probe distinguishes them by capturing every real `_score()` call the certified projection
makes, then replaying each captured reduction over many permutations of its own inputs. A float
sum whose value changes under permutation is order-sensitive; one that does not, is not. That is a
direct property of the data, and it does not depend on whether this host's hash seed happened to
land on an exposing order.

It also measures the second, more direct exposure: `shared_terms` is written into the receipt as
`list(<set>)` with no sort, so any emitted set with 2+ members can reorder between processes.

Usage:  python scripts/receipt_order_sensitivity_probe.py
"""
from __future__ import annotations

import itertools
import json
import math
import os
import random
import sys

sys.path.insert(0, os.getcwd())

os.environ.setdefault("TF_MOCK_VBT", "1")

# How many permutations to try per captured reduction. The term sets here are small; for sets
# larger than this many members a random sample of orderings is used instead of the full factorial.
_MAX_PERMUTATIONS = 5040


def _sum_in_order(terms, weights) -> float:
    return sum(weights.get(t, 1.0) for t in terms)


def _order_sensitive(terms, weights) -> tuple[bool, int, set]:
    """Return (is_sensitive, orderings_tried, distinct_values).

    ⚠️ THE FIRST VERSION OF THIS FUNCTION WAS A BROKEN CONTROL AND REPORTED 0/33.
    It used `itertools.permutations` and stopped after `_MAX_PERMUTATIONS`. That generator varies
    the RIGHTMOST positions first, so on a 12-member set the first 5040 orderings all share the
    same first five elements -- it sampled 7!/12! of the space and never moved a single large
    weight across the sequence, which is precisely the move that exposes a non-associative sum.
    A cap that correlates with position is not a sample, it is a fixed prefix.

    Full random shuffles over ALL positions instead, from a fixed `Random(0)` so the probe itself
    stays reproducible. Small sets are still enumerated exhaustively, because for those the
    factorial is cheaper and complete beats sampled.
    """
    terms = list(terms)
    if len(terms) < 2:
        return False, 0, {_sum_in_order(terms, weights)}
    seen = set()
    tried = 0
    if math.factorial(len(terms)) <= _MAX_PERMUTATIONS:
        for perm in itertools.permutations(terms):
            seen.add(_sum_in_order(perm, weights))
            tried += 1
    else:
        rng = random.Random(0)
        scratch = list(terms)
        for _ in range(_MAX_PERMUTATIONS):
            rng.shuffle(scratch)
            seen.add(_sum_in_order(scratch, weights))
            tried += 1
    return len(seen) > 1, tried, seen


def main() -> int:
    from src.engine.extraction import evidence_relevance as er
    from src.engine.extraction import source_graph_projection_spec as sgps
    from src.engine.extraction.source_graph_projection import run_projection
    from src.engine.extraction.svkm_v2_1_compile import _SPEC_PATH, _bench

    captured: list[dict] = []
    real_score = er._score

    def _spy(quote_terms, condition, weights):
        result = real_score(quote_terms, condition, weights)
        cond = er._terms(condition)
        captured.append({
            "cond": cond,
            "shared": cond & quote_terms,
            "weights": weights,
        })
        return result

    er._score = _spy
    try:
        bench = _bench()
        transcript, extraction_record = bench._load_pinned()
        spec = sgps.load_spec_json(_SPEC_PATH)
        inputs = sgps.build_projection_run_inputs(
            spec, transcript, verify_pins=True, extraction_record=extraction_record,
        )
        record = run_projection(**inputs.run_kwargs())
    finally:
        er._score = real_score

    # ---------------------------------------------------------------- #
    # A -- was the suspect code even executed?  A zero here would mean every
    #      conclusion below is about a path that never ran.
    # ---------------------------------------------------------------- #
    print(f"A_score_calls_captured        {len(captured)}")
    if not captured:
        print("POSITIVE CONTROL FAILED: _score was never called; this probe proves nothing.")
        return 2

    # ---------------------------------------------------------------- #
    # A2 -- POSITIVE CONTROL ON THE DETECTOR ITSELF.
    #       Section B below is about to report an ABSENCE ("no reduction is order-sensitive"), and
    #       an absence reported by a detector that cannot detect is worth nothing. A sum that is
    #       KNOWN to be non-associative must come back sensitive, and a sum of equal terms must
    #       come back insensitive -- the second half matters just as much, because a detector that
    #       always says "sensitive" cannot discriminate either.
    # ---------------------------------------------------------------- #
    known_bad = {"big": 1e16, "one": 1.0, "neg": -1e16}
    bad_sensitive, bad_tried, bad_vals = _order_sensitive(set(known_bad), known_bad)
    known_flat = {"a": 0.25, "b": 0.25, "c": 0.25, "d": 0.25}
    flat_sensitive, _, flat_vals = _order_sensitive(set(known_flat), known_flat)
    print(f"A2_detector_sees_known_bad    {bad_sensitive} "
          f"(tried={bad_tried}, distinct_sums={sorted(bad_vals)})")
    print(f"A2_detector_quiet_on_flat     {not flat_sensitive} "
          f"(distinct_sums={sorted(flat_vals)})")
    if not bad_sensitive or flat_sensitive:
        print("POSITIVE CONTROL FAILED: the order-sensitivity detector does not discriminate; "
              "every 'not sensitive' result below is uninterpretable.")
        return 2

    # ---------------------------------------------------------------- #
    # B -- are the real reductions order-sensitive?
    # ---------------------------------------------------------------- #
    sensitive_cond = 0
    sensitive_shared = 0
    max_cond = 0
    max_shared = 0
    examples: list[str] = []
    for call in captured:
        w = call["weights"]
        max_cond = max(max_cond, len(call["cond"]))
        max_shared = max(max_shared, len(call["shared"]))
        s1, _, vals1 = _order_sensitive(call["cond"], w)
        s2, _, vals2 = _order_sensitive(call["shared"], w)
        if s1:
            sensitive_cond += 1
            if len(examples) < 3:
                examples.append(f"cond n={len(call['cond'])} distinct_sums={len(vals1)}")
        if s2:
            sensitive_shared += 1
            if len(examples) < 3:
                examples.append(f"shared n={len(call['shared'])} distinct_sums={len(vals2)}")

    print(f"B_largest_cond_set            {max_cond}")
    print(f"B_largest_shared_set          {max_shared}")
    print(f"B_order_sensitive_cond_sums   {sensitive_cond} / {len(captured)}")
    print(f"B_order_sensitive_shared_sums {sensitive_shared} / {len(captured)}")
    for e in examples:
        print(f"B_example                     {e}")

    # ---------------------------------------------------------------- #
    # C -- the second, more direct exposure: `shared_terms` is serialised as
    #      list(<set>) with no sort, straight into the hashed receipt.
    # ---------------------------------------------------------------- #
    blob = json.dumps(record, sort_keys=True, ensure_ascii=False)
    multi = 0
    total = 0
    unsorted_emitted = 0

    def _walk(node):
        nonlocal multi, total, unsorted_emitted
        if isinstance(node, dict):
            for k, v in node.items():
                if k == "shared_terms" and isinstance(v, list):
                    total += 1
                    if len(v) >= 2:
                        multi += 1
                        if v != sorted(v):
                            unsorted_emitted += 1
                _walk(v)
        elif isinstance(node, list):
            for v in node:
                _walk(v)

    _walk(record)
    print(f"C_shared_terms_lists_in_receipt        {total}")
    print(f"C_of_those_with_2_or_more_members      {multi}")
    print(f"C_emitted_in_non_sorted_order_this_run {unsorted_emitted}")
    print(f"C_receipt_blob_len                     {len(blob)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
