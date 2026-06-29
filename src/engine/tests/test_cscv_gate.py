"""Tests for src/engine/statistics/cscv_gate.py.

IMPORTANT: vectorbt is NOT imported anywhere in this file.
Bare import of any module that transitively pulls the vectorbt-JIT
backtester HANGS under pytest collection on the tower (known-fact:
AGENT-LOGS Known-Facts Pin section). Engine tests must mock vectorbt.

Test coverage:
  - Robust matrix     → PBO < 0.5  (dominant config always wins OOS)
  - Overfit matrix    → PBO > 0.5  (cherry-picked IS, terrible OOS)
  - Logits list       → length == n_splits
  - PBO unit interval → pbo in [0, 1]
  - Degenerate N=1    → sentinel {pbo: None, reason: "insufficient_configs"}
  - Degenerate T<S    → sentinel {pbo: None, reason: "insufficient_observations"}
  - Determinism       → same inputs produce identical outputs
  - Larger S=16 run   → completes without error, n_splits == C(16,8) == 12870
"""

from __future__ import annotations

import numpy as np

from src.engine.statistics.cscv_gate import compute_cscv_pbo

# ── Matrix factories ──────────────────────────────────────────────────────────


def _robust_matrix(n_configs: int = 4, T: int = 32) -> np.ndarray:
    """Config 0 = constant 1.0; all others = constant 0.0.

    For every C(4,2)=6 IS/OOS split:
      IS-best  = config 0 (IS perf 1.0 > 0.0)
      OOS rank = N (OOS perf 1.0 > 0.0 for all others)
      logit    > 0 → NOT below median → PBO = 0.0
    """
    M = np.zeros((n_configs, T))
    M[0, :] = 1.0
    return M


def _overfit_matrix(n_configs: int = 4, T: int = 32) -> np.ndarray:
    """Config 0 dominates IS (first half subsets) but is worst OOS (second half).

    With S=4, subset_size=8:
      Subsets 0,1 (cols 0-15):  config 0 = +5, others = 0
      Subsets 2,3 (cols 16-31): config 0 = -5, others = 0

    For each C(4,2)=6 IS/OOS split the IS-best's OOS logit < 0:
      - IS={0,1}: config 0 IS=+5 (best), OOS={2,3}: config 0 OOS=-5 → rank 1 → logit<0
      - IS={2,3}: configs 1-3 best IS (tie, argmax picks config 1), OOS={0,1}: config 1
                  OOS=0.0 while config 0 OOS=+5 → config 1 rank=1 → logit<0
      - IS={0,2}: all tie at 0.0, argmax picks config 0, OOS perfs also 0.0, rank=1 → logit<0
      - IS={0,3}: same as above → logit<0
      - IS={1,2}: same → logit<0
      - IS={1,3}: same → logit<0
    Expected PBO = 6/6 = 1.0 > 0.5.
    """
    M = np.zeros((n_configs, T))
    half = T // 2
    M[0, :half] = 5.0   # subsets 0, 1 for config 0
    M[0, half:] = -5.0  # subsets 2, 3 for config 0
    return M


# ── Tests ─────────────────────────────────────────────────────────────────────


def test_robust_matrix_low_pbo() -> None:
    """Dominant config (always best IS + OOS) → PBO = 0.0 < 0.5."""
    result = compute_cscv_pbo(_robust_matrix(), S=4)
    assert result["pbo"] is not None
    assert result["pbo"] < 0.5, f"Expected PBO < 0.5, got {result['pbo']}"
    assert result["n_splits"] == 6  # C(4, 2)


def test_overfit_matrix_high_pbo() -> None:
    """IS-cherry-picked config → PBO = 1.0 > 0.5."""
    result = compute_cscv_pbo(_overfit_matrix(), S=4)
    assert result["pbo"] is not None
    assert result["pbo"] > 0.5, f"Expected PBO > 0.5, got {result['pbo']}"
    assert result["n_splits"] == 6  # C(4, 2)


def test_logits_length_matches_n_splits() -> None:
    """logits list must have exactly n_splits entries."""
    result = compute_cscv_pbo(_robust_matrix(), S=4)
    assert len(result["logits"]) == result["n_splits"]


def test_pbo_in_unit_interval() -> None:
    """PBO must be a float in [0, 1]."""
    rng = np.random.default_rng(seed=7)
    M = rng.standard_normal((8, 64))
    result = compute_cscv_pbo(M, S=8)
    assert result["pbo"] is not None
    assert 0.0 <= result["pbo"] <= 1.0


def test_degenerate_single_config() -> None:
    """N=1 config must return the insufficient_configs sentinel."""
    M = np.array([[1.0, 2.0, 3.0, 4.0]])
    result = compute_cscv_pbo(M, S=4)
    assert result["pbo"] is None
    assert result["reason"] == "insufficient_configs"
    assert result["n_splits"] == 0
    assert result["logits"] == []


def test_degenerate_too_few_observations() -> None:
    """T < S must return the insufficient_observations sentinel."""
    M = np.zeros((4, 3))  # T=3 < S=4
    result = compute_cscv_pbo(M, S=4)
    assert result["pbo"] is None
    assert result["reason"] == "insufficient_observations"
    assert result["n_splits"] == 0


def test_replay_determinism() -> None:
    """Same inputs must produce byte-identical outputs on every call."""
    rng = np.random.default_rng(seed=99)
    M = rng.standard_normal((10, 160))
    r1 = compute_cscv_pbo(M, S=16)
    r2 = compute_cscv_pbo(M, S=16)
    assert r1["pbo"] == r2["pbo"]
    assert r1["n_splits"] == r2["n_splits"]
    assert r1["logits"] == r2["logits"]


def test_s16_completes_with_correct_split_count() -> None:
    """S=16 must enumerate C(16,8)=12870 splits without error."""
    rng = np.random.default_rng(seed=42)
    M = rng.standard_normal((5, 160))
    result = compute_cscv_pbo(M, S=16)
    assert result["pbo"] is not None
    assert result["n_splits"] == 12870  # C(16, 8)


def test_odd_s_rounds_down_to_even() -> None:
    """Odd S must be rounded down to the nearest even integer."""
    M = _robust_matrix(n_configs=4, T=32)
    r_even = compute_cscv_pbo(M, S=4)
    r_odd = compute_cscv_pbo(M, S=5)   # should behave like S=4
    assert r_even["n_splits"] == r_odd["n_splits"]
