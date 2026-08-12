"""MP1-CANDIDATE-INGRESS-1 — the PYTHON end of the candidate-identity seam.

AUTHORITY: ruling AR-1031 (gpt-rulings `f98dc291`) §4 REPAIR C, §5 controls 3, 4, 5, 6.

WHAT THIS PINS
--------------
`/api/backtests` now threads four DB-authoritative fields into the config JSON:
`execution_candidate_id`, `execution_candidate_cache_identity`,
`execution_candidate_receipt`, `execution_candidate_parent_spec_hash`. This file
proves the engine turns those back into a PROVEN identity — or refuses out loud —
before any market data is loaded.

🛑 THE RECEIPTS HERE ARE REAL. They are minted by `plan_candidate_rows()` from the
frozen golden provenance record, the same helper `test_mp1_candidate_persistence.py`
uses. A hand-built receipt would prove only that this file can build a dict, and a
hand-built fixture has already lied on this desk once (`[ps-counting-encoding]`).

🛑 CONTROL 6 USES THE REAL TRANSPORT. `python-runner.ts` serialises the config to a
temp JSON file and invokes the engine with it; `main()` re-reads that file at
`os.path.isfile(config_input)`. So the transport witness writes a real file and calls
the real `main()`. It does NOT validate a locally reconstructed copy, which AR-1031 §5[6]
explicitly excludes.

⚠️ THE TRAP THIS FILE IS BUILT AGAINST — `[main-spy-both-arms]`: this box has no market
data, so a backtest fails LATE for reasons that have nothing to do with candidate
identity. A refusal spy that reads "refused" on both arms would look like a perfect
gate while proving nothing. Every refusal assertion below is therefore paired with a
DISCRIMINATING arm that must NOT carry the candidate refusal reason.

    `A GATE THAT REFUSES EVERYTHING IS INDISTINGUISHABLE FROM A GATE THAT REFUSES
     NOTHING, UNTIL SOMETHING IS ALLOWED THROUGH.`
"""

from __future__ import annotations

import contextlib
import io
import json
import pathlib

import pytest

import src.engine.backtester as bt
from src.engine.extraction.spec_producer import produce_spec_artifact_from_record
from src.engine.opening_range_candidate_persistence import plan_candidate_rows
from src.engine.opening_range_lowering import COMMITTED_PROVENANCE_DIR
from src.engine.spec_condition_compiler import EXECUTION_STATUS_REFUSED

GOLDEN_STUB = "st5e-YJRfKc__s0"
SYMBOL = "MES"

CANDIDATE_REFUSAL_REASON = "candidate_authority_unproven"


def _record(stub: str) -> dict:
    path = pathlib.Path(COMMITTED_PROVENANCE_DIR) / f"{stub}.json"
    assert path.exists(), f"frozen provenance record missing: {path}"
    return json.loads(path.read_text(encoding="utf-8"))


def _real_rows():
    """The three REAL taught candidate rows, receipts and all."""
    compiled = produce_spec_artifact_from_record(_record(GOLDEN_STUB), video=GOLDEN_STUB)
    rows = plan_candidate_rows(compiled, symbol=SYMBOL)
    assert len(rows) >= 2, (
        "POSITIVE CONTROL FAILED: the golden record must plan at least two taught "
        f"candidates for the swap arm to mean anything; got {len(rows)}"
    )
    return rows


def _sidecar(row) -> dict:
    """Exactly what the repaired route threads into the config."""
    return {
        "execution_candidate_id": row.candidate_id,
        "execution_candidate_cache_identity": row.cache_identity,
        "execution_candidate_receipt": row.receipt,
        "execution_candidate_parent_spec_hash": row.parent_spec_hash,
    }


def _config(sidecar: dict) -> dict:
    return {
        "start_date": "2024-01-01",
        "end_date": "2024-02-01",
        "strategy": {
            "name": "OR golden",
            "symbol": SYMBOL,
            "timeframe": "5m",
            "indicators": [],
            "entry_long": "close > open",
            "entry_short": "close < open",
            "exit": "bar_index > 10",
            "stop_loss": {"type": "atr", "multiplier": 2.0},
            "position_size": {"type": "fixed", "fixed_contracts": 1},
        },
        **sidecar,
    }


