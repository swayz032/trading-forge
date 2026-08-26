#!/usr/bin/env python3
"""A-PRIORI FIXTURE TABLE for the ruled zone-band shape - ALGO-119 section 4.

COMMITTED BEFORE THE GUARD RAN, AND BEFORE ANY MEASUREMENT.  Every expected value below
was written from HIS SENTENCE and from nothing else.  It was not chosen from what it does
to the map, to the fourteen sessions, or to any exam number.  ALGO-104's precedent: the
a-priori table is published first so that a clause cannot be quietly re-expressed after
seeing its effect.

THE SENTENCE (ALGO-073 section 1, his words, quoted in ALGO-073 section 2 and in the
handover):

    "i take a key zone with a wick and i draw the zone from the top of the wick to where
     the xandle closed"

    RESISTANCE : from the top of the upper wick DOWN TO that candle's close.
    SUPPORT    : the mirror - from the bottom of the lower wick UP TO that candle's close.
    WIDTH      : whatever that candle's wick-to-close IS.  No magnitude is added by anyone.

WHAT THE CODE DID BEFORE THIS CHANGE (the exceptional single-swing path in
current_mnq_strategy_v2_4_levels.py): it centred a SYMMETRIC band on the pivot price -
half = max(TICK * 4.0, key_level_pad_atr * atr), then lo, hi = price - half, price + half.
That is the wrong SHAPE (symmetric about the extreme, where his is one-sided from it) and,
at key_level_pad_atr = 0.06 on a 20-point ATR, a 2.4-point full width against a band his
own demonstration measured in the 4-32 point range.

SCOPE: the EXCEPTIONAL SINGLE-SWING path only (ALGO-111 section 4).  The established
multi-rejection path keeps its construction until its four undeclared magnitudes have had
their own provenance pass.

NO NEW NUMBER IS INTRODUCED, AND F5 IS THE PROOF THAT NONE IS NEEDED.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Fixture:
    key: str
    words: str
    setup: str
    expected: str


TABLE: tuple[Fixture, ...] = (
    Fixture(
        key="F1_SUPPORT_LONG_WICK",
        words="the mirror of 'top of the wick to where the candle closed'",
        setup=("15m support pivot, price (= the bar's LOW) 19000.0, bar range 20.0, lower-wick "
               "fraction 0.35, so the bar is low=19000.0 open=19020.0 close=19007.0 "
               "high=19020.0"),
        expected=("band = [19000.0, 19007.0].  lo is the WICK EXTREME (the low), hi is the "
                  "CLOSE.  Width 7.0 = 0.35 x 20.0, which is the candle's own wick-to-close and "
                  "nothing else.  The old symmetric band here was [18998.8, 19001.2], 2.4 wide, "
                  "and it extended BELOW the extreme, where his never does."),
    ),
    Fixture(
        key="F2_RESISTANCE_MIRRORED",
        words="'from the top of the wick to where the xandle closed'",
        setup=("15m resistance pivot, price (= the bar's HIGH) 20300.0, bar range 20.0, "
               "upper-wick fraction 0.35, so the bar is high=20300.0 open=20280.0 close=20293.0 "
               "low=20280.0"),
        expected=("band = [20293.0, 20300.0].  hi is the WICK EXTREME (the high), lo is the "
                  "CLOSE.  Width 7.0.  The band lies entirely on the CLOSE side of the extreme."),
    ),
    Fixture(
        key="F3_CLOSE_INSIDE_A_PRIOR_BAND",
        words="his sentence names the candle and nothing else",
        setup=("the rejection candle's close falls inside an ALREADY-ESTABLISHED zone's band, so "
               "the ruled band overlaps that zone"),
        expected=("the band is drawn IDENTICALLY - lo and hi come only from the candle.  It is "
                  "not shrunk, shifted, padded or clipped to avoid the overlap, because his "
                  "sentence contains no such instruction.  The PRE-EXISTING established-overlap "
                  "rule then applies to the RULED band exactly as it applied to the symmetric "
                  "one, and drops the swing zone.  Behaviour is chosen from the words; the fact "
                  "that the ruled band is wider and therefore overlaps more often is a "
                  "CONSEQUENCE of his shape, not a reason to reshape it."),
    ),
    Fixture(
        key="F4_JOIN_FAILURE_RAISES",
        words="no words of his cover a missing candle - so the code must refuse, not invent",
        setup="the pivot's source bar is absent from the 15m frame the band must be drawn on",
        expected=("RuntimeError V24_PIVOT_SOURCE_BAR_JOIN_FAILED:<side>:<t>.  It may NOT inherit "
                  "the join's old 'except Exception: return 0.5'.  A silent fallback draws a "
                  "plausible zone unrelated to its candle, and nothing goes red."),
    ),
    Fixture(
        key="F5_WIDTH_IS_POSITIVE_BY_CONSTRUCTION",
        words="derived, not chosen - this is why no floor is needed",
        setup=("every pivot reaching the band build has already passed wick >= p.min_wick "
               "(0.20) in this module's own history filter, and wick is the wick fraction "
               "measured from the BODY EDGE: upper = (high - max(open,close)) / range for R, "
               "lower = (min(open,close) - low) / range for S"),
        expected=("width > 0 STRICTLY, and width >= min_wick x range.  PROOF, support side: "
                  "min(open,close) - low >= 0.20 x range, and close >= min(open,close), so "
                  "close - low >= 0.20 x range > 0.  Resistance mirrors it: close <= "
                  "max(open,close), so high - close >= high - max(open,close) >= 0.20 x range "
                  "> 0.  A zero-width or inverted band is therefore UNREACHABLE for any "
                  "admitted pivot, SO NO MINIMUM-WIDTH FLOOR IS REQUIRED - and adding one would "
                  "be exactly the new magnitude ALGO-119 section 7 says to stop for.  The "
                  "degenerate branch still RAISES rather than passing, so a later change to the "
                  "filter fails loudly instead of drawing a zero-width zone."),
    ),
    Fixture(
        key="F6_NO_MAGNITUDE_IS_ADDED",
        words="'the width is whatever that candle's wick-to-close IS'",
        setup="any admitted pivot",
        expected=("the two band edges are the bar's OWN float values, bit-for-bit: no pad, no "
                  "ATR term, no tick floor, no rounding.  TICK * 4.0 and key_level_pad_atr do "
                  "not appear on this path after the change."),
    ),
)

IDENTITY_DECISIONS = (
    ("zone id anchor",
     "STAYS on the pivot's own level price (the wick extreme).  The zone is the SAME zone - "
     "same pivot, same level, same side, same confirmation time - and only its band SHAPE "
     "changed.  Keeping the identity is what makes the before/after guard comparable BY KEY."),
    ("zone.mid",
     "becomes the RULED BAND'S MIDPOINT.  mid is consumed as a band-interior reclaim/away "
     "threshold (zone_lifecycle line 91, gold_lifecycle lines 31/35), and every other zone "
     "family already sets it to the middle of its own band.  Leaving it on the pivot price "
     "would place it exactly ON an edge of the new band, which would silently change what "
     "'reclaimed' means.  No magnitude is introduced."),
)


def main() -> None:
    print("A-PRIORI BAND-SHAPE FIXTURE TABLE - from his sentence, before any measurement\n")
    for f in TABLE:
        print(f"[{f.key}]")
        print(f"  FROM HIS WORDS : {f.words}")
        print(f"  SETUP          : {f.setup}")
        print(f"  EXPECTED       : {f.expected}\n")
    print("IDENTITY DECISIONS (mechanism, not magnitude):\n")
    for name, why in IDENTITY_DECISIONS:
        print(f"  {name}: {why}\n")


if __name__ == "__main__":
    main()
