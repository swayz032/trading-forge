"""Corpus-level False-Discovery-Rate control (Roadmap Band D, item D2).

WHY THIS FILE EXISTS
---------------------
The per-strategy gate battery (CPCV, PBO < 15%, full-Bailey DSR, WFE >= 0.70,
B14 ruin ci_high, B15 jitter, BIF) is institutional and evaluates ONE strategy
at a time against its own history. It cannot see the population it was drawn
from. When ~200 compiled strategies are evaluated and "12 of 200 passed", that
sentence is not yet a statistically honest claim — some non-zero number of
those 12 are expected to pass BY CHANCE even if every strategy in the corpus
had zero real edge, purely because the corpus is large and each strategy is
one implicit "trial" against the battery.

This module is the layer ABOVE the per-strategy gates:
  (a) Benjamini-Hochberg (1995) false-discovery-rate control across the
      population of per-strategy p-value-like inputs.
  (b) A Harvey-Liu-Zhu (2016)-style multiple-testing Sharpe haircut as a
      second, complementary, non-p-value lens.
  (c) Per-educator-family grouping (an educator with 1-of-8 strategies
      passing is a different signal than 8-of-8).
  (d) Expected-false-discoveries E[FD] = corpus_size x measured full-battery
      false-pass rate, sourced from the null-calibration harness
      (scripts/null_gate_calibration.py + docs/gate-battery-calibration.md).
      When the noise floor has not been measured yet, this module refuses to
      assume zero and says so loudly.

DESIGN CONSTRAINTS (mirrors src/engine/walk_forward_regime_context.py):
  - Pure functional. No I/O in the math. No DB access, no file reads, no
    time.now(), no side effects. Same inputs -> same outputs, always.
  - No scipy dependency. Python's stdlib `math.erf`/`math.erfc` give an exact
    (not approximated) standard-normal CDF, and the inverse (probit) is
    obtained via deterministic bisection on that exact CDF (fixed iteration
    count/tolerance -> still fully deterministic and replay-safe).
  - Env-overridable thresholds via lru_cache getters, same pattern as
    walk_forward_regime_context.py's `_get_cv_threshold()` etc.
  - Never fabricate. Missing evidence is reported as missing, not defaulted
    to a value that could silently bias the FDR calculation (see the p-value
    ladder below, and `expected_false_discoveries()`'s NOISE FLOOR NOT YET
    MEASURED path).

P-VALUE LADDER (exact precedence — see `derive_pvalue_for_strategy()`):
  1. `pbo_overall_p_value` (Bailey et al. rank-based PBO p-value, computed by
     src/engine/pbo_gate.py and surfaced at wf_result["pbo_overall_p_value"]
     / backtests.gate_result). This is the PREFERRED source: it is a direct,
     already-computed p-value under the null hypothesis of "OOS rank is
     uniformly distributed" (no backtest-overfitting skill).
  2. DSR-derived p-value. wf_metadata["dsr"] (see src/engine/risk_metrics.py
     `compute_deflated_sharpe_ratio`) is the DSR TEST STATISTIC (a z-score),
     not a probability by itself — but the codebase's own p_value formula is
     `p_value = 1 - Phi(dsr)` (risk_metrics.py:566), a one-line transform of a
     value that IS already persisted. We recompute that transform here using
     the exact stdlib normal CDF so a p-value is available even when the
     upstream helper's own `p_value` field wasn't threaded through to
     wf_metadata (today only `dsr` and `dsr_pass` survive persistence).
  3. Neither present -> `p_value=None`, `source="missing"`. The strategy is
     EXCLUDED from the BH ranking (never assigned a fabricated p=1.0 or
     p=0.5), and the exclusion is counted and reported loudly by
     `build_corpus_report()` / the calling script.

Reference: Benjamini, Y. & Hochberg, Y. (1995) "Controlling the False
Discovery Rate", J. R. Statist. Soc. B 57(1):289-300.
Reference: Harvey, C.R., Liu, Y. & Zhu, H. (2016) "...and the Cross-Section
of Expected Returns", Review of Financial Studies 29(1):5-68 (haircut
methodology — see `compute_sharpe_haircut()` docstring for the specific
closed-form proxy used here in place of HLZ's empirical benchmark table).
Reference: Bailey, D.H. & Lopez de Prado, M. (2014) "The Sharpe Ratio
Efficient Frontier", Journal of Risk 15(2):3-44 (E[max Sharpe] closed form,
same formula already used by src/engine/statistics/backtest_inflation_factor.py
and src/engine/risk_metrics.py::compute_deflated_sharpe_ratio).
"""

