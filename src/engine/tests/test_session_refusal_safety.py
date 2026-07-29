"""SAFETY RELEASE regression matrix — R-420 (money-path/H1 campaign).

THE DEFECT THIS SUITE EXISTS TO PREVENT RECURRING
-------------------------------------------------
`spec_family_bindings.resolve_session_keyword()` recognizes the phrases
"overnight / globex / asia session / pre market / premarket" and "lunch /
midday / noon session" and binds them to `session_windows` with
`approximation=False` — an EXACTNESS CLAIM. But `session_windows._ZONE_CHECKS`
has no entry for either zone, so `is_in_killzone()` returns False for every
minute of the day (measured: 0 of 1440, vs 180 of 1440 for `ny_am`).

So the rule "only trade during X" silently became "never trade" — and the
naive fix (mark it unbindable) would have silently made it "trade ALWAYS",
because `spec_condition_compiler.compute()` converted an unbindable spine
condition into `np.ones(n)`, the AND identity, under a comment calling that
an "honest default".

R-420: an uncompilable MANDATORY rule is neither true nor false — it is an
UNRESOLVED EXECUTION ERROR. True widens the strategy, false disables it;
only an explicit third state preserves the source. Hence three edits:

  (A) RESOLVER  — refuse the orphan zone, honestly, with a named reason.
  (B) PREFLIGHT — refuse the BACKTEST when a mandatory rule is unbindable.
  (C) ASSERTION — the consumer refuses too, even if (B) regresses.

Run targeted (bare collection over src/engine/tests hangs — see sibling suites):
    python -m pytest src/engine/tests/test_session_refusal_safety.py -v
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import numpy as np
import polars as pl
import pytest

from src.engine.session_windows import is_in_killzone
from src.engine.spec_condition_compiler import from_compiled_spec
from src.engine.spec_execution_preflight import (
    MANDATORY,
    OPTIONAL,
    OPTIONAL_CANDIDATE,
    UNKNOWN_REQUIREDNESS,
    UnresolvedMandatoryRuleError,
    blocks_execution,
    classify_rule_role,
    preflight_binding_plan,
    resolve_rule_class,
)
from src.engine.spec_family_bindings import (
    bind_condition,
    compile_binding_plan,
    refused_session_zone,
    session_refusal_reason,
)

N_BARS = 120


def _synthetic_df(seed: int = 42) -> pl.DataFrame:
    rng = np.random.default_rng(seed)
    start = datetime(2026, 1, 5, 9, 30, tzinfo=UTC)
    ts = [start + timedelta(minutes=5 * i) for i in range(N_BARS)]
    close = 5000 + np.cumsum(rng.normal(0, 1.0, N_BARS))
    high = close + rng.uniform(0.2, 1.5, N_BARS)
    low = close - rng.uniform(0.2, 1.5, N_BARS)
    open_ = close + rng.normal(0, 0.3, N_BARS)
    vol = rng.integers(500, 2000, N_BARS)
    return pl.DataFrame(
        {
            "ts_event": ts,
            "open": open_.astype(np.float64),
            "high": high.astype(np.float64),
            "low": low.astype(np.float64),
            "close": close.astype(np.float64),
            "volume": vol.astype(np.int64),
        }
    )


def _spec_with_spine(object_text: str, role: str = "spine") -> dict:
    """A compiled_spec whose ONLY spine condition is the one under test."""
    return {
        "video": "TESTVID",
        "spec_hash": "safetyrelease420",
        "graph_canonical_hash": "x",
        "ledger_d": "CONSERVED",
        "spec": {
            "direction": "long",
            "entry_conditions": [
                {
                    "id": "s1",
                    "type": "WAIT_SESSION",
                    "object": object_text,
                    "role": role,
                    "span": {"start": 0, "end": 1},
                    "evidence": "ev1",
                },
                {
                    "id": "t1",
                    "type": "ENABLE_ENTRY",
                    "object": "entry trigger",
                    "role": "trigger",
                    "span": {"start": 1, "end": 2},
                    "evidence": "ev2",
                },
            ],
            "and_groups": [],
            "or_branches": [],
            "invalidations": [],
            "entry_trigger_id": "t1",
        },
    }


# ═══════════════════════════════════════════════════════════════════════════
# STANDING FACT — the measurement that makes the whole release necessary.
# This is a CHARACTERIZATION test of session_windows, not of the fix: it must
# hold both before and after, and it is what proves the orphan zones have no
# evaluable window rather than merely a wrong one.
# ═══════════════════════════════════════════════════════════════════════════

def test_orphan_zones_are_true_on_zero_minutes_and_real_zones_are_not():
    base = datetime(2026, 7, 28, 0, 0, tzinfo=UTC)

    def true_minutes(zone: str) -> int:
        return sum(1 for m in range(1440) if is_in_killzone(base + timedelta(minutes=m), zone))

    # The orphan zones: recognized by the vocabulary, evaluable on no minute.
    assert true_minutes("overnight") == 0
    assert true_minutes("lunch_blackout") == 0
    # ★ CONTROL — without these the assertion above is satisfied by a broken
    #   is_in_killzone that returns False for everything.
    assert true_minutes("ny_am") == 180
    assert true_minutes("london") == 180


# ═══════════════════════════════════════════════════════════════════════════
# ★★★ THE CLASS GUARD — this is the test that makes the defect unrepeatable.
#
# The original bug was possible because a phrase could be added to the BIND
# table without anyone adding a clock for it to bind TO. That is a MEMBERSHIP
# invariant, and nothing asserted it — the 50% ratio guard nearby is a
# CARDINALITY test and structurally cannot express it.
#
# Anyone who adds a session keyword without a matching _ZONE_CHECKS entry now
# fails here, at the table, instead of shipping a rule that silently never
# fires. Deliberately asserts BOTH directions.
# ═══════════════════════════════════════════════════════════════════════════

def test_CLASS_GUARD_every_bindable_zone_has_an_evaluable_window():
    from src.engine.session_windows import _ZONE_CHECKS
    from src.engine.spec_family_bindings import REFUSED_SESSION_KEYWORDS, SESSION_KEYWORDS

    bindable_zones = set(SESSION_KEYWORDS)
    evaluable_zones = set(_ZONE_CHECKS)

    orphans = bindable_zones - evaluable_zones
    assert not orphans, (
        f"zone(s) {sorted(orphans)} can be BOUND but have no window in "
        "session_windows._ZONE_CHECKS — is_in_killzone() will return False on "
        "every bar, so the rule silently never fires. Either add a clock or "
        "move the phrase to REFUSED_SESSION_KEYWORDS."
    )
    # The other direction: a refused zone must NOT also be bindable, or the
    # two tables would disagree about the same phrase.
    assert not (set(REFUSED_SESSION_KEYWORDS) & bindable_zones)


# ═══════════════════════════════════════════════════════════════════════════
# (A) RESOLVER — recognized session with no clock -> refused, honestly
# ═══════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize(
    "object_text,expected_zone",
    [
        ("pre market vwap analysis routine", "overnight"),
        ("wait for the asia session to complete", "overnight"),
        ("globex open drive", "overnight"),
        ("overnight", "overnight"),
        ("avoid the lunch chop", "lunch_blackout"),
        ("midday", "lunch_blackout"),
    ],
)
def test_orphan_zone_is_refused_never_bound(object_text: str, expected_zone: str):
    """RED without (A): today these bind with approximation=False — a false
    concrete for a zone with no evaluable window."""
    cond = {"id": "c1", "type": "WAIT_SESSION", "object": object_text, "role": "spine"}
    b = bind_condition(cond)

    assert refused_session_zone(object_text) == expected_zone
    # ★ The trio that keeps the row OUT of the concrete count. Change any one
    #   of the three and the false concrete comes back.
    assert b.bindable is False
    assert b.primitive is None
    assert b.approximation is True
    assert b.executed is False
    assert b.session_zone is None
    assert b.reason == session_refusal_reason(expected_zone)
    # Distinct from "we never recognized it" — that distinction IS the finding.
    assert b.reason != "no_recognized_session_keyword"


def test_refusal_is_distinguishable_from_unrecognized_vocabulary():
    refused = bind_condition(
        {"id": "c1", "type": "WAIT_SESSION", "object": "pre market range", "role": "spine"}
    )
    unrecognized = bind_condition(
        {"id": "c2", "type": "WAIT_SESSION", "object": "information events", "role": "spine"}
    )
    assert refused.bindable is False and unrecognized.bindable is False
    assert refused.reason != unrecognized.reason
    assert unrecognized.reason == "no_recognized_session_keyword"


# ★★★ THE DISCRIMINATOR — green BOTH before and after the port. Without it the
#     suite cannot tell "the fix works" from "the fix refuses everything", and
#     a refusal-shaped change is exactly the kind that passes by over-refusing.
@pytest.mark.parametrize(
    "object_text,expected_zone",
    [
        ("ny am session", "ny_am"),
        ("london open", "london"),
        ("new york afternoon", "ny_pm"),
        ("silver bullet", "silver_bullet"),
    ],
)
def test_DISCRIMINATOR_configured_sessions_still_bind_normally(object_text: str, expected_zone: str):
    cond = {"id": "c1", "type": "WAIT_SESSION", "object": object_text, "role": "spine"}
    b = bind_condition(cond)
    assert b.bindable is True, "the port must not refuse sessions that HAVE a clock"
    assert b.session_zone == expected_zone
    assert b.primitive == "session_windows"
    assert b.approximation is False
    assert b.executed is True
    assert refused_session_zone(object_text) is None


# ═══════════════════════════════════════════════════════════════════════════
# (B) PREFLIGHT — the execution boundary enforces executability
# ═══════════════════════════════════════════════════════════════════════════

def test_role_classification_fails_closed():
    # ★★★ UPDATED BY R-436/R-438: `spine` used to be MANDATORY here. [MEASURED
    #   at the producer, R-432] it is the ELSE-ARM of a topology test in
    #   `graph-to-engine.ts` — a condition becomes `spine` by failing to look
    #   like anything else — so it was never evidence that the SOURCE required
    #   the rule. It now classifies as UNKNOWN_REQUIREDNESS and BLOCKS
    #   IDENTICALLY; the refusal set does not move, only the recorded claim.
    #   The safety half is asserted immediately below, never dropped.
    assert classify_rule_role("spine") == UNKNOWN_REQUIREDNESS
    assert blocks_execution(classify_rule_role("spine")) is True
    # ★ `invalidation` is assigned BY TYPE from the atom's own semantics, so it
    #   IS source evidence and stays MANDATORY. This is the discriminator: it
    #   proves the relabel was targeted rather than a blanket collapse.
    assert classify_rule_role("invalidation") == MANDATORY
    # R-420: `confluence` is a CANDIDATE, not a licence — role is mutable
    # in-flight (spec_family_bindings.py:160-165 documents a demotion path), so
    # the label alone is not proof of optionality.
    assert classify_rule_role("confluence") == OPTIONAL_CANDIDATE
    # ★★★ THE ARM THAT MATTERS — absent/unknown role refuses by default.
    #     `role` is read straight off the graph with an empty-string fallback
    #     (spec_family_bindings.py:562), so "absent" is reachable in practice.
    #
    # ★ UPDATED BY R-422 blocker (i): these used to return MANDATORY. They now
    #   return UNKNOWN_REQUIREDNESS — which BLOCKS IDENTICALLY (asserted below,
    #   so the safety property is still pinned here) but no longer records a
    #   requiredness claim the source never made. The consequence is unchanged;
    #   only the provenance is honest. See test_preflight_blockers.py.
    assert classify_rule_role("") == UNKNOWN_REQUIREDNESS
    assert classify_rule_role("trigger") == UNKNOWN_REQUIREDNESS
    assert classify_rule_role("annotation-we-have-never-seen") == UNKNOWN_REQUIREDNESS
    assert blocks_execution(classify_rule_role("")) is True
    assert blocks_execution(classify_rule_role("trigger")) is True


def test_optional_candidate_resolves_to_mandatory_without_positive_evidence():
    """The fail-closed half of R-420's role policy: a confluence label alone
    does NOT make a rule droppable; positive source evidence does."""
    assert resolve_rule_class("confluence", optional_evidence=False) == MANDATORY
    assert resolve_rule_class("confluence", optional_evidence=True) == OPTIONAL
    # Evidence can never downgrade a mandatory role.
    assert resolve_rule_class("invalidation", optional_evidence=True) == MANDATORY
    # ★★★ UPDATED BY R-436/R-438: `spine` resolves to UNKNOWN_REQUIREDNESS now
    #   (see test_role_classification_fails_closed for why). The property this
    #   line actually guards — OPTIONAL EVIDENCE CANNOT LAUNDER A BLOCKING ROLE
    #   INTO A DROPPABLE ONE — is unchanged and is re-asserted, not weakened:
    #   evidence=True still does not make it droppable, and it still blocks.
    assert resolve_rule_class("spine", optional_evidence=True) == UNKNOWN_REQUIREDNESS
    assert blocks_execution(resolve_rule_class("spine", optional_evidence=True)) is True
    # ★ UPDATED BY R-422 blocker (i): an absent role resolves to
    #   UNKNOWN_REQUIREDNESS rather than MANDATORY. The safety property under
    #   test — evidence cannot make it droppable — is asserted unchanged.
    assert resolve_rule_class("", optional_evidence=True) == UNKNOWN_REQUIREDNESS
    assert blocks_execution(resolve_rule_class("", optional_evidence=True)) is True


def test_preflight_refuses_unbindable_confluence_absent_positive_evidence():
    spec = _spec_with_spine("ny am session", role="spine")
    spec["spec"]["entry_conditions"].append(
        {
            "id": "c2",
            "type": "WAIT_SESSION",
            "object": "information events",
            "role": "confluence",
            "span": {"start": 3, "end": 4},
            "evidence": "ev3",
        }
    )
    plan = compile_binding_plan(spec["spec"])
    result = preflight_binding_plan(plan, strategy_id="strat-noevidence")
    assert result.refused is True, "absent positive evidence, an unbindable confluence rule refuses"


def test_preflight_refuses_mandatory_unbindable_rule_with_full_payload():
    spec = _spec_with_spine("pre market vwap analysis routine", role="spine")
    plan = compile_binding_plan(spec["spec"])
    result = preflight_binding_plan(plan, strategy_id="strat-123")

    assert result.refused is True
    # ★ UPDATED BY R-422 blocker (ii): this spec's only spine condition is the
    #   refused one, so it ALSO trips NON_EXECUTABLE_EMPTY_SPINE. Two refusals
    #   with two distinct reasons is the correct new behaviour — the assertion
    #   is tightened onto the specific condition rather than relaxed to a count.
    assert len(result.refusals) == 2
    assert {x.reason for x in result.refusals} == {
        session_refusal_reason("overnight"),
        "non_executable_empty_spine",
    }
    r = next(x for x in result.refusals if x.condition_id == "s1")
    # R-420: strategy id · rule text · semantic type · reason.
    assert r.strategy_id == "strat-123"
    assert r.rule_text == "pre market vwap analysis routine"
    assert r.semantic_type == "WAIT_SESSION"
    assert r.role == "spine"
    assert r.reason == session_refusal_reason("overnight")
    assert "overnight" in r.reason


def test_preflight_refuses_unknown_or_absent_role():
    spec = _spec_with_spine("information events", role="")
    plan = compile_binding_plan(spec["spec"])
    result = preflight_binding_plan(plan, strategy_id="strat-norole")
    assert result.refused is True
    assert any(r.role == "" for r in result.refusals)


def test_preflight_allows_optional_unresolved_but_reports_it_visibly():
    """An OPTIONAL unresolved rule proceeds — but is recorded as
    OPTIONAL_NOT_APPLIED, never as 'an unbindable rule converted to true'."""
    spec = _spec_with_spine("ny am session", role="spine")
    spec["spec"]["entry_conditions"].append(
        {
            "id": "c2",
            "type": "WAIT_SESSION",
            "object": "information events",
            "role": "confluence",
            "span": {"start": 3, "end": 4},
            "evidence": "ev3",
        }
    )
    plan = compile_binding_plan(spec["spec"])
    result = preflight_binding_plan(
        plan, strategy_id="strat-opt", optional_condition_ids=frozenset({"c2"})
    )

    assert result.refused is False, "an optional unresolved annotation must not block"
    assert len(result.warnings) == 1
    w = result.warnings[0]
    assert w["status"] == "OPTIONAL_NOT_APPLIED"
    assert w["condition_id"] == "c2"
    assert w["rule_text"] == "information events"


# ★ CONTROL for the preflight: a fully-bound plan must pass cleanly. Without
#   this the refusal tests are satisfied by a preflight that refuses always.
def test_DISCRIMINATOR_fully_bound_plan_passes_preflight():
    spec = _spec_with_spine("ny am session", role="spine")
    plan = compile_binding_plan(spec["spec"])
    result = preflight_binding_plan(plan, strategy_id="strat-ok")
    assert result.refused is False
    assert result.refusals == []
    assert result.warnings == []


# ═══════════════════════════════════════════════════════════════════════════
# (C) ASSERTION AT THE POINT OF USE — the belt for when (B) regresses
# ═══════════════════════════════════════════════════════════════════════════

# ★★★ THE DECISIVE NEGATIVE TEST (R-420): an unbindable MANDATORY rule that is
#     SILENTLY OMITTED must make the test FAIL. This is the red-proof for the
#     silent-pass mode — the one that would have caught :616-620.
#
#     Deliberately uses a rule that is unbindable ALREADY, before edit (A), so
#     it red-proofs (C) on its own rather than inheriting (A)'s behaviour.
def test_unbindable_mandatory_rule_is_never_silently_omitted():
    spec = _spec_with_spine("information events", role="spine")  # unrecognized -> unbindable today
    df = _synthetic_df()
    strategy = from_compiled_spec(spec)

    with pytest.raises(UnresolvedMandatoryRuleError) as exc:
        strategy.compute(df)

    msg = str(exc.value)
    assert "information events" in msg, "the refusal must name the rule text"
    assert "no_recognized_session_keyword" in msg, "the refusal must name the reason"


def test_orphan_zone_rule_refuses_end_to_end_rather_than_trading_always():
    """The real-world case, both edits together: the phrase that production
    binds today must not reach execution as an always-true pass-through."""
    spec = _spec_with_spine("pre market vwap analysis routine", role="spine")
    df = _synthetic_df()
    strategy = from_compiled_spec(spec)
    with pytest.raises(UnresolvedMandatoryRuleError):
        strategy.compute(df)


# ★ CONTROL for (C): a bound spine rule computes normally and is NOT refused.
#   R-420's stop condition — (C) must not change behaviour for already-BOUND
#   rules — is exactly this assertion.
def test_DISCRIMINATOR_bound_rule_computes_without_raising():
    spec = _spec_with_spine("ny am session", role="spine")
    df = _synthetic_df()
    strategy = from_compiled_spec(spec)
    out = strategy.compute(df)
    assert "entry_long" in out.columns
    assert len(out) == N_BARS


# ═══════════════════════════════════════════════════════════════════════════
# (B) WIRING — the preflight must be CALLED, not merely importable.
# Existence is not wiring: these drive backtester.main() end to end.
# ═══════════════════════════════════════════════════════════════════════════

def _backtest_config(object_text: str, role: str = "spine") -> dict:
    return {
        "compiled_spec": _spec_with_spine(object_text, role=role),
        "strategy": {"name": "wiring-test-strategy", "symbol": "MES", "timeframe": "5m"},
        "start_date": "2026-01-01",
        "end_date": "2026-01-31",
    }


def test_WIRING_backtester_refuses_before_loading_data(capsys):
    """The refusal must happen at the backtest entry, not somewhere importable.
    Data loading is never reached — the run exits first."""
    import json as _json

    from src.engine.backtester import main as _main_cmd

    main = _main_cmd.callback  # click-wrapped CLI entry; call the function itself

    cfg = _json.dumps(_backtest_config("pre market vwap analysis routine"))
    with pytest.raises(SystemExit) as exc:
        main(cfg, backtest_id=None, mode="backtest", strategy_class=None)
    assert exc.value.code == 1

    payload = _json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert payload["refused_reason"] == "unresolved_mandatory_rules"
    assert payload["refused"] is True
    r = payload["refusals"][0]
    assert r["strategy_id"] == "wiring-test-strategy"
    assert r["rule_text"] == "pre market vwap analysis routine"
    assert r["semantic_type"] == "WAIT_SESSION"
    assert r["role"] == "spine"
    assert "overnight" in r["reason"]


def test_WIRING_walkforward_path_uses_the_same_preflight(capsys):
    """The walkforward and single-backtest paths share one construction site,
    so neither is a second door around the gate."""
    import json as _json

    from src.engine.backtester import main as _main_cmd

    main = _main_cmd.callback  # click-wrapped CLI entry; call the function itself

    cfg = _json.dumps(_backtest_config("pre market vwap analysis routine"))
    with pytest.raises(SystemExit) as exc:
        main(cfg, backtest_id=None, mode="walkforward", strategy_class=None)
    assert exc.value.code == 1
    payload = _json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert payload["refused"] is True


# ═══════════════════════════════════════════════════════════════════════════
# TRIPWIRE — a matrix row this release does NOT satisfy, recorded honestly.
# ═══════════════════════════════════════════════════════════════════════════

def test_TRIPWIRE_explicit_overnight_interval_is_still_unsupported():
    """R-420's matrix row "explicit 16:00-09:30 -> bindable, executable" is NOT
    implemented by this release, and deliberately so: binding an explicit
    interval requires a timezone/calendar basis, and R-417 records that basis as
    [UNENUMERATED] — is "4:00 p.m. - 9:30 a.m." exchange, chart, or educator-local
    time, and what happens across DST? Inventing an answer would be exactly the
    silent-semantic-rewrite this release exists to stop.

    ★ THIS TEST ASSERTS BOTH HALVES OF THE KNOWN-BROKEN STATE AND MUST BE
      DELETED when a ruling settles the clock basis and the binder lands.
    """
    cond = {
        "id": "c1",
        "type": "WAIT_SESSION",
        "object": "overnight range from 4:00 p.m. until 9:30 a.m.",
        "role": "spine",
    }
    b = bind_condition(cond)
    # half 1: it is refused, not bound...
    assert b.bindable is False
    # half 2: ...and refused as an uncomputable window, NOT parsed into an interval.
    assert b.reason == session_refusal_reason("overnight")
    assert b.session_zone is None
