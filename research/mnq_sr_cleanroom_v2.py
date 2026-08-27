#!/usr/bin/env python3
"""MNQ-SR-CLEANROOM-v2 - a RUNNABLE strategy, not a map. Authorized by ALGO-164.

FROZEN AND COMMITTED BEFORE ANY BACKTEST RUNS. `FIDELITY -> FREEZE -> CLEAN EDGE`.
The commit order is the evidence. No value in this file was chosen by what it does to a result,
because when it was written no result existed.

THE FOURTEEN REPLAY SESSIONS ARE OUT OF SCOPE HERE (ALGO-164) - not as a map reference, not as a
scoring set, not as an ablation target, not as a sanity check. This module opens no replay label,
no case manifest and no `algo1*` artifact. VERIFY ON THE AST, NOT THE TEXT: this docstring is
itself a source of the strings a substring search would find - the trap this campaign walked into
five times. The import list is the real evidence and it is three lines.

WHERE EVERY RULE COMES FROM. Nothing here is invented and nothing is fitted:

  MAP        v1 unchanged (`mnq_sr_cleanroom_v1.build_map`), ranked by MEMBERS, not confluence.
             ALGO-163 measured confluence deciding 0 of 14 cuts, `NO_CONFLUENCE == AS_BUILT == 17`
             and `CONFLUENCE_ONLY == 6` - the worst arm measured. ALGO-164 ruled: retire the claim,
             and licensed a SUCCESSOR build to drop the term. This is that successor.

  ANCHOR     The map is drawn at the WINDOW OPEN, 08:00, not at 09:30.
             THIS IS FORCED BY CAUSALITY, NOT CHOSEN. v2.4 draws its map at 09:30
             (`v2_2_engine.py:897`) while entries begin at 08:00 (`:43`, `:935`). For a runnable
             strategy an entry at 08:50 may not consult a map built from bars up to 09:30. A later
             anchor is lookahead; there is no version of this choice that is a parameter.

  ENTRY      His ratified method, sections 4 and 5 of `MNQ-STRATEGY-SPECIFICATION.md`
             ("thats correct", 2026-08-26). EVERY TRIGGER IS STRUCTURAL - it is always
             "the next bar takes the prior bar's extreme". NO body fraction, NO close location,
             NO displacement magnitude, NO ATR floor. Those were measured never to be his
             (ALGO-073: a rejection is a rejection wick, a candle that does NOT break the level;
             `body_frac` and `close_loc` were never his).
               * REJECTION (section 4): a 5m wick enters the band and the candle does NOT close
                 through it -> SETUP. Trigger: the next 5m trades beyond that candle's opposite
                 extreme. "Rejection by itself is not enough" plus a directional momentum trigger.
               * BREAK (section 5): a 5m closes beyond the band -> SETUP ONLY, "the first candle
                 through the level is a setup, not an entry". Trigger: the next 5m trades beyond
                 that breakout candle's extreme.

  DIRECTION  Taken from the INTERACTION, never from a stored zone role. Section 3: a level is an
             inflection point, not a prediction; the same area can reject, reclaim, break, accept,
             or later flip role. This also sidesteps the `Zone.side` live-role trap that mirrored
             41 percent of bands in an earlier measurement.

  TARGET     Section 7: THE NEAREST MEANINGFUL REACTION, and a nearer destination is never skipped
             for a farther one. Implemented as the nearest zone edge lying ahead of entry in the
             direction of the trade.
             `3.83R` IS NOT THE TARGET RULE AND SETS NO PRICE. The frozen input reads "median
             3.83R, LADDERED TO STRUCTURAL DESTINATIONS" - the destination is structural and 3.83
             is the statistic that describes it. It is carried below as a REPORTING REFERENCE ONLY
             and enters no predicate, per the standing order that his volunteered figures go in
             the report and not in the code.
             NO DESTINATION AHEAD MEANS NO TRADE. Section 7 `no_blind_rollover`: you do not invent
             a place for the trade to go.

  STOP       17.25 points. `[preserved_invariants: 17.25_point_stop]`
  WINDOW     08:00-12:00 ET. Operator reassertion 2026-08-23; `v2_2_engine.py:43-44`.
  ONE TRADE  The FIRST qualifying setup of the session.
             NAMED LIMITATION, NOT A SOLVED PREDICATE: "the first A+" is implemented as clock
             order, exactly as v2.4 implements it, because `FIRST_A_PLUS` has no implementing
             predicate anywhere in the corpus. Deriving one from the fourteen sessions is
             forbidden and deriving one from nothing is invention. This is the honest floor.
  FLAT       Day trader only, no swing - any open position is closed at the last bar held.

CONSERVATIVE CONVENTIONS, declared here rather than discovered later:
  * stop and target both touched inside one 5m bar -> STOP fills. Pessimistic by construction.
  * entry fills at the trigger price, or at the bar open when the open is already through it.
    No optimistic intrabar fill is ever assumed.
"""
from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

