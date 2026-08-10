"""B1 STEP 3 — focused Python/TypeScript parity fixture for OPENING_RANGE_DEFINITION.

AUTHORITY: R-727 §3 — "if `FAMILY_META` or any mirrored surface changes, the
TypeScript mirror moves in the SAME commit with a parity fixture." R-729 §2
corrected my reading of that clause: it is a PRICE, not a prohibition. This file
is the price, paid.

SCOPE, DELIBERATELY NARROW: the one family this commit adds. The broad
binding-plan parity gate already exists (`scripts/check-spec-binding-plan-parity.ts`)
and this does not duplicate it — a second broad gate would be a second truth.

WHY A TEXT PARSE AND NOT AN IMPORT: the mirror is TypeScript and this suite is
Python, so the mirror can only be read as text from here. That makes the PARSER
the weak point, so it carries a positive control: if the parser cannot find a
family that certainly exists, the parity assertions below are vacuous and the
control fails loudly rather than passing quietly.
"""

from __future__ import annotations

import re
from pathlib import Path

from src.engine.opening_range_definition import CANONICAL_TYPE
from src.engine.spec_family_bindings import FAMILY_META

REPO_ROOT = Path(__file__).resolve().parents[3]
TS_MIRROR = REPO_ROOT / "src/server/lib/spec-family-bindings.ts"

# A family entry in the mirror, from its name to the closing brace of its object
# literal (or to the end of a single-line entry).
_ENTRY_RE_TEMPLATE = r"^\s*{name}:\s*(\{{.*?\}}),?\s*$"


def _mirror_entry(name: str) -> str | None:
    """The raw text of one family's entry in the TypeScript mirror, or None."""
    source = TS_MIRROR.read_text(encoding="utf-8")
    match = re.search(
        _ENTRY_RE_TEMPLATE.format(name=re.escape(name)),
        source,
        re.MULTILINE | re.DOTALL,
    )
    return match.group(1) if match else None


def test_parser_positive_control():
    """The parser can see a family that certainly exists.

    Without this, every assertion below is satisfied by a regex that matches
    nothing. `A CONTROL THAT CANNOT SEE THE SHAPE YOU ARE HUNTING IS NOT A
    CONTROL` — this campaign promoted one into a ruling once (F-3) and this is
    the cheap version of not doing that again.
    """
    entry = _mirror_entry("WAIT_STRUCTURE")
    assert entry is not None, f"parser found no WAIT_STRUCTURE entry in {TS_MIRROR}"
    assert "structure_engine.compute_structure_state" in entry, (
        f"parser found a WAIT_STRUCTURE entry but not its known primitive: {entry!r}"
    )

    # And it must be able to MISS: a family that does not exist returns None,
    # so a match is evidence rather than an artefact of a permissive pattern.
    assert _mirror_entry("NO_SUCH_FAMILY_EXISTS") is None


def test_opening_range_definition_is_declared_on_both_sides():
    assert CANONICAL_TYPE in FAMILY_META, (
        f"{CANONICAL_TYPE} is not declared in the Python FAMILY_META"
    )
    assert _mirror_entry(CANONICAL_TYPE) is not None, (
        f"{CANONICAL_TYPE} is declared in Python but MISSING from the TypeScript mirror "
        f"{TS_MIRROR}. R-727 §3: the mirror moves in the SAME commit."
    )


