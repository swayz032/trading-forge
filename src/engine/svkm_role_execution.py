"""SVKM-ROLE-EXEC-1 — the narrow 5m-window / 1m-execution seam. ONE SOURCE, NO FRAMEWORK.

Authority: AR-1113 (gpt-rulings `12b565ad`) §3 "narrow sVkm 5m→1m source-role execution
adapter", §3.1 "prefer two explicit source frames", §3.2 fail-closed boundaries.

WHY THIS MODULE EXISTS — THE DEFECT IT REMOVES
----------------------------------------------
`[MEASURED, AR-1113 §2.4, re-measured at 365dfa0b]` the role carrier landed and the
runtime PARSES it:

    backtester.py:7537   _cls_source_timeframe_roles = _resolve_source_timeframe_roles(strategy)

and then `grep -rn _cls_source_timeframe_roles` returns exactly two lines — the
initialisation and that assignment. **Nothing reads it.** The engine can therefore prove
a role declaration exists while remaining unable to execute the role semantics, and the
production class backtest still loads ONE bar series off the scalar `strategy.timeframe`.

    ★★★★★ `A SOURCE FACT THAT IS VALIDATED BUT CANNOT CHANGE EXECUTION IS NOT YET A
       COMPILED MONEY-PATH FACT.` (AR-1113 §1)

This module is the smallest seam that makes the role VALUE change what the engine reads.

🛑 WHAT THIS IS NOT, AND THE RULING SAYS SO BY NAME (AR-1113 §3)
----------------------------------------------------------------
NOT a generic multi-timeframe orchestration engine · NOT strategy-wide resampling
infrastructure · NOT a generalized timeframe dependency graph · NOT a framework for
future timeframe combinations. It refuses every role combination that is not sVkm's,
which is precisely what stops it becoming a framework by accretion.

    `THE NARROWNESS IS THE FEATURE. A SEAM THAT ACCEPTS EVERY COMBINATION IS THE
     GENERIC ENGINE THE RULING FORBADE, ARRIVING ONE ROLE AT A TIME.`

TWO EXPLICIT FRAMES, NOT A RESAMPLER (AR-1113 §3.1)
---------------------------------------------------
The 5m opening-range series is supplied as its own frame. Deriving it from 1m data would
quietly introduce a second ungraded question — *does our 1m→5m aggregation reproduce the
vendor's 5m bar boundaries and timestamp semantics?* — and answer it by assumption. That
equivalence must be separately demonstrated before it may be relied on; this module
therefore has no aggregation path at all, so there is nothing to assume.

`src/data/scripts/resample_timeframes.py` already produces stored higher-timeframe series
at the DATA layer. That is where a 5m frame comes from; it is not re-implemented here.

NO SECOND CALCULATOR
--------------------
The range arithmetic is delegated to `opening_range_adapter.compute_opening_range_state`,
the module the desk already audited (R-736 §5-1: `A SECOND CALCULATOR AGREES WITH THE
FIRST UNTIL THE DAY IT DOES NOT`). This file contributes the ROLE BINDING and the FRAME
VALIDATION, and no max/min of its own.

🛑 THE CAUSAL GATE IS NOT IN THIS FILE, AND SAYING SO IS THE POINT (AR-1115 §3.3)
---------------------------------------------------------------------------------
It once was, in `CausalOpeningRange` — and `[MEASURED, AR-1115 §2.4]` NOTHING IN
PRODUCTION EVER CALLED IT. SYSTEM-INVENTORY classified it BUILT-UNREACHABLE while this
module's suite red-proofed it heavily, so the campaign held a well-tested causal
implementation and a separately-written live one, and only the dead one was being
examined.

    ★★★★★ `A SAFETY PROOF ATTACHED TO DEAD CODE IS NOT PRODUCTION EVIDENCE — AND THE
       BETTER ITS PROOFS LOOK, THE LONGER NOBODY CHECKS THE PATH THAT RUNS.`

The causal gate that ACTUALLY EXECUTES lives in
`spec_condition_compiler._h_opening_range`: the lock comes from the opening-range
adapter's own `_window_bounds`, and no execution bar is marked available until
`ts_list[i] >= lock`. The rule it enforces is unchanged and still the whole safety
argument — the 5m range may become visible to the 1m path only AFTER the source candle
is complete, half-open `[start, lock)` — but the proofs for it are now attached to that
handler, in `tests/test_svkm_role_execution.py` §9.B, not to this file.
"""

