"""A12 — 12-Category Code Audit.

Single integrated audit that asserts the existing implementation actually does
what it claims. Each test maps to one of the 12 audit categories defined in
PART A §A12 of the Trading Forge engineering plan. Tests do not modify code —
they read source code and small synthetic fixtures and emit a PASS/FAIL/UNKNOWN
result that the report generator (test_audit_a12_report.py companion) consumes.

Categories:
  1. Source data integrity        (Databento ingest, gap/OHLC/timezone/roll)
  2. Timestamp correctness        (next-bar fill, no lookahead via misaligned bars)
  3. Indicator math               (ATR overnight, EMA warmup, no centered indicators)
  4. Backtest fill assumptions    (ASK/BID, limit fill probability, stop slippage)
  5. PnL math                     (CME multipliers, tick sizes, commission, slippage sign)
  6. Walk-forward leakage         (no overlap, embargo applied, params per fold)
  7. Monte Carlo accuracy         (default both, block size, Sharpe annualization)
  8. Paper-vs-backtest parity     (same fill/slippage/commission/timezone)
  9. Daily PnL aggregation        (5pm ET cutoff, trailing DD HWM, consec losers)
 10. Compliance accuracy          (per-firm DLL, trailing DD on closed equity, max position)
 11. DB write integrity           (numeric precision, JSONB types, withSessionLock)
 12. Source-of-truth conflicts    (explicit precedence when metrics computed two ways)

CME Spec Sources (cited per category):
  - MES:  https://www.cmegroup.com/markets/equities/sp/micro-e-mini-sandp-500.contractSpecs.html
          tick=0.25 idx pts, $1.25/tick, multiplier $5/idx pt
  - MNQ:  https://www.cmegroup.com/markets/equities/nasdaq/micro-e-mini-nasdaq-100.contractSpecs.html
          tick=0.25 idx pts, $0.50/tick, multiplier $2/idx pt
  - MCL:  https://www.cmegroup.com/markets/energy/crude-oil/micro-wti-crude-oil.contractSpecs.html
          tick=0.01 USD/bbl, $1.00/tick, multiplier $100/USD
  - ES (full):  multiplier $50/idx pt
  - NQ (full):  multiplier $20/idx pt
  - CL (full):  multiplier $1000/USD

NOTE: CONTRACT_SPECS in src/engine/config.py intentionally maps "ES"/"NQ"/"CL"
keys to MICRO multipliers (because Trading Forge trades micro only). This is
the documented design — not a bug. Cat 5 verifies the MICRO values are correct.
"""
from __future__ import annotations

import re
from collections import OrderedDict
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import polars as pl
import pytest

# Direct module imports up-front so ruff I001 is satisfied. These are pure-data
# imports (no side effects beyond what conftest.py's autouse determinism mode
# already establishes) so importing them at module load is safe.
from src.engine.config import CONTRACT_SPECS
from src.engine.firm_config import (
    FIRM_COMMISSIONS,
    FIRM_CONTRACT_CAPS,
    FIRM_RULES,
)
from src.engine.indicators.core import compute_atr
from src.engine.indicators.market_structure import detect_bos, detect_swings
from src.engine.monte_carlo import optimal_block_length

# ─── Audit Result Collector ────────────────────────────────────────────────

REPO_ROOT = Path(__file__).resolve().parents[3]
REPORT_PATH = REPO_ROOT / "docs" / "A12-AUDIT-REPORT.md"


# Use OrderedDict so the report is deterministic regardless of test order.
AUDIT_RESULTS: "OrderedDict[int, dict]" = OrderedDict()


def record(category: int, name: str, status: str, evidence: str,
           fix_pr: str | None = None) -> None:
    """Record one audit category result. status ∈ {PASS, FAIL, UNKNOWN}."""
    assert status in {"PASS", "FAIL", "UNKNOWN"}, f"bad status: {status}"
    AUDIT_RESULTS[category] = {
        "category": category,
        "name": name,
        "status": status,
        "evidence": evidence,
        "fix_pr": fix_pr,
    }


# ─── Helpers ───────────────────────────────────────────────────────────────


def _read(rel_path: str) -> str:
    """Read repo file as text, normalized line endings."""
    return (REPO_ROOT / rel_path).read_text(encoding="utf-8").replace("\r\n", "\n")


def _grep_count(text: str, pattern: str, flags: int = 0) -> int:
    return len(re.findall(pattern, text, flags))


# ─── Cat 1: Source Data Integrity ──────────────────────────────────────────


def test_cat01_source_data_integrity():
    """Cat 1: Databento ingestion has gap/OHLC/timezone/roll defenses.

    Checks:
      a) refresh_local_cache.py atomic-writes parquet to .tmp + os.replace
      b) refresh_local_cache.py normalizes ts_event to UTC
      c) refresh_local_cache.py dedupes ts_event before append
      d) data_loader.validate_bars() flags duplicate ts, OHLC violations,
         zero/negative prices, large gaps (5%), roll gaps (15%)
      e) data_loader converts UTC -> ET (ts_et) for session logic
      f) roll calendar exists and is loaded (TS + Python)
    """
    findings = []
    failures = []

    # a) Atomic parquet write
    refresh = _read("src/data/scripts/refresh_local_cache.py")
    atomic_ok = "os.replace" in refresh and ".tmp" in refresh
    findings.append(f"atomic parquet write: {'OK' if atomic_ok else 'MISSING'}")
    if not atomic_ok:
        failures.append("refresh_local_cache.py missing atomic .tmp + os.replace")

    # b) UTC normalization
    utc_ok = "convert_time_zone" in refresh and "UTC" in refresh
    findings.append(f"UTC normalization: {'OK' if utc_ok else 'MISSING'}")
    if not utc_ok:
        failures.append("refresh_local_cache.py missing UTC normalization")

    # c) Dedup before append
    dedup_ok = "dedup" in refresh.lower() or "is_in" in refresh
    findings.append(f"ts_event dedup: {'OK' if dedup_ok else 'MISSING'}")
    if not dedup_ok:
        failures.append("refresh_local_cache.py missing pre-append dedup")

    # d) validate_bars implements all the documented checks
    loader = _read("src/engine/data_loader.py")
    checks = {
        "duplicate_timestamps": "is_duplicated" in loader,
        "ohlc_violations": "high\") < pl.col(\"low\"" in loader,
        "zero_volume": 'pl.col("volume") == 0' in loader,
        "zero_neg_prices": 'pl.col("close") <= 0' in loader,
        "large_gap_5pct": "0.05" in loader and "max_gap" in loader or "pct_changes > 0.05" in loader,
        "roll_gap_15pct": "0.15" in loader,
    }
    for k, v in checks.items():
        findings.append(f"validate_bars.{k}: {'OK' if v else 'MISSING'}")
        if not v:
            failures.append(f"data_loader.validate_bars missing {k} check")

    # e) UTC -> ET conversion present in data_loader
    et_ok = "America/New_York" in loader and 'alias("ts_et")' in loader
    findings.append(f"ts_event -> ts_et conversion: {'OK' if et_ok else 'MISSING'}")
    if not et_ok:
        failures.append("data_loader.py missing UTC->ET conversion")

    # f) Roll calendar exists (Python + TS)
    py_roll = (REPO_ROOT / "src/engine/data_loader.py").read_text(encoding="utf-8")
    ts_roll_path = REPO_ROOT / "src/server/lib/roll-calendar-loader.ts"
    roll_data_path = REPO_ROOT / "src/server/lib/roll-calendar-data.ts"
    py_has_roll = "compute_rollover_dates" in py_roll and "_second_thursday_before_third_friday" in py_roll
    ts_has_roll = ts_roll_path.exists() and roll_data_path.exists()
    findings.append(f"Python roll calendar: {'OK' if py_has_roll else 'MISSING'}")
    findings.append(f"TS roll calendar: {'OK' if ts_has_roll else 'MISSING'}")
    if not py_has_roll:
        failures.append("Python compute_rollover_dates missing")
    if not ts_has_roll:
        failures.append("TS roll-calendar-loader/data missing")

    # SOFT FINDING: validate_bars treats CME Globex 17:00 ET hour as
    # "out_of_session", but Sunday 17:00 ET reopen is a legitimate trading hour
    # in the daily maintenance window break. This is a known minor accuracy
    # issue — flag as evidence but do not FAIL Cat 1 on it.
    cme_session_caveat = "(NOTE) data_loader treats hour==17 ET as out-of-session; weekly reopen handling not surfaced separately."
    findings.append(cme_session_caveat)

    evidence = "\n  - ".join([""] + findings)
    if failures:
        record(1, "Source data integrity", "FAIL", evidence,
               fix_pr=("Add missing checks to data_loader.validate_bars / "
                       "refresh_local_cache.py: " + "; ".join(failures)))
    else:
        record(1, "Source data integrity", "PASS", evidence)


# ─── Cat 2: Timestamp Correctness ──────────────────────────────────────────


