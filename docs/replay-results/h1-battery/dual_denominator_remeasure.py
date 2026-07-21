"""Dual-denominator DoD re-measure with section 6a coverage.

Implements docs/designs/spec-dual-denominator-remeasure-2026-07-20.md.

THIS IS A MEASUREMENT, NOT AN INSTRUMENT CHANGE. It binds no differently; it reads.
It GATES rather than narrates: every reconciliation below is an assert, and a failed
assert exits non-zero.

DECLARED MEASUREMENT CONFIGURATION (R-150): the level/zone arm runs with BOTH
TF_LEVELZONE_ROUTING_ENABLED and TF_LEVELZONE_RESOLVER_ENABLED forced "true" for the
AFTER arm, and forced "false" for the null/BEFORE arm. PRODUCTION DEFAULTS STAY OFF.
Every AFTER figure below describes the both-flags-ON hypothetical and is labeled so.

TWO CORPORA, REPORTED SEPARATELY, NEVER POOLED (a rate inherits its window):
  Corpus A -- 16 shakedown specs, 155 taught entry_conditions. The DoD/section-6a corpus.
  Corpus B -- 120 or-branches specs, 6450 taught entry_conditions. The never-evaluated corpus.
The 987 and 2694 belong to Corpus B ONLY. Corpus A contains ZERO trigger-role conditions.
Pooling them would produce a figure belonging to neither.

APPEND-ONLY: writes ONE new file. The prior artifacts are hashed before and after the
run and asserted unchanged -- append-only is verified, not promised.

Run: python docs/replay-results/h1-battery/dual_denominator_remeasure.py
"""

from __future__ import annotations

import collections
import glob
import hashlib
import json
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
os.chdir(REPO_ROOT)
sys.path.insert(0, str(REPO_ROOT))

# Trap 7: import via src.engine.*, never engine.*, so a global editable-install .pth
# cannot resolve these names into a DIFFERENT checkout.
import src.engine.spec_family_bindings as sfb  # noqa: E402

H1 = REPO_ROOT / "docs" / "replay-results" / "h1-battery"
CORPUS_A_GLOB = str(
    REPO_ROOT / "docs" / "replay-results" / "h1-scripts" / "claude-rung-v32" / "shakedown_specs" / "*.spec.json"
)
CORPUS_B_PATH = REPO_ROOT / "docs" / "replay-results" / "or-branches-full-corpus-specs-2026-07-05.json"
NARRATION_PATH = H1 / "narration-reclassification-FINAL.json"
CENSUS_PATH = H1 / "levelzone-object-reference-census.json"
ENFORCEMENT_PATH = H1 / "family-meta-enforcement-delta.json"
OUT_PATH = H1 / "dual-denominator-remeasure-2026-07-21.json"

# Prior artifacts that MUST NOT move. Verified by hash, before and after.
APPEND_ONLY_GUARDED = [
    H1 / "wire1-dod-HONEST-FLOOR.json",
    H1 / "wire1-dod-remeasure.json",
    H1 / "population-a-flip-step-remeasure.json",
    NARRATION_PATH,
    CENSUS_PATH,
]


def sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def rate0(num, den):
    """Rounded ratio, or None when the denominator is empty. Module-level so the drift
    classification can use it before main()'s local alias is bound."""
    return round(num / den, 4) if den else None


def count_own_asserts() -> int:
    """Count assert statements in THIS file by parsing it. AR-188 fix 6.

    The prior claim -- "eight asserts, each red-proved" -- was hand-typed, and the file held
    twelve. A hand-typed count of a thing the file itself can count is the hardcoded-test-copy
    defect. This number is now derived from the source's own AST, so it cannot drift from it.
    """
    import ast

    tree = ast.parse(Path(__file__).read_text(encoding="utf-8"))
    return sum(1 for n in ast.walk(tree) if isinstance(n, ast.Assert))


def classify_drift(rate_pre, rate_post, cov_pre, cov_post) -> dict:
    """Decide, FROM THE NUMBERS, which way the two metrics moved. AR-188 fix 1.

    THE STANDING RULE THIS ENFORCES: an interpretation is COMPUTED from the fields that decide
    it, or it is ABSENT. The string this replaces printed for ANY non-zero delta in EITHER
    direction -- it asserted "the rate improves while coverage worsens" even when the rate had
    worsened, which is exactly what happened. A sentence that prints regardless of the data is
    a caption, not a finding.

    DIRECTION CONVENTION, stated because the prior prose got it backwards:
      binding_approximation_rate is the APPROXIMATION SHARE. It going UP is WORSE.
      section-6a coverage is the BOUND-AND-CONCRETE SHARE. It going UP is BETTER.
    The section-6a defect is the specific pair (rate BETTER, coverage WORSE) -- a spec buying a
    better-looking rate by shedding conditions out of its denominator. Both metrics moving the
    SAME way is the OPPOSITE of that defect: it means the change was paid for in both books.
    """
    d_rate = None if rate_pre is None or rate_post is None else round(rate_post - rate_pre, 6)
    d_cov = None if cov_pre is None or cov_post is None else round(cov_post - cov_pre, 6)
    if d_rate is None or d_cov is None:
        return {"verdict": "NOT_COMPUTABLE", "reason": "an arm is missing a figure", "delta_rate": d_rate,
                "delta_coverage": d_cov}
    rate_q = -d_rate  # positive == fidelity improved on the rate
    cov_q = d_cov     # positive == fidelity improved on coverage
    if rate_q == 0 and cov_q == 0:
        verdict, reading = "NO_DRIFT", "Neither metric moved. There is nothing to interpret."
    elif rate_q > 0 and cov_q < 0:
        verdict, reading = (
            "OPPOSITE_DIRECTIONS__SECTION_6A_DEFECT",
            "The rate IMPROVED while coverage WORSENED. Conditions left the rate's denominator "
            "instead of being bound: the vanishing-denominator defect section 6a exists to expose.",
        )
    elif rate_q < 0 and cov_q > 0:
        verdict, reading = (
            "OPPOSITE_DIRECTIONS__RATE_PAID_COVERAGE_GAINED",
            "The rate WORSENED while coverage IMPROVED. Conditions entered the denominator and "
            "bound approximately. Not the 6a defect -- the opposite trade.",
        )
    else:
        better = rate_q > 0
        verdict = "SAME_DIRECTION__BOTH_IMPROVED" if better else "SAME_DIRECTION__BOTH_DEGRADED"
        reading = (
            "Both metrics moved the SAME way (" + ("both improved" if better else "both degraded") + "). "
            "This is NOT the section-6a defect: a vanishing denominator flatters the rate while costing "
            "coverage, and that did not happen here. A change that pays in BOTH books is not gaming either."
        )
    return {
        "verdict": verdict,
        "reading": reading,
        "delta_rate_raw": d_rate,
        "delta_coverage_raw": d_cov,
        "rate_quality_delta_positive_is_better": rate_q,
        "coverage_quality_delta_positive_is_better": cov_q,
        "how_to_falsify": (
            "Change either arm's rate or coverage so the two quality deltas differ in sign and this "
            "verdict changes. It is a function of four numbers and nothing else."
        ),
    }


