"""SOURCE-RISK-HANDOFF-1 / STEP 2B — the exact causal FVG identity.

Authority: AR-1068 (gpt-rulings 06d63e2b) §5 (required semantic + required negative
controls) and §11 discriminators 2, 3, 5, 6, 7, 8, 9, 10.

THE FIXTURE IS SELF-VERIFYING ON PURPOSE
----------------------------------------
Every test runs the REAL `compute_fvg_signal()` over the bars and asserts which zones the
detector actually produced, rather than hand-asserting a zone the fixture was assumed to
contain. A hand-built fixture that does not contain the structure it claims is one of the
shapes that has lied to this campaign before, and it lies by passing.

PRIMARY FIXTURE — one session, deliberately loaded with traps:

    idx      0    1    2    3    4    5    6    7    8    9   10   11
    high   141  131  121  111  100  100  100  104  106  108  112  112
    low    139  129  119  109   90   90   90   91   96  104  110  108
    close  140  130  120  110   95   95   95   95  105  107  111  110
                 <- decline ->   <-- inside OR -->  ^BO        ^FVG3

    opening range: ORH 100 / ORL 90, locked from bar 4.

  * bars 0-3 decline hard, which plants FOUR BEARISH zones (start_idx 2,3,4,5) that are
    real, detector-produced, and every one of them wrong-side and pre-breakout;
  * bar 7's HIGH is 104 — above ORH — while its CLOSE is 95. A wick-only breach;
  * bar 8 is the only CLOSE crossing: the breakout;
  * bar 10 is the only qualifying bullish FVG's third candle;
  * bar 9 is therefore the displacement candle, and its LOW (104) is the taught stop;
  * the decline also makes an EMA-slope proxy read BEARISH at the entry bar, while the
    breakout side says LONG.
"""

from __future__ import annotations

import numpy as np
import pytest

from src.engine.context.source_entry_events import (
    LONG,
    SHORT,
    SourceEntryEvent,
    find_breakout_events,
    select_source_entry_events,
    source_stop_price,
)
from src.engine.indicators.fvg_native import BEARISH, BULLISH, compute_fvg_signal

OR_HIGH = 100.0
OR_LOW = 90.0
LOCK_IDX = 4


def bars() -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    high = np.array([141, 131, 121, 111, 100, 100, 100, 104, 106, 108, 112, 112], dtype=float)
    low = np.array([139, 129, 119, 109, 90, 90, 90, 91, 96, 104, 110, 108], dtype=float)
    close = np.array([140, 130, 120, 110, 95, 95, 95, 95, 105, 107, 111, 110], dtype=float)
    open_ = close.copy()
    return open_, high, low, close


def zones_of(high, low, close, open_):
    return compute_fvg_signal(open_, high, low, close).zones


def events_of(high, low, close, open_, *, or_high=OR_HIGH, or_low=OR_LOW, lock_idx=LOCK_IDX):
    return select_source_entry_events(
        close=close,
        zones=zones_of(high, low, close, open_),
        or_high=or_high,
        or_low=or_low,
        lock_idx=lock_idx,
    )


# ── POSITIVE CONTROLS FIRST ──────────────────────────────────────────────────
# Several assertions below are of the form "no event was emitted". A negative assertion is
# worthless without a positive witness that the path ran at all: an empty zone list, a
# broken import, or a detector returning nothing would satisfy every one of them.


class TestFixtureActuallyContainsWhatItClaims:
    def test_the_detector_really_finds_the_qualifying_bullish_zone_at_bar_10(self):
        zones = zones_of(*bars()[1:], bars()[0])
        bullish = [z for z in zones if z.direction == BULLISH]
        assert len(bullish) == 1, f"expected exactly one bullish zone, got {bullish}"
        z = bullish[0]
        assert (z.start_idx, z.lower, z.upper) == (10, 106.0, 110.0)

    def test_the_fixture_really_contains_the_wrong_side_pre_breakout_zones(self):
        """The traps must be REAL detector output, or the controls below prove nothing."""
        zones = zones_of(*bars()[1:], bars()[0])
        bearish = sorted(z.start_idx for z in zones if z.direction == BEARISH)
        assert bearish == [2, 3, 4, 5], f"expected four pre-breakout bearish zones, got {bearish}"

    def test_bar_7_really_is_a_wick_only_breach(self):
        _, high, low, close = bars()
        assert high[7] > OR_HIGH, "the trap requires bar 7's HIGH to exceed ORH"
        assert close[7] < OR_HIGH, "the trap requires bar 7's CLOSE to stay inside"


