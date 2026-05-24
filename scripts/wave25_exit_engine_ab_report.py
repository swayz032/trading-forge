"""Wave 25 Pass 7 W25.17 — A/B report for adaptive vs static_styleC exits.

Runs each of the 3 graduated CANDIDATE strategies (silver_bullet, power_of_3, ict_scalp)
on the last N days of historical data with BOTH exit modes, side-by-side.

Outputs a Markdown report at docs/wave25-exit-engine-ab-report.md with:
  - Per-strategy P&L delta (adaptive vs static)
  - Sharpe ratio delta
  - Max drawdown delta
  - Avg-R per trade delta
  - Win rate (observed output — never a design target per CLAUDE.md §13)
  - Trade count (should be ~unchanged; exits don't gate entries)
  - PASS/FAIL non-regression gate: adaptive >= static_styleC on (Sharpe AND max_DD)

Non-regression gate:
  - adaptive Sharpe >= static Sharpe  (tolerance: -0.05)
  - adaptive max_DD <= static max_DD  (tolerance: +10%)
  - adaptive trade count within 20% of static (exits must not gate entries)
  - FAIL on any of these 3 emits audit event + optional Discord alert

Usage:
    python -m scripts.wave25_exit_engine_ab_report --days 30 --strategies all
    python -m scripts.wave25_exit_engine_ab_report --days 7 --strategies silver_bullet
    python -m scripts.wave25_exit_engine_ab_report --days 30 --strategies silver_bullet,power_of_3

Design note — adaptive path status (W25.17):
  P7.A1+A2 (adaptive-exit-engine.ts) is being built in parallel by the paper-parity agent.
  Until the TS adaptive engine is wired into the Python compile pipeline (P7.A5), the
  "adaptive" exit mode in run_class_backtest() behaves identically to "static_styleC"
  (the exit_engine parameter is propagated but _apply_trade_management() does not yet
  branch on it — that wiring lands in P7.A5).

  The harness is designed with a `ADAPTIVE_WIRED` flag that lets callers verify whether
  the adaptive path is producing different results.  When False (current state), the A/B
  comparison will show zero delta — that is EXPECTED and is logged clearly in the report.
  When P7.A5 ships, set ADAPTIVE_WIRED=true in the env to activate the live gate.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

import requests

# ─── Strategy Registry (3 graduated CANDIDATE strategies) ─────────────

STRATEGY_REGISTRY: dict[str, dict] = {
    "silver_bullet": {
        "class": "src.engine.strategies.silver_bullet.SilverBulletStrategy",
        "symbol": "MES",
        "timeframe": "5min",
        "forge_name": "Forge Viper",
    },
    "power_of_3": {
        "class": "src.engine.strategies.power_of_3.PowerOf3Strategy",
        "symbol": "MES",
        "timeframe": "5min",
        "forge_name": "Forge Apex",
    },
    "ict_scalp": {
        "class": "src.engine.strategies.ict_scalp.ICTScalpStrategy",
        "symbol": "MNQ",
        "timeframe": "1min",
        "forge_name": "Forge Phantom",
    },
}

DEFAULT_STRATEGIES = ["silver_bullet", "power_of_3", "ict_scalp"]

# Non-regression tolerances
SHARPE_TOLERANCE = 0.05    # adaptive Sharpe may be up to 0.05 below static
MAX_DD_TOLERANCE = 0.10    # adaptive max_DD may be up to 10% higher than static
TRADE_COUNT_TOLERANCE = 0.20  # adaptive trade count must be within 20% of static

# When True: non-regression gate is ENFORCED (expect P7.A5+ wiring)
# When False (current state): gate is advisory only, delta=0 is expected
ADAPTIVE_WIRED = os.environ.get("ADAPTIVE_WIRED", "false").lower() == "true"

# ─── Direct backtester import ──────────────────────────────────────────

def _run_backtest_for_strategy(
    strategy_key: str,
    exit_engine: str,
    start_date: str,
    end_date: str,
) -> dict:
    """Run run_class_backtest() directly (no subprocess overhead).

    Returns the raw result dict or an error dict with 'error' key.
    """
    from src.engine.backtester import run_class_backtest
    from src.engine.data_loader import load_ohlcv

    info = STRATEGY_REGISTRY[strategy_key]
    strategy_cls_path = info["class"]

    # Dynamic import of strategy class
    module_path, class_name = strategy_cls_path.rsplit(".", 1)
    import importlib
    try:
        mod = importlib.import_module(module_path)
        cls = getattr(mod, class_name)
        strategy = cls()
    except Exception as exc:
        return {"error": f"Failed to load strategy class {strategy_cls_path}: {exc}"}

    try:
        result = run_class_backtest(
            strategy=strategy,
            start_date=start_date,
            end_date=end_date,
            slippage_ticks=1.0,
            commission_per_side=0.62,
            firm_key="topstep",
            skip_eligibility_gate=True,   # Keep entry logic identical; only exits differ
            max_trades_per_day=2,
            use_performance_gate=False,    # Skip perf gate for A/B speed
            exit_engine=exit_engine,
        )
    except Exception as exc:
        return {"error": f"run_class_backtest failed for {strategy_key}/{exit_engine}: {exc}"}

    return result


# ─── Metrics extraction ────────────────────────────────────────────────

def _extract_metrics(result: dict) -> dict:
    """Pull the comparison-relevant scalars from a backtest result dict."""
    if "error" in result:
        return {
            "total_pnl": None,
            "sharpe": None,
            "max_dd": None,
            "avg_r": None,
            "win_rate_pct": None,
            "trade_count": None,
            "error": result["error"],
        }
    return {
        "total_pnl": result.get("total_return"),
        "sharpe": result.get("sharpe_ratio"),
        "max_dd": result.get("max_drawdown"),
        "avg_r": result.get("avg_rr"),
        "win_rate_pct": round((result.get("win_rate") or 0.0) * 100, 1),
        "trade_count": result.get("total_trades"),
        "error": None,
    }


# ─── Non-regression gate ───────────────────────────────────────────────

def _apply_non_regression_gate(static: dict, adaptive: dict, strategy_key: str) -> dict:
    """Evaluate the 3 non-regression rules.

    Returns:
        {
            "passed": bool,
            "checks": list of {name, static_val, adaptive_val, delta, passed, reason},
            "blocking_failures": list[str],
        }

    When ADAPTIVE_WIRED=false (current P7.A1-A4 state), the gate is advisory only.
    """
    checks = []
    blocking_failures: list[str] = []

    # All Nones = error run — skip gate
    if static.get("error") or adaptive.get("error"):
        return {"passed": False, "checks": [], "blocking_failures": [
            f"Backtest error: static={static.get('error')} adaptive={adaptive.get('error')}"
        ]}

    # ── Gate 1: Sharpe ────────────────────────────────────────────────
    s_sharpe = static["sharpe"] or 0.0
    a_sharpe = adaptive["sharpe"] or 0.0
    sharpe_delta = round(a_sharpe - s_sharpe, 4)
    sharpe_ok = (a_sharpe >= s_sharpe - SHARPE_TOLERANCE)
    checks.append({
        "name": "sharpe_regression",
        "static_val": s_sharpe,
        "adaptive_val": a_sharpe,
        "delta": sharpe_delta,
        "tolerance": f"-{SHARPE_TOLERANCE}",
        "passed": sharpe_ok,
        "reason": "OK" if sharpe_ok else f"adaptive Sharpe dropped by {abs(sharpe_delta):.4f} (> {SHARPE_TOLERANCE} tolerance)",
    })
    if not sharpe_ok:
        blocking_failures.append(f"{strategy_key} Sharpe regression: {s_sharpe:.4f} → {a_sharpe:.4f} (delta={sharpe_delta:+.4f})")

    # ── Gate 2: Max drawdown ──────────────────────────────────────────
    s_dd = abs(static["max_dd"] or 0.0)
    a_dd = abs(adaptive["max_dd"] or 0.0)
    dd_limit = s_dd * (1 + MAX_DD_TOLERANCE)
    dd_delta_pct = round(((a_dd - s_dd) / s_dd * 100) if s_dd > 0 else 0.0, 2)
    dd_ok = (a_dd <= dd_limit)
    checks.append({
        "name": "max_dd_regression",
        "static_val": round(s_dd, 2),
        "adaptive_val": round(a_dd, 2),
        "delta_pct": dd_delta_pct,
        "tolerance_pct": MAX_DD_TOLERANCE * 100,
        "passed": dd_ok,
        "reason": "OK" if dd_ok else f"adaptive max_DD grew by {dd_delta_pct:+.1f}% (> {MAX_DD_TOLERANCE*100:.0f}% tolerance)",
    })
    if not dd_ok:
        blocking_failures.append(f"{strategy_key} max_DD regression: ${s_dd:.2f} → ${a_dd:.2f} ({dd_delta_pct:+.1f}%)")

    # ── Gate 3: Trade count ───────────────────────────────────────────
    s_tc = static["trade_count"] or 0
    a_tc = adaptive["trade_count"] or 0
    tc_lower = s_tc * (1 - TRADE_COUNT_TOLERANCE)
    tc_upper = s_tc * (1 + TRADE_COUNT_TOLERANCE)
    tc_delta = a_tc - s_tc
    tc_ok = (tc_lower <= a_tc <= tc_upper) if s_tc > 0 else True
    checks.append({
        "name": "trade_count_parity",
        "static_val": s_tc,
        "adaptive_val": a_tc,
        "delta": tc_delta,
        "tolerance_pct": TRADE_COUNT_TOLERANCE * 100,
        "passed": tc_ok,
        "reason": "OK" if tc_ok else f"adaptive trade count {a_tc} outside [{tc_lower:.0f}, {tc_upper:.0f}] (exits gating entries?)",
    })
    if not tc_ok:
        blocking_failures.append(f"{strategy_key} trade-count regression: {s_tc} → {a_tc} (exits appear to gate entries)")

    gate_passed = len(blocking_failures) == 0
    return {"passed": gate_passed, "checks": checks, "blocking_failures": blocking_failures}


# ─── Markdown report builder ───────────────────────────────────────────

def _build_markdown_report(
    run_date: str,
    start_date: str,
    end_date: str,
    strategy_results: list[dict],
    overall_passed: bool,
    adaptive_wired: bool,
) -> str:
    lines: list[str] = []

    lines.append("# Wave 25 Pass 7 — Exit Engine A/B Report")
    lines.append("")
    lines.append(f"**Run date:** {run_date}")
    lines.append(f"**Window:** {start_date} → {end_date}")
    lines.append(f"**Strategies tested:** {len(strategy_results)}")
    lines.append(f"**Adaptive exit wired:** {'YES' if adaptive_wired else 'NO (P7.A1–A4 state; adaptive path stubs to static_styleC)'}")
    lines.append("")

    if not adaptive_wired:
        lines.append("> NOTE: adaptive exit engine wiring (P7.A5) is not yet complete.")
        lines.append("> Expect zero delta between adaptive and static_styleC runs.")
        lines.append("> Gate is advisory only until `ADAPTIVE_WIRED=true`.")
        lines.append("")

    # ── Overall gate banner ────────────────────────────────────────────
    if overall_passed:
        lines.append("## Overall Gate: PASS")
    else:
        lines.append("## Overall Gate: FAIL")
    lines.append("")

    # ── Per-strategy sections ──────────────────────────────────────────
    for sr in strategy_results:
        strat = sr["strategy"]
        forge_name = sr["forge_name"]
        s = sr["static"]
        a = sr["adaptive"]
        gate = sr["gate"]

        lines.append(f"### {forge_name} (`{strat}`)")
        lines.append("")

        # Side-by-side metrics table
        lines.append("| Metric | static_styleC | adaptive | Delta |")
        lines.append("|--------|-------------|----------|-------|")

        def _fmt_val(v, fmt=".2f"):
            if v is None:
                return "N/A"
            try:
                return format(v, fmt)
            except Exception:
                return str(v)

        def _delta(sv, av, pct=False):
            if sv is None or av is None:
                return "N/A"
            d = av - sv
            if pct:
                base = abs(sv) if sv != 0 else 1
                return f"{d/base*100:+.1f}%"
            return f"{d:+.2f}"

        rows = [
            ("Total P&L ($)", s.get("total_pnl"), a.get("total_pnl"), False),
            ("Sharpe Ratio", s.get("sharpe"), a.get("sharpe"), False),
            ("Max Drawdown ($)", s.get("max_dd"), a.get("max_dd"), False),
            ("Avg R-multiple", s.get("avg_r"), a.get("avg_r"), False),
            ("Win Rate (obs.)", s.get("win_rate_pct"), a.get("win_rate_pct"), True),
            ("Trade Count", s.get("trade_count"), a.get("trade_count"), False),
        ]
        for label, sv, av, pct in rows:
            lines.append(f"| {label} | {_fmt_val(sv)} | {_fmt_val(av)} | {_delta(sv, av, pct)} |")

        lines.append("")

        # Errors
        if s.get("error"):
            lines.append(f"**static_styleC error:** {s['error']}")
            lines.append("")
        if a.get("error"):
            lines.append(f"**adaptive error:** {a['error']}")
            lines.append("")

        # Gate checks
        if gate["checks"]:
            lines.append("**Non-regression gate checks:**")
            lines.append("")
            lines.append("| Check | Static | Adaptive | Result |")
            lines.append("|-------|--------|----------|--------|")
            for c in gate["checks"]:
                icon = "PASS" if c["passed"] else "FAIL"
                lines.append(f"| {c['name']} | {_fmt_val(c.get('static_val'))} | {_fmt_val(c.get('adaptive_val'))} | {icon} — {c['reason']} |")
            lines.append("")
        elif gate.get("blocking_failures"):
            for bf in gate["blocking_failures"]:
                lines.append(f"- FAIL: {bf}")
            lines.append("")

        # Gate summary
        gate_status = "PASS" if gate["passed"] else "FAIL"
        if not adaptive_wired:
            gate_status += " (advisory — adaptive not yet wired)"
        lines.append(f"**Strategy gate:** {gate_status}")
        lines.append("")
        lines.append("---")
        lines.append("")

    # ── Tolerances reference ───────────────────────────────────────────
    lines.append("## Non-regression Gate Tolerances")
    lines.append("")
    lines.append(f"- Sharpe: adaptive must be >= static - {SHARPE_TOLERANCE}")
    lines.append(f"- Max drawdown: adaptive must be <= static * (1 + {MAX_DD_TOLERANCE:.0%})")
    lines.append(f"- Trade count: adaptive must be within ±{TRADE_COUNT_TOLERANCE:.0%} of static")
    lines.append("")
    lines.append("Win rate is an **observed output** — not a gate target (CLAUDE.md §13).")
    lines.append("")

    return "\n".join(lines)


# ─── Audit event writer ────────────────────────────────────────────────

def _emit_audit_event(
    action: str,
    payload: dict,
    api_base: str = "http://localhost:4000",
) -> None:
    """Write a wave25.exit_engine_ab_* audit event via REST.

    Fail-soft: never raises.  Audit failure is logged to stderr but does not
    abort the report run.
    """
    try:
        resp = requests.post(
            f"{api_base}/api/audit",
            json={
                "action": action,
                "status": "info",
                "source": "wave25_exit_engine_ab_report",
                "result": payload,
            },
            timeout=10,
        )
        if resp.status_code not in (200, 201):
            print(
                f"[audit] WARNING: {action} returned {resp.status_code}: {resp.text[:200]}",
                file=sys.stderr,
            )
    except Exception as exc:
        print(f"[audit] WARNING: could not emit {action}: {exc}", file=sys.stderr)


# ─── Discord alert ─────────────────────────────────────────────────────

def _send_discord_alert(message: str, api_base: str = "http://localhost:4000") -> None:
    """Send a critical Discord alert on regression detection.

    Fail-soft: never raises.
    """
    try:
        resp = requests.post(
            f"{api_base}/api/discord/alert",
            json={"message": message, "level": "critical"},
            timeout=10,
        )
        if resp.status_code not in (200, 201):
            print(f"[discord] WARNING: alert returned {resp.status_code}", file=sys.stderr)
    except Exception as exc:
        print(f"[discord] WARNING: could not send alert: {exc}", file=sys.stderr)


# ─── Main ──────────────────────────────────────────────────────────────

def run_ab_report(
    strategies: list[str],
    start_date: str,
    end_date: str,
    api_base: str = "http://localhost:4000",
    output_path: Optional[str] = None,
) -> dict:
    """Execute the A/B comparison and return structured result.

    Returns:
        {
            "overall_passed": bool,
            "strategy_results": list[dict],
            "report_path": str | None,
            "regression_detected": bool,
        }
    """
    run_date = datetime.now(tz=__import__("datetime").timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    print(f"[ab] Wave 25 Exit Engine A/B Report — {run_date}", file=sys.stderr)
    print(f"[ab] Window: {start_date} → {end_date}", file=sys.stderr)
    print(f"[ab] Strategies: {strategies}", file=sys.stderr)
    print(f"[ab] ADAPTIVE_WIRED={ADAPTIVE_WIRED}", file=sys.stderr)

    strategy_results: list[dict] = []
    all_blocking_failures: list[str] = []

    for strat in strategies:
        if strat not in STRATEGY_REGISTRY:
            print(f"[ab] ERROR: unknown strategy '{strat}'", file=sys.stderr)
            strategy_results.append({
                "strategy": strat,
                "forge_name": "unknown",
                "static": {"error": f"unknown strategy key: {strat}"},
                "adaptive": {"error": f"unknown strategy key: {strat}"},
                "gate": {"passed": False, "checks": [], "blocking_failures": [f"unknown strategy: {strat}"]},
            })
            continue

        info = STRATEGY_REGISTRY[strat]
        print(f"\n[ab] --- {strat} ({info['forge_name']}) ---", file=sys.stderr)

        # Run static
        t0 = time.perf_counter()
        print(f"[ab]   Running static_styleC...", file=sys.stderr)
        static_result = _run_backtest_for_strategy(strat, "static_styleC", start_date, end_date)
        t_static = time.perf_counter() - t0

        # Run adaptive
        t1 = time.perf_counter()
        print(f"[ab]   Running adaptive...", file=sys.stderr)
        adaptive_result = _run_backtest_for_strategy(strat, "adaptive", start_date, end_date)
        t_adaptive = time.perf_counter() - t1

        print(f"[ab]   static={t_static:.1f}s  adaptive={t_adaptive:.1f}s", file=sys.stderr)

        static_metrics = _extract_metrics(static_result)
        adaptive_metrics = _extract_metrics(adaptive_result)
        gate = _apply_non_regression_gate(static_metrics, adaptive_metrics, strat)

        if gate["blocking_failures"]:
            all_blocking_failures.extend(gate["blocking_failures"])

        strategy_results.append({
            "strategy": strat,
            "forge_name": info["forge_name"],
            "static": static_metrics,
            "adaptive": adaptive_metrics,
            "gate": gate,
        })

        gate_label = "PASS" if gate["passed"] else "FAIL"
        if not ADAPTIVE_WIRED:
            gate_label += " (advisory)"
        print(f"[ab]   Gate: {gate_label}", file=sys.stderr)

    # Overall pass: all strategies must pass (or we're in advisory mode)
    regression_detected = len(all_blocking_failures) > 0 and ADAPTIVE_WIRED
    overall_passed = not regression_detected

    # ── Emit audit event ──────────────────────────────────────────────
    audit_payload = {
        "run_date": run_date,
        "window": {"start": start_date, "end": end_date},
        "strategies": strategies,
        "adaptive_wired": ADAPTIVE_WIRED,
        "overall_passed": overall_passed,
        "regression_detected": regression_detected,
        "strategy_results": [
            {
                "strategy": sr["strategy"],
                "gate_passed": sr["gate"]["passed"],
                "static_sharpe": sr["static"].get("sharpe"),
                "adaptive_sharpe": sr["adaptive"].get("sharpe"),
                "blocking_failures": sr["gate"].get("blocking_failures", []),
            }
            for sr in strategy_results
        ],
    }

    _emit_audit_event("wave25.exit_engine_ab_completed", audit_payload, api_base)

    if regression_detected:
        regression_payload = {
            **audit_payload,
            "blocking_failures": all_blocking_failures,
        }
        _emit_audit_event("wave25.exit_engine_ab_regression_detected", regression_payload, api_base)
        _send_discord_alert(
            f"[CRITICAL] Wave 25 A/B regression detected:\n"
            + "\n".join(f"  - {f}" for f in all_blocking_failures),
            api_base,
        )

    # ── Build Markdown report ─────────────────────────────────────────
    report_md = _build_markdown_report(
        run_date=run_date,
        start_date=start_date,
        end_date=end_date,
        strategy_results=strategy_results,
        overall_passed=overall_passed,
        adaptive_wired=ADAPTIVE_WIRED,
    )

    report_file: Optional[str] = None
    if output_path is None:
        # Default: docs/wave25-exit-engine-ab-report.md next to the trading-forge root
        script_dir = Path(__file__).parent
        docs_dir = script_dir.parent / "docs"
        docs_dir.mkdir(exist_ok=True)
        report_file = str(docs_dir / "wave25-exit-engine-ab-report.md")
    else:
        report_file = output_path

    Path(report_file).write_text(report_md, encoding="utf-8")
    print(f"\n[ab] Report written: {report_file}", file=sys.stderr)

    return {
        "overall_passed": overall_passed,
        "strategy_results": strategy_results,
        "report_path": report_file,
        "regression_detected": regression_detected,
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Wave 25 Pass 7 — Exit Engine A/B Report",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--days",
        type=int,
        default=30,
        help="Number of historical days to back-test (default: 30)",
    )
    parser.add_argument(
        "--strategies",
        type=str,
        default="all",
        help="Comma-separated strategy keys or 'all' (default: all)",
    )
    parser.add_argument(
        "--start-date",
        dest="start_date",
        type=str,
        default=None,
        help="Override start date (YYYY-MM-DD). Overrides --days.",
    )
    parser.add_argument(
        "--end-date",
        dest="end_date",
        type=str,
        default=None,
        help="Override end date (YYYY-MM-DD). Overrides --days.",
    )
    parser.add_argument(
        "--api",
        default="http://localhost:4000",
        help="Trading Forge API base URL for audit events (default: http://localhost:4000)",
    )
    parser.add_argument(
        "--output",
        type=str,
        default=None,
        help="Output .md path (default: docs/wave25-exit-engine-ab-report.md)",
    )
    args = parser.parse_args()

    # ── Date resolution ────────────────────────────────────────────────
    if args.end_date:
        end_date = args.end_date
    else:
        end_date = datetime.utcnow().strftime("%Y-%m-%d")

    if args.start_date:
        start_date = args.start_date
    else:
        start_date = (datetime.utcnow() - timedelta(days=args.days)).strftime("%Y-%m-%d")

    # ── Strategy selection ─────────────────────────────────────────────
    if args.strategies.lower() == "all":
        selected = DEFAULT_STRATEGIES
    else:
        selected = [s.strip() for s in args.strategies.split(",") if s.strip()]
        for s in selected:
            if s not in STRATEGY_REGISTRY:
                print(f"ERROR: Unknown strategy '{s}'. Available: {list(STRATEGY_REGISTRY.keys())}")
                sys.exit(1)

    # ── Run ────────────────────────────────────────────────────────────
    t0 = time.perf_counter()
    result = run_ab_report(
        strategies=selected,
        start_date=start_date,
        end_date=end_date,
        api_base=args.api,
        output_path=args.output,
    )
    elapsed = time.perf_counter() - t0

    print(f"\n[ab] Done in {elapsed:.1f}s", file=sys.stderr)
    print(f"[ab] Overall: {'PASS' if result['overall_passed'] else 'FAIL'}", file=sys.stderr)
    print(f"[ab] Report: {result['report_path']}", file=sys.stderr)

    # Print JSON summary to stdout for piping
    if not sys.stdout.isatty():
        json.dump(result, sys.stdout, indent=2, default=str)

    sys.exit(0 if result["overall_passed"] else 1)


if __name__ == "__main__":
    main()