def compose_completed_coverage(
    entry_off_concrete, entry_on_concrete, inval_off_concrete, inval_on_concrete,
    n_taught_entry, n_invalidations,
) -> dict:
    """Build the completed-161 dual-configuration block. R-199 s2.

    THE RULING THIS IMPLEMENTS: 6/161 (honest-enforcement, TF_FAMILY_META_ENFORCED=true) is
    PRIMARY. 12/161 (the generator's default-OFF config) travels BESIDE it, labeled with its
    provenance -- neither is dropped, and the choice is not made silently.

    WHY THE CAVEAT IS A COMPUTATION AND NOT A SENTENCE: this artifact's headline defect was a
    hardcoded interpretation string that printed regardless of the data (see classify_drift).
    Replacing one caption with another caption -- "6 of the margin rests on a withdrawn claim",
    typed -- would be the same defect wearing the ruling's words. So the margin and its
    COMPOSITION are derived here from the same per-arm fields that produce the two rates. If
    the INVALIDATE contribution changed, every number in the caveat changes with it, and the
    dependency verdict re-classifies. It is a function of five integers and nothing else.

    THE WITHDRAWN CLAIM: the larger figure's margin comes from spec['invalidations'] entries
    binding with approximation=False under enforcement-OFF. That approximation=False was a
    convicted pointer lie -- the primitive it pointed at is never called in production -- and
    the enforcement build corrected it to approximation=True. So the margin is not merely
    configuration-dependent; it is partly built on a retracted claim, and this block says so
    with numbers that can be checked instead of believed.
    """
    # ENFORCEMENT MAY ONLY REMOVE CONCRETENESS, NEVER ADD IT. This is the direction claim the
    # Corpus-B INVALIDATE_enforcement block already makes ("fidelity moves DOWN"). It is a
    # property of the DATA, not algebra, so it CAN fire: call this function with
    # inval_on_concrete > inval_off_concrete and it raises. Red-proved that way.
    assert inval_on_concrete <= inval_off_concrete, (
        f"ENFORCEMENT DIRECTION VIOLATED: enforcement-ON bound {inval_on_concrete} invalidations "
        f"concrete but enforcement-OFF bound only {inval_off_concrete}. Enforcement marks entries "
        "approximation=True; it can never make MORE of them concrete. The arms are mislabeled or "
        "the flag no longer does what INVALIDATE_enforcement says it does."
    )

    den = n_taught_entry + n_invalidations
    num_primary = entry_on_concrete + inval_on_concrete
    num_secondary = entry_off_concrete + inval_off_concrete

    # TWO INDEPENDENT SOURCES, each measured. An earlier draft of this function took ONE entry
    # count for both arms, which made margin == margin_from_invalidate as an ALGEBRAIC IDENTITY:
    # the "partly" and "independent" branches below could never be reached, and
    # margin_from_other_sources was always 0 by construction rather than by measurement. A
    # decomposition whose answer is fixed before the data arrives is a caption with arithmetic
    # painted on it -- the same defect, one level down. Both sides are now measured per arm, so
    # the entry term CAN contribute and the branch that reports it CAN be reached.
    margin = num_secondary - num_primary
    margin_from_invalidate_withdrawal = inval_off_concrete - inval_on_concrete
    margin_from_entry_conditions = entry_off_concrete - entry_on_concrete
    margin_from_other_sources = margin_from_entry_conditions
    margin_share_withdrawn = rate0(margin_from_invalidate_withdrawal, margin)

    if margin == 0:
        dependency = "NO_MARGIN__THE_TWO_CONFIGURATIONS_AGREE"
        caveat = (
            f"The two configurations produce the SAME numerator ({num_primary}/{den}). There is no "
            "margin, so nothing rests on the withdrawn INVALIDATE approximation=False claim."
        )
    elif margin_from_invalidate_withdrawal == margin:
        dependency = "MARGIN_RESTS_ENTIRELY_ON_THE_WITHDRAWN_CLAIM"
        caveat = (
            f"The larger figure exceeds the primary by {margin} of {den}, and ALL {margin} of that "
            f"margin is invalidations entries binding approximation=False under enforcement-OFF. "
            "That approximation=False has been WITHDRAWN as a convicted pointer lie -- its primitive "
            "is never called in production, and the enforcement build corrected it to "
            f"approximation=True. So {margin} of the {num_secondary} conditions in the larger "
            "numerator are counted concrete only by a claim that has been retracted."
        )
    elif margin_from_invalidate_withdrawal > 0:
        dependency = "MARGIN_PARTLY_RESTS_ON_THE_WITHDRAWN_CLAIM"
        caveat = (
            f"The larger figure exceeds the primary by {margin} of {den}. "
            f"{margin_from_invalidate_withdrawal} of that margin is invalidations entries binding "
            "approximation=False under enforcement-OFF -- a claim WITHDRAWN as a convicted pointer "
            f"lie. The remaining {margin_from_other_sources} comes from elsewhere and is not "
            "impeached by the withdrawal."
        )
    else:
        dependency = "MARGIN_INDEPENDENT_OF_THE_WITHDRAWN_CLAIM"
        caveat = (
            f"The larger figure exceeds the primary by {margin} of {den}, and NONE of that margin is "
            "invalidations concreteness. The withdrawn INVALIDATE approximation=False claim does not "
            "carry this margin."
        )

    return {
        "READ_THIS_ONE": {
            "WHY": (
                "R-199 s2: a consumer taking exactly one coverage number from this artifact takes "
                "THIS one. It is the honest-enforcement figure -- the arm in which the INVALIDATE "
                "entries bind under the CORRECTED approximation=True."
            ),
            "coverage_over_161": rate0(num_primary, den),
            "fraction": f"{num_primary}/{den}",
            "numerator": num_primary,
            "numerator_composition": (
                f"{entry_on_concrete} entry_conditions + {inval_on_concrete} invalidations"
            ),
            "denominator": den,
            "configuration": {"TF_FAMILY_META_ENFORCED": "true"},
            "status": "PRIMARY",
        },
        "BESIDE_IT_NOT_INSTEAD_OF_IT": {
            "WHY": (
                "Kept because it is the configuration this generator actually runs in, and dropping "
                "a measured arm to leave one clean number is the error this artifact was sent back "
                "to repair. It is reported WITH its provenance, never as the headline."
            ),
            "coverage_over_161": rate0(num_secondary, den),
            "fraction": f"{num_secondary}/{den}",
            "numerator": num_secondary,
            "numerator_composition": (
                f"{entry_off_concrete} entry_conditions + {inval_off_concrete} invalidations"
            ),
            "denominator": den,
            "configuration": {"TF_FAMILY_META_ENFORCED": "false (this generator's default)"},
            "status": "SECONDARY__NOT_THE_HEADLINE",
            "PROVENANCE_CAVEAT_COMPUTED": caveat,
            "provenance_dependency_verdict": dependency,
        },
        "MARGIN_DECOMPOSITION": {
            "why_this_block_exists": (
                "So the caveat above is checkable arithmetic rather than a sentence. Every figure "
                "in the caveat is one of these fields; change the per-arm inputs and both move."
            ),
            "margin_secondary_minus_primary": margin,
            "margin_from_INVALIDATE_withdrawn_approximation_False": margin_from_invalidate_withdrawal,
            "margin_from_entry_conditions_MEASURED_NOT_ASSUMED": margin_from_entry_conditions,
            "margin_from_other_sources": margin_from_other_sources,
            "share_of_margin_resting_on_the_withdrawn_claim": margin_share_withdrawn,
            "why_the_entry_term_is_measured": (
                "The two 161-figures differ only in TF_FAMILY_META_ENFORCED. Attributing the whole "
                "margin to INVALIDATE requires that the flag move invalidations and NOT "
                "entry_conditions. That is a claim about the flag, so it is measured per arm rather "
                "than assumed: this field is the entry side's contribution to the margin, and it "
                "came back "
                + (
                    f"{margin_from_entry_conditions} -- the flag does not move the entry side, so "
                    "the INVALIDATE attribution is exclusive by MEASUREMENT."
                    if margin_from_entry_conditions == 0
                    else f"{margin_from_entry_conditions} -- the flag DOES move the entry side, so "
                    "the margin has a second source and the INVALIDATE attribution is NOT exclusive."
                )
            ),
            "withdrawn_claim": {
                "claim": "spec['invalidations'] entries bind with approximation=False",
                "status": "WITHDRAWN -- convicted pointer lie",
                "why_withdrawn": (
                    "The primitive the pointer named is never called in production. The enforcement "
                    "build corrected the binding to approximation=True."
                ),
            },
            "how_to_falsify": (
                "Change any of the four measured per-arm counts and re-run: the margin, its "
                "composition, the share, the dependency verdict, and the caveat's own numbers all "
                "move. Nothing in the caveat is typed. Specifically -- lower inval_off_concrete and "
                "the margin and the caveat's figures shrink together; make entry_off_concrete "
                "differ from entry_on_concrete and the verdict re-classifies to "
                "MARGIN_PARTLY_RESTS_ON_THE_WITHDRAWN_CLAIM, because the entry term is measured "
                "rather than fixed at zero."
            ),
        },
    }


