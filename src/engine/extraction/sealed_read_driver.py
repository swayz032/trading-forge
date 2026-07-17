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
  * ``mode == "sealed"`` — seal-day only, operator-gated, REAL spend. PER-DRAW /
    PER-STRATEGY dispatch (ADVISOR-RULINGS R-024.1; effective-params §1:
    fresh-context, blind, PER DRAW). The driver requests FIVE independent Phase-A
    enumeration draws per video via the injected ``live_phase_a_draw_fn`` (each a
    SEPARATE blind dispatch — a single per-video subagent running all five draws
    in one context correlates them and silently corrupts the k=5 modal-consensus
    stability measure), computes the modal consensus + stability ITSELF, routes an
    unstable video to ONE blind adjudication dispatch, then requests ONE Phase-B
    single-draw extraction per consensus strategy via the injected
    ``live_phase_b_fn`` (each a SEPARATE dispatch). Every dispatch's identity +
    dispatch_record is asserted PER DISPATCH. NEVER invoked by tests without fakes.

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

import copy
import glob
import hashlib
import json
import os
import re
import tempfile
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
#: Frozen effective-params record (STATUS: FROZEN, ratified R-021) — §5/§6 pin
#: the certified reader's CHANNEL class. The pinned channel-class VALUE is parsed
#: from this record at runtime (R-016 no-transcription law: pointed-at, never
#: copied into code — no channel string literal appears below).
CERTIFIED_READER_EFFECTIVE_PARAMS = os.path.join(
    _ROOT, "docs", "designs", "h1-certified-reader-effective-params-2026-07-16.md"
)
#: The FORBIDDEN dispatch channel-class (R-020.3: the API is REJECTED for the
#: seal-day read — an unmeasured instrument change on a once-only read). This is
#: the anti-value the guard HALTs on, NOT a certified identity value (the
#: certified channel-class is parsed from the frozen record, never hardcoded).
FORBIDDEN_API_CHANNEL = "api"
#: The two dispatch modes the certified channel-class permits (effective-params
#: record §4: interactive dispatch OR headless ``claude -p``, both the same
#: certified-channel runtime). A dispatch_mode outside this set is unverified
#: provenance and fails closed.
_VALID_DISPATCH_MODES = frozenset({"interactive", "headless"})

#: The fields compared by :func:`assert_reader_identity` (source_refs excluded —
#: it is provenance metadata, not part of the asserted identity). channel_class
#: is DELIBERATELY NOT here: per R-021.2 a model's SELF-report of its channel is
#: weak evidence, so channel-class is asserted from the DISPATCH RECORD
#: (:func:`assert_dispatch_identity`), never from the artifact's self-report.
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


def _read_frozen_channel_class(channel_source_path: str) -> str:
    """Parse the pinned CHANNEL-CLASS from the frozen effective-params record's
    ``channel-class = <class>`` pin (§5 — "What the guard asserts"; corroborated
    by the §1/§2 channel field and §4/§6 seal-day binding).

    R-021.2 refinement: channel-class is asserted from HOW the seal-day dispatch
    was made (the certified channel vs API), NEVER from what a reader
    self-reports — so its pinned VALUE lives ONLY in this frozen record and is
    read at runtime here, never hardcoded (R-016 no-transcription law; no channel
    string literal exists in this module). Returns the lower-cased class token
    (e.g. the certified-channel pin). Fail-closed if the record or pin is absent."""
    text = _read_frozen_text(channel_source_path)
    m = re.search(r"channel[-\s]?class\s*=\s*\*{0,2}\s*([A-Za-z]+)", text, re.IGNORECASE)
    if not m:
        raise ReaderIdentityMismatch(
            f"frozen channel-class pin not found in {channel_source_path!r} "
            "(expected a `channel-class = <class>` pin in the effective-params record)"
        )
    return m.group(1).strip().lower()


