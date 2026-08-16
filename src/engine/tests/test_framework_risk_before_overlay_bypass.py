"""AR-1210 LANE A + C — framework risk must run BEFORE the optional overlay bypass.

The defect (measured in AR-1209, confirmed in AR-1210 §3): `evaluate_signal` returns
`TAKE` for an unregistered strategy BEFORE it checks `stop_plan.skip_trade`, so the
structural-stop ceiling refusal never runs for exactly the class of strategy this campaign
produces — a newly certified one, which is unregistered by construction.

The boundary being pinned here, verbatim from AR-1210 §4:

    NEW/UNREGISTERED may bypass PLAYBOOK/CONFLUENCE OVERLAY policy, but NEW/UNREGISTERED
    may NEVER bypass FRAMEWORK RISK / REFUSAL policy.

These tests must keep BOTH halves true. Deleting the bypass would "fix" the safety hole and
re-introduce the promotion-breaking backtest/paper divergence the bypass exists to prevent,
so every safety assertion below is paired with a passthrough-preserved assertion.

One fixture uses the real emitted sVkm strategy name. That name appears ONLY in tests —
AR-1210 §7 forbids any source-specific name in production logic.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

from test_skip_trade_propagation import (  # noqa: E402
    _make_bias_state,
    _make_location,
    _make_playbook,
    _make_session,
    _make_stop_plan,
    _make_target_plan,
)

from src.engine.context.eligibility_gate import evaluate_signal  # noqa: E402
from src.engine.context.playbook_router import ALL_STRATS  # noqa: E402

# The name the production extractor itself emitted for sVkm (AR-1137). Test-only.
SVKM_NAME = "fvg_breakout_range_1m_5m"
REGISTERED = "breaker"          # in ALL_STRATS and in the playbook's allowed list


def _is_registered(name: str) -> bool:
    norm = name.lower().replace("strategy", "").strip().replace("_", "")
    return norm in [s.lower().replace("_", "") for s in ALL_STRATS]


def _decide(name: str, skip: bool):
    stop_plan = _make_stop_plan(skip=skip)
    decision = evaluate_signal(
        signal={"direction": "long", "strategy_name": name, "entry_price": 4500.0},
        bias_state=_make_bias_state(), playbook=_make_playbook(),
        location=_make_location(), stop_plan=stop_plan,
        target_plan=_make_target_plan(), session=_make_session(),
    )
    return decision, stop_plan


# --------------------------------------------------------------------------- #
# Premise
# --------------------------------------------------------------------------- #


def test_the_svkm_name_really_is_unregistered():
    """Positive control on the premise: if this name were registered, every test below
    would be exercising the wrong path and proving nothing."""
    assert not _is_registered(SVKM_NAME)
    assert _is_registered(REGISTERED)


# --------------------------------------------------------------------------- #
# SAFETY HALF — framework refusal may never be bypassed
# --------------------------------------------------------------------------- #


def test_unregistered_strategy_with_oversized_stop_is_refused():
    """🛑 THE DEFECT. An unregistered strategy whose structural stop breached its symbol
    ceiling must still end in SKIP. Before the repair this returned TAKE."""
    decision, stop_plan = _decide(SVKM_NAME, skip=True)
    assert decision.action == "SKIP", (
        f"framework stop refusal was bypassed for unregistered strategy: {decision.action}"
    )
    assert stop_plan.stop_price == 4486.0, "stop price must not be clamped or substituted"


def test_registered_strategy_with_oversized_stop_is_still_refused():
    """The control that was already green — it must stay green."""
    decision, _ = _decide(REGISTERED, skip=True)
    assert decision.action == "SKIP"


def test_the_refusal_reason_names_the_stop_ceiling_not_the_bypass():
    """A SKIP for the right reason. If the reasoning still says 'unregistered ... bypassed'
    then the signal was refused by accident rather than by the framework gate."""
    decision, _ = _decide(SVKM_NAME, skip=True)
    joined = " ".join(decision.reasoning).lower()
    assert "ceiling" in joined or "stop" in joined, decision.reasoning


# --------------------------------------------------------------------------- #
# PASSTHROUGH HALF — the bypass must still exist for its intended purpose
# --------------------------------------------------------------------------- #


def test_unregistered_strategy_with_a_safe_stop_still_bypasses_the_overlay():
    """🛑 THE OTHER HALF. The bypass exists so a new strategy is not killed merely for
    being absent from a playbook list (backtest/paper parity, ds21). With a SAFE stop the
    unregistered strategy must still pass through."""
    decision, _ = _decide(SVKM_NAME, skip=False)
    assert decision.action == "TAKE", (
        f"the unregistered overlay bypass was lost: {decision.action} — this would "
        "re-introduce the promotion-breaking backtest/paper divergence"
    )
    assert any("unregistered" in r.lower() or "bypass" in r.lower() for r in decision.reasoning)


def test_registered_strategy_with_a_safe_stop_is_unaffected():
    decision, _ = _decide(REGISTERED, skip=False)
    assert decision.action in ("TAKE", "REDUCE")
    assert not any("unregistered" in r.lower() for r in decision.reasoning)


# --------------------------------------------------------------------------- #
# LANE C — the parity matrix, asserted as one table
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    "name,skip,expected",
    [
        (REGISTERED, True, "SKIP"),    # registered + oversized  -> refused
        (SVKM_NAME, True, "SKIP"),     # unregistered + oversized -> refused (the repair)
        (SVKM_NAME, False, "TAKE"),    # unregistered + safe      -> bypass preserved
    ],
)
def test_framework_risk_parity_matrix(name, skip, expected):
    decision, stop_plan = _decide(name, skip)
    assert decision.action == expected, (
        f"{name!r} skip_trade={skip}: expected {expected}, got {decision.action}"
    )
    # skip-not-clamp holds in every cell
    assert stop_plan.stop_price == 4486.0


# --------------------------------------------------------------------------- #
# BACKTEST WITNESS — AR-1210 §5 LANE A / §7: fixing only paper/live is forbidden
# --------------------------------------------------------------------------- #


def _backtest_gate(monkeypatch, strategy_name: str, force_skip: bool):
    """Run the backtest-side gate with the structural stop forced to refuse.

    Forcing at `compute_structural_stop` is the point: before the repair the unregistered
    branch RETURNED before the per-signal loop, so the stop was never computed at all and
    no refusal could exist. If the signal is dropped now, the loop demonstrably ran and the
    refusal demonstrably applied.
    """
    import numpy as np
    import polars as pl

    from src.engine import backtester as bt
    from src.engine.context import structural_stops as ss

    real = ss.compute_structural_stop

    def _forced(*args, **kwargs):
        plan = real(*args, **kwargs)
        if not force_skip:
            return plan
        return ss.StopPlan(
            stop_price=plan.stop_price, stop_reason="fvg_exceeds_ceiling_TEST",
            buffer=plan.buffer, risk_dollars=plan.risk_dollars,
            session_adjustment=plan.session_adjustment, buffer_ticks=plan.buffer_ticks,
            sweep_aware_buffer=plan.sweep_aware_buffer, skip_trade=True,
        )

    monkeypatch.setattr(ss, "compute_structural_stop", _forced)
    monkeypatch.delenv("TF_CONFLUENCE_OVERLAY_DISABLED", raising=False)

    n = 50
    df = pl.DataFrame({"close": np.linspace(5000, 5010, n), "ts_event": [None] * n})
    entries = np.zeros(n, dtype=bool)
    entries[10] = True
    exits = np.zeros(n, dtype=bool)
    return bt.apply_eligibility_gate(
        entries, exits, df, "long", "MES",
        htf_cache={"2026-01-05": object()}, strategy_name=strategy_name,
    )


def test_backtest_unregistered_still_reports_the_passthrough_mode(monkeypatch):
    """Provenance: an operator must still be able to tell an overlay-bypassed run from a
    fully evaluated one.

    AR-1212 §6 CORRECTION: this test used to assert
    `stats["framework_risk_enforced"] is True`. That boolean was stamped before any
    per-signal work, so it read True on bars that were never checked — a false green I
    shipped and GPT caught. It is gone; the honest counters replace it, and they must be
    PRESENT (so coverage is always reportable) without claiming anything they did not
    measure.
    """
    _, _, stats = _backtest_gate(monkeypatch, SVKM_NAME, force_skip=False)
    assert stats["mode"] == "passthrough_strategy_unregistered"
    assert "framework_risk_checked" in stats
    assert "framework_risk_refused" in stats
    assert "framework_risk_enforced" not in stats, "the false-green boolean is back"


def test_backtest_no_longer_returns_before_the_structural_stop_loop():
    """STRUCTURAL: the unregistered branch must not short-circuit the gate any more.

    Asserted on the source so the ordering cannot silently regress to an early return
    that no behavioural test happens to cover.
    """
    import inspect

    from src.engine import backtester as bt

    src = inspect.getsource(bt.apply_eligibility_gate)
    marker = 'gate_stats["mode"] = "passthrough_strategy_unregistered"'
    assert marker in src
    tail = src.split(marker, 1)[1]
    # the next 12 lines after the mode stamp must not contain the early return
    following = "\n".join(tail.splitlines()[:12])
    assert "return entry_signals, exit_signals, gate_stats" not in following, (
        "the unregistered branch still returns before structural stops are computed — "
        "framework risk cannot run in the backtest path"
    )


def test_one_canonical_refusal_predicate_not_two():
    """§5 LANE B: 'Do not duplicate business rules into two independently drifting
    implementations.' There must be exactly one definition of the refusal."""
    # Filesystem scan, NOT `git grep`: git grep skips untracked files, so it reported
    # zero definitions for a module that plainly exists. Fewest layers between the
    # assertion and the thing it is about.
    root = Path(__file__).resolve().parents[3] / "src"
    hits = [
        f"{p}:{i}"
        for p in root.rglob("*.py")
        if "__pycache__" not in str(p)
        for i, line in enumerate(p.read_text(encoding="utf-8", errors="replace").splitlines(), 1)
        if line.startswith("def evaluate_framework_risk")
    ]
    assert len(hits) == 1, f"expected exactly one definition, found: {hits}"

    # positive control: the scanner can find a symbol we know exists
    control = [
        p.name for p in root.rglob("*.py")
        if "__pycache__" not in str(p)
        and any(l.startswith("def evaluate_signal") for l in
                p.read_text(encoding="utf-8", errors="replace").splitlines())
    ]
    assert control, "scanner found nothing at all — it is broken, not the code"


