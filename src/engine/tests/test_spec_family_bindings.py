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
import random
import re
from datetime import UTC

import pytest

from src.engine.spec_family_bindings import (
    _REAL_ZONE_INTERVALS,
    MIN_SPINE_BOUND_RATIO,
    SESSION_ANCHOR_PHRASE_RE,
    SESSION_KEYWORDS,
    SESSION_TEACHING_UNBOUND_REASON,
    SESSION_WRAPPING_WINDOW_UNBOUND_REASON,
    _session_anchor_phrase_is_governed_endpoint,
    _session_anchor_sequence_wraps_midnight,
    bind_condition,
    classify_session_role,
    compile_binding_plan,
    refused_session_zone,
    resolve_session_keyword,
)

# READ-ONLY reference corpus lives in a SIBLING worktree tree (not nested
# under this worktree) — see task brief. Absolute path per the fixed
# reference location; tests skip gracefully if it's unavailable in some
# other environment rather than hard-failing the whole suite.
SAMPLES_DIR = r"C:\Users\tonio\Projects\trading-forge\trading-forge\.claude\worktrees\extraction-100\tmp\generalization"


def _load_sample(name: str) -> dict:
    path = os.path.join(SAMPLES_DIR, name)
    if not os.path.isfile(path):
        pytest.skip(f"reference sample corpus unavailable at {path}")
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


# --- R-083 §3 regression fence: bare-token session matching -------------------
# A monitor probe flagged the token "am" inside "...so I am not counting this as
# a displacement..." — the English verb, not the meridiem. Production is SAFE
# (SESSION_KEYWORDS is phrase-based: "am session", "ny am", never bare "am"), so
# the alarm was the probe's defect, not the code's. Fenced here because the
# bare-token version of this matcher is a live trap for any future rewrite: it
# would silently BIND entry-mechanics prose as a session condition, which changes
# n_executed_bindable and therefore the binding-approximation rate.

# Verbatim from shakedown_specs/0xygpCMwxbQ__s0.spec.json, condition
# "WAIT_SESSION:i-prefer-to-have-a-stop-rate-prior-to-th#8" — a WAIT_SESSION
# condition whose text carries no session semantics at all (it is stop placement).
_AM_VERB_OBJECT = (
    "I prefer to have a stop rate prior to the displacement so I am not "
    "counting this as a displacement move up"
)


def test_bare_am_verb_never_resolves_to_a_session_zone():
    assert resolve_session_keyword(_AM_VERB_OBJECT) is None


@pytest.mark.parametrize(
    "prose",
    [
        _AM_VERB_OBJECT,
        "I am watching for the setup to form",
        "this is where I am entering the trade",
        "pm me if you want the indicator",
        "the trend am I right about it continuing",
    ],
)
def test_bare_am_pm_tokens_in_prose_never_bind_as_session(prose):
    assert resolve_session_keyword(prose) is None
    binding = bind_condition(
        {
            "id": "regression:bare-am-pm",
            "type": "WAIT_SESSION",
            "object": prose,
            "role": "confluence",
        }
    )
    assert binding.bindable is False
    assert binding.reason == "no_recognized_session_keyword"


# ANTI-VACUITY COMPANION. Without this, the fence above would pass just as
# happily if resolve_session_keyword were broken to always return None —
# a dead matcher and a correct one are indistinguishable on negative cases.
#
# ★ R-156 §2 FIX. This list previously carried a third case,
# ("skip the lunch hour entirely", "lunch_blackout"), asserting bindable=True
# with session_zone="lunch_blackout". That was A GREEN TEST BLESSING AN
# ALWAYS-FALSE RUNTIME GATE: "lunch_blackout" was not a key of
# session_windows._ZONE_CHECKS, so is_in_killzone(ts, "lunch_blackout")
# returned False for EVERY timestamp that will ever exist. The assertion was
# literally true about the binding and entirely false about the behavior —
# a fabricated safety-claim inside a fence.
#
# ★ R-185 §2 CLOSURE. The relocated tripwire that replaced it has now FIRED
# and been REWRITTEN, exactly as designed — see
# test_lunch_phrase_is_refused_and_nothing_emits_an_uncovered_zone below.
# The orphan-zone defect is closed (Option A: the phrases no longer emit),
# so the tripwire's premise — "this phrase binds lunch_blackout" — is dead,
# and the test now asserts the NEW truth with the same both-directions
# discipline. Retiring WITH its subject, by design, is the whole difference
# between a self-destructing instrument and one somebody quietly deleted.
_REAL_SESSION_PHRASE_CASES = [
    ("we trade the ny am session only", "ny_am"),
    ("wait for the london open before entering", "london"),
]


@pytest.mark.parametrize(("phrase", "expected_zone"), _REAL_SESSION_PHRASE_CASES)
def test_real_session_phrases_still_bind(phrase, expected_zone):
    assert resolve_session_keyword(phrase) == expected_zone
    binding = bind_condition(
        {
            "id": "regression:real-session",
            "type": "WAIT_SESSION",
            "object": phrase,
            "role": "confluence",
        }
    )
    assert binding.bindable is True
    assert binding.session_zone == expected_zone


# ─── Orphan-zone honesty (R-156 §2) → CLOSURE (R-185 §2) ────────────────────
#
# HISTORY, kept because the check outlives the defect: SESSION_KEYWORDS used to
# emit 7 zone names while session_windows._ZONE_CHECKS could evaluate only 5,
# so `lunch_blackout` / `overnight` bound to gates that were False for all
# 1,440 minutes of every day while advertising approximation=False.
#
# The orphan-zone closure (Option A) removed both names from the emit side.
# These tests now assert the CLOSED state, and — this is the part that matters
# — they must FAIL if an uncovered emission ever returns.


def _covered_zone_names() -> set[str]:
    """Zones is_in_killzone() can actually evaluate. Derived from the dispatch
    table itself — never hand-transcribed, so it cannot drift out of date."""
    from src.engine.session_windows import _ZONE_CHECKS

    return set(_ZONE_CHECKS)


def _emittable_zone_names() -> set[str]:
    """Every zone name a WAIT_SESSION binding can carry: the keyword table's
    zones plus the role resolver's computable zones. Also derived, not typed."""
    return set(SESSION_KEYWORDS) | set(_REAL_ZONE_INTERVALS)


def _orphan_zone_names() -> set[str]:
    return _emittable_zone_names() - _covered_zone_names()


def _refused_zone_names() -> set[str]:
    """The zone names deliberately NOT emitted. Derived from the refusal table,
    not typed — so this file cannot drift from the production decision."""
    from src.engine.session_windows import REFUSED_SESSION_KEYWORDS

    return set(REFUSED_SESSION_KEYWORDS)


def test_emit_is_a_subset_of_covered_and_the_refusal_table_is_the_reason():
    """★ THE REWRITTEN :334 TRIPWIRE, DIRECTION 1: the closed state, derived.

    Every zone any resolver can emit is a zone is_in_killzone() can evaluate.
    This FAILS THE MOMENT anyone re-introduces an uncovered emission — which is
    the whole reason it is written over derived sets instead of literals."""
    assert _covered_zone_names() == {"london", "ny_am", "ny_pm", "silver_bullet", "macro_window"}
    assert _orphan_zone_names() == set(), (
        "an uncovered zone is emittable again — pin (b2) EMIT ⊆ COVERED is violated: "
        f"{sorted(_orphan_zone_names())}"
    )
    # ...and the two names did not simply vanish. They are RECORDED as refused,
    # so "we stopped emitting it" is distinguishable from "somebody deleted it."
    assert _refused_zone_names() == {"lunch_blackout", "overnight"}
    assert _refused_zone_names() & _emittable_zone_names() == set(), (
        "a refused zone is emittable — refusal and emission must be disjoint"
    )


def test_emit_subset_covered_fails_when_an_uncovered_emission_is_reintroduced():
    """★ THE REWRITTEN :334 TRIPWIRE, DIRECTION 2 — the anti-vacuity half.

    A check that passes because the thing it checks was removed is not a
    check. This RE-INTRODUCES an uncovered emission and proves the derived
    orphan set notices, then restores. Without this, the assertion above
    would keep passing if _emittable_zone_names() were broken to return {}."""
    from src.engine import spec_family_bindings as _sfb

    assert _orphan_zone_names() == set()
    _sfb.SESSION_KEYWORDS["zzz_reintroduced_orphan"] = ("zzz reintroduced orphan",)
    try:
        assert _orphan_zone_names() == {"zzz_reintroduced_orphan"}, (
            "the orphan set is not derived from the live table — it cannot see a "
            "re-introduced uncovered emission, so its green is meaningless"
        )
    finally:
        del _sfb.SESSION_KEYWORDS["zzz_reintroduced_orphan"]
    assert _orphan_zone_names() == set()


def test_lunch_phrase_is_refused_and_nothing_emits_an_uncovered_zone():
    """★ THE REWRITTEN :334 TRIPWIRE, on the original subject phrase.

    OLD PREMISE (dead): "skip the lunch hour entirely" binds, carrying
    session_zone="lunch_blackout", and is_in_killzone() can never evaluate it.
    NEW TRUTH: the phrase no longer binds at all. It is REFUSED — unbound,
    with a reason that NAMES the zone it would have bound — so the teaching is
    visibly declined rather than silently dropped into the generic bucket.

    Both directions are kept: the phrase must not bind, AND the refusal must
    stay legible. If anyone re-introduces the emission, the first assertion
    fails; if anyone deletes the refusal instead of recording it, the second
    and third do."""
    binding = bind_condition(
        {
            "id": "regression:orphan-zone",
            "type": "WAIT_SESSION",
            "object": "skip the lunch hour entirely",
            "role": "confluence",
        }
    )
    assert binding.bindable is False, (
        "an uncovered zone is binding again — this is the always-False gate the "
        "orphan-zone closure removed"
    )
    assert binding.session_zone is None
    assert binding.reason == "session_zone_refused_uncomputable_window:lunch_blackout", (
        f"refusal is not legible: reason={binding.reason!r}"
    )
    # The refusal must be DISTINCT from the generic miss — otherwise "refused"
    # and "never recognized" collapse into one bucket and the honesty is lost.
    assert binding.reason != "no_recognized_session_keyword"
    # Never an exactness claim on a zone with no window (packet prohibition).
    assert binding.approximation is not False


def test_no_anti_vacuity_case_certifies_a_zone_the_killzone_gate_cannot_check():
    """Structural version of the :334 fix: no case in the anti-vacuity fence
    may expect an orphan zone, and none may expect a REFUSED zone either.
    Checking both keeps this live now that the orphan set is empty."""
    forbidden = _orphan_zone_names() | _refused_zone_names()
    offenders = [(p, z) for p, z in _REAL_SESSION_PHRASE_CASES if z in forbidden]
    assert offenders == [], f"anti-vacuity fence certifies unbindable zone(s): {offenders}"


def test_sibling_sweep_no_session_test_asserts_an_uncheckable_zone():
    """THE MINI-SWEEP (R-156 §2) as a PERMANENT check, not a one-time grep.

    Method: derive the forbidden set programmatically (orphan zones, now empty,
    UNION the refused zones — which keeps the sweep live after the closure
    rather than letting it go vacuous), then AST-scan every test module that
    imports a session surface for a string literal equal to a forbidden zone
    name. Any hit outside this module (which holds the registered tests) is a
    new sibling and fails here.

    Scoping note: modules that never touch spec_family_bindings/
    session_windows are excluded on purpose. Other subsystems use these same
    words in unrelated namespaces — session_context._get_session()'s own
    label vocabulary, gate_block_analyzer's gate KEYS, firm-rule
    "overnight_allowed" — and those are not siblings of this defect.

    A literal-scan over-approximates (it cannot tell an assertion from a
    comment), which is the safe direction for a tripwire: it can nag, never
    miss."""
    import ast
    import pathlib

    orphans = _orphan_zone_names() | _refused_zone_names()
    repo_root = pathlib.Path(__file__).resolve().parents[3]
    this_module = pathlib.Path(__file__).resolve()

    offenders: list[tuple[str, int, str]] = []
    scanned = 0
    for path in sorted((repo_root / "src").rglob("test_*.py")):
        try:
            source = path.read_text(encoding="utf-8")
        except OSError:
            continue
        if "spec_family_bindings" not in source and "session_windows" not in source:
            continue
        scanned += 1
        if path.resolve() == this_module:
            continue
        try:
            tree = ast.parse(source)
        except SyntaxError:
            continue
        for node in ast.walk(tree):
            if isinstance(node, ast.Constant) and isinstance(node.value, str) and node.value in orphans:
                offenders.append((str(path.relative_to(repo_root)), node.lineno, node.value))

    assert scanned >= 1, "sweep matched no session-related test module — the sweep itself is broken"
    assert offenders == [], f"test(s) referencing an uncheckable session zone: {offenders}"


# ─── Role-Aware Session Resolver (docs/designs/packet-role-aware-session-
# resolver-2026-07-20.md) — R-085 §2 / R-088 §3 / R-143 §3 item 2 ──────────
#
# Flag: TF_SESSION_ROLE_RESOLVER_ENABLED, default OFF. Every test in this
# section that exercises the NEW behavior explicitly turns it on via the
# `_role_resolver_on` fixture and restores the environment afterward — no
# test in this file (or any other) relies on ambient env state.

_BATTERY_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "..", "docs", "replay-results", "h1-battery")


def _load_battery(name: str) -> dict:
    path = os.path.join(_BATTERY_DIR, name)
    if not os.path.isfile(path):
        pytest.skip(f"h1-battery fixture unavailable at {path}")
    with open(path, encoding="utf-8") as f:
        return json.load(f)


@pytest.fixture
def _role_resolver_on(monkeypatch):
    monkeypatch.setenv("TF_SESSION_ROLE_RESOLVER_ENABLED", "true")
    yield


# ─── S2: calibration fixtures — the grade that specified the spec is the test of it ─

_KNOWN_BAD_TEXT = "you might have a long idea for your session"
_KNOWN_GOOD_OFF_THE_BELL = "the first two-minute candle off the Bell closes over the 20 SMA and vwap"
_KNOWN_GOOD_OPENING_BELL = (
    "if i can find a stock that opens weak on the day and actually drops at the opening bell "
    "below the v-wop and then breaks above it with some volume coming in that's my favorite "
    "area to dip buy into"
)


def test_s2_known_bad_row_is_refused(_role_resolver_on):
    """The grader's own rejected row — literal "session" meaning "the day,"
    doing no work — is condition_id you-might-have-a-long-idea-for-your-
    sess#2 (session-a-mistype-dispositions.json). The resolver must refuse
    it even with the flag on."""
    result = classify_session_role(_KNOWN_BAD_TEXT)
    assert result.recognized is False
    binding = bind_condition(
        {"id": "calib:known-bad", "type": "WAIT_SESSION", "object": _KNOWN_BAD_TEXT, "role": "spine"}
    )
    assert binding.bindable is False
    assert binding.reason == "no_recognized_session_keyword"


@pytest.mark.parametrize("text", [_KNOWN_GOOD_OFF_THE_BELL, _KNOWN_GOOD_OPENING_BELL])
def test_s2_known_good_bell_rows_are_recognized_but_refused_under_name_first(_role_resolver_on, text):
    """★ REDESIGN sub-packet 1 (R-284 Decision A). The grader's "opening bell" /
    "off the Bell" rows are still RECOGNIZED as session teaching (classify_session_role
    unchanged), but the opening bell is a clock-derived-coarse ANCHOR INSTANT
    (9:30 ET), not a closed-enum session NAME with an exact window. Under the
    name-first lane it is REFUSED — recognized-but-no-computable-window — rather
    than coarse-bound ny_am approximation=True. The governed blind grade (A/B/C =
    2/21/4) categorizes both as B (the session term is only an anchor for a price
    object), which is exactly this refusal."""
    result = classify_session_role(text)
    assert result.recognized is True
    binding = bind_condition({"id": "calib:known-good", "type": "WAIT_SESSION", "object": text, "role": "spine"})
    assert binding.bindable is False
    assert binding.session_zone is None
    assert binding.reason == SESSION_TEACHING_UNBOUND_REASON


# ─── S1: premise audit at the PRODUCTION BOUNDARY (not an interior argument) ─

def test_s1_premise_audit_production_boundary_varying_condition_text_moves_the_bound_window(_role_resolver_on):
    """The amended Leg 1: vary the CONDITION TEXT production actually reads
    (condition["object"], through the public bind_condition() entry point —
    never classify_session_role() called directly), and show the bound
    session window DIFFERS per condition. Varying an interior argument only
    proves a function is a function; that omission sank an earlier packet
    (WIRE-2, AR-142 — the primitive NAMED is not always the primitive that
    EXECUTES, so the production boundary is the only honest place to test)."""
    # ★ REDESIGN sub-packet 1: the bound outcome comes from an unambiguous
    # closed-enum session NAME (approximation=False, is_in_killzone), NOT from a
    # clock derivation. A clock-carrying teaching is now recognized-but-refused.
    name_bound = bind_condition(
        {
            "id": "premise:a",
            "type": "WAIT_SESSION",
            "object": "only trade during the london killzone session",
            "role": "spine",
        }
    )
    clock_refused = bind_condition(
        {
            "id": "premise:a2",
            "type": "WAIT_SESSION",
            "object": "go to your 5minut time frame, find 3:00 a.m. EST all the way until market open",
            "role": "spine",
        }
    )
    unbound_recognized = bind_condition(
        {
            "id": "premise:b",
            "type": "WAIT_SESSION",
            "object": "a simple 1-hour candle pattern I follow before my trading session every day",
            "role": "spine",
        }
    )
    filler = bind_condition(
        {"id": "premise:c", "type": "WAIT_SESSION", "object": _KNOWN_BAD_TEXT, "role": "spine"}
    )

    # Four different condition texts through the SAME production entry point
    # produce distinct outcomes -- the decision moves with the text, and the ONLY
    # bind is the honest name-route one (approximation=False), never a clock proxy.
    assert name_bound.bindable is True and name_bound.session_zone == "london" and name_bound.approximation is False
    assert name_bound.primitive == "session_windows.is_in_killzone"
    assert clock_refused.bindable is False and clock_refused.reason == SESSION_TEACHING_UNBOUND_REASON
    assert unbound_recognized.bindable is False and unbound_recognized.reason == SESSION_TEACHING_UNBOUND_REASON
    assert filler.bindable is False and filler.reason == "no_recognized_session_keyword"
    outcomes = {
        (name_bound.bindable, name_bound.session_zone, name_bound.reason),
        (clock_refused.bindable, clock_refused.session_zone, clock_refused.reason),
        (filler.bindable, filler.session_zone, filler.reason),
    }
    assert len(outcomes) == 3, "production-boundary liveness: distinct condition text must move the bound outcome"


