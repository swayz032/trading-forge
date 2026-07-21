"""PACKET 2 (R-040 §3) -- 22-strategy inventory disposition + approximation
distribution. Runs the spec producer over every design-pool staging_v32 strategy,
assigns each a battery-compatibility disposition, and reports the full
approximation distribution -- the honest effective denominator BEFORE any battery
number exists.

Run:  python docs/replay-results/h1-scripts/claude-rung-v32/run_packet2_inventory.py
Exit non-zero only on an unexpected producer error (never on a disposition).
"""

from __future__ import annotations

import glob
import json
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.abspath(os.path.join(_HERE, "..", "..", "..", ".."))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from src.engine.extraction.spec_producer import dispose_inventory, produce_spec_artifact  # noqa: E402

_STAGING = os.path.join(_ROOT, "docs", "replay-results", "h1-scripts", "claude-rung-designpool", "staging_v32")
_OUT = os.path.join(_HERE, "packet2-inventory-22.json")


def main() -> int:
    rows = []
    for path in sorted(glob.glob(os.path.join(_STAGING, "*.json"))):
        doc = json.load(open(path, encoding="utf-8"))
        stub = os.path.splitext(os.path.basename(path))[0]
        ic = doc.get("instrument_classification")
        for strat in doc.get("strategies", []):
            art = produce_spec_artifact(strat, video=stub, certificate=None, transcript_chars=0)
            disp = dispose_inventory(strat, ic, art["spec"])
            m = disp["approximation_metrics"]
            rows.append({
                "video": stub,
                "strategy_name": strat.get("name"),
                "disposition": disp["disposition"],
                "asset_class": disp["asset_class"],
                "n_conditions": m["n_conditions"],
                "classifier_approximation_rate": m["classifier_approximation_rate"],
                "binding_approximation_rate": m["binding_approximation_rate"],
                "spec_hash": art["spec_hash"],
                "house_default_exit": "framework_overlay" in art["spec"],
            })

    disp_hist: dict = {}
    for r in rows:
        disp_hist[r["disposition"]] = disp_hist.get(r["disposition"], 0) + 1
    compilable = [r for r in rows if r["disposition"] == "compilable-futures"]
    approx_rates = sorted(r["binding_approximation_rate"] for r in compilable)

    summary = {
        "artifact": "h1-packet2-inventory-22",
        "packet": "h1-packet2-runnable-spec-compiler-ratify-2026-07-18 (R-040)",
        "n_strategies": len(rows),
        "disposition_histogram": disp_hist,
        "effective_battery_denominator": len(compilable),
        "compilable_binding_approximation": {
            "min": approx_rates[0] if approx_rates else None,
            "max": approx_rates[-1] if approx_rates else None,
            "mean": round(sum(approx_rates) / len(approx_rates), 4) if approx_rates else None,
            "distribution": approx_rates,
        },
        "note": (
            "binding_approximation_rate is the OPTIMISTIC-looser-than-taught bias (R-040 pin 2iii): "
            "approximated conditions degrade to np.ones pass-through. High-approximation specs cannot "
            "ground a survivor claim alone; every battery verdict carries the rate in its scope line."
        ),
    }
    out = {"summary": summary, "strategies": rows}
    json.dump(out, open(_OUT, "w", encoding="utf-8", newline="\n"), indent=2)
    print(json.dumps(summary, indent=2))
    print(f"\nper-strategy table -> {_OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
