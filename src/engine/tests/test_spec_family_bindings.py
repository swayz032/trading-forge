"""Tests for spec_family_bindings.py — Band C condition-family binding-plan compiler.

Run targeted (per CLAUDE.md pre-existing tower trait: bare pytest collection
over the full src/engine/tests directory hangs because some module transitively
imports the vectorbt-JIT backtester):

    python -m pytest src/engine/tests/test_spec_family_bindings.py -v
"""

from __future__ import annotations

import json
import os
import pathlib

import pytest

from src.engine.spec_family_bindings import (
    MIN_SPINE_BOUND_RATIO,
    bind_condition,
    compile_binding_plan,
    resolve_session_keyword,
)

# ★★★ READ-ONLY reference corpus. This was a hardcoded absolute path into ONE
#     developer's checkout (R-444):
#         r"C:\Users\tonio\Projects\...\.claude\worktrees\extraction-100\tmp\generalization"
#     which made three tests depend on one machine's filesystem layout.
#
# ★★★ AND STATE THE PART A PATH FIX DOES NOT SOLVE, so the next reader is not
#     misled by the repair: this corpus lives under `.claude/worktrees/`, which
#     is GITIGNORED (.gitignore:22). It is therefore ABSENT ON EVERY CI RUNNER,
#     and the three tests below that consume it — including TWO DETERMINISM
#     tests — have always `pytest.skip`-ped there. Anchoring the path removes
#     the developer-machine coupling; it does NOT make them run in CI. Making
#     them run in CI requires the corpus to be committed as a fixture or
#     fetched, which is a separate decision and deliberately not taken here.
#
# ★ Override with TF_SPEC_SAMPLES_DIR to point at the corpus wherever it lives
#   (e.g. the primary checkout, when running from a worktree).
_REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
SAMPLES_DIR = os.environ.get(
    "TF_SPEC_SAMPLES_DIR",
    str(_REPO_ROOT / ".claude" / "worktrees" / "extraction-100" / "tmp" / "generalization"),
)


def _load_sample(name: str) -> dict:
    path = os.path.join(SAMPLES_DIR, name)
    if not os.path.isfile(path):
        # ★ Name the remedy in the skip text. A skip that does not say how to
        #   un-skip itself is how three tests went unnoticed for months.
        pytest.skip(
            f"reference sample corpus unavailable at {path} — "
            "set TF_SPEC_SAMPLES_DIR to the corpus location to enable these tests "
            "(corpus is under gitignored .claude/worktrees/, so it is never present in CI)"
        )
    with open(path, encoding="utf-8") as f:
        return json.load(f)


# ─── Determinism ────────────────────────────────────────────────────────────

def test_binding_plan_is_deterministic_same_spec_same_plan():
    spec = _load_sample("1HFoStW_wsc.spec.json")["spec"]
    plan1 = compile_binding_plan(spec).to_dict()
    plan2 = compile_binding_plan(spec).to_dict()
    assert plan1 == plan2


def test_binding_plan_deterministic_across_repeated_calls_5x():
    spec = _load_sample("1HFoStW_wsc.spec.json")["spec"]
    plans = [compile_binding_plan(spec).to_dict() for _ in range(5)]
    assert all(p == plans[0] for p in plans)


# ─── Per-family binding tests (fixture conditions) ─────────────────────────

def test_wait_session_binds_on_recognized_keyword():
    cond = {"id": "c1", "type": "WAIT_SESSION", "object": "london session", "role": "spine"}
    b = bind_condition(cond)
    assert b.bindable is True
    assert b.session_zone == "london"
    assert b.approximation is False
    assert b.primitive == "session_windows"


def test_wait_session_unbindable_on_unrecognized_object():
    cond = {"id": "c1", "type": "WAIT_SESSION", "object": "information events", "role": "confluence"}
    b = bind_condition(cond)
    assert b.bindable is False
    assert b.reason == "no_recognized_session_keyword"


def test_wait_structure_binds_with_approximation_flag():
    cond = {"id": "c1", "type": "WAIT_STRUCTURE", "object": "vwap and volume profile combination", "role": "spine"}
    b = bind_condition(cond)
    assert b.bindable is True
    assert b.approximation is True
    assert b.primitive == "structure_engine.compute_structure_state"


