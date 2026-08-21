"""INDEPENDENT COMPILE AUTHORITY — which external dependencies a strategy is REQUIRED to declare.

AR-1387A sections 2 and 3, implemented under AR-1398 sections 7.2.6 and 7.2.7.

🛑 THE DEFECT THIS MODULE EXISTS TO CLOSE, AND WHY NOTHING ALREADY IN THE SEAM COULD CLOSE IT.

Every guard the compile seam had before this module read the receipt to decide what the receipt
had to contain. That is circular, and the independent grader walked straight through it: take the
real nine-canonical-node receipt carrying the blocked E8 4H dependency, DELETE
`external_dependencies`, `compile_readiness` and `structured_blocker`, re-stamp the receipt so its
digest is valid again, and the result is byte-for-byte indistinguishable from a legitimate legacy
receipt that never declared a dependency at all. It compiled.

    blocked E8 dependency present  -> CanonicalNodeNotAcceptedError
    delete dependency/readiness/blocker, re-stamp
    build_certified_record()       -> COMPILED 1 strategy

A digest cannot fix this, and neither can an HMAC (AR-1387A section 6 refuses that expansion
explicitly). Both answer "were these bytes edited after production?" -- and the attack does not
edit bytes after production, it produces a smaller receipt. The unanswered question is a DIFFERENT
one: *which dependency was this strategy required to declare in the first place?* That fact cannot
live in the artifact being checked, because an artifact that carries its own requirements can drop
them. It has to be supplied independently, which is what this module is.

★ THE LAW: A STRATEGY MUST NOT BE ABLE TO BECOME LESS STRICT BY LOSING A GATE.
  Silently dropping the 4H Premium/Discount dependency turns "may not trade without the higher
  timeframe state" into "may trade freely". That is the operator's "indicator optional" concern
  stated as a compiler invariant.

TWO SEPARATE CONTROLS FOR TWO SEPARATE QUESTIONS (AR-1387A section 6):

  1. the receipt's plain canonical digest  -> accidental post-production drift
  2. this authority                        -> required dependency identity + contract membership

No secret material appears here. There is no HMAC and no key, deliberately.
"""
from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass
from types import MappingProxyType
from typing import Any

COMPILE_AUTHORITY_VERSION = "compile-authority/v1"
DEPENDENCY_RECORD_SCHEMA_VERSION = "external-dependency-record/v1"

_SHA256_RE = re.compile(r"\A[0-9a-f]{64}\Z")

# The COMPLETE serialised shape of one emitted external-dependency record, v1.
#
# Versioned and exhaustive on purpose. AR-1387A section 3 attached a record carrying only
# `dependency_id` plus the six satisfying readiness words to the real receipt, and the seam
# compiled it -- because `_derived_dependency_blockers()` re-derives the six READINESS axes and
# never asks whether the thing it is reading them off is a complete dependency contract at all.
# Six true-looking words are not a dependency; they are six words.
#
# ⚠️ THESE ARE THE 16 DECLARED FIELDS OF `ExternalDependencySpec` MINUS `expected_contract_sha256`
# (a caller-supplied assertion that is never serialised), PLUS the emitted `contract_sha256`.
# `test_AR1398_*` pins this set against the dataclass itself, so a field added to the spec without
# being taught here goes RED instead of being silently accepted as an "extra".
_IDENTITY_FIELDS = (
    "dependency_id",
    "consumer_refs",
    "kind",
    "provider",
    "artifact",
    "platform",
)
_SEMANTIC_FIELDS = (
    "display_chart_timeframe",
    "decision_timeframe",
    "configuration",
    "output_contract",
)
_READINESS_FIELDS = (
    "semantic_status",
    "access_status",
    "live_delivery",
    "historical_replay",
    "update_policy",
    "implementation_status",
)
CONTRACT_HASH_FIELD = "contract_sha256"

#: Every key a complete emitted record carries -- no more, no fewer.
REQUIRED_DEPENDENCY_RECORD_FIELDS: frozenset[str] = frozenset(
    _IDENTITY_FIELDS + _SEMANTIC_FIELDS + _READINESS_FIELDS + (CONTRACT_HASH_FIELD,)
)


