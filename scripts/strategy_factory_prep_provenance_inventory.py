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
                })
                continue

            with open(prep_pkl, "rb") as f:
                prep = pickle.load(f)
            spine_count = prep.get("spine_condition_count")
            unanchored_count = len(prep.get("unanchored_conditions") or [])
            has_receipt = os.path.exists(receipt_path)

            if has_receipt:
                with open(receipt_path, "r", encoding="utf-8") as f:
                    receipt = json.load(f)
                backend = "opus_batch"
                evidence = (f"sibling opus_batch_receipt.json present: raw_response_sha256="
                            f"{receipt.get('raw_response_sha256')}, "
                            f"invocation={receipt.get('invocation')}")
                needs = False
                reason = "already regenerated under the authorized Opus batch locator"
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
