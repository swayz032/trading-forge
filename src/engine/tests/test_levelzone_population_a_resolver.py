"""Tests for the Population-A Level Resolver
(docs/designs/packet-levelzone-population-a-resolver-2026-07-20.md):
  - src/engine/spec_family_bindings.py: classify_population_a_kind() + the
    TF_LEVELZONE_RESOLVER_ENABLED-gated binding override, layered ON TOP of the
    pre-existing TF_LEVELZONE_ROUTING_ENABLED sub-wire.
  - src/engine/spec_condition_compiler.py: SpecConditionStrategy._eval_population_a_level()
    resolves a Population-A condition's OWN object text to a per-bar level series built
    from a detector the repo already owns (market_structure.detect_swings /
    indicators.liquidity.detect_{buyside,sellside}_liquidity /
    indicators.order_flow.detect_{bullish,bearish}_ob) instead of the shared EMA(20)
    proxy every other level/zone condition still uses.

Scope-lock (packet §3): Population-A ONLY (named_sr_level / order_block_edge / swing,
bare_anaphora=false). Population B (bare anaphora) is PROHIBITED — never resolved, never
routed to this primitive.

UPDATED by docs/designs/packet-population-a-flip-step-2026-07-20.md: approximation is no
longer uniformly True for every Population-A kind. named_sr_level and order_block_edge now
resolve approximation=False (each independently earned a de-approximation grade — see
POPULATION_A_DEAPPROXIMATED_KINDS in src/engine/spec_family_bindings.py for citations).
swing still resolves approximation=True (n=1, below the n>=2 de-approximation floor,
R-102 §2). The tests below that previously asserted "True for every kind" (this file's
original R7 block) have been SPLIT per-kind rather than edited in place — see the R9 block
near the bottom for the flip's own evidence-citing tests, and test_swing_kind_routes_but_
approximation_never_flips (unchanged) for the swing floor proof.

Every test that flips TF_LEVELZONE_ROUTING_ENABLED / TF_LEVELZONE_RESOLVER_ENABLED
restores prior env state in a try/finally — same discipline as test_levelzone_routing.py.

Run targeted (bare pytest collection over the full src/engine/tests directory hangs on
this tower — CLAUDE.md pre-existing trait):

    python -m pytest src/engine/tests/test_levelzone_population_a_resolver.py -v
"""

from __future__ import annotations

import json
import os
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path

import numpy as np
import polars as pl
import pytest

from src.engine.spec_condition_compiler import SpecConditionStrategy
from src.engine.spec_family_bindings import (
    LEVELZONE_NATIVE_PRIMITIVE,
    LEVELZONE_RESOLVER_PRIMITIVE,
    bind_condition,
    classify_population_a_kind,
    compile_binding_plan,
)

REPO_ROOT = Path(__file__).resolve().parents[3]
SHAKEDOWN_DIR = REPO_ROOT / "docs" / "replay-results" / "h1-scripts" / "claude-rung-v32" / "shakedown_specs"
CENSUS_PATH = REPO_ROOT / "docs" / "replay-results" / "h1-battery" / "levelzone-object-reference-census.json"


@contextmanager
def levelzone_routing(enabled: bool):
    prior = os.environ.get("TF_LEVELZONE_ROUTING_ENABLED")
    os.environ["TF_LEVELZONE_ROUTING_ENABLED"] = "true" if enabled else "false"
    try:
        yield
    finally:
        if prior is None:
            os.environ.pop("TF_LEVELZONE_ROUTING_ENABLED", None)
        else:
            os.environ["TF_LEVELZONE_ROUTING_ENABLED"] = prior


@contextmanager
def levelzone_resolver(enabled: bool):
    prior = os.environ.get("TF_LEVELZONE_RESOLVER_ENABLED")
    os.environ["TF_LEVELZONE_RESOLVER_ENABLED"] = "true" if enabled else "false"
    try:
        yield
    finally:
        if prior is None:
            os.environ.pop("TF_LEVELZONE_RESOLVER_ENABLED", None)
        else:
            os.environ["TF_LEVELZONE_RESOLVER_ENABLED"] = prior


@contextmanager
def both_flags(enabled: bool):
    with levelzone_routing(enabled), levelzone_resolver(enabled):
        yield


def _synthetic_df(n: int = 200, seed: int = 11) -> pl.DataFrame:
    """Same generator convention as test_levelzone_routing.py's _synthetic_df /
    cadence_isolation_harness.py's make_bars — mean-reverting-ish random walk, fixed
    seed, replay-deterministic. n=200 (larger than the sub-wire's default 80) so swing/
    order-block/liquidity detectors — which need real structure to form, unlike the EMA
    proxy — have enough bars to produce non-degenerate output."""
    rng = np.random.default_rng(seed)
    close = 100 + np.cumsum(rng.normal(0, 0.5, n))
    high = close + rng.uniform(0.1, 1.5, n)
    low = close - rng.uniform(0.1, 1.5, n)
    open_ = close + rng.normal(0, 0.3, n)
    ts = [datetime(2026, 1, 5, 9, 30, tzinfo=UTC) + timedelta(minutes=15 * i) for i in range(n)]
    return pl.DataFrame(
        {"open": open_, "high": high, "low": low, "close": close, "ts_event": ts, "volume": [100] * n}
    )