class CompileAuthorityError(Exception):
    """The authority itself is malformed. Distinct from a receipt that fails against it.

    Kept separate so a broken PIN can never be mistaken for a caught ATTACK -- if these shared an
    exception type, a typo in the authority file would read in the logs exactly like a laundered
    receipt being refused, and the loudest possible success would look like the loudest possible
    failure.
    """


@dataclass(frozen=True)
class RequiredDependency:
    """One dependency a strategy MUST declare, pinned to its exact contract hash."""

    dependency_id: str
    contract_sha256: str

    def __post_init__(self) -> None:
        if not isinstance(self.dependency_id, str) or not self.dependency_id.strip():
            raise CompileAuthorityError(
                f"required dependency id must be a non-blank string, got {self.dependency_id!r}"
            )
        if not isinstance(self.contract_sha256, str) or not _SHA256_RE.match(self.contract_sha256):
            raise CompileAuthorityError(
                f"required dependency {self.dependency_id!r} must pin a lowercase 64-hex sha256, "
                f"got {self.contract_sha256!r}. An unpinned or half-typed hash is not a pin, and a "
                "pin that matches nothing would refuse every receipt including the honest ones."
            )


@dataclass(frozen=True)
class CompileAuthority:
    """The immutable, versioned set of dependencies a compile is required to find in the receipt.

    Immutability is load-bearing, not decoration. AR-1387A section 5 emptied the sibling
    `GATING_AXES` map at runtime and watched a blocked dependency go
    `GREEN_PENDING_CERTIFICATION`; an authority stored as a plain module-level dict is the same
    one-line disarm wearing a different name. `entries` is a tuple, the dataclass is frozen, and
    `required` hands out a read-only view over a mapping no caller can reach.
    """

    version: str
    entries: tuple[RequiredDependency, ...]

    def __post_init__(self) -> None:
        if self.version != COMPILE_AUTHORITY_VERSION:
            raise CompileAuthorityError(
                f"unknown compile authority version {self.version!r}; this build understands "
                f"{COMPILE_AUTHORITY_VERSION!r}. Refusing rather than interpreting an authority "
                "written against a contract this code has never seen."
            )
        if not isinstance(self.entries, tuple):
            raise CompileAuthorityError(
                f"entries must be a tuple so the authority cannot be appended to after "
                f"construction, got {type(self.entries).__name__}"
            )
        seen: set[str] = set()
        for entry in self.entries:
            if not isinstance(entry, RequiredDependency):
                raise CompileAuthorityError(
                    f"every authority entry must be a RequiredDependency, got {entry!r}"
                )
            if entry.dependency_id in seen:
                raise CompileAuthorityError(
                    f"duplicate required dependency id {entry.dependency_id!r}. Two pins for one "
                    "id means one of them is silently unenforced, and nothing says which."
                )
            seen.add(entry.dependency_id)

    @property
    def required(self) -> Mapping[str, str]:
        """`{dependency_id: pinned contract sha256}`, read-only."""
        return MappingProxyType({e.dependency_id: e.contract_sha256 for e in self.entries})

    @property
    def is_empty(self) -> bool:
        return not self.entries


#: The EXPLICIT authority for a strategy that legitimately requires no external dependency.
#:
#: AR-1398 section 7.2.6: "An explicit empty authority is allowed for a legacy strategy; an
#: omitted/defaulted authority is not." That distinction is the whole point -- a default would
#: restore exactly the hole this module closes, because the attack is the ABSENCE of a declaration
#: and a default makes absence indistinguishable from a decision. So `build_certified_record` takes
#: the authority as a REQUIRED parameter: omitting it is a TypeError at the call site, which is not
#: a check that can be disarmed because it is not a check at all.
EMPTY_COMPILE_AUTHORITY = CompileAuthority(version=COMPILE_AUTHORITY_VERSION, entries=())


