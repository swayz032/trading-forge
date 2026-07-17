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
import json
import os
import sys
import tempfile

# Repo root = parent of this scripts/ dir. Put it on sys.path so `src...` imports
# resolve when the CLI is invoked as `python scripts/h1_seal_conductor_cli.py`.
_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from src.engine.extraction.sealed_read_driver import (  # noqa: E402
    REHEARSAL_SPENT_VIDEOS,
    ReaderIdentityMismatch,
    SealedReadDriver,
    _write_spent_rehearsal_manifest,
    run_full_dress_rehearsal,
)
from src.engine.extraction.sealed_read_gate import (  # noqa: E402
    DEFAULT_TOKEN_PATH,
    SEALED_12_MANIFEST_BASENAME,
    SpentManifestRejected,
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
    if owns_tmp:
        text += f"\n(out_dir={out_dir})"
    # Exit 0 iff a VALID FIDELITY verdict was produced; INVALID (fail-closed) or any
    # non-fidelity outcome is a non-zero, reported-verbatim outcome.
    ok = verdict.get("verdict") in ("FIDELITY_PASS", "FIDELITY_MISS") and _validity_valid(verdict)
    return (0 if ok else 1), text


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
    args = parser.parse_args(argv)

    if args.mode == "staging":
        code, text = run_staging(out_dir=args.out_dir)
    else:
        if not args.work_dir:
            print("HALT: --work-dir is required for --mode sealed", file=sys.stderr)
            return 2
        code, text = run_sealed(
            args.work_dir,
            manifest_path=args.manifest,
            token_path=args.token_path,
            out_dir=args.out_dir,
        )
    print(text)
    return code


if __name__ == "__main__":
    raise SystemExit(main())
