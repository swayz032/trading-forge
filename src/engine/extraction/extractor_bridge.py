"""H1 Wave-4 pilot extractor bridge (Addendum-2 rework, 2026-07-12).

Owns the EXTRACTION STAGE seam only: transcript -> real production gemma
transcript_extractor -> extracted strategy JSON. Deliberately a SEPARATE
module from `pilot_conveyor.py` (which owns the CONVEYOR stage: extracted
strategy -> tier-1/tier-3 -> certificate) for two reasons:

  1. Architecture: the Wave-4 brief's own diagram splits "Extraction stage
     (TS/gemma)" from "Conveyor stage (Python)" -- this file IS that first
     stage's Python-side seam; `pilot_conveyor.prepare_strategy`/
     `finalize_certificate` never call it.
  2. Test hygiene: `test_pilot_conveyor.py`'s
     `test_module_never_calls_an_llm_or_adjudicator` source-scans
     `pilot_conveyor.py` for LLM-dispatch tokens ("ollama", ".chat(", etc.)
     as a structural non-adjudicator proof. Keeping the actual subprocess-
     to-Node call (and the word "ollama") entirely OUT of pilot_conveyor.py
     keeps that proof meaningful rather than requiring an ever-growing
     exemption list.

TWO responsibilities:

  1. `invoke_real_extractor` -- subprocess bridge to the THIN, SIDE-EFFECT-
     FREE Node/TS CLI wrapper `scripts/h1-extract-one.ts` (transcript in ->
     extracted-strategy JSON out; no DB writes of strategy/graduation
     state). See that script's own docstring for the ONE documented side
     effect it inherits (a fire-and-forget audit_log telemetry insert via
     `callScoutExtractLlm`'s existing internal write).
  2. `ExtractionVault` (module-level functions) -- clause 2 (one pass per
     video, read-once, vaulted immediately, crash-replaces-whole-video): a
     JSON-per-video cache directory. A video_id's completed pass is loaded
     from the vault and never silently re-run; a re-run REPLACES the whole
     record atomically (tmp-file + os.replace) so a crash mid-write can
     never leave a partial/cherry-pickable file.

Also hosts `run_dry_run_real_extractor` -- the Wave-4 brief's REQUIRED
dry-run bonus: invoke the REAL extractor on a NON-SEALED synthetic
transcript, feed the result through `pilot_conveyor`'s (unchanged)
prepare/finalize phases, and produce a schema-valid DRY-RUN certificate.
Because `pilot_conveyor.prepare_strategy` is called here WITHOUT a
`propose_fn` override, this also exercises the REAL `anchor_locator.py`
gemma call (Addendum 3) for every extracted condition -- so this one
rehearsal smoke-tests transcript-fetch-adjacent plumbing + the extraction
gemma call + the anchor-locator gemma call + Ollama health, all in one
throwaway run, per the addendum's own note ("now exercising extractor +
locator + fetch + gemma in one rehearsal").

NEVER touches any sealed evaluation-set artifact (the frozen fresh-video
seal or the frozen tier-2 quarantine set named in the H1 pilot pre-reg) --
the transcript used anywhere in this module is either caller-supplied
(production callers own that responsibility) or the module-local
`DRY_RUN_REAL_EXTRACTOR_TRANSCRIPT` constant below (hand-authored,
non-sealed, public-style trading-explainer prose). This paragraph
deliberately avoids spelling out the sealed-set filenames verbatim so it
cannot itself trip the module's own sealed-set source-scan regression test
(test_extractor_bridge.py), mirroring the same self-trip discipline
pilot_conveyor.py's leak-scan docstring already documents."""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import time
from dataclasses import dataclass
from typing import Optional

from . import pilot_conveyor as pc

_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
_EXTRACT_ONE_SCRIPT = os.path.join(_ROOT, "scripts", "h1-extract-one.ts")
_ENUMERATE_SCRIPT = os.path.join(_ROOT, "scripts", "h1-enumerate-strategies.ts")