# ── THE TAUGHT SEQUENCE ──────────────────────────────────────────────────────


class TestTheQualifyingEvent:
    def test_exactly_one_event_is_emitted_and_it_carries_the_exact_zone(self):
        open_, high, low, close = bars()
        events = events_of(high, low, close, open_)

        assert len(events) == 1, f"expected exactly one taught entry, got {events}"
        ev = events[0]
        assert ev.bar_idx == 10           # the third FVG candle = the decision bar
        assert ev.direction == LONG
        assert ev.breakout_idx == 8
        assert ev.zone.start_idx == 10
        assert ev.zone.direction == BULLISH
        assert (ev.zone.lower, ev.zone.upper) == (106.0, 110.0)

    def test_the_carried_zone_IS_the_detector_object_not_a_rebuilt_lookalike(self):
        """AR-1068 §5 item 6: the EXACT identity is carried. Identity, not equality."""
        open_, high, low, close = bars()
        zones = zones_of(high, low, close, open_)
        events = select_source_entry_events(
            close=close, zones=zones, or_high=OR_HIGH, or_low=OR_LOW, lock_idx=LOCK_IDX
        )
        assert any(events[0].zone is z for z in zones), (
            "the event carries a COPY of the zone, not the detector's own object; a copy is "
            "how a re-scan sneaks back in without any test noticing"
        )

    def test_the_stop_is_the_displacement_candle_wick_not_the_gap_boundary(self):
        open_, high, low, close = bars()
        ev = events_of(high, low, close, open_)[0]
        stop = source_stop_price(ev, high, low)
        assert stop == 104.0 == low[9], "the taught stop is the displacement candle's LOW"
        assert stop != ev.zone.lower, "the gap boundary is a DIFFERENT price — that was AR-1063"


# ── §5 REQUIRED NEGATIVE CONTROLS ────────────────────────────────────────────