def certified_reader_identity(
    prereg_path: str = CLAUDE_RUNG_PREREG,
    params_source_path: str = SEALED12_RATIFY_PACKET,
    frontier_prompt_path: str = FRONTIER_PROMPT_PATH,
    enumerator_prompt_path: str = ENUMERATOR_PROMPT_PATH,
    channel_source_path: str = CERTIFIED_READER_EFFECTIVE_PARAMS,
) -> dict:
    """Compute the PINNED certified-reader identity AT RUNTIME by reading the
    frozen files (R-018 law: pointed-at, never copied into code).

    Returns ``{model_id, params, k, prompt_sha, enumerator_sha, channel_class,
    source_refs}``:
      * ``model_id`` / ``k`` — parsed from the frozen Claude-rung pre-reg.
      * ``params`` — the frozen "pinned params" designator (values not
        enumerated in any frozen artifact; see :func:`_read_frozen_params`).
      * ``prompt_sha`` / ``enumerator_sha`` — sha256 of the ON-DISK frontier-v3.2
        and enumerator-v1.2 prompt files (their bytes ARE the prompt identity).
      * ``channel_class`` — the pinned dispatch CHANNEL class parsed from the
        frozen effective-params record (§5). Per R-021.2 this is asserted from
        the DISPATCH RECORD (:func:`assert_dispatch_identity`), never from a
        reader self-report — so it is NOT in ``_IDENTITY_FIELDS``.
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
    channel_class = _read_frozen_channel_class(channel_source_path)
    return {
        "model_id": model_id,
        "params": params,
        "k": k,
        "prompt_sha": prompt_sha,
        "enumerator_sha": enumerator_sha,
        "channel_class": channel_class,
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
            "channel_class": os.path.relpath(channel_source_path, _ROOT).replace(
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


def assert_dispatch_identity(
    dispatch_record, pinned: dict, self_report=None
) -> None:
    """Fail-closed CHANNEL-CLASS + DISPATCH-RECORD assertion (R-020.3 + R-021.2).

    THE REFINEMENT (R-021.2): a model's self-description of its own identity is
    WEAK evidence. So the certified channel-class + model resolution are asserted
    from the seal-day DISPATCH RECORD (HOW the conductor dispatched: which model
    it explicitly requested, what the runtime resolved, and the channel it used —
    the certified channel vs API), with the artifact's ``reader_identity``
    self-report as CORROBORATION ONLY, never the sole source.

    ``dispatch_record`` (dependency-injected by the seal-day conductor, NOT read
    from the artifact): ``{requested_model, resolved_model, channel_class,
    dispatch_mode}``.

    Precedence — the DISPATCH RECORD is authoritative; ``self_report`` may
    corroborate or contradict-→HALT, but NEVER overrides. Raises
    :class:`ReaderIdentityMismatch` (HALT, no artifact accepted) when:
      * ``dispatch_record`` is not a dict (no dispatch provenance to assert);
      * ``channel_class`` is the FORBIDDEN api channel (R-020.3 — API rejected);
      * ``channel_class`` != the pinned channel-class (parsed from the frozen
        record);
      * ``requested_model`` OR ``resolved_model`` != the pinned ``model_id``
        (both legs must match — a requested-right/resolved-wrong dispatch is a
        silent substitution);
      * ``dispatch_mode`` is not one of the certified-channel dispatch modes;
      * ``self_report`` is present AND its model CONTRADICTS the dispatch record's
        resolved model (conflicting evidence fails closed).
    A ``self_report`` that is absent leaves the dispatch record alone governing;
    a ``self_report`` that agrees is accepted (corroboration)."""
    if not isinstance(dispatch_record, dict):
        raise ReaderIdentityMismatch(
            "seal-day dispatch record is required and must be a dict "
            f"(fail-closed HALT — channel-class + model resolution cannot be "
            f"asserted without it): {dispatch_record!r}"
        )

    requested = dispatch_record.get("requested_model")
    resolved = dispatch_record.get("resolved_model")
    channel = dispatch_record.get("channel_class")
    dispatch_mode = dispatch_record.get("dispatch_mode")

    channel_norm = channel.strip().lower() if isinstance(channel, str) else channel
    pinned_channel = pinned.get("channel_class")

    # R-020.3: the API channel is FORBIDDEN for the seal-day read — explicit,
    # named HALT (an unmeasured instrument change on a once-only read).
    if channel_norm == FORBIDDEN_API_CHANNEL:
        raise ReaderIdentityMismatch(
            "dispatch channel_class is the FORBIDDEN api channel — HALT "
            "(R-020.3: the API is rejected for the seal-day read; the certified "
            "read is the certified-channel runtime pinned in the frozen record)"
        )
    # Channel-class must match the pinned (frozen-record) channel-class.
    if channel_norm != pinned_channel:
        raise ReaderIdentityMismatch(
            f"dispatch channel_class {channel!r} != pinned channel-class "
            f"{pinned_channel!r} (from the frozen effective-params record) — HALT"
        )

    # BOTH model legs (what the conductor requested AND what the runtime
    # resolved) must equal the pinned model id — a requested-right but
    # resolved-wrong dispatch is a silent model substitution.
    pinned_model = pinned.get("model_id")
    model_mismatches = [
        (leg, val)
        for leg, val in (("requested_model", requested), ("resolved_model", resolved))
        if val != pinned_model
    ]
    if model_mismatches:
        raise ReaderIdentityMismatch(
            f"dispatch model_id mismatch on {[m[0] for m in model_mismatches]} — "
            f"HALT; details (leg, dispatch, pinned): "
            f"{[(leg, val, pinned_model) for leg, val in model_mismatches]}"
        )

    # dispatch_mode must be a certified-channel dispatch mode (fail-closed).
    if dispatch_mode not in _VALID_DISPATCH_MODES:
        raise ReaderIdentityMismatch(
            f"dispatch_mode {dispatch_mode!r} is not a certified-channel "
            f"dispatch mode {sorted(_VALID_DISPATCH_MODES)} — HALT"
        )

    # CORROBORATION (never override): a present self-report whose model
    # CONTRADICTS the dispatch record's resolved model is conflicting evidence
    # and fails closed. Absent/agreeing self-report -> dispatch record governs.
    if self_report is not None:
        claimed_model = (
            self_report.get("model_id") if isinstance(self_report, dict) else None
        )
        if claimed_model is not None and claimed_model != resolved:
            raise ReaderIdentityMismatch(
                f"conflicting evidence: artifact self-report model {claimed_model!r} "
                f"contradicts the dispatch record's resolved model {resolved!r} — HALT "
                "(the self-report may corroborate or contradict-halt, never override "
                "the authoritative dispatch record)"
            )


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


# --------------------------------------------------------------------------- #
# SEALED LIVE PATH — PER-DRAW / PER-STRATEGY dispatch (ADVISOR-RULINGS R-024.1;
# runbook STEP 2; effective-params record §1: fresh-context, blind, PER DRAW).
#
# THE DEFECT R-024.1 FIXES: the prior sealed seam dispatched ONCE PER VIDEO, so a
# conductor's single per-video subagent could run all five Phase-A enumeration
# draws in ONE context -> CORRELATED draws -> the k=5 modal-consensus stability
# measure is silently corrupted. The certified protocol is FIVE independent
# one-draw subagents for Phase-A, then ONE subagent per consensus strategy for
# Phase-B single-draw. The DRIVER (never the conductor) collects the draws and
# computes the modal consensus + stability itself, and asserts identity PER
# DISPATCH (a wrong model on ANY single draw HALTs, never silently averaged).
# --------------------------------------------------------------------------- #


def _parse_payload(raw) -> dict:
    """Parse a sealed dispatch payload (a ``str`` JSON body or a ``dict``) to a
    dict; anything else -> ``{}`` (fail-soft to an empty payload — the identity
    guard :func:`_claimed_reader_identity` fails such a payload closed)."""
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
        except ValueError:
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return raw if isinstance(raw, dict) else {}


def _assert_one_dispatch(raw, pinned: dict, dispatch_record_fallback=None) -> None:
    """PER-DISPATCH fail-closed identity assertion for ONE sealed dispatch (a
    single Phase-A draw OR a single Phase-B strategy extraction — R-024.1 item 2).

    Runs BOTH guards on THIS dispatch: :func:`assert_reader_identity` (the
    dispatch's self-reported ``reader_identity`` vs the pinned identity) AND
    :func:`assert_dispatch_identity` (the AUTHORITATIVE channel-class + both model
    legs, from the dispatch's OWN ``dispatch_record``, with the self-report as
    corroboration). A dispatch omitting its own ``dispatch_record`` falls back to
    ``dispatch_record_fallback`` (a conductor may supply one whole-run record); if
    neither exists, ``assert_dispatch_identity`` fails closed. A wrong model on ANY
    single dispatch HALTs here — it is never averaged into the consensus."""
    claimed = _claimed_reader_identity(raw)  # fail-closed if self-report absent
    assert_reader_identity(claimed, pinned)
    parsed = _parse_payload(raw)
    dispatch = parsed.get("dispatch_record")
    if dispatch is None:
        dispatch = dispatch_record_fallback
    assert_dispatch_identity(dispatch, pinned, self_report=claimed)


def _draw_count(draw: dict) -> int:
    """The enumeration COUNT of one Phase-A draw: the explicit ``count`` when the
    draw reports one, else the length of its enumerated ``strategy_refs`` (aka
    ``strategies``). Only ints feed the modal consensus (``_mode_of``)."""
    c = draw.get("count")
    if isinstance(c, int):
        return c
    refs = _draw_refs(draw)
    return len(refs)


def _draw_refs(draw: dict) -> list:
    """The enumerated strategy references of one Phase-A draw (what Phase-B
    extracts, one dispatch each). Accepts ``strategy_refs`` or ``strategies``."""
    refs = draw.get("strategy_refs")
    if isinstance(refs, list):
        return refs
    refs = draw.get("strategies")
    return refs if isinstance(refs, list) else []


def _collect_phase_a_draws(
    video_id: str,
    manifest_verified: dict,
    live_phase_a_draw_fn: Callable[[str, int, dict], object],
    pinned: dict,
    k: int,
    dispatch_record_fallback,
) -> tuple[list[dict], list[int]]:
    """Request ``k`` INDEPENDENT Phase-A enumeration draws for one video — draw
    index 0..k-1, EACH its OWN separate dispatch (R-024.1: the conductor fulfils
    each with a fresh blind subagent; the driver NEVER combines draws). Asserts
    identity + dispatch PER DRAW. Returns ``(draws, counts)`` — the parsed draw
    payloads and their per-draw enumeration counts (the input to the modal
    consensus the driver computes itself)."""
    draws: list[dict] = []
    counts: list[int] = []
    for draw_index in range(k):
        raw = live_phase_a_draw_fn(video_id, draw_index, manifest_verified)
        _assert_one_dispatch(raw, pinned, dispatch_record_fallback)
        parsed = _parse_payload(raw)
        draws.append(parsed)
        counts.append(_draw_count(parsed))
    return draws, counts


def _consensus_strategy_refs(
    draws: list[dict], counts: list[int], enum: dict, adjudication
) -> list:
    """The consensus enumeration the driver sends to Phase-B (one dispatch each).

    STABLE (``mode_n >= stability_min``): the strategy refs of the REPRESENTATIVE
    modal draw — the FIRST draw, in dispatch order, whose count equals the modal
    count (deterministic; never wall-clock/iteration order).
    UNSTABLE: the settling blind-adjudication draw's refs, if it resolved a count +
    refs; else ``[]`` (fail-closed — never fabricate an enumeration for a video
    whose count the protocol could not settle)."""
    if enum.get("stable"):
        mode = enum.get("mode")
        for draw, c in zip(draws, counts, strict=False):
            if c == mode:
                return _draw_refs(draw)
        return []
    if isinstance(adjudication, dict):
        refs = adjudication.get("strategy_refs")
        if isinstance(refs, list):
            return refs
    return []


def _dispatch_phase_b(
    video_id: str,
    strategy_refs: list,
    live_phase_b_fn: Callable[[str, object, int, dict], object],
    manifest_verified: dict,
    pinned: dict,
    dispatch_record_fallback,
) -> tuple[list[dict], list[dict], object]:
    """Request ONE Phase-B single-draw extraction PER CONSENSUS STRATEGY — each a
    SEPARATE dispatch (R-024.1). Asserts identity + dispatch PER STRATEGY. Returns
    ``(strategies, per_strategy_artifacts, instrument_classification)`` in the
    staging_v32 shape :func:`_strategy_pairs` (Module C+) already consumes."""
    strategies: list[dict] = []
    per_strategy: list[dict] = []
    instrument = None
    for idx, strategy_ref in enumerate(strategy_refs):
        raw = live_phase_b_fn(video_id, strategy_ref, idx, manifest_verified)
        _assert_one_dispatch(raw, pinned, dispatch_record_fallback)
        parsed = _parse_payload(raw)
        cid = f"{video_id}__s{idx}"
        strat_list = parsed.get("strategies")
        strat = strat_list[0] if isinstance(strat_list, list) and strat_list else None
        if strat is not None:
            strategies.append(strat)
        if instrument is None:
            instrument = parsed.get("instrument_classification")
        per_strategy.append(
            {
                "cid": cid,
                "source_path": None,
                "phase": "B-single-draw",
                "strategy_ref": strategy_ref,
                "extraction": parsed,
            }
        )
    return strategies, per_strategy, instrument


def _build_sealed_artifact(
    video_id: str,
    manifest_verified: dict,
    mode: str,
    live_phase_a_draw_fn: Callable[[str, int, dict], object],
    live_phase_b_fn: Callable[[str, object, int, dict], object],
    adjudicate_fn: Callable[[str, dict], dict],
    pinned: dict,
    k: int,
    stability_min: int,
    dispatch_record_fallback,
) -> dict:
    """Sealed live path — PER-DRAW / PER-STRATEGY (R-024.1). For one verified
    video: request FIVE independent Phase-A enumeration draws (each a separate
    blind dispatch), compute the modal consensus + stability ITSELF (the conductor
    never pre-computes stability), route an UNSTABLE video to ONE additional blind
    adjudication dispatch (the existing hook), then request ONE Phase-B single-draw
    extraction PER CONSENSUS STRATEGY (each a separate dispatch). Every dispatch's
    identity + dispatch_record is asserted PER DISPATCH inside the collectors.

    Returns the assembled per-video extraction artifact (staging_v32 shape) with
    the computed ``phase_a`` recorded (counts + mode + mode_n + stable). Persisted
    deterministically by :func:`_atomic_write` (sorted keys, no wall-clock)."""
    draws, counts = _collect_phase_a_draws(
        video_id, manifest_verified, live_phase_a_draw_fn, pinned, k, dispatch_record_fallback
    )
    # The DRIVER computes the modal consensus + stability from the collected draws
    # (reusing _enum_stability/_mode_of unchanged) — the conductor never does.
    enum = _enum_stability({"counts": counts}, k=k, stability_min=stability_min)
    adjudication_needed = not enum["stable"]
    adjudication = adjudicate_fn(video_id, enum) if adjudication_needed else None

    strategy_refs = _consensus_strategy_refs(draws, counts, enum, adjudication)
    strategies, per_strategy, instrument = _dispatch_phase_b(
        video_id, strategy_refs, live_phase_b_fn, manifest_verified, pinned, dispatch_record_fallback
    )
    return {
        "artifact": "h1-sealed-read-extraction",
        "module": "B-extraction-orchestration",
        "video_id": video_id,
        "mode": mode,
        "policy": POLICY,
        "reader": "certified-reader-v3.2-LIVE",
        "enum_stability": enum,
        "phase_a": {
            "counts": list(counts),
            "mode": enum.get("mode"),
            "mode_n": enum.get("mode_n"),
            "stable": enum.get("stable"),
        },
        "adjudication_needed": adjudication_needed,
        "adjudication": adjudication,
        "n_strategies": len(strategies),
        "strategies": strategies,
        "instrument_classification": instrument,
        "per_strategy_artifacts": per_strategy,
        "source": {
            "phase_a_draws_requested": len(draws),
            "phase_b_strategies_requested": len(strategy_refs),
        },
    }


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
    dispatch_record: dict | None = None,
    live_phase_a_draw_fn: Callable[[str, int, dict], object] | None = None,
    live_phase_b_fn: Callable[[str, object, int, dict], object] | None = None,
) -> dict:
    """Item-1 extraction stage. Produce, persist, and disk-gate one extraction
    artifact per verified video, via the certified reader v3.2 pipeline.

    ``manifest_verified``: Module A's verified-manifest record (carries the
    ``video_ids``).

    ``mode``:
      * ``"rehearsal"``/``"staging"`` — load the ALREADY-SPENT cached staging /
        vault artifacts from disk. NO live call. (``live_extract_fn`` is accepted
        for the rehearsal capstone's no-live-call sentinel and is never invoked.)
      * ``"sealed"`` — PER-DRAW / PER-STRATEGY (ADVISOR-RULINGS R-024.1). The
        driver requests FIVE independent Phase-A enumeration draws per video via
        ``live_phase_a_draw_fn(video_id, draw_index, manifest_verified)`` (draw
        0..k-1, EACH a separate blind dispatch), computes the modal consensus +
        stability ITSELF, routes an UNSTABLE video to ONE blind adjudication
        dispatch, then requests ONE Phase-B single-draw extraction per consensus
        strategy via ``live_phase_b_fn(video_id, strategy_ref, strategy_index,
        manifest_verified)`` (each a separate dispatch). The driver assembles the
        per-video artifact (staging_v32 shape). The legacy single per-video
        ``live_extract_fn`` seam is REMOVED for sealed (it correlated the five
        draws — the exact defect R-024.1 fixes).

    ``dispatch_record`` (R-020.3 + R-021.2): a WHOLE-RUN fallback dispatch record
    ``{requested_model, resolved_model, channel_class, dispatch_mode}`` describing
    HOW the conductor dispatched. Each per-draw / per-strategy payload carries its
    OWN ``dispatch_record`` (asserted PER DISPATCH); this param is used only when a
    payload omits one. If a dispatch has NEITHER, its
    :func:`assert_dispatch_identity` fails closed (HALT). NOT required for
    rehearsal/staging.

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

    if mode not in _REHEARSAL_MODES and mode != "sealed":
        raise ValueError(f"unknown extraction mode: {mode!r}")
    # SEALED requires the PER-DRAW / PER-STRATEGY seams (R-024.1). The single
    # per-video ``live_extract_fn`` seam is gone for sealed — one subagent running
    # all five Phase-A draws in one context is the correlated-draw defect this
    # ruling fixes.
    if mode == "sealed" and (live_phase_a_draw_fn is None or live_phase_b_fn is None):
        raise ValueError(
            "sealed mode requires injected live_phase_a_draw_fn + live_phase_b_fn "
            "(the per-draw / per-strategy seams; R-024.1 — the legacy single "
            "per-video live_extract_fn correlated the five Phase-A draws)"
        )

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
            # pinned identity is authoritative for them). The pinned identity
            # carries channel_class (parsed from the frozen record), so the
            # rehearsal stamp records the certified channel-class too. Rehearsal
            # needs NO dispatch_record: the cached staging_v32 IS the certified
            # rung by construction (it was produced ON the certified channel — the
            # very outputs the certification measured), so there is no live
            # dispatch to assert; the pinned channel-class stamp suffices.
            artifact["reader_identity"] = pinned_identity
            _atomic_write(path, artifact)
            record = artifact
        else:  # sealed — PER-DRAW / PER-STRATEGY (R-024.1)
            # The driver requests 5 independent Phase-A draws + 1 Phase-B dispatch
            # per consensus strategy, asserting each dispatch's identity + dispatch
            # record PER DISPATCH (a wrong model on ANY single draw HALTs here,
            # before assembly — never averaged into the consensus). If any dispatch
            # HALTs, nothing is written for this video.
            artifact = _build_sealed_artifact(
                video_id,
                manifest_verified,
                mode,
                live_phase_a_draw_fn,
                live_phase_b_fn,
                adjudicate_fn,
                pinned_identity,
                k,
                stability_min,
                dispatch_record,
            )
            # Stamp the assembled artifact with the pinned identity (the per-
            # dispatch self-reports were already asserted equal to it).
            artifact["reader_identity"] = pinned_identity
            _atomic_write(path, artifact)
            record = artifact

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
        dispatch_record: dict | None = None,
        live_phase_a_draw_fn: Callable[[str, int, dict], object] | None = None,
        live_phase_b_fn: Callable[[str, object, int, dict], object] | None = None,
    ) -> dict:
        """Gate (Module A) THEN extract. On gate refusal returns
        ``{ok:False, allowed:False, stage:"seal_gate", halt_reason, gate,
        extraction:None}`` and NEVER touches the extraction stage. On a gate
        pass returns ``{ok:True, allowed:True, stage:"extraction", gate,
        extraction:<run_extraction_stage result>}``.

        ``live_phase_a_draw_fn`` / ``live_phase_b_fn`` are the per-draw /
        per-strategy sealed seams (R-024.1), threaded to
        :func:`run_extraction_stage` (required by its sealed path; ignored in
        rehearsal/staging). ``dispatch_record`` is the whole-run fallback record."""
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
            dispatch_record=dispatch_record,
            live_phase_a_draw_fn=live_phase_a_draw_fn,
            live_phase_b_fn=live_phase_b_fn,
        )
        return {
            "ok": True,
            "allowed": True,
            "stage": "extraction",
            "gate": gate,
            "extraction": extraction,
        }

    def run_with_raters(
        self,
        manifest_path: str,
        mode: str,
        out_dir: str,
        token_path: str = DEFAULT_TOKEN_PATH,
        fetched: dict | None = None,
        live_extract_fn: Callable[[str, dict], object] | None = None,
        live_panel_fn: Callable[[str, dict, str], object] | None = None,
        panel_cache_dir: str | None = None,
        dispatch_record: dict | None = None,
        rater_fn: Callable[[str, str, dict], dict] | None = None,
        rater_answers_dir: str | None = None,
        propose_fn: Callable[[str, str], str | None] | None = None,
        live_phase_a_draw_fn: Callable[[str, int, dict], object] | None = None,
        live_phase_b_fn: Callable[[str, object, int, dict], object] | None = None,
    ) -> dict:
        """FULL composition THROUGH MODULE D: gate (A) -> extraction (B) ->
        panels+certificate (C) -> HUMAN-BLIND TWO-STAGE RATER LAYER (D).

        Compose-order is structural, inherited from :meth:`run_full`: on ANY gate
        refusal this short-circuits with ``stage="seal_gate"``, ``panels=None``,
        ``rater_layer=None`` — Module D is NEVER reached (no dual-read, no packet
        build, no ``rater_fn`` call). Module D itself re-asserts (compose-order,
        fail-closed) that Module C produced ready certificates before it runs.

        Seams for E/F remain OUT of this composition (no cert->video rollup / >=60%
        bar / verdict math, no re-verify/drift guard)."""
        full = self.run_full(
            manifest_path,
            mode,
            out_dir,
            token_path=token_path,
            fetched=fetched,
            live_extract_fn=live_extract_fn,
            live_panel_fn=live_panel_fn,
            panel_cache_dir=panel_cache_dir,
            dispatch_record=dispatch_record,
            live_phase_a_draw_fn=live_phase_a_draw_fn,
            live_phase_b_fn=live_phase_b_fn,
        )
        if not full.get("ok"):
            # Gate refused -> Module D UNREACHABLE (compose-order short-circuit).
            return {**full, "rater_layer": None}

        rater_layer = run_rater_layer_stage(
            full,
            mode,
            cache_dir=panel_cache_dir or self.panel_cache_dir,
            rater_fn=rater_fn,
            rater_answers_dir=rater_answers_dir,
            propose_fn=propose_fn,
        )
        return {
            "ok": True,
            "allowed": True,
            "stage": "rater_layer",
            "gate": full["gate"],
            "extraction": full["extraction"],
            "panels": full["panels"],
            "rater_layer": rater_layer,
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
        dispatch_record: dict | None = None,
        live_phase_a_draw_fn: Callable[[str, int, dict], object] | None = None,
        live_phase_b_fn: Callable[[str, object, int, dict], object] | None = None,
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
            dispatch_record=dispatch_record,
            live_phase_a_draw_fn=live_phase_a_draw_fn,
            live_phase_b_fn=live_phase_b_fn,
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

    def run_verdict(
        self,
        manifest_path: str,
        mode: str,
        out_dir: str,
        token_path: str = DEFAULT_TOKEN_PATH,
        fetched: dict | None = None,
        live_extract_fn: Callable[[str, dict], object] | None = None,
        live_panel_fn: Callable[[str, dict, str], object] | None = None,
        panel_cache_dir: str | None = None,
        dispatch_record: dict | None = None,
        rater_fn: Callable[[str, str, dict], dict] | None = None,
        rater_answers_dir: str | None = None,
        propose_fn: Callable[[str, str], str | None] | None = None,
        registration_pre_check: dict | None = None,
        engagement_pre_check: dict | None = None,
        frozen_scan_commit: str | None = None,
        driver_commit: str | None = None,
        epoch: object | None = None,
        live_phase_a_draw_fn: Callable[[str, int, dict], object] | None = None,
        live_phase_b_fn: Callable[[str, object, int, dict], object] | None = None,
    ) -> dict:
        """FULL composition THROUGH MODULE E: gate (A) -> extraction (B) ->
        panels+certificate (C) -> rater layer (D) -> VERDICT MATH (E).

        Compose-order is structural, inherited from :meth:`run_with_raters`: on
        ANY gate refusal this short-circuits with ``stage="seal_gate"``,
        ``rater_layer=None``, ``verdict=None`` — Module E is NEVER reached.
        :func:`run_verdict_stage` itself re-asserts (compose-order, fail-closed)
        that Module D produced ready certificates before it runs the rollup.

        The VALIDITY block's instrument SHA stamps + seal-verification record are
        assembled from the composed result (``extraction.reader_identity`` +
        ``gate.record.verify``); the registration/engagement pre-checks, the
        frozen-scan/driver commits, and the read-once epoch are dependency-injected
        (seal-day inputs). A missing/unverified REQUIRED element => the verdict is
        INVALID (fail-closed, not a silent pass) — that is correct behavior, not a
        bug: the seal-day conductor supplies these.

        Leaves the F seam (full-dress rehearsal orchestration + drift guard)
        clean — no re-verify, no drift guard computed here."""
        composed = self.run_with_raters(
            manifest_path,
            mode,
            out_dir,
            token_path=token_path,
            fetched=fetched,
            live_extract_fn=live_extract_fn,
            live_panel_fn=live_panel_fn,
            panel_cache_dir=panel_cache_dir,
            dispatch_record=dispatch_record,
            rater_fn=rater_fn,
            rater_answers_dir=rater_answers_dir,
            propose_fn=propose_fn,
            live_phase_a_draw_fn=live_phase_a_draw_fn,
            live_phase_b_fn=live_phase_b_fn,
        )
        if not composed.get("ok"):
            # Gate refused -> Module E UNREACHABLE (compose-order short-circuit).
            return {**composed, "verdict": None}

        instrument_stamps = _assemble_instrument_stamps(
            composed,
            registration_pre_check=registration_pre_check,
            engagement_pre_check=engagement_pre_check,
            frozen_scan_commit=frozen_scan_commit,
            driver_commit=driver_commit,
            epoch=epoch,
        )
        verdict = run_verdict_stage(composed["rater_layer"], instrument_stamps, mode)
        return {
            "ok": True,
            "allowed": True,
            "stage": "verdict",
            "gate": composed["gate"],
            "extraction": composed["extraction"],
            "panels": composed["panels"],
            "rater_layer": composed["rater_layer"],
            "verdict": verdict,
        }


# --------------------------------------------------------------------------- #
# MODULE D — HUMAN-BLIND TWO-STAGE RATER LAYER (ratify-packet item 5).
#
# Spec: docs/designs/h1-sealed12-driver-ratify-packet-2026-07-16.md (Module D) +
# pilot ADDENDUM 4 (docs/designs/h1-pilot-preregistration-2026-07-12.md:105-130,
# the dual-read gate + two-stage tier-3 packet, FROZEN law) + R-017 pin 1.
#
# WHAT THIS MODULE DOES (and nothing else — E/F stay clean seams):
#   Per certified strategy from Module C, RUN the FROZEN dual-read agreement gate
#   (``pilot_conveyor.prepare_strategy``: tier-1 detectors on BOTH the extractor's
#   condition text AND the located quote; agreement->classify, disagreement->
#   fall-through — pilot_conveyor.py:1056-1125) to identify the FALLTHROUGH
#   conditions needing tier-3.  For each, the frozen ``_build_tier3_packet`` (that
#   ``prepare_strategy`` already assembled into ``prep["tier3_packet"]``) is the
#   TWO-STAGE packet: Stage-1 blind role-from-quote {gate-strength/context/
#   cannot-determine} committed BEFORE Stage-2 revealed-condition support
#   {confirmed/partial/denied}, read-order locked (Stage-2 lives OUTSIDE
#   ``packet["sections"]`` — structurally absent from the Stage-1 rater view).
#
#   ★ ``blinding_leak_scan`` is run on EVERY packet BEFORE dispatch (house
#   standard). A leak (Stage-2 inferable from Stage-1; identity in the quote;
#   pre-filled answer) => FAIL-CLOSED HALT for that packet — the raters are NEVER
#   invoked on a leaky packet.
#
#   TWO blind control-gated raters per packet, INDEPENDENT (each gets its own
#   deep-copied view; no shared mutable state) and blind to each other + to reader
#   identity. CONTROLS FIRST: the Set-A control items are answered in Stage-1; a
#   rater's TARGET judgments count ONLY if its controls pass (>=4/5 gate-strength
#   AND >=4/5 context — pre-reg §3). Composition mirrors the FROZEN pilot conductor
#   (scripts/h1_pilot_phase3_finalize.py): agreed determinate role ->
#   ``verdict_from_rater_response`` (``control_gate_passed=both_pass``, so
#   ``assemble_certificate`` DROPS any verdict whose gate failed); agreed/contested
#   support -> ``support_verdict_from_stage2_response``. The verdicts feed the SAME
#   frozen fence ``finalize_certificate`` (Module C already calls it) with
#   ``tier3_verdicts`` + ``tier3_support``, so a ``denied``/``partial`` support
#   DOWNGRADES the condition (classifying_tier -> None; pilot/full/certificate
#   grade -> False) per ADDENDUM 4.
#
# FROZEN INSTRUMENTS REUSED READ-ONLY (never modified — all amber): the dual-read
# gate + ``_build_tier3_packet`` + ``blinding_leak_scan`` + ``_load_wave1_control_
# section`` + ``verdict_from_rater_response`` + ``support_verdict_from_stage2_
# response`` + ``finalize_certificate`` in pilot_conveyor.py, ``cert_assembler``,
# ``anchor_locator``.  No live LLM/network call in the rehearsal/staging path or
# any test; the sole live seam is the injected ``rater_fn`` (sealed only).
# --------------------------------------------------------------------------- #

#: Set-A control item_ids + their pre-reg §3 correct direction — the SAME split
#: the FROZEN pilot conductor (h1_pilot_phase3_finalize.py:28-29) applies. NOT a
#: re-derivation: the control quotes + answer key are the Wave-1 shakedown
#: packet's, loaded read-only via ``_load_wave1_control_section``.
_GATE_CONTROLS = frozenset({"W1-0001", "W1-0003", "W1-0005", "W1-0007", "W1-0009"})
_CONTEXT_CONTROLS = frozenset({"W1-0002", "W1-0004", "W1-0006", "W1-0008", "W1-0010"})
#: >=4/5 in EACH direction (pre-reg §3 control gate; conductor uses `>= 4`).
_CONTROL_MIN = 4

#: Rehearsal/staging rater-answer cache root (cached blind answers for ALREADY-
#: SPENT videos, if any exist). Absent -> the deterministic fake is used. NEVER a
#: live call in the rehearsal/staging path.
DEFAULT_RATER_ANSWERS_DIR = os.path.join(_H1_SCRIPTS, "claude-rung-v32", "rater_answers")

_RATER_IDS = ("A", "B")


class RaterLayerNotReady(RuntimeError):
    """Raised (fail-closed, compose-order) when the rater layer (D) is asked to
    run without Module C having produced ready certificates (and Module B its
    on-disk extraction). Structurally proves Module D is UNREACHABLE unless C
    (hence B, hence the A gate) succeeded."""


def _control_gate(stage1_answers: dict) -> dict:
    """Pre-reg §3 control gate from a rater's Stage-1 answers. Mirrors the FROZEN
    conductor's ``control_gate`` (h1_pilot_phase3_finalize.py:38-41): count the
    Set-A gate-strength controls answered ``gate-strength`` and the context
    controls answered ``context``; PASS iff BOTH directions clear ``_CONTROL_MIN``
    (>=4/5). A rater whose controls fail contributes NOTHING downstream."""
    gate_ok = sum(1 for i in _GATE_CONTROLS if stage1_answers.get(i) == "gate-strength")
    context_ok = sum(1 for i in _CONTEXT_CONTROLS if stage1_answers.get(i) == "context")
    return {
        "gate_ok": gate_ok,
        "context_ok": context_ok,
        "passed": gate_ok >= _CONTROL_MIN and context_ok >= _CONTROL_MIN,
    }


def _agreed_role(a: str | None, b: str | None) -> str | None:
    """Determinate cross-rater role agreement (conductor R2): a role classifies
    tier-3 ONLY when both raters returned the SAME determinate call
    (``gate-strength`` or ``context``). ``cannot-determine`` agreement OR any
    disagreement -> None (unresolved fall-through, stays not-clean)."""
    if a == b and a in ("gate-strength", "context"):
        return a
    return None


def _agreed_support(a: dict | None, b: dict | None) -> tuple[str, str]:
    """Cross-rater Stage-2 support composition (conductor R3): ``confirmed`` iff
    BOTH confirmed; a shared ``denied``/``partial`` carries through; any other
    disagreement is a contested downgrade to ``partial``. Returns (support,
    justification) — justification is REQUIRED by
    ``support_verdict_from_stage2_response``."""
    sa = (a or {}).get("support")
    sb = (b or {}).get("support")
    if sa == "confirmed" and sb == "confirmed":
        return "confirmed", "both raters confirmed"
    if sa == sb and sa in ("denied", "partial"):
        return sa, f"both raters {sa}"
    return "partial", f"contested support (raterA={sa}, raterB={sb})"


def _stage1_view(packet: dict) -> dict:
    """The BLIND Stage-1 rater view: a DEEP COPY of the packet with the Stage-2
    block STRUCTURALLY REMOVED. This is the read-order lock made physical — a
    rater doing Stage-1 cannot see any Stage-2 revealed-condition content because
    it is not in the object it is handed. ``_build_tier3_packet`` already keeps
    Stage-2 outside ``sections``; this drops the whole ``stage2`` key too so even
    a packet-wide read of the Stage-1 view is Stage-2-free."""
    return {k: copy.deepcopy(v) for k, v in packet.items() if k != "stage2"}


def _stage2_view(packet: dict, committed_stage1: dict) -> dict:
    """The Stage-2 rater view, revealed ONLY after Stage-1 is committed: the
    revealed ``stage2`` block + this rater's OWN committed Stage-1 roles (so the
    rater answers "does this quote express THIS condition?" against the role it
    already locked). Deep-copied — never shares mutable state with the packet or
    the other rater."""
    return {
        "stage2": copy.deepcopy(packet["stage2"]),
        "committed_stage1": copy.deepcopy(committed_stage1),
    }


def _deterministic_rehearsal_rater(rater_id: str, stage: str, view: dict) -> dict:
    """Network-free deterministic blind rater for the rehearsal/staging path when
    NO cached answers exist (NO live call, ever). Exercises the FULL structure:
    it answers the Set-A controls CORRECTLY (so the control gate passes — a
    stand-in for a competent blind rater, per the house standard that the FAKE
    proves the plumbing, not the judgment), and gives every TARGET item a
    deterministic ``gate-strength`` role + ``confirmed`` support. Reads ONLY the
    view it is handed (Stage-1 view is Stage-2-free) — it never consults the other
    rater's answers, so the two raters stay independent."""
    if stage == "stage1":
        answers: dict = {}
        for section in view.get("sections", []):
            for item in section.get("items", []):
                iid = item.get("item_id")
                if iid in _GATE_CONTROLS:
                    answers[iid] = "gate-strength"
                elif iid in _CONTEXT_CONTROLS:
                    answers[iid] = "context"
                else:
                    answers[iid] = "gate-strength"
        return answers
    # stage2
    out: dict = {}
    for item in view.get("stage2", {}).get("items", []):
        iid = item.get("item_id")
        out[iid] = {"support": "confirmed", "support_justification": "rehearsal-deterministic"}
    return out


def _load_cached_rater(rater_answers_dir: str | None, cid: str):
    """Return a rater_fn backed by CACHED blind answers for ``cid`` if a cache
    file exists (``<rater_answers_dir>/<cid>.json`` with per-rater
    ``{stage1:{item_id:role}, stage2:{item_id:{support,justification}}}``), else
    None (caller falls back to the deterministic fake). NEVER a live call."""
    if not rater_answers_dir:
        return None
    path = os.path.join(rater_answers_dir, f"{cid}.json")
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as fh:
        cached = json.load(fh)

    def cached_rater(rater_id: str, stage: str, view: dict) -> dict:
        return dict(((cached.get(rater_id) or {}).get(stage)) or {})

    return cached_rater


def _dispatch_two_stage_packet(
    packet: dict,
    item_span_map: dict,
    full_transcript: str,
    rater_fn: Callable[[str, str, dict], dict],
    audit_item_id: str | None,
) -> dict:
    """LEAK-SCAN-then-dispatch ONE two-stage packet to the two blind raters.

    ★ FAIL-CLOSED: ``blinding_leak_scan`` runs FIRST. On ANY violation the packet
    is HALTED (``dispatched=False``) and the raters are NEVER invoked — a leaky
    packet is never shipped (house standard, non-negotiable).

    On a clean packet: each rater answers Stage-1 on a Stage-2-FREE view (read-
    order lock), its control gate is scored, THEN Stage-2 is revealed. Verdicts
    are composed ONLY for fall-through targets (the ADDENDUM 5 axis-3 audit item,
    if present, is recorded for the certificate's ``axis3_audit`` monitor but its
    role never classifies — mirrors the conductor's R4). Returns the assembled
    ``tier3_verdicts`` + ``tier3_support`` (both empty when the joint control gate
    fails: every verdict then carries ``control_gate_passed=False`` and is dropped
    by ``assemble_certificate``)."""
    from .pilot_conveyor import (
        blinding_leak_scan,
        support_verdict_from_stage2_response,
        verdict_from_rater_response,
    )

    scan = blinding_leak_scan(packet)
    if not scan.clean:
        return {
            "dispatched": False,
            "halted": True,
            "leak_scan_clean": False,
            "leak_violations": scan.violations,
            "tier3_verdicts": [],
            "tier3_support": [],
            "control_gates": None,
            "both_control_gates_passed": False,
        }

    # Two INDEPENDENT blind raters. Each is handed its OWN deep-copied views;
    # rater B's inputs are byte-identical to rater A's (the packet) and carry
    # NONE of rater A's answers -> no rater-to-rater leakage.
    stage1_by_rater: dict = {}
    stage2_by_rater: dict = {}
    control_gates: dict = {}
    for rid in _RATER_IDS:
        s1 = dict(rater_fn(rid, "stage1", _stage1_view(packet)) or {})
        control_gates[rid] = _control_gate(s1)
        # Stage-2 revealed ONLY after Stage-1 is committed for THIS rater.
        s2 = dict(rater_fn(rid, "stage2", _stage2_view(packet, s1)) or {})
        stage1_by_rater[rid] = s1
        stage2_by_rater[rid] = s2

    both_pass = all(control_gates[rid]["passed"] for rid in _RATER_IDS)
    a1, b1 = stage1_by_rater["A"], stage1_by_rater["B"]
    a2, b2 = stage2_by_rater["A"], stage2_by_rater["B"]

    tier3_verdicts: list = []
    tier3_support: list = []
    role_contested: list = []
    support_contested: list = []
    for item_id, span in item_span_map.items():
        s, e = span
        quote = full_transcript[s:e]
        if item_id == audit_item_id:
            # ADDENDUM 5 axis-3 audit: support recorded for the monitor, role
            # unused (never classifies) — conductor R4.
            sup, just = _agreed_support(a2.get(item_id), b2.get(item_id))
            tier3_support.append(
                support_verdict_from_stage2_response(char_span=(s, e), support=sup, support_justification=just)
            )
            continue
        role = _agreed_role(a1.get(item_id), b1.get(item_id))
        if role is None:
            if a1.get(item_id) != b1.get(item_id):
                role_contested.append({"item_id": item_id, "A": a1.get(item_id), "B": b1.get(item_id)})
            continue
        # A determinate agreed role classifies tier-3 — but ``control_gate_passed``
        # is the JOINT gate, so a single failing rater zeroes the credit
        # (assemble_certificate drops control_gate_passed=False verdicts).
        tier3_verdicts.append(
            verdict_from_rater_response(
                char_span=(s, e), quote_anchor=quote, role=role, control_gate_passed=both_pass
            )
        )
        sup, just = _agreed_support(a2.get(item_id), b2.get(item_id))
        if (a2.get(item_id) or {}).get("support") != (b2.get(item_id) or {}).get("support"):
            support_contested.append({"item_id": item_id})
        tier3_support.append(
            support_verdict_from_stage2_response(char_span=(s, e), support=sup, support_justification=just)
        )

    return {
        "dispatched": True,
        "halted": False,
        "leak_scan_clean": True,
        "leak_violations": [],
        "tier3_verdicts": tier3_verdicts,
        "tier3_support": tier3_support,
        "control_gates": control_gates,
        "both_control_gates_passed": both_pass,
        "role_contested": role_contested,
        "support_contested": support_contested,
    }


def _normalize_rater_input(
    certificates_or_extractions, extraction_result: dict | None
) -> tuple[dict, dict | None]:
    """Accept EITHER a full ``run_with_raters``/``run_full``-style composed result
    (carries both ``panels`` [Module C] and ``extraction`` [Module B]) OR a bare
    Module-C stage result (``stage == "panels_and_certificate"``) plus an explicit
    ``extraction_result``. Returns (cert_stage, extraction). Never guesses — an
    unrecognized shape falls to the compose-order gate in the caller."""
    obj = certificates_or_extractions
    if isinstance(obj, dict) and "panels" in obj and "extraction" in obj:
        return obj.get("panels"), obj.get("extraction")
    if isinstance(obj, dict) and obj.get("stage") == "panels_and_certificate":
        return obj, extraction_result
    return obj if isinstance(obj, dict) else {}, extraction_result


def run_rater_layer_stage(
    certificates_or_extractions,
    mode: str,
    cache_dir: str = DEFAULT_PANEL_CACHE_DIR,
    rater_fn: Callable[[str, str, dict], dict] | None = None,
    rater_answers_dir: str | None = None,
    propose_fn: Callable[[str, str], str | None] | None = None,
    extraction_result: dict | None = None,
) -> dict:
    """MODULE D stage: human-blind two-stage rater layer over Module C's certified
    strategies.

    ``certificates_or_extractions``: the composed ``run_with_raters``/``run_full``
    result (carries Module C's ``panels`` + Module B's ``extraction``), or a bare
    Module-C stage result together with an explicit ``extraction_result``.

    ``mode``:
      * ``"rehearsal"``/``"staging"`` — raters come from CACHED blind answers for
        the spent videos if present (``rater_answers_dir``), else a deterministic
        network-free fake. NO live call. ``propose_fn`` for the dual-read defaults
        to the frozen verbatim locator stub (no network).
      * ``"sealed"`` — REQUIRES an injected ``rater_fn`` (blind control-gated
        rater; real spend, seal-day only, never invoked by tests without a fake).
        ``propose_fn`` defaults to the REAL anchor locator (live) unless injected.

    Per certified strategy: RUN the frozen dual-read gate (``prepare_strategy``) to
    identify fall-throughs -> its ``_build_tier3_packet`` two-stage packet ->
    ★ ``blinding_leak_scan`` (fail-closed HALT on a leak, never dispatched) ->
    two blind control-gated raters -> compose ``tier3_verdicts`` + ``tier3_support``
    -> ``finalize_certificate`` (SAME frozen fence, SAME conflation/enum panels
    Module C used) so a ``denied``/``partial`` support DOWNGRADES the condition.

    Returns the per-strategy rater-adjudicated certificates + dispatch records
    ONLY — NO cert->video rollup / >=60% bar / verdict math (E), NO re-verify (F)."""
    from src.engine.tests._a_packet_harness import build_inputs

    from . import pilot_conveyor as pc

    if mode not in _REHEARSAL_MODES and mode != "sealed":
        raise ValueError(f"unknown rater-layer mode: {mode!r}")
    if mode == "sealed" and rater_fn is None:
        raise ValueError("sealed mode requires an injected rater_fn")

    cert_stage, extraction = _normalize_rater_input(certificates_or_extractions, extraction_result)

    # COMPOSE-ORDER GATE (ratify-packet §4 / test (e)): Module D is UNREACHABLE
    # unless Module C produced READY certificates AND Module B its on-disk
    # extraction artifacts. Fail-closed on every missing link.
    if not isinstance(cert_stage, dict) or not cert_stage.get("ready") or cert_stage.get("stage") != "panels_and_certificate":
        raise RaterLayerNotReady(
            "rater layer requires a READY Module-C panels+certificate stage "
            "(compose-order: D cannot run before C produced certificates)"
        )
    certificate_rows = cert_stage.get("certificates") or []
    if not certificate_rows:
        raise RaterLayerNotReady("Module-C stage produced no certificates to adjudicate")
    if not isinstance(extraction, dict) or not extraction.get("ready"):
        raise RaterLayerNotReady(
            "rater layer requires the Module-B extraction result (pass the full "
            "run_with_raters/run_full result, or an explicit extraction_result)"
        )
    artifact_paths = extraction.get("artifact_paths") or []
    if not artifact_paths:
        raise RaterLayerNotReady("extraction result carries no artifact_paths")
    require_artifacts_on_disk(artifact_paths)

    # Re-derive the RAW strategy dicts from Module B's on-disk artifacts (the SAME
    # `_strategy_pairs` Module C used), keyed by cid — the dual-read gate needs the
    # strategy, which the Module-C row does not carry.
    cid_to_strategy: dict = {}
    for path in artifact_paths:
        with open(path, encoding="utf-8") as fh:
            art = json.load(fh)
        for cid, strategy in _strategy_pairs(art):
            cid_to_strategy[cid] = strategy

    # rehearsal/staging dual-read: frozen verbatim locator stub (NO network).
    # sealed: real locator unless the caller injected one.
    effective_propose_fn = propose_fn
    if effective_propose_fn is None and mode in _REHEARSAL_MODES:
        effective_propose_fn = pc._synthetic_dry_run_propose_fn

    rows: list = []
    per_video: dict = {}
    for row in certificate_rows:
        cid = row.get("cid")
        video_id = row.get("video_id")
        strategy_index = row.get("strategy_index", 0)
        strategy = cid_to_strategy.get(cid)
        panels = row.get("panels") or {}
        conflation_verdict = panels.get("conflation_verdict")
        enum_verdict = panels.get("enumeration_consistency_verdict")

        if strategy is None:
            # Fail-closed: a certificate whose source strategy is not on disk
            # cannot be adjudicated (never fabricate a prep).
            raise RaterLayerNotReady(f"no source strategy on disk for certified cid={cid!r}")

        # Same synthetic transcript Module C certified against (build_inputs), so
        # every fall-through span is a real substring and f2_coverage passes.
        transcript, _tier1, _entries = build_inputs(strategy)

        # RUN THE FROZEN DUAL-READ GATE. prepare_strategy itself leak-scans and
        # raises LeakScanFailure on a leak — caught here as a fail-closed HALT for
        # this strategy (never crash the whole stage).
        try:
            prep = pc.prepare_strategy(
                strategy,
                transcript,
                video_id,
                extractor_version="certified-reader-v3.2",
                taxonomy_version="taxonomy-v2",
                strategy_index=strategy_index,
                propose_fn=effective_propose_fn,
            )
        except pc.LeakScanFailure as exc:
            rows.append(
                {
                    "cid": cid,
                    "video_id": video_id,
                    "strategy_index": strategy_index,
                    "rater_layer_halted": True,
                    "leak_scan_clean": False,
                    "leak_violations": exc.violations,
                    "dispatched": False,
                    "adjudicated_certificate": None,
                }
            )
            per_video.setdefault(video_id, []).append(rows[-1])
            continue

        packet = prep["tier3_packet"]
        item_span_map = prep["item_span_map"]
        audit_item_id = (prep.get("axis3_audit") or {}).get("item_id")

        # Pick the rater for this cid: cached blind answers if present, else the
        # sealed rater_fn, else the deterministic rehearsal fake.
        if mode == "sealed":
            active_rater = rater_fn
        else:
            active_rater = _load_cached_rater(
                rater_answers_dir or DEFAULT_RATER_ANSWERS_DIR, cid
            ) or _deterministic_rehearsal_rater

        dispatch = _dispatch_two_stage_packet(
            packet, item_span_map, prep["full_transcript"], active_rater, audit_item_id
        )

        if dispatch["halted"]:
            # ★ Leak-scan fired at dispatch time -> HALT, packet NOT dispatched,
            # NO adjudicated certificate (fail-closed).
            rows.append(
                {
                    "cid": cid,
                    "video_id": video_id,
                    "strategy_index": strategy_index,
                    "rater_layer_halted": True,
                    "leak_scan_clean": False,
                    "leak_violations": dispatch["leak_violations"],
                    "dispatched": False,
                    "adjudicated_certificate": None,
                }
            )
            per_video.setdefault(video_id, []).append(rows[-1])
            continue

        # Wire the rater verdicts into the SAME frozen fence, threading the SAME
        # conflation/enum panels Module C used, so a denied/partial support
        # DOWNGRADES the condition through to the certificate (ADDENDUM 4).
        adjudicated = pc.finalize_certificate(
            prep,
            dispatch["tier3_verdicts"],
            tier3_support=dispatch["tier3_support"],
            conflation_verdict=conflation_verdict,
            enumeration_consistency_verdict=enum_verdict,
        )
        adjudicated_row = {
            "cid": cid,
            "video_id": video_id,
            "strategy_index": strategy_index,
            "rater_layer_halted": False,
            "leak_scan_clean": True,
            "dispatched": True,
            "n_fallthrough_targets": sum(1 for iid in item_span_map if iid != audit_item_id),
            "n_tier3_verdicts": len(dispatch["tier3_verdicts"]),
            "both_control_gates_passed": dispatch["both_control_gates_passed"],
            "control_gates": dispatch["control_gates"],
            "role_contested": dispatch.get("role_contested", []),
            "support_contested": dispatch.get("support_contested", []),
            "base_certificate": row.get("certificate"),
            "adjudicated_certificate": adjudicated,
            "pilot_grade": adjudicated.get("pilot_grade"),
            "certificate_grade": adjudicated.get("certificate_grade"),
            "terminal_read_grade": adjudicated.get("terminal_read_grade"),
            "terminal_read_clean": adjudicated.get("terminal_read_clean"),
        }
        rows.append(adjudicated_row)
        per_video.setdefault(video_id, []).append(adjudicated_row)

    return {
        "stage": "rater_layer",
        "module": "D",
        "mode": mode,
        "ready": True,
        "n_strategies": len(rows),
        "n_halted": sum(1 for r in rows if r.get("rater_layer_halted")),
        "rater_verdicts": rows,
        "per_video_rater_verdicts": per_video,
        "rater_answers_dir": (rater_answers_dir or DEFAULT_RATER_ANSWERS_DIR) if mode in _REHEARSAL_MODES else None,
        "downstream_seams": (
            "E=verdict math (cert->video rollup, >=60% bar, economics/validity "
            "block); F=independent re-verify + drift guard — NONE computed here "
            "(Module D returns per-strategy rater-adjudicated certificates only)"
        ),
    }


# =========================================================================== #
# STAGED SEALED READ — EMIT-AND-STOP HANDSHAKE (ADVISOR-RULINGS R-026 / AR-017).
#
# The single-shot sealed run_verdict INTERLEAVES the live seams: it dispatches the
# five Phase-A draws/video, computes the consensus ITSELF, then dispatches Phase-B
# PER CONSENSUS STRATEGY, then Module C panels PER CID, then Module D raters PER
# DRIVER-BUILT PACKET.  A BLIND conductor cannot pre-write Phase-B / panels / rater
# answers before it has SEEN the driver's emitted consensus / cids / packets — so a
# one-shot CLI HALTs mid-read on the first unwritten file.  R-026 ratifies the fix:
# a STAGED handshake where the driver EMITS what the conductor must fulfil next,
# STOPS; the conductor fulfils; a resume invocation continues.
#
# These are the DRIVER-SIDE brains of the three stages (the CLI marshals the files):
#   * compute_phase_a_consensus  — stage `phase_a`: ingest the k blind draws/video,
#     compute the modal consensus + stability the driver's own way (reuses
#     _enum_stability/_mode_of/_consensus_strategy_refs UNCHANGED), and return the
#     per-video consensus + a HASH STAMP over the ingested draws.  NO Phase-B.
#   * build_panel_requests / build_rater_packets — stage `certify`: from the
#     assembled Module-B extraction, emit the per-cid panel requests + the two-stage
#     tier-3 rater PACKETS the driver would dispatch (leak-scanned — a leak HALTs,
#     never emitted), so the conductor can fulfil panels + rater answers.
#
# READ-ONCE (R-026.1): these functions only READ conductor artifacts; they NEVER
# dispatch.  A re-invocation on the same files is a deterministic re-ingest/re-emit
# (byte-identical), never a re-dispatch.  The SEALED path only — no rehearsal call
# reaches here (the rehearsal capstone run_full_dress_rehearsal is byte-unchanged).
# =========================================================================== #


def _hash_phase_a_draws(draws_by_video: dict[str, list]) -> str:
    """Deterministic sha256 HASH STAMP over the INGESTED Phase-A draws (the parsed
    per-draw payloads), keyed by sorted video_id, draws in dispatch order. Stage
    `phase_a` emits it; stages `certify`/`verdict` re-hash the SAME draw files and
    HALT on any mismatch (an accidental second Phase-A that drew again would change
    the hash — R-026.1 read-once pin). Pure; no wall-clock."""
    canon = json.dumps(
        {v: draws_by_video[v] for v in sorted(draws_by_video)},
        sort_keys=True,
        ensure_ascii=False,
    )
    return hashlib.sha256(canon.encode("utf-8")).hexdigest()


def compute_phase_a_consensus(
    manifest_verified: dict,
    live_phase_a_draw_fn: Callable[[str, int, dict], object],
    *,
    dispatch_record: dict | None = None,
    adjudicate_fn: Callable[[str, dict], dict] | None = None,
    k: int = K_DEFAULT,
    stability_min: int = STABILITY_MIN,
    pinned: dict | None = None,
) -> dict:
    """STAGE `phase_a` brains (R-026.1): for each verified video, ingest its ``k``
    blind Phase-A enumeration draws (each a SEPARATE read of a conductor-written
    draw artifact — the conductor already dispatched; this only READS), assert
    identity PER DRAW (via :func:`_collect_phase_a_draws`, unchanged), and compute
    the modal consensus + stability the DRIVER's own way (reusing
    :func:`_enum_stability` / :func:`_consensus_strategy_refs`, unchanged). Routes an
    UNSTABLE video to ONE blind adjudication (the existing hook). Does NOT dispatch
    Phase-B.

    Returns ``{per_video: {video_id: {strategy_refs, n_strategies, stable, mode,
    mode_n, counts, adjudication_needed}}, draws_hash, k, stability_min}`` — the
    per-video consensus the conductor fulfils Phase-B against, plus a hash stamp over
    the ingested draws. Deterministic re-emit on the same draw files."""
    pinned = pinned or certified_reader_identity()
    adjudicate_fn = adjudicate_fn or _default_adjudicate
    video_ids = _video_ids_from_verified(manifest_verified)
    if not video_ids:
        raise ValueError("no video_ids for Phase-A consensus")
    per_video: dict[str, dict] = {}
    draws_by_video: dict[str, list] = {}
    for video_id in video_ids:
        draws, counts = _collect_phase_a_draws(
            video_id, manifest_verified, live_phase_a_draw_fn, pinned, k, dispatch_record
        )
        enum = _enum_stability({"counts": counts}, k=k, stability_min=stability_min)
        adjudication_needed = not enum["stable"]
        adjudication = adjudicate_fn(video_id, enum) if adjudication_needed else None
        strategy_refs = _consensus_strategy_refs(draws, counts, enum, adjudication)
        per_video[video_id] = {
            "strategy_refs": list(strategy_refs),
            "n_strategies": len(strategy_refs),
            "stable": bool(enum.get("stable")),
            "mode": enum.get("mode"),
            "mode_n": enum.get("mode_n"),
            "counts": list(counts),
            "adjudication_needed": adjudication_needed,
        }
        draws_by_video[video_id] = draws
    return {
        "per_video": per_video,
        "draws_hash": _hash_phase_a_draws(draws_by_video),
        "k": k,
        "stability_min": stability_min,
    }


def build_panel_requests(extraction_result: dict) -> list[dict]:
    """STAGE `certify` emit (panels): from the assembled Module-B extraction, list
    the per-cid cross-vendor panel requests the conductor must fulfil (``panels/<cid>
    .json``). One entry per certified strategy — ``{cid, video_id, strategy_index,
    strategy_name}`` — reusing :func:`_strategy_pairs` (the SAME cid derivation Module
    C consumes). Pure read of the on-disk extraction artifacts."""
    if not isinstance(extraction_result, dict) or not extraction_result.get("ready"):
        raise ExtractionNotReady(
            "panel-request emit requires a READY extraction result "
            "(compose-order: certify cannot emit before Module B assembled)"
        )
    artifact_paths = extraction_result.get("artifact_paths") or []
    require_artifacts_on_disk(artifact_paths)
    requests: list[dict] = []
    for path in artifact_paths:
        with open(path, encoding="utf-8") as fh:
            art = json.load(fh)
        video_id = art.get("video_id")
        for idx, (cid, strategy) in enumerate(_strategy_pairs(art)):
            requests.append(
                {
                    "cid": cid,
                    "video_id": video_id,
                    "strategy_index": idx,
                    "strategy_name": strategy.get("name"),
                }
            )
    return requests


def build_rater_packets(
    extraction_result: dict,
    *,
    propose_fn: Callable[[str, str], str | None] | None = None,
) -> list[dict]:
    """STAGE `certify` emit (raters) — the R-026.2 SWEEP of the identical
    driver-must-emit-first gap on the rater seam. From the assembled Module-B
    extraction, build the TWO-STAGE tier-3 rater packets the driver would dispatch in
    Module D — WITHOUT dispatching any rater. Runs the SAME frozen dual-read gate
    (``pilot_conveyor.prepare_strategy``, which leak-scans internally) per certified
    strategy as :func:`run_rater_layer_stage`; a leak raises ``LeakScanFailure``
    (fail-closed — the packet is NEVER emitted, the raters NEVER see it).

    Returns, per certified strategy: ``{cid, video_id, strategy_index, stage1_view
    (BLIND — Stage-2 structurally absent), stage2_items (revealed conditions),
    target_item_ids (Set-B + AUDIT — what the raters answer), control_item_ids
    (Set-A)}``. The ``target_item_ids`` are the load-bearing handshake payload: stage
    `verdict` HALTs if the conductor's rater answers reference any item_id NOT in this
    emitted set (R-026.2 rater-match guard)."""
    from src.engine.tests._a_packet_harness import build_inputs

    from . import pilot_conveyor as pc

    if not isinstance(extraction_result, dict) or not extraction_result.get("ready"):
        raise ExtractionNotReady(
            "rater-packet emit requires a READY extraction result "
            "(compose-order: certify cannot emit before Module B assembled)"
        )
    artifact_paths = extraction_result.get("artifact_paths") or []
    require_artifacts_on_disk(artifact_paths)

    # SEALED: real anchor locator unless injected (tests inject the network-free
    # synthetic stub). This is the SAME propose_fn stage `verdict` threads into
    # run_rater_layer_stage, so the rebuilt packets carry IDENTICAL item_ids.
    packets: list[dict] = []
    for path in artifact_paths:
        with open(path, encoding="utf-8") as fh:
            art = json.load(fh)
        video_id = art.get("video_id")
        for idx, (cid, strategy) in enumerate(_strategy_pairs(art)):
            transcript, _tier1, _entries = build_inputs(strategy)
            # prepare_strategy leak-scans and raises LeakScanFailure on a leak — NOT
            # caught here: a leaky packet must HALT the whole emit (fail-closed).
            prep = pc.prepare_strategy(
                strategy,
                transcript,
                video_id,
                extractor_version="certified-reader-v3.2",
                taxonomy_version="taxonomy-v2",
                strategy_index=idx,
                propose_fn=propose_fn,
            )
            packet = prep["tier3_packet"]
            # Set-B + AUDIT item_ids (the join keys the raters answer) come from the
            # driver-built span map — never a re-derivation.
            target_item_ids = list(prep["item_span_map"].keys())
            control_item_ids: list[str] = []
            for section in packet.get("sections", []):
                if section.get("section_id") != "SET-B":
                    for item in section.get("items", []):
                        iid = item.get("item_id")
                        if iid is not None:
                            control_item_ids.append(iid)
            packets.append(
                {
                    "cid": cid,
                    "video_id": video_id,
                    "strategy_index": idx,
                    "stage1_view": _stage1_view(packet),
                    "stage2_items": (packet.get("stage2") or {}).get("items", []),
                    "target_item_ids": target_item_ids,
                    "control_item_ids": control_item_ids,
                }
            )
    return packets


# =========================================================================== #
# MODULE E — VERDICT MATH (ratify-packet items 6-8).
#
# Spec: docs/designs/h1-sealed12-driver-ratify-packet-2026-07-16.md (Module E) +
# ADVISOR-RULINGS R-015 items 6-8 / R-016.3 (cert->video rollup absorption) /
# R-021.3 (completeness-not-gated content boundary, stated twice) / R-017 pin-2
# (rollup-on-mixed-video: a video with >=2 strategies where exactly one is clean
# grades CLEAN via the >=1 rule).
#
# Consumes MODULE D's per-strategy rater-adjudicated certificates (grouped by
# video) and computes the ONE terminal verdict:
#
#   1. cert->VIDEO ROLLUP (item 6, pilot ADDENDUM 6, operator-authored + pinned
#      BLIND 2026-07-12, h1-pilot-preregistration-2026-07-12.md:172): a VIDEO is
#      CLEAN iff AT LEAST ONE of its strategies is certificate-grade. HERE the
#      certificate-grade axis is the terminal read's STRUCTURAL fence —
#      ``terminal_read_grade == "CLEAN"`` — NOT ``pilot_grade`` (pilot_conveyor.
#      aggregate:1689-1696 pins that the sealed-12 driver MUST gate on
#      ``terminal_read_clean``, never ``pilot_grade``, because a merge-silenced
#      cert has ``pilot_grade`` True but ``terminal_read_clean`` False). The
#      video-UNIT clean fraction = clean videos / total videos (NOT the raw
#      per-cert ``terminal_read_clean_fraction`` from ``aggregate``, which is
#      per-strategy). R-017 pin-2 is the >=1 rule verbatim.
#   2. >=60% BAR (item 6): ``meets_bar = video_clean_fraction >= 0.60``, gated on
#      the STRUCTURAL video-unit fraction (the ``terminal_read_grade`` rollup).
#   3. ECONOMICS RIDER (item 6, pilot ADDENDUM 7, operator-authored + pinned
#      BLIND, :184 + h1_pilot_phase3_finalize.py:139-154,166-175): mean
#      PER-VIDEO-AGGREGATE tier-3 adjudications (fallthroughs + axis-3 audits,
#      summed across a video's strategies, exactly as Addendum 7 fixed the unit),
#      recorded + FLAGGED against the ~15 affordability ceiling. A MEASUREMENT +
#      ceiling flag, NEVER a gate that flips ``meets_bar``.
#   4. CONTENT axis (R-021.3, the ruled boundary): completeness/content is
#      RECORDED (carried as a scope line + a recorded summary) but does NOT gate
#      the terminal read. The rollup reads ONLY the structural fence, so a
#      content_clean=False strategy that is structurally CLEAN still counts CLEAN.
#   5. VALIDITY BLOCK computed BEFORE the verdict (item 6): registration/
#      engagement pre-checks + instrument SHA stamps (certified reader efa377d6 +
#      prompt/enumerator SHAs + frozen-scan/driver commit) + the Module-A
#      seal-verification record + an epoch/read-once table. A missing/unverified
#      REQUIRED element => verdict INVALID (fail-closed, never a silent pass).
#   6. READ ONCE (item 6): the verdict is computed ONCE from the persisted
#      certificates Module D carried — deterministic, replayable; NO recomputation
#      of extraction/panels here.
#   7. SCOPE LINES carried VERBATIM on the verdict (item 8).
#
# FROZEN INSTRUMENTS: ``pilot_conveyor.aggregate`` (pilot_conveyor.py:1678) is the
# read-only reference for the per-cert ``terminal_read_clean_fraction`` shape (NOT
# re-implemented or modified here — Module E computes the VIDEO-unit rollup on top
# of Module D's per-strategy ``terminal_read_grade``, which is the same field
# ``aggregate`` counts). ``h1_pilot_phase3_finalize.py`` (the frozen pilot
# conductor: R6 cert->video rollup :139-149, Addendum-7 economics :150-175) is the
# read-only reference for the rollup + economics shape; NEVER imported/modified.
# The F seam (full-dress rehearsal orchestration + drift guard) is left CLEAN.
# --------------------------------------------------------------------------- #

#: The >=60% video-unit fidelity bar (R-015 item 6 / pilot §1 QUALITY bar,
#: h1-pilot-preregistration-2026-07-12.md:11).
VIDEO_CLEAN_BAR = 0.60
#: The ~15 per-video-aggregate adjudications affordability ceiling (pilot
#: ADDENDUM 7 / h1_pilot_phase3_finalize.py:30 CEILING=15). A MEASUREMENT flag,
#: never a gate on the >=60% verdict.
ECONOMICS_CEILING = 15

#: The scope lines carried VERBATIM on every terminal verdict (R-015 item 8).
SCOPE_LINES = (
    "enumeration mis-packaging lower-bound 1/16 (design pool)",
    "variant re-promotion lower-bound 1/22 (axis armed at read)",
    "content axis measured at design-pool layer, RECORDED not gated on the twelve",
    "result scoped to corpus + instrument SHAs + snapshot",
)

#: The REQUIRED validity elements (item 6). A missing/unverified one => INVALID.
_REQUIRED_VALIDITY_ELEMENTS = (
    "instrument_sha_stamps",
    "seal_verification",
    "registration_pre_check",
    "engagement_pre_check",
    "epoch_read_once",
)


class VerdictNotReady(RuntimeError):
    """Raised (fail-closed, compose-order) when the verdict stage (E) is asked to
    run without Module D having produced ready rater-adjudicated certificates
    (and hence C, B, and the A gate having succeeded). Structurally proves
    Module E is UNREACHABLE without Module D's certificates (ratify-packet §4 /
    test (h))."""


# --------------------------------------------------------------------------- #
# Input normalization + per-row readers (read-only; never mutate Module D rows).
# --------------------------------------------------------------------------- #


def _normalize_verdict_input(video_certificates) -> dict:
    """Accept EITHER a Module-D stage result (``module == "D"`` /
    ``stage == "rater_layer"``, carrying ``per_video_rater_verdicts``) OR a full
    composed ``run_verdict``/``run_with_raters`` result (carries ``rater_layer``).
    Returns the ready Module-D stage dict. NEVER guesses a bare mapping into a
    valid stage — an unrecognized / not-ready shape falls to the compose-order
    gate in the caller (fail-closed)."""
    obj = video_certificates
    if isinstance(obj, dict) and isinstance(obj.get("rater_layer"), dict):
        return obj["rater_layer"]
    return obj if isinstance(obj, dict) else {}


def _row_is_clean(row: dict) -> bool:
    """A strategy row is certificate-grade for the rollup iff it was NOT halted
    (a leak-scan HALT is fail-closed not-clean) AND its terminal read graded
    CLEAN. Gates on the STRUCTURAL ``terminal_read_grade`` fence (R-015 item 6 /
    aggregate:1689-1696), NEVER ``pilot_grade``."""
    if row.get("rater_layer_halted"):
        return False
    return row.get("terminal_read_grade") == "CLEAN"


def _row_adjudications(row: dict) -> int:
    """Per-strategy tier-3 ADJUDICATION LOAD = fall-through targets + the axis-3
    audit rider (pilot conductor's ``adjudications = n_fallthrough + n_audit``,
    h1_pilot_phase3_finalize.py:132). Prefers an explicit ``tier3_adjudications``
    integer if a caller supplies one; else derives it from Module D's
    ``n_fallthrough_targets`` + (1 if the adjudicated certificate carries a fired
    ``axis3_audit`` monitor, else 0). A halted / undispatched packet cost 0."""
    if isinstance(row.get("tier3_adjudications"), int):
        return row["tier3_adjudications"]
    n = row.get("n_fallthrough_targets") or 0
    cert = row.get("adjudicated_certificate") or {}
    if cert.get("axis3_audit"):
        n += 1
    return int(n)


def _row_content_clean(row: dict):
    """RECORD-ONLY read of a row's content (completeness) signal for the content
    axis (R-021.3 — recorded, NEVER gated). Looks in the tolerant places a
    content signal may ride (an explicit ``content_clean``, or a threaded Module-C
    completeness panel). Returns True/False/None (None = not measured on this
    row; the content axis is measured at the design-pool layer, not the twelve)."""
    if isinstance(row.get("content_clean"), bool):
        return row["content_clean"]
    panels = row.get("panels")
    if isinstance(panels, dict):
        comp = panels.get("completeness_grader_v3")
        if isinstance(comp, dict) and isinstance(comp.get("content_clean"), bool):
            return comp["content_clean"]
    return None


# --------------------------------------------------------------------------- #
# cert->video rollup + economics + content record (deterministic, pure).
# --------------------------------------------------------------------------- #


def _cert_to_video_rollup(per_video: dict) -> dict:
    """cert->VIDEO rollup (R-015 item 6, pilot ADDENDUM 6, R-017 pin-2): a VIDEO
    is CLEAN iff >=1 of its strategies is certificate-grade
    (``terminal_read_grade == "CLEAN"``). Computes the VIDEO-UNIT clean fraction
    (clean videos / total videos). Deterministic: videos read in sorted id
    order."""
    rows_per_video = []
    clean_videos = 0
    for video_id in sorted(per_video):
        rows = per_video[video_id] or []
        clean_cids = [r.get("cid") for r in rows if _row_is_clean(r)]
        is_clean = len(clean_cids) >= 1  # the >=1 rule (ADDENDUM 6 / R-017 pin-2).
        if is_clean:
            clean_videos += 1
        rows_per_video.append(
            {
                "video_id": video_id,
                "n_strategies": len(rows),
                "n_clean_strategies": len(clean_cids),
                "clean": is_clean,
                "clean_cids": clean_cids,
            }
        )
    n_videos = len(rows_per_video)
    fraction = round(clean_videos / n_videos, 4) if n_videos else None
    return {
        "n_videos": n_videos,
        "clean_videos": clean_videos,
        "video_clean_fraction": fraction,
        "bar": VIDEO_CLEAN_BAR,
        "rule": "video CLEAN iff >=1 strategy terminal_read_grade==CLEAN (ADDENDUM 6 / R-017 pin-2)",
        "per_video": rows_per_video,
    }


def _economics_rider(per_video: dict) -> dict:
    """ECONOMICS RIDER (R-015 item 6, pilot ADDENDUM 7): mean PER-VIDEO-AGGREGATE
    tier-3 adjudications (summed across each video's strategies, then meaned over
    videos — the unit Addendum 7 fixed). Recorded + flagged against the ~15
    ceiling. A MEASUREMENT + ceiling flag, NEVER a gate on the >=60% verdict.
    Deterministic: sorted video order."""
    per_video_aggregate = {}
    for video_id in sorted(per_video):
        per_video_aggregate[video_id] = sum(
            _row_adjudications(r) for r in (per_video[video_id] or [])
        )
    n_videos = len(per_video_aggregate)
    agg_list = list(per_video_aggregate.values())
    mean_adj = round(sum(agg_list) / n_videos, 4) if n_videos else None
    return {
        "statistic": (
            "mean per-video-AGGREGATE tier-3 adjudications (fallthroughs + axis-3 "
            "audits, summed across a video's strategies) vs the ~15 ceiling "
            "(ADDENDUM 7); MEASUREMENT + ceiling flag, NOT a gate on meets_bar"
        ),
        "mean_per_video_aggregate_adjudications": mean_adj,
        "ceiling": ECONOMICS_CEILING,
        "ceiling_flag": bool(mean_adj is not None and mean_adj > ECONOMICS_CEILING),
        "per_video_adjudications": per_video_aggregate,
        "annotation_videos_over_ceiling": sum(1 for a in agg_list if a > ECONOMICS_CEILING),
        "annotation_max_video_aggregate": max(agg_list) if agg_list else None,
        "gates_verdict": False,
    }


def _content_axis_record(per_video: dict) -> dict:
    """RECORD-ONLY content-axis summary (R-021.3 ruled boundary — content is
    RECORDED, never gated on the twelve). Tallies the content_clean signals
    present on Module D rows (usually None here: content is measured at the
    design-pool layer, not the terminal read). ``gated`` is HARD-FALSE — this
    summary can never move ``meets_bar``."""
    true_n = false_n = unknown_n = 0
    for video_id in sorted(per_video):
        for r in (per_video[video_id] or []):
            cc = _row_content_clean(r)
            if cc is True:
                true_n += 1
            elif cc is False:
                false_n += 1
            else:
                unknown_n += 1
    return {
        "content_clean_true": true_n,
        "content_clean_false": false_n,
        "content_unmeasured_on_twelve": unknown_n,
        "gated": False,
        "note": (
            "content/completeness measured at the design-pool layer + RECORDED "
            "here; per R-021.3 it does NOT gate the terminal read (structural "
            "fence only). A content_clean=False strategy still counts CLEAN if "
            "its terminal_read_grade is CLEAN."
        ),
    }


# --------------------------------------------------------------------------- #
# Validity block (computed BEFORE the verdict; fail-closed).
# --------------------------------------------------------------------------- #


def _instrument_sha_stamps_verified(stamps) -> bool:
    """The instrument SHA stamps are verified iff the certified-reader identity
    carries its real prompt/enumerator SHAs + model id + the certified-reader tag
    (efa377d6), AND the frozen-scan + driver commits are present. Any missing leg
    fails closed."""
    if not isinstance(stamps, dict):
        return False
    ri = stamps.get("reader_identity")
    if not isinstance(ri, dict):
        return False
    if not (ri.get("model_id") and ri.get("prompt_sha") and ri.get("enumerator_sha")):
        return False
    if not (ri.get("source_refs") or {}).get("certified_reader_tag"):
        return False
    if not (isinstance(stamps.get("frozen_scan_commit"), str) and stamps["frozen_scan_commit"]):
        return False
    if not (isinstance(stamps.get("driver_commit"), str) and stamps["driver_commit"]):
        return False
    return True


def _element_verified(name: str, value) -> bool:
    """Fail-closed per-element verification predicate for the validity block."""
    if name == "instrument_sha_stamps":
        return _instrument_sha_stamps_verified(value)
    if name == "seal_verification":
        # Module A's verify record must be present AND report ok (tamper-clean).
        return isinstance(value, dict) and bool(value.get("ok"))
    if name in ("registration_pre_check", "engagement_pre_check"):
        return isinstance(value, dict) and bool(value.get("ok"))
    if name == "epoch_read_once":
        return (
            isinstance(value, dict)
            and value.get("epoch") is not None
            and bool(value.get("read_once"))
        )
    return False


def _validity_block(instrument_stamps: dict, mode: str) -> dict:
    """Assemble + verify the VALIDITY block BEFORE the verdict (R-015 item 6).
    Every REQUIRED element (instrument SHA stamps, seal-verification record,
    registration + engagement pre-checks, epoch/read-once table) is checked
    fail-closed; ``valid`` is True iff ALL required elements verify. A missing /
    unverified element => the verdict is INVALID (never a silent pass)."""
    stamps = instrument_stamps if isinstance(instrument_stamps, dict) else {}
    elements = {}
    missing_or_unverified = []
    for name in _REQUIRED_VALIDITY_ELEMENTS:
        value = stamps.get(name)
        ok = _element_verified(name, value)
        elements[name] = {"present": value is not None, "verified": ok, "value": value}
        if not ok:
            missing_or_unverified.append(name)
    return {
        "valid": not missing_or_unverified,
        "mode": mode,
        "required_elements": list(_REQUIRED_VALIDITY_ELEMENTS),
        "missing_or_unverified": missing_or_unverified,
        "elements": elements,
    }


def _assemble_instrument_stamps(
    composed: dict,
    registration_pre_check: dict | None = None,
    engagement_pre_check: dict | None = None,
    frozen_scan_commit: str | None = None,
    driver_commit: str | None = None,
    epoch: object | None = None,
) -> dict:
    """Build the VALIDITY-block ``instrument_stamps`` from a composed A->D result:
    the instrument SHA stamps from ``extraction.reader_identity`` (carrying the
    certified reader tag efa377d6 + prompt/enumerator SHAs) + the injected
    frozen-scan/driver commits; the Module-A seal-verification record from
    ``gate.record.verify``; and the injected registration/engagement pre-checks +
    read-once epoch. Injected seal-day inputs left as ``None`` stay None so the
    validity block fails them closed (never fabricated)."""
    extraction = composed.get("extraction") if isinstance(composed, dict) else None
    reader_identity = extraction.get("reader_identity") if isinstance(extraction, dict) else None
    gate = composed.get("gate") if isinstance(composed, dict) else None
    verify = ((gate or {}).get("record") or {}).get("verify") if isinstance(gate, dict) else None
    return {
        "instrument_sha_stamps": {
            "reader_identity": reader_identity,
            "frozen_scan_commit": frozen_scan_commit,
            "driver_commit": driver_commit,
        },
        "seal_verification": verify,
        "registration_pre_check": registration_pre_check,
        "engagement_pre_check": engagement_pre_check,
        "epoch_read_once": (
            {"epoch": epoch, "read_once": True} if epoch is not None else None
        ),
    }


# --------------------------------------------------------------------------- #
# The verdict stage.
# --------------------------------------------------------------------------- #


def run_verdict_stage(video_certificates, instrument_stamps: dict, mode: str) -> dict:
    """MODULE E stage: the ONE terminal verdict over Module D's per-strategy
    rater-adjudicated certificates.

    ``video_certificates``: Module D's stage result (``module == "D"`` /
    ``stage == "rater_layer"``, ``ready`` True, carrying ``per_video_rater_verdicts``)
    OR a full composed ``run_verdict``/``run_with_raters`` result (carries
    ``rater_layer``). Fail-closed (:class:`VerdictNotReady`) on any not-ready /
    unrecognized shape — Module E is UNREACHABLE without Module D's certificates.

    ``instrument_stamps``: the VALIDITY-block inputs (instrument SHA stamps,
    seal-verification record, registration/engagement pre-checks, epoch/read-once
    table). Assembled by :func:`_assemble_instrument_stamps` in the compose path.

    Computes, in order: the VALIDITY block (BEFORE the verdict); the cert->VIDEO
    rollup (video CLEAN iff >=1 strategy ``terminal_read_grade==CLEAN``); the
    >=60% video-unit bar; the economics rider (recorded + ceiling-flagged, NOT a
    gate); the content-axis record (recorded, NOT gated); the verbatim scope
    lines. READ ONCE — computed once from the persisted certificates Module D
    carried, deterministic (no wall-clock / recomputation of extraction/panels).

    Verdict: INVALID if the validity block fails (fail-closed, ``meets_bar``
    None); else FIDELITY_PASS iff the video-unit fraction >= 0.60, else
    FIDELITY_MISS. Leaves the F seam (re-verify + drift guard) clean."""
    if mode not in _REHEARSAL_MODES and mode != "sealed":
        raise ValueError(f"unknown verdict mode: {mode!r}")

    stage = _normalize_verdict_input(video_certificates)

    # COMPOSE-ORDER GATE (ratify-packet §4 / test (h)): Module E is UNREACHABLE
    # unless Module D produced READY certificates. Fail-closed on every bad shape.
    if (
        not isinstance(stage, dict)
        or not stage.get("ready")
        or stage.get("stage") != "rater_layer"
    ):
        raise VerdictNotReady(
            "verdict stage requires a READY Module-D rater-layer stage "
            "(compose-order: E cannot run before D produced certificates)"
        )
    per_video = stage.get("per_video_rater_verdicts")
    if not isinstance(per_video, dict) or not per_video:
        raise VerdictNotReady("Module-D stage carries no per-video certificates to roll up")

    # VALIDITY BLOCK — computed BEFORE the verdict (item 6). A missing/unverified
    # required element => verdict INVALID (fail-closed, never a silent pass).
    validity = _validity_block(instrument_stamps, mode)

    # cert->VIDEO rollup + >=60% BAR (structural fence only). Content is NOT gated.
    rollup = _cert_to_video_rollup(per_video)
    fraction = rollup["video_clean_fraction"]
    meets_bar = bool(fraction is not None and fraction >= VIDEO_CLEAN_BAR)

    # ECONOMICS + CONTENT — recorded measurements, neither gates meets_bar.
    economics = _economics_rider(per_video)
    content_axis = _content_axis_record(per_video)

    # THE VERDICT: INVALID if validity failed (fail-closed); else the >=60% read.
    if not validity["valid"]:
        verdict = "INVALID"
        verdict_meets_bar = None
    else:
        verdict = "FIDELITY_PASS" if meets_bar else "FIDELITY_MISS"
        verdict_meets_bar = meets_bar

    return {
        "stage": "verdict",
        "module": "E",
        "mode": mode,
        "ready": bool(validity["valid"]),
        "read_once": True,
        "verdict": verdict,
        "meets_bar": verdict_meets_bar,
        # The measured structural read (recorded even when INVALID, so the
        # operator sees what would-have-been — but the top-line verdict is the
        # fail-closed INVALID and meets_bar is None, never a silent pass).
        "video_unit": rollup,
        "measured_meets_bar": meets_bar,
        "economics": economics,
        "content_axis_recorded": content_axis,
        "validity": validity,
        "scope_lines": list(SCOPE_LINES),
        "downstream_seams": (
            "F=full-dress rehearsal orchestration + independent re-verify + drift "
            "guard — NONE computed here (Module E returns the terminal verdict math "
            "only, read once from Module D's persisted certificates)"
        ),
    }


# =========================================================================== #
# MODULE F — FULL-DRESS REHEARSAL + INDEPENDENT RE-VERIFY + DRIFT GUARD
#            (ratify-packet items 7, 10, 11).  THE CAPSTONE.
#
# Spec: docs/designs/h1-sealed12-driver-ratify-packet-2026-07-16.md (Module F) +
# ADVISOR-RULINGS R-015 items 7/10/11 + R-017 pin-2 (BOTH witnesses, BOTH axes,
# rollup-on-mixed-video).
#
# WHAT THIS MODULE DOES — it DRIVES the complete A->E driver end-to-end on the 3
# spent design-pool videos in staging/rehearsal (no SEAL-GO.token, no live LLM,
# no network — every stage's rehearsal path uses cached/deterministic inputs) and
# adds the three capstone guards the earlier fence-only harness
# (docs/replay-results/h1-scripts/claude-rung-v32/run_dress_rehearsal.py) could
# not: it supersedes that harness by driving the REAL SealedReadDriver instead of
# calling pilot_conveyor.finalize_certificate directly.
#
#   * item 10 — FULL-DRESS REHEARSAL. run_verdict (gate A -> extraction B ->
#     panels+cert C -> raters D -> verdict E) over the 3 spent videos, with a
#     per-stage "exercised" receipt so a MISSING stage is visible (a stage that
#     never ran leaves receipt.exercised=False -> rehearsal_pass=False).
#   * ★ R-017 pin-2 BOTH WITNESSES BOTH AXES through the COMPLETE pipeline (not
#     just the fence): the IyF re-promotion (conflation PASS but SEMANTIC enum
#     FAIL) drives full A->E and must REJECT on the ENUM axis + reach the verdict
#     not-clean; the R5L890-FUSED merge-silencing fixture drives C->D->E (it is a
#     synthetic adversarial, not a pool video, so it enters at Module B's on-disk
#     artifact exactly as the reference harness threads it) and must REJECT on the
#     CONFLATION axis + reach the verdict not-clean. Each disposition axis asserted.
#   * ★ ROLLUP-ON-MIXED-VIDEO end-to-end: a video with 2 strategies where EXACTLY
#     ONE grades CLEAN — CONSTRUCTED FROM THE SPENT CERTS (a real spent CLEAN
#     Module-D cert + the real IyF REJECTED Module-D cert grouped under one
#     video) — rolls up CLEAN through run_verdict_stage (the >=1 rule).
#   * item 7 — INDEPENDENT RE-VERIFY. The rehearsal verdict is RECOMPUTED from the
#     persisted stage artifacts two ways (0.5-exam fresh-eyes): a full REPLAY of
#     A->E (determinism) and an INDEPENDENT recompute of the video-unit fraction /
#     >=60% bar from the primary verdict's own per-video rows (not re-calling the
#     verdict stage). Both must match the first verdict.
#   * item 11 — DRIFT GUARD. :func:`rehearsal_drift_guard` pins the certified
#     instrument-surface SHAs (reader tag efa377d6, frontier + enumerator prompt
#     SHAs, reader model id, frozen-scan / driver commits); ANY surface that
#     differs between "green" and "read-day" => drift => the witness pair MUST be
#     re-run before the seal breaks.
#
# FROZEN INSTRUMENTS reused READ-ONLY (never rewritten): Modules A-E above,
# ``terminal_read_grade`` / ``pilot_conveyor`` / the certified reader /
# ``h1_pilot_phase3_finalize.py``. The injected live seams (live_extract_fn /
# live_panel_fn / rater_fn) stay UNUSED in rehearsal — spies threaded here MUST
# NOT fire (test (g)).
# =========================================================================== #

#: The 3 spent design-pool videos the capstone rehearsal drives A->E (ratify
#: packet Module F: 2DX, DLwVqc, R5L890). Deterministic, already-spent.
REHEARSAL_SPENT_VIDEOS = ("2DXQqwKSwJE", "DLwVqcLRcfw", "R5L890juvRw")

#: The five pipeline stages a full-dress rehearsal must PROVABLY exercise.
_PIPELINE_STAGES = ("gate", "extraction", "panels_and_certificate", "rater_layer", "verdict")

#: The standing adversarial witnesses (R-017 pin-2: both witnesses, both axes).
#: IyF re-promotion — a REAL spent video (conflation PASS, SEMANTIC enum FAIL) ->
#: REJECT on the ENUM axis through the full A->E path.
IYF_WITNESS_VIDEO = "IyFioFkRgWo"
IYF_WITNESS_CID = "IyFioFkRgWo__s0"
#: R5L890-FUSED merge-silencing fixture — a SYNTHETIC adversarial (conflation
#: REJECT) -> REJECT on the CONFLATION axis through C->D->E (it is not a pool
#: video, so it enters at Module B's on-disk artifact, as the reference harness
#: threads it). Its calibrated conflation grade cid is CAL_R5L890_FUSED.
FUSED_WITNESS_CID = "CAL_R5L890_FUSED"
FUSED_FIXTURE_BASENAME = "R5L890_FUSED_reject.json"
_CONFLATION_FIXTURES_SUBDIR = "conflation_fixtures"


class RehearsalManifestMismatch(RuntimeError):
    """Raised (fail-closed) when the rehearsal manifest is not exactly the 3 spent
    design-pool videos — the capstone drives A->E on THOSE videos; a wrong manifest
    is never silently rehearsed."""


# --------------------------------------------------------------------------- #
# Small deterministic helpers (no network, no wall-clock).
# --------------------------------------------------------------------------- #


def _write_spent_rehearsal_manifest(path: str, video_ids: list[str]) -> str:
    """Write a staging-mode manifest (non-sealed basename, sha-self-consistent per
    Module A's frozen method) for SPENT videos — the kind Module A's staging gate
    accepts. Never writes the sealed-12 basename; never used for a sealed read."""
    ids = sorted(video_ids)
    payload = "\n".join(ids).encode("utf-8")
    manifest = {
        "artifact": "h1-rehearsal-spent-manifest",
        "sealed_sha256": hashlib.sha256(payload).hexdigest(),
        "sealed_sha256_method": "sha256 over the newline-joined sorted video_id list.",
        "videos": [{"video_id": v} for v in ids],
    }
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh)
    return path