from __future__ import annotations

import dataclasses
import re
from datetime import datetime

from src.engine.source_timeframe_roles import (
    BREAKOUT_CONFIRMATION,
    ENTRY_COMPLETION,
    FVG_DETECTION,
    OPENING_RANGE_WINDOW,
    SourceTimeframeRoles,
)


class SourceRoleExecutionError(ValueError):
    """Every refusal in this module. Named so a caller can tell a role-fidelity refusal
    apart from an arbitrary ValueError deeper in the stack — the same discipline as
    `SourceTimeframeRoleError`."""


# ── THE sVkm ROLE COMBINATION — CLOSED, AND CHECKED BY VALUE ─────────────────
# AR-1113 §3.1 states the required resolution explicitly. This dict is the whole
# "which source is this adapter for" answer: a role set that does not match it is
# refused rather than executed on a best guess.
#
# 🛑 THIS IS A GUARD, NOT A DEFAULT. It never SUPPLIES a timeframe — it only refuses a
# carrier whose timeframes are not these. The values still come from the persisted
# source contract, so a row that lost its roles cannot be rescued by this table.
SVKM_EXPECTED_ROLE_TIMEFRAMES: dict[str, str] = {
    OPENING_RANGE_WINDOW: "5m",
    BREAKOUT_CONFIRMATION: "1m",
    FVG_DETECTION: "1m",
    ENTRY_COMPLETION: "1m",
}

_TIMEFRAME_PATTERN = re.compile(r"^(\d+)m$")


def parse_minutes(timeframe: str) -> int:
    """`'5m' -> 5`. Refuses everything else, on purpose.

    Deliberately supports ONLY whole-minute timeframes. `1h` and `1d` are not
    unsupported-by-oversight — supporting them is how this narrow seam grows into the
    generic engine AR-1113 §3 forbids. When a source needs them, that is a ruling, not
    a regex change.
    """
    if not isinstance(timeframe, str):
        raise SourceRoleExecutionError(
            f"timeframe {timeframe!r} is not a string; a role timeframe must be a "
            "declared value, never an inferred object"
        )
    match = _TIMEFRAME_PATTERN.match(timeframe.strip())
    if not match:
        raise SourceRoleExecutionError(
            f"timeframe {timeframe!r} is not a whole-minute timeframe such as '1m' or "
            "'5m'. This seam is deliberately narrow (AR-1113 §3); widening it is a "
            "ruling, not a parsing change. REFUSING."
        )
    minutes = int(match.group(1))
    if minutes <= 0:
        raise SourceRoleExecutionError(f"timeframe {timeframe!r} is not positive")
    return minutes


def assert_svkm_role_combination(roles: SourceTimeframeRoles) -> None:
    """Refuse any role set that is not sVkm's 5m-window / 1m-execution combination.

    AR-1113 §3.2: *"the expected sVkm role combination is not present"* is a refusal.
    `SourceTimeframeRoles` already proves the set is COMPLETE and internally consistent;
    it has no opinion about WHICH source it describes. That is this check's job.
    """
    wrong: list[str] = []
    for role, expected in SVKM_EXPECTED_ROLE_TIMEFRAMES.items():
        # `timeframe_for` RAISES on an absent role rather than borrowing a sibling's
        # value, so a missing role surfaces here as a refusal, not as a silent skip.
        actual = roles.timeframe_for(role)
        if actual.strip() != expected:
            wrong.append(f"{role}: declared {actual!r}, this adapter requires {expected!r}")
    if wrong:
        raise SourceRoleExecutionError(
            "the persisted role set is not the sVkm 5m-window / 1m-execution "
            "combination this narrow adapter was authorised for (AR-1113 §3.1):\n  "
            + "\n  ".join(wrong)
            + "\nA generic multi-timeframe engine is NOT authorised (AR-1113 §3), so "
            "an unrecognised combination REFUSES rather than being handled generically."
        )