from __future__ import annotations

import math
import os
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Optional


# ── Env-overridable constants (lru_cache getters, mirrors walk_forward_regime_context.py) ──

@lru_cache(maxsize=None)
def _get_default_q_research() -> float:
    """Research-triage FDR level (default 0.10). Env: CORPUS_FDR_Q_RESEARCH."""
    try:
        return float(os.environ.get("CORPUS_FDR_Q_RESEARCH", "0.10"))
    except (ValueError, TypeError):
        return 0.10


@lru_cache(maxsize=None)
def _get_default_q_promotion() -> float:
    """Promotion-relevant FDR level (default 0.05). Env: CORPUS_FDR_Q_PROMOTION."""
    try:
        return float(os.environ.get("CORPUS_FDR_Q_PROMOTION", "0.05"))
    except (ValueError, TypeError):
        return 0.05


@lru_cache(maxsize=None)
def _get_default_population(default: int = 200) -> float:
    """Default corpus-size projection when caller doesn't supply one. Env: CORPUS_FDR_POPULATION."""
    try:
        return float(os.environ.get("CORPUS_FDR_POPULATION", str(default)))
    except (ValueError, TypeError):
        return float(default)


# ── Exact standard-normal CDF/SF via stdlib math.erf (no scipy) ───────────────

_SQRT2 = math.sqrt(2.0)
_EULER_MASCHERONI = 0.5772156649  # gamma, same constant used in risk_metrics.py


def _std_normal_cdf(x: float) -> float:
    """Phi(x) — standard normal CDF. Exact (not a rational approximation)."""
    return 0.5 * (1.0 + math.erf(x / _SQRT2))


def _std_normal_sf(x: float) -> float:
    """1 - Phi(x), computed via erfc for numerical stability in the far tail."""
    return 0.5 * math.erfc(x / _SQRT2)


def _probit(p: float, tol: float = 1e-12, max_iter: int = 200) -> float:
    """Inverse standard-normal CDF (probit) via deterministic bisection.

    Fixed tolerance + fixed max iteration count -> fully deterministic and
    replay-safe (no scipy.stats.norm.ppf dependency). Precision is far beyond
    what any Sharpe-ratio-scale calculation needs (tol=1e-12 on the z-scale).
    """
    if p <= 0.0:
        return -math.inf
    if p >= 1.0:
        return math.inf
    if p == 0.5:
        return 0.0
    lo, hi = -40.0, 40.0  # Phi(-40) / Phi(40) are indistinguishable from 0/1 in float64
    for _ in range(max_iter):
        mid = (lo + hi) / 2.0
        if _std_normal_cdf(mid) < p:
            lo = mid
        else:
            hi = mid
        if hi - lo < tol:
            break
    return (lo + hi) / 2.0


def _expected_max_sharpe(n_trials: float) -> float:
    """E[max Sharpe] under H0 across n_trials IID zero-edge trials.

    Bailey & Lopez de Prado (2014), same closed form already used by
    backtest_inflation_factor.py and risk_metrics.py::compute_deflated_sharpe_ratio:
        E[maxSR] = (1-gamma)*Phi^-1(1 - 1/N) + gamma*Phi^-1(1 - 1/(N*e))
    """
    if n_trials <= 1.0:
        return 0.0
    return (
        (1.0 - _EULER_MASCHERONI) * _probit(1.0 - 1.0 / n_trials)
        + _EULER_MASCHERONI * _probit(1.0 - 1.0 / (n_trials * math.e))
    )


# ── P-value derivation ladder ──────────────────────────────────────────────────

@dataclass
class PValueDerivation:
    """Result of deriving a usable p-value for one strategy.

    p_value : float | None
        None when no usable source was found (strategy excluded from BH).
    source : str
        "pbo_overall_p_value" | "dsr_derived_from_test_statistic" | "missing"
    detail : dict
        Diagnostic trail (which raw fields were inspected/used).
    """
    p_value: Optional[float]
    source: str
    detail: dict = field(default_factory=dict)


