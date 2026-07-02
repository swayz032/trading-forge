"""Warm the Numba/vectorbt JIT cache once at service boot.

Run this ONCE on backend startup (e.g. from start-forge.bat before the API
starts, or as an NSSM pre-start hook). It imports the determinism module first
(which pins NUMBA_CACHE_DIR to <repo>/.numba_cache), then triggers the vectorbt
portfolio-sim JIT compile on a tiny array so the on-disk cache is populated and
validated BEFORE the first real backtest subprocess runs.

After this runs, every spawned backtest / walk-forward worker process loads the
cached machine code (~2.4s) instead of cold-compiling it (~7s). Accuracy is
unaffected — this only touches compilation caching.

Exit code 0 = cache warm. Non-zero = warm failed (backend can still start;
the first real backtest will just pay the cold-compile cost once).
"""

from __future__ import annotations

import os
import sys
import time

# Ensure repo root is importable regardless of invocation (python scripts/foo.py
# puts scripts/ on sys.path[0], not the repo root).
_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)

# MUST import determinism first — it sets NUMBA_CACHE_DIR before Numba loads.
import src.engine.determinism  # noqa: F401  (side effect: pins cache dir + BLAS env)


def main() -> int:
    import os

    cache_dir = os.environ.get("NUMBA_CACHE_DIR", "<unset>")
    t0 = time.perf_counter()
    try:
        import numpy as np
        import pandas as pd
        import vectorbt as vbt
    except Exception as exc:  # noqa: BLE001
        print(f"[warm-numba] import failed: {exc}", file=sys.stderr)
        return 1

    import_s = time.perf_counter() - t0

    # Mirror the real DSL from_signals signature (long + short + size array) so
    # the cached specialization matches what run_backtest() actually compiles.
    n = 512
    idx = pd.RangeIndex(n)
    close = pd.Series(np.linspace(100.0, 110.0, n), index=idx)
    entries = pd.Series(np.zeros(n, dtype=bool), index=idx)
    exits = pd.Series(np.zeros(n, dtype=bool), index=idx)
    short_entries = pd.Series(np.zeros(n, dtype=bool), index=idx)
    short_exits = pd.Series(np.zeros(n, dtype=bool), index=idx)
    entries.iloc[10] = True
    exits.iloc[50] = True
    short_entries.iloc[100] = True
    short_exits.iloc[150] = True
    size = pd.Series(np.full(n, 9.0), index=idx)

    t1 = time.perf_counter()
    try:
        pf = vbt.Portfolio.from_signals(
            close=close,
            entries=entries,
            exits=exits,
            short_entries=short_entries,
            short_exits=short_exits,
            size=size,
            freq="15min",
            init_cash=float("inf"),
        )
        _ = int(pf.trades.count())
    except Exception as exc:  # noqa: BLE001
        print(f"[warm-numba] from_signals warm failed: {exc}", file=sys.stderr)
        return 2
    compile_s = time.perf_counter() - t1

    print(
        f"[warm-numba] cache_dir={cache_dir} import={import_s:.2f}s "
        f"from_signals_warm={compile_s:.2f}s — JIT cache is HOT",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
