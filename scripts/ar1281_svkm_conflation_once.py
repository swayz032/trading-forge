#!/usr/bin/env python3
"""AR-1281 — ONE pinned sVkm semantic conflation judgment (gpt-5.4 FLEX HIGH).

Authority: GPT ruling AR-1280A §4 (2026-08-16).

WHY THIS EXISTS RATHER THAN `scripts/h1_conflation_check.py`:
  that script is a BATCH runner over `claude-rung-designpool/staging_v32` plus the
  calibration fixture, carries a $0.60 batch ticket, and sVkm is NOT a member of that
  staging directory. Running it would spend a batch ticket without targeting the one
  missing conjunct. AR-1280A §2 forbids it explicitly.

WHAT IS MISSING AND WHY IT MATTERS (AR-1280A §1):
  production certification is CONJUNCTIVE --
      full_grade = pilot_grade and terminal_read["clean"]
      certificate_grade = full_grade
  and `terminal_read_grade()` fails CLOSED when `conflation_verdict` is absent:
      None -> NOT_EVALUATED -> INDETERMINATE -> clean=false
  So the frozen G2 eight ALONE cannot make certificate_grade true. The semantic
  conflation verdict is an independent required conjunct. This script supplies exactly
  that one missing verdict -- nothing else.

HARD LIMITS (AR-1280A §4.B):
  successful semantic judgments = 1      design-pool calls = 0
  frozen G2 calls               = 0      Agent/subagent calls = 0
  Opus calibration retries      = 0      hard metered cap = $0.05

NO FREE-FORM SELECTION. Every identity below is pinned. There is no argv strategy or
video selector by construction; the only flag is --verify-only, which runs the
pre-spend gate and exits WITHOUT calling the model (used to red-proof the gate).

CALIBRATION IS REUSED, NOT RE-PAID (AR-1280A §3): the landed two-polarity pair is
verified to still read REJECT / PASS, and its artifact identities are recorded into the
verdict. The semantic grader file is byte-identical to the calibration commit
(blob 8b844b170f2095341b73b2af65432b441967a04b), so that calibration still describes
this grader.
"""
from __future__ import annotations

import hashlib
import json
import os
import pathlib
import subprocess
import sys
import time

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))

from h1_metered_cap_guard import MeteredCapGuard, CapBreach  # noqa: E402

# ---------------------------------------------------------------- PINNED IDENTITY
VIDEO_ID = "sVkmZklJDHI"
STRATEGY_INDEX = 0
STRATEGY_NAME = "fvg_breakout_range_1m_5m"
EXTRACTION_ARTIFACT = ROOT / "docs/replay-results/svkm-extraction-certified/sVkmZklJDHI.json"
EXTRACTION_SHA = "c37ff26f753449c35b6ec0402a3152dc287a8ae427eb0d86661b3fb43ec01823"
TRANSCRIPT_PATH = ROOT / "src/engine/extraction/fixtures/source-evidence/sVkmZklJDHI.transcript.txt"
TRANSCRIPT_SHA = "df72444f70e8c79db0e1692867913f14d37c18fd063f681a2b562fe103ce99cc"
GRADER_PATH = ROOT / "src/agents/semantic-conflation-check.md"
GRADER_BLOB = "8b844b170f2095341b73b2af65432b441967a04b"

MODEL = "gpt-5.4"
SERVICE_TIER = "flex"
REASONING_EFFORT = "high"
TICKET_USD = 0.05

CAL_DIR = ROOT / "docs/replay-results/h1-scripts/claude-rung-v32/conflation_grades"
CALIBRATION = {"CAL_R5L890_FUSED": "REJECT", "-igpOZs8LsM__s0": "PASS"}

OUT_PATH = ROOT / "docs/replay-results/svkm-extraction-certified/grade/conflation_verdict.json"

# Same strict ConflationVerdict schema as h1_conflation_check.py (verbatim shape).
SCHEMA = {
    "type": "object",
    "properties": {
        "strategy_name": {"type": "string"},
        "verdict": {"type": "string", "enum": ["PASS", "REJECT"]},
        "is_single_coherent_trade": {"type": "boolean"},
        "reasoning": {"type": "string"},
        "fused_pair": {"type": ["array", "null"], "items": {"type": "string"}},
    },
    "required": ["strategy_name", "verdict", "is_single_coherent_trade", "reasoning", "fused_pair"],
    "additionalProperties": False,
}


def sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def git_blob(path: pathlib.Path) -> str:
    out = subprocess.run(
        ["git", "hash-object", str(path)], cwd=str(ROOT), capture_output=True, text=True, check=True
    )
    return out.stdout.strip()


