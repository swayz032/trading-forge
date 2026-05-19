#!/usr/bin/env python3
"""Batch Backtest Runner — Run all 19 strategies through the full pipeline.

Usage:
    python scripts/batch_backtest.py [--strategies silver_bullet,ict_scalp] [--mode walkforward] [--dry-run]

Runs each strategy class through:
  1. Walk-forward validation (5 windows, Optuna 800 trials)
  2. Performance gate + tier classification
  3. Monte Carlo (auto-triggered by backtest-service)
  4. Prop firm compliance (auto-triggered)
  5. Logs results to system_journal via API

Output: JSON summary table to stdout + results saved to system_journal.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from datetime import datetime

import requests

# ─── Strategy Registry ──────────────────────────────────────────────

STRATEGY_REGISTRY = {
    "silver_bullet": {
        "forge_name": "Forge Viper",
        "class": "src.engine.strategies.silver_bullet.SilverBulletStrategy",
        "symbol": "MNQ",
        "timeframe": "5m",
        "edge_type": "session_fvg",
    },
    "ict_scalp": {
        "forge_name": "Forge Phantom",
        "class": "src.engine.strategies.ict_scalp.ICTScalpStrategy",
        "symbol": "MNQ",
        "timeframe": "1m",
        "edge_type": "sweep_mss_fvg",
    },
    "turtle_soup": {
        "forge_name": "Forge Serpent",
        "class": "src.engine.strategies.turtle_soup.TurtleSoupStrategy",
        "symbol": "MES",
        "timeframe": "15m",
        "edge_type": "donchian_reversal",
    },
    "london_raid": {
        "forge_name": "Forge Raid",
        "class": "src.engine.strategies.london_raid.LondonRaidStrategy",
        "symbol": "MCL",
        "timeframe": "5m",
        "edge_type": "london_sweep",
    },
    "ny_lunch_reversal": {
        "forge_name": "Forge Tide",
        "class": "src.engine.strategies.ny_lunch_reversal.NYLunchReversalStrategy",
        "symbol": "MES",
        "timeframe": "5m",
        "edge_type": "mean_reversion",
    },
    "midnight_open": {
        "forge_name": "Forge Shadow",
        "class": "src.engine.strategies.midnight_open.MidnightOpenStrategy",
        "symbol": "MES",
        "timeframe": "15m",
        "edge_type": "overnight_breakout",
    },
    "power_of_3": {
        "forge_name": "Forge Apex",
        "class": "src.engine.strategies.power_of_3.PowerOf3Strategy",
        "symbol": "MES",
        "timeframe": "1h",
        "edge_type": "confluence",
    },
    "breaker": {
        "forge_name": "Forge Fracture",
        "class": "src.engine.strategies.breaker.BreakerStrategy",
        "symbol": "MES",
        "timeframe": "5m",
        "edge_type": "breaker_block",
    },
    "propulsion": {
        "forge_name": "Forge Thrust",
        "class": "src.engine.strategies.propulsion.PropulsionStrategy",
        "symbol": "MNQ",
        "timeframe": "5m",
        "edge_type": "displacement_volume",
    },
    "ict_2022": {
        "forge_name": "Forge Origin",
        "class": "src.engine.strategies.ict_2022.ICT2022Strategy",
        "symbol": "MNQ",
        "timeframe": "5m",
        "edge_type": "ict_foundation",
    },
    "ict_swing": {
        "forge_name": "Forge Atlas",
        "class": "src.engine.strategies.ict_swing.ICTSwingStrategy",
        "symbol": "MES",
        "timeframe": "1h",
        "edge_type": "ict_swing",
    },
    "judas_swing": {
        "forge_name": "Forge Judas",
        "class": "src.engine.strategies.judas_swing.JudasSwingStrategy",
        "symbol": "MES",
        "timeframe": "15m",
        "edge_type": "supply_demand_reversal",
    },
    "mitigation": {
        "forge_name": "Forge Shield",
        "class": "src.engine.strategies.mitigation.MitigationStrategy",
        "symbol": "MES",
        "timeframe": "5m",
        "edge_type": "mitigation_entry",
    },
    "unicorn": {
        "forge_name": "Forge Unicorn",
        "class": "src.engine.strategies.unicorn.UnicornStrategy",
        "symbol": "MNQ",
        "timeframe": "1m",
        "edge_type": "regime_filtered_scalp",
    },
    "smt_reversal": {
        "forge_name": "Forge Mirror",
        "class": "src.engine.strategies.smt_reversal.SMTReversalStrategy",
        "symbol": "MES",
        "timeframe": "5m",
        "edge_type": "multi_instrument",
    },
    "eqhl_raid": {
        "forge_name": "Forge Sniper",
        "class": "src.engine.strategies.eqhl_raid.EqhlRaidStrategy",
        "symbol": "MES",
        "timeframe": "5m",
        "edge_type": "equal_hl_raid",
    },
    "iofed": {
        "forge_name": "Forge Pulse",
        "class": "src.engine.strategies.iofed.IOFEDStrategy",
        "symbol": "MES",
        "timeframe": "5m",
        "edge_type": "order_flow_fed",
    },
    "ote_strategy": {
        "forge_name": "Forge Trigger",
        "class": "src.engine.strategies.ote_strategy.OTEStrategy",
        "symbol": "MES",
        "timeframe": "5m",
        "edge_type": "ote_timing",
    },
    "quarterly_swing": {
        "forge_name": "Forge Quake",
        "class": "src.engine.strategies.quarterly_swing.QuarterlySwingStrategy",
        "symbol": "MES",
        "timeframe": "1d",
        "edge_type": "quarterly_levels",
    },
}

# Priority order: most promising first
PRIORITY_ORDER = [
    "silver_bullet", "ict_scalp", "turtle_soup", "london_raid", "ny_lunch_reversal",
    "power_of_3", "midnight_open", "ict_2022", "breaker", "propulsion",
    "judas_swing", "mitigation", "unicorn", "smt_reversal", "eqhl_raid",
    "iofed", "ote_strategy", "ict_swing", "quarterly_swing",
]


def run_single_backtest(
    strategy_key: str,
    api_base: str,
    mode: str = "walkforward",
    dry_run: bool = False,
) -> dict:
    """Run a single strategy through the backtest pipeline via API."""
    info = STRATEGY_REGISTRY[strategy_key]

    print(f"\n{'='*60}")
    print(f"  {info['forge_name']} ({strategy_key})")
    print(f"  Symbol: {info['symbol']} | TF: {info['timeframe']} | Edge: {info['edge_type']}")
    print(f"{'='*60}")

    if dry_run:
        print("  [DRY RUN] Skipping actual backtest")
        return {
            "strategy": strategy_key,
            "forge_name": info["forge_name"],
            "status": "dry_run",
            "tier": None,
            "forge_score": None,
        }

    # Step 1: Create or find strategy in DB
    try:
        # Create strategy record via API
        create_resp = requests.post(
            f"{api_base}/api/strategies",
            json={
                "name": info["forge_name"],
                "description": f"{info['forge_name']} — {strategy_key} {info['edge_type']} strategy",
                "symbol": info["symbol"],
                "timeframe": info["timeframe"],
                "config": {
                    "strategy_class": info["class"],
                    "entry_long": "class_based",
                    "entry_short": "class_based",
                    "exit": "class_based",
                    "stop_loss": {"type": "atr", "multiplier": 2.0},
                    "position_size": {"type": "dynamic_atr", "target_risk_dollars": 500},
                    "indicators": [],
                },
                "tags": [info["edge_type"], "batch_backtest"],
            },
            timeout=15,
        )
        if create_resp.status_code in (200, 201):
            strategy_id = create_resp.json().get("id")
        else:
            print(f"  [WARN] Strategy create returned {create_resp.status_code}: {create_resp.text[:200]}")
            # Try to find existing
            list_resp = requests.get(
                f"{api_base}/api/strategies",
                params={"name": info["forge_name"]},
                timeout=10,
            )
            if list_resp.status_code == 200:
                items = list_resp.json()
                strategy_id = items[0]["id"] if items else None
            else:
                strategy_id = None

        if not strategy_id:
            return {
                "strategy": strategy_key,
                "forge_name": info["forge_name"],
                "status": "error",
                "error": "Could not create or find strategy record",
                "tier": None,
                "forge_score": None,
            }

    except Exception as e:
        return {
            "strategy": strategy_key,
            "forge_name": info["forge_name"],
            "status": "error",
            "error": str(e),
            "tier": None,
            "forge_score": None,
        }

    # Step 2: Submit backtest
    try:
        bt_resp = requests.post(
            f"{api_base}/api/backtests",
            json={
                "strategyId": strategy_id,
                "mode": mode,
                "walk_forward_splits": 5,
                "optimizer": "optuna",
            },
            timeout=30,
        )
        if bt_resp.status_code not in (200, 201, 202):
            return {
                "strategy": strategy_key,
                "forge_name": info["forge_name"],
                "status": "error",
                "error": f"Backtest submit failed: {bt_resp.status_code}",
                "tier": None,
                "forge_score": None,
            }

        backtest_id = bt_resp.json().get("backtestId")
        print(f"  Backtest submitted: {backtest_id}")

    except Exception as e:
        return {
            "strategy": strategy_key,
            "forge_name": info["forge_name"],
            "status": "error",
            "error": str(e),
            "tier": None,
            "forge_score": None,
        }

    # Step 3: Poll for results (10 min timeout, 15s intervals)
    max_polls = 40
    for i in range(max_polls):
        time.sleep(15)
        try:
            status_resp = requests.get(
                f"{api_base}/api/backtests/{backtest_id}",
                timeout=10,
            )
            if status_resp.status_code != 200:
                continue

            data = status_resp.json()
            status = data.get("status", "unknown")

            if status == "completed":
                result = {
                    "strategy": strategy_key,
                    "forge_name": info["forge_name"],
                    "status": "completed",
                    "backtest_id": backtest_id,
                    "strategy_id": strategy_id,
                    "tier": data.get("tier"),
                    "forge_score": data.get("forgeScore"),
                    "sharpe": data.get("sharpeRatio"),
                    "max_drawdown": data.get("maxDrawdown"),
                    "avg_daily_pnl": data.get("avgDailyPnl"),
                    "profit_factor": data.get("profitFactor"),
                    "total_trades": data.get("totalTrades"),
                    "win_rate": data.get("winRate"),
                    "total_return": data.get("totalReturn"),
                    "execution_time_ms": data.get("executionTimeMs"),
                }
                tier_display = result["tier"] or "REJECTED"
                score_display = result["forge_score"] or "N/A"
                print(f"  RESULT: {tier_display} | Score: {score_display} | Sharpe: {result['sharpe']}")
                return result

            elif status == "failed":
                return {
                    "strategy": strategy_key,
                    "forge_name": info["forge_name"],
                    "status": "failed",
                    "error": data.get("errorMessage", "Unknown error"),
                    "tier": None,
                    "forge_score": None,
                }

            else:
                if i % 4 == 0:
                    print(f"  Waiting... ({i * 15}s elapsed, status: {status})")

        except Exception:
            continue

    return {
        "strategy": strategy_key,
        "forge_name": info["forge_name"],
        "status": "timeout",
        "error": "Backtest did not complete within 10 minutes",
        "tier": None,
        "forge_score": None,
    }


def log_to_journal(api_base: str, result: dict) -> None:
    """Log a batch backtest result to system_journal."""
    try:
        requests.post(
            f"{api_base}/api/journal",
            json={
                "strategyId": result.get("strategy_id"),
                "backtestId": result.get("backtest_id"),
                "source": "batch_backtest",
                "tier": result.get("tier"),
                "forgeScore": result.get("forge_score"),
                "status": "tested",
                "analystNotes": (
                    f"Batch backtest: {result['forge_name']} ({result['strategy']}). "
                    f"Status: {result['status']}. "
                    f"Tier: {result.get('tier', 'N/A')}. "
                    f"Sharpe: {result.get('sharpe', 'N/A')}. "
                    f"Avg daily P&L: {result.get('avg_daily_pnl', 'N/A')}."
                ),
            },
            timeout=10,
        )
    except Exception as e:
        print(f"  [WARN] Failed to log to journal: {e}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Batch backtest all 19 Trading Forge strategies")
    parser.add_argument("--api", default="http://localhost:4000", help="Trading Forge API base URL")
    parser.add_argument("--strategies", type=str, default=None,
                        help="Comma-separated strategy keys (default: all 19)")
    parser.add_argument("--mode", choices=["single", "walkforward"], default="walkforward")
    parser.add_argument("--dry-run", action="store_true", help="Print plan without executing")
    parser.add_argument("--output", type=str, default=None, help="Output JSON file path")
    args = parser.parse_args()

    if args.strategies:
        selected = [s.strip() for s in args.strategies.split(",")]
        for s in selected:
            if s not in STRATEGY_REGISTRY:
                print(f"ERROR: Unknown strategy '{s}'. Available: {list(STRATEGY_REGISTRY.keys())}")
                sys.exit(1)
    else:
        selected = PRIORITY_ORDER

    print(f"\n{'#'*60}")
    print(f"  TRADING FORGE — BATCH BACKTEST RUNNER")
    print(f"  Strategies: {len(selected)} | Mode: {args.mode}")
    print(f"  API: {args.api}")
    print(f"  Started: {datetime.now().isoformat()}")
    print(f"{'#'*60}")

    results: list[dict] = []
    start_time = time.time()

    for idx, strategy_key in enumerate(selected, 1):
        print(f"\n[{idx}/{len(selected)}] Running {strategy_key}...")
        result = run_single_backtest(strategy_key, args.api, args.mode, args.dry_run)
        results.append(result)

        # Log to journal
        if not args.dry_run and result.get("backtest_id"):
            log_to_journal(args.api, result)

    elapsed = time.time() - start_time

    # ─── Summary ──────────────────────────────────────────────────
    print(f"\n\n{'#'*60}")
    print(f"  BATCH BACKTEST SUMMARY")
    print(f"  Total time: {elapsed / 60:.1f} minutes")
    print(f"{'#'*60}\n")

    # Header
    print(f"{'Strategy':<20} {'Forge Name':<16} {'Tier':<10} {'Score':<8} {'Sharpe':<8} {'Avg $/d':<10} {'MaxDD':<10} {'Trades':<8} {'Status':<10}")
    print("-" * 110)

    tier_counts = {"TIER_1": 0, "TIER_2": 0, "TIER_3": 0, "REJECTED": 0, "error": 0}

    for r in results:
        tier = r.get("tier") or "—"
        score = r.get("forge_score") or "—"
        sharpe = r.get("sharpe") or "—"
        pnl = r.get("avg_daily_pnl") or "—"
        dd = r.get("max_drawdown") or "—"
        trades = r.get("total_trades") or "—"
        status = r.get("status", "—")

        if isinstance(score, (int, float)):
            score = f"{float(score):.1f}"
        if isinstance(sharpe, (int, float, str)):
            try:
                sharpe = f"{float(sharpe):.2f}"
            except (ValueError, TypeError):
                pass
        if isinstance(pnl, (int, float, str)):
            try:
                pnl = f"${float(pnl):.0f}"
            except (ValueError, TypeError):
                pass
        if isinstance(dd, (int, float, str)):
            try:
                dd = f"${float(dd):.0f}"
            except (ValueError, TypeError):
                pass

        print(f"{r['strategy']:<20} {r['forge_name']:<16} {tier:<10} {score:<8} {sharpe:<8} {pnl:<10} {dd:<10} {trades:<8} {status:<10}")

        if tier in tier_counts:
            tier_counts[tier] += 1
        elif status in ("error", "failed", "timeout"):
            tier_counts["error"] += 1
        else:
            tier_counts["REJECTED"] += 1

    print(f"\n  TIER_1: {tier_counts['TIER_1']} | TIER_2: {tier_counts['TIER_2']} | TIER_3: {tier_counts['TIER_3']} | REJECTED: {tier_counts['REJECTED']} | Errors: {tier_counts['error']}")

    # Save to file if requested
    if args.output:
        output_path = Path(args.output)
        output_path.write_text(json.dumps({
            "timestamp": datetime.now().isoformat(),
            "mode": args.mode,
            "total_strategies": len(selected),
            "elapsed_minutes": round(elapsed / 60, 1),
            "tier_counts": tier_counts,
            "results": results,
        }, indent=2))
        print(f"\n  Results saved to: {output_path}")

    # Also output as JSON to stdout for piping
    if not sys.stdout.isatty():
        json.dump(results, sys.stdout, indent=2)


if __name__ == "__main__":
    main()