import research.mnq_sr_cleanroom_v1 as CR

# -- CITED CONSTANTS. Every one has a source. None was chosen by a result. --
STOP_POINTS = 17.25                          # preserved_invariants: 17.25_point_stop
TRADE_START = pd.Timestamp("08:00").time()   # operator 2026-08-23; v2_2_engine.py:43
LAST_ENTRY = pd.Timestamp("12:00").time()    # v2_2_engine.py:44
MAX_TRADES_PER_SESSION = 1                   # preserved_invariants
TOP_ZONES = 3                                # ALGO-161:110, the contract's own unit

#: REPORTING REFERENCE ONLY. Sets no price, gates nothing, enters no predicate. ALGO-100D sec 2.
R_REFERENCE = 3.83


@dataclass
class Trade:
    session: str
    kind: str
    side: str
    t_entry: pd.Timestamp
    entry: float
    stop: float
    target: float
    t_exit: pd.Timestamp
    exit: float
    reason: str
    zone_lo: float
    zone_hi: float

    @property
    def points(self) -> float:
        return (self.exit - self.entry) if self.side == "L" else (self.entry - self.exit)

    @property
    def r_multiple(self) -> float:
        return self.points / STOP_POINTS

    @property
    def planned_r(self) -> float:
        return abs(self.target - self.entry) / STOP_POINTS


def map_for_session(h15, full5, session_day, tz) -> list:
    """v1 map, ranked by MEMBERS (confluence retired per ALGO-163/164), drawn at the open."""
    asof = pd.Timestamp(f"{session_day} 08:00", tz=tz)
    CR.TOP_PER_SESSION = 10 ** 9
    try:
        zones = CR.build_map(h15, full5, asof)
    finally:
        CR.TOP_PER_SESSION = 3
    zones.sort(key=lambda z: (-z.members, -z.last_t.value))
    return sorted(zones[:TOP_ZONES], key=lambda z: z.mid)


def nearest_destination(zones, entry: float, side: str):
    """Section 7: the NEAREST meaningful reaction ahead. A nearer one is never skipped."""
    if side == "L":
        ahead = [z.lo for z in zones if z.lo > entry]
        return min(ahead) if ahead else None
    ahead = [z.hi for z in zones if z.hi < entry]
    return max(ahead) if ahead else None


def setup_at(bar, zones):
    """Sections 4 and 5. Returns (kind, side, trigger_price, zone) or None.

    REJECTION - the wick enters the band and the candle does NOT close through it.
    BREAK     - the candle closes beyond the band. Setup only, never the entry.
    Direction comes from the interaction, never from a stored role.
    """
    for z in zones:
        if not (bar.low <= z.hi and bar.high >= z.lo):
            continue
        if bar.close > z.hi and bar.open <= z.hi:
            return ("BREAK", "L", bar.high, z)
        if bar.close < z.lo and bar.open >= z.lo:
            return ("BREAK", "S", bar.low, z)
        if bar.high >= z.lo and bar.close < z.lo:
            return ("REJECTION", "S", bar.low, z)
        if bar.low <= z.hi and bar.close > z.hi:
            return ("REJECTION", "L", bar.high, z)
    return None


def run_session(day5: pd.DataFrame, zones: list, session_day: str):
    """One session. The FIRST qualifying setup, one trade, flat by the last bar held."""
    if not zones or day5.empty:
        return None
    bars = day5[(day5.index.time >= TRADE_START) & (day5.index.time <= LAST_ENTRY)]
    rows = list(bars.itertuples())
    for i in range(len(rows) - 1):
        found = setup_at(rows[i], zones)
        if found is None:
            continue
        kind, side, trig, z = found
        nxt = rows[i + 1]
        if side == "L" and nxt.high <= trig:
            continue
        if side == "S" and nxt.low >= trig:
            continue
        entry = max(trig, nxt.open) if side == "L" else min(trig, nxt.open)
        tgt = nearest_destination(zones, entry, side)
        if tgt is None:
            continue
        stop = entry - STOP_POINTS if side == "L" else entry + STOP_POINTS
        after = day5[day5.index > nxt.Index]
        for ex in after.itertuples():
            hit_stop = ex.low <= stop if side == "L" else ex.high >= stop
            hit_tgt = ex.high >= tgt if side == "L" else ex.low <= tgt
            if hit_stop:
                return Trade(session_day, kind, side, nxt.Index, entry, stop, tgt,
                             ex.Index, stop, "STOP", z.lo, z.hi)
            if hit_tgt:
                return Trade(session_day, kind, side, nxt.Index, entry, stop, tgt,
                             ex.Index, tgt, "TARGET", z.lo, z.hi)
        if len(after):
            return Trade(session_day, kind, side, nxt.Index, entry, stop, tgt,
                         after.index[-1], float(after.iloc[-1].close), "SESSION_END",
                         z.lo, z.hi)
        return None
    return None
