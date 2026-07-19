"""Tooth-2 per-spec coverage check (R-043 §4; commissioning-grade F-1 fix).

THE ONE THING: a battery wave is "all judges accounted for" ONLY when every
unconditional verdict-bearing judge, FOR EVERY SPEC, either fired on that spec or
is explicitly dispositioned for that spec. The trap the commissioning grade
mutation-caught: judging each spec's coverage against WAVE-GLOBAL sets — a judge
that fired (or was gated) on ONE spec silently excused its absence on ANOTHER.
That is a detector-can-lie: it reads clean while a real per-spec gap hides,
surfacing the first time a wave has genuine per-spec gating heterogeneity.

The rule, per spec: `coverage_gaps(spec)` already returns only the unconditional
gates that did NOT fire on THIS spec. Such a gap is dispositioned iff it is
  * PATH_GATED wave-level — a path property (e.g. the class-CPCV path never
    computes wrc/spa/mc) is true for every spec, so it excuses the gap on all; OR
  * SPEC_GATED FOR THIS SPEC — a per-spec ghost property (e.g. this spec's PBO is
    degenerate), recorded against this exact spec.
Never excused by another spec's firing or gating.
"""

from __future__ import annotations

from typing import Callable, Dict, List, Set, Tuple


def undispositioned_gaps(
    specs: List[str],
    coverage_gaps_for: Callable[[str], List[str]],
    wave_path_gated: Set[str],
    per_spec_gated: Dict[str, Dict[str, str]],
) -> List[Tuple[str, str]]:
    """Return [(spec, gate), ...] of per-spec coverage gaps that are NOT
    dispositioned for that spec (empty => Tooth-2 fail-closed holds).

    Args:
        specs:            the spec refs (stubs) in the wave.
        coverage_gaps_for: fn(stub) -> unconditional verdict-bearing gates that did
                           NOT fire on that spec (e.g. PassageLedger.coverage_gaps).
        wave_path_gated:  gates dispositioned PATH_GATED at wave level (true for
                          every spec — a path property).
        per_spec_gated:   {stub: {gate: "SPEC_GATED" | "PATH_GATED"}} — the gate
                          dispositions recorded FOR THAT SPEC. Only a SPEC_GATED
                          entry for THIS spec excuses a gap here (PATH_GATED is
                          already covered wave-level).
    """
    out: List[Tuple[str, str]] = []
    for stub in specs:
        sg = per_spec_gated.get(stub, {})
        for gap in coverage_gaps_for(stub):
            excused = gap in wave_path_gated or sg.get(gap) == "SPEC_GATED"
            if not excused:
                out.append((stub, gap))
    return out
