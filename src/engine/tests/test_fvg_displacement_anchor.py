"""SOURCE-RISK-HANDOFF-1 / STEP 1+2 — the displacement-candle anchor.

Authority: AR-1064 (gpt-rulings 1d36573b) §2 and STEP 1/STEP 2.

THE SEMANTIC BEING FIXED
------------------------
`fvg_low` means "lower boundary of the imbalance" — `FVGZone.lower == high[i-2]`.
The sVkm teacher anchors his stop to the DISPLACEMENT CANDLE's wick-inclusive extreme
(AR-1063, AR-1065: transcript df72444f). Those are different prices.

AR-1064 §2 forbids redefining `fvg_low` — that would repair one teacher by corrupting the
generic ontology — and requires a DISTINCT anchor. It also corrected my suggestion to widen
`FVGZone`: unnecessary, because the detector already guarantees `start_idx == candle 3`, so

    displacement_idx = start_idx - 1

is deterministic from existing identity. These tests hold that line: the zone dataclass is
NOT widened and `fvg_low` semantics are NOT touched.

DIRECTION: only the LONG side is source-authorized. AR-1065 measured the transcript to
contain NO mirroring authority ("above" appears 0 times; opposite/reverse/vice-versa/
inverse/flip/mirror all 0), so the SHORT mirror must FAIL CLOSED until resolved.
"""
from __future__ import annotations

import numpy as np
import pytest

from src.engine.context.structural_stops import (
    SourceAnchorUnresolved,
    compute_structural_stop,
)
from src.engine.indicators.fvg_native import (
    BULLISH,
    detect_fvg_zones,
    displacement_extreme,
)

MES = dict(point_value=5.0, atr=4.0, tick_size=0.25, symbol="MES")


def bullish_fvg_bars():
    """3 bars forming a bullish FVG: high[0] < low[2].

    Bar 1 is the displacement candle. Its LOW (6000.0) is the teacher's anchor.
    The GAP's lower boundary is high[0] = 6002.0 — a DIFFERENT, tighter price.
    """
    #              bar0    bar1(displacement)  bar2
    high = np.array([6002.0, 6009.0, 6012.0])
    low = np.array([6000.5, 6000.0, 6003.0])
    return high, low


def test_the_two_prices_are_genuinely_different():
    """Positive control: if these coincided the whole unit would be untestable."""
    high, low = bullish_fvg_bars()
    zones = detect_fvg_zones(high, low)
    assert len(zones) == 1, "fixture must produce exactly one zone"
    z = zones[0]
    assert z.direction == BULLISH  # compare to the module constant, not a literal
    assert z.start_idx == 2, "start_idx is candle 3"
    assert z.lower == pytest.approx(6002.0), "gap boundary == high[0]"
    assert displacement_extreme(z, high, low, "long") == pytest.approx(6000.0)
    assert z.lower != pytest.approx(displacement_extreme(z, high, low, "long"))


def test_displacement_extreme_is_candle_two_low_for_long():
    high, low = bullish_fvg_bars()
    z = detect_fvg_zones(high, low)[0]
    # displacement_idx = start_idx - 1 = 1
    assert displacement_extreme(z, high, low, "long") == pytest.approx(low[z.start_idx - 1])


def test_displacement_extreme_is_wick_inclusive_not_the_body():
    """The teacher: 'Don't just go to the body. Please include the wick.'

    `low[]` IS the wick extreme by definition — this test exists so that a future change
    to a body-based series (e.g. min(open, close)) fails loudly.
    """
    high, low = bullish_fvg_bars()
    z = detect_fvg_zones(high, low)[0]
    open_ = np.array([6001.0, 6008.0, 6004.0])
    close = np.array([6001.5, 6008.5, 6011.0])
    body_low = min(open_[1], close[1])
    got = displacement_extreme(z, high, low, "long")
    assert got == pytest.approx(6000.0)
    assert got != pytest.approx(body_low), "must be the wick low, not the body low"


def test_FVGZone_was_not_widened():
    """AR-1064 §2: do not redesign the dataclass. Guard the decision, not just the code."""
    high, low = bullish_fvg_bars()
    z = detect_fvg_zones(high, low)[0]
    assert set(vars(z)) == {"start_idx", "direction", "upper", "lower", "filled_at_idx"}


# ── the anchor reaches the resolver as its OWN anchor, not as fvg ─────────────


