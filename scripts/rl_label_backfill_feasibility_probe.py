"""RL Path-A feasibility probe — point-in-time institutional-regime label backfill.

ADVISOR-REQUIRED ARTIFACT (ruling 2026-07-17): "enumerate the institutional
labeler's inputs, confirm each is persisted in the price archive, demonstrate
point-in-time computation on a sample window, with the null-rate / cardinality /
cell-count table." Until this runs, 'backfill is feasible' is a FORECAST, not a
proof — the same epistemic object 'tests pass' was before the bias_state find.

READ-ONLY probe: loads real archive bars + the persisted economic calendar,
replays the REAL production classifier (`classify_institutional_regime` +
its own helper functions) bar-by-bar using ONLY data at-or-before each bar
(tail slices — no smoothing, no end-of-day reclassification, no future data),
and emits the inspection artifact. Changes NO production state, writes NO DB
rows; output goes to docs/rl-path-a/.

Labeler inputs and their persistence receipts:
  1. OHLCV trailing-window metrics (ATR percentile / volume ratio / range-vs-ATR
     / displacement)  -> S3 Databento ratio-adjusted parquet (this probe loads it)
  2. Session label     -> pure function of bar timestamp (session_context._get_session)
  3. Macro event flag  -> economic_release_dates table (416 rows, 2024-01..2027-12)
  4. (fall-through TRENDING/RANGE arms use the same trailing OHLCV class of
     inputs via compute_bias; this probe reports the institutional 4-arm labels
     + the _PASS_THROUGH fraction that the full backfill job must resolve)

Usage (from repo root; .env supplies AWS + DATABASE_URL):
  python scripts/rl_label_backfill_feasibility_probe.py \
      --symbol MES --timeframe 15min --start 2026-05-01 --end 2026-06-30
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path
from zoneinfo import ZoneInfo

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

_ET = ZoneInfo("America/New_York")


def _load_dotenv(path: Path) -> None:
    """Minimal KEY=VALUE .env loader (no external dep); does not override set vars."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        k, v = k.strip(), v.strip().strip('"').strip("'")
        if k and k not in os.environ:
            os.environ[k] = v


