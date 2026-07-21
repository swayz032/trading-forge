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

import os
from datetime import UTC, datetime
from typing import Any

import numpy as np
import polars as pl

from src.engine.context.structural_stops import compute_structural_stop
from src.engine.indicators.bias_native import compute_bias_signal
from src.engine.indicators.confirmation_native import compute_confirmation_signal
from src.engine.indicators.core import compute_atr, compute_ema
from src.engine.indicators.fvg_native import compute_fvg_signal
from src.engine.indicators.liquidity import detect_buyside_liquidity, detect_sellside_liquidity
from src.engine.indicators.market_structure import detect_swings
from src.engine.indicators.mss_native import compute_mss_signal
from src.engine.indicators.order_flow import detect_bearish_ob, detect_bullish_ob
from src.engine.indicators.sweep_native import compute_sweep_signal
from src.engine.role_demotion_audit import get_classifications_for_video
from src.engine.session_windows import is_in_killzone
from src.engine.spec_family_bindings import (
    BindingPlan,
    ConditionBinding,
    classify_population_a_kind,
    compile_binding_plan,
    or_branches_enabled,
    role_demotion_mode,
)
from src.engine.strategy_base import BaseStrategy

FVG_PRIMITIVE_NAME: str = "fvg_native.compute_fvg_signal"
LEVELZONE_PRIMITIVE_NAME: str = "levelzone_routing.retest_touch_check"
# Level/Zone Routing Sub-Wire (docs/designs/packet-levelzone-subwire-2026-07-20.md, TF_LEVELZONE_
# ROUTING_ENABLED) — MUST match the literal string spec_family_bindings.LEVELZONE_NATIVE_PRIMITIVE
# returns, same independently-duplicated-constant convention as FVG_PRIMITIVE_NAME above (that
# module has zero import surface by design). Deliberately DISTINCT from the literal string
# FAMILY_META["WAIT_RETEST"].primitive uses ("spec_condition_compiler.retest_touch_check") even
# though both dispatch to the same underlying retest_touch_check computation — reusing that exact
# string here would make the `elif b.primitive == ...` check below collide with every genuine
# WAIT_RETEST condition's binding, unconditionally (see spec_family_bindings.py's comment on this
# constant for how that collision was caught).
LEVELZONE_RESOLVER_PRIMITIVE_NAME: str = "levelzone_routing.population_a_resolver"
# Population-A Level Resolver (docs/designs/packet-levelzone-population-a-resolver-
# 2026-07-20.md) — MUST match the literal string spec_family_bindings.
# LEVELZONE_RESOLVER_PRIMITIVE returns. Duplicated as a literal for the same collision-
# safety reason LEVELZONE_PRIMITIVE_NAME is duplicated above (that module's zero-import-
# surface purity contract + the real WAIT_RETEST collision this file's comment on
# LEVELZONE_PRIMITIVE_NAME documents catching).
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
POPULATION_A_SWING_LOOKBACK: int = 5
"""Population-A Level Resolver: swing-detection lookback fed to market_structure.
detect_swings, matching the confirmation-delay convention every production ICT strategy
that consumes swings uses (breaker.py / mitigation.py / unicorn.py / ict_swing.py all
default swing_lookback=5 — see market_structure.SWING_LOOKBACK_DEFAULT)."""
POPULATION_A_OB_VISIBILITY_MARGIN_BARS: int = 10
"""Population-A Level Resolver, order_block_edge kind — no-lookahead safety margin.
order_flow.py's `_find_bullish_obs`/`_find_bearish_obs` scan up to 10 bars BACKWARD from
a confirmed swing bar (`start = max(sl - 10, 0)`) to find the OB candle; the OB is not
actually knowable until that confirming swing bar resolves, and the SPECIFIC confirming
swing index isn't recoverable from the returned OB row (the numba kernel doesn't echo it
back per-row). The returned `index` is the OB CANDLE's own bar — using it directly as
"visible from" would look ahead by up to this many bars. Shifting visibility forward by
the FULL scan window is the conservative (never-lookahead) bound: the true confirming
swing bar is provably <= ob_index + 10 (it anchors the backward scan that found ob_index
in the first place), so ob_index + 10 is always >= the true knowable-at bar. MUST be kept
equal to order_flow.py's hardcoded scan-window constant (currently inlined as a literal
`10` there, not itself a named constant) — a mismatch here would silently reopen a
lookahead gap or over-tighten visibility."""
_DEMOTION_GROUP_OFFSET: int = 1_000_000
"""Hard-Constraint Demotion Experiment: offset added to struct_alt/struct_all's synthetic
per-strategy ALTERNATIVE OR-group index so it can never collide with the spec's own 0-based
or_branches indices in `_effective_or_branch_map()` (see that method's docstring)."""


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


