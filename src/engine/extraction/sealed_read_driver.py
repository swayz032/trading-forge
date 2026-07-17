"""H1 sealed-12 terminal-read driver — MODULE B: extraction orchestration.

Spec: docs/designs/h1-sealed12-driver-ratify-packet-2026-07-16.md (Module B,
item 1) + docs/designs/ADVISOR-RULINGS.md R-015 §6-CONSOLIDATED item 1 / R-017.
Module A (``sealed_read_gate.gate_sealed_read``) is the FOUNDATION and is
called FIRST by :class:`SealedReadDriver`; the extraction stage is
UNREACHABLE unless that gate allowed the read (compose-order, structural).

WHAT THIS MODULE DOES (and nothing else — panels/raters/verdict are later
modules C-F, left as clean seams):

  Per verified video, produce its extraction ARTIFACT in the certified
  reader v3.2 (``efa377d6``) shape via the frozen two-phase pipeline —
  enumerator Phase-A k=5 modal consensus (stability >=4/5; an
  enumeration-UNSTABLE video routes to ONE blind adjudication to settle its
  count) + frontier Phase-B single-draw per enumerated strategy.

THE EXTRACTION SEAM (discovered, reused READ-ONLY — this module NEVER
modifies the certified reader / extractor / enumerator prompts / pilot
conveyor grade logic, all amber):

  * Phase-A k=5 modal consensus + stability is the production procedure
    implemented in ``scripts/h1-frontier-designpool.ts`` (K=5, POLICY
    "k5-modal-v1", ``unstable = mode_n < 4``). Its per-video Phase-A record
    lands in a vault ``phase_a`` block. The certified-reader (claude-rung)
    design-pool merge (``scripts/h1_claude_merge_vault_v32.py``) records the
    same axis as ``phase_a = {"unstable": bool}`` beside the Phase-B
    strategies. Both shapes are consumed here by :func:`_enum_stability`.
  * Phase-B single-draw per-strategy extraction ARTIFACTS (the "staging_v32
    shape") live at
    ``docs/replay-results/h1-scripts/claude-rung-designpool/staging_v32/
    <video_id>__s<idx>.json`` — one strategy per file, top-level
    ``{"strategies":[<one>], "instrument_classification", "rejected_strategies",
    "coaching_notes", "coverage_notes"}``. This is the shape the certified
    dress-rehearsal (``run_dress_rehearsal.py``) + the all-22 A-packet runner
    (``run_a_packet_22.py`` via ``_a_packet_harness.build_inputs``) already
    consume, so it is the authoritative Phase-B artifact this module emits.
  * Phase-A stability flag source (aligned with staging_v32): the certified
    reader's own vault ``docs/replay-results/h1-scripts/claude-rung-v32/vault/
    <video_id>.json`` -> ``phase_a`` (``{"unstable": bool}``; the frontier
    candidate vault additionally carries the raw ``counts``/``mode``/``mode_n``).

TWO EXECUTION MODES:

  * ``mode in {"rehearsal","staging"}`` — the full-dress path the build +
    tests exercise. Loads the ALREADY-SPENT cached staging/vault artifacts
    from disk for each video. NO live LLM/network call is ever made.
  * ``mode == "sealed"`` — seal-day only, operator-gated, REAL spend. Calls
    the injected ``live_extract_fn`` per video (dependency injection, so no
    test needs a real key) and persists its returned artifact byte-exact.
    This path is STRUCTURED here but NEVER invoked by the tests.

BYTE-EXACT PERSISTENCE + ARTIFACTS-ON-DISK GATE: every artifact is written
to disk programmatically (atomic tmp-file + ``os.replace``, no hand-copy),
deterministically (same cached inputs -> byte-identical artifact; no
wall-clock in the artifact body). :func:`run_extraction_stage` returns
``ready=True`` ONLY after :func:`require_artifacts_on_disk` confirms every
expected artifact is on disk, so no downstream module can ever grade an
in-memory-only extraction.

Pure-stdlib. Imports Module A read-only. No LLM/network in the
rehearsal/staging path; the sole live seam is the injected
``live_extract_fn`` (never called in tests).
"""

from __future__ import annotations

import glob
import hashlib
import json
import os
import re
from collections import Counter
from collections.abc import Callable

from .sealed_read_gate import DEFAULT_TOKEN_PATH, gate_sealed_read

_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
_H1_SCRIPTS = os.path.join(_ROOT, "docs", "replay-results", "h1-scripts")

#: Default design-pool cache root (contains both the staging + vault subtrees).
DEFAULT_CACHE_ROOT = _H1_SCRIPTS
#: Certified-reader Phase-B per-strategy extraction artifacts (staging_v32 shape).
DEFAULT_STAGING_DIR = os.path.join(_H1_SCRIPTS, "claude-rung-designpool", "staging_v32")
#: Certified-reader Phase-A stability vault (aligned with staging_v32).
DEFAULT_PHASE_A_VAULT_DIR = os.path.join(_H1_SCRIPTS, "claude-rung-v32", "vault")

#: The production Phase-A consensus policy label (h1-frontier-designpool.ts).
POLICY = "k5-modal-v1"
#: k for the k=5 modal consensus.
K_DEFAULT = 5
#: Modal agreement floor: >=4/5 draws agreeing on the count == stable.
STABILITY_MIN = 4

_REHEARSAL_MODES = frozenset({"rehearsal", "staging"})

# --------------------------------------------------------------------------- #
# READER-IDENTITY GUARD (ADVISOR-RULINGS R-018.1a/b; ratify-packet Module B
# clarifying note R-018.1c). Structurally prevents seal day from reading the
# twelve with the WRONG (uncertified) extractor — the certified reader is the
# CLAUDE rung (the frontier-v3.2 PROMPT run on the certified frozen model id +
# enumerator-v1.2 + pinned params + k=5), the producer of staging_v32. The
# uncertified frontier candidate vault (a different brain) must never be the
# seal-day reader.
#
# R-018 LAW (non-negotiable): the pinned identity is READ AT RUNTIME from the
# frozen record — pointed-at, NEVER copied into code. No model-id string, no
# prompt SHA, no param value is hardcoded below; the model_id + k are parsed
# from the frozen Claude-rung pre-registration, the pinned-params designator
# from the ratify-packet Module B clarifying note, and prompt_sha /
# enumerator_sha are sha256 of the on-disk prompt files (computed here).
# --------------------------------------------------------------------------- #

#: Frozen Claude-rung pre-registration (carries the frozen model id + k).
CLAUDE_RUNG_PREREG = os.path.join(
    _ROOT, "docs", "designs", "h1-claude-rung-preregistration-2026-07-13.md"
)
#: Ratify-packet whose Module B clarifying note pins the params designator.
SEALED12_RATIFY_PACKET = os.path.join(
    _ROOT, "docs", "designs", "h1-sealed12-driver-ratify-packet-2026-07-16.md"
)
#: frontier-v3.2 PROMPT file — its sha256 IS the prompt identity.
FRONTIER_PROMPT_PATH = os.path.join(
    _ROOT, "src", "agents", "transcript-extractor-frontier-v32.md"
)
#: enumerator-v1.2 PROMPT file — its sha256 IS the enumerator identity.
ENUMERATOR_PROMPT_PATH = os.path.join(_ROOT, "src", "agents", "strategy-enumerator.md")
#: Certified-reader tag/lineage pointer (provenance source_ref only — NOT an
#: asserted identity value; the asserted SHAs are computed from the files).
CERTIFIED_READER_TAG = "efa377d6"

