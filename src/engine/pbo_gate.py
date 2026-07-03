"""pbo_gate.py — Wave 29 Pass A.2 (backtest-core)

Pure-functional PBO (Probability of Backtest Overfitting) computation.

Institutional 2026 standard:
  - Lopez de Prado, Advances in Financial Machine Learning (2018), Ch. 11
  - QuantBeckman (2025) institutional CPCV guidance
  - arXiv 2512.12924 (2025-12-15): CPCV out-of-sample integrity verification
  - Wikipedia CPCV (2026-01-02 reference)

PBO formula (Bailey et al., 2014):
  For each CPCV path, compare whether the IS-optimal configuration produces
  the highest OOS Sharpe among all paths.

  pbo = P(omega_bar < 0)
    where omega_bar is the average rank of the IS-optimal path's OOS Sharpe
    among all paths, expressed as a logistic-transformed percentile.

  In the discrete CPCV implementation:
    - For each path, assign IS rank (1 = best IS Sharpe, n = worst IS Sharpe)
    - Among paths with the best IS rank (rank=1), count how often the OOS
      Sharpe is below the median OOS Sharpe across all paths.
    - PBO = fraction of those cases / n_paths

  Simplified: PBO = fraction of paths where IS-best path is OOS-below-median.
  High PBO (> 0.5) = more likely overfitting than not.

LIFECYCLE GATE (Wave 29 Pass A.2):
  PBO_OVERFIT_THRESHOLD_PCT (default 0.15) — TESTING → SHADOW/PAPER hard gate.
  Stricter than PBO_OVERFIT_THRESHOLD (0.5) which governs the W27.5 warn audit.

CONSTRAINTS:
  - Pure-functional: no I/O, no DB access, no time.now().
  - Replay-deterministic: same inputs → same output on any run.
  - Consumes CPCV path output from walk_forward.py — no duplicated purge logic.
  - Returns NaN PBO + n_paths + None p_value when n_paths < 4 (sample-size guard).
"""

from __future__ import annotations

# ── Sample-size guard (institutional minimum) ────────────────────────────────
# Below 4 paths the rank-based PBO estimate has unacceptable variance.
# Lopez de Prado recommends ≥ 16 paths (C(6,2)=15 is the CPCV standard).
# We guard at 4 as an absolute floor — caller receives NaN + guard warning.
PBO_MIN_PATHS: int = 4


