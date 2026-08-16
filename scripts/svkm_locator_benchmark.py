"""sVkm LOCATOR BENCHMARK — AR-1231 / AR-1232.

WHAT THIS IS
    The orchestrator for a two-candidate locator benchmark on the frozen sVkm golden slice.
    Candidate A and Candidate B each receive the SAME frozen task prompt and the SAME pinned
    input packet, answer independently, and are then checked by the SAME mechanical verifier.

    🛑 THIS SCRIPT DOES NOT SCORE. AR-1232 §7: "No candidate grades itself. The parent worker
    may report mechanics only, not declare the winner." Semantic relevance and source fidelity
    are GPT's, not this file's. Nothing here emits a winner.

THE FAIRNESS CONTROL (AR-1232 §3)
    The benchmark prompt is NOT authored here. It is the production locator's own prompt,
    reused BY IMPORT from `anchor_locator` — `_SYSTEM_PROMPT` verbatim and `_build_user_message`
    unchanged. Neither candidate can be handed a better brief, because the brief is the one
    Gemma already runs in production and neither side's author wrote it for this contest.

    🛑 HONEST LIMIT, stated because §3 requires it: the CONTROLLED VARIABLE is the benchmark
    task prompt plus the input packet, whose hashes are recorded. It is NOT the candidates'
    entire hidden context. A Claude Code subagent carries platform/system context a local
    gemma call does not, and this harness cannot and does not claim otherwise.

WHAT IS FROZEN, AND WHY THE HASHES MATTER
    prompt (system + user template) · transcript bytes · extraction record · each condition's
    text. All hashed into the packet. A candidate answer is only admissible against the packet
    hash it was asked under; changing the prompt makes a NEW benchmark version and both sides
    re-run (§5).

RAW OUTPUT IS SACRED (AR-1232 §6)
    Each candidate's raw returned string is persisted BEFORE any parsing, trimming or
    verification. The parent worker may not "clean up" a contestant answer. The mechanical
    verifier's result is recorded as a SEPARATE field from the raw answer, so a disagreement
    between them stays visible instead of being resolved silently.

BLINDING (AR-1232 §6, CORRECTED BY AR-1234 §5.1)
    The published artifact labels the candidates `candidate_A` / `candidate_B`.

    🛑 THE FIRST VERSION SHIPPED THE IDENTITY MAP AT THE BOTTOM OF THE SAME FILE, and AR-1234
    §5.1 correctly ruled that once a scorer reads the whole file the blinding is gone: the score
    it produced was an INDEPENDENT external score, not a sealed blind one. The map now goes to
    its own file (`--identity-out`), so a scorer can read the results without reading identities.
    That is an artifact-layout fix, not a new framework — no scoring machinery is added here.

Run from repo root:
  python scripts/svkm_locator_benchmark.py freeze              # build + hash the input packet
  python scripts/svkm_locator_benchmark.py run-gemma           # candidate: local gemma
  python scripts/svkm_locator_benchmark.py ingest-opus <file>  # candidate: Opus subagent answers
  python scripts/svkm_locator_benchmark.py verify              # mechanical checks + blinded artifact
"""
from __future__ import annotations

import argparse
import hashlib
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

from src.engine.extraction import anchor_locator as al  # noqa: E402
from src.engine.extraction import pilot_conveyor as pc  # noqa: E402
from src.engine.extraction import span_collision as sc  # noqa: E402

VIDEO_ID = "sVkmZklJDHI"
TRANSCRIPT_PIN = "df72444f70e8c79db0e1692867913f14d37c18fd063f681a2b562fe103ce99cc"
EXTRACTION_PIN = "c37ff26f753449c35b6ec0402a3152dc287a8ae427eb0d86661b3fb43ec01823"

POP_DIR = os.path.join(ROOT, "docs", "replay-results", "svkm-extraction-certified")
EXTRACTION_PATH = os.path.join(POP_DIR, f"{VIDEO_ID}.json")
BENCH_DIR = os.path.join(POP_DIR, "benchmark")
PACKET_PATH = os.path.join(BENCH_DIR, "benchmark_packet_v1.json")
TRANSCRIPT_PATH = os.path.join(
    ROOT, "src", "engine", "extraction", "fixtures", "source-evidence", f"{VIDEO_ID}.transcript.txt"
)

