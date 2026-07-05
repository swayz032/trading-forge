#!/usr/bin/env python3
"""signature-divergence.py — Signature Divergence Score (SDS) harness.

FVG Identity Dispatch Experiment (docs/designs/fvg-identity-dispatch-experiment-2026-07-05.md),
Part C. This is THE SCIENCE — the one scalar this whole experiment is decided on. Built once,
reusable for every future object-identity evaluator (sweep -> MSS -> VWAP, one at a time, same
harness), computed IDENTICALLY before/after so a run comparison is never re-derived by hand.

WHAT IT MEASURES: whether strategies that share a video "concept" (a family — the ×3 symbol
siblings of one strategy idea count as ONE family) trade in a genuinely DIFFERENT way from
strategies that DON'T share a concept. If every strategy behaves the same regardless of family
(mode collapse — the corpus problem this whole roadmap exists to fix), intra-family and
inter-family behavioral distance converge to the same number and SDS -> 1. If family identity is
behaviorally preserved, strategies within a family should look more alike to EACH OTHER than to
strategies outside the family, so inter-family distance > intra-family distance and SDS > 1.

  SDS = mean(inter-family pairwise distance) / mean(intra-family pairwise distance)
        ~= 1   -> collapse (families are behaviorally indistinguishable)
        >> 1   -> identity preserved (families trade differently from each other)

PER-STRATEGY DISTRIBUTION VECTOR (3 components, each a per-trade sample array):
  1. entry_minutes  — minute-of-day (America/New_York, matching every other ET-session concept
     in this codebase) at which each trade entered. Session-binned into ENTRY_TIME_BINS (default
     48 -> 30-minute bins across a day) for the histogram/cosine leg.
  2. holding_minutes — (exit_ts - entry_ts) in minutes per trade.
  3. r_multiples    — pnl / (risk_points * point_value) per trade — the risk-normalized outcome,
     NOT raw dollar PnL (a strategy trading 9 contracts and one trading 3 must not look
     "different" purely because of position size).
  (Equity-curve shape is an OPTIONAL 4th component per the locked spec — omitted here: none of
  the harnesses that feed this script emit a downsampled equity-curve per strategy today. Adding
  it is a documented, additive follow-up — see `add_equity_curve_component()` docstring below.)

PAIRWISE DISTANCE D(i, j): mean of, per component,
  - a Wasserstein distance (scipy.stats.wasserstein_distance) computed on the RAW per-trade
    samples after min-max normalization to [0, 1] using GLOBAL bounds (computed once across every
    strategy in the current comparison set, so every pair's Wasserstein distance lives on the
    same [0, 1]-ish scale), and
  - a cosine distance (1 - cosine similarity) between the two strategies' NORMALIZED HISTOGRAMS
    for that component (same global bin edges as the Wasserstein normalization).
  D(i, j) is the mean of every available component's Wasserstein value + cosine value (a
  component is skipped, not zero-filled, when either strategy has zero samples for it — an
  honest missing-data contract, never a fabricated "no difference" value).
  scipy.stats.ks_2samp's statistic (max component-wise) is ALSO computed and reported as ks_max —
  a sanity cross-check only, never part of D itself (per the locked spec).

FAMILY: concept, i.e. the video/idea a strategy came from — the x3 symbol siblings (MES/MNQ/MCL)
of one idea are ONE family. Derived from `family` if the manifest entry supplies it explicitly
(e.g. `config.metadata.spec_hash` upstream), else derived from the strategy `name` with the
`symbol`/`timeframe` suffix stripped (matches this corpus's `<concept>_<symbol>_<timeframe>`
naming convention — see docs/designs/corpus-v2-mode-ab-strategies.json).

SMALL-N GUARD (locked spec, hard requirement): with ~18-33 strategies in a family-object
experiment like FVG, asymptotic bootstrap theory is shaky. This harness ALWAYS bootstrap-resamples
the strategy SET (with replacement, same N per resample) to produce a 90% CI on SDS plus a
`stability_frac_above_1` (fraction of resamples where SDS > 1.0 — "does the identity-preserved
direction hold up under resampling, not just at the point estimate") and a coefficient of
variation. The report's `small_n_caveat` field states in plain language whether n crosses the
default 50-strategy threshold; an SDS "rise" whose 90% CI includes 1.0 (no-change) is NOT counted
as SDS_ROSE_STABLE regardless of how large the point estimate looks.

GOVERNANCE: this script does zero backtesting and zero I/O beyond reading/writing the manifest and
report JSON files supplied on the CLI — no DB, no engine import, no vectorbt. It consumes trade
lists already produced by whatever harness ran the backtests (a Mode-A/B-style manifest, or any
future evaluator's own trade-list export) and is therefore reusable without modification for the
next object (sweep, MSS, VWAP) per the decision-gate expansion path in the locked spec.

MANIFEST SHAPE (JSON):
  {
    "strategies": {
      "<strategy_id>": {
        "name": "buying_opportunity_mes_15m",       # optional if `family` given directly
        "symbol": "MES",                             # optional, used to derive family
        "timeframe": "15m",                           # optional, used to derive family
        "family": "buying_opportunity",               # optional explicit override
        "trades": [
          {"entry_ts": "2026-01-05T14:30:00+00:00", "exit_ts": "2026-01-05T15:10:00+00:00",
           "pnl": 187.5, "risk_points": 7.5, "point_value": 5.0},
          ...
        ]
      },
      ...
    }
  }

USAGE:
  PYTHONPATH=. python scripts/signature-divergence.py --manifest before_trades.json \\
      --out docs/replay-results/fvg-sds-before.json
  PYTHONPATH=. python scripts/signature-divergence.py --manifest after_trades.json \\
      --out docs/replay-results/fvg-sds-after.json
"""
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import numpy as np
from scipy.stats import ks_2samp, wasserstein_distance

