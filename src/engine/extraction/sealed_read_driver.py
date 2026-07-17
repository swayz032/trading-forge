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
    gpt-5.4 vault additionally carries the raw ``counts``/``mode``/``mode_n``).

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
import json
import os
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
      * frontier gpt-5.4 vault: ``{"counts":[...], "mode":M, "mode_n":N,
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
            _atomic_write(path, artifact)
            record = artifact
        else:  # sealed
            raw = live_extract_fn(video_id, manifest_verified)  # REAL spend seam
            record, persist_payload = _wrap_live_artifact(
                video_id, raw, mode, adjudicate_fn, k, stability_min
            )
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
    }


# --------------------------------------------------------------------------- #
# Orchestration entry — Module A gate FIRST, then the extraction stage.
# (Modules C-F append downstream; this leaves clean seams and builds no
# panel / rater / verdict here.)
# --------------------------------------------------------------------------- #


class SealedReadDriver:
    """Thin orchestration entry composing Module A's ``gate_sealed_read`` ->
    :func:`run_extraction_stage`. The extraction stage is structurally
    UNREACHABLE unless the seal gate ALLOWED the read: :meth:`run` returns
    early (``ok=False``, ``extraction=None``) on any gate refusal, so no cached
    load and no ``live_extract_fn`` call can happen without a gate pass."""

    def __init__(
        self,
        cache_dir: str = DEFAULT_CACHE_ROOT,
        staging_dir: str | None = None,
        phase_a_vault_dir: str | None = None,
        adjudicate_fn: Callable[[str, dict], dict] | None = None,
    ):
        self.cache_dir = cache_dir
        self.staging_dir = staging_dir or DEFAULT_STAGING_DIR
        self.phase_a_vault_dir = phase_a_vault_dir or DEFAULT_PHASE_A_VAULT_DIR
        self.adjudicate_fn = adjudicate_fn or _default_adjudicate

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