def _write_witness_extraction_artifact(out_dir: str, video_id: str, cid: str, strategy: dict) -> str:
    """Write a minimal Module-B on-disk extraction artifact (``per_strategy_artifacts``
    shape :func:`_strategy_pairs` consumes) so a SYNTHETIC witness (the FUSED
    fixture, not a pool video) enters the REAL Module C->D->E path exactly as a
    pool video's Module-B output would. Never fabricates a grade — only the
    extraction the certified panels are then read against."""
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, f"{video_id}.extraction.json")
    art = {
        "artifact": "h1-sealed-read-extraction",
        "video_id": video_id,
        "per_strategy_artifacts": [{"cid": cid, "extraction": {"strategies": [strategy]}}],
    }
    _atomic_write(path, art)
    return path


def _module_d_stage(per_video: dict, mode: str) -> dict:
    """Wrap a per-video map of REAL Module-D rows into a ready Module-D stage dict
    (the exact shape :func:`run_rater_layer_stage` returns and
    :func:`run_verdict_stage` consumes) — used to roll a CONSTRUCTED mixed video
    (real spent certs) up through the REAL verdict stage."""
    flat = [r for rows in per_video.values() for r in rows]
    return {
        "stage": "rater_layer",
        "module": "D",
        "mode": mode,
        "ready": True,
        "n_strategies": len(flat),
        "rater_verdicts": flat,
        "per_video_rater_verdicts": per_video,
    }


