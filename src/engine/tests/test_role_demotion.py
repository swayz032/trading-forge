"""Tests for the Hard-Constraint Demotion Experiment
(docs/designs/hard-constraint-demotion-experiment-2026-07-05.md):

  - `TF_ROLE_DEMOTION_MODE` in {off, struct_conf, struct_alt, struct_ctx, struct_all, exec_all},
    default "off", byte-identical when off and for every non-demoted condition (any class not
    OPTIONAL/ALTERNATIVE/CONTEXTUAL, and any condition absent from the audit lookup).
  - struct_conf: OPTIONAL-classified conditions only -> role="confluence" (drop out of spine AND).
  - struct_ctx: CONTEXTUAL-classified conditions only -> executed=False ("metadata only" — stays
    counted as spine for provenance, never enters the per-bar gating loop).
  - struct_alt: ALTERNATIVE-classified conditions of the SAME strategy (video) merge into one
    per-strategy OR_GROUP (ANY-holds).
  - struct_all: union of the three structural classes above, single-variable (not three flags).
  - exec_all: execution-masking validation arm — same net per-bar effect as struct_all, but
    WITHOUT touching binding_plan.role/executed or or_branch/group topology (topology-artifact
    check: exec_all's entry_long/entry_short must match struct_all's, while its conjunction_depth()
    stays identical to baseline).
  - conjunction_depth(): the DAG mediator gate — must drop for struct_conf/struct_ctx/struct_all
    relative to "off"; exec_all is depth-invariant BY DESIGN (validation-only, never a mediator
    gate subject).
  - `role_demotion_audit.py` loader: fail-open on missing/malformed file, exact (video,
    condition_id) lookup, batch form, DEMOTABLE_CLASSES membership.

Run targeted (per CLAUDE.md pre-existing tower trait: bare pytest collection over the full
src/engine/tests directory hangs because some module transitively imports the vectorbt-JIT
backtester):

    python -m pytest src/engine/tests/test_role_demotion.py -v
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

from src.engine import role_demotion_audit
from src.engine.spec_condition_compiler import SpecConditionStrategy

N_BARS = 300


@contextmanager
def role_demotion_mode(mode: str):
    prior = os.environ.get("TF_ROLE_DEMOTION_MODE")
    os.environ["TF_ROLE_DEMOTION_MODE"] = mode
    try:
        yield
    finally:
        if prior is None:
            os.environ.pop("TF_ROLE_DEMOTION_MODE", None)
        else:
            os.environ["TF_ROLE_DEMOTION_MODE"] = prior


@contextmanager
def audit_fixture(tmp_path: Path, rows: list[dict]):
    """Writes a small synthetic classification table in the SAME shape as
    docs/replay-results/dri-audit-2026-07-05.json's `full_classification_table_first_pass`, points
    TF_ROLE_DEMOTION_AUDIT_PATH at it, and clears role_demotion_audit's lru_cache afterward so
    later tests (including ones pointing at the REAL committed audit file) never see a stale
    cached table keyed by a path that no longer exists."""
    path = tmp_path / "fixture-audit.json"
    path.write_text(json.dumps({"full_classification_table_first_pass": rows}), encoding="utf-8")
    prior = os.environ.get("TF_ROLE_DEMOTION_AUDIT_PATH")
    os.environ["TF_ROLE_DEMOTION_AUDIT_PATH"] = str(path)
    try:
        yield
    finally:
        if prior is None:
            os.environ.pop("TF_ROLE_DEMOTION_AUDIT_PATH", None)
        else:
            os.environ["TF_ROLE_DEMOTION_AUDIT_PATH"] = prior
        role_demotion_audit._load_classification_table.cache_clear()


def _row(video: str, condition_id: str, classification: str) -> dict:
    return {
        "video": video,
        "condition_id": condition_id,
        "type": condition_id.split(":")[0],
        "object": condition_id.split(":")[1].split("#")[0] if ":" in condition_id else "",
        "classification": classification,
        "quote": "test fixture quote",
        "rationale": "test fixture rationale",
    }


def _synthetic_df(n: int = N_BARS, seed: int = 42) -> pl.DataFrame:
    rng = np.random.default_rng(seed)
    start = datetime(2026, 1, 5, 9, 30, tzinfo=UTC)
    ts = [start + timedelta(minutes=5 * i) for i in range(n)]
    close = 5000 + np.cumsum(rng.normal(0, 1.0, n))
    high = close + rng.uniform(0.2, 1.5, n)
    low = close - rng.uniform(0.2, 1.5, n)
    open_ = close + rng.normal(0, 0.3, n)
    vol = rng.integers(500, 2000, n)
    return pl.DataFrame(
        {
            "ts_event": ts,
            "open": open_.astype(np.float64),
            "high": high.astype(np.float64),
            "low": low.astype(np.float64),
            "close": close.astype(np.float64),
            "volume": vol.astype(np.int64),
        }
    )


def _cond(cid: str, ctype: str, obj: str, role: str, span_start: int = 0) -> dict:
    return {
        "id": cid,
        "type": ctype,
        "object": obj,
        "role": role,
        "span": {"start": span_start, "end": span_start + 1},
        "evidence": f"ev-{cid}",
    }


def _spec(
    entry_conditions: list[dict],
    entry_trigger_id: str,
    direction: str = "long",
    and_groups: list[list[str]] | None = None,
    or_branches: list[list[str]] | None = None,
    invalidations: list[dict] | None = None,
) -> dict:
    return {
        "direction": direction,
        "entry_conditions": entry_conditions,
        "and_groups": and_groups or [],
        "or_branches": or_branches or [],
        "invalidations": invalidations or [],
        "entry_trigger_id": entry_trigger_id,
    }


def _strategy(spec: dict, video: str | None = "TESTVIDEO01", **kwargs) -> SpecConditionStrategy:
    compiled_spec = {"spec": spec, "spec_hash": "testhash"}
    if video is not None:
        compiled_spec["video"] = video
    return SpecConditionStrategy(compiled_spec, **kwargs)


# A 4-condition strategy touching every demotable class plus a real gate + an UNRESOLVED
# distractor, used across most tests below.
def _four_class_spec(direction: str = "long") -> dict:
    return _spec(
        [
            _cond("t1", "ENABLE_ENTRY", "entry", "trigger"),
            _cond("gate1", "WAIT_SESSION", "ny am session", "spine"),          # JUSTIFIED_MANDATORY
            _cond("opt1", "WAIT_RETEST", "level retest", "spine"),            # OPTIONAL
            _cond("ctx1", "WAIT_BIAS", "market context bias", "spine"),        # CONTEXTUAL
            _cond("unres1", "FILTER", "unclear filter", "spine"),              # UNRESOLVED
        ],
        "t1",
        direction=direction,
    )


_FOUR_CLASS_ROWS = [
    _row("TESTVIDEO01", "gate1", "JUSTIFIED_MANDATORY"),
    _row("TESTVIDEO01", "opt1", "OPTIONAL"),
    _row("TESTVIDEO01", "ctx1", "CONTEXTUAL"),
    _row("TESTVIDEO01", "unres1", "UNRESOLVED"),
]


# ═══════════════════════════════════════════════════════════════════════════
# 1. off mode is byte-identical (default; no env var at all)
# ═══════════════════════════════════════════════════════════════════════════

def test_off_mode_byte_identical_to_no_classification_present(tmp_path):
    spec = _four_class_spec()
    df = _synthetic_df()

    strat_no_audit = _strategy(spec)
    out_no_audit = strat_no_audit.compute(df)

    with audit_fixture(tmp_path, _FOUR_CLASS_ROWS):
        strat_off = _strategy(spec)  # TF_ROLE_DEMOTION_MODE unset -> "off"
        out_off = strat_off.compute(df)

    assert out_no_audit["entry_long"].to_list() == out_off["entry_long"].to_list()
    assert out_no_audit["entry_short"].to_list() == out_off["entry_short"].to_list()
    assert [b.role for b in strat_no_audit.binding_plan.bindings] == [b.role for b in strat_off.binding_plan.bindings]
    assert [b.executed for b in strat_no_audit.binding_plan.bindings] == [b.executed for b in strat_off.binding_plan.bindings]


def test_explicit_off_mode_byte_identical_even_with_audit_present(tmp_path):
    spec = _four_class_spec()
    df = _synthetic_df()
    with audit_fixture(tmp_path, _FOUR_CLASS_ROWS):
        with role_demotion_mode("off"):
            strat = _strategy(spec)
            out = strat.compute(df)
        baseline = _strategy(spec)
        out_baseline = baseline.compute(df)
    assert out["entry_long"].to_list() == out_baseline["entry_long"].to_list()
    assert out["entry_short"].to_list() == out_baseline["entry_short"].to_list()


# ═══════════════════════════════════════════════════════════════════════════
# 2. struct_conf — OPTIONAL only
# ═══════════════════════════════════════════════════════════════════════════

def test_struct_conf_demotes_only_optional_role_to_confluence(tmp_path):
    spec = _four_class_spec()
    with audit_fixture(tmp_path, _FOUR_CLASS_ROWS):
        with role_demotion_mode("struct_conf"):
            strat = _strategy(spec)
    roles = {b.condition_id: b.role for b in strat.binding_plan.bindings}
    assert roles["opt1"] == "confluence", "OPTIONAL must be demoted to confluence"
    assert roles["gate1"] == "spine", "JUSTIFIED_MANDATORY must stay spine"
    assert roles["ctx1"] == "spine", "CONTEXTUAL role is untouched by struct_conf (only struct_ctx touches it)"
    assert roles["unres1"] == "spine", "UNRESOLVED is held out — never demoted"


def test_struct_conf_optional_no_longer_gates_entries(tmp_path):
    """opt1 = WAIT_RETEST (level retest) — with only ~30 warmup bars of level data, its own
    per-bar array is mostly False early on. Demoting it to confluence must REMOVE it from the
    spine AND — entries after demotion must equal the AND of the REMAINING spine conditions,
    never gated by opt1's necessarily-false-heavy retest array."""
    spec = _spec(
        [
            _cond("t1", "ENABLE_ENTRY", "entry", "trigger"),
            _cond("gate1", "WAIT_SESSION", "ny am session", "spine"),
            _cond("opt1", "WAIT_RETEST", "level retest", "spine"),
        ],
        "t1",
        direction="long",
    )
    df = _synthetic_df()
    rows = [_row("TESTVIDEO01", "opt1", "OPTIONAL")]

    with audit_fixture(tmp_path, rows):
        baseline = _strategy(spec)
        out_baseline = baseline.compute(df)
        with role_demotion_mode("struct_conf"):
            demoted = _strategy(spec)
            out_demoted = demoted.compute(df)

    gate1_arr = demoted.last_per_condition_bool["gate1"]
    assert "opt1" not in demoted.last_per_condition_bool, "confluence-role bindings never enter the spine gating loop"
    expected = np.zeros(len(df), dtype=bool)
    expected[0] = gate1_arr[0]
    expected[1:] = gate1_arr[1:] & ~gate1_arr[:-1]
    assert out_demoted["entry_long"].to_list() == expected.tolist()
    # Sanity: baseline (opt1 still in spine AND) must NOT equal the demoted result in general —
    # confirms the demotion actually changed behavior rather than being a silent no-op.
    assert out_baseline["entry_long"].to_list() != out_demoted["entry_long"].to_list() or not any(out_baseline["entry_long"].to_list())


