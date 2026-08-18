"""AR-1326A F61 — THE EXACT-ARTIFACT GOLDEN RUNTIME WITNESS.

Authority: AR-1326A (gpt-rulings `a23f929b`) section 2, "F61 -- `BINDS` IS NOT THE REQUIRED
GOLDEN RUNTIME WITNESS". `test_svkm_v2_1_compile.py` proved the certified V2.1 graph compiles
to a real artifact and that the artifact BINDS (`_h_opening_range` runs, `compile_binding_plan`
clears). It explicitly does NOT prove the compiled artifact's remaining source-owned mechanics
-- breakout -> FVG -> third-candle -> stop -> 2R -- execute TOGETHER, from the artifact itself,
through the real `SpecConditionStrategy.compute()`.

THIS FILE CLOSES THAT GAP, AND NOTHING ELSE. It is the smallest permanent integration witness:
the COMMITTED `sVkmZklJDHI__s0.spec.json` artifact (via `compile_svkm_v2_1_vertical()`, not a
hand-built stand-in), driven through the real engine consumers `SpecConditionStrategy.compute()`
/ `_build_source_entry_events()` / `_build_source_stop_map()` / `_resolve_source_fixed_r()` --
the exact machinery `test_source_vertical_join.py` already proved correct against a SYNTHETIC
fixture. No second breakout/FVG/stop/target calculator is implemented here (R-736 section 5-1).

WHAT THIS FILE PROVES, PER AR-1326A SECTION 2's NUMBERED LIST
---------------------------------------------------------------
  1. the 5m opening range is formed from the 5m source frame, not the 1m execution frame;
  2. the 1m breakout is by CLOSE, not wick;
  3. breakout side determines the event direction, not EMA slope;
  4. an FVG before the breakout does not qualify;
  5. an opposite-direction FVG does not qualify;
  6. an FVG not wholly outside the same certified range does not qualify;
  7. no event becomes executable before the FVG's third candle completes;
  8. the executable long event occurs on the third candle close;
  9. the long stop resolves to the source-authorized displacement-candle low including wick;
  10. the fixed 2R contract reaches the existing source-risk/target consumer
      (`_resolve_source_fixed_r`), not a test-local arithmetic replacement.

Plus the EMA-disagreement control AR-1326A section 2 names by name: hold the taught
breakout/FVG sequence fixed while making the legacy EMA lean disagree; the SOURCE_FAITHFUL
artifact must keep the breakout-owned side.

THE PRICE TABLE IS NOT A NEW INVENTION. It reuses, bar-for-bar, the OHLC values
`test_source_vertical_join.py` already red-proofed with mutation controls -- only the bar
spacing (1-minute, matching sVkm's REAL execution timeframe per AR-1109) and the opening-range
delivery mechanism (a separate 5-minute `RoleFrame`, matching sVkm's REAL 5m-window/1m-execution
role split, AR-1113) differ. Reusing an already-adversarially-tested numeric sequence is a
narrower risk than authoring a second one from scratch.

🛑 NOT PROVEN HERE, AND SAID SO RATHER THAN IMPLIED: the short-side arm (AR-1326A F62 -- the
short stop is still `UNRESOLVED_SOURCE_AMBIGUITY` and is handled as a separate, one-question
source-evidence check, not a compiler proof). Multi-session behaviour, warmup-strip rebasing and
the anti-hijack/decoy-gap control are already proven generically by
`test_source_vertical_join.py` against the identical underlying selection code
(`select_session_source_events` / `source_stop_price`) and are not re-derived here.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import numpy as np
import polars as pl
import pytest

from src.engine.backtester import _build_source_stop_map, _resolve_source_fixed_r
from src.engine.extraction.svkm_v2_1_compile import compile_svkm_v2_1_vertical
from src.engine.opening_range_candidate import OpeningRangeExecutionCandidate
from src.engine.opening_range_definition import (
    OpeningRangeDefinition,
    OpeningRangeProvenance,
    OpeningRangeVariant,
)
from src.engine.source_timeframe_roles import SourceTimeframeRoles
from src.engine.spec_condition_compiler import SpecConditionStrategy
from src.engine.svkm_role_execution import RoleFrame

ET = ZoneInfo("America/New_York")
SESSION_DAY = (2026, 3, 10)  # an arbitrary Tuesday; only the local wall-clock matters here


@pytest.fixture(scope="module")
def compiled_artifact_path() -> str:
    return compile_svkm_v2_1_vertical()


@pytest.fixture(scope="module")
def compiled_artifact(compiled_artifact_path: str) -> dict:
    with open(compiled_artifact_path, encoding="utf-8") as f:
        return json.load(f)


# ══════════════════════════════════════════════════════════════════════════════
# THE TAUGHT WINDOW AND CANDIDATE -- the REAL artifact's OR condition id, a 5m variant
# (AR-1109: sVkm's range is the first 5-minute candle, not a 15m/5m-bar window like the
# synthetic conformance fixture).
# ══════════════════════════════════════════════════════════════════════════════


def _candidate(compiled_artifact: dict) -> OpeningRangeExecutionCandidate:
    or_condition = compiled_artifact["spec"]["entry_conditions"][0]
    assert or_condition["type"] == "OPENING_RANGE_DEFINITION"
    or_condition_id = or_condition["id"]

    variant = OpeningRangeVariant(
        variant_label="5m", duration_minutes=5,
        source_quote="marking the high and low of the first 5-minute candle",
    )
    definition = OpeningRangeDefinition(
        session_start_local="09:30",
        source_timezone="America/New_York",
        variants=(variant,),
        market_scope="MES, regular-session opening",
        trading_day_rule="resets each regular-session open",
        provenance=OpeningRangeProvenance(
            source_quote="define the initial range by marking the high and low",
            condition_id=or_condition_id,
        ),
    )
    return OpeningRangeExecutionCandidate(
        source_spec_id=compiled_artifact["video"],
        source_condition_id=or_condition_id,
        definition=definition,
        variant=variant,
    )


# ══════════════════════════════════════════════════════════════════════════════
# THE 5-MINUTE OPENING-RANGE SOURCE FRAME
# ══════════════════════════════════════════════════════════════════════════════

# The ONE 5m candle that is the taught range: [start, lock) = [09:30, 09:35).
OR_HIGH, OR_LOW = 110.0, 100.0


def _or_source_frame(day: tuple[int, int, int] = SESSION_DAY) -> RoleFrame:
    start = datetime(*day, 9, 30, tzinfo=ET)
    # Three 5-minute bars, mirroring test_svkm_v2_1_compile.py's own production-seam proof
    # (test_PRODUCTION_real_artifact_drives_the_5m_range_off_the_5m_frame): only the FIRST
    # bar falls inside [start, lock) and therefore owns the OR levels; the other two exist
    # solely so `as_of = max(timestamp)` clears the 09:35 lock.
    return RoleFrame(
        timeframe="5m",
        timestamps=(start, start + timedelta(minutes=5), start + timedelta(minutes=10)),
        highs=(OR_HIGH, 112.0, 120.0),
        lows=(OR_LOW, 104.0, 115.0),
    )


# ══════════════════════════════════════════════════════════════════════════════
# THE 1-MINUTE EXECUTION FRAME -- reuses test_source_vertical_join.py's proven OHLC
# sequence bar-for-bar, re-spaced to 1 minute and re-indexed after a 5-bar pre-lock lead-in.
# ══════════════════════════════════════════════════════════════════════════════

# bar 0-4   (09:30-09:34) pre-lock. Deliberately FAR OUTSIDE [100,110] -- if the engine ever
#           mis-sourced the opening range from the 1m execution frame instead of the 5m
#           source frame (requirement 1), these values would corrupt or_high/or_low and the
#           positive witness below would fail loudly instead of silently agreeing.
# bar 5-6   (09:35-09:36) locked, close INSIDE the range -- no breakout yet.
# bar 7     (09:37) CLOSE 112.0 > ORH 110.0 -- the LONG breakout, by CLOSE (requirement 2).
# bar 8-9   (09:38-09:39) the taught 3-candle FVG: bar 8 is candle A (high=113.0), bar 9 is
#           the DISPLACEMENT candle (low=111.5 -> the taught stop, requirement 9).
# bar 10    (09:40) THE THIRD CANDLE / decision bar -- entry = close[10] = 119.0.
# bar 11-14 (09:41-09:44) price runs to and through the 2R target (134.0).
# bar 15-34 20 inert filler bars, deliberately non-gap-forming (see the original fixture's
#           own note on why low=120.5, not 132.0, at the junction).
_PRE_LOCK = [(200.0, 205.0, 195.0, 200.0)] * 5
_ACTION: list[tuple[float, float, float, float]] = [
    (107.0, 109.0, 104.0, 108.0),   # 5  09:35  locked, close INSIDE
    (108.0, 109.5, 105.0, 109.0),   # 6  09:36  close INSIDE
    (109.0, 112.5, 108.0, 112.0),   # 7  09:37  CLOSE 112.0 > ORH 110.0 -> LONG breakout
    (112.0, 113.0, 111.0, 112.5),   # 8  09:38  FVG candle A   high = 113.0
    (112.5, 119.0, 111.5, 118.5),   # 9  09:39  DISPLACEMENT   low  = 111.5 -> THE STOP
    (118.5, 120.0, 118.0, 119.0),   # 10 09:40  THIRD CANDLE   close = 119.0
    (119.0, 120.0, 118.5, 119.5),   # 11 09:41
    (119.5, 121.0, 119.0, 120.5),   # 12 09:42
    (120.5, 134.0, 120.0, 133.0),   # 13 09:43  reaches the 2R target
    (133.0, 134.0, 120.5, 133.5),   # 14 09:44  (low deliberately 120.5, not 132.0 -- see below)
]
_FILLER = [(133.0, 134.0, 132.0, 133.5)] * 20
_SESSION: list[tuple[float, float, float, float]] = _PRE_LOCK + _ACTION + _FILLER

LOCK_IDX = 5
BREAKOUT_BAR, DISPLACEMENT_BAR, DECISION_BAR = 7, 9, 10
TAUGHT_STOP = 111.5                              # low[9], wick-inclusive
ENTRY_PRICE = 119.0                              # close[10]
RISK_POINTS = ENTRY_PRICE - TAUGHT_STOP          # 7.5
R_MULTIPLE = 2.0
TARGET_2R = ENTRY_PRICE + R_MULTIPLE * RISK_POINTS  # 134.0


def _mutate(bar: int, *, o=None, h=None, low=None, c=None) -> list[tuple[float, float, float, float]]:
    rows = [list(r) for r in _SESSION]
    for pos, val in ((0, o), (1, h), (2, low), (3, c)):
        if val is not None:
            rows[bar][pos] = val
    return [tuple(r) for r in rows]


def _frame_1m(
    bars: list[tuple[float, float, float, float]] | None = None,
    *,
    day: tuple[int, int, int] = SESSION_DAY,
    lead_rows: list[tuple[float, float, float, float]] | None = None,
) -> pl.DataFrame:
    rows = bars if bars is not None else _SESSION
    start = datetime(*day, 9, 30, tzinfo=ET)
    out: list[dict] = []

    # EMA-disagreement lead-in lands EARLY ON THE SAME DAY, before the 09:30 session open.
    # Unlike test_source_vertical_join.py's legacy-route control (where the OR window was
    # aggregated FROM the execution frame itself, so any same-day prefix risked joining the
    # window), this artifact's OR window is sourced entirely from the SEPARATE 5m
    # `_or_source_frame()` keyed by calendar date -- `_window_bounds` fixes the window to
    # [09:30, lock) by wall-clock regardless of what other same-day bars exist. Putting the
    # lead-in on a DIFFERENT calendar date would require a second day's worth of 5m source
    # bars the artifact's OR condition has no reason to need for this control.
    if lead_rows:
        warm_start = start - timedelta(hours=6, minutes=30)   # 03:00 ET, same calendar day
        for k, (o, h, low_, c) in enumerate(lead_rows):
            ts = warm_start + timedelta(minutes=k)
            out.append({
                "ts_event": ts.astimezone(ZoneInfo("UTC")),
                "open": o, "high": h, "low": low_, "close": c, "volume": 100,
            })

    for i, (o, h, low_, c) in enumerate(rows):
        ts = start + timedelta(minutes=i)
        out.append({
            "ts_event": ts.astimezone(ZoneInfo("UTC")),
            "open": o, "high": h, "low": low_, "close": c, "volume": 100,
        })
    return pl.DataFrame(out)


def _strategy(compiled_artifact: dict, spec_override: dict | None = None) -> SpecConditionStrategy:
    roles = SourceTimeframeRoles.from_payload(compiled_artifact["spec"]["source_timeframe_roles"])
    compiled_spec = compiled_artifact if spec_override is None else spec_override
    return SpecConditionStrategy(
        compiled_spec=compiled_spec,
        symbol="MES",
        timeframe="1m",
        opening_range_candidate=_candidate(compiled_artifact),
        source_timeframe_roles=roles,
        opening_range_source_frame=_or_source_frame(),
    )


def _run(compiled_artifact: dict, *, bars=None, **frame_kw):
    strat = _strategy(compiled_artifact)
    df = strat.compute(_frame_1m(bars, **frame_kw))
    return strat, df


def _events(strat: SpecConditionStrategy) -> list:
    return [r for r in strat.last_source_entry_events if r.refused_reason is None]


# ══════════════════════════════════════════════════════════════════════════════
# THE POSITIVE WITNESS -- requirements 1, 2 (attribution side), 7, 8, 9 in one pass.
# Every negative control below is worthless without this.
# ══════════════════════════════════════════════════════════════════════════════


class TestThePositiveWitness:
    def test_the_real_compiled_artifact_produces_exactly_one_taught_long_event(
        self, compiled_artifact: dict,
    ):
        strat, df = _run(compiled_artifact)
        events = _events(strat)
        assert len(events) == 1, (
            f"expected exactly the taught event from the REAL committed artifact; got "
            f"{len(events)} (refusals: {[r.refused_reason for r in strat.last_source_entry_events]})"
        )
        rec = events[0]
        assert rec.event.bar_idx == DECISION_BAR, "requirement 8: entry is the third candle"
        assert rec.event.breakout_idx == BREAKOUT_BAR
        assert rec.event.direction == "long", "requirement 3: breakout side owns direction"
        assert rec.stop_price == TAUGHT_STOP, (
            "requirement 9: the stop is the displacement candle's wick low"
        )
        assert rec.entry_price == ENTRY_PRICE, "requirement 8: entry is the third candle's CLOSE"
        assert rec.risk_points == pytest.approx(RISK_POINTS)

        fired = np.flatnonzero(df["entry_long"].to_numpy())
        assert list(fired) == [DECISION_BAR], "requirement 7: no event before the third candle"
        assert not df["entry_short"].to_numpy().any()

    def test_requirement_1_the_range_comes_from_the_5m_source_frame_not_the_1m_execution_frame(
        self, compiled_artifact: dict,
    ):
        strat, _df = _run(compiled_artifact)
        assert len(strat._source_or_sessions) == 1
        (session,) = strat._source_or_sessions.values()
        assert (session.or_high, session.or_low) == (OR_HIGH, OR_LOW), (
            "the taught range does not match the 5m source frame's levels -- either the "
            "5m frame was ignored, or the 200/205/195 pre-lock 1m bars leaked into the "
            "range computation"
        )

    def test_requirement_10_the_2r_target_reaches_the_real_source_risk_consumer(
        self, compiled_artifact: dict,
    ):
        """AR-1326A: 'the fixed 2R contract reaches the existing source-risk/target consumer
        from the compiled artifact, not a test-local arithmetic replacement.' `_resolve_source_
        fixed_r` is the production reader of `spec.source_risk.target.r_multiple` -- called
        here on the REAL strategy instance, not re-typed as a literal."""
        strat, df = _run(compiled_artifact)
        r_multiple = _resolve_source_fixed_r(strat)
        assert r_multiple == pytest.approx(R_MULTIPLE)

        stop_map, audit = _build_source_stop_map(strat, df)
        entry = stop_map["long"][DECISION_BAR]
        assert entry["stop_price"] == TAUGHT_STOP
        assert entry["distance"] == pytest.approx(RISK_POINTS)
        assert audit[0]["disposition"] == "EXECUTABLE"

        target = ENTRY_PRICE + r_multiple * entry["distance"]
        assert target == pytest.approx(TARGET_2R), (
            "the target computed from the REAL artifact's r_multiple and the REAL stop map's "
            "distance does not reach the taught 2R price"
        )


# ══════════════════════════════════════════════════════════════════════════════
# REQUIREMENT 3 -- BREAKOUT SIDE OWNS DIRECTION, NOT EMA SLOPE (the named control)
# ══════════════════════════════════════════════════════════════════════════════


class TestBreakoutOwnsDirectionNotEMA:
    def test_flipping_the_EMA_slope_leaves_the_REAL_artifacts_source_event_unchanged(
        self, compiled_artifact: dict,
    ):
        """AR-1326A section 2: 'Include a strong EMA-disagreement control: hold the taught
        breakout/FVG sequence fixed while making the legacy EMA lean disagree. The
        SOURCE_FAITHFUL artifact must keep the breakout-owned side.'

        The witness is the legacy arm: the SAME frame, on a MUTATED copy of the REAL
        artifact with `source_risk` stripped (so it takes the legacy EMA-proxy route), must
        diverge from the SOURCE_FAITHFUL artifact -- otherwise this test cannot tell whether
        the EMA route was retired for THIS artifact or merely never ran."""
        # A long descending run-in -> bearish EMA lean at the decision bar, while the taught
        # long sequence is untouched.
        lead = [(300.0 - i, 300.5 - i, 299.5 - i, 300.0 - i) for i in range(60)]

        source = _strategy(compiled_artifact)
        out_src = source.compute(_frame_1m(lead_rows=lead))
        evs = _events(source)
        assert len(evs) == 1 and evs[0].event.direction == "long", (
            "the EMA lean reached the REAL artifact's source direction decision"
        )
        assert out_src["entry_long"].to_numpy().sum() == 1
        assert out_src["entry_short"].to_numpy().sum() == 0

        legacy_spec = json.loads(json.dumps(compiled_artifact))
        legacy_spec["spec"].pop("source_risk", None)
        legacy = _strategy(compiled_artifact, spec_override=legacy_spec)
        out_legacy = legacy.compute(_frame_1m(lead_rows=lead))
        assert not legacy.last_source_entry_events, (
            "the legacy arm built source events on the REAL artifact with source_risk "
            "stripped -- the mode gate is not gating"
        )
        assert (
            out_legacy["entry_long"].to_numpy().tolist()
            != out_src["entry_long"].to_numpy().tolist()
            or out_legacy["entry_short"].to_numpy().any()
        ), (
            "POSITIVE WITNESS FAILED: the legacy arm produced the same population as the "
            "source arm on a frame built to make them disagree, so this control cannot tell "
            "whether the EMA route was retired or merely never ran"
        )


# ══════════════════════════════════════════════════════════════════════════════
# REQUIREMENTS 2, 4, 5, 6 -- THE FOUR WAYS A CANDIDATE EVENT MUST BE REFUSED
# ══════════════════════════════════════════════════════════════════════════════


class TestRefusalRequirements:
    def test_requirement_2_a_wick_only_breach_does_not_count_as_the_breakout(
        self, compiled_artifact: dict,
    ):
        baseline, _ = _run(compiled_artifact)
        assert _events(baseline)[0].event.breakout_idx == BREAKOUT_BAR, (
            "POSITIVE WITNESS FAILED: the unmutated frame does not attribute the breakout to "
            "bar 7, so moving it proves nothing"
        )
        rows = _mutate(BREAKOUT_BAR, c=109.0)   # high stays 112.5, close 109.0 < ORH 110.0
        strat, _df = _run(compiled_artifact, bars=rows)
        evs = _events(strat)
        assert len(evs) == 1
        assert evs[0].event.breakout_idx == BREAKOUT_BAR + 1, (
            "the wick-only breach was credited as the breakout"
        )

    def test_requirement_4_a_pre_breakout_fvg_produces_no_entry(self, compiled_artifact: dict):
        # ⚠️ Both high AND low move on bar 6, to avoid the inverted-bar trap
        # `test_source_vertical_join.py`'s own history warns about.
        rows = _mutate(6, o=94.0, h=95.0, low=93.0, c=94.5)   # candle A of a gap at bar 8
        rows[7] = (94.5, 130.0, 94.0, 108.0)
        rows[8] = (108.0, 131.0, 96.0, 109.0)   # low[8]=96.0 > high[6]=95.0 -> bullish gap @8
        strat, _df = _run(compiled_artifact, bars=rows)
        assert all(r.event.bar_idx != 8 for r in _events(strat)), (
            "a gap formed before the breakout qualified as a taught event"
        )

    def test_requirement_5_a_wrong_direction_fvg_after_the_breakout_produces_no_entry(
        self, compiled_artifact: dict,
    ):
        rows = _mutate(DECISION_BAR, o=108.0, h=109.0, low=107.0, c=108.5)
        strat, _df = _run(compiled_artifact, bars=rows)
        assert not _events(strat), "a bearish FVG qualified a long breakout"

    def test_requirement_6_an_fvg_straddling_the_opening_range_produces_no_entry(
        self, compiled_artifact: dict,
    ):
        rows = [list(r) for r in _SESSION]
        rows[8] = [101.0, 109.0, 100.0, 108.0]     # lower edge 109.0 < ORH 110.0 -> straddles
        rows[9] = [108.0, 119.0, 107.0, 118.5]
        rows[10] = [118.5, 120.0, 110.5, 119.0]    # low[10]=110.5 > high[8]=109.0 -> still a gap
        strat, _df = _run(compiled_artifact, bars=[tuple(r) for r in rows])
        assert not _events(strat), "a gap straddling the opening range qualified"


# ══════════════════════════════════════════════════════════════════════════════
# REQUIREMENT 9 -- THE STOP TRACKS THE DISPLACEMENT WICK, NOTHING ELSE
# ══════════════════════════════════════════════════════════════════════════════


class TestTheStopTracksTheDisplacementWick:
    def test_moving_only_the_displacement_wick_moves_the_stop_exactly(
        self, compiled_artifact: dict,
    ):
        for new_low in (111.5, 110.75, 109.25):
            rows = _mutate(DISPLACEMENT_BAR, low=new_low)
            strat, _df = _run(compiled_artifact, bars=rows)
            evs = _events(strat)
            assert len(evs) == 1, f"the taught event vanished at low[{DISPLACEMENT_BAR}]={new_low}"
            assert evs[0].stop_price == new_low, "the stop did not track the displacement wick"

    def test_moving_only_the_gap_boundary_leaves_the_stop_where_it_was(
        self, compiled_artifact: dict,
    ):
        rows = _mutate(DECISION_BAR, low=119.0)   # zone.upper moves, wick untouched
        strat, _df = _run(compiled_artifact, bars=rows)
        evs = _events(strat)
        assert len(evs) == 1
        assert evs[0].stop_price == TAUGHT_STOP, "the stop tracked the gap boundary, not the wick"
        assert evs[0].event.zone.upper == 119.0, (
            "POSITIVE WITNESS FAILED: the gap boundary did not actually move"
        )