ET = ZoneInfo("America/New_York")

ENTRY_TIME_BINS: int = 48       # 30-minute bins across a 24h session (locked spec: 30-60 bins)
HOLDING_TIME_BINS: int = 20
R_MULTIPLE_BINS: int = 20
DEFAULT_N_BOOTSTRAP: int = 500
DEFAULT_CI_PCT: float = 0.90     # 90% CI -> 5th / 95th percentile
NO_CHANGE_SDS: float = 1.0       # SDS == 1.0 is the collapse baseline ("no separation")
DEFAULT_SMALL_N_THRESHOLD: int = 50

COMPONENTS: tuple[str, ...] = ("entry_minutes", "holding_minutes", "r_multiples")

VERDICT_ROSE_STABLE = "SDS_ROSE_STABLE"
VERDICT_ROSE_UNSTABLE = "SDS_ROSE_UNSTABLE"
VERDICT_FLAT_OR_DOWN = "SDS_FLAT_OR_DOWN"
VERDICT_INDETERMINATE = "INDETERMINATE"


# ─── Timestamp / sample extraction ─────────────────────────────────────────────────────────────

def _parse_ts(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        dt = value
    else:
        s = str(value)
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        try:
            dt = datetime.fromisoformat(s)
        except ValueError:
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _entry_minutes_et(ts: datetime) -> float:
    """Minute-of-day in America/New_York — consistent with every other ET-session concept in
    this codebase (killzone.ts, session_windows.py)."""
    local = ts.astimezone(ET)
    return local.hour * 60.0 + local.minute + local.second / 60.0


def derive_family(name: str, symbol: str | None, timeframe: str | None) -> str:
    """Strip the `_<symbol>` / `_<timeframe>` suffixes this corpus's naming convention adds
    (`<concept>_<symbol>_<timeframe>`) so the x3 MES/MNQ/MCL siblings of one video concept
    collapse to a single family string."""
    fam = name or ""
    if symbol:
        fam = fam.replace(f"_{symbol.lower()}", "")
    if timeframe:
        fam = fam.replace(f"_{timeframe.lower()}", "")
    return fam


@dataclass
class StrategySamples:
    strategy_id: str
    family: str
    entry_minutes: np.ndarray
    holding_minutes: np.ndarray
    r_multiples: np.ndarray
    n_trades: int


def extract_samples(strategy_id: str, entry: dict) -> StrategySamples:
    """Pure extraction — never fabricates a sample. A trade missing entry_ts is dropped from the
    entry-time component only (not from holding/R); missing exit_ts drops it from holding-time
    only; missing/zero risk_points drops it from the R component only. Each component's sample
    array can therefore have a different length than the raw trade count — that is the honest
    behavior, not a bug."""
    trades = entry.get("trades") or []
    name = entry.get("name") or strategy_id
    symbol = entry.get("symbol")
    timeframe = entry.get("timeframe")
    family = entry.get("family") or derive_family(name, symbol, timeframe)

    entry_minutes: list[float] = []
    holding_minutes: list[float] = []
    r_multiples: list[float] = []

    for t in trades:
        entry_ts = _parse_ts(t.get("entry_ts", t.get("Entry Timestamp")))
        exit_ts = _parse_ts(t.get("exit_ts", t.get("Exit Timestamp")))
        if entry_ts is not None:
            entry_minutes.append(_entry_minutes_et(entry_ts))
        if entry_ts is not None and exit_ts is not None:
            holding_minutes.append((exit_ts - entry_ts).total_seconds() / 60.0)

        pnl = t.get("pnl", t.get("PnL"))
        risk_points = t.get("risk_points")
        point_value = t.get("point_value", 1.0)
        if pnl is not None and risk_points not in (None, 0):
            try:
                denom = float(risk_points) * float(point_value)
            except (TypeError, ValueError):
                denom = 0.0
            if denom:
                r_multiples.append(float(pnl) / denom)

    return StrategySamples(
        strategy_id=strategy_id,
        family=family,
        entry_minutes=np.array(entry_minutes, dtype=float),
        holding_minutes=np.array(holding_minutes, dtype=float),
        r_multiples=np.array(r_multiples, dtype=float),
        n_trades=len(trades),
    )


def add_equity_curve_component() -> None:
    """Documented non-goal for this Part-C pass: none of the harnesses that currently feed this
    script (full-battery-mode-ab.py's class path, this experiment's own controlled-run script)
    emit a per-strategy downsampled equity-curve array. Adding a 4th `equity_curve_shape`
    component is additive (append to COMPONENTS, add extraction + bounds handling identically to
    the 3 existing components) and does not require changing the SDS formula. Left as a stub so
    a future caller sees the extension point named rather than needing to invent one."""
    raise NotImplementedError("optional 4th component — not wired for the FVG Part-C pass")


# ─── Global bounds / normalization / histograms ────────────────────────────────────────────────

def _global_bounds(samples: list[StrategySamples], attr: str) -> tuple[float, float]:
    arrays = [getattr(s, attr) for s in samples if getattr(s, attr).size > 0]
    if not arrays:
        return 0.0, 1.0
    vals = np.concatenate(arrays)
    lo, hi = float(vals.min()), float(vals.max())
    if hi <= lo:
        hi = lo + 1.0
    return lo, hi


def _normalize(arr: np.ndarray, lo: float, hi: float) -> np.ndarray:
    if arr.size == 0:
        return arr
    return np.clip((arr - lo) / (hi - lo), 0.0, 1.0)


def _hist(arr_norm: np.ndarray, n_bins: int) -> np.ndarray:
    if arr_norm.size == 0:
        return np.zeros(n_bins)
    h, _ = np.histogram(arr_norm, bins=n_bins, range=(0.0, 1.0))
    total = h.sum()
    return (h / total) if total else h.astype(float)


def _cosine_distance(p: np.ndarray, q: np.ndarray) -> float | None:
    if p.sum() == 0 or q.sum() == 0:
        return None
    den = float(np.linalg.norm(p) * np.linalg.norm(q))
    if den == 0:
        return None
    return 1.0 - float(np.dot(p, q)) / den


HIST_BINS: dict[str, int] = {
    "entry_minutes": ENTRY_TIME_BINS,
    "holding_minutes": HOLDING_TIME_BINS,
    "r_multiples": R_MULTIPLE_BINS,
}


# ─── Pairwise distance ──────────────────────────────────────────────────────────────────────────

def pairwise_distance(si: StrategySamples, sj: StrategySamples, bounds: dict[str, tuple[float, float]]) -> dict:
    d_values: list[float] = []
    ks_values: list[float] = []
    per_component: dict[str, dict] = {}

    for comp in COMPONENTS:
        lo, hi = bounds[comp]
        a_raw, b_raw = getattr(si, comp), getattr(sj, comp)
        a_norm, b_norm = _normalize(a_raw, lo, hi), _normalize(b_raw, lo, hi)

        w = float(wasserstein_distance(a_norm, b_norm)) if a_norm.size and b_norm.size else None
        a_hist, b_hist = _hist(a_norm, HIST_BINS[comp]), _hist(b_norm, HIST_BINS[comp])
        c = _cosine_distance(a_hist, b_hist)
        ks = float(ks_2samp(a_raw, b_raw).statistic) if a_raw.size >= 2 and b_raw.size >= 2 else None

        per_component[comp] = {"wasserstein": w, "cosine": c, "ks": ks}
        if w is not None:
            d_values.append(w)
        if c is not None:
            d_values.append(c)
        if ks is not None:
            ks_values.append(ks)

    d = float(np.mean(d_values)) if d_values else None
    ks_max = float(max(ks_values)) if ks_values else None
    return {"D": d, "ks_max": ks_max, "per_component": per_component}


# ─── SDS (point estimate) ───────────────────────────────────────────────────────────────────────

def compute_sds(samples: list[StrategySamples], origin_indices: list[int] | None = None) -> dict:
    """One pass over all pairs. Returns None sds when there are no intra-family pairs (every
    strategy is its own family) or no inter-family pairs (only one family present) — an
    undefined ratio must never be silently reported as a number.

    `origin_indices` (bootstrap-only, see bootstrap_sds): when a cluster/case bootstrap resample
    draws the SAME underlying strategy into two different positions, comparing it to itself is
    not new information — it is a degenerate D=0 pair that, at small per-family N (e.g. the ~3
    members/family typical of this corpus), can dominate mean_intra_D and blow up SDS spuriously
    (verified empirically against a synthetic no-real-difference fixture during harness
    validation — see docs/designs/fvg-identity-dispatch-experiment-2026-07-05.md follow-up
    notes). When supplied, any pair whose two samples share the same `origin_indices` value is
    excluded entirely (neither intra nor inter) rather than being silently zero-filled.
    """
    ids = [s.strategy_id for s in samples]
    bounds = {comp: _global_bounds(samples, comp) for comp in COMPONENTS}

    n = len(samples)
    intra: list[float] = []
    inter: list[float] = []
    pair_details: list[dict] = []

    for i in range(n):
        for j in range(i + 1, n):
            if origin_indices is not None and origin_indices[i] == origin_indices[j]:
                continue  # bootstrap self-duplicate pair — excluded, not zero-filled
            pd = pairwise_distance(samples[i], samples[j], bounds)
            if pd["D"] is None:
                continue
            pair_details.append({"i": ids[i], "j": ids[j], **pd})
            if samples[i].family == samples[j].family:
                intra.append(pd["D"])
            else:
                inter.append(pd["D"])

    mean_intra = float(np.mean(intra)) if intra else None
    mean_inter = float(np.mean(inter)) if inter else None
    sds = (mean_inter / mean_intra) if (mean_intra and mean_intra > 0 and mean_inter is not None) else None

    return {
        "n_strategies": n,
        "n_families": len({s.family for s in samples}),
        "n_intra_pairs": len(intra),
        "n_inter_pairs": len(inter),
        "mean_intra_D": mean_intra,
        "mean_inter_D": mean_inter,
        "sds": sds,
        "pair_details": pair_details,
    }


# ─── Bootstrap (small-N guard, hard requirement) ───────────────────────────────────────────────

def bootstrap_sds(
    samples: list[StrategySamples],
    n_boot: int = DEFAULT_N_BOOTSTRAP,
    ci_pct: float = DEFAULT_CI_PCT,
    seed: int = 42,
) -> dict:
    """Resample the STRATEGY SET with replacement (same N per resample; cluster/case bootstrap,
    not a per-trade bootstrap), recompute SDS on each resample, and report a percentile CI +
    stability. A resampled slot can duplicate the same underlying strategy in two positions —
    that pair legitimately contributes an intra-family D=0 "self" comparison to the resample's
    average; this is a documented, expected bootstrap artifact (not a bug), and is exactly why a
    single point estimate is never trusted alone at this sample size."""
    rng = np.random.default_rng(seed)
    n = len(samples)
    boot_sds: list[float] = []
    self_dup_fracs: list[float] = []
    total_pairs = (n * (n - 1)) / 2 if n > 1 else 0

    for _ in range(n_boot):
        idx = rng.integers(0, n, size=n)
        resampled = [samples[k] for k in idx]
        # origin_indices=idx.tolist() excludes self-duplicate pairs (see compute_sds docstring)
        # instead of letting them silently zero-fill mean_intra_D — verified necessary at this
        # corpus's typical ~3-members-per-family scale (see module docstring bootstrap note).
        res = compute_sds(resampled, origin_indices=idx.tolist())
        if res["sds"] is not None:
            boot_sds.append(res["sds"])
        # Diagnostic (reported even though the pairs above are now excluded, not zero-filled):
        # how much of each resample's PAIR SPACE was self-duplicate and therefore discarded.
        # High fractions mean a meaningful chunk of that resample's potential pairs contributed
        # no information — the CI is effectively built from fewer independent comparisons than
        # `n` would suggest.
        if total_pairs > 0:
            dup_pairs = sum(1 for a in range(n) for b in range(a + 1, n) if idx[a] == idx[b])
            self_dup_fracs.append(dup_pairs / total_pairs)

    if not boot_sds:
        return {
            "n_boot_requested": n_boot, "n_boot_valid": 0,
            "ci_pct": ci_pct, "ci_low": None, "ci_high": None,
            "median": None, "mean": None, "coefficient_of_variation": None,
            "stability_frac_above_1": None, "avg_self_duplicate_pair_frac": None,
        }

    arr = np.array(boot_sds)
    lo_pct = (1 - ci_pct) / 2 * 100
    hi_pct = 100 - lo_pct
    mean = float(arr.mean())
    std = float(arr.std())
    return {
        "n_boot_requested": n_boot,
        "n_boot_valid": len(boot_sds),
        "ci_pct": ci_pct,
        "ci_low": float(np.percentile(arr, lo_pct)),
        "ci_high": float(np.percentile(arr, hi_pct)),
        "median": float(np.median(arr)),
        "mean": mean,
        "coefficient_of_variation": (std / mean) if mean else None,
        "stability_frac_above_1": float(np.mean(arr > NO_CHANGE_SDS)),
        "avg_self_duplicate_pair_frac": float(np.mean(self_dup_fracs)) if self_dup_fracs else None,
    }


# ─── Top-level report ───────────────────────────────────────────────────────────────────────────

def compute_sds_report(
    manifest: dict,
    n_boot: int = DEFAULT_N_BOOTSTRAP,
    seed: int = 42,
    small_n_threshold: int = DEFAULT_SMALL_N_THRESHOLD,
) -> dict:
    strategies = manifest.get("strategies", {})
    samples = [extract_samples(sid, entry) for sid, entry in strategies.items()]
    samples = [s for s in samples if s.n_trades > 0]
    n = len(samples)

    point = compute_sds(samples)
    boot = bootstrap_sds(samples, n_boot=n_boot, seed=seed)

    small_n = n < small_n_threshold
    caveat = (
        f"SMALL-N CAVEAT: n={n} strategies is below the {small_n_threshold}-strategy asymptotic "
        "bootstrap threshold. Treat the 90% CI width and stability_frac_above_1 as the primary "
        "evidence — a large point-estimate SDS with a CI that includes 1.0 (no-change) or a low "
        "stability_frac_above_1 does NOT count as identity preservation."
        if small_n else
        f"n={n} strategies meets the {small_n_threshold}-strategy threshold; small-N caveat does not apply."
    )
    dup_frac = boot.get("avg_self_duplicate_pair_frac")
    if dup_frac is not None and dup_frac > 0.10:
        caveat += (
            f" ADDITIONAL: average {dup_frac:.0%} of each bootstrap resample's potential pairs "
            "were self-duplicate (same strategy drawn twice) and excluded — a symptom of small "
            "per-family strategy counts (this corpus averages ~3 members/family). The CI is "
            "built from fewer effectively-independent comparisons than n suggests."
        )

    verdict = VERDICT_INDETERMINATE
    if point["sds"] is not None and boot["ci_low"] is not None:
        ci_excludes_no_change = boot["ci_low"] > NO_CHANGE_SDS
        rose = point["sds"] > NO_CHANGE_SDS
        if rose and ci_excludes_no_change:
            verdict = VERDICT_ROSE_STABLE
        elif rose:
            verdict = VERDICT_ROSE_UNSTABLE
        else:
            verdict = VERDICT_FLAT_OR_DOWN

    return {
        "n_strategies": n,
        "small_n_threshold": small_n_threshold,
        "small_n_caveat": caveat,
        "point_estimate": point,
        "bootstrap": boot,
        "verdict": verdict,
    }


# ─── CLI ─────────────────────────────────────────────────────────────────────────────────────────

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--manifest", required=True, help="JSON manifest (see module docstring for shape)")
    ap.add_argument("--out", default=None, help="write the full report JSON here")
    ap.add_argument("--n-boot", type=int, default=DEFAULT_N_BOOTSTRAP)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--small-n-threshold", type=int, default=DEFAULT_SMALL_N_THRESHOLD)
    args = ap.parse_args()

    manifest = json.loads(Path(args.manifest).read_text(encoding="utf-8"))
    report = compute_sds_report(
        manifest, n_boot=args.n_boot, seed=args.seed, small_n_threshold=args.small_n_threshold
    )

    summary = {
        "n_strategies": report["n_strategies"],
        "n_families": report["point_estimate"]["n_families"],
        "sds_point_estimate": report["point_estimate"]["sds"],
        "ci_90": [report["bootstrap"]["ci_low"], report["bootstrap"]["ci_high"]],
        "stability_frac_above_1": report["bootstrap"]["stability_frac_above_1"],
        "verdict": report["verdict"],
        "caveat": report["small_n_caveat"],
    }
    print(json.dumps(summary, indent=2), file=sys.stderr)

    if args.out:
        # pair_details can be large — keep it in the file output but not stdout.
        Path(args.out).write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")
        print(f"\nwrote {args.out}", file=sys.stderr)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