def test_invalidate_binds_without_approximation():
    cond = {"id": "c1", "type": "INVALIDATE", "object": "strong close through vwap with volume", "role": "invalidation"}
    b = bind_condition(cond)
    assert b.bindable is True
    assert b.approximation is False
    assert b.primitive == "structural_stops.compute_structural_stop"


def test_exit_hint_bindable_but_never_executed():
    cond = {"id": "c1", "type": "EXIT_HINT", "object": "reassessment position", "role": "spine"}
    b = bind_condition(cond)
    assert b.bindable is True
    assert b.executed is False, "EXIT_HINT must never drive entry/exit signals — provenance only"


def test_reset_and_exception_are_unsupported_with_explicit_reason():
    reset = bind_condition({"id": "c1", "type": "RESET", "object": "reset state", "role": "spine"})
    exc = bind_condition({"id": "c2", "type": "EXCEPTION", "object": "unexpected condition", "role": "spine"})
    assert reset.bindable is False and reset.reason == "control_flow_reset_unsupported"
    assert exc.bindable is False and exc.reason == "control_flow_exception_unsupported"


def test_unknown_condition_type_is_honestly_unbindable_never_guessed():
    cond = {"id": "c1", "type": "SOME_FUTURE_TYPE", "object": "whatever", "role": "spine"}
    b = bind_condition(cond)
    assert b.bindable is False
    assert b.reason == "unknown_condition_type"


# ─── Role semantics ─────────────────────────────────────────────────────────

def test_spine_ordering_role_is_required_sequence_for_compile_decision():
    """A spec whose spine binds below MIN_SPINE_BOUND_RATIO must be queued,
    even if the trigger itself binds fine."""
    spec = {
        "direction": "long",
        "entry_conditions": [
            {"id": "t1", "type": "ENABLE_ENTRY", "object": "entry", "role": "trigger"},
            {"id": "s1", "type": "RESET", "object": "x", "role": "spine"},
            {"id": "s2", "type": "EXCEPTION", "object": "y", "role": "spine"},
            {"id": "s3", "type": "RESET", "object": "z", "role": "spine"},
        ],
        "invalidations": [],
        "entry_trigger_id": "t1",
    }
    plan = compile_binding_plan(spec)
    assert plan.spine_total == 3
    assert plan.spine_bound == 0
    assert plan.compiled is False
    assert len(plan.queue_reasons) >= 3


def test_confluence_role_never_blocks_compile_even_when_fully_unbound():
    spec = {
        "direction": "long",
        "entry_conditions": [
            {"id": "t1", "type": "ENABLE_ENTRY", "object": "entry", "role": "trigger"},
            {"id": "s1", "type": "WAIT_SESSION", "object": "london session", "role": "spine"},
            {"id": "c1", "type": "RESET", "object": "x", "role": "confluence"},
            {"id": "c2", "type": "EXCEPTION", "object": "y", "role": "confluence"},
        ],
        "invalidations": [],
        "entry_trigger_id": "t1",
    }
    plan = compile_binding_plan(spec)
    assert plan.confluence_total == 2
    assert plan.confluence_bound == 0
    assert plan.compiled is True, "confluence-role unbound conditions must never gate the compile decision"


def test_bare_trigger_with_no_spine_conditions_stays_queued_not_falsely_compiled():
    """A trigger-only spec (no spine at all) must NOT be treated as
    condition-compiled just because ENABLE_ENTRY/ENTER trivially binds —
    this is the exact shape of Band B's own vwapSpec fixture
    (spec-onboarding-service.test.ts), which must keep routing to
    NEEDS_ARCHETYPE. Regression guard for that cross-band contract."""
    spec = {
        "direction": "short",
        "entry_conditions": [
            {"id": "t1", "type": "ENTER", "object": "vwap slope reversal cross", "role": "trigger"},
            {"id": "c1", "type": "FILTER", "object": "vwap band width", "role": "confluence"},
        ],
        "invalidations": [],
        "entry_trigger_id": "t1",
    }
    plan = compile_binding_plan(spec)
    assert plan.trigger_bound is True  # ENTER binds trivially...
    assert plan.spine_total == 0
    assert plan.compiled is False, "bare trigger + confluence only, zero spine, must stay queued"
    assert any(r["reason"] == "no_spine_conditions_present" for r in plan.queue_reasons)