# ═══════════════════════════════════════════════════════════════════════════
# 3. struct_ctx — CONTEXTUAL only
# ═══════════════════════════════════════════════════════════════════════════

def test_struct_ctx_demotes_only_contextual_to_unexecuted(tmp_path):
    spec = _four_class_spec()
    with audit_fixture(tmp_path, _FOUR_CLASS_ROWS):
        with role_demotion_mode("struct_ctx"):
            strat = _strategy(spec)
    by_id = {b.condition_id: b for b in strat.binding_plan.bindings}
    assert by_id["ctx1"].executed is False, "CONTEXTUAL must be forced unexecuted"
    assert by_id["ctx1"].role == "spine", "CONTEXTUAL role is UNCHANGED — 'metadata only', not moved to confluence"
    assert by_id["opt1"].executed is True, "OPTIONAL is untouched by struct_ctx (only struct_conf touches it)"
    assert by_id["gate1"].executed is True


def test_struct_ctx_contextual_never_enters_gating_loop(tmp_path):
    spec = _four_class_spec()
    df = _synthetic_df()
    with audit_fixture(tmp_path, _FOUR_CLASS_ROWS):
        with role_demotion_mode("struct_ctx"):
            strat = _strategy(spec)
            strat.compute(df)
    assert "ctx1" not in strat.last_per_condition_bool, "executed=False bindings must never enter per_condition_bool"