# --------------------------------------------------------------------------- #
# AR-1212 §5 — REDS FOR THE BACKTEST GAP THAT IS **NOT** FIXED
#
# GPT rejected AR-1211's "repaired in BOTH engines" claim and was right. In the
# backtester the structural stop is computed only AFTER the overlay-disabled early
# return, the no-HTF early return, the per-bar HTF `continue`, session context, bias,
# playbook routing and location score. Any of those can keep a signal before framework
# risk is ever evaluable.
#
# These are xfail(strict=True) on purpose: the defect is REAL and NOT FIXED. strict
# means that the moment the architecture is repaired these turn RED and demand the
# marker be removed, so they cannot rot into silent acceptance.
# --------------------------------------------------------------------------- #

import datetime as _dt  # noqa: E402
from types import SimpleNamespace  # noqa: E402


def _htf_stub():
    return SimpleNamespace(
        prev_day_high=5020.0, prev_day_low=4980.0, prev_day_close=5000.0,
        daily_bias="BULLISH", h4_bias="BULLISH", h1_bias="BULLISH",
        asia_high=5015.0, asia_low=4985.0, london_high=5012.0, london_low=4988.0,
        weekly_open=5000.0, daily_open=5000.0, premium_discount="EQ",
        h4_fvg=None, h1_fvg=None, daily_high=5020.0, daily_low=4980.0,
    )