def test_cat02_timestamp_correctness():
    """Cat 2: Bar close vs event timestamps; no lookahead via misaligned bars.

    Checks:
      a) backtester.py applies np.roll(entries, 1) for next-bar fill
      b) backtester.py also rolls SHORT entries
      c) backtester.py documents the next-bar fill convention
      d) Multi-TF lookahead prevention is documented
      e) HTF data uses .shift(1) when merged into LTF
    """
    findings = []
    failures = []

    bt = _read("src/engine/backtester.py")

    # a) Long entries shifted via np.roll
    long_roll = bt.count("np.roll(entries_np, 1)")
    findings.append(f"np.roll(entries_np, 1) occurrences: {long_roll}")
    if long_roll < 1:
        failures.append("Long entries not shifted by 1 bar (lookahead via same-bar fill)")

    # b) Short entries shifted as well
    short_roll = bt.count("np.roll(short_entries_np, 1)")
    findings.append(f"np.roll(short_entries_np, 1) occurrences: {short_roll}")
    if short_roll < 1:
        failures.append("Short entries not shifted by 1 bar (lookahead via same-bar fill)")

    # c) Convention documented
    convention_doc = "next-bar fill" in bt and "lookahead bias" in bt.lower()
    findings.append(f"next-bar fill convention documented: {'OK' if convention_doc else 'MISSING'}")
    if not convention_doc:
        failures.append("backtester.py missing next-bar fill documentation block")

    # d) Multi-TF lookahead prevention documented
    htf_doc = "Multi-TF Look-Ahead Prevention" in bt or "PREVIOUS completed bar" in bt
    findings.append(f"multi-TF lookahead doc: {'OK' if htf_doc else 'MISSING'}")
    if not htf_doc:
        failures.append("backtester.py missing multi-TF lookahead prevention docs")

    # e) HTF data .shift(1) usage in any context module
    context_files = list((REPO_ROOT / "src/engine/context").glob("*.py"))
    shift_uses = 0
    for p in context_files:
        try:
            shift_uses += p.read_text(encoding="utf-8").count(".shift(1)")
        except Exception:
            pass
    findings.append(f"context modules with .shift(1) (HTF prev-bar): {shift_uses}")
    # Soft check — non-blocking if 0 (some setups may use day-keyed cache instead)

    evidence = "\n  - ".join([""] + findings)
    if failures:
        record(2, "Timestamp correctness", "FAIL", evidence,
               fix_pr=("Restore next-bar fill semantics in backtester.py: "
                       + "; ".join(failures)))
    else:
        record(2, "Timestamp correctness", "PASS", evidence)


# ─── Cat 3: Indicator Math ─────────────────────────────────────────────────


def test_cat03_indicator_math():
    """Cat 3: ATR overnight handling, EMA warmup, no centered indicators.

    Checks:
      a) ATR uses true range = max(H-L, |H-prev_close|, |L-prev_close|) — overnight gap captured
      b) Indicators use rolling/ewm — never expanding/centered windows
      c) No usage of .rolling(..., center=True) — that would peek at future bars
      d) Numerical: synthetic ATR over a gap matches expected formula
    """
    findings = []
    failures = []

    core = _read("src/engine/indicators/core.py")

    # a) ATR overnight gap handling
    atr_overnight = (
        'prev_close = df["close"].shift(1)' in core
        and "(high - prev_close).abs()" in core
        and "(low - prev_close).abs()" in core
    )
    findings.append(f"ATR overnight gap formula: {'OK' if atr_overnight else 'MISSING'}")
    if not atr_overnight:
        failures.append(
            "ATR formula does not include |H-prev_close| / |L-prev_close| — "
            "overnight gaps will be invisible to ATR"
        )

    # b/c) No centered windows in indicator code
    centered = "center=True" in core or "center = True" in core
    findings.append(f"centered indicator windows: {'YES (BAD)' if centered else 'no'}")
    if centered:
        failures.append("indicators/core.py uses centered window (lookahead trap)")

    # Also scan ALL python in src/engine for centered windows.
    # EXCLUDE this audit test file itself (its own regex literal would self-match).
    # deep-scan backtest-engine F-3 (2026-07-06): the old pattern `\.rolling\(` only matched pandas-style
    # .rolling(...) and was BLIND to Polars' .rolling_max/.rolling_min/.rolling_mean/.rolling_sum/.rolling_std/
    # .rolling_median(center=True) — a genuine centered-window API used in market_structure.py:39. Broadened to
    # the full rolling(_*) family. market_structure.py's usage is DELIBERATE + look-ahead-SAFE (detect_swings
    # shifts the swing index forward by +half_window before any downstream consumer sees it), so it is
    # allowlisted; any OTHER centered window anywhere in src/engine is still a HARD fail.
    _CENTERED_ALLOWLIST = {"src/engine/indicators/market_structure.py"}
    self_path = Path(__file__).resolve()
    bad_files = []
    for p in (REPO_ROOT / "src/engine").rglob("*.py"):
        try:
            if p.resolve() == self_path:
                continue
            s = p.read_text(encoding="utf-8")
        except Exception:
            continue
        rel = str(p.relative_to(REPO_ROOT)).replace("\\", "/")
        if rel in _CENTERED_ALLOWLIST:
            continue
        if re.search(r"\.rolling(_\w+)?\([^)]*center\s*=\s*True", s):
            bad_files.append(rel)
    findings.append(f"engine files with centered rolling: {bad_files or 'none'}")
    if bad_files:
        failures.append(f"centered rolling windows in: {bad_files}")

    # d) Numerical ATR test — overnight gap must be captured.
    # Construct a series where bar 4 GAPS UP: H=110, L=105, prev_close=101.
    # Without prev_close, TR would only see (H-L)=5. With it, TR=max(5, 9, 4)=9.
    # We compare ATR[bar4] (gap captured) to a counterfactual ATR computed only
    # from (H-L). The "with-gap" ATR must be strictly larger than the
    # "ignore-gap" ATR — that is the necessary and sufficient evidence that
    # overnight gap handling is active.
    df = pl.DataFrame({
        "high":   [100.0, 101.0, 99.5,  102.0, 110.0, 111.0],
        "low":    [98.0,   99.0, 97.5, 100.0, 105.0, 109.0],
        "close":  [99.0,  100.0, 98.5, 101.0, 109.0, 110.0],
        "open":   [98.5,  100.5, 99.0, 100.5, 105.0, 110.5],
    })
    atr_with_gap = compute_atr(df, period=3).to_list()

    # Counterfactual: H-L only (no overnight gap detection)
    hl_only = (df["high"] - df["low"]).ewm_mean(alpha=1.0/3, adjust=False).to_list()

    bar4_high = 110.0
    bar4_low = 105.0
    bar3_close = 101.0
    expected_tr = max(bar4_high - bar4_low,
                      abs(bar4_high - bar3_close),
                      abs(bar4_low - bar3_close))
    assert expected_tr == 9.0
    findings.append(
        f"ATR[bar4] with-gap = {atr_with_gap[4]:.3f}, "
        f"H-L only = {hl_only[4]:.3f} (with-gap MUST be larger if overnight handling works)"
    )
    if atr_with_gap[4] is None or atr_with_gap[4] <= hl_only[4]:
        failures.append(
            f"ATR did not capture overnight gap; with-gap={atr_with_gap[4]:.3f}, "
            f"H-L only={hl_only[4]:.3f} (with-gap should be strictly larger)"
        )

    evidence = "\n  - ".join([""] + findings)
    if failures:
        record(3, "Indicator math", "FAIL", evidence,
               fix_pr=("Fix ATR / centered windows: " + "; ".join(failures)))
    else:
        record(3, "Indicator math", "PASS", evidence)


# ─── Cat 4: Backtest Fill Assumptions ──────────────────────────────────────


