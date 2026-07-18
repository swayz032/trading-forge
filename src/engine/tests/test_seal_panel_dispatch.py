"""R-034 — seal-day PANEL dispatch (5th seam) + input-faithfulness parity.

The panel dispatch produces panels/<cid>.json = {conflation, enumeration_consistency,
completeness} via the 3 calibrated gpt-5.4 graders (prompts BYTE-UNCHANGED), fed the
THREADED seal-day inputs (consensus element_inventory + coaching_notes, the sealed
extraction, the transcript). No live model — the openai_call seam is stubbed.

Parity pins: the content axis carries the TIER-A element_inventory + TIER-B
coaching_notes; the extraction is projected to the certified shape (wrap metadata
stripped); the grader prompt is byte-identical to src/agents/*.md; a no-variants
strategy is trivially consistent with NO LLM call; a cap breach HALTs.
"""
from __future__ import annotations

import importlib.util
import json
import os
import sys

_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)
sys.path.insert(0, os.path.join(_ROOT, "scripts"))
_spec = importlib.util.spec_from_file_location("h1_seal_panel_dispatch", os.path.join(_ROOT, "scripts", "h1_seal_panel_dispatch.py"))
pd = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(pd)


def _grade(name):
    if name == "ContentPreservationGradeV2":
        return {"strategy_name": "x", "silenced": [], "content_clean": True, "coaching_dropped": [], "inventory_overreach": [], "notes": ""}
    if name == "SemanticConflationCheck":
        return {"strategy_name": "x", "verdict": "PASS", "is_single_coherent_trade": True, "reasoning": "", "fused_pair": None}
    return {"strategy_name": "x", "enumeration_consistent": True, "offending_variants": [], "reasoning": ""}


class _Stub:
    def __init__(self):
        self.calls = []

    def __call__(self, body):
        self.calls.append(body)
        return {"parsed": _grade(body["response_format"]["json_schema"]["name"]), "tokens": 100}


def _wd(tmp_path, *, variants=None, cid="VID__s0"):
    wd = str(tmp_path / "wd")
    vid = cid.split("__")[0]
    os.makedirs(os.path.join(wd, "transcripts"), exist_ok=True)
    os.makedirs(os.path.join(wd, "phase_b"), exist_ok=True)
    os.makedirs(os.path.join(wd, "emit"), exist_ok=True)
    with open(os.path.join(wd, "transcripts", f"{vid}.txt"), "w", encoding="utf-8") as fh:
        fh.write("the transcript body")
    ext = {"strategies": [{"name": "S", "variants": variants or []}], "instrument_classification": {"x": 1},
           "reader_identity": {"model_id": "m"}, "dispatch_record": {"requested_model": "m"}}
    with open(os.path.join(wd, "phase_b", f"{cid}.json"), "w", encoding="utf-8") as fh:
        json.dump(ext, fh)
    consensus = {"per_video": {vid: {"consensus_scopes": [
        {"name": "S", "element_inventory": ["EL-1", "EL-2"], "coaching_notes": ["CN-1"]},
    ]}}}
    with open(os.path.join(wd, "emit", "phase_a_consensus.json"), "w", encoding="utf-8") as fh:
        json.dump(consensus, fh)
    return wd, cid


def test_r034_panel_dispatch_writes_three_axes(tmp_path):
    wd, cid = _wd(tmp_path)
    stub = _Stub()
    code, text = pd.run_panel_dispatch(wd, cid, openai_call=stub)
    assert code == 0, text
    panel = json.load(open(os.path.join(wd, "panels", f"{cid}.json"), encoding="utf-8"))
    assert panel["conflation"] == "PASS"
    assert panel["enumeration_consistency"] == "PASS"
    assert panel["completeness"] is True


def test_r034_content_axis_input_parity(tmp_path):
    """The content axis carries the THREADED inventory + coaching_notes, the extraction
    is stripped of wrap metadata, and the grader prompt is byte-unchanged (R-034 t2)."""
    wd, cid = _wd(tmp_path)
    stub = _Stub()
    pd.run_panel_dispatch(wd, cid, openai_call=stub)
    content = next(b for b in stub.calls if b["response_format"]["json_schema"]["name"] == "ContentPreservationGradeV2")
    user = content["messages"][1]["content"]
    assert "EL-1" in user and "EL-2" in user  # threaded element_inventory
    assert "CN-1" in user  # threaded coaching_notes
    assert "TIER-A element_inventory" in user and "TIER-B coaching_notes" in user
    # the extraction embedded is the certified shape — no seal-day wrap metadata.
    ext_span = user.split("EXTRACTION TO GRADE")[1].split("TIER-A")[0]
    assert "reader_identity" not in ext_span and "dispatch_record" not in ext_span
    # instruments byte-unchanged.
    assert content["messages"][0]["content"] == open(pd.CONTENT_GRADER_PATH, encoding="utf-8").read()


