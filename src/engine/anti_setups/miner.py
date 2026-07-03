"""
Anti-Setup Miner -- discovers conditions where strategy setups consistently fail.
Mines historical losing trades to find common environmental conditions.
"""

from __future__ import annotations

import math
import os
import statistics
import sys
from typing import Any, Optional

# --- Multiple-testing correction (Bonferroni) ---
# We run 8 independent miners against the same trade population.
# Bonferroni correction: alpha_corrected = 0.05 / N_miners = 0.00625 -> z ~= 2.73
# This keeps family-wise error rate at 5% across all 8 miners.

_NUM_MINERS: int = 8  # Must match len(miners) list in mine_anti_setups.


def _z_for_bonferroni(n_miners: int = _NUM_MINERS, alpha: float = 0.05) -> float:
    """Return Bonferroni-corrected z-score for the Wilson score lower bound."""
    alpha_corrected = alpha / n_miners
    p = 1.0 - alpha_corrected / 2.0
    if p >= 1.0:
        return 4.0
    t = math.sqrt(-2.0 * math.log(1.0 - p))
    c0, c1, c2 = 2.515517, 0.802853, 0.010328
    d1, d2, d3 = 1.432788, 0.189269, 0.001308
    z = t - (c0 + c1 * t + c2 * t * t) / (1.0 + d1 * t + d2 * t * t + d3 * t * t * t)
    return round(z, 4)


_BONFERRONI_Z: float = _z_for_bonferroni(_NUM_MINERS)


def mine_anti_setups(
    trades: list[dict],
    bars: list[dict],
    min_sample_size: int = 20,
    min_failure_rate: float = 0.65,
) -> list[dict]:
    """Discover conditions that are anti-setups (predict failure).

    Contract: trades MUST be in chronological entry order.
    Re-sorts by entry_time to enforce this before any miner runs.
    The streak miner depends on chronological ordering.
    Uses Bonferroni-corrected z (alpha=0.05/8=0.00625, z~=2.73) in _confidence().

    Returns list of anti-setup conditions, sorted by failure rate descending.
    """
    if not trades:
        return []

    # Enforce chronological order (F-4 fix)
    trades = sorted(trades, key=lambda t: t.get("entry_time", t.get("entryTime", "")))

    anti_setups: list[dict] = []

    miners = [
        _mine_time_of_day,
        _mine_volatility,
        _mine_volume,
        _mine_day_of_week,
        _mine_regime,
        _mine_archetype,
        _mine_event_proximity,
        _mine_streak,
    ]

    assert len(miners) == _NUM_MINERS, (
        f"_NUM_MINERS={_NUM_MINERS} does not match miners list length={len(miners)}. "
        f"Update _NUM_MINERS when adding/removing miners."
    )

    for miner_fn in miners:
        results = miner_fn(trades, bars, min_sample_size, min_failure_rate)
        anti_setups.extend(results)

    anti_setups.sort(key=lambda x: x["failure_rate"], reverse=True)
    return anti_setups


def _is_loser(trade: dict) -> bool:
    return trade.get("pnl", 0) < 0


def _failure_rate(group: list[dict]) -> float:
    if not group:
        return 0.0
    return sum(1 for t in group if _is_loser(t)) / len(group)


def _avg_loss(group: list[dict]) -> float:
    losses = [t["pnl"] for t in group if _is_loser(t)]
    return statistics.mean(losses) if losses else 0.0


def _confidence(failure_rate: float, sample_size: int) -> float:
    """Wilson score lower bound with Bonferroni-corrected z (~=2.73 for 8 miners).

    Prevents spurious anti-setup discovery from multiple-testing inflation.
    """
    if sample_size == 0:
        return 0.0
    z = _BONFERRONI_Z  # Bonferroni-corrected: ~=2.73 for 8 miners
    n = sample_size
    p = failure_rate
    denominator = 1 + z * z / n
    center = p + z * z / (2 * n)
    spread = z * math.sqrt((p * (1 - p) + z * z / (4 * n)) / n)
    lower = (center - spread) / denominator
    return round(min(max(lower, 0.0), 1.0), 4)