class TestRequiredNegativeControls:
    def test_old_active_fvg_but_no_new_post_breakout_fvg_gives_NO_ENTRY(self):
        """§5 control 1. Truncate the session right after the breakout: the four old bearish
        zones are still there and still unfilled, and `any_active` would be True — which is
        exactly the wrong predicate AR-1069 §2.1 identified."""
        open_, high, low, close = bars()
        n = 9  # bars 0..8: breakout has happened, the bar-10 FVG has not formed
        events = events_of(high[:n], low[:n], close[:n], open_[:n])
        assert events == []

        # POSITIVE WITNESS that the old-signal predicate really would have fired here.
        res = compute_fvg_signal(open_[:n], high[:n], low[:n], close[:n])
        assert res.any_active[8], (
            "control is vacuous unless the OLD any_active predicate is True at the breakout "
            "bar — that is the false entry this unit exists to stop"
        )

    def test_bullish_breakout_with_only_a_bearish_fvg_gives_NO_ENTRY(self):
        """§5 control 2 / §11 discriminator 4."""
        open_, high, low, close = bars()
        zones = zones_of(high, low, close, open_)
        bearish_only = [z for z in zones if z.direction == BEARISH]
        assert bearish_only, "positive witness: there ARE bearish zones to offer"

        events = select_source_entry_events(
            close=close, zones=bearish_only, or_high=OR_HIGH, or_low=OR_LOW, lock_idx=LOCK_IDX
        )
        assert events == []

    # ── THE TWO ISOLATING CONTROLS ───────────────────────────────────────────
    # ⚠️ THESE EXIST BECAUSE THE FIRST VERSION OF THIS SUITE WAS FALSELY GREEN. An ablation
    # matrix showed that deleting the direction check OR deleting the post-breakout ordering
    # check left all 23 tests passing: on the primary fixture the wrong-side zones are also
    # pre-breakout, so each guard was masking the other and neither was proven. The two
    # fixtures below separate them — each has a zone that ONLY ONE guard can reject.
    # ★ `TWO GUARDS THAT REJECT THE SAME OBJECT PROVE ONLY THAT SOMETHING REJECTED IT.`

    def test_a_bearish_fvg_forming_AFTER_a_long_breakout_and_ABOVE_the_range_is_rejected(self):
        """ISOLATES THE DIRECTION CHECK. This zone is post-breakout and wholly above ORH, so
        the ordering guard and the outside guard both ACCEPT it. Only direction rejects it."""
        close = np.array([95, 95, 95, 95, 95, 95, 95, 95, 118, 114, 108, 108], dtype=float)
        high = np.array([100, 100, 100, 100, 100, 100, 100, 100, 120, 118, 110, 110], dtype=float)
        low = np.array([90, 90, 90, 90, 90, 90, 90, 90, 115, 112, 105, 105], dtype=float)
        open_ = close.copy()

        zones = zones_of(high, low, close, open_)
        target = [z for z in zones if z.direction == BEARISH and z.start_idx == 10]
        assert target, f"positive witness: the fixture must plant a bearish zone at bar 10; {zones}"
        assert target[0].lower > OR_HIGH, "and it must be ABOVE the range, so 'outside' accepts it"
        assert find_breakout_events(close, OR_HIGH, OR_LOW, lock_idx=LOCK_IDX) == [(8, LONG)]

        assert events_of(high, low, close, open_) == []

    def test_a_bullish_fvg_forming_BEFORE_the_breakout_and_outside_the_range_is_rejected(self):
        """ISOLATES THE POST-BREAKOUT ORDERING CHECK. This zone is bullish and wholly above
        ORH, so the direction guard and the outside guard both ACCEPT it. Only the causal
        ordering rejects it — it is the 'old gap from earlier in the session' of §5 item 5."""
        close = np.array([98, 98, 98, 99, 99, 99, 99, 99, 105, 106], dtype=float)
        high = np.array([100, 100, 105, 110, 112, 100, 100, 100, 106, 108], dtype=float)
        low = np.array([90, 90, 95, 104, 106, 90, 90, 90, 99, 100], dtype=float)
        open_ = close.copy()

        zones = zones_of(high, low, close, open_)
        target = [z for z in zones if z.direction == BULLISH and z.start_idx == 4]
        assert target, f"positive witness: the fixture must plant a bullish zone at bar 4; {zones}"
        assert target[0].lower > OR_HIGH, "and it must be ABOVE the range, so 'outside' accepts it"
        assert find_breakout_events(close, OR_HIGH, OR_LOW, lock_idx=LOCK_IDX) == [(8, LONG)], (
            "the breakout must come LATER than the zone, or this proves nothing"
        )

        assert events_of(high, low, close, open_) == []

    def test_an_fvg_inside_the_opening_range_gives_NO_ENTRY(self):
        """§5 control 3 / §11 discriminator 6. Widen ORH above the zone's lower boundary so
        the SAME qualifying zone is no longer outside the range."""
        open_, high, low, close = bars()
        assert events_of(high, low, close, open_), "positive witness: it qualifies at ORH=100"

        # ORH 107 sits above the zone's lower edge (106) -> no longer wholly outside.
        events = events_of(high, low, close, open_, or_high=107.0)
        assert events == []

    def test_only_the_first_two_fvg_candles_gives_NO_ENTRY(self):
        """§5 control 4 / §11 discriminator 7. Truncate before the third candle completes."""
        open_, high, low, close = bars()
        n = 10  # bars 0..9 — candle 3 of the qualifying FVG (bar 10) does not exist yet
        assert not any(z.start_idx == 10 for z in zones_of(high[:n], low[:n], close[:n], open_[:n]))
        assert events_of(high[:n], low[:n], close[:n], open_[:n]) == []

    def test_a_wick_only_or_breach_is_not_a_breakout(self):
        """§11 discriminator 2. Bar 7 pokes above ORH with its high and closes back inside."""
        _, _, _, close = bars()
        breakouts = find_breakout_events(close, OR_HIGH, OR_LOW, lock_idx=LOCK_IDX)
        assert breakouts == [(8, LONG)], f"only the CLOSE crossing counts; got {breakouts}"
        assert 7 not in [k for k, _ in breakouts]

    def test_moving_ORH_moves_the_breakout_threshold(self):
        """§11 discriminator 1 — the OR levels are load-bearing, not decorative."""
        _, _, _, close = bars()
        assert find_breakout_events(close, 100.0, OR_LOW, lock_idx=LOCK_IDX) == [(8, LONG)]
        # Raise ORH above every close: nothing breaks out upward any more.
        assert find_breakout_events(close, 200.0, OR_LOW, lock_idx=LOCK_IDX) == []