def _forced_refusal_gate(monkeypatch, *, with_ts: bool, htf_obj, clear_overlay_env: bool = True):
    """Run the backtest gate with compute_structural_stop forced to refuse, counting
    whether it was called at all."""
    import numpy as np
    import polars as pl

    from src.engine import backtester as bt
    from src.engine.context import structural_stops as ss

    calls = {"n": 0}
    real = ss.compute_structural_stop

    def _forced(*a, **k):
        calls["n"] += 1
        p = real(*a, **k)
        return ss.StopPlan(
            stop_price=p.stop_price, stop_reason="fvg_exceeds_ceiling_TEST",
            buffer=p.buffer, risk_dollars=p.risk_dollars,
            session_adjustment=p.session_adjustment, buffer_ticks=p.buffer_ticks,
            sweep_aware_buffer=p.sweep_aware_buffer, skip_trade=True,
        )

    monkeypatch.setattr(ss, "compute_structural_stop", _forced)
    if clear_overlay_env:
        monkeypatch.delenv("TF_CONFLUENCE_OVERLAY_DISABLED", raising=False)

    n = 40
    if with_ts:
        base = _dt.datetime(2026, 1, 5, 14, 35)
        ts = [base + _dt.timedelta(minutes=i) for i in range(n)]
    else:
        ts = [None] * n
    df = pl.DataFrame({
        "close": np.linspace(5000, 5010, n), "ts_event": ts,
        "high": np.linspace(5001, 5011, n), "low": np.linspace(4999, 5009, n),
        "atr": np.full(n, 5.0),
    })
    entries = np.zeros(n, dtype=bool)
    entries[20] = True
    filtered, _, stats = bt.apply_eligibility_gate(
        entries.copy(), np.zeros(n, dtype=bool), df, "long", "MES",
        htf_cache={"2026-01-05": htf_obj} if htf_obj is not None else {},
        strategy_name=SVKM_NAME,
    )
    return filtered, stats, calls["n"]