# The four texts below are chosen so each lands in a DIFFERENT real killzone
# by arithmetic, not by hope:
#   ny_am         [07:00,10:00)  <- NYSE cash open anchor, 9:30
#   london        [02:00,05:00)  <- a lone 3:00 a.m. token
#   silver_bullet [10:00,11:00)  <- 10:30 a.m., which is OUTSIDE ny_am's end
#   ny_pm         [13:30,16:00)  <- 14:30 on a 24-hour clock (the H2 case)
# ★ REDESIGN sub-packet 1: the ZONE SELECTOR is now driven by unambiguous
# closed-enum session NAMES (no clock tokens), each landing in a DIFFERENT
# first-class killzone by NAME, not by a clock-derived overlap. These are
# synthetic probes of the name→window map, not corpus data.
_S1_DISTINCT_ZONE_CASES = [
    ("only trade during the am session", "ny_am"),
    ("wait for the london killzone session", "london"),
    ("the silver bullet window", "silver_bullet"),
    ("trade the ny pm session", "ny_pm"),
]


def test_s1_premise_audit_selector_yields_at_least_three_distinct_bound_zones(_role_resolver_on):
    """★ M2 FIX (independent grade, BAND 6).

    The old S1 audit above varies the condition text and shows three
    different OUTCOMES (bound / recognized-unbound / refused) — but every
    zone assertion in this entire file was "ny_am". That cannot distinguish
    a working session SELECTOR from a function that recognizes variably and
    then returns the constant "ny_am". Packet §4 item 1 asks to watch the
    BOUND SESSION WINDOW differ per condition, and nothing here did.

    The independent grader established that the selector really does
    discriminate (it obtained ny_pm / silver_bullet / london / ny_am from
    fresh production-boundary inputs) — but that receipt was the GRADER'S,
    not the delivery's. This test makes it the delivery's own.

    Everything goes through bind_condition(), the production entry point —
    never classify_session_role() directly."""
    observed = {}
    for text, expected_zone in _S1_DISTINCT_ZONE_CASES:
        binding = bind_condition(
            {"id": f"premise:zone:{expected_zone}", "type": "WAIT_SESSION", "object": text, "role": "spine"}
        )
        assert binding.bindable is True, f"{text!r} expected to bind"
        # ★ REDESIGN: the honest name route is approximation=False (is_in_killzone
        # evaluates the EXACT window), never a clock-derived proxy.
        assert binding.approximation is False, "name-route binds the exact window, approximation=False"
        assert binding.primitive == "session_windows.is_in_killzone"
        assert binding.session_zone == expected_zone, (
            f"{text!r} bound {binding.session_zone!r}, expected {expected_zone!r}"
        )
        observed[expected_zone] = binding.session_zone

    distinct = set(observed.values())
    assert len(distinct) >= 3, f"selector is not discriminating: only {distinct} across {len(_S1_DISTINCT_ZONE_CASES)} texts"
    # Anti-constant: the historically-only-asserted value must not be the
    # whole story. If someone reduced the selector to `return "ny_am"`, the
    # per-case assertions above fail AND this one does.
    assert distinct - {"ny_am"}, "every bound zone is still ny_am — the selector is indistinguishable from a constant"


def test_s1_flag_off_is_the_null_hypothesis_at_the_same_production_boundary():
    """Companion to the liveness test above: with the flag OFF (default,
    nothing set), the SAME three condition texts through the SAME
    bind_condition() entry point collapse to the pre-packet behavior --
    proving the observed movement above is caused BY the flag, not by
    something else varying alongside the text."""
    assert os.environ.get("TF_SESSION_ROLE_RESOLVER_ENABLED") is None
    london_ish = bind_condition(
        {
            "id": "premise:a",
            "type": "WAIT_SESSION",
            "object": "go to your 5minut time frame, find 3:00 a.m. EST all the way until market open",
            "role": "spine",
        }
    )
    unbound_recognized = bind_condition(
        {
            "id": "premise:b",
            "type": "WAIT_SESSION",
            "object": "a simple 1-hour candle pattern I follow before my trading session every day",
            "role": "spine",
        }
    )
    assert london_ish.bindable is False and london_ish.reason == "no_recognized_session_keyword"
    assert unbound_recognized.bindable is False and unbound_recognized.reason == "no_recognized_session_keyword"


# ─── S3: both polarities per binding, over the grade's OWN 26-row population ─

def _session_ab_rows():
    result = _load_battery("session-ab-blind-grade-RESULT.json")
    sample = _load_battery("session-ab-blind-grade-sample.json")
    verdicts = {r["condition_id"]: r["verdict"] for r in result["rows"]}
    objects = {r["condition_id"]: r["object"] for r in sample["rows"]}
    return [(cid, verdicts[cid], objects[cid]) for cid in verdicts]


# S5: the two binary-resisting rows (the grade's own hedge language --
# "Genuinely ambiguous" / "Hardest call and the weakest fit for either bin")
# are EXPLICITLY dispositioned here, never silently forced either direction.
# Both already carry graded_verdict=entry_mechanics_mistype in
# session-a-mistype-dispositions.json -- excluded from the 17-row target
# population by that disposition, not by this packet's own judgment -- and
# this test additionally proves the resolver independently agrees they are
# not session teaching (0 false positives on either), rather than assuming it.
BINARY_RESISTING_CONDITION_IDS = frozenset(
    {
        "WAIT_SESSION:a-liquidity-sweep-is-going-to-be-a-brief#4",
        "WAIT_SESSION:you-might-have-a-long-idea-for-your-sess#2",
    }
)

# ★ REDESIGN sub-packet 1 (R-284 Decision B) — CORRECTED FROM THE DEAD 8-of-17.
# The old set named the 8 rows for which classify_session_role derived a
# CLOCK/anchor-overlap span. That was the REFUTED "grade-was-the-resolver"
# number (AR-203): those 8 are all clock-derived-coarse proxies (approximation=
# True), which the governed blind grade (A/B/C = 2/21/4) categorizes as B — the
# session term is only an ANCHOR for a price object, not a taught session window.
# Under the honest name-first lane NONE of the 27 corpus rows binds by name (the
# two genuine session teachings, A=2, are a bare-"session" reference and a
# clock-carrying "two candles at 7/8am" pair — neither is an unambiguous
# closed-enum NAME with no clock). So the concretely-name-bound set is EMPTY, and
# the session value ceiling (≤2) is not reached on this corpus.
SESSION_TEACHING_BOUND_CONDITION_IDS: frozenset[str] = frozenset()


@pytest.mark.parametrize("cid,verdict,obj", _session_ab_rows(), ids=lambda v: v if isinstance(v, str) else "")
def test_s3_role_resolver_reproduces_the_grade_that_specified_it(_role_resolver_on, cid, verdict, obj):
    """"A resolver that cannot reproduce the grade that specified it has not
    implemented the spec" (AR-136). Runs the role classifier over ALL 26
    graded rows (not a hand-picked subset) and checks it against the
    independent blind grade's own verdict, per row."""
    result = classify_session_role(obj)
    binding = bind_condition({"id": cid, "type": "WAIT_SESSION", "object": obj, "role": "spine"})

    if cid in BINARY_RESISTING_CONDITION_IDS:
        # Explicitly dispositioned (S5): both are graded mistypes, and the
        # resolver must independently refuse them too -- never silently
        # forced bound just because the surrounding population is genuine.
        assert result.recognized is False, f"binary-resisting row {cid} must not be force-recognized"
        assert binding.bindable is False
        return

    if verdict == "entry_mechanics_mistype":
        # Reclassification lane, not this packet's population -- the
        # resolver must produce ZERO false positives on this class (the
        # exact defect class the grade's own notes warn against: a session
        # word appearing in an illustrative/aside role must not bind).
        assert result.recognized is False, f"mis-typed row {cid} must not be recognized as session teaching"
        assert binding.bindable is False
        assert binding.reason == "no_recognized_session_keyword"
        return

    # verdict == "session_teaching": recognized as genuine session teaching, but
    # under the name-first lane (R-284) NONE of these binds — every one is a
    # clock/anchor-coarse or ambiguous-named row with no exact closed-enum window,
    # so it is honestly REFUSED with the recognized-no-window reason. (The dead
    # 8-of-17 "bound" set is retired; see SESSION_TEACHING_BOUND_CONDITION_IDS.)
    assert result.recognized is True, f"genuine session-teaching row {cid} must be recognized"
    if cid in SESSION_TEACHING_BOUND_CONDITION_IDS:
        # Empty on this corpus; retained so a future corpus row that DOES carry
        # an unambiguous closed-enum name would assert the honest name bind.
        assert binding.bindable is True, f"{cid} expected a real computable zone"
        assert binding.approximation is False
        assert binding.primitive == "session_windows.is_in_killzone"
        assert binding.session_zone is not None
    else:
        assert binding.bindable is False, f"{cid} expected recognized-but-no-computable-window"
        assert binding.reason == SESSION_TEACHING_UNBOUND_REASON


def test_s3_recognition_never_fires_on_the_pre_existing_bare_am_pm_fence(_role_resolver_on):
    """Both polarities of the SAME fence the pre-existing test class checks,
    but with the flag ON -- the harder bar. If the role resolver were the
    thing that reintroduced bare-token matching, this is where it would
    show up."""
    for prose in [
        _AM_VERB_OBJECT,
        "I am watching for the setup to form",
        "this is where I am entering the trade",
        "pm me if you want the indicator",
        "the trend am I right about it continuing",
    ]:
        assert classify_session_role(prose).recognized is False
        binding = bind_condition(
            {"id": "regression:bare-am-pm:role-on", "type": "WAIT_SESSION", "object": prose, "role": "confluence"}
        )
        assert binding.bindable is False
        assert binding.reason == "no_recognized_session_keyword"


# ─── S6: coverage_6a RE-DERIVED ON THE GOVERNED POPULATION (R-284 Decision B) ─
#
# ★ THE DEAD 8/17 IS RETIRED. The old assert pinned coverage_6a == 8/17, where
# the numerator (8) was classify_session_role's CLOCK-derived coarse zones and
# the denominator (17) was the blind grade's session_teaching count. That split
# is REFUTED (AR-203: the blind grade WAS the resolver — 26/26 concordance, not
# independent), so it cannot be the coverage denominator.
#
# THE GOVERNED POPULATION is the criterion-faithful 27-row blind adjudication
# (docs/replay-results/blind-readjudication/blind-second-judge-LOCKED.json):
#   A = 2  genuine session teaching (the session/clock/calendar IS the taught object)
#   B = 21 the session term is only an ANCHOR; the taught object is a level/pattern/mechanic
#   C = 4  no taught session condition at all (indicator/platform setup, vacuous narration)
# 2 + 21 + 4 = 27. "session value ceiling ≤ 2" is A.
#
# THE METRIC, semantics restated so the key states the question its numerator
# and denominator answer:
#   coverage_6a  =  (WAIT_SESSION conditions the HONEST NAME ROUTE concretely
#                    binds to an EXACT killzone window, approximation=False)
#                 ÷ (A — the genuine session teachings, the only rows for which
#                    binding a session window is the correct thing to do)
# On this corpus the numerator is 0: the two A rows are a bare-"session"
# reference and a clock-carrying "two candles at 7/8am" pair, NEITHER an
# unambiguous closed-enum NAME with no clock — so coverage_6a = 0/2 = 0.0. This
# is the honest yield the ledger's caveat states (mechanism, not a large count).

_GOVERNED_GRADE_FILE = "../../../docs/replay-results/blind-readjudication/blind-second-judge-LOCKED.json"


def _governed_split() -> dict:
    path = os.path.join(os.path.dirname(__file__), _GOVERNED_GRADE_FILE)
    if not os.path.isfile(path):
        pytest.skip(f"governed grade unavailable at {path}")
    with open(path, encoding="utf-8") as f:
        return json.load(f)["counts"]


def _corpus_wait_session_rows() -> list[tuple[str, str]]:
    """All 27 WAIT_SESSION conditions of the governed corpus (16 shakedown specs),
    in the blind-judge's iteration order — the population the split is sourced from."""
    d = os.path.join(
        os.path.dirname(__file__), "..", "..", "..",
        "docs", "replay-results", "h1-scripts", "claude-rung-v32", "shakedown_specs",
    )
    if not os.path.isdir(d):
        pytest.skip(f"corpus unavailable at {d}")
    rows: list[tuple[str, str]] = []
    for f in sorted(os.listdir(d)):
        if not f.endswith(".spec.json"):
            continue
        with open(os.path.join(d, f), encoding="utf-8") as fh:
            spec = json.load(fh)
        for c in spec.get("spec", {}).get("entry_conditions", []):
            if c.get("type") == "WAIT_SESSION":
                rows.append((c.get("id", ""), c.get("object", "")))
    return rows


def test_s6_coverage_6a_re_derives_on_the_governed_population(_role_resolver_on):
    governed = _governed_split()
    a, b, c, total = governed["A"], governed["B"], governed["C"], governed["total"]
    # Governed split integrity — COMPUTED from the grade file, no literal pinned.
    assert a + b + c == total, f"governed A/B/C must partition the population: {a}+{b}+{c} != {total}"
    corpus = _corpus_wait_session_rows()
    assert len(corpus) == total, f"corpus rows ({len(corpus)}) must equal governed total ({total})"

    # Numerator — COMPUTED at the PRODUCTION boundary (bind_condition), the honest
    # name route: bindable AND approximation=False AND the exact-window primitive.
    name_bound = 0
    for cid, obj in corpus:
        binding = bind_condition({"id": cid, "type": "WAIT_SESSION", "object": obj, "role": "spine"})
        if binding.bindable and binding.approximation is False and binding.session_zone is not None:
            assert binding.primitive == "session_windows.is_in_killzone", cid
            name_bound += 1

    # The session value ceiling: honest binds can never exceed the genuine
    # session teachings (A). Computed, not assumed.
    assert name_bound <= a, f"name-route bound {name_bound} > genuine teachings A={a} (ceiling breached)"

    coverage_6a = name_bound / a  # of the genuine session teachings, the fraction honestly enforced
    # No expected value is hardcoded: coverage is derived from the resolver over
    # the governed corpus. On this corpus name_bound == 0, so coverage is 0.0.
    assert coverage_6a == name_bound / a
    assert 0.0 <= coverage_6a <= 1.0


def test_s6_dead_17_denominator_stays_retired(_role_resolver_on):
    """★ FOUNDING-FIXTURE (R-284 Decision B): if the dead session_teaching count
    (17) or the refuted coarse bound count (8) ever comes back as the coverage
    basis, this goes RED. The denominator is the GOVERNED A (genuine teachings),
    which is NOT 17; the numerator is the honest name route, which is NOT the 8
    clock-derived coarse zones classify_session_role still computes."""
    rows = _session_ab_rows()
    dead_teaching = sum(1 for _, v, _ in rows if v == "session_teaching")
    dead_coarse_bound = sum(1 for _, _v, obj in rows if classify_session_role(obj).zone is not None)
    governed = _governed_split()

    # The dead numbers are still exactly what they were — they are just no longer
    # the coverage basis. Asserting them here freezes them AS the refuted values.
    assert dead_teaching == 17, "the dead session_teaching count"
    assert dead_coarse_bound == 8, "the dead clock-derived coarse-bound count"

    # The governed denominator (A) is a DIFFERENT number, and the coverage the
    # engine now reports must use it, never the dead 17 or the dead 8.
    assert governed["A"] != dead_teaching, "coverage denominator must NOT be the dead 17"
    assert governed["A"] == 2, "governed genuine-session-teaching count (session ceiling)"

    # Production-boundary proof the dead 8 is not a live bind count: every one of
    # those clock-derived coarse rows is now REFUSED (bindable=False) — the coarse
    # bind was removed at the source, not merely relabeled.
    coarse_but_bound = 0
    for _cid, _v, obj in rows:
        if classify_session_role(obj).zone is not None:
            b = bind_condition({"id": "dead17", "type": "WAIT_SESSION", "object": obj, "role": "spine"})
            if b.bindable:
                coarse_but_bound += 1
    assert coarse_but_bound == 0, "no clock-derived coarse row may still produce a live bind"


# ─── S7: flag-off byte-identity PROVEN, not asserted ────────────────────────

def test_s7_flag_off_byte_identity_over_the_full_26_row_population():
    """Flag unset entirely (no monkeypatch -- the real default) reproduces
    the EXACT pre-packet bindings for all 26 rows: every one unbound with
    reason=no_recognized_session_keyword, session_zone=None,
    approximation=False. Diffed field-by-field, not spot-checked."""
    assert os.environ.get("TF_SESSION_ROLE_RESOLVER_ENABLED") is None
    for cid, _verdict, obj in _session_ab_rows():
        binding = bind_condition({"id": cid, "type": "WAIT_SESSION", "object": obj, "role": "spine"})
        assert binding.bindable is False
        assert binding.reason == "no_recognized_session_keyword"
        assert binding.session_zone is None
        assert binding.approximation is False


def test_s7_flag_explicitly_false_matches_flag_unset(monkeypatch):
    """The other half of "PROVEN not asserted": explicit "false" and total
    absence must produce the identical plan, not merely both look inert by
    coincidence of two different code paths."""
    monkeypatch.delenv("TF_SESSION_ROLE_RESOLVER_ENABLED", raising=False)
    unset_results = [
        bind_condition({"id": cid, "type": "WAIT_SESSION", "object": obj, "role": "spine"}).to_dict()
        for cid, _v, obj in _session_ab_rows()
    ]
    monkeypatch.setenv("TF_SESSION_ROLE_RESOLVER_ENABLED", "false")
    explicit_false_results = [
        bind_condition({"id": cid, "type": "WAIT_SESSION", "object": obj, "role": "spine"}).to_dict()
        for cid, _v, obj in _session_ab_rows()
    ]
    assert unset_results == explicit_false_results