def derive_pvalue_for_strategy(battery_output: dict) -> PValueDerivation:
    """Derive one p-value per the documented ladder (module docstring).

    Args:
        battery_output: dict with (any subset of) the keys a `backtests` row
            or `run_walk_forward()` result dict carries:
              - "pbo_overall_p_value": float | None   (preferred)
              - "wf_metadata": {"dsr": float | None, "dsr_pass": bool | None,
                                 "dsr_unavailable": bool}
            Callers may pass either a flat dict (already-extracted fields) or
            the full nested wf_result / backtests-row shape; both are read
            defensively via .get() so a partial or legacy record degrades to
            "missing" rather than raising.

    Returns:
        PValueDerivation
    """
    pbo_p = battery_output.get("pbo_overall_p_value")
    if pbo_p is not None and isinstance(pbo_p, (int, float)) and math.isfinite(float(pbo_p)):
        p = float(pbo_p)
        if 0.0 <= p <= 1.0:
            return PValueDerivation(
                p_value=round(p, 8),
                source="pbo_overall_p_value",
                detail={"raw_pbo_overall_p_value": p},
            )
        # Out-of-range value is corrupt data, not usable — fall through to DSR.

    wf_meta = battery_output.get("wf_metadata") or {}
    dsr_stat = wf_meta.get("dsr")
    dsr_unavailable = bool(wf_meta.get("dsr_unavailable", False))
    if (
        not dsr_unavailable
        and dsr_stat is not None
        and isinstance(dsr_stat, (int, float))
        and math.isfinite(float(dsr_stat))
    ):
        p = _std_normal_sf(float(dsr_stat))
        return PValueDerivation(
            p_value=round(p, 8),
            source="dsr_derived_from_test_statistic",
            detail={"raw_dsr_test_statistic": float(dsr_stat), "formula": "p = 1 - Phi(dsr)"},
        )

    return PValueDerivation(
        p_value=None,
        source="missing",
        detail={
            "reason": "neither pbo_overall_p_value nor a usable wf_metadata.dsr test statistic present",
            "pbo_overall_p_value_raw": pbo_p,
            "dsr_raw": dsr_stat,
            "dsr_unavailable": dsr_unavailable,
        },
    )


# ── Benjamini-Hochberg FDR control ─────────────────────────────────────────────

@dataclass
class BHResult:
    n: int
    q: float
    num_rejected: int
    reject_mask: list  # list[bool], same order as input p_values
    adjusted_p_values: list  # list[float], BH step-up adjusted (a.k.a. q-values), same order
    critical_p_at_cutoff: Optional[float]


def benjamini_hochberg(p_values: list[float], q: float) -> BHResult:
    """Benjamini-Hochberg (1995) step-up FDR procedure.

    Args:
        p_values: raw p-values (already-derived, no None entries — caller must
            filter out `derive_pvalue_for_strategy()` results with p_value=None
            BEFORE calling this; BH is undefined for missing p-values).
        q: target false-discovery-rate level (e.g. 0.05 or 0.10).

    Returns:
        BHResult with:
          - reject_mask[i] = True  -> strategy i's p-value is a BH-significant
            discovery at level q (i.e. distinguishable from the population of
            chance results at the target FDR).
          - adjusted_p_values[i] = the BH-adjusted p-value ("q-value"): the
            smallest q at which strategy i would be rejected. Monotone
            non-decreasing when read in ascending-p order (guaranteed by the
            running-minimum step below).

    Algorithm: sort p ascending -> p_(1) <= p_(2) <= ... <= p_(n). Find the
    largest k such that p_(k) <= (k/n)*q. Reject all p_(1..k). Adjusted
    p-values (q-values) via the standard monotone-enforcing formula:
        q_(i) = min_{j >= i} ( (n/j) * p_(j) ), clipped to [0, 1].
    """
    n = len(p_values)
    if n == 0:
        return BHResult(n=0, q=q, num_rejected=0, reject_mask=[], adjusted_p_values=[], critical_p_at_cutoff=None)

    indexed = sorted(range(n), key=lambda i: p_values[i])
    sorted_p = [p_values[i] for i in indexed]

    rejected_upto = -1  # index into sorted order, inclusive
    for k in range(n):
        critical = ((k + 1) / n) * q
        if sorted_p[k] <= critical:
            rejected_upto = k

    reject_mask_sorted = [False] * n
    if rejected_upto >= 0:
        for k in range(rejected_upto + 1):
            reject_mask_sorted[k] = True

    # BH-adjusted p-values (q-values): monotone non-decreasing from the top down.
    adj_sorted = [0.0] * n
    running_min = 1.0
    for k in range(n - 1, -1, -1):
        candidate = sorted_p[k] * n / (k + 1)
        running_min = min(running_min, candidate)
        adj_sorted[k] = min(running_min, 1.0)

    # Map back to original order.
    reject_mask = [False] * n
    adjusted_p_values = [0.0] * n
    for k in range(n):
        orig_idx = indexed[k]
        reject_mask[orig_idx] = reject_mask_sorted[k]
        adjusted_p_values[orig_idx] = round(adj_sorted[k], 6)

    return BHResult(
        n=n,
        q=q,
        num_rejected=rejected_upto + 1,
        reject_mask=reject_mask,
        adjusted_p_values=adjusted_p_values,
        critical_p_at_cutoff=sorted_p[rejected_upto] if rejected_upto >= 0 else None,
    )


