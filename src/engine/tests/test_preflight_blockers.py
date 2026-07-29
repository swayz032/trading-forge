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
  "trigger" does NOT occur in corpus_A. So `spine`/`invalidation` are the only
  roles this campaign has evidence for; every other value, including "trigger",
  is UNKNOWN_REQUIREDNESS. It blocks either way; only the recorded provenance
  differs, and that is the whole point.

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
    """Only the roles corpus_A actually evidences are called source-mandatory."""
    assert classify_rule_role("spine") == MANDATORY
    assert classify_rule_role("invalidation") == MANDATORY
    assert classify_rule_role("confluence") == OPTIONAL_CANDIDATE


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
    """Control: the honest-labelling change must not relabel real spine rules."""
    spec = _spec([
        _cond("s1", "WAIT_SESSION", "information events", "spine"),
        _cond("t1", "ENABLE_ENTRY", "entry trigger", "spine"),
    ])
    plan = compile_binding_plan(spec["spec"])
    r = next(x for x in preflight_binding_plan(plan, strategy_id="s").refusals
             if x.condition_id == "s1")
    assert r.rule_class == MANDATORY


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