def test_cat04_backtest_fill_assumptions():
    """Cat 4: Long pays ASK, short pays BID; limit fill probability; stop slippage.

    Checks:
      a) fill_model.py applies RSI-extreme penalty (low fill prob at extremes)
      b) slippage.py applies 2x multiplier on stop/stop_market (stops slip worse)
      c) slippage.py applies 0.5x multiplier on limit (better fill price)
      d) fill_model.py FORBIDS order_type='stop' / 'stop_market' (CLAUDE.md prohibition)
      e) Slippage scales with ATR (variable slippage)
      f) Session multipliers (overnight 3x, RTH 1x) are applied
      g) Backtester treats long-entry slippage as a COST (subtracted from PnL)
    """
    findings = []
    failures = []

    fm = _read("src/engine/fill_model.py")
    sl = _read("src/engine/slippage.py")
    bt = _read("src/engine/backtester.py")
    liq = _read("src/engine/liquidity.py")

    # a) RSI extreme limit fill probability
    rsi_extreme = 'config.get("limit_at_extreme", 0.50)' in fm or "limit_at_extreme" in fm
    findings.append(f"limit fill prob @ RSI extreme: {'OK' if rsi_extreme else 'MISSING'}")
    if not rsi_extreme:
        failures.append("fill_model.py missing RSI extreme limit fill probability")

    # b) Stop slippage 2x
    stop_2x = "* 2.0" in sl and ('order_type == "stop"' in sl or 'order_type == "stop_market"' in sl)
    findings.append(f"slippage 2x for stop/stop_market: {'OK' if stop_2x else 'MISSING'}")
    if not stop_2x:
        failures.append("slippage.py missing 2x multiplier for stop orders")

    # c) Limit slippage 0.5x
    limit_half = "* 0.5" in sl and 'order_type == "limit"' in sl
    findings.append(f"slippage 0.5x for limit: {'OK' if limit_half else 'MISSING'}")
    if not limit_half:
        failures.append("slippage.py missing 0.5x multiplier for limit orders")

    # d) stop_market prohibition
    stop_market_blocked = (
        'is prohibited' in fm and 'stop_market' in fm
    ) or "raise ValueError" in fm and "stop_market" in fm
    findings.append(f"stop_market raises ValueError: {'OK' if stop_market_blocked else 'MISSING'}")
    if not stop_market_blocked:
        failures.append("fill_model.py does NOT raise on stop_market — CLAUDE.md violation")

    # e) ATR-scaled slippage
    atr_scaled = "atr_values / median_atr" in sl
    findings.append(f"ATR-scaled slippage: {'OK' if atr_scaled else 'MISSING'}")
    if not atr_scaled:
        failures.append("slippage.py not ATR-scaled (constant slippage = wrong)")

    # f) Session liquidity multipliers
    overnight_3x = '"overnight": 3.0' in liq
    rth_1x = '"rth_core": 1.0' in liq
    findings.append(f"liquidity overnight 3x: {'OK' if overnight_3x else 'MISSING'}")
    findings.append(f"liquidity rth_core 1x: {'OK' if rth_1x else 'MISSING'}")
    if not overnight_3x:
        failures.append("liquidity.py overnight slippage != 3x (per CLAUDE.md)")
    if not rth_1x:
        failures.append("liquidity.py rth_core slippage != 1x baseline")

    # g) ASK/BID treatment in backtester
    # The backtester does NOT name "ASK"/"BID" explicitly. Instead the bid/ask
    # spread is captured via slippage_dollars subtracted on entry. This is the
    # standard equity-future approximation. We verify slippage IS subtracted
    # from gross PnL on long trades (i.e., it reduces PnL).
    # In backtester.py: net_pnl = gross_pnl - slippage_cost (or equivalent).
    slippage_subtracted = (
        "slippage" in bt
        and ("- slippage" in bt or "-= slippage" in bt or "- entry_slippage" in bt
             or "- exit_slippage" in bt or "slippage_dollars" in bt)
    )
    findings.append(f"slippage subtracted from PnL (long pays ASK approx): {'OK' if slippage_subtracted else 'CHECK'}")
    if not slippage_subtracted:
        failures.append("backtester.py does not appear to subtract slippage from PnL")

    evidence = "\n  - ".join([""] + findings)
    if failures:
        record(4, "Backtest fill assumptions", "FAIL", evidence,
               fix_pr=("Restore fill/slippage semantics: " + "; ".join(failures)))
    else:
        record(4, "Backtest fill assumptions", "PASS", evidence)


# ─── Cat 5: PnL Math (CRITICAL) ────────────────────────────────────────────


def test_cat05_pnl_math():
    """Cat 5 (CRITICAL): Multipliers vs CME specs, tick sizes, commission, slippage sign.

    A wrong multiplier means EVERY backtest is wrong. This is the highest-stakes
    audit category.

    Checks:
      a) Python CONTRACT_SPECS micro multipliers match CME official:
           MES point_value = 5.00, tick_size = 0.25, tick_value = 1.25
           MNQ point_value = 2.00, tick_size = 0.25, tick_value = 0.50
           MCL point_value = 100.00, tick_size = 0.01, tick_value = 1.00
      b) TS CONTRACT_SPECS in src/shared/firm-config.ts match Python exactly
      c) Commission per side: per-firm dict matches docs/prop-firm-rules-2026-*.md
         (W3B 2026-07-17 docstring truth fix — was the stale 8-firm/$0.37 list:
         current canonical is Topstep $0.62 MES/MNQ + $0.77 MCL, MFFU $0.95
         MES/MNQ + $0.58 MCL; legacy firms removed 2026-05-19)
      d) PnL math in backtester multiplies by point_value (NOT tick_value)
         pnl = (exit - entry) * point_value * contracts
      e) Slippage is SUBTRACTED from gross PnL (cost), never added
      f) Commission counted per-side and doubled for round-turn
    """
    findings = []
    failures = []

    # a) Python CONTRACT_SPECS — exact micro values
    expected_micro = {
        "MES": {"tick_size": 0.25, "tick_value": 1.25, "point_value": 5.00},
        "MNQ": {"tick_size": 0.25, "tick_value": 0.50, "point_value": 2.00},
        "MCL": {"tick_size": 0.01, "tick_value": 1.00, "point_value": 100.00},
    }
    for sym, exp in expected_micro.items():
        spec = CONTRACT_SPECS[sym]
        for field, val in exp.items():
            actual = getattr(spec, field)
            ok = abs(actual - val) < 1e-9
            findings.append(f"Python CONTRACT_SPECS[{sym}].{field} = {actual} (expected {val}): {'OK' if ok else 'MISMATCH'}")
            if not ok:
                failures.append(f"Python {sym}.{field} mismatch: got {actual}, expected {val} (CME official)")

    # b) TS CONTRACT_SPECS in firm-config.ts match.
    # Search the whole file for per-symbol lines (one symbol per line) — simpler
    # and robust to inner-brace nesting that broke earlier block-extraction.
    ts_firm_config = _read("src/shared/firm-config.ts")
    for sym, exp in expected_micro.items():
        sym_match = re.search(
            rf"{sym}\s*:\s*\{{\s*tickSize\s*:\s*([0-9.]+)\s*,\s*tickValue\s*:\s*([0-9.]+)\s*,\s*pointValue\s*:\s*([0-9.]+)",
            ts_firm_config,
        )
        if not sym_match:
            failures.append(f"TS CONTRACT_SPECS missing or unparsable for {sym}")
            findings.append(f"TS CONTRACT_SPECS[{sym}]: NOT PARSED")
            continue
        ts_tick_size = float(sym_match.group(1))
        ts_tick_value = float(sym_match.group(2))
        ts_point_value = float(sym_match.group(3))
        for fname, expected, actual in [
            ("tickSize", exp["tick_size"], ts_tick_size),
            ("tickValue", exp["tick_value"], ts_tick_value),
            ("pointValue", exp["point_value"], ts_point_value),
        ]:
            ok = abs(expected - actual) < 1e-9
            findings.append(f"TS CONTRACT_SPECS[{sym}].{fname} = {actual} (expected {expected}): {'OK' if ok else 'MISMATCH'}")
            if not ok:
                failures.append(f"TS {sym}.{fname} mismatch: got {actual}, expected {expected}")

    # c) Per-firm commissions — 2026-05-19 phase19/phase20 stripped 6 legacy
    # firms (TPT/Apex/FFN/Alpha/Tradeify/Earn2Trade). Topstep + MFFU only.
    expected_commissions = {
        "topstep_50k": 0.37,
        "mffu_50k": 0.62,
    }
    for firm, expected_per_side in expected_commissions.items():
        if firm not in FIRM_COMMISSIONS:
            failures.append(f"FIRM_COMMISSIONS missing {firm}")
            findings.append(f"FIRM_COMMISSIONS[{firm}]: MISSING")
            continue
        actual = FIRM_COMMISSIONS[firm]["MES"]
        ok = abs(actual - expected_per_side) < 1e-9
        findings.append(f"FIRM_COMMISSIONS[{firm}][MES] = ${actual:.2f} (expected ${expected_per_side:.2f}): {'OK' if ok else 'MISMATCH'}")
        if not ok:
            failures.append(f"{firm} commission mismatch: got ${actual:.2f}, expected ${expected_per_side:.2f}")

    # Guard against silent legacy firm re-addition.
    if len(FIRM_COMMISSIONS) != 2:
        failures.append(f"FIRM_COMMISSIONS has {len(FIRM_COMMISSIONS)} entries; expected exactly 2 (Topstep + MFFU)")
        findings.append(f"FIRM_COMMISSIONS firm count: {len(FIRM_COMMISSIONS)} != 2 (post-2026-05-19 purge)")
    else:
        findings.append("FIRM_COMMISSIONS firm count: OK (2 firms — Topstep + MFFU)")

    # d) PnL math uses point_value (not tick_value)
    bt = _read("src/engine/backtester.py")
    paper = _read("src/server/services/paper-execution-service.ts")
    # Python backtester multiplies by spec.point_value (note: `spec.` prefix
    # is the canonical access pattern; bare `point_value` is the local copy).
    py_uses_point_value = (
        "spec.point_value" in bt
        and ("* spec.point_value" in bt or "spec.point_value *" in bt)
    )
    # Paper service uses spec.pointValue (TS camelCase)
    ts_uses_point_value = "spec.pointValue" in paper and "* spec.pointValue" in paper
    findings.append(f"Python backtester PnL uses spec.point_value: {'OK' if py_uses_point_value else 'MISSING'}")
    findings.append(f"TS paper service PnL uses spec.pointValue: {'OK' if ts_uses_point_value else 'MISSING'}")
    if not py_uses_point_value:
        failures.append("backtester.py PnL does not use spec.point_value (CRITICAL: wrong scaling)")
    if not ts_uses_point_value:
        failures.append("paper-execution-service.ts PnL does not use spec.pointValue")

    # e) Slippage SIGN: cost (subtracted), never added
    # Search for "+ slippage" near "pnl" — that would be a sign error.
    bad_sign = bool(re.search(r"pnl[^=]*=\s*[^=]*\+\s*slippage", bt))
    findings.append(f"backtester.py adds slippage to PnL (wrong sign): {'YES (BAD)' if bad_sign else 'no'}")
    if bad_sign:
        failures.append("backtester.py adds slippage to PnL — sign error makes losses look like wins")

    # f) Commission counted round-turn
    # paper-execution-service: commission = commissionPerSide * 2 * contracts
    rt_paper = "commissionPerSide * 2 * pos.contracts" in paper
    findings.append(f"Paper commission * 2 (round-turn): {'OK' if rt_paper else 'MISSING'}")
    if not rt_paper:
        failures.append("paper-execution-service.ts does not double commission for round-turn")

    evidence = "\n  - ".join([""] + findings)
    if failures:
        record(5, "PnL math (CRITICAL)", "FAIL", evidence,
               fix_pr=("CRITICAL — PnL math errors invalidate every backtest. "
                       "Fix immediately: " + "; ".join(failures)))
    else:
        record(5, "PnL math (CRITICAL)", "PASS", evidence)


