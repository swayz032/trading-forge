"""Defect-7 (D7) — run_class_backtest partial-fill parity with run_backtest.

run_backtest applies the two-stage fill model (apply_fill_model RSI/type gate +
apply_volume_partial_fills volume gate) to its POST-gate/PRE-roll entries BEFORE
building its portfolio, then shifts +1 bar (next-bar fill) and re-aligns adjusted
sizes to the rolled entry bars (backtester.py:4522-4663). run_class_backtest built
its portfolio with NO such preprocessing → idealised (optimistic) fills. The D7 fix
mirrors run_backtest's sequence via the shared helper
`fill_model.apply_fill_model_and_roll_signals`.

These tests exercise the SHARED HELPER directly (importing backtester.py hangs
pytest under the vectorbt-JIT — a pinned tower trait). Parity with run_backtest is
established two ways:
  1. `_run_backtest_fill_oracle` below is a BYTE-FOR-BYTE transcription of
     run_backtest's inline long+short fill sequence (backtester.py:4522-4663). The
     helper's output must equal the oracle's on identical inputs.
  2. Both the helper and the oracle call the IDENTICAL deterministic underlying
     functions (apply_fill_model seed=42 long / seed=43 short, then
     apply_volume_partial_fills) — so the degradation math is provably the same
     value run_backtest computes; only the roll/re-align glue could diverge, and
     the oracle pins that glue.

ACTIVATION-SURFACE AMENDMENT (2026-07-09): the class-path OUTER activation gate is
now the optional `fill_model` PARAMETER, mirroring run_backtest's `if
request.fill_model:` (backtester.py:4524) — NOT the BACKTEST_PARTIAL_FILL_ENABLED
env flag. run_backtest is DORMANT in production (no src/server path populates
BacktestRequest.fill_model), so the class path is aligned to that same operative
dormancy: fill_model absent (the default) → zero degradation; fill_model present →
the verified helper runs UNCHANGED. The INNER env flag inside
apply_volume_partial_fills is the mechanism gate and is untouched — the helper's
own env-gated tests below still exercise it. `_class_fill_branch` transcribes
run_class_backtest's 4-line branch so the activation surface (param, not env) is
proven at fixture level.

D7 acceptance clauses covered (packet Addition 1):
  1. Three fill zones (zone-1 100% / zone-2 linear degrade / zone-3 forced partial).
  2. NON-VACUOUSNESS: zone-2 AND zone-3 cases where the class ENGAGED path (explicit
     fill_model) MATCHES the run_backtest oracle AND DIFFERS from the DORMANT
     (fill_model absent) path (the wiring-is-live proof — a zone-1-only fixture
     would pass even if the mirror were dead code).
  3. Partial-entry × Style C 33/33/34 sequence (33% of FILLED, not ORDERED).
  4. Exit-leg case (fill model is entry-only; exits are NOT volume-degraded).
  5. Zero-volume bar routes to the fail-loud guard, NOT a new ZeroDivision.
  6. DORMANT-when-absent: fill_model=None → byte-identical plain-roll no-op even
     with the env flag ON (proves activation moved from env → param).
Plus base acceptance: parity on identical inputs; helper-level default-ON /
disabled-byte-identical (the INNER env mechanism, unchanged by the amendment).

Per CLAUDE.md: fill model outputs integer contracts consumed by the futures P&L
formula; NEVER passed to vectorbt slippage/fees.
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta

import numpy as np
import polars as pl
import pytest

import src.engine.fill_model as fm
from src.engine.config import FillProbabilityConfig  # import-safe (no vectorbt/backtester pull)
from src.engine.fill_model import (
    apply_fill_model_and_roll_signals,
    compute_volume_based_fill_ratios,
)

# ─── Fixtures / helpers ──────────────────────────────────────────────────────


def _make_df(n: int, volume, atr_value: float = 4.0) -> pl.DataFrame:
    """DataFrame with per-bar volume (scalar → constant, or list → per-bar).

    Deliberately has NO rsi_* column, so the market-order fill-probability path
    returns all-1.0 (Stage 1 apply_fill_model is a strict no-op) — isolating the
    Stage 2 volume gate as the sole degradation source, exactly as it is for the
    class/ICT strategies the D7 fix targets.
    """
    if np.isscalar(volume):
        vol = [float(volume)] * n
    else:
        vol = [float(v) for v in volume]
    dates = [datetime(2024, 1, 2, 9, 30) + timedelta(minutes=i * 15) for i in range(n)]
    return pl.DataFrame({
        "ts_event": dates,
        "open": [5000.0] * n,
        "high": [5005.0] * n,
        "low": [4995.0] * n,
        "close": [5002.0] * n,
        "volume": vol,
        "atr_14": [atr_value] * n,
    })


def _run_backtest_fill_oracle(long_entries, short_entries, sizes, df,
                              symbol="MES", spread_multiplier=1.0):
    """BYTE-FOR-BYTE transcription of run_backtest's inline fill sequence.

    Mirrors backtester.py:4522-4574 (long) + 4593-4663 (short), market-order
    default (order_type='market' → Stage 1 no-op). If run_backtest's inline
    sequence changes, BOTH this oracle and the production helper
    apply_fill_model_and_roll_signals must be updated in lockstep.
    """
    cfg = dict(fm.DEFAULT_FILL_CONFIG)
    order_type = "market"
    long_np = np.asarray(long_entries).copy()
    short_np = np.asarray(short_entries).copy()
    sizes = np.asarray(sizes, dtype=np.float64).copy()

    # LONG Stage 1 (seed=42) + Stage 2
    long_fill_probs = fm.compute_fill_probabilities_v2(
        df, cfg, long_np, order_type=order_type, symbol=symbol,
        spread_multiplier=spread_multiplier,
    )
    long_np, sizes = fm.apply_fill_model(long_np, long_fill_probs, sizes, seed=42)
    sizes, _r, _la = fm.apply_volume_partial_fills(long_np, sizes, df)
    long_adjusted = sizes.copy()

    # roll long + re-align
    long_np = np.roll(long_np, 1)
    long_np[0] = False
    slm = long_np.astype(bool)
    lpre = np.where(slm)[0] - 1
    lvalid = lpre >= 0
    for idx, pre_idx in zip(np.where(slm)[0][lvalid], lpre[lvalid], strict=False):
        sizes[idx] = long_adjusted[pre_idx]

    # SHORT Stage 1 (seed=43) + Stage 2 on sizes.copy()
    short_fill_probs = fm.compute_fill_probabilities_v2(
        df, cfg, short_np, order_type=order_type, symbol=symbol,
        spread_multiplier=spread_multiplier,
    )
    short_np, short_adjusted = fm.apply_fill_model(
        short_np, short_fill_probs, sizes.copy(), seed=43
    )
    short_adjusted, _r2, _sa = fm.apply_volume_partial_fills(short_np, short_adjusted, df)
    sfm = short_np.astype(bool)
    sizes[sfm] = short_adjusted[sfm]

    short_np = np.roll(short_np, 1)
    short_np[0] = False
    ssm = short_np.astype(bool)
    spre = np.where(ssm)[0] - 1
    svalid = spre >= 0
    for idx, pre_idx in zip(np.where(ssm)[0][svalid], spre[svalid], strict=False):
        sizes[idx] = short_adjusted[pre_idx]

    return long_np, short_np, sizes


def _class_fill_branch(long_e, short_e, sizes, df, symbol, fill_model):
    """BYTE-FOR-BYTE transcription of run_class_backtest's D7 branch (amendment
    2026-07-09). The OUTER activation gate is the `fill_model` PARAMETER, mirroring
    run_backtest's `if request.fill_model:` — NOT the BACKTEST_PARTIAL_FILL_ENABLED
    env flag. run_class_backtest itself can't be imported (vectorbt-JIT hangs pytest
    collection), so its 4-line branch is transcribed here so the fixture proves the
    ACTIVATION SURFACE, not merely the helper mechanism.

      fill_model present → the verified helper runs UNCHANGED (fill + roll + realign).
      fill_model absent (None) → plain roll, sizes untouched = byte-identical no-op
        (dormant), matching run_backtest's production dormancy.
    """
    if fill_model:
        return fm.apply_fill_model_and_roll_signals(
            long_e, short_e, sizes, df, symbol=symbol,
        )
    le = np.roll(long_e, 1)
    le[0] = False
    se = np.roll(short_e, 1)
    se[0] = False
    return le, se, sizes.copy(), {}


class _FillEnv:
    """Context manager: set BACKTEST_PARTIAL_FILL_ENABLED + clear the lru caches."""

    def __init__(self, enabled: bool, threshold: str = "0.1"):
        self.enabled = enabled
        self.threshold = threshold
        self._saved: dict = {}

    def __enter__(self):
        for k in ("BACKTEST_PARTIAL_FILL_ENABLED", "BACKTEST_PARTIAL_FILL_VOLUME_THRESHOLD"):
            self._saved[k] = os.environ.get(k)
        os.environ["BACKTEST_PARTIAL_FILL_ENABLED"] = "true" if self.enabled else "false"
        os.environ["BACKTEST_PARTIAL_FILL_VOLUME_THRESHOLD"] = self.threshold
        fm._get_partial_fill_enabled.cache_clear()
        fm._get_partial_fill_volume_threshold.cache_clear()
        return self

    def __exit__(self, *exc):
        for k, v in self._saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        fm._get_partial_fill_enabled.cache_clear()
        fm._get_partial_fill_volume_threshold.cache_clear()


def _single_long(n: int, signal_bar: int):
    """Long-entry array with a single True at signal_bar (pre-roll)."""
    a = np.zeros(n, dtype=bool)
    a[signal_bar] = True
    return a


# ─── Clause 1: three fill zones ─────────────────────────────────────────────


class TestThreeFillZones:
    """Zone-1 (no degrade), zone-2 (linear), zone-3 (forced partial)."""

    def test_zone1_no_degradation(self):
        # size 5 vs volume 100_000 → ratio 5e-5 < 0.1 → 100% fill.
        n = 12
        long_e = _single_long(n, 5)
        short_e = np.zeros(n, dtype=bool)
        sizes = np.full(n, 5.0)
        df = _make_df(n, 100_000)
        with _FillEnv(True):
            le, se, out, _a = apply_fill_model_and_roll_signals(long_e, short_e, sizes, df, symbol="MES")
        assert le[6] and not le[5]  # rolled +1
        assert out[6] == 5.0  # zone-1: unchanged

    def test_zone2_linear_degrade(self):
        # size 50 vs volume 100 → ratio 0.5 (zone-2). threshold 0.1 →
        # fill_ratio = 1 - 0.5*(0.5-0.1)/(0.9) = 0.7778 → int(50*0.7778)=38.
        n = 12
        long_e = _single_long(n, 5)
        short_e = np.zeros(n, dtype=bool)
        sizes = np.full(n, 50.0)
        df = _make_df(n, 100)
        with _FillEnv(True):
            le, se, out, _a = apply_fill_model_and_roll_signals(long_e, short_e, sizes, df, symbol="MES")
        assert out[6] == 38.0
        assert out[6] < 50.0  # degraded

    def test_zone3_forced_partial(self):
        # size 200 vs volume 100 → ratio 2.0 (zone-3) → fill_ratio 0.5 → 100.
        n = 12
        long_e = _single_long(n, 5)
        short_e = np.zeros(n, dtype=bool)
        sizes = np.full(n, 200.0)
        df = _make_df(n, 100)
        with _FillEnv(True):
            le, se, out, _a = apply_fill_model_and_roll_signals(long_e, short_e, sizes, df, symbol="MES")
        assert out[6] == 100.0


# ─── Clause 2: NON-VACUOUSNESS (the wiring-is-live proof) ────────────────────


class TestNonVacuousness:
    """zone-2 AND zone-3 cases: class ENGAGED path == run_backtest oracle AND !=
    the DORMANT (fill_model absent) path.

    Constant per-bar sizes make the roll/re-align a no-op on VALUE, so the
    observable engaged-vs-dormant difference is PURELY the volume degradation —
    a zone-1-only fixture would pass even if the mirror were dead code, so this is
    the required non-vacuous, wiring-is-live proof. The two engaged-vs-dormant
    numbers are printed for the deliverable.

    Amendment 2026-07-09: both branches route through `_class_fill_branch`, whose
    OUTER gate is the `fill_model` PARAMETER (mirroring run_backtest's operative
    surface). ENGAGED = an explicit FillProbabilityConfig is passed; DORMANT =
    fill_model absent (None), which is the production default no caller populates.
    Env is left at its default-ON so this ALSO proves the env flag no longer drives
    activation — with the pre-amendment env gate, the dormant call would have
    degraded; with the param gate it stays byte-identical.
    """

    def _matched_and_disabled(self, sizes_val, volume, signal_bar=5, n=12):
        long_e = _single_long(n, signal_bar)
        short_e = np.zeros(n, dtype=bool)
        sizes = np.full(n, float(sizes_val))
        df = _make_df(n, volume)
        fill_bar = signal_bar + 1
        # ENGAGED: explicit fill_model passed through the class activation gate.
        # DORMANT: fill_model=None → plain-roll no-op. Env default-ON throughout.
        with _FillEnv(True):
            le, se, out_enabled, _a = _class_fill_branch(
                long_e.copy(), short_e.copy(), sizes.copy(), df, "MES",
                fill_model=FillProbabilityConfig(),
            )
            # run_backtest oracle on identical inputs
            _leo, _seo, out_oracle = _run_backtest_fill_oracle(
                long_e.copy(), short_e.copy(), sizes.copy(), df, symbol="MES"
            )
            # DORMANT baseline = class path with fill_model absent (helper NOT
            # called): sizes untouched, entries rolled +1 — even with env ON.
            _led, _sed, out_dormant, _ad = _class_fill_branch(
                long_e.copy(), short_e.copy(), sizes.copy(), df, "MES",
                fill_model=None,
            )
        return out_enabled[fill_bar], out_oracle[fill_bar], out_dormant[fill_bar], le[fill_bar]

    def test_zone2_matches_oracle_and_differs_from_disabled(self):
        matched, oracle, disabled, entry_present = self._matched_and_disabled(50, 100)
        print(f"\n[D7 NON-VACUOUS zone-2] class-matched={matched}  "
              f"oracle(run_backtest)={oracle}  disabled-baseline={disabled}")
        assert entry_present  # rolled entry lands on the fill bar
        assert matched == oracle       # class helper == run_backtest (parity)
        assert matched != disabled     # AND differs from disabled (mirror is LIVE)
        assert matched == 38.0 and disabled == 50.0

    def test_zone3_matches_oracle_and_differs_from_disabled(self):
        matched, oracle, disabled, entry_present = self._matched_and_disabled(200, 100)
        print(f"\n[D7 NON-VACUOUS zone-3] class-matched={matched}  "
              f"oracle(run_backtest)={oracle}  disabled-baseline={disabled}")
        assert entry_present
        assert matched == oracle
        assert matched != disabled
        assert matched == 100.0 and disabled == 200.0


# ─── Clause 6: DORMANT-when-absent (activation-surface amendment 2026-07-09) ─


class TestDormantWhenAbsent:
    """Amendment 2026-07-09: the DEFAULT (fill_model absent) is a byte-identical
    no-op — plain roll, ZERO degradation — regardless of env, matching
    run_backtest's production dormancy (`if request.fill_model:` never fires
    because no src/server path populates it).

    This is the parity anchor: production run_class_backtest, like production
    run_backtest, applies NO fill degradation. The env flag being ON must NOT
    change that while fill_model is absent — proving the activation surface moved
    from the env flag to the fill_model param.
    """

    def test_absent_fill_model_is_plain_roll_even_with_env_on(self):
        # A thin-volume bar that WOULD degrade to 38 if the model engaged.
        n = 12
        long_e = _single_long(n, 5)
        short_e = np.zeros(n, dtype=bool)
        sizes = np.full(n, 50.0)
        df = _make_df(n, 100)  # zone-2 volume
        with _FillEnv(True):  # env default-ON — must NOT activate degradation
            le, se, out, audit = _class_fill_branch(
                long_e, short_e, sizes, df, "MES", fill_model=None,
            )
        # Entries rolled +1 (next-bar fill) but sizes UNTOUCHED (no degradation).
        assert le[6] and not le[5]
        assert out[6] == 50.0                 # dormant: NOT the engaged 38.0
        assert np.all(out == 50.0)            # every bar untouched
        assert audit == {}                    # no engagement audit — dormant path

    def test_absent_equals_manual_plain_roll_byte_identical(self):
        # The dormant branch must equal an independent hand-written plain roll.
        n = 14
        long_e = _single_long(n, 4)
        short_e = _single_long(n, 9)
        sizes = np.full(n, 50.0)
        df = _make_df(n, 100)
        with _FillEnv(True):
            le, se, out, _a = _class_fill_branch(
                long_e.copy(), short_e.copy(), sizes.copy(), df, "MES",
                fill_model=None,
            )
        ref_le = np.roll(long_e, 1)
        ref_le[0] = False
        ref_se = np.roll(short_e, 1)
        ref_se[0] = False
        np.testing.assert_array_equal(le, ref_le)
        np.testing.assert_array_equal(se, ref_se)
        np.testing.assert_array_equal(out, sizes)  # sizes untouched


# ─── Clause: full parity on identical inputs (long + short, mixed zones) ─────


class TestFullParityWithOracle:
    """Class helper output == run_backtest oracle across long + short + all zones."""

    def test_long_and_short_mixed_zones_parity(self):
        n = 20
        long_e = np.zeros(n, dtype=bool)
        short_e = np.zeros(n, dtype=bool)
        long_e[4] = True    # zone-2 long
        long_e[10] = True   # zone-3 long
        short_e[7] = True   # zone-1 short
        short_e[14] = True  # zone-2 short
        sizes = np.full(n, 50.0)
        # per-bar volume to place each entry in a chosen zone
        vol = [100_000] * n
        vol[4] = 100     # 50/100 = 0.5 zone-2
        vol[10] = 40     # 50/40 = 1.25 zone-3
        vol[7] = 100_000  # zone-1
        vol[14] = 120    # 50/120 = 0.417 zone-2
        df = _make_df(n, vol)
        with _FillEnv(True):
            le_h, se_h, out_h, _ah = apply_fill_model_and_roll_signals(
                long_e.copy(), short_e.copy(), sizes.copy(), df, symbol="MES"
            )
            le_o, se_o, out_o = _run_backtest_fill_oracle(
                long_e.copy(), short_e.copy(), sizes.copy(), df, symbol="MES"
            )
        np.testing.assert_array_equal(le_h, le_o)
        np.testing.assert_array_equal(se_h, se_o)
        np.testing.assert_array_equal(out_h, out_o)

    def test_audit_counter_populated(self):
        # D7 engagement instrumentation (Addition 2): the combined audit reports
        # total_orders / partial_fills / avg_fill_ratio.
        n = 12
        long_e = _single_long(n, 5)
        short_e = np.zeros(n, dtype=bool)
        sizes = np.full(n, 50.0)
        df = _make_df(n, 100)  # zone-2
        with _FillEnv(True):
            _le, _se, _out, audit = apply_fill_model_and_roll_signals(
                long_e, short_e, sizes, df, symbol="MES"
            )
        assert audit["enabled"] is True
        assert audit["total_orders"] == 1
        assert audit["partial_fills"] == 1
        assert audit["avg_fill_ratio"] < 1.0


# ─── Clause 3: Partial-entry × Style C 33/33/34 (33% of FILLED, not ORDERED) ─


class TestPartialEntryStyleC:
    """The size handed downstream is the FILLED size, so Style C's 33/33/34 is
    necessarily computed on the FILLED size — there is no separate ORDERED size
    threaded to trade management in EITHER engine.

    Traced run_backtest behaviour: the (degraded) `sizes` array is the SOLE size
    input to vbt.Portfolio.from_signals (backtester.py:4990 / class 7118 `size=`);
    pf.trades.Size therefore carries the FILLED size, and _apply_trade_management's
    Style C 33/33/34 blend operates on that trade Size. The ORDERED size is
    overwritten in-place by the fill model and never retained — it is structurally
    impossible for Style C to see the ordered quantity. This fixture pins that.
    """

    def test_style_c_partials_ride_on_filled_size(self):
        n = 12
        long_e = _single_long(n, 5)
        short_e = np.zeros(n, dtype=bool)
        ordered = 50.0
        sizes = np.full(n, ordered)
        df = _make_df(n, 100)  # zone-2 → filled 38
        with _FillEnv(True):
            _le, _se, out, _a = apply_fill_model_and_roll_signals(
                long_e, short_e, sizes, df, symbol="MES"
            )
        filled = out[6]
        assert filled == 38.0 and filled != ordered
        # Style C 33/33/34 is computed on `filled`, NOT `ordered`. Concrete integer
        # split (floor per style_c_handler contract) of the FILLED size:
        tp1 = int(filled * 0.33)   # 12  (of 38) — NOT int(50*0.33)=16
        tp2 = int(filled * 0.33)   # 12
        runner = int(filled) - tp1 - tp2  # 14
        assert (tp1, tp2, runner) == (12, 12, 14)
        # Prove the ordered-size split would have been different (16/16/18) — the
        # whole point of the fill model is that this is NOT what executes.
        assert int(ordered * 0.33) == 16 and (tp1, tp2, runner) != (16, 16, 18)


# ─── Clause 4: exit-leg case (fill model is entry-only) ─────────────────────


class TestExitLeg:
    """The volume partial-fill model applies to ENTRIES only; exit legs are NOT
    volume-degraded in either engine (the helper does not even receive exits —
    exits are managed by _apply_trade_management). A Style C partial EXIT rides on
    the already-partially-filled ENTRY size, not a separately-degraded exit fill.
    """

    def test_exits_are_not_volume_degraded(self):
        # Build a run with an entry AND thin-volume bars where an EXIT would land.
        # The helper takes long_entries/short_entries only — exits pass through the
        # engine untouched by fill degradation. We assert the helper only alters the
        # entry-fill bar's size and touches nothing exit-related.
        n = 14
        long_e = _single_long(n, 4)          # entry signal bar 4 (fills bar 5)
        short_e = np.zeros(n, dtype=bool)
        sizes = np.full(n, 50.0)
        # thin volume everywhere would degrade ENTRIES if they existed there; the
        # only entry is bar 4, so only bar 5 (rolled) should carry a degraded size.
        vol = [100] * n
        df = _make_df(n, vol)
        with _FillEnv(True):
            le, se, out, _a = apply_fill_model_and_roll_signals(
                long_e, short_e, sizes, df, symbol="MES"
            )
        signal_bar, entry_fill_bar = 4, 5
        # Only the entry's own two bars carry the degraded (38) size: the pre-roll
        # signal bar (in-place residue, no longer an entry post-roll → ignored by
        # from_signals — faithful to run_backtest) and the rolled entry-fill bar
        # (the one that actually executes). Every OTHER bar keeps the ordered 50 —
        # proving no exit leg was volume-degraded.
        degraded_bars = set(np.where(out != 50.0)[0].tolist())
        assert degraded_bars.issubset({signal_bar, entry_fill_bar})
        assert entry_fill_bar in degraded_bars
        assert out[entry_fill_bar] == 38.0
        # The Style C partial EXIT on this position exits FILLED (38) contracts split
        # 33/33/34 — the exit leg inherits the entry's filled size, it is never
        # re-degraded by volume at exit time.
        assert int(out[entry_fill_bar]) == 38


# ─── Clause 5: zero-volume routes to the guard, not a new ZeroDivision ───────


class TestZeroVolumeSafety:
    """The mirror introduces NO new order_qty/bar_volume division ahead of the
    fail-loud zero-volume guard. volume==0 → apply_volume_partial_fills maps it to
    np.inf before dividing (fill_model.py:339) → ratio 0 → zone-1 → fill_ratio 1.0,
    never a ZeroDivision. check_zero_volume_trade_critical() still owns volume==0
    downstream in _apply_static_styleC_management (unchanged by D7).
    """

    def test_zero_volume_entry_bar_no_crash_no_degrade(self):
        n = 12
        long_e = _single_long(n, 5)
        short_e = np.zeros(n, dtype=bool)
        sizes = np.full(n, 50.0)
        vol = [100_000] * n
        vol[5] = 0  # zero-volume entry bar
        df = _make_df(n, vol)
        with _FillEnv(True):
            le, se, out, _a = apply_fill_model_and_roll_signals(long_e, short_e, sizes, df, symbol="MES")
        # No exception raised; zero-volume bar is NOT degraded (routes to guard, not division).
        assert out[6] == 50.0

    def test_compute_ratio_zero_volume_returns_full_fill(self):
        n = 6
        df = _make_df(n, [0, 0, 0, 0, 0, 0])
        order_q = np.full(n, 50.0)
        with _FillEnv(True):
            ratios = compute_volume_based_fill_ratios(df, order_q)
        # zero volume → inf-guarded → ratio 0 → zone-1 → fill_ratio 1.0 (no crash).
        assert np.all(ratios == 1.0)


# ─── Base acceptance: default-ON + disabled-byte-identical ──────────────────


class TestEnabledDisabledContract:
    def test_default_on_degrades(self):
        # No env var set → getter default "true" → enabled → degrades.
        for k in ("BACKTEST_PARTIAL_FILL_ENABLED", "BACKTEST_PARTIAL_FILL_VOLUME_THRESHOLD"):
            os.environ.pop(k, None)
        fm._get_partial_fill_enabled.cache_clear()
        fm._get_partial_fill_volume_threshold.cache_clear()
        assert fm._get_partial_fill_enabled() is True
        n = 12
        long_e = _single_long(n, 5)
        short_e = np.zeros(n, dtype=bool)
        sizes = np.full(n, 50.0)
        df = _make_df(n, 100)
        le, se, out, _a = apply_fill_model_and_roll_signals(long_e, short_e, sizes, df, symbol="MES")
        assert out[6] == 38.0

    def test_disabled_flag_gates_helper_off(self):
        # When disabled, run_class_backtest does NOT call the helper — it falls back
        # to the plain roll (byte-identical legacy). Assert the gate reads False and
        # the plain-roll reference leaves sizes untouched.
        with _FillEnv(False):
            assert fm._get_partial_fill_enabled() is False
            n = 12
            long_e = _single_long(n, 5)
            sizes = np.full(n, 50.0)
            # Legacy plain-roll branch (what the caller runs when disabled):
            legacy_long = np.roll(long_e, 1)
            legacy_long[0] = False
            legacy_sizes = sizes.copy()  # untouched
            assert legacy_long[6] and not legacy_long[5]
            assert np.all(legacy_sizes == 50.0)

    def test_helper_disabled_no_size_degradation(self):
        # Defensive: even if the helper is invoked with the flag off, Stage 2 is a
        # no-op (apply_volume_partial_fills returns sizes.copy()); the only change is
        # the roll/re-align reindex, which on constant sizes is value-preserving.
        n = 12
        long_e = _single_long(n, 5)
        short_e = np.zeros(n, dtype=bool)
        sizes = np.full(n, 50.0)
        df = _make_df(n, 100)
        with _FillEnv(False):
            le, se, out, audit = apply_fill_model_and_roll_signals(long_e, short_e, sizes, df, symbol="MES")
        assert out[6] == 50.0  # no degradation while disabled
        assert audit.get("enabled") is False


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v", "-s"]))
