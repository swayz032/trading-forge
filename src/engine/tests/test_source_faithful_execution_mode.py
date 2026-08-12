"""SOURCE-RISK-HANDOFF-1 / STEP 5+4 — the narrow SOURCE_FAITHFUL execution-ownership mode.

Authority: AR-1068 (gpt-rulings 06d63e2b) §7, §8, §10 NEXT UNIT 3.

WHAT IS PROVEN HERE, AND WHAT IS NOT — READ THIS BEFORE TRUSTING A GREEN
-----------------------------------------------------------------------
`run_class_backtest()` needs market data, and THIS BOX HAS NONE. That is a documented
trap in this campaign: a spy placed inside a data-less backtest reads zero on BOTH arms,
which looks exactly like a perfect gate. So this file does NOT pretend to run a backtest.

  ✅ PROVEN BY EXECUTION — the mode validation and the exit-engine refusal. Both run
     BEFORE any data load (they sit immediately after `spec = CONTRACT_SPECS[symbol]`),
     so these tests execute the real production function and observe its real behaviour.
  ✅ PROVEN STRUCTURALLY — that the two bypasses are WIRED into the right branches, by
     parsing the real source with `ast` and asserting the branch shape. Every one of these
     is red-proofed by ablation; none of them is a grep over a comment.
  🛑 NOT PROVEN — that the bypasses change a real trade population end to end. That needs
     a class backtest over real bars and belongs to AR-1068 §10 NEXT UNIT 4 / STEP 6.

★ `A ROUTING PROOF IS NOT AN EXECUTION PROOF, AND SAYING SO IS THE ONLY THING THAT KEEPS
   IT USEFUL.`
"""

from __future__ import annotations

import ast
import inspect
import io
import textwrap

import pytest

from src.engine.backtester import run_class_backtest


class _FakeStrategy:
    """The minimum `run_class_backtest` touches before the mode gate: symbol, timeframe,
    name. It never reaches data loading in these tests, by construction."""

    symbol = "MES"
    timeframe = "5m"
    name = "svkm-source-faithful-probe"


# ── EXECUTED PROOFS ──────────────────────────────────────────────────────────


class TestTheModeGateExecutes:
    def test_style_c_under_source_faithful_REFUSES_rather_than_mislabelling(self):
        """AR-1068 §7: Style C would replace the teacher's whole-position fixed-R target and
        the run would still be labelled SOURCE_FAITHFUL. That is the mislabel the ruling
        names, so the OFF branch must REFUSE — never fall back."""
        with pytest.raises(ValueError, match="REFUSING rather than mislabelling"):
            run_class_backtest(
                _FakeStrategy(), "2024-01-01", "2024-01-31",
                source_risk_mode="SOURCE_FAITHFUL",     # exit_engine defaults to static_styleC
            )

    def test_the_refusal_names_style_c_and_the_missing_wiring_not_a_generic_error(self):
        with pytest.raises(ValueError) as exc:
            run_class_backtest(
                _FakeStrategy(), "2024-01-01", "2024-01-31",
                source_risk_mode="SOURCE_FAITHFUL", exit_engine="static_styleC",
            )
        msg = str(exc.value)
        assert "static_styleC" in msg and "whole-position fixed-R" in msg, (
            "a refusal nobody can act on is a crash with better manners"
        )

    def test_an_unrecognised_mode_REFUSES_and_is_not_treated_as_legacy(self):
        """A typo must not silently buy back the entire Trading Forge overlay."""
        with pytest.raises(ValueError, match="not a declared ownership mode"):
            run_class_backtest(
                _FakeStrategy(), "2024-01-01", "2024-01-31",
                source_risk_mode="SOURCE-FAITHFUL",     # hyphen, not underscore
            )

    def test_legacy_None_passes_the_mode_gate_untouched(self):
        """POSITIVE CONTROL FOR EVERY REFUSAL ABOVE. If `run_class_backtest` raised for some
        unrelated reason, all three refusal tests would pass on a function that rejects
        everything. This proves the gate LETS LEGACY THROUGH — it must fail LATER (on
        data), and with a different error."""
        with pytest.raises(Exception) as exc:
            run_class_backtest(_FakeStrategy(), "2024-01-01", "2024-01-31")
        msg = str(exc.value)
        assert "not a declared ownership mode" not in msg
        assert "REFUSING rather than mislabelling" not in msg

    def test_TF_OVERLAY_VARIANT_also_passes_the_mode_gate(self):
        """The other declared mode is accepted; only SOURCE_FAITHFUL takes the bypasses."""
        with pytest.raises(Exception) as exc:
            run_class_backtest(
                _FakeStrategy(), "2024-01-01", "2024-01-31",
                source_risk_mode="TF_OVERLAY_VARIANT",
            )
        assert "not a declared ownership mode" not in str(exc.value)

    def test_source_faithful_with_a_non_styleC_engine_passes_the_exit_gate(self):
        """Discriminates the refusal: it must be caused by STYLE C specifically, not by
        SOURCE_FAITHFUL being present at all. Otherwise the guard is untargeted."""
        with pytest.raises(Exception) as exc:
            run_class_backtest(
                _FakeStrategy(), "2024-01-01", "2024-01-31",
                source_risk_mode="SOURCE_FAITHFUL", exit_engine="naked",
            )
        assert "REFUSING rather than mislabelling" not in str(exc.value)


