"""R2c red-proof — the taught momentum-after stage, magnitude-free. RED before the change.

CITATIONS, one clause each:
  ALGO-009 Route A   REJECTION/CONTROL STORY -> DIRECTIONAL 5M MOMENTUM -> SUSTAINED FORCE
  ALGO-052           "rejection, then momentum candles formed"
  ALGO-071 §3        the momentum-after clause "remains the next stage of Route A exactly as taught"
  ALGO-068 §3        "a momentum candle that takes out the prior candle's EXTREME - the same
                      extreme test Route B already uses at `normal_breakout`"

NO FRACTION IS INTRODUCED. The predicate is OHLC against OHLC, exactly as Route B's §7.7 clause.

No PnL, realized outcome, winner/loser label or clean-edge result is read anywhere.
"""
from __future__ import annotations

import pandas as pd

from research import current_mnq_strategy_v2_4_derivation as D

TZ = "America/New_York"
LO, HI = 100.0, 102.0
BODY, CLOSE_LOC, WICK = 0.62, 0.78, 0.35


def bars(rows):
    idx = pd.date_range("2026-04-09 10:00", periods=len(rows), freq="5min", tz=TZ)
    return pd.DataFrame(
        {"open": [r[0] for r in rows], "high": [r[1] for r in rows],
         "low": [r[2] for r in rows], "close": [r[3] for r in rows]}, index=idx)


AWAY = (110.0, 111.0, 109.0, 110.0)
APPROACH = (109.0, 110.0, 103.0, 104.0)
#: A rejection under ALGO-071 §3: traded into the band, closed back out on the near side.
REJECTION = (101.6, 103.5, 101.5, 103.2)


def _story(trigger):
    return D.derive_story(bars([AWAY, APPROACH, REJECTION, trigger]), "L",
                          LO, HI, BODY, CLOSE_LOC, WICK)


def test_R2c_a_trigger_that_does_NOT_take_out_the_prior_extreme_is_refused():
    """THE RED-PROOF. Closes past the prior CLOSE but never exceeds its HIGH.

    Prior completed bar is the rejection: high 103.5, close 103.2. This trigger closes at
    103.4 (past 103.2, so the OLD close-only test says momentum) but its high is 103.45,
    UNDER 103.5 - it never took the prior candle's extreme. ALGO-068 §3's taught form refuses
    it; the close-only test accepts it. That disagreement is the red-proof.
    """
    trigger = (103.2, 103.45, 103.1, 103.4)
    assert float(trigger[3]) > float(REJECTION[3]), "must pass the OLD close-only test"
    assert float(trigger[1]) < float(REJECTION[1]), "must FAIL the taught extreme test"
    s = _story(trigger)
    assert s.complete is False, f"no momentum-after: the story must not complete; got {s}"
    assert s.refusal == D.NO_CONTROL_TRANSFER, s


def test_R2c_a_trigger_that_DOES_take_out_the_prior_extreme_completes():
    """The positive witness. Same rejection, a trigger that takes out 103.5."""
    trigger = (103.2, 104.0, 103.1, 103.9)
    assert float(trigger[1]) > float(REJECTION[1]), "must clear the prior extreme"
    s = _story(trigger)
    assert s.complete is True, f"a real momentum candle must complete the story; got {s}"
    assert s.refusal is None


def test_R2c_introduces_no_fraction():
    """The clause must be OHLC against OHLC. A magnitude here would be the whole failure again."""
    import inspect
    src = inspect.getsource(D.derive_story)
    line = [ln for ln in src.splitlines() if "follow = " in ln]
    assert line, "the decision clause must be findable"
    joined = " ".join(line)
    for token in ("body_frac", "close_loc", "reject_wick", "0.", "min_each", "max_body"):
        assert token not in joined, f"R2c must introduce no magnitude; found {token!r}"
