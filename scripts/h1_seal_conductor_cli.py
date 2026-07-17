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
    REHEARSAL_SPENT_VIDEOS,
    ReaderIdentityMismatch,
    SealedReadDriver,
    _write_spent_rehearsal_manifest,
    build_panel_requests,
    build_rater_packets,
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


def _drive_full_sealed_read(
    work_dir: str,
    *,
    manifest_path: str,
    token_path: str,
    out_dir: str,
    driver: SealedReadDriver,
    propose_fn=None,
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
_PHASE_A_EMIT = "phase_a_consensus.json"
_PANEL_REQ_EMIT = "panel_requests.json"
_RATER_PKT_EMIT = "rater_packets.json"
_CERTIFY_STAMP_EMIT = "certify_stamp.json"
_STAGES = ("phase_a", "certify", "verdict")


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
        verified = _gate_verified(manifest_path, token_path)
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
        verified = _gate_verified(manifest_path, token_path)
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
        verified = _gate_verified(manifest_path, token_path)
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
    args = parser.parse_args(argv)

    if args.mode == "staging":
        code, text = run_staging(out_dir=args.out_dir)
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