#: The fields compared by :func:`assert_reader_identity` (source_refs excluded —
#: it is provenance metadata, not part of the asserted identity).
_IDENTITY_FIELDS = ("model_id", "params", "k", "prompt_sha", "enumerator_sha")


class ArtifactsMissingError(RuntimeError):
    """Raised by :func:`require_artifacts_on_disk` when an expected extraction
    artifact is not present on disk (so no grading can run on an
    in-memory-only extraction)."""

    def __init__(self, missing: list[str]):
        self.missing = missing
        super().__init__(f"extraction artifacts missing on disk: {missing}")


class ExtractionSourceMissing(RuntimeError):
    """Raised when a rehearsal/staging video has no cached Phase-B staging
    artifact on disk. Fail-closed: the rehearsal never fabricates a strategy
    for a video whose spent extraction cannot be located."""


class ReaderIdentityMismatch(RuntimeError):
    """Raised (fail-closed HALT) when a claimed reader identity does not match
    the certified/pinned identity — e.g. a seal-day ``live_extract_fn`` that
    self-reports a different model (the uncertified frontier brain) than the
    certified CLAUDE rung, or
    a live payload that fails to self-report a reader identity at all. Also
    raised when the pinned identity cannot RESOLVE (a frozen prompt/pre-reg
    file is missing), so a missing instrument fails closed rather than silently
    passing."""


# --------------------------------------------------------------------------- #
# Reader-identity resolution (READ AT RUNTIME from frozen files — R-018 law).
# --------------------------------------------------------------------------- #


def _sha256_file(path: str) -> str:
    """sha256 hex of a file's bytes. Raises :class:`ReaderIdentityMismatch`
    (fail-closed) if the file is absent — a missing frozen prompt file must
    HALT, never silently resolve to a default identity."""
    if not os.path.exists(path):
        raise ReaderIdentityMismatch(
            f"frozen identity file missing (fail-closed): {path!r}"
        )
    with open(path, "rb") as fh:
        return hashlib.sha256(fh.read()).hexdigest()


def _read_frozen_text(path: str) -> str:
    """Read a frozen record's text, or fail closed if it is absent."""
    if not os.path.exists(path):
        raise ReaderIdentityMismatch(
            f"frozen identity record missing (fail-closed): {path!r}"
        )
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def _read_frozen_model_id(prereg_path: str) -> str:
    """Parse the frozen model id from the Claude-rung pre-registration's
    ``Model ID frozen: `<id>` `` line. Pointed-at, never hardcoded — the value
    lives ONLY in the frozen doc."""
    text = _read_frozen_text(prereg_path)
    m = re.search(r"Model ID frozen[:*\s]*`([^`]+)`", text)
    if not m:
        raise ReaderIdentityMismatch(
            f"frozen model id not found in pre-reg {prereg_path!r} "
            "(expected a `Model ID frozen: <id>` line)"
        )
    return m.group(1).strip()


def _read_frozen_k(prereg_path: str) -> int:
    """Parse the frozen k (``k=<n>`` modal consensus) from the Claude-rung
    pre-registration. Pointed-at, never hardcoded."""
    text = _read_frozen_text(prereg_path)
    m = re.search(r"\bk=(\d+)\b", text)
    if not m:
        raise ReaderIdentityMismatch(
            f"frozen k not found in pre-reg {prereg_path!r} (expected `k=<n>`)"
        )
    return int(m.group(1))


def _read_frozen_params(params_source_path: str) -> dict:
    """Read the frozen PARAMS designator for the Claude rung.

    DISCOVERY NOTE (reported with the build): no frozen artifact ENUMERATES the
    Claude rung's param VALUES — the pre-reg / R-018 / standing state / ratify
    packet consistently pin them by the frozen designator phrase "pinned
    params" (the frontier configpass pre-reg's enumerated values —
    ``reasoning_effort=low`` / a fixed sampling temperature — are a DIFFERENT
    brain and are deliberately NOT used here). So the params identity is the frozen
    designator parsed from the record, with ``enumerated_values=None`` recorded
    honestly. This is read at runtime, never invented."""
    text = _read_frozen_text(params_source_path)
    m = re.search(r"pinned params", text, re.IGNORECASE)
    if not m:
        raise ReaderIdentityMismatch(
            f"frozen params designator not found in {params_source_path!r} "
            "(expected the 'pinned params' pin)"
        )
    return {"designator": m.group(0), "enumerated_values": None}


def certified_reader_identity(
    prereg_path: str = CLAUDE_RUNG_PREREG,
    params_source_path: str = SEALED12_RATIFY_PACKET,
    frontier_prompt_path: str = FRONTIER_PROMPT_PATH,
    enumerator_prompt_path: str = ENUMERATOR_PROMPT_PATH,
) -> dict:
    """Compute the PINNED certified-reader identity AT RUNTIME by reading the
    frozen files (R-018 law: pointed-at, never copied into code).

    Returns ``{model_id, params, k, prompt_sha, enumerator_sha, source_refs}``:
      * ``model_id`` / ``k`` — parsed from the frozen Claude-rung pre-reg.
      * ``params`` — the frozen "pinned params" designator (values not
        enumerated in any frozen artifact; see :func:`_read_frozen_params`).
      * ``prompt_sha`` / ``enumerator_sha`` — sha256 of the ON-DISK frontier-v3.2
        and enumerator-v1.2 prompt files (their bytes ARE the prompt identity).
      * ``source_refs`` — the frozen files/tag this identity was read from
        (provenance; NOT part of the asserted identity).

    Deterministic. Fail-closed: a missing frozen file raises
    :class:`ReaderIdentityMismatch` (so a missing prompt file HALTs rather than
    silently resolving)."""
    model_id = _read_frozen_model_id(prereg_path)
    k = _read_frozen_k(prereg_path)
    params = _read_frozen_params(params_source_path)
    prompt_sha = _sha256_file(frontier_prompt_path)
    enumerator_sha = _sha256_file(enumerator_prompt_path)
    return {
        "model_id": model_id,
        "params": params,
        "k": k,
        "prompt_sha": prompt_sha,
        "enumerator_sha": enumerator_sha,
        "source_refs": {
            "model_id_and_k": os.path.relpath(prereg_path, _ROOT).replace("\\", "/"),
            "params_designator": os.path.relpath(params_source_path, _ROOT).replace(
                "\\", "/"
            ),
            "prompt_sha": os.path.relpath(frontier_prompt_path, _ROOT).replace(
                "\\", "/"
            ),
            "enumerator_sha": os.path.relpath(enumerator_prompt_path, _ROOT).replace(
                "\\", "/"
            ),
            "certified_reader_tag": CERTIFIED_READER_TAG,
        },
    }


