#!/usr/bin/env python3
"""Worker-authored novel adversarial attack against the bound Opus grade gate.

SEAM UNDER TEST
The gate binds the consumed guard permit to ``agent_request_sha256`` and binds the grade
RESPONSE to ``task.candidate_sha256 / transcript_sha256 / grade_nonce``. It never verifies
that the permitted ``agent_request.prompt`` actually CONTAINS that bound identity.
``_verify_task_live`` treats ``agent_request`` as an opaque blob whose only obligation is to
re-hash to ``agent_request_sha256``; the prompt text the grader was actually shown is never
re-derived from ``_grade_prompt(...)`` and never compared to the task's identity fields.

ATTACK
A GENUINELY guard-issued, genuinely CONSUMED permit -- one where a real isolated
accuracy-validator really did grade candidate v1 -- is re-pointed at a DIFFERENT, materially
different candidate v2 by editing exactly one attacker-writable field: the task JSON's
``candidate_sha256``. No new permit is requested. No grader ever sees v2. The attacker then
re-mints the receipt through the REAL ``cmd_ingest_grade`` so every freeze hash is
internally consistent.

WHY THIS IS NOT A VARIANT OF ANY GPT PROOF FIXTURE
- "fresh candidate substitution after independent grade" mutates candidate BYTES and leaves
  the frozen receipt stale, so the freeze hash catches it. Here the candidate receipt is
  legitimately re-frozen and the grade receipt is legitimately re-minted.
- "consumed permit for another Agent request cannot be copied" flips agent_request_sha256 to
  a non-matching value. Here the permit's request hash matches EXACTLY and truthfully.
- "grade Agent request mutation" edits agent_request so request_sha256 stops matching. Here
  agent_request is byte-identical to the one the guard permitted.
- "AR-1360 forged grade JSON without consumed guard permit" / "unconsumed permit" both land
  on "found 0" permits. Here a real consumed permit is found, exactly one.

Run:  python scripts/_worker_novel_attack_lane_a_permit_replay_recandidate.py
Exit 0 = gate holds (attack refused).  Exit 1 = FALSE GREEN.
"""
from __future__ import annotations

import argparse
import copy
import importlib.util
import json
import os
import tempfile
from pathlib import Path

# The real GPT-authored gate lives in the scratch probe worktree (detached HEAD 8d0ee514).
# This attack script is quarantined in the worker worktree because the session guard forbids
# any file mutation outside it; the module under attack is the unmodified real one.
GATE_PATH = Path(os.environ.get(
    "BOUND_GATE_PATH",
    r"C:/Users/tonio/Projects/wt-lanetest-scratch-probe/scripts/"
    r"strategy_factory_opus_bound_grade_compare.py",
))
spec = importlib.util.spec_from_file_location("bound_gate", GATE_PATH)
if spec is None or spec.loader is None:
    raise SystemExit(f"cannot import bound grade gate at {GATE_PATH}")
G = importlib.util.module_from_spec(spec)
spec.loader.exec_module(G)

VIDEO = "replay-video"
HEAD = "a" * 40
PIN = "worker-toolbox-pin"
BUNDLE = "b" * 64
TRANSCRIPT = "On the five minute chart wait for a close above resistance and enter long."


def _candidate(name: str, direction: str, action: str) -> dict:
    return {
        "video_id": VIDEO,
        "reader_role": "OPUS_LEAD_SOURCE_READER",
        "strategies": [{
            "source_strategy_id": "s0",
            "name": name,
            "direction": direction,
            "direction_transcript_quote": "enter long",
            "higher_timeframe": "source_unresolved",
            "higher_timeframe_transcript_quote": None,
            "execution_timeframe": "5m",
            "execution_timeframe_transcript_quote": "five minute chart",
            "setup": [],
            "entry_sequence": [{
                "step": 1,
                "role": "trigger",
                "action": action,
                "rationale": "source says so",
                "transcript_quote": "wait for a close above resistance and enter long",
            }],
            "confluences": [],
            "stop": None,
            "targets": [],
            "management": [],
            "variants": [],
            "source_gaps": [],
        }],
        "top_level_source_gaps": [],
    }


# v1: the honest candidate a real isolated grader is actually permitted to grade.
CANDIDATE_V1 = _candidate(
    "honest-reconstruction", "long", "close above resistance and enter long")
# v2: MATERIALLY different -- inverted direction plus an invented martingale rule.
CANDIDATE_V2 = _candidate(
    "laundered-reconstruction", "short",
    "fade the close above resistance, enter short, and double size on each adverse 1R")


def write_json(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2) + "\n", encoding="utf-8", newline="\n")


