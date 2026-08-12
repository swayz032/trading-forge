"""SOURCE_FAITHFUL_EXECUTION_JOIN-1 / B·C·D·F — the vertical source-execution join.

Authority: AR-1079 (gpt-rulings `528d8ef4`) §3, §4, §5, §6, §7, §8, §10, §12.

WHAT IS PROVEN HERE, AND WHAT IS NOT — READ THIS BEFORE TRUSTING A GREEN
-----------------------------------------------------------------------
  ✅ PROVEN BY EXECUTION of the real `SpecConditionStrategy.compute()` — the per-session
     opening-range carrier, the preserved FVG identity, breakout-side direction, the
     source stop, and every negative case in AR-1079 §10's discriminator list that lives
     at the strategy layer.
  ✅ PROVEN BY EXECUTION of the real `backtester._build_source_stop_map()` — the
     warmup-strip timestamp rebase (§10 discriminator 17).
  ✅ RUN AT THE PRODUCTION DEFAULT since AR-1082 — `TF_FVG_IDENTITY_ENABLED` is DELETED by
     an autouse fixture, not set, so these greens describe the shipped configuration. The
     routing that makes that possible is proven separately in
     `test_source_faithful_fvg_routing.py`.
  🛑 NOT PROVEN HERE — the full `main()` -> Band C -> persisted-config route producing one
     auditable trade end to end (AR-1079 §10's load-bearing GREEN). No file in the tree
     carries that yet; a reader must not read this file's green as that claim.

★ `A COMPONENT PROOF IS NOT A VERTICAL PROOF, AND SAYING SO IS THE ONLY THING THAT KEEPS
   IT USEFUL.`

THE FIXTURE, STATED SO A READER CAN CHECK THE ARITHMETIC
--------------------------------------------------------
5-minute bars, `America/New_York`, session start 09:30, taught variant 15m, so the range
is built from bars 0..2 and LOCKS at 09:45 = bar 3.

    bar 0,1,2   opening range window          OR = [100.0, 110.0]
    bar 3,4     inside the range              (close inside — no breakout)
    bar 5       CLOSE 112.0 > ORH             <- the LONG breakout, by CLOSE
    bar 6,7,8   the taught 3-candle FVG       high[6]=113.0 < low[8]=118.0
                bar 7 is the DISPLACEMENT candle, low[7] = 111.5 -> THE TAUGHT STOP
                zone.lower = high[6] = 113.0 > ORH = 110.0 -> outside the range
    bar 8       THE DECISION BAR              entry = close[8]

Every discriminator below moves ONE number in that table and asserts exactly what the
ruling says must change — or must not.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import numpy as np
import polars as pl
import pytest

from src.engine.backtester import _build_source_stop_map
from src.engine.context.source_entry_events import SOURCE_FAITHFUL_MODE
from src.engine.opening_range_candidate import OpeningRangeExecutionCandidate
from src.engine.opening_range_definition import (
    OpeningRangeDefinition,
    OpeningRangeProvenance,
    OpeningRangeVariant,
)
from src.engine.spec_condition_compiler import SpecConditionStrategy


@pytest.fixture(autouse=True)
def _production_default_flag_state(monkeypatch):
    """🛑 THIS FIXTURE ASSERTS THE PRODUCTION DEFAULT — IT NO LONGER BUYS ONE.

    ─── WHAT THIS USED TO BE, AND WHY THAT MATTERS ────────────────────────────────────────
    Until AR-1082 this fixture SET `TF_FVG_IDENTITY_ENABLED=true`, because `compile_binding_plan`
    routed an FVG-family condition to `fvg_native.compute_fvg_signal` only under that flag, and
    the flag DEFAULTS OFF. At the default the condition bound to the generic
    `structure_engine.compute_structure_state`, `_eval_fvg()` never ran, `FVGResult.zones` were
    never produced, and the SOURCE_FAITHFUL event population was STRUCTURALLY EMPTY. Every green
    below was therefore conditional on a flag the product does not set — stated at the time
    rather than hidden, because `A GREEN UNDER A FLAG THE PRODUCT DOES NOT SET IS A CLAIM ABOUT
    A CONFIGURATION NOBODY RUNS.`

    AR-1082 §3 confirmed the diagnosis and authorised the narrow bypass: a SOURCE_FAITHFUL
    artifact reaches the exact FVG primitive from its own persisted `source_risk.mode`, while
    legacy stays governed by the flag. The four-cell proof of that routing is
    `test_source_faithful_fvg_routing.py`.

    ⚠️ SO THE FIXTURE INVERTED. It now DELETES the variable, which means this entire file runs
    at the production default and its greens are evidence about the configuration the product
    actually ships. Deleting rather than merely not-setting matters: an ambient value inherited
    from the developer's shell would silently restore the old crutch and nobody would see it.
    ★ `A TEST THAT SETS THE FLAG IT DEPENDS ON CANNOT TELL YOU THE PRODUCT WORKS.`
    """
    monkeypatch.delenv("TF_FVG_IDENTITY_ENABLED", raising=False)


ET = ZoneInfo("America/New_York")
SPEC_ID = "svkm-source-vertical__s0"
OR_CONDITION_ID = "OPENING_RANGE_DEFINITION:the-opening-range#0"
FVG_CONDITION_ID = "WAIT_STRUCTURE:the-fair-value-gap#0"


# ── the taught window ────────────────────────────────────────────────────────


def _candidate() -> OpeningRangeExecutionCandidate:
    variant = OpeningRangeVariant(
        variant_label="15m", duration_minutes=15, source_quote="the first 15 minute range",
    )
    definition = OpeningRangeDefinition(
        session_start_local="09:30",
        source_timezone="America/New_York",
        variants=(variant,),
        market_scope="US equities / S&P 500 example, regular-session opening",
        trading_day_rule="relative for every single trading day",
        provenance=OpeningRangeProvenance(
            source_quote="the first 15 minute range",
            condition_id=OR_CONDITION_ID,
        ),
    )
    return OpeningRangeExecutionCandidate(
        source_spec_id=SPEC_ID,
        source_condition_id=OR_CONDITION_ID,
        definition=definition,
        variant=variant,
    )


# ── the taught spec ──────────────────────────────────────────────────────────


def _compiled_spec(*, source_risk: dict | None = "default", direction: str = "both") -> dict:
    """A Band-C-shaped compiled spec carrying the OR condition and the FVG condition.

    ⚠️ THE BODY KEY IS `entry_conditions`, NOT `conditions`. AR-1076 measured that a wrong
    key DOES NOT RAISE — it silently yields an empty binding plan whose refusal is
    byte-indistinguishable from a genuine `trigger_not_bound`. Recorded here because a
    fixture that is wrong in that specific way looks exactly like a correct engine refusal.
    """
    if source_risk == "default":
        source_risk = {
            "mode": SOURCE_FAITHFUL_MODE,
            "target": {"type": "FIXED_R", "r_multiple": 2.0},
        }
    spec: dict = {
        "direction": direction,
        "entry_trigger_id": FVG_CONDITION_ID,
        "entry_conditions": [
            {
                "id": OR_CONDITION_ID,
                "type": "OPENING_RANGE_DEFINITION",
                "role": "spine",
                "object": "the opening range",
            },
            {
                "id": FVG_CONDITION_ID,
                "type": "WAIT_STRUCTURE",
                "role": "spine",
                "object": "a bullish fair value gap",
            },
        ],
    }
    if source_risk is not None:
        spec["source_risk"] = source_risk
    return {"spec": spec, "spec_hash": "svkm-vertical-fixture"}


# ── the taught price action ──────────────────────────────────────────────────

#: bar -> (open, high, low, close). Bar 8 is the decision bar. See the module docstring.
_SESSION: list[tuple[float, float, float, float]] = [
    (105.0, 110.0, 100.0, 104.0),   # 0  09:30  OR window
    (104.0, 109.0, 101.0, 106.0),   # 1  09:35  OR window
    (106.0, 108.0, 102.0, 107.0),   # 2  09:40  OR window
    (107.0, 109.0, 104.0, 108.0),   # 3  09:45  locked, close INSIDE
    (108.0, 109.5, 105.0, 109.0),   # 4  09:50  close INSIDE
    (109.0, 112.5, 108.0, 112.0),   # 5  09:55  CLOSE 112.0 > ORH 110.0 -> LONG breakout
    (112.0, 113.0, 111.0, 112.5),   # 6  10:00  FVG candle A   high = 113.0
    (112.5, 119.0, 111.5, 118.5),   # 7  10:05  DISPLACEMENT   low  = 111.5 -> THE STOP
    (118.5, 120.0, 118.0, 119.0),   # 8  10:10  THIRD CANDLE   low  = 118.0 > 113.0
    (119.0, 120.0, 118.5, 119.5),   # 9  10:15
    (119.5, 121.0, 119.0, 120.5),   # 10 10:20
    (120.5, 134.0, 120.0, 133.0),   # 11 10:25  reaches the 2R target (see below)
    # 🛑 low[12] IS DELIBERATELY 120.5, NOT 132.0. My first draft used 132.0 and it MINTED A
    # SECOND BULLISH GAP at bar 12 (low[12]=132.0 > high[10]=121.0) — a real event the taught
    # sequence never described, which the positive witness caught immediately. Recorded rather
    # than silently corrected: `AN INERT-LOOKING FILLER BAR IS STILL PRICE ACTION.`
    (133.0, 134.0, 120.5, 133.5),   # 12 10:30
    # ── FILLER, and it is NOT inert padding — it is load-bearing twice ──────────────────
    # (1) `compute()` returns EARLY below MIN_BARS_REQUIRED=30 without evaluating anything,
    #     so a 13-bar frame would make every assertion in this file green against a function
    #     that never ran. `A FRAME BELOW THE ENGINE'S FLOOR IS NOT A SMALL TEST, IT IS NO TEST.`
    # (2) These bars are deliberately overlapping with bars 11/12, so NO further FVG forms
    #     (`low[i] > high[i-2]` and `high[i] < low[i-2]` are both false throughout, INCLUDING
    #     at the junction). A filler that quietly minted extra gaps would make the anti-hijack
    #     control meaningless — and the first draft of this fixture did exactly that.
    *[(133.0, 134.0, 132.0, 133.5)] * 20,
]

OR_HIGH, OR_LOW = 110.0, 100.0
BREAKOUT_BAR, DISPLACEMENT_BAR, DECISION_BAR = 5, 7, 8
TAUGHT_STOP = 111.5          # low[7], wick-inclusive
ENTRY_PRICE = 119.0          # close[8]
RISK_POINTS = ENTRY_PRICE - TAUGHT_STOP          # 7.5
TARGET_2R = ENTRY_PRICE + 2.0 * RISK_POINTS      # 134.0


def _frame(
    bars: list[tuple[float, float, float, float]] | None = None,
    *,
    sessions: int = 1,
    warmup_bars: int = 0,
    first_session_day: int = 2,
    session_start_hm: tuple[int, int] = (9, 30),
    lead_rows: list[tuple[float, float, float, float]] | None = None,
) -> pl.DataFrame:
    """A polars frame of `sessions` copies of `bars`, one per consecutive weekday session.

    `warmup_bars` prepends bars on an EARLIER day. They are real rows with real timestamps —
    the warmup-strip tests slice them off exactly as `run_class_backtest` does, so the rebase
    is exercised against a frame the production code could actually have produced.
    """
    rows = bars if bars is not None else _SESSION
    out: list[dict] = []

    # 🛑 LEAD/WARMUP BARS GO ON THE PREVIOUS DAY, NOT AHEAD OF THE SESSION ON THE SAME ONE.
    # `_h_opening_range` groups by LOCAL DATE, so bars prepended inside the same trading day
    # become that day's opening-range window and the taught 09:30 bars land hours later. My
    # first EMA control did exactly that and produced ZERO events — the lead had silently
    # redefined the range. `A PREFIX ON THE SAME TRADING DAY IS NOT A WARMUP, IT IS A DIFFERENT
    # OPENING RANGE.`
    lead = lead_rows if lead_rows is not None else (
        [(50.0, 50.5, 49.5, 50.0)] * warmup_bars if warmup_bars else []
    )
    if lead:
        warm_start = datetime(2024, 1, first_session_day - 1, 9, 30, tzinfo=ET)
        for k, (o, h, low_, c) in enumerate(lead):
            ts = warm_start + timedelta(minutes=5 * k)
            out.append({
                "ts_event": ts.astimezone(ZoneInfo("UTC")),
                "open": o, "high": h, "low": low_, "close": c, "volume": 100,
            })

    for s in range(sessions):
        day = first_session_day + s
        start = datetime(2024, 1, day, *session_start_hm, tzinfo=ET)
        for i, (o, h, low_, c) in enumerate(rows):
            ts = start + timedelta(minutes=5 * i)
            out.append({
                "ts_event": ts.astimezone(ZoneInfo("UTC")),
                "open": o, "high": h, "low": low_, "close": c, "volume": 100,
            })
    return pl.DataFrame(out)


def _strategy(compiled_spec: dict | None = None, **kw) -> SpecConditionStrategy:
    return SpecConditionStrategy(
        compiled_spec=compiled_spec if compiled_spec is not None else _compiled_spec(),
        symbol="MES",
        timeframe="5m",
        opening_range_candidate=_candidate(),
        **kw,
    )


def _run(compiled_spec: dict | None = None, **frame_kw) -> tuple[SpecConditionStrategy, pl.DataFrame]:
    strat = _strategy(compiled_spec)
    return strat, strat.compute(_frame(**frame_kw))


def _events(strat) -> list:
    return [r for r in strat.last_source_entry_events if r.refused_reason is None]


# ══════════════════════════════════════════════════════════════════════════════
# THE POSITIVE WITNESS — every negative test below is worthless without it
# ══════════════════════════════════════════════════════════════════════════════


class TestThePositiveWitness:
    """🛑 READ THIS FIRST. Nineteen of the tests in this file assert that something does
    NOT produce an entry. On a compiler that produced NO entries at all — a broken fixture,
    a mis-keyed spec body, a refused binding plan — every one of them would pass.

    So the taught sequence must FIRE, exactly once, at exactly the taught bar, with exactly
    the taught stop. That is this class. If it goes red, no other green in this file means
    anything."""

    def test_the_taught_sequence_produces_exactly_one_source_event(self):
        strat, df = _run()
        events = _events(strat)
        assert len(events) == 1, (
            f"expected exactly the taught event; got {len(events)} "
            f"(refusals: {[r.refused_reason for r in strat.last_source_entry_events]})"
        )

    def test_the_event_sits_on_the_third_candle_with_the_taught_stop_and_entry(self):
        strat, df = _run()
        rec = _events(strat)[0]
        assert rec.event.bar_idx == DECISION_BAR
        assert rec.event.breakout_idx == BREAKOUT_BAR
        assert rec.event.direction == "long"
        assert rec.stop_price == TAUGHT_STOP, "the stop is the displacement candle's wick low"
        assert rec.entry_price == ENTRY_PRICE, "the entry is the third candle's CLOSE"
        assert rec.risk_points == pytest.approx(RISK_POINTS)

    def test_entry_long_is_set_on_the_decision_bar_and_nowhere_else(self):
        _strat, df = _run()
        fired = np.flatnonzero(df["entry_long"].to_numpy())
        assert list(fired) == [DECISION_BAR]
        assert not df["entry_short"].to_numpy().any(), "no short is taught by this fixture"

    def test_the_zone_carried_is_the_DETECTORS_OWN_OBJECT_not_a_rebuild(self):
        """AR-1068 §5 item 6 / AR-1079 §4: the identity must SURVIVE, not be reconstructed.
        `is` — not `==` — is the whole assertion. An equal-valued rebuild would satisfy a
        value comparison while proving the identity was lost and re-derived."""
        strat, _df = _run()
        rec = _events(strat)[0]
        assert any(z is rec.event.zone for z in strat._last_fvg_zones), (
            "the event's zone is not one of the objects the detector produced"
        )


# ══════════════════════════════════════════════════════════════════════════════
# §3 — PER-SESSION OPENING RANGE (discriminator 18)
# ══════════════════════════════════════════════════════════════════════════════


class TestPerSessionOpeningRange:
    def test_each_session_gets_its_OWN_range_and_its_OWN_event(self):
        """AR-1079 §3: "B MUST NOT apply one scalar ORH/ORL across a multi-day frame."
        Three identical sessions must produce THREE events, one per day — a scalar range
        smeared across the frame would produce one, or would let day 2 trade day 1's levels."""
        strat, df = _run(sessions=3)
        events = _events(strat)
        assert len(events) == 3, f"expected one event per session, got {len(events)}"
        assert len({r.session_date for r in events}) == 3, "events collapsed onto one session"
        assert [r.event.bar_idx for r in events] == [
            DECISION_BAR, DECISION_BAR + len(_SESSION), DECISION_BAR + 2 * len(_SESSION),
        ]

    def test_each_session_recorded_its_own_range_object(self):
        strat, _df = _run(sessions=3)
        assert len(strat._source_or_sessions) == 3
        for rng in strat._source_or_sessions.values():
            assert (rng.or_high, rng.or_low) == (OR_HIGH, OR_LOW)

    def test_an_INCOMPLETE_opening_range_session_produces_NO_event_and_borrows_nothing(self):
        """AR-1079 §3 / §10 discriminator 18: "An incomplete/refused OR session produces no
        source event for that session and may not borrow the previous or next day's range."

        The second session here is truncated to TWO bars — 10 minutes of a 15-minute taught
        window — so its range never completes. Session 1 is unchanged and MUST still fire:
        that is what distinguishes "day 2 correctly refused" from "the whole run broke"."""
        rows = list(_SESSION)
        frame_full = _frame(sessions=1)
        short_day = _frame(rows[:2], sessions=1, first_session_day=3)
        strat = _strategy()
        out = strat.compute(pl.concat([frame_full, short_day]))

        sessions = sorted(strat._source_or_sessions)
        assert len(sessions) == 1, (
            f"the truncated session recorded a range it never completed: {sessions}"
        )
        events = _events(strat)
        assert len(events) == 1 and events[0].session_date == sessions[0]
        assert out["entry_long"].to_numpy().sum() == 1