# ═══════════════════════════════════════════════════════════════════════════
# 4. struct_alt — ALTERNATIVE grouping
# ═══════════════════════════════════════════════════════════════════════════

def test_struct_alt_merges_multi_member_alternatives_via_or():
    """Two ALTERNATIVE-classified conditions in the SAME strategy, exact complements of the same
    EMA-lean signal (bullish/bearish bias) — AND is always False, OR is always True. This makes
    the demotion's ANY-holds effect mathematically crisp, mirroring the or_branches honoring
    fix's own regression-test pattern."""
    spec = _spec(
        [
            _cond("t1", "ENABLE_ENTRY", "entry", "trigger"),
            _cond("alt1", "WAIT_BIAS", "bullish bias", "spine"),
            _cond("alt2", "WAIT_BIAS", "bearish bias", "spine"),
        ],
        "t1",
        direction="long",
    )
    df = _synthetic_df()
    rows = [
        role_demotion_audit_row := _row("TESTVIDEO01", "alt1", "ALTERNATIVE"),
        _row("TESTVIDEO01", "alt2", "ALTERNATIVE"),
    ]
    import os as _os
    from pathlib import Path as _Path
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        with audit_fixture(_Path(td), rows):
            baseline = _strategy(spec)
            out_baseline = baseline.compute(df)
            with role_demotion_mode("struct_alt"):
                demoted = _strategy(spec)
                out_demoted = demoted.compute(df)

    assert not any(out_baseline["entry_long"].to_list()), "baseline: AND(bullish, bearish) always False -> never fires"
    assert any(out_demoted["entry_long"].to_list()), "struct_alt: OR(bullish, bearish) always True -> must fire"
    assert demoted._demotion_or_branch_of_condition == {"alt1": 0, "alt2": 0}