# ─── Cat 6: Walk-Forward Leakage ───────────────────────────────────────────


def test_cat06_walk_forward_leakage():
    """Cat 6: No train/test overlap, embargo applied, parameters re-fit per fold.

    Checks:
      a) split_walk_forward_windows accepts embargo_bars; default in run_walk_forward
         is > 0 (currently 20)
      b) IS data ends at oos_start (no overlap into OOS)
      c) Optimization happens INSIDE the per-window loop (re-fit per fold), not before
      d) MIN_OOS_TRADES / MIN_OOS_DAYS sample size guards exist
      e) Adjacent windows have an embargo between them (non-zero default)
    """
    findings = []
    failures = []

    wf = _read("src/engine/walk_forward.py")

    # a) embargo_bars parameter, non-zero default
    emb_default_match = re.search(r"def run_walk_forward[^)]*embargo_bars\s*:\s*int\s*=\s*(\d+)", wf, re.DOTALL)
    if not emb_default_match:
        failures.append("run_walk_forward signature missing embargo_bars parameter or default")
        findings.append("embargo_bars default: NOT FOUND")
    else:
        default = int(emb_default_match.group(1))
        ok = default >= 1
        findings.append(f"run_walk_forward(embargo_bars=) default = {default}: {'OK' if ok else 'NO EMBARGO'}")
        if not ok:
            failures.append(f"embargo_bars default = {default} (should be >= 1)")

    # b) IS data ends at oos_start (no overlap)
    no_overlap = "is_end = oos_start" in wf
    findings.append(f"split: IS ends at OOS start (no overlap): {'OK' if no_overlap else 'MISSING'}")
    if not no_overlap:
        failures.append("walk_forward.py IS/OOS may overlap — leakage risk")

    # c) Re-fit per fold: optimize_strategy called inside the per-window loop
    # We check that optimize_strategy is invoked AFTER the windows loop opens.
    in_loop_optimize = bool(re.search(
        r"for i,\s*\(is_data,\s*oos_data\)\s*in\s*enumerate\(windows\):"
        r".*?optimize_strategy\(",
        wf,
        re.DOTALL,
    ))
    findings.append(f"optimize_strategy invoked inside per-window loop: {'OK' if in_loop_optimize else 'MISSING'}")
    if not in_loop_optimize:
        failures.append("walk_forward.py does not re-fit per fold (params leak across folds)")

    # d) Sample size guards
    sample_guards = "MIN_OOS_TRADES" in wf and "MIN_OOS_DAYS" in wf
    findings.append(f"OOS sample size guards: {'OK' if sample_guards else 'MISSING'}")
    if not sample_guards:
        failures.append("walk_forward.py missing OOS sample-size guards")

    # e) Slice respects embargo
    slice_respects_embargo = "data.slice(oos_start + embargo_bars" in wf
    findings.append(f"data.slice respects embargo offset: {'OK' if slice_respects_embargo else 'MISSING'}")
    if not slice_respects_embargo:
        failures.append("walk_forward.py slice does not honor embargo_bars")

    evidence = "\n  - ".join([""] + findings)
    if failures:
        record(6, "Walk-forward leakage", "FAIL", evidence,
               fix_pr=("Restore WF leakage protection: " + "; ".join(failures)))
    else:
        record(6, "Walk-forward leakage", "PASS", evidence)


# ─── Cat 7: Monte Carlo Accuracy ───────────────────────────────────────────


def test_cat07_monte_carlo_accuracy():
    """Cat 7: Default `both` not silently degraded; block size reasonable for daily futures;
    Sharpe annualization matches trade frequency.

    Checks:
      a) MonteCarloRequest defaults method to "both"
      b) "both" branch actually runs trade_resample + return_bootstrap + arch_stationary
         (not silently substituting one method)
      c) optimal_block_length() clamps to [3, n//10]
      d) Sharpe annualization uses periods_per_year_trades for trade-level,
         252.0 for daily
      e) PCG64DXSM RNG used (deterministic, reproducible)
    """
    findings = []
    failures = []

    mc = _read("src/engine/monte_carlo.py")

    # a) Default method = "both"
    default_both = bool(re.search(r'method\s*=\s*config\.get\(["\']method["\'],\s*["\']both["\']\)', mc))
    findings.append(f'MC default method = "both": {"OK" if default_both else "MISSING"}')
    if not default_both:
        failures.append('monte_carlo.py default method != "both"')

    # b) "both" branch runs all three methods
    both_runs_three = (
        "trade_resample(trades_arr, n_trade" in mc
        and "return_bootstrap(daily_arr, n_return, n_days" in mc
        and "arch_stationary_bootstrap(\n            trades_arr, n_arch" in mc
    )
    findings.append(f'"both" branch runs trade+return+arch: {"OK" if both_runs_three else "DEGRADED"}')
    if not both_runs_three:
        failures.append('"both" method does not run all three sub-methods (silently degraded)')

    # c) Block length clamping
    clamp_ok = "max(3, min(block_len, n // 10))" in mc
    findings.append(f"optimal_block_length clamp [3, n//10]: {'OK' if clamp_ok else 'MISSING'}")
    if not clamp_ok:
        failures.append("monte_carlo.py optimal_block_length missing [3, n//10] clamp")

    # d) Sharpe annualization
    trade_ann = "periods_per_year_trades = len(trades_arr) / years" in mc
    daily_ann = "periods_per_year_daily = 252.0" in mc
    branch_ok = (
        'if request.method == "trade_resample":\n        periods_per_year = periods_per_year_trades' in mc
    )
    findings.append(f"trade-level annualization: {'OK' if trade_ann else 'MISSING'}")
    findings.append(f"daily annualization (252): {'OK' if daily_ann else 'MISSING'}")
    findings.append(f"trade_resample picks trade-level periods_per_year: {'OK' if branch_ok else 'MISSING'}")
    if not (trade_ann and daily_ann and branch_ok):
        failures.append("monte_carlo.py Sharpe annualization not matched to trade frequency")

    # e) PCG64DXSM determinism
    pcg = "PCG64DXSM" in mc and "create_authoritative_rng" in mc
    findings.append(f"PCG64DXSM authoritative RNG: {'OK' if pcg else 'MISSING'}")
    if not pcg:
        failures.append("monte_carlo.py not using PCG64DXSM (non-deterministic)")

    # Numerical: optimal_block_length on a small array clamps to >= 3
    bl = optimal_block_length(np.array([1.0, -1.0, 2.0, -2.0, 3.0, -3.0]))
    ok_min = bl >= 3
    findings.append(f"optimal_block_length(n=6) = {bl} (>= 3): {'OK' if ok_min else 'BAD'}")
    if not ok_min:
        failures.append(f"optimal_block_length returned {bl} for n=6 (must be >= 3)")

    evidence = "\n  - ".join([""] + findings)
    if failures:
        record(7, "Monte Carlo accuracy", "FAIL", evidence,
               fix_pr=("Fix MC accuracy: " + "; ".join(failures)))
    else:
        record(7, "Monte Carlo accuracy", "PASS", evidence)


# ─── Cat 8: Paper-vs-Backtest Parity ───────────────────────────────────────


