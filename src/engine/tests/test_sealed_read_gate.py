"""Birth-gate for MODULE A of the sealed-12 terminal-read driver:
seal-verification + operator-gate (R-015 §6-CONSOLIDATED items 0 + 9, R-016 law).

Every first-class target proven by execution against the REAL frozen manifests:
  (a) real 12 manifest verifies (computed sha == 4d7b3c29…, n == 12).
  (b) spent-16 manifest verifies to ITS own 8e39ffe1… sha, BUT reject_if_spent16 /
      gate_sealed_read(sealed) REFUSE it (by name AND by sha).
  (c) a TAMPERED copy of the 12 manifest ⇒ verify ok=False ⇒ gate HALTs.
  (d) operator_gate(sealed) refuses with no token, allows with a non-empty token.
  (e) staging refuses the sealed-12, accepts the spent-16.
  (f) unknown mode ⇒ refused (fail-closed).
  (g) enforced separately by a grep in the receipt: no hardcoded 4d7b3c29.

Pure stdlib; no LLM, no network. Temp files are always cleaned up; NO real
SEAL-GO.token is ever created.
"""

import json
import os
import tempfile

import pytest

from src.engine.extraction.sealed_read_gate import (
    SPENT_16_MANIFEST_BASENAME,
    SpentManifestRejected,
    gate_sealed_read,
    operator_gate,
    reject_if_spent16,
    verify_sealed_manifest,
    verify_transcripts_present,
)

# Repo-root-relative paths (pytest runs from repo root, per existing suite convention).
DESIGNS = os.path.join("docs", "designs")
SEALED_12 = os.path.join(DESIGNS, "h1-wave6-sealed-fresh-set-2026-07-12.json")
SPENT_16 = os.path.join(DESIGNS, "h1-sealed-fresh-set-2026-07-12.json")

SEALED_12_SHA_PREFIX = "4d7b3c29"
SPENT_16_SHA_PREFIX = "8e39ffe1"


# --- (a) real 12 manifest verifies -------------------------------------------------

def test_a_real_sealed12_verifies():
    res = verify_sealed_manifest(SEALED_12)
    assert res["ok"] is True, res["mismatch_reason"]
    assert res["computed_sha"] == res["declared_sha"]
    assert res["computed_sha"].startswith(SEALED_12_SHA_PREFIX)
    assert res["n"] == 12
    assert len(res["video_ids"]) == 12
    assert res["video_ids"] == sorted(res["video_ids"])  # recomputation sorts


# --- (b) spent-16 verifies to its OWN sha but is REFUSED for the sealed read --------

def test_b_spent16_self_consistent_but_rejected():
    # It is internally self-consistent (verifies to its own 8e39ffe1 sha)...
    res = verify_sealed_manifest(SPENT_16)
    assert res["ok"] is True
    assert res["computed_sha"].startswith(SPENT_16_SHA_PREFIX)
    assert res["n"] == 16

    # ...yet reject_if_spent16 refuses it (basename match).
    with pytest.raises(SpentManifestRejected):
        reject_if_spent16(SPENT_16)

    # ...and refuses by SHA even if renamed (copy to a neutral name).
    fd, tmp = tempfile.mkstemp(suffix=".json", prefix="renamed_spent16_")
    os.close(fd)
    try:
        with open(SPENT_16, encoding="utf-8") as fh:
            data = fh.read()
        with open(tmp, "w", encoding="utf-8") as fh:
            fh.write(data)
        assert os.path.basename(tmp) != SPENT_16_MANIFEST_BASENAME
        with pytest.raises(SpentManifestRejected):
            reject_if_spent16(tmp)  # caught by sha, not name
    finally:
        os.remove(tmp)

    # ...and the composed sealed gate HALTs on it (token present would-be-allowed,
    # but spent16 rejection fires FIRST).
    fd, tok = tempfile.mkstemp(suffix=".token", prefix="seal_go_")
    os.close(fd)
    try:
        with open(tok, "w", encoding="utf-8") as fh:
            fh.write("go")
        out = gate_sealed_read(SPENT_16, "sealed", token_path=tok)
        assert out["allowed"] is False
        assert "spent16_rejected" in out["halt_reason"]
    finally:
        os.remove(tok)


# --- (c) tampered 12 manifest ⇒ verify fails ⇒ gate halts ---------------------------

def test_c_tampered_manifest_halts():
    with open(SEALED_12, encoding="utf-8") as fh:
        manifest = json.load(fh)
    # Drop one video_id → recomputed sha no longer matches the (untouched) declared sha.
    manifest["videos"] = manifest["videos"][:-1]

    fd, tmp = tempfile.mkstemp(suffix=".json", prefix="tampered_sealed12_")
    os.close(fd)
    try:
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(manifest, fh)

        res = verify_sealed_manifest(tmp)
        assert res["ok"] is False
        assert res["n"] == 11
        assert "sha_mismatch" in res["mismatch_reason"]

        # A present token must NOT rescue a tampered manifest.
        fd2, tok = tempfile.mkstemp(suffix=".token", prefix="seal_go_")
        os.close(fd2)
        try:
            with open(tok, "w", encoding="utf-8") as fh:
                fh.write("go")
            out = gate_sealed_read(tmp, "sealed", token_path=tok)
            assert out["allowed"] is False
            assert "seal_verify_failed" in out["halt_reason"]
        finally:
            os.remove(tok)
    finally:
        os.remove(tmp)


