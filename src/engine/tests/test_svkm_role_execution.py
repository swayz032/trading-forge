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

So the load-bearing controls here are the ones where a NUMBER MOVES or a RUN REFUSES:
`test_the_5m_frame_is_what_produces_the_levels`, `test_role_value_is_load_bearing_*`,
and the two anti-stub red-proofs at the bottom, which prove this suite can actually
reject the implementations it was built to reject.
"""

from __future__ import annotations

import dataclasses
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

from src.engine.opening_range_definition import (
    OpeningRangeDefinition,
    OpeningRangeProvenance,
    OpeningRangeVariant,
    OpeningRangeWindowStatus,
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
    CausalOpeningRange,
    RoleFrame,
    SourceRoleExecutionError,
    assert_svkm_role_combination,
    build_causal_opening_range,
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


def _exec_frame_1m() -> RoleFrame:
    return RoleFrame(
        timeframe="1m",
        timestamps=tuple(_open(i) for i in range(0, 15)),
        highs=tuple(100.0 + i * 0.05 for i in range(0, 15)),
        lows=tuple(99.5 + i * 0.05 for i in range(0, 15)),
    )


def _build(**overrides) -> CausalOpeningRange:
    kwargs = dict(
        roles=_svkm_roles(),
        definition=DEFINITION,
        variant=FIVE,
        opening_range_frame=_or_frame_5m(),
        execution_frame=_exec_frame_1m(),
        session_date=SESSION,
    )
    kwargs.update(overrides)
    return build_causal_opening_range(**kwargs)


# ══ 1. POSITIVE WITNESS ══════════════════════════════════════════════════════


def test_positive_witness_the_5m_window_produces_a_complete_range():
    """The taught 09:30 five-minute candle becomes a usable ORH/ORL."""
    causal = _build()
    state = causal.state_as_of(_open(5))
    assert state.opening_range_complete is True
    assert state.opening_range_high == pytest.approx(100.50)
    assert state.opening_range_low == pytest.approx(99.75)


def test_the_5m_frame_is_what_produces_the_levels():
    """★ THE LOAD-BEARING CONTROL. Change ONLY the 5m frame; the levels must follow.

    This is the discriminator the previous step could not offer: it proves the numbers
    come from the series the OPENING_RANGE_WINDOW role selected, not from the 1m
    execution series that happens to be sitting next to it.
    """
    baseline = _build().state_as_of(_open(5))
    widened = _build(opening_range_frame=_or_frame_5m(high=101.75, low=98.20))
    moved = widened.state_as_of(_open(5))

    assert moved.opening_range_high == pytest.approx(101.75)
    assert moved.opening_range_low == pytest.approx(98.20)
    assert moved.opening_range_high != baseline.opening_range_high
    assert moved.opening_range_low != baseline.opening_range_low


# ══ 2. CAUSALITY — AR-1113 §3.1 / §6.F ═══════════════════════════════════════


def test_no_1m_bar_before_the_lock_may_see_the_range():
    """Half-open `[start, lock)`: 09:30-09:34 see nothing, 09:35 is the first that may."""
    causal = _build()
    for minute in range(0, 5):
        state = causal.state_as_of(_open(minute))
        assert state.opening_range_complete is False, f"09:3{minute} saw a completed range"
        assert state.opening_range_high is None
        assert state.opening_range_low is None
        assert state.opening_range_window_status is OpeningRangeWindowStatus.FORMING
    assert causal.is_available_at(_open(5)) is True


def test_causality_mutation_the_final_minute_cannot_reach_earlier_1m_bars():
    """AR-1113 §6.F. Mutate the 5m candle's extremes — as its final minute would — and
    every PRE-LOCK 1m bar's available state must be byte-identical.

    If an earlier bar changes, the adapter is leaking future 5m information backwards.
    """
    baseline = _build()
    mutated = _build(opening_range_frame=_or_frame_5m(high=133.00, low=66.00))

    def _visible(causal):
        return [
            dataclasses.astuple(causal.state_as_of(_open(m))) for m in range(0, 5)
        ]

    assert _visible(baseline) == _visible(mutated), (
        "a pre-lock 1m bar's visible opening-range state changed when a value INSIDE "
        "the still-forming 5m candle changed — that is future information reaching "
        "earlier bars"
    )
    # POSITIVE WITNESS that the mutation was real and the comparison had power:
    # after the lock the very same mutation MUST move the levels.
    assert baseline.state_as_of(_open(5)).opening_range_high != pytest.approx(133.00)
    assert mutated.state_as_of(_open(5)).opening_range_high == pytest.approx(133.00)


# ══ 3. THE ROLE VALUE IS LOAD-BEARING — AR-1113 §6.B ═════════════════════════


def test_role_value_is_load_bearing_a_divergent_window_role_refuses():
    """Declare the opening-range window on a different chart and the run REFUSES.

    🛑 SCOPE, STATED HONESTLY: AR-1113 §6.B asks for a divergent role to CHANGE the
    computed ORH/ORL. Under the narrow authorisation of §3 this adapter is sVkm-only, so
    a divergent window role refuses instead. That still proves the value is consumed —
    a parser that merely accepted the string would run on unchanged — but it is a
    REFUSAL discriminator, not a recomputation one, and §6.B's literal form needs the
    generic path that §3 does not authorise. Disclosed rather than quietly satisfied.
    """
    with pytest.raises(SourceRoleExecutionError, match="5m-window / 1m-execution"):
        _build(roles=_svkm_roles(opening_range_tf="15m"))


def test_role_value_is_load_bearing_a_1m_window_role_refuses():
    """The exact defect the carrier was built to stop: the whole strategy on one chart."""
    with pytest.raises(SourceRoleExecutionError, match="OPENING_RANGE_WINDOW"):
        _build(roles=_svkm_roles(opening_range_tf="1m"))


def test_a_missing_role_refuses_at_the_carrier_not_here():
    """An incomplete role set never reaches this adapter — the carrier refuses first."""
    with pytest.raises(SourceTimeframeRoleError, match="missing required timeframe role"):
        SourceTimeframeRoles(bindings=_svkm_roles().bindings[:3])


# ══ 4. FRAME / ROLE DISAGREEMENT — AR-1113 §3.2 ══════════════════════════════


def test_a_1m_series_mislabelled_as_5m_refuses():
    """★ A LABEL CHECK CANNOT CATCH THIS — the declared string matches; the DATA does not."""
    mislabelled = RoleFrame(
        timeframe="5m",
        timestamps=tuple(_open(i) for i in range(0, 6)),  # 1-minute spacing
        highs=tuple(100.0 for _ in range(6)),
        lows=tuple(99.0 for _ in range(6)),
    )
    with pytest.raises(SourceRoleExecutionError, match="disagree"):
        _build(opening_range_frame=mislabelled)


def test_a_frame_declared_for_the_wrong_role_refuses():
    frame = _or_frame_5m()
    wrong = dataclasses.replace(frame, timeframe="15m")
    with pytest.raises(SourceRoleExecutionError, match="OPENING_RANGE_WINDOW declares"):
        _build(opening_range_frame=wrong)


def test_frames_in_different_zones_refuse():
    utc_exec = RoleFrame(
        timeframe="1m",
        timestamps=tuple(_open(i, tz=UTC) for i in range(0, 15)),
        highs=tuple(100.0 + i * 0.05 for i in range(0, 15)),
        lows=tuple(99.5 + i * 0.05 for i in range(0, 15)),
    )
    with pytest.raises(SourceRoleExecutionError, match="timezone identity"):
        _build(execution_frame=utc_exec)


def test_frames_not_expressed_in_the_taught_zone_refuse():
    """Deliberately stricter than the instants require, and the reason is a real defect
    class: a frame of naive ET stamps localised as UTC picks a 5m candle four hours from
    the taught one, and every downstream number stays plausible."""
    utc_or = RoleFrame(
        timeframe="5m",
        timestamps=(_open(0, tz=UTC), _open(5, tz=UTC), _open(10, tz=UTC)),
        highs=(100.50, 100.90, 101.10),
        lows=(99.75, 100.10, 100.40),
    )
    utc_exec = RoleFrame(
        timeframe="1m",
        timestamps=tuple(_open(i, tz=UTC) for i in range(0, 15)),
        highs=tuple(100.0 + i * 0.05 for i in range(0, 15)),
        lows=tuple(99.5 + i * 0.05 for i in range(0, 15)),
    )
    with pytest.raises(SourceRoleExecutionError, match="taught source timezone"):
        _build(opening_range_frame=utc_or, execution_frame=utc_exec)


# ══ 5. INCOMPLETE / UNIDENTIFIABLE 5m WINDOW — AR-1113 §3.2 ══════════════════


def test_a_missing_5m_opening_bar_refuses():
    """The window's own candle is absent. The adapter would otherwise return a
    confident, tighter range with no flag raised anywhere."""
    gapped = RoleFrame(
        timeframe="5m",
        timestamps=(_open(5), _open(10), _open(15)),  # 09:30 candle absent
        highs=(100.90, 101.10, 101.30),
        lows=(100.10, 100.40, 100.60),
    )
    with pytest.raises(SourceRoleExecutionError, match="did not complete"):
        _build(opening_range_frame=gapped)


def test_a_duplicated_5m_opening_bar_refuses():
    dup = RoleFrame(
        timeframe="5m",
        timestamps=(_open(0), _open(0), _open(5)),
        highs=(100.50, 100.55, 100.90),
        lows=(99.75, 99.70, 100.10),
    )
    with pytest.raises(SourceRoleExecutionError, match="duplicate timestamps"):
        _build(opening_range_frame=dup)


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


def test_red_proof_a_lock_ignoring_implementation_fails_the_causal_control():
    """★ THE RED-PROOF. An implementation that publishes the levels from the first bar
    is the single most plausible wrong version of this module. If the causal control
    above cannot reject it, that control is decoration.

    `A GREEN CHECK WITH NO DEMONSTRATED PATH TO RED IS NOT EVIDENCE.`
    """
    real = _build()

    class _LockIgnoring(CausalOpeningRange):
        def state_as_of(self, as_of):  # noqa: ARG002 - deliberately ignores the gate
            return self.complete_state

    leaky = _LockIgnoring(
        lock=real.lock,
        complete_state=real.complete_state,
        forming_state=real.forming_state,
    )

    # The real one refuses pre-lock; the leaky one does not. That difference IS the guard.
    assert real.state_as_of(_open(0)).opening_range_complete is False
    assert leaky.state_as_of(_open(0)).opening_range_complete is True

    # And the §6.F comparison must actually FAIL against the leaky implementation.
    baseline_visible = [leaky.state_as_of(_open(m)).opening_range_high for m in range(0, 5)]
    mutated_real = _build(opening_range_frame=_or_frame_5m(high=133.00, low=66.00))
    mutated_leaky = _LockIgnoring(
        lock=mutated_real.lock,
        complete_state=mutated_real.complete_state,
        forming_state=mutated_real.forming_state,
    )
    mutated_visible = [
        mutated_leaky.state_as_of(_open(m)).opening_range_high for m in range(0, 5)
    ]
    assert baseline_visible != mutated_visible, (
        "the causality control cannot distinguish a leaking implementation, so it is "
        "not a causality control"
    )


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