def _assert_candidate_refusal(envelope, *, because: str):
    assert envelope is not None, f"expected a REFUSED envelope ({because}), got None (proceed)"
    assert envelope["execution_status"] == EXECUTION_STATUS_REFUSED
    assert envelope["refusal"]["reason"] == CANDIDATE_REFUSAL_REASON
    assert envelope["entry_eligible"] is False
    assert envelope["governance_labels"]["candidate_authority_proven"] is False
    # A refusal must never ship analytical products.
    assert "sharpe" in envelope["metrics_omitted"]


# ══════════════════════════════════════════════════════════════════════════════
# §5 control 1 — the happy path PROCEEDS. This is the discriminating arm for
# every refusal below: without it, a gate that refused everything would pass.
# ══════════════════════════════════════════════════════════════════════════════
def test_control_1_a_real_candidate_row_is_proven_and_proceeds():
    for row in _real_rows():
        cfg = _config(_sidecar(row))
        assert bt.validate_candidate_authority(cfg) is None, (
            f"a genuine taught candidate was refused: {row.candidate_id}"
        )


# ══════════════════════════════════════════════════════════════════════════════
# §5 control 5 — legacy stays legacy (REPAIR D)
# ══════════════════════════════════════════════════════════════════════════════
def test_control_5_a_legacy_config_carries_no_candidate_and_is_untouched():
    cfg = _config({})
    assert bt.validate_candidate_authority(cfg) is None
    # And nothing was minted onto it.
    for key in (
        "execution_candidate_id",
        "execution_candidate_cache_identity",
        "execution_candidate_receipt",
        "execution_candidate_parent_spec_hash",
    ):
        assert key not in cfg, f"legacy config grew a candidate field: {key}"


# ══════════════════════════════════════════════════════════════════════════════
# §5 control 3 — partial sidecar refuses, no defaults
# ══════════════════════════════════════════════════════════════════════════════
@pytest.mark.parametrize(
    "dropped",
    [
        "execution_candidate_id",
        "execution_candidate_cache_identity",
        "execution_candidate_receipt",
        "execution_candidate_parent_spec_hash",
    ],
)
def test_control_3_a_partial_sidecar_is_refused(dropped):
    row = _real_rows()[0]
    sidecar = _sidecar(row)
    del sidecar[dropped]
    envelope = bt.validate_candidate_authority(_config(sidecar))
    _assert_candidate_refusal(envelope, because=f"{dropped} is missing")
    assert dropped in envelope["refusal"]["detail"], (
        "the refusal must NAME the missing anchor, not merely report that something failed"
    )


def test_control_3b_a_receipt_with_no_outer_identity_is_not_mistaken_for_legacy():
    # The dangerous middle state: a receipt arrives with no anchors to check it
    # against. Reading that as "legacy" would execute an unproven candidate.
    row = _real_rows()[0]
    envelope = bt.validate_candidate_authority(
        _config({"execution_candidate_receipt": row.receipt})
    )
    _assert_candidate_refusal(envelope, because="receipt present, all anchors absent")


# ══════════════════════════════════════════════════════════════════════════════
# §5 control 4 — swapped receipt / identity mismatch
# ══════════════════════════════════════════════════════════════════════════════
def test_control_4_candidate_A_row_carrying_candidate_B_receipt_is_refused():
    rows = _real_rows()
    a, b = rows[0], rows[1]
    assert a.candidate_id != b.candidate_id  # positive control: they really differ

    sidecar = _sidecar(a)
    sidecar["execution_candidate_receipt"] = b.receipt  # B's receipt on A's identity
    _assert_candidate_refusal(
        bt.validate_candidate_authority(_config(sidecar)),
        because="the receipt belongs to a different taught candidate",
    )


def test_control_4b_a_swapped_cache_identity_is_refused():
    rows = _real_rows()
    a, b = rows[0], rows[1]
    assert a.cache_identity != b.cache_identity

    sidecar = _sidecar(a)
    sidecar["execution_candidate_cache_identity"] = b.cache_identity
    _assert_candidate_refusal(
        bt.validate_candidate_authority(_config(sidecar)),
        because="cache identity describes a different version of the candidate",
    )


def test_control_4c_a_foreign_parent_spec_hash_is_refused():
    row = _real_rows()[0]
    sidecar = _sidecar(row)
    sidecar["execution_candidate_parent_spec_hash"] = "not-the-parent-that-certified-it"
    _assert_candidate_refusal(
        bt.validate_candidate_authority(_config(sidecar)),
        because="a child cannot be joined back to a spec that did not certify it",
    )


# ══════════════════════════════════════════════════════════════════════════════
# §5 control 6 — TRANSPORT WITNESS, through the real config file + real main()
# ══════════════════════════════════════════════════════════════════════════════
class _ReachedMarketData(BaseException):
    """Sentinel: execution got past the candidate gate and into data loading."""


