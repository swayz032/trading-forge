"""The two remaining pre-backtest blockers (R-422).

Both live at the execution boundary, so they share a module — but their tests
and their failure reasons are kept strictly separate, per the ruling.

BLOCKER (i) — UNKNOWN_REQUIREDNESS
-----------------------------------
The safety release folded "we do not know whether this rule is required" into
MANDATORY. That fails closed, which is right, but it RECORDS a claim the source
never made. Storing "unknown" as "the source said mandatory" fabricates
provenance in the very artifact built to stop fabrication — caption-is-a-claim,
one field over. So requiredness gets its own third state: it still blocks, and
it is labelled honestly.

★ GROUNDING, measured over POP-16 / corpus_A (`shakedown_specs`, 16 files):
  role vocabulary is EXACTLY {spine: 102, confluence: 53, invalidation: 6}.
  All 16 entry-trigger conditions carry role "spine" — the literal role
  "trigger" does NOT occur in corpus_A.

★★★ SUPERSEDED IN PART BY R-432/R-436/R-438 — `spine` IS NO LONGER MANDATORY.
  The grounding above establishes that `spine` is COMMON, which is not the same
  claim as `spine` meaning "the source required this". [MEASURED at the
  producer, R-432] a condition becomes `spine` by being the ELSE-ARM of a
  topology test in `graph-to-engine.ts` — it is what a condition is called when
  it looks like nothing else — so it was never source evidence of requiredness.
  Reading frequency as authority is the join-key error this correction closes.

  `invalidation` REMAINS MANDATORY: it is assigned BY TYPE from the atom's own
  semantics, so it genuinely is source evidence.

  ★★ THE REFUSAL SET DOES NOT MOVE. `spine` now lands in UNKNOWN_REQUIREDNESS,
  which blocks identically — pinned by
  `test_REGRESSION_refusal_set_identical_under_legacy_mandatory_roles` below,
  as a SET comparison with a control that fails if the mutation never took.
  It blocks either way; only the recorded provenance differs, and that is the
  whole point.

BLOCKER (ii) — NON_EXECUTABLE_EMPTY_SPINE
------------------------------------------
When no spine predicate survives, `per_condition_bool` is empty and
`spine_satisfied` falls back to `np.ones(n)` — the AND identity. Rising-edge
semantics then fire exactly ONE entry at bar 0 that no source rule authorized.
The hazard is not "trades every bar"; it is a single fabricated entry at the
start of every backtest window, which is harder to notice and just as wrong.

★ [MEASURED] 0 of 16 corpus_A specs currently reach this path — a real hazard
  this corpus does not presently hit, which is a reason to fix it calmly, not a
  reason to skip it.

Run targeted:
    python -m pytest src/engine/tests/test_preflight_blockers.py -v
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import numpy as np
import polars as pl
import pytest

import src.engine.spec_execution_preflight as preflight_mod
from src.engine.spec_condition_compiler import from_compiled_spec
from src.engine.spec_execution_preflight import (
    MANDATORY,
    NON_EXECUTABLE_EMPTY_SPINE,
    OPTIONAL_CANDIDATE,
    UNKNOWN_REQUIREDNESS,
    NonExecutableEmptySpineError,
    blocks_execution,
    classify_rule_role,
    preflight_binding_plan,
    resolve_rule_class,
)
from src.engine.spec_family_bindings import compile_binding_plan

N_BARS = 120


def _synthetic_df(seed: int = 7) -> pl.DataFrame:
    rng = np.random.default_rng(seed)
    start = datetime(2026, 1, 5, 9, 30, tzinfo=UTC)
    ts = [start + timedelta(minutes=5 * i) for i in range(N_BARS)]
    close = 5000 + np.cumsum(rng.normal(0, 1.0, N_BARS))
    return pl.DataFrame(
        {
            "ts_event": ts,
            "open": (close + rng.normal(0, 0.3, N_BARS)).astype(np.float64),
            "high": (close + rng.uniform(0.2, 1.5, N_BARS)).astype(np.float64),
            "low": (close - rng.uniform(0.2, 1.5, N_BARS)).astype(np.float64),
            "close": close.astype(np.float64),
            "volume": rng.integers(500, 2000, N_BARS).astype(np.int64),
        }
    )


def _spec(conditions: list[dict], trigger_id: str = "t1") -> dict:
    return {
        "video": "TESTVID",
        "spec_hash": "blockers422",
        "graph_canonical_hash": "x",
        "ledger_d": "CONSERVED",
        "spec": {
            "direction": "long",
            "entry_conditions": conditions,
            "and_groups": [],
            "or_branches": [],
            "invalidations": [],
            "entry_trigger_id": trigger_id,
        },
    }


def _cond(cid: str, ctype: str, obj: str, role: str) -> dict:
    return {"id": cid, "type": ctype, "object": obj, "role": role,
            "span": {"start": 0, "end": 1}, "evidence": "ev"}


def _bound_spine_spec() -> dict:
    """A normally-bound spec: one executable spine predicate + its trigger."""
    return _spec([
        _cond("s1", "WAIT_SESSION", "ny am session", "spine"),
        _cond("t1", "ENABLE_ENTRY", "entry trigger", "spine"),
    ])


# ═══════════════════════════════════════════════════════════════════════════
# BLOCKER (i) — UNKNOWN_REQUIREDNESS: fails closed, recorded honestly
# ═══════════════════════════════════════════════════════════════════════════

def test_i_grounded_roles_stay_mandatory():
    """Only the roles we actually have source evidence for are called mandatory.

    ★ NAME RETAINED DELIBERATELY. R-438 named this as one of four tests that
      would newly fail. Renaming it would read as a DELETION to anyone matching
      that ruling against this suite. The name is now imprecise — after R-436
      the only grounded role is `invalidation` — and the rename is a named
      follow-up, not a silent edit.

    ★★ `spine` MOVED (R-432): it is the ELSE-ARM of a topology test, not the
      educator saying "required", so it is no longer evidence of source-mandatory
      status. The SAFETY property is re-pinned in the same breath rather than
      dropped — it still blocks.
    """
    assert classify_rule_role("invalidation") == MANDATORY
    assert classify_rule_role("confluence") == OPTIONAL_CANDIDATE
    # ★ The moved arm, with its safety asserted alongside it.
    assert classify_rule_role("spine") == UNKNOWN_REQUIREDNESS
    assert blocks_execution(classify_rule_role("spine")) is True


def test_i_absent_or_unrecognized_role_is_unknown_not_mandatory():
    """RED before (i): these returned MANDATORY, asserting a source claim that
    was never made."""
    assert classify_rule_role("") == UNKNOWN_REQUIREDNESS
    assert classify_rule_role("trigger") == UNKNOWN_REQUIREDNESS
    assert classify_rule_role("annotation-we-have-never-seen") == UNKNOWN_REQUIREDNESS


def test_i_unknown_requiredness_still_blocks_execution():
    """★ The fail-closed half. Honest labelling must not cost safety."""
    assert blocks_execution(MANDATORY) is True
    assert blocks_execution(UNKNOWN_REQUIREDNESS) is True
    assert resolve_rule_class("", optional_evidence=True) == UNKNOWN_REQUIREDNESS, (
        "optional evidence must never launder an unknown role into droppable"
    )


def test_i_refusal_records_unknown_requiredness_not_source_mandatory():
    """★★★ The provenance assertion: the refusal must say WHY it blocked, and
    it must not claim the source marked the rule required."""
    spec = _spec([
        _cond("s1", "WAIT_SESSION", "information events", ""),  # unbindable, role ABSENT
        _cond("t1", "ENABLE_ENTRY", "entry trigger", "spine"),
    ])
    plan = compile_binding_plan(spec["spec"])
    result = preflight_binding_plan(plan, strategy_id="strat-unknown")

    assert result.refused is True
    r = next(x for x in result.refusals if x.condition_id == "s1")
    assert r.rule_class == UNKNOWN_REQUIREDNESS
    assert r.rule_class != MANDATORY


def test_i_DISCRIMINATOR_genuine_spine_refusal_still_records_mandatory():
    """Control: the relabel must move `spine` and MUST STOP at `invalidation`.

    ★★★ RE-AIMED, NOT DELETED (R-438). Its original premise — a spine refusal
      still records MANDATORY — is precisely what R-436 reverses, so keeping the
      old assertion would PIN THE DEFECT. But deleting it would remove the only
      check that the relabel stopped where it was supposed to. So it now
      discriminates in BOTH directions, which is strictly more than it did
      before: `spine` moved, `invalidation` did not.

    ★★ A later "cleanup" that recollapses the two classes — in either direction
      — fails HERE. That is the whole reason this test survives its own premise.
    """
    spec = _spec([
        _cond("s1", "WAIT_SESSION", "information events", "spine"),
        _cond("t1", "ENABLE_ENTRY", "entry trigger", "spine"),
    ])
    plan = compile_binding_plan(spec["spec"])
    r = next(x for x in preflight_binding_plan(plan, strategy_id="s").refusals
             if x.condition_id == "s1")

    # (a) the arm that MOVED — end-to-end through a real plan, not just the
    #     classifier, so this proves the recorded refusal changed class.
    assert r.rule_class == UNKNOWN_REQUIREDNESS
    assert r.rule_class != MANDATORY
    # (b) ...and it still refuses. Honest labelling must not cost safety.
    assert blocks_execution(r.rule_class) is True

    # (c) THE DISCRIMINATOR — `invalidation` is assigned BY TYPE from the atom's
    #     own semantics, so it IS source evidence and must be untouched. If this
    #     line ever goes green while (a) is green too, the classes have been
    #     collapsed and the correction has been undone.
    assert classify_rule_role("invalidation") == MANDATORY
    assert resolve_rule_class("invalidation", optional_evidence=True) == MANDATORY


# ═══════════════════════════════════════════════════════════════════════════
# R-437 / R-438 — THE REFUSAL SET DOES NOT MOVE WHEN `spine` CHANGES CLASS
# ═══════════════════════════════════════════════════════════════════════════

_LEGACY_MANDATORY_ROLES = frozenset({"spine", "invalidation"})
"""The pre-R-436 value of `_MANDATORY_ROLES`, pinned here as a literal.