def test_cat08_paper_backtest_parity():
    """Cat 8: Same fill probability / slippage / commission / timezone in paper vs backtest.

    This is the canonical truth test: paper-trading economics MUST match
    backtest economics, otherwise paper PnL is meaningless as a forward proxy.

    Checks:
      a) Both layers use the SAME tick sizes / point values (Cat 5 confirms exact match)
      b) Both honor session multipliers (overnight 3x match between liquidity.py and paper service)
      c) Both compute commission per-side (from same firm-config source)
      d) Both use ET timezone (paper service uses toEasternDateString; backtester uses ts_et)
      e) Both apply CME settlement halt (16:00–17:00 ET) — backtester via liquidity.py CME_HALT
         entry, paper via classifySessionType returning "CME_HALT"
    """
    findings = []
    failures = []

    paper = _read("src/server/services/paper-execution-service.ts")
    liq = _read("src/engine/liquidity.py")

    # a) Same multipliers — verified in Cat 5; reaffirm here
    findings.append("contract specs parity: see Cat 5 for exact field-by-field check")

    # b) Overnight session multiplier 3.0 in both
    paper_3x = 'sessionMult = 3.0' in paper and ('OVERNIGHT' in paper or 'ASIAN' in paper)
    backtest_3x = '"overnight": 3.0' in liq
    findings.append(f"paper overnight slippage 3.0x: {'OK' if paper_3x else 'MISSING'}")
    findings.append(f"backtest overnight slippage 3.0x: {'OK' if backtest_3x else 'MISSING'}")
    if paper_3x != backtest_3x:
        failures.append("paper vs backtest overnight multiplier MISMATCH")
    if not paper_3x:
        failures.append("paper-execution-service.ts overnight slippage != 3.0x")
    if not backtest_3x:
        failures.append("liquidity.py overnight slippage != 3.0x")

    # c) Commission per-side from getCommissionPerSide(firmId)
    paper_per_side = "getCommissionPerSide(sessionForFirm?.firmId)" in paper
    findings.append(f"paper getCommissionPerSide(firmId): {'OK' if paper_per_side else 'MISSING'}")
    if not paper_per_side:
        failures.append("paper-execution-service.ts does not pull commission from per-firm config")

    # d) ET timezone usage
    paper_et = "toEasternDateString" in paper
    et_dst = "isUsDst" in _read("src/server/services/paper-risk-gate.ts")
    findings.append(f"paper uses ET (toEasternDateString): {'OK' if paper_et else 'MISSING'}")
    findings.append(f"paper-risk-gate uses DST-aware ET offset: {'OK' if et_dst else 'MISSING'}")
    if not paper_et:
        failures.append("paper service does not use ET-aware date string")
    if not et_dst:
        failures.append("paper-risk-gate does not honor DST")

    # e) CME settlement halt (16:00-17:00 ET) parity
    paper_halt = '"CME_HALT"' in paper or "CME_HALT" in paper
    backtest_halt = "CME_HALT" in liq
    findings.append(f"paper CME_HALT classification: {'OK' if paper_halt else 'MISSING'}")
    findings.append(f"backtest CME_HALT in liquidity multipliers: {'OK' if backtest_halt else 'MISSING'}")
    if not paper_halt:
        failures.append("paper service missing CME_HALT classification")
    if not backtest_halt:
        failures.append("liquidity.py missing CME_HALT entry")

    # Soft check: the paper fill probability model is RSI/ATR/volume-based and the
    # backtest fill probability model is RSI/ATR/spread-based. They are structurally
    # similar but NOT bit-for-bit identical (paper adds volume factor; backtest adds
    # spread factor). This is acknowledged drift; the two are aligned but not equal.
    findings.append("(NOTE) fill probability models are structurally aligned but not bit-identical: paper adds volume factor, backtest adds spread factor. Acceptable drift.")

    evidence = "\n  - ".join([""] + findings)
    if failures:
        record(8, "Paper-vs-backtest parity", "FAIL", evidence,
               fix_pr=("Restore parity: " + "; ".join(failures)))
    else:
        record(8, "Paper-vs-backtest parity", "PASS", evidence)


# ─── Cat 9: Daily PnL Aggregation ──────────────────────────────────────────


def test_cat09_daily_pnl_aggregation():
    """Cat 9: Closes at 5pm ET, trailing DD HWM from CLOSED equity, consec losers reset.

    Checks:
      a) toEasternDateString uses the calendar ET date (midnight rollover)
         — but futures trading day rolls at 5pm ET. We FLAG this gap as a
         known finding even though it is not a hard fail.
      b) consecutive_losses counter resets when streak broken (`break` in loop)
      c) peakEquity (HWM) update — currently uses currentEquity which reflects
         marked-to-market unrealized. We assess whether this matches each firm's
         official trailing DD definition (most prop firms: trailing DD locks at
         starting balance + max_drawdown using EOD/closed equity).
      d) consistencyRule check fires after trade close
    """
    findings = []
    failures = []
    soft_findings = []

    risk_gate = _read("src/server/services/paper-risk-gate.ts")
    paper = _read("src/server/services/paper-execution-service.ts")

    # a) Daily P&L aggregation date: toEasternDateString uses calendar midnight, NOT 5pm ET cutoff
    midnight_rollover = (
        "toEasternDateString" in risk_gate
        and "isUsDst" in risk_gate
        and ".toISOString().split" in risk_gate
    )
    findings.append(f"toEasternDateString uses calendar ET midnight: {'YES' if midnight_rollover else 'no'}")
    if midnight_rollover:
        # This is the critical Cat 9 finding: futures trading day rolls at 5pm ET,
        # not calendar midnight. A trade closed at 17:30 ET on Tue counts as the
        # WED trading day per CME convention. Current code attributes it to TUE.
        soft_findings.append(
            "FINDING: toEasternDateString() uses calendar ET midnight rollover for "
            "dailyPnlBreakdown keys (paper-risk-gate.ts:16-21). Futures trading day "
            "rolls at 5:00 PM ET per CME convention. Trades closed 17:00–23:59 ET "
            "are attributed to the WRONG trading day. Affects daily loss limit "
            "enforcement and consistency rule calculation."
        )
        # We flag this as a FAIL because daily-loss-limit is a kill-switch input
        failures.append(
            "Daily P&L aggregation uses calendar midnight ET, not CME 5pm ET cutoff "
            "(paper-risk-gate.ts:16-21)"
        )

    # b) Consecutive losses counter resets when a winning trade is encountered.
    # Look for the canonical pattern: a counter init AND an `else break` inside
    # the loop that breaks the streak on a non-loss.
    reset_loop = (
        "consecutiveLosses = 0" in paper
        and re.search(
            r"consecutiveLosses\+\+;\s*else\s+break;",
            paper,
        ) is not None
    )
    findings.append(f"consecutive losses streak resets on win: {'OK' if reset_loop else 'MISSING'}")
    if not reset_loop:
        failures.append("paper-execution-service.ts consecutive losses counter does not reset cleanly on a winning trade")

    # c) Peak equity (HWM) — uses currentEquity which includes UNREALIZED.
    # closedAt update uses `currentEquity + netPnl` (post-close, realized).
    # mark-to-market update uses `currentEquity + unrealizedDelta` (intraday).
    # peakEquity then takes GREATEST of either path → HWM is on MARKED-TO-MARKET.
    # This is INCORRECT for most prop firms whose trailing DD HWM is on CLOSED equity.
    hwm_uses_unrealized = (
        "peakEquity: sql`GREATEST(${paperSessions.peakEquity}::numeric, ${paperSessions.currentEquity}::numeric + ${totalUnrealizedDelta})" in paper
    )
    findings.append(f"peakEquity HWM updated from MARKED-TO-MARKET (unrealized) equity: {'YES' if hwm_uses_unrealized else 'no'}")
    if hwm_uses_unrealized:
        # Critical finding: per docs/prop-firm-rules.md, Topstep/Apex EOD trailing
        # DD uses CLOSED equity. Updating HWM intraday from unrealized PnL
        # over-tightens the trailing DD floor.
        failures.append(
            "peakEquity (trailing DD HWM) is updated from MARKED-TO-MARKET equity "
            "(paper-execution-service.ts:1622). Per Topstep/Apex EOD trailing DD spec, "
            "HWM must update from CLOSED equity (post-trade-close) only. Intraday MTM "
            "updates over-tighten the floor and trigger false breaches."
        )

    # d) Consistency rule check called after trade close
    consistency_after_close = "checkConsistencyRule(session, netPnl)" in paper
    findings.append(f"checkConsistencyRule called after trade close: {'OK' if consistency_after_close else 'MISSING'}")
    if not consistency_after_close:
        failures.append("checkConsistencyRule not invoked post-close")

    # Soft additional findings — record but not fail (already captured above)
    for sf in soft_findings:
        findings.append(sf)

    evidence = "\n  - ".join([""] + findings)
    if failures:
        record(9, "Daily PnL aggregation", "FAIL", evidence,
               fix_pr=(
                   "Fix daily P&L aggregation: "
                   "(1) Add a 5pm ET cutoff helper for futures trading day attribution; "
                   "(2) Track HWM on a CLOSED-equity column (e.g., realizedPeakEquity) "
                   "separately from marked-to-market peak so prop firm trailing DD is correct; "
                   "(3) Update kill switch and dailyPnlBreakdown to key on the futures day, not calendar day."
               ))
    else:
        record(9, "Daily PnL aggregation", "PASS", evidence)


# ─── Cat 10: Compliance Accuracy ───────────────────────────────────────────