def test_r034_no_variants_enum_is_trivial_no_llm(tmp_path):
    """A no-variants strategy -> enum trivially consistent, NO enum LLM call."""
    wd, cid = _wd(tmp_path, variants=[])
    stub = _Stub()
    pd.run_panel_dispatch(wd, cid, openai_call=stub)
    names = [b["response_format"]["json_schema"]["name"] for b in stub.calls]
    assert "EnumConsistencySemantic" not in names  # no enum LLM for no-variants
    assert names == ["ContentPreservationGradeV2", "SemanticConflationCheck"]
    panel = json.load(open(os.path.join(wd, "panels", f"{cid}.json"), encoding="utf-8"))
    assert panel["enumeration_consistency"] == "PASS" and panel["_enum_source"] == "no-variants-trivial"


def test_r034_variants_enum_calls_llm_with_mentions(tmp_path):
    wd, cid = _wd(tmp_path, variants=[{"name": "v1"}])
    stub = _Stub()
    pd.run_panel_dispatch(wd, cid, openai_call=stub)
    enum = next(b for b in stub.calls if b["response_format"]["json_schema"]["name"] == "EnumConsistencySemantic")
    assert "ENUMERATION-EXCLUDED MENTIONS" in enum["messages"][1]["content"]
    assert enum["messages"][0]["content"] == open(pd.ENUM_GRADER_PATH, encoding="utf-8").read()


def test_r034_panel_cap_breach_halts(tmp_path):
    wd, cid = _wd(tmp_path, variants=[{"name": "v1"}])
    stub = _Stub()
    # a ticket so small the guard trips before the 2nd axis.
    code, text = pd.run_panel_dispatch(wd, cid, openai_call=stub, ticket_usd=0.0)
    assert code == 1 and "HARD-CAP" in text
    assert not os.path.exists(os.path.join(wd, "panels", f"{cid}.json"))


def test_r034_panel_missing_input_halts(tmp_path):
    wd = str(tmp_path / "empty")
    os.makedirs(wd, exist_ok=True)
    code, text = pd.run_panel_dispatch(wd, "VID__s0", openai_call=_Stub())
    assert code == 1 and "HALT" in text


def test_r034_grader_prompt_shas_pinned_match_disk():
    """The pinned grader-prompt SHAs equal the on-disk SHAs (the pins are correct;
    the design-pool-calibrated prompts are what will run)."""
    import hashlib
    for path, pinned in pd.GRADER_PROMPT_SHAS.items():
        assert hashlib.sha256(open(path, "rb").read()).hexdigest() == pinned, path


def test_r034_grader_prompt_drift_HALTS(tmp_path, monkeypatch):
    """★ grader HIGH-finding fix (mutation 4 now flips): an on-disk grader prompt that
    does NOT match its pinned SHA HALTs the panel dispatch — the byte-unchanged
    guarantee is REAL, not self-referential. Never grades with a drifted instrument."""
    wd, cid = _wd(tmp_path)
    # simulate a drifted/tampered calibrated prompt by pinning a wrong SHA for it.
    bad = dict(pd.GRADER_PROMPT_SHAS)
    bad[pd.CONTENT_GRADER_PATH] = "0" * 64
    monkeypatch.setattr(pd, "GRADER_PROMPT_SHAS", bad)
    code, text = pd.run_panel_dispatch(wd, cid, openai_call=_Stub())
    assert code == 1 and "SHA mismatch" in text
    assert not os.path.exists(os.path.join(wd, "panels", f"{cid}.json"))  # never graded


def test_r034_builder_drift_alarm():
    """MEDIUM finding: the panel module hand-replicates the design-pool builders'
    schemas + user compositions. Pin the builder file SHAs — a builder edit trips this
    alarm, forcing a re-verification that the panel copy still matches (no silent drift)."""
    import hashlib
    pinned = {
        "scripts/h1_build_content_batch_v32.py": "848a8559382a08dc",
        "scripts/h1_conflation_check.py": "e99568d2a3d18cbb",
        "scripts/h1_enum_consistency_semantic.py": "324a9cd9c5f762f0",
    }
    for rel, sha16 in pinned.items():
        actual = hashlib.sha256(open(os.path.join(_ROOT, rel), "rb").read()).hexdigest()[:16]
        assert actual == sha16, (
            f"{rel} changed ({actual} != {sha16}) — RE-VERIFY the panel-module copy of "
            f"its schema + user composition still matches, then update this pin"
        )
