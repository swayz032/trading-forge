#!/usr/bin/env python
"""H1 SEALED-12 TERMINAL-READ — CONDUCTOR CLI (the runbook's invocation).

Spec: docs/designs/h1-sealed12-conductor-runbook-2026-07-17.md (STEP 1/2/3/5) +
ADVISOR-RULINGS R-023.1.  This is a THIN PROCESS WRAPPER around the ALREADY-BUILT
driver (``src/engine/extraction/sealed_read_driver.py``, Modules A-F committed at
d8c44f98).  It adds NO fidelity brains — it invokes the built driver and, for the
sealed path, marshals the conductor's on-disk artifacts into the driver's sealed
seams.  Every fidelity decision (packet build, panels, verdict, re-verify) is the
DRIVER's; the CLI only runs the process and prints the driver's verdict verbatim.

TWO MODES (runbook STEP 1):

  ``--mode staging`` — the runbook REHEARSAL.  Runs the driver's built
  :func:`run_full_dress_rehearsal` on the 3 spent design-pool videos
  (deterministic, cached, NO live LLM/network) and prints the driver's verdict
  block verbatim (verdict / video-unit clean fraction / meets_bar / economics /
  validity / scope lines / both witness dispositions / rehearsal_pass).  Exit 0
  iff the driver reports ``rehearsal_pass`` True.

  ``--mode sealed`` — the token-gated seal-day path.  STEP 0: the CLI itself
  verifies ``docs/designs/SEAL-GO.token`` exists + is non-empty (it NEVER creates
  it).  Then it pins the sealed-12 manifest by READING it from disk (no hardcoded
  sha/ids), and drives the built :meth:`SealedReadDriver.run_verdict` in
  ``mode="sealed"`` — Module A ``gate_sealed_read`` rejects the spent-16 manifest,
  and the PER-DRAW / PER-STRATEGY extraction (R-024.1: five blind Phase-A draws +
  one Phase-B dispatch per consensus strategy) / panel / rater seams are wired to
  THIN READERS of the conductor-written files under ``--work-dir`` (each carrying
  the conductor's dispatch_record so the driver's identity/channel guards assert
  PER DISPATCH).  A missing required conductor artifact => HALT (never fabricated).
  The verdict is printed verbatim, or the HALT is.

NOTHING in this file hardcodes a sealed sha / model id / prompt sha / video id —
the sealed-12 manifest basename comes from the gate module's own filename
constant, the pinned reader identity is resolved by the driver from frozen files,
and the verdict values are echoed straight from the driver's result dict.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import tempfile

# Repo root = parent of this scripts/ dir. Put it on sys.path so `src...` imports
# resolve when the CLI is invoked as `python scripts/h1_seal_conductor_cli.py`.
_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from src.engine.extraction.pilot_conveyor import (  # noqa: E402
    LeakScanFailure,
)
from src.engine.extraction.sealed_read_driver import (  # noqa: E402
    ENUMERATOR_PROMPT_PATH,
    FRONTIER_PROMPT_PATH,
    READABLE_N_FLOOR,
    REHEARSAL_SPENT_VIDEOS,
    ReaderIdentityMismatch,
    SealedReadDriver,
    _write_spent_rehearsal_manifest,
    build_panel_requests,
    build_rater_packets,
    certified_reader_identity,
    classify_source_attrition,
    compute_phase_a_consensus,
    run_extraction_stage,
    run_full_dress_rehearsal,
)
from src.engine.extraction.sealed_read_gate import (  # noqa: E402
    DEFAULT_TOKEN_PATH,
    SEALED_12_MANIFEST_BASENAME,
    SpentManifestRejected,
    gate_sealed_read,
)

#: Frozen sealed-12 manifest, pinned by its module-owned basename (a filename, not
#: a load-bearing sha/id — R-016 compliant). READ from disk at runtime.
PINNED_SEALED12_MANIFEST = os.path.join(_ROOT, "docs", "designs", SEALED_12_MANIFEST_BASENAME)
#: Operator go-token (Tonio authors it in his own words; the CLI NEVER creates it).
PINNED_TOKEN_PATH = os.path.join(_ROOT, DEFAULT_TOKEN_PATH)

_NO_TOKEN_HALT = "HALT: no SEAL-GO.token — sealed read not authorized"


class ConductorArtifactMissing(RuntimeError):
    """Raised (fail-closed HALT) when a REQUIRED conductor-written artifact is not
    present under ``--work-dir`` on the sealed path. The CLI NEVER fabricates a
    missing extraction / panel / rater artifact — a missing input HALTs."""


class RawJsonNonCompliant(ValueError):
    """Raised (fail-closed) when a ``claude -p`` RAW extraction is NOT a single clean
    JSON value — substantial prose before/after the JSON, an ambiguous / EXAMPLE-
    bearing output, or truly-malformed. A ``ValueError`` subclass so any existing
    ``except ValueError`` caller still fails closed. DISTINCT from a guard HALT: it
    signals 'the model did not emit strict-parseable JSON for THIS dispatch', so the
    conductor STOPS and reports (NO auto-retry — the read-once / retry policy is the
    advisor's call, never the CLI's)."""


# --------------------------------------------------------------------------- #
# Verbatim verdict-block formatter (echoes the DRIVER's values — no computation).
# --------------------------------------------------------------------------- #


def _validity_valid(verdict: dict) -> object:
    """Read the validity flag from EITHER the sealed ``run_verdict_stage`` shape
    (``verdict['validity']['valid']``) OR the staging rehearsal-report shape
    (``verdict['validity_valid']``)."""
    if isinstance(verdict.get("validity"), dict):
        return verdict["validity"].get("valid")
    return verdict.get("validity_valid")


def format_verdict_block(
    verdict: dict,
    mode: str,
    *,
    witnesses: dict | None = None,
    rehearsal_pass: object | None = None,
) -> str:
    """Render the driver's verdict dict as a verbatim text block. All values are
    ECHOED from the driver result — the CLI computes no fidelity number here."""
    vu = verdict.get("video_unit") or {}
    econ = verdict.get("economics") or {}
    valid = _validity_valid(verdict)
    lines: list[str] = []
    lines.append(f"=== H1 SEALED-12 TERMINAL-READ VERDICT (mode={mode}) ===")
    lines.append(f"verdict: {verdict.get('verdict')}")
    lines.append(
        "video_unit_clean_fraction: {frac}  (clean_videos={cv} / n_videos={nv}, "
        "bar>={bar})".format(
            frac=vu.get("video_clean_fraction"),
            cv=vu.get("clean_videos"),
            nv=vu.get("n_videos"),
            bar=vu.get("bar"),
        )
    )
    lines.append(f"meets_bar: {verdict.get('meets_bar')}")
    lines.append(
        "economics: mean_per_video_aggregate_adjudications={mean}  ceiling={ceil}  "
        "ceiling_flag={flag}".format(
            mean=econ.get("mean_per_video_aggregate_adjudications"),
            ceil=econ.get("ceiling"),
            flag=econ.get("ceiling_flag"),
        )
    )
    lines.append(f"validity: {'VALID' if valid else 'INVALID'}")
    lines.append("scope:")
    for s in verdict.get("scope_lines") or []:
        lines.append(f"  - {s}")

    if witnesses is not None:
        iyf = witnesses.get("iyf_enum_axis") or {}
        fused = witnesses.get("fused_conflation_axis") or {}
        lines.append(
            "witness[IyF enumeration_consistency]: "
            "enum_disposition={ed} conflation_disposition={cd} "
            "terminal_read_grade={g} rejected_on_axis={ra} "
            "reached_verdict_not_clean={nc}".format(
                ed=iyf.get("enum_disposition"),
                cd=iyf.get("conflation_disposition"),
                g=iyf.get("terminal_read_grade"),
                ra=iyf.get("rejected_on_axis"),
                nc=iyf.get("reached_verdict_not_clean"),
            )
        )
        lines.append(
            "witness[R5L890-FUSED conflation]: "
            "conflation_disposition={cd} terminal_read_grade={g} "
            "rejected_on_axis={ra} reached_verdict_not_clean={nc}".format(
                cd=fused.get("conflation_disposition"),
                g=fused.get("terminal_read_grade"),
                ra=fused.get("rejected_on_axis"),
                nc=fused.get("reached_verdict_not_clean"),
            )
        )
    if rehearsal_pass is not None:
        lines.append(f"rehearsal_pass: {rehearsal_pass}")
    lines.append("=== END VERDICT ===")
    return "\n".join(lines)


# --------------------------------------------------------------------------- #
# STAGING (runbook rehearsal) — invoke the built full-dress rehearsal capstone.
# --------------------------------------------------------------------------- #


def run_staging(out_dir: str | None = None) -> tuple[int, str]:
    """Run the driver's ``run_full_dress_rehearsal`` on the 3 spent design-pool
    videos and return ``(exit_code, verdict_block_text)``. Exit 0 iff the driver
    reports ``rehearsal_pass`` True. Deterministic; no live call."""
    owns_tmp = out_dir is None
    out_dir = out_dir or tempfile.mkdtemp(prefix="h1-seal-conductor-staging-")
    manifest = _write_spent_rehearsal_manifest(
        os.path.join(out_dir, "spent-rehearsal-manifest.json"), list(REHEARSAL_SPENT_VIDEOS)
    )
    report = run_full_dress_rehearsal(
        manifest, mode="staging", out_dir=os.path.join(out_dir, "rehearsal")
    )
    rehearsal_pass = report.get("rehearsal_pass")
    text = format_verdict_block(
        report["verdict"],
        mode="staging",
        witnesses=report.get("witnesses"),
        rehearsal_pass=rehearsal_pass,
    )
    if not rehearsal_pass:
        text += "\nfailures:\n" + "\n".join(f"  - {f}" for f in report.get("failures") or [])
    if owns_tmp:
        text += f"\n(out_dir={out_dir})"
    return (0 if rehearsal_pass else 1), text


# --------------------------------------------------------------------------- #
# SEALED — conductor-artifact readers wired into the built driver's live seams.
# --------------------------------------------------------------------------- #


def _load_dispatch_record(work_dir: str) -> dict:
    """Read the conductor's dispatch record (STEP 2) — the ONE
    ``{requested_model, resolved_model, channel_class, dispatch_mode}`` the driver
    asserts against the pinned identity. Missing => HALT."""
    path = os.path.join(work_dir, "dispatch_record.json")
    if not os.path.exists(path):
        raise ConductorArtifactMissing(
            f"missing conductor dispatch_record (STEP 2): {path} — the driver's "
            "channel-class + model-resolution guard cannot assert without it"
        )
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def _load_dispatch_record_optional(work_dir: str):
    """The conductor's whole-run dispatch record if present, else None. Used by the
    WRAP step to EMBED the dispatch_record into each wrapped artifact (so a wrapped
    draw is self-describing); the per-dispatch identity guard still falls back to the
    whole-run record at ingestion if a given artifact omits it."""
    path = os.path.join(work_dir, "dispatch_record.json")
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def _load_raw_json(raw_path: str) -> dict:
    """Parse a `claude -p`-captured RAW extraction file to a dict, FAIL-CLOSED.

    The model is instructed to print ONLY the JSON object. This parser tolerates an
    OPTIONAL surrounding ```` ```json ```` code fence + whitespace and NOTHING more:
    after fence-stripping, the remaining raw MUST be a SINGLE JSON value whose
    surrounding content is whitespace-only. It uses ``json.JSONDecoder().raw_decode``
    and REQUIRES that (a) the value begins at the very start (only whitespace / an
    optional fence before it) and (b) only whitespace follows it.

    This is the fix for the CRITICAL silent-mis-parse: the old first-``{``…last-``}``
    slice would SILENTLY return a schema EXAMPLE the model printed while explaining
    ("For example the format looks like {…}. Now I will re-read the transcript…")
    when the real answer was truncated/missing. Such a prose-wrapped / ambiguous /
    example-bearing output is now REFUSED — it NEVER silently returns a non-answer
    JSON. Raises :class:`RawJsonNonCompliant` (a ``ValueError`` subclass) on any
    prose-wrapped / ambiguous / malformed raw, or a non-object JSON value."""
    with open(raw_path, encoding="utf-8") as fh:
        text = fh.read()
    stripped = text.strip()
    if stripped.startswith("```"):
        # Strip a SINGLE opening fence line (``` or ```json) + a closing fence line
        # (a tiny, whitespace-equivalent budget) — fence-tolerance, NOT prose-tolerance.
        lines = stripped.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip().startswith("```"):
            lines = lines[:-1]
        stripped = "\n".join(lines).strip()
    if not stripped:
        raise RawJsonNonCompliant("raw extraction is empty (no JSON object)")
    if stripped[0] not in "{[":
        # Substantial non-whitespace PROSE before the JSON (e.g. a "For example…"
        # preamble) — REFUSE; never scan forward to the first `{`.
        raise RawJsonNonCompliant(
            "raw extraction does not begin with a JSON value — substantial "
            f"preamble/prose before the JSON ({stripped[:60]!r}…); the model must "
            "print ONLY the JSON object"
        )
    try:
        parsed, end = json.JSONDecoder().raw_decode(stripped)
    except ValueError as exc:
        raise RawJsonNonCompliant(f"raw extraction is not parseable JSON: {exc}") from None
    trailing = stripped[end:]
    if trailing.strip():
        # A well-formed JSON value FOLLOWED by prose (e.g. an example object then
        # "Now I will re-read the transcript…") — REFUSE; never accept the leading
        # span as the answer.
        raise RawJsonNonCompliant(
            "raw extraction has substantial non-whitespace content AFTER the JSON "
            f"value ({trailing.strip()[:60]!r}…) — a prose-wrapped / example-bearing "
            "output is REFUSED, never silently sliced to the first {…} span"
        )
    if not isinstance(parsed, dict):
        raise RawJsonNonCompliant("raw extraction is not a JSON object")
    return parsed