# ── §5 CONTROLS 5-7: THE STOP BINDS TO THE *QUALIFYING* ZONE ─────────────────


class TestTheStopBindsToTheQualifyingZoneOnly:
    def test_two_historical_zones_plus_one_qualifying_zone_binds_to_the_new_one(self):
        """§5 control 5. The historical zones are offered to the selector alongside the real
        one; the emitted stop must come from the newly qualifying zone."""
        open_, high, low, close = bars()
        zones = zones_of(high, low, close, open_)
        assert len([z for z in zones if z.start_idx in (2, 3, 4, 5)]) == 4  # positive witness

        events = select_source_entry_events(
            close=close, zones=zones, or_high=OR_HIGH, or_low=OR_LOW, lock_idx=LOCK_IDX
        )
        assert len(events) == 1
        assert source_stop_price(events[0], high, low) == 104.0

    def test_mutating_the_qualifying_displacement_wick_MOVES_the_stop(self):
        """§5 control 6 / §11 discriminator 9."""
        open_, high, low, close = bars()
        before = source_stop_price(events_of(high, low, close, open_)[0], high, low)

        low2 = low.copy()
        low2[9] = 101.0                      # the displacement candle's wick, and only it
        ev = events_of(high, low2, close, open_)[0]
        after = source_stop_price(ev, high, low2)

        assert before == 104.0 and after == 101.0, (
            f"the taught stop must track the displacement wick; {before} -> {after}"
        )

    def test_mutating_an_unrelated_zone_does_NOT_move_the_stop(self):
        """§5 control 7 / §11 discriminator 10."""
        open_, high, low, close = bars()
        before = source_stop_price(events_of(high, low, close, open_)[0], high, low)

        low2 = low.copy()
        low2[0] = 100.0                      # a pre-breakout bearish zone's candle
        events = events_of(high, low2, close, open_)
        assert len(events) == 1, "positive witness: the qualifying event still exists"
        after = source_stop_price(events[0], high, low2)

        assert after == before == 104.0, "an unrelated zone must not reach the source stop"

    def test_the_stop_function_cannot_rescan_because_it_never_sees_other_zones(self):
        """§5 item 8. Structural, not conventional: `source_stop_price` takes no zone list."""
        import inspect

        params = set(inspect.signature(source_stop_price).parameters)
        assert "zones" not in params and params == {"event", "high", "low"}, (
            f"if a zones list ever reaches this function, a nearest-FVG re-scan becomes "
            f"possible again; params={params}"
        )


# ── §6 / §11-3: DIRECTION COMES FROM THE BREAKOUT, NOT AN EMA SLOPE ─────────


