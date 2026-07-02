"""
SPEC EXECUTOR v2 (2026-07-02) — live execution of a compiled EngineStrategySpec on the educator's INTENDED
timeframe with a faithful Style-C-lite framework overlay + per-condition FUNNEL instrumentation.

v1 (committed 997ad65) proved the chain on daily bars with a placeholder exit; the operator + GPT review found
its two artifacts: (a) daily 1.5xATR stops = ~100 ES pts = $488/contract — an ILLEGAL trade under the production
framework (14-pt MES stop ceiling -> SKIP; sizing derives contracts FROM risk); (b) daily bars under-sample an
intraday educator's opportunity set by orders of magnitude. v2 fixes both and adds the funnel GPT specified:

  - TIMEFRAME: 15min ratio_adj bars (the educator executes on 4H bias + 15m entries — his own words).
    HTF BIAS: 15m bars resampled to true 4H aggregates; bearish-structure evaluated on the 4H series.
  - STYLE-C-LITE OVERLAY (faithful to CLAUDE.md S4, simplified partials):
      stop = max(1.5xATR15m, structural buffer)  |  CEILING 14 MES pts -> stop wider => SKIP TRADE (counted)
      3 units: TP1 @1R close 1/3 + stop->BE  |  TP2 @2R close 1/3  |  runner exits at BE-stop or 15:55 ET flatten
      RTH-only entries (09:30-15:30 ET) — the session_time family is now REAL, not vacuous.
      Sizing sanity is REPORTED in dollars (risk/trade at 3 MES must be sane vs a $1-2K personal DLL).
  - FUNNEL: per family {bars evaluated, times passed, pass rate} + sequential conjunction funnel showing exactly
    where candidate bars disappear (GPT: "that tells you exactly where trades disappear").
  - Unchanged from v1: grounded family evaluators -> the LEDGER-E-PROVEN evaluate_spec() -> +1-bar entries ->
    LEDGER G per-trade traces quoting the educator's verbatim transcript words.

Engine-safe imports only (data_loader + candle_patterns + spec_interpreter — never backtester/vectorbt).

Usage (tower):
  python -m src.engine.spec_executor tmp/generalization/l-2iKbcm5UI.spec.json \
      --transcript tmp/generalization/l-2iKbcm5UI.transcript.txt \
      --local-path <ES ratio_adj 15min parquet> --timeframe 15min --start 2023-01-01 --end 2026-02-28
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
    is_bullish_engulfing,
    is_rejection_lower,
    is_rejection_upper,
)
from src.engine.spec_interpreter import evaluate_spec

MES_POINT_VALUE = 5.0
UNITS = 3                      # Style-C-lite 3 units (1/3 TP1, 1/3 TP2, 1/3 runner)
ATR_PERIOD = 14
STOP_ATR_MULT = 1.5            # S4 floor: 1.5 x exec-TF ATR
STOP_CEILING_PTS = 14.0        # S4 MES ceiling — wider structural stop => SKIP TRADE
SWING_LOOKBACK = 10            # swing half-window (per aggregated-TF bar)
RANGE_LOOKBACK = 20            # dealing-range window (exec TF)
ZONE_TOL_ATR = 0.5
BARS_PER_4H = 16               # 16 x 15m = 4H
RTH_ENTRY = ("09:30", "15:30")  # entry window ET
FLATTEN_ET = "15:55"           # hard EOD flatten (framework invariant)


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


def hhmm(ts: str) -> str:
    return ts[11:16]


def day_of(ts: str) -> str:
    return ts[:10]


class FamilyEvaluators:
    """Grounded per-bar family evaluators (short-side). 4H bias from resampled aggregates; exec confluences on 15m."""

    def __init__(self, ts: List[str], o: List[float], h: List[float], l: List[float], c: List[float], intraday: bool):
        self.ts, self.o, self.h, self.l, self.c, self.intraday = ts, o, h, l, c, intraday
        self.atr = self._atr(h, l, c)
        # ── true 4H resample for HTF bias (educator's top-down: 4H structure, 15m execution) ──
        if intraday:
            n4 = len(c) // BARS_PER_4H
            self.h4 = [max(h[k * BARS_PER_4H:(k + 1) * BARS_PER_4H]) for k in range(n4)]
            self.l4 = [min(l[k * BARS_PER_4H:(k + 1) * BARS_PER_4H]) for k in range(n4)]
        else:
            self.h4, self.l4 = h, l

    @staticmethod
    def _atr(h: List[float], l: List[float], c: List[float]) -> List[float]:
        atr: List[float] = [0.0]
        prev = h[0] - l[0]
        for i in range(1, len(c)):
            tr = max(h[i] - l[i], abs(h[i] - c[i - 1]), abs(l[i] - c[i - 1]))
            prev = prev + (tr - prev) / ATR_PERIOD  # Wilder-style running ATR (O(1)/bar)
            atr.append(prev)
        return atr

    def structure_4h(self, i: int, side: int) -> bool:
        """bias/market_structure on the 4H series: short=lower highs+lower lows; long=higher highs+higher lows."""
        j = (i // BARS_PER_4H) if self.intraday else i
        k = SWING_LOOKBACK
        if j < 2 * k:
            return False
        rh, ph = max(self.h4[j - k + 1:j + 1]), max(self.h4[j - 2 * k + 1:j - k + 1])
        rl, pl = min(self.l4[j - k + 1:j + 1]), min(self.l4[j - 2 * k + 1:j - k + 1])
        return (rh < ph and rl < pl) if side < 0 else (rh > ph and rl > pl)

    def quadrant(self, i: int, side: int) -> bool:
        """ict_zone: short=retrace into PREMIUM half; long=retrace into DISCOUNT half (DailyDealing model)."""
        if i < RANGE_LOOKBACK:
            return False
        rh = max(self.h[i - RANGE_LOOKBACK + 1:i + 1])
        rl = min(self.l[i - RANGE_LOOKBACK + 1:i + 1])
        if rh <= rl:
            return False
        mid = rl + 0.5 * (rh - rl)
        return self.c[i] >= mid if side < 0 else self.c[i] <= mid

    def zone_or_sweep(self, i: int, side: int) -> bool:
        """liquidity: short=supply-zone touch or sweep-weakness; long=demand-zone touch or sweep-strength."""
        k = RANGE_LOOKBACK
        if i < k + 3:
            return False
        if side < 0:
            zone_high = max(self.h[i - k:i - 2])
            touched = self.h[i] >= zone_high - ZONE_TOL_ATR * self.atr[i]
            return touched or detect_weakness(self.o, self.h, self.l, self.c, i, lookback=SWING_LOOKBACK)
        zone_low = min(self.l[i - k:i - 2])
        touched = self.l[i] <= zone_low + ZONE_TOL_ATR * self.atr[i]
        return touched or detect_strength(self.o, self.h, self.l, self.c, i, lookback=SWING_LOOKBACK)

    def side_price_action(self, i: int, side: int) -> bool:
        if i < 1:
            return False
        if side < 0:
            return (
                is_bearish_engulfing(self.o[i - 1], self.c[i - 1], self.o[i], self.c[i])
                or is_rejection_upper(self.o[i], self.h[i], self.l[i], self.c[i])
                or detect_weakness(self.o, self.h, self.l, self.c, i, lookback=SWING_LOOKBACK)
            )
        return (
            is_bullish_engulfing(self.o[i - 1], self.c[i - 1], self.o[i], self.c[i])
            or is_rejection_lower(self.o[i], self.h[i], self.l[i], self.c[i])
            or detect_strength(self.o, self.h, self.l, self.c, i, lookback=SWING_LOOKBACK)
        )

    def in_rth_entry_window(self, i: int) -> bool:
        if not self.intraday:
            return True
        t = hhmm(self.ts[i])
        return RTH_ENTRY[0] <= t < RTH_ENTRY[1]

    def evaluate_family(self, fam: str, i: int, side: int = -1) -> Tuple[bool, str]:
        tag = "short" if side < 0 else "long"
        if fam in ("bias_direction", "market_structure"):
            return self.structure_4h(i, side), f"structure_4h[{tag}](4H swings)"
        if fam == "ict_zone":
            return self.quadrant(i, side), f"quadrant[{tag}](DailyDealing 50% model)"
        if fam == "liquidity":
            return self.zone_or_sweep(i, side), f"zone_touch|sweep[{tag}]"
        if fam == "price_action":
            return self.side_price_action(i, side), f"price_action[{tag}]"
        if fam == "session_time":
            if self.intraday:
                return self.in_rth_entry_window(i), "rth_entry_window(09:30-15:30 ET)"
            return True, "vacuous_on_daily_bars"
        if fam == "entry_execution":
            return True, "trigger_action(order placement — not a market condition)"
        if fam == "meta_state":
            return True, "meta_state('confluences met' = conjunction of the required confluences)"
        return False, "UNGROUNDED(unclassified — never satisfied, reported)"

def _eval_family(ev: FamilyEvaluators, fam: str, i: int, side: int = -1) -> Tuple[bool, str]:
    return ev.evaluate_family(fam, i, side)


def run(spec_path: str, transcript_path: str, local_path: str, timeframe: str, start: str, end: str, out_prefix: str) -> Dict[str, Any]:
    from src.engine.data_loader import load_ohlcv

    artifact = json.load(open(spec_path, encoding="utf-8"))
    spec = artifact["spec"]
    transcript = open(transcript_path, encoding="utf-8").read()
    intraday = timeframe != "daily"

    df = load_ohlcv("MES", timeframe, start, end, local_path=local_path, ignore_quality_gate=True)
    ts = [str(x) for x in df["ts_event"].to_list()]
    o = [float(x) for x in df["open"].to_list()]
    h = [float(x) for x in df["high"].to_list()]
    l = [float(x) for x in df["low"].to_list()]
    c = [float(x) for x in df["close"].to_list()]
    ev = FamilyEvaluators(ts, o, h, l, c, intraday)

    conds = spec["entry_conditions"] + spec["invalidations"]
    cond_family = {cnd["id"]: family_of(cnd["object"]) for cnd in conds}
    families = sorted({f for f in cond_family.values()})
    market_fams = [f for f in ("bias_direction", "market_structure", "ict_zone", "liquidity", "price_action", "session_time") if f in families]

    # Ledger G provenance (span is ground truth; quotes = transcript slices)
    prov_ok = prov_total = 0
    cond_quote: Dict[str, Optional[str]] = {}
    for cnd in conds:
        prov_total += 1
        span = cnd.get("span")
        quote = transcript[span["start"]:span["end"]].strip() if span else ""
        cond_quote[cnd["id"]] = quote or None
        if quote:
            prov_ok += 1

    warmup = max(2 * SWING_LOOKBACK * (BARS_PER_4H if intraday else 1), 2 * RANGE_LOOKBACK)
    funnel_eval: Dict[str, int] = {f: 0 for f in market_fams}
    funnel_pass: Dict[str, int] = {f: 0 for f in market_fams}
    seq_order = [f for f in ("session_time", "bias_direction", "ict_zone", "liquidity", "price_action") if f in market_fams]
    seq_pass: Dict[str, int] = {f: 0 for f in seq_order}
    seq_total = 0

    trades: List[Dict[str, Any]] = []
    position: Optional[Dict[str, Any]] = None
    armed_count = skipped_ceiling = 0
    sample_armed: List[Dict[str, Any]] = []

    for i in range(warmup, len(c) - 1):
        # evaluate BOTH sides (spec direction=both — production bidirectional convention)
        side_results: Dict[int, Dict[str, Tuple[bool, str]]] = {}
        side_decision: Dict[int, Dict[str, Any]] = {}
        for side in (-1, 1):
            fr = {fam: _eval_family(ev, fam, i, side) for fam in families}
            side_results[side] = fr
            side_decision[side] = evaluate_spec(spec, {cid for cid, fam in cond_family.items() if fr[fam][0]})
        # funnel instrumentation counts EITHER-side passes (bidirectional opportunity set)
        for fam in market_fams:
            funnel_eval[fam] += 1
            if side_results[-1][fam][0] or side_results[1][fam][0]:
                funnel_pass[fam] += 1
        seq_total += 1
        cum = True
        for fam in seq_order:
            cum = cum and (side_results[-1][fam][0] or side_results[1][fam][0])
            if cum:
                seq_pass[fam] += 1

        armed_short = side_decision[-1]["armed"]
        armed_long = side_decision[1]["armed"]
        arm_side = 0
        if armed_short != armed_long:  # both-armed = conflicting read -> stand aside
            arm_side = -1 if armed_short else 1
        if arm_side != 0:
            armed_count += 1
        fam_results = side_results[arm_side if arm_side != 0 else -1]
        satisfied: Set[str] = {cid for cid, fam in cond_family.items() if fam_results[fam][0]}

        # ── Style-C-lite position management (runs every bar) ──
        if position is not None:
            p = position
            sgn = p["sgn"]
            exit_now: List[Tuple[float, int, str]] = []  # (price, units, reason)
            stop_hit = h[i] >= p["stop"] if sgn < 0 else l[i] <= p["stop"]
            tp1_hit = (l[i] <= p["tp1"]) if sgn < 0 else (h[i] >= p["tp1"])
            tp2_hit = (l[i] <= p["tp2"]) if sgn < 0 else (h[i] >= p["tp2"])
            if stop_hit:
                exit_now.append((p["stop"], p["units_left"], f"stop({'BE' if p['be'] else '1.5xATR'})"))
            else:
                if not p["tp1_done"] and tp1_hit:
                    exit_now.append((p["tp1"], 1, "tp1(1R, stop->BE)"))
                if not p["tp2_done"] and tp2_hit:
                    exit_now.append((p["tp2"], 1, "tp2(2R)"))
            eod = intraday and hhmm(ts[i]) >= FLATTEN_ET
            if eod and p["units_left"] > 0 and not exit_now:
                exit_now.append((c[i], p["units_left"], "eod_flatten(15:55 ET)"))
            for price, units, reason in exit_now:
                units = min(units, p["units_left"])
                if units <= 0:
                    continue
                pnl = (price - p["entry"]) * p["sgn"] * units
                p["fills"].append({"ts": ts[i], "price": round(price, 2), "units": units, "reason": reason,
                                   "pnl_points": round(pnl, 2)})
                p["pnl_points"] += pnl
                p["units_left"] -= units
                if reason.startswith("tp1"):
                    p["tp1_done"], p["be"], p["stop"] = True, True, p["entry"]
                if reason.startswith("tp2"):
                    p["tp2_done"] = True
            if p["units_left"] <= 0:
                p["exit_ts"] = ts[i]
                p["pnl_usd"] = round(p["pnl_points"] * MES_POINT_VALUE, 2)
                p["pnl_points"] = round(p["pnl_points"], 2)
                trades.append(p)
                position = None

        # ── entry: armed + flat + RTH window → SHORT next bar open; S4 CEILING gate ──
        if arm_side != 0 and position is None and ev.in_rth_entry_window(i):
            sgn = arm_side
            stop_dist = STOP_ATR_MULT * ev.atr[i]
            if stop_dist > STOP_CEILING_PTS:
                skipped_ceiling += 1
            else:
                entry = o[i + 1]
                position = {
                    "signal_ts": ts[i], "entry_ts": ts[i + 1], "entry": entry,
                    "direction": "short" if sgn < 0 else "long", "sgn": sgn,
                    "stop": round(entry - sgn * stop_dist, 2), "risk_points": round(stop_dist, 2),
                    "risk_usd_3lots": round(stop_dist * MES_POINT_VALUE * UNITS, 2),
                    "tp1": round(entry + sgn * stop_dist, 2), "tp2": round(entry + sgn * 2 * stop_dist, 2),
                    "tp1_done": False, "tp2_done": False, "be": False,
                    "units_left": UNITS, "pnl_points": 0.0, "fills": [],
                    "trace": [{"condition_id": cid, "evaluator": fam_results[cond_family[cid]][1],
                               "transcript_quote": (cond_quote.get(cid) or "")[:160] or None}
                              for cid in sorted(satisfied)
                              if cond_family[cid] not in ("entry_execution", "meta_state")][:10],
                }
                if len(sample_armed) < 3:
                    sample_armed.append({"ts": ts[i], "families_true": sorted(f for f in market_fams if fam_results[f][0])})

    trades_traceable = sum(1 for t in trades if t["trace"] and all(x["transcript_quote"] for x in t["trace"]))
    wins = [t for t in trades if t["pnl_points"] > 0]
    total_pts = sum(t["pnl_points"] for t in trades)
    equity = peak = max_dd = 0.0
    for t in trades:
        equity += t["pnl_usd"]; peak = max(peak, equity); max_dd = max(max_dd, peak - equity)
    risks = [t["risk_usd_3lots"] for t in trades]

    report = {
        "specification": {
            "video": artifact["video"], "spec_hash": artifact["spec_hash"],
            "graph_canonical_hash": artifact["graph_canonical_hash"], "ledger_d": artifact["ledger_d"],
            "conditions": len(spec["entry_conditions"]), "and_groups": len(spec["and_groups"]),
            "timeframe": timeframe, "bars": len(c), "window": f"{ts[0]} .. {ts[-1]}",
            "overlay": f"Style-C-lite: stop 1.5xATR({timeframe}) CEILING {STOP_CEILING_PTS}pt->SKIP | 3 units TP1@1R(BE)/TP2@2R/runner | RTH entries | 15:55 flatten",
        },
        "funnel": {
            "per_family": {f: {"evaluated": funnel_eval[f], "passed": funnel_pass[f],
                               "pass_rate_pct": round(100 * funnel_pass[f] / max(1, funnel_eval[f]), 1)}
                           for f in market_fams},
            "sequential_conjunction": [{"stage": f, "bars_surviving": seq_pass[f],
                                        "pct_of_all": round(100 * seq_pass[f] / max(1, seq_total), 2)}
                                       for f in seq_order],
            "bars_total": seq_total,
        },
        "execution": {
            "armed_setups": armed_count, "entries": len(trades),
            "skipped_by_stop_ceiling": skipped_ceiling,
        },
        "market_outputs": {
            "trades": len(trades),
            "total_pnl_points_3lots": round(total_pts, 2),
            "total_pnl_usd_3lots": round(total_pts * MES_POINT_VALUE, 2),
            "win_rate_observed_pct": round(100 * len(wins) / len(trades), 1) if trades else None,
            "expectancy_points_per_trade": round(total_pts / len(trades), 3) if trades else None,
            "max_drawdown_usd": round(max_dd, 2),
            "risk_per_trade_usd_3lots": {"min": min(risks) if risks else None, "max": max(risks) if risks else None,
                                          "avg": round(sum(risks) / len(risks), 2) if risks else None},
            "by_direction": {d: {
                "trades": len([t for t in trades if t["direction"] == d]),
                "pnl_points": round(sum(t["pnl_points"] for t in trades if t["direction"] == d), 2),
                "win_rate_pct": round(100 * len([t for t in trades if t["direction"] == d and t["pnl_points"] > 0])
                                      / max(1, len([t for t in trades if t["direction"] == d])), 1),
            } for d in ("short", "long")},
        },
        "ledger_g": {
            "conditions_with_verified_provenance": f"{prov_ok}/{prov_total}",
            "trades_fully_traceable": f"{trades_traceable}/{len(trades)}",
            "verdict": "TRACEABLE" if (prov_ok == prov_total and trades_traceable == len(trades)) else "GAPS",
        },
        "sample_armed": sample_armed,
        "trades": trades[:200],
    }
    json.dump(report, open(f"{out_prefix}.json", "w", encoding="utf-8"), indent=1)
    return report


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("spec_path")
    ap.add_argument("--transcript", required=True)
    ap.add_argument("--local-path", required=True)
    ap.add_argument("--timeframe", default="15min")
    ap.add_argument("--start", default="2023-01-01")
    ap.add_argument("--end", default="2026-02-28")
    ap.add_argument("--out", default="tmp/generalization/l2-live-run-v2")
    a = ap.parse_args()
    r = run(a.spec_path, a.transcript, a.local_path, a.timeframe, a.start, a.end, a.out)
    print(json.dumps({k: r[k] for k in ("specification", "funnel", "execution", "market_outputs", "ledger_g")}, indent=1))
    print(f"\nfull report: {a.out}.json  ({r['market_outputs']['trades']} trades)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
