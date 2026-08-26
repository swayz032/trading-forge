"""T3 red-proofs — `touch with mixed/doji control -> WAIT_OR_NO_TRADE`. S3 step 2.

THE TAUGHT CLAUSE, verbatim, `video_evidence.md:113` (Explicit refusals):

    "touch with mixed/doji control -> WAIT_OR_NO_TRADE"

restated at `video_evidence.md:82` and `engineer_onboarding.md:61`:

    "Directional control/defense/hold must confirm; a doji reclaim alone is not an A+ trade."

THE COMMITTED FORMALIZATION (`..._t3_formalization_2026_08_26.md`, committed at `abce4155`
BEFORE any census or guard number was read). T3 refuses iff, on the COMPLETED bar the story is
read on:

    MIXED                  = body < upper_wick AND body < lower_wick
    NO_DIRECTIONAL_CONTROL = close <= (high+low)/2 for a LONG   (mirrored for a SHORT)

OHLC against OHLC. No constant, no fraction, no threshold. Every decimal in this file is either
a FIXTURE PRICE or a citation of a RETIRED magnitude (`0.62`, `0.78`, `0.35`) named only to
identify what T3 replaces.

WHY THESE FIXTURES AND NOT OTHERS. Two of them are the ones that could REFUTE T3 rather than
confirm it, and they are here deliberately: the HAMMER and the ALGO-071 §5.3 clean thin-wick
rejection must PASS. A control gate that refuses the archetypal rejection candle would contradict
T5 and `_rejection_wick`, and no guard number could rescue it.

No PnL, realized outcome, winner/loser label or clean-edge result is read anywhere.
"""
from __future__ import annotations

import pandas as pd

from research import current_mnq_strategy_v2_4_derivation as D

TZ = "America/New_York"
LO, HI = 100.0, 102.0
#: Retired magnitudes, cited so the signatures still line up. T3 does not read them.
BODY, CLOSE_LOC, WICK = 0.62, 0.78, 0.35


def bars(rows):
    idx = pd.date_range("2026-04-09 10:00", periods=len(rows), freq="5min", tz=TZ)
    return pd.DataFrame(
        {"open": [r[0] for r in rows], "high": [r[1] for r in rows],
         "low": [r[2] for r in rows], "close": [r[3] for r in rows]}, index=idx)


AWAY = (110.0, 111.0, 109.0, 110.0)          # wholly above: gives a real approach
APPROACH = (109.0, 110.0, 103.0, 104.0)


def _story(control_bar, trigger=(103.2, 104.0, 103.1, 103.9)):
    """The story read on [AWAY, APPROACH, control_bar] with `control_bar` LAST COMPLETED."""
    return D.derive_story(bars([AWAY, APPROACH, control_bar, trigger]), "L",
                          LO, HI, BODY, CLOSE_LOC, WICK)


def _t3_refuses(bar, direction="L") -> bool:
    """The committed clause, evaluated directly on OHLC. Used to PIN the fixtures."""
    o, h, l, c = (float(x) for x in bar)
    body = abs(c - o)
    upper = h - max(o, c)
    lower = min(o, c) - l
    mixed = bool(body < upper and body < lower)
    mid = (h + l) / 2.0
    no_control = bool(c <= mid) if direction == "L" else bool(c >= mid)
    return bool(mixed or no_control)


# ─────────────────────────────────────────────────────────────────────────────────────────
# THE FIXTURES. Each is pinned against the committed clause BEFORE it is used, so a fixture
# that stopped matching its own description would fail loudly instead of quietly proving
# something else.
# ─────────────────────────────────────────────────────────────────────────────────────────

#: EVERY FIXTURE CLOSES BACK OUT OF THE BAND ON THE NEAR SIDE (close > hi for a long), so R2's
#: rejection rule and R2b's indecision rule BOTH pass them and the only thing left to decide
#: them is CONTROL QUALITY. My first draft did not do this: the bars closed INSIDE the band, so
#: R2b refused them outright and the tests would have 'proved' T3 while actually exercising R2b.
#: A fixture that is decided by a different clause proves nothing about this one.

#: DOJI control: closed out on the near side, but the body is dwarfed by BOTH wicks.
DOJI = (102.6, 104.0, 99.0, 102.5)

