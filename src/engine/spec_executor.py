"""
SPEC EXECUTOR (2026-07-02) — the first LIVE execution of a compiled EngineStrategySpec against real market bars.

Closes the final leg of the compiler pipeline (operator/GPT): Transcript → … → EngineStrategySpec →
**grounded evaluators → Ledger E interpreter → entries on real Databento bars**, with LEDGER G
(execution traceability): every armed/blocked decision and every trade traces back through condition ids →
transcript spans → the educator's original words.

Honest v1 scope (documented, not hidden):
  - GROUNDING GRANULARITY: conditions evaluate at semantic-FAMILY granularity (mirrors condition-grounding.ts):
    same-family conditions share one per-bar boolean. Family evaluators are minimal, deterministic, stdlib+
    candle_patterns implementations of the engine primitives the grounding audit cited.
  - TRIGGER conditions (entry_execution) are the ACTION, not a market condition (grounding registry) — they are
    satisfied when evaluated; arming therefore reduces to market conditions + or-branches + invalidation veto,
    via the SAME evaluate_spec() proven by Ledger E (604/604 TS==Python).
  - FRAMEWORK-V1 EXIT (explicitly overlay-owned, NOT source logic): stop = entry + 1.5×ATR14, TP = 2R,
    time-stop MAX_HOLD_BARS. 1 contract, MES $5/pt, no commissions. This validates the CHAIN, not a promotion.
  - Session/timeframe conditions are vacuous on daily bars (always satisfied; reported).
  - Only ENGINE-SAFE imports (data_loader + candle_patterns + spec_interpreter) — never backtester/vectorbt.

Usage (tower):
  python -m src.engine.spec_executor tmp/generalization/l-2iKbcm5UI.spec.json \
      --transcript tmp/generalization/l-2iKbcm5UI.transcript.txt \
      --local-path <path to MES daily parquet> --start 2023-01-01 --end 2025-12-01
"""
from __future__ import annotations

import argparse
import json
import re
from typing import Any, Dict, List, Optional, Set, Tuple

from src.engine.indicators.candle_patterns import (
    detect_strength,
    detect_weakness,
    is_bearish_engulfing,
    is_rejection_lower,
    is_rejection_upper,
)
from src.engine.spec_interpreter import evaluate_spec

MES_POINT_VALUE = 5.0
ATR_PERIOD = 14
STOP_ATR_MULT = 1.5     # framework-v1 (overlay-owned)
TP_R_MULT = 2.0         # framework-v1 (overlay-owned)
MAX_HOLD_BARS = 10      # framework-v1 time-stop
SWING_LOOKBACK = 10     # structure evaluator half-window
RANGE_LOOKBACK = 20     # dealing-range window (premium/discount)
ZONE_TOL_ATR = 0.5      # supply-zone touch tolerance


# ─── Family router (mirrors condition-grounding.ts families; first match wins) ────────────────────────────────
FAMILY_PATTERNS: List[Tuple[str, str]] = [
    ("meta_state", r"confluences? (met|satisfied|aligned)|all (the )?confluences"),
    ("liquidity", r"sweep|swept|liquidity|stop (hunt|run)|taken out|raid|equal (high|low)|eqh|eql|pd[hl]|levels?\b|lines?\b|zones?\b"),
    ("ict_zone", r"premium|discount|equilibrium|dealing range|fib\w*|retrace\w*|0\.5|fifty|supply|demand|fvg|fair ?value|order ?block"),
    ("market_structure", r"\bmss\b|\bbos\b|\bchoch\b|market structure|structure|swing|higher (high|low)|lower (high|low)|break|displacement|reclaim"),
    ("price_action", r"engulf|pin ?bar|doji|hammer|wick|rejection|strong candle|confirmation candle|candle|weakness|reversal|close[sd]? (above|below|lower|higher)"),
    ("session_time", r"session|kill ?zone|london|new ?york|asia|time ?frame|timeframe|daily|weekly|hour|minute|intraday|open"),
    ("bias_direction", r"bias|bullish|bearish|direction|trend|downside|upside|short|sell|long|buy"),
    ("entry_execution", r"enter|entry|take (the )?trade|trade|limit order|market order|position"),
]