def _wrap_dispatch_raw(
    work_dir: str, seam: str, raw_path: str, video_id: str, index: int
) -> tuple[int, str]:
    """R-028.4 finding #3 — the RAW->DRAW wrap. The conductor's per-dispatch job is
    ``claude -p`` -> RAW model stdout + a dispatch_record; the CLI (here) wraps that
    raw into the artifact the EXISTING ingestion (`_make_conductor_phase_a_draw_fn` /
    `_make_conductor_phase_b_fn` + `_assert_one_dispatch`) already reads UNCHANGED:

      * ``reader_identity`` is ADDED from ``certified_reader_identity()`` (the frozen
        record — identity is NEVER a model self-report / conductor literal);
      * ``dispatch_record`` is EMBEDDED from the conductor's ``dispatch_record.json``;
      * Phase-A ``count`` is SYNTHESIZED as ``len(strategies)`` and ``strategy_refs``
        as one deterministic ref per enumerated strategy.

    The raw fields (``strategies`` / ``enumeration_note`` / ``instrument_classifi-
    cation`` / …) are carried through verbatim. Writes the canonical
    ``phase_a/<vid>/draw_<i>.json`` or ``phase_b/<vid>__s<idx>.json``. HALTs (never
    fabricates) on a missing/unparseable raw or a raw missing its ``strategies``
    list."""
    if not os.path.exists(raw_path):
        return 1, f"HALT: --raw extraction file not found: {raw_path}"
    try:
        raw = _load_raw_json(raw_path)
    except RawJsonNonCompliant as exc:
        # DISTINCT HALT class: the model didn't emit clean JSON for THIS dispatch —
        # NOT an artifact-guard HALT. Read-once: NOT auto-retried; the conductor
        # STOPS and reports per the runbook (a retry/prompt policy is the advisor's).
        return 1, (
            f"HALT: --raw is NON-COMPLIANT (model did not emit clean JSON for this "
            f"dispatch: {seam} {video_id} #{index}) ({raw_path}): {exc}"
        )
    except ValueError as exc:
        return 1, f"HALT: --raw is not parseable JSON ({raw_path}): {exc}"
    strategies = raw.get("strategies")
    if not isinstance(strategies, list):
        return 1, (
            f"HALT: raw extraction {raw_path} has no `strategies` list — cannot wrap "
            "(the model must emit the raw extraction schema)"
        )
    identity = certified_reader_identity()
    dispatch_record = _load_dispatch_record_optional(work_dir)
    if seam == "phase_a":
        wrapped = {
            **raw,
            "count": len(strategies),
            "strategy_refs": [f"{video_id}__s{j}" for j in range(len(strategies))],
            "reader_identity": identity,
        }
        out_path = os.path.join(work_dir, "phase_a", video_id, f"draw_{index}.json")
    else:  # phase_b
        wrapped = {**raw, "reader_identity": identity}
        out_path = os.path.join(work_dir, "phase_b", f"{video_id}__s{index}.json")
    if dispatch_record is not None:
        wrapped["dispatch_record"] = dispatch_record
    _atomic_write_text(
        out_path, json.dumps(wrapped, ensure_ascii=False, sort_keys=True, indent=2)
    )
    return 0, f"WRAP {seam} ok: {raw_path} -> {out_path} (count={len(strategies)})"


