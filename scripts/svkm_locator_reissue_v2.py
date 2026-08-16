"""sVkm LOCATOR RE-ISSUE v2 — AR-1226 §6 LANE L1 items 1 / 2 / 6.

WHAT THIS IS
    A NEW, VERSIONED locator pass over the golden slice. §6.1 verbatim: "Do not mutate frozen
    AR-1199/Phase-1 history. Produce a new versioned locator/grade artifact." So this driver
    writes only `locator_reissue_v2.json` and REFUSES to write `phase1.json` — the refusal is
    an assertion, not a convention (see `_assert_not_frozen_output`).

WHAT IT IS NOT
    It is NOT wired into the real Phase-1 gate or the certificate route. AR-1226 §7 keeps both
    unwired until L1 produces trustworthy bindings AND L2's approved-quote handoff is safe.
    Nothing here consumes or produces a certificate.

THE THREE ITEMS
  §6.1 RE-RUN     — re-locate every spine condition from the REAL condition text against the
                    PINNED transcript, through the production seams
                    (`pilot_conveyor.extract_spine_condition_texts` +
                    `.locate_condition_anchors` + `h1_pilot_phase1.robust_propose`). No
                    re-authored locator; a second implementation would be a second thing to
                    drift.
  §6.2 FENCE KEPT — the literal-substring fence is untouched. `locate_anchor` still resolves
                    every proposal through `compile_lints.f2_coverage_gate`, and an accepted
                    quote is still the literal transcript slice. This driver adds a check
                    AFTER location; it removes nothing.
  §6.6 PROVENANCE — every located quote is recorded with its exact char span, the literal
                    slice, the sha256 of that slice, and the full pin set. A quote that
                    cannot be re-derived from the artifact is not evidence.

THE SET-LEVEL GATE
    Locations are adjudicated by `span_collision.adjudicate_locations` BEFORE acceptance
    (§6.3). Cross-role reuse is HELD_FOR_ADJUDICATION; same-role reuse is kept and flagged
    (§6.4); a clean set passes untouched.

    🛑 NOTHING IS AUTO-REFUSED. AR-1228 §9.5: "manually/adjudicatively inspect any HIGH
    collision — do not auto-refuse solely on HIGH." A HOLD removes a condition from the
    auto-accept path and hands it to an adjudicator; it is not a verdict on the quote, and
    this driver never decides which condition rightfully owns a contested span.

NON-DETERMINISM, STATED
    The propose step is a local gemma call and is NOT deterministic. Two runs may differ. This
    driver therefore does exactly ONE locate pass per condition (the same discipline
    `locate_condition_anchors` documents) and stamps `run_label` into the artifact. To observe
    stability, run it again with a different `--out`; never overwrite an authoritative run.

Run from repo root:
  python scripts/svkm_locator_reissue_v2.py --transcript <pinned-transcript.txt> [--out PATH] [--run-label L]
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

from src.engine.extraction import anchor_locator as al  # noqa: E402
from src.engine.extraction import pilot_conveyor as pc  # noqa: E402
from src.engine.extraction import span_collision as sc  # noqa: E402

import h1_pilot_phase1 as p1  # noqa: E402  (the production propose seam, by import)

VIDEO_ID = "sVkmZklJDHI"
TRANSCRIPT_PIN = "df72444f70e8c79db0e1692867913f14d37c18fd063f681a2b562fe103ce99cc"
EXTRACTION_PIN = "c37ff26f753449c35b6ec0402a3152dc287a8ae427eb0d86661b3fb43ec01823"

POP_DIR = os.path.join(ROOT, "docs", "replay-results", "svkm-extraction-certified")
EXTRACTION_PATH = os.path.join(POP_DIR, f"{VIDEO_ID}.json")
GRADE_DIR = os.path.join(POP_DIR, "grade")
DEFAULT_OUT = os.path.join(GRADE_DIR, "locator_reissue_v2_run2.json")

# §6.1: frozen history this driver may never write.
FROZEN_OUTPUTS = ("phase1.json", "phase1_preps.pkl", "phase2_certificate.json", "certificate.json")


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _assert_not_frozen_output(out_path: str) -> None:
    """§6.1 enforced, not merely intended. A `--out` aimed at frozen Phase-1 history aborts
    before any locator work is spent."""
    base = os.path.basename(out_path)
    if base in FROZEN_OUTPUTS:
        raise SystemExit(
            f"[reissue] ABORT: {base} is frozen AR-1199/Phase-1 history — AR-1226 §6.1 forbids "
            "mutating it. Write a new versioned artifact instead."
        )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--transcript", required=True, help="path to the pinned transcript bytes (utf-8)")
    ap.add_argument("--out", default=DEFAULT_OUT, help="versioned output artifact path")
    ap.add_argument("--run-label", default="authoritative", help="label stamped into the artifact")
    args = ap.parse_args()

    _assert_not_frozen_output(args.out)
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)

    # ---- REFUSAL GATE 1: transcript identity (unchanged from the phase-1 driver) ----------
    transcript = open(args.transcript, encoding="utf-8", newline="").read()
    tsha = _sha256(transcript)
    print(f"[reissue] transcript chars={len(transcript)} sha256={tsha}", flush=True)
    if tsha != TRANSCRIPT_PIN:
        print("[reissue] ABORT: transcript bytes differ from the pin — REFUSING.")
        return 2

    # ---- REFUSAL GATE 2: extraction identity ---------------------------------------------
    record = json.loads(open(EXTRACTION_PATH, encoding="utf-8").read())
    esha = record.get("extraction_sha256")
    print(f"[reissue] extraction_sha256={esha}", flush=True)
    if esha != EXTRACTION_PIN:
        print("[reissue] ABORT: extraction record differs from the pin — REFUSING.")
        return 2

    extraction = record["extraction"]
    strategies = extraction.get("strategies") or []
    extractor_version = pc.extractor_version_pin(ROOT)
    print(f"[reissue] strategies={len(strategies)} extractor_version={extractor_version}", flush=True)

    strategy_views = []
    for si, strategy in enumerate(strategies):
        conditions = pc.extract_spine_condition_texts(strategy, si)
        print(f"[reissue] strategy {si}: {len(conditions)} spine conditions — "
              f"running REAL anchor-locator (gemma), one call each …", flush=True)

        # §6.1/§6.2 — the production locate path, literal fence intact.
        anchored, unanchored = pc.locate_condition_anchors(
            conditions, transcript, propose_fn=p1.robust_propose,
        )

        # §6.6 — provenance per located quote, before any adjudication touches it.
        located: dict[str, dict] = {}
        for cond, result in anchored:
            start, end = result.char_span
            literal = transcript[start:end]
            # The fence's own guarantee, re-asserted here so a drifted locator cannot pass
            # a quote that is not the transcript slice it claims to be.
            assert literal == result.quote, (
                f"{cond.condition_ref}: located quote is not the literal transcript slice"
            )
            located[cond.condition_ref] = {
                "condition_ref": cond.condition_ref,
                "condition_text": cond.text,
                "char_span": [start, end],
                "quote": literal,
                "quote_sha256": _sha256(literal),
                "quote_char_count": end - start,
            }

        # §6.3 — the set-level gate, BEFORE acceptance.
        verdicts, collisions = sc.adjudicate_locations(
            {ref: tuple(v["char_span"]) for ref, v in located.items()}
        )
        for ref, v in located.items():
            v["acceptance"] = verdicts[ref]

        held = [r for r, v in verdicts.items() if v["status"] == sc.STATUS_HELD_FOR_ADJUDICATION]
        accepted = [r for r in verdicts if r not in set(held)]

        strategy_views.append({
            "strategy_index": si,
            "spine_condition_count": len(conditions),
            "located_count": len(located),
            "unlocated_count": len(unanchored),
            "locations": [located[c.condition_ref] for c, _ in anchored],
            "unlocated": [
                {"condition_ref": u.condition_ref, "condition_text": u.text, "reason": u.reason}
                for u in unanchored
            ],
            "collisions": [
                {
                    "span": list(c.span),
                    "condition_refs": list(c.condition_refs),
                    "roles": list(c.roles),
                    "severity": c.severity,
                    "detail": c.detail,
                }
                for c in collisions
            ],
            "collision_summary": sc.summarise(collisions),
            "accepted_condition_refs": sorted(accepted),
            "held_for_adjudication_condition_refs": sorted(held),
        })
        print(f"[reissue] strategy {si}: located={len(located)} unlocated={len(unanchored)} "
              f"collisions={sc.summarise(collisions)} accepted={len(accepted)} held={len(held)}",
              flush=True)

    rollup = {
        "spine_conditions": sum(v["spine_condition_count"] for v in strategy_views),
        "located": sum(v["located_count"] for v in strategy_views),
        "unlocated": sum(v["unlocated_count"] for v in strategy_views),
        "accepted": sum(len(v["accepted_condition_refs"]) for v in strategy_views),
        "held_for_adjudication": sum(len(v["held_for_adjudication_condition_refs"]) for v in strategy_views),
        "collisions_high": sum(v["collision_summary"]["high"] for v in strategy_views),
        "collisions_review": sum(v["collision_summary"]["review"] for v in strategy_views),
        "propose_abstain_by_parse_failure": p1.PROPOSE_ABSTAIN_BY_PARSE_FAILURE[0],
    }

    artifact = {
        "artifact": "svkm-locator-reissue-v2",
        "authority": "AR-1226 §6 LANE L1 items 1/2/6 (+ item 3 gate applied at acceptance)",
        "run_label": args.run_label,
        "stage": "LOCATOR RE-ISSUE ONLY — not a certificate, not wired into the Phase-1 or "
                 "certificate route (AR-1226 §7)",
        "does_not_supersede": "docs/replay-results/svkm-extraction-certified/grade/phase1.json "
                              "(frozen AR-1199/Phase-1 history, unmodified)",
        "non_determinism": "the propose step is a local gemma call and is not deterministic; "
                           "this artifact records ONE locate pass per condition",
        "provenance": {
            "video_id": VIDEO_ID,
            "transcript_sha256": tsha,
            "transcript_char_count": len(transcript),
            "extraction_sha256": esha,
            "extractor_version": extractor_version,
            "taxonomy_version": p1.TAXONOMY_VERSION,
            "locator_model": al._GEMMA_MODEL,
            "locator_module": "src/engine/extraction/anchor_locator.py",
            "literal_fence": "compile_lints.f2_coverage_gate via anchor_locator._resolves_as_anchor "
                             "— unchanged (AR-1226 §6.2)",
        },
        "strategies": strategy_views,
        "rollup": rollup,
    }

    tmp = args.out + f".{os.getpid()}.tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(artifact, fh, indent=2, default=str)
    os.replace(tmp, args.out)

    print(f"[reissue] wrote {args.out}", flush=True)
    print(f"[reissue] ROLLUP: {json.dumps(rollup)}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