def test_resolver_accepts_the_displacement_anchor_source_exact():
    high, low = bullish_fvg_bars()
    z = detect_fvg_zones(high, low)[0]
    stop = displacement_extreme(z, high, low, "long")
    plan = compute_structural_stop(
        direction="long",
        entry_price=6011.0,
        fvg_displacement_low=stop,
        required_anchor="fvg_displacement",
        source_exact=True,
        **MES,
    )
    assert plan.stop_price == pytest.approx(6000.0)
    assert plan.stop_reason == "fvg_displacement"
    assert plan.buffer == pytest.approx(0.0)


def test_displacement_anchor_is_distinct_from_the_gap_anchor():
    """Commanding the displacement anchor must NOT resolve to the gap band, and vice versa."""
    plan = compute_structural_stop(
        direction="long",
        entry_price=6011.0,
        nearest_fvg_below=6002.0,          # the GAP boundary
        fvg_displacement_low=6000.0,       # the CANDLE extreme
        required_anchor="fvg_displacement",
        source_exact=True,
        **MES,
    )
    assert plan.stop_price == pytest.approx(6000.0), "must take the candle, not the gap"

    plan2 = compute_structural_stop(
        direction="long",
        entry_price=6011.0,
        nearest_fvg_below=6002.0,
        fvg_displacement_low=6000.0,
        required_anchor="fvg",
        source_exact=True,
        **MES,
    )
    assert plan2.stop_price == pytest.approx(6002.0), "fvg still means the gap band"
    assert plan2.stop_reason == "fvg"


def test_fvg_low_semantics_are_untouched():
    """AR-1064 §2 FORBIDS redefining fvg_low. A legacy gap-anchored call is unchanged."""
    plan = compute_structural_stop(
        direction="long", entry_price=6011.0, nearest_fvg_below=6002.0, **MES
    )
    assert plan.stop_reason == "fvg"
    assert plan.stop_price == pytest.approx(6002.0 - 0.75), "legacy buffer still applies"


# ── AR-1064 §3 discriminators 1 and 2 ────────────────────────────────────────


def test_rg1_moving_the_displacement_wick_moves_the_stop():
    high, low = bullish_fvg_bars()
    z = detect_fvg_zones(high, low)[0]
    before = displacement_extreme(z, high, low, "long")
    low2 = low.copy()
    low2[1] = 5997.5  # deeper wick on the displacement candle only
    after = displacement_extreme(z, high, low2, "long")
    assert before == pytest.approx(6000.0)
    assert after == pytest.approx(5997.5)


def test_rg2_moving_the_gap_boundary_does_NOT_move_the_stop():
    """The decisive discriminator: gap and candle must be independently addressable."""
    high, low = bullish_fvg_bars()
    z = detect_fvg_zones(high, low)[0]
    before = displacement_extreme(z, high, low, "long")
    high2 = high.copy()
    high2[0] = 6001.0  # move ONLY the gap's lower boundary (high[0])
    z2 = detect_fvg_zones(high2, low)[0]
    after = displacement_extreme(z2, high2, low, "long")
    assert z2.lower != pytest.approx(z.lower), "the gap boundary really did move"
    assert after == pytest.approx(before), "the taught stop must NOT move"


# ── short side must FAIL CLOSED — no mirroring authority in the source ───────


def test_short_mirror_is_not_authorized_and_refuses():
    """AR-1065: the transcript grants NO mirroring authority. Refuse, never invert."""
    with pytest.raises(SourceAnchorUnresolved):
        compute_structural_stop(
            direction="short",
            entry_price=5990.0,
            fvg_displacement_low=6000.0,  # only the LONG-side level is known
            required_anchor="fvg_displacement",
            source_exact=True,
            **MES,
        )


def test_short_works_only_when_an_explicit_high_side_level_is_supplied():
    """The geometry is implemented; what is missing is SOURCE authority to use it.

    This proves the refusal above is about the absent level, not a hard-coded ban — so when
    GPT rules the mirror authorized, the producer supplies the high and this path works.
    """
    plan = compute_structural_stop(
        direction="short",
        entry_price=5990.0,
        fvg_displacement_high=6000.0,
        required_anchor="fvg_displacement",
        source_exact=True,
        **MES,
    )
    assert plan.stop_price == pytest.approx(6000.0)
    assert plan.stop_reason == "fvg_displacement"


def test_displacement_extreme_refuses_a_zone_with_no_displacement_bar():
    """start_idx must be >= 1 for candle 2 to exist. Guard the index arithmetic."""
    high, low = bullish_fvg_bars()
    z = detect_fvg_zones(high, low)[0]
    broken = type(z)(start_idx=0, direction=z.direction, upper=z.upper, lower=z.lower, filled_at_idx=None)
    with pytest.raises(ValueError):
        displacement_extreme(broken, high, low, "long")