# ══════════════════════════════════════════════════════════════════════════════
# §4 — BREAKOUT SIDE OWNS DIRECTION (discriminators 2..8)
# ══════════════════════════════════════════════════════════════════════════════


def _mutate(bar: int, *, o=None, h=None, low=None, c=None) -> list[tuple[float, float, float, float]]:
    rows = [list(r) for r in _SESSION]
    for pos, val in ((0, o), (1, h), (2, low), (3, c)):
        if val is not None:
            rows[bar][pos] = val
    return [tuple(r) for r in rows]


class TestBreakoutOwnsDirection:
    def test_2_a_WICK_ONLY_breach_does_not_count_as_the_breakout(self):
        """§10 discriminator 2 — REWRITTEN AFTER MY FIRST VERSION PROVED NOTHING.

        🛑 THE FIRST DRAFT asserted NO ENTRY when bar 5's close came back inside the range.
        It failed, and it deserved to: the entry still fired, because bar 6 then became the
        first CLOSE crossing. The mutation had MOVED the breakout, not removed it — and
        "no entry" was never the right expectation, because the taught FVG lies ABOVE ORH so
        its own candles must close outside. `A DISCRIMINATOR THAT ASSERTS THE WRONG
        CONSEQUENCE IS A FALSE RED WAITING TO BE ARGUED AWAY.`

        The property that IS load-bearing is attribution: bar 5's HIGH still pierces ORH, so
        if wicks counted the event would be attributed to bar 5. It must be attributed to
        bar 6 — the first bar whose CLOSE crosses."""
        baseline = _strategy()
        baseline.compute(_frame())
        assert _events(baseline)[0].event.breakout_idx == BREAKOUT_BAR, (
            "POSITIVE WITNESS FAILED: the unmutated fixture does not attribute the breakout "
            "to bar 5, so moving it proves nothing"
        )

        rows = _mutate(BREAKOUT_BAR, c=109.0)   # high stays 112.5, close 109.0 < ORH 110.0
        strat = _strategy()
        strat.compute(_frame(rows))
        evs = _events(strat)
        assert len(evs) == 1
        assert evs[0].event.breakout_idx == BREAKOUT_BAR + 1, (
            "the wick-only breach at bar 5 was credited as the breakout"
        )

    def test_4_flipping_the_EMA_SLOPE_leaves_the_source_event_UNCHANGED(self):
        """§10 discriminator 4. THE CONTROL THAT MATTERS MOST IN THIS FILE.

        The legacy `direction="both"` route picks the side from an EMA-slope proxy at the
        firing bar. AR-1079 §4 retires that for SOURCE_FAITHFUL: "EMA may not choose the side
        when the source rule says breakout side chooses the side."

        A test that flipped an EMA on a module taking no EMA argument would be a WEAK
        control — it would pass on a module with no direction logic at all. So this drives
        the REAL compiler, whose legacy path genuinely does consult the proxy, and holds the
        source sequence fixed while making the frame's slope disagree. The witness is the
        legacy arm: the SAME frame on a spec with no `source_risk` must go somewhere else."""
        # A long descending run-in makes the fast EMA sit BELOW the slow one at the decision
        # bar, i.e. a bearish lean, while the taught long sequence is untouched.
        lead = [(200.0 - i, 200.5 - i, 199.5 - i, 200.0 - i) for i in range(60)]
        frame = _frame(lead_rows=lead)

        source = _strategy()
        out_src = source.compute(frame)
        evs = _events(source)
        assert len(evs) == 1 and evs[0].event.direction == "long", (
            "the EMA lean reached the source direction decision"
        )
        assert out_src["entry_long"].to_numpy().sum() == 1
        assert out_src["entry_short"].to_numpy().sum() == 0

        legacy = _strategy(_compiled_spec(source_risk=None))
        out_legacy = legacy.compute(frame)
        assert not legacy.last_source_entry_events, (
            "the legacy arm built source events — the mode gate is not gating"
        )
        assert (
            out_legacy["entry_long"].to_numpy().tolist()
            != out_src["entry_long"].to_numpy().tolist()
            or out_legacy["entry_short"].to_numpy().any()
        ), (
            "POSITIVE WITNESS FAILED: the legacy arm produced the same population as the "
            "source arm on a frame built to make them disagree, so this test cannot tell "
            "whether the EMA route was retired or merely never ran"
        )

    def test_5_a_WRONG_DIRECTION_FVG_after_the_breakout_produces_NO_entry(self):
        """§10 discriminator 5. Bar 8 is made to form a BEARISH gap (high[8] < low[6])
        after a LONG breakout."""
        rows = _mutate(DECISION_BAR, o=108.0, h=109.0, low=107.0, c=108.5)
        strat = _strategy()
        strat.compute(_frame(rows))
        assert not _events(strat), "a bearish FVG qualified a long breakout"

    def test_6_a_PRE_BREAKOUT_FVG_produces_NO_entry(self):
        """§10 discriminator 6. The gap forms at bar 4 — before the bar-5 breakout — so no
        governing breakout exists at or before it."""
        # ⚠️ BOTH high AND low move on bar 2. The first draft set only the high and produced
        # high=95.0 < low=102.0 — an inverted bar the OR adapter correctly REFUSED, so the
        # test died on a malformed observation instead of measuring anything.
        rows = _mutate(2, o=94.0, h=95.0, low=93.0, c=94.5)   # candle A of a gap at bar 4
        rows[3] = (94.5, 130.0, 94.0, 108.0)
        rows[4] = (108.0, 131.0, 96.0, 109.0)   # low[4]=96.0 > high[2]=95.0 -> bullish gap @4
        strat = _strategy()
        strat.compute(_frame(rows))
        assert all(r.event.bar_idx != 4 for r in _events(strat)), (
            "a gap formed before the breakout qualified as a taught event"
        )

    def test_7_an_FVG_STRADDLING_the_opening_range_produces_NO_entry(self):
        """§10 discriminator 7 / AR-1068 §5 item 4: the gap must lie WHOLLY outside the same
        OR side. Here the gap's lower edge (high[6]) is pushed BELOW ORH so it straddles."""
        rows = _mutate(6, h=109.0, low=100.0, o=101.0, c=108.0)   # lower edge 109.0 < ORH 110.0
        rows = [list(r) for r in rows]
        rows[7] = [108.0, 119.0, 107.0, 118.5]
        rows[8] = [118.5, 120.0, 110.5, 119.0]   # low[8]=110.5 > high[6]=109.0 -> still a gap
        strat = _strategy()
        strat.compute(_frame([tuple(r) for r in rows]))
        assert not _events(strat), "a gap straddling the opening range qualified"

    def test_8_TWO_FVGs_and_the_nearer_unrelated_one_cannot_own_the_stop(self):
        """§10 discriminator 8 — the anti-hijack control. A SECOND, NEARER bullish gap is
        formed later in the session. The taught event's stop must still come from ITS OWN
        displacement candle, because `source_stop_price` never receives a zone list and
        therefore cannot re-scan for a closer one."""
        rows = [list(r) for r in _SESSION]
        rows[10] = [119.5, 121.0, 119.0, 120.5]
        rows[11] = [120.5, 128.0, 120.2, 127.0]   # displacement of the DECOY gap
        rows[12] = [127.0, 134.5, 121.5, 133.0]   # low[12]=121.5 > high[10]=121.0 -> gap @12
        strat = _strategy()
        strat.compute(_frame([tuple(r) for r in rows]))
        events = _events(strat)
        taught = [r for r in events if r.event.bar_idx == DECISION_BAR]
        assert len(taught) == 1
        assert taught[0].stop_price == TAUGHT_STOP, (
            "the taught event's stop moved when an unrelated nearer gap appeared"
        )
        assert len(strat._last_fvg_zones) >= 2, (
            "POSITIVE WITNESS FAILED: the decoy gap was never detected, so this test proved "
            "nothing about hijacking"
        )


