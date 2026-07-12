"""H1 tier-1 detector tests -- the birth gate (spec §7.1) + contract + overfit
tripwire (spec §7.2-§7.4).

Imports ONLY the pure-stdlib extraction package (no vectorbt / no backtester),
so pytest collection does not hang per CLAUDE.md §2's JIT caveat.
"""

import json
import os

import pytest

from src.engine.extraction.tier1_detectors import run_tier1, SURFACE_CLASSES
from src.engine.extraction import tier1_coverage_report as cov

_FIXTURES = os.path.join(
    os.path.dirname(cov.__file__), "fixtures", "tier1_birth_fixtures.json"
)
_TRIPWIRE = 1.85


def _load_fixtures():
    return json.load(open(_FIXTURES, encoding="utf-8"))


# --------------------------------------------------------------------------- #
# §7.1 Birth gate: FIRES-ON-POSITIVES ∧ SILENT-ON-NEGATIVES, zero exceptions.
# --------------------------------------------------------------------------- #

_FX = _load_fixtures()
_POS = [
    (d["detector"], p) for d in _FX["detectors"] for p in d["positives"]
]
_NEG = [
    (d["detector"], n) for d in _FX["detectors"] for n in d["negatives"]
]


@pytest.mark.parametrize("detector,pos", _POS, ids=[f"{d}:{p['id']}" for d, p in _POS])
def test_birth_positive_fires(detector, pos):
    res = run_tier1(pos["text"])
    assert res.fired, f"{detector} positive {pos['id']} did NOT fire (dormant feature)"
    exp = pos["expect"]
    if "surface_class" in exp:
        assert any(dt.surface_class == exp["surface_class"] for dt in res.detections), (
            f"{pos['id']} fired but not as {exp['surface_class']}: "
            f"{[dt.surface_class for dt in res.detections]}"
        )
    if "anchor_substring" in exp:
        assert any(exp["anchor_substring"] in dt.quote_anchor for dt in res.detections), (
            f"{pos['id']} anchor missing {exp['anchor_substring']!r}: "
            f"{[dt.quote_anchor for dt in res.detections]}"
        )


@pytest.mark.parametrize("detector,neg", _NEG, ids=[f"{d}:{n['id']}" for d, n in _NEG])
def test_birth_negative_silent(detector, neg):
    res = run_tier1(neg["text"])
    assert not res.fired, (
        f"{detector} negative {neg['id']} FIRED (hallucinated gate -> reaches "
        f"into tier-2): {[(dt.surface_class, dt.quote_anchor) for dt in res.detections]}"
    )


def test_birth_gate_all_pass():
    """The whole-suite §3.2 gate, zero exceptions."""
    report = cov.run_birth_gate()
    assert report["all_pass"], report


def test_descriptive_controls_silent():
    """Load-bearing layer precision: the tier-1 LAYER stays SILENT on all 5
    descriptive controls (spec §3.1 note)."""
    lr = cov.run_layer_reliability()
    assert lr["descriptive_controls_silent"], lr["descriptive_false_fires"]


# --------------------------------------------------------------------------- #
# §7.1 Engagement / dormancy: each family fires >=1 across the 143 design set.
# --------------------------------------------------------------------------- #


def test_no_dormant_family_on_design_set():
    design, _ = cov.materialize_sets()
    cd = cov.coverage(design)
    for fam in SURFACE_CLASSES:
        assert cd[fam]["fires"] >= 1, (
            f"family {fam} is DORMANT on the 143 design set "
            f"(fires=0) -> presumed dormant, blocked (spec §3.2)"
        )


# --------------------------------------------------------------------------- #
# §7.2/§7.3 Materialization + overfit tripwire.
# --------------------------------------------------------------------------- #


def test_materialization_matches_frozen_split():
    design, heldout = cov.materialize_sets()
    assert len(design) == 143
    assert len(heldout) == 78  # frozen split; docs' "70" = 78 minus 8 UNRESOLVED
    keys_d = {f"{r['video']}||{r['condition_id']}" for r in design}
    keys_h = {f"{r['video']}||{r['condition_id']}" for r in heldout}
    assert not (keys_d & keys_h), "design and held-out overlap -> leakage"


def test_overfit_ratio_under_tripwire():
    rep = cov.build_report()
    o = rep["overfit"]
    assert o["overfit_ratio"] is not None
    assert o["overfit_ratio"] <= _TRIPWIRE, (
        f"overfit_ratio {o['overfit_ratio']} EXCEEDS tripwire {_TRIPWIRE} "
        f"(design {o['layer_coverage_design']} / heldout {o['layer_coverage_heldout']})"
    )
    assert o["verdict"] == "PASS"


# --------------------------------------------------------------------------- #
# §7.4 Interface / contract invariants.
# --------------------------------------------------------------------------- #


def test_char_span_resolves_verbatim():
    """Every emitted char_span must resolve to quote_anchor verbatim in the
    segment (claim-scoping invariant, spec §5.3 / §7.4)."""
    design, heldout = cov.materialize_sets()
    for r in design + heldout:
        q = r["quote"]
        res = run_tier1(q)
        for dt in res.detections:
            s, e = dt.char_span
            assert q[s:e] == dt.quote_anchor, (
                f"anchor {dt.quote_anchor!r} != segment[{s}:{e}]={q[s:e]!r}"
            )


def test_global_offset_applied_to_char_span():
    q = "buy from the demand zone when it is retested"
    base = 1000
    res = run_tier1(q, char_span=(base, base + len(q)))
    assert res.fired
    dt = res.detections[0]
    s, e = dt.char_span
    assert s >= base and e <= base + len(q)
    # resolves against the full-transcript slice
    assert q[s - base : e - base] == dt.quote_anchor


def test_fallthrough_emitted_when_silent():
    """Every non-fired span emits exactly one fall-through with
    classifying_tier == null (spec §7.4 -- no span silently dropped)."""
    res = run_tier1("now back to the euro dollar chart here")
    assert not res.fired
    assert res.fallthrough is not None
    assert res.fallthrough.classifying_tier is None
    assert res.fallthrough.surface_class == "cannot-determine-at-tier-1"


def test_fired_segment_has_no_fallthrough():
    res = run_tier1("buy from the demand zone when it is retested")
    assert res.fired
    assert res.fallthrough is None


def test_conditional_action_not_double_claimed_as_imperative():
    """Tie/overlap (spec §2): 'buy .. when ..' is ONE conditional-action fire,
    not a competing imperative fire on the same gate."""
    res = run_tier1("buy from the demand zone when it is retested")
    assert len(res.detections) == 1
    assert res.detections[0].surface_class == "conditional-action"