Deliberately NOT imported from the module: importing it would make this test
compare the module against itself and it would pass no matter what the module
said. The old value is the thing under comparison, so it is written down."""


def _refusal_corpus() -> list[tuple[str, dict]]:
    """Specs spanning every arm the change could plausibly touch.

    Each entry exercises a different route to (or past) a refusal: the moved
    role, the roles that must NOT move, the fail-closed arms, the plan-level
    empty-spine blocker, and a clean spec that must refuse NOTHING."""
    return [
        # the MOVED arm: unbindable spine
        ("unbindable-spine", _spec([
            _cond("s1", "WAIT_SESSION", "information events", "spine"),
            _cond("t1", "ENABLE_ENTRY", "entry trigger", "spine"),
        ])),
        # fail-closed arms: absent + unrecognised role
        ("absent-role", _spec([
            _cond("s1", "WAIT_SESSION", "information events", ""),
            _cond("t1", "ENABLE_ENTRY", "entry trigger", "spine"),
        ])),
        ("unknown-role", _spec([
            _cond("s1", "WAIT_SESSION", "information events", "trigger"),
            _cond("t1", "ENABLE_ENTRY", "entry trigger", "spine"),
        ])),
        # the role that must NOT move
        ("unbindable-confluence", _spec([
            _cond("c1", "WAIT_SESSION", "information events", "confluence"),
            _cond("t1", "ENABLE_ENTRY", "entry trigger", "spine"),
        ])),
        # plan-level blocker (ii), which is NOT role-classified
        ("empty-spine", _spec(
            [_cond("s1", "EXIT_HINT", "take profit at 2R", "spine")], trigger_id="s1")),
        ("no-spine-at-all", _spec([
            _cond("c1", "WAIT_STRUCTURE", "structure check", "confluence"),
            _cond("t1", "ENABLE_ENTRY", "entry trigger", "confluence"),
        ])),
        # the control: nothing unbindable, must refuse nothing
        ("fully-bound", _bound_spine_spec()),
    ]


def _refusal_keys_and_classes(monkeypatch, mandatory_roles) -> tuple[set, dict]:
    """Run the WHOLE corpus under a given `_MANDATORY_ROLES` and report both
    the refusal SET (the safety property) and the class distribution (the point
    of the change). Returning both from one pass is deliberate: it makes it
    impossible to quote the reassuring number without the number that must move.
    """
    monkeypatch.setattr(preflight_mod, "_MANDATORY_ROLES", mandatory_roles)
    keys: set = set()
    classes: dict = {}
    for name, spec in _refusal_corpus():
        plan = compile_binding_plan(spec["spec"])
        result = preflight_binding_plan(plan, strategy_id=name)
        for r in result.refusals:
            # Plan-level empty-spine rows carry condition_id "" — they get their
            # own key via `reason`, so a set comparison cannot silently drop them
            # and compare only the easy part.
            keys.add((name, r.condition_id, r.reason))
            classes[r.rule_class] = classes.get(r.rule_class, 0) + 1
    return keys, classes


def test_REGRESSION_refusal_set_identical_under_legacy_mandatory_roles(monkeypatch):
    """★★★ THE PROPERTY THIS ENTIRE CHANGE RESTS ON, PINNED IN CI.

    R-436/R-437: dropping `spine` from `_MANDATORY_ROLES` must change WHAT IS
    RECORDED and not WHAT IS REFUSED. Asserted as a SET comparison rather than a
    count, per R-421: equal counts with different members would be a silent swap
    — one rule stopping to refuse while another starts — and a count cannot see
    it.

    ★★ THE CONTROL IS LOAD-BEARING. If the monkeypatch silently failed to take,
    both arms would be the current code and the symmetric difference would be 0
    for a reason that proves nothing. So the class distribution MUST differ; a
    proof that cannot fail is not a proof.
    """
    # ★ PIN THE SHIPPED VALUE FIRST. Both arms below are monkeypatched, so this
    #   test proves a PROPERTY of the two role sets and would keep passing if
    #   someone reverted line 94. That revert is caught by the classifier tests
    #   above — but a reader would reasonably expect THIS test to catch it, so
    #   the shipped value is asserted here rather than left to inference.
    assert preflight_mod._MANDATORY_ROLES == frozenset({"invalidation"}), (
        "the shipped _MANDATORY_ROLES is not the post-R-436 value")
    assert "spine" not in preflight_mod._MANDATORY_ROLES

    legacy_keys, legacy_classes = _refusal_keys_and_classes(
        monkeypatch, _LEGACY_MANDATORY_ROLES)
    current_keys, current_classes = _refusal_keys_and_classes(
        monkeypatch, frozenset({"invalidation"}))

    # ── the safety property: membership, in both directions ─────────────────
    assert legacy_keys - current_keys == set(), (
        "a rule refused under the legacy roles is no longer refused — this is a "
        "RELAXATION and the change must not land")
    assert current_keys - legacy_keys == set(), (
        "a rule is newly refused — the change was supposed to move labels only")
    assert legacy_keys ^ current_keys == set()
    assert len(legacy_keys) == len(current_keys)
    assert legacy_keys, "corpus produced no refusals at all — the test is vacuous"

    # ── the control: the relabel actually happened ──────────────────────────
    assert legacy_classes != current_classes, (
        "class distribution is unchanged, so the monkeypatch never took effect "
        "and the set-identity above compares the code against itself")
    assert current_classes.get(UNKNOWN_REQUIREDNESS, 0) > legacy_classes.get(
        UNKNOWN_REQUIREDNESS, 0), "spine refusals did not move to UNKNOWN_REQUIREDNESS"
    assert current_classes.get(MANDATORY, 0) < legacy_classes.get(MANDATORY, 0), (
        "nothing stopped claiming source-requiredness — the point of the change")


def test_REGRESSION_every_refusal_still_blocks_whatever_its_class(monkeypatch):
    """The other half: honest labelling must not cost safety, for EVERY row.

    ★ A negative assertion needs a positive witness that the path ran — hence
      the non-empty check. "No refusal failed to block" is trivially satisfied
      by a corpus that produced no refusals."""
    keys, classes = _refusal_keys_and_classes(
        monkeypatch, frozenset({"invalidation"}))
    assert keys, "corpus produced no refusals — nothing was actually tested"
    for rule_class in classes:
        assert blocks_execution(rule_class) is True, (
            f"class {rule_class!r} appears in a refusal but does not block")


# ═══════════════════════════════════════════════════════════════════════════
# BLOCKER (ii) — NON_EXECUTABLE_EMPTY_SPINE: refuse, never fabricate an entry
# ═══════════════════════════════════════════════════════════════════════════

def test_ii_preflight_refuses_when_no_spine_predicate_is_executable():
    """EXIT_HINT is bindable but never executed, so this spec has a spine that
    produces NO predicate. Nothing is 'unbindable' here — only the empty-spine
    rule catches it, which is why it is a separate blocker."""
    # The ONLY spine row is EXIT_HINT: bindable, but executed=False, so it
    # yields no predicate. The trigger points at it, so nothing else is in the
    # spine to rescue the AND. (An ENABLE_ENTRY row would itself be an
    # executable spine predicate and mask the very path under test.)
    spec = _spec([_cond("s1", "EXIT_HINT", "take profit at 2R", "spine")], trigger_id="s1")
    plan = compile_binding_plan(spec["spec"])
    result = preflight_binding_plan(plan, strategy_id="strat-empty")

    assert result.refused is True
    assert any(x.reason == NON_EXECUTABLE_EMPTY_SPINE for x in result.refusals)


def test_ii_preflight_refuses_when_there_are_no_spine_conditions_at_all():
    spec = _spec([
        _cond("c1", "WAIT_STRUCTURE", "structure check", "confluence"),
        _cond("t1", "ENABLE_ENTRY", "entry trigger", "confluence"),
    ])
    plan = compile_binding_plan(spec["spec"])
    result = preflight_binding_plan(plan, strategy_id="strat-nospine")
    assert result.refused is True
    assert any(x.reason == NON_EXECUTABLE_EMPTY_SPINE for x in result.refusals)


def test_ii_compute_refuses_rather_than_fabricating_a_bar_zero_entry():
    """★★★ THE DECISIVE ONE. Before (ii), this spec computed an all-True spine
    and the rising edge fired exactly ONE entry at bar 0 — an entry no source
    rule authorized. It must now refuse instead."""
    # The ONLY spine row is EXIT_HINT: bindable, but executed=False, so it
    # yields no predicate. The trigger points at it, so nothing else is in the
    # spine to rescue the AND. (An ENABLE_ENTRY row would itself be an
    # executable spine predicate and mask the very path under test.)
    spec = _spec([_cond("s1", "EXIT_HINT", "take profit at 2R", "spine")], trigger_id="s1")
    strategy = from_compiled_spec(spec)
    with pytest.raises(NonExecutableEmptySpineError) as exc:
        strategy.compute(_synthetic_df())
    assert "spine" in str(exc.value).lower()


def test_ii_DISCRIMINATOR_normally_bound_spec_still_enters_exactly_as_before():
    """★★★ Green BOTH ways. Without this the empty-spine refusal cannot be told
    apart from a change that refuses everything. The entry count is pinned so a
    silent behaviour shift shows up as a number, not a vibe."""
    strategy = from_compiled_spec(_bound_spine_spec())
    out = strategy.compute(_synthetic_df())

    entry = np.array(out["entry_long"].to_list())
    fires = np.where(entry)[0].tolist()
    assert len(out) == N_BARS
    # rising-edge semantics preserved: never two consecutive fires
    assert not any(entry[i] and entry[i - 1] for i in range(1, len(entry)))
    # ★ PINNED OBSERVABLES, measured on the pre-change build — not guessed.
    #   Bar 30 is where ny_am opens for this fixture, i.e. the entry is driven
    #   by the session predicate. The empty-spine hazard fires at bar 0 instead
    #   (the AND-identity fallback), so this exact index is what distinguishes a
    #   real session-driven entry from a fabricated one.
    assert fires == [30], f"bound spec's entry bars moved to {fires}"


def test_ii_DISCRIMINATOR_bound_spec_passes_preflight_clean():
    plan = compile_binding_plan(_bound_spine_spec()["spec"])
    result = preflight_binding_plan(plan, strategy_id="strat-ok")
    assert result.refused is False
    assert result.refusals == []