BENCHMARK_VERSION = "svkm-locator-benchmark-v1"

# AR-1232 §6.1: frozen Phase-1 history this harness may never write.
FROZEN_OUTPUTS = ("phase1.json", "phase1_preps.pkl", "phase2_certificate.json", "certificate.json")


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _assert_not_frozen(path: str) -> None:
    if os.path.basename(path) in FROZEN_OUTPUTS:
        raise SystemExit(f"[bench] ABORT: {os.path.basename(path)} is frozen history — refusing.")


def _write_json(path: str, obj: dict) -> None:
    _assert_not_frozen(path)
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    tmp = path + f".{os.getpid()}.tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(obj, fh, indent=2, default=str)
    os.replace(tmp, path)


def _load_pinned() -> tuple[str, dict]:
    """Both refusal gates, unchanged from the production drivers."""
    transcript = open(TRANSCRIPT_PATH, encoding="utf-8", newline="").read()
    tsha = _sha256(transcript)
    if tsha != TRANSCRIPT_PIN:
        raise SystemExit("[bench] ABORT: transcript bytes differ from the pin — REFUSING.")
    record = json.loads(open(EXTRACTION_PATH, encoding="utf-8").read())
    if record.get("extraction_sha256") != EXTRACTION_PIN:
        raise SystemExit("[bench] ABORT: extraction record differs from the pin — REFUSING.")
    return transcript, record


# --------------------------------------------------------------------------- #
# B — freeze the packet
# --------------------------------------------------------------------------- #


def cmd_freeze() -> int:
    transcript, record = _load_pinned()
    extraction = record["extraction"]
    strategies = extraction.get("strategies") or []

    conditions = []
    for si, strategy in enumerate(strategies):
        for cond in pc.extract_spine_condition_texts(strategy, si):
            conditions.append({
                "condition_ref": cond.condition_ref,
                "strategy_index": cond.strategy_index,
                "condition_text": cond.text,
                "condition_text_sha256": _sha256(cond.text),
            })

    # THE SHARED BRIEF — production's own, reused by import, not authored here.
    system_prompt = al._SYSTEM_PROMPT
    user_template_probe = al._build_user_message("<TRANSCRIPT>", "<CONDITION>")

    packet = {
        "artifact": BENCHMARK_VERSION,
        "authority": "AR-1231 (benchmark authorized) + AR-1232 (execution corrected to a "
                     "Claude Code Opus subagent; no API key, SDK, or new API spend)",
        "stage": "FROZEN INPUT PACKET — no candidate answers, no scores",
        "fairness_contract": {
            "shared_prompt_origin": "src/engine/extraction/anchor_locator.py::_SYSTEM_PROMPT and "
                                    "_build_user_message, reused BY IMPORT and unmodified",
            "controlled_variable": "benchmark task prompt + input packet (hashed below)",
            "NOT_controlled": "the candidates' full hidden context. A Claude Code subagent "
                              "carries platform/system context a local gemma call does not. "
                              "AR-1232 §3 forbids claiming byte-identical total context.",
            "per_side_additions": "none — no candidate-specific examples, hints, synonyms, "
                                  "source spans, or corrective prose may be added to one side",
        },
        "prompt": {
            "system_prompt": system_prompt,
            "system_prompt_sha256": _sha256(system_prompt),
            "user_message_template_probe": user_template_probe,
            "user_message_template_sha256": _sha256(user_template_probe),
        },
        "input": {
            "video_id": VIDEO_ID,
            "transcript_sha256": _sha256(transcript),
            "transcript_char_count": len(transcript),
            "transcript_path": os.path.relpath(TRANSCRIPT_PATH, ROOT).replace("\\", "/"),
            "extraction_sha256": EXTRACTION_PIN,
            "extractor_version": pc.extractor_version_pin(ROOT),
            "taxonomy_version": p1.TAXONOMY_VERSION,
        },
        "conditions": conditions,
        "condition_count": len(conditions),
    }
    packet["packet_sha256"] = _sha256(
        json.dumps({k: v for k, v in packet.items() if k != "packet_sha256"},
                   sort_keys=True, ensure_ascii=False)
    )

    _write_json(PACKET_PATH, packet)
    print(f"[bench] froze {len(conditions)} conditions -> {PACKET_PATH}")
    print(f"[bench] packet_sha256      = {packet['packet_sha256']}")
    print(f"[bench] system_prompt_sha  = {packet['prompt']['system_prompt_sha256']}")
    print(f"[bench] transcript_sha256  = {packet['input']['transcript_sha256']}")
    return 0