# ── Harvey-Liu-Zhu-style Sharpe haircut ────────────────────────────────────────

def compute_sharpe_haircut(observed_sharpe: float, n_trials: float) -> dict:
    """Harvey-Liu-Zhu (2016)-style multiple-testing Sharpe haircut.

    METHODOLOGY NOTE (read before citing this as "the HLZ haircut"): Harvey,
    Liu & Zhu (2016) compute haircuts against an EMPIRICALLY-FITTED benchmark
    distribution built from ~300 previously-published risk factors (their
    Bonferroni / Holm / BHY-adjusted t-stat thresholds are calibrated to that
    specific dataset). We do not have that empirical benchmark in this
    codebase, and fabricating one would violate the "never fabricate" rule.

    Instead this function applies the closed-form Bailey & Lopez de Prado
    (2014) expected-max-Sharpe-under-H0 correction — the SAME E[maxSR] formula
    already used by src/engine/statistics/backtest_inflation_factor.py (BIF)
    and src/engine/risk_metrics.py::compute_deflated_sharpe_ratio (DSR) — as a
    deterministic, theoretically-grounded proxy for "how much of this Sharpe
    could be multiple-testing artifact given n_trials attempts." This is a
    complementary LENS to the BH p-value ranking above, not a replacement:
    BH answers "is this specific strategy distinguishable from the corpus
    noise floor", while the haircut answers "how much of its raw Sharpe
    survives once we price in how many strategies were tried."

    Args:
        observed_sharpe: the strategy's realized (OOS/WF) Sharpe ratio.
        n_trials: effective number of trials the strategy was selected from
            (corpus size, or per-educator strategy count — caller's choice;
            report both lenses per docs/corpus-fdr-standard.md).

    Returns:
        dict with observed_sharpe, n_trials, expected_max_sharpe_h0,
        haircut_sharpe (>= 0, never fabricated negative), haircut_pct,
        verdict in {"survives_haircut", "haircut_eliminates_edge",
        "no_positive_edge", "non_finite_input"}.
    """
    if not math.isfinite(observed_sharpe):
        return {
            "observed_sharpe": observed_sharpe,
            "n_trials": n_trials,
            "expected_max_sharpe_h0": None,
            "haircut_sharpe": 0.0,
            "haircut_pct": None,
            "verdict": "non_finite_input",
        }

    n_eff = max(float(n_trials), 1.0)
    expected_max = _expected_max_sharpe(n_eff)

    if observed_sharpe <= 0.0:
        return {
            "observed_sharpe": round(observed_sharpe, 6),
            "n_trials": round(n_eff, 4),
            "expected_max_sharpe_h0": round(expected_max, 6),
            "haircut_sharpe": 0.0,
            "haircut_pct": None,
            "verdict": "no_positive_edge",
        }

    haircut_sharpe = max(0.0, observed_sharpe - expected_max)
    haircut_pct = round(1.0 - (haircut_sharpe / observed_sharpe), 6)
    verdict = "survives_haircut" if haircut_sharpe > 0.0 else "haircut_eliminates_edge"

    return {
        "observed_sharpe": round(observed_sharpe, 6),
        "n_trials": round(n_eff, 4),
        "expected_max_sharpe_h0": round(expected_max, 6),
        "haircut_sharpe": round(haircut_sharpe, 6),
        "haircut_pct": haircut_pct,
        "verdict": verdict,
    }


