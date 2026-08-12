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

from src.engine.backtester import (
    _apply_adaptive_management,
    _apply_naked_management,
    _apply_static_styleC_management,
    _apply_stop_only_management,
    _apply_trade_management,
    _resolve_stop_risk_points,
    _source_risk_mode_from_spec,
    _structural_stop_parity_enabled,
    run_class_backtest,
)


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


class TestTheStopCommandIsExact:
    """AR-1068 §8 — `_resolve_stop_risk_points` is a PURE function, so unlike the class
    backtest it can be executed directly with no market data. These are real behavioural
    proofs, not routing proofs."""

    MAP = {"long": {9: {"distance": 20.0}}, "short": {9: {"distance": 20.0}}}
    KW = dict(entry_idx=10, is_short=False, atr_fallback_points=7.0, stop_ceiling=10.0)

    def test_legacy_CLAMPS_the_stop_to_the_house_ceiling(self, monkeypatch):
        """POSITIVE CONTROL AND BASELINE: this is the behaviour §8 objects to, and it must
        still be exactly what legacy does — otherwise the next test proves nothing."""
        monkeypatch.setenv("BACKTEST_STRUCTURAL_STOP_PARITY_ENABLED", "true")
        pts, basis = _resolve_stop_risk_points(**self.KW, structural_stop_map=self.MAP)
        assert (pts, basis) == (10.0, "structural"), "legacy must clamp 20.0 down to the 10.0 ceiling"

    def test_source_faithful_does_NOT_tighten_the_taught_stop(self, monkeypatch):
        """§8: 'the exact source stop must remain the source stop'. 20.0 exceeds the 10.0
        ceiling and must survive intact — clamping it would change the risk distance, the R
        multiple, the 2R target and the outcome, silently."""
        monkeypatch.setenv("BACKTEST_STRUCTURAL_STOP_PARITY_ENABLED", "true")
        pts, basis = _resolve_stop_risk_points(
            **self.KW, structural_stop_map=self.MAP, source_faithful=True
        )
        assert (pts, basis) == (20.0, "source_exact")

    def test_the_stop_basis_distinguishes_the_two_so_a_receipt_can_tell(self, monkeypatch):
        monkeypatch.setenv("BACKTEST_STRUCTURAL_STOP_PARITY_ENABLED", "true")
        _, legacy = _resolve_stop_risk_points(**self.KW, structural_stop_map=self.MAP)
        _, source = _resolve_stop_risk_points(
            **self.KW, structural_stop_map=self.MAP, source_faithful=True
        )
        assert legacy != source, "an unlabelled source stop is indistinguishable from a house stop"

    def test_the_source_stop_TRACKS_the_taught_distance_rather_than_being_a_constant(
        self, monkeypatch
    ):
        """Discriminator: without this, `return 20.0` would pass every test above."""
        monkeypatch.setenv("BACKTEST_STRUCTURAL_STOP_PARITY_ENABLED", "true")
        for d in (3.5, 20.0, 41.25):
            m = {"long": {9: {"distance": d}}}
            pts, _ = _resolve_stop_risk_points(
                **self.KW, structural_stop_map=m, source_faithful=True
            )
            assert pts == d

    def test_source_faithful_REFUSES_instead_of_falling_back_to_ATR(self, monkeypatch):
        """§7: 'no ATR fallback when a REQUIRED taught source anchor is missing.' A plausible
        ATR number under a SOURCE_FAITHFUL label is worse than no number."""
        monkeypatch.setenv("BACKTEST_STRUCTURAL_STOP_PARITY_ENABLED", "true")
        with pytest.raises(ValueError, match="ATR fallback would substitute an untaught stop"):
            _resolve_stop_risk_points(**self.KW, structural_stop_map=None, source_faithful=True)

    def test_legacy_STILL_falls_back_to_ATR(self, monkeypatch):
        """The refusal above must be scoped to the source arm, not a new global failure."""
        monkeypatch.setenv("BACKTEST_STRUCTURAL_STOP_PARITY_ENABLED", "true")
        assert _resolve_stop_risk_points(**self.KW, structural_stop_map=None) == (
            7.0, "atr_fallback",
        )

    def test_the_taught_stop_is_reachable_with_the_parity_flag_OFF(self, monkeypatch):
        """🛑 THE FINDING THIS TEST EXISTS FOR. BACKTEST_STRUCTURAL_STOP_PARITY_ENABLED
        DEFAULTS FALSE. Its purpose is to keep LEGACY backtests comparable — a reason that
        does not apply to a source-faithful artifact, which has no legacy baseline. If the
        flag still gated this path, the teacher's own stop would be unreachable by default
        and every source-faithful run would refuse."""
        monkeypatch.delenv("BACKTEST_STRUCTURAL_STOP_PARITY_ENABLED", raising=False)
        assert _structural_stop_parity_enabled() is False, "positive witness: the flag IS off"

        pts, basis = _resolve_stop_risk_points(
            **self.KW, structural_stop_map=self.MAP, source_faithful=True
        )
        assert (pts, basis) == (20.0, "source_exact")

    def test_and_LEGACY_is_still_governed_by_that_flag_with_it_OFF(self, monkeypatch):
        """The bypass must not leak into legacy — with the flag off, legacy still takes the
        ATR fallback exactly as before."""
        monkeypatch.delenv("BACKTEST_STRUCTURAL_STOP_PARITY_ENABLED", raising=False)
        assert _resolve_stop_risk_points(**self.KW, structural_stop_map=self.MAP) == (
            7.0, "atr_fallback",
        )