def cmd_emit_tasks(outdir: str) -> int:
    """Render ONE delegation file per condition, so a subagent sees exactly what one gemma call
    sees: the frozen system prompt, ONE condition, and the full transcript.

    🛑 ONE CONDITION PER FILE IS A FAIRNESS CONTROL, NOT A CONVENIENCE. Gemma answers each
    condition blind to the other eleven. A single challenger shown all twelve at once could use
    cross-condition information gemma never has — which is precisely the per-side advantage
    AR-1232 §3 forbids. One isolated context per condition keeps the shapes comparable.

    The files contain the production brief and the pinned input and nothing else: no gemma
    output, no prior span, no adjudication label, no hint about which answer is expected
    (AR-1232 §4).
    """
    packet = _load_packet()
    transcript, _ = _load_pinned()
    os.makedirs(outdir, exist_ok=True)

    written = []
    for cond in packet["conditions"]:
        body = (
            f"{packet['prompt']['system_prompt']}\n\n"
            f"{al._build_user_message(transcript, cond['condition_text'])}"
        )
        safe = cond["condition_ref"].replace("[", "_").replace("]", "_").replace(".", "_")
        path = os.path.join(outdir, f"task_{safe}.txt")
        with open(path, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(body)
        written.append({
            "condition_ref": cond["condition_ref"],
            "path": os.path.relpath(path, ROOT).replace("\\", "/"),
            "task_sha256": _sha256(body),
        })

    index = {
        "artifact": "svkm-locator-benchmark-delegation-tasks",
        "benchmark_version": BENCHMARK_VERSION,
        "packet_sha256": packet["packet_sha256"],
        "contains": "frozen system prompt + one condition + full pinned transcript, per file",
        "excludes": "gemma outputs, prior spans, adjudication labels, expected answers, "
                    "worker commentary (AR-1232 §4)",
        "tasks": written,
    }
    _write_json(os.path.join(outdir, "task_index.json"), index)
    print(f"[bench] emitted {len(written)} delegation tasks -> {outdir}")
    return 0


def _load_packet() -> dict:
    if not os.path.exists(PACKET_PATH):
        raise SystemExit("[bench] ABORT: no frozen packet — run `freeze` first.")
    return json.loads(open(PACKET_PATH, encoding="utf-8").read())


# --------------------------------------------------------------------------- #
# C — candidate side: local gemma
# --------------------------------------------------------------------------- #


def cmd_run_gemma(trials: int, out: str) -> int:
    """AR-1232 §5: same task prompt semantics, same pinned packet; record exact model identity
    and generation settings, and preserve the RAW candidate quote before the verifier."""
    packet = _load_packet()
    transcript, _ = _load_pinned()

    answers = []
    for trial in range(1, trials + 1):
        for cond in packet["conditions"]:
            raw = p1.robust_propose(transcript, cond["condition_text"])
            answers.append({
                "condition_ref": cond["condition_ref"],
                "condition_text_sha256": cond["condition_text_sha256"],
                "trial": trial,
                # RAW, before any verification, trimming, or repair.
                "raw_output": raw,
                "abstained": raw is None,
            })
        print(f"[bench] gemma trial {trial}/{trials}: {len(packet['conditions'])} conditions", flush=True)

    artifact = {
        "artifact": "svkm-locator-benchmark-candidate-answers",
        "benchmark_version": BENCHMARK_VERSION,
        "packet_sha256": packet["packet_sha256"],
        "candidate": {
            "provider": "local ollama",
            "model_identity": al._GEMMA_MODEL,
            "invocation": "h1_pilot_phase1.robust_propose -> anchor_locator._default_propose_fn",
            "generation_settings": {"temperature": 0.1, "top_p": 0.95, "top_k": 64},
            "determinism": "SAMPLED, NOT DETERMINISTIC — a non-zero temperature with top_p/top_k "
                           "sampling is requested explicitly (AR-1230 §4). Repeat trials measure "
                           "this, they do not remove it.",
        },
        "trials": trials,
        "answers": answers,
    }
    _write_json(out, artifact)
    print(f"[bench] wrote {out} ({len(answers)} raw answers)")
    return 0


# --------------------------------------------------------------------------- #
# D/E — candidate side: Opus subagent (answers ingested, never authored here)
# --------------------------------------------------------------------------- #


def cmd_ingest_opus(src: str, out: str, receipt: str | None) -> int:
    """AR-1232 §4: preserve the subagent's RAW returned answer. The parent worker may not
    rewrite, clean up, normalize, or repair a contestant answer. This command therefore only
    validates the packet binding and the shape — it never edits `raw_output`."""
    packet = _load_packet()
    payload = json.loads(open(src, encoding="utf-8").read())

    if payload.get("packet_sha256") != packet["packet_sha256"]:
        raise SystemExit(
            "[bench] ABORT: answers were produced against a DIFFERENT packet "
            f"({payload.get('packet_sha256')} != {packet['packet_sha256']}). "
            "A candidate answer is only admissible against the packet it was asked under."
        )

    expected = {c["condition_ref"] for c in packet["conditions"]}
    got = {a["condition_ref"] for a in payload.get("answers", [])}
    missing, extra = sorted(expected - got), sorted(got - expected)
    if missing or extra:
        raise SystemExit(f"[bench] ABORT: condition set mismatch. missing={missing} extra={extra}")

    artifact = {
        "artifact": "svkm-locator-benchmark-candidate-answers",
        "benchmark_version": BENCHMARK_VERSION,
        "packet_sha256": packet["packet_sha256"],
        "candidate": payload["candidate"],
        "trials": payload.get("trials", 1),
        "answers": payload["answers"],          # verbatim, unedited
        "raw_payload_sha256": _sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False)),
        "delegation_receipt": json.loads(open(receipt, encoding="utf-8").read()) if receipt else None,
    }
    _write_json(out, artifact)
    print(f"[bench] ingested {len(payload['answers'])} raw answers -> {out}")
    print(f"[bench] raw_payload_sha256 = {artifact['raw_payload_sha256']}")
    return 0