def _make_live_call_spies() -> tuple[dict, Callable, Callable, Callable]:
    """Build the NO-LIVE-CALL spies (test (g)): live_extract_fn / live_panel_fn /
    rater_fn that RAISE if ever invoked. Threaded through every rehearsal call; the
    rehearsal/staging code paths use cached/deterministic inputs, so a spy firing
    means a live seam leaked into the deterministic rehearsal (a HARD failure)."""
    counters = {"live_extract": 0, "live_panel": 0, "rater": 0, "violations": []}

    def _spy(kind: str) -> Callable:
        def fn(*_args, **_kwargs):  # pragma: no cover - firing IS the failure
            counters[kind] += 1
            counters["violations"].append(kind)
            raise AssertionError(
                f"LIVE-CALL VIOLATION: {kind} seam invoked in the deterministic "
                "rehearsal path (rehearsal must be cached/deterministic — no network)"
            )

        return fn

    return counters, _spy("live_extract"), _spy("live_panel"), _spy("rater")


def _stage_receipts(composed: dict) -> dict:
    """Per-stage EXERCISED receipt over a composed A->E ``run_verdict`` result so a
    MISSING stage is visible (item 10). Each stage records whether it provably ran
    + terse evidence; ``all_exercised`` is the AND over the five stages."""
    gate = composed.get("gate") or {}
    extraction = composed.get("extraction") or {}
    panels = composed.get("panels") or {}
    rater = composed.get("rater_layer") or {}
    verdict = composed.get("verdict") or {}
    receipts = {
        "gate": {
            "exercised": bool(gate.get("allowed")),
            "evidence": {
                "allowed": gate.get("allowed"),
                "verified": gate.get("verified"),
                "n_videos": len((((gate.get("record") or {}).get("verify") or {}).get("video_ids")) or []),
            },
        },
        "extraction": {
            "exercised": bool(extraction.get("ready") and extraction.get("artifact_paths")),
            "evidence": {
                "ready": extraction.get("ready"),
                "n_artifacts_on_disk": len(extraction.get("artifact_paths") or []),
                "reader_tag": ((extraction.get("reader_identity") or {}).get("source_refs") or {}).get(
                    "certified_reader_tag"
                ),
            },
        },
        "panels_and_certificate": {
            "exercised": bool(panels.get("module") == "C" and panels.get("certificates")),
            "evidence": {
                "module": panels.get("module"),
                "n_certificates": len(panels.get("certificates") or []),
            },
        },
        "rater_layer": {
            "exercised": bool(rater.get("module") == "D" and rater.get("rater_verdicts")),
            "evidence": {
                "module": rater.get("module"),
                "n_adjudicated": len(rater.get("rater_verdicts") or []),
                "n_halted": rater.get("n_halted"),
            },
        },
        "verdict": {
            "exercised": bool(verdict.get("module") == "E"),
            "evidence": {
                "module": verdict.get("module"),
                "verdict": verdict.get("verdict"),
                "validity_valid": (verdict.get("validity") or {}).get("valid"),
            },
        },
    }
    receipts["all_exercised"] = all(
        receipts[s]["exercised"] for s in _PIPELINE_STAGES
    )
    receipts["stages"] = list(_PIPELINE_STAGES)
    return receipts


