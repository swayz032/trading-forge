"""H1 sealed-12 terminal-read driver — MODULE A: seal-verification + operator-gate.

Spec: docs/designs/h1-sealed12-driver-ratify-packet-2026-07-16.md (Module A) +
docs/designs/ADVISOR-RULINGS.md R-015 §6-CONSOLIDATED items 0 + 9, as corrected
by R-016.

This is the safety-critical foundation of the sealed read. It does two things and
NOTHING else:

  Item 0 — SEAL VERIFICATION. The driver must never read the wrong video set. This
  module loads the sealed manifest DIRECTLY from its frozen JSON artifact, recomputes
  the sha256 over the newline-joined sorted video_id list (the manifest's own
  ``sealed_sha256_method``), and confirms it matches the declared ``sealed_sha256``.
  Any mismatch ⇒ ok=False (tamper/corruption/wrong-file) ⇒ the caller HALTS. It also
  refuses the SPENT pilot-16 manifest so the exhausted set can never be read as the
  exam.

  Item 9 — OPERATOR GATE (mechanical). A sealed read is REFUSED unless the operator
  go-token (``docs/designs/SEAL-GO.token``) exists and is non-empty. Tonio authors that
  token in his own words; this module NEVER creates it. Staging/rehearsal mode accepts
  ONLY spent-video manifests and refuses the sealed-12.

R-016 LAW (structural, non-negotiable): load-bearing identifiers are NEVER
hand-transcribed into code. The sealed-12 sha and its video-id list are READ FROM THE
FROZEN ARTIFACT AT RUNTIME and recomputed — they appear NOWHERE in this module (not even
as a comment). The ONLY hardcoded literals are (a) the two campaign manifest *basenames*
(filenames, not load-bearing identifiers) and (b) the SPENT pilot-16 sha as an explicit
REFUSE-TARGET — a guard so the spent set is rejected even if renamed.

Pure, deterministic, no LLM, no network. Never opens/reads transcript CONTENT; the
manifest's transcript probe is existence-only by frozen design.
"""

from __future__ import annotations

import hashlib
import json
import os

# --- Campaign manifest basenames (filenames — NOT load-bearing sha/id-list) --------

#: The SPENT pilot-16 manifest. Must be REJECTED for any sealed read.
SPENT_16_MANIFEST_BASENAME = "h1-sealed-fresh-set-2026-07-12.json"

#: The frozen sealed-12 fresh-set manifest. The sealed exam. Refused in staging mode.
SEALED_12_MANIFEST_BASENAME = "h1-wave6-sealed-fresh-set-2026-07-12.json"

#: The spent pilot-16 sha as an explicit REFUSE-TARGET (item-0 hard guard). This is the
#: sha of the EXHAUSTED set we must never read — hardcoding it as a *reject* value is
#: the anti-footgun, not an identifier we trust to define the exam. (R-016: the sealed
#: fresh-set sha is deliberately absent — it is recomputed from the frozen artifact.)
SPENT_16_SHA256_REJECT_TARGET = (
    "8e39ffe150751fdb4f78d2bb754755587b0363f412284b855bd51b43378d79e3"
)

#: Canonical seal method this module implements (matches the manifest's declared method).
_CANONICAL_SHA_METHOD = "sha256 over the newline-joined sorted video_id list."

#: Default operator go-token path (Tonio authors it; this module NEVER creates it).
DEFAULT_TOKEN_PATH = "docs/designs/SEAL-GO.token"

#: Modes that mean "rehearsal / dress-run on SPENT videos", never the sealed exam.
_STAGING_MODES = frozenset({"staging", "rehearsal"})


class SpentManifestRejected(Exception):
    """Raised by :func:`reject_if_spent16` when the spent pilot-16 manifest is
    presented for a sealed read (matched by basename and/or by its refuse-target sha)."""


def _video_ids_sorted(manifest: dict) -> list[str]:
    """Deterministically extract the sorted video_id list from a raw manifest dict.

    Primary source is the per-video ``videos[].video_id`` records (the authoritative
    entries carrying the transcript existence probe). Falls back to a pre-sorted
    ``sealed_id_list_sorted`` only if ``videos`` is absent. Sorting is always applied
    here so the recomputation never trusts a caller-supplied ordering.
    """
    if isinstance(manifest.get("videos"), list) and manifest["videos"]:
        ids = [v["video_id"] for v in manifest["videos"]]
    elif isinstance(manifest.get("sealed_id_list_sorted"), list):
        ids = list(manifest["sealed_id_list_sorted"])
    else:
        raise KeyError("manifest has neither 'videos' nor 'sealed_id_list_sorted'")
    return sorted(ids)


