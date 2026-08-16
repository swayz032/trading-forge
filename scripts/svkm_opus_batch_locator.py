"""LANE O1 DRIVER — batched Opus locator candidate on the frozen sVkm slice (AR-1234 §6).

WHY THIS EXISTS
    AR-1234 retired the current-config gemma locator from load-bearing evidence location and
    promoted Opus to preferred successor CANDIDATE — then forbade productionising the contest's
    topology. Twelve isolated subagents per video measured ~53k subagent tokens EACH
    (`opus_delegation_receipt.json`); at corpus scale that is not an architecture, it is a bill.

    §6 ordered the alternative: ONE fresh reader per video, the full transcript once, all spine
    conditions at once, returning `condition_ref -> literal quote | null`.

    🛑 A NEW TOPOLOGY DOES NOT INHERIT THE OLD ONE'S RESULT. This driver measures the transfer;
    it never assumes it.

WHAT THIS FILE OWNS AND WHAT IT DOES NOT
    It owns the sVkm PINS (video id, transcript sha, extraction sha) — identity of the input.
    It owns NO ANSWER. No span, no quote, no expected result appears here, and
    `test_batch_locator.py` red-proofs that the mechanics module is source-agnostic too
    (AR-1234 §6 control 10).

    🛑 IT DOES NOT SCORE (AR-1234 §3 / §4). Relevance, source fidelity and the verdict are the
    external scorer's. Every number this file prints is EXISTENCE or AGREEMENT.

THE REFUSALS, unchanged from the production drivers
    transcript bytes ≠ pin -> ABORT · extraction record ≠ pin -> ABORT · any write aimed at
    frozen Phase-1 history -> ABORT (AR-1232 §6.1, reused by import).

Run from the repo root:
  python scripts/svkm_opus_batch_locator.py emit
  python scripts/svkm_opus_batch_locator.py ingest <raw.json> --trial 1
  python scripts/svkm_opus_batch_locator.py verify
"""
from __future__ import annotations

import argparse
import json
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "scripts"))

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

import h1_pilot_phase1 as p1  # noqa: E402
import svkm_locator_benchmark as bench  # noqa: E402  — pins, loaders and frozen-write refusal

from src.engine.extraction import anchor_locator as al  # noqa: E402
from src.engine.extraction import batch_locator as bl  # noqa: E402
from src.engine.extraction import pilot_conveyor as pc  # noqa: E402
from src.engine.extraction import span_collision as sc  # noqa: E402

ARM_VERSION = "svkm-opus-batch-locator-o1-v1"

BENCH_DIR = bench.BENCH_DIR
O1_DIR = os.path.join(bench.POP_DIR, "o1-batch")
TASK_PATH = os.path.join(O1_DIR, "batch_task.txt")
TASK_INDEX_PATH = os.path.join(O1_DIR, "batch_task_index.json")
RESULTS_PATH = os.path.join(O1_DIR, "o1_batch_results.json")
REFERENCE_OPUS = os.path.join(BENCH_DIR, "answers_opus.json")
PRIOR_GEMMA = os.path.join(BENCH_DIR, "answers_gemma.json")
PHASE1 = os.path.join(bench.POP_DIR, "grade", "phase1.json")


def _answers_path(trial: int) -> str:
    return os.path.join(O1_DIR, f"answers_batch_t{trial}.json")


def _conditions() -> list[dict]:
    """The SAME spine conditions the benchmark froze, from the SAME producer, in the extraction's
    own order — not re-derived, not re-ordered, not filtered."""
    _, record = bench._load_pinned()
    out = []
    for si, strategy in enumerate(record["extraction"].get("strategies") or []):
        for cond in pc.extract_spine_condition_texts(strategy, si):
            out.append({
                "condition_ref": cond.condition_ref,
                "strategy_index": cond.strategy_index,
                "condition_text": cond.text,
                "condition_text_sha256": bl.sha256(cond.text),
            })
    return out