# ── Per-educator-family grouping ───────────────────────────────────────────────

@dataclass
class FamilyFDRResult:
    educator_id: Optional[str]
    n_strategies: int
    n_with_pvalue: int
    n_excluded_missing_pvalue: int
    bh: BHResult


def compute_family_grouped_fdr(
    strategy_records: list[dict],
    q: float,
) -> dict:
    """Compute BH FDR both WITHIN each educator family AND corpus-wide.

    Args:
        strategy_records: list of dicts, each with at minimum:
            {"strategy_id": str, "educator_id": str | None, "p_value": float | None}
            (i.e. the output of `derive_pvalue_for_strategy()` merged onto a
            strategy identity — see `build_corpus_report()` for the exact
            assembly the calling script performs).
        q: target FDR level.

    Returns:
        {
          "corpus_wide": BHResult (as dict via _bh_to_dict),
          "per_family": {educator_id_or_"__none__": FamilyFDRResult (as dict)},
        }

    An educator with 1-of-8 strategies passing BH is a DIFFERENT signal than
    an educator with 8-of-8 passing — corpus-wide BH alone would treat both
    identically if the p-value magnitudes happen to line up; per-family BH
    surfaces educator-level clustering of genuine edge vs. educator-level
    clustering of overfit noise (e.g. one educator's whole catalog is built
    on one curve-fit indicator).
    """
    with_p = [r for r in strategy_records if r.get("p_value") is not None]
    without_p = [r for r in strategy_records if r.get("p_value") is None]

    corpus_p = [float(r["p_value"]) for r in with_p]
    corpus_bh = benjamini_hochberg(corpus_p, q)

    # Group by educator_id (None -> bucket key "__none__").
    groups: dict[str, list[dict]] = {}
    for r in strategy_records:
        key = r.get("educator_id") if r.get("educator_id") is not None else "__none__"
        groups.setdefault(key, []).append(r)

    per_family: dict[str, dict] = {}
    for educator_id, records in groups.items():
        fam_with_p = [r for r in records if r.get("p_value") is not None]
        fam_p = [float(r["p_value"]) for r in fam_with_p]
        fam_bh = benjamini_hochberg(fam_p, q)
        result = FamilyFDRResult(
            educator_id=None if educator_id == "__none__" else educator_id,
            n_strategies=len(records),
            n_with_pvalue=len(fam_with_p),
            n_excluded_missing_pvalue=len(records) - len(fam_with_p),
            bh=fam_bh,
        )
        per_family[educator_id] = _family_result_to_dict(result)

    return {
        "corpus_wide": _bh_to_dict(corpus_bh),
        "corpus_wide_n_excluded_missing_pvalue": len(without_p),
        "per_family": per_family,
    }


def _bh_to_dict(bh: BHResult) -> dict:
    return {
        "n": bh.n,
        "q": bh.q,
        "num_rejected": bh.num_rejected,
        "reject_mask": bh.reject_mask,
        "adjusted_p_values": bh.adjusted_p_values,
        "critical_p_at_cutoff": bh.critical_p_at_cutoff,
    }


def _family_result_to_dict(f: FamilyFDRResult) -> dict:
    return {
        "educator_id": f.educator_id,
        "n_strategies": f.n_strategies,
        "n_with_pvalue": f.n_with_pvalue,
        "n_excluded_missing_pvalue": f.n_excluded_missing_pvalue,
        "bh": _bh_to_dict(f.bh),
    }


# ── Expected false discoveries (consumes null_gate_calibration.py's output) ────