def test_red_b_context_failure_must_not_outrun_mandatory_risk(monkeypatch):
    filtered, stats, stop_calls = _forced_refusal_gate(
        monkeypatch, with_ts=True, htf_obj=_htf_stub()
    )
    assert stop_calls > 0, "the stop was never computed — risk could not have been evaluated"
    assert not filtered[20], "signal survived a forced framework refusal"
    assert stats.get("framework_risk_refused", 0) > 0


def test_red_c_missing_htf_passthrough_must_still_evaluate_framework_risk(monkeypatch):
    filtered, stats, stop_calls = _forced_refusal_gate(
        monkeypatch, with_ts=False, htf_obj=None
    )
    assert stop_calls > 0
    assert not filtered[20]


def test_telemetry_cannot_report_risk_checked_when_it_was_not(monkeypatch):
    """AR-1212 §6 / AR-1214 §4 TELEMETRY.

    RE-DERIVED after the Phase-0 repair. This test used to assert that the counters read
    ZERO on a bar that exited before the stop plan existed — the honest reading of the
    broken architecture. **That path no longer exists**: Phase 0 evaluates mandatory risk
    before every optional exit, so every signal is checked. The invariant that survives,
    and the one that actually matters, is that the counters may never overstate: checked
    is bounded by the number of raw signals, and the false-green boolean stays gone.
    """
    _, stats, _ = _forced_refusal_gate(monkeypatch, with_ts=True, htf_obj=_htf_stub())
    assert "framework_risk_enforced" not in stats, "the false-green boolean is back"
    assert stats["framework_risk_checked"] <= stats["total"] or stats["total"] == 0
    assert stats["framework_risk_refused"] <= stats["framework_risk_checked"]


def test_red_d_source_entry_only_must_still_enforce_framework_risk(monkeypatch):
    """AR-1214 §2: the repository's own ablation harness defines the mode as

        source_entry_only = YouTube source entry + TF risk/exit/sizing, overlay OFF

    so disabling the OPTIONAL confluence overlay must NOT disable framework risk.
    """
    monkeypatch.setenv("TF_CONFLUENCE_OVERLAY_DISABLED", "true")
    filtered, stats, stop_calls = _forced_refusal_gate(
        monkeypatch, with_ts=True, htf_obj=_htf_stub(), clear_overlay_env=False
    )
    assert stats.get("mode") == "source_entry_only"
    assert stop_calls > 0, "mandatory risk was never evaluated in source_entry_only mode"
    assert not filtered[20], "an oversized mandatory stop survived source_entry_only"