def test_trigger_single_condition_must_bind_or_the_whole_spec_queues():
    spec = {
        "direction": "long",
        "entry_conditions": [
            {"id": "t1", "type": "RESET", "object": "entry trigger somehow", "role": "trigger"},
        ],
        "invalidations": [],
        "entry_trigger_id": "t1",
    }
    plan = compile_binding_plan(spec)
    assert plan.trigger_bound is False
    assert plan.compiled is False
    assert plan.queue_reasons[0]["condition_id"] == "t1"


# ─── needs_archetype per-condition reasons (not blanket) ───────────────────

def test_queue_reasons_are_per_condition_not_blanket():
    spec = {
        "direction": "long",
        "entry_conditions": [
            {"id": "t1", "type": "ENABLE_ENTRY", "object": "entry", "role": "trigger"},
            {"id": "s1", "type": "WAIT_STRUCTURE", "object": "structure ok", "role": "spine"},
            {"id": "s2", "type": "RESET", "object": "bad one", "role": "spine"},
        ],
        "invalidations": [],
        "entry_trigger_id": "t1",
    }
    plan = compile_binding_plan(spec)
    # spine ratio = 1/2 = 0.5, meets MIN_SPINE_BOUND_RATIO exactly -> compiles,
    # but the unbound spine condition's reason must still surface.
    assert plan.compiled is True
    reasons = {r["condition_id"]: r["reason"] for r in plan.queue_reasons}
    assert reasons.get("s2") == "control_flow_reset_unsupported"
    assert "s1" not in reasons


# ─── Approximation propagation ──────────────────────────────────────────────

def test_approximation_used_true_when_any_bound_family_is_approximate():
    spec = {
        "direction": "long",
        "entry_conditions": [
            {"id": "t1", "type": "ENABLE_ENTRY", "object": "entry", "role": "trigger"},
            {"id": "s1", "type": "WAIT_STRUCTURE", "object": "structure", "role": "spine"},
        ],
        "invalidations": [],
        "entry_trigger_id": "t1",
    }
    plan = compile_binding_plan(spec)
    assert plan.approximation_used is True


def test_approximation_used_false_when_only_exact_primitives_used():
    spec = {
        "direction": "long",
        "entry_conditions": [
            {"id": "t1", "type": "ENABLE_ENTRY", "object": "entry", "role": "trigger"},
            {"id": "s1", "type": "WAIT_SESSION", "object": "london session", "role": "spine"},
        ],
        "invalidations": [
            {"id": "i1", "type": "INVALIDATE", "object": "structural break", "role": "invalidation"},
        ],
        "entry_trigger_id": "t1",
    }
    plan = compile_binding_plan(spec)
    assert plan.approximation_used is False


def test_exit_hint_approximation_never_counted_since_not_executed():
    spec = {
        "direction": "long",
        "entry_conditions": [
            {"id": "t1", "type": "ENABLE_ENTRY", "object": "entry", "role": "trigger"},
            {"id": "e1", "type": "EXIT_HINT", "object": "reassess", "role": "spine"},
        ],
        "invalidations": [],
        "entry_trigger_id": "t1",
    }
    plan = compile_binding_plan(spec)
    assert plan.approximation_used is False


# ─── Real-sample regression checks (honest split, not 25/25) ───────────────

@pytest.mark.parametrize(
    "sample_name",
    [
        "1HFoStW_wsc.spec.json",   # VWAP mean-reversion — no ICT vocab, was queued in Band B
        "HfZTCZTDfWk.spec.json",
    ],
)
def test_real_sample_produces_a_binding_plan_without_raising(sample_name):
    spec = _load_sample(sample_name)["spec"]
    plan = compile_binding_plan(spec)
    assert isinstance(plan.compiled, bool)
    assert plan.spine_total >= 0


def test_min_spine_bound_ratio_constant_is_reasonable():
    assert 0.0 < MIN_SPINE_BOUND_RATIO <= 1.0


def test_resolve_session_keyword_never_false_positives_on_padded_substring():
    # Regression against the exact false-positive class Band B's matcher
    # documented fixing (word-boundary padding, not bare substring match).
    assert resolve_session_keyword("keynotes about the market") is None