def test_struct_alt_singleton_alternative_is_honest_no_op_on_depth(tmp_path):
    """When a strategy has exactly ONE ALTERNATIVE-classified condition (the common case in the
    real 14-video audited sample — no sibling to OR with), struct_alt must NOT fabricate a
    synthetic always-true partner. OR of a single term equals that term — conjunction_depth() is
    UNCHANGED for this specific condition, and that is the honest, correct, real result (not a
    bug) — see the module docstring in spec_condition_compiler.py."""
    spec = _spec(
        [
            _cond("t1", "ENABLE_ENTRY", "entry", "trigger"),
            _cond("gate1", "WAIT_SESSION", "ny am session", "spine"),
            _cond("alt1", "WAIT_BIAS", "bullish bias", "spine"),
        ],
        "t1",
        direction="long",
    )
    rows = [_row("TESTVIDEO01", "alt1", "ALTERNATIVE")]
    with audit_fixture(tmp_path, rows):
        baseline = _strategy(spec)
        with role_demotion_mode("struct_alt"):
            demoted = _strategy(spec)
    assert baseline.conjunction_depth() == demoted.conjunction_depth() == 2


# ═══════════════════════════════════════════════════════════════════════════
# 5. struct_all — union of all three structural classes
# ═══════════════════════════════════════════════════════════════════════════

def test_struct_all_applies_all_three_classes_simultaneously(tmp_path):
    spec = _four_class_spec()
    with audit_fixture(tmp_path, _FOUR_CLASS_ROWS):
        with role_demotion_mode("struct_all"):
            strat = _strategy(spec)
    by_id = {b.condition_id: b for b in strat.binding_plan.bindings}
    assert by_id["opt1"].role == "confluence"
    assert by_id["ctx1"].executed is False
    assert by_id["gate1"].role == "spine" and by_id["gate1"].executed is True
    assert by_id["unres1"].role == "spine" and by_id["unres1"].executed is True