def compute_pbo_from_cpcv_paths(
    cpcv_paths: list[dict],
) -> dict:
    """Compute PBO from a list of CPCV path dicts.

    Args:
        cpcv_paths: List of dicts with keys:
            - is_sharpe  (float): in-sample Sharpe for this path
            - oos_sharpe (float): out-of-sample Sharpe for this path
            - is_returns (list[float], optional): IS daily returns
            - oos_returns (list[float], optional): OOS daily returns

    Returns:
        dict with:
            pbo        (float):       PBO in [0, 1] or float('nan') when guard fires
            n_paths    (int):         number of paths considered
            p_value    (float|None):  binomial p-value for PBO > 0.5, or None
                                      when < 10 combinations or scipy unavailable

    Pure function — no I/O, no DB, no randomness, no time.now().
    Deterministic: same inputs always produce same output.
    """
    n_paths = len(cpcv_paths)

    # ── Sample-size guard ─────────────────────────────────────────────────────
    if n_paths < PBO_MIN_PATHS:
        return {
            "pbo": float("nan"),
            "n_paths": n_paths,
            "p_value": None,
            "sample_size_guard": True,
            "sample_size_guard_threshold": PBO_MIN_PATHS,
        }

    # ── Extract IS and OOS Sharpes ────────────────────────────────────────────
    is_sharpes: list[float] = []
    oos_sharpes: list[float] = []
    for path in cpcv_paths:
        is_val = path.get("is_sharpe")
        oos_val = path.get("oos_sharpe")
        # Guard against None / missing keys — treat as 0.0
        is_sharpes.append(float(is_val) if is_val is not None else 0.0)
        oos_sharpes.append(float(oos_val) if oos_val is not None else 0.0)

    # FIX 2 — Degenerate IS==OOS guard.
    #
    # Previous behavior: when every path has is_sharpe == oos_sharpe (the fallback
    # case in walk_forward.py where per-path IS Sharpes are unavailable), all IS and
    # OOS ranks are tied. Tied ranks cause overfit_count == 0 → pbo == 0.0, a
    # false-clean result that lets every strategy pass the TESTING→SHADOW gate.
    #
    # New behavior: detect degenerate inputs (all IS == OOS) and return pbo=None.
    # The lifecycle gate's pbo_unavailable_legacy path already handles None → PROCEED
    # with a warn audit. None is correct here: we cannot compute PBO without genuine
    # IS/OOS divergence. 0.0 was a lie — it signals "no overfitting detected" when
    # in fact the measurement was not made.
    #
    # Detection: all(is_sharpe == oos_sharpe) with float comparison (exact equality
    # because walk_forward.py assigns them from the same variable).
    _all_degenerate = all(
        abs(i - o) < 1e-12 for i, o in zip(is_sharpes, oos_sharpes)
    )
    if _all_degenerate:
        return {
            "pbo": None,
            "n_paths": n_paths,
            "p_value": None,
            "degenerate": True,
            "degenerate_reason": (
                "is_sharpe == oos_sharpe for every path — per-path IS Sharpe "
                "was unavailable; PBO requires genuine IS/OOS divergence. "
                "Use None (pbo_unavailable_legacy) rather than false 0.0."
            ),
        }

    # ── PBO computation (Bailey et al. rank-based formula) ───────────────────
    #
    # For each path j, define:
    #   lambda_j      = rank of path j by IS Sharpe  (rank 1 = BEST IS Sharpe)
    #   lambda_hat_j  = rank of path j by OOS Sharpe (rank 1 = BEST OOS Sharpe)
    #
    # Overfit condition (Bailey et al. 2014, Table 11.1):
    #   lambda_j < lambda_hat_j
    #   Path j has a better (lower-numbered) IS rank than OOS rank.
    #   i.e., the path looks better in-sample than it performs out-of-sample.
    #
    # PBO = (1/n) * sum_j [ I(lambda_j < lambda_hat_j) ]
    #
    # High PBO → IS-favorable paths underperform OOS → overfitting likely.
    # PBO = 0.5 = chance performance (50% probability of overfit per path).
    # PBO > 0.5 = IS rank overstates OOS performance (overfitting present).

    # Rank IS Sharpes: rank 1 = best IS Sharpe (descending)
    # Rank OOS Sharpes: rank 1 = best OOS Sharpe (descending)
    # Ties: use average rank (standard competition ranking avoids tie sensitivity).

    def _rank_descending(values: list[float]) -> list[float]:
        """Return 1-based ranks in descending order (1 = highest value).

        Ties receive average rank (e.g., two tied-best values share rank 1.5).
        This is the standard statistical rank transform.
        """
        n = len(values)
        # Create (value, original_index) pairs sorted descending by value
        indexed = sorted(enumerate(values), key=lambda x: x[1], reverse=True)
        ranks = [0.0] * n
        i = 0
        while i < n:
            j = i
            # Find all ties
            while j < n - 1 and indexed[j + 1][1] == indexed[j][1]:
                j += 1
            # Average rank for tied group
            avg_rank = (i + j) / 2.0 + 1.0
            for k in range(i, j + 1):
                ranks[indexed[k][0]] = avg_rank
            i = j + 1
        return ranks

    is_ranks = _rank_descending(is_sharpes)
    oos_ranks = _rank_descending(oos_sharpes)

    # PBO = fraction of paths where IS rank (by number) is LOWER than OOS rank.
    # Rank 1 = BEST. Low IS rank number = high IS Sharpe.
    # Low OOS rank number = high OOS Sharpe.
    #
    # Overfit condition: IS rank < OOS rank in number.
    # Meaning: path looks BETTER in-sample (lower rank number = higher Sharpe)
    # than it looks out-of-sample (higher rank number = lower Sharpe).
    # Example: IS rank=1 (best IS), OOS rank=8 (poor OOS) → 1 < 8 → overfitting.
    #
    # This matches Bailey et al. (2014) Table 11.1 definition:
    #   PBO = P(lambda_bar_j > lambda_j)
    #   where lambda_j is IS rank (1=best) and lambda_bar_j is OOS rank (1=best).
    #   Overfit when IS rank number < OOS rank number (path looks better IS than OOS).
    overfit_count = sum(
        1 for ir, or_ in zip(is_ranks, oos_ranks) if ir < or_
    )
    pbo = overfit_count / n_paths

    # ── Binomial p-value (optional; requires scipy) ───────────────────────────
    # H0: P(IS rank > OOS rank) = 0.5 (chance, no overfitting signal)
    # H1: P(IS rank > OOS rank) > 0.5 (overfitting present)
    # One-tailed binomial test at alpha=0.05.
    # Minimum 10 paths for the binomial test to have power.
    p_value: float | None = None
    if n_paths >= 10:
        try:
            from scipy.stats import binomtest as _binomtest  # type: ignore[import]
            _result = _binomtest(overfit_count, n=n_paths, p=0.5, alternative="greater")
            p_value = float(_result.pvalue)
        except Exception:
            # scipy not available or version too old — p_value stays None
            p_value = None

    return {
        "pbo": pbo,
        "n_paths": n_paths,
        "p_value": p_value,
        "sample_size_guard": False,
        "sample_size_guard_threshold": PBO_MIN_PATHS,
        "overfit_count": overfit_count,
    }