# ══════════════════════════════════════════════════════════════════════════════
# §6 — THE STOP COMES FROM THE SAME ZONE (discriminators 9, 10, 19)
# ══════════════════════════════════════════════════════════════════════════════


class TestTheSourceStop:
    def test_9_moving_ONLY_the_displacement_wick_moves_the_stop_EXACTLY(self):
        """§10 discriminator 9. Without this, `return 111.5` would satisfy every other
        stop assertion in this file."""
        for new_low in (111.5, 110.75, 109.25):
            rows = _mutate(DISPLACEMENT_BAR, low=new_low)
            strat = _strategy()
            strat.compute(_frame(rows))
            evs = _events(strat)
            assert len(evs) == 1, f"the taught event vanished at low[7]={new_low}"
            assert evs[0].stop_price == new_low, "the stop did not track the displacement wick"

    def test_10_moving_ONLY_the_GAP_BOUNDARY_leaves_the_stop_where_it_was(self):
        """§10 discriminator 10. The gap's own edges define WHICH zone qualified; the STOP
        comes from the displacement candle's wick. Widening the gap must not move the stop —
        if it did, the stop would be reading the gap band instead of the candle."""
        rows = _mutate(DECISION_BAR, low=119.0)   # zone.upper 118.0 -> 119.0, wick untouched
        strat = _strategy()
        strat.compute(_frame(rows))
        evs = _events(strat)
        assert len(evs) == 1
        assert evs[0].stop_price == TAUGHT_STOP, "the stop tracked the gap boundary"
        assert evs[0].event.zone.upper == 119.0, (
            "POSITIVE WITNESS FAILED: the gap boundary did not actually move, so this test "
            "asserted the stop was stable under no change at all"
        )

    def test_19_a_SHORT_source_event_is_recorded_but_its_stop_REFUSES(self):
        """§10 discriminator 19 / AR-1079 §6: "Do not mechanically mirror the long wick low
        into a short wick high merely because the geometry is calculable."

        The refusal must be VISIBLE, not silent: a short setup that vanishes is
        indistinguishable from a short setup that never occurred."""
        rows = [list(r) for r in _SESSION]
        rows[5] = [101.0, 102.0, 97.0, 98.0]      # CLOSE below ORL -> SHORT breakout
        rows[6] = [98.0, 99.0, 97.0, 98.5]        # candle A, low[6] = 97.0
        rows[7] = [98.5, 98.0, 90.0, 91.0]        # displacement down
        rows[8] = [91.0, 96.0, 90.0, 92.0]        # high[8]=96.0 < low[6]=97.0 -> bearish gap
        strat = _strategy()
        out = strat.compute(_frame([tuple(r) for r in rows]))

        refused = [r for r in strat.last_source_entry_events if r.refused_reason is not None]
        assert refused, "the short event was dropped instead of refused"
        assert refused[0].event.direction == "short"
        assert "SHORT source stop authority is REFUSED" in refused[0].refused_reason
        assert refused[0].stop_price is None
        assert out["entry_short"].to_numpy().sum() == 0, "a short entry fired with no stop"