# --------------------------------------------------------------------------- #
# F/G — mechanical checks + blinded artifact
# --------------------------------------------------------------------------- #


def _verify_one(transcript: str, raw: str | None) -> dict:
    """THE SAME mechanical verifier both candidates face. Literal-substring fence unchanged
    (`anchor_locator._verify_and_locate` -> `compile_lints.f2_coverage_gate`)."""
    if raw is None:
        return {"outcome": "ABSTAINED", "char_span": None, "quote": None, "quote_sha256": None}
    span = al._verify_and_locate(transcript, raw)
    if span is None:
        return {"outcome": "NOT_LITERAL_SUBSTRING", "char_span": None, "quote": None,
                "quote_sha256": None}
    quote = transcript[span[0]:span[1]]
    return {"outcome": "LITERAL", "char_span": [span[0], span[1]], "quote": quote,
            "quote_sha256": _sha256(quote)}


def _comparability_caveats(blinded: list[dict]) -> list[str]:
    """AR-1234 §5.2: the trial-count caveat was HARDCODED and went stale — it still warned that
    trial counts differ after both sides reached 3. A caveat that describes a state the artifact
    is not in is a false statement in an evidence file, so it is COMPUTED now and can only say
    what the data says (`[report-table]`: fix the emitter, not the table)."""
    counts = {s["label"]: s.get("trials", 1) for s in blinded}
    distinct = set(counts.values())
    caveats = []
    if len(distinct) > 1:
        caveats.append(
            f"TRIAL COUNTS DIFFER between candidates ({counts}). Raw literal/not-literal COUNTS "
            "are therefore NOT directly comparable across sides — compare per-trial rates, and "
            "treat any side with <2 trials as having UNTESTED reproducibility."
        )
    else:
        caveats.append(
            f"Trial counts are EQUAL across candidates ({counts}), so raw counts are comparable "
            "at equal denominators. This line is computed from the artifact, not asserted."
        )
    if any(v < 2 for v in counts.values()):
        caveats.append(
            "At least one side has <2 trials: its reproducibility is UNTESTED, not stable."
        )
    caveats.append("Collision counts are reported PER TRIAL.")
    caveats.append(
        "No semantic score is present. Topical relevance, source fidelity and abstention quality "
        "are the external scorer's (AR-1232 §7)."
    )
    return caveats


