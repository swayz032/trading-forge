"""SURFACE 12B — THE RECORD-AWARE EXECUTION FAN-OUT (S6 EXECUTION ACTIVATION).

ONE TAUGHT CANDIDATE → ONE EXECUTION INSTANCE. For the golden record that is THREE
instances (5m · 15m · 30m), and the teacher's three alternatives become three bots.

WHY THIS EXISTS AS ITS OWN BOUNDARY
───────────────────────────────────
`RecordCompileResult` carries the portable `artifact` (plain JSON) beside a TYPED
sidecar of execution candidates. `SpecConditionStrategy` accepts exactly ONE
candidate. Something has to turn the many into the one, and WHERE that happens is
the whole question: any place that picks a single candidate is a place that chose a
window the teacher did not choose.

    `R-736`/`R-743`, SETTLED AND NOT RE-OPENED HERE: THE TEACHER GAVE THREE
     VERSIONS, SO THE FACTORY MAKES THREE BOTS.

So this module does the only thing that requires no choice at all: it FANS OUT. It
never selects, never ranks, never defaults, never reads `candidates[0]`, and never
infers a duration from the bar timeframe. `expand_execution_candidates` already
enforces the same law upstream — its committed comment reads `NONE PRIMARY, NONE
DEFAULT` — and this boundary is the runtime half of that sentence.

🛑 THE HONEST LIMIT, NAMED RATHER THAN DISCOVERED LATER (`R-785 §4`/`§5-c`)
──────────────────────────────────────────────────────────────────────────
`[MEASURED, R-785 §4]` `RecordCompileResult` has NO non-test consumer anywhere in
`src/` outside its own defining file. So this function's OWN CALLER DOES NOT EXIST
YET, and building it does not make the activation reachable on a real production
path — it moves the empty seam one hop upstream and TYPES it.

    `FILLING A CARRIER WHOSE OWN CONSUMER IS UNREACHABLE MOVES THE EMPTY SEAM ONE
     HOP UPSTREAM — IT DOES NOT CLOSE IT.`

State of this seam, verbatim, so nobody has to re-derive it:

    SEAM-COMPLETE, CONSUMER-UNWIRED — MP-1 OWNS THE CALLER.

That is a NAMED gap, not a hidden one. Proving the fan-out by test is the correct
and authorized state today; hunting for a production caller is `MP-1` and is out of
scope for this commit.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from src.engine.opening_range_candidate import OpeningRangeExecutionCandidate

if TYPE_CHECKING:  # pragma: no cover - typing only, keeps this module import-light
    from src.engine.extraction.spec_producer import RecordCompileResult
    from src.engine.spec_condition_compiler import SpecConditionStrategy


def build_execution_instances(
    result: RecordCompileResult,
    *,
    symbol: str = "MES",
    timeframe: str = "5m",
    trace: bool = False,
    strategy_name: str | None = None,
) -> tuple[SpecConditionStrategy, ...]:
    """One executable strategy per taught opening-range candidate, in TAUGHT ORDER.

    Returns an EMPTY tuple when the record taught no opening range, or when its
    lowering REFUSED. That is the refusal surviving the fan-out rather than being
    repaired into a default: a `SOURCE_INCOMPLETE` record has no definition to
    expand, so any candidate here would be an invented duration wearing a valid
    type. `RecordCompileResult.__post_init__` already makes the inconsistent pair
    unconstructable; this returns nothing rather than inventing something.

    🛑 EVERY INSTANCE IS TOLD EXACTLY WHICH WINDOW IT IS. No instance receives the
    collection, so no instance can search it, and there is nothing for a downstream
    `[0]` to index. `AN INDEX IS A SILENT DEFAULT WEARING A TEST'S CLOTHES` — and it
    is exactly as silent in production code.

    🛑 `timeframe` IS BAR RESOLUTION AND IS PASSED THROUGH UNTOUCHED. It is NOT
    consulted to pick a window. A `1m` chart may legitimately run a `30m` opening
    range; conflating the two dimensions would produce a confident wrong window on
    every chart whose resolution happened to match a taught duration.
    """
    from src.engine.spec_condition_compiler import from_compiled_spec

    candidates = tuple(result.opening_range_candidates)
    if not candidates:
        return ()

    instances = tuple(
        from_compiled_spec(
            result.artifact,
            symbol=symbol,
            timeframe=timeframe,
            trace=trace,
            strategy_name=strategy_name,
            opening_range_candidate=candidate,
        )
        for candidate in candidates
    )

    # ── THE FAN-OUT'S OWN INVARIANT, ENFORCED RATHER THAN DOCUMENTED ─────────────
    # A silently dropped or doubled candidate is the failure this boundary exists to
    # prevent, and it is invisible downstream: three bots that should be 5/15/30 but
    # are 5/15/15 produce entirely reasonable-looking numbers.
    if len(instances) != len(candidates):
        raise ValueError(
            f"fan-out produced {len(instances)} instance(s) for {len(candidates)} taught "
            "candidate(s); one taught alternative must become exactly one execution instance"
        )
    carried = [instance.opening_range_candidate for instance in instances]
    if any(c is None for c in carried):
        raise ValueError(
            "an execution instance came back without its candidate; the carrier was dropped "
            "in transport and the instance can no longer say which window it runs"
        )
    identities = [c.candidate_id for c in carried if c is not None]
    if len(set(identities)) != len(identities):
        raise ValueError(
            f"two execution instances carry the SAME candidate identity ({identities}); "
            "the taught alternatives collapsed and the bots are no longer distinct"
        )
    return instances


__all__ = ["build_execution_instances", "OpeningRangeExecutionCandidate"]