# ══════════════════════════════════════════════════════════════════════════════
# §5 — THE WARMUP-STRIP IDENTITY (discriminator 17)
# ══════════════════════════════════════════════════════════════════════════════


class TestTheWarmupStripIdentity:
    """AR-1079 §5's trap: `compute()` runs on warmup+OOS, `run_class_backtest` then slices
    the warmup away, and an event recorded as a naked integer silently addresses a different
    candle afterwards — consistently, around the wrong row."""

    WARMUP = 11

    def _computed(self):
        strat = _strategy()
        df = _frame(warmup_bars=self.WARMUP)
        strat.compute(df)
        return strat, df

    def test_17_the_stop_map_is_rebased_onto_the_POST_STRIP_row(self):
        strat, df = self._computed()
        rec = _events(strat)[0]
        assert rec.event.bar_idx == self.WARMUP + DECISION_BAR, (
            "POSITIVE WITNESS FAILED: the pre-strip index is not offset by the warmup rows, "
            "so this frame does not exercise the trap at all"
        )

        stop_map, audit = _build_source_stop_map(strat, df.slice(self.WARMUP))
        assert list(stop_map["long"]) == [DECISION_BAR], (
            f"the map was not rebased: {list(stop_map['long'])} (naked pre-strip index would "
            f"be {rec.event.bar_idx})"
        )
        entry = stop_map["long"][DECISION_BAR]
        assert entry["stop_price"] == TAUGHT_STOP
        assert entry["distance"] == pytest.approx(RISK_POINTS)
        assert entry["stop_reason"] == "source_exact"
        assert audit[0]["disposition"] == "EXECUTABLE"

    def test_17b_the_rebase_is_BY_TIMESTAMP_not_by_subtracting_a_count(self):
        """DISCRIMINATOR FOR THE ABOVE. Subtracting `warmup_rows` would produce the identical
        answer whenever the strip is a clean prefix. Here the executed frame drops a further
        two rows, so an offset-arithmetic implementation lands two candles late and a
        timestamp join lands exactly right."""
        strat, df = self._computed()
        executed = df.slice(self.WARMUP + 2)
        stop_map, _audit = _build_source_stop_map(strat, executed)
        assert list(stop_map["long"]) == [DECISION_BAR - 2]
        ts = executed["ts_event"].to_list()[DECISION_BAR - 2]
        assert ts == _events(strat)[0].decision_ts

    def test_an_event_inside_the_WARMUP_region_is_dropped_and_DISCLOSED(self):
        """A source event detected in the warmup rows must never become a trade — and must
        not vanish either. `A DROPPED EVENT AND AN ABSENT ONE ARE DIFFERENT FACTS.`"""
        strat, df = self._computed()
        stop_map, audit = _build_source_stop_map(strat, df.slice(self.WARMUP + DECISION_BAR + 1))
        assert stop_map["long"] == {}
        assert [a["disposition"] for a in audit] == ["DROPPED_PRE_OOS"]
        assert "not in the executed" in audit[0]["reason"]

    def test_a_DUPLICATE_decision_timestamp_REFUSES_rather_than_guessing_a_row(self):
        """AR-1079 §12 STOP CONDITION: "warmup slicing cannot preserve a unique decision-bar
        identity." Two rows sharing the decision timestamp means the join key is not a key."""
        strat, df = self._computed()
        executed = df.slice(self.WARMUP)
        doubled = pl.concat([executed, executed])
        with pytest.raises(ValueError, match="more than one row of the executed frame"):
            _build_source_stop_map(strat, doubled)