def expected_false_discoveries(
    corpus_size: int,
    calibration_report: Optional[dict],
) -> dict:
    """E[FD] = corpus_size x measured full-battery false-pass rate.

    Args:
        corpus_size: number of strategies being evaluated this run.
        calibration_report: the parsed contents of
            `null_calibration_report.json` as produced by
            `scripts/null_gate_calibration.py::compute_calibration_report()`,
            or None if that batch has not been run yet. Expected shape (only
            the "full_battery" sub-dict is read):
                {
                  "full_battery": {
                    "passes": int, "trials": int, "rate": float,
                    "ci_95_lower": float, "ci_95_upper": float, ...
                  },
                  "n_complete": int, "gate_battery_version": str, ...
                }

    Returns:
        When calibration_report is None or its "full_battery" trials == 0:
            {"measured": False, "message": "NOISE FLOOR NOT YET MEASURED...",
             "expected_false_discoveries": None,
             "expected_false_discoveries_upper": None, "corpus_size": ...}
        This is INTENTIONAL — assuming a false-pass rate of 0.0 when it has
        never been measured would silently understate E[FD] and let a
        corpus-scale claim through unchallenged. The docs/report must not
        claim "excess = 0" is meaningful in that state.

        When measured:
            {"measured": True, "false_pass_rate": float,
             "false_pass_rate_ci_upper": float | None, "corpus_size": int,
             "expected_false_discoveries": float,
             "expected_false_discoveries_upper": float | None,
             "n_calibration_nulls": int | None,
             "gate_battery_version": str | None}
    """
    fb = (calibration_report or {}).get("full_battery") or {}
    trials = fb.get("trials", 0)

    if not calibration_report or not trials:
        return {
            "measured": False,
            "message": (
                "NOISE FLOOR NOT YET MEASURED — run "
                "`TF_ALLOW_FIXED_1=true python scripts/null_gate_calibration.py --n 100 --seed 42` "
                "(N=100 recommended minimum, ~2-3 hours) before trusting any corpus-level pass "
                "count. Expected false discoveries is UNKNOWN, not zero — do not report "
                "'excess = raw_passes' as if the noise floor were 0."
            ),
            "expected_false_discoveries": None,
            "expected_false_discoveries_upper": None,
            "corpus_size": corpus_size,
        }

    rate = fb.get("rate", 0.0)
    # Wilson CI upper bound key is named f"ci_{int(confidence*100)}_upper" by the
    # calibration harness (default confidence=0.95 -> "ci_95_upper"). Fall back to a
    # generic "ci_upper" key defensively in case a future confidence level is used.
    ci_upper = fb.get("ci_95_upper", fb.get("ci_upper"))

    return {
        "measured": True,
        "false_pass_rate": rate,
        "false_pass_rate_ci_upper": ci_upper,
        "corpus_size": corpus_size,
        "expected_false_discoveries": round(rate * corpus_size, 2),
        "expected_false_discoveries_upper": (
            round(ci_upper * corpus_size, 2) if ci_upper is not None else None
        ),
        "n_calibration_nulls": calibration_report.get("n_complete", calibration_report.get("n_nulls")),
        "gate_battery_version": calibration_report.get("gate_battery_version"),
    }


# ── Regime-breakdown attachment (D4) ───────────────────────────────────────────

