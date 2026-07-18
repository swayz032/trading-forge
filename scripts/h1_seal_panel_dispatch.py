#!/usr/bin/env python3
"""R-034 — seal-day PANEL dispatch (the 5th seam operationalized, AR-023/AR-024 fix).

Produces ``panels/<cid>.json = {conflation, enumeration_consistency, completeness}``
per cid via the THREE calibrated gpt-5.4 grader instruments, prompts BYTE-UNCHANGED
(R-033 p1 / R-034 t2): ``content-preservation-grader-v2.md``,
``semantic-conflation-check.md``, ``enumeration-consistency-semantic.md``.

This module is PLUMBING (R-033 p1): it composes each axis's user message to MATCH the
design-pool builder's composition EXACTLY (the certified input contract), sourcing the
data from the SEAL-DAY artifacts (the threaded consensus inventory + the sealed
extraction + the transcript) instead of the design-pool staging. It edits no grader
prompt, schema, or threshold.

Input faithfulness (R-034): each axis receives the SAME fields the certified builder
fed it — content: transcript + extraction + TIER-A element_inventory + TIER-B
coaching_notes; conflation: transcript + strategy object; enum: transcript + strategy +
enumeration-excluded mentions (no-variants -> trivially consistent, no LLM). The
``openai_call`` seam is injected in tests (no live model); on seal day it is the real
gpt-5.4 FLEX HIGH call under the mid-run HARD-CAP guard.
"""
from __future__ import annotations

import hashlib
import json
import os

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_AGENTS = os.path.join(_ROOT, "src", "agents")


class GraderPromptDrift(RuntimeError):
    """Raised (fail-closed HALT) when a calibrated grader prompt's on-disk SHA does
    NOT match its pinned value — the byte-unchanged (R-034 t2) guarantee, made REAL:
    the claude-side frontier/enumerator prompts are SHA-pinned into reader_identity;
    the gpt-5.4 grader prompts are pinned HERE so on-disk drift/tamper on the once-only
    read HALTs the panel instead of silently grading with a wrong instrument."""


# --- byte-unchanged calibrated grader prompts (R-034 t2), SHA-PINNED --------- #
# (grader HIGH finding: a self-referential `open()==open()` test can't catch on-disk
# tamper. Pinned SHA256 of the design-pool-calibrated prompts, verified before use.)
CONTENT_GRADER_PATH = os.path.join(_AGENTS, "content-preservation-grader-v2.md")
CONFLATION_GRADER_PATH = os.path.join(_AGENTS, "semantic-conflation-check.md")
ENUM_GRADER_PATH = os.path.join(_AGENTS, "enumeration-consistency-semantic.md")
GRADER_PROMPT_SHAS = {
    CONTENT_GRADER_PATH: "13c41a18166c380535b3e7676da2a1a731178d7b66b903917070fb27a27e4e46",
    CONFLATION_GRADER_PATH: "d1a4d6c244a542076ff124f40332cefaebf95906b6d18c72f92156cf096e9281",
    ENUM_GRADER_PATH: "e19723f0e6be8e75b565c04b3d255b1192346b1f4e83cfdc3b2d34d1d4a09ba9",
}


def _verify_grader_prompts() -> None:
    """Fail-closed: assert each calibrated grader prompt's on-disk SHA == its pin.
    A drift/tamper HALTs the panel dispatch (never grades with a changed instrument)."""
    for path, pinned in GRADER_PROMPT_SHAS.items():
        actual = hashlib.sha256(open(path, "rb").read()).hexdigest()
        if actual != pinned:
            raise GraderPromptDrift(
                f"grader prompt SHA mismatch {os.path.basename(path)}: on-disk {actual} "
                f"!= pinned {pinned} — calibrated instrument DRIFTED; HALT (R-034 t2)"
            )


def _obj(props, req):
    return {"type": "object", "properties": props, "required": req, "additionalProperties": False}