class RealExtractorError(RuntimeError):
    """Raised on any failure invoking the real extractor -- non-zero exit,
    bad JSON, timeout, or missing wrapper script. Callers must never
    substitute a fabricated/synthetic result on this error (the Wave-4
    brief: "do NOT fake the extraction with a hand-built strategy for the
    'real extractor' dry-run")."""


class EnumeratorError(RuntimeError):
    """Raised on any failure invoking Phase A's strategy enumerator --
    non-zero exit, bad JSON, timeout, or missing wrapper script. Same
    never-fabricate contract as RealExtractorError."""


def invoke_real_extractor(
    transcript_text: str,
    video_id: str,
    timeout_s: float = 240.0,
    scope: Optional[dict] = None,
) -> dict:
    """Subprocess bridge: transcript in -> extracted-strategy JSON out.
    Shells out to `npx tsx scripts/h1-extract-one.ts`, feeding
    `{"video_id": ..., "transcript_text": ...}` on stdin, reading one JSON
    object off stdout. Raises `RealExtractorError` on any failure -- never
    returns a partial/fabricated result.

    `scope` (H1 Wave-6 Pass-2, 2026-07-13): optional Phase-A -> Phase-B
    handoff scope dict `{"entry_summary": str, "exit_summary": str,
    "variants": [{"variant_label": str, "timeframe_note": str|None,
    "confirmation_mechanic_note": str|None, "target_note": str|None}, ...]}`
    per docs/designs/h1-wave6-pass2-two-phase-PACKET-2026-07-13.md §2. When
    None (default), behavior is byte-identical to pre-pass-2 (unscoped,
    single-phase) calls -- the wrapper script only injects the scoping
    instruction when this key is present in the stdin payload."""
    if not os.path.exists(_EXTRACT_ONE_SCRIPT):
        raise RealExtractorError(f"extractor CLI wrapper not found: {_EXTRACT_ONE_SCRIPT}")
    payload_dict = {"video_id": video_id, "transcript_text": transcript_text}
    if scope is not None:
        payload_dict["scope"] = scope
    payload = json.dumps(payload_dict)
    try:
        proc = subprocess.run(
            ["npx", "tsx", _EXTRACT_ONE_SCRIPT],
            input=payload,
            capture_output=True,
            text=True,
            cwd=_ROOT,
            timeout=timeout_s,
            shell=(os.name == "nt"),
        )
    except subprocess.TimeoutExpired as exc:
        raise RealExtractorError(
            f"extractor CLI wrapper timed out after {timeout_s}s for video_id={video_id!r}"
        ) from exc
    except FileNotFoundError as exc:
        raise RealExtractorError(f"npx/tsx not found on PATH invoking extractor for video_id={video_id!r}") from exc

    if proc.returncode != 0:
        raise RealExtractorError(
            f"extractor CLI wrapper exited {proc.returncode} for video_id={video_id!r}: "
            f"stderr_tail={proc.stderr[-2000:]!r} stdout_tail={proc.stdout[-1000:]!r}"
        )
    try:
        # h1-extract-one.ts prints exactly one JSON line on success; other
        # tooling (npm notices, etc.) can precede/follow on some setups --
        # take the LAST line that parses as JSON.
        lines = [ln for ln in proc.stdout.splitlines() if ln.strip()]
        result = None
        for ln in reversed(lines):
            try:
                result = json.loads(ln)
                break
            except json.JSONDecodeError:
                continue
        if result is None:
            raise json.JSONDecodeError("no JSON line found", proc.stdout, 0)
    except json.JSONDecodeError as exc:
        raise RealExtractorError(
            f"extractor CLI wrapper printed non-JSON stdout for video_id={video_id!r}: {proc.stdout[-500:]!r}"
        ) from exc
    if isinstance(result, dict) and result.get("error"):
        raise RealExtractorError(f"extractor CLI wrapper reported an error for video_id={video_id!r}: {result['error']}")
    return result