def _ffill_level_series(indices: list[int], prices: list[float], n: int) -> np.ndarray:
    """Population-A Level Resolver helper: forward-fill a sparse set of (bar_index, price)
    detector points into a dense per-bar level array of length n. Bars before the first
    known point are NaN — same "no signal yet" convention retest_touch_check already
    honors for the EMA(20) proxy's own warm-up window (`np.isnan(lvl): continue`), so no
    new NaN-handling contract is introduced downstream. Pure, deterministic, no I/O."""
    out = np.full(n, np.nan, dtype=np.float64)
    if not indices:
        return out
    pairs = sorted(zip(indices, prices, strict=True), key=lambda p: p[0])
    last = np.nan
    pi = 0
    for i in range(n):
        while pi < len(pairs) and pairs[pi][0] <= i:
            last = pairs[pi][1]
            pi += 1
        out[i] = last
    return out


def population_a_bullish_leaning(kind: str, object_text: str) -> bool:
    """Population-A Level Resolver polarity selection: which side of the detector's output
    (support/demand/swing-low vs resistance/supply/swing-high) THIS condition's own object
    text names — same object-text-keyword-first convention as _select_directional /
    _resolve_wait_bias_bearish elsewhere in this file, applied to the Population-A kinds'
    own literal vocabulary (support/resistance, demand/supply, high/low) rather than the
    generic BUNDLE_BEARISH/BULLISH_KEYWORDS list (those don't appear in any of the 7
    corpus rows' object text). When a text names BOTH sides (e.g. row #0's "we want to
    take our support and resistance line..."), support/demand/low wins the tie —
    deterministic, documented, not accidental. When NEITHER side is literally named (should
    not happen for a condition that already matched a Population-A kind regex, since every
    kind's regex requires one of these words, but kept as an explicit documented default
    rather than an unreachable-assumed branch), the bullish/support-leaning side is used,
    matching _resolve_wait_bias_bearish's own long/both-default convention."""
    norm = f" {(object_text or '').strip().lower()} "
    if kind == "named_sr_level":
        if "support" in norm:
            return True
        if "resistance" in norm:
            return False
        return True
    if kind == "order_block_edge":
        if "demand" in norm:
            return True
        if "supply" in norm:
            return False
        if any(kw in norm for kw in BUNDLE_BEARISH_KEYWORDS):
            return False
        if any(kw in norm for kw in BUNDLE_BULLISH_KEYWORDS):
            return True
        return True
    if kind == "swing":
        if "low" in norm:
            return True
        if "high" in norm:
            return False
        return False
    return True


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

        # ─── Hard-Constraint Demotion Experiment (docs/designs/hard-constraint-demotion-
        # experiment-2026-07-05.md) ──────────────────────────────────────────────────
        # Resolve TF_ROLE_DEMOTION_MODE + the audited (video, condition_id) -> classification
        # map ONCE per instance, up front, so both compile_binding_plan() (structural modes) and
        # compute() (exec_all masking) share the SAME resolved map — never re-read from disk per
        # bar/call. `video` comes straight off compiled_spec (present on every spec_onboarding
        # artifact; see role_demotion_audit.py). mode="off" (every pre-experiment caller and any
        # spec with no `video`) means demotion_classifications stays empty and every downstream
        # check (struct_demotes / is_demotable) is a guaranteed no-op — byte-identical to
        # pre-experiment behavior with zero avoidable file I/O.
        self.role_demotion_mode: str = role_demotion_mode()
        self._demotion_classifications: dict[str, str] = {}
        video = compiled_spec.get("video")
        if self.role_demotion_mode != "off" and video:
            all_condition_ids = [str(c.get("id", "")) for c in (self.spec.get("entry_conditions") or [])]
            all_condition_ids += [str(c.get("id", "")) for c in (self.spec.get("invalidations") or [])]
            self._demotion_classifications = get_classifications_for_video(str(video), all_condition_ids)

        self.binding_plan = binding_plan or compile_binding_plan(
            self.spec,
            restore_condition_ids=restore_condition_ids,
            demotion_classifications=self._demotion_classifications or None,
        )
        # OR-Branches Honoring Fix (docs/designs/or-branches-honoring-fix-2026-07-05.md): map every
        # condition_id that is a member of an or_branch group to that group's index. Built
        # unconditionally (cheap — pure dict construction over an already-parsed spec) regardless
        # of TF_OR_BRANCHES_ENABLED, so the flag alone (checked at gating time in compute(), not
        # here) decides whether the mapping is ACTED on — same "always compute, flag-gate the
        # effect" discipline as self.approximation. `setdefault` means a condition_id that
        # (incorrectly) appears in more than one branch keeps its FIRST branch assignment rather
        # than raising — an honest defensive fallback for a malformed spec, never a crash.
        self._or_branch_of_condition: dict[str, int] = {}
        or_branches_raw = self.spec.get("or_branches")
        if isinstance(or_branches_raw, list):
            for branch_idx, branch_ids in enumerate(or_branches_raw):
                if not isinstance(branch_ids, list):
                    continue
                for cid in branch_ids:
                    self._or_branch_of_condition.setdefault(str(cid), branch_idx)

        # Hard-Constraint Demotion Experiment, struct_alt / struct_all: every condition_id this
        # STRATEGY (video) had classified ALTERNATIVE is grouped into ONE per-strategy OR_GROUP —
        # "any alternative route holding is enough." Deliberately a SEPARATE dict from
        # `_or_branch_of_condition` above (disjoint mechanism, disjoint flag: TF_ROLE_DEMOTION_MODE
        # vs TF_OR_BRANCHES_ENABLED — see _effective_or_branch_map()) so the two experiments can be
        # measured independently and never silently interact. When a video has only ONE
        # ALTERNATIVE-classified condition (the common case in the 14-video audited sample — no
        # sibling alternative exists to OR with), this degenerates to a single-member "group" that
        # is mathematically a no-op on conjunction depth for THAT condition — an honest, real
        # limitation of the current audit sample, not a bug, and not synthetically patched with a
        # fabricated always-true filler (see module-level design note in
        # docs/designs/hard-constraint-demotion-experiment-2026-07-05.md).
        self._demotion_alternative_ids: frozenset[str] = frozenset(
            cid for cid, cls in self._demotion_classifications.items() if cls == "ALTERNATIVE"
        )
        self._demotion_or_active: bool = self.role_demotion_mode in ("struct_alt", "struct_all") and bool(
            self._demotion_alternative_ids
        )
        self._demotion_or_branch_of_condition: dict[str, int] = {}
        if self._demotion_or_active:
            for cid in self._demotion_alternative_ids:
                self._demotion_or_branch_of_condition[cid] = 0  # single per-strategy group

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
        # Population-A Level Resolver introspection surface (populated per-compute() call;
        # empty until compute() runs, and reset every call — never carries stale state
        # across instances/calls, same discipline as last_per_condition_bool/last_trace).
        self.last_population_a_level: dict[str, np.ndarray] = {}
        # ── WIRE-1 DEAD-LOAD ACTIVATION (R-069 §3, flag-gated) ───────────────
        # backtester's W25.4 block only loads 4h/1h when the strategy DECLARES
        # htf_tf/itf_tf. No strategy repo-wide declares them, so that path is DEAD
        # and `_four_h_data`/`_one_h_data` are always None — meaning the structure
        # wire would read a frame that is never loaded. Declaring them here
        # ACTIVATES a dead path (additive-fix-activates-dead-path class), so it is
        # gated on the same WIRE-1 flag as the columns: default OFF => the loader
        # sees no declaration and behavior is byte-identical to pre-wire.
        if os.getenv("TF_WIRE1_HTF_COLUMNS", "").strip().lower() in ("1", "true", "yes"):
            self.htf_tf: str = "4h"
            self.itf_tf: str = "1h"
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

        # ── WIRE-1 WIRED PATH: the REAL-HTF structure column, materialized upstream
        # as a STEP FUNCTION advancing per COMPLETED HTF bar (R-067 §3 two
        # granularities). On bars where it is present this binding is NOT an
        # approximation: `compute_structure_state` was fed a genuine higher-timeframe
        # frame instead of the self-referential exec window. Bars without a value fall
        # back to the proxy below and stay approximation=True — honest per-bar
        # provenance, never a blanket relabel.
        if "htf_structure_active" in df.columns:
            col = df["htf_structure_active"].to_list()
            wired = 0
            for i in range(min(n, len(col))):
                if col[i] is None:
                    continue
                out[i] = bool(col[i])
                wired += 1
            self._wire1_structure_bars = wired
            if wired == min(n, len(col)) and wired > 0:
                return out  # fully wired — the proxy is not consulted at all

        if n < MIN_BARS_REQUIRED:
            return out
        wired_col = df["htf_structure_active"].to_list() if "htf_structure_active" in df.columns else None
        last_result = False
        for i in range(n):
            if wired_col is not None and i < len(wired_col) and wired_col[i] is not None:
                continue  # already decided by the REAL-HTF signal
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

    def _eval_wait_bias(
        self,
        close: np.ndarray,
        n: int,
        want_bearish: bool = False,
        htf_trend: list | None = None,
    ) -> np.ndarray:
        """Directional bias.

        WIRE-1 (R-066): when the REAL HTF trend column is materialized on the frame
        (`htf_daily_trend`, SMA 20/50/200 alignment on strictly-prior daily bars),
        this binding reads the INSTITUTIONAL signal per bar and is NOT an
        approximation on those bars. Where the column is absent/null (pre-warmup,
        data gap, or wire flag off) it falls back to the historical EMA-slope PROXY
        and remains approximation=True for those bars — honest per-bar provenance,
        never a blanket relabel.

        Why this moves the 0.99: the EMA proxy always picks a side, so it gates
        almost nothing (a binding that cannot FAIL is the detector-can-lie disease
        in evaluator form — R-065's doctrine applied to bindings). The real signal
        can report "neutral", which genuinely REFUSES the condition on those bars.

        PROXY (fallback) semantics unchanged: fast/slow EMA slope sign. The full
        bias_engine.classify_institutional_regime remains out of scope here.
        """
        out = np.zeros(n, dtype=bool)

        # ── WIRED PATH: real HTF trend per bar (approximation=False on these bars)
        wired_bars = 0
        if htf_trend is not None:
            want = "bearish" if want_bearish else "bullish"
            for i in range(min(n, len(htf_trend))):
                t = htf_trend[i]
                if t is None:
                    continue
                wired_bars += 1
                out[i] = (t == want)          # "neutral" => False: a real refusal
            self._wire1_bias_bars = wired_bars
            if wired_bars == min(n, len(htf_trend)) and wired_bars > 0:
                return out                     # fully wired — no proxy needed

        # ── PROXY FALLBACK (unwired bars only; approximation=True)
        if n < BIAS_EMA_SLOW + 2:
            return out
        s = pl.Series(close)
        fast = compute_ema(s, BIAS_EMA_FAST).to_numpy()
        slow = compute_ema(s, BIAS_EMA_SLOW).to_numpy()
        for i in range(n):
            if htf_trend is not None and i < len(htf_trend) and htf_trend[i] is not None:
                continue                       # already decided by the real signal
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

    @staticmethod
    def _select_directional_arrays(bullish: np.ndarray, bearish: np.ndarray, object_text: str) -> np.ndarray:
        """BUG FIX 2 (docs/designs/or-branches-honoring-fix-2026-07-05.md): the legacy
        WAIT_CONFIRMATION path (`candle_confirmation_check`, predates the confirmation_native.py
        Result dataclass) OR-blended `bullish_confirm | bearish_confirm` unconditionally — a
        short-side confirmation condition was satisfied by a BULLISH rejection candle just as
        readily as a bearish one, discarding direction entirely. This selects directionally the
        SAME way `_select_directional` already does for the native-bundle Result objects (object
        text keyword match, no spec.direction fallback — mirrors confirmation_native.py's own
        bullish_active/bearish_active split): a condition whose object names a direction binds to
        the matching raw array; a condition that names no direction falls back to the OR (any
        confirmation candle, either direction) — the same honest fallback `_select_directional`
        uses for `any_active`."""
        norm = f" {(object_text or '').strip().lower()} "
        if any(kw in norm for kw in BUNDLE_BEARISH_KEYWORDS):
            return bearish
        if any(kw in norm for kw in BUNDLE_BULLISH_KEYWORDS):
            return bullish
        return bullish | bearish

    def _resolve_wait_bias_bearish(self, object_text: str) -> bool:
        """BUG FIX 1 (docs/designs/or-branches-honoring-fix-2026-07-05.md): `_eval_wait_bias` used
        to be called with `want_bearish=False` hard-coded at every call site — every WAIT_BIAS /
        CONFIRM_DIRECTION condition was treated bullish regardless of what its object actually
        named (a condition whose object literally says "bearish bias" still got the bullish-lean
        EMA check). Resolves want_bearish the same way bias_native.py's directional split would:
        object-text keyword first (same BUNDLE_BEARISH/BULLISH_KEYWORDS convention as
        `_select_directional`) — falling back to the strategy's spec-level `direction` field only
        when the object names no direction of its own (short -> bearish; long/both -> bullish-lean,
        matching the pre-fix default for the common long/both case while correcting the short
        case, which was silently wrong 100% of the time before this fix)."""
        norm = f" {(object_text or '').strip().lower()} "
        if any(kw in norm for kw in BUNDLE_BEARISH_KEYWORDS):
            return True
        if any(kw in norm for kw in BUNDLE_BULLISH_KEYWORDS):
            return False
        return str(self.spec.get("direction", "long")) == "short"

    def _effective_or_branch_map(self) -> dict[str, int]:
        """Union of the two INDEPENDENT OR-grouping mechanisms this class supports, each gated by
        its own flag so the two experiments never silently interact:
          - `_or_branch_of_condition` (OR-Branches Honoring Fix, TF_OR_BRANCHES_ENABLED) — the
            spec's OWN `or_branches` groups, as extracted.
          - `_demotion_or_branch_of_condition` (Hard-Constraint Demotion Experiment, struct_alt /
            struct_all under TF_ROLE_DEMOTION_MODE) — ALTERNATIVE-classified conditions of THIS
            strategy, grouped together.
        Demotion group indices are offset into a disjoint namespace (`_DEMOTION_GROUP_OFFSET`) so
        they can never collide with the spec's own 0-based or_branches indices even when both
        mechanisms are (independently) active in the same process. `setdefault` on the demotion
        side mirrors the same "first assignment wins, never crash on overlap" defensiveness as the
        or_branches map's own construction — a condition_id that is BOTH a native or_branch member
        AND demotion-classified ALTERNATIVE keeps its native (or_branches_enabled) group when that
        mechanism is active, since it is checked first below."""
        merged: dict[str, int] = {}
        if or_branches_enabled():
            merged.update(self._or_branch_of_condition)
        if self._demotion_or_active:
            for cid, idx in self._demotion_or_branch_of_condition.items():
                merged.setdefault(cid, _DEMOTION_GROUP_OFFSET + idx)
        return merged

    def _combine_spine_or_branches(self, per_condition_bool: dict[str, np.ndarray], n: int, or_map: dict[str, int]) -> np.ndarray:
        """OR-Branches Honoring Fix (docs/designs/or-branches-honoring-fix-2026-07-05.md) +
        Hard-Constraint Demotion Experiment struct_alt/struct_all (docs/designs/hard-constraint-
        demotion-experiment-2026-07-05.md): generalized to accept ANY condition_id->group-index
        map (see `_effective_or_branch_map()`), not just the spec's own or_branches. Spine
        conditions that are members of the SAME group combine via ANY-holds (logical OR); each
        group's single OR-result then enters the spine conjunction as ONE term — exactly where an
        individual AND'd condition would have sat — replacing the previous per-alternative AND that
        silently required every alternative to hold simultaneously (the confirmed 726-groups/
        576-spine-alternatives/93-strategies over-conjunction defect). Conditions with no group
        membership are completely unaffected (still individually ANDed, same as neither-flag-on)
        — this is what makes nested and_groups-containing-or_branches correct "per the extracted
        structure" without any special-case code: an and_group's members that also belong to a
        group are folded into that group's OR term before the final AND runs, and every other
        and_group member (no group membership) is ANDed exactly as before."""
        branch_results: dict[int, np.ndarray] = {}
        standalone_ids: list[str] = []
        for cid, arr in per_condition_bool.items():
            branch_idx = or_map.get(cid)
            if branch_idx is None:
                standalone_ids.append(cid)
                continue
            if branch_idx in branch_results:
                branch_results[branch_idx] = branch_results[branch_idx] | arr
            else:
                branch_results[branch_idx] = arr.copy()

        spine_satisfied = np.ones(n, dtype=bool)
        for cid in standalone_ids:
            spine_satisfied &= per_condition_bool[cid]
        for arr in branch_results.values():
            spine_satisfied &= arr
        return spine_satisfied

    def _apply_exec_all_masking(self, per_condition_bool: dict[str, np.ndarray], n: int) -> dict[str, np.ndarray]:
        """Hard-Constraint Demotion Experiment, exec_all arm (docs/designs/hard-constraint-
        demotion-experiment-2026-07-05.md Section 2, EXECUTION masking `D_exec`): produces the SAME
        net per-bar masking effect as struct_all (OPTIONAL/CONTEXTUAL -> vacuously-true; ALTERNATIVE
        -> ANY-holds across this strategy's OTHER ALTERNATIVE-classified conditions), applied
        directly to the already-computed per-condition boolean arrays — WITHOUT touching
        binding_plan.role/executed or any or_branch/group topology (spine_total/spine_bound/
        conjunction_depth() are therefore IDENTICAL to baseline for this arm, by design — see
        conjunction_depth()'s docstring). This validates that struct_all's result isn't merely a
        topology artifact of the role/executed rewrite; it is never the primary decision (spec
        Section 6 applies the pre-registered decision to struct_all, not exec_all)."""
        if not self._demotion_classifications:
            return per_condition_bool
        out = dict(per_condition_bool)
        alt_arrays = [out[cid] for cid in self._demotion_alternative_ids if cid in out]
        alt_any: np.ndarray | None = None
        if alt_arrays:
            alt_any = alt_arrays[0].copy()
            for arr in alt_arrays[1:]:
                alt_any |= arr
        for cid in list(out.keys()):
            cls = self._demotion_classifications.get(cid)
            if cls in ("OPTIONAL", "CONTEXTUAL"):
                out[cid] = np.ones(n, dtype=bool)
            elif cls == "ALTERNATIVE" and alt_any is not None:
                out[cid] = alt_any
        return out

    def conjunction_depth(self) -> int:
        """The DAG mediator the Hard-Constraint Demotion Experiment measures per arm (docs/designs/
        hard-constraint-demotion-experiment-2026-07-05.md Section 4): the number of distinct
        AND-connected terms in the EXECUTED spine, after OR-merging. A structural arm (struct_conf/
        struct_alt/struct_ctx/struct_all) MUST drop this materially relative to "off" for the same
        strategy or the intervention did not fire for that strategy — INVALID, not a null result
        (spec Section 6 + Section 8). `exec_all` and "off" ALWAYS report the identical depth for
        the same spec — exec_all is execution-masking only and never touches binding_plan.role/
        executed or or_branch/group membership (see _apply_exec_all_masking's docstring); this is
        expected and by design, not a measurement bug."""
        executed_spine_ids = [b.condition_id for b in self.binding_plan.bindings if b.role == "spine" and b.executed]
        or_map = self._effective_or_branch_map()
        seen_groups: set[int] = set()
        depth = 0
        for cid in executed_spine_ids:
            grp = or_map.get(cid)
            if grp is None:
                depth += 1
            elif grp not in seen_groups:
                seen_groups.add(grp)
                depth += 1
        return depth

    def _eval_wait_retest(self, close: np.ndarray, high: np.ndarray, low: np.ndarray, n: int) -> np.ndarray:
        if n < RETEST_LEVEL_EMA_PERIOD + 2:
            return np.zeros(n, dtype=bool)
        level = compute_ema(pl.Series(close), RETEST_LEVEL_EMA_PERIOD).to_numpy()
        df_atr = pl.DataFrame({"high": high, "low": low, "close": close})
        atr = compute_atr(df_atr, ATR_PERIOD).to_numpy()
        return retest_touch_check(close, high, low, level, atr)

    def _eval_wait_structure_levelzone(
        self, close: np.ndarray, high: np.ndarray, low: np.ndarray, n: int
    ) -> np.ndarray:
        """Level/Zone Routing Sub-Wire (docs/designs/packet-levelzone-subwire-2026-07-20.md):
        evaluate a level/zone-classified WAIT_STRUCTURE/VERIFY_STRUCTURE condition via the
        level-aware retest_touch_check primitive instead of the shared, level-blind
        structure_engine.compute_structure_state signal every other WAIT_STRUCTURE/
        VERIFY_STRUCTURE condition still uses (_eval_wait_structure above).

        Level-series resolution is IDENTICAL to _eval_wait_retest's EMA proxy — this sub-wire
        reuses the SAME already-audited level-resolution convention WAIT_RETEST conditions use,
        not a fresh per-condition numeric-level extraction (out of scope per packet §3: "the
        exact change, scope-locked" names routing to retest_touch_check "with a resolved level
        series," not per-condition level parsing). A dedicated method (rather than calling
        _eval_wait_retest directly) keeps the two families' call sites and trace provenance
        distinct even though the underlying computation is presently identical, and gives this
        sub-wire a single seam to later swap in a per-condition level resolver without touching
        WAIT_RETEST's own behavior."""
        return self._eval_wait_retest(close, high, low, n)

    def _eval_population_a_level(
        self,
        kind: str,
        object_text: str,
        df: pl.DataFrame,
        n: int,
        swings_cache: dict[str, pl.DataFrame],
    ) -> np.ndarray:
        """Population-A Level Resolver (docs/designs/packet-levelzone-population-a-resolver-
        2026-07-20.md) — resolves `kind` (spec_family_bindings.classify_population_a_kind's
        output for this condition's OWN object text) to a per-bar level series built from a
        detector the repo already owns, instead of the shared EMA(20) proxy every other
        level/zone condition still uses. This is what makes two Population-A conditions
        naming DIFFERENT levels produce DIFFERENT series (packet R2) — the exact property
        the prior sub-wire lacked.

        Cadence: every-bar, identical to _eval_wait_retest / _eval_wait_structure_levelzone
        — this resolver changes ONLY the `level` argument fed to retest_touch_check, never
        its evaluation cadence, so it introduces no new cadence axis to confound with the
        signal-source axis (cadence_isolation_harness.py's discipline: the two axes are
        never combined here because only one of them ever varies in this delivery).

        APPROXIMATION: this method itself never sets `approximation` — that flag lives on
        the ConditionBinding the caller (spec_family_bindings.bind_condition) already
        produced before this method runs. As of docs/designs/packet-population-a-flip-
        step-2026-07-20.md, and ONLY when BOTH TF_LEVELZONE_ROUTING_ENABLED and
        TF_LEVELZONE_RESOLVER_ENABLED are "true" (both default OFF; with either flag off
        the resolver dispatch branch is unreachable and every level/zone binding keeps
        meta.base_approximation=True), named_sr_level and order_block_edge bindings carry
        approximation=False (each independently earned a de-approximation grade — see
        POPULATION_A_DEAPPROXIMATED_KINDS in spec_family_bindings.py for citations); swing
        still carries approximation=True (n=1, below the campaign's n>=2 de-approximation
        floor). This method's own level-resolution LOGIC below is unchanged by that flip —
        the flip moved only the fidelity LABEL attached to two of the three kinds, not one
        line of the resolution below.

        What this method returns is NOT always a populated level series, and the flip did
        not change that either: the order_block_edge branch returns an ALL-NaN array when
        the OB detectors find nothing (see `if len(obs) == 0` below), as does the
        unreachable-kind fallback at the end. NaN entries mean "no level knowable at this
        bar" and are handled downstream by retest_touch_check, not silently treated as a
        resolved level.
        """
        if "swings" not in swings_cache:
            swings_cache["swings"] = detect_swings(df, POPULATION_A_SWING_LOOKBACK)
        swings = swings_cache["swings"]
        bullish = population_a_bullish_leaning(kind, object_text)

        if kind == "swing":
            stype = "low" if bullish else "high"
            sub = swings.filter(pl.col("type") == stype).sort("index")
            return _ffill_level_series(sub["index"].to_list(), sub["price"].to_list(), n)

        if kind == "named_sr_level":
            # support (bullish) -> sell-side liquidity: clusters of swing LOWS, i.e. the
            # level price is expected to find support AT. resistance (bearish) -> buy-side
            # liquidity: clusters of swing HIGHS, i.e. the level price is expected to meet
            # resistance AT. See indicators/liquidity.py module docstring for the BSL/SSL
            # convention this reuses unmodified.
            levels = detect_sellside_liquidity(df, swings) if bullish else detect_buyside_liquidity(df, swings)
            idxs = levels["index"].to_list() if len(levels) > 0 else []
            prices = levels["price"].to_list() if len(levels) > 0 else []
            return _ffill_level_series(idxs, prices, n)

        if kind == "order_block_edge":
            # demand (bullish) -> bullish OB (order_flow.detect_bullish_ob): price is
            # expected to retrace DOWN into the zone and find demand, so the first-contact
            # edge on the way down is the zone's TOP. supply (bearish) -> bearish OB
            # (detect_bearish_ob): price retraces UP into the zone, first-contact edge is
            # the zone's BOTTOM. lookback=0: swings passed in are ALREADY the confirmed
            # (causally-safe, half-window-offset) indices detect_swings returns, so the
            # kernel's backward scan is anchored at a real, already-knowable bar — see
            # POPULATION_A_OB_VISIBILITY_MARGIN_BARS docstring for why the returned OB
            # candle index still needs a visibility margin on top of that.
            if bullish:
                obs = detect_bullish_ob(df, swings, lookback=0)
                edge_col = "top"
            else:
                obs = detect_bearish_ob(df, swings, lookback=0)
                edge_col = "bottom"
            if len(obs) == 0:
                return np.full(n, np.nan, dtype=np.float64)
            visible_idx = [int(i) + POPULATION_A_OB_VISIBILITY_MARGIN_BARS for i in obs["index"].to_list()]
            prices = obs[edge_col].to_list()
            return _ffill_level_series(visible_idx, prices, n)

        # Unreachable given the dispatch loop only calls this for a kind
        # classify_population_a_kind actually returned — kept as an honest fallback
        # rather than a silent guess if a future kind is added to the classifier without
        # a matching branch here.
        return np.full(n, np.nan, dtype=np.float64)

    # ─── Core compute ───────────────────────────────────────────────────────
    def compute(self, df: pl.DataFrame) -> pl.DataFrame:
        n = len(df)
        false_col = pl.lit(False)
        if n < MIN_BARS_REQUIRED:
            self.last_trace = []
            self.last_per_condition_bool = {}
            self.last_population_a_level = {}
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
        # BUG FIX 1 cache: want_bearish is now resolved PER-BINDING (object text + spec.direction
        # fallback, see _resolve_wait_bias_bearish) rather than hard-coded False — different
        # WAIT_BIAS/CONFIRM_DIRECTION bindings on the same spec can therefore legitimately need
        # different directions, so this caches the EMA-slope proxy array per want_bearish value
        # (at most 2 entries: True and False) instead of the single `wait_bias_bull` variable the
        # pre-fix code relied on.
        # WIRE-1 seam: the REAL HTF trend column, materialized upstream of compute()
        # by backtester.run_class_backtest from the prior-completed-period cache
        # (R-066 §2 causality). Absent => every bias bar falls back to the proxy and
        # behavior is byte-identical to pre-wire.
        _htf_trend = (
            df["htf_daily_trend"].to_list() if "htf_daily_trend" in df.columns else None
        )
        wait_bias_cache: dict[bool, np.ndarray] = {}
        wait_structure = None
        wait_structure_levelzone = None
        wait_retest = None
        fvg_signal = None
        # Population-A Level Resolver caches — level_cache keyed by (kind, bullish) so
        # conditions that resolve to the SAME kind+polarity share one computed series
        # (mirrors wait_structure_levelzone's single-shared-array caching), while
        # different (kind, bullish) pairs — and therefore different Population-A
        # conditions naming different levels — get DISTINCT arrays (packet R2).
        # swings_cache and atr are computed at most once per compute() call regardless
        # of how many Population-A conditions this spec has.
        population_a_level_cache: dict[tuple[str, bool], np.ndarray] = {}
        population_a_swings_cache: dict[str, pl.DataFrame] = {}
        population_a_atr: np.ndarray | None = None
        # Per-condition-id level series, exposed for introspection (proves R1/R2: the
        # production path's own object text drives a DIFFERENT array per condition_id,
        # not just a shared per-kind array). Reset every compute() call — replay-
        # deterministic, never carries state across instances or calls.
        self.last_population_a_level: dict[str, np.ndarray] = {}
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
            elif b.primitive == LEVELZONE_PRIMITIVE_NAME:
                # Level/Zone Routing Sub-Wire — checked BEFORE the generic WAIT_STRUCTURE/
                # VERIFY_STRUCTURE type dispatch below, same placement discipline as the FVG check
                # above, so a level/zone-routed binding never falls through to the shared generic
                # structure-activity array.
                if wait_structure_levelzone is None:
                    wait_structure_levelzone = self._eval_wait_structure_levelzone(close, high, low, n)
                per_condition_bool[b.condition_id] = wait_structure_levelzone
            elif b.primitive == LEVELZONE_RESOLVER_PRIMITIVE_NAME:
                # Population-A Level Resolver — checked alongside the sub-wire's own
                # LEVELZONE_PRIMITIVE_NAME branch above (a condition binds to exactly ONE
                # of the two, decided in spec_family_bindings.py; never both). Resolves
                # THIS condition's own object text to a kind, computes (or reuses a
                # cached) per-(kind, polarity) level series, and evaluates the SAME
                # retest_touch_check primitive the EMA-proxy path uses — only the `level`
                # argument differs, so cadence is unchanged (R4: no combined axis).
                kind = classify_population_a_kind(b.object)
                bullish = population_a_bullish_leaning(kind, b.object) if kind else True
                cache_key = (kind, bullish)
                if cache_key not in population_a_level_cache:
                    population_a_level_cache[cache_key] = self._eval_population_a_level(
                        kind, b.object, df, n, population_a_swings_cache
                    )
                level = population_a_level_cache[cache_key]
                self.last_population_a_level[b.condition_id] = level
                if population_a_atr is None:
                    df_atr = pl.DataFrame({"high": high, "low": low, "close": close})
                    population_a_atr = compute_atr(df_atr, ATR_PERIOD).to_numpy()
                per_condition_bool[b.condition_id] = retest_touch_check(close, high, low, level, population_a_atr)
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
                want_bearish = self._resolve_wait_bias_bearish(b.object)
                if want_bearish not in wait_bias_cache:
                    wait_bias_cache[want_bearish] = self._eval_wait_bias(close, n, want_bearish=want_bearish, htf_trend=_htf_trend)
                per_condition_bool[b.condition_id] = wait_bias_cache[want_bearish]
            elif b.type == "WAIT_RETEST":
                if wait_retest is None:
                    wait_retest = self._eval_wait_retest(close, high, low, n)
                per_condition_bool[b.condition_id] = wait_retest
            elif b.type == "WAIT_CONFIRMATION":
                per_condition_bool[b.condition_id] = self._select_directional_arrays(bullish_confirm, bearish_confirm, b.object)
            elif b.type == "FILTER":
                # Static presence-only pass-through — see module docstring
                # ("no standalone per-bar confluence primitive exists").
                per_condition_bool[b.condition_id] = np.ones(n, dtype=bool)
            else:
                per_condition_bool[b.condition_id] = np.ones(n, dtype=bool)

        # Hard-Constraint Demotion Experiment, exec_all arm ONLY (docs/designs/hard-constraint-
        # demotion-experiment-2026-07-05.md Section 2): mask the per-bar arrays post-hoc, WITHOUT
        # touching binding_plan.role/executed or any or_branch/group topology (see
        # _apply_exec_all_masking's docstring). No-op for every other mode, including "off".
        if self.role_demotion_mode == "exec_all":
            per_condition_bool = self._apply_exec_all_masking(per_condition_bool, n)

        self.last_per_condition_bool = per_condition_bool

        if per_condition_bool:
            # OR-Branches Honoring Fix + Hard-Constraint Demotion Experiment struct_alt/struct_all:
            # both flag-gated, both byte-identical OFF (default). _effective_or_branch_map() is
            # empty unless at least one of the two independent flags is active AND has a non-empty
            # group map for THIS spec — in which case it falls straight to the strict-AND branch
            # below, same as neither-flag-on.
            or_map = self._effective_or_branch_map()
            if or_map:
                spine_satisfied = self._combine_spine_or_branches(per_condition_bool, n, or_map)
            else:
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
        else:  # "both" — direct via EMA-slope proxy (bullish lean) at the firing bar
            if False not in wait_bias_cache:
                wait_bias_cache[False] = self._eval_wait_bias(close, n, want_bearish=False, htf_trend=_htf_trend)
            wait_bias_bull = wait_bias_cache[False]
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