def _fetch_event_dates(start: str, end: str) -> tuple[set[date], str]:
    """T1 macro event dates in [start, end] from the persisted calendar table."""
    try:
        import psycopg as _pg  # tower has psycopg 3 (user-site)
    except ImportError:
        import psycopg2 as _pg  # fallback: environments with psycopg2

    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        return set(), "DATABASE_URL not set — event flag defaulted False (DEGRADES artifact)"
    conn = _pg.connect(db_url)
    try:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT release_date::date, event_type FROM economic_release_dates
                    WHERE release_date::date BETWEEN %s AND %s""",
                (start, end),
            )
            rows = cur.fetchall()
    finally:
        conn.close()
    dates = {r[0] for r in rows}
    detail = f"{len(rows)} releases on {len(dates)} distinct dates from economic_release_dates"
    return dates, detail


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--symbol", default="MES")
    ap.add_argument("--timeframe", default="15min")
    ap.add_argument("--start", default="2026-05-01")
    ap.add_argument("--end", default="2026-06-30")
    ap.add_argument("--lookback", type=int, default=30, help="trailing bars for ATR pct / vol ratio (production helper default)")
    args = ap.parse_args()

    _load_dotenv(REPO_ROOT.parent / "trading-forge" / ".env")
    _load_dotenv(REPO_ROOT / ".env")

    # Real production imports — the probe demonstrates THE classifier, not a copy.
    from src.engine.data_loader import load_ohlcv
    from src.engine.context.bias_engine import (
        classify_institutional_regime,
        _compute_atr_percentile_from_bars,
        _compute_volume_ratio,
        _compute_range_vs_atr,
    )
    from src.engine.context.htf_context import HTFContext
    from src.engine.context.session_context import SessionContext, _get_session

    bars = load_ohlcv(args.symbol, args.timeframe, args.start, args.end)
    n_bars = len(bars)
    if n_bars == 0:
        print("NO BARS LOADED — archive coverage gap for this window", file=sys.stderr)
        return 2

    event_dates, event_src_detail = _fetch_event_dates(args.start, args.end)

    ts_col = "ts_event" if "ts_event" in bars.columns else "timestamp"
    labels: list[str] = []
    sessions: list[str] = []
    input_nulls = Counter()  # per-input None counts (post-warmup)
    warmup = args.lookback + 1

    for i in range(n_bars):
        if i < warmup:
            continue
        tail = bars[: i + 1]  # POINT-IN-TIME: bars at-or-before bar i only

        atr_pct = _compute_atr_percentile_from_bars(tail, lookback=args.lookback)
        vol_ratio = _compute_volume_ratio(tail, lookback=args.lookback)
        rng_vs_atr = _compute_range_vs_atr(tail)
        if atr_pct is None:
            input_nulls["atr_percentile"] += 1
        if vol_ratio is None:
            input_nulls["volume_ratio"] += 1
        if rng_vs_atr is None:
            input_nulls["range_vs_atr"] += 1

        ts = tail[ts_col][-1]
        et = ts.astimezone(_ET) if getattr(ts, "tzinfo", None) else ts.replace(tzinfo=ZoneInfo("UTC")).astimezone(_ET)
        session_name = _get_session(et.hour, et.minute)
        event_active = et.date() in event_dates

        htf = HTFContext(
            daily_trend="neutral", weekly_trend="neutral", four_h_trend="neutral",
            pd_location="equilibrium", prev_day_high=0.0, prev_day_low=0.0,
            prev_day_close=0.0, weekly_high=0.0, weekly_low=0.0, adr=0.0,
            atr_percentile=atr_pct if atr_pct is not None else 50.0,
        )
        session = SessionContext(
            overnight_range=(0.0, 0.0), overnight_bias="neutral",
            london_high=0.0, london_low=0.0, london_swept_pdh=False,
            london_swept_pdl=False, ny_killzone_active=False,
            london_killzone_active=False, asian_killzone_active=False,
            current_session=session_name, opening_range=(0.0, 0.0),
            or_broken=None, macro_time_active=False,
        )

        label, _evidence = classify_institutional_regime(
            htf, session, event_active=event_active, bars=tail,
            volume_ratio_override=vol_ratio,
        )
        labels.append(label)
        sessions.append(session_name)

    n_labeled = len(labels)
    label_counts = Counter(labels)
    cell_counts: dict[str, Counter] = defaultdict(Counter)
    for lab, sess in zip(labels, sessions):
        cell_counts[lab][sess] += 1
    transitions = sum(1 for a, b in zip(labels, labels[1:]) if a != b)

    artifact = {
        "generated_at_note": "goalscan-r2 RL Path-A feasibility probe (advisor-required artifact)",
        "window": {"symbol": args.symbol, "timeframe": args.timeframe, "start": args.start, "end": args.end},
        "provenance": {
            "point_in_time": "labels computed per-bar from tail slice bars[:i+1] only; production classifier + production helper functions; no smoothing, no retro reclassification",
            "inputs": {
                "ohlcv_trailing_metrics": f"S3 ratio-adjusted parquet via load_ohlcv (loaded {n_bars} bars)",
                "session_label": "pure function of bar timestamp (session_context._get_session, ET)",
                "macro_event_flag": event_src_detail,
                "fall_through_note": "TRENDING/RANGE/NO_TRADE arms resolve in compute_bias from the same trailing-OHLCV input class; _PASS_THROUGH fraction below is what the full backfill job must additionally resolve",
            },
        },
        "bars_loaded": n_bars,
        "bars_labeled_post_warmup": n_labeled,
        "input_null_rates": {
            k: {"nulls": v, "rate": round(v / max(1, n_labeled), 4)} for k, v in sorted(input_nulls.items())
        } or {"atr_percentile": {"nulls": 0, "rate": 0.0}, "volume_ratio": {"nulls": 0, "rate": 0.0}, "range_vs_atr": {"nulls": 0, "rate": 0.0}},
        "label_cardinality": len(label_counts),
        "label_distribution": dict(label_counts.most_common()),
        "regime_x_session_cells": {lab: dict(c.most_common()) for lab, c in sorted(cell_counts.items())},
        "min_cell_n": min((n for c in cell_counts.values() for n in c.values()), default=0),
        "regime_transitions_observed": transitions,
    }

    out_dir = REPO_ROOT / "docs" / "rl-path-a"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_json = out_dir / "feasibility-artifact-2026-07-17.json"
    out_json.write_text(json.dumps(artifact, indent=2), encoding="utf-8")
    print(json.dumps(artifact, indent=2))
    print(f"\nARTIFACT WRITTEN: {out_json}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