def _run_node_cli_json(
    script_path: str,
    payload: str,
    timeout_s: float,
    video_id: str,
    error_cls: type,
    script_label: str,
) -> dict:
    """Shared subprocess seam: run `npx tsx <script_path>` with `payload` on
    stdin, scrape the last stdout line that parses as JSON, raise
    `error_cls` on any failure. Factored out of `invoke_real_extractor` /
    `invoke_strategy_enumerator` so both CLI wrappers share identical
    error-handling (JSON-line scraping tolerant of npm notices, timeout
    handling, missing-wrapper detection) instead of drifting independently."""
    if not os.path.exists(script_path):
        raise error_cls(f"{script_label} CLI wrapper not found: {script_path}")
    try:
        proc = subprocess.run(
            ["npx", "tsx", script_path],
            input=payload,
            capture_output=True,
            text=True,
            cwd=_ROOT,
            timeout=timeout_s,
            shell=(os.name == "nt"),
        )
    except subprocess.TimeoutExpired as exc:
        raise error_cls(
            f"{script_label} CLI wrapper timed out after {timeout_s}s for video_id={video_id!r}"
        ) from exc
    except FileNotFoundError as exc:
        raise error_cls(f"npx/tsx not found on PATH invoking {script_label} for video_id={video_id!r}") from exc

    if proc.returncode != 0:
        raise error_cls(
            f"{script_label} CLI wrapper exited {proc.returncode} for video_id={video_id!r}: "
            f"stderr_tail={proc.stderr[-2000:]!r} stdout_tail={proc.stdout[-1000:]!r}"
        )
    lines = [ln for ln in proc.stdout.splitlines() if ln.strip()]
    result = None
    for ln in reversed(lines):
        try:
            result = json.loads(ln)
            break
        except json.JSONDecodeError:
            continue
    if result is None:
        raise error_cls(
            f"{script_label} CLI wrapper printed non-JSON stdout for video_id={video_id!r}: {proc.stdout[-500:]!r}"
        )
    if isinstance(result, dict) and result.get("error"):
        raise error_cls(f"{script_label} CLI wrapper reported an error for video_id={video_id!r}: {result['error']}")
    return result


def build_phase_b_scope(phase_a_strategy: dict) -> dict:
    """Pure helper: Phase-A strategy object -> the scope dict `invoke_real_extractor`'s
    `scope` param expects (packet §2). Factored out so the Guard-1/Guard-2
    tests can build a scope from a hand-constructed Phase-A object without
    going through the full orchestrator."""
    return {
        "entry_summary": phase_a_strategy.get("entry_summary", ""),
        "exit_summary": phase_a_strategy.get("exit_summary", ""),
        "variants": phase_a_strategy.get("variants") or [],
    }


def run_two_phase_extraction(
    transcript_text: str,
    video_id: str,
    enumerator_timeout_s: float = 240.0,
    extractor_timeout_s: float = 240.0,
) -> dict:
    """H1 Wave-6 Pass-2 (2026-07-13) orchestrator -- the §2 handoff wiring.

    Phase A (one whole-transcript call, `invoke_strategy_enumerator`) -> N
    scoped Phase B calls (one per Phase-A-enumerated strategy,
    `invoke_real_extractor` with `scope=build_phase_b_scope(...)`) ->
    concatenated assembly into the SAME top-level `{"strategies": [...],
    "rejected_strategies": [...], "instrument_classification": ...}` shape
    the single-phase conveyor already consumes (packet §2 "downstream
    assembly" -- the two-phase split is invisible past this function's
    return value; no change to the outer schema any downstream consumer,
    critic/paper/prop-sim/portfolio/export, reads).

    Adds two diagnostic-only fields for debugging/regression-fixture use
    (additive, per packet §6 -- never read by the existing single-phase
    consumers): `phase_a_enumeration` (Phase A's raw output) and
    `per_strategy_extractions` (each Phase B call's raw output, keyed by
    Phase-A `strategy_id`).

    Never fabricates: raises EnumeratorError if Phase A fails outright, or
    RealExtractorError if any per-strategy Phase B call fails outright --
    no partial/synthetic strategy is substituted on either failure. An
    honest empty Phase-A enumeration (video teaches nothing extractable)
    short-circuits to an empty `strategies: []` result without any Phase B
    calls (nothing to scope them to)."""
    enumeration = invoke_strategy_enumerator(transcript_text, video_id, timeout_s=enumerator_timeout_s)
    phase_a_strategies = enumeration.get("strategies") or []

    if not phase_a_strategies:
        return {
            "video_id": video_id,
            "instrument_classification": None,
            "strategies": [],
            "rejected_strategies": [],
            "phase_a_enumeration": enumeration,
            "per_strategy_extractions": [],
        }

    all_strategies: list = []
    all_rejected: list = []
    instrument_classification = None
    per_strategy_extractions = []

    for phase_a_strat in phase_a_strategies:
        scope = build_phase_b_scope(phase_a_strat)
        strat_id = phase_a_strat.get("strategy_id")
        extraction = invoke_real_extractor(
            transcript_text,
            f"{video_id}::phaseA-s{strat_id}",
            timeout_s=extractor_timeout_s,
            scope=scope,
        )
        per_strategy_extractions.append({"phase_a_strategy_id": strat_id, "extraction": extraction})
        all_strategies.extend(extraction.get("strategies") or [])
        all_rejected.extend(extraction.get("rejected_strategies") or [])
        if instrument_classification is None and extraction.get("instrument_classification"):
            instrument_classification = extraction["instrument_classification"]

    return {
        "video_id": video_id,
        "instrument_classification": instrument_classification,
        "strategies": all_strategies,
        "rejected_strategies": all_rejected,
        "phase_a_enumeration": enumeration,
        "per_strategy_extractions": per_strategy_extractions,
    }


