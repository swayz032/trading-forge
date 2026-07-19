"""H1 compile-stage TOPOLOGY PRODUCER (A-packet, ratify
`docs/designs/h1-a-packet-topology-producer-ratify-2026-07-15.md`).

THE ONE THING THIS MODULE DOES (packet §3, scope in amber): fill the
compile-stage `ConditionTopology`/`or_branches` overlay that
`cert_assembler.assemble_certificate` already accepts as an OPTIONAL argument,
so the 3 structural lints (direction_conflation_lint / unsat_sat_check /
or_alternatives_honored) EVALUATE instead of returning
`NOT_EVALUATED(no_compiled_topology)`. Before this producer, no pipeline stage
produced that overlay at the certificate layer, so `terminal_read_grade` went
INDETERMINATE for every video (the merge-silencing fence's forcing function).

EXPLICITLY OUT OF SCOPE (packet pin 1 -- this module does NONE of these):
  * does NOT touch the certified reader (tier1_detectors), the extractor /
    enumerator prompts, the compiler (spec_condition_compiler), the lints
    themselves, cert_assembler's grade logic, or the pilot/full grade math;
  * does NOT add lints or grow any schema;
  * does NOT re-run extraction, call an LLM, do I/O, or use randomness -- it is
    a pure function of its two arguments (replay-determinism contract).

NULL DESIGN (packet §4/pin 3, the seal-saver): a faithful null (a gestural
exit, a null stop -- e.g. `_LS6` dip-buy) produces topology over the conditions
that ARE PRESENT only. An absent field is simply not a condition: it
contributes no `ConditionTopology` entry, it does NOT raise, and it does NOT
set `topology_present=False`. Because every strategy has >=1 entry condition,
`assemble_certificate` sees a non-empty topology -> `topology_present=True` ->
the 3 structural lints EVALUATE on an honest null (single-direction, no
comparator, no OR -> all three PASS -> CLEAN). An honest null is never punished
for being honest with a compile failure or a NOT_EVALUATED.

RETURN-TYPE / SEAM NOTE: `produce_topology` returns the topology as a
`Dict[char_span, ConditionTopology]` (packet §3 signature). The assembler's
`topology=` parameter is a `List[ConditionTopology]` that it re-keys by
`char_span` internally (cert_assembler.py:248), so a caller passes
`list(topology.values())`. Both `char_span` keys and the `or_branches`
`condition_id`s must line up with the tier-1/tier-3 detections the caller hands
`assemble_certificate` (its synthetic ids are `t1-<i>`/`t3-<j>`, assignment
order) -- the caller owns building `condition_entries` so those join keys
match; this producer only reads them.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

from .cert_assembler import ConditionTopology

# --------------------------------------------------------------------------- #
# Input contract
# --------------------------------------------------------------------------- #

# field-of-origin -> compile-integrity role (packet §3 "role spine/confluence").
# entry_sequence / preconditions / stop / targets are gating spine conditions;
# confluences are the soft-confluence bucket (spec_family_bindings role
# vocabulary). role is load-bearing ONLY for or_alternatives_honored (which
# gates on >=2 role=="spine" members of an or_branches group).
_ROLE_BY_FIELD = {
    "entry_sequence": "spine",
    "precondition": "spine",
    "stop": "spine",
    "target": "spine",
    "exit": "spine",
    "confluence": "confluence",
}

# All co-required conditions of ONE strategy object share this and_group
# (packet §3: "co-required conditions of one strategy object share
# and_group=0"). A merge-silenced object that fuses two opposite-direction
# setups puts BOTH in this group with no or_branches routing ->
# direction_conflation_lint FIRES. or_branches members are excluded from the
# AND grouping BY THE LINT (compile_lints.direction_conflation_lint), so they
# never trip it -- a correctly-split directional alternation is CLEAN.
_CO_REQUIRED_AND_GROUP = 0

# A literal symbolic comparator inside the condition text, e.g. "5-SMA > 50-SMA"
# or "close >= orh_15m". Prose conditions ("buy the pullback", "close above the
# vwap") carry NO symbolic operator -> comparator stays None, which is the
# normal case (packet §4): unsat_sat_check then has nothing to contradict ->
# PASS. Mirrors the operand/operator shape unsat_sat_check's own
# `_parse_comparator` full-matches (compile_lints.py:240).
_COMPARATOR_SEARCH = re.compile(r"(\S+)\s*(>=|<=|==|>|<)\s*(\S+)")


@dataclass
class ConditionEntry:
    """One already-anchored certificate condition, as the producer reads it.

    The CALLER builds these (its job -- the producer stays a pure derivation):
    `condition_id`/`char_span` are the certificate's own join keys (the id must
    equal the `t1-<i>`/`t3-<j>` the assembler assigns to the matching detection,
    the span must equal that detection's span). `field_kind` is the field the
    condition came from (entry_sequence/confluence/precondition/stop/target/
    exit) -> role. `text` is the condition's verbatim prose (comparator
    parsing). `direction` is a per-condition direction ONLY when the extraction
    itself marks the condition directional (else None -> the strategy direction
    applies). `or_group` tags mutually-substitutable OR-alternatives (entries
    sharing a tag form one or_branches group). `is_disabled_sentinel` is set
    ONLY for the anti-pattern never-true marker (never inferred from prose)."""

    condition_id: str
    char_span: Tuple[int, int]
    field_kind: str
    text: str
    direction: Optional[str] = None
    or_group: Optional[str] = None
    is_disabled_sentinel: bool = False


# --------------------------------------------------------------------------- #
# Pure derivations
# --------------------------------------------------------------------------- #


def _role_for(field_kind: Optional[str]) -> Optional[str]:
    return _ROLE_BY_FIELD.get((field_kind or "").strip())


def _extract_comparator(text: Optional[str]) -> Optional[str]:
    """Return a normalized `lhs op rhs` string iff the text LITERALLY contains a
    symbolic comparator, else None. Normalized to single spaces so it
    full-matches unsat_sat_check's `_parse_comparator` (which anchors
    `^\\s*(\\S+)\\s*(op)\\s*(\\S+)\\s*$`). Prose without a symbolic operator ->
    None (the packet §4 null case). This is deliberately NOT a semantic parser:
    it does not invent a comparator from words like "above"/"under" -- only a
    literal `>`/`<`/`>=`/`<=`/`==` between two non-space operands qualifies."""
    if not text:
        return None
    m = _COMPARATOR_SEARCH.search(text)
    if not m:
        return None
    return f"{m.group(1)} {m.group(2)} {m.group(3)}"


def _direction_for(entry: ConditionEntry, base_direction: Optional[str]) -> Optional[str]:
    """Per-condition direction when the condition itself is directional, else
    the strategy's direction (packet §3). A per-condition direction is honored
    only when the extraction MARKED one on the entry -- the producer never
    sniffs direction from prose."""
    if isinstance(entry.direction, str) and entry.direction.strip():
        return entry.direction.strip()
    return base_direction


def produce_topology(
    strategy_extraction: dict,
    condition_entries: List[ConditionEntry],
) -> Tuple[Dict[Tuple[int, int], ConditionTopology], List[List[str]]]:
    """Derive the compile-stage overlay for ONE extracted strategy.

    Returns `(topology, or_branches)`:
      * `topology`: `{char_span: ConditionTopology}` over the PRESENT conditions
        only (null design). Pass `list(topology.values())` to
        `assemble_certificate(topology=...)`.
      * `or_branches`: `List[List[condition_id]]`, one inner list per genuine
        OR-alternative group (an `or_group` tag shared by >=2 entries). A tag
        with a single member is not an alternation and is dropped.

    Per-condition derivation (packet §3):
      direction         -> per-condition direction if marked, else the
                           strategy's `direction`;
      and_group         -> `_CO_REQUIRED_AND_GROUP` (0) for every condition of
                           this object (co-required);
      comparator        -> parsed from the condition text iff a literal symbolic
                           comparator is present, else None;
      role              -> spine/confluence from `field_kind`;
      is_disabled_sentinel -> the entry's explicit never-true marker only.

    Pure/deterministic: same inputs -> byte-identical output, always."""
    base_direction: Optional[str] = None
    if isinstance(strategy_extraction, dict):
        d = strategy_extraction.get("direction")
        if isinstance(d, str) and d.strip():
            base_direction = d.strip()

    topology: Dict[Tuple[int, int], ConditionTopology] = {}
    # ordered so or_branches groups are emitted deterministically in
    # first-seen tag order with members in condition order.
    or_group_members: Dict[str, List[str]] = {}

    for entry in condition_entries:
        topology[entry.char_span] = ConditionTopology(
            char_span=entry.char_span,
            direction=_direction_for(entry, base_direction),
            and_group=_CO_REQUIRED_AND_GROUP,
            role=_role_for(entry.field_kind),
            is_disabled_sentinel=bool(entry.is_disabled_sentinel),
            comparator=_extract_comparator(entry.text),
        )
        if entry.or_group is not None and str(entry.or_group).strip():
            or_group_members.setdefault(str(entry.or_group), []).append(entry.condition_id)

    or_branches: List[List[str]] = [ids for ids in or_group_members.values() if len(ids) >= 2]
    return topology, or_branches