def attach_regime_breakdown(strategy_record: dict) -> dict:
    """Attach whatever regime-stratified performance data actually exists.

    HONEST GAP (do not silently paper over): the codebase has TWO regime
    taxonomies that do not currently connect:

      1. `backtests.mrp_regime_breakdown` (B10 Minimum Regime Performance gate,
         `src/server/db/schema.ts` around the `backtests` table) — a
         {regime: sharpe} dict computed post-backtest from
         `backtestTrades.macroRegime` groupings. The regime labels here are
         the MACRO taxonomy (RISK_ON | RISK_OFF | TIGHTENING | EASING |
         STAGFLATION | GOLDILOCKS | TRANSITION | TRANSITION-adjacent labels
         from macro-gate-service.ts / macro_snapshots.macro_regime). This IS
         persisted per-backtest and IS what this function surfaces.

      2. The 5-class INSTITUTIONAL regime (TRENDING | EXPANSION | COMPRESSION
         | HIGH_VOL_MACRO | RANGE_BOUND | LOW_LIQ_CHOP) from
         `classify_institutional_regime()` (Wave 25 Pass 6, bias_engine.py) —
         this is computed LIVE at signal time and persisted only as a single
         current-state value (`bias_state.regime_label` / a strategy's
         `regime_trained_on` snapshot at freeze time). There is NO historical
         per-trade or per-backtest breakdown of institutional-5-class-regime
         performance anywhere in the schema today.

    This function reports (1) verbatim when present, and explicitly names gap
    (2) rather than fabricating a 5-class breakdown that does not exist.

    Args:
        strategy_record: dict expected to optionally carry
            "mrp_regime_breakdown": {regime: sharpe} | None
            (read directly from the strategy's latest `backtests` row).

    Returns:
        {
          "macro_regime_breakdown": {regime: sharpe} | None,
          "macro_regime_taxonomy": "macro_regime_6class_risk_on_off_etc",
          "institutional_5class_breakdown": None,
          "institutional_5class_gap": "<explanation string, always present>",
        }
    """
    macro_breakdown = strategy_record.get("mrp_regime_breakdown")
    return {
        "macro_regime_breakdown": macro_breakdown,
        "macro_regime_taxonomy": "macro_regime_6class_risk_on_off_etc" if macro_breakdown else None,
        "institutional_5class_breakdown": None,
        "institutional_5class_gap": (
            "The 5-class institutional regime (TRENDING/EXPANSION/COMPRESSION/"
            "HIGH_VOL_MACRO/RANGE_BOUND/LOW_LIQ_CHOP, classify_institutional_regime() "
            "in bias_engine.py) is not persisted per-trade or per-backtest anywhere in "
            "the schema — only a live current-state value (bias_state.regime_label) and "
            "a single freeze-time snapshot (strategies.regime_trained_on) exist. Only the "
            "macro (RISK_ON/RISK_OFF/etc) taxonomy has a historical per-backtest Sharpe "
            "breakdown (backtests.mrp_regime_breakdown, B10 gate). See "
            "docs/corpus-fdr-standard.md 'Regime-attribution gap' for the coordination note."
        ),
    }


# ── Full corpus report assembly (pure — no I/O; caller supplies all data) ──────