def test_struct_all_depth_drops_relative_to_off(tmp_path):
    spec = _four_class_spec()
    with audit_fixture(tmp_path, _FOUR_CLASS_ROWS):
        baseline = _strategy(spec)
        with role_demotion_mode("struct_all"):
            demoted = _strategy(spec)
    depth_off = baseline.conjunction_depth()
    depth_all = demoted.conjunction_depth()
    # off: gate1, opt1, ctx1, unres1 all executed-spine, no or groups -> depth 4.
    # struct_all: opt1 -> confluence (drops), ctx1 -> unexecuted (drops) -> depth 2 (gate1, unres1).
    assert depth_off == 4
    assert depth_all == 2
    assert depth_all < depth_off, "mediator gate: struct_all must materially drop conjunction depth"


# ═══════════════════════════════════════════════════════════════════════════
# 6. exec_all — execution-masking validation arm (topology-artifact check)
# ═══════════════════════════════════════════════════════════════════════════

def test_exec_all_matches_struct_all_entries_but_preserves_topology(tmp_path):
    spec = _four_class_spec()
    df = _synthetic_df()
    with audit_fixture(tmp_path, _FOUR_CLASS_ROWS):
        baseline = _strategy(spec)
        out_baseline = baseline.compute(df)

        with role_demotion_mode("struct_all"):
            struct_strat = _strategy(spec)
            out_struct = struct_strat.compute(df)

        with role_demotion_mode("exec_all"):
            exec_strat = _strategy(spec)
            out_exec = exec_strat.compute(df)

    # Topology-artifact check: same net behavioral result...
    assert out_struct["entry_long"].to_list() == out_exec["entry_long"].to_list()
    assert out_struct["entry_short"].to_list() == out_exec["entry_short"].to_list()

    # ...but exec_all's binding_plan is BYTE-IDENTICAL to baseline (role/executed untouched).
    baseline_shape = [(b.condition_id, b.role, b.executed) for b in baseline.binding_plan.bindings]
    exec_shape = [(b.condition_id, b.role, b.executed) for b in exec_strat.binding_plan.bindings]
    assert baseline_shape == exec_shape

    # ...and struct_all's binding_plan IS different from baseline (the actual structural change).
    struct_shape = [(b.condition_id, b.role, b.executed) for b in struct_strat.binding_plan.bindings]
    assert struct_shape != baseline_shape


def test_exec_all_conjunction_depth_equals_baseline_by_design(tmp_path):
    spec = _four_class_spec()
    with audit_fixture(tmp_path, _FOUR_CLASS_ROWS):
        baseline = _strategy(spec)
        with role_demotion_mode("exec_all"):
            exec_strat = _strategy(spec)
    assert exec_strat.conjunction_depth() == baseline.conjunction_depth() == 4, (
        "exec_all preserves structure by design — the mediator gate is evaluated on struct_all, "
        "never on exec_all"
    )


# ═══════════════════════════════════════════════════════════════════════════
# 7. UNRESOLVED / JUSTIFIED_MANDATORY held out under EVERY mode
# ═══════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("mode", ["struct_conf", "struct_alt", "struct_ctx", "struct_all", "exec_all"])
def test_unresolved_and_justified_mandatory_never_demoted(tmp_path, mode):
    spec = _four_class_spec()
    df = _synthetic_df()
    with audit_fixture(tmp_path, _FOUR_CLASS_ROWS):
        baseline = _strategy(spec)
        baseline.compute(df)
        with role_demotion_mode(mode):
            strat = _strategy(spec)
            strat.compute(df)

    by_id = {b.condition_id: b for b in strat.binding_plan.bindings}
    assert by_id["gate1"].role == "spine" and by_id["gate1"].executed is True
    assert by_id["unres1"].role == "spine" and by_id["unres1"].executed is True
    if mode != "exec_all":
        # exec_all masks per-bar arrays without touching last_per_condition_bool membership for
        # non-demoted classes either — gate1/unres1 arrays must be byte-identical to baseline.
        assert np.array_equal(baseline.last_per_condition_bool["gate1"], strat.last_per_condition_bool.get("gate1", baseline.last_per_condition_bool["gate1"]))


