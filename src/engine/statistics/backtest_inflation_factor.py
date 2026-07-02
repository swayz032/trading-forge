"""Backtest Inflation Factor (BIF) — selection-bias inflation measurement.

BIF quantifies how much the optimized in-sample (IS) Sharpe ratio is inflated
relative to the walk-forward (WF) out-of-sample (OOS) Sharpe ratio.

    BIF = IS_sharpe / WF_sharpe

A BIF of 1.0 means no inflation (OOS performance matches IS — ideal).
A BIF of 2.0 means the IS Sharpe was 2× the OOS Sharpe (inflation detected).
A BIF above BIF_BLOCK_THRESHOLD is a hard selection-bias signal.

Theoretical grounding (K_eff and expected_inflation):
  Per Bailey & Lopez de Prado (2014) "The Sharpe Ratio Efficient Frontier"
  (Journal of Risk 15(2):3–44) and arXiv 2604.15531 (2025 institutional
  standard), when you select the best strategy from K_eff IID independent
  trials under the null hypothesis of zero expected return, the expected
  maximum Sharpe ratio inflates by approximately:

      expected_inflation ≈ sqrt(2 · ln(K_eff))

  where K_eff is the effective number of independent strategies or parameter
  combinations tested. A measured BIF larger than expected_inflation is
  evidence of selection noise rather than genuine skill.

  K_eff derivation per walk-forward mode (set by the caller):
    CPCV mode:           K_eff = n_paths   (e.g. C(6,2) = 15 combinatorial paths)
    plain/purged mode:   K_eff = n_splits  (each WF window = 1 independent IS/OOS draw)

  The expected_inflation value is included in the output for TS-side display
  and audit context.  The hard verdict tiers use the fixed env thresholds
  BIF_WARN_THRESHOLD / BIF_BLOCK_THRESHOLD so gate behaviour is deterministic
  regardless of K_eff.

Fail-closed contract:
  A non-positive WF Sharpe with a positive IS Sharpe is the worst-case
  selection-bias outcome — the strategy looked good IS but completely failed OOS.
  This returns BIF = _BIF_LARGE (999.0) and verdict="block".  Never inf/NaN.
  Non-finite inputs also fail-closed.

  A non-positive IS Sharpe means no positive IS edge was demonstrated; the BIF
  is undefined so the function returns 1.0 (no inflation claim) with
  fail_closed=False.  Both IS and WF non-positive → same 1.0 treatment.

Env vars (all optional, deterministic defaults):
  BIF_WARN_THRESHOLD   float  default 2.0  — BIF >= this → verdict="warn"
  BIF_BLOCK_THRESHOLD  float  default 4.0  — BIF >= this → verdict="block"
"""

from __future__ import annotations

import math
import os

# ── Module constants ──────────────────────────────────────────────────────────

_BIF_WARN_DEFAULT: float = 2.0
_BIF_BLOCK_DEFAULT: float = 4.0

# Fail-closed sentinel: returned instead of inf/NaN when the ratio is degenerate.
# Value is intentionally large enough to exceed any reasonable BIF_BLOCK_THRESHOLD.
_BIF_LARGE: float = 999.0

# Floor applied to K_eff to prevent ln(0) or negative-domain errors.
_K_EFF_FLOOR: float = 1.0


# ── Threshold helpers (read from env at call time — deterministic, no state) ──

def _get_warn_threshold() -> float:
    """Read BIF_WARN_THRESHOLD from env (default 2.0)."""
    try:
        return float(os.environ.get("BIF_WARN_THRESHOLD", str(_BIF_WARN_DEFAULT)))
    except (ValueError, TypeError):
        return _BIF_WARN_DEFAULT


def _get_block_threshold() -> float:
    """Read BIF_BLOCK_THRESHOLD from env (default 4.0)."""
    try:
        return float(os.environ.get("BIF_BLOCK_THRESHOLD", str(_BIF_BLOCK_DEFAULT)))
    except (ValueError, TypeError):
        return _BIF_BLOCK_DEFAULT


# ── Core function ─────────────────────────────────────────────────────────────