# ─── S9 (mistype/binary-resisting rows never silently forced, restated as a
# standalone assertion independent of the parametrized sweep above) ────────

def test_s9_mistype_and_binary_resisting_rows_produce_zero_new_bindings(_role_resolver_on):
    for cid, verdict, obj in _session_ab_rows():
        if verdict == "entry_mechanics_mistype" or cid in BINARY_RESISTING_CONDITION_IDS:
            binding = bind_condition({"id": cid, "type": "WAIT_SESSION", "object": obj, "role": "spine"})
            assert binding.bindable is False, f"{cid} ({verdict}) must never be bound by the role resolver"


# ═══════════════════════════════════════════════════════════════════════════
# ★ THE REGRESSION FENCE — the independent grader's OWN corpus, made permanent
# ═══════════════════════════════════════════════════════════════════════════
#
# WHY THIS EXISTS. The delivery above was specified by, and tested against,
# the same 26 rows. An independent grade then built a FRESH 33-input corpus
# from production-boundary inputs and measured 33.3% false-positive /
# 46.7% false-negative — and ruled the "role-aware" resolver a disguised
# keyword list with a proximity window. A resolver graded only by the rows
# that specified it can never discover that. These rows are therefore fenced
# here permanently, as a SECOND population the resolver must survive.
#
# ★ PROVENANCE — CORRECTED (advisor HIGH-3, second pass). The statement that
# stood here was FALSE and is replaced by the exact composition, which
# test_fence_corpus_provenance_statement_is_true asserts programmatically so
# it cannot drift back into a claim nobody checks.
#
# What it used to say: "the remaining 20 are drawn at runtime from the 26-row
# battery ... so this delivery cannot grade itself on inputs of its own
# choosing." Only 17 of the 20 are. The battery holds just 9 mistype rows, so
# `mistype[:9]` exhausts it, and 3 negatives are hand-written literals. The
# claim overstated the fence's independence by exactly those 3 rows.
#
# THE TRUE COMPOSITION (33 = 15 positives + 18 negatives):
#   - 13 DOCUMENTED rows: the grader's 6 false positives and 7 false
#     negatives, quoted from the grade. Load-bearing; each was a real defect
#     at ee49fdca.
#   - 17 BATTERY-DRAWN rows (8 session_teaching positives + 9
#     entry_mechanics_mistype negatives), taken at runtime from the 26-row
#     battery and its INDEPENDENT blind-grade verdicts. `sorted()[:n]`, so
#     fixed and non-cherry-picked.
#   -  3 AUTHORED-HERE negatives, written by this delivery. Named as such.
#     Drawing 20 from the battery is arithmetically impossible: it holds only
#     9 negative-verdict rows, and its other 17 rows are positives.
#
# ★ AND THE CALIBRATION CLAIM IS WITHDRAWN. The commit message for d8cf8043
# claimed this reconstruction "reproduces the grader's baseline EXACTLY
# (6/18, 7/15) at ee49fdca", offered as evidence that it is a faithful proxy
# for the grader's unseen corpus. It is not evidence. Swapping every filler
# row for pure junk strings reproduces the identical baseline, because all 13
# errors come from the 13 documented literals and the filler contributes
# zero. Exact reproduction was guaranteed by construction and could not have
# come out any other way — a control that cannot fail. It is withdrawn rather
# than replaced with a differently-shaped one; see
# test_fence_filler_is_not_load_bearing_so_no_calibration_is_claimed, which
# records the insensitivity permanently so the claim cannot be re-derived,
# and the ADVERSARIAL corpus below, which carries a control that does move.
#
# EXPECTATIONS ARE THIS DELIVERY'S RULINGS, NOT THE GRADER'S RAW WISH.
# The brief is explicit that blindly making all 15 positives bind is the
# BANNED repair. Each row therefore carries an explicit disposition and a
# reason. Where a ruling DISAGREES with the grader (one row: bare "reopen"),
# the disagreement is recorded here in the open and counted AGAINST this
# delivery in the re-measured rate below — never quietly reclassified.

# --- the 6 documented FALSE POSITIVES: must be refused outright ------------
GRADER_FALSE_POSITIVE_INPUTS = [
    # H1: bare `the\s+bell` in the anchor alternation matched ordinary prose.
    ("the bell pepper analogy I use for position sizing", "H1 bare-bell: a vegetable"),
    ("he was saved by the bell on that one", "H1 bare-bell: an idiom"),
    ("I ring the bell every time I hit my daily target", "H1 bare-bell: a personal ritual"),
    # M1: a bare timezone phrase was sufficient clock context on its own.
    ("we had a 3:00 coaching session with the mentor yesterday, eastern time", "M1 tz-only clock context"),
    # Market-object conjunct: the two weakest role markers fired on grammar alone.
    ("prior to the session I like to drink my coffee and stretch", "temporal-preposition on a morning routine"),
    ("start a new session in the terminal before running the backtest", "boundary-verb on a SHELL session"),
]

# --- the 7 documented FALSE NEGATIVES, each with an explicit disposition ---
# expected_recognized / expected_zone (None = recognized but honestly unbound;
# binding it would require inventing a window, or would emit an orphan zone).
GRADER_FALSE_NEGATIVE_INPUTS = [
    (
        "cash open",
        True,
        None,
        "★ REDESIGN sub-packet 1 (R-284 Decision A): an OPENING-BELL / cash-open "
        "ANCHOR is a clock-derived-coarse proxy (an instant contained in ny_am), "
        "NOT a closed-enum session NAME. The name-first lane refuses it — "
        "recognized session teaching, no exact window is_in_killzone evaluates. "
        "(Pre-REDESIGN it coarse-bound ny_am approximation=True; that bind failed "
        "(ii) at the family read and is now refused at the source.)",
    ),
    (
        "cash equity open",
        True,
        None,
        "Same anchor, longer form. Clock-derived-coarse → refused under name-first.",
    ),
    (
        "the New York bell",
        True,
        None,
        "NYSE opening bell qualified by a market name — still an anchor INSTANT, "
        "not an exact-window zone NAME. Recognized, refused under name-first.",
    ),
    (
        "8am",
        True,
        None,
        "A bare clock token. Under name-first (i) NO clock tokens in the name path, "
        "so this is clock-derived-coarse → refused. (Pre-REDESIGN it coarse-bound "
        "ny_am; the morphology fix stays real at the recognition layer.)",
    ),
    (
        "Asian session",
        True,
        None,
        "Morphology bug FIXED (\\basia\\b could not see 'Asian') so it is now RECOGNIZED "
        "— but deliberately NOT bound. Asian hours map to `overnight`, an ORPHAN zone "
        "is_in_killzone() can never return True for. An honest unbound beats a bind the "
        "consumer would silently ignore.",
    ),
    (
        "European open",
        True,
        None,
        "RECOGNIZED as genuine session teaching, NOT bound: no non-guessed minute "
        "constant exists for a non-NYSE open (08:00 London = 03:00 ET; 08:00 CET = "
        "02:00 ET for Frankfurt). Picking one would be the exact 'silently binds the "
        "WRONG window' failure this module refuses.",
    ),
    (
        "reopen",
        True,
        None,
        "★ RULING CORRECTED (advisor, second pass). The previous delivery refused this "
        "row outright (recognized=False) because 'the bare TOKEN reopen, alone, with no "
        "session noun' was said to be the banned repair. That reason does not survive "
        "its own siblings: '8am', 'cash open', 'cash equity open', 'the New York bell' "
        "and 'European open' are ALL bare tokens with no session noun, and this same "
        "delivery accommodates every one of them. The reason cannot be the bareness. "
        "The consistently-applicable distinction is the COMPUTABLE TIME ANCHOR: "
        "'cash open' has one (9:30 ET), 'reopen' has none — exactly like 'European "
        "open', which already sits in the recognized-but-unbound bucket. Applied "
        "consistently: recognized=True, zone=None, SESSION_TEACHING_UNBOUND_REASON.",
    ),
]

# The grader's diagnosis for this row was that `\bopens?\b` matches INSIDE
# "reopen". It does not — \b requires a boundary, and "re|open" has none. The
# defect was the opposite one (the verb list could not see the prefixed form).
# Fenced so the real mechanism cannot be re-misdiagnosed.


def test_grader_diagnosis_for_reopen_was_the_inverse_mechanism():
    import re

    assert re.search(r"\bopens?\b", "reopen") is None, (
        "the word-boundary already prevented matching inside 'reopen'; "
        "the real defect was that the verb list could not see the prefixed form"
    )
    from src.engine.spec_family_bindings import SESSION_BOUNDARY_VERB_RE

    assert SESSION_BOUNDARY_VERB_RE.search("the session reopens again") is not None


@pytest.mark.parametrize(
    ("text", "why"), GRADER_FALSE_POSITIVE_INPUTS, ids=[t[:34] for t, _ in GRADER_FALSE_POSITIVE_INPUTS]
)
def test_fence_grader_false_positives_are_refused(_role_resolver_on, text, why):
    """Each of these bound (or recognized) ordinary prose at ee49fdca. None
    may do so again. Checked at BOTH layers — recognition and the production
    binding boundary — because a resolver that 'recognizes' prose and then
    happens not to compute a zone for it is still wrong, and would start
    binding the moment a zone became computable."""
    result = classify_session_role(text)
    assert result.recognized is False, f"false positive re-opened ({why}): {text!r}"
    binding = bind_condition({"id": "fence:fp", "type": "WAIT_SESSION", "object": text, "role": "spine"})
    assert binding.bindable is False
    assert binding.session_zone is None
    assert binding.reason == "no_recognized_session_keyword"


@pytest.mark.parametrize(
    ("text", "expect_recognized", "expect_zone", "why"),
    GRADER_FALSE_NEGATIVE_INPUTS,
    ids=[t[:24] for t, _, _, _ in GRADER_FALSE_NEGATIVE_INPUTS],
)
def test_fence_grader_false_negatives_hold_their_stated_disposition(
    _role_resolver_on, text, expect_recognized, expect_zone, why
):
    """Not "these must all bind" — that is the banned repair. Each row holds
    the SPECIFIC disposition this delivery ruled for it, so a later change
    that quietly widens (binds "European open" to a guessed window) or
    quietly narrows (drops the "8am" morphology fix) both fail here."""
    result = classify_session_role(text)
    assert result.recognized is expect_recognized, f"{text!r}: {why}"
    binding = bind_condition({"id": "fence:fn", "type": "WAIT_SESSION", "object": text, "role": "spine"})
    assert binding.session_zone == expect_zone, f"{text!r}: {why}"
    if expect_zone is not None:
        assert binding.bindable is True
        assert binding.approximation is True, "S8: never approximation=False in this packet"
    else:
        assert binding.bindable is False
        if expect_recognized:
            # The recorded REASON is load-bearing, not decoration: it is what
            # distinguishes "we saw session teaching we cannot compute" from
            # "we did not see session language at all". The corrected `reopen`
            # ruling lands in this bucket by name.
            assert binding.reason == SESSION_TEACHING_UNBOUND_REASON, f"{text!r}: {why}"


def test_fence_morphology_fixes_are_real_not_incidental(_role_resolver_on):
    """The two morphology defects, exercised on realistic sentences rather
    than on the grader's bare tokens — so the fence proves the RULE changed,
    not that one string was special-cased."""
    # "Asian" is now visible to the named-session rule (\basia\b was not).
    assert classify_session_role("we mark the Asian session high and low").recognized is True
    # A prefixed boundary verb is now visible (re-?opens?).
    assert classify_session_role("price is being reset as soon as the session reopens again").recognized is True
    # ...and neither newly BINDS anything (both are honestly unbound).
    for text in ("we mark the Asian session high and low", "price is being reset as soon as the session reopens again"):
        binding = bind_condition({"id": "fence:morph", "type": "WAIT_SESSION", "object": text, "role": "spine"})
        assert binding.bindable is False
        assert binding.reason == SESSION_TEACHING_UNBOUND_REASON


# ─── H1 / M1 / H2: one named test per named defect ──────────────────────────


@pytest.mark.parametrize(
    "text",
    [
        "the bell pepper analogy I use for position sizing",
        "he was saved by the bell on that one",
        "I ring the bell every time I hit my daily target",
    ],
)
def test_h1_bare_bell_never_binds_ordinary_prose(_role_resolver_on, text):
    """H1. The anchor alternation carried a bare `the\\s+bell` while its own
    docstring claimed "Deliberately NOT 'bell' bare (would false-positive on
    unrelated prose)" — the regex contradicted its own safety claim, and
    bound a WRONG session window (ny_am) to prose.

    FAILS AT ee49fdca: all three returned bindable=True, session_zone=ny_am."""
    binding = bind_condition({"id": "h1", "type": "WAIT_SESSION", "object": text, "role": "spine"})
    assert binding.bindable is False
    assert binding.session_zone is None


def test_h1_both_calibration_fixtures_are_recognized_then_refused_under_name_first(_role_resolver_on):
    """The other half of H1. The bare-`the bell` removal is still real at the
    RECOGNITION layer (the anchor alternation still matches `opening bell` /
    `off the bell`), but ★ REDESIGN sub-packet 1 (R-284): an opening-bell anchor
    is clock-derived-coarse, not a closed-enum NAME, so the production boundary
    REFUSES both fixtures rather than coarse-binding ny_am. Recognition without a
    coarse bind is exactly the honest state the name-first lane targets."""
    from src.engine.spec_family_bindings import SESSION_ANCHOR_PHRASE_RE

    assert SESSION_ANCHOR_PHRASE_RE.search(_KNOWN_GOOD_OFF_THE_BELL) is not None
    assert SESSION_ANCHOR_PHRASE_RE.search(_KNOWN_GOOD_OPENING_BELL) is not None
    for text in (_KNOWN_GOOD_OFF_THE_BELL, _KNOWN_GOOD_OPENING_BELL):
        assert classify_session_role(text).recognized is True
        binding = bind_condition({"id": "h1:calib", "type": "WAIT_SESSION", "object": text, "role": "spine"})
        assert binding.bindable is False
        assert binding.session_zone is None
        assert binding.reason == SESSION_TEACHING_UNBOUND_REASON


def test_m1_bare_timezone_phrase_is_not_sufficient_clock_context(_role_resolver_on):
    """M1. "eastern time" is ordinary scheduling English; on its own it made
    an unrelated 3:00 into a bound london window.

    FAILS AT ee49fdca: bindable=True, session_zone=london.

    The companion assertion is what keeps the fix from being a deletion: a
    timezone marker DOES still count when the clock token is governed by a
    span preposition, so genuine inputs survive."""
    coaching = bind_condition(
        {
            "id": "m1:neg",
            "type": "WAIT_SESSION",
            "object": "we had a 3:00 coaching session with the mentor yesterday, eastern time",
            "role": "spine",
        }
    )
    assert coaching.bindable is False
    assert coaching.session_zone is None
    assert coaching.reason == "no_recognized_session_keyword", "ordinary prose is not even recognized"

    # ★ REDESIGN sub-packet 1: the timezone-governed clock path still RECOGNIZES
    # (classify_session_role unchanged), so the narrowing was not a deletion — but
    # the production boundary now REFUSES it (clock-derived-coarse), never a bind.
    genuine = bind_condition(
        {"id": "m1:pos", "type": "WAIT_SESSION", "object": "wait until 14:30 EST for the afternoon candle", "role": "spine"}
    )
    assert classify_session_role("wait until 14:30 EST for the afternoon candle").recognized is True
    assert genuine.bindable is False, "clock-derived-coarse is refused under name-first, not coarse-bound"
    assert genuine.reason == SESSION_TEACHING_UNBOUND_REASON


def test_m1_no_corpus_row_depended_on_the_bare_timezone_alternative(_role_resolver_on):
    """The measurement the fix was based on, kept as a check rather than a
    claim in a commit message: every row of the 26-row corpus that recognizes
    via a clock token still recognizes. If narrowing tier-2 context had cost
    a genuine row, this is where it would show."""
    for cid, verdict, obj in _session_ab_rows():
        if verdict != "session_teaching":
            continue
        assert classify_session_role(obj).recognized is True, f"{cid} lost recognition to the M1 narrowing"


def test_h2_24_hour_clock_times_do_not_silently_become_am(_role_resolver_on):
    """H2 (latent). `h = hour % 12` with meridiem=None mapped 14:30 -> 2:30,
    binding london where ny_pm is correct. No 24-hour token exists in the
    26-row corpus, and the inline comment justified AM-defaulting because it
    "matches every corpus row" — a rule fitted to the sample and then
    defended by the same sample.

    FAILS AT ee49fdca: session_zone == "london"."""
    from src.engine.spec_family_bindings import _session_clock_token_minutes

    # Unit level: the arithmetic itself.
    assert _session_clock_token_minutes(14, 30, None) == 14 * 60 + 30
    assert _session_clock_token_minutes(23, 0, None) == 23 * 60
    # Hours 1-12 stay genuinely ambiguous and keep the corpus-supported AM read.
    assert _session_clock_token_minutes(9, 30, None) == 9 * 60 + 30
    assert _session_clock_token_minutes(3, 0, "p.m.") == 15 * 60

    # ★ REDESIGN sub-packet 1: the H2 arithmetic fix stays real at the unit level
    # (14:30 → ny_pm, not london), and classify_session_role still DERIVES ny_pm
    # from it — but the production boundary now REFUSES the clock-derived-coarse
    # row instead of binding, so a 24-hour token can no longer silently bind the
    # WRONG (london) window either. The defect is closed at the source.
    assert classify_session_role("wait until 14:30 EST for the afternoon candle").zone == "ny_pm"
    binding = bind_condition(
        {"id": "h2", "type": "WAIT_SESSION", "object": "wait until 14:30 EST for the afternoon candle", "role": "spine"}
    )
    assert binding.bindable is False
    assert binding.session_zone is None
    assert binding.reason == SESSION_TEACHING_UNBOUND_REASON


# ─── Checklist item 8: no new orphan-zone emission, PROVEN ──────────────────