def preflight() -> dict:
    """Verify EVERY pin before any spend. Raises SystemExit on any mismatch."""
    fail: list[str] = []
    rec: dict = {}

    tx_bytes = TRANSCRIPT_PATH.read_bytes()
    tx_sha = sha256_bytes(tx_bytes)
    rec["transcript_sha256"] = tx_sha
    rec["transcript_bytes"] = len(tx_bytes)
    if tx_sha != TRANSCRIPT_SHA:
        fail.append(f"transcript sha {tx_sha} != pin {TRANSCRIPT_SHA}")

    art = json.loads(EXTRACTION_ARTIFACT.read_text(encoding="utf-8"))
    rec["extraction_sha256"] = art.get("extraction_sha256")
    if art.get("extraction_sha256") != EXTRACTION_SHA:
        fail.append(f"extraction_sha256 {art.get('extraction_sha256')} != pin {EXTRACTION_SHA}")
    if art.get("video_id") != VIDEO_ID:
        fail.append(f"video_id {art.get('video_id')} != {VIDEO_ID}")
    seed = art.get("seed_params") or {}
    if seed.get("transcript_sha256") != TRANSCRIPT_SHA:
        fail.append("seed_params.transcript_sha256 does not match the transcript pin")

    strategies = (art.get("extraction") or {}).get("strategies") or []
    if len(strategies) <= STRATEGY_INDEX:
        fail.append(f"strategy_index {STRATEGY_INDEX} absent (have {len(strategies)})")
        strat = None
    else:
        strat = strategies[STRATEGY_INDEX]
        got = strat.get("name") or strat.get("strategy_name")
        rec["strategy_name"] = got
        if got != STRATEGY_NAME:
            fail.append(f"strategy name {got!r} != pin {STRATEGY_NAME!r}")

    blob = git_blob(GRADER_PATH)
    rec["grader_blob"] = blob
    if blob != GRADER_BLOB:
        fail.append(f"grader blob {blob} != calibration-era blob {GRADER_BLOB}")

    cal_rec = {}
    for cid, expected in CALIBRATION.items():
        p = CAL_DIR / f"{cid}.json"
        raw = p.read_bytes()
        got = json.loads(raw.decode("utf-8"))["verdict"]["verdict"]
        cal_rec[cid] = {
            "path": str(p.relative_to(ROOT)).replace("\\", "/"),
            "file_sha256": sha256_bytes(raw),
            "observed": got,
            "required": expected,
        }
        if got != expected:
            fail.append(f"calibration {cid} reads {got}, required {expected}")
    rec["calibration"] = cal_rec

    print("PREFLIGHT")
    print(f"  transcript sha256 : {tx_sha} ({len(tx_bytes)} bytes)")
    print(f"  extraction_sha256 : {rec.get('extraction_sha256')}")
    print(f"  strategy[{STRATEGY_INDEX}]      : {rec.get('strategy_name')}")
    print(f"  grader blob       : {blob}")
    for cid, c in cal_rec.items():
        print(f"  calibration {cid:<20} {c['observed']} (required {c['required']})")

    if fail:
        print("\nPREFLIGHT FAILED — REFUSING TO SPEND:")
        for f in fail:
            print(f"  !! {f}")
        raise SystemExit(2)
    print("  => ALL PINS VERIFIED. Cleared for exactly ONE judgment.\n")
    return {"strategy": strat, "transcript": tx_bytes.decode("utf-8"), "record": rec}