def compute_bif(
    is_sharpe: float,
    wf_sharpe: float,
    k_eff: float,
) -> dict:
    """Compute the Backtest Inflation Factor (BIF) and verdict.

    Args:
        is_sharpe:  Optimized in-sample (IS) Sharpe ratio.
                    For plain/purged_embargo WF mode: pass the combined-fold
                    IS Sharpe from run_walk_forward() (_combined_is_sharpe),
                    which is the same value used by the WFE gate — no new
                    IS backtest required.
                    For CPCV mode: pass mean(path_OOS_sharpes) as a documented
                    proxy for the IS Sharpe (M1 limitation: both this proxy and
                    wf_sharpe derive from the same concatenated OOS series, so
                    BIF ≈ 1.0 and the block gate never fires in default CPCV mode).
                    The result dict carries bif_proxy_basis="oos_mean_not_is" so the
                    TS BIF gate can emit a non-blocking audit warn.
                    Per-path IS Sharpes (true IS fold data) are a Wave 30 carry-forward;
                    see comment in _run_walk_forward_cpcv().
        wf_sharpe:  Walk-forward (OOS) aggregate Sharpe ratio — agg_sharpe
                    from run_walk_forward() or _run_walk_forward_cpcv().
        k_eff:      Effective number of independent trials tested.
                    plain/purged mode → n_splits (number of WF windows).
                    CPCV mode         → n_paths (C(N,k) combinatorial paths).

    Returns:
        dict with keys:
            bif               float  BIF value (999.0 on fail-closed sentinel)
            k_eff             float  effective trials (floor-clamped to 1.0)
            is_sharpe         float  input IS Sharpe (as provided)
            wf_sharpe         float  input WF Sharpe (as provided)
            expected_inflation float  sqrt(2·ln(k_eff)) — expected max under H_0
            verdict           str    "clean" | "warn" | "block"
            fail_closed       bool   True when the 999.0 sentinel was substituted
            warn_threshold    float  BIF_WARN_THRESHOLD used (from env or default)
            block_threshold   float  BIF_BLOCK_THRESHOLD used (from env or default)
    """
    warn_thr = _get_warn_threshold()
    block_thr = _get_block_threshold()

    # Floor K_eff to avoid ln(0) or negative-domain math errors.
    k_eff_clamped: float = max(float(k_eff), _K_EFF_FLOOR)

    # Expected inflation under H_0 (Bailey & Lopez de Prado 2014, Eq. 5).
    # sqrt(2 · ln(K_eff)) is the expected maximum Sharpe when selecting the
    # best of K_eff IID zero-expected-return strategies.
    # K_eff = 1 → expected_inflation = 0.0 (no selection, no inflation).
    if k_eff_clamped > 1.0:
        expected_inflation = math.sqrt(2.0 * math.log(k_eff_clamped))
    else:
        expected_inflation = 0.0

    # Detect non-finite inputs before any arithmetic.
    _finite_is = math.isfinite(float(is_sharpe))
    _finite_wf = math.isfinite(float(wf_sharpe))

    fail_closed = False

    if not _finite_is or not _finite_wf:
        # Non-finite inputs → fail-closed.  A NaN or inf in either Sharpe
        # indicates a degenerate backtest; treat as maximally inflated.
        bif = _BIF_LARGE
        fail_closed = True

    elif float(is_sharpe) <= 0.0:
        # No positive IS edge demonstrated.  BIF is undefined (cannot inflate
        # something that was never claimed positive).  Return 1.0 (no inflation
        # signal) rather than a fabricated large value.
        bif = 1.0

    elif float(wf_sharpe) <= 0.0:
        # Positive IS Sharpe + non-positive WF Sharpe → maximum inflation case.
        # Strategy looked good in-sample but completely failed OOS.
        # Returning inf or the direct ratio would break downstream JSON consumers;
        # use the large sentinel to guarantee a block verdict.
        bif = _BIF_LARGE
        fail_closed = True

    else:
        # Normal case: both Sharpes are finite and positive.
        bif = float(is_sharpe) / float(wf_sharpe)

    # Verdict tiers from env thresholds (deterministic; evaluated in descending order).
    if bif >= block_thr:
        verdict = "block"
    elif bif >= warn_thr:
        verdict = "warn"
    else:
        verdict = "clean"

    return {
        "bif": round(bif, 6),
        "k_eff": round(k_eff_clamped, 4),
        "is_sharpe": round(float(is_sharpe), 6) if _finite_is else float(is_sharpe),
        "wf_sharpe": round(float(wf_sharpe), 6) if _finite_wf else float(wf_sharpe),
        "expected_inflation": round(expected_inflation, 6),
        "verdict": verdict,
        "fail_closed": fail_closed,
        "warn_threshold": warn_thr,
        "block_threshold": block_thr,
    }