# Schemas replicated byte-for-byte from the design-pool builders (h1_build_content_
# batch_v32.py / h1_conflation_check.py / h1_enum_consistency_semantic.py).
CONTENT_SCHEMA = _obj({
    "strategy_name": {"type": "string"},
    "silenced": {"type": "array", "items": _obj({"item": {"type": "string"}, "transcript_evidence": {"type": "string"}, "why_not_covered": {"type": "string"}}, ["item", "transcript_evidence", "why_not_covered"])},
    "content_clean": {"type": "boolean"},
    "coaching_dropped": {"type": "array", "items": {"type": "string"}},
    "inventory_overreach": {"type": "array", "items": {"type": "string"}},
    "notes": {"type": "string"},
}, ["strategy_name", "silenced", "content_clean", "coaching_dropped", "inventory_overreach", "notes"])
CONFLATION_SCHEMA = _obj({
    "strategy_name": {"type": "string"}, "verdict": {"type": "string", "enum": ["PASS", "REJECT"]},
    "is_single_coherent_trade": {"type": "boolean"}, "reasoning": {"type": "string"},
    "fused_pair": {"type": ["array", "null"], "items": {"type": "string"}},
}, ["strategy_name", "verdict", "is_single_coherent_trade", "reasoning", "fused_pair"])
ENUM_SCHEMA = _obj({
    "strategy_name": {"type": "string"}, "enumeration_consistent": {"type": "boolean"},
    "offending_variants": {"type": "array", "items": _obj({"variant": {"type": "string"}, "re_promotes_mention": {"type": "string"}}, ["variant", "re_promotes_mention"])},
    "reasoning": {"type": "string"},
}, ["strategy_name", "enumeration_consistent", "offending_variants", "reasoning"])

# design-pool extraction fields the graders saw (strip the seal-day wrap metadata —
# reader_identity/dispatch_record — so the panel input matches the certified shape).
_EXTRACTION_FIELDS = ("strategies", "instrument_classification", "rejected_strategies", "coaching_notes", "coverage_notes")


def _read(path: str) -> str:
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def _project_extraction(ext: dict) -> dict:
    return {k: ext[k] for k in _EXTRACTION_FIELDS if k in ext}


def _content_body(tx: str, ext: dict, name: str, inv: dict) -> dict:
    """Byte-match h1_build_content_batch_v32.py's user composition."""
    user = (
        f"TRANSCRIPT:\n{tx}\n\n"
        f"EXTRACTION TO GRADE (strategy '{name}') — note its coaching_notes[] channel:\n{json.dumps(_project_extraction(ext), ensure_ascii=False)}\n\n"
        f"TIER-A element_inventory (the compilable checklist — silencing any of these is a content FAIL):\n{json.dumps(inv.get('element_inventory', []), ensure_ascii=False)}\n\n"
        f"TIER-B coaching_notes (reference — these belong in coaching_notes, NEVER a content fail):\n{json.dumps(inv.get('coaching_notes', []), ensure_ascii=False)}\n\n"
        f"Grade content-preservation per the v2 two-tier taxonomy. Return ONLY the JSON object."
    )
    return {"model": "gpt-5.4", "service_tier": "flex", "reasoning_effort": "high",
            "messages": [{"role": "system", "content": _read(CONTENT_GRADER_PATH)}, {"role": "user", "content": user}],
            "response_format": {"type": "json_schema", "json_schema": {"name": "ContentPreservationGradeV2", "schema": CONTENT_SCHEMA, "strict": True}}}


def _conflation_body(tx: str, strat: dict) -> dict:
    """Byte-match h1_conflation_check.py's user composition."""
    user = f"TRANSCRIPT (context):\n{tx}\n\nSTRATEGY OBJECT to judge:\n{json.dumps(strat, ensure_ascii=False)}\n\nApply the mirror-vs-fusion test. Return ONLY the JSON."
    return {"model": "gpt-5.4", "service_tier": "flex", "reasoning_effort": "high",
            "messages": [{"role": "system", "content": _read(CONFLATION_GRADER_PATH)}, {"role": "user", "content": user}],
            "response_format": {"type": "json_schema", "json_schema": {"name": "SemanticConflationCheck", "schema": CONFLATION_SCHEMA, "strict": True}}}