def test_c2_declared_sha_altered_ids_intact_still_halts():
    # Second, non-avalanche witness of the sha-comparison NEGATIVE path (grader
    # residual 2026-07-16): leave the video_ids untouched so the RECOMPUTED sha is
    # the correct 4d7b3c29..., but corrupt only the DECLARED sha. A prefix-only or
    # otherwise-narrowed comparison would slip this; a full-equality check must HALT.
    with open(SEALED_12, encoding="utf-8") as fh:
        manifest = json.load(fh)
    good = manifest["sealed_sha256"]
    # Flip the LAST hex char only (keeps the whole prefix identical → defeats a
    # prefix-match regression specifically).
    manifest["sealed_sha256"] = good[:-1] + ("0" if good[-1] != "0" else "1")

    fd, tmp = tempfile.mkstemp(suffix=".json", prefix="declared_sha_altered_")
    os.close(fd)
    try:
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(manifest, fh)
        res = verify_sealed_manifest(tmp)
        assert res["ok"] is False
        assert res["computed_sha"] == good, "ids intact → recompute must equal the true sha"
        assert res["declared_sha"] != good
        assert "sha_mismatch" in res["mismatch_reason"]
    finally:
        os.remove(tmp)


# --- (d) operator gate: token governs the sealed read ------------------------------

def test_d_operator_gate_token_required():
    # No token file at a path that does not exist → refused.
    missing = os.path.join(tempfile.gettempdir(), "definitely_no_such_seal_go.token")
    assert not os.path.exists(missing)
    refused = operator_gate("sealed", SEALED_12, token_path=missing)
    assert refused["allowed"] is False
    assert refused["reason"] == "no_seal_go_token"

    # An EMPTY token is still refused (non-empty required).
    fd, tok = tempfile.mkstemp(suffix=".token", prefix="seal_go_empty_")
    os.close(fd)
    try:
        with open(tok, "w", encoding="utf-8") as fh:
            fh.write("   \n")  # whitespace only
        empty = operator_gate("sealed", SEALED_12, token_path=tok)
        assert empty["allowed"] is False
        assert empty["reason"] == "no_seal_go_token"

        # Non-empty token → allowed.
        with open(tok, "w", encoding="utf-8") as fh:
            fh.write("Tonio says go 2026-07-16")
        allowed = operator_gate("sealed", SEALED_12, token_path=tok)
        assert allowed["allowed"] is True
        assert allowed["reason"] is None
    finally:
        os.remove(tok)


def test_d2_full_gate_allows_with_token_and_fetch():
    # End-to-end sealed happy path: token present + full transcript fetch present.
    res = verify_sealed_manifest(SEALED_12)
    fetched = {vid: 100 for vid in res["video_ids"]}  # existence only; counts arbitrary

    fd, tok = tempfile.mkstemp(suffix=".token", prefix="seal_go_")
    os.close(fd)
    try:
        with open(tok, "w", encoding="utf-8") as fh:
            fh.write("go")
        out = gate_sealed_read(SEALED_12, "sealed", token_path=tok, fetched=fetched)
        assert out["allowed"] is True
        assert out["verified"] is True
        assert out["halt_reason"] is None

        # A missing transcript in the fetch HALTs (fail-closed existence check).
        short = dict(fetched)
        short.pop(res["video_ids"][0])
        out2 = gate_sealed_read(SEALED_12, "sealed", token_path=tok, fetched=short)
        assert out2["allowed"] is False
        assert "transcripts_incomplete" in out2["halt_reason"]
    finally:
        os.remove(tok)


# --- (e) staging accepts only spent manifests --------------------------------------

def test_e_staging_refuses_sealed12_accepts_spent16():
    refused = operator_gate("staging", SEALED_12)
    assert refused["allowed"] is False
    assert refused["reason"] == "sealed_manifest_refused_in_staging"

    allowed = operator_gate("staging", SPENT_16)
    assert allowed["allowed"] is True

    # rehearsal is an alias for staging semantics.
    assert operator_gate("rehearsal", SEALED_12)["allowed"] is False
    assert operator_gate("rehearsal", SPENT_16)["allowed"] is True


# --- (f) unknown mode ⇒ fail-closed ------------------------------------------------

def test_f_unknown_mode_refused():
    out = operator_gate("live", SEALED_12)
    assert out["allowed"] is False
    assert out["reason"].startswith("unknown_mode")

    composed = gate_sealed_read(SEALED_12, "banana")
    assert composed["allowed"] is False
    assert "operator_gate_refused" in composed["halt_reason"]


# --- transcript helper direct coverage ---------------------------------------------

def test_transcripts_present_exact_match_and_extra():
    res = verify_sealed_manifest(SEALED_12)
    ids = res["video_ids"]
    exact = verify_transcripts_present(res, {v: 1 for v in ids})
    assert exact["ok"] is True and not exact["missing"] and not exact["extra"]

    extra = verify_transcripts_present(res, {**{v: 1 for v in ids}, "ZZZINTRUDER": 1})
    assert extra["ok"] is False
    assert extra["extra"] == ["ZZZINTRUDER"]