@dataclasses.dataclass(frozen=True)
class RoleFrame:
    """One supplied bar series, and the role timeframe it CLAIMS to be.

    `timestamps` are the bars' OPEN instants and must be timezone-aware — the same rule
    `OpeningRangeBar` enforces, for the same reason: wall-clock without a zone is not a
    moment in time, and guessing one is how a range lands on the wrong hour for half
    the year.
    """

    timeframe: str
    timestamps: tuple[datetime, ...]
    highs: tuple[float, ...]
    lows: tuple[float, ...]

    def __post_init__(self) -> None:
        n = len(self.timestamps)
        if len(self.highs) != n or len(self.lows) != n:
            raise SourceRoleExecutionError(
                f"frame {self.timeframe!r} has ragged columns: "
                f"{n} timestamps, {len(self.highs)} highs, {len(self.lows)} lows"
            )
        if n == 0:
            raise SourceRoleExecutionError(
                f"frame {self.timeframe!r} is empty; an empty frame is exactly what a "
                "failed load looks like, and it is refused rather than treated as a "
                "session with no bars"
            )
        for ts in self.timestamps:
            if ts.tzinfo is None or ts.utcoffset() is None:
                raise SourceRoleExecutionError(
                    f"frame {self.timeframe!r} carries the timezone-naive timestamp "
                    f"{ts!r}; supply aware datetimes so the session window is unambiguous"
                )

    def verify_spacing(self) -> None:
        """Prove the frame IS the timeframe it says it is.

        🛑 AR-1113 §3.2: *"the persisted role carrier and the actual supplied frame
        timeframes disagree"* must refuse. A LABEL CHECK CANNOT SEE THAT — comparing the
        declared string against itself always passes. So this reads the actual bar
        spacing off the data.

        `A FRAME THAT IS TRUSTED BECAUSE OF ITS LABEL IS A 1m SERIES ONE MISLABEL AWAY
         FROM BEING AGGREGATED AS 5m.`
        """
        expected = parse_minutes(self.timeframe)
        ordered = sorted(self.timestamps)
        if list(ordered) != list(self.timestamps):
            raise SourceRoleExecutionError(
                f"frame {self.timeframe!r} is not in ascending timestamp order; an "
                "out-of-order series cannot be checked for causality"
            )
        if len(set(self.timestamps)) != len(self.timestamps):
            raise SourceRoleExecutionError(
                f"frame {self.timeframe!r} contains duplicate timestamps; which bar is "
                "the truth is not a question this adapter may answer by picking one"
            )
        # ─── AR-1133 §5.1 — THE GRID PREDICATE, REPAIRED AGAINST REAL FUTURES DATA ───
        # The original rule was `every gap == timeframe`. `[MEASURED 2026-08-13]` NO REAL
        # futures series can satisfy it: MES 5m over 2024-03-04..08 is 1308 bars with
        # gaps `5.0 x1303` and `65.0 x4`, the four 65s being the CME daily maintenance
        # halt (17:00-18:00 ET). The sampling was CORRECT and the predicate was wrong —
        # it could not tell a legitimate session break from wrong sampling, because it
        # had only ever been red-proofed against synthetic CONTIGUOUS fixtures.
        #
        #   ★★★★★ `A GUARD THAT HAS ONLY EVER SEEN FIXTURES IS AN UNTESTED HYPOTHESIS
        #      ABOUT PRODUCTION — AND THE CLEANER ITS FIXTURES, THE LONGER THAT HOLDS.`
        #
        # 🛑 THE EXACT-GAP WITNESS IS NOT REDUNDANT, AND IT CLOSES A HOLE MY OWN FIRST
        # PROPOSAL HAD. "Integer multiple" alone accepts a pure 10m series labelled 5m,
        # since every 10m gap is a multiple of 5. Requiring at least ONE gap to equal the
        # declared timeframe exactly forces the series to actually be ON that grid rather
        # than merely compatible with it (AR-1133 §5.1).
        #
        # SCOPE, STATED SO IT IS NOT OVER-READ: this proves CADENCE/GRID compatibility.
        # It does NOT prove bar-content provenance — that comes from
        # `_supply_opening_range_source_frame()` requesting the role's own timeframe from
        # the production loader, plus the no-resampling guard.
        saw_exact_gap = False
        for earlier, later in zip(self.timestamps, self.timestamps[1:], strict=False):
            gap = later - earlier
            total_seconds = gap.total_seconds()
            expected_seconds = expected * 60
            if total_seconds <= 0 or total_seconds % expected_seconds != 0:
                raise SourceRoleExecutionError(
                    f"frame declared {self.timeframe!r} has a {gap} gap between "
                    f"{earlier.isoformat()} and {later.isoformat()}, which is not a whole "
                    f"multiple of {expected}m; the declared role timeframe and the supplied "
                    "series disagree (AR-1113 §3.2). REFUSING rather than aggregating a "
                    "series of unknown sampling."
                )
            if total_seconds == expected_seconds:
                saw_exact_gap = True

        if not saw_exact_gap:
            raise SourceRoleExecutionError(
                f"frame declared {self.timeframe!r} contains NO adjacent gap of exactly "
                f"{expected}m — every gap is a larger multiple. A coarser series is "
                "arithmetically compatible with a finer grid (a 10m series 'fits' 5m), so "
                "without one exact-cadence witness this frame cannot be shown to be on "
                f"the {self.timeframe!r} grid at all. REFUSING (AR-1133 §5.1)."
            )

    def zone_key(self) -> str:
        """The frame's UTC offsets, as the identity two frames must agree on.

        AR-1113 §3.2 refuses when *"the 1m and 5m frames disagree on session/timezone
        identity"*. Comparing `tzinfo` objects would compare LABELS; two frames can
        carry the same zone name and different offsets if one was localised wrong, so
        the offset actually in force is the honest key.
        """
        return "|".join(sorted({str(ts.utcoffset()) for ts in self.timestamps}))