# ⚠️ NO `load_compile_authority(path)` HERE, DELIBERATELY.
# A JSON-file loader was written for this packet and then REMOVED before delivery, because
# `scripts/system_inventory.py` classified it `BUILT-UNREACHABLE` -- built, tested, and called by
# nothing. AR-1398 section 7.2.6 says the compile entry must "receive/load" the authority, and
# `compile_svkm_v2_1_vertical` RECEIVES it as an argument, so the file path was speculative scope
# for a strategy that does not yet exist. When a real strategy needs a committed pin file, the
# loader is twenty lines and gets written then, against a real caller and a real fixture.
# SHIPPING THE THING THE PROJECT'S OWN REACHABILITY CLASSIFIER CONVICTS IS NOT HARDENING.


def validate_dependency_record(record: Any) -> tuple[str, str]:
    """Prove `record` is a COMPLETE, well-formed v1 dependency record; return (id, contract hash).

    AR-1398 section 7.2.7. Runs BEFORE any readiness axis is read, because re-deriving readiness
    off an object that has not been proven to be a dependency record is reading six fields of
    something unknown and calling the answer a gate.

    Refuses: a non-mapping; a missing field; an EXTRA field; a blank/ non-string id; a
    `consumer_refs` that is not a non-empty list of non-blank strings, or that repeats one; and a
    `contract_sha256` that is absent, malformed, or does not equal the digest recomputed from the
    record's own remaining fields.

    ⚠️ EXTRA FIELDS ARE REFUSED, NOT IGNORED. A validator that tolerates unknown keys accepts
    "the record I know about, plus something I did not look at" -- and every field it did not look
    at is a field the hash below does cover, so tolerating it here only moves the refusal to a
    confusing place. Refuse where the extra key is visible.
    """
    from .source_graph_projection import (
        ExternalDependencySpec,
        external_dependency_contract_hash,
    )

    if not isinstance(record, dict):
        raise CompileAuthorityError(
            f"DEPENDENCY_RECORD_MALFORMED: expected a mapping, got {type(record).__name__}"
        )

    present = set(record)
    missing = REQUIRED_DEPENDENCY_RECORD_FIELDS - present
    extra = present - REQUIRED_DEPENDENCY_RECORD_FIELDS
    if missing or extra:
        raise CompileAuthorityError(
            f"DEPENDENCY_RECORD_INCOMPLETE: schema {DEPENDENCY_RECORD_SCHEMA_VERSION} requires "
            f"exactly {sorted(REQUIRED_DEPENDENCY_RECORD_FIELDS)}. missing={sorted(missing)} "
            f"extra={sorted(extra)}. A record is not a dependency contract because it carries the "
            "words that would satisfy a gate; it is one because it is complete."
        )

    dep_id = record["dependency_id"]
    if not isinstance(dep_id, str) or not dep_id.strip():
        raise CompileAuthorityError(
            f"DEPENDENCY_RECORD_MALFORMED: dependency_id must be a non-blank string, got {dep_id!r}"
        )

    consumers = record["consumer_refs"]
    if (
        not isinstance(consumers, (list, tuple))
        or not consumers
        or any(not isinstance(c, str) or not c.strip() for c in consumers)
    ):
        raise CompileAuthorityError(
            f"DEPENDENCY_RECORD_MALFORMED: {dep_id!r} consumer_refs must be a non-empty sequence "
            f"of non-blank refs, got {consumers!r}. A dependency nothing consumes is a dependency "
            "that gates nothing."
        )
    if len(set(consumers)) != len(consumers):
        raise CompileAuthorityError(
            f"DEPENDENCY_RECORD_MALFORMED: {dep_id!r} repeats a consumer ref in {consumers!r}"
        )

    declared_hash = record[CONTRACT_HASH_FIELD]
    if not isinstance(declared_hash, str) or not _SHA256_RE.match(declared_hash):
        raise CompileAuthorityError(
            f"DEPENDENCY_RECORD_MALFORMED: {dep_id!r} carries {CONTRACT_HASH_FIELD}="
            f"{declared_hash!r}, which is not a lowercase 64-hex sha256"
        )

    # RECOMPUTE, never believe. The record's own digest is a claim about the record; the only way
    # it becomes evidence is by being reproduced from the fields it claims to cover.
    fields = {k: v for k, v in record.items() if k != CONTRACT_HASH_FIELD}
    fields["consumer_refs"] = tuple(fields["consumer_refs"])
    try:
        spec = ExternalDependencySpec(**fields)
    except TypeError as exc:  # pragma: no cover - the field-set check above already covers this
        raise CompileAuthorityError(
            f"DEPENDENCY_RECORD_MALFORMED: {dep_id!r} does not fit the declared contract: {exc}"
        ) from exc
    recomputed = external_dependency_contract_hash(spec)
    if recomputed != declared_hash:
        raise CompileAuthorityError(
            f"DEPENDENCY_CONTRACT_HASH_MISMATCH: {dep_id!r} declares {declared_hash} but its own "
            f"fields hash to {recomputed}. The record was edited after its contract was sealed."
        )
    return dep_id, recomputed