def _recompute_seal_sha(video_ids_sorted: list[str]) -> str:
    """The frozen method: sha256 over the newline-joined SORTED video_id list."""
    payload = "\n".join(video_ids_sorted).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def verify_sealed_manifest(manifest_path: str) -> dict:
    """Load a sealed manifest and verify its declared sha against a recomputation.

    Reads the JSON at ``manifest_path``, extracts the sorted ``video_id`` list, and
    recomputes the sha256 per the frozen method. NEVER raises on a bad/mismatched
    manifest — returns ``ok=False`` with a ``mismatch_reason`` so the caller can
    fail-closed. No sha or id-list is hardcoded; the declared sha comes from the file.

    Returns a dict::

        {ok, manifest_path, declared_sha, computed_sha, video_ids, n, mismatch_reason}

    ``ok`` is True iff computed_sha == declared_sha.
    """
    result = {
        "ok": False,
        "manifest_path": manifest_path,
        "declared_sha": None,
        "computed_sha": None,
        "video_ids": [],
        "n": 0,
        "declared_method": None,
        "mismatch_reason": None,
    }
    try:
        with open(manifest_path, encoding="utf-8") as fh:
            manifest = json.load(fh)
    except FileNotFoundError:
        result["mismatch_reason"] = "manifest_not_found"
        return result
    except (OSError, json.JSONDecodeError) as exc:
        result["mismatch_reason"] = f"manifest_unreadable: {exc}"
        return result

    declared = manifest.get("sealed_sha256")
    if not isinstance(declared, str) or not declared:
        result["mismatch_reason"] = "declared_sha_missing"
        return result
    result["declared_sha"] = declared
    result["declared_method"] = manifest.get("sealed_sha256_method")

    try:
        ids = _video_ids_sorted(manifest)
    except KeyError as exc:
        result["mismatch_reason"] = f"video_ids_missing: {exc}"
        return result

    computed = _recompute_seal_sha(ids)
    result["video_ids"] = ids
    result["n"] = len(ids)
    result["computed_sha"] = computed

    if computed == declared:
        result["ok"] = True
    else:
        result["mismatch_reason"] = (
            f"sha_mismatch: computed {computed} != declared {declared}"
        )
    return result


def verify_transcripts_present(manifest: dict, fetched: dict) -> dict:
    """Confirm every sealed video_id was retrievable in the live fetch (existence-only).

    ``manifest`` may be either a verified-manifest record (from
    :func:`verify_sealed_manifest`, carrying ``video_ids``) or a raw manifest dict
    (carrying ``videos``/``sealed_id_list_sorted``). ``fetched`` maps
    ``video_id -> fetched_char_count`` from the driver's live transcript fetch.

    The frozen design inspects PRESENCE/retrievability ONLY — transcript CONTENT is
    never read, so char counts are NOT compared against the sealed probe values.
    Fail-closed: ``ok`` requires the fetched set to match the sealed set EXACTLY (no
    missing AND no extra) so a wrong/superset fetch cannot slip through.

    Returns ``{ok, missing:[...], extra:[...]}``.
    """
    if isinstance(manifest.get("video_ids"), list) and manifest["video_ids"]:
        manifest_ids = set(manifest["video_ids"])
    else:
        manifest_ids = set(_video_ids_sorted(manifest))
    fetched_ids = set(fetched or {})

    missing = sorted(manifest_ids - fetched_ids)
    extra = sorted(fetched_ids - manifest_ids)
    return {"ok": (not missing and not extra), "missing": missing, "extra": extra}


def reject_if_spent16(manifest_path: str) -> None:
    """Hard guard: refuse the SPENT pilot-16 manifest for a sealed read.

    Refuses by BASENAME (``h1-sealed-fresh-set-2026-07-12.json``) AND by its
    refuse-target sha (``8e39ffe1…``) if the manifest verifies to that sha. Returns
    ``None`` when the manifest is not the spent set; raises
    :class:`SpentManifestRejected` otherwise. This ensures the exhausted set can never
    be read as the exam even if the file is renamed.
    """
    basename = os.path.basename(str(manifest_path))
    if basename == SPENT_16_MANIFEST_BASENAME:
        raise SpentManifestRejected(
            f"spent pilot-16 manifest rejected by basename: {basename}"
        )
    verify = verify_sealed_manifest(manifest_path)
    if verify.get("computed_sha") == SPENT_16_SHA256_REJECT_TARGET:
        raise SpentManifestRejected(
            "spent pilot-16 manifest rejected by sha: "
            f"{SPENT_16_SHA256_REJECT_TARGET}"
        )
    return None


