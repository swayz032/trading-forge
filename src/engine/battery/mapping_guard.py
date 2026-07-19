"""Strict-key guard for verdict/disposition mappings (R-048 §2).

THE ONE THING: reading a key ABSENT from a result schema, inside a mapping that
turns that result into a verdict or disposition, must FAIL LOUD — never silently
default to a constant. That silent-default is the F-1 disease: a mapping read a
nonexistent `min_paths` via `.get()`, defaulted, and the cpcv verdict degraded to
a constant PASS (the read-form of the hardcoded `engine_sha_verified` string).

R-048 §2: "reading a missing key in any verdict/disposition mapping RAISES
fail-loud, never defaults. One small change; the whole silent-degradation class
dies." This module IS that one change, made reusable so EVERY mapping shares it.

Distinction the guard encodes: a MISSING KEY is a schema break (raise); a PRESENT
value that is None is a legitimate signal (returned verbatim — the caller decides).
Use `require` only for keys the result contract GUARANTEES; branch discriminators
that legitimately test optional presence stay on `.get()`.
"""

from __future__ import annotations

from typing import Any, Mapping


class MappingSchemaError(RuntimeError):
    """A verdict/disposition mapping read a key ABSENT from the result schema.
    Fail-loud (R-048 §2) — a missing key must never silently default to a
    constant. A raise is meant to be caught by the runner's per-item try/except
    and recorded as a VISIBLE aborted/failed unit with the signature, never
    swallowed into a wrong verdict."""


def require(d: Mapping[str, Any], key: str, ctx: str) -> Any:
    """Strict verdict read (R-048 §2). Absence of `key` RAISES MappingSchemaError;
    a PRESENT value is returned verbatim (None is a legitimate signal — a MISSING
    KEY is a schema break). Use ONLY for keys the result contract guarantees."""
    if key not in d:
        raise MappingSchemaError(
            f"R-048 §2 strict-key guard: required verdict key {key!r} absent from "
            f"{ctx} (present keys={sorted(d)}). A verdict mapping must not read a "
            f"missing key and default to a constant — fail-loud instead."
        )
    return d[key]