# ── AR-1115 §3.3 — `CausalOpeningRange` / `build_causal_opening_range` DELETED HERE ──
#
# They were a SECOND causal implementation, tested heavily and called by nothing:
# SYSTEM-INVENTORY classified `build_causal_opening_range` BUILT-UNREACHABLE and a grep
# for non-test callers returned none. Production causality lives in
# `spec_condition_compiler._h_opening_range`'s own lock loop, and AR-1115 §2.5 ruled that
# the helper's ablations therefore proved the helper, not the money path.
#
#   ★★★★★ `A SAFETY PROOF ATTACHED TO DEAD CODE IS NOT PRODUCTION EVIDENCE — AND TWO
#      IMPLEMENTATIONS OF ONE RULE AGREE UNTIL THE DAY THE LIVE ONE CHANGES ALONE.`
#
# Every unique refusal it carried was MEASURED against the production seam before it was
# removed, not argued about, and each real one is now pinned by a `test_PRODUCTION_*`
# test in `tests/test_svkm_role_execution.py` §9.C:
#
#   duplicated 09:30 bar            -> REFUSES in production (`verify_spacing`)
#   frame labelled for a wrong role -> REFUSES in production (label check)
#   naive ET stamps read as UTC     -> REFUSES in production (AR-1115 §3.1 incomplete)
#   missing 09:30 candle            -> REFUSES in production (AR-1115 §3.1 incomplete)
#   two frames in different zones   -> production ACCEPTS, and is RIGHT to: the same
#                                      instants in UTC yield the identical taught range.
#                                      That refusal was representation strictness, which
#                                      the helper's own docstring admitted.
#
# What survives here is exactly what production calls: `SourceRoleExecutionError`,
# `parse_minutes`, `assert_svkm_role_combination`, `RoleFrame`.
