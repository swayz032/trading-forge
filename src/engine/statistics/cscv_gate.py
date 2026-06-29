"""CSCV Gate — Combinatorially Symmetric Cross-Validation.

Computes the Probability of Backtest Overfitting (PBO) for a set of
parameter configurations, following Bailey & López de Prado (2016)
"The Probability of Backtest Overfitting," Journal of Computational
Finance 20(4):1–26.

Algorithm:
  Given M with shape (N_configs, T_observations):
  1. Split T columns into S even subsets (default S=16).
  2. Enumerate all C(S, S/2) IS/OOS splits.
  3. For each split:
     a. Compute mean IS performance per config.
     b. Identify IS-best config (np.argmax: first-occurrence on tie).
     c. Compute mean OOS performance per config.
     d. Rank configs by OOS performance (1=worst, N=best; argsort stable).
     e. lambda = rank_of_is_best / N; logit = log(lambda/(1-lambda)).
  4. PBO = fraction of splits where logit < 0 (IS-best below OOS median).

Return value (dict):
  pbo     : float in [0, 1] on success; None on degenerate input.
  n_splits: int — C(S, S/2) combinations evaluated.
  logits  : list[float] — per-split logit values (empty on sentinel).
  reason  : str — present only when pbo is None.

Degenerate sentinels:
  N_configs < 2  → reason "insufficient_configs"
  T < S          → reason "insufficient_observations"

Pure contract: no I/O, no Date.now(), no random state.
Tie-breaks are deterministic via first-occurrence (np.argmax, argsort stable).

CLI (stdin/stdout JSON):
  echo '{"M": [[1,2],[3,4]], "S": 2}' | python -m src.engine.statistics.cscv_gate
"""

from __future__ import annotations

import math
from itertools import combinations
from typing import Any

import numpy as np

_DEFAULT_S: int = 16


def compute_cscv_pbo(
    M: "np.ndarray",
    S: int = _DEFAULT_S,
) -> dict[str, Any]:
    """Compute CSCV Probability of Backtest Overfitting.

    Args:
        M: float array of shape (N_configs, T_observations).
           Each row is one parameter configuration; each column is one
           observation period's performance (return, Sharpe, etc.).
        S: Number of even subsets to partition T into. Must be >= 2 and even.
           T must be >= S. Columns beyond S * (T // S) are silently truncated.

    Returns:
        dict with keys pbo, n_splits, logits, and optionally reason.
    """
    arr = np.asarray(M, dtype=float)

    if arr.ndim != 2:
        return {"pbo": None, "reason": "invalid_matrix_shape", "n_splits": 0, "logits": []}

    n_configs, T = arr.shape

    if n_configs < 2:
        return {"pbo": None, "reason": "insufficient_configs", "n_splits": 0, "logits": []}

    # Ensure S is even and >= 2
    S = max(2, int(S))
    if S % 2 != 0:
        S -= 1

    if T < S:
        return {"pbo": None, "reason": "insufficient_observations", "n_splits": 0, "logits": []}

    subset_size = T // S

    # Build S non-overlapping subset column-index lists
    subsets: list[list[int]] = [
        list(range(i * subset_size, (i + 1) * subset_size))
        for i in range(S)
    ]

    half = S // 2
    all_is_combos = list(combinations(range(S), half))

    logits: list[float] = []
    below_median: int = 0

    for is_tuple in all_is_combos:
        is_set = set(is_tuple)

        is_cols: list[int] = []
        for idx in is_tuple:
            is_cols.extend(subsets[idx])

        oos_cols: list[int] = []
        for idx in range(S):
            if idx not in is_set:
                oos_cols.extend(subsets[idx])

        # Mean IS performance per config
        is_perf = arr[:, is_cols].mean(axis=1)   # (n_configs,)
        # Mean OOS performance per config
        oos_perf = arr[:, oos_cols].mean(axis=1) # (n_configs,)

        # IS-best: first-occurrence argmax (deterministic tie-break)
        is_best_idx = int(np.argmax(is_perf))

        # OOS rank: stable argsort ascending → rank 1=worst, N=best
        order = np.argsort(oos_perf, kind="stable")
        oos_rank = np.empty(n_configs, dtype=int)
        for rank_0based, config_idx in enumerate(order):
            oos_rank[config_idx] = rank_0based + 1  # 1-based

        rank = int(oos_rank[is_best_idx])
        lam = rank / n_configs
        # Clamp away from 0/1 to keep log defined
        lam_clamped = max(1e-9, min(1.0 - 1e-9, lam))
        logit_val = math.log(lam_clamped / (1.0 - lam_clamped))
        logits.append(logit_val)

        if logit_val < 0.0:
            below_median += 1

    n_splits = len(logits)
    pbo = float(below_median / n_splits) if n_splits > 0 else None

    return {"pbo": pbo, "n_splits": n_splits, "logits": logits}


if __name__ == "__main__":
    # CLI: read JSON from stdin, write compact JSON to stdout.
    # Input:  {"M": [[...], ...], "S": 16}
    # Output: {"pbo": float|null, "n_splits": int, "logit_count": int, ["reason": str]}
    import json
    import sys

    payload = json.loads(sys.stdin.read())
    matrix = np.array(payload["M"], dtype=float)
    s_val = int(payload.get("S", _DEFAULT_S))
    result = compute_cscv_pbo(matrix, s_val)

    out: dict[str, Any] = {
        "pbo": result["pbo"],
        "n_splits": result["n_splits"],
        "logit_count": len(result.get("logits", [])),
    }
    if "reason" in result:
        out["reason"] = result["reason"]

    print(json.dumps(out))