def test_red_d_control_source_entry_only_safe_stop_passes_through(monkeypatch):
    """The paired control §2 requires: source-entry-only passthrough behaviour must be
    PRESERVED for a safe stop. We are removing only the ability to bypass framework
    safety, never the mode itself."""
    import datetime as dt

    import numpy as np
    import polars as pl

    from src.engine import backtester as bt

    monkeypatch.setenv("TF_CONFLUENCE_OVERLAY_DISABLED", "true")
    n = 40
    base = dt.datetime(2026, 1, 5, 14, 35)
    df = pl.DataFrame({
        "close": np.linspace(5000, 5010, n),
        "ts_event": [base + dt.timedelta(minutes=i) for i in range(n)],
        "high": np.linspace(5001, 5011, n), "low": np.linspace(4999, 5009, n),
        "atr": np.full(n, 5.0),
    })
    entries = np.zeros(n, dtype=bool)
    entries[20] = True
    filtered, _, stats = bt.apply_eligibility_gate(
        entries.copy(), np.zeros(n, dtype=bool), df, "long", "MES",
        htf_cache={"2026-01-05": _htf_stub()}, strategy_name=SVKM_NAME,
    )
    assert stats.get("mode") == "source_entry_only"
    assert filtered[20], "a SAFE stop must still pass through source_entry_only"


# --------------------------------------------------------------------------- #
# AR-1216 §4 — ADMISSION -> MANAGEMENT STOP PARITY ACROSS EVERY BYPASS BOUNDARY
#
# Phase 0 approving a stop is not enough: the SAME stop must reach management. Before
# this repair the map was published only inside the overlay loop, so every early
# return/continue handed management an EMPTY map and `_resolve_stop_risk_points` could
# fall back to an ATR stop — admission checks STOP A, management uses STOP B.
#
# The proof target is the IDENTITY of the stop, never "risk was checked".
# --------------------------------------------------------------------------- #


def _gate_with_safe_stop(monkeypatch, *, htf_cache, overlay_disabled=False, raise_ctx=False):
    """Run the gate so Phase 0 approves a SAFE stop, then take a bypass boundary."""
    import datetime as dt

    import numpy as np
    import polars as pl

    from src.engine import backtester as bt

    if overlay_disabled:
        monkeypatch.setenv("TF_CONFLUENCE_OVERLAY_DISABLED", "true")
    else:
        monkeypatch.delenv("TF_CONFLUENCE_OVERLAY_DISABLED", raising=False)

    n = 40
    base = dt.datetime(2026, 1, 5, 14, 35)
    df = pl.DataFrame({
        "close": np.linspace(5000, 5010, n),
        "ts_event": [base + dt.timedelta(minutes=i) for i in range(n)],
        "high": np.linspace(5001, 5011, n), "low": np.linspace(4999, 5009, n),
        "atr_14": np.full(n, 5.0),
    })
    entries = np.zeros(n, dtype=bool)
    entries[20] = True
    filtered, _, stats = bt.apply_eligibility_gate(
        entries.copy(), np.zeros(n, dtype=bool), df, "long", "MES",
        htf_cache=htf_cache, strategy_name=SVKM_NAME,
    )
    return filtered, stats


def _assert_stop_exported(filtered, stats, bar=20):
    assert bool(filtered[bar]), "the safe signal did not survive the bypass"
    smap = stats.get("structural_stop_map")
    assert smap, "structural_stop_map is EMPTY — management would fall back to ATR"
    assert bar in smap, f"bar {bar} survived with no exported stop plan"
    entry = smap[bar]
    assert entry["stop_price"] > 0 and entry["distance"] > 0
    assert entry["stop_reason"]
    return entry


def test_ar1216_a_source_entry_only_exports_the_phase0_stop(monkeypatch):
    filtered, stats = _gate_with_safe_stop(
        monkeypatch, htf_cache={"2026-01-05": _htf_stub()}, overlay_disabled=True)
    assert stats["mode"] == "source_entry_only"
    _assert_stop_exported(filtered, stats)


def test_ar1216_b_top_level_no_htf_exports_the_phase0_stop(monkeypatch):
    filtered, stats = _gate_with_safe_stop(monkeypatch, htf_cache=None)
    assert stats["mode"] == "passthrough_htf_unavailable"
    _assert_stop_exported(filtered, stats)


