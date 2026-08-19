#!/usr/bin/env python3
"""Adversarial proof for strategy_factory_faithful_compile_handoff.py.

Uses a real current Factory unit as the base fixture, mutates only in-memory copies, and proves
that metadata cannot be promoted to compile-ready by changing a single headline flag. The final
positive control constructs the metadata state a FUTURE genuinely clean unit must carry; it does
not claim the current refused unit became clean.
"""
from __future__ import annotations

import copy
import hashlib
import importlib.util
import json
import os
import sys

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
MODULE = os.path.join(REPO, "scripts", "strategy_factory_faithful_compile_handoff.py")
spec = importlib.util.spec_from_file_location("handoff", MODULE)
h = importlib.util.module_from_spec(spec)
assert spec.loader is not None
sys.modules[spec.name] = h
spec.loader.exec_module(h)

VIDEO = "75DJN5UVQnw"
INDEX = 0


def load(path: str) -> dict:
    with open(os.path.join(REPO, path), "r", encoding="utf-8") as f:
        return json.load(f)


def sha(path: str) -> str:
    with open(os.path.join(REPO, path), "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


projection0 = load("docs/replay-results/strategy-factory-census/manifest-row-disposition-projection.json")
inventory0 = load("docs/replay-results/strategy-factory-census/extraction-vault/prep-provenance-inventory.json")
vault0 = load(f"docs/replay-results/strategy-factory-census/extraction-vault/{VIDEO}.json")
cert0 = load(f"docs/replay-results/strategy-factory-census/extraction-vault/preps/{VIDEO}__s0.certificate.json")
extract_sha = sha(f"docs/replay-results/strategy-factory-census/extraction-vault/{VIDEO}.json")
transcript_sha = sha(f"src/engine/extraction/fixtures/source-evidence/{VIDEO}.transcript.txt")


def call(projection, inventory, vault, cert, ex_sha=extract_sha, tr_sha=transcript_sha):
    try:
        h.admit_loaded(
            video_id=VIDEO,
            strategy_index=INDEX,
            projection=projection,
            inventory=inventory,
            vault_record=vault,
            certificate=cert,
            actual_extraction_sha256=ex_sha,
            actual_transcript_sha256=tr_sha,
        )
    except h.HandoffRefusal as exc:
        return False, exc.reason, exc.detail
    return True, "ADMITTED", ""


def ready_projection():
    p = copy.deepcopy(projection0)
    for row in p.get("rows", []):
        if row.get("spec_video") == VIDEO:
            row["disposition"] = h.READY
            row["disposition_reason"] = "SYNTHETIC POSITIVE-CONTROL ONLY"
    return p


def clean_metadata_cert():
    c = copy.deepcopy(cert0)
    c["pilot_grade"] = True
    c["certificate_grade"] = True
    c["dry_run"] = False
    c["provenance_binding"] = {"status": h.BOUND}
    c.setdefault("provenance", {})["source_video_id"] = VIDEO
    c["provenance"]["full_transcript_sha256"] = transcript_sha
    c["strategy_index"] = INDEX
    return c


results = {}

# 1. The real current Factory refusal cannot enter compilation.
ok, reason, detail = call(projection0, inventory0, vault0, cert0)
results["REAL_CURRENT_REFUSAL_BLOCKED"] = {"pass": (not ok and reason == "FACTORY_DISPOSITION_NOT_COMPILE_READY"), "reason": reason, "detail": detail}

# 2. Flipping only the projection headline cannot launder a failed certificate.
p = ready_projection()
ok, reason, detail = call(p, inventory0, vault0, cert0)
results["PROJECTION_ONLY_LAUNDERING_BLOCKED"] = {"pass": (not ok and reason == "CERTIFICATE_NOT_PILOT_CLEAN"), "reason": reason, "detail": detail}

# 3. Flipping certificate grades too still cannot admit historical/unreceipted semantic answers.
c = copy.deepcopy(cert0)
c["pilot_grade"] = True
c["certificate_grade"] = True
ok, reason, detail = call(p, inventory0, vault0, c)
results["UNBOUND_CERTIFICATE_BLOCKED"] = {"pass": (not ok and reason == "UNBOUND_CERTIFICATE_REFUSED"), "reason": reason, "detail": detail}

# 4. Even a BOUND clean-looking certificate cannot claim another source video.
c = clean_metadata_cert()
c["provenance"]["source_video_id"] = "WRONG_VIDEO"
ok, reason, detail = call(p, inventory0, vault0, c)
results["CERT_SOURCE_IDENTITY_SWAP_BLOCKED"] = {"pass": (not ok and reason == "CERTIFICATE_SOURCE_VIDEO_MISMATCH"), "reason": reason, "detail": detail}

# 5. Transcript mutation after certification is refused.
c = clean_metadata_cert()
ok, reason, detail = call(p, inventory0, vault0, c, tr_sha="0" * 64)
results["TRANSCRIPT_MUTATION_BLOCKED"] = {"pass": (not ok and reason == "TRANSCRIPT_HASH_DRIFT"), "reason": reason, "detail": detail}

# 6. Extraction mutation after inventory/certification is refused.
ok, reason, detail = call(p, inventory0, vault0, c, ex_sha="1" * 64)
results["EXTRACTION_MUTATION_BLOCKED"] = {"pass": (not ok and reason == "EXTRACTION_HASH_DRIFT"), "reason": reason, "detail": detail}

# 7. A second modern strategy identity makes the source->manifest identity ambiguous again.
i = copy.deepcopy(inventory0)
base_unit = next(u for u in i["units"] if u.get("video_id") == VIDEO and u.get("strategy_index") == 0)
extra = copy.deepcopy(base_unit)
extra["strategy_index"] = 1
i["units"].append(extra)
ok, reason, detail = call(p, i, vault0, c)
results["MULTI_STRATEGY_IDENTITY_AMBIGUITY_BLOCKED"] = {"pass": (not ok and reason == "SOURCE_STRATEGY_IDENTITY_NOT_UNIQUE"), "reason": reason, "detail": detail}

# 8. Locator authority regression cannot compile.
i = copy.deepcopy(inventory0)
next(u for u in i["units"] if u.get("video_id") == VIDEO and u.get("strategy_index") == 0)["locator_backend"] = "gemma"
ok, reason, detail = call(p, i, vault0, c)
results["RETIRED_LOCATOR_AUTHORITY_BLOCKED"] = {"pass": (not ok and reason == "LOCATOR_AUTHORITY_NOT_CURRENT"), "reason": reason, "detail": detail}

# 9. Positive metadata control: when every required independent anchor is made consistent,
# admission succeeds. This does NOT compile the current unit and does NOT relabel its real cert.
ok, reason, detail = call(p, inventory0, vault0, clean_metadata_cert())
results["FUTURE_CLEAN_METADATA_STATE_ADMITS"] = {"pass": ok, "reason": reason, "detail": detail}

print(json.dumps(results, indent=2))
all_pass = all(v["pass"] for v in results.values())
print("\nALL HANDOFF ADMISSION CONTROLS PASSED" if all_pass else "HANDOFF ADMISSION CONTROL FAILURE")
raise SystemExit(0 if all_pass else 1)