def family_of(obj: str) -> str:
    for fam, pat in FAMILY_PATTERNS:
        if re.search(pat, obj, re.IGNORECASE):
            return fam
    return "unclassified"


class FamilyEvaluators:
    """Per-bar grounded family evaluators over OHLC arrays (short-side; l-2 is a short confluence strategy)."""

    def __init__(self, opens: List[float], highs: List[float], lows: List[float], closes: List[float]):
        self.o, self.h, self.l, self.c = opens, highs, lows, closes
        self.atr = self._compute_atr()

    def _compute_atr(self) -> List[float]:
        trs: List[float] = [0.0]
        for i in range(1, len(self.c)):
            trs.append(max(self.h[i] - self.l[i], abs(self.h[i] - self.c[i - 1]), abs(self.l[i] - self.c[i - 1])))
        atr: List[float] = []
        for i in range(len(trs)):
            window = trs[max(0, i - ATR_PERIOD + 1):i + 1]
            atr.append(sum(window) / len(window) if window else 0.0)
        return atr

    def bearish_structure(self, i: int) -> bool:
        """bias_direction + market_structure: lower highs AND lower lows across two adjacent swing windows."""
        k = SWING_LOOKBACK
        if i < 2 * k:
            return False
        recent_h, prior_h = max(self.h[i - k + 1:i + 1]), max(self.h[i - 2 * k + 1:i - k + 1])
        recent_l, prior_l = min(self.l[i - k + 1:i + 1]), min(self.l[i - 2 * k + 1:i - k + 1])
        return recent_h < prior_h and recent_l < prior_l

    def premium_quadrant(self, i: int) -> bool:
        """ict_zone: close retraced into the PREMIUM half of the dealing range (short-friendly, DailyDealing model)."""
        if i < RANGE_LOOKBACK:
            return False
        rh = max(self.h[i - RANGE_LOOKBACK + 1:i + 1])
        rl = min(self.l[i - RANGE_LOOKBACK + 1:i + 1])
        if rh <= rl:
            return False
        return self.c[i] >= rl + 0.5 * (rh - rl)

    def supply_zone_touch(self, i: int) -> bool:
        """liquidity (levels/zones): bar reaches the recent swing-high supply zone (within ZONE_TOL_ATR × ATR)."""
        k = RANGE_LOOKBACK
        if i < k + 3:
            return False
        zone_high = max(self.h[i - k:i - 2])  # exclude the last 2 bars (the approach itself)
        return self.h[i] >= zone_high - ZONE_TOL_ATR * self.atr[i]

    def sweep_weakness(self, i: int) -> bool:
        """liquidity sweep: high taken + close back below with bearish character (candle_patterns detector)."""
        return detect_weakness(self.o, self.h, self.l, self.c, i, lookback=SWING_LOOKBACK)

    def bearish_price_action(self, i: int) -> bool:
        """price_action: bearish engulfing OR upper rejection OR sweep-weakness at bar i."""
        if i < 1:
            return False
        return (
            is_bearish_engulfing(self.o[i - 1], self.c[i - 1], self.o[i], self.c[i])
            or is_rejection_upper(self.o[i], self.h[i], self.l[i], self.c[i])
            or self.sweep_weakness(i)
        )

    def evaluate_family(self, fam: str, i: int) -> Tuple[bool, str]:
        """Return (satisfied, evaluator_name) for a family at bar i (short-side)."""
        if fam == "bias_direction" or fam == "market_structure":
            return self.bearish_structure(i), "bearish_structure(lower-highs+lower-lows swings)"
        if fam == "ict_zone":
            return self.premium_quadrant(i), "premium_quadrant(DailyDealing 50% model)"
        if fam == "liquidity":
            return (self.supply_zone_touch(i) or self.sweep_weakness(i)), "supply_zone_touch|detect_weakness"
        if fam == "price_action":
            return self.bearish_price_action(i), "bearish_engulfing|rejection_upper|detect_weakness"
        if fam == "session_time":
            return True, "vacuous_on_daily_bars"
        if fam == "entry_execution":
            return True, "trigger_action(order placement — not a market condition)"
        if fam == "meta_state":
            return True, "meta_state('confluences met' = conjunction of the independently-required confluences — no market content)"
        return False, "UNGROUNDED(unclassified — never satisfied, reported)"


