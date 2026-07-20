"""★ ABLATION + BOTH-POLARITY proof for the WIRE-1 bias binding (packet §5, R-066 §1).

Three things must be true before this wire may be called real:

1. ABLATION — the wired path and the EMA-slope proxy must DISAGREE on the same
   bars. If they agreed everywhere, "wiring" would be a relabel, not a fidelity
   change, and the 0.99's movement would be cosmetic.
2. BOTH-POLARITY — the binding must be seen PASSING a right condition and FAILING
   a wrong one. R-065's doctrine applied to bindings: *a binding that cannot FAIL
   is the detector-can-lie disease in evaluator form.* The EMA proxy always picks a
   side (so it gates ~nothing — that is the 0.99); the real signal can say
   "neutral" and genuinely REFUSE.
3. HONEST FALLBACK — bars with no real signal (null column) must fall back to the
   proxy and behave EXACTLY as before, so the wire never silently changes
   un-wired bars.

Pure stdlib + numpy/polars; no DB, network, or S3.
"""
from __future__ import annotations

import os
import sys
import types

import numpy as np

_ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from src.engine.spec_condition_compiler import SpecConditionStrategy  # noqa: E402

N = 120


def _close_uptrend(n: int = N) -> np.ndarray:
    """Monotone rising closes => the EMA proxy reads BULLISH on essentially every bar."""
    return np.array([100.0 + i * 0.8 for i in range(n)], dtype=float)


def _eval(close, n, want_bearish=False, htf_trend=None) -> np.ndarray:
    """Call the binding on a bare namespace (it touches no other instance state)."""
    return SpecConditionStrategy._eval_wait_bias(
        types.SimpleNamespace(), close, n, want_bearish=want_bearish, htf_trend=htf_trend
    )


def test_proxy_alone_almost_never_refuses_this_is_the_0_99_pathology():
    """Baseline: on a clean uptrend the proxy passes nearly every bar — the
    near-ungated behavior the packet measured at ~0.99 binding-approximation."""
    out = _eval(_close_uptrend(), N, want_bearish=False, htf_trend=None)
    assert out.sum() > 0.8 * N, "proxy baseline unexpectedly selective — fixture wrong"


def test_ablation_wired_differs_from_proxy_on_the_same_bars():
    """★ ABLATION: same bars, real HTF trend says bearish/neutral while the exec-TF
    EMA proxy says bullish -> the two MUST disagree."""
    close = _close_uptrend()
    proxy = _eval(close, N, want_bearish=False, htf_trend=None)
    trend = ["bearish" if i % 2 == 0 else "neutral" for i in range(N)]
    wired = _eval(close, N, want_bearish=False, htf_trend=trend)

    assert not np.array_equal(proxy, wired), (
        "ABLATION FAILED: wired == proxy on every bar — the wire is a relabel, not "
        "a fidelity change."
    )
    assert wired.sum() == 0, "real signal was bearish/neutral throughout; nothing should pass"


def test_both_polarity_wired_binding_can_PASS_and_can_FAIL():
    """★ BOTH-POLARITY: a binding that cannot FAIL is the disease in evaluator form."""
    close = _close_uptrend()

    all_bull = ["bullish"] * N
    passes = _eval(close, N, want_bearish=False, htf_trend=all_bull)
    assert passes.all(), "wired binding failed to PASS a right condition"

    # ...and the SAME real signal must FAIL the opposite polarity.
    fails = _eval(close, N, want_bearish=True, htf_trend=all_bull)
    assert not fails.any(), "wired binding failed to REFUSE a wrong condition"


def test_neutral_is_a_real_refusal_not_a_coin_flip():
    """The fidelity gain: 'neutral' gates OFF, where the proxy would have picked a side."""
    close = _close_uptrend()
    neutral = ["neutral"] * N
    assert not _eval(close, N, want_bearish=False, htf_trend=neutral).any()
    assert not _eval(close, N, want_bearish=True, htf_trend=neutral).any()


def test_null_bars_fall_back_to_proxy_byte_identically():
    """★ HONEST FALLBACK: an all-null column must reproduce the pure-proxy result
    exactly — the wire never silently alters un-wired bars."""
    close = _close_uptrend()
    proxy_only = _eval(close, N, want_bearish=False, htf_trend=None)
    all_null = _eval(close, N, want_bearish=False, htf_trend=[None] * N)
    assert np.array_equal(proxy_only, all_null), (
        "un-wired bars diverged from the proxy — the wire is not additive."
    )


def test_partial_coverage_mixes_real_and_proxy_per_bar():
    """Mixed column: real bars use the real signal, null bars use the proxy."""
    close = _close_uptrend()
    trend = [None if i < N // 2 else "bearish" for i in range(N)]
    out = _eval(close, N, want_bearish=False, htf_trend=trend)
    proxy = _eval(close, N, want_bearish=False, htf_trend=None)

    assert np.array_equal(out[: N // 2], proxy[: N // 2]), "null half must match proxy"
    assert not out[N // 2:].any(), "real-bearish half must refuse a bullish condition"
