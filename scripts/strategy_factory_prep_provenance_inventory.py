#!/usr/bin/env python3
"""AR-1348A SS6.A -- deterministic prep-provenance inventory (authority-based, not symptom-based).

GPT's AR-1348A explicitly rejected classifying the Step-12 regeneration set by `unanchored_count`
or transcript length ("Video 1 itself proves why: it had 0 unanchored yet used ~13 Gemma locator
calls. AR-1234 retired Gemma because a real quote can still be the WRONG quote."). This script
instead classifies every current-factory prep unit by WHICH LOCATOR BACKEND ACTUALLY RAN, using a
join key that cannot be spoofed by a clean-looking unanchored count:

    backend = "opus_batch"  iff a sibling `<video>__s<N>.opus_batch_receipt.json` exists
                             (written ONLY by scripts/strategy_factory_opus_batch_locator.py's
                             `prep` subcommand -- the driver that dispatches a real Opus subagent).
    backend = "gemma"       iff no such receipt exists AND spine_condition_count > 0
                             (the OLD `strategy_factory_prepare_and_finalize.py cmd_prep` calls
                             `prepare_strategy(..., propose_fn=None)`, which defaults to
                             `anchor_locator`'s real Gemma call for every spine condition --
                             `locate_condition_anchors` is a total partition, so ANY prep with
                             spine_condition_count > 0 and no opus_batch_receipt necessarily ran
                             at least one real Gemma locator call).
    backend = "none"        iff spine_condition_count == 0 (no condition to locate, so
                             `locate_condition_anchors` was never called with anything to do --
                             not the same as "safe", just "the locator authority question does
                             not apply to this unit").

Also covers the population `needs_regeneration` symptom-based sets miss entirely: extraction
records that produced ZERO strategy objects (no prep file ever gets created for those -- the
locator never ran because there was no strategy to certify). These are enumerated from the FULL
39-video extraction-vault population, not just from what has a `.pkl` file on disk, so a video
that silently never reached prep is visible in the inventory rather than absent from it.

`needs_regeneration = true` iff `backend == "gemma"` -- per AR-1348A SS6.B, this is unconditional:
not gated on unanchored_count, transcript length, or whether the final certificate was PASS or
refusal. A prep is not contaminated merely because it exists (backend="none" and pre-existing
opus_batch preps are excluded).
"""
from __future__ import annotations

import hashlib
import json
import os
import pickle  # TRUSTED-LOCAL only: every pkl here was written by this repo's own prep scripts,
# never from network input, an upload, or any other untrusted source -- same precedent as
# strategy_factory_prepare_and_finalize.py / strategy_factory_opus_batch_locator.py.
import sys

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
VAULT_DIR = os.path.join(REPO_ROOT, "docs/replay-results/strategy-factory-census/extraction-vault")
PREP_DIR = os.path.join(VAULT_DIR, "preps")
TRANSCRIPT_DIR = os.path.join(REPO_ROOT, "src/engine/extraction/fixtures/source-evidence")
OUT_PATH = os.path.join(VAULT_DIR, "prep-provenance-inventory.json")