def _load_validity_inputs(work_dir: str) -> dict:
    """Read the seal-day validity inputs (registration/engagement pre-checks,
    frozen-scan/driver commits, read-once epoch) the driver threads into Module E's
    VALIDITY block. Absent => empty (the driver then fails the block closed to
    INVALID — correct fail-closed behavior, not a CLI-invented pass)."""
    path = os.path.join(work_dir, "validity_inputs.json")
    if not os.path.exists(path):
        return {}
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def _make_conductor_phase_a_draw_fn(work_dir: str):
    """Thin reader for the PER-DRAW Phase-A seam (STEP 2 / R-024.1): for draw N of 5
    of a video, return the conductor's blind enumeration-draw artifact (carrying its
    self-reported ``reader_identity`` + ``dispatch_record`` + ``count`` /
    ``strategy_refs``). Each draw is a SEPARATE fresh blind subagent, written to
    ``phase_a/<video_id>/draw_<N>.json``. The DRIVER (not the conductor) combines the
    five draws into the consensus + stability. Missing => HALT (never fabricated)."""
    pa_dir = os.path.join(work_dir, "phase_a")

    def fn(video_id: str, draw_index: int, _manifest_verified: dict):
        path = os.path.join(pa_dir, video_id, f"draw_{draw_index}.json")
        if not os.path.exists(path):
            raise ConductorArtifactMissing(
                f"missing conductor Phase-A draw {draw_index} for video_id={video_id!r}: {path}"
            )
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)

    return fn


def _make_conductor_phase_b_fn(work_dir: str):
    """Thin reader for the PER-STRATEGY Phase-B seam (STEP 2 / R-024.1): for each
    consensus strategy, return the conductor's single-draw extraction artifact
    (carrying its self-reported ``reader_identity`` + ``dispatch_record`` +
    ``strategies``), written to ``phase_b/<video_id>__s<idx>.json``. Each strategy is
    a SEPARATE fresh subagent. Missing => HALT (never fabricated)."""
    pb_dir = os.path.join(work_dir, "phase_b")

    def fn(video_id: str, _strategy_ref, strategy_index: int, _manifest_verified: dict):
        cid = f"{video_id}__s{strategy_index}"
        path = os.path.join(pb_dir, f"{cid}.json")
        if not os.path.exists(path):
            raise ConductorArtifactMissing(
                f"missing conductor Phase-B strategy artifact for cid={cid!r}: {path}"
            )
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)

    return fn


def _make_conductor_panel_fn(work_dir: str):
    """Thin reader for the live PANEL seam (STEP 4 is the driver's brains; this
    only marshals the conductor's cross-vendor panel answers). Per strategy cid,
    return ``{conflation, enumeration_consistency, completeness}`` — the driver
    coerces each axis fail-closed. Missing => HALT (never fabricated)."""
    panel_dir = os.path.join(work_dir, "panels")

    def fn(cid: str, _strategy: dict, _video_id: str):
        path = os.path.join(panel_dir, f"{cid}.json")
        if not os.path.exists(path):
            raise ConductorArtifactMissing(
                f"missing conductor panel answers for cid={cid!r}: {path}"
            )
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)

    return fn


def _make_conductor_rater_fn(work_dir: str):
    """Thin reader for the live RATER seam (STEP 3): the two blind raters' answers,
    written by the conductor per rater as a flat item_id->answer store
    (``raters/<rater_id>.json`` = ``{stage1:{item_id:role}, stage2:{item_id:{support,
    support_justification}}}``). For each item in the driver's packet view, the
    reader returns the conductor's answer for that item_id; an item the conductor
    did not answer is left UNANSWERED (fail-closed unresolved — never fabricated).
    A missing rater file => HALT (only reached if the driver actually dispatches a
    packet)."""
    rater_dir = os.path.join(work_dir, "raters")
    cache: dict = {}

    def _store(rater_id: str) -> dict:
        if rater_id not in cache:
            path = os.path.join(rater_dir, f"{rater_id}.json")
            if not os.path.exists(path):
                raise ConductorArtifactMissing(
                    f"missing conductor rater answers for rater={rater_id!r}: {path}"
                )
            with open(path, encoding="utf-8") as fh:
                cache[rater_id] = json.load(fh)
        return cache[rater_id]

    def fn(rater_id: str, stage: str, view: dict) -> dict:
        answers = (_store(rater_id).get(stage)) or {}
        out: dict = {}
        if stage == "stage1":
            for section in view.get("sections", []):
                for item in section.get("items", []):
                    iid = item.get("item_id")
                    if iid in answers:
                        out[iid] = answers[iid]
        else:  # stage2
            for item in (view.get("stage2") or {}).get("items", []):
                iid = item.get("item_id")
                if iid in answers:
                    out[iid] = answers[iid]
        return out

    return fn


def run_sealed(
    work_dir: str,
    manifest_path: str = PINNED_SEALED12_MANIFEST,
    token_path: str = PINNED_TOKEN_PATH,
    out_dir: str | None = None,
    driver: SealedReadDriver | None = None,
    propose_fn=None,
) -> tuple[int, str]:
    """Token-gated seal-day path. Returns ``(exit_code, text)``.

    STEP 0: verify the SEAL-GO.token exists + non-empty (the CLI's own check, so
    the exact runbook HALT is emitted BEFORE the driver is ever constructed). Then
    drive the built :meth:`SealedReadDriver.run_verdict` in sealed mode, wiring the
    conductor's ``--work-dir`` artifacts into the live seams + threading the
    conductor's dispatch_record. Prints the driver's verdict verbatim, or a HALT.
    Exit 0 iff a VALID FIDELITY verdict is produced; non-zero on any HALT / INVALID.

    ``propose_fn`` is the driver's anchor-locator PROPOSE seam. Left None on real
    seal day => the driver uses the certified (local-gemma) locator, the pinned
    instrument. Tests inject the network-free synthetic stub so the deterministic
    wiring proof never touches the model runtime (the same "inject a stub in tests"
    discipline ``anchor_locator.locate_anchor`` documents)."""
    # STEP 0 — operator authorization gate (the CLI's own check; never creates it).
    if not _token_present(token_path):
        return 1, _NO_TOKEN_HALT

    owns_tmp = out_dir is None
    out_dir = out_dir or tempfile.mkdtemp(prefix="h1-seal-conductor-sealed-")
    driver = driver or SealedReadDriver()

    code, text = _drive_full_sealed_read(
        work_dir,
        manifest_path=manifest_path,
        token_path=token_path,
        out_dir=out_dir,
        driver=driver,
        propose_fn=propose_fn,
    )
    if owns_tmp and text and not text.startswith("HALT:"):
        text += f"\n(out_dir={out_dir})"
    return code, text


def _load_source_attrition(work_dir: str) -> dict | None:
    """Read the plan stage's ``emit/source_attrition.json`` if present (R-028.3).
    Absent => None => the verdict is attrition-UNAWARE (byte-identical to the
    pre-R-028 path — every existing staged test and the rehearsal path)."""
    path = _emit_path(work_dir, _SOURCE_ATTRITION_EMIT)
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def _readable_verified(verified: dict, work_dir: str) -> dict:
    """Restrict a verified-manifest record's ``video_ids`` to the plan's READABLE
    set (R-028.3) so the phase_a/certify stages never dispatch/read an UNREADABLE-
    AT-SOURCE video (whose artifacts were never written). No plan/attrition record
    => the record is returned UNCHANGED (byte-identical to the pre-R-028 path)."""
    sa = _load_source_attrition(work_dir)
    if not sa:
        return verified
    readable = set(sa.get("readable") or [])
    return {
        **verified,
        "video_ids": [v for v in (verified.get("video_ids") or []) if v in readable],
    }


def _drive_full_sealed_read(
    work_dir: str,
    *,
    manifest_path: str,
    token_path: str,
    out_dir: str,
    driver: SealedReadDriver,
    propose_fn=None,
    source_attrition: dict | None = None,
) -> tuple[int, str]:
    """The shared A->E drive shared by the single-shot :func:`run_sealed` and the
    STAGED :func:`run_stage_verdict`. Assumes the token was already verified and
    every conductor artifact (Phase-A draws, Phase-B, panels, raters) is on disk.
    Wires the conductor's ``--work-dir`` files into the driver's live seams, threads
    the dispatch_record + validity inputs, and returns ``(exit_code, verdict_block)``
    — a verbatim verdict block (NO out_dir suffix — the caller adds context) or a
    HALT string. Every read is a file read; NO live LLM/network (propose_fn is the
    certified locator on seal day, a stub in tests)."""
    try:
        dispatch_record = _load_dispatch_record(work_dir)
        validity_inputs = _load_validity_inputs(work_dir)
        composed = driver.run_verdict(
            manifest_path,
            mode="sealed",
            out_dir=os.path.join(out_dir, "sealed"),
            token_path=token_path,
            live_phase_a_draw_fn=_make_conductor_phase_a_draw_fn(work_dir),
            live_phase_b_fn=_make_conductor_phase_b_fn(work_dir),
            live_panel_fn=_make_conductor_panel_fn(work_dir),
            rater_fn=_make_conductor_rater_fn(work_dir),
            dispatch_record=dispatch_record,
            propose_fn=propose_fn,
            source_attrition=source_attrition,
            **validity_inputs,
        )
    except (ReaderIdentityMismatch, SpentManifestRejected, ConductorArtifactMissing) as exc:
        return 1, f"HALT: {type(exc).__name__}: {exc}"

    # Gate refusal (Module A) — short-circuit, no verdict computed.
    if not composed.get("ok"):
        return 1, f"HALT: seal gate refused — {composed.get('halt_reason')}"

    verdict = composed["verdict"]
    text = format_verdict_block(verdict, mode="sealed")
    # Exit 0 iff a VALID FIDELITY verdict was produced; INVALID (fail-closed) or any
    # non-fidelity outcome is a non-zero, reported-verbatim outcome.
    ok = verdict.get("verdict") in ("FIDELITY_PASS", "FIDELITY_MISS") and _validity_valid(verdict)
    return (0 if ok else 1), text