def _build_cpcv_paths_from_window_results(window_results: list[dict]) -> list[dict]:
    """Build CPCV-style path dicts from walk_forward plain-mode window results.

    Plain-mode WF windows have a single IS/OOS split per window.
    We treat each window as a "path" with its OOS Sharpe as oos_sharpe.
    IS Sharpe resolution order (highest priority first):
      1. Optimizer best_score (most accurate — IS is cherry-picked from trials).
      2. Per-window IS daily P&Ls stored under _is_daily_pnls (walk_forward.py
         threads these in during assembly when IS backtests are run for WFE).
         Avoids the degenerate IS==OOS case that fires pbo=None for non-optimize
         plain-WF runs.  (E2, deep-scan #7 2026-07-02)
      3. OOS Sharpe as a last-resort fallback (triggers degenerate guard in
         compute_pbo_from_cpcv_paths → pbo=None → TS gate BLOCKS).

    This allows compute_pbo_from_cpcv_paths to be called from plain-mode WF
    as well as CPCV mode.

    IMPORTANT: This function is called by walk_forward.py aggregation ONLY.
    It does not do any purging — purging is the caller's responsibility.
    """
    import math as _math

    import numpy as _np

    paths: list[dict] = []
    for w in window_results:
        oos_metrics = w.get("oos_metrics", {})
        oos_sharpe = float(oos_metrics.get("sharpe_ratio", 0.0))

        # IS Sharpe: prefer optimizer score (most accurate), then IS daily pnls, then OOS
        is_sharpe: float
        opt = w.get("optimization")
        if opt and opt.get("best_sharpe") is not None:
            is_sharpe = float(opt["best_sharpe"])
        else:
            # E2 fix: use per-window IS daily P&Ls when available to compute real IS Sharpe.
            # walk_forward.py stores them under _is_daily_pnls during window assembly.
            # This breaks the degenerate IS==OOS condition for non-optimize plain-WF runs.
            _is_pnls = w.get("_is_daily_pnls") or []
            if len(_is_pnls) > 1:
                _is_arr = _np.array(_is_pnls, dtype=float)
                _is_std = float(_np.std(_is_arr, ddof=1))
                if _is_std > 1e-10:
                    _is_sharpe_computed = float(_np.mean(_is_arr) / _is_std * _np.sqrt(252))
                    if _math.isfinite(_is_sharpe_computed):
                        is_sharpe = _is_sharpe_computed
                    else:
                        is_sharpe = oos_sharpe
                else:
                    is_sharpe = oos_sharpe
            else:
                # For non-optimization WF without IS daily P&Ls, IS Sharpe is not directly
                # available per window. Use OOS Sharpe as a conservative estimate.
                # This triggers the degenerate guard → pbo=None → TS gate BLOCKS.
                is_sharpe = oos_sharpe

        paths.append({
            "is_sharpe": is_sharpe,
            "oos_sharpe": oos_sharpe,
            "is_returns": [],
            "oos_returns": [],
        })
    return paths