def assert_reader_identity(claimed: dict, pinned: dict) -> None:
    """Fail-closed identity assertion. Raises :class:`ReaderIdentityMismatch`
    on ANY mismatch across ``_IDENTITY_FIELDS`` (model_id, params, k,
    prompt_sha, enumerator_sha); ``source_refs`` is provenance and is NOT
    compared. A ``claimed`` that is not a dict is itself a mismatch (a live
    payload that failed to self-report an identity)."""
    if not isinstance(claimed, dict):
        raise ReaderIdentityMismatch(
            f"claimed reader identity is not a dict (self-report absent): {claimed!r}"
        )
    mismatches = [
        (f, claimed.get(f), pinned.get(f))
        for f in _IDENTITY_FIELDS
        if claimed.get(f) != pinned.get(f)
    ]
    if mismatches:
        fields = [m[0] for m in mismatches]
        raise ReaderIdentityMismatch(
            f"reader identity mismatch on {fields} — HALT, no artifact accepted; "
            f"details (field, claimed, pinned): {mismatches}"
        )


def _claimed_reader_identity(raw) -> dict:
    """Extract the reader identity a sealed ``live_extract_fn`` SELF-REPORTED on
    its returned payload. The seal-day live artifact MUST carry a
    ``reader_identity`` block; a payload that does not is fail-closed
    (:class:`ReaderIdentityMismatch`) — a live reader that will not name itself
    cannot read the twelve."""
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except ValueError:
            raw = None
    if not isinstance(raw, dict):
        raise ReaderIdentityMismatch(
            "sealed live_extract_fn payload is not a JSON object; it cannot "
            "self-report a reader_identity (fail-closed HALT)"
        )
    claimed = raw.get("reader_identity")
    if not isinstance(claimed, dict):
        raise ReaderIdentityMismatch(
            "sealed live_extract_fn did not self-report a `reader_identity` "
            "block (fail-closed HALT — the seam requires the live reader to "
            "name its own model/prompt/enumerator/params/k)"
        )
    return claimed


# --------------------------------------------------------------------------- #
# Phase-A k=5 modal-consensus + stability (read-only reuse of the production
# procedure; NOT a live enumeration — the counts are read from the cached
# vault, or, for the sealed live path, from what live_extract_fn returned).
# --------------------------------------------------------------------------- #


def _mode_of(counts: list[int]) -> tuple[int | None, int]:
    """Return ``(mode, mode_n)`` for a list of per-draw strategy counts.

    ``mode`` is the most-frequent count value; ``mode_n`` is how many draws
    hit it (out of ``len(counts)``). Deterministic tie-break: on equal
    frequency the SMALLEST count value wins (never wall-clock / iteration
    order), so a replay always yields the same modal count. Empty -> (None, 0).
    """
    if not counts:
        return None, 0
    freq = Counter(counts)
    best_n = max(freq.values())
    mode = min(v for v, n in freq.items() if n == best_n)
    return mode, best_n


def _enum_stability(
    phase_a: dict | None,
    k: int = K_DEFAULT,
    stability_min: int = STABILITY_MIN,
) -> dict:
    """Derive the enumeration-stability record from a Phase-A vault block.

    Handles BOTH cached shapes discovered in the design pool:
      * frontier candidate vault: ``{"counts":[...], "mode":M, "mode_n":N,
        "unstable":bool, ...}`` -> stable iff ``mode_n >= stability_min``.
      * certified-reader (claude-rung) merge vault: ``{"unstable": bool}``
        (no raw counts) -> stable iff ``not unstable``.

    Fail-closed: a missing/empty Phase-A block (``None``) is treated as
    NOT stable (``available=False``) so the caller routes it to adjudication
    rather than silently assuming a settled count.

    Returns ``{available, counts, mode, mode_n, k, stability_min, stable,
    source}``.
    """
    out = {
        "available": False,
        "counts": None,
        "mode": None,
        "mode_n": None,
        "k": k,
        "stability_min": stability_min,
        "stable": False,
        "source": None,
    }
    if not isinstance(phase_a, dict) or not phase_a:
        return out

    counts = phase_a.get("counts")
    if isinstance(counts, list) and counts:
        # Prefer the vault's own recorded mode/mode_n; recompute only if absent
        # (never trust a caller ordering — _mode_of re-derives from counts).
        mode = phase_a.get("mode")
        mode_n = phase_a.get("mode_n")
        if not isinstance(mode_n, int):
            mode, mode_n = _mode_of([c for c in counts if isinstance(c, int)])
        out.update(
            available=True,
            counts=list(counts),
            mode=mode,
            mode_n=mode_n,
            k=len(counts),
            stable=bool(isinstance(mode_n, int) and mode_n >= stability_min),
            source="counts",
        )
        return out

    if "unstable" in phase_a:
        out.update(
            available=True,
            stable=not bool(phase_a["unstable"]),
            source="unstable_flag",
        )
        return out

    return out


def _default_adjudicate(video_id: str, enum_stability: dict) -> dict:
    """DEFAULT enumeration-adjudication hook (item 1: unstable -> ONE blind
    adjudication to settle the count). This STUB records the routing ONLY —
    the real blind adjudication is a live LLM call and is seal-day / live
    work, never run in rehearsal or tests. A production caller injects a real
    ``adjudicate_fn``; this stub keeps the seam wired + observable without a
    network call. Deterministic, no I/O."""
    return {
        "video_id": video_id,
        "adjudication_needed": True,
        "resolved_count": None,
        "enum_stability": enum_stability,
        "note": (
            "enumeration UNSTABLE (<{}/{} modal agreement) -> routed to ONE "
            "blind adjudication to settle the count; live adjudication is "
            "seal-day/live only (stub records the routing, no LLM call)".format(
                enum_stability.get("stability_min", STABILITY_MIN),
                enum_stability.get("k", K_DEFAULT),
            )
        ),
    }


# --------------------------------------------------------------------------- #
# Artifacts-on-disk gate + byte-exact persistence
# --------------------------------------------------------------------------- #


def require_artifacts_on_disk(paths: list[str]) -> bool:
    """Guard: raise :class:`ArtifactsMissingError` if any expected extraction
    artifact is not on disk. Returns True when every path exists. This is the
    structural proof that no grading runs on an in-memory-only extraction —
    :func:`run_extraction_stage` calls it before returning ``ready=True``, and
    a downstream (module C+) caller re-checks it before any panel/grade."""
    missing = [p for p in paths if not (isinstance(p, str) and os.path.exists(p))]
    if missing:
        raise ArtifactsMissingError(missing)
    return True