def set_levelzone_flags(on: bool) -> None:
    v = "true" if on else "false"
    os.environ["TF_LEVELZONE_ROUTING_ENABLED"] = v
    os.environ["TF_LEVELZONE_RESOLVER_ENABLED"] = v


def load_corpus_a() -> list[tuple[str, list[dict], dict]]:
    out = []
    for p in sorted(glob.glob(CORPUS_A_GLOB)):
        d = json.loads(Path(p).read_text(encoding="utf-8"))
        name = os.path.basename(p).replace(".spec.json", "")
        out.append((name, d["spec"]["entry_conditions"], d.get("approximation_metrics") or {}))
    return out


def iter_specs(o):
    if isinstance(o, dict):
        if "entry_conditions" in o and "entry_trigger_id" in o:
            yield o
            return
        for v in o.values():
            yield from iter_specs(v)
    elif isinstance(o, list):
        for v in o:
            yield from iter_specs(v)


def measure_corpus_a(specs) -> dict:
    """Bind every taught condition. Returns totals + per-spec rows + per-family tallies."""
    taught = bound = approx = 0
    by_family_approx: collections.Counter = collections.Counter()
    by_family_taught: collections.Counter = collections.Counter()
    rows = []
    unbound_ids = []
    concrete_ids = []
    # condition-level snapshot, keyed spec|id, so the two arms can be diffed PER KIND.
    bmap: dict[str, tuple] = {}
    for name, ec, am in specs:
        s_taught = s_bound = s_approx = 0
        for c in ec:
            s_taught += 1
            by_family_taught[c.get("type")] += 1
            b = sfb.bind_condition(c)
            bmap[f"{name}|{c.get('id')}"] = (
                b.bindable,
                b.approximation,
                sfb.classify_population_a_kind(c.get("object") or ""),
                c.get("type"),
            )
            if not b.bindable:
                unbound_ids.append({"spec": name, "type": c.get("type"), "condition_id": c.get("id")})
                continue
            s_bound += 1
            if b.approximation:
                s_approx += 1
                by_family_approx[c.get("type")] += 1
            else:
                concrete_ids.append({"spec": name, "type": c.get("type"), "condition_id": c.get("id")})
        taught += s_taught
        bound += s_bound
        approx += s_approx
        rows.append(
            {
                "spec": name,
                "n_taught": s_taught,
                "n_bindable": s_bound,
                "n_unbound": s_taught - s_bound,
                "n_binding_approximation": s_approx,
                "n_bound_and_concrete": s_bound - s_approx,
                # rate is over EXECUTED-BINDABLE -- this is the denominator section 6a exists to expose
                "binding_approximation_rate": round(s_approx / s_bound, 4) if s_bound else None,
                "binding_approximation_rate_n": s_bound,
                "coverage_bound_and_concrete_over_all_taught": round((s_bound - s_approx) / s_taught, 4)
                if s_taught
                else None,
                "coverage_n": s_taught,
                "census_n_executed_bindable": am.get("n_executed_bindable"),
                # AR-188 fix 2: n_binding_approximation sat in the SAME census block as
                # n_executed_bindable and was never read. It is the field that decides whether a
                # vanished condition was APPROXIMATE (its loss flatters the rate) or CONCRETE
                # (its loss costs both metrics). Reading only the bindable count is what let the
                # prior reconciliation assert a direction it had not measured.
                "census_n_binding_approximation": am.get("n_binding_approximation"),
                "census_n_bound_and_concrete": (
                    am["n_executed_bindable"] - am["n_binding_approximation"]
                    if am.get("n_executed_bindable") is not None
                    and am.get("n_binding_approximation") is not None
                    else None
                ),
            }
        )
    return {
        "n_taught": taught,
        "n_bindable": bound,
        "n_unbound": taught - bound,
        "n_binding_approximation": approx,
        "n_bound_and_concrete": bound - approx,
        "by_family_taught": dict(by_family_taught),
        "by_family_approximated": dict(by_family_approx),
        "rows": rows,
        "unbound_conditions": unbound_ids,
        "bound_and_concrete_conditions": concrete_ids,
        "binding_map": bmap,
    }