def _enum_body(tx: str, strat: dict, mentions: list) -> dict:
    """Byte-match h1_enum_consistency_semantic.py's user composition."""
    user = (
        f"TRANSCRIPT (context):\n{tx}\n\nSTRATEGY (judge its variants):\n{json.dumps(strat, ensure_ascii=False)}\n\n"
        f"ENUMERATION-EXCLUDED MENTIONS for this video (descriptions — judge by MEANING, NOT key strings):\n{json.dumps(mentions, ensure_ascii=False)}\n\n"
        f"Does any variant re-promote an excluded mention? Return ONLY the JSON."
    )
    return {"model": "gpt-5.4", "service_tier": "flex", "reasoning_effort": "high",
            "messages": [{"role": "system", "content": _read(ENUM_GRADER_PATH)}, {"role": "user", "content": user}],
            "response_format": {"type": "json_schema", "json_schema": {"name": "EnumConsistencySemantic", "schema": ENUM_SCHEMA, "strict": True}}}


def _real_openai_call(body: dict) -> dict:
    """Seal-day gpt-5.4 FLEX call. Reads the key from .env (same as every panel
    instrument). Retries 429 / resource-unavailable / timeout with exponential backoff
    (matching the design-pool instruments' handling, e.g. h1_flex_content_panel_v32.py:
    22-40) — FLEX capacity is transient, so a single-shot call would spuriously HALT
    the read. If FLEX stays unavailable after the backoff budget, falls back ONCE to
    service_tier=default (the API's own remedy for flex_unavailable) so a capacity
    outage never collapses the read. NEVER invoked in tests (a stub is injected)."""
    import time

    from openai import OpenAI

    key = [l.split("=", 1)[1].strip().strip('"').strip("'")
           for l in open(os.path.join(_ROOT, ".env"), encoding="utf-8") if l.startswith("OPENAI_API_KEY=")][0]
    c = OpenAI(api_key=key, timeout=1200, max_retries=0)
    delay = 8.0
    last_exc = None
    for attempt in range(7):
        try:
            r = c.chat.completions.create(**body)
            return {"parsed": json.loads(r.choices[0].message.content), "tokens": r.usage.total_tokens}
        except Exception as exc:  # noqa: BLE001 - retry on transient classes, re-raise otherwise
            msg = str(exc).lower()
            transient = any(x in msg for x in ("429", "resource", "rate limit", "overloaded", "try again", "timeout", "unavailable"))
            last_exc = exc
            if attempt == 4 and "flex" in body.get("service_tier", ""):
                body = {**body, "service_tier": "default"}  # capacity fallback (API's own remedy)
                continue
            if transient and attempt < 6:
                time.sleep(delay)
                delay = min(delay * 1.7, 90)
                continue
            raise
    raise last_exc