# ═══════════════════════════════════════════════════════════════════════════
# 8. video missing from compiled_spec -> demotion inert regardless of mode
# ═══════════════════════════════════════════════════════════════════════════

def test_missing_video_disables_demotion_entirely(tmp_path):
    spec = _four_class_spec()
    df = _synthetic_df()
    with audit_fixture(tmp_path, _FOUR_CLASS_ROWS):
        with role_demotion_mode("struct_all"):
            strat_no_video = _strategy(spec, video=None)
            out_no_video = strat_no_video.compute(df)

        no_audit_baseline = _strategy(spec, video=None)
        out_baseline = no_audit_baseline.compute(df)

    assert strat_no_video._demotion_classifications == {}
    assert out_no_video["entry_long"].to_list() == out_baseline["entry_long"].to_list()


# ═══════════════════════════════════════════════════════════════════════════
# 9. role_demotion_audit.py loader — direct unit tests
# ═══════════════════════════════════════════════════════════════════════════

def test_loader_get_classification_exact_match(tmp_path):
    rows = [_row("V1", "WAIT_SESSION:foo#0", "OPTIONAL")]
    with audit_fixture(tmp_path, rows):
        assert role_demotion_audit.get_classification("V1", "WAIT_SESSION:foo#0") == "OPTIONAL"
        assert role_demotion_audit.get_classification("V1", "WAIT_SESSION:bar#0") is None
        assert role_demotion_audit.get_classification("V2", "WAIT_SESSION:foo#0") is None


def test_loader_get_classifications_for_video_batch(tmp_path):
    rows = [
        _row("V1", "a#0", "OPTIONAL"),
        _row("V1", "b#0", "CONTEXTUAL"),
        _row("V2", "a#0", "ALTERNATIVE"),  # different video, same condition_id string -> disjoint
    ]
    with audit_fixture(tmp_path, rows):
        result = role_demotion_audit.get_classifications_for_video("V1", ["a#0", "b#0", "missing#0"])
    assert result == {"a#0": "OPTIONAL", "b#0": "CONTEXTUAL"}


def test_loader_fails_open_on_missing_file():
    prior = os.environ.get("TF_ROLE_DEMOTION_AUDIT_PATH")
    os.environ["TF_ROLE_DEMOTION_AUDIT_PATH"] = "docs/replay-results/this-file-does-not-exist-12345.json"
    try:
        role_demotion_audit._load_classification_table.cache_clear()
        assert role_demotion_audit.get_classification("V1", "a#0") is None
        assert role_demotion_audit.get_classifications_for_video("V1", ["a#0"]) == {}
    finally:
        if prior is None:
            os.environ.pop("TF_ROLE_DEMOTION_AUDIT_PATH", None)
        else:
            os.environ["TF_ROLE_DEMOTION_AUDIT_PATH"] = prior
        role_demotion_audit._load_classification_table.cache_clear()


def test_loader_falls_open_on_empty_args():
    assert role_demotion_audit.get_classification("", "a#0") is None
    assert role_demotion_audit.get_classification("V1", "") is None
    assert role_demotion_audit.get_classifications_for_video("", ["a#0"]) == {}


@pytest.mark.parametrize(
    "classification,expected",
    [
        ("OPTIONAL", True),
        ("ALTERNATIVE", True),
        ("CONTEXTUAL", True),
        ("JUSTIFIED_MANDATORY", False),
        ("UNRESOLVED", False),
        (None, False),
        ("TYPO_NOT_A_REAL_CLASS", False),
    ],
)
def test_is_demotable(classification, expected):
    assert role_demotion_audit.is_demotable(classification) is expected


# ═══════════════════════════════════════════════════════════════════════════
# 10. Real committed audit file sanity check (not a re-judgement — just confirms the loader
#     can actually read the pre-registered artifact this whole experiment is keyed on).
# ═══════════════════════════════════════════════════════════════════════════

def test_real_committed_audit_file_loads_and_resolves_known_row():
    role_demotion_audit._load_classification_table.cache_clear()
    os.environ.pop("TF_ROLE_DEMOTION_AUDIT_PATH", None)
    cls = role_demotion_audit.get_classification("75DJN5UVQnw", "WAIT_SESSION:timeframe selection#0")
    assert cls == "ALTERNATIVE"
