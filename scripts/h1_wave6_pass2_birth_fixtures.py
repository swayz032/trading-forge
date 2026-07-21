"""H1 Wave-6 Pass-2 — Guard 3(a) LIVE birth-fixture runner (2026-07-13).

Per docs/designs/h1-wave6-pass2-two-phase-PACKET-2026-07-13.md §4 Guard 3(a):
runs the two-phase conveyor (`extractor_bridge.run_two_phase_extraction`)
for real, ONLY on the three already-adjudicated videos named in the packet
(`4cT8WTyxhYY`, `IyFioFkRgWo`, `WEhmadJArQo`) — the founding fixture set for
Phase A, a brand-new instrument (engagement-birthright Law 1: fires-
correctly-before-it-counts). Deliberately does NOT run the remaining 13
design-pool videos — that full design-pool measurement is
`scripts/h1_wave6_pass2_design_pool.py`, run separately.

Writes to docs/replay-results/h1-scripts/wave6-pass2-birth-fixtures/extraction-vault/
— a THIRD vault dir, distinct from both the pass-1 design-pool vault and the
pass-2 full design-pool vault, so this small founding-fixture run and the
full design-pool run never collide or double-count.

Resumable (skip vault-cached videos), same discipline as the design-pool
script.

Run from repo root: python scripts/h1_wave6_pass2_birth_fixtures.py
"""
from __future__ import annotations

import json
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, ROOT)

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from src.engine.extraction import extractor_bridge as eb  # noqa: E402

PILOT_TRANSCRIPT_DIR = os.path.join(ROOT, "docs", "replay-results", "h1-scripts", "pilot-run", "transcripts")
OUT_DIR = os.path.join(ROOT, "docs", "replay-results", "h1-scripts", "wave6-pass2-birth-fixtures")
VAULT_DIR = os.path.join(OUT_DIR, "extraction-vault")

# Packet §4 Guard 3(a) — the founding fixture set. Ground truth per the §9b
# fresh-context blind adjudication (pre-registration §9-10).
BIRTH_FIXTURE_VIDEOS = ["4cT8WTyxhYY", "IyFioFkRgWo", "WEhmadJArQo"]

for d in (OUT_DIR, VAULT_DIR):
    os.makedirs(d, exist_ok=True)


def run() -> None:
    results = {}
    failures = []
    for vid in BIRTH_FIXTURE_VIDEOS:
        print(f"\n[birth-fixtures] {vid}", flush=True)
        vault_path = os.path.join(VAULT_DIR, f"{vid}.json")
        if os.path.exists(vault_path):
            print(f"[birth-fixtures]   RESUME: vault present, skip re-extraction", flush=True)
            with open(vault_path, encoding="utf-8") as fh:
                two_phase_result = json.load(fh)["extraction"]
            results[vid] = two_phase_result
            continue

        transcript_path = os.path.join(PILOT_TRANSCRIPT_DIR, f"{vid}.json")
        if not os.path.exists(transcript_path):
            failures.append((vid, f"cached transcript not found: {transcript_path}"))
            print(f"[birth-fixtures]   MISSING cached transcript", flush=True)
            continue
        with open(transcript_path, encoding="utf-8") as fh:
            tr = json.load(fh)
        transcript = tr["transcript"]

        try:
            two_phase_result = eb.run_two_phase_extraction(transcript, f"{vid}-wave6-pass2-birth")
        except (eb.RealExtractorError, eb.EnumeratorError) as exc:
            failures.append((vid, str(exc)[:500]))
            print(f"[birth-fixtures]   FAILED (recorded, continuing): {str(exc)[:300]}", flush=True)
            continue

        eb.save_extraction(
            VAULT_DIR, vid, two_phase_result,
            {"seed": 42, "temperature": 0.1, "model": "gemma4:e4b-it-qat", "pass": "wave6-pass2-birth-fixture"},
        )
        results[vid] = two_phase_result

        phase_a_count = len((two_phase_result.get("phase_a_enumeration") or {}).get("strategies") or [])
        print(f"[birth-fixtures]   phase_a_enumerated_count={phase_a_count} "
              f"phase_b_strategies={len(two_phase_result.get('strategies') or [])}", flush=True)

    summary = {
        "artifact": "h1-wave6-pass2-birth-fixtures-summary",
        "videos": BIRTH_FIXTURE_VIDEOS,
        "n_completed": len(results),
        "n_failures": len(failures),
        "failures": failures,
        "per_video_phase_a_count": {
            vid: len((r.get("phase_a_enumeration") or {}).get("strategies") or [])
            for vid, r in results.items()
        },
    }
    with open(os.path.join(OUT_DIR, "birth_fixtures_summary.json"), "w", encoding="utf-8", newline="\n") as fh:
        json.dump(summary, fh, indent=2, default=str)

    print("\n" + "=" * 70)
    print(json.dumps(summary["per_video_phase_a_count"], indent=2))
    print(f"[birth-fixtures] summary written: {os.path.join(OUT_DIR, 'birth_fixtures_summary.json')}")
    print("=" * 70)


if __name__ == "__main__":
    run()
