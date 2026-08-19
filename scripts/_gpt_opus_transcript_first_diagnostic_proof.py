#!/usr/bin/env python3
"""Adversarial development proof for strategy_factory_opus_transcript_first_diagnostic.py.

This is GPT-authored development evidence, NOT independent certification. Worker/accuracy-validator
must execute it and add at least one novel attack GPT did not author.
"""
from __future__ import annotations

import argparse
import copy
import importlib.util
import json
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = REPO_ROOT / "scripts/strategy_factory_opus_transcript_first_diagnostic.py"

spec = importlib.util.spec_from_file_location("opus_diag", MODULE_PATH)
assert spec and spec.loader
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def expect_fail(label, fn, contains: str | None = None):
    try:
        fn()
    except (ValueError, SystemExit) as e:
        text = str(e)
        if contains and contains not in text:
            raise AssertionError(f"{label}: failed for wrong reason: {text}") from e
        print(f"PASS negative: {label} -> {text}")
        return
    raise AssertionError(f"{label}: expected refusal but call passed")


def synthetic_candidate(video_id: str, quote: str) -> dict:
    return {
        "video_id": video_id,
        "reader_role": m.REQUIRED_READER_ROLE,
        "instrument_classification": {
            "asset_class": "futures",
            "instrument": "NQ",
            "rationale": "The source names NQ futures.",
            "transcript_quote": quote,
        },
        "strategies": [
            {
                "source_strategy_id": "s0",
                "name": "source strategy",
                "direction": "both",
                "direction_transcript_quote": quote,
                "higher_timeframe": "15m",
                "higher_timeframe_transcript_quote": quote,
                "execution_timeframe": "5m",
                "execution_timeframe_transcript_quote": quote,
                "setup": [{"description": "setup", "transcript_quote": quote}],
                "entry_sequence": [
                    {
                        "step": 1,
                        "role": "trigger",
                        "action": "enter on the taught trigger",
                        "rationale": "source taught it",
                        "transcript_quote": quote,
                    }
                ],
                "confluences": [],
                "stop": {
                    "anchor": "swing low",
                    "rationale": "stop at swing low",
                    "transcript_quote": quote,
                },
                "targets": [
                    {
                        "priority": 1,
                        "type": "structure",
                        "r_multiple": None,
                        "rationale": "target structure",
                        "transcript_quote": quote,
                    }
                ],
                "management": [],
                "variants": [],
                "source_gaps": [],
            }
        ],
        "top_level_source_gaps": [],
    }


