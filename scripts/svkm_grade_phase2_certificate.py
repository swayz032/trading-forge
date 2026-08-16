"""sVkm GRADE — CERTIFICATE driver (conductor-authored; consumes the FROZEN instrument).

Authority: AR-1138 §4/§6 — run the real `pilot_conveyor.finalize_certificate` on the
Phase-1 prep produced from the exact pinned sVkm extraction, and persist whatever it
returns, honestly.

🛑 NO SYNTHETIC VERDICTS. `tier3_verdicts` is passed EMPTY because no blind rater has
adjudicated the fall-through items. An empty list is the ABSENCE of a verdict, not a
manufactured one. `dry_run=False` because this is a real run — AR-1138 forbids a
dry-run certificate satisfying the gate, and this driver never sets it.

Expected terminal state given Phase 1 (5 unanchored conditions): the instrument's own
clause-4 post-processing forces pilot_grade/full_grade/certificate_grade to False. That
is a MEASURED REFUSAL and it is the honest artifact.

Run from repo root:
  python scripts/svkm_grade_phase2_certificate.py
"""
from __future__ import annotations

import json
import os
import pickle
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, ROOT)

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from src.engine.extraction import pilot_conveyor as pc  # noqa: E402

POP_DIR = os.path.join(ROOT, "docs", "replay-results", "svkm-extraction-certified")
GRADE_DIR = os.path.join(POP_DIR, "grade")
PREPS = os.path.join(GRADE_DIR, "phase1_preps.pkl")


def main() -> int:
    # TRUSTED INPUT: this pickle is written by scripts/svkm_grade_phase1.py in this same
    # repo one step earlier (never fetched, never user-supplied). It carries live
    # dataclass instances the instrument returned, which is exactly why the frozen
    # h1_pilot_phase1.py -> h1_pilot_phase3_finalize.py handoff uses pickle too.
    with open(PREPS, "rb") as fh:
        blob = pickle.load(fh)
    preps = blob["preps"]
    print(f"[svkm-cert] preps={len(preps)}", flush=True)

    out = []
    for prep in preps:
        # REAL call. No synthetic tier-3 verdicts, no synthetic support, no dry_run.
        cert = pc.finalize_certificate(prep, [], tier3_support=None)
        diag = pc.diagnose_certificate(cert, prep.get("unanchored_conditions", []), [])
        out.append({"certificate": cert, "diagnosis": diag})
        print(f"[svkm-cert] strategy_index={prep['strategy_index']}", flush=True)
        print(f"[svkm-cert]   pilot_grade      = {cert.get('pilot_grade')}", flush=True)
        print(f"[svkm-cert]   full_grade       = {cert.get('full_grade')}", flush=True)
        print(f"[svkm-cert]   certificate_grade= {cert.get('certificate_grade')}", flush=True)
        print(f"[svkm-cert]   dry_run          = {cert.get('dry_run')}", flush=True)
        print(f"[svkm-cert]   unanchored_count = {cert.get('unanchored_condition_count')}", flush=True)
        print(f"[svkm-cert]   conditions       = {len(cert.get('conditions') or [])}", flush=True)
        print(f"[svkm-cert]   diagnosis        = {json.dumps(diag, default=str)}", flush=True)

    artifact = {
        "artifact": "svkm-grade-certificate",
        "provenance_class": "GRADE_RUN_REAL — NOT CERTIFIED",
        "tier3_verdicts_supplied": 0,
        "tier3_support_supplied": 0,
        "dry_run": False,
        "note": ("tier-3 fall-through items were NOT adjudicated: that requires a real blind "
                 "rater (stage-1 role + stage-2 support). No verdict was manufactured."),
        "results": out,
    }
    path = os.path.join(GRADE_DIR, "certificate.json")
    tmp = path + f".{os.getpid()}.tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(artifact, fh, indent=2, default=str)
    os.replace(tmp, path)
    print(f"[svkm-cert] wrote {path}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