def _run_main(cfg: dict, tmp_path: pathlib.Path, monkeypatch) -> tuple[str, bool]:
    """Drive the REAL `main()` over the REAL on-disk config transport.

    ⚠️ `bt.main` is a `click.Command`, so calling it directly would parse argv and
    exit. `.callback` is the undecorated function the CLI actually invokes — the
    same code path, without the argv layer (`[main-spy-both-arms]`).

    ⚠️ `load_ohlcv` is stubbed to raise, for two reasons. It makes the run OFFLINE
    and deterministic — `src/engine/conftest.py:29` sets `TF_ALLOW_FIXED_1=true`, so
    under pytest an accepted config runs on to a live S3 fetch. And it converts
    "did we get past the gate" from an inference about a downstream error message
    into a DIRECT observation: the returned flag says whether market data was
    reached at all.

    Returns `(stdout, reached_market_data)`.
    """
    reached = {"v": False}

    def _stub_load_ohlcv(*_a, **_k):
        reached["v"] = True
        raise _ReachedMarketData()

    monkeypatch.setattr(bt, "load_ohlcv", _stub_load_ohlcv)

    tmp_path.mkdir(parents=True, exist_ok=True)
    path = tmp_path / "config.json"
    path.write_text(json.dumps(cfg), encoding="utf-8")
    buf = io.StringIO()
    try:
        with contextlib.redirect_stdout(buf):
            bt.main.callback(
                config_input=str(path),
                backtest_id=None,
                mode="single",
                strategy_class=None,
                run_b15_battery_flag=False,
                exit_engine="static_styleC",
            )
    except BaseException:
        # Arm B is EXPECTED to stop at the sentinel. Where it stopped is the finding.
        pass
    return buf.getvalue(), reached["v"]


def test_control_6_transport_witness_one_mutated_field_is_visible_at_python_validation(
    tmp_path, monkeypatch
):
    row = _real_rows()[0]

    # ── ARM A: mutate exactly ONE sidecar field at the seam ──────────────────
    tampered = _sidecar(row)
    tampered["execution_candidate_cache_identity"] = "tampered-in-transit"
    out_a, reached_a = _run_main(_config(tampered), tmp_path / "a", monkeypatch)

    assert CANDIDATE_REFUSAL_REASON in out_a, (
        "the mutation did not survive the real transport into Python validation"
    )
    parsed = json.loads(out_a.strip().splitlines()[-1])
    assert parsed["execution_status"] == EXECUTION_STATUS_REFUSED
    # The EXACT mutation must be attributable, not merely 'something was wrong'.
    assert "cache_identity" in parsed["refusal"]["detail"]
    # AR-1031 §4 REPAIR C: refused BEFORE market data, not after.
    assert reached_a is False, (
        "the refusal happened only AFTER market data was loaded; the gate is not at "
        "the earliest trustworthy boundary"
    )

    # ── ARM B: the DISCRIMINATING control — untampered, same transport ───────
    out_b, reached_b = _run_main(_config(_sidecar(row)), tmp_path / "b", monkeypatch)

    # POSITIVE WITNESS, observed rather than inferred. Without it, a crash BEFORE
    # the gate would satisfy the `not in` assertion vacuously — an absence proven
    # by a path that never ran. `[absence-claim]`
    assert reached_b is True, (
        "arm B never reached market data, so it cannot witness that the gate let an "
        f"untampered candidate through.\n  stdout: {out_b[:400]}"
    )
    assert CANDIDATE_REFUSAL_REASON not in out_b, (
        "the candidate gate refused an untampered row, so arm A proved nothing: "
        "a gate that refuses both arms is not a gate.\n"
        f"  arm B stdout (truncated): {out_b[:400]}"
    )


# ══════════════════════════════════════════════════════════════════════════════
# MP2-COMPILED-SPEC-INGRESS-1 — §5[5] PYTHON DISPATCH WITNESS
# Ruling AR-1033 (gpt-rulings 2f072e5b).
#
# `backtester.py:8490` dispatches on `config.get("compiled_spec")` into
# `from_compiled_spec(...)` (`:8511`) — the Band C condition-family path. Before
# MP2 the route never carried the artifact, so that branch was unreachable through
# `/api/backtests`. This proves the artifact now arrives AND selects that branch
# rather than the legacy DSL `BacktestRequest` branch.
#
# 🛑 `from_compiled_spec` is imported INSIDE the branch at call time, so it is
# patched on its DEFINING module (`spec_condition_compiler`), not on `bt`.
# Patching `bt.from_compiled_spec` would silently no-op and the witness would
# read "never dispatched" on both arms — a false green of exactly the shape
# `[main-spy-both-arms]` describes.
# ══════════════════════════════════════════════════════════════════════════════
class _ReachedCompiledSpec(BaseException):
    """Sentinel: execution selected the Band C compiled-spec branch."""