def enforce_compile_authority(dependencies: Any, authority: CompileAuthority) -> None:
    """Refuse unless every dependency the AUTHORITY requires is present, complete and pin-matched.

    This is the check the receipt cannot talk its way out of, because its input is the authority
    and not the artifact. A required dependency that is simply ABSENT -- the section 2 attack --
    is caught here and nowhere else: by the time the receipt has been shrunk, every other guard is
    looking at a perfectly valid smaller receipt.

    Note the direction. This iterates the AUTHORITY and looks each id up in the receipt. Iterating
    the receipt and checking the ones it happens to carry is the same fail-open one layer up: a
    deleted record is not in the receipt, so a receipt-driven loop never visits it.
    """
    if not isinstance(authority, CompileAuthority):
        raise CompileAuthorityError(
            "COMPILE_AUTHORITY_ABSENT: build_certified_record requires an explicit "
            f"CompileAuthority, got {type(authority).__name__}. A strategy that genuinely needs no "
            "external dependency passes EMPTY_COMPILE_AUTHORITY and says so; there is no default, "
            "because a default is indistinguishable from a forgotten declaration and the attack "
            "this closes IS a forgotten declaration."
        )

    # Fail CLOSED on a wrong-typed container rather than treating it as "no dependencies". The
    # sibling `_derived_dependency_blockers()` learned this the expensive way: it opened with
    # `if not isinstance(...): return {}`, and reshaping `external_dependencies` from a list into a
    # dict keyed by dependency_id made the entire re-derivation evaporate. Coercing an unexpected
    # shape to empty here would rebuild that hole inside the very control that exists to close it,
    # and it would do so for every strategy whose authority happens to be empty.
    if dependencies and not isinstance(dependencies, (list, tuple)):
        raise CompileAuthorityError(
            "DEPENDENCY_CONTAINER_MALFORMED: external_dependencies must be a sequence of records, "
            f"got {type(dependencies).__name__}. An unreadable container is not an empty one."
        )
    records = dependencies if isinstance(dependencies, (list, tuple)) else ()
    by_id: dict[str, str] = {}
    for record in records:
        dep_id, contract_hash = validate_dependency_record(record)
        if dep_id in by_id:
            raise CompileAuthorityError(
                f"DEPENDENCY_RECORD_DUPLICATE: {dep_id!r} appears more than once; one of the two "
                "is silently unenforced and nothing says which."
            )
        by_id[dep_id] = contract_hash

    for dep_id, pinned in authority.required.items():
        actual = by_id.get(dep_id)
        if actual is None:
            raise CompileAuthorityError(
                f"REQUIRED_DEPENDENCY_ABSENT: the compile authority "
                f"({authority.version}) requires dependency {dep_id!r}, and this receipt does not "
                f"declare it. Present: {sorted(by_id) or 'none'}. Refusing to compile. A strategy "
                "may not become LESS STRICT by losing a gate -- and a receipt cannot be the "
                "evidence for which gates it was required to carry, because deleting the record "
                "and re-stamping produces a receipt with a perfectly valid digest."
            )
        if actual != pinned:
            raise CompileAuthorityError(
                f"REQUIRED_DEPENDENCY_CONTRACT_DRIFT: {dep_id!r} is pinned at {pinned} but this "
                f"receipt's record hashes to {actual}. The declared contract is not the ratified "
                "one. This includes its readiness axes by design: advancing a dependency from "
                "UNVERIFIED to VERIFIED is a change to what was ratified, and it re-pins here "
                "explicitly rather than sliding through on the receipt's own say-so."
            )