def test_role_resolver_never_emits_an_orphan_zone(_role_resolver_on):
    """Swept over every input this wave touches — the 26-row battery, all 13
    documented grader rows, and the S1 distinct-zone texts — with the flag
    ON. Not asserted from the shape of _REAL_ZONE_INTERVALS; measured from
    actual bindings at the production boundary."""
    orphans = _orphan_zone_names()
    texts = [obj for _cid, _v, obj in _session_ab_rows()]
    texts += [t for t, _ in GRADER_FALSE_POSITIVE_INPUTS]
    texts += [t for t, _, _, _ in GRADER_FALSE_NEGATIVE_INPUTS]
    texts += [t for t, _ in _S1_DISTINCT_ZONE_CASES]
    # Second pass: the adversarial population too, so the two rules added this
    # wave (meridiem-with-role, reopen-as-whole-object) are inside the sweep.
    texts += _ADVERSARIAL_PROSE_NEGATIVES + _ADVERSARIAL_MARKET_POSITIVES + ["reopen", "re-open", "reopens"]
    # THIRD PASS: the action-anchored population too, so the trading-action
    # co-factor added this wave is inside the sweep. These are the rows that
    # newly BIND, so they are exactly where a new orphan emission could appear.
    texts += _BATCH6_ACTION_POSITIVES + _BATCH6_ACTION_NEGATIVES + _BATCH6_KNOWN_FALSE_NEGATIVES
    # FOURTH PASS: the government-rule population, for the same reason — the
    # batch-7 positives are the rows that newly BIND this wave, so they are
    # exactly where a new orphan emission could appear.
    texts += (
        _BATCH7_GOVERNED_POSITIVES
        + _BATCH7_GOVERNED_NEGATIVES
        + _BATCH8_AMBIGUOUS_ACTION_NEGATIVES
        + _BATCH8_PREEXISTING_LEAKS
        + _BATCH8_KNOWN_FALSE_NEGATIVES
    )
    assert len(texts) >= 26 + 13 + 4 + 14 + 6 + 3 + 15 + 30 + 4 + 6 + 24 + 19 + 3 + 5
    # ★ REDESIGN sub-packet 1: under the name-first lane NONE of the corpus /
    # adversarial / batch texts BINDS at the production boundary (they are all
    # clock/anchor-coarse or mistype → refused). So the anti-vacuity anchor is the
    # honest NAME binds: an unambiguous closed-enum session NAME must emit a real,
    # non-orphan zone. The orphan claim must be made about a population that
    # actually reaches the zone table, and the name route is that population now.
    texts += [t for t, _ in _S1_DISTINCT_ZONE_CASES]
    emitted = set()
    newly_binding = set()
    name_texts = {t for t, _ in _S1_DISTINCT_ZONE_CASES}
    for text in texts:
        binding = bind_condition({"id": "orphan:sweep", "type": "WAIT_SESSION", "object": text, "role": "spine"})
        if binding.session_zone is not None:
            emitted.add(binding.session_zone)
            if text in name_texts:
                newly_binding.add(binding.session_zone)
    assert emitted, "sweep emitted no zones at all — vacuous"
    # ANTI-VACUITY: the honest name route must itself emit real zones, or the
    # orphan claim is about a population that never reached the zone table.
    assert newly_binding, "the name route emitted NO zone — the orphan claim is vacuous for the binding population"
    assert not (emitted & orphans), f"role resolver newly emitted orphan zone(s): {emitted & orphans}"


# ─── The re-measure: FP/FN rates on the 33-input shape, with n ──────────────


# The 3 negatives this delivery AUTHORED. Held in a named constant precisely
# so the provenance test can count them and the docstring cannot lie about
# them again. They double as the bare-am/pm fence rows.
_FENCE_AUTHORED_NEGATIVES = [
    "I am watching for the setup to form",
    "this is where I am entering the trade",
    "pm me if you want the indicator",
]


def _fence_corpus_33() -> tuple[list[str], list[str]]:
    """(positives, negatives) reconstructing the grader's 15/18 SHAPE.

    Composition — 13 documented literals + 17 battery-drawn + 3 authored
    here. See the corrected provenance block above; asserted by
    test_fence_corpus_provenance_statement_is_true. Battery selection is
    `sorted()[:n]`, i.e. fixed and non-cherry-picked, not "the ones that
    pass". No claim is made that this reconstructs the grader's actual
    inputs — the filler is demonstrably not load-bearing."""
    rows = _session_ab_rows()
    teaching = sorted(obj for _c, v, obj in rows if v == "session_teaching")
    mistype = sorted(obj for _c, v, obj in rows if v == "entry_mechanics_mistype")

    positives = [t for t, _, _, _ in GRADER_FALSE_NEGATIVE_INPUTS] + teaching[:8]
    negatives = [t for t, _ in GRADER_FALSE_POSITIVE_INPUTS] + mistype[:9] + _FENCE_AUTHORED_NEGATIVES
    return positives, negatives


def test_fence_corpus_provenance_statement_is_true():
    """★ HIGH-3. The provenance statement above is a CLAIM, so it gets an
    instrument. Every number in it is recomputed from the actual construction
    — not restated. The previous version's claim ("the remaining 20 are drawn
    from the battery") fails this test by 3 rows, which is how it should have
    been caught the first time."""
    rows = _session_ab_rows()
    battery_objects = {obj for _c, _v, obj in rows}
    positives, negatives = _fence_corpus_33()

    documented = {t for t, _ in GRADER_FALSE_POSITIVE_INPUTS} | {t for t, _, _, _ in GRADER_FALSE_NEGATIVE_INPUTS}
    assert len(documented) == 13, "the documented-defect count in the provenance statement drifted"

    all_rows = positives + negatives
    assert len(all_rows) == 33
    n_documented = sum(1 for t in all_rows if t in documented)
    n_battery = sum(1 for t in all_rows if t not in documented and t in battery_objects)
    n_authored = sum(1 for t in all_rows if t not in documented and t not in battery_objects)

    assert (n_documented, n_battery, n_authored) == (13, 17, 3), (
        f"provenance statement is FALSE: documented/battery/authored measured as "
        f"{(n_documented, n_battery, n_authored)}, statement says (13, 17, 3)"
    )
    # And the arithmetic reason 20 battery rows were never available.
    assert sum(1 for _c, v, _o in rows if v == "entry_mechanics_mistype") == 9
    assert set(_FENCE_AUTHORED_NEGATIVES).isdisjoint(battery_objects), (
        "an 'authored' row is actually a battery row — the labels are backwards"
    )


def test_fence_filler_is_not_load_bearing_so_no_calibration_is_claimed():
    """★ HIGH-3, the withdrawn calibration claim, kept as a permanent record.

    d8cf8043 claimed the reconstruction "reproduces the grader's baseline
    EXACTLY (6/18, 7/15)" and offered that as evidence of faithfulness. This
    test demonstrates why that number carried no information: replace all 20
    filler rows with pure junk strings and the classification outcome for the
    filler is IDENTICAL, because the filler contributes zero errors either
    way. Any baseline computed over this corpus is fully determined by the 13
    documented literals.

    This test asserts the number does NOT move — which is the honest finding,
    and is the opposite of a validating control. It exists so nobody re-derives
    a calibration claim from a corpus that cannot support one. The control that
    DOES move lives in the adversarial section below."""
    _, negatives = _fence_corpus_33()
    documented = {t for t, _ in GRADER_FALSE_POSITIVE_INPUTS}

    real_filler = [t for t in negatives if t not in documented]
    junk_filler = [f"zzqq junk string {i} with no session content" for i in range(len(real_filler))]
    assert len(real_filler) == 12

    with_real = sum(1 for t in real_filler if classify_session_role(t).recognized)
    with_junk = sum(1 for t in junk_filler if classify_session_role(t).recognized)
    assert with_real == with_junk == 0, (
        "if this ever changes, the filler has become load-bearing and the "
        "corpus may support a calibration claim again — re-derive it explicitly"
    )


def test_remeasured_fp_fn_rates_on_the_33_input_fence(_role_resolver_on):
    """CHECKLIST ITEM 4. The grader's baseline at ee49fdca was
    33.3% FP (6/18) / 46.7% FN (7/15). Re-measured here on the same shape.

    Scored against the GRADER'S expectation, not this delivery's rulings —
    the one row where they disagree (bare "reopen") is counted as a MISS
    against us. Scoring against our own dispositions would make this
    tautologically 0/0, which is the caption-is-a-claim failure."""
    positives, negatives = _fence_corpus_33()
    assert (len(positives), len(negatives)) == (15, 18), "corpus shape drifted from the grader's 15/18"

    false_neg = [t for t in positives if not classify_session_role(t).recognized]
    false_pos = [t for t in negatives if classify_session_role(t).recognized]

    fp_rate = len(false_pos) / len(negatives)
    fn_rate = len(false_neg) / len(positives)

    assert false_pos == [], f"FP rate {fp_rate:.1%} (n={len(negatives)}); offenders: {false_pos}"
    # `reopen` was the one openly-recorded remaining miss at d8cf8043. The
    # advisor ruled that refusal inconsistent with its own siblings, so it is
    # now recognized-but-unbound and the fence is clean on this corpus.
    #
    # ★ READ THIS BEFORE TRUSTING THE 0.0%/0.0%. This corpus is 13 documented
    # defect rows plus non-load-bearing filler; a resolver graded only on the
    # defects it was told about will always score 0. That is exactly the trap
    # d8cf8043 fell into — it scored 0.0% FP here and 60% on the grader's
    # fresh inputs. The number below is a REGRESSION check (these 13 specific
    # defects have not returned), NOT a fidelity measurement.
    assert false_neg == [], f"FN rate {fn_rate:.1%} (n={len(positives)}); misses: {false_neg}"
    assert fp_rate == 0.0
    assert fn_rate == 0.0


# ─── The ADVERSARIAL corpus: authored blind, WITH a control that moves ───────
#
# Written while fixing HIGH-1/HIGH-2, before running any of it, against no
# fence — ordinary prose carrying clocks, timezones, and session/bell words as
# filler. It is not independent (this delivery wrote it) and is not claimed to
# be. Its value is that it is the population the d8cf8043 pass had NO inputs
# from, which is why that pass could not see the FP class it manufactured.

_ADVERSARIAL_PROSE_NEGATIVES = [
    "garbage pickup is at 8 a.m. on Thursdays",
    "my dentist appointment is at 2:30 p.m.",
    "we had a 3:00 p.m. coaching session with the mentor yesterday",
    "the kids get home from school at 3:15 p.m. every day",
    "I usually go to the gym at 6am before work",
    "dinner reservation is at 7:30 p.m. downtown",
    "my flight lands at 11:45 p.m. eastern time",
    "the podcast drops every Tuesday at 9am",
    "call me back at 5pm if you get a chance",
    "the library closes at 8 p.m. on weekends",
    "standup is at 9:30 a.m. and retro is at 4 p.m.",
    "he was born at 2:15 a.m. in a snowstorm",
    "my therapy session runs from 4 to 5pm on Mondays",
    "the school bell rings at 8am sharp",
]

_ADVERSARIAL_MARKET_POSITIVES = [
    "enter on the 9:30 a.m. candle after the open",
    "wait for the 10 a.m. reversal before taking the trade",
    "I only take entries between 8am and 11am on the chart",
    "the 3 p.m. candle usually sweeps the prior high",
    "look for a fair value gap after 2 p.m.",
    "no trades after 11:30 a.m., price goes dead",
]


@pytest.mark.parametrize("text", _ADVERSARIAL_PROSE_NEGATIVES)
def test_high1_ordinary_prose_with_a_meridiem_clock_is_refused(_role_resolver_on, text):
    """★ HIGH-1. `has_meridiem` ALONE satisfied clock context at d8cf8043 — no
    market naming, no session noun, no market object required. Ordinary prose
    carrying a meridiem clock scored 14/14 recognized here, 8 of them SILENTLY
    BINDING a real killzone window ("garbage pickup is at 8 a.m. on Thursdays"
    -> ny_am, "my dentist appointment is at 2:30 p.m." -> ny_pm).

    Checked at BOTH layers: a resolver that recognizes prose and merely happens
    not to compute a zone for it is still wrong, and starts binding the moment
    a zone becomes computable."""
    assert classify_session_role(text).recognized is False, f"false positive: {text!r}"
    binding = bind_condition({"id": "adv:neg", "type": "WAIT_SESSION", "object": text, "role": "spine"})
    assert binding.bindable is False
    assert binding.session_zone is None, f"SILENTLY BOUND {binding.session_zone!r}: {text!r}"


@pytest.mark.parametrize("text", _ADVERSARIAL_MARKET_POSITIVES)
def test_high1_genuine_market_teaching_with_a_meridiem_clock_still_binds(_role_resolver_on, text):
    """The other polarity, and the one a recall-destroying "fix" would break.
    Every row carries a meridiem clock AND a market object, so the narrowed
    rule must leave all of them recognized. Without this test, deleting the
    meridiem path outright would pass the negatives above."""
    assert classify_session_role(text).recognized is True, f"lost a genuine teaching: {text!r}"


def test_high2_colonless_token_still_works_and_the_discriminator_is_role_not_morphology(_role_resolver_on):
    """★ HIGH-2. The colon-less alternative was charged with manufacturing 4
    new false positives ("5pm", "8 p.m.", "4 p.m."). The charge misidentifies
    the cause, and this test records the evidence.

    THE DISCRIMINATOR IS ROLE, NOT MORPHOLOGY. Deleting the colon-less form
    would (a) re-break "8am", and (b) fix nothing, because COLON-FUL prose
    false-bound just as hard — 5 of the 8 silent binds at d8cf8043 came from
    "2:30 p.m.", "3:00 p.m.", "3:15 p.m.", "9:30 a.m." and "2:15 a.m.". The
    colon-less alternative did not CAUSE the FP class; it made more prose
    visible to an already-unsound sufficiency rule.

    So the colon-less form STAYS and the role test removes both classes."""
    # (a) the morphology fix is intact at the RECOGNITION layer — bare "8am" is
    # still SEEN. ★ REDESIGN sub-packet 1: it no longer BINDS (a clock token is
    # clock-derived-coarse, refused under name-first), so the fix is proven where
    # it lives (recognition) without a coarse ny_am bind at the production boundary.
    assert classify_session_role("8am").recognized is True
    binding = bind_condition({"id": "h2:8am", "type": "WAIT_SESSION", "object": "8am", "role": "spine"})
    assert binding.bindable is False
    assert binding.reason == SESSION_TEACHING_UNBOUND_REASON

    # (b) colon-less prose is refused...
    for text in ("call me back at 5pm if you get a chance", "the library closes at 8 p.m. on weekends"):
        assert classify_session_role(text).recognized is False, text
    # ...and so is COLON-FUL prose, which deleting the colon-less form could
    # never have reached. This is the load-bearing half of the diagnosis.
    for text in ("my dentist appointment is at 2:30 p.m.", "he was born at 2:15 a.m. in a snowstorm"):
        assert classify_session_role(text).recognized is False, text


# Batches 3 and 4, authored AFTER the rule was drafted and run against it for
# the first time only when complete. Batch 3 broke the then-current draft (5
# leaks); batch 4 broke its successor (10 leaks). Both are kept permanently —
# a fence that only contains inputs the rule already passes is the exact
# instrument failure this whole second pass exists to correct.
_ADVERSARIAL_BATCH34_NEGATIVES = [
    # batch 3 — ambiguous market words in ordinary senses
    "the trade show opens at 9 a.m. in the convention center",
    "she sweeps the kitchen floor at 6 a.m. before anyone wakes",
    "his sleep patterns changed after the baby arrived at 3 a.m.",
    "the farmers market opens at 7 a.m. every Saturday",
    "my recording session with the band starts at 8 p.m.",
    "the bar closes at 2 a.m. on Fridays",
    "the tide levels peak around 5 a.m. near the harbour",
    "the London Underground closes at 1 a.m.",
    "New York pizza is best at 2 a.m.",
    "the class session before lunch runs long",
    "traffic entries onto the highway back up at 8 a.m.",
    "the shop reopens at 10 a.m. after renovations",
    "volume on the radio was too high at 7 a.m.",
    # batch 4 — TWO distinct ambiguous words, and unambiguous words in
    # non-market senses. These are what killed the lexicon approach outright.
    "the bar orders more stock at 10 a.m. every Monday",
    "long lines at the DMV start forming at 8 a.m.",
    "we buy and sell furniture at the market at 9 a.m.",
    "the trade entries in the ledger were logged at 2 p.m.",
    "traffic patterns and volume shift around 4 p.m. downtown",
    "her position and salary range were settled at 11 a.m.",
    "the birthday candles were lit at 7 p.m.",
    "the liquidity of the estate was settled at 3 p.m.",
    "he charts his workouts at 6 a.m. daily",
    "the setup crew arrives at 5 a.m. to build the stage",
    "the new session at the spa opens at 9 a.m.",
    "this session of congress opens in January",
]


@pytest.mark.parametrize("text", _ADVERSARIAL_BATCH34_NEGATIVES)
def test_no_recognition_leak_on_batches_three_and_four(_role_resolver_on, text):
    """★ THE SOFT-FP AXIS. A recognition leak counts as a false positive even
    when no zone binds — nothing in the RULE rejected it, the window table did,
    by arithmetic. Widen that table, or feed it a clock that lands inside a
    window, and the leak becomes a silent wrong-window bind. So this asserts
    the RECOGNITION verdict, and the zone only as a second line."""
    assert classify_session_role(text).recognized is False, f"recognition leak: {text!r}"
    binding = bind_condition({"id": "b34", "type": "WAIT_SESSION", "object": text, "role": "spine"})
    if resolve_session_keyword(text) is None:
        assert binding.session_zone is None
    else:
        # This row is bound by the LEGACY keyword matcher, which runs BEFORE
        # the role resolver is ever consulted — see the dedicated test below.
        # Not this delivery's path, and asserting None here would falsely
        # attribute a pre-existing defect to the resolver.
        assert binding.session_zone == resolve_session_keyword(text)


_LEGACY_RESOLVER_FALSE_POSITIVES = [
    ("the London session of parliament was televised", "london"),
]