def build_corpus_report(
    strategy_records: list[dict],
    calibration_report: Optional[dict],
    q_research: Optional[float] = None,
    q_promotion: Optional[float] = None,
) -> dict:
    """Assemble the full D2+D4 corpus report from pre-loaded strategy records.

    This is the ONE function scripts/corpus-fdr-report.(py|ts) calls after
    doing all I/O (DB reads, calibration-report file read). Nothing in this
    function touches a DB connection, a filesystem, or the clock.

    Args:
        strategy_records: list of dicts, one per strategy, each with:
            "strategy_id": str
            "educator_id": str | None
            "gate_verdict": str  (e.g. "passed_all_gates" | "failed" | ...)
            "battery_output": dict  (fed to derive_pvalue_for_strategy())
            "observed_sharpe": float | None  (for the haircut lens)
            "mrp_regime_breakdown": dict | None  (for D4)
        calibration_report: parsed null_calibration_report.json or None.
        q_research: FDR level for research-triage claims (default from env,
            CORPUS_FDR_Q_RESEARCH, else 0.10).
        q_promotion: FDR level for promotion-relevant claims (default from
            env, CORPUS_FDR_Q_PROMOTION, else 0.05).

    Returns:
        Full report dict — see docs/corpus-fdr-standard.md for field-by-field
        interpretation guidance and the decision rules for which q-level
        gates which kind of claim.
    """
    q_research = _get_default_q_research() if q_research is None else q_research
    q_promotion = _get_default_q_promotion() if q_promotion is None else q_promotion

    corpus_size = len(strategy_records)

    # Derive p-values + assemble per-strategy working records.
    working: list[dict] = []
    for rec in strategy_records:
        deriv = derive_pvalue_for_strategy(rec.get("battery_output") or {})
        working.append({
            "strategy_id": rec.get("strategy_id"),
            "educator_id": rec.get("educator_id"),
            "gate_verdict": rec.get("gate_verdict"),
            "p_value": deriv.p_value,
            "p_value_source": deriv.source,
            "p_value_detail": deriv.detail,
            "observed_sharpe": rec.get("observed_sharpe"),
            "mrp_regime_breakdown": rec.get("mrp_regime_breakdown"),
        })

    n_with_pvalue = sum(1 for w in working if w["p_value"] is not None)
    n_missing_pvalue = corpus_size - n_with_pvalue

    fdr_research = compute_family_grouped_fdr(working, q_research)
    fdr_promotion = compute_family_grouped_fdr(working, q_promotion)

    corpus_reject_research = fdr_research["corpus_wide"]["reject_mask"]
    corpus_reject_promotion = fdr_promotion["corpus_wide"]["reject_mask"]

    # Map corpus-wide reject masks back onto `working` in the SAME order BH
    # consumed them: benjamini_hochberg() is fed exactly the with-p-value
    # subset in `working` order (see compute_family_grouped_fdr -> `with_p`),
    # so re-derive that same ordered subset here for a 1:1 zip.
    with_p_indices = [i for i, w in enumerate(working) if w["p_value"] is not None]

    per_strategy: list[dict] = []
    n_gate_passed = 0
    n_bh_significant_promotion = 0
    for i, w in enumerate(working):
        bh_reject_research = None
        bh_reject_promotion = None
        adj_p_research = None
        adj_p_promotion = None
        if w["p_value"] is not None:
            pos = with_p_indices.index(i)
            bh_reject_research = corpus_reject_research[pos]
            bh_reject_promotion = corpus_reject_promotion[pos]
            adj_p_research = fdr_research["corpus_wide"]["adjusted_p_values"][pos]
            adj_p_promotion = fdr_promotion["corpus_wide"]["adjusted_p_values"][pos]

        gate_passed = w["gate_verdict"] == "passed_all_gates"
        if gate_passed:
            n_gate_passed += 1

        # Composition rule (docs/corpus-fdr-standard.md): floor-relative first
        # (did it even gate-pass), then FDR-across-survivors (is it BH-significant
        # at the promotion q-level). A strategy that gate-passed but is not
        # BH-significant at q_promotion is "passed_but_within_noise_floor" —
        # its raw pass is not (yet) statistically distinguishable from a chance
        # pass given how many strategies were evaluated.
        if not gate_passed:
            verdict = "failed"
        elif bh_reject_promotion is True:
            verdict = "passed"
            n_bh_significant_promotion += 1
        else:
            verdict = "passed_but_within_noise_floor"

        haircut = None
        if w["observed_sharpe"] is not None:
            haircut = compute_sharpe_haircut(
                observed_sharpe=float(w["observed_sharpe"]),
                n_trials=float(corpus_size),
            )

        per_strategy.append({
            "strategy_id": w["strategy_id"],
            "educator_id": w["educator_id"],
            "gate_verdict": w["gate_verdict"],
            "p_value": w["p_value"],
            "p_value_source": w["p_value_source"],
            "bh_significant_at_q_research": bh_reject_research,
            "bh_significant_at_q_promotion": bh_reject_promotion,
            "bh_adjusted_p_research": adj_p_research,
            "bh_adjusted_p_promotion": adj_p_promotion,
            "sharpe_haircut": haircut,
            "regime_breakdown": attach_regime_breakdown(w),
            "corpus_verdict": verdict,
        })

    efd = expected_false_discoveries(corpus_size, calibration_report)

    excess = None
    excess_note = "NOISE FLOOR NOT YET MEASURED — excess cannot be computed."
    if efd.get("measured"):
        excess = round(n_gate_passed - efd["expected_false_discoveries"], 2)
        excess_note = None

    headline = (
        f"{n_gate_passed} passes, "
        f"{efd['expected_false_discoveries'] if efd.get('measured') else '?'} expected by chance, "
        f"excess = {excess if excess is not None else '?'}"
        + (f" [ci_upper_chance={efd['expected_false_discoveries_upper']}]" if efd.get("measured") else " [NOISE FLOOR NOT YET MEASURED]")
    )

    return {
        "corpus_size": corpus_size,
        "n_with_pvalue": n_with_pvalue,
        "n_missing_pvalue": n_missing_pvalue,
        "n_gate_passed": n_gate_passed,
        "n_bh_significant_at_q_promotion": n_bh_significant_promotion,
        "q_research": q_research,
        "q_promotion": q_promotion,
        "fdr_research": fdr_research,
        "fdr_promotion": fdr_promotion,
        "expected_false_discoveries": efd,
        "excess_over_chance": excess,
        "excess_note": excess_note,
        "headline": headline,
        "per_strategy": per_strategy,
    }