def invoke_strategy_enumerator(transcript_text: str, video_id: str, timeout_s: float = 240.0) -> dict:
    """H1 Wave-6 Pass-2 (2026-07-13) — Phase A subprocess bridge: whole
    transcript in -> strategy INVENTORY out (name + entry_summary +
    exit_summary + variants[] per distinct strategy). Shells out to
    `npx tsx scripts/h1-enumerate-strategies.ts`, same stdin/stdout contract
    as `invoke_real_extractor` (feeds `{"video_id", "transcript_text"}`,
    reads one JSON object off stdout). Raises `EnumeratorError` on any
    failure -- never returns a partial/fabricated result. Per packet §1:
    this is a NEW instrument (global, whole-transcript view) -- deliberately
    NOT chunked and NOT scoped, unlike Phase B."""
    payload = json.dumps({"video_id": video_id, "transcript_text": transcript_text})
    return _run_node_cli_json(_ENUMERATE_SCRIPT, payload, timeout_s, video_id, EnumeratorError, "strategy-enumerator")


# --------------------------------------------------------------------------- #
# ExtractionVault (Addendum 2 clause 2)
# --------------------------------------------------------------------------- #


@dataclass
class VaultRecord:
    video_id: str
    extracted_at: float
    seed_params: dict
    extraction_sha256: str
    extraction: dict


def _vault_path(vault_dir: str, video_id: str) -> str:
    safe = "".join(c if (c.isalnum() or c in "-_.") else "_" for c in video_id)
    return os.path.join(vault_dir, f"{safe}.json")