# ══════════════════════════════════════════════════════════════════════════════
# §9 / §10 discriminator 20 — LEGACY IS UNTOUCHED
# ══════════════════════════════════════════════════════════════════════════════


class TestLegacyIsUntouched:
    def test_20_a_spec_with_NO_source_risk_builds_no_source_events_at_all(self):
        strat, out = _run(_compiled_spec(source_risk=None))
        assert strat.last_source_entry_events == []
        assert strat.last_source_refusal is None

    def test_21_TF_OVERLAY_VARIANT_does_NOT_take_the_source_route(self):
        """§10 discriminator 21: TF_OVERLAY_VARIANT remains separate from SOURCE_FAITHFUL."""
        strat, _out = _run(_compiled_spec(source_risk={"mode": "TF_OVERLAY_VARIANT"}))
        assert strat.last_source_entry_events == []

    def test_a_TYPO_in_the_mode_does_not_take_the_source_route_either(self):
        strat, _out = _run(_compiled_spec(source_risk={"mode": "SOURCE-FAITHFUL"}))
        assert strat.last_source_entry_events == [], (
            "a typo'd mode reached the source route; run_class_backtest refuses it, but the "
            "compiler must not act on it either"
        )

    def test_the_legacy_arm_still_produces_ITS_OWN_population_on_the_same_frame(self):
        """POSITIVE WITNESS for the three tests above: they assert an EMPTY source list, which
        an entirely broken legacy path would also satisfy. Legacy must still compute."""
        legacy = _strategy(_compiled_spec(source_risk=None))
        out = legacy.compute(_frame())
        assert legacy.last_per_condition_bool, "the legacy condition ladder did not evaluate"
        assert set(out.columns) >= {"entry_long", "entry_short", "exit_long", "exit_short"}


# ══════════════════════════════════════════════════════════════════════════════
# FAIL-CLOSED DISCLOSURE
# ══════════════════════════════════════════════════════════════════════════════


class TestFailClosedIsVisible:
    def test_a_frame_with_no_completed_opening_range_states_WHY(self):
        # A full-length frame that simply never covers the taught 09:30-09:45 window. It must
        # be full-length: below MIN_BARS_REQUIRED `compute()` returns before evaluating
        # anything, and a refusal that was never computed is not a refusal.
        strat = _strategy()
        strat.compute(_frame(session_start_hm=(11, 0)))
        assert not _events(strat)
        assert strat.last_source_refusal is not None
        assert "COMPLETE taught opening range" in strat.last_source_refusal

    def test_the_refusal_is_RESET_between_computes_and_does_not_leak(self):
        """AR-1079 §5: "never let stale events survive into another run." A refusal from a
        previous frame reported against a clean one is a lie with a timestamp."""
        strat = _strategy()
        strat.compute(_frame(session_start_hm=(11, 0)))
        assert strat.last_source_refusal is not None
        strat.compute(_frame())
        assert strat.last_source_refusal is None
        assert len(_events(strat)) == 1