@pytest.mark.parametrize(("text", "zone"), _LEGACY_RESOLVER_FALSE_POSITIVES)
def test_found_not_fixed_legacy_keyword_resolver_binds_ordinary_prose(monkeypatch, text, zone):
    """★ A DEFECT FOUND AND NOT FIXED, recorded rather than left silent.

    While building the adversarial batches, two rows turned out to bind
    ordinary prose through `resolve_session_keyword()` — the ORIGINAL bare
    keyword matcher, not the role resolver. It runs first; the role resolver is
    only consulted when it returns None (see _bind_condition_dispatch). So
    these binds happen with the feature flag OFF, are untouched by everything
    that delivery changed, and cannot be cured from inside classify_session_role.

    "the London session of parliament was televised" -> london is a genuine
    wrong-window bind of the kind this module says it refuses. STILL OPEN.

    ★ THE SECOND ROW IS NOW FIXED and has moved to its own test below: "the
    class session before lunch runs long" -> lunch_blackout was an ORPHAN zone
    emission, which the orphan-zone closure retired. It is asserted as fixed
    rather than deleted, so the receipt survives the cure.

    Pinned flag-OFF so it is provably the legacy path, and so that whoever owns
    that lane inherits a failing-visible receipt instead of a paragraph."""
    monkeypatch.delenv("TF_SESSION_ROLE_RESOLVER_ENABLED", raising=False)
    assert resolve_session_keyword(text) == zone
    binding = bind_condition({"id": "legacy:fp", "type": "WAIT_SESSION", "object": text, "role": "spine"})
    assert binding.session_zone == zone, "if this changed, the legacy defect moved — re-scope the note above"
    # ...and the role resolver, this delivery's surface, correctly refuses it.
    assert classify_session_role(text).recognized is False


def test_found_and_now_fixed_legacy_orphan_zone_leak_on_ordinary_prose(monkeypatch):
    """★ THE OTHER HALF OF THE RECEIPT ABOVE, CLOSED.

    "the class session before lunch runs long" used to bind an orphan zone
    through the legacy bare-keyword matcher, with the flag OFF. The orphan-zone
    closure removed the emission, so this ordinary prose no longer binds
    anything — and, because the refusal is recorded rather than silent, the
    reason still names what was declined.

    Kept as a test (not deleted with the defect) so a regression is loud."""
    monkeypatch.delenv("TF_SESSION_ROLE_RESOLVER_ENABLED", raising=False)
    text = "the class session before lunch runs long"
    assert resolve_session_keyword(text) is None
    binding = bind_condition({"id": "legacy:fp", "type": "WAIT_SESSION", "object": text, "role": "spine"})
    assert binding.bindable is False
    assert binding.session_zone is None
    assert binding.reason.startswith("session_zone_refused_uncomputable_window:")
    assert classify_session_role(text).recognized is False


# Batch 5 — written last, aimed squarely at the SELECTION forms the does-work
# rule newly TRUSTS (span prepositions, attributive chart nouns,
# demonstratives, timezone+preposition). It found 2 leaks in 16; one is fixed
# (tier 2 now requires market context), one is pinned below as irreducible.
_ADVERSARIAL_BATCH5_NEGATIVES = [
    "the store is open from 9 a.m. to 5 p.m. on weekdays",
    "please arrive before 8 a.m. for the blood test",
    "the sale runs between 10 a.m. and 2 p.m. this Saturday",
    "don't call after 9 p.m. because the kids are asleep",
    "the buffet is served until 11 a.m. every morning",
    "I work from 8 a.m. to 4 p.m. at the warehouse",
    "the parking meter is enforced between 8 a.m. and 6 p.m.",
    "the 6 a.m. bars on the radio play the news",
    "the 9 a.m. session at the dentist got moved",
    "the 5 p.m. close of the museum is strict",
    "the 8 a.m. entry to the park costs five dollars",
    "this one at 3 p.m. is the cheaper flight",
    "that bar at 10 p.m. gets crowded",
    "the webinar runs from 2:00 p.m. until 3:00 p.m. eastern time",
    "my shift starts at 14:30 EST and ends at 23:00",
]


@pytest.mark.parametrize("text", _ADVERSARIAL_BATCH5_NEGATIVES)
def test_no_recognition_leak_on_batch_five_selection_forms(_role_resolver_on, text):
    """Batch 5. Ordinary prose CAN use selection grammar — a store's opening
    hours are a genuine span. What keeps these out is the market-context
    conjunct, which every clock path now carries; the webinar row proved tier 2
    was the one path that did not."""
    assert classify_session_role(text).recognized is False, f"recognition leak: {text!r}"
    binding = bind_condition({"id": "b5", "type": "WAIT_SESSION", "object": text, "role": "spine"})
    assert binding.session_zone is None


def test_known_residual_leak_attributive_chart_noun_in_non_market_prose(_role_resolver_on):
    """★ AN UNFIXED DEFECT, pinned so it is visible in the suite.

    "we lit the 7 p.m. CANDLES for the vigil" is recognized. It is
    grammatically IDENTICAL to the core positive "the 9:30 a.m. CANDLE" — a
    time attached attributively to a chart noun — and differs only in what the
    surrounding sentence is about. No rule available at this layer separates
    them; refusing it would refuse the single most important genuine pattern
    this resolver exists to catch.

    It is a SOFT leak today (7 p.m. = 1140 min falls outside all five
    computable windows, so nothing binds) — but that is arithmetic, not the
    rule, which is exactly the latent-hard-FP shape. Were a zone ever to cover
    19:00, this would become a silent wrong-window bind.

    Stated plainly rather than fixed, and pinned so that any change in its
    status is a test event."""
    assert classify_session_role("we lit the 7 p.m. candles for the vigil").recognized is True
    binding = bind_condition(
        {"id": "residual", "type": "WAIT_SESSION", "object": "we lit the 7 p.m. candles for the vigil", "role": "spine"}
    )
    assert binding.session_zone is None, "the residual leak has become a HARD false positive — escalate"


_KNOWN_FALSE_NEGATIVES_OF_THE_DOES_WORK_RULE = [
    "the trendline break at 8:30 a.m. is the trigger",
    "wait for a bullish engulfing at 8:15 a.m.",
    "watch the fair value gap fill around 2:15 p.m.",
    "I take the setup at 10:30 a.m.",
]


@pytest.mark.parametrize("text", _KNOWN_FALSE_NEGATIVES_OF_THE_DOES_WORK_RULE)
def test_known_false_negatives_of_the_does_work_rule(_role_resolver_on, text):
    """★ THE PRICE OF THE FIX, asserted rather than described.

    Every row here is GENUINE market teaching that this delivery now MISSES,
    because its clock is a bare mention ("at 8:15 a.m.", "around 2:15 p.m.")
    rather than a selection. _session_clock_does_work cannot tell them from
    "he charts his workouts at 6 a.m." or "the birthday candles were lit at 7
    p.m.", which are the same grammar with different nouns.

    They are pinned as failing ON PURPOSE, so the cost is visible in the suite
    instead of living in a commit message. If a later change recovers one, this
    test fails and the recovery must be re-justified — and if a later change
    recovers it by re-admitting bare mentions, the batch-3/4 fence above fails
    at the same time. The two tests are each other's control.

    Direction is deliberate: "a miss is honest, a false positive silently binds
    the WRONG window.\""""
    assert classify_session_role(text).recognized is False, (
        f"{text!r} now recognizes — if that is intended, verify the batch-3/4 "
        "leak fence still passes and move this row out with a stated reason"
    )


def test_adversarial_control_the_measurement_actually_moves(_role_resolver_on):
    """★ HIGH-3's replacement control — a perturbation proof that DOES move.

    The withdrawn calibration claim failed because swapping its inputs changed
    nothing. This one perturbs the RESOLVER: it loads d8cf8043's module from
    git and runs the identical measurement through it. If this instrument were
    non-discriminating (measuring something the fix cannot affect), both sides
    would report the same number. They do not — that difference IS the fix.

    d8cf8043 measured 14/14 FP on these negatives; today measures 0/14, with
    the positives unchanged at 0 FN in both. A control that can distinguish
    two module versions can also catch a regression back to either."""
    old = _load_module_at_ref("d8cf8043")
    assert hasattr(old, "classify_session_role"), "d8cf8043 must already contain the resolver"

    def fp_count(module):
        return sum(1 for t in _ADVERSARIAL_PROSE_NEGATIVES if module.classify_session_role(t).recognized)

    def fn_count(module):
        return sum(1 for t in _ADVERSARIAL_MARKET_POSITIVES if not module.classify_session_role(t).recognized)

    import src.engine.spec_family_bindings as today

    old_fp, new_fp = fp_count(old), fp_count(today)
    assert new_fp == 0, f"false positives on ordinary prose: {new_fp}/{len(_ADVERSARIAL_PROSE_NEGATIVES)}"
    assert old_fp == len(_ADVERSARIAL_PROSE_NEGATIVES), (
        f"expected d8cf8043 to false-positive on ALL {len(_ADVERSARIAL_PROSE_NEGATIVES)} prose rows, got {old_fp} "
        "— if this drops, the control is no longer measuring the defect it claims to"
    )
    assert old_fp != new_fp, "THE CONTROL DID NOT MOVE — this measurement cannot detect the defect it grades"
    # Recall was not traded away to buy that: no positive was lost either side.
    assert fn_count(old) == fn_count(today) == 0

    # And the silent-bind count, the failure that actually matters, at the
    # production boundary rather than the recognition layer.
    def silent_binds(module):
        return sum(
            1
            for t in _ADVERSARIAL_PROSE_NEGATIVES
            if module.bind_condition({"id": "c", "type": "WAIT_SESSION", "object": t, "role": "spine"}).session_zone
        )

    assert silent_binds(old) == 8, "the recorded d8cf8043 silent-bind count changed"
    assert silent_binds(today) == 0


# ─── M3: S7 as a TRUE parent-diff, not a hand-copied expectation ────────────


_PREPACKET_REF = "ee49fdca~1"
_MODULE_REL_PATH = "src/engine/spec_family_bindings.py"


def _load_prepacket_module():
    """Load the module AS IT WAS before the packet landed, straight from git."""
    return _load_module_at_ref(_PREPACKET_REF)


def _load_module_at_ref(ref: str):
    """Load any historical revision of the module straight from git.

    This is what makes S7 a differential instead of an assertion, and what
    lets the adversarial control above compare two module versions rather
    than assert a hand-copied number. The module is stdlib-only by deliberate
    design (its "zero import surface" property, documented in its own
    header), which is precisely what makes exec'ing a historical revision of
    it safe and dependency-free."""
    import importlib.util
    import subprocess

    try:
        source = subprocess.run(
            ["git", "show", f"{ref}:{_MODULE_REL_PATH}"],
            cwd=os.path.dirname(os.path.abspath(__file__)),
            capture_output=True,
            text=True,
            timeout=30,
        )
    except (OSError, subprocess.SubprocessError) as exc:  # pragma: no cover
        pytest.skip(f"git unavailable for parent-diff: {exc}")
    if source.returncode != 0 or not source.stdout.strip():
        pytest.skip(f"revision {ref} unavailable: {source.stderr.strip()[:200]}")

    import sys

    name = f"_gitref_spec_family_bindings_{re.sub(r'[^A-Za-z0-9_]', '_', ref)}"
    spec = importlib.util.spec_from_loader(name, loader=None)
    module = importlib.util.module_from_spec(spec)
    # @dataclass resolves string annotations via sys.modules[cls.__module__],
    # so the module must be registered BEFORE its body executes.
    sys.modules[name] = module
    try:
        exec(compile(source.stdout, f"<{_PREPACKET_REF}:{_MODULE_REL_PATH}>", "exec"), module.__dict__)
    except Exception:
        sys.modules.pop(name, None)
        raise
    return module


def test_m3_prepacket_module_really_is_pre_packet():
    """Anti-vacuity for the differential below: if the loaded revision
    already had the resolver, the diff would be comparing the change to
    itself and would pass no matter what."""
    prepacket = _load_prepacket_module()
    assert not hasattr(prepacket, "classify_session_role"), (
        f"{_PREPACKET_REF} already contains the role resolver — the parent-diff is vacuous"
    )
    assert hasattr(prepacket, "bind_condition"), "pre-packet module missing the production entry point"


def test_m3_s7_flag_off_is_byte_identical_to_the_parent_commit(monkeypatch):
    """★ M3 FIX. S7 previously HARDCODED the expected pre-packet result
    (bindable=False / reason=no_recognized_session_keyword / zone=None /
    approximation=False) and called that "PROVEN, not asserted". It was
    correct-but-hand-copied — a fabricated safety-claim on a boundary, since
    nothing in the test actually consulted the parent.

    This runs the ACTUAL parent revision of the module and diffs its
    bind_condition() output field-by-field against today's, flag OFF, over
    the full 26-row population. If the flag-off path ever drifts, the parent
    itself is the witness."""
    monkeypatch.delenv("TF_SESSION_ROLE_RESOLVER_ENABLED", raising=False)
    prepacket = _load_prepacket_module()

    rows = _session_ab_rows()
    assert len(rows) == 26
    mismatches = []
    for cid, _verdict, obj in rows:
        condition = {"id": cid, "type": "WAIT_SESSION", "object": obj, "role": "spine"}
        before = prepacket.bind_condition(dict(condition)).to_dict()
        after = bind_condition(dict(condition)).to_dict()
        if before != after:
            mismatches.append((cid, before, after))
    assert mismatches == [], f"flag-OFF drift vs {_PREPACKET_REF}: {mismatches[:3]}"


def test_m3_parent_diff_would_catch_a_flag_off_regression(monkeypatch):
    """The differential's own control. A diff that passes is only meaningful
    if it CAN fail — so flip the flag ON and confirm the same comparison
    reports drift. Without this, a broken loader that silently returned the
    current module would look identical and green."""
    monkeypatch.setenv("TF_SESSION_ROLE_RESOLVER_ENABLED", "true")
    prepacket = _load_prepacket_module()

    drifted = 0
    for cid, _verdict, obj in _session_ab_rows():
        condition = {"id": cid, "type": "WAIT_SESSION", "object": obj, "role": "spine"}
        if prepacket.bind_condition(dict(condition)).to_dict() != bind_condition(dict(condition)).to_dict():
            drifted += 1
    assert drifted > 0, (
        "flag ON produced ZERO differences from the parent commit — the resolver is inert, "
        "or the parent-diff instrument is comparing the module to itself"
    )


# ════════════════════════════════════════════════════════════════════════════
# THIRD PASS — the market-ness can live in the VERB, not only in a NOUN
# ════════════════════════════════════════════════════════════════════════════
#
# The second pass fixed a real mechanism (the clock must DO WORK) and cut false
# positives 38.0% -> 6.0%, recognition-leak axis 74.0% -> 6.0%. It over-
# corrected on the other axis: false negatives 0% -> 61.9%. Thirteen genuine
# session teachings, independently adjudicated by two blind judges (unanimous,
# calibrated 15/15 and 12/12 on control rows), were being rejected.
#
# Every one shares a shape: the clock genuinely does work AND the sentence
# commands an explicit trading action — but it names no instrument and no chart
# object, so the market-context co-factor (a NOUN lexicon) refused it.
#
# THE TRAP, and why a verb list would have failed exactly as the four noun
# lexicons did: ordinary life also has verbs and clock times. "The kids need to
# be at daycare BY 8 a.m." and "we EXIT the highway before 8 a.m." are verb +
# a clock that does work. The discriminator is not that a verb is present but
# WHAT THE VERB ACTS UPON. Being somewhere by a time is not a trading action;
# being FLAT by a time is.
#
# Batch 6 below was authored and frozen to disk BEFORE the rule was written,
# aimed squarely at that trap: every negative carries a verb AND a span
# preposition, so every one already passes _session_clock_does_work at
# 6dd3a00f and is held out ONLY by the co-factor this pass loosens. It broke
# the first draft of construction (C) — see
# test_batch6_objectless_gerund_is_a_frame_test_not_a_blacklist.

_BATCH6_ACTION_NEGATIVES = [
    # ordinary life: a verb, and a clock that genuinely delimits
    "the kids need to be at daycare by 8 a.m. or they miss breakfast",
    "we need to board the ferry by 7:20 a.m. and it does not wait",
    "close the store by 9 p.m. and set the alarm",
    "hold the elevator until 8:15 a.m. so the movers can load",
    "enter the building before 9 a.m. or the badge reader locks you out",
    "cut the cake before 3 p.m. right after the toast",
    "open the shop by 6 a.m. and start the coffee",
    "drop the dog at daycare by 7:30 a.m. and pick her up after 5 p.m.",
    "let the dough rest until 4 p.m. before you shape it",
    "we exit the highway before 8 a.m. to avoid the toll",
    "watch the kids until 3 p.m. and do not let them near the pool",
    "do not touch the thermostat until 7 a.m.",
    "stop by the pharmacy before 8 p.m.",
    "take the medication before 9 a.m. with food",
    "he sells produce at the stand from 6 a.m. until noon",
    "settle the account before 3 p.m. to avoid a fee",
    # ── the traps aimed at each construction ──
    # (A) "flat" in its ordinary English adverbial idioms
    "the movers will be flat out until 6 p.m.",
    "we will be flat broke by 5 p.m. at this rate",
    "I will be flat on my back until 10 a.m. with this flu",
    "the flat we rent goes to the agent before 10 a.m.",
    # (B) a foreign qualifier between the verb and the position noun
    "add to the grocery order before 6 p.m. or it ships without it",
    "we scale the recipe up before 5 p.m. so it is ready",
    "hold my spot in line until 11 a.m.",
    "we hold the deposit until 4 p.m. the next business day",
    # (B) noun BEFORE verb — no government relation
    "the position we advertised closes at 5 p.m. on Friday",
    # (B) the position word is only an attributive modifier of a foreign head
    "the entry fee doubles after 8 p.m.",
    "the contract cleaners finish before 6 a.m.",
    "close the ticket by 4 p.m. or it escalates",
    # (C) a transitive trade-verb with a real object
    "trade in your old phone before 5 p.m. for the discount",
    "we stopped trading baseball cards after 3 p.m.",
]