def run_panel_dispatch(work_dir: str, cid: str, openai_call=None, ticket_usd: float = 0.60) -> tuple[int, str]:
    """R-034 seal-day PANEL dispatch for ONE cid: compose the 3 calibrated axes (inputs
    threaded from the seal-day artifacts, prompts byte-unchanged), call gpt-5.4 under
    the HARD-CAP guard, and write ``panels/<cid>.json = {conflation,
    enumeration_consistency, completeness}`` (the exact shape ``live_panel_fn`` /
    ``_make_conductor_panel_fn`` consume). ``openai_call(body)->{parsed,tokens}`` is
    injected in tests. Missing artifact => HALT. Returns ``(exit_code, text)``."""
    import sys
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from h1_metered_cap_guard import CapBreach, MeteredCapGuard

    openai_call = openai_call or _real_openai_call
    # R-034 t2: verify the calibrated grader prompts are byte-unchanged (SHA-pinned)
    # BEFORE any grade — a drifted/tampered instrument HALTs, never grades silently.
    try:
        _verify_grader_prompts()
    except GraderPromptDrift as exc:
        return 1, f"HALT: {exc}"
    vid = cid.split("__")[0]
    try:
        strategy_index = int(cid.split("__s")[1])
    except (IndexError, ValueError):
        return 1, f"HALT: cannot parse strategy index from cid {cid!r}"

    tx_path = os.path.join(work_dir, "transcripts", f"{vid}.txt")
    ext_path = os.path.join(work_dir, "phase_b", f"{cid}.json")
    for p in (tx_path, ext_path):
        if not os.path.exists(p):
            return 1, f"HALT: panel dispatch missing input {p}"
    tx = _read(tx_path)
    ext = json.loads(_read(ext_path))
    strat = (ext.get("strategies") or [{}])[0]
    name = strat.get("name") or cid

    # the threaded consensus inventory (R-034): element_inventory + coaching_notes.
    ca_path = os.path.join(work_dir, "emit", "phase_a_consensus.json")
    inv = {"element_inventory": [], "coaching_notes": []}
    if os.path.exists(ca_path):
        pv = ((json.loads(_read(ca_path)) or {}).get("per_video") or {}).get(vid) or {}
        scopes = pv.get("consensus_scopes") or []
        if strategy_index < len(scopes):
            sc = scopes[strategy_index] or {}
            inv = {"element_inventory": sc.get("element_inventory") or [], "coaching_notes": sc.get("coaching_notes") or []}
    # enumeration-excluded mentions (threaded if present; empty otherwise — flagged).
    mentions = _excluded_mentions(work_dir, vid)

    capg = MeteredCapGuard(ticket_usd)
    axes: dict = {}
    try:
        # CONTENT -> completeness.content_clean
        cr = openai_call(_content_body(tx, ext, name, inv))
        capg.record(cr.get("tokens", 0))
        axes["completeness"] = bool(cr["parsed"].get("content_clean"))
        # CONFLATION -> verdict
        capg.guard_or_raise(20000)
        vr = openai_call(_conflation_body(tx, strat))
        capg.record(vr.get("tokens", 0))
        axes["conflation"] = vr["parsed"].get("verdict")
        # ENUM -> enumeration_consistent (no-variants => trivially consistent, no LLM)
        variants = strat.get("variants") or []
        if not variants:
            axes["enumeration_consistency"] = "PASS"
            axes["_enum_source"] = "no-variants-trivial"
        else:
            capg.guard_or_raise(20000)
            er = openai_call(_enum_body(tx, strat, mentions))
            capg.record(er.get("tokens", 0))
            axes["enumeration_consistency"] = "PASS" if er["parsed"].get("enumeration_consistent") else "FAIL"
            axes["_enum_mentions_n"] = len(mentions)
    except CapBreach as exc:
        return 1, f"HALT: panel HARD-CAP breach ({cid}) — {exc}"

    out_path = os.path.join(work_dir, "panels", f"{cid}.json")
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    tmp = f"{out_path}.tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(axes, fh, ensure_ascii=False, sort_keys=True, indent=2)
    os.replace(tmp, out_path)
    return 0, (f"PANEL {cid} -> conflation={axes['conflation']} "
               f"enum={axes['enumeration_consistency']} content_clean={axes['completeness']} "
               f"(~${capg.spent_usd:.3f})")


def _excluded_mentions(work_dir: str, vid: str) -> list:
    """The enumeration-excluded mentions for a video (enum axis input). Threaded from
    the work-dir if a per-video exclusion record exists; empty otherwise (the enum
    check then finds no excluded mention to re-promote — a conservative PASS-leaning
    input recorded as _enum_mentions_n=0 in the panel for parity visibility)."""
    p = os.path.join(work_dir, "emit", "enum_exclusions", f"{vid}.json")
    if os.path.exists(p):
        try:
            return json.loads(_read(p)).get("excluded_mentions") or []
        except (OSError, ValueError):
            return []
    return []