def _real_compiled_spec() -> dict:
    """The persisted artifact shape, built from the REAL golden compile."""
    art = produce_spec_artifact_from_record(_record(GOLDEN_STUB), video=GOLDEN_STUB).artifact
    return {
        "video": art["video"],
        "spec_hash": art["spec_hash"],
        "graph_canonical_hash": art["graph_canonical_hash"],
        "ledger_d": art["ledger_d"],
        "spec": art["spec"],
    }


def _run_main_watching_dispatch(cfg: dict, tmp_path: pathlib.Path, monkeypatch):
    """Drive the real `main()` and record whether Band C dispatch was reached.

    Returns `(stdout, seen)` where `seen` holds the object actually handed to
    `from_compiled_spec`, or None if that branch never ran.
    """
    import src.engine.spec_condition_compiler as scc

    seen: dict = {"artifact": None, "reached": False}

    def _stub_from_compiled_spec(artifact, **_kw):
        seen["artifact"] = artifact
        seen["reached"] = True
        raise _ReachedCompiledSpec()

    monkeypatch.setattr(scc, "from_compiled_spec", _stub_from_compiled_spec)
    # Keep the run offline regardless of which branch is taken.
    monkeypatch.setattr(bt, "load_ohlcv", lambda *a, **k: (_ for _ in ()).throw(_ReachedMarketData()))

    tmp_path.mkdir(parents=True, exist_ok=True)
    path = tmp_path / "config.json"
    path.write_text(json.dumps(cfg), encoding="utf-8")
    buf = io.StringIO()
    try:
        with contextlib.redirect_stdout(buf):
            bt.main.callback(
                config_input=str(path),
                backtest_id=None,
                mode="single",
                strategy_class=None,
                run_b15_battery_flag=False,
                exit_engine="static_styleC",
            )
    except BaseException:
        pass
    return buf.getvalue(), seen


def test_mp2_control_5_persisted_compiled_spec_reaches_the_band_c_dispatch(tmp_path, monkeypatch):
    compiled = _real_compiled_spec()
    cfg = _config({})           # legacy w.r.t. candidates; MP2 is a separate axis
    cfg["compiled_spec"] = compiled

    _out, seen = _run_main_watching_dispatch(cfg, tmp_path / "a", monkeypatch)

    assert seen["reached"] is True, (
        "a persisted compiled_spec did NOT select the Band C branch; the engine "
        "consumer is still unreachable through the route transport"
    )
    # EXACT artifact, not a reconstruction.
    assert seen["artifact"] == compiled
    assert seen["artifact"]["spec_hash"] == compiled["spec_hash"]


def test_mp2_control_6_no_compiled_spec_does_not_reach_band_c(tmp_path, monkeypatch):
    # DISCRIMINATING ARM. Without it, a stub that "reached" on every run — or one
    # patched onto the wrong module and therefore never reached — would look
    # identical to a working dispatch.
    cfg = _config({})           # no compiled_spec at all
    _out, seen = _run_main_watching_dispatch(cfg, tmp_path / "b", monkeypatch)

    assert seen["reached"] is False, (
        "the Band C branch ran for a legacy row with no persisted compiled_spec; "
        "a compiler artifact was fabricated or defaulted somewhere"
    )


def test_mp2_control_4_candidate_authority_still_refuses_before_band_c(tmp_path, monkeypatch):
    # MP2 may not weaken MP1: an unprovable candidate must stop execution BEFORE
    # the compiled-spec branch can run.
    row = _real_rows()[0]
    sidecar = _sidecar(row)
    sidecar["execution_candidate_cache_identity"] = "tampered-in-transit"
    cfg = _config(sidecar)
    cfg["compiled_spec"] = _real_compiled_spec()

    out, seen = _run_main_watching_dispatch(cfg, tmp_path / "c", monkeypatch)

    assert CANDIDATE_REFUSAL_REASON in out
    assert seen["reached"] is False, (
        "the compiled-spec branch ran despite an unprovable candidate identity"
    )