# ═══════════════════════════════════════════════════════════════════════════════════════
# R8: classify_population_a_kind — anti-vacuity guard (PASS known-good / FAIL known-bad)
# ═══════════════════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize(
    "obj,expected_kind",
    [
        ("support zone", "named_sr_level"),
        ("resistance level", "named_sr_level"),
        ("a support or resistance", "named_sr_level"),
        ("demand zone retest", "order_block_edge"),
        ("supply zone rejection", "order_block_edge"),
        ("order block mitigation", "order_block_edge"),
        ("breaker block", "order_block_edge"),
        ("swing high", "swing"),
        ("swing low", "swing"),
        ("previous high was broken", "swing"),
        ("higher low formed", "swing"),
    ],
)
def test_classify_population_a_kind_passes_known_good_objects(obj, expected_kind):
    assert classify_population_a_kind(obj) == expected_kind


@pytest.mark.parametrize(
    "obj",
    [
        "the level",
        "that zone",
        "this price",
        "it there",
        "reclaims the level with a lot of volume",  # real Population-B corpus row
        "bearish candlestick",
        "moving average crossover",
        "fair value gap",  # real kind, but NOT Population-A scope
        "premium discount array",
        "",
        None,
    ],
)
def test_classify_population_a_kind_fails_known_bad_objects(obj):
    assert classify_population_a_kind(obj) is None


def test_classify_population_a_kind_rejects_bare_anaphora_even_when_a_kind_word_is_also_present():
    """Real Population-B corpus row (bare_anaphora=true): the text names BOTH order_block_edge
    ('demand zones') and named_sr_level ('support level') keyword matches, but ALSO contains a
    bare-anaphora phrase ('this price') elsewhere — the census disposes this row to Population B,
    and the classifier MUST agree (packet §3 hard prohibition: never force a bare-anaphora row
    into a resolved binding, however plausible a co-occurring kind word looks)."""
    real_text = (
        "if you first establish where your support level is at ... look and learn to find and "
        "spot the demand zones ... every time we get to this price the stock take off"
    )
    assert classify_population_a_kind(real_text) is None


def test_classify_population_a_kind_is_not_degenerate():
    """Anti-vacuity: must actually discriminate across all 3 in-scope kinds — not constant-None
    (dead code) and not collapsed to a single kind for everything."""
    good = ["support zone", "demand zone", "swing high"]
    kinds = {classify_population_a_kind(o) for o in good}
    assert kinds == {"named_sr_level", "order_block_edge", "swing"}
    assert all(classify_population_a_kind(o) is None for o in ["the level", "", None])


def test_classify_population_a_kind_reproduces_census_membership_exactly():
    """Ground-truth cross-check against the frozen census artifact (not a re-derivation — the
    census IS the design input this classifier reuses verbatim, packet §3). All 16 level/zone
    rows are re-classified; Population-A membership (bare_anaphora=false AND kind in the 3
    in-scope kinds) and the SPECIFIC kind assigned must match the census exactly, proving this
    is the SAME classifier, not a third divergent one."""
    rows = json.loads(CENSUS_PATH.read_text(encoding="utf-8"))["rows"]
    in_scope = {"swing", "order_block_edge", "named_sr_level"}
    n_pop_a = 0
    for r in rows:
        census_pop_a = (not r["bare_anaphora"]) and any(k in in_scope for k in r["reference_kinds"])
        got = classify_population_a_kind(r["object"])
        got_pop_a = got is not None
        assert census_pop_a == got_pop_a, f"Population-A membership mismatch on {r['condition_id']}"
        if census_pop_a:
            n_pop_a += 1
            assert len(r["reference_kinds"]) == 1, "unexpected multi-label Population-A row — priority order untested"
            assert got == r["reference_kinds"][0], f"kind mismatch on {r['condition_id']}: got {got}, census says {r['reference_kinds'][0]}"
    assert n_pop_a == 7, f"packet names exactly 7 Population-A rows, got {n_pop_a}"


# ═══════════════════════════════════════════════════════════════════════════════════════
# Binding-plan level (spec_family_bindings.py)
# ═══════════════════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize(
    "obj,expected_approximation",
    [
        ("support zone", False),   # named_sr_level -- de-approximated (R-136, commit 7e3247ca)
        ("demand zone", False),    # order_block_edge -- de-approximated (AR-117, commit a2604d39)
        ("previous high", True),   # swing -- UNVERIFIED-BY-SAMPLE, n=1, stays approximated
    ],
)
def test_population_a_object_binds_to_resolver_primitive_when_both_flags_enabled(obj, expected_approximation):
    """UPDATED by the Population-A flip-step packet (2026-07-20): this test previously
    asserted approximation is True for ALL three parametrized objects (packet hard
    constraint at the time: no approximation=False anywhere in that delivery). It now
    asserts the PER-KIND flip explicitly — named_sr_level and order_block_edge earned
    approximation=False, swing did not (n=1, below the n>=2 de-approximation floor)."""
    cond = {"id": "c1", "type": "WAIT_STRUCTURE", "object": obj, "role": "spine"}
    with both_flags(True):
        b = bind_condition(cond)
    assert b.bindable is True
    assert b.primitive == LEVELZONE_RESOLVER_PRIMITIVE
    assert b.primitive == "levelzone_routing.population_a_resolver"
    assert b.approximation is expected_approximation, (
        f"{obj!r}: expected approximation={expected_approximation}, got {b.approximation}"
    )


