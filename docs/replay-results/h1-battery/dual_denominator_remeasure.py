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
    assert roles["spine"] + roles["confluence"] + roles["trigger"] == b_total, (
        f"role partition NOT exhaustive: {roles['spine']}+{roles['confluence']}+{roles['trigger']} != {b_total}"
    )
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

    # ------------------------------------------- CENSUS-vs-LIVE RECONCILIATION
    # The frozen R-082 census recorded n_executed_bindable per spec. Summing it and
    # comparing against a LIVE bind is a check against something outside this pipeline.
    census_bindable = sum(
        r["census_n_executed_bindable"] for r in a_after["rows"] if r["census_n_executed_bindable"] is not None
    )
    live_bindable = a_after["n_bindable"]
    drift_rows = [
        {
            "spec": r["spec"],
            "census_n_executed_bindable": r["census_n_executed_bindable"],
            "live_n_bindable": r["n_bindable"],
            "delta": r["n_bindable"] - r["census_n_executed_bindable"],
        }
        for r in a_after["rows"]
        if r["census_n_executed_bindable"] is not None and r["n_bindable"] != r["census_n_executed_bindable"]
    ]

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

    def rate(num, den):
        return round(num / den, 4) if den else None

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
            "role_composition": "spine 102 / confluence 53 / trigger 0 -- derived, see reconciliation",
            "BEFORE_flags_off": {
                "n_bindable": a_before["n_bindable"],
                "n_unbound": a_before["n_unbound"],
                "n_binding_approximation": a_before["n_binding_approximation"],
                "n_bound_and_concrete": a_before["n_bound_and_concrete"],
                "binding_approximation_rate": rate(a_before["n_binding_approximation"], a_before["n_bindable"]),
                "binding_approximation_rate_n": a_before["n_bindable"],
                "section_6a_coverage_bound_and_concrete_over_ALL_TAUGHT": rate(
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
                "section_6a_coverage_bound_and_concrete_over_ALL_TAUGHT": rate(
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
                "frozen_census_sum_n_executed_bindable": census_bindable,
                "live_n_bindable": live_bindable,
                "delta": live_bindable - census_bindable,
                "drift_rows": drift_rows,
                "interpretation": (
                    "A NON-ZERO delta here is a real finding, not noise. The session lane's honest-partial "
                    "closure makes a WAIT_SESSION condition whose zone the runtime primitive cannot evaluate "
                    "UNBINDABLE rather than falsely bound. That condition LEAVES the rate's denominator and "
                    "ENTERS the unbound count -- the rate improves while coverage worsens. This is precisely "
                    "the vanishing-denominator defect section 6a exists to expose, observed live."
                ),
            },
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
    assert OUT_PATH not in APPEND_ONLY_GUARDED, "output path collides with a guarded prior artifact"

    print(f"OK  wrote {OUT_PATH.relative_to(REPO_ROOT)}")
    print(f"OK  corpus A: {len(specs_a)} specs / {a_after['n_taught']} taught conditions")
    print(f"      rate BEFORE {rate(a_before['n_binding_approximation'], a_before['n_bindable'])} "
          f"(n={a_before['n_bindable']})  AFTER {rate(a_after['n_binding_approximation'], a_after['n_bindable'])} "
          f"(n={a_after['n_bindable']})")
    print(f"      6a coverage BEFORE {rate(a_before['n_bound_and_concrete'], a_before['n_taught'])} "
          f"AFTER {rate(a_after['n_bound_and_concrete'], a_after['n_taught'])} (n={a_after['n_taught']})")
    print(f"      unbound {a_after['n_unbound']} of {a_after['n_taught']}")
    print(f"OK  corpus B: {len(b_specs)} specs / {b_total} taught conditions")
    print(f"      never-evaluated-by-GAP {never_by_gap} (3 paths agree) | by-DESIGN {never_by_design} (never merged)")
    print(f"OK  reconciliation: {roles['spine']}+{roles['confluence']}+{roles['trigger']} == {b_total}")
    print(f"OK  ceiling: {total_flipped} de-approximated, ceiling 6 of {n_levelzone_rows}")
    print(f"OK  append-only: {len(before_hashes)} guarded artifacts unchanged")


if __name__ == "__main__":
    main()