#: MIXED control: closed out on the near side, both wicks enormous, body negligible - the
#: taught `mixed_overlap_and_two_sided_wicks` picture.
MIXED = (102.4, 112.0, 92.0, 102.6)

#: HAMMER / pin: long lower wick, SMALL upper wick, decisive close out on the near side.
#: THE ARCHETYPAL REJECTION - it must PASS, and it is the fixture that refutes an over-strict
#: T3 (this is why `C2 = body < max(wick)` was rejected on teaching grounds).
HAMMER = (102.5, 103.0, 97.0, 102.8)

#: ALGO-071 §5.3 fixture 1 - the operator's own clean thin-wick rejection. Must PASS.
CLEAN_REJECTION = (101.6, 103.5, 101.5, 103.2)


def test_T3_fixtures_match_their_own_descriptions():
    """PIN THE FIXTURES FIRST. A fixture that drifts proves whatever it drifted into."""
    # ISOLATION: every fixture must close OUT of the band on the near side, so neither R2 nor
    # R2b decides it and CONTROL QUALITY is the only thing left. Asserted, not assumed.
    for name, bar in (("DOJI", DOJI), ("MIXED", MIXED),
                      ("HAMMER", HAMMER), ("CLEAN_REJECTION", CLEAN_REJECTION)):
        assert float(bar[3]) > HI, f"{name} must close OUT of the band, else R2b decides it"
        assert float(bar[2]) <= HI, f"{name} must have traded INTO the band"
    assert _t3_refuses(DOJI) is True, "DOJI fixture must be refused by the committed clause"
    assert _t3_refuses(MIXED) is True, "MIXED fixture must be refused by the committed clause"
    assert _t3_refuses(HAMMER) is False, "HAMMER must NOT be refused - it is the taught rejection"
    assert _t3_refuses(CLEAN_REJECTION) is False, "the §5.3 clean rejection must NOT be refused"


def test_T3_refuses_a_doji_control_touch():
    """RED-PROOF. `touch with mixed/doji control -> WAIT_OR_NO_TRADE` (video_evidence.md:113)."""
    s = _story(DOJI)
    assert s.complete is False, f"a doji-control touch must not complete the story: {s}"


def test_T3_refuses_a_mixed_control_touch():
    """RED-PROOF. The 'mixed' half of the same taught refusal."""
    s = _story(MIXED)
    assert s.complete is False, f"a mixed-control touch must not complete the story: {s}"


def test_T3_does_NOT_refuse_the_hammer():
    """THE REFUTING FIXTURE. A rejection wick is large BY DEFINITION.

    This is why `C2 = body < max(wick)` was rejected in the formalization on teaching grounds:
    it fires on exactly the shape `_rejection_wick` and T5 exist to ACCEPT. If T3 ever starts
    refusing this bar, T3 is wrong - no guard number can rescue it.
    """
    assert _t3_refuses(HAMMER) is False
    s = _story(HAMMER)
    assert s.complete is True, f"the archetypal rejection candle must survive T3: {s}"


def test_T3_does_NOT_refuse_the_ALGO_071_clean_rejection():
    """THE SECOND REFUTING FIXTURE — ALGO-071 §5.3 fixture 1, the operator's own definition."""
    assert _t3_refuses(CLEAN_REJECTION) is False
    s = _story(CLEAN_REJECTION)
    assert s.complete is True, f"the §5.3 clean rejection must survive T3: {s}"


def test_T3_introduces_no_magnitude():
    """The clause must be OHLC against OHLC. A constant here is the whole failure again."""
    import inspect
    src = inspect.getsource(D)
    if "def _t3_control" not in src:
        return  # not landed yet; the red-proofs above carry the burden
    body = src.split("def _t3_control", 1)[1].split("\ndef ", 1)[0]
    code = "\n".join(ln for ln in body.splitlines() if not ln.strip().startswith("#"))
    for token in ("body_frac", "close_loc", "reject_wick", "min_each", "max_body"):
        assert token not in code, f"T3 must introduce no magnitude; found {token!r}"
    import re
    # `2.0` in the midpoint is a DIVISOR, not a threshold; every other literal is forbidden.
    lits = [m for m in re.findall(r"\b\d+\.\d+\b", code) if m != "2.0"]
    assert not lits, f"T3 must contain no numeric threshold; found {lits}"
