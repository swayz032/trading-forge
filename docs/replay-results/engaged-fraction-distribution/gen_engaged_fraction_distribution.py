#!/usr/bin/env python3
"""
gen_engaged_fraction_distribution.py

READ-ONLY aggregator for the T1 ENGAGED-FRACTION DISTRIBUTION ARTIFACT (R-252 s2 order,
R-253 s1 sharpening). It does NOT run the engine, does NOT run backtests, sets NO flag:
it reads existing on-disk evidence and assembles the distribution the T1 engagement bar
would run a percentile on -- or, where that grain does not exist, records the ABSENCE
with what does exist (never a substitute grain silently).

The distinction this artifact defends (R-040 pin-2(iii)):
  ENGAGED FRACTION  = across a verdict window, the fraction of BARS/TIME where a
                      condition's binding was REAL (an active, discriminating proxy
                      actually engaged), NOT a `approximation=True` np.ones pass-through.
                      A pass-through is NOT engagement.
  This is DISTINCT from the COMPILE-TIME binding-approximation rate (does a condition
  bind to a concrete primitive or degrade to approximation=True). Reporting the second
  AS the first would be the exact substitute-grain fabrication this artifact exists to
  avoid. Section B below carries the compile-time census clearly labelled as a DIFFERENT
  quantity, never as the engaged fraction.

Run:  python docs/replay-results/engaged-fraction-distribution/gen_engaged_fraction_distribution.py
Emits: engaged-fraction-distribution.json  (beside this script)

No environment state (CRLF counts, mtimes, PIDs) is embedded -- the artifact must not be
regime-scoped. Provenance pointers are (file, json_key_path); line numbers are omitted on
purpose because the source JSONs may be checked out CRLF and line pins shift for free.
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
BATTERY = os.path.normpath(os.path.join(HERE, "..", "h1-battery"))


def load(name):
    with open(os.path.join(BATTERY, name), "r", encoding="utf-8") as fh:
        return json.load(fh)


def main():
    wire1 = load("wire1-dod-remeasure.json")
    floor = load("wire1-dod-HONEST-FLOOR.json")
    dual = load("dual-denominator-remeasure-2026-07-21.json")
    fmed = load("family-meta-enforcement-delta.json")
    shake = load("shakedown-wave1-verdict.json")
    wave1r = load("wave-1R-verdict.json")

    # ---- SECTION A: the ACTUAL engaged-fraction grain (bar-level, per binding family) ----
    # The ONLY bar-level engaged fractions on disk. Per-COLUMN (per binding family), NOT
    # per-spec: the per-spec rows in wire1-dod-remeasure repeat the SAME corpus constant,
    # so there is no per-spec engaged-fraction variation to form a distribution.
    struct_ef = wire1["corpus_engaged_fraction_PER_COLUMN"]["structure"]  # 0.9999
    bias_ef = wire1["corpus_engaged_fraction_PER_COLUMN"]["bias"]          # 0.4898
    bias_ef_floor = floor["rows"][0]["bias_engaged_fraction"]              # 0.4898 (surviving)

    section_a_cells = [
        {
            "family": "structure",
            "engaged_fraction": struct_ef,
            "status": "WITHDRAWN_AS_ENGAGEMENT",
            "why_withdrawn": (
                "R-079: compute_structure_state's htf_bars argument moves none of the "
                "nine fields the structure column reads (verified by diffing two wholly "
                "different HTF frames). The structure premise is INERT, so the structure "
                "bindings REVERT to approximation=True. Under R-040 pin-2(iii) an "
                "approximation=True pass-through is NOT engagement -- so 0.9999 does not "
                "count as a REAL engaged fraction."
            ),
            "denominator": {
                "n_specs": wire1["n_specs"],
                "window": wire1["window"],
                "symbol": wire1["symbol"],
                "note": "bar-level fraction over the window; corpus constant, not per-spec",
            },
            "provenance": [
                "wire1-dod-remeasure.json :: corpus_engaged_fraction_PER_COLUMN.structure (== 0.9999)",
                "wire1-dod-remeasure.json :: WITHDRAWN_AS_FIDELITY_CLAIM (R-079)",
                "wire1-dod-HONEST-FLOOR.json :: rows[*].wired_structure_bindings_REVERTED",
            ],
        },
        {
            "family": "bias",
            "engaged_fraction": bias_ef,
            "status": "SURVIVING_ENGAGEMENT",
            "caveats": [
                "Depressed by warmup: CARRY (R-071 s3) -- 200-bar bias warmup consumes the "
                "window front, so 0.4898 is a floor, not the steady-state engaged fraction.",
                "RECEIPTS not returns: 16 tier-b near-ghost specs, no edge claim attaches.",
                "Single window, single symbol (MES 5m 2022-01-01..2023-06-30), single wire.",
            ],
            "denominator": {
                "n_specs": wire1["n_specs"],
                "window": wire1["window"],
                "symbol": wire1["symbol"],
                "note": "bar-level fraction over the window; corpus constant, not per-spec",
            },
            "provenance": [
                "wire1-dod-remeasure.json :: corpus_engaged_fraction_PER_COLUMN.bias (== 0.4898)",
                "wire1-dod-HONEST-FLOOR.json :: rows[0].bias_engaged_fraction (== 0.4898)",
                "wire1-dod-HONEST-FLOOR.json :: corpus_rate_AFTER_FLOOR_weighted_bias_only (== 0.9793)",
            ],
        },
    ]

    genuine = [c for c in section_a_cells if c["status"] == "SURVIVING_ENGAGEMENT"]
    n_genuine_family_cells = len(genuine)                 # 1 (bias only)
    n_family_cells_incl_withdrawn = len(section_a_cells)  # 2
    n_per_spec_genuine_cells = 0                           # per-spec rows carry corpus constant

    consistency = {
        "bias_engaged_fraction_two_paths_agree": (bias_ef == bias_ef_floor),
        "path1_wire1_corpus_PER_COLUMN_bias": bias_ef,
        "path2_honest_floor_row_bias": bias_ef_floor,
    }

    # ---- SECTION B: ADJACENT compile-time binding-approximation (DIFFERENT QUANTITY) ----
    # REAL = bound_and_concrete ; FALLBACK = approximation=True. This DOES exist per-spec
    # AND per-family, but it is a COMPILE-TIME binding property, NOT the bar-level engaged
    # fraction of Section A. It is reported here ONLY as "what does exist at that grain",
    # explicitly NOT as the engaged fraction.
    ca = dual["corpus_A"]
    ca_before = ca["BEFORE_flags_off"]      # production default (both level/zone flags OFF)
    ca_after = ca["AFTER_flags_on_HYPOTHETICAL"]
    ca_perfam = ca["per_family_attribution"]

    corpus_a = {
        "name": ca["name"],
        "n_specs": ca["n_specs"],
        "n_taught_conditions": ca["n_taught_conditions"],
        "n_bindable": ca_before["n_bindable"],
        "n_unbound_outside_denominator": dual["corpus_A"]["THE_UNBOUND_COUNT_TRAVELS_BESIDE_THE_RATE"]["n_unbound"],
        "production_default_flags": "OFF (both TF_LEVELZONE_ROUTING_ENABLED and _RESOLVER_ENABLED default false)",
        "PRODUCTION_binding_approximation_rate_flags_OFF": ca_before["binding_approximation_rate"],  # 1.0
        "PRODUCTION_real_bound_and_concrete": ca_before["n_bound_and_concrete"],                    # 0
        "PRODUCTION_real_fraction": round(ca_before["n_bound_and_concrete"] / ca_before["n_bindable"], 4),  # 0.0
        "HYPOTHETICAL_flags_ON_binding_approximation_rate": ca_after["binding_approximation_rate"],  # 0.9531
        "HYPOTHETICAL_flags_ON_real_bound_and_concrete": ca_after["n_bound_and_concrete"],           # 6
        "per_family_approximated_FALLBACK": {
            fam: {
                "approximated_flags_OFF_production": v["approximated_BEFORE"],
                "approximated_flags_ON_hypothetical": v["approximated_AFTER"],
                "de_approximated_delta_hypothetical": v["delta"],
            }
            for fam, v in ca_perfam.items()
        },
        "per_family_reconciliation": {
            "sum_approximated_flags_OFF": sum(v["approximated_BEFORE"] for v in ca_perfam.values()),
            "equals_n_bindable": ca_before["n_bindable"],
        },
        "per_spec_rows": [
            {
                "spec": r["spec"],
                "n_bindable": r["n_bindable"],
                "binding_approximation_rate_flags_ON_arm": r["binding_approximation_rate"],
                "n_bound_and_concrete_flags_ON_arm": r["n_bound_and_concrete"],
            }
            for r in ca["rows"]
        ],
        "provenance": [
            "dual-denominator-remeasure-2026-07-21.json :: corpus_A.BEFORE_flags_off / AFTER_flags_on_HYPOTHETICAL",
            "dual-denominator-remeasure-2026-07-21.json :: corpus_A.per_family_attribution",
            "dual-denominator-remeasure-2026-07-21.json :: corpus_A.rows[*]",
        ],
    }

    cb = dual["corpus_B"]
    corpus_b = {
        "name": cb["name"],
        "n_specs": cb["n_specs"],
        "n_taught_conditions": cb["n_taught_conditions"],
        "role_histogram": cb["role_histogram"],
        "never_evaluated_by_GAP_trigger_role_total": cb["NEVER_EVALUATED_BY_GAP"]["n"],
        "never_evaluated_by_GAP_by_family": cb["NEVER_EVALUATED_BY_GAP"]["by_family"],
        "filter_spine_constant_true_passthrough": cb["filter_spine_dispositions"]["honestly_declared_non_gating_constant_true"],  # 390
        "spine_gating_flags_OFF": cb["spine_gating_under_enforcement"]["flag_OFF"]["spine_gating"],  # 2265
        "spine_gating_flags_ON": cb["spine_gating_under_enforcement"]["flag_ON"]["spine_gating"],    # 1875
        "spine_bound_but_never_executed": cb["spine_gating_under_enforcement"]["flag_OFF"]["spine_bound_but_never_executed"],  # 78
        "invalidate_enforcement_flags_OFF_approx_of_total": cb["INVALIDATE_enforcement"]["flag_OFF_approximated_of_total"],  # [0,567]
        "invalidate_enforcement_flags_ON_approx_of_total": cb["INVALIDATE_enforcement"]["flag_ON_approximated_of_total"],    # [567,567]
        "provenance": [
            "dual-denominator-remeasure-2026-07-21.json :: corpus_B.*",
            "family-meta-enforcement-delta.json :: filter_spine_390 (n == 390), invalidation_approximation_counts, spine gating",
        ],
    }

    # ---- SECTION C: the capstone / verdict-window evidence carries ZERO engagement fields ----
    section_c = {
        "shakedown_wave1_verdict": {
            "n_trials": shake["validity"]["n_trials"],
            "outcomes": shake["validity"]["outcomes"],
            "bar_source": shake["validity"]["engagement_sweep"]["bar_source"],
            "carries_engaged_fraction_field": False,
            "scope_line": shake["validity"]["scope_line"],
            "provenance": "shakedown-wave1-verdict.json :: validity",
        },
        "wave_1R_verdict": {
            "verdict": wave1r["verdict"],
            "n_trials_total": wave1r["validity"]["n_trials_total"],
            "outcomes": wave1r["validity"]["outcomes"],
            "scope": wave1r["validity"]["scope"],
            "carries_engaged_fraction_field": False,
            "note": wave1r["note"],
            "provenance": "wave-1R-verdict.json :: validity",
        },
        "reading": (
            "The shakedown and wave-1R VERDICT-WINDOW validity blocks -- the real-data "
            "capstone the engagement bar would ideally rest on -- carry ZERO engaged-fraction "
            "fields. wave-1R is the only REAL-DATA (S3 2016-2024 CPCV, 48 trials) verdict "
            "window and it records judge-witnessing, not engagement. The only engaged "
            "fractions on disk (Section A) come from the narrow MES-5m single-window tier-b "
            "SPIKE, not from this capstone."
        ),
    }

    # ---- distribution shape + percentile well-definedness ----
    distribution_shape = {
        "engaged_fraction_grain_achieved": "per-binding-family, single-wire (WIRE-1), corpus-level constant",
        "n_genuine_family_cells_after_R079_withdrawal_and_R040_pin2iii": n_genuine_family_cells,  # 1
        "n_family_cells_including_withdrawn_structure": n_family_cells_incl_withdrawn,            # 2
        "n_genuine_per_spec_cells": n_per_spec_genuine_cells,                                     # 0
        "genuine_values": [c["engaged_fraction"] for c in genuine],                              # [0.4898]
        "percentile_well_defined": False,
        "why_percentile_ill_defined": (
            "A 'named percentile of the MEASURED engaged-fraction distribution' needs a "
            "DISTRIBUTION -- many points. After the R-079 structure withdrawal and R-040 "
            "pin-2(iii) (a pass-through is not engagement), N = 1 genuine family-cell (bias "
            "= 0.4898). N = 2 if the withdrawn structure column is counted. A percentile "
            "over 1-2 points is degenerate: every percentile collapses onto the single "
            "value, so a 'named percentile' selects nothing the mean would not. There is no "
            "per-spec engaged-fraction spread at all (per-spec rows carry the corpus "
            "constant). The distribution required for the bar's pre-registered form DOES NOT "
            "EXIST at any grain finer than this single point."
        ),
        "two_path_consistency": consistency,
    }

    absences = {
        "per_load_bearing_family_bar_level_engaged_fraction_across_the_corpus": "ABSENT",
        "per_spec_bar_level_engaged_fraction": "ABSENT -- per-spec rows in wire1-dod-remeasure repeat the corpus PER_COLUMN constant; no per-spec measurement exists",
        "bar_level_engaged_fraction_on_the_wave_1R_real_data_verdict_window_2016_2024": "ABSENT -- wave-1R-verdict.json carries zero engagement fields",
        "engaged_fraction_for_any_family_other_than_structure_or_bias": "ABSENT -- only two columns (structure, bias) were ever wired; only WIRE-1 (structure) was spiked, and it is withdrawn as inert",
        "structure_family_engaged_fraction_as_a_REAL_number": "ABSENT/WITHDRAWN -- 0.9999 reverts to approximation=True (fallback) under R-079 + R-040 pin-2(iii)",
        "note_on_section_B": (
            "Section B (per-spec AND per-family binding-approximation) is NOT this absent "
            "quantity. It is a COMPILE-TIME binding census (concrete vs approximation=True), "
            "a DIFFERENT measurement than the bar-level engaged fraction. It is reported so "
            "the reader sees what does exist at per-family grain, and is explicitly NOT a "
            "substitute for the engaged-fraction distribution."
        ),
    }

    artifact = {
        "artifact": "engaged-fraction-distribution",
        "generator": "docs/replay-results/engaged-fraction-distribution/gen_engaged_fraction_distribution.py",
        "reproduce": "python docs/replay-results/engaged-fraction-distribution/gen_engaged_fraction_distribution.py",
        "produced_for": "T1 Part 2 engagement-bar derivation (R-252 s2 order; R-253 s1 sharpening)",
        "read_only": True,
        "engine_run": False,
        "flags_set": "NONE (read-only aggregation; production flags OFF)",
        "engine_sha_of_sources": wave1r["validity"]["engine_sha"],
        "HEADLINE": (
            "The bar-level ENGAGED-FRACTION DISTRIBUTION the T1 engagement bar's pre-registered "
            "form requires DOES NOT EXIST at per-spec or per-load-bearing-family grain. The only "
            "bar-level engagement evidence on disk is a single-wire (WIRE-1) spike carrying a "
            "PER-COLUMN corpus constant for two families {structure, bias}; the structure column "
            "is WITHDRAWN as inert (R-079) and is a pass-through, not engagement (R-040 pin-2(iii)); "
            "the surviving genuine cell is bias = 0.4898 (N=1). A named percentile is ILL-DEFINED "
            "on N=1. This is an HONEST-ABSENCE report (R-252 s2 branch), a COMPLETE answer."
        ),
        "the_pre_registered_form_being_serviced": (
            "'a named percentile of the MEASURED engaged-fraction distribution, with an absolute floor'"
        ),
        "definition_used": (
            "ENGAGED FRACTION = across a verdict window, the fraction of bars/time where a "
            "condition's binding was REAL (an active, discriminating proxy engaged) vs FALLBACK "
            "(approximation=True degrading to an np.ones pass-through). R-040 pin-2(iii): a "
            "pass-through is NOT engagement."
        ),
        "SECTION_A_engaged_fraction_bar_level_THE_ACTUAL_GRAIN": {
            "grain": "per-binding-family (per-column), single-wire, corpus constant",
            "source_spike": "wire1-dod-remeasure.json (+ wire1-dod-HONEST-FLOOR.json), producer run_dod_remeasure.py",
            "cells": section_a_cells,
        },
        "SECTION_B_compile_time_binding_approximation_ADJACENT_DIFFERENT_QUANTITY": {
            "WARNING": (
                "This is NOT the engaged fraction. It is a compile-time binding census "
                "(bound_and_concrete=REAL vs approximation=True=FALLBACK). It exists per-spec "
                "AND per-family; it is reported as 'what does exist at that grain', never as a "
                "substitute for Section A."
            ),
            "corpus_A_shakedown_tier_b_DoD": corpus_a,
            "corpus_B_or_branches_full": corpus_b,
        },
        "SECTION_C_capstone_verdict_windows_carry_zero_engagement": section_c,
        "DISTRIBUTION_SHAPE": distribution_shape,
        "ABSENCES": absences,
        "SCOPE_LINE": (
            "Corpus: 16 tier-b DoD near-ghost specs (Section A + Corpus A) / 120 or-branches "
            "specs (Corpus B). Engine SHA 404a33963728e58c6dd12bf7d0d0c894ae6818b0. "
            "Section A engaged fractions: MES 5m, one window 2022-01-01..2023-06-30, wire flag "
            "ON, RECEIPTS not returns. Section B/C: production flags OFF. No edge claim attaches "
            "to any figure. Nothing live. The 77 sealed corpus untouched."
        ),
        "SOURCES": [
            "docs/replay-results/h1-battery/wire1-dod-remeasure.json",
            "docs/replay-results/h1-battery/wire1-dod-HONEST-FLOOR.json",
            "docs/replay-results/h1-battery/dual-denominator-remeasure-2026-07-21.json",
            "docs/replay-results/h1-battery/family-meta-enforcement-delta.json",
            "docs/replay-results/h1-battery/shakedown-wave1-verdict.json",
            "docs/replay-results/h1-battery/wave-1R-verdict.json",
        ],
        "PROVENANCE_NOTE": (
            "Pointers are (file :: json_key_path). Line numbers are omitted deliberately: the "
            "source JSONs may be checked out CRLF and a line pin would differ across line-ending "
            "regimes for free (DISPATCH-KNOWN-TRAPS 2d). Key-paths are regime-invariant."
        ),
    }

    out_path = os.path.join(HERE, "engaged-fraction-distribution.json")
    with open(out_path, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(artifact, fh, indent=1, ensure_ascii=True, sort_keys=False)
        fh.write("\n")
    print("wrote", out_path)
    print("n_genuine_family_cells:", n_genuine_family_cells)
    print("genuine_values:", [c["engaged_fraction"] for c in genuine])
    print("percentile_well_defined:", distribution_shape["percentile_well_defined"])


if __name__ == "__main__":
    main()