class TestTheModeReachesTheStopCommand:
    def test_every_link_in_the_chain_carries_source_faithful_defaulting_False(self):
        """A mode that stops halfway down the chain is a mode that does nothing. Each default
        must be False, or threading it would change every existing caller."""
        for fn in (
            _resolve_stop_risk_points, _apply_trade_management, _apply_naked_management,
            _apply_stop_only_management, _apply_static_styleC_management,
            _apply_adaptive_management,
        ):
            p = inspect.signature(fn).parameters
            assert "source_faithful" in p, f"{fn.__name__} breaks the chain"
            assert p["source_faithful"].default is False, f"{fn.__name__} default is not False"

    def test_run_class_backtest_passes_its_mode_into_trade_management(self):
        src = _source_of(_class_backtest_ast())
        assert "source_faithful=_source_faithful," in src, (
            "the mode never reaches the stop command, so nothing above it matters"
        )

    def test_the_MES_stop_floor_is_unreachable_on_the_source_arm(self):
        """§7 'no MES 6-point stop floor'. The floor is applied inside
        `_apply_dsl_stop_loss_and_time_stop`, which the E.3/E.5 bypass already makes
        unreachable — so this is closed by that branch, not by a second mechanism. Pinned
        because the reasoning is a JOIN between two facts and joins rot silently."""
        whole = io.open("src/engine/backtester.py", encoding="utf-8").read()
        floor_calls = [
            ln for ln in whole.splitlines() if "_get_stop_floor_for_symbol(" in ln and "def " not in ln
        ]
        assert len(floor_calls) == 1, f"the floor gained a second call site: {floor_calls}"

        tree = ast.parse(whole)
        owner = None
        floor_line = next(
            i + 1 for i, ln in enumerate(whole.splitlines())
            if "_get_stop_floor_for_symbol(" in ln and "def " not in ln
        )
        for n in ast.walk(tree):
            if isinstance(n, ast.FunctionDef) and n.lineno <= floor_line <= (n.end_lineno or 0):
                if owner is None or (n.end_lineno - n.lineno) < (owner.end_lineno - owner.lineno):
                    owner = n
        assert owner.name == "_apply_dsl_stop_loss_and_time_stop", (
            f"the floor moved to {owner.name}; the E.3/E.5 bypass no longer covers it"
        )