def _per_video_clean_map(composed: dict) -> dict:
    """The {video_id: clean-bool} map from a composed verdict's video-unit rollup —
    the deterministic fingerprint the replay re-verify compares."""
    per_video = ((composed.get("verdict") or {}).get("video_unit") or {}).get("per_video") or []
    return {e["video_id"]: e["clean"] for e in per_video}


def rehearsal_instrument_shas(
    driver_commit: str | None = None, frozen_scan_commit: str | None = None
) -> dict:
    """The instrument-surface SHA map the drift guard pins (item 11). Reads the
    certified-reader identity AT RUNTIME from the frozen files (R-016/R-018 law:
    pointed-at, never hand-transcribed) — the certified reader tag (efa377d6), the
    frontier + enumerator prompt SHAs (sha256 of the on-disk prompt files), and the
    reader model id — plus the frozen-scan / driver commits (seal-day injected)."""
    ri = certified_reader_identity()
    return {
        "certified_reader_tag": (ri.get("source_refs") or {}).get("certified_reader_tag"),
        "reader_model_id": ri.get("model_id"),
        "frontier_prompt_sha": ri.get("prompt_sha"),
        "enumerator_prompt_sha": ri.get("enumerator_sha"),
        "frozen_scan_commit": frozen_scan_commit,
        "driver_commit": driver_commit,
    }