def _atomic_write(path: str, artifact) -> None:
    """Byte-exact, crash-safe persistence (tmp-file + ``os.replace``, atomic on
    POSIX/Windows within one filesystem — no partial/cherry-pickable file).
    A ``str`` artifact is written VERBATIM (the sealed live path may hand back
    an already-serialized reader payload); a ``dict`` is serialized
    deterministically (``sort_keys`` + no wall-clock) so identical inputs
    yield a byte-identical file on replay."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if isinstance(artifact, str):
        data = artifact
    else:
        data = json.dumps(artifact, ensure_ascii=False, sort_keys=True, indent=2)
    tmp = f"{path}.{os.getpid()}.tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write(data)
    os.replace(tmp, path)


# --------------------------------------------------------------------------- #
# Cached-source loaders (rehearsal/staging path) — read-only
# --------------------------------------------------------------------------- #


def _load_phase_a(phase_a_vault_dir: str, video_id: str) -> dict | None:
    """Load the Phase-A vault block for ``video_id`` (``{"unstable":...}`` or
    the counts-bearing frontier shape), or ``None`` if no vault file exists."""
    path = os.path.join(phase_a_vault_dir, f"{video_id}.json")
    if not os.path.exists(path):
        return None
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh).get("phase_a")
    except (OSError, ValueError):
        return None


def _load_staging_strategies(
    staging_dir: str, video_id: str
) -> list[tuple[str, str, dict]]:
    """Load every cached Phase-B staging_v32 artifact for ``video_id``, sorted
    by cid (``<video_id>__s<idx>``) so the order is deterministic. Returns a
    list of ``(cid, source_path, staging_file_dict)``. Fail-closed: raises
    :class:`ExtractionSourceMissing` if no staging artifact exists for the
    video (never fabricates one)."""
    pattern = os.path.join(staging_dir, f"{video_id}__s*.json")
    files = sorted(glob.glob(pattern))
    if not files:
        raise ExtractionSourceMissing(
            f"no cached Phase-B staging artifact for video_id={video_id!r} "
            f"under {staging_dir} (pattern {os.path.basename(pattern)})"
        )
    out: list[tuple[str, str, dict]] = []
    for f in files:
        cid = os.path.basename(f)[:-5]
        with open(f, encoding="utf-8") as fh:
            out.append((cid, os.path.abspath(f), json.load(fh)))
    return out


def _build_rehearsal_artifact(
    video_id: str,
    mode: str,
    staging_dir: str,
    phase_a_vault_dir: str,
    adjudicate_fn: Callable[[str, dict], dict],
    k: int,
    stability_min: int,
) -> dict:
    """Compose one per-video extraction artifact from the cached certified
    reader outputs: Phase-A stability (vault) + Phase-B per-strategy
    extractions (staging_v32). The emitted ``strategies`` list carries the
    staging_v32 strategy objects unchanged (content-exact), so the artifact
    matches the shape the certified dress-rehearsal / A-packet harness
    already consume."""
    phase_a = _load_phase_a(phase_a_vault_dir, video_id)
    staging = _load_staging_strategies(staging_dir, video_id)

    enum = _enum_stability(phase_a, k=k, stability_min=stability_min)
    adjudication_needed = not enum["stable"]
    adjudication = adjudicate_fn(video_id, enum) if adjudication_needed else None

    strategies: list[dict] = []
    per_strategy: list[dict] = []
    for cid, src_path, fdict in staging:
        strat_list = fdict.get("strategies") or []
        strat = strat_list[0] if strat_list else None
        if strat is not None:
            strategies.append(strat)
        per_strategy.append(
            {
                "cid": cid,
                "source_path": src_path,
                "phase": "B-single-draw",
                "extraction": fdict,
            }
        )

    instrument = staging[0][2].get("instrument_classification") if staging else None
    return {
        "artifact": "h1-sealed-read-extraction",
        "module": "B-extraction-orchestration",
        "video_id": video_id,
        "mode": mode,
        "policy": POLICY,
        "reader": "certified-reader-v3.2",
        "enum_stability": enum,
        "adjudication_needed": adjudication_needed,
        "adjudication": adjudication,
        "n_strategies": len(strategies),
        "strategies": strategies,
        "instrument_classification": instrument,
        "per_strategy_artifacts": per_strategy,
        "source": {
            "phase_a_vault": os.path.abspath(
                os.path.join(phase_a_vault_dir, f"{video_id}.json")
            )
            if phase_a is not None
            else None,
            "staging_files": [p for _cid, p, _d in staging],
        },
    }


def _wrap_live_artifact(
    video_id: str,
    raw,
    mode: str,
    adjudicate_fn: Callable[[str, dict], dict],
    k: int,
    stability_min: int,
) -> tuple[dict, object]:
    """Sealed live path (STRUCTURED, not invoked in tests): take whatever the
    injected reader returned for ``video_id`` and derive the stage's
    in-memory routing record from it, while persisting the reader's payload
    BYTE-EXACT. Returns ``(record, persist_payload)`` where ``persist_payload``
    is what is written to disk verbatim (the raw reader payload) and
    ``record`` is the stage's per-video summary.

    The reader payload may be a ``dict`` (carrying ``strategies`` and,
    optionally, a ``phase_a`` block for stability) or a pre-serialized
    ``str``. Byte-exactness is preserved either way (see :func:`_atomic_write`)."""
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
        except ValueError:
            parsed = {}
    elif isinstance(raw, dict):
        parsed = raw
    else:
        parsed = {}

    phase_a = parsed.get("phase_a") if isinstance(parsed, dict) else None
    enum = _enum_stability(phase_a, k=k, stability_min=stability_min)
    adjudication_needed = not enum["stable"]
    adjudication = adjudicate_fn(video_id, enum) if adjudication_needed else None
    strategies = parsed.get("strategies") if isinstance(parsed, dict) else None
    record = {
        "artifact": "h1-sealed-read-extraction",
        "module": "B-extraction-orchestration",
        "video_id": video_id,
        "mode": mode,
        "policy": POLICY,
        "reader": "certified-reader-v3.2-LIVE",
        "enum_stability": enum,
        "adjudication_needed": adjudication_needed,
        "adjudication": adjudication,
        "n_strategies": len(strategies) if isinstance(strategies, list) else None,
        "persisted": "byte-exact-live-reader-payload",
    }
    return record, raw


# --------------------------------------------------------------------------- #
# The extraction stage
# --------------------------------------------------------------------------- #


def _video_ids_from_verified(manifest_verified: dict) -> list[str]:
    """Extract the sorted video_id list from Module A's output. Accepts the
    ``verify_sealed_manifest`` record (top-level ``video_ids``) OR the composed
    ``gate_sealed_read`` result (``record.verify.video_ids``) OR a plain
    ``{"video_ids":[...]}``."""
    if isinstance(manifest_verified, dict):
        if isinstance(manifest_verified.get("video_ids"), list):
            return list(manifest_verified["video_ids"])
        rec = manifest_verified.get("record")
        if isinstance(rec, dict):
            verify = rec.get("verify")
            if isinstance(verify, dict) and isinstance(verify.get("video_ids"), list):
                return list(verify["video_ids"])
    raise ValueError(
        "manifest_verified carries no video_ids (expected Module A's verify "
        "record or gate result)"
    )


def run_extraction_stage(
    manifest_verified: dict,
    mode: str,
    cache_dir: str = DEFAULT_CACHE_ROOT,
    live_extract_fn: Callable[[str, dict], object] | None = None,
    out_dir: str | None = None,
    staging_dir: str | None = None,
    phase_a_vault_dir: str | None = None,
    adjudicate_fn: Callable[[str, dict], dict] | None = None,
    k: int = K_DEFAULT,
    stability_min: int = STABILITY_MIN,
) -> dict:
    """Item-1 extraction stage. Produce, persist, and disk-gate one extraction
    artifact per verified video, via the certified reader v3.2 pipeline.

    ``manifest_verified``: Module A's verified-manifest record (carries the
    ``video_ids``).

    ``mode``:
      * ``"rehearsal"``/``"staging"`` — load the ALREADY-SPENT cached staging /
        vault artifacts from disk. NO live call.
      * ``"sealed"`` — call ``live_extract_fn(video_id, manifest_verified)`` per
        video (real spend; seal-day only) and persist its payload byte-exact.

    Every artifact is written to ``out_dir`` (default
    ``<cache_dir>/sealed-read-artifacts``) and :func:`require_artifacts_on_disk`
    confirms all are present BEFORE this returns ``ready=True``. Deterministic:
    identical cached inputs -> byte-identical artifacts.

    Returns ``{ready, mode, out_dir, video_ids, artifact_paths, artifacts,
    per_video, adjudications_needed, policy}``.
    """
    video_ids = _video_ids_from_verified(manifest_verified)
    if not video_ids:
        raise ValueError("no video_ids to extract")
    staging_dir = staging_dir or DEFAULT_STAGING_DIR
    phase_a_vault_dir = phase_a_vault_dir or DEFAULT_PHASE_A_VAULT_DIR
    adjudicate_fn = adjudicate_fn or _default_adjudicate
    out_dir = out_dir or os.path.join(cache_dir, "sealed-read-artifacts")

    if mode == "sealed" and live_extract_fn is None:
        raise ValueError("sealed mode requires an injected live_extract_fn")
    if mode not in _REHEARSAL_MODES and mode != "sealed":
        raise ValueError(f"unknown extraction mode: {mode!r}")

    # READER-IDENTITY GUARD (R-018.1a/b): resolve the pinned certified-reader
    # identity AT RUNTIME from the frozen files. This also enforces fail-closed
    # resolution for BOTH modes — if a frozen prompt/pre-reg file is missing,
    # certified_reader_identity() raises ReaderIdentityMismatch and the whole
    # stage HALTs before any artifact is produced (a missing instrument never
    # silently passes).
    pinned_identity = certified_reader_identity()

    os.makedirs(out_dir, exist_ok=True)
    artifacts: list[dict] = []
    artifact_paths: list[str] = []
    per_video: list[dict] = []

    for video_id in video_ids:
        path = os.path.join(out_dir, f"{video_id}.extraction.json")
        if mode in _REHEARSAL_MODES:
            artifact = _build_rehearsal_artifact(
                video_id, mode, staging_dir, phase_a_vault_dir, adjudicate_fn, k, stability_min
            )
            # STAMP the certified identity on the loaded staging_v32 artifact
            # (rehearsal reads the certified reader's own spent outputs, so the
            # pinned identity is authoritative for them).
            artifact["reader_identity"] = pinned_identity
            _atomic_write(path, artifact)
            record = artifact
        else:  # sealed
            raw = live_extract_fn(video_id, manifest_verified)  # REAL spend seam
            # ASSERT the live reader self-reported the CERTIFIED identity BEFORE
            # persisting anything. A wrong-model (uncertified-brain) self-report =>
            # ReaderIdentityMismatch => HALT, no artifact written for this video.
            claimed_identity = _claimed_reader_identity(raw)
            assert_reader_identity(claimed_identity, pinned_identity)
            record, persist_payload = _wrap_live_artifact(
                video_id, raw, mode, adjudicate_fn, k, stability_min
            )
            # The persisted payload is byte-exact (it already carries the live
            # reader's self-reported, now-asserted reader_identity); stamp the
            # stage summary record with the pinned identity too.
            record["reader_identity"] = pinned_identity
            _atomic_write(path, persist_payload)  # byte-exact reader payload
            artifact = record

        artifacts.append(artifact)
        artifact_paths.append(path)
        per_video.append(
            {
                "video_id": video_id,
                "artifact_path": path,
                "n_strategies": record.get("n_strategies"),
                "enum_stability": record.get("enum_stability"),
                "adjudication_needed": record.get("adjudication_needed"),
            }
        )

    # ARTIFACTS-ON-DISK GATE — refuse to return "ready" unless every artifact
    # is on disk (no grading on an in-memory-only extraction).
    require_artifacts_on_disk(artifact_paths)

    return {
        "ready": True,
        "mode": mode,
        "out_dir": out_dir,
        "video_ids": video_ids,
        "artifact_paths": artifact_paths,
        "artifacts": artifacts,
        "per_video": per_video,
        "adjudications_needed": [
            r["video_id"] for r in per_video if r["adjudication_needed"]
        ],
        "policy": POLICY,
        "reader_identity": pinned_identity,
    }


# =========================================================================== #
# MODULE C — MECHANICAL FLOOR + PANELS + CERTIFICATE (ratify-packet items 2-4).
#
# Spec: docs/designs/h1-sealed12-driver-ratify-packet-2026-07-16.md (Module C) +
# ADVISOR-RULINGS R-015 items 2-4 / R-019.4.  Consumes Module B's on-disk
# extraction artifacts and, per strategy, (1) applies the MECHANICAL FLOOR
# (band-8 locator anchor authority + F-2 content floor), (2) obtains the THREE
# gpt-5.4 cross-vendor panel verdicts, (3) assembles the certificate through the
# FROZEN fence ``pilot_conveyor.finalize_certificate`` -> ``terminal_read_grade``
# with BOTH semantic structural axes threaded.  This is the SAME committed,
# graded path ``run_dress_rehearsal.py`` proves — promoted to a proper driver
# stage that reads Module B's artifacts.
#
# FROZEN INSTRUMENTS REUSED READ-ONLY (never modified here — all amber):
#   * ``pilot_conveyor.finalize_certificate`` (pilot_conveyor.py:1374) ->
#     ``cert_assembler.assemble_certificate`` (cert_assembler.py:299) ->
#     ``cert_assembler.terminal_read_grade`` (cert_assembler.py:186) — the fence.
#   * MECHANICAL FLOOR: the BAND-8 LOCATOR anchor authority
#     (``anchor_locator.locate_anchor``, anchor_locator.py:259, whose own
#     ``_resolves_as_anchor`` reuses the REAL F-2 gate) + the F-2 CONTENT FLOOR
#     (``compile_lints.f2_coverage_gate``, compile_lints.py:333, run inside
#     ``assemble_certificate`` via ``run_all_lints`` and surfaced on
#     ``terminal_read_disposition["f2_coverage_gate"]``).  The caller-side
#     mechanical-floor seam is ``_a_packet_harness.build_inputs`` — the SAME
#     synthesis ``run_dress_rehearsal.py`` + ``run_a_packet_22.py`` use, so every
#     synthesized ``char_span`` resolves to its ``quote_anchor`` verbatim and
#     ``f2_coverage_gate`` PASSes by construction (single source of truth, no
#     drift).
#
# THE THREE PANELS (gpt-5.4 cross-vendor; loaded from disk in rehearsal/staging,
# obtained via the injected ``live_panel_fn`` on seal day):
#   * completeness grader-v3  — ``flex_grades_v32/<cid>.json`` -> ``grade.
#     content_clean`` (silent-omission / inventory-overreach content panel).
#     RECORDED as carried-forward evidence; it is NOT a ``terminal_read_grade``
#     axis (the frozen fence has no completeness axis — threading one would be
#     verdict-math, Module E, or a frozen-instrument edit, out of scope). Matches
#     ``run_dress_rehearsal.py`` exactly (it threads only the two structural axes).
#   * conflation axis (STRUCTURAL) — ``conflation_grades/<cid>.json`` ->
#     ``verdict.verdict`` ("PASS"|"REJECT"); absent/errored -> None (fail-closed
#     -> INDETERMINATE via ``terminal_read_grade``).
#   * enumeration-consistency axis (STRUCTURAL) — ``enum_semantic_grades/<cid>.
#     json`` -> ``verdict.enumeration_consistent`` (True->"PASS"/False->"FAIL");
#     ANY absence/parse failure fails CLOSED to "NOT_EVALUATED" (-> INDETERMINATE),
#     NEVER bare None (which would silently CLEAN). This is the EXACT fail-closed
#     contract of ``run_dress_rehearsal._load_enum_verdict``.
#
# PER-AXIS FAIL-CLOSED GATING (both modes): the two STRUCTURAL verdicts gate
# independently — either one REJECT/FAIL alone => not-clean; either one absent =>
# INDETERMINATE (never silent CLEAN). A merged sealed panel call is permitted, but
# each axis is coerced + gated SEPARATELY here.  NOT_EVALUATED / INDETERMINATE are
# never clean (the frozen ``terminal_read_grade`` fail-closed law).
#
# SEAMS LEFT CLEAN for D/E/F: NO raters (D), NO cert->video rollup / >=60% bar /
# verdict math (E), NO re-verify/drift guard (F).  This stage returns the raw
# per-strategy certificates + dispositions ONLY.
# --------------------------------------------------------------------------- #

#: Default panel-verdict cache root (the certified claude-rung-v32 grade tree —
#: the SAME paths ``run_dress_rehearsal.py`` reads).
DEFAULT_PANEL_CACHE_DIR = os.path.join(_H1_SCRIPTS, "claude-rung-v32")
_CONFLATION_SUBDIR = "conflation_grades"
_ENUM_SUBDIR = "enum_semantic_grades"
_COMPLETENESS_SUBDIR = "flex_grades_v32"


class ExtractionNotReady(RuntimeError):
    """Raised (fail-closed, compose-order) when the panels+certificate stage is
    handed an extraction result that is not READY / carries no on-disk artifacts.
    Structurally proves Module C is UNREACHABLE unless Module B produced its
    artifacts on disk (ratify-packet §4 / test (d))."""


# --------------------------------------------------------------------------- #
# Panel-verdict loaders (rehearsal/staging path) — reproduce the EXACT loading
# logic + fail-closed contract of run_dress_rehearsal.py (READ-ONLY; the grade
# files are the certified panels, never written here).
# --------------------------------------------------------------------------- #


def _load_conflation_verdict(conflation_dir: str, cid: str) -> str | None:
    """Read ``verdict.verdict`` ("PASS"|"REJECT") from the persisted conflation
    grade; None if the grade file is absent OR unreadable/malformed (fail-closed
    -> NOT_EVALUATED -> INDETERMINATE at ``terminal_read_grade``). Mirrors
    ``run_dress_rehearsal._load_verdict`` (extended to also fail-closed on a
    corrupt/short grade file rather than raising)."""
    path = os.path.join(conflation_dir, f"{cid}.json")
    if not os.path.exists(path):
        return None
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)["verdict"]["verdict"]
    except (OSError, ValueError, KeyError, TypeError):
        return None


def _load_enum_verdict(enum_dir: str, cid: str) -> str:
    """Read ``verdict.enumeration_consistent`` from the persisted SEMANTIC enum
    grade and map True->"PASS" / False->"FAIL".

    CONTRACT (verbatim from ``run_dress_rehearsal._load_enum_verdict``): this is
    an IN-SCOPE lookup — the caller has DECIDED to evaluate this cid on the enum
    axis — so it NEVER returns bare None. ANY failure to produce a real verdict
    (file missing, JSON parse error, or the verdict/enumeration_consistent key
    absent) fails CLOSED to "NOT_EVALUATED" (-> INDETERMINATE), never to bare
    None (which would feed AXIS_ABSENT and silently CLEAN)."""
    path = os.path.join(enum_dir, f"{cid}.json")
    if not os.path.exists(path):
        return "NOT_EVALUATED"
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, ValueError):
        return "NOT_EVALUATED"
    try:
        consistent = data["verdict"]["enumeration_consistent"]
    except (KeyError, TypeError):
        return "NOT_EVALUATED"
    return "PASS" if consistent else "FAIL"


def _load_completeness_verdict(completeness_dir: str, cid: str) -> dict:
    """Read ``grade.content_clean`` (bool) from the persisted completeness
    grader-v3 (flex) grade. Returns ``{content_clean, evaluated, source}``.
    Fail-closed: an absent/malformed grade records ``evaluated=False``,
    ``content_clean=None`` (an unevaluated completeness panel never masquerades
    as clean). RECORDED evidence only — not a ``terminal_read_grade`` axis."""
    path = os.path.join(completeness_dir, f"{cid}.json")
    if not os.path.exists(path):
        return {"content_clean": None, "evaluated": False, "source": None}
    try:
        with open(path, encoding="utf-8") as fh:
            clean = json.load(fh)["grade"]["content_clean"]
    except (OSError, ValueError, KeyError, TypeError):
        return {"content_clean": None, "evaluated": False, "source": os.path.abspath(path)}
    return {"content_clean": bool(clean), "evaluated": True, "source": os.path.abspath(path)}


# --------------------------------------------------------------------------- #
# Sealed live-panel seam — per-axis coercion + fail-closed (STRUCTURED, exercised
# in tests ONLY with an injected fake; NO real key/network here).
# --------------------------------------------------------------------------- #


def _coerce_conflation(v) -> str | None:
    """Per-axis fail-closed coercion of a live conflation verdict: only the
    exact tokens "PASS"/"REJECT" are honored; anything else -> None (fail-closed
    -> INDETERMINATE)."""
    return v if v in ("PASS", "REJECT") else None


def _coerce_enum(v) -> str:
    """Per-axis fail-closed coercion of a live enum verdict: "PASS"/"FAIL"/
    "NOT_EVALUATED" honored verbatim; a bare bool is mapped (True->PASS/
    False->FAIL); anything else fails CLOSED to "NOT_EVALUATED" (never bare
    None for this in-scope axis)."""
    if v in ("PASS", "FAIL", "NOT_EVALUATED"):
        return v
    if v is True:
        return "PASS"
    if v is False:
        return "FAIL"
    return "NOT_EVALUATED"


def _coerce_completeness(v) -> dict:
    """Per-axis fail-closed coercion of a live completeness verdict to the same
    ``{content_clean, evaluated, source}`` record the cached loader emits."""
    if isinstance(v, bool):
        return {"content_clean": v, "evaluated": True, "source": "live_panel_fn"}
    if isinstance(v, dict) and isinstance(v.get("content_clean"), bool):
        return {
            "content_clean": v["content_clean"],
            "evaluated": True,
            "source": "live_panel_fn",
        }
    return {"content_clean": None, "evaluated": False, "source": "live_panel_fn"}


def _obtain_panels(
    mode: str,
    cid: str,
    strategy: dict,
    video_id: str,
    conflation_dir: str,
    enum_dir: str,
    completeness_dir: str,
    live_panel_fn: Callable[[str, dict, str], object] | None,
) -> dict:
    """Obtain the three panel verdicts for one strategy.

    * rehearsal/staging: LOAD the cached certified panels from disk (no live
      call), exactly as ``run_dress_rehearsal.py`` does.
    * sealed: call the injected ``live_panel_fn(cid, strategy, video_id)`` (a
      merged panel call is permitted) and coerce EACH axis independently,
      fail-closed. NOT invoked in tests except via an injected fake.

    Returns ``{conflation, enumeration_consistency, completeness, source}`` where
    the two structural verdicts are the exact strings ``terminal_read_grade``
    consumes and ``completeness`` is the recorded evidence dict."""
    if mode in _REHEARSAL_MODES:
        return {
            "conflation": _load_conflation_verdict(conflation_dir, cid),
            "enumeration_consistency": _load_enum_verdict(enum_dir, cid),
            "completeness": _load_completeness_verdict(completeness_dir, cid),
            "source": "cached-certified-panel-verdicts",
        }
    # sealed
    raw = live_panel_fn(cid, strategy, video_id)  # REAL cross-vendor spend seam
    if not isinstance(raw, dict):
        raw = {}
    enum_raw = raw["enumeration_consistency"] if "enumeration_consistency" in raw else raw.get("enum")
    return {
        "conflation": _coerce_conflation(raw.get("conflation")),
        "enumeration_consistency": _coerce_enum(enum_raw),
        "completeness": _coerce_completeness(raw.get("completeness")),
        "source": "live_panel_fn",
    }


# --------------------------------------------------------------------------- #
# Mechanical floor + certificate assembly (frozen fence, reused read-only).
# --------------------------------------------------------------------------- #


def _panel_prepare_output(strategy: dict, cid: str, strategy_index: int) -> dict:
    """Build the minimal ``prepare_output`` ``finalize_certificate`` reads,
    applying the MECHANICAL FLOOR via ``_a_packet_harness.build_inputs`` (the
    SAME caller-side synthesis the certified rehearsal + all-22 A-packet runner
    use: every condition's verbatim text is concatenated on non-word
    boundaries, so the band-8 locator's anchor authority resolves each span
    verbatim and ``f2_coverage_gate`` — the F-2 content floor — PASSes by
    construction). Lazy import keeps the engine module free of an import-time
    dependency on the shared harness."""
    from src.engine.tests._a_packet_harness import build_inputs

    transcript, tier1, _entries = build_inputs(strategy)
    return {
        "video_id": cid,
        "strategy_index": strategy_index,
        "full_transcript": transcript,
        "unanchored_conditions": [],
        "tier1_detections": tier1,
        "tier1_fallthroughs": [],
        "axis3_audit": None,
        "provenance": {
            "source_video_id": cid,
            "full_transcript_sha256": "sha-sealed-read-v32",
            "extractor_version": "certified-reader-v3.2",
            "taxonomy_version": "taxonomy-v2",
        },
    }


def _certify_one_strategy(strategy: dict, cid: str, strategy_index: int, panels: dict) -> dict:
    """Assemble ONE certificate through the FROZEN fence with BOTH semantic
    structural axes threaded — the EXACT wiring ``run_dress_rehearsal.py`` uses
    (``finalize_certificate`` -> ``assemble_certificate`` -> ``terminal_read_grade``).
    Fail-closed is inherited from the fence: conflation None -> INDETERMINATE;
    enum "NOT_EVALUATED" -> INDETERMINATE; either structural axis REJECT/FAIL ->
    REJECTED; only all-PASS -> CLEAN."""
    from .pilot_conveyor import finalize_certificate

    prepare_output = _panel_prepare_output(strategy, cid, strategy_index)
    return finalize_certificate(
        prepare_output,
        tier3_verdicts=[],
        conflation_verdict=panels["conflation"],
        enumeration_consistency_verdict=panels["enumeration_consistency"],
    )


def _mechanical_floor_record(cert: dict) -> dict:
    """Surface the MECHANICAL FLOOR evidence from the assembled certificate
    (Law 7 — on the artifact): the F-2 content floor status + causality regex
    leg (both from the terminal-read disposition, i.e. the live lint legs the
    fence gates) and the count of anchor-resolved conditions (the band-8 locator
    authority guarantee)."""
    disp = cert.get("terminal_read_disposition", {})
    conds = cert.get("conditions", [])
    return {
        "f2_content_floor": disp.get("f2_coverage_gate"),
        "causality_regex_leg": disp.get("causality_lint.regex_leg"),
        "anchor_authority": "band-8 locator (anchor_locator.locate_anchor) + f2_coverage_gate, reused read-only",
        "n_conditions_classified": sum(1 for c in conds if c.get("classifying_tier") in (1, 3)),
        "n_conditions_unanchored": sum(1 for c in conds if c.get("classifying_tier") is None),
    }


def _strategy_pairs(art: dict) -> list[tuple[str, dict]]:
    """Extract ``(cid, strategy)`` pairs from a Module-B on-disk extraction
    artifact. Prefers the rehearsal ``per_strategy_artifacts`` (carries the real
    ``cid`` + the single staging strategy); falls back, for a byte-exact sealed
    live payload, to the ``strategies`` list with ``cid = <video_id>__s<idx>``."""
    psa = art.get("per_strategy_artifacts")
    if isinstance(psa, list) and psa:
        out: list[tuple[str, dict]] = []
        for entry in psa:
            cid = entry.get("cid")
            strat_list = (entry.get("extraction") or {}).get("strategies") or []
            strat = strat_list[0] if strat_list else None
            if cid and isinstance(strat, dict):
                out.append((cid, strat))
        return out
    video_id = art.get("video_id")
    strategies = art.get("strategies") or []
    return [
        (f"{video_id}__s{i}", s) for i, s in enumerate(strategies) if isinstance(s, dict)
    ]


def run_panels_and_certify_stage(
    extraction_artifacts: dict,
    mode: str,
    cache_dir: str = DEFAULT_PANEL_CACHE_DIR,
    live_panel_fn: Callable[[str, dict, str], object] | None = None,
    conflation_subdir: str = _CONFLATION_SUBDIR,
    enum_subdir: str = _ENUM_SUBDIR,
    completeness_subdir: str = _COMPLETENESS_SUBDIR,
) -> dict:
    """MODULE C stage: mechanical floor + panels + certificate over Module B's
    extraction artifacts.

    ``extraction_artifacts``: the :func:`run_extraction_stage` result (must be
    ``ready=True`` with its ``artifact_paths`` present on disk — the COMPOSE-ORDER
    gate; a not-ready / disk-missing extraction fails closed here).

    ``mode``:
      * ``"rehearsal"``/``"staging"`` — LOAD the cached certified panel verdicts
        from ``cache_dir`` (no live call).
      * ``"sealed"`` — obtain each strategy's panels via the injected
        ``live_panel_fn`` (real cross-vendor spend; seal-day only). Per-axis
        fail-closed. Never invoked by tests without an injected fake.

    Per strategy: applies the mechanical floor, obtains the three panels, and
    assembles the certificate through the frozen fence with BOTH structural axes
    threaded. Returns the raw per-strategy certificates + dispositions ONLY — NO
    rater layer (D), NO cert->video rollup / >=60% bar / verdict math (E), NO
    re-verify/drift guard (F)."""
    if mode not in _REHEARSAL_MODES and mode != "sealed":
        raise ValueError(f"unknown panels+certificate mode: {mode!r}")
    if mode == "sealed" and live_panel_fn is None:
        raise ValueError("sealed mode requires an injected live_panel_fn")

    # COMPOSE-ORDER GATE (ratify-packet §4 / test (d)): Module C is UNREACHABLE
    # unless Module B produced READY artifacts on disk. Fail-closed both ways.
    if not isinstance(extraction_artifacts, dict) or not extraction_artifacts.get("ready"):
        raise ExtractionNotReady(
            "panels+certificate stage requires a READY extraction result "
            "(compose-order: Module C cannot run before Module B succeeds)"
        )
    artifact_paths = extraction_artifacts.get("artifact_paths") or []
    if not artifact_paths:
        raise ExtractionNotReady("extraction result carries no artifact_paths")
    # Re-assert every extraction artifact is physically on disk (never grade an
    # in-memory-only extraction) — raises ArtifactsMissingError if any is gone.
    require_artifacts_on_disk(artifact_paths)

    conflation_dir = os.path.join(cache_dir, conflation_subdir)
    enum_dir = os.path.join(cache_dir, enum_subdir)
    completeness_dir = os.path.join(cache_dir, completeness_subdir)

    certificates: list[dict] = []
    per_video: dict[str, list[dict]] = {}

    for path in artifact_paths:
        with open(path, encoding="utf-8") as fh:
            art = json.load(fh)
        video_id = art.get("video_id")
        rows: list[dict] = []
        for idx, (cid, strategy) in enumerate(_strategy_pairs(art)):
            panels = _obtain_panels(
                mode, cid, strategy, video_id,
                conflation_dir, enum_dir, completeness_dir, live_panel_fn,
            )
            cert = _certify_one_strategy(strategy, cid, idx, panels)
            row = {
                "cid": cid,
                "video_id": video_id,
                "strategy_index": idx,
                "strategy_name": strategy.get("name"),
                "panels": {
                    "completeness_grader_v3": panels["completeness"],
                    "conflation_verdict": panels["conflation"],
                    "enumeration_consistency_verdict": panels["enumeration_consistency"],
                    "source": panels["source"],
                },
                "mechanical_floor": _mechanical_floor_record(cert),
                "terminal_read_grade": cert["terminal_read_grade"],
                "terminal_read_clean": cert["terminal_read_clean"],
                "terminal_read_disposition": cert["terminal_read_disposition"],
                "certificate": cert,
            }
            rows.append(row)
            certificates.append(row)
        per_video[video_id] = rows

    return {
        "stage": "panels_and_certificate",
        "module": "C",
        "mode": mode,
        "ready": True,
        "n_strategies": len(certificates),
        "certificates": certificates,
        "per_video_certificates": per_video,
        "panel_cache_dir": cache_dir if mode in _REHEARSAL_MODES else None,
        "downstream_seams": (
            "D=human-blind raters; E=verdict math (cert->video rollup, >=60% bar, "
            "economics/validity block); F=independent re-verify + drift guard — "
            "NONE computed here (Module C returns per-strategy certificates only)"
        ),
    }


# --------------------------------------------------------------------------- #
# Orchestration entry — Module A gate FIRST, then extraction (B), then
# panels+certificate (C). Each stage is gated on the prior succeeding; seams
# for D/E/F remain clean (no raters, no verdict math, no drift guard here).
# --------------------------------------------------------------------------- #


class SealedReadDriver:
    """Orchestration entry composing Module A's ``gate_sealed_read`` ->
    :func:`run_extraction_stage` (B) -> :func:`run_panels_and_certify_stage` (C).

    :meth:`run` is the A->B slice (retained unchanged for Module B's contract):
    the extraction stage is structurally UNREACHABLE unless the seal gate ALLOWED
    the read. :meth:`run_full` is the FULL A->B->C composition — each stage gated
    on the prior succeeding: a gate refusal short-circuits with ``panels=None``
    (Module C never reached), and Module C itself re-asserts Module B's artifacts
    are on disk before it runs (compose-order, both ways). Seams for D/E/F stay
    clean (no raters, no verdict math, no drift guard here)."""

    def __init__(
        self,
        cache_dir: str = DEFAULT_CACHE_ROOT,
        staging_dir: str | None = None,
        phase_a_vault_dir: str | None = None,
        adjudicate_fn: Callable[[str, dict], dict] | None = None,
        panel_cache_dir: str = DEFAULT_PANEL_CACHE_DIR,
    ):
        self.cache_dir = cache_dir
        self.staging_dir = staging_dir or DEFAULT_STAGING_DIR
        self.phase_a_vault_dir = phase_a_vault_dir or DEFAULT_PHASE_A_VAULT_DIR
        self.adjudicate_fn = adjudicate_fn or _default_adjudicate
        self.panel_cache_dir = panel_cache_dir

    def run(
        self,
        manifest_path: str,
        mode: str,
        out_dir: str,
        token_path: str = DEFAULT_TOKEN_PATH,
        fetched: dict | None = None,
        live_extract_fn: Callable[[str, dict], object] | None = None,
    ) -> dict:
        """Gate (Module A) THEN extract. On gate refusal returns
        ``{ok:False, allowed:False, stage:"seal_gate", halt_reason, gate,
        extraction:None}`` and NEVER touches the extraction stage. On a gate
        pass returns ``{ok:True, allowed:True, stage:"extraction", gate,
        extraction:<run_extraction_stage result>}``."""
        gate = gate_sealed_read(manifest_path, mode, token_path=token_path, fetched=fetched)
        if not gate["allowed"]:
            return {
                "ok": False,
                "allowed": False,
                "stage": "seal_gate",
                "halt_reason": gate["halt_reason"],
                "gate": gate,
                "extraction": None,
            }

        verified = gate["record"]["verify"]
        extraction = run_extraction_stage(
            verified,
            mode,
            cache_dir=self.cache_dir,
            live_extract_fn=live_extract_fn,
            out_dir=out_dir,
            staging_dir=self.staging_dir,
            phase_a_vault_dir=self.phase_a_vault_dir,
            adjudicate_fn=self.adjudicate_fn,
        )
        return {
            "ok": True,
            "allowed": True,
            "stage": "extraction",
            "gate": gate,
            "extraction": extraction,
        }

    def run_full(
        self,
        manifest_path: str,
        mode: str,
        out_dir: str,
        token_path: str = DEFAULT_TOKEN_PATH,
        fetched: dict | None = None,
        live_extract_fn: Callable[[str, dict], object] | None = None,
        live_panel_fn: Callable[[str, dict, str], object] | None = None,
        panel_cache_dir: str | None = None,
    ) -> dict:
        """FULL composition: gate (A) -> extraction (B) -> panels+certificate (C).

        Compose-order is structural: :meth:`run` runs A then B; on ANY gate
        refusal it returns ``ok=False``/``extraction=None`` and this method
        short-circuits with ``stage="seal_gate"``, ``panels=None`` — Module C is
        NEVER reached (no panel load, no ``live_panel_fn`` call). On a gate pass,
        :func:`run_panels_and_certify_stage` runs Module C, which itself
        re-asserts Module B's artifacts are on disk (fail-closed) before
        certifying. Returns the base A->B result plus ``panels`` (the Module C
        stage result) and ``stage="panels_and_certificate"``.

        Seams for D/E/F remain OUT of this composition (no raters, no cert->video
        rollup / >=60% bar / verdict math, no re-verify/drift guard)."""
        base = self.run(
            manifest_path,
            mode,
            out_dir,
            token_path=token_path,
            fetched=fetched,
            live_extract_fn=live_extract_fn,
        )
        if not base.get("ok"):
            # Gate refused -> Module C UNREACHABLE (compose-order short-circuit).
            return {**base, "panels": None}

        panels = run_panels_and_certify_stage(
            base["extraction"],
            mode,
            cache_dir=panel_cache_dir or self.panel_cache_dir,
            live_panel_fn=live_panel_fn,
        )
        return {
            "ok": True,
            "allowed": True,
            "stage": "panels_and_certificate",
            "gate": base["gate"],
            "extraction": base["extraction"],
            "panels": panels,
        }
