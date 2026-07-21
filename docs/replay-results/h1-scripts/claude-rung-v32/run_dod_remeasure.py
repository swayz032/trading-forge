"""WIRE-1 DoD RE-MEASURE — the packet's success metric (§5 pin 4d, R-074 §2/§5).

"Re-measure the binding-approximation distribution over the 16 compilable specs,
per-family before/after. THE 0.99 MUST MOVE, measurably."

Two numbers are reported per spec, deliberately:
  * STRUCTURAL after-rate — a wired binding counts non-approximate outright. This is
    the ceiling: what the wire achieves where its column is available.
  * ENGAGEMENT-WEIGHTED after-rate — each wired binding is credited only by the
    fraction of bars its column actually engaged. This is the HONEST number, because a
    column that is dormant on half the window did not de-approximate those bars.
Reporting only the structural number would overstate the win; reporting only the
weighted one would hide the ceiling. Both, always.

PER-COLUMN engaged fractions (R-074 §2, amended law): structure and bias engage very
differently on the SAME spec (99.99% vs 49% — structure needs only the 4h frame, bias
needs the 200-daily-bar warmup). A per-spec average would blend two instruments into
one lie, so engagement is carried PER COLUMN and the per-spec figure is derived.

Scope carried per R-071 §3: CARRY (no pre-window seeding — infeasible for this window,
51 prior daily bars vs 200 needed), so warmup consumes the front of the window and the
bias column's engaged fraction reflects that. Labeled, never silent.
"""
from __future__ import annotations

import contextlib
import glob
import io
import json
import os
import re
import sys
import time

WT = r"C:/Users/tonio/Projects/wt-h1-wave4-20260712"
SPECS = os.path.join(WT, "docs", "replay-results", "h1-scripts", "claude-rung-v32", "shakedown_specs")
OUT = os.path.join(WT, "docs", "replay-results", "h1-battery", "wire1-dod-remeasure.json")

# The families this packet WIRES (WIRE-1 structure + the bias spike).
WIRED_STRUCTURE = {"WAIT_STRUCTURE", "VERIFY_STRUCTURE"}
WIRED_BIAS = {"WAIT_BIAS", "CONFIRM_DIRECTION"}

START, END = "2022-01-01", "2023-06-30"

sys.path.insert(0, WT)
from src.engine.backtester import run_class_backtest  # noqa: E402
from src.engine.spec_condition_compiler import from_compiled_spec  # noqa: E402
from src.engine.spec_family_bindings import compile_binding_plan  # noqa: E402

_ENG = re.compile(r"WIRE-1: (?:HTF columns attached|structure column) — (\d+)/(\d+)")


def _engaged(stderr_text: str):
    """(bias_engaged, structure_engaged, total) from the runner's own evidence lines."""
    bias = struct = total = 0
    for line in stderr_text.splitlines():
        m = _ENG.search(line)
        if not m:
            continue
        n, tot = int(m.group(1)), int(m.group(2))
        total = max(total, tot)
        if "structure column" in line:
            struct = n
        else:
            bias = n
    return bias, struct, total