class TestTheSignatureContract:
    def test_source_risk_mode_exists_and_defaults_to_None(self):
        p = inspect.signature(run_class_backtest).parameters
        assert "source_risk_mode" in p
        assert p["source_risk_mode"].default is None, (
            "any non-None default would silently change every existing caller"
        )

    def test_the_legacy_defaults_around_it_are_unchanged(self):
        """Byte-identity for legacy rests on these defaults, so they are pinned."""
        p = inspect.signature(run_class_backtest).parameters
        assert p["exit_engine"].default == "static_styleC"
        assert p["skip_eligibility_gate"].default is False
        assert p["exit_policy"].default == "full_overlay"


# ── STRUCTURAL PROOFS OF THE TWO BYPASSES ────────────────────────────────────


def _class_backtest_ast() -> ast.FunctionDef:
    src = io.open("src/engine/backtester.py", encoding="utf-8").read()
    tree = ast.parse(src)
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name == "run_class_backtest":
            return node
    raise AssertionError("run_class_backtest not found — the instrument, not the code, failed")


def _source_of(node: ast.AST) -> str:
    src = io.open("src/engine/backtester.py", encoding="utf-8").read()
    return textwrap.dedent(ast.get_source_segment(src, node) or "")


class TestTheBypassesAreWiredIntoTheRightBranches:
    """⚠️ STRUCTURAL, NOT BEHAVIOURAL. These assert the branch SHAPE of the real production
    source. They cannot prove a trade population changed — see this module's docstring."""

    def test_the_eligibility_gate_bypass_reads_the_mode(self):
        """AR-1068 §7 'Existing eligibility overlay leak': apply_eligibility_gate() is the
        7-layer A+ overlay and it deletes source entries before performance is measured."""
        fn = _class_backtest_ast()
        hits = [
            n for n in ast.walk(fn)
            if isinstance(n, ast.If)
            and "_source_faithful" in _source_of(n.test)
            and "skip_eligibility_gate" in _source_of(n.test)
        ]
        assert len(hits) == 1, (
            f"expected exactly one eligibility branch reading the mode, found {len(hits)}"
        )
        # It must reuse the gate's OWN bypass branch, not add a second skip path.
        assert isinstance(hits[0].test, ast.BoolOp) and isinstance(hits[0].test.op, ast.Or)

    def test_the_house_stop_ceiling_and_time_stop_are_in_the_ELSE_of_a_mode_branch(self):
        """AR-1068 §8: the house ceiling 'may not silently delete or tighten the source
        trade'. E.5's 15:55 flatten is untaught. Both live in `_apply_dsl_stop_loss_and_time_stop`,
        which must therefore be UNREACHABLE when the mode is source-faithful."""
        fn = _class_backtest_ast()
        branches = [
            n for n in ast.walk(fn)
            if isinstance(n, ast.If) and _source_of(n.test).strip() == "_source_faithful"
        ]
        assert len(branches) == 1, f"expected one bare `if _source_faithful:`, got {len(branches)}"
        br = branches[0]

        body_src = "\n".join(_source_of(s) for s in br.body)
        else_src = "\n".join(_source_of(s) for s in br.orelse)

        assert "_apply_dsl_stop_loss_and_time_stop" not in body_src, (
            "the house ceiling / time stop must NOT run on the source-faithful arm"
        )
        assert "_apply_dsl_stop_loss_and_time_stop" in else_src, (
            "…and it must still run on the legacy arm — otherwise this bypass silently "
            "disarmed E.3/E.5 for every existing strategy"
        )

    def test_the_dll_halt_is_still_applied_and_is_NOT_inside_the_bypass(self):
        """HONEST LIMIT, PINNED AS A TEST. AR-1068 §7's SOURCE_FAITHFUL list does not name
        E.4 (DLL halt), so I did not widen the authorized bypass to include it. But E.4 DOES
        suppress entries, so the source trade population is still not fully preserved. This
        test exists so that limitation is a FACT ON THE RECORD rather than a footnote."""
        fn = _class_backtest_ast()
        br = [
            n for n in ast.walk(fn)
            if isinstance(n, ast.If) and _source_of(n.test).strip() == "_source_faithful"
        ][0]
        assert "_apply_dll_halt_to_entries" not in "\n".join(_source_of(s) for s in br.body)
        assert "_apply_dll_halt_to_entries" in _source_of(fn), "positive witness: E.4 still exists"

    def test_the_run_discloses_which_guards_were_bypassed(self):
        """A bypass nobody can see in the output is indistinguishable from a bug."""
        src = _source_of(_class_backtest_ast())
        assert '"source_faithful_bypassed": []' in src, "the key must exist on every run"
        assert '"E.3_house_stop_ceiling", "E.5_time_stop_1555_et",' in src
        assert '"source_risk_mode": source_risk_mode,' in src, "the mode must reach the result"
