#!/usr/bin/env python3
"""Build the three fresh Opus-reader reconstruction tasks authorized by AR-1374A.

Combines the base OPUS_LEAD_SOURCE_READER task template (unmodified, from the accepted
opus-transcript-first diagnostic tool) with the new atomic-authoring law (AR-1374A Sec5) and the
per-video rejection-constraint hazards (AR-1374A Sec6) as an APPENDED section. Writes task text +
task_index.json into this worker worktree, matching the tool's own emit() schema exactly so
ingest() will validate cleanly later.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
from pathlib import Path

REPO_ROOT = Path(r"C:\Users\tonio\Projects\wt-claude-worker1-20260815")
REPAIR_SCRIPTS = Path(r"C:/Users/tonio/Projects/wt-lanetest-repair-8acb6b0f/scripts")
OUT_ROOT = REPO_ROOT / "docs/replay-results/gpt-engineering/opus-transcript-first-diagnostic/reconstruction-round-2/runs"

spec = importlib.util.spec_from_file_location("opus_diag_taskbuild",
                                                REPAIR_SCRIPTS / "strategy_factory_opus_transcript_first_diagnostic.py")
D = importlib.util.module_from_spec(spec)
spec.loader.exec_module(D)


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


ATOMIC_LAW = """
=====================================================================
ADDITIONAL AUTHORING LAW FOR THIS RECONSTRUCTION ROUND (AR-1374A Sec5-6)
=====================================================================
This is an authorized re-attempt at this exact video after a prior fresh reconstruction FAILED
independent semantic audit. The rules above (SOURCE-FIDELITY LAW, OUTPUT SHAPE, IDENTITY LAW) still
apply in full. The following is ADDITIONAL, MANDATORY law for this round only, targeting exactly
why the prior attempt failed:

ATOMIC QUOTE-BINDING LAW (the single biggest cause of the prior FAIL):
- Write every quote-bearing object (setup/entry_sequence/confluences/stop/targets/management/
  variants item) as ONE atomic source proposition per object wherever practical.
- Do NOT combine two or more distinct facts into one description/action/rationale/name/rule UNLESS
  the single transcript_quote you attach fully and completely entails the WHOLE compound statement.
  If a claim has two parts and only one part is covered by your best quote, SPLIT the claim into two
  separate objects, each with its own fully-supporting quote -- do not force them together.
- Do not make a rationale, description, or rule STRONGER than what its own attached quote actually
  says. If the quote only implies something loosely, say so at that strength, not more.
- Do NOT store tooling instructions, visualization-only steps, platform/execution-venue logistics,
  demo/backtest practice advice, or generic trading philosophy inside executable strategy containers
  (entry_sequence, stop, targets, management, variants). If the transcript teaches this kind of
  non-executable material, put it in setup[] as context/description, clearly framed as non-executable,
  or omit it if it adds nothing load-bearing.
- Do NOT use words like "primary", "preferred", "priority", "must", or "only" to rank or resolve
  between multiple things the source itself leaves equal or unresolved. If the source offers two
  genuinely alternative methods with no stated preference, represent them as co-equal variants/
  alternatives -- do not invent a ranking. If the source gives multiple possible values (e.g. several
  percentages) without stating which applies when, do not assign artificial priority numbers; either
  represent it as one field with the range/set of values as taught, or mark it source_unresolved with
  a source_gaps entry explaining why no selection rule exists.

REJECTION-CONSTRAINT HAZARDS FROM THE PRIOR ATTEMPT (authoring hazards to avoid -- these are NOT
substitute source facts, do not treat them as things to copy; re-derive everything from the
transcript below from scratch):
{hazards}