def main() -> int:
    transcript = "Trade NQ futures both ways on the 15m chart and enter on the 5m trigger."
    quote = transcript
    candidate = synthetic_candidate("UNIT_A", quote)

    result = m.validate_candidate(candidate, transcript, "UNIT_A")
    assert result["strategy_count"] == 1
    assert result["literal_quote_failures"] == 0
    print("PASS positive: literal source-grounded candidate")

    bad = copy.deepcopy(candidate)
    bad["strategies"][0]["stop"]["transcript_quote"] = "This sentence is not in the source."
    expect_fail(
        "invented stop evidence",
        lambda: m.validate_candidate(bad, transcript, "UNIT_A"),
        "literal evidence verification failed",
    )

    bad = copy.deepcopy(candidate)
    bad["video_id"] = "UNIT_B"
    expect_fail(
        "cross-video candidate swap",
        lambda: m.validate_candidate(bad, transcript, "UNIT_A"),
        "video_id mismatch",
    )

    bad = copy.deepcopy(candidate)
    bad["reader_role"] = "LEGACY_READER"
    expect_fail(
        "legacy reader role laundering",
        lambda: m.validate_candidate(bad, transcript, "UNIT_A"),
        "reader_role",
    )

    bad = copy.deepcopy(candidate)
    bad["strategies"][0]["source_strategy_id"] = "s1"
    expect_fail(
        "non-sequential strategy identity",
        lambda: m.validate_candidate(bad, transcript, "UNIT_A"),
        "source_strategy_id",
    )

    empty = {
        "video_id": "UNIT_A",
        "reader_role": m.REQUIRED_READER_ROLE,
        "instrument_classification": None,
        "strategies": [],
        "top_level_source_gaps": [],
    }
    expect_fail(
        "zero-strategy result without source-gap explanation",
        lambda: m.validate_candidate(empty, transcript, "UNIT_A"),
        "top_level_source_gaps",
    )
    empty["top_level_source_gaps"] = [
        {"field": "strategy", "reason": "source teaches no executable entry"}
    ]
    zero_result = m.validate_candidate(empty, transcript, "UNIT_A")
    assert zero_result["strategy_count"] == 0
    print("PASS positive: honest zero-strategy refusal shape")

    index = {
        "video_id": "UNIT_A",
        "task_sha256": "tasksha",
        "transcript_sha256": "transcriptsha",
    }
    good_receipt = {
        "video_id": "UNIT_A",
        "task_sha256": "tasksha",
        "transcript_sha256": "transcriptsha",
        "model_override": "opus",
        "actual_model_identity": "override=opus; exact runtime identity not surfaced",
        "subagent_type": "general-purpose",
        "reader_role": m.REQUIRED_READER_ROLE,
        "fresh_reader": True,
        "prompt_source": "task_file_only",
        "legacy_semantics_visible": False,
    }
    m.validate_invocation_receipt(good_receipt, index)
    print("PASS positive: declared fresh Opus invocation receipt")

    bad_receipt = dict(good_receipt)
    bad_receipt["model_override"] = "gemma"
    expect_fail(
        "Gemma receipt cannot enter fresh-Opus lane",
        lambda: m.validate_invocation_receipt(bad_receipt, index),
        "model_override mismatch",
    )

    bad_receipt = dict(good_receipt)
    bad_receipt["legacy_semantics_visible"] = True
    expect_fail(
        "reader exposed to legacy semantics",
        lambda: m.validate_invocation_receipt(bad_receipt, index),
        "legacy_semantics_visible=false",
    )

    expect_fail(
        "canonical-vault output path",
        lambda: m._safe_out_root(str(m.CANONICAL_VAULT / "diagnostic-attack")),
        "may not be the canonical extraction vault",
    )

    # Real-source semantic-blindness control. The old 1HFo extraction contains the legacy stop
    # anchor `fvg_low`; its source transcript does not. Emitting the task must therefore not leak
    # that legacy semantic into the prompt.
    real_case = m.get_case("1HFoStW_wsc")
    _, real_transcript = m.transcript_for(real_case)
    assert "fvg_low" not in real_transcript.lower(), "control invalid: transcript itself contains sentinel"
    task = m.build_task("1HFoStW_wsc", real_transcript)
    assert "fvg_low" not in task.lower(), "legacy semantic leaked into transcript-first task"
    assert real_transcript in task
    print("PASS negative: legacy `fvg_low` semantic absent from fresh 1HFo task")

    # Emit into a disposable path and prove the real canonical vault bytes are not touched.
    legacy_path = m.REPO_ROOT / real_case["legacy_extraction_path"]
    legacy_before = m.sha256_bytes(legacy_path.read_bytes())
    with tempfile.TemporaryDirectory(prefix="gpt-opus-diagnostic-") as td:
        args = argparse.Namespace(video_id="1HFoStW_wsc", out_dir=td)
        rc = m.cmd_emit(args)
        assert rc == 0
        emitted = Path(td) / "1HFoStW_wsc" / "opus_source_reader_task.txt"
        assert emitted.is_file()
        assert "fvg_low" not in emitted.read_text(encoding="utf-8").lower()
    legacy_after = m.sha256_bytes(legacy_path.read_bytes())
    assert legacy_before == legacy_after
    print("PASS negative: diagnostic emit leaves canonical legacy extraction byte-identical")

    print("ALL GPT-AUTHORED DEVELOPMENT CONTROLS PASS IF THIS SCRIPT EXITS 0")
    print("INDEPENDENT WORKER/ACCURACY-VALIDATOR EXECUTION + ONE NOVEL ATTACK STILL REQUIRED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