def test_population_b_object_falls_back_to_native_primitive_even_with_both_flags_enabled():
    """PROHIBITED per packet §3: a bare-anaphora level/zone condition must NEVER get the
    resolver primitive, even when both flags are on — it falls back to the pre-existing
    EMA-proxy sub-wire primitive exactly as it did before this delivery."""
    cond = {"id": "c1", "type": "WAIT_STRUCTURE", "object": "reclaims the level with a lot of volume", "role": "spine"}
    with both_flags(True):
        b = bind_condition(cond)
    assert b.primitive == LEVELZONE_NATIVE_PRIMITIVE
    assert b.primitive != LEVELZONE_RESOLVER_PRIMITIVE


def test_resolver_requires_routing_flag_too():
    """Resolver flag alone (routing flag off) must NOT activate the resolver — the resolver only
    ever replaces the EMA proxy for a condition that would already be routed to the level-aware
    primitive in the first place."""
    cond = {"id": "c1", "type": "WAIT_STRUCTURE", "object": "support zone", "role": "spine"}
    os.environ.pop("TF_LEVELZONE_ROUTING_ENABLED", None)
    with levelzone_resolver(True):
        b = bind_condition(cond)
    assert b.primitive != LEVELZONE_RESOLVER_PRIMITIVE
    assert b.primitive == "structure_engine.compute_structure_state"


def test_routing_flag_alone_does_not_activate_resolver():
    """Inverse of the above: routing on, resolver off -> pre-existing EMA-proxy sub-wire
    behavior, unchanged by this delivery."""
    cond = {"id": "c1", "type": "WAIT_STRUCTURE", "object": "support zone", "role": "spine"}
    os.environ.pop("TF_LEVELZONE_RESOLVER_ENABLED", None)
    with levelzone_routing(True):
        b = bind_condition(cond)
    assert b.primitive == LEVELZONE_NATIVE_PRIMITIVE


def test_swing_kind_routes_but_approximation_never_flips():
    """R-102 §2 ruling: swing (n=1) ROUTES (the resolver machinery is shared) but its
    disposition is UNVERIFIED-BY-SAMPLE — no special-cased approximation=False, same as
    named_sr_level/order_block_edge which are ALSO withheld in this delivery."""
    cond = {"id": "c1", "type": "WAIT_STRUCTURE", "object": "previous high", "role": "spine"}
    with both_flags(True):
        b = bind_condition(cond)
    assert b.primitive == LEVELZONE_RESOLVER_PRIMITIVE
    assert b.approximation is True


# ═══════════════════════════════════════════════════════════════════════════════════════
# R6: flag-OFF binding-plan INVARIANCE across every flag-absent/false permutation, plus a
# same-process assertion that the resolver primitive is never reached with the flags off.
#
# SCOPE HONESTY (receipt-cleanup, R-158 §3): this test does NOT compare against a captured
# pre-delivery artifact. It compares flag-off plans built in THIS process to each other.
# A genuine cross-commit baseline would require executing the parent commit's code, which
# a single-process pytest cannot do without vendoring a serialized plan (itself a
# hand-copied constant — the very shape R-158 §3 flags). The cross-commit proof exists,
# but it lives in the grade's own independent diff, NOT here. This test was previously
# named ..._byte_identical_to_pre_delivery_baseline, which promised that proof; it has been
# renamed to describe what it actually performs.
# ═══════════════════════════════════════════════════════════════════════════════════════