def rehearsal_drift_guard(pinned_shas: dict, current_shas: dict) -> dict:
    """DRIFT GUARD (ratify-packet item 11): compare the pinned certified
    instrument-surface SHAs ("green") against the read-day SHAs. ANY surface whose
    SHA differs => drift => the standing witness pair (IyF enum REJECT +
    R5L890-FUSED conflation REJECT) MUST be re-run before the seal breaks.

    Returns ``{ok, drifted, drifted_surfaces, detail, witness_rerun_required}``:
    ``drifted`` is the boolean the caller gates on (True iff >=1 surface changed);
    ``drifted_surfaces`` names which. Fail-closed: a surface present on one side but
    absent on the other counts as drift (a dropped/renamed instrument is drift)."""
    pinned = pinned_shas if isinstance(pinned_shas, dict) else {}
    current = current_shas if isinstance(current_shas, dict) else {}
    surfaces = sorted(set(pinned) | set(current))
    detail: dict = {}
    drifted_surfaces: list[str] = []
    for name in surfaces:
        p = pinned.get(name)
        c = current.get(name)
        changed = p != c
        detail[name] = {"pinned": p, "current": c, "changed": changed}
        if changed:
            drifted_surfaces.append(name)
    ok = not drifted_surfaces
    return {
        "ok": ok,
        "drifted": bool(drifted_surfaces),
        "drifted_surfaces": drifted_surfaces,
        "n_surfaces": len(surfaces),
        "detail": detail,
        "witness_rerun_required": bool(drifted_surfaces),
        "note": (
            "all instrument-surface SHAs match between green and read-day"
            if ok
            else (
                "instrument-surface SHA drift detected — the witness pair (IyF enum "
                "REJECT + R5L890-FUSED conflation REJECT) MUST be re-run before the "
                "seal breaks (ratify-packet item 11)"
            )
        ),
    }