class TestProductionIngressStepA:
    """SOURCE_FAITHFUL_EXECUTION_JOIN-1 / STEP A — AR-1074 §3 and §10.A.

    🛑 AR-1074 §3 CORRECTED ME. AR-1073 said the mode reached the stop "through the whole
    chain". It did not: it reached it only when a TEST supplied it by hand. The real Band C
    `compiled_spec` dispatch called `run_class_backtest()` without `source_risk_mode=`, so
    the persisted authority sat in the artifact and never moved. This class covers the join.
    """

    def test_the_helper_reads_the_persisted_mode(self):
        assert _source_risk_mode_from_spec(
            {"spec": {"source_risk": {"mode": "SOURCE_FAITHFUL"}}}
        ) == "SOURCE_FAITHFUL"

    def test_an_artifact_with_no_source_risk_stays_LEGACY(self):
        """AR-1074 §11 discriminator 2. Every artifact in the existing library is this case."""
        for spec in (None, {}, {"spec": {}}, {"spec": {"source_risk": {}}}, {"spec": "notadict"}):
            assert _source_risk_mode_from_spec(spec) is None, spec

    def test_a_TYPO_is_passed_through_and_NOT_normalised_to_legacy(self):
        """★ A SANITISER THAT TURNS A BAD VALUE INTO A PLAUSIBLE DEFAULT IS NOT A GUARD.
        Returning None for 'SOURCE-FAITHFUL' would silently run the FULL Trading Forge
        overlay on an artifact that asked for none. It must reach the validator and refuse."""
        assert _source_risk_mode_from_spec(
            {"spec": {"source_risk": {"mode": "SOURCE-FAITHFUL"}}}
        ) == "SOURCE-FAITHFUL"

        with pytest.raises(ValueError, match="not a declared ownership mode"):
            run_class_backtest(
                _FakeStrategy(), "2024-01-01", "2024-01-31",
                source_risk_mode=_source_risk_mode_from_spec(
                    {"spec": {"source_risk": {"mode": "SOURCE-FAITHFUL"}}}
                ),
            )

    def test_a_malformed_artifact_does_not_CRASH_the_band_c_dispatch(self):
        for junk in (42, "string", [], {"spec": []}, {"spec": {"source_risk": 7}}):
            assert _source_risk_mode_from_spec(junk) is None, junk

    def test_the_BAND_C_call_actually_passes_the_mode(self):
        """AR-1074 §11 discriminator 1: removing this pass must go RED. ⚠️ STRUCTURAL —
        the Band C branch needs market data to execute, which this box does not have."""
        whole = io.open("src/engine/backtester.py", encoding="utf-8").read()
        anchor = "source_risk_mode=_source_risk_mode_from_spec(config.get(\"compiled_spec\"))"
        assert whole.count(anchor) == 1, (
            "the Band C production ingress is missing or duplicated; AR-1074 §3 named this "
            "the FIRST PRODUCTION BLOCKER"
        )

        # …and it must be inside the compiled_spec (Band C) branch, not some other caller.
        band_c = whole.split('config.get("compiled_spec")', 1)
        assert len(band_c) > 1
        assert anchor in whole[whole.index("Band C: compiled-spec condition-family dispatch"):], (
            "the ingress exists but not on the Band C path"
        )

    def test_the_walkforward_call_is_deliberately_NOT_joined_yet(self):
        """AR-1074 §10.A: 'Single-mode backtest first. Walk-forward propagation may wait
        until the deterministic single-path GREEN.' Pinned so the omission reads as a
        DECISION rather than an oversight — and so joining it later is a deliberate act.

        ⚠️ THIS TEST'S FIRST VERSION WAS THE WRONG INSTRUMENT. It counted the raw string
        `source_risk_mode=` and asserted 2, a number I GUESSED. The real count is 3, and two
        of those are inside ERROR-MESSAGE STRING LITERALS, not calls. A text count over
        source cannot tell a call keyword from a word in a message.
        ★ `COUNT THE CONSTRUCT, NOT THE CHARACTERS THAT SPELL IT.`
        """
        tree = ast.parse(io.open("src/engine/backtester.py", encoding="utf-8").read())
        passes = [
            n for n in ast.walk(tree)
            if isinstance(n, ast.Call)
            and any(k.arg == "source_risk_mode" for k in n.keywords)
        ]
        assert len(passes) == 1, f"expected exactly ONE call passing the mode, found {len(passes)}"

        callee = passes[0].func
        name = callee.id if isinstance(callee, ast.Name) else getattr(callee, "attr", None)
        assert name == "run_class_backtest", f"the mode is being passed to {name!r}"

        # And no walk-forward call may carry it yet.
        wf = [
            n for n in ast.walk(tree)
            if isinstance(n, ast.Call)
            and getattr(n.func, "id", getattr(n.func, "attr", None)) == "run_walk_forward_class"
        ]
        assert wf, "positive witness: there IS a walk-forward call to check"
        for n in wf:
            assert not any(k.arg == "source_risk_mode" for k in n.keywords), (
                "walk-forward was joined without a ruling (AR-1074 §10.A defers it)"
            )


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
        # ⚠️ There is now MORE THAN ONE bare `if _source_faithful:` — AR-1074 §7.1 added the
        # E.4 branch. Select by what the branch GUARDS, not by assuming there is only one;
        # a count assertion here would go red every time a new house guard is exempted.
        branches = [
            n for n in ast.walk(fn)
            if isinstance(n, ast.If) and _source_of(n.test).strip() == "_source_faithful"
        ]
        assert branches, "no source-faithful branch found at all"
        matching = [
            b for b in branches
            if "_apply_dsl_stop_loss_and_time_stop" in "\n".join(_source_of(s) for s in b.orelse)
        ]
        assert len(matching) == 1, f"expected one E.3/E.5 mode branch, got {len(matching)}"
        br = matching[0]

        body_src = "\n".join(_source_of(s) for s in br.body)
        else_src = "\n".join(_source_of(s) for s in br.orelse)

        assert "_apply_dsl_stop_loss_and_time_stop" not in body_src, (
            "the house ceiling / time stop must NOT run on the source-faithful arm"
        )
        assert "_apply_dsl_stop_loss_and_time_stop" in else_src, (
            "…and it must still run on the legacy arm — otherwise this bypass silently "
            "disarmed E.3/E.5 for every existing strategy"
        )

        # 🛑 AND THE ELSE MUST BE AN UNCONDITIONAL ELSE.
        # THIS ASSERTION EXISTS BECAUSE THE TWO ABOVE WERE FALSELY GREEN. An ablation that
        # rewrote `else:` to `elif False:` — which disarms E.3/E.5 for EVERY LEGACY STRATEGY,
        # the worst outcome this file guards against — left all 31 tests passing, because the
        # call's TEXT is still inside the (now conditional) orelse block.
        # ★ `PRESENCE IN A BRANCH IS NOT REACHABILITY OF THAT BRANCH.`
        assert not (len(br.orelse) == 1 and isinstance(br.orelse[0], ast.If)), (
            "the legacy arm sits behind a SECOND condition (`elif ...`), so legacy no longer "
            "unconditionally runs E.3/E.5 when the mode is off"
        )

    def test_the_dll_halt_is_now_bypassed_for_source_faithful(self):
        """⚡ THIS TEST WAS INVERTED BY AR-1074 §7.1, AND THE HISTORY MATTERS.

        Its previous form pinned E.4 as a KNOWN LIMIT: I had asked (AR-1072 §6a) whether the
        DLL halt was in or out of the SOURCE_FAITHFUL bypass rather than widening an
        authorized bypass on my own judgement, and pinned the gap so it could not be
        forgotten. §7.1 ruled it OUT — "downstream prop/risk policy, not educator strategy
        semantics" — so the same test now asserts the opposite behaviour.
        ★ `A TEST THAT PINS AN OPEN QUESTION MUST BE REWRITTEN WHEN THE QUESTION IS
           ANSWERED — LEAVING IT GREEN WOULD PIN THE OLD ANSWER.`"""
        fn = _class_backtest_ast()
        branches = [
            n for n in ast.walk(fn)
            if isinstance(n, ast.If) and _source_of(n.test).strip() == "_source_faithful"
        ]
        dll = [
            b for b in branches
            if "_apply_dll_halt_to_entries" in "\n".join(_source_of(s) for s in b.orelse)
        ]
        assert len(dll) == 1, "E.4 must sit in the ELSE of a source-faithful branch"
        assert "_apply_dll_halt_to_entries" not in "\n".join(_source_of(s) for s in dll[0].body), (
            "E.4 must not run on the source arm"
        )

    def test_the_daily_cap_and_rollover_suppression_are_exempt_for_source_faithful(self):
        """AR-1074 §7.3 and §7.4. Neither is taught; both delete source entries."""
        src = _source_of(_class_backtest_ast())
        assert "if max_trades_per_day > 0 and not _source_faithful:" in src
        assert 'if "is_rollover_day" in df.columns and not _source_faithful:' in src

    def test_every_bypassed_house_guard_is_DISCLOSED_by_name(self):
        """A bypass nobody can see in the output is indistinguishable from a bug. The list
        is the run's own account of what it switched off."""
        src = _source_of(_class_backtest_ast())
        for guard in (
            "E.3_house_stop_ceiling", "E.5_time_stop_1555_et", "E.4_dll_halt",
            "max_trades_per_day", "rollover_day_suppression", "tf_eligibility_gate",
        ):
            assert f'"{guard}"' in src, f"{guard} is bypassed but not disclosed"

    def test_the_run_discloses_which_guards_were_bypassed(self):
        """A bypass nobody can see in the output is indistinguishable from a bug."""
        src = _source_of(_class_backtest_ast())
        assert '"source_faithful_bypassed": []' in src, "the key must exist on every run"
        assert '"source_risk_mode": source_risk_mode,' in src, "the mode must reach the result"
        # The per-guard names are asserted by
        # TestTheBypassesAreWiredIntoTheRightBranches.test_every_bypassed_house_guard_is_DISCLOSED_by_name,
        # which checks each one individually rather than pinning one literal line's formatting.