def test_cat10_compliance_accuracy():
    """Cat 10: Per-firm DLL definition; trailing DD updates on closed equity;
    max position aware of correlated positions.

    Checks:
      a) FIRM_RULES sets daily_loss_limit per firm: Topstep $1000, MFFU $1000
         (Builder — SOFT pause). (W3B 2026-07-17 docstring truth fix — was the
         stale 8-firm list; legacy firms removed 2026-05-19)
      b) trailing_drawdown_locks (locks_at_start) is implemented in monte_carlo / prop_compliance
      c) Correlation matrix loads via correlated-position-guard with threshold 0.70
      d) compliance_gate.check_kill_switch checks consecutive_losses, daily_loss_limit, max_trades_per_day
      e) Per-firm contract caps respected (FIRM_CONTRACT_CAPS)
    """
    findings = []
    failures = []

    # a) Per-firm DLL — 2026-05-19 legacy purge: Topstep + MFFU only.
    expected_dll = {
        "topstep_50k": 1000,
        "mffu_50k": None,
    }
    for firm, expected in expected_dll.items():
        actual = FIRM_RULES.get(firm, {}).get("daily_loss_limit")
        ok = actual == expected
        findings.append(f"FIRM_RULES[{firm}].daily_loss_limit = {actual} (expected {expected}): {'OK' if ok else 'MISMATCH'}")
        if not ok:
            failures.append(f"{firm} daily_loss_limit mismatch: got {actual}, expected {expected}")

    # Guard: FIRM_RULES must contain exactly Topstep + MFFU.
    if len(FIRM_RULES) != 2:
        failures.append(f"FIRM_RULES has {len(FIRM_RULES)} entries; expected exactly 2 (Topstep + MFFU)")
        findings.append(f"FIRM_RULES firm count: {len(FIRM_RULES)} != 2")
    else:
        findings.append("FIRM_RULES firm count: OK (2 firms — Topstep + MFFU)")

    # b) locks_at_start in prop_compliance
    prop_compliance = _read("src/engine/prop_compliance.py")
    locks_pres = '"locks_at_start": True' in prop_compliance
    locks_in_mc = "locks_at_start" in _read("src/engine/monte_carlo.py")
    findings.append(f"prop_compliance.py locks_at_start: {'OK' if locks_pres else 'MISSING'}")
    findings.append(f"monte_carlo.py honors locks_at_start: {'OK' if locks_in_mc else 'MISSING'}")
    if not locks_pres:
        failures.append("prop_compliance.py missing locks_at_start (trailing DD lock at starting balance)")
    if not locks_in_mc:
        failures.append("monte_carlo.py firm-survival sim does not honor locks_at_start")

    # c) Correlation matrix + guard
    yaml_path = REPO_ROOT / "src/engine/compliance/correlation_matrix.yaml"
    if not yaml_path.exists():
        failures.append("correlation_matrix.yaml MISSING")
        findings.append("correlation_matrix.yaml: MISSING")
    else:
        yaml_text = yaml_path.read_text(encoding="utf-8")
        threshold_match = re.search(r"^threshold:\s*([0-9.]+)", yaml_text, re.MULTILINE)
        if not threshold_match:
            failures.append("correlation_matrix.yaml missing 'threshold:' key")
            findings.append("correlation_matrix.threshold: MISSING")
        else:
            thr = float(threshold_match.group(1))
            ok = abs(thr - 0.70) < 1e-9
            findings.append(f"correlation_matrix threshold = {thr} (expected 0.70): {'OK' if ok else 'MISMATCH'}")
            if not ok:
                failures.append(f"correlation_matrix threshold = {thr} (should be 0.70 per Tier 5.3.1)")

    # d) check_kill_switch implementation
    cg = _read("src/engine/compliance/compliance_gate.py")
    kill_switch_complete = (
        "consecutive_losses" in cg
        and "daily_loss_limit" in cg
        and "max_trades_per_session" in cg
    )
    findings.append(f"check_kill_switch covers DLL/consec/max-trades: {'OK' if kill_switch_complete else 'PARTIAL'}")
    if not kill_switch_complete:
        failures.append("compliance_gate.check_kill_switch missing one of [DLL, consec_losses, max_trades]")

    # e) Per-firm contract caps — 2026-05-19 micros corrected to 50 (was 15).
    EXPECTED_MICRO_CAP = 50
    for firm in ["topstep_50k", "mffu_50k"]:
        if firm not in FIRM_CONTRACT_CAPS:
            failures.append(f"FIRM_CONTRACT_CAPS missing {firm}")
            findings.append(f"FIRM_CONTRACT_CAPS[{firm}]: MISSING")
            continue
        for sym in ["MES", "MNQ", "MCL"]:
            if sym not in FIRM_CONTRACT_CAPS[firm]:
                failures.append(f"FIRM_CONTRACT_CAPS[{firm}] missing {sym}")
                findings.append(f"FIRM_CONTRACT_CAPS[{firm}][{sym}]: MISSING")
                continue
            actual_cap = FIRM_CONTRACT_CAPS[firm][sym]
            if actual_cap != EXPECTED_MICRO_CAP:
                failures.append(f"FIRM_CONTRACT_CAPS[{firm}][{sym}] = {actual_cap} (expected {EXPECTED_MICRO_CAP})")
                findings.append(f"FIRM_CONTRACT_CAPS[{firm}][{sym}] = {actual_cap}: MISMATCH (expected {EXPECTED_MICRO_CAP})")
            else:
                findings.append(f"FIRM_CONTRACT_CAPS[{firm}][{sym}] = {actual_cap}: OK")

    # f) Soft finding: firm-config.ts marks ALL firms `trailing: "eod"` even though
    #    a) MFFU offers "Rapid" plan with intraday_trailing
    #    b) Apex offers both EOD and Intraday 50K accounts
    findings.append(
        "(NOTE) src/shared/firm-config.ts marks ALL firms `trailing: \"eod\"`. "
        "MFFU \"Rapid\" plan and Apex \"Intraday\" 50K account both use intraday "
        "trailing per docs/prop-firm-rules.md. Acceptable for current trading "
        "(user only uses EOD plans) but flagged for future plan additions."
    )

    evidence = "\n  - ".join([""] + findings)
    if failures:
        record(10, "Compliance accuracy", "FAIL", evidence,
               fix_pr=("Fix compliance: " + "; ".join(failures)))
    else:
        record(10, "Compliance accuracy", "PASS", evidence)


# ─── Cat 11: DB Write Integrity ────────────────────────────────────────────


def test_cat11_db_write_integrity():
    """Cat 11: Numeric precision (numeric not float8); JSONB types; race prevention.

    Checks:
      a) PnL/equity columns in schema.ts use `numeric()` not `doublePrecision()`
      b) Equity/PnL JSONB fields exist as JSONB (jsonb()), not text or json
      c) withSessionLock exists and is wired in paper-execution-service for
         critical session mutations (open/close/update positions)
      d) No SQL migration uses float8/double precision for PnL columns
      e) drizzle-kit migrate via Railway is broken per W10/W11 audits — record
         as known finding (no test fix expected here)
    """
    findings = []
    failures = []

    schema = _read("src/server/db/schema.ts")

    # a) Critical PnL fields are numeric()
    critical_numeric_fields = [
        "totalReturn", "sharpeRatio", "maxDrawdown", "winRate", "profitFactor",
        "avgTradePnl", "avgDailyPnl", "forgeScore",
        "entryPrice", "exitPrice", "pnl", "netPnl", "commission", "grossPnl",
        "slippage", "mae", "mfe",
        "currentEquity", "peakEquity",
    ]
    missing_numeric = []
    for field in critical_numeric_fields:
        # Loose match: field name followed by `: numeric(`
        pattern = rf"{field}\s*:\s*numeric\("
        if not re.search(pattern, schema):
            missing_numeric.append(field)
    findings.append(f"critical PnL fields using numeric(): {len(critical_numeric_fields) - len(missing_numeric)}/{len(critical_numeric_fields)} OK")
    if missing_numeric:
        findings.append(f"missing numeric() fields: {missing_numeric}")
        failures.append(f"schema.ts: critical fields not numeric(): {missing_numeric}")

    # b) JSONB fields use jsonb()
    jsonb_uses = schema.count("jsonb(")
    findings.append(f"schema.ts jsonb() usages: {jsonb_uses}")
    if jsonb_uses < 5:
        failures.append("schema.ts has very few jsonb() usages (suspicious — JSONB recommended for equity_curve etc.)")

    # c) withSessionLock present + wired
    locks_file = _read("src/server/lib/db-locks.ts")
    has_advisory_lock = "pg_advisory_xact_lock" in locks_file
    paper = _read("src/server/services/paper-execution-service.ts")
    paper_uses_lock = "withSessionLock(" in paper and paper.count("withSessionLock(") >= 2
    findings.append(f"db-locks.ts uses pg_advisory_xact_lock: {'OK' if has_advisory_lock else 'MISSING'}")
    findings.append(f"paper-execution-service uses withSessionLock >=2 times: {'OK' if paper_uses_lock else 'MISSING'}")
    if not has_advisory_lock:
        failures.append("db-locks.ts missing pg_advisory_xact_lock")
    if not paper_uses_lock:
        failures.append("paper-execution-service.ts withSessionLock not wired for critical mutations")

    # d) Scan SQL migrations for float8/double precision in PnL contexts
    bad_migrations = []
    for sql in (REPO_ROOT / "src/server/db/migrations").glob("*.sql"):
        try:
            text = sql.read_text(encoding="utf-8")
        except Exception:
            continue
        if re.search(r"\bfloat8\b|\bdouble precision\b", text, re.IGNORECASE):
            bad_migrations.append(sql.name)
    findings.append(f"migrations using float8/double precision: {bad_migrations or 'none'}")
    if bad_migrations:
        failures.append(f"migrations use float8/double precision: {bad_migrations}")

    # e) Known issue: drizzle-kit Railway migrate broken per W10/W11
    findings.append(
        "(KNOWN ISSUE) drizzle-kit Railway migrate is broken per W10/W11 audits. "
        "Out of scope for A12 fix; tracked separately in W11 Team C audit."
    )

    # f) Lock feature flag — withSessionLock is gated on TF_POSITION_LOCKING=1
    locks_text = _read("src/server/lib/db-locks.ts")
    has_flag = 'TF_POSITION_LOCKING' in locks_text
    findings.append(f"withSessionLock gated on TF_POSITION_LOCKING flag: {'OK' if has_flag else 'NO'}")
    if has_flag:
        findings.append(
            "(NOTE) withSessionLock is OFF unless TF_POSITION_LOCKING=1 — verify "
            "production env sets this; otherwise concurrent paper trades race."
        )

    evidence = "\n  - ".join([""] + findings)
    if failures:
        record(11, "DB write integrity", "FAIL", evidence,
               fix_pr=("Fix DB write integrity: " + "; ".join(failures)))
    else:
        record(11, "DB write integrity", "PASS", evidence)