def _thread_iyf_witness(
    driver: SealedReadDriver,
    out_dir: str,
    mode: str,
    validity_inputs: dict,
    spies: tuple[Callable, Callable, Callable],
) -> dict:
    """IyF re-promotion witness through the COMPLETE A->E pipeline (it is a REAL
    spent video). Asserts conflation axis ISOLATED (PASS) + enum axis REJECT +
    reaches the verdict not-clean."""
    extract_spy, panel_spy, rater_spy = spies
    manifest = _write_spent_rehearsal_manifest(
        os.path.join(out_dir, "iyf-witness-manifest.json"), [IYF_WITNESS_VIDEO]
    )
    res = driver.run_verdict(
        manifest,
        mode=mode,
        out_dir=os.path.join(out_dir, "iyf-witness"),
        live_extract_fn=extract_spy,
        live_panel_fn=panel_spy,
        rater_fn=rater_spy,
        **validity_inputs,
    )
    cert = next(
        (r for r in (res["panels"] or {}).get("certificates", []) if r["cid"] == IYF_WITNESS_CID),
        None,
    )
    disp = (cert or {}).get("terminal_read_disposition") or {}
    video_entry = next(
        (
            e
            for e in ((res["verdict"] or {}).get("video_unit") or {}).get("per_video", [])
            if e["video_id"] == IYF_WITNESS_VIDEO
        ),
        None,
    )
    return {
        "witness": "IyF re-promotion (variant re-promotion of an enumeration-EXCLUDED mention)",
        "axis": "enumeration_consistency",
        "path": "full A->E (real spent video through the composed driver)",
        "cid": IYF_WITNESS_CID,
        "conflation_disposition": disp.get("conflation_check"),
        "enum_disposition": disp.get("enumeration_consistency"),
        "terminal_read_grade": (cert or {}).get("terminal_read_grade"),
        "reached_verdict": (res["verdict"] or {}).get("module") == "E",
        "video_clean_at_verdict": (video_entry or {}).get("clean"),
        "rejected_on_axis": (
            disp.get("conflation_check") == "PASS"
            and disp.get("enumeration_consistency") == "FAIL"
            and (cert or {}).get("terminal_read_grade") == "REJECTED"
        ),
        "reached_verdict_not_clean": (video_entry or {}).get("clean") is False,
    }


def _thread_fused_witness(
    driver: SealedReadDriver,
    out_dir: str,
    mode: str,
    instrument_stamps: dict,
    spies: tuple[Callable, Callable, Callable],
) -> dict:
    """R5L890-FUSED merge-silencing witness through C->D->E (SYNTHETIC adversarial:
    enters at Module B's on-disk artifact, as the reference harness threads it).
    Asserts conflation axis REJECT + reaches the verdict not-clean."""
    _extract_spy, panel_spy, rater_spy = spies
    fixture_path = os.path.join(
        driver.panel_cache_dir, _CONFLATION_FIXTURES_SUBDIR, FUSED_FIXTURE_BASENAME
    )
    with open(fixture_path, encoding="utf-8") as fh:
        fused_strategy = json.load(fh)["strategies"][0]
    ext_path = _write_witness_extraction_artifact(
        os.path.join(out_dir, "fused-witness"), FUSED_WITNESS_CID, FUSED_WITNESS_CID, fused_strategy
    )
    extraction = {"ready": True, "artifact_paths": [ext_path]}
    # Module C -> D -> E on the REAL stage functions (no gate/extraction stage: the
    # fixture is not a pool video, so it enters at B's output — same path the
    # reference harness uses to thread this adversarial).
    panels = run_panels_and_certify_stage(
        extraction, mode=mode, cache_dir=driver.panel_cache_dir, live_panel_fn=panel_spy
    )
    rater = run_rater_layer_stage(
        panels,
        mode=mode,
        cache_dir=driver.panel_cache_dir,
        extraction_result=extraction,
        rater_fn=rater_spy if mode == "sealed" else None,
    )
    verdict = run_verdict_stage(rater, instrument_stamps, mode)
    cert = panels["certificates"][0]
    disp = cert["terminal_read_disposition"]
    video_entry = next(
        (
            e
            for e in verdict["video_unit"]["per_video"]
            if e["video_id"] == FUSED_WITNESS_CID
        ),
        None,
    )
    return {
        "witness": "R5L890-FUSED (merge-silencing: two distinct trades fused into one)",
        "axis": "conflation",
        "path": "C->D->E (synthetic adversarial entering at Module B's on-disk artifact)",
        "cid": FUSED_WITNESS_CID,
        "conflation_disposition": disp["conflation_check"],
        "terminal_read_grade": cert["terminal_read_grade"],
        "reached_verdict": verdict.get("module") == "E",
        "video_clean_at_verdict": (video_entry or {}).get("clean"),
        "rejected_on_axis": (
            disp["conflation_check"] == "REJECT" and cert["terminal_read_grade"] == "REJECTED"
        ),
        "reached_verdict_not_clean": (video_entry or {}).get("clean") is False,
    }