def _token_present(token_path: str) -> bool:
    """True iff the operator go-token exists and is non-empty (whitespace-stripped)."""
    try:
        with open(token_path, encoding="utf-8") as fh:
            return len(fh.read().strip()) > 0
    except (FileNotFoundError, OSError):
        return False


def operator_gate(
    mode: str,
    manifest_path: str,
    token_path: str = DEFAULT_TOKEN_PATH,
) -> dict:
    """Mechanical operator gate (item 9). Fail-closed on any unknown mode.

    ``mode == "sealed"``: REFUSE unless ``token_path`` exists and is non-empty. This
    module NEVER creates the token — the operator authors it. Present ⇒ allowed.

    ``mode in {"staging","rehearsal"}``: accept ONLY spent-video manifests — refuse the
    sealed-12 fresh-set manifest (by basename). Spent-16 and explicit rehearsal
    manifests of spent design-pool videos are accepted.

    Any other mode ⇒ refused (fail-closed).

    Returns ``{allowed, mode, reason|None}``.
    """
    if mode == "sealed":
        if _token_present(token_path):
            return {"allowed": True, "mode": mode, "reason": None}
        return {"allowed": False, "mode": mode, "reason": "no_seal_go_token"}

    if mode in _STAGING_MODES:
        basename = os.path.basename(str(manifest_path))
        if basename == SEALED_12_MANIFEST_BASENAME:
            return {
                "allowed": False,
                "mode": mode,
                "reason": "sealed_manifest_refused_in_staging",
            }
        return {"allowed": True, "mode": mode, "reason": None}

    return {"allowed": False, "mode": mode, "reason": f"unknown_mode:{mode}"}


def gate_sealed_read(
    manifest_path: str,
    mode: str,
    token_path: str = DEFAULT_TOKEN_PATH,
    fetched: dict | None = None,
) -> dict:
    """The item-0 + item-9 composed gate the driver calls BEFORE any read.

    Composition order:
      1. reject_if_spent16  (sealed mode only — staging legitimately reads spent sets)
      2. operator_gate      (token for sealed; spent-only for staging; fail-closed)
      3. verify_sealed_manifest  (sha self-consistency / tamper-evidence)
      4. verify_transcripts_present  (only if ``fetched`` is provided)

    ANY failure ⇒ ``allowed=False`` with a ``halt_reason``; the driver NEVER proceeds.

    Returns ``{allowed, verified, halt_reason|None, record}`` where ``record`` carries
    every sub-result for the audit trail.
    """
    record: dict = {
        "mode": mode,
        "manifest_path": manifest_path,
        "spent16_reject": None,
        "operator_gate": None,
        "verify": None,
        "transcripts": None,
    }

    # 1. Spent-16 hard guard (sealed mode only).
    if mode == "sealed":
        try:
            reject_if_spent16(manifest_path)
            record["spent16_reject"] = {"rejected": False}
        except SpentManifestRejected as exc:
            record["spent16_reject"] = {"rejected": True, "reason": str(exc)}
            return {
                "allowed": False,
                "verified": False,
                "halt_reason": f"spent16_rejected: {exc}",
                "record": record,
            }

    # 2. Operator gate (mechanical).
    gate = operator_gate(mode, manifest_path, token_path=token_path)
    record["operator_gate"] = gate
    if not gate["allowed"]:
        return {
            "allowed": False,
            "verified": False,
            "halt_reason": f"operator_gate_refused: {gate['reason']}",
            "record": record,
        }

    # 3. Seal verification (tamper-evidence).
    verify = verify_sealed_manifest(manifest_path)
    record["verify"] = verify
    if not verify["ok"]:
        return {
            "allowed": False,
            "verified": False,
            "halt_reason": f"seal_verify_failed: {verify['mismatch_reason']}",
            "record": record,
        }

    # 4. Transcript existence (only when the live fetch is supplied).
    if fetched is not None:
        transcripts = verify_transcripts_present(verify, fetched)
        record["transcripts"] = transcripts
        if not transcripts["ok"]:
            return {
                "allowed": False,
                "verified": True,
                "halt_reason": (
                    "transcripts_incomplete: "
                    f"missing={transcripts['missing']} extra={transcripts['extra']}"
                ),
                "record": record,
            }

    return {
        "allowed": True,
        "verified": True,
        "halt_reason": None,
        "record": record,
    }