def main() -> int:
    files = sorted(glob.glob(os.path.join(SPECS, "*.spec.json")))
    rows = []
    for i, path in enumerate(files, 1):
        stub = os.path.basename(path)[: -len(".spec.json")]
        art = json.load(open(path, encoding="utf-8"))
        bp = compile_binding_plan(art["spec"])

        # BEFORE — exactly the artifact's own definition: executed & bindable bindings,
        # counting those flagged approximation=True.
        executed = [b for b in bp.bindings if getattr(b, "executed", False)]
        approx = [b for b in executed if getattr(b, "approximation", False)]
        n_exec, n_approx = len(executed), len(approx)
        before = round(n_approx / n_exec, 4) if n_exec else None

        n_struct = sum(1 for b in approx if b.type in WIRED_STRUCTURE)
        n_bias = sum(1 for b in approx if b.type in WIRED_BIAS)

        os.environ["TF_WIRE1_HTF_COLUMNS"] = "1"
        t0 = time.time()
        buf = io.StringIO()
        try:
            with contextlib.redirect_stderr(buf):
                strat = from_compiled_spec(art, symbol="MES", timeframe="5m", strategy_name=stub)
                res = run_class_backtest(strategy=strat, start_date=START, end_date=END)
            err = ""
        except Exception as e:  # noqa: BLE001 — a failed spec is recorded, never dropped
            res, err = {}, repr(e)[:160]
        bias_eng, struct_eng, total = _engaged(buf.getvalue())
        f_bias = round(bias_eng / total, 4) if total else 0.0
        f_struct = round(struct_eng / total, 4) if total else 0.0

        # AFTER — structural (ceiling) and engagement-weighted (honest).
        after_struct = round((n_approx - n_struct - n_bias) / n_exec, 4) if n_exec else None
        credited = n_struct * f_struct + n_bias * f_bias
        after_weighted = round((n_approx - credited) / n_exec, 4) if n_exec else None

        rows.append({
            "spec": stub,
            "n_executed_bindable": n_exec,
            "n_binding_approximation_before": n_approx,
            "binding_approximation_rate_BEFORE": before,
            "wired_structure_bindings": n_struct,
            "wired_bias_bindings": n_bias,
            "engaged_fraction_PER_COLUMN": {"structure": f_struct, "bias": f_bias},
            "binding_approximation_rate_AFTER_structural": after_struct,
            "binding_approximation_rate_AFTER_engagement_weighted": after_weighted,
            "trades": res.get("total_trades"),
            "profit_factor": res.get("profit_factor"),
            "secs": round(time.time() - t0, 1),
            "error": err or None,
        })
        print(f"[{i}/{len(files)}] {stub} before={before} after_struct={after_struct} "
              f"after_wt={after_weighted} struct_eng={f_struct} bias_eng={f_bias}", flush=True)

    ok = [r for r in rows if r["binding_approximation_rate_BEFORE"] is not None and not r["error"]]
    def _mean(k):
        vals = [r[k] for r in ok if r[k] is not None]
        return round(sum(vals) / len(vals), 4) if vals else None

    verdict = {
        "artifact": "wire1-dod-remeasure",
        "window": f"{START}..{END}",
        "symbol": "MES",
        "n_specs": len(files),
        "n_measured": len(ok),
        "corpus_binding_approximation_rate_BEFORE": _mean("binding_approximation_rate_BEFORE"),
        "corpus_AFTER_structural": _mean("binding_approximation_rate_AFTER_structural"),
        "corpus_AFTER_engagement_weighted": _mean("binding_approximation_rate_AFTER_engagement_weighted"),
        "corpus_engaged_fraction_PER_COLUMN": {
            "structure": round(sum(r["engaged_fraction_PER_COLUMN"]["structure"] for r in ok) / len(ok), 4) if ok else None,
            "bias": round(sum(r["engaged_fraction_PER_COLUMN"]["bias"] for r in ok) / len(ok), 4) if ok else None,
        },
        "scope_line": (
            "MES 5m, 2022-01-01..2023-06-30, one window, wire flag ON. CARRY decision "
            "(R-071 §3): no pre-window warmup seeding — infeasible for this window (51 "
            "prior daily bars vs 200 needed) — so the bias column's engaged fraction is "
            "depressed by warmup consuming the window front. Engagement is reported PER "
            "COLUMN (R-074 §2). Product is RECEIPTS, not returns: these are tier-b "
            "near-ghost specs and no edge claim attaches to any profit_factor here."
        ),
        "rows": rows,
    }
    json.dump(verdict, open(OUT, "w", encoding="utf-8", newline="\n"), indent=1, default=str)
    print("\n=== DoD ===")
    print(json.dumps({k: v for k, v in verdict.items() if k != "rows"}, indent=1)[:1200])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