def test_flag_off_binding_plan_invariant_across_flag_absent_and_false_permutations():
    """Builds the SAME mixed spec test_levelzone_routing.py's own byte-identity test uses,
    and confirms the FULL binding plan to_dict() is identical whether
    TF_LEVELZONE_RESOLVER_ENABLED is absent, explicitly 'false', OR the routing flag is
    also independently toggled — this delivery's new code path is provably never entered
    unless BOTH flags are 'true'. All comparisons are same-process; see the block comment
    above for why this is NOT a captured pre-delivery baseline."""
    spec = {
        "direction": "long",
        "entry_conditions": [
            {"id": "t1", "type": "ENABLE_ENTRY", "object": "entry", "role": "trigger"},
            {"id": "s1", "type": "WAIT_STRUCTURE", "object": "support at 100", "role": "spine"},
            {"id": "s2", "type": "VERIFY_STRUCTURE", "object": "resistance at 140", "role": "spine"},
            {"id": "s3", "type": "WAIT_STRUCTURE", "object": "demand zone", "role": "spine"},
            {"id": "s4", "type": "WAIT_STRUCTURE", "object": "previous high", "role": "spine"},
            {"id": "s5", "type": "WAIT_BIAS", "object": "bullish bias", "role": "spine"},
        ],
        "invalidations": [
            {"id": "i1", "type": "INVALIDATE", "object": "structural stop", "role": "spine"},
        ],
        "entry_trigger_id": "t1",
    }
    os.environ.pop("TF_LEVELZONE_ROUTING_ENABLED", None)
    os.environ.pop("TF_LEVELZONE_RESOLVER_ENABLED", None)
    plan_absent = compile_binding_plan(spec)

    with levelzone_resolver(False):
        plan_resolver_explicit_false = compile_binding_plan(spec)
    assert plan_absent.to_dict() == plan_resolver_explicit_false.to_dict()

    with levelzone_routing(True), levelzone_resolver(False):
        plan_routing_on_resolver_off = compile_binding_plan(spec)
    with levelzone_routing(True):
        os.environ.pop("TF_LEVELZONE_RESOLVER_ENABLED", None)
        plan_routing_on_resolver_absent = compile_binding_plan(spec)
    assert plan_routing_on_resolver_off.to_dict() == plan_routing_on_resolver_absent.to_dict(), (
        "resolver flag absent vs explicit false must be byte-identical (same live-read "
        "contract as every other flag in this module)"
    )
    # And that plan (resolver OFF) must be the pre-delivery sub-wire behavior: every
    # level/zone condition still binds to the shared EMA-proxy primitive, never the
    # resolver — s3/s4 (which WOULD classify Population-A if the resolver were on) must
    # show LEVELZONE_NATIVE_PRIMITIVE here, proving the new code path never fired.
    by_id = {b.condition_id: b for b in plan_routing_on_resolver_off.bindings}
    assert by_id["s3"].primitive == LEVELZONE_NATIVE_PRIMITIVE
    assert by_id["s4"].primitive == LEVELZONE_NATIVE_PRIMITIVE
    assert by_id["s1"].primitive == LEVELZONE_NATIVE_PRIMITIVE


def test_flag_off_execution_output_byte_identical_across_process_history():
    """Replay-determinism companion (mirrors test_levelzone_routing.py's own
    test_entry_signals_are_byte_identical_when_flag_off_regardless_of_process_env_history):
    an OFF-mode run AFTER an ON-mode run in the same process must match a fresh OFF-only run
    exactly — the new flag's live-read must never leak cached state across instances."""
    df = _synthetic_df()
    spec = {
        "direction": "long",
        "entry_conditions": [
            {"id": "t1", "type": "ENABLE_ENTRY", "object": "entry", "role": "trigger"},
            {"id": "s1", "type": "WAIT_STRUCTURE", "object": "support zone retest", "role": "spine"},
        ],
        "invalidations": [],
        "entry_trigger_id": "t1",
    }
    compiled_spec = {"spec": spec, "spec_hash": "testhash"}

    os.environ.pop("TF_LEVELZONE_ROUTING_ENABLED", None)
    os.environ.pop("TF_LEVELZONE_RESOLVER_ENABLED", None)
    baseline = SpecConditionStrategy(compiled_spec, symbol="MES", timeframe="15m")
    baseline_out = baseline.compute(df)

    with both_flags(True):
        SpecConditionStrategy(compiled_spec, symbol="MES", timeframe="15m").compute(df)

    os.environ.pop("TF_LEVELZONE_ROUTING_ENABLED", None)
    os.environ.pop("TF_LEVELZONE_RESOLVER_ENABLED", None)
    after = SpecConditionStrategy(compiled_spec, symbol="MES", timeframe="15m")
    after_out = after.compute(df)

    assert baseline_out["entry_long"].to_list() == after_out["entry_long"].to_list()
    assert baseline_out["entry_short"].to_list() == after_out["entry_short"].to_list()


# ═══════════════════════════════════════════════════════════════════════════════════════
# R1 (★) + R2: production-boundary liveness / per-condition discrimination.
# Loads REAL corpus spec files (the exact production artifact SpecConditionStrategy
# consumes), varies the CONDITION TEXT the production path actually reads, and shows the
# resolved level series differs.
# ═══════════════════════════════════════════════════════════════════════════════════════

def _load_real_condition(spec_filename: str, condition_id: str) -> dict:
    path = SHAKEDOWN_DIR / spec_filename
    data = json.loads(path.read_text(encoding="utf-8"))
    for c in data["spec"]["entry_conditions"]:
        if c["id"] == condition_id:
            return c
    raise AssertionError(f"{condition_id} not found in {spec_filename}")


def _run_single_condition_spec(condition: dict, df: pl.DataFrame) -> SpecConditionStrategy:
    spec = {
        "direction": "long",
        "entry_conditions": [
            {"id": "t1", "type": "ENABLE_ENTRY", "object": "entry", "role": "trigger"},
            condition,
        ],
        "invalidations": [],
        "entry_trigger_id": "t1",
    }
    compiled_spec = {"spec": spec, "spec_hash": "testhash"}
    strat = SpecConditionStrategy(compiled_spec, symbol="MES", timeframe="15m", trace=True)
    strat.compute(df)
    return strat