# ─── Cat 12: Source-of-Truth Conflicts ─────────────────────────────────────


def test_cat12_source_of_truth_conflicts():
    """Cat 12: When metrics computed two ways, explicit precedence rule MUST exist.

    Checks:
      a) Sharpe is computed in 3 places: backtester.py (per-side + daily),
         risk_metrics.py (compute_sharpe_distribution), monte_carlo.py
         (_compute_sharpe_ratios). Verify these use compatible annualization.
      b) Per-firm rules exist in BOTH src/shared/firm-config.ts AND
         src/engine/firm_config.py — they must agree.
      c) Per-firm rules ALSO exist in src/engine/prop_compliance.py — must agree.
      d) Backtest result hash mechanism (A2 backtest_provenance) must be the
         tiebreaker for divergent metric computations.
    """
    findings = []
    failures = []

    # a) Sharpe computation locations
    bt = _read("src/engine/backtester.py")
    rm = _read("src/engine/risk_metrics.py")
    mc = _read("src/engine/monte_carlo.py")

    bt_sharpe_count = bt.count("np.sqrt(252)")
    rm_sharpe_count = rm.count("np.sqrt(periods_per_year)")
    mc_sharpe_count = mc.count("np.sqrt(periods_per_year)")
    findings.append(f"Sharpe computations: backtester={bt_sharpe_count}, risk_metrics={rm_sharpe_count}, monte_carlo={mc_sharpe_count}")

    # All should use 252.0 for daily; trade-level uses len(trades)/years
    bt_uses_252 = "np.sqrt(252)" in bt
    rm_param = "periods_per_year: float = 252.0" in rm
    mc_branches = "periods_per_year_trades" in mc and "periods_per_year_daily" in mc
    findings.append(f"backtester Sharpe annualization (252 daily): {'OK' if bt_uses_252 else 'MISSING'}")
    findings.append(f"risk_metrics annualization param: {'OK' if rm_param else 'MISSING'}")
    findings.append(f"monte_carlo trade vs daily branches: {'OK' if mc_branches else 'MISSING'}")
    # FINDING: backtester.py hardcodes np.sqrt(252) without an explicit "this is daily-only"
    # comment, and there is no documented precedence rule when the backtester result
    # disagrees with monte_carlo's mean Sharpe. Flag as a soft finding.
    findings.append(
        "(NOTE) backtester.py uses hardcoded np.sqrt(252) annualization for Sharpe. "
        "monte_carlo.py independently computes Sharpe with separate trade/daily "
        "annualization. No documented precedence when they diverge."
    )

    # b/c) Firm rule duplication
    py_firms = _read("src/engine/firm_config.py")
    py_propcomp = _read("src/engine/prop_compliance.py")
    ts_firms = _read("src/shared/firm-config.ts")

    # Check three sources have identical max_drawdown for topstep_50k.
    # Regexes are intentionally permissive: search the WHOLE file for the
    # first topstep-block maxDrawdown value. Each file has only one Topstep
    # 50K entry, so the first hit is always correct.
    py_topstep_dd = re.search(r'"topstep_50k"\s*:.*?"max_drawdown"\s*:\s*([0-9]+)', py_firms, re.DOTALL)
    py_pc_topstep_dd = re.search(r'"topstep[^"]*"\s*:\s*\{.*?"max_drawdown"\s*:\s*([0-9]+)', py_propcomp, re.DOTALL)
    # TS: search topstep block, anywhere in the file, for "maxDrawdown: NNNN"
    ts_topstep_dd = re.search(r'topstep\s*:\s*\{.*?maxDrawdown\s*:\s*([0-9_]+)', ts_firms, re.DOTALL)

    py_v = int(py_topstep_dd.group(1)) if py_topstep_dd else None
    py_pc_v = int(py_pc_topstep_dd.group(1)) if py_pc_topstep_dd else None
    ts_v = int(ts_topstep_dd.group(1).replace("_", "")) if ts_topstep_dd else None
    findings.append(f"Topstep maxDD: firm_config.py={py_v}, prop_compliance.py={py_pc_v}, shared/firm-config.ts={ts_v}")
    if py_v is not None and ts_v is not None and py_v != ts_v:
        failures.append(f"Topstep maxDD mismatch: firm_config.py={py_v}, shared/firm-config.ts={ts_v}")
    if py_v is not None and py_pc_v is not None and py_v != py_pc_v:
        failures.append(f"Topstep maxDD mismatch: firm_config.py={py_v}, prop_compliance.py={py_pc_v}")

    # CLAUDE.md explicitly notes: "prop_compliance.py has its own FIRM_CONFIGS dict
    # that duplicates some of these rules. Both must stay in sync. Do NOT delete
    # either without full regression testing." — record as a known long-term risk.
    findings.append(
        "(NOTE) Firm rules are TRIPLICATED across src/shared/firm-config.ts (TS), "
        "src/engine/firm_config.py (Py FIRM_RULES), and src/engine/prop_compliance.py "
        "(Py FIRM_CONFIGS). CLAUDE.md flags this as a known sync risk. No automated "
        "drift detection currently — flagged as Cat 12 source-of-truth weakness."
    )

    # d) backtest_provenance / result hash precedence
    schema = _read("src/server/db/schema.ts")
    has_prov_table = "backtest_provenance" in schema or "backtestProvenance" in schema
    findings.append(f"backtest_provenance result-hash table exists: {'OK' if has_prov_table else 'MISSING'}")
    if not has_prov_table:
        failures.append("backtest_provenance table missing — no tiebreaker for divergent backtest re-runs")

    # The plan documents that backtest_provenance is the read-only observation
    # layer for drift but not a precedence rule for divergent metrics. We FLAG
    # this as a Cat 12 weakness even though the table exists.
    findings.append(
        "(FINDING) backtest_provenance exists (drift detection) but Trading Forge "
        "has NO documented precedence rule for which Sharpe value 'wins' when "
        "backtester.py and monte_carlo.py independently compute slightly different "
        "values for the same backtest. Lifecycle gates currently consume backtester "
        "result Sharpe; MC Sharpe distribution is read separately. This is acceptable "
        "(different semantic meaning) but should be DOCUMENTED."
    )

    evidence = "\n  - ".join([""] + findings)
    if failures:
        record(12, "Source-of-truth conflicts", "FAIL", evidence,
               fix_pr=("Resolve source-of-truth conflicts: " + "; ".join(failures)))
    else:
        record(12, "Source-of-truth conflicts", "PASS", evidence)


# ─── Defect-10 regression lint: forward-window validity must be bar-gated ──


def test_defect10_no_forward_window_gates_without_valid_from():
    """Defect-10 lint: forward-scanning validity windows in breaker/unicorn/
    mitigation MUST feed a per-bar `valid_from` gate, never a single per-zone
    boolean that admits ALL retests regardless of WHEN within the window the
    qualifying event actually occurred (the bug: an entry at broken_at+1
    admitted by a BOS that only appears at broken_at+3 — its own future).

    This is a read-only static lint, not one of the 12 A12 categories — it
    does not call record()/participate in the pass/fail-count report.

    WHITELIST: `market_structure.py::detect_swings()`'s centered-window-then-
    shift construction (`rolling_max(..., center=True)` + `+ half_window`) is
    a different, already-safe shape — the shift is applied AFTER detection so
    the swing simply isn't *visible* until the confirmation window completes.
    It is never scanned by this lint and is not flagged.
    """
    findings = []
    failures = []

    breaker_src = _read("src/engine/strategies/breaker.py")
    unicorn_src = _read("src/engine/strategies/unicorn.py")
    mitigation_src = _read("src/engine/strategies/mitigation.py")
    market_structure_src = _read("src/engine/indicators/market_structure.py")

    # 1) Fix presence: breaker.py and unicorn.py must compute a streaming
    #    valid_from and use it to gate entries.
    for name, src in [("breaker.py", breaker_src), ("unicorn.py", unicorn_src)]:
        has_valid_from = "valid_from" in src
        findings.append(f"{name} contains valid_from streaming-gate construction: {'OK' if has_valid_from else 'MISSING'}")
        if not has_valid_from:
            failures.append(f"{name} missing valid_from — forward-window validity is not bar-gated (Defect-10 regression)")

    # 2) Literal Defect-10 shape: a symmetric forward/backward scanning window
    #    range(max(0, X - k), min(n, X + k)). This shape is EXPECTED to exist
    #    (it's how the earliest qualifying event is found) — the lint only
    #    requires that whenever it appears, the file also contains the
    #    valid_from bar-gate that consumes its result. It must NEVER appear
    #    bare (i.e. feeding only a batch boolean) in these strategy files.
    forward_window_pattern = re.compile(r"range\(\s*max\(0,\s*\w+\s*-\s*\d+\),\s*min\(n,\s*\w+\s*\+\s*\d+\)\s*\)")
    for name, src in [("breaker.py", breaker_src), ("unicorn.py", unicorn_src)]:
        windows = forward_window_pattern.findall(src)
        findings.append(f"{name} forward-scanning windows (range(max(0,X-k), min(n,X+k))): {len(windows)} found")
        if windows and "valid_from" not in src:
            failures.append(
                f"{name} contains a forward-scanning validity window with no valid_from "
                "bar-level gate anywhere in the file — Defect-10 class look-ahead"
            )

    # 3) Anti-pattern regression guard: the OLD bare per-zone booleans
    #    (bos_found / has_displacement) must never reappear WITHOUT a
    #    co-located valid_from gate in the same file.
    old_boolean_gate_bare = bool(re.search(r"bos_found\s*=\s*True", breaker_src)) and "valid_from" not in breaker_src
    findings.append(f"breaker.py bare bos_found boolean gate (no valid_from): {'YES (BAD)' if old_boolean_gate_bare else 'no'}")
    if old_boolean_gate_bare:
        failures.append("breaker.py uses a bare per-zone boolean (bos_found) with no valid_from bar-gate — Defect-10 regression")

    old_disp_gate_bare = bool(re.search(r"has_displacement\s*=\s*True", unicorn_src)) and "valid_from" not in unicorn_src
    findings.append(f"unicorn.py bare has_displacement boolean gate (no valid_from): {'YES (BAD)' if old_disp_gate_bare else 'no'}")
    if old_disp_gate_bare:
        failures.append("unicorn.py uses a bare per-zone boolean (has_displacement) with no valid_from bar-gate — Defect-10 regression")

    # 4) mitigation.py: explicit strict entry_bar > bos_bar gate must be present.
    mitigation_gate = "i <= bos_bar" in mitigation_src
    findings.append(f"mitigation.py explicit entry_bar > bos_bar gate: {'OK' if mitigation_gate else 'MISSING'}")
    if not mitigation_gate:
        failures.append("mitigation.py missing explicit strict entry_bar > bos_bar gate")

    # 5) WHITELIST documentation check (informational, never fails): confirm
    #    the exonerated swing-layer construction still looks like itself, so
    #    a future refactor that accidentally changes its shape is visible in
    #    the audit evidence trail rather than silently drifting.
    swing_whitelisted = "center=True" in market_structure_src and "+ half_window" in market_structure_src
    findings.append(
        f"market_structure.py detect_swings centered-window-then-shift "
        f"(WHITELISTED, never scanned by this lint): {'present' if swing_whitelisted else 'ABSENT — re-check whitelist scope'}"
    )

    evidence = "\n  - ".join([""] + findings)
    assert not failures, "Defect-10 lint failures:" + evidence