_BATCH6_ACTION_POSITIVES = [
    # genuine teachings whose market-ness lives ENTIRELY in the verb —
    # no instrument, no exchange, no chart noun, no "session" word.
    "be flat by 3:50 p.m., no exceptions",
    "flatten everything before 3:50 p.m.",
    "close every position by 11 a.m.",
    "no trading until 9:30 a.m.",
    "I only take one trade and I am done by 11 a.m.",
    "exit all positions before 4 p.m.",
    "stop trading after 11:30 a.m.",
    "get flat before 2 p.m. ahead of the announcement",
    "cut the trade before 10 a.m. if it has not moved",
    "do not add to the position after 3 p.m.",
    "scale out before 11 a.m. and let the runner go",
    "hold your entries until after 10 a.m.",
    "I am only watching, not trading, until 10 a.m.",
    "close the runners by 3:45 p.m.",
    "avoid trading between 12 p.m. and 1 p.m.",
]


@pytest.mark.parametrize("text", _BATCH6_ACTION_NEGATIVES)
def test_batch6_ordinary_life_verb_plus_working_clock_is_still_refused(_role_resolver_on, text):
    """★ THE PROHIBITED REGRESSION, fenced. "If your change raises false
    positives, it has failed regardless of what it does to false negatives."

    Every row here would be admitted by a naive "verb + clock => bind" rule.
    Asserted at BOTH layers, same discipline as the second pass: a resolver
    that recognizes prose and merely happens not to compute a zone is still
    wrong, and starts binding the moment a zone becomes computable."""
    assert classify_session_role(text).recognized is False, f"false positive: {text!r}"
    binding = bind_condition({"id": "b6:neg", "type": "WAIT_SESSION", "object": text, "role": "spine"})
    assert binding.bindable is False
    assert binding.session_zone is None, f"SILENTLY BOUND {binding.session_zone!r}: {text!r}"


@pytest.mark.parametrize("text", _BATCH6_ACTION_POSITIVES)
def test_batch6_action_anchored_teachings_now_bind(_role_resolver_on, text):
    """★ THE CLASS THIS PASS ADMITS. The other polarity of the same rule."""
    assert classify_session_role(text).recognized is True, f"still missing a genuine teaching: {text!r}"


def test_batch6_what_the_new_rule_admits_that_6dd3a00f_did_not(_role_resolver_on):
    """★ CHECKLIST ITEM 2 — the standing obligation: for each rule change,
    state what it now ADMITS that it did not before, and TEST that class.

    This is the differential, run against 6dd3a00f's actual module loaded from
    git rather than against a hand-copied number. It asserts three things at
    once, and the third is the one that makes it a control rather than a
    caption:

      1. Exactly 14 of the 15 action-anchored positives were REJECTED by
         6dd3a00f and are ADMITTED now — that measured set IS the class this
         pass adds, and it is computed here rather than asserted from memory.
      2. Exactly ONE row was already admitted at 6dd3a00f and is named, so the
         "what it now admits" claim is not inflated by a row it did not win.
         "stop trading after 11:30 a.m." carries TWO distinct ambiguous market
         nouns ("stop", "trading"), so _session_is_about_markets already
         satisfied the co-factor for it by the noun path.
      3. BOTH versions reject all 30 ordinary-life negatives — so the recall
         was NOT bought with false positives. If a future change buys recall by
         re-admitting prose, this assertion fails before the recall one does.

    If the instrument were non-discriminating, (1) would measure zero."""
    old = _load_module_at_ref("6dd3a00f")
    assert hasattr(old, "classify_session_role"), "6dd3a00f must already contain the resolver"
    import src.engine.spec_family_bindings as today

    old_admits = [t for t in _BATCH6_ACTION_POSITIVES if old.classify_session_role(t).recognized]
    new_admits = [t for t in _BATCH6_ACTION_POSITIVES if today.classify_session_role(t).recognized]
    newly = [t for t in new_admits if t not in old_admits]

    assert old_admits == ["stop trading after 11:30 a.m."], (
        "the set of rows already admitted at 6dd3a00f drifted — the 'what this pass admits' "
        f"count must be re-derived. Measured: {old_admits}"
    )
    assert len(new_admits) == len(_BATCH6_ACTION_POSITIVES), (
        f"admitted only {len(new_admits)}/{len(_BATCH6_ACTION_POSITIVES)}: "
        f"{[t for t in _BATCH6_ACTION_POSITIVES if t not in new_admits]}"
    )
    assert len(newly) == 14, f"the newly-admitted class measured {len(newly)}, not 14: {newly}"
    assert old_admits != new_admits, "THE CONTROL DID NOT MOVE"

    # ...and the FP axis did not move in the wrong direction on the same batch.
    old_fp = [t for t in _BATCH6_ACTION_NEGATIVES if old.classify_session_role(t).recognized]
    new_fp = [t for t in _BATCH6_ACTION_NEGATIVES if today.classify_session_role(t).recognized]
    assert old_fp == [], f"6dd3a00f leaked on batch 6 negatives (pre-existing): {old_fp}"
    assert new_fp == [], f"★ THE PROHIBITED REGRESSION — this pass added false positives: {new_fp}"


def test_batch6_the_second_pass_fp_fences_are_all_still_green(_role_resolver_on):
    """★ THE PRESERVATION CLAIM, measured rather than asserted.

    The second pass's win must not be undone. Every adversarial negative it
    authored — batches 3, 4, 5 and the HIGH-1 prose rows, 54 in total — is
    re-run here as ONE aggregate assertion, so that "the FP win held" is a
    single measured number in this pass's own suite rather than an inference
    from other tests happening to pass."""
    inherited = _ADVERSARIAL_PROSE_NEGATIVES + _ADVERSARIAL_BATCH34_NEGATIVES + _ADVERSARIAL_BATCH5_NEGATIVES
    assert len(inherited) == 54, "the inherited negative population changed size — re-derive this claim"
    leaks = [t for t in inherited if classify_session_role(t).recognized]
    assert leaks == [], f"THIRD PASS BROKE THE SECOND PASS'S FP WIN on {len(leaks)}/54 rows: {leaks}"

    # And the second pass's genuine positives are all still bound.
    lost = [t for t in _ADVERSARIAL_MARKET_POSITIVES if not classify_session_role(t).recognized]
    assert lost == [], f"lost inherited positives: {lost}"


def test_batch6_neither_half_of_a_construction_fires_alone(_role_resolver_on):
    """★ THE ANTI-LEXICON PROOF. "Do not solve this by adding a verb lexicon
    and stopping." This asserts the rule is a CONSTRUCTION test — a predicate
    together with its argument, in a specific order and adjacency — by showing
    that each half in isolation is refused.

    Four lexicon drafts failed on the noun side. A verb list would fail the
    same way; what makes this different is that no member of any set below can
    fire on its own."""
    from src.engine.spec_family_bindings import (
        _SESSION_ACTION_ON_POSITION_RE,
        _SESSION_POSITION_STATE_RE,
        _session_has_trading_action,
    )

    # (B) transaction VERB alone, with a working clock — refused.
    for verb_only in ("close the store by 9 p.m.", "hold the elevator until 8:15 a.m.", "cut the cake before 3 p.m."):
        assert _SESSION_ACTION_ON_POSITION_RE.search(verb_only) is None, verb_only
        assert classify_session_role(verb_only).recognized is False, verb_only

    # (B) position NOUN alone, and the same noun with the verb in the WRONG
    # ORDER — both refused. Government is directional.
    for noun_only in (
        "her position and salary were settled before 11 a.m.",
        "the position we advertised closes at 5 p.m.",
    ):
        assert _SESSION_ACTION_ON_POSITION_RE.search(noun_only) is None, noun_only
        assert classify_session_role(noun_only).recognized is False, noun_only

    # ...but together, in order, they fire.
    assert _SESSION_ACTION_ON_POSITION_RE.search("close every position by 11 a.m.") is not None

    # (A) "flat" as a NOUN (determiner, not a copula complement) — refused;
    # "flat" as a predicative complement — fires. Same word, different frame.
    assert _SESSION_POSITION_STATE_RE.search("the flat we rent goes to the agent") is None
    assert _SESSION_POSITION_STATE_RE.search("be flat by 3:50 p.m.") is not None

    # And the whole co-factor is inert on text with neither construction.
    assert _session_has_trading_action("the kids need to be at daycare by 8 a.m.") is False


def test_batch6_objectless_gerund_is_a_frame_test_not_a_blacklist(_role_resolver_on):
    """★ A DRAFT DEFECT, recorded rather than quietly fixed.

    Construction (C) was FIRST implemented as a blacklist of object heads
    (`cards`, `places`, `shows`...). The pre-registered adversarial "we stopped
    trading BASEBALL CARDS after 3 p.m." walked straight through it and bound
    ny_pm — the head noun sat two words past the gerund, and no blacklist of
    heads ever closes that gap. That is the same failure mode as the four noun
    lexicons, reproduced on the verb side, which is exactly what the packet
    warned would happen.

    Replaced by a FRAME test: what follows the gerund must be a clause boundary
    or a function word, never the start of a noun phrase. This test pins both
    polarities of that distinction."""
    from src.engine.spec_family_bindings import _SESSION_NEGATED_TRADING_RE

    # Transitive uses — an object follows, at distance 1 and at distance 2.
    for transitive in (
        "we stopped trading baseball cards after 3 p.m.",
        "don't trade places before 4 p.m.",
        "we stopped trading vintage comic books after 3 p.m.",
    ):
        assert _SESSION_NEGATED_TRADING_RE.search(transitive) is None, f"blacklist regression: {transitive!r}"
        assert classify_session_role(transitive).recognized is False, transitive

    # Intransitive uses — a preposition or a clause boundary follows.
    for intransitive in (
        "no trading until 9:30 a.m.",
        "stop trading after 11:30 a.m.",
        "avoid trading between 12 p.m. and 1 p.m.",
    ):
        assert _SESSION_NEGATED_TRADING_RE.search(intransitive) is not None, intransitive


def test_batch6_does_work_conjunct_is_untouched_so_bare_mentions_still_miss(_role_resolver_on):
    """★ THE SCOPE OF THE CHANGE, fenced.

    This pass loosens exactly ONE conjunct — the market co-factor — and leaves
    _session_clock_does_work alone. The proof is that a sentence carrying a
    full-strength trading ACTION but a bare-MENTION clock is still refused: the
    action satisfies the co-factor, and the clock-role test rejects it anyway.

    If a future change moves the trading-action test outside the does-work
    conjunct, this test fails — which is the alarm, because that is the shape
    that would reopen the second pass's FP class wholesale."""
    from src.engine.spec_family_bindings import _session_has_trading_action

    for text in ("I take the trade at 10:30 a.m.", "close the position at 3 p.m."):
        assert _session_has_trading_action(text) is True, f"co-factor should be satisfied: {text!r}"
        assert classify_session_role(text).recognized is False, (
            f"{text!r} recognized on a BARE-MENTION clock — the trading-action co-factor has "
            "escaped the _session_clock_does_work conjunct; the second pass's FP class is reopening"
        )

    # The second pass's four pinned bare-mention misses are unchanged.
    for text in _KNOWN_FALSE_NEGATIVES_OF_THE_DOES_WORK_RULE:
        assert classify_session_role(text).recognized is False, text


_BATCH6_KNOWN_FALSE_NEGATIVES = [
    # `long`/`short` as predicative position states. "GO LONG before 10 a.m."
    # is genuine teaching and is MISSED, because "this meeting could GO LONG
    # before lunch" and "we are SHORT on time until 3 p.m." are the identical
    # frame in ordinary English and no lookahead separates them. Refusing the
    # ordinary reading matters more; the direction is the module's standing one.
    #
    # Both rows are deliberately stripped of every market noun. A longer form
    # like "go long before 10 a.m. if the LEVEL holds" DOES recognize — but via
    # the pre-existing two-distinct-ambiguous-noun path ("long" + "level"), not
    # via this pass's rule, so it would be a false receipt for this claim.
    "go long before 10 a.m.",
    "get short before 2 p.m.",
    # A pronoun complement carries no position noun, so (B) cannot fire. The
    # packet named "do not touch it until" as a genuine teaching form; admitting
    # it would equally admit "do not touch the thermostat until 7 a.m.", which
    # is in the negative batch above. Named the miss rather than took the leak.
    "do not touch it until 10 a.m.",
    # No trading ACTION and no market noun at all — nothing to key on.
    "nothing matters until 9:30",
]


@pytest.mark.parametrize("text", _BATCH6_KNOWN_FALSE_NEGATIVES)
def test_batch6_known_false_negatives_this_pass_did_not_close(_role_resolver_on, text):
    """★ WHAT THIS PASS DID NOT FIX, pinned as a failing-visible receipt rather
    than as a paragraph in a commit message.

    Each row is genuine teaching that is still refused, and each is refused for
    a stated structural reason — not an oversight. If a later change recovers
    one, this test fails and the recovery must be re-justified against the
    ordinary-life sibling that shares its grammar."""
    assert classify_session_role(text).recognized is False, (
        f"{text!r} now recognizes — verify the batch-6 negative fence still passes "
        "(especially its ordinary-life sibling) and move this row out with a stated reason"
    )


# ════════════════════════════════════════════════════════════════════════════
# FOURTH PASS — the discriminator is GOVERNMENT, not the preposition
# ════════════════════════════════════════════════════════════════════════════
#
# The third pass loosened the market-context co-factor so a trading ACTION can
# satisfy it. That worked and is preserved untouched. The limiter then moved to
# _session_clock_does_work — the clock-role test the third pass deliberately
# left alone — which is why three known misses fire the action conjunct and
# still die:
#
#   "...so I FLATTEN before that"              anaphoric complement
#   "I SCALE OUT into 3:45 p.m."               `into` not in the span-prep set
#   "I CLOSE EVERY POSITION at 3pm on Fridays" `at` not in the span-prep set
#
# ★ THE NEW RULE, structurally. The three pre-existing clock-role tests all ask
# a question about the clock's own local NEIGHBOURHOOD — which preposition sits
# in front of it, which noun sits behind it, whether it is the whole object. A
# neighbourhood question cannot separate two sentences whose neighbourhoods are
# identical, and "garbage pickup is AT 8 a.m. on Thursdays" / "close every
# position AT 3pm on Fridays" is exactly that pair.
#
# The fourth test asks instead: WHAT PREDICATE GOVERNS THE PP THE CLOCK HEADS?
# The clock does work iff a trading-action construction's right edge is
# immediately followed — modulo a closed set of domain-free adverbs — by a
# temporal preposition whose complement IS that clock. Government is
# directional and adjacent, so mere co-presence fails. Because government is
# what carries the discrimination, the preposition no longer has to, which is
# why `at`/`into` may count in this position and only in this position.
#
# The ANAPHORIC variant is the same government relation with a NOMINALLY EMPTY
# complement — a bare that/this/it/then with no head noun. Such a pro-form has
# no descriptive content and is resolved by EXHAUSTION: admitted only when the
# text holds EXACTLY ONE clock token, and that token precedes it. Zero
# antecedents, or two, and the referent is undetermined and refused. The
# mechanism is emptiness + uniqueness + government; matching the word "that" is
# a trigger, never the rule.
#
# ★ AND THE HONEST HALF. A first draft licensed all three action constructions.
# Batch 8 below — authored at this rule specifically, and run against it for
# the first time only when complete — measured 13 regressions. The diagnosis is
# that _session_clock_does_work had been doing FP work FOR the action conjunct,
# so the polysemous constructions may not license a governed clock. The third
# target ("close every position at 3pm") therefore does NOT land; pinned below.

_BATCH7_GOVERNED_POSITIVES = [
    # (A2) unambiguous position-operation verb + a MENTION preposition
    "flatten everything right at 9:45 a.m.",
    "I scale out into 3:45 p.m.",
    "scale out around 11 a.m. and let the runner go",
    # (C) negated bare gerund + a preposition the span-prep set never had
    "no trading into 9:30 a.m.",
    # the ANAPHORIC form — the referent is in a prior clause
    "the news comes out at 8:30 a.m. so I flatten before that",
    "the data drops at 9:45 a.m. and I scale out before that",
]

# Ordinary life, SAME prepositional and anaphoric shapes. "at <time> on <day>"
# doing non-trading work is the critical control and heads the list.
_BATCH7_GOVERNED_NEGATIVES = [
    "garbage pickup is at 8 a.m. on Thursdays",
    "the recycling truck comes at 7 a.m. on Fridays",
    "the yoga class is at 6 a.m. on Mondays",
    "close the store at 9 p.m. on Fridays",
    "cut the cake at 3 p.m. on Saturdays",
    "take the medication at 9 a.m. on weekdays",
    "hold the elevator at 8:15 a.m. so the movers can load",
    "the museum takes the last entry at 4 p.m. on Sundays",
    "they take entries at 9 a.m. on Saturdays for the contest",
    "we close the applications at 5 p.m. on Fridays",
    "the trade-in counter closes at 5 p.m. on Fridays",
    # ANAPHORIC shape, ordinary life
    "the bus leaves at 6 a.m. so I shower before that",
    "the movers arrive at 9 a.m. so I pack before that",
    "the ceremony is at 3 p.m. and we eat after that",
    "my flight is at 6 a.m. so I sleep before that",
    "the alarm goes at 5 a.m. and I get up right after that",
    "the shop opens at 10 a.m. so I queue before that",
    "the tour starts at 10:30 a.m. and we leave before that",
    "the kids get home at 3:15 p.m. so I cook before that",
    # CO-PRESENCE without government — a real trading action AND a clock, but
    # the PP hangs off a different verb.
    "I closed the position and the ceremony starts at 3 p.m.",
    "we hold the runners and the parade begins at 2 p.m.",
    # the complement is NOT nominally empty — determiner + noun, not anaphora
    "we lit the candles at 7 p.m. and moved into that room",
    "he parks at 8 a.m. before that meeting",
    # TWO clock tokens => no unique antecedent => anaphora refused.
    # NB deliberately avoids the word "lunch": the LEGACY resolve_session_keyword
    # binds it to the orphan zone `lunch_blackout` before this delivery's
    # resolver is ever consulted (see
    # test_found_not_fixed_legacy_keyword_resolver_binds_ordinary_prose), which
    # would make this row measure that pre-existing defect instead of this rule.
    "the news is at 9 a.m. and the recap is at 12 p.m. so I flatten before that",
]