def test_r1_production_boundary_liveness_real_corpus_condition_text():
    """★ R1: loads the REAL condition dict (id/type/object/role) straight out of the real
    committed spec artifact kFyD3H6I1I8__s0.spec.json — the exact production path
    (compile_binding_plan -> SpecConditionStrategy.compute) consumes THIS json's
    entry_conditions list, never a hand-typed string. Two real Population-A conditions
    from the SAME file, SAME kind (order_block_edge), OPPOSITE polarity (demand vs
    supply) — the level series the production path resolves for each MUST differ. This is
    varying the CONDITION TEXT the production path actually reads, not an interior
    `level` argument — the exact item R1 exists to force."""
    demand_cond = _load_real_condition(
        "kFyD3H6I1I8__s0.spec.json", "WAIT_STRUCTURE:a-level-of-demand-is-just-when-you-have#9"
    )
    supply_cond = _load_real_condition(
        "kFyD3H6I1I8__s0.spec.json", "WAIT_STRUCTURE:this-created-a-level-of-supply-i-was-loo#10"
    )
    assert classify_population_a_kind(demand_cond["object"]) == "order_block_edge"
    assert classify_population_a_kind(supply_cond["object"]) == "order_block_edge"

    df = _synthetic_df(n=250, seed=44)
    with both_flags(True):
        strat_demand = _run_single_condition_spec(dict(demand_cond, id="c_demand"), df)
        strat_supply = _run_single_condition_spec(dict(supply_cond, id="c_supply"), df)

    level_demand = strat_demand.last_population_a_level["c_demand"]
    level_supply = strat_supply.last_population_a_level["c_supply"]

    assert not np.array_equal(level_demand, level_supply, equal_nan=True), (
        "production-boundary liveness FAILED: two real, differently-worded condition texts "
        "from the same real spec file resolved to an IDENTICAL level series"
    )
    # Anti-vacuity: both series must carry SOME real (non-NaN) signal, not both degenerate.
    assert np.isfinite(level_demand).any(), "demand-side level series never populated"
    assert np.isfinite(level_supply).any(), "supply-side level series never populated"


def test_r2_per_condition_discrimination_across_all_three_kinds_real_corpus():
    """R2: two Population-A conditions naming DIFFERENT levels (here: different KINDS
    entirely — named_sr_level vs order_block_edge vs swing) drawn from three different
    real corpus spec files must each resolve to a DISTINCT level series — the exact
    property the prior sub-wire's shared EMA(20) proxy lacked."""
    sr_cond = _load_real_condition(
        "4cT8WTyxhYY__s0.spec.json", "WAIT_STRUCTURE:a-liquidity-grab-is-simply-when-price-br#0"
    )
    ob_cond = _load_real_condition(
        "kFyD3H6I1I8__s0.spec.json", "WAIT_STRUCTURE:a-level-of-demand-is-just-when-you-have#9"
    )
    swing_cond = _load_real_condition(
        "0xygpCMwxbQ__s0.spec.json", "WAIT_STRUCTURE:the-next-thing-i-look-for-is-a-market-st#2"
    )
    assert classify_population_a_kind(sr_cond["object"]) == "named_sr_level"
    assert classify_population_a_kind(ob_cond["object"]) == "order_block_edge"
    assert classify_population_a_kind(swing_cond["object"]) == "swing"

    df = _synthetic_df(n=250, seed=44)
    with both_flags(True):
        strat_sr = _run_single_condition_spec(dict(sr_cond, id="c_sr"), df)
        strat_ob = _run_single_condition_spec(dict(ob_cond, id="c_ob"), df)
        strat_swing = _run_single_condition_spec(dict(swing_cond, id="c_swing"), df)

    lvl_sr = strat_sr.last_population_a_level["c_sr"]
    lvl_ob = strat_ob.last_population_a_level["c_ob"]
    lvl_swing = strat_swing.last_population_a_level["c_swing"]

    assert not np.array_equal(lvl_sr, lvl_ob, equal_nan=True)
    assert not np.array_equal(lvl_sr, lvl_swing, equal_nan=True)
    assert not np.array_equal(lvl_ob, lvl_swing, equal_nan=True)

    # And none of the three collapses to the shared EMA(20) proxy the pre-delivery sub-wire
    # used for every level/zone condition — the whole point of the resolver.
    from src.engine.indicators.core import compute_ema
    ema_proxy = compute_ema(pl.Series(df["close"].to_numpy().astype(np.float64)), 20).to_numpy()
    assert not np.array_equal(lvl_sr, ema_proxy, equal_nan=True)
    assert not np.array_equal(lvl_ob, ema_proxy, equal_nan=True)
    assert not np.array_equal(lvl_swing, ema_proxy, equal_nan=True)