# --------------------------------------------------------------------------- #
# STAGED SEALED READ — emit-and-stop handshake (ADVISOR-RULINGS R-026 / AR-017).
#
# The single-shot run_sealed above drives A->E in ONE process, calling the Phase-B
# / panel / rater LIVE seams AS IT GOES — so a BLIND conductor that pre-writes
# work-dir files cannot satisfy them: it cannot know the consensus cids / packet
# item_ids until the driver has EMITTED them. The three stages below break the read
# into emit->fulfil->resume handshakes:
#
#   stage `phase_a`  — ingest the 5 blind draws/video, compute the consensus, EMIT
#                      emit/phase_a_consensus.json (+ a hash over the draws), STOP.
#   [conductor fulfils Phase-B per emitted ref -> phase_b/<cid>.json]
#   stage `certify`  — VERIFY the Phase-A hash, assemble the Module-B extraction,
#                      EMIT emit/panel_requests.json + emit/rater_packets.json
#                      (leak-scanned) + emit/certify_stamp.json (phase_b hash), STOP.
#   [conductor fulfils panels/<cid>.json + raters/<id>.json]
#   stage `verdict`  — VERIFY the Phase-A + Phase-B hashes unchanged + the rater
#                      answers match the emitted packets, drive A->E ONCE, then a
#                      deterministic re-verify (R-026.1: two invocations != two
#                      reads), print the verdict verbatim.
# --------------------------------------------------------------------------- #

_EMIT_SUBDIR = "emit"
_PLAN_EMIT = "dispatch_plan.json"
_SOURCE_ATTRITION_EMIT = "source_attrition.json"
_PHASE_A_EMIT = "phase_a_consensus.json"
_PANEL_REQ_EMIT = "panel_requests.json"
_RATER_PKT_EMIT = "rater_packets.json"
_CERTIFY_STAMP_EMIT = "certify_stamp.json"
_STAGES = ("plan", "phase_a", "certify", "verdict")
#: the RAW->DRAW wrap seams (R-028.4 finding #3) — the plan emits `--wrap <seam>` as
#: the second named command per dispatch.
_WRAP_SEAMS = ("phase_a", "phase_b")
#: subdir the plan stage writes fetched transcripts to (conductor NEVER opens them;
#: the CLI writes the file, the dispatched subagent reads the PATH — blindness kept).
_TRANSCRIPTS_SUBDIR = "transcripts"


def _emit_path(work_dir: str, name: str) -> str:
    return os.path.join(work_dir, _EMIT_SUBDIR, name)


def _read_json_required(path: str, what: str) -> dict:
    """Read a REQUIRED prior-stage emit artifact; a missing one HALTs (never
    fabricated) — the conductor must run the prior stage first."""
    if not os.path.exists(path):
        raise ConductorArtifactMissing(
            f"missing {what}: {path} — run the prior stage first (staged handshake)"
        )
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def _gate_verified(manifest_path: str, token_path: str) -> dict:
    """Run Module A's seal gate and return the verified-manifest record (carrying
    ``video_ids``). A gate refusal (spent-16 manifest, token/verification failure)
    raises so the stage HALTs verbatim — the SAME Module A that guards run_sealed."""
    gate = gate_sealed_read(manifest_path, "sealed", token_path=token_path)
    if not gate["allowed"]:
        raise SpentManifestRejected(gate.get("halt_reason") or "seal gate refused")
    return gate["record"]["verify"]


