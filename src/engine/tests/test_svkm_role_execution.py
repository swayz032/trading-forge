"""SVKM-ROLE-EXEC-1 acceptance — does the ROLE VALUE change what the engine reads?

Authority: AR-1113 §3 (narrow adapter authorised), §3.2 (fail-closed list), §6.B/C/F
(role-divergence, scalar-fallback and causality discriminators).

🛑 THE QUESTION THIS SUITE EXISTS TO ANSWER
--------------------------------------------
`[MEASURED, AR-1113 §2.4]` the previous step's defect was NOT that the carrier was wrong.
It was that the carrier was parsed and then never read, so a passing validation proved
nothing about execution. A suite that only checked "the adapter accepts the sVkm role
set" would reproduce exactly that defect one layer up.

    ★★★★★ `A TEST THAT ACCEPTS A VALUE WITHOUT SHOWING THE VALUE CHANGED SOMETHING IS
       THE VALIDATION-WITHOUT-CONSUMPTION DEFECT, WEARING A TEST'S CLOTHES.`

So the load-bearing controls here are the ones where a NUMBER MOVES or a RUN REFUSES.

AR-1115 RESHAPED THIS SUITE, AND THE REASON MATTERS
---------------------------------------------------
Sections 1-7 originally proved `build_causal_opening_range`, and AR-1115 section 2.4
established that SYSTEM-INVENTORY classified that helper BUILT-UNREACHABLE: the money
path never called it. Those proofs were therefore evidence about dead code.

    ***** `A SAFETY PROOF ATTACHED TO DEAD CODE IS NOT PRODUCTION EVIDENCE.`

The helper is deleted and its unique refusals were MEASURED against the production seam
before removal, not argued about. What remains here is the narrow primitives production
actually calls (section 6), the wiring proofs (section 8), and the production-seam
proofs that call `_h_opening_range` itself (section 9).
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

from src.engine.opening_range_definition import (
    OpeningRangeDefinition,
    OpeningRangeProvenance,
    OpeningRangeVariant,
)
from src.engine.source_timeframe_roles import (
    BREAKOUT_CONFIRMATION,
    ENTRY_COMPLETION,
    EXPLICIT,
    FVG_DETECTION,
    OPENING_RANGE_WINDOW,
    SOURCE_RESOLVED_BY_CONTINUITY,
    SourceTimeframeRoleError,
    SourceTimeframeRoles,
    TimeframeRoleBinding,
)
from src.engine.svkm_role_execution import (
    RoleFrame,
    SourceRoleExecutionError,
    assert_svkm_role_combination,
    parse_minutes,
)

NY = ZoneInfo("America/New_York")
SESSION = date(2026, 4, 15)  # an ordinary EDT weekday

FIVE = OpeningRangeVariant(
    variant_label="5m", duration_minutes=5, source_quote="that first 5-minute candle"
)
FIFTEEN = OpeningRangeVariant(
    variant_label="15m", duration_minutes=15, source_quote="the first fifteen minutes"
)

DEFINITION = OpeningRangeDefinition(
    session_start_local="09:30",
    source_timezone="America/New_York",
    variants=(FIVE, FIFTEEN),
    market_scope="US equity index, regular-session opening",
    trading_day_rule="resets each regular-session open",
    provenance=OpeningRangeProvenance(
        source_quote="mark out the high and the low of that first 5-minute candle",
        condition_id="TEST_ONLY:svkm-role-execution",
    ),
)


def _open(minute_offset: int, *, tz=NY) -> datetime:
    """The instant `minute_offset` minutes after the 09:30 local open."""
    start = datetime(SESSION.year, SESSION.month, SESSION.day, 9, 30, tzinfo=NY)
    return (start + timedelta(minutes=minute_offset)).astimezone(tz)


# ── THE sVkm ROLE SET, WITH THE GRADES AR-1109 ESTABLISHED ───────────────────
# The two continuity grades are NOT upgraded to EXPLICIT just because they equal 1m
# (AR-1110 §3). The grade travels with the value so a later reader cannot launder a
# continuity inference into a quotation.
def _svkm_roles(opening_range_tf: str = "5m") -> SourceTimeframeRoles:
    return SourceTimeframeRoles(
        bindings=(
            TimeframeRoleBinding(
                role=OPENING_RANGE_WINDOW,
                timeframe=opening_range_tf,
                evidence_grade=EXPLICIT,
                source_quote="the first five minute candle of the day, wicks included",
                condition_id="TEST_ONLY:svkm-or-window",
            ),
            TimeframeRoleBinding(
                role=BREAKOUT_CONFIRMATION,
                timeframe="1m",
                evidence_grade=EXPLICIT,
                source_quote="switch to the one minute and wait for a close outside",
                condition_id="TEST_ONLY:svkm-breakout",
            ),
            TimeframeRoleBinding(
                role=FVG_DETECTION,
                timeframe="1m",
                evidence_grade=SOURCE_RESOLVED_BY_CONTINUITY,
                source_quote="then you look for your gap",
                condition_id="TEST_ONLY:svkm-fvg",
            ),
            TimeframeRoleBinding(
                role=ENTRY_COMPLETION,
                timeframe="1m",
                evidence_grade=SOURCE_RESOLVED_BY_CONTINUITY,
                source_quote="enter on the close of that third candle",
                condition_id="TEST_ONLY:svkm-entry",
            ),
        )
    )


# ── THE FRAMES ───────────────────────────────────────────────────────────────
# The 5m opening-range frame's FIRST bar is the 09:30 candle — the only bar inside a
# 5-minute window sampled at 5m, which is what makes "uniquely identified" meaningful.
def _or_frame_5m(high: float = 100.50, low: float = 99.75) -> RoleFrame:
    return RoleFrame(
        timeframe="5m",
        timestamps=(_open(0), _open(5), _open(10)),
        highs=(high, 100.90, 101.10),
        lows=(low, 100.10, 100.40),
    )


def test_a_missing_role_refuses_at_the_carrier_not_here():
    """An incomplete role set never reaches this adapter — the carrier refuses first."""
    with pytest.raises(SourceTimeframeRoleError, match="missing required timeframe role"):
        SourceTimeframeRoles(bindings=_svkm_roles().bindings[:3])


def test_an_empty_frame_refuses():
    with pytest.raises(SourceRoleExecutionError, match="empty"):
        RoleFrame(timeframe="5m", timestamps=(), highs=(), lows=())


def test_a_naive_timestamp_refuses():
    with pytest.raises(SourceRoleExecutionError, match="timezone-naive"):
        RoleFrame(
            timeframe="5m",
            timestamps=(datetime(2026, 4, 15, 9, 30),),
            highs=(100.0,),
            lows=(99.0,),
        )


# ══ 6. NO SCALAR FALLBACK — AR-1113 §3.2 / §6.C ══════════════════════════════


def test_the_module_has_no_scalar_fallback_path():
    """AR-1113 §3.2 forbids falling back to `strategy.timeframe`, `trigger_tf` or a
    lowest-timeframe rule. The way to forbid a fallback is not to write one.

    `[absence-claim]`: an absence proved by grep needs a POSITIVE CONTROL, or an empty
    result over the wrong file reads exactly like compliance.

    🛑 AND THE FIRST VERSION OF THIS TEST WAS THE INSTRUMENT LYING, NOT THE CODE.
    It stripped only the MODULE docstring by slicing on `\"\"\"`, so
    `build_causal_opening_range`'s docstring — which names the forbidden fallbacks in
    order to FORBID them — read as a violation. The code was clean the whole time.
    So the comparison is now done on the ABSTRACT SYNTAX TREE with every docstring
    removed: prose cannot reach it by construction.

    `A TEXT SEARCH OVER SOURCE CANNOT TELL A PROHIBITION FROM A VIOLATION —
     THEY ARE THE SAME CHARACTERS.`
    """
    import ast

    path = Path(__file__).resolve().parents[1].joinpath("svkm_role_execution.py")
    tree = ast.parse(path.read_text(encoding="utf-8"))

    # Drop every docstring — module, class and function — at the AST level.
    for node in ast.walk(tree):
        if isinstance(
            node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)
        ):
            body = getattr(node, "body", [])
            if (
                body
                and isinstance(body[0], ast.Expr)
                and isinstance(body[0].value, ast.Constant)
                and isinstance(body[0].value.value, str)
            ):
                node.body = body[1:]
    executable = ast.unparse(tree)  # comments are absent from an unparse by construction

    # POSITIVE CONTROL — if this fails, the pass read the wrong file or stripped too
    # much, and every absence assertion below is worthless.
    assert "OPENING_RANGE_WINDOW" in executable
    assert "assert_svkm_role_combination" in executable

    # NEGATIVE CONTROL on the STRIPPER ITSELF: a phrase that exists ONLY inside a
    # docstring must be gone. Without this, a stripper that deleted everything would
    # pass the absence assertions trivially.
    assert "NO SECOND CALCULATOR" not in executable

    for forbidden in ("strategy.timeframe", "trigger_tf", "lowest_timeframe"):
        assert forbidden not in executable, (
            f"a scalar fallback on {forbidden} reached the executable code"
        )


def test_parse_minutes_refuses_non_minute_timeframes():
    assert parse_minutes("5m") == 5
    assert parse_minutes("1m") == 1
    for bad in ("1h", "1d", "", "m", "0m", "5", "5M "):
        with pytest.raises(SourceRoleExecutionError):
            parse_minutes(bad)


# ══ 7. ANTI-STUB RED-PROOFS — DOES THIS SUITE HAVE POWER? ════════════════════


# ══ 8. THE WIRING — DOES THE MONEY PATH ACTUALLY READ THE ROLE? ══════════════
# Everything above proves the seam is correct. This section proves it is REACHED —
# which is the exact distinction AR-1113 §2.4 had to make about the previous step.


def _instance(timeframe: str, **kw):
    """A real `SpecConditionStrategy` on the committed Band-C-shaped fixture."""
    from src.engine.spec_condition_compiler import SpecConditionStrategy
    from src.engine.tests.test_source_vertical_join import _candidate, _compiled_spec

    return SpecConditionStrategy(
        compiled_spec=_compiled_spec(),
        symbol="MES",
        timeframe=timeframe,
        opening_range_candidate=_candidate(),
        **kw,
    )


def _resolve(strategy, execution_interval_minutes: int):
    """Call the production seam with one session of execution bars."""
    from src.engine.tests.test_source_vertical_join import _candidate

    ts_list = [_open(i * execution_interval_minutes) for i in range(0, 6)]
    return strategy._resolve_opening_range_source(
        candidate=_candidate(),
        zone=NY,
        ts_list=ts_list,
        high=[100.0 + i for i in range(6)],
        low=[99.0 + i for i in range(6)],
        indices_by_session={SESSION: list(range(6))},
        execution_interval_minutes=execution_interval_minutes,
    )


def test_wiring_legacy_no_roles_still_uses_the_execution_frame():
    """Byte-identical to the pre-AR-1113 behaviour when no role carrier is present."""
    grouped, interval = _resolve(_instance("5m"), 5)
    assert interval == 5
    assert len(grouped[SESSION]) == 6
    assert grouped[SESSION][0].high == pytest.approx(100.0)


def test_wiring_a_declared_5m_window_on_a_1m_instance_reads_the_5m_FRAME():
    """★ THE CLAIM OF THIS WHOLE UNIT, ASSERTED AT THE PRODUCTION SEAM.

    A 1-minute instance whose source declares a 5-minute opening-range window must
    aggregate the range from the 5-MINUTE frame — not from the 1-minute bars sitting in
    `ctx`, which is what shipped and what can still produce the right number.
    """
    strategy = _instance(
        "1m",
        source_timeframe_roles=_svkm_roles(),
        opening_range_source_frame=_or_frame_5m(high=101.25, low=98.50),
    )
    grouped, interval = _resolve(strategy, 1)

    assert interval == 5, "the range is still being counted in execution bars"
    bars = grouped[SESSION]
    assert len(bars) == 3, "the 5m frame's bars are not what reached the adapter"
    assert bars[0].high == pytest.approx(101.25)
    assert bars[0].low == pytest.approx(98.50)

    # NEGATIVE CONTROL — the 1m execution highs were 100..105 and its lows 99..104.
    # If any of those reached the aggregation, the role did not redirect the frame.
    assert all(b.high not in {100.0, 101.0, 102.0, 103.0, 104.0, 105.0} for b in bars)


def test_wiring_a_divergent_role_without_its_source_frame_REFUSES():
    """AR-1113 §3.2 — no fallback to the execution frame, even though it would 'work'."""
    from src.engine.family_meta_enforcement import FamilyMetaEnforcementError

    strategy = _instance("1m", source_timeframe_roles=_svkm_roles())
    with pytest.raises(FamilyMetaEnforcementError, match="NO 5m source frame was supplied"):
        _resolve(strategy, 1)


def test_wiring_a_mislabelled_source_frame_REFUSES():
    from src.engine.family_meta_enforcement import FamilyMetaEnforcementError

    mislabelled = RoleFrame(
        timeframe="5m",
        timestamps=tuple(_open(i) for i in range(0, 6)),  # 1-minute spacing
        highs=tuple(100.0 for _ in range(6)),
        lows=tuple(99.0 for _ in range(6)),
    )
    strategy = _instance(
        "1m",
        source_timeframe_roles=_svkm_roles(),
        opening_range_source_frame=mislabelled,
    )
    with pytest.raises(FamilyMetaEnforcementError, match="does not match the persisted role"):
        _resolve(strategy, 1)


def test_wiring_an_unauthorised_role_combination_REFUSES():
    """A non-sVkm combination is refused at the seam, not handled generically —
    this is what keeps the narrow adapter from becoming the framework §3 forbids."""
    from src.engine.family_meta_enforcement import FamilyMetaEnforcementError

    strategy = _instance(
        "1m",
        source_timeframe_roles=_svkm_roles(opening_range_tf="15m"),
        opening_range_source_frame=_or_frame_5m(),
    )
    with pytest.raises(FamilyMetaEnforcementError, match="not authorised"):
        _resolve(strategy, 1)


def test_wiring_red_proof_without_the_role_the_1m_frame_silently_wins():
    """★ THE DEFECT THIS UNIT REMOVES, DEMONSTRATED RATHER THAN DESCRIBED.

    Same 1-minute instance, same supplied 5m frame — but no role carrier. The engine
    aggregates the opening range off the 1-minute execution bars and says nothing. That
    is the behaviour that shipped; this test exists so the repair has a measured before.
    """
    strategy = _instance("1m", opening_range_source_frame=_or_frame_5m(high=101.25))
    grouped, interval = _resolve(strategy, 1)
    assert interval == 1
    assert grouped[SESSION][0].high == pytest.approx(100.0)  # a 1m execution bar
    assert all(b.high != pytest.approx(101.25) for b in grouped[SESSION])


def test_red_proof_the_role_combination_guard_is_what_refuses():
    """Without `assert_svkm_role_combination`, a 15m window role would sail through the
    remaining checks — the frames would simply be built for the wrong chart. Proven by
    calling the guard directly on both role sets."""
    assert_svkm_role_combination(_svkm_roles())  # the honest positive witness
    with pytest.raises(SourceRoleExecutionError):
        assert_svkm_role_combination(_svkm_roles(opening_range_tf="15m"))


# == 9. THE PRODUCTION SEAM ITSELF - AR-1115 section 3.2 =====================
#
# THE SECTIONS THAT USED TO SIT ABOVE THIS ONE PROVED `build_causal_opening_range`, AND
#    `[MEASURED, AR-1115 section 2.4]` NOTHING IN PRODUCTION EVER CALLED IT.
#    SYSTEM-INVENTORY classified it BUILT-UNREACHABLE and a grep for non-test callers
#    returned none, so AR-1115 section 3.3 deleted it and those sections went with it.
#
#      `A SAFETY PROOF ATTACHED TO DEAD CODE IS NOT PRODUCTION EVIDENCE.` (AR-1115 s1)
#
# These tests therefore call `_h_opening_range` - the handler the money path dispatches
# to - and nothing else. They are deliberately FEW, not twenty-five: the ruling asked for
# the incomplete-window refusal and the causality mutation on the production path, and
# said in terms not to repeat the helper suite here.

import numpy as np  # noqa: E402

from src.engine.opening_range_candidate import (  # noqa: E402
    OpeningRangeExecutionCandidate,
)
from src.engine.spec_family_bindings import ConditionBinding  # noqa: E402

_OR_CONDITION_ID = "TEST_ONLY:svkm-role-execution"


def _prod_candidate() -> OpeningRangeExecutionCandidate:
    """The sVkm candidate: the taught 5-MINUTE window, owned by THIS condition.

    `source_condition_id` must equal the binding's `condition_id` or the handler refuses
    on a different rule entirely (the AR-1034 identity join), which would make every
    assertion below pass for the wrong reason.
    """
    return OpeningRangeExecutionCandidate(
        source_spec_id="TEST_ONLY:svkm",
        source_condition_id=_OR_CONDITION_ID,
        definition=DEFINITION,
        variant=FIVE,
    )


def _prod_binding() -> ConditionBinding:
    return ConditionBinding(
        condition_id=_OR_CONDITION_ID,
        type="OPENING_RANGE_DEFINITION",
        role="context",
        object="opening_range",
        bindable=True,
        primitive="opening_range_adapter.compute_opening_range_state",
        approximation=False,
        executed=True,
    )


def _prod_strategy(*, roles=None, frame=None):
    """A real `SpecConditionStrategy` executing on 1m, with the sVkm candidate."""
    from src.engine.spec_condition_compiler import SpecConditionStrategy
    from src.engine.tests.test_source_vertical_join import _compiled_spec

    return SpecConditionStrategy(
        compiled_spec=_compiled_spec(),
        symbol="MES",
        timeframe="1m",
        opening_range_candidate=_prod_candidate(),
        source_timeframe_roles=roles,
        opening_range_source_frame=frame,
    )


def _prod_ctx(minutes: int = 15) -> dict:
    """`minutes` one-minute EXECUTION bars from 09:30. Held CONSTANT across mutations."""
    ts_list = [_open(i) for i in range(minutes)]
    return {
        "n": minutes,
        "ts_list": ts_list,
        "high": np.array([100.0 + i * 0.05 for i in range(minutes)], dtype=float),
        "low": np.array([99.5 + i * 0.05 for i in range(minutes)], dtype=float),
    }


def _frame_5m(*, high: float = 100.50, low: float = 99.75, skip_open: bool = False):
    """The 5m source frame. `skip_open=True` omits the 09:30 candle - the taught window."""
    stamps = (_open(5), _open(10)) if skip_open else (_open(0), _open(5), _open(10))
    highs = (100.90, 101.10) if skip_open else (high, 100.90, 101.10)
    lows = (100.10, 100.40) if skip_open else (low, 100.10, 100.40)
    return RoleFrame(timeframe="5m", timestamps=stamps, highs=highs, lows=lows)


# -- A. PRODUCTION INCOMPLETE-WINDOW REFUSAL (AR-1115 section 3.2 A) ---------


def test_PRODUCTION_a_missing_0930_source_bar_REFUSES_not_masks():
    """AR-1115 section 3.2 A, ON THE PATH THAT RUNS.

    The 5m source frame exists, is correctly labelled and correctly spaced - it simply
    does not carry the 09:30 candle the source teaches. The adapter therefore returns
    INCOMPLETE_OPENING_WINDOW, and BEFORE this unit the handler answered that with
    `continue`: an all-False column indistinguishable from a genuinely quiet day.
    """
    from src.engine.family_meta_enforcement import FamilyMetaEnforcementError

    strategy = _prod_strategy(roles=_svkm_roles(), frame=_frame_5m(skip_open=True))
    with pytest.raises(
        FamilyMetaEnforcementError, match="ONE COMPLETE taught opening range"
    ):
        strategy._h_opening_range(_prod_binding(), _prod_ctx())


def test_PRODUCTION_a_session_absent_from_the_source_frame_REFUSES():
    """The other half of "missing": the source chart does not cover this session AT ALL,
    so the handler never reaches the adapter. Under a role contract that is still an
    absent required input, not a quiet day."""
    from src.engine.family_meta_enforcement import FamilyMetaEnforcementError

    elsewhere = RoleFrame(
        timeframe="5m",
        timestamps=tuple(_open(i) + timedelta(days=7) for i in (0, 5, 10)),
        highs=(100.50, 100.90, 101.10),
        lows=(99.75, 100.10, 100.40),
    )
    strategy = _prod_strategy(roles=_svkm_roles(), frame=elsewhere)
    with pytest.raises(FamilyMetaEnforcementError, match="NO source bar covers session"):
        strategy._h_opening_range(_prod_binding(), _prod_ctx())


def test_PRODUCTION_the_POSITIVE_WITNESS_the_same_setup_COMPLETE_does_not_refuse():
    """WITHOUT THIS, BOTH REFUSALS ABOVE ARE SATISFIED BY A HANDLER THAT REFUSES
    EVERYTHING. The identical instance with the 09:30 bar present must run to completion
    and produce the taught levels off the 5m frame."""
    strategy = _prod_strategy(
        roles=_svkm_roles(), frame=_frame_5m(high=100.50, low=99.75)
    )
    out = strategy._h_opening_range(_prod_binding(), _prod_ctx())

    assert out.any(), "the window never became available, so nothing was actually executed"
    record = strategy._source_or_sessions[SESSION]
    assert record.or_high == pytest.approx(100.50)
    assert record.or_low == pytest.approx(99.75)


def test_PRODUCTION_LEGACY_no_role_contract_still_MASKS_rather_than_refusing():
    """THE OTHER SIDE OF THE CONTRACT, AND THE REASON THE REFUSAL IS CONDITIONAL.

    AR-1115 section 3.1: legacy/no-role execution keeps its historical behaviour. The
    same 1m instance with the same incomplete window and NO role carrier must still
    return an all-False column - a strategy that never declared a source-owned window
    taught us nothing about which days are required to have one.
    """
    strategy = _prod_strategy(roles=None, frame=None)
    out = strategy._h_opening_range(_prod_binding(), _prod_ctx(minutes=3))

    assert out.dtype == bool and len(out) == 3
    assert not out.any(), "legacy behaviour changed: a quiet day is no longer all-False"


# -- B. PRODUCTION CAUSALITY MUTATION (AR-1115 section 3.2 B) ----------------


def test_PRODUCTION_the_5m_range_cannot_reach_a_pre_lock_1m_bar():
    """AR-1115 section 3.2 B - NO 1m BAR MAY READ A FUTURE 5m HIGH/LOW, ON PRODUCTION.

    The 1-minute EXECUTION bars are byte-identical between the two runs. The ONLY
    difference is information INSIDE the 09:30-09:35 source candle: its high moves from
    100.50 to 133.00, which changes the completed 5m range.

    If the production lock comparison (`ts_list[i] >= lock`) regressed, the 09:30..09:34
    bars would become available before the candle that defines their range had closed -
    a bar reading its own future. The availability column must be IDENTICAL across the
    mutation, and only the post-lock levels may move.
    """
    ctx = _prod_ctx()

    baseline = _prod_strategy(roles=_svkm_roles(), frame=_frame_5m(high=100.50))
    out_base = baseline._h_opening_range(_prod_binding(), ctx)

    mutated = _prod_strategy(roles=_svkm_roles(), frame=_frame_5m(high=133.00))
    out_mut = mutated._h_opening_range(_prod_binding(), ctx)

    # 1. THE MUTATION ACTUALLY LANDED - otherwise this test compares two identical runs
    #    and passes on a handler that ignores the source frame entirely.
    assert baseline._source_or_sessions[SESSION].or_high == pytest.approx(100.50)
    assert mutated._source_or_sessions[SESSION].or_high == pytest.approx(133.00)

    # 2. THE PRE-LOCK WINDOW IS NON-EMPTY - a vacuous causality assertion is the trap
    #    here: with no pre-lock bars, "no pre-lock bar leaked" is true of everything.
    lock_idx = baseline._source_or_sessions[SESSION].lock_idx
    assert lock_idx == 5, (
        f"the 5-minute window should lock at the 09:35 bar (index 5), not {lock_idx}; "
        f"with a different lock this test is no longer measuring causality"
    )
    assert not out_base[:lock_idx].any(), "a pre-lock 1m bar was already gated available"

    # 3. AVAILABILITY IS BYTE-IDENTICAL ACROSS THE MUTATION, PRE- AND POST-LOCK.
    assert np.array_equal(out_base, out_mut), (
        "changing information inside the 09:30 5m candle changed which 1m bars are "
        "available - the production handler is leaking future 5m information"
    )
    assert mutated._source_or_sessions[SESSION].lock_idx == lock_idx


# -- C. ASSERTIONS MIGRATED OFF THE DELETED HELPER (AR-1115 section 3.3) -----
#
# `build_causal_opening_range` / `CausalOpeningRange` are DELETED by this unit. Before
# deleting them I measured each of their unique refusals against the production seam
# rather than reasoning about it, because deleting a safety assertion with no production
# twin is a regression wearing the word "cleanup". The three below had real twins and are
# pinned here so the deletion cannot quietly take them with it.
#
# ONE helper refusal is deliberately NOT migrated: the helper refused two frames whose
# timestamps were expressed in DIFFERENT ZONES, and its own docstring called that
# "deliberately stricter than the instants require". `[MEASURED]` production accepts the
# same instants expressed in UTC and produces the identical taught range (or_high 100.50,
# lock_idx 5), because `astimezone()` recovers the taught session date. That strictness
# was a property of the helper's representation, not a safety property of the money path.
#
#   `A REFUSAL THE PRODUCTION PATH HAS NO REASON TO MAKE IS NOT A SAFETY ASSERTION
#    YOU ARE LOSING - BUT YOU OWE THE MEASUREMENT THAT SAYS WHICH KIND IT WAS.`


def test_PRODUCTION_naive_ET_stamps_mislabelled_as_UTC_REFUSE():
    """THE REAL DEFECT THE DELETED ZONE TEST WAS PROTECTING AGAINST.

    Wall-clock ET stamps localised as UTC are DIFFERENT INSTANTS - they select a 5m
    candle four hours from the taught one, and every downstream number stays plausible.
    Production catches this through the AR-1115 3.1 refusal: the taught 09:30 window has
    no source bar, so the required source fact is absent and the run refuses.
    """
    from src.engine.family_meta_enforcement import FamilyMetaEnforcementError

    mislocalised = RoleFrame(
        timeframe="5m",
        timestamps=tuple(_open(i).replace(tzinfo=UTC) for i in (0, 5, 10)),
        highs=(100.50, 100.90, 101.10),
        lows=(99.75, 100.10, 100.40),
    )
    strategy = _prod_strategy(roles=_svkm_roles(), frame=mislocalised)
    with pytest.raises(FamilyMetaEnforcementError):
        strategy._h_opening_range(_prod_binding(), _prod_ctx())


def test_PRODUCTION_a_duplicated_0930_source_bar_REFUSES():
    """AR-1113 section 3.2 - "the opening-range bar cannot be uniquely identified"."""
    from src.engine.family_meta_enforcement import FamilyMetaEnforcementError

    dup = RoleFrame(
        timeframe="5m",
        timestamps=(_open(0), _open(0), _open(5)),
        highs=(100.50, 100.55, 100.90),
        lows=(99.75, 99.70, 100.10),
    )
    strategy = _prod_strategy(roles=_svkm_roles(), frame=dup)
    with pytest.raises(FamilyMetaEnforcementError, match="does not match the persisted role"):
        strategy._h_opening_range(_prod_binding(), _prod_ctx())


def test_PRODUCTION_a_frame_labelled_for_the_wrong_role_REFUSES():
    """A correctly-spaced 5-minute series wearing a `1m` label under a 5m role."""
    from src.engine.family_meta_enforcement import FamilyMetaEnforcementError

    wrong = RoleFrame(
        timeframe="1m",
        timestamps=(_open(0), _open(5), _open(10)),
        highs=(100.50, 100.90, 101.10),
        lows=(99.75, 100.10, 100.40),
    )
    strategy = _prod_strategy(roles=_svkm_roles(), frame=wrong)
    with pytest.raises(FamilyMetaEnforcementError, match="does not match the persisted role"):
        strategy._h_opening_range(_prod_binding(), _prod_ctx())
