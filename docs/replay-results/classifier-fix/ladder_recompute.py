#!/usr/bin/env python3
"""LADDER RECOMPUTE -- the committed producer of `ladder-recomputed.json`.

WHY THIS FILE EXISTS: `ladder-recomputed.json` shipped with **no `generator`
field**, and the script that made it lived in a since-deleted scratchpad. Its
AFTER arm has already been cited in two reports. **An artifact that cannot name
its producer is not evidence** -- so this generator is committed, it stamps its
own path onto the artifact, and every figure it writes is COMPUTED here. Nothing
is carried over from the file it replaces.

WHAT IT MEASURES (the question each number answers -- a number is defined by the
question it answers):

  "On the tier-A 11, counting only LOAD-BEARING (spine/trigger) conditions, how
   many specs would have EVERY load-bearing condition satisfied if we wired
   family F -- and in what greedy order do families complete the most specs?"

  It does NOT answer "how many conditions carry family label F" (that is
  `spine_family_mix`, reported separately) and it does NOT answer "how many rows
  survive a fail-closed test against the fields a primitive actually emits"
  (that is the servable-today count, which this generator does not compute).

THE TWO ARMS, AND WHY THEY ARE REPRODUCIBLE

  BEFORE  = the PREFIX classifier: `src/engine/extraction/spec_producer.py` as
            of commit e487dc1f (blob b6d0de43), retrieved FROM THE GIT OBJECT
            STORE at run time and gated on a pinned sha256. The prior run read
            this from a scratchpad VAULT copy; that copy is byte-identical to
            the committed blob (verified), but a scratchpad is not provenance.
  AFTER   = the working-tree `spec_producer.py` (evidence-strength classifier).

  BOTH arms use the SAME binder (`compile_binding_plan` at HEAD) and the SAME
  extractions. Only the classifier differs. Per DISPATCH-KNOWN-TRAPS #8 the arms
  are PROVEN distinct before any differential is reported.

INSTRUMENT REUSE (never restate a classifier): the corpus selection rule, the
BINDS predicate and `bind_status` are imported BY PATH from
`docs/replay-results/h1-battery/tier_a_compile_census.py`, so this ladder cannot
drift from the census it is read beside.

HYPOTHETICAL: production flags are OFF, no `.spec.json` on disk is rewritten,
the 77 sealed corpus is untouched. Every "after wiring" figure is a labeled
hypothetical about a wire that does not exist.

READ-ONLY on every input. Writes exactly one artifact.

  python ladder_recompute.py            # strict: gates armed, publishes
  python ladder_recompute.py --draft    # writes to <out>.draft.json instead
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import subprocess
import sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, ROOT)

BATTERY = os.path.join(ROOT, "docs", "replay-results", "h1-battery")
CENSUS_PY = os.path.join(BATTERY, "tier_a_compile_census.py")
OUT_REL = "docs/replay-results/classifier-fix/ladder-recomputed.json"
OUT = os.path.join(ROOT, *OUT_REL.split("/"))

GENERATOR_REL = "docs/replay-results/classifier-fix/ladder_recompute.py"

# --- BEFORE-arm pin. Both are gated; neither is decorative. ----------------- #
PRE_COMMIT = "e487dc1f82a1a90627862ea4cfb621f344621f8e"
PRE_BLOB = "b6d0de43e4d568c2bc7261cf30065418c1b4b50a"
PRE_PATH = "src/engine/extraction/spec_producer.py"
# sha256 of the blob bytes exactly as `git cat-file blob` returns them (LF in the
# object store). Computed, then pinned, so a silent blob swap cannot pass.
PRE_SHA256 = "8ce5961933082a09fd7440137dd9727df5cf60fd835f966d1b089d936ae50dde"

# The PREDECESSOR artifact -- the un-reproducible file this generator replaces --
# pinned BY BLOB, not by "HEAD". Pinning to HEAD would make the recorded
# disagreement evaporate the moment this generator's own output is committed:
# the comparison would then be against itself and report perfect agreement. A
# reconciliation that erases itself on the next run is not a record.
PREDECESSOR_BLOB = "af7f0296155fc616574e9cda49a5b1c75cdb765d"

# UNTYPED is the ABSENCE of a type, not a family. It cannot be wired, so it is
# excluded from the wireable ladder -- and its exclusion is what produces the
# AFTER arm's ceiling. This is a definition, and it is printed with the result.
UNWIREABLE = {"UNTYPED"}

GATE_BOUNDARIES: dict[str, str] = {
    "OPTIMIZED_MODE": (
        "Names the -O flag, which strips `assert` from this process INCLUDING the modules "
        "imported below. It cannot vouch for anything else."
    ),
    "PRE_BLOB_IDENTITY": (
        "Checks the BEFORE-arm source bytes against a pinned sha256 of a named git blob. It "
        "proves the arm is the source we say it is -- it says NOTHING about whether that "
        "revision was the right BEFORE to choose."
    ),
    "ARMS_ARE_DISTINCT": (
        "Proves the two arms produced different classifications, and NAMES a differing "
        "condition. It cannot tell whether the difference is the RIGHT one -- only that a "
        "differential was actually run twice on two things, not once on one."
    ),
    "SPINE_CLOSURE": (
        "Checks the per-arm spine family histogram sums to that arm's spine condition count, "
        "i.e. no load-bearing condition fell outside the histogram. It says nothing about "
        "whether any condition was classified CORRECTLY."
    ),
    "ARM_CORPUS_PARITY": (
        "Checks both arms saw the same spec set and the same load-bearing condition count, so "
        "the ladder difference is attributable to the classifier and not to a corpus drift. It "
        "does not check that the corpus itself is the right one."
    ),
    "LADDER_MONOTONE": (
        "Checks the greedy ladder is strictly increasing and bounded by the all-families "
        "ceiling -- an arithmetic self-check on this generator's own search. It does not "
        "validate the completion predicate the search optimizes."
    ),
}


def refuse_unless(ok: bool, gate: str, message: str) -> None:
    """A guard REFUSES: never `assert` (-O strips it), never exit 1 (reads as a crash)."""
    if ok:
        return
    boundary = GATE_BOUNDARIES.get(gate, "(no boundary declared -- this is itself a defect)")
    sys.stderr.write(
        f"\n{'=' * 78}\nGUARD REFUSED: {gate}\n{'=' * 78}\n{message}\n\n"
        f"  WHAT THIS GATE DOES NOT COVER (printed beside every verdict, red or green):\n"
        f"    {boundary}\n\n"
        "REFUSING TO PUBLISH. Exit 2 -- this is a guard verdict, not a crash.\n"
    )
    raise SystemExit(2)


def refuse_if_optimized() -> None:
    refuse_unless(not sys.flags.optimize, "OPTIMIZED_MODE", (
        "This generator was invoked under `python -O`, which strips every `assert` statement "
        "in this process. The gates here survive as refusals, but nothing can vouch for asserts "
        "in the modules this file imports. Re-run without -O."
    ))


def _load_by_path(name: str, path: str):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _load_pre_arm():
    """BEFORE arm straight from the git object store, gated on a pinned digest."""
    src = subprocess.run(
        ["git", "cat-file", "blob", PRE_BLOB],
        cwd=ROOT, check=True, capture_output=True).stdout
    got = hashlib.sha256(src).hexdigest()
    refuse_unless(got == PRE_SHA256, "PRE_BLOB_IDENTITY", (
        f"BEFORE-arm blob {PRE_BLOB} ({PRE_COMMIT[:8]}:{PRE_PATH}) hashed {got}, "
        f"pinned {PRE_SHA256}. The arm is not the source this generator claims."))
    mod = importlib.util.module_from_spec(
        importlib.util.spec_from_loader("spec_producer_PRE_ARM", loader=None))
    mod.__file__ = f"git:{PRE_COMMIT}:{PRE_PATH}"
    exec(compile(src, mod.__file__, "exec"), mod.__dict__)
    return mod, got


def _published_at_head() -> dict | None:
    """The artifact being REPLACED, read from the git object store.

    The disagreement between this run and the published file is itself COMPUTED here --
    never transcribed from a brief or from reading the file by eye. If the artifact is
    not yet tracked, there is nothing to disagree with and that is reported as such.
    """
    r = subprocess.run(["git", "cat-file", "blob", PREDECESSOR_BLOB],
                       cwd=ROOT, capture_output=True)
    if r.returncode != 0:
        return None
    return json.loads(r.stdout.decode("utf-8"))


def _diff_against_published(new_arms: dict, old: dict | None) -> dict:
    """Per-arm, per-key comparison over the keys the published file actually carried."""
    if old is None:
        return {"status": "NO_PUBLISHED_PREDECESSOR -- nothing to reconcile against"}
    agree, disagree, absent = {}, {}, {}
    for arm, new_blk in new_arms.items():
        old_blk = (old.get("arms") or {}).get(arm)
        if old_blk is None:
            absent[arm] = "arm not present in the published file"
            continue
        for k, old_v in old_blk.items():
            if k not in new_blk:
                absent.setdefault(arm, {})
                absent[arm] = dict(absent.get(arm) or {})
                absent[arm][k] = "key not produced by this generator"
                continue
            (agree if new_blk[k] == old_v else disagree).setdefault(arm, {})
            (agree if new_blk[k] == old_v else disagree)[arm][k] = (
                old_v if new_blk[k] == old_v else
                {"published": old_v, "recomputed": new_blk[k]})
    return {
        "status": ("EVERY published figure reproduced" if not disagree
                   else "DISAGREEMENT -- reported, NOT reconciled"),
        "n_keys_agreeing": sum(len(v) for v in agree.values()),
        "n_keys_disagreeing": sum(len(v) for v in disagree.values()),
        "keys_agreeing": {a: sorted(v) for a, v in agree.items()},
        "keys_disagreeing": disagree,
        "keys_published_but_not_produced_here": absent,
    }


def sha256_file(p: str) -> str:
    return hashlib.sha256(open(p, "rb").read()).hexdigest()


def compile_arm(producer, census, keep, phase_b):
    """Compile the corpus under ONE classifier arm. Binder is HEAD in both arms."""
    from src.engine.spec_family_bindings import compile_binding_plan

    specs, failures = [], []
    for stub in sorted(keep):
        path = os.path.join(phase_b, f"{stub}.json")
        if not os.path.exists(path):
            failures.append({"stub": stub, "reason": "extraction file absent from sealed-read WD"})
            continue
        doc = json.load(open(path, encoding="utf-8"))
        strategies = doc.get("strategies") or []
        if len(strategies) != 1:
            failures.append({"stub": stub,
                             "reason": f"expected 1 strategy in file, found {len(strategies)}"})
            continue
        try:
            art = producer.produce_spec_artifact(
                strategies[0], video=stub, certificate=None, transcript_chars=0)
            plan = compile_binding_plan(art["spec"])
        except Exception as exc:  # a compile failure is a FINDING, never a lowered bar
            failures.append({"stub": stub, "reason": f"{type(exc).__name__}: {exc}"})
            continue

        by_id = {b["condition_id"]: b for b in
                 [x.to_dict() for x in plan.bindings]
                 + [x.to_dict() for x in plan.invalidation_bindings]}
        conds = []
        for c in art["spec"]["entry_conditions"] + art["spec"]["invalidations"]:
            b = by_id.get(c["id"])
            conds.append({
                "condition_id": c["id"],
                # ★ A condition_id EMBEDS ITS FAMILY ("WAIT_STRUCTURE:slug#3"), so it is NOT
                # arm-invariant -- keying a cross-arm row diff on it makes every reclassified
                # row look like a different condition. The arm-stable identity is the
                # slug#index tail. Found by ARM_CORPUS_PARITY refusing on the first run.
                "stable_key": c["id"].split(":", 1)[-1],
                "type": c["type"],
                "role": c["role"],
                "load_bearing_spine": c["role"] in ("spine", "trigger"),
                "bind_status": census.bind_status(b) if b else "NO_BINDING_EMITTED",
            })
        specs.append({"stub": stub, "conditions": conds,
                      "extraction_sha256": sha256_file(path)})
    return specs, failures


def ladder_for(specs):
    """Greedy: which family, added next, completes the most specs on the SPINE scope.

    A spec is COMPLETE under a fixed set F iff every load-bearing condition either
    already BINDS or belongs to a family in F. UNTYPED is never in F (see UNWIREABLE),
    so a spec carrying an UNTYPED load-bearing condition can never complete -- that
    exclusion, not a wiring shortfall, is what caps the AFTER arm.
    """
    spine = [c for s in specs for c in s["conditions"] if c["load_bearing_spine"]]
    blocking = [c for c in spine if c["bind_status"] != "BINDS"]

    def complete(fixed):
        n = 0
        for s in specs:
            if all(c["bind_status"] == "BINDS" or c["type"] in fixed
                   for c in s["conditions"] if c["load_bearing_spine"]):
                n += 1
        return n

    observed = {c["type"] for c in blocking}
    wireable = sorted(observed - UNWIREABLE)

    fixed, rungs = set(), []
    cur = complete(fixed)
    zero_wires = cur
    while len(fixed) < len(wireable):
        best, best_n = None, cur
        for f in wireable:
            if f in fixed:
                continue
            n = complete(fixed | {f})
            if n > best_n:
                best, best_n = f, n
        if best is None:
            break  # no remaining family completes another spec
        fixed.add(best)
        cur = best_n
        rungs.append({"rung": f"+{best}", "specs_complete": cur, "of": len(specs)})

    ceiling = complete(set(wireable))
    plateau = cur
    never_rung = sorted(set(wireable) - {r["rung"][1:] for r in rungs})
    alone = {f: complete({f}) for f in wireable}
    never_alone = sorted(f for f in wireable if alone[f] == 0)
    untyped_specs = sorted(
        s["stub"] for s in specs
        if any(c["load_bearing_spine"] and c["type"] in UNWIREABLE for c in s["conditions"]))

    return {
        "n_specs": len(specs),
        "n_spine_conditions": len(spine),
        "specs_complete_with_zero_wires": zero_wires,
        "spine_family_mix": dict(Counter(c["type"] for c in spine).most_common()),
        "blocking_counts": dict(Counter(c["type"] for c in blocking).most_common()),
        "wireable_families": wireable,
        "excluded_unwireable": sorted(observed & UNWIREABLE),
        "ladder": rungs,
        # ★ THE CAPTION WAS A CLAIM, AND ON THE BEFORE ARM IT IS FALSE. The published
        # artifact's `families_that_never_complete_a_spec` is the GREEDY-RUNG COMPLEMENT:
        # families the myopic search never picked. On the BEFORE arm that set is
        # {FILTER, WAIT_BIAS, WAIT_RETEST} -- and those three TOGETHER complete 2 specs
        # (ceiling 11 vs greedy plateau 9). They never complete a spec ALONE, and they
        # never win a greedy step, but "never complete a spec" is not what the search
        # measured. Both readings are published, each under the question it answers.
        "families_that_never_appear_as_a_greedy_rung": never_rung,
        "families_that_complete_zero_specs_alone": never_alone,
        "families_that_never_complete_a_spec_DEPRECATED_CAPTION": {
            "value": never_rung,
            "why_deprecated": (
                "reproduces the published key byte-for-byte, but the name overstates it: this "
                "is the greedy-rung complement, not a set that completes nothing. See "
                "ceiling_vs_greedy_plateau."),
        },
        "specs_completed_by_each_family_alone": alone,
        "n_specs_with_an_UNTYPED_spine_condition": len(untyped_specs),
        "specs_with_an_UNTYPED_spine_condition": untyped_specs,
        "ceiling_specs_complete": ceiling,
        "greedy_plateau_specs_complete": plateau,
        "ceiling_vs_greedy_plateau": (
            "ceiling = specs complete with EVERY wireable family fixed. plateau = where the "
            "greedy search stops, because no SINGLE remaining family adds a spec. They differ "
            "whenever a spec is blocked by two or more unwired families at once -- greedy is "
            "myopic and cannot see a joint unlock."
            + (f" HERE THEY DIFFER: ceiling {ceiling} > plateau {plateau}."
               if ceiling != plateau else
               f" Here they agree at {ceiling}.")),
    }, spine


def main(argv=None) -> int:
    refuse_if_optimized()
    argv = sys.argv[1:] if argv is None else argv
    draft = "--draft" in argv
    out_path = (OUT + ".draft.json") if draft else OUT

    census = _load_by_path("tier_a_census", CENSUS_PY)
    phase_b = census.PHASE_B
    receipt = json.load(open(census.RECEIPT, encoding="utf-8"))
    keep, _dropped = census.select_clean_strategies(receipt)

    import src.engine.extraction.spec_producer as after_producer
    pre_producer, pre_sha = _load_pre_arm()

    arms_raw = {}
    arms_out = {}
    for name, producer in (("BEFORE_prefix_classifier", pre_producer),
                           ("AFTER_fixed_classifier", after_producer)):
        specs, failures = compile_arm(producer, census, keep, phase_b)
        refuse_unless(not failures, "ARM_CORPUS_PARITY",
                      f"{name}: {len(failures)} spec(s) failed to compile: {failures}")
        block, spine = ladder_for(specs)
        refuse_unless(sum(block["spine_family_mix"].values()) == block["n_spine_conditions"],
                      "SPINE_CLOSURE",
                      f"{name}: spine family histogram "
                      f"{sum(block['spine_family_mix'].values())} != n_spine "
                      f"{block['n_spine_conditions']}")
        c = block["ceiling_specs_complete"]
        seq = [r["specs_complete"] for r in block["ladder"]]
        refuse_unless(all(b > a for a, b in zip([block["specs_complete_with_zero_wires"]] + seq, seq))
                      and all(x <= c for x in seq), "LADDER_MONOTONE",
                      f"{name}: ladder {seq} is not strictly increasing under ceiling {c}")
        arms_raw[name] = specs
        arms_out[name] = block

    # --- TRAP #8: prove the arms are distinct, and NAME a row that differs. --- #
    b_by_id = {(s["stub"], c["stable_key"]): c["type"]
               for s in arms_raw["BEFORE_prefix_classifier"] for c in s["conditions"]}
    a_by_id = {(s["stub"], c["stable_key"]): c["type"]
               for s in arms_raw["AFTER_fixed_classifier"] for c in s["conditions"]}
    refuse_unless(set(b_by_id) == set(a_by_id), "ARM_CORPUS_PARITY",
                  "the two arms do not carry the same condition-id set; the ladder difference "
                  "would not be attributable to the classifier")
    moved = sorted(k for k in b_by_id if b_by_id[k] != a_by_id[k])
    refuse_unless(bool(moved), "ARMS_ARE_DISTINCT",
                  "the two arms classified EVERY condition identically. Either the BEFORE blob "
                  "is the post-fix source or the same arm was measured twice wearing a "
                  "comparison's name. Refusing to publish a differential of one thing.")
    refuse_unless(
        arms_out["BEFORE_prefix_classifier"]["spine_family_mix"]
        != arms_out["AFTER_fixed_classifier"]["spine_family_mix"], "ARMS_ARE_DISTINCT",
        "the arms differ per-row but their spine family histograms are identical")
    refuse_unless(
        arms_out["BEFORE_prefix_classifier"]["n_spine_conditions"]
        == arms_out["AFTER_fixed_classifier"]["n_spine_conditions"], "ARM_CORPUS_PARITY",
        "the arms disagree on the load-bearing condition COUNT; the family axis is not the "
        "only thing that moved")

    witness = [{"stub": k[0], "stable_key": k[1],
                "before": b_by_id[k], "after": a_by_id[k]} for k in moved[:5]]

    out = {
        "artifact": "ladder-recomputed",
        "generator": GENERATOR_REL,
        "status": ("HYPOTHETICAL -- production flags OFF; no spec artifact on disk is "
                   "rewritten by this run; the 77 sealed corpus untouched"),
        "question_this_artifact_answers": (
            "On the tier-A 11, counting only LOAD-BEARING (spine/trigger) conditions: how many "
            "specs would have every load-bearing condition satisfied if family F were wired, and "
            "in what greedy order do families complete the most specs? It is NOT a family-label "
            "population count (see spine_family_mix for that) and NOT a servable-today count."),
        "corpus": ("tier-a 11 clean strategies, sealed-read phase_b; load-bearing = role in "
                   "(spine, trigger); BINDS = bindable AND NOT approximation AND executed"),
        "arm_provenance": {
            "BEFORE_prefix_classifier": {
                "source": f"git {PRE_COMMIT}:{PRE_PATH}",
                "blob": PRE_BLOB,
                "sha256_computed": pre_sha,
                "sha256_pinned": PRE_SHA256,
                "note": ("read from the git object store at run time, NOT from a scratchpad "
                         "VAULT copy. The VAULT copy the prior run used is byte-identical to "
                         "this blob, but a scratchpad is not provenance."),
            },
            "AFTER_fixed_classifier": {
                "source": f"working tree {PRE_PATH}",
                "sha256_computed": sha256_file(os.path.join(ROOT, PRE_PATH)),
            },
            "binder": ("src/engine/spec_family_bindings.compile_binding_plan at HEAD in BOTH "
                       "arms, ALL FLAGS OFF -- only the classifier differs"),
            "instrument_reuse": ("selection rule, BINDS predicate and bind_status imported by "
                                 "path from docs/replay-results/h1-battery/"
                                 "tier_a_compile_census.py -- never restated"),
            "extraction_source": phase_b,
            "extraction_sha256": {
                s["stub"]: s["extraction_sha256"]
                for s in arms_raw["AFTER_fixed_classifier"]},
        },
        "arms_are_distinct": {
            "gate": "ARMS_ARE_DISTINCT",
            "n_conditions_reclassified": len(moved),
            "witness_rows": witness,
        },
        "definitions": {
            "complete": ("a spec is COMPLETE under a fixed family set F iff every LOAD-BEARING "
                         "condition either already BINDS or belongs to a family in F"),
            "UNTYPED_is_excluded_and_why": (
                "UNTYPED is the ABSENCE of a type, not a family -- there is no primitive to wire. "
                "It is excluded from wireable_families, so any spec carrying an UNTYPED "
                "load-bearing condition can never complete. That exclusion, not a wiring "
                "shortfall, is what caps the AFTER arm's ceiling."),
        },
        "reconciliation_against_the_file_this_replaces": {
            "why": ("The predecessor had no `generator` field and its script is gone, so its "
                    "figures could not be re-derived. This block is the COMPUTED comparison "
                    "between what it published and what this generator measures. A "
                    "disagreement is REPORTED, never silently reconciled."),
            "predecessor_source": f"git blob {PREDECESSOR_BLOB} ({OUT_REL} as of 9e53faca)",
            **_diff_against_published(arms_out, _published_at_head()),
        },
        "arms": arms_out,
    }

    json.dump(out, open(out_path, "w", encoding="utf-8"), indent=2)

    print("=== LADDER RECOMPUTE (both arms COMPUTED here) ===")
    print(out["corpus"])
    print(f"\nBEFORE arm: git {PRE_COMMIT[:8]}:{PRE_PATH}  sha256 {pre_sha[:16]}  [PINNED, gated]")
    print(f"AFTER  arm: working tree                       "
          f"sha256 {out['arm_provenance']['AFTER_fixed_classifier']['sha256_computed'][:16]}")
    print(f"ARMS_ARE_DISTINCT: {len(moved)} conditions reclassified; witness "
          f"{witness[0]['stable_key']} {witness[0]['before']} -> {witness[0]['after']}")
    for gate in GATE_BOUNDARIES:
        print(f"  GATE {gate}: PASS -- boundary: {GATE_BOUNDARIES[gate]}")
    for name, blk in arms_out.items():
        print(f"\n--- {name} --- n_specs={blk['n_specs']} spine={blk['n_spine_conditions']}")
        print("  spine family mix: " + ", ".join(
            f"{k} {v}" for k, v in blk["spine_family_mix"].items()))
        print(f"  wireable: {blk['wireable_families']}  excluded: {blk['excluded_unwireable']}")
        for r in blk["ladder"]:
            print(f"    {r['rung']:<22} -> {r['specs_complete']} of {r['of']}")
        print(f"  ceiling {blk['ceiling_specs_complete']} of {blk['n_specs']} | greedy plateau "
              f"{blk['greedy_plateau_specs_complete']} | "
              f"no greedy rung: {blk['families_that_never_appear_as_a_greedy_rung']} | "
              f"specs with UNTYPED spine cond: {blk['n_specs_with_an_UNTYPED_spine_condition']}")
    rec = out["reconciliation_against_the_file_this_replaces"]
    print(f"\n--- RECONCILIATION vs published: {rec['status']} ---")
    print(f"  agree {rec.get('n_keys_agreeing')} | disagree {rec.get('n_keys_disagreeing')}")
    for arm, ks in (rec.get("keys_disagreeing") or {}).items():
        for k, v in ks.items():
            print(f"  [X] {arm}.{k}: published {v['published']} | RECOMPUTED {v['recomputed']}")
    print(f"\nartifact -> {out_path}{'  (DRAFT)' if draft else ''}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