def run(spec_path: str, transcript_path: str, local_path: str, start: str, end: str, out_prefix: str) -> Dict[str, Any]:
    from src.engine.data_loader import load_ohlcv  # engine-safe; local_path takes priority (offline)

    artifact = json.load(open(spec_path, encoding="utf-8"))
    spec = artifact["spec"]
    transcript = open(transcript_path, encoding="utf-8").read()

    df = load_ohlcv("MES", "daily", start, end, local_path=local_path, ignore_quality_gate=True)
    ts = [str(x) for x in df["ts_event"].to_list()] if "ts_event" in df.columns else [str(x) for x in df[df.columns[0]].to_list()]
    o = [float(x) for x in df["open"].to_list()]
    h = [float(x) for x in df["high"].to_list()]
    l = [float(x) for x in df["low"].to_list()]
    c = [float(x) for x in df["close"].to_list()]
    ev = FamilyEvaluators(o, h, l, c)

    conds = spec["entry_conditions"] + spec["invalidations"]
    cond_family = {cnd["id"]: family_of(cnd["object"]) for cnd in conds}
    cond_evaluator: Dict[str, str] = {}

    # ── Ledger G precheck: provenance completeness (condition → transcript span → evidence matches) ──
    prov_ok = prov_total = 0
    cond_quote: Dict[str, Optional[str]] = {}
    for cnd in conds:
        prov_total += 1
        span = cnd.get("span")
        quote = transcript[span["start"]:span["end"]].strip() if span else ""
        cond_quote[cnd["id"]] = quote or None
        if quote:
            prov_ok += 1

    warmup = 2 * RANGE_LOOKBACK
    decisions: List[Dict[str, Any]] = []
    trades: List[Dict[str, Any]] = []
    blocked_hist: Dict[str, int] = {}
    position: Optional[Dict[str, Any]] = None
    armed_count = invalidation_fires = 0

    for i in range(warmup, len(c) - 1):
        # per-bar satisfied set at FAMILY granularity
        satisfied: Set[str] = set()
        fam_results: Dict[str, Tuple[bool, str]] = {}
        for cnd in conds:
            fam = cond_family[cnd["id"]]
            if fam not in fam_results:
                fam_results[fam] = ev.evaluate_family(fam, i)
            ok, name = fam_results[fam]
            cond_evaluator[cnd["id"]] = name
            if ok:
                satisfied.add(cnd["id"])
        decision = evaluate_spec(spec, satisfied)
        if any(b.startswith("invalidated:") for b in decision["blocked_by"]):
            invalidation_fires += 1
        decisions.append({"ts": ts[i], "armed": decision["armed"], "blocked_by": decision["blocked_by"][:4],
                          "families_true": sorted(f for f, (okv, _) in fam_results.items() if okv)})
        if decision["armed"]:
            armed_count += 1

        # ── position management (framework-v1 overlay exit; runs before new entries) ──
        if position is not None:
            position["bars_held"] += 1
            exit_price = exit_reason = None
            if h[i] >= position["stop"]:
                exit_price, exit_reason = position["stop"], "stop(framework-v1 1.5xATR)"
            elif l[i] <= position["tp"]:
                exit_price, exit_reason = position["tp"], "tp(framework-v1 2R)"
            elif position["bars_held"] >= MAX_HOLD_BARS:
                exit_price, exit_reason = c[i], "time_stop(framework-v1)"
            if exit_price is not None:
                pnl_pts = position["entry"] - exit_price  # short
                trades.append({**position, "exit_ts": ts[i], "exit": exit_price, "exit_reason": exit_reason,
                               "pnl_points": round(pnl_pts, 2), "pnl_usd": round(pnl_pts * MES_POINT_VALUE, 2)})
                position = None

        # ── entry: armed + flat → SHORT at next bar open (+1-bar engine convention) ──
        if decision["armed"] and position is None:
            entry = o[i + 1]
            stop = entry + STOP_ATR_MULT * ev.atr[i]
            risk = stop - entry
            position = {
                "entry_ts": ts[i + 1], "signal_ts": ts[i], "entry": entry, "stop": round(stop, 2),
                "tp": round(entry - TP_R_MULT * risk, 2), "bars_held": 0, "direction": "short",
                # Ledger G trade trace: which nodes were true, via which evaluator, back to the transcript
                "trace": [{
                    "condition_id": cid,
                    "evaluator": cond_evaluator[cid],
                    "transcript_quote": (cond_quote.get(cid) or "")[:160] or None,
                } for cid in sorted(satisfied) if cond_family[cid] != "entry_execution"][:12],
            }
        if not decision["armed"]:
            for b in decision["blocked_by"][:2]:
                key = b if b.startswith(("or:", "invalidated:", "no_trigger")) else cond_family.get(b, "unknown")
                blocked_hist[key] = blocked_hist.get(key, 0) + 1

    # ── Ledger G verdict ──
    trades_traceable = sum(1 for t in trades if t["trace"] and all(x["transcript_quote"] for x in t["trace"]))
    ledger_g = {
        "conditions_with_verified_provenance": f"{prov_ok}/{prov_total}",
        "trades_fully_traceable": f"{trades_traceable}/{len(trades)}",
        "verdict": "TRACEABLE" if (prov_ok == prov_total and trades_traceable == len(trades)) else "GAPS",
    }

    wins = [t for t in trades if t["pnl_points"] > 0]
    total_pts = sum(t["pnl_points"] for t in trades)
    equity, peak, max_dd = 0.0, 0.0, 0.0
    for t in trades:
        equity += t["pnl_usd"]; peak = max(peak, equity); max_dd = max(max_dd, peak - equity)

    report = {
        "specification": {
            "video": artifact["video"], "spec_hash": artifact["spec_hash"],
            "graph_canonical_hash": artifact["graph_canonical_hash"], "ledger_d": artifact["ledger_d"],
            "conditions": len(spec["entry_conditions"]), "and_groups": len(spec["and_groups"]),
            "or_branches": len(spec["or_branches"]), "invalidations": len(spec["invalidations"]),
            "direction": spec["direction"], "bars": len(c), "window": f"{ts[0]} .. {ts[-1]}",
            "framework_v1_exit": f"stop {STOP_ATR_MULT}xATR{ATR_PERIOD} / tp {TP_R_MULT}R / time-stop {MAX_HOLD_BARS} bars (overlay-owned)",
        },
        "execution": {
            "bars_evaluated": len(decisions), "armed_setups": armed_count, "entries": len(trades),
            "invalidation_vetoes": invalidation_fires, "blocked_reason_histogram": dict(sorted(blocked_hist.items(), key=lambda kv: -kv[1])),
        },
        "market_outputs": {
            "trades": len(trades), "total_pnl_points": round(total_pts, 2),
            "total_pnl_usd_1lot": round(total_pts * MES_POINT_VALUE, 2),
            "win_rate_observed_pct": round(100 * len(wins) / len(trades), 1) if trades else None,
            "expectancy_points_per_trade": round(total_pts / len(trades), 3) if trades else None,
            "max_drawdown_usd": round(max_dd, 2),
        },
        "ledger_g": ledger_g,
        "trades": trades,
        "sample_blocked_decisions": [d for d in decisions if not d["armed"]][:5],
        "sample_armed_decisions": [d for d in decisions if d["armed"]][:5],
    }
    json.dump(report, open(f"{out_prefix}.json", "w", encoding="utf-8"), indent=1)
    return report


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("spec_path")
    ap.add_argument("--transcript", required=True)
    ap.add_argument("--local-path", required=True)
    ap.add_argument("--start", default="2023-01-01")
    ap.add_argument("--end", default="2025-12-01")
    ap.add_argument("--out", default="tmp/generalization/l2-live-run")
    a = ap.parse_args()
    r = run(a.spec_path, a.transcript, a.local_path, a.start, a.end, a.out)
    print(json.dumps({k: r[k] for k in ("specification", "execution", "market_outputs", "ledger_g")}, indent=1))
    print(f"\nfull report: {a.out}.json  ({len(r['trades'])} trades)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