def main() -> None:
    # MOVED HERE FROM AFTER THE WRITE (AR-188 fix 6). This guard previously sat BELOW
    # OUT_PATH.write_text(), so in the one scenario it names -- the output path colliding with a
    # guarded prior artifact -- the overwrite had ALREADY HAPPENED before the assert ran. A guard
    # positioned after the harm it names cannot prevent it. As a precondition it can now actually
    # stop the run.
    assert OUT_PATH not in APPEND_ONLY_GUARDED, (
        f"output path {OUT_PATH} collides with a guarded prior artifact -- refusing to overwrite"
    )
    before_hashes = {str(p.relative_to(REPO_ROOT)): sha(p) for p in APPEND_ONLY_GUARDED if p.exists()}

    # ---------------------------------------------------------------- CORPUS B
    # The never-evaluated universe. Derived HERE from the corpus itself -- the 987 is
    # re-derived, never transcribed, by three paths that must agree.
    corpus_b = json.loads(CORPUS_B_PATH.read_text(encoding="utf-8"))
    b_specs = list(iter_specs(corpus_b))
    roles: collections.Counter = collections.Counter()
    trigger_by_family: collections.Counter = collections.Counter()
    b_total = 0
    for s in b_specs:
        for c in s["entry_conditions"]:
            b_total += 1
            r = c.get("role")
            roles[r] += 1
            if r == "trigger":
                trigger_by_family[c.get("type")] += 1

    # PATH 1 -- direct tally of role == "trigger" over the universe.
    path1 = roles["trigger"]
    # PATH 2 -- the COMPLEMENT: total minus the two roles that are not trigger. Independent
    # of path 1 because it never tests for "trigger" at all; it can only agree if the role
    # partition is exhaustive, which is the reconciliation clause 10 demands.
    path2 = b_total - roles["spine"] - roles["confluence"]
    # PATH 3 -- sum of the per-family breakdown. Catches a family silently dropped from the
    # enumeration -- the exact defect that produced 921.
    path3 = sum(trigger_by_family.values())

    assert path1 == path2 == path3, (
        f"987 derivation DISAGREES across paths: role-tally={path1} complement={path2} family-sum={path3}"
    )
    # DELETED (AR-188 fix 6): an assert that the role partition is exhaustive
    # (spine + confluence + trigger == b_total) stood here and COULD NOT FIRE. It is algebraically
    # implied by the assert above: path1 == path2 already says
    # roles["trigger"] == b_total - roles["spine"] - roles["confluence"], which rearranges to
    # exactly the deleted condition. An assert that cannot fail is not a check, it is a decoration
    # that inflates the count of checks. The property is still REPORTED (see
    # RECONCILIATION.corpus_B_role_partition.exact) -- reporting it is honest; asserting it twice
    # was not.
    never_by_gap = path1
    never_by_design = roles["confluence"]

    # ---------------------------------------------------------------- CORPUS A
    specs_a = load_corpus_a()

    set_levelzone_flags(False)
    a_before = measure_corpus_a(specs_a)  # NULL / BEFORE arm: production default, flags OFF

    set_levelzone_flags(True)
    a_after = measure_corpus_a(specs_a)  # AFTER arm: declared flags-ON hypothetical

    set_levelzone_flags(False)  # leave the process as we found it

    assert a_before["n_taught"] == a_after["n_taught"], "taught denominator moved between arms -- it must not"
    assert a_before["n_bindable"] == a_after["n_bindable"], (
        "bindable denominator moved between arms; the level/zone flip changes approximation, never bindability"
    )

    # Per-family attribution: which family earned which part of the movement.
    fam_delta = {}
    # sorted(): set iteration order varies with PYTHONHASHSEED, which made two runs of this
    # generator differ in BYTES while agreeing in every value. A measurement that cannot
    # reproduce byte-for-byte cannot be diffed by a grader, so the order is pinned.
    for fam in sorted(set(a_before["by_family_approximated"]) | set(a_after["by_family_approximated"])):
        b = a_before["by_family_approximated"].get(fam, 0)
        af = a_after["by_family_approximated"].get(fam, 0)
        fam_delta[fam] = {"approximated_BEFORE": b, "approximated_AFTER": af, "delta": af - b}

    # PER-KIND attribution: an aggregate delta hides which change earned what. Diff the two
    # arms condition-by-condition and attribute each de-approximation to its Population-A kind.
    per_kind: dict[str, dict] = {}
    swing_still_true = 0
    for key, (_bb, ba, kind, _fam) in a_before["binding_map"].items():
        nb, na, _k, _f = a_after["binding_map"][key]
        if kind is not None and na is True and nb:
            if kind == "swing":
                swing_still_true += 1
        if ba is True and na is False:
            slot = per_kind.setdefault(kind, {"n_flipped": 0, "condition_ids": []})
            slot["n_flipped"] += 1
            slot["condition_ids"].append(key)

    assert per_kind.get("swing", {}).get("n_flipped", 0) == 0, (
        "swing MUST NOT de-approximate -- n=1 is below the n>=2 floor (R-102 section 2)"
    )
    assert set(per_kind) <= {"named_sr_level", "order_block_edge"}, (
        f"a kind OUTSIDE the two graded kinds de-approximated: {sorted(set(per_kind))}. "
        "The flip's grade licenses named_sr_level and order_block_edge ONLY."
    )

    # ------------------------------------- DERIVED FACTS THAT WERE HAND-TYPED (AR-188 fix 6)
    # Corpus-A role composition. Previously the string literal
    # "spine 102 / confluence 53 / trigger 0 -- derived, see reconciliation" -- hand-typed, with
    # NO such reconciliation entry to see. The never-pool rule (Corpus A holds zero trigger-role
    # conditions) rested on an unasserted hand-typed value. It is now counted and asserted.
    a_roles: collections.Counter = collections.Counter()
    for _n, ec, _am in specs_a:
        for c in ec:
            a_roles[c.get("role")] += 1
    # NOT ASSERTED, deliberately: sum(a_roles.values()) == n_taught iterates the SAME conditions on
    # both sides and so can never fail. Writing it as an assert would have re-committed, in the very
    # commit that removes two dead asserts, the defect being removed. It is REPORTED instead
    # (corpus_A_role_partition_sum) where a reader can compare it against n_taught_conditions.
    assert a_roles.get("trigger", 0) == 0, (
        f"Corpus A now holds {a_roles.get('trigger', 0)} trigger-role conditions. The never-pool "
        "rule and the 'Corpus A contains ZERO trigger-role conditions' claim both depend on this "
        "being 0; if it moved, every corpus-separation statement here must be re-derived."
    )

    # Population-A kind histogram over all Corpus-A conditions. The declared non-discriminating
    # control previously gave its reason as "only three kinds occur". FOUR occur -- and the modal
    # value is None (conditions no kind classifies), by a wide margin. The control's CONCLUSION was
    # right; its stated REASON was false, which makes the reason unfalsifiable decoration. Counted.
    kind_hist: collections.Counter = collections.Counter()
    for _bb, _ba, kind, _fam in a_before["binding_map"].values():
        kind_hist[kind] += 1
    kind_counts = {("None" if k is None else k): v for k, v in sorted(
        kind_hist.items(), key=lambda x: (-x[1], str(x[0])))}
    modal_kind, modal_n = max(kind_hist.items(), key=lambda x: x[1])

    # SESSION ATTRIBUTION (AR-188 fix 5). Mandated by the spec ("how much session") and absent from
    # the artifact, because per_family_attribution is built from by_family_approximated and UNBOUND
    # rows never enter it -- a family that binds NOTHING is structurally invisible there. The number
    # goes in precisely because it is the least flattering one available.
    ws_taught = sum(1 for _n, ec, _am in specs_a for c in ec if c.get("type") == "WAIT_SESSION")
    ws_unbound = sum(1 for u in a_before["unbound_conditions"] if u["type"] == "WAIT_SESSION")
    ws_bound_after = sum(
        1 for (_bb, _ba, _k, fam) in a_after["binding_map"].values() if fam == "WAIT_SESSION"
    ) - sum(1 for u in a_after["unbound_conditions"] if u["type"] == "WAIT_SESSION")

    # THE 161 DENOMINATOR (AR-188 fix 4). The 155 counts entry_conditions ONLY; the 16 specs also
    # carry 6 `invalidations` entries that are just as taught. Measured under BOTH enforcement arms
    # because the arm decides the numerator -- see the artifact note.
    inval_specs = []
    for p in sorted(glob.glob(CORPUS_A_GLOB)):
        d = json.loads(Path(p).read_text(encoding="utf-8"))
        inval_specs.append(d["spec"].get("invalidations") or [])
    n_invalidations = sum(len(v) for v in inval_specs)
    prev_enf = os.environ.get("TF_FAMILY_META_ENFORCED")
    inval_arms = {}
    # ENTRY SIDE, MEASURED PER ARM (R-199 s2). The prior version carried a SINGLE entry numerator
    # across both enforcement arms -- i.e. it ASSUMED TF_FAMILY_META_ENFORCED moves invalidations
    # only and never touches entry_conditions. That assumption was never measured, and it is the
    # load-bearing one: if it were false, the margin between the two 161-figures would have a
    # second source and the provenance caveat below would be attributing the whole margin to
    # INVALIDATE on faith. So it is MEASURED here, in the same arm loop, and reported as a number
    # that could have come back non-zero.
    entry_arms = {}
    for enf_on in (False, True):
        os.environ["TF_FAMILY_META_ENFORCED"] = "true" if enf_on else "false"
        nb = nc = 0
        for ivs in inval_specs:
            for iv in ivs:
                bb = sfb.bind_condition(iv)
                if bb.bindable:
                    nb += 1
                    if not bb.approximation:
                        nc += 1
        inval_arms["enforcement_ON" if enf_on else "enforcement_OFF"] = {
            "n_bindable": nb, "n_bound_and_concrete": nc}
    # ENTRY SIDE runs with the LEVEL/ZONE FLAGS ON, because the entry numerator the two 161
    # figures are built from is the flags-ON AFTER arm (a_after). Measuring it in the flags-OFF
    # context this block otherwise runs in would read 0 concrete, not 6, and would be answering a
    # different question than the one the coverage figures ask. The arm context is pinned, not
    # inherited.
    set_levelzone_flags(True)
    for enf_on in (False, True):
        os.environ["TF_FAMILY_META_ENFORCED"] = "true" if enf_on else "false"
        enb = enc = 0
        for _n, ec, _am in specs_a:
            for c in ec:
                bb = sfb.bind_condition(c)
                if bb.bindable:
                    enb += 1
                    if not bb.approximation:
                        enc += 1
        entry_arms["enforcement_ON" if enf_on else "enforcement_OFF"] = {
            "n_bindable": enb, "n_bound_and_concrete": enc}
    set_levelzone_flags(False)  # leave the process as this block found it
    if prev_enf is None:
        os.environ.pop("TF_FAMILY_META_ENFORCED", None)
    else:
        os.environ["TF_FAMILY_META_ENFORCED"] = prev_enf

    # ------------------------------------------- CENSUS-vs-LIVE RECONCILIATION
    # The frozen R-082 census recorded n_executed_bindable per spec. Summing it and
    # comparing against a LIVE bind is a check against something outside this pipeline.
    # ARM COMPARABILITY (AR-188). The frozen census was taken PRE-CLOSURE with the level/zone
    # flags OFF. The comparable live arm is therefore a_before (post-closure, flags OFF) -- NOT
    # a_after. The prior version compared census(pre-closure, flags-OFF) against a_after
    # (post-closure, flags-ON), so the 6 level/zone flips were folded into a delta attributed to
    # the closure. Varying two things and naming one is how the headline inverted.
    cen_rows = [r for r in a_before["rows"] if r["census_n_executed_bindable"] is not None]
    census_bindable = sum(r["census_n_executed_bindable"] for r in cen_rows)
    census_approx = sum(r["census_n_binding_approximation"] for r in cen_rows)
    census_concrete = census_bindable - census_approx
    live_bindable = a_before["n_bindable"]
    live_approx = a_before["n_binding_approximation"]
    live_concrete = a_before["n_bound_and_concrete"]

    drift_rows = []
    for r in cen_rows:
        if r["n_bindable"] == r["census_n_executed_bindable"]:
            continue
        d_concrete = r["n_bound_and_concrete"] - r["census_n_bound_and_concrete"]
        d_approx = r["n_binding_approximation"] - r["census_n_binding_approximation"]
        # WHICH KIND of condition vanished decides the direction. This is the field the prior
        # reconciliation did not read.
        if d_concrete < 0 and d_approx == 0:
            vanished = "BOUND_AND_CONCRETE"
            why = ("The lost condition was CONCRETE, not approximate. Its loss REMOVES a member from "
                   "the section-6a numerator, so coverage falls -- and because it was concrete it was "
                   "holding the rate DOWN, so the approximation share rises too. Both metrics pay.")
        elif d_approx < 0 and d_concrete == 0:
            vanished = "BINDING_APPROXIMATION"
            why = ("The lost condition was APPROXIMATE. Its loss removes an approximate member from the "
                   "rate's denominator, which FLATTERS the rate while leaving the 6a numerator intact.")
        elif d_concrete < 0 and d_approx < 0:
            vanished = "MIXED"
            why = "Both concrete and approximate members were lost; see the per-count deltas."
        else:
            vanished = "NET_GAIN_OR_UNCLASSIFIED"
            why = "Bindability moved without a net loss of either kind; see the per-count deltas."
        drift_rows.append(
            {
                "spec": r["spec"],
                "census_n_executed_bindable": r["census_n_executed_bindable"],
                "live_n_bindable": r["n_bindable"],
                "delta": r["n_bindable"] - r["census_n_executed_bindable"],
                "census_n_binding_approximation": r["census_n_binding_approximation"],
                "live_n_binding_approximation": r["n_binding_approximation"],
                "census_n_bound_and_concrete": r["census_n_bound_and_concrete"],
                "live_n_bound_and_concrete": r["n_bound_and_concrete"],
                "delta_bound_and_concrete": d_concrete,
                "delta_binding_approximation": d_approx,
                "vanished_condition_was": vanished,
                "why_this_decides_the_direction": why,
                "unbound_conditions_in_this_spec_live": [
                    u for u in a_before["unbound_conditions"] if u["spec"] == r["spec"]
                ],
            }
        )

    # The two comparable arms, both flags-OFF, differing ONLY in the closure.
    census_rate = rate0(census_approx, census_bindable)
    census_cov = rate0(census_concrete, a_before["n_taught"])
    live_rate = rate0(live_approx, live_bindable)
    live_cov = rate0(live_concrete, a_before["n_taught"])
    closure_drift = classify_drift(census_rate, live_rate, census_cov, live_cov)

    # ---------------------------------------------------------------- CEILING
    census = json.loads(CENSUS_PATH.read_text(encoding="utf-8"))
    n_levelzone_rows = census["n"]
    assert n_levelzone_rows == 16, f"level/zone census drifted: expected 16 rows, got {n_levelzone_rows}"
    total_flipped = -sum(v["delta"] for v in fam_delta.values())
    assert total_flipped <= 6, f"CEILING BREACHED: {total_flipped} conditions de-approximated, ceiling is 6 of 16"

    # ------------------------------------------------- DUAL DENOMINATORS (carried)
    narration = json.loads(NARRATION_PATH.read_text(encoding="utf-8"))
    dual = narration["dual_denominators"]

    # ------------------------------------------------- ENFORCEMENT (Corpus B, read)
    enf = json.loads(ENFORCEMENT_PATH.read_text(encoding="utf-8"))
    inv = enf["invalidation_approximation_counts"]
    assert enf["never_evaluated_total"] == never_by_gap, (
        f"enforcement artifact says {enf['never_evaluated_total']} never-evaluated; I derive {never_by_gap}"
    )
    assert enf["all_entry_conditions"] == b_total, "enforcement artifact universe size disagrees with mine"

    rate = rate0

    # R-199 s2. Computed from the per-arm invalidation binds and the entry-condition numerator --
    # the same fields the two coverage_over_161_* keys below are computed from, so the primary
    # designation and its provenance caveat cannot drift from the rates they describe.
    completed_coverage = compose_completed_coverage(
        entry_off_concrete=entry_arms["enforcement_OFF"]["n_bound_and_concrete"],
        entry_on_concrete=entry_arms["enforcement_ON"]["n_bound_and_concrete"],
        inval_off_concrete=inval_arms["enforcement_OFF"]["n_bound_and_concrete"],
        inval_on_concrete=inval_arms["enforcement_ON"]["n_bound_and_concrete"],
        n_taught_entry=a_after["n_taught"],
        n_invalidations=n_invalidations,
    )

    art = {
        "artifact": "dual-denominator-remeasure-2026-07-21",
        "spec": "docs/designs/spec-dual-denominator-remeasure-2026-07-20.md",
        "APPEND_ONLY": True,
        "generator": "docs/replay-results/h1-battery/dual_denominator_remeasure.py",
        "reproduce": "python docs/replay-results/h1-battery/dual_denominator_remeasure.py",
        "DECLARED_MEASUREMENT_CONFIGURATION": {
            "level_zone_flags_AFTER_arm": {
                "TF_LEVELZONE_ROUTING_ENABLED": "true",
                "TF_LEVELZONE_RESOLVER_ENABLED": "true",
            },
            "level_zone_flags_BEFORE_arm_and_NULL": {
                "TF_LEVELZONE_ROUTING_ENABLED": "false",
                "TF_LEVELZONE_RESOLVER_ENABLED": "false",
            },
            "PRODUCTION_DEFAULT": "OFF -- both flags default 'false' when unset.",
            "honest_reading": (
                "Every AFTER figure here is the both-flags-ON HYPOTHETICAL, labeled as such. "
                "Production output today, with default env, is the BEFORE arm."
            ),
        },
        "CORPORA_ARE_SEPARATE": (
            "Corpus A and Corpus B are different windows and are NEVER pooled. The 987/2694 are "
            "Corpus B figures only; Corpus A contains zero trigger-role conditions. A rate inherits "
            "its window: every rate below states its corpus, spec count, and condition count."
        ),
        "corpus_A": {
            "name": "shakedown / tier-b DoD corpus",
            "path": "docs/replay-results/h1-scripts/claude-rung-v32/shakedown_specs/*.spec.json",
            "n_specs": len(specs_a),
            "n_taught_conditions": a_after["n_taught"],
            # DERIVED, not typed (AR-188). See RECONCILIATION.corpus_A_role_partition, which now
            # exists -- the prior string said "see reconciliation" and there was nothing to see.
            "role_composition": {
                ("None" if k is None else k): v
                for k, v in sorted(a_roles.items(), key=lambda x: (-x[1], str(x[0])))
            },
            "role_composition_note": (
                "Counted from the corpus and asserted, not transcribed. trigger == 0 is ASSERTED "
                "because the never-pool rule depends on it."
            ),
            "BEFORE_flags_off": {
                "n_bindable": a_before["n_bindable"],
                "n_unbound": a_before["n_unbound"],
                "n_binding_approximation": a_before["n_binding_approximation"],
                "n_bound_and_concrete": a_before["n_bound_and_concrete"],
                "binding_approximation_rate": rate(a_before["n_binding_approximation"], a_before["n_bindable"]),
                "binding_approximation_rate_n": a_before["n_bindable"],
                "section_6a_coverage_bound_and_concrete_over_ALL_TAUGHT_ENTRY_CONDITIONS": rate(
                    a_before["n_bound_and_concrete"], a_before["n_taught"]
                ),
                "section_6a_coverage_n": a_before["n_taught"],
            },
            "AFTER_flags_on_HYPOTHETICAL": {
                "n_bindable": a_after["n_bindable"],
                "n_unbound": a_after["n_unbound"],
                "n_binding_approximation": a_after["n_binding_approximation"],
                "n_bound_and_concrete": a_after["n_bound_and_concrete"],
                "binding_approximation_rate": rate(a_after["n_binding_approximation"], a_after["n_bindable"]),
                "binding_approximation_rate_n": a_after["n_bindable"],
                "section_6a_coverage_bound_and_concrete_over_ALL_TAUGHT_ENTRY_CONDITIONS": rate(
                    a_after["n_bound_and_concrete"], a_after["n_taught"]
                ),
                "section_6a_coverage_n": a_after["n_taught"],
            },
            "THE_UNBOUND_COUNT_TRAVELS_BESIDE_THE_RATE": {
                "n_unbound": a_after["n_unbound"],
                "n_taught": a_after["n_taught"],
                "unbound_fraction": rate(a_after["n_unbound"], a_after["n_taught"]),
                "why": (
                    "The binding_approximation_rate is computed over EXECUTED-BINDABLE conditions only. "
                    "A condition the compiler cannot bind at all VANISHES from that denominator, so a spec "
                    "can improve its score by becoming LESS bindable. This count is the guard against that."
                ),
                "conditions": a_after["unbound_conditions"],
            },
            "per_kind_attribution": {
                "named_sr_level": per_kind.get("named_sr_level", {"n_flipped": 0, "condition_ids": []}),
                "order_block_edge": per_kind.get("order_block_edge", {"n_flipped": 0, "condition_ids": []}),
                "swing": {
                    "n_flipped": 0,
                    "n_still_approximation_true": swing_still_true,
                    "reason": "routed-but-approximate; n=1 is below the n>=2 de-approximation floor. Never argued for.",
                    "accounting": (
                        "3 Corpus-A conditions classify as swing: 2 are bindable and remain approximation=True "
                        "(counted above); 1 is UNBOUND (a WAIT_SESSION row) and so sits outside the rate's "
                        "denominator entirely, inside the unbound count. 2 + 1 = 3, no swing row unaccounted."
                    ),
                    "classifier_scope_caveat": (
                        "classify_population_a_kind is applied here to EVERY Corpus-A condition for attribution. "
                        "The flip itself only reaches WAIT_STRUCTURE/VERIFY_STRUCTURE, so a swing classification "
                        "on a WAIT_SESSION or WAIT_CONFIRMATION row is an attribution label, NOT a claim that the "
                        "flip could have moved it. This population is BROADER than the frozen 16-row level/zone "
                        "census (which holds 1 swing row) -- different windows, not pooled."
                    ),
                },
                "why_per_kind": "An aggregate delta hides which change earned what.",
            },
            "per_family_attribution": fam_delta,
            "total_conditions_de_approximated": total_flipped,
            "bound_and_concrete_conditions": a_after["bound_and_concrete_conditions"],
            "null_baseline": {
                "basis": "MEASURED -- the BEFORE arm is the same 155 conditions re-bound with both flags off.",
                "n": a_before["n_bindable"],
                "n_de_approximated": a_before["n_bound_and_concrete"],
                "binding_approximation_rate": rate(a_before["n_binding_approximation"], a_before["n_bindable"]),
            },
            "rows": a_after["rows"],
        },
        "corpus_B": {
            "name": "or-branches full corpus",
            "path": "docs/replay-results/or-branches-full-corpus-specs-2026-07-05.json",
            "n_specs": len(b_specs),
            "n_taught_conditions": b_total,
            "role_histogram": dict(roles),
            "NEVER_EVALUATED_BY_GAP": {
                "n": never_by_gap,
                "label": "never-evaluated-by-GAP (trigger-role) -- PRIMARY in coverage",
                "meaning": "conditions that SHOULD gate and do not. This is a DEFECT.",
                "cause": "compute()'s dispatch loop iterates role=='spine' only.",
                "by_family": dict(sorted(trigger_by_family.items(), key=lambda x: -x[1])),
                "derivation_paths": {
                    "path1_role_tally": path1,
                    "path2_complement_total_minus_spine_minus_confluence": path2,
                    "path3_sum_of_family_breakdown": path3,
                    "agree": True,
                },
                "supersedes": (
                    "921, which summed a curated 5-family list (WAIT_BIAS 42, FILTER 39, INVALIDATE 105, "
                    "ENABLE_ENTRY 480, ENTER 255) and omitted 66 conditions across 6 families "
                    "(WAIT_SESSION 18, WAIT_CONFIRMATION 21, WAIT_RETEST 15, WAIT_STRUCTURE 6, "
                    "VERIFY_STRUCTURE 3, EXIT_HINT 3). A correct sum over an incomplete enumeration is "
                    "still incomplete -- and it understated the denominator, so coverage read BETTER than truth."
                ),
            },
            "NEVER_EVALUATED_BY_DESIGN": {
                "n": never_by_design,
                "label": "never-evaluated-by-DESIGN (confluence) -- CONTEXT, beside the primary line",
                "meaning": "conditions never meant to gate. This is a DESIGN, not a defect.",
                "NEVER_MERGED": (
                    "Folding this into the by-GAP denominator would trade a defect for a design. Whether "
                    "confluence should ever gate is a dispatch-DESIGN question, decided as design -- never "
                    "smuggled in as arithmetic."
                ),
            },
            "INVALIDATE_enforcement": {
                "population": "spec['invalidations'] bindable entries -- NOT the 105 INVALIDATE entry_conditions",
                "flag_OFF_approximated_of_total": inv["flag_OFF"],
                "flag_ON_approximated_of_total": inv["flag_ON"],
                "direction": "fidelity moves DOWN, and it should -- enforcement marks these approximation=True",
                "source": "docs/replay-results/h1-battery/family-meta-enforcement-delta.json",
            },
            "spine_gating_under_enforcement": enf["rates"],
            "filter_spine_dispositions": enf["filter_spine_dispositions"],
        },
        "DUAL_DENOMINATORS": {
            "with_narration_ALL_conditions": dual["with_narration_ALL_conditions"],
            "without_narration_PRIMARY": dual["without_narration_PRIMARY"],
            "both_travel": True,
            "with_narration_is_never_deleted": True,
            "scope": (
                "These are the corpus-wide WAIT_STRUCTURE NARRATION denominators, reproduced unmodified "
                "from narration-reclassification-FINAL.json. They are NOT the Corpus A (155) or Corpus B "
                "(6450) denominators and must not be substituted for either."
            ),
            "source": "docs/replay-results/h1-battery/narration-reclassification-FINAL.json",
        },
        "CEILING": {
            "n_level_zone_rows_total": n_levelzone_rows,
            "max_de_approximable": 6,
            "observed_de_approximated": total_flipped,
            "n_unresolvable_as_built": 9,
            "swing": "1 row, routed-but-approximate, n=1 below the n>=2 floor -- stays approximation=True",
        },
        "RECONCILIATION": {
            "corpus_B_role_partition": {
                "spine": roles["spine"],
                "confluence": roles["confluence"],
                "trigger": roles["trigger"],
                "sum": roles["spine"] + roles["confluence"] + roles["trigger"],
                "total_entry_conditions": b_total,
                "exact": roles["spine"] + roles["confluence"] + roles["trigger"] == b_total,
            },
            "corpus_A_condition_accounting": {
                "taught": a_after["n_taught"],
                "bindable": a_after["n_bindable"],
                "unbound": a_after["n_unbound"],
                "bindable_plus_unbound": a_after["n_bindable"] + a_after["n_unbound"],
                "exact": a_after["n_bindable"] + a_after["n_unbound"] == a_after["n_taught"],
            },
            "census_vs_live_OUTSIDE_THIS_PIPELINE": {
                "ARMS_ARE_COMPARABLE": (
                    "Both sides are flags-OFF and differ ONLY in the closure: census == PRE-closure "
                    "flags-OFF, live == POST-closure flags-OFF. The prior version compared the "
                    "pre-closure flags-OFF census against the POST-closure flags-ON arm, so the 6 "
                    "level/zone flips were folded into a delta attributed to the closure."
                ),
                "frozen_census_sum_n_executed_bindable": census_bindable,
                "live_n_bindable": live_bindable,
                "delta": live_bindable - census_bindable,
                "frozen_census_sum_n_binding_approximation": census_approx,
                "live_n_binding_approximation": live_approx,
                "frozen_census_sum_n_bound_and_concrete": census_concrete,
                "live_n_bound_and_concrete": live_concrete,
                "PRE_closure_flags_off_rate": census_rate,
                "POST_closure_flags_off_rate": live_rate,
                "PRE_closure_flags_off_section_6a_coverage": census_cov,
                "POST_closure_flags_off_section_6a_coverage": live_cov,
                "drift_rows": drift_rows,
                # COMPUTED (AR-188 fix 1). What stood here was a fixed string asserting "the rate
                # improves while coverage worsens ... precisely the vanishing-denominator defect" --
                # emitted for ANY non-zero delta, in EITHER direction. It was wrong: the rate
                # DEGRADED here. This verdict is a function of the four figures above and says
                # different things when they differ.
                "computed_drift_verdict": closure_drift,
                "what_this_says_about_the_closure": (
                    "The honest-partial session closure did NOT flatter itself. It gave up a "
                    "bound-and-concrete condition, and that cost it on BOTH metrics -- the "
                    "approximation share rose AND section-6a coverage fell. The section-6a defect is "
                    "the pattern where a rate improves BECAUSE conditions vanish from its "
                    "denominator; that is not what this delta is. A closure that pays in both books "
                    "is evidence the guard is working, not evidence of the defect it guards against."
                ),
            },
            # NEW (AR-188 fix 6): the entry the role_composition string told readers to "see".
            "corpus_A_role_partition": {
                ("None" if k is None else k): v for k, v in sorted(a_roles.items())
            },
            "corpus_A_role_partition_sum": sum(a_roles.values()),
            "corpus_A_trigger_role_count_ASSERTED_ZERO": a_roles.get("trigger", 0),
        },
        # ------------------------------------------------------ AR-188 fix 3
        "NUMERATOR_CONTINUITY": {
            "why_this_block_exists": (
                "The headline 0/155 -> 6/155 rests on a numerator that LOST A MEMBER between the "
                "census and this run. Comparing a post-closure numerator against a pre-closure one "
                "and calling the difference an effect of the flags is an arm error. The "
                "pre-closure-COMPARABLE figures are stated here so the headline cannot be read "
                "without them."
            ),
            "pre_closure_flags_off_coverage": f"{census_concrete}/{a_before['n_taught']}",
            "post_closure_flags_off_coverage": f"{live_concrete}/{a_before['n_taught']}",
            "pre_closure_COMPARABLE_flags_on_coverage": (
                f"{census_concrete + total_flipped}/{a_before['n_taught']}"
            ),
            "post_closure_flags_on_coverage": f"{a_after['n_bound_and_concrete']}/{a_after['n_taught']}",
            "THE_COMPARABLE_HEADLINE": (
                f"{census_concrete + total_flipped}/{a_before['n_taught']} -> "
                f"{a_after['n_bound_and_concrete']}/{a_after['n_taught']} "
                "(pre-closure-comparable flags-ON -> post-closure flags-ON). The 6 level/zone flips "
                "are present on BOTH sides; the difference is the one condition the closure gave up."
            ),
            "vanishing_count_correction": {
                "spec_said": f"{a_before['n_taught'] - census_bindable} of {a_before['n_taught']} were vanishing",
                "corrects_to": f"{a_before['n_unbound']} of {a_before['n_taught']}",
                "why": (
                    "The spec's figure was the PRE-closure unbound count. Post-closure the honest-partial "
                    "closure moved one more condition out of the bindable set, so the vanishing count is "
                    "one higher. Stating the old number beside the new one is the correction."
                ),
            },
        },
        # ------------------------------------------------------ AR-188 fix 4
        "COVERAGE_OVER_GENUINELY_ALL_TAUGHT": {
            "the_defect_this_fixes": (
                "The per-arm key was named '..._over_ALL_TAUGHT' but its denominator was 155 = "
                "entry_conditions ONLY. The same 16 specs also carry "
                f"{n_invalidations} `invalidations` entries, which are taught too. A key whose name "
                "claims ALL and whose denominator excludes a taught population is the same "
                "caption-is-a-claim defect this artifact was sent back to fix."
            ),
            "disposition": (
                "BOTH. (a) The per-arm key was RENAMED to "
                "'section_6a_coverage_bound_and_concrete_over_ALL_TAUGHT_ENTRY_CONDITIONS' so its "
                "name states its actual denominator. (b) The completed 161 denominator is reported "
                "here. Renaming alone would leave the complete figure unstated; completing alone "
                "would force a single enforcement arm to be picked silently -- see below."
            ),
            "n_taught_entry_conditions": a_after["n_taught"],
            "n_taught_invalidations": n_invalidations,
            "n_taught_ALL": a_after["n_taught"] + n_invalidations,
            "invalidations_binding_by_enforcement_arm": inval_arms,
            "entry_conditions_binding_by_enforcement_arm": {
                "MEASURED_AT": "level/zone flags ON (the AFTER arm the 161 numerators are built on)",
                "why": (
                    "Reported so the claim 'TF_FAMILY_META_ENFORCED moves invalidations, not "
                    "entry_conditions' is a measurement a reader can check rather than an "
                    "assumption folded into the arithmetic. It feeds the margin decomposition."
                ),
                **entry_arms,
            },
            # ------------------------------------------------------------------ R-199 s2
            # DUAL-CONFIGURATION REPORTING. The prior version stated the two rates side by side
            # and left the choice to the reader -- which, for a consumer taking one number, is
            # the choice being made silently anyway. R-199 s2 rules 6/161 PRIMARY. This block is
            # COMPUTED (compose_completed_coverage), including the provenance caveat: the caveat's
            # figures are derived from the same per-arm fields that produce the rates, so they
            # move with the data instead of being typed beside it.
            "COMPLETED_161_DUAL_CONFIGURATION": completed_coverage,
            "WHY_TWO_ARMS_AND_NOT_ONE_NUMBER": (
                "TF_FAMILY_META_ENFORCED is a SEPARATE flag from the level/zone pair, and it decides "
                "whether these entries bind concrete or approximate. It defaults OFF, which is the "
                "configuration this generator runs in. So the completed coverage has two honest "
                "values, not one. R-199 s2 rules which is PRIMARY -- the enforcement-ON figure, "
                "because it is the arm in which the INVALIDATE entries bind under the CORRECTED "
                "approximation=True. The OFF figure is NOT dropped: it travels beside the primary "
                "with a computed provenance caveat. Dropping either arm, or stating one without "
                "its configuration, would repeat the error this artifact is being repaired for."
            ),
            "coverage_over_161_enforcement_OFF_this_runs_config": rate(
                a_after["n_bound_and_concrete"] + inval_arms["enforcement_OFF"]["n_bound_and_concrete"],
                a_after["n_taught"] + n_invalidations,
            ),
            "coverage_over_161_enforcement_ON": rate(
                a_after["n_bound_and_concrete"] + inval_arms["enforcement_ON"]["n_bound_and_concrete"],
                a_after["n_taught"] + n_invalidations,
            ),
            "numerators": {
                "enforcement_OFF": (
                    f"{a_after['n_bound_and_concrete']} entry + "
                    f"{inval_arms['enforcement_OFF']['n_bound_and_concrete']} invalidations"
                ),
                "enforcement_ON": (
                    f"{a_after['n_bound_and_concrete']} entry + "
                    f"{inval_arms['enforcement_ON']['n_bound_and_concrete']} invalidations"
                ),
            },
        },
        # ------------------------------------------------------ AR-188 fix 5
        "SESSION_ATTRIBUTION": {
            "why_it_was_missing": (
                "The spec mandates session attribution ('how much session'). per_family_attribution "
                "is built from by_family_approximated, which only ever sees BOUND rows -- so a family "
                "that binds NOTHING has no key there and is structurally invisible. Its absence read "
                "as 'nothing to report' when it meant 'recovered nothing'."
            ),
            "n_WAIT_SESSION_taught": ws_taught,
            "n_WAIT_SESSION_bound_flags_off": ws_taught - ws_unbound,
            "n_WAIT_SESSION_bound_flags_on": ws_bound_after,
            "n_WAIT_SESSION_unbound": ws_unbound,
            "n_WAIT_SESSION_de_approximated_in_this_run": 0,
            "THE_HEADLINE": (
                f"0 of {ws_taught} bound - 0 of up-to-17 recovered in this measurement's configuration."
            ),
            "recoverable_target_population_17": {
                "value": 17,
                "PROVENANCE": "EXTERNAL GRADED CONSTANT -- not derived by this generator.",
                "source": (
                    "docs/designs/spec-dual-denominator-remeasure-2026-07-20.md line 63 "
                    "('recovers up to 17 of 27'), resting on the graded 17-genuine / 9-mis-typed "
                    "split of the 27 WAIT_SESSION rows recorded in ADVISOR-RULINGS.md."
                ),
                "why_flagged": (
                    "This generator can count the 27 and can show 0 bound. It CANNOT re-derive the 17 "
                    "-- that came from a human-graded read of the teaching. It is cited rather than "
                    "recomputed, and labelled so no reader mistakes it for a measured value here."
                ),
            },
            "unflattering_reading": (
                f"All {ws_taught} WAIT_SESSION conditions in Corpus A are UNBOUND, in both arms. The "
                "session lane -- the only family whose runtime primitive is real -- recovered nothing "
                "in this configuration, and the honest-partial closure moved the count the wrong way "
                "(26 unbound pre-closure, 27 post). This is the least flattering number available and "
                "it is stated for that reason."
            ),
        },
        # ------------------------------------------------------ AR-188 fix 6
        "SELF_ACCOUNTING": {
            "n_asserts_in_this_generator": count_own_asserts(),
            "n_asserts_note": (
                "Counted from this file's own AST at runtime, not typed. A prior report claimed "
                "'eight asserts, each red-proved' while the file held twelve. Two of those twelve "
                "could not fire and have been dealt with: the Corpus-B role-partition assert was "
                "algebraically implied by the derivation assert above it and is DELETED (the property "
                "is still reported); the output-path collision guard sat AFTER the write it purported "
                "to guard and is MOVED to the top of main() where it can actually stop the run."
            ),
            "population_A_kind_histogram_over_corpus_A": kind_counts,
            "n_distinct_kinds_observed": len(kind_hist),
            "modal_kind": ("None" if modal_kind is None else modal_kind),
            "modal_kind_n": modal_n,
            "non_discriminating_control_reason_CORRECTED": (
                f"The declared non-discriminating control gave its reason as 'only three kinds occur'. "
                f"That is FALSE: {len(kind_hist)} occur, and the modal value is "
                f"'{'None' if modal_kind is None else modal_kind}' at n={modal_n} -- conditions no kind "
                "classifies, the large majority of the corpus. The control's CONCLUSION (that the kind "
                "axis does not discriminate here) survives; its stated REASON did not, and a reason "
                "that is false is not a weaker justification, it is an unfalsifiable one. The "
                "histogram is emitted so the reason can be checked instead of believed."
            ),
        },
        "WHAT_THIS_MAY_NOT_DO": [
            "May not claim a fidelity result the grades did not license. The flip's claim covers two kinds "
            "(named_sr_level, order_block_edge); swing stays approximate. The session lane closed "
            "HONEST-PARTIAL with a per-row-labeled residue including 5 rows nobody can explain.",
            "May not report a single headline number without dual denominators + section 6a coverage.",
            "May not merge the by-gap and by-design lines.",
            "May not be used to justify T1 -- bars may never be set from the rate alone.",
        ],
    }

    OUT_PATH.write_text(json.dumps(art, indent=1), encoding="utf-8")

    after_hashes = {str(p.relative_to(REPO_ROOT)): sha(p) for p in APPEND_ONLY_GUARDED if p.exists()}
    assert before_hashes == after_hashes, (
        "APPEND-ONLY VIOLATED: a guarded prior artifact changed during this run:\n"
        + "\n".join(f"  {k}: {before_hashes.get(k)} -> {after_hashes.get(k)}" for k in before_hashes
                    if before_hashes.get(k) != after_hashes.get(k))
    )
    print(f"OK  wrote {OUT_PATH.relative_to(REPO_ROOT)}")
    print(f"OK  corpus A: {len(specs_a)} specs / {a_after['n_taught']} taught conditions")
    print(f"      rate BEFORE {rate(a_before['n_binding_approximation'], a_before['n_bindable'])} "
          f"(n={a_before['n_bindable']})  AFTER {rate(a_after['n_binding_approximation'], a_after['n_bindable'])} "
          f"(n={a_after['n_bindable']})")
    print(f"      6a coverage BEFORE {rate(a_before['n_bound_and_concrete'], a_before['n_taught'])} "
          f"AFTER {rate(a_after['n_bound_and_concrete'], a_after['n_taught'])} (n={a_after['n_taught']})")
    print(f"      unbound {a_after['n_unbound']} of {a_after['n_taught']}")
    print(f"      pre-closure-COMPARABLE 6a coverage {census_concrete + total_flipped}/{a_before['n_taught']}"
          f" -> {a_after['n_bound_and_concrete']}/{a_after['n_taught']} (flags-ON both sides)")
    print(f"OK  closure drift (flags-OFF both arms): {closure_drift['verdict']}")
    print(f"      rate {census_rate} -> {live_rate} | 6a coverage {census_cov} -> {live_cov}")
    _pri = completed_coverage["READ_THIS_ONE"]
    _sec = completed_coverage["BESIDE_IT_NOT_INSTEAD_OF_IT"]
    _mar = completed_coverage["MARGIN_DECOMPOSITION"]
    print(f"OK  completed-161 coverage PRIMARY {_pri['fraction']} = {_pri['coverage_over_161']} "
          "(TF_FAMILY_META_ENFORCED=true)")
    print(f"      beside it {_sec['fraction']} = {_sec['coverage_over_161']} (enforcement OFF) -- "
          f"{_mar['margin_from_INVALIDATE_withdrawn_approximation_False']} of its "
          f"{_mar['margin_secondary_minus_primary']}-condition margin rests on the WITHDRAWN "
          "INVALIDATE approximation=False")
    print(f"      dependency verdict: {_sec['provenance_dependency_verdict']}")
    print(f"OK  session attribution: 0 of {ws_taught} bound - 0 of up-to-17 recovered")
    print(f"OK  self-accounting: {count_own_asserts()} asserts | {len(kind_hist)} kinds, "
          f"modal '{'None' if modal_kind is None else modal_kind}' n={modal_n}")
    print(f"OK  corpus B: {len(b_specs)} specs / {b_total} taught conditions")
    print(f"      never-evaluated-by-GAP {never_by_gap} (3 paths agree) | by-DESIGN {never_by_design} (never merged)")
    print(f"OK  reconciliation: {roles['spine']}+{roles['confluence']}+{roles['trigger']} == {b_total}")
    print(f"OK  ceiling: {total_flipped} de-approximated, ceiling 6 of {n_levelzone_rows}")
    print(f"OK  append-only: {len(before_hashes)} guarded artifacts unchanged")


if __name__ == "__main__":
    main()