def _pnl_impact(group: list[dict]) -> dict:
    total_pnl = sum(t.get("pnl", 0) for t in group)
    return {
        "pnl_improvement": round(-total_pnl, 2) if total_pnl < 0 else 0.0,
        "trades_removed": len(group),
    }


def _get_hour(trade: dict) -> int | None:
    entry_time = trade.get("entry_time", "")
    if not entry_time:
        return None
    try:
        if "T" in str(entry_time):
            time_part = str(entry_time).split("T")[1]
            return int(time_part.split(":")[0])
        parts = str(entry_time).split(":")
        if len(parts) >= 2:
            return int(parts[0][-2:])
    except (ValueError, IndexError):
        return None
    return None


def _get_day_of_week(trade: dict) -> int | None:
    """Return day of week: 0=Monday .. 6=Sunday."""
    entry_time = trade.get("entry_time", "")
    if not entry_time:
        return trade.get("day_of_week")
    try:
        from datetime import datetime

        dt_str = str(entry_time)
        for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S.%f", "%Y-%m-%d"):
            try:
                dt = datetime.strptime(dt_str, fmt)
                return dt.weekday()
            except ValueError:
                continue
    except Exception:
        pass
    return trade.get("day_of_week")


def _mine_time_of_day(
    trades: list[dict],
    bars: list[dict],
    min_sample: int,
    min_fail: float,
) -> list[dict]:
    """Check 2-hour windows for high failure rates."""
    results: list[dict] = []
    hour_buckets: dict[int, list[dict]] = {}

    for t in trades:
        h = _get_hour(t)
        if h is not None:
            bucket = (h // 2) * 2
            hour_buckets.setdefault(bucket, []).append(t)

    for bucket_start, group in hour_buckets.items():
        if len(group) < min_sample:
            continue
        fr = _failure_rate(group)
        if fr >= min_fail:
            results.append({
                "condition": "time_of_day",
                "filter": {"hour_start": bucket_start, "hour_end": bucket_start + 2},
                "failure_rate": round(fr, 4),
                "sample_size": len(group),
                "avg_loss": round(_avg_loss(group), 2),
                "confidence": _confidence(fr, len(group)),
                "impact_if_filtered": _pnl_impact(group),
            })
    return results


def _mine_volatility(
    trades: list[dict],
    bars: list[dict],
    min_sample: int,
    min_fail: float,
) -> list[dict]:
    """Check if high ATR conditions produce more losers."""
    results: list[dict] = []
    atr_values = [t.get("atr") for t in trades if t.get("atr") is not None]
    if not atr_values or len(atr_values) < min_sample:
        bar_atrs = [b.get("atr") for b in bars if b.get("atr") is not None]
        if bar_atrs:
            mean_atr = statistics.mean(bar_atrs)
        else:
            return results
    else:
        mean_atr = statistics.mean(atr_values)

    thresholds = [
        ("high_atr", 1.5, None),
        ("very_high_atr", 2.0, None),
        ("low_atr", None, 0.5),
    ]

    for label, lo_mult, hi_mult in thresholds:
        group = []
        for t in trades:
            atr = t.get("atr")
            if atr is None:
                continue
            if lo_mult is not None and atr < mean_atr * lo_mult:
                continue
            if hi_mult is not None and atr > mean_atr * hi_mult:
                continue
            group.append(t)

        if len(group) < min_sample:
            continue
        fr = _failure_rate(group)
        if fr >= min_fail:
            filt: dict[str, Any] = {"atr_condition": label, "atr_mean": round(mean_atr, 4)}
            if lo_mult is not None:
                filt["atr_min_multiplier"] = lo_mult
            if hi_mult is not None:
                filt["atr_max_multiplier"] = hi_mult
            results.append({
                "condition": "volatility",
                "filter": filt,
                "failure_rate": round(fr, 4),
                "sample_size": len(group),
                "avg_loss": round(_avg_loss(group), 2),
                "confidence": _confidence(fr, len(group)),
                "impact_if_filtered": _pnl_impact(group),
            })
    return results


def _mine_volume(
    trades: list[dict],
    bars: list[dict],
    min_sample: int,
    min_fail: float,
) -> list[dict]:
    """Check if low volume conditions produce more losers."""
    results: list[dict] = []
    vol_values = [t.get("volume") for t in trades if t.get("volume") is not None]
    if not vol_values:
        return results

    mean_vol = statistics.mean(vol_values)
    if mean_vol == 0:
        return results

    low_vol = [t for t in trades if t.get("volume") is not None and t["volume"] < mean_vol]
    if len(low_vol) >= min_sample:
        fr = _failure_rate(low_vol)
        if fr >= min_fail:
            results.append({
                "condition": "volume",
                "filter": {"volume_condition": "below_average", "volume_mean": round(mean_vol, 2)},
                "failure_rate": round(fr, 4),
                "sample_size": len(low_vol),
                "avg_loss": round(_avg_loss(low_vol), 2),
                "confidence": _confidence(fr, len(low_vol)),
                "impact_if_filtered": _pnl_impact(low_vol),
            })

    very_low = [t for t in trades if t.get("volume") is not None and t["volume"] < mean_vol * 0.5]
    if len(very_low) >= min_sample:
        fr = _failure_rate(very_low)
        if fr >= min_fail:
            results.append({
                "condition": "volume",
                "filter": {"volume_condition": "very_low", "volume_threshold": round(mean_vol * 0.5, 2)},
                "failure_rate": round(fr, 4),
                "sample_size": len(very_low),
                "avg_loss": round(_avg_loss(very_low), 2),
                "confidence": _confidence(fr, len(very_low)),
                "impact_if_filtered": _pnl_impact(very_low),
            })

    return results


def _mine_day_of_week(
    trades: list[dict],
    bars: list[dict],
    min_sample: int,
    min_fail: float,
) -> list[dict]:
    """Check if specific days of week produce more losers."""
    results: list[dict] = []
    day_names = {0: "Monday", 1: "Tuesday", 2: "Wednesday", 3: "Thursday", 4: "Friday", 5: "Saturday", 6: "Sunday"}
    day_buckets: dict[int, list[dict]] = {}

    for t in trades:
        dow = _get_day_of_week(t)
        if dow is not None:
            day_buckets.setdefault(dow, []).append(t)

    for day, group in day_buckets.items():
        if len(group) < min_sample:
            continue
        fr = _failure_rate(group)
        if fr >= min_fail:
            results.append({
                "condition": "day_of_week",
                "filter": {"day": day, "day_name": day_names.get(day, str(day))},
                "failure_rate": round(fr, 4),
                "sample_size": len(group),
                "avg_loss": round(_avg_loss(group), 2),
                "confidence": _confidence(fr, len(group)),
                "impact_if_filtered": _pnl_impact(group),
            })
    return results


def _mine_regime(
    trades: list[dict],
    bars: list[dict],
    min_sample: int,
    min_fail: float,
) -> list[dict]:
    """Check if specific regime conditions produce more losers."""
    results: list[dict] = []
    regime_buckets: dict[str, list[dict]] = {}

    for t in trades:
        regime = t.get("regime")
        if regime is not None:
            regime_buckets.setdefault(str(regime), []).append(t)

    for regime, group in regime_buckets.items():
        if len(group) < min_sample:
            continue
        fr = _failure_rate(group)
        if fr >= min_fail:
            results.append({
                "condition": "regime",
                "filter": {"regime": regime},
                "failure_rate": round(fr, 4),
                "sample_size": len(group),
                "avg_loss": round(_avg_loss(group), 2),
                "confidence": _confidence(fr, len(group)),
                "impact_if_filtered": _pnl_impact(group),
            })
    return results


def _mine_archetype(
    trades: list[dict],
    bars: list[dict],
    min_sample: int,
    min_fail: float,
) -> list[dict]:
    """Check if specific day archetypes produce more losers."""
    results: list[dict] = []
    arch_buckets: dict[str, list[dict]] = {}

    for t in trades:
        archetype = t.get("archetype")
        if archetype is not None:
            arch_buckets.setdefault(str(archetype), []).append(t)

    for archetype, group in arch_buckets.items():
        if len(group) < min_sample:
            continue
        fr = _failure_rate(group)
        if fr >= min_fail:
            results.append({
                "condition": "archetype",
                "filter": {"archetype": archetype},
                "failure_rate": round(fr, 4),
                "sample_size": len(group),
                "avg_loss": round(_avg_loss(group), 2),
                "confidence": _confidence(fr, len(group)),
                "impact_if_filtered": _pnl_impact(group),
            })
    return results


def _mine_event_proximity(
    trades: list[dict],
    bars: list[dict],
    min_sample: int,
    min_fail: float,
) -> list[dict]:
    """Check if trades near economic events fail more often."""
    results: list[dict] = []
    proximity_thresholds = [
        ("near_event_1d", 0, 1),
        ("near_event_2d", 0, 2),
        ("near_event_3d", 0, 3),
    ]

    for label, min_days, max_days in proximity_thresholds:
        group = [
            t for t in trades
            if t.get("days_to_event") is not None
            and min_days <= t["days_to_event"] <= max_days
        ]
        if len(group) < min_sample:
            continue
        fr = _failure_rate(group)
        if fr >= min_fail:
            results.append({
                "condition": "event_proximity",
                "filter": {"label": label, "max_days_to_event": max_days},
                "failure_rate": round(fr, 4),
                "sample_size": len(group),
                "avg_loss": round(_avg_loss(group), 2),
                "confidence": _confidence(fr, len(group)),
                "impact_if_filtered": _pnl_impact(group),
            })
    return results


def _mine_streak(
    trades: list[dict],
    bars: list[dict],
    min_sample: int,
    min_fail: float,
) -> list[dict]:
    """Check if trades after winning/losing streaks fail more often.

    Requires trades in chronological order -- mine_anti_setups() enforces this.
    """
    results: list[dict] = []
    streak_groups: dict[str, list[dict]] = {}
    win_streak = 0
    loss_streak = 0

    for i, t in enumerate(trades):
        if i > 0:
            label = None
            if win_streak >= 2:
                label = f"after_{win_streak}_wins"
            elif loss_streak >= 2:
                label = f"after_{loss_streak}_losses"

            if label:
                streak_groups.setdefault(label, []).append(t)

        if t.get("pnl", 0) >= 0:
            win_streak += 1
            loss_streak = 0
        else:
            loss_streak += 1
            win_streak = 0

    for label, group in streak_groups.items():
        if len(group) < min_sample:
            continue
        fr = _failure_rate(group)
        if fr >= min_fail:
            results.append({
                "condition": "streak",
                "filter": {"streak_label": label},
                "failure_rate": round(fr, 4),
                "sample_size": len(group),
                "avg_loss": round(_avg_loss(group), 2),
                "confidence": _confidence(fr, len(group)),
                "impact_if_filtered": _pnl_impact(group),
            })
    return results


def _get_miner_db_connection():
    """Return a psycopg2 connection using the DATABASE_URL env var.

    Mirrors the connection pattern in src/engine/replay/db_loader.py
    (deepscan14-cf D1 follow-up) rather than importing it directly — the
    replay package's `__init__.py` is intentionally minimal to dodge a
    circular-import cycle through quantum_mc.py (see db_loader.py docstring),
    and pulling that surface into the anti-setup miner isn't worth the risk.
    """
    try:
        import psycopg2
    except ImportError as e:
        raise ImportError(
            "psycopg2 is required to load real trades for anti-setup mining. "
            "Install with: pip install psycopg2-binary"
        ) from e

    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        raise RuntimeError(
            "DATABASE_URL environment variable is not set; cannot load "
            "paper_trades for anti-setup mining."
        )
    return psycopg2.connect(db_url)


def _load_closed_trades_for_strategy(
    strategy_id: str,
) -> tuple[list[dict], Optional[str], Optional[str]]:
    """Load CLOSED paper_trades for a strategy from Postgres (deepscan14-cf D1).

    `strategy_id` lives on `paper_sessions`, not `paper_trades` directly, so
    this joins through the session row. Also reads `symbol`/`timeframe` off
    `strategies` so the caller can subsequently load matching OHLCV bars.

    Returns (trades, symbol, timeframe):
      - trades: dicts shaped for mine_anti_setups() — entry_time (ISO string),
        pnl (float), plus day_of_week / regime when the paper_trades columns
        carry them (hourOfDay/dayOfWeek/macroRegime are computed at
        trade-close time already; no re-derivation needed here). Note:
        paper_trades has no per-trade atr/volume/archetype/days_to_event
        columns today, so `_mine_volatility`/`_mine_volume`/`_mine_archetype`/
        `_mine_event_proximity` will legitimately find nothing to group on
        those dimensions until those columns exist — an honest partial mine,
        not a bug.
      - symbol/timeframe: from the strategies row, or None if not found.

    An empty trades list is a legitimate, honest result (strategy hasn't
    closed any paper trades yet) — NOT an error. DB connectivity failures
    (missing DATABASE_URL, psycopg2 unavailable, connection refused) raise
    and propagate to the caller, which folds them into the same honest
    "inactive" envelope rather than fabricating a result.
    """
    import psycopg2.extras

    conn = _get_miner_db_connection()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
            cur.execute(
                "SELECT symbol, timeframe FROM strategies WHERE id = %s LIMIT 1",
                (strategy_id,),
            )
            strat_row = cur.fetchone()
            symbol = strat_row["symbol"] if strat_row else None
            timeframe = strat_row["timeframe"] if strat_row else None

            cur.execute(
                """
                SELECT
                    pt.entry_time,
                    pt.pnl,
                    pt.day_of_week,
                    pt.macro_regime
                FROM paper_trades pt
                JOIN paper_sessions ps ON ps.id = pt.session_id
                WHERE ps.strategy_id = %s
                ORDER BY pt.entry_time ASC
                """,
                (strategy_id,),
            )
            rows = cur.fetchall()
    finally:
        conn.close()

    trades: list[dict] = []
    for row in rows:
        entry_time = row["entry_time"]
        entry_time_str = entry_time.isoformat() if hasattr(entry_time, "isoformat") else str(entry_time)
        pnl_raw = row["pnl"]
        trade: dict[str, Any] = {
            "entry_time": entry_time_str,
            "pnl": float(pnl_raw) if pnl_raw is not None else 0.0,
        }
        if row["day_of_week"] is not None:
            trade["day_of_week"] = row["day_of_week"]
        if row["macro_regime"] is not None:
            trade["regime"] = row["macro_regime"]
        trades.append(trade)

    return trades, symbol, timeframe


def _load_bars_with_atr_for_symbol(
    symbol: Optional[str],
    timeframe: Optional[str],
    trades: list[dict],
) -> list[dict]:
    """Best-effort OHLCV+ATR bar load spanning the trades' date range.

    Only `_mine_volatility` consults `bars`, and only as a fallback when
    individual trades carry no `atr` field (paper_trades doesn't persist
    per-trade ATR today) — so a failure here must never block the other
    miners. Any exception (missing S3 creds, data_loader import failure,
    symbol/timeframe absent) is swallowed and logged to stderr; the caller
    proceeds with bars=[].
    """
    if not symbol or not timeframe or not trades:
        return []

    entry_times = [t["entry_time"] for t in trades if t.get("entry_time")]
    if not entry_times:
        return []

    try:
        start = min(entry_times)[:10]
        end = max(entry_times)[:10]

        from src.engine.data_loader import load_ohlcv
        from src.engine.indicators.core import compute_atr

        df = load_ohlcv(symbol, timeframe, start, end, ignore_quality_gate=True)
        if df.is_empty():
            return []
        atr_series = compute_atr(df, period=14)
        return [{"atr": v} for v in atr_series.to_list() if v is not None]
    except Exception as exc:  # pragma: no cover — best-effort enrichment only
        print(f"[anti_setup_miner] bar load failed (non-fatal, bars=[]): {exc}", file=sys.stderr)
        return []


def run_miner_cli(cfg: dict) -> dict:
    """Core CLI logic, factored out of `__main__` for direct in-process testing
    (deepscan14-cf) — subprocess tests can't monkeypatch a fresh interpreter's
    DB layer, so this lets tests exercise the DB-load branch without a live
    Postgres by patching `_load_closed_trades_for_strategy` directly.

    Returns the JSON-serializable envelope dict (`__main__` prints it as-is).
    Never raises for expected states (no trades, DB unavailable, mining
    error) — each produces a structured envelope with gate_status
    "inactive" | "active" | "error".
    """
    trades = cfg.get("trades")
    bars = cfg.get("bars")
    strategy_id = cfg.get("strategy_id")
    db_load_error: str | None = None

    if not isinstance(trades, list) or len(trades) == 0:
        if strategy_id:
            try:
                trades, db_symbol, db_timeframe = _load_closed_trades_for_strategy(str(strategy_id))
                bars = _load_bars_with_atr_for_symbol(db_symbol, db_timeframe, trades) if trades else []
            except Exception as db_exc:
                db_load_error = str(db_exc)
                trades = []
                bars = []
        else:
            trades = []

    if not isinstance(trades, list) or len(trades) == 0:
        reason = (
            "no trades/bars supplied in config and no CLOSED paper_trades found "
            "in Postgres yet for this strategy_id — honest 'nothing to mine yet', "
            "not a failure"
        )
        if db_load_error:
            reason = f"DB load failed ({db_load_error}) — no trades/bars available to mine"
        return {
            "anti_setups": [],
            "gate_status": "inactive",
            "reason": reason,
            "strategy_id": strategy_id,
        }

    try:
        result = mine_anti_setups(
            trades,
            bars if isinstance(bars, list) else [],
            min_sample_size=int(cfg.get("min_sample_size", 20)),
            min_failure_rate=float(cfg.get("min_failure_rate", 0.65)),
        )
        return {
            "anti_setups": result,
            "gate_status": "active",
            "strategy_id": strategy_id,
        }
    except Exception as e:
        # Fail-loud, non-empty stdout — never let a mining exception collapse
        # back to the empty-stdout false-green this fix exists to close.
        return {
            "anti_setups": [],
            "gate_status": "error",
            "reason": f"mine_anti_setups failed: {e}",
            "strategy_id": strategy_id,
        }


if __name__ == "__main__":
    # deepscan14-cf D1: CLI entrypoint. Before this existed, `scheduler.ts` invoked
    # `python -m src.engine.anti_setups.miner --config <tmpfile>` (scheduler.ts,
    # "anti-setup-mine" weekly cron) against a module with NO `__main__` block —
    # the process ran and exited 0 with ZERO stdout, `parsePythonJson("")` threw,
    # the exception was swallowed as a non-blocking `logger.warn`, and the
    # `db.insert(auditLog, action:"anti_setup.mined")` write was never reached.
    # `checkAntiSetupGate` (anti-setup-gate-service.ts) reads that audit_log row —
    # with no row ever written, the gate returned blocked:false forever, silently
    # indistinguishable from "mined, found nothing to block."
    #
    # Mirrors the --config file-path CLI convention used by
    # src/engine/decay/quarantine.py and src/engine/decay/half_life.py.
    #
    # Config shape: the scheduler writes `{"strategy_id": "<uuid>", "_metadata":
    # {...}}` — it does NOT supply `trades`/`bars` inline. This CLI now loads
    # real CLOSED paper_trades (+ best-effort OHLCV/ATR bars) from Postgres for
    # that strategy_id (see _load_closed_trades_for_strategy /
    # _load_bars_with_atr_for_symbol above), so mining is genuinely ACTIVE
    # rather than permanently honest-inactive. The gate_status="inactive"
    # envelope is preserved for the two honest "nothing to mine" cases: the
    # strategy has zero closed paper trades yet, or the DB is unreachable in
    # this environment — never a fabricated result.
    import argparse
    import json

    _parser = argparse.ArgumentParser(description="Anti-setup miner CLI")
    _parser.add_argument("--config", required=True, help="Path to JSON config file")
    _args = _parser.parse_args()

    try:
        with open(_args.config) as _f:
            _cfg = json.load(_f)
    except Exception as _e:
        print(json.dumps({"error": f"Failed to read config: {_e}"}))
        sys.exit(1)

    _envelope = run_miner_cli(_cfg)
    print(json.dumps(_envelope))
    if _envelope.get("gate_status") == "error":
        sys.exit(1)