def _forbidden_needles() -> list[tuple[str, str]]:
    """Everything the batch reader must NOT be shown (AR-1234 §6 control 2): the losing
    candidate's answers, the winning isolated arm's answers, and the committed anchors.

    Built from the artifacts themselves rather than hand-listed, so a needle cannot be forgotten
    into a false clean."""
    needles: list[tuple[str, str]] = []
    for label, path, key in (
        ("prior_gemma_answer", PRIOR_GEMMA, "answers"),
        ("prior_isolated_opus_answer", REFERENCE_OPUS, "answers"),
    ):
        if os.path.exists(path):
            data = json.loads(open(path, encoding="utf-8").read())
            for a in data.get(key, []):
                if a.get("raw_output"):
                    needles.append((label, a["raw_output"]))
    if os.path.exists(PHASE1):
        blob = json.loads(open(PHASE1, encoding="utf-8").read())
        for quote in _walk_quotes(blob):
            needles.append(("committed_phase1_anchor", quote))
    return needles


def _walk_quotes(node, out=None) -> list[str]:
    out = [] if out is None else out
    if isinstance(node, dict):
        for k, v in node.items():
            if k in ("quote", "quote_anchor", "evidence") and isinstance(v, str):
                out.append(v)
            else:
                _walk_quotes(v, out)
    elif isinstance(node, list):
        for v in node:
            _walk_quotes(v, out)
    return out


# --------------------------------------------------------------------------- #
# emit — build the single delegation task and prove it is clean
# --------------------------------------------------------------------------- #


