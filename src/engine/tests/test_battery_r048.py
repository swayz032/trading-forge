"""R-048 regression tests — the strict-key guard, SUPERSEDED_BY_REMAP annotation,
and effective-N dedup (grader F-3: the commit's "Verified:" prose owed persisted,
re-runnable evidence). All pure-stdlib, temp-file only — no DB, network, or S3.

Covers:
  * mapping_guard.require       — raises on missing key, returns present (incl None)
  * TrialCounter.annotate_superseded — append-only, idempotent, scoped, backfill
  * TrialCounter.effective_n     — collapse, ABORTED-exclusion, F-2 incomplete-tuple
  * PassageLedger.annotate_superseded — append-only annotation
"""
from __future__ import annotations

import importlib.util
import os
import sys
import tempfile

import pytest

_BATTERY = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "battery")
)


def _load(mod: str):
    path = os.path.join(_BATTERY, f"{mod}.py")
    spec = importlib.util.spec_from_file_location(f"_r048_{mod}", path)
    m = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = m
    spec.loader.exec_module(m)
    return m


mapping_guard = _load("mapping_guard")
tc_mod = _load("trial_counter")
pl_mod = _load("passage_ledger")


# ------------------------------------------------------------------ #
# R-048 §2 — strict-key guard
# ------------------------------------------------------------------ #
def test_require_returns_present_value():
    assert mapping_guard.require({"k": 7}, "k", "ctx") == 7


def test_require_returns_present_none_verbatim():
    # None is a legitimate signal — a PRESENT null must NOT raise.
    assert mapping_guard.require({"k": None}, "k", "ctx") is None


def test_require_raises_on_missing_key():
    with pytest.raises(mapping_guard.MappingSchemaError) as ei:
        mapping_guard.require({"other": 1}, "k", "the-context")
    # the error names the key and the context (visible, diagnosable)
    assert "'k'" in str(ei.value) and "the-context" in str(ei.value)


def test_mapping_schema_error_is_runtime_error():
    # runner's `except Exception` catches it -> visible ABORTED, not a crash
    assert issubclass(mapping_guard.MappingSchemaError, RuntimeError)


# ------------------------------------------------------------------ #
# helpers
# ------------------------------------------------------------------ #
def _counter():
    d = tempfile.mkdtemp()
    return tc_mod.TrialCounter(os.path.join(d, "c.json"), engine_sha_at_zero="ENG")


def _alloc(c, ref, spec_hash, *, ds=None, cfg=None, outcome="FAIL"):
    t = c.allocate(wave="w", strategy_ref=ref, spec_hash=spec_hash, engine_sha="ENG",
                   binding_approximation_rate=0.9, dataset_hash=ds, config_hash=cfg)
    if outcome is not None:
        c.finalize(t, outcome)
    return t


# ------------------------------------------------------------------ #
# R-048 §3a — annotate_superseded (append-only)
# ------------------------------------------------------------------ #
def test_annotate_superseded_is_append_only():
    c = _counter()
    _alloc(c, "specA", "hA")            # buggy (null tuple)
    _alloc(c, "specB", "hB")
    ids_before = [r["trial_id"] for r in c._doc["runs"]]
    outcomes_before = [r["outcome"] for r in c._doc["runs"]]

    n = c.annotate_superseded(wave="w", by="AR-044",
                              predicate=lambda r: r.get("config_hash") is None,
                              backfill_dataset_hash="DS", backfill_config_hash="CFG")

    assert n == 2
    # nothing deleted, no id changed, no outcome changed
    assert [r["trial_id"] for r in c._doc["runs"]] == ids_before
    assert [r["outcome"] for r in c._doc["runs"]] == outcomes_before
    assert c.total_trials == 2
    for r in c._doc["runs"]:
        assert r["superseded_by_remap"]["by"] == "AR-044"
        assert r["dataset_hash"] == "DS" and r["config_hash"] == "CFG"  # backfilled


def test_annotate_superseded_idempotent():
    c = _counter()
    _alloc(c, "specA", "hA")

    def pred(r):
        return r.get("config_hash") is None

    c.annotate_superseded(wave="w", by="AR-044", predicate=pred,
                          backfill_dataset_hash="DS", backfill_config_hash="CFG")
    # after backfill, the predicate matches nothing -> 0 re-stamps
    n2 = c.annotate_superseded(wave="w", by="AR-044", predicate=pred,
                               backfill_dataset_hash="DS", backfill_config_hash="CFG")
    assert n2 == 0
    assert c.total_trials == 1


