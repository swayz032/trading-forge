#!/usr/bin/env python3
"""
OVERLAY DELTA CORPUS SWEEP (2026-07-02) — the value-added research program's first instrument (GPT spec).

For every playbook-REGISTERED engine strategy (the population where the 7-layer eligibility overlay genuinely
engages — unregistered strategies hit the documented bypass and would produce void A/B comparisons), run the
Mode A vs Mode B ablation and compute the per-strategy overlay delta vector:

    Δ_overlay = (ΔExpectancy(avg_r), ΔDrawdown, ΔSharpe, ΔTradeRetention, ΔProfitFactor)

then aggregate across the corpus (mean / median / KEEP-LOOSEN counts) to answer the population question:

    "Does the Trading Forge overlay add value ON AVERAGE, not just for one strategy?"

Honest scope: single-backtest core (the ablation harness); full WF/CPCV/PBO/DSR under both modes is the
follow-through. Strategies with tiny trade counts are flagged LOW_N (n_source < MIN_N) and excluded from the
aggregate means (retention floor already guards over-interpretation per-strategy).

Usage (tower, with AWS creds + TF_ALLOW_FIXED_1=true + DATA_CACHE_TTL_SECONDS in env):
  PYTHONPATH=. python scripts/overlay-delta-corpus.py --start 2023-01-01 --end 2025-12-01
"""
from __future__ import annotations

import argparse
import importlib
import json
import os
import statistics
import subprocess
import sys

MIN_N = 20  # below this source-mode trade count, deltas are LOW_N and excluded from aggregate means

# Playbook roster (playbook_router.ALL_STRATS) — only these feel the overlay (no bypass).
ROSTER = [
    "ote", "ict_swing", "propulsion", "power_of_3", "quarterly_swing", "silver_bullet",
    "breaker", "eqhl_raid", "london_raid", "judas_swing", "mitigation",
    "ny_lunch_reversal", "midnight_open", "iofed", "ict_scalp",
]


def discover_class(name: str) -> str | None:
    """Find the Strategy class path for a roster name (module must exist + expose one *Strategy class)."""
    mod_path = f"src.engine.strategies.{name}"
    try:
        mod = importlib.import_module(mod_path)
    except Exception:
        return None
    for attr in dir(mod):
        if attr.endswith("Strategy") and attr != "Strategy":
            return f"{mod_path}.{attr}"
    return None


def run_ablation(class_path: str, start: str, end: str) -> dict:
    """Run the two-mode ablation in a subprocess (isolates engine state per strategy) and parse --json."""
    cmd = [sys.executable, "scripts/confluence-overlay-ablation.py",
           "--strategy-class", class_path, "--start", start, "--end", end, "--json"]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=3600, env=os.environ.copy())
    out = r.stdout
    brace = out.find("{")
    if brace < 0:
        return {"error": (r.stderr or out)[-400:]}
    try:
        return json.loads(out[brace:])
    except json.JSONDecodeError:
        return {"error": out[-400:]}


def delta_vector(a: dict, b: dict) -> dict:
    """Δ_overlay per GPT: Mode B minus Mode A (positive Δsharpe/Δexpectancy/Δpf good; Δdd negative good)."""
    g = lambda d, k: d.get(k) or 0.0
    n_a = a.get("trade_count") or 0
    return {
        "d_expectancy_avg_r": round(g(b, "avg_r") - g(a, "avg_r"), 4),
        "d_sharpe": round(g(b, "sharpe") - g(a, "sharpe"), 4),
        "d_profit_factor": round(g(b, "profit_factor") - g(a, "profit_factor"), 4),
        "d_max_dd": round(g(b, "max_dd") - g(a, "max_dd"), 2),           # negative = overlay reduced DD
        "trade_retention_pct": round(100 * (b.get("trade_count") or 0) / n_a, 1) if n_a else None,
        "n_source": n_a, "n_overlay": b.get("trade_count") or 0,
        "low_n": n_a < MIN_N,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", default="2023-01-01")
    ap.add_argument("--end", default="2025-12-01")
    ap.add_argument("--out", default="docs/designs/overlay-delta-corpus-2026-07-02.json")
    args = ap.parse_args()

    rows = []
    for name in ROSTER:
        cls = discover_class(name)
        if not cls:
            rows.append({"strategy": name, "status": "NO_CLASS"})
            print(f"[{name}] NO_CLASS (roster entry without an engine class file)", flush=True)
            continue
        print(f"[{name}] running A/B ablation ({cls}) ...", flush=True)
        rep = run_ablation(cls, args.start, args.end)
        if rep.get("error") or rep.get("source_entry_only", {}).get("error") or rep.get("tf_institutional_overlay", {}).get("error"):
            err = rep.get("error") or rep["source_entry_only"].get("error") or rep["tf_institutional_overlay"].get("error")
            rows.append({"strategy": name, "status": "ERROR", "error": str(err)[:300]})
            print(f"[{name}] ERROR: {str(err)[:160]}", flush=True)
            continue
        a, b, v = rep["source_entry_only"], rep["tf_institutional_overlay"], rep["verdict"]
        d = delta_vector(a, b)
        rows.append({"strategy": name, "status": "OK", "verdict": v["verdict"], "reason": v["reason"][:160],
                     "mode_a": a, "mode_b": b, "delta": d})
        print(f"[{name}] {v['verdict']} | nA={d['n_source']} nB={d['n_overlay']} dSharpe={d['d_sharpe']} dDD={d['d_max_dd']}{' LOW_N' if d['low_n'] else ''}", flush=True)

    ok = [r for r in rows if r.get("status") == "OK"]
    usable = [r for r in ok if not r["delta"]["low_n"]]
    agg_src = usable if usable else ok
    def agg(key):
        vals = [r["delta"][key] for r in agg_src if r["delta"].get(key) is not None]
        return {"mean": round(statistics.mean(vals), 4), "median": round(statistics.median(vals), 4), "n": len(vals)} if vals else None
    summary = {
        "window": f"{args.start}..{args.end}",
        "strategies_attempted": len(ROSTER), "ok": len(ok),
        "usable_for_aggregate (n_source>=%d)" % MIN_N: len(usable),
        "verdicts": {v: sum(1 for r in ok if r["verdict"] == v) for v in {"KEEP", "LOOSEN"}},
        "aggregate_deltas" + ("" if usable else " (ALL LOW_N — advisory only)"): {
            k: agg(k) for k in ("d_expectancy_avg_r", "d_sharpe", "d_profit_factor", "d_max_dd", "trade_retention_pct")},
        "note": "single-backtest core; full WF/CPCV/PBO/DSR under both modes is the follow-through; LOW_N strategies excluded from means",
    }
    report = {"summary": summary, "strategies": rows}
    json.dump(report, open(args.out, "w", encoding="utf-8"), indent=1)
    print("\n=== CORPUS SUMMARY ===")
    print(json.dumps(summary, indent=1))
    print(f"\nfull report: {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