def main() -> int:
    verify_only = "--verify-only" in sys.argv
    pre = preflight()
    if verify_only:
        print("--verify-only: gate passed, NO call made, $0.00 spent.")
        return 0

    from openai import OpenAI  # imported after preflight so a bad pin never loads a client

    # `.env` is gitignored, so it is per-checkout and absent from this worktree. Fixed,
    # explicit search order -- the worktree first, then the canonical main checkout this
    # worktree's git-dir belongs to. The preserved read-only evidence checkout
    # (wt-h1-wave4-20260712) is deliberately NOT consulted.
    env_candidates = [ROOT / ".env", pathlib.Path("C:/Users/tonio/Projects/trading-forge/trading-forge/.env")]
    env_path = next((p for p in env_candidates if p.is_file()), None)
    if env_path is None:
        print("!! no .env with OPENAI_API_KEY found in: " + ", ".join(str(p) for p in env_candidates))
        return 5
    key = [
        l.split("=", 1)[1].strip().strip('"').strip("'")
        for l in open(env_path, encoding="utf-8")
        if l.startswith("OPENAI_API_KEY=")
    ][0]
    print(f"  credential source: {env_path}")
    client = OpenAI(api_key=key, timeout=1200, max_retries=0)

    grader = GRADER_PATH.read_text(encoding="utf-8")
    strat = pre["strategy"]
    user = (
        f"TRANSCRIPT (context):\n{pre['transcript']}\n\n"
        f"STRATEGY OBJECT to judge:\n{json.dumps(strat, ensure_ascii=False)}\n\n"
        "Apply the mirror-vs-fusion test. Return ONLY the JSON."
    )
    body = {
        "model": MODEL,
        "service_tier": SERVICE_TIER,
        "reasoning_effort": REASONING_EFFORT,
        "messages": [{"role": "system", "content": grader}, {"role": "user", "content": user}],
        "response_format": {
            "type": "json_schema",
            "json_schema": {"name": "ConflationVerdict", "schema": SCHEMA, "strict": True},
        },
    }

    guard = MeteredCapGuard(TICKET_USD)
    est = (len(json.dumps(body)) // 4) + 3500
    print(f"one call: model={MODEL} tier={SERVICE_TIER} effort={REASONING_EFFORT}")
    print(f"  est ~{est} tok -> projected ${guard.project_next(est):.4f} / cap ${TICKET_USD:.2f}")

    verdict = None
    usage = None
    delay = 8.0
    # Transport retry ONLY while no semantic result exists (AR-1280A §4.B).
    for attempt in range(4):
        try:
            guard.guard_or_raise(est)
            t0 = time.time()
            r = client.chat.completions.create(**body)
            verdict = json.loads(r.choices[0].message.content)
            usage = r.usage
            guard.record(usage.total_tokens)
            print(f"  returned in {time.time()-t0:.0f}s | {usage.total_tokens} tok")
            break  # a valid PASS/REJECT exists -> NO second judgment, ever
        except CapBreach as e:
            print(f"  !! HARD-CAP STOP: {e}")
            return 3
        except Exception as e:  # transport only; no semantic result was produced
            m = str(e)
            transient = any(
                x in m.lower() for x in ["429", "resource", "rate", "overloaded", "try again", "timeout"]
            )
            if transient and attempt < 3:
                print(f"  transport retry {attempt+1}: {type(e).__name__}")
                time.sleep(delay)
                delay = min(delay * 1.7, 90)
                continue
            print(f"  !! CALL FAILED {type(e).__name__}: {m[:200]}")
            return 4

    out = {
        "authorization": "AR-1280A §4 (one sVkm semantic conflation judgment)",
        "video_id": VIDEO_ID,
        "strategy_index": STRATEGY_INDEX,
        "strategy_name": pre["record"].get("strategy_name"),
        "transcript_sha256": pre["record"]["transcript_sha256"],
        "transcript_bytes": pre["record"]["transcript_bytes"],
        "extraction_sha256": pre["record"]["extraction_sha256"],
        "extraction_artifact": str(EXTRACTION_ARTIFACT.relative_to(ROOT)).replace("\\", "/"),
        "grader": {
            "path": str(GRADER_PATH.relative_to(ROOT)).replace("\\", "/"),
            "git_blob": pre["record"]["grader_blob"],
        },
        "model": MODEL,
        "service_tier": SERVICE_TIER,
        "reasoning_effort": REASONING_EFFORT,
        "response_schema": "ConflationVerdict (strict, identical to h1_conflation_check.py)",
        "calibration_reused": pre["record"]["calibration"],
        "verdict": verdict,
        "total_tokens": usage.total_tokens if usage else None,
        "prompt_tokens": usage.prompt_tokens if usage else None,
        "completion_tokens": usage.completion_tokens if usage else None,
        "measured_spend_usd": round(guard.spent_usd, 5),
        "cap_usd": TICKET_USD,
        "spend_basis": "MeteredCapGuard blend 2.5 USD/Mtok (estimate, not a billed figure)",
        "judgments_made": 1,
    }
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1)
        fh.write("\n")

    print("\nVERDICT")
    print(f"  verdict                  = {verdict['verdict']}")
    print(f"  is_single_coherent_trade = {verdict['is_single_coherent_trade']}")
    print(f"  fused_pair               = {verdict['fused_pair']}")
    print(f"  spend                    = ${guard.spent_usd:.4f} / ${TICKET_USD:.2f}")
    print(f"  written                  -> {OUT_PATH.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