def test_ar1216_c_per_bar_missing_htf_exports_the_phase0_stop(monkeypatch):
    """Non-empty cache that lacks the signal's day — the per-bar `continue`."""
    filtered, stats = _gate_with_safe_stop(
        monkeypatch, htf_cache={"1999-01-01": _htf_stub()})
    _assert_stop_exported(filtered, stats)


def test_ar1216_d_unregistered_context_exception_exports_the_phase0_stop(monkeypatch):
    """The optional-context error path: a bare object() raises inside session/bias work
    AFTER Phase 0, the unregistered signal is kept — and its stop must still be exported."""
    filtered, stats = _gate_with_safe_stop(
        monkeypatch, htf_cache={"2026-01-05": object()})
    assert stats["mode"] == "passthrough_strategy_unregistered"
    _assert_stop_exported(filtered, stats)


def test_ar1216_e_downstream_resolver_selects_the_phase0_distance(monkeypatch):
    """§4 E — close the HANDOFF, not just the dictionary shape.

    Feed a real exported map into the production resolver and prove it selects the
    Phase-0 structural distance rather than an ATR stop.

    BOTH lookup conventions are exercised, because they are different joins:
      * source_faithful=True  -> key is the SIGNAL bar itself (entry on the decision bar)
      * legacy                -> key is entry_idx - 1 (next-bar-fill roll), AND the branch
        is gated behind BACKTEST_STRUCTURAL_STOP_PARITY_ENABLED, which DEFAULTS FALSE.
        Without setting it this test would silently exercise the ATR fallback while
        appearing to prove structural selection.
    """
    from src.engine.backtester import _resolve_stop_risk_points

    filtered, stats = _gate_with_safe_stop(monkeypatch, htf_cache=None)
    exported = _assert_stop_exported(filtered, stats)
    distinctive = exported["distance"]
    atr_fallback = distinctive + 7.0  # deliberately different, so selection is observable
    smap = {"long": stats["structural_stop_map"], "short": {}}

    # (1) source-faithful convention: key == signal bar
    risk_sf, basis_sf = _resolve_stop_risk_points(
        entry_idx=20, is_short=False, atr_fallback_points=atr_fallback,
        stop_ceiling=1000.0, structural_stop_map=smap, source_faithful=True,
    )
    assert risk_sf == pytest.approx(distinctive), (
        f"source-faithful management resolved {risk_sf}, not the Phase-0 admission "
        f"distance {distinctive} (ATR fallback was {atr_fallback})"
    )
    assert basis_sf == "source_exact"

    # (2) legacy convention: key == entry_idx - 1, and the parity flag must be ON or the
    #     structural branch is dead and this proves nothing.
    monkeypatch.setenv("BACKTEST_STRUCTURAL_STOP_PARITY_ENABLED", "true")
    risk_legacy, basis_legacy = _resolve_stop_risk_points(
        entry_idx=21, is_short=False, atr_fallback_points=atr_fallback,
        stop_ceiling=1000.0, structural_stop_map=smap, source_faithful=False,
    )
    assert basis_legacy == "structural", (
        f"legacy management fell back to {basis_legacy!r} instead of the exported stop"
    )
    assert risk_legacy == pytest.approx(distinctive)


def test_ar1216_e_negative_control_empty_map_does_not_resolve_structurally(monkeypatch):
    """The control that makes E mean something: with an EMPTY map — the state this repair
    fixed — management must NOT report a structural stop. If this also passed, E would be
    proving nothing about the export."""
    from src.engine.backtester import _resolve_stop_risk_points

    monkeypatch.setenv("BACKTEST_STRUCTURAL_STOP_PARITY_ENABLED", "true")
    risk, basis = _resolve_stop_risk_points(
        entry_idx=21, is_short=False, atr_fallback_points=99.0,
        stop_ceiling=1000.0, structural_stop_map={"long": {}, "short": {}},
        source_faithful=False,
    )
    assert basis == "atr_fallback"
    assert risk == pytest.approx(99.0)