def run_full_dress_rehearsal(
    rehearsal_manifest: str,
    mode: str = "rehearsal",
    *,
    out_dir: str | None = None,
    driver: SealedReadDriver | None = None,
    validity_inputs: dict | None = None,
    driver_commit: str = "rehearsal-driver-commit",
    frozen_scan_commit: str = "rehearsal-frozen-scan-commit",
    epoch: object = "rehearsal-epoch-0",
) -> dict:
    """MODULE F — the FULL-DRESS REHEARSAL capstone (ratify-packet items 7/10/11).

    Drives the COMPLETE driver A->E (gate -> extraction -> panels+cert -> raters ->
    verdict) on the 3 spent design-pool videos in staging/rehearsal mode (no
    SEAL-GO.token, deterministic raters, cached panels, NO live LLM / network), then
    runs the three capstone guards: the R-017 pin-2 BOTH-WITNESSES-BOTH-AXES pair
    through the pipeline, the rollup-on-mixed-video demonstration (constructed from
    the spent certs), the item-7 independent re-verify, and the item-11 drift guard.

    ``rehearsal_manifest``: path to a SPENT-video manifest listing exactly the 3
    design-pool videos (Module A's staging gate accepts it; a sealed-12 manifest is
    refused by construction). ``mode`` is ``"rehearsal"`` (or ``"staging"``).

    Returns a report dict carrying: the per-stage EXERCISED receipts; the full
    rehearsal verdict (video-unit fraction, meets_bar, economics, validity, scope
    lines); both witness dispositions; the mixed-video rollup; the re-verify match;
    the drift-guard result (both polarities); ``failures`` + ``rehearsal_pass``.
    Deterministic; the injected live seams are threaded as spies that MUST NOT fire.
    """
    if mode not in _REHEARSAL_MODES:
        raise ValueError(
            f"full-dress rehearsal runs in a rehearsal/staging mode only, got {mode!r} "
            "(the sealed read is never a rehearsal)"
        )
    owns_tmp = out_dir is None
    out_dir = out_dir or tempfile.mkdtemp(prefix="h1-dress-rehearsal-")
    driver = driver or SealedReadDriver()
    if validity_inputs is None:
        validity_inputs = {
            "registration_pre_check": {
                "ok": True,
                "n_registered": len(REHEARSAL_SPENT_VIDEOS),
                "rehearsal": True,
            },
            "engagement_pre_check": {"ok": True, "rehearsal": True},
            "frozen_scan_commit": frozen_scan_commit,
            "driver_commit": driver_commit,
            "epoch": epoch,
        }

    counters, extract_spy, panel_spy, rater_spy = _make_live_call_spies()
    spies = (extract_spy, panel_spy, rater_spy)
    failures: list[str] = []

    # ------------------------------------------------------------------ #
    # 1. PRIMARY FULL-DRESS RUN: the COMPLETE A->E over the 3 spent videos.
    # ------------------------------------------------------------------ #
    composed = driver.run_verdict(
        rehearsal_manifest,
        mode=mode,
        out_dir=os.path.join(out_dir, "primary"),
        live_extract_fn=extract_spy,
        live_panel_fn=panel_spy,
        rater_fn=rater_spy,
        **validity_inputs,
    )
    if not composed.get("ok"):
        raise RehearsalManifestMismatch(
            f"rehearsal gate refused the manifest: {composed.get('halt_reason')!r} "
            "(the capstone drives A->E on the 3 spent design-pool videos)"
        )
    verified_ids = set(
        (((composed.get("gate") or {}).get("record") or {}).get("verify") or {}).get("video_ids") or []
    )
    if verified_ids != set(REHEARSAL_SPENT_VIDEOS):
        raise RehearsalManifestMismatch(
            f"rehearsal manifest videos {sorted(verified_ids)} != the 3 spent "
            f"design-pool videos {sorted(REHEARSAL_SPENT_VIDEOS)}"
        )

    receipts = _stage_receipts(composed)
    if not receipts["all_exercised"]:
        missing = [s for s in _PIPELINE_STAGES if not receipts[s]["exercised"]]
        failures.append(f"STAGE: not every pipeline stage exercised (missing={missing})")

    verdict = composed["verdict"]
    if not (verdict.get("validity") or {}).get("valid"):
        failures.append("VERDICT: validity block INVALID in the rehearsal (seal-day inputs missing)")
    if verdict.get("verdict") not in ("FIDELITY_PASS", "FIDELITY_MISS"):
        failures.append(f"VERDICT: unexpected top-line verdict {verdict.get('verdict')!r}")

    # Assemble the validity-block instrument_stamps ONCE from the composed result +
    # the injected seal-day inputs; reused for the FUSED witness + mixed rollup.
    instrument_stamps = _assemble_instrument_stamps(composed, **validity_inputs)

    # ------------------------------------------------------------------ #
    # 2. ★ BOTH WITNESSES BOTH AXES through the pipeline (R-017 pin-2).
    # ------------------------------------------------------------------ #
    iyf = _thread_iyf_witness(driver, out_dir, mode, validity_inputs, spies)
    if not (iyf["rejected_on_axis"] and iyf["reached_verdict_not_clean"]):
        failures.append(
            "WITNESS(IyF): enum-axis REJECT did not reach the verdict not-clean "
            f"(enum_disposition={iyf['enum_disposition']!r}, "
            f"grade={iyf['terminal_read_grade']!r}, clean={iyf['video_clean_at_verdict']!r})"
        )
    fused = _thread_fused_witness(driver, out_dir, mode, instrument_stamps, spies)
    if not (fused["rejected_on_axis"] and fused["reached_verdict_not_clean"]):
        failures.append(
            "WITNESS(FUSED): conflation-axis REJECT did not reach the verdict not-clean "
            f"(conflation_disposition={fused['conflation_disposition']!r}, "
            f"grade={fused['terminal_read_grade']!r}, clean={fused['video_clean_at_verdict']!r})"
        )

    # ------------------------------------------------------------------ #
    # 3. ★ ROLLUP-ON-MIXED-VIDEO end-to-end, CONSTRUCTED FROM THE SPENT CERTS:
    #    a real spent CLEAN Module-D cert + the real IyF REJECTED Module-D cert
    #    under ONE video -> rolls up CLEAN (the >=1 rule) through run_verdict_stage.
    # ------------------------------------------------------------------ #
    spent_clean_row = next(
        (
            r
            for rows in (composed["rater_layer"]["per_video_rater_verdicts"]).values()
            for r in rows
            if _row_is_clean(r)
        ),
        None,
    )
    iyf_rejected_row = next(
        iter(_iyf_rejected_rows(driver, out_dir, mode, validity_inputs, spies)), None
    )
    mixed_video_id = "MIXED_ONE_CLEAN_REHEARSAL"
    mixed_report: dict
    if spent_clean_row is None or iyf_rejected_row is None:
        failures.append("MIXED: could not source a real CLEAN + a real REJECTED spent cert")
        mixed_report = {"available": False}
    else:
        mixed_per_video = {mixed_video_id: [spent_clean_row, iyf_rejected_row]}
        mixed_verdict = run_verdict_stage(_module_d_stage(mixed_per_video, mode), instrument_stamps, mode)
        entry = next(
            e for e in mixed_verdict["video_unit"]["per_video"] if e["video_id"] == mixed_video_id
        )
        mixed_report = {
            "available": True,
            "video_id": mixed_video_id,
            "n_strategies": entry["n_strategies"],
            "n_clean_strategies": entry["n_clean_strategies"],
            "rolls_up_clean": entry["clean"] is True,
            "rule": mixed_verdict["video_unit"]["rule"],
            "source": (
                "1 real spent CLEAN Module-D cert + 1 real IyF REJECTED Module-D cert "
                "(constructed from spent certs; >=2 strategies, exactly one clean)"
            ),
        }
        if not (entry["clean"] is True and entry["n_strategies"] == 2 and entry["n_clean_strategies"] == 1):
            failures.append(
                "MIXED: exactly-one-clean video did NOT roll up CLEAN via the >=1 rule "
                f"(n_strategies={entry['n_strategies']}, n_clean={entry['n_clean_strategies']}, "
                f"clean={entry['clean']})"
            )

    # ------------------------------------------------------------------ #
    # 4. INDEPENDENT RE-VERIFY (item 7): a full REPLAY of A->E (determinism) +
    #    an INDEPENDENT recompute of the video-unit fraction / >=60% bar from the
    #    primary verdict's OWN per-video rows (fresh-eyes, not re-calling E).
    # ------------------------------------------------------------------ #
    replay = driver.run_verdict(
        rehearsal_manifest,
        mode=mode,
        out_dir=os.path.join(out_dir, "replay"),
        live_extract_fn=extract_spy,
        live_panel_fn=panel_spy,
        rater_fn=rater_spy,
        **validity_inputs,
    )
    replay_vu = replay["verdict"]["video_unit"]
    primary_vu = verdict["video_unit"]
    replay_match = (
        replay_vu["video_clean_fraction"] == primary_vu["video_clean_fraction"]
        and replay["verdict"]["meets_bar"] == verdict["meets_bar"]
        and _per_video_clean_map(replay) == _per_video_clean_map(composed)
    )
    pv_rows = primary_vu["per_video"]
    recomputed_clean = sum(1 for e in pv_rows if e["clean"])
    recomputed_fraction = round(recomputed_clean / len(pv_rows), 4) if pv_rows else None
    recomputed_meets = bool(recomputed_fraction is not None and recomputed_fraction >= VIDEO_CLEAN_BAR)
    independent_match = (
        recomputed_fraction == primary_vu["video_clean_fraction"]
        and recomputed_meets == verdict["measured_meets_bar"]
    )
    reverify = {
        "replay_match": replay_match,
        "independent_recompute_match": independent_match,
        "recomputed_video_clean_fraction": recomputed_fraction,
        "recomputed_meets_bar": recomputed_meets,
        "primary_video_clean_fraction": primary_vu["video_clean_fraction"],
        "ok": bool(replay_match and independent_match),
        "note": "0.5-exam fresh-eyes: replay A->E (determinism) + independent recompute from persisted per-video rows",
    }
    if not reverify["ok"]:
        failures.append(
            "RE-VERIFY: recompute-from-artifacts did NOT match the first verdict "
            f"(replay_match={replay_match}, independent_match={independent_match})"
        )

    # ------------------------------------------------------------------ #
    # 5. DRIFT GUARD (item 11): green==read-day is OK; a changed instrument SHA
    #    flags drift (negative probe proves the guard is non-vacuous).
    # ------------------------------------------------------------------ #
    shas = rehearsal_instrument_shas(
        driver_commit=validity_inputs["driver_commit"],
        frozen_scan_commit=validity_inputs["frozen_scan_commit"],
    )
    drift_green = rehearsal_drift_guard(shas, shas)
    mutated = dict(shas)
    mutated["frontier_prompt_sha"] = "DRIFTED-" + str(mutated.get("frontier_prompt_sha"))
    drift_negative = rehearsal_drift_guard(shas, mutated)
    drift = {
        "pinned_surfaces": sorted(shas),
        "green_vs_read_day_identical": drift_green,
        "negative_probe_changed_sha": drift_negative,
        "ok": bool(drift_green["ok"] and drift_negative["drifted"] and not drift_negative["ok"]),
    }
    if not drift["ok"]:
        failures.append("DRIFT-GUARD: guard did not behave in both polarities (vacuous)")

    # ------------------------------------------------------------------ #
    # 6. NO LIVE CALL (test (g)): the spies must never have fired.
    # ------------------------------------------------------------------ #
    live_call_guard = {
        "live_extract_calls": counters["live_extract"],
        "live_panel_calls": counters["live_panel"],
        "rater_calls": counters["rater"],
        "violations": counters["violations"],
        "no_live_call": not counters["violations"],
    }
    if counters["violations"]:
        failures.append(f"LIVE-CALL: a live seam fired in the rehearsal ({counters['violations']})")

    report = {
        "artifact": "h1-sealed12-driver-full-dress-rehearsal",
        "module": "F",
        "packet": "h1-sealed12-driver-ratify-packet-2026-07-16 (items 7/10/11)",
        "mode": mode,
        "out_dir": out_dir,
        "spent_videos": list(REHEARSAL_SPENT_VIDEOS),
        "harness": "SealedReadDriver.run_verdict (REAL A->E; supersedes fence-only run_dress_rehearsal.py)",
        "stage_receipts": receipts,
        "verdict": {
            "verdict": verdict["verdict"],
            "meets_bar": verdict["meets_bar"],
            "video_unit": verdict["video_unit"],
            "economics": verdict["economics"],
            "validity_valid": (verdict.get("validity") or {}).get("valid"),
            "scope_lines": verdict["scope_lines"],
        },
        "witnesses": {"iyf_enum_axis": iyf, "fused_conflation_axis": fused},
        "mixed_video_rollup": mixed_report,
        "independent_reverify": reverify,
        "drift_guard": drift,
        "live_call_guard": live_call_guard,
        "failures": failures,
        "rehearsal_pass": not failures,
        "owns_tmp_out_dir": owns_tmp,
    }
    return report


def _iyf_rejected_rows(
    driver: SealedReadDriver,
    out_dir: str,
    mode: str,
    validity_inputs: dict,
    spies: tuple[Callable, Callable, Callable],
) -> list[dict]:
    """The REAL IyF REJECTED Module-D rows (enum FAIL) sourced from a full A->E run
    on the IyF witness video — the REJECTED half of the constructed mixed video."""
    extract_spy, panel_spy, rater_spy = spies
    manifest = _write_spent_rehearsal_manifest(
        os.path.join(out_dir, "iyf-mixed-source-manifest.json"), [IYF_WITNESS_VIDEO]
    )
    res = driver.run_verdict(
        manifest,
        mode=mode,
        out_dir=os.path.join(out_dir, "iyf-mixed-source"),
        live_extract_fn=extract_spy,
        live_panel_fn=panel_spy,
        rater_fn=rater_spy,
        **validity_inputs,
    )
    rows = (res["rater_layer"]["per_video_rater_verdicts"]).get(IYF_WITNESS_VIDEO, [])
    return [r for r in rows if not _row_is_clean(r)]
