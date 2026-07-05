"""spec_condition_compiler.py — Band C executable evaluator for compiled specs.

Consumes `config.compiled_spec.spec` (Band B's lossless condition graph) and
`spec_family_bindings.compile_binding_plan()` (Band C's binding plan) and
produces a BaseStrategy-compatible class (`SpecConditionStrategy`) that
backtester.py can run through the SAME `run_class_backtest()` path every
archetype strategy already uses (see `_load_strategy_class` +
`ARCHETYPE_CLASS_MAP` in archetype_evaluator.py for the established pattern
this class follows: a BaseStrategy subclass whose `compute(df)` emits
entry_long/entry_short/exit_long/exit_short boolean columns; the backtester's
own P&L, stop, and exit machinery is untouched).

HARD BOUNDARIES (per Band C mandate):
  - Exits are NEVER computed here. `exit_long`/`exit_short` are always False —
    framework-overlay + backtester's own stop/TP machinery is AUTHORITATIVE
    (W23F.N). EXIT_HINT conditions are recorded in the trace ONLY, never
    executed — this file must never set an exit column from an EXIT_HINT.
  - Every evaluator that uses an `approximation=True` primitive (per the
    binding plan) propagates that flag into `governance_labels.approximation`
    on the strategy instance so callers can honestly label results.
  - Deterministic: no wall-clock reads, no randomness. Same df + same spec
    always produces the same entry_long/entry_short arrays (replay
    determinism contract, backtest-core's #2 priority).

TRACE (C3, TF_SPEC_TRACE): when `trace=True` is passed to the constructor (or
env var TF_SPEC_TRACE=true is read by the CLI-facing factory), every entry
signal bar is recorded as one trace record capturing which conditions fired,
their bound primitive, and their original transcript span+evidence id. When
trace is off (default), zero extra computation happens and the emitted
entry/exit columns are byte-identical to the trace-on run — see
tests/test_spec_condition_compiler_trace_byte_identity.py.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import numpy as np
import polars as pl

from src.engine.context.structural_stops import compute_structural_stop
from src.engine.indicators.bias_native import compute_bias_signal
from src.engine.indicators.confirmation_native import compute_confirmation_signal
from src.engine.indicators.core import compute_atr, compute_ema
from src.engine.indicators.fvg_native import compute_fvg_signal
from src.engine.indicators.market_structure import detect_swings
from src.engine.indicators.mss_native import compute_mss_signal
from src.engine.indicators.sweep_native import compute_sweep_signal
from src.engine.session_windows import is_in_killzone
from src.engine.spec_family_bindings import BindingPlan, ConditionBinding, compile_binding_plan
from src.engine.strategy_base import BaseStrategy

FVG_PRIMITIVE_NAME: str = "fvg_native.compute_fvg_signal"
# Composition Fidelity Experiment (docs/designs/composition-fidelity-experiment-2026-07-05.md)
# bundle primitive names — MUST match the literal strings spec_family_bindings.resolve_bundle_
# primitive() returns (that module has zero import surface by design, so these are independently
# duplicated string constants, same convention as FVG_PRIMITIVE_NAME above).
BIAS_PRIMITIVE_NAME: str = "bias_native.compute_bias_signal"
CONFIRMATION_PRIMITIVE_NAME: str = "confirmation_native.compute_confirmation_signal"
SWEEP_PRIMITIVE_NAME: str = "sweep_native.compute_sweep_signal"
MSS_PRIMITIVE_NAME: str = "mss_native.compute_mss_signal"
BUNDLE_BEARISH_KEYWORDS: tuple[str, ...] = ("bearish", "short", "down", "sell")
BUNDLE_BULLISH_KEYWORDS: tuple[str, ...] = ("bullish", "long", "up ", "buy")
"""Binding-plan primitive marker used by spec_family_bindings.bind_condition() when
TF_FVG_IDENTITY_ENABLED routes a WAIT_STRUCTURE/FILTER FVG-family condition to the fresh
fvg_native detector (see that module's FVG Identity Dispatch Experiment docstring). Checked
HERE (not just `b.type in (WAIT_STRUCTURE, FILTER)`) so the FVG-bound conditions get their OWN
evaluator result — a distinct object into per_condition_bool / spec_trace — instead of being
silently folded back into the shared generic structure/confluence array every other
WAIT_STRUCTURE/FILTER condition uses. This is the whole point of the experiment (point-8:
routing to a DIFFERENT primitive is not the same as PRESERVING identity unless the executable
path actually evaluates that primitive)."""

# ─── Named constants (CLAUDE.md §13: no magic numbers inline) ────────────────
STRUCTURE_RECOMPUTE_CADENCE_BARS: int = 10   # perf: structure state is slow-changing
STRUCTURE_WINDOW_BARS: int = 250             # trailing window fed to compute_structure_state
BIAS_EMA_FAST: int = 20
BIAS_EMA_SLOW: int = 50
RETEST_PROXIMITY_ATR_MULT: float = 1.0
RETEST_LEVEL_EMA_PERIOD: int = 20
CANDLE_WICK_RATIO_THRESHOLD: float = 0.4
MIN_BARS_REQUIRED: int = 30
ATR_PERIOD: int = 14
TICK_SIZE_BY_SYMBOL: dict[str, float] = {"MES": 0.25, "MNQ": 0.25, "MCL": 0.01}


def retest_touch_check(
    close: np.ndarray,
    high: np.ndarray,
    low: np.ndarray,
    level: np.ndarray,
    atr: np.ndarray,
    proximity_atr_mult: float = RETEST_PROXIMITY_ATR_MULT,
) -> np.ndarray:
    """Generalized ATR-proximity retest check — same math as
    BounceOffLevelStrategy._is_rejection_candle_long's proximity test, but
    generalized to an arbitrary `level` series rather than one strategy's
    fixed MA. APPROXIMATION: does not check rejection-candle shape (that's
    WAIT_CONFIRMATION's job) — this evaluator answers only "did price come
    within proximity of the level," not "did it reject."
    """
    n = len(close)
    out = np.zeros(n, dtype=bool)
    for i in range(1, n):
        lvl = level[i]
        a = atr[i]
        if np.isnan(lvl) or np.isnan(a) or a <= 0:
            continue
        prox = proximity_atr_mult * a
        touched = (low[i] <= lvl + prox) and (high[i] >= lvl - prox)
        out[i] = bool(touched)
    return out


def candle_confirmation_check(
    open_: np.ndarray, high: np.ndarray, low: np.ndarray, close: np.ndarray
) -> tuple[np.ndarray, np.ndarray]:
    """Generic bullish/bearish rejection-candle check — generalizes
    BounceOffLevelStrategy's wick_reject pattern to arbitrary WAIT_CONFIRMATION
    objects (long wick rejection, engulfing-style close-back-through, etc.).
    APPROXIMATION: a single generic pattern stands in for whatever specific
    candle behavior the spec's natural-language object described.

    Returns: (bullish_confirmation, bearish_confirmation) boolean arrays.
    """
    n = len(close)
    bullish = np.zeros(n, dtype=bool)
    bearish = np.zeros(n, dtype=bool)
    for i in range(n):
        o, h, lo, c = open_[i], high[i], low[i], close[i]
        rng = h - lo
        if rng <= 0:
            continue
        lower_wick = min(o, c) - lo
        upper_wick = h - max(o, c)
        if lower_wick >= CANDLE_WICK_RATIO_THRESHOLD * rng and c >= (lo + rng * 0.5):
            bullish[i] = True
        if upper_wick >= CANDLE_WICK_RATIO_THRESHOLD * rng and c <= (h - rng * 0.5):
            bearish[i] = True
    return bullish, bearish


def _bars_to_ts_list(df: pl.DataFrame) -> list[datetime | None]:
    if "ts_event" not in df.columns:
        return [None] * len(df)
    col = df["ts_event"]
    out: list[datetime | None] = []
    for v in col.to_list():
        if v is None:
            out.append(None)
            continue
        if isinstance(v, datetime):
            out.append(v if v.tzinfo else v.replace(tzinfo=UTC))
        else:
            out.append(None)
    return out


class SpecConditionStrategy(BaseStrategy):
    """Executable evaluator for a Band-B-onboarded spec that did not match a
    named archetype but DID clear the Band C binding-plan coverage threshold
    (see spec_family_bindings.compile_binding_plan / MIN_SPINE_BOUND_RATIO).

    Constructed via `from_compiled_spec()` — mirrors how ARCHETYPE_CLASS_MAP
    entries are instantiated with no-arg `cls()` in archetype_evaluator.py,
    except this class needs the actual spec payload, so it is NOT dispatched
    via `--strategy-class` dotted-path loading; backtester.py's `main()`
    detects `config["compiled_spec"]` directly (see the additive branch there)
    and builds this class from it.
    """

    name = "spec_conditions"
    preferred_regime = None
    overnight_hold = False

    def __init__(
        self,
        compiled_spec: dict[str, Any],
        symbol: str = "MES",
        timeframe: str = "5m",
        trace: bool = False,
        binding_plan: BindingPlan | None = None,
        strategy_name: str | None = None,
        restore_condition_ids: frozenset[str] | None = None,
    ) -> None:
        self.compiled_spec = compiled_spec
        self.spec = compiled_spec.get("spec", {}) if "spec" in compiled_spec else compiled_spec
        self.spec_hash = compiled_spec.get("spec_hash", "")
        self.symbol = symbol
        self.timeframe = timeframe
        self.trace_enabled = trace
        # Composition Fidelity Experiment (default None — 100% backward compatible; see
        # spec_family_bindings.compile_binding_plan's restore_condition_ids docstring).
        self.restore_condition_ids = restore_condition_ids
        self.binding_plan = binding_plan or compile_binding_plan(self.spec, restore_condition_ids=restore_condition_ids)
        # OVERLAY-VISIBILITY CONTRACT (Band C follow-up, closes the same bug
        # class B2 closed for archetype-mapped onboards): `apply_eligibility_gate()`
        # in backtester.py checks `strategy_name` against playbook_router.py's
        # ALL_STRATS to decide whether the 7-layer institutional confluence
        # overlay applies AT ALL — an unregistered name passes through
        # unconditionally regardless of TF_CONFLUENCE_OVERLAY_DISABLED (both
        # Mode A and Mode B look identical: gate never runs). spec-onboarding-
        # service.ts's B2 playbook registration writes the EXACT DB
        # `strategies.name` (e.g. "buying_opportunity_mes_5m") into
        # playbook_router.py — so this class's runtime `.name` MUST equal that
        # same string, not a synthetic hash-based marker, or registration is
        # silently ineffective. `strategy_name` is threaded from
        # `config["strategy"]["name"]` in backtester.py's compiled_spec
        # dispatch branch (which the /api/backtests route resolves from
        # `strategies.name` when no inline strategy config is supplied — the
        # same DB column Band B registers). Falls back to a synthetic
        # spec_hash-based marker ONLY when no name is supplied (ad-hoc/test
        # usage) — that fallback is INTENTIONALLY unregistered/unmatched so it
        # fails safe (passthrough) rather than accidentally colliding with a
        # real registered name.
        self.name = strategy_name if strategy_name else f"spec_conditions:{self.spec_hash[:12] if self.spec_hash else 'unknown'}"
        # Governance propagation (C1 mandate): any result produced by this
        # strategy MUST carry approximation=True through to governance_labels
        # so downstream verdicts stay honest.
        self.approximation: bool = self.binding_plan.approximation_used
        # Populated by compute() when trace_enabled=True.
        self.last_trace: list[dict] = []
        # DIAGNOSTIC-ONLY (composition-fidelity-experiment-2026-07-05.md Step 0): always
        # populated by compute() regardless of trace_enabled — read-only per-condition boolean
        # arrays keyed by condition_id, the SAME arrays compute() ANDs together to derive
        # spine_satisfied. Zero effect on entry_long/entry_short/exit_long/exit_short (additive
        # attribute only, mirrors the last_trace pattern) — used by
        # scripts/composition-gating-diagnostic.py to measure per-condition true-frequency and
        # the smallest-AND-subset ("gating set") that reproduces the strategy's real entry bars,
        # BLIND to any before/after SDS comparison (Step 0 runs on baseline-mode compute() only).
        self.last_per_condition_bool: dict[str, np.ndarray] = {}

    # ─── BaseStrategy interface ────────────────────────────────────────────
    def get_params(self) -> dict:
        return {
            "spec_hash": self.spec_hash,
            "spine_bound": self.binding_plan.spine_bound,
            "spine_total": self.binding_plan.spine_total,
        }

    def get_default_config(self) -> dict:
        return {
            "name": self.name,
            "spec_hash": self.spec_hash,
            "compiled": self.binding_plan.compiled,
            "approximation": self.approximation,
        }

    # ─── Per-family evaluators (each returns a bool np.ndarray of len n) ────
    def _eval_wait_session(self, binding: ConditionBinding, ts_list: list[datetime | None], n: int) -> np.ndarray:
        zone = binding.session_zone
        out = np.zeros(n, dtype=bool)
        if not zone:
            return out
        for i, ts in enumerate(ts_list):
            if ts is not None:
                out[i] = is_in_killzone(ts, zone)
        return out

    def _eval_wait_structure(self, n: int, df: pl.DataFrame) -> np.ndarray:
        """Generic structural-activity check via structure_engine, cadence-
        limited for performance (structure state changes slowly bar-to-bar).
        APPROXIMATION: htf_bars=exec window (no separate HTF frame wired) and
        the specific structural OBJECT text (e.g. "vwap and volume profile
        combination") is not checked — only generic BOS/CHoCH/MSS activity."""
        from src.engine.context.structure_engine import compute_structure_state

        out = np.zeros(n, dtype=bool)
        if n < MIN_BARS_REQUIRED:
            return out
        last_result = False
        for i in range(n):
            if i < MIN_BARS_REQUIRED - 1:
                continue
            if i % STRUCTURE_RECOMPUTE_CADENCE_BARS == 0 or i == n - 1:
                start = max(0, i - STRUCTURE_WINDOW_BARS + 1)
                window = df.slice(start, i - start + 1)
                try:
                    state = compute_structure_state(window, window)
                except Exception:  # noqa: BLE001 — fail-soft to prior value
                    state = None
                last_result = bool(
                    state is not None and (state.bos_recent or state.choch_recent or state.mss_recent)
                )
            out[i] = last_result
        return out

    def _eval_wait_bias(self, close: np.ndarray, n: int, want_bearish: bool = False) -> np.ndarray:
        """Directional-bias proxy via fast/slow EMA slope sign.
        APPROXIMATION: full bias_engine.classify_institutional_regime needs
        HTFContext/SessionContext construction not available in a bar-only
        compute() path — documented follow-up in
        docs/spec-execution-semantics.md. This proxy answers "is there a
        directional lean," not the full institutional regime classification."""
        out = np.zeros(n, dtype=bool)
        if n < BIAS_EMA_SLOW + 2:
            return out
        s = pl.Series(close)
        fast = compute_ema(s, BIAS_EMA_FAST).to_numpy()
        slow = compute_ema(s, BIAS_EMA_SLOW).to_numpy()
        for i in range(n):
            if np.isnan(fast[i]) or np.isnan(slow[i]):
                continue
            bullish_lean = fast[i] > slow[i]
            out[i] = (not bullish_lean) if want_bearish else bullish_lean
        return out

    def _eval_fvg(self, open_: np.ndarray, high: np.ndarray, low: np.ndarray, close: np.ndarray) -> np.ndarray:
        """FVG identity dispatch (experiment): evaluate via the fresh, isolated
        fvg_native detector rather than the generic structure_engine activity check.
        `any_active` (bullish OR bearish) is the per-bar gating signal — directional FVG
        selection (long vs short) is out of scope for this experiment; direction is still
        decided the same way as every other spec (self.spec['direction'] + the EMA-slope
        proxy for "both"), unchanged by this evaluator."""
        result = compute_fvg_signal(open_, high, low, close)
        return result.any_active

    @staticmethod
    def _select_directional(result: Any, object_text: str) -> np.ndarray:
        """Composition Fidelity Experiment: given a native evaluator's directional Result
        (bullish_active/bearish_active/any_active) and the condition's OWN object text, pick the
        sub-signal that matches the object's stated direction when the text names one — otherwise
        fall back to `any_active` (a real, condition-family-specific signal, still a faithful
        improvement over the previous single shared undifferentiated array, honestly used when
        the object text itself gives no directional hint)."""
        norm = f" {(object_text or '').strip().lower()} "
        if any(kw in norm for kw in BUNDLE_BEARISH_KEYWORDS):
            return result.bearish_active
        if any(kw in norm for kw in BUNDLE_BULLISH_KEYWORDS):
            return result.bullish_active
        return result.any_active

    def _eval_wait_retest(self, close: np.ndarray, high: np.ndarray, low: np.ndarray, n: int) -> np.ndarray:
        if n < RETEST_LEVEL_EMA_PERIOD + 2:
            return np.zeros(n, dtype=bool)
        level = compute_ema(pl.Series(close), RETEST_LEVEL_EMA_PERIOD).to_numpy()
        df_atr = pl.DataFrame({"high": high, "low": low, "close": close})
        atr = compute_atr(df_atr, ATR_PERIOD).to_numpy()
        return retest_touch_check(close, high, low, level, atr)

    # ─── Core compute ───────────────────────────────────────────────────────
    def compute(self, df: pl.DataFrame) -> pl.DataFrame:
        n = len(df)
        false_col = pl.lit(False)
        if n < MIN_BARS_REQUIRED:
            self.last_trace = []
            self.last_per_condition_bool = {}
            return df.with_columns(
                [
                    false_col.alias("entry_long"),
                    false_col.alias("entry_short"),
                    false_col.alias("exit_long"),
                    false_col.alias("exit_short"),
                ]
            )

        close = df["close"].to_numpy().astype(np.float64)
        high = df["high"].to_numpy().astype(np.float64)
        low = df["low"].to_numpy().astype(np.float64)
        open_ = df["open"].to_numpy().astype(np.float64)
        ts_list = _bars_to_ts_list(df)

        bullish_confirm, bearish_confirm = candle_confirmation_check(open_, high, low, close)
        wait_bias_bull = None
        wait_structure = None
        wait_retest = None
        fvg_signal = None
        # Composition Fidelity Experiment bundle caches (each computed at most once per compute()
        # call, mirroring fvg_signal's caching above) — separate cache per family so a spec with
        # e.g. both a restored WAIT_BIAS and a restored WAIT_CONFIRMATION condition evaluates each
        # native primitive exactly once and shares its result ONLY across conditions bound to that
        # SAME primitive (never across families).
        bias_result = None
        confirmation_result = None
        sweep_result = None
        mss_result = None

        spine_bindings = [b for b in self.binding_plan.bindings if b.role == "spine"]
        per_condition_bool: dict[str, np.ndarray] = {}

        for b in spine_bindings:
            if not b.executed:
                # EXIT_HINT (and any other non-executed family): provenance
                # only, per the module docstring's hard boundary — MUST NOT
                # enter the gating loop or the trace's "conditions" list at
                # all, not even as a harmless always-True pass-through.
                continue

            if not b.bindable:
                # Permitted-through unbound spine condition (ratio allowed it) —
                # pass-through, never gates. Honest default per module docstring.
                per_condition_bool[b.condition_id] = np.ones(n, dtype=bool)
                continue

            if b.primitive == FVG_PRIMITIVE_NAME:
                # FVG identity dispatch (experiment) — checked BEFORE the generic
                # WAIT_STRUCTURE/FILTER type dispatch below so an FVG-family binding
                # never falls through to the shared generic structure/confluence
                # array, regardless of whether its condition `type` is WAIT_STRUCTURE
                # or FILTER. Distinct object into per_condition_bool / spec_trace.
                if fvg_signal is None:
                    fvg_signal = self._eval_fvg(open_, high, low, close)
                per_condition_bool[b.condition_id] = fvg_signal
            elif b.primitive == BIAS_PRIMITIVE_NAME:
                # Composition-bundle restoration (experiment) — checked BEFORE the generic
                # WAIT_BIAS/CONFIRM_DIRECTION type dispatch below, same placement discipline as
                # the FVG check above. Directional sub-signal selected from THIS condition's own
                # object text (see _select_directional) — fixes the pre-existing bug where every
                # WAIT_BIAS condition shared one bullish-only-checked array regardless of what its
                # object actually named.
                if bias_result is None:
                    bias_result = compute_bias_signal(open_, high, low, close)
                per_condition_bool[b.condition_id] = self._select_directional(bias_result, b.object)
            elif b.primitive == CONFIRMATION_PRIMITIVE_NAME:
                if confirmation_result is None:
                    confirmation_result = compute_confirmation_signal(open_, high, low, close)
                per_condition_bool[b.condition_id] = self._select_directional(confirmation_result, b.object)
            elif b.primitive == SWEEP_PRIMITIVE_NAME:
                if sweep_result is None:
                    sweep_result = compute_sweep_signal(open_, high, low, close)
                per_condition_bool[b.condition_id] = self._select_directional(sweep_result, b.object)
            elif b.primitive == MSS_PRIMITIVE_NAME:
                if mss_result is None:
                    mss_result = compute_mss_signal(open_, high, low, close)
                per_condition_bool[b.condition_id] = self._select_directional(mss_result, b.object)
            elif b.type == "WAIT_SESSION":
                per_condition_bool[b.condition_id] = self._eval_wait_session(b, ts_list, n)
            elif b.type in ("WAIT_STRUCTURE", "VERIFY_STRUCTURE"):
                if wait_structure is None:
                    wait_structure = self._eval_wait_structure(n, df)
                per_condition_bool[b.condition_id] = wait_structure
            elif b.type in ("WAIT_BIAS", "CONFIRM_DIRECTION"):
                if wait_bias_bull is None:
                    wait_bias_bull = self._eval_wait_bias(close, n, want_bearish=False)
                per_condition_bool[b.condition_id] = wait_bias_bull
            elif b.type == "WAIT_RETEST":
                if wait_retest is None:
                    wait_retest = self._eval_wait_retest(close, high, low, n)
                per_condition_bool[b.condition_id] = wait_retest
            elif b.type == "WAIT_CONFIRMATION":
                per_condition_bool[b.condition_id] = bullish_confirm | bearish_confirm
            elif b.type == "FILTER":
                # Static presence-only pass-through — see module docstring
                # ("no standalone per-bar confluence primitive exists").
                per_condition_bool[b.condition_id] = np.ones(n, dtype=bool)
            else:
                per_condition_bool[b.condition_id] = np.ones(n, dtype=bool)

        self.last_per_condition_bool = per_condition_bool

        if per_condition_bool:
            spine_satisfied = np.ones(n, dtype=bool)
            for arr in per_condition_bool.values():
                spine_satisfied &= arr
        else:
            spine_satisfied = np.ones(n, dtype=bool)

        # Trigger single-fire semantics: rising edge into satisfied state.
        entry_signal = np.zeros(n, dtype=bool)
        entry_signal[0] = spine_satisfied[0]
        entry_signal[1:] = spine_satisfied[1:] & ~spine_satisfied[:-1]

        direction = str(self.spec.get("direction", "long"))
        entry_long = np.zeros(n, dtype=bool)
        entry_short = np.zeros(n, dtype=bool)

        if direction == "long":
            entry_long = entry_signal
        elif direction == "short":
            entry_short = entry_signal
        else:  # "both" — direct via EMA-slope proxy at the firing bar
            if wait_bias_bull is None:
                wait_bias_bull = self._eval_wait_bias(close, n, want_bearish=False)
            entry_long = entry_signal & wait_bias_bull
            entry_short = entry_signal & ~wait_bias_bull

        exit_long = np.zeros(n, dtype=bool)   # framework-owned — NEVER set here
        exit_short = np.zeros(n, dtype=bool)  # framework-owned — NEVER set here

        if self.trace_enabled:
            self.last_trace = self._build_trace(
                entry_long, entry_short, per_condition_bool, ts_list, close, high, low
            )
        else:
            self.last_trace = []

        return df.with_columns(
            [
                pl.Series("entry_long", entry_long),
                pl.Series("entry_short", entry_short),
                pl.Series("exit_long", exit_long),
                pl.Series("exit_short", exit_short),
            ]
        )

    # ─── Trace (C3) ─────────────────────────────────────────────────────────
    def _build_trace(
        self,
        entry_long: np.ndarray,
        entry_short: np.ndarray,
        per_condition_bool: dict[str, np.ndarray],
        ts_list: list[datetime | None],
        close: np.ndarray,
        high: np.ndarray,
        low: np.ndarray,
    ) -> list[dict]:
        """Build one trace record per entry-signal bar: which conditions
        fired, bound to which primitive, with the original transcript span +
        evidence id. File-only additive output — zero effect on entry/exit
        columns (see byte-identity test)."""
        records: list[dict] = []
        binding_by_id = {b.condition_id: b for b in self.binding_plan.bindings}
        fired_idx = np.where(entry_long | entry_short)[0]

        # Real (not merely documented) reuse of the INVALIDATE primitive: for
        # every firing bar, compute the structural stop `compute_structural_stop`
        # WOULD place, using the nearest confirmed swing low/high before that
        # bar. This is trace/provenance ONLY — the value is recorded, never
        # used to gate entries or drive the actual exit (framework-owned).
        swing_lows: list[tuple[int, float]] = []
        swing_highs: list[tuple[int, float]] = []
        if len(close) >= MIN_BARS_REQUIRED and self.binding_plan.invalidation_bindings:
            try:
                swings_df = detect_swings(pl.DataFrame({"open": close, "high": high, "low": low, "close": close}))
                for row in swings_df.iter_rows(named=True):
                    idx, kind, price = row["index"], row["type"], row["price"]
                    if kind == "low":
                        swing_lows.append((idx, price))
                    elif kind == "high":
                        swing_highs.append((idx, price))
            except Exception:  # noqa: BLE001 — trace is best-effort, never fatal
                pass

        atr_arr = None
        if self.binding_plan.invalidation_bindings and len(close) >= ATR_PERIOD + 1:
            atr_arr = compute_atr(pl.DataFrame({"high": high, "low": low, "close": close}), ATR_PERIOD).to_numpy()

        def _nearest_swing_before(swings: list[tuple[int, float]], bar: int) -> float | None:
            candidates = [p for (idx, p) in swings if idx < bar]
            return candidates[-1] if candidates else None

        for i in fired_idx:
            direction = "long" if entry_long[i] else "short"
            fired_conditions = []
            for cond_id, arr in per_condition_bool.items():
                b = binding_by_id.get(cond_id)
                if b is None:
                    continue
                fired_conditions.append(
                    {
                        "condition_id": cond_id,
                        "type": b.type,
                        "object": b.object,
                        "primitive": b.primitive,
                        "approximation": b.approximation,
                        "satisfied_at_bar": bool(arr[i]),
                    }
                )

            invalidation_summary = []
            for b in self.binding_plan.invalidation_bindings:
                entry = {
                    "condition_id": b.condition_id,
                    "type": b.type,
                    "object": b.object,
                    "primitive": b.primitive,
                    "approximation": b.approximation,
                    "structural_stop_price": None,
                    "structural_stop_reason": None,
                }
                if atr_arr is not None and not np.isnan(atr_arr[i]) and atr_arr[i] > 0:
                    try:
                        plan = compute_structural_stop(
                            direction=direction,
                            entry_price=float(close[i]),
                            point_value=1.0,
                            atr=float(atr_arr[i]),
                            tick_size=TICK_SIZE_BY_SYMBOL.get(self.symbol, 0.25),
                            symbol=self.symbol,
                            nearest_swing_low=_nearest_swing_before(swing_lows, int(i)),
                            nearest_swing_high=_nearest_swing_before(swing_highs, int(i)),
                        )
                        entry["structural_stop_price"] = round(plan.stop_price, 4)
                        entry["structural_stop_reason"] = plan.stop_reason
                    except Exception:  # noqa: BLE001 — trace is best-effort, never fatal
                        pass
                invalidation_summary.append(entry)

            ts = ts_list[i]
            records.append(
                {
                    "bar_idx": int(i),
                    "ts": ts.isoformat() if ts else None,
                    "direction": direction,
                    "spec_hash": self.spec_hash,
                    "conditions": fired_conditions,
                    "invalidations_recorded": invalidation_summary,
                    "approximation_used": self.approximation,
                }
            )
        return records


def from_compiled_spec(
    compiled_spec: dict[str, Any],
    symbol: str = "MES",
    timeframe: str = "5m",
    trace: bool = False,
    strategy_name: str | None = None,
    restore_condition_ids: frozenset[str] | None = None,
) -> SpecConditionStrategy:
    """Factory mirroring the `_load_strategy_class` -> `cls()` pattern in
    backtester.py, but parameterized with the actual spec payload since this
    strategy class is spec-instance-specific (not a fixed archetype).

    `strategy_name` should be the exact DB `strategies.name` value (the same
    string spec-onboarding-service.ts's B2 playbook registration writes into
    playbook_router.py) so the eligibility-gate overlay-visibility contract
    holds — see SpecConditionStrategy.__init__ docstring comment.

    `restore_condition_ids`: Composition Fidelity Experiment bundle-restoration target set,
    default None (100% backward compatible — see compile_binding_plan's docstring).
    """
    return SpecConditionStrategy(
        compiled_spec=compiled_spec,
        symbol=symbol,
        timeframe=timeframe,
        trace=trace,
        strategy_name=strategy_name,
        restore_condition_ids=restore_condition_ids,
    )
