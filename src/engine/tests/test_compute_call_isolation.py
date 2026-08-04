"""compute()-call isolation — the BEHAVIOURAL half of AR-743's structural proof (R-680 §4).

WHAT THIS TESTS, EXACTLY:
    a second compute() on the SAME SpecConditionStrategy instance must produce the result
    that a FRESH instance would produce for the same data. No per-call state survives.

WHAT THIS IS **NOT** (R-680 §4, forbidden to report as such):
    It is NOT the cache-leak red-proof. R-679 §1 keeps that defect UNREACHABLE: the `9`
    per-family caches cannot leak today because no evaluated value varies per condition.
    Only a real varying parameter can reach that defect, and no parameter field exists.
    This file tests the WEAKER, currently-provable property named above — and it is written
    NOW, before the defect is reachable, precisely so it cannot be fitted to it later
    (R-680 §3: "a guard written before the defect is reachable is the only one that can be
    trusted not to have been fitted to it").

THE ORACLE IS A FRESH INSTANCE, NOT A HARDCODED ARRAY.
    Comparing against a copied expected value would be a fabricated safety claim
    (feedback_hardcoded_test_copy). The reference is recomputed by construction.

SENSITIVITY IS ASSERTED, NOT ASSUMED.
    test_the_two_datasets_actually_produce_different_signals is a POSITIVE CONTROL: if the
    two fixtures ever converged, the isolation assertions would pass vacuously. It prints
    its value so a reader sees the control fired rather than trusting that it exists.

AND THE GUARD IS PROVEN ABLE TO FAIL.
    test_isolation_guard_detects_a_hoisted_cache monkeypatches one cache slot up to
    instance level — the exact defect shape — and asserts the leak IS observed. If that
    test ever passes trivially, the isolation guard above it has stopped discriminating.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import numpy as np
import polars as pl

from src.engine.spec_condition_compiler import SpecConditionStrategy

SIGNAL_COLS = ("entry_long", "entry_short")


def _df(seed: int, n: int = 200) -> pl.DataFrame:
    """Synthetic OHLC. Same shape as the other spec-compiler suites so this file introduces
    no new fixture convention; only the seed varies between the two datasets."""
    rng = np.random.default_rng(seed)
    close = 100 + np.cumsum(rng.normal(0, 0.5, n))
    high = close + rng.uniform(0.1, 1.5, n)
    low = close - rng.uniform(0.1, 1.5, n)
    open_ = close + rng.normal(0, 0.3, n)
    ts = [datetime(2026, 1, 5, 9, 30, tzinfo=UTC) + timedelta(minutes=15 * i) for i in range(n)]
    return pl.DataFrame(
        {"open": open_, "high": high, "low": low, "close": close, "ts_event": ts, "volume": [100] * n}
    )


def _spec() -> dict:
    """Families deliberately chosen to exercise ctx-cached handlers: WAIT_STRUCTURE feeds the
    single-slot `wait_structure` cache, WAIT_BIAS feeds `wait_bias_cache`."""
    return {
        "direction": "long",
        "entry_conditions": [
            {"id": "t1", "type": "ENABLE_ENTRY", "object": "entry", "role": "trigger"},
            {"id": "s1", "type": "WAIT_STRUCTURE", "object": "break of structure", "role": "spine"},
            {"id": "s2", "type": "WAIT_BIAS", "object": "bullish bias", "role": "spine"},
        ],
        "invalidations": [],
        "entry_trigger_id": "t1",
    }


def _strategy() -> SpecConditionStrategy:
    return SpecConditionStrategy({"spec": _spec(), "spec_hash": "testhash"}, symbol="MES", timeframe="15m")


def _signals(out: pl.DataFrame) -> dict[str, np.ndarray]:
    return {c: out[c].to_numpy() for c in SIGNAL_COLS}


def _diff_bars(a: dict[str, np.ndarray], b: dict[str, np.ndarray]) -> int:
    return int(sum(int(np.sum(a[c] != b[c])) for c in SIGNAL_COLS))


# ─── POSITIVE CONTROL ──────────────────────────────────────────────────────────────────────

def test_the_two_datasets_actually_produce_different_signals():
    """Without this, every isolation assertion below could pass vacuously on two datasets
    that happen to agree. Prints the differing-bar count so the control's VALUE is visible,
    per R-675 §1: a control is only a control if it returns non-zero."""
    a = _signals(_strategy().compute(_df(seed=11)))
    b = _signals(_strategy().compute(_df(seed=99)))
    differing = _diff_bars(a, b)
    print(f"\n[POSITIVE CONTROL] fresh-instance signals differ on {differing} bar-slots "
          f"across {SIGNAL_COLS}")
    assert differing > 0, (
        "CONTROL DEAD: the two fixtures produce identical signals, so the isolation "
        "assertions in this file would be vacuous. Change a seed until this is non-zero."
    )


# ─── THE GUARD ─────────────────────────────────────────────────────────────────────────────

def test_second_compute_on_a_reused_instance_matches_a_fresh_instance():
    """The property: reusing an instance must not change the answer.

    Oracle = a fresh instance computing the SAME data. Not a stored array."""
    reused = _strategy()
    reused.compute(_df(seed=11))                      # call 1 — populates every per-call cache
    second = _signals(reused.compute(_df(seed=99)))   # call 2 — different data, same instance

    reference = _signals(_strategy().compute(_df(seed=99)))

    for col in SIGNAL_COLS:
        assert np.array_equal(second[col], reference[col]), (
            f"{col}: the second compute() on a reused instance disagrees with a fresh "
            f"instance on {int(np.sum(second[col] != reference[col]))} bars — per-call state "
            f"survived the call boundary"
        )


def test_reused_instance_introspection_reflects_the_second_call_not_the_first():
    """last_per_condition_bool is instance-level and reset inside compute() (AR-743 §2).
    A reset that silently stopped happening would leave call 1's arrays visible here."""
    reused = _strategy()
    reused.compute(_df(seed=11))
    reused.compute(_df(seed=99))

    fresh = _strategy()
    fresh.compute(_df(seed=99))

    assert set(reused.last_per_condition_bool) == set(fresh.last_per_condition_bool)
    for cid, arr in fresh.last_per_condition_bool.items():
        assert np.array_equal(reused.last_per_condition_bool[cid], arr), (
            f"condition {cid}: reused-instance introspection carries the first call's array"
        )