@pytest.mark.parametrize("text", _BATCH7_GOVERNED_POSITIVES)
def test_batch7_action_governed_clocks_now_bind(_role_resolver_on, text):
    """★ THE CLASS THIS PASS ADMITS, one polarity."""
    assert classify_session_role(text).recognized is True, f"still missing: {text!r}"


@pytest.mark.parametrize("text", _BATCH7_GOVERNED_NEGATIVES)
def test_batch7_same_shapes_in_ordinary_life_are_still_refused(_role_resolver_on, text):
    """★ THE PROHIBITED REGRESSION, fenced at BOTH layers. Every row shares the
    prepositional or anaphoric shape of a positive above; "at <time> on <day>"
    doing non-trading work is the critical control."""
    assert classify_session_role(text).recognized is False, f"false positive: {text!r}"
    binding = bind_condition({"id": "b7:neg", "type": "WAIT_SESSION", "object": text, "role": "spine"})
    assert binding.bindable is False
    assert binding.session_zone is None, f"SILENTLY BOUND {binding.session_zone!r}: {text!r}"


def test_batch7_what_the_new_rule_admits_that_6a56618b_did_not(_role_resolver_on):
    """★ CHECKLIST ITEM 2 — the standing obligation: state what the rule now
    ADMITS that it did not before, and TEST that class as a differential
    against the baseline module loaded from git, never a hand-copied number.

    Three assertions, and the third is what makes it a control:
      1. every batch-7 positive was REJECTED at 6a56618b and is ADMITTED now —
         so the admitted class is exactly this set, computed not remembered;
      2. the newly-admitted count is non-zero (the instrument discriminates);
      3. BOTH versions reject all batch-7 and batch-8 negatives — the recall was
         not bought with false positives. If a future change buys recall by
         re-admitting prose, this fails before the recall assertion does."""
    old = _load_module_at_ref("6a56618b")
    import src.engine.spec_family_bindings as today

    old_admits = [t for t in _BATCH7_GOVERNED_POSITIVES if old.classify_session_role(t).recognized]
    new_admits = [t for t in _BATCH7_GOVERNED_POSITIVES if today.classify_session_role(t).recognized]
    assert old_admits == [], f"baseline already admitted these, so they are not this pass's class: {old_admits}"
    assert len(new_admits) == len(_BATCH7_GOVERNED_POSITIVES), (
        f"admitted only {len(new_admits)}/{len(_BATCH7_GOVERNED_POSITIVES)}: "
        f"{[t for t in _BATCH7_GOVERNED_POSITIVES if t not in new_admits]}"
    )
    assert old_admits != new_admits, "THE CONTROL DID NOT MOVE"

    guarded = _BATCH7_GOVERNED_NEGATIVES + _BATCH8_AMBIGUOUS_ACTION_NEGATIVES
    old_fp = [t for t in guarded if old.classify_session_role(t).recognized]
    new_fp = [t for t in guarded if today.classify_session_role(t).recognized]
    assert old_fp == [], f"baseline leaked on this pass's negatives (re-scope the claim): {old_fp}"
    assert new_fp == [], f"★ THE PROHIBITED REGRESSION — this pass added false positives: {new_fp}"


# ─── Batch 8: the batch that broke this pass's first draft ──────────────────
#
# Authored AFTER the rule was written and aimed squarely at what it newly
# admits: ordinary-life sentences that each carry a REAL third-pass action
# construction plus a governed clock. It measured 13 leaks against the first
# draft. All 13 are refused now, by restricting which constructions may license
# a governed clock — see _session_government_licensed_action_edges.

_BATCH8_AMBIGUOUS_ACTION_NEGATIVES = [
    # (A1) copula + "flat" — soda, champagne, tyres, an audience
    "the soda goes flat at 3 p.m. if you leave the cap off",
    "the tyre went flat at 6 a.m. on the motorway",
    "the crowd stayed flat at 8 p.m. despite the encore",
    "the notes came out flat at 7 p.m. during the recital",
    "the champagne goes flat into the 6 p.m. toast",
    # (B) transaction verb + position noun — a footrace, a notary, a job fair,
    # a raffle, an estate
    "hold the runners at 6 a.m. at the starting line",
    "the coach holds the runners at 6 a.m. before the race",
    "close the contracts at 5 p.m. with the notary",
    "liquidate the contracts at 3 p.m. through the estate lawyer",
    "we hold the positions at 9 a.m. for the job fair",
    "close the positions at 5 p.m. on Friday, the listings expire",
    "we close the entries at 5 p.m. for the raffle",
    "close the contracts into 5 p.m. tomorrow",
    "trim the hedges at 7 a.m. before it gets hot",
    "dump the recycling at 6 a.m. on Tuesdays",
    "offload the trailer at 5 a.m. at the depot",
    # (B)/(A1) in the ANAPHORIC frame
    "the race is at 6 a.m. so we hold the runners before that",
    "the notary is at 5 p.m. so we close the contracts before that",
    "the job fair is at 9 a.m. so we hold the positions before that",
]


@pytest.mark.parametrize("text", _BATCH8_AMBIGUOUS_ACTION_NEGATIVES)
def test_batch8_ambiguous_actions_may_not_license_a_governed_clock(_role_resolver_on, text):
    """★ THE MEASURED FINDING OF THIS PASS, pinned.

    Every row here carries a genuine third-pass trading-action construction AND
    a governed clock, and every one is ordinary English. The first draft of the
    government rule admitted 13 of them. The fix was not a longer exclusion list
    but a smaller LICENSING set: only constructions with no ordinary reading in
    this frame — (A2) flatten/scale-out/stopped-out and (C) the negated bare
    gerund — may license a governed clock.

    The lesson recorded: _session_clock_does_work had been doing false-positive
    work FOR the action conjunct. Any future loosening of the clock-role test
    must re-measure this batch, not assume the action conjunct is precise."""
    assert classify_session_role(text).recognized is False, f"false positive: {text!r}"
    binding = bind_condition({"id": "b8:neg", "type": "WAIT_SESSION", "object": text, "role": "spine"})
    assert binding.session_zone is None, f"SILENTLY BOUND {binding.session_zone!r}: {text!r}"


_BATCH8_PREEXISTING_LEAKS = [
    # These leak at 6a56618b TOO, through _SESSION_CLOCK_SPAN_PREP_RE, which
    # this pass did not touch. Recorded so the batch-8 result is not credited
    # with fixing something it did not, and so the pre-existing defect is
    # visible rather than absorbed.
    "the champagne will be flat by 6 p.m. if we open it now",
    "the soda goes flat before 3 p.m. anyway",
    "hold the runners until 6 a.m. at the starting line",
]


def test_batch8_preexisting_leaks_are_attributed_to_the_parent_not_to_this_pass(_role_resolver_on):
    """★ ATTRIBUTION, measured rather than claimed. Three batch-8 rows leak, and
    all three leak at the BASELINE as well — through the span-preposition path
    this pass never touched. Asserting they leak on BOTH sides is what stops
    this pass from being blamed for them AND stops it from quietly counting
    them as pre-existing without checking."""
    old = _load_module_at_ref("6a56618b")
    import src.engine.spec_family_bindings as today

    for text in _BATCH8_PREEXISTING_LEAKS:
        assert old.classify_session_role(text).recognized is True, (
            f"{text!r} does NOT leak at the baseline — it is a regression this pass introduced"
        )
        assert today.classify_session_role(text).recognized is True, (
            f"{text!r} no longer leaks — good, but the attribution note above must be re-derived"
        )


_BATCH8_KNOWN_FALSE_NEGATIVES = [
    # ★ THE TARGET THIS PASS COULD NOT CLOSE, and its reason.
    #
    # "close every position at 3pm on Fridays" is the canonical (B) example and
    # was a named target. It is refused, by the same rule that refuses "we close
    # the positions at 5 p.m. on Friday, the listings expire" and "we hold the
    # positions at 9 a.m. for the job fair" — both in the batch-8 fence above.
    # They are the SAME construction, the SAME preposition and the SAME clock
    # shape, differing only in what the surrounding world is about. Licensing
    # (B) to govern a clock re-admitted 8 ordinary-life rows in the measured
    # first draft.
    #
    # Not fixed by keying on "every" (surface tuning of the kind that has failed
    # four times in this module) nor by a trailing-noun blacklist (the failure
    # mode already recorded in test_batch6_objectless_gerund_is_a_frame_test_
    # not_a_blacklist). Stated instead.
    "I close every position at 3pm on Fridays",
    "close every position at 11 a.m.",
    "exit all positions at 4 p.m.",
    # (A1) copula + "flat" governed by a mention preposition — same reason,
    # measured against soda/champagne/tyres/an audience.
    "be flat at 3:50 p.m.",
    "the data drops at 8:30 a.m. and I get flat before that",
]


@pytest.mark.parametrize("text", _BATCH8_KNOWN_FALSE_NEGATIVES)
def test_batch8_known_false_negatives_this_pass_did_not_close(_role_resolver_on, text):
    """★ WHAT THIS PASS DID NOT FIX, pinned as a failing-visible receipt rather
    than as a paragraph in a commit message.

    Each row is genuine teaching that is still refused, and each is refused for
    a stated structural reason with a named ordinary-life sibling in the
    batch-8 fence. If a later change recovers one, this test fails and the
    recovery must be re-justified against that sibling."""
    assert classify_session_role(text).recognized is False, (
        f"{text!r} now recognizes — verify the batch-8 ambiguous-action fence still "
        "passes (especially its ordinary-life sibling) and move this row out with a reason"
    )


def test_batch8_new_tests_fail_against_the_baseline_source(_role_resolver_on):
    """★ FAILING-FIRST, PROVEN — checklist item 5, as a differential rather than
    as a git-stash ritual, so nothing in the worktree is disturbed.

    The baseline module is loaded from 6a56618b and the batch-7 positives are
    run through it. Every one must FAIL there, which is precisely what makes
    test_batch7_action_governed_clocks_now_bind a red-before-green receipt
    rather than a test written to pass whatever the code already does."""
    old = _load_module_at_ref("6a56618b")
    failures_at_baseline = [t for t in _BATCH7_GOVERNED_POSITIVES if not old.classify_session_role(t).recognized]
    assert failures_at_baseline == _BATCH7_GOVERNED_POSITIVES, (
        "at least one batch-7 positive already passed at 6a56618b, so the new tests were "
        f"not failing-first: {[t for t in _BATCH7_GOVERNED_POSITIVES if t not in failures_at_baseline]}"
    )


def test_batch8_government_is_directional_and_neither_half_fires_alone(_role_resolver_on):
    """★ THE ANTI-LEXICON PROOF for this pass. The rule is a GOVERNMENT test, so
    each half in isolation must be refused: a licensed action with no governed
    clock, and a governed clock with no licensed action."""
    from src.engine.spec_family_bindings import (
        _SESSION_CLOCK_TOKEN_RE,
        _session_action_governed_clock,
        _session_government_licensed_action_edges,
    )

    def governed(text):
        return _session_action_governed_clock(text, list(_SESSION_CLOCK_TOKEN_RE.finditer(text)))

    # licensed action, but the PP hangs off a DIFFERENT verb — refused.
    assert governed("I flatten the book and the ceremony starts at 3 p.m.") is False
    # a governed clock, but no licensed action at all — refused.
    assert governed("garbage pickup is at 8 a.m. on Thursdays") is False
    assert _session_government_licensed_action_edges("garbage pickup is at 8 a.m.") == []
    # together, adjacent and in order — fires.
    assert governed("I flatten at 9:45 a.m.") is True
    # ...and an unknown intervening word breaks the relation.
    assert governed("I flatten the dough at 9:45 a.m.") is False


def test_batch8_anaphora_is_uniqueness_not_the_word_that(_role_resolver_on):
    """★ THE ANAPHORIC MECHANISM, pinned as the three properties it actually
    rests on rather than as a word match.

    (1) EMPTINESS: "before that CANDLE" is determiner+noun, not a pro-form.
    (2) UNIQUENESS: two clock tokens leave the referent undetermined.
    (3) GOVERNMENT: the PP must hang off the licensed action.
    Remove any one and the rule refuses."""
    from src.engine.spec_family_bindings import _SESSION_CLOCK_TOKEN_RE, _session_action_governed_clock

    def governed(text):
        return _session_action_governed_clock(text, list(_SESSION_CLOCK_TOKEN_RE.finditer(text)))

    base = "the news comes out at 8:30 a.m. so I flatten before that"
    assert governed(base) is True
    # (1) a head noun after the pro-form -> not anaphora
    assert governed("the news comes out at 8:30 a.m. so I flatten before that candle") is False
    # (2) a second clock token -> no unique antecedent
    assert governed("the news is at 8:30 a.m. and lunch at 12 p.m. so I flatten before that") is False
    # (3) the anaphor must be governed BY the action, not merely co-present
    assert governed("the news comes out at 8:30 a.m. so I have coffee before that, then I flatten") is False
    # ...and the antecedent must PRECEDE the anaphor.
    assert governed("I flatten before that and the news comes out at 8:30 a.m.") is False


# ─── Orphan-zone closure: the refusal is VISIBLE, and it is INERT ────────────


@pytest.mark.parametrize(
    ("phrase", "refused_zone"),
    [
        ("skip the lunch hour entirely", "lunch_blackout"),
        ("we always take a long lunch on Fridays", "lunch_blackout"),
        ("midday chop is not tradeable", "lunch_blackout"),
        ("the overnight session sets the range", "overnight"),
        ("globex opens and the algos hunt stops", "overnight"),
        ("asia session highs matter to me", "overnight"),
        ("pre market activity tells me the tone", "overnight"),
    ],
)
def test_refused_session_phrases_are_declined_with_a_named_reason(phrase, refused_zone):
    """RETURN-CHECKLIST 3/6: refused, NOT silently dropped.

    Each phrase used to bind an always-False gate. Now each is unbound with a
    reason that NAMES the zone — strictly more informative than the generic
    no_recognized_session_keyword, which is what "silently dropped" would look
    like."""
    from src.engine.spec_family_bindings import refused_session_zone, session_refusal_reason

    assert resolve_session_keyword(phrase) is None
    assert refused_session_zone(phrase) == refused_zone
    binding = bind_condition(
        {
            "id": "refusal:" + refused_zone,
            "type": "WAIT_SESSION",
            "object": phrase,
            "role": "spine",
        }
    )
    assert binding.bindable is False
    assert binding.session_zone is None
    assert binding.reason == session_refusal_reason(refused_zone)
    assert refused_zone in binding.reason, "the reason must name the zone it declined"
    assert binding.approximation is not False


def test_refusal_does_not_collapse_into_the_generic_miss():
    """CAN-FAIL CONTROL for the test above. A phrase with no session vocabulary
    at all must STILL get the generic reason — otherwise "refused" would just be
    the new name for every miss and the distinction would be decorative."""
    binding = bind_condition(
        {
            "id": "refusal:control",
            "type": "WAIT_SESSION",
            "object": "institutional participation",
            "role": "spine",
        }
    )
    assert binding.bindable is False
    assert binding.reason == "no_recognized_session_keyword"
    assert binding.approximation is False


def test_refusal_row_is_inert_for_every_approximation_aggregate():
    """The refusal carries approximation=True (the packet forbids an exactness
    claim on these zones). Prove that cannot leak into a published rate: both
    aggregates filter on `bindable and executed`, and this row is neither."""
    plan = compile_binding_plan(
        {
            "entry_conditions": [
                {"id": "t", "type": "WAIT_STRUCTURE", "object": "break of structure", "role": "spine"},
                {"id": "r", "type": "WAIT_SESSION", "object": "lunch reversals", "role": "spine"},
            ],
            "entry_trigger_id": "t",
            "invalidations": [],
        }
    )
    refusal = next(b for b in plan.bindings if b.condition_id == "r")
    assert refusal.approximation is True
    assert refusal.bindable is False
    assert refusal.executed is False
    # The published aggregate is computed over bindable+executed rows only.
    assert [b for b in plan.bindings if b.bindable and b.executed and b.condition_id == "r"] == []


def test_refused_zone_constants_survive_so_the_bridge_is_not_burned():
    """Option A refused the zones; it did NOT delete the window primitives.
    If a future corpus ever teaches lunch-avoidance, covering it is a small
    demand-justified packet — this asserts the material for it still exists."""
    from datetime import datetime, timedelta

    from src.engine import session_windows as sw

    assert sw.LUNCH_BLACKOUT_START_MIN == 11 * 60 + 30
    assert sw.LUNCH_BLACKOUT_END_MIN == 13 * 60 + 30
    # 12:30 ET on a summer (EDT) date — the checker still works standalone...
    noon_thirty = datetime(2026, 7, 20, 16, 30, tzinfo=UTC)
    assert sw.is_in_lunch_blackout(noon_thirty) is True
    # ...and is STILL not reachable through the killzone dispatch, which is
    # precisely why binding to it was dishonest. Full day, not a spot check.
    base = datetime(2026, 7, 20, 0, 0, tzinfo=UTC)
    assert not any(
        sw.is_in_killzone(base + timedelta(minutes=i), "lunch_blackout") for i in range(24 * 60)
    )
    # Positive control proving the probe above is live, not dead.
    assert any(sw.is_in_killzone(base + timedelta(minutes=i), "ny_am") for i in range(24 * 60))


# ═══════════════════════════════════════════════════════════════════════════
# packet-session-refusal-precedence-2026-07-21.md
#
# THE DEFECT, VERBATIM, AS MEASURED ON BOTH ARMS BEFORE THE FIX:
#   TF_SESSION_ROLE_RESOLVER_ENABLED=false -> bindable=False,
#       reason=session_zone_refused_uncomputable_window:overnight   <- honest
#   TF_SESSION_ROLE_RESOLVER_ENABLED=true  -> bindable=True, zone=ny_am  <- WRONG
#
# An honest refusal replaced by a confidently wrong bind, behind the flag the
# mission intends to turn ON. The flag is OFF in production; this is a
# FLAG-ON BLOCKER and these tests are what gate its promotion.
# ═══════════════════════════════════════════════════════════════════════════