def sha256_file(path: str) -> str | None:
    if not os.path.exists(path):
        return None
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def _validate_receipt(receipt_path: str, video_id: str, strategy_index: int, repo_root: str) -> tuple[bool, str]:
    """AR-1351 F-4: `os.path.exists(receipt_path)` alone proves nothing -- the independent
    grader planted a receipt copied from a DIFFERENT unit and it passed the old check with 0
    of the grader's own 4 content checks agreeing. This validates the receipt's CONTENT against
    the unit it is being read for, not merely its presence:
      1. receipt.video_id / receipt.strategy_index match the filename this receipt lives at
         (catches a copy-pasted receipt from another unit).
      2. receipt.raw_response_sha256 matches a fresh hash of the raw response file it claims to
         describe, computed the same way the driver computed it at write time (text-mode read,
         universal-newline-normalized, matching AR-1351 F-3's fix regardless of whether the file
         on disk still carries pre-fix CRLF bytes or post-fix LF bytes).
    Returns (ok, detail) -- detail is always populated, for both PASS and FAIL, so the caller
    never has to guess what was actually checked.
    """
    if not os.path.exists(receipt_path):
        return False, "no receipt file at this path"
    try:
        with open(receipt_path, "r", encoding="utf-8") as f:
            receipt = json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        return False, f"receipt file unreadable/malformed: {e}"

    if receipt.get("video_id") != video_id or receipt.get("strategy_index") != strategy_index:
        return False, (
            f"receipt identity mismatch: file claims video_id={receipt.get('video_id')!r} "
            f"strategy_index={receipt.get('strategy_index')!r}, but lives at the path for "
            f"video_id={video_id!r} strategy_index={strategy_index!r}"
        )

    raw_response_path = os.path.join(
        repo_root, "docs/replay-results/strategy-factory-census/extraction-vault/opus-batch",
        f"{video_id}__s{strategy_index}", "batch_raw_response.txt",
    )
    claimed_sha = receipt.get("raw_response_sha256")
    if not claimed_sha:
        return False, "receipt has no raw_response_sha256 to verify"
    if not os.path.exists(raw_response_path):
        return False, f"receipt claims raw_response_sha256={claimed_sha} but no raw response file exists at {raw_response_path}"
    with open(raw_response_path, "r", encoding="utf-8") as f:
        actual_text = f.read()
    actual_sha = hashlib.sha256(actual_text.encode("utf-8")).hexdigest()
    if actual_sha != claimed_sha:
        return False, (
            f"raw_response_sha256 MISMATCH: receipt claims {claimed_sha}, actual file at "
            f"{raw_response_path} hashes to {actual_sha}"
        )

    # AR-1353 F-5: the task-sha join AR-1351's own fix point named but this check did not yet
    # implement. Cross-check the receipt's claimed batch_task_sha256 against THIS unit's own
    # batch_task_index.json -- a receipt whose identity fields and raw-response hash were both
    # rewritten to match unit B, but whose task hash still names unit A's task, is caught here.
    task_index_path = os.path.join(
        repo_root, "docs/replay-results/strategy-factory-census/extraction-vault/opus-batch",
        f"{video_id}__s{strategy_index}", "batch_task_index.json",
    )
    claimed_task_sha = receipt.get("batch_task_sha256")
    if claimed_task_sha and os.path.exists(task_index_path):
        with open(task_index_path, "r", encoding="utf-8") as f:
            own_task_index = json.load(f)
        own_task_sha = own_task_index.get("task_sha256")
        if own_task_sha != claimed_task_sha:
            return False, (
                f"batch_task_sha256 MISMATCH: receipt claims {claimed_task_sha}, this unit's own "
                f"batch_task_index.json records {own_task_sha}"
            )
    return True, (
        f"identity + raw_response_sha256 ({actual_sha}) + batch_task_sha256 all verified against disk"
    )