def test_call_order_does_not_change_the_answer():
    """Order-independence — the classic signature of a state-carrying defect. If any per-call
    value survived, computing (11 then 99) and (99 then 11) would disagree on the last call."""
    forward = _strategy()
    forward.compute(_df(seed=11))
    forward_last = _signals(forward.compute(_df(seed=99)))

    backward = _strategy()
    backward.compute(_df(seed=99))
    backward_first_repeated = _signals(backward.compute(_df(seed=99)))

    for col in SIGNAL_COLS:
        assert np.array_equal(forward_last[col], backward_first_repeated[col]), (
            f"{col}: the result for seed=99 depends on what was computed before it"
        )


# ─── THE GUARD'S OWN RED PATH — proves the assertions above can still fail ──────────────────

def test_isolation_guard_detects_a_hoisted_cache(monkeypatch):
    """MUTATION CONTROL. Hoist one per-call cache to instance level — the exact defect shape
    R-679 §2 describes — and assert the leak becomes OBSERVABLE.

    This is what makes the green above meaningful. R-680 §4 ordered a one-off scratchpad RED;
    this is that same demonstration made PERMANENT, because red paths decay
    (feedback_red_path_decay) and a sensitivity proof that ran once in August is not a
    sensitivity proof in September.

    It does NOT modify src/ — the hoist exists only inside this test's monkeypatch scope.
    """
    original = SpecConditionStrategy._eval_wait_structure

    def hoisted(self, n, df):
        # the defect: cache on the INSTANCE instead of in the per-call ctx
        if getattr(self, "_hoisted_structure", None) is None:
            self._hoisted_structure = original(self, n, df)
        return self._hoisted_structure

    monkeypatch.setattr(SpecConditionStrategy, "_eval_wait_structure", hoisted, raising=True)

    leaked = _strategy()
    leaked.compute(_df(seed=11))
    second = _signals(leaked.compute(_df(seed=99)))

    reference = _signals(_strategy().compute(_df(seed=99)))

    differing = _diff_bars(second, reference)
    print(f"\n[MUTATION CONTROL] with wait_structure hoisted to instance level, the second "
          f"compute() disagrees with a fresh instance on {differing} bar-slots")
    assert differing > 0, (
        "MUTATION CONTROL DEAD: hoisting a cache to instance level produced NO observable "
        "difference, so test_second_compute_on_a_reused_instance_matches_a_fresh_instance "
        "cannot detect the defect it claims to guard against. The guard is not discriminating."
    )