def test_opening_range_definition_agrees_field_for_field():
    """DURABLE INVARIANT 1 (R-779 §7-b): Python and TypeScript agree the family is
    SUPPORTED and name the SAME primitive.

    TRANSITIONED (R-779 §7-b, authorized R-783 §6). Until the activation this test
    pinned the OPPOSITE claim — `primitive is None`, `unsupported is True`,
    `unboundReason: "opening_range_adapter_not_implemented"` — i.e. the deliberately
    temporary refusal state B1 STEP 3 shipped. That state is now retired, so the
    fixture moves with it.

    🛑 IT MAY NOT LOSE PROTECTION, which is the whole condition R-779 §7-b attached
    to letting it move. The old version proved the two surfaces agreed on a REFUSAL;
    this one proves they agree on an ACTIVATION, and it is strictly harder to satisfy
    — a refusal can be spelled two ways that both mean "off", but there is exactly one
    primitive string and both surfaces must carry it byte-for-byte.

    ★ THE PRIMITIVE IS DERIVED FROM `FAMILY_META`, NEVER TRANSCRIBED. This file must
    not become a second place the primitive's name is written down; a hand-copied
    string here would go stale silently, which is the defect one level up.
    """
    python_meta = FAMILY_META[CANONICAL_TYPE]
    entry = _mirror_entry(CANONICAL_TYPE)
    assert entry is not None, "mirror entry missing; see the previous test"

    # Python side — the family is supported and names a primitive.
    assert python_meta.unsupported is False, (
        "Python still declares OPENING_RANGE_DEFINITION unsupported=True. The family "
        "is activated; the declaration must say so."
    )
    primitive = python_meta.primitive
    assert primitive is not None, (
        "Python declares no primitive for an activated family. An activated family "
        "with no primitive is an unroutable pointer (pin (a))."
    )

    # TypeScript side — the SAME primitive, and no residue of the retired refusal.
    assert f'primitive: "{primitive}"' in entry, (
        f"mirror does not name Python's primitive {primitive!r}: {entry!r}"
    )
    assert "primitive: null" not in entry, (
        f"mirror still declares primitive null: {entry!r}"
    )
    assert "unsupported: true" not in entry, (
        f"mirror still declares unsupported: true for an activated family: {entry!r}"
    )


def test_the_activated_family_declares_a_primitive_and_never_falls_back_to_structure():
    """DURABLE INVARIANT 2 (R-779 §7-b): neither surface routes this family back to
    `structure_engine.compute_structure_state`.

    RENAMED IN THE TRANSITION. The old name —
    `test_the_refusing_family_declares_no_primitive_to_fall_back_to` — asserts a claim
    that is now FALSE: the family DOES declare a primitive. Leaving the name would have
    left a guard whose title states the opposite of what it checks.

    ⚖️ THE RENAME WAS MEASURED SAFE BEFORE IT WAS MADE, NOT ASSUMED (AR-915 §6,
    confirmed independently by the desk at R-783 §2): the 104-member manifest joins on
    FILE PATH, and ACCEPT-5 joins on pytest NODE ID but only over the 33-member FAILURE
    set — and no `family_parity` member is in that set. `A RENAME IS FREE UNTIL
    SOMETHING JOINS ON THE NAME.` Nothing does, while this test stays GREEN.

    R-730 §4's protection is UNCHANGED and is the reason this fixture still exists: the
    new type must NEVER fall back to `compute_structure_state`. The old proof of that
    was "it has no primitive at all". That proof is gone, so the invariant is now
    asserted DIRECTLY against the primitive the family really declares — which is the
    stronger statement, because it survives the family being switched on.
    """
    python_meta = FAMILY_META[CANONICAL_TYPE]
    declared_primitive, declared_mechanism = python_meta.enforced_declaration()

    assert declared_primitive is not None, (
        "the activated family declares NO primitive under enforcement. "
        "enforced_declaration() returns (None, None) while unsupported=True — if this "
        "fires, the FAMILY_META entry was not actually transitioned."
    )
    assert declared_mechanism is None, (
        f"opening range declares a MECHANISM {declared_mechanism!r}. It computes a real "
        "per-bar signal, so it declares a PRIMITIVE; a mechanism is the gates=False shape."
    )
    assert "structure_engine" not in declared_primitive, (
        f"the declared primitive {declared_primitive!r} names the structure engine — "
        "that is the exact fallback R-730 §4 forbids, now reachable because the family "
        "is switched on."
    )

    entry = _mirror_entry(CANONICAL_TYPE) or ""
    assert "structure_engine" not in entry, (
        "the mirror's opening-range entry names the structure engine — that is the exact "
        f"fallback R-730 §4 forbids: {entry!r}"
    )
