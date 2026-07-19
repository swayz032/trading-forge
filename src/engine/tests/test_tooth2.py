"""Tooth-2 per-spec coverage regression (commissioning-grade F-1).

The WAVE-1R commissioning grade mutation-caught a detector-can-lie: the runner
judged each spec's coverage against WAVE-GLOBAL witnessed/gated sets, so a judge
firing (or gating) on ONE spec silently excused its absence on ANOTHER. Inert on
a uniform wave, but a false clean the first time a wave has real per-spec gating
heterogeneity. These lock the per-spec rule. Pure stdlib.
"""
from __future__ import annotations

import importlib.util
import os
import sys

_T = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "battery", "tooth2.py"))
_spec = importlib.util.spec_from_file_location("_r_tooth2", _T)
tooth2 = importlib.util.module_from_spec(_spec)
sys.modules[_spec.name] = tooth2
_spec.loader.exec_module(tooth2)

und = tooth2.undispositioned_gaps


def test_path_gated_excuses_every_spec():
    # wrc/spa/mc never compute on the class-CPCV path -> PATH_GATED wave-level.
    specs = ["A", "B"]
    gaps = {"A": ["wrc", "spa"], "B": ["wrc", "spa"]}
    out = und(specs, lambda s: gaps[s], {"wrc", "spa"}, {})
    assert out == []


def test_spec_gated_excuses_only_its_own_spec():
    # A's PBO is degenerate (SPEC_GATED on A); B's PBO fired (not a gap on B).
    specs = ["A", "B"]
    gaps = {"A": ["pbo"], "B": []}
    per_spec = {"A": {"pbo": "SPEC_GATED"}}
    assert und(specs, lambda s: gaps[s], set(), per_spec) == []


def test_witnessed_on_another_spec_does_NOT_excuse_a_gap_here():
    # THE FIX: pbo fired on B but is MISSING on A -> A must be flagged, never
    # excused by B's firing (the global-witnessed masking the grader caught).
    specs = ["A", "B"]
    gaps = {"A": ["pbo"], "B": []}  # coverage_gaps already excludes B (pbo fired there)
    per_spec = {}  # pbo was witnessed, not gated, on either spec
    out = und(specs, lambda s: gaps[s], set(), per_spec)
    assert out == [("A", "pbo")]


def test_spec_gated_on_another_spec_does_NOT_excuse_a_gap_here():
    # pbo SPEC_GATED on B does not excuse pbo genuinely missing (neither fired nor
    # gated) on A.
    specs = ["A", "B"]
    gaps = {"A": ["pbo"], "B": ["pbo"]}
    per_spec = {"B": {"pbo": "SPEC_GATED"}}  # only B is gated
    out = und(specs, lambda s: gaps[s], set(), per_spec)
    assert out == [("A", "pbo")]


def test_grader_mutation_scenario_16_specs():
    # Reproduce the commissioning grade's mutation on the real wave shape: 16 specs,
    # 6 judges fire on all, 5 PATH_GATED. Remove pbo from ONE spec -> that spec is a
    # real gap the OLD global logic missed; the per-spec rule catches it.
    specs = [f"s{i}" for i in range(16)]
    PATH = {"wrc", "spa", "monte_carlo_ruin", "performance_gate", "forge_score"}
    per_spec = {s: {g: "PATH_GATED" for g in ("wrc", "spa", "monte_carlo_ruin")} for s in specs}

    def coverage_gaps_clean(s):
        return sorted(PATH)  # 6 witnessed fired; only the 5 path-gated are absent

    assert und(specs, coverage_gaps_clean, PATH, per_spec) == []  # clean wave OK

    def coverage_gaps_mutated(s):
        return sorted(PATH | ({"pbo"} if s == "s7" else set()))  # pbo missing on s7 only

    out = und(specs, coverage_gaps_mutated, PATH, per_spec)
    assert out == [("s7", "pbo")]  # caught, not masked by pbo firing on s0..s6,s8..