def load_cached_extraction(vault_dir: str, video_id: str) -> Optional[dict]:
    """Read-once: returns the vaulted record dict, or None if this video_id
    has no cached pass yet. Never triggers extraction itself."""
    path = _vault_path(vault_dir, video_id)
    if not os.path.exists(path):
        return None
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def save_extraction(vault_dir: str, video_id: str, extraction: dict, seed_params: dict) -> str:
    """Clause 2: crash-replaces-whole-video. Atomic write (tmp file +
    `os.replace`, which POSIX/Windows both guarantee is atomic within one
    filesystem) so a crash mid-write can never leave a partial/corrupt vault
    file; a re-run REPLACES the entire prior record for this video_id --
    no cherry-picking fields between two passes."""
    os.makedirs(vault_dir, exist_ok=True)
    extraction_sha256 = hashlib.sha256(
        json.dumps(extraction, sort_keys=True, default=str).encode("utf-8")
    ).hexdigest()
    record = {
        "video_id": video_id,
        "extracted_at": time.time(),
        "seed_params": seed_params,
        "extraction_sha256": extraction_sha256,
        "extraction": extraction,
    }
    path = _vault_path(vault_dir, video_id)
    tmp_path = f"{path}.{os.getpid()}.tmp"
    with open(tmp_path, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(record, fh, indent=2, default=str)
    os.replace(tmp_path, path)
    return path


def get_or_extract(
    vault_dir: str,
    video_id: str,
    transcript_text: str,
    seed_params: Optional[dict] = None,
) -> dict:
    """Read-once with incremental caching (clause 2): a completed video's
    extraction is loaded from the vault and never silently re-run. A caller
    that genuinely needs a fresh pass must delete the vault file first
    (explicit operator action, not an automatic re-query) -- this keeps
    "one extraction pass per video, read-once" honest instead of silently
    re-hitting gemma on every call. Returns the `extraction` dict (not the
    wrapping vault record)."""
    cached = load_cached_extraction(vault_dir, video_id)
    if cached is not None:
        return cached["extraction"]
    seed_params = seed_params or {"seed": 42, "temperature": 0.1, "model": "gemma4:e4b-it-qat"}
    extraction = invoke_real_extractor(transcript_text, video_id)
    save_extraction(vault_dir, video_id, extraction, seed_params)
    return extraction


# --------------------------------------------------------------------------- #
# Real-extractor DRY-RUN proof (Wave-4 brief's required dry-run bonus)
# --------------------------------------------------------------------------- #

# Hand-authored, NON-SEALED synthetic trading-explainer transcript. Not from
# any real YouTube video, not from the sealed 16, not from the 77 sealed-
# eval set. Deliberately written with normal single-space prose (no
# newlines/irregular whitespace) so that IF the extractor happened to
# quote verbatim, an exact-substring anchor could in principle resolve --
# isolating the anchor-availability finding to the extractor's own behavior
# rather than transcript formatting noise.
DRY_RUN_REAL_EXTRACTOR_VIDEO_ID = "DRY-RUN-real-extractor-smoke-v1"
DRY_RUN_REAL_EXTRACTOR_TRANSCRIPT = (
    "Hey everyone, today I'm walking through my opening range breakout strategy on the MNQ. "
    "I use the first fifteen minutes of the New York session on the five minute chart to build "
    "the opening range. Once that range is set, I wait for a full candle close above the range "
    "high before I go long. If instead price closes below the range low, I go short. I only take "
    "this setup between nine thirty and eleven in the morning Eastern time, and I skip the trade "
    "entirely on FOMC days because the volatility gets unpredictable. My stop sits just below the "
    "opening range low for longs, above the range high for shorts. I'm looking for at least two "
    "times my risk before I take profit, usually targeting the prior day's high or low."
)


def run_dry_run_real_extractor() -> dict:
    """REQUIRED proof (Wave-4 brief): invoke the REAL extractor
    (`invoke_real_extractor`, no synthetic/hand-built strategy substituted)
    on `DRY_RUN_REAL_EXTRACTOR_TRANSCRIPT`, then run the UNCHANGED
    `pilot_conveyor.prepare_strategy` -> [synthetic tier-3 verdicts,
    rehearsal only] -> `finalize_certificate` loop over every extracted
    strategy. Produces one schema-valid DRY-RUN certificate per extracted
    strategy. Raises `RealExtractorError` (does NOT fall back to a fake
    extraction) if the real extractor cannot be invoked -- per the brief:
    "If the real extractor cannot be invoked in this environment ... STOP
    and report that as a blocker."""
    extraction = invoke_real_extractor(
        DRY_RUN_REAL_EXTRACTOR_TRANSCRIPT, DRY_RUN_REAL_EXTRACTOR_VIDEO_ID
    )

    strategies = extraction.get("strategies") or []
    results = []
    for i, strategy in enumerate(strategies):
        if not isinstance(strategy, dict):
            continue
        prep = pc.prepare_strategy(
            strategy,
            DRY_RUN_REAL_EXTRACTOR_TRANSCRIPT,
            DRY_RUN_REAL_EXTRACTOR_VIDEO_ID,
            extractor_version=pc.extractor_version_pin(),
            taxonomy_version="h1-pilot-2026-07-12",
            strategy_index=i,
        )

        # Rehearsal-only synthetic Tier3Verdicts for every real fall-through
        # span (no LLM/agent adjudicator call anywhere in this function --
        # this is a stand-in role assignment, not a claim about the true
        # label, exactly mirroring the synthetic-plumbing dry run's own
        # disclaimer).
        verdicts = [
            pc.verdict_from_rater_response(
                char_span=ft.char_span,
                quote_anchor=DRY_RUN_REAL_EXTRACTOR_TRANSCRIPT[ft.char_span[0] : ft.char_span[1]],
                role="context" if j % 2 == 0 else "gate-strength",
                control_gate_passed=True,
            )
            for j, ft in enumerate(prep["tier1_fallthroughs"])
        ]
        cert = pc.finalize_certificate(prep, verdicts, dry_run=True)
        results.append({"strategy_index": i, "anchor_report": prep["anchor_report"], "certificate": cert})

    # Observed REAL-locator anchor outcome, rolled up across every extracted
    # strategy's conditions -- the first real signal (Wave-4 brief) of
    # whether the anchor-locator can ground the frozen extractor's
    # conditions. Summed from each strategy's own `anchor_report` (each
    # condition located exactly once -- see `locate_condition_anchors`'s
    # docstring on why this is a sum, not a re-derivation).
    total_conditions = sum(r["anchor_report"]["total_spine_conditions"] for r in results)
    total_anchored = sum(r["anchor_report"]["anchored_count"] for r in results)
    total_unanchored = sum(r["anchor_report"]["unanchored_count"] for r in results)
    reason_breakdown: dict = {}
    for r in results:
        for reason, count in r["anchor_report"]["unanchored_reason_breakdown"].items():
            reason_breakdown[reason] = reason_breakdown.get(reason, 0) + count

    return {
        "artifact": "h1-pilot-conveyor-DRY-RUN-real-extractor",
        "dry_run": True,
        "video_id": DRY_RUN_REAL_EXTRACTOR_VIDEO_ID,
        "raw_extraction": extraction,
        "strategies_extracted": len(strategies),
        "results": results,
        "anchor_summary": {
            "total_spine_conditions": total_conditions,
            "located_count": total_anchored,
            "unanchored_count": total_unanchored,
            "unanchored_reason_breakdown": reason_breakdown,
        },
    }


def main() -> None:  # pragma: no cover - manual invocation, requires live Ollama
    """Runs the REQUIRED real-extractor + real-locator dry-run (Wave-4
    brief) and writes a DRY-RUN-labeled certificate artifact per extracted
    strategy, mirroring `pilot_conveyor.main`'s own pattern. Raises
    `RealExtractorError` (uncaught, on purpose) if the real extractor
    cannot be invoked -- the brief requires this to surface as a blocker,
    never a silently-faked result."""
    result = run_dry_run_real_extractor()
    out_dir = os.path.join(_ROOT, "docs", "replay-results", "h1-scripts", "dry-run-output")
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, f"h1-pilot-DRY-RUN-cert-{result['video_id']}.json")
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(result, fh, indent=2, default=str)
    print(f"DRY-RUN (real extractor + real anchor-locator) certificate written: {path}")
    print(f"  strategies_extracted={result['strategies_extracted']}")
    summ = result["anchor_summary"]
    print(
        f"  anchor_summary: total_conditions={summ['total_spine_conditions']} "
        f"located={summ['located_count']} unanchored={summ['unanchored_count']} "
        f"reason_breakdown={summ['unanchored_reason_breakdown']}"
    )
    for r in result["results"]:
        cert = r["certificate"]
        print(
            f"  strategy[{r['strategy_index']}]: pilot_grade={cert['pilot_grade']} "
            f"full_grade={cert['full_grade']} dry_run={cert['dry_run']} "
            f"unanchored_condition_count={cert['unanchored_condition_count']}"
        )


if __name__ == "__main__":  # pragma: no cover
    main()
