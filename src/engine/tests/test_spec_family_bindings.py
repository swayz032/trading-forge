"""Tests for spec_family_bindings.py — Band C condition-family binding-plan compiler.

Run targeted (per CLAUDE.md pre-existing tower trait: bare pytest collection
over the full src/engine/tests directory hangs because some module transitively
imports the vectorbt-JIT backtester):

    python -m pytest src/engine/tests/test_spec_family_bindings.py -v
"""

from __future__ import annotations

import json
import os

import pytest

from src.engine.spec_family_bindings import (
    MIN_SPINE_BOUND_RATIO,
    SESSION_TEACHING_UNBOUND_REASON,
    bind_condition,
    classify_session_role,
    compile_binding_plan,
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


@pytest.mark.parametrize(
    ("phrase", "expected_zone"),
    [
        ("we trade the ny am session only", "ny_am"),
        ("wait for the london open before entering", "london"),
        ("skip the lunch hour entirely", "lunch_blackout"),
    ],
)
def test_real_session_phrases_still_bind(phrase, expected_zone):
    # ANTI-VACUITY COMPANION. Without this, the fence above would pass just as
    # happily if resolve_session_keyword were broken to always return None —
    # a dead matcher and a correct one are indistinguishable on negative cases.
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
def test_s2_known_good_bell_rows_are_bound(_role_resolver_on, text):
    """The grader's "opening bell" / "off the Bell" rows (session_teaching
    verdict, session-ab-blind-grade-RESULT.json) — 9:30 ET market open falls
    inside the real ny_am killzone [7:00,10:00), so these get a genuine,
    computable, non-fabricated zone."""
    result = classify_session_role(text)
    assert result.recognized is True
    assert result.zone == "ny_am"
    binding = bind_condition({"id": "calib:known-good", "type": "WAIT_SESSION", "object": text, "role": "spine"})
    assert binding.bindable is True
    assert binding.session_zone == "ny_am"
    assert binding.approximation is True, "S8: never approximation=False in this packet"


# ─── S1: premise audit at the PRODUCTION BOUNDARY (not an interior argument) ─

def test_s1_premise_audit_production_boundary_varying_condition_text_moves_the_bound_window(_role_resolver_on):
    """The amended Leg 1: vary the CONDITION TEXT production actually reads
    (condition["object"], through the public bind_condition() entry point —
    never classify_session_role() called directly), and show the bound
    session window DIFFERS per condition. Varying an interior argument only
    proves a function is a function; that omission sank an earlier packet
    (WIRE-2, AR-142 — the primitive NAMED is not always the primitive that
    EXECUTES, so the production boundary is the only honest place to test)."""
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
    filler = bind_condition(
        {"id": "premise:c", "type": "WAIT_SESSION", "object": _KNOWN_BAD_TEXT, "role": "spine"}
    )

    # Three different condition texts through the SAME production entry point
    # produce three DIFFERENT outcomes -- the resolver's decision moves with
    # the text, not a constant baked in behind the flag.
    assert london_ish.bindable is True and london_ish.session_zone == "ny_am" and london_ish.approximation is True
    assert unbound_recognized.bindable is False and unbound_recognized.reason == SESSION_TEACHING_UNBOUND_REASON
    assert filler.bindable is False and filler.reason == "no_recognized_session_keyword"
    outcomes = {
        (london_ish.bindable, london_ish.session_zone, london_ish.reason),
        (unbound_recognized.bindable, unbound_recognized.session_zone, unbound_recognized.reason),
        (filler.bindable, filler.session_zone, filler.reason),
    }
    assert len(outcomes) == 3, "production-boundary liveness: distinct condition text must move the bound outcome"


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

# The 8-of-17 rows for which classify_session_role finds a concrete,
# computable clock-time/anchor-phrase span (see module comment on
# classify_session_role) -- everything else in the 17 is recognized but
# stays honestly unbound (ambiguous named session, or a session-range LEVEL
# reference deferred to the out-of-scope level/zone subsystem).
SESSION_TEACHING_BOUND_CONDITION_IDS = frozenset(
    {
        "WAIT_SESSION:after-3-00-a-m-eastern-time-all-the-way#1",
        "WAIT_SESSION:go-to-your-5minut-time-frame-find-3-00-a#2",
        "WAIT_SESSION:i-m-looking-at-two-candles-this-one-at-7#2",
        "WAIT_SESSION:if-i-can-find-a-stock-that-opens-weak-on#4",
        "WAIT_SESSION:it-s-called-opening-range-with-breakouts#18",
        "WAIT_SESSION:marking-out-the-top-and-the-bottom-of-th#6",
        "WAIT_SESSION:the-first-two-minute-candle-off-the-bell#0",
        "WAIT_SESSION:when-the-stock-actually-breaks-above-the#0",
    }
)


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

    # verdict == "session_teaching": the named target population (17 rows).
    assert result.recognized is True, f"genuine session-teaching row {cid} must be recognized"
    if cid in SESSION_TEACHING_BOUND_CONDITION_IDS:
        assert binding.bindable is True, f"{cid} expected a real computable zone"
        assert binding.approximation is True
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


# ─── S6: re-measure with dual denominators + null/n, over the grade's own sample ─
#
# NOTE ON DENOMINATORS: the packet's own checklist text names "124 / 111
# primary" -- those are the WAIT_STRUCTURE narration-reclassification
# denominators (78 structure + 46 deferred, R-093/AR-082), a DIFFERENT
# packet's population. They do not apply to WAIT_SESSION. The honest
# denominators for THIS family (AR-074/AR-124, corpus-wide over 16 specs):
# 27 total WAIT_SESSION conditions, 1 pre-existing bind, 26 unbound, split
# 17 session_teaching / 9 entry_mechanics_mistype by the independent blind
# grade. See this packet's completion report for the flagged discrepancy.

def test_s6_coverage_counts_carry_their_null_and_their_n(_role_resolver_on):
    rows = _session_ab_rows()
    n_total = len(rows)
    n_mistype = sum(1 for _, v, _ in rows if v == "entry_mechanics_mistype")
    n_teaching = sum(1 for _, v, _ in rows if v == "session_teaching")
    assert n_total == 26
    assert n_mistype == 9
    assert n_teaching == 17

    recognized_count = 0
    bound_count = 0
    null_count = 0  # recognized=True but zone=None -- the "unbound count travels beside the rate"
    false_positive_count = 0
    for _cid, verdict, obj in rows:
        result = classify_session_role(obj)
        if verdict == "session_teaching":
            if result.recognized:
                recognized_count += 1
            if result.zone is not None:
                bound_count += 1
            else:
                null_count += 1
        elif result.recognized:
            false_positive_count += 1

    assert recognized_count == 17, f"recognized {recognized_count}/{n_teaching} taught session rows"
    assert bound_count == 8, f"bound-and-concrete {bound_count}/{n_teaching} (the rate)"
    assert null_count == 9, f"recognized-but-unbound {null_count}/{n_teaching} (the null the rate must carry beside it)"
    assert false_positive_count == 0, "zero false positives on the 9 mis-typed rows -- the whole point of role-awareness"
    # §6a coverage = bound-and-concrete / all taught (here: the 17-row target population)
    coverage_6a = bound_count / n_teaching
    assert round(coverage_6a, 4) == round(8 / 17, 4)


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