def main() -> int:
    sys.path.insert(0, REPO_ROOT)  # unpickling needs pilot_conveyor's dataclasses importable
    # Exclude this script's OWN output filename: it lives in the same VAULT_DIR it scans, so a
    # prior run's output would otherwise be swept up as a fake "video" with 0 strategies --
    # measured 2026-08-19, produced a phantom unit named "prep-provenance-inventory".
    own_output_name = os.path.basename(OUT_PATH)
    video_json_files = sorted(
        f for f in os.listdir(VAULT_DIR)
        if f.endswith(".json") and f != own_output_name and os.path.isfile(os.path.join(VAULT_DIR, f))
    )

    units = []
    for vf in video_json_files:
        video_id = vf[: -len(".json")]
        vault_path = os.path.join(VAULT_DIR, vf)
        with open(vault_path, "r", encoding="utf-8") as f:
            vault_record = json.load(f)
        strategies = (vault_record.get("extraction") or {}).get("strategies") or []
        transcript_path = os.path.join(TRANSCRIPT_DIR, f"{video_id}.transcript.txt")
        transcript_sha256 = sha256_file(transcript_path)
        extraction_sha256 = sha256_file(vault_path)

        if not strategies:
            units.append({
                "video_id": video_id,
                "strategy_index": None,
                "transcript_path": os.path.relpath(transcript_path, REPO_ROOT),
                "transcript_sha256": transcript_sha256,
                "extraction_path": os.path.relpath(vault_path, REPO_ROOT),
                "extraction_sha256": extraction_sha256,
                "prep_exists": False,
                "spine_condition_count": None,
                "unanchored_condition_count": None,
                "locator_backend": "none",
                "locator_evidence": "extraction produced 0 strategy objects -- no strategy to "
                                     "certify, prepare_strategy/locate_condition_anchors never called",
                "certificate_status": None,
                "needs_regeneration": False,
                "regeneration_reason": "no locator authority question applies -- nothing to locate",
                "duplicate_condition_text_refs": [],
            })
            continue

        for i in range(len(strategies)):
            prep_pkl = os.path.join(PREP_DIR, f"{video_id}__s{i}.pkl")
            receipt_path = os.path.join(PREP_DIR, f"{video_id}__s{i}.opus_batch_receipt.json")
            cert_path = os.path.join(PREP_DIR, f"{video_id}__s{i}.certificate.json")

            if not os.path.exists(prep_pkl):
                units.append({
                    "video_id": video_id,
                    "strategy_index": i,
                    "transcript_path": os.path.relpath(transcript_path, REPO_ROOT),
                    "transcript_sha256": transcript_sha256,
                    "extraction_path": os.path.relpath(vault_path, REPO_ROOT),
                    "extraction_sha256": extraction_sha256,
                    "prep_exists": False,
                    "spine_condition_count": None,
                    "unanchored_condition_count": None,
                    "locator_backend": "unknown_no_prep",
                    "locator_evidence": "strategy object exists in extraction but no prep .pkl "
                                         "was ever generated for it",
                    "certificate_status": None,
                    "needs_regeneration": True,
                    "regeneration_reason": "never prepped -- must run through the authorized "
                                            "Opus locator path for the first time",
                    "duplicate_condition_text_refs": [],
                })
                continue

            with open(prep_pkl, "rb") as f:
                prep = pickle.load(f)
            spine_count = prep.get("spine_condition_count")
            unanchored_count = len(prep.get("unanchored_conditions") or [])
            receipt_ok, receipt_check_detail = _validate_receipt(
                receipt_path, video_id, i, REPO_ROOT
            )

            if receipt_ok:
                with open(receipt_path, "r", encoding="utf-8") as f:
                    receipt = json.load(f)
                backend = "opus_batch"
                evidence = (f"sibling opus_batch_receipt.json present AND CONTENT-VALIDATED "
                            f"(AR-1351 F-4): {receipt_check_detail}. raw_response_sha256="
                            f"{receipt.get('raw_response_sha256')}, "
                            f"invocation={receipt.get('invocation')}")
                needs = False
                reason = "already regenerated under the authorized Opus batch locator"
            elif os.path.exists(receipt_path):
                # AR-1351 F-4: a receipt FILE exists but failed content validation (identity
                # mismatch or hash mismatch against its own claimed raw response) -- treat as
                # UNTRUSTED, not as evidence of regeneration. Existence alone proved nothing;
                # this is the exact gap the independent grader's planted-bad control exploited
                # (a receipt for a DIFFERENT unit copied into this one's directory fired 0 of the
                # old existence-only check's signals).
                backend = "gemma"
                evidence = (f"opus_batch_receipt.json EXISTS but FAILED content validation: "
                            f"{receipt_check_detail} -- not trusted as evidence of a real "
                            f"regeneration for THIS unit")
                needs = True
                reason = ("a receipt file is present but its content does not verify against "
                          "this unit's own identity/raw response -- must be regenerated for real "
                          "rather than trusted on the basis of file existence alone")
            elif spine_count and spine_count > 0:
                backend = "gemma"
                evidence = (f"no opus_batch_receipt.json sibling and spine_condition_count="
                            f"{spine_count} > 0 -- locate_condition_anchors is a total partition, "
                            f"so at least {spine_count} real anchor_locator._default_propose_fn "
                            f"(Gemma) calls occurred for this unit")
                needs = True
                reason = ("load-bearing locator was Gemma during the post-AR-1234 authority-"
                          "regression window -- AR-1345A revoked Gemma's load-bearing authority "
                          "unconditionally, independent of this unit's unanchored_count "
                          f"({unanchored_count}) or transcript length")
            else:
                backend = "none"
                evidence = f"spine_condition_count={spine_count} -- no condition existed to locate"
                needs = False
                reason = "no locator authority question applies -- nothing to locate"

            cert_status = None
            if os.path.exists(cert_path):
                with open(cert_path, "r", encoding="utf-8") as f:
                    cert = json.load(f)
                cert_status = {
                    "pilot_grade": cert.get("pilot_grade"),
                    "full_grade": cert.get("full_grade"),
                    "diagnosis": cert.get("diagnosis"),
                }

            # AR-1353 F-6: disclose, never silently accept, that this unit's batch task had two
            # or more conditions sharing identical condition_text -- the F-2 desync guard (added
            # AFTER this unit's own emit ran, for units regenerated under AR-1348A) could not
            # have disambiguated a same-call misattribution between them. Bounded severity per
            # AR-1353's own measurement: a same-text collision means the located quote is by
            # construction equally valid for either condition_ref, so this is a REF-level
            # attribution exposure, not a quote-correctness one -- disclosed, not grounds to
            # mark the unit needing regeneration.
            duplicate_condition_text_refs = []
            if backend == "opus_batch":
                task_index_path = os.path.join(
                    REPO_ROOT, "docs/replay-results/strategy-factory-census/extraction-vault/opus-batch",
                    f"{video_id}__s{i}", "batch_task_index.json",
                )
                if os.path.exists(task_index_path):
                    with open(task_index_path, "r", encoding="utf-8") as f:
                        task_index = json.load(f)
                    seen_text: dict[str, str] = {}
                    for c in task_index.get("conditions", []):
                        prior = seen_text.get(c["condition_text"])
                        if prior is not None:
                            duplicate_condition_text_refs.append(
                                {"ref_a": prior, "ref_b": c["condition_ref"]}
                            )
                        else:
                            seen_text[c["condition_text"]] = c["condition_ref"]

            units.append({
                "video_id": video_id,
                "strategy_index": i,
                "transcript_path": os.path.relpath(transcript_path, REPO_ROOT),
                "transcript_sha256": transcript_sha256,
                "extraction_path": os.path.relpath(vault_path, REPO_ROOT),
                "extraction_sha256": extraction_sha256,
                "prep_exists": True,
                "spine_condition_count": spine_count,
                "unanchored_condition_count": unanchored_count,
                "locator_backend": backend,
                "locator_evidence": evidence,
                "certificate_status": cert_status,
                "needs_regeneration": needs,
                "regeneration_reason": reason,
                "duplicate_condition_text_refs": duplicate_condition_text_refs,
            })

    summary = {
        "total_units": len(units),
        "by_backend": {},
        "needs_regeneration_count": sum(1 for u in units if u["needs_regeneration"]),
    }
    for u in units:
        summary["by_backend"][u["locator_backend"]] = summary["by_backend"].get(u["locator_backend"], 0) + 1

    out = {
        "artifact": "ar-1345a-step12-prep-provenance-inventory",
        "authority": "AR-1348A SS6.A/B -- classify by actual locator provenance, never by "
                     "unanchored_count or transcript length",
        "scope": {
            "enumeration_surface": (
                f"every *.json file directly under {os.path.relpath(VAULT_DIR, REPO_ROOT)} "
                "(this script's own output filename excluded), one video's extraction record "
                "per file"
            ),
            "known_exclusions_not_a_gap": (
                "AR-1351 F-5 (independent grader): two populations of prep units live OUTSIDE "
                "this enumeration surface by design, not by accident -- (1) the sVkm/G2-D lane "
                "(docs/replay-results/svkm-extraction-certified/), a separately-authorized, "
                "already-certified AR-1234 pin video with its own dedicated toolchain "
                "(svkm_opus_batch_locator.py etc.), never in scope for this factory's own "
                "vault-driven population; (2) the sealed H1 pilot preps under "
                "h1-scripts/pilot-run/preps/ (sealed 2026-07-12, commit 8f9c8c1d) -- sealed-pilot "
                "integrity forbids regenerating a sealed artifact, so this cleanup does not "
                "reach it. Neither exclusion is a contaminated unit hiding outside the count; "
                "both were independently checked by the grader and found to carry no live "
                "AR-1345A-authority-regression exposure. Any FUTURE population outside this "
                "surface is a real gap and must be named, not silently assumed excluded."
            ),
        },
        "summary": summary,
        "units": units,
    }
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)

    print(json.dumps(summary, indent=2))
    print(f"\nfull inventory written to {os.path.relpath(OUT_PATH, REPO_ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