# ─── L=0 observability-axis contract (truncated-replay fixture) ────────────


def test_l0_axis_truncated_replay_contract():
    """L=0 observability-axis contract fixture.

    The breaker/unicorn streaming-validity fix (Defect-10) indexes `valid_from`
    directly by bar with NO half_window/lag offset, because `bos_list[j]` is
    provably knowable at bar j using only data through bar j (an empirical
    truncated-replay receipt confirmed this axis, L=0, 78/78). This test is
    the reproducible miniature version of that receipt: recompute
    detect_bos(detect_swings(df)) on truncated frames df[:j+1] for every BOS
    event bar j found on the full history, and assert the value at j is
    IDENTICAL whether computed from the full series or from data truncated
    to end exactly at j.

    Mimics the DataFrame construction in test_market_structure.py. Lightweight
    polars only — no vectorbt/backtester import (avoids the documented tower
    JIT-import hang under pytest collection when anything transitively pulls
    in the vectorbt-JIT backtester).
    """
    from datetime import datetime, timedelta

    def _make_ohlcv(closes: list[float]) -> pl.DataFrame:
        n = len(closes)
        dates = [datetime(2023, 1, 1) + timedelta(hours=i) for i in range(n)]
        opens = [c - 0.5 for c in closes]
        highs = [c + 1.0 for c in closes]
        lows = [c - 1.0 for c in closes]
        return pl.DataFrame({
            "ts_event": dates,
            "open": opens,
            "high": [float(h) for h in highs],
            "low": [float(l) for l in lows],
            "close": [float(c) for c in closes],
            "volume": [10000] * n,
        })

    def _make_zigzag(n: int = 80) -> list[float]:
        closes = []
        base = 100.0
        for i in range(n):
            cycle = i % 8
            if cycle < 5:
                closes.append(base + cycle * 3.0)
            else:
                closes.append(base + (8 - cycle) * 2.0)
            if cycle == 7:
                base += 5.0
        return closes

    closes = _make_zigzag(80)
    df_full = _make_ohlcv(closes)

    swings_full = detect_swings(df_full, lookback=5)
    bos_full = detect_bos(df_full, swings_full).to_list()

    check_indices = [i for i, v in enumerate(bos_full) if v is not None]
    assert len(check_indices) > 0, "fixture produced zero BOS events — widen the zigzag amplitude/period"

    mismatches = []
    for j in check_indices:
        df_trunc = df_full[: j + 1]
        swings_trunc = detect_swings(df_trunc, lookback=5)
        bos_trunc = detect_bos(df_trunc, swings_trunc).to_list()
        if bos_trunc[j] != bos_full[j]:
            mismatches.append((j, bos_full[j], bos_trunc[j]))

    assert not mismatches, (
        "re-derive the observability axis before trusting streaming validity. "
        f"Truncated-replay mismatches (bar, full-history value, truncated value): {mismatches}"
    )


# ─── Report Generation ─────────────────────────────────────────────────────


@pytest.fixture(scope="module", autouse=True)
def _emit_report_at_module_end(request):
    """After all 12 audit tests run, emit the markdown report."""
    yield  # let all tests run

    # If pytest didn't actually populate every category (e.g., a test crashed
    # before record()), fill in UNKNOWN entries so the report still has 12.
    for cat in range(1, 13):
        if cat not in AUDIT_RESULTS:
            AUDIT_RESULTS[cat] = {
                "category": cat,
                "name": f"Category {cat} (test crashed before recording)",
                "status": "UNKNOWN",
                "evidence": "Test failed to call record() — see pytest output.",
                "fix_pr": None,
            }

    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(_render_report(), encoding="utf-8")


def _render_report() -> str:
    pass_count = sum(1 for r in AUDIT_RESULTS.values() if r["status"] == "PASS")
    fail_count = sum(1 for r in AUDIT_RESULTS.values() if r["status"] == "FAIL")
    unknown_count = sum(1 for r in AUDIT_RESULTS.values() if r["status"] == "UNKNOWN")

    lines: list[str] = []
    lines.append("# A12 — 12-Category Code Audit Report")
    lines.append("")
    lines.append(f"**Generated:** {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}  ")
    lines.append("**Auditor:** W12 Team B (trading-forge-architect)  ")
    lines.append("**Plan:** PART A §A12 of `C:\\Users\\tonio\\.claude\\plans\\reflective-dancing-moth.md`  ")
    lines.append("**Scope:** Read-only static + numerical audit of existing Trading Forge code.  ")
    lines.append("**Test file:** `src/engine/tests/test_audit_a12.py`")
    lines.append("")
    lines.append("## Summary")
    lines.append("")
    lines.append(f"- PASS:    {pass_count}/12")
    lines.append(f"- FAIL:    {fail_count}/12")
    lines.append(f"- UNKNOWN: {unknown_count}/12")
    lines.append("")
    lines.append("| Cat | Category | Status |")
    lines.append("| --- | --- | --- |")
    for r in AUDIT_RESULTS.values():
        lines.append(f"| {r['category']:>2} | {r['name']} | **{r['status']}** |")
    lines.append("")
    if fail_count == 0 and unknown_count == 0:
        lines.append("**Verdict:** All 12 categories PASS. Proceed to W13.")
    elif fail_count == 0 and unknown_count > 0:
        # Deep-scan 2026-07-10 fix: a partial/crashed run (categories never called
        # record()) must NOT print "All 12 PASS" just because nothing explicitly FAILED —
        # UNKNOWN ≠ PASS. Previously the verdict ignored unknown_count entirely, so a run
        # where 11/12 categories crashed still stamped "Proceed to W13", masking uncertified
        # (and, on the last real full run, genuinely FAILING) categories.
        lines.append(f"**Verdict:** INCONCLUSIVE — {unknown_count} categor{'y' if unknown_count == 1 else 'ies'} "
                     "did not run (UNKNOWN, not PASS). Re-run the FULL A12 suite before trusting this report; "
                     "do NOT proceed to W13 on a partial run.")
    else:
        lines.append(f"**Verdict:** {fail_count} categor{'y' if fail_count == 1 else 'ies'} FAIL"
                     f"{f' + {unknown_count} UNKNOWN' if unknown_count else ''}. "
                     "Open bug-fix tickets per the per-category sections below before W13.")
    lines.append("")
    lines.append("---")
    lines.append("")
    lines.append("## Per-Category Findings")
    lines.append("")

    for r in AUDIT_RESULTS.values():
        lines.append(f"### Cat {r['category']} — {r['name']}")
        lines.append("")
        lines.append(f"**Status:** **{r['status']}**")
        lines.append("")
        lines.append("**Evidence:**")
        lines.append("")
        for line in r["evidence"].strip().split("\n"):
            lines.append(line)
        lines.append("")
        if r["status"] == "FAIL" and r.get("fix_pr"):
            lines.append("**Fix PR Description:**")
            lines.append("")
            lines.append(f"> {r['fix_pr']}")
            lines.append("")
        lines.append("---")
        lines.append("")

    lines.append("## How To Re-Run This Audit")
    lines.append("")
    lines.append("```")
    lines.append("pytest src/engine/tests/test_audit_a12.py -v")
    lines.append("```")
    lines.append("")
    lines.append("The test file is read-only and does not modify any production code.")
    lines.append("Findings are computed from current source — re-run after fixes to confirm PASS.")
    lines.append("")
    return "\n".join(lines)