def test_r1_text_substitution_same_condition_id_opposite_polarity_diverges():
    """Cleanest possible R1 proof: hold id/type/role FIXED, vary ONLY the object text
    (support vs resistance) — the production path's dispatch key is the object text, so
    this isolates "the condition text moved the level series" from any other variable."""
    df = _synthetic_df(n=250, seed=7)
    support_cond = {"id": "s1", "type": "WAIT_STRUCTURE", "object": "price found support here", "role": "spine"}
    resistance_cond = {"id": "s1", "type": "WAIT_STRUCTURE", "object": "price found resistance here", "role": "spine"}

    with both_flags(True):
        strat_support = _run_single_condition_spec(support_cond, df)
        strat_resistance = _run_single_condition_spec(resistance_cond, df)

    lvl_support = strat_support.last_population_a_level["s1"]
    lvl_resistance = strat_resistance.last_population_a_level["s1"]
    assert not np.array_equal(lvl_support, lvl_resistance, equal_nan=True)


# ═══════════════════════════════════════════════════════════════════════════════════════
# R3: both-polarity per binding, on evaluation-observable (role=="spine") rows. All 7
# Population-A corpus rows are role=="spine" (verified below) — binding-engagement and
# evaluation-observability are reported as two separate numbers.
# ═══════════════════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize(
    "kind,bullish_obj,bearish_obj",
    [
        ("named_sr_level", "price found support here", "price found resistance here"),
        ("order_block_edge", "a demand zone formed", "a supply zone formed"),
        ("swing", "the previous low held", "the previous high held"),
    ],
)
def test_r3_both_polarity_per_binding(kind, bullish_obj, bearish_obj):
    """Each of the 3 in-scope kinds must be able to resolve BOTH the bullish-leaning
    (support/demand/swing-low) and bearish-leaning (resistance/supply/swing-high) side of
    its detector, and the two sides must differ — a resolver stuck on one polarity would
    be the same ANY-constant degeneracy class the sibling sub-wire's own premise audit
    guards against."""
    assert classify_population_a_kind(bullish_obj) == kind
    assert classify_population_a_kind(bearish_obj) == kind

    df = _synthetic_df(n=250, seed=91)
    bullish_cond = {"id": "s1", "type": "WAIT_STRUCTURE", "object": bullish_obj, "role": "spine"}
    bearish_cond = {"id": "s1", "type": "WAIT_STRUCTURE", "object": bearish_obj, "role": "spine"}

    with both_flags(True):
        strat_bull = _run_single_condition_spec(bullish_cond, df)
        strat_bear = _run_single_condition_spec(bearish_cond, df)

    lvl_bull = strat_bull.last_population_a_level["s1"]
    lvl_bear = strat_bear.last_population_a_level["s1"]
    assert not np.array_equal(lvl_bull, lvl_bear, equal_nan=True), (
        f"{kind}: bullish and bearish polarity resolved to the SAME level series"
    )
    assert np.isfinite(lvl_bull).any(), f"{kind} bullish side never populated a level"
    assert np.isfinite(lvl_bear).any(), f"{kind} bearish side never populated a level"


def test_r3_binding_engagement_and_evaluation_observability_are_reported_separately_real_corpus():
    """R3 / R-097 §4 report discipline: binding-engagement (how many of the 7 Population-A
    corpus rows a compiled spec actually binds to the resolver primitive when both flags
    are on) and evaluation-observability (of those, how many are role=='spine' and
    therefore actually enter the per-bar gating loop, per spec_condition_compiler.py's
    `spine_bindings = [b for b in ... if b.role == 'spine']` filter — confluence-role
    bindings never enter that loop at all) are two SEPARATE numbers, never conflated into
    one combined rate."""
    rows = json.loads(CENSUS_PATH.read_text(encoding="utf-8"))["rows"]
    in_scope = {"swing", "order_block_edge", "named_sr_level"}
    pop_a_rows = [r for r in rows if (not r["bare_anaphora"]) and any(k in in_scope for k in r["reference_kinds"])]
    assert len(pop_a_rows) == 7

    engaged = 0
    evaluation_observable = 0
    with both_flags(True):
        for r in pop_a_rows:
            cond = {"id": "x", "type": "WAIT_STRUCTURE", "object": r["object"], "role": r["role"]}
            b = bind_condition(cond)
            if b.primitive == LEVELZONE_RESOLVER_PRIMITIVE:
                engaged += 1
                if b.role == "spine":
                    evaluation_observable += 1

    print(f"\nPopulation-A binding-engagement: {engaged}/7")
    print(f"Population-A evaluation-observability (of engaged, role=='spine'): {evaluation_observable}/{engaged}")
    assert engaged == 7, "every Population-A corpus row must engage the resolver primitive when both flags are on"
    assert evaluation_observable == 7, "all 7 Population-A corpus rows are role=='spine' per the census — verified here, not assumed"

    # Null: with the resolver flag OFF, engagement is deterministically 0/7 (not a
    # statistical baseline — a structural one, since the dispatch branch is unreachable).
    with levelzone_routing(True):
        os.environ.pop("TF_LEVELZONE_RESOLVER_ENABLED", None)
        null_engaged = 0
        for r in pop_a_rows:
            cond = {"id": "x", "type": "WAIT_STRUCTURE", "object": r["object"], "role": r["role"]}
            b = bind_condition(cond)
            if b.primitive == LEVELZONE_RESOLVER_PRIMITIVE:
                null_engaged += 1
    print(f"NULL (resolver flag off): {null_engaged}/7")
    assert null_engaged == 0, "null baseline must show zero engagement — proves engagement is flag-caused, not incidental"