def cmd_emit() -> int:
    transcript, _ = bench._load_pinned()
    conditions = _conditions()
    task = bl.build_batch_task(al._SYSTEM_PROMPT, transcript, conditions)
    brief = bl.build_batch_brief(al._SYSTEM_PROMPT)

    # The transcript legitimately contains the sentences a prior answer quoted, so screening the
    # whole task would convict the input itself. Screen what the reader is TOLD, not what it
    # READS: the brief and the condition list.
    instruction_part = task.split("TRANSCRIPT:\n")[0]
    needles = _forbidden_needles()
    hits = bl.screen_task_for_leakage(instruction_part, needles)
    live = bl.screen_is_live(instruction_part, needles)

    if hits:
        raise SystemExit(f"[o1] ABORT: the delegation task leaks prior answers: {hits}")
    if not live["live"]:
        raise SystemExit(
            "[o1] ABORT: the leakage screen has no positive witness — a clean result from a "
            "screen that cannot fire is not evidence (`[absence-claim]`)."
        )

    os.makedirs(O1_DIR, exist_ok=True)
    bench._assert_not_frozen(TASK_PATH)
    with open(TASK_PATH, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(task)

    index = {
        "artifact": "svkm-o1-batch-delegation-task",
        "arm_version": ARM_VERSION,
        "authority": "AR-1234 §6 (LANE O1 — batched Opus locator candidate)",
        "topology": "ONE fresh reader per video; full transcript once; all spine conditions at "
                    "once; structured map condition_ref -> literal quote | null",
        "topology_confound": bl.TOPOLOGY_CONFOUND,
        "input": {
            "video_id": bench.VIDEO_ID,
            "transcript_sha256": bl.sha256(transcript),
            "transcript_char_count": len(transcript),
            "extraction_sha256": bench.EXTRACTION_PIN,
            "extractor_version": pc.extractor_version_pin(ROOT),
            "taxonomy_version": p1.TAXONOMY_VERSION,
        },
        "brief": {k: v for k, v in brief.items() if k != "reused_verbatim_from_production"},
        "conditions": conditions,
        "condition_count": len(conditions),
        "task_path": os.path.relpath(TASK_PATH, ROOT).replace("\\", "/"),
        "task_sha256": bl.sha256(task),
        "leakage_screen": {
            "needles_checked": len(needles),
            "hits": hits,
            "positive_witness": live,
            "surface": "the brief and the condition list — NOT the transcript, which legitimately "
                       "contains every sentence any candidate ever quoted",
        },
    }
    bench._write_json(TASK_INDEX_PATH, index)
    print(f"[o1] task -> {TASK_PATH}  ({len(conditions)} conditions, {len(task)} chars)")
    print(f"[o1] task_sha256       = {index['task_sha256']}")
    print(f"[o1] batch_brief_sha256= {brief['batch_brief_sha256']}")
    print(f"[o1] leakage: {len(hits)} hits over {len(needles)} needles; screen live={live['live']}")
    return 0


# --------------------------------------------------------------------------- #
# ingest — raw is sacred
# --------------------------------------------------------------------------- #


def cmd_ingest(src: str, trial: int, receipt: str | None) -> int:
    """`src` is the reader's RETURNED TEXT, exactly as it came back, already on disk.

    It is read as bytes first and hashed BEFORE it is parsed, so the artifact records what was
    returned rather than what survived my handling. Nothing here rewrites, trims or repairs a
    contestant answer (AR-1232 §6, carried into this arm)."""
    index = json.loads(open(TASK_INDEX_PATH, encoding="utf-8").read())
    raw_text = open(src, encoding="utf-8").read()

    refs = [c["condition_ref"] for c in index["conditions"]]
    rows = bl.parse_batch_return(raw_text, refs)

    artifact = {
        "artifact": "svkm-o1-batch-candidate-answers",
        "arm_version": ARM_VERSION,
        "task_sha256": index["task_sha256"],
        "trial": trial,
        "candidate": {
            "provider": "Claude Code subagent (subscription); no API key, no SDK, no new "
                        "Anthropic API spend (AR-1234 §6 control 12)",
            "model_identity_reported": "opus",
            "model_identity_caveat": "the strongest identity this execution path exposes. The "
                                     "exact provider build string is not available to the "
                                     "orchestrator and is NOT invented.",
            "invocation": "Agent tool, subagent_type=general-purpose, model override=opus, one "
                          "FRESH subagent per trial, given only the task file path",
        },
        "answers": rows,                                     # verbatim, unedited
        "raw_return_path": os.path.relpath(src, ROOT).replace("\\", "/"),
        "raw_return_sha256": bl.sha256(raw_text),            # hashed before parsing
        "delegation_receipt": (
            json.loads(open(receipt, encoding="utf-8").read()) if receipt else None
        ),
    }
    bench._write_json(_answers_path(trial), artifact)
    print(f"[o1] trial {trial}: ingested {len(rows)} answers -> {_answers_path(trial)}")
    return 0


# --------------------------------------------------------------------------- #
# verify — mechanics only
# --------------------------------------------------------------------------- #


def cmd_verify(trials: list[int]) -> int:
    transcript, _ = bench._load_pinned()
    index = json.loads(open(TASK_INDEX_PATH, encoding="utf-8").read())

    verified, sides = [], []
    for t in trials:
        path = _answers_path(t)
        if not os.path.exists(path):
            raise SystemExit(f"[o1] ABORT: trial {t} has no answers at {path}")
        data = json.loads(open(path, encoding="utf-8").read())
        if data["task_sha256"] != index["task_sha256"]:
            raise SystemExit(f"[o1] ABORT: trial {t} is bound to a different task.")
        rows = bl.verify_trial(transcript, data["answers"])
        for r in rows:
            r["trial"] = t
        verified.append(rows)
        sides.append(data)

    # Collision diagnostic on the COMPLETE returned set, per trial (AR-1234 §6 control 8).
    collisions = {}
    for t, rows in zip(trials, verified):
        locs = {
            r["condition_ref"]: tuple(r["mechanical_verifier"]["char_span"])
            for r in rows if r["mechanical_verifier"]["char_span"]
        }
        verdicts, groups = sc.adjudicate_locations(locs)
        collisions[str(t)] = {
            "summary": sc.summarise(groups),
            "groups": [{"span": list(g.span), "condition_refs": list(g.condition_refs),
                        "roles": list(g.roles), "severity": g.severity} for g in groups],
            "held_for_adjudication": sorted(
                r for r, v in verdicts.items() if v["status"] == sc.STATUS_HELD_FOR_ADJUDICATION
            ),
            "note": "HIGH collision means HOLD/review. It is not a semantic conviction and it "
                    "auto-accepts nothing (AR-1234 §6 control 9).",
        }

    # Parity against the accepted isolated-Opus arm — MECHANICAL span agreement only.
    parity = None
    if os.path.exists(REFERENCE_OPUS):
        ref = json.loads(open(REFERENCE_OPUS, encoding="utf-8").read())
        ref_rows = [
            {"condition_ref": a["condition_ref"],
             "mechanical_verifier": bl.verify_answer(transcript, a["raw_output"])}
            for a in ref["answers"]
        ]
        parity = {
            str(t): bl.compare_to_reference(rows, ref_rows) for t, rows in zip(trials, verified)
        }

    counts = []
    for rows in verified:
        outcomes = [r["mechanical_verifier"]["outcome"] for r in rows]
        counts.append({
            "total_answers": len(rows),
            "literal": outcomes.count(bl.OUTCOME_LITERAL),
            "not_literal_substring": outcomes.count(bl.OUTCOME_NOT_LITERAL),
            "abstained": outcomes.count(bl.OUTCOME_ABSTAINED),
        })

    artifact = {
        "artifact": "svkm-o1-batch-results",
        "arm_version": ARM_VERSION,
        "authority": "AR-1234 §6",
        "scoring": "NOT SCORED HERE. Topical relevance, source fidelity and the verdict belong "
                   "to the external scorer (AR-1234 §3). Every count below is EXISTENCE or "
                   "AGREEMENT — none of them says a quote is correct. AR-1234 §4: a located "
                   "quote does NOT certify a condition.",
        "topology_confound": bl.TOPOLOGY_CONFOUND,
        "literal_fence_caveat": "LITERAL means the span is real transcript text. AR-1223 proved "
                                "the fence accepts a real quote about the WRONG topic, so a high "
                                "literal count is compatible with systematic mis-grounding.",
        "task_sha256": index["task_sha256"],
        "input": index["input"],
        "trials": trials,
        "mechanical_counts_by_trial": dict(zip((str(t) for t in trials), counts)),
        "stability": bl.stability(verified),
        "collisions_by_trial": collisions,
        "parity_vs_isolated_opus_by_trial": parity,
        "answers_by_trial": dict(zip((str(t) for t in trials), verified)),
        "delegation_receipts": [s.get("delegation_receipt") for s in sides],
    }
    bench._write_json(RESULTS_PATH, artifact)
    print(f"[o1] wrote {RESULTS_PATH}")
    for t, c in zip(trials, counts):
        print(f"[o1] trial {t}: {json.dumps(c)}")
    print(f"[o1] stability: {json.dumps(artifact['stability']['summary'])}")
    if parity:
        for t in trials:
            print(f"[o1] parity t{t}: {json.dumps(parity[str(t)]['counts'])}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("emit")
    i = sub.add_parser("ingest")
    i.add_argument("src")
    i.add_argument("--trial", type=int, required=True)
    i.add_argument("--receipt", default=None)
    v = sub.add_parser("verify")
    v.add_argument("--trials", type=int, nargs="+", default=[1, 2, 3])
    args = ap.parse_args()

    if args.cmd == "emit":
        return cmd_emit()
    if args.cmd == "ingest":
        return cmd_ingest(args.src, args.trial, args.receipt)
    if args.cmd == "verify":
        return cmd_verify(args.trials)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