# The 2 corpus objects measured as PREEMPTED — the role resolver overturned
# their orphan-zone refusal. Both bound `ny_am` (07:00-10:00 ET, inside the
# RTH day session) while naming an OVERNIGHT concept: the complement.
_PREEMPTED_CORPUS_OBJECTS = [
    "new york market open or pre market",
    (
        "overnight/pre-market range: we are going to focus primarily when the market "
        "actually closes until when the market opens, which is going to be from 400 p.m. "
        "EST all the way until 9:30 a.m. EST -- identify the highest point of price action "
        "(overnight high) and the lowest point of price action (overnight low)"
    ),
]


@pytest.mark.parametrize("obj", _PREEMPTED_CORPUS_OBJECTS)
@pytest.mark.parametrize("flag_state", ["false", "true"])
def test_orphan_zone_refusal_survives_the_role_resolver_flag(monkeypatch, obj, flag_state):
    """★ SCOPE ITEM (i). THE REFUSAL IS LOAD-BEARING.

    No flag state may convert a correct refusal into a bind. Parametrized over
    BOTH arms deliberately: a test that only ran the OFF arm would have passed
    against the defect, because the defect lived exclusively in the ON arm."""
    monkeypatch.setenv("TF_SESSION_ROLE_RESOLVER_ENABLED", flag_state)
    binding = bind_condition({"id": "p:1", "type": "WAIT_SESSION", "object": obj, "role": "spine"})
    assert binding.bindable is False, (
        f"flag={flag_state}: a refused session zone became BINDABLE (zone={binding.session_zone}). "
        "This is the defect this packet closed."
    )
    assert binding.session_zone is None
    assert binding.reason == "session_zone_refused_uncomputable_window:overnight"


def _all_wait_session_objects() -> set[str]:
    """Every distinct WAIT_SESSION `object` string reachable in the tracked
    docs/ corpora. Computed, never hardcoded — a hand-copied list would be a
    fabricated-safety claim about a corpus it no longer tracks."""
    root = pathlib.Path(__file__).resolve().parents[3] / "docs"
    found: set[str] = set()
    for path in root.rglob("*.json"):
        try:
            doc = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        stack = [doc]
        while stack:
            node = stack.pop()
            if isinstance(node, dict):
                if node.get("type") == "WAIT_SESSION" and node.get("object"):
                    found.add(str(node["object"]))
                stack.extend(node.values())
            elif isinstance(node, list):
                stack.extend(node)
    return found


def test_both_flag_arms_agree_on_every_refusal_path_object(monkeypatch):
    """The refusal set is closed under the flag — census-sized, not instance-sized.

    Boundary printed with the verdict: all 9 corpus objects that reach the
    refusal path (exact-phrase matcher misses AND a refused zone is named)."""
    all_objects = _all_wait_session_objects()
    if not all_objects:
        pytest.skip("docs/ corpora unavailable in this checkout")
    # ★ THE CENSUS CARRIES ITS BOUNDARY. An independent grade measured 396
    # where this said 395; resolved by measurement rather than by credibility,
    # and BOTH are right under different definitions:
    #   395 = distinct WAIT_SESSION objects with a NON-EMPTY object string
    #   396 = the above plus the empty-string object, which really does occur
    #         (or-branches-full-corpus-specs-2026-07-05.json carries
    #         WAIT_SESSION conditions with object: "")
    # A bare "395" was underspecified, not wrong. The empty object is
    # flag-invariant too (both arms: bindable=False,
    # reason=no_recognized_session_keyword), so the invariance claim holds
    # over 396; only the receipt figure needed its boundary.
    assert len(all_objects) == 395, f"non-empty WAIT_SESSION census moved: {len(all_objects)} (expected 395)"
    assert len(all_objects | {""}) == 396, "census-including-empty-object boundary moved"
    refusal_path = [
        o for o in all_objects
        if resolve_session_keyword(o) is None and refused_session_zone(o) is not None
    ]
    assert len(refusal_path) == 9, f"refusal-path census moved: {len(refusal_path)} (expected 9)"
    disagreements = []
    for obj in refusal_path:
        arms = {}
        for state in ("false", "true"):
            monkeypatch.setenv("TF_SESSION_ROLE_RESOLVER_ENABLED", state)
            b = bind_condition({"id": "p:2", "type": "WAIT_SESSION", "object": obj, "role": "spine"})
            arms[state] = (b.bindable, b.reason, b.session_zone)
        if arms["false"] != arms["true"]:
            disagreements.append((obj[:60], arms))
    assert not disagreements, f"flag changed the verdict on {len(disagreements)}/9: {disagreements}"


@pytest.mark.parametrize(
    "text",
    [
        # ★ COLON-FUL tokens. These prove the wrapping defect is NOT the
        # colon-less-token defect it was originally diagnosed as: every token
        # here parses perfectly, and min/max still derived the COMPLEMENT.
        "trade the range from 4:00 p.m. eastern until 9:30 a.m. eastern on the NYSE",
        "we trade the ES range from 6:00 p.m. until 3:00 a.m. eastern",
        "from 11:00 p.m. to 2:00 a.m. eastern the market is quiet, avoid entries on ES",
    ],
)
def test_wrapping_window_is_refused_by_name_never_complement_bound(monkeypatch, text):
    """★ SCOPE ITEM (ii). A window that wraps midnight is REFUSED with a named
    reason, never bound to the complement of what it taught.

    Measured before the fix (flag ON):
        "from 4:00 p.m. ... until 9:30 a.m." -> min/max span (570, 960) -> ny_pm
        "from 11:00 p.m. to 2:00 a.m."       -> min/max span (120, 1380) -> ny_am
    Both are day-session zones; both texts teach an overnight range."""
    monkeypatch.setenv("TF_SESSION_ROLE_RESOLVER_ENABLED", "true")
    result = classify_session_role(text)
    assert result.zone is None, f"complement-bound to {result.zone!r}: {text!r}"
    assert result.refusal == SESSION_WRAPPING_WINDOW_UNBOUND_REASON
    binding = bind_condition({"id": "p:3", "type": "WAIT_SESSION", "object": text, "role": "spine"})
    assert binding.bindable is False
    assert binding.session_zone is None
    assert binding.reason == SESSION_WRAPPING_WINDOW_UNBOUND_REASON


@pytest.mark.parametrize(
    "label,sequence,wraps",
    [
        ("ends exactly at midnight (22:00 -> 00:00)", [1320, 0], True),
        ("starts exactly at midnight (00:00 -> 02:00)", [0, 120], False),
        ("same minute restated is not a wrap", [570, 570], False),
        ("single anchor can never wrap", [570], False),
        ("no anchors at all", [], False),
        ("monotone three-token span", [180, 570, 570], False),
        ("backwards step anywhere in the sequence", [570, 585, 120], True),
        ("both boundary minutes of the day", [0, 1439], False),
        ("full reverse across the day", [1439, 0], True),
    ],
)
def test_midnight_boundary_of_the_wrap_representation(label, sequence, wraps):
    """★ The representation owes its own tests, including the midnight
    boundary (packet scope item (ii)). Minute-of-day domain is [0, 1439];
    both endpoints are exercised."""
    assert _session_anchor_sequence_wraps_midnight(sequence) is wraps, label


def test_wrap_test_never_fires_on_a_monotone_sequence():
    """Reconciliation against something OUTSIDE the wrap test's own pipeline:
    sortedness. A monotone non-decreasing sequence is BY DEFINITION not a
    wrap, so any monotone input firing the test is a defect regardless of what
    the corpus says. 2000 pseudo-random sequences, fixed seed."""
    rng = random.Random(7)
    for _ in range(2000):
        seq = sorted(rng.randint(0, 1439) for _ in range(rng.randint(1, 5)))
        assert not _session_anchor_sequence_wraps_midnight(seq), seq


def test_orphan_zone_refusal_outranks_the_wrapping_refusal(monkeypatch):
    """Both gates can fire on one text. The ORPHAN-ZONE refusal wins, because
    it is the more specific claim: it names the zone, where the wrapping
    refusal only names the shape. Pins the precedence so a later reorder is
    loud."""
    monkeypatch.setenv("TF_SESSION_ROLE_RESOLVER_ENABLED", "true")
    text = "the overnight range on ES is quiet from 11:00 p.m. to 2:00 a.m. eastern, avoid entries"
    assert classify_session_role(text).refusal == SESSION_WRAPPING_WINDOW_UNBOUND_REASON, (
        "positive control: this text must genuinely trip the wrapping gate too, "
        "or the precedence assertion below is vacuous"
    )
    binding = bind_condition({"id": "p:4", "type": "WAIT_SESSION", "object": text, "role": "spine"})
    assert binding.reason == "session_zone_refused_uncomputable_window:overnight"


@pytest.mark.parametrize(
    "text,zone",
    [
        ("trade only from 9:30 a.m. to 10:00 a.m. eastern on the NYSE", "ny_am"),
        ("the london killzone runs from 2:00 a.m. until 5:00 a.m. eastern", "london"),
        ("we only take entries between 1:30 p.m. and 4:00 p.m. eastern on ES", "ny_pm"),
        ("focus on price action from 10:00 a.m. through 11:00 a.m. eastern in the market", "silver_bullet"),
    ],
)
def test_non_wrapping_window_teachings_still_bind_their_zone(monkeypatch, text, zone):
    """The refusal must not eat genuine teaching. Independent synthetic
    control, one per real killzone; 4/4 bound before AND after."""
    monkeypatch.setenv("TF_SESSION_ROLE_RESOLVER_ENABLED", "true")
    result = classify_session_role(text)
    assert result.refusal is None
    assert result.zone == zone, f"lost a genuine teaching: {text!r} -> {result.zone!r}"


def test_anchor_phrase_gloss_is_not_read_as_a_range_endpoint(monkeypatch):
    """★ REGRESSION PIN for the two bugs this packet's own first cuts shipped
    into test, both from one wrong premise: that discovery order is text order.

    An anchor PHRASE ("market open" -> 9:30) is a descriptive gloss and may sit
    anywhere relative to the clock tokens it describes. Feeding it into the
    ordered wrap test produced PHANTOM wraps on genuine, non-wrapping corpus
    teachings and moved the graded bound-and-concrete count (8 -> 6, then
    8 -> 7). The graded constants are owned by the population-completion unit
    and must never move by side-effect — that they moved is how both bugs
    announced themselves."""
    monkeypatch.setenv("TF_SESSION_ROLE_RESOLVER_ENABLED", "true")
    # Gloss BETWEEN the endpoints: text order 180, 570(gloss), 570 — monotone.
    between = (
        "after 3:00 a.m. Eastern time all the way up into New York market open, "
        "which is going to be 9:30 a.m. EST, you want to find the highest point of price action"
    )
    # Gloss AFTER both endpoints: naive text order 570, 585, 570(gloss) — a
    # phantom backwards step, which is why the gloss is excluded entirely.
    after = (
        "marking out the top and the bottom of that range from 9:30 to 9:45. That is the first "
        "15 minutes of the New York Stock Exchange open, and that is my trading range"
    )
    for text in (between, after):
        result = classify_session_role(text)
        assert result.refusal is None, f"phantom wrap on a non-wrapping teaching: {text[:70]!r}"
        assert result.zone is not None, f"lost a genuine teaching: {text[:70]!r}"


@pytest.mark.parametrize(
    "text",
    [
        # ★ THE HOLE. One clock token + the anchor phrase as the TERMINAL
        # endpoint. Pre-hole-fix these bound ny_pm (13:30-16:00 ET) — the RTH
        # afternoon, the COMPLEMENT of the overnight range taught, which is
        # this packet's own defect escaping through this packet's own remedy.
        "trade the range from 4:00 p.m. eastern until market open on the NYSE",
        "we hold from 6:00 p.m. eastern until the market open",
        "from 11:00 p.m. eastern until market open, mark the high and low on ES",
        "hold from 4:00 p.m. eastern until New York market open on ES",
    ],
)
def test_wrapping_window_whose_terminal_endpoint_is_the_anchor_phrase(monkeypatch, text):
    """★ A REAL HOLE THIS PACKET'S FIRST LANDED VERSION OPENED, found by
    adversarially probing its own design decision rather than by a failing test.

    Excluding the anchor phrase from the wrap test (to kill two phantom wraps)
    meant a wrapping window expressed as "<clock> until MARKET OPEN" carried
    only ONE clock token, so the ordered test saw no backwards step and the
    min/max span silently produced the complement.

    These sentences are semantically the SAME teaching as the originating
    corpus row: "when the market actually closes until when the market opens."
    """
    monkeypatch.setenv("TF_SESSION_ROLE_RESOLVER_ENABLED", "true")
    result = classify_session_role(text)
    assert result.zone is None, f"complement-bound to {result.zone!r}: {text!r}"
    assert result.refusal == SESSION_WRAPPING_WINDOW_UNBOUND_REASON
    binding = bind_condition({"id": "p:5", "type": "WAIT_SESSION", "object": text, "role": "spine"})
    assert binding.bindable is False
    assert binding.reason == SESSION_WRAPPING_WINDOW_UNBOUND_REASON


def test_forward_span_from_the_anchor_phrase_is_not_refused(monkeypatch):
    """The governed-endpoint rule must not turn every anchor-phrase sentence
    into a refusal. A FORWARD span starting at the open is ordinary teaching
    and must still bind. Negative control for the test above — without this,
    'refuse everything' would pass it."""
    monkeypatch.setenv("TF_SESSION_ROLE_RESOLVER_ENABLED", "true")
    result = classify_session_role("trade from market open until 11:00 a.m. eastern on the NYSE")
    assert result.refusal is None
    assert result.zone is not None


@pytest.mark.parametrize(
    "label,text,governed",
    [
        ("until + phrase", "hold from 4:00 p.m. until market open", True),
        ("until + determiner + phrase", "hold from 6:00 p.m. until the market open", True),
        ("into across discourse filler", "up into New York market open", True),
        ("of = gloss, not an endpoint", "the first 15 minutes of the New York Stock Exchange open", False),
        ("content word blocks the governor", "from noon we watch volume at the opening bell", False),
        ("no governor at all", "the opening bell was loud", False),
    ],
)
def test_anchor_phrase_government_discriminates_endpoint_from_gloss(label, text, governed):
    """The rule is GOVERNMENT, not position. A span preposition may reach the
    phrase across scaffold/market-name filler only — never across a content
    word, or any preposition anywhere in a long sentence would license any
    phrase."""
    match = SESSION_ANCHOR_PHRASE_RE.search(text)
    assert match is not None, f"fixture must contain an anchor phrase: {text!r}"
    assert _session_anchor_phrase_is_governed_endpoint(text, match.start()) is governed, label


def test_ungoverned_gloss_does_not_extend_the_span_when_clock_endpoints_exist(monkeypatch):
    """★ THE SECOND, RESIDUAL ROUTE TO A COMPLEMENT BIND — found by continuing
    to attack the hole fix after it was already green and committed.

    Government fixed the WRAP test, but min/max still spanned an ungoverned
    gloss to a clock token, reaching the complement by another road:

        "hold from 4:00 p.m. eastern during market open on ES"
            gloss(570) + token(960) -> min/max (570, 960) -> ny_pm

    ("during" is correctly NOT a range-bounding preposition, so widening the
    governor list would have been the wrong fix.) A gloss now contributes no
    anchor at all when real clock endpoints are present."""
    monkeypatch.setenv("TF_SESSION_ROLE_RESOLVER_ENABLED", "true")
    result = classify_session_role("hold from 4:00 p.m. eastern during market open on ES")
    assert result.zone is None, f"complement-bound to {result.zone!r} via the gloss/token span"


@pytest.mark.parametrize(
    "text",
    [
        "the first two-minute candle off the bell",
        "price drops at the opening bell",
    ],
)
def test_sole_anchor_phrase_still_supplies_its_zone(monkeypatch, text):
    """★ NEGATIVE CONTROL for the test above, and the reason the gloss rule is
    conditioned on clock endpoints existing rather than applied unconditionally.

    These are graded calibration fixtures: both ungoverned, both carrying NO
    clock token. When the phrase is the SOLE anchor it must still supply the
    zone — dropping it here would move a graded constant by side-effect, which
    this packet is forbidden from doing."""
    monkeypatch.setenv("TF_SESSION_ROLE_RESOLVER_ENABLED", "true")
    assert classify_session_role(text).zone == "ny_am"


@pytest.mark.parametrize("flag_state", ["false", "true"])
def test_empty_object_wait_session_is_flag_invariant(monkeypatch, flag_state):
    """The 396th census member — a WAIT_SESSION whose `object` is the empty
    string, which really occurs in the corpus. It must be flag-invariant like
    every other refusal-path row, so the invariance claim holds over the full
    396 and not merely the 395 non-empty ones."""
    monkeypatch.setenv("TF_SESSION_ROLE_RESOLVER_ENABLED", flag_state)
    binding = bind_condition({"id": "p:6", "type": "WAIT_SESSION", "object": "", "role": "spine"})
    assert binding.bindable is False
    assert binding.session_zone is None
    assert binding.reason == "no_recognized_session_keyword"


def test_asia_session_reason_string_changes_under_the_flag_and_that_is_declared(monkeypatch):
    """★ AN UNDECLARED DELTA, found by the independent grade and pinned here.

    The packet claimed the flag-ON delta was 2 objects. It is 3. `asia session`
    also changes — not from refusal to bind (the safety claim holds: it refuses
    in both states), but its REASON STRING moves:

        base flag-ON: session_teaching_recognized_no_computable_window
        this  flag-ON: session_zone_refused_uncomputable_window:overnight

    Both are honest refusals, and the newer one is strictly more informative
    (it names the zone). But any downstream ledger keyed on `reason` sees it,
    so it is declared here rather than discovered downstream."""
    monkeypatch.setenv("TF_SESSION_ROLE_RESOLVER_ENABLED", "true")
    binding = bind_condition({"id": "p:7", "type": "WAIT_SESSION", "object": "asia session", "role": "spine"})
    assert binding.bindable is False
    assert binding.reason == "session_zone_refused_uncomputable_window:overnight"