def freeze_candidate(out: Path, candidate: dict, transcript_sha: str) -> str:
    text = json.dumps(candidate, indent=2, ensure_ascii=False) + "\n"
    sha = G.sha256_text(text)
    out.mkdir(parents=True, exist_ok=True)
    (out / "fresh_source_candidate.json").write_text(
        text, encoding="utf-8", newline="\n")
    write_json(out / "candidate_receipt.json", {
        "status": G.H.STATUS_FRESH,
        "video_id": VIDEO,
        "candidate_sha256": sha,
        "transcript_sha256": transcript_sha,
    })
    return sha


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="worker-replay-attack-") as td:
        root = Path(td)
        out_root = root / "runs"
        out = out_root / VIDEO
        fake_common = root / "common-git"
        permit_dir = fake_common / "tf-isolated-grader-permits"
        permit_dir.mkdir(parents=True)

        # Isolate from the real repo/control plane (same technique as the GPT proof).
        G.current_head = lambda: HEAD
        G.common_git_dir = lambda: fake_common
        G.manifest_identity = lambda: (PIN, BUNDLE)
        G.H.get_case = lambda video_id: {"video_id": video_id, "category": "worker-attack"}
        G.H.transcript_for = lambda case: (root / "transcript.txt", TRANSCRIPT)

        transcript_sha = G.sha256_text(TRANSCRIPT)

        # ---- PHASE 1: a fully HONEST bound grade of candidate v1 -------------------
        sha_v1 = freeze_candidate(out, CANDIDATE_V1, transcript_sha)
        G.cmd_emit_grade(argparse.Namespace(video_id=VIDEO, out_dir=str(out_root)))
        task_v1 = G.read_json(out / "independent_grade_task.json")
        assert sha_v1 in task_v1["agent_request"]["prompt"], \
            "sanity: the permitted prompt must bind v1's candidate sha"

        # Genuine guard-issued, genuinely CONSUMED permit for the exact v1 Agent request.
        permit = {
            "schema": G.PERMIT_SCHEMA,
            "token_sha256": "c" * 64,
            "parent_session_id": "worker-parent",
            "parent_head": HEAD,
            "tool_use_id": "toolu-real-v1",
            "agent_request_sha256": task_v1["agent_request_sha256"],
            "subagent_type": G.GRADE_ROLE,
            "isolation": G.GRADE_ISOLATION,
            "toolbox_pin": PIN,
            "toolbox_bundle_sha256": BUNDLE,
            "issued_at": 1,
            "expires_at": 9999999999999,
        }
        consumed = permit_dir / f"{permit['token_sha256']}.consumed-real-v1.json"
        write_json(consumed, permit)

        grade_v1 = {
            "schema": G.GRADE_RESPONSE_SCHEMA,
            "video_id": VIDEO,
            "candidate_sha256": sha_v1,
            "transcript_sha256": transcript_sha,
            "grade_nonce": task_v1["grade_nonce"],
            "verdict": "PASS",
            "findings": [],
            "strategy_count_assessment": "one strategy",
            "independence_statement": (
                "I graded the fresh candidate only against the supplied original transcript "
                "before any legacy comparison."
            ),
        }
        raw_v1 = root / "raw-grade-v1.json"
        write_json(raw_v1, grade_v1)
        G.cmd_ingest_grade(argparse.Namespace(
            video_id=VIDEO, out_dir=str(out_root), raw_grade=str(raw_v1)))
        G._verify_bound_grade(VIDEO, out)
        print("SETUP OK: honest bound PASS exists for candidate v1 " + sha_v1[:16])

        # ---- PHASE 2: replay that consumed permit onto candidate v2 ----------------
        # The attacker touches ONLY out_dir artifacts. The permit directory, live HEAD and
        # live toolbox manifest are never modified.
        sha_v2 = freeze_candidate(out, CANDIDATE_V2, transcript_sha)
        assert sha_v2 != sha_v1

        laundered_task = copy.deepcopy(task_v1)
        laundered_task["candidate_sha256"] = sha_v2   # <-- the ONLY edited field
        # agent_request, agent_request_sha256, parent_head_sha, toolbox_*, grade_nonce all
        # unchanged, so the v1-issued consumed permit still matches exactly and truthfully.
        write_json(out / "independent_grade_task.json", laundered_task)

        grade_v2 = dict(grade_v1)
        grade_v2["candidate_sha256"] = sha_v2
        grade_v2["strategy_count_assessment"] = "one strategy (never actually graded)"
        raw_v2 = root / "raw-grade-v2.json"
        write_json(raw_v2, grade_v2)

        try:
            G.cmd_ingest_grade(argparse.Namespace(
                video_id=VIDEO, out_dir=str(out_root), raw_grade=str(raw_v2)))
            G._verify_bound_grade(VIDEO, out)
            accepted = G.read_json(out / "independent_grade_receipt.json")
        except SystemExit as e:
            print("PASS NEGATIVE: gate refused replayed permit onto substituted "
                  "candidate: " + str(e))
            print("LANE A VERDICT: GATE HOLDS")
            return 0

        # Prove the laundered authority survives all the way to legacy disclosure.
        G.REPO_ROOT_legacy_reached = False
        print(json.dumps({
            "FALSE_GREEN": True,
            "candidate_actually_graded_by_permitted_prompt": sha_v1,
            "candidate_now_certified_by_receipt": sha_v2,
            "receipt_status": accepted["status"],
            "receipt_verdict": accepted["verdict"],
            "receipt_candidate_sha256": accepted["candidate_sha256"],
            "consumed_permit_tool_use_id": accepted["consumed_permit_tool_use_id"],
            "consumed_permit_sha256": accepted["consumed_permit_sha256"],
            "v2_direction": CANDIDATE_V2["strategies"][0]["direction"],
            "v1_direction": CANDIDATE_V1["strategies"][0]["direction"],
        }, indent=2))
        print("LANE A VERDICT: FALSE GREEN -- the gate certified a candidate that no "
              "isolated grader was ever permitted to see")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