class TestDirectionAuthority:
    @staticmethod
    def _ema(x: np.ndarray, span: int) -> np.ndarray:
        a = 2.0 / (span + 1.0)
        out = np.empty_like(x)
        out[0] = x[0]
        for i in range(1, len(x)):
            out[i] = a * x[i] + (1 - a) * out[i - 1]
        return out

    def test_the_ema_slope_proxy_genuinely_disagrees_at_the_entry_bar(self):
        """POSITIVE CONTROL FOR THE CONTROL. If the proxy happened to agree, the test below
        would pass on a module that consulted the EMA — the two-arms-read-the-same trap."""
        _, _, _, close = bars()
        fast, slow = self._ema(close, 3), self._ema(close, 8)
        assert fast[10] < slow[10], (
            f"the fixture must make the EMA proxy read BEARISH at bar 10 for the next test "
            f"to discriminate; fast={fast[10]:.3f} slow={slow[10]:.3f}"
        )

    def test_direction_is_LONG_from_the_breakout_side_while_the_ema_says_bearish(self):
        """§6 / §11 discriminator 3."""
        open_, high, low, close = bars()
        ev = events_of(high, low, close, open_)[0]
        assert ev.direction == LONG, "the breakout side is the direction authority, not the slope"

    def test_a_downside_breakout_selects_SHORT_and_requires_a_bearish_zone(self):
        """The mirror of the selection LOGIC — not a claim that the short STOP is resolved.
        AR-1068 §3.2/§12 keep the short stop refused; this only proves the selector is not
        hard-wired to LONG, which would make every long-side assertion above unfalsifiable."""
        high = np.array([100, 100, 100, 100, 100, 99, 95, 88, 84, 80], dtype=float)
        low = np.array([90, 90, 90, 90, 90, 89, 85, 80, 76, 72], dtype=float)
        close = np.array([95, 95, 95, 95, 95, 89, 88, 84, 80, 76], dtype=float)
        open_ = close.copy()

        zones = zones_of(high, low, close, open_)
        bearish = [z for z in zones if z.direction == BEARISH]
        assert bearish, f"positive witness: the fixture must contain a bearish zone; got {zones}"

        events = select_source_entry_events(
            close=close, zones=zones, or_high=OR_HIGH, or_low=OR_LOW, lock_idx=LOCK_IDX
        )
        assert events, "a downside close-crossing plus a matching bearish FVG must qualify"
        assert all(e.direction == SHORT for e in events)


# ── REFUSALS ─────────────────────────────────────────────────────────────────


class TestRefusals:
    def test_a_refused_opening_range_has_no_levels_and_is_refused_not_guessed(self):
        _, _, _, close = bars()
        with pytest.raises(ValueError, match="finite"):
            find_breakout_events(close, float("nan"), OR_LOW, lock_idx=LOCK_IDX)

    def test_an_inverted_opening_range_is_refused(self):
        _, _, _, close = bars()
        with pytest.raises(ValueError, match="inverted"):
            find_breakout_events(close, 90.0, 100.0, lock_idx=LOCK_IDX)

    def test_an_event_whose_bar_is_not_its_zones_third_candle_is_refused(self):
        """The identity invariant is enforced at construction, so a mis-wired caller cannot
        quietly produce an event pointing at a different bar than the zone that justified it."""
        open_, high, low, close = bars()
        zone = [z for z in zones_of(high, low, close, open_) if z.direction == BULLISH][0]
        with pytest.raises(ValueError, match="third candle"):
            SourceEntryEvent(bar_idx=11, direction=LONG, zone=zone, breakout_idx=8)

    def test_a_breakout_after_the_fvg_is_refused_as_inverted_causal_order(self):
        open_, high, low, close = bars()
        zone = [z for z in zones_of(high, low, close, open_) if z.direction == BULLISH][0]
        with pytest.raises(ValueError, match="inverts the taught causal order"):
            SourceEntryEvent(bar_idx=10, direction=LONG, zone=zone, breakout_idx=11)


