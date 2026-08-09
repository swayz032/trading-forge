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
    """The two declarations must say the same thing, not merely both exist."""
    python_meta = FAMILY_META[CANONICAL_TYPE]
    entry = _mirror_entry(CANONICAL_TYPE)
    assert entry is not None, "mirror entry missing; see the previous test"

    # Python side — the properties that matter for a refusing family.
    assert python_meta.primitive is None
    assert python_meta.unsupported is True
    assert python_meta.unbound_reason == "opening_range_adapter_not_implemented"

    # TypeScript side — same three facts, read out of the mirror text.
    assert "primitive: null" in entry, f"mirror does not declare primitive null: {entry!r}"
    assert "unsupported: true" in entry, f"mirror does not declare unsupported: {entry!r}"
    assert f'unboundReason: "{python_meta.unbound_reason}"' in entry, (
        f"mirror's unboundReason disagrees with Python's "
        f"{python_meta.unbound_reason!r}: {entry!r}"
    )


def test_the_refusing_family_declares_no_primitive_to_fall_back_to():
    """The invariant that actually protects the money path.

    R-730 §4: the new type must NEVER fall back to `compute_structure_state`.
    The strongest form of that guarantee is having no primitive at all to fall
    back to — so this asserts the absence directly, on the declaration that
    production reads.
    """
    python_meta = FAMILY_META[CANONICAL_TYPE]
    declared_primitive, declared_mechanism = python_meta.enforced_declaration()
    assert declared_primitive is None
    assert declared_mechanism is None

    entry = _mirror_entry(CANONICAL_TYPE) or ""
    assert "structure_engine" not in entry, (
        "the mirror's opening-range entry names the structure engine — that is the exact "
        f"fallback R-730 §4 forbids: {entry!r}"
    )