Apply this law on top of, not instead of, everything in SOURCE-FIDELITY LAW and OUTPUT SHAPE above.
"""

HAZARDS = {
    "E8Wg6tFPYjo": (
        "- Preserve ONE top-level strategy unless the transcript itself gives new evidence "
        "otherwise (the prior attempt correctly kept one strategy -- do not split it).\n"
        "- The prior candidate bound a claim about the indicator being optional/manual to the "
        "wrong sentence (one that only says 'look at my checklist'). Bind every claim to the exact "
        "quote that actually supports it, re-derived fresh -- do not assume the prior binding.\n"
        "- The prior candidate stored a visualization-only Fibonacci-extension step and an "
        "off-platform-execution instruction as if they were strategy 'variants', and stored "
        "demo/backtest practice advice as if it were in-trade 'management'. Keep this kind of "
        "non-executable material out of executable containers this time.\n"
        "- The core taught method (4-hour premium/discount alignment -> liquidity sweep -> break of "
        "structure + fair value gap -> 71% Fibonacci retracement pending-limit entry, stop/target at "
        "the Fibonacci-range endpoints) was already source-faithful in substance -- the fix needed is "
        "evidence-binding discipline and container discipline, not a different strategy."
    ),
    "7ieYBa7Z-Hg": (
        "- Preserve ONE top-level setup unless the transcript itself gives new evidence otherwise.\n"
        "- The source explicitly offers TWO co-equal entry/stop methods ('I can use one of two "
        "things...'): a 50%-of-zone entry with stop behind 70%, OR a candlestick-structure entry "
        "with a tighter stop. Represent both as co-equal alternatives/variants. Do NOT label either "
        "one 'primary' or 'preferred' -- the source does not rank them.\n"
        "- The source separately mentions retracement depths around 30%, 50%, or 70% as a general "
        "description of where price tends to retrace into the zone. Do not treat those three numbers "
        "as three separate executable entry systems unless the transcript itself clearly teaches them "
        "as three distinct, separately-triggered trade setups -- if it does not, represent this as "
        "descriptive/contextual evidence, not as three executable branches.\n"
        "- Do NOT invent a numeric priority ranking (1,2,3,4,5 or similar) across multiple taught "
        "target types unless the transcript itself states an order. Where the source teaches several "
        "possible targets without a selection rule, either preserve the specific conditions under "
        "which each is actually used (if the source states a condition), or mark the general "
        "selection-among-targets question source_unresolved rather than assigning an unsourced order."
    ),
    "1HFoStW_wsc": (
        "- Re-derive the number of top-level independent strategies from the transcript itself, "
        "from scratch. Do not assume any particular count (not 6, not 2, not 1) going in.\n"
        "- Apply an independence test to each candidate top-level strategy: does it, on its own, "
        "have a stated direction, a stated entry trigger, a stated stop, and a stated target? Content "
        "that only builds a price level or a regime/filter classification (with no independent entry/"
        "stop/target of its own) is NOT an independent top-level strategy -- it belongs as context or "
        "as a confluence/filter layer used by whichever strategy actually has complete entry/stop/"
        "target logic of its own.\n"
        "- The transcript explicitly frames trending-market and ranging-market applications as two "
        "modes of adapting ONE approach to different market conditions, not as two separate top-level "
        "strategies -- watch for this kind of 'apply the same method differently depending on regime' "
        "framing and do not split it into multiple strategy identities on that basis alone.\n"
        "- Do not let a shared sentence or shared reasoning that clearly describes an umbrella/general "
        "principle (rather than a strategy-specific trigger) become the sole entry-sequence trigger "
        "for more than one 'strategy' -- if the same exact source sentence would have to be quoted as "
        "the trigger for two different top-level strategies, that is evidence they are not actually "
        "independent."
    ),
}


def main() -> None:
    for video_id, hazards in HAZARDS.items():
        case = D.get_case(video_id)
        transcript_path, transcript = D.transcript_for(case)
        base_task = D.build_task(video_id, transcript)
        combined_task = base_task + ATOMIC_LAW.format(hazards=hazards)

        out_dir = OUT_ROOT / video_id
        out_dir.mkdir(parents=True, exist_ok=True)
        task_path = out_dir / "opus_source_reader_task.txt"
        task_path.write_text(combined_task, encoding="utf-8", newline="\n")

        index = {
            "artifact": "opus-transcript-first-task-index-v2",
            "status": "AWAITING_FRESH_OPUS_READER",
            "video_id": video_id,
            "diagnostic_category": case["category"],
            "reconstruction_round": 2,
            "transcript_path": str(transcript_path.relative_to(D.REPO_ROOT)).replace(os.sep, "/"),
            "transcript_sha256": sha256_text(transcript),
            "transcript_char_len": len(transcript),
            "task_path": str(task_path.relative_to(REPO_ROOT)).replace(os.sep, "/"),
            "task_sha256": sha256_text(combined_task),
            "required_model_override": D.REQUIRED_MODEL_OVERRIDE,
            "required_reader_role": D.REQUIRED_READER_ROLE,
            "semantic_blindness": {
                "legacy_extraction_opened_by_emit": False,
                "legacy_semantics_in_prompt": False,
                "construction": "static source-reader contract + AR-1374A atomic-authoring law + "
                                 "rejection-constraint hazards (not substitute facts) + exact transcript bytes only",
            },
            "next_step": (
                "Dispatch ONE fresh Claude Code subagent with model override=opus and give it ONLY "
                "opus_source_reader_task.txt. Save its raw final text verbatim. Create an invocation "
                "receipt bound to this task/transcript, then run ingest."
            ),
        }
        index_path = out_dir / "task_index.json"
        index_path.write_text(json.dumps(index, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
        print(f"[{video_id}] task_sha256={index['task_sha256']} transcript_sha256={index['transcript_sha256']}")
        print(f"[{video_id}] task_path={task_path}")


if __name__ == "__main__":
    main()