def _rehash_phase_b(work_dir: str, cids: list[str]) -> str:
    """Deterministic sha256 over the conductor's Phase-B artifacts for the consensus
    ``cids`` (sorted, canonical JSON). Stage `certify` stamps it; stage `verdict`
    re-hashes and HALTs on a mismatch (Phase-B tampered between stages)."""
    reader = _make_conductor_phase_b_fn(work_dir)
    payloads = {}
    for cid in sorted(cids):
        # cid == <video_id>__s<idx>; split on the LAST '__s' to recover the parts.
        vid, _, sidx = cid.rpartition("__s")
        payloads[cid] = reader(vid, None, int(sidx), {})
    canon = json.dumps(payloads, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(canon.encode("utf-8")).hexdigest()


def _consensus_cids(per_video: dict) -> list[str]:
    """The Phase-B cids the emitted consensus implies: ``<video_id>__s<idx>`` for
    idx in range(n_strategies), per video — exactly the set stage `certify` requires
    Phase-B for (count CARRIED from the computed consensus, never pre-baked)."""
    cids: list[str] = []
    for vid in sorted(per_video):
        n = per_video[vid].get("n_strategies") or 0
        cids.extend(f"{vid}__s{i}" for i in range(n))
    return cids


# --------------------------------------------------------------------------- #
# STAGE `plan` (stage-0) — ADVISOR-RULINGS R-028.1/.3. Runs Module A first, FETCHES
# each transcript by video_id (recording per-video FETCH EVIDENCE + the SOURCE-
# ATTRITION partition), and EMITS the COMPLETE per-dispatch instruction set the
# conductor runs as NAMED commands (prompt path + transcript path + output path +
# the `claude -p` template with the explicit model flag + expected draw schema).
# NOTHING here hardcodes a model id / prompt sha — the identity is read at runtime
# from the frozen records via certified_reader_identity(). Emit-and-stop.
# --------------------------------------------------------------------------- #


def _rel(path: str) -> str:
    """Repo-relative POSIX path (the plan names paths the conductor dispatches on)."""
    return os.path.relpath(path, _ROOT).replace("\\", "/")


def _atomic_write_text(path: str, text: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = f"{path}.{os.getpid()}.tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write(text)
    os.replace(tmp, path)


def _default_transcript_fetch_fn(video_id: str) -> dict:
    """Real seal-day transcript fetch — the DISCOVERED production path. Runs
    ``scripts/h1-fetch-one.ts`` (the byte-faithful replica of the campaign's
    ``fetchTranscriptWithRetry`` youtube-transcript bridge) via ``npx tsx``, stdin
    ``{"video_id": <id>}``, stdout ``{video_id, transcript, char_count,
    final_outcome, attempts}`` (or ``{error}`` + exit 1). Returns fetch evidence
    ``{fetched, char_count, content_hash, transcript, final_outcome, error}``.
    NETWORK-TOUCHING — NEVER invoked in tests (a stub fetch_fn is injected)."""
    import subprocess

    script = os.path.join(_ROOT, "scripts", "h1-fetch-one.ts")
    try:
        proc = subprocess.run(
            ["npx", "tsx", script],
            input=json.dumps({"video_id": video_id}),
            capture_output=True,
            text=True,
            cwd=_ROOT,
            timeout=180,
        )
    except (OSError, subprocess.SubprocessError) as exc:  # pragma: no cover - env
        return {
            "fetched": False, "char_count": None, "content_hash": None,
            "transcript": None, "final_outcome": "fetch_process_error", "error": str(exc),
        }
    out = (proc.stdout or "").strip()
    try:
        parsed = json.loads(out.splitlines()[-1]) if out else {}
    except (ValueError, IndexError):
        parsed = {}
    if proc.returncode != 0 or "error" in parsed or not isinstance(parsed.get("transcript"), str):
        return {
            "fetched": False, "char_count": None, "content_hash": None,
            "transcript": None, "final_outcome": "all_failed",
            "error": parsed.get("error") or (proc.stderr or "").strip() or "fetch failed",
        }
    transcript = parsed.get("transcript") or ""
    return {
        "fetched": True,
        "char_count": parsed.get("char_count", len(transcript)),
        "content_hash": hashlib.sha256(transcript.encode("utf-8")).hexdigest(),
        "transcript": transcript,
        "final_outcome": parsed.get("final_outcome"),
        "error": None,
    }


def _sealed_content_hashes(manifest_path: str) -> dict:
    """Optional per-video sealed transcript-content hash from the manifest (the
    real sealed-12 stored NONE — existence probe only — so this is ``{}`` there;
    present only if a future manifest carries a ``transcript_content_sha256``).
    The attrition hash-mismatch branch compares the fetch-time hash against this."""
    try:
        with open(manifest_path, encoding="utf-8") as fh:
            manifest = json.load(fh)
    except (OSError, ValueError):
        return {}
    out: dict = {}
    for v in manifest.get("videos") or []:
        vid = v.get("video_id")
        h = v.get("transcript_content_sha256") or v.get("content_hash")
        if vid and isinstance(h, str) and h:
            out[vid] = h
    return out


def _fetch_or_reuse(tx_dir: str, video_id: str, fetch_fn) -> dict:
    """Read-once/idempotent fetch: if ``transcripts/<vid>.txt`` already exists +
    is non-empty, REUSE it (recompute char_count + content_hash from disk, never
    re-hit YouTube — so a re-run of `plan` can never silently change the readable
    set). Otherwise call ``fetch_fn`` and, on success, persist the transcript
    atomically. Returns fetch evidence WITHOUT the transcript body."""
    path = os.path.join(tx_dir, f"{video_id}.txt")
    if os.path.exists(path):
        with open(path, encoding="utf-8") as fh:
            text = fh.read()
        if text.strip():
            return {
                "fetched": True,
                "char_count": len(text),
                "content_hash": hashlib.sha256(text.encode("utf-8")).hexdigest(),
                "final_outcome": "reused_on_disk",
                "error": None,
                "anomaly_side": None,
            }
    ev = dict(fetch_fn(video_id) or {})
    transcript = ev.pop("transcript", None)
    if ev.get("fetched") and isinstance(transcript, str) and transcript:
        _atomic_write_text(path, transcript)
    return ev


def _abs_slash(path: str) -> str:
    """OS-correct ABSOLUTE path with forward slashes (R-028.4 finding #2). Windows
    ``os.path.abspath`` yields backslashes, which a bash ``$(cat …)`` / redirect
    command treats as escape chars; forward-slash absolute paths (``C:/…``) are
    valid on Windows for python/node/claude AND round-trip through bash. Never a
    relative or ``/tmp/…`` literal."""
    return os.path.abspath(path).replace(os.sep, "/")


#: This CLI's own absolute path — the plan emits `python <this> --wrap …` as the
#: second named command per dispatch (the wrap step; see `_wrap_dispatch_raw`).
_THIS_CLI = _abs_slash(__file__)


def _claude_p_template(model_id: str, prompt_path: str, transcript_path: str, raw_output_path: str) -> str:
    """The headless `claude -p` invocation template (runbook STEP 2: fresh Claude
    subagent on the subscription channel, model set EXPLICITLY).

    R-028.4 finding #1 (headless permission): a default-headless `claude -p` may
    NOT use the Write tool, so the subagent PRINTS the JSON to stdout and the shell
    CAPTURES it (`> raw_output_path`) — no Write-tool permission needed. `Read` is
    the ONE tool the subagent needs (to read the transcript PATH itself — blindness
    kept) and is the minimal allow-list. The model flag is the ONLY load-bearing
    literal and is interpolated from the frozen identity — never hardcoded. All
    paths are OS-correct ABSOLUTE (finding #2)."""
    return (
        f"claude -p --model {model_id} --allowedTools Read "
        f'--append-system-prompt "$(cat {prompt_path})" '
        f'"Read the transcript file at {transcript_path} and produce the extraction '
        "artifact exactly as the frozen prompt specifies. Print ONLY the JSON "
        "artifact and nothing else to stdout. Output ONLY the JSON object — no "
        "preamble, no explanation, no markdown fences, no text before or after the "
        f'JSON." > {raw_output_path}'
    )


def _wrap_command(work_dir_abs: str, seam: str, raw_output_path: str, video_id: str, index) -> str:
    """The SECOND named command the plan emits per dispatch (R-028.4 finding #3):
    after the `claude -p` writes the RAW extraction to ``raw_output_path``, this CLI
    step reads that raw + the conductor's dispatch_record, WRAPS them into the draw
    schema the ingestion asserts on (adding ``reader_identity`` from the FROZEN
    record + deriving ``count``/``strategy_refs`` from the raw), and writes the
    canonical ``<seam>/…`` artifact the existing stage reads UNCHANGED. The
    conductor never hand-assembles identity — the CLI owns the wrap."""
    idx_flag = "--draw-index" if seam == "phase_a" else "--strategy-index"
    return (
        f"python {_THIS_CLI} --mode sealed --work-dir {work_dir_abs} "
        f"--wrap {seam} --raw {raw_output_path} --video-id {video_id} {idx_flag} {index}"
    )


#: What the `claude -p` PRINTS (raw model extraction) — Phase-A enumerator output.
_PHASE_A_RAW_SCHEMA = {
    "strategies": "list[strategy objects] — the model's blind enumeration (per the enumerator prompt)",
    "enumeration_note": "str|null — one-sentence ambiguity flag (per the enumerator prompt)",
}
#: What the CLI WRAP step produces from the raw — the draw artifact the existing
#: ingestion (`_make_conductor_phase_a_draw_fn` + `_assert_one_dispatch`) asserts on.
_PHASE_A_DRAW_SCHEMA = {
    "count": "int — SYNTHESIZED by the wrap as len(strategies)",
    "strategy_refs": "list[str] — SYNTHESIZED by the wrap (one deterministic ref per enumerated strategy)",
    "reader_identity": "object — ADDED by the wrap from certified_reader_identity() (frozen record; NOT model self-report)",
    "dispatch_record": "object {requested_model, resolved_model, channel_class, dispatch_mode} — the conductor's dispatch_record, embedded by the wrap",
}
#: What the Phase-B `claude -p` PRINTS (raw frontier-v3.2 extraction).
_PHASE_B_RAW_SCHEMA = {
    "strategies": "list[one strategy object]",
    "instrument_classification": "object|null",
    "rejected_strategies": "list (optional)",
    "coaching_notes": "list (optional)",
}


def _build_dispatch_plan(work_dir: str, readable_ids: list, identity: dict, attrition: dict) -> dict:
    """The COMPLETE per-dispatch instruction set (R-028.1) — the single source of
    'how to dispatch'. Per readable video, k Phase-A draws named individually; the
    later seams (Phase-B / panel / rater) carry their instruction SHAPE (their cids
    are emitted by later stages, not knowable at plan time)."""
    model_id = identity["model_id"]
    k = identity["k"]
    # OS-correct ABSOLUTE paths (R-028.4 finding #2) — the conductor dispatches these
    # verbatim; a relative / `/tmp/…` path does not round-trip.
    wd_abs = _abs_slash(work_dir)
    enum_prompt = _abs_slash(ENUMERATOR_PROMPT_PATH)
    frontier_prompt = _abs_slash(FRONTIER_PROMPT_PATH)
    dispatch_record_template = {
        "requested_model": model_id,
        "resolved_model": "<what actually ran — conductor fills; must equal requested>",
        "channel_class": identity["channel_class"],
        "dispatch_mode": "interactive|headless",
    }
    # Pre-create the raw-capture dirs so the emitted `> raw_output_path` redirect
    # has a landing dir (bash `>` does not mkdir the parent).
    os.makedirs(os.path.join(work_dir, "raw", "phase_b"), exist_ok=True)
    phase_a_dispatches: list[dict] = []
    for vid in readable_ids:
        transcript_path = f"{wd_abs}/{_TRANSCRIPTS_SUBDIR}/{vid}.txt"
        os.makedirs(os.path.join(work_dir, "raw", "phase_a", vid), exist_ok=True)
        for i in range(k):
            raw_output_path = f"{wd_abs}/raw/phase_a/{vid}/draw_{i}.json"
            output_path = f"{wd_abs}/phase_a/{vid}/draw_{i}.json"
            phase_a_dispatches.append(
                {
                    "seam": "phase_a_draw",
                    "video_id": vid,
                    "draw_index": i,
                    "prompt_path": enum_prompt,
                    "transcript_path": transcript_path,
                    "raw_output_path": raw_output_path,
                    "output_path": output_path,
                    # 1) run the model -> RAW extraction (stdout-captured, no Write tool);
                    "claude_p_template": _claude_p_template(
                        model_id, enum_prompt, transcript_path, raw_output_path
                    ),
                    # 2) CLI wraps raw + dispatch_record -> the ingested draw artifact.
                    "wrap_command": _wrap_command(
                        wd_abs, "phase_a", raw_output_path, vid, i
                    ),
                    "expected_raw_schema": dict(_PHASE_A_RAW_SCHEMA),
                    "expected_schema": dict(_PHASE_A_DRAW_SCHEMA),
                }
            )
    later_seam_instruction_shapes = {
        "phase_b": {
            "seam": "phase_b_strategy",
            "emitted_by_stage": "certify (one dispatch per consensus strategy)",
            "prompt_path": frontier_prompt,
            "transcript_path_template": f"{wd_abs}/{_TRANSCRIPTS_SUBDIR}/<video_id>.txt",
            "raw_output_path_template": f"{wd_abs}/raw/phase_b/<video_id>__s<idx>.json",
            "output_path_template": f"{wd_abs}/phase_b/<video_id>__s<idx>.json",
            "claude_p_template": _claude_p_template(
                model_id, frontier_prompt,
                f"{wd_abs}/{_TRANSCRIPTS_SUBDIR}/<video_id>.txt",
                f"{wd_abs}/raw/phase_b/<video_id>__s<idx>.json",
            ),
            "wrap_command_template": _wrap_command(
                wd_abs, "phase_b",
                f"{wd_abs}/raw/phase_b/<video_id>__s<idx>.json",
                "<video_id>", "<idx>",
            ),
            "expected_raw_schema": dict(_PHASE_B_RAW_SCHEMA),
            "expected_schema": {
                "strategies": "list[one strategy object] (raw, carried through the wrap)",
                "instrument_classification": "object|null (raw, carried through)",
                "reader_identity": "object — ADDED by the wrap (frozen record)",
                "dispatch_record": "object — embedded by the wrap (per dispatch)",
            },
        },
        "panel": {
            "seam": "panel",
            "emitted_by_stage": "certify (emit/panel_requests.json, one per cid)",
            "output_path_template": "panels/<cid>.json",
            "expected_schema": {
                "conflation": "PASS|FAIL",
                "enumeration_consistency": "PASS|FAIL",
                "completeness": {"content_clean": "bool"},
            },
        },
        "rater": {
            "seam": "rater",
            "emitted_by_stage": "certify (emit/rater_packets.json; two blind raters)",
            "output_path_template": "raters/<rater_id>.json",
            "raters": ["A", "B"],
            "expected_schema": {
                "stage1": {"<item_id>": "gate-strength|context|cannot-determine"},
                "stage2": {"<item_id>": {"support": "confirmed|partial|denied",
                                         "support_justification": "str"}},
            },
        },
    }
    return {
        "artifact": "h1-staged-plan-dispatch-emit",
        "stage": "plan",
        "sealed_total": attrition["sealed_total"],
        "readable_n": attrition["readable_n"],
        "reader_identity": identity,
        "dispatch_record_template": dispatch_record_template,
        "phase_a_dispatches": phase_a_dispatches,
        "later_seam_instruction_shapes": later_seam_instruction_shapes,
        "source_attrition_emit": _rel(_emit_path(work_dir, _SOURCE_ATTRITION_EMIT)),
    }


def run_stage_plan(
    work_dir: str,
    manifest_path: str = PINNED_SEALED12_MANIFEST,
    token_path: str = PINNED_TOKEN_PATH,
    fetch_fn=None,
) -> tuple[int, str]:
    """STAGE `plan` (stage-0, R-028.1/.3): Module A gate FIRST (token + seal-verify
    + reject spent-16 — HALT on any failure); FETCH each transcript by video_id to
    ``<dir>/transcripts/<vid>.txt`` recording per-video FETCH EVIDENCE; partition
    into READABLE / UNREADABLE-AT-SOURCE / LOCAL-HALT (attrition); EMIT
    ``emit/source_attrition.json`` + ``emit/dispatch_plan.json`` (the complete
    per-dispatch instruction set). A LOCAL-side hash anomaly HALTs (never
    attrition). Read-once: re-running REUSES fetched transcripts on disk (a
    re-fetch never silently changes the readable set). Emit-and-stop."""
    if not _token_present(token_path):
        return 1, _NO_TOKEN_HALT
    # Module A gate FIRST (reject spent-16 + operator gate + seal-verify).
    try:
        verified = _gate_verified(manifest_path, token_path)
    except SpentManifestRejected as exc:
        return 1, f"HALT: {type(exc).__name__}: {exc}"
    video_ids = verified.get("video_ids") or []
    if not video_ids:
        return 1, "HALT: seal gate produced no video_ids to plan"

    fetch_fn = fetch_fn or _default_transcript_fetch_fn
    sealed_hashes = _sealed_content_hashes(manifest_path)
    tx_dir = os.path.join(work_dir, _TRANSCRIPTS_SUBDIR)
    os.makedirs(tx_dir, exist_ok=True)

    fetch_evidence: dict = {}
    for vid in video_ids:
        ev = _fetch_or_reuse(tx_dir, vid, fetch_fn)
        ev.setdefault("anomaly_side", None)
        ev["sealed_content_hash"] = sealed_hashes.get(vid)
        fetch_evidence[vid] = ev

    attrition = classify_source_attrition(video_ids, fetch_evidence, floor=READABLE_N_FLOOR)

    # A LOCAL-side hash anomaly is a HALT, never attrition — fail closed, no emit.
    if attrition["local_halt"]:
        offenders = ", ".join(str(h.get("video_id")) for h in attrition["local_halt"])
        return 1, (
            "HALT: source-attrition LOCAL anomaly (not source-side) on "
            f"{offenders} — a local-side hash-mismatch HALTs, never attrition; "
            "resolve the local fetch before re-running plan"
        )

    _write_emit(
        work_dir,
        _SOURCE_ATTRITION_EMIT,
        {"artifact": "h1-staged-source-attrition-emit", **attrition},
    )
    identity = certified_reader_identity()
    plan = _build_dispatch_plan(work_dir, attrition["readable"], identity, attrition)
    _write_emit(work_dir, _PLAN_EMIT, plan)

    unreadable_ids = [u["video_id"] for u in attrition["unreadable_at_source"]]
    lines = [
        "=== STAGE plan EMITTED (STOP — dispatch Phase-A next) ===",
        "readable: {rn}/{st} (floor {fl}, meets_floor={mf})".format(
            rn=attrition["readable_n"], st=attrition["sealed_total"],
            fl=attrition["floor"], mf=attrition["meets_floor"],
        ),
    ]
    if unreadable_ids:
        lines.append("UNREADABLE-AT-SOURCE (excluded from num+denom): " + ", ".join(unreadable_ids))
    if not attrition["meets_floor"]:
        lines.append(
            "WARNING: readable-N below floor -> the verdict stage will return "
            "INDETERMINATE_SOURCE_ATTRITION (escalate; no fidelity verdict on <"
            f"{attrition['floor']})"
        )
    lines.append(f"source_attrition: {_emit_path(work_dir, _SOURCE_ATTRITION_EMIT)}")
    lines.append(
        "dispatch_plan: {p} ({n} Phase-A draws across {v} readable videos)".format(
            p=_emit_path(work_dir, _PLAN_EMIT),
            n=len(plan["phase_a_dispatches"]),
            v=attrition["readable_n"],
        )
    )
    lines.append("=== END STAGE plan ===")
    return 0, "\n".join(lines)


def run_stage_phase_a(
    work_dir: str,
    manifest_path: str = PINNED_SEALED12_MANIFEST,
    token_path: str = PINNED_TOKEN_PATH,
) -> tuple[int, str]:
    """STAGE `phase_a` (R-026.1): ingest the conductor's 5 blind Phase-A draws/video
    (``phase_a/<vid>/draw_<0..4>.json``), let the driver compute the modal consensus
    + stability, and EMIT ``emit/phase_a_consensus.json`` (per-video strategy_refs /
    stable / mode / adjudication_needed + a HASH over the ingested draws). STOPS — it
    does NOT dispatch Phase-B. Deterministic re-emit: re-running on the SAME draw
    files writes a byte-identical emit (only reads, never re-dispatches)."""
    if not _token_present(token_path):
        return 1, _NO_TOKEN_HALT
    try:
        verified = _readable_verified(_gate_verified(manifest_path, token_path), work_dir)
        dispatch_record = _load_dispatch_record(work_dir)
        consensus = compute_phase_a_consensus(
            verified,
            _make_conductor_phase_a_draw_fn(work_dir),
            dispatch_record=dispatch_record,
        )
    except (ReaderIdentityMismatch, SpentManifestRejected, ConductorArtifactMissing) as exc:
        return 1, f"HALT: {type(exc).__name__}: {exc}"

    emit = {
        "artifact": "h1-staged-phase-a-consensus-emit",
        "stage": "phase_a",
        "phase_a_draws_hash": consensus["draws_hash"],
        "k": consensus["k"],
        "stability_min": consensus["stability_min"],
        "per_video": consensus["per_video"],
    }
    _write_emit(work_dir, _PHASE_A_EMIT, emit)

    cids = _consensus_cids(consensus["per_video"])
    lines = [
        "=== STAGE phase_a EMITTED (STOP — fulfil Phase-B next) ===",
        f"phase_a_draws_hash: {consensus['draws_hash']}",
        f"emit: {_emit_path(work_dir, _PHASE_A_EMIT)}",
        "fulfil next (one Phase-B extraction per consensus strategy):",
    ]
    for vid in sorted(consensus["per_video"]):
        rec = consensus["per_video"][vid]
        lines.append(
            f"  - {vid}: n_strategies={rec['n_strategies']} "
            f"(stable={rec['stable']} mode={rec['mode']} mode_n={rec['mode_n']} "
            f"adjudication_needed={rec['adjudication_needed']})"
        )
    lines.append("  Phase-B files required (phase_b/<cid>.json): " + ", ".join(cids))
    lines.append("=== END STAGE phase_a ===")
    return 0, "\n".join(lines)


def run_stage_certify(
    work_dir: str,
    manifest_path: str = PINNED_SEALED12_MANIFEST,
    token_path: str = PINNED_TOKEN_PATH,
    out_dir: str | None = None,
    propose_fn=None,
) -> tuple[int, str]:
    """STAGE `certify`: VERIFY the persisted Phase-A (re-hash the draws == stage
    `phase_a`'s stamp; re-compute the consensus == the emitted refs — a changed
    Phase-A artifact OR a broken emit HALTs), assemble the Module-B extraction
    (reading the conductor's Phase-B per consensus strategy — exactly N required,
    the count CARRIED from the consensus), then EMIT what's needed next:
    ``emit/panel_requests.json`` (per cid) + ``emit/rater_packets.json`` (the
    two-stage tier-3 rater packets the driver built, leak-scanned — a leak HALTs) +
    ``emit/certify_stamp.json`` (the Phase-B hash). STOPS."""
    if not _token_present(token_path):
        return 1, _NO_TOKEN_HALT
    owns_tmp = out_dir is None
    out_dir = out_dir or tempfile.mkdtemp(prefix="h1-seal-conductor-certify-")
    try:
        prior = _read_json_required(
            _emit_path(work_dir, _PHASE_A_EMIT), "stage phase_a emit (phase_a_consensus.json)"
        )
        verified = _readable_verified(_gate_verified(manifest_path, token_path), work_dir)
        dispatch_record = _load_dispatch_record(work_dir)

        # RE-INGEST Phase-A (deterministic re-emit) + VERIFY vs the emitted stamp.
        recomputed = compute_phase_a_consensus(
            verified,
            _make_conductor_phase_a_draw_fn(work_dir),
            dispatch_record=dispatch_record,
        )
        if recomputed["draws_hash"] != prior.get("phase_a_draws_hash"):
            raise ConductorArtifactMissing(
                "Phase-A draws hash MISMATCH vs stage phase_a's stamp "
                f"(emit={prior.get('phase_a_draws_hash')!r} recomputed="
                f"{recomputed['draws_hash']!r}) — a changed Phase-A artifact HALTs"
            )
        # EMIT-BREAK guard: the per-video consensus stage phase_a emitted must equal
        # the driver's re-computed consensus (a broken/empty-ref emit HALTs LOUDLY).
        if not _consensus_refs_match(prior.get("per_video") or {}, recomputed["per_video"]):
            raise ConductorArtifactMissing(
                "emitted Phase-A consensus does NOT match the driver's re-computed "
                "consensus (emit step broken) — resume HALTs; re-run stage phase_a"
            )

        # ASSEMBLE the Module-B extraction: reads Phase-A + the conductor's Phase-B
        # per consensus strategy. A missing Phase-B (fewer than the consensus count)
        # HALTs inside the driver — the count is CARRIED, not pre-baked.
        extraction = run_extraction_stage(
            verified,
            mode="sealed",
            out_dir=os.path.join(out_dir, "sealed-artifacts"),
            live_phase_a_draw_fn=_make_conductor_phase_a_draw_fn(work_dir),
            live_phase_b_fn=_make_conductor_phase_b_fn(work_dir),
            dispatch_record=dispatch_record,
        )
        panel_requests = build_panel_requests(extraction)
        rater_packets = build_rater_packets(extraction, propose_fn=propose_fn)
        phase_b_hash = _rehash_phase_b(work_dir, _consensus_cids(recomputed["per_video"]))
    except (ReaderIdentityMismatch, SpentManifestRejected, ConductorArtifactMissing) as exc:
        return 1, f"HALT: {type(exc).__name__}: {exc}"
    except LeakScanFailure as exc:
        return 1, f"HALT: LeakScanFailure: rater packet leaked, never emitted — {exc}"

    _write_emit(work_dir, _PANEL_REQ_EMIT, {"stage": "certify", "requests": panel_requests})
    _write_emit(work_dir, _RATER_PKT_EMIT, {"stage": "certify", "packets": rater_packets})
    _write_emit(
        work_dir,
        _CERTIFY_STAMP_EMIT,
        {
            "stage": "certify",
            "phase_a_draws_hash": prior.get("phase_a_draws_hash"),
            "phase_b_hash": phase_b_hash,
            "cids": _consensus_cids(recomputed["per_video"]),
        },
    )

    lines = [
        "=== STAGE certify EMITTED (STOP — fulfil panels + raters next) ===",
        f"phase_b_hash: {phase_b_hash}",
        f"panel_requests: {_emit_path(work_dir, _PANEL_REQ_EMIT)} ({len(panel_requests)} cids)",
        f"rater_packets: {_emit_path(work_dir, _RATER_PKT_EMIT)} ({len(rater_packets)} packets)",
        "fulfil next: panels/<cid>.json (per request) + raters/<id>.json "
        "(answer ONLY the emitted packet item_ids)",
        "=== END STAGE certify ===",
    ]
    text = "\n".join(lines)
    if owns_tmp:
        text += f"\n(out_dir={out_dir})"
    return 0, text


def run_stage_verdict(
    work_dir: str,
    manifest_path: str = PINNED_SEALED12_MANIFEST,
    token_path: str = PINNED_TOKEN_PATH,
    out_dir: str | None = None,
    driver: SealedReadDriver | None = None,
    propose_fn=None,
) -> tuple[int, str]:
    """STAGE `verdict`: ingest ALL persisted artifacts, VERIFY (a) the Phase-A draws
    hash still matches stage phase_a's stamp, (b) the Phase-B hash still matches
    stage certify's stamp, (c) the conductor's rater answers reference ONLY the
    emitted packet item_ids (a WRONG-packet answer HALTs — R-026.2). Then drive A->E
    ONCE from the persisted artifacts, run a deterministic RE-VERIFY (recompute the
    verdict from the SAME files and confirm it is byte-identical — R-026.1: two
    invocations != two reads), and print the verdict VERBATIM."""
    if not _token_present(token_path):
        return 1, _NO_TOKEN_HALT
    owns_tmp = out_dir is None
    out_dir = out_dir or tempfile.mkdtemp(prefix="h1-seal-conductor-verdict-")
    driver = driver or SealedReadDriver()
    # R-028.3: the plan stage's attrition record (absent on the pre-R-028 /
    # rehearsal path -> None -> verdict byte-unchanged).
    source_attrition = _load_source_attrition(work_dir)

    try:
        phase_a_emit = _read_json_required(
            _emit_path(work_dir, _PHASE_A_EMIT), "stage phase_a emit"
        )
        stamp = _read_json_required(
            _emit_path(work_dir, _CERTIFY_STAMP_EMIT), "stage certify stamp"
        )
        rater_pkt_emit = _read_json_required(
            _emit_path(work_dir, _RATER_PKT_EMIT), "stage certify rater packets"
        )
        verified = _readable_verified(_gate_verified(manifest_path, token_path), work_dir)
        dispatch_record = _load_dispatch_record(work_dir)

        # (a) Phase-A hash unchanged since stage phase_a.
        recomputed = compute_phase_a_consensus(
            verified,
            _make_conductor_phase_a_draw_fn(work_dir),
            dispatch_record=dispatch_record,
        )
        if recomputed["draws_hash"] != phase_a_emit.get("phase_a_draws_hash"):
            raise ConductorArtifactMissing(
                "Phase-A draws hash MISMATCH at verdict stage — a changed Phase-A "
                "artifact HALTs (read-once pin)"
            )
        # (b) Phase-B hash unchanged since stage certify.
        cids = _consensus_cids(recomputed["per_video"])
        if _rehash_phase_b(work_dir, cids) != stamp.get("phase_b_hash"):
            raise ConductorArtifactMissing(
                "Phase-B hash MISMATCH at verdict stage — a changed Phase-B artifact "
                "HALTs (read-once pin)"
            )
        # (c) rater answers must match the emitted packets (R-026.2 sweep).
        _assert_rater_answers_match_packets(work_dir, rater_pkt_emit.get("packets") or [])
    except (ReaderIdentityMismatch, SpentManifestRejected, ConductorArtifactMissing) as exc:
        return 1, f"HALT: {type(exc).__name__}: {exc}"

    # Drive A->E ONCE from the persisted artifacts.
    code, text = _drive_full_sealed_read(
        work_dir,
        manifest_path=manifest_path,
        token_path=token_path,
        out_dir=os.path.join(out_dir, "read1"),
        driver=driver,
        propose_fn=propose_fn,
        source_attrition=source_attrition,
    )
    if text.startswith("HALT:"):
        return code, text

    # RE-VERIFY (R-026.1): recompute from the SAME persisted files; the verdict is
    # deterministic (all file reads, no dispatch), so a second drive is byte-identical.
    code2, text2 = _drive_full_sealed_read(
        work_dir,
        manifest_path=manifest_path,
        token_path=token_path,
        out_dir=os.path.join(out_dir, "read2"),
        driver=SealedReadDriver(),
        propose_fn=propose_fn,
        source_attrition=source_attrition,
    )
    reverify = "MATCH" if (code2 == code and text2 == text) else "MISMATCH"
    text += f"\nreverify: {reverify}"
    if reverify != "MATCH":
        return 1, text
    if owns_tmp:
        text += f"\n(out_dir={out_dir})"
    return code, text


def _consensus_refs_match(emitted_per_video: dict, recomputed_per_video: dict) -> bool:
    """True iff the emitted per-video consensus strategy_refs equal the driver's
    re-computed refs (same videos, same ref lists). The EMIT-BREAK guard's core."""
    if set(emitted_per_video) != set(recomputed_per_video):
        return False
    for vid, rec in recomputed_per_video.items():
        if (emitted_per_video[vid] or {}).get("strategy_refs") != rec.get("strategy_refs"):
            return False
    return True


def _assert_rater_answers_match_packets(work_dir: str, packets: list) -> None:
    """R-026.2 rater-match guard: the conductor's rater answers may reference ONLY
    the item_ids the driver EMITTED in ``emit/rater_packets.json`` (Set-B/AUDIT
    targets + Set-A controls). A rater answer for ANY other item_id — the conductor
    answered the WRONG packets — HALTs (never silently scored not-clean)."""
    known: set[str] = set()
    for pkt in packets:
        known.update(pkt.get("target_item_ids") or [])
        known.update(pkt.get("control_item_ids") or [])
    rater_dir = os.path.join(work_dir, "raters")
    if not os.path.isdir(rater_dir):
        return  # no rater answers yet — the driver's per-item read fails closed later
    for fname in sorted(os.listdir(rater_dir)):
        if not fname.endswith(".json"):
            continue
        with open(os.path.join(rater_dir, fname), encoding="utf-8") as fh:
            answers = json.load(fh)
        answered: set[str] = set()
        answered.update((answers.get("stage1") or {}).keys())
        answered.update((answers.get("stage2") or {}).keys())
        foreign = sorted(answered - known)
        if foreign:
            raise ConductorArtifactMissing(
                f"rater {fname} answered item_ids NOT in the emitted packets "
                f"(wrong packets): {foreign} — the answers must match the emitted "
                "rater_packets.json"
            )


def _write_emit(work_dir: str, name: str, payload: dict) -> None:
    """Atomically write a driver EMIT artifact under ``<work-dir>/emit/`` (sorted
    keys, no wall-clock) so a deterministic re-emit is byte-identical."""
    path = _emit_path(work_dir, name)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    data = json.dumps(payload, ensure_ascii=False, sort_keys=True, indent=2)
    tmp = f"{path}.{os.getpid()}.tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write(data)
    os.replace(tmp, path)


def _detect_stage(work_dir: str) -> str:
    """Auto-detect the next stage from the work-dir emit state: no phase_a emit ->
    `phase_a`; phase_a emitted but no rater packets -> `certify`; both -> `verdict`.
    An explicit ``--stage`` overrides this."""
    if not os.path.exists(_emit_path(work_dir, _PHASE_A_EMIT)):
        return "phase_a"
    if not os.path.exists(_emit_path(work_dir, _RATER_PKT_EMIT)):
        return "certify"
    return "verdict"


def run_sealed_staged(
    work_dir: str,
    stage: str | None = None,
    manifest_path: str = PINNED_SEALED12_MANIFEST,
    token_path: str = PINNED_TOKEN_PATH,
    out_dir: str | None = None,
    propose_fn=None,
) -> tuple[int, str]:
    """Dispatch the STAGED sealed read. ``stage`` is explicit (``phase_a`` /
    ``certify`` / ``verdict``) or None to auto-detect from work-dir state. Each stage
    HALTs if a required prior-stage artifact is missing (never fabricated)."""
    if not _token_present(token_path):
        return 1, _NO_TOKEN_HALT
    stage = stage or _detect_stage(work_dir)
    if stage == "plan":
        return run_stage_plan(work_dir, manifest_path=manifest_path, token_path=token_path)
    if stage == "phase_a":
        return run_stage_phase_a(work_dir, manifest_path=manifest_path, token_path=token_path)
    if stage == "certify":
        return run_stage_certify(
            work_dir, manifest_path=manifest_path, token_path=token_path,
            out_dir=out_dir, propose_fn=propose_fn,
        )
    if stage == "verdict":
        return run_stage_verdict(
            work_dir, manifest_path=manifest_path, token_path=token_path,
            out_dir=out_dir, propose_fn=propose_fn,
        )
    return 2, f"HALT: unknown --stage {stage!r} (expected one of {_STAGES})"


def _token_present(token_path: str) -> bool:
    """True iff the operator go-token exists and is non-empty (stripped). The CLI
    NEVER writes this file."""
    try:
        with open(token_path, encoding="utf-8") as fh:
            return len(fh.read().strip()) > 0
    except (FileNotFoundError, OSError):
        return False


# --------------------------------------------------------------------------- #
# CLI entry.
# --------------------------------------------------------------------------- #


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="h1_seal_conductor_cli",
        description="H1 sealed-12 terminal-read conductor CLI (thin driver wrapper).",
    )
    parser.add_argument("--mode", required=True, choices=("staging", "sealed"))
    parser.add_argument(
        "--work-dir",
        default=None,
        help="sealed mode: dir of conductor-written artifacts (phase_a/<vid>/"
        "draw_<0..4>.json, phase_b/<cid>.json, panels/, raters/, "
        "dispatch_record.json, validity_inputs.json).",
    )
    parser.add_argument(
        "--manifest",
        default=PINNED_SEALED12_MANIFEST,
        help="sealed mode: manifest path (defaults to the pinned sealed-12).",
    )
    parser.add_argument("--token-path", default=PINNED_TOKEN_PATH)
    parser.add_argument("--out-dir", default=None)
    parser.add_argument(
        "--stage",
        default=None,
        choices=_STAGES,
        help="sealed mode: the STAGED emit-and-stop step (R-026). Omit to "
        "auto-detect the next stage from the work-dir emit state.",
    )
    parser.add_argument(
        "--wrap",
        default=None,
        choices=_WRAP_SEAMS,
        help="sealed mode: the RAW->DRAW wrap step (R-028.4). Reads --raw (the "
        "`claude -p`-captured raw extraction) + the conductor's dispatch_record and "
        "writes the ingested draw artifact (adds reader_identity from the frozen "
        "record; derives count/strategy_refs for Phase-A).",
    )
    parser.add_argument("--raw", default=None, help="--wrap: path to the raw extraction stdout.")
    parser.add_argument("--video-id", default=None, help="--wrap: the dispatch's video_id.")
    parser.add_argument("--draw-index", type=int, default=None, help="--wrap phase_a: draw index.")
    parser.add_argument("--strategy-index", type=int, default=None, help="--wrap phase_b: strategy index.")
    args = parser.parse_args(argv)

    if args.mode == "staging":
        code, text = run_staging(out_dir=args.out_dir)
    elif args.wrap:
        if not args.work_dir:
            print("HALT: --work-dir is required for --wrap", file=sys.stderr)
            return 2
        index = args.draw_index if args.wrap == "phase_a" else args.strategy_index
        if args.raw is None or args.video_id is None or index is None:
            print(
                "HALT: --wrap requires --raw, --video-id, and "
                + ("--draw-index" if args.wrap == "phase_a" else "--strategy-index"),
                file=sys.stderr,
            )
            return 2
        code, text = _wrap_dispatch_raw(args.work_dir, args.wrap, args.raw, args.video_id, index)
    else:
        if not args.work_dir:
            print("HALT: --work-dir is required for --mode sealed", file=sys.stderr)
            return 2
        code, text = run_sealed_staged(
            args.work_dir,
            stage=args.stage,
            manifest_path=args.manifest,
            token_path=args.token_path,
            out_dir=args.out_dir,
        )
    print(text)
    return code


if __name__ == "__main__":
    raise SystemExit(main())