# ═══════════════════════════════════════════════════════════════════════════════════════
# R4: cadence isolated from signal — the resolver changes ONLY the `level` argument fed to
# retest_touch_check, never its evaluation cadence (every-bar, same as the EMA-proxy path).
# ═══════════════════════════════════════════════════════════════════════════════════════

def test_r4_resolver_path_never_touches_structure_recompute_cadence_constant():
    """Static/behavioral receipt: STRUCTURE_RECOMPUTE_CADENCE_BARS (the constant the prior
    grade's cadence-isolation harness identified as the CONFOUNDING axis — _eval_wait_
    structure holds its signal for 10 bars, _eval_wait_retest/_eval_wait_structure_
    levelzone do not) is never read by _eval_population_a_level — grep-verified here so a
    future edit that accidentally introduces cadence-holding into this path fails loudly."""
    import inspect

    from src.engine.spec_condition_compiler import STRUCTURE_RECOMPUTE_CADENCE_BARS, SpecConditionStrategy

    src = inspect.getsource(SpecConditionStrategy._eval_population_a_level)
    assert "STRUCTURE_RECOMPUTE_CADENCE_BARS" not in src
    assert STRUCTURE_RECOMPUTE_CADENCE_BARS == 10  # sanity: constant still exists, unmodified


def test_r4_monkeypatched_cadence_constant_has_zero_effect_on_resolver_output():
    """Empirical companion to the static/source-grep receipt above — same discipline as
    cadence_isolation_harness.py's `level_blind_at_cadence` (monkeypatch the module
    constant for the call's duration, real production code, not re-derived math). If the
    resolver secretly depended on STRUCTURE_RECOMPUTE_CADENCE_BARS through any indirect
    path, patching it to an absurd value (1) vs its production default (10) would change
    the resolved level series or the resulting per-bar boolean array. It does not — proof
    that cadence and Population-A level-resolution are fully isolated axes here."""
    from unittest.mock import patch

    df = _synthetic_df(n=250, seed=61)
    cond = {"id": "s1", "type": "WAIT_STRUCTURE", "object": "price found support here", "role": "spine"}

    with both_flags(True):
        with patch("src.engine.spec_condition_compiler.STRUCTURE_RECOMPUTE_CADENCE_BARS", 1):
            strat_cadence1 = _run_single_condition_spec(cond, df)
        with patch("src.engine.spec_condition_compiler.STRUCTURE_RECOMPUTE_CADENCE_BARS", 10):
            strat_cadence10 = _run_single_condition_spec(cond, df)

    lvl1 = strat_cadence1.last_population_a_level["s1"]
    lvl10 = strat_cadence10.last_population_a_level["s1"]
    assert np.array_equal(lvl1, lvl10, equal_nan=True), (
        "Population-A level series changed when STRUCTURE_RECOMPUTE_CADENCE_BARS was "
        "monkeypatched — cadence and signal are NOT isolated, contrary to R4"
    )
    bool1 = strat_cadence1.last_per_condition_bool["s1"]
    bool10 = strat_cadence10.last_per_condition_bool["s1"]
    assert np.array_equal(bool1, bool10)


def test_r4_resolver_level_series_is_full_length_every_bar_no_holding_beyond_detector_sparsity():
    """The resolver's output array is length n (one entry per bar) and retest_touch_check is
    invoked with that full-length array every compute() call — exactly like the EMA-proxy
    path (_eval_wait_retest), never resampled/held at a coarser cadence. Detector SPARSITY
    (a swing/OB/liquidity level only changes when a new one forms) is a data-availability
    property of what a 'level' means, not an evaluation-cadence hold — retest_touch_check
    itself still runs fresh on every single bar in both paths, which is what the cadence
    axis actually measures (see cadence_isolation_harness.py)."""
    df = _synthetic_df(n=250, seed=13)
    cond = {"id": "s1", "type": "WAIT_STRUCTURE", "object": "price found support here", "role": "spine"}
    with both_flags(True):
        strat = _run_single_condition_spec(cond, df)
    level = strat.last_population_a_level["s1"]
    assert len(level) == len(df)