# ── STEP G — SHORT STOP AUTHORITY (AR-1074 §8, §10.G, §11 discriminator 20) ───────────
#
# BEFORE this guard, `source_stop_price()` on a short event returned
# `displacement_extreme(...)` = `high[start_idx - 1]` — a real, plausible, chartable price
# that the transcript never authorized. The TypeScript contract's deliberate refusal to map
# `displacement_candle_high` was NOT enforced on the Python side, so the narrowing existed
# only in the layer that did not execute.
#
#     `A CALCULABLE PRICE IS NOT SOURCE AUTHORITY.`
#
# 🛑 THE POSITIVE WITNESS IS LOAD-BEARING HERE. Every assertion below is "it refuses". If
# the short path were unreachable — no bearish zone, no downside crossing, a selector
# hard-wired to LONG — a guard that never ran would satisfy all of them, and a deleted
# guard would still look green. So the short EVENT is constructed and asserted first
# (`[absence-claim]`: a negative assertion needs a positive witness that the path ran).


def _short_event():
    """The reachable SHORT event, from the SAME fixture the selector test above uses.

    Not a hand-built `SourceEntryEvent`: it is produced by the real selector from real
    detector zones, so this proves the production path can reach the refusal — a
    hand-constructed event would only prove the dataclass accepts arguments.
    """
    high = np.array([100, 100, 100, 100, 100, 99, 95, 88, 84, 80], dtype=float)
    low = np.array([90, 90, 90, 90, 90, 89, 85, 80, 76, 72], dtype=float)
    close = np.array([95, 95, 95, 95, 95, 89, 88, 84, 80, 76], dtype=float)
    open_ = close.copy()
    events = select_source_entry_events(
        close=close,
        zones=zones_of(high, low, close, open_),
        or_high=OR_HIGH,
        or_low=OR_LOW,
        lock_idx=LOCK_IDX,
    )
    return events, high, low


class TestShortStopAuthorityIsRefused:
    def test_positive_witness_the_short_path_is_actually_reachable(self):
        """Without this, every refusal assertion below is unfalsifiable."""
        events, _, _ = _short_event()
        assert events, "the fixture must produce a SHORT event or the guard is never exercised"
        assert all(e.direction == SHORT for e in events)

    def test_source_stop_price_REFUSES_a_short_event(self):
        """§11 discriminator 20: a short event with no visually certified stop authority
        refuses instead of mechanically using `displacement_candle_high`.

        ABLATION: delete the `if event.direction == SHORT` branch in `source_stop_price`
        and this returns `high[start_idx-1]` as a float — RED.
        """
        events, high, low = _short_event()
        with pytest.raises(ValueError, match="SHORT source stop authority is REFUSED"):
            source_stop_price(events[0], high, low)

    def test_the_refusal_is_about_AUTHORITY_not_an_incidental_geometry_error(self):
        """A refusal that fired for the wrong reason would pin the wrong behaviour: it would
        go green again the moment the geometry changed, silently reopening the short stop."""
        events, high, low = _short_event()
        with pytest.raises(ValueError) as err:
            source_stop_price(events[0], high, low)
        msg = str(err.value)
        assert "displacement_candle_high" in msg, "must name the UNMAPPED anchor"
        assert "A CALCULABLE PRICE IS NOT SOURCE AUTHORITY" in msg
        # and it must NOT be one of displacement_extreme's own geometry refusals
        assert "no displacement candle" not in msg
        assert "outside the supplied series" not in msg

    def test_LONG_is_UNAFFECTED_the_discriminating_control(self):
        """The guard must refuse the short arm ONLY. A guard that refused everything would
        pass the two tests above while destroying the long money path."""
        open_, high, low, close = bars()
        ev = events_of(high, low, close, open_)[0]
        assert ev.direction == LONG
        stop = source_stop_price(ev, high, low)
        assert isinstance(stop, float)
        assert stop == pytest.approx(low[ev.zone.start_idx - 1]), (
            "the long taught stop must still be the wick-inclusive displacement low"
        )

    def test_short_SELECTION_still_works_only_the_STOP_claim_is_refused(self):
        """AR-1074 §10.G refuses short STOP EXECUTION, not short event selection. Killing the
        selector instead would lose the evidence needed to resolve the short side later."""
        events, _, _ = _short_event()
        ev = events[0]
        assert ev.direction == SHORT
        assert ev.bar_idx == ev.zone.start_idx, "the identity invariant still holds on shorts"
        assert ev.breakout_idx <= ev.bar_idx