def test_annotate_superseded_backfill_never_overwrites_recorded_identity():
    c = _counter()
    _alloc(c, "specA", "hA", ds="REAL_DS", cfg="REAL_CFG")  # already stamped
    c.annotate_superseded(wave="w", by="AR-044", strategy_ref="specA",
                          backfill_dataset_hash="WRONG", backfill_config_hash="WRONG")
    r = c._doc["runs"][0]
    assert r["dataset_hash"] == "REAL_DS" and r["config_hash"] == "REAL_CFG"


# ------------------------------------------------------------------ #
# R-048 §3b — effective_n
# ------------------------------------------------------------------ #
def test_effective_n_buggy_and_corrected_collapse_by_construction():
    c = _counter()
    # buggy run (null tuple) then backfill to the TRUE experiment identity
    _alloc(c, "specA", "hA")
    _alloc(c, "specB", "hB")
    c.annotate_superseded(wave="w", by="AR-044",
                          predicate=lambda r: r.get("config_hash") is None,
                          backfill_dataset_hash="DS", backfill_config_hash="CFG")
    # corrected re-run: SAME experiment
    _alloc(c, "specA", "hA", ds="DS", cfg="CFG")
    _alloc(c, "specB", "hB", ds="DS", cfg="CFG")

    eff = c.effective_n(wave="w")
    assert eff["raw_n"] == 4            # nothing deleted
    assert eff["effective_n"] == 2      # buggy+corrected of each spec collapse
    assert eff["collapsed_replicates"] == 2
    assert eff["incomplete_tuple_n"] == 0


def test_effective_n_synthetic_data_stays_distinct():
    c = _counter()
    _alloc(c, "specA", "hA", ds="DS", cfg="CFG")
    _alloc(c, "specA", "hA", ds="SYNTH", cfg="SHAKE")  # different data+config
    eff = c.effective_n(wave="w")
    assert eff["effective_n"] == 2 and eff["collapsed_replicates"] == 0


def test_effective_n_excludes_aborted_from_denominator():
    c = _counter()
    _alloc(c, "specA", "hA", ds="DS", cfg="CFG")
    _alloc(c, "specB", "hB", ds="DS", cfg="CFG", outcome=None)  # left ABORTED
    eff = c.effective_n(wave="w")
    assert eff["raw_n"] == 2            # ABORTED retained in raw
    assert eff["aborted_n"] == 1
    assert eff["executed_n"] == 1
    assert eff["effective_n"] == 1      # only the executed draw counts


def test_effective_n_incomplete_tuples_never_collapse_F2():
    c = _counter()
    # two legacy rows, same spec+engine, BOTH null tuple (never backfilled)
    _alloc(c, "specA", "hA")
    _alloc(c, "specA", "hA")
    eff = c.effective_n(wave="w")
    # F-2: they must NOT collapse (not provably the same experiment)
    assert eff["effective_n"] == 2
    assert eff["incomplete_tuple_n"] == 2
    assert eff["collapsed_replicates"] == 0


# ------------------------------------------------------------------ #
# R-048 §3a — passage ledger annotation
# ------------------------------------------------------------------ #
def test_ledger_annotate_superseded_append_only():
    d = tempfile.mkdtemp()
    led = pl_mod.PassageLedger(os.path.join(d, "l.json"))
    led.record(wave="w", strategy_ref="specA", spec_hash="hA", engine_sha="ENG",
               gate="cpcv", received=True, fired=True, verdict=pl_mod.VERDICT_PASS,
               binding_approximation_rate=0.9)
    n_before = len(led._doc["rows"])
    n = led.annotate_superseded(wave="w", by="AR-044",
                                predicate=lambda r: r.get("config_hash") is None,
                                backfill_dataset_hash="DS", backfill_config_hash="CFG")
    assert n == 1
    assert len(led._doc["rows"]) == n_before      # nothing added/removed
    row = led._doc["rows"][0]
    assert row["superseded_by_remap"]["by"] == "AR-044"
    assert row["dataset_hash"] == "DS" and row["config_hash"] == "CFG"
    assert row["engagement_receipt"]["verdict"] == pl_mod.VERDICT_PASS  # verdict untouched
    assert row["fired"] is True and row["received"] is True             # alarm inputs untouched