# ═══════════════════════════════════════════════════════════════════════════════════════
# R7 [SUPERSEDED by docs/designs/packet-population-a-flip-step-2026-07-20.md]: this block
# originally asserted approximation stays True for EVERY Population-A kind and polarity,
# including named_sr_level/order_block_edge (the flip-step packet's own delivery had not
# landed yet). That assertion is now FALSE for two of the three kinds by design — see R9
# below, which replaces this test with a per-kind expectation and keeps the swing half of
# the original claim alive (still True, still asserted, just split out).
#
# ACCURACY NOTE (receipt-cleanup, R-158 §3): this header is PROSE describing what the old
# block asserted. No commented-out test code was kept anywhere in this file — the flip-step
# commit message's phrase "old assertions kept as commented receipts" overstates that. The
# supersession receipt is this prose block plus R9's explicit expectations, nothing more.
# ═══════════════════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize(
    "obj,kind,expected_approximation",
    [
        ("price found support here", "named_sr_level", False),
        ("price found resistance here", "named_sr_level", False),
        ("a demand zone formed", "order_block_edge", False),
        ("a supply zone formed", "order_block_edge", False),
        # SWING POLARITIES — object text chosen so it BOTH classifies as swing AND matches
        # LEVEL_ZONE_RE, which is what actually carries a condition into the Population-A
        # resolver dispatch. "the swing low/high held" does NOT match LEVEL_ZONE_RE (the
        # regex has `previous\s+(day|high|low)`, not bare "swing"/"high"/"low"), so those
        # strings never reach the resolver at all — they bind to the base primitive with
        # approximation=True from an unrelated code path, which made this parametrization's
        # swing half VACUOUS: it could not fail if swing were added to
        # POPULATION_A_DEAPPROXIMATED_KINDS. The strings below DO reach the resolver, so
        # they discriminate. Verified by mutation (add "swing" to the set -> both fail).
        ("the previous low held", "swing", True),
        ("the previous high held", "swing", True),
    ],
)
def test_r9_approximation_flips_per_kind_named_sr_level_and_order_block_edge_only(obj, kind, expected_approximation):
    """R9 (Population-A flip-step, docs/designs/packet-population-a-flip-step-2026-07-20.md):
    approximation is now FALSE for every named_sr_level/order_block_edge polarity (both
    bullish- and bearish-leaning object text), and remains True for both swing polarities.
    Replaces R7 above, which this packet's own delivery falsifies for 4 of its 6 cases —
    see the module docstring's UPDATED note; R7's assertion is not silently edited, it is
    explicitly superseded here, with a PROSE header above recording what it used to assert
    and why that changed (no commented-out assertion code — see that header's accuracy
    note).

    ANTI-VACUITY (asserted, not asserted-about): every case below is checked to actually
    reach the Population-A resolver primitive. Without that check the swing rows could sit
    on object text the resolver never sees and still "pass" — the exact defect a mutation
    run (adding "swing" to POPULATION_A_DEAPPROXIMATED_KINDS) exposed in this test's
    original swing strings."""
    assert classify_population_a_kind(obj) == kind
    df = _synthetic_df(n=150, seed=3)
    cond = {"id": "s1", "type": "WAIT_STRUCTURE", "object": obj, "role": "spine"}
    with both_flags(True):
        b = bind_condition(cond)
        strat = _run_single_condition_spec(cond, df)
    assert b.primitive == LEVELZONE_RESOLVER_PRIMITIVE, (
        f"{obj!r} ({kind}) never reached the Population-A resolver (bound to {b.primitive!r}) — "
        "this case cannot testify about the per-kind approximation flip at all"
    )
    assert strat.approximation is expected_approximation, (
        f"{obj!r} ({kind}): expected approximation={expected_approximation}, got {strat.approximation}"
    )


def test_r9_deapproximated_kinds_set_names_exactly_named_sr_level_and_order_block_edge():
    """F1 evidence-at-the-flip-site proof, executable form: the exact set the code branches
    on is {"named_sr_level", "order_block_edge"} — not a superset that would silently pull
    in swing, not a subset that would under-deliver the packet's two named kinds."""
    from src.engine.spec_family_bindings import POPULATION_A_DEAPPROXIMATED_KINDS

    assert POPULATION_A_DEAPPROXIMATED_KINDS == frozenset({"named_sr_level", "order_block_edge"})
    assert "swing" not in POPULATION_A_DEAPPROXIMATED_KINDS


# ═══════════════════════════════════════════════════════════════════════════════════════
# Non-Population-A siblings in a mixed spec must be byte-identical (scope-lock proof).
# ═══════════════════════════════════════════════════════════════════════════════════════

def test_mixed_spec_only_population_a_condition_flips_others_untouched():
    spec = {
        "direction": "long",
        "entry_conditions": [
            {"id": "t1", "type": "ENABLE_ENTRY", "object": "entry", "role": "trigger"},
            {"id": "s1", "type": "WAIT_STRUCTURE", "object": "support zone", "role": "spine"},
            {"id": "s2", "type": "WAIT_STRUCTURE", "object": "reclaims the level with a lot of volume", "role": "spine"},
            {"id": "s3", "type": "WAIT_STRUCTURE", "object": "bearish candlestick", "role": "spine"},
        ],
        "invalidations": [],
        "entry_trigger_id": "t1",
    }
    with levelzone_routing(True):
        plan_off = compile_binding_plan(spec)
    with both_flags(True):
        plan_on = compile_binding_plan(spec)

    by_id_off = {b.condition_id: b for b in plan_off.bindings}
    by_id_on = {b.condition_id: b for b in plan_on.bindings}

    assert by_id_off["s1"].primitive != by_id_on["s1"].primitive
    assert by_id_on["s1"].primitive == LEVELZONE_RESOLVER_PRIMITIVE
    # s2 (bare anaphora, Population B) and s3 (non-level/zone) must be untouched.
    assert by_id_off["s2"].to_dict() == by_id_on["s2"].to_dict()
    assert by_id_off["s3"].to_dict() == by_id_on["s3"].to_dict()