def cmd_verify(sources: list[str], out: str, identity_out: str) -> int:
    packet = _load_packet()
    transcript, _ = _load_pinned()

    sides = []
    for path in sources:
        data = json.loads(open(path, encoding="utf-8").read())
        if data.get("packet_sha256") != packet["packet_sha256"]:
            raise SystemExit(f"[bench] ABORT: {path} is bound to a different packet.")
        sides.append(data)

    blinded, identity_map = [], {}
    for idx, data in enumerate(sides):
        label = f"candidate_{chr(ord('A') + idx)}"
        identity_map[label] = data["candidate"]

        rows = []
        for a in data["answers"]:
            mech = _verify_one(transcript, a["raw_output"])
            rows.append({
                "condition_ref": a["condition_ref"],
                "condition_text_sha256": a["condition_text_sha256"],
                "trial": a.get("trial", 1),
                "raw_output": a["raw_output"],      # untouched
                "mechanical_verifier": mech,        # separate field — disagreements stay visible
            })

        # Reproducibility (mechanical only): does the same condition give the same span again?
        by_ref: dict[str, list] = {}
        for r in rows:
            by_ref.setdefault(r["condition_ref"], []).append(r)
        repeatability = {
            ref: {
                "trials": len(rs),
                "distinct_raw_outputs": len({json.dumps(r["raw_output"]) for r in rs}),
                "distinct_spans": len({json.dumps(r["mechanical_verifier"]["char_span"]) for r in rs}),
                # 🛑 A SINGLE TRIAL CANNOT BE "IDENTICAL ACROSS TRIALS" — with one sample the
                # comparison is vacuously true and reads as a perfect stability score. That is a
                # green with no path to red, so it reports UNTESTED instead of True.
                "identical_across_trials": (
                    None if len(rs) < 2 else (
                        len({json.dumps(r["raw_output"]) for r in rs}) == 1
                        and len({json.dumps(r["mechanical_verifier"]["char_span"]) for r in rs}) == 1
                    )
                ),
                "repeatability_measurable": len(rs) >= 2,
            }
            for ref, rs in by_ref.items()
        }

        # Collision diagnostic, per trial, on that trial's located set.
        collisions_by_trial = {}
        for trial in sorted({r["trial"] for r in rows}):
            locs = {
                r["condition_ref"]: tuple(r["mechanical_verifier"]["char_span"])
                for r in rows
                if r["trial"] == trial and r["mechanical_verifier"]["char_span"]
            }
            verdicts, collisions = sc.adjudicate_locations(locs)
            collisions_by_trial[str(trial)] = {
                "summary": sc.summarise(collisions),
                "groups": [
                    {"span": list(c.span), "condition_refs": list(c.condition_refs),
                     "roles": list(c.roles), "severity": c.severity}
                    for c in collisions
                ],
                "held_for_adjudication": sorted(
                    r for r, v in verdicts.items()
                    if v["status"] == sc.STATUS_HELD_FOR_ADJUDICATION
                ),
            }

        measurable = [v for v in repeatability.values() if v["repeatability_measurable"]]
        repeatability_summary = (
            {"status": "UNTESTED — fewer than 2 trials; no stability claim is admissible",
             "conditions_measured": 0}
            if not measurable else
            {"status": "MEASURED",
             "conditions_measured": len(measurable),
             "identical_across_trials":
                 sum(1 for v in measurable if v["identical_across_trials"])}
        )

        outcomes = [r["mechanical_verifier"]["outcome"] for r in rows]
        blinded.append({
            "label": label,
            "trials": data.get("trials", 1),
            "answers": rows,
            "mechanical_counts": {
                "total_answers": len(rows),
                "literal": outcomes.count("LITERAL"),
                "not_literal_substring": outcomes.count("NOT_LITERAL_SUBSTRING"),
                "abstained": outcomes.count("ABSTAINED"),
            },
            "repeatability_summary": repeatability_summary,
            "repeatability": repeatability,
            "collisions_by_trial": collisions_by_trial,
            "delegation_receipt": data.get("delegation_receipt"),
        })

    artifact = {
        "artifact": "svkm-locator-benchmark-blinded-results",
        "benchmark_version": BENCHMARK_VERSION,
        "authority": "AR-1231 + AR-1232",
        "packet_sha256": packet["packet_sha256"],
        "input": packet["input"],
        "prompt_hashes": {
            "system_prompt_sha256": packet["prompt"]["system_prompt_sha256"],
            "user_message_template_sha256": packet["prompt"]["user_message_template_sha256"],
        },
        "scoring": "NOT SCORED HERE. AR-1232 §7 reserves relevance, source fidelity, abstention "
                   "quality and the verdict to the GPT external scorer. This artifact carries "
                   "mechanical results only and names no winner.",
        "comparability_caveats": _comparability_caveats(blinded),
        "blinding": {
            "identity_map_location": os.path.relpath(identity_out, ROOT).replace("\\", "/"),
            "contract": "AR-1234 §5.1 — the identity map is NOT in this file. A scorer can read "
                        "every answer here without learning which brand produced it. Reading the "
                        "identity file is a deliberate act, and doing it before committing a "
                        "score forfeits the blind.",
        },
        "candidates_blinded": blinded,
    }
    if "candidate_identity_map" in artifact:                      # belt and braces
        raise SystemExit("[bench] ABORT: identity map leaked back into the blinded artifact.")
    _write_json(out, artifact)

    _write_json(identity_out, {
        "artifact": "svkm-locator-benchmark-candidate-identity-map",
        "authority": "AR-1234 §5.1",
        "warning": "OPENING THIS FILE UNBLINDS THE BENCHMARK. Commit the score first.",
        "blinded_results": os.path.relpath(out, ROOT).replace("\\", "/"),
        "packet_sha256": packet["packet_sha256"],
        "candidate_identity_map": identity_map,
    })
    print(f"[bench] wrote {out}")
    print(f"[bench] wrote {identity_out}  (identity map SPLIT OUT — AR-1234 §5.1)")
    for side in blinded:
        print(f"[bench] {side['label']}: {json.dumps(side['mechanical_counts'])}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("freeze")
    e = sub.add_parser("emit-tasks")
    e.add_argument("--outdir", default=os.path.join(BENCH_DIR, "tasks"))
    g = sub.add_parser("run-gemma")
    g.add_argument("--trials", type=int, default=3)
    g.add_argument("--out", default=os.path.join(BENCH_DIR, "answers_gemma.json"))
    i = sub.add_parser("ingest-opus")
    i.add_argument("src")
    i.add_argument("--out", default=os.path.join(BENCH_DIR, "answers_opus.json"))
    i.add_argument("--receipt", default=None)
    v = sub.add_parser("verify")
    v.add_argument("sources", nargs="+")
    v.add_argument("--out", default=os.path.join(BENCH_DIR, "blinded_results.json"))
    v.add_argument("--identity-out",
                   default=os.path.join(BENCH_DIR, "candidate_identity_map.json"))
    args = ap.parse_args()

    if args.cmd == "freeze":
        return cmd_freeze()
    if args.cmd == "emit-tasks":
        return cmd_emit_tasks(args.outdir)
    if args.cmd == "run-gemma":
        return cmd_run_gemma(args.trials, args.out)
    if args.cmd == "ingest-opus":
        return cmd_ingest_opus(args.src, args.out, args.receipt)
    if args.cmd == "verify":
        return cmd_verify(args.sources, args.out, args.identity_out)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